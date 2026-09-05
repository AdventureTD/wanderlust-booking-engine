import { computeRoomBookingPayloadDigest } from 'backend/roomBookingPayloadDigest';

// Platform-pure recovery orchestration. Persistence remains behind explicit ports.
const O = Object;
const A = Array;
const N = Number;
const S = String;
const P = Promise;
const D = Date;
const R = Reflect;
const objectPrototype = O.prototype;
const arrayPrototype = A.prototype;
const hasOwnProperty = objectPrototype.hasOwnProperty;
const getPrototypeOf = O.getPrototypeOf;
const getOwnPropertyDescriptors = O.getOwnPropertyDescriptors;
const objectCreate = O.create;
const defineProperty = O.defineProperty;
const freeze = O.freeze;
const ownKeys = R.ownKeys;
const apply = R.apply;
const arrayIsArray = A.isArray;
const arrayIndexOf = A.prototype.indexOf;
const arrayPush = A.prototype.push;
const numberIsSafeInteger = N.isSafeInteger;
const numberIsFinite = N.isFinite;
const objectIs = O.is;
const regexpExec = RegExp.prototype.exec;
const promiseResolve = P.resolve;
const ErrorConstructor = Error;
const digestFunction = computeRoomBookingPayloadDigest;
const INVALID = freeze(objectCreate(null));
const requestFields = freeze([
  'operationId', 'bookingNumber', 'roomCode', 'quantity', 'checkIn', 'checkOut',
  'rowProjectionPolicy', 'payloadDigest', 'rows'
]);
const canonicalFields = freeze([
  'operationId', 'bookingNumber', 'roomCode', 'quantity', 'checkIn', 'checkOut',
  'rowProjectionPolicy', 'rows'
]);
const requestRowFields = freeze(['index', 'bookingRowId', 'guests', 'roomFee', 'note']);
const portFields = freeze(['loadCommittedRecoveryManifest', 'appendMissingBookingRows']);
const manifestFields = freeze([
  'operationId', 'bookingNumber', 'payloadDigest', 'roomCode', 'checkIn', 'checkOut',
  'units', 'bookingRowIds'
]);
const confirmationFields = freeze(['state', 'confirmed']);
const confirmationItemFields = freeze(['rowId', 'disposition']);
const digestPattern = /^[0-9a-f]{64}$/;

function call(fn, owner, args) {
  return apply(fn, owner, args);
}
function owns(value, key) {
  return call(hasOwnProperty, value, [key]);
}
function indexOf(values, value) {
  return call(arrayIndexOf, values, [value]);
}
function push(values, value) {
  call(arrayPush, values, [value]);
}
function matches(pattern, value) {
  return call(regexpExec, pattern, [value]) !== null;
}
function sameDescriptor(left, right) {
  return !!left && !!right && owns(left, 'value') && owns(right, 'value') &&
    left.value === right.value && left.enumerable === right.enumerable &&
    left.writable === right.writable && left.configurable === right.configurable;
}
function sameKeySequence(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
function exactRecordSnapshot(value, fields) {
  try {
    if (!value || typeof value !== 'object' || arrayIsArray(value) ||
        call(getPrototypeOf, O, [value]) !== objectPrototype) return INVALID;
    const first = call(getOwnPropertyDescriptors, O, [value]);
    const firstKeys = call(ownKeys, R, [first]);
    const keys = call(ownKeys, R, [value]);
    const second = call(getOwnPropertyDescriptors, O, [value]);
    const secondKeys = call(ownKeys, R, [second]);
    if (!sameKeySequence(firstKeys, keys) || !sameKeySequence(keys, secondKeys) ||
        keys.length !== fields.length) return INVALID;
    const copy = objectCreate(objectPrototype);
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      if (indexOf(keys, field) === -1 || !sameDescriptor(first[field], second[field]) ||
          first[field].enumerable !== true) return INVALID;
      defineProperty(copy, field, {
        value: first[field].value, enumerable: true, writable: false, configurable: false
      });
    }
    return freeze(copy);
  } catch (error) {
    return INVALID;
  }
}
function denseArraySnapshot(value, elementSnapshot) {
  try {
    if (!arrayIsArray(value) || call(getPrototypeOf, O, [value]) !== arrayPrototype) return INVALID;
    const first = call(getOwnPropertyDescriptors, O, [value]);
    const keys = call(ownKeys, R, [value]);
    const second = call(getOwnPropertyDescriptors, O, [value]);
    if (!sameDescriptor(first.length, second.length) ||
        !call(numberIsSafeInteger, N, [first.length.value]) || first.length.value < 0 ||
        keys.length !== first.length.value + 1 || keys[keys.length - 1] !== 'length') return INVALID;
    const copy = new A(first.length.value);
    for (let index = 0; index < first.length.value; index += 1) {
      const key = S(index);
      if (keys[index] !== key || !sameDescriptor(first[key], second[key]) ||
          first[key].enumerable !== true) return INVALID;
      const item = elementSnapshot(first[key].value, index);
      if (item === INVALID) return INVALID;
      defineProperty(copy, key, {
        value: item, enumerable: true, writable: false, configurable: false
      });
    }
    return freeze(copy);
  } catch (error) {
    return INVALID;
  }
}
function recoveryRequired(operationId) {
  const error = new ErrorConstructor('RECOVERY_REQUIRED');
  defineProperty(error, 'code', {
    value: 'RECOVERY_REQUIRED', enumerable: true, writable: true, configurable: true
  });
  defineProperty(error, 'operationId', {
    value: operationId, enumerable: true, writable: true, configurable: true
  });
  return error;
}
function tentativeOperationId(request) {
  try {
    if (!request || typeof request !== 'object' || arrayIsArray(request) ||
        call(getPrototypeOf, O, [request]) !== objectPrototype) return undefined;
    const first = call(getOwnPropertyDescriptors, O, [request]);
    const second = call(getOwnPropertyDescriptors, O, [request]);
    return sameDescriptor(first.operationId, second.operationId) &&
      typeof first.operationId.value === 'string' ? first.operationId.value : undefined;
  } catch (error) {
    return undefined;
  }
}
function projectCanonicalRoomBookingPayload(requestSnapshot, rowSnapshots) {
  const canonical = objectCreate(objectPrototype);
  for (let index = 0; index < canonicalFields.length; index += 1) {
    const field = canonicalFields[index];
    defineProperty(canonical, field, {
      value: field === 'rows' ? rowSnapshots : requestSnapshot[field],
      enumerable: true, writable: false, configurable: false
    });
  }
  return freeze(canonical);
}
function snapshotRequest(request) {
  const snapshot = exactRecordSnapshot(request, requestFields);
  if (snapshot === INVALID) return INVALID;
  const rows = denseArraySnapshot(snapshot.rows, function(row) {
    return exactRecordSnapshot(row, requestRowFields);
  });
  if (rows === INVALID || rows.length !== snapshot.quantity) return INVALID;
  return freeze({ request: snapshot, rows: rows });
}
function snapshotPorts(ports) {
  const snapshot = exactRecordSnapshot(ports, portFields);
  if (snapshot === INVALID || typeof snapshot.loadCommittedRecoveryManifest !== 'function' ||
      typeof snapshot.appendMissingBookingRows !== 'function') return INVALID;
  return snapshot;
}
function primitive(value) {
  return (value === null || (typeof value !== 'object' && typeof value !== 'function' &&
    typeof value !== 'symbol' && typeof value !== 'bigint')) ? value : INVALID;
}
function snapshotManifest(value) {
  const snapshot = exactRecordSnapshot(value, manifestFields);
  if (snapshot === INVALID) return INVALID;
  const units = denseArraySnapshot(snapshot.units, function(unit) {
    return typeof unit === 'number' && call(numberIsSafeInteger, N, [unit]) ? unit : INVALID;
  });
  const bookingRowIds = denseArraySnapshot(snapshot.bookingRowIds, function(rowId) {
    return typeof rowId === 'string' ? rowId : INVALID;
  });
  if (units === INVALID || bookingRowIds === INVALID) return INVALID;
  for (let index = 0; index < 6; index += 1) {
    if (primitive(snapshot[manifestFields[index]]) === INVALID) return INVALID;
  }
  return freeze({
    operationId: snapshot.operationId,
    bookingNumber: snapshot.bookingNumber,
    payloadDigest: snapshot.payloadDigest,
    roomCode: snapshot.roomCode,
    checkIn: snapshot.checkIn,
    checkOut: snapshot.checkOut,
    units: units,
    bookingRowIds: bookingRowIds
  });
}
function validUnits(roomCode, units) {
  if (roomCode === 'penthouse_apartment') return units.length === 1 && units[0] === 1;
  if (roomCode === 'two_bedroom_apartment') return units.length === 1 && units[0] === 2;
  if (roomCode !== 'adventure_suite') return false;
  return (units.length === 1 && (units[0] === 3 || units[0] === 4)) ||
    (units.length === 2 && units[0] === 3 && units[1] === 4) ||
    (units.length === 3 && units[0] === 3 && units[1] === 4 && units[2] === 5);
}
function manifestMatches(manifest, request, rows) {
  if (manifest === INVALID || manifest.operationId !== request.operationId ||
      manifest.bookingNumber !== request.bookingNumber || manifest.payloadDigest !== request.payloadDigest ||
      manifest.roomCode !== request.roomCode || manifest.checkIn !== request.checkIn ||
      manifest.checkOut !== request.checkOut || manifest.units.length !== request.quantity ||
      manifest.bookingRowIds.length !== request.quantity || !validUnits(manifest.roomCode, manifest.units)) return false;
  for (let index = 0; index < request.quantity; index += 1) {
    if (manifest.bookingRowIds[index] !== rows[index].bookingRowId) return false;
  }
  return true;
}
function buildExpectedRows(manifest, rows, checkInTimestamp, checkOutTimestamp) {
  const expected = new A(rows.length);
  for (let index = 0; index < rows.length; index += 1) {
    const row = objectCreate(objectPrototype);
    const values = {
      _id: manifest.bookingRowIds[index], roomCode: manifest.roomCode,
      assignedRoom: manifest.units[index], quantity: 1, checkIn: checkInTimestamp,
      checkOut: checkOutTimestamp, bookingNumber: manifest.bookingNumber,
      operationId: manifest.operationId, payloadDigest: manifest.payloadDigest,
      status: 'confirmed', autoOwnerBlock: false, guests: rows[index].guests,
      roomFee: rows[index].roomFee, note: rows[index].note
    };
    const fields = [
      '_id', 'roomCode', 'assignedRoom', 'quantity', 'checkIn', 'checkOut',
      'bookingNumber', 'operationId', 'payloadDigest', 'status', 'autoOwnerBlock',
      'guests', 'roomFee', 'note'
    ];
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      const field = fields[fieldIndex];
      defineProperty(row, field, {
        value: values[field], enumerable: true, writable: false, configurable: false
      });
    }
    defineProperty(expected, S(index), {
      value: freeze(row), enumerable: true, writable: false, configurable: false
    });
  }
  return freeze(expected);
}
function exactConfirmation(value, expectedIds) {
  const result = exactRecordSnapshot(value, confirmationFields);
  if (result === INVALID || result.state !== 'CONFIRMED') return false;
  const confirmed = denseArraySnapshot(result.confirmed, function(item) {
    return exactRecordSnapshot(item, confirmationItemFields);
  });
  if (confirmed === INVALID || confirmed.length !== expectedIds.length) return false;
  for (let index = 0; index < expectedIds.length; index += 1) {
    if (confirmed[index].rowId !== expectedIds[index] ||
        (confirmed[index].disposition !== 'inserted' &&
         confirmed[index].disposition !== 'already-present')) return false;
  }
  return true;
}
function assimilate(value) {
  return call(promiseResolve, P, [value]);
}

export async function coordinatePhysicalBookingRecovery(request, ports) {
  let operationId;
  let requestData;
  let portSnapshot;
  let digest;
  let canonical;
  try {
    operationId = tentativeOperationId(request);
    requestData = snapshotRequest(request);
    portSnapshot = snapshotPorts(ports);
    if (requestData === INVALID || portSnapshot === INVALID) throw recoveryRequired(operationId);
    operationId = requestData.request.operationId;
    canonical = projectCanonicalRoomBookingPayload(requestData.request, requestData.rows);
    digest = call(digestFunction, undefined, [canonical]);
    if (typeof requestData.request.payloadDigest !== 'string' ||
        !matches(digestPattern, requestData.request.payloadDigest) ||
        digest !== requestData.request.payloadDigest) throw recoveryRequired(operationId);
  } catch (error) {
    throw recoveryRequired(operationId);
  }

  const checkInTimestamp = requestData.request.checkIn + 'T12:00:00.000Z';
  const checkOutTimestamp = requestData.request.checkOut + 'T12:00:00.000Z';
  const expectedIds = new A(requestData.rows.length);
  for (let index = 0; index < requestData.rows.length; index += 1) {
    expectedIds[index] = requestData.rows[index].bookingRowId;
  }
  freeze(expectedIds);

  let loaded;
  try {
    loaded = await assimilate(call(portSnapshot.loadCommittedRecoveryManifest,
      portSnapshot, [operationId]));
  } catch (error) {
    throw recoveryRequired(operationId);
  }
  const manifest = snapshotManifest(loaded);
  if (!manifestMatches(manifest, requestData.request, requestData.rows)) {
    throw recoveryRequired(operationId);
  }
  const expectedRows = buildExpectedRows(
    manifest, requestData.rows, checkInTimestamp, checkOutTimestamp);
  let result;
  try {
    result = await assimilate(call(portSnapshot.appendMissingBookingRows,
      portSnapshot, [expectedRows]));
  } catch (error) {
    throw recoveryRequired(operationId);
  }
  if (!exactConfirmation(result, expectedIds)) throw recoveryRequired(operationId);

  const primary = expectedRows[0];
  return {
    _id: primary._id,
    roomCode: primary.roomCode,
    assignedRoom: primary.assignedRoom,
    quantity: primary.quantity,
    checkIn: new D(checkInTimestamp),
    checkOut: new D(checkOutTimestamp),
    bookingNumber: primary.bookingNumber,
    operationId: primary.operationId,
    payloadDigest: primary.payloadDigest,
    status: primary.status,
    autoOwnerBlock: primary.autoOwnerBlock,
    guests: primary.guests,
    roomFee: primary.roomFee,
    note: primary.note
  };
}
