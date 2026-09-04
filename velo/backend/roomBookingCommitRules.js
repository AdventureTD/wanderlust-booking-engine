import { evaluateAutomaticAvailability } from 'backend/roomAvailabilityRules';

// Pure committed-assignment and unit-night claim planning.
// No Wix APIs, database access, network calls, or side effects belong here.

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

function requiredIdentifier(value, name) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error('Invalid ' + name);
  }
  return value;
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
    'confirmedResourceCount'
  ];
  return Object.keys(event).every(function(key) {
    return key.charAt(0) === '_' || allowed.indexOf(key) !== -1;
  });
}

function isValidClaimEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      !hasOnlyClaimFields(event) || event.protocolVersion !== 1 || typeof event.claimKey !== 'string' ||
      (event.eventType !== 'acquire' && event.eventType !== 'release' &&
       event.eventType !== 'complete') ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(event.operationId || '') ||
      !validBookingRowId(event) ||
      !isCanonicalText(event.bookingNumber, 128) ||
      !/^[0-9a-f]{64}$/.test(event.payloadDigest) ||
      !Number.isInteger(event.generation) || event.generation < 1 || event.generation > 999999) {
    return false;
  }
  const completionClaim = event.claimType === 'operation-completion' &&
    event.eventType === 'complete' && event.generation === 1 &&
    event.claimKey === 'operation:' + event.operationId + ':completion' &&
    event._id === 'rc1-op-' + event.operationId + '-c' &&
    event.bookingRowId === 'pb1-' + event.operationId + '-r1' &&
    event.night === undefined && event.capacitySlot === undefined && event.unit === undefined &&
    event.releaseReason === undefined &&
    (event.completionState === 'complete' || event.completionState === 'stopped') &&
    Number.isInteger(event.confirmedResourceCount) &&
    event.confirmedResourceCount >= 0 && event.confirmedResourceCount <= 6400 &&
    event.manifestVersion === undefined && event.manifestCheckIn === undefined &&
    event.manifestCheckOut === undefined && event.manifestRoomCode === undefined &&
    event.manifestUnits === undefined && event.manifestBookingRowIds === undefined &&
    event.manifestResourceClaimIds === undefined;
  if (completionClaim) return true;
  const operationClaim = event.claimType === 'operation' &&
    event.eventType === 'acquire' && event.generation === 1 &&
    event.claimKey === 'operation:' + event.operationId &&
    event._id === 'rc1-op-' + event.operationId + '-a' &&
    event.bookingRowId === 'pb1-' + event.operationId + '-r1' &&
    event.night === undefined && event.capacitySlot === undefined && event.unit === undefined &&
    event.releaseReason === undefined && event.completionState === undefined &&
    event.confirmedResourceCount === undefined && !!parseOperationManifest(event);
  if (operationClaim) return true;
  if ([
    'manifestVersion', 'manifestCheckIn', 'manifestCheckOut', 'manifestRoomCode',
    'manifestUnits', 'manifestBookingRowIds', 'manifestResourceClaimIds',
    'completionState', 'confirmedResourceCount'
  ].some(function(key) { return event[key] !== undefined; })) return false;
  if (canonicalDay(event.night) === null) return false;
  const validReleaseReason = event.eventType === 'release'
    ? isCanonicalText(event.releaseReason, 256)
    : event.releaseReason === undefined;
  if (!validReleaseReason) return false;
  const capacityClaim = event.claimType === 'capacity' &&
    Number.isInteger(event.capacitySlot) && event.capacitySlot >= 1 && event.capacitySlot <= 4 &&
    event.unit === undefined &&
    event.claimKey === 'capacity:' + event.night + ':' + event.capacitySlot;
  const unitClaim = event.claimType === 'unit' &&
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
    if (event.claimType === 'operation' || event.claimType === 'operation-completion') continue;
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

function claimState(claimLedger, claimKey) {
  let generation = 0;
  let acquired = false;
  let released = false;
  let acquisition = null;
  for (const event of claimLedger) {
    if (!event || event.claimKey !== claimKey) continue;
    if (event.generation > generation) {
      generation = event.generation;
      acquired = false;
      released = false;
      acquisition = null;
    }
    if (event.generation === generation && event.eventType === 'acquire') {
      acquired = true;
      acquisition = event;
    }
    if (event.generation === generation && event.eventType === 'release') released = true;
  }
  const active = generation > 0 && acquired && !released;
  if (!active && generation >= 999999) {
    throw new Error('Claim generation exhausted');
  }
  return {
    active: active,
    acquisition: active ? acquisition : null,
    nextGeneration: generation + 1
  };
}

function lowestFreeCapacitySlots(claimLedger, night, quantity) {
  const free = [];
  for (let slot = 1; slot <= 4 && free.length < quantity; slot += 1) {
    const state = claimState(claimLedger, 'capacity:' + night + ':' + slot);
    if (!state.active) free.push({ slot: slot, generation: state.nextGeneration });
  }
  if (free.length !== quantity) throw new Error('Physical room assignment unavailable');
  return free;
}

function claimOwnerKey(event) {
  return JSON.stringify([
    event.operationId,
    event.payloadDigest,
    event.bookingNumber,
    event.bookingRowId
  ]);
}

function validateSnapshotNights(snapshot, nights) {
  if (!snapshot || !snapshot.occupiedUnitsByNight ||
      typeof snapshot.occupiedUnitsByNight !== 'object' ||
      Array.isArray(snapshot.occupiedUnitsByNight)) {
    throw new Error('Invalid inventory snapshot');
  }
  const snapshotNights = Object.keys(snapshot.occupiedUnitsByNight).sort();
  const expectedNights = nights.slice().sort();
  if (snapshotNights.length !== expectedNights.length ||
      expectedNights.some(function(night, index) {
        return snapshotNights[index] !== night ||
          !Array.isArray(snapshot.occupiedUnitsByNight[night]);
      })) {
    throw new Error('Invalid inventory snapshot');
  }
}

function reconcileSnapshotClaims(snapshot, claimLedger, nights) {
  for (const night of nights) {
    const snapshotUnits = snapshot.occupiedUnitsByNight[night];
    const activeUnits = [];
    const unitOwners = [];
    const capacityOwners = [];
    for (let unit = 1; unit <= 5; unit += 1) {
      const state = claimState(claimLedger, 'unit:' + night + ':' + unit);
      if (state.active) {
        activeUnits.push(unit);
        unitOwners.push(claimOwnerKey(state.acquisition));
      }
    }
    for (let slot = 1; slot <= 4; slot += 1) {
      const state = claimState(claimLedger, 'capacity:' + night + ':' + slot);
      if (state.active) capacityOwners.push(claimOwnerKey(state.acquisition));
    }
    unitOwners.sort();
    capacityOwners.sort();
    if (snapshotUnits.length !== activeUnits.length ||
        snapshotUnits.some(function(unit, index) { return unit !== activeUnits[index]; }) ||
        unitOwners.length !== capacityOwners.length ||
        unitOwners.some(function(owner, index, all) { return all.indexOf(owner) !== index; }) ||
        capacityOwners.some(function(owner, index, all) { return all.indexOf(owner) !== index; }) ||
        unitOwners.some(function(owner, index) { return owner !== capacityOwners[index]; })) {
      throw new Error('Physical room assignment unavailable');
    }
  }
}

function generationText(generation) {
  return String(generation).padStart(6, '0');
}

function operationIdentityEvent(request, bookingRows, resourceAcquisitions) {
  const event = {
    _id: 'rc1-op-' + request.operationId + '-a',
    protocolVersion: 1,
    claimKey: 'operation:' + request.operationId,
    generation: 1,
    eventType: 'acquire',
    claimType: 'operation',
    operationId: request.operationId,
    bookingRowId: 'pb1-' + request.operationId + '-r1',
    bookingNumber: request.bookingNumber,
    payloadDigest: request.payloadDigest,
    manifestVersion: 1,
    manifestCheckIn: request.checkIn,
    manifestCheckOut: request.checkOut,
    manifestRoomCode: request.roomCode,
    manifestUnits: bookingRows.map(function(row) { return row.assignedRoom; }).join(','),
    manifestBookingRowIds: bookingRows.map(function(row) { return row._id; }).join('|'),
    manifestResourceClaimIds: resourceAcquisitions.map(function(event) { return event._id; }).join('|')
  };
  if (!parseOperationManifest(event)) {
    throw new Error('Commit manifest exceeds storage limit');
  }
  return event;
}

function acquireEvent(request, night, claimType, number, generation, rowIndex) {
  const compactNight = night.replace(/-/g, '');
  const marker = claimType === 'capacity' ? 's' : 'u';
  const event = {
    _id: 'rc1-' + compactNight + '-' + marker + number + '-' + generationText(generation) + '-a',
    protocolVersion: 1,
    claimKey: claimType + ':' + night + ':' + number,
    generation: generation,
    eventType: 'acquire',
    claimType: claimType,
    night: night,
    operationId: request.operationId,
    bookingRowId: 'pb1-' + request.operationId + '-r' + rowIndex,
    bookingNumber: request.bookingNumber,
    payloadDigest: request.payloadDigest
  };
  if (claimType === 'capacity') event.capacitySlot = number;
  else event.unit = number;
  return event;
}

export function buildPhysicalCommitPlan(snapshot, claimLedger, request) {
  validateClaimLedger(claimLedger);
  const bookingNumber = requiredIdentifier(request && request.bookingNumber, 'booking number');
  if (!isCanonicalText(bookingNumber, 128)) throw new Error('Invalid booking number');
  const operationId = requiredIdentifier(request && request.operationId, 'operation ID');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(operationId)) {
    throw new Error('Invalid operation ID');
  }
  if (!request || !/^[0-9a-f]{64}$/.test(request.payloadDigest)) {
    throw new Error('Invalid payload digest');
  }
  const existingOperation = claimLedger.find(function(event) {
    return event.claimType === 'operation' && event.operationId === operationId;
  });
  if (existingOperation && (
      existingOperation.payloadDigest !== request.payloadDigest ||
      existingOperation.bookingNumber !== bookingNumber)) {
    throw new Error('Operation identity conflict');
  }
  if (existingOperation) {
    throw new Error('Operation requires reconciliation');
  }
  const nights = requestedNights(request.checkIn, request.checkOut);
  validateSnapshotNights(snapshot, nights);
  const availability = evaluateAutomaticAvailability(
    snapshot,
    request.roomCode,
    request.quantity
  );
  if (!availability.available) {
    throw new Error('Physical room assignment unavailable');
  }
  reconcileSnapshotClaims(snapshot, claimLedger, nights);
  const bookingRows = [];
  availability.units.forEach(function(unit, index) {
    bookingRows.push({
      _id: 'pb1-' + operationId + '-r' + (index + 1),
      roomCode: request.roomCode,
      assignedRoom: unit,
      quantity: 1,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      bookingNumber: bookingNumber,
      operationId: operationId,
      payloadDigest: request.payloadDigest
    });
  });
  const resourceAcquisitions = [];
  for (const night of nights) {
    const capacitySlots = lowestFreeCapacitySlots(claimLedger, night, availability.units.length);
    capacitySlots.forEach(function(capacity, index) {
      resourceAcquisitions.push(acquireEvent(
        request,
        night,
        'capacity',
        capacity.slot,
        capacity.generation,
        index + 1
      ));
    });
  }
  for (const night of nights) {
    availability.units.forEach(function(unit, index) {
      const unitState = claimState(claimLedger, 'unit:' + night + ':' + unit);
      if (unitState.active) {
        throw new Error('Physical room assignment unavailable');
      }
      resourceAcquisitions.push(acquireEvent(
        request,
        night,
        'unit',
        unit,
        unitState.nextGeneration,
        index + 1
      ));
    });
  }
  const acquisitions = [operationIdentityEvent(request, bookingRows, resourceAcquisitions)]
    .concat(resourceAcquisitions);
  return {
    acquisitions: acquisitions,
    bookingRows: bookingRows,
    primaryRowId: bookingRows[0]._id
  };
}

function canonicalStoredDay(value) {
  if (canonicalDay(value) !== null) return value;
  if (!value || typeof value.getTime !== 'function' || Number.isNaN(value.getTime()) ||
      value.getUTCHours() !== 12 || value.getUTCMinutes() !== 0 ||
      value.getUTCSeconds() !== 0 || value.getUTCMilliseconds() !== 0) {
    return null;
  }
  return value.toISOString().slice(0, 10);
}

function containsMatchingRecord(records, expected) {
  return records.filter(function(record) {
    return record && Object.keys(expected).every(function(key) {
      if (key === 'checkIn' || key === 'checkOut') {
        return canonicalStoredDay(record[key]) === expected[key];
      }
      return record[key] === expected[key];
    });
  }).length === 1;
}

function hasValidPlanTopology(plan) {
  const operationEvents = plan.acquisitions.filter(function(event) {
    return event.claimType === 'operation';
  });
  if (operationEvents.length !== 1 || operationEvents[0] !== plan.acquisitions[0] ||
      operationEvents[0].bookingRowId !== plan.bookingRows[0]._id ||
      plan.bookingRows.some(function(row, index) {
        return row._id !== 'pb1-' + row.operationId + '-r' + (index + 1);
      })) {
    return false;
  }
  const manifest = parseOperationManifest(operationEvents[0]);
  const resourceIds = plan.acquisitions.slice(1).map(function(event) { return event._id; });
  if (!manifest || operationEvents[0].manifestCheckIn !== plan.bookingRows[0].checkIn ||
      operationEvents[0].manifestCheckOut !== plan.bookingRows[0].checkOut ||
      operationEvents[0].manifestRoomCode !== plan.bookingRows[0].roomCode ||
      operationEvents[0].manifestUnits !== plan.bookingRows.map(function(row) {
        return row.assignedRoom;
      }).join(',') ||
      manifest.rowIds.length !== plan.bookingRows.length ||
      manifest.rowIds.some(function(rowId, index) { return rowId !== plan.bookingRows[index]._id; }) ||
      manifest.resourceIds.length !== resourceIds.length ||
      manifest.resourceIds.some(function(id, index) { return id !== resourceIds[index]; })) {
    return false;
  }
  let expectedEventCount = 1;
  const claimKeys = [];
  for (const row of plan.bookingRows) {
    const nights = requestedNights(row.checkIn, row.checkOut);
    expectedEventCount += nights.length * 2;
    for (const night of nights) {
      const rowEvents = plan.acquisitions.filter(function(event) {
        return event.bookingRowId === row._id && event.night === night;
      });
      const capacityEvents = rowEvents.filter(function(event) {
        return event.claimType === 'capacity';
      });
      const unitEvents = rowEvents.filter(function(event) {
        return event.claimType === 'unit' && event.unit === row.assignedRoom;
      });
      if (capacityEvents.length !== 1 || unitEvents.length !== 1 || rowEvents.length !== 2 ||
          plan.acquisitions.indexOf(capacityEvents[0]) > plan.acquisitions.indexOf(unitEvents[0])) {
        return false;
      }
    }
  }
  const planNights = requestedNights(plan.bookingRows[0].checkIn, plan.bookingRows[0].checkOut);
  for (const night of planNights) {
    const capacityEvents = plan.acquisitions.filter(function(event) {
      return event.claimType === 'capacity' && event.night === night;
    });
    const unitEvents = plan.acquisitions.filter(function(event) {
      return event.claimType === 'unit' && event.night === night;
    });
    if (capacityEvents.length !== plan.bookingRows.length ||
        unitEvents.length !== plan.bookingRows.length ||
        plan.acquisitions.indexOf(capacityEvents[capacityEvents.length - 1]) >
          plan.acquisitions.indexOf(unitEvents[0])) {
      return false;
    }
    for (let index = 0; index < plan.bookingRows.length; index += 1) {
      if (capacityEvents[index].bookingRowId !== plan.bookingRows[index]._id ||
          unitEvents[index].bookingRowId !== plan.bookingRows[index]._id ||
          (index > 0 && capacityEvents[index - 1].capacitySlot >= capacityEvents[index].capacitySlot) ||
          (index > 0 && unitEvents[index - 1].unit >= unitEvents[index].unit)) {
        return false;
      }
    }
  }
  const allCapacityEvents = plan.acquisitions.filter(function(event) {
    return event.claimType === 'capacity';
  });
  const allUnitEvents = plan.acquisitions.filter(function(event) {
    return event.claimType === 'unit';
  });
  if (!allCapacityEvents.length || !allUnitEvents.length ||
      plan.acquisitions.indexOf(allCapacityEvents[allCapacityEvents.length - 1]) >
        plan.acquisitions.indexOf(allUnitEvents[0])) {
    return false;
  }
  if (plan.acquisitions.length !== expectedEventCount) return false;
  for (const event of plan.acquisitions) {
    if (claimKeys.indexOf(event.claimKey) !== -1) return false;
    claimKeys.push(event.claimKey);
  }
  return true;
}

export function validatePhysicalCommit(plan, bookingRows, acquisitions) {
  const planOperationId = plan && Array.isArray(plan.bookingRows) && plan.bookingRows[0] &&
    plan.bookingRows[0].operationId;
  const planPayloadDigest = plan && Array.isArray(plan.bookingRows) && plan.bookingRows[0] &&
    plan.bookingRows[0].payloadDigest;
  const planBookingNumber = plan && Array.isArray(plan.bookingRows) && plan.bookingRows[0] &&
    plan.bookingRows[0].bookingNumber;
  const planCheckIn = plan && Array.isArray(plan.bookingRows) && plan.bookingRows[0]
    ? canonicalDay(plan.bookingRows[0].checkIn) : null;
  const planCheckOut = plan && Array.isArray(plan.bookingRows) && plan.bookingRows[0]
    ? canonicalDay(plan.bookingRows[0].checkOut) : null;
  const lowestUnitRow = plan && Array.isArray(plan.bookingRows)
    ? plan.bookingRows.reduce(function(lowest, row) {
      return !lowest || (row && row.assignedRoom < lowest.assignedRoom) ? row : lowest;
    }, null)
    : null;
  const validInputs = plan && typeof plan === 'object' && !Array.isArray(plan) &&
    Array.isArray(plan.bookingRows) && plan.bookingRows.length > 0 &&
    plan.bookingRows.every(function(row, index, rows) {
      return row && rows.findIndex(function(candidate) { return candidate && candidate._id === row._id; }) === index;
    }) &&
    plan.bookingRows.every(function(row) {
      const checkInDay = row && canonicalDay(row.checkIn);
      const checkOutDay = row && canonicalDay(row.checkOut);
      const expectedRoomCode = row && row.assignedRoom === 1
        ? 'penthouse_apartment'
        : row && row.assignedRoom === 2
          ? 'two_bedroom_apartment'
          : row && Number.isInteger(row.assignedRoom) && row.assignedRoom >= 3 && row.assignedRoom <= 5
            ? 'adventure_suite'
            : null;
      return row && row.quantity === 1 && row.roomCode === expectedRoomCode &&
        row.operationId === planOperationId &&
        validBookingRowId({ operationId: row.operationId, bookingRowId: row._id }) &&
        /^[A-Za-z0-9_-]{16,64}$/.test(row.operationId || '') &&
        row.payloadDigest === planPayloadDigest &&
        /^[0-9a-f]{64}$/.test(row.payloadDigest || '') &&
        row.bookingNumber === planBookingNumber && isCanonicalText(row.bookingNumber, 128) &&
        checkInDay === planCheckIn && checkOutDay === planCheckOut &&
        checkInDay !== null && checkOutDay !== null && checkOutDay > checkInDay;
    }) &&
    Array.isArray(plan.acquisitions) && plan.acquisitions.length > 0 &&
    plan.acquisitions.every(function(event) {
      return isValidClaimEvent(event) && event.eventType === 'acquire' &&
        event.operationId === planOperationId && event.payloadDigest === planPayloadDigest &&
        event.bookingNumber === planBookingNumber &&
        plan.bookingRows.some(function(row) { return row._id === event.bookingRowId; });
    }) &&
    hasValidPlanTopology(plan) &&
    typeof plan.primaryRowId === 'string' &&
    Array.isArray(bookingRows) && Array.isArray(acquisitions);
  if (!validInputs ||
      bookingRows.length !== plan.bookingRows.length ||
      acquisitions.length !== plan.acquisitions.length ||
      !lowestUnitRow || plan.primaryRowId !== lowestUnitRow._id ||
      !plan.bookingRows.every(function(row) { return containsMatchingRecord(bookingRows, row); }) ||
      !plan.acquisitions.every(function(event) { return containsMatchingRecord(acquisitions, event); })) {
    throw new Error('Physical commit verification failed');
  }
  return true;
}

export function planPhysicalRollback(acquisitions, releaseReason) {
  const rollbackOwner = Array.isArray(acquisitions) ? acquisitions[0] : null;
  if (!isCanonicalText(releaseReason, 256) ||
      !Array.isArray(acquisitions) || acquisitions.some(function(acquisition, index) {
    return !isValidClaimEvent(acquisition) || acquisition.eventType !== 'acquire' ||
      (rollbackOwner && (
        acquisition.operationId !== rollbackOwner.operationId ||
        acquisition.payloadDigest !== rollbackOwner.payloadDigest ||
        acquisition.bookingNumber !== rollbackOwner.bookingNumber
      )) ||
      acquisitions.slice(0, index).some(function(previous) {
        return previous && previous._id === acquisition._id;
      });
  })) {
    throw new Error('Invalid rollback request');
  }
  return acquisitions.filter(function(acquisition) {
    return acquisition.claimType !== 'operation';
  }).slice().reverse().map(function(acquisition) {
    return Object.assign({}, acquisition, {
      _id: acquisition._id.slice(0, -1) + 'r',
      eventType: 'release',
      releaseReason: releaseReason
    });
  });
}
