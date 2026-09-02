// Behavioral tests for read-only physical-room inventory projection.
// Run: node scripts/verify-room-inventory-rules.js
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

function assertThrows(run, expectedMessage, message) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  if (!error || String(error.message) !== expectedMessage) {
    throw new Error(`FAIL: ${message}\nExpected error: ${expectedMessage}\nActual: ${error && error.message}`);
  }
  console.log(`PASS: ${message}`);
}

const assignmentPath = path.join(__dirname, '..', 'velo', 'backend', 'roomAssignmentRules.js');
const sourcePath = path.join(__dirname, '..', 'velo', 'backend', 'roomInventoryRules.js');
const source = (
  fs.readFileSync(assignmentPath, 'utf8') + '\n' +
  fs.readFileSync(sourcePath, 'utf8').replace(/^import .*;\s*$/gm, '')
)
  .replace(/export const /g, 'var ')
  .replace(/export function /g, 'function ')
  + '\nthis.rules = { buildInventorySnapshot };';
const context = { Date };
vm.createContext(context);
vm.runInContext(source, context);

const snapshot = context.rules.buildInventorySnapshot([
  {
    _id: 'ends-at-arrival',
    status: 'confirmed',
    assignedRoom: 3,
    quantity: 1,
    checkIn: '2027-11-01T12:00:00.000Z',
    checkOut: '2027-11-05T12:00:00.000Z'
  },
  {
    _id: 'starts-at-departure',
    status: 'confirmed',
    assignedRoom: 4,
    quantity: 1,
    checkIn: '2027-11-08T12:00:00.000Z',
    checkOut: '2027-11-12T12:00:00.000Z'
  },
  {
    _id: 'overlaps-request',
    status: 'confirmed',
    assignedRoom: 5,
    quantity: 1,
    checkIn: '2027-11-06T12:00:00.000Z',
    checkOut: '2027-11-07T12:00:00.000Z'
  }
], '2027-11-05', '2027-11-08');

assertEqual(
  snapshot.rows.map(function(row) { return row._id; }),
  ['overlaps-request'],
  'inventory overlap uses exclusive checkout boundaries'
);

const statusSnapshot = context.rules.buildInventorySnapshot([
  { _id: 'confirmed', status: 'Confirmed', assignedRoom: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'hold', status: 'HOLD', assignedRoom: 2, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'blocked', status: 'blocked', assignedRoom: 3, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'in-house', status: 'In-House', assignedRoom: 4, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'cancelled', status: 'Cancelled', assignedRoom: 5, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'pending-confirmation', status: 'Pending Confirmation', assignedRoom: 5, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'pending', status: 'pending', assignedRoom: 5, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'checked-out', status: '  Checked-Out  ', assignedRoom: 5, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'unknown', status: 'Checked In', assignedRoom: 5, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'blank-status', status: '  ', assignedRoom: 5, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'missing-status', assignedRoom: 5, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'unknown-invalid-dates', status: 'Checked In', assignedRoom: 5 }
], '2027-11-05', '2027-11-08');

assertEqual(
  statusSnapshot.rows.map(function(row) { return row._id; }),
  ['confirmed', 'hold', 'blocked', 'in-house'],
  'only active occupancy statuses enter the inventory snapshot'
);

assertEqual(
  statusSnapshot.unknownStatusRows.map(function(row) { return row._id; }),
  ['unknown', 'blank-status', 'missing-status', 'unknown-invalid-dates'],
  'every unknown or blank inventory status is surfaced without being counted as occupancy'
);

const ownerSplitSnapshot = context.rules.buildInventorySnapshot([
  { _id: 'guest', status: 'confirmed', assignedRoom: 3, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'owner', status: 'blocked', assignedRoom: 5, quantity: 1, autoOwnerBlock: true, checkIn: '2027-11-05', checkOut: '2027-11-08' }
], '2027-11-05', '2027-11-08');

assertEqual(
  {
    guest: ownerSplitSnapshot.guestRows.map(function(row) { return row._id; }),
    owner: ownerSplitSnapshot.ownerBlockRows.map(function(row) { return row._id; })
  },
  { guest: ['guest'], owner: ['owner'] },
  'derived owner blocks are separated from guest and manual occupancy'
);

const unitSnapshot = context.rules.buildInventorySnapshot([
  { _id: 'unit-3-text', status: 'confirmed', assignedRoom: '3', quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'unit-3-duplicate', status: 'hold', assignedRoom: 3, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'unit-4', status: 'blocked', assignedRoom: 4, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'invalid-unit', status: 'confirmed', assignedRoom: 6, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'boolean-unit', status: 'confirmed', assignedRoom: true, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'array-unit', status: 'confirmed', assignedRoom: [3], quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'owner-unit-5', status: 'blocked', assignedRoom: 5, quantity: 1, autoOwnerBlock: true, checkIn: '2027-11-05', checkOut: '2027-11-08' }
], '2027-11-05', '2027-11-08');

assertEqual(
  unitSnapshot.occupiedUnits,
  [3, 4],
  'occupied guest units are normalized, deduplicated, and exclude owner blocks'
);

const deterministicSnapshot = context.rules.buildInventorySnapshot([
  { _id: 'unit-4-first', status: 'confirmed', assignedRoom: 4, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'unit-3-second', status: 'confirmed', assignedRoom: 3, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' }
], '2027-11-05', '2027-11-06');

assertEqual(
  {
    stay: deterministicSnapshot.occupiedUnits,
    night: deterministicSnapshot.occupiedUnitsByNight['2027-11-05']
  },
  { stay: [3, 4], night: [3, 4] },
  'occupied-unit projections are deterministic regardless of query row order'
);

const migrationSnapshot = context.rules.buildInventorySnapshot([
  { _id: 'valid', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 3, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'missing-unit', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: null, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'legacy-aggregate', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 4, quantity: 2, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'room-unit-mismatch', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 1, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'quantity-missing', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 3, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'quantity-null', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 3, quantity: null, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'quantity-zero', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 3, quantity: 0, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'quantity-negative', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 3, quantity: -1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'quantity-text', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 3, quantity: '1', checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'non-overlap-quantity-text', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 3, quantity: '1', checkIn: '2027-12-01', checkOut: '2027-12-08' },
  { _id: 'owner-invalid-quantity', status: 'blocked', roomCode: 'adventure_suite', assignedRoom: 5, quantity: '1', autoOwnerBlock: true, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'owner-derived', status: 'blocked', roomCode: 'adventure_suite', assignedRoom: 5, quantity: 1, autoOwnerBlock: true, checkIn: '2027-11-05', checkOut: '2027-11-08' }
], '2027-11-05', '2027-11-08');

assertEqual(
  migrationSnapshot.migrationIssueRows.map(function(row) { return row._id; }),
  [
    'missing-unit', 'legacy-aggregate', 'room-unit-mismatch',
    'quantity-missing', 'quantity-null', 'quantity-zero',
    'quantity-negative', 'quantity-text', 'non-overlap-quantity-text',
    'owner-invalid-quantity'
  ],
  'every malformed active inventory row is diagnosed without treating owner blocks as guest occupancy'
);

const nightlySnapshot = context.rules.buildInventorySnapshot([
  { _id: 'unit-3', status: 'confirmed', assignedRoom: 3, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-07' },
  { _id: 'unit-4', status: 'confirmed', assignedRoom: 4, quantity: 1, checkIn: '2027-11-06', checkOut: '2027-11-08' },
  { _id: 'owner-5', status: 'blocked', assignedRoom: 5, quantity: 1, autoOwnerBlock: true, checkIn: '2027-11-05', checkOut: '2027-11-08' }
], '2027-11-05', '2027-11-08');

assertEqual(
  nightlySnapshot.occupiedUnitsByNight,
  {
    '2027-11-05': [3],
    '2027-11-06': [3, 4],
    '2027-11-07': [4]
  },
  'guest occupancy is projected per occupied night with exclusive checkout'
);

const conflictSnapshot = context.rules.buildInventorySnapshot([
  { _id: 'claim-b', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 3, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-07' },
  { _id: 'claim-a', status: 'hold', roomCode: 'adventure_suite', assignedRoom: '3', quantity: 1, checkIn: '2027-11-06', checkOut: '2027-11-08' }
], '2027-11-05', '2027-11-08');

assertEqual(
  conflictSnapshot.duplicateUnitClaims,
  [{ night: '2027-11-06', unit: 3, rowIds: ['claim-a', 'claim-b'] }],
  'duplicate physical-unit claims are reported deterministically per night'
);

assertThrows(
  function() { context.rules.buildInventorySnapshot([], null, '2027-11-08'); },
  'Invalid inventory dates',
  'a missing check-in date is rejected'
);

assertThrows(
  function() { context.rules.buildInventorySnapshot([], ' 2027-11-05', '2027-11-08 '); },
  'Invalid inventory dates',
  'request date strings with surrounding whitespace are rejected'
);

const malformedSnapshot = context.rules.buildInventorySnapshot([
  { _id: 'missing-dates', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 3, quantity: 1 },
  { _id: 'reversed-row', status: 'hold', roomCode: 'adventure_suite', assignedRoom: 4, quantity: 1, checkIn: '2027-11-08', checkOut: '2027-11-05' },
  { _id: 'invalid-date-type', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 5, quantity: 1, checkIn: true, checkOut: '2027-11-08' },
  { _id: 'impossible-date', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 3, quantity: 1, checkIn: '2027-02-30', checkOut: '2027-03-05' },
  { _id: 'date-with-junk', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 4, quantity: 1, checkIn: '2027-11-05junk', checkOut: '2027-11-08' },
  { _id: 'date-with-whitespace', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 5, quantity: 1, checkIn: ' 2027-11-05', checkOut: '2027-11-08 ' }
], '2027-11-05', '2027-11-08');

assertEqual(
  malformedSnapshot.migrationIssueRows.map(function(row) { return row._id; }),
  ['missing-dates', 'reversed-row', 'invalid-date-type', 'impossible-date', 'date-with-junk', 'date-with-whitespace'],
  'active rows with malformed dates are surfaced for migration'
);
