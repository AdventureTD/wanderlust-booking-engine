'use strict';
// Actual Head -> relay -> policy producer -> worker. All network entry is denied.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./attribution-clock-v2.cjs');
const KEY='wl_click_attribution';
const touch=(id,days=0,provider='gclid')=>({capturedAt:new Date(Date.now()-days*86400000-1000).toISOString(),gclid:'',gbraid:'',wbraid:'',msclkid:'',[provider]:id});
const state=(first,latest=first)=>({v:1,first,latest});
const stored=value=>[[KEY,JSON.stringify(value)]];
for(const packed of [false,true]) {
 const label=packed?'packed':'source';
 test('actual multi-touch direct/reload and Microsoft do not reset or mix bundles '+label,async()=>{
  const original=touch('FIRST',14),latest=touch('SECOND',2);
  for(const query of ['', 'gclid=SECOND','msclkid=MICROSOFT']) {
   const f=await fixture({packed,query,pageStorage:stored(state(original,latest))});
   try{await f.api.waitForClickAttribution();const s=f.api.getStoredClickIds();assert.equal(s.gclid,'FIRST');assert.equal(s.capturedAt,original.capturedAt);assert.ok(Object.isFrozen(s.paidTouches.latest));
    assert.equal(s.paidTouches.latest.gclid,query.startsWith('msclkid')?'':'SECOND');assert.equal(s.paidTouches.latest.msclkid,query.startsWith('msclkid')?'MICROSOFT':'');
    if(!query.startsWith('msclkid'))assert.equal(s.paidTouches.latest.capturedAt,latest.capturedAt);
    assert.equal(f.counts().externalCalls,0);
   }finally{f.close();}
  }
 });
 test('actual multi-touch legacy migration and partition reconciliation '+label,async()=>{
  const first=touch('FIRST',20),later=touch('LATER',1);
  for(const reverse of [false,true]){const f=await fixture({packed,pageStorage:stored(reverse?first:later),workerStorage:stored(reverse?later:first)});try{await f.api.waitForClickAttribution();const s=f.api.getStoredClickIds();assert.equal(s.gclid,'FIRST');assert.equal(s.paidTouches.first.capturedAt,first.capturedAt);assert.equal(s.paidTouches.latest.gclid,'LATER');assert.equal(s.paidTouches.latest.capturedAt,later.capturedAt)}finally{f.close()}}
 });
 test('actual multi-touch independently expires first without latest conversion promotion '+label,async()=>{
  const f=await fixture({packed,pageStorage:stored(state(touch('EXPIRED',91),touch('LATEST',1)))});try{await f.api.waitForClickAttribution();const s=f.api.getStoredClickIds();assert.equal(s.gclid,'');assert.equal(s.paidTouches.first,null);assert.equal(s.paidTouches.latest.gclid,'LATEST');await f.api.clearClickIds(s);assert.equal(f.storage.has(KEY),false);assert.equal(f.workerStorage.has(KEY),false)}finally{f.close()}
 });
 test('actual multi-touch denial and suspension erase both nested stores '+label,async()=>{
  const value=state(touch('FIRST',20),touch('LATEST',1));
  const f=await fixture({packed,denied:true,pageStorage:stored(value),workerStorage:stored(value)});try{await f.api.waitForClickAttribution();assert.equal(f.api.getStoredClickIds(),null);assert.equal(f.storage.has(KEY),false);assert.equal(f.workerStorage.has(KEY),false)}finally{f.close()}
  const g=await fixture({packed,pageStorage:stored(value)});try{await g.api.waitForClickAttribution();const s=g.api.getStoredClickIds();g.api.setSuspendGoogleAds(true);assert.equal(g.api.getStoredClickIds(s),null);assert.equal(g.workerStorage.has(KEY),false);assert.equal(g.storage.has(KEY),false);await g.api.clearClickIds(s);assert.equal(g.workerStorage.has('wl_click_attribution_clear_pending'),false,'late upload must not restore private pending-clear data after suspension')}finally{g.close()}
 });
 test('actual multi-touch old successful upload cannot erase newer latest with same first '+label,async()=>{
  const first=touch('FIRST',20),latest=touch('LATEST',1),fresh=touch('NEWEST');
  const f=await fixture({packed,pageStorage:stored(state(first,latest))});try{await f.api.waitForClickAttribution();const old=f.api.getStoredClickIds();f.storage.set(KEY,JSON.stringify(state(first,fresh)));await f.api.clearClickIds(old);assert.equal(JSON.parse(f.storage.get(KEY)).latest.gclid,'NEWEST');await f.api.waitForClickAttribution();assert.equal(f.api.getStoredClickIds().paidTouches.latest.gclid,'NEWEST');assert.equal(f.api.getStoredClickIds().gclid,'FIRST');assert.equal(f.api.getStoredClickIds(old),null)}finally{f.close()}
 });
 test('actual multi-touch rejects legacy response schema and nested mutation '+label,async()=>{
  const f=await fixture({packed,query:'gclid=FIRST',beforeAck:d=>{if(d.type==='wbe-click-attribution-result')delete d.schema}});try{await f.api.waitForClickAttribution();assert.equal(f.api.getStoredClickIds(),null)}finally{f.close()}
  const g=await fixture({packed,query:'gclid=FIRST',afterAck:d=>{if(d.op==='confirm'&&d.record)d.record.latest.gclid='MUTATED'}});try{await g.api.waitForClickAttribution();assert.equal(g.api.getStoredClickIds().paidTouches.latest.gclid,'FIRST')}finally{g.close()}
 });
}
for(const packed of [false,true]) test('subsequent Google touch is retained without changing outbound first touch '+(packed?'packed':'source'),async()=>{
 const first=await fixture({query:'gclid=INERT_FIRST',packed});
 let storage,original;
 try {
  await first.api.waitForClickAttribution();
  original=first.api.getStoredClickIds();
  assert.equal(original.gclid,'INERT_FIRST');
  storage=[...first.storage];
  assert.equal(first.counts().externalCalls,0);
 } finally {first.close();}
 const second=await fixture({query:'gclid=INERT_SECOND',pageStorage:storage,packed});
 try {
  await second.api.waitForClickAttribution();
  const snapshot=second.api.getStoredClickIds();
  assert.equal(snapshot.gclid,'INERT_FIRST','outbound attribution must remain first-touch');
  assert.equal(snapshot.capturedAt,original.capturedAt,'original time is immutable');
  assert.equal(snapshot.paidTouches?.latest?.gclid,'INERT_SECOND','actual second paid landing must survive the bound handshake');
  assert.equal(snapshot.paidTouches.first.gclid,'INERT_FIRST');
  assert.equal(second.counts().externalCalls,0);
  assert.ok(second.storage.has(KEY));
 } finally {second.close();}
});
