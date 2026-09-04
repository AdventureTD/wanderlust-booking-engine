// Behavioral and isolation tests for canonical booking-commit payload digests.
// Run: node scripts/verify-room-booking-payload.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    const copy = {};
    Object.keys(value).sort().forEach(function(key) { copy[key] = comparable(value[key]); });
    return copy;
  }
  return value;
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(comparable(actual)) !== JSON.stringify(comparable(expected))) {
    throw new Error('FAIL: ' + message + '\nExpected: ' + JSON.stringify(expected) +
      '\nActual: ' + JSON.stringify(actual));
  }
  console.log('PASS: ' + message);
}

function assertThrows(run, expectedMessage, message) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  if (!error || error.message !== expectedMessage) {
    throw new Error('FAIL: ' + message + '\nExpected error: ' + expectedMessage +
      '\nActual: ' + (error && error.message));
  }
  console.log('PASS: ' + message);
}

const backendDir = path.join(__dirname, '..', 'velo', 'backend');
const rulesPath = path.join(backendDir, 'roomBookingPayloadRules.js');
const digestPath = path.join(backendDir, 'roomBookingPayloadDigest.js');
const rulesSource = fs.readFileSync(rulesPath, 'utf8');
const rulesContext = { Date, JSON, Number, Object, String, Array, Error };
vm.createContext(rulesContext);
vm.runInContext(
  rulesSource.replace(/export function /g, 'function ') +
    '\nthis.rules = { canonicalizeRoomBookingCommitPayload };',
  rulesContext
);
const canonicalize = rulesContext.rules.canonicalizeRoomBookingCommitPayload;

const digestSource = fs.readFileSync(digestPath, 'utf8');
const digestContext = { crypto, canonicalizeRoomBookingCommitPayload: canonicalize };
vm.createContext(digestContext);
vm.runInContext(
  digestSource
    .replace(/^import crypto from ['"]crypto['"];\s*$/m, '')
    .replace(/^import \{ canonicalizeRoomBookingCommitPayload \} from ['"].*['"];\s*$/m, '')
    .replace(/export function /g, 'function ') +
    '\nthis.digest = { computeRoomBookingPayloadDigest };',
  digestContext
);
const computeDigest = digestContext.digest.computeRoomBookingPayloadDigest;

const operationId = 'coordinatortrace01';
const payload = {
  operationId,
  bookingNumber: 'WC-3001',
  roomCode: 'adventure_suite',
  quantity: 2,
  checkIn: '2027-11-05',
  checkOut: '2027-11-06',
  rowProjectionPolicy: 1,
  rows: [
    {
      index: 1,
      bookingRowId: 'pb1-' + operationId + '-r1',
      guests: 2,
      roomFee: 0,
      note: 'Late arrival café'
    },
    {
      index: 2,
      bookingRowId: 'pb1-' + operationId + '-r2',
      guests: 2,
      roomFee: 0,
      note: ''
    }
  ]
};
const expectedCanonical = '["wanderlust.room-booking-commit",2,"coordinatortrace01",' +
  '"WC-3001","adventure_suite","2","2027-11-05","2027-11-06",' +
  '"explicit-deterministic-rows-v1",[["1","pb1-coordinatortrace01-r1","2","0",' +
  '"Late arrival café"],["2","pb1-coordinatortrace01-r2","2","0",""]]]';
assertEqual(canonicalize(payload), expectedCanonical,
  'payload intent has one exact versioned canonical encoding');
assertEqual(computeDigest(payload),
  '8b746b910de62a221d69fc9110793a6882ea56430f5e0b20ae8a5695a426da88',
  'backend adapter hashes the canonical UTF-8 payload with SHA-256');

const reorderedPayload = {
  rows: payload.rows.map(function(row) {
    return {
      note: row.note,
      roomFee: row.roomFee,
      guests: row.guests,
      bookingRowId: row.bookingRowId,
      index: row.index
    };
  }),
  rowProjectionPolicy: 1,
  checkOut: payload.checkOut,
  checkIn: payload.checkIn,
  quantity: payload.quantity,
  roomCode: payload.roomCode,
  bookingNumber: payload.bookingNumber,
  operationId: payload.operationId
};
assertEqual(computeDigest(reorderedPayload), computeDigest(payload),
  'object insertion order cannot change the payload digest');

const changedGuests = comparable(payload);
changedGuests.rows[0].guests = 1;
assertThrows(function() { computeDigest(changedGuests); }, 'Invalid booking commit payload',
  'room occupancy semantics reject changed Adventure Suite guests');
const changedNote = comparable(payload);
changedNote.rows[0].note = 'Late arrival';
assertEqual(computeDigest(changedNote) === computeDigest(payload), false,
  'changing the primary note changes the operation digest');
const penthouse = {
  operationId: 'penthousepayload01',
  bookingNumber: 'WC-3002',
  roomCode: 'penthouse_apartment',
  quantity: 1,
  checkIn: '2027-11-05',
  checkOut: '2027-11-06',
  rowProjectionPolicy: 1,
  rows: [{
    index: 1,
    bookingRowId: 'pb1-penthousepayload01-r1',
    guests: 2,
    roomFee: 175,
    note: ''
  }]
};
const changedFee = comparable(penthouse);
changedFee.rows[0].roomFee = 176;
assertEqual(computeDigest(changedFee) === computeDigest(penthouse), false,
  'changing a canonical per-room fee changes the operation digest');
const unsafePenthouseFee = comparable(penthouse);
unsafePenthouseFee.rows[0].roomFee = Number.MAX_SAFE_INTEGER + 1;
assertThrows(function() { canonicalize(unsafePenthouseFee); }, 'Invalid booking commit payload',
  'unsafe Penthouse room fees fail closed');
const twoBedroom = {
  operationId: 'twobedroompayload1',
  bookingNumber: 'WC-3003',
  roomCode: 'two_bedroom_apartment',
  quantity: 1,
  checkIn: '2027-11-05',
  checkOut: '2027-11-06',
  rowProjectionPolicy: 1,
  rows: [{
    index: 1,
    bookingRowId: 'pb1-twobedroompayload1-r1',
    guests: 3,
    roomFee: 0,
    note: ''
  }]
};
const changedValidGuests = comparable(twoBedroom);
changedValidGuests.rows[0].guests = 4;
assertEqual(computeDigest(changedValidGuests) === computeDigest(twoBedroom), false,
  'changing a valid per-room guest count changes the operation digest');

function invalid(mutator, message) {
  const candidate = comparable(payload);
  mutator(candidate);
  assertThrows(function() { canonicalize(candidate); }, 'Invalid booking commit payload', message);
}
invalid(function(candidate) { delete candidate.rows[1]; }, 'sparse projection rows fail closed');
invalid(function(candidate) { candidate.rows.reverse(); }, 'reordered projection rows fail closed');
invalid(function(candidate) { candidate.rows[1].bookingRowId = candidate.rows[0].bookingRowId; },
  'duplicate deterministic row IDs fail closed');
invalid(function(candidate) { candidate.quantity = 1; }, 'quantity and row-count disagreement fails closed');
invalid(function(candidate) { candidate.rows[0].guests = '2'; }, 'numeric-text guests fail closed');
invalid(function(candidate) { candidate.rows[0].guests = Number.MAX_SAFE_INTEGER + 1; },
  'unsafe guest integers fail closed');
invalid(function(candidate) { candidate.rows[0].roomFee = NaN; }, 'NaN room fees fail closed');
invalid(function(candidate) { candidate.rows[0].roomFee = Infinity; }, 'infinite room fees fail closed');
invalid(function(candidate) { candidate.rows[0].roomFee = -0; }, 'negative-zero room fees fail closed');
invalid(function(candidate) { candidate.rows[0].roomFee = 1; },
  'non-Penthouse room fees fail closed');
invalid(function(candidate) { candidate.rows[1].note = 'duplicate note'; },
  'booking-level notes are restricted to the primary row');
invalid(function(candidate) { candidate.rows[0].note = 'cafe\u0301'; },
  'decomposed Unicode note text fails canonicalization');
invalid(function(candidate) { candidate.rows[0].note = '\ud800'; },
  'unpaired UTF-16 surrogates fail canonicalization');
invalid(function(candidate) { candidate.extra = true; }, 'extra payload fields fail closed');
invalid(function(candidate) { candidate.rows[0].extra = true; }, 'extra projection fields fail closed');
invalid(function(candidate) {
  Object.defineProperty(candidate.rows[0], 'note', { enumerable: true, get: function() { return ''; } });
}, 'projection accessors fail closed without execution');
invalid(function(candidate) { candidate[Symbol('extra')] = true; }, 'payload symbols fail closed');
invalid(function(candidate) { candidate.rows[0] = Object.create(candidate.rows[0]); },
  'inherited projection fields fail closed');

function invalidCandidate(candidate, message) {
  assertThrows(function() { canonicalize(candidate); }, 'Invalid booking commit payload', message);
}

function replaceRows(candidate, count, guests, roomFee) {
  candidate.quantity = count;
  candidate.rows = [];
  for (let index = 1; index <= count; index += 1) {
    candidate.rows.push({
      index,
      bookingRowId: 'pb1-' + candidate.operationId + '-r' + index,
      guests,
      roomFee,
      note: ''
    });
  }
  return candidate;
}

const customPayloadPrototype = comparable(payload);
Object.setPrototypeOf(customPayloadPrototype, {});
invalidCandidate(customPayloadPrototype, 'payloads require the plain object prototype');

const arrayLikeRows = comparable(payload);
const arrayLike = Object.create(Array.prototype);
Object.defineProperties(arrayLike, {
  0: { value: arrayLikeRows.rows[0], enumerable: true, configurable: true, writable: true },
  1: { value: arrayLikeRows.rows[1], enumerable: true, configurable: true, writable: true },
  length: { value: 2, writable: true }
});
arrayLikeRows.rows = arrayLike;
invalidCandidate(arrayLikeRows, 'projection rows require a real Array');

const customArrayPrototype = comparable(payload);
Object.setPrototypeOf(customArrayPrototype.rows, {});
invalidCandidate(customArrayPrototype, 'projection rows require the plain Array prototype');

const symbolicRows = comparable(payload);
symbolicRows.rows[Symbol('extra')] = true;
invalidCandidate(symbolicRows, 'projection row arrays reject symbol properties');

const extraArrayProperty = comparable(payload);
extraArrayProperty.rows.extra = true;
invalidCandidate(extraArrayProperty, 'projection row arrays reject extra string properties');

const nonStringNote = comparable(payload);
nonStringNote.rows[0].note = { length: 0, normalize: function() { return this; } };
invalidCandidate(nonStringNote, 'Unicode fields require primitive strings');

invalid(function(candidate) { candidate.bookingNumber = ''; },
  'booking numbers cannot be empty');
invalid(function(candidate) { candidate.rows[0].note = '\ud800x'; },
  'high surrogates require a low-surrogate pair');
invalid(function(candidate) { candidate.rows[0].note = '\udc00'; },
  'lone low surrogates fail closed');

const boxedOperationId = comparable(payload);
boxedOperationId.operationId = new String(operationId);
invalidCandidate(boxedOperationId, 'operation IDs require primitive strings');

invalid(function(candidate) {
  candidate.operationId = 'short';
  candidate.rows.forEach(function(row, index) {
    row.bookingRowId = 'pb1-short-r' + (index + 1);
  });
}, 'operation IDs enforce the canonical grammar');
invalid(function(candidate) { candidate.bookingNumber = null; },
  'booking numbers require canonical Unicode text');
invalid(function(candidate) { candidate.bookingNumber = ' WC-3001 '; },
  'booking numbers reject surrounding whitespace');
invalid(function(candidate) { candidate.bookingNumber = 'WC\n3001'; },
  'booking numbers reject control characters');
invalid(function(candidate) {
  candidate.checkIn = '2027-02-30';
  candidate.checkOut = '2027-03-03';
}, 'impossible calendar dates fail round-trip validation');
invalid(function(candidate) { candidate.checkOut = candidate.checkIn; },
  'zero-night stays fail closed');
invalid(function(candidate) { candidate.checkOut = '2030-01-15'; },
  'stays longer than 800 nights fail closed');

const twoBedroomAsAdventure = replaceRows(comparable(payload), 2, 3, 0);
twoBedroomAsAdventure.roomCode = 'two_bedroom_apartment';
invalidCandidate(twoBedroomAsAdventure,
  'two-bedroom topology cannot use the Adventure Suite quantity range');

invalidCandidate(replaceRows(comparable(payload), 0, 2, 0),
  'Adventure Suite quantity has a lower bound');
invalidCandidate(replaceRows(comparable(payload), 4, 2, 0),
  'Adventure Suite quantity has an upper bound');

const multiplePenthouseRows = replaceRows(comparable(penthouse), 2, 2, 0);
invalidCandidate(multiplePenthouseRows, 'apartment topology requires exactly one row');

const bypassedTopology = replaceRows(comparable(twoBedroom), 2, 3, 0);
invalidCandidate(bypassedTopology, 'topology validation is mandatory');
invalid(function(candidate) { candidate.rowProjectionPolicy = 2; },
  'only row projection policy version 1 is accepted');

const objectRows = comparable(payload);
objectRows.rows = { 0: objectRows.rows[0], 1: objectRows.rows[1], length: 2 };
invalidCandidate(objectRows, 'projection rows must pass dense plain-array validation');

const fractionalGuests = replaceRows(comparable(twoBedroom), 1, 3.5, 0);
invalidCandidate(fractionalGuests, 'guest counts require safe integers');
const underOccupiedTwoBedroom = replaceRows(comparable(twoBedroom), 1, 2, 0);
invalidCandidate(underOccupiedTwoBedroom, 'two-bedroom occupancy has a lower bound');
const overOccupiedTwoBedroom = replaceRows(comparable(twoBedroom), 1, 5, 0);
invalidCandidate(overOccupiedTwoBedroom, 'two-bedroom occupancy has an upper bound');
invalid(function(candidate) { candidate.rows[0].index = 2; },
  'projection row indices must match their array positions');

const nanPenthouseFee = replaceRows(comparable(penthouse), 1, 2, NaN);
invalidCandidate(nanPenthouseFee, 'Penthouse room fees must be finite');
const negativePenthouseFee = replaceRows(comparable(penthouse), 1, 2, -1);
invalidCandidate(negativePenthouseFee, 'Penthouse room fees must be nonnegative');

const tooLongNote = comparable(payload);
tooLongNote.rows[0].note = 'x'.repeat(4097);
assertThrows(function() { canonicalize(tooLongNote); }, 'Invalid booking commit payload',
  'notes exceeding 4096 Unicode scalars fail closed');

let quantityValueOfCalls = 0;
const hostileQuantity = comparable(payload);
hostileQuantity.quantity = {
  valueOf: function() {
    quantityValueOfCalls += 1;
    return 2;
  }
};
assertThrows(function() { canonicalize(hostileQuantity); }, 'Invalid booking commit payload',
  'non-primitive quantities fail closed');
assertEqual(quantityValueOfCalls, 0, 'quantity valueOf is never executed');

let arrayGetCalls = 0;
const descriptorOnlyPayload = comparable(payload);
descriptorOnlyPayload.rows = new Proxy(descriptorOnlyPayload.rows, {
  get: function() {
    arrayGetCalls += 1;
    throw new Error('array property read executed');
  }
});
assertEqual(canonicalize(descriptorOnlyPayload), expectedCanonical,
  'dense row arrays are consumed only through own data descriptors');
assertEqual(arrayGetCalls, 0, 'row-array property getters are never executed');

assertEqual({
  rulesImports: /^import\s/m.test(rulesSource),
  rulesWix: /wix-|wixData|webMethod|Permissions\./.test(rulesSource),
  digestImportsCrypto: /import crypto from ['"]crypto['"]/.test(digestSource),
  digestImportsRules: /roomBookingPayloadRules/.test(digestSource),
  digestWix: /wix-|wixData|webMethod|Permissions\./.test(digestSource)
}, {
  rulesImports: false,
  rulesWix: false,
  digestImportsCrypto: true,
  digestImportsRules: true,
  digestWix: false
}, 'payload rules stay pure and the digest adapter has only deterministic dependencies');
