import wixData from 'wix-data';
import { syncBookingRoomCalendar } from 'backend/calendarSync';
import { reconcileOwnerBlocks } from 'backend/ownerBlocks';
import { loadOverlappingInventory, assertPropertyCapacity, assertCommittedAssignments, reconcileCommittedAssignmentUpdate } from 'backend/roomAssignments';

const ACTIVE_STATUSES = ['confirmed', 'Confirmed', 'hold', 'Hold', 'blocked', 'Blocked', 'In-House', 'in-house'];
const UNITS_BY_ROOM_CODE = {
  penthouse_apartment: [1],
  two_bedroom_apartment: [2],
  adventure_suite: [3, 4, 5],
};

function normalizeAssignedRoom(value) {
  const normalized = String(value === undefined || value === null ? '' : value)
    .trim()
    .replace(/^unit\s+/i, '');
  if (!normalized) return null;
  const unit = Number(normalized);
  return Number.isInteger(unit) ? unit : null;
}

function isActiveInventory(item) {
  const status = String(item && item.status || '').toLowerCase().trim();
  return status === 'confirmed' || status === 'hold' || status === 'blocked' || status === 'in-house';
}

async function validatePhysicalAssignment(item, excludeId) {
  if (!item || !isActiveInventory(item)) return item;
  if (Math.max(1, Number(item.quantity) || 1) !== 1) {
    throw new Error('Active guest and block rows must represent one physical room with quantity 1.');
  }
  const assignedRoom = normalizeAssignedRoom(item.assignedRoom);
  if (!assignedRoom) throw new Error('assignedRoom must be a whole-number physical unit.');
  if (!item.checkIn || !item.checkOut) throw new Error('Active inventory requires checkIn and checkOut.');

  const allowedUnits = UNITS_BY_ROOM_CODE[item.roomCode] || [];
  if (allowedUnits.indexOf(assignedRoom) === -1) {
    throw new Error('Unit ' + assignedRoom + ' cannot be assigned to ' +
      String(item.roomCode || 'this room type').replace(/_/g, ' ') + '.');
  }
  item.assignedRoom = assignedRoom;

  let query = wixData.query('Bookings')
    .eq('assignedRoom', assignedRoom)
    .hasSome('status', ACTIVE_STATUSES)
    .lt('checkIn', item.checkOut)
    .gt('checkOut', item.checkIn);
  if (excludeId) query = query.ne('_id', excludeId);
  const result = await query.limit(100).find({ suppressAuth: true, consistentRead: true });

  const realConflict = (result.items || []).find(function (row) {
    return !(row.autoOwnerBlock || item.autoOwnerBlock);
  });
  if (realConflict) {
    throw new Error('Unit ' + assignedRoom + ' is already assigned to ' +
      (realConflict.bookingNumber || 'another booking') + ' for overlapping dates.');
  }
  if (!item.autoOwnerBlock) {
    const inventoryRows = await loadOverlappingInventory(item.checkIn, item.checkOut);
    const otherRows = inventoryRows.filter(function (row) { return row._id !== excludeId; });
    assertPropertyCapacity(otherRows, item.checkIn, item.checkOut, [assignedRoom]);
  }
  return item;
}

export async function Bookings_beforeInsert(item, context) {
  return validatePhysicalAssignment(item, '');
}

export async function Bookings_afterInsert(item, context) {
  if (!item || item.deferCalendarSync) return item;
  try {
    await assertCommittedAssignments([item], item.checkIn, item.checkOut);
  } catch (error) {
    item.status = 'Cancelled';
    item.rollbackReason = error.message;
    await wixData.update('Bookings', item, { suppressAuth: true, suppressHooks: true });
    return item;
  }
  try {
    await syncBookingRoomCalendar(item);
    if (!item.autoOwnerBlock) await reconcileOwnerBlocks();
  } catch (error) {
    console.log('[WBE-CALENDAR] Bookings_afterInsert ERROR:', error && error.message || error);
  }
  return item;
}

export async function Bookings_beforeUpdate(item, context) {
  return validatePhysicalAssignment(item, item && item._id);
}

export async function Bookings_afterUpdate(item, context) {
  try {
    const losers = await reconcileCommittedAssignmentUpdate(item);
    for (const loser of losers) await syncBookingRoomCalendar(loser);
    const currentLoser = losers.find(function (loser) { return loser._id === item._id; });
    if (currentLoser) item = currentLoser;
    await syncBookingRoomCalendar(item);
    if (!item.autoOwnerBlock) await reconcileOwnerBlocks();
  } catch (error) {
    console.log('[WBE-CALENDAR] Bookings_afterUpdate ERROR:', error && error.message || error);
  }
  return item;
}

export async function Bookings_beforeRemove(itemId, context) {
  const item = await wixData.get('Bookings', itemId, { suppressAuth: true });
  if (!item || Math.max(1, Number(item.quantity) || 1) !== 1) return itemId;
  const status = String(item.status || '').toLowerCase().trim();
  const deletionComplete = item.calendarSyncStatus === 'deleted' && !item.calendarEventId;
  const neverApplicable = item.calendarSyncStatus === 'not_applicable' && !item.calendarEventId;
  if ((status !== 'cancelled' && status !== 'canceled') || (!deletionComplete && !neverApplicable)) {
    throw new Error('Cancel this room and confirm its calendar event is deleted before removing the Bookings row.');
  }
  return itemId;
}

export async function Bookings_afterRemove(item, context) {
  return item;
}
