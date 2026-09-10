import { loadInventorySnapshot } from 'backend/roomInventory';
import { maximumAutomaticQuantity } from 'backend/roomAvailabilityRules';

// Backend-only read composition. This module exposes no web method and performs no writes.
const ROOM_CODES = [
  'penthouse_apartment',
  'two_bedroom_apartment',
  'adventure_suite'
];

export async function loadRoomAvailability(checkIn, checkOut) {
  const snapshot = await loadInventorySnapshot(checkIn, checkOut);
  return availabilityRows(snapshot);
}

// Backend-only, invocation-owned observation. Never expose the snapshot to a
// caller or cache it between requests. Validate the complete request first:
// projecting a smaller interval must not conceal migration/status/conflict errors.
export async function loadRoomAvailabilityWindowReader(checkIn, checkOut) {
  const snapshot = await loadInventorySnapshot(checkIn, checkOut);
  availabilityRows(snapshot);
  const nights = Object.keys(snapshot.occupiedUnitsByNight).sort();
  const startDay = Date.parse(nights[0] + 'T00:00:00.000Z');
  const endDay = Date.parse(nights[nights.length - 1] + 'T00:00:00.000Z') + 86400000;
  return function(start, end) {
    // Search supplies detached native Dates; this backend-only closure is not
    // an alternate public date parser.
    if (!(start instanceof Date) || !(end instanceof Date)) throw new Error('Invalid inventory window');
    const first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    if (!Number.isFinite(first) || !Number.isFinite(last) || first < startDay || last > endDay || last <= first) {
      throw new Error('Invalid inventory window');
    }
    const occupiedUnitsByNight = {};
    const occupiedUnits = [];
    for (let day = first; day < last; day += 86400000) {
      const key = new Date(day).toISOString().slice(0, 10);
      const units = snapshot.occupiedUnitsByNight[key].slice();
      occupiedUnitsByNight[key] = units;
      for (const unit of units) {
        if (occupiedUnits.indexOf(unit) === -1) occupiedUnits.push(unit);
      }
    }
    occupiedUnits.sort(function(a, b) { return a - b; });
    return availabilityRows({
      occupiedUnits: occupiedUnits,
      occupiedUnitsByNight: occupiedUnitsByNight,
      migrationIssueRows: snapshot.migrationIssueRows.slice(),
      duplicateUnitClaims: snapshot.duplicateUnitClaims.slice(),
      unknownStatusRows: snapshot.unknownStatusRows.slice()
    });
  };
}

function availabilityRows(snapshot) {
  return ROOM_CODES.map(function(roomCode) {
    const maxQuantity = maximumAutomaticQuantity(snapshot, roomCode);
    return {
      roomCode: roomCode,
      available: maxQuantity > 0,
      maxQuantity: maxQuantity
    };
  });
}
