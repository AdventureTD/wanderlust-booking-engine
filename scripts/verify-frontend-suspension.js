'use strict';
// Actual frontend only; scalar boundary is inert, never load backend modules.
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
function fixture(){
 const h=require('./verify-event-bridge.js').setup(), c=h.producer;
 const posts=[],controls=[],writes=[],reads=[];
 c.setSuspendGoogleAds(null);
 c.local.setItem=(...a)=>writes.push(a);
 c.wixLocationFrontend.url='https://www.wanderlustcaribbean.com/?gclid=fixture';c.wixLocationFrontend.query={gclid:'fixture'};
 c.getAdvertisingSuspension=key=>{assert.equal(key,'suspendGoogleAds');return new Promise((resolve,reject)=>reads.push({resolve,reject}));};
 // Observe original business objects, but deliver their real P2 envelopes.
 const post=h.bridge.postMessage, bridge={onMessage:h.bridge.onMessage,postMessage:p=>posts.push(p)};
 h.bridge.postMessage=d=>{if(d.type==='wbe-operational-business')bridge.postMessage(d.message);else controls.push(d);return post(d);};
 h.bridge.onMessage=f=>bridge.onMessage(f);
 const w=()=>h.bridge;w.onReady=()=>{};
 return {c,w,bridge,posts,controls,writes,timers:h.timers,reads,pump:h.pump,ready:h.connect,tick:h.tick};
}
function noBusiness(h) {
 assert.equal(vm.runInContext('microsoftTimer',h.c),null);
 assert.equal(vm.runInContext('microsoftQueue.length+googleQueue.length',h.c),0);
}
function exhaustControl(h) {
 noBusiness(h);
 const flight=vm.runInContext('opFlight',h.c);
 if(flight&&!flight.closed){
  assert.equal(flight.phase,'probe');assert.equal(flight.message.type,'wbe-operational-probe');
  for(let i=0;i<5;i++)h.tick();
  assert.equal(flight.tries,5);assert.equal(flight.closed,true);
 }
 assert.equal(h.timers.size,0);assert.ok(h.controls.every(p=>!p.type.includes('consent')));
}
const tests=[];const test=(id,f)=>tests.push([id,f]);
test('FS01',async()=>{const h=fixture();h.c.observeMicrosoftPage(h.w);h.c.trackPurchase({transactionId:'held',value:0,currency:'EUR'});h.c.captureClickIds();h.ready();assert.equal(h.posts.length,0,'unresolved producer cannot deliver route or business/probe');assert.equal(h.writes.length,0);});
test('FS02',async()=>{for(const value of [null,undefined,false,true,'',{},[],2,'bad',1,'1',0,'0']){const h=fixture();h.c.initTracking(h.w);assert.equal(typeof h.c.observeTrackingSuspension,'function','shared scalar observation required');const p=h.c.observeTrackingSuspension();await Promise.resolve();h.reads[0].resolve(value);await p;h.ready();h.c.trackPurchase({transactionId:'scalar',value:0,currency:'EUR'});assert.equal(h.posts.filter(p=>p.type==='wbe-datalayer-event').length,value===0||value==='0'?1:0);}});
test('FS03',async()=>{const h=fixture();h.c.observeMicrosoftPage(h.w);h.c.trackViewBookingSearch();h.c.trackBeginBooking({nights:7});h.c.trackRoomView({roomCode:'suite'});h.c.trackSearchNoResults({nights:7});h.c.trackPurchase({transactionId:'zero',value:0,currency:'EUR'});h.c.trackPurchase({transactionId:'two',value:12,currency:'USD'});const p=h.c.observeTrackingSuspension();await Promise.resolve();h.reads[0].resolve(0);await p;h.ready();const payloads=h.posts.filter(p=>p.type==='wbe-datalayer-event').map(p=>p.payload);assert.equal(payloads.length,6,'unresolved business work retained');assert.equal(JSON.stringify(payloads.slice(-2)),JSON.stringify([{event:'purchase',transaction_id:'zero',value:0,currency:'EUR'},{event:'purchase',transaction_id:'two',value:12,currency:'USD'}]));assert.ok(h.posts.every(p=>!p.type.includes('consent')));});
test('FS04.1-ON-route-admission',()=>{const h=fixture();h.c.observeMicrosoftPage(h.w);h.c.setSuspendGoogleAds(true);h.ready();for(const page of ['/wanderlust-booking','/booking-summary','/']){h.c.wixLocationFrontend.url='https://www.wanderlustcaribbean.com'+page;h.c.observeMicrosoftPage(h.w);}assert.equal(vm.runInContext('microsoftQueue.length',h.c),0,'ON must not admit routes');h.c.setSuspendGoogleAds(false);assert.equal(h.posts.filter(p=>p.kind==='route').length,0,'OFF cannot replay ON routes');});
for(const order of ['iframe-first','uet-first']) test('FS04.2-'+order,async()=>{
 const h=require('./verify-event-bridge.js').setup();
 const reads=[];h.producer.getAdvertisingSuspension=key=>{assert.equal(key,'suspendGoogleAds');return new Promise(resolve=>reads.push(resolve));};
 const held=h.producer.observeTrackingSuspension();await Promise.resolve();
 h.observe('/wanderlust-booking?private=omit');
 if(order==='iframe-first')h.connect();else h.complete();
 // Actual inert relay emits readiness independently while the scalar is withheld.
 if(order==='uet-first')h.connect();
 h.frame.onmessage({data:{type:'wbe-microsoft-probe',version:1},origin:'https://www.wanderlustcaribbean.com',source:h.parent});
 assert.equal(vm.runInContext('microsoftReady',h.producer),true);
 h.producer.trackPurchase({transactionId:'held-zero',value:0,currency:'EUR'});
 h.observe('/booking-summary?private=omit');
 h.producer.trackPurchase({transactionId:'held-second',value:12,currency:'USD'});
 h.observe('/');h.observe('/not-allowed');
 const retained=JSON.parse(vm.runInContext('JSON.stringify(microsoftQueue)',h.producer));
 assert.deepEqual(retained.filter(p=>p.kind==='route').map(p=>p.page_path),['/'],'unresolved after early ready retains only current allowed route');
 const events=retained.filter(p=>p.kind==='event');assert.equal(events.length,2);assert.equal(new Set(events.map(p=>p.id)).size,2);
 assert.equal(h.attempts.length,0);assert.deepEqual(h.google,[]);assert.deepEqual(h.calls,[]);assert.equal(h.timers.size,0);
 if(order==='iframe-first')h.complete();
 assert.deepEqual(h.calls,[],'both ready still cannot release held scalar work');
 reads[0](0);await held;h.pump();
 assert.deepEqual(h.attempts.filter(p=>p.kind==='event'),events,'original transport envelopes retained');
 assert.deepEqual(h.attempts.filter(p=>p.kind==='route').map(p=>p.page_path),['/']);
 assert.deepEqual(h.calls,[['constructor','17524068','wix_ui',false],['pageLoad'],['event','purchase',{page_path:'/',revenue_value:0,currency:'EUR',transaction_id:'held-zero'}],['event','purchase',{page_path:'/',revenue_value:12,currency:'USD',transaction_id:'held-second'}]]);
 assert.deepEqual(h.google.map(p=>({...p})),[{event:'purchase',transaction_id:'held-zero',value:0,currency:'EUR'},{event:'purchase',transaction_id:'held-second',value:12,currency:'USD'}]);
 assert.equal(vm.runInContext('microsoftQueue.length',h.producer),0);assert.equal(h.timers.size,0);
 assert.ok(h.messages.every(m=>!String(m.data.type).includes('consent')));
});
test('FS04.3-OFF-before-iframe-autonomous',async()=>{
 const h=require('./verify-event-bridge.js').setup();let release;
 h.producer.getAdvertisingSuspension=()=>new Promise(resolve=>{release=resolve;});
 const held=h.producer.observeTrackingSuspension();await Promise.resolve();
 h.observe('/wanderlust-booking');h.producer.trackPurchase({transactionId:'autonomous',value:0,currency:'EUR'});h.observe('/');h.complete();
 assert.equal(h.attempts.length,0);assert.deepEqual(h.google,[]);release(0);await held;
 assert.equal(h.timers.size,1,'OFF restarts readiness probe');assert.equal(h.attempts.length,0);
 h.connect();assert.deepEqual(h.calls,[['constructor','17524068','wix_ui',false],['pageLoad'],['event','purchase',{page_path:'/',revenue_value:0,currency:'EUR',transaction_id:'autonomous'}]]);assert.equal(h.timers.size,0);
});
test('FS05',()=>{const h=fixture();h.c.initTracking(h.w);h.c.setSuspendGoogleAds(false);h.c.trackPurchase({transactionId:'clear',value:1});const saved=[...h.timers.values()];h.c.setSuspendGoogleAds(true);noBusiness(h);assert.equal(h.posts.length,0);exhaustControl(h);saved.forEach(f=>f());assert.equal(h.posts.length,0);h.c.setSuspendGoogleAds(false);h.ready();assert.equal(h.posts.filter(p=>p.kind==='event').length,0);h.c.trackPurchase({transactionId:'new',value:12,currency:'USD'});assert.deepEqual(h.posts.filter(p=>p.kind==='event').map(p=>p.payload.transaction_id),['new']);});
test('FS07',()=>{for(const negative of ['setSuspendGoogleAds','withdrawTracking'])for(const throws of [false,true]){const h=fixture();h.c.initTracking(h.w);h.c.trackPurchase({transactionId:'first',value:1});h.c.trackPurchase({transactionId:'next',value:2});h.ready();h.bridge.postMessage=p=>{h.posts.push(p);if(p.kind==='event'){assert.equal(typeof h.c[negative],'function');h.c[negative](true);if(throws)throw Error('inert');}};h.c.setSuspendGoogleAds(false);assert.equal(h.posts.filter(p=>p.kind==='event').length,1);assert.equal(h.posts.filter(p=>p.type==='wbe-datalayer-event').length,0);assert.equal(h.timers.size,0);}});
test('FS08',async()=>{const h=fixture();h.c.initTracking(h.w);const a=h.c.observeTrackingSuspension(),b=h.c.observeTrackingSuspension();assert.equal(a,b);await Promise.resolve();assert.equal(h.reads.length,1);h.c.setSuspendGoogleAds(true);h.reads[0].resolve(0);await a;h.c.trackPurchase({transactionId:'stale',value:1});h.ready();assert.equal(h.posts.filter(p=>p.kind==='event'||p.type==='wbe-datalayer-event').length,0);});
test('FS06',()=>{const h=fixture(),callbacks=[];const w=id=>id==='#wbeEventBridge'?{postMessage(){throw Error('inert bridge');}}:{onClick(){}};w.onReady=f=>callbacks.push(f);vm.runInNewContext(read('velo/masterPage.js').replace(/^import .*;\n/gm,''),{$w:w,rendering:{env:'browser'},local:{getItem(){return '{"negative":true}';}},withdrawTracking:h.c.withdrawTracking,console:h.c.console});callbacks[0]();h.c.initTracking(h.w);h.c.setSuspendGoogleAds(false);h.c.trackPurchase({transactionId:'negative',value:1});assert.equal(h.posts.filter(p=>p.type==='wbe-datalayer-event').length,0,'saved negative latches actual producer before throwing transport');});
test('FS09',()=>{for(const file of ['velo/masterPage.js','velo/page-booking-search.js','velo/page-booking-summary.js']){const source=read(file);assert.ok(source.includes('observeTrackingSuspension()'),'actual startup scalar wiring '+file);assert.ok(!source.includes('settings.suspendGoogleAds'),'legacy Settings must not grant tracking '+file);}});
test('FS10',()=>{const {execFileSync}=require('node:child_process');const output=execFileSync(process.execPath,[path.join(root,'scripts/verify-head-suspension.js'),'--baseline-fs10'],{cwd:root,encoding:'utf8'});assert.match(output,/LIMITATION \| baseline FS10 actual-source purchase drains after producer ON/);console.log(output.trim());});
// Full page modules execute with inert SDK boundaries; no backend source loader.
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function callers(){
 const h=fixture(),pages={},flights=[],ui=new Map();let listeners=0;
 const original=h.bridge.onMessage;h.bridge.onMessage=f=>{listeners++;original(f);};
 const exports=Object.fromEntries([...read('velo/public/tracking.js').matchAll(/export function (\w+)/g)].map(m=>[m[1],h.c[m[1]]]));
 for(const name of ['masterPage','page-booking-search','page-booking-summary']){
  const callbacks=[],elements=new Map();
  const w=id=>{if(id==='#wbeEventBridge')return h.w();if(!elements.has(id))elements.set(id,{value:null,text:'',link:'',data:[],hide(){},show(){},collapse(){},expand(){},enable(){},disable(){},onClick(f){this.click=f;},onChange(f){this.change=f;},onItemReady(f){this.itemReady=f;},forEachItem(){}});return elements.get(id);};w.onReady=f=>callbacks.push(f);
  const context={...exports,$w:w,console:h.c.console,local:h.c.local,localStorage:{getItem(){return null;}},rendering:{env:'browser'},consentPolicy:{getCurrentConsentPolicy:async()=>({})},wixLocation:{query:{},url:'https://www.wanderlustcaribbean.com/',to(){}},wixWindow:{viewMode:'Site',scrollTo(){}},setTimeout:h.c.setTimeout,clearTimeout:h.c.clearTimeout,getRoomNames:async()=>({}),getAllSettings:()=>new Promise(()=>{}),observeTrackingSuspension(){const p=h.c.observeTrackingSuspension();flights.push(p);return p;}};
  vm.createContext(context);vm.runInContext(read('velo/'+name+'.js').replace(/^import .*;\n/gm,''),context);
  pages[name]={context,callbacks,elements,w};ui.set(name,elements);
 }
 return {...h,pages,flights,ui,get listeners(){return listeners;},async start(){for(const p of Object.values(pages))for(const f of p.callbacks)await f();await settle();h.pump();}};
}
test('FS01-A-actual-startup',async()=>{const h=callers();await h.start();h.ready();assert.equal(h.reads.length,1);assert.equal(h.posts.length,0);assert.equal(h.writes.length,0);assert.equal(vm.runInContext('microsoftReady',h.c),true);assert.equal(typeof h.pages['page-booking-search'].elements.get('#btnSearchRooms').click,'function');});
test('FS02-A-actual-scalar-matrix',async()=>{
 for(const value of [undefined,null,true,false,'','bad',{},[],2,1,' 1 ',0,' 0 ']){
  const h=callers();await h.start();h.ready();h.reads[0].resolve(value);await settle();h.pump();
  const allowed=value===0||value===' 0 ';
  assert.equal(h.posts.filter(p=>p.type==='wbe-datalayer-event').length,allowed?1:0);
  assert.equal(h.posts.filter(p=>p.kind==='route').length,allowed?1:0);
  assert.equal(h.posts.filter(p=>p.kind==='event').length,allowed?1:0);
  assert.equal(h.writes.length,allowed?1:0);
 }
 const h=callers();await h.start();h.ready();h.reads[0].reject(Error('inert scalar'));await settle();h.pump();assert.equal(h.posts.length,0);assert.equal(h.writes.length,0);
});
test('FS08-A-actual-shared-flight',async()=>{const h=callers();await h.start();assert.equal(h.flights.length,3);assert.ok(h.flights.every(p=>p===h.flights[0]));assert.equal(h.reads.length,1);assert.equal(h.listeners,1);h.ready();for(const p of Object.values(h.pages))h.c.initTracking(p.w);assert.equal(h.listeners,1);assert.equal(vm.runInContext('microsoftReady',h.c),true);assert.equal(h.posts.length,0);assert.equal(h.timers.size,0);});
test('FS02-B-FS08-B-actual-stale-completions',async()=>{for(const state of [true,null,false])for(const reject of [true,false]){const h=callers();await h.start();h.ready();h.c.setSuspendGoogleAds(state);const before=h.posts.length;reject?h.reads[0].reject(Error('late scalar')):h.reads[0].resolve(0);await settle();h.pump();assert.equal(vm.runInContext('_suspendGoogleAds',h.c),state);assert.equal(h.posts.length,before);assert.equal(typeof h.pages['page-booking-search'].elements.get('#btnSearchRooms').click,'function');assert.equal(typeof h.pages['page-booking-search'].elements.get('#datePickerCheckIn').change,'function');}});
test('FS05-A-post-ready-clear',()=>{const h=fixture();h.c.initTracking(h.w);h.ready();h.c.setSuspendGoogleAds(false);const post=h.bridge.postMessage;h.bridge.postMessage=p=>{if(p.kind==='event')throw Error('inert');post(p);};h.c.trackPurchase({transactionId:'old',value:0,currency:'EUR'});assert.equal(h.timers.size,1);const delayed=[...h.timers.values()];h.c.setSuspendGoogleAds(true);assert.equal(h.timers.size,0);assert.equal(vm.runInContext('microsoftQueue.length+googleQueue.length',h.c),0);h.bridge.postMessage=post;h.c.setSuspendGoogleAds(false);delayed.forEach(f=>f());h.c.trackPurchase({transactionId:'new',value:12,currency:'USD'});assert.deepEqual(h.posts.filter(p=>p.kind==='event').map(p=>p.payload.transaction_id),['new']);});
test('FS05-B-reentrant-probe',()=>{for(const throws of [false,true]){const h=fixture();h.c.setSuspendGoogleAds(false);let latched=0;const component=h.w(),post=component.postMessage;component.postMessage=p=>{if(p.type==='wbe-operational-probe'&&!latched){h.c.trackPurchase({transactionId:'old',value:1});latched++;h.c.setSuspendGoogleAds(true);if(throws)throw Error('inert');}return post(p);};h.c.initTracking(h.w);assert.equal(latched,1);noBusiness(h);assert.equal(h.posts.length,0);exhaustControl(h);assert.equal(latched,1);assert.equal(h.posts.length,0);}});
test('FS06-A-B-actual-negative-paths',async()=>{
 for(const mode of ['saved','click','server'])for(const transport of ['throw','missing']){
  const h=callers(),m=h.pages.masterPage,storage=new Map();
  const token='wcn1.'+'a'.repeat(64)+'.'+'b'.repeat(64);
  if(mode!=='click')storage.set('wbe_browser_negative_v1',JSON.stringify({negative:mode==='saved',token:mode==='server'?token:null}));
  m.context.local={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
  m.context.createGuestConsentBrowserContext=async()=>({status:'UNAVAILABLE'});
  m.context.readGuestConsentBrowserNegative=async()=>({status:'WITHDRAWN'});
  h.c.initTracking(h.w);h.c.setSuspendGoogleAds(false);h.c.trackPurchase({transactionId:'prior',value:1});
  const delayed=[...h.timers.values()];assert.ok(delayed.length);
  const flight=h.c.observeTrackingSuspension();await settle();h.pump();
  const originalW=m.context.$w,latchChecks=[];
  m.context.$w=id=>{if(id==='#wbeEventBridge'){
   latchChecks.push(vm.runInContext('microsoftWithdrawn',h.c));
   if(transport==='missing')throw Error('missing bridge');
   return {postMessage(){assert.equal(vm.runInContext('microsoftWithdrawn',h.c),true);throw Error('throwing bridge');}};
  }return originalW(id);};
  // Invoke actual custody onReady only: other startup paths independently covered.
  m.callbacks[0]();if(mode==='click')await m.elements.get('#btnWithdrawAdvertising').click();await settle();h.pump();
  assert.deepEqual(latchChecks,[true],'negative latched before actual throwing/missing bridge lookup; assertion outside swallowed transport catch');
  assert.equal(vm.runInContext('microsoftWithdrawn',h.c),true);
  noBusiness(h);exhaustControl(h);
  const before=h.posts.length;h.c.setSuspendGoogleAds(false);h.reads[0].resolve(0);await flight;h.ready();delayed.forEach(f=>f());h.c.trackPurchase({transactionId:'never',value:0,currency:'EUR'});
  assert.equal(h.posts.length,before);assert.equal(h.timers.size,0);assert.equal(vm.runInContext('microsoftQueue.length+googleQueue.length',h.c),0);
 }
});
test('FS07-A-successful-reentrant-new-head',()=>{
 const h=fixture();h.c.initTracking(h.w);h.ready();h.c.trackPurchase({transactionId:'old',value:1});let nested=false,newHead;
 h.bridge.postMessage=p=>{h.posts.push(p);if(p.kind==='event'&&!nested){nested=true;h.c.setSuspendGoogleAds(true);h.c.setSuspendGoogleAds(null);h.c.trackPurchase({transactionId:'new-held',value:0,currency:'EUR'});newHead=vm.runInContext('microsoftQueue[0]',h.c);}};
 h.c.setSuspendGoogleAds(false);
 assert.ok(newHead,'new unresolved work admitted after old queue cleared');
 assert.equal(vm.runInContext('microsoftQueue[0]',h.c),newHead,'FS07-A: successful old send must not shift newly enqueued head after reentrant ON/unresolved');
 assert.equal(h.posts.filter(p=>p.kind==='event').length,1);assert.equal(h.posts.filter(p=>p.type==='wbe-datalayer-event').length,0);
 h.c.setSuspendGoogleAds(false);
 const sent=h.posts.filter(p=>p.kind==='event');assert.equal(sent.length,2);assert.equal(sent[1],newHead);assert.equal(sent[1].payload.value,0);assert.equal(sent[1].payload.currency,'EUR');
 assert.equal(vm.runInContext('microsoftQueue.length',h.c),0);assert.equal(h.timers.size,0);
});
test('FS03-A-actual-handlers',async()=>{
 for(const branch of ['available','empty','unavailable']){
  const h=callers(),s=h.pages['page-booking-search'];
  Object.assign(s.context,{packageExistsForNights:async n=>{assert.equal(n,7);return true;},searchAvailability:async(ci,co)=>{assert.equal(ci.getDate(),7);assert.equal(co.getDate(),14);return {ok:true,requestedNights:7,results:branch==='empty'?[]:[{roomCode:'adventure_suite',maxQty:branch==='available'?1:0,status:branch==='available'?'full':'unavailable'}]};},getPackagesByNights:async()=>[],getPackageAmenities:async()=>({}),suggestAlternateDates:async()=>({suggestions:[]})});
  await h.start();h.ready();
  vm.runInContext("$w('#datePickerCheckIn').value=new Date(2026,8,7,12);$w('#datePickerCheckOut').value=new Date(2026,8,14,12);_hasCachedStayPricing=true;_cachedPerPersonStayTotal=100;",s.context);
  await s.w('#btnSearchRooms').click();await settle();h.pump();assert.equal(h.posts.length,0);
  h.reads[0].resolve(0);await settle();h.pump();
  const expected=[{event:'view_booking_search'},{event:'begin_booking',currency:'USD',value:200,check_in:'9/7/2026',check_out:'9/14/2026',nights:7}];
  if(branch!=='empty')expected.push({event:'room_view',room_code:'adventure_suite',nights:7});
  if(branch!=='available')expected.push({event:'search_no_results',nights:7,check_in:'2026-09-07'});
  assert.equal(JSON.stringify(h.posts.filter(p=>p.type==='wbe-datalayer-event').map(p=>p.payload)),JSON.stringify(expected));
  assert.equal(JSON.stringify(h.posts.filter(p=>p.kind==='event').map(p=>p.payload)),JSON.stringify(expected));
 }
 // Exact actual call statement, not the full booking callback or backend upload.
 const h=fixture();h.c.initTracking(h.w);h.ready();h.c.trackPurchase({transactionId:'zero',value:0,currency:'EUR'});
 const source=read('velo/page-booking-summary.js'),calls=[...source.matchAll(/trackPurchase\(\{[\s\S]*?\}\);/g)];assert.equal(calls.length,1);
 vm.runInNewContext(calls[0][0],{trackPurchase:h.c.trackPurchase,sharedBookingNumber:'second',grandTotal:12});h.c.setSuspendGoogleAds(false);
 assert.equal(JSON.stringify(h.posts.filter(p=>p.kind==='event').map(p=>p.payload)),JSON.stringify([{event:'purchase',transaction_id:'zero',value:0,currency:'EUR'},{event:'purchase',transaction_id:'second',value:12,currency:'USD'}]));
});
test('FS09-A-date-UI-pricing-independence',async()=>{
 const h=callers(),s=h.pages['page-booking-search'],p=h.pages['page-booking-summary'],nav=[],io=[];
 Object.assign(p.context,{getAllSettings:async()=>({}),getPackagesByNights:async()=>[{_id:'pkg',title:'Fixture',baseRate:100}],readPricingQuote:async(...a)=>{io.push(a);return {packageTitle:'Locked fixture',baseRate:100,priceModifier:1,totalPerPerson:700};},wixData:{query(name){assert.equal(name,'Rooms');return {hasSome(){return this;},limit(){return this;},async find(){return {items:[]};}};}}});
 p.context.wixLocation.query={rc:'adventure_suite:1:2:0',ci:'2026-09-07',co:'2026-09-14',pkg:'pkg',quote:'inert-quote'};
 s.context.wixLocation.to=url=>nav.push(url);
 await h.start();h.reads[0].reject(Error('failed tracking observation'));await settle();h.pump();
 const ci=vm.runInContext('new Date(2026,8,7,12)',s.context);s.w('#datePickerCheckIn').value=ci;
 s.w('#datePickerCheckIn').change({target:{value:ci}});assert.equal(s.w('#datePickerCheckOut').value.getTime(),ci.getTime());
 const later=vm.runInContext('new Date(2026,8,14,12)',s.context);s.w('#datePickerCheckOut').value=later;s.w('#datePickerCheckIn').change({target:{value:ci}});assert.equal(s.w('#datePickerCheckOut').value,later);
 s.w('#btnSummary').click();assert.equal(s.w('#statusText').html,"<span style=\"font-family: 'Inter Semi Bold', 'Inter', sans-serif; font-size: 20px;\">Please select one or more rooms to continue booking.</span>");
 vm.runInContext("_selections=[{roomCode:'adventure_suite',qty:1,numGuests:2,roomFee:0,availableCheckIn:'2026-09-07',availableCheckOut:'2026-09-14'}];_selectedPackage={_id:'pkg',pricingQuoteToken:'inert-quote'};",s.context);
 s.w('#btnSummary').click();assert.deepEqual(nav,['/booking-summary?rc=adventure_suite%3A1%3A2%3A0&ci=2026-09-07&co=2026-09-14&pkg=pkg&quote=inert-quote']);
 assert.equal(io.length,1);assert.equal(io[0][0],'inert-quote');assert.equal(io[0][1],'pkg');
 for(const [id,text] of Object.entries({checkInDisplay:'9/7/2026',checkOutDisplay:'9/14/2026',packageCost:'$700.00',packageTotal:'$1,400.00',propertyFeeText:'$70.00',totalVatText:'$175.00',grandTotal:'$1,645.00',packageSummary:'September 7th, 2026 to September 14th, 2026 * 7 nights * 2 guests',packageName:'Locked fixture'}))assert.equal(p.w('#'+id).text,text,id);
 for(const id of ['#btnContinue','#btnApplyPromo'])assert.equal(typeof p.w(id).click,'function');
 await p.w('#btnContinue').click();assert.equal(p.w('#bookingStatus').text,'Please enter the required information to complete your booking');assert.equal(h.posts.length,0);
 // Exact baseline suffix includes all pricing, booking, upload and redirect code;
 // equality is source preservation, not execution of full booking or upload.
 const {execFileSync}=require('node:child_process');
 const file='velo/page-booking-summary.js',source=read(file),baseline=execFileSync('git',['show','49fd3f767e66dff771d58a0177b9ce7d5016283d:'+file],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n');
 const anchor='async function initSummary() {',end='  const suspend = String(settings.suspendGoogleAds)';
 assert.ok(baseline.includes(end));assert.equal(source.slice(source.indexOf(anchor),source.indexOf('  initRoomRepeater();')).trimEnd(),baseline.slice(baseline.indexOf(anchor),baseline.indexOf(end)).trimEnd());
 const suffix='  initRoomRepeater();';assert.equal(source.slice(source.indexOf(suffix)),baseline.slice(baseline.indexOf(suffix)));
});
// Actual page startup and actual two-head receipts; only delivery is paused.
function captureLifecycle(){
 const h=callers(),held=[],storage=new Map();let receive,attempts=0;
 const register=h.bridge.onMessage;
 h.bridge.onMessage=f=>{receive=f;register(e=>{
  if(e.data.type==='wbe-operational-ack'&&e.data.phase==='state'&&e.data.state==='OFF')held.push(e);
  else f(e);
 });};
 h.c.local.getItem=k=>storage.get(k)||null;
 h.c.local.setItem=(k,v)=>{h.writes.push([k,v]);storage.set(k,v);};
 h.c.local.removeItem=k=>storage.delete(k);
 h.c.console.log=(label)=>{if(label==='[WBE-TRACKING] raw browser URL:')attempts++;};
 h.c.wixLocationFrontend.query={gclid:'g',gbraid:'gb',wbraid:'wb',msclkid:'ms'};
 return {...h,held,get captureAttempts(){return attempts;},release(receiver){
  const i=held.findIndex(e=>e.data.receiver===receiver);assert.ok(i>=0,'actual held '+receiver);
  const e=held.splice(i,1)[0];receive(e);h.pump();return e;
 },replay(e){receive(e);h.pump();}};
}
for(const first of ['google','microsoft'])test('FC01-delayed-'+first,async()=>{
 const h=captureLifecycle();await h.start();h.ready();h.reads[0].resolve(0);await settle();h.pump();
 assert.equal(h.held.length,2);assert.equal(h.writes.length,1);assert.equal(h.captureAttempts,1);assert.equal(h.posts.length,0);
 const last=first==='google'?'microsoft':'google',a=h.release(first);
 assert.equal(h.writes.length,1);assert.equal(h.captureAttempts,1);assert.equal(h.posts.length,0);
 const b=h.release(last);assert.equal(h.writes.length,1);assert.equal(h.captureAttempts,1);
 const [key,raw]=h.writes[0],record=JSON.parse(raw);assert.equal(key,'wl_click_attribution');
 assert.deepEqual([record.gclid,record.gbraid,record.wbraid,record.msclkid],['g','gb','wb','ms']);
 assert.equal(record.landingUrl,h.c.wixLocationFrontend.url);assert.ok(Number.isFinite(Date.parse(record.capturedAt)));
 const before=JSON.stringify(h.posts);h.replay(a);h.replay(b);
 for(const p of Object.values(h.pages))h.c.initTracking(p.w);
 h.tick();assert.equal(h.captureAttempts,1);assert.equal(h.writes.length,1);assert.equal(JSON.stringify(h.posts),before);
 assert.ok(h.controls.every(p=>!p.type.includes('consent')));
});
for(const first of ['google','microsoft'])for(const negative of ['ON','withdrawal','attachment'])test('FC02-'+negative+'-'+first,async()=>{
 const h=captureLifecycle();await h.start();h.ready();h.reads[0].resolve(0);await settle();h.pump();h.release(first);
 if(negative==='ON')h.c.setSuspendGoogleAds(true);
 else if(negative==='withdrawal')h.c.withdrawTracking();
 else h.c.initTracking(()=>({postMessage(){},onMessage(){}}));
 h.release(first==='google'?'microsoft':'google');h.tick();assert.equal(h.writes.length,1);assert.equal(h.captureAttempts,1);assert.equal(h.posts.length,0);
});
test('FC03-stale-ACK-fresh-OFF-progress',async()=>{
 const h=captureLifecycle();await h.start();h.ready();h.reads[0].resolve(0);await settle();h.pump();
 assert.equal(h.held.length,2);h.c.setSuspendGoogleAds(true);
 h.release('google');h.release('microsoft');assert.equal(h.captureAttempts,1);assert.equal(h.posts.length,0);
 const p=h.c.observeTrackingSuspension();await settle();h.reads[1].resolve(0);await p;h.pump();
 assert.equal(h.captureAttempts,2);assert.equal(h.posts.length,0);h.release('microsoft');assert.equal(h.captureAttempts,2);assert.equal(h.posts.length,0);h.release('google');
 assert.equal(h.captureAttempts,2);assert.equal(h.writes.length,1);
 // Fresh observations retain first-touch storage without repeated-init capture.
 const raw=h.writes[0][1];h.c.wixLocationFrontend.query={gclid:'replacement'};
 h.c.setSuspendGoogleAds(false);h.release('google');h.release('microsoft');
 assert.equal(h.captureAttempts,3);assert.equal(h.writes.length,1);assert.equal(h.writes[0][1],raw);
});
test('FC04-scalar-OFF-no-head',async()=>{
 const h=captureLifecycle();await h.start();assert.equal(h.writes.length,0);
 h.reads[0].resolve(0);await settle();h.pump();
 assert.equal(h.writes.length,1);assert.equal(h.captureAttempts,1);assert.equal(h.posts.length,0);
 const record=JSON.parse(h.writes[0][1]);assert.deepEqual([record.gclid,record.gbraid,record.wbraid,record.msclkid],['g','gb','wb','ms']);
 for(let i=0;i<6;i++)h.tick();
 assert.equal(h.writes.length,1);assert.equal(h.captureAttempts,1);assert.equal(h.posts.length,0);assert.equal(h.timers.size,0);
});
for(const throws of [false,true])test('FS07-B-old-ON-control-'+(throws?'throw':'return'),()=>{
 const h=fixture();h.c.initTracking(h.w);h.ready();h.c.setSuspendGoogleAds(false);
 h.c.setSuspendGoogleAds(null);h.c.trackPurchase({transactionId:'old-before-ON',value:9,currency:'USD'});
 const component=h.w(),post=component.postMessage;let entered=false,newHead,newGoogle;
 component.postMessage=function(d){
  if(!entered&&d.type==='wbe-operational-state'&&d.state==='ON'){
   entered=true;
   h.c.setSuspendGoogleAds(null);
   h.c.trackPurchase({transactionId:'new-after-ON-control',value:0,currency:'EUR'});
   newHead=vm.runInContext("microsoftQueue.find(x=>x.payload.transaction_id==='new-after-ON-control')",h.c);
   newGoogle=vm.runInContext("googleQueue.find(x=>x.transaction_id==='new-after-ON-control')",h.c);
   assert.ok(newHead,'new work actually admitted under newer UNRESOLVED');
   if(throws)throw Error('inert after reentrant control');
  }
  return post(d);
 };
 h.c.setSuspendGoogleAds(true);
 assert.ok(entered);assert.equal(vm.runInContext('_suspendGoogleAds',h.c),null);
 assert.equal(vm.runInContext('microsoftQueue[0]',h.c),newHead,'CAUSAL: older ON control return must not clear purchase admitted under newer UNRESOLVED');
 assert.equal(vm.runInContext('googleQueue[0]',h.c),newGoogle);
 assert.equal(vm.runInContext('microsoftQueue.length+googleQueue.length',h.c),2,'ON clears only OLD work');
 h.c.trackPurchase({transactionId:'second-after-ON-control',value:12,currency:'USD'});
 h.c.setSuspendGoogleAds(false);
 const sent=h.posts.filter(x=>x.kind==='event');assert.equal(sent[0],newHead);
 assert.deepEqual(sent.map(x=>[x.payload.transaction_id,x.payload.value,x.payload.currency]),[['new-after-ON-control',0,'EUR'],['second-after-ON-control',12,'USD']]);
 assert.deepEqual(h.posts.filter(x=>x.type==='wbe-datalayer-event').map(x=>[x.payload.transaction_id,x.payload.value,x.payload.currency]),[['new-after-ON-control',0,'EUR'],['second-after-ON-control',12,'USD']]);
 h.c.withdrawTracking();h.c.setSuspendGoogleAds(false);h.c.trackPurchase({transactionId:'withdrawn',value:0,currency:'EUR'});noBusiness(h);
});
async function run(){
 let failed=0;const executed=[];
 const watchdog=setTimeout(()=>{console.error('FAIL | watchdog | unresolved fixture; completed='+JSON.stringify(executed));process.exit(1);},10000);
 try {
  for(const [id,f] of tests){try{await f();console.log('PASS | '+id);}catch(e){failed++;console.error('FAIL | '+id+' | '+e.stack);}executed.push(id);}
  assert.equal(executed.length,tests.length);assert.equal(new Set(executed).size,tests.length);
  console.log(JSON.stringify({executed,failed}));process.exitCode=failed?1:0;
 } finally {clearTimeout(watchdog);}
}
if(require.main===module)run();module.exports={fixture,test,tests,run,read};
