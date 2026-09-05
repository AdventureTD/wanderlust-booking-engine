// Focused behavioral tests for pure booking commit projection rules.
// Run: node scripts/verify-room-booking-commit-projection-rules.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
  const actualJson = JSON.stringify(comparable(actual));
  const expectedJson = JSON.stringify(comparable(expected));
  if (actualJson !== expectedJson) {
    throw new Error('FAIL: ' + message + '\nExpected: ' + expectedJson + '\nActual:   ' + actualJson);
  }
  console.log('PASS: ' + message);
}

function assertThrows(run, message) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  if (!error || error.message !== 'Invalid booking commit projection') {
    throw new Error('FAIL: ' + message + '\nExpected: Invalid booking commit projection\nActual: ' +
      (error && error.message));
  }
  console.log('PASS: ' + message);
}

const rulesPath = process.env.PROJECTION_RULES_PATH ||
  path.join(__dirname, '..', 'velo', 'backend', 'roomBookingCommitProjectionRules.js');
const source = fs.readFileSync(rulesPath, 'utf8');
const context = { Array, Error, Number, Object, Reflect, RegExp, String };
vm.createContext(context);
vm.runInContext(source.replace(/export function /g, 'function ') +
  '\nthis.rules = { projectRoomBookingCommitPayload };', context);
const project = context.rules.projectRoomBookingCommitPayload;

const operationId = 'projectiontrace01';
const input = {
  operationId,
  bookingNumber: 'WC-4001',
  roomCode: 'adventure_suite',
  checkIn: '2028-02-28',
  checkOut: '2028-03-01',
  bookingRowIds: ['pb1-' + operationId + '-r1'],
  guests: 2,
  roomFee: 199,
  note: 'Late arrival café'
};
assertEqual(project(input), {
  operationId,
  bookingNumber: 'WC-4001',
  roomCode: 'adventure_suite',
  quantity: 1,
  checkIn: '2028-02-28',
  checkOut: '2028-03-01',
  rowProjectionPolicy: 1,
  rows: [{
    index: 1,
    bookingRowId: 'pb1-' + operationId + '-r1',
    guests: 2,
    roomFee: 0,
    note: 'Late arrival café'
  }]
}, 'a single Adventure Suite input projects one canonical commit row');

function candidate(overrides) {
  return Object.assign({}, input, overrides || {});
}

const adventureThree = candidate({
  bookingRowIds: [1, 2, 3].map(function(index) { return 'pb1-' + operationId + '-r' + index; })
});
assertEqual(project(adventureThree).rows.map(function(row) {
  return [row.index, row.bookingRowId, row.guests, row.roomFee, row.note];
}), [
  [1, 'pb1-' + operationId + '-r1', 2, 0, 'Late arrival café'],
  [2, 'pb1-' + operationId + '-r2', 2, 0, ''],
  [3, 'pb1-' + operationId + '-r3', 2, 0, '']
], 'three Adventure Suite rows use deterministic positions and one primary note');

const penthouse = candidate({
  roomCode: 'penthouse_apartment', roomFee: 275,
  bookingRowIds: ['pb1-' + operationId + '-r1']
});
assertEqual(project(penthouse).rows[0].roomFee, 275,
  'Penthouse projects the source fee');

const twoBedroom = candidate({
  roomCode: 'two_bedroom_apartment', guests: 4, roomFee: 275,
  bookingRowIds: ['pb1-' + operationId + '-r1']
});
assertEqual(project(twoBedroom).rows[0].roomFee, 0,
  'Two-bedroom projects zero despite a nonzero source fee');

assertThrows(function() {
  project(candidate({ roomCode: 'penthouse_apartment', bookingRowIds: [
    'pb1-' + operationId + '-r1', 'pb1-' + operationId + '-r2'
  ] }));
}, 'Penthouse topology requires exactly one row');

function invalid(mutator, message) {
  const value = candidate({ bookingRowIds: input.bookingRowIds.slice() });
  mutator(value);
  assertThrows(function() { project(value); }, message);
}

invalid(function(value) { delete value.note; }, 'missing input fields fail closed');
invalid(function(value) { value.extra = true; }, 'extra input fields fail closed');
invalid(function(value) { value[Symbol('extra')] = true; }, 'symbol input fields fail closed');
invalid(function(value) { Object.setPrototypeOf(value, null); },
  'input requires the ordinary Object prototype');
invalid(function(value) { Object.setPrototypeOf(value.bookingRowIds, {}); },
  'row IDs require the ordinary Array prototype');
invalid(function(value) { value.bookingRowIds.extra = true; },
  'row ID arrays reject extra properties');
invalid(function(value) { value.bookingRowIds.length = 2; },
  'sparse row ID arrays fail closed');
invalid(function(value) {
  Object.defineProperty(value, 'note', { configurable: false });
}, '[C1 record-configurable-remove] input fields must remain configurable');
invalid(function(value) {
  Object.defineProperty(value, 'note', { writable: false });
}, '[C1 record-writable-remove] input fields must remain writable');
invalid(function(value) {
  Object.defineProperty(value.bookingRowIds, 'length', { writable: false });
}, '[C1 length-writable-remove] row ID array length must remain writable');
[
  ['enumerable', false, 'array-element-enumerable-remove'],
  ['configurable', false, 'array-element-configurable-remove'],
  ['writable', false, 'array-element-writable-remove']
].forEach(function(testCase) {
  invalid(function(value) {
    const descriptor = {};
    descriptor[testCase[0]] = testCase[1];
    Object.defineProperty(value.bookingRowIds, '0', descriptor);
  }, '[C1 ' + testCase[2] + '] row ID elements require ordinary data descriptors');
});

invalid(function(value) {
  const forgedRows = Object.create(Array.prototype);
  Object.defineProperty(forgedRows, '0', {
    value: value.bookingRowIds[0], enumerable: true, configurable: true, writable: true
  });
  Object.defineProperty(forgedRows, 'length', {
    value: 1, enumerable: false, configurable: false, writable: true
  });
  value.bookingRowIds = forgedRows;
}, '[C1 array-guard-remove] Array-prototype forgeries are not row ID arrays');

let accessorCalls = 0;
invalid(function(value) {
  Object.defineProperty(value, 'note', {
    enumerable: true,
    get: function() { accessorCalls += 1; return ''; }
  });
}, 'input accessors fail closed');
assertEqual(accessorCalls, 0, 'input accessors are never executed');

let descriptorPass = 0;
const driftingInput = new Proxy(candidate({ bookingRowIds: input.bookingRowIds.slice() }), {
  ownKeys: function(target) {
    descriptorPass += 1;
    return descriptorPass === 2 ? Reflect.ownKeys(target).reverse() : Reflect.ownKeys(target);
  }
});
assertThrows(function() { project(driftingInput); },
  'input key-order drift between descriptor snapshots fails closed');

let equalValueKeyPass = 0;
const equalValueKeyDrift = new Proxy(candidate({
  roomFee: 2, bookingRowIds: input.bookingRowIds.slice()
}), {
  ownKeys: function(target) {
    equalValueKeyPass += 1;
    const keys = Reflect.ownKeys(target);
    if (equalValueKeyPass === 2) {
      const guestsIndex = keys.indexOf('guests');
      const feeIndex = keys.indexOf('roomFee');
      [keys[guestsIndex], keys[feeIndex]] = [keys[feeIndex], keys[guestsIndex]];
    }
    return keys;
  }
});
assertThrows(function() { project(equalValueKeyDrift); },
  '[C1 stable-first-second-keys-self] equal-valued input keys cannot drift between snapshots');

[
  ['enumerable', false, 'same-enumerable-remove'],
  ['configurable', false, 'same-configurable-remove'],
  ['writable', false, 'same-writable-remove']
].forEach(function(testCase) {
  let descriptorReads = 0;
  const target = candidate({ bookingRowIds: input.bookingRowIds.slice() });
  const driftingDescriptor = new Proxy(target, {
    getOwnPropertyDescriptor: function(value, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (key === 'note') {
        descriptorReads += 1;
        if (descriptorReads === 2) descriptor[testCase[0]] = testCase[1];
      }
      return descriptor;
    }
  });
  assertThrows(function() { project(driftingDescriptor); },
    '[C1 ' + testCase[2] + '] input descriptor attributes cannot drift between snapshots');
});

let signedZeroReads = 0;
const signedZeroTarget = candidate({ roomFee: 0, bookingRowIds: input.bookingRowIds.slice() });
const signedZeroDrift = new Proxy(signedZeroTarget, {
  getOwnPropertyDescriptor: function(value, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (key === 'roomFee') {
      signedZeroReads += 1;
      if (signedZeroReads === 2) descriptor.value = -0;
    }
    return descriptor;
  }
});
assertThrows(function() { project(signedZeroDrift); },
  '[C1 same-value-strict-equality] descriptor snapshots distinguish positive and negative zero');

function withOperation(id) {
  return candidate({ operationId: id, bookingRowIds: ['pb1-' + id + '-r1'] });
}

assertEqual(project(candidate({ bookingRowIds: [
  'pb1-' + operationId + '-r1', 'pb1-' + operationId + '-r2'
] })).quantity, 2, 'two Adventure Suite rows are accepted');
assertEqual(project(withOperation('a'.repeat(16))).operationId, 'a'.repeat(16),
  'operation ID lower boundary is accepted');
assertEqual(project(withOperation('a'.repeat(64))).operationId, 'a'.repeat(64),
  'operation ID upper boundary is accepted');
assertThrows(function() { project(withOperation('a'.repeat(15))); },
  'operation IDs below the lower boundary fail closed');
assertThrows(function() { project(withOperation('a'.repeat(65))); },
  'operation IDs above the upper boundary fail closed');
invalid(function(value) { value.operationId = new String(operationId); },
  'boxed operation IDs fail closed without coercion');
invalid(function(value) { value.operationId = 'invalid operation'; },
  'operation ID grammar is enforced');
invalid(function(value) {
  value.operationId = 'a'.repeat(15) + ' ';
  value.bookingRowIds[0] = 'pb1-' + value.operationId + '-r1';
}, '[C1 operation-allow-space] operation IDs reject an otherwise length-valid space');

assertEqual(project(candidate({ bookingNumber: '😀'.repeat(128) })).bookingNumber,
  '😀'.repeat(128), 'booking number accepts 128 Unicode scalars');
invalid(function(value) { value.bookingNumber = '😀'.repeat(129); },
  'booking number rejects 129 Unicode scalars');
invalid(function(value) { value.bookingNumber = ''; }, 'empty booking numbers fail closed');
invalid(function(value) { value.bookingNumber = ' WC-4001'; },
  'booking numbers reject surrounding whitespace');
invalid(function(value) { value.bookingNumber = 'WC\u0085-4001'; },
  'booking numbers reject Unicode control characters');
invalid(function(value) { value.bookingNumber = 'cafe\u0301'; },
  'booking numbers require NFC');
invalid(function(value) { value.bookingNumber = '\ud800'; },
  'booking numbers reject lone high surrogates');
invalid(function(value) { value.bookingNumber = '\udc00'; },
  'booking numbers reject lone low surrogates');
[
  ['\udc00\udc00', 'high-upper-bound-up'],
  ['\ud800\udbff', 'low-pair-lower-down'],
  ['\ud800\ue000', 'low-pair-upper-up']
].forEach(function(testCase) {
  invalid(function(value) { value.bookingNumber = testCase[0]; },
    '[C1 ' + testCase[1] + '] booking numbers reject malformed surrogate pairs');
});
invalid(function(value) { value.bookingNumber = 'WC\u0000X'; },
  '[C1 booking-control-range-start-up] booking numbers reject U+0000');
invalid(function(value) { value.bookingNumber = 'WC\u009fX'; },
  '[C1 booking-control-upper-down] booking numbers reject U+009F');
invalid(function(value) { value.bookingNumber = { toString: function() { throw new Error('called'); } }; },
  'booking numbers reject coercible objects');

assertEqual(project(candidate({ checkIn: '2028-02-29', checkOut: '2028-03-01' })).checkIn,
  '2028-02-29', 'valid leap days are accepted');
assertEqual(project(candidate({ checkOut: '2030-05-08' })).checkOut,
  '2030-05-08', 'an 800-night stay is accepted');
invalid(function(value) { value.checkOut = value.checkIn; }, 'zero-night stays fail closed');
invalid(function(value) { value.checkOut = '2030-05-09'; }, 'an 801-night stay fails closed');
invalid(function(value) { value.checkIn = '2027-02-29'; }, 'impossible dates fail closed');
invalid(function(value) { value.checkIn = '28-02-28'; }, 'dates require exactly four year digits');
invalid(function(value) { value.checkIn = '999-01-01'; },
  '[C1 date-digit-year-3-4] dates reject three-digit years');
invalid(function(value) { value.checkIn = 'x2028-02-28'; },
  '[C1 date-unanchored-start] dates reject leading characters');
invalid(function(value) { value.checkIn = '2028-02-28x'; },
  '[C1 date-unanchored-end] dates reject trailing characters');
invalid(function(value) { value.checkIn = '1900-02-29'; value.checkOut = '1900-03-01'; },
  '[C1 leap-century-remove] Gregorian century exceptions are enforced');
assertEqual(project(candidate({ checkIn: '2000-02-29', checkOut: '2000-03-01' })).checkIn,
  '2000-02-29', '[C1 leap-400-remove] years divisible by 400 remain leap years');
invalid(function(value) { value.checkIn = '2028-00-01'; value.checkOut = '2028-01-02'; },
  '[C1 month-lower-zero] month zero fails closed');
invalid(function(value) { value.checkIn = '2028-13-01'; value.checkOut = '2029-01-02'; },
  '[C1 month-upper-13] month thirteen fails closed');
invalid(function(value) { value.checkIn = '2028-01-00'; value.checkOut = '2028-01-01'; },
  '[C1 day-lower-zero] day zero fails closed');
invalid(function(value) { value.checkIn = new String('2028-02-28'); },
  'date objects fail closed without coercion');

invalid(function(value) { value.bookingRowIds[0] = 'pb1-' + operationId + '-r2'; },
  'row IDs must match deterministic positions');
invalid(function(value) { value.bookingRowIds[0] = new String('pb1-' + operationId + '-r1'); },
  'boxed row IDs fail closed');

invalid(function(value) { value.guests = '2'; }, 'guest counts require primitive numbers');
invalid(function(value) { value.guests = 2.5; }, 'guest counts require integers');
invalid(function(value) { value.guests = 3; }, 'Adventure Suite requires exactly two guests');
assertEqual(project(candidate({ roomCode: 'two_bedroom_apartment', guests: 3 })).rows[0].guests,
  3, 'two-bedroom guest lower boundary is accepted');
invalid(function(value) { value.roomCode = 'two_bedroom_apartment'; value.guests = 2; },
  'two-bedroom guest lower boundary is enforced');
invalid(function(value) { value.roomCode = 'two_bedroom_apartment'; value.guests = 5; },
  'two-bedroom guest upper boundary is enforced');
invalid(function(value) { value.roomCode = 'two_bedroom_apartment'; value.guests = 3.5; },
  '[C1 guest-safe-int-remove] in-range fractional guest counts fail closed');

[NaN, Infinity, -Infinity, -1, -0, 1.5, Number.MAX_SAFE_INTEGER + 1, '0', new Number(0)].forEach(
  function(fee) {
    invalid(function(value) { value.roomFee = fee; },
      'source room fee rejects malformed value ' + String(fee));
  }
);
assertEqual(project(candidate({ roomFee: Number.MAX_SAFE_INTEGER })).rows[0].roomFee, 0,
  'source room fee safe-integer upper boundary is accepted before zero projection');
assertEqual(project(candidate({ roomFee: 0 })).rows[0].roomFee, 0,
  '[C1 fee-positive-only] positive zero is an accepted source room fee');

assertEqual(project(candidate({ note: '😀'.repeat(4096) })).rows[0].note,
  '😀'.repeat(4096), 'notes accept 4096 Unicode scalars');
invalid(function(value) { value.note = '😀'.repeat(4097); }, 'notes reject 4097 Unicode scalars');
invalid(function(value) { value.note = 'cafe\u0301'; }, 'notes require NFC');
invalid(function(value) { value.note = '\ud800x'; }, 'notes reject malformed UTF-16');
invalid(function(value) { value.note = { normalize: function() { return ''; } }; },
  'notes reject coercible objects without execution');
let hostileNormalizeCalls = 0;
invalid(function(value) {
  value.note = {
    length: 0,
    normalize: function() { hostileNormalizeCalls += 1; return this; }
  };
}, '[C1 unicode-string-check-remove] string-like note objects fail closed');
assertEqual(hostileNormalizeCalls, 0,
  '[C1 unicode-string-check-remove] string-like note hooks are never dispatched');

assertThrows(function() { project(null); }, 'null inputs fail with the normalized error');
assertThrows(function() { project([]); }, 'array inputs fail with the normalized error');
assertThrows(function() {
  project(new Proxy(candidate({ bookingRowIds: input.bookingRowIds.slice() }), {
    ownKeys: function() { throw undefined; }
  }));
}, '[C1 catch-truthy-only] undefined trap failures are normalized');
invalid(function(value) { Object.defineProperty(value, 'note', { value: '', enumerable: false }); },
  'non-plain data descriptors fail closed');
invalid(function(value) { value.bookingRowIds = []; },
  'Adventure Suite row cardinality has a lower bound');
invalid(function(value) {
  value.bookingRowIds = [1, 2, 3, 4].map(function(index) {
    return 'pb1-' + operationId + '-r' + index;
  });
}, 'Adventure Suite row cardinality has an upper bound');
invalid(function(value) { value.roomCode = 'unknown_room'; }, 'unknown room codes fail closed');
invalid(function(value) { value.roomCode = 'penthouse_apartment'; value.guests = 3; },
  'Penthouse requires exactly two guests');
assertEqual(project(candidate({ checkIn: '0000-01-01', checkOut: '0000-01-02' })).checkIn,
  '0000-01-01', 'four-digit year lower boundary is accepted');
assertEqual(project(candidate({ checkIn: '9999-12-30', checkOut: '9999-12-31' })).checkOut,
  '9999-12-31', 'four-digit year upper boundary is accepted');

let rowArrayPass = 0;
const driftingRowsTarget = input.bookingRowIds.slice();
const driftingRows = new Proxy(driftingRowsTarget, {
  getOwnPropertyDescriptor: function(target, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    if (key === '0') {
      rowArrayPass += 1;
      if (rowArrayPass === 2) return Object.assign({}, descriptor, { value: 'changed' });
    }
    return descriptor;
  }
});
assertThrows(function() { project(candidate({ bookingRowIds: driftingRows })); },
  'row ID descriptor value drift fails closed');

const detachedInput = candidate({ bookingRowIds: input.bookingRowIds.slice() });
const detachedInputBefore = JSON.stringify(detachedInput);
const projectedBeforeMutation = project(detachedInput);
assertEqual(JSON.stringify(detachedInput), detachedInputBefore,
  'projection does not mutate its input');
detachedInput.bookingRowIds[0] = 'mutated';
detachedInput.note = 'mutated';
assertEqual(projectedBeforeMutation.rows[0], {
  index: 1,
  bookingRowId: 'pb1-' + operationId + '-r1',
  guests: 2,
  roomFee: 0,
  note: 'Late arrival café'
}, 'caller changes after return cannot alter projected rows');

assertEqual(Reflect.ownKeys(projectedBeforeMutation), [
  'operationId', 'bookingNumber', 'roomCode', 'quantity', 'checkIn', 'checkOut',
  'rowProjectionPolicy', 'rows'
], 'output payload exposes exactly the canonical fields in canonical order');
assertEqual(Reflect.ownKeys(projectedBeforeMutation.rows), ['0', 'length'],
  'output rows are a dense exact Array');
assertEqual(Reflect.ownKeys(projectedBeforeMutation.rows[0]), [
  'index', 'bookingRowId', 'guests', 'roomFee', 'note'
], 'output rows expose exactly the canonical row fields');
context.projectedOutput = projectedBeforeMutation;
assertEqual(vm.runInContext('({\n' +
  'payloadPrototype: Object.getPrototypeOf(projectedOutput) === Object.getPrototypeOf({}),\n' +
  'rowsPrototype: Object.getPrototypeOf(projectedOutput.rows) === Object.getPrototypeOf([]),\n' +
  'rowPrototype: Object.getPrototypeOf(projectedOutput.rows[0]) === Object.getPrototypeOf({})\n' +
'})', context), { payloadPrototype: true, rowsPrototype: true, rowPrototype: true },
'output uses ordinary records and arrays');

const originalOwnKeys = Reflect.ownKeys;
const hiddenExtraTarget = candidate({
  bookingRowIds: input.bookingRowIds.slice(), synchronousPoisonExtra: true
});
const hiddenExtraInput = new Proxy(hiddenExtraTarget, {
  getPrototypeOf: function() {
    Reflect.ownKeys = function(value) {
      return originalOwnKeys(value).filter(function(key) { return key !== 'synchronousPoisonExtra'; });
    };
    return Object.prototype;
  }
});
assertThrows(function() {
  try { project(hiddenExtraInput); } finally { Reflect.ownKeys = originalOwnKeys; }
}, 'synchronous Reflect.ownKeys poisoning cannot hide extra input fields');

const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
let poisonedDescriptorGetterCalls = 0;
const forgedDescriptorTarget = candidate({ bookingRowIds: input.bookingRowIds.slice() });
Object.defineProperty(forgedDescriptorTarget, 'note', {
  enumerable: true,
  configurable: true,
  get: function() { poisonedDescriptorGetterCalls += 1; return ''; }
});
const forgedDescriptorInput = new Proxy(forgedDescriptorTarget, {
  getPrototypeOf: function() {
    Object.getOwnPropertyDescriptor = function(value, key) {
      const descriptor = originalGetOwnPropertyDescriptor(value, key);
      if (value === forgedDescriptorTarget && key === 'note') {
        return { value: '', enumerable: true, configurable: true, writable: true };
      }
      return descriptor;
    };
    return Object.prototype;
  }
});
assertThrows(function() {
  try { project(forgedDescriptorInput); } finally {
    Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
  }
}, 'synchronous Object.getOwnPropertyDescriptor poisoning cannot forge input data descriptors');
assertEqual(poisonedDescriptorGetterCalls, 0,
  'descriptor-forging probes never execute the hostile getter');

const originalIsArray = Array.isArray;
const forgedPoisonRows = Object.create(Array.prototype);
Object.defineProperty(forgedPoisonRows, '0', {
  value: input.bookingRowIds[0], enumerable: true, configurable: true, writable: true
});
Object.defineProperty(forgedPoisonRows, 'length', {
  value: 1, enumerable: false, configurable: false, writable: true
});
const forgedArrayInput = new Proxy(candidate({ bookingRowIds: forgedPoisonRows }), {
  getPrototypeOf: function() {
    Array.isArray = function() { return true; };
    return Object.prototype;
  }
});
assertThrows(function() {
  try { project(forgedArrayInput); } finally { Array.isArray = originalIsArray; }
}, 'synchronous Array.isArray poisoning cannot admit Array-prototype forgeries');

const originalObjectIs = Object.is;
let poisonedSignedZeroReads = 0;
const poisonedSignedZeroTarget = candidate({
  roomFee: 0, bookingRowIds: input.bookingRowIds.slice()
});
const poisonedSignedZeroInput = new Proxy(poisonedSignedZeroTarget, {
  getPrototypeOf: function() {
    Object.is = function() { return true; };
    return Object.prototype;
  },
  getOwnPropertyDescriptor: function(value, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (key === 'roomFee') {
      poisonedSignedZeroReads += 1;
      if (poisonedSignedZeroReads === 2) descriptor.value = -0;
    }
    return descriptor;
  }
});
assertThrows(function() {
  try { project(poisonedSignedZeroInput); } finally { Object.is = originalObjectIs; }
}, 'synchronous Object.is poisoning cannot conceal descriptor value drift');

const originalIsSafeInteger = Number.isSafeInteger;
const fractionalGuestInput = new Proxy(candidate({
  roomCode: 'two_bedroom_apartment', guests: 3.5,
  bookingRowIds: input.bookingRowIds.slice()
}), {
  getPrototypeOf: function() {
    Number.isSafeInteger = function() { return true; };
    return Object.prototype;
  }
});
assertThrows(function() {
  try { project(fractionalGuestInput); } finally { Number.isSafeInteger = originalIsSafeInteger; }
}, 'synchronous Number.isSafeInteger poisoning cannot admit fractional guests');

const originalNormalize = String.prototype.normalize;
const nonCanonicalTextInput = new Proxy(candidate({
  bookingNumber: 'cafe\u0301', bookingRowIds: input.bookingRowIds.slice()
}), {
  getPrototypeOf: function() {
    String.prototype.normalize = function() { return String(this); };
    return Object.prototype;
  }
});
assertThrows(function() {
  try { project(nonCanonicalTextInput); } finally { String.prototype.normalize = originalNormalize; }
}, 'synchronous String#normalize poisoning cannot admit non-NFC text');

const originalTrim = String.prototype.trim;
const whitespaceTextInput = new Proxy(candidate({
  bookingNumber: ' WC-4001', bookingRowIds: input.bookingRowIds.slice()
}), {
  getPrototypeOf: function() {
    String.prototype.trim = function() { return String(this); };
    return Object.prototype;
  }
});
assertThrows(function() {
  try { project(whitespaceTextInput); } finally { String.prototype.trim = originalTrim; }
}, 'synchronous String#trim poisoning cannot admit surrounding whitespace');

const normalizeFunction = String.prototype.normalize;
Object.defineProperty(normalizeFunction, 'call', {
  value: function() { throw new Error('poisoned normalize.call'); }, configurable: true
});
let normalizeCallPoisonOutput;
try { normalizeCallPoisonOutput = project(candidate()); } finally { delete normalizeFunction.call; }
assertEqual(normalizeCallPoisonOutput.bookingNumber, input.bookingNumber,
  '[C1 normalize-dispatch-call] normalization does not dispatch through mutable Function#call');

const trimFunction = String.prototype.trim;
Object.defineProperty(trimFunction, 'call', {
  value: function() { throw new Error('poisoned trim.call'); }, configurable: true
});
let trimCallPoisonOutput;
try { trimCallPoisonOutput = project(candidate()); } finally { delete trimFunction.call; }
assertEqual(trimCallPoisonOutput.bookingNumber, input.bookingNumber,
  '[C1 trim-dispatch-call] trimming does not dispatch through mutable Function#call');

function survivesCapturedPoison(label, poison) {
  let restore = function() {};
  let output;
  try {
    restore = poison();
    output = project(candidate());
  } finally {
    restore();
  }
  assertEqual(output.quantity, 1, label);
}

survivesCapturedPoison('[C1 current-2] captured Array#indexOf survives later replacement', function() {
  const original = Array.prototype.indexOf;
  Array.prototype.indexOf = function() { return -1; };
  return function() { Array.prototype.indexOf = original; };
});

let normalizedError;
try { project(null); } catch (error) { normalizedError = error; }
assertEqual({ name: normalizedError && normalizedError.name, message: normalizedError && normalizedError.message },
  { name: 'Error', message: 'Invalid booking commit projection' },
  '[C1 current-3] normalized failures retain the Error type');

const yearBoundary = project(candidate({ checkIn: '0000-12-31', checkOut: '0001-01-01' }));
assertEqual(yearBoundary.checkIn, '0000-12-31',
  '[C1 current-4] ordinal arithmetic accepts the year-zero boundary stay');

survivesCapturedPoison('[C1 current-8] captured Object.defineProperty survives later replacement', function() {
  const original = Object.defineProperty;
  Object.defineProperty = function() { throw new Error('poisoned defineProperty'); };
  return function() { Object.defineProperty = original; };
});
survivesCapturedPoison('[C1 current-9] captured descriptor lookup survives later replacement', function() {
  const original = Object.getOwnPropertyDescriptor;
  Object.getOwnPropertyDescriptor = function() { return undefined; };
  return function() { Object.getOwnPropertyDescriptor = original; };
});
survivesCapturedPoison('[C1 current-10] captured prototype lookup survives later replacement', function() {
  const original = Object.getPrototypeOf;
  Object.getPrototypeOf = function() { return null; };
  return function() { Object.getPrototypeOf = original; };
});
survivesCapturedPoison('[C1 current-11] captured hasOwnProperty survives later replacement', function() {
  const original = Object.prototype.hasOwnProperty;
  Object.prototype.hasOwnProperty = function() { return false; };
  return function() { Object.prototype.hasOwnProperty = original; };
});
survivesCapturedPoison('[C1 current-13] captured Reflect.apply survives later replacement', function() {
  const original = Reflect.apply;
  Reflect.apply = function() { throw new Error('poisoned Reflect.apply'); };
  return function() { Reflect.apply = original; };
});
survivesCapturedPoison('[C1 current-15] captured RegExp#test survives later replacement', function() {
  const original = RegExp.prototype.test;
  RegExp.prototype.test = function() { return false; };
  return function() { RegExp.prototype.test = original; };
});
survivesCapturedPoison('[C1 current-16] captured String constructor survives later global replacement', function() {
  const original = context.String;
  context.String = function() { return 'wrong'; };
  return function() { context.String = original; };
});
survivesCapturedPoison('[C1 current-17] captured String#charCodeAt survives later replacement', function() {
  const original = String.prototype.charCodeAt;
  String.prototype.charCodeAt = function() { return 0xDC00; };
  return function() { String.prototype.charCodeAt = original; };
});

const originalSlice = String.prototype.slice;
let impossibleDateError;
try {
  String.prototype.slice = function() { return 'x'; };
  project(candidate({ checkIn: '2028-02-31' }));
} catch (error) {
  impossibleDateError = error;
} finally {
  String.prototype.slice = originalSlice;
}
assertEqual(impossibleDateError && impossibleDateError.message, 'Invalid booking commit projection',
  '[C1 current-19] captured String#slice still rejects impossible dates');

survivesCapturedPoison('[C1 current-21] captured Reflect.apply avoids mutable Function#apply', function() {
  const original = Function.prototype.apply;
  Function.prototype.apply = function() { throw new Error('poisoned Function.apply'); };
  return function() { Function.prototype.apply = original; };
});

const realmArrayPrototype = vm.runInContext('Object.getPrototypeOf([])', context);
Object.defineProperty(realmArrayPrototype, '0', { set: function() {}, configurable: true });
let setterPoisonOutput;
try { setterPoisonOutput = project(candidate()); } finally { delete realmArrayPrototype[0]; }
assertEqual(setterPoisonOutput.quantity, 1,
  '[C1 current-24] private array materialization bypasses inherited setters');

let prototypeReadCount = 0;
const driftingPrototypeInput = new Proxy(candidate(), {
  getPrototypeOf: function() {
    prototypeReadCount += 1;
    return prototypeReadCount === 1 ? Object.prototype : null;
  }
});
assertThrows(function() { project(driftingPrototypeInput); },
  '[C1 current-28] input prototype must remain stable across both snapshots');

function callableRecord() {
  const callable = () => {};
  Object.assign(callable, candidate());
  return new Proxy(callable, {
    getPrototypeOf: function() { return Object.prototype; },
    ownKeys: function(target) {
      return Reflect.ownKeys(target).filter(function(key) { return key !== 'name' && key !== 'length'; });
    }
  });
}
assertThrows(function() { project(callableRecord()); },
  '[C1 current-66] callable records fail the first non-object guard');
let callableFailure;
try { project(callableRecord()); } catch (error) { callableFailure = error; }
assertEqual({ name: callableFailure && callableFailure.name, message: callableFailure && callableFailure.message },
  { name: 'Error', message: 'Invalid booking commit projection' },
  '[C1 current-66] callable record failures remain normalized');
assertThrows(function() { project(callableRecord()); },
  '[C1 current-67] callable records fail the second non-object guard');

const supplementaryBoundary = project(candidate({ bookingNumber: '\uDBFF\uDC00' }));
assertEqual(supplementaryBoundary.bookingNumber, '\uDBFF\uDC00',
  '[C1 current-100] the valid U+10FC00 surrogate pair is accepted');
assertThrows(function() { project(candidate({ bookingNumber: '\uDFFF' })); },
  '[C1 current-105] a lone final low surrogate is rejected');
assertThrows(function() {
  project(candidate({ checkIn: 'not-a-day', checkOut: '0000-01-02' }));
}, '[C1 current-158] either invalid canonical date fails closed independently');

const exportsFound = (source.match(/export function\s+\w+/g) || []).map(function(statement) {
  return statement.replace('export function ', '');
});
assertEqual(exportsFound, ['projectRoomBookingCommitPayload'],
  'pure rules export exactly the projection function');
assertEqual({
  imports: /^import\s/m.test(source),
  wix: /wix-|wixData|webMethod|Permissions\./.test(source),
  forbiddenRuntime: /\bDate\b|\bcrypto\b|\bfetch\s*\(|\basync\b/.test(source),
  writes: /\.(insert|update|remove|save|bulkInsert|bulkUpdate|bulkRemove)\s*\(/.test(source)
}, { imports: false, wix: false, forbiddenRuntime: false, writes: false },
'projection rules remain synchronous and free of Wix, time, crypto, database, and network dependencies');
