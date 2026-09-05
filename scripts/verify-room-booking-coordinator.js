// Behavioral tests for the disconnected 1-3 row commit coordinator.
// Run: node scripts/verify-room-booking-coordinator.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let count = 0;
function equal(actual, expected, message) {
  const normalize = value => value instanceof Date ? value.toISOString() :
    Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ?
      Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
  const a = JSON.stringify(normalize(actual));
  const e = JSON.stringify(normalize(expected));
  if (a !== e) throw new Error('FAIL: ' + message + '\nExpected: ' + e + '\nActual:   ' + a);
  count += 1;
  console.log('PASS: ' + message);
}
async function rejects(run, message, operationId) {
  let error;
  try { await run(); } catch (caught) { error = caught; }
  equal(error && { message: error.message, code: error.code, operationId: error.operationId },
    { message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED', operationId }, message);
}
function loadCoordinator(project, digest) {
  const file = path.join(__dirname, '..', 'velo', 'backend', 'roomBookingCoordinator.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/export async function /g, 'async function ') +
    '\nthis.api = { coordinatePhysicalBookingCommit };';
  const context = {
    Date, Object, Array, Error, Number, String, RegExp, Reflect,
    projectRoomBookingCommitPayload: project,
    computeRoomBookingPayloadDigest: digest
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.api, context };
}
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
function confirmations(items, idField, sourceField) {
  return { state: 'CONFIRMED', confirmed: Array.from(items, item => ({
    [idField]: item[sourceField], disposition: 'inserted'
  })) };
}
function portsFor(plan, calls, hooks) {
  hooks = hooks || {};
  return {
    appendClaimEvents: async function(events) {
      calls.push(['claims', events]);
      if (hooks.claims) return hooks.claims(events, this);
      return confirmations(events, 'eventId', '_id');
    },
    appendRoomOperationDecision: async function(id, decision) {
      calls.push(['decision', id, decision]);
      if (hooks.decision) return hooks.decision(id, decision, this);
      return { state: 'CONFIRMED', confirmed: [{
        eventId: 'rc1-op-' + id + '-d', disposition: 'inserted'
      }] };
    },
    appendBookingRows: async function(rows) {
      calls.push(['rows', rows]);
      if (hooks.rows) return hooks.rows(rows, this);
      return confirmations(rows, 'rowId', '_id');
    }
  };
}

(async function() {
  for (const topology of [
    ['penthouse_apartment', [1], 2, 275],
    ['two_bedroom_apartment', [2], 4, 275],
    ['adventure_suite', [3], 2, 275],
    ['adventure_suite', [4], 2, 275],
    ['adventure_suite', [3, 4], 2, 275],
    ['adventure_suite', [3, 4, 5], 2, 275]
  ]) {
    const plan = makePlan({ roomCode: topology[0], units: topology[1] });
    const trusted = { guests: topology[2], roomFee: topology[3], note: 'Primary only' };
    let projectedInput;
    const loaded = loadCoordinator(input => { projectedInput = input; return projected(input); }, () => '1'.repeat(64));
    const calls = [];
    const result = await loaded.api.coordinatePhysicalBookingCommit(plan, trusted, portsFor(plan, calls));
    equal(projectedInput, {
      operationId: 'coordinatortrace01', bookingNumber: 'WC-5001', roomCode: topology[0],
      checkIn: '2027-11-05', checkOut: '2027-11-07',
      bookingRowIds: topology[1].map((_, index) => 'pb1-coordinatortrace01-r' + (index + 1)),
      guests: topology[2], roomFee: topology[3], note: 'Primary only'
    }, topology[0] + ' ' + topology[1].join(',') + ' projects exact C1 input');
    equal(calls.map(call => call[0]), ['claims', 'decision', 'rows'],
      'effects remain causal for ' + topology[1].length + ' row(s)');
    equal(calls[1].slice(1), ['coordinatortrace01', 'commit-rows'],
      'decision is exactly commit-rows');
    equal(calls[2][1].map(row => ({
      keys: Reflect.ownKeys(row), room: row.assignedRoom, guests: row.guests,
      fee: row.roomFee, note: row.note, checkIn: row.checkIn,
      checkOut: row.checkOut, inType: typeof row.checkIn,
      outType: typeof row.checkOut, frozen: Object.isFrozen(row)
    })), topology[1].map((unit, index) => ({
      keys: ['_id', 'roomCode', 'assignedRoom', 'quantity', 'checkIn', 'checkOut',
        'bookingNumber', 'operationId', 'payloadDigest', 'status', 'autoOwnerBlock',
        'guests', 'roomFee', 'note'],
      room: unit, guests: topology[2],
      fee: topology[0] === 'penthouse_apartment' ? topology[3] : 0,
      note: index === 0 ? 'Primary only' : '',
      checkIn: '2027-11-05T12:00:00.000Z',
      checkOut: '2027-11-07T12:00:00.000Z',
      inType: 'string', outType: 'string', frozen: true
    })), 'row port receives exact immutable timestamp strings for ' + topology[1].join(','));
    equal({ id: result._id, bookingNumber: result.bookingNumber,
      inDate: result.checkIn instanceof Date, frozen: Object.isFrozen(result),
      detached: result !== calls[2][1][0] && result.checkIn !== calls[2][1][0].checkIn },
    { id: plan.primaryRowId, bookingNumber: 'WC-5001', inDate: true, frozen: false, detached: true },
    'return is detached mutable primary row for ' + topology[1].length + ' row(s)');
  }

  const plan = makePlan({ units: [3, 4, 5] });
  const trusted = { guests: 2, roomFee: 199, note: 'x' };
  for (const digestCase of [
    ['mismatch', () => '2'.repeat(64)],
    ['uppercase', () => 'A'.repeat(64)],
    ['throw', () => { throw new Error('digest failed'); }],
    ['thenable', () => ({ then: resolve => resolve('1'.repeat(64)) })]
  ]) {
    let io = 0;
    const loaded = loadCoordinator(projected, digestCase[1]);
    let error;
    try {
      await loaded.api.coordinatePhysicalBookingCommit(plan, trusted, {
        appendClaimEvents: async () => { io += 1; },
        appendRoomOperationDecision: async () => { io += 1; },
        appendBookingRows: async () => { io += 1; }
      });
    } catch (caught) { error = caught; }
    equal({ message: error && error.message, io }, { message: 'Invalid coordinator plan', io: 0 },
      'digest ' + digestCase[0] + ' fails synchronously before port I/O');
  }

  for (const mutation of [
    p => { delete p.acquisitions[0].decisionFenceVersion; },
    p => { p.primaryRowId = p.bookingRows[1]._id; },
    p => { p.bookingRows[1].assignedRoom = 5; },
    p => { [p.acquisitions[1], p.acquisitions[2]] = [p.acquisitions[2], p.acquisitions[1]]; },
    p => { p.acquisitions[2].bookingRowId = p.bookingRows[0]._id; },
    p => { p.bookingRows.extra = true; },
    p => { Object.defineProperty(p.bookingRows[0], 'roomCode', { get: () => 'adventure_suite' }); },
    p => { p[Symbol('extra')] = true; }
  ]) {
    const candidate = makePlan({ units: [3, 4, 5] });
    mutation(candidate);
    let io = 0;
    let error;
    try {
      await loadCoordinator(projected, () => '1'.repeat(64)).api.coordinatePhysicalBookingCommit(
        candidate, trusted, {
          appendClaimEvents: async () => { io += 1; },
          appendRoomOperationDecision: async () => { io += 1; },
          appendBookingRows: async () => { io += 1; }
        });
    } catch (caught) { error = caught; }
    equal({ message: error && error.message, io }, { message: 'Invalid coordinator plan', io: 0 },
      'hostile or inconsistent plan fails closed before I/O');
  }

  const partialCalls = [];
  await rejects(() => loadCoordinator(projected, () => '1'.repeat(64)).api.coordinatePhysicalBookingCommit(
    plan, trusted, portsFor(plan, partialCalls, {
      rows: rows => confirmations(rows.slice(0, 2), 'rowId', '_id')
    })), 'partial row confirmation requires recovery without suffix resume', 'coordinatortrace01');
  equal(partialCalls.filter(call => call[0] === 'rows').length, 1,
    'partial row result causes one batch attempt and no suffix retry');

  const replacedCalls = [];
  const mutablePorts = portsFor(plan, replacedCalls, {
    claims: function(events, receiver) {
      plan.bookingRows[0].bookingNumber = 'MUTATED';
      trusted.note = 'MUTATED';
      mutablePorts.appendRoomOperationDecision = async () => { throw new Error('replacement'); };
      mutablePorts.appendBookingRows = async () => { throw new Error('replacement'); };
      Array.prototype.map = function() { throw new Error('poisoned map'); };
      Date.prototype.toISOString = function() { throw new Error('poisoned date'); };
      equal(Object.isFrozen(receiver), true, 'captured port receiver is frozen');
      return confirmations(events, 'eventId', '_id');
    }
  });
  const originalMap = Array.prototype.map;
  const originalIso = Date.prototype.toISOString;
  let replacedResult;
  try {
    replacedResult = await loadCoordinator(projected, () => '1'.repeat(64)).api
      .coordinatePhysicalBookingCommit(plan, trusted, mutablePorts);
  } finally {
    Array.prototype.map = originalMap;
    Date.prototype.toISOString = originalIso;
  }
  equal({ bookingNumber: replacedResult.bookingNumber, note: replacedResult.note,
    calls: replacedCalls.map(call => call[0]) },
  { bookingNumber: 'WC-5001', note: 'x', calls: ['claims', 'decision', 'rows'] },
  'pre-await snapshots and captured intrinsics survive caller, port, and prototype mutation');
  plan.bookingRows[0].bookingNumber = 'WC-5001';
  trusted.note = 'x';

  const invalidTrustedCases = [
    value => { value.extra = true; },
    value => { value[Symbol('extra')] = true; },
    value => { delete value.note; },
    value => { Object.defineProperty(value, 'note', { get: () => 'x', enumerable: true }); },
    value => { Object.defineProperty(value, 'roomFee', { writable: false }); },
    value => { Object.setPrototypeOf(value, null); }
  ];
  for (const mutate of invalidTrustedCases) {
    const value = { guests: 2, roomFee: 199, note: 'x' };
    mutate(value);
    let io = 0;
    let error;
    try {
      await loadCoordinator(projected, () => '1'.repeat(64)).api.coordinatePhysicalBookingCommit(
        makePlan({ units: [3, 4] }), value, {
          appendClaimEvents: async () => { io += 1; },
          appendRoomOperationDecision: async () => { io += 1; },
          appendBookingRows: async () => { io += 1; }
        });
    } catch (caught) { error = caught; }
    equal({ message: error && error.message, io }, { message: 'Invalid coordinator plan', io: 0 },
      'trusted input must be an exact stable ordinary own-data record');
  }

  const structuralPlanCases = [
    p => { delete p.bookingRows[1]; },
    p => { p.acquisitions.extra = true; },
    p => { p.bookingRows[0].extra = true; },
    p => { p.acquisitions[1][Symbol('extra')] = true; },
    p => { Object.setPrototypeOf(p.acquisitions, Object.create(Array.prototype)); },
    p => { p.bookingRows.push(Object.assign({}, p.bookingRows[2], { _id: 'pb1-coordinatortrace01-r4' })); },
    p => { p.acquisitions[1].claimType = 'unit'; },
    p => { p.acquisitions[1].capacitySlot = p.acquisitions[2].capacitySlot; },
    p => {
      const first = p.acquisitions[1];
      const second = p.acquisitions[2];
      const night = first.night;
      first.capacitySlot = 2;
      first.claimKey = 'capacity:' + night + ':2';
      first._id = 'rc1-' + night.replace(/-/g, '') + '-s2-000001-a';
      second.capacitySlot = 1;
      second.claimKey = 'capacity:' + night + ':1';
      second._id = 'rc1-' + night.replace(/-/g, '') + '-s1-000001-a';
      const ids = p.acquisitions[0].manifestResourceClaimIds.split('|');
      ids[0] = first._id;
      ids[1] = second._id;
      p.acquisitions[0].manifestResourceClaimIds = ids.join('|');
    },
    p => { p.acquisitions[1].generation = 0; },
    p => { p.acquisitions[0].manifestResourceClaimIds += '|extra'; }
  ];
  for (const mutate of structuralPlanCases) {
    const value = makePlan({ units: [3, 4, 5] });
    mutate(value);
    let io = 0;
    let error;
    try {
      await loadCoordinator(projected, () => '1'.repeat(64)).api.coordinatePhysicalBookingCommit(
        value, { guests: 2, roomFee: 199, note: 'x' }, {
          appendClaimEvents: async () => { io += 1; },
          appendRoomOperationDecision: async () => { io += 1; },
          appendBookingRows: async () => { io += 1; }
        });
    } catch (caught) { error = caught; }
    equal({ message: error && error.message, io }, { message: 'Invalid coordinator plan', io: 0 },
      'sparse, extra, symbolic, malformed, or out-of-range plan topology fails closed');
  }

  let proxyPass = 0;
  const proxyTarget = makePlan({ units: [3, 4] });
  const driftingPlan = new Proxy(proxyTarget, {
    ownKeys: function(target) {
      proxyPass += 1;
      const keys = Reflect.ownKeys(target);
      return proxyPass === 2 ? keys.reverse() : keys;
    }
  });
  let proxyIo = 0;
  let proxyError;
  try {
    await loadCoordinator(projected, () => '1'.repeat(64)).api.coordinatePhysicalBookingCommit(
      driftingPlan, { guests: 2, roomFee: 199, note: 'x' }, {
        appendClaimEvents: async () => { proxyIo += 1; },
        appendRoomOperationDecision: async () => { proxyIo += 1; },
        appendBookingRows: async () => { proxyIo += 1; }
      });
  } catch (caught) { proxyError = caught; }
  equal({ message: proxyError && proxyError.message, io: proxyIo },
    { message: 'Invalid coordinator plan', io: 0 },
    'proxy key drift is rejected before effects');

  const confirmationCases = [
    ['partial claims', {
      claims: events => confirmations(Array.from(events).slice(0, -1), 'eventId', '_id')
    }, ['claims']],
    ['opposite claim state', {
      claims: () => ({ state: 'STOPPED', confirmed: [] })
    }, ['claims']],
    ['wrong claim order', {
      claims: events => {
        const value = confirmations(events, 'eventId', '_id');
        [value.confirmed[0], value.confirmed[1]] = [value.confirmed[1], value.confirmed[0]];
        return value;
      }
    }, ['claims']],
    ['malformed claim accessor', {
      claims: () => Object.defineProperty({}, 'state', {
        enumerable: true, get: () => { throw new Error('must not execute'); }
      })
    }, ['claims']],
    ['partial decision', {
      decision: () => ({ state: 'CONFIRMED', confirmed: [] })
    }, ['claims', 'decision']],
    ['opposite decision state', {
      decision: id => ({ state: 'STOPPED', confirmed: [{
        eventId: 'rc1-op-' + id + '-d', disposition: 'inserted'
      }] })
    }, ['claims', 'decision']],
    ['thrown row write', {
      rows: () => { throw new Error('ambiguous write'); }
    }, ['claims', 'decision', 'rows']]
  ];
  for (const testCase of confirmationCases) {
    const value = makePlan({ units: [3, 4, 5] });
    const calls = [];
    await rejects(() => loadCoordinator(projected, () => '1'.repeat(64)).api.coordinatePhysicalBookingCommit(
      value, { guests: 2, roomFee: 199, note: 'x' }, portsFor(value, calls, testCase[1])),
    testCase[0] + ' maps to exact recovery', 'coordinatortrace01');
    equal(calls.map(call => call[0]), testCase[2],
      testCase[0] + ' permits no later effect');
  }

  const dateMutationCalls = [];
  await rejects(() => loadCoordinator(projected, () => '1'.repeat(64)).api.coordinatePhysicalBookingCommit(
    makePlan({ units: [3, 4] }), { guests: 2, roomFee: 199, note: 'x' },
    portsFor(plan, dateMutationCalls, {
      rows: rows => {
        rows[0].checkIn.setUTCDate(rows[0].checkIn.getUTCDate() + 1);
        return confirmations(rows, 'rowId', '_id');
      }
    })), 'mutable Date tampering at the row port requires recovery', 'coordinatortrace01');

  const detachCalls = [];
  const detached = await loadCoordinator(projected, () => '1'.repeat(64)).api.coordinatePhysicalBookingCommit(
    makePlan({ units: [3, 4] }), { guests: 2, roomFee: 199, note: 'x' },
    portsFor(plan, detachCalls));
  const persistedPrimary = detachCalls[2][1][0];
  detached.note = 'caller mutation';
  detached.checkIn.setUTCFullYear(2035);
  equal({ persistedNote: persistedPrimary.note, persistedDate: persistedPrimary.checkIn,
    persistedDateType: typeof persistedPrimary.checkIn },
    { persistedNote: 'x', persistedDate: '2027-11-05T12:00:00.000Z', persistedDateType: 'string' },
    'returned object and Dates cannot mutate the frozen primitive persistence snapshot');

  console.log('PASS COUNT: ' + count);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
