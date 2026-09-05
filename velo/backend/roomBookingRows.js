import wixData from 'wix-data';

// Backend-only deterministic Bookings persistence. This module is intentionally
// disconnected from public web methods and the production booking path.
const BOOKINGS_COLLECTION = 'Bookings';
const READ_OPTIONS = { suppressAuth: true, consistentRead: true, suppressHooks: true };
const WRITE_OPTIONS = { suppressAuth: true, suppressHooks: true };

export async function loadOperationBookingRows(operationId) {
  if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(operationId)) {
    throw new Error('Invalid operation ID');
  }
  const rows = [];
  const rowIds = Object.create(null);
  const pages = [];
  let page = await wixData.query(BOOKINGS_COLLECTION)
    .eq('operationId', operationId)
    .limit(1000)
    .find(READ_OPTIONS);
  while (page) {
    if (pages.indexOf(page) !== -1 || !Array.isArray(page.items) ||
        typeof page.hasNext !== 'function') {
      throw new Error('Invalid booking row page');
    }
    pages.push(page);
    for (const row of page.items) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          typeof row._id !== 'string' || row.operationId !== operationId ||
          Object.prototype.hasOwnProperty.call(rowIds, row._id)) {
        throw new Error('Invalid booking row page');
      }
      rowIds[row._id] = true;
      rows.push(row);
    }
    if (!page.hasNext()) break;
    if (typeof page.next !== 'function') throw new Error('Invalid booking row page');
    page = await page.next();
  }
  if (!page) throw new Error('Invalid booking row page');
  return rows.slice().sort(function(left, right) {
    return String(left && left._id || '').localeCompare(String(right && right._id || ''));
  });
}

const BOOKINGS = 'Bookings';
const O = Object;
const R = Reflect;
const A = Array;
const N = Number;
const S = String;
const P = Promise;
const D = Date;
const objectPrototype = O.prototype;
const arrayPrototype = A.prototype;
const hasOwn = objectPrototype.hasOwnProperty;
const getPrototypeOf = O.getPrototypeOf;
const getOwnPropertyDescriptor = O.getOwnPropertyDescriptor;
const getDescriptors = O.getOwnPropertyDescriptors;
const createObject = O.create;
const defineProperty = O.defineProperty;
const freezeObject = O.freeze;
const ownKeys = R.ownKeys;
const apply = R.apply;
const isArray = A.isArray;
const arrayPush = A.prototype.push;
const arrayIndexOf = A.prototype.indexOf;
const arrayJoin = A.prototype.join;
const isFiniteNumber = N.isFinite;
const isSafeInteger = N.isSafeInteger;
const dateGetTime = D.prototype.getTime;
const dateToISOString = D.prototype.toISOString;
const stringTrim = S.prototype.trim;
const stringNormalize = S.prototype.normalize;
const stringCharCodeAt = S.prototype.charCodeAt;
const regexpExec = RegExp.prototype.exec;
const promiseResolve = P.resolve;
const objectIs = O.is;
const ErrorCtor = Error;
const operationPattern = /^[A-Za-z0-9_-]{16,64}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const noonPattern = /^\d{4}-\d{2}-\d{2}T12:00:00\.000Z$/;
const controlPattern = /[\u0000-\u001f\u007f]/;
const expectedFields = freezeObject([
  '_id', 'roomCode', 'assignedRoom', 'quantity', 'checkIn', 'checkOut',
  'bookingNumber', 'operationId', 'payloadDigest', 'status',
  'autoOwnerBlock', 'guests', 'roomFee', 'note'
]);
const metadataFields = freezeObject(['_owner', '_createdDate', '_updatedDate']);
const INVALID = freezeObject(createObject(null));

function call(fn, owner, args) {
  return apply(fn, owner, args);
}
function matches(pattern, value) {
  return call(regexpExec, pattern, [value]) !== null;
}
function owns(object, key) {
  return call(hasOwn, object, [key]);
}
function stopped(index, rowId, classification, confirmed) {
  return {
    state: 'STOPPED', confirmed: confirmed || [],
    failed: { index: index, rowId: rowId, classification: classification }
  };
}
function options(read) {
  const value = createObject(objectPrototype);
  defineProperty(value, 'suppressAuth', {
    value: true, enumerable: true, writable: false, configurable: false
  });
  if (read) defineProperty(value, 'consistentRead', {
    value: true, enumerable: true, writable: false, configurable: false
  });
  defineProperty(value, 'suppressHooks', {
    value: true, enumerable: true, writable: false, configurable: false
  });
  return freezeObject(value);
}
function assimilate(value) {
  return call(promiseResolve, P, [value]);
}
function sameKeys(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
function push(array, value) {
  call(arrayPush, array, [value]);
}
function indexOf(array, value) {
  return call(arrayIndexOf, array, [value]);
}
function joined(array, separator) {
  return call(arrayJoin, array, [separator]);
}
function dataProperty(object, key) {
  function take() {
    if (!object || (typeof object !== 'object' && typeof object !== 'function')) return INVALID;
    const seen = [];
    let holder = object;
    for (let depth = 0; depth < 8; depth += 1) {
      if (indexOf(seen, holder) !== -1) return INVALID;
      push(seen, holder);
      const descriptor = call(getOwnPropertyDescriptor, O, [holder, key]);
      if (descriptor) {
        if (!owns(descriptor, 'value')) return INVALID;
        return {
          holder: holder, depth: depth, value: descriptor.value,
          enumerable: descriptor.enumerable, writable: descriptor.writable,
          configurable: descriptor.configurable
        };
      }
      holder = call(getPrototypeOf, O, [holder]);
      if (holder === null) return INVALID;
    }
    return INVALID;
  }
  try {
    const first = take();
    const second = take();
    if (first === INVALID || second === INVALID || first.holder !== second.holder ||
        first.depth !== second.depth || first.value !== second.value ||
        first.enumerable !== second.enumerable || first.writable !== second.writable ||
        first.configurable !== second.configurable) return INVALID;
    return first;
  } catch (error) {
    return INVALID;
  }
}
function capability(object, key) {
  const property = dataProperty(object, key);
  return property !== INVALID && typeof property.value === 'function'
    ? { owner: object, fn: property.value } : INVALID;
}
function scalarCount(value, maximum, allowEmpty) {
  if (typeof value !== 'string' || (!allowEmpty && !value) ||
      call(stringNormalize, value, ['NFC']) !== value) return false;
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = call(stringCharCodeAt, value, [index]);
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (index + 1 >= value.length) return false;
      const next = call(stringCharCodeAt, value, [index + 1]);
      if (next < 0xDC00 || next > 0xDFFF) return false;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) return false;
    count += 1;
    if (count > maximum) return false;
  }
  return true;
}
function dateEvidence(value, allowString) {
  let time;
  let iso;
  try {
    if (allowString && typeof value === 'string') {
      if (!matches(noonPattern, value)) return INVALID;
      const parsed = new D(value);
      time = call(dateGetTime, parsed, []);
      iso = call(dateToISOString, parsed, []);
      if (iso !== value) return INVALID;
    } else {
      time = call(dateGetTime, value, []);
      if (!call(isFiniteNumber, N, [time])) return INVALID;
      iso = call(dateToISOString, new D(time), []);
    }
  } catch (error) {
    return INVALID;
  }
  return call(isFiniteNumber, N, [time]) && matches(noonPattern, iso)
    ? { time: time, iso: iso } : INVALID;
}
function descriptorValue(descriptors, key, enumerable) {
  const descriptor = descriptors[key];
  if (!descriptor || !owns(descriptor, 'value') || descriptor.enumerable !== enumerable) return INVALID;
  return descriptor.value;
}
function takeExpectedSnapshot(rows) {
  try {
    if (!isArray(rows) || call(getPrototypeOf, O, [rows]) !== arrayPrototype) return INVALID;
    const descriptors = call(getDescriptors, O, [rows]);
    const keys = call(ownKeys, R, [descriptors]);
    const length = descriptorValue(descriptors, 'length', false);
    if (!call(isSafeInteger, N, [length]) || length < 1 || length > 3 || keys.length !== length + 1) return INVALID;
    const output = [];
    defineProperty(output, 'snapshotEvidence', {
      value: joined(keys, '|'), enumerable: false, writable: false, configurable: false
    });
    for (let index = 0; index < length; index += 1) {
      const row = descriptorValue(descriptors, S(index), true);
      if (row === INVALID || !row || typeof row !== 'object' || isArray(row) ||
          call(getPrototypeOf, O, [row]) !== objectPrototype) return INVALID;
      const rowDescriptors = call(getDescriptors, O, [row]);
      const rowKeys = call(ownKeys, R, [rowDescriptors]);
      if (rowKeys.length !== expectedFields.length) return INVALID;
      const copy = createObject(null);
      let descriptorEvidence = joined(rowKeys, '|');
      for (let fieldIndex = 0; fieldIndex < expectedFields.length; fieldIndex += 1) {
        const field = expectedFields[fieldIndex];
        const value = descriptorValue(rowDescriptors, field, true);
        if (value === INVALID) return INVALID;
        defineProperty(copy, field, {
          value: value, enumerable: true, writable: true, configurable: true
        });
        descriptorEvidence += ':' + S(rowDescriptors[field].writable) +
          ':' + S(rowDescriptors[field].configurable);
      }
      const checkIn = dateEvidence(copy.checkIn, true);
      const checkOut = dateEvidence(copy.checkOut, true);
      if (checkIn === INVALID || checkOut === INVALID) return INVALID;
      copy.checkInTime = checkIn.time;
      copy.checkInIso = checkIn.iso;
      copy.checkOutTime = checkOut.time;
      copy.checkOutIso = checkOut.iso;
      delete copy.checkIn;
      delete copy.checkOut;
      defineProperty(copy, 'snapshotEvidence', {
        value: descriptorEvidence, enumerable: false, writable: false, configurable: false
      });
      push(output, freezeObject(copy));
    }
    return freezeObject(output);
  } catch (error) {
    return INVALID;
  }
}
function sameExpected(left, right) {
  if (left === INVALID || right === INVALID || left.length !== right.length) return false;
  if (left.snapshotEvidence !== right.snapshotEvidence) return false;
  const fields = expectedFields;
  for (let index = 0; index < left.length; index += 1) {
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      const field = fields[fieldIndex];
      if (field === 'checkIn' || field === 'checkOut') continue;
      if (left[index][field] !== right[index][field]) return false;
    }
    if (left[index].snapshotEvidence !== right[index].snapshotEvidence ||
        left[index].checkInTime !== right[index].checkInTime ||
        left[index].checkOutTime !== right[index].checkOutTime) return false;
  }
  return true;
}
function validExpected(rows) {
  const first = rows[0];
  if (typeof first.operationId !== 'string' || typeof first.payloadDigest !== 'string' ||
      !matches(operationPattern, first.operationId) || !matches(digestPattern, first.payloadDigest) ||
      !scalarCount(first.bookingNumber, 128, false) ||
      call(stringTrim, first.bookingNumber, []) !== first.bookingNumber ||
      matches(controlPattern, first.bookingNumber) || first.checkOutTime <= first.checkInTime) return 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row._id !== 'pb1-' + first.operationId + '-r' + (index + 1) ||
        typeof row._id !== 'string' || typeof row.operationId !== 'string' ||
        typeof row.payloadDigest !== 'string' || typeof row.roomCode !== 'string' ||
        !call(isSafeInteger, N, [row.assignedRoom]) ||
        row.operationId !== first.operationId || row.payloadDigest !== first.payloadDigest ||
        row.bookingNumber !== first.bookingNumber || row.roomCode !== first.roomCode ||
        row.checkInTime !== first.checkInTime || row.checkOutTime !== first.checkOutTime ||
        row.quantity !== 1 || row.status !== 'confirmed' || row.autoOwnerBlock !== false ||
        !call(isSafeInteger, N, [row.guests]) ||
        !call(isFiniteNumber, N, [row.roomFee]) || !call(isSafeInteger, N, [row.roomFee]) ||
        row.roomFee < 0 || call(objectIs, O, [row.roomFee, -0]) ||
        !scalarCount(row.note, 4096, true) || (index > 0 && row.note !== '') ||
        !((row.assignedRoom === 1 && row.roomCode === 'penthouse_apartment') ||
          (row.assignedRoom === 2 && row.roomCode === 'two_bedroom_apartment') ||
          (row.assignedRoom >= 3 && row.assignedRoom <= 5 && row.roomCode === 'adventure_suite')) ||
        (index > 0 && rows[index - 1].assignedRoom >= row.assignedRoom)) return index;
  }
  const unitValues = [];
  for (let index = 0; index < rows.length; index += 1) push(unitValues, rows[index].assignedRoom);
  const units = joined(unitValues, ',');
  const validTopology = (first.roomCode === 'penthouse_apartment' && units === '1') ||
    (first.roomCode === 'two_bedroom_apartment' && units === '2') ||
    (first.roomCode === 'adventure_suite' &&
      (units === '3' || units === '4' || units === '3,4' || units === '3,4,5'));
  if (!validTopology) return rows.length - 1;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].guests !== first.guests) return index;
  }
  return -1;
}
function snapshotExpected(rows) {
  const first = takeExpectedSnapshot(rows);
  const second = takeExpectedSnapshot(rows);
  if (!sameExpected(first, second)) return INVALID;
  return first;
}
function storedSnapshot(value) {
  try {
    if (!value || typeof value !== 'object' || isArray(value) ||
        call(getPrototypeOf, O, [value]) !== objectPrototype) return INVALID;
    const descriptors = call(getDescriptors, O, [value]);
    const keys = call(ownKeys, R, [descriptors]);
    if (keys.length < expectedFields.length || keys.length > expectedFields.length + metadataFields.length) return INVALID;
    const copy = createObject(null);
    const evidence = [];
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string') return INVALID;
      const expected = indexOf(expectedFields, key) !== -1;
      const metadata = indexOf(metadataFields, key) !== -1;
      if (!expected && !metadata) return INVALID;
      const fieldValue = descriptorValue(descriptors, key, true);
      if (fieldValue === INVALID) return INVALID;
      const descriptor = descriptors[key];
      push(evidence, key);
      push(evidence, descriptor.enumerable);
      push(evidence, descriptor.writable);
      push(evidence, descriptor.configurable);
      if (key === '_owner' && typeof fieldValue !== 'string') return INVALID;
      if ((key === '_createdDate' || key === '_updatedDate')) {
        try {
          const metadataTime = call(dateGetTime, fieldValue, []);
          if (!call(isFiniteNumber, N, [metadataTime])) return INVALID;
          push(evidence, metadataTime);
        } catch (error) { return INVALID; }
      } else if (key === '_owner') push(evidence, fieldValue);
      if (expected) defineProperty(copy, key, {
        value: fieldValue, enumerable: true, writable: true, configurable: true
      });
    }
    for (let index = 0; index < expectedFields.length; index += 1) {
      if (!owns(copy, expectedFields[index])) return INVALID;
    }
    const checkIn = dateEvidence(copy.checkIn, false);
    const checkOut = dateEvidence(copy.checkOut, false);
    if (checkIn === INVALID || checkOut === INVALID) return INVALID;
    if (typeof copy._id !== 'string' || typeof copy.roomCode !== 'string' ||
        !call(isSafeInteger, N, [copy.assignedRoom]) ||
        !call(isSafeInteger, N, [copy.quantity]) || typeof copy.bookingNumber !== 'string' ||
        typeof copy.operationId !== 'string' || typeof copy.payloadDigest !== 'string' ||
        typeof copy.status !== 'string' || typeof copy.autoOwnerBlock !== 'boolean' ||
        !call(isSafeInteger, N, [copy.guests]) ||
        !call(isSafeInteger, N, [copy.roomFee]) || typeof copy.note !== 'string') return INVALID;
    defineProperty(copy, 'checkInTime', {
      value: checkIn.time, enumerable: true, writable: false, configurable: false
    });
    defineProperty(copy, 'checkOutTime', {
      value: checkOut.time, enumerable: true, writable: false, configurable: false
    });
    delete copy.checkIn;
    delete copy.checkOut;
    defineProperty(copy, 'snapshotEvidence', {
      value: freezeObject(evidence), enumerable: false, writable: false, configurable: false
    });
    return freezeObject(copy);
  } catch (error) {
    return INVALID;
  }
}
function stableStored(value) {
  const first = storedSnapshot(value);
  const second = storedSnapshot(value);
  return sameCanonical(first, second) && sameKeys(first.snapshotEvidence, second.snapshotEvidence)
    ? first : INVALID;
}
function sameCanonical(left, right) {
  if (left === INVALID || right === INVALID) return false;
  for (let index = 0; index < expectedFields.length; index += 1) {
    const field = expectedFields[index];
    if (field === 'checkIn' || field === 'checkOut') continue;
    if (left[field] !== right[field]) return false;
  }
  return left.checkInTime === right.checkInTime && left.checkOutTime === right.checkOutTime;
}
function expectedCanonical(row) {
  const copy = createObject(null);
  for (let index = 0; index < expectedFields.length; index += 1) {
    const field = expectedFields[index];
    if (field !== 'checkIn' && field !== 'checkOut') defineProperty(copy, field, {
      value: row[field], enumerable: true, writable: false, configurable: false
    });
  }
  defineProperty(copy, 'checkInTime', {
    value: row.checkInTime, enumerable: true, writable: false, configurable: false
  });
  defineProperty(copy, 'checkOutTime', {
    value: row.checkOutTime, enumerable: true, writable: false, configurable: false
  });
  return freezeObject(copy);
}
function mismatchClassification(stored, expected) {
  if (stored.operationId === expected.operationId &&
      (stored.bookingNumber !== expected.bookingNumber || stored.payloadDigest !== expected.payloadDigest)) {
    return 'IDEMPOTENCY_CONFLICT';
  }
  return 'INTEGRITY';
}
function insertionRow(expected) {
  const row = createObject(objectPrototype);
  for (let index = 0; index < expectedFields.length; index += 1) {
    const field = expectedFields[index];
    defineProperty(row, field, {
      value: field === 'checkIn' ? new D(expected.checkInTime) :
        field === 'checkOut' ? new D(expected.checkOutTime) : expected[field],
      enumerable: true, writable: true, configurable: true
    });
  }
  return row;
}

export async function appendPhysicalBookingRows(expectedRows) {
  const rows = snapshotExpected(expectedRows);
  const invalidIndex = rows === INVALID ? 0 : validExpected(rows);
  if (invalidIndex !== -1) {
    let rowId;
    if (rows !== INVALID && rows[invalidIndex]) rowId = rows[invalidIndex]._id;
    return stopped(invalidIndex, rowId, 'INTEGRITY');
  }

  // Capture both Wix capabilities and their receivers before the first suspension.
  const insert = capability(wixData, 'insert');
  const get = capability(wixData, 'get');
  if (insert === INVALID || get === INVALID) {
    return stopped(0, rows[0]._id, 'UNRESOLVED');
  }

  const confirmed = [];
  for (let index = 0; index < rows.length; index += 1) {
    let insertResolved = false;
    try {
      await assimilate(call(insert.fn, insert.owner,
        [BOOKINGS, insertionRow(rows[index]), options(false)]));
      insertResolved = true;
    } catch (error) {
      // Deterministic IDs are classified only by authoritative read-back.
    }

    let raw;
    try {
      raw = await assimilate(call(get.fn, get.owner,
        [BOOKINGS, rows[index]._id, options(true)]));
    } catch (error) {
      return stopped(index, rows[index]._id, 'UNRESOLVED', confirmed);
    }
    if (raw === null || raw === undefined) {
      return stopped(index, rows[index]._id, 'UNRESOLVED', confirmed);
    }
    const stored = stableStored(raw);
    if (stored === INVALID) return stopped(index, rows[index]._id, 'INTEGRITY', confirmed);
    if (!sameCanonical(stored, expectedCanonical(rows[index]))) {
      return stopped(index, rows[index]._id,
        mismatchClassification(stored, rows[index]), confirmed);
    }
    push(confirmed, {
      rowId: rows[index]._id,
      disposition: insertResolved ? 'inserted' : 'already-present'
    });

    // A duplicate means this is a retry. Reconcile the complete suffix and
    // never resume insertion from a partial prefix.
    if (!insertResolved) {
      for (let retryIndex = index + 1; retryIndex < rows.length; retryIndex += 1) {
        let retryRaw;
        try {
          retryRaw = await assimilate(call(get.fn, get.owner,
            [BOOKINGS, rows[retryIndex]._id, options(true)]));
        } catch (error) {
          return stopped(retryIndex, rows[retryIndex]._id, 'UNRESOLVED', confirmed);
        }
        if (retryRaw === null || retryRaw === undefined) {
          return stopped(retryIndex, rows[retryIndex]._id, 'UNRESOLVED', confirmed);
        }
        const retryStored = stableStored(retryRaw);
        if (retryStored === INVALID) {
          return stopped(retryIndex, rows[retryIndex]._id, 'INTEGRITY', confirmed);
        }
        if (!sameCanonical(retryStored, expectedCanonical(rows[retryIndex]))) {
          return stopped(retryIndex, rows[retryIndex]._id,
            mismatchClassification(retryStored, rows[retryIndex]), confirmed);
        }
        push(confirmed, { rowId: rows[retryIndex]._id, disposition: 'already-present' });
      }
      return { state: 'CONFIRMED', confirmed: confirmed };
    }
  }
  return { state: 'CONFIRMED', confirmed: confirmed };
}
