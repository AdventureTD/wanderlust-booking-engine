import { chooseAutomaticUnits } from 'backend/roomAssignmentRules';

// Pure availability decisions over a previously built inventory snapshot.
// This module performs no reads, writes, network calls, or Wix API operations.

const MAX_QUANTITY_BY_ROOM_CODE = {
  penthouse_apartment: 1,
  two_bedroom_apartment: 1,
  adventure_suite: 3
};

function availabilityQuantity(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= 3 ? value : null;
  }
  if (typeof value === 'string' && /^[1-3]$/.test(value)) return Number(value);
  return null;
}

function isSupportedRoomCode(value) {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(MAX_QUANTITY_BY_ROOM_CODE, value);
}

function validUnitList(units) {
  if (!Array.isArray(units)) return false;
  for (let index = 0; index < units.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(units, index)) return false;
    const unit = units[index];
    if (!Number.isInteger(unit) || unit < 1 || unit > 5 ||
      (index > 0 && units[index - 1] >= unit)) return false;
  }
  return true;
}

function validNightKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function projectionMatches(snapshot) {
  if (!validUnitList(snapshot.occupiedUnits)) return false;
  const nights = Object.keys(snapshot.occupiedUnitsByNight).sort();
  if (!nights.length) return false;
  for (let index = 0; index < nights.length; index++) {
    if (!validNightKey(nights[index])) return false;
    if (index > 0) {
      const previous = new Date(nights[index - 1] + 'T00:00:00.000Z');
      const current = new Date(nights[index] + 'T00:00:00.000Z');
      if (current.getTime() - previous.getTime() !== 86400000) return false;
    }
  }
  const union = [];
  for (const night of nights) {
    const units = snapshot.occupiedUnitsByNight[night];
    if (!validUnitList(units)) return false;
    for (const unit of units) {
      if (union.indexOf(unit) === -1) union.push(unit);
    }
  }
  union.sort(function(a, b) { return a - b; });
  if (union.length !== snapshot.occupiedUnits.length) return false;
  return union.every(function(unit, index) { return unit === snapshot.occupiedUnits[index]; });
}

export function evaluateAutomaticAvailability(snapshot, roomCode, quantity) {
  const requiredFields = [
    'occupiedUnits', 'occupiedUnitsByNight', 'migrationIssueRows',
    'duplicateUnitClaims', 'unknownStatusRows'
  ];
  const hasRequiredFields = snapshot && requiredFields.every(function(field) {
    return Object.prototype.hasOwnProperty.call(snapshot, field);
  });
  const validSnapshot = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) &&
    hasRequiredFields &&
    Array.isArray(snapshot.occupiedUnits) &&
    snapshot.occupiedUnitsByNight && typeof snapshot.occupiedUnitsByNight === 'object' &&
    !Array.isArray(snapshot.occupiedUnitsByNight) &&
    Array.isArray(snapshot.migrationIssueRows) &&
    Array.isArray(snapshot.duplicateUnitClaims) &&
    Array.isArray(snapshot.unknownStatusRows);
  if (!validSnapshot || !projectionMatches(snapshot)) {
    throw new Error('Invalid inventory snapshot');
  }
  if (!isSupportedRoomCode(roomCode)) {
    throw new Error('Invalid room code');
  }
  const requestedQuantity = availabilityQuantity(quantity);
  if (requestedQuantity === null || requestedQuantity > MAX_QUANTITY_BY_ROOM_CODE[roomCode]) {
    throw new Error('Invalid room quantity');
  }
  if (snapshot && Array.isArray(snapshot.migrationIssueRows) && snapshot.migrationIssueRows.length) {
    throw new Error('Inventory migration required');
  }
  if (snapshot && Array.isArray(snapshot.duplicateUnitClaims) && snapshot.duplicateUnitClaims.length) {
    throw new Error('Inventory conflict review required');
  }
  if (snapshot && Array.isArray(snapshot.unknownStatusRows) && snapshot.unknownStatusRows.length) {
    throw new Error('Inventory status review required');
  }
  const occupiedUnits = snapshot && Array.isArray(snapshot.occupiedUnits)
    ? snapshot.occupiedUnits
    : [];
  const units = chooseAutomaticUnits(roomCode, requestedQuantity, occupiedUnits);
  if (units.length !== requestedQuantity) {
    return { available: false, units: [], reason: 'physical_units_unavailable' };
  }
  const nights = snapshot && snapshot.occupiedUnitsByNight;
  for (const night of Object.keys(nights || {})) {
    const guestUnits = Array.isArray(nights[night]) ? nights[night].slice() : [];
    for (const unit of units) {
      if (guestUnits.indexOf(unit) === -1) guestUnits.push(unit);
    }
    if (guestUnits.length > 4) {
      return { available: false, units: [], reason: 'owner_reserve_capacity' };
    }
  }
  return { available: units.length === requestedQuantity, units: units };
}

export function maximumAutomaticQuantity(snapshot, roomCode) {
  if (!isSupportedRoomCode(roomCode)) {
    throw new Error('Invalid room code');
  }
  for (let quantity = MAX_QUANTITY_BY_ROOM_CODE[roomCode]; quantity >= 1; quantity--) {
    const result = evaluateAutomaticAvailability(snapshot, roomCode, quantity);
    if (result.available) return quantity;
  }
  return 0;
}
