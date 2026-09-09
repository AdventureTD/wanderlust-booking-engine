'use strict';
// Authoring candidate only. Backend selectors require independent exact-byte admission.
// --fixture-only never creates/links/evaluates a backend module.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const completed = [];
async function test(id, fn) { await fn(); completed.push(id); console.log('PASS', id); }
function sdk() {
 const db = new Map(), trace = []; let hook = async () => {};
 const rows = c => { if (!db.has(c)) db.set(c, new Map()); return db.get(c); };
 const api = {
  query(c) {
   const filters = []; let sort = null, size = 50;
   const q = {
    eq(k,v) { filters.push(['eq',k,v]); return q; },
    gt(k,v) { filters.push(['gt',k,v]); return q; },
    ascending(k) { sort = [k,1]; return q; },
    descending(k) { sort = [k,-1]; return q; },
    limit(n) { size=n; return q; },
    async find(options) {
     const call = {op:'find',c,filters:structuredClone(filters),sort,size,options}; trace.push(call);
     await hook('read',call);
     let values = [...rows(c).values()].filter(r=>filters.every(([op,k,v])=>op==='eq'?r[k]===v:r[k]>v));
     if(sort) values.sort((a,b)=>(a[sort[0]]<b[sort[0]]?-1:a[sort[0]]>b[sort[0]]?1:0)*sort[1]);
     const more=values.length>size;
     return {items:structuredClone(values.slice(0,size)),hasNext(){return more;}};
    }
   }; return q;
  },
  async insert(c,r,options) {
   const call={op:'insert',c,row:structuredClone(r),options}; trace.push(call);
   await hook('before',call);
   if(rows(c).has(r._id)) throw Error('duplicate');
   rows(c).set(r._id,structuredClone(r));
   await hook('after',call);
   return structuredClone(r);
  }
 };
 return {api,db,trace,rows,setHook(fn){hook=fn;}};
}
function resolveBackend(spec, parent) {
 let p;
 if(spec.startsWith('backend/')) p=path.join(root,'velo',spec);
 else if(spec.startsWith('./')||spec.startsWith('../')) p=path.resolve(path.dirname(parent),spec);
 else throw Error('unadmitted import '+spec);
 if(!p.endsWith('.js')) p+='.js';
 const base=path.join(root,'velo','backend')+path.sep;
 if(!p.startsWith(base)) throw Error('path escape');
 return p;
}
async function loadRecovery(storage, discovery, coordinator) {
 // This deliberately labelled orchestration seam is NOT P2-04/P2-05 evidence.
 const context=vm.createContext({console,TextEncoder,Buffer}); const cache=new Map();
 const synthetic=(id,exports)=>new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context,identifier:id});
 async function load(file) {
  if(cache.has(file))return cache.get(file);
  const m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file});cache.set(file,m);
  await m.link(async(spec,parent)=>{
   if(spec==='wix-data')return synthetic(spec,{default:storage.api});
   if(spec==='backend/guestBookingAcceptanceDiscovery')return synthetic(spec,{discoverGuestBookingAcceptances:discovery});
   if(spec==='backend/guestBookingPhysicalAcquisition')return synthetic(spec,{resumeGuestBookingPhysicalAcquisition:coordinator});
   return load(resolveBackend(spec,parent.identifier));
  });return m;
 }
 const m=await load(path.join(root,'velo/backend/guestBookingCompletionRecovery.js'));await m.evaluate();return m.namespace;
}
const A='a'.repeat(64), B='b'.repeat(64);
function page(ids, invalid=[], exhausted=true) {
 return {status:'PAGE',sourceIds:ids,sourceCount:ids.length,contexts:ids.filter(id=>!invalid.includes(id)).map(acceptanceId=>({acceptanceId})),invalid,nextCursor:exhausted?null:ids.at(-1),exhausted};
}
async function fixtures() {
 await test('P2-F01-conjunctive-query-order',async()=>{
  const s=sdk();for(const r of [{_id:'a',kind:'x'},{_id:'b',kind:'y'},{_id:'c',kind:'x'}])await s.api.insert('c',r,{});
  const p=await s.api.query('c').eq('kind','x').gt('_id','a').ascending('_id').limit(1).find({});
  assert.deepEqual(p.items,[{_id:'c',kind:'x'}]);assert.equal(p.hasNext(),false);
 });
 await test('P2-F02-native-values-unique-lost-ACK',async()=>{
  const s=sdk();s.setHook(async phase=>{if(phase==='after')throw Error('lost ACK');});
  await assert.rejects(s.api.insert('c',{_id:'kept',n:-0,date:new Date(0)},{}));
  s.setHook(async()=>{});await assert.rejects(s.api.insert('c',{_id:'kept',n:2},{}));
  await s.api.insert('other',{_id:'kept'},{});
  const p=await s.api.query('c').eq('_id','kept').limit(2).find({});assert(Object.is(p.items[0].n,-0));assert(p.items[0].date instanceof Date);
  p.items[0].n=3;assert(Object.is(s.rows('c').get('kept').n,-0));
 });
 await test('P2-F03-canonical-loader-paths',async()=>{
  const parent=path.join(root,'velo/backend/guestBookingCompletionRecovery.js');
  assert.equal(resolveBackend('backend/guestBookingRecoveryProgressStore',parent),resolveBackend('./guestBookingRecoveryProgressStore.js',parent));
  assert.throws(()=>resolveBackend('../../outside',parent));
 });
}
function progressRow(sequence,sweep,afterSourceId,classifiedSourceId=A,classification='COORDINATOR_RETURNED') {
 return {_id:'gbrp1-'+String(sequence).padStart(16,'0'),schemaVersion:1,kind:'completion-recovery-progress',stream:'guest-booking-acceptances/v1',sequence,previousId:sequence===1?null:'gbrp1-'+String(sequence-1).padStart(16,'0'),sweep,afterSourceId,classifiedSourceId,classification};
}
async function orchestration() {
 // Authored before S1 correction; backend execution remains NOTRUN pending admission.
 await test('P2-06-invalid-initial-history-before-work',async()=>{
  const histories=[
   [progressRow(1,99,A),progressRow(2,99,B,B)], // S1 original witness.
   [progressRow(1,1,A),progressRow(2,1,B,B)], // Nonrotation cannot consume every sequence.
   [progressRow(1,0,null),progressRow(2,0,B,B)], // Rotation must have incremented sweep.
   [progressRow(2,3,null),progressRow(3,3,B,B)], // Bound applies beyond initialization.
   [progressRow(2,2,A),progressRow(3,2,B,B)],
   [progressRow(2,0,null),progressRow(3,0,B,B)]
  ];
  // Exercise invalid sequence-1 as both head and immediate predecessor.
  histories.push(...histories.slice(0,3).map(rows=>[rows[0]]));
  for(const rows of histories){
   const s=sdk();for(const row of rows)s.rows('GuestBookingRecoveryProgress').set(row._id,structuredClone(row));
   const retained=structuredClone([...s.rows('GuestBookingRecoveryProgress')]);let discovery=0,coordinator=0;
   const m=await loadRecovery(s,async()=>{discovery++;return page([B]);},async()=>{coordinator++;});
   assert.equal((await m.recoverGuestBookingCompletions()).status,'UNRESOLVED');
   assert.equal(discovery,0);assert.equal(coordinator,0);assert.equal(s.trace.some(t=>t.op==='insert'),false);
   assert.deepEqual([...s.rows('GuestBookingRecoveryProgress')],retained);
  }
 });
 await test('P2-06-compatible-initial-and-successor',async()=>{
  for(const mode of ['nonrotation','final-item','empty']){
   const s=sdk();let visits=0;
   let m=await loadRecovery(s,async cursor=>{assert.equal(cursor,null);return page(mode==='empty'?[]:mode==='final-item'?[A]:[A,B]);},async id=>{assert.equal(id,A);visits++;return {status:'UNKNOWN'};});
   assert.equal((await m.recoverGuestBookingCompletions()).status,'ADVANCED');
   const first=structuredClone([...s.rows('GuestBookingRecoveryProgress').values()][0]);
   assert.equal(first.sequence,1);assert.equal(first.sweep,mode==='nonrotation'?0:1);assert.equal(first.afterSourceId,mode==='nonrotation'?A:null);
   m=await loadRecovery(s,async cursor=>{assert.equal(cursor,first.afterSourceId);return page([B]);},async id=>{assert.equal(id,B);visits++;return {status:'UNKNOWN'};});
   assert.equal((await m.recoverGuestBookingCompletions()).status,'ADVANCED');
   const second=s.rows('GuestBookingRecoveryProgress').get(progressRow(2,0,null)._id);
   assert.equal(second.previousId,first._id);assert.equal(second.sequence,2);assert.equal(second.sweep,first.sweep+1);assert.equal(second.afterSourceId,null);assert.equal(second.classifiedSourceId,B);
   assert.deepEqual(s.rows('GuestBookingRecoveryProgress').get(first._id),first);
   assert.equal(visits,mode==='empty'?1:2);assert.equal(s.trace.filter(t=>t.op==='insert').length,2);
  }
 });
 await test('P2-06-compatible-sweep-exhaustion-suffix',async()=>{
  // Synthetic counter mechanism only: omitted prefix consists of empty rotations.
  // NOT actual producer growth, nor evidence of native capacity at this length.
  const s=sdk(), max=Number.MAX_SAFE_INTEGER;
  for(const n of [max-2,max-1]){const row=progressRow(n,n,null,null,'EMPTY_SWEEP');s.rows('GuestBookingRecoveryProgress').set(row._id,structuredClone(row));}
  const prefix=structuredClone([...s.rows('GuestBookingRecoveryProgress')]);let discovery=0,coordinator=0;
  let m=await loadRecovery(s,async cursor=>{assert.equal(cursor,null);discovery++;return page([]);},async()=>{coordinator++;});
  assert.equal((await m.recoverGuestBookingCompletions()).status,'ADVANCED');
  assert.deepEqual(s.rows('GuestBookingRecoveryProgress').get(progressRow(max,max,null)._id),progressRow(max,max,null,null,'EMPTY_SWEEP'));
  for(const [id,row] of prefix)assert.deepEqual(s.rows('GuestBookingRecoveryProgress').get(id),row);
  assert.equal(s.trace.filter(t=>t.op==='insert').length,1);assert.equal(s.rows('GuestBookingRecoveryProgress').size,3);
  const retained=structuredClone([...s.rows('GuestBookingRecoveryProgress')]);s.trace.length=0;
  m=await loadRecovery(s,async()=>{discovery++;return page([]);},async()=>{coordinator++;});
  assert.equal((await m.recoverGuestBookingCompletions()).status,'UNRESOLVED');assert.equal(discovery,1);assert.equal(coordinator,0);
  assert.equal(s.trace.some(t=>t.op==='insert'),false);assert.deepEqual([...s.rows('GuestBookingRecoveryProgress')],retained);
  // sweep=max implies sequence=max: sequence exhaustion dominates isolation of sweep guard.
 });
 await test('P2-01-partition-denial',async()=>{
  for(const bad of [{...page([A]),sourceCount:2},{...page([A]),contexts:[]},{...page([A]),invalid:[A]},{...page([A]),nextCursor:A},{...page([A]),sourceIds:[B,A]}]){
   const s=sdk();let calls=0;const m=await loadRecovery(s,async()=>bad,async()=>{calls++;});
   assert.equal((await m.recoverGuestBookingCompletions()).status,'INTEGRITY');assert.equal(calls,0);assert.equal(s.trace.filter(x=>x.op==='insert').length,0);
  }
 });
 await test('P2-02-poison-tail-restart-lower-ID',async()=>{
  const s=sdk(),visited=[];let ids=['!',A,B];
  const discovery=async cursor=>page(ids.filter(id=>cursor===null||id>cursor),['!'].filter(id=>cursor===null||id>cursor));
  const coordinator=async id=>{visited.push(id);if(id===A)throw Error('poison');return {status:'UNKNOWN'};};
  for(let i=0;i<3;i++){const m=await loadRecovery(s,discovery,coordinator);assert.equal((await m.recoverGuestBookingCompletions()).status,'ADVANCED');}
  assert.deepEqual(visited,[A,B]);assert.equal(s.rows('GuestBookingRecoveryProgress').size,3);
  ids=['0'.repeat(64),...ids].sort();for(let i=0;i<2;i++){const m=await loadRecovery(s,discovery,coordinator);await m.recoverGuestBookingCompletions();}
  assert.equal(visited.at(-1),'0'.repeat(64));
 });
 await test('P2-03-applied-lost-ACK-readback',async()=>{
  const s=sdk();s.setHook(async(phase,c)=>{if(phase==='after'&&c.c==='GuestBookingRecoveryProgress')throw Error('lost ACK');});
  const m=await loadRecovery(s,async()=>page([A,B]),async()=>({status:'UNKNOWN'}));
  assert.equal((await m.recoverGuestBookingCompletions()).status,'ADVANCED');assert.equal(s.rows('GuestBookingRecoveryProgress').size,1);
 });
 await test('P2-03-stalled-worker-collision',async()=>{
  const s=sdk();let release,entered;const paused=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let first=true;
  s.setHook(async(phase,c)=>{if(phase==='before'&&c.c==='GuestBookingRecoveryProgress'&&first){first=false;entered();await gate;}});
  const timer=setTimeout(()=>release(),2000);
  try{
   const a=await loadRecovery(s,async()=>page([A,B]),async()=>({status:'UNKNOWN'}));
   const b=await loadRecovery(s,async()=>page([A,B]),async()=>({status:'UNKNOWN'}));
   const pending=a.recoverGuestBookingCompletions();await paused;assert.equal((await b.recoverGuestBookingCompletions()).status,'ADVANCED');release();assert.equal((await pending).status,'ADVANCED');
   assert.equal(s.rows('GuestBookingRecoveryProgress').size,1);assert.equal(s.trace.filter(x=>x.op==='insert').length,2);
  }finally{release();clearTimeout(timer);}
 });
 await test('P2-02-unreadable-tail-preserves-checkpoint',async()=>{
  const s=sdk();let calls=0;
  let m=await loadRecovery(s,async()=>page([A,B]),async()=>{calls++;return {status:'UNKNOWN'};});
  await m.recoverGuestBookingCompletions();const retained=structuredClone([...s.rows('GuestBookingRecoveryProgress')]);
  m=await loadRecovery(s,async cursor=>{assert.equal(cursor,A);throw Error('unreadable tail');},async()=>{calls++;});
  assert.equal((await m.recoverGuestBookingCompletions()).status,'UNRESOLVED');assert.equal(calls,1);assert.deepEqual([...s.rows('GuestBookingRecoveryProgress')],retained);
 });
 await test('P2-03-preinsert-and-ACK-readback-faults',async()=>{
  for(const phase of ['before','readback']){
   const s=sdk();let attempted=false;
   s.setHook(async(p,c)=>{if(c.c!=='GuestBookingRecoveryProgress')return;if(p==='before'){attempted=true;if(phase==='before')throw Error('before insert');}if(p==='read'&&attempted&&phase==='readback')throw Error('unreadable ACK');});
   const m=await loadRecovery(s,async()=>page([A,B]),async()=>({status:'UNKNOWN'}));
   assert.equal((await m.recoverGuestBookingCompletions()).status,'UNRESOLVED');assert.equal(s.rows('GuestBookingRecoveryProgress').size,phase==='before'?0:1);
   s.setHook(async()=>{});const fresh=await loadRecovery(s,async cursor=>{assert.equal(cursor,phase==='before'?null:A);return page(cursor===null?[A,B]:[B]);},async()=>({status:'UNKNOWN'}));
   assert.equal((await fresh.recoverGuestBookingCompletions()).status,'ADVANCED');
  }
 });
 await test('P2-03-different-successor-both-worker-orders',async()=>{
  for(const firstId of [A,B]){
   const s=sdk();let release,entered;const gate=new Promise(r=>release=r),paused=new Promise(r=>entered=r);let first=true;
   s.setHook(async(phase,c)=>{if(phase==='before'&&first){first=false;entered();await gate;}});
   const timer=setTimeout(()=>release(),2000);
   try{
    const a=await loadRecovery(s,async()=>page([firstId,'f'.repeat(64)]),async()=>({status:'UNKNOWN'}));
    const other=firstId===A?B:A;const b=await loadRecovery(s,async()=>page([other,'f'.repeat(64)]),async()=>({status:'UNKNOWN'}));
    const pending=a.recoverGuestBookingCompletions();await paused;assert.equal((await b.recoverGuestBookingCompletions()).status,'ADVANCED');release();assert.equal((await pending).status,'CONTENTION');
    const winner=[...s.rows('GuestBookingRecoveryProgress').values()];assert.equal(winner.length,1);assert.equal(winner[0].classifiedSourceId,other);assert.equal(s.trace.filter(x=>x.op==='insert').length,2);
   }finally{release();clearTimeout(timer);}
  }
 });
 await test('P2-06-predecessor-gap-counter-no-rollover',async()=>{
  const progress=(sequence,sweep,afterSourceId,classifiedSourceId=A)=>({_id:'gbrp1-'+String(sequence).padStart(16,'0'),schemaVersion:1,kind:'completion-recovery-progress',stream:'guest-booking-acceptances/v1',sequence,previousId:sequence===1?null:'gbrp1-'+String(sequence-1).padStart(16,'0'),sweep,afterSourceId,classifiedSourceId,classification:'COORDINATOR_RETURNED'});
  // Replaces impossible sequence-1/high-sweep history with compatible empty-rotation suffix.
  for(const rows of [[progress(2,0,B,B)],[progress(Number.MAX_SAFE_INTEGER-1,0,A),progress(Number.MAX_SAFE_INTEGER,0,B,B)],[progressRow(Number.MAX_SAFE_INTEGER-1,Number.MAX_SAFE_INTEGER-1,null,null,'EMPTY_SWEEP'),progressRow(Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,null,null,'EMPTY_SWEEP')]]){
   const s=sdk();for(const row of rows)s.rows('GuestBookingRecoveryProgress').set(row._id,structuredClone(row));
   const retained=structuredClone([...s.rows('GuestBookingRecoveryProgress')]);let discovery=0,coordinator=0;
   const m=await loadRecovery(s,async()=>{discovery++;return page([A]);},async()=>{coordinator++;});
   assert.equal((await m.recoverGuestBookingCompletions()).status,'UNRESOLVED');assert.equal(discovery,0);assert.equal(coordinator,0);assert.equal(s.trace.some(t=>t.op==='insert'),false);assert.deepEqual([...s.rows('GuestBookingRecoveryProgress')],retained);
  }
 });
 await test('P2-06-head-shape-no-arguments',async()=>{
  const s=sdk();let calls=0;const m=await loadRecovery(s,async()=>page([]),async()=>{calls++;});
  assert.equal((await m.recoverGuestBookingCompletions('caller')).status,'INTEGRITY');assert.equal(s.trace.length,0);
  await m.recoverGuestBookingCompletions();assert.equal(calls,0);
  const q=s.trace.find(x=>x.op==='find');assert.deepEqual(q.filters,[['eq','stream','guest-booking-acceptances/v1']]);assert.deepEqual(q.sort,['sequence',-1]);assert.equal(q.size,2);
 });
}
// P2 actual-producer declarations and selectors are independently gated NOTRUN.
const crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
// Source integrity permits CRLF-to-LF only; no trimming or other normalization.
const canonicalSource=text=>text.replace(/\r\n/g,'\n');
// Exact declaration prefix from the frozen producer; no standalone suite dependency.
const prefixPin='97fa4ede51900253b49219b4ed2911641a77934a89830594bc04c04e5fda950b';
const actualIds=['P2-04','P2-05'];
// Complete source closure pins below are provenance/admission inputs, NOT approval.
const actualPins={
 "velo/backend/guestBookingAllocationHandoff.js": "0e8ebc09ad6676a9c4657bc8eb2194cad4008aa4b5902cc091997f8ae8b5fe37",
 "velo/backend/wholeCartPlanningRules.js": "a73d3daf474611cd19f25d18a332a650769bdcf585017cd61cb7fef0dc38bcc3",
 "velo/backend/roomBookingCommitRules.js": "3938448cc041e0f0e811248e97033094df66c7536222c087d2a9a02945bd5893",
 "velo/backend/roomAvailabilityRules.js": "578b42bcc63c28720b9a08aae9dea42761a42febcfc62449efe5313a7164b6f4",
 "velo/backend/roomAssignmentRules.js": "9d685cc29821181e482c84cf1d9ecf0fd463fc03dbf12617d3fcfb76e9dd46b2",
 "velo/backend/guestBookingAllocationSourceRules.js": "013655a68168c376d0ca98b452f48042b53ef21cbb403bf361a36a98aa48aa08",
 "velo/backend/guestBookingAllocationRetainedRules.js": "4c84039c5c72e3958fdcf3b30e6466c440dabe726009f25720fb5030bafd1b8c",
 "velo/backend/roomInventoryRules.js": "6bc0520cb3940b0399f43d8f5df7b493c666f221621bb80bc3e7004c8de89899",
 "velo/backend/guestBookingAllocationEvidence.js": "e2c35347407326b4b7acf84d1bd77f5163030b20cef74ad098e4ba6486d948e5",
 "velo/backend/guestBookingAllocationManifestRules.js": "fb5e7ed1f3c4bda3866c3a9baecbfc3adaa045432a0bce3b28c66a2f7c267b4f",
 "velo/backend/guestBookingAllocationManifestStore.js": "e26fd317eb167f867c71b30c2461c6aa890e6186d33b5e61d3fe90352bceedb1",
 "velo/backend/guestBookingAcceptance.js": "b15c33c3206ac851d8de9fdc04349488f2a31b3b8b5100b07f3b28f4fee38df2",
 "velo/backend/guestBookingAcceptanceStore.js": "3cb3f02fbb92168364c21169e30834ba75980768de35e14ca9a2b9f8aa25a75c",
 "velo/backend/guestBookingIssuerAuthority.js": "b5578ae7bcdef12eb54ad37f3775a5ac3ccccdbe292e89b4561ed5498804919b",
 "velo/backend/guestBookingCredentials.js": "c34364e2196a67016b4def3850149478015fd41d35a42fe5a590d2c6d5750c9f",
 "velo/backend/guestBookingAccessPolicy.js": "bbc14fb6951dbc7b677e9ca9202a2906d0da7bd5a2b322e56ca147e7e21dad35",
 "velo/backend/guestBookingOfferIssuer.js": "fc01e66d6cf480d352a29729e4350e49c0fe83db184185e220fd5e3a76e634c0",
 "velo/backend/lockedPricingQuoteAuthority.js": "d8520ba1bc16d829062760ce63ff3f5f7400363db3830b2f4d485b6a6b504d7c",
 "velo/backend/strictLockedPricingQuote.js": "da1c2c1f1e0b91adc37abd29c66e7fbc017c043094487917b2bb10920eae5b61",
 "velo/backend/guestBookingFinancialCalculation.js": "3dc9fae1c48a48e78b34608c57970e73fae546c65e7c3a31449359f01a67fe71",
 "velo/backend/guestBookingPriceGroups.js": "d787fea9c954650a7003953b9620e6862f4a44bcfa0b7e41818837d8ca3cfad8",
 "velo/backend/guestBookingPurchaseInput.js": "a3b3583d0971c06f36301aa948479315def667e0e73d4accb8c854daab17489a",
 "velo/backend/guestBookingCompletionRecovery.js": "8af55d7a97e02d43e115e86c17496a21ef23891d321d56beb0f37442342795e3",
 "velo/backend/guestBookingRecoveryProgressStore.js": "3a768b2810a7a135df99a369b4459f8c2bd48afac94147b7dce11e94ec2e3a98",
 "velo/backend/guestBookingPhysicalAcquisition.js": "77d8e4f9442f75be17659493451e6b4bb26662639a43bf4ed70f47e9930e1457",
 "velo/backend/guestBookingCompletionEvidence.js": "51971a8927e840a3f9c6909ad086965ce7027bbeda513e2e171ddea18607f195",
 "velo/backend/guestBookingCompletionStore.js": "cee5b0360854ff3f706b278aa0b03b1fe8502d9076966c17ad40d156c8a77dad",
 "velo/backend/guestBookingCompletionProjection.js": "c9202f6148155617d99de5250aae3a2edc6b5a527ed0f0ed8271c568dbd231b0",
 "velo/backend/guestBookingAcquisitionControlRules.js": "461939a94ee6790ad9442adde32b2abda51f6f1bb674462c5d7d6cc1dad5b728",
 "velo/backend/guestBookingPhysicalAcquisitionStore.js": "ac1192dfd8d59496faf86497d45782d06d6ddd776fe41c1ad6e2145e6da818cd",
 "velo/backend/guestBookingPhysicalAcquisitionEvidence.js": "012812cdfd2ec64514444d465599d92f0eed38512a6d76ee03e02df0b95bd7f5",
 "velo/backend/guestBookingAcquisitionContentionEvidence.js": "cf60a8effa91031a1f7c0b2f285479522cd8dc1acd2c364e2cd3dbf8593dcfc5",
 "velo/backend/guestBookingAcquisitionControlStore.js": "3fe95f600ebece33b6e10a340ed6fbc57e6bf2403d070ab9065f2af47d14817e",
 "velo/backend/guestBookingAcceptanceDiscovery.js": "bb29fdc98ce9b4d21d59fdb73c2856a0693d78721c58632153babf86faee649e"
};
const externalNames=['buffer','crypto','wix-auth','wix-data','wix-secrets-backend.v2'];
let backendLoads=0;
function producerDeclarations(){
 const prefix=canonicalSource(fs.readFileSync(path.join(__dirname,'fixtures/guest-booking-r2-producer-prefix.js'),'utf8'));
 assert.equal(sha(prefix),prefixPin);
 // Retain database/issue verbatim; replace ONLY the obsolete SDK/loader subject.
 const start=prefix.indexOf('function subject(db,hooks={})'),end=prefix.indexOf('async function issue(db,groups)');
 assert.ok(start>0&&end>start);
 const adapted=prefix.slice(0,start)+'function subject(db,hooks={}){return adaptedSubject(db,hooks);}\n'+prefix.slice(end);
 return vm.runInNewContext(adapted+';({database,issue})',{require,Buffer,console,__dirname,adaptedSubject:actualSubject});
}
function compileActual(file){
 const relative=path.relative(root,file).split(path.sep).join('/');
 assert.ok(Object.hasOwn(actualPins,relative),'unadmitted backend '+relative);
 const source=canonicalSource(fs.readFileSync(file,'utf8'));assert.equal(sha(source),actualPins[relative],relative);
 const imports=[],names=[];
 const body=source.replace(/^import (.+) from '([^']+)';$/gm,(_,binding,spec)=>{
  const key=externalNames.includes(spec)?spec:resolveBackend(spec,file);
  if(!externalNames.includes(spec))assert.ok(Object.hasOwn(actualPins,path.relative(root,key).split(path.sep).join('/')),'edge outside closure');
  imports.push({spec,key});return `const ${binding}=imports[${JSON.stringify(key)}];`;
 }).replace(/export (async )?function (\w+)/g,(_,asyncPart,name)=>{names.push(name);return (asyncPart||'')+'function '+name;});
 assert.equal(/\b(?:import|export)\s/.test(body.replace(/\/\/[^\n]*/g,'')),false,'unsupported module syntax');
 return {imports,script:new vm.Script('(function(imports){'+body+';return {'+names.join(',')+'};})',{filename:file})};
}
function actualSubject(db,hooks={}){
 const trace=[],calls=[],cache=new Map(),context=vm.createContext({Buffer,TextEncoder});
 context.clock=()=>hooks.recovery?1800000000000+864000000:1800000000000;
 vm.runInContext('Date.now=()=>clock()',context);
 // Allocate responses in the backend realm without JSON: preserve Date/-0/NaN,
 // null prototypes and own-data shape. Persistent storage/snapshots stay HOST realm.
 const clone=vm.runInContext(`(function copy(x){if(x===null||typeof x!=='object')return x;
 if(Object.prototype.toString.call(x)==='[object Date]')return new Date(x.getTime());
 const out=Array.isArray(x)?[]:Object.create(Object.getPrototypeOf(x)===null?null:Object.prototype);
 for(const k of Object.keys(x)){const d=Object.getOwnPropertyDescriptor(x,k);if(!('value'in d))throw Error('accessor fixture');out[k]=copy(d.value);}return out;})`,context);
 const rows=c=>{assert.ok(Object.hasOwn(db.rows,c),'unknown collection '+c);return db.rows[c];};
 const wix={query(c){const filters=[];let sort=null,size=50;const q={
  eq(k,v){filters.push(['eq',k,v]);return q;},gt(k,v){filters.push(['gt',k,v]);return q;},
  ascending(k){sort=[k,1];return q;},descending(k){sort=[k,-1];return q;},limit(n){size=n;return q;},
  async find(options){const call={op:'find',c,filters:structuredClone(filters),sort:structuredClone(sort),size,options:structuredClone(options)};trace.push(call);
   if(hooks.recovery&&['Settings','GuestBookingFinancialRevisions'].includes(c))throw Error('current settings unavailable');
   if(hooks.read)await hooks.read(call);
   let selected=rows(c).filter(r=>filters.every(([op,k,v])=>op==='eq'?r[k]===v:r[k]>v));
   if(sort)selected=selected.slice().sort((a,b)=>(a[sort[0]]<b[sort[0]]?-1:a[sort[0]]>b[sort[0]]?1:0)*sort[1]);
   const result={items:clone(selected.slice(0,size)),hasNext(){return selected.length>size;}};
   if(hooks.response)await hooks.response(call,result,clone);return result;
  }};return q;},
  async insert(c,r,options){const row=structuredClone(r),call={op:'insert',c,row,options:structuredClone(options)};trace.push(call);
   if(hooks.before)await hooks.before(call);if(rows(c).some(v=>v._id===row._id))throw Error('immutable duplicate');
   rows(c).push(structuredClone(row));call.applied=true;if(hooks.after)await hooks.after(call);return clone(row);
  }};
 for(const op of ['update','save','remove','bulkInsert','bulkUpdate','bulkRemove'])wix[op]=async(...args)=>{trace.push({op,args});throw Error('forbidden SDK mutation');};
 const modules={buffer:{Buffer},crypto,'wix-data':wix,'wix-auth':{elevate:f=>f},'wix-secrets-backend.v2':{secrets:{async getSecretValue(n){trace.push({op:'secret',n});if(hooks.recovery)throw Error('current secrets unavailable');return clone({value:n==='WBE_PRICING_QUOTE_SECRET'?'PUBLIC-ACCEPTANCE-QUOTE-FIXTURE-ONLY':n==='WBE_GUEST_BOOKING_ISSUER_CONFIG'?JSON.stringify(db.config):JSON.stringify(db.keys)});}}}};
 function load(spec,parent=path.join(root,'velo/backend/guestBookingCompletionRecovery.js')){
  if(externalNames.includes(spec))return modules[spec];
  const file=resolveBackend(spec,parent);if(cache.has(file))return cache.get(file);
  const compiled=compileActual(file),imports={};for(const edge of compiled.imports)imports[edge.key]=externalNames.includes(edge.key)?modules[edge.key]:load('./'+path.basename(edge.key),edge.key);
  backendLoads++;const api=compiled.script.runInContext(context)(imports);cache.set(file,api);
  // Transparent call observations, no returned page/evidence/coordinator replacement.
  for(const name of ['discoverGuestBookingAcceptances','resumeGuestBookingPhysicalAcquisition'])if(Object.hasOwn(api,name)){
   const invoke=api[name];api[name]=async function(...args){const call={name,args:structuredClone(args),start:trace.length};calls.push(call);const result=await invoke.apply(this,args);call.end=trace.length;call.result=structuredClone(result);return result;};
  }
  return api;
 }
 return {load,trace,calls,context,realm:clone,wix,loadedBackendNames:()=>[...cache.keys()]};
}
function actualDatabase(f){const db=structuredClone(f.database());db.rows.GuestBookingCompletions=[];db.rows.GuestBookingRecoveryProgress=[];return db;}
const businessRows=db=>{const out=structuredClone(db.rows);delete out.GuestBookingRecoveryProgress;return out;};
const mutations=s=>s.trace.filter(t=>t.op!=='find');
function exactRead(t,c,id){return t.op==='find'&&t.c===c&&t.filters.length===1&&t.filters[0][0]==='eq'&&t.filters[0][1]==='_id'&&t.filters[0][2]===id;}
function receiptFirst(s,A){const call=s.calls.find(c=>c.name==='resumeGuestBookingPhysicalAcquisition');assert.ok(call);assert.deepEqual(call.args,[A]);const first=s.trace[call.start];assert.ok(exactRead(first,'GuestBookingCompletions','gbc1-'+A));assert.deepEqual(first.options,{suppressAuth:true,suppressHooks:true,consistentRead:true});return call;}
async function recoveryTick(db,A,identities,hooks={}){
 const s=actualSubject(db,{...hooks,recovery:true});assert.equal(s.loadedBackendNames().length,0);
 assert.ok(!identities.has(s.context));identities.add(s.context);
 const api=s.load('backend/guestBookingCompletionRecovery');assert.ok(!identities.has(api));identities.add(api);
 for(const [name,method] of [['guestBookingCompletionRecovery','recoverGuestBookingCompletions'],['guestBookingAcceptanceDiscovery','discoverGuestBookingAcceptances'],['guestBookingPhysicalAcquisition','resumeGuestBookingPhysicalAcquisition']]){
  const module=s.load('backend/'+name);assert.equal(module,s.load('./'+name+'.js'));assert.ok(!identities.has(module[method]));identities.add(module[method]);
 }
 assert.equal(vm.runInContext('typeof window',s.context),'undefined');assert.equal(vm.runInContext('Date.now()',s.context)>1800000000000+360000,true);
 const before=structuredClone(db.rows.GuestBookingRecoveryProgress),r=await api.recoverGuestBookingCompletions();
 const discovery=s.calls.find(c=>c.name==='discoverGuestBookingAcceptances');
 if(hooks.noCoordinator){assert.equal(r.status,'UNRESOLVED');assert.equal(s.calls.some(c=>c.name==='resumeGuestBookingPhysicalAcquisition'),false);assert.deepEqual(mutations(s),[]);return s;}
 assert.equal(r.status,'ADVANCED');assert.ok(discovery);assert.equal(discovery.result.status,'PAGE');assert.deepEqual(discovery.result.sourceIds,[A]);assert.equal(discovery.result.contexts[0].acceptanceId,A);assert.equal(db.rows.GuestBookingAcceptances[0]._id,A);
 const call=receiptFirst(s,A),checkpoint=db.rows.GuestBookingRecoveryProgress.at(-1);
 assert.equal(checkpoint.classifiedSourceId,A);assert.equal(checkpoint.sequence,before.length+1);assert.equal(checkpoint.sweep,before.length+1);assert.equal(checkpoint.afterSourceId,null);
 assert.equal(checkpoint.classification,['UNKNOWN','UNRESOLVED'].includes(call.result.status)?'COORDINATOR_UNRESOLVED':'COORDINATOR_RETURNED');
 assert.deepEqual(db.rows.GuestBookingRecoveryProgress.slice(0,-1),before);
 const admin=mutations(s).filter(t=>t.c==='GuestBookingRecoveryProgress');assert.equal(admin.length,1);assert.equal(admin[0].op,'insert');assert.equal(admin[0].applied,true);assert.deepEqual(admin[0].row,checkpoint);
 assert.ok(s.trace.slice(s.trace.indexOf(admin[0])+1).some(t=>exactRead(t,admin[0].c,checkpoint._id)));
 assert.equal(s.trace.some(t=>t.op==='secret'||t.c==='Settings'||t.c==='GuestBookingFinancialRevisions'),false);
 return s;
}
async function nativeHistory(){
 const f=producerDeclarations(),db=actualDatabase(f);
 // Supported four physical rooms, three original groups, split same-class groups.
 const groups=[{roomCode:'adventure_suite',quantity:2,guests:2},{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:1,guests:2}];
 const {A,T}=await f.issue(db,groups);assert.match(A,/^[a-f0-9]{64}$/);assert.equal(db.rows.GuestBookingAcceptances[0]._id,A);
 const accepted=structuredClone(db.rows.GuestBookingAcceptances),manifest=structuredClone(db.rows.GuestBookingAllocationManifests),prefixes=[],steps=[],identities=new Set();
 // Expired clock, no browser globals, no guest credentials, no payment/settings/
 // marketing providers in recovery. Withdrawal is negative-only fixture environment,
 // NOT a fabricated retained permission record or completed-booking authority.
 db.guestEnvironment={browserAbsent:true,withdrawn:true,depositPaid:false};
 for(let n=0;n<200;n++){
  prefixes.push(structuredClone(db.rows));const before=businessRows(db),s=await recoveryTick(db,A,identities),call=receiptFirst(s,A);
  const writes=mutations(s).filter(t=>t.c!=='GuestBookingRecoveryProgress');assert.equal(writes.length,1,'one next native effect per quantum');
  const write=writes[0];assert.equal(write.op,'insert');assert.equal(write.applied,true);assert.equal(before[write.c].some(r=>r._id===write.row._id),false);
  before[write.c].push(structuredClone(write.row));assert.deepEqual(businessRows(db),before,'exact native delta only');
  assert.ok(s.trace.slice(s.trace.indexOf(write)+1,call.end).some(t=>exactRead(t,write.c,write.row._id)),'native exact readback');
  assert.deepEqual(db.rows.GuestBookingAcceptances,accepted);assert.deepEqual(db.rows.GuestBookingAllocationManifests,manifest);
  steps.push({status:call.result.status,c:write.c,row:structuredClone(write.row)});
  if(call.result.status==='CONFIRMED')break;assert.ok(['ACQUISITION_PENDING','COMPLETION_PENDING'].includes(call.result.status),JSON.stringify(call.result));
 }
 assert.equal(steps.at(-1).status,'CONFIRMED');assert.equal(db.rows.Bookings.length,4);assert.equal(db.rows.GuestBookingCompletions.length,1);
 const end=structuredClone(db.rows),receipt=end.GuestBookingCompletions[0],projection=JSON.parse(receipt.projectionCanonical),capsule=JSON.parse(accepted[0].capsule);
 assert.deepEqual(projection.summary.acceptedCalculation,capsule.calculation);assert.equal(projection.summary.acceptedCalculation.groups.length,3);
 assert.deepEqual(projection.summary.acceptedCalculation.groups.map(g=>g.roomCode),groups.map(g=>g.roomCode));
 // Independent Decimal/ROUND_HALF_UP public-input vector, not producer-derived totals.
 const cents=['grossCents','discountCents','roomTotalCents','propertyFeeCents','accommodationVatCents','packageVatCents','grandTotalCents'];
 assert.deepEqual(capsule.calculation.groups.map(g=>cents.map(k=>g[k])),[[40000, 0, 40000, 2000, 2000, 3000, 47000], [22001, 0, 22001, 1100, 1100, 1650, 25851], [20000, 0, 20000, 1000, 1000, 1500, 23500]]);
 assert.equal(receipt.recipient,'fixture@example.test');assert.equal(receipt.primaryBookingRowId,T[8]);assert.deepEqual(end.Bookings.map(r=>r._id),Array.from(T[7]));assert.equal(receipt._id,'gbc1-'+A);
 assert.equal(projection.plannedBookingRows.find(r=>r._id===T[8]).note,'Café 李');assert.equal(end.Bookings.every(r=>r.status==='pending'),true);
 // Explicit completed-prefix restart, not merely a changed boot identifier.
 const replay=await recoveryTick(db,A,identities);assert.equal(receiptFirst(replay,A).result.status,'CONFIRMED');assert.deepEqual(mutations(replay).filter(t=>t.c!=='GuestBookingRecoveryProgress'),[]);assert.deepEqual(businessRows(db),businessRows({rows:end}));
 return {db,A,T,prefixes,steps,end,identities};
}
async function p204(){await test('P2-04',async()=>{const h=await nativeHistory();assert.equal(h.prefixes.length,h.steps.length);assert.equal(h.steps.filter(t=>t.c==='Bookings').length,4);assert.equal(h.steps.filter(t=>t.c==='BookingSummary').length,1);assert.equal(h.steps.filter(t=>t.c==='GuestBookingCompletions').length,1);});}
async function p205(){await test('P2-05',async()=>{
 const h=await nativeHistory(),{db,A,end,identities}=h;
 async function deny(label,edit=()=>{},hooks={},expected=['UNKNOWN','INTEGRITY']){
  db.rows=structuredClone(end);edit(db.rows);const before=businessRows(db),raw=structuredClone(db.rows);
  const s=await recoveryTick(db,A,identities,hooks);
  if(!hooks.noCoordinator){assert.ok(expected.includes(receiptFirst(s,A).result.status),label);assert.deepEqual(mutations(s).filter(t=>t.c!=='GuestBookingRecoveryProgress'),[],label);}
  else assert.deepEqual(db.rows,raw,label);
  assert.deepEqual(businessRows(db),before,label);
 }
 await deny('receipt-unreadable',undefined,{read:async t=>{if(t.c==='GuestBookingCompletions')throw Error('native read fault');}},['UNKNOWN']);
 await deny('receipt-malformed',rows=>{rows.GuestBookingCompletions[0].outcome='BROKEN';});
 // Remove authentic immutable prerequisites only as NEGATIVE histories. Never ask
 // receipt-present recovery to repair them or label that state completed authority.
 for(const c of ['GuestBookingAllocationManifests','GuestBookingAcquisitionControls','RoomBookingClaimEvents','Bookings','BookingSummary'])for(const target of end[c])await deny('missing/'+c+'/'+target._id,rows=>{rows[c]=rows[c].filter(r=>r._id!==target._id);});
 for(const c of ['Bookings','BookingSummary'])await deny('terminal-unreadable/'+c,undefined,{read:async t=>{if(t.c===c)throw Error('native terminal read fault');}},['UNKNOWN']);
 await deny('positive-binding/exact-miss',undefined,{response:async(t,result,realm)=>{if(exactRead(t,'GuestBookingCompletions','gbc1-'+A))result.items=realm([]);}},['UNKNOWN']);
 await deny('head-unreadable',undefined,{noCoordinator:true,read:async t=>{if(t.c==='GuestBookingRecoveryProgress')throw Error('head unavailable');}});
 await deny('discovery-unreadable',undefined,{noCoordinator:true,read:async t=>{if(t.c==='GuestBookingAcceptances')throw Error('source unavailable');}});
 // Every actual partial terminal suffix: failed read is UNKNOWN, not ABSENT;
 // fresh positive retry must reproduce precisely its native next row/readback.
 for(let i=0;i<h.steps.length;i++){
  const next=h.steps[i];if(!['Bookings','BookingSummary','GuestBookingCompletions'].includes(next.c))continue;
  db.rows=structuredClone(h.prefixes[i]);const before=businessRows(db);
  const s=await recoveryTick(db,A,identities,{read:async t=>{if(t.c===next.c)throw Error('partial suffix unavailable');}});
  assert.equal(receiptFirst(s,A).result.status,'UNKNOWN');assert.deepEqual(mutations(s).filter(t=>t.c!=='GuestBookingRecoveryProgress'),[]);assert.deepEqual(businessRows(db),before);
  const good=await recoveryTick(db,A,identities);assert.equal(receiptFirst(good,A).result.status,next.status);
  const writes=mutations(good).filter(t=>t.c!=='GuestBookingRecoveryProgress');assert.equal(writes.length,1);assert.equal(writes[0].c,next.c);assert.deepEqual(writes[0].row,next.row);
  before[next.c].push(structuredClone(next.row));assert.deepEqual(businessRows(db),before);assert.ok(good.trace.slice(good.trace.indexOf(writes[0])+1).some(t=>exactRead(t,next.c,next.row._id)));
 }
});}
async function actualFixtureControls(){
 const initial=backendLoads;
 await test('P2-F04-actual-SDK-native-snapshot-faults',async()=>{
  const f=producerDeclarations(),db=actualDatabase(f);db.rows.Control=[];db.rows.Other=[];
  const s=actualSubject(db);assert.deepEqual(s.loadedBackendNames(),[]);
  const row=s.realm({_id:'native',n:-0,date:new Date(0),nonfinite:NaN});
  assert.equal(vm.runInContext('(x)=>x.date instanceof Date',s.context)(row),true);
  await s.wix.insert('Control',row,{});const before=structuredClone(db.rows);
  const p=await s.wix.query('Control').eq('_id','native').find({});assert.ok(Object.is(p.items[0].n,-0));assert.ok(Number.isNaN(p.items[0].nonfinite));assert.equal(vm.runInContext('(x)=>x instanceof Date',s.context)(p.items[0].date),true);
  p.items[0].n=3;assert.deepEqual(db.rows,before);await assert.rejects(s.wix.insert('Control',row,{}));await s.wix.insert('Other',row,{});
  const retained=structuredClone(db.rows);db.rows.Control[0].n=1;assert.throws(()=>assert.deepEqual(db.rows,retained));db.rows.Control[0].n=-0;assert.deepEqual(db.rows,retained);
  const bad=actualSubject(db,{after:async()=>{throw Error('lost ACK');}});await assert.rejects(bad.wix.insert('Control',bad.realm({_id:'lost'}),{}));assert.equal(db.rows.Control.filter(r=>r._id==='lost').length,1);assert.equal(bad.trace[0].applied,true);
  const fail=actualSubject(db,{before:async()=>{throw Error('preinsert');}});await assert.rejects(fail.wix.insert('Control',fail.realm({_id:'absent'}),{}));assert.equal(db.rows.Control.some(r=>r._id==='absent'),false);
  assert.deepEqual(s.loadedBackendNames(),[]);assert.deepEqual(bad.loadedBackendNames(),[]);
  const unreadable=actualSubject(db,{read:async()=>{throw Error('unreadable native page');}});await assert.rejects(unreadable.wix.query('Control').find({}));assert.equal(unreadable.trace.length,1);
  const ack=actualSubject(db,{response:async(t,result)=>{assert.equal(t.op,'find');result.hasNext=()=>true;}});const partial=await ack.wix.query('Control').eq('_id','native').find({});assert.equal(partial.hasNext(),true);assert.ok(Object.is(partial.items[0].n,-0));
  const expectedTrace=structuredClone(s.trace);assert.deepEqual(s.trace,expectedTrace);
  assert.throws(()=>assert.deepEqual(s.trace,expectedTrace.slice(1)));assert.throws(()=>assert.deepEqual(s.trace,[...expectedTrace,{op:'insert'}]));assert.throws(()=>assert.deepEqual(s.trace,[...expectedTrace].reverse()));
 });
 await test('P2-F05-actual-SDK-query-full-trace',async()=>{
  const db=actualDatabase(producerDeclarations());db.rows.Control=[{_id:'a',kind:'own',sequence:2},{_id:'b',kind:'foreign',sequence:11},{_id:'c',kind:'own',sequence:10},{_id:'d',kind:'own',sequence:3}];const s=actualSubject(db);
  const p=await s.wix.query('Control').eq('kind','own').gt('_id','a').descending('sequence').limit(1).find({consistentRead:true});assert.equal(p.items[0]._id,'c');assert.equal(p.hasNext(),true);
  assert.deepEqual(s.trace[0].filters,[['eq','kind','own'],['gt','_id','a']]);assert.deepEqual(s.trace[0].sort,['sequence',-1]);assert.equal(s.trace[0].size,1);
  const tail=await s.wix.query('Control').eq('kind','own').gt('_id','c').ascending('_id').limit(2).find({});assert.equal(tail.items.length,1);assert.equal(tail.items[0]._id,'d');assert.equal(tail.hasNext(),false);
  const empty=await s.wix.query('Control').eq('kind','own').gt('_id','d').find({});assert.equal(empty.items.length,0);assert.equal(empty.hasNext(),false);
 });
 await test('P2-F06-actual-loader-syntax-zero-evaluation',async()=>{
  assert.ok(Object.keys(actualPins).length>2);
  for(const file of Object.keys(actualPins))compileActual(path.join(root,file));
  const parent=path.join(root,'velo/backend/guestBookingCompletionRecovery.js');assert.equal(resolveBackend('./guestBookingAcceptance.js',parent),resolveBackend('backend/guestBookingAcceptance',parent));assert.throws(()=>resolveBackend('../../outside.js',parent));assert.throws(()=>compileActual(path.join(root,'velo/backend/jobs.config.js')));
 });
 assert.equal(backendLoads,initial);assert.equal(backendLoads,0);console.log('SDK/loader controls only; backend loads/evaluations: 0; P2-04/P2-05 NOTRUN');
}
// Growth authoring: NOTRUN until independent exact-byte/closure admission.
// These selectors keep actual discovery, progress transport and coordinator.
function growthProducer(){
 const prefix=canonicalSource(fs.readFileSync(path.join(__dirname,'fixtures/guest-booking-r2-producer-prefix.js'),'utf8'));
 assert.equal(sha(prefix),prefixPin);
 const start=prefix.indexOf('function subject(db,hooks={})'),end=prefix.indexOf('async function issue(db,groups)');assert.ok(start>0&&end>start);
 const subjects=[],adaptedSubject=(db,hooks)=>{const s=actualSubject(db,hooks);subjects.push(s);return s;};
 const adapted=prefix.slice(0,start)+'function subject(db,hooks={}){return adaptedSubject(db,hooks);}\n'+prefix.slice(end);
 const f=vm.runInNewContext(adapted+';({database,issue})',{require,Buffer,console,__dirname,adaptedSubject});
 return {...f,subjects};
}
const growthOptions={suppressAuth:true,suppressHooks:true,consistentRead:true};
const growthCollection='GuestBookingRecoveryProgress';
function growthPageOracle(db,cursor,result){
 // Independent retained-storage oracle, not reconstruction from returned IDs.
 const eligible=db.rows.GuestBookingAcceptances.filter(r=>cursor===null||r._id>cursor).slice().sort((a,b)=>a._id<b._id?-1:a._id>b._id?1:0);
 const ids=eligible.slice(0,25).map(r=>r._id),invalid=ids.filter(id=>id==='!'||id===' ');
 assert.equal(result.status,'PAGE');assert.deepEqual(result.sourceIds,ids);assert.equal(result.sourceCount,ids.length);
 assert.deepEqual(result.invalid,invalid);assert.deepEqual(result.contexts.map(c=>c.acceptanceId),ids.filter(id=>!invalid.includes(id)));
 assert.equal(result.exhausted,eligible.length<=25);assert.equal(result.nextCursor,eligible.length>25?ids.at(-1):null);
 return {ids,exhausted:eligible.length<=25};
}
function growthReadOracle(s,before){
 const reads=s.trace.filter(t=>t.op==='find'&&t.c===growthCollection);
 const head={op:'find',c:growthCollection,filters:[['eq','stream','guest-booking-acceptances/v1']],sort:['sequence',-1],size:2,options:growthOptions};
 assert.deepEqual(reads[0],head);
 const expected=[head],last=before.at(-1);
 if(last&&last.sequence>1)expected.push({op:'find',c:growthCollection,filters:[['eq','_id',last.previousId]],sort:null,size:2,options:growthOptions});
 expected.push({op:'find',c:growthCollection,filters:[['eq','_id','gbrp1-'+String(before.length+1).padStart(16,'0')]],sort:null,size:2,options:growthOptions});
 assert.deepEqual(reads,expected,'constant head/predecessor/successor reads despite retained growth');
 assert.ok(reads.length<=8);
 // Read-envelope bytes independently selected from retained history at each phase.
 const after=s.trace.find(t=>t.op==='insert'&&t.c===growthCollection).row;
 const pages=[before.slice().sort((a,b)=>b.sequence-a.sequence).slice(0,2)];
 if(last&&last.sequence>1)pages.push(before.filter(r=>r._id===last.previousId));pages.push([after]);
 const bytes=pages.reduce((sum,items,i)=>sum+Buffer.byteLength(JSON.stringify({items,more:i===0&&before.length>2})),0);
 assert.ok(bytes<=65536);for(const rows of pages)for(const row of rows)assert.ok(Buffer.byteLength(JSON.stringify(row))<=4096);
 return {reads:reads.length,bytes};
}
async function growthTick(db,identities,hooks={}){
 const before=structuredClone(db.rows),s=actualSubject(db,{...hooks,recovery:true});assert.equal(s.loadedBackendNames().length,0);
 assert.ok(!identities.has(s.context));identities.add(s.context);
 const api=s.load('backend/guestBookingCompletionRecovery');
 for(const [module,method] of [['guestBookingCompletionRecovery','recoverGuestBookingCompletions'],['guestBookingAcceptanceDiscovery','discoverGuestBookingAcceptances'],['guestBookingRecoveryProgressStore','createGuestBookingRecoveryProgressStore'],['guestBookingPhysicalAcquisition','resumeGuestBookingPhysicalAcquisition']]){
  const fn=s.load('backend/'+module)[method];assert.ok(!identities.has(fn));identities.add(fn);
 }
 const result=await api.recoverGuestBookingCompletions();assert.equal(result.status,'ADVANCED');
 const cursor=before.GuestBookingRecoveryProgress.at(-1)?.afterSourceId??null;
 const discovery=s.calls.filter(c=>c.name==='discoverGuestBookingAcceptances');assert.equal(discovery.length,1);assert.deepEqual(discovery[0].args,[cursor]);
 const expected=growthPageOracle({rows:before},cursor,discovery[0].result),selected=expected.ids[0]??null;
 const scan=s.trace.filter(t=>t.op==='find'&&t.c==='GuestBookingAcceptances'&&t.sort!==null);
 assert.deepEqual(scan,[{op:'find',c:'GuestBookingAcceptances',filters:cursor===null?[]:[['gt','_id',cursor]],sort:['_id',1],size:25,options:growthOptions}]);
 const visits=s.calls.filter(c=>c.name==='resumeGuestBookingPhysicalAcquisition');
 const invalid=selected==='!'||selected===' ';assert.equal(visits.length,selected===null||invalid?0:1);
 let classification=selected===null?'EMPTY_SWEEP':invalid?'INVALID_ROOT':'COORDINATOR_RETURNED';
 if(visits.length){const call=receiptFirst(s,selected);assert.ok(call.result);if(['UNKNOWN','UNRESOLVED'].includes(call.result.status))classification='COORDINATOR_UNRESOLVED';}
 const rotate=expected.exhausted&&expected.ids.length<=1,old=before.GuestBookingRecoveryProgress.at(-1);
 const checkpoint=progressRow(before.GuestBookingRecoveryProgress.length+1,(old?.sweep??0)+(rotate?1:0),rotate?null:selected,selected,classification);
 const inserts=mutations(s);assert.ok(inserts.every(t=>t.op==='insert'),'no hidden mutation/provider operation');
 const admin=inserts.filter(t=>t.c===growthCollection);assert.equal(admin.length,1);assert.equal(admin[0].applied,true);assert.deepEqual(admin[0].row,checkpoint);
 const business=inserts.filter(t=>t.c!==growthCollection);assert.ok(business.length<=1);
 for(const t of inserts){assert.equal(t.applied,true);assert.equal(before[t.c].some(r=>r._id===t.row._id),false);before[t.c].push(structuredClone(t.row));assert.ok(s.trace.slice(s.trace.indexOf(t)+1).some(r=>exactRead(r,t.c,t.row._id)));}
 assert.deepEqual(db.rows,before,'raw all-collection exact writer delta');
 assert.equal(s.trace.some(t=>t.op==='secret'||['Settings','GuestBookingFinancialRevisions'].includes(t.c)),false);
 const cost=growthReadOracle(s,before.GuestBookingRecoveryProgress.slice(0,-1));
 return {s,result,checkpoint,cost,page:discovery[0].result};
}
async function growthHistory(){
 const f=growthProducer(),db=actualDatabase(f),identities=new Set(),issued=[],producerBindings=[];
 async function issueOne(){
  const at=f.subjects.length,before=structuredClone(db.rows),{A}=await f.issue(db,[{roomCode:'adventure_suite',quantity:1,guests:2}]);
  assert.equal(f.subjects.length,at+1);const s=f.subjects[at],writes=mutations(s).filter(t=>t.op==='insert');
  assert.ok(writes.some(t=>t.c==='GuestBookingAcceptances'&&t.row._id===A));
  for(const t of writes){assert.equal(t.applied,true);assert.equal(before[t.c].some(r=>r._id===t.row._id),false);before[t.c].push(structuredClone(t.row));assert.ok(s.trace.slice(s.trace.indexOf(t)+1).some(q=>exactRead(q,t.c,t.row._id)));}
  assert.deepEqual(db.rows,before);assert.equal(issued.includes(A),false);issued.push(A);
  for(const t of writes)producerBindings.push({acceptanceId:A,subjectIndex:at,traceIndex:s.trace.indexOf(t),collection:t.c,id:t.row._id,payloadSHA256:sha(JSON.stringify(t.row)),insertOptions:t.options,exactReadback:s.trace.slice(s.trace.indexOf(t)+1).find(q=>exactRead(q,t.c,t.row._id))});
  return A;
 }
 for(let i=0;i<26;i++)await issueOne();
 // Deliberately malformed, orderable source only; never positive authority.
 const poison=actualSubject(db);await poison.wix.insert('GuestBookingAcceptances',poison.realm({_id:'!'}),{suppressAuth:true,suppressHooks:true});
 return {db,identities,issued,issueOne,producerBindings};
}
async function p2Growth(){
 const h=await growthHistory(),{db,identities,issued}=h;const costs=[];
 await test('P2-02-actual-multipage-growth-tail-poison-restart',async()=>{
  const ordered=db.rows.GuestBookingAcceptances.map(r=>r._id).sort(),slow=ordered[1],visited=[];
  assert.equal(ordered.length,27);assert.equal(issued.length,26);
  for(let i=0;i<ordered.length;i++){
   const hooks={};let entered=false,released=false,release,enter,pending,timer;
   if(i===1){const gate=new Promise(r=>release=r),paused=new Promise(r=>enter=r);hooks.read=async t=>{if(exactRead(t,'GuestBookingCompletions','gbc1-'+slow)){entered=true;enter();await gate;throw Error('terminating poison receipt read');}};
    const raw=structuredClone(db.rows);timer=setTimeout(()=>release(),2000);
    try{pending=growthTick(db,identities,hooks);await paused;assert.equal(entered,true);assert.deepEqual(db.rows,raw,'in-flight coordinator cannot checkpoint');released=true;release();const tick=await pending;assert.equal(tick.checkpoint.classification,'COORDINATOR_UNRESOLVED');visited.push(tick.checkpoint.classifiedSourceId);costs.push(tick.cost);}
    finally{release();clearTimeout(timer);if(pending)await pending;}
    assert.equal(released,true);
   }else{const tick=await growthTick(db,identities);visited.push(tick.checkpoint.classifiedSourceId);costs.push(tick.cost);if(i===0){assert.equal(tick.page.sourceCount,25);assert.equal(tick.page.exhausted,false);assert.equal(tick.checkpoint.afterSourceId,'!');assert.notEqual(tick.checkpoint.afterSourceId,tick.page.nextCursor);}if(i===ordered.length-2){assert.equal(tick.page.sourceCount,2);assert.equal(tick.page.exhausted,true);assert.equal(tick.checkpoint.afterSourceId,ordered[i]);}}
  }
  assert.deepEqual(visited,ordered);assert.deepEqual(db.rows.GuestBookingRecoveryProgress.map(r=>r.classifiedSourceId),ordered);
  const final=db.rows.GuestBookingRecoveryProgress.at(-1);assert.equal(final.afterSourceId,null);assert.equal(final.sweep,1);assert.equal(final.classifiedSourceId,ordered.at(-1));
  // Issue genuinely new roots after the completed sweep. No copied/renamed IDs.
  let lower=null;for(let i=0;i<8&&lower===null;i++){const A=await h.issueOne();if(A<ordered.at(-1))lower=A;}
  assert.ok(lower,'bounded actual issuer must supply a lower-than-prior-tail arrival');
  const next=db.rows.GuestBookingAcceptances.map(r=>r._id).sort(),restart=[];
  for(const id of next){const tick=await growthTick(db,identities);assert.equal(tick.checkpoint.classifiedSourceId,id);restart.push(id);costs.push(tick.cost);}
  assert.deepEqual(restart,next);assert.ok(restart.includes(lower));assert.equal(db.rows.GuestBookingRecoveryProgress.at(-1).sweep,2);
  assert.equal(db.rows.GuestBookingRecoveryProgress.length,ordered.length+next.length);
  assert.ok(costs.slice(3).every(c=>c.reads===3),'retained log growth never triggers historical-chain scans');
  console.log('P2-GROWTH-EVIDENCE '+JSON.stringify({issued,producerBindings:h.producerBindings,firstSweep:visited,secondSweep:restart,lower,progressCount:db.rows.GuestBookingRecoveryProgress.length,progress:db.rows.GuestBookingRecoveryProgress,costs}));
 });
 await test('P2-03-actual-grown-successor-lost-ACK-concurrent-append',async()=>{
  // Applied successor plus unreadable reconciliation: retain, do not reinitialize.
  const raw=structuredClone(db.rows),n=raw.GuestBookingRecoveryProgress.length;let applied=false;
  const s=actualSubject(db,{recovery:true,after:async t=>{if(t.c===growthCollection){applied=true;throw Error('lost successor ACK');}},read:async t=>{if(applied&&t.c===growthCollection)throw Error('lost ACK reconciliation unreadable');}});
  const result=await s.load('backend/guestBookingCompletionRecovery').recoverGuestBookingCompletions();assert.equal(result.status,'UNRESOLVED');assert.equal(applied,true);
  assert.equal(db.rows.GuestBookingRecoveryProgress.length,n+1);assert.deepEqual(db.rows.GuestBookingRecoveryProgress.slice(0,-1),raw.GuestBookingRecoveryProgress);
  const writes=mutations(s);assert.equal(writes.length,1);assert.equal(writes[0].c,growthCollection);assert.equal(writes[0].applied,true);raw[growthCollection].push(structuredClone(writes[0].row));assert.deepEqual(db.rows,raw);
  const fresh=await growthTick(db,identities);assert.equal(fresh.checkpoint.sequence,n+2);assert.notEqual(fresh.checkpoint.classifiedSourceId,writes[0].row.classifiedSourceId);
  for(const delayed of ['left','right']){
   let release,enter,pending;const gate=new Promise(r=>release=r),paused=new Promise(r=>enter=r),before=structuredClone(db.rows);let held=false;
   const hook={recovery:true,before:async t=>{if(t.c===growthCollection&&!held){held=true;enter();await gate;}}};
   // Receipt reads terminate unresolved for BOTH workers, isolating successor race
   // at the real SDK boundary without substituting discovery or coordinator.
   const fault=async t=>{if(t.c==='GuestBookingCompletions')throw Error('ordinary unreadable receipt');};
   const left=actualSubject(db,delayed==='left'?{...hook,read:fault}:{recovery:true,read:fault}),right=actualSubject(db,delayed==='right'?{...hook,read:fault}:{recovery:true,read:fault});
   assert.notEqual(left.context,right.context);const a=left.load('backend/guestBookingCompletionRecovery'),b=right.load('backend/guestBookingCompletionRecovery');assert.notEqual(a.recoverGuestBookingCompletions,b.recoverGuestBookingCompletions);
   const slow=delayed==='left'?a:b,fast=delayed==='left'?b:a,timer=setTimeout(()=>release(),2000);
   try{pending=slow.recoverGuestBookingCompletions();await paused;assert.equal((await fast.recoverGuestBookingCompletions()).status,'ADVANCED');const winner=structuredClone(db.rows);release();assert.equal((await pending).status,'ADVANCED');assert.deepEqual(db.rows,winner);
    const attempts=[...mutations(left),...mutations(right)];assert.equal(attempts.length,2);assert.ok(attempts.every(t=>t.c===growthCollection&&t.op==='insert'));assert.equal(attempts.filter(t=>t.applied).length,1);assert.deepEqual(attempts[0].row,attempts[1].row);
    before[growthCollection].push(structuredClone(attempts[0].row));assert.deepEqual(db.rows,before);assert.equal(db.rows[growthCollection].at(-1).sequence,before[growthCollection].length);
    for(const worker of [left,right]){const call=worker.calls.find(c=>c.name==='discoverGuestBookingAcceptances');growthPageOracle({rows:before},call.args[0],call.result);assert.equal(worker.calls.filter(c=>c.name==='resumeGuestBookingPhysicalAcquisition').length,1);assert.ok(worker.trace.some(t=>exactRead(t,growthCollection,attempts[0].row._id)));}
   }finally{release();clearTimeout(timer);if(pending)await pending;}
  }
 });
 await test('P2-06-grown-progress-envelope-and-read-boundary',async()=>{
  const raw=structuredClone(db.rows),head=raw[growthCollection].at(-1);
  assert.ok(raw[growthCollection].length>25);
  // Synthetic metadata boundary around an ACTUAL writer head; not native growth
  // to 4096 bytes, and not a change to the production byte/item/read constants.
  for(const bytes of [4096,4097]){
   const padded={...head,_owner:''};padded._owner='x'.repeat(bytes-Buffer.byteLength(JSON.stringify(padded)));assert.equal(Buffer.byteLength(JSON.stringify(padded)),bytes);
   const s=actualSubject(db,{recovery:true,response:async(t,p,realm)=>{if(t.c===growthCollection)for(let i=0;i<p.items.length;i++)if(p.items[i]._id===head._id)p.items[i]=realm(padded);}});
   const store=s.load('backend/guestBookingRecoveryProgressStore').createGuestBookingRecoveryProgressStore(),r=await store.head();assert.equal(r.status,bytes===4096?'READY':'UNRESOLVED');assert.equal(store.reserve(),bytes===4096);assert.deepEqual(mutations(s),[]);assert.deepEqual(db.rows,raw);
  }
  // Repeated API calls consume the real 8-read counter; NOT a reachable ordinary
  // one-head quantum or evidence that retained-log growth exhausts read budget.
  const s=actualSubject(db,{recovery:true}),store=s.load('backend/guestBookingRecoveryProgressStore').createGuestBookingRecoveryProgressStore();
  for(let i=0;i<4;i++)assert.equal((await store.head()).status,'READY');assert.equal(s.trace.length,8);assert.equal(store.reserve(),false);assert.equal((await store.head()).status,'UNRESOLVED');assert.equal(s.trace.length,8);assert.deepEqual(mutations(s),[]);assert.deepEqual(db.rows,raw);
  // Ordinary head(2), predecessor(1), successor(1): the read and item caps
  // dominate cumulative bytes. This is an envelope upper bound, NOT a native
  // 65536-byte crossing witness or proof that a larger retained log is viable.
  const punctuation=n=>Buffer.byteLength(JSON.stringify({items:Array(n).fill(null),more:false}))-4*n;
  const ordinaryUpper=4*4096+punctuation(2)+2*punctuation(1);assert.ok(ordinaryUpper<65536);
  const denied=actualSubject(db,{recovery:true,response:async(t,p,realm)=>{if(t.c===growthCollection&&p.items.length){const row={...head,_owner:''};row._owner='x'.repeat(4097-Buffer.byteLength(JSON.stringify(row)));p.items[0]=realm(row);}}});
  assert.equal((await denied.load('backend/guestBookingCompletionRecovery').recoverGuestBookingCompletions()).status,'UNRESOLVED');assert.deepEqual(denied.calls,[]);assert.deepEqual(mutations(denied),[]);assert.deepEqual(db.rows,raw);
  console.log('P2-GROWTH-BOUNDARY '+JSON.stringify({retainedProgress:raw[growthCollection].length,ordinaryProgressReadUpper:3,ordinaryEnvelopeByteUpper:ordinaryUpper,itemNeighbors:[4096,4097],syntheticReadExhaustion:8,nativeCounterExhaustion:false,nativeIndexCost:false}));
 });
}
async function growthFixtureControls(){
 const initial=backendLoads,db=actualDatabase(producerDeclarations());db.rows.Control=[];
 const s=actualSubject(db);for(let i=0;i<28;i++)await s.wix.insert('Control',s.realm({_id:String(i).padStart(3,'0'),kind:i===13?'foreign':'own',n:-0}),{});
 const retained=structuredClone(db.rows),seen=[];let cursor=null;
 for(let i=0;i<3;i++){
  let q=s.wix.query('Control').eq('kind','own');if(cursor!==null)q=q.gt('_id',cursor);
  const p=await q.ascending('_id').limit(25).find(growthOptions),expected=db.rows.Control.filter(r=>r.kind==='own'&&(cursor===null||r._id>cursor)).slice(0,25);
  assert.deepEqual(Array.from(p.items,r=>r._id),expected.map(r=>r._id));assert.equal(p.hasNext(),i===0);for(const r of p.items)assert.ok(Object.is(r.n,-0));seen.push(...Array.from(p.items,r=>r._id));if(p.items.length)cursor=p.items.at(-1)._id;
 }
 assert.equal(seen.length,27);assert.equal(new Set(seen).size,27);assert.deepEqual(db.rows,retained);
 db.rows.Control[0].n=0;assert.throws(()=>assert.deepEqual(db.rows,retained));db.rows.Control[0].n=-0;assert.deepEqual(db.rows,retained);
 const traces=s.trace.filter(t=>t.op==='find');assert.deepEqual(traces.map(t=>t.size),[25,25,25]);assert.deepEqual(traces.map(t=>t.filters),[[['eq','kind','own']],[['eq','kind','own'],['gt','_id','025']],[['eq','kind','own'],['gt','_id','027']]]);
 assert.equal(backendLoads,initial);assert.equal(backendLoads,0);assert.deepEqual(s.loadedBackendNames(),[]);
 console.log('PASS P2-F07-growth-SDK-25-tail-raw-controls');completed.push('P2-F07-growth-SDK-25-tail-raw-controls');
}
// Final ordinary clauses: authoring only; no backend execution admission.
// Partition corruption is an explicitly labelled orchestration report seam.
function ordinaryReports(){
 const ids=Array.from({length:25},(_,i)=>i.toString(16).padStart(64,'0'));
 const cases=[],add=(name,p,cursor=null)=>cases.push({name,p,cursor});
 for(const partition of ['contexts','invalid']){
  const base=page([A,B],partition==='invalid'?[A,B]:[]);
  const value=id=>partition==='contexts'?{acceptanceId:id}:id;
  for(const [fault,values] of [['duplicate',[A,A]],['foreign',[A,'c'.repeat(64)]],['omitted',[A]],['order',[B,A]]]){
   add(partition+'/'+fault,{...base,[partition]:values.map(value)});
  }
 }
 add('cross-partition-duplicate',{...page([A,B],[B]),invalid:[A,B]});
 add('source-duplicate',page([A,A]));add('source-order',page([B,A]));
 add('source-count',{...page([A]),sourceCount:0});
 add('too-many-sources',page([...ids,A]));
 for(const id of ['', '\n','é','x'.repeat(129),null,1])add('source-grammar/'+JSON.stringify(id),page([id],[id]));
 for(const id of ['A'.repeat(64),'a'.repeat(63),'!'])add('acceptance-grammar/'+id,page([id]));
 add('cursor-equal',page([A]),A);add('cursor-before',page([A]),B);
 add('empty-not-exhausted',page([],[],false));
 add('empty-next-cursor',{...page([]),nextCursor:A});
 add('final-next-cursor',{...page([A,B]),nextCursor:B});
 add('partial-not-exhausted',page([A,B],[],false));
 add('full-next-null',{...page(ids,[],false),nextCursor:null});
 add('full-next-mismatch',{...page(ids,[],false),nextCursor:ids[0]});
 add('full-next-malformed',{...page(ids,[],false),nextCursor:'\n'});
 add('exhausted-not-boolean',{...page([A]),exhausted:1});
 return {ids,cases};
}
async function ordinaryPartitions(){
 await test('P2-01-complete-partition-cursor-denials',async()=>{
  for(const {name,p,cursor} of ordinaryReports().cases){
   const s=sdk();if(cursor!==null){const row=progressRow(1,0,cursor,cursor);s.rows(growthCollection).set(row._id,structuredClone(row));}
   const raw=structuredClone([...s.rows(growthCollection)]);let visits=0,scans=0;
   const m=await loadRecovery(s,async input=>{scans++;assert.equal(input,cursor);return p;},async()=>{visits++;});
   assert.equal((await m.recoverGuestBookingCompletions()).status,'INTEGRITY',name);
   assert.equal(scans,1,name);assert.equal(visits,0,name);assert.deepEqual(s.trace.filter(t=>t.op!=='find'),[],name);
   assert.deepEqual([...s.rows(growthCollection)],raw,name);
  }
 });
 await test('P2-01-full-final-empty-per-item-positive-grammar',async()=>{
  const {ids}=ordinaryReports();
  for(const [name,report,selected,rotate] of [['full',page(ids,[],false),ids[0],false],['final-full',page(ids),ids[0],false],['final-tail',page([A,B]),A,false],['final-item',page([A]),A,true],['empty',page([]),null,true],['invalid-lowest',page([' ',A],[' ']),' ',false]]){
   const s=sdk(),visited=[];const m=await loadRecovery(s,async()=>report,async id=>{visited.push(id);return {status:'UNKNOWN'};});
   assert.equal((await m.recoverGuestBookingCompletions()).status,'ADVANCED',name);
   const classification=selected===null?'EMPTY_SWEEP':selected===' '?'INVALID_ROOT':'COORDINATOR_UNRESOLVED';
   assert.deepEqual([...s.rows(growthCollection).values()],[progressRow(1,rotate?1:0,rotate?null:selected,selected,classification)],name);
   assert.deepEqual(visited,selected===null||selected===' '?[]:[selected],name);
   assert.equal(s.trace.filter(t=>t.op==='insert').length,1,name);
  }
 });
}
async function ordinaryHistory(){
 // One shared issuer database, no union of unrelated snapshots or renamed roots.
 // Issue all offers before acquisition; only unreadable receipts are visited, so
 // no mutually incompatible physical reservation history is manufactured.
 const f=growthProducer(),db=actualDatabase(f),identities=new Set(),bindings=[];
 for(let i=0;i<3;i++){
  const before=structuredClone(db.rows),at=f.subjects.length,{A}=await f.issue(db,[{roomCode:'adventure_suite',quantity:1,guests:2}]);
  assert.equal(f.subjects.length,at+1);const s=f.subjects[at];
  for(const t of mutations(s).filter(t=>t.op==='insert')){
   assert.equal(t.op,'insert');assert.equal(t.applied,true);assert.equal(before[t.c].some(r=>r._id===t.row._id),false);
   before[t.c].push(structuredClone(t.row));assert.ok(s.trace.slice(s.trace.indexOf(t)+1).some(q=>exactRead(q,t.c,t.row._id)));
   bindings.push({acceptanceId:A,c:t.c,id:t.row._id,sha256:sha(JSON.stringify(t.row))});
  }
  assert.deepEqual(db.rows,before);assert.ok(db.rows.GuestBookingAcceptances.some(r=>r._id===A));
 }
 const poison=actualSubject(db);await poison.wix.insert('GuestBookingAcceptances',poison.realm({_id:'!'}),{suppressAuth:true,suppressHooks:true});
 const ordered=db.rows.GuestBookingAcceptances.map(r=>r._id).sort(),before=businessRows(db);
 const read=async t=>{if(t.c==='GuestBookingCompletions')throw Error('ordinary receipt unavailable');};
 for(const id of ordered){const tick=await growthTick(db,identities,{read});assert.equal(tick.checkpoint.classifiedSourceId,id);assert.deepEqual(businessRows(db),before);}
 assert.deepEqual(db.rows[growthCollection].map(r=>r.classifiedSourceId),ordered);
 assert.equal(db.rows[growthCollection].at(-1).afterSourceId,null);
 console.log('P2-ORDINARY-HISTORY '+JSON.stringify({bindings,ordered,progress:db.rows[growthCollection]}));
 return {db,ordered,read};
}
async function ordinaryActual(){
 const {db,ordered,read}=await ordinaryHistory(),raw=structuredClone(db.rows),progress=raw[growthCollection];
 const isHead=t=>t.c===growthCollection&&t.sort!==null;
 await test('P2-01-actual-malformed-partial-source-no-absence',async()=>{
  // Retained cursor is real writer output. Fault only the native source page;
  // actual discovery and coordinator exports are never replaced.
  for(const fault of ['partial','empty-partial','duplicate','reverse','behind-cursor','unreadable']){
   db.rows=structuredClone(raw);db.rows[growthCollection]=structuredClone(progress.slice(0,1));
   const before=structuredClone(db.rows);let hit=0;
   const s=actualSubject(db,{recovery:true,read:async t=>{if(t.c==='GuestBookingAcceptances'&&t.sort!==null&&fault==='unreadable'){hit++;throw Error('source unavailable');}},response:async(t,p,realm)=>{
    if(t.c!=='GuestBookingAcceptances'||t.sort===null)return;hit++;assert.equal(t.size,25);assert.deepEqual(t.filters,[['gt','_id','!']]);
    if(fault==='partial')p.hasNext=()=>true;
    if(fault==='empty-partial'){p.items=realm([]);p.hasNext=()=>true;}
    if(fault==='duplicate')p.items=realm([p.items[0],p.items[0]]);
    if(fault==='reverse')p.items=realm(Array.from(p.items).reverse());
    if(fault==='behind-cursor')p.items=realm([{_id:'!'}]);
   }});
   const r=await s.load('backend/guestBookingCompletionRecovery').recoverGuestBookingCompletions();
   assert.equal(r.status,fault==='unreadable'?'UNRESOLVED':'INTEGRITY',fault);assert.equal(hit,1);
   const discovery=s.calls.filter(c=>c.name==='discoverGuestBookingAcceptances');assert.equal(discovery.length,1);assert.notEqual(discovery[0].result.status,'PAGE');
   assert.equal(s.calls.some(c=>c.name==='resumeGuestBookingPhysicalAcquisition'),false);assert.deepEqual(mutations(s),[]);assert.deepEqual(db.rows,before);
  }
 });
 await test('P2-03-stale-empty-positive-head-native-collision',async()=>{
  for(const stale of ['empty','positive']){
   db.rows=structuredClone(raw);let hit=0;
   const retainedHead=stale==='empty'?[]:[progress[2],progress[1]],s=actualSubject(db,{recovery:true,read,response:async(t,p,realm)=>{if(isHead(t)){hit++;p.items=realm(retainedHead);p.hasNext=()=>stale==='positive';}}});
   const r=await s.load('backend/guestBookingCompletionRecovery').recoverGuestBookingCompletions();assert.equal(r.status,'ADVANCED');assert.equal(hit,1);
   const selected=stale==='empty'?ordered[0]:ordered[3],winner=stale==='empty'?progress[0]:progress[3];
   const discovery=s.calls.find(c=>c.name==='discoverGuestBookingAcceptances');assert.deepEqual(discovery.args,[stale==='empty'?null:ordered[2]]);growthPageOracle(db,discovery.args[0],discovery.result);
   const visits=s.calls.filter(c=>c.name==='resumeGuestBookingPhysicalAcquisition');assert.equal(visits.length,stale==='empty'?0:1);if(visits.length){assert.deepEqual(visits[0].args,[selected]);assert.equal(receiptFirst(s,selected).result.status,'UNKNOWN');}
   const attempts=mutations(s);assert.equal(attempts.length,1);assert.equal(attempts[0].c,growthCollection);assert.equal(attempts[0].op,'insert');assert.equal(attempts[0].applied,undefined);assert.deepEqual(attempts[0].row,winner);
   assert.ok(s.trace.slice(s.trace.indexOf(attempts[0])+1).some(t=>exactRead(t,growthCollection,winner._id)));
   assert.deepEqual(db.rows,raw,'stale visibility cannot reset or overwrite retained progress');
   const fresh=await growthTick(db,new Set(),{read});assert.equal(fresh.checkpoint.sequence,5);assert.equal(fresh.checkpoint.sweep,1);assert.equal(fresh.checkpoint.classifiedSourceId,ordered[0]);assert.equal(fresh.checkpoint.afterSourceId,ordered[0]);
   assert.deepEqual(db.rows[growthCollection].slice(0,-1),progress);assert.deepEqual(businessRows(db),businessRows({rows:raw}));
  }
 });
 await test('P2-03-positive-predecessor-consistency-no-false-initialization',async()=>{
  for(const fault of ['valid','missing','changed-positive','illegal-transition','foreign','duplicate','partial','unreadable','empty-head-partial']){
   db.rows=structuredClone(raw);const before=structuredClone(db.rows);let keyed=0;
   const s=actualSubject(db,{recovery:true,read:async t=>{if(exactRead(t,growthCollection,progress[1]._id)&&fault==='unreadable'){keyed++;throw Error('predecessor unavailable');}await read(t);},response:async(t,p,realm)=>{
    if(isHead(t)){p.items=realm(fault==='empty-head-partial'?[]:[progress[2],progress[1]]);if(fault==='illegal-transition')p.items[1].sweep=1;p.hasNext=()=>true;}
    if(!exactRead(t,growthCollection,progress[1]._id))return;keyed++;
    if(fault==='missing')p.items=realm([]);
    if(fault==='changed-positive')p.items[0].classification='COORDINATOR_RETURNED';
    if(fault==='illegal-transition')p.items[0].sweep=1;
    if(fault==='foreign')p.items=realm([progress[0]]);
    if(fault==='duplicate')p.items=realm([progress[1],progress[1]]);
    if(fault==='partial')p.hasNext=()=>true;
   }});
   const r=await s.load('backend/guestBookingCompletionRecovery').recoverGuestBookingCompletions();
   assert.equal(r.status,fault==='valid'?'ADVANCED':'UNRESOLVED',fault);assert.equal(keyed,fault==='empty-head-partial'?0:1);
   if(fault==='valid'){
    assert.deepEqual(s.calls.find(c=>c.name==='discoverGuestBookingAcceptances').args,[ordered[2]]);
    assert.equal(receiptFirst(s,ordered[3]).result.status,'UNKNOWN');assert.equal(mutations(s).length,1);assert.deepEqual(mutations(s)[0].row,progress[3]);assert.equal(mutations(s)[0].applied,undefined);
   }else{assert.deepEqual(s.calls,[]);assert.deepEqual(mutations(s),[]);}
   assert.deepEqual(db.rows,before,fault);
  }
 });
}
async function ordinaryFixtureControls(){
 await test('P2-F08-ordinary-API-pagination-raw-storage',async()=>{
  const initial=backendLoads,db=actualDatabase(producerDeclarations());db.rows.Control=[];
  const s=actualSubject(db);for(let i=0;i<27;i++)await s.wix.insert('Control',s.realm({_id:String(i).padStart(3,'0'),stream:i===26?'foreign':'own',sequence:i,n:-0,date:new Date(0)}),{});
  const raw=structuredClone(db.rows),q=s.wix.query('Control');for(const method of ['eq','gt','ascending','descending','limit','find'])assert.equal(typeof q[method],'function');
  const first=await q.eq('stream','own').ascending('_id').limit(25).find(growthOptions);assert.equal(first.items.length,25);assert.equal(first.hasNext(),true);
  const tail=await s.wix.query('Control').eq('stream','own').gt('_id','024').ascending('_id').limit(25).find(growthOptions);assert.deepEqual(Array.from(tail.items,r=>r._id),['025']);assert.equal(tail.hasNext(),false);
  const empty=await s.wix.query('Control').eq('stream','own').gt('_id','025').ascending('_id').limit(25).find(growthOptions);assert.equal(empty.items.length,0);assert.equal(empty.hasNext(),false);
  const head=await s.wix.query('Control').eq('stream','own').descending('sequence').limit(2).find(growthOptions);assert.deepEqual(Array.from(head.items,r=>r.sequence),[25,24]);assert.equal(head.hasNext(),true);
  for(const id of ['024','missing']){const p=await s.wix.query('Control').eq('_id',id).limit(2).find(growthOptions);assert.equal(p.items.length,id==='024'?1:0);assert.equal(p.hasNext(),false);}
  assert.deepEqual(s.trace.filter(t=>t.op==='find').map(t=>t.size),[25,25,25,2,2,2]);
  assert.ok(Object.is(first.items[0].n,-0));assert.equal(vm.runInContext('(x)=>x instanceof Date',s.context)(first.items[0].date),true);
  assert.deepEqual(db.rows,raw);db.rows.Control[0].n=0;assert.throws(()=>assert.deepEqual(db.rows,raw));db.rows.Control[0].n=-0;assert.deepEqual(db.rows,raw);
  const trace=structuredClone(s.trace);assert.deepEqual(s.trace,trace);assert.throws(()=>assert.deepEqual(s.trace,trace.slice(1)));assert.throws(()=>assert.deepEqual(s.trace,[...trace].reverse()));assert.throws(()=>assert.deepEqual(s.trace,[...trace,{op:'insert'}]));
  assert.equal(new Set(ordinaryReports().cases.map(c=>c.name)).size,ordinaryReports().cases.length);
  assert.deepEqual(s.loadedBackendNames(),[]);assert.equal(backendLoads,initial);assert.equal(backendLoads,0);
 });
}
(async()=>{
 const selector=process.argv[2];
 if(selector==='--ordinary-fixture-only'){await ordinaryFixtureControls();console.log(JSON.stringify({completed,count:completed.length,backendLoads}));return;}
 if(selector==='--p2-ordinary-partitions'||selector==='--p2-ordinary-actual'){
  // NOT self-admitted: reviewer must freeze this candidate/closure and select it.
  const expected=selector==='--p2-ordinary-partitions'?['P2-01-complete-partition-cursor-denials','P2-01-full-final-empty-per-item-positive-grammar']:['P2-01-actual-malformed-partial-source-no-absence','P2-03-stale-empty-positive-head-native-collision','P2-03-positive-predecessor-consistency-no-false-initialization'];
  const timer=setTimeout(()=>{console.error(JSON.stringify({status:'TIMEOUT',selector,completed,backendLoads}));process.exit(1);},180000);
  try{await (selector==='--p2-ordinary-partitions'?ordinaryPartitions():ordinaryActual());assert.deepEqual(completed,expected);}finally{clearTimeout(timer);}
  console.log(JSON.stringify({completed,count:completed.length}));return;
 }
 if(selector==='--growth-fixture-only'){await growthFixtureControls();console.log(JSON.stringify({completed,count:completed.length,backendLoads}));return;}
 if(selector==='--p2-growth'){
  // Authoring does not self-admit this actual-backend selection.
  const timer=setTimeout(()=>{console.error(JSON.stringify({status:'TIMEOUT',selector,completed,backendLoads}));process.exit(1);},180000);
  try{await p2Growth();assert.deepEqual(completed,['P2-02-actual-multipage-growth-tail-poison-restart','P2-03-actual-grown-successor-lost-ACK-concurrent-append','P2-06-grown-progress-envelope-and-read-boundary']);}finally{clearTimeout(timer);}
  console.log(JSON.stringify({completed,count:completed.length}));return;
 }
 if(selector==='--fixture-only')await fixtures();
 else if(selector==='--orchestration')await orchestration();
 else if(selector==='--actual-fixture-only')await actualFixtureControls();
 else if(selector==='--p2-04'||selector==='--p2-05'){
  // Review must admit exact file + closure before either bounded backend selector.
  const timer=setTimeout(()=>{console.error(JSON.stringify({status:'TIMEOUT',selector,completed,backendLoads}));process.exit(1);},180000);
  try{await (selector==='--p2-04'?p204():p205());assert.deepEqual(completed,[actualIds[selector==='--p2-04'?0:1]]);}finally{clearTimeout(timer);}
 }
 else throw Error('Select --fixture-only or --actual-fixture-only. Backend --orchestration / --p2-04 / --p2-05 require independent exact-byte admission; authored NOTRUN.');
 console.log(JSON.stringify({completed, count:completed.length}));
})().catch(e=>{console.error(e);process.exitCode=1;});
