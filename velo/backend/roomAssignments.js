import wixData from 'wix-data';
import { chooseAutomaticUnits, roomCodeForUnit } from 'backend/roomAssignmentRules';
import { findAll } from 'backend/wixDataPaging';

const ACTIVE_STATUSES = ['confirmed', 'Confirmed', 'hold', 'Hold', 'blocked', 'Blocked', 'In-House', 'in-house'];
const MAX_GUEST_OR_MANUAL_UNITS = 4;

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return date.getUTCFullYear() + '-' +
    String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(date.getUTCDate()).padStart(2, '0');
}

function nightsBetween(start, end) {
  const nights = [];
  for (let day = new Date(start); day < end; day.setUTCDate(day.getUTCDate() + 1)) {
    nights.push(dateKey(day));
  }
  return nights;
}

function rowOccupiesNight(row, nightKey) {
  const start = toDate(row.checkIn);
  const end = toDate(row.checkOut);
  if (!start || !end) return false;
  return dateKey(start) <= nightKey && nightKey < dateKey(end);
}

function normalizedUnit(row) {
  const unit = Number(row && row.assignedRoom);
  return Number.isInteger(unit) && unit >= 1 && unit <= 5 ? unit : null;
}

export async function loadOverlappingInventory(checkIn, checkOut) {
  const start = toDate(checkIn);
  const end = toDate(checkOut);
  if (!start || !end || end <= start) throw new Error('Invalid inventory dates');
  const items = await findAll(wixData.query('Bookings')
    .hasSome('status', ACTIVE_STATUSES)
    .lt('checkIn', end)
    .gt('checkOut', start), { suppressAuth: true, consistentRead: true });
  return items;
}

export async function assertInventoryMigrationReady() {
  const today = new Date();
  const rows = await findAll(wixData.query('Bookings')
    .hasSome('status', ACTIVE_STATUSES)
    .gt('checkOut', today), { suppressAuth: true, consistentRead: true });
  const invalid = rows.filter(function (row) {
    return row.autoOwnerBlock !== true &&
      (Math.max(1, Number(row.quantity) || 1) !== 1 || !normalizedUnit(row));
  });
  if (invalid.length) {
    throw new Error('Inventory migration required before accepting bookings. Active row IDs: ' +
      invalid.slice(0, 10).map(function (row) { return row._id; }).join(', '));
  }
  return true;
}

export function assertPropertyCapacity(rows, checkIn, checkOut, proposedUnits) {
  const start = toDate(checkIn);
  const end = toDate(checkOut);
  const proposed = (proposedUnits || []).map(Number);
  for (const night of nightsBetween(start, end)) {
    const occupied = [];
    let legacyUnassigned = 0;
    for (const row of (rows || [])) {
      if (row.autoOwnerBlock || !rowOccupiesNight(row, night)) continue;
      const unit = normalizedUnit(row);
      if (unit) {
        if (occupied.indexOf(unit) === -1) occupied.push(unit);
      } else {
        legacyUnassigned += Math.max(1, Number(row.quantity) || 1);
      }
    }
    for (const unit of proposed) {
      if (occupied.indexOf(unit) !== -1) {
        throw new Error('Unit ' + unit + ' is already occupied on ' + night + '.');
      }
      occupied.push(unit);
    }
    if (occupied.length + legacyUnassigned > MAX_GUEST_OR_MANUAL_UNITS) {
      throw new Error('At least one room must remain available for the owners on ' + night + '.');
    }
  }
}

export async function planAutomaticAssignments(roomCode, quantity, checkIn, checkOut) {
  const rows = await loadOverlappingInventory(checkIn, checkOut);
  const unmigrated = rows.find(function (row) {
    return !row.autoOwnerBlock && (Math.max(1, Number(row.quantity) || 1) !== 1 || !normalizedUnit(row));
  });
  if (unmigrated) throw new Error('Inventory migration required for active row ' + unmigrated._id);
  const unavailable = [];
  for (const row of rows) {
    if (row.autoOwnerBlock) continue;
    const unit = normalizedUnit(row);
    if (unit && unavailable.indexOf(unit) === -1) unavailable.push(unit);
  }
  const units = chooseAutomaticUnits(roomCode, quantity, unavailable);
  if (units.length !== Math.max(1, Number(quantity) || 1)) {
    throw new Error('No permitted physical ' + String(roomCode || 'room').replace(/_/g, ' ') +
      ' assignment is available for the entire stay.');
  }
  for (const unit of units) {
    if (roomCodeForUnit(unit) !== roomCode) throw new Error('Invalid physical-room assignment');
  }
  assertPropertyCapacity(rows, checkIn, checkOut, units);
  return units;
}

export async function maxAutomaticQuantity(roomCode, checkIn, checkOut) {
  const maximum = roomCode === 'adventure_suite' ? 3 : 1;
  for (let quantity = maximum; quantity >= 1; quantity--) {
    try {
      const units = await planAutomaticAssignments(roomCode, quantity, checkIn, checkOut);
      if (units.length === quantity) return quantity;
    } catch (error) {}
  }
  return 0;
}

export async function planManualBlockAssignments(roomCode, quantity, checkIn, checkOut) {
  const rows = await loadOverlappingInventory(checkIn, checkOut);
  const unavailable = rows.filter(function (row) { return !row.autoOwnerBlock; })
    .map(normalizedUnit).filter(Boolean);
  const candidates = roomCode === 'penthouse_apartment' ? [1]
    : (roomCode === 'two_bedroom_apartment' ? [2] : [3, 4, 5]);
  const available = candidates.filter(function (unit) { return unavailable.indexOf(unit) === -1; });
  const qty = Math.max(1, Number(quantity) || 1);
  const units = available.slice(0, qty);
  if (units.length !== qty) throw new Error('Not enough physical units are available to create this block.');
  assertPropertyCapacity(rows, checkIn, checkOut, units);
  return units;
}

function claimPriority(row) {
  const created = row && row._createdDate ? new Date(row._createdDate).toISOString() : '9999';
  return created + '|' + String(row && row._id || '');
}

export async function assertCommittedAssignments(insertedRows, checkIn, checkOut) {
  const rows = await loadOverlappingInventory(checkIn, checkOut);
  assertPropertyCapacity(rows, checkIn, checkOut, []);
  for (const inserted of (insertedRows || [])) {
    const unit = normalizedUnit(inserted);
    if (!unit) throw new Error('Committed physical room is missing assignedRoom');
    const insertedStart = toDate(inserted.checkIn);
    const insertedEnd = toDate(inserted.checkOut);
    const claims = rows.filter(function (row) {
      const rowStart = toDate(row.checkIn);
      const rowEnd = toDate(row.checkOut);
      return !row.autoOwnerBlock && normalizedUnit(row) === unit &&
        rowStart && rowEnd && insertedStart && insertedEnd &&
        rowStart < insertedEnd && rowEnd > insertedStart;
    }).sort(function (a, b) {
      return claimPriority(a).localeCompare(claimPriority(b));
    });
    if (claims.length > 1 && claims[0]._id !== inserted._id) {
      throw new Error('Physical Unit ' + unit + ' was assigned concurrently to another booking.');
    }
  }
  return true;
}

export async function reconcileCommittedAssignmentUpdate(item) {
  if (!item || item.autoOwnerBlock || !normalizedUnit(item)) return [];
  const rows = await loadOverlappingInventory(item.checkIn, item.checkOut);
  const losers = [];

  try {
    assertPropertyCapacity(rows, item.checkIn, item.checkOut, []);
  } catch (error) {
    losers.push(item);
  }

  const unit = normalizedUnit(item);
  const itemStart = toDate(item.checkIn);
  const itemEnd = toDate(item.checkOut);
  const claims = rows.filter(function (row) {
    const rowStart = toDate(row.checkIn);
    const rowEnd = toDate(row.checkOut);
    return !row.autoOwnerBlock && normalizedUnit(row) === unit && rowStart && rowEnd &&
      itemStart && itemEnd && rowStart < itemEnd && rowEnd > itemStart;
  }).sort(function (a, b) {
    return claimPriority(a).localeCompare(claimPriority(b));
  });
  if (claims.length > 1) losers.push.apply(losers, claims.slice(1));

  const unique = {};
  const updatedLosers = [];
  for (const loser of losers) {
    if (!loser || unique[loser._id]) continue;
    unique[loser._id] = true;
    const updated = Object.assign({}, loser, {
      assignedRoom: null,
      status: 'Pending Confirmation',
      rollbackReason: 'Concurrent physical-room assignment conflict requires administrator review',
      calendarSyncStatus: 'pending',
      calendarNextRetryAt: null,
    });
    updatedLosers.push(await wixData.update('Bookings', updated, { suppressAuth: true, suppressHooks: true }));
  }
  return updatedLosers;
}

export async function validateAssignmentDateChange(bookingRows, checkIn, checkOut) {
  const ownIds = (bookingRows || []).map(function (row) { return row._id; });
  const rows = await loadOverlappingInventory(checkIn, checkOut);
  const others = rows.filter(function (row) { return ownIds.indexOf(row._id) === -1; });
  const proposedUnits = [];
  for (const room of (bookingRows || [])) {
    const unit = normalizedUnit(room);
    if (!unit) throw new Error('Booking row ' + room._id + ' is missing a physical-room assignment');
    const conflict = others.find(function (other) {
      return !other.autoOwnerBlock && normalizedUnit(other) === unit;
    });
    if (conflict) throw new Error('Unit ' + unit + ' is occupied by ' + (conflict.bookingNumber || conflict._id));
    proposedUnits.push(unit);
  }
  assertPropertyCapacity(others, checkIn, checkOut, proposedUnits);
  return true;
}
