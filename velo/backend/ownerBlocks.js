import wixData from 'wix-data';
import { ownerUnitForOccupiedUnits, roomCodeForUnit } from 'backend/roomAssignmentRules';
import { syncBookingRoomCalendar } from 'backend/calendarSync';
import { findAll } from 'backend/wixDataPaging';

const OCCUPANCY_STATUSES = ['confirmed', 'Confirmed', 'hold', 'Hold', 'blocked', 'Blocked', 'In-House', 'in-house'];
const OWNER_BLOCK_KIND = 'owner_auto';
const LOCKS = 'BookingLocks';
const OWNER_LOCK_ID = 'owner-block-reconcile';

async function acquireOwnerLock() {
  const ownerId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const lock = {
    _id: OWNER_LOCK_ID,
    ownerId: ownerId,
    expiresAt: new Date(Date.now() + (60 * 60 * 1000)),
  };
  try {
    await wixData.insert(LOCKS, lock, { suppressAuth: true, suppressHooks: true });
    return ownerId;
  } catch (error) {
    // Never steal automatically: Wix Data has no compare-and-swap. An expired
    // lock is removed only during an explicit administrator repair.
    return '';
  }
}

async function releaseOwnerLock(ownerId) {
  try {
    const existing = await wixData.get(LOCKS, OWNER_LOCK_ID, { suppressAuth: true });
    if (existing && existing.ownerId === ownerId) {
      await wixData.remove(LOCKS, OWNER_LOCK_ID, { suppressAuth: true, suppressHooks: true });
    }
  } catch (error) {}
}

function noonUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
}

function dateKey(date) {
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function occupies(row, night) {
  const start = new Date(row.checkIn);
  const end = new Date(row.checkOut);
  return start <= night && night < end;
}

function desiredIntervals(guestRows, start, end) {
  const intervals = [];
  let currentUnit = null;
  let currentStart = null;

  for (let night = new Date(start); night < end; night = addDays(night, 1)) {
    const occupied = [];
    for (const row of guestRows) {
      if (!occupies(row, night)) continue;
      const unit = Number(row.assignedRoom);
      if (Number.isInteger(unit) && occupied.indexOf(unit) === -1) occupied.push(unit);
    }
    const target = ownerUnitForOccupiedUnits(occupied);
    if (target !== currentUnit) {
      if (currentUnit) intervals.push({ unit: currentUnit, checkIn: currentStart, checkOut: new Date(night) });
      currentUnit = target;
      currentStart = target ? new Date(night) : null;
    }
  }
  if (currentUnit) intervals.push({ unit: currentUnit, checkIn: currentStart, checkOut: new Date(end) });
  return intervals;
}

function blockKey(interval) {
  return 'owner:auto:' + interval.unit + ':' + dateKey(interval.checkIn) + ':' + dateKey(interval.checkOut);
}

function blockId(interval) {
  return ('owner_' + interval.unit + '_' + dateKey(interval.checkIn).replace(/-/g, '') + '_' + dateKey(interval.checkOut).replace(/-/g, '')).slice(0, 36);
}

async function activateOwnerBlock(interval, existing) {
  const key = blockKey(interval);
  const row = Object.assign({}, existing || {}, {
    _id: existing && existing._id ? existing._id : blockId(interval),
    bookingNumber: key,
    roomCode: roomCodeForUnit(interval.unit),
    assignedRoom: interval.unit,
    checkIn: noonUtc(interval.checkIn),
    checkOut: noonUtc(interval.checkOut),
    guests: 0,
    quantity: 1,
    status: 'blocked',
    inventoryKind: OWNER_BLOCK_KIND,
    autoOwnerBlock: true,
    ownerBlockKey: key,
    note: 'Owner Block',
  });

  let saved;
  try {
    saved = existing
      ? await wixData.update('Bookings', row, { suppressAuth: true, suppressHooks: true })
      : await wixData.insert('Bookings', row, { suppressAuth: true, suppressHooks: true });
  } catch (error) {
    const duplicate = await wixData.query('Bookings').eq('ownerBlockKey', key).limit(1).find({ suppressAuth: true, consistentRead: true });
    if (!duplicate.items.length) throw error;
    saved = duplicate.items[0];
  }
  const syncResult = await syncBookingRoomCalendar(saved);
  if (!syncResult || !syncResult.ok) throw new Error(syncResult && syncResult.error || 'Owner block calendar sync failed');
  return saved;
}

async function cancelOwnerBlock(row) {
  if (String(row.status || '').toLowerCase() !== 'cancelled') {
    row.status = 'Cancelled';
    row = await wixData.update('Bookings', row, { suppressAuth: true, suppressHooks: true });
  }
  const syncResult = await syncBookingRoomCalendar(row);
  if (!syncResult || !syncResult.ok) throw new Error(syncResult && syncResult.error || 'Owner block calendar deletion failed');
  return row;
}

async function reconcileOwnerBlocksUnlocked() {
  const now = new Date();
  const today = noonUtc(now);
  const occupancyItems = await findAll(wixData.query('Bookings')
    .hasSome('status', OCCUPANCY_STATUSES)
    .gt('checkOut', today), { suppressAuth: true, consistentRead: true });
  const occupancyRows = occupancyItems.filter(function (row) {
    return !row.autoOwnerBlock && Number.isInteger(Number(row.assignedRoom));
  });

  const existingRows = await findAll(wixData.query('Bookings')
    .eq('inventoryKind', OWNER_BLOCK_KIND)
    .gt('checkOut', today), { suppressAuth: true, consistentRead: true });

  let horizonEnd = today;
  for (const row of occupancyRows) {
    const end = new Date(row.checkOut);
    if (end > horizonEnd) horizonEnd = end;
  }
  const desired = desiredIntervals(occupancyRows, today, horizonEnd);
  const desiredKeys = desired.map(blockKey);
  const existingByKey = {};
  const duplicateRows = [];
  for (const row of existingRows) {
    if (!row.ownerBlockKey) continue;
    if (!existingByKey[row.ownerBlockKey]) {
      existingByKey[row.ownerBlockKey] = row;
    } else {
      const current = existingByKey[row.ownerBlockKey];
      const currentPriority = String(current._createdDate || '') + '|' + String(current._id || '');
      const rowPriority = String(row._createdDate || '') + '|' + String(row._id || '');
      if (rowPriority < currentPriority) {
        duplicateRows.push(current);
        existingByKey[row.ownerBlockKey] = row;
      } else {
        duplicateRows.push(row);
      }
    }
  }

  // Over-block before releasing old protection.
  for (const interval of desired) {
    await activateOwnerBlock(interval, existingByKey[blockKey(interval)] || null);
  }
  for (const duplicate of duplicateRows) await cancelOwnerBlock(duplicate);
  for (const row of existingRows) {
    if (duplicateRows.some(function (duplicate) { return duplicate._id === row._id; })) continue;
    if (desiredKeys.indexOf(row.ownerBlockKey) === -1) await cancelOwnerBlock(row);
  }
  return { ok: true, desired: desiredKeys.length };
}

export async function reconcileOwnerBlocks() {
  const ownerId = await acquireOwnerLock();
  if (!ownerId) throw new Error('Owner block reconciliation is already running');
  try {
    return await reconcileOwnerBlocksUnlocked();
  } finally {
    await releaseOwnerLock(ownerId);
  }
}
