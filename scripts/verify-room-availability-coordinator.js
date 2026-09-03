// Behavioral tests for the backend-only availability coordinator.
// Run: node scripts/verify-room-availability-coordinator.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assertEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`FAIL: ${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`);
  }
  console.log(`PASS: ${message}`);
}

async function assertRejects(run, expectedMessage, message) {
  let error = null;
  try { await run(); } catch (caught) { error = caught; }
  if (!error || String(error.message) !== expectedMessage) {
    throw new Error(`FAIL: ${message}\nExpected error: ${expectedMessage}\nActual: ${error && error.message}`);
  }
  console.log(`PASS: ${message}`);
  return error;
}

const backendDir = path.join(__dirname, '..', 'velo', 'backend');
const assignmentSource = fs.readFileSync(path.join(backendDir, 'roomAssignmentRules.js'), 'utf8');
const availabilitySource = fs.readFileSync(path.join(backendDir, 'roomAvailabilityRules.js'), 'utf8');
const coordinatorSource = fs.readFileSync(path.join(backendDir, 'roomAvailability.js'), 'utf8');
const source = (assignmentSource + '\n' + availabilitySource + '\n' + coordinatorSource)
  .replace(/^import .*;\s*$/gm, '')
  .replace(/export function /g, 'function ')
  .replace(/export async function /g, 'async function ')
  + '\nthis.coordinator = { loadRoomAvailability };';

const context = { Date, loadInventorySnapshot: null };
vm.createContext(context);
vm.runInContext(source, context);

function snapshot(units, issueField) {
  const result = {
    occupiedUnits: units.slice(),
    occupiedUnitsByNight: {
      '2027-11-05': units.slice(),
      '2027-11-06': units.slice()
    },
    migrationIssueRows: [],
    duplicateUnitClaims: [],
    unknownStatusRows: []
  };
  if (issueField) result[issueField] = [{ rowId: 'unsafe-row' }];
  return result;
}

(async function() {
  const checkIn = new Date('2027-11-05T12:00:00.000Z');
  const checkOut = new Date('2027-11-07T12:00:00.000Z');
  const calls = [];
  const occupied = snapshot([1, 3]);
  const before = JSON.stringify(occupied);
  context.loadInventorySnapshot = async function(actualCheckIn, actualCheckOut) {
    calls.push([actualCheckIn, actualCheckOut]);
    return occupied;
  };

  const result = await context.coordinator.loadRoomAvailability(checkIn, checkOut);
  assertEqual(result, [
    { roomCode: 'penthouse_apartment', available: false, maxQuantity: 0 },
    { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
    { roomCode: 'adventure_suite', available: true, maxQuantity: 1 }
  ], 'one snapshot produces the exact ordered three-room availability contract');
  assertEqual(calls.length, 1, 'the coordinator loads one snapshot for all room codes');
  assertEqual(calls[0][0] === checkIn && calls[0][1] === checkOut, true,
    'the coordinator forwards date arguments unchanged');
  assertEqual(JSON.stringify(occupied), before, 'the coordinator does not mutate its inventory snapshot');
  assertEqual(Object.keys(result[0]), ['roomCode', 'available', 'maxQuantity'],
    'coordinator rows expose no inventory, unit, or diagnostic fields');

  context.loadInventorySnapshot = async function() { return snapshot([]); };
  assertEqual(await context.coordinator.loadRoomAvailability(checkIn, checkOut), [
    { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
    { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
    { roomCode: 'adventure_suite', available: true, maxQuantity: 3 }
  ], 'empty inventory exposes each room type maximum');

  context.loadInventorySnapshot = async function() { return snapshot([1, 2, 3, 4]); };
  assertEqual(await context.coordinator.loadRoomAvailability(checkIn, checkOut), [
    { roomCode: 'penthouse_apartment', available: false, maxQuantity: 0 },
    { roomCode: 'two_bedroom_apartment', available: false, maxQuantity: 0 },
    { roomCode: 'adventure_suite', available: false, maxQuantity: 0 }
  ], 'sold-out inventory retains all room codes with zero maximums');

  const sentinel = new Error('inventory read failed');
  context.loadInventorySnapshot = async function() { throw sentinel; };
  const readerError = await assertRejects(
    function() { return context.coordinator.loadRoomAvailability(checkIn, checkOut); },
    'inventory read failed',
    'reader failures propagate without a partial availability result'
  );
  assertEqual(readerError === sentinel, true, 'reader failures preserve the original error object');

  context.loadInventorySnapshot = async function() { return {}; };
  await assertRejects(
    function() { return context.coordinator.loadRoomAvailability(checkIn, checkOut); },
    'Invalid inventory snapshot',
    'invalid reader output fails closed through the pure evaluator'
  );

  context.loadInventorySnapshot = async function() { return snapshot([], 'migrationIssueRows'); };
  await assertRejects(
    function() { return context.coordinator.loadRoomAvailability(checkIn, checkOut); },
    'Inventory migration required',
    'inventory integrity diagnostics reject the whole coordinator result'
  );
})();
