'use strict';
// Only the disconnected core is loaded into VM; Python imports only its mapper.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(__dirname, 'google-calendar-reconciliation-core.gs');
assert.ok(fs.existsSync(sourcePath), 'Missing LOOKUP_ONLY core implementation');
const source = fs.readFileSync(sourcePath, 'utf8');
const fixturePath=path.join(__dirname,'fixtures/completion-projection-native-multigroup.json');
const fixtureBytes=fs.readFileSync(fixturePath);
const fixtureSha256=crypto.createHash('sha256').update(fixtureBytes).digest('hex');
// Only CRLF -> LF bytes may differ from the committed fixture; no JSON reserialization.
const fixtureCanonicalBytes=Buffer.from(fixtureBytes.toString('latin1').replace(/\r\n/g,'\n'),'latin1');
const fixtureCanonicalSha256=crypto.createHash('sha256').update(fixtureCanonicalBytes).digest('hex');
assert.equal(fixtureCanonicalSha256,'8bfaca390bfada2941396ee39e2797898517f31f0141dc4723f8d6eb424eae7b');
const mapperSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'booking_engine/calendar_event_contract.py'))).digest('hex');
const generated = spawnSync(process.env.PYTHON || 'python', ['-B', '-c', `
import importlib.util,json,pathlib
r=pathlib.Path.cwd()
s=importlib.util.spec_from_file_location('pure_calendar',r/'booking_engine/calendar_event_contract.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
f=json.loads((r/'scripts/fixtures/completion-projection-native-multigroup.json').read_bytes())
args=[]
for c in f['cases']:
 a=c['envelope']['acceptanceRoot'];q=c['projection']['summary']
 assert a['_id']==q['acceptanceId']
 args.append(dict(audience=a['audience'],calendar_id='fixture-calendar@example.test',acceptance_id=q['acceptanceId'],guest_name=q['guestName'],check_in=q['checkIn'],check_out=q['checkOut']))
args += [dict(args[0],calendar_id='日😀\\u2028\\u2029\\n\\"\\\\@example.test',guest_name=' Zoë e\\u0301 😀\\n',check_in='2024-02-29',check_out='2024-03-01'),dict(args[0],audience='other'),dict(args[0],acceptance_id='a'*64),dict(args[0],guest_name='Changed')]
print(json.dumps([dict(proposal=m.build_calendar_event_proposal(**a),canonical=json.dumps(['wbe.booking-calendar.event',1,a['audience'],a['calendar_id'],a['acceptance_id']],ensure_ascii=False,separators=(',',':'))) for a in args],ensure_ascii=True))
`], {cwd: root, encoding:'utf8', timeout:15000});
assert.equal(generated.status, 0, generated.stderr);
const vectors = JSON.parse(generated.stdout);
const golden = 'bcal14059678688f0da976db70c0a4512a3da46d64de0c13334a078771d29130c264b';
assert.equal(vectors[0].proposal.eventId, golden);
assert.equal(vectors[0].canonical, '["wbe.booking-calendar.event",1,"wbe:fixture","fixture-calendar@example.test","66980e76af0c65173f79d74aef1fdf777bcead806d6b1a27e179e7f6fc38c3f8"]');
const clone = x => JSON.parse(JSON.stringify(x));
const cases = [], traces = [];
function check(id, p, response, status, reason, mode='LOOKUP_ONLY') {
  const calls=[], writes=[], digests=[];
  const state={confirmed:{status:'CONFIRMED'},pending:{status:'pending'}};
  const before=JSON.stringify({p,state,response});
  const io={get:(...args)=>{calls.push(args); if(response==='THROW') throw Error('inert transport'); return response;}};
  for(const op of ['insert','update','patch','delete','remove','save','list','import','bookingWrite']) io[op]=()=>{writes.push(op);throw Error('Forbidden '+op);};
  const context=vm.createContext({Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},computeDigest:(algorithm,text,charset)=>{
    assert.equal(algorithm,'SHA_256');assert.equal(charset,'UTF_8');digests.push(text);
    return Array.from(crypto.createHash('sha256').update(text,'utf8').digest(), b=>b>127?b-256:b);
  }},p,mode,io});
  vm.runInContext(source,context,{timeout:1000});
  const result=clone(vm.runInContext('reconcileBookingCalendarEvent(p,mode,io)',context,{timeout:1000}));
  assert.deepEqual(result,{status,calendarId:status==='DENIED'?null:p.calendarId,eventId:status==='DENIED'?null:p.eventId,reason},id);
  assert.deepEqual(calls,status==='DENIED'?[]:[[p.calendarId,p.eventId]],id);
  assert.deepEqual(writes,[],id);
  assert.equal(JSON.stringify({p,state,response}),before,id);
  if(status!=='DENIED') assert.deepEqual(digests,[JSON.stringify(['wbe.booking-calendar.event',1,p.audience,p.calendarId,p.acceptanceId])]);
  assert.ok(!cases.includes(id));cases.push(id);
  traces.push({id,calls,writes,result,state});
}
for(const [i,v] of vectors.entries()) {
 assert.equal(v.canonical,JSON.stringify(['wbe.booking-calendar.event',1,v.proposal.audience,v.proposal.calendarId,v.proposal.acceptanceId]));
 assert.equal(v.proposal.eventId,'bcal1'+crypto.createHash('sha256').update(v.canonical,'utf8').digest('hex'));
 check('R6-01-02-03-native-unicode-'+i,v.proposal,{status:200,event:{...clone(v.proposal.event),etag:'metadata'}},'SYNCED','MATCHED');
}
const p=vectors[0].proposal;
for(const [i,suffix] of ['\r','\u2028','\u2029'].entries()) {
 const q=clone(p);q.audience+=suffix;
 q.eventId='bcal1'+crypto.createHash('sha256').update(JSON.stringify(['wbe.booking-calendar.event',1,q.audience,q.calendarId,q.acceptanceId])).digest('hex');q.event.id=q.eventId;
 check('R6-03-audience-line-ending-'+i,q,null,'DENIED','INVALID_INPUT');
}
for(const field of Object.keys(p)) {
 const q=clone(p);delete q[field];
 check('R6-10-missing-'+field,q,null,'DENIED','INVALID_INPUT');
}
for(const field of Object.keys(p.event)) {
 const q=clone(p);delete q.event[field];
 check('R6-10-event-missing-'+field,q,null,'DENIED','INVALID_INPUT');
}
const symbolExtra=clone(p);symbolExtra[Symbol('extra')]=true;
check('R6-10-symbol-extra',symbolExtra,null,'DENIED','INVALID_INPUT');
const accessor=clone(p);Object.defineProperty(accessor,'audience',{get(){throw Error('must not read');},enumerable:false});
check('R6-10-accessor',accessor,null,'DENIED','INVALID_INPUT');
for(const [i,response] of [null,{},[],{status:'200',event:p.event},{status:200},{status:200,event:null},{status:200,event:[]},'THROW',... [404,401,403,409,429,500].map(status=>({status,reason:'inert'}))].entries())
 check('R6-08-unresolved-'+i,p,response,'OWNER_REVIEW','LOOKUP_UNRESOLVED');
for(const [i,change] of [{id:'wrong'},{summary:'wrong'},{description:'wrong'},{start:{date:'2027-01-02'}},{end:{date:'2027-01-04'}},{start:{date:'2027-01-01',dateTime:'x'}},{recurrence:[]},{recurringEventId:'x'},{status:'tentative'}].entries())
 check('R6-04-06-mismatch-'+i,p,{status:200,event:{...clone(p.event),...change}},'OWNER_REVIEW','EVENT_MISMATCH');
check('R6-04-cancelled-tombstone',p,{status:200,event:{id:p.eventId,status:'cancelled'}},'OWNER_REVIEW','EVENT_CANCELLED');
for(const [i,q] of [null,[],true,'x',{}, {kind:'PARTIAL_PROJECTION_PROPOSAL'}, {status:'CONFIRMED'}, {invoiceNumber:'invoice',ownerOnly:true}, {...p,eventId:'bcal1'+'a'.repeat(64)}, {...p,calendarId:'other'}, {...p,audience:'other'}, {...p,acceptanceId:'a'.repeat(64)}, {...p,extra:true}, {...p,v:true}].entries())
 check('R6-10-invalid-'+i,q,null,'DENIED','INVALID_INPUT');
for(const [i,mode] of ['FIRST_INSERT','',null,[],new String('LOOKUP_ONLY')].entries())
 check('R6-10-mode-'+i,p,null,'DENIED','INVALID_INPUT',mode);
for(const field of ['audience','calendarId','acceptanceId']) for(const [i,value] of [null,[],{},new String(p[field]),'', '\ud800'].entries())
 check('R6-03-primitive-'+field+'-'+i,{...p,[field]:value},null,'DENIED','INVALID_INPUT');
for(const [i,change] of [{calendarId:'primary'},{audience:'x\n'},{acceptanceId:'A'.repeat(64)},{acceptanceId:'a'.repeat(64)+'\n'}].entries())
 check('R6-03-identity-'+i,{...p,...change},null,'DENIED','INVALID_INPUT');
for(const [i,date] of ['2027-02-29','2027-1-01','2027-01-01T00:00:00Z','0000-01-01','2027-01-03','2027-04-31','2027-01-01\n'].entries()) {
 const q=clone(p);q.event.start.date=date;
 check('R6-03-date-'+i,q,null,'DENIED','INVALID_INPUT');
}
for(const [i,change] of [{summary:'wrong'},{description:'wrong'},{summary:'Wanderlust Caribbean Booking: ',description:'Wanderlust Booking: '},{summary:'Wanderlust Caribbean Booking: \ud800',description:'Wanderlust Booking: \ud800'},{id:'wrong'},{status:'tentative'},{recurrence:[]},{start:{date:'2027-01-01',timeZone:'UTC'}}].entries()) {
 const q=clone(p);Object.assign(q.event,change);
 check('R6-03-event-'+i,q,null,'DENIED','INVALID_INPUT');
}
// Each call creates a genuinely fresh VM; retained supplied state, not insert custody.
const retained={status:200,event:clone(p.event)};
check('R6-07-restart-first',p,retained,'SYNCED','MATCHED');
check('R6-07-restart-fresh',p,retained,'SYNCED','MATCHED');
check('R6-08-deleted-after-sync',p,{status:404,reason:'notFound'},'OWNER_REVIEW','LOOKUP_UNRESOLVED');
// Display changes are consistent proposals, but retained provider content conflicts.
check('R6-10-display-history-observation',vectors[5].proposal,retained,'OWNER_REVIEW','EVENT_MISMATCH');
check('R6-12-invoice-no-authority',{...p,invoiceRevision:2},null,'DENIED','INVALID_INPUT','FIRST_INSERT');
assert.equal(cases.length,109);
// Build hostile responses in the execution realm. Never stringify or read their
// properties in the harness: that would execute getters before the core runs.
const descriptorCases = [
 ['inherited-envelope', 'Object.create({status:200,event:e})'],
 ['inherited-event', '({status:200,event:Object.create(e)})'],
 ['inherited-date', '(()=>{e.start=Object.create({date:e.start.date});return {status:200,event:e}})()'],
 ['accessor-event', '(()=>{Object.defineProperty(e,"summary",{get(){getterReads++;return p.event.summary}});return {status:200,event:e}})()'],
 ['ordinary-match', '({status:200,event:e})', 'SYNCED', 'MATCHED'],
 ['ordinary-rest-metadata', '(()=>{e.etag="tag";e.created="metadata";e.updated="metadata";e.organizer={self:true};e.start.timeZone="UTC";return {status:200,event:e,transportMetadata:true}})()', 'SYNCED', 'MATCHED'],
 ['non200', '({status:500,event:e})'],
 ['sparse-cancelled', '({status:200,event:{status:"cancelled"}})', 'OWNER_REVIEW', 'EVENT_CANCELLED']
];
for (const [level,fields] of [['envelope',['status','event']],['event',['id','status','summary','description','start','end']],['start',['date']],['end',['date']]]) {
 for (const field of fields) for (const kind of ['inherited','accessor','missing']) {
  const target=level==='envelope'?'r':level==='event'?'e':'e.'+level;
  const mutation=kind==='inherited'?'delete t[field];Object.setPrototypeOf(t,{[field]:value});':
   kind==='accessor'?'Object.defineProperty(t,field,{get(){getterReads++;return value}});':'delete t[field];';
  descriptorCases.push([`${level}-${field}-${kind}`,`(()=>{const r={status:200,event:e},t=${target},field=${JSON.stringify(field)},value=t[field];${mutation}return r})()`]);
 }
}
const failures=[];
for(const [name,expression,status='OWNER_REVIEW',reason='LOOKUP_UNRESOLVED'] of descriptorCases) {
 const id='R6-08-own-data-'+name,calls=[],writes=[];
 const context=vm.createContext({p:clone(p),calls,writes,Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},computeDigest:(_,text)=>Array.from(crypto.createHash('sha256').update(text,'utf8').digest(),b=>b>127?b-256:b)}});
 vm.runInContext(source,context,{timeout:1000});
 const observation=clone(vm.runInContext(`(()=>{let getterReads=0;const e=JSON.parse(JSON.stringify(p.event)),response=${expression};const io={get:(...args)=>{calls.push(args);return response}};for(const op of ['insert','update','patch','delete','remove','save','list','import','bookingWrite'])io[op]=()=>{writes.push(op);throw Error(op)};const result=reconcileBookingCalendarEvent(p,'LOOKUP_ONLY',io);return {result,getterReads}})()`,context,{timeout:1000}));
 assert.ok(!cases.includes(id));cases.push(id);
 traces.push({id,calls,writes,...observation});
 try {
  assert.deepEqual(observation.result,{status,calendarId:p.calendarId,eventId:p.eventId,reason},id);
  assert.equal(observation.getterReads,0,id+' must not execute getters');
  assert.deepEqual(calls.map(args=>Array.from(args)),[[p.calendarId,p.eventId]],id);
  assert.deepEqual(writes,[],id);
 } catch(error) { failures.push({id,name:error.name,message:error.message}); }
}
assert.equal(cases.length,109+descriptorCases.length);
console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',cases,count:cases.length,failures,traces,proposals:vectors,fixtureSha256,fixtureCanonicalSha256,mapperSha256,sourceSha256:crypto.createHash('sha256').update(source).digest('hex')},null,2));
if(failures.length) process.exitCode=1;
