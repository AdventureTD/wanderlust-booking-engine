'use strict';
// Provider-free actual Head/iframe/worker. Only the inert Wix transport is delayed;
// this models the observed ordering, not undocumented Wix queue internals.
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
let support=fs.readFileSync(__dirname+'/click-attribution-corrections.cjs','utf8').split("test('partitioned page ID")[0];
support=support.replace('policyRead}={})','policyRead, loadDelay=0}={})');
support=support.replace("const component={onMessage:f=>{onMessage=f;},postMessage:d=>iframe.window.onmessage({data:d,source:parent,origin})};", `
 const sent=[], queued=[];let loaded=loadDelay===0;
 const deliverRequest=d=>iframe.window.onmessage({data:d,source:parent,origin});
 const component={onMessage:f=>{onMessage=f;},postMessage(d){sent.push(d);if(loaded)deliverRequest(d);else queued.push(d);}};
 if(loadDelay>0){const t=setTimeout(()=>{timers.delete(t);loaded=true;for(const d of queued.splice(0))deliverRequest(d);},loadDelay);timers.add(t);}
 `);
support=support.replace('return {readReady,deliveries,frameNode,','return {sent,component,receive:d=>onMessage({data:d}),readReady,deliveries,frameNode,');
support=support.replace('close(){for(const t of timers)', 'close(){api.setSuspendGoogleAds(true);for(const t of timers)');
const box={require,__dirname,console,setTimeout,clearTimeout,URL};vm.runInNewContext(support+'\nthis.fixture=fixture;',box);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('late initial iframe at five seconds recovers via fresh open/read/confirm, not stale acceptance',{timeout:8000},async()=>{
 const f=await box.fixture({loadDelay:5000});try{
  const start=Date.now();await f.ready();assert.ok(Date.now()-start<1500,'caller is not held for iframe loading');
  assert.equal(f.api.getStoredClickIds(),null);
  await sleep(4700);
  assert.equal(f.api.getStoredClickIds()?.gclid,'INERT_EXACT_FIRST');
  const opens=f.sent.filter(d=>d.op==='open');assert.equal(opens.length,2);assert.notEqual(opens[0].nonce,opens[1].nonce);
  assert.equal(f.sent.filter(d=>d.op==='confirm').length,1);
 }finally{f.close();}
});

for(const mode of ['never-frame','no-response'])test(mode+' stays closed without polling and stops after readiness window',{timeout:13000},async()=>{
 const f=await box.fixture(mode==='never-frame'?{loadDelay:11000}:{drop:true});try{
  await f.ready();assert.equal(f.api.getStoredClickIds(undefined,true),null);
  await sleep(10700);assert.equal(f.sent.length,1);assert.equal(f.api.getStoredClickIds(undefined,true),null);
 }finally{f.close();}
});
test('explicit saved denial survives delayed transport; no optional contact snapshot',{timeout:3000},async()=>{
 const f=await box.fixture({deny:true,loadDelay:700});try{
  await f.ready();await sleep(400);assert.equal(f.pageStore.getItem('wbe_consent_choice'),'denied');
  assert.equal(f.api.getStoredClickIds(undefined,true),null);
  assert.equal(f.sent.filter(d=>d.op==='open').length,2);assert.equal(f.sent.filter(d=>d.op==='confirm').length,0);
 }finally{f.close();}
});
test('suspension during iframe wait cancels wake and does not resurrect after resume',{timeout:3000},async()=>{
 const f=await box.fixture({loadDelay:700});try{
  await f.ready();f.api.setSuspendGoogleAds(true);f.api.setSuspendGoogleAds(false);await sleep(400);
  assert.equal(f.sent.length,1);assert.equal(f.api.getStoredClickIds(undefined,true),null);
  await f.ready();assert.equal(f.api.getStoredClickIds()?.gclid,'INERT_EXACT_FIRST');
 }finally{f.close();}
});
test('withdrawal before iframe delivery then reaccept cannot restore old partition',{timeout:3000},async()=>{
 const f=await box.fixture({banner:true,loadDelay:700});try{
  f.click('Accept All');await f.ready();f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);
  f.click('Cookie settings');f.click('Accept All');await sleep(400);
  assert.equal(f.api.getStoredClickIds(),null);assert.equal(f.workerStore.getItem('wl_click_attribution'),null);
 }finally{f.close();}
});
test('reinitialized wait supersedes expired attempt and old allowed replay',{timeout:4000},async()=>{
 const f=await box.fixture({hold:d=>d.op==='open'});try{
  await f.ready();const old=f.deliveries[0];assert.ok(old);const next=f.ready();
  old.deliver();await sleep(30);assert.equal(f.sent.length,2);assert.equal(f.api.getStoredClickIds(undefined,true),null);
  f.deliveries[1].deliver();await next;assert.equal(f.api.getStoredClickIds()?.gclid,'INERT_EXACT_FIRST');
  old.deliver();await sleep(20);assert.equal(f.sent.length,4);
 }finally{f.close();}
});
test('late allowed wake is single-use and cannot itself authorize a capture',{timeout:3000},async()=>{
 const f=await box.fixture({hold:d=>d.op==='open'});try{
  await f.ready();const first=f.deliveries[0];first.deliver();first.deliver();await sleep(30);
  assert.equal(f.sent.length,2);assert.equal(f.api.getStoredClickIds(undefined,true),null);
  f.deliveries[1].deliver();await sleep(30);assert.equal(f.api.getStoredClickIds()?.gclid,'INERT_EXACT_FIRST');
  first.deliver();assert.equal(f.sent.length,4);
 }finally{f.close();}
});
test('negative late response cancels readiness rather than clearing visitor denial',{timeout:3000},async()=>{
 const f=await box.fixture({hold:d=>d.op==='open',deny:true});try{
  await f.ready();const old=f.deliveries[0];f.receive({...old.d,allowed:false});old.deliver();await sleep(30);
  assert.equal(f.sent.length,1);assert.equal(f.api.getStoredClickIds(undefined,true),null);assert.equal(f.pageStore.getItem('wbe_consent_choice'),'denied');
 }finally{f.close();}
});
for(const mode of ['nonce','sequence','extra','record','type','channel'])test('malformed readiness hint cannot wake: '+mode,{timeout:3000},async()=>{
 const f=await box.fixture({hold:d=>d.op==='open'});try{
  await f.ready();const d={...f.deliveries[0].d};
  if(mode==='nonce')d.nonce='0'.repeat(32);if(mode==='sequence')d.sequence++;if(mode==='extra')d.email='FORBIDDEN';
  if(mode==='record')d.record={};if(mode==='type')d.type='iframeLoaded';if(mode==='channel')d.channel='bad';
  f.receive(d);await sleep(20);assert.equal(f.sent.length,1);assert.equal(f.api.getStoredClickIds(undefined,true),null);
 }finally{f.close();}
});
for(const mode of ['origin','source','multiple-frames'])test('actual secure relay rejects readiness spoof: '+mode,{timeout:3000},async()=>{
 const f=await box.fixture({hold:d=>d.op==='open'});try{
  await f.ready();const d=f.deliveries[0].d;
  if(mode==='multiple-frames'){
   f.head.document.querySelectorAll=()=>[f.frameNode,f.frameNode];await f.ready();assert.equal(f.deliveries.length,1);
  }else f.iframe.window.onmessage({data:d,source:mode==='source'?{}:f.parent,origin:mode==='origin'?'https://evil.invalid':'https://www.wanderlustcaribbean.com'});
  await sleep(20);assert.equal(f.sent.length,mode==='multiple-frames'?2:1);assert.equal(f.api.getStoredClickIds(undefined,true),null);
 }finally{f.close();}
});
test('late opens cannot cause perpetual retries: at most two recovery attempts',{timeout:4000},async()=>{
 const f=await box.fixture({delay:600});try{
  await f.ready();await sleep(1800);
  assert.equal(f.sent.filter(d=>d.op==='open').length,3);assert.equal(f.sent.length,3);assert.equal(f.api.getStoredClickIds(undefined,true),null);
 }finally{f.close();}
});
test('current-nonce revoke during readiness wait cancels allowed late replay',{timeout:3000},async()=>{
 const f=await box.fixture({hold:d=>d.op==='open'});try{
  await f.ready();const old=f.deliveries[0];
  f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await sleep(20);old.deliver();await sleep(20);
  assert.equal(f.sent.length,1);assert.equal(f.api.getStoredClickIds(undefined,true),null);
 }finally{f.close();}
});
test('overlapping waits fence old results and old snapshot cannot capture later epoch',{timeout:3000},async()=>{
 const f=await box.fixture();try{
  await f.ready();const snapshot=f.api.getStoredClickIds(undefined,true);assert.ok(snapshot);
  const a=f.ready(),b=f.ready();await Promise.all([a,b]);
  assert.equal(f.api.getStoredClickIds(snapshot),null);assert.equal(f.api.getStoredClickIds()?.gclid,'INERT_EXACT_FIRST');
 }finally{f.close();}
});

for(const action of ['clear','resume'])test('lifecycle change before open timeout cannot arm a successor: '+action,{timeout:3000},async()=>{
 const f=await box.fixture({loadDelay:700});try{
  const waiting=f.ready();await sleep(50);
  if(action==='clear')await f.api.clearClickIds();else f.api.setSuspendGoogleAds(false);
  await waiting;await sleep(400);
  assert.equal(f.sent.length,1);assert.equal(f.api.getStoredClickIds(undefined,true),null);
 }finally{f.close();}
});

const nativeBox={require,__dirname,console,structuredClone,Buffer,URL,URLSearchParams,Date,setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(__dirname+'/google-ads-fresh-producer.cjs','utf8').split('for(const phone of')[0]+'\nthis.producer=producer;this.support=support;',nativeBox);
async function booking(native,bridge){
 const responses=[];
 const page=await nativeBox.support('attribution-hotfix.cjs','function bookingBackend','page')({setup:"_summaryRooms=[{roomCode:'adventure_suite',qty:1,numGuests:2},{roomCode:'two_bedroom_apartment',qty:1,numGuests:3}];_selectedPackageId='INERT_PACKAGE';_pricingQuoteToken="+JSON.stringify(native.quote.token)+';',book:async q=>{const r=await native.availability.createBooking(q);responses.push(r);return r;}});
 page.c.waitForClickAttribution=()=>bridge.ready();page.c.getStoredClickIds=bridge.api.getStoredClickIds;page.c.wixData=native.sdk;
 const uploads=[],inputs=[];page.c.recordBookingConversion=q=>{inputs.push(q);const u=native.sender.recordBookingConversion(q);uploads.push(u);return u;};
 return {page,responses,uploads,inputs};
}
for(const schedule of ['recovered','too-early','denied'])test('delayed readiness through actual fresh AUTH producer and Summary: '+schedule,{timeout:5000},async()=>{
 const native=await nativeBox.producer(),bridge=await box.fixture({loadDelay:schedule==='too-early'?1400:700,deny:schedule==='denied'});
 try{
  if(schedule!=='too-early'){await bridge.ready();await sleep(400);}
  const {page,responses,uploads,inputs}=await booking(native,bridge);const start=Date.now();await page.click();await Promise.all(uploads);
  assert.ok(Date.now()-start<2000,'unchanged booking deadline');
  assert.equal(responses.length,2);assert.match(responses[0].conversionCapability,/^gac1\.[a-f0-9]{64}$/);assert.equal(responses[1].conversionCapability,undefined);
  assert.equal([...native.rows.values()].filter(r=>r.kind==='AUTH').length,1);assert.equal(page.invoices.length,1);assert.equal(page.timers.length,1);
  if(schedule==='recovered'){
   assert.equal(native.wires.length,1);assert.equal(native.wires[0].events[0].adIdentifiers.gclid,'INERT_EXACT_FIRST');
   assert.equal(native.wires[0].events[0].transactionId,responses[0].bookingNumber);
   assert.ok(page.payloads.every(p=>p.gclid==='INERT_EXACT_FIRST'));
   assert.equal((await native.sender.recordBookingConversion(inputs[0])).ok,false);assert.equal(native.wires.length,1);
  }else{
   assert.equal(inputs.length,0);assert.equal(native.wires.length,0);assert.ok(page.payloads.every(p=>!p.gclid));
   await sleep(1100);assert.equal(inputs.length,0,'later readiness cannot resurrect the completed booking capture');
  }
 }finally{bridge.close();}
});
test('out-of-order late frame readiness keeps concurrent actual bookings and original AUTH separate',{timeout:6000},async()=>{
 const native=await nativeBox.producer(),a=await box.fixture({loadDelay:1100,query:'gclid=INERT_A'}),b=await box.fixture({loadDelay:700,query:'gclid=INERT_B'});
 try{
  await Promise.all([a.ready(),b.ready()]);await sleep(300);assert.equal(a.api.getStoredClickIds(),null);assert.equal(b.api.getStoredClickIds()?.gclid,'INERT_B');
  await sleep(400);assert.equal(a.api.getStoredClickIds()?.gclid,'INERT_A');
  const left=await booking(native,a),right=await booking(native,b);
  // Separate stays avoid the unrelated legacy same-inventory contention limit.
  const secondQuote=await native.cache.get('backend/pricingQuote').namespace.createLockedPricingQuote('INERT_PACKAGE','2027-02-01','2027-02-02');
  vm.runInContext("_summaryCis='2027-02-01';_summaryCos='2027-02-02';_pricingQuoteToken="+JSON.stringify(secondQuote.token)+';',right.page.c);
  await Promise.all([left.page.click(),right.page.click()]);await Promise.all([...left.uploads,...right.uploads]);
  assert.equal(native.wires.length,2);assert.equal([...native.rows.values()].filter(r=>r.kind==='AUTH').length,2);
  assert.equal(new Set([...left.inputs,...right.inputs].map(p=>p.conversionCapability)).size,2);
  for(const [entry,id] of [[left,'INERT_A'],[right,'INERT_B']]){
   assert.equal(entry.inputs.length,1);const input=entry.inputs[0];assert.equal(input.gclid,id);
   assert.equal(native.wires.find(w=>w.events[0].transactionId===input.transactionId).events[0].adIdentifiers.gclid,id);
   assert.equal((await native.sender.recordBookingConversion(input)).ok,false);assert.equal(entry.page.timers.length,1);
  }
  assert.equal(native.wires.length,2);
 }finally{a.close();b.close();}
});
