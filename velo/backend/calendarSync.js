import wixData from 'wix-data';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';

const BOOKINGS = 'Bookings';
const BOOKING_SUMMARIES = 'BookingSummary';
const INVOICE_SERVICE_URL_KEY = 'WBE_INVOICE_SERVICE_URL';
const SHARED_SECRET_KEY = 'WBE_SHARED_SECRET';

function isoDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

async function saveSyncState(room, changes) {
  if (!room || !room._id) return;
  const current = await wixData.get(BOOKINGS, room._id, { suppressAuth: true });
  if (!current) return;
  const updated = Object.assign({}, current, changes);
  await wixData.update(BOOKINGS, updated, {
    suppressAuth: true,
    suppressHooks: true,
  });
}

async function getSummary(bookingNumber) {
  if (!bookingNumber) return null;
  const result = await wixData.query(BOOKING_SUMMARIES)
    .eq('bookingNumber', bookingNumber)
    .limit(1)
    .find({ suppressAuth: true });
  return result.items[0] || null;
}

export async function syncBookingRoomCalendar(room, summaryOverride, options) {
  if (!room || !room._id) return { ok: false, skipped: true, reason: 'Missing booking row' };
  const persistState = !(options && options.removed);
  async function recordSyncState(changes) {
    if (persistState) await saveSyncState(room, changes);
  }

  const quantity = Math.max(1, Number(room.quantity) || 1);
  const status = String(room.status || '').toLowerCase().trim();
  if (quantity !== 1) {
    await recordSyncState({
      calendarSyncStatus: 'not_applicable',
      calendarSyncError: '',
    });
    return { ok: true, skipped: true, reason: 'Not a single physical guest room' };
  }

  const summary = summaryOverride || await getSummary(room.bookingNumber);
  const blockedLabel = room.autoOwnerBlock
    ? 'Owner Block'
    : ('Blocked' + (room.note ? ': ' + room.note : ''));
  const guestName = status === 'blocked'
    ? blockedLabel
    : (summary && summary.guestName ? summary.guestName : (room.guestName || 'Guest'));
  const checkIn = isoDate(room.checkIn || (summary && summary.checkIn));
  const checkOut = isoDate(room.checkOut || (summary && summary.checkOut));

  if (!room.bookingNumber || !room.roomCode || !checkIn || !checkOut) {
    const message = 'Missing bookingNumber, roomCode, checkIn, or checkOut';
    await recordSyncState({
      calendarSyncStatus: 'error',
      calendarSyncError: message,
    });
    return { ok: false, error: message };
  }

  await recordSyncState({
    calendarSyncStatus: 'pending',
    calendarSyncError: '',
  });

  try {
    const serviceUrl = await getSecret(INVOICE_SERVICE_URL_KEY);
    const secret = await getSecret(SHARED_SECRET_KEY);
    if (!serviceUrl || !secret) throw new Error('Invoice service calendar sync is not configured');

    const response = await fetch(serviceUrl + '/sync-calendar-room', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'X-WBE-Secret': secret,
      },
      body: JSON.stringify({
        booking_id: room._id,
        booking_number: room.bookingNumber,
        guest_name: guestName,
        room_code: room.roomCode,
        assigned_room: room.assignedRoom === undefined || room.assignedRoom === null ? '' : String(room.assignedRoom),
        check_in: checkIn,
        check_out: checkOut,
        status: room.status || 'confirmed',
        event_id: room.calendarEventId || '',
        updated_at: room._updatedDate ? new Date(room._updatedDate).toISOString() : '',
      }),
    });

    const result = await response.json();
    if (!response.ok || !result || !result.ok) {
      throw new Error((result && (result.error || result.detail)) || ('Calendar sync failed with HTTP ' + response.status));
    }

    const eventId = result.eventId || '';
    const roomStatus = String(room.status || '').toLowerCase().trim();
    const deletionComplete = roomStatus === 'cancelled' || roomStatus === 'canceled';
    await recordSyncState({
      calendarEventId: eventId,
      calendarSyncStatus: deletionComplete || result.status === 'deleted' ? 'deleted' : 'synced',
      calendarSyncError: '',
      calendarSyncedAt: new Date(),
      calendarSyncAttempts: 0,
      calendarNextRetryAt: null,
    });
    return result;
  } catch (error) {
    const message = String(error && error.message || error);
    const current = await wixData.get(BOOKINGS, room._id, { suppressAuth: true });
    const attempts = Math.max(0, Number(current && current.calendarSyncAttempts) || 0) + 1;
    const retryMinutes = Math.min(360, Math.pow(2, Math.min(attempts, 8)));
    await recordSyncState({
      calendarSyncStatus: 'error',
      calendarSyncError: message,
      calendarSyncAttempts: attempts,
      calendarNextRetryAt: new Date(Date.now() + (retryMinutes * 60 * 1000)),
    });
    console.log('[WBE-CALENDAR] room sync ERROR for', room._id, message);
    return { ok: false, error: message };
  }
}

export async function syncBookingCalendarRooms(rooms, summary) {
  const results = [];
  for (const room of (rooms || [])) {
    results.push(await syncBookingRoomCalendar(room, summary));
  }
  return results;
}
