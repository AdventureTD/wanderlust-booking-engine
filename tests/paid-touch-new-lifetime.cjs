'use strict';
// B2 new-lifetime + B4 denied-clear fence contract tests.
// Actual Head (readable and packed) -> relay -> policy producer -> worker, plus
// the pure module and actual Summary page. Fixture strings only; all network denied.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),{createRequire}=require('node:module');
const {fixture}=require('./attribution-clock-v2.cjs');
const KEY='wl_click_attribution',CLEAR='wl_click_attribution_clear_pending',DAY=86400000;
const touch=(id,days=0,provider='gclid')=>({capturedAt:new Date(Date.now()-days*DAY-1000).toISOString(),gclid:'',gbraid:'',wbraid:'',msclkid:'',[provider]:id});
const state=(first,latest=first)=>({v:1,first,latest});
const stored=v=>[[KEY,JSON.stringify(v)]];
const plain=x=>JSON.parse(JSON.stringify(x));
async function moduleApi(){const m=new vm.SourceTextModule(fs.readFileSync(root+'/velo/public/paidTouchState.js','utf8'));await m.link(()=>{throw Error('No imports permitted');});await m.evaluate();return m.namespace;}
const pageSrc=fs.readFileSync(root+'/tests/attribution-hotfix.cjs','utf8'),pageCtx={require:createRequire(root+'/tests/attribution-hotfix.cjs'),__dirname:root+'/tests',console};
vm.runInNewContext(pageSrc.slice(0,pageSrc.indexOf('function bookingBackend'))+'\nthis.pageFactory=page;',pageCtx);

// Scenario seeds: E = expired first (95d), B = live latest (45d), A = live first (20d).
const seeds=()=>({E:touch('EXPIRED_FIRST',95),B:touch('LIVE_LATEST',45),A:touch('LIVE_FIRST',20),L:touch('LIVE_LATEST5',5)});

// --- Contract 1-5 on the pure module -------------------------------------
test('C1 module: expired first + live latest + distinct newer paid landing starts new lifetime',async()=>{
 const m=await moduleApi(),s=seeds(),now=Date.now(),next=touch('NEW_CLICK');
 assert.deepEqual(plain(m.capturePaidTouch(state(s.E,s.B),next,now)),{v:1,first:next,latest:next});
 const ms=touch('NEW_MS',0,'msclkid');assert.deepEqual(plain(m.capturePaidTouch(state(s.E,s.B),ms,now)),{v:1,first:ms,latest:ms});
});
test('C2 module: direct visit after expired first does not promote latest',async()=>{
 const m=await moduleApi(),s=seeds(),now=Date.now();
 for(const landing of [null,{capturedAt:new Date(now).toISOString(),gclid:'',gbraid:'',wbraid:'',msclkid:''}])
  assert.deepEqual(plain(m.capturePaidTouch(state(s.E,s.B),landing,now)),{v:1,first:null,latest:s.B});
});
test('C3 module: identical re-landing of live latest neither promotes nor renews',async()=>{
 const m=await moduleApi(),s=seeds(),now=Date.now();
 assert.deepEqual(plain(m.capturePaidTouch(state(s.E,s.B),{...s.B,capturedAt:new Date(now).toISOString()},now)),{v:1,first:null,latest:s.B});
});
test('C4 module: landing older than latest is ignored',async()=>{
 const m=await moduleApi(),s=seeds(),now=Date.now();
 assert.deepEqual(plain(m.capturePaidTouch(state(s.E,s.L),touch('OLDER_THAN_LATEST',30),now)),{v:1,first:null,latest:s.L});
});
test('C5 module: live first is preserved and latest advances (regression guard)',async()=>{
 const m=await moduleApi(),s=seeds(),now=Date.now(),next=touch('NEW_CLICK');
 assert.deepEqual(plain(m.capturePaidTouch(state(s.A,s.L),next,now)),{v:1,first:s.A,latest:next});
 assert.deepEqual(plain(m.capturePaidTouch(s.A,next,now)),{v:1,first:s.A,latest:next},'legacy flat live first');
});

// --- Contract 6: actual Head (both builds) == module, plus worker outbound flat IDs
const headCases=[
 {name:'new distinct gclid',seed:s=>state(s.E,s.B),query:'gclid=NEW_CLICK',first:'NEW_CLICK',latest:'NEW_CLICK',flat:{gclid:'NEW_CLICK'}},
 {name:'new distinct msclkid',seed:s=>state(s.E,s.B),query:'msclkid=NEW_MS',first:'NEW_MS',latest:'NEW_MS',flat:{msclkid:'NEW_MS'}},
 {name:'direct visit',seed:s=>state(s.E,s.B),query:'',first:null,latest:'LIVE_LATEST',flat:{gclid:''}},
 {name:'same-ID re-landing',seed:s=>state(s.E,s.B),query:'gclid=LIVE_LATEST',first:null,latest:'LIVE_LATEST',flat:{gclid:''}},
 {name:'live first preserved',seed:s=>state(s.A,s.L),query:'gclid=NEW_CLICK',first:'LIVE_FIRST',latest:'NEW_CLICK',flat:{gclid:'LIVE_FIRST'}}
];
const ids=t=>t&&(t.gclid||t.msclkid||t.gbraid||t.wbraid);
for(const packed of [false,true]) for(const c of headCases) test('C6 Head/module parity '+(packed?'packed':'source')+': '+c.name,async()=>{
 const s=seeds(),seed=c.seed(s),m=await moduleApi();
 const f=await fixture({packed,query:c.query,pageStorage:stored(seed)});
 try{
  await f.api.waitForClickAttribution();
  const headState=JSON.parse(f.storage.get(KEY));
  assert.equal(ids(headState.first)??null,c.first);assert.equal(ids(headState.latest),c.latest);
  // Module parity: same seed, same landing (Head's own capture timestamp when a landing occurred).
  const q=new URLSearchParams(c.query),landing=c.query?{capturedAt:ids(headState.latest)===(q.get('gclid')||q.get('msclkid'))&&headState.latest.capturedAt!==seed.latest?.capturedAt?headState.latest.capturedAt:new Date().toISOString(),gclid:q.get('gclid')||'',gbraid:'',wbraid:'',msclkid:q.get('msclkid')||''}:null;
  const expected=m.capturePaidTouch(seed,landing,Date.now());
  assert.deepEqual(headState,plain(expected),'Head capture must equal paidTouchState.capturePaidTouch');
  if(c.first===null&&c.latest==='LIVE_LATEST')assert.equal(headState.latest.capturedAt,s.B.capturedAt,'no age renewal');
  // Worker outbound flat IDs (Google/Microsoft upload fields) follow first only.
  const out=f.api.getStoredClickIds();assert.ok(out);
  for(const [k,v] of Object.entries(c.flat))assert.equal(out[k],v,'flat '+k);
  assert.equal(ids(out.paidTouches.latest),c.latest);
  assert.equal(f.counts().externalCalls,0);
 }finally{f.close();}
});

// --- Contract 7: actual Summary outbound provider/reporting payloads -----
for(const c of [{name:'new lifetime',query:'gclid=NEW_SUMMARY',gclid:'NEW_SUMMARY',first:'NEW_SUMMARY'},{name:'direct visit',query:'',gclid:'',first:null}])
 test('C7 actual Summary payloads after expired first: '+c.name,async()=>{
  const s=seeds(),f=await fixture({query:c.query,pageStorage:stored(state(s.E,s.B))});
  try{
   const p=await pageCtx.pageFactory();p.c.waitForClickAttribution=f.api.waitForClickAttribution;p.c.getStoredClickIds=f.api.getStoredClickIds;
   await p.click();for(let i=0;i<30;i++)await Promise.resolve();
   assert.equal(p.payloads.length>=1,true);assert.equal(p.ads.length,1);
   assert.equal(p.ads[0].gclid,c.gclid,'Google upload click ID');
   assert.equal(p.payloads[0].gclid,c.gclid,'flat booking gclid');
   assert.equal(ids(p.payloads[0].firstPaidTouch)??null,c.first,'firstPaidTouch reporting');
   assert.equal(ids(p.payloads[0].latestPaidTouch),c.first||'LIVE_LATEST','latestPaidTouch reporting');
  }finally{f.close();}
 });

// --- B4: denied-state clear is an IO-free fence ---------------------------
const {attributionOnly}=require(__dirname + '/support/privacy-bind-projection.cjs');
// O3 P2: raw f.trace retained; projection excludes ONLY validated privacy-only binds.
const workerOps=f=>attributionOnly(f.trace.filter(t=>t.edge==='worker'&&t.d&&t.d.type==='wbe-click-attribution').map(t=>t.d)).map(d=>d.op);
for(const packed of [false,true]) {
 test('B4a late upload completion after explicit withdrawal cannot revive or recreate '+(packed?'packed':'source'),async()=>{
  const f=await fixture({packed,query:'gclid=WITHDRAWN'});
  try{
   await f.api.waitForClickAttribution();const snap=f.api.getStoredClickIds();assert.equal(snap.gclid,'WITHDRAWN');
   f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await f.settle();
   assert.equal(f.api.getStoredClickIds(snap),null);
   const before=workerOps(f).length;await f.api.clearClickIds(snap);await f.settle();
   assert.deepEqual(workerOps(f).slice(before),[],'no channel/op after withdrawn clear');
   assert.equal(f.workerStorage.has(CLEAR),false,'no pending-clear identifier copy');
   assert.equal(f.workerStorage.has(KEY),false);assert.equal(f.storage.has(KEY),false);
   assert.equal(f.api.getStoredClickIds(),null);
  }finally{f.close();}
 });
 test('B4b clear while policy unresolved opens nothing, writes nothing, grants nothing '+(packed?'packed':'source'),async()=>{
  const f=await fixture({packed,query:'gclid=UNRESOLVED_ID',response:r=>({...r,requirement:'UNRESOLVED'})});
  try{
   await f.api.waitForClickAttribution();assert.equal(f.api.getStoredClickIds(),null);
   const before=workerOps(f).length;await f.api.clearClickIds();await f.api.clearClickIds({gclid:'UNRESOLVED_ID'});await f.settle();
   assert.deepEqual(workerOps(f).slice(before),[]);
   assert.equal(f.workerStorage.has(CLEAR),false);assert.equal(f.workerStorage.has(KEY),false);
   assert.equal(f.api.getStoredClickIds(undefined,true),null);
  }finally{f.close();}
 });
 test('B4c admitted snapshot clear still clears (positive control) and preserves newer state '+(packed?'packed':'source'),async()=>{
  const s=seeds(),f=await fixture({packed,pageStorage:stored(state(s.A,s.L))});
  try{
   await f.api.waitForClickAttribution();const old=f.api.getStoredClickIds();
   f.storage.set(KEY,JSON.stringify(state(s.A,touch('NEWER_LATEST'))));
   await f.api.clearClickIds(old);await f.settle();
   assert.ok(workerOps(f).includes('clear'));
   assert.equal(JSON.parse(f.storage.get(KEY)).latest.gclid,'NEWER_LATEST','snapshot-scoped clear cannot erase newer state');
  }finally{f.close();}
 });
}

// B4 durable denied-state matrix: error and suspended, plus pending initial handshake.
for(const packed of [false,true]) {
 const label=packed?'packed':'source';
 test('B4d clear after policy RPC error opens nothing, writes nothing, grants nothing '+label,async()=>{
  const f=await fixture({packed,query:'gclid=ERROR_ID',response:()=>{throw Error('INERT_POLICY_ERROR');}});
  try{
   await f.api.waitForClickAttribution();assert.equal(f.api.getStoredClickIds(),null);
   const before=workerOps(f).length;await f.api.clearClickIds();await f.api.clearClickIds({gclid:'ERROR_ID'});await f.settle();
   assert.deepEqual(workerOps(f).slice(before),[]);
   assert.equal(f.workerStorage.has(CLEAR),false);assert.equal(f.workerStorage.has(KEY),false);
   assert.equal(f.api.getStoredClickIds(undefined,true),null);
  }finally{f.close();}
 });
 test('B4e late clear after suspension cannot reopen, recreate or revive '+label,async()=>{
  const f=await fixture({packed,query:'gclid=SUSPENDED_ID'});
  try{
   await f.api.waitForClickAttribution();const snap=f.api.getStoredClickIds();assert.equal(snap.gclid,'SUSPENDED_ID');
   f.api.setSuspendGoogleAds(true);await f.settle();
   const before=workerOps(f).length;await f.api.clearClickIds(snap);await f.api.clearClickIds();await f.settle();
   assert.deepEqual(workerOps(f).slice(before),[],'no op after suspended clear');
   assert.equal(f.workerStorage.has(CLEAR),false);assert.equal(f.workerStorage.has(KEY),false);
   assert.equal(f.api.getStoredClickIds(snap),null);assert.equal(f.api.getStoredClickIds(),null);
  }finally{f.close();}
 });
 test('B4f clear during pending initial handshake fences it: no read/confirm, nothing admitted '+label,async()=>{
  const f=await fixture({packed,query:'gclid=PENDING_ID',requestDelay:d=>d&&d.op==='open'?200:0});
  try{
   const waiting=f.api.waitForClickAttribution();await f.settle();
   assert.deepEqual(workerOps(f),['open'],'handshake pending at open');
   await f.api.clearClickIds();await waiting;await new Promise(r=>setTimeout(r,400));await f.settle();
   assert.deepEqual(workerOps(f).filter(op=>op==='read'||op==='confirm'),[],'fenced handshake must not proceed');
   assert.equal(f.workerStorage.has(CLEAR),false);assert.equal(f.workerStorage.has(KEY),false);
   assert.equal(f.api.getStoredClickIds(undefined,true),null);
  }finally{f.close();}
 });
}

// B4g stored explicit denial (never admitted): clear is inert and no late admission occurs.
for(const packed of [false,true]) test('B4g clear under stored denial opens nothing, writes nothing, never admits later '+(packed?'packed':'source'),async()=>{
 const f=await fixture({packed,denied:true,query:'gclid=DENIED_ID'});
 try{
  await f.api.waitForClickAttribution();assert.equal(f.api.getStoredClickIds(),null);
  const before=workerOps(f).length;await f.api.clearClickIds();await f.api.clearClickIds({gclid:'DENIED_ID'});await f.settle();
  assert.deepEqual(workerOps(f).slice(before),[]);
  assert.equal(f.workerStorage.has(CLEAR),false);assert.equal(f.workerStorage.has(KEY),false);assert.equal(f.storage.has(KEY),false);
  await new Promise(r=>setTimeout(r,300));await f.settle();
  assert.equal(f.api.getStoredClickIds(undefined,true),null,'no late admission');
 }finally{f.close();}
});
