'use strict';
// NEW local Calendar fixture admission. Historical pinned suites are not loaded.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
let nativeNetworkCount=0;const denySocket=()=>{nativeNetworkCount++;throw Error('all real socket IO denied');};require('node:net').Socket.prototype.connect=denySocket;require('node:http').request=denySocket;require('node:https').request=denySocket;
const ROOT=path.resolve(__dirname,'..');
const pins=JSON.parse(fs.readFileSync(path.join(__dirname,'guest-calendar-events-pins.json'),'utf8'));
assert.equal(pins.schema,'guest-calendar-events-transport/v1');assert.ok(Object.keys(pins.files).length>30);
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
 const config={enabled:true,mode:'APPS_SCRIPT_EVENTS_V1',purpose:PURPOSE,audience,calendarId:'guest-calendar-fixture@example.invalid',executor:'executor@example.invalid',endpoint:'https://script.google.com/macros/s/INERT_FIXTURE/exec',newBookingsOnly:true,legacyExcluded:true};
 const rows=[],trace=[],events=new Map(),calls=[];let fault=null,tap=null;
 const wix={...f.wix,query(c){if(c!==COLLECTION)return f.wix.query(c);let field,id,n;return {eq(k,v){field=k;id=v;return this;},limit(v){n=v;return this;},async find(opts){assert.equal(field,'_id');assert.equal(n,2);assert.deepEqual(opts,{suppressAuth:true,suppressHooks:true,consistentRead:true});trace.push({op:'read',id});if(tap)await tap('read',id);return {items:detach(rows.filter(r=>r._id===id)),hasNext(){return false;}};}};},async insert(c,r,opts){if(c!==COLLECTION)return f.wix.insert(c,r,opts);assert.deepEqual(opts,{suppressAuth:true,suppressHooks:true});assert.ok(['DESIRED','ATTEMPT','ACK','UNCERTAIN'].includes(r.kind));trace.push({op:'insert',kind:r.kind,id:r._id});if(tap)await tap('insert',r);if(rows.some(x=>x._id===r._id))throw Error('duplicate');rows.push(detach(r));if(fault===r.kind){fault=null;throw Error('native response lost');}return detach(r);}};
 const wire=transportFixture(config);
 function restart(){
  const cache=new Map(),ext={'wix-data':{default:wix},crypto:{...crypto,default:crypto},buffer:{Buffer},'wix-auth':{elevate:fn=>fn},'wix-secrets-backend.v2':{secrets:{async getSecretValue(name){if(name==='WBE_GUEST_CALENDAR_EVENTS_KEY')return {value:'a'.repeat(64)};if(name==='WBE_GUEST_CALENDAR_LOCAL_BOUNDARY')return {value:JSON.stringify(config)};return f.secrets.getSecretValue(name);}}},'wix-web-module':{Permissions:{Anyone:'Anyone'},webMethod:(p,fn)=>fn},https:{request:wire.request}};
  function load(id){if(cache.has(id))return cache.get(id);let m;if(ext[id]){const values=ext[id];m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{identifier:id});}else {assert.match(id,/^backend\/[A-Za-z0-9.]+$/);const file=path.join(ROOT,'velo',id+'.js');assert.ok(Object.hasOwn(pins.files,'velo/'+id+'.js'),'unfrozen backend import');let source=fs.readFileSync(file,'utf8');if(id==='backend/guestBookingCompletionRecovery'&&['capture','capture-mutant'].includes(process.argv[2])){const anchor='const allocation=await handoffGuestBookingAllocation(selected);';assert.ok(source.includes(anchor));source=source.replace(anchor,anchor+"\nif(context){context.operationId='0'.repeat(64);context.rootDigest='0'.repeat(64);}");if(process.argv[2]==='capture-mutant'){source=source.replace('const subject=context?Object.freeze','let subject=context?Object.freeze').replace("if(context){context.operationId='0'.repeat(64);context.rootDigest='0'.repeat(64);}","if(context){context.operationId='0'.repeat(64);context.rootDigest='0'.repeat(64);subject=[context.acceptanceId,context.operationId,context.rootDigest];}");}}m=new vm.SourceTextModule(source,{identifier:id});}cache.set(id,m);return m;}
  return async name=>{const m=load('backend/'+name);if(m.status==='unlinked')await m.link((spec,ref)=>{assert.ok((pins.imports['velo/'+ref.identifier+'.js']||[]).includes(spec),'unfrozen import edge '+ref.identifier+' -> '+spec);return load(spec);});if(m.status==='linked')await m.evaluate();return m.namespace;};
 }
 return {f,config,rows,trace,events,calls,restart,wire,setFault:v=>fault=v,setTap:v=>tap=v};
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

function transportFixture(config){
 const requests=[],provider=[],properties={WBE_GUEST_CALENDAR_EVENTS:JSON.stringify({...config,key:'a'.repeat(64)})};
 let script,redirectBody;const mode=process.argv[2]||'happy',errors=[];let nonceFailed=false;
 const context={Date,JSON,encodeURIComponent,Utilities:{Charset:{UTF_8:'UTF-8'},computeHmacSha256Signature(text,key){return Array.from(crypto.createHmac('sha256',key).update(text).digest(),v=>v>127?v-256:v);}},PropertiesService:{getScriptProperties(){return {getProperty(k){if(mode==='nonce-read-loss'&&k.startsWith('gct.nonce.')&&properties[k]&&!nonceFailed){nonceFailed=true;throw Error('nonce readback lost');}return properties[k]??null;},setProperty(k,v){properties[k]=v;if(mode==='nonce-write-loss'&&!nonceFailed){nonceFailed=true;throw Error('nonce write response lost');}},deleteProperty(k){delete properties[k];},getProperties(){return {...properties};}};}},LockService:{getScriptLock(){return {tryLock(){return true;},releaseLock(){}};}},Session:{getEffectiveUser(){return {getEmail(){return mode==='wrong-executor'?'other@example.invalid':config.executor;}};}},ScriptApp:{getOAuthToken(){if(mode==='token-denial')throw Error('authorization revoked');return 'INERT_OAUTH';}},ContentService:{MimeType:{JSON:'json'},createTextOutput(text){return {text,setMimeType(){return this;}};}},UrlFetchApp:{fetch(url,options){
  provider.push({url,options:JSON.parse(JSON.stringify(options))});
  assert.equal(options.headers.Authorization,'Bearer INERT_OAUTH');assert.equal(options.followRedirects,false);assert.equal(options.muteHttpExceptions,true);assert.equal(options.validateHttpsCertificates,true);
  const base='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(config.calendarId)+'/events';
  let result,status=200;
  if(options.method==='post'){
   assert.equal(url,base+'?sendUpdates=none');assert.equal(options.contentType,'application/json');const resource=JSON.parse(options.payload);provider.expectedId=resource.id;
   result={...resource,status:'confirmed',kind:'calendar#event',etag:'inert'};
   if(mode==='normalize'){result.start.timeZone='America/Dominica';result.extendedProperties.private.unrelated='external metadata';}
   if(mode==='cancelled')result={id:resource.id,status:'cancelled',kind:'calendar#event'};
   if(mode==='differentresource')result.id='f'.repeat(64);
   if(mode==='mismatch')result.start.date='2099-01-01';
   if(mode==='malformed-resource')delete result.end;
   if(!['404','403','409','429'].includes(mode))provider.resource=result;
   if(mode==='lost-insert')throw Error('applied insert response lost at UrlFetch boundary');
  }else {assert.equal(options.method,'get');assert.equal(url,base+'/'+(provider.expectedId||JSON.parse(JSON.parse(requests.at(-1).body).payload).eventId));assert.equal(options.payload,undefined);result=provider.resource;if(!result)status=404;}
  if(['404','403','409','429'].includes(mode))status=Number(mode);
  return {getResponseCode(){return status;},getContentText(){return mode==='malformed'?'not-json':JSON.stringify(result);}};
 }}};
 function request(url,options,callback){
  requests.push({url,options:JSON.parse(JSON.stringify(options))});const recorded=requests.at(-1),req=new EventEmitter();req.setTimeout=()=>req;req.destroy=e=>{if(e)req.emit('error',e);};
  req.end=body=>{recorded.body=body===undefined?'':String(body);if(mode==='timeout'&&requests.length===1)return;queueMicrotask(()=>{try{
   const res=new EventEmitter();res.destroy=()=>{};res.resume=()=>{};res.headers={};
   if(options.method==='POST'){
    assert.equal(url,config.endpoint);assert.equal(options.agent,false);
    if(!script){script=vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'scripts/guest-calendar-events/Code.gs'),'utf8'),script);}
    let delivered=String(body);
    if(['wrong-purpose','wrong-destination','request-tamper','expired-request'].includes(mode)){
     const env=JSON.parse(delivered),payload=JSON.parse(env.payload);
     if(mode==='wrong-purpose')payload.purpose='invoice';else if(mode==='expired-request')payload.issuedAt-=120001;else payload.calendarId='other@example.invalid';
     env.payload=JSON.stringify(payload);if(mode!=='request-tamper')env.mac=crypto.createHmac('sha256','a'.repeat(64)).update('request\n'+env.payload).digest('hex');delivered=JSON.stringify(env);
    }
    recorded.delivered=delivered;
    redirectBody=script.doPost({postData:{contents:delivered,type:'application/json'}}).text;
    if(mode==='response-binding'){const env=JSON.parse(redirectBody),reply=JSON.parse(env.payload);reply.nonce='f'.repeat(64);env.payload=JSON.stringify(reply);env.mac=crypto.createHmac('sha256','a'.repeat(64)).update('response\n'+JSON.parse(delivered).payload+'\n'+env.payload).digest('hex');redirectBody=JSON.stringify(env);}
    if(process.argv[2]==='replay'){const replay=script.doPost({postData:{contents:String(body),type:'application/json'}}).text;assert.equal(JSON.parse(replay).status,'denied','replayed authenticated bytes must not call Events twice');}
    if(mode==='lost-response'&&requests.filter(x=>x.options.method==='POST').length===1){req.emit('error',Error('applied request response lost'));return;}
    res.statusCode=302;res.headers.location='https://script.googleusercontent.com/macros/echo?user_content_key=INERT';if(mode==='redirect-deny')res.headers.location='https://attacker.invalid/';callback(res);res.emit('end');
   }else {assert.equal(options.method,'GET');assert.equal(url,'https://script.googleusercontent.com/macros/echo?user_content_key=INERT');assert.equal(recorded.body,'');res.statusCode=200;res.headers['content-type']='application/json';callback(res);res.emit('data',Buffer.from(mode==='oversize'?' '.repeat(65537):mode==='response-tamper'?redirectBody.replace(/"mac":"[a-f0-9]/,'"mac":"z'):redirectBody));res.emit('end');}
  }catch(e){errors.push(e.stack);req.emit('error',e);}});};return req;
 }
 return {request,requests,provider,properties,context,errors,reconstruct(){script=null;}};
}
async function lockExpiry(){
 // Fresh ordinary producer supplies the original authenticated INSERT, not seeded authority.
 const s=setup(),p=await produce(s,s.restart());assert.deepEqual(s.wire.errors,[]);
 assert.deepEqual(s.rows.map(r=>r.kind),['DESIRED','ATTEMPT','ACK']);
 const original=s.wire.requests.find(r=>r.options.method==='POST').body,payload=JSON.parse(JSON.parse(original).payload);
 const before=JSON.stringify(s.f.snapshot()),trace=[];let now=payload.issuedAt,phase='ordinary',held=false,onWait=null,serial=0;
 const context=s.wire.context,store=context.PropertiesService.getScriptProperties();
 context.Date=class extends NativeDate{static now(){return now;}};
 context.PropertiesService={getScriptProperties(){return Object.fromEntries(['getProperty','getProperties','setProperty','deleteProperty'].map(op=>[op,(...args)=>{trace.push({phase,op,key:args[0],now});return store[op](...args);} ]));}};
 context.LockService={getScriptLock(){return {tryLock(ms){assert.equal(ms,1000);if(onWait){const callback=onWait;onWait=null;callback();}assert.equal(held,false);held=true;trace.push({phase,op:'acquire',now});return true;},releaseLock(){assert.equal(held,true);held=false;trace.push({phase,op:'release',now});}};}};
 const token=context.ScriptApp.getOAuthToken,fetch=context.UrlFetchApp.fetch;
 context.ScriptApp.getOAuthToken=()=>{trace.push({phase,op:'token',now});return token();};
 context.UrlFetchApp.fetch=(...args)=>{trace.push({phase,op:'provider',now});return fetch(...args);};
 const script=vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'scripts/guest-calendar-events/Code.gs'),'utf8'),script);
 const deliver=body=>JSON.parse(script.doPost({postData:{type:'application/json',contents:body}}).text);
 // Only scheduling controls are fixture-signed GETs; original INSERT bytes stay untouched.
 function get(issuedAt){const text=JSON.stringify({...payload,method:'get',resourceText:'',issuedAt,nonce:crypto.createHash('sha256').update('lock-control-'+(++serial)).digest('hex')});return JSON.stringify({payload:text,mac:crypto.createHmac('sha256','a'.repeat(64)).update('request\n'+text).digest('hex')});}
 assert.equal(deliver(original).status,'denied');assert.equal(s.wire.provider.length,1);assert.equal(held,false);
 now=payload.issuedAt+119900;phase='queued';
 onWait=()=>{now=payload.issuedAt+120001;phase='cleanup';assert.ok(deliver(get(now)).payload);phase='resumed';};
 const replay=deliver(original),inserts=s.wire.provider.filter(x=>x.options.method==='post').length;
 fs.writeFileSync(OUT+'/lock-expiry-causal.json',JSON.stringify({original,replay,inserts,trace,provider:s.wire.provider},null,2));
 assert.equal(inserts,1,'Authenticated original INSERT replay must not reach provider twice across expiry while waiting for lock');
 assert.equal(replay.status,'denied');assert.equal(held,false);
 assert.ok(trace.some(x=>x.phase==='cleanup'&&x.op==='deleteProperty'&&x.key==='gct.nonce.'+payload.nonce));
 assert.deepEqual(trace.filter(x=>x.phase==='resumed').map(x=>x.op),['acquire','release'],'expired queued request must perform no nonce/token/provider IO');
 const controls=[];
 function queuedControl(name,age,accepted){
  phase=name;const issuedAt=now,body=get(issuedAt),start=s.wire.provider.length;
  now=issuedAt+119900;onWait=()=>{now=issuedAt+age;};const result=deliver(body);
  assert.equal(held,false);assert.equal(s.wire.provider.length-start,accepted?1:0);
  if(accepted){assert.ok(result.payload);const nonce=JSON.parse(JSON.parse(body).payload).nonce;assert.equal(s.wire.properties['gct.nonce.'+nonce],String(issuedAt+120000),'do not extend retention from lock acquisition');}
  else {assert.equal(result.status,'denied');assert.deepEqual(trace.filter(x=>x.phase===name&&['token','provider','setProperty','getProperties','deleteProperty'].includes(x.op)),[]);}
  controls.push({name,age,accepted});
 }
 queuedControl('valid-queued',119999,true);queuedControl('exact-boundary',120000,true);queuedControl('expired-unconsumed',120001,false);
 // Preserve original inclusive future-skew rule as well as the expiry boundary.
 phase='future-boundary';assert.ok(deliver(get(now+30000)).payload);
 phase='future-outside';const count=s.wire.provider.length;assert.equal(deliver(get(now+30001)).status,'denied');assert.equal(s.wire.provider.length,count);
 assert.equal(JSON.stringify(s.f.snapshot()),before);assert.equal(s.wire.provider.filter(x=>x.options.method==='post').length,1);
 assert.equal(trace.filter(x=>x.op==='acquire').length,trace.filter(x=>x.op==='release').length);
 fs.writeFileSync(OUT+'/lock-expiry.json',JSON.stringify({id:'GCT-lock-expiry',status:'PASS',inserts,controls,trace,requests:s.wire.requests,provider:s.wire.provider,db:p.db},null,2));
 console.log(JSON.stringify({id:'GCT-lock-expiry',status:'PASS',inserts,queuedControls:controls.length,providerCalls:s.wire.provider.length}));
}
async function happy(){
 const s=setup(),load=s.restart(),p=await produce(s,load);
 assert.deepEqual(s.wire.errors,[]);
 assert.deepEqual(s.rows.map(r=>r.kind),['DESIRED','ATTEMPT','ACK'],'production edge must execute actual handler and ACK matching Events resource');
 assert.equal(s.wire.provider.length,1);assert.equal(s.wire.requests.length,2);
 const desired=JSON.parse(s.rows[0].canonical),posted=JSON.parse(s.wire.requests[0].body),wirePayload=JSON.parse(posted.payload);
 assert.equal(posted.mac,crypto.createHmac('sha256','a'.repeat(64)).update('request\n'+posted.payload).digest('hex'));
 assert.equal(wirePayload.resourceText,JSON.stringify(desired.resource));assert.equal(s.wire.provider[0].options.payload,wirePayload.resourceText);
 assert.equal(wirePayload.calendarId,s.config.calendarId);assert.equal(wirePayload.purpose,PURPOSE);assert.equal(wirePayload.method,'insert');
 const before=JSON.stringify(s.f.snapshot()),fresh=await s.restart()('guestBookingCalendarBoundary');
 assert.notEqual(fresh,await load('guestBookingCalendarBoundary'));
 assert.equal((await fresh.advanceRecoveredGuestBookingCalendar(p.root._id,p.root.operationId,p.root.rootDigest)).status,'ACK');
 assert.equal(s.wire.provider.length,1);assert.equal(JSON.stringify(s.f.snapshot()),before);
 fs.writeFileSync(OUT+'/'+(process.argv[2]||'happy')+'.json',JSON.stringify({id:'GCT-'+(process.argv[2]||'happy'),status:'PASS',rows:s.rows,db:p.db,trace:s.trace,requests:s.wire.requests,provider:s.wire.provider},null,2));
 console.log(JSON.stringify({id:'GCT-'+(process.argv[2]||'happy'),status:'PASS',providerCalls:s.wire.provider.length}));
}
async function uncertainty(mode){
 const s=setup(),load=s.restart(),p=await produce(s,load);
 assert.deepEqual(s.wire.errors,[]);assert.equal(s.rows.filter(r=>r.kind==='ATTEMPT').length,1);assert.equal(s.rows.filter(r=>r.kind==='ACK').length,0);
 const before=JSON.stringify(s.f.snapshot()),calls=s.wire.provider.filter(x=>x.options.method==='post').length;
 s.wire.reconstruct();const fresh=await s.restart()('guestBookingCalendarBoundary');assert.notEqual(fresh,await load('guestBookingCalendarBoundary'));
 const results=[];for(let i=0;i<3;i++)results.push(await fresh.advanceRecoveredGuestBookingCalendar(p.root._id,p.root.operationId,p.root.rootDigest));
 const ack=['lost-response','lost-insert'].includes(mode);
 assert.deepEqual(s.wire.errors,[]);assert.ok(results.every(x=>x.status===(ack?'ACK':'OWNER_REVIEW')));
 assert.equal(calls,1);assert.equal(s.wire.provider.filter(x=>x.options.method==='post').length,1,'no hidden Events insert retry');
 assert.equal(s.wire.provider.filter(x=>x.options.method==='get').length,ack?1:3);
 assert.equal(s.rows.filter(r=>r.kind==='ACK').length,ack?1:0);assert.equal(JSON.stringify(s.f.snapshot()),before);
 const envelopes=s.wire.requests.filter(x=>x.options.method==='POST').map(x=>JSON.parse(JSON.parse(x.body).payload));
 assert.equal(envelopes[0].method,'insert');assert.ok(envelopes.slice(1).every(x=>x.method==='get'&&x.resourceText===''));
 assert.equal(new Set(envelopes.map(x=>x.nonce)).size,envelopes.length);
 fs.writeFileSync(OUT+'/'+mode+'.json',JSON.stringify({id:'GCT-'+mode,status:'PASS',db:p.db,rows:s.rows,trace:s.trace,requests:s.wire.requests,provider:s.wire.provider,results},null,2));
 console.log(JSON.stringify({id:'GCT-'+mode,status:'PASS',results,providerCalls:s.wire.provider.length}));
}
async function controls(){
 const s=setup();s.config.enabled=false;const load=s.restart(),p=await produce(s,load,false),boundary=await load('guestBookingCalendarBoundary'),subject=[p.root._id,p.root.operationId,p.root.rootDigest];
 assert.equal(s.rows.length,0);assert.equal(s.wire.requests.length,0);const original={...s.config,enabled:true},before=JSON.stringify(s.f.snapshot());
 const cases=[{enabled:false},{mode:'LOCAL_FIXTURE'},{purpose:'invoice'},{executor:''},{endpoint:''},{calendarId:'primary'},{legacyExcluded:false},{newBookingsOnly:false}];
 for(const c of cases){Object.assign(s.config,original,c);assert.equal((await boundary.advanceRecoveredGuestBookingCalendar(...subject)).status,'OFF');}
 const edge=await load('guestBookingCalendarEvents');
 await assert.rejects(()=>edge.calendarEvents.get(original.calendarId,'a'.repeat(64),original));
 assert.equal(s.wire.requests.length,0,'structural Calendar/invoice lookalikes cannot reach HTTPS');
 Object.assign(s.config,original);
 const scopes=await load('guestBookingCalendarAuthority'),scope=await scopes.captureGuestBookingCalendarScope(...subject);
 assert.ok(scope);
 await assert.rejects(()=>edge.calendarEvents.get(original.calendarId,'a'.repeat(64),scope));
 assert.equal(s.wire.requests.length,0,'genuine scope cannot target a different deterministic event');
 assert.equal(s.rows.length,0);assert.equal(s.wire.requests.length,0);assert.equal(JSON.stringify(s.f.snapshot()),before);
 console.log(JSON.stringify({id:'GCT-controls',status:'PASS',controls:cases.length,defaultOff:true}));
 fs.writeFileSync(OUT+'/controls.json',JSON.stringify({id:'GCT-controls',status:'PASS',controls:cases,rows:s.rows,requests:s.wire.requests,db:p.db}));
}
async function deniedTransport(mode){
 const s=setup();if(mode==='ATTEMPT')s.setFault('ATTEMPT');
 const load=s.restart(),start=performance.now(),p=await produce(s,load);
 assert.deepEqual(s.wire.errors,[]);assert.equal(s.rows.filter(r=>r.kind==='ATTEMPT').length,1);assert.equal(s.rows.filter(r=>r.kind==='ACK').length,0);
 const before=JSON.stringify(s.f.snapshot());s.wire.reconstruct();const fresh=await s.restart()('guestBookingCalendarBoundary'),results=[];
 for(let i=0;i<3;i++)results.push(await fresh.advanceRecoveredGuestBookingCalendar(p.root._id,p.root.operationId,p.root.rootDigest));
 assert.deepEqual(s.wire.errors,[]);assert.ok(results.every(x=>x.status==='OWNER_REVIEW'));assert.equal(s.rows.filter(r=>r.kind==='ACK').length,0);
 assert.equal(s.wire.provider.filter(x=>x.options.method==='post').length,0);
 const expectedGet=mode==='ATTEMPT'?4:['timeout','nonce-write-loss','nonce-read-loss'].includes(mode)?3:0;
 assert.equal(s.wire.provider.length,expectedGet);assert.equal(JSON.stringify(s.f.snapshot()),before);
 const requests=s.wire.requests.filter(x=>x.options.method==='POST').map(x=>JSON.parse(JSON.parse(x.body).payload));
 assert.ok(requests.slice(1).every(x=>x.method==='get'&&x.resourceText===''));if(mode==='ATTEMPT')assert.ok(requests.every(x=>x.method==='get'));
 if(mode==='timeout')assert.ok(performance.now()-start>=15000,'actual nonadvancing-clock deadline timer elapsed');
 fs.writeFileSync(OUT+'/'+mode+'.json',JSON.stringify({id:'GCT-'+mode,status:'PASS',db:p.db,rows:s.rows,trace:s.trace,requests:s.wire.requests,provider:s.wire.provider,results},null,2));
 console.log(JSON.stringify({id:'GCT-'+mode,status:'PASS',providerCalls:s.wire.provider.length,results}));
}
async function concurrency(){
 const s=setup();s.config.enabled=false;const load=s.restart(),p=await produce(s,load,false),subject=[p.root._id,p.root.operationId,p.root.rootDigest];
 assert.deepEqual(s.rows,[]);assert.deepEqual(s.trace,[]);assert.deepEqual(s.wire.requests,[]);
 const before=JSON.stringify(s.f.snapshot());s.config.enabled=true;
 const first=await load('guestBookingCalendarBoundary'),second=await s.restart()('guestBookingCalendarBoundary');assert.notEqual(first,second);
 s.setTap(async(op)=>{if(op==='read')throw Error('collection unavailable');});
 assert.equal((await first.advanceRecoveredGuestBookingCalendar(...subject)).status,'UNRESOLVED');assert.equal(JSON.stringify(s.f.snapshot()),before);assert.equal(s.wire.provider.length,0);
 let count=0,release;const gate=new Promise(resolve=>release=resolve);let timer;
 const watchdog=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('exclusive race watchdog')),10000);});
 s.setTap(async(op,row)=>{if(op==='insert'&&row.kind==='ATTEMPT'){if(++count===2)release();await gate;}});
 let results;try{results=await Promise.race([Promise.all([first.advanceRecoveredGuestBookingCalendar(...subject),second.advanceRecoveredGuestBookingCalendar(...subject)]),watchdog]);}finally{release();clearTimeout(timer);s.setTap(null);}
 assert.equal(count,2,'both independently reconstructed contenders reach the native exclusive insert');
 assert.equal(s.rows.filter(r=>r.kind==='ATTEMPT').length,1);assert.equal(s.wire.provider.filter(c=>c.options.method==='post').length,1);assert.equal((await second.advanceRecoveredGuestBookingCalendar(...subject)).status,'ACK');assert.equal(JSON.stringify(s.f.snapshot()),before);
 fs.writeFileSync(OUT+'/concurrency.json',JSON.stringify({id:'GCT-concurrency',status:'PASS',defaultOff:true,missingStore:true,results,rows:s.rows,trace:s.trace,requests:s.wire.requests,provider:s.wire.provider},null,2));console.log(JSON.stringify({id:'GCT-concurrency',status:'PASS',contenders:count,events:1}));
}
async function run(){const mode=process.argv[2]||'happy';if(mode==='lock-expiry')return lockExpiry();if(['happy','normalize','replay'].includes(mode))return happy();if(mode==='controls')return controls();if(mode==='concurrency')return concurrency();if(['wrong-purpose','wrong-destination','wrong-executor','request-tamper','expired-request','nonce-write-loss','nonce-read-loss','token-denial','timeout','ATTEMPT'].includes(mode))return deniedTransport(mode);assert.ok(['lost-response','lost-insert','404','403','409','429','malformed','malformed-resource','cancelled','differentresource','mismatch','response-tamper','response-binding','redirect-deny','oversize'].includes(mode));return uncertainty(mode);}
run().then(()=>assert.equal(nativeNetworkCount,0)).catch(e=>{console.error(e.stack);process.exitCode=1;});
