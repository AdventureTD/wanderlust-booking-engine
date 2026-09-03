import wixData from 'wix-data';

// Backend-only append-only claim-event persistence. This module is intentionally
// disconnected from public web methods, booking writes, Search, and side effects.
const CLAIM_COLLECTION = 'RoomBookingClaimEvents';
const READ_OPTIONS = { suppressAuth: true, consistentRead: true, suppressHooks: true };
const WRITE_OPTIONS = { suppressAuth: true, suppressHooks: true };

export async function loadRoomClaimLedger() {
  const items = [];
  const eventIds = [];
  const pages = [];
  let page = await wixData.query(CLAIM_COLLECTION).limit(1000).find(READ_OPTIONS);
  if (!page || typeof page !== 'object') {
    throw new Error('Claim ledger paging returned no page');
  }
  while (page) {
    if (pages.indexOf(page) !== -1) {
      throw new Error('Claim ledger paging repeated a page');
    }
    pages.push(page);
    if (!Array.isArray(page.items)) {
      throw new Error('Claim ledger paging result has invalid items');
    }
    for (const item of page.items) {
      if (eventIds.indexOf(item && item._id) !== -1) {
        throw new Error('Claim ledger contains duplicate event IDs');
      }
      eventIds.push(item && item._id);
      items.push(item);
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
    Object.keys(expected).every(function(key) {
      return stored[key] === expected[key];
    }) &&
    Object.keys(stored).every(function(key) {
      return key.charAt(0) === '_' || Object.prototype.hasOwnProperty.call(expected, key);
    });
}

function isCanonicalNight(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function hasOnlyClaimFields(event) {
  const allowed = [
    '_id', 'protocolVersion', 'claimKey', 'eventType', 'claimType', 'generation',
    'night', 'capacitySlot', 'unit', 'operationId', 'payloadDigest', 'bookingNumber',
    'bookingRowId', 'releaseReason'
  ];
  return Object.keys(event).every(function(key) {
    return key.charAt(0) === '_' || allowed.indexOf(key) !== -1;
  });
}

function isCanonicalText(value, maxLength) {
  return typeof value === 'string' && !!value && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function isValidStoredEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      !hasOnlyClaimFields(event) ||
      event.protocolVersion !== 1 ||
      !Number.isInteger(event.generation) || event.generation < 1 || event.generation > 999999 ||
      (event.eventType !== 'acquire' && event.eventType !== 'release') ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(event.operationId || '') ||
      !isCanonicalText(event.bookingNumber, 128) ||
      !/^[0-9a-f]{64}$/.test(event.payloadDigest || '')) {
    return false;
  }
  const expectedRowPrefix = 'pb1-' + event.operationId + '-r';
  const validBookingRowId = typeof event.bookingRowId === 'string' &&
    event.bookingRowId.indexOf(expectedRowPrefix) === 0 &&
    /^[1-9]\d*$/.test(event.bookingRowId.slice(expectedRowPrefix.length));
  if (!validBookingRowId) return false;
  if (event.claimType === 'operation') {
    return event.eventType === 'acquire' && event.generation === 1 &&
      event._id === 'rc1-op-' + event.operationId + '-a' &&
      event.claimKey === 'operation:' + event.operationId &&
      event.bookingRowId === expectedRowPrefix + '1' &&
      event.night === undefined && event.capacitySlot === undefined && event.unit === undefined &&
      event.releaseReason === undefined;
  }
  if (!isCanonicalNight(event.night)) return false;
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
  const expectedId = 'rc1-' + event.night.replace(/-/g, '') + '-' + marker + claimNumber + '-' +
    String(event.generation).padStart(6, '0') + '-' + (event.eventType === 'acquire' ? 'a' : 'r');
  return event._id === expectedId;
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

export async function appendRoomClaimEvents(events) {
  if (!Array.isArray(events)) throw new Error('Invalid claim event batch');
  const operationDigests = Object.create(null);
  const operationBookingNumbers = Object.create(null);
  const operationIdentities = Object.create(null);
  const eventIds = Object.create(null);
  for (let index = 0; index < events.length; index += 1) {
    if (!isValidStoredEvent(events[index])) {
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
    if (Object.prototype.hasOwnProperty.call(eventIds, event._id)) {
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
        const matchingCapacity = events.slice(0, index).filter(function(candidate) {
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
    if (Object.prototype.hasOwnProperty.call(operationDigests, event.operationId) &&
        operationDigests[event.operationId] !== event.payloadDigest) {
      return {
        state: 'STOPPED',
        confirmed: [],
        failed: { index: index, eventId: event._id, classification: 'IDEMPOTENCY_CONFLICT' }
      };
    }
    operationDigests[event.operationId] = event.payloadDigest;
    if (Object.prototype.hasOwnProperty.call(operationBookingNumbers, event.operationId) &&
        operationBookingNumbers[event.operationId] !== event.bookingNumber) {
      return {
        state: 'STOPPED',
        confirmed: [],
        failed: { index: index, eventId: event._id, classification: 'IDEMPOTENCY_CONFLICT' }
      };
    }
    operationBookingNumbers[event.operationId] = event.bookingNumber;
  }
  const topologyKeys = [];
  events.forEach(function(event) {
    if (event.eventType !== 'acquire' ||
        (event.claimType !== 'capacity' && event.claimType !== 'unit')) return;
    const key = event.operationId + '|' + event.night;
    if (topologyKeys.indexOf(key) === -1) topologyKeys.push(key);
  });
  for (const key of topologyKeys) {
    const separator = key.lastIndexOf('|');
    const operationId = key.slice(0, separator);
    const night = key.slice(separator + 1);
    const capacities = events.filter(function(event) {
      return event.eventType === 'acquire' && event.claimType === 'capacity' &&
        event.operationId === operationId && event.night === night;
    });
    const units = events.filter(function(event) {
      return event.eventType === 'acquire' && event.claimType === 'unit' &&
        event.operationId === operationId && event.night === night;
    });
    const firstResource = capacities[0] || units[0];
    let validTopology = capacities.length > 0 && capacities.length === units.length &&
      events.indexOf(capacities[capacities.length - 1]) < events.indexOf(units[0]);
    for (let index = 0; validTopology && index < capacities.length; index += 1) {
      const expectedRowId = 'pb1-' + operationId + '-r' + (index + 1);
      validTopology = capacities[index].bookingRowId === expectedRowId &&
        units[index].bookingRowId === expectedRowId &&
        (index === 0 || capacities[index - 1].capacitySlot < capacities[index].capacitySlot) &&
        (index === 0 || units[index - 1].unit < units[index].unit);
    }
    if (!validTopology) {
      const index = events.indexOf(firstResource);
      return {
        state: 'STOPPED',
        confirmed: [],
        failed: { index: index, eventId: firstResource && firstResource._id, classification: 'INTEGRITY' }
      };
    }
  }
  const allCapacityEvents = events.filter(function(event) {
    return event.eventType === 'acquire' && event.claimType === 'capacity';
  });
  const allUnitEvents = events.filter(function(event) {
    return event.eventType === 'acquire' && event.claimType === 'unit';
  });
  if (allCapacityEvents.length && allUnitEvents.length &&
      events.indexOf(allCapacityEvents[allCapacityEvents.length - 1]) > events.indexOf(allUnitEvents[0])) {
    const index = events.indexOf(allUnitEvents[0]);
    return {
      state: 'STOPPED',
      confirmed: [],
      failed: { index: index, eventId: allUnitEvents[0]._id, classification: 'INTEGRITY' }
    };
  }
  const reacquisitions = events.filter(function(event) {
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
        failed: { index: events.indexOf(event), eventId: event._id, classification: 'UNRESOLVED' }
      };
    }
    for (const event of reacquisitions) {
      for (let generation = 1; generation < event.generation; generation += 1) {
        const history = ledger.filter(function(candidate) {
          return candidate && candidate.claimKey === event.claimKey && candidate.generation === generation;
        });
        const acquires = history.filter(function(candidate) { return candidate.eventType === 'acquire'; });
        const releases = history.filter(function(candidate) { return candidate.eventType === 'release'; });
        let validHistory = acquires.length === 1 && releases.length === 1 && history.length === 2 &&
          isValidStoredEvent(acquires[0]) && isValidStoredEvent(releases[0]);
        if (validHistory) {
          const expectedRelease = Object.assign({}, acquires[0], {
            _id: acquires[0]._id.slice(0, -1) + 'r',
            eventType: 'release',
            releaseReason: releases[0].releaseReason
          });
          validHistory = matchesEvent(releases[0], expectedRelease);
        }
        if (!validHistory) {
          return {
            state: 'STOPPED',
            confirmed: [],
            failed: { index: events.indexOf(event), eventId: event._id, classification: 'INTEGRITY' }
          };
        }
      }
    }
  }
  const confirmed = [];
  for (const event of events) {
    if (event.eventType === 'release') {
      const expectedIdentity = {
        _id: 'rc1-op-' + event.operationId + '-a',
        protocolVersion: 1,
        claimKey: 'operation:' + event.operationId,
        generation: 1,
        eventType: 'acquire',
        claimType: 'operation',
        operationId: event.operationId,
        bookingRowId: 'pb1-' + event.operationId + '-r1',
        bookingNumber: event.bookingNumber,
        payloadDigest: event.payloadDigest
      };
      let storedIdentity;
      try {
        storedIdentity = await wixData.get(CLAIM_COLLECTION, expectedIdentity._id, READ_OPTIONS);
      } catch (error) {
        return {
          state: 'STOPPED',
          confirmed: confirmed,
          failed: { index: confirmed.length, eventId: event._id, classification: 'UNRESOLVED' }
        };
      }
      if (!isValidStoredEvent(storedIdentity) || !matchesEvent(storedIdentity, expectedIdentity)) {
        return {
          state: 'STOPPED',
          confirmed: confirmed,
          failed: { index: confirmed.length, eventId: event._id, classification: 'INTEGRITY' }
        };
      }
      const expectedAcquire = Object.assign({}, event, {
        _id: event._id.slice(0, -1) + 'a',
        eventType: 'acquire'
      });
      delete expectedAcquire.releaseReason;
      let storedAcquire;
      try {
        storedAcquire = await wixData.get(CLAIM_COLLECTION, expectedAcquire._id, READ_OPTIONS);
      } catch (error) {
        return {
          state: 'STOPPED',
          confirmed: confirmed,
          failed: { index: confirmed.length, eventId: event._id, classification: 'UNRESOLVED' }
        };
      }
      if (!isValidStoredEvent(storedAcquire) || !matchesEvent(storedAcquire, expectedAcquire)) {
        return {
          state: 'STOPPED',
          confirmed: confirmed,
          failed: { index: confirmed.length, eventId: event._id, classification: 'INTEGRITY' }
        };
      }
    }
    let insertResolved = false;
    try {
      await wixData.insert(CLAIM_COLLECTION, event, WRITE_OPTIONS);
      insertResolved = true;
    } catch (error) {
      // A deterministic-ID collision and an ambiguous write failure are both
      // reconciled from authoritative stored state below.
    }
    let stored;
    try {
      stored = await wixData.get(CLAIM_COLLECTION, event._id, READ_OPTIONS);
    } catch (error) {
      return {
        state: 'STOPPED',
        confirmed: confirmed,
        failed: { index: confirmed.length, eventId: event._id, classification: 'UNRESOLVED' }
      };
    }
    if (!isValidStoredEvent(stored) || !matchesEvent(stored, event)) {
      return {
        state: 'STOPPED',
        confirmed: confirmed,
        failed: {
          index: confirmed.length,
          eventId: event._id,
          classification: classifyStoredMismatch(stored, event)
        }
      };
    }
    if (event.claimType === 'operation' && !insertResolved && events.length > 1) {
      const reconciled = [{ eventId: event._id, disposition: 'already-present' }];
      for (let index = 1; index < events.length; index += 1) {
        let storedEvent;
        try {
          storedEvent = await wixData.get(CLAIM_COLLECTION, events[index]._id, READ_OPTIONS);
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
        reconciled.push({ eventId: events[index]._id, disposition: 'already-present' });
      }
      return { state: 'CONFIRMED', confirmed: reconciled };
    }
    confirmed.push({
      eventId: event._id,
      disposition: insertResolved ? 'inserted' : 'already-present'
    });
  }
  return { state: 'CONFIRMED', confirmed: confirmed };
}
