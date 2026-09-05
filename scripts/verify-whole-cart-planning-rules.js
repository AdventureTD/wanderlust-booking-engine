// Off-production actual-core candidate tests. No persistence or coordinator.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');
const backend = path.join(__dirname, '..', 'velo', 'backend');
const target = path.join(backend, 'wholeCartPlanningRules.js');
function source(name) { return fs.readFileSync(path.join(backend, name), 'utf8'); }
function wrap(text, names) {
  return '(function(){\n' + text.replace(/^import .*;\s*$/gm, '').replace(/export function /g, 'function ') + '\nreturn {' + names + '};})()';
}
function load(text) {
  const c = vm.createContext({crypto, assert, console});
  for (const [file, name] of [
    ['roomBookingCommitProjectionRules.js', 'projectRoomBookingCommitPayload'],
    ['roomBookingPayloadRules.js', 'canonicalizeRoomBookingCommitPayload'],
    ['roomBookingPayloadDigest.js', 'computeRoomBookingPayloadDigest']
  ]) Object.assign(c, vm.runInContext(wrap(source(file), name), c));
  Object.assign(c, vm.runInContext(wrap(['roomAssignmentRules.js', 'roomAvailabilityRules.js', 'roomBookingCommitRules.js'].map(source).join('\n'), 'buildPhysicalCommitPlan,planPhysicalRollback'), c));
  if (text !== null) Object.assign(c, vm.runInContext(wrap(text, 'buildWholeCartAllocation'), c));
  vm.runInContext(`
    function fixture(quantities = [1,1,2]) {
      const codes = ['penthouse_apartment','two_bedroom_apartment','adventure_suite'];
      const groupRequests = [];
      for (let i=0;i<3;i++) if (quantities[i]) {
        const operationId = 'cartfixturegroup0' + i;
        const roomCode = codes[i], quantity = quantities[i];
        const checkIn = '2028-06-10', checkOut = '2028-06-12', bookingNumber = 'WC-CART-FIXTURE';
        const bookingRowIds = Array.from({length:quantity}, (_,n) => 'pb1-'+operationId+'-r'+(n+1));
        const payload = projectRoomBookingCommitPayload({operationId,bookingNumber,roomCode,checkIn,checkOut,bookingRowIds,guests:i===1?3:2,roomFee:0,note:''});
        groupRequests.push({operationId,bookingNumber,roomCode,quantity,checkIn,checkOut,payloadDigest:computeRoomBookingPayloadDigest(payload)});
      }
      return {inventorySnapshot:{occupiedUnits:[],occupiedUnitsByNight:{'2028-06-10':[],'2028-06-11':[]},migrationIssueRows:[],duplicateUnitClaims:[],unknownStatusRows:[]},claimLedger:[],groupRequests,primaryOperationId:groupRequests[groupRequests.length-1].operationId};
    }
    function requestFor(roomCode, quantity, operationId, checkIn='2028-06-10', checkOut='2028-06-12') {
      const bookingNumber='WC-CART-FIXTURE';
      const bookingRowIds=Array.from({length:quantity},(_,i)=>'pb1-'+operationId+'-r'+(i+1));
      const payload=projectRoomBookingCommitPayload({operationId,bookingNumber,roomCode,checkIn,checkOut,bookingRowIds,guests:roomCode==='two_bedroom_apartment'?3:2,roomFee:0,note:''});
      return {operationId,bookingNumber,payloadDigest:computeRoomBookingPayloadDigest(payload),checkIn,checkOut,roomCode,quantity};
    }
    function addBase(f, request) {
      const sub={...f.inventorySnapshot,occupiedUnitsByNight:{}};
      for(let d=new Date(request.checkIn+'T00:00:00Z');d.toISOString().slice(0,10)<request.checkOut;d.setUTCDate(d.getUTCDate()+1)) {
        const night=d.toISOString().slice(0,10); sub.occupiedUnitsByNight[night]=f.inventorySnapshot.occupiedUnitsByNight[night];
      }
      sub.occupiedUnits=[...new Set(Object.values(sub.occupiedUnitsByNight).flat())].sort((a,b)=>a-b);
      const p=buildPhysicalCommitPlan(sub,f.claimLedger,request);
      f.claimLedger.push(...p.acquisitions);
      for(const e of p.acquisitions) if(e.claimType==='unit') f.inventorySnapshot.occupiedUnitsByNight[e.night].push(e.unit);
      for(const list of Object.values(f.inventorySnapshot.occupiedUnitsByNight)) list.sort((a,b)=>a-b);
      f.inventorySnapshot.occupiedUnits=[...new Set(Object.values(f.inventorySnapshot.occupiedUnitsByNight).flat())].sort((a,b)=>a-b);
      return p;
    }
    function units(result) { return result.groupPlans.map(p=>p.bookingRows.map(r=>r.assignedRoom)); }
    function equal(a,b) { assert.strictEqual(JSON.stringify(a),JSON.stringify(b)); }
  `, c);
  return c;
}
const tests = [];
function test(name, code) { tests.push({name, code}); }
test('mixed P1/T1/A2 actual-core candidate with explicit Adventure primary', `
  const input = fixture(), before = JSON.stringify(input);
  assert.strictEqual(typeof buildWholeCartAllocation, 'function', 'whole-cart allocation export must exist');
  const result = buildWholeCartAllocation(input);
  equal(units(result), [[1],[2],[3,4]]);
  equal(result.groupPlans.map(p=>p.acquisitions.length), [5,5,9]);
  equal(result.groupPlans.map(p=>p.acquisitions.filter(e=>e.claimType==='capacity' && e.night==='2028-06-10').map(e=>e.capacitySlot)), [[1],[2],[3,4]]);
  equal(result.expectedRowIds, ['pb1-cartfixturegroup00-r1','pb1-cartfixturegroup01-r1','pb1-cartfixturegroup02-r1','pb1-cartfixturegroup02-r2']);
  assert.strictEqual(result.primaryRowId,'pb1-cartfixturegroup02-r1');
  assert.strictEqual(JSON.stringify(input), before);
  equal(Object.keys(result), ['groupPlans','expectedRowIds','primaryRowId']);
`);
test('request permutations preserve plans and explicit primary membership', `
  const f=fixture(); const expected=buildWholeCartAllocation(f);
  for (const order of [[2,1,0],[1,0,2],[0,2,1],[1,2,0],[2,0,1]]) {
    const x=fixture(); x.groupRequests=order.map(i=>x.groupRequests[i]);
    equal(buildWholeCartAllocation(x),expected);
  }
  for (const mutate of [x=>x.primaryOperationId='unknownoperation0',x=>x.groupRequests[1].bookingNumber='OTHER',x=>x.groupRequests[1].checkOut='2028-06-13',x=>x.groupRequests[0].quantity='1',x=>x.groupRequests.push(x.groupRequests[0]),x=>x.groupRequests[1].roomCode=x.groupRequests[0].roomCode,x=>x.groupRequests[1].operationId=x.groupRequests[0].operationId,x=>x.groupRequests=[]]) {
    const x=fixture(); mutate(x); assert.throws(()=>buildWholeCartAllocation(x));
  }
`);
test('strict own-data graph rejects accessors without invocation and extras', `
  let calls=0; const x=fixture();
  Object.defineProperty(x.inventorySnapshot,'occupiedUnits',{get(){calls++; return [];},enumerable:true,configurable:true});
  assert.throws(()=>buildWholeCartAllocation(x), /Invalid whole-cart allocation/);
  assert.strictEqual(calls,0);
  for (const mutate of [x=>x.extra=1,x=>x.groupRequests[0].extra=1,x=>x.inventorySnapshot.rows=[],x=>delete x.groupRequests[1],x=>x.claimLedger.extra=1,x=>x.groupRequests[0].payloadDigest={toString(){throw Error('coercion');}},x=>Object.setPrototypeOf(x,{})]) {
    const f=fixture(); mutate(f); assert.throws(()=>buildWholeCartAllocation(f), /Invalid whole-cart allocation/);
  }
  const f=fixture(); let scans=0;
  f.groupRequests[0]=new Proxy(f.groupRequests[0],{getOwnPropertyDescriptor(t,k){const d=Reflect.getOwnPropertyDescriptor(t,k); if(k==='quantity' && ++scans===2) d.value=3; return d;}});
  assert.throws(()=>buildWholeCartAllocation(f), /Invalid whole-cart allocation/);
`);
test('caller traps cannot poison unchanged core intrinsic dispatch', `
  const f=fixture(); const original=Array.prototype.map; let error;
  const restore=Object.defineProperty;
  f.groupRequests[0]=new Proxy(f.groupRequests[0],{ownKeys(t){Array.prototype.map=function(){return [];}; return Reflect.ownKeys(t);}});
  try { buildWholeCartAllocation(f); } catch(e) { error=e; }
  finally { restore(Array.prototype,'map',{value:original,writable:true,enumerable:false,configurable:true}); }
  assert.ok(error); assert.strictEqual(error.constructor,Error);
  assert.strictEqual(error.message,'Invalid whole-cart allocation');
`);
// Baseline regression coverage of an existing implementation, not invented TDD RED.
// All amounts in requestFor/fixture are synthetic test-only contract inputs.
for (const [q, expected] of [
  [[1,0,0],[[1]]], [[0,1,0],[[2]]],
  [[0,0,1],[[3]]], [[0,0,2],[[3,4]]], [[0,0,3],[[3,4,5]]],
  [[1,1,0],[[1],[2]]],
  [[1,0,1],[[1],[3]]], [[1,0,2],[[1],[3,4]]], [[1,0,3],[[1],[3,4,5]]],
  [[0,1,1],[[2],[3]]], [[0,1,2],[[2],[3,4]]], [[0,1,3],[[2],[3,4,5]]],
  [[1,1,1],[[1],[2],[3]]], [[1,1,2],[[1],[2],[3,4]]]
]) test('supported topology '+q.join('/'), `
  const f=fixture(${JSON.stringify(q)}), before=JSON.stringify(f);
  let result;
  assert.doesNotThrow(()=>{result=buildWholeCartAllocation(f);}, 'valid topology must allocate');
  equal(units(result),${JSON.stringify(expected)});
  const oracle=fixture(${JSON.stringify(q)});
  equal(result.groupPlans,oracle.groupRequests.map(r=>addBase(oracle,r)));
  for(const p of result.groupPlans) equal(Object.keys(p),['acquisitions','bookingRows','primaryRowId']);
  const keys=result.groupPlans.flatMap(p=>p.acquisitions.map(e=>e.claimKey));
  assert.strictEqual(new Set(keys).size,keys.length,'cart claim keys are unique');
  equal(result.expectedRowIds,result.groupPlans.flatMap(p=>p.bookingRows.map(r=>r._id)));
  const ids=result.groupPlans.flatMap(p=>p.acquisitions.map(e=>e._id));
  assert.strictEqual(new Set(ids).size,ids.length,'cart acquisition IDs are unique');
  assert.strictEqual(new Set(result.expectedRowIds).size,result.expectedRowIds.length);
  equal(JSON.stringify(f),before);
`);
test('capacity five rejects without mutating caller evidence', `
  const f=fixture([1,1,3]), before=JSON.stringify(f);
  assert.throws(()=>buildWholeCartAllocation(f),/Physical room assignment unavailable/);
  equal(JSON.stringify(f),before);
`);
test('base occupied evidence advances both overlays and retains slots', `
  const f=fixture([0,1,1]);
  addBase(f,requestFor('penthouse_apartment',1,'basepenthouse0001'));
  const before=JSON.stringify(f); let result;
  assert.doesNotThrow(()=>{result=buildWholeCartAllocation(f);},'base plus cart overlays must remain in parity');
  equal(units(result),[[2],[3]]);
  equal(result.groupPlans.map(p=>p.acquisitions.filter(e=>e.claimType==='capacity').map(e=>e.capacitySlot)),[[2,2],[3,3]]);
  equal(JSON.stringify(f),before);
`);
test('snapshot ledger parity rejects missing evidence in both directions', `
  for(const direction of ['snapshot-only','ledger-only']) {
    const f=fixture([0,1,1]); addBase(f,requestFor('penthouse_apartment',1,'basepenthouse0001'));
    if(direction==='snapshot-only') f.claimLedger=[];
    else { f.inventorySnapshot.occupiedUnits=[]; for(const n of Object.keys(f.inventorySnapshot.occupiedUnitsByNight)) f.inventorySnapshot.occupiedUnitsByNight[n]=[]; }
    const before=JSON.stringify(f);
    assert.throws(()=>buildWholeCartAllocation(f),/Physical room assignment unavailable/,direction);
    equal(JSON.stringify(f),before);
  }
`);
test('nightly variation preserves union and per-night capacity choices', `
  const f=fixture([0,0,2]);
  addBase(f,requestFor('penthouse_apartment',1,'basepenthouse0001','2028-06-10','2028-06-11'));
  addBase(f,requestFor('two_bedroom_apartment',1,'basetwobedroom001','2028-06-10','2028-06-12'));
  const before=JSON.stringify(f); let result;
  assert.doesNotThrow(()=>{result=buildWholeCartAllocation(f);});
  equal(units(result),[[3,4]]);
  equal(result.groupPlans[0].acquisitions.filter(e=>e.claimType==='capacity').map(e=>[e.night,e.capacitySlot]),[['2028-06-10',3],['2028-06-10',4],['2028-06-11',2],['2028-06-11',3]]);
  equal(JSON.stringify(f),before);
`);
test('all diagnostics fail closed without discarding original evidence', `
  for(const key of ['migrationIssueRows','duplicateUnitClaims','unknownStatusRows']) {
    const f=fixture(); f.inventorySnapshot[key]=[{_id:'synthetic-diagnostic'}];
    const before=JSON.stringify(f); assert.throws(()=>buildWholeCartAllocation(f),new RegExp({migrationIssueRows:'Inventory migration required',duplicateUnitClaims:'Inventory conflict review required',unknownStatusRows:'Inventory status review required'}[key])); equal(JSON.stringify(f),before);
  }
`);
test('existing operation requires reconciliation and identity conflicts reject', `
  for(const conflict of [false,true]) {
    const f=fixture([0,1,0]); addBase(f,f.groupRequests[0]);
    if(conflict) f.groupRequests[0].payloadDigest='a'.repeat(64);
    assert.throws(()=>buildWholeCartAllocation(f),conflict?/Operation identity conflict/:/Operation requires reconciliation/);
  }
`);
test('released real-core resource history advances generations', `
  const f=fixture([1,0,1]);
  const old=buildPhysicalCommitPlan(f.inventorySnapshot,[],requestFor('penthouse_apartment',1,'releasedhistory01'));
  // Synthetic legacy completion envelope; resources and releases use actual core exports.
  delete old.acquisitions[0].decisionFenceVersion;
  const identity=old.acquisitions[0];
  const completion={_id:'rc1-op-'+identity.operationId+'-c',protocolVersion:1,claimKey:'operation:'+identity.operationId+':completion',generation:1,eventType:'complete',claimType:'operation-completion',operationId:identity.operationId,bookingRowId:identity.bookingRowId,bookingNumber:identity.bookingNumber,payloadDigest:identity.payloadDigest,completionState:'complete',confirmedResourceCount:old.acquisitions.length-1};
  f.claimLedger=[...old.acquisitions,completion,...planPhysicalRollback(old.acquisitions,'synthetic-test-compensation')];
  const before=JSON.stringify(f); let result;
  assert.doesNotThrow(()=>{result=buildWholeCartAllocation(f);});
  equal(units(result),[[1],[3]]);
  equal(result.groupPlans[0].acquisitions.slice(1).map(e=>e.generation),[2,2,2,2]);
  equal(result.groupPlans[1].acquisitions.slice(1).map(e=>e.generation),[1,1,1,1]);
  equal(JSON.stringify(f),before);
  const bad=JSON.parse(before); bad.claimLedger.pop();
  assert.throws(()=>buildWholeCartAllocation(bad));
`);
test('envelope and group membership fail with planner diagnostics', `
  for(const mutate of [
    f=>delete f.primaryOperationId, f=>f.primaryOperationId=null,
    f=>f.primaryOperationId='notamember000001',f=>f.claimLedger={},f=>f.groupRequests={},
    f=>f.groupRequests.push(requestFor('penthouse_apartment',1,'differentgroup01')),
    f=>f.groupRequests[1].checkIn='2028-06-09',f=>f.groupRequests[1].bookingNumber='OTHER',
    f=>f.groupRequests[0].operationId=f.groupRequests[1].operationId,
    f=>f.groupRequests[0].roomCode='unknown',f=>f.groupRequests[0].quantity=0,
    f=>f.groupRequests[0].quantity=2,f=>f.groupRequests[2].quantity=4,
    f=>f.groupRequests[2].quantity=1.5,f=>f.groupRequests[0].quantity=NaN,
    f=>f.groupRequests[0].quantity=Infinity,
    f=>{f.groupRequests=[requestFor('adventure_suite',1,'firstadventure01'),requestFor('adventure_suite',1,'otheradventure01')];f.primaryOperationId='firstadventure01';}
  ]) { const f=fixture(); mutate(f); assert.throws(()=>buildWholeCartAllocation(f),/Invalid whole-cart allocation/); }
`);
test('malformed core evidence and canonical snapshot nights reject', `
  for(const mutate of [
    f=>f.claimLedger.push({}), f=>f.groupRequests[0].operationId='short',
    f=>f.groupRequests[0].payloadDigest='A'.repeat(64),f=>f.groupRequests[0].bookingNumber=' padded ',
    f=>delete f.inventorySnapshot.occupiedUnitsByNight['2028-06-11'],
    f=>f.inventorySnapshot.occupiedUnitsByNight['2028-06-12']=[],
    f=>f.inventorySnapshot.occupiedUnitsByNight['2028-6-10']=[],
    f=>f.inventorySnapshot.occupiedUnits=[1],
    f=>f.inventorySnapshot.occupiedUnitsByNight['2028-06-10']=[2,1],
    f=>f.inventorySnapshot.occupiedUnitsByNight['2028-06-10']=[1,1],
    f=>f.inventorySnapshot.occupiedUnitsByNight['2028-06-10']=[6]
  ]) { const f=fixture([1,0,0]); mutate(f); assert.throws(()=>buildWholeCartAllocation(f)); }
  const f=fixture([0,1,0]); addBase(f,requestFor('penthouse_apartment',1,'basepenthouse0001'));
  for(const mutate of [x=>x.claimLedger.push(x.claimLedger[0]),x=>x.claimLedger[0].manifestResourceClaimIds='broken',x=>x.claimLedger[1].generation=2,x=>x.claimLedger.pop()]) {
    const x=JSON.parse(JSON.stringify(f)); mutate(x); assert.throws(()=>buildWholeCartAllocation(x));
  }
`);
test('canonical dates and bounded oversize stay reject', `
  for(const dates of [['2028-02-30','2028-03-02'],['2028-6-10','2028-06-12'],['2028-06-10T00:00:00Z','2028-06-12'],['2028-06-10','2028-06-10'],['2028-06-12','2028-06-10'],['2028-06-10','2031-06-10']]) {
    const f=fixture([1,0,0]); [f.groupRequests[0].checkIn,f.groupRequests[0].checkOut]=dates;
    assert.throws(()=>buildWholeCartAllocation(f),/Invalid commit dates/);
  }
  const f=fixture([1,0,0]);
  f.groupRequests=[requestFor('penthouse_apartment',1,'leapnightfixture','2028-02-28','2028-03-01')];
  f.primaryOperationId=f.groupRequests[0].operationId;
  f.inventorySnapshot.occupiedUnitsByNight={'2028-02-28':[],'2028-02-29':[]};
  equal(buildWholeCartAllocation(f).groupPlans[0].acquisitions.filter(e=>e.claimType==='unit').map(e=>e.night),['2028-02-28','2028-02-29']);
`);
test('outputs detach all object aliases and frozen input stays unchanged', `
  function objects(x, seen=new Set()) { if(x && typeof x==='object' && !seen.has(x)) {seen.add(x);for(const v of Object.values(x)) objects(v,seen);}return seen; }
  const f=fixture(), before=JSON.stringify(f);
  for(const x of objects(f)) Object.freeze(x);
  const first=buildWholeCartAllocation(f), second=buildWholeCartAllocation(f);
  const inputs=objects(f), previous=objects(first);
  for(const x of previous) assert.ok(!inputs.has(x),'no output-input object alias');
  for(const x of objects(second)) assert.ok(!previous.has(x),'no cross-call object alias');
  first.groupPlans[0].bookingRows[0].assignedRoom=5;
  first.expectedRowIds.push('mutated');first.groupPlans[0].acquisitions[0].manifestUnits='5';
  equal(buildWholeCartAllocation(f),second); equal(JSON.stringify(f),before);
  for(const primary of f.groupRequests) {
    const x=fixture();x.primaryOperationId=primary.operationId;
    assert.strictEqual(buildWholeCartAllocation(x).primaryRowId,'pb1-'+primary.operationId+'-r1');
  }
`);
test('Adventure single uses unit four but never falls back to five', `
  const f=fixture([0,0,1]); addBase(f,requestFor('adventure_suite',1,'baseadventure001'));
  equal(units(buildWholeCartAllocation(f)),[[4]]);
  const blocked=fixture([0,0,1]);addBase(blocked,requestFor('adventure_suite',2,'baseadventure002'));
  assert.throws(()=>buildWholeCartAllocation(blocked),/Physical room assignment unavailable/);
`);
test('manifest storage overflow is preserved below night-count limit', `
  const f=fixture([0,0,3]);
  const start=new Date('2028-01-01T00:00:00Z'), end=new Date(start);end.setUTCDate(end.getUTCDate()+450);
  f.groupRequests=[requestFor('adventure_suite',3,'manifestoverflow','2028-01-01',end.toISOString().slice(0,10))];
  f.primaryOperationId=f.groupRequests[0].operationId;
  f.inventorySnapshot.occupiedUnitsByNight={};
  for(let d=new Date(start);d<end;d.setUTCDate(d.getUTCDate()+1)) f.inventorySnapshot.occupiedUnitsByNight[d.toISOString().slice(0,10)]=[];
  assert.throws(()=>buildWholeCartAllocation(f),/Commit manifest exceeds storage limit/);
`);
test('decision-fenced released history accepted by core remains valid through planner', `
  const f=fixture([1,0,0]);
  const old=buildPhysicalCommitPlan(f.inventorySnapshot,[],requestFor('penthouse_apartment',1,'fencedhistory001'));
  const identity=old.acquisitions[0];
  const completion={_id:'rc1-op-'+identity.operationId+'-c',protocolVersion:1,claimKey:'operation:'+identity.operationId+':completion',generation:1,eventType:'complete',claimType:'operation-completion',operationId:identity.operationId,bookingRowId:identity.bookingRowId,bookingNumber:identity.bookingNumber,payloadDigest:identity.payloadDigest,completionState:'complete',confirmedResourceCount:old.acquisitions.length-1,decisionFenceVersion:1};
  const decision={_id:'rc1-op-'+identity.operationId+'-d',protocolVersion:1,claimKey:'operation:'+identity.operationId+':decision',generation:1,eventType:'decide',claimType:'operation-decision',operationId:identity.operationId,bookingRowId:identity.bookingRowId,bookingNumber:identity.bookingNumber,payloadDigest:identity.payloadDigest,decisionFenceVersion:1,operationIdentityId:identity._id,operationCompletionId:completion._id,manifestVersion:1,completionState:'complete',confirmedResourceCount:old.acquisitions.length-1,decisionState:'compensate'};
  f.claimLedger=[...old.acquisitions,completion,decision,...planPhysicalRollback(old.acquisitions,'synthetic-test-compensation')];
  const before=JSON.stringify(f); let direct,result;
  assert.doesNotThrow(()=>{direct=buildPhysicalCommitPlan(f.inventorySnapshot,f.claimLedger,f.groupRequests[0]);},'fixture must be valid to unchanged actual core');
  assert.doesNotThrow(()=>{result=buildWholeCartAllocation(f);},'planner must preserve valid decision-fenced history');
  equal(result.groupPlans,[direct]);equal(JSON.stringify(f),before);
  assert.strictEqual(Object.getPrototypeOf(decision),Object.prototype,'caller decision prototype unchanged');
  Object.setPrototypeOf(f.inventorySnapshot,null);
  equal(buildWholeCartAllocation(f).groupPlans,[direct]);
  assert.strictEqual(Object.getPrototypeOf(f.inventorySnapshot),null,'caller null prototype unchanged');
  Object.setPrototypeOf(decision,null);
  assert.throws(()=>buildPhysicalCommitPlan(f.inventorySnapshot,f.claimLedger,f.groupRequests[0]),/Invalid claim ledger/);
  assert.throws(()=>buildWholeCartAllocation(f),/Invalid claim ledger/,'invalid null-prototype decision must not be normalized');
  assert.strictEqual(Object.getPrototypeOf(decision),null);
`);
for (const field of ['get','set','value']) test('inherited descriptor '+field+' poisoning never invokes callbacks', `
  const f=fixture(), before=JSON.stringify(f);
  const define=Object.defineProperty, proto=Object.prototype;
  const saved=Object.getOwnPropertyDescriptor(proto,'${field}');
  const core=buildPhysicalCommitPlan;
  let callbacks=0, delegated=0, error;
  buildPhysicalCommitPlan=function(...args) { delegated++; return core(...args); };
  const poison=Object.create(null);
  poison.get=function() { callbacks++; return undefined; };
  poison.configurable=true;
  try {
    define(proto,'${field}',poison);
    try { buildWholeCartAllocation(f); } catch(e) { error=e; }
  } finally {
    delete proto['${field}'];
    if(saved) define(proto,'${field}',saved);
    buildPhysicalCommitPlan=core;
  }
  assert.strictEqual(callbacks,0,'inherited descriptor ${field} callback must not run');
  assert.strictEqual(delegated,0,'changed intrinsics must reject before core delegation');
  assert.ok(error,'changed intrinsics must fail closed');
  assert.strictEqual(error.message,'Invalid whole-cart allocation');
  equal(JSON.stringify(f),before);
`);
test('inherited value exploit cannot hide invalid ledger after binding check', `
  const f=fixture([0,1,0]);
  addBase(f,requestFor('penthouse_apartment',1,'otherexistingop001'));
  f.claimLedger[0].unexpectedBusinessField='forbidden';
  assert.throws(()=>buildPhysicalCommitPlan(f.inventorySnapshot,f.claimLedger,f.groupRequests[0]),/Invalid claim ledger/);
  const before=JSON.stringify(f), O=Object, def=Object.defineProperty, core=buildPhysicalCommitPlan;
  const request=f.groupRequests[0];
  let callbacks=0, keysCalls=0, delegated=0, result, error;
  buildPhysicalCommitPlan=function(...args) { delegated++; return core(...args); };
  f.groupRequests[0]=new Proxy(f.groupRequests[0],{ownKeys(t) {
    if(!O.getOwnPropertyDescriptor(O.prototype,'value')) def(O.prototype,'value',{configurable:true,get() {
      callbacks++; delete O.prototype.value;
      globalThis.Object=new Proxy(O,{get(target,key) {
        if(key==='keys') return function(x) { keysCalls++; return Reflect.ownKeys(x).filter(k=>k!=='unexpectedBusinessField'); };
        return Reflect.get(target,key);
      }});
      return undefined;
    }});
    return Reflect.ownKeys(t);
  }});
  try { result=buildWholeCartAllocation(f); } catch(e) { error=e; }
  finally { delete O.prototype.value; globalThis.Object=O; buildPhysicalCommitPlan=core; }
  assert.strictEqual(result,undefined,'invalid ledger exploit must not return a plan');
  assert.strictEqual(callbacks,0,'exploit callback must not run');
  assert.strictEqual(keysCalls,0,'attacker Object.keys must not run');
  assert.strictEqual(delegated,0,'exploit must reject before delegation');
  assert.ok(error); assert.strictEqual(error.message,'Invalid whole-cart allocation');
  // Inspect the proxy target without rerunning its poisoning ownKeys trap.
  f.groupRequests[0]=request;
  equal(JSON.stringify(f),before);
`);
function run(text, quiet=false, selected=tests) {
  const c = load(text);
  for (const t of selected) {
    try { vm.runInContext('(function(){'+t.code+'})()', c, {timeout:10000}); }
    catch (e) { e.caseName=t.name; throw e; }
    if (!quiet) console.log('PASS: '+t.name);
  }
  return selected.length;
}
// Mutants are exact, bounded in-memory substitutions, never production writes.
// Run the named witness green first, then require its causal ERR_ASSERTION.
function mutationChecks(text) {
  const mutants=[
    ['overlay-ledger', 'for(let i=0;i<plan.acquisitions.length;i++) append(ledger,plan.acquisitions[i]);', '', 'supported topology 1/1/0', /Got unwanted exception/],
    ['overlay-snapshot', 'if(plan.bookingRows[r].assignedRoom===unit) used=true;', 'if(false) used=true;', 'supported topology 1/1/0', /Got unwanted exception/],
    ['explicit-primary', 'if(request.operationId===data.primaryOperationId) primaryRowId=plan.primaryRowId;', 'primaryRowId=plan.primaryRowId;', 'outputs detach all object aliases and frozen input stays unchanged', /Expected values to be strictly equal/],
    ['canonical-sort', 'return ordered;', 'return requests;', 'request permutations preserve plans and explicit primary membership', /Expected values to be strictly equal/],
    ['row-id-uniqueness', 'append(expectedRowIds,plan.bookingRows[r]._id);', 'append(expectedRowIds,plan.bookingRows[0]._id);', 'supported topology 0/0/2', /Expected values to be strictly equal/],
    ['group-uniqueness', 'if(r.operationId===requests[j].operationId || r.roomCode===requests[j].roomCode) fail();', 'if(false) fail();', 'envelope and group membership fail with planner diagnostics', /regular expression|Missing expected exception/],
    ['envelope-guard', 'exact(input,ENVELOPE);', '', 'strict own-data graph rejects accessors without invocation and extras', /Missing expected exception/],
    ['membership-guard', 'if(!primary) fail();', '', 'request permutations preserve plans and explicit primary membership', /Missing expected exception/],
    ['stability-guard', 'stable(first,second);', '', 'strict own-data graph rejects accessors without invocation and extras', /Missing expected exception/],
    ['capture-prototype', 'copy=array?[]:create(proto);', 'copy=array?[]:create(null);', 'decision-fenced released history accepted by core remains valid through planner', /planner must preserve valid decision-fenced history/],
    ['put-descriptor-prototype', '{__proto__:null,value,enumerable:true,writable:true,configurable:true}', '{value,enumerable:true,writable:true,configurable:true}', 'inherited descriptor get poisoning never invokes callbacks', /inherited descriptor get callback must not run/],
    ['descriptor-own-fields', 'function descriptorEqual(a,b) {', 'function descriptorEqual(a,b) { return !!a && !!b && same(a.value,b.value) && a.get===b.get && a.set===b.set && a.enumerable===b.enumerable && a.configurable===b.configurable && a.writable===b.writable;', 'inherited value exploit cannot hide invalid ledger after binding check', /invalid ledger exploit must not return a plan/],
    ['intrinsic-guard', 'guardCoreIntrinsics();', '', 'caller traps cannot poison unchanged core intrinsic dispatch', /Expected values to be strictly equal/]
  ];
  for(const [name,from,to,witness,pattern] of mutants) {
    assert.strictEqual(text.split(from).length-1,1,'unique mutant anchor: '+name);
    const selected=tests.filter(t=>t.name===witness);assert.strictEqual(selected.length,1);
    run(text,true,selected);
    let failure;
    try {run(text.replace(from,to),true,selected);} catch(e) {failure=e;}
    assert.ok(failure,'mutant survived: '+name);
    assert.strictEqual(failure.code,'ERR_ASSERTION','not a behavioral assertion: '+name);
    assert.strictEqual(failure.caseName,witness,'unexpected witness: '+name);
    assert.match(failure.message,pattern,'not causal witness: '+name);
    console.log('KILLED: '+name+' | ERR_ASSERTION | '+witness+' | '+failure.message.split('\n')[0]);
  }
  console.log('MUTANT COUNT: '+mutants.length);
}
try {
  const text=fs.existsSync(target) ? fs.readFileSync(target,'utf8') : null;
  let passed=0, failed=0;
  for(const t of tests) {
    try {passed+=run(text,false,[t]);}
    catch(e) {failed++; console.error('FAIL: '+e.caseName+'\n'+e.stack);}
  }
  console.log('CASE COUNT: '+tests.length+' | PASS COUNT: '+passed+' | FAIL COUNT: '+failed);
  mutationChecks(text);
  console.log('SOURCE SHA256: '+crypto.createHash('sha256').update(text).digest('hex'));
  if(failed) process.exitCode=1;
} catch(e) { console.error('FAIL: '+e.caseName+'\n'+e.stack); process.exitCode=1; }
