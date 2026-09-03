// Behavioral tests for pure physical-room availability decisions.
// Run: node scripts/verify-room-availability-rules.js
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
const inventoryPath = path.join(__dirname, '..', 'velo', 'backend', 'roomInventoryRules.js');
const availabilityPath = path.join(__dirname, '..', 'velo', 'backend', 'roomAvailabilityRules.js');
const source = (
  fs.readFileSync(assignmentPath, 'utf8') + '\n' +
  fs.readFileSync(inventoryPath, 'utf8').replace(/^import .*;\s*$/gm, '') + '\n' +
  fs.readFileSync(availabilityPath, 'utf8').replace(/^import .*;\s*$/gm, '')
)
  .replace(/export const /g, 'var ')
  .replace(/export function /g, 'function ')
  + '\nthis.rules = { buildInventorySnapshot, evaluateAutomaticAvailability, maximumAutomaticQuantity };';
const context = { Date };
vm.createContext(context);
vm.runInContext(source, context);

const emptySnapshot = {
  occupiedUnits: [],
  occupiedUnitsByNight: {
    '2027-11-05': [],
    '2027-11-06': []
  },
  migrationIssueRows: [],
  duplicateUnitClaims: [],
  unknownStatusRows: []
};

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(null, 'penthouse_apartment', 1);
  },
  'Invalid inventory snapshot',
  'availability rejects a missing inventory snapshot instead of treating it as empty'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability({}, 'penthouse_apartment', 1);
  },
  'Invalid inventory snapshot',
  'availability requires every inventory projection and diagnostic field'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(Object.create(emptySnapshot), 'penthouse_apartment', 1);
  },
  'Invalid inventory snapshot',
  'availability requires snapshot fields to be direct properties'
);

const inheritedUnitPrototype = Object.create(Array.prototype);
inheritedUnitPrototype[0] = 1;
const inheritedUnitList = [];
inheritedUnitList.length = 1;
Object.setPrototypeOf(inheritedUnitList, inheritedUnitPrototype);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(Object.assign({}, emptySnapshot, {
      occupiedUnits: inheritedUnitList,
      occupiedUnitsByNight: { '2027-11-05': inheritedUnitList }
    }), 'adventure_suite', 1);
  },
  'Invalid inventory snapshot',
  'availability rejects sparse unit arrays backed by inherited indices'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(Object.assign({}, emptySnapshot, {
      occupiedUnits: [3]
    }), 'penthouse_apartment', 1);
  },
  'Invalid inventory snapshot',
  'stay-wide occupied units must match the union of nightly occupancy'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(Object.assign({}, emptySnapshot, {
      occupiedUnitsByNight: { 'not-a-night': [] }
    }), 'penthouse_apartment', 1);
  },
  'Invalid inventory snapshot',
  'nightly occupancy keys must be valid calendar dates'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(Object.assign({}, emptySnapshot, {
      occupiedUnitsByNight: { '2027-02-30': [] }
    }), 'penthouse_apartment', 1);
  },
  'Invalid inventory snapshot',
  'impossible nightly calendar dates are rejected'
);

assertEqual(
  context.rules.evaluateAutomaticAvailability(Object.assign({}, emptySnapshot, {
    occupiedUnitsByNight: {
      '2028-01-01': [],
      '2027-12-31': []
    }
  }), 'penthouse_apartment', 1),
  { available: true, units: [1] },
  'reordered nightly keys remain deterministic across a year boundary'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(Object.assign({}, emptySnapshot, {
      occupiedUnitsByNight: {
        '2027-11-05': [],
        '2027-11-07': []
      }
    }), 'penthouse_apartment', 1);
  },
  'Invalid inventory snapshot',
  'nightly occupancy keys must form one consecutive stay'
);

assertEqual(
  context.rules.evaluateAutomaticAvailability(emptySnapshot, 'penthouse_apartment', 1),
  { available: true, units: [1] },
  'an unoccupied Penthouse is available as physical Unit 1'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(emptySnapshot, 'penthouse_apartment', null);
  },
  'Invalid room quantity',
  'availability rejects a null room quantity instead of returning available with no units'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(emptySnapshot, 'penthouse_apartment', 2);
  },
  'Invalid room quantity',
  'fixed-unit room types reject quantities greater than one'
);

['toString', 'constructor', '__proto__'].forEach(function(roomCode) {
  assertThrows(
    function() {
      context.rules.evaluateAutomaticAvailability(emptySnapshot, roomCode, 1);
    },
    'Invalid room code',
    'availability rejects prototype-chain room code ' + roomCode
  );
});

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(emptySnapshot, new String('adventure_suite'), 1);
  },
  'Invalid room code',
  'availability rejects boxed and coercible non-primitive room codes'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(Object.assign({}, emptySnapshot, {
      migrationIssueRows: [{ _id: 'legacy-row' }]
    }), 'penthouse_apartment', 1);
  },
  'Inventory migration required',
  'availability fails closed when active inventory requires migration'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(Object.assign({}, emptySnapshot, {
      unknownStatusRows: [{ _id: 'unknown-status' }]
    }), 'penthouse_apartment', 1);
  },
  'Inventory status review required',
  'availability fails closed when overlapping inventory has an unknown status'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(Object.assign({}, emptySnapshot, {
      duplicateUnitClaims: [{ night: '2027-11-05', unit: 1 }]
    }), 'penthouse_apartment', 1);
  },
  'Inventory conflict review required',
  'availability fails closed when physical-unit claims conflict'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(Object.assign({}, emptySnapshot, {
      duplicateUnitClaims: [{ night: '2027-11-05', unit: 1 }],
      unknownStatusRows: [{ _id: 'unknown-status' }]
    }), 'penthouse_apartment', 1);
  },
  'Inventory conflict review required',
  'duplicate claims take deterministic precedence over unknown statuses'
);

const ownerCapacitySnapshot = Object.assign({}, emptySnapshot, {
  occupiedUnits: [2, 3, 4, 5],
  occupiedUnitsByNight: {
    '2027-11-05': [2, 3, 4, 5],
    '2027-11-06': []
  }
});

assertEqual(
  context.rules.evaluateAutomaticAvailability(ownerCapacitySnapshot, 'penthouse_apartment', 1),
  { available: false, units: [], reason: 'owner_reserve_capacity' },
  'availability keeps at least one physical room free for the owners each night'
);

assertEqual(
  context.rules.evaluateAutomaticAvailability(Object.assign({}, emptySnapshot, {
    occupiedUnits: [1],
    occupiedUnitsByNight: { '2027-11-05': [1] }
  }), 'penthouse_apartment', 1),
  { available: false, units: [], reason: 'physical_units_unavailable' },
  'an occupied Penthouse is unavailable for the requested stay'
);

assertEqual(
  context.rules.evaluateAutomaticAvailability(emptySnapshot, 'two_bedroom_apartment', 1),
  { available: true, units: [2] },
  'an unoccupied Two-Bedroom is available as physical Unit 2'
);

assertEqual(
  context.rules.evaluateAutomaticAvailability(emptySnapshot, 'adventure_suite', 2),
  { available: true, units: [3, 4] },
  'two Adventure Suites require physical Units 3 and 4 for the entire stay'
);

assertEqual(
  context.rules.evaluateAutomaticAvailability(emptySnapshot, 'adventure_suite', '2'),
  { available: true, units: [3, 4] },
  'canonical numeric quantity text is accepted without broader coercion'
);

assertThrows(
  function() {
    context.rules.evaluateAutomaticAvailability(emptySnapshot, 'adventure_suite', ' 2');
  },
  'Invalid room quantity',
  'whitespace-padded quantity text is rejected'
);

assertEqual(
  context.rules.evaluateAutomaticAvailability(emptySnapshot, 'adventure_suite', 3),
  { available: true, units: [3, 4, 5] },
  'a three-suite request may include physical Unit 5'
);

assertEqual(
  context.rules.maximumAutomaticQuantity(emptySnapshot, 'adventure_suite'),
  3,
  'maximum automatic quantity returns all three Adventure Suites when permitted'
);

const oneAdventureOccupiedSnapshot = Object.assign({}, emptySnapshot, {
  occupiedUnits: [3],
  occupiedUnitsByNight: {
    '2027-11-05': [3],
    '2027-11-06': [3]
  }
});

assertEqual(
  context.rules.maximumAutomaticQuantity(oneAdventureOccupiedSnapshot, 'adventure_suite'),
  1,
  'maximum automatic quantity falls back to the one remaining standard Adventure unit'
);

assertThrows(
  function() {
    context.rules.maximumAutomaticQuantity(Object.assign({}, emptySnapshot, {
      migrationIssueRows: [{ _id: 'legacy-row' }]
    }), 'adventure_suite');
  },
  'Inventory migration required',
  'maximum automatic quantity propagates inventory integrity errors'
);

const staggeredAdventureSnapshot = Object.assign({}, emptySnapshot, {
  occupiedUnits: [3, 4],
  occupiedUnitsByNight: {
    '2027-11-05': [3],
    '2027-11-06': [4]
  }
});

assertEqual(
  context.rules.evaluateAutomaticAvailability(staggeredAdventureSnapshot, 'adventure_suite', 1),
  { available: false, units: [], reason: 'physical_units_unavailable' },
  'one Adventure Suite cannot switch physical units during a stay'
);

const nightlyCapacitySnapshot = Object.assign({}, emptySnapshot, {
  occupiedUnits: [1, 2],
  occupiedUnitsByNight: {
    '2027-11-05': [1],
    '2027-11-06': [2]
  }
});

assertEqual(
  context.rules.evaluateAutomaticAvailability(nightlyCapacitySnapshot, 'adventure_suite', 3),
  { available: true, units: [3, 4, 5] },
  'owner capacity is checked nightly rather than against the stay-wide union'
);

const snapshotBeforeEvaluation = JSON.stringify(nightlyCapacitySnapshot);
context.rules.evaluateAutomaticAvailability(nightlyCapacitySnapshot, 'adventure_suite', 3);
assertEqual(
  JSON.stringify(nightlyCapacitySnapshot),
  snapshotBeforeEvaluation,
  'availability evaluation does not mutate the snapshot or nested nightly arrays'
);

const exceededNightlyCapacitySnapshot = Object.assign({}, emptySnapshot, {
  occupiedUnits: [1, 2],
  occupiedUnitsByNight: {
    '2027-11-05': [1, 2],
    '2027-11-06': []
  }
});

assertEqual(
  context.rules.evaluateAutomaticAvailability(exceededNightlyCapacitySnapshot, 'adventure_suite', 3),
  { available: false, units: [], reason: 'owner_reserve_capacity' },
  'three suites are unavailable when five guest or manual units would be occupied on one night'
);

const turnoverSnapshot = context.rules.buildInventorySnapshot([
  {
    _id: 'checks-out-at-arrival',
    status: 'confirmed',
    roomCode: 'adventure_suite',
    assignedRoom: 3,
    quantity: 1,
    checkIn: '2027-11-01',
    checkOut: '2027-11-05'
  },
  {
    _id: 'checks-in-at-departure',
    status: 'confirmed',
    roomCode: 'adventure_suite',
    assignedRoom: 4,
    quantity: 1,
    checkIn: '2027-11-08',
    checkOut: '2027-11-10'
  }
], '2027-11-05', '2027-11-08');

assertEqual(
  context.rules.evaluateAutomaticAvailability(turnoverSnapshot, 'adventure_suite', 2),
  { available: true, units: [3, 4] },
  'inventory projection and availability preserve same-day checkout and check-in turnover'
);
