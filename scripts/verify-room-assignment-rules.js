// Behavioral tests for automatic physical-room assignment and owner reserve.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error('FAIL: ' + message);
  console.log('PASS: ' + message);
}

const sourcePath = path.join(__dirname, '..', 'velo', 'backend', 'roomAssignmentRules.js');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/export const /g, 'var ')
  .replace(/export function /g, 'function ')
  + '\nthis.rules = { chooseAutomaticUnits, ownerUnitForOccupiedUnits, roomCodeForUnit };';
const context = {};
vm.createContext(context);
vm.runInContext(source, context);
const rules = context.rules;

assert(JSON.stringify(rules.chooseAutomaticUnits('penthouse_apartment', 1, [])) === '[1]', 'Penthouse automatically receives Unit 1');
assert(JSON.stringify(rules.chooseAutomaticUnits('two_bedroom_apartment', 1, [])) === '[2]', 'Two-Bedroom automatically receives Unit 2');
assert(JSON.stringify(rules.chooseAutomaticUnits('adventure_suite', 1, [])) === '[3]', 'first Adventure booking receives Unit 3');
assert(JSON.stringify(rules.chooseAutomaticUnits('adventure_suite', 1, [3])) === '[4]', 'next Adventure booking receives Unit 4');
assert(rules.chooseAutomaticUnits('adventure_suite', 1, [3, 4]).length === 0, 'single Adventure booking never automatically receives Unit 5');
assert(JSON.stringify(rules.chooseAutomaticUnits('adventure_suite', 2, [])) === '[3,4]', 'two Adventure Suites receive Units 3 and 4');
assert(JSON.stringify(rules.chooseAutomaticUnits('adventure_suite', 3, [])) === '[3,4,5]', 'one three-suite booking receives Units 3, 4, and 5');
assert(rules.ownerUnitForOccupiedUnits([3, 4]) === 5, 'Units 3 and 4 reserve Unit 5 for owners');
assert(rules.ownerUnitForOccupiedUnits([3, 4, 5]) === 1, 'three occupied Adventure Suites reserve Penthouse Unit 1');
assert(rules.ownerUnitForOccupiedUnits([1, 3, 4, 5]) === 2, 'if Penthouse is occupied, Unit 2 is reserved for owners');
assert(rules.ownerUnitForOccupiedUnits([1, 2, 3, 4]) === 5, 'any four occupied rooms reserve the remaining unit');
assert(rules.roomCodeForUnit(5) === 'adventure_suite', 'Unit 5 maps to Adventure Suite');

const ownerPath = path.join(__dirname, '..', 'velo', 'backend', 'ownerBlocks.js');
const ownerSource = fs.readFileSync(ownerPath, 'utf8');
const intervalStart = ownerSource.indexOf('function noonUtc');
const intervalEnd = ownerSource.indexOf('function blockKey', intervalStart);
const ownerContext = { Date, ownerUnitForOccupiedUnits: rules.ownerUnitForOccupiedUnits };
vm.createContext(ownerContext);
vm.runInContext(ownerSource.slice(intervalStart, intervalEnd) + '\nthis.desiredIntervals = desiredIntervals;', ownerContext);
const rows = [
  { assignedRoom: 3, checkIn: '2027-11-01T12:00:00.000Z', checkOut: '2027-11-06T12:00:00.000Z' },
  { assignedRoom: 4, checkIn: '2027-11-03T12:00:00.000Z', checkOut: '2027-11-08T12:00:00.000Z' },
  { assignedRoom: 5, checkIn: '2027-11-04T12:00:00.000Z', checkOut: '2027-11-05T12:00:00.000Z' },
  { assignedRoom: 1, checkIn: '2027-11-04T12:00:00.000Z', checkOut: '2027-11-05T12:00:00.000Z' }
];
const intervals = ownerContext.desiredIntervals(
  rows,
  new Date('2027-11-01T12:00:00.000Z'),
  new Date('2027-11-08T12:00:00.000Z')
).map(i => ({ unit: i.unit, start: i.checkIn.toISOString().slice(0, 10), end: i.checkOut.toISOString().slice(0, 10) }));
assert(JSON.stringify(intervals) === JSON.stringify([
  { unit: 5, start: '2027-11-03', end: '2027-11-04' },
  { unit: 2, start: '2027-11-04', end: '2027-11-05' },
  { unit: 5, start: '2027-11-05', end: '2027-11-06' }
]), 'owner blocks cover only exact overlap nights and move 5 → 2 → 5');

const assignmentPath = path.join(__dirname, '..', 'velo', 'backend', 'roomAssignments.js');
const assignmentSource = fs.readFileSync(assignmentPath, 'utf8');
const capacityStart = assignmentSource.indexOf('function toDate');
const capacityEnd = assignmentSource.indexOf('export async function planAutomaticAssignments', capacityStart);
const capacityContext = { MAX_GUEST_OR_MANUAL_UNITS: 4 };
vm.createContext(capacityContext);
vm.runInContext(
  assignmentSource.slice(capacityStart, capacityEnd).replace(/export /g, '') +
    '\nthis.assertPropertyCapacity = assertPropertyCapacity;',
  capacityContext
);
const capacityRows = [1, 2, 3].map(unit => ({
  assignedRoom: unit,
  quantity: 1,
  status: 'confirmed',
  checkIn: '2027-11-01T12:00:00.000Z',
  checkOut: '2027-11-08T12:00:00.000Z'
}));
capacityContext.assertPropertyCapacity(capacityRows, '2027-11-01', '2027-11-08', [4]);
assert(true, 'four occupied guest/manual units are allowed');
let rejectedFifth = false;
try {
  capacityContext.assertPropertyCapacity(capacityRows, '2027-11-01', '2027-11-08', [4, 5]);
} catch (e) { rejectedFifth = /owners/.test(e.message); }
assert(rejectedFifth, 'a fifth guest/manual occupied unit is rejected');
capacityContext.assertPropertyCapacity(
  capacityRows.concat([{ assignedRoom: 5, autoOwnerBlock: true, quantity: 1, checkIn: '2027-11-01', checkOut: '2027-11-08' }]),
  '2027-11-01',
  '2027-11-08',
  [4]
);
assert(true, 'derived owner blocks do not double-count guest capacity');
