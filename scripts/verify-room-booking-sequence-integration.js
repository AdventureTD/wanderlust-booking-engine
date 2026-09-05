// Local, disconnected sequence test. No Wix SDK, network, or source patches.
// Run: node scripts/verify-room-booking-sequence-integration.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert/strict');
const backend = path.join(__dirname, '..', 'velo', 'backend');

function load(context, file, names) {
  const source = fs.readFileSync(path.join(backend, file), 'utf8');
  // Only module syntax is replaced; strict mode and production bodies remain intact.
  const text = source.replace(/^import .*;\s*$/gm, '')
    .replace(/export (async )?function /g, '$1function ');
  Object.assign(context, vm.runInContext('(function(){"use strict";\n' + text +
    '\nreturn {' + names.join(',') + '};})()', context, { filename: file }));
}

// Execute fixtures, fake persistence, and real modules in ONE realm. In particular,
// do not inject host Object/Array prototypes into descriptor-sensitive adapters.
function fixture(quantity, interruptedPrefix) {
  const stores = { Bookings: new Map(), RoomBookingClaimEvents: new Map() };
  const calls = [];
  const writes = [];
  const trace = [];
  let failRow = interruptedPrefix === undefined ? null : interruptedPrefix + 1;
  function clone(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
      const result = {};
      Object.keys(value).forEach(key => { result[key] = clone(value[key]); });
      return result;
    }
    return value;
  }
  function collection(name) {
    if (!Object.prototype.hasOwnProperty.call(stores, name)) throw new Error('Unexpected collection: ' + name);
    return stores[name];
  }
  function optionsCheck(options, read) {
    const expected = read ? ['consistentRead', 'suppressAuth', 'suppressHooks'] : ['suppressAuth', 'suppressHooks'];
    if (JSON.stringify(Object.keys(options).sort()) !== JSON.stringify(expected) ||
        expected.some(key => options[key] !== true)) throw new Error('Unsafe Wix options');
  }
  const wixData = {
    async insert(name, row, options) {
      optionsCheck(options, false);
      calls.push({ method: 'insert', collection: name, id: row._id });
      const store = collection(name);
      if (store.has(row._id)) throw new Error('Duplicate deterministic ID');
      if (name === 'Bookings' && row._id.endsWith('-r' + failRow)) throw new Error('Injected row outage before persistence');
      store.set(row._id, clone(row));
      writes.push({ collection: name, id: row._id });
      // Deliberately not authoritative. Real adapters must call get.
      return { ignoredInsertResponse: true };
    },
    async get(name, id, options) {
      optionsCheck(options, true);
      calls.push({ method: 'get', collection: name, id });
      return clone(collection(name).get(id) || null);
    },
    query(name) {
      collection(name);
      const filters = [];
      let pageSize = 1000;
      return {
        eq(field, value) { filters.push([field, value]); return this; },
        limit(value) { pageSize = value; return this; },
        async find(options) {
          optionsCheck(options, true);
          calls.push({ method: 'find', collection: name });
          const rows = Array.from(collection(name).values()).filter(row => filters.every(([key, value]) => row[key] === value));
          function page(offset) {
            return { items: rows.slice(offset, offset + pageSize).map(clone),
              hasNext() { return offset + pageSize < rows.length; },
              async next() { return page(offset + pageSize); } };
          }
          return page(0);
        }
      };
    }
  };
  const operationId = 'c3sequencecase000' + quantity;
  const trusted = { guests: 2, roomFee: 345, note: 'Sequence primary' };
  const input = { operationId, bookingNumber: 'WC-SEQ-' + quantity, roomCode: 'adventure_suite',
    checkIn: '2028-06-10', checkOut: '2028-06-12',
    bookingRowIds: Array.from({ length: quantity }, (_, i) => 'pb1-' + operationId + '-r' + (i + 1)),
    ...trusted };
  const payload = projectRoomBookingCommitPayload(input);
  const payloadDigest = computeRoomBookingPayloadDigest(payload);
  const plan = buildPhysicalCommitPlan({ occupiedUnits: [],
    occupiedUnitsByNight: { '2028-06-10': [], '2028-06-11': [] },
    migrationIssueRows: [], duplicateUnitClaims: [], unknownStatusRows: [] }, [], {
    operationId, bookingNumber: input.bookingNumber, roomCode: input.roomCode, quantity,
    checkIn: input.checkIn, checkOut: input.checkOut, payloadDigest
  });
  function observe(name, fn) {
    return async function(...args) {
      const entry = { name };
      trace.push(entry);
      try { entry.result = await fn(...args); return entry.result; }
      catch (error) { entry.error = error.message; throw error; }
    };
  }
  return { wixData, stores, calls, writes, trace, plan, payload, payloadDigest, input,
    clearFault() { failRow = null; },
    commit() {
      return coordinatePhysicalBookingCommit(plan, trusted, {
        appendClaimEvents: observe('claims', appendRoomClaimEvents),
        appendRoomOperationDecision: observe('commit-rows', appendRoomOperationDecision),
        appendBookingRows: observe('rows', appendPhysicalBookingRows)
      });
    },
    recover() {
      return coordinatePhysicalBookingRecovery({ ...payload, payloadDigest }, {
        loadCommittedRecoveryManifest: observe('manifest', loadCommittedRoomRecoveryManifest),
        appendMissingBookingRows: observe('missing-rows', appendMissingPhysicalBookingRows)
      });
    }
  };
}
function subject(quantity, prefix) {
  const context = vm.createContext({ crypto });
  const modules = [
    ['roomAssignmentRules.js', []],
    ['roomAvailabilityRules.js', ['evaluateAutomaticAvailability']],
    ['roomBookingCommitProjectionRules.js', ['projectRoomBookingCommitPayload']],
    ['roomBookingPayloadRules.js', ['canonicalizeRoomBookingCommitPayload']],
    ['roomBookingPayloadDigest.js', ['computeRoomBookingPayloadDigest']],
    ['roomBookingCommitRules.js', ['buildPhysicalCommitPlan']],
    ['roomBookingCoordinator.js', ['coordinatePhysicalBookingCommit']],
    ['roomBookingCommit.js', ['appendRoomClaimEvents', 'appendRoomOperationDecision', 'loadCommittedRoomRecoveryManifest']],
    ['roomBookingRows.js', ['appendPhysicalBookingRows']],
    ['roomBookingRowRecovery.js', ['appendMissingPhysicalBookingRows']],
    ['roomBookingRecoveryCoordinator.js', ['coordinatePhysicalBookingRecovery']]
  ];
  // Discover named exports so assignment/availability dependencies are real too.
  for (const [file, names] of modules) {
    const source = fs.readFileSync(path.join(backend, file), 'utf8');
    const exports = Array.from(source.matchAll(/export (?:async )?function (\w+)/g), match => match[1]);
    load(context, file, [...new Set([...names, ...exports])]);
  }
  const value = vm.runInContext('(' + fixture.toString() + ')(' + quantity + ',' + prefix + ')', context);
  context.wixData = value.wixData;
  return value;
}
function json(value) { return JSON.parse(JSON.stringify(value)); }
function rows(s) { return Array.from(s.stores.Bookings.values()); }
function checkRows(s, quantity) {
  assert.equal(rows(s).length, quantity);
  rows(s).forEach((row, index) => {
    assert.deepEqual(json(row), {
      _id: s.input.bookingRowIds[index], roomCode: 'adventure_suite', assignedRoom: index + 3,
      quantity: 1, checkIn: '2028-06-10T12:00:00.000Z', checkOut: '2028-06-12T12:00:00.000Z',
      bookingNumber: s.input.bookingNumber, operationId: s.input.operationId, payloadDigest: s.payloadDigest,
      status: 'confirmed', autoOwnerBlock: false, guests: 2, roomFee: 0,
      note: index === 0 ? 'Sequence primary' : ''
    });
  });
}
async function succeeds(s, method) {
  try { return await s[method](); }
  catch (error) {
    throw new Error(method + ' expected success; got ' + error.message + '\nAdapter trace: ' +
      JSON.stringify(s.trace) + '\nSuccessful writes: ' + JSON.stringify(s.writes));
  }
}
async function recoveryRequired(s) {
  let caught;
  try { await s.commit(); } catch (error) { caught = error; }
  assert.ok(caught, 'normal commit must reject partial prefix');
  assert.equal(caught.message, 'RECOVERY_REQUIRED');
  assert.equal(caught.code, 'RECOVERY_REQUIRED');
  assert.equal(caught.operationId, s.input.operationId);
}
(async () => {
  let passed = 0;
  let failed = 0;
  async function test(name, run) {
    try { await run(); passed++; console.log('PASS: ' + name); }
    catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
  }
  for (const quantity of [1, 2, 3]) {
    await test(quantity + '-row real sequence and exact retry without duplicate persisted writes', async () => {
      const s = subject(quantity);
      assert.match(s.payloadDigest, /^[0-9a-f]{64}$/);
      assert.equal(s.plan.acquisitions[0].payloadDigest, s.payloadDigest);
      const primary = await succeeds(s, 'commit');
      checkRows(s, quantity);
      assert.deepEqual(json(s.trace.map(entry => entry.name)), ['claims', 'commit-rows', 'rows']);
      assert.equal(primary._id, s.input.bookingRowIds[0]);
      assert.equal(primary.checkIn.toISOString(), '2028-06-10T12:00:00.000Z');
      assert.equal(s.stores.RoomBookingClaimEvents.size, s.plan.acquisitions.length + 2);
      const ids = s.writes.map(write => write.id);
      assert.deepEqual(json(ids), [...s.plan.acquisitions.map(event => event._id),
        'rc1-op-' + s.input.operationId + '-c', 'rc1-op-' + s.input.operationId + '-d', ...s.input.bookingRowIds]);
      const before = JSON.stringify(s.writes);
      const storedBefore = JSON.stringify(Array.from(s.stores.RoomBookingClaimEvents.values()));
      const retry = await succeeds(s, 'commit');
      assert.deepEqual(json(retry), json(primary));
      assert.notEqual(retry, primary);
      assert.equal(JSON.stringify(s.writes), before, 'duplicate insert attempts must not persist writes');
      assert.equal(JSON.stringify(Array.from(s.stores.RoomBookingClaimEvents.values())), storedBefore);
      checkRows(s, quantity);
    });
  }
  for (const [quantity, prefix] of [[2, 1], [3, 1], [3, 2]]) {
    await test(quantity + '-row interruption after prefix ' + prefix + ', normal refusal and recovery-only suffix', async () => {
      const s = subject(quantity, prefix);
      await recoveryRequired(s);
      assert.equal(rows(s).length, prefix, 'fault must reach real row persistence, not fail upstream; trace=' + JSON.stringify(s.trace));
      assert.deepEqual(json(s.trace.map(entry => entry.name)), ['claims', 'commit-rows', 'rows']);
      const before = JSON.stringify(s.writes);
      s.clearFault();
      await recoveryRequired(s);
      assert.equal(JSON.stringify(s.writes), before, 'normal retry must not append a missing suffix');
      const start = s.writes.length;
      const callStart = s.calls.length;
      const primary = await succeeds(s, 'recover');
      assert.equal(primary._id, s.input.bookingRowIds[0]);
      checkRows(s, quantity);
      assert.deepEqual(json(s.writes.slice(start)), json(s.input.bookingRowIds.slice(prefix).map(id => ({ collection: 'Bookings', id }))));
      assert.ok(s.calls.slice(callStart).filter(call => call.method === 'insert').every(call =>
        call.collection === 'Bookings' && s.input.bookingRowIds.slice(prefix).includes(call.id)), 'recovery may only attempt suffix inserts');
      const after = JSON.stringify(s.writes);
      await succeeds(s, 'recover');
      await succeeds(s, 'commit');
      assert.equal(JSON.stringify(s.writes), after, 'completed recovery and normal retries must not duplicate writes');
    });
  }
  console.log('SEQUENCE RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
