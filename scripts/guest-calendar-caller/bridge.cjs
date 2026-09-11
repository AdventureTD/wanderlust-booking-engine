'use strict';
// New finite local integration test, not inherited exact-byte fixture admission.
// Reuse unchanged booking SDK/compiler; invoice-only in-memory extension.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,manifest,verify}=require('./custody.cjs');verify();const fixtureCrypto=crypto;const vm=require('node:vm');const {EventEmitter}=require('node:events');
let nativeNetworkCount=0;const denySocket=()=>{nativeNetworkCount++;throw Error('real network denied');};require('node:net').Socket.prototype.connect=denySocket;require('node:http').request=denySocket;require('node:https').request=denySocket;
const PURPOSE='wbe.guest-calendar.new-booking.v1';
const OUT=process.argv[2];const MODE=process.argv[3]||'happy';let active,pending;const emit=v=>console.log(JSON.stringify(v));
const {fixture,detach}=require(ROOT+'/scripts/guest-book-confirm-search/sdk.cjs');
const vector=JSON.parse(fs.readFileSync(ROOT+'/scripts/guest-summary/booking-guest-offer-public-vector.json'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function graph(){return {graph:manifest.graph};}
function setup(){
 const config={WBE_GUEST_INVOICE_ENABLED:'true',WBE_GUEST_INVOICE_SITE_ORIGIN:'https://www.wanderlustcaribbean.com',WBE_INVOICE_SERVICE_URL:'https://wanderlust-invoice-service.onrender.com',WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'11'.repeat(32)}]}),WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'22'.repeat(32)}]})};
 const f=fixture({initial:{GuestBookingFinancialRevisions:[vector.revisionRow],Rooms:[{_id:'suite',roomCode:'adventure_suite'},{_id:'suite2',roomCode:'adventure_suite'}]},secretValues:{...vector.secrets,WBE_GUEST_INVOICE_ENABLED:'true',WBE_GUEST_INVOICE_SITE_ORIGIN:'https://www.wanderlustcaribbean.com',WBE_INVOICE_SERVICE_URL:'https://wanderlust-invoice-service.onrender.com',WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'11'.repeat(32)}]}),WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'22'.repeat(32)}]})}});
 const calendarConfig={enabled:MODE!=='off',mode:'APPS_SCRIPT_EVENTS_V1',purpose:PURPOSE,audience:'wbe:fixture',calendarId:'guest-calendar-fixture@example.invalid',executor:'executor@example.invalid',endpoint:'https://script.google.com/macros/s/INERT_FIXTURE/exec',newBookingsOnly:true,legacyExcluded:true};
 const wire=transportFixture(calendarConfig),calendarRows=[],nonces=[];
 const trigger={enabled:true,url:'https://www.wanderlustcaribbean.com/_functions/guestBookingContinuation',key:'33'.repeat(32)};
 config.WBE_GUEST_CALENDAR_LOCAL_BOUNDARY=JSON.stringify({...calendarConfig,enabled:false});config.WBE_GUEST_CALENDAR_EVENTS_KEY='a'.repeat(64);
 const posts=[];const rows=[],invoiceTrace=[];const original=f.wix;
 f.wix={...original,query(c){if(!['GuestBookingInvoiceIssuances','BookingPayments','GuestBookingCalendarJournal'].includes(c))return original.query(c);
 let field,value,n;return {eq(k,v){field=k;value=v;return this;},limit(v){n=v;return this;},async find(options){assert.deepEqual(options,{suppressAuth:true,suppressHooks:true,consistentRead:true});assert.equal(n,c==='BookingPayments'?1:2);assert.equal(field,c==='BookingPayments'?'bookingNumber':'_id');invoiceTrace.push({op:'find',collection:c,field,value});if(c==='GuestBookingCalendarJournal'&&active&&active.failCalendarId&&value.includes(active.failCalendarId))throw Error('lowest Calendar journal unavailable');if(c==='GuestBookingInvoiceIssuances'&&active&&active.failInvoice)throw Error('invoice journal unavailable');const found=c==='BookingPayments'?[]:(c==='GuestBookingCalendarJournal'?calendarRows:rows).filter(r=>r[field]===value);return {items:detach(found),hasNext(){return false;}};}};
 },async get(c,id,options){assert.equal(c,'GuestBookingTriggerNonces');return detach(nonces.find(r=>r._id===id));},async insert(c,row,options){if(c==='GuestBookingTriggerNonces'){if(nonces.some(r=>r._id===row._id))throw Error('duplicate nonce');nonces.push(detach(row));return detach(row);}if(c==='GuestBookingCalendarJournal'){invoiceTrace.push({op:'insert',collection:c,kind:row.kind,id:row._id});if(calendarRows.some(r=>r._id===row._id))throw Error('duplicate calendar');calendarRows.push(detach(row));return detach(row);}if(c!=='GuestBookingInvoiceIssuances')return original.insert(c,row,options);assert.ok(['INITIAL_ISSUANCE','PREPARED','START','ACK'].includes(row.kind));assert.deepEqual(options,{suppressAuth:true,suppressHooks:true});invoiceTrace.push({op:'insert',collection:c,kind:row.kind,id:row._id});if(rows.some(r=>r._id===row._id))throw Error('duplicate');rows.push(detach(row));if(MODE==='start-loss'&&row.kind==='START')throw Error('inert native START applied then lost ACK');return detach(row);}};
 const clock={now:vector.now},admission=graph(),vm=require('node:vm'),cache=new Map();
 const ext={'wix-http-functions':{response:v=>v},'wix-secrets-backend':{getSecret:async name=>{assert.equal(name,'WBE_GUEST_CONTINUATION_CONFIG');return JSON.stringify(trigger);}},https:{request(url,options,callback){if(url.startsWith('https://script.'))return wire.request(url,options,callback);posts.push({url,options});const emitter=new (require('events').EventEmitter)();emitter.end=body=>{posts.at(-1).body=body;pending={emitter,callback};emit({kind:'dispatch',url,headers:options.headers,bytes:Buffer.from(body).toString('base64'),now:vector.now});};emitter.destroy=()=>{};return emitter;}},crypto:{...fixtureCrypto,default:fixtureCrypto},buffer:{Buffer},'wix-data':{default:f.wix},'wix-auth':{elevate:fn=>fn},'wix-secrets-backend.v2':{secrets:{async getSecretValue(name){if(Object.hasOwn(config,name))return {value:config[name]};return f.secrets.getSecretValue(name);}}},'wix-web-module':{Permissions:{Anyone:'Anyone'},webMethod(permission,fn){assert.equal(permission,'Anyone');return fn;}}};
 function load(id){if(cache.has(id))return cache.get(id);let m;
 if(ext[id]){const values=ext[id];m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{identifier:id});}
 else {assert.ok(admission.graph[id]);const raw=fs.readFileSync(ROOT+'/'+id);assert.equal(sha(Buffer.from(raw.toString().replace(/\r\n/g,'\n'))),admission.graph[id].canonical_lf_sha256);m=new vm.SourceTextModule(raw.toString(),{identifier:id});}
 cache.set(id,m);return m;}
 async function api(n){const m=load('velo/backend/'+n+'.js');if(m.status==='unlinked')await m.link((spec,parent)=>{const edge=admission.graph[parent.identifier].imports.find(e=>e.specifier===spec);assert.ok(edge);return load(edge.target||spec);});if(m.status==='linked')await m.evaluate();return m.namespace;}
 return {f,rows,invoiceTrace,clock,admission,posts,load:api,calendarRows,wire,trigger,config,calendarConfig,restart(){cache.clear();}};
}

function transportFixture(config){
 const requests=[],provider=[],properties={WBE_GUEST_CALENDAR_EVENTS:JSON.stringify({...config,key:'a'.repeat(64)})};
 let script,redirectBody;const mode=MODE==='lost-response'?'lost-response':'happy',errors=[];const resources=new Map();let nonceFailed=false;
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
   if(!['404','403','409','429'].includes(mode))provider.resource=result;resources.set(result.id,result);
   if(mode==='lost-insert')throw Error('applied insert response lost at UrlFetch boundary');
  }else {assert.equal(options.method,'get');assert.ok(url.startsWith(base+'/'));assert.equal(options.payload,undefined);result=resources.get(url.slice((base+'/').length));if(!result)status=404;}
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

const NativeDate=Date;
function FixtureDate(...args){return args.length?new NativeDate(...args):new NativeDate(vector.now);}
FixtureDate.prototype=NativeDate.prototype;FixtureDate.now=()=>vector.now;FixtureDate.parse=NativeDate.parse;FixtureDate.UTC=NativeDate.UTC;global.Date=FixtureDate;
const rl=require('readline').createInterface({input:process.stdin});
rl.on('line',async line=>{try{
 const command=JSON.parse(line);
 if(command.kind==='journal'){
  const http=await active.load('http-functions');
  const response=await http.post_guestInvoiceJournal({method:'POST',url:command.url,headers:command.headers,body:{buffer:async()=>Buffer.from(command.bytes,'base64')}});
  emit({kind:'journal',status:response.status,headers:response.headers,bytes:Buffer.from(response.body).toString('base64')});
 }else if(command.kind==='dispatch-result'){
  if(MODE==='ingress-loss')pending.emitter.emit('error',Error('inert ingress response lost'));
  else {const res=new (require('events').EventEmitter)();res.statusCode=command.status;res.headers={};res.destroy=()=>{};pending.callback(res);res.emit('data',Buffer.from(command.body));res.emit('end');}
 }else if(command.kind==='snapshot'){emit({kind:'snapshot',rows:active.rows,db:active.f.snapshot(),trace:active.invoiceTrace});}
 else if(command.kind==='close'){rl.close();}
 }catch(e){emit({kind:'error',error:e.stack});process.exitCode=1;}});
(async()=>{
 active=setup();let api=await active.load('guestBookingSummaryService.web');const {priceGroups,...input}=vector.purchase;
 const offers=[];
 const visits=[];let serial=0;
 async function tick(){
  active.restart();const http=await active.load('http-functions');
  const raw=JSON.stringify({v:1,purpose:'guest-booking-continuation/v1',timestamp:vector.now,nonce:sha('caller-'+(++serial))});
  const mac=crypto.createHmac('sha256',Buffer.from(active.trigger.key,'hex')).update('WBE-GUEST-TRIGGER/1\nPOST\n'+active.trigger.url+'\n'+raw).digest('hex');
  const result=await http.post_guestBookingContinuation({method:'POST',url:active.trigger.url,headers:{'x-wbe-guest-mac':mac},body:{text:async()=>raw}});assert.equal(result.status,200);visits.push(JSON.parse(result.body));
 }
 for(let subject=0;subject<2;subject++){
  const offer=await api.prepareGuestBookingSummary({...input,guestName:'Fixture Guest '+subject,summaryRooms:[{roomCode:'adventure_suite',qty:1,numGuests:2}]});assert.equal(offer.status,'OFFER');
  assert.equal((await api.confirmGuestBookingSummary(JSON.parse(JSON.stringify(offer.credential)))).status,'ACCEPTED_PENDING');offers.push(offer);
  for(let i=0;i<96&&active.rows.filter(r=>r.kind==='ACK').length<subject+1;i++)await tick();
 }
 fs.writeFileSync(OUT+'/producer-diagnostic.json',JSON.stringify({db:active.f.snapshot(),visits},null,2));
 assert.equal(active.f.snapshot().GuestBookingCompletions.length,2,'actual fresh completion writers');
 assert.equal(active.rows.filter(r=>r.kind==='ACK').length,2,'actual invoice ACK for each fresh subject');
 const booking=JSON.stringify(active.f.snapshot().GuestBookingCompletions);
 assert.equal(active.calendarRows.length,0,'both invoice ACKs precede Calendar enable in inert fixture');
 active.config.WBE_GUEST_CALENDAR_LOCAL_BOUNDARY=JSON.stringify(active.calendarConfig);
 const roots=active.f.snapshot().GuestBookingAcceptances.map(r=>r._id).sort();assert.equal(new Set(roots).size,2);
 if(MODE==='lowest-failure')active.failCalendarId=roots[0];
 if(MODE==='invoice-failure')active.failInvoice=true;
 if(MODE==='progress-loss'){
  const beforeHead=active.f.snapshot().GuestBookingRecoveryProgress.at(-1);
  const nextId='gbrp1-'+String(beforeHead.sequence+1).padStart(16,'0');
  active.f.armFault('after-apply','GuestBookingRecoveryProgress',nextId);
  active.f.armFault('read','GuestBookingRecoveryProgress',nextId);
  await tick();assert.equal(visits.at(-1).status,'RETRY','lost native progress response is not a dispatch grant');
  assert.equal(active.f.snapshot().GuestBookingRecoveryProgress.at(-1)._id,nextId);
 }
 for(let i=0;i<4;i++)await tick();
 if(MODE==='lowest-failure'){
  assert.equal(active.calendarRows.filter(r=>r.kind==='ACK').length,1,'failing lowest must not starve healthy second');
  assert.equal(active.calendarRows.find(r=>r.kind==='ACK')._id,'gcc1-'+roots[1]+'-ack');
  active.failCalendarId=null;for(let i=0;i<4;i++)await tick();
 }
 active.failInvoice=false;

 fs.writeFileSync(OUT+'/caller-before-assert.json',JSON.stringify({calendarRows:active.calendarRows,invoiceRows:active.rows,visits,provider:active.wire.provider},null,2));
 assert.equal(active.calendarRows.filter(r=>r.kind==='ACK').length,MODE==='off'?0:2,'trusted continuation must advance Calendar for BOTH invoice-ACK subjects');
 assert.equal(active.wire.provider.filter(r=>r.options.method==='post').length,MODE==='off'?0:2);
 assert.equal(active.posts.length,2,'invoice ACK must not regenerate sender grant');
 for(const id of roots){
  assert.equal(active.rows.filter(r=>r.kind==='INITIAL_ISSUANCE'&&r.acceptanceId===id).length,1);
  assert.equal(active.calendarRows.filter(r=>r.kind==='ATTEMPT'&&r._id==='gcc1-'+id+'-attempt').length,MODE==='off'?0:1);
 }
 const postedIds=active.wire.provider.filter(r=>r.options.method==='post').map(r=>JSON.parse(r.options.payload).id);
 assert.equal(new Set(postedIds).size,postedIds.length,'one insert per deterministic event ID');
 if(MODE==='lost-response')assert.equal(active.wire.provider.filter(r=>r.options.method==='get').length,1,'lost response reconciles through GET only');
 if(MODE==='off')assert.equal(active.wire.requests.length,0,'OFF performs no Calendar transport calls');

 assert.equal(JSON.stringify(active.f.snapshot().GuestBookingCompletions),booking);
 api=await active.load('guestBookingSummaryService.web');const before=JSON.stringify(active.f.snapshot()),n=active.f.trace.length,ni=active.invoiceTrace.filter(r=>r.op==='insert').length,nc=active.wire.requests.length;
 for(const offer of offers)assert.equal((await api.readGuestBookingSummaryStatus(offer.credential)).status,'CONFIRMED');
 assert.equal(JSON.stringify(active.f.snapshot()),before);assert.equal(active.f.trace.slice(n).filter(r=>r.op==='insert-attempt').length,0);assert.equal(active.invoiceTrace.filter(r=>r.op==='insert').length,ni);assert.equal(active.wire.requests.length,nc);assert.equal(nativeNetworkCount,0);
 fs.writeFileSync(OUT+'/fresh-native.json',JSON.stringify({db:active.f.snapshot(),rows:active.rows,calendarRows:active.calendarRows,provider:active.wire.provider,invoiceTrace:active.invoiceTrace,trace:active.f.trace,visits},null,2));
 emit({kind:'done',stages:active.rows.map(x=>x.kind),posts:active.posts.length,calendarACK:active.calendarRows.filter(r=>r.kind==='ACK').length});
})().catch(e=>{emit({kind:'error',error:e.stack});process.exitCode=1;rl.close();});
