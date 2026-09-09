'use strict';
// Authored before P1 source. Integrated cases are NOT RUN: D1 admission required.
// No restricted probes or fallback authority. Default execution loads no backend.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const authoredIds=['B08.1/actual-terminal-shapes','B08.2/pending-prefixes','B08.4/target-conflicts','B08.5/original-finances-recipient','B09.1/lost-ack','B09.3/receipt-first-zero-mutation','B09.4/incomplete-identity-scan'];
const correctionIds=['SR2/missing-first-same-booking','SR2/missing-first-same-class-operation','SR2/missing-first-foreign-summary','SR2/missing-first-duplicate-present','SR1/cumulative-readback-denial','SR1/cumulative-readback-supported'];
async function actualProducerCases(){
  // Reuse public fixture declarations ONLY; do not invoke the arbitration suite.
  const text=fs.readFileSync(path.join(__dirname,'fixtures/guest-booking-r2-producer-prefix.js'),'utf8').replace(/\r\n/g,'\n');
  assert.equal(require('node:crypto').createHash('sha256').update(text).digest('hex'),'97fa4ede51900253b49219b4ed2911641a77934a89830594bc04c04e5fda950b');
  const fixtures=vm.runInNewContext(text+';({database,subject,issue,plain})',{require,Buffer,console,__dirname});
  const db=fixtures.database();db.rows.GuestBookingCompletions=[];
  const {A,T}=await fixtures.issue(db,[{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:1,guests:2}]);
  const prefixes=[],marks=[];const mark=id=>{assert.ok(!marks.includes(id));marks.push(id);};
  async function step(hooks={}){const s=fixtures.subject(db,hooks);const r=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);assert.ok(s.trace.filter(t=>t.op==='insert').length<=1);assert.equal(s.trace.some(t=>t.op==='secret'),false);return {r,s};}
  let last;
  for(let i=0;i<200;i++){prefixes.push(fixtures.plain(db.rows));last=await step();for(const c of ['Bookings','BookingSummary'])assert.ok(db.rows[c].every(r=>r.status==='pending'));if(last.r.status==='CONFIRMED')break;assert.ok(['ACQUISITION_PENDING','COMPLETION_PENDING'].includes(last.r.status),last.r.status);}
  assert.equal(last.r.status,'CONFIRMED');const end=fixtures.plain(db.rows),receipt=end.GuestBookingCompletions[0];
  assert.notEqual(T[8],T[7][0]);assert.deepEqual(end.Bookings.map(r=>r._id),T[7]);
  assert.deepEqual(Object.keys(end.Bookings[0]),['_id','roomCode','assignedRoom','quantity','checkIn','checkOut','bookingNumber','operationId','payloadDigest','guests','note','status']);
  assert.deepEqual(Object.keys(end.BookingSummary[0]),['_id','bookingNumber','bookingDate','checkIn','checkOut','guestName','guestEmail','guestPhone','marketSource','notes','packageTitle','roomCount','status']);mark(authoredIds[0]);
  for(const p of prefixes)assert.ok(p.GuestBookingCompletions.length===0);mark(authoredIds[1]);
  const projection=JSON.parse(receipt.projectionCanonical),capsule=JSON.parse(end.GuestBookingAcceptances[0].capsule);
  assert.deepEqual(projection.summary.acceptedCalculation,capsule.calculation);assert.equal(projection.summary.acceptedCalculation.groups.length,3);assert.equal(receipt.recipient,projection.summary.guestEmail);assert.equal(receipt.primaryBookingRowId,T[8]);assert.equal(projection.plannedBookingRows.find(r=>r._id===T[8]).note,'Café 李');mark(authoredIds[3]);
  for(const c of ['Bookings','BookingSummary','GuestBookingCompletions'])for(const k of Object.keys(end[c][0])){db.rows=fixtures.plain(end);const row=db.rows[c][0];row[k]=typeof row[k]==='number'?row[k]+1:row[k]+'x';const {r,s}=await step();assert.ok(['UNKNOWN','INTEGRITY'].includes(r.status));assert.equal(s.trace.some(t=>t.op==='insert'),false);}
  db.rows=fixtures.plain(end);db.rows.Bookings[0].roomFee=1;assert.notEqual((await step()).r.status,'CONFIRMED');mark(authoredIds[2]);
  for(const c of ['GuestBookingAcquisitionControls','RoomBookingClaimEvents','Bookings','BookingSummary'])for(const target of end[c]){db.rows=fixtures.plain(end);db.rows[c]=db.rows[c].filter(r=>r._id!==target._id);const {r,s}=await step();assert.ok(['UNKNOWN','INTEGRITY'].includes(r.status));assert.equal(s.trace.some(t=>t.op==='insert'),false);}
  db.rows=fixtures.plain(end);last=await step();assert.equal(last.r.status,'CONFIRMED');assert.equal(last.s.trace.some(t=>t.op==='insert'),false);
  last=await step({read:async(c)=>{if(c==='GuestBookingCompletions')throw Error('unreadable');}});assert.equal(last.r.status,'UNKNOWN');assert.equal(last.s.trace.some(t=>t.op==='insert'),false);mark(authoredIds[5]);
  const applyBeforeAckEvidence=[],targets=[];
  for(const c of ['Bookings','BookingSummary','GuestBookingCompletions'])for(const row of end[c])targets.push({c,row});
  assert.equal(end.Bookings.length,3);assert.equal(end.BookingSummary.length,1);assert.equal(end.GuestBookingCompletions.length,1);
  assert.equal(targets.length,5);
  for(let ordinal=0;ordinal<targets.length;ordinal++){
   const {c,row:target}=targets[ordinal],id='B09.1/'+c+'/'+ordinal+'/apply-before-ack';
   const index=prefixes.findIndex((v,i)=>!v[c].some(r=>r._id===target._id)&&(prefixes[i+1]||end)[c].some(r=>r._id===target._id));
   assert.ok(index>=0);const p=prefixes[index],successor=prefixes[index+1]||end;
   const x=b091ApplyBeforeAckSetup(fixtures,p,c,target),{s}=x;db.rows=x.db.rows;
   assert.deepEqual(x.expected,successor,'one native target is the complete immediate successor');
   const api=s.load('backend/guestBookingPhysicalAcquisition'),invoke=api.resumeGuestBookingPhysicalAcquisition;
   const result=await invoke(A);
   assert.equal(result.status,c==='GuestBookingCompletions'?'CONFIRMED':'COMPLETION_PENDING','exact retained readback reconciles lost ACK');
   assert.deepEqual(x.counts,{attempted:1,applied:1,acknowledged:0,readbacks:1});
   b091ExactTail(fixtures,s,c,target);
   assert.deepEqual(db.rows[c].find(r=>r._id===target._id),target);
   assert.deepEqual(db.rows,x.expected,'raw complete native delta after applied write / lost ACK');
   assert.equal(db.rows[c].filter(r=>r._id===target._id).length,1);
   const retained=fixtures.plain(db.rows),recovery=[];
   const contexts=new Set([s.context]),apis=new Set([api]),functions=new Set([invoke]),loaders=new Set([s.load]);
   for(let next=ordinal+1;next<=targets.length;next++){
    const fresh=fixtures.subject(db);assert.equal(fresh.loadedBackendNames().length,0);
    assert.equal(contexts.has(fresh.context),false);contexts.add(fresh.context);
    assert.equal(loaders.has(fresh.load),false);loaders.add(fresh.load);
    const freshApi=fresh.load('backend/guestBookingPhysicalAcquisition'),call=freshApi.resumeGuestBookingPhysicalAcquisition;
    assert.equal(apis.has(freshApi),false);apis.add(freshApi);assert.equal(functions.has(call),false);functions.add(call);
    const before=fixtures.plain(db.rows),want=fixtures.plain(before),selected=targets[next],r=await call(A);
    assert.equal(r.status,selected&&selected.c!=='GuestBookingCompletions'?'COMPLETION_PENDING':'CONFIRMED');
    const first=fresh.trace[0];assert.equal(first.op,'find');assert.equal(first.c,'GuestBookingCompletions');
    assert.deepEqual(first.f,fixtures.plain(['_id',receipt._id]));
    assert.deepEqual(first.o,fresh.realm({suppressAuth:true,suppressHooks:true,consistentRead:true}));
    assert.equal(fresh.trace.some(t=>t.op==='insert'&&t.c===c&&t.row._id===target._id),false,'never retry the retained target write');
    if(selected){assert.equal(before[selected.c].some(v=>v._id===selected.row._id),false);b091ExactTail(fixtures,fresh,selected.c,selected.row);want[selected.c].push(fixtures.plain(selected.row));}
    else assert.equal(fresh.trace.every(t=>t.op==='find'&&t.c!=='GuestBookingFinancialRevisions'),true);
    assert.deepEqual(db.rows,want,'exact next target only, no duplicate or collateral writes');
    assert.deepEqual(db.rows.GuestBookingAcceptances,end.GuestBookingAcceptances);
    for(const name of ['Bookings','BookingSummary'])assert.equal(db.rows[name].every(v=>v.status==='pending'),true);
    recovery.push({next,result:r,trace:fresh.trace});
   }
   assert.deepEqual(db.rows,end,'all original financial groups, recipient, primary, note and native storage retained');
   applyBeforeAckEvidence.push({id,result,trace:s.trace,before:x.before,retained,recovery});
  }
  assert.equal(new Set(applyBeforeAckEvidence.map(v=>v.id)).size,5);
  mark(authoredIds[4]);db.rows=fixtures.plain(end);db.rows.GuestBookingCompletions=[];
  last=await step({read:async(c,f)=>{if(c==='Bookings'&&f?.[0]==='bookingNumber')throw Error('incomplete scan');}});assert.equal(last.r.status,'UNKNOWN');assert.equal(last.s.trace.some(t=>t.op==='insert'),false);mark(authoredIds[6]);
  // SR2: retained identity conflicts must deny even with the FIRST target absent.
  // These ordinary actual-coordinator regressions are AUTHORED, NOT RUN (D1 gate).
  for(const kind of ['same-booking','same-class-operation','foreign-summary','duplicate-present']){
    db.rows=fixtures.plain(end);db.rows.GuestBookingCompletions.length=0;
    db.rows.Bookings=db.rows.Bookings.filter(row=>row._id!==end.Bookings[0]._id);
    assert.equal(db.rows.Bookings.some(row=>row._id===end.Bookings[0]._id),false);
    if(kind==='foreign-summary')db.rows.BookingSummary.push(Object.assign(fixtures.plain({}),end.BookingSummary[0],{_id:'gbs1-'+'f'.repeat(64)}));
    else if(kind==='duplicate-present')db.rows.Bookings.push(Object.assign(fixtures.plain({}),db.rows.Bookings[0]));
    else {const foreign=Object.assign(fixtures.plain({}),end.Bookings[0],{_id:end.Bookings[0]._id.replace(/-r[1-4]$/,'-r4')});assert.ok(!end.Bookings.some(row=>row._id===foreign._id));if(kind==='same-class-operation')foreign.bookingNumber+='-foreign';db.rows.Bookings.push(foreign);}
    const before=fixtures.plain(db.rows),{r,s}=await step();assert.equal(r.status,'INTEGRITY',kind);
    assert.equal(s.trace.some(t=>['insert','update','save','remove','release','secret'].includes(t.op)),false,kind);
    assert.deepEqual(db.rows,before,kind);
    if(kind!=='duplicate-present')assert.ok(s.trace.some(t=>t.op==='find'&&t.c==='Bookings'&&t.f?.[0]==='bookingNumber'),kind);
    mark('SR2/missing-first-'+kind);
  }
  // SR1 Store boundary: exhaust cumulative admitted bytes with actual retained
  // writer-produced receipt reads, then remove the target before the attempted
  // insert. This is transport budgeting, not a coordinator-envelope witness.
  // A neighboring supported case must still perform one insert and exact readback.
  for(const supported of [false,true]){
    db.rows=fixtures.plain(end);const s=fixtures.subject(db),scope=s.load('backend/guestBookingAcquisitionContentionEvidence').createGuestBookingAcquisitionReadScope();
    const api=s.load('backend/guestBookingCompletionStore');
    const store=api.createGuestBookingCompletionStore(scope);
    const row=s.realm(receipt),cost=Buffer.byteLength(JSON.stringify([receipt]),'utf8'),held=cost+4096;
    const count=Math.floor((400000-held)/cost)+(supported?0:1);assert.ok(count>0);
    for(let i=0;i<count;i++)assert.equal((await store.exact('GuestBookingCompletions',receipt._id)).status,'FOUND');
    assert.ok(count*cost<=400000);assert.equal(count*cost+held<=400000,supported);
    db.rows.GuestBookingCompletions.length=0;const at=s.trace.length,before=fixtures.plain(db.rows),reservedBefore=scope.snapshot().spentFinds;
    const found=await store.insert('GuestBookingCompletions',row),trace=s.trace.slice(at);
    assert.equal(found.status,supported?'FOUND':'UNKNOWN');
    if(supported){assert.deepEqual(fixtures.plain(found.record),receipt);assert.deepEqual(trace.map(t=>t.op),fixtures.plain(['insert','find']));assert.equal(scope.snapshot().spentFinds,reservedBefore+1);}
    else {assert.deepEqual(trace,fixtures.plain([]),'byte exhaustion must deny BEFORE insert AND readback');assert.deepEqual(db.rows,before);}
    mark(supported?'SR1/cumulative-readback-supported':'SR1/cumulative-readback-denial');
  }
  assert.deepEqual([...marks].sort(),[...authoredIds,...correctionIds].sort());return {db,A,T,prefixes,end,fixtures,marks,applyBeforeAckEvidence};
}
// Bounded shared-meter regressions: AUTHORED NOTRUN; even this selection loads
// the actual contention module and its D1 closure. Not an alternate safe runner.
const meteringIds=['SR1/inherited-exact-byte-consumption','SR1/reservation-no-double-charge','SR1/reservation-single-use','SR1/reservation-growth-denial-supported-neighbor'];
async function sharedMeteringCases(fixtures,end,A){
  const db=fixtures.database();db.rows=fixtures.plain(end);
  // Ordinary metadata only, not native-Date/descriptor/prototype assessments.
  for(const row of db.rows.RoomBookingClaimEvents)row._owner='ordinary-owner-"-\\-é';
  const s=fixtures.subject(db),factory=s.load('backend/guestBookingAcquisitionContentionEvidence').createGuestBookingAcquisitionReadScope;
  const scope=factory(),marks=[];
  // This increment meters every contention find, including root/manifest and scans.
  // Independent native-envelope oracle includes [] and comma bytes, including misses.
  const cost=rows=>Buffer.byteLength(JSON.stringify(rows),'utf8');
  for(let pass=0;pass<2;pass++){
    const at=s.trace.length,before=scope.snapshot();const result=await scope.read(A);
    assert.equal(result.status,'EVIDENCED');
    const reads=s.trace.slice(at).filter(t=>t.op==='find');
    assert.ok(reads.length>0);const expected=reads.reduce((n,t)=>{let rows=db.rows[t.c].slice().sort((a,b)=>a._id<b._id?-1:1);if(t.f)rows=rows.filter(r=>t.f[2]?r[t.f[0]]>t.f[1]:r[t.f[0]]===t.f[1]);rows=rows.slice(0,t.f&&!t.f[2]?2:100);return n+cost(rows)+(t.c==='GuestBookingAllocationManifests'&&rows.length?4096:0);},0);
    assert.equal(scope.snapshot().spentFinds-before.spentFinds,reads.length);
    assert.equal(scope.snapshot().spentBytes-before.spentBytes,expected);
    assert.ok(scope.snapshot().spentBytes>before.spentBytes);
  }
  assert.equal(factory().snapshot().spentBytes,0);
  const failing=fixtures.subject(db,{read:async(c,f)=>{if(c==='RoomBookingClaimEvents'&&f?.[0]==='_id')throw Error('ordinary failed find');}});
  const failedScope=failing.load('backend/guestBookingAcquisitionContentionEvidence').createGuestBookingAcquisitionReadScope();
  assert.equal((await failedScope.read(A)).status,'UNKNOWN');
  const failedAt=failing.trace.length,spent=failedScope.snapshot().spentFinds;
  assert.ok(spent>0);assert.equal((await failedScope.read(A)).status,'UNKNOWN');
  assert.equal(failing.trace.length,failedAt);assert.equal(failedScope.snapshot().spentFinds,spent);
  marks.push(meteringIds[0]);
  const reserve=(q,n)=>q.reserveMutationReadback('RoomBookingClaimEvents','rc1-test',n);
  const q=factory();q.chargeBytes(17);const credit=reserve(q,100),held=q.snapshot();
  assert.equal(held.spentBytes,17);assert.equal(held.heldBytes,100);assert.equal(held.heldFinds,1);
  q.startMutation(credit,'RoomBookingClaimEvents','rc1-test');q.beginReadback(credit,'RoomBookingClaimEvents','rc1-test');
  q.settleReadback(credit,61);assert.equal(q.snapshot().spentBytes,78);assert.equal(q.snapshot().spentFinds,1);
  assert.equal(q.snapshot().heldBytes,0);assert.equal(q.snapshot().heldFinds,0);marks.push(meteringIds[1]);
  assert.throws(()=>q.beginReadback(credit,'RoomBookingClaimEvents','rc1-test'));
  assert.equal(q.snapshot().spentFinds,1);
  for(const kind of ['forged','foreign','mismatch']){
    const owner=factory(),other=factory(),token=reserve(owner,100),target=kind==='foreign'?other:owner;
    assert.throws(()=>target.startMutation(kind==='forged'?{}:token,'RoomBookingClaimEvents',kind==='mismatch'?'rc1-other':'rc1-test'));
    assert.equal(target.snapshot().spentFinds,0);assert.equal(target.snapshot().spentMutations,0);
  }
  const abandoned=factory(),unused=reserve(abandoned,100);
  abandoned.abandonMutationReadback(unused,'RoomBookingClaimEvents','rc1-test');
  assert.equal(abandoned.snapshot().heldBytes,0);assert.equal(abandoned.snapshot().heldFinds,0);
  const replacement=reserve(abandoned,100);abandoned.startMutation(replacement,'RoomBookingClaimEvents','rc1-test');
  assert.throws(()=>abandoned.abandonMutationReadback(replacement,'RoomBookingClaimEvents','rc1-test'));
  assert.equal(abandoned.snapshot().spentMutations,1);
  marks.push(meteringIds[2]);
  for(const growth of [false,true]){
    const meter=factory(),token=reserve(meter,100);meter.startMutation(token,'RoomBookingClaimEvents','rc1-test');meter.beginReadback(token,'RoomBookingClaimEvents','rc1-test');
    if(growth){assert.throws(()=>meter.settleReadback(token,101));assert.throws(()=>meter.reserveExact());assert.equal(meter.snapshot().spentFinds,1);}
    else {meter.settleReadback(token,100);assert.equal(meter.snapshot().spentBytes,100);assert.equal(meter.snapshot().spentMutations,1);}
  }
  for(const dimension of ['count','bytes']){
    const meter=factory();if(dimension==='bytes')meter.chargeBytes(400000);else for(let i=0;i<30000;i++)meter.reserveExact();
    assert.throws(()=>reserve(meter,1));assert.equal(meter.snapshot().spentMutations,0);assert.equal(meter.snapshot().heldFinds,0);assert.equal(meter.snapshot().heldBytes,0);
  }
  // Mechanism witness only: future coordinator growth test must pause the measured
  // retained reload, grow an admitted native page past its held capacity, and assert
  // zero selected terminal insert; pair the unchanged-history supported insertion.
  // That suffix integration, actual SDK trace and production crossing remain OPEN.
  marks.push(meteringIds[3]);assert.deepEqual(marks,meteringIds);return marks;
}
// AUTHORED NOTRUN: actual Store + actual invocation ledger, using retained producer
// controls. This function must not be selected until its D1 closure is admitted.
const controlMeteringIds=['SR1/control-native-exact-envelope','SR1/control-atomic-insert-count-bytes','SR1/control-readback-lost-ack-no-double-charge','SR1/control-readback-failure-latch','SR1/control-credit-ownership'];
async function controlMeteringCases(fixtures,end){
  const collection='GuestBookingAcquisitionControls',marks=[];
  const cost=rows=>Buffer.byteLength(JSON.stringify(rows),'utf8');
  const candidate=end[collection].find(r=>r.kind==='group-start');assert.ok(candidate);
  function setup(hooks={}){
    const db=fixtures.database();db.rows=fixtures.plain(end);
    for(const row of db.rows[collection])row._owner='ordinary-owner-"-\\-é';
    const s=fixtures.subject(db,hooks),api=s.load('backend/guestBookingAcquisitionControlStore');
    const scope=s.load('backend/guestBookingAcquisitionContentionEvidence').createGuestBookingAcquisitionReadScope();
    return {db,s,api,scope};
  }
  const x=setup();
  for(const row of x.db.rows[collection]){
    const before=x.scope.snapshot(),at=x.s.trace.length;
    const found=await x.api.readGuestBookingAcquisitionControl(row._id,x.scope,{});
    assert.equal(found.status,'FOUND');assert.equal(Object.hasOwn(found.record,'_owner'),false);
    assert.equal(x.scope.snapshot().spentBytes-before.spentBytes,cost([row]));
    assert.equal(x.scope.snapshot().spentFinds-before.spentFinds,1);assert.equal(x.s.trace.length-at,1);
  }
  // Include the complete admission/manifestCanonical object, not its identity tuple.
  assert.ok(x.db.rows[collection].some(r=>r.kind==='admission'));
  x.db.rows[collection]=[];const absentBefore=x.scope.snapshot();
  assert.equal((await x.api.readGuestBookingAcquisitionControl(candidate._id,x.scope)).status,'ABSENT');
  assert.equal(x.scope.snapshot().spentBytes-absentBefore.spentBytes,2);marks.push(controlMeteringIds[0]);
  for(const dimension of ['count','bytes']){
    const q=setup();q.db.rows[collection]=[];
    if(dimension==='bytes')q.scope.chargeBytes(400000);else for(let i=0;i<30000;i++)q.scope.reserveExact();
    const before=q.scope.snapshot(),at=q.s.trace.length;
    assert.equal((await q.api.reconcileGuestBookingAcquisitionControl(q.s.realm(candidate),q.scope)).status,'UNRESOLVED');
    assert.equal(q.s.trace.length,at);assert.deepEqual(q.db.rows[collection],[]);
    assert.equal(q.scope.snapshot().spentMutations,0);assert.equal(q.scope.snapshot().heldFinds,0);
    assert.equal(q.scope.snapshot().spentFinds,before.spentFinds);
  }
  marks.push(controlMeteringIds[1]);
  for(const lostAck of [false,true]){
    const q=setup({after:async(c)=>{if(c===collection&&lostAck)throw Error('lost ACK');}});q.db.rows[collection]=[];
    const capacity=cost([candidate])+4096;q.scope.chargeBytes(400000-capacity);
    const before=q.scope.snapshot(),at=q.s.trace.length;
    const found=await q.api.reconcileGuestBookingAcquisitionControl(q.s.realm(candidate),q.scope);
    assert.equal(found.status,'FOUND');assert.deepEqual(fixtures.plain(found.record),candidate);
    assert.deepEqual(q.s.trace.slice(at).map(t=>t.op),['insert','find']);
    assert.equal(q.scope.snapshot().spentFinds-before.spentFinds,1);
    assert.equal(q.scope.snapshot().spentBytes-before.spentBytes,cost([candidate]));
    assert.equal(q.scope.snapshot().spentMutations,1);assert.equal(q.scope.snapshot().heldBytes,0);
    assert.equal((await q.api.reconcileGuestBookingAcquisitionControl(q.s.realm(candidate),q.scope)).status,'UNRESOLVED');
    assert.equal(q.s.trace.length-at,2,'one mutation slot cannot be reused');
  }
  marks.push(controlMeteringIds[2]);
  for(const mode of ['throw','absent','malformed']){
    const q=setup({read:async(c)=>{if(c!==collection)return;if(mode==='throw')throw Error('readback failed');if(mode==='absent')q.db.rows[c]=[];if(mode==='malformed')q.db.rows[c][0].extra='invalid';}});q.db.rows[collection]=[];
    const found=await q.api.reconcileGuestBookingAcquisitionControl(q.s.realm(candidate),q.scope);
    assert.ok(['UNRESOLVED','ABSENT'].includes(found.status));assert.equal(q.scope.snapshot().spentFinds,1);
    assert.equal(q.scope.snapshot().spentMutations,1);const at=q.s.trace.length;
    assert.equal((await q.api.readGuestBookingAcquisitionControl(candidate._id,q.scope)).status,'UNRESOLVED');
    assert.equal(q.s.trace.length,at,'unusable readback must latch invocation');
  }
  marks.push(controlMeteringIds[3]);
  for(const mode of ['foreign','forged','mismatch','reused']){
    const q=setup(),other=setup(),token=q.scope.reserveMutationReadback(collection,candidate._id,4096);
    const target=mode==='foreign'?other.scope:q.scope,at=q.s.trace.length;
    if(mode==='reused')q.scope.startMutation(token,collection,candidate._id);
    assert.throws(()=>target.startMutation(mode==='forged'?{}:token,collection,mode==='mismatch'?'ra2-other':candidate._id));
    assert.equal(q.s.trace.length,at);assert.equal(other.s.trace.length,0);
  }
  marks.push(controlMeteringIds[4]);
  // Retained admission shape with a growing native envelope: this is transport
  // rejection, NOT manifest authority or the outstanding coordinator growth proof.
  const anchor=end[collection].find(r=>r.kind==='admission');assert.ok(anchor);
  const grown=setup({after:async(c,row)=>{if(c===collection){grown.db.rows[c][0].manifestCanonical+=' '.repeat(5000);throw Error('lost ACK with larger winner');}}});
  grown.db.rows[collection]=[];
  assert.equal((await grown.api.reconcileGuestBookingAcquisitionControl(grown.s.realm(anchor),grown.scope)).status,'UNRESOLVED');
  assert.deepEqual(grown.s.trace.map(t=>t.op),['insert','find']);
  assert.equal(grown.scope.snapshot().spentFinds,1);assert.equal(grown.scope.snapshot().spentMutations,1);
  assert.ok(grown.scope.snapshot().heldBytes>0);assert.throws(()=>grown.scope.reserveExact());
  assert.deepEqual(marks,controlMeteringIds);return marks;
}
// Resource increment: AUTHORED NOTRUN, no alternate loader or D1 admission.
const resourceMeteringIds=['SR1/resource-page-delta','SR1/resource-repeat-exact-native','SR1/resource-empty-error-latch','SR1/resource-reservation-neighbor','SR1/resource-credit-isolation','SR1/resource-root-manifest-cost'];
async function resourceMeteringCases(fixtures,end,A){
 const c='RoomBookingClaimEvents',cost=rows=>Buffer.byteLength(JSON.stringify(rows),'utf8'),marks=[];
 function setup(hooks={}){const db=fixtures.database();db.rows=fixtures.plain(end);const s=fixtures.subject(db,hooks),api=s.load('backend/guestBookingPhysicalAcquisitionStore'),scope=s.load('backend/guestBookingAcquisitionContentionEvidence').createGuestBookingAcquisitionReadScope();return {db,s,api,scope};}
 const x=setup(),candidate=end[c].find(r=>r.claimType==='capacity'&&r.eventType==='acquire');assert.ok(candidate);
 // Transport-only ordinary admitted rows; not invented retained-ledger authority.
 x.db.rows[c]=Array.from({length:201},(_,i)=>({...candidate,_id:'rc1-meter-'+String(i).padStart(4,'0'),_owner:'owner-"-\\-é'}));
 const pageCost=cost(x.db.rows[c].slice(0,100))+cost(x.db.rows[c].slice(100,200))+cost(x.db.rows[c].slice(200));
 for(let pass=0;pass<2;pass++){const b=x.scope.snapshot(),at=x.s.trace.length;assert.equal((await x.api.scanGuestBookingPhysicalClaims(x.scope)).rows.length,201);assert.equal(x.scope.snapshot().spentBytes-b.spentBytes,pageCost);assert.equal(x.scope.snapshot().spentFinds-b.spentFinds,3);assert.equal(x.s.trace.slice(at).filter(t=>t.op==='find').length,3);}marks.push(resourceMeteringIds[0]);
 for(let pass=0;pass<2;pass++){const b=x.scope.snapshot();const r=await x.api.readGuestBookingPhysicalClaim(x.db.rows[c][0]._id,x.scope,{});assert.equal(r.status,'FOUND');assert.equal(Object.hasOwn(r.record,'_owner'),false);assert.equal(x.scope.snapshot().spentBytes-b.spentBytes,cost([x.db.rows[c][0]]));assert.equal(x.scope.snapshot().spentFinds-b.spentFinds,1);}assert.equal(setup().scope.snapshot().spentBytes,0);marks.push(resourceMeteringIds[1]);
 const empty=setup();empty.db.rows[c]=[];await empty.api.scanGuestBookingPhysicalClaims(empty.scope);await empty.api.readGuestBookingPhysicalClaim(candidate._id,empty.scope);assert.equal(empty.scope.snapshot().spentFinds,2);assert.equal(empty.scope.snapshot().spentBytes,4);
 for(const mode of ['throw','malformed','bytes']){const q=setup({read:async()=>{if(mode==='throw')throw Error('failed page');}});if(mode==='malformed')q.db.rows[c][0].extra='invalid';if(mode==='bytes')q.scope.chargeBytes(400000);await assert.rejects(()=>q.api.scanGuestBookingPhysicalClaims(q.scope));const at=q.s.trace.length;await assert.rejects(()=>q.api.reconcileGuestBookingPhysicalClaim(q.s.realm(candidate),q.scope));assert.equal(q.s.trace.length,at);assert.equal(q.scope.snapshot().spentFinds,1);}marks.push(resourceMeteringIds[2]);
 for(const mode of ['count','bytes','supported','lost-ack','duplicate']){const q=setup({after:async()=>{if(mode==='lost-ack')throw Error('lost ACK');}});q.db.rows[c]=mode==='duplicate'?[{...candidate}]:[];const capacity=cost([candidate])+4096;if(mode==='count')for(let i=0;i<30000;i++)q.scope.reserveExact();else q.scope.chargeBytes(mode==='bytes'?400000:400000-capacity);const b=q.scope.snapshot(),at=q.s.trace.length;if(['count','bytes'].includes(mode)){await assert.rejects(()=>q.api.reconcileGuestBookingPhysicalClaim(q.s.realm(candidate),q.scope));assert.equal(q.s.trace.length,at);assert.equal(q.scope.snapshot().spentMutations,0);}else{assert.equal((await q.api.reconcileGuestBookingPhysicalClaim(q.s.realm(candidate),q.scope)).status,'ACQUISITION_PENDING');assert.deepEqual(q.s.trace.slice(at).map(t=>t.op),['insert','find']);assert.equal(q.scope.snapshot().spentFinds-b.spentFinds,1);assert.equal(q.scope.snapshot().spentBytes-b.spentBytes,cost([candidate]));assert.equal(q.scope.snapshot().heldBytes,0);}}marks.push(resourceMeteringIds[3]);
 for(const mode of ['forged','cross-session','mismatch','reused']){const q=setup(),other=setup(),token=q.scope.reserveMutationReadback(c,candidate._id,4096),target=mode==='cross-session'?other.scope:q.scope;q.scope.startMutation(token,c,candidate._id);if(mode==='reused'){q.scope.beginReadback(token,c,candidate._id);q.scope.settleReadback(token,2);}assert.throws(()=>target.beginReadback(mode==='forged'?{}:token,c,mode==='mismatch'?'rc1-other':candidate._id));assert.equal(q.s.trace.length,0);assert.equal(other.s.trace.length,0);}marks.push(resourceMeteringIds[4]);
 const q=setup();q.db.rows.GuestBookingAcceptances[0]._owner='ordinary-long-owner-'.repeat(40);const b=q.scope.snapshot(),at=q.s.trace.length;assert.equal((await q.scope.read(A)).status,'EVIDENCED');const trace=q.s.trace.slice(at).filter(t=>t.op==='find');let expected=0;for(const t of trace){let rows=q.db.rows[t.c].slice().sort((a,b)=>a._id<b._id?-1:1);if(t.f?.[0]==='_id')rows=rows.filter(r=>t.f[2]?r._id>t.f[1]:r._id===t.f[1]);rows=rows.slice(0,t.f?.[0]==='_id'&&!t.f[2]?2:100);expected+=cost(rows)+(t.c==='GuestBookingAllocationManifests'&&rows.length?4096:0);}assert.equal(q.scope.snapshot().spentBytes-b.spentBytes,expected);assert.equal(q.scope.snapshot().spentFinds-b.spentFinds,trace.length);marks.push(resourceMeteringIds[5]);
 // Root and manifest remaining-byte neighbors: admitted roots precede denial;
 // these are manually consumed mechanism boundaries, not production reachability.
 for(const stage of ['root','manifest']){const z=setup();const rootCost=cost(z.db.rows.GuestBookingAcceptances),manifestCost=cost(z.db.rows.GuestBookingAllocationManifests)+4096;z.scope.chargeBytes(400000-(stage==='root'?rootCost-1:rootCost+manifestCost-1));assert.equal((await z.scope.read(A)).status,'UNKNOWN');assert.equal(z.scope.snapshot().spentFinds,stage==='root'?1:2);assert.equal(z.s.trace.some(t=>t.op==='insert'),false);const at=z.s.trace.length;assert.equal((await z.scope.read(A)).status,'UNKNOWN');assert.equal(z.s.trace.length,at);}
 for(const mode of ['throw','absent','malformed']){const z=setup({read:async(collection)=>{if(collection!==c)return;if(mode==='throw')throw Error('readback');if(mode==='absent')z.db.rows[c]=[];if(mode==='malformed')z.db.rows[c][0].extra='invalid';}});z.db.rows[c]=[];if(mode==='absent')assert.equal((await z.api.reconcileGuestBookingPhysicalClaim(z.s.realm(candidate),z.scope)).status,'UNKNOWN');else await assert.rejects(()=>z.api.reconcileGuestBookingPhysicalClaim(z.s.realm(candidate),z.scope));assert.deepEqual(z.s.trace.map(t=>t.op),['insert','find']);assert.equal(z.scope.snapshot().spentFinds,1);assert.equal(z.scope.snapshot().spentMutations,1);const at=z.s.trace.length;await assert.rejects(()=>z.api.readGuestBookingPhysicalClaim(candidate._id,z.scope));assert.equal(z.s.trace.length,at);}
 assert.deepEqual(marks,resourceMeteringIds);return marks;
}
// AUTHORED NOTRUN: shared terminal/model accounting, not D1 admission.
const suffixAccountingIds=['SR1/terminal-native-shared-categories','SR1/model-root-manifest-shared','SR1/terminal-held-readback-neighbors'];
async function suffixAccountingCases(fixtures,end,A){
 const cost=rows=>Buffer.byteLength(JSON.stringify(rows),'utf8'),marks=[];
 function setup(hooks={}){const db=fixtures.database();db.rows=fixtures.plain(end);const s=fixtures.subject(db,hooks),scope=s.load('backend/guestBookingAcquisitionContentionEvidence').createGuestBookingAcquisitionReadScope(),store=s.load('backend/guestBookingCompletionStore').createGuestBookingCompletionStore(scope);return {db,s,scope,store};}
 const q=setup(),c='GuestBookingCompletions',row=end[c][0];q.db.rows[c]=[];
 assert.equal((await q.store.exact(c,row._id,'early-receipt')).status,'ABSENT');
 assert.equal((await q.store.scan(c,'acceptanceId',A,'early-binding')).status,'FOUND');
 assert.equal(q.scope.snapshot().spentFinds,2);assert.equal(q.scope.snapshot().spentBytes,4);
 q.db.rows[c]=[{...row,_owner:'ordinary-"-é'}];
 for(let i=0;i<2;i++)assert.equal((await q.store.exact(c,row._id)).status,'FOUND');
 const snap=q.scope.snapshot();assert.equal(snap.spentBytes,4+2*cost(q.db.rows[c]));
 assert.equal(Object.values(snap.categories).reduce((n,v)=>n+v.spentFinds,0),snap.spentFinds);
 assert.equal(Object.values(snap.categories).reduce((n,v)=>n+v.spentBytes,0),snap.spentBytes);
 assert.equal(Object.values(snap.categories).reduce((n,v)=>n+v.pages,0),4);
 assert.equal(snap.categories['early-receipt'].spentBytes,2);assert.equal(snap.categories['early-binding'].pages,1);
 assert.ok(Object.isFrozen(snap.categories));assert.ok(Object.isFrozen(snap.categories['early-receipt']));marks.push(suffixAccountingIds[0]);
 const m=setup(),session=m.s.load('backend/guestBookingPhysicalAcquisitionEvidence').createGuestBookingPhysicalAcquisitionSession();
 for(let pass=0;pass<2;pass++){const before=session.costSnapshot();await session.readCompletionModel(A);const after=session.costSnapshot();assert.equal(after.spentFinds-before.spentFinds,2);assert.equal(after.spentBytes-before.spentBytes,cost(m.db.rows.GuestBookingAcceptances)+cost(m.db.rows.GuestBookingAllocationManifests)+4096);assert.equal(after.categories['model-root'].pages,pass+1);assert.equal(after.categories['model-manifest'].pages,pass+1);}marks.push(suffixAccountingIds[1]);
 for(const mode of ['count','bytes','supported','lost-ack','absent','malformed']){
  const x=setup({after:async()=>{if(mode==='lost-ack')throw Error('lost ACK');},read:async(collection)=>{if(collection!==c)return;if(mode==='absent')x.db.rows[c]=[];if(mode==='malformed')x.db.rows[c][0].extra='invalid';}});x.db.rows[c]=[];
  if(mode==='count')for(let i=0;i<30000;i++)x.scope.reserveExact();
  else if(mode==='bytes')x.scope.chargeBytes(400000);
  else if(['supported','lost-ack'].includes(mode))x.scope.chargeBytes(400000-cost([row])-4096);
  const before=x.scope.snapshot(),r=await x.store.insert(c,x.s.realm(row));
  if(['count','bytes'].includes(mode)){assert.equal(r.status,'UNKNOWN');assert.equal(x.s.trace.length,0);}
  else {assert.deepEqual(x.s.trace.map(t=>t.op),['insert','find']);assert.equal(x.scope.snapshot().spentFinds-before.spentFinds,1);if(['supported','lost-ack'].includes(mode)){assert.equal(r.status,'FOUND');assert.equal(x.scope.snapshot().spentBytes-before.spentBytes,cost([row]));assert.equal(x.scope.snapshot().heldBytes,0);}else{assert.ok(['UNKNOWN','INTEGRITY'].includes(r.status));assert.throws(()=>x.scope.reserveExact());}}
 }marks.push(suffixAccountingIds[2]);assert.deepEqual(marks,suffixAccountingIds);return marks;
}
// Forward regression for the explicitly OPEN full-suffix reload/hold part.
// It must fail on the unreserved missing-target early return; NOTRUN, not RED.
const suffixHoldIds=['SR1/suffix-preselected-growth-first-target','SR1/suffix-preselected-growth-receipt'];
async function suffixHoldCases(fixtures,end,A){
 const marks=[];
 for(const target of ['first-target','receipt'])for(const growth of [false,true]){
  const db=fixtures.database();db.rows=fixtures.plain(end);db.rows.GuestBookingCompletions=[];
  if(target==='first-target'){db.rows.Bookings=[];db.rows.BookingSummary=[];}
  // A supported first-target neighbor is the empty native writer prefix, not
  // a hole before retained later Bookings/Summary. Negative SR2 holes stay intact.
  let identitySeen=false,reloaded=false;
  const s=fixtures.subject(db,{read:async(c,f)=>{
   if(c==='Bookings'&&f?.[0]==='bookingNumber')identitySeen=true;
   if(identitySeen&&c==='GuestBookingAcceptances'&&!reloaded){reloaded=true;if(growth){db.rows[c][0]._owner='x'.repeat(120000);assert.ok(Buffer.byteLength(JSON.stringify(db.rows[c][0]),'utf8')<=160000,'growth must remain a natively admissible root');}}
  }});
  const r=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);
  assert.equal(identitySeen,true);assert.equal(reloaded,true,'reserved validation is required even before the FIRST missing target');
  const inserts=s.trace.filter(t=>t.op==='insert');
  if(growth){assert.ok(['UNKNOWN','INTEGRITY'].includes(r.status));assert.equal(inserts.length,0,'growth beyond measured hold must deny BEFORE selected insert');}
  else {assert.equal(r.status,target==='receipt'?'CONFIRMED':'COMPLETION_PENDING');assert.equal(inserts.length,1);assert.equal(inserts[0].c,target==='receipt'?'GuestBookingCompletions':'Bookings');}
  if(growth)marks.push('SR1/suffix-preselected-growth-'+target);
 }
 assert.deepEqual(marks,suffixHoldIds);return marks;
}
// AUTHORED_NOTRUN: isolated protocol mechanisms, NOT coordinator suffix admission.
const verificationProtocolIds=['SR1/verification-hold-exact-capacity','SR1/verification-hold-growth-poison','SR1/verification-hold-owner-phase-category','SR1/verification-hold-release-unspent'];
async function verificationProtocolCases(fixtures){
 const fresh=()=>fixtures.subject(fixtures.database()).load('backend/guestBookingAcquisitionContentionEvidence').createGuestBookingAcquisitionReadScope();
 const plan=(finds,bytes,pages=1)=>({'physical':{finds,bytes,pages}}),marks=[];
 const a=fresh();a.chargeBytes(399998);for(let i=0;i<29999;i++)a.reserveExact();
 const t=a.reserveVerification('reload',plan(1,2));assert.equal(a.snapshot().heldFinds,1);assert.equal(a.snapshot().heldBytes,2);
 await a.verify(t,'reload',async()=>{a.reserveExact();a.chargeBytes(2);});
 assert.equal(a.snapshot().spentFinds,30000);assert.equal(a.snapshot().spentBytes,400000);assert.equal(a.snapshot().heldBytes,0);assert.equal(a.snapshot().spentMutations,0);marks.push(verificationProtocolIds[0]);
 for(const kind of ['finds','bytes','pages']){const s=fresh(),token=s.reserveVerification('reload',plan(1,2));await assert.rejects(()=>s.verify(token,'reload',async()=>{s.reserveExact();if(kind==='finds')s.reserveExact();else if(kind==='bytes')s.chargeBytes(3);else{s.chargeBytes(1);s.chargeBytes(1);}}));assert.equal(s.snapshot().spentFinds,1);assert.equal(s.snapshot().spentMutations,0);assert.throws(()=>s.reserveExact());}marks.push(verificationProtocolIds[1]);
 for(const kind of ['owner','phase','category','replay']){const s=fresh(),other=fresh(),token=s.reserveVerification('reload',plan(1,2));if(kind==='owner')await assert.rejects(()=>other.verify(token,'reload',async()=>{}));else if(kind==='phase')await assert.rejects(()=>s.verify(token,'wrong',async()=>{}));else if(kind==='category')await assert.rejects(()=>s.verify(token,'reload',()=>s.measure('model-root',async()=>s.reserveExact())));else{await s.verify(token,'reload',async()=>{s.reserveExact();s.chargeBytes(2);});await assert.rejects(()=>s.verify(token,'reload',async()=>{}));}assert.equal(s.snapshot().spentMutations,0);}marks.push(verificationProtocolIds[2]);
 const s=fresh(),token=s.reserveVerification('reload',plan(2,20,2));await s.verify(token,'reload',async()=>{s.reserveExact();s.chargeBytes(2);});assert.equal(s.snapshot().spentFinds,1);assert.equal(s.snapshot().spentBytes,2);assert.equal(s.snapshot().heldFinds,0);assert.equal(s.snapshot().heldBytes,0);const m=s.reserveMutationReadback('Bookings','key',2);s.startMutation(m,'Bookings','key');s.beginReadback(m,'Bookings','key');s.settleReadback(m,2);assert.equal(s.snapshot().spentFinds,2);assert.equal(s.snapshot().spentBytes,4);assert.equal(s.snapshot().spentMutations,1);marks.push(verificationProtocolIds[3]);
 for(const phase of ['held','reading']){const s=fresh(),token=s.reserveVerification('reload',plan(1,2)),m=s.reserveMutationReadback('Bookings','key',2);if(phase==='held')assert.throws(()=>s.startMutation(m,'Bookings','key'));else await assert.rejects(()=>s.verify(token,'reload',async()=>s.startMutation(m,'Bookings','key')));assert.equal(s.snapshot().spentMutations,0);}
 assert.deepEqual(marks,verificationProtocolIds);return marks;
}
// AUTHORED_NOTRUN actual coordinator neighbor: legal empty terminal prefix,
// not a manually depleted scope or seeded completion authority. end must come
// from actualProducerCases; D1 fixture prerequisites remain unwaived.
async function missingTargetReservedNeighbor(fixtures,end,A){
 const db=fixtures.database();db.rows=fixtures.plain(end);db.rows.Bookings=[];db.rows.BookingSummary=[];db.rows.GuestBookingCompletions=[];
 let identities=0,reloads=0;
 const s=fixtures.subject(db,{read:async(c,f)=>{if(c==='Bookings'&&f?.[0]==='bookingNumber')identities++;if(identities&&c==='GuestBookingAcceptances')reloads++;}});
 const result=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);
 assert.ok(reloads>=1,'first missing row requires physical/model reserved reload');assert.equal(identities,2,'unchanged absent targets must pass both complete identity verifications');
 assert.equal(result.status,'COMPLETION_PENDING');const inserts=s.trace.filter(t=>t.op==='insert');assert.equal(inserts.length,1);assert.equal(inserts[0].c,'Bookings');assert.equal(db.rows.Bookings.length,1);assert.equal(db.rows.BookingSummary.length,0);assert.equal(db.rows.GuestBookingCompletions.length,0);
 return ['SR1/missing-target-reserved-unchanged-neighbor'];
}
// AUTHORED_NOTRUN: ordinary native root-envelope growth at the actual coordinator
// reload boundary; no budget seed, raised limit, or substituted physical result.
async function reservedSelectionCases(fixtures,end,A){
 const marks=[];
 for(const stage of ['first-target','receipt'])for(const growth of [false,true]){
  const db=fixtures.database();db.rows=fixtures.plain(end);db.rows.GuestBookingCompletions.length=0;
  if(stage==='first-target'){db.rows.Bookings.length=0;db.rows.BookingSummary.length=0;}
  let identities=0,boundary=false,atBoundary;
  const s=fixtures.subject(db,{read:async(c,f)=>{
   if(c==='Bookings'&&f?.[0]==='bookingNumber')identities++;
   if(identities===1&&c==='GuestBookingAcceptances'&&!boundary){
    boundary=true;
    if(growth){const row=db.rows[c][0],before=Buffer.byteLength(JSON.stringify(row),'utf8');row._owner=typeof row._owner==='string'?row._owner+'x':'ordinary-growth';assert.ok(Buffer.byteLength(JSON.stringify(row),'utf8')>before);}
    atBoundary=fixtures.plain(db.rows);
   }
  }});
  const r=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);
  assert.equal(boundary,true,'admitted physical/model/identity evidence must precede reload');
  const inserts=s.trace.filter(t=>t.op==='insert');
  if(growth){assert.equal(r.status,'UNKNOWN');assert.equal(inserts.length,0,'held response growth must deny before ANY selected mutation');assert.deepEqual(db.rows,atBoundary,'only scheduled metadata growth; every collection otherwise unchanged');assert.equal(s.trace.some(t=>t.op!=='find'),false);}
  else {
   assert.equal(identities,2);assert.equal(r.status,stage==='receipt'?'CONFIRMED':'COMPLETION_PENDING');assert.equal(inserts.length,1);
   const collection=stage==='receipt'?'GuestBookingCompletions':'Bookings',target=end[collection][0];assert.equal(inserts[0].c,collection);assert.deepEqual(inserts[0].row,target);assert.deepEqual(db.rows[collection].find(row=>row._id===target._id),target);
   const expected=fixtures.plain(atBoundary);expected[collection].push(fixtures.plain(target));assert.deepEqual(db.rows,expected,'supported neighbor changes only selected target');assert.equal(s.trace.some(t=>!['find','insert'].includes(t.op)),false);
   const readback=s.trace.slice(s.trace.indexOf(inserts[0])+1);assert.equal(readback.length,1);assert.equal(readback[0].op,'find');assert.equal(readback[0].c,collection);assert.deepEqual(readback[0].f,fixtures.plain(['_id',target._id]));
   assert.deepEqual(inserts[0].o,s.realm({suppressAuth:true,suppressHooks:true}));assert.deepEqual(readback[0].o,s.realm({suppressAuth:true,suppressHooks:true,consistentRead:true}));
  }
  marks.push('SR1/reserved-selection-'+stage+'-'+(growth?'growth-denial':'supported-neighbor'));
 }
 assert.equal(new Set(marks).size,4);return marks;
}
// AUTHORED_NOTRUN. B09.2 exact frozen terminal-target contract: two fresh module
// workers, not two calls on one cache. Deterministic proposals are identical;
// this must NOT be credited as distinct commit/compensate decision arbitration.
async function terminalWorkerArbitrationCases(fixtures,end,A,prefixes){
 const marks=[];
 for(const c of ['Bookings','BookingSummary','GuestBookingCompletions'])for(const order of [[0,1],[1,0]])for(const winnerMode of ['exact','conflicting','malformed']){
  const target=end[c][0],at=prefixes.findIndex((rows,i)=>!rows[c].some(r=>r._id===target._id)&&(prefixes[i+1]||end)[c].some(r=>r._id===target._id));assert.ok(at>=0);
  const db=fixtures.database();db.rows=fixtures.plain(prefixes[at]);const initial=fixtures.plain(db.rows);
  const gates=[0,1].map(()=>{let enter,release;return {entered:new Promise(r=>enter=r),hold:new Promise(r=>release=r),enter:()=>enter(),release:()=>release()};});
  let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('B09.2 insert barrier deadline')),15000);});
  const workers=gates.map((gate,index)=>fixtures.subject(db,{
   before:async(collection,row)=>{assert.equal(collection,c);assert.deepEqual(row,target);gate.enter();await gate.hold;},
   after:async(collection,row)=>{if(index===order[0]&&winnerMode!=='exact'){
    // Negative retained SDK response corruption only; no fabricated positive authority.
    const position=db.rows[collection].findIndex(r=>r._id===row._id),retained={...db.rows[collection][position]};
    if(winnerMode==='conflicting'){const field=c==='Bookings'?'note':c==='BookingSummary'?'notes':'recipient';retained[field]+='-conflict';}else retained.unexpected='malformed';
    db.rows[collection][position]=fixtures.plain(retained);
   }}
  }));
  const apis=workers.map(s=>s.load('backend/guestBookingPhysicalAcquisition'));
  assert.notEqual(workers[0].context,workers[1].context);assert.notEqual(apis[0],apis[1]);assert.notEqual(apis[0].resumeGuestBookingPhysicalAcquisition,apis[1].resumeGuestBookingPhysicalAcquisition);
  const runs=apis.map(api=>api.resumeGuestBookingPhysicalAcquisition(A));
  try{
   await Promise.race([Promise.all(gates.map((g,i)=>Promise.race([g.entered,runs[i].then(()=>{throw Error('worker returned before target barrier');})]))),deadline]);
   assert.deepEqual(db.rows,initial,'both native insert attempts must be suspended before apply');
   gates[order[0]].release();const first=await Promise.race([runs[order[0]],deadline]);
   const retained=fixtures.plain(db.rows),winner=retained[c].find(r=>r._id===target._id);
   assert.equal(retained[c].filter(r=>r._id===target._id).length,1);
   gates[order[1]].release();const second=await Promise.race([runs[order[1]],deadline]);
   assert.deepEqual(db.rows,retained,'losing immutable insert never overwrites winner');
   for(const s of workers){
    const inserts=s.trace.filter(t=>t.op==='insert');assert.equal(inserts.length,1);assert.equal(inserts[0].c,c);assert.deepEqual(inserts[0].row,target);
    assert.deepEqual(JSON.parse(JSON.stringify(inserts[0].o)),{suppressAuth:true,suppressHooks:true});
    const reads=s.trace.slice(s.trace.indexOf(inserts[0])+1);assert.equal(reads.length,1);assert.equal(reads[0].op,'find');assert.equal(reads[0].c,c);assert.deepEqual(JSON.parse(JSON.stringify(reads[0].f)),['_id',target._id]);assert.deepEqual(JSON.parse(JSON.stringify(reads[0].o)),{suppressAuth:true,suppressHooks:true,consistentRead:true});
    assert.equal(s.trace.some(t=>['update','save','remove','release','secret'].includes(t.op)),false);
   }
   const retry=fixtures.subject(db),retryApi=retry.load('backend/guestBookingPhysicalAcquisition');assert.notEqual(retry.context,workers[0].context);assert.notEqual(retryApi,apis[0]);
   if(winnerMode==='exact'){
    assert.deepEqual(winner,target);assert.equal(first.status,c==='GuestBookingCompletions'?'CONFIRMED':'COMPLETION_PENDING');assert.equal(second.status,first.status);
    for(let n=0;n<20;n++){const s=n===0?retry:fixtures.subject(db),r=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);assert.ok(s.trace.filter(t=>t.op==='insert').length<=1);assert.equal(s.trace.some(t=>t.op==='insert'&&t.c===c&&t.row._id===target._id),false);if(r.status==='CONFIRMED')break;assert.equal(r.status,'COMPLETION_PENDING');}
    assert.deepEqual(db.rows,end);const replay=fixtures.subject(db);assert.equal((await replay.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A)).status,'CONFIRMED');assert.equal(replay.trace.some(t=>t.op!=='find'),false);
   }else{
    assert.equal(first.status,'INTEGRITY');assert.equal(second.status,'INTEGRITY');assert.equal((await retryApi.resumeGuestBookingPhysicalAcquisition(A)).status,'INTEGRITY');assert.equal(retry.trace.some(t=>t.op!=='find'),false);assert.deepEqual(db.rows,retained);
   }
   marks.push('B09.2/terminal-target/'+c+'/'+order.join('-')+'/'+winnerMode);
  }finally{for(const g of gates)g.release();await Promise.race([Promise.allSettled(runs),deadline]).finally(()=>clearTimeout(timer));}
 }
 assert.equal(marks.length,18);assert.equal(new Set(marks).size,marks.length);return marks;
}
// AUTHORED_NOTRUN B09.5 positive reachable start/acquire barriers. Fresh helpers
// advance the SAME retained SDK, never replace it with a later end snapshot.
// Compensation-after-commit is conditionally excluded under compliant immutable
// history, not waived; separate compensation-settlement and INVALID cases follow.
async function terminalStaleWorkerCases(fixtures,end,A,prefixes){
 const marks=[];
 for(const type of ['group-start','capacity','unit'])for(const stage of ['committed-before-first-row','first-row','summary']){
  const c=type==='group-start'?'GuestBookingAcquisitionControls':'RoomBookingClaimEvents';
  const target=end[c].find(r=>type==='group-start'?r.kind===type:r.claimType===type&&r.eventType==='acquire');assert.ok(target);
  const at=prefixes.findIndex((rows,i)=>!rows[c].some(r=>r._id===target._id)&&(prefixes[i+1]||end)[c].some(r=>r._id===target._id));assert.ok(at>=0);
  const db=fixtures.database();db.rows=fixtures.plain(prefixes[at]);let enter,release,timer;
  const entered=new Promise(r=>enter=r),hold=new Promise(r=>release=r),deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('B09.5 stale barrier deadline')),15000);});
  const old=fixtures.subject(db,{before:async(collection,row)=>{assert.equal(collection,c);assert.deepEqual(row,target);enter();await hold;}}),oldApi=old.load('backend/guestBookingPhysicalAcquisition');
  const run=oldApi.resumeGuestBookingPhysicalAcquisition(A);
  try{
   await Promise.race([entered,run.then(()=>{throw Error('stale worker never reached native insert');}),deadline]);
   let reached=false;
   for(let n=0;n<200;n++){
    const s=fixtures.subject(db),api=s.load('backend/guestBookingPhysicalAcquisition');assert.notEqual(s.context,old.context);assert.notEqual(api,oldApi);
    const r=await Promise.race([api.resumeGuestBookingPhysicalAcquisition(A),deadline]);assert.ok(['ACQUISITION_PENDING','COMPLETION_PENDING'].includes(r.status));assert.ok(s.trace.filter(t=>t.op==='insert').length<=1);assert.equal(s.trace.some(t=>['update','save','remove','release','secret'].includes(t.op)),false);
    const committed=db.rows.GuestBookingAcquisitionControls.some(r=>r._id==='ra2-direction-'+A&&r.direction==='commit-rows')&&db.rows.RoomBookingClaimEvents.filter(r=>r.claimType==='operation-decision'&&r.decisionState==='commit-rows').length===end.RoomBookingClaimEvents.filter(r=>r.claimType==='operation-decision').length;
    reached=committed&&(stage==='committed-before-first-row'?db.rows.Bookings.length===0:stage==='first-row'?db.rows.Bookings.length===1:db.rows.BookingSummary.length===1);
    if(reached)break;
   }
   assert.equal(reached,true,stage);assert.equal(db.rows.GuestBookingCompletions.length,0);assert.equal(db.rows.RoomBookingClaimEvents.some(r=>r.eventType==='release'),false);
   const retained=fixtures.plain(db.rows);release();assert.equal((await Promise.race([run,deadline])).status,'ACQUISITION_PENDING');assert.deepEqual(db.rows,retained,'stale collision must not release or rebind any row');
   const attempts=old.trace.filter(t=>t.op==='insert');assert.equal(attempts.length,1);assert.deepEqual(attempts[0].row,target);assert.equal(db.rows[c].filter(r=>r._id===target._id).length,1);assert.deepEqual(db.rows[c].find(r=>r._id===target._id),target);assert.equal(old.trace.some(t=>['update','save','remove','release','secret'].includes(t.op)),false);
   marks.push('B09.5/stale-'+type+'/'+stage);
  }finally{release();await Promise.race([run,deadline]).finally(()=>clearTimeout(timer));}
 }
 assert.equal(marks.length,9);assert.equal(new Set(marks).size,marks.length);return marks;
}
// AUTHORED_NOTRUN / D1: reachable stale compensation, NOT opposing valid cart
// authority. Fixed immutable manifest/ownership and compliant append-only writers
// are proof assumptions only; legacy fencing and live uniqueness remain unverified.
async function terminalStaleCompensationCases(fixtures){
 const equal=(a,b,message)=>assert.deepEqual(a,b,message);
 const marks=[],evidence=[];
 for(const type of ['compensate-direction','compensate-Q','release']){
  const db=fixtures.database();db.rows.GuestBookingCompletions=fixtures.plain([]);
  const invocations=[],contexts=new Set(),ops=new Set();
  const groups=[{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:1,guests:2}];
  const target=await fixtures.issue(db,groups);target.T[5].forEach(g=>ops.add(g[0]));
  function inspect(s,r){
   assert.ok(['ACQUISITION_PENDING','GROUP_SETTLEMENT_VERIFIED'].includes(r.status),r.status);
   assert.equal(contexts.has(s.context),false);contexts.add(s.context);
   assert.ok(s.trace.filter(t=>t.op==='insert').length<=1);
   assert.equal(s.trace.some(t=>!['find','insert'].includes(t.op)),false,'no providers, secrets or mutable SDK calls');
   for(const c of ['Bookings','BookingSummary','GuestBookingCompletions'])assert.equal(db.rows[c].length,0);
   for(const t of s.trace.filter(t=>t.op==='insert')){
    assert.ok(['GuestBookingAcquisitionControls','RoomBookingClaimEvents'].includes(t.c));
    equal(t.o,s.realm({suppressAuth:true,suppressHooks:true}));
    if(t.row._id==='ra2-direction-'+target.A)assert.equal(t.row.direction,'compensate');
    if(ops.has(t.row.operationId)&&t.row.claimType==='operation-decision')assert.equal(t.row.decisionState,'compensate');
    equal(db.rows[t.c].find(row=>row._id===t.row._id),t.row);
    const reads=s.trace.slice(s.trace.indexOf(t)+1);
    assert.equal(reads.length,1);assert.equal(reads[0].op,'find');assert.equal(reads[0].c,t.c);
    equal(reads[0].f,fixtures.plain(['_id',t.row._id]));
    equal(reads[0].o,s.realm({suppressAuth:true,suppressHooks:true,consistentRead:true}));
   }
   invocations.push({result:fixtures.plain(r),trace:fixtures.plain(s.trace)});
  }
  async function step(A){const s=fixtures.subject(db),r=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);inspect(s,r);return r;}
  // Retain a native capacity-only prefix; the overlapping unit is still available
  // when the foreign issuer/handoff plans it. No seeded controls/claims/authority.
  const prefix=target.T[6][0].acquisitions[2];assert.equal(prefix.claimType,'capacity');
  for(let n=0;n<40&&!db.rows.RoomBookingClaimEvents.some(r=>r._id===prefix._id);n++)await step(target.A);
  equal(db.rows.RoomBookingClaimEvents.find(r=>r._id===prefix._id),prefix);
  const foreign=await fixtures.issue(db,[groups[0]]);assert.notEqual(foreign.A,target.A);
  const overlap=foreign.T[6][0].acquisitions.slice(1).find(r=>target.T[6][0].acquisitions.slice(1).some(t=>t._id===r._id)&&!db.rows.RoomBookingClaimEvents.some(t=>t._id===r._id));assert.ok(overlap);
  const intended=target.T[6][0].acquisitions.find(r=>r._id===overlap._id);
  assert.equal(overlap.generation,intended.generation);assert.equal(overlap.claimKey,intended.claimKey);assert.notEqual(overlap.operationId,intended.operationId);
  const foreignLast=foreign.T[6][0].acquisitions.at(-1);
  for(let n=0;n<80&&!db.rows.RoomBookingClaimEvents.some(r=>r._id===foreignLast._id);n++)await step(foreign.A);
  equal(db.rows.RoomBookingClaimEvents.find(r=>r._id===overlap._id),overlap);
  const foreignIdentity=foreign.T[6][0].acquisitions[0];equal(db.rows.RoomBookingClaimEvents.find(r=>r._id===foreignIdentity._id),foreignIdentity);
  let enter,release,timer,old,oldApi,run,proposal,collection,hit=false;
  const entered=new Promise(r=>enter=r),hold=new Promise(r=>release=r);
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('B09.5 compensation native barrier deadline')),15000);});
  const matches=row=>type==='compensate-direction'?row._id==='ra2-direction-'+target.A&&row.direction==='compensate':ops.has(row.operationId)&&(type==='compensate-Q'?row.claimType==='operation-decision'&&row.decisionState==='compensate':row.eventType==='release');
  try{
   for(let n=0;n<120&&!hit;n++){
    old=fixtures.subject(db,{before:async(c,row)=>{if(matches(row)){collection=c;proposal=fixtures.plain(row);hit=true;enter();await hold;}}});oldApi=old.load('backend/guestBookingPhysicalAcquisition');
    run=oldApi.resumeGuestBookingPhysicalAcquisition(target.A);
    const outcome=await Promise.race([entered.then(()=>null),run,deadline]);if(!hit){assert.ok(outcome);inspect(old,outcome);assert.equal(outcome.status,'ACQUISITION_PENDING');}
   }
   assert.equal(hit,true,type);assert.equal(db.rows[collection].some(r=>r._id===proposal._id),false);
   equal(db.rows.RoomBookingClaimEvents.find(r=>r._id===overlap._id),overlap);
   const causeReader=fixtures.subject(db),cause=await Promise.race([causeReader.load('backend/guestBookingAcquisitionContentionEvidence').readGuestBookingAcquisitionContentionEvidence(target.A),deadline]);
   assert.equal(cause.status,'EVIDENCED');assert.equal(cause.commitReady,false);assert.ok(cause.causes.length>0);
   assert.equal(causeReader.trace.some(t=>t.op!=='find'),false);
   const direction=type==='compensate-direction'?proposal:db.rows.GuestBookingAcquisitionControls.find(r=>r._id==='ra2-direction-'+target.A);
   assert.equal(direction.direction,'compensate');assert.ok(cause.causes.some(c=>c.operationId===direction.causeOperationId&&c.index===direction.causeIndex&&c.resourceClaimId===direction.causeResourceClaimId));
   assert.equal(direction.causeResourceClaimId,overlap._id);
   if(type==='release'){
    assert.ok(db.rows.RoomBookingClaimEvents.some(r=>r.operationId===proposal.operationId&&r.claimType==='operation-decision'&&r.decisionState==='compensate'));
    const acquisition={...proposal,_id:proposal._id.slice(0,-1)+'a',eventType:'acquire'};delete acquisition.releaseReason;
    equal(db.rows.RoomBookingClaimEvents.find(r=>r._id===acquisition._id),fixtures.plain(acquisition));
   }
   let settledResult;
   for(let n=0;n<160;n++){
    const s=fixtures.subject(db),api=s.load('backend/guestBookingPhysicalAcquisition');assert.notEqual(api,oldApi);assert.notEqual(s.context,old.context);
    settledResult=await Promise.race([api.resumeGuestBookingPhysicalAcquisition(target.A),deadline]);inspect(s,settledResult);
    equal(db.rows.RoomBookingClaimEvents.find(r=>r._id===overlap._id),overlap);
    if(settledResult.status==='GROUP_SETTLEMENT_VERIFIED')break;
   }
   assert.equal(settledResult.status,'GROUP_SETTLEMENT_VERIFIED');
   const settled=fixtures.plain(db.rows),owned=settled.RoomBookingClaimEvents.filter(r=>ops.has(r.operationId));
   const acquired=owned.filter(r=>r.eventType==='acquire'&&['capacity','unit'].includes(r.claimType)),released=owned.filter(r=>r.eventType==='release');
   assert.ok(released.length>1,'nonempty reverse-release suffix');assert.equal(released.length,acquired.length);
   for(const r of acquired)assert.ok(released.some(v=>v._id===r._id.slice(0,-1)+'r'));
   for(const g of settledResult.groups){const count=acquired.filter(r=>r.operationId===g.operationId).length;if(g.status==='SKIPPED')assert.equal(count,0);else assert.equal(g.confirmedResourceCount,count);}
   equal(db.rows[collection].find(r=>r._id===proposal._id),proposal);
   release();const staleResult=await Promise.race([run,deadline]);assert.equal(staleResult.status,'ACQUISITION_PENDING');inspect(old,staleResult);
   assert.equal(old.trace.filter(t=>t.op==='insert').length,1);equal(old.trace.find(t=>t.op==='insert').row,proposal);
   assert.equal(db.rows[collection].filter(r=>r._id===proposal._id).length,1);equal(db.rows,settled,'duplicate native insertion cannot alter settlement');
   const retry=fixtures.subject(db),retryApi=retry.load('backend/guestBookingPhysicalAcquisition');assert.notEqual(retryApi,oldApi);
   const replay=await Promise.race([retryApi.resumeGuestBookingPhysicalAcquisition(target.A),deadline]);inspect(retry,replay);
   equal(fixtures.plain(replay),fixtures.plain(settledResult));assert.equal(retry.trace.some(t=>t.op!=='find'),false);equal(db.rows,settled);
   const id='B09.5/'+type+'-permanent-negative-authority';marks.push(id);evidence.push({id,proposal,direction:fixtures.plain(direction),cause:fixtures.plain(cause),causeTrace:fixtures.plain(causeReader.trace),foreignIdentity,foreignOwner:overlap,invocations});
  }finally{release();if(run)await Promise.race([Promise.allSettled([run]),deadline]).finally(()=>clearTimeout(timer));else clearTimeout(timer);}
 }
 assert.equal(marks.length,3);assert.equal(new Set(marks).size,3);return {marks,evidence};
}
// INVALID retained-history denial is separate from native stale compensation.
// Discriminator remains INTEGRITY or UNKNOWN until admitted execution freezes it.
async function terminalMixedHistoryRejectionCases(fixtures,end,A,prefixes){
 const equal=(a,b,message)=>assert.deepEqual(a,b,message);
 const marks=[],evidence=[];
 for(const stage of ['committed-before-first-row','first-row','summary']){
  const rows=prefixes.find(p=>p.GuestBookingAcquisitionControls.some(r=>r._id==='ra2-direction-'+A&&r.direction==='commit-rows')&&p.RoomBookingClaimEvents.filter(r=>r.claimType==='operation-decision').length===end.RoomBookingClaimEvents.filter(r=>r.claimType==='operation-decision').length&&(stage==='committed-before-first-row'?p.Bookings.length===0:stage==='first-row'?p.Bookings.length===1:p.BookingSummary.length===1));assert.ok(rows,stage);assert.equal(rows.GuestBookingCompletions.length,0);
  for(const mode of ['positive','wrong-direction','wrong-Q','appended-release']){
   const db=fixtures.database();db.rows=fixtures.plain(rows);const original=fixtures.plain(db.rows);
   const d=db.rows.GuestBookingAcquisitionControls.find(r=>r._id==='ra2-direction-'+A),q=db.rows.RoomBookingClaimEvents.find(r=>r.claimType==='operation-decision'),acquired=db.rows.RoomBookingClaimEvents.find(r=>r.eventType==='acquire'&&['capacity','unit'].includes(r.claimType));assert.ok(d&&q&&acquired);
   if(mode==='wrong-direction'){d.direction='compensate';d.causeOperationId=acquired.operationId;const anchor=JSON.parse(db.rows.GuestBookingAllocationManifests[0].manifestCanonical),resources=anchor[6].find(p=>p.acquisitions[0].operationId===acquired.operationId).acquisitions.slice(1);d.causeIndex=resources.findIndex(r=>r._id===acquired._id);assert.ok(d.causeIndex>=0);d.causeResourceClaimId=acquired._id;}
   if(mode==='wrong-Q')q.decisionState='compensate';
   if(mode==='appended-release')db.rows.RoomBookingClaimEvents.push(fixtures.plain({...acquired,_id:acquired._id.slice(0,-1)+'r',eventType:'release',releaseReason:'accepted-acquisition-contention'}));
   const before=fixtures.plain(db.rows),s=fixtures.subject(db),r=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A),inserts=s.trace.filter(t=>t.op==='insert');
   assert.equal(s.trace.some(t=>!['find','insert'].includes(t.op)),false);
   if(mode==='positive'){
    const c=rows.Bookings.length<end.Bookings.length?'Bookings':rows.BookingSummary.length<end.BookingSummary.length?'BookingSummary':'GuestBookingCompletions',next=end[c].find(row=>!rows[c].some(v=>v._id===row._id));assert.ok(next);
    assert.equal(r.status,c==='GuestBookingCompletions'?'CONFIRMED':'COMPLETION_PENDING');assert.equal(inserts.length,1);assert.equal(inserts[0].c,c);equal(inserts[0].row,next);
    const expected=fixtures.plain(original);expected[c].push(fixtures.plain(next));equal(db.rows,expected);
   }else{assert.ok(['INTEGRITY','UNKNOWN'].includes(r.status));assert.equal(inserts.length,0);equal(db.rows,before);assert.equal(db.rows.GuestBookingCompletions.length,0);}
   const id='B09.5/'+(mode==='positive'?'valid-commit-control':'INVALID-mixed-history')+'/'+stage+'/'+mode;marks.push(id);evidence.push({id,original,invalid:mode!=='positive'?before:null,result:fixtures.plain(r),trace:fixtures.plain(s.trace)});
  }
 }
 assert.equal(marks.length,12);assert.equal(new Set(marks).size,12);return {marks,evidence};
}
// Suffix correction ordinary cases, authored BEFORE candidate source changes.
// NOTRUN: exact-byte dependency/command/deadline admission is still required.
const connectedSuffixIds=['SB1/two-fresh-passes-native-accounting','SB2/pass-model-detached-zero-IO','SB3/failed-pass-poisoning','SB4/missing-Q-native-routing'];
async function connectedSuffixCases(fixtures,end,A){
 const marks=[],db=fixtures.database();db.rows=fixtures.plain(end);
 const s=fixtures.subject(db),session=s.load('backend/guestBookingPhysicalAcquisitionEvidence').createGuestBookingPhysicalAcquisitionSession();
 const cost=rows=>Buffer.byteLength(JSON.stringify(rows),'utf8');
 let priorModel,passFinds,passBytes;
 for(let pass=0;pass<2;pass++){
  const at=s.trace.length,before=session.costSnapshot();
  assert.equal((await session.read(A)).status,'CART_COMMIT_MATERIALIZED_PENDING_PROJECTION');
  const trace=s.trace.slice(at);assert.ok(trace.length>0);assert.ok(trace.every(t=>t.op==='find'));
  let expected=0;
  for(const t of trace){let rows=db.rows[t.c].slice().sort((a,b)=>a._id<b._id?-1:1);if(t.f)rows=rows.filter(r=>t.f[2]?r[t.f[0]]>t.f[1]:r[t.f[0]]===t.f[1]);rows=rows.slice(0,t.f&&!t.f[2]?2:100);expected+=cost(rows)+(t.c==='GuestBookingAllocationManifests'&&rows.length?4096:0);}
  const after=session.costSnapshot();assert.equal(after.spentFinds-before.spentFinds,trace.length);assert.equal(after.spentBytes-before.spentBytes,expected);
  // Each fresh pass natively admits its own tuple ONCE; reuse removes real IO.
  assert.equal(trace.filter(t=>t.c==='GuestBookingAcceptances').length,1);
  assert.equal(trace.filter(t=>t.c==='GuestBookingAllocationManifests').length,1);
  assert.equal(trace.filter(t=>t.c==='GuestBookingAcquisitionControls'&&t.f?.[1]==='ra2-cart-'+A).length,1);
  assert.equal(after.categories.physical.pages-before.categories.physical.pages,trace.length);
  assert.equal(trace.filter(t=>t.c==='RoomBookingClaimEvents'&&!t.f).length,1);
  if(pass){assert.equal(trace.length,passFinds);assert.equal(expected,passBytes);}passFinds=trace.length;passBytes=expected;
  const modelAt=s.trace.length,model=await session.readCompletionModel(A);
  assert.equal(s.trace.length,modelAt,'validated current-pass model must not issue native IO');
  assert.equal(model.accepted.root._id,A);assert.notEqual(model,priorModel);
  model.record.manifestDigest='caller mutation';
  assert.notEqual((await session.readCompletionModel(A)).record.manifestDigest,'caller mutation');priorModel=model;
 }
 marks.push(connectedSuffixIds[0],connectedSuffixIds[1]);
 const bad=fixtures.subject(db,{read:async(c)=>{if(c==='RoomBookingClaimEvents')throw Error('ordinary failed pass');}}),failed=bad.load('backend/guestBookingPhysicalAcquisitionEvidence').createGuestBookingPhysicalAcquisitionSession();
 assert.equal((await failed.read(A)).status,'UNKNOWN');const stoppedAt=bad.trace.length;
 await assert.rejects(()=>failed.readCompletionModel(A));assert.equal((await failed.read(A)).status,'UNKNOWN');assert.equal(bad.trace.length,stoppedAt);marks.push(connectedSuffixIds[2]);
 const incomplete=fixtures.database();incomplete.rows=fixtures.plain(end);const q=incomplete.rows.RoomBookingClaimEvents.find(r=>r.claimType==='operation-decision');assert.ok(q);
 incomplete.rows.RoomBookingClaimEvents=incomplete.rows.RoomBookingClaimEvents.filter(r=>r._id!==q._id);
 const native=fixtures.subject(incomplete),p=native.load('backend/guestBookingPhysicalAcquisitionEvidence').createGuestBookingPhysicalAcquisitionSession(),r=await p.read(A);
 assert.equal(r.status,'CANDIDATE');assert.equal(r.candidate._id,q._id);assert.equal(native.trace.some(t=>t.op==='insert'),false);marks.push(connectedSuffixIds[3]);
 assert.deepEqual(marks,connectedSuffixIds);return marks;
}
// Tuple amendment cases authored tests-first; backend execution remains NOTRUN.
// Direct private-protocol tests are not native admission provenance evidence.
async function samePassTupleCases(fixtures,end,A){
 const marks=[];
 for(const mode of ['unchanged','root','manifest','anchor','descriptor']){
  const db=fixtures.database();db.rows=fixtures.plain(end);let args,changed=false;
  const s=fixtures.subject(db,{read:async(c)=>{
   if(c==='RoomBookingClaimEvents'&&!changed){changed=true;
    if(mode==='root')args[0].root.bookingNumber+='-drift';
    if(mode==='manifest')args[1].manifestDigest='0'.repeat(64);
    if(mode==='anchor')args[2].manifestDigest='0'.repeat(64);
    if(mode==='descriptor')Object.defineProperty(args[1],'manifestDigest',{writable:false});
   }
  }});
  const scope=s.load('backend/guestBookingAcquisitionContentionEvidence').createGuestBookingAcquisitionReadScope();
  args=[s.load('backend/guestBookingAcceptance').validateGuestBookingAcceptanceRoot(s.realm(end.GuestBookingAcceptances[0])),s.realm(end.GuestBookingAllocationManifests[0]),s.realm(end.GuestBookingAcquisitionControls.find(r=>r._id==='ra2-cart-'+A))];
  assert.notEqual(args[0],'DENIED');const token=scope.beginPhysicalPass(A),before=fixtures.plain(db.rows);
  const result=await scope.readPhysicalPass(token,...args);assert.equal(changed,true);
  if(mode==='unchanged'){
   assert.equal(result.status,'EVIDENCED');assert.equal(scope.hasTerminalPass(token),true);scope.finishPhysicalPass(token,true);
   const at=s.trace.length;assert.equal(scope.passModel(token,A).accepted.root._id,A);assert.equal(s.trace.length,at);
   assert.equal(s.trace.some(t=>['GuestBookingAcceptances','GuestBookingAllocationManifests'].includes(t.c)||t.c==='GuestBookingAcquisitionControls'&&t.f?.[1]==='ra2-cart-'+A),false);
  }else{assert.notEqual(result.status,'EVIDENCED');assert.throws(()=>scope.passModel(token,A));}
  assert.equal(s.trace.some(t=>t.op!=='find'),false);assert.deepEqual(fixtures.plain(db.rows),before);marks.push('SB6/original-argument-'+mode);
 }
 // Persistent native change after success cannot be concealed by an old tuple.
 for(const collection of ['GuestBookingAcceptances','GuestBookingAllocationManifests','GuestBookingAcquisitionControls']){
  const db=fixtures.database();db.rows=fixtures.plain(end);const s=fixtures.subject(db),session=s.load('backend/guestBookingPhysicalAcquisitionEvidence').createGuestBookingPhysicalAcquisitionSession();
  assert.equal((await session.read(A)).status,'CART_COMMIT_MATERIALIZED_PENDING_PROJECTION');
  const id=collection==='GuestBookingAcquisitionControls'?'ra2-cart-'+A:db.rows[collection][0]._id;
  db.rows[collection]=db.rows[collection].filter(r=>r._id!==id);const at=s.trace.length;
  assert.notEqual((await session.read(A)).status,'CART_COMMIT_MATERIALIZED_PENDING_PROJECTION');
  assert.ok(s.trace.slice(at).some(t=>t.c===collection&&t.op==='find'));await assert.rejects(()=>session.readCompletionModel(A));
  assert.equal(s.trace.some(t=>t.op!=='find'),false);marks.push('SB6/fresh-pass-missing-'+collection);
 }
 // Baseline controls extended without weakening the original first-failure case.
 {
  const db=fixtures.database();db.rows=fixtures.plain(end);let failSecond=false;
  const s=fixtures.subject(db,{read:async(c)=>{if(failSecond&&c==='RoomBookingClaimEvents')throw Error('second pass failed');}}),session=s.load('backend/guestBookingPhysicalAcquisitionEvidence').createGuestBookingPhysicalAcquisitionSession();
  assert.equal((await session.read(A)).status,'CART_COMMIT_MATERIALIZED_PENDING_PROJECTION');failSecond=true;
  assert.equal((await session.read(A)).status,'UNKNOWN');const at=s.trace.length;
  await assert.rejects(()=>session.readCompletionModel(A));assert.equal((await session.read(A)).status,'UNKNOWN');assert.equal(s.trace.length,at);marks.push('SB6/first-success-second-failure');
 }
 for(const mode of ['stale-token','cross-scope','wrong-A','unqueried-key','reentry']){
  const db=fixtures.database();db.rows=fixtures.plain(end);const s=fixtures.subject(db),api=s.load('backend/guestBookingAcquisitionContentionEvidence'),scope=api.createGuestBookingAcquisitionReadScope(),token=scope.beginPhysicalPass(A);
  const args=[s.load('backend/guestBookingAcceptance').validateGuestBookingAcceptanceRoot(s.realm(end.GuestBookingAcceptances[0])),s.realm(end.GuestBookingAllocationManifests[0]),s.realm(end.GuestBookingAcquisitionControls.find(r=>r._id==='ra2-cart-'+A))];
  if(mode==='stale-token'){scope.finishPhysicalPass(token,false);scope.beginPhysicalPass(A);await assert.rejects(()=>scope.readPhysicalPass(token,...args));}
  if(mode==='cross-scope')await assert.rejects(()=>api.createGuestBookingAcquisitionReadScope().readPhysicalPass(token,...args));
  if(mode==='reentry')assert.throws(()=>scope.beginPhysicalPass(A));
  if(['stale-token','cross-scope','reentry'].includes(mode))assert.equal(s.trace.length,0);
  else{
   assert.equal((await scope.readPhysicalPass(token,...args)).status,'EVIDENCED');const at=s.trace.length;
   if(mode==='unqueried-key')assert.throws(()=>scope.passLookup(token,'RoomBookingClaimEvents','rc1-unqueried'));
   else{scope.finishPhysicalPass(token,true);assert.throws(()=>scope.passModel(token,A==='0'.repeat(64)?'1'.repeat(64):'0'.repeat(64)));}
   assert.equal(s.trace.length,at);
  }
  assert.equal(s.trace.some(t=>t.op!=='find'),false);marks.push('SB6/'+mode);
 }
 assert.equal(marks.length,14);assert.equal(new Set(marks).size,14);return marks;
}
// Pure transcription oracle ONLY; these are counterfactuals, not spent runtime IO.
function samePassArithmeticCase(){
 const tuple=[4242,23644,19751],saved=2*tuple.reduce((a,b)=>a+b,0);
 assert.equal(saved,95274);assert.equal(135934-saved/2,88297);assert.equal(71-tuple.length,68);
 assert.deepEqual([276449,303649,330864,358085,385264,411200].map(n=>n-saved),[181175,208375,235590,262811,289990,315926]);
 assert.equal(423542-saved,328268);assert.equal(400000-(423542-saved),71732);
 return ['SB6/pure-counterfactual-arithmetic'];
}
// Separate admitted selection; actual issuance precedes recovery, never seeded authority.
async function connectedFourRoomCases(fixtures){
 const db=fixtures.database();db.rows.GuestBookingCompletions=[];
 const groups=[{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'two_bedroom_apartment',quantity:1,guests:3}];
 const {A,T}=await fixtures.issue(db,groups),accepted=fixtures.plain(db.rows.GuestBookingAcceptances[0]);
 assert.ok(Number.isSafeInteger(accepted.offerExpiresAtMs));assert.ok(db.rows.GuestBookingAllocationManifests[0].manifestCanonical.includes('2027-01-03'));
 const calculation=JSON.parse(accepted.capsule).calculation;
 db.rows.GuestBookingFinancialRevisions=[];let last,seenPending=false;
 for(let n=0;n<240;n++){
  const s=fixtures.subject(db);s.context.clock=()=>accepted.offerExpiresAtMs+1;
  last=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);
  assert.ok(s.trace.filter(t=>t.op==='insert').length<=1);assert.equal(s.trace.some(t=>t.op==='secret'||t.c==='GuestBookingFinancialRevisions'),false);
  if(last.status==='COMPLETION_PENDING')seenPending=true;if(last.status==='CONFIRMED')break;
  assert.ok(['ACQUISITION_PENDING','COMPLETION_PENDING'].includes(last.status),last.status);
 }
 assert.equal(last.status,'CONFIRMED');assert.equal(seenPending,true);assert.deepEqual(db.rows.Bookings.map(r=>r._id),T[7]);assert.equal(db.rows.Bookings.length,4);
 const receipt=db.rows.GuestBookingCompletions[0],projection=JSON.parse(receipt.projectionCanonical);
 assert.deepEqual(projection.summary.acceptedCalculation,calculation);assert.equal(calculation.groups.length,4);assert.equal(receipt.recipient,projection.summary.guestEmail);
 assert.equal(projection.plannedBookingRows.find(r=>r._id===T[8]).note,'Café 李');
 const fresh=fixtures.subject(db);fresh.context.clock=()=>accepted.offerExpiresAtMs+1;
 assert.equal((await fresh.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A)).status,'CONFIRMED');assert.equal(fresh.trace.some(t=>t.op==='insert'),false);
 return ['SB5/actual-four-room-mixed-repeated-two-night-expired-recovery'];
}
// SB7 reconstructs pages from declared queries and retained storage, never from
// returned items or measured debits. The fixture has keyset, not offset, paging.
function sb7ExpectedPage(storage,query){
 let rows=storage[query.c].filter(row=>query.predicates.every(p=>p[2]?row[p[0]]>p[1]:row[p[0]]===p[1]));
 if(query.ascending)rows=rows.slice().sort((a,b)=>a._id<b._id?-1:a._id>b._id?1:0);
 return rows.slice(0,query.limit);
}
function sb7ObserveQueries(wix){
 const queries=[],create=wix.query;
 wix.query=function(c){
  const q=create.call(this,c),predicates=[];let limit=100,ascending=false;
  for(const method of ['eq','gt','limit','ascending']){const invoke=q[method];q[method]=function(...args){
   if(method==='eq'||method==='gt')predicates.push(method==='gt'?[args[0],args[1],true]:[args[0],args[1]]);
   else if(method==='limit')limit=args[0];else {assert.equal(args[0],'_id');ascending=true;}
   return invoke.apply(this,args);
  };}
  const find=q.find;q.find=function(...args){queries.push({c,predicates:predicates.map(p=>p.slice()),limit,ascending});return find.apply(this,args);};return q;
 };return queries;
}
// AUTHORED NOTRUN: observers delegate unchanged calls/results; no source overlay,
// lowered limits, seeded budget, descriptor probes, or fabricated positive rows.
async function heldPrefixAccountingCases(fixtures,end,A,prefixes){
 const equal=(a,b,m)=>assert.deepEqual(a,b,m);
 const cost=x=>Buffer.byteLength(JSON.stringify(x),'utf8'),marks=[],evidence=[];
 const targets=end.Bookings.map(row=>({c:'Bookings',row})).concat(end.BookingSummary.map(row=>({c:'BookingSummary',row})),end.GuestBookingCompletions.map(row=>({c:'GuestBookingCompletions',row})));
 const legal=targets.map(t=>{const p=prefixes.find((v,i)=>!v[t.c].some(r=>r._id===t.row._id)&&(prefixes[i+1]||end)[t.c].some(r=>r._id===t.row._id));assert.ok(p,t.row._id);return p;}).concat([end]);
 for(let prefix=0;prefix<legal.length;prefix++){
  const db=fixtures.database();db.rows=fixtures.plain(legal[prefix]);const initial=fixtures.plain(db.rows),s=fixtures.subject(db),passes=[],models=[],holds=[];
  const queries=sb7ObserveQueries(s.wix);
  // Observe the actual coordinator-created session, not a replacement coordinator.
  const api=s.load('backend/guestBookingPhysicalAcquisitionEvidence'),create=api.createGuestBookingPhysicalAcquisitionSession;let session,first,settled;
  api.createGuestBookingPhysicalAcquisitionSession=()=>{
   session=create();const read=session.read,model=session.readCompletionModel,verify=session.verifyCompletion;
   session.read=async function(...args){const at=s.trace.length,before=session.costSnapshot(),r=await read.apply(session,args),after=session.costSnapshot();passes.push({at,end:s.trace.length,before,after,status:r.status});return r;};
   session.readCompletionModel=async function(...args){const at=s.trace.length,r=await model.apply(session,args);assert.equal(s.trace.length,at);models.push(r);return r;};
   session.verifyCompletion=async function(state,present,receipt,invoke){
    first=session.costSnapshot();assert.equal(present.length,Math.min(prefix,targets.length-1));
    const r=await verify.call(session,state,present,receipt,async()=>{holds.push(session.costSnapshot());return await invoke();});settled=session.costSnapshot();return r;
   };return session;
  };
  const r=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A),last=session.costSnapshot();
  assert.equal(r.status,prefix>=targets.length-1?'CONFIRMED':'COMPLETION_PENDING');assert.equal(passes.length,2);assert.equal(models.length,2);assert.notEqual(models[0],models[1]);assert.equal(holds.length,1);
  const oracle=Object.create(null);for(const name of Object.keys(last.categories))oracle[name]=Object.assign(Object.create(null),{spentFinds:0,spentBytes:0,pages:0});
  let inserted=false,queryIndex=0;
  for(let i=0;i<s.trace.length;i++){
   const t=s.trace[i];if(t.op==='insert'){inserted=true;continue;}assert.equal(t.op,'find');
   const query=queries[queryIndex++];assert.equal(query.c,t.c);equal(t.f,fixtures.plain(query.predicates.at(-1)||null));
   const field=query.predicates.find(p=>!p[2])?.[0];
   let name=passes.some(p=>i>=p.at&&i<p.end)?'physical':inserted?'selected-readback':t.c==='GuestBookingCompletions'?(field==='acceptanceId'?'early-binding':i===0?'early-receipt':'final-receipt'):field==='_id'?'target-exact':t.c==='BookingSummary'?'summary-identity':field==='operationId'?'class-identity':'booking-identity';
   // Preserve all equality/cursor predicates and the caller's actual page limit.
   const rows=sb7ExpectedPage(inserted?db.rows:initial,query);
   const bucket=oracle[name];bucket.spentFinds++;bucket.pages++;bucket.spentBytes+=cost(rows)+(t.c==='GuestBookingAllocationManifests'&&rows.length?4096:0);
  }
  assert.equal(queryIndex,queries.length);
  for(const bucket of Object.values(oracle))Object.freeze(bucket);Object.freeze(oracle);
  equal(last.categories,oracle,'all native category debits at prefix '+prefix);
  assert.equal(last.spentFinds,Object.values(oracle).reduce((n,b)=>n+b.spentFinds,0));assert.equal(last.spentBytes,Object.values(oracle).reduce((n,b)=>n+b.spentBytes,0));
  for(const p of passes){assert.equal(p.status,'CART_COMMIT_MATERIALIZED_PENDING_PROJECTION');const trace=s.trace.slice(p.at,p.end);assert.equal(trace.filter(t=>t.c==='GuestBookingAcceptances').length,1);assert.equal(trace.filter(t=>t.c==='GuestBookingAllocationManifests').length,1);assert.equal(trace.filter(t=>t.c==='GuestBookingAcquisitionControls'&&t.f?.[1]==='ra2-cart-'+A).length,1);assert.equal(p.after.spentFinds-p.before.spentFinds,trace.length);}
  equal(s.trace.slice(passes[0].at,passes[0].end),s.trace.slice(passes[1].at,passes[1].end),'fresh native physical pass requests');
  const phase=['physical','model-root','model-manifest','target-exact','booking-identity','class-identity','summary-identity'];
  const reloadFinds=phase.reduce((n,k)=>n+first.categories[k].spentFinds,1),reloadBytes=phase.reduce((n,k)=>n+first.categories[k].spentBytes,first.categories['early-receipt'].spentBytes);
  // Independent future-page oracle: rebuild exact and identity page envelopes,
  // including each repeated class query's brackets and commas. Future metadata
  // is a prospective bound only; it is never persisted or charged as actual IO.
  const terminalTargets=targets.slice(0,-1),futureBounds=[];
  for(let p=Math.min(prefix,terminalTargets.length);p<=terminalTargets.length;p++){
   const present=terminalTargets.slice(0,p),page=rows=>2+rows.reduce((n,t)=>n+cost(t.row)+(terminalTargets.indexOf(t)>=prefix?4096:0),0)+Math.max(0,rows.length-1);
   let targetBytes=terminalTargets.reduce((n,t,i)=>n+(i<p?page([t]):2),0);
   targetBytes+=page(present.filter(t=>t.c==='Bookings'))+page(present.filter(t=>t.c==='BookingSummary'));
   for(const O of new Set(end.Bookings.map(row=>row.operationId)))targetBytes+=page(present.filter(t=>t.c==='Bookings'&&t.row.operationId===O));
   const fixed=2*first.categories.physical.spentBytes,finds=2*first.categories.physical.spentFinds+2*(terminalTargets.length+new Set(end.Bookings.map(row=>row.operationId)).size+2);
   if(prefix<targets.length){const selected=targets[p],writeBytes=fixed+2*targetBytes+first.categories['early-receipt'].spentBytes+first.categories['early-binding'].spentBytes+2+cost([selected.row])+4096;assert.ok(writeBytes<=400000);assert.ok(finds+4<=30000);futureBounds.push({p,kind:'write',bytes:writeBytes,finds:finds+4});}
   if(p===terminalTargets.length){const receiptBytes=prefix===targets.length?first.categories['early-receipt'].spentBytes:cost([targets.at(-1).row])+4096,bytes=fixed+2*targetBytes+2*receiptBytes;assert.ok(bytes<=400000);assert.ok(finds+2<=30000);futureBounds.push({p,kind:'receipt-present',bytes,finds:finds+2});}
  }
  const selected=targets[prefix],readback=selected?cost([selected.row])+4096:0;
  assert.equal(holds[0].spentBytes,first.spentBytes);assert.equal(holds[0].spentFinds,first.spentFinds);
  assert.equal(holds[0].heldFinds,reloadFinds+(selected?1:0));assert.equal(holds[0].heldBytes,reloadBytes+readback);assert.equal(holds[0].heldMutations,selected?1:0);
  assert.equal(settled.spentFinds-first.spentFinds,reloadFinds);assert.equal(settled.spentBytes-first.spentBytes,reloadBytes);assert.equal(settled.heldFinds,selected?1:0);assert.equal(settled.heldBytes,readback);assert.equal(settled.spentMutations,0);
  assert.equal(last.heldFinds,0);assert.equal(last.heldBytes,0);assert.equal(last.heldMutations,0);assert.equal(last.spentMutations,selected?1:0);assert.ok(last.spentBytes<=400000);assert.ok(last.spentFinds<=30000);
  const inserts=s.trace.filter(t=>t.op==='insert');assert.equal(inserts.length,selected?1:0);const expected=fixtures.plain(initial);
  if(selected){equal(inserts[0].row,selected.row);assert.equal(inserts[0].c,selected.c);expected[selected.c].push(fixtures.plain(selected.row));const readback=s.trace.slice(s.trace.indexOf(inserts[0])+1);assert.equal(readback.length,1);assert.equal(readback[0].op,'find');assert.equal(readback[0].c,selected.c);equal(readback[0].f,fixtures.plain(['_id',selected.row._id]));}
  equal(db.rows,expected,'whole-storage selected-only delta');const id='SB7/held-every-prefix/'+prefix;marks.push(id);evidence.push({id,first,held:holds[0],settled,last,futureBounds,trace:fixtures.plain(s.trace)});
 }
 assert.equal(marks.length,targets.length+1);assert.equal(new Set(marks).size,marks.length);return {marks,evidence};
}
// Native foreign insertion changes a measured reload, NOT a claim that the
// static 400000-byte last-supported boundary has been discovered.
async function nativeForeignGrowthCases(fixtures,end,A,prefixes){
 const equal=(a,b,m)=>assert.deepEqual(a,b,m),marks=[],evidence=[];
 for(const stage of ['first-target','receipt']){
  const c=stage==='first-target'?'Bookings':'GuestBookingCompletions',target=end[c][0];
  const p=prefixes.find((v,i)=>!v[c].some(r=>r._id===target._id)&&(prefixes[i+1]||end)[c].some(r=>r._id===target._id));assert.ok(p);
  const base=fixtures.database();base.rows=fixtures.plain(p);
  const foreign=await fixtures.issue(base,[{roomCode:'two_bedroom_apartment',quantity:1,guests:3}]);assert.notEqual(foreign.A,A);
  const O=foreign.T[5][0][0],identity=foreign.T[6][0].acquisitions[0],setupTrace=[];
  for(let n=0;n<12&&!base.rows.GuestBookingAcquisitionControls.some(r=>r._id==='ra2-root-'+O);n++){
   const worker=fixtures.subject(base),r=await worker.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(foreign.A);assert.equal(r.status,'ACQUISITION_PENDING');assert.equal(worker.trace.filter(t=>t.op==='insert').length,1);setupTrace.push(...fixtures.plain(worker.trace));
  }
  assert.ok(base.rows.GuestBookingAcquisitionControls.some(r=>r._id==='ra2-root-'+O));assert.equal(base.rows.RoomBookingClaimEvents.some(r=>r._id===identity._id),false);
  for(const growth of [false,true]){
   const db=fixtures.database();db.rows=fixtures.plain(base.rows);let identities=0,boundary=false,retained,foreignTrace=[];
   const s=fixtures.subject(db,{read:async(collection,f)=>{
    if(collection==='Bookings'&&f?.[0]==='bookingNumber')identities++;
    if(identities===1&&collection==='GuestBookingAcceptances'&&!boundary){boundary=true;
     if(growth){const before=fixtures.plain(db.rows),w=fixtures.subject(db),r=await w.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(foreign.A);assert.equal(r.status,'ACQUISITION_PENDING');const ins=w.trace.filter(t=>t.op==='insert');assert.equal(ins.length,1);assert.equal(ins[0].c,'RoomBookingClaimEvents');equal(ins[0].row,identity);before.RoomBookingClaimEvents.push(fixtures.plain(identity));equal(db.rows,before);foreignTrace=fixtures.plain(w.trace);}
     retained=fixtures.plain(db.rows);
    }
   }});
   const r=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);assert.equal(boundary,true);const inserts=s.trace.filter(t=>t.op==='insert');
   if(growth){
    assert.equal(r.status,'UNKNOWN');assert.equal(inserts.length,0);equal(db.rows,retained,'target worker changes no collection after native foreign growth');assert.equal(s.trace.some(t=>t.op!=='find'),false);
    // A fresh module measures the new valid ledger; it must not inherit the old
    // failed hold or turn the foreign identity into terminal authority.
    const retry=fixtures.subject(db),rr=await retry.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);assert.notEqual(retry.context,s.context);assert.equal(rr.status,stage==='receipt'?'CONFIRMED':'COMPLETION_PENDING');const ri=retry.trace.filter(t=>t.op==='insert');assert.equal(ri.length,1);assert.equal(ri[0].c,c);equal(ri[0].row,target);const expected=fixtures.plain(retained);expected[c].push(fixtures.plain(target));equal(db.rows,expected);const readback=retry.trace.slice(retry.trace.indexOf(ri[0])+1);assert.equal(readback.length,1);assert.equal(readback[0].op,'find');assert.equal(readback[0].c,c);equal(readback[0].f,fixtures.plain(['_id',target._id]));
   }
   else{assert.equal(r.status,stage==='receipt'?'CONFIRMED':'COMPLETION_PENDING');assert.equal(inserts.length,1);assert.equal(inserts[0].c,c);equal(inserts[0].row,target);retained[c].push(fixtures.plain(target));equal(db.rows,retained);const readback=s.trace.slice(s.trace.indexOf(inserts[0])+1);assert.equal(readback.length,1);assert.equal(readback[0].op,'find');assert.equal(readback[0].c,c);equal(readback[0].f,fixtures.plain(['_id',target._id]));}
   const id='SB8/native-foreign-'+stage+'/'+(growth?'growth-denial':'supported-neighbor');marks.push(id);evidence.push({id,setupTrace,foreignTrace,result:fixtures.plain(r),trace:fixtures.plain(s.trace)});
  }
 }
 assert.equal(marks.length,4);assert.equal(new Set(marks).size,4);return {marks,evidence};
}
// SB9 / suffix contract F and four-room contract unsupported-neighbor criterion.
// AUTHORED NOTRUN: independent exact-case admission required. Historical native
// B02.3 payloads are provenance ONLY, not that older union-boundary verdict.
const productionSuffixBoundaryIds=['SB9/native-prefix/supported-first-target','SB9/native-prefix/native-crossing','SB9/native-prefix/unsupported','SB9/native-prefix/unsupported-fresh-retry'];
function productionSuffixRetainedNeighbors(fixtures,prefix){
 const crypto=require('node:crypto'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
 const raw=fs.readFileSync(path.join(__dirname,'fixtures/guest-booking-terminal-arbitration-b023-retained.json'));
 assert.equal(sha(raw),'58e0bde4a20aa17435ab44443609bacea784b54a92127a63c5869d77c58730cd');
 const f=JSON.parse(raw),rows=fixtures.plain(prefix),bindings=[];
 const crossingIndex=3019,crossingId='rc1-20270220-u3-000001-a';let crossing,foreignA;
 // Each complete earlier native history precedes the seventh history's exact
 // native prefix. Sort by original insert trace index, NOT by record ID/shape.
 for(let n=1;n<=7;n++){
  const artifact='b023-recovery-foreign-'+n+'.json';
  const ordered=f.provenance.bindings.filter(b=>b.artifact===artifact).sort((a,b)=>a.traceIndex-b.traceIndex);
  assert.ok(ordered.length>0);assert.equal(new Set(ordered.map(b=>b.traceIndex)).size,ordered.length);
  const payload=b=>{
   const matches=f.supported[b.collection].filter(r=>r._id===b.id);assert.equal(matches.length,1);
   assert.equal(sha(JSON.stringify(matches[0])),b.payloadSha256);return matches[0];
  };
  const admission=payload(ordered[0]);assert.equal(admission.kind,'admission');
  for(const [c,id] of [['GuestBookingAcceptances',admission.acceptanceId],['GuestBookingAllocationManifests',admission.manifestId]]){
   const b=f.provenance.bindings.find(v=>v.collection===c&&v.id===id);assert.ok(b);
   assert.match(b.artifact,new RegExp('^b023-recovery-(issued|manifest)-'+admission.acceptanceId+'\\.json$'));
   assert.equal(rows[c].some(r=>r._id===id),false);rows[c].push(fixtures.plain(payload(b)));bindings.push(b);
  }
  for(const b of ordered){
   if(n===7&&b.traceIndex>crossingIndex)break;
   const row=payload(b);assert.equal(rows[b.collection].some(r=>r._id===row._id),false);
   if(n===7&&b.traceIndex===crossingIndex){assert.equal(b.collection,'RoomBookingClaimEvents');assert.equal(row._id,crossingId);crossing={collection:b.collection,row:fixtures.plain(row),binding:b};foreignA=admission.acceptanceId;break;}
   rows[b.collection].push(fixtures.plain(row));bindings.push(b);
  }
 }
 assert.ok(crossing&&foreignA);const supported=fixtures.plain(rows),unsupported=fixtures.plain(rows);
 unsupported[crossing.collection].push(fixtures.plain(crossing.row));
 assert.equal(supported.RoomBookingClaimEvents.length-prefix.RoomBookingClaimEvents.length,121);
 assert.equal(unsupported.RoomBookingClaimEvents.length-prefix.RoomBookingClaimEvents.length,122);
 const ownNights=new Set(prefix.RoomBookingClaimEvents.map(r=>r.night).filter(Boolean));
 for(const r of supported.RoomBookingClaimEvents.slice(prefix.RoomBookingClaimEvents.length))assert.equal(ownNights.has(r.night),false,'retained foreign physical dates cannot contend with target');
 return {supported,unsupported,crossing,foreignA,bindings};
}
async function productionSuffixBoundaryCases(fixtures,end,A,prefixes){
 const equal=(a,b,m)=>assert.deepEqual(a,b,m),cost=x=>Buffer.byteLength(JSON.stringify(x),'utf8');
 const target=end.Bookings[0],prefix=prefixes.find((p,i)=>!p.Bookings.some(r=>r._id===target._id)&&(prefixes[i+1]||end).Bookings.some(r=>r._id===target._id));assert.ok(prefix);
 const native=productionSuffixRetainedNeighbors(fixtures,prefix),marks=[],evidence=[];
 const scanBytes=rows=>{const sorted=rows.slice().sort((a,b)=>a._id<b._id?-1:a._id>b._id?1:0);if(!sorted.length)return 2;let total=0;for(let i=0;i<sorted.length;i+=100)total+=cost(sorted.slice(i,i+100));return total;};
 // Data/source derivation: SB7's unchanged first-target P=68067; foreign rows
 // affect only the complete ledger scan, not target exact/identity requests.
 const baseScan=scanBytes(prefix.RoomBookingClaimEvents),basePhysical=68067;
 assert.equal(prefix.RoomBookingClaimEvents.length,18);assert.equal(baseScan,10566);
 const terminalTargets=end.Bookings.map(row=>({c:'Bookings',row})).concat(end.BookingSummary.map(row=>({c:'BookingSummary',row})));
 const future=[];for(let p=0;p<=terminalTargets.length;p++){
  const present=terminalTargets.slice(0,p),page=ts=>2+ts.reduce((n,t)=>n+cost(t.row)+4096,0)+Math.max(0,ts.length-1);
  let bytes=terminalTargets.reduce((n,t,i)=>n+(i<p?page([t]):2),0)+page(present.filter(t=>t.c==='Bookings'))+page(present.filter(t=>t.c==='BookingSummary'));
  for(const O of new Set(end.Bookings.map(r=>r.operationId)))bytes+=page(present.filter(t=>t.c==='Bookings'&&t.row.operationId===O));
  const receipt=cost([end.GuestBookingCompletions[0]])+4096,selected=terminalTargets[p];
  future.push(2*basePhysical+2*bytes+6+(selected?cost([selected.row])+4096:receipt));
  if(p===terminalTargets.length)future.push(2*basePhysical+2*bytes+2*receipt);
 }
 assert.equal(Math.max(...future),258114);
 const bounds=rows=>{const delta=scanBytes(rows.RoomBookingClaimEvents)-baseScan;return {physical:basePhysical+delta,max:Math.max(...future)+2*delta,ledger:cost(rows.RoomBookingClaimEvents)};};
 const supportedBound=bounds(native.supported),unsupportedBound=bounds(native.unsupported);
 equal(supportedBound,{physical:138799,max:399578,ledger:81297});equal(unsupportedBound,{physical:139266,max:400512,ledger:81764});
 // Reachability witness: actual foreign coordinator must propose the exact next
 // historical insert over the combined supported storage, with no other delta.
 {
  const db=fixtures.database();db.rows=fixtures.plain(native.supported);const worker=fixtures.subject(db);
  const r=await worker.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(native.foreignA);
  assert.equal(r.status,'ACQUISITION_PENDING');const ins=worker.trace.filter(t=>t.op==='insert');assert.equal(ins.length,1);
  assert.equal(ins[0].c,native.crossing.collection);equal(ins[0].row,native.crossing.row);equal(db.rows,native.unsupported);
  assert.equal(worker.trace.some(t=>!['find','insert'].includes(t.op)),false);
  const tail=worker.trace.slice(worker.trace.indexOf(ins[0])+1);assert.equal(tail.length,1);assert.equal(tail[0].op,'find');assert.equal(tail[0].c,native.crossing.collection);equal(tail[0].f,fixtures.plain(['_id',native.crossing.row._id]));
  marks.push(productionSuffixBoundaryIds[1]);evidence.push({id:productionSuffixBoundaryIds[1],result:fixtures.plain(r),trace:fixtures.plain(worker.trace),binding:native.crossing.binding});
 }
 const contexts=new Set();
 for(const mode of ['supported','unsupported','unsupported-fresh-retry']){
  const supported=mode==='supported',db=fixtures.database();db.rows=fixtures.plain(supported?native.supported:native.unsupported);const before=fixtures.plain(db.rows),s=fixtures.subject(db),queries=sb7ObserveQueries(s.wix),passes=[];
  assert.equal(contexts.has(s.context),false);contexts.add(s.context);
  const api=s.load('backend/guestBookingPhysicalAcquisitionEvidence'),create=api.createGuestBookingPhysicalAcquisitionSession;let admitted=false;
  api.createGuestBookingPhysicalAcquisitionSession=()=>{const session=create(),read=session.read,verify=session.verifyCompletion;
   session.read=async function(...args){const at=queries.length,r=await read.apply(session,args);passes.push({at,end:queries.length,status:r.status});return r;};
   session.verifyCompletion=async function(...args){
    assert.equal(passes.length,1);assert.equal(passes[0].status,'CART_COMMIT_MATERIALIZED_PENDING_PROJECTION');assert.equal(args[1].length,0);
    // Raw query composition is preserved. Oracle consumes retained storage only.
    const observed=queries.slice(passes[0].at,passes[0].end),bytes=observed.reduce((n,q)=>{const page=sb7ExpectedPage(before,q);return n+cost(page)+(q.c==='GuestBookingAllocationManifests'&&page.length?4096:0);},0);
    assert.equal(bytes,(supported?supportedBound:unsupportedBound).physical);assert.equal(observed.length,52);
    assert.equal(session.costSnapshot().categories.physical.spentBytes,bytes);
    assert.equal(observed.filter(q=>q.c==='RoomBookingClaimEvents'&&(!q.predicates.length||q.predicates.every(p=>p[2]))).length,2);
    admitted=true; // Set only AFTER assertions: coordinator catches callback errors.
    return await verify.apply(session,args);
   };return session;};
  const r=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);assert.equal(admitted,true,'earlier acceptance/manifest/anchor/physical/future-union predicates must succeed');
  assert.equal(s.trace.some(t=>!['find','insert'].includes(t.op)),false);const ins=s.trace.filter(t=>t.op==='insert');
  const expected=fixtures.plain(before);
  if(supported){assert.equal(r.status,'COMPLETION_PENDING');assert.equal(passes.length,2);assert.equal(ins.length,1);assert.equal(ins[0].c,'Bookings');equal(ins[0].row,target);expected.Bookings.push(fixtures.plain(target));const tail=s.trace.slice(s.trace.indexOf(ins[0])+1);assert.equal(tail.length,1);assert.equal(tail[0].op,'find');assert.equal(tail[0].c,'Bookings');equal(tail[0].f,fixtures.plain(['_id',target._id]));}
  else{assert.equal(r.status,'UNKNOWN');assert.equal(passes.length,1);assert.equal(ins.length,0);assert.equal(s.trace.every(t=>t.op==='find'),true);}
  equal(db.rows,expected,'raw fixture-realm whole-storage equality');
  const id=productionSuffixBoundaryIds[supported?0:mode==='unsupported'?2:3];marks.push(id);evidence.push({id,result:fixtures.plain(r),bound:supported?supportedBound:unsupportedBound,queries,trace:fixtures.plain(s.trace)});
 }
 assert.deepEqual([...marks].sort(),[...productionSuffixBoundaryIds].sort());return {marks,evidence,bindings:native.bindings,crossing:native.crossing.binding};
}
// SB7 restart extension: AUTHORED NOTRUN; independent exact-byte admission required.
// This is the four-room successor/restart gap, NOT a rerun of held-prefix accounting.
async function fourRoomPrefixRestartCases(){
 const text=fs.readFileSync(path.join(__dirname,'fixtures/guest-booking-r2-producer-prefix.js'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(require('node:crypto').createHash('sha256').update(text).digest('hex'),'97fa4ede51900253b49219b4ed2911641a77934a89830594bc04c04e5fda950b');
 const fixtures=vm.runInNewContext(text+';({database,subject,issue,plain})',{require,Buffer,console,__dirname});
 const db=fixtures.database();db.rows.GuestBookingCompletions=fixtures.plain([]);
 const groups=[{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'two_bedroom_apartment',quantity:1,guests:3}];
 const {A,T}=await fixtures.issue(db,groups),accepted=fixtures.plain(db.rows.GuestBookingAcceptances[0]);
 assert.ok(Number.isSafeInteger(accepted.offerExpiresAtMs));
 assert.ok(db.rows.GuestBookingAllocationManifests[0].manifestCanonical.includes('2027-01-03'));
 const calculation=JSON.parse(accepted.capsule).calculation;
 db.rows.GuestBookingFinancialRevisions.length=0;db.keys=null;db.config=null;
 const terminal=['Bookings','BookingSummary','GuestBookingCompletions'],prefixes=[],setup=[],marks=[],evidence=[];
 const contexts=new Set(),apis=new Set(),functions=new Set();
 async function step(){
  const s=fixtures.subject(db);assert.equal(s.loadedBackendNames().length,0);
  assert.equal(contexts.has(s.context),false);contexts.add(s.context);
  s.context.clock=()=>accepted.offerExpiresAtMs+1;
  const api=s.load('backend/guestBookingPhysicalAcquisition'),invoke=api.resumeGuestBookingPhysicalAcquisition;
  assert.equal(apis.has(api),false);apis.add(api);assert.equal(functions.has(invoke),false);functions.add(invoke);
  const before=fixtures.plain(db.rows),r=await invoke(A),inserts=s.trace.filter(t=>t.op==='insert');
  // Compare actual storage directly with an independently captured fixture-realm snapshot.
  const expected=fixtures.plain(before);assert.ok(inserts.length<=1);
  assert.equal(s.trace.some(t=>!['find','insert'].includes(t.op)||t.c==='GuestBookingFinancialRevisions'),false);
  if(inserts.length){
   const ins=inserts[0];assert.equal(before[ins.c].some(row=>row._id===ins.row._id),false);
   expected[ins.c].push(fixtures.plain(ins.row));
   const tail=s.trace.slice(s.trace.indexOf(ins)+1);assert.equal(tail.length,1);
   assert.equal(tail[0].op,'find');assert.equal(tail[0].c,ins.c);
   assert.deepEqual(tail[0].f,fixtures.plain(['_id',ins.row._id]));
   assert.deepEqual(ins.o,s.realm({suppressAuth:true,suppressHooks:true}));
   assert.deepEqual(tail[0].o,s.realm({suppressAuth:true,suppressHooks:true,consistentRead:true}));
  }
  assert.deepEqual(db.rows,expected,'one native insertion is the entire storage delta');
  assert.deepEqual(db.rows.GuestBookingAcceptances[0],accepted);
  for(const c of ['Bookings','BookingSummary'])assert.ok(db.rows[c].every(row=>row.status==='pending'));
  return {before,r,s,inserts};
 }
 let last;
 for(let n=0;n<240;n++){
  last=await step();setup.push({result:fixtures.plain(last.r),trace:fixtures.plain(last.s.trace)});
  if(last.inserts.length&&terminal.includes(last.inserts[0].c))prefixes.push(last.before);
  if(last.r.status==='CONFIRMED')break;
  assert.ok(['ACQUISITION_PENDING','COMPLETION_PENDING'].includes(last.r.status),last.r.status);
 }
 assert.equal(last.r.status,'CONFIRMED');const end=fixtures.plain(db.rows);
 assert.deepEqual(end.Bookings.map(row=>row._id),T[7]);assert.equal(end.Bookings.length,4);
 assert.equal(end.BookingSummary.length,1);assert.equal(end.GuestBookingCompletions.length,1);
 const receipt=end.GuestBookingCompletions[0],projection=JSON.parse(receipt.projectionCanonical);
 assert.equal(receipt._id,'gbc1-'+A);assert.equal(receipt.primaryBookingRowId,T[8]);
 assert.deepEqual(projection.summary.acceptedCalculation,calculation);assert.equal(calculation.groups.length,4);
 assert.equal(receipt.recipient,projection.summary.guestEmail);
 assert.equal(projection.plannedBookingRows.find(row=>row._id===T[8]).note,'Café 李');
 const targets=end.Bookings.map(row=>({c:'Bookings',row})).concat([{c:'BookingSummary',row:end.BookingSummary[0]},{c:'GuestBookingCompletions',row:receipt}]);
 assert.equal(prefixes.length,targets.length);prefixes.push(end);
 for(let prefix=0;prefix<prefixes.length;prefix++){
  db.rows=fixtures.plain(prefixes[prefix]);const invocations=[];
  // No future snapshot is substituted while advancing this retained prefix.
  // Include an additional receipt-present call after the last native write.
  for(let next=prefix;next<=targets.length;next++){
   const x=await step(),selected=targets[next],trace=x.s.trace;
   assert.equal(x.r.status,selected&&selected.c!=='GuestBookingCompletions'?'COMPLETION_PENDING':'CONFIRMED');
   assert.equal(x.inserts.length,selected?1:0);
   assert.equal(trace[0].op,'find');assert.equal(trace[0].c,'GuestBookingCompletions');
   assert.deepEqual(trace[0].f,fixtures.plain(['_id',receipt._id]),'receipt is the first SDK operation on EVERY fresh invocation');
   // Both verification passes must refetch their own bindings and native ledger.
   for(const c of ['GuestBookingAcceptances','GuestBookingAllocationManifests'])assert.equal(trace.filter(t=>t.op==='find'&&t.c===c).length,2);
   assert.equal(trace.filter(t=>t.op==='find'&&t.c==='GuestBookingAcquisitionControls'&&t.f?.[1]==='ra2-cart-'+A).length,2);
   assert.equal(trace.filter(t=>t.op==='find'&&t.c==='RoomBookingClaimEvents'&&!t.f).length,2);
   if(selected){assert.equal(x.inserts[0].c,selected.c);assert.deepEqual(x.inserts[0].row,selected.row);}
   else {assert.equal(trace.every(t=>t.op==='find'),true);assert.deepEqual(db.rows,x.before,'confirmed restart performs no mutation attempts or storage changes');}
   assert.deepEqual(db.rows,prefixes[Math.min(next+1,targets.length)],'native successor equals captured writer prefix');
   invocations.push({next,result:fixtures.plain(x.r),trace:fixtures.plain(trace)});
  }
  assert.deepEqual(db.rows,end);const id='SB7/four-room-prefix-restart/'+prefix;
  marks.push(id);evidence.push({id,start:fixtures.plain(prefixes[prefix]),invocations});
 }
 const ids=Array.from({length:7},(_,i)=>'SB7/four-room-prefix-restart/'+i);
 assert.deepEqual(marks,ids);assert.equal(new Set(marks).size,7);
 return {marks,evidence,setup,acceptanceId:A,end};
}
// Separate opt-in export; existing exports/default runner and every old body unchanged.

module.exports={productionSuffixBoundaryCases,productionSuffixRetainedNeighbors,productionSuffixBoundaryIds,heldPrefixAccountingCases,nativeForeignGrowthCases,samePassTupleCases,samePassArithmeticCase,connectedFourRoomCases,connectedSuffixCases,connectedSuffixIds,terminalStaleCompensationCases,terminalMixedHistoryRejectionCases,terminalWorkerArbitrationCases,terminalStaleWorkerCases,reservedSelectionCases,missingTargetReservedNeighbor,verificationProtocolCases,verificationProtocolIds,actualProducerCases,authoredIds,correctionIds,sharedMeteringCases,meteringIds,controlMeteringCases,controlMeteringIds,resourceMeteringCases,resourceMeteringIds,suffixAccountingCases,suffixAccountingIds,suffixHoldCases,suffixHoldIds};
module.exports.fourRoomPrefixRestartCases=fourRoomPrefixRestartCases;
// C2/C3 ordinary closure additions: AUTHORED NOTRUN. No execution admission.
// Inputs must be the unchanged actualProducerCases writer histories.
async function ordinaryCompletionModelClosureCases(fixtures,end,A,prefixes){
 const marks=[],evidence=[],c='RoomBookingClaimEvents';
 const transitions=[];
 for(let i=0;i<prefixes.length;i++)for(const row of (prefixes[i+1]||end)[c])if(row.claimType==='operation-decision'&&!prefixes[i][c].some(v=>v._id===row._id))transitions.push({prefix:prefixes[i],row});
 const final=transitions.at(-1);assert.ok(final);assert.equal(final.row.decisionState,'commit-rows');
 for(const mode of ['incomplete','conflicting']){
  const db=fixtures.database();db.rows=fixtures.plain(mode==='incomplete'?final.prefix:end);
  if(mode==='conflicting')db.rows[c].find(r=>r._id===final.row._id).decisionState='compensate';
  const before=fixtures.plain(db.rows),s=fixtures.subject(db),session=s.load('backend/guestBookingPhysicalAcquisitionEvidence').createGuestBookingPhysicalAcquisitionSession();
  const result=await session.read(A);assert.equal(result.status,mode==='incomplete'?'CANDIDATE':'INTEGRITY');
  if(mode==='incomplete'){assert.equal(result.collection,'resource');assert.deepEqual(fixtures.plain(result.candidate),final.row);}
  const at=s.trace.length;await assert.rejects(()=>session.readCompletionModel(A));assert.equal(s.trace.length,at,'denied model cannot fall back to native reads');
  assert.equal(s.trace.every(t=>t.op==='find'),true);assert.deepEqual(db.rows,before,'raw retained storage unchanged by reader/model denial');
  // Restore neither a failed scope nor fabricated authority. Incomplete work is
  // repaired by its actual next writer; corrupt history stays corrupt in its DB.
  const healthy=mode==='incomplete'?db:fixtures.database();if(mode==='conflicting')healthy.rows=fixtures.plain(end);
  let recoveryTrace=[];
  if(mode==='incomplete'){
   const writer=fixtures.subject(healthy),r=await writer.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);
   assert.equal(r.status,'ACQUISITION_PENDING');b091ExactTail(fixtures,writer,c,final.row);
   const expected=fixtures.plain(before);expected[c].push(fixtures.plain(final.row));assert.deepEqual(healthy.rows,expected);recoveryTrace=writer.trace;
  }
  const positiveBefore=fixtures.plain(healthy.rows),fresh=fixtures.subject(healthy),api=fresh.load('backend/guestBookingPhysicalAcquisitionEvidence'),positive=api.createGuestBookingPhysicalAcquisitionSession();
  assert.notEqual(fresh.context,s.context);assert.notEqual(positive,session);
  assert.equal((await positive.read(A)).status,'CART_COMMIT_MATERIALIZED_PENDING_PROJECTION');const positiveAt=fresh.trace.length;
  const model=await positive.readCompletionModel(A);assert.equal(model.accepted.root._id,A);assert.equal(model.record.manifestDigest,end.GuestBookingAllocationManifests[0].manifestDigest);assert.equal(fresh.trace.length,positiveAt);
  assert.equal(fresh.trace.every(t=>t.op==='find'),true);assert.deepEqual(healthy.rows,positiveBefore);
  const id='C2/model-'+mode+'-denial-fresh-positive';marks.push(id);evidence.push({id,result,trace:s.trace,recoveryTrace,positiveTrace:fresh.trace});
 }
 // Unlike SB6/reentry, the first pass is actually suspended inside native find.
 {
  const db=fixtures.database();db.rows=fixtures.plain(end);const before=fixtures.plain(db.rows);let enter,release,timer,paused=false;
  const entered=new Promise(r=>enter=r),hold=new Promise(r=>release=r),deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('C2 suspended read deadline')),15000);});
  const s=fixtures.subject(db,{read:async(collection)=>{if(collection===c&&!paused){paused=true;enter();await hold;}}}),session=s.load('backend/guestBookingPhysicalAcquisitionEvidence').createGuestBookingPhysicalAcquisitionSession();
  const run=session.read(A);
  try{
   await Promise.race([entered,run.then(()=>{throw Error('pass returned before native barrier');}),deadline]);
   const at=s.trace.length;await assert.rejects(()=>session.readCompletionModel(A));assert.equal(s.trace.length,at);
   assert.equal((await session.read(A)).status,'UNKNOWN');assert.equal(s.trace.length,at,'suspended reentry cannot start native IO');
   release();assert.equal((await Promise.race([run,deadline])).status,'UNKNOWN');const stopped=s.trace.length;
   await assert.rejects(()=>session.readCompletionModel(A));assert.equal(s.trace.length,stopped);assert.equal(s.trace.every(t=>t.op==='find'),true);assert.deepEqual(db.rows,before);
   const fresh=fixtures.subject(db),positive=fresh.load('backend/guestBookingPhysicalAcquisitionEvidence').createGuestBookingPhysicalAcquisitionSession();assert.notEqual(fresh.context,s.context);
   assert.equal((await positive.read(A)).status,'CART_COMMIT_MATERIALIZED_PENDING_PROJECTION');const atPositive=fresh.trace.length;
   assert.equal((await positive.readCompletionModel(A)).accepted.root._id,A);assert.equal(fresh.trace.length,atPositive);assert.equal(fresh.trace.every(t=>t.op==='find'),true);assert.deepEqual(db.rows,before);
   const id='C2/suspended-native-pass-reentry-model-denial';marks.push(id);evidence.push({id,trace:s.trace,positiveTrace:fresh.trace});
  }finally{release();await Promise.race([Promise.allSettled([run]),deadline]).finally(()=>clearTimeout(timer));}
 }
 assert.equal(marks.length,3);assert.equal(new Set(marks).size,3);return {marks,evidence};
}
async function ordinaryActivePhysicalHoldCase(fixtures,end,A){
 // Mechanism-only manual count depletion; not production-boundary reachability.
 const db=fixtures.database();db.rows=fixtures.plain(end);const before=fixtures.plain(db.rows),s=fixtures.subject(db),factory=s.load('backend/guestBookingAcquisitionContentionEvidence').createGuestBookingAcquisitionReadScope;
 const measured=factory();assert.equal((await measured.read(A)).status,'EVIDENCED');const baseline=measured.snapshot(),baselineTrace=s.trace.slice();
 const T=JSON.parse(end.GuestBookingAllocationManifests[0].manifestCanonical),preflight=1+T[6].reduce((n,p)=>n+5+3*(p.acquisitions.length-1),0)+T[6].length;
 const capacity=Math.max(baseline.spentFinds,preflight+3);assert.ok(capacity<30000);
 const scope=factory();for(let n=0;n<30000-capacity;n++)scope.reserveExact();
 const token=scope.reserveVerification('C3-owned-physical',{physical:{finds:capacity,bytes:baseline.spentBytes,pages:baseline.categories.physical.pages}});
 assert.equal(scope.remaining(),0);assert.equal(scope.physicalRemaining(),0,'inactive held capacity is not available');
 const at=s.trace.length,start=scope.snapshot();let inside=false;
 const result=await scope.verify(token,'C3-owned-physical',async()=>{
  assert.equal(scope.remaining(),0);assert.equal(scope.physicalRemaining(),capacity);inside=true;
  const observed=await scope.read(A);
  assert.equal(observed.status,'EVIDENCED','C3 owned active capacity must admit valid native traversal');return observed;
 });
 assert.equal(inside,true);assert.equal(result.status,'EVIDENCED');
 const after=scope.snapshot();assert.deepEqual(s.trace.slice(at),baselineTrace,'owned hold cannot change native query order/options/identity');
 assert.equal(after.spentFinds-start.spentFinds,baseline.spentFinds);assert.equal(after.spentBytes-start.spentBytes,baseline.spentBytes);
 assert.equal(after.categories.physical.pages-start.categories.physical.pages,baseline.categories.physical.pages);
 assert.equal(after.heldFinds,0);assert.equal(after.heldBytes,0);assert.equal(after.spentMutations,0);assert.equal(s.trace.every(t=>t.op==='find'),true);assert.deepEqual(db.rows,before);
 return {marks:['C3/owned-active-physical-preflight-native-debits'],evidence:{preflight,capacity,start,after,baseline,trace:s.trace.slice(at)}};
}
module.exports.ordinaryCompletionModelClosureCases=ordinaryCompletionModelClosureCases;
module.exports.ordinaryActivePhysicalHoldCase=ordinaryActivePhysicalHoldCase;
// B09.1 narrow receipt ACK/readback schedule. AUTHORED NOTRUN; independent admission required.
async function receiptAckReadbackUncertaintyCases(fixtures,end,A,prefixes){
 const id='B09.1/receipt-ack-before-read-unknown-fresh-replay',c='GuestBookingCompletions';
 const receipt=end[c][0];assert.equal(end[c].length,1);assert.equal(receipt._id,'gbc1-'+A);
 const prefix=prefixes.at(-1);assert.ok(prefix);assert.equal(prefix[c].length,0);
 const db=fixtures.database();db.rows=fixtures.plain(prefix);
 const before=fixtures.plain(db.rows),expected=fixtures.plain(before);
 expected[c].push(fixtures.plain(receipt));assert.deepEqual(expected,end,'immediate genuine writer prefix');
 const projection=JSON.parse(receipt.projectionCanonical),calculation=JSON.parse(before.GuestBookingAcceptances[0].capsule).calculation;
 assert.deepEqual(projection.summary.acceptedCalculation,calculation);assert.equal(calculation.groups.length,3);
 assert.equal(receipt.recipient,projection.summary.guestEmail);
 assert.equal(projection.plannedBookingRows.find(row=>row._id===receipt.primaryBookingRowId).note,'Café 李');
 // These oracles compare raw storage, never a JSON-normalized actual operand.
 function outcome(rows,wantRows,status,wantStatus,trace,allowed){
  assert.equal(status,wantStatus);assert.deepEqual(rows,wantRows);
  assert.equal(trace.every(t=>allowed.includes(t.op)&&t.c!=='GuestBookingFinancialRevisions'),true);
 }
 let applied=0,acknowledged=0,failedReads=0;
 const s=fixtures.subject(db,{
  after:async(collection,row)=>{
   assert.equal(collection,c);assert.deepEqual(row,receipt);applied++;
   assert.deepEqual(db.rows,expected,'native insert retained before ACK');
  },
  read:async(collection,f)=>{
   if(!acknowledged)return;
   assert.equal(collection,c);assert.deepEqual(f,fixtures.plain(['_id',receipt._id]));
   assert.equal(applied,1);assert.equal(acknowledged,1);failedReads++;
   assert.equal(failedReads,1);assert.deepEqual(db.rows,expected);
   throw Error('selected receipt readback unavailable after successful ACK');
  }
 });
 assert.equal(s.loadedBackendNames().length,0);
 // Observe successful SDK return, not merely the apply-before-ACK hook.
 const nativeInsert=s.wix.insert;
 s.wix.insert=async function(...args){const result=await nativeInsert.apply(this,args);acknowledged++;return result;};
 const api=s.load('backend/guestBookingPhysicalAcquisition'),invoke=api.resumeGuestBookingPhysicalAcquisition;
 const r=await invoke(A),inserts=s.trace.filter(t=>t.op==='insert');
 assert.equal(applied,1);assert.equal(acknowledged,1);assert.equal(failedReads,1);assert.equal(inserts.length,1);
 const ins=inserts[0];assert.equal(ins.c,c);assert.deepEqual(ins.row,receipt);
 assert.deepEqual(ins.o,s.realm({suppressAuth:true,suppressHooks:true}));
 const tail=s.trace.slice(s.trace.indexOf(ins)+1);assert.equal(tail.length,1);
 assert.equal(tail[0].op,'find');assert.equal(tail[0].c,c);
 assert.deepEqual(tail[0].f,fixtures.plain(['_id',receipt._id]));
 assert.deepEqual(tail[0].o,s.realm({suppressAuth:true,suppressHooks:true,consistentRead:true}));
 outcome(db.rows,expected,r.status,'UNKNOWN',s.trace,['find','insert']);
 const retained=fixtures.plain(db.rows),fresh=fixtures.subject(db);
 assert.equal(fresh.loadedBackendNames().length,0);assert.notEqual(fresh.context,s.context);assert.notEqual(fresh.load,s.load);
 const freshApi=fresh.load('backend/guestBookingPhysicalAcquisition');assert.notEqual(freshApi,api);
 assert.notEqual(freshApi.resumeGuestBookingPhysicalAcquisition,invoke);
 const recovered=await freshApi.resumeGuestBookingPhysicalAcquisition(A);
 assert.ok(fresh.trace.length>0);assert.equal(fresh.trace[0].op,'find');assert.equal(fresh.trace[0].c,c);
 assert.deepEqual(fresh.trace[0].f,fixtures.plain(['_id',receipt._id]));
 assert.deepEqual(fresh.trace[0].o,fresh.realm({suppressAuth:true,suppressHooks:true,consistentRead:true}));
 outcome(db.rows,retained,recovered.status,'CONFIRMED',fresh.trace,['find']);
 assert.deepEqual(db.rows,expected,'finances, original group order, identity, recipient, note and all base rows unchanged');
 // Genuine stored-row mutation and forbidden-IO/status controls bind the same oracles.
 const changed=fixtures.plain(db.rows);changed.Bookings[0].note+='changed';
 assert.throws(()=>outcome(changed,retained,'CONFIRMED','CONFIRMED',fresh.trace,['find']),assert.AssertionError);
 assert.throws(()=>outcome(db.rows,retained,'UNKNOWN','CONFIRMED',fresh.trace,['find']),assert.AssertionError);
 assert.throws(()=>outcome(db.rows,expected,'CONFIRMED','UNKNOWN',s.trace,['find','insert']),assert.AssertionError);
 for(const op of ['insert','update','save','remove','release','provider','secret']){
  const extra=fresh.trace.slice();extra.push(fixtures.plain({op,c}));
  assert.throws(()=>outcome(db.rows,retained,'CONFIRMED','CONFIRMED',extra,['find']),assert.AssertionError);
 }
 return {marks:[id],evidence:[{id,before,retained,result:r,trace:s.trace,recovered,replayTrace:fresh.trace}],end:db.rows};
}
module.exports.receiptAckReadbackUncertaintyCases=receiptAckReadbackUncertaintyCases;
// B09.1 remaining ordinary fault phases; backend execution NOTRUN until review.
// Fixture-only constructor: no backend load, no replacement of writer decisions.
function b091FaultSetup(fixtures,prefix,c,target,mode){
 assert.ok(['before-no-effect','failed-insert-unreadable','ack-unreadable'].includes(mode));
 const db=fixtures.database();db.rows=fixtures.plain(prefix);
 const before=fixtures.plain(db.rows),expected=fixtures.plain(before);
 assert.equal(before[c].some(row=>row._id===target._id),false);
 if(mode==='ack-unreadable')expected[c].push(fixtures.plain(target));
 const counts={attempted:0,applied:0,acknowledged:0,readbacks:0};
 const s=fixtures.subject(db,{
  before:async(collection,row)=>{
   assert.equal(collection,c);assert.deepEqual(row,target);counts.attempted++;
   assert.equal(counts.attempted,1);assert.deepEqual(db.rows,before);
   if(mode!=='ack-unreadable')throw Error('before native insert: no retained effect');
  },
  after:async(collection,row)=>{
   assert.equal(collection,c);assert.deepEqual(row,target);counts.applied++;
   assert.equal(counts.applied,1);assert.deepEqual(db.rows,expected);
  },
  read:async(collection,f)=>{
   if(!counts.attempted)return;
   assert.equal(collection,c);assert.deepEqual(f,fixtures.plain(['_id',target._id]));
   counts.readbacks++;assert.equal(counts.readbacks,1);assert.deepEqual(db.rows,expected);
   assert.equal(counts.acknowledged,mode==='ack-unreadable'?1:0);
   if(mode!=='before-no-effect')throw Error('keyed readback unavailable, never absence');
  }
 });
 assert.equal(s.loadedBackendNames().length,0);
 const nativeInsert=s.wix.insert;
 s.wix.insert=async function(...args){const result=await nativeInsert.apply(this,args);counts.acknowledged++;return result;};
 const readbacks=[],nativeQuery=s.wix.query;
 s.wix.query=function(collection){
  const q=nativeQuery.call(this,collection),eq=q.eq,limit=q.limit,find=q.find;let field,value,max;
  q.eq=function(k,v){field=k;value=v;eq.call(this,k,v);return this;};
  q.limit=function(n){max=n;limit.call(this,n);return this;};
  q.find=async function(options){
   if(!counts.attempted)return find.call(this,options);
   const observation={collection,field,value,max,outcome:'THREW'};readbacks.push(observation);
   const result=await find.call(this,options);observation.outcome='RETURNED';
   observation.count=result.items.length;observation.more=result.hasNext();return result;
  };return q;
 };
 return {db,s,before,expected,counts,readbacks};
}
function b091ExactTail(fixtures,s,c,target){
 const inserts=s.trace.filter(t=>t.op==='insert');assert.equal(inserts.length,1);
 const ins=inserts[0];assert.equal(ins.c,c);assert.deepEqual(ins.row,target);
 assert.deepEqual(ins.o,s.realm({suppressAuth:true,suppressHooks:true}));
 const tail=s.trace.slice(s.trace.indexOf(ins)+1);assert.equal(tail.length,1);
 assert.equal(tail[0].op,'find');assert.equal(tail[0].c,c);
 assert.deepEqual(tail[0].f,fixtures.plain(['_id',target._id]));
 assert.deepEqual(tail[0].o,s.realm({suppressAuth:true,suppressHooks:true,consistentRead:true}));
 assert.equal(s.trace.every(t=>['find','insert'].includes(t.op)&&t.c!=='GuestBookingFinancialRevisions'),true);
}
async function terminalPreinsertReadbackUncertaintyCases(fixtures,end,A,prefixes){
 const targets=[];for(const c of ['Bookings','BookingSummary','GuestBookingCompletions'])for(const row of end[c])targets.push({c,row});
 assert.equal(end.Bookings.length,3);assert.equal(targets.length,5);
 const receipt=end.GuestBookingCompletions[0],projection=JSON.parse(receipt.projectionCanonical);
 assert.equal(receipt._id,'gbc1-'+A);
 assert.deepEqual(projection.summary.acceptedCalculation,JSON.parse(end.GuestBookingAcceptances[0].capsule).calculation);
 assert.equal(projection.summary.acceptedCalculation.groups.length,3);
 assert.equal(receipt.recipient,projection.summary.guestEmail);
 assert.equal(projection.plannedBookingRows.find(row=>row._id===receipt.primaryBookingRowId).note,'Café 李');
 const marks=[],evidence=[],expectedIds=[];
 for(let ordinal=0;ordinal<targets.length;ordinal++){
  const {c,row}=targets[ordinal];
  const index=prefixes.findIndex((p,i)=>!p[c].some(v=>v._id===row._id)&&(prefixes[i+1]||end)[c].some(v=>v._id===row._id));
  assert.ok(index>=0);const prefix=prefixes[index],successor=prefixes[index+1]||end;
  const one=fixtures.plain(prefix);one[c].push(fixtures.plain(row));assert.deepEqual(one,successor,'genuine immediate writer prefix');
  // Receipt successful-ACK/read-failure already passed; do not duplicate it.
  const modes=c==='GuestBookingCompletions'?['before-no-effect','failed-insert-unreadable']:['before-no-effect','failed-insert-unreadable','ack-unreadable'];
  for(const mode of modes){
   const id='B09.1/'+c+'/'+ordinal+'/'+mode;expectedIds.push(id);
   const x=b091FaultSetup(fixtures,prefix,c,row,mode),{db,s}=x;
   const api=s.load('backend/guestBookingPhysicalAcquisition'),invoke=api.resumeGuestBookingPhysicalAcquisition;
   const result=await invoke(A);assert.equal(result.status,'UNKNOWN','no ACK or unreadable/absent readback grants completion');
   assert.deepEqual(x.counts,{attempted:1,applied:mode==='ack-unreadable'?1:0,acknowledged:mode==='ack-unreadable'?1:0,readbacks:1});
   assert.deepEqual(x.readbacks,[{collection:c,field:'_id',value:row._id,max:2,outcome:mode==='before-no-effect'?'RETURNED':'THREW',...(mode==='before-no-effect'?{count:0,more:false}:{})}]);
   b091ExactTail(fixtures,s,c,row);assert.deepEqual(db.rows,x.expected,'raw whole-storage delta, no fabricated effect');
   assert.equal(db.rows[c].filter(v=>v._id===row._id).length,mode==='ack-unreadable'?1:0);
   const retained=fixtures.plain(db.rows),recovery=[];
   const contexts=new Set([s.context]),apis=new Set([api]),functions=new Set([invoke]),loaders=new Set([s.load]);
   // Advance retained storage only by actual fresh writers; never reset to a future snapshot.
   for(let next=ordinal+(mode==='ack-unreadable'?1:0);next<=targets.length;next++){
    const fresh=fixtures.subject(db);assert.equal(fresh.loadedBackendNames().length,0);
    assert.equal(contexts.has(fresh.context),false);contexts.add(fresh.context);
    assert.equal(loaders.has(fresh.load),false);loaders.add(fresh.load);
    const freshApi=fresh.load('backend/guestBookingPhysicalAcquisition'),call=freshApi.resumeGuestBookingPhysicalAcquisition;
    assert.equal(apis.has(freshApi),false);apis.add(freshApi);assert.equal(functions.has(call),false);functions.add(call);
    const before=fixtures.plain(db.rows),want=fixtures.plain(before),selected=targets[next],r=await call(A);
    assert.equal(r.status,selected&&selected.c!=='GuestBookingCompletions'?'COMPLETION_PENDING':'CONFIRMED');
    const first=fresh.trace[0];assert.equal(first.op,'find');assert.equal(first.c,'GuestBookingCompletions');
    assert.deepEqual(first.f,fixtures.plain(['_id',receipt._id]));
    assert.deepEqual(first.o,fresh.realm({suppressAuth:true,suppressHooks:true,consistentRead:true}));
    if(selected){assert.equal(before[selected.c].some(v=>v._id===selected.row._id),false);b091ExactTail(fixtures,fresh,selected.c,selected.row);want[selected.c].push(fixtures.plain(selected.row));}
    else assert.equal(fresh.trace.every(t=>t.op==='find'&&t.c!=='GuestBookingFinancialRevisions'),true);
    assert.deepEqual(db.rows,want,'exact next target only; no duplicate insert or collateral storage change');
    assert.deepEqual(db.rows.GuestBookingAcceptances,end.GuestBookingAcceptances);
    for(const name of ['Bookings','BookingSummary'])assert.equal(db.rows[name].every(v=>v.status==='pending'),true);
    recovery.push({next,result:r,trace:fresh.trace});
   }
   assert.deepEqual(db.rows,end,'full financial, identity, recipient, primary and all native rows preserved');
   marks.push(id);evidence.push({id,before:x.before,retained,result,trace:s.trace,recovery});
  }
 }
 assert.deepEqual(marks,expectedIds);assert.equal(new Set(marks).size,14);
 return {marks,evidence};
}
// Applied native write, rejected ACK, then ordinary readable reconciliation.
// Pure fixture setup; exporting this does not admit backend execution.
function b091ApplyBeforeAckSetup(fixtures,prefix,c,target){
 const db=fixtures.database();db.rows=fixtures.plain(prefix);
 const before=fixtures.plain(db.rows),expected=fixtures.plain(before);
 assert.equal(before[c].some(row=>row._id===target._id),false);
 expected[c].push(fixtures.plain(target));
 const counts={attempted:0,applied:0,acknowledged:0,readbacks:0};
 const s=fixtures.subject(db,{
  before:async(collection,row)=>{
   assert.equal(collection,c);assert.deepEqual(row,target);
   counts.attempted++;assert.equal(counts.attempted,1);assert.deepEqual(db.rows,before);
  },
  after:async(collection,row)=>{
   assert.equal(collection,c);assert.deepEqual(row,target);
   assert.equal(db.rows[c].at(-1),row,'fault occurs after retaining the exact native object');
   assert.deepEqual(db.rows,expected);counts.applied++;assert.equal(counts.applied,1);
   throw Error('lost ACK');
  },
  read:async(collection,f)=>{
   if(!counts.attempted)return;
   assert.equal(collection,c);assert.deepEqual(f,fixtures.plain(['_id',target._id]));
   assert.equal(counts.applied,1);assert.equal(counts.acknowledged,0);
   counts.readbacks++;assert.equal(counts.readbacks,1);assert.deepEqual(db.rows,expected);
  }
 });
 assert.equal(s.loadedBackendNames().length,0);
 const nativeInsert=s.wix.insert;
 s.wix.insert=async function(...args){const result=await nativeInsert.apply(this,args);counts.acknowledged++;return result;};
 return {db,s,before,expected,counts};
}
// B08.4/B08.5 additive oracle tranche: backend selections AUTHORED_NOTRUN.
// Contract sections 2.1-2.4 and 7; never derive expected bytes from a receipt.
function b085Hash(domain,text){return require('node:crypto').createHash('sha256').update(domain+'\n'+text,'utf8').digest('hex');}
function b085Calculation(kind){
 const codes=kind==='mixed'?['adventure_suite','penthouse_apartment','adventure_suite']:['adventure_suite',...(kind==='split'?['adventure_suite']:[])];
 const amounts=kind==='mixed'?[[20000,0,20000,1000,1000,1500,23500],[22001,0,22001,1100,1100,1650,25851],[20000,0,20000,1000,1000,1500,23500]]:kind==='split'?[[10,0,10,1,1,1,13],[10,0,10,1,1,1,13]]:[[20,0,20,1,1,2,24]];
 const keys=['grossCents','discountCents','roomTotalCents','propertyFeeCents','accommodationVatCents','packageVatCents','grandTotalCents'];
 const groups=codes.map((roomCode,index)=>Object.assign({index,roomCode,quantity:kind==='merged'?2:1,guests:2},Object.fromEntries(keys.map((k,j)=>[k,amounts[index][j]]))));
 const totals=Object.fromEntries(keys.map((k,j)=>[k,amounts.reduce((n,a)=>n+a[j],0)]));
 Object.assign(totals,{totalVatCents:totals.accommodationVatCents+totals.packageVatCents,totalRooms:kind==='mixed'?3:2,totalGuests:kind==='mixed'?6:4});
 return {v:1,currency:'USD',rounding:'original-group-backend-v1',groups,totals};
}
function b085Expected(root,manifest,kind){
 const capsule=JSON.parse(root.capsule),purchase=JSON.parse(capsule.inputCanonical),calculation=b085Calculation(kind);
 assert.deepEqual(capsule.calculation,calculation,'independent complete seven-component group/totals oracle');
 assert.deepEqual(purchase[9],calculation.groups.map(g=>[g.roomCode,g.quantity,g.guests]));
 assert.deepEqual(purchase[7],['Fixture Guest','fixture@example.test','1234567','1','Café 李','']);
 assert.deepEqual([purchase[2],purchase[3]],['2027-01-01','2027-01-03']);
 assert.equal(capsule.factors.penthouseRoomFee,kind==='mixed'?10.005:null);
 assert.deepEqual([capsule.factors.nights,capsule.factors.totalPerPerson,capsule.factors.propertyFeeRate,capsule.factors.taxRateAccommodation,capsule.factors.taxRateStandard,capsule.factors.promoDiscountRate],[2,kind==='mixed'?100:0.05,0.05,0.1,0.15,0]);
 const A=root._id,encoded=Buffer.from(root.operationId,'hex').toString('base64url'),sha=t=>require('node:crypto').createHash('sha256').update(t,'utf8').digest('hex');
 assert.equal(manifest._id,'ga2_'+encoded);assert.equal(manifest.manifestDigest,sha(manifest.manifestCanonical));
 const plannedBookingRows=[];let primary;
 for(const [code,suffix,units] of [['penthouse_apartment','p',[1]],['adventure_suite','a',[3,4]]]){
  const refs=[];calculation.groups.forEach(g=>{if(g.roomCode===code)for(let q=1;q<=g.quantity;q++)refs.push([g.index,q]);});if(!refs.length)continue;
  const operationId='cg2_'+encoded+'_'+suffix,guests=refs.map(()=>2),notes=refs.map(([i,q])=>i===0&&q===1?'Café 李':'');
  const payloadDigest=sha(JSON.stringify(['wbe.accepted-allocation-payload',1,A,root.operationId,root.rootDigest,root.capsule,root.bookingNumber,operationId,code,'2027-01-01','2027-01-03',refs.length,refs,guests,notes]));
  refs.forEach(([originalGroupIndex,q],j)=>{const _id='pb1-'+operationId+'-r'+(j+1);if(originalGroupIndex===0&&q===1)primary=_id;plannedBookingRows.push({_id,roomCode:code,assignedRoom:units[j],quantity:1,checkIn:'2027-01-01',checkOut:'2027-01-03',bookingNumber:root.bookingNumber,operationId,payloadDigest,originalGroupIndex,ordinal:q-1,guests:2,note:notes[j]});});
 }
 const summary={_id:'gbs1-'+A,bookingNumber:root.bookingNumber,acceptanceId:A,rootDigest:root.rootDigest,manifestId:manifest._id,manifestDigest:manifest.manifestDigest,bookingDate:new Date(root.validatedAtMs).toISOString(),checkIn:'2027-01-01',checkOut:'2027-01-03',guestName:'Fixture Guest',guestEmail:'fixture@example.test',guestPhone:'1234567',dialingCode:'1',notes:'Café 李',marketSource:'',packageTitle:'Public fixture stay',roomCount:calculation.totals.totalRooms,totalGuests:calculation.totals.totalGuests,acceptedCalculation:calculation,financialDigest:b085Hash('wbe.completion-financial.v1',JSON.stringify(calculation))};
 const bookingRows=plannedBookingRows.map(({originalGroupIndex,ordinal,...row})=>({...row,status:'pending'}));
 const slim={_id:summary._id,bookingNumber:root.bookingNumber,bookingDate:summary.bookingDate,checkIn:summary.checkIn,checkOut:summary.checkOut,guestName:summary.guestName,guestEmail:summary.guestEmail,guestPhone:summary.guestPhone,marketSource:summary.marketSource,notes:summary.notes,packageTitle:summary.packageTitle,roomCount:summary.roomCount,status:'pending'};
 const receipt={_id:'gbc1-'+A,schemaVersion:1,kind:'booking-completion',outcome:'CONFIRMED',acceptanceId:A,operationId:root.operationId,audience:root.audience,rootDigest:root.rootDigest,manifestId:manifest._id,manifestDigest:manifest.manifestDigest,admissionId:'ra2-cart-'+A,cartDirectionId:'ra2-direction-'+A,bookingNumber:root.bookingNumber,primaryBookingRowId:primary,projectionCanonical:JSON.stringify({v:1,plannedBookingRows,summary}),projectionDigest:'',bookingRowsCanonical:JSON.stringify(bookingRows),bookingRowsDigest:'',summaryId:slim._id,summaryCanonical:JSON.stringify(slim),summaryDigest:'',financialDigest:summary.financialDigest,recipient:summary.guestEmail,recipientBindingDigest:''};
 b085Seal(receipt);
 return {bookingRows,summary:slim,receipt};
}
// Used only for expected bytes and deliberately self-consistent NEGATIVE receipts.
function b085Seal(r){
 r.projectionDigest=b085Hash('wbe.completion-projection-record.v1',r.projectionCanonical);
 r.bookingRowsDigest=b085Hash('wbe.completion-booking-records.v1',r.bookingRowsCanonical);
 r.summaryDigest=b085Hash('wbe.completion-summary-record.v1',r.summaryCanonical);
 r.recipientBindingDigest=b085Hash('wbe.completion-recipient.v1',JSON.stringify([r.audience,r.acceptanceId,r.rootDigest,r.manifestDigest,r.bookingNumber,r.summaryId,r.recipient,r.financialDigest]));
}
function b085Assert(fixtures,rows,want){
 assert.deepEqual(rows.Bookings,fixtures.plain(want.bookingRows),'all native rows, identities and notes');
 assert.deepEqual(rows.BookingSummary,fixtures.plain([want.summary]),'exact slim accepted contact/date mapping');
 assert.deepEqual(rows.GuestBookingCompletions,fixtures.plain([want.receipt]),'independent complete receipt bytes and domains');
 assert.notEqual(want.receipt.summaryDigest,b085Hash('wbe.completion-summary.v2',want.receipt.summaryCanonical));
 assert.notEqual(want.receipt.bookingRowsDigest,b085Hash('wbe.completion-row.v2',want.receipt.bookingRowsCanonical));
}
async function terminalDigestFinanceOracleCases(fixtures,end,A,prefixes){
 const root=JSON.parse(JSON.stringify(end.GuestBookingAcceptances[0])),manifest=JSON.parse(JSON.stringify(end.GuestBookingAllocationManifests[0]));
 assert.equal(root._id,A);const want=b085Expected(root,manifest,'mixed'),marks=[];
 b085Assert(fixtures,end,want);assert.notEqual(want.receipt.primaryBookingRowId,want.bookingRows[0]._id);
 const db=fixtures.database();db.rows=fixtures.plain(end);
 const s=fixtures.subject(db),before=fixtures.plain(db.rows);s.context.clock=()=>root.offerExpiresAtMs+1;
 const r=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);
 assert.equal(r.status,'CONFIRMED');assert.equal(s.trace.every(t=>t.op==='find'&&t.c!=='GuestBookingFinancialRevisions'),true);assert.deepEqual(db.rows,before);b085Assert(fixtures,db.rows,want);
 marks.push('B08.5/oracle/mixed-full-tuple-contact-digests-replay');
 // Complete every legal terminal prefix using native writers, never insert oracle rows.
 const targets=[...want.bookingRows.map(row=>({c:'Bookings',row})),{c:'BookingSummary',row:want.summary},{c:'GuestBookingCompletions',row:want.receipt}];
 for(let ordinal=0;ordinal<targets.length;ordinal++){
  const target=targets[ordinal],p=prefixes.find((v,i)=>!v[target.c].some(x=>x._id===target.row._id)&&(prefixes[i+1]||end)[target.c].some(x=>x._id===target.row._id));assert.ok(p);
  db.rows=fixtures.plain(p);
  for(let next=ordinal;next<targets.length;next++){
   const worker=fixtures.subject(db),expected=fixtures.plain(db.rows),t=targets[next];expected[t.c].push(fixtures.plain(t.row));
   const result=await worker.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);
   assert.equal(result.status,t.c==='GuestBookingCompletions'?'CONFIRMED':'COMPLETION_PENDING');b091ExactTail(fixtures,worker,t.c,fixtures.plain(t.row));assert.deepEqual(db.rows,expected);
  }
  b085Assert(fixtures,db.rows,want);marks.push('B08.5/oracle/native-prefix/'+ordinal);
 }
 const faults=[];
 for(let i=0;i<want.bookingRows.length;i++)for(const field of Object.keys(want.bookingRows[i]))faults.push({id:'row/'+i+'/'+field,apply(rows){const row=rows.Bookings[i];row[field]=typeof row[field]==='number'?row[field]+1:row[field]+'x';}});
 for(const mode of ['duplicate-row','extra-row','duplicate-summary','extra-summary'])faults.push({id:mode,apply(rows){const c=mode.endsWith('summary')?'BookingSummary':'Bookings',copy=fixtures.plain(rows[c][0]);if(mode.startsWith('extra'))copy._id+='x';rows[c].push(copy);}});
 for(const mode of ['group-order','merge-groups','one-cent','recipient','primary'])faults.push({id:'resealed/'+mode,apply(rows){
  const receipt=rows.GuestBookingCompletions[0],p=JSON.parse(receipt.projectionCanonical),calc=p.summary.acceptedCalculation;
  if(mode==='group-order')calc.groups.reverse();
  if(mode==='merge-groups'){calc.groups[0].quantity=2;calc.groups.splice(2,1);}
  if(mode==='one-cent'){calc.groups[0].grossCents++;calc.groups[0].roomTotalCents++;calc.groups[0].grandTotalCents++;calc.totals.grossCents++;calc.totals.roomTotalCents++;calc.totals.grandTotalCents++;}
  if(mode==='recipient'){p.summary.guestEmail='other@example.test';receipt.recipient=p.summary.guestEmail;const slim=JSON.parse(receipt.summaryCanonical);slim.guestEmail=p.summary.guestEmail;receipt.summaryCanonical=JSON.stringify(slim);rows.BookingSummary[0].guestEmail=p.summary.guestEmail;}
  if(mode==='primary')receipt.primaryBookingRowId=want.bookingRows[0]._id;
  p.summary.financialDigest=b085Hash('wbe.completion-financial.v1',JSON.stringify(calc));receipt.financialDigest=p.summary.financialDigest;receipt.projectionCanonical=JSON.stringify(p);b085Seal(receipt);
 }});
 for(const fault of faults){
  db.rows=fixtures.plain(end);fault.apply(db.rows);const unchanged=fixtures.plain(db.rows),worker=fixtures.subject(db);
  const result=await worker.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);
  assert.equal(result.status,'INTEGRITY',fault.id);assert.equal(worker.trace.every(t=>t.op==='find'),true,fault.id);assert.deepEqual(db.rows,unchanged,fault.id);marks.push('B08.4/oracle/'+fault.id);
 }
 assert.equal(marks.length,51);assert.equal(new Set(marks).size,marks.length);return {marks,expected:want};
}
// Separate actual issuance of the classic 26-cent split / 24-cent merged offers.
async function terminalRoundingOracleCases(fixtures){
 const marks=[];
 for(const kind of ['split','merged']){
  const db=fixtures.database();db.rows.GuestBookingCompletions=fixtures.plain([]);
  const revision=JSON.parse(db.rows.GuestBookingFinancialRevisions[0].revisionBytes);revision.package.baseRate=0.05;
  db.rows.GuestBookingFinancialRevisions[0].revisionBytes=JSON.stringify(revision);
  const crypto=require('node:crypto');db.config.revisionDigest=crypto.createHash('sha256').update('wbe.financial-revision.v1\0'+JSON.stringify(revision)).digest('hex');
  const s=fixtures.subject(db),now=1800000000000,q={v:1,nonce:'000102030405060708090a0b',issuedAt:now,expiresAt:now+3600000,checkIn:'2027-01-01',checkOut:'2027-01-03',nights:2,packageId:'package',packageTitle:'Public fixture stay',baseRate:0.05,priceModifier:1,totalPerPerson:0.05};
  const payload=Buffer.from(JSON.stringify(q)).toString('base64url');
  const input={v:1,checkIn:q.checkIn,checkOut:q.checkOut,packageId:q.packageId,pricingQuoteToken:payload+'.'+crypto.createHmac('sha256','PUBLIC-ACCEPTANCE-QUOTE-FIXTURE-ONLY').update(payload).digest('base64url'),promoCode:'',guestName:'Fixture Guest',guestEmail:'fixture@example.test',guestPhone:'1234567',dialingCode:'1',note:'Café 李',marketSource:'',gclid:'',gbraid:'',wbraid:'',msclkid:'',priceGroups:b085Calculation(kind).groups.map(({roomCode,quantity,guests})=>({roomCode,quantity,guests}))};
  const offer=await s.load('backend/guestBookingOfferIssuer').issueGuestBookingOffer(s.realm(input));assert.notEqual(offer,'DENIED');
  assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule)).status,'ACCEPTED_PENDING');
  const A=db.rows.GuestBookingAcceptances[0]._id;assert.equal((await s.load('backend/guestBookingAllocationHandoff').handoffGuestBookingAllocation(A)).status,'ALLOCATION_HANDOFF_PENDING');
  const want=b085Expected(JSON.parse(JSON.stringify(db.rows.GuestBookingAcceptances[0])),JSON.parse(JSON.stringify(db.rows.GuestBookingAllocationManifests[0])),kind);
  db.rows.GuestBookingFinancialRevisions.length=0;db.config=null;db.keys=null;
  let result;for(let n=0;n<200;n++){
   const worker=fixtures.subject(db);worker.context.clock=()=>now+3600001;
   result=await worker.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(A);
   assert.ok(worker.trace.filter(t=>t.op==='insert').length<=1);assert.equal(worker.trace.some(t=>!['find','insert'].includes(t.op)||t.c==='GuestBookingFinancialRevisions'),false);
   if(result.status==='CONFIRMED')break;assert.ok(['ACQUISITION_PENDING','COMPLETION_PENDING'].includes(result.status));
  }
  assert.equal(result.status,'CONFIRMED');b085Assert(fixtures,db.rows,want);marks.push('B08.5/oracle/'+kind+'-rounding');
 }
 assert.deepEqual(marks,['B08.5/oracle/split-rounding','B08.5/oracle/merged-rounding']);return marks;
}
module.exports.b085Calculation=b085Calculation;
module.exports.b085Expected=b085Expected;
module.exports.b085Assert=b085Assert;
module.exports.terminalDigestFinanceOracleCases=terminalDigestFinanceOracleCases;
module.exports.terminalRoundingOracleCases=terminalRoundingOracleCases;
module.exports.b091ApplyBeforeAckSetup=b091ApplyBeforeAckSetup;
module.exports.b091FaultSetup=b091FaultSetup;
module.exports.b091ExactTail=b091ExactTail;
module.exports.terminalPreinsertReadbackUncertaintyCases=terminalPreinsertReadbackUncertaintyCases;
if(require.main===module){console.log(JSON.stringify({status:'AUTHORED_NOTRUN',authoredIds,correctionIds,additionalAuthored:{'B09.2/terminal-target':18,'B09.5/stale-start-capacity-unit':9,'B09.5/stale-compensation-settlement':3,'B09.5/valid-commit-controls':3,'B09.5/INVALID-mixed-history':9},reason:'Actual producer imports D1 closure; execution admission unwaived',contract:'Original B09.2 same-missing-target required; opposing valid cart directions are not an original requirement. Conditional source exclusion is not runtime proof or B09.5 waiver; parent reconciles mapping.',missing:['SR1 complete inherited cumulative invocation/suffix envelope','B08.3 reader/planner','B09.2/B09.5 independent exact-byte review and D1 execution','complete B08.4/B09.1/B09.4 matrix','B10/P2/P3']}));}
