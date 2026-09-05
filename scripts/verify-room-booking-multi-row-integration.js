// Integration: real planner + C1 projection/digest + disconnected coordinator.
// Run: node scripts/verify-room-booking-multi-row-integration.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const backend = path.join(__dirname, '..', 'velo', 'backend');
let count = 0;
function pass(condition, message) {
  if (!condition) throw new Error('FAIL: ' + message);
  count += 1;
  console.log('PASS: ' + message);
}
function source(file) { return fs.readFileSync(path.join(backend, file), 'utf8'); }
function moduleWrapper(text, exports) {
  return '(function(){\n' + text
    .replace(/^import .*;\s*$/gm, '')
    .replace(/export (async )?function /g, '$1function ') +
    '\nreturn {' + exports.join(',') + '};\n})()';
}
const context = { crypto, console };
vm.createContext(context);
context.projection = vm.runInContext(moduleWrapper(source('roomBookingCommitProjectionRules.js'),
  ['projectRoomBookingCommitPayload']), context);
context.payloadRules = vm.runInContext(moduleWrapper(source('roomBookingPayloadRules.js'),
  ['canonicalizeRoomBookingCommitPayload']), context);
context.canonicalizeRoomBookingCommitPayload = context.payloadRules.canonicalizeRoomBookingCommitPayload;
context.digestRules = vm.runInContext(moduleWrapper(source('roomBookingPayloadDigest.js'),
  ['computeRoomBookingPayloadDigest']), context);
context.projectRoomBookingCommitPayload = context.projection.projectRoomBookingCommitPayload;
context.computeRoomBookingPayloadDigest = context.digestRules.computeRoomBookingPayloadDigest;
context.planner = vm.runInContext(moduleWrapper([
  'roomAssignmentRules.js', 'roomAvailabilityRules.js', 'roomBookingCommitRules.js'
].map(source).join('\n'), ['buildPhysicalCommitPlan']), context);
context.coordinator = vm.runInContext(moduleWrapper(source('roomBookingCoordinator.js'),
  ['coordinatePhysicalBookingCommit']), context);
vm.runInContext(`
this.runCase = async function(quantity) {
  const operationId = 'integrationtrace' + String(quantity).padStart(2, '0');
  const rowIds = Array.from({ length: quantity }, function(_, index) {
    return 'pb1-' + operationId + '-r' + (index + 1);
  });
  const trusted = { guests: 2, roomFee: 345, note: 'Integration primary' };
  const projectionInput = {
    operationId, bookingNumber: 'WC-I-' + quantity, roomCode: 'adventure_suite',
    checkIn: '2028-06-10', checkOut: '2028-06-12', bookingRowIds: rowIds,
    guests: trusted.guests, roomFee: trusted.roomFee, note: trusted.note
  };
  const payload = projection.projectRoomBookingCommitPayload(projectionInput);
  const payloadDigest = digestRules.computeRoomBookingPayloadDigest(payload);
  const snapshot = {
    occupiedUnits: [],
    occupiedUnitsByNight: { '2028-06-10': [], '2028-06-11': [] },
    migrationIssueRows: [], duplicateUnitClaims: [], unknownStatusRows: []
  };
  const plan = planner.buildPhysicalCommitPlan(snapshot, [], {
    roomCode: 'adventure_suite', quantity, checkIn: '2028-06-10', checkOut: '2028-06-12',
    bookingNumber: 'WC-I-' + quantity, operationId, payloadDigest
  });
  const calls = [];
  const result = await coordinator.coordinatePhysicalBookingCommit(plan, trusted, {
    appendClaimEvents: async function(events) {
      calls.push({ name: 'claims', values: events });
      return { state: 'CONFIRMED', confirmed: events.map(function(event, index) {
        return { eventId: event._id, disposition: index % 2 ? 'already-present' : 'inserted' };
      }) };
    },
    appendRoomOperationDecision: async function(id, decision) {
      calls.push({ name: decision, values: [id] });
      return { state: 'CONFIRMED', confirmed: [{
        eventId: 'rc1-op-' + id + '-d', disposition: 'inserted'
      }] };
    },
    appendBookingRows: async function(rows) {
      calls.push({ name: 'rows', values: rows });
      return { state: 'CONFIRMED', confirmed: rows.map(function(row) {
        return { rowId: row._id, disposition: 'already-present' };
      }) };
    }
  });
  return {
    quantity,
    payloadDigest,
    identityDigest: plan.acquisitions[0].payloadDigest,
    decisionFenceVersion: plan.acquisitions[0].decisionFenceVersion,
    rowIds: plan.bookingRows.map(function(row) { return row._id; }),
    callNames: calls.map(function(call) { return call.name; }),
    persisted: calls[2].values.map(function(row) {
      return { id: row._id, unit: row.assignedRoom, guests: row.guests,
        fee: row.roomFee, note: row.note, fields: Reflect.ownKeys(row).length,
        inType: typeof row.checkIn, checkIn: row.checkIn };
    }),
    primaryId: result._id,
    directBookingNumber: result.bookingNumber,
    returnDetached: result !== calls[2].values[0] && result.checkIn !== calls[2].values[0].checkIn
  };
};`, context);

(async function() {
  for (const quantity of [1, 2, 3]) {
    const value = await context.runCase(quantity);
    pass(/^[0-9a-f]{64}$/.test(value.payloadDigest) && value.payloadDigest === value.identityDigest,
      quantity + '-row planner identity carries the actual C1 payload digest');
    pass(value.decisionFenceVersion === 1,
      quantity + '-row planner output carries the decision fence marker');
    pass(JSON.stringify(value.callNames) === JSON.stringify(['claims', 'commit-rows', 'rows']),
      quantity + '-row integration preserves causal dispatch');
    pass(value.persisted.length === quantity && value.persisted.every(function(row, index) {
      return row.id === value.rowIds[index] && row.unit === index + 3 && row.guests === 2 &&
        row.fee === 0 && row.note === (index === 0 ? 'Integration primary' : '') &&
        row.fields === 14 && row.inType === 'string' &&
        row.checkIn === '2028-06-10T12:00:00.000Z';
    }), quantity + '-row planner topology agrees with projected persisted rows');
    pass(value.primaryId === value.rowIds[0] && value.directBookingNumber === 'WC-I-' + quantity &&
      value.returnDetached, quantity + '-row integration returns the detached primary booking row');
  }
  console.log('PASS COUNT: ' + count);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
