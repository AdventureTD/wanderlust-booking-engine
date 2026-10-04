'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const file=path.join(__dirname,'../velo/public/paidTouchState.js');
const DAY=86400000,NOW=1800000000000;
const touch=(id,at=NOW,provider='gclid')=>({capturedAt:new Date(at).toISOString(),gclid:'',gbraid:'',wbraid:'',msclkid:'',[provider]:id});
async function api(){const m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'));await m.link(()=>{throw Error('No imports permitted');});await m.evaluate();return m.namespace;}
const plain=x=>JSON.parse(JSON.stringify(x));
test('paid touch pure state: second paid click preserves first and advances latest',async()=>{
 const a=await api(),first=touch('INERT_FIRST',NOW-14*DAY),next=touch('INERT_SECOND');
 assert.deepEqual(plain(a.capturePaidTouch(first,next,NOW)),{v:1,first,latest:next});
});
test('direct day-14 visit and repeated identical click do not renew original timestamps',async()=>{
 const a=await api(),first=touch('INERT_FIRST',NOW-14*DAY);
 assert.deepEqual(plain(a.capturePaidTouch(first,null,NOW)),{v:1,first,latest:first});
 assert.deepEqual(plain(a.capturePaidTouch(first,touch('INERT_FIRST'),NOW)),{v:1,first,latest:first});
});
test('Microsoft after Google stays a separate landing bundle',async()=>{
 const a=await api(),first=touch('INERT_GOOGLE',NOW-DAY),latest=touch('INERT_MS',NOW,'msclkid');
 const state=a.capturePaidTouch(first,latest,NOW);
 assert.deepEqual(plain(state),{v:1,first,latest});
 assert.equal(state.latest.gclid,'');assert.equal(state.first.msclkid,'');
});
test('expired first is removed without promoting valid latest into first',async()=>{
 const a=await api(),latest=touch('INERT_LATEST',NOW-DAY);
 const state=a.normalizePaidTouches({v:1,first:touch('INERT_FIRST',NOW-91*DAY),latest},NOW);
 assert.deepEqual(plain(state),{v:1,first:null,latest});
 assert.equal(a.capturePaidTouch(state,touch('INERT_THIRD'),NOW).first,null);
});
test('entire expired lifetime clears and next paid touch starts a new lifetime',async()=>{
 const a=await api(),expired={v:1,first:touch('INERT_FIRST',NOW-92*DAY),latest:touch('INERT_LAST',NOW-91*DAY)};
 assert.equal(a.normalizePaidTouches(expired,NOW),null);
 const next=touch('INERT_NEW');assert.deepEqual(plain(a.capturePaidTouch(expired,next,NOW)),{v:1,first:next,latest:next});
});
test('90-day equality is retained; next millisecond expires',async()=>{
 const a=await api(),first=touch('INERT_FIRST',NOW-90*DAY);
 assert.ok(a.normalizePaidTouches(first,NOW));assert.equal(a.normalizePaidTouches(first,NOW+1),null);
});
test('legacy migration preserves exact timestamp and absent fields without invented history',async()=>{
 const a=await api(),legacy={capturedAt:new Date(NOW-DAY).toISOString(),gbraid:'INERT_BRAID'};
 const migrated=a.normalizePaidTouches(legacy,NOW);
 assert.equal(migrated.first.capturedAt,legacy.capturedAt);assert.equal(migrated.first.gbraid,legacy.gbraid);
 assert.deepEqual(plain(migrated.first),plain(migrated.latest));
 assert.equal(a.normalizePaidTouches({gclid:'INERT_NO_TIME'},NOW),null);
});
test('malformed first must fail closed rather than masquerade as expired',async()=>{
 const a=await api();
 assert.equal(a.normalizePaidTouches({v:1,first:{...touch('INERT_FIRST'),gclid:['bad']},latest:touch('INERT_LAST')},NOW),null);
});
test('unknown fields, oversized IDs, controls and future timestamps are rejected',async()=>{
 const a=await api();
 for(const bad of [{...touch('INERT_FIRST'),url:'https://example.invalid/?private=1'},touch('x'.repeat(513)),touch('bad\nvalue'),touch('INERT_FUTURE',NOW+1)])assert.equal(a.normalizePaidTouches(bad,NOW),null);
 assert.equal(a.normalizePaidTouches({v:2,first:touch('INERT_FIRST'),latest:touch('INERT_LAST')},NOW),null);
 assert.equal(a.normalizePaidTouches(touch('INERT_FIRST'),NaN),null);
});
test('partition reconciliation preserves earliest first and latest independent landing',async()=>{
 const a=await api(),first=touch('INERT_FIRST',NOW-14*DAY),middle=touch('INERT_MIDDLE',NOW-DAY),latest=touch('INERT_MS',NOW,'msclkid');
 const left={v:1,first,latest:middle},right={v:1,first:middle,latest};
 for(const pair of [[left,right],[right,left]])assert.deepEqual(plain(a.reconcilePaidTouches(...pair,NOW)),{v:1,first,latest});
});
test('partition duplicate landing preserves the earliest observed click time',async()=>{
 const a=await api(),first=touch('INERT_FIRST',NOW-14*DAY),copy=touch('INERT_FIRST',NOW-DAY);
 assert.deepEqual(plain(a.reconcilePaidTouches(first,copy,NOW)),{v:1,first,latest:first});
});
test('out-of-order capture cannot move latest backwards',async()=>{
 const a=await api(),first=touch('INERT_FIRST',NOW-14*DAY),latest=touch('INERT_LATEST'),state={v:1,first,latest};
 assert.deepEqual(plain(a.capturePaidTouch(state,touch('INERT_STALE',NOW-DAY),NOW)),state);
});
test('all supported Google identifier kinds and literal plus are preserved',async()=>{
 const a=await api();for(const key of ['gclid','gbraid','wbraid']){
  const first=touch('INERT+A%2B',NOW,key);assert.equal(a.capturePaidTouch(null,first,NOW).first[key],'INERT+A%2B');
 }
});
test('inherited identifiers and accessors cannot supply reporting data',async()=>{
 const a=await api();let getters=0;
 const inherited=Object.create(touch('INERT_INHERITED'));
 assert.equal(a.normalizePaidTouches(inherited,NOW),null);
 const getter={...touch('INERT_FIRST')};Object.defineProperty(getter,'gclid',{enumerable:true,get(){getters++;return 'INERT_GETTER';}});
 assert.equal(a.normalizePaidTouches(getter,NOW),null);assert.equal(getters,0);
 const envelope={first:touch('INERT_FIRST'),latest:touch('INERT_LAST')};Object.defineProperty(envelope,'v',{enumerable:true,get(){getters++;return 1;}});
 assert.equal(a.normalizePaidTouches(envelope,NOW),null);assert.equal(getters,0);
});
test('returned snapshots are detached from input and from each other',async()=>{
 const a=await api(),first=touch('INERT_FIRST'),state=a.normalizePaidTouches(first,NOW);
 state.latest.gclid='INERT_MUTATED';assert.equal(state.first.gclid,'INERT_FIRST');assert.equal(first.gclid,'INERT_FIRST');
});
