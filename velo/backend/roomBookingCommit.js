import wixData from 'wix-data';

// Backend-only append-only claim-event persistence. This module is intentionally
// disconnected from public web methods, booking writes, Search, and side effects.
const CLAIM_COLLECTION = 'RoomBookingClaimEvents';
const MAX_MANIFEST_NIGHTS = 800;
const READ_OPTIONS = { suppressAuth: true, consistentRead: true, suppressHooks: true };
const WRITE_OPTIONS = { suppressAuth: true, suppressHooks: true };
const SAFE_OBJECT_PROTOTYPE = Object.prototype;
const SAFE_OBJECT_CREATE = Object.create;
const SAFE_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const SAFE_OBJECT_DEFINE_PROPERTIES = Object.defineProperties;
const SAFE_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS = Object.getOwnPropertyDescriptors;
const SAFE_OBJECT_FREEZE = Object.freeze;
const SAFE_OBJECT_KEYS = Object.keys;
const SAFE_OBJECT_HAS_OWN_PROPERTY = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
const SAFE_REFLECT_OWN_KEYS = Reflect.ownKeys;
const SAFE_REFLECT_APPLY = Reflect.apply;
const SAFE_PROMISE_RESOLVE = Function.prototype.call.bind(Promise.resolve, Promise);
const SAFE_PROMISE_THEN = Promise.prototype.then;
const SAFE_ARRAY = Array;
const SAFE_ARRAY_IS_ARRAY = Array.isArray;
const SAFE_ARRAY_CONCAT = Function.prototype.call.bind(Array.prototype.concat);
const SAFE_ARRAY_EVERY = Function.prototype.call.bind(Array.prototype.every);
const SAFE_ARRAY_FILTER = Function.prototype.call.bind(Array.prototype.filter);
const SAFE_ARRAY_FIND = Function.prototype.call.bind(Array.prototype.find);
const SAFE_ARRAY_FIND_INDEX = Function.prototype.call.bind(Array.prototype.findIndex);
const SAFE_ARRAY_FOR_EACH = Function.prototype.call.bind(Array.prototype.forEach);
const SAFE_ARRAY_INDEX_OF = Function.prototype.call.bind(Array.prototype.indexOf);
const SAFE_ARRAY_MAP = Function.prototype.call.bind(Array.prototype.map);
const SAFE_ARRAY_PUSH = Function.prototype.call.bind(Array.prototype.push);
const SAFE_ARRAY_SLICE = Function.prototype.call.bind(Array.prototype.slice);
const SAFE_ARRAY_SOME = Function.prototype.call.bind(Array.prototype.some);
const SAFE_ERROR = Error;
const SAFE_DATE = Date;
const SAFE_DATE_GET_TIME = Function.prototype.call.bind(Date.prototype.getTime);
const SAFE_DATE_TO_ISO_STRING = Function.prototype.call.bind(Date.prototype.toISOString);
const SAFE_MATH_FLOOR = Math.floor;
const SAFE_NUMBER = Number;
const SAFE_NUMBER_IS_INTEGER = Number.isInteger;
const SAFE_NUMBER_IS_NAN = Number.isNaN;
const SAFE_OBJECT_ASSIGN = Object.assign;
const SAFE_REGEXP = RegExp;
const SAFE_SET = Set;
const SAFE_SET_HAS = Function.prototype.call.bind(Set.prototype.has);
const SAFE_STRING = String;
const SAFE_REGEXP_EXEC = Function.prototype.call.bind(RegExp.prototype.exec);
const SAFE_REGEXP_TEST = function(pattern, value) { return SAFE_REGEXP_EXEC(pattern, value) !== null; };
const SAFE_STRING_CHAR_AT = Function.prototype.call.bind(String.prototype.charAt);
const SAFE_STRING_INDEX_OF = Function.prototype.call.bind(String.prototype.indexOf);
const SAFE_STRING_JOIN = Function.prototype.call.bind(Array.prototype.join);
const SAFE_STRING_LAST_INDEX_OF = Function.prototype.call.bind(String.prototype.lastIndexOf);
const SAFE_STRING_PAD_START = Function.prototype.call.bind(String.prototype.padStart);
const SAFE_STRING_REPLACE = Function.prototype.call.bind(String.prototype.replace);
const SAFE_STRING_SLICE = Function.prototype.call.bind(String.prototype.slice);
const SAFE_STRING_SPLIT = Function.prototype.call.bind(String.prototype.split);
const SAFE_STRING_TRIM = Function.prototype.call.bind(String.prototype.trim);
const SAFE_ORDINARY_PROTOTYPE_NAMES = SAFE_OBJECT_CREATE(null);
const SAFE_ORDINARY_PROTOTYPE_NAME_LIST = [
  'constructor', '__defineGetter__', '__defineSetter__', 'hasOwnProperty',
  '__lookupGetter__', '__lookupSetter__', 'isPrototypeOf', 'propertyIsEnumerable',
  'toString', 'valueOf', '__proto__', 'toLocaleString'
];
for (let index = 0; index < SAFE_ORDINARY_PROTOTYPE_NAME_LIST.length; index += 1) {
  const key = SAFE_ORDINARY_PROTOTYPE_NAME_LIST[index];
  SAFE_OBJECT_DEFINE_PROPERTY(SAFE_ORDINARY_PROTOTYPE_NAMES, key, {
    value: true, writable: false, enumerable: true, configurable: false
  });
}
const SAFE_ORDINARY_PROTOTYPE_NAME_COUNT = 12;

function hasOrdinaryPrototypeKeys(keys) {
  if (keys.length !== SAFE_ORDINARY_PROTOTYPE_NAME_COUNT) return false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string' || !SAFE_OBJECT_HAS_OWN_PROPERTY(SAFE_ORDINARY_PROTOTYPE_NAMES, key)) {
      return false;
    }
  }
  return true;
}

export async function loadRoomClaimLedger() {
  const items = [];
  const eventIds = [];
  const pages = [];
  let page = await wixData.query(CLAIM_COLLECTION).limit(1000).find(READ_OPTIONS);
  if (!page || typeof page !== 'object') {
    throw new Error('Claim ledger paging returned no page');
  }
  while (page) {
    if (SAFE_ARRAY_INDEX_OF(pages, page) !== -1) {
      throw new Error('Claim ledger paging repeated a page');
    }
    SAFE_ARRAY_PUSH(pages, page);
    if (!SAFE_ARRAY_IS_ARRAY(page.items)) {
      throw new Error('Claim ledger paging result has invalid items');
    }
    for (let itemIndex = 0; itemIndex < page.items.length; itemIndex += 1) {
      const item = page.items[itemIndex];
      if (SAFE_ARRAY_INDEX_OF(eventIds, item && item._id) !== -1) {
        throw new Error('Claim ledger contains duplicate event IDs');
      }
      SAFE_ARRAY_PUSH(eventIds, item && item._id);
      SAFE_ARRAY_PUSH(items, item);
    }
    if (typeof page.hasNext !== 'function') {
      throw new Error('Claim ledger paging result is missing hasNext()');
    }
    if (!page.hasNext()) break;
    if (typeof page.next !== 'function') {
      throw new Error('Claim ledger paging result is missing next()');
    }
    page = await page.next();
    if (!page || typeof page !== 'object') {
      throw new Error('Claim ledger paging returned no page');
    }
  }
  return items;
}

function matchesEvent(stored, expected) {
  return stored && typeof stored === 'object' &&
    SAFE_ARRAY_EVERY(SAFE_OBJECT_KEYS(expected), function(key) {
      return stored[key] === expected[key];
    }) &&
    SAFE_ARRAY_EVERY(SAFE_OBJECT_KEYS(stored), function(key) {
      return SAFE_STRING_CHAR_AT(key, 0) === '_' || SAFE_OBJECT_HAS_OWN_PROPERTY(expected, key);
    });
}

const IDENTITY_EVIDENCE_FIELDS = [
  '_id', 'protocolVersion', 'claimKey', 'generation', 'eventType', 'claimType',
  'operationId', 'bookingRowId', 'bookingNumber', 'payloadDigest', 'manifestVersion',
  'manifestCheckIn', 'manifestCheckOut', 'manifestRoomCode', 'manifestUnits',
  'manifestBookingRowIds', 'manifestResourceClaimIds'
];
const MARKED_IDENTITY_EVIDENCE_FIELDS = SAFE_ARRAY_CONCAT(
  IDENTITY_EVIDENCE_FIELDS, ['decisionFenceVersion']);
const CAPACITY_EVIDENCE_FIELDS = [
  '_id', 'protocolVersion', 'claimKey', 'generation', 'eventType', 'claimType',
  'night', 'capacitySlot', 'operationId', 'bookingRowId', 'bookingNumber', 'payloadDigest'
];
const UNIT_EVIDENCE_FIELDS = [
  '_id', 'protocolVersion', 'claimKey', 'generation', 'eventType', 'claimType',
  'night', 'unit', 'operationId', 'bookingRowId', 'bookingNumber', 'payloadDigest'
];
const COMPLETION_EVIDENCE_FIELDS = [
  '_id', 'protocolVersion', 'claimKey', 'generation', 'eventType', 'claimType',
  'operationId', 'bookingRowId', 'bookingNumber', 'payloadDigest', 'completionState',
  'confirmedResourceCount'
];
const MARKED_COMPLETION_EVIDENCE_FIELDS = SAFE_ARRAY_CONCAT(
  COMPLETION_EVIDENCE_FIELDS, ['decisionFenceVersion']);
const DECISION_EVIDENCE_FIELDS = [
  '_id', 'protocolVersion', 'claimKey', 'generation', 'eventType', 'claimType',
  'operationId', 'bookingRowId', 'bookingNumber', 'payloadDigest', 'decisionFenceVersion',
  'operationIdentityId', 'operationCompletionId', 'manifestVersion', 'completionState',
  'confirmedResourceCount', 'decisionState'
];
const WIX_SYSTEM_METADATA_FIELDS = ['_owner', '_createdDate', '_updatedDate'];
const CLAIM_EVENT_INPUT_FIELDS = [
  '_id', 'protocolVersion', 'claimKey', 'eventType', 'claimType', 'generation',
  'night', 'capacitySlot', 'unit', 'operationId', 'payloadDigest', 'bookingNumber',
  'bookingRowId', 'releaseReason', 'manifestVersion', 'manifestCheckIn',
  'manifestCheckOut', 'manifestRoomCode', 'manifestUnits',
  'manifestBookingRowIds', 'manifestResourceClaimIds', 'completionState',
  'confirmedResourceCount', 'decisionFenceVersion', 'operationIdentityId',
  'operationCompletionId', 'decisionState'
];

function snapshotClaimEventInput(value) {
  if (!value || typeof value !== 'object' || SAFE_ARRAY_IS_ARRAY(value)) return null;
  let prototype;
  let first;
  let keys;
  let second;
  try {
    prototype = SAFE_OBJECT_GET_PROTOTYPE_OF(value);
    first = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
    keys = SAFE_REFLECT_OWN_KEYS(value);
    second = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
  } catch (error) {
    return null;
  }
  if (!isOrdinaryRecordPrototype(prototype) || !sameOwnKeySequence(keys, first) ||
      !sameOwnKeySequence(keys, second)) return null;
  const copy = SAFE_OBJECT_CREATE(SAFE_OBJECT_PROTOTYPE);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string' || SAFE_ARRAY_INDEX_OF(CLAIM_EVENT_INPUT_FIELDS, key) === -1 ||
        !sameDataDescriptor(first[key], second[key]) || first[key].enumerable !== true ||
        (first[key].value !== null && typeof first[key].value === 'object') ||
        typeof first[key].value === 'function' || typeof first[key].value === 'symbol' ||
        typeof first[key].value === 'bigint') return null;
    SAFE_OBJECT_DEFINE_PROPERTY(copy, key, {
      value: first[key].value, writable: true, enumerable: true, configurable: true
    });
  }
  return SAFE_OBJECT_FREEZE(copy);
}

function invalidClaimEventSnapshot(value) {
  const copy = SAFE_OBJECT_CREATE(SAFE_OBJECT_PROTOTYPE);
  if (!value || typeof value !== 'object') return copy;
  let first;
  let second;
  try {
    first = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
    second = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
  } catch (error) {
    return copy;
  }
  if (sameDataDescriptor(first._id, second._id) && first._id.enumerable === true &&
      typeof first._id.value === 'string') {
    SAFE_OBJECT_DEFINE_PROPERTY(copy, '_id', {
      value: first._id.value, writable: true, enumerable: true, configurable: true
    });
  }
  return copy;
}

function snapshotClaimEventBatch(value) {
  if (!SAFE_ARRAY_IS_ARRAY(value)) return null;
  let first;
  let keys;
  let second;
  try {
    first = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
    keys = SAFE_REFLECT_OWN_KEYS(value);
    second = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
  } catch (error) {
    return null;
  }
  if (!sameOwnKeySequence(keys, first) || !sameOwnKeySequence(keys, second) ||
      !sameDataDescriptor(first.length, second.length) ||
      !SAFE_NUMBER_IS_INTEGER(first.length.value) || first.length.value < 0 ||
      keys.length !== first.length.value + 1) return null;
  const copy = new SAFE_ARRAY(first.length.value);
  for (let index = 0; index < first.length.value; index += 1) {
    const key = SAFE_STRING(index);
    if (keys[index] !== key || !sameDataDescriptor(first[key], second[key]) ||
        first[key].enumerable !== true) return null;
    copy[index] = snapshotClaimEventInput(first[key].value) ||
      invalidClaimEventSnapshot(first[key].value);
  }
  if (keys[keys.length - 1] !== 'length') return null;
  return copy;
}

function isOrdinaryRecordPrototype(prototype) {
  if (prototype === null) return false;
  let parent;
  let keys;
  let descriptors;
  try {
    parent = SAFE_OBJECT_GET_PROTOTYPE_OF(prototype);
    keys = SAFE_REFLECT_OWN_KEYS(prototype);
    descriptors = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(prototype);
  } catch (error) {
    return false;
  }
  if (parent !== null || !hasOrdinaryPrototypeKeys(keys)) return false;
  for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== false || descriptor.configurable !== true) return false;
      if (key === '__proto__') {
        if (SAFE_OBJECT_HAS_OWN_PROPERTY(descriptor, 'value') ||
            typeof descriptor.get !== 'function' || typeof descriptor.set !== 'function') return false;
      } else if (!SAFE_OBJECT_HAS_OWN_PROPERTY(descriptor, 'value') ||
          descriptor.writable !== true || typeof descriptor.value !== 'function') {
        return false;
      }
  }
  return true;
}

function sameDataDescriptor(left, right) {
  return !!left && !!right &&
    SAFE_OBJECT_HAS_OWN_PROPERTY(left, 'value') &&
    SAFE_OBJECT_HAS_OWN_PROPERTY(right, 'value') &&
    left.value === right.value && left.enumerable === right.enumerable &&
    left.configurable === right.configurable && left.writable === right.writable;
}

function sameOwnKeySequence(keys, descriptorMap) {
  let descriptorKeys;
  try {
    descriptorKeys = SAFE_REFLECT_OWN_KEYS(descriptorMap);
  } catch (error) {
    return false;
  }
  if (descriptorKeys.length !== keys.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    if (descriptorKeys[index] !== keys[index]) return false;
  }
  return true;
}

function validWixSystemMetadata(key, firstDescriptor, secondDescriptor) {
  if (!sameDataDescriptor(firstDescriptor, secondDescriptor) || firstDescriptor.enumerable !== true) {
    return false;
  }
  if (key === '_owner') return typeof firstDescriptor.value === 'string';
  if (key !== '_createdDate' && key !== '_updatedDate') return false;
  try {
    return !SAFE_NUMBER_IS_NAN(SAFE_DATE_GET_TIME(firstDescriptor.value));
  } catch (error) {
    return false;
  }
}

function snapshotExactPrimitiveRecord(value, fields, markedFields) {
  if (!value || typeof value !== 'object' || SAFE_ARRAY_IS_ARRAY(value)) return null;
  let prototype;
  let first;
  let second;
  let keys;
  try {
    prototype = SAFE_OBJECT_GET_PROTOTYPE_OF(value);
    first = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
    keys = SAFE_REFLECT_OWN_KEYS(value);
    second = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
  } catch (error) {
    return null;
  }
  if (markedFields && SAFE_OBJECT_HAS_OWN_PROPERTY(first, 'decisionFenceVersion')) {
    fields = markedFields;
  }
  if (!isOrdinaryRecordPrototype(prototype) || !sameOwnKeySequence(keys, first) ||
      !sameOwnKeySequence(keys, second) || keys.length < fields.length ||
      keys.length > fields.length + WIX_SYSTEM_METADATA_FIELDS.length) return null;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];
    let found = false;
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      if (fields[fieldIndex] === key) {
        found = true;
        break;
      }
    }
    if (typeof key !== 'string') return null;
    if (!found) {
      let metadata = false;
      for (let metadataIndex = 0; metadataIndex < WIX_SYSTEM_METADATA_FIELDS.length; metadataIndex += 1) {
        if (WIX_SYSTEM_METADATA_FIELDS[metadataIndex] === key) {
          metadata = true;
          break;
        }
      }
      if (!metadata || !validWixSystemMetadata(key, first[key], second[key])) return null;
    }
  }
  for (let index = 0; index < fields.length; index += 1) {
    const key = fields[index];
    if (!sameDataDescriptor(first[key], second[key]) || first[key].enumerable !== true ||
        (first[key].value !== null && typeof first[key].value === 'object') ||
        typeof first[key].value === 'function' || typeof first[key].value === 'symbol' ||
        typeof first[key].value === 'bigint') return null;
  }
  const copy = SAFE_OBJECT_CREATE(SAFE_OBJECT_PROTOTYPE);
  for (let index = 0; index < fields.length; index += 1) {
    const key = fields[index];
    SAFE_OBJECT_DEFINE_PROPERTY(copy, key, {
      value: first[key].value, writable: true, enumerable: true, configurable: true
    });
  }
  return copy;
}

function recoveryRequired(operationId) {
  const error = new SAFE_ERROR('RECOVERY_REQUIRED');
  SAFE_OBJECT_DEFINE_PROPERTIES(error, {
    code: { value: 'RECOVERY_REQUIRED', writable: true, enumerable: true, configurable: true },
    operationId: { value: operationId, writable: true, enumerable: true, configurable: true }
  });
  return error;
}

function isCanonicalNight(value) {
  if (typeof value !== 'string' || !SAFE_REGEXP_TEST(/^\d{4}-\d{2}-\d{2}$/, value)) return false;
  const date = new SAFE_DATE(value + 'T00:00:00.000Z');
  return !SAFE_NUMBER_IS_NAN(SAFE_DATE_GET_TIME(date)) &&
    SAFE_STRING_SLICE(SAFE_DATE_TO_ISO_STRING(date), 0, 10) === value;
}

function hasOnlyClaimFields(event) {
  const allowed = [
    '_id', 'protocolVersion', 'claimKey', 'eventType', 'claimType', 'generation',
    'night', 'capacitySlot', 'unit', 'operationId', 'payloadDigest', 'bookingNumber',
    'bookingRowId', 'releaseReason', 'manifestVersion', 'manifestCheckIn',
    'manifestCheckOut', 'manifestRoomCode', 'manifestUnits',
    'manifestBookingRowIds', 'manifestResourceClaimIds', 'completionState',
    'confirmedResourceCount', 'decisionFenceVersion', 'operationIdentityId',
    'operationCompletionId', 'decisionState'
  ];
  return SAFE_ARRAY_EVERY(SAFE_OBJECT_KEYS(event), function(key) {
    return SAFE_STRING_CHAR_AT(key, 0) === '_' || SAFE_ARRAY_INDEX_OF(allowed, key) !== -1;
  });
}

function decisionFenceVersion(event) {
  let descriptors;
  let prototype;
  try {
    descriptors = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(event);
    prototype = SAFE_OBJECT_GET_PROTOTYPE_OF(event);
    for (let depth = 0; prototype !== null && depth < 64; depth += 1) {
      const prototypeDescriptors = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(prototype);
      if (SAFE_OBJECT_HAS_OWN_PROPERTY(prototypeDescriptors, 'decisionFenceVersion')) {
        return { valid: false, present: false };
      }
      prototype = SAFE_OBJECT_GET_PROTOTYPE_OF(prototype);
    }
    if (prototype !== null) return { valid: false, present: false };
  } catch (error) {
    return { valid: false, present: false };
  }
  if (!SAFE_OBJECT_HAS_OWN_PROPERTY(descriptors, 'decisionFenceVersion')) {
    return { valid: true, present: false };
  }
  const descriptor = descriptors.decisionFenceVersion;
  return {
    valid: !!descriptor && SAFE_OBJECT_HAS_OWN_PROPERTY(descriptor, 'value') &&
      descriptor.enumerable === true && descriptor.value === 1 &&
      SAFE_NUMBER_IS_INTEGER(descriptor.value),
    present: true,
    value: descriptor && descriptor.value
  };
}

function isCanonicalText(value, maxLength) {
  return typeof value === 'string' && !!value && value.length <= maxLength &&
    SAFE_STRING_TRIM(value) === value && !SAFE_REGEXP_TEST(/[\u0000-\u001f\u007f]/, value);
}

function parseOperationManifest(event) {
  if (event.manifestVersion !== 1 || !isCanonicalNight(event.manifestCheckIn) ||
      !isCanonicalNight(event.manifestCheckOut) ||
      SAFE_DATE_GET_TIME(new SAFE_DATE(event.manifestCheckOut + 'T00:00:00.000Z')) <=
        SAFE_DATE_GET_TIME(new SAFE_DATE(event.manifestCheckIn + 'T00:00:00.000Z')) ||
      !isCanonicalText(event.manifestRoomCode, 128) ||
      !isCanonicalText(event.manifestUnits, 16) ||
      !isCanonicalText(event.manifestBookingRowIds, 512) ||
      !isCanonicalText(event.manifestResourceClaimIds, 60000)) {
    return null;
  }
  if (!SAFE_REGEXP_TEST(/^[1-5](,[1-5]){0,3}$/, event.manifestUnits)) return null;
  const unitTexts = SAFE_STRING_SPLIT(event.manifestUnits, ',');
  const units = SAFE_ARRAY_MAP(unitTexts, function(value) { return SAFE_NUMBER(value); });
  const rowIds = SAFE_STRING_SPLIT(event.manifestBookingRowIds, '|');
  const resourceIds = SAFE_STRING_SPLIT(event.manifestResourceClaimIds, '|');
  const allowedAssignments = {
    penthouse_apartment: ['1'],
    two_bedroom_apartment: ['2'],
    adventure_suite: ['3', '4', '3,4', '3,4,5']
  }[event.manifestRoomCode];
  if (!allowedAssignments || !units.length || units.length > 4 || rowIds.length !== units.length ||
      SAFE_ARRAY_INDEX_OF(allowedAssignments, SAFE_STRING_JOIN(units, ',')) === -1 ||
      SAFE_ARRAY_SOME(units, function(unit, index) {
        return !SAFE_NUMBER_IS_INTEGER(unit) ||
          (index > 0 && units[index - 1] >= unit);
      }) ||
      SAFE_ARRAY_SOME(rowIds, function(rowId, index) {
        return rowId !== 'pb1-' + event.operationId + '-r' + (index + 1);
      }) ||
      SAFE_ARRAY_SOME(resourceIds, function(id, index, all) {
        return SAFE_ARRAY_INDEX_OF(all, id) !== index;
      })) {
    return null;
  }
  const start = SAFE_DATE_GET_TIME(new SAFE_DATE(event.manifestCheckIn + 'T00:00:00.000Z'));
  const end = SAFE_DATE_GET_TIME(new SAFE_DATE(event.manifestCheckOut + 'T00:00:00.000Z'));
  const calendarNightCount = (end - start) / 86400000;
  const declaredNightCount = resourceIds.length / (units.length * 2);
  if (!SAFE_NUMBER_IS_INTEGER(declaredNightCount) || declaredNightCount < 1 ||
      declaredNightCount > MAX_MANIFEST_NIGHTS || calendarNightCount !== declaredNightCount) {
    return null;
  }
  const nights = [];
  for (let index = 0; index < declaredNightCount; index += 1) {
    SAFE_ARRAY_PUSH(nights,
      SAFE_STRING_SLICE(SAFE_DATE_TO_ISO_STRING(new SAFE_DATE(start + index * 86400000)), 0, 10));
  }
  let resourceIndex = 0;
  for (let nightIndex = 0; nightIndex < nights.length; nightIndex += 1) {
    const night = nights[nightIndex];
    let priorSlot = 0;
    for (let rowIndex = 0; rowIndex < units.length; rowIndex += 1) {
      const match = SAFE_REGEXP_EXEC(new SAFE_REGEXP(
        '^rc1-' + SAFE_STRING_JOIN(SAFE_STRING_SPLIT(night, '-'), '') + '-s([1-4])-(\\d{6})-a$'),
      resourceIds[resourceIndex]);
      resourceIndex += 1;
      const slot = match ? SAFE_NUMBER(match[1]) : 0;
      if (!match || !SAFE_NUMBER(match[2]) || slot <= priorSlot) return null;
      priorSlot = slot;
    }
  }
  for (let nightIndex = 0; nightIndex < nights.length; nightIndex += 1) {
    const night = nights[nightIndex];
    for (let rowIndex = 0; rowIndex < units.length; rowIndex += 1) {
      const match = SAFE_REGEXP_EXEC(new SAFE_REGEXP(
        '^rc1-' + SAFE_STRING_JOIN(SAFE_STRING_SPLIT(night, '-'), '') +
          '-u' + units[rowIndex] + '-(\\d{6})-a$'),
      resourceIds[resourceIndex]);
      resourceIndex += 1;
      if (!match || !SAFE_NUMBER(match[1])) return null;
    }
  }
  return { nights: nights, units: units, rowIds: rowIds, resourceIds: resourceIds };
}

function manifestDeclaresResource(identity, resource) {
  const manifest = isValidStoredEvent(identity) && parseOperationManifest(identity);
  if (!manifest || !resource || identity.operationId !== resource.operationId ||
      identity.bookingNumber !== resource.bookingNumber ||
      identity.payloadDigest !== resource.payloadDigest) return false;
  const index = SAFE_ARRAY_INDEX_OF(manifest.resourceIds, resource._id);
  if (index === -1) return false;
  const claimsPerType = manifest.nights.length * manifest.units.length;
  const typeIndex = index < claimsPerType ? index : index - claimsPerType;
  const night = manifest.nights[SAFE_MATH_FLOOR(typeIndex / manifest.units.length)];
  const rowIndex = typeIndex % manifest.units.length;
  if (resource.night !== night || resource.bookingRowId !== manifest.rowIds[rowIndex]) return false;
  if (index < claimsPerType) {
    const match = SAFE_REGEXP_EXEC(/-s([1-4])-(\d{6})-a$/, resource._id);
    return resource.claimType === 'capacity' && !!match &&
      resource.capacitySlot === SAFE_NUMBER(match[1]) &&
      resource.generation === SAFE_NUMBER(match[2]);
  }
  const match = SAFE_REGEXP_EXEC(/-u([1-5])-(\d{6})-a$/, resource._id);
  return resource.claimType === 'unit' && !!match &&
    resource.unit === manifest.units[rowIndex] && resource.unit === SAFE_NUMBER(match[1]) &&
    resource.generation === SAFE_NUMBER(match[2]);
}

const LOADER_OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const LOADER_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const LOADER_NIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOADER_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const LOADER_UNITS_PATTERN = /^[1-5](,[1-5]){0,3}$/;
const LOADER_CAPACITY_ID_PATTERN = /^rc1-(\d{8})-s([1-4])-(\d{6})-a$/;
const LOADER_UNIT_ID_PATTERN = /^rc1-(\d{8})-u([1-5])-(\d{6})-a$/;

function loaderCanonicalNightTime(value) {
  if (typeof value !== 'string' || !SAFE_REGEXP_TEST(LOADER_NIGHT_PATTERN, value)) return null;
  const date = new SAFE_DATE(value + 'T00:00:00.000Z');
  const time = SAFE_DATE_GET_TIME(date);
  if (SAFE_NUMBER_IS_NAN(time)) return null;
  return SAFE_STRING_SLICE(SAFE_DATE_TO_ISO_STRING(date), 0, 10) === value ? time : null;
}

function loaderCanonicalText(value, maxLength) {
  return typeof value === 'string' && !!value && value.length <= maxLength &&
    SAFE_STRING_TRIM(value) === value && !SAFE_REGEXP_TEST(LOADER_CONTROL_PATTERN, value);
}

function loaderDefineArrayValue(array, index, value) {
  SAFE_OBJECT_DEFINE_PROPERTY(array, SAFE_STRING(index), {
    value: value, writable: true, enumerable: true, configurable: true
  });
}

function loaderCompactNight(night) {
  return SAFE_STRING_SLICE(night, 0, 4) + SAFE_STRING_SLICE(night, 5, 7) +
    SAFE_STRING_SLICE(night, 8, 10);
}

function loaderParseManifest(event) {
  const start = loaderCanonicalNightTime(event.manifestCheckIn);
  const end = loaderCanonicalNightTime(event.manifestCheckOut);
  if (event.manifestVersion !== 1 || start === null || end === null || end <= start ||
      !loaderCanonicalText(event.manifestRoomCode, 128) ||
      !loaderCanonicalText(event.manifestUnits, 16) ||
      !loaderCanonicalText(event.manifestBookingRowIds, 512) ||
      !loaderCanonicalText(event.manifestResourceClaimIds, 60000) ||
      !SAFE_REGEXP_TEST(LOADER_UNITS_PATTERN, event.manifestUnits)) return null;

  const unitTexts = SAFE_STRING_SPLIT(event.manifestUnits, ',');
  const rowIds = SAFE_STRING_SPLIT(event.manifestBookingRowIds, '|');
  const resourceIds = SAFE_STRING_SPLIT(event.manifestResourceClaimIds, '|');
  if (unitTexts.length < 1 || unitTexts.length > 4 || rowIds.length !== unitTexts.length) return null;
  const assignment = event.manifestRoomCode + ':' + event.manifestUnits;
  if (assignment !== 'penthouse_apartment:1' && assignment !== 'two_bedroom_apartment:2' &&
      assignment !== 'adventure_suite:3' && assignment !== 'adventure_suite:4' &&
      assignment !== 'adventure_suite:3,4' && assignment !== 'adventure_suite:3,4,5') return null;

  const units = new SAFE_ARRAY(unitTexts.length);
  for (let index = 0; index < unitTexts.length; index += 1) {
    const unit = SAFE_NUMBER(unitTexts[index]);
    if (!SAFE_NUMBER_IS_INTEGER(unit) || (index > 0 && units[index - 1] >= unit) ||
        rowIds[index] !== 'pb1-' + event.operationId + '-r' + (index + 1)) return null;
    loaderDefineArrayValue(units, index, unit);
  }
  for (let left = 0; left < resourceIds.length; left += 1) {
    for (let right = left + 1; right < resourceIds.length; right += 1) {
      if (resourceIds[left] === resourceIds[right]) return null;
    }
  }

  const calendarNightCount = (end - start) / 86400000;
  const declaredNightCount = resourceIds.length / (units.length * 2);
  if (!SAFE_NUMBER_IS_INTEGER(declaredNightCount) || declaredNightCount < 1 ||
      declaredNightCount > MAX_MANIFEST_NIGHTS || calendarNightCount !== declaredNightCount) return null;

  const nights = new SAFE_ARRAY(declaredNightCount);
  for (let index = 0; index < declaredNightCount; index += 1) {
    const date = new SAFE_DATE(start + index * 86400000);
    loaderDefineArrayValue(nights, index,
      SAFE_STRING_SLICE(SAFE_DATE_TO_ISO_STRING(date), 0, 10));
  }

  let resourceIndex = 0;
  for (let nightIndex = 0; nightIndex < nights.length; nightIndex += 1) {
    const compactNight = loaderCompactNight(nights[nightIndex]);
    let priorSlot = 0;
    for (let rowIndex = 0; rowIndex < units.length; rowIndex += 1) {
      const match = SAFE_REGEXP_EXEC(LOADER_CAPACITY_ID_PATTERN, resourceIds[resourceIndex]);
      resourceIndex += 1;
      const slot = match ? SAFE_NUMBER(match[2]) : 0;
      if (!match || match[1] !== compactNight || !SAFE_NUMBER(match[3]) || slot <= priorSlot) return null;
      priorSlot = slot;
    }
  }
  for (let nightIndex = 0; nightIndex < nights.length; nightIndex += 1) {
    const compactNight = loaderCompactNight(nights[nightIndex]);
    for (let rowIndex = 0; rowIndex < units.length; rowIndex += 1) {
      const match = SAFE_REGEXP_EXEC(LOADER_UNIT_ID_PATTERN, resourceIds[resourceIndex]);
      resourceIndex += 1;
      if (!match || match[1] !== compactNight || SAFE_NUMBER(match[2]) !== units[rowIndex] ||
          !SAFE_NUMBER(match[3])) return null;
    }
  }
  const manifest = SAFE_OBJECT_CREATE(SAFE_OBJECT_PROTOTYPE);
  SAFE_OBJECT_DEFINE_PROPERTIES(manifest, {
    nights: { value: nights, writable: true, enumerable: true, configurable: true },
    units: { value: units, writable: true, enumerable: true, configurable: true },
    rowIds: { value: rowIds, writable: true, enumerable: true, configurable: true },
    resourceIds: { value: resourceIds, writable: true, enumerable: true, configurable: true }
  });
  return manifest;
}

function loaderValidIdentity(identity, operationId) {
  const fenceVersion = identity && decisionFenceVersion(identity);
  return !!identity && fenceVersion.valid && identity.protocolVersion === 1 && identity.generation === 1 &&
    identity.eventType === 'acquire' && identity.claimType === 'operation' &&
    identity.operationId === operationId && identity._id === 'rc1-op-' + operationId + '-a' &&
    identity.claimKey === 'operation:' + operationId &&
    identity.bookingRowId === 'pb1-' + operationId + '-r1' &&
    loaderCanonicalText(identity.bookingNumber, 128) &&
    SAFE_REGEXP_TEST(LOADER_DIGEST_PATTERN, identity.payloadDigest);
}

function loaderValidAcquisition(identity, manifest, acquisition, index) {
  if (!acquisition || acquisition.protocolVersion !== 1 ||
      !SAFE_NUMBER_IS_INTEGER(acquisition.generation) || acquisition.generation < 1 ||
      acquisition.generation > 999999 || acquisition.eventType !== 'acquire' ||
      acquisition.operationId !== identity.operationId ||
      acquisition.bookingNumber !== identity.bookingNumber ||
      acquisition.payloadDigest !== identity.payloadDigest ||
      !loaderCanonicalText(acquisition.bookingNumber, 128) ||
      !SAFE_REGEXP_TEST(LOADER_DIGEST_PATTERN, acquisition.payloadDigest) ||
      loaderCanonicalNightTime(acquisition.night) === null ||
      acquisition._id !== manifest.resourceIds[index]) return false;

  const claimsPerType = manifest.nights.length * manifest.units.length;
  const typeIndex = index < claimsPerType ? index : index - claimsPerType;
  const rowIndex = typeIndex % manifest.units.length;
  const nightIndex = (typeIndex - rowIndex) / manifest.units.length;
  if (acquisition.night !== manifest.nights[nightIndex] ||
      acquisition.bookingRowId !== manifest.rowIds[rowIndex]) return false;

  const compactNight = loaderCompactNight(acquisition.night);
  if (index < claimsPerType) {
    const match = SAFE_REGEXP_EXEC(LOADER_CAPACITY_ID_PATTERN, acquisition._id);
    return acquisition.claimType === 'capacity' && !!match && match[1] === compactNight &&
      acquisition.capacitySlot === SAFE_NUMBER(match[2]) &&
      acquisition.generation === SAFE_NUMBER(match[3]) &&
      acquisition.claimKey === 'capacity:' + acquisition.night + ':' + acquisition.capacitySlot;
  }
  const match = SAFE_REGEXP_EXEC(LOADER_UNIT_ID_PATTERN, acquisition._id);
  return acquisition.claimType === 'unit' && !!match && match[1] === compactNight &&
    acquisition.unit === manifest.units[rowIndex] && acquisition.unit === SAFE_NUMBER(match[2]) &&
    acquisition.generation === SAFE_NUMBER(match[3]) &&
    acquisition.claimKey === 'unit:' + acquisition.night + ':' + acquisition.unit;
}

function loaderValidCompletion(completion, identity, resourceCount) {
  const completionFence = completion && decisionFenceVersion(completion);
  const identityFence = identity && decisionFenceVersion(identity);
  return !!completion && completionFence.valid && identityFence.valid &&
    completionFence.present === identityFence.present &&
    completionFence.value === identityFence.value &&
    completion.protocolVersion === 1 && completion.generation === 1 &&
    completion.eventType === 'complete' && completion.claimType === 'operation-completion' &&
    completion.operationId === identity.operationId &&
    completion._id === 'rc1-op-' + identity.operationId + '-c' &&
    completion.claimKey === 'operation:' + identity.operationId + ':completion' &&
    completion.bookingRowId === identity.bookingRowId &&
    completion.bookingNumber === identity.bookingNumber &&
    completion.payloadDigest === identity.payloadDigest && completion.completionState === 'complete' &&
    completion.confirmedResourceCount === resourceCount;
}

function loaderReadOptions() {
  const options = SAFE_OBJECT_CREATE(SAFE_OBJECT_PROTOTYPE);
  SAFE_OBJECT_DEFINE_PROPERTIES(options, {
    suppressAuth: { value: true, writable: false, enumerable: true, configurable: false },
    consistentRead: { value: true, writable: false, enumerable: true, configurable: false },
    suppressHooks: { value: true, writable: false, enumerable: true, configurable: false }
  });
  return options;
}

// Deterministic order is identity, every manifest acquisition, every matching
// release fence, then terminal completion. Any uncertainty has one outcome.
export async function loadCompletedRoomClaimSet(operationId) {
  if (typeof operationId !== 'string' || !SAFE_REGEXP_TEST(LOADER_OPERATION_ID_PATTERN, operationId)) {
    throw recoveryRequired(operationId);
  }
  const readOwner = wixData;
  const readFunction = readOwner && readOwner.get;
  if (typeof readFunction !== 'function') throw recoveryRequired(operationId);
  const read = function(id) {
    return SAFE_REFLECT_APPLY(readFunction, readOwner, [CLAIM_COLLECTION, id, loaderReadOptions()]);
  };
  try {
    const identityId = 'rc1-op-' + operationId + '-a';
    const storedIdentity = await read(identityId);
    const identity = snapshotExactPrimitiveRecord(
      storedIdentity, IDENTITY_EVIDENCE_FIELDS, MARKED_IDENTITY_EVIDENCE_FIELDS);
    if (!loaderValidIdentity(identity, operationId) || identity.decisionFenceVersion !== undefined) {
      throw recoveryRequired(operationId);
    }
    const manifest = loaderParseManifest(identity);
    if (!manifest) throw recoveryRequired(operationId);

    const acquisitions = new SAFE_ARRAY(manifest.resourceIds.length);
    for (let index = 0; index < manifest.resourceIds.length; index += 1) {
      const acquisitionId = manifest.resourceIds[index];
      const stored = await read(acquisitionId);
      const acquisition = snapshotExactPrimitiveRecord(stored, CAPACITY_EVIDENCE_FIELDS) ||
        snapshotExactPrimitiveRecord(stored, UNIT_EVIDENCE_FIELDS);
      if (!loaderValidAcquisition(identity, manifest, acquisition, index)) {
        throw recoveryRequired(operationId);
      }
      loaderDefineArrayValue(acquisitions, index, acquisition);
    }

    for (let index = 0; index < acquisitions.length; index += 1) {
      const releaseId = SAFE_STRING_SLICE(acquisitions[index]._id, 0, -1) + 'r';
      const release = await read(releaseId);
      if (release !== null && release !== undefined) throw recoveryRequired(operationId);
    }

    const completionId = 'rc1-op-' + operationId + '-c';
    const storedCompletion = await read(completionId);
    const completion = snapshotExactPrimitiveRecord(
      storedCompletion, COMPLETION_EVIDENCE_FIELDS, MARKED_COMPLETION_EVIDENCE_FIELDS);
    if (!loaderValidCompletion(completion, identity, manifest.resourceIds.length)) {
      throw recoveryRequired(operationId);
    }
    const evidence = SAFE_OBJECT_CREATE(SAFE_OBJECT_PROTOTYPE);
    SAFE_OBJECT_DEFINE_PROPERTIES(evidence, {
      identity: { value: identity, writable: true, enumerable: true, configurable: true },
      acquisitions: { value: acquisitions, writable: true, enumerable: true, configurable: true },
      completion: { value: completion, writable: true, enumerable: true, configurable: true }
    });
    return evidence;
  } catch (error) {
    throw recoveryRequired(operationId);
  }
}

function hasValidManifestPrefix(events, identity) {
  const manifest = isValidStoredEvent(identity) && parseOperationManifest(identity);
  if (!manifest || !SAFE_ARRAY_IS_ARRAY(events)) return false;
  const acquisitions = SAFE_ARRAY_FILTER(events, function(event) {
    return event && event.eventType === 'acquire' && event.claimType !== 'operation' &&
      event.operationId === identity.operationId;
  });
  if (acquisitions.length > manifest.resourceIds.length ||
      SAFE_ARRAY_SOME(acquisitions, function(event) {
        return !isValidStoredEvent(event) || !manifestDeclaresResource(identity, event);
      })) return false;
  const actualIds = new SAFE_SET(SAFE_ARRAY_MAP(acquisitions, function(event) { return event._id; }));
  const expectedPrefix = SAFE_ARRAY_SLICE(manifest.resourceIds, 0, acquisitions.length);
  return actualIds.size === acquisitions.length &&
    SAFE_ARRAY_EVERY(expectedPrefix, function(id) { return SAFE_SET_HAS(actualIds, id); });
}

function hasCompletedManifestHistory(events, identity) {
  const manifest = isValidStoredEvent(identity) && parseOperationManifest(identity);
  if (!manifest || !hasValidManifestPrefix(events, identity)) return false;
  const acquisitions = SAFE_ARRAY_FILTER(events, function(event) {
    return event && event.eventType === 'acquire' && event.claimType !== 'operation' &&
      event.operationId === identity.operationId;
  });
  const completions = SAFE_ARRAY_FILTER(events, function(event) {
    return event && event.claimType === 'operation-completion' &&
      event.operationId === identity.operationId;
  });
  const byId = SAFE_OBJECT_CREATE(null);
  SAFE_ARRAY_FOR_EACH(acquisitions, function(event) { byId[event._id] = event; });
  if (completions.length !== 1 ||
      !matchesOperationCompletion(completions[0], identity, byId)) return false;
  const identityFence = decisionFenceVersion(identity);
  if (!identityFence.valid) return false;
  if (!identityFence.present) return true;
  const decisions = SAFE_ARRAY_FILTER(events, function(event) {
    return event && event.claimType === 'operation-decision' &&
      event.operationId === identity.operationId;
  });
  return decisions.length === 1 && exactDecisionState(
    decisions[0], operationDecisionEvent(identity, completions[0], 'compensate')) === 'MATCH';
}

async function loadAuthoritativeManifestPrefix(identity, readEvent) {
  const manifest = isValidStoredEvent(identity) && parseOperationManifest(identity);
  if (!manifest) return { state: 'INTEGRITY', acquisitions: SAFE_OBJECT_CREATE(null) };
  const acquisitions = SAFE_OBJECT_CREATE(null);
  let foundMissing = false;
  for (let eventIndex = 0; eventIndex < manifest.resourceIds.length; eventIndex += 1) {
    const eventId = manifest.resourceIds[eventIndex];
    let stored;
    try {
      stored = await readEvent(eventId);
    } catch (error) {
      return { state: 'UNRESOLVED', acquisitions: acquisitions };
    }
    if (!stored) {
      foundMissing = true;
      continue;
    }
    if (isValidStoredEvent(stored) && stored._id === eventId &&
        stored.eventType === 'acquire' && stored.operationId !== identity.operationId) {
      foundMissing = true;
      continue;
    }
    if (foundMissing || !isValidStoredEvent(stored) ||
        !manifestDeclaresResource(identity, stored)) {
      return { state: 'INTEGRITY', acquisitions: acquisitions };
    }
    acquisitions[eventId] = stored;
  }
  return { state: 'CONFIRMED', acquisitions: acquisitions };
}

async function validateReverseRelease(identity, acquisitions, acquireId, readEvent) {
  const manifest = parseOperationManifest(identity);
  if (!manifest) return 'INTEGRITY';
  const acquiredIds = SAFE_ARRAY_FILTER(manifest.resourceIds, function(id) {
    return SAFE_OBJECT_HAS_OWN_PROPERTY(acquisitions, id);
  });
  const targetIndex = SAFE_ARRAY_INDEX_OF(acquiredIds, acquireId);
  if (targetIndex === -1) return 'INTEGRITY';
  for (let index = acquiredIds.length - 1; index > targetIndex; index -= 1) {
    const laterAcquire = acquisitions[acquiredIds[index]];
    const releaseId = SAFE_STRING_SLICE(laterAcquire._id, 0, -1) + 'r';
    let storedRelease;
    try {
      storedRelease = await readEvent(releaseId);
    } catch (error) {
      return 'UNRESOLVED';
    }
    const expectedRelease = SAFE_OBJECT_ASSIGN({}, laterAcquire, {
      _id: releaseId,
      eventType: 'release',
      releaseReason: storedRelease && storedRelease.releaseReason
    });
    if (!isValidStoredEvent(storedRelease) ||
        !matchesEvent(storedRelease, expectedRelease)) return 'INTEGRITY';
  }
  return 'CONFIRMED';
}

function isValidStoredEvent(event) {
  if (!event || typeof event !== 'object' || SAFE_ARRAY_IS_ARRAY(event) ||
      !hasOnlyClaimFields(event) ||
      event.protocolVersion !== 1 ||
      !SAFE_NUMBER_IS_INTEGER(event.generation) || event.generation < 1 || event.generation > 999999 ||
      (event.eventType !== 'acquire' && event.eventType !== 'release' &&
       event.eventType !== 'complete' && event.eventType !== 'decide') ||
      !SAFE_REGEXP_TEST(/^[A-Za-z0-9_-]{16,64}$/, event.operationId || '') ||
      !isCanonicalText(event.bookingNumber, 128) ||
      !SAFE_REGEXP_TEST(/^[0-9a-f]{64}$/, event.payloadDigest || '')) {
    return false;
  }
  const expectedRowPrefix = 'pb1-' + event.operationId + '-r';
  const validBookingRowId = typeof event.bookingRowId === 'string' &&
    SAFE_STRING_INDEX_OF(event.bookingRowId, expectedRowPrefix) === 0 &&
    SAFE_REGEXP_TEST(/^[1-9]\d*$/, SAFE_STRING_SLICE(event.bookingRowId, expectedRowPrefix.length));
  if (!validBookingRowId) return false;
  if (event.claimType === 'operation-decision') {
    return event.eventType === 'decide' && event.generation === 1 &&
      event._id === 'rc1-op-' + event.operationId + '-d' &&
      event.claimKey === 'operation:' + event.operationId + ':decision' &&
      event.bookingRowId === expectedRowPrefix + '1' &&
      event.decisionFenceVersion === 1 &&
      event.operationIdentityId === 'rc1-op-' + event.operationId + '-a' &&
      event.operationCompletionId === 'rc1-op-' + event.operationId + '-c' &&
      event.manifestVersion === 1 &&
      (event.completionState === 'complete' || event.completionState === 'stopped') &&
      SAFE_NUMBER_IS_INTEGER(event.confirmedResourceCount) &&
      event.confirmedResourceCount >= 0 && event.confirmedResourceCount <= 6400 &&
      (event.decisionState === 'commit-rows' || event.decisionState === 'compensate') &&
      event.night === undefined && event.capacitySlot === undefined && event.unit === undefined &&
      event.releaseReason === undefined && event.manifestCheckIn === undefined &&
      event.manifestCheckOut === undefined && event.manifestRoomCode === undefined &&
      event.manifestUnits === undefined && event.manifestBookingRowIds === undefined &&
      event.manifestResourceClaimIds === undefined;
  }
  if (event.claimType === 'operation-completion') {
    const fenceVersion = decisionFenceVersion(event);
    return event.eventType === 'complete' && event.generation === 1 &&
      event._id === 'rc1-op-' + event.operationId + '-c' &&
      event.claimKey === 'operation:' + event.operationId + ':completion' &&
      event.bookingRowId === expectedRowPrefix + '1' &&
      event.night === undefined && event.capacitySlot === undefined && event.unit === undefined &&
      event.releaseReason === undefined &&
      (event.completionState === 'complete' || event.completionState === 'stopped') &&
      SAFE_NUMBER_IS_INTEGER(event.confirmedResourceCount) &&
      event.confirmedResourceCount >= 0 && event.confirmedResourceCount <= 6400 &&
      fenceVersion.valid &&
      event.manifestVersion === undefined &&
      event.manifestCheckIn === undefined && event.manifestCheckOut === undefined &&
      event.manifestRoomCode === undefined && event.manifestUnits === undefined &&
      event.manifestBookingRowIds === undefined && event.manifestResourceClaimIds === undefined;
  }
  if (event.claimType === 'operation') {
    const fenceVersion = decisionFenceVersion(event);
    return event.eventType === 'acquire' && event.generation === 1 &&
      event._id === 'rc1-op-' + event.operationId + '-a' &&
      event.claimKey === 'operation:' + event.operationId &&
      event.bookingRowId === expectedRowPrefix + '1' &&
      event.night === undefined && event.capacitySlot === undefined && event.unit === undefined &&
      event.releaseReason === undefined && event.completionState === undefined &&
      event.confirmedResourceCount === undefined && fenceVersion.valid && !!parseOperationManifest(event);
  }
  const resourceFenceVersion = decisionFenceVersion(event);
  if (!resourceFenceVersion.valid || resourceFenceVersion.present || SAFE_ARRAY_SOME([
    'manifestVersion', 'manifestCheckIn', 'manifestCheckOut', 'manifestRoomCode',
    'manifestUnits', 'manifestBookingRowIds', 'manifestResourceClaimIds',
    'completionState', 'confirmedResourceCount', 'decisionFenceVersion',
    'operationIdentityId', 'operationCompletionId', 'decisionState'
  ], function(key) { return SAFE_OBJECT_HAS_OWN_PROPERTY(event, key); })) return false;
  if (!isCanonicalNight(event.night)) return false;
  const validReleaseReason = event.eventType === 'release'
    ? isCanonicalText(event.releaseReason, 256)
    : event.releaseReason === undefined;
  if (!validReleaseReason) return false;
  const capacityClaim = event.claimType === 'capacity' &&
    SAFE_NUMBER_IS_INTEGER(event.capacitySlot) && event.capacitySlot >= 1 && event.capacitySlot <= 4 &&
    event.unit === undefined &&
    event.claimKey === 'capacity:' + event.night + ':' + event.capacitySlot;
  const unitClaim = event.claimType === 'unit' &&
    SAFE_NUMBER_IS_INTEGER(event.unit) && event.unit >= 1 && event.unit <= 5 &&
    event.capacitySlot === undefined &&
    event.claimKey === 'unit:' + event.night + ':' + event.unit;
  if (!capacityClaim && !unitClaim) return false;
  const claimNumber = capacityClaim ? event.capacitySlot : event.unit;
  const marker = capacityClaim ? 's' : 'u';
  const expectedId = 'rc1-' + SAFE_STRING_JOIN(SAFE_STRING_SPLIT(event.night, '-'), '') +
    '-' + marker + claimNumber + '-' +
    SAFE_STRING_PAD_START(SAFE_STRING(event.generation), 6, '0') + '-' +
    (event.eventType === 'acquire' ? 'a' : 'r');
  return event._id === expectedId;
}

function operationCompletionEvent(identity, completionState, confirmedResourceCount) {
  const manifest = parseOperationManifest(identity);
  const state = completionState || 'complete';
  const count = confirmedResourceCount === undefined
    ? (manifest ? manifest.resourceIds.length : -1)
    : confirmedResourceCount;
  const event = {
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
    completionState: state,
    confirmedResourceCount: count
  };
  const fenceVersion = decisionFenceVersion(identity);
  if (fenceVersion.valid && fenceVersion.present) event.decisionFenceVersion = fenceVersion.value;
  return event;
}

function matchesOperationCompletion(stored, identity, acquisitions) {
  const manifest = isValidStoredEvent(identity) && parseOperationManifest(identity);
  if (!manifest || !isValidStoredEvent(stored) ||
      stored.claimType !== 'operation-completion') return false;
  const count = SAFE_OBJECT_KEYS(acquisitions || {}).length;
  const expected = SAFE_OBJECT_ASSIGN({}, operationCompletionEvent(identity), {
    completionState: stored.completionState,
    confirmedResourceCount: stored.confirmedResourceCount
  });
  return matchesEvent(stored, expected) && stored.confirmedResourceCount === count &&
    ((stored.completionState === 'complete' && count === manifest.resourceIds.length) ||
     (stored.completionState === 'stopped' && count < manifest.resourceIds.length));
}

async function confirmOperationCompletion(identity, completionState, confirmedResourceCount,
    insertEvent, readEvent) {
  const expected = operationCompletionEvent(identity, completionState, confirmedResourceCount);
  let insertResolved = false;
  try {
    await insertEvent(expected);
    insertResolved = true;
  } catch (error) {
    // Reconcile deterministic completion-fence collisions authoritatively.
  }
  let stored;
  try {
    stored = await readEvent(expected._id);
  } catch (error) {
    return { state: 'UNRESOLVED', event: expected };
  }
  if (!isValidStoredEvent(stored) || !matchesEvent(stored, expected)) {
    return { state: classifyStoredMismatch(stored, expected), event: expected };
  }
  return {
    state: 'CONFIRMED',
    event: expected,
    disposition: insertResolved ? 'inserted' : 'already-present'
  };
}

function classifyStoredMismatch(stored, expected) {
  if (stored === null || stored === undefined) return 'UNRESOLVED';
  if (!isValidStoredEvent(stored)) return 'INTEGRITY';
  if (stored.operationId === expected.operationId &&
      (stored.payloadDigest !== expected.payloadDigest ||
       stored.bookingNumber !== expected.bookingNumber)) {
    return 'IDEMPOTENCY_CONFLICT';
  }
  if (stored.eventType === 'acquire' && expected.eventType === 'acquire' &&
      stored.operationId !== expected.operationId) {
    return 'CONTENTION';
  }
  return 'INTEGRITY';
}

function decisionReadOptions() {
  return SAFE_OBJECT_FREEZE({
    suppressAuth: true, consistentRead: true, suppressHooks: true
  });
}

function decisionWriteOptions() {
  return SAFE_OBJECT_FREEZE({ suppressAuth: true, suppressHooks: true });
}

function decisionStopped(eventId, classification) {
  return {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: eventId, classification: classification }
  };
}

function exactOwnDataDescriptors(value, keys) {
  if (!value || typeof value !== 'object' || SAFE_ARRAY_IS_ARRAY(value)) return null;
  let prototype;
  let first;
  let second;
  let ownKeys;
  try {
    prototype = SAFE_OBJECT_GET_PROTOTYPE_OF(value);
    first = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
    ownKeys = SAFE_REFLECT_OWN_KEYS(value);
    second = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
  } catch (error) {
    return null;
  }
  if (!isOrdinaryRecordPrototype(prototype) || ownKeys.length !== keys.length ||
      !sameOwnKeySequence(ownKeys, first) || !sameOwnKeySequence(ownKeys, second)) return null;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (ownKeys[index] !== key || !sameDataDescriptor(first[key], second[key]) ||
        first[key].enumerable !== true) return null;
  }
  return first;
}

function exactSingleDecisionConfirmation(value, eventId) {
  const result = exactOwnDataDescriptors(value, ['state', 'confirmed']);
  if (!result || result.state.value !== 'CONFIRMED') return false;
  const confirmed = result.confirmed.value;
  let descriptors;
  let keys;
  try {
    if (!SAFE_ARRAY_IS_ARRAY(confirmed)) return false;
    descriptors = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(confirmed);
    keys = SAFE_REFLECT_OWN_KEYS(confirmed);
  } catch (error) {
    return false;
  }
  if (keys.length !== 2 || keys[0] !== '0' || keys[1] !== 'length' ||
      !descriptors.length || descriptors.length.value !== 1 ||
      !SAFE_OBJECT_HAS_OWN_PROPERTY(descriptors[0], 'value')) return false;
  const item = snapshotExactPrimitiveRecord(descriptors[0].value, ['eventId', 'disposition']);
  return !!item && item.eventId === eventId &&
    (item.disposition === 'inserted' || item.disposition === 'already-present');
}

function exactDecisionFailureClassification(value, eventId) {
  const result = exactOwnDataDescriptors(value, ['state', 'confirmed', 'failed']);
  if (!result || result.state.value !== 'STOPPED') return null;
  const confirmed = result.confirmed.value;
  let confirmedKeys;
  let confirmedLength;
  try {
    if (!SAFE_ARRAY_IS_ARRAY(confirmed)) return null;
    confirmedKeys = SAFE_REFLECT_OWN_KEYS(confirmed);
    confirmedLength = SAFE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(confirmed).length;
  } catch (error) {
    return null;
  }
  if (confirmedKeys.length !== 1 || confirmedKeys[0] !== 'length' ||
      !confirmedLength || confirmedLength.value !== 0) return null;
  const failed = snapshotExactPrimitiveRecord(
    result.failed.value, ['index', 'eventId', 'classification']);
  if (!failed || failed.index !== 0 || failed.eventId !== eventId ||
      SAFE_ARRAY_INDEX_OF([
        'DECISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INTEGRITY', 'LEGACY_UNFENCED',
        'UNRESOLVED'
      ], failed.classification) === -1) return null;
  return failed.classification;
}

function operationDecisionEvent(identity, completion, decisionState) {
  return SAFE_OBJECT_FREEZE({
    _id: 'rc1-op-' + identity.operationId + '-d',
    protocolVersion: 1,
    claimKey: 'operation:' + identity.operationId + ':decision',
    generation: 1,
    eventType: 'decide',
    claimType: 'operation-decision',
    operationId: identity.operationId,
    bookingRowId: identity.bookingRowId,
    bookingNumber: identity.bookingNumber,
    payloadDigest: identity.payloadDigest,
    decisionFenceVersion: 1,
    operationIdentityId: identity._id,
    operationCompletionId: completion._id,
    manifestVersion: 1,
    completionState: completion.completionState,
    confirmedResourceCount: completion.confirmedResourceCount,
    decisionState: decisionState
  });
}

function decisionMatches(stored, expected, alternateState) {
  for (let index = 0; index < DECISION_EVIDENCE_FIELDS.length; index += 1) {
    const key = DECISION_EVIDENCE_FIELDS[index];
    const expectedValue = key === 'decisionState' && alternateState !== undefined
      ? alternateState : expected[key];
    if (stored[key] !== expectedValue) return false;
  }
  return true;
}

function validDecisionRecord(stored) {
  return stored.protocolVersion === 1 && stored.generation === 1 &&
    stored.eventType === 'decide' && stored.claimType === 'operation-decision' &&
    SAFE_REGEXP_TEST(LOADER_OPERATION_ID_PATTERN, stored.operationId) &&
    stored._id === 'rc1-op-' + stored.operationId + '-d' &&
    stored.claimKey === 'operation:' + stored.operationId + ':decision' &&
    stored.bookingRowId === 'pb1-' + stored.operationId + '-r1' &&
    loaderCanonicalText(stored.bookingNumber, 128) &&
    SAFE_REGEXP_TEST(LOADER_DIGEST_PATTERN, stored.payloadDigest) &&
    stored.decisionFenceVersion === 1 &&
    stored.operationIdentityId === 'rc1-op-' + stored.operationId + '-a' &&
    stored.operationCompletionId === 'rc1-op-' + stored.operationId + '-c' &&
    stored.manifestVersion === 1 &&
    (stored.completionState === 'complete' || stored.completionState === 'stopped') &&
    SAFE_NUMBER_IS_INTEGER(stored.confirmedResourceCount) &&
    stored.confirmedResourceCount >= 0 && stored.confirmedResourceCount <= 6400 &&
    (stored.decisionState === 'commit-rows' || stored.decisionState === 'compensate');
}

function exactDecisionState(storedValue, expected) {
  const stored = snapshotExactPrimitiveRecord(storedValue, DECISION_EVIDENCE_FIELDS);
  if (!stored) return 'INTEGRITY';
  if (stored.operationId === expected.operationId &&
      (stored.bookingNumber !== expected.bookingNumber ||
       stored.payloadDigest !== expected.payloadDigest)) return 'IDEMPOTENCY_CONFLICT';
  if (!validDecisionRecord(stored)) return 'INTEGRITY';
  if (decisionMatches(stored, expected)) return 'MATCH';
  const opposite = expected.decisionState === 'commit-rows' ? 'compensate' : 'commit-rows';
  if (decisionMatches(stored, expected, opposite)) return 'DECISION_CONFLICT';
  return 'INTEGRITY';
}

// Disconnected single-winner decision fence. Every binding is reconstructed
// from exact authoritative identity, manifest, acquisition, and completion evidence.
export async function appendRoomOperationDecision(operationId, decisionState) {
  const eventId = typeof operationId === 'string' ? 'rc1-op-' + operationId + '-d' : 'rc1-op-invalid-d';
  if (typeof operationId !== 'string' || !SAFE_REGEXP_TEST(LOADER_OPERATION_ID_PATTERN, operationId) ||
      (decisionState !== 'commit-rows' && decisionState !== 'compensate')) {
    return decisionStopped(eventId, 'INTEGRITY');
  }

  // Capture the owner, both I/O functions, and all transitive call machinery
  // before the first await so live global replacement cannot redirect a run.
  const owner = wixData;
  const getFunction = owner && owner.get;
  const insertFunction = owner && owner.insert;
  if (typeof getFunction !== 'function' || typeof insertFunction !== 'function') {
    return decisionStopped(eventId, 'UNRESOLVED');
  }
  const read = function(id) {
    let result;
    try {
      result = SAFE_REFLECT_APPLY(getFunction, owner,
        [CLAIM_COLLECTION, id, decisionReadOptions()]);
    } catch (error) {
      return SAFE_PROMISE_RESOLVE({ ok: false });
    }
    return SAFE_REFLECT_APPLY(SAFE_PROMISE_THEN, SAFE_PROMISE_RESOLVE(result), [
      function(value) { return { ok: true, value: value }; },
      function() { return { ok: false }; }
    ]);
  };

  const identityRead = await read('rc1-op-' + operationId + '-a');
  if (!identityRead.ok) return decisionStopped(eventId, 'UNRESOLVED');
  const identity = snapshotExactPrimitiveRecord(
    identityRead.value, IDENTITY_EVIDENCE_FIELDS, MARKED_IDENTITY_EVIDENCE_FIELDS);
  if (!identity) return decisionStopped(eventId, 'INTEGRITY');
  const identityFence = decisionFenceVersion(identity);
  if (identityFence.valid && !identityFence.present) {
    return decisionStopped(eventId, 'LEGACY_UNFENCED');
  }
  if (!loaderValidIdentity(identity, operationId) || identityFence.value !== 1) {
    return decisionStopped(eventId, 'INTEGRITY');
  }
  const manifest = loaderParseManifest(identity);
  if (!manifest) return decisionStopped(eventId, 'INTEGRITY');

  const acquisitions = new SAFE_ARRAY(manifest.resourceIds.length);
  let prefixCount = 0;
  let missingSeen = false;
  for (let index = 0; index < manifest.resourceIds.length; index += 1) {
    const acquisitionRead = await read(manifest.resourceIds[index]);
    if (!acquisitionRead.ok) return decisionStopped(eventId, 'UNRESOLVED');
    if (acquisitionRead.value === null || acquisitionRead.value === undefined) {
      missingSeen = true;
      continue;
    }
    const acquisition = snapshotExactPrimitiveRecord(acquisitionRead.value, CAPACITY_EVIDENCE_FIELDS) ||
      snapshotExactPrimitiveRecord(acquisitionRead.value, UNIT_EVIDENCE_FIELDS);
    if (acquisition && isValidStoredEvent(acquisition) &&
        acquisition._id === manifest.resourceIds[index] &&
        acquisition.eventType === 'acquire' && acquisition.operationId !== identity.operationId) {
      missingSeen = true;
      continue;
    }
    if (missingSeen || !loaderValidAcquisition(identity, manifest, acquisition, index)) {
      return decisionStopped(eventId, 'INTEGRITY');
    }
    loaderDefineArrayValue(acquisitions, prefixCount, acquisition);
    prefixCount += 1;
  }

  const completionRead = await read('rc1-op-' + operationId + '-c');
  if (!completionRead.ok) return decisionStopped(eventId, 'UNRESOLVED');
  const completion = snapshotExactPrimitiveRecord(
    completionRead.value, COMPLETION_EVIDENCE_FIELDS, MARKED_COMPLETION_EVIDENCE_FIELDS);
  if (!completion) return decisionStopped(eventId, 'INTEGRITY');
  const completionFence = decisionFenceVersion(completion);
  if (completionFence.valid && !completionFence.present) {
    return decisionStopped(eventId, 'LEGACY_UNFENCED');
  }
  if (completion.protocolVersion !== 1 || completion.generation !== 1 ||
      completion.eventType !== 'complete' || completion.claimType !== 'operation-completion' ||
      completion._id !== 'rc1-op-' + operationId + '-c' ||
      completion.claimKey !== 'operation:' + operationId + ':completion' ||
      completionFence.value !== 1 || completion.operationId !== identity.operationId ||
      completion.bookingRowId !== identity.bookingRowId ||
      completion.bookingNumber !== identity.bookingNumber ||
      completion.payloadDigest !== identity.payloadDigest ||
      (completion.completionState !== 'complete' && completion.completionState !== 'stopped') ||
      !SAFE_NUMBER_IS_INTEGER(completion.confirmedResourceCount) ||
      completion.confirmedResourceCount !== prefixCount ||
      (completion.completionState === 'complete' && prefixCount !== manifest.resourceIds.length) ||
      (completion.completionState === 'stopped' && prefixCount >= manifest.resourceIds.length) ||
      (decisionState === 'commit-rows' && completion.completionState !== 'complete')) {
    return decisionStopped(eventId, 'INTEGRITY');
  }

  const expected = operationDecisionEvent(identity, completion, decisionState);
  const existingRead = await read(eventId);
  if (!existingRead.ok) return decisionStopped(eventId, 'UNRESOLVED');
  let existingState = null;
  if (existingRead.value !== null && existingRead.value !== undefined) {
    existingState = exactDecisionState(existingRead.value, expected);
    if (existingState !== 'MATCH') return decisionStopped(eventId, existingState);
    if (decisionState === 'compensate') {
      return { state: 'CONFIRMED', confirmed: [{ eventId: eventId, disposition: 'already-present' }] };
    }
  }

  for (let index = 0; index < prefixCount; index += 1) {
    const releaseId = SAFE_STRING_SLICE(acquisitions[index]._id, 0, -1) + 'r';
    const releaseRead = await read(releaseId);
    if (!releaseRead.ok) return decisionStopped(eventId, 'UNRESOLVED');
    if (releaseRead.value !== null && releaseRead.value !== undefined) {
      return decisionStopped(eventId, 'INTEGRITY');
    }
  }
  if (existingState === 'MATCH') {
    return { state: 'CONFIRMED', confirmed: [{ eventId: eventId, disposition: 'already-present' }] };
  }

  let insertResolved = false;
  try {
    const inserted = SAFE_REFLECT_APPLY(insertFunction, owner,
      [CLAIM_COLLECTION, expected, decisionWriteOptions()]);
    await SAFE_PROMISE_RESOLVE(inserted);
    insertResolved = true;
  } catch (error) {
    // Every outcome is reconciled from the deterministic ID below.
  }
  const readback = await read(eventId);
  if (!readback.ok || readback.value === null || readback.value === undefined) {
    return decisionStopped(eventId, 'UNRESOLVED');
  }
  const readbackState = exactDecisionState(readback.value, expected);
  if (readbackState !== 'MATCH') return decisionStopped(eventId, readbackState);
  return {
    state: 'CONFIRMED',
    confirmed: [{ eventId: eventId, disposition: insertResolved ? 'inserted' : 'already-present' }]
  };
}

export async function appendRoomClaimEvents(events) {
  events = snapshotClaimEventBatch(events);
  if (!events) throw new SAFE_ERROR('Invalid claim event batch');
  const persistenceOwner = wixData;
  const insertFunction = persistenceOwner && persistenceOwner.insert;
  const getFunction = persistenceOwner && persistenceOwner.get;
  if (typeof insertFunction !== 'function' || typeof getFunction !== 'function') {
    throw new SAFE_ERROR('Invalid claim persistence port');
  }
  const insertEvent = async function(event) {
    return await SAFE_PROMISE_RESOLVE(SAFE_REFLECT_APPLY(
      insertFunction, persistenceOwner, [CLAIM_COLLECTION, event, decisionWriteOptions()]));
  };
  const readEvent = async function(eventId) {
    return await SAFE_PROMISE_RESOLVE(SAFE_REFLECT_APPLY(
      getFunction, persistenceOwner, [CLAIM_COLLECTION, eventId, decisionReadOptions()]));
  };
  const operationDigests = SAFE_OBJECT_CREATE(null);
  const operationBookingNumbers = SAFE_OBJECT_CREATE(null);
  const operationIdentities = SAFE_OBJECT_CREATE(null);
  const ownedOperationIdentities = SAFE_OBJECT_CREATE(null);
  const eventIds = SAFE_OBJECT_CREATE(null);
  for (let index = 0; index < events.length; index += 1) {
    if (!isValidStoredEvent(events[index]) ||
        (events[index].claimType === 'operation-completion' ||
         events[index].claimType === 'operation-decision')) {
      return {
        state: 'STOPPED',
        confirmed: [],
        failed: {
          index: index,
          eventId: events[index] && events[index]._id,
          classification: 'INTEGRITY'
        }
      };
    }
    const event = events[index];
    if (SAFE_OBJECT_HAS_OWN_PROPERTY(eventIds, event._id)) {
      return {
        state: 'STOPPED',
        confirmed: [],
        failed: { index: index, eventId: event._id, classification: 'INTEGRITY' }
      };
    }
    eventIds[event._id] = true;
    if (event.claimType === 'operation') {
      operationIdentities[event.operationId] = event;
    } else if (event.eventType === 'acquire') {
      const identity = operationIdentities[event.operationId];
      if (!identity) {
        return {
          state: 'STOPPED',
          confirmed: [],
          failed: { index: index, eventId: event._id, classification: 'INTEGRITY' }
        };
      }
      if (identity.payloadDigest !== event.payloadDigest ||
          identity.bookingNumber !== event.bookingNumber) {
        return {
          state: 'STOPPED',
          confirmed: [],
          failed: { index: index, eventId: event._id, classification: 'IDEMPOTENCY_CONFLICT' }
        };
      }
      if (event.claimType === 'unit') {
        const matchingCapacity = SAFE_ARRAY_FILTER(SAFE_ARRAY_SLICE(events, 0, index), function(candidate) {
          return candidate && candidate.eventType === 'acquire' && candidate.claimType === 'capacity' &&
            candidate.night === event.night && candidate.operationId === event.operationId &&
            candidate.bookingRowId === event.bookingRowId &&
            candidate.bookingNumber === event.bookingNumber &&
            candidate.payloadDigest === event.payloadDigest;
        });
        if (matchingCapacity.length !== 1) {
          return {
            state: 'STOPPED',
            confirmed: [],
            failed: { index: index, eventId: event._id, classification: 'INTEGRITY' }
          };
        }
      }
    }
    if (SAFE_OBJECT_HAS_OWN_PROPERTY(operationDigests, event.operationId) &&
        operationDigests[event.operationId] !== event.payloadDigest) {
      return {
        state: 'STOPPED',
        confirmed: [],
        failed: { index: index, eventId: event._id, classification: 'IDEMPOTENCY_CONFLICT' }
      };
    }
    operationDigests[event.operationId] = event.payloadDigest;
    if (SAFE_OBJECT_HAS_OWN_PROPERTY(operationBookingNumbers, event.operationId) &&
        operationBookingNumbers[event.operationId] !== event.bookingNumber) {
      return {
        state: 'STOPPED',
        confirmed: [],
        failed: { index: index, eventId: event._id, classification: 'IDEMPOTENCY_CONFLICT' }
      };
    }
    operationBookingNumbers[event.operationId] = event.bookingNumber;
  }
  const batchOperationIds = SAFE_OBJECT_KEYS(operationDigests);
  if (batchOperationIds.length > 1) {
    const firstOperationId = events[0] && events[0].operationId;
    const index = SAFE_ARRAY_FIND_INDEX(events, function(event) {
      return event.operationId !== firstOperationId;
    });
    return {
      state: 'STOPPED',
      confirmed: [],
      failed: {
        index: index,
        eventId: events[index] && events[index]._id,
        classification: 'INTEGRITY'
      }
    };
  }
  const topologyKeys = [];
  SAFE_ARRAY_FOR_EACH(events, function(event) {
    if (event.eventType !== 'acquire' ||
        (event.claimType !== 'capacity' && event.claimType !== 'unit')) return;
    const key = event.operationId + '|' + event.night;
    if (SAFE_ARRAY_INDEX_OF(topologyKeys, key) === -1) SAFE_ARRAY_PUSH(topologyKeys, key);
  });
  for (let topologyIndex = 0; topologyIndex < topologyKeys.length; topologyIndex += 1) {
    const key = topologyKeys[topologyIndex];
    const separator = SAFE_STRING_LAST_INDEX_OF(key, '|');
    const operationId = SAFE_STRING_SLICE(key, 0, separator);
    const night = SAFE_STRING_SLICE(key, separator + 1);
    const capacities = SAFE_ARRAY_FILTER(events, function(event) {
      return event.eventType === 'acquire' && event.claimType === 'capacity' &&
        event.operationId === operationId && event.night === night;
    });
    const units = SAFE_ARRAY_FILTER(events, function(event) {
      return event.eventType === 'acquire' && event.claimType === 'unit' &&
        event.operationId === operationId && event.night === night;
    });
    const firstResource = capacities[0] || units[0];
    let validTopology = capacities.length > 0 && capacities.length === units.length &&
      SAFE_ARRAY_INDEX_OF(events, capacities[capacities.length - 1]) <
        SAFE_ARRAY_INDEX_OF(events, units[0]);
    for (let index = 0; validTopology && index < capacities.length; index += 1) {
      const expectedRowId = 'pb1-' + operationId + '-r' + (index + 1);
      validTopology = capacities[index].bookingRowId === expectedRowId &&
        units[index].bookingRowId === expectedRowId &&
        (index === 0 || capacities[index - 1].capacitySlot < capacities[index].capacitySlot) &&
        (index === 0 || units[index - 1].unit < units[index].unit);
    }
    if (!validTopology) {
      const index = SAFE_ARRAY_INDEX_OF(events, firstResource);
      return {
        state: 'STOPPED',
        confirmed: [],
        failed: { index: index, eventId: firstResource && firstResource._id, classification: 'INTEGRITY' }
      };
    }
  }
  const allCapacityEvents = SAFE_ARRAY_FILTER(events, function(event) {
    return event.eventType === 'acquire' && event.claimType === 'capacity';
  });
  const allUnitEvents = SAFE_ARRAY_FILTER(events, function(event) {
    return event.eventType === 'acquire' && event.claimType === 'unit';
  });
  if (allCapacityEvents.length && allUnitEvents.length &&
      SAFE_ARRAY_INDEX_OF(events, allCapacityEvents[allCapacityEvents.length - 1]) >
        SAFE_ARRAY_INDEX_OF(events, allUnitEvents[0])) {
    const index = SAFE_ARRAY_INDEX_OF(events, allUnitEvents[0]);
    return {
      state: 'STOPPED',
      confirmed: [],
      failed: { index: index, eventId: allUnitEvents[0]._id, classification: 'INTEGRITY' }
    };
  }
  const identityOperationIds = SAFE_OBJECT_KEYS(operationIdentities);
  for (let operationIndex = 0; operationIndex < identityOperationIds.length; operationIndex += 1) {
    const operationId = identityOperationIds[operationIndex];
    const identity = operationIdentities[operationId];
    const manifest = parseOperationManifest(identity);
    const requestedResourceIds = SAFE_ARRAY_MAP(SAFE_ARRAY_FILTER(events, function(event) {
      return event.operationId === operationId && event.eventType === 'acquire' &&
        event.claimType !== 'operation';
    }), function(event) { return event._id; });
    if (!manifest || manifest.resourceIds.length !== requestedResourceIds.length ||
        SAFE_ARRAY_SOME(manifest.resourceIds, function(id, index) {
          return requestedResourceIds[index] !== id;
        })) {
      const index = SAFE_ARRAY_INDEX_OF(events, identity);
      return {
        state: 'STOPPED',
        confirmed: [],
        failed: { index: index, eventId: identity._id, classification: 'INTEGRITY' }
      };
    }
  }
  const reacquisitions = SAFE_ARRAY_FILTER(events, function(event) {
    return event.eventType === 'acquire' && event.claimType !== 'operation' && event.generation > 1;
  });
  if (reacquisitions.length) {
    let ledger;
    try {
      ledger = await loadRoomClaimLedger();
    } catch (error) {
      const event = reacquisitions[0];
      return {
        state: 'STOPPED',
        confirmed: [],
        failed: { index: SAFE_ARRAY_INDEX_OF(events, event), eventId: event._id, classification: 'UNRESOLVED' }
      };
    }
    for (let reacquisitionIndex = 0; reacquisitionIndex < reacquisitions.length;
        reacquisitionIndex += 1) {
      const event = reacquisitions[reacquisitionIndex];
      for (let generation = 1; generation < event.generation; generation += 1) {
        const history = SAFE_ARRAY_FILTER(ledger, function(candidate) {
          return candidate && candidate.claimKey === event.claimKey && candidate.generation === generation;
        });
        const acquires = SAFE_ARRAY_FILTER(history,
          function(candidate) { return candidate.eventType === 'acquire'; });
        const releases = SAFE_ARRAY_FILTER(history,
          function(candidate) { return candidate.eventType === 'release'; });
        const identities = acquires.length === 1 ? SAFE_ARRAY_FILTER(ledger, function(candidate) {
          return candidate && candidate.claimType === 'operation' &&
            candidate.operationId === acquires[0].operationId;
        }) : [];
        let validHistory = acquires.length === 1 && releases.length === 1 && history.length === 2 &&
          identities.length === 1 && isValidStoredEvent(acquires[0]) &&
          isValidStoredEvent(releases[0]) && manifestDeclaresResource(identities[0], acquires[0]) &&
          hasCompletedManifestHistory(ledger, identities[0]);
        if (validHistory) {
          const expectedRelease = SAFE_OBJECT_ASSIGN({}, acquires[0], {
            _id: SAFE_STRING_SLICE(acquires[0]._id, 0, -1) + 'r',
            eventType: 'release',
            releaseReason: releases[0].releaseReason
          });
          validHistory = matchesEvent(releases[0], expectedRelease);
        }
        if (!validHistory) {
          return {
            state: 'STOPPED',
            confirmed: [],
            failed: {
              index: SAFE_ARRAY_INDEX_OF(events, event),
              eventId: event._id,
              classification: 'INTEGRITY'
            }
          };
        }
      }
    }
  }
  const releases = SAFE_ARRAY_FILTER(events, function(event) { return event.eventType === 'release'; });
  if (releases.length) {
    const firstRelease = releases[0];
    const firstReleaseIndex = SAFE_ARRAY_INDEX_OF(events, firstRelease);
    if (SAFE_ARRAY_SOME(events, function(event) { return event.eventType === 'acquire'; })) {
      return {
        state: 'STOPPED', confirmed: [],
        failed: {
          index: firstReleaseIndex,
          eventId: firstRelease._id,
          classification: 'INTEGRITY'
        }
      };
    }
    const decisionId = 'rc1-op-' + firstRelease.operationId + '-d';
    let decisionResult;
    try {
      decisionResult = await appendRoomOperationDecision(firstRelease.operationId, 'compensate');
    } catch (error) {
      decisionResult = null;
    }
    if (!exactSingleDecisionConfirmation(decisionResult, decisionId)) {
      return {
        state: 'STOPPED',
        confirmed: [],
        failed: {
          index: firstReleaseIndex,
          eventId: firstRelease._id,
          classification: exactDecisionFailureClassification(decisionResult, decisionId) || 'INTEGRITY'
        }
      };
    }
  }
  const confirmed = [];
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    if (event.eventType === 'release') {
      const identityId = 'rc1-op-' + event.operationId + '-a';
      let storedIdentity;
      try {
        storedIdentity = await readEvent(identityId);
      } catch (error) {
        return {
          state: 'STOPPED',
          confirmed: confirmed,
          failed: { index: confirmed.length, eventId: event._id, classification: 'UNRESOLVED' }
        };
      }
      const acquireId = SAFE_STRING_SLICE(event._id, 0, -1) + 'a';
      const expectedAcquire = SAFE_OBJECT_ASSIGN({}, event, {
        _id: acquireId,
        eventType: 'acquire'
      });
      delete expectedAcquire.releaseReason;
      const prefix = await loadAuthoritativeManifestPrefix(storedIdentity, readEvent);
      if (prefix.state !== 'CONFIRMED') {
        return {
          state: 'STOPPED',
          confirmed: confirmed,
          failed: { index: confirmed.length, eventId: event._id, classification: prefix.state }
        };
      }
      const expectedCompletion = operationCompletionEvent(storedIdentity);
      let storedCompletion;
      try {
        storedCompletion = await readEvent(expectedCompletion._id);
      } catch (error) {
        return {
          state: 'STOPPED',
          confirmed: confirmed,
          failed: { index: confirmed.length, eventId: event._id, classification: 'UNRESOLVED' }
        };
      }
      if (!matchesOperationCompletion(storedCompletion, storedIdentity, prefix.acquisitions)) {
        return {
          state: 'STOPPED',
          confirmed: confirmed,
          failed: { index: confirmed.length, eventId: event._id, classification: 'INTEGRITY' }
        };
      }
      const storedAcquire = prefix.acquisitions[acquireId];
      if (!storedAcquire || !matchesEvent(storedAcquire, expectedAcquire)) {
        return {
          state: 'STOPPED',
          confirmed: confirmed,
          failed: { index: confirmed.length, eventId: event._id, classification: 'INTEGRITY' }
        };
      }
      const releaseOrderState = await validateReverseRelease(
        storedIdentity, prefix.acquisitions, acquireId, readEvent);
      if (releaseOrderState !== 'CONFIRMED') {
        return {
          state: 'STOPPED',
          confirmed: confirmed,
          failed: {
            index: confirmed.length,
            eventId: event._id,
            classification: releaseOrderState
          }
        };
      }
    }
    let insertResolved = false;
    try {
      await insertEvent(event);
      insertResolved = true;
    } catch (error) {
      // A deterministic-ID collision and an ambiguous write failure are both
      // reconciled from authoritative stored state below.
    }
    let stored;
    try {
      stored = await readEvent(event._id);
    } catch (error) {
      return {
        state: 'STOPPED',
        confirmed: confirmed,
        failed: { index: confirmed.length, eventId: event._id, classification: 'UNRESOLVED' }
      };
    }
    if (!isValidStoredEvent(stored) || !matchesEvent(stored, event)) {
      const classification = classifyStoredMismatch(stored, event);
      const ownedIdentity = ownedOperationIdentities[event.operationId];
      if (ownedIdentity && event.claimType !== 'operation' && classification !== 'UNRESOLVED') {
        const confirmedResourceCount = SAFE_ARRAY_FILTER(confirmed, function(item) {
          const confirmedEvent = SAFE_ARRAY_FIND(events, function(candidate) {
            return candidate._id === item.eventId;
          });
          return confirmedEvent && confirmedEvent.operationId === event.operationId &&
            confirmedEvent.eventType === 'acquire' && confirmedEvent.claimType !== 'operation';
        }).length;
        const terminal = await confirmOperationCompletion(
          ownedIdentity, 'stopped', confirmedResourceCount, insertEvent, readEvent);
        if (terminal.state !== 'CONFIRMED') {
          return {
            state: 'STOPPED',
            confirmed: confirmed,
            failed: {
              index: confirmed.length,
              eventId: terminal.event._id,
              classification: terminal.state
            }
          };
        }
      }
      return {
        state: 'STOPPED',
        confirmed: confirmed,
        failed: {
          index: confirmed.length,
          eventId: event._id,
          classification: classification
        }
      };
    }
    if (event.claimType === 'operation' && insertResolved) {
      ownedOperationIdentities[event.operationId] = event;
    }
    if (event.claimType === 'operation' && !insertResolved && events.length > 1) {
      const reconciled = [{ eventId: event._id, disposition: 'already-present' }];
      for (let index = 1; index < events.length; index += 1) {
        let storedEvent;
        try {
          storedEvent = await readEvent(events[index]._id);
        } catch (error) {
          return {
            state: 'STOPPED',
            confirmed: reconciled,
            failed: { index: index, eventId: events[index]._id, classification: 'UNRESOLVED' }
          };
        }
        if (!isValidStoredEvent(storedEvent) || !matchesEvent(storedEvent, events[index])) {
          return {
            state: 'STOPPED',
            confirmed: reconciled,
            failed: {
              index: index,
              eventId: events[index]._id,
              classification: storedEvent === null || storedEvent === undefined
                ? 'INTEGRITY'
                : classifyStoredMismatch(storedEvent, events[index])
            }
          };
        }
        SAFE_ARRAY_PUSH(reconciled, {
          eventId: events[index]._id, disposition: 'already-present'
        });
      }
      const completion = await confirmOperationCompletion(event, undefined, undefined, insertEvent, readEvent);
      if (completion.state !== 'CONFIRMED') {
        return {
          state: 'STOPPED',
          confirmed: reconciled,
          failed: {
            index: events.length,
            eventId: completion.event._id,
            classification: completion.state
          }
        };
      }
      return { state: 'CONFIRMED', confirmed: reconciled };
    }
    SAFE_ARRAY_PUSH(confirmed, {
      eventId: event._id,
      disposition: insertResolved ? 'inserted' : 'already-present'
    });
  }
  const completionOperationIds = SAFE_OBJECT_KEYS(operationIdentities);
  for (let operationIndex = 0; operationIndex < completionOperationIds.length; operationIndex += 1) {
    const operationId = completionOperationIds[operationIndex];
    const completion = await confirmOperationCompletion(
      operationIdentities[operationId], undefined, undefined, insertEvent, readEvent);
    if (completion.state !== 'CONFIRMED') {
      return {
        state: 'STOPPED',
        confirmed: confirmed,
        failed: {
          index: events.length,
          eventId: completion.event._id,
          classification: completion.state
        }
      };
    }
  }
  return { state: 'CONFIRMED', confirmed: confirmed };
}
