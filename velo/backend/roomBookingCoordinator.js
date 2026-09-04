// Platform-pure, disconnected booking-commit orchestration tracer.
// All effects are explicit ports; no Wix API or public booking path is imported here.

const DAY_MS = 86400000;
const MAX_MANIFEST_NIGHTS = 800;
const INVALID = {};

function recoveryRequired(operationId) {
  const error = new Error('RECOVERY_REQUIRED');
  error.code = 'RECOVERY_REQUIRED';
  error.operationId = operationId;
  return error;
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
  const actualNames = Object.getOwnPropertyNames(object);
  return actualNames.length === names.length && names.every(function(name) {
    return actualNames.indexOf(name) !== -1 && ownData(object, name) !== INVALID;
  });
}

function isDensePlainArray(value) {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) return false;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1 || names.indexOf('length') === -1) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (names.indexOf(String(index)) === -1 || ownData(value, String(index)) === INVALID) return false;
  }
  return true;
}

function confirmedExactly(result, expectedIds, idField) {
  try {
    if (!hasExactOwnData(result, ['state', 'confirmed']) ||
        ownData(result, 'state') !== 'CONFIRMED') return false;
    const confirmed = ownData(result, 'confirmed');
    if (!isDensePlainArray(confirmed) || confirmed.length !== expectedIds.length) return false;
    for (let index = 0; index < expectedIds.length; index += 1) {
      const item = ownData(confirmed, String(index));
      if (!hasExactOwnData(item, [idField, 'disposition'])) return false;
      const disposition = ownData(item, 'disposition');
      if (ownData(item, idField) !== expectedIds[index] ||
          (disposition !== 'inserted' && disposition !== 'already-present')) return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function canonicalDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return Math.floor(date.getTime() / DAY_MS);
}

function isCanonicalText(value, maxLength) {
  return typeof value === 'string' && !!value && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function expectedRoomCode(unit) {
  if (unit === 1) return 'penthouse_apartment';
  if (unit === 2) return 'two_bedroom_apartment';
  if (Number.isInteger(unit) && unit >= 3 && unit <= 5) return 'adventure_suite';
  return null;
}

function validatePlan(plan, trustedBookingFields) {
  if (!hasExactOwnData(plan, ['acquisitions', 'bookingRows', 'primaryRowId'])) return null;
  const bookingRows = ownData(plan, 'bookingRows');
  const acquisitions = ownData(plan, 'acquisitions');
  if (!isDensePlainArray(bookingRows) || bookingRows.length !== 1 ||
      !isDensePlainArray(acquisitions) || acquisitions.length < 3) return null;

  const row = ownData(bookingRows, '0');
  const rowFields = [
    '_id', 'roomCode', 'assignedRoom', 'quantity', 'checkIn', 'checkOut',
    'bookingNumber', 'operationId', 'payloadDigest'
  ];
  if (!hasExactOwnData(row, rowFields)) return null;
  const operationId = ownData(row, 'operationId');
  const payloadDigest = ownData(row, 'payloadDigest');
  const bookingNumber = ownData(row, 'bookingNumber');
  const rowId = ownData(row, '_id');
  const roomCode = ownData(row, 'roomCode');
  const assignedRoom = ownData(row, 'assignedRoom');
  const checkIn = ownData(row, 'checkIn');
  const checkOut = ownData(row, 'checkOut');
  const startDay = canonicalDay(checkIn);
  const endDay = canonicalDay(checkOut);
  const nightCount = startDay === null || endDay === null ? 0 : endDay - startDay;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(operationId || '') ||
      !/^[0-9a-f]{64}$/.test(payloadDigest || '') ||
      !isCanonicalText(bookingNumber, 128) || rowId !== 'pb1-' + operationId + '-r1' ||
      ownData(plan, 'primaryRowId') !== rowId || ownData(row, 'quantity') !== 1 ||
      roomCode !== expectedRoomCode(assignedRoom) || nightCount < 1 ||
      nightCount > MAX_MANIFEST_NIGHTS || acquisitions.length !== 1 + nightCount * 2) return null;

  const identity = ownData(acquisitions, '0');
  const identityFields = [
    '_id', 'protocolVersion', 'claimKey', 'generation', 'eventType', 'claimType',
    'operationId', 'bookingRowId', 'bookingNumber', 'payloadDigest', 'manifestVersion',
    'manifestCheckIn', 'manifestCheckOut', 'manifestRoomCode', 'manifestUnits',
    'manifestBookingRowIds', 'manifestResourceClaimIds'
  ];
  if (!hasExactOwnData(identity, identityFields) ||
      ownData(identity, '_id') !== 'rc1-op-' + operationId + '-a' ||
      ownData(identity, 'protocolVersion') !== 1 ||
      ownData(identity, 'claimKey') !== 'operation:' + operationId ||
      ownData(identity, 'generation') !== 1 || ownData(identity, 'eventType') !== 'acquire' ||
      ownData(identity, 'claimType') !== 'operation' ||
      ownData(identity, 'operationId') !== operationId ||
      ownData(identity, 'bookingRowId') !== rowId ||
      ownData(identity, 'bookingNumber') !== bookingNumber ||
      ownData(identity, 'payloadDigest') !== payloadDigest ||
      ownData(identity, 'manifestVersion') !== 1 ||
      ownData(identity, 'manifestCheckIn') !== checkIn ||
      ownData(identity, 'manifestCheckOut') !== checkOut ||
      ownData(identity, 'manifestRoomCode') !== roomCode ||
      ownData(identity, 'manifestUnits') !== String(assignedRoom) ||
      ownData(identity, 'manifestBookingRowIds') !== rowId) return null;

  const resourceIds = [];
  const seenIds = Object.create(null);
  seenIds[ownData(identity, '_id')] = true;
  for (let resourceIndex = 0; resourceIndex < nightCount * 2; resourceIndex += 1) {
    const event = ownData(acquisitions, String(resourceIndex + 1));
    const isCapacity = resourceIndex < nightCount;
    const fields = [
      '_id', 'protocolVersion', 'claimKey', 'generation', 'eventType', 'claimType',
      'night', isCapacity ? 'capacitySlot' : 'unit', 'operationId', 'bookingRowId',
      'bookingNumber', 'payloadDigest'
    ];
    if (!hasExactOwnData(event, fields)) return null;
    const nightIndex = isCapacity ? resourceIndex : resourceIndex - nightCount;
    const night = new Date((startDay + nightIndex) * DAY_MS).toISOString().slice(0, 10);
    const generation = ownData(event, 'generation');
    const number = ownData(event, isCapacity ? 'capacitySlot' : 'unit');
    const marker = isCapacity ? 's' : 'u';
    const claimType = isCapacity ? 'capacity' : 'unit';
    const eventId = ownData(event, '_id');
    if (!Number.isInteger(generation) || generation < 1 || generation > 999999 ||
        !Number.isInteger(number) || (isCapacity ? number < 1 || number > 4 : number !== assignedRoom) ||
        eventId !== 'rc1-' + night.replace(/-/g, '') + '-' + marker + number + '-' +
          String(generation).padStart(6, '0') + '-a' ||
        ownData(event, 'protocolVersion') !== 1 ||
        ownData(event, 'claimKey') !== claimType + ':' + night + ':' + number ||
        ownData(event, 'eventType') !== 'acquire' || ownData(event, 'claimType') !== claimType ||
        ownData(event, 'night') !== night || ownData(event, 'operationId') !== operationId ||
        ownData(event, 'bookingRowId') !== rowId ||
        ownData(event, 'bookingNumber') !== bookingNumber ||
        ownData(event, 'payloadDigest') !== payloadDigest ||
        Object.prototype.hasOwnProperty.call(seenIds, eventId)) return null;
    seenIds[eventId] = true;
    resourceIds.push(eventId);
  }
  if (ownData(identity, 'manifestResourceClaimIds') !== resourceIds.join('|')) return null;

  if (!trustedBookingFields || typeof trustedBookingFields !== 'object') return null;
  const guests = ownData(trustedBookingFields, 'guests');
  const roomFee = ownData(trustedBookingFields, 'roomFee');
  const note = ownData(trustedBookingFields, 'note');
  if (!Number.isInteger(guests) || guests < 1 ||
      typeof roomFee !== 'number' || !Number.isFinite(roomFee) || roomFee < 0 ||
      typeof note !== 'string') return null;
  return {
    acquisitions: acquisitions,
    row: row,
    operationId: operationId,
    trusted: {
      guests: guests,
      roomFee: roomFee,
      note: note
    }
  };
}

function noonUtc(day) {
  return new Date(day + 'T12:00:00.000Z');
}

function buildCommittedRow(planRow, trustedBookingFields) {
  return {
    _id: ownData(planRow, '_id'),
    roomCode: ownData(planRow, 'roomCode'),
    assignedRoom: ownData(planRow, 'assignedRoom'),
    quantity: 1,
    checkIn: noonUtc(ownData(planRow, 'checkIn')),
    checkOut: noonUtc(ownData(planRow, 'checkOut')),
    bookingNumber: ownData(planRow, 'bookingNumber'),
    operationId: ownData(planRow, 'operationId'),
    payloadDigest: ownData(planRow, 'payloadDigest'),
    status: 'confirmed',
    autoOwnerBlock: false,
    guests: trustedBookingFields.guests,
    roomFee: trustedBookingFields.roomFee,
    note: trustedBookingFields.note
  };
}

export async function coordinatePhysicalBookingCommit(plan, trustedBookingFields, ports) {
  let validated;
  try {
    validated = validatePlan(plan, trustedBookingFields);
  } catch (error) {
    validated = null;
  }
  if (!validated) throw new Error('Invalid coordinator plan');

  const operationId = validated.operationId;
  const expectedRow = buildCommittedRow(validated.row, validated.trusted);
  const expectedRowId = expectedRow._id;
  const expectedCheckIn = expectedRow.checkIn.toISOString();
  const expectedCheckOut = expectedRow.checkOut.toISOString();
  const rowSnapshot = Object.freeze([Object.freeze(Object.assign({}, expectedRow, {
    checkIn: expectedCheckIn,
    checkOut: expectedCheckOut
  }))]);
  const acquisitionSnapshot = [];
  const acquisitionIds = [];
  for (let index = 0; index < validated.acquisitions.length; index += 1) {
    const source = ownData(validated.acquisitions, String(index));
    const snapshot = {};
    const names = Object.getOwnPropertyNames(source);
    for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
      const name = names[nameIndex];
      snapshot[name] = ownData(source, name);
    }
    acquisitionIds.push(snapshot._id);
    acquisitionSnapshot.push(Object.freeze(snapshot));
  }
  Object.freeze(acquisitionSnapshot);
  let claimResult;
  try {
    claimResult = await ports.appendClaimEvents(acquisitionSnapshot);
  } catch (error) {
    throw recoveryRequired(operationId);
  }
  if (!confirmedExactly(claimResult, acquisitionIds, 'eventId')) {
    throw recoveryRequired(operationId);
  }
  let rowResult;
  try {
    rowResult = await ports.appendBookingRows(rowSnapshot);
  } catch (error) {
    throw recoveryRequired(operationId);
  }
  if (rowSnapshot[0].checkIn !== expectedCheckIn ||
      rowSnapshot[0].checkOut !== expectedCheckOut ||
      !confirmedExactly(rowResult, [expectedRowId], 'rowId')) {
    throw recoveryRequired(operationId);
  }
  return expectedRow;
}
