// Platform-pure, disconnected booking-commit coordination.
// All effects are explicit ports; no Wix API or public booking path is imported here.
import { projectRoomBookingCommitPayload } from 'backend/roomBookingCommitProjectionRules';
import { computeRoomBookingPayloadDigest } from 'backend/roomBookingPayloadDigest';

const DAY_MS = 86400000;
const MAX_NIGHTS = 800;
const INVALID = {};

// Capture mutable intrinsics before any caller-controlled value is inspected.
const SAFE_ARRAY_IS_ARRAY = Array.isArray;
const SAFE_ARRAY_INDEX_OF = Array.prototype.indexOf;
const SAFE_ARRAY_JOIN = Array.prototype.join;
const SAFE_DATE = Date;
const SAFE_DATE_TO_ISO = Date.prototype.toISOString;
const SAFE_ERROR = Error;
const SAFE_MATH_FLOOR = Math.floor;
const SAFE_NUMBER = Number;
const SAFE_NUMBER_IS_FINITE = Number.isFinite;
const SAFE_NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const SAFE_OBJECT_CREATE = Object.create;
const SAFE_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const SAFE_OBJECT_FREEZE = Object.freeze;
const SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const SAFE_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const SAFE_OBJECT_IS = Object.is;
const SAFE_OBJECT_PROTOTYPE = Object.prototype;
const SAFE_ARRAY_PROTOTYPE = Array.prototype;
const SAFE_REFLECT_APPLY = Reflect.apply;
const SAFE_REFLECT_OWN_KEYS = Reflect.ownKeys;
const SAFE_REGEXP_TEST = RegExp.prototype.test;
const SAFE_STRING = String;
const SAFE_STRING_PAD_START = String.prototype.padStart;
const SAFE_STRING_REPLACE = String.prototype.replace;
const SAFE_STRING_SLICE = String.prototype.slice;

function apply(method, receiver, args) {
  return SAFE_REFLECT_APPLY(method, receiver, args);
}

function define(object, key, value) {
  SAFE_OBJECT_DEFINE_PROPERTY(object, key, {
    value, enumerable: true, configurable: true, writable: true
  });
}

function append(array, value) {
  define(array, SAFE_STRING(array.length), value);
}

function recoveryRequired(operationId) {
  const error = new SAFE_ERROR('RECOVERY_REQUIRED');
  define(error, 'code', 'RECOVERY_REQUIRED');
  define(error, 'operationId', operationId);
  return error;
}

function sameKeys(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameDescriptor(left, right) {
  return left && right && 'value' in left && 'value' in right &&
    SAFE_OBJECT_IS(left.value, right.value) && left.enumerable === right.enumerable &&
    left.configurable === right.configurable && left.writable === right.writable;
}

function descriptorSnapshot(value) {
  const keys = SAFE_REFLECT_OWN_KEYS(value);
  const descriptors = [];
  for (let index = 0; index < keys.length; index += 1) {
    append(descriptors, SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, keys[index]));
  }
  return { keys, descriptors };
}

function stableSnapshot(value, prototype) {
  if (!value || typeof value !== 'object' || SAFE_OBJECT_GET_PROTOTYPE_OF(value) !== prototype) return null;
  const first = descriptorSnapshot(value);
  if (SAFE_OBJECT_GET_PROTOTYPE_OF(value) !== prototype) return null;
  const second = descriptorSnapshot(value);
  if (SAFE_OBJECT_GET_PROTOTYPE_OF(value) !== prototype) return null;
  if (!sameKeys(first.keys, second.keys)) return null;
  for (let index = 0; index < first.keys.length; index += 1) {
    if (!sameDescriptor(first.descriptors[index], second.descriptors[index])) return null;
  }
  return first;
}

function snapshotRecord(value, names) {
  if (SAFE_ARRAY_IS_ARRAY(value)) return null;
  const snapshot = stableSnapshot(value, SAFE_OBJECT_PROTOTYPE);
  if (!snapshot || snapshot.keys.length !== names.length) return null;
  const result = {};
  for (let index = 0; index < names.length; index += 1) {
    const keyIndex = apply(SAFE_ARRAY_INDEX_OF, snapshot.keys, [names[index]]);
    if (keyIndex === -1) return null;
    const descriptor = snapshot.descriptors[keyIndex];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true ||
        descriptor.configurable !== true || descriptor.writable !== true) return null;
    define(result, names[index], descriptor.value);
  }
  return result;
}

function snapshotArray(value) {
  if (!SAFE_ARRAY_IS_ARRAY(value)) return null;
  const snapshot = stableSnapshot(value, SAFE_ARRAY_PROTOTYPE);
  if (!snapshot) return null;
  const lengthIndex = apply(SAFE_ARRAY_INDEX_OF, snapshot.keys, ['length']);
  if (lengthIndex === -1) return null;
  const descriptor = snapshot.descriptors[lengthIndex];
  const length = descriptor && descriptor.value;
  if (!SAFE_NUMBER_IS_SAFE_INTEGER(length) || length < 0 || snapshot.keys.length !== length + 1 ||
      descriptor.enumerable !== false || descriptor.configurable !== false || descriptor.writable !== true) return null;
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const keyIndex = apply(SAFE_ARRAY_INDEX_OF, snapshot.keys, [SAFE_STRING(index)]);
    if (keyIndex === -1) return null;
    const itemDescriptor = snapshot.descriptors[keyIndex];
    if (!itemDescriptor || !('value' in itemDescriptor) || itemDescriptor.enumerable !== true ||
        itemDescriptor.configurable !== true || itemDescriptor.writable !== true) return null;
    append(result, itemDescriptor.value);
  }
  return result;
}

function regex(pattern, value) {
  return apply(SAFE_REGEXP_TEST, pattern, [value]);
}

function canonicalDay(value) {
  if (typeof value !== 'string' || !regex(/^\d{4}-\d{2}-\d{2}$/, value)) return null;
  const year = SAFE_NUMBER(apply(SAFE_STRING_SLICE, value, [0, 4]));
  const month = SAFE_NUMBER(apply(SAFE_STRING_SLICE, value, [5, 7]));
  const day = SAFE_NUMBER(apply(SAFE_STRING_SLICE, value, [8, 10]));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) return null;
  let ordinal = 365 * year + SAFE_MATH_FLOOR((year + 3) / 4) -
    SAFE_MATH_FLOOR((year + 99) / 100) + SAFE_MATH_FLOOR((year + 399) / 400);
  for (let index = 0; index < month - 1; index += 1) ordinal += lengths[index];
  return ordinal + day - 1;
}

const UNIX_EPOCH_ORDINAL = canonicalDay('1970-01-01');

function dayFromOrdinal(ordinal) {
  // Date is used only for canonical formatting, through captured intrinsics.
  const date = new SAFE_DATE((ordinal - UNIX_EPOCH_ORDINAL) * DAY_MS);
  return apply(SAFE_STRING_SLICE, apply(SAFE_DATE_TO_ISO, date, []), [0, 10]);
}

function noonUtc(day) {
  return day + 'T12:00:00.000Z';
}

function topologyValid(roomCode, units) {
  if (roomCode === 'penthouse_apartment') return units.length === 1 && units[0] === 1;
  if (roomCode === 'two_bedroom_apartment') return units.length === 1 && units[0] === 2;
  if (roomCode !== 'adventure_suite') return false;
  return (units.length === 1 && (units[0] === 3 || units[0] === 4)) ||
    (units.length === 2 && units[0] === 3 && units[1] === 4) ||
    (units.length === 3 && units[0] === 3 && units[1] === 4 && units[2] === 5);
}

const ROW_FIELDS = [
  '_id', 'roomCode', 'assignedRoom', 'quantity', 'checkIn', 'checkOut',
  'bookingNumber', 'operationId', 'payloadDigest'
];
const IDENTITY_FIELDS = [
  '_id', 'protocolVersion', 'claimKey', 'generation', 'eventType', 'claimType',
  'operationId', 'bookingRowId', 'bookingNumber', 'payloadDigest', 'decisionFenceVersion',
  'manifestVersion', 'manifestCheckIn', 'manifestCheckOut', 'manifestRoomCode',
  'manifestUnits', 'manifestBookingRowIds', 'manifestResourceClaimIds'
];

function eventFields(claimType) {
  return [
    '_id', 'protocolVersion', 'claimKey', 'generation', 'eventType', 'claimType',
    'night', claimType === 'capacity' ? 'capacitySlot' : 'unit', 'operationId',
    'bookingRowId', 'bookingNumber', 'payloadDigest'
  ];
}

function snapshotAndValidate(plan, trustedBookingFields) {
  const planValues = snapshotRecord(plan, ['acquisitions', 'bookingRows', 'primaryRowId']);
  const trusted = snapshotRecord(trustedBookingFields, ['guests', 'roomFee', 'note']);
  if (!planValues || !trusted) return null;
  const rowsInput = snapshotArray(planValues.bookingRows);
  const acquisitionsInput = snapshotArray(planValues.acquisitions);
  if (!rowsInput || rowsInput.length < 1 || rowsInput.length > 3 || !acquisitionsInput) return null;

  const rows = [];
  const units = [];
  const rowIds = [];
  for (let index = 0; index < rowsInput.length; index += 1) {
    const row = snapshotRecord(rowsInput[index], ROW_FIELDS);
    if (!row) return null;
    append(rows, row);
    append(units, row.assignedRoom);
    append(rowIds, row._id);
  }
  const first = rows[0];
  const operationId = first.operationId;
  const payloadDigest = first.payloadDigest;
  const start = canonicalDay(first.checkIn);
  const end = canonicalDay(first.checkOut);
  const nights = start === null || end === null ? 0 : end - start;
  if (typeof operationId !== 'string' || !regex(/^[A-Za-z0-9_-]{16,64}$/, operationId) ||
      typeof payloadDigest !== 'string' || !regex(/^[0-9a-f]{64}$/, payloadDigest) ||
      typeof first.bookingNumber !== 'string' || first.bookingNumber.length < 1 ||
      first.bookingNumber.length > 256 || nights < 1 || nights > MAX_NIGHTS ||
      planValues.primaryRowId !== rowIds[0] || !topologyValid(first.roomCode, units)) return null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row._id !== 'pb1-' + operationId + '-r' + (index + 1) || row.quantity !== 1 ||
        row.roomCode !== first.roomCode || row.checkIn !== first.checkIn ||
        row.checkOut !== first.checkOut || row.bookingNumber !== first.bookingNumber ||
        row.operationId !== operationId || row.payloadDigest !== payloadDigest) return null;
  }

  const expectedResources = nights * rows.length * 2;
  if (acquisitionsInput.length !== expectedResources + 1) return null;
  const identity = snapshotRecord(acquisitionsInput[0], IDENTITY_FIELDS);
  if (!identity || identity._id !== 'rc1-op-' + operationId + '-a' ||
      identity.protocolVersion !== 1 || identity.claimKey !== 'operation:' + operationId ||
      identity.generation !== 1 || identity.eventType !== 'acquire' ||
      identity.claimType !== 'operation' || identity.operationId !== operationId ||
      identity.bookingRowId !== rowIds[0] || identity.bookingNumber !== first.bookingNumber ||
      identity.payloadDigest !== payloadDigest || identity.decisionFenceVersion !== 1 ||
      identity.manifestVersion !== 1 || identity.manifestCheckIn !== first.checkIn ||
      identity.manifestCheckOut !== first.checkOut || identity.manifestRoomCode !== first.roomCode ||
      identity.manifestUnits !== apply(SAFE_ARRAY_JOIN, units, [',']) ||
      identity.manifestBookingRowIds !== apply(SAFE_ARRAY_JOIN, rowIds, ['|'])) return null;

  const acquisitions = [identity];
  const resourceIds = [];
  const seenIds = SAFE_OBJECT_CREATE(null);
  define(seenIds, identity._id, true);
  for (let resourceIndex = 0; resourceIndex < expectedResources; resourceIndex += 1) {
    const capacityPhase = resourceIndex < nights * rows.length;
    const phaseIndex = capacityPhase ? resourceIndex : resourceIndex - nights * rows.length;
    const nightIndex = SAFE_MATH_FLOOR(phaseIndex / rows.length);
    const rowIndex = phaseIndex % rows.length;
    const claimType = capacityPhase ? 'capacity' : 'unit';
    const event = snapshotRecord(acquisitionsInput[resourceIndex + 1], eventFields(claimType));
    if (!event) return null;
    const night = dayFromOrdinal(start + nightIndex);
    const number = capacityPhase ? event.capacitySlot : event.unit;
    const marker = capacityPhase ? 's' : 'u';
    const compactNight = apply(SAFE_STRING_REPLACE, night, [/-/g, '']);
    if (!SAFE_NUMBER_IS_SAFE_INTEGER(event.generation) || event.generation < 1 || event.generation > 999999) return null;
    const generationText = apply(SAFE_STRING_PAD_START, SAFE_STRING(event.generation), [6, '0']);
    if (!SAFE_NUMBER_IS_SAFE_INTEGER(number) || (capacityPhase ? number < 1 || number > 4 : number !== units[rowIndex]) ||
        event._id !== 'rc1-' + compactNight + '-' + marker + number + '-' + generationText + '-a' ||
        event.protocolVersion !== 1 || event.claimKey !== claimType + ':' + night + ':' + number ||
        event.eventType !== 'acquire' || event.claimType !== claimType || event.night !== night ||
        event.operationId !== operationId || event.bookingRowId !== rowIds[rowIndex] ||
        event.bookingNumber !== first.bookingNumber || event.payloadDigest !== payloadDigest ||
        seenIds[event._id] === true) return null;
    if (capacityPhase && rowIndex > 0 &&
        acquisitions[1 + nightIndex * rows.length + rowIndex - 1].capacitySlot >= number) {
      return null;
    }
    define(seenIds, event._id, true);
    append(resourceIds, event._id);
    append(acquisitions, event);
  }
  if (identity.manifestResourceClaimIds !== apply(SAFE_ARRAY_JOIN, resourceIds, ['|'])) return null;

  const bookingRowIds = [];
  for (let index = 0; index < rowIds.length; index += 1) append(bookingRowIds, rowIds[index]);
  const projectionInput = {
    operationId, bookingNumber: first.bookingNumber, roomCode: first.roomCode,
    checkIn: first.checkIn, checkOut: first.checkOut, bookingRowIds,
    guests: trusted.guests, roomFee: trusted.roomFee, note: trusted.note
  };
  const projected = projectRoomBookingCommitPayload(projectionInput);
  const digest = computeRoomBookingPayloadDigest(projected);
  if (typeof digest !== 'string' || !regex(/^[0-9a-f]{64}$/, digest) || digest !== payloadDigest) return null;
  return { acquisitions, rows, projected, operationId, rowIds };
}

function confirmedExactly(result, expectedIds, idField) {
  try {
    const outer = snapshotRecord(result, ['state', 'confirmed']);
    if (!outer || outer.state !== 'CONFIRMED') return false;
    const confirmed = snapshotArray(outer.confirmed);
    if (!confirmed || confirmed.length !== expectedIds.length) return false;
    for (let index = 0; index < expectedIds.length; index += 1) {
      const item = snapshotRecord(confirmed[index], [idField, 'disposition']);
      if (!item || item[idField] !== expectedIds[index] ||
          (item.disposition !== 'inserted' && item.disposition !== 'already-present')) return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function copyFrozenAcquisitions(acquisitions, ids) {
  const result = [];
  for (let index = 0; index < acquisitions.length; index += 1) {
    const source = acquisitions[index];
    const copy = {};
    const keys = SAFE_REFLECT_OWN_KEYS(source);
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      define(copy, keys[keyIndex], source[keys[keyIndex]]);
    }
    append(ids, copy._id);
    append(result, SAFE_OBJECT_FREEZE(copy));
  }
  return SAFE_OBJECT_FREEZE(result);
}

function committedRow(planRow, projectedRow) {
  return {
    _id: planRow._id,
    roomCode: planRow.roomCode,
    assignedRoom: planRow.assignedRoom,
    quantity: 1,
    checkIn: noonUtc(planRow.checkIn),
    checkOut: noonUtc(planRow.checkOut),
    bookingNumber: planRow.bookingNumber,
    operationId: planRow.operationId,
    payloadDigest: planRow.payloadDigest,
    status: 'confirmed',
    autoOwnerBlock: false,
    guests: projectedRow.guests,
    roomFee: projectedRow.roomFee,
    note: projectedRow.note
  };
}

function copyReturnRow(source) {
  return {
    // Async return must not assimilate an ambient Object.prototype.then.
    __proto__: null,
    _id: source._id, roomCode: source.roomCode, assignedRoom: source.assignedRoom,
    quantity: source.quantity, checkIn: new SAFE_DATE(source.checkIn),
    checkOut: new SAFE_DATE(source.checkOut),
    bookingNumber: source.bookingNumber, operationId: source.operationId,
    payloadDigest: source.payloadDigest, status: source.status,
    autoOwnerBlock: source.autoOwnerBlock, guests: source.guests,
    roomFee: source.roomFee, note: source.note
  };
}

export async function coordinatePhysicalBookingCommit(plan, trustedBookingFields, ports) {
  let validated;
  try {
    validated = snapshotAndValidate(plan, trustedBookingFields);
  } catch (error) {
    validated = null;
  }
  if (!validated) throw new SAFE_ERROR('Invalid coordinator plan');

  const operationId = validated.operationId;
  const acquisitionIds = [];
  const acquisitionSnapshot = copyFrozenAcquisitions(validated.acquisitions, acquisitionIds);
  const rowSnapshot = [];
  const rowIds = [];
  let returnRow;
  for (let index = 0; index < validated.rows.length; index += 1) {
    const row = committedRow(validated.rows[index], validated.projected.rows[index]);
    append(rowIds, row._id);
    if (index === 0) returnRow = copyReturnRow(row);
    append(rowSnapshot, SAFE_OBJECT_FREEZE(row));
  }
  SAFE_OBJECT_FREEZE(rowSnapshot);

  let receiver;
  try {
    const values = snapshotRecord(ports, [
      'appendClaimEvents', 'appendRoomOperationDecision', 'appendBookingRows'
    ]);
    if (!values || typeof values.appendClaimEvents !== 'function' ||
        typeof values.appendRoomOperationDecision !== 'function' ||
        typeof values.appendBookingRows !== 'function') throw new SAFE_ERROR('invalid');
    receiver = SAFE_OBJECT_FREEZE(values);
  } catch (error) {
    throw recoveryRequired(operationId);
  }

  let result;
  try {
    result = await apply(receiver.appendClaimEvents, receiver, [acquisitionSnapshot]);
  } catch (error) {
    throw recoveryRequired(operationId);
  }
  if (!confirmedExactly(result, acquisitionIds, 'eventId')) throw recoveryRequired(operationId);

  try {
    result = await apply(receiver.appendRoomOperationDecision, receiver, [operationId, 'commit-rows']);
  } catch (error) {
    throw recoveryRequired(operationId);
  }
  if (!confirmedExactly(result, ['rc1-op-' + operationId + '-d'], 'eventId')) {
    throw recoveryRequired(operationId);
  }

  try {
    result = await apply(receiver.appendBookingRows, receiver, [rowSnapshot]);
  } catch (error) {
    throw recoveryRequired(operationId);
  }
  if (!confirmedExactly(result, rowIds, 'rowId')) throw recoveryRequired(operationId);
  return returnRow;
}
