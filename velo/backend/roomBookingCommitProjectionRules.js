// Pure projection from booking intent to canonical commit payload.
// No Wix, persistence, network, time, randomness, or cryptography belongs here.
const INPUT_FIELDS = [
  'operationId', 'bookingNumber', 'roomCode', 'checkIn', 'checkOut',
  'bookingRowIds', 'guests', 'roomFee', 'note'
];

// Capture every intrinsic before caller-controlled Proxy traps can run.
const SAFE_ARRAY_IS_ARRAY = Array.isArray;
const SAFE_ARRAY_INDEX_OF = Array.prototype.indexOf;
const SAFE_ERROR = Error;
const SAFE_MATH_FLOOR = Math.floor;
const SAFE_NUMBER = Number;
const SAFE_NUMBER_IS_FINITE = Number.isFinite;
const SAFE_NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const SAFE_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const SAFE_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const SAFE_OBJECT_HAS_OWN = Object.prototype.hasOwnProperty;
const SAFE_OBJECT_IS = Object.is;
const SAFE_REFLECT_APPLY = Reflect.apply;
const SAFE_REFLECT_OWN_KEYS = Reflect.ownKeys;
const SAFE_REGEXP_TEST = RegExp.prototype.test;
const SAFE_STRING = String;
const SAFE_STRING_CHAR_CODE_AT = String.prototype.charCodeAt;
const SAFE_STRING_NORMALIZE = String.prototype.normalize;
const SAFE_STRING_SLICE = String.prototype.slice;
const SAFE_STRING_TRIM = String.prototype.trim;

function safeApply(method, receiver, args) {
  return SAFE_REFLECT_APPLY(method, receiver, args);
}

function safeIndexOf(values, value) {
  return safeApply(SAFE_ARRAY_INDEX_OF, values, [value]);
}

function safeRegexTest(pattern, value) {
  return safeApply(SAFE_REGEXP_TEST, pattern, [value]);
}

function defineIndex(array, index, value) {
  SAFE_OBJECT_DEFINE_PROPERTY(array, SAFE_STRING(index), {
    value, enumerable: true, configurable: true, writable: true
  });
}

function sameKeys(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameDescriptor(left, right) {
  return left && right &&
    safeApply(SAFE_OBJECT_HAS_OWN, left, ['value']) &&
    safeApply(SAFE_OBJECT_HAS_OWN, right, ['value']) &&
    SAFE_OBJECT_IS(left.value, right.value) &&
    left.enumerable === right.enumerable &&
    left.configurable === right.configurable &&
    left.writable === right.writable;
}

function descriptorSnapshot(value) {
  const keys = SAFE_REFLECT_OWN_KEYS(value);
  const descriptors = [];
  for (let index = 0; index < keys.length; index += 1) {
    defineIndex(descriptors, index, SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, keys[index]));
  }
  return {
    keys,
    descriptors
  };
}

function stableSnapshot(value, prototype) {
  if (!value || typeof value !== 'object' || SAFE_OBJECT_GET_PROTOTYPE_OF(value) !== prototype) return null;
  const first = descriptorSnapshot(value);
  if (SAFE_OBJECT_GET_PROTOTYPE_OF(value) !== prototype) return null;
  const second = descriptorSnapshot(value);
  if (!sameKeys(first.keys, second.keys)) return null;
  for (let index = 0; index < first.keys.length; index += 1) {
    if (!sameDescriptor(first.descriptors[index], second.descriptors[index])) return null;
  }
  return first;
}

function snapshotRecord(value, names) {
  if (SAFE_ARRAY_IS_ARRAY(value)) return null;
  const snapshot = stableSnapshot(value, Object.prototype);
  if (!snapshot || snapshot.keys.length !== names.length) return null;
  const values = {};
  for (let index = 0; index < names.length; index += 1) {
    const keyIndex = safeIndexOf(snapshot.keys, names[index]);
    if (keyIndex === -1) return null;
    const descriptor = snapshot.descriptors[keyIndex];
    if (!descriptor || descriptor.enumerable !== true || descriptor.configurable !== true ||
        descriptor.writable !== true) return null;
    SAFE_OBJECT_DEFINE_PROPERTY(values, names[index], {
      value: descriptor.value, enumerable: true, configurable: true, writable: true
    });
  }
  return values;
}

function snapshotDenseArray(value) {
  if (!SAFE_ARRAY_IS_ARRAY(value)) return null;
  const snapshot = stableSnapshot(value, Array.prototype);
  if (!snapshot) return null;
  const lengthIndex = safeIndexOf(snapshot.keys, 'length');
  if (lengthIndex === -1) return null;
  const lengthDescriptor = snapshot.descriptors[lengthIndex];
  const length = lengthDescriptor && lengthDescriptor.value;
  if (!SAFE_NUMBER_IS_SAFE_INTEGER(length) || length < 0 || snapshot.keys.length !== length + 1 ||
      lengthDescriptor.enumerable !== false || lengthDescriptor.configurable !== false ||
      lengthDescriptor.writable !== true) return null;
  const values = [];
  for (let index = 0; index < length; index += 1) {
    const keyIndex = safeIndexOf(snapshot.keys, SAFE_STRING(index));
    if (keyIndex === -1) return null;
    const descriptor = snapshot.descriptors[keyIndex];
    if (!descriptor || descriptor.enumerable !== true || descriptor.configurable !== true ||
        descriptor.writable !== true) return null;
    defineIndex(values, index, descriptor.value);
  }
  return values;
}

function validCanonicalUnicode(value, allowEmpty, maximumScalars) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) return false;
  let scalarCount = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = safeApply(SAFE_STRING_CHAR_CODE_AT, value, [index]);
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (index + 1 >= value.length) return false;
      const next = safeApply(SAFE_STRING_CHAR_CODE_AT, value, [index + 1]);
      if (next < 0xDC00 || next > 0xDFFF) return false;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false;
    }
    scalarCount += 1;
    if (scalarCount > maximumScalars) return false;
  }
  return safeApply(SAFE_STRING_NORMALIZE, value, ['NFC']) === value;
}

function validBookingNumber(value) {
  return validCanonicalUnicode(value, false, 128) &&
    safeApply(SAFE_STRING_TRIM, value, []) === value &&
    !safeRegexTest(/[\u0000-\u001F\u007F-\u009F]/, value);
}

function leapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function canonicalDay(value) {
  if (typeof value !== 'string' || !safeRegexTest(/^\d{4}-\d{2}-\d{2}$/, value)) return null;
  const year = SAFE_NUMBER(safeApply(SAFE_STRING_SLICE, value, [0, 4]));
  const month = SAFE_NUMBER(safeApply(SAFE_STRING_SLICE, value, [5, 7]));
  const day = SAFE_NUMBER(safeApply(SAFE_STRING_SLICE, value, [8, 10]));
  const monthLengths = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]) return null;
  let ordinal = 365 * year + SAFE_MATH_FLOOR((year + 3) / 4) -
    SAFE_MATH_FLOOR((year + 99) / 100) + SAFE_MATH_FLOOR((year + 399) / 400);
  for (let index = 0; index < month - 1; index += 1) ordinal += monthLengths[index];
  return ordinal + day - 1;
}

function validGuests(roomCode, guests) {
  if (!SAFE_NUMBER_IS_SAFE_INTEGER(guests)) return false;
  if (roomCode === 'adventure_suite' || roomCode === 'penthouse_apartment') return guests === 2;
  return roomCode === 'two_bedroom_apartment' && guests >= 3 && guests <= 4;
}

function validFee(value) {
  return typeof value === 'number' && SAFE_NUMBER_IS_FINITE(value) &&
    SAFE_NUMBER_IS_SAFE_INTEGER(value) && value >= 0 && !SAFE_OBJECT_IS(value, -0);
}

function project(input) {
  const values = snapshotRecord(input, INPUT_FIELDS);
  if (!values) throw new SAFE_ERROR('invalid');
  const bookingRowIds = snapshotDenseArray(values.bookingRowIds);
  if (!bookingRowIds) throw new SAFE_ERROR('invalid');
  const quantity = bookingRowIds.length;
  if ((values.roomCode === 'adventure_suite' && (quantity < 1 || quantity > 3)) ||
      ((values.roomCode === 'penthouse_apartment' ||
        values.roomCode === 'two_bedroom_apartment') && quantity !== 1) ||
      (values.roomCode !== 'adventure_suite' && values.roomCode !== 'penthouse_apartment' &&
        values.roomCode !== 'two_bedroom_apartment')) throw new SAFE_ERROR('invalid');

  const start = canonicalDay(values.checkIn);
  const end = canonicalDay(values.checkOut);
  if (typeof values.operationId !== 'string' ||
      !safeRegexTest(/^[A-Za-z0-9_-]{16,64}$/, values.operationId) ||
      !validBookingNumber(values.bookingNumber) || start === null || end === null ||
      end - start < 1 || end - start > 800 || !validGuests(values.roomCode, values.guests) ||
      !validFee(values.roomFee) || !validCanonicalUnicode(values.note, true, 4096)) {
    throw new SAFE_ERROR('invalid');
  }
  for (let index = 0; index < quantity; index += 1) {
    if (typeof bookingRowIds[index] !== 'string' ||
        bookingRowIds[index] !== 'pb1-' + values.operationId + '-r' + (index + 1)) {
      throw new SAFE_ERROR('invalid');
    }
  }

  const rows = [];
  for (let index = 0; index < quantity; index += 1) {
    defineIndex(rows, index, {
      index: index + 1,
      bookingRowId: bookingRowIds[index],
      guests: values.guests,
      roomFee: values.roomCode === 'penthouse_apartment' ? values.roomFee : 0,
      note: index === 0 ? values.note : ''
    });
  }
  return {
    operationId: values.operationId,
    bookingNumber: values.bookingNumber,
    roomCode: values.roomCode,
    quantity,
    checkIn: values.checkIn,
    checkOut: values.checkOut,
    rowProjectionPolicy: 1,
    rows
  };
}

export function projectRoomBookingCommitPayload(input) {
  try {
    return project(input);
  } catch (error) {
    throw new SAFE_ERROR('Invalid booking commit projection');
  }
}
