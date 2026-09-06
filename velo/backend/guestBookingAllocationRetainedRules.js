// Static rc1 grammar/history derived from roomBookingCommitRules (c3a5b1fa).
// No allocation, inventory refresh, effects or financial authority.
// Called only with detached records behind ManifestRules' intrinsic guard.
const DAY_MS = 86400000;
const MAX_MANIFEST_NIGHTS = 800;

function canonicalDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00.000Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return Math.floor(date.getTime() / DAY_MS);
}

function requestedNights(checkIn, checkOut) {
  const startDay = canonicalDay(checkIn);
  const endDay = canonicalDay(checkOut);
  if (startDay === null || endDay === null || endDay <= startDay ||
      endDay - startDay > MAX_MANIFEST_NIGHTS) {
    throw new Error('Invalid commit dates');
  }
  const nights = [];
  for (let day = startDay; day < endDay; day += 1) {
    nights.push(new Date(day * DAY_MS).toISOString().slice(0, 10));
  }
  return nights;
}

function isCanonicalText(value, maxLength) {
  return typeof value === 'string' && !!value && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseOperationManifest(event) {
  if (event.manifestVersion !== 1 ||
      canonicalDay(event.manifestCheckIn) === null ||
      canonicalDay(event.manifestCheckOut) === null ||
      !isCanonicalText(event.manifestRoomCode, 128) ||
      !isCanonicalText(event.manifestUnits, 16) ||
      !isCanonicalText(event.manifestBookingRowIds, 512) ||
      !isCanonicalText(event.manifestResourceClaimIds, 60000)) {
    return null;
  }
  if (!/^[1-5](,[1-5]){0,3}$/.test(event.manifestUnits)) return null;
  const units = event.manifestUnits.split(',').map(function(value) { return Number(value); });
  const rowIds = event.manifestBookingRowIds.split('|');
  const resourceIds = event.manifestResourceClaimIds.split('|');
  const stayNightCount = canonicalDay(event.manifestCheckOut) -
    canonicalDay(event.manifestCheckIn);
  const declaredNightCount = resourceIds.length / (units.length * 2);
  if (!Number.isInteger(declaredNightCount) || declaredNightCount < 1 ||
      declaredNightCount > MAX_MANIFEST_NIGHTS || stayNightCount !== declaredNightCount) {
    return null;
  }
  let nights;
  try {
    nights = requestedNights(event.manifestCheckIn, event.manifestCheckOut);
  } catch (error) {
    return null;
  }
  if (!units.length || units.length > 4 || rowIds.length !== units.length ||
      units.some(function(unit, index) {
        return !Number.isInteger(unit) || unit < 1 || unit > 5 ||
          (index > 0 && units[index - 1] >= unit);
      }) ||
      rowIds.some(function(rowId, index) {
        return rowId !== 'pb1-' + event.operationId + '-r' + (index + 1);
      }) ||
      resourceIds.some(function(id, index, all) { return all.indexOf(id) !== index; })) {
    return null;
  }
  const allowedAssignments = {
    penthouse_apartment: ['1'],
    two_bedroom_apartment: ['2'],
    adventure_suite: ['3', '4', '3,4', '3,4,5']
  }[event.manifestRoomCode];
  if (!allowedAssignments || allowedAssignments.indexOf(units.join(',')) === -1) return null;
  const expected = [];
  let resourceIndex = 0;
  for (const night of nights) {
    let priorSlot = 0;
    for (let rowIndex = 0; rowIndex < units.length; rowIndex += 1) {
      const id = resourceIds[resourceIndex++];
      const match = id.match(new RegExp('^rc1-' + night.replace(/-/g, '') + '-s([1-4])-(\\d{6})-a$'));
      const slot = match ? Number(match[1]) : 0;
      const generation = match ? Number(match[2]) : 0;
      if (!match || slot <= priorSlot || generation < 1) return null;
      priorSlot = slot;
      expected.push({
        _id: id,
        claimType: 'capacity',
        night: night,
        capacitySlot: slot,
        generation: generation,
        bookingRowId: rowIds[rowIndex]
      });
    }
  }
  for (const night of nights) {
    for (let rowIndex = 0; rowIndex < units.length; rowIndex += 1) {
      const id = resourceIds[resourceIndex++];
      const match = id.match(new RegExp('^rc1-' + night.replace(/-/g, '') + '-u' +
        units[rowIndex] + '-(\\d{6})-a$'));
      const generation = match ? Number(match[1]) : 0;
      if (!match || generation < 1) return null;
      expected.push({
        _id: id,
        claimType: 'unit',
        night: night,
        unit: units[rowIndex],
        generation: generation,
        bookingRowId: rowIds[rowIndex]
      });
    }
  }
  return { rowIds: rowIds, resourceIds: resourceIds, expected: expected };
}

function validBookingRowId(event) {
  const prefix = 'pb1-' + event.operationId + '-r';
  return typeof event.bookingRowId === 'string' &&
    event.bookingRowId.indexOf(prefix) === 0 &&
    /^[1-9]\d*$/.test(event.bookingRowId.slice(prefix.length));
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
  return Object.keys(event).every(function(key) {
    return key.charAt(0) === '_' || allowed.indexOf(key) !== -1;
  });
}

function hasValidDecisionFenceVersion(event) {
  let descriptor;
  let prototype;
  try {
    descriptor = Object.getOwnPropertyDescriptor(event, 'decisionFenceVersion');
    prototype = Object.getPrototypeOf(event);
    for (let depth = 0; prototype !== null && depth < 64; depth += 1) {
      if (Object.getOwnPropertyDescriptor(prototype, 'decisionFenceVersion')) return false;
      prototype = Object.getPrototypeOf(prototype);
    }
    if (prototype !== null) return false;
  } catch (error) {
    return false;
  }
  return !descriptor ||
    (Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
      descriptor.enumerable === true && descriptor.value === 1 &&
      Number.isSafeInteger(descriptor.value));
}

function hasExactDecisionShape(event) {
  const fields = [
    '_id', 'protocolVersion', 'claimKey', 'generation', 'eventType', 'claimType',
    'operationId', 'bookingRowId', 'bookingNumber', 'payloadDigest', 'decisionFenceVersion',
    'operationIdentityId', 'operationCompletionId', 'manifestVersion', 'completionState',
    'confirmedResourceCount', 'decisionState'
  ];
  const metadata = ['_owner', '_createdDate', '_updatedDate'];
  let prototype;
  let parent;
  let prototypeKeys;
  let first;
  let keys;
  let second;
  try {
    prototype = Object.getPrototypeOf(event);
    parent = prototype && Object.getPrototypeOf(prototype);
    prototypeKeys = prototype && Reflect.ownKeys(prototype);
    first = Object.getOwnPropertyDescriptors(event);
    keys = Reflect.ownKeys(event);
    second = Object.getOwnPropertyDescriptors(event);
  } catch (error) {
    return false;
  }
  const ordinaryNames = [
    'constructor', '__defineGetter__', '__defineSetter__', 'hasOwnProperty',
    '__lookupGetter__', '__lookupSetter__', 'isPrototypeOf', 'propertyIsEnumerable',
    'toString', 'valueOf', '__proto__', 'toLocaleString'
  ];
  if (!prototype || parent !== null || prototypeKeys.length !== ordinaryNames.length ||
      prototypeKeys.some(function(key) { return ordinaryNames.indexOf(key) === -1; }) ||
      keys.length < fields.length || keys.length > fields.length + metadata.length ||
      Reflect.ownKeys(first).length !== keys.length || Reflect.ownKeys(second).length !== keys.length) {
    return false;
  }
  for (let index = 0; index < keys.length; index += 1) {
    if (Reflect.ownKeys(first)[index] !== keys[index] || Reflect.ownKeys(second)[index] !== keys[index]) {
      return false;
    }
    const key = keys[index];
    const left = first[key];
    const right = second[key];
    if (typeof key !== 'string' || !left || !right ||
        !Object.prototype.hasOwnProperty.call(left, 'value') ||
        !Object.prototype.hasOwnProperty.call(right, 'value') ||
        left.value !== right.value || left.enumerable !== true || right.enumerable !== true ||
        left.configurable !== right.configurable || left.writable !== right.writable) return false;
    if (fields.indexOf(key) !== -1) {
      if ((left.value !== null && typeof left.value === 'object') ||
          typeof left.value === 'function' || typeof left.value === 'symbol' ||
          typeof left.value === 'bigint') return false;
      continue;
    }
    if (key === '_owner') {
      if (typeof left.value !== 'string') return false;
      continue;
    }
    if (key !== '_createdDate' && key !== '_updatedDate') return false;
    try {
      if (Number.isNaN(Date.prototype.getTime.call(left.value))) return false;
    } catch (error) {
      return false;
    }
  }
  return fields.every(function(key) { return Object.prototype.hasOwnProperty.call(first, key); });
}

function isValidClaimEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  let claimTypeDescriptor;
  try {
    claimTypeDescriptor = Object.getOwnPropertyDescriptor(event, 'claimType');
  } catch (error) {
    return false;
  }
  if (!claimTypeDescriptor || !Object.prototype.hasOwnProperty.call(claimTypeDescriptor, 'value') ||
      claimTypeDescriptor.enumerable !== true || typeof claimTypeDescriptor.value !== 'string') {
    return false;
  }
  const claimType = claimTypeDescriptor.value;
  if (!hasOnlyClaimFields(event) || event.protocolVersion !== 1 || typeof event.claimKey !== 'string' ||
      (event.eventType !== 'acquire' && event.eventType !== 'release' &&
       event.eventType !== 'complete' && event.eventType !== 'decide') ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(event.operationId || '') ||
      !validBookingRowId(event) ||
      !isCanonicalText(event.bookingNumber, 128) ||
      !/^[0-9a-f]{64}$/.test(event.payloadDigest) ||
      !Number.isInteger(event.generation) || event.generation < 1 || event.generation > 999999) {
    return false;
  }
  const decisionClaim = claimType === 'operation-decision' &&
    hasExactDecisionShape(event) &&
    event.eventType === 'decide' && event.generation === 1 &&
    event.claimKey === 'operation:' + event.operationId + ':decision' &&
    event._id === 'rc1-op-' + event.operationId + '-d' &&
    event.bookingRowId === 'pb1-' + event.operationId + '-r1' &&
    event.decisionFenceVersion === 1 &&
    event.operationIdentityId === 'rc1-op-' + event.operationId + '-a' &&
    event.operationCompletionId === 'rc1-op-' + event.operationId + '-c' &&
    event.manifestVersion === 1 &&
    (event.completionState === 'complete' || event.completionState === 'stopped') &&
    Number.isInteger(event.confirmedResourceCount) &&
    event.confirmedResourceCount >= 0 && event.confirmedResourceCount <= 6400 &&
    (event.decisionState === 'commit-rows' || event.decisionState === 'compensate') &&
    event.night === undefined && event.capacitySlot === undefined && event.unit === undefined &&
    event.releaseReason === undefined && event.manifestCheckIn === undefined &&
    event.manifestCheckOut === undefined && event.manifestRoomCode === undefined &&
    event.manifestUnits === undefined && event.manifestBookingRowIds === undefined &&
    event.manifestResourceClaimIds === undefined;
  if (decisionClaim) return true;
  const completionClaim = claimType === 'operation-completion' &&
    event.eventType === 'complete' && event.generation === 1 &&
    event.claimKey === 'operation:' + event.operationId + ':completion' &&
    event._id === 'rc1-op-' + event.operationId + '-c' &&
    event.bookingRowId === 'pb1-' + event.operationId + '-r1' &&
    event.night === undefined && event.capacitySlot === undefined && event.unit === undefined &&
    event.releaseReason === undefined &&
    (event.completionState === 'complete' || event.completionState === 'stopped') &&
    Number.isInteger(event.confirmedResourceCount) &&
    event.confirmedResourceCount >= 0 && event.confirmedResourceCount <= 6400 &&
    hasValidDecisionFenceVersion(event) &&
    event.manifestVersion === undefined && event.manifestCheckIn === undefined &&
    event.manifestCheckOut === undefined && event.manifestRoomCode === undefined &&
    event.manifestUnits === undefined && event.manifestBookingRowIds === undefined &&
    event.manifestResourceClaimIds === undefined;
  if (completionClaim) return true;
  const operationClaim = claimType === 'operation' &&
    event.eventType === 'acquire' && event.generation === 1 &&
    event.claimKey === 'operation:' + event.operationId &&
    event._id === 'rc1-op-' + event.operationId + '-a' &&
    event.bookingRowId === 'pb1-' + event.operationId + '-r1' &&
    event.night === undefined && event.capacitySlot === undefined && event.unit === undefined &&
    event.releaseReason === undefined && event.completionState === undefined &&
    event.confirmedResourceCount === undefined && hasValidDecisionFenceVersion(event) &&
    !!parseOperationManifest(event);
  if (operationClaim) return true;
  if (!hasValidDecisionFenceVersion(event) || [
    'manifestVersion', 'manifestCheckIn', 'manifestCheckOut', 'manifestRoomCode',
    'manifestUnits', 'manifestBookingRowIds', 'manifestResourceClaimIds',
    'completionState', 'confirmedResourceCount', 'decisionFenceVersion',
    'operationIdentityId', 'operationCompletionId', 'decisionState'
  ].some(function(key) {
    return Object.prototype.hasOwnProperty.call(event, key);
  })) return false;
  if (canonicalDay(event.night) === null) return false;
  const validReleaseReason = event.eventType === 'release'
    ? isCanonicalText(event.releaseReason, 256)
    : event.releaseReason === undefined;
  if (!validReleaseReason) return false;
  const capacityClaim = claimType === 'capacity' &&
    Number.isInteger(event.capacitySlot) && event.capacitySlot >= 1 && event.capacitySlot <= 4 &&
    event.unit === undefined &&
    event.claimKey === 'capacity:' + event.night + ':' + event.capacitySlot;
  const unitClaim = claimType === 'unit' &&
    Number.isInteger(event.unit) && event.unit >= 1 && event.unit <= 5 &&
    event.capacitySlot === undefined &&
    event.claimKey === 'unit:' + event.night + ':' + event.unit;
  if (!capacityClaim && !unitClaim) return false;
  const claimNumber = capacityClaim ? event.capacitySlot : event.unit;
  const marker = capacityClaim ? 's' : 'u';
  const expectedId = 'rc1-' + event.night.replace(/-/g, '') + '-' + marker + claimNumber +
    '-' + generationText(event.generation) + '-' + (event.eventType === 'acquire' ? 'a' : 'r');
  return event._id === expectedId;
}

function validateClaimLedger(claimLedger) {
  if (!Array.isArray(claimLedger)) throw new Error('Invalid claim ledger');
  const claimKeys = [];
  const operationDigests = Object.create(null);
  const operationBookingNumbers = Object.create(null);
  for (const event of claimLedger) {
    if (!isValidClaimEvent(event)) throw new Error('Invalid claim ledger');
    if (Object.prototype.hasOwnProperty.call(operationDigests, event.operationId) &&
        operationDigests[event.operationId] !== event.payloadDigest) {
      throw new Error('Invalid claim ledger');
    }
    operationDigests[event.operationId] = event.payloadDigest;
    if (Object.prototype.hasOwnProperty.call(operationBookingNumbers, event.operationId) &&
        operationBookingNumbers[event.operationId] !== event.bookingNumber) {
      throw new Error('Invalid claim ledger');
    }
    operationBookingNumbers[event.operationId] = event.bookingNumber;
    if (event.claimType !== 'operation-completion' &&
        event.claimType !== 'operation-decision' &&
        claimKeys.indexOf(event.claimKey) === -1) claimKeys.push(event.claimKey);
    if (event.eventType !== 'release') continue;
    const matchingAcquire = claimLedger.some(function(candidate) {
      return candidate && candidate.eventType === 'acquire' &&
        candidate.claimKey === event.claimKey && candidate.generation === event.generation &&
        candidate.claimType === event.claimType && candidate.night === event.night &&
        candidate.unit === event.unit && candidate.capacitySlot === event.capacitySlot &&
        candidate.operationId === event.operationId &&
        candidate.bookingRowId === event.bookingRowId &&
        candidate.bookingNumber === event.bookingNumber &&
        candidate.payloadDigest === event.payloadDigest;
    });
    if (!matchingAcquire) throw new Error('Invalid claim ledger');
  }
  const manifests = Object.create(null);
  for (const event of claimLedger) {
    if (event.claimType !== 'operation') continue;
    if (manifests[event.operationId]) throw new Error('Invalid claim ledger');
    manifests[event.operationId] = parseOperationManifest(event);
  }
  for (const event of claimLedger) {
    if (event.claimType === 'operation' || event.claimType === 'operation-completion' ||
        event.claimType === 'operation-decision') continue;
    const operationIdentity = claimLedger.find(function(candidate) {
      return candidate && candidate.claimType === 'operation' &&
        candidate.operationId === event.operationId;
    });
    if (!operationIdentity || operationIdentity.payloadDigest !== event.payloadDigest ||
        operationIdentity.bookingNumber !== event.bookingNumber) {
      throw new Error('Invalid claim ledger');
    }
    const manifest = manifests[event.operationId];
    const acquisitionId = event.eventType === 'release'
      ? event._id.slice(0, -1) + 'a'
      : event._id;
    const expected = manifest && manifest.expected.find(function(candidate) {
      return candidate._id === acquisitionId;
    });
    if (!expected || expected.claimType !== event.claimType || expected.night !== event.night ||
        expected.generation !== event.generation || expected.bookingRowId !== event.bookingRowId ||
        expected.capacitySlot !== event.capacitySlot || expected.unit !== event.unit) {
      throw new Error('Invalid claim ledger');
    }
  }
  for (const completion of claimLedger.filter(function(event) {
    return event.claimType === 'operation-completion';
  })) {
    if (!manifests[completion.operationId]) throw new Error('Invalid claim ledger');
  }
  for (const decision of claimLedger.filter(function(event) {
    return event.claimType === 'operation-decision';
  })) {
    if (!manifests[decision.operationId]) throw new Error('Invalid claim ledger');
  }
  for (const operationId of Object.keys(manifests)) {
    const manifest = manifests[operationId];
    const actualIds = claimLedger.filter(function(event) {
      return event.operationId === operationId && event.claimType !== 'operation' &&
        event.claimType !== 'operation-completion' && event.eventType === 'acquire';
    }).map(function(event) { return event._id; });
    const expectedPrefix = manifest.resourceIds.slice(0, actualIds.length);
    if (actualIds.length > manifest.resourceIds.length ||
        expectedPrefix.some(function(id) { return actualIds.indexOf(id) === -1; }) ||
        actualIds.some(function(id) { return expectedPrefix.indexOf(id) === -1; })) {
      throw new Error('Invalid claim ledger');
    }
    const identity = claimLedger.find(function(event) {
      return event.claimType === 'operation' && event.operationId === operationId;
    });
    const completions = claimLedger.filter(function(event) {
      return event.claimType === 'operation-completion' && event.operationId === operationId;
    });
    const releases = claimLedger.filter(function(event) {
      return event.operationId === operationId && event.eventType === 'release';
    });
    const decisions = claimLedger.filter(function(event) {
      return event.claimType === 'operation-decision' && event.operationId === operationId;
    });
    if (decisions.length > 1 || (decisions.length === 1 && (
        completions.length !== 1 || identity.decisionFenceVersion !== 1 ||
        completions[0].decisionFenceVersion !== 1 ||
        decisions[0].operationIdentityId !== identity._id ||
        decisions[0].operationCompletionId !== completions[0]._id ||
        decisions[0].bookingRowId !== identity.bookingRowId ||
        decisions[0].bookingNumber !== identity.bookingNumber ||
        decisions[0].payloadDigest !== identity.payloadDigest ||
        decisions[0].manifestVersion !== identity.manifestVersion ||
        decisions[0].completionState !== completions[0].completionState ||
        decisions[0].confirmedResourceCount !== completions[0].confirmedResourceCount ||
        (decisions[0].decisionState === 'commit-rows' &&
          decisions[0].completionState !== 'complete')
      ))) throw new Error('Invalid claim ledger');
    if (identity.decisionFenceVersion === 1 && releases.length &&
        (decisions.length !== 1 || decisions[0].decisionState !== 'compensate')) {
      throw new Error('Invalid claim ledger');
    }
    if (completions.length > 1 || (releases.length && completions.length !== 1)) {
      throw new Error('Invalid claim ledger');
    }
    const releasedAcquisitionIds = releases.map(function(event) {
      return event._id.slice(0, -1) + 'a';
    });
    const expectedReleasedSuffix = expectedPrefix.slice(
      expectedPrefix.length - releasedAcquisitionIds.length);
    if (releasedAcquisitionIds.length > actualIds.length ||
        releasedAcquisitionIds.some(function(id, index, all) {
          return all.indexOf(id) !== index || expectedReleasedSuffix.indexOf(id) === -1;
        }) || expectedReleasedSuffix.some(function(id) {
          return releasedAcquisitionIds.indexOf(id) === -1;
        })) {
      throw new Error('Invalid claim ledger');
    }
    if (completions.length === 1) {
      const completion = completions[0];
      if (completion.payloadDigest !== identity.payloadDigest ||
          completion.bookingNumber !== identity.bookingNumber ||
          completion.bookingRowId !== identity.bookingRowId ||
          Object.prototype.hasOwnProperty.call(completion, 'decisionFenceVersion') !==
            Object.prototype.hasOwnProperty.call(identity, 'decisionFenceVersion') ||
          completion.decisionFenceVersion !== identity.decisionFenceVersion ||
          completion.confirmedResourceCount !== actualIds.length ||
          (completion.completionState === 'complete' &&
            actualIds.length !== manifest.resourceIds.length) ||
          (completion.completionState === 'stopped' &&
            actualIds.length >= manifest.resourceIds.length)) {
        throw new Error('Invalid claim ledger');
      }
    }
  }
  const acquisitionTuples = Object.create(null);
  for (const event of claimLedger) {
    if (event.eventType !== 'acquire' || event.claimType === 'operation') continue;
    const tupleKey = JSON.stringify([
      event.operationId,
      event.payloadDigest,
      event.bookingNumber,
      event.bookingRowId,
      event.night
    ]);
    if (!acquisitionTuples[tupleKey]) acquisitionTuples[tupleKey] = [];
    acquisitionTuples[tupleKey].push(event);
  }
  for (const tupleKey of Object.keys(acquisitionTuples)) {
    const tupleEvents = acquisitionTuples[tupleKey];
    const operationId = tupleEvents[0].operationId;
    const operationAcquisitions = claimLedger.filter(function(event) {
      return event.operationId === operationId && event.claimType !== 'operation' &&
        event.eventType === 'acquire';
    });
    if (operationAcquisitions.length < manifests[operationId].resourceIds.length) continue;
    if (tupleEvents.filter(function(event) { return event.claimType === 'capacity'; }).length !== 1 ||
        tupleEvents.filter(function(event) { return event.claimType === 'unit'; }).length !== 1 ||
        tupleEvents.length !== 2) {
      throw new Error('Invalid claim ledger');
    }
  }
  for (const claimKey of claimKeys) {
    const generations = claimLedger
      .filter(function(event) { return event.claimKey === claimKey; })
      .map(function(event) { return event.generation; })
      .filter(function(generation, index, all) { return all.indexOf(generation) === index; })
      .sort(function(a, b) { return a - b; });
    if (generations.some(function(generation, index) { return generation !== index + 1; })) {
      throw new Error('Invalid claim ledger');
    }
    for (let generation = 1; generation <= generations.length; generation += 1) {
      const generationEvents = claimLedger.filter(function(event) {
        return event.claimKey === claimKey && event.generation === generation;
      });
      const acquires = generationEvents.filter(function(event) {
        return event.eventType === 'acquire';
      });
      const releases = generationEvents.filter(function(event) {
        return event.eventType === 'release';
      });
      if (acquires.length !== 1 || releases.length > 1 ||
          (generation < generations.length && releases.length !== 1)) {
        throw new Error('Invalid claim ledger');
      }
    }
  }
}


function generationText(generation) { return String(generation).padStart(6, '0'); }
export function validateRetainedClaimLedger(ledger) {
  if (!Array.isArray(ledger)) throw new Error('Invalid claim ledger');
  for (const row of ledger) {
    const base=['_id','protocolVersion','claimKey','generation','eventType','claimType','operationId','bookingRowId','bookingNumber','payloadDigest'];
    const manifest=['manifestVersion','manifestCheckIn','manifestCheckOut','manifestRoomCode','manifestUnits','manifestBookingRowIds','manifestResourceClaimIds'];
    let fields=base.slice();
    switch(row.claimType) {
      case 'operation': fields.push(...manifest); break;
      case 'operation-completion': fields.push('completionState','confirmedResourceCount'); break;
      case 'operation-decision': fields.push('decisionFenceVersion','operationIdentityId','operationCompletionId','manifestVersion','completionState','confirmedResourceCount','decisionState'); break;
      case 'capacity': case 'unit': fields.push('night',row.claimType==='capacity'?'capacitySlot':'unit');if(row.eventType==='release')fields.push('releaseReason');break;
      default: throw new Error('Invalid claim ledger');
    }
    if(['operation','operation-completion'].includes(row.claimType)&&Object.hasOwn(row,'decisionFenceVersion'))fields.push('decisionFenceVersion');
    const keys=Reflect.ownKeys(row);
    if(Object.getPrototypeOf(row)!==Object.prototype||keys.length!==fields.length||fields.some(k=>!Object.hasOwn(row,k)))throw new Error('Invalid claim ledger');
    for(const key of keys){const d=Object.getOwnPropertyDescriptor(row,key),v=d.value;if(!Object.hasOwn(d,'value')||!d.enumerable||(typeof v!=='string'&&typeof v!=='number')||(typeof v==='number'&&(!Number.isSafeInteger(v)||Object.is(v,-0))))throw new Error('Invalid claim ledger');}
    if(typeof row._id!=='string'||row._id.length<1||row._id.length>128||!/^[\x20-\x7e]+$/.test(row._id))throw new Error('Invalid claim ledger');
  }
  validateClaimLedger(ledger);
}
