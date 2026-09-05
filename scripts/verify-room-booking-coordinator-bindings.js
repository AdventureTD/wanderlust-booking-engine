// Disconnected causal binding tests. No platform API, source edits, or live writes.
// node scripts/verify-room-booking-coordinator-bindings.js [--case ID]
// Mutation replay: MUTANT_SOURCE=... node --require .../preload.cjs this-script
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const digest = '1'.repeat(64);

// Same ordinary host-realm records and VM import seam as the existing verifier.
function load(observed) {
  const context = { Date, Object, Array, Error, Number, String, RegExp, Reflect,
    projectRoomBookingCommitPayload(input) {
      observed.projections++;
      return { rows: input.bookingRowIds.map((id, i) => ({
        guests: input.guests, roomFee: input.roomCode === 'penthouse_apartment' ? input.roomFee : 0,
        note: i === 0 ? input.note : ''
      })) };
    },
    computeRoomBookingPayloadDigest() { observed.digests++; return digest; }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'velo/backend/roomBookingCoordinator.js'), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace(/export async function /g, 'async function ') +
    '\nthis.commit = coordinatePhysicalBookingCommit;', context);
  // Use the actual literal-array prototype of the VM, not the injected host Array.
  // A caller can mutate shared intrinsics during its descriptor traps.
  const literalArrayPrototype = vm.runInContext('Object.getPrototypeOf([])', context);
  observed.armEmptyRead = () => Object.defineProperty(literalArrayPrototype, '0', {
    configurable: true, get() { observed.emptyReads++; return undefined; }
  });
  return context.commit;
}
function plan(options = {}) {
  const operationId = options.operationId ?? 'coordinatortrace01';
  const roomCode = options.roomCode ?? 'adventure_suite';
  const units = options.units ?? [3, 4];
  const bookingNumber = options.bookingNumber ?? 'WC-5001';
  const payloadDigest = options.payloadDigest ?? digest;
  const checkIn = '2027-11-05', checkOut = '2027-11-07';
  const ids = units.map((_, i) => 'pb1-' + operationId + '-r' + (i + 1));
  const bookingRows = units.map((assignedRoom, i) => ({ _id: ids[i], roomCode, assignedRoom,
    quantity: 1, checkIn, checkOut, bookingNumber, operationId, payloadDigest }));
  const resources = [];
  for (const claimType of ['capacity', 'unit']) for (const night of [checkIn, '2027-11-06']) {
    units.forEach((unit, i) => {
      const number = claimType === 'capacity' ? i + 1 : unit;
      resources.push({ _id: 'rc1-' + night.replace(/-/g, '') + '-' + (claimType === 'capacity' ? 's' : 'u') + number + '-000001-a',
        protocolVersion: 1, claimKey: claimType + ':' + night + ':' + number, generation: 1,
        eventType: 'acquire', claimType, night, [claimType === 'capacity' ? 'capacitySlot' : 'unit']: number,
        operationId, bookingRowId: ids[i], bookingNumber, payloadDigest });
    });
  }
  return { acquisitions: [{ _id: 'rc1-op-' + operationId + '-a', protocolVersion: 1,
    claimKey: 'operation:' + operationId, generation: 1, eventType: 'acquire', claimType: 'operation',
    operationId, bookingRowId: ids[0], bookingNumber, payloadDigest, decisionFenceVersion: 1,
    manifestVersion: 1, manifestCheckIn: checkIn, manifestCheckOut: checkOut,
    manifestRoomCode: roomCode, manifestUnits: units.join(','), manifestBookingRowIds: ids.join('|'),
    manifestResourceClaimIds: resources.map(e => e._id).join('|') }, ...resources], bookingRows, primaryRowId: ids[0] };
}
const cases = [];
function add(id, name, build, extra) { cases.push({ id, name, build, extra }); }
add(52, 'penthouse rejects unit 2', () => plan({ roomCode: 'penthouse_apartment', units: [2] }));
add(53, 'two-bedroom rejects unit 1', () => plan({ roomCode: 'two_bedroom_apartment', units: [1] }));
add(54, 'unknown room rejects valid adventure topology', () => plan({ roomCode: 'unknown_room' }));
add(55, 'unit 5 cannot stand alone', () => plan({ units: [5] }));
add(56, 'two adventure rows must use 3 and 4', () => plan({ units: [3, 5] }));
add(57, 'third adventure row must use 5', () => plan({ units: [3, 4, 6] }));
add(58, 'empty rows reject before inherited index lookup', observed => {
  const p = plan(); p.bookingRows = [];
  p.acquisitions = new Proxy(p.acquisitions, { ownKeys(target) {
    observed.armEmptyRead(); return Reflect.ownKeys(target);
  } });
  return p;
}, observed => assert.equal(observed.emptyReads, 0, 'empty local rows must not read inherited index 0'));
add(59, 'four rows reject without inspecting surplus row', observed => {
  const p = plan({ units: [3, 4, 5, 6] });
  p.bookingRows[3] = new Proxy(p.bookingRows[3], { getPrototypeOf(target) {
    observed.surplusReads++; return Reflect.getPrototypeOf(target);
  } });
  return p;
}, observed => assert.equal(observed.surplusReads, 0, 'surplus row must not be inspected'));
add(60, 'primary row ID is bound', () => { const p = plan(); p.primaryRowId = p.bookingRows[1]._id; return p; });
add(61, 'short operation ID rejects', () => plan({ operationId: 'short' }));
add(62, 'invalid source digest rejects before resource coercion', observed => {
  const p = plan({ payloadDigest: 'Z'.repeat(64) });
  p.acquisitions[1].generation = { toString() { observed.generationCoercions++; return '1'; } };
  return p;
}, observed => assert.equal(observed.generationCoercions, 0, 'invalid digest must not execute generation.toString'));
add(63, 'numeric booking number rejects', () => plan({ bookingNumber: 42 }));
add(64, 'empty booking number rejects', () => plan({ bookingNumber: '' }));
add(65, 'overlong booking number rejects', () => plan({ bookingNumber: 'B'.repeat(257) }));
add(66, 'row IDs must encode row position', () => {
  const p = plan(); const old = p.bookingRows[1]._id, replacement = 'unexpected-row-id';
  p.bookingRows[1]._id = replacement;
  for (const e of p.acquisitions) if (e.bookingRowId === old) e.bookingRowId = replacement;
  p.acquisitions[0].manifestBookingRowIds = p.bookingRows.map(r => r._id).join('|');
  return p;
});
const rowBindings = [
  [67, 'quantity', 2], [68, 'roomCode', 'penthouse_apartment'], [69, 'checkIn', '2027-11-04'],
  [70, 'checkOut', '2027-11-08'], [71, 'bookingNumber', 'WC-OTHER'],
  [72, 'operationId', 'otheroperation01'], [73, 'payloadDigest', '2'.repeat(64)]
];
for (const [id, field, value] of rowBindings) add(id, 'secondary row binds ' + field, () => {
  const p = plan(); p.bookingRows[1][field] = value; return p;
});
add(74, 'extra acquisition must not be silently dropped', () => {
  const p = plan(); p.acquisitions.push({ ...p.acquisitions[1] }); return p;
});
const identityBindings = [
  [75, '_id', 'wrong-identity-id'], [76, 'protocolVersion', 2], [77, 'claimKey', 'operation:other'],
  [78, 'generation', 2], [79, 'eventType', 'release'], [80, 'claimType', 'unit'],
  [81, 'operationId', 'otheroperation01'], [82, 'bookingRowId', 'wrong-row'],
  [83, 'bookingNumber', 'WC-OTHER'], [84, 'payloadDigest', '2'.repeat(64)],
  [85, 'decisionFenceVersion', 2], [86, 'manifestVersion', 2],
  [87, 'manifestCheckIn', '2027-11-04'], [88, 'manifestCheckOut', '2027-11-08'],
  [89, 'manifestRoomCode', 'penthouse_apartment'], [90, 'manifestUnits', '4,3'],
  [91, 'manifestBookingRowIds', 'wrong-row|other-row']
];
for (const [id, field, value] of identityBindings) add(id, 'identity binds ' + field, () => {
  const p = plan(); p.acquisitions[0][field] = value; return p;
});
async function exercise(test, valid = false) {
  const observed = { projections: 0, digests: 0, surplusReads: 0, emptyReads: 0, generationCoercions: 0, effects: [] };
  const commit = load(observed);
  const p = test.build(observed);
  const confirm = (items, key) => ({ state: 'CONFIRMED', confirmed: Array.from(items, e => ({ [key]: e._id, disposition: 'inserted' })) });
  const ports = {
    async appendClaimEvents(events) { observed.effects.push('claims'); return confirm(events, 'eventId'); },
    async appendRoomOperationDecision(id, decision) {
      observed.effects.push('decision');
      assert.equal(decision, 'commit-rows');
      return confirm([{ _id: 'rc1-op-' + id + '-d' }], 'eventId');
    },
    async appendBookingRows(rows) { observed.effects.push('rows'); return confirm(rows, 'rowId'); }
  };
  let error, result;
  try { result = await commit(p, { guests: 2, roomFee: 199, note: 'primary' }, ports); }
  catch (caught) { error = caught; }
  // Print observed causal trace BEFORE asserting, so mutation evidence includes effects.
  console.log(JSON.stringify({ id: test.id, name: test.name, error: error && error.message,
    returned: result && result._id, ...observed }));
  if (valid) {
    assert.equal(error, undefined);
    assert.equal(result._id, p.primaryRowId);
    assert.deepEqual(observed.effects, ['claims', 'decision', 'rows']);
  } else {
    assert.equal(error && error.message, 'Invalid coordinator plan', test.name);
    assert.deepEqual(observed.effects, [], test.name + ': no port I/O');
    if (test.extra) test.extra(observed);
  }
  console.log('PASS ' + test.id + ': ' + test.name);
}
(async () => {
  const at = process.argv.indexOf('--case');
  const selected = at < 0 ? cases : cases.filter(c => c.id === Number(process.argv[at + 1]));
  assert.ok(selected.length, 'unknown case');
  await exercise({ id: 'control', name: 'valid plan completes all three causal stages', build: () => plan() }, true);
  for (const test of selected) await exercise(test);
  console.log('PASS COUNT: ' + (selected.length + 1));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
