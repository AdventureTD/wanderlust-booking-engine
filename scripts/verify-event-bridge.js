'use strict';
// Actual producer, relay and head; all browser/provider boundaries inert.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const inline = p => read(p).match(/<script>([\s\S]*?)<\/script>/)[1];
const business = data => data.type === 'wbe-operational-business' ? data.message : data;
// Queue browser transport separately from timers; never fabricate head receipts.
const crypto = require('node:crypto').webcrypto;
const site='https://www.wanderlustcaribbean.com', origin='https://bridge.synthetic.invalid';
function setup(configured=true) {
  const calls=[], messages=[], google=[], listeners={}, timers=new Map(), attempts=[]; let loader, receive, ready=false, timerId=0, failures=0, afterFailures=0, onPush=null;
  const queue=[];let pumping=false;
  const pump=()=>{if(pumping)return;pumping=true;try{let n=0;while(queue.length){assert.ok(++n<500,'bounded queued transport');queue.shift()();}}finally{pumping=false;}};
  const tick=()=>{const batch=[...timers.values()];timers.clear();batch.forEach(f=>f());pump();};
  const frame={}; const parent={location:{origin:site,pathname:'/',href:site+'/'},localStorage:{getItem(){return null;}},addEventListener(t,f){(listeners[t] ||= []).push(f);}};
  const emit=e=>{(listeners.message||[]).forEach(f=>f(e));pump();};
  parent.postMessage=(data,target)=>{messages.push({data:JSON.parse(JSON.stringify(data)),target});queue.push(()=>{if(!ready)return;if(receive)receive({data});emit({data,origin,source:frame});});};
  frame.parent=parent;frame.postMessage=(data,target)=>{assert.equal(target,origin);if(ready)queue.push(()=>frame.onmessage({data,origin:site,source:parent}));};
  vm.runInNewContext(inline('velo/custom-code/event-bridge-iframe.html'),{window:frame,crypto,Uint8Array});
  const bridge={onMessage(f){receive=f;},postMessage(data){const message=business(data);if(message.type==='wbe-microsoft-message'){attempts.push(JSON.parse(JSON.stringify(message)));if(failures>0){failures--;throw Error('inert send failure');}}if(ready)queue.push(()=>frame.onmessage({data,origin:site,source:parent}));if(message.type==='wbe-microsoft-message' && afterFailures>0){afterFailures--;throw Error('inert post-delivery failure');}}};
  const $w=()=>bridge;
  const producer={crypto,Uint8Array,local:{getItem(){return null;}},wixLocationFrontend:{url:site+'/'},console:{log(){},warn(){},error(){}},setTimeout(f,ms){if(ms===0){queue.push(f);return ++timerId;}timers.set(++timerId,f);return timerId;},clearTimeout(id){timers.delete(id);}};
  vm.createContext(producer);vm.runInContext(read('velo/public/tracking.js').replace(/^import .*;\r?\n/gm,'').replace(/export /g,''),producer);
  producer.setSuspendGoogleAds(false); // Explicit OFF for historical normal-path assertions only.
  Object.assign(producer,{crypto,Uint8Array});
  const frameElement={contentWindow:frame,addEventListener(){}};
  const document={readyState:'complete',addEventListener(t,f){(listeners[t] ||= []).push(f);},getElementById(id){return id==='wbeEventBridge'?frameElement:null;},createElement(){return {};},getElementsByTagName(){return [{parentNode:{insertBefore(s){loader=s;}}}];}};
  parent.window=parent;parent.document=document;parent.console=producer.console;
  Object.assign(parent,{crypto,Uint8Array,setTimeout:producer.setTimeout,clearTimeout:producer.clearTimeout});
  parent.UET=function(o){calls.push(['constructor',o.ti,o.tm,o.enableAutoSpaTracking]);this.push=(...a)=>{calls.push(JSON.parse(JSON.stringify(a)));if(onPush)onPush(a);};};
  vm.runInNewContext(inline('velo/custom-code/microsoft-uet-and-events.html').replace("var MICROSOFT_BRIDGE_ORIGIN = '';",`var MICROSOFT_BRIDGE_ORIGIN = '${configured?origin:''}';`),parent);
  vm.runInNewContext(inline('velo/custom-code/google-tag-and-consent.html').replace("var OPERATIONAL_BRIDGE_ORIGIN = '';",`var OPERATIONAL_BRIDGE_ORIGIN = '${configured?origin:''}';`),parent);
  const push=parent.dataLayer.push;parent.dataLayer.push=function(value){if(value[0]==='event')google.push({event:value[1],...value[2]});return push.call(this,value);};
  for(const name of [...read('velo/public/tracking.js').matchAll(/export function (\w+)/g)].map(m=>m[1])){const original=producer[name];producer[name]=(...args)=>{const result=original(...args);pump();return result;};}
  return {calls,messages,google,producer,parent,frame,emit,pump,bridge,dispatch(type,event){(listeners[type]||[]).forEach(f=>f(event));pump();},$w,tick,timers,attempts,onPush(f){onPush=f;},failAfter(n){afterFailures=n;},fail(n){failures=n;},observe(p){producer.wixLocationFrontend.url=site+p;parent.location.pathname=p.split(/[?#]/)[0];producer.observeMicrosoftPage($w);},connect(){ready=true;tick();},complete(){assert.ok(loader);const f=loader.onload;f.call(loader);f.call(loader);pump();}};
}
function retryRegression(){
 const h=setup();h.observe('/');h.connect();h.complete();h.fail(1);
 h.producer.trackPurchase({transactionId:'retained-final',value:0,currency:'EUR'});
 assert.equal(h.calls.filter(c=>c[1]==='purchase').length,0);
 assert.equal(h.timers.size,1,'F05: post-ready failure schedules autonomous retry');
 h.tick();h.tick();assert.deepEqual(h.calls.filter(c=>c[1]==='purchase'),[['event','purchase',{page_path:'/',revenue_value:0,currency:'EUR',transaction_id:'retained-final'}]]);
 assert.equal(h.attempts.at(-1).id,h.attempts.at(-2).id,'retry preserves original transport identity');
 const b=setup();b.observe('/');b.connect();b.complete();b.fail(100);b.producer.trackPurchase({transactionId:'bounded',value:1});
 for(let i=0;i<20;i++)b.tick();assert.equal(b.timers.size,0,'F05: retry budget finite');assert.ok(b.attempts.length<=6);
 const delivered=setup();delivered.observe('/');delivered.connect();delivered.complete();delivered.failAfter(1);
 delivered.producer.trackPurchase({transactionId:'delivered-once',value:7,currency:'EUR'});delivered.tick();
 assert.equal(delivered.calls.filter(c=>c[1]==='purchase').length,1,'same transport ID prevents duplicate after post-delivery failure');
 const denied=setup();denied.observe('/');denied.connect();denied.complete();denied.failAfter(1);
 denied.onPush(()=>{denied.parent.wbeAdvertisingWithdrawn=true;denied.emit({data:{}});});
 denied.producer.trackPurchase({transactionId:'deny-during-send',value:3});
 assert.equal(denied.timers.size,0,'F06: reentrant withdrawal followed by throw cannot schedule retry');
 console.log('PASS | F05 retained purchase autonomous bounded retry');
}
function withdrawalRegression(){
 for(const connected of [false,true]){
  const h=setup();h.observe('/');if(connected){h.connect();h.complete();h.fail(1);}
  h.producer.trackPurchase({transactionId:'withdraw-retained',value:42,currency:'EUR'});
  assert.ok(vm.runInContext('microsoftQueue.length',h.producer)>0);
  h.parent.wbeAdvertisingWithdrawn=true;h.emit({data:{}});
  if(!connected)h.connect();
  assert.equal(vm.runInContext('microsoftQueue.length',h.producer),0,'F06: withdrawal clears producer queue');
  assert.equal(h.timers.size,0,'F06: withdrawal cancels future retries');
  const before=h.attempts.length;h.parent.wbeAdvertisingWithdrawn=false;
  h.observe('/booking-summary');h.producer.trackPurchase({transactionId:'cannot-revive',value:1});
  for(let i=0;i<5;i++)h.tick();assert.equal(h.attempts.length,before,'F06: private producer latch prevents new work');
  assert.equal(vm.runInContext('microsoftQueue.length',h.producer),0);
  assert.equal(h.calls.filter(c=>c[1]==='purchase').length,0);
 }
 console.log('PASS | F06 withdrawal clears producer work and cancels retries');
}
function routeCoverage(){
 for(const page of ['/','/wanderlust-booking','/booking-summary']){
  const h=setup();h.observe(page);h.connect();h.complete();
  assert.deepEqual(h.calls,[['constructor','17524068','wix_ui',false],['pageLoad']],'R01 fresh direct landing '+page);
 }
 const q=setup();q.observe('/');q.connect();q.complete();
 q.observe('/booking-summary?booking=first');q.observe('/booking-summary?booking=second');
 assert.deepEqual(q.calls.slice(2),[['event','page_view',{page_path:'/booking-summary'}],['event','page_view',{page_path:'/booking-summary'}]],'R08 distinct Summary query observations retain distinct visits without query');
 const h=setup();h.observe('/');h.connect();h.complete();
 h.onPush(args=>{if(args[0]==='event' && args[1]==='page_view'){h.parent.wbeAdvertisingWithdrawn=true;h.emit({data:{}});}});
 h.observe('/booking-summary');h.parent.wbeAdvertisingWithdrawn=false;h.observe('/');
 assert.equal(h.calls.filter(c=>c[1]==='page_view').length,1,'R12 first manual route withdrawal prevents next route');
 assert.equal(vm.runInContext('microsoftQueue.length',h.producer),0);
 console.log('PASS | R01 direct landings, R08 Summary observations, R12 first-route reentrant withdrawal (bounded local)');
}
function googleCompatibility(){
 const h=setup();h.connect();const dataLayer=h.google, iframe=h.frame;
 const pushDataLayer=payload=>h.producer.pushDataLayer(payload), initTracking=w=>h.producer.initTracking(w);
 function check(n,a,e){assert.equal(JSON.stringify(a),JSON.stringify(e),n);console.log('PASS | '+n);}
pushDataLayer({ event: 'view_booking_search' });
check('dropped before initTracking', dataLayer.length, 0);

initTracking(h.$w);
pushDataLayer({ event: 'view_booking_search' });
pushDataLayer({ event: 'begin_booking', nights: 7, value: 2590, currency: 'USD' });
pushDataLayer({ event: 'room_view', room_code: 'adventure_suite', nights: 7 });
check('3 events reached dataLayer', dataLayer.length, 3);
check('begin_booking params intact', dataLayer[1], { event: 'begin_booking', nights: 7, value: 2590, currency: 'USD' });
check('room_view params intact', dataLayer[2], { event: 'room_view', room_code: 'adventure_suite', nights: 7 });

iframe.onmessage({ data: { type: 'other' } });
check('unrelated iframe message ignored', dataLayer.length, 3);

}
// Extract exact production statements with unique anchors; no copied handler logic.
function sourceSlice(file, start, end) {
 const text=read(file).split('\r').join('');assert.equal(text.split(start).length,2,'unique start '+start);assert.equal(text.split(end).length,2,'unique end '+end);
 const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(b>a);return text.slice(a,b);
}
function masterFixture(h, env='browser') {
 const callbacks=[],trace=[];
 const w=id=>id==='#wbeEventBridge'?h.$w(id):{onClick(){}};w.onReady=f=>callbacks.push(f);
 const context={$w:w,rendering:{env},local:h.producer.local,console:h.producer.console,
  observeMicrosoftPage:h.producer.observeMicrosoftPage,initTracking:h.producer.initTracking,
  captureClickIds:h.producer.captureClickIds,setSuspendGoogleAds:h.producer.setSuspendGoogleAds,
  withdrawTracking:h.producer.withdrawTracking,
  observeTrackingSuspension(){trace.push('settings');return new Promise(()=>{});}};
 vm.runInNewContext(read('velo/masterPage.js').split('\n').filter(line=>!line.startsWith('import ')).join('\n'),context);
 return {trace,ready(p){h.producer.wixLocationFrontend.url=site+p;h.parent.location.pathname=p.split(/[?#]/)[0];callbacks.forEach(f=>f());}};
}
function handlerCoverage() {
 const search='velo/page-booking-search.js', summary='velo/page-booking-summary.js';
 const selection=sourceSlice(search,'function roomSelectionRequiredMessage(selections) {','function syncSummaryButtonWithResults');
 const registration=sourceSlice(search,"  if (tryFind('btnSummary')) {","  const rep = tryFind('searchResultsRepeater');\n  if (rep && typeof rep.onItemReady === 'function') {");
 const rooms=[{roomCode:'fixture_suite',qty:2,numGuests:3,roomFee:7,availableCheckIn:'2027-01-02T12:00:00',availableCheckOut:'2027-01-09T12:00:00'}];
 const pkg={_id:'fixture-package',pricingQuoteToken:'public-inert-quote'};
 const expected='/booking-summary?rc=fixture_suite%3A2%3A3%3A7&ci=2027-01-02&co=2027-01-09&pkg=fixture-package&quote=public-inert-quote';
 function searchFixture(h, selections=rooms, selected=pkg, mode='success') {
  let click;const navigation=[],texts=[],storage=[],sentinel=Error('inert navigation throw');
  const location={to(...args){assert.equal(this,location,'original navigation receiver');navigation.push(args);if(mode==='throw')throw sentinel;return mode==='cancel'?false:'navigation-result';}};
  const original=location.to,button={link:'/editor-link',onClick(f){click=f;}};
  vm.runInNewContext(selection+registration,{_selections:selections,_selectedPackage:selected,summaryUrl:'/booking-summary',
   tryFind:()=>button,$w:()=>button,safeText:t=>texts.push(t),console:h.producer.console,wixLocation:location,
   localStorage:{setItem(k,v){storage.push([k,v]);}}});
  assert.equal(button.link,'');assert.equal(location.to,original,'no navigation wrapper');
  return {click,navigation,texts,storage,sentinel};
 }
 for(const mode of ['success','cancel','throw','selection','package','quote']) {
  const h=setup(),m=masterFixture(h);m.ready('/wanderlust-booking');h.connect();h.complete();
  const f=searchFixture(h,mode==='selection'?[]:rooms,mode==='package'?null:mode==='quote'?{_id:pkg._id}:pkg,mode);
  if(mode==='throw')assert.throws(()=>f.click(),e=>e===f.sentinel);else assert.equal(f.click(),undefined,'actual handler return preserved');
  assert.deepEqual(h.calls,[['constructor','17524068','wix_ui',false],['pageLoad']],'invocation is not destination readiness');
  const invalid=['selection','package','quote'].includes(mode);
  assert.deepEqual(f.navigation,invalid?[]:[[expected]],'exact navigation arguments and call count');
  if(invalid){assert.equal(f.storage.length,0);assert.deepEqual(f.texts,[mode==='selection'?'Please select one or more rooms to continue booking.':mode==='package'?'Please select a package above before continuing.':'Unable to lock this package price. Please search again.']);}
  else assert.deepEqual(f.storage,[['_wbe_rc','fixture_suite:2:3:7'],['_wbe_ci','2027-01-02'],['_wbe_co','2027-01-09'],['_wbe_pkg',pkg._id],['_wbe_quote',pkg.pricingQuoteToken]]);
  if(mode==='success'){
   m.ready(expected);h.producer.trackPurchase({transactionId:'handler-original',value:42,currency:'USD'});
   assert.deepEqual(h.calls.slice(2),[['event','page_view',{page_path:'/booking-summary'}],['event','purchase',{page_path:'/booking-summary',revenue_value:42,currency:'USD',transaction_id:'handler-original'}]],'destination observation precedes business event without query leakage');
  }
 }
 // Both actual redirect statement blocks, not the booking writer or invoice branch authority.
 const delayed=sourceSlice(summary,'        setTimeout(function () {',"      } else {\n        safeText('bookingStatus', 'Booking confirmed! Taking you home...');");
 const immediate=sourceSlice(summary,"      } else {\n        safeText('bookingStatus', 'Booking confirmed! Taking you home...');","      }\n    } catch (e) {\n      console.error('[WBE-FRONTEND] createBooking/invoice flow error:'").split('\n').slice(1).join('\n');
 for(const [label,code] of [['delayed',delayed],['immediate',immediate]]) {
  const h=setup(),m=masterFixture(h);m.ready('/booking-summary');h.connect();h.complete();
  const timers=[],navigation=[],texts=[];const location={to(...args){assert.equal(this,location);navigation.push(args);return 'unchanged-return';}};
  vm.runInNewContext(code,{setTimeout(f,ms){timers.push({f,ms});},wixLocation:location,console:h.producer.console,safeText:(...a)=>texts.push(a)});
  assert.equal(h.calls.length,2,'Summary branch invocation is not completion');
  if(label==='delayed'){assert.equal(navigation.length,0);assert.equal(timers.length,1);assert.equal(timers[0].ms,2000);timers[0].f();}
  else {assert.equal(timers.length,0);assert.deepEqual(texts,[['bookingStatus','Booking confirmed! Taking you home...']]);}
  assert.deepEqual(navigation,[[site]]);assert.equal(h.calls.length,2,'timer/navigation does not synthesize view');
  m.ready('/');assert.deepEqual(h.calls.slice(2),[['event','page_view',{page_path:'/'}]]);
  const fresh=setup(),freshMaster=masterFixture(fresh);freshMaster.ready('/');fresh.connect();fresh.complete();
  assert.deepEqual(fresh.calls,[['constructor','17524068','wix_ui',false],['pageLoad']],'new document uses initial load instead');
 }
 // Non-navigation fixture changes real location inputs, dispatches anchor/history signals,
 // but intentionally does NOT invent an ordinary page-ready callback. Live Wix classification remains a gate.
 const h=setup(),m=masterFixture(h);m.ready('/booking-summary');h.connect();h.complete();
 for(const suffix of ['#details','?quote=public-inert-query']) {
  h.producer.wixLocationFrontend.url=site+'/booking-summary'+suffix;
  h.parent.location.hash=suffix[0]==='#'?suffix:'';h.parent.location.search=suffix[0]==='?'?suffix:'';
  // Actual code installs only its own message/denial listeners; no router completion is inferred.
  assert.doesNotMatch(read('velo/masterPage.js')+read('velo/public/tracking.js'),/addEventListener\s*\(\s*['"](?:hashchange|popstate)['"]|\.onChange\s*\(|history\.(?:pushState|replaceState)\s*=/);
  h.dispatch(suffix[0]==='#'?'hashchange':'popstate',{oldURL:site+'/booking-summary',newURL:h.producer.wixLocationFrontend.url});
  assert.equal(h.calls.length,2,'non-navigation URL mutation emits no observation');
 }
 m.ready('/booking-summary?quote=public-inert-query');
 assert.deepEqual(h.calls.slice(2),[['event','page_view',{page_path:'/booking-summary'}]],'same query URL with ordinary readiness is a distinct observed visit');
 for(const order of ['iframe-first','uet-first']) {
  const h=setup(),m=masterFixture(h);m.ready('/wanderlust-booking');
  if(order==='iframe-first')h.connect();else h.complete();
  h.producer.trackPurchase({transactionId:'master-first',value:0,currency:'EUR'});
  m.ready('/booking-summary?quote=public-inert-quote');
  h.producer.trackPurchase({transactionId:'master-second',value:12,currency:'USD'});m.ready('/');
  if(order==='iframe-first')h.complete();else h.connect();
  assert.deepEqual(h.calls,[['constructor','17524068','wix_ui',false],['pageLoad'],['event','purchase',{page_path:'/',revenue_value:0,currency:'EUR',transaction_id:'master-first'}],['event','purchase',{page_path:'/',revenue_value:12,currency:'USD',transaction_id:'master-second'}]],'actual master -> producer -> iframe -> head retains original financial order; approved current-page association');
  assert.equal(m.trace.length,3,'master settings boundary reached without waiting to observe');
  const routes=h.messages.filter(x=>business(x.data).kind==='route');assert.ok(routes.length>0);
  const last=routes.at(-1);h.emit({data:last.data,origin,source:h.frame});assert.equal(h.calls.length,4,'exact transport replay does not duplicate');
 }
 const ssr=setup(),ssrMaster=masterFixture(ssr,'backend');ssrMaster.ready('/');ssr.connect();ssr.complete();assert.deepEqual(ssr.calls,[]);
 console.log('PASS | F04 R02/R03 actual Search registration: success, cancel, throw, selection, package, quote');
 console.log('PASS | F04 R04 actual Summary immediate/delayed redirect blocks; R09 bounded non-navigation classification');
 console.log('PASS | F04 R11 actual master -> producer -> iframe -> head, both readiness orders; SSR zero observations');
}
function run(){
 googleCompatibility();retryRegression();withdrawalRegression();routeCoverage();handlerCoverage();
 const disabled=setup(false);disabled.observe('/');disabled.connect();disabled.complete();assert.deepEqual(disabled.calls,[],'unknown topology cannot activate UET');
 const early=setup();early.observe('/wanderlust-booking');early.connect();early.producer.trackPurchase({transactionId:'first',value:0,currency:'EUR'});early.producer.trackPurchase({transactionId:'second',value:12,currency:'USD'});early.observe('/booking-summary');early.observe('/');early.complete();assert.deepEqual(early.calls.slice(2),[['event','purchase',{page_path:'/',revenue_value:0,currency:'EUR',transaction_id:'first'}],['event','purchase',{page_path:'/',revenue_value:12,currency:'USD',transaction_id:'second'}]],'pre-UET coalescing retains purchase order and zero value');
 const h=setup();assert.equal(typeof h.producer.observeMicrosoftPage,'function','CAUSAL: missing actual ordinary route adapter');
 h.observe('/wanderlust-booking?token=omit#private');h.producer.trackPurchase({transactionId:'fixture-original',value:42,currency:'USD'});h.observe('/booking-summary');h.observe('/');h.complete();assert.deepEqual(h.calls,[],'loader waits for trusted route');h.connect();
 assert.deepEqual(h.calls,[['constructor','17524068','wix_ui',false],['pageLoad'],['event','purchase',{page_path:'/',revenue_value:42,currency:'USD',transaction_id:'fixture-original'}]]);
 h.observe('/booking-summary');h.observe('/');h.observe('/');
 assert.deepEqual(h.calls.slice(-3),[['event','page_view',{page_path:'/booking-summary'}],['event','page_view',{page_path:'/'}],['event','page_view',{page_path:'/'}]]);
 const route=h.messages.filter(x=>business(x.data).type==='wbe-microsoft-message').at(-1);const before=h.calls.length;
 h.emit({data:route.data,origin,source:h.frame});assert.equal(h.calls.length,before,'repeat observation ignored');
 for(const bad of [{origin:'https://evil.invalid',source:h.frame},{origin,source:{}}])h.emit({data:{...route.data,id:'bad'},...bad});
 for(const data of [{...route.data,id:'bad',extra:true},{...route.data,id:'bad',version:2},{...route.data,id:'bad',page_path:'/?token=bad'},{source:'wbe-event-bridge',payload:{event:'purchase'}}])h.emit({data,origin,source:h.frame});
 assert.equal(h.calls.length,before,'trusted rejection zero sends');
 const n=h.messages.length;for(const bad of [{origin:'https://evil.invalid',source:h.parent},{origin:site,source:{}}])h.frame.onmessage({data:route.data,...bad});assert.equal(h.messages.length,n,'first hop rejection');
 assert.ok(h.google.every(p=>p.event!=='page_view' && !('page_path' in p)),'route excluded from Google fallback');
 h.parent.wbeAdvertisingWithdrawn=true;h.observe('/booking-summary');h.producer.trackPurchase({transactionId:'denied',value:99});assert.equal(h.calls.length,before,'withdrawal zero sends');
 console.log('PASS | bounded route tracer (not full R01-R12 acceptance); current-route coalescing, original purchase fields, distinct visits, trusted rejection, withdrawal');
}
if(require.main===module)run();module.exports={run,setup};
