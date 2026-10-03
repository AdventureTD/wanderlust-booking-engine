'use strict';
const {fixture}=require('./attribution-clock-v2.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const offset of [-86400000,86400000])test('current identifier survives independent policy clock '+offset,async()=>{const f=await fixture({query:'gclid=INERT_CLOCK_CURRENT',serverOffset:offset});try{await f.api.waitForClickAttribution();assert.equal(f.api.getStoredClickIds()?.gclid,'INERT_CLOCK_CURRENT');assert.equal(f.counts().rpcs,1);}finally{f.close();}});
const negativeCases = [
 ['old v1 response',{response:p=>({...p,v:1})}],
 ['wrong audience',{response:p=>({...p,audience:'https://evil.invalid'})}],
 ['cross-purpose',{response:p=>({...p,purpose:p.purpose==='form'?'attribution':'form'})}],
 ['cross-phase',{response:p=>({...p,phase:'complete'})}],
 ['cross-channel',{response:p=>({...p,challenge:'0'.repeat(32)})}],
 ['nonce replay',{response:p=>({...p,nonce:'0'.repeat(32)})}],
 ['extra field',{response:p=>({...p,private:'not-forwarded'})}],
 ['UNRESOLVED',{rows:[{_id:'a',countryCode:'CA',consentRequired:true}]}],
 ['malformed policy',{response:p=>({...p,observedAt:'1'})}],
 ['consent denied',{denied:true}],['malformed consent',{malformedConsent:true}],
 ['crypto missing',{noCrypto:true}],['malformed crypto return',{badWorkerCrypto:true}],['worker clock missing',{noWorkerClock:true}],['Head clock missing',{noHeadClock:true}],
 ['mixed v1 worker messages',{beforeRelay:d=>{if(d.type==='wbe-click-attribution'||d.type==='wbe-ads-form')d.v=1;}}],
 ['worker rollback during native read',{onRead:(_,c)=>{c.worker--;}}],
 ['Head rollback before read',{beforeRelay:(d,c)=>{if(d.op==='read')c.head--;}}],
 ['Head expired before read',{beforeRelay:(d,c)=>{if(d.op==='read'||d.type==='wbe-ads-form'&&d.op==='result')c.head+=1500;}}],
 ['worker expired before read',{onRead:(_,c)=>{c.worker+=1500;}}],
 ['Head expired before confirm',{beforeRelay:(d,c)=>{if(d.op==='confirm'||d.type==='wbe-ads-form'&&d.op==='result')c.head+=1500;}}]
];
for(const [name,options] of negativeCases) test('actual graph denies '+name,async()=>{const f=await fixture(options);try{await f.api.waitForClickAttribution();assert.equal(f.api.getStoredClickIds(undefined,true),null);const seq=f.api.prepareAdsFormSubmission();f.api.completeAdsFormSubmission(seq);await f.settle();assert.equal(f.forms().length,0);assert.equal(f.counts().externalCalls,0);}finally{f.close();}});

test('actual backend response preserves observation evidence and fresh request tuple',async()=>{const f=await fixture({serverOffset:86400000});try{const a={v:2,audience:'https://www.wanderlustcaribbean.com',purpose:'form',phase:'prepare',nonce:'1'.repeat(32),challenge:'2'.repeat(32)};const first=await f.endpoint(a),second=await f.endpoint({...a,challenge:'3'.repeat(32)});assert.equal(first.observedAt,f.clocks.server);assert.equal(second.challenge,'3'.repeat(32));assert.equal(f.counts().nativeReads,2);assert.equal(first.policyKey,second.policyKey);f.server.getterCalls=0;const bad=await vm.runInContext(`call({v:2,audience:'https://www.wanderlustcaribbean.com',purpose:'form',phase:'prepare',nonce:'1'.repeat(32),get challenge(){getterCalls++;return '2'.repeat(32)}})`,f.server);assert.equal(bad.requirement,'UNRESOLVED');assert.equal(f.server.getterCalls,0);assert.equal(f.counts().nativeReads,2);}finally{f.close();}});

test('replayed real backend response cannot satisfy next channel or form phase',async()=>{let saved;const f=await fixture({response:p=>{if(!saved)saved=p;return saved;}});try{await f.api.waitForClickAttribution();assert.ok(f.api.getStoredClickIds(undefined,true));await f.api.waitForClickAttribution();assert.equal(f.api.getStoredClickIds(undefined,true),null);const n=f.api.prepareAdsFormSubmission();f.api.completeAdsFormSubmission(n);await f.settle();assert.equal(f.forms().length,0);assert.equal(f.counts().nativeReads,3);}finally{f.close();}});

test('late open delivered before Head ACK recovers with fresh channel and one native read',async()=>{let opens=0;const f=await fixture({requestDelay:d=>d.op==='open'&&++opens===1?700:0});try{await f.api.waitForClickAttribution();assert.equal(f.api.getStoredClickIds(undefined,true),null);await sleep(300);await f.settle();assert.ok(f.api.getStoredClickIds(undefined,true));assert.equal(opens,2);assert.equal(f.counts().rpcs,1);assert.equal(f.counts().nativeReads,1);}finally{f.close();}});
test('form start delayed before Head ACK cannot relabel aged worker work',async()=>{const f=await fixture({requestDelay:d=>d.type==='wbe-ads-form'&&d.op==='start'?1600:0});try{const n=f.api.prepareAdsFormSubmission();f.api.completeAdsFormSubmission(n);await sleep(1700);await f.settle();assert.equal(f.forms().length,0);assert.equal(f.counts().rpcs,0);assert.equal(f.counts().nativeReads,0);}finally{f.close();}});

test('stationary monotonic timer closes pending policy and ignores late native read',async()=>{let release;const gate=new Promise(r=>release=r);const f=await fixture({onRead:()=>gate});try{await f.api.waitForClickAttribution();assert.equal(f.api.getStoredClickIds(undefined,true),null);assert.equal(f.counts().rpcs,1);release();await f.settle();assert.equal(f.trace.filter(x=>x.edge==='worker'&&['read','confirm'].includes(x.d.op)).length,0);assert.equal(f.counts().rpcs,1);}finally{release();f.close();}});
for(const phase of ['prepare','complete'])test('form '+phase+' local timer closes before late native result',async()=>{let release;const gate=new Promise(r=>release=r);const f=await fixture({onRead:n=>n===(phase==='prepare'?1:2)?gate:undefined});try{const seq=f.api.prepareAdsFormSubmission();f.api.completeAdsFormSubmission(seq);await sleep(1600);release();await f.settle();assert.equal(f.forms().length,0);assert.equal(f.counts().rpcs,phase==='prepare'?1:2);}finally{release();f.close();}});

test('delayed form ACK counts against Head lease before native RPC',async()=>{const f=await fixture({ackDelay:900,policyDelay:650});try{const seq=f.api.prepareAdsFormSubmission();f.api.completeAdsFormSubmission(seq);await sleep(1700);await f.settle();assert.equal(f.forms().length,0);assert.equal(f.counts().rpcs,1);}finally{f.close();}});
test('undelivered form ACK performs zero native RPC',async()=>{const f=await fixture({ackDelay:1600});try{const seq=f.api.prepareAdsFormSubmission();f.api.completeAdsFormSubmission(seq);await sleep(1700);await f.settle();assert.equal(f.forms().length,0);assert.equal(f.counts().rpcs,0);assert.equal(f.counts().nativeReads,0);}finally{f.close();}});

// Actual booking/capability/journal/Data Manager producer, inert SDK and transport.
// No synthetic success proof, capability or invoice outcome is inserted here.
const producerBox={require,__dirname,console,structuredClone,Buffer,URL,URLSearchParams,Date,setTimeout,clearTimeout};
let producerSource=fs.readFileSync(__dirname+'/google-ads-fresh-producer.cjs','utf8').split('for(const phone of')[0];
// New suite-only admission of current imported cancellation reader and inert
// native field-patch SDK. No historical loader or production source is edited.
for(const [before,after] of [
 ["const external={","const external={'@wix/data':{items:{patch:deny}},"],
 ["const allowed=new Set([","const allowed=new Set(['backend/bookingCancellation',"],
 ["const cols=new Set([","const cols=new Set(['BookingCancellationOperations',"]
]){assert.equal(producerSource.split(before).length,2);producerSource=producerSource.replace(before,after);}
vm.runInNewContext(producerSource+'\nthis.producer=producer;this.support=support;',producerBox);
for(const [name,options] of [['positive',{serverOffset:86400000,policyDelay:600}],...negativeCases])test('full graph through actual Summary and provider boundary '+name,async()=>{
 const negative=name!=='positive';
 const native=await producerBox.producer(),f=await fixture(options);
 try{
  const responses=[],uploads=[],inputs=[];
  const page=await producerBox.support('attribution-hotfix.cjs','function bookingBackend','page')({setup:"_summaryRooms=[{roomCode:'adventure_suite',qty:1,numGuests:2},{roomCode:'two_bedroom_apartment',qty:1,numGuests:3}];_selectedPackageId='INERT_PACKAGE';_pricingQuoteToken="+JSON.stringify(native.quote.token)+';',book:async p=>{const result=await native.availability.createBooking(p);responses.push(result);return result;}});
  page.c.waitForClickAttribution=()=>f.api.waitForClickAttribution();page.c.getStoredClickIds=f.api.getStoredClickIds;page.c.wixData=native.sdk;
  page.c.prepareAdsFormSubmission=f.api.prepareAdsFormSubmission;page.c.completeAdsFormSubmission=f.api.completeAdsFormSubmission;
  page.c.recordBookingConversion=p=>{inputs.push(p);const result=native.sender.recordBookingConversion(p);uploads.push(result);return result;};
  await page.click();await Promise.all(uploads);if(!negative)await sleep(1300);await f.settle();
  assert.equal(responses.length,2);assert.equal(page.invoices.length,1);assert.equal(page.timers.length,1);
  assert.equal(native.wires.length,negative?0:1);assert.equal(inputs.length,negative?0:1);if(negative)assert.equal(native.trace.filter(t=>t[0]==='fetch').length,0,'zero OAuth/provider entry');assert.equal(f.forms().length,negative?0:1);
  if(!negative){assert.equal((await native.sender.recordBookingConversion(inputs[0])).ok,false);assert.equal(native.wires.length,1);assert.equal(native.wires[0].events[0].transactionId,responses[0].bookingNumber);}
 }finally{f.close();}
});
