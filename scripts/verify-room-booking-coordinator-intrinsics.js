// Causal live-intrinsic dispatch regression tests; isolated realm per attack.
// node scripts/verify-room-booking-coordinator-intrinsics.js [--case NAME]
// No host intrinsic is modified. Fixtures and coordinator share their native realm.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../velo/backend/roomBookingCoordinator.js'), 'utf8')
  .replace(/^import .*;\s*$/gm, '').replace(/export async function /g, 'async function ');
const fixtures = String.raw`
function days(checkIn, count) {
  const start = Date.parse(checkIn + 'T00:00:00.000Z');
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10));
}
function makePlan(options) {
  const operationId = options.operationId || 'coordinatortrace01';
  const roomCode = options.roomCode || 'adventure_suite';
  const units = options.units || [3];
  const checkIn = options.checkIn || '2027-11-05';
  const checkOut = options.checkOut || '2027-11-07';
  const bookingNumber = options.bookingNumber || 'WC-5001';
  const payloadDigest = options.payloadDigest || '1'.repeat(64);
  const rowIds = units.map((unit, index) => 'pb1-' + operationId + '-r' + (index + 1));
  const rows = units.map((unit, index) => ({
    _id: rowIds[index], roomCode, assignedRoom: unit, quantity: 1,
    checkIn, checkOut, bookingNumber, operationId, payloadDigest
  }));
  const stayDays = days(checkIn, (Date.parse(checkOut) - Date.parse(checkIn)) / 86400000);
  const resources = [];
  stayDays.forEach(night => units.forEach((unit, rowIndex) => resources.push({
    _id: 'rc1-' + night.replace(/-/g, '') + '-s' + (rowIndex + 1) + '-000001-a',
    protocolVersion: 1, claimKey: 'capacity:' + night + ':' + (rowIndex + 1), generation: 1,
    eventType: 'acquire', claimType: 'capacity', night, capacitySlot: rowIndex + 1,
    operationId, bookingRowId: rowIds[rowIndex], bookingNumber, payloadDigest
  })));
  stayDays.forEach(night => units.forEach((unit, rowIndex) => resources.push({
    _id: 'rc1-' + night.replace(/-/g, '') + '-u' + unit + '-000001-a',
    protocolVersion: 1, claimKey: 'unit:' + night + ':' + unit, generation: 1,
    eventType: 'acquire', claimType: 'unit', night, unit,
    operationId, bookingRowId: rowIds[rowIndex], bookingNumber, payloadDigest
  })));
  return {
    acquisitions: [{
      _id: 'rc1-op-' + operationId + '-a', protocolVersion: 1,
      claimKey: 'operation:' + operationId, generation: 1, eventType: 'acquire',
      claimType: 'operation', operationId, bookingRowId: rowIds[0], bookingNumber,
      payloadDigest, decisionFenceVersion: 1, manifestVersion: 1,
      manifestCheckIn: checkIn, manifestCheckOut: checkOut, manifestRoomCode: roomCode,
      manifestUnits: units.join(','), manifestBookingRowIds: rowIds.join('|'),
      manifestResourceClaimIds: resources.map(event => event._id).join('|')
    }].concat(resources),
    bookingRows: rows,
    primaryRowId: rowIds[0]
  };
}
function projected(input) {
  return {
    operationId: input.operationId, bookingNumber: input.bookingNumber, roomCode: input.roomCode,
    quantity: input.bookingRowIds.length, checkIn: input.checkIn, checkOut: input.checkOut,
    rowProjectionPolicy: 1,
    rows: input.bookingRowIds.map((bookingRowId, index) => ({
      index: index + 1, bookingRowId, guests: input.guests,
      roomFee: input.roomCode === 'penthouse_apartment' ? input.roomFee : 0,
      note: index === 0 ? input.note : ''
    }))
  };
}
`;

const intrinsicPaths = [
  'Array.isArray', 'Array.prototype.indexOf', 'Array.prototype.join', 'Date',
  'Date.prototype.toISOString', 'Error', 'Math.floor', 'Number', 'Number.isSafeInteger',
  'Object.create', 'Object.defineProperty', 'Object.freeze', 'Object.getOwnPropertyDescriptor',
  'Object.getPrototypeOf', 'Object.is', 'Object.prototype', 'Array.prototype',
  'Reflect.apply', 'Reflect.ownKeys', 'RegExp.prototype.test', 'String',
  'String.prototype.padStart', 'String.prototype.replace', 'String.prototype.slice'
];
const selected = process.argv.includes('--case') ? process.argv[process.argv.indexOf('--case') + 1] : null;
async function run(intrinsic, boundary) {
  const name = intrinsic + ':' + boundary;
  if (selected && selected !== name) return;
  const context = vm.createContext({ intrinsic, boundary });
  vm.runInContext(fixtures + `
    const projectRoomBookingCommitPayload = projected;
    const computeRoomBookingPayloadDigest = () => '1'.repeat(64);
  ` + source, context);
  const result = await vm.runInContext(`(async () => {
    const p = makePlan({ units: [3, 4, 5] });
    const operationId = p.bookingRows[0].operationId;
    const trusted = { guests: 2, roomFee: 100, note: 'snapshot-note' };
    const saved = { getPrototypeOf: Object.getPrototypeOf, ownKeys: Reflect.ownKeys,
      define: Object.defineProperty, freeze: Object.freeze, Error, Date, isFrozen: Object.isFrozen };
    const outcomes = [
      { state: 'CONFIRMED', confirmed: p.acquisitions.map(x => ({eventId:x._id, disposition:'inserted'})) },
      { state: 'CONFIRMED', confirmed: [{eventId:'rc1-op-'+operationId+'-d', disposition:'inserted'}] },
      { state: 'CONFIRMED', confirmed: p.bookingRows.map(x => ({rowId:x._id, disposition:'inserted'})) }
    ];
    let calls = '', poisonCalls = 0, armed = false, frozen = true;
    function poison() {
      if (armed) return;
      armed = true;
      const parts = intrinsic.split('.');
      let target = globalThis;
      for (let i=0; i<parts.length-1; i++) target=target[parts[i]];
      const key = parts[parts.length-1];
      if (key === 'prototype') {
        // Constructor.prototype is non-writable. Replace the live global constructor,
        // preserving its static descriptors, but give it a distinct prototype.
        const original = globalThis[parts[0]];
        function facade() { poisonCalls++; throw new saved.Error('LIVE_INTRINSIC'); }
        for (const k of saved.ownKeys(original)) {
          if (k !== 'prototype' && k !== 'name' && k !== 'length')
            saved.define(facade, k, Object.getOwnPropertyDescriptor(original, k));
        }
        globalThis[parts[0]] = facade;
      } else {
        saved.define(target, key, { configurable:true, writable:true,
          value: function () { poisonCalls++; throw new saved.Error('LIVE_INTRINSIC'); } });
      }
    }
    const ports = {
      async appendClaimEvents(items) {
        calls += 'C'; frozen = frozen && saved.isFrozen(items) && saved.isFrozen(items[0]);
        await 0;
        if (boundary === 'claims' || boundary === 'recovery') poison();
        return boundary === 'recovery' ? null : outcomes[0];
      },
      async appendRoomOperationDecision() { calls += 'D'; await 0; if(boundary === 'decision') poison(); return outcomes[1]; },
      async appendBookingRows(items) { calls += 'R'; frozen = frozen && saved.isFrozen(items) && saved.isFrozen(items[0]);
        await 0; if(boundary === 'rows') poison(); return outcomes[2]; }
    };
    let input = p, actualPorts = ports;
    if (boundary === 'input' || boundary === 'invalid-plan') {
      input = new Proxy(boundary === 'invalid-plan' ? {} : p, {
        getPrototypeOf(target) { poison(); return saved.getPrototypeOf(target); }
      });
    }
    if (boundary === 'invalid-ports') actualPorts = new Proxy({}, {
      getPrototypeOf(target) { poison(); return saved.getPrototypeOf(target); }
    });
    let value, error;
    try { value = await coordinatePhysicalBookingCommit(input, trusted, actualPorts); }
    catch (e) { error = e; }
    return { armed, calls, poisonCalls, frozen, value, error,
      operationId, originalError: error instanceof saved.Error };
  })()`, context);
  assert.equal(result.armed, true, name + ': attack ran at requested boundary');
  assert.equal(result.poisonCalls, 0, name + ': caller replacement must never execute');
  if (boundary === 'invalid-plan') {
    assert.equal(result.error && result.error.message, 'Invalid coordinator plan', name);
    assert.equal(result.calls, '', name);
    assert.equal(result.originalError, true, name);
  } else if (boundary === 'recovery' || boundary === 'invalid-ports') {
    assert.equal(result.error && result.error.message, 'RECOVERY_REQUIRED', name);
    assert.equal(result.error.code, 'RECOVERY_REQUIRED', name);
    assert.equal(result.error.operationId, result.operationId, name);
    assert.equal(result.originalError, true, name);
    assert.equal(result.calls, boundary === 'recovery' ? 'C' : '', name);
  } else {
    assert.equal(result.error, undefined, name + ': valid commit must succeed');
    assert.equal(result.calls, 'CDR', name + ': exact ordered effects');
    assert.equal(result.frozen, true, name + ': outgoing snapshots remain frozen');
    assert.equal(result.value._id, 'pb1-' + result.operationId + '-r1', name);
    assert.equal(Date.prototype.toISOString.call(result.value.checkIn), '2027-11-05T12:00:00.000Z', name);
    assert.equal(Date.prototype.toISOString.call(result.value.checkOut), '2027-11-07T12:00:00.000Z', name);
    assert.equal(result.value.note, 'snapshot-note', name);
  }
  console.log('PASS: ' + name);
}
(async () => {
  for (const intrinsic of intrinsicPaths)
    for (const boundary of ['input', 'claims', 'decision', 'rows']) await run(intrinsic, boundary);
  for (const boundary of ['recovery', 'invalid-plan', 'invalid-ports']) await run('Error', boundary);
})().catch(error => { console.error(error); process.exitCode = 1; });
