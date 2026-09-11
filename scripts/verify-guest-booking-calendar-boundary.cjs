'use strict';
// NEW local Calendar fixture admission. Historical pinned suites are not loaded.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const pins=JSON.parse(fs.readFileSync(path.join(__dirname,'guest-calendar-boundary-pins.json'),'utf8'));
assert.equal(pins.schema,'guest-calendar-local-fixture/v1');assert.ok(Object.keys(pins.files).length>30);
for(const [relative,digest] of Object.entries(pins.files)){assert.ok(!path.isAbsolute(relative)&&!relative.includes('..')&&!relative.includes('\\\\'));const bytes=fs.readFileSync(path.join(ROOT,relative));assert.equal(crypto.createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g,'\n')).digest('hex'),digest,'frozen local fixture member: '+relative);}
const {fixture,detach}=require('./guest-book-confirm-search/sdk.cjs');
const vector=JSON.parse(fs.readFileSync(path.join(__dirname,'guest-summary/booking-guest-offer-public-vector.json')));
const OUT=process.env.GC_OUTPUT;assert.ok(OUT,'GC_OUTPUT required');fs.mkdirSync(OUT,{recursive:true});
const NativeDate=Date;function FixtureDate(...args){return args.length?new NativeDate(...args):new NativeDate(vector.now);}
FixtureDate.prototype=NativeDate.prototype;FixtureDate.now=()=>vector.now;FixtureDate.parse=NativeDate.parse;FixtureDate.UTC=NativeDate.UTC;global.Date=FixtureDate;
const PURPOSE='wbe.guest-calendar.new-booking.v1',COLLECTION='GuestBookingCalendarJournal';
function setup(){
 const f=fixture({initial:{GuestBookingFinancialRevisions:[vector.revisionRow],Rooms:[{_id:'suite',roomCode:'adventure_suite'}]},secretValues:vector.secrets});
 const audience=JSON.parse(vector.secrets.WBE_GUEST_BOOKING_KEYS).audience;
 const config={enabled:true,mode:'LOCAL_FIXTURE',purpose:PURPOSE,audience,calendarId:'guest-calendar-fixture@example.invalid',newBookingsOnly:true,legacyExcluded:true};
 const rows=[],trace=[],events=new Map(),calls=[];let fault=null,tap=null;
 const wix={...f.wix,query(c){if(c!==COLLECTION)return f.wix.query(c);let field,id,n;return {eq(k,v){field=k;id=v;return this;},limit(v){n=v;return this;},async find(opts){assert.equal(field,'_id');assert.equal(n,2);assert.deepEqual(opts,{suppressAuth:true,suppressHooks:true,consistentRead:true});trace.push({op:'read',id});if(tap)await tap('read',id);return {items:detach(rows.filter(r=>r._id===id)),hasNext(){return false;}};}};},async insert(c,r,opts){if(c!==COLLECTION)return f.wix.insert(c,r,opts);assert.deepEqual(opts,{suppressAuth:true,suppressHooks:true});assert.ok(['DESIRED','ATTEMPT','ACK','UNCERTAIN'].includes(r.kind));trace.push({op:'insert',kind:r.kind,id:r._id});if(tap)await tap('insert',r);if(rows.some(x=>x._id===r._id))throw Error('duplicate');rows.push(detach(r));if(fault===r.kind){fault=null;throw Error('native response lost');}return detach(r);}};
 const Events={async insert(calendarId,resource){calls.push({op:'insert',calendarId,resource:detach(resource)});if(fault==='provider-before'){fault=null;throw Error('timeout before apply');}const key=calendarId+'/'+resource.id;if(events.has(key))throw Object.assign(Error('duplicate'),{code:409});const applied={...detach(resource),status:'confirmed'};events.set(key,applied);if(fault==='provider-after'){fault=null;throw Error('response lost');}return detach(applied);},async get(calendarId,id){calls.push({op:'get',calendarId,id});const found=events.get(calendarId+'/'+id);if(!found)throw Object.assign(Error('not found'),{code:404});return detach(found);}};
 function restart(){
  const cache=new Map(),ext={'wix-data':{default:wix},crypto:{...crypto,default:crypto},buffer:{Buffer},'wix-auth':{elevate:fn=>fn},'wix-secrets-backend.v2':{secrets:{async getSecretValue(name){if(name==='WBE_GUEST_CALENDAR_LOCAL_BOUNDARY')return {value:JSON.stringify(config)};return f.secrets.getSecretValue(name);}}},'wix-web-module':{Permissions:{Anyone:'Anyone'},webMethod:(p,fn)=>fn},https:{request(){throw Error('network denied');}},'backend/guestBookingCalendarEvents':{calendarEvents:Events}};
  function load(id){if(cache.has(id))return cache.get(id);let m;if(ext[id]){const values=ext[id];m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{identifier:id});}else {assert.match(id,/^backend\/[A-Za-z0-9.]+$/);const file=path.join(ROOT,'velo',id+'.js');assert.ok(Object.hasOwn(pins.files,'velo/'+id+'.js'),'unfrozen backend import');let source=fs.readFileSync(file,'utf8');if(id==='backend/guestBookingCompletionRecovery'&&['capture','capture-mutant'].includes(process.argv[2])){const anchor='const allocation=await handoffGuestBookingAllocation(selected);';assert.ok(source.includes(anchor));source=source.replace(anchor,anchor+"\nif(context){context.operationId='0'.repeat(64);context.rootDigest='0'.repeat(64);}");if(process.argv[2]==='capture-mutant'){source=source.replace('const subject=context?Object.freeze','let subject=context?Object.freeze').replace("if(context){context.operationId='0'.repeat(64);context.rootDigest='0'.repeat(64);}","if(context){context.operationId='0'.repeat(64);context.rootDigest='0'.repeat(64);subject=[context.acceptanceId,context.operationId,context.rootDigest];}");}}m=new vm.SourceTextModule(source,{identifier:id});}cache.set(id,m);return m;}
  return async name=>{const m=load('backend/'+name);if(m.status==='unlinked')await m.link(spec=>load(spec));if(m.status==='linked')await m.evaluate();return m.namespace;};
 }
 return {f,config,rows,trace,events,calls,restart,setFault:v=>fault=v,setTap:v=>tap=v};
}
async function produce(s,load,waitForAttempt=true){
 const api=await load('guestBookingSummaryService.web'),{priceGroups,...input}=vector.purchase;
 const offer=await api.prepareGuestBookingSummary({...input,summaryRooms:vector.summaryRooms});assert.equal(offer.status,'OFFER');
 assert.equal((await api.confirmGuestBookingSummary(JSON.parse(JSON.stringify(offer.credential)))).status,'ACCEPTED_PENDING');
 const recovery=await load('guestBookingCompletionRecovery');
 assert.equal(typeof recovery.recoverGuestBookingCompletionsAndCalendar,'function','new exclusive Calendar continuation missing');
 const visits=[];for(let i=0;i<96&&(waitForAttempt?!s.rows.some(r=>r.kind==='ATTEMPT'):!s.f.snapshot().GuestBookingCompletions.length);i++)visits.push(await recovery.recoverGuestBookingCompletionsAndCalendar());
 const db=s.f.snapshot();assert.equal(db.GuestBookingCompletions.length,1,'actual completion writer');
 assert.equal((await api.readGuestBookingSummaryStatus(offer.credential)).status,'CONFIRMED');
 return {db,visits,root:db.GuestBookingAcceptances[0]};
}
async function uncertainty(mode){
 const s=setup();s.setFault(['cancelled','mismatch'].includes(mode)?'provider-after':mode);
 if(mode==='ATTEMPT-readback'){let failed=false;s.setTap(async(op,id)=>{if(!failed&&op==='read'&&id.endsWith('-attempt')&&s.rows.some(r=>r.kind==='ATTEMPT')){failed=true;throw Error('readback lost');}});}
 const load=s.restart(),p=await produce(s,load);
 if(['cancelled','mismatch'].includes(mode)){assert.equal(s.events.size,1);for(const resource of s.events.values()){if(mode==='cancelled')resource.status='cancelled';else resource.start.date='2099-01-01';}}
 const before=JSON.stringify(s.f.snapshot()),insertCount=s.calls.filter(x=>x.op==='insert').length;
 const fresh=s.restart(),boundary=await fresh('guestBookingCalendarBoundary');
 assert.notEqual(boundary,await load('guestBookingCalendarBoundary'));
 const results=[];for(let i=0;i<3;i++)results.push(await boundary.advanceRecoveredGuestBookingCalendar(p.root._id,p.root.operationId,p.root.rootDigest));
 assert.equal(s.calls.filter(x=>x.op==='insert').length,insertCount,'uncertainty never grants a second insert');
 const expectsAck=['provider-after','ACK'].includes(mode);
 assert.ok(results.every(r=>r.status===(expectsAck?'ACK':'OWNER_REVIEW')));
 assert.equal(s.rows.filter(r=>r.kind==='ATTEMPT').length,1);assert.equal(s.rows.filter(r=>r.kind==='ACK').length,expectsAck?1:0);
 assert.equal(JSON.stringify(s.f.snapshot()),before);
 fs.writeFileSync(OUT+'/'+mode+'.json',JSON.stringify({id:'GC-'+mode,status:'PASS',root:p.root,rows:s.rows,trace:s.trace,calls:s.calls,results},null,2));
 console.log(JSON.stringify({id:'GC-'+mode,status:'PASS',insertCount,results}));
}
async function concurrency(){
 const s=setup();s.config.enabled=false;const load=s.restart(),p=await produce(s,load,false),subject=[p.root._id,p.root.operationId,p.root.rootDigest];
 assert.deepEqual(s.rows,[]);assert.deepEqual(s.trace,[]);assert.deepEqual(s.calls,[]);
 const before=JSON.stringify(s.f.snapshot());s.config.enabled=true;
 const first=await load('guestBookingCalendarBoundary'),second=await s.restart()('guestBookingCalendarBoundary');assert.notEqual(first,second);
 s.setTap(async(op)=>{if(op==='read')throw Error('collection unavailable');});
 assert.equal((await first.advanceRecoveredGuestBookingCalendar(...subject)).status,'UNRESOLVED');assert.equal(JSON.stringify(s.f.snapshot()),before);assert.equal(s.calls.length,0);
 let count=0,release;const gate=new Promise(resolve=>release=resolve);let timer;
 const watchdog=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('exclusive race watchdog')),10000);});
 s.setTap(async(op,row)=>{if(op==='insert'&&row.kind==='ATTEMPT'){if(++count===2)release();await gate;}});
 let results;try{results=await Promise.race([Promise.all([first.advanceRecoveredGuestBookingCalendar(...subject),second.advanceRecoveredGuestBookingCalendar(...subject)]),watchdog]);}finally{release();clearTimeout(timer);s.setTap(null);}
 assert.equal(count,2,'both independently reconstructed contenders reach the native exclusive insert');
 assert.equal(s.rows.filter(r=>r.kind==='ATTEMPT').length,1);assert.equal(s.calls.filter(c=>c.op==='insert').length,1);assert.equal((await second.advanceRecoveredGuestBookingCalendar(...subject)).status,'ACK');assert.equal(JSON.stringify(s.f.snapshot()),before);
 fs.writeFileSync(OUT+'/concurrency.json',JSON.stringify({id:'GC-concurrency',status:'PASS',defaultOff:true,missingStore:true,results,rows:s.rows,trace:s.trace,calls:s.calls},null,2));console.log(JSON.stringify({id:'GC-concurrency',status:'PASS',contenders:count,events:1}));
}
async function run(){
 if(process.argv[2]==='concurrency'){await concurrency();return;}
 if(['provider-after','provider-before','ATTEMPT','ACK','ATTEMPT-readback','cancelled','mismatch'].includes(process.argv[2])){await uncertainty(process.argv[2]);return;}
 assert.ok([undefined,'capture','capture-mutant'].includes(process.argv[2]),'unknown case');
 const s=setup(),load=s.restart();const p=await produce(s,load);
 assert.deepEqual(s.rows.map(r=>r.kind),['DESIRED','ATTEMPT','ACK']);
 assert.equal(s.calls.filter(x=>x.op==='insert').length,1);
 const desired=JSON.parse(s.rows[0].canonical),projection=JSON.parse(p.db.GuestBookingCompletions[0].projectionCanonical),summary=projection.summary;
 assert.equal(desired.purpose,PURPOSE);assert.equal(desired.calendarId,s.config.calendarId);assert.equal(desired.acceptanceId,p.root._id);assert.equal(desired.operationId,p.root.operationId);assert.equal(desired.rootDigest,p.root.rootDigest);
 assert.equal(desired.resource.summary,'Wanderlust Caribbean Booking: '+summary.guestName);assert.equal(desired.resource.description,'Wanderlust Booking: '+summary.guestName);
 assert.deepEqual(desired.resource.start,{date:summary.checkIn});assert.deepEqual(desired.resource.end,{date:summary.checkOut});assert.match(desired.resource.id,/^[0-9a-v]{5,1024}$/);
 assert.equal(Object.keys(desired.resource).some(k=>/room|owner/i.test(k)),false);
 const before=JSON.stringify(s.f.snapshot()),fresh=s.restart();assert.notEqual(await load('guestBookingCalendarBoundary'),await fresh('guestBookingCalendarBoundary'));
 const boundary=await fresh('guestBookingCalendarBoundary');
 for(let i=0;i<3;i++)assert.equal((await boundary.advanceRecoveredGuestBookingCalendar(p.root._id,p.root.operationId,p.root.rootDigest)).status,'ACK');
 assert.equal(s.calls.filter(x=>x.op==='insert').length,1);assert.equal(JSON.stringify(s.f.snapshot()),before,'Calendar cannot mutate booking or invoice');
 const boundRows=JSON.stringify(s.rows),calls=s.calls.length,subject=[p.root._id,p.root.operationId,p.root.rootDigest];
 const authority=await fresh('guestBookingCompletionAuthority');
 assert.equal((await authority.readCalendarBoundGuestBookingCompletion({purpose:PURPOSE,...p.root})).status,'DENIED','forged handle denied');
 assert.equal((await boundary.advanceRecoveredGuestBookingCalendar(p.root._id,p.root.operationId,'0'.repeat(64))).status,'UNRESOLVED','retained digest must match');
 for(const change of [{enabled:false},{purpose:'invoice'},{calendarId:'primary'},{calendarId:'live@example.com'},{mode:'LIVE'},{legacyExcluded:false}]){const saved={...s.config};Object.assign(s.config,change);assert.equal((await boundary.advanceRecoveredGuestBookingCalendar(...subject)).status,'OFF');Object.assign(s.config,saved);}
 const oldCalendar=s.config.calendarId;s.config.calendarId='other-fixture@example.invalid';assert.equal((await boundary.advanceRecoveredGuestBookingCalendar(...subject)).status,'UNRESOLVED','destination switch conflicts with permanent desired');s.config.calendarId=oldCalendar;
 s.f.armFault('read','GuestBookingCompletions');assert.equal((await boundary.advanceRecoveredGuestBookingCalendar(...subject)).status,'UNRESOLVED');
 assert.equal(JSON.stringify(s.rows),boundRows);assert.equal(s.calls.length,calls);assert.equal(JSON.stringify(s.f.snapshot()),before);
 fs.writeFileSync(OUT+'/happy'+(process.argv[2]?'-'+process.argv[2]:'')+'.json',JSON.stringify({id:process.argv[2]==='capture'?'GC-capture':'GC01',status:'PASS',db:p.db,visits:p.visits,bookingTrace:s.f.trace,rows:s.rows,trace:s.trace,calls:s.calls},null,2));
 console.log(JSON.stringify({id:process.argv[2]==='capture'?'GC-capture':'GC01',status:'PASS',completion:1,events:1,reconstructed:true}));
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});
