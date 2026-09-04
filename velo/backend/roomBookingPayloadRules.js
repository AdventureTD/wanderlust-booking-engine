// Pure canonicalization for immutable room-booking commit identity.
// No Wix, persistence, network, or cryptographic dependency belongs here.
const DAY_MS = 86400000;
const INVALID = {};

function invalidPayload() {
  throw new Error('Invalid booking commit payload');
}

function ownData(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : INVALID;
}

function hasExactOwnData(object, names) {
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      Object.getPrototypeOf(object) !== Object.prototype ||
      Object.getOwnPropertySymbols(object).length !== 0) return false;
  const actual = Object.getOwnPropertyNames(object);
  if (actual.length !== names.length) return false;
  for (let index = 0; index < names.length; index += 1) {
    if (actual.indexOf(names[index]) === -1 || ownData(object, names[index]) === INVALID) return false;
  }
  return true;
}

function isDensePlainArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) return false;
  const names = Object.getOwnPropertyNames(value);
  const length = ownData(value, 'length');
  if (!Number.isSafeInteger(length) || length < 0 ||
      names.length !== length + 1 || names.indexOf('length') === -1) return false;
  for (let index = 0; index < length; index += 1) {
    if (names.indexOf(String(index)) === -1 || ownData(value, String(index)) === INVALID) return false;
  }
  return true;
}

function isCanonicalUnicode(value, allowEmpty, maxScalars) {
  if (typeof value !== 'string' || (!allowEmpty && !value) || value.normalize('NFC') !== value) {
    return false;
  }
  let scalars = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xDC00 || next > 0xDFFF) return false;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false;
    }
    scalars += 1;
    if (scalars > maxScalars) return false;
  }
  return true;
}

function canonicalDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return Math.floor(parsed.getTime() / DAY_MS);
}

function validBookingNumber(value) {
  return isCanonicalUnicode(value, false, 128) && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validTopology(roomCode, quantity) {
  if (roomCode === 'adventure_suite') return quantity >= 1 && quantity <= 3;
  if (roomCode === 'penthouse_apartment' || roomCode === 'two_bedroom_apartment') {
    return quantity === 1;
  }
  return false;
}

function validGuests(roomCode, guests) {
  if (!Number.isSafeInteger(guests)) return false;
  if (roomCode === 'adventure_suite' || roomCode === 'penthouse_apartment') return guests === 2;
  return roomCode === 'two_bedroom_apartment' && guests >= 3 && guests <= 4;
}

function canonicalize(payload) {
  const payloadFields = [
    'operationId', 'bookingNumber', 'roomCode', 'quantity', 'checkIn', 'checkOut',
    'rowProjectionPolicy', 'rows'
  ];
  if (!hasExactOwnData(payload, payloadFields)) invalidPayload();

  const operationId = ownData(payload, 'operationId');
  const bookingNumber = ownData(payload, 'bookingNumber');
  const roomCode = ownData(payload, 'roomCode');
  const quantity = ownData(payload, 'quantity');
  const checkIn = ownData(payload, 'checkIn');
  const checkOut = ownData(payload, 'checkOut');
  const policy = ownData(payload, 'rowProjectionPolicy');
  const rows = ownData(payload, 'rows');
  const start = canonicalDay(checkIn);
  const end = canonicalDay(checkOut);

  if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(operationId) ||
      !validBookingNumber(bookingNumber) || !Number.isSafeInteger(quantity) ||
      !validTopology(roomCode, quantity) ||
      start === null || end === null || end - start < 1 || end - start > 800 ||
      policy !== 1 || !isDensePlainArray(rows) || ownData(rows, 'length') !== quantity) invalidPayload();

  const canonicalRows = [];
  const rowFields = ['index', 'bookingRowId', 'guests', 'roomFee', 'note'];
  for (let index = 0; index < quantity; index += 1) {
    const row = ownData(rows, String(index));
    if (!hasExactOwnData(row, rowFields)) invalidPayload();
    const rowIndex = ownData(row, 'index');
    const bookingRowId = ownData(row, 'bookingRowId');
    const guests = ownData(row, 'guests');
    const roomFee = ownData(row, 'roomFee');
    const note = ownData(row, 'note');
    if (rowIndex !== index + 1 ||
        bookingRowId !== 'pb1-' + operationId + '-r' + (index + 1) ||
        !validGuests(roomCode, guests) || typeof roomFee !== 'number' ||
        !Number.isFinite(roomFee) ||
        (Number.isFinite(roomFee) && !Number.isSafeInteger(roomFee)) || roomFee < 0 ||
        Object.is(roomFee, -0) ||
        (roomCode !== 'penthouse_apartment' && roomFee !== 0) ||
        !isCanonicalUnicode(note, true, 4096) || (index > 0 && note !== '')) {
      invalidPayload();
    }
    canonicalRows.push([
      String(rowIndex), bookingRowId, String(guests), String(roomFee), note
    ]);
  }

  return JSON.stringify([
    'wanderlust.room-booking-commit',
    2,
    operationId,
    bookingNumber,
    roomCode,
    String(quantity),
    checkIn,
    checkOut,
    'explicit-deterministic-rows-v1',
    canonicalRows
  ]);
}

export function canonicalizeRoomBookingCommitPayload(payload) {
  try {
    return canonicalize(payload);
  } catch (error) {
    invalidPayload();
  }
}
