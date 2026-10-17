'use strict';
// Supersession / pending-clear race and unusable-clock retention tests.
// Actual Head (readable and packed) -> relay -> policy producer -> worker with
// real delayed worker->relay delivery. Fixture strings only; network denied.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./attribution-clock-v2.cjs');
const KEY='wl_click_attribution',CLEAR='wl_click_attribution_clear_pending',DAY=86400000;
const touch=(id,days=0)=>({capturedAt:new Date(Date.now()-days*DAY-1000).toISOString(),gclid:id,gbraid:'',wbraid:'',msclkid:''});
const state=(first,latest=first)=>({v:1,first,latest});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {attributionOnly}=require(__dirname + '/support/privacy-bind-projection.cjs');
// O3 P2: raw f.trace retained; projection excludes ONLY validated privacy-only binds.
const ops=f=>attributionOnly(f.trace.filter(t=>t.edge==='worker'&&t.d&&t.d.type==='wbe-click-attribution').map(t=>t.d)).map(d=>d.op);
// Hold every worker 'clear' delivery so the readiness task is suspended in its
// pending-clear await when a lifecycle change arrives.
const holdClear=ms=>d=>d&&d.op==='clear'?ms:0;

for(const packed of [false,true]) {
 const label=packed?'packed':'source';
 test('R1 withdrawal during held pending clear: stale task never re-opens, re-claims or admits '+label,async()=>{
  const f=await fixture({packed,pageStorage:[[KEY,JSON.stringify(state(touch('PAGE_ID',2)))]],workerStorage:[[CLEAR,JSON.stringify(state(touch('OLD_CONVERTED',5)))]],requestDelay:holdClear(150)});
  try{
   const a=f.api.waitForClickAttribution();await sleep(40);
   assert.ok(ops(f).includes('clear'),'task is held in its pending clear');
   const at=ops(f).length;
   f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);
   await a;await sleep(300);await f.settle();
   assert.deepEqual(ops(f).slice(at),[],'no open/read/confirm after withdrawal');
   assert.equal(f.api.getStoredClickIds(undefined,true),null,'denied');assert.equal(f.api.getStoredClickIds(),null);
   assert.equal(f.workerStorage.has(KEY),false);assert.equal(f.workerStorage.has(CLEAR),false);
  }finally{f.close();}
 });
 test('R2 suspension during held pending clear: no open after suspension, nothing admitted '+label,async()=>{
  const f=await fixture({packed,pageStorage:[[KEY,JSON.stringify(state(touch('PAGE_ID',2)))]],workerStorage:[[CLEAR,JSON.stringify(state(touch('OLD_CONVERTED',5)))]],requestDelay:holdClear(150)});
  try{
   const a=f.api.waitForClickAttribution();await sleep(40);
   const at=ops(f).length;f.api.setSuspendGoogleAds(true);
   await a;await sleep(300);await f.settle();
   assert.equal(ops(f).slice(at).includes('open'),false,'suspended stale task must not open');
   assert.equal(ops(f).slice(at).some(o=>o==='read'||o==='confirm'),false);
   assert.equal(f.api.getStoredClickIds(),null);assert.equal(f.workerStorage.has(KEY),false);
  }finally{f.close();}
 });
 test('R3 newer readiness B during held clear: B processes CLEAR and admits; stale A adds no effect; B snapshot stays valid '+label,async()=>{
  const f=await fixture({packed,pageStorage:[[KEY,JSON.stringify(state(touch('PAGE_ID',2)))]],workerStorage:[[CLEAR,JSON.stringify(state(touch('OLD_CONVERTED',5)))]],requestDelay:holdClear(120)});
  try{
   const a=f.api.waitForClickAttribution();await sleep(40);
   const at=ops(f).length;let aSettled=null;a.then(()=>{aSettled={ops:ops(f).slice(at),clear:f.workerStorage.has(CLEAR),admitted:!!f.api.getStoredClickIds()};});
   const b=f.api.waitForClickAttribution();
   await Promise.all([a,b]);
   // Reachability: B's start finishes A's pending clear (single-pending), so stale A
   // resumes while CLEAR is still present and before B has posted or admitted anything.
   assert.deepEqual(aSettled,{ops:['clear'],clear:true,admitted:false},'A resumed in the stale CLEAR-present branch after only B\'s synchronous CLEAR retry and before B opened, read, confirmed or admitted');await sleep(200);await f.settle();
   const after=ops(f).slice(at);
   assert.deepEqual(after,['clear','open','read','confirm'],'only B: CLEAR retry on the existing channel, then exactly one fresh handshake');
   assert.equal(f.workerStorage.has(CLEAR),false,'B retired the pending clear');
   const snapB=f.api.getStoredClickIds();assert.equal(snapB.gclid,'PAGE_ID');
   await sleep(200);await f.settle();
   assert.equal(f.api.getStoredClickIds(snapB),snapB,'B snapshot remains valid (stale A did not re-bump revision)');
   assert.equal(JSON.parse(f.workerStorage.get(KEY)).first.gclid,'PAGE_ID');
  }finally{f.close();}
 });
 test('R4 lost clear ACK: CLEAR retry copy retained, task denies and stops (unchanged semantics) '+label,async()=>{
  const old=state(touch('OLD_CONVERTED',5));
  const f=await fixture({packed,pageStorage:[[KEY,JSON.stringify(state(touch('PAGE_ID',2)))]],workerStorage:[[CLEAR,JSON.stringify(old)]],requestDelay:holdClear(900)});
  try{
   await f.api.waitForClickAttribution();await f.settle();
   assert.equal(f.workerStorage.get(CLEAR),JSON.stringify(old),'pending-clear retry copy retained after lost ACK');
   assert.equal(ops(f).filter(o=>o==='read'||o==='confirm').length,0);
   assert.equal(f.api.getStoredClickIds(undefined,true),null,'denied');
  }finally{f.close();}
 });
 test('R5 finite clock, budget expires during pending clear: unadmitted KEY retained (unchanged) '+label,async()=>{
  const kept=JSON.stringify(state(touch('WORKER_KEPT',3)));
  const f=await fixture({packed,workerStorage:[[KEY,kept],[CLEAR,JSON.stringify(state(touch('OLD_CONVERTED',5)))]],requestDelay:holdClear(100)});
  try{
   const a=f.api.waitForClickAttribution();await sleep(30);f.clocks.worker+=20000;
   await a;await f.settle();
   assert.equal(f.workerStorage.get(KEY),kept,'finite-clock expiry must not delete attribution');
   assert.equal(f.workerStorage.has(CLEAR),false,'acknowledged clear retired its own copy');
   assert.equal(ops(f).filter(o=>o==='open').length,1,'no handshake after expiry');
   assert.equal(f.api.getStoredClickIds(),null,'expired task admits nothing');
  }finally{f.close();}
 });
 test('R6 unusable clock, current owner: unadmitted KEY erased with no egress '+label,async()=>{
  const f=await fixture({packed,noWorkerClock:true,workerStorage:[[KEY,JSON.stringify(state(touch('WORKER_UNUSABLE',3)))]]});
  try{
   await f.api.waitForClickAttribution();await f.settle();
   assert.equal(f.workerStorage.has(KEY),false,'unadmittable copy deleted');
   assert.deepEqual(ops(f),[],'no channel message');assert.equal(f.counts().rpcs,0);assert.equal(f.counts().externalCalls,0);
   assert.equal(f.api.getStoredClickIds(),null);
  }finally{f.close();}
 });
}

for(const packed of [false,true]) test('R7 B4 fence during held pending clear: readiness yields, acked CLEAR retired, KEY retained, nothing admitted '+(packed?'packed':'source'),async()=>{
 const kept=JSON.stringify(state(touch('WORKER_KEPT',3)));
 const f=await fixture({packed,pageStorage:[[KEY,JSON.stringify(state(touch('PAGE_ID',2)))]],workerStorage:[[KEY,kept],[CLEAR,JSON.stringify(state(touch('OLD_CONVERTED',5)))]],requestDelay:holdClear(120)});
 try{
  const a=f.api.waitForClickAttribution();await sleep(40);
  const at=ops(f).length;f.api.clearClickIds();// denied during readiness -> IO-free fence
  await a;await sleep(200);await f.settle();
  assert.deepEqual(ops(f).slice(at),[],'fence opens nothing and stale readiness does not continue');
  assert.equal(f.workerStorage.has(CLEAR),false,'the genuine ACK still retires its own pending-clear copy');
  assert.equal(f.workerStorage.get(KEY),kept,'unadmitted bytes retained');
  assert.equal(f.api.getStoredClickIds(undefined,true),null);
 }finally{f.close();}
});

for(const packed of [false,true]) test('R8 B admits, then worker clock becomes unusable: B KEY bytes and snapshot revision preserved, no stale ops '+(packed?'packed':'source'),async()=>{
 const f=await fixture({packed,pageStorage:[[KEY,JSON.stringify(state(touch('PAGE_ID',2)))]],workerStorage:[[CLEAR,JSON.stringify(state(touch('OLD_CONVERTED',5)))]],requestDelay:holdClear(120)});
 try{
  const a=f.api.waitForClickAttribution();await sleep(40);let aDone=false;a.then(()=>{aDone=true;});
  const b=f.api.waitForClickAttribution();await b;await f.settle();
  assert.equal(aDone,true,'A cannot resume after B admits: it already yielded at B start');
  const snapB=f.api.getStoredClickIds();assert.equal(snapB.gclid,'PAGE_ID');
  const bytes=f.workerStorage.get(KEY);
  f.clocks.worker=NaN;// clock becomes unusable after B admitted
  const at=ops(f).length;
  await a;await sleep(300);await f.settle();
  assert.deepEqual(ops(f).slice(at),[],'no post-release ops from stale A');
  assert.equal(f.workerStorage.get(KEY),bytes,'B KEY bytes preserved');
  assert.equal(f.api.getStoredClickIds(snapB),snapB,'B snapshot revision unchanged (no stale re-bump); not a claim of future eligibility');
 }finally{f.close();}
});
