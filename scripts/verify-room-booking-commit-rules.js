// Behavioral tests for pure physical-room booking commit plans.
// Run: node scripts/verify-room-booking-commit-rules.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    const copy = {};
    Object.keys(value).sort().forEach(function(key) {
      copy[key] = comparable(value[key]);
    });
    return copy;
  }
  return value;
}

function assertEqual(actual, expected, message) {
  const actualJson = JSON.stringify(comparable(actual));
  const expectedJson = JSON.stringify(comparable(expected));
  if (actualJson !== expectedJson) {
    throw new Error(`FAIL: ${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`);
  }
  console.log(`PASS: ${message}`);
}

function assertThrows(fn, expectedMessage, message) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  if (!thrown || thrown.message !== expectedMessage) {
    throw new Error(`FAIL: ${message}\nExpected error: ${expectedMessage}\nActual error:   ${thrown && thrown.message}`);
  }
  console.log(`PASS: ${message}`);
}

const backendDir = path.join(__dirname, '..', 'velo', 'backend');
const source = [
  'roomAssignmentRules.js',
  'roomAvailabilityRules.js',
  'roomBookingCommitRules.js'
].map(function(file) {
  return fs.readFileSync(path.join(backendDir, file), 'utf8');
}).join('\n')
  .replace(/^import .*;\s*$/gm, '')
  .replace(/export function /g, 'function ')
  + '\nthis.rules = { buildPhysicalCommitPlan, validatePhysicalCommit, planPhysicalRollback };'
  + '\nthis.rulesInternal = { claimState, validateClaimLedger };';

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

const firstPlan = context.rules.buildPhysicalCommitPlan(emptySnapshot, [], {
  roomCode: 'adventure_suite',
  quantity: 1,
  checkIn: '2027-11-05',
  checkOut: '2027-11-07',
  bookingNumber: 'WC-2001',
  operationId: 'abcdefghijklmnopqrstu1',
  payloadDigest: '1111111111111111111111111111111111111111111111111111111111111111'
});
assertEqual(firstPlan.acquisitions[0]._id,
  'rc1-op-abcdefghijklmnopqrstu1-a',
  'operation identity is acquired before capacity and unit claims');
assertEqual({
  manifestVersion: firstPlan.acquisitions[0].manifestVersion,
  manifestCheckIn: firstPlan.acquisitions[0].manifestCheckIn,
  manifestCheckOut: firstPlan.acquisitions[0].manifestCheckOut,
  manifestRoomCode: firstPlan.acquisitions[0].manifestRoomCode,
  manifestUnits: firstPlan.acquisitions[0].manifestUnits,
  manifestBookingRowIds: firstPlan.acquisitions[0].manifestBookingRowIds,
  manifestResourceClaimIds: firstPlan.acquisitions[0].manifestResourceClaimIds
}, {
  manifestVersion: 1,
  manifestCheckIn: '2027-11-05',
  manifestCheckOut: '2027-11-07',
  manifestRoomCode: 'adventure_suite',
  manifestUnits: '3',
  manifestBookingRowIds: 'pb1-abcdefghijklmnopqrstu1-r1',
  manifestResourceClaimIds: [
    'rc1-20271105-s1-000001-a',
    'rc1-20271106-s1-000001-a',
    'rc1-20271105-u3-000001-a',
    'rc1-20271106-u3-000001-a'
  ].join('|')
}, 'operation identity permanently declares the complete deterministic commit manifest');

function operationCompletion(identity, completionState, confirmedResourceCount) {
  return {
    _id: 'rc1-op-' + identity.operationId + '-c',
    protocolVersion: 1,
    claimKey: 'operation:' + identity.operationId + ':completion',
    generation: 1,
    eventType: 'complete',
    claimType: 'operation-completion',
    operationId: identity.operationId,
    bookingRowId: identity.bookingRowId,
    bookingNumber: identity.bookingNumber,
    payloadDigest: identity.payloadDigest,
    completionState: completionState,
    confirmedResourceCount: confirmedResourceCount
  };
}

const firstCompletion = operationCompletion(
  firstPlan.acquisitions[0], 'complete', firstPlan.acquisitions.length - 1);
assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot,
    firstPlan.acquisitions.concat([firstCompletion]), {
      roomCode: 'adventure_suite', quantity: 1,
      checkIn: '2027-11-05', checkOut: '2027-11-07', bookingNumber: 'WC-2001',
      operationId: 'abcdefghijklmnopqrstu1',
      payloadDigest: '1111111111111111111111111111111111111111111111111111111111111111'
    });
}, 'Operation requires reconciliation',
'an exact completion fence is valid permanent history for its fully acquired manifest');

assertThrows(function() {
  context.rulesInternal.validateClaimLedger(firstPlan.acquisitions.concat([
    operationCompletion(firstPlan.acquisitions[0], 'complete',
      firstPlan.acquisitions.length - 2)
  ]));
}, 'Invalid claim ledger',
'a complete fence count must equal the full manifest acquisition count');

assertThrows(function() {
  context.rulesInternal.validateClaimLedger(firstPlan.acquisitions.concat([
    operationCompletion(firstPlan.acquisitions[0], 'stopped',
      firstPlan.acquisitions.length - 1)
  ]));
}, 'Invalid claim ledger',
'a stopped fence cannot certify a fully acquired manifest');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, [
    firstPlan.acquisitions[0], firstPlan.acquisitions[1],
    operationCompletion(firstPlan.acquisitions[0], 'complete', 1)
  ], {
    roomCode: 'adventure_suite', quantity: 1,
    checkIn: '2027-11-05', checkOut: '2027-11-07', bookingNumber: 'WC-OTHER',
    operationId: 'premature-completion1',
    payloadDigest: '2323232323232323232323232323232323232323232323232323232323232323'
  });
}, 'Invalid claim ledger', 'a complete fence cannot certify a partial manifest prefix');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot,
    firstPlan.acquisitions.concat([
      firstCompletion,
      Object.assign({}, firstCompletion, { completionState: 'stopped' })
    ]), {
      roomCode: 'adventure_suite', quantity: 1,
      checkIn: '2027-11-05', checkOut: '2027-11-07', bookingNumber: 'WC-OTHER',
      operationId: 'duplicate-completion1',
      payloadDigest: '2424242424242424242424242424242424242424242424242424242424242424'
    });
}, 'Invalid claim ledger', 'an operation can have only one immutable completion fence');

const competingPlan = context.rules.buildPhysicalCommitPlan(emptySnapshot, [], {
  roomCode: 'adventure_suite',
  quantity: 1,
  checkIn: '2027-11-05',
  checkOut: '2027-11-07',
  bookingNumber: 'WC-2002',
  operationId: 'abcdefghijklmnopqrstu2',
  payloadDigest: '2222222222222222222222222222222222222222222222222222222222222222'
});

assertEqual(
  firstPlan.acquisitions.filter(function(event) { return event.claimType !== 'operation'; })
    .map(function(event) { return event._id; }),
  competingPlan.acquisitions.filter(function(event) { return event.claimType !== 'operation'; })
    .map(function(event) { return event._id; }),
  'simultaneous plans for the same physical unit and nights contend on identical claim IDs'
);

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(Object.assign({}, emptySnapshot, {
    occupiedUnitsByNight: { '2027-12-01': [] }
  }), [firstPlan.acquisitions[0]], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-12-01',
    checkOut: '2027-12-02',
    bookingNumber: 'WC-2001',
    operationId: 'abcdefghijklmnopqrstu1',
    payloadDigest: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  });
}, 'Operation identity conflict', 'an operation ID cannot be reused with a different payload digest');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(Object.assign({}, emptySnapshot, {
    occupiedUnitsByNight: { '2027-12-01': [] }
  }), [firstPlan.acquisitions[0]], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-12-01',
    checkOut: '2027-12-02',
    bookingNumber: 'WC-DIFFERENT',
    operationId: 'abcdefghijklmnopqrstu1',
    payloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  });
}, 'Operation identity conflict', 'an operation ID cannot be reused with a different booking number');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(Object.assign({}, emptySnapshot, {
    occupiedUnits: [3],
    occupiedUnitsByNight: {
      '2027-11-05': [3],
      '2027-11-06': [3]
    }
  }), firstPlan.acquisitions, {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-2001',
    operationId: 'abcdefghijklmnopqrstu1',
    payloadDigest: '1111111111111111111111111111111111111111111111111111111111111111'
  });
}, 'Operation requires reconciliation',
'an identical completed operation cannot reserve a second physical assignment');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, [firstPlan.acquisitions[0]], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-2001',
    operationId: 'abcdefghijklmnopqrstu1',
    payloadDigest: '1111111111111111111111111111111111111111111111111111111111111111'
  });
}, 'Operation requires reconciliation',
'an identity-only partial operation cannot allocate resources without reconciliation');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(Object.assign({}, emptySnapshot, {
    occupiedUnits: [3],
    occupiedUnitsByNight: {
      '2027-11-05': [3],
      '2027-11-06': [3]
    }
  }), firstPlan.acquisitions.filter(function(event) {
    return event.claimType !== 'operation';
  }), {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-ORPHANED-RESOURCE',
    operationId: 'orphanresourceop01',
    payloadDigest: 'abababababababababababababababababababababababababababababababab'
  });
}, 'Invalid claim ledger', 'resource claims require their permanent operation identity');

const unpairedHistoricalCapacity = firstPlan.acquisitions.find(function(event) {
  return event.claimType === 'capacity';
});
const unpairedHistoricalRelease = Object.assign({}, unpairedHistoricalCapacity, {
  _id: unpairedHistoricalCapacity._id.slice(0, -1) + 'r',
  eventType: 'release',
  releaseReason: 'adversarial-unpaired-history'
});
const stoppedPrefixCompletion = operationCompletion(firstPlan.acquisitions[0], 'stopped', 1);
assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, [
    firstPlan.acquisitions[0],
    unpairedHistoricalCapacity,
    unpairedHistoricalRelease,
    stoppedPrefixCompletion
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-2001',
    operationId: 'abcdefghijklmnopqrstu1',
    payloadDigest: '1111111111111111111111111111111111111111111111111111111111111111'
  });
}, 'Operation requires reconciliation',
'declared partial acquisition history remains valid and reconciliation-only after release');

assertThrows(function() {
  const resourceWithManifestField = firstPlan.acquisitions.map(function(event, index) {
    return index === 1 ? Object.assign({}, event, { manifestVersion: 1 }) : event;
  });
  context.rules.buildPhysicalCommitPlan(Object.assign({}, emptySnapshot, {
    occupiedUnits: [3],
    occupiedUnitsByNight: {
      '2027-11-05': [3],
      '2027-11-06': [3]
    }
  }), resourceWithManifestField, {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-2001',
    operationId: 'abcdefghijklmnopqrstu1',
    payloadDigest: '1111111111111111111111111111111111111111111111111111111111111111'
  });
}, 'Invalid claim ledger',
'manifest metadata is exclusive to the permanent operation identity event');

assertThrows(function() {
  const invalidUnitFiveManifest = firstPlan.acquisitions.map(function(event) {
    if (event.claimType === 'operation') {
      return Object.assign({}, event, {
        manifestUnits: '5',
        manifestResourceClaimIds: event.manifestResourceClaimIds.replace(/-u3-/g, '-u5-')
      });
    }
    if (event.claimType !== 'unit') return event;
    return Object.assign({}, event, {
      _id: event._id.replace('-u3-', '-u5-'),
      claimKey: event.claimKey.replace(':3', ':5'),
      unit: 5
    });
  });
  context.rules.buildPhysicalCommitPlan(Object.assign({}, emptySnapshot, {
    occupiedUnits: [5],
    occupiedUnitsByNight: {
      '2027-11-05': [5],
      '2027-11-06': [5]
    }
  }), invalidUnitFiveManifest, {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-2001',
    operationId: 'abcdefghijklmnopqrstu1',
    payloadDigest: '1111111111111111111111111111111111111111111111111111111111111111'
  });
}, 'Invalid claim ledger',
'operation manifests cannot declare an impossible automatic room assignment');

const malformedHistoricalManifests = [
  ['missing manifest version', function(identity) { delete identity.manifestVersion; }],
  ['ten-thousand-year date range', function(identity) {
    identity.manifestCheckIn = '0000-01-01';
    identity.manifestCheckOut = '9999-12-31';
  }],
  ['reversed dates', function(identity) { identity.manifestCheckOut = identity.manifestCheckIn; }],
  ['unknown room code', function(identity) { identity.manifestRoomCode = 'unknown_room'; }],
  ['noncanonical units 03', function(identity) { identity.manifestUnits = '03'; }],
  ['noncanonical units +3', function(identity) { identity.manifestUnits = '+3'; }],
  ['noncanonical units 3e0', function(identity) { identity.manifestUnits = '3e0'; }],
  ['noncanonical units 0x3', function(identity) { identity.manifestUnits = '0x3'; }],
  ['noncanonical units leading space', function(identity) { identity.manifestUnits = ' 3'; }],
  ['noncanonical units trailing space', function(identity) { identity.manifestUnits = '3 '; }],
  ['noncanonical units trailing comma', function(identity) { identity.manifestUnits = '3,'; }],
  ['malformed row IDs', function(identity) { identity.manifestBookingRowIds = 'row-1'; }],
  ['resource count mismatch', function(identity) {
    identity.manifestResourceClaimIds = identity.manifestResourceClaimIds.split('|')[0];
  }],
  ['duplicate resource IDs', function(identity) {
    const id = identity.manifestResourceClaimIds.split('|')[0];
    identity.manifestResourceClaimIds = id + '|' + id;
  }],
  ['zero generation', function(identity) {
    identity.manifestResourceClaimIds =
      identity.manifestResourceClaimIds.replace('-000001-a', '-000000-a');
  }]
];
for (const malformedHistoricalManifest of malformedHistoricalManifests) {
  assertThrows(function() {
    const ledger = firstPlan.acquisitions.map(function(event, index) {
      if (index !== 0) return event;
      const identity = Object.assign({}, event);
      malformedHistoricalManifest[1](identity);
      return identity;
    });
    context.rules.buildPhysicalCommitPlan(emptySnapshot, ledger, {
      roomCode: 'adventure_suite',
      quantity: 1,
      checkIn: '2027-11-05',
      checkOut: '2027-11-07',
      bookingNumber: 'WC-2001',
      operationId: 'abcdefghijklmnopqrstu1',
      payloadDigest: '1111111111111111111111111111111111111111111111111111111111111111'
    });
  }, 'Invalid claim ledger',
  'historical ledger rejects ' + malformedHistoricalManifest[0]);
}

const planAfterDeclaredCompensation = context.rules.buildPhysicalCommitPlan(emptySnapshot, [
  firstPlan.acquisitions[0],
  unpairedHistoricalCapacity,
  unpairedHistoricalRelease,
  stoppedPrefixCompletion
], {
  roomCode: 'adventure_suite',
  quantity: 1,
  checkIn: '2027-11-05',
  checkOut: '2027-11-07',
  bookingNumber: 'WC-AFTER-COMPENSATION',
  operationId: 'aftercompensation001',
  payloadDigest: '1313131313131313131313131313131313131313131313131313131313131313'
});
assertEqual(planAfterDeclaredCompensation.acquisitions.slice(1).map(function(event) {
  return event._id;
}), [
  'rc1-20271105-s1-000002-a',
  'rc1-20271106-s1-000001-a',
  'rc1-20271105-u3-000001-a',
  'rc1-20271106-u3-000001-a'
], 'declared compensated prefixes free resources without erasing generation history');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, [
    firstPlan.acquisitions[0],
    firstPlan.acquisitions[2]
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-NONPREFIX',
    operationId: 'nonprefixobserver001',
    payloadDigest: '1414141414141414141414141414141414141414141414141414141414141414'
  });
}, 'Invalid claim ledger',
'undeclared holes in acquisition order remain invalid ledger corruption');

const turnoverSnapshot = {
  occupiedUnits: [],
  occupiedUnitsByNight: {
    '2027-11-07': [],
    '2027-11-08': []
  },
  migrationIssueRows: [],
  duplicateUnitClaims: [],
  unknownStatusRows: []
};

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(turnoverSnapshot, [], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-SNAPSHOT-1',
    operationId: 'snapshot-date-token01',
    payloadDigest: '0101010101010101010101010101010101010101010101010101010101010101'
  });
}, 'Invalid inventory snapshot', 'commit planning rejects a snapshot for different requested nights');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(Object.assign({}, emptySnapshot, {
    occupiedUnitsByNight: { '2027-11-05': [] }
  }), [], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-SNAPSHOT-2',
    operationId: 'snapshot-date-token02',
    payloadDigest: '0202020202020202020202020202020202020202020202020202020202020202'
  });
}, 'Invalid inventory snapshot', 'commit planning rejects a snapshot missing a requested night');

const turnoverPlan = context.rules.buildPhysicalCommitPlan(turnoverSnapshot, [], {
  roomCode: 'adventure_suite',
  quantity: 1,
  checkIn: '2027-11-07',
  checkOut: '2027-11-09',
  bookingNumber: 'WC-2003',
  operationId: 'abcdefghijklmnopqrstu3',
  payloadDigest: '3333333333333333333333333333333333333333333333333333333333333333'
});

assertEqual(
  firstPlan.acquisitions.map(function(event) { return event._id; })
    .filter(function(id) {
      return turnoverPlan.acquisitions.map(function(event) { return event._id; }).indexOf(id) !== -1;
    }),
  [],
  'exclusive checkout leaves adjacent stays with disjoint unit-night claims'
);

const twoRoomPlan = context.rules.buildPhysicalCommitPlan(emptySnapshot, [], {
  roomCode: 'adventure_suite',
  quantity: 2,
  checkIn: '2027-11-05',
  checkOut: '2027-11-07',
  bookingNumber: 'WC-2004',
  operationId: 'abcdefghijklmnopqrstu4',
  payloadDigest: '4444444444444444444444444444444444444444444444444444444444444444'
});

assertEqual(twoRoomPlan.bookingRows.map(function(row) {
  return { roomCode: row.roomCode, assignedRoom: row.assignedRoom, quantity: row.quantity };
}), [
  { roomCode: 'adventure_suite', assignedRoom: 3, quantity: 1 },
  { roomCode: 'adventure_suite', assignedRoom: 4, quantity: 1 }
], 'multi-room bookings split into deterministic physical rows with numeric unit quantity');

assertEqual(twoRoomPlan.bookingRows.map(function(row) {
  return { checkIn: row.checkIn, checkOut: row.checkOut };
}), [
  { checkIn: '2027-11-05', checkOut: '2027-11-07' },
  { checkIn: '2027-11-05', checkOut: '2027-11-07' }
], 'every deterministic physical row retains the exact canonical stay interval');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, [], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-02-30',
    checkOut: '2027-03-04',
    bookingNumber: 'WC-2005',
    operationId: 'abcdefghijklmnopqrstu5',
    payloadDigest: '5555555555555555555555555555555555555555555555555555555555555555'
  });
}, 'Invalid commit dates', 'impossible calendar dates fail before claims are planned');

const oversizedSnapshot = {
  occupiedUnits: [],
  occupiedUnitsByNight: {},
  migrationIssueRows: [],
  duplicateUnitClaims: [],
  unknownStatusRows: []
};
for (let day = new Date(Date.UTC(2027, 0, 1));
  day < new Date(Date.UTC(2028, 5, 1));
  day.setUTCDate(day.getUTCDate() + 1)) {
  oversizedSnapshot.occupiedUnitsByNight[day.toISOString().slice(0, 10)] = [];
}
assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oversizedSnapshot, [], {
    roomCode: 'adventure_suite',
    quantity: 3,
    checkIn: '2027-01-01',
    checkOut: '2028-06-01',
    bookingNumber: 'WC-2005-LONG',
    operationId: 'oversizedmanifest001',
    payloadDigest: '1515151515151515151515151515151515151515151515151515151515151515'
  });
}, 'Commit manifest exceeds storage limit',
'oversized operation manifests fail before a persistence plan is returned');

const maximumStaySnapshot = {
  occupiedUnits: [],
  occupiedUnitsByNight: {},
  migrationIssueRows: [],
  duplicateUnitClaims: [],
  unknownStatusRows: []
};
for (let day = new Date(Date.UTC(2027, 0, 1));
  day < new Date(Date.UTC(2029, 2, 11));
  day.setUTCDate(day.getUTCDate() + 1)) {
  maximumStaySnapshot.occupiedUnitsByNight[day.toISOString().slice(0, 10)] = [];
}
const maximumStayPlan = context.rules.buildPhysicalCommitPlan(maximumStaySnapshot, [], {
  roomCode: 'adventure_suite',
  quantity: 1,
  checkIn: '2027-01-01',
  checkOut: '2029-03-11',
  bookingNumber: 'WC-2005-MAX',
  operationId: 'maximummanifest0001',
  payloadDigest: '1616161616161616161616161616161616161616161616161616161616161616'
});
assertEqual(maximumStayPlan.bookingRows.length, 1,
  'the exact 800-night manifest protocol boundary remains plannable');
assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(maximumStaySnapshot, [], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-01-01',
    checkOut: '2029-03-12',
    bookingNumber: 'WC-2005-OVER',
    operationId: 'maximummanifest0002',
    payloadDigest: '1717171717171717171717171717171717171717171717171717171717171717'
  });
}, 'Invalid commit dates', 'the 801-night manifest protocol boundary fails before planning');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, [], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: ' WC-2006',
    operationId: 'abcdefghijklmnopqrstu6',
    payloadDigest: '6666666666666666666666666666666666666666666666666666666666666666'
  });
}, 'Invalid booking number', 'noncanonical booking identities fail before claims are planned');

const capacityPlan = context.rules.buildPhysicalCommitPlan(emptySnapshot, [], {
  roomCode: 'adventure_suite',
  quantity: 2,
  checkIn: '2027-11-05',
  checkOut: '2027-11-07',
  bookingNumber: 'WC-2007',
  operationId: 'abcdefghijklmnopqrstuv',
  payloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
});
assertEqual(capacityPlan.acquisitions.map(function(event) { return event._id; }), [
  'rc1-op-abcdefghijklmnopqrstuv-a',
  'rc1-20271105-s1-000001-a',
  'rc1-20271105-s2-000001-a',
  'rc1-20271106-s1-000001-a',
  'rc1-20271106-s2-000001-a',
  'rc1-20271105-u3-000001-a',
  'rc1-20271105-u4-000001-a',
  'rc1-20271106-u3-000001-a',
  'rc1-20271106-u4-000001-a'
], 'all capacity claims are acquired before any physical-unit claim across the stay');
assertEqual({
  manifestVersion: capacityPlan.acquisitions[0].manifestVersion,
  manifestCheckIn: capacityPlan.acquisitions[0].manifestCheckIn,
  manifestCheckOut: capacityPlan.acquisitions[0].manifestCheckOut,
  manifestRoomCode: capacityPlan.acquisitions[0].manifestRoomCode,
  manifestUnits: capacityPlan.acquisitions[0].manifestUnits,
  manifestBookingRowIds: capacityPlan.acquisitions[0].manifestBookingRowIds,
  manifestResourceClaimIds: capacityPlan.acquisitions[0].manifestResourceClaimIds
}, {
  manifestVersion: 1,
  manifestCheckIn: '2027-11-05',
  manifestCheckOut: '2027-11-07',
  manifestRoomCode: 'adventure_suite',
  manifestUnits: '3,4',
  manifestBookingRowIds:
    'pb1-abcdefghijklmnopqrstuv-r1|pb1-abcdefghijklmnopqrstuv-r2',
  manifestResourceClaimIds: [
    'rc1-20271105-s1-000001-a',
    'rc1-20271105-s2-000001-a',
    'rc1-20271106-s1-000001-a',
    'rc1-20271106-s2-000001-a',
    'rc1-20271105-u3-000001-a',
    'rc1-20271105-u4-000001-a',
    'rc1-20271106-u3-000001-a',
    'rc1-20271106-u4-000001-a'
  ].join('|')
}, 'multi-room multi-night manifest binds exact row and global resource order');

const oneOccupiedSnapshot = {
  occupiedUnits: [3],
  occupiedUnitsByNight: { '2027-11-05': [3] },
  migrationIssueRows: [],
  duplicateUnitClaims: [],
  unknownStatusRows: []
};
const occupiedLedger = [{
  _id: 'rc1-20271105-s1-000001-a',
  protocolVersion: 1,
  claimKey: 'capacity:2027-11-05:1',
  generation: 1,
  eventType: 'acquire',
  claimType: 'capacity',
  night: '2027-11-05',
  capacitySlot: 1,
  operationId: 'existingoperationtoken1',
  bookingRowId: 'pb1-existingoperationtoken1-r1',
  bookingNumber: 'WC-1999',
  payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
}, {
  _id: 'rc1-20271105-u3-000001-a',
  protocolVersion: 1,
  claimKey: 'unit:2027-11-05:3',
  generation: 1,
  eventType: 'acquire',
  claimType: 'unit',
  night: '2027-11-05',
  unit: 3,
  operationId: 'existingoperationtoken1',
  bookingRowId: 'pb1-existingoperationtoken1-r1',
  bookingNumber: 'WC-1999',
  payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
}, {
  _id: 'rc1-op-existingoperationtoken1-a',
  protocolVersion: 1,
  claimKey: 'operation:existingoperationtoken1',
  generation: 1,
  eventType: 'acquire',
  claimType: 'operation',
  operationId: 'existingoperationtoken1',
  bookingRowId: 'pb1-existingoperationtoken1-r1',
  bookingNumber: 'WC-1999',
  payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  manifestVersion: 1,
  manifestCheckIn: '2027-11-05',
  manifestCheckOut: '2027-11-06',
  manifestRoomCode: 'adventure_suite',
  manifestUnits: '3',
  manifestBookingRowIds: 'pb1-existingoperationtoken1-r1',
  manifestResourceClaimIds: 'rc1-20271105-s1-000001-a|rc1-20271105-u3-000001-a'
}];
const lowestFreeSlotPlan = context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, occupiedLedger, {
  roomCode: 'adventure_suite',
  quantity: 1,
  checkIn: '2027-11-05',
  checkOut: '2027-11-06',
  bookingNumber: 'WC-2008',
  operationId: 'abcdefghijklmnopqrstuw',
  payloadDigest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
});
assertEqual(lowestFreeSlotPlan.acquisitions.map(function(event) { return event._id; }), [
  'rc1-op-abcdefghijklmnopqrstuw-a',
  'rc1-20271105-s2-000001-a',
  'rc1-20271105-u4-000001-a'
], 'the lowest free nightly capacity slot is selected before a different unit claim');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-occupancy-without-claims',
    operationId: 'occupancymismatch0001',
    payloadDigest: '1010101010101010101010101010101010101010101010101010101010101010'
  });
}, 'Physical room assignment unavailable',
'persisted occupancy without matching active unit and capacity claims fails closed');

const mismatchedCapacityOwnerLedger = [
  occupiedLedger[0],
  Object.assign({}, occupiedLedger[1], {
    operationId: 'differentclaimowner01',
    bookingRowId: 'pb1-differentclaimowner01-r1',
    bookingNumber: 'WC-DIFFERENT',
    payloadDigest: '1212121212121212121212121212121212121212121212121212121212121212'
  }),
  occupiedLedger[2],
  {
    _id: 'rc1-op-differentclaimowner01-a',
    protocolVersion: 1,
    claimKey: 'operation:differentclaimowner01',
    generation: 1,
    eventType: 'acquire',
    claimType: 'operation',
    operationId: 'differentclaimowner01',
    bookingRowId: 'pb1-differentclaimowner01-r1',
    bookingNumber: 'WC-DIFFERENT',
    payloadDigest: '1212121212121212121212121212121212121212121212121212121212121212'
  }
];
assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, mismatchedCapacityOwnerLedger, {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-owner-mismatch',
    operationId: 'claimownermismatch01',
    payloadDigest: '1313131313131313131313131313131313131313131313131313131313131313'
  });
}, 'Invalid claim ledger',
'capacity and unit acquisitions with mismatched ownership fail ledger validation');

const releasedLedger = [
  occupiedLedger[0],
  occupiedLedger[1],
  occupiedLedger[2],
  operationCompletion(occupiedLedger[0], 'complete', 2),
  {
    _id: 'rc1-20271105-s1-000001-r',
    protocolVersion: 1,
    claimKey: 'capacity:2027-11-05:1',
    generation: 1,
    eventType: 'release',
    claimType: 'capacity',
    night: '2027-11-05',
    capacitySlot: 1,
    operationId: 'existingoperationtoken1',
    bookingRowId: 'pb1-existingoperationtoken1-r1',
    bookingNumber: 'WC-1999',
    payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    releaseReason: 'rollback'
  },
  {
    _id: 'rc1-20271105-u3-000001-r',
    protocolVersion: 1,
    claimKey: 'unit:2027-11-05:3',
    generation: 1,
    eventType: 'release',
    claimType: 'unit',
    night: '2027-11-05',
    unit: 3,
    operationId: 'existingoperationtoken1',
    bookingRowId: 'pb1-existingoperationtoken1-r1',
    bookingNumber: 'WC-1999',
    payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    releaseReason: 'rollback'
  }
];
assertThrows(function() {
  context.rulesInternal.validateClaimLedger([
    occupiedLedger[2], occupiedLedger[0], occupiedLedger[1],
    releasedLedger[5], releasedLedger[4]
  ]);
}, 'Invalid claim ledger',
'released manifest history requires exactly one operation terminal fence');
const invalidForwardReleaseLedger = [
  occupiedLedger[0],
  occupiedLedger[1],
  occupiedLedger[2],
  operationCompletion(occupiedLedger[0], 'complete', 2),
  releasedLedger[4]
];
assertThrows(function() {
  context.rules.buildPhysicalCommitPlan({
    occupiedUnits: [],
    occupiedUnitsByNight: { '2027-11-05': [] },
    migrationIssueRows: [], duplicateUnitClaims: [], unknownStatusRows: []
  }, invalidForwardReleaseLedger, {
    roomCode: 'adventure_suite', quantity: 1,
    checkIn: '2027-11-05', checkOut: '2027-11-06',
    bookingNumber: 'WC-FORWARD-RELEASE', operationId: 'forwardreleaseaudit1',
    payloadDigest: '2525252525252525252525252525252525252525252525252525252525252525'
  });
}, 'Invalid claim ledger',
'a released prefix must be a suffix of acquisitions so compensation remains reverse ordered');

const shuffledForwardReleaseLedger = [
  occupiedLedger[2],
  occupiedLedger[1],
  occupiedLedger[0],
  operationCompletion(occupiedLedger[0], 'complete', 2),
  releasedLedger[4]
];
assertThrows(function() {
  context.rulesInternal.validateClaimLedger(shuffledForwardReleaseLedger);
}, 'Invalid claim ledger',
'release suffix validation follows immutable manifest order, not ledger query order');

const releasedSlotPlan = context.rules.buildPhysicalCommitPlan({
  occupiedUnits: [],
  occupiedUnitsByNight: { '2027-11-05': [] },
  migrationIssueRows: [],
  duplicateUnitClaims: [],
  unknownStatusRows: []
}, releasedLedger, {
  roomCode: 'adventure_suite',
  quantity: 1,
  checkIn: '2027-11-05',
  checkOut: '2027-11-06',
  bookingNumber: 'WC-2009',
  operationId: 'abcdefghijklmnopqrstux',
  payloadDigest: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
});
assertEqual(releasedSlotPlan.acquisitions.map(function(event) { return event._id; }), [
  'rc1-op-abcdefghijklmnopqrstux-a',
  'rc1-20271105-s1-000002-a',
  'rc1-20271105-u3-000002-a'
], 'released capacity and unit claims are reused only through the next append-only generation');

const unreleasedPriorGenerationLedger = [
  occupiedLedger[2],
  occupiedLedger[0],
  occupiedLedger[1],
  operationCompletion(occupiedLedger[2], 'complete', 2),
  releasedLedger[5]
].concat(releasedSlotPlan.acquisitions, [
  operationCompletion(releasedSlotPlan.acquisitions[0], 'complete', 2)
]);
assertThrows(function() {
  context.rulesInternal.validateClaimLedger(unreleasedPriorGenerationLedger);
}, 'Invalid claim ledger',
'a later generation requires the immediately preceding acquisition to be released');

assertEqual(capacityPlan.acquisitions[1], {
  _id: 'rc1-20271105-s1-000001-a',
  protocolVersion: 1,
  claimKey: 'capacity:2027-11-05:1',
  generation: 1,
  eventType: 'acquire',
  claimType: 'capacity',
  night: '2027-11-05',
  capacitySlot: 1,
  operationId: 'abcdefghijklmnopqrstuv',
  bookingRowId: 'pb1-abcdefghijklmnopqrstuv-r1',
  bookingNumber: 'WC-2007',
  payloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
}, 'acquire events carry complete deterministic recovery metadata');

assertEqual({
  bookingRows: capacityPlan.bookingRows,
  primaryRowId: capacityPlan.primaryRowId
}, {
  bookingRows: [
    {
      _id: 'pb1-abcdefghijklmnopqrstuv-r1',
      roomCode: 'adventure_suite',
      assignedRoom: 3,
      quantity: 1,
      checkIn: '2027-11-05',
      checkOut: '2027-11-07',
      bookingNumber: 'WC-2007',
      operationId: 'abcdefghijklmnopqrstuv',
      payloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    },
    {
      _id: 'pb1-abcdefghijklmnopqrstuv-r2',
      roomCode: 'adventure_suite',
      assignedRoom: 4,
      quantity: 1,
      checkIn: '2027-11-05',
      checkOut: '2027-11-07',
      bookingNumber: 'WC-2007',
      operationId: 'abcdefghijklmnopqrstuv',
      payloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    }
  ],
  primaryRowId: 'pb1-abcdefghijklmnopqrstuv-r1'
}, 'deterministic physical rows designate the lowest-unit row as the public primary');

assertEqual(Object.keys(capacityPlan).sort(), [
  'acquisitions',
  'bookingRows',
  'primaryRowId'
], 'commit plans expose no deletable permanent-claim representation');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, [], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-2010',
    operationId: 'short',
    payloadDigest: '7777777777777777777777777777777777777777777777777777777777777777'
  });
}, 'Invalid operation ID', 'short operation IDs cannot define idempotent booking rows');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, [], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-2011',
    operationId: 'abcdefghijklmnopqrstu7',
    payloadDigest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  });
}, 'Invalid payload digest', 'noncanonical payload digests cannot participate in retry reconciliation');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan({
    occupiedUnits: [],
    occupiedUnitsByNight: { '2027-11-05': [] },
    migrationIssueRows: [],
    duplicateUnitClaims: [],
    unknownStatusRows: []
  }, [releasedLedger[4]], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2012',
    operationId: 'abcdefghijklmnopqrstu8',
    payloadDigest: '8888888888888888888888888888888888888888888888888888888888888888'
  });
}, 'Invalid claim ledger', 'orphan release events fail closed');

const generationTwoOnly = Object.assign({}, occupiedLedger[0], {
  _id: 'rc1-20271105-s1-000002-a',
  generation: 2
});
assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [generationTwoOnly], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2013',
    operationId: 'abcdefghijklmnopqrstu9',
    payloadDigest: '9999999999999999999999999999999999999999999999999999999999999999'
  });
}, 'Invalid claim ledger', 'claim generations cannot contain gaps');

const mismatchedReleaseLedger = [
  occupiedLedger[0],
  Object.assign({}, releasedLedger[4], { operationId: 'differentoperationtok1' })
];
assertThrows(function() {
  context.rules.buildPhysicalCommitPlan({
    occupiedUnits: [],
    occupiedUnitsByNight: { '2027-11-05': [] },
    migrationIssueRows: [],
    duplicateUnitClaims: [],
    unknownStatusRows: []
  }, mismatchedReleaseLedger, {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2014',
    operationId: 'abcdefghijklmnopqrstuA',
    payloadDigest: 'abababababababababababababababababababababababababababababababab'
  });
}, 'Invalid claim ledger', 'release events cannot release another operation ownership tuple');

const fullyOccupiedSnapshot = {
  occupiedUnits: [3, 4],
  occupiedUnitsByNight: { '2027-11-05': [3, 4] },
  migrationIssueRows: [],
  duplicateUnitClaims: [],
  unknownStatusRows: []
};
const duplicatedRowOwnershipLedger = capacityPlan.acquisitions.slice(0, 4).map(function(event) {
  return Object.assign({}, event, { bookingRowId: 'pb1-abcdefghijklmnopqrstuv-r1' });
});
assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(fullyOccupiedSnapshot, duplicatedRowOwnershipLedger, {
    roomCode: 'penthouse_apartment',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-duplicate-row-owner',
    operationId: 'duplicaterowowner001',
    payloadDigest: '1414141414141414141414141414141414141414141414141414141414141414'
  });
}, 'Invalid claim ledger',
'duplicate booking-row ownership fails historical acquisition topology validation');
assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(fullyOccupiedSnapshot, [], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2015',
    operationId: 'abcdefghijklmnopqrstuB',
    payloadDigest: 'bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc'
  });
}, 'Physical room assignment unavailable', 'unavailable inventory fails closed without constructing an empty plan');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, [
    Object.assign({}, occupiedLedger[0], { eventType: 'acquired' })
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2016',
    operationId: 'abcdefghijklmnopqrstuC',
    payloadDigest: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
  });
}, 'Invalid claim ledger', 'unknown claim event types fail closed');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, [
    Object.assign({}, occupiedLedger[0], { capacitySlot: 2 })
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2017',
    operationId: 'abcdefghijklmnopqrstuD',
    payloadDigest: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  });
}, 'Invalid claim ledger', 'claim keys must agree with their typed identity fields');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, [
    occupiedLedger[0],
    Object.assign({}, occupiedLedger[0])
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2018',
    operationId: 'abcdefghijklmnopqrstuE',
    payloadDigest: 'efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef'
  });
}, 'Invalid claim ledger', 'each claim generation has exactly one acquire event');

assertEqual(
  context.rules.validatePhysicalCommit(
    capacityPlan,
    capacityPlan.bookingRows.slice().reverse(),
    capacityPlan.acquisitions.slice().reverse()
  ),
  true,
  'post-write validation accepts complete matching rows and acquisitions regardless of read order'
);

const forgedManifestPlan = Object.assign({}, capacityPlan, {
  acquisitions: capacityPlan.acquisitions.map(function(event, index) {
    if (index !== 0) return event;
    const forgedIds = event.manifestResourceClaimIds.split('|').map(function(id) {
      return id.replace(/-u([34])-/, function(match, unit) {
        return '-u' + (Number(unit) + 1) + '-';
      });
    });
    return Object.assign({}, event, {
      manifestUnits: '4,5',
      manifestResourceClaimIds: forgedIds.join('|')
    });
  })
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    forgedManifestPlan,
    capacityPlan.bookingRows,
    forgedManifestPlan.acquisitions
  );
}, 'Physical commit verification failed',
'post-write validation binds the immutable manifest to exact rows and resource claims');

const alternateManifestGenerationPlan = Object.assign({}, capacityPlan, {
  acquisitions: capacityPlan.acquisitions.map(function(event, index) {
    if (index !== 0) return event;
    return Object.assign({}, event, {
      manifestResourceClaimIds: event.manifestResourceClaimIds.replace(/000001-a/g, '000002-a')
    });
  })
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    alternateManifestGenerationPlan,
    capacityPlan.bookingRows,
    alternateManifestGenerationPlan.acquisitions
  );
}, 'Physical commit verification failed',
'a valid alternative manifest generation cannot disagree with unchanged rows and resource claims');

const alternativeResourceGenerationPlan = Object.assign({}, capacityPlan, {
  acquisitions: capacityPlan.acquisitions.map(function(event, index) {
    if (index === 0) return event;
    return Object.assign({}, event, {
      _id: event._id.replace('000001-a', '000002-a'),
      generation: 2
    });
  })
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    alternativeResourceGenerationPlan,
    capacityPlan.bookingRows,
    alternativeResourceGenerationPlan.acquisitions
  );
}, 'Physical commit verification failed',
'a self-consistent alternative resource generation cannot bypass the original identity manifest');

const wixDateRows = capacityPlan.bookingRows.map(function(row) {
  return Object.assign({}, row, {
    checkIn: new Date(row.checkIn + 'T12:00:00.000Z'),
    checkOut: new Date(row.checkOut + 'T12:00:00.000Z')
  });
});
assertEqual(
  context.rules.validatePhysicalCommit(capacityPlan, wixDateRows, capacityPlan.acquisitions),
  true,
  'post-write validation accepts Wix noon-UTC Date values for canonical plan days'
);

assertThrows(function() {
  context.rules.validatePhysicalCommit(
    capacityPlan,
    capacityPlan.bookingRows,
    capacityPlan.acquisitions.slice(1)
  );
}, 'Physical commit verification failed', 'post-write validation rejects partial claim acquisition');

const rollbackAcquisitions = capacityPlan.acquisitions.filter(function(event) {
  return event.claimType !== 'operation';
}).slice(0, 2);
assertEqual(
  context.rules.planPhysicalRollback(rollbackAcquisitions, 'booking-row-write-failed'),
  rollbackAcquisitions.slice().reverse().map(function(event) {
    return Object.assign({}, event, {
      _id: event._id.slice(0, -1) + 'r',
      eventType: 'release',
      releaseReason: 'booking-row-write-failed'
    });
  }),
  'rollback planning converts only confirmed acquisitions into append-only releases'
);

assertEqual(
  context.rules.planPhysicalRollback(capacityPlan.acquisitions, 'booking-row-write-failed')
    .some(function(event) { return event.claimType === 'operation'; }),
  false,
  'rollback preserves the permanent operation identity claim'
);

assertThrows(function() {
  context.rules.planPhysicalRollback([
    Object.assign({}, rollbackAcquisitions[0], { eventType: 'release' })
  ], 'booking-row-write-failed');
}, 'Invalid rollback request', 'rollback planning rejects anything other than confirmed acquire events');

assertThrows(function() {
  context.rules.planPhysicalRollback([
    Object.assign({}, rollbackAcquisitions[0], {
      operationId: 'short',
      bookingRowId: 'pb1-short-r1'
    })
  ], 'booking-row-write-failed');
}, 'Invalid rollback request', 'rollback planning rejects malformed acquisition ownership before compensation');

assertThrows(function() {
  context.rules.planPhysicalRollback(rollbackAcquisitions, '   ');
}, 'Invalid rollback request', 'rollback planning requires a canonical nonblank compensation reason');

assertThrows(function() {
  context.rules.planPhysicalRollback([
    rollbackAcquisitions[0],
    Object.assign({}, rollbackAcquisitions[0])
  ], 'booking-row-write-failed');
}, 'Invalid rollback request', 'rollback planning rejects duplicate confirmed acquisitions');

assertThrows(function() {
  context.rules.planPhysicalRollback([
    rollbackAcquisitions[0],
    Object.assign({}, rollbackAcquisitions[1], {
      operationId: 'foreignrollbackowner01',
      bookingRowId: 'pb1-foreignrollbackowner01-r2',
      bookingNumber: 'WC-FOREIGN',
      payloadDigest: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
    })
  ], 'booking-row-write-failed');
}, 'Invalid rollback request', 'rollback planning cannot combine acquisitions from different operations');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(Object.assign({}, emptySnapshot, {
    occupiedUnitsByNight: { '2027-11-05': [] }
  }), capacityPlan.acquisitions, {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2019',
    operationId: 'abcdefghijklmnopqrstuF',
    payloadDigest: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  });
}, 'Physical room assignment unavailable', 'active unit claims fail closed when the inventory projection is stale');

assertThrows(function() {
  context.rules.validatePhysicalCommit(
    capacityPlan,
    capacityPlan.bookingRows.concat([{ _id: 'unexpected-row' }]),
    capacityPlan.acquisitions
  );
}, 'Physical commit verification failed', 'post-write validation rejects extra operation-owned booking rows');

const forgedQuantityPlan = Object.assign({}, capacityPlan, {
  bookingRows: capacityPlan.bookingRows.map(function(row, index) {
    return index === 0 ? Object.assign({}, row, { quantity: 2 }) : row;
  })
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    forgedQuantityPlan,
    forgedQuantityPlan.bookingRows,
    forgedQuantityPlan.acquisitions
  );
}, 'Physical commit verification failed', 'post-write validation rejects a malformed plan even when stored rows match it');

const forgedDatePlan = Object.assign({}, capacityPlan, {
  bookingRows: capacityPlan.bookingRows.map(function(row, index) {
    return index === 0 ? Object.assign({}, row, { checkOut: row.checkIn }) : row;
  })
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    forgedDatePlan,
    forgedDatePlan.bookingRows,
    forgedDatePlan.acquisitions
  );
}, 'Physical commit verification failed', 'post-write validation rejects malformed plan stay intervals');

const splitStayRows = capacityPlan.bookingRows.map(function(row, index) {
  return index === 0
    ? Object.assign({}, row, { checkOut: '2027-11-06' })
    : Object.assign({}, row, { checkIn: '2027-11-06' });
});
const splitStayAcquisitions = capacityPlan.acquisitions.filter(function(event) {
  return event.claimType === 'operation' ||
    (event.bookingRowId === splitStayRows[0]._id && event.night === '2027-11-05') ||
    (event.bookingRowId === splitStayRows[1]._id && event.night === '2027-11-06');
});
const splitStayPlan = Object.assign({}, capacityPlan, {
  bookingRows: splitStayRows,
  acquisitions: splitStayAcquisitions
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(splitStayPlan, splitStayRows, splitStayAcquisitions);
}, 'Physical commit verification failed',
'post-write validation requires one exact stay interval across all booking rows');

const duplicateRowId = splitStayRows[0]._id;
const duplicateIdRows = splitStayRows.map(function(row, index) {
  return index === 0 ? row : Object.assign({}, row, { _id: duplicateRowId });
});
const duplicateIdAcquisitions = splitStayAcquisitions.map(function(event) {
  return event.bookingRowId === splitStayRows[1]._id
    ? Object.assign({}, event, { bookingRowId: duplicateRowId })
    : event;
});
const duplicateIdPlan = Object.assign({}, splitStayPlan, {
  bookingRows: duplicateIdRows,
  acquisitions: duplicateIdAcquisitions
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(duplicateIdPlan, duplicateIdRows, duplicateIdAcquisitions);
}, 'Physical commit verification failed',
'post-write validation rejects duplicate deterministic booking-row IDs');

const noncontiguousRows = capacityPlan.bookingRows.map(function(row, index) {
  return index === 0 ? row : Object.assign({}, row, {
    _id: 'pb1-' + row.operationId + '-r99'
  });
});
const noncontiguousAcquisitions = capacityPlan.acquisitions.map(function(event) {
  return event.bookingRowId === capacityPlan.bookingRows[1]._id
    ? Object.assign({}, event, { bookingRowId: noncontiguousRows[1]._id })
    : event;
});
const noncontiguousPlan = Object.assign({}, capacityPlan, {
  bookingRows: noncontiguousRows,
  acquisitions: noncontiguousAcquisitions
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(noncontiguousPlan, noncontiguousRows, noncontiguousAcquisitions);
}, 'Physical commit verification failed',
'post-write validation requires contiguous deterministic row numbers');

const reorderedAcquisitions = capacityPlan.acquisitions.slice();
const firstCapacityIndex = reorderedAcquisitions.findIndex(function(event) {
  return event.claimType === 'capacity';
});
const matchingUnitIndex = reorderedAcquisitions.findIndex(function(event) {
  return event.claimType === 'unit' &&
    event.night === reorderedAcquisitions[firstCapacityIndex].night &&
    event.bookingRowId === reorderedAcquisitions[firstCapacityIndex].bookingRowId;
});
const reorderedUnit = reorderedAcquisitions.splice(matchingUnitIndex, 1)[0];
reorderedAcquisitions.splice(firstCapacityIndex, 0, reorderedUnit);
const reorderedPlan = Object.assign({}, capacityPlan, { acquisitions: reorderedAcquisitions });
assertThrows(function() {
  context.rules.validatePhysicalCommit(reorderedPlan, reorderedPlan.bookingRows, reorderedAcquisitions);
}, 'Physical commit verification failed',
'post-write validation requires capacity acquisition before its unit acquisition');

const nightlyInterleavedAcquisitions = [capacityPlan.acquisitions[0]];
['2027-11-05', '2027-11-06'].forEach(function(night) {
  nightlyInterleavedAcquisitions.push.apply(
    nightlyInterleavedAcquisitions,
    capacityPlan.acquisitions.filter(function(event) {
      return event.claimType === 'capacity' && event.night === night;
    })
  );
  nightlyInterleavedAcquisitions.push.apply(
    nightlyInterleavedAcquisitions,
    capacityPlan.acquisitions.filter(function(event) {
      return event.claimType === 'unit' && event.night === night;
    })
  );
});
const nightlyInterleavedPlan = Object.assign({}, capacityPlan, {
  acquisitions: nightlyInterleavedAcquisitions
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    nightlyInterleavedPlan,
    nightlyInterleavedPlan.bookingRows,
    nightlyInterleavedAcquisitions
  );
}, 'Physical commit verification failed',
'post-write validation requires every capacity acquisition before any unit acquisition');

const swappedCapacityAcquisitions = capacityPlan.acquisitions.map(function(event) {
  if (event.claimType !== 'capacity' || event.night !== '2027-11-05') return event;
  if (event.bookingRowId === capacityPlan.bookingRows[0]._id) {
    return Object.assign({}, event, { bookingRowId: capacityPlan.bookingRows[1]._id });
  }
  if (event.bookingRowId === capacityPlan.bookingRows[1]._id) {
    return Object.assign({}, event, { bookingRowId: capacityPlan.bookingRows[0]._id });
  }
  return event;
});
const swappedCapacityPlan = Object.assign({}, capacityPlan, {
  acquisitions: swappedCapacityAcquisitions
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    swappedCapacityPlan,
    swappedCapacityPlan.bookingRows,
    swappedCapacityAcquisitions
  );
}, 'Physical commit verification failed',
'post-write validation binds ascending capacity slots to deterministic row order');

const descendingUnitRows = capacityPlan.bookingRows.map(function(row, index) {
  return Object.assign({}, row, { assignedRoom: index === 0 ? 4 : 3 });
});
const descendingUnitAcquisitions = capacityPlan.acquisitions.map(function(event) {
  if (event.claimType !== 'unit') return event;
  const isFirstRow = event.bookingRowId === capacityPlan.bookingRows[0]._id;
  const unit = isFirstRow ? 4 : 3;
  return Object.assign({}, event, {
    _id: event._id.replace(/-u[34]-/, '-u' + unit + '-'),
    claimKey: 'unit:' + event.night + ':' + unit,
    unit: unit
  });
});
const descendingUnitPlan = Object.assign({}, capacityPlan, {
  bookingRows: descendingUnitRows,
  acquisitions: descendingUnitAcquisitions,
  primaryRowId: descendingUnitRows[1]._id
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    descendingUnitPlan,
    descendingUnitRows,
    descendingUnitAcquisitions
  );
}, 'Physical commit verification failed',
'post-write validation binds ascending physical units to deterministic row order');

const forgedRoomMappingPlan = Object.assign({}, capacityPlan, {
  bookingRows: capacityPlan.bookingRows.map(function(row, index) {
    return index === 0 ? Object.assign({}, row, { roomCode: 'two_bedroom_apartment' }) : row;
  })
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    forgedRoomMappingPlan,
    forgedRoomMappingPlan.bookingRows,
    forgedRoomMappingPlan.acquisitions
  );
}, 'Physical commit verification failed', 'post-write validation rejects room-code and physical-unit mismatches');

const foreignOperationRows = capacityPlan.bookingRows.map(function(row, index) {
  return Object.assign({}, row, {
    _id: 'pb1-foreignplanowner001-r' + (index + 1),
    operationId: 'foreignplanowner001'
  });
});
const splitOwnershipPlan = Object.assign({}, capacityPlan, {
  bookingRows: foreignOperationRows,
  primaryRowId: foreignOperationRows[0]._id
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    splitOwnershipPlan,
    splitOwnershipPlan.bookingRows,
    splitOwnershipPlan.acquisitions
  );
}, 'Physical commit verification failed', 'post-write validation binds booking rows and acquisitions to one operation');

const splitDigestRows = capacityPlan.bookingRows.map(function(row) {
  return Object.assign({}, row, {
    payloadDigest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  });
});
const splitDigestPlan = Object.assign({}, capacityPlan, { bookingRows: splitDigestRows });
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    splitDigestPlan,
    splitDigestPlan.bookingRows,
    splitDigestPlan.acquisitions
  );
}, 'Physical commit verification failed', 'post-write validation binds booking rows and acquisitions to one payload digest');

const splitBookingRows = capacityPlan.bookingRows.map(function(row) {
  return Object.assign({}, row, { bookingNumber: 'WC-OTHER' });
});
const splitBookingPlan = Object.assign({}, capacityPlan, { bookingRows: splitBookingRows });
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    splitBookingPlan,
    splitBookingPlan.bookingRows,
    splitBookingPlan.acquisitions
  );
}, 'Physical commit verification failed', 'post-write validation binds booking rows and acquisitions to one booking number');

const detachedRows = capacityPlan.bookingRows.map(function(row, index) {
  return index === 0 ? Object.assign({}, row, { _id: 'detached-row' }) : row;
});
const detachedRowPlan = Object.assign({}, capacityPlan, {
  bookingRows: detachedRows,
  primaryRowId: detachedRows[0]._id
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    detachedRowPlan,
    detachedRowPlan.bookingRows,
    detachedRowPlan.acquisitions
  );
}, 'Physical commit verification failed', 'post-write validation requires deterministic rows referenced by claim events');

const wrongPrimaryPlan = Object.assign({}, capacityPlan, {
  primaryRowId: capacityPlan.bookingRows[1]._id
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    wrongPrimaryPlan,
    wrongPrimaryPlan.bookingRows,
    wrongPrimaryPlan.acquisitions
  );
}, 'Physical commit verification failed', 'post-write validation requires the lowest-unit row as primary');

const incompleteTopologyPlan = Object.assign({}, capacityPlan, {
  acquisitions: capacityPlan.acquisitions.slice(0, -1)
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    incompleteTopologyPlan,
    incompleteTopologyPlan.bookingRows,
    incompleteTopologyPlan.acquisitions
  );
}, 'Physical commit verification failed', 'post-write validation requires every row-night capacity and unit acquisition');

const forgedAcquisitionPlan = Object.assign({}, capacityPlan, {
  acquisitions: capacityPlan.acquisitions.map(function(event, index) {
    return index === 0 ? Object.assign({}, event, { protocolVersion: 2 }) : event;
  })
});
assertThrows(function() {
  context.rules.validatePhysicalCommit(
    forgedAcquisitionPlan,
    forgedAcquisitionPlan.bookingRows,
    forgedAcquisitionPlan.acquisitions
  );
}, 'Physical commit verification failed', 'post-write validation rejects malformed planned acquisitions even when storage matches');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [
    Object.assign({}, occupiedLedger[0], { _id: 'forged-event-id' })
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2020',
    operationId: 'abcdefghijklmnopqrstuG',
    payloadDigest: '0101010101010101010101010101010101010101010101010101010101010101'
  });
}, 'Invalid claim ledger', 'persisted event IDs must match their complete claim identity');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [
    Object.assign({}, occupiedLedger[0], { protocolVersion: 2 })
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2021',
    operationId: 'abcdefghijklmnopqrstuH',
    payloadDigest: '0202020202020202020202020202020202020202020202020202020202020202'
  });
}, 'Invalid claim ledger', 'unsupported claim protocol versions fail closed');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [
    Object.assign({}, occupiedLedger[0], {
      payloadDigest: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    })
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2022',
    operationId: 'abcdefghijklmnopqrstuI',
    payloadDigest: '0303030303030303030303030303030303030303030303030303030303030303'
  });
}, 'Invalid claim ledger', 'persisted events require canonical payload digests');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [
    Object.assign({}, occupiedLedger[0], {
      operationId: 'short',
      bookingRowId: 'pb1-short-r1'
    })
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2023',
    operationId: 'abcdefghijklmnopqrstuJ',
    payloadDigest: '0404040404040404040404040404040404040404040404040404040404040404'
  });
}, 'Invalid claim ledger', 'persisted events require canonical operation identities');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [
    Object.assign({}, occupiedLedger[0], {
      bookingRowId: 'pb1-anotheroperationtoken-r1'
    })
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2024',
    operationId: 'abcdefghijklmnopqrstuK',
    payloadDigest: '0505050505050505050505050505050505050505050505050505050505050505'
  });
}, 'Invalid claim ledger', 'persisted claim ownership is bound to its deterministic booking-row ID');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [
    Object.assign({}, occupiedLedger[0], { bookingNumber: ' WC-1999' })
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2025',
    operationId: 'abcdefghijklmnopqrstuL',
    payloadDigest: '0606060606060606060606060606060606060606060606060606060606060606'
  });
}, 'Invalid claim ledger', 'persisted events require canonical booking identities');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [
    Object.assign({}, occupiedLedger[0], {
      _id: 'rc1-20271105-s1-1000000-a',
      generation: 1000000
    })
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2026',
    operationId: 'abcdefghijklmnopqrstuM',
    payloadDigest: '0707070707070707070707070707070707070707070707070707070707070707'
  });
}, 'Invalid claim ledger', 'claim generations cannot overflow the deterministic six-digit ID field');

const exhaustedAcquire = Object.assign({}, occupiedLedger[0], {
  _id: 'rc1-20271105-s1-999999-a',
  generation: 999999
});
const exhaustedRelease = Object.assign({}, releasedLedger[4], {
  _id: 'rc1-20271105-s1-999999-r',
  generation: 999999
});
assertThrows(function() {
  context.rulesInternal.claimState([exhaustedAcquire, exhaustedRelease], exhaustedAcquire.claimKey);
}, 'Claim generation exhausted',
'fully released generation 999999 fails closed before an unpersistable next generation is planned');

const releaseWithoutReason = Object.assign({}, releasedLedger[4]);
delete releaseWithoutReason.releaseReason;
assertThrows(function() {
  context.rules.buildPhysicalCommitPlan({
    occupiedUnits: [],
    occupiedUnitsByNight: { '2027-11-05': [] },
    migrationIssueRows: [],
    duplicateUnitClaims: [],
    unknownStatusRows: []
  }, [occupiedLedger[0], releaseWithoutReason], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2027',
    operationId: 'abcdefghijklmnopqrstuN',
    payloadDigest: '0808080808080808080808080808080808080808080808080808080808080808'
  });
}, 'Invalid claim ledger', 'persisted release events require an auditable canonical reason');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [
    occupiedLedger[0],
    Object.assign({}, occupiedLedger[1], {
      payloadDigest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    })
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2028',
    operationId: 'abcdefghijklmnopqrstuO',
    payloadDigest: '0909090909090909090909090909090909090909090909090909090909090909'
  });
}, 'Invalid claim ledger', 'one operation ID cannot own claim events with different payload digests');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [
    occupiedLedger[0],
    Object.assign({}, occupiedLedger[1], { bookingNumber: 'WC-OTHER' })
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2029',
    operationId: 'abcdefghijklmnopqrstuP',
    payloadDigest: '1111111111111111111111111111111111111111111111111111111111111111'
  });
}, 'Invalid claim ledger', 'one operation ID cannot own events for different booking numbers');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(oneOccupiedSnapshot, [
    Object.assign({}, occupiedLedger[0], { shadowOwner: 'unexpected' }),
    occupiedLedger[1]
  ], {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-2034B',
    operationId: 'operation-schema-0034b',
    payloadDigest: 'abababababababababababababababababababababababababababababababab'
  });
}, 'Invalid claim ledger', 'persisted claim history rejects unexpected business fields');

assertThrows(function() {
  context.rules.buildPhysicalCommitPlan(emptySnapshot, {
    roomCode: 'adventure_suite',
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-07',
    bookingNumber: 'WC-2028',
    operationId: 'abcdefghijklmnopqrstuO',
    payloadDigest: '0909090909090909090909090909090909090909090909090909090909090909'
  });
}, 'Invalid claim ledger', 'commit planning requires an explicit claim-ledger argument');
