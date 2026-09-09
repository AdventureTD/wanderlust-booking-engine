// Ordinary frozen WR contract. Actual persistence; inert financial verification and SDK.
// WR01 correction: adventure fee 0, penthouse fee 0.25. Never change writer pricing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const db = { Packages: [{ _id: 'public-package', numberOfNights: 1, baseRate: 10, priceModifier: 1 }], Rooms: [{ _id: 'public-room', roomCode: 'adventure_suite', roomFee: 0.25 }, { _id: 'public-penthouse', roomCode: 'penthouse_apartment', roomFee: 0.25 }] };
const trace = [];
let readFault = null;
let sequence = 0;
const clone = value => structuredClone(value);
const sdk = {
  query(collection) {
    const filters = []; let maximum = 1000; let sort = null;
    const q = {
      eq(k, v) { filters.push(r => r[k] === v); return q; },
      ne(k, v) { filters.push(r => r[k] !== v); return q; },
      lt(k, v) { filters.push(r => r[k] < v); return q; },
      le(k, v) { filters.push(r => r[k] <= v); return q; },
      gt(k, v) { filters.push(r => r[k] > v); return q; },
      ge(k, v) { filters.push(r => r[k] >= v); return q; },
      hasSome(k, values) { filters.push(r => values.includes(r[k])); return q; },
      ascending(k) { sort = [k, 1]; return q; },
      descending(k) { sort = [k, -1]; return q; },
      limit(n) { maximum = n; return q; },
      async find() {
        trace.push(['find', collection]);
        if (readFault && readFault.collection === collection) { if (readFault.error) throw Error('ordinary transport failure'); return {items: clone(readFault.items), hasNext() { return readFault.more; }}; }
        let rows = (db[collection] || []).filter(r => filters.every(f => f(r)));
        if (sort) rows = [...rows].sort((a, b) => (a[sort[0]] < b[sort[0]] ? -1 : a[sort[0]] > b[sort[0]] ? 1 : 0) * sort[1]);
        const more = rows.length > maximum;
        return { items: clone(rows.slice(0, maximum)), hasNext() { return more; } };
      }
    };
    return q;
  },
  async insert(collection, row) {
    const stored = { ...clone(row), _id: `public-${String(++sequence).padStart(4, '0')}` };
    (db[collection] ||= []).push(stored); trace.push(['insert', collection, clone(stored)]); return clone(stored);
  },
  async update(collection, row) {
    const index = (db[collection] || []).findIndex(r => r._id === row._id);
    assert.notEqual(index, -1); db[collection][index] = clone(row); trace.push(['update', collection, clone(row)]); return clone(row);
  },
  async get(collection, id) { return clone((db[collection] || []).find(r => r._id === id)); },
  async remove() { throw Error('Unexpected fixture removal'); }
};
const forbidden = () => { throw Error('Forbidden external effect'); };
const stubs = {
  'wix-data': { default: sdk },
  'wix-web-module': { Permissions: { Anyone: 'Anyone', Admin: 'Admin' }, webMethod: (_, fn) => fn },
  'wix-fetch': { fetch: forbidden },
  'wix-users-backend': { currentUser: {loggedIn: true, getRoles: async () => [{title: 'Admin'}]} },
  'backend/search.web': { searchAvailability: forbidden },
  'wix-secrets-backend': { getSecret: forbidden },
  'backend/settings.web': { getAllSettings: async () => ({}), incrementSetting: async () => ++sequence },
  'backend/googleAdsConversions.web': { adjustBookingConversion: forbidden, isGoogleAdsSuspended: async () => true },
  'backend/pricingQuote': { verifyLockedPricingQuote: async () => ({ packageId: 'public-package', packageTitle: 'Public fixture', baseRate: 10, priceModifier: 1, totalPerPerson: 10 }) }
};
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  let mod;
  if (stubs[name]) {
    const exports = stubs[name];
    mod = new vm.SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); });
  } else {
    assert.match(name, /^backend\/[A-Za-z0-9.]+$/);
    const filename = path.join(root, 'velo', `${name}.js`);
    mod = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { identifier: filename });
  }
  cache.set(name, mod); return mod;
}
// Isolated SDK contract only: no producer, receipt authority or runtime admission.
function terminalSdkDatabase() { return new Map(); }
function terminalSdkWorker(storage, hooks = {}) {
  return {
    async insert(collection, row) {
      const stored = clone(row);
      if (!storage.has(collection)) storage.set(collection, new Map());
      if (storage.get(collection).has(stored._id)) throw Error('immutable duplicate');
      storage.get(collection).set(stored._id, stored);
      if (hooks.after) await hooks.after(collection, clone(stored));
      return clone(stored);
    },
    async get(collection, id) { return clone(storage.get(collection)?.get(id)); }
  };
}
async function terminalSdkFixtureCases() {
  const ids = [];
  const mark = id => { ids.push(id); console.log('TERMINAL SDK PASS ' + id); };
  {
    const storage = terminalSdkDatabase(), worker = terminalSdkWorker(storage);
    const row = {_id: 'fixture-custom-id', nested: {value: 1}, when: new Date('2030-01-01T00:00:00Z')};
    const ack = await worker.insert('FixtureRows', row);
    assert.equal(ack._id, row._id, 'terminal SDK must preserve caller IDs');
    row.nested.value = 2; ack.nested.value = 3; ack.when.setUTCFullYear(2040);
    const read = await worker.get('FixtureRows', row._id);
    assert.equal(read.nested.value, 1); assert.equal(read.when.getUTCFullYear(), 2030);
    read.nested.value = 4;
    assert.equal((await worker.get('FixtureRows', row._id)).nested.value, 1);
    assert.equal(await worker.get('FixtureRows', 'absent'), undefined);
    mark('SDK01/custom-id-detached-native-readback');
  }
  {
    const storage = terminalSdkDatabase(), first = terminalSdkWorker(storage), second = terminalSdkWorker(storage);
    const winner = {_id: 'same-id', nested: {value: 'winner'}};
    await first.insert('FixtureRows', winner);
    await assert.rejects(second.insert('FixtureRows', winner), /immutable duplicate/);
    await assert.rejects(second.insert('FixtureRows', {...winner, nested: {value: 'conflict'}}), /immutable duplicate/);
    assert.deepEqual(await second.get('FixtureRows', winner._id), winner);
    assert.equal(storage.get('FixtureRows').size, 1);
    await second.insert('OtherFixtureRows', {...winner, nested: {value: 'other collection'}});
    await first.insert('FixtureRows', {_id: 'different-id'});
    assert.equal(storage.get('FixtureRows').size, 2);
    assert.deepEqual(await first.get('FixtureRows', winner._id), winner);
    assert.equal((await first.get('OtherFixtureRows', winner._id)).nested.value, 'other collection');
    mark('SDK02/duplicate-conflict-collection-local-winner');
  }
  {
    const storage = terminalSdkDatabase(), expected = {_id: 'lost-ack-id', nested: {value: 'retained'}};
    let afterCalls = 0;
    const failing = terminalSdkWorker(storage, {after: async (collection, row) => {
      afterCalls++; assert.equal(collection, 'FixtureRows');
      row.nested.value = 'hook mutation'; throw Error('lost ACK');
    }});
    await assert.rejects(failing.insert('FixtureRows', expected), /lost ACK/);
    const fresh = terminalSdkWorker(storage);
    assert.notEqual(fresh, failing);
    assert.deepEqual(await fresh.get('FixtureRows', expected._id), expected);
    await assert.rejects(failing.insert('FixtureRows', {...expected, nested: {value: 'conflict'}}), /immutable duplicate/);
    assert.equal(afterCalls, 1); assert.equal(storage.get('FixtureRows').size, 1);
    assert.deepEqual(await fresh.get('FixtureRows', expected._id), expected);
    assert.equal(fresh.update, undefined); assert.equal(fresh.remove, undefined); assert.equal(fresh.save, undefined);
    mark('SDK03/lost-ack-fresh-worker-retained-winner');
  }
  assert.equal(ids.length, 3); assert.equal(new Set(ids).size, ids.length);
  assert.equal(cache.size, 0, 'fixture-only cases never load runtime modules');
  assert.deepEqual(trace, [], 'legacy SDK remains untouched');
  console.log(JSON.stringify({fixtureOnly: true, ids, runtimeLoaded: false, persistenceEvidence: false}));
}
// B08.3/B08.4 authored for actual producer records; NOT RUN pending D1 admission.
async function terminalProducerReaderCases() {
  const {actualProducerCases}=require('./verify-guest-booking-completion-terminal');
  const {db,T,prefixes,end,fixtures}=await actualProducerCases();
  const I=T[6][0].acquisitions[0],ci=I.manifestCheckIn,co=I.manifestCheckOut;
  for(const rows of [...prefixes.filter(r=>r.Bookings.length),end]){
    db.rows=fixtures.plain(rows);const s=fixtures.subject(db);
    const evidence=await s.load('backend/guestBookingAllocationEvidence').readGuestBookingAllocationEvidence(ci,co);
    assert.equal(evidence.status,'READY');
    const rules=s.load('backend/guestBookingAllocationSourceRules');
    const constraints=rules.allocationConstraintsFromSources(evidence.planningEvidence,ci,co);
    assert.equal(constraints.effectiveSnapshot.occupiedUnits.length,T[7].length);
    const request={operationId:'terminalrequest0000001',bookingNumber:'TERMINAL-FREE',payloadDigest:'1'.repeat(64),checkIn:ci,checkOut:co,roomCode:'penthouse_apartment',quantity:1};
    assert.throws(()=>s.load('backend/wholeCartPlanningRules').buildWholeCartAllocationFromSources(s.realm({planningEvidence:evidence.planningEvidence,groupRequests:[request],primaryOperationId:request.operationId})),/Physical room assignment unavailable/);
    assert.equal(s.trace.some(t=>t.op==='insert'),false);
  }
  for(const [field,value] of [['status','cancelled'],['status','confirmed'],['autoOwnerBlock',true],['operationId',undefined],['payloadDigest','0'.repeat(64)],['quantity',2],['_id','pb1-cg2_malformed-r1']]){
    db.rows=fixtures.plain(end);if(value===undefined)delete db.rows.Bookings[0][field];else db.rows.Bookings[0][field]=value;
    const s=fixtures.subject(db),e=await s.load('backend/guestBookingAllocationEvidence').readGuestBookingAllocationEvidence('2031-01-01','2031-01-02');
    if(e.status==='READY')assert.throws(()=>s.load('backend/guestBookingAllocationSourceRules').canonicalizeAllocationSources(e.planningEvidence,'2031-01-01','2031-01-02'));
    else assert.equal(e.status,'UNRESOLVED');
    assert.equal(s.trace.some(t=>t.op==='insert'),false);
  }
  return ['B08.3/actual-prefix-reader-planner','B08.4/global-reserved-outside-window'];
}
// RP additions are opt-in, authored NOTRUN until independent exact-byte admission.
// Never normalize raw storage for equality. This clone retains each fixture realm.
function readerPlannerRawCopy(value) {
  if (value === null || typeof value !== 'object') return value;
  const out = Array.isArray(value) ? new (Object.getPrototypeOf(value).constructor)() : Object.create(Object.getPrototypeOf(value));
  for (const key of Object.keys(value)) out[key] = readerPlannerRawCopy(value[key]);
  return out;
}
function readerPlannerFixtures() {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/guest-booking-r2-producer-prefix.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(require('node:crypto').createHash('sha256').update(text).digest('hex'), '97fa4ede51900253b49219b4ed2911641a77934a89830594bc04c04e5fda950b');
  return vm.runInNewContext(text + ';({database,subject,issue,plain})', {require, Buffer, console, __dirname});
}
async function readerPlannerSdkControls() {
  const fixtures = readerPlannerFixtures(), retained = fixtures.database();
  retained.rows.Bookings.length = 0; retained.rows.BookingSummary.length = 0;
  const worker = fixtures.subject(retained);
  assert.equal(worker.loadedBackendNames().length, 0);
  for (const [id, bookingNumber] of [['c','target'],['a','target'],['b','foreign'],['d','target']]) {
    await worker.wix.insert('Bookings', worker.realm({_id:id, bookingNumber, quantity:1}));
  }
  await assert.rejects(worker.wix.insert('Bookings', worker.realm({_id:'a', bookingNumber:'conflict'})), /immutable duplicate/);
  await worker.wix.insert('BookingSummary', worker.realm({_id:'a', bookingNumber:'other'}));
  const page = await worker.wix.query('Bookings').eq('bookingNumber','target').gt('_id','a').ascending('_id').limit(1).find();
  assert.equal(page.items.length, 1); assert.equal(page.items[0]._id, 'c'); assert.equal(page.hasNext(), true);
  const tail = await worker.wix.query('Bookings').eq('bookingNumber','target').gt('_id','c').ascending('_id').limit(1).find();
  assert.equal(tail.items.length, 1); assert.equal(tail.items[0]._id,'d'); assert.equal(tail.hasNext(),false);
  const before = readerPlannerRawCopy(retained.rows);
  page.items[0].quantity = 99;
  assert.deepEqual(retained.rows, before, 'SDK returns detached data');
  retained.rows.Bookings[0].quantity++;
  assert.throws(() => assert.deepEqual(retained.rows, before), assert.AssertionError, 'real stored-row mutation must fail strict comparison');
  retained.rows.Bookings[0].quantity--;
  assert.deepEqual(retained.rows, before);
  assert.equal(worker.loadedBackendNames().length, 0); assert.equal(cache.size,0); assert.equal(trace.length,0);
  const ids = ['RP-SDK01/conjunctive-keyset-custom-id','RP-SDK02/raw-realm-unchanged-and-mutation'];
  console.log(JSON.stringify({ids,fixtureOnly:true,runtimeLoaded:false})); return ids;
}
async function terminalReaderPlannerIntegrationCases() {
  // Existing producer executes its ordinary setup/assertions too: admit that exact
  // export closure separately. No default legacy web or arbitration suite entry.
  const {actualProducerCases} = require('./verify-guest-booking-completion-terminal');
  const {db,A,T,prefixes,end,fixtures,marks:producerSetupIds} = await actualProducerCases();
  const ids = [], mark = id => { assert.ok(!ids.includes(id)); ids.push(id); console.log('RP PASS '+id); };
  const identity = T[6][0].acquisitions[0], ci = identity.manifestCheckIn, co = identity.manifestCheckOut;
  const request = {operationId:'readerplannerrequest01',bookingNumber:'RP-FREE',payloadDigest:'1'.repeat(64),checkIn:ci,checkOut:co,roomCode:'two_bedroom_apartment',quantity:1};
  const active = rows => rows.RoomBookingClaimEvents.filter(r => r.eventType==='acquire' && ['unit','capacity'].includes(r.claimType) && !rows.RoomBookingClaimEvents.some(v=>v.eventType==='release'&&v.claimKey===r.claimKey&&v.generation===r.generation));
  const resources = rows => active(rows).map(r=>[r._id,r.claimKey,r.generation,r.operationId,r.payloadDigest,r.bookingNumber,r.bookingRowId,r.night,r.claimType,r.unit??null,r.capacitySlot??null].join('|')).sort();
  const plan = (s,e,roomCode='two_bedroom_apartment',operationId=request.operationId) => {
    // Allocate ONLY the envelope/request in the reader realm, retaining the actual
    // reader's native planningEvidence rather than laundering it through JSON.
    const input = s.realm({groupRequests:[{...request,roomCode,operationId}],primaryOperationId:operationId});
    input.planningEvidence=e.planningEvidence;
    return s.load('backend/wholeCartPlanningRules').buildWholeCartAllocationFromSources(input);
  };
  async function observe(rows, {deny=false,window=[ci,co],sameClass=false,free=true}={}) {
    db.rows=readerPlannerRawCopy(rows);
    const before=readerPlannerRawCopy(db.rows), workers=[], observations=[];
    for(let restart=0;restart<2;restart++) {
      const s=fixtures.subject(db); assert.equal(s.loadedBackendNames().length,0);
      const reader=s.load('backend/guestBookingAllocationEvidence'), source=s.load('backend/guestBookingAllocationSourceRules');
      if(workers.length){assert.notEqual(s.context,workers[0].s.context);assert.notEqual(reader,workers[0].reader);assert.notEqual(source,workers[0].source);assert.notEqual(reader.readGuestBookingAllocationEvidence,workers[0].reader.readGuestBookingAllocationEvidence);}
      const planner=s.load('backend/wholeCartPlanningRules');
      if(workers.length){assert.notEqual(planner,workers[0].planner);assert.notEqual(planner.buildWholeCartAllocationFromSources,workers[0].planner.buildWholeCartAllocationFromSources);}
      workers.push({s,reader,source,planner});
      const e=await reader.readGuestBookingAllocationEvidence(...window);
      if(deny){
        if(e.status==='READY') {
          assert.throws(()=>source.allocationConstraintsFromSources(e.planningEvidence,...window),/Unresolved allocation sources/);
          const input=s.realm({groupRequests:[{...request,checkIn:window[0],checkOut:window[1]}],primaryOperationId:request.operationId});input.planningEvidence=e.planningEvidence;
          assert.throws(()=>s.load('backend/wholeCartPlanningRules').buildWholeCartAllocationFromSources(input));
        } else assert.equal(e.status,'UNRESOLVED');
      } else {
        assert.equal(e.status,'READY');
        const constraints=source.allocationConstraintsFromSources(e.planningEvidence,...window);
        const expectedResources=resources(rows), actualResources=resources({RoomBookingClaimEvents:constraints.claimLedger});
        assert.deepEqual(Array.from(actualResources),Array.from(expectedResources),'complete retained capacity/unit identities');
        for(const night of Object.keys(constraints.effectiveSnapshot.occupiedUnitsByNight)) {
          const units=[...new Set(active(rows).filter(r=>r.claimType==='unit'&&r.night===night).map(r=>r.unit))].sort((a,b)=>a-b);
          assert.deepEqual(Array.from(constraints.effectiveSnapshot.occupiedUnitsByNight[night]),units,'exact per-night held/row union');
        }
        if(sameClass)assert.throws(()=>plan(s,e,'penthouse_apartment'),/Physical room assignment unavailable/);
        if(free){
          const allocation=plan(s,e), result=allocation.groupPlans[0];
          assert.equal(result.bookingRows.length,1);
          assert.equal(result.acquisitions.filter(r=>r.claimType==='capacity').length,Object.keys(constraints.effectiveSnapshot.occupiedUnitsByNight).length);
          for(const row of result.bookingRows)assert.equal(active(rows).some(r=>r.claimType==='unit'&&r.unit===row.assignedRoom),false);
          for(const r of result.acquisitions.filter(r=>r.claimType==='capacity')) {
            const used=active(rows).filter(v=>v.claimType==='capacity'&&v.night===r.night).map(v=>v.capacitySlot);
            let slot=1;while(used.includes(slot))slot++;
            assert.equal(r.capacitySlot,slot,'actual planner consumes held capacity even before any unit or Booking exists');
          }
        }
        observations.push(Array.from(actualResources));
      }
      assert.ok(s.trace.length>0);assert.equal(s.trace.every(t=>t.op==='find'),true,'find-only source/planner trace');
      assert.deepEqual(db.rows,before,'strict unchanged raw storage, no JSON normalization');
    }
    if(!deny)assert.deepEqual(observations[1],observations[0]);
  }
  assert.equal(end.GuestBookingAcceptances[0]._id,A); assert.match(end.GuestBookingAcceptances[0].operationId,/^[a-f0-9]{64}$/);
  assert.notEqual(T[8],T[7][0]);assert.deepEqual(Array.from(end.Bookings,r=>r._id),Array.from(T[7]));
  for(const row of end.Bookings){assert.match(row.operationId,/^cg2_/);assert.match(row._id,/-r[1-4]$/);assert.equal(row.status,'pending');}
  // One representative of each native terminal state, including zero rows with
  // fully committed holds, all row counts, Summary without receipt, and receipt.
  const terminal=prefixes.filter(p=>p.Bookings.length || (p.RoomBookingClaimEvents.filter(r=>r.claimType==='operation-decision'&&r.decisionState==='commit-rows').length===T[6].length));
  const selected=new Map();for(const p of [...terminal,end])selected.set(`${p.Bookings.length}/${p.BookingSummary.length}/${p.GuestBookingCompletions.length}`,p);
  assert.equal(selected.size,T[7].length+3);
  for(const [key,rows] of selected){assert.deepEqual(Array.from(resources(rows)),Array.from(resources(end)),'receipt and slim row materialization do not change retained occupancy');await observe(rows,{sameClass:true});mark('B08.3/RP/native-prefix/'+key);}
  const capacityOnly=prefixes.find(p=>p.Bookings.length===0&&active(p).some(r=>r.claimType==='capacity')&&!active(p).some(r=>r.claimType==='unit'));
  assert.ok(capacityOnly,'actual pre-unit capacity-only prefix required');
  await observe(capacityOnly);mark('B08.3/RP/capacity-only');
  // Separate owner-block seam; never change a reserved row to confirmed.
  const blocked=readerPlannerRawCopy(end), block=readerPlannerRawCopy(end.Bookings[0]);
  Object.assign(block,{_id:'RP-owner-block',bookingNumber:'RP-OWNER',status:'blocked',autoOwnerBlock:true});delete block.operationId;delete block.payloadDigest;
  blocked.Bookings.push(block);await observe(blocked,{sameClass:true});mark('B08.3/RP/owner-block-seam');
  // Active matching legacy seam uses a real planner's non-reserved proposal.
  // It is consistency evidence only, not a native terminal/completion producer.
  db.rows=readerPlannerRawCopy(end);const seam=fixtures.subject(db), ev=await seam.load('backend/guestBookingAllocationEvidence').readGuestBookingAllocationEvidence(ci,co);
  const proposed=plan(seam,ev,'two_bedroom_apartment','readerplannerlegacy01').groupPlans[0], legacy=readerPlannerRawCopy(end);
  for(const r of proposed.acquisitions)legacy.RoomBookingClaimEvents.push(readerPlannerRawCopy(r));
  for(const r of proposed.bookingRows){const row=readerPlannerRawCopy(r);row.status='confirmed';legacy.Bookings.push(row);}
  await observe(legacy,{sameClass:true,free:false});mark('B08.3/RP/active-matching-legacy-seam');
  // Foreign compatible history is issued/acquired over the retained native cart,
  // not merged from independently incompatible histories or promoted base rows.
  db.rows=readerPlannerRawCopy(end);
  const foreign=await fixtures.issue(db,[{roomCode:'two_bedroom_apartment',quantity:1,guests:3}]);
  let held=false;
  for(let n=0;n<80&&!held;n++){
    const s=fixtures.subject(db), result=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(foreign.A);
    assert.ok(['ACQUISITION_PENDING','COMPLETION_PENDING'].includes(result.status));assert.ok(s.trace.filter(t=>t.op==='insert').length<=1);
    held=active(db.rows).some(r=>r.claimType==='unit'&&r.bookingNumber!==end.Bookings[0].bookingNumber);
  }
  assert.ok(held);assert.deepEqual(db.rows.Bookings,end.Bookings);assert.deepEqual(db.rows.GuestBookingCompletions,end.GuestBookingCompletions);
  await observe(readerPlannerRawCopy(db.rows),{sameClass:true,free:false});mark('B08.3/RP/foreign-native-hold');
  const variants=[['status-cancelled','status','cancelled'],['status-confirmed','status','confirmed'],['owner-escape','autoOwnerBlock',true],['missing-operation','operationId',undefined],['payload','payloadDigest','0'.repeat(64)],['quantity','quantity',2],['malformed-row','_id','pb1-cg2_malformed-r1'],['row-ordinal','_id',end.Bookings[0]._id.replace(/-r[1-4]$/,'-r4')],['class','roomCode','two_bedroom_apartment'],['unit','assignedRoom',2],['check-in','checkIn','2027-01-02'],['check-out','checkOut','2027-01-04'],['booking-identity','bookingNumber','RP-FOREIGN'],['root-not-class','operationId',end.GuestBookingAcceptances[0].operationId]];
  for(const [label,field,value] of variants){
    const rows=readerPlannerRawCopy(end);if(value===undefined)delete rows.Bookings[0][field];else rows.Bookings[0][field]=value;
    await observe(rows,{deny:true,window:['2031-01-01','2031-01-02']});mark('B08.4/RP/outside-window/'+label);
  }
  assert.equal(new Set(ids).size,ids.length);
  return {ids,producerSetupIds,confirmationAuthority:false};
}
module.exports={terminalProducerReaderCases,terminalReaderPlannerIntegrationCases,readerPlannerSdkControls};
(async () => {
  if(require.main!==module)return;
  if (process.argv.includes('--reader-planner-sdk-only')) { await readerPlannerSdkControls(); return; }
  if (process.argv.includes('--terminal-reader-planner-only')) { console.log(JSON.stringify(await terminalReaderPlannerIntegrationCases())); return; }
  if (process.argv.includes('--terminal-sdk-fixture-only')) { await terminalSdkFixtureCases(); return; }
  const writer = load('backend/availability.web');
  await writer.link(name => load(name)); await writer.evaluate();
  const result = await writer.namespace.createBooking({ roomCode: 'adventure_suite', guests: 2, quantity: 1, checkIn: '2030-01-01', checkOut: '2030-01-02', packageId: 'public-package', pricingQuoteToken: 'public-inert-quote', guestName: 'Public Guest', guestEmail: 'fixture@example.invalid', guestPhone: '000', marketSource: 'fixture', note: 'ordinary note', gclid: 'public-gclid', gbraid: 'public-gbraid', wbraid: 'public-wbraid', msclkid: 'public-msclkid' });
  assert.equal(db.Bookings.length, 1); assert.equal(db.BookingSummary.length, 1);
  assert.ok(trace.some(t => t[0] === 'insert' && t[1] === 'Bookings'));
  assert.ok(trace.some(t => t[0] === 'insert' && t[1] === 'BookingSummary'));
  assert.ok(db.BookingSummary[0].bookingDate instanceof Date);
  assert.deepEqual(db.Bookings[0], result);
  const reader = load('backend/guestBookingAllocationEvidence');
  await reader.link(name => load(name)); await reader.evaluate();
  const beforeReads = trace.length;
  const evidence = await reader.namespace.readGuestBookingAllocationEvidence('2030-01-01', '2030-01-02');
  assert.ok(trace.slice(beforeReads).every(t => t[0] === 'find'));
  console.log(JSON.stringify({ fixture: 'WR01', classification: 'contract-prerequisite-check', actualWriterRoomFee: result.roomFee, configuredAdventureRoomFee: db.Rooms[0].roomFee, reader: evidence, booking: db.Bookings[0], summary: db.BookingSummary[0], writerInsertCollections: trace.filter(t => t[0] === 'insert').map(t => t[1]), executedUniqueIds: ['WR01'], completeContract: false }));
  assert.equal(result.roomFee, 0, 'WR01a authorized correction: actual adventure fee remains zero');
  assert.equal(evidence.status, 'READY', 'WR01a full actual writer metadata must pass raw boundary');
  const results = [];
  const passed = (id, variant) => { results.push({id,variant,status:'PASS'}); console.log(JSON.stringify(results.at(-1))); };
  const source = load('backend/guestBookingAllocationSourceRules'); await source.link(name => load(name)); await source.evaluate();
  const ci='2030-01-01', co='2030-01-02';
  const saved = () => clone(db);
  const restore = state => { for(const k of Object.keys(db))delete db[k]; Object.assign(db,clone(state)); };
  const empty = () => { for(const c of ['Bookings','BookingSummary','BookingInvoices','RoomBookingClaimEvents'])db[c]=[]; };
  const input = {roomCode:'adventure_suite',guests:2,quantity:1,checkIn:ci,checkOut:co,packageId:'public-package',pricingQuoteToken:'public-inert-quote',guestName:'Public Guest',guestEmail:'fixture@example.invalid',guestPhone:'000',marketSource:'fixture',note:'ordinary note',gclid:'public-gclid',gbraid:'public-gbraid',wbraid:'public-wbraid',msclkid:'public-msclkid'};
  const read = async (a=ci,b=co,api=reader.namespace) => { const start=trace.length,before=require('node:v8').serialize(db); const e=await api.readGuestBookingAllocationEvidence(a,b); assert.ok(trace.slice(start).every(t=>t[0]==='find'));assert.deepEqual(require('node:v8').serialize(db),before,'reader never mutates raw SDK rows or financial records');return e; };
  const ready = async (positive=false,a=ci,b=co) => {const e=await read(a,b);assert.equal(e.status,'READY');if(positive)source.namespace.canonicalizeAllocationSources(e.planningEvidence,a,b);else assert.throws(()=>source.namespace.canonicalizeAllocationSources(e.planningEvidence,a,b));return e;};
  const denied = async (reason='EVIDENCE') => {assert.deepEqual(await read(),{status:'UNRESOLVED',reason});};
  const bookingKeys=['_id','bookingNumber','status','checkIn','checkOut','assignedRoom','quantity','roomCode','autoOwnerBlock','operationId','payloadDigest'];
  const summaryKeys=['_id','bookingNumber','checkIn','checkOut'];
  const exact = e => {for(const [index,fields] of [[4,bookingKeys],[5,summaryKeys]])for(const row of e.planningEvidence[index])assert.deepEqual(Object.keys(row),fields.filter(k=>Object.hasOwn(row,k)));for(const [index,collection] of [[6,'Bookings'],[7,'BookingSummary']])assert.deepEqual(e.planningEvidence[index],db[collection].map(r=>[r._id,r._owner??null,r._createdDate?.getTime()??null,r._updatedDate?.getTime()??null]));};
  const adventure=saved(); exact(await ready());passed('WR01','adventure actual fee=0');
  empty();const penthouse=await writer.namespace.createBooking({...input,roomCode:'penthouse_apartment'});assert.equal(penthouse.roomFee,0.25);assert.ok(trace.some(t=>t[0]==='find'&&t[1]==='Rooms'));assert.deepEqual(penthouse,db.Bookings[0]);assert.ok(db.BookingSummary[0].bookingDate instanceof Date);exact(await ready());passed('WR01','penthouse actual fee=0.25');
  empty();await writer.namespace.blockRoom('adventure_suite',ci,co,1,'actual block note');assert.equal(db.Bookings.length,1);assert.equal(db.BookingSummary.length,1);assert.equal(Object.hasOwn(db.Bookings[0],'autoOwnerBlock'),false);await ready();passed('WR02','actual block');
  empty();await writer.namespace.createBooking({...input,quantity:2});assert.equal(db.Bookings[0].quantity,2);await ready();await ready(false,'2031-01-01','2031-01-02');passed('WR03','actual aggregate globally denied');
  restore(adventure);await writer.namespace.cancelBooking(db.Bookings[0]._id);assert.equal(db.Bookings[0].status,'Cancelled');assert.equal(db.BookingSummary[0].googleConversionUploaded,false);const cancelled=saved();await ready(true);passed('WR04','actual cancelled positive');
  const admin=load('backend/adminConsole.web');await admin.link(name=>load(name));await admin.evaluate();
  const a=await admin.namespace.adminUpdateBooking(db.Bookings[0].bookingNumber,{guestName:'Updated Public',guestEmail:'updated@example.invalid',guestPhone:'111'});assert.equal(a.ok,true);assert.equal(a.invoiceGenerated,false);for(const c of ['Bookings','BookingSummary']){assert.equal(db[c][0].guestName,'Updated Public');assert.deepEqual(db[c][0].checkIn,cancelled[c][0].checkIn);assert.equal(db[c][0].status,cancelled[c][0].status);}await ready(true);passed('WR05','actual admin contacts');
  restore(cancelled);Object.assign(db.BookingSummary[0],{googleConversionUploaded:true,microsoftConversionUploaded:true,googleConversionRetracted:true,microsoftConversionRetracted:true});await writer.namespace.cancelBooking(db.Bookings[0]._id);for(const k of ['googleConversionUploaded','microsoftConversionUploaded','googleConversionRetracted','microsoftConversionRetracted'])assert.equal(db.BookingSummary[0][k],true);assert.equal(db.BookingSummary[0].packageTitle,'Public fixture');const flagEvidence=await ready(true);db.BookingSummary[0].packageTitlle='historical spelling overlay';assert.deepEqual((await ready(true)).planningEvidence,flagEvidence.planningEvidence);passed('WR06','actual private summary refresh through cancel; historical spelling overlay');
  for(const owner of [undefined,'public-owner',null]){restore(cancelled);for(const c of ['Bookings','BookingSummary']){if(owner!==undefined)db[c][0]._owner=owner;db[c][0]._createdDate=new Date('2030-01-01T00:00:00Z');db[c][0]._updatedDate=new Date('2030-01-02T00:00:00Z');}exact(await ready(true));passed('WR07',String(owner));}
  restore(cancelled);const baseline=(await ready(true)).planningEvidence;Object.assign(db.Bookings[0],{note:'changed',guestName:'changed',guestEmail:'changed@example.invalid',guestPhone:null,roomFee:0.25});Object.assign(db.BookingSummary[0],{bookingDate:new Date('2030-02-01T12:00:00Z'),gclid:'changed',gbraid:'changed',wbraid:'changed',msclkid:'changed'});assert.equal(db.Bookings[0].roomFee,0.25);assert.deepEqual((await ready(true)).planningEvidence,baseline);passed('WR08','metadata independence');
  const bad=[['Bookings','inventoryOverride',true],['Bookings','note',{}],['Bookings','roomFee',[]],['Bookings','roomFee',Infinity],['BookingSummary','bookingDate',new Date(NaN)],['Bookings','_owner',1]];
  for(const [c,k,v] of bad){restore(cancelled);db[c][0][k]=v;if(v instanceof Date)assert.ok(Number.isNaN(db[c][0][k].getTime()));if(v===Infinity)assert.equal(db[c][0][k],Infinity);await denied();passed('WR09',k+':'+typeof v);}
  restore(cancelled);for(const k of ['guestName','guestEmail','guestPhone','marketSource','gclid','gbraid'])db.BookingSummary[0][k]='x'.repeat(59000);const small=Buffer.byteLength(JSON.stringify(db.BookingSummary));assert.ok(small<400000);await ready(true);db.BookingSummary[0].wbraid='x'.repeat(59000);const large=Buffer.byteLength(JSON.stringify(db.BookingSummary));assert.ok(large>400000);await denied('BUDGET');passed('WR10',JSON.stringify({small,large}));
  const dateVariants=[['noon',()=>{},true],['offset',()=>{db.Bookings[0].checkIn='2030-01-01T13:00:00+01:00';},true],['calendar',()=>{db.Bookings[0].checkIn='2030-02-30';},false],['null',()=>{db.Bookings[0].checkIn=null;},false],['absent fallback',()=>{delete db.Bookings[0].checkIn;},true],['duplicate fallback',()=>{delete db.Bookings[0].checkIn;db.BookingSummary.push({...db.BookingSummary[0],_id:'zz-summary'});},false],['conflicting fallback',()=>{delete db.Bookings[0].checkOut;db.Bookings[0].checkIn='2030-01-01T00:00:00Z';},false],['checkout boundary',()=>{},true]];
  for(const [name,mutate,ok] of dateVariants){restore(cancelled);mutate();if(ok)await ready(true,name==='checkout boundary'?co:ci,name==='checkout boundary'?'2030-01-03':co);else await denied();passed('WR11',name);}
  for(const status of ['hold','blocked','in-house','confirmed','unexpected','cancelled','canceled','pending','pending confirmation','checked-out']){empty();await writer.namespace.createBooking({...input,status});assert.equal(db.Bookings[0].status,status);await ready(['cancelled','canceled','pending','pending confirmation','checked-out'].includes(status));passed('WR12','actual '+status);}
  for(const [name,unit,quantity] of [['numeric',3,1],['string quantity',3,'1'],['wrong class',1,1],['missing',undefined,1]]){restore(adventure);Object.assign(db.Bookings[0],{quantity});if(unit!==undefined)db.Bookings[0].assignedRoom=unit;const e=await ready();assert.equal(e.inventorySnapshot.migrationIssueRows.length>0,name!=='numeric');passed('WR12','physical overlay '+name);}
  restore(adventure);db.Bookings[0].assignedRoom=3;const physical=await ready();assert.equal(physical.inventorySnapshot.migrationIssueRows.length,0);assert.deepEqual(physical.claimLedger,[]);passed('WR13','synthetic physical unclaimed; source denies');
  for(const fault of [{collection:'Bookings',error:true},{collection:'BookingSummary',error:true},{collection:'Bookings',items:cancelled.Bookings,more:true},{collection:'Bookings',items:[cancelled.Bookings[0],cancelled.Bookings[0]],more:false},{collection:'Bookings',items:[{...cancelled.Bookings[0],_id:'z'}, {...cancelled.Bookings[0],_id:'a'}],more:false}]){restore(cancelled);readFault=fault;await denied();readFault=null;passed('WR17',JSON.stringify({collection:fault.collection,error:!!fault.error,more:fault.more}));}
  restore(cancelled);const beforeRestart=await ready(true);cache.delete('backend/guestBookingAllocationEvidence');cache.delete('backend/guestBookingAllocationSourceRules');const fresh=load('backend/guestBookingAllocationEvidence');await fresh.link(name=>load(name));await fresh.evaluate();assert.notEqual(fresh,reader);assert.deepEqual(await read(ci,co,fresh.namespace),beforeRestart);passed('WR18-partial','WR04 reload only; WR14 retained database pending');
  // Reuse only ordinary public fixture declarations, never registered acceptance tests.
  const fixtureText=fs.readFileSync(path.join(__dirname,'verify-guest-booking-acceptance.js'),'utf8');
  const fixtureBoundary=fixtureText.indexOf("test('real issuer");
  assert.ok(fixtureBoundary>1000);
  const fixtureContext=vm.createContext({require,Buffer,console,__dirname});
  const fixtures=vm.runInContext(fixtureText.slice(0,fixtureBoundary)+';({durable,subject,input,prepared,plain})',fixtureContext);
  const retained=fixtures.durable();
  for(const c of ['GuestBookingAllocationManifests','GuestBookingAcquisitionControls','RoomBookingClaimEvents','Bookings','BookingSummary','GuestBookingCompletions'])retained.rows[c]=[];
  const actual=()=>{const s=fixtures.subject(retained);s.wix.insert=async(c,row)=>{s.state.trace.push({op:'insert',collection:c,id:row._id});assert.equal(retained.rows[c].some(r=>r._id===row._id),false);retained.rows[c].push(fixtures.plain(row));return s.realm(row);};return s;};
  const owner=actual(),purchase=fixtures.input();purchase.priceGroups=[{roomCode:'penthouse_apartment',quantity:1,guests:2}];
  const offer=await fixtures.prepared(owner,purchase);
  assert.equal((await owner.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule)).status,'ACCEPTED_PENDING');
  const acceptance=retained.rows.GuestBookingAcceptances[0];assert.equal(acceptance.capsule,offer.capsule);
  assert.equal((await owner.load('backend/guestBookingAllocationHandoff').handoffGuestBookingAllocation(acceptance._id)).status,'ALLOCATION_HANDOFF_PENDING');
  const manifest=JSON.parse(retained.rows.GuestBookingAllocationManifests[0].manifestCanonical),group=manifest[6][0],identity=group.acquisitions[0];
  const bound=2+5*manifest[6].length+3*manifest[6].reduce((n,g)=>n+g.acquisitions.length-1,0);
  for(let n=0;n<bound&&!retained.rows.RoomBookingClaimEvents.some(r=>r.claimType==='operation-decision');n++){
    const s=actual(),r=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(acceptance._id);
    assert.equal(r.status,'ACQUISITION_PENDING');assert.ok(s.state.trace.filter(t=>t.op==='insert').length<=1);
    assert.equal(retained.rows.Bookings.length,0);assert.equal(retained.rows.BookingSummary.length,0);
  }
  for(const row of group.acquisitions)assert.deepEqual(fixtures.plain(retained.rows.RoomBookingClaimEvents.find(r=>r._id===row._id)),fixtures.plain(row));
  const completion=retained.rows.RoomBookingClaimEvents.find(r=>r.claimType==='operation-completion');assert.ok(completion);assert.equal(completion.completionState,'complete');
  const decisions=retained.rows.RoomBookingClaimEvents.filter(r=>r.claimType==='operation-decision');assert.equal(decisions.length,1);
  const decision=decisions[0];assert.equal(decision.decisionState,'commit-rows');assert.equal(decision.completionState,'complete');
  assert.equal(decision.operationIdentityId,identity._id);assert.equal(decision.operationCompletionId,completion._id);assert.equal(decision.confirmedResourceCount,completion.confirmedResourceCount);
  assert.equal(retained.rows.GuestBookingCompletions.length,0,'commit decision is not a completion receipt');
  const tracerBytes=JSON.stringify(retained.rows);
  // Separate SDK database: producer-planned pending projection with actual complete
  // commit-decision evidence. NOT a native Booking insertion or completion receipt.
  restore(fixtures.plain(retained.rows));
  db.Bookings=[{...fixtures.plain(group.bookingRows[0]),status:'pending',note:'synthetic projected Booking seam',roomFee:0.25,guestName:'Public projection'}];
  const held=saved(),hci=identity.manifestCheckIn,hco=identity.manifestCheckOut;
  const planner=load('backend/wholeCartPlanningRules');await planner.link(name=>load(name));await planner.evaluate();
  const request={operationId:'writerreaderrequest0001',bookingNumber:'WR-FREE',payloadDigest:'1'.repeat(64),checkIn:hci,checkOut:hco,roomCode:'adventure_suite',quantity:1};
  const plan=(e,roomCode='adventure_suite')=>planner.namespace.buildWholeCartAllocationFromSources({planningEvidence:e.planningEvidence,groupRequests:[{...request,roomCode}],primaryOperationId:request.operationId});
  const constraints=async(api=reader.namespace,sourceApi=source.namespace)=>{
    const e=await read(hci,hco,api);assert.equal(e.status,'READY','WR14 raw READY precedes source validation');
    sourceApi.canonicalizeAllocationSources(e.planningEvidence,hci,hco);
    assert.throws(()=>plan(e,'penthouse_apartment'),/Physical room assignment unavailable/);
    const free=plan(e);assert.equal(free.groupPlans[0].bookingRows[0].assignedRoom,3);
    for(const r of free.groupPlans[0].acquisitions.filter(r=>r.claimType==='capacity'))assert.equal(r.capacitySlot,2);
    return e;
  };
  await constraints();assert.equal(JSON.stringify(retained.rows),tracerBytes);passed('WR14','actual acquisition; separate projected Booking; held denial and free capacity');
  const negatives=[
    ['missing capacity',()=>{const i=db.RoomBookingClaimEvents.findIndex(r=>r.claimType==='capacity');assert.ok(i>=0);db.RoomBookingClaimEvents.splice(i,1);}],
    ['changed unit',()=>{db.Bookings[0].assignedRoom=2;}],
    ['changed manifest row ID',()=>{const r=db.RoomBookingClaimEvents.find(r=>r.claimType==='operation');assert.equal(typeof r.manifestBookingRowIds,'string');r.manifestBookingRowIds='changed-manifest-row';}],
    ['compensated owner',()=>{const r=db.RoomBookingClaimEvents.find(r=>r._id===decision._id);assert.ok(r);assert.equal(r.decisionState,'commit-rows');r.decisionState='compensate';}]
  ];
  for(const [name,mutate] of negatives){restore(held);mutate();const start=trace.length,before=require('node:v8').serialize(db),e=await read(hci,hco);assert.equal(e.status,'READY');assert.throws(()=>source.namespace.canonicalizeAllocationSources(e.planningEvidence,hci,hco));assert.throws(()=>plan(e));assert.ok(trace.slice(start).every(t=>t[0]==='find'));assert.deepEqual(require('node:v8').serialize(db),before);passed('WR15',name);}
  const inventory=load('backend/roomInventory');await inventory.link(name=>load(name));await inventory.evaluate();
  const coordinator=load('backend/roomAvailability');await coordinator.link(name=>load(name));await coordinator.evaluate();
  const availabilityRules=load('backend/roomAvailabilityRules');
  delete stubs['backend/search.web'];cache.delete('backend/search.web');
  const search=load('backend/search.web');await search.link(name=>load(name));await search.evaluate();
  for(const [id,state] of [['WR01',adventure],['WR03',null]]){
    restore(adventure);if(state===null){empty();await writer.namespace.createBooking({...input,quantity:2});}
    const start=trace.length,before=require('node:v8').serialize(db);
    const snapshot=await inventory.namespace.loadInventorySnapshot(ci,co);assert.ok(snapshot.migrationIssueRows.length>0);
    assert.throws(()=>availabilityRules.namespace.maximumAutomaticQuantity(snapshot,'adventure_suite'),/Inventory migration required/);
    await assert.rejects(()=>coordinator.namespace.loadRoomAvailability(ci,co),/Inventory migration required/);
    const r=await search.namespace.searchAvailability(ci,'2030-01-05');assert.equal(r.ok,false);assert.equal(r.error,'Unable to check room availability. Please try again.');assert.deepEqual(r.results,[]);
    assert.ok(trace.slice(start).every(t=>t[0]==='find'));assert.deepEqual(require('node:v8').serialize(db),before);passed('WR16',id+' legacy reader issues/coordinator throws/Search generic error');
  }
  restore(adventure);db.Bookings=[3,4,5].map(unit=>({...clone(adventure.Bookings[0]),_id:'physical-'+unit,assignedRoom:unit}));
  const exhausted=await inventory.namespace.loadInventorySnapshot(ci,co);
  assert.deepEqual(availabilityRules.namespace.evaluateAutomaticAvailability(exhausted,'adventure_suite',1),{available:false,units:[],reason:'physical_units_unavailable'});
  assert.equal(availabilityRules.namespace.maximumAutomaticQuantity(exhausted,'adventure_suite'),0);
  assert.deepEqual((await coordinator.namespace.loadRoomAvailability(ci,co)).find(r=>r.roomCode==='adventure_suite'),{roomCode:'adventure_suite',available:false,maxQuantity:0});passed('WR16','synthetic exhausted units false/zero');
  const adjacent=await inventory.namespace.loadInventorySnapshot(co,'2030-01-03');assert.deepEqual(adjacent.occupiedUnits,[]);assert.equal(availabilityRules.namespace.maximumAutomaticQuantity(adjacent,'adventure_suite'),3);passed('WR16','active physical overlay exclusive checkout');
  for(const [label,state,a,b] of [['WR04',cancelled,ci,co],['WR14',held,hci,hco]]){
    restore(state);const before=await read(a,b),bytes=require('node:v8').serialize(db),start=trace.length;
    const oldReader=load('backend/guestBookingAllocationEvidence'),oldSource=load('backend/guestBookingAllocationSourceRules');
    cache.delete('backend/guestBookingAllocationEvidence');cache.delete('backend/guestBookingAllocationSourceRules');
    const newReader=load('backend/guestBookingAllocationEvidence');await newReader.link(name=>load(name));await newReader.evaluate();
    const newSource=load('backend/guestBookingAllocationSourceRules');await newSource.link(name=>load(name));await newSource.evaluate();
    assert.notEqual(newReader,oldReader);assert.notEqual(newSource,oldSource);assert.notEqual(newSource.namespace.canonicalizeAllocationSources,source.namespace.canonicalizeAllocationSources);
    const after=await read(a,b,newReader.namespace);assert.deepEqual(after,before);newSource.namespace.canonicalizeAllocationSources(after.planningEvidence,a,b);
    if(label==='WR14')await constraints(newReader.namespace,newSource.namespace);
    assert.ok(trace.slice(start).every(t=>t[0]==='find'));assert.deepEqual(require('node:v8').serialize(db),bytes);assert.equal(JSON.stringify(retained.rows),tracerBytes);passed('WR18',label+' fresh reader/source stable and zero effects');
  }
  const executedUniqueIds=[...new Set(results.filter(r=>r.id!=='WR18-partial').map(r=>r.id))].sort();
  assert.deepEqual(executedUniqueIds,Array.from({length:18},(_,i)=>'WR'+String(i+1).padStart(2,'0')));
  assert.equal(results.length,58);
  // Two preserved WR17 display labels coincide; ordinal case IDs retain both distinct static fixtures.
  const ordinals=new Map();for(const r of results){const n=(ordinals.get(r.id)||0)+1;ordinals.set(r.id,n);r.caseId=r.id+'-'+n;}
  assert.equal(new Set(results.map(r=>r.caseId)).size,results.length);
  console.log(JSON.stringify({results,executedUniqueIds,completeContract:true,restricted:{status:'NOT RUN',waived:false,creditedAsPass:false},notRun:[],partial:[]}));
})().catch(error => { console.error(error); process.exitCode = 1; });
