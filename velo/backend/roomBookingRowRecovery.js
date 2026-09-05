import wixData from 'wix-data';

// Disconnected, append-only repair seam for deterministic physical booking rows.
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
      defineProperty(copy, 'snapshotEvidence', {
        value: descriptorEvidence, enumerable: false, writable: false, configurable: false
      });
      push(output, copy);
    }
    return output;
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
        !scalarCount(row.note, 4096, true) || (index > 0 && row.note !== '')) return index;
  }
  const unitValues = [];
  for (let index = 0; index < rows.length; index += 1) push(unitValues, rows[index].assignedRoom);
  const units = joined(unitValues, ',');
  const validTopology = (first.roomCode === 'penthouse_apartment' && units === '1') ||
    (first.roomCode === 'two_bedroom_apartment' && units === '2') ||
    (first.roomCode === 'adventure_suite' &&
      (units === '3' || units === '4' || units === '3,4' || units === '3,4,5'));
  if (!validTopology) return rows.length - 1;
  const validGuests = (first.roomCode === 'two_bedroom_apartment')
    ? first.guests >= 3 && first.guests <= 4 : first.guests === 2;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].guests !== first.guests ||
        (!validGuests) ||
        (first.roomCode !== 'penthouse_apartment' && rows[index].roomFee !== 0)) return index;
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
function buildQuery(queryFunction, owner, operationId) {
  const queryOwner = call(queryFunction, owner, [BOOKINGS]);
  const eq = capability(queryOwner, 'eq');
  if (eq === INVALID) throw new ErrorCtor('query');
  const limitOwner = call(eq.fn, eq.owner, ['operationId', operationId]);
  const limit = capability(limitOwner, 'limit');
  if (limit === INVALID) throw new ErrorCtor('query');
  const findOwner = call(limit.fn, limit.owner, [1000]);
  const find = capability(findOwner, 'find');
  if (find === INVALID) throw new ErrorCtor('query');
  return { owner: find.owner, find: find.fn };
}
function stableItems(items) {
  function take(value) {
    if (!isArray(value) || call(getPrototypeOf, O, [value]) !== arrayPrototype) return INVALID;
    const descriptors = call(getDescriptors, O, [value]);
    const keys = call(ownKeys, R, [descriptors]);
    const length = descriptorValue(descriptors, 'length', false);
    if (!call(isSafeInteger, N, [length]) || length < 0 || keys.length !== length + 1) return INVALID;
    const copy = [];
    for (let index = 0; index < length; index += 1) {
      const item = descriptorValue(descriptors, S(index), true);
      if (item === INVALID) return INVALID;
      push(copy, item);
    }
    return copy;
  }
  const first = take(items);
  const second = take(items);
  if (first === INVALID || second === INVALID || first.length !== second.length) return INVALID;
  for (let index = 0; index < first.length; index += 1) if (first[index] !== second[index]) return INVALID;
  return first;
}
async function readQuery(plan) {
  const rows = [];
  const pages = [];
  let page;
  try { page = await assimilate(call(plan.find, plan.owner, [options(true)])); }
  catch (error) { return { transport: true }; }
  while (true) {
    if (!page || typeof page !== 'object' || indexOf(pages, page) !== -1) return { transport: true };
    push(pages, page);
    const itemsProperty = dataProperty(page, 'items');
    const items = itemsProperty === INVALID ? INVALID : stableItems(itemsProperty.value);
    if (items === INVALID) return { transport: true };
    for (let index = 0; index < items.length; index += 1) {
      const stored = stableStored(items[index]);
      let id;
      if (stored === INVALID) {
        try {
          const descriptors = call(getDescriptors, O, [items[index]]);
          id = descriptorValue(descriptors, '_id', true);
        } catch (error) { id = undefined; }
      }
      push(rows, { stored: stored, id: id });
    }
    const hasNext = capability(page, 'hasNext');
    if (hasNext === INVALID) return { transport: true };
    let more;
    try { more = call(hasNext.fn, hasNext.owner, []); }
    catch (error) { return { transport: true }; }
    if (more !== true && more !== false) return { transport: true };
    if (!more) return { rows: rows };
    try {
      const next = capability(page, 'next');
      if (next === INVALID) return { transport: true };
      page = await assimilate(call(next.fn, next.owner, []));
    } catch (error) { return { transport: true }; }
  }
}
async function readGets(getFunction, owner, expected) {
  const values = [];
  let transport = false;
  for (let index = 0; index < expected.length; index += 1) {
    let raw;
    try {
      raw = await assimilate(call(getFunction, owner, [BOOKINGS, expected[index]._id, options(true)]));
    } catch (error) {
      transport = true;
      push(values, { present: false });
      continue;
    }
    if (raw === null || raw === undefined) push(values, { present: false });
    else push(values, { present: true, stored: stableStored(raw) });
  }
  return { values: values, transport: transport };
}
function expectedIndexFor(expected, id) {
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index]._id === id) return index;
  }
  return -1;
}
function classifyAgreement(getResult, queryResult, expected, requireFull) {
  if (getResult.transport || queryResult.transport) return stopped(0, expected[0]._id, 'UNRESOLVED');
  const queryById = createObject(null);
  for (let index = 0; index < queryResult.rows.length; index += 1) {
    const evidence = queryResult.rows[index];
    const stored = evidence.stored;
    if (stored === INVALID) {
      const id = evidence.id;
      const expectedIndex = expectedIndexFor(expected, id);
      return stopped(expectedIndex === -1 ? expected.length : expectedIndex, id, 'INTEGRITY');
    }
    const storedIndex = expectedIndexFor(expected, stored._id);
    if (stored.operationId !== expected[0].operationId) return stopped(
      storedIndex === -1 ? expected.length : storedIndex, stored._id, 'INTEGRITY');
    if (owns(queryById, stored._id)) return stopped(expected.length, stored._id, 'INTEGRITY');
    if (storedIndex === -1) {
      return stopped(expected.length, stored._id, 'INTEGRITY');
    }
    queryById[stored._id] = stored;
  }
  const present = [];
  for (let index = 0; index < expected.length; index += 1) {
    const getEvidence = getResult.values[index];
    const getPresent = getEvidence.present;
    const queryPresent = owns(queryById, expected[index]._id);
    let getStored = null;
    if (getPresent) {
      getStored = getEvidence.stored;
      if (getStored === INVALID) return stopped(index, expected[index]._id, 'INTEGRITY');
    }
    if (getPresent !== queryPresent) return stopped(index, expected[index]._id, 'UNRESOLVED');
    if (getPresent && !sameCanonical(getStored, queryById[expected[index]._id])) {
      return stopped(index, expected[index]._id, 'UNRESOLVED');
    }
    if (getPresent && !sameCanonical(getStored, expectedCanonical(expected[index]))) {
      return stopped(index, expected[index]._id, mismatchClassification(getStored, expected[index]));
    }
    push(present, getPresent);
  }
  let prefix = 0;
  while (prefix < present.length && present[prefix]) prefix += 1;
  for (let index = prefix + 1; index < present.length; index += 1) {
    if (present[index]) return stopped(prefix, expected[prefix]._id, 'INTEGRITY');
  }
  if (requireFull && prefix !== expected.length) return stopped(prefix, expected[prefix]._id, 'UNRESOLVED');
  return { prefix: prefix };
}
async function authoritative(getFunction, queryFunction, owner, expected, prebuilt, requireFull) {
  let plan = prebuilt;
  try { if (!plan) plan = buildQuery(queryFunction, owner, expected[0].operationId); }
  catch (error) { return stopped(0, expected[0]._id, 'UNRESOLVED'); }
  const gets = await readGets(getFunction, owner, expected);
  const queried = await readQuery(plan);
  return classifyAgreement(gets, queried, expected, requireFull);
}

export async function appendMissingPhysicalBookingRows(expectedRows) {
  const rows = snapshotExpected(expectedRows);
  const invalidIndex = rows === INVALID ? 0 : validExpected(rows);
  if (invalidIndex !== -1) {
    let rowId;
    if (rows !== INVALID && rows[invalidIndex]) rowId = rows[invalidIndex]._id;
    return stopped(invalidIndex, rowId, 'INTEGRITY');
  }

  // Capture all Wix capabilities that exist before suspension.
  const query = capability(wixData, 'query');
  const get = capability(wixData, 'get');
  const insert = capability(wixData, 'insert');
  if (query === INVALID || get === INVALID || insert === INVALID) {
    return stopped(0, rows[0]._id, 'UNRESOLVED');
  }
  let initialPlan;
  try { initialPlan = buildQuery(query.fn, query.owner, rows[0].operationId); }
  catch (error) { return stopped(0, rows[0]._id, 'UNRESOLVED'); }

  const initial = await authoritative(get.fn, query.fn, get.owner, rows, initialPlan, false);
  if (initial.state === 'STOPPED') return initial;
  const confirmed = [];
  for (let index = 0; index < initial.prefix; index += 1) {
    push(confirmed, { rowId: rows[index]._id, disposition: 'already-present' });
  }
  if (initial.prefix === rows.length) return { state: 'CONFIRMED', confirmed: confirmed };

  for (let index = initial.prefix; index < rows.length; index += 1) {
    let resolved = false;
    try {
      await assimilate(call(insert.fn, insert.owner, [BOOKINGS, insertionRow(rows[index]), options(false)]));
      resolved = true;
    } catch (error) {
      // Duplicate-ID races are classified only by authoritative readback.
    }
    let raw;
    try { raw = await assimilate(call(get.fn, get.owner, [BOOKINGS, rows[index]._id, options(true)])); }
    catch (error) { return stopped(index, rows[index]._id, 'UNRESOLVED', confirmed); }
    if (raw === null || raw === undefined) return stopped(index, rows[index]._id, 'UNRESOLVED', confirmed);
    const stored = stableStored(raw);
    if (stored === INVALID) return stopped(index, rows[index]._id, 'INTEGRITY', confirmed);
    if (!sameCanonical(stored, expectedCanonical(rows[index]))) {
      return stopped(index, rows[index]._id, mismatchClassification(stored, rows[index]), confirmed);
    }
    push(confirmed, { rowId: rows[index]._id, disposition: resolved ? 'inserted' : 'already-present' });
  }

  const finalState = await authoritative(get.fn, query.fn, get.owner, rows, null, true);
  if (finalState.state === 'STOPPED') {
    finalState.confirmed = confirmed;
    return finalState;
  }
  return { state: 'CONFIRMED', confirmed: confirmed };
}
