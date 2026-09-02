// Behavioral tests for pure physical-room assignment rules.
// Run: node scripts/verify-room-assignment-rules.js
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

const sourcePath = path.join(__dirname, '..', 'velo', 'backend', 'roomAssignmentRules.js');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/export const /g, 'var ')
  .replace(/export function /g, 'function ')
  + '\nthis.rules = {'
  + ' chooseAutomaticUnits,'
  + " ownerUnitForOccupiedUnits: typeof ownerUnitForOccupiedUnits === 'function' ? ownerUnitForOccupiedUnits : undefined,"
  + " roomCodeForUnit: typeof roomCodeForUnit === 'function' ? roomCodeForUnit : undefined"
  + ' };';
const context = {};
vm.createContext(context);
vm.runInContext(source, context);

assertEqual(
  context.rules.chooseAutomaticUnits('penthouse_apartment', 1, []),
  [1],
  'Penthouse automatically receives physical Unit 1'
);

assertEqual(
  context.rules.chooseAutomaticUnits('adventure_suite', 1),
  [3],
  'a missing occupied-unit list is treated as an empty list'
);

assertEqual(
  context.rules.chooseAutomaticUnits('two_bedroom_apartment', 1, []),
  [2],
  'Two-Bedroom automatically receives physical Unit 2'
);

assertEqual(
  ['toString', 'constructor', '__proto__'].map(function(roomCode) {
    return context.rules.chooseAutomaticUnits(roomCode, 1, []);
  }),
  [[], [], []],
  'prototype property names are rejected as unknown room codes'
);

assertEqual(
  context.rules.chooseAutomaticUnits('adventure_suite', 1, []),
  [3],
  'first Adventure Suite automatically receives physical Unit 3'
);

assertEqual(
  context.rules.chooseAutomaticUnits('adventure_suite', 1, [3]),
  [4],
  'next Adventure Suite automatically receives physical Unit 4'
);

assertEqual(
  context.rules.chooseAutomaticUnits('adventure_suite', 1, ['3']),
  [4],
  'numeric occupied-unit text is normalized before assignment'
);

assertEqual(
  context.rules.chooseAutomaticUnits('adventure_suite', 1, [3, 4]),
  [],
  'a single Adventure Suite never automatically receives owner-reserve Unit 5'
);

assertEqual(
  context.rules.chooseAutomaticUnits('penthouse_apartment', 1, [1]),
  [],
  'an occupied fixed Penthouse unit cannot be assigned again'
);

assertEqual(
  context.rules.chooseAutomaticUnits('adventure_suite', 2, []),
  [3, 4],
  'two Adventure Suites automatically receive physical Units 3 and 4'
);

assertEqual(
  context.rules.chooseAutomaticUnits('adventure_suite', '2', []),
  [3, 4],
  'numeric quantity text is normalized before assignment'
);

assertEqual(
  context.rules.chooseAutomaticUnits('adventure_suite', 3, []),
  [3, 4, 5],
  'one three-suite booking may automatically include physical Unit 5'
);

assertEqual(
  context.rules.ownerUnitForOccupiedUnits([3, 4]),
  5,
  'occupied Adventure Units 3 and 4 reserve physical Unit 5 for owners'
);

assertEqual(
  context.rules.ownerUnitForOccupiedUnits(['3', '4']),
  5,
  'numeric occupied-unit text is normalized for owner reserves'
);

assertEqual(
  context.rules.ownerUnitForOccupiedUnits(),
  null,
  'a missing occupied-unit list creates no owner reserve'
);

assertEqual(
  context.rules.ownerUnitForOccupiedUnits([3, 4, 5]),
  1,
  'three occupied Adventure Suites reserve Penthouse Unit 1 for owners'
);

assertEqual(
  context.rules.ownerUnitForOccupiedUnits([1, 3, 4, 5]),
  2,
  'occupied Penthouse moves the owner reserve to physical Unit 2'
);

assertEqual(
  context.rules.ownerUnitForOccupiedUnits([1, 2, 3, 4, 5]),
  null,
  'a fully occupied property has no unit left to reserve for owners'
);

assertEqual(
  context.rules.ownerUnitForOccupiedUnits([1, 2, 3, 5]),
  4,
  'four occupied units reserve the one remaining physical unit for owners'
);

assertEqual(
  context.rules.roomCodeForUnit(5),
  'adventure_suite',
  'physical Unit 5 maps to the Adventure Suite room type'
);

assertEqual(
  context.rules.roomCodeForUnit(1),
  'penthouse_apartment',
  'physical Unit 1 maps to the Penthouse room type'
);

assertEqual(
  context.rules.roomCodeForUnit(2),
  'two_bedroom_apartment',
  'physical Unit 2 maps to the Two-Bedroom room type'
);

assertEqual(
  context.rules.roomCodeForUnit(3),
  'adventure_suite',
  'physical Unit 3 maps to the Adventure Suite room type'
);

assertEqual(
  context.rules.roomCodeForUnit(4),
  'adventure_suite',
  'physical Unit 4 maps to the Adventure Suite room type'
);

assertEqual(
  context.rules.roomCodeForUnit(6),
  '',
  'an unknown physical unit has no room-type mapping'
);

assertEqual(
  context.rules.roomCodeForUnit('4'),
  '',
  'numeric text is not accepted as a physical-unit identifier'
);

assertEqual(
  context.rules.roomCodeForUnit(3.5),
  '',
  'a non-integer value is not accepted as a physical-unit identifier'
);

assertEqual(
  context.rules.roomCodeForUnit(null),
  '',
  'null has no physical-unit mapping'
);

assertEqual(
  context.rules.roomCodeForUnit(),
  '',
  'an omitted unit has no physical-unit mapping'
);
