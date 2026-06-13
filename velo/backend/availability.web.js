/*
 * Wanderlust Booking Engine — Velo backend: availability & overbooking.
 * File location in Wix Editor: backend/availability.web.js
 *
 * Uses Wix Data (wix-data) to query the Bookings collection. Mirrors the tested
 * Python availability engine. The half-open interval rule is identical:
 *   a booking occupies nights [checkIn, checkOut)
 *   two bookings conflict iff  a.checkIn < b.checkOut && b.checkIn < a.checkOut
 *   => same-day turnover (checkout == next checkin) is allowed.
 *
 * .web.js = Velo web module: these exported functions are callable from the
 * frontend but EXECUTE ON THE SERVER, so guests cannot tamper with availability.
 *
 * UPDATED 2026-06-05: blocked bookings now count against inventory.
 *   - overlappingCount sums the `quantity` field (default 1).
 *   - 'blocked' added to the active-status set.
 */

import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';
import { ROOM_UNITS, ROOM_MAX_OCCUPANCY, ROOM_MIN_OCCUPANCY } from 'backend/wbeConfig';
import { generateAndStoreInvoice } from 'backend/invoiceService';

const BOOKINGS = 'Bookings';

async function getNextBookingNumber() {
  return "";
}

function nightsBetween(checkIn, checkOut) {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// Count how many units are occupied (confirmed/hold/blocked) for a room type
// over the requested date range. We MUST use .find() here (not .count()) because
// each row has a `quantity` field and we need to sum them.
async function overlappingCount(roomCode, checkIn, checkOut) {
  const res = await wixData.query(BOOKINGS)
    .eq('roomCode', roomCode)
    .hasSome('status', ['confirmed', 'hold', 'blocked'])
    .lt('checkIn', new Date(checkOut))
    .gt('checkOut', new Date(checkIn))
    .limit(1000)
    .find();

  let total = 0;
  for (const row of res.items) {
    total += (row.quantity || 1);
  }
  return total;
}

// Same as overlappingCount but returns the ROWS so callers can inspect them
// (used for conflict-detection before creating a block).
async function overlappingRows(roomCode, checkIn, checkOut) {
  const res = await wixData.query(BOOKINGS)
    .eq('roomCode', roomCode)
    .hasSome('status', ['confirmed', 'hold', 'blocked'])
    .lt('checkIn', new Date(checkOut))
    .gt('checkOut', new Date(checkIn))
    .limit(1000)
    .find();
  return res.items;
}

export const isAvailable = webMethod(
  Permissions.Anyone,
  async (roomCode, checkIn, checkOut) => {
    if (!(roomCode in ROOM_UNITS)) {
      throw new Error(`Unknown room type '${roomCode}'`);
    }
    if (nightsBetween(checkIn, checkOut) <= 0) {
      throw new Error('checkOut must be after checkIn');
    }
    const booked = await overlappingCount(roomCode, checkIn, checkOut);
    return booked < ROOM_UNITS[roomCode];
  }
);

export const unitsAvailable = webMethod(
  Permissions.Anyone,
  async (roomCode, checkIn, checkOut) => {
    if (!(roomCode in ROOM_UNITS)) throw new Error(`Unknown room type '${roomCode}'`);
    const booked = await overlappingCount(roomCode, checkIn, checkOut);
    return Math.max(0, ROOM_UNITS[roomCode] - booked);
  }
);

/*
 * Create a booking, refusing it if it would overbook the room type.
 * NOTE on race conditions: two simultaneous requests could both pass the
 * availability check and then both insert. Wix Data has no multi-row
 * transaction, so we re-check immediately AFTER insert and roll back if we
 * exceeded inventory. This is the standard Velo pattern for this problem.
 */
export const createBooking = webMethod(
  Permissions.Anyone,
  async (booking) => {
    console.log('>>> SERVER createBooking called:', JSON.stringify(booking).substring(0,200));
    const { roomCode, checkIn, checkOut, guests = 1,
      guestName, guestEmail, guestPhone,
      roomTotal, accomodationVat, packageVat, propertyFee,
      grandTotal, note, bookingNumber, country } = booking;

    console.log('>>> SERVER roomCode:', roomCode, 'checkIn:', checkIn, 'checkOut:', checkOut, 'guests:', guests);
    if (!(roomCode in ROOM_UNITS)) throw new Error(`Unknown room type '${roomCode}'`);
    if (nightsBetween(checkIn, checkOut) <= 0) throw new Error('checkOut must be after checkIn');
    if (guests < ROOM_MIN_OCCUPANCY[roomCode]) {
      throw new Error(`${roomCode} requires at least ${ROOM_MIN_OCCUPANCY[roomCode]} guests `
        + `(no single-guest bookings); requested ${guests}`);
    }
    if (guests > ROOM_MAX_OCCUPANCY[roomCode]) {
      throw new Error(`${roomCode} sleeps ${ROOM_MAX_OCCUPANCY[roomCode]}; requested ${guests}`);
    }

    const available = await isAvailable(roomCode, checkIn, checkOut);
    if (!available) {
      throw new Error(`No ${roomCode} available for ${checkIn} to ${checkOut}`);
    }

    const toInsert = {
      roomCode,
      checkIn: new Date(checkIn),
      checkOut: new Date(checkOut),
      guests,
      status: booking.status || 'confirmed',
      quantity: 1,
      packages: booking.packages || [],
      alaCarte: booking.alaCarte || [],
      guestName: guestName || '',
      guestEmail: guestEmail || '',
      guestPhone: guestPhone || '',
      roomTotal: roomTotal || 0,
      propertyFee: propertyFee || 0,
      accomodationVat: accomodationVat || 0,
      packageVat: packageVat || 0,
      grandTotal: grandTotal || 0,
      bookingNumber: bookingNumber || await getNextBookingNumber(),
      country: country || '',
      note: note || '',
    };
    const inserted = await wixData.insert(BOOKINGS, toInsert);

    // Post-insert safety re-check (race-condition guard).
    const countNow = await overlappingCount(roomCode, checkIn, checkOut);
    if (countNow > ROOM_UNITS[roomCode]) {
      await wixData.remove(BOOKINGS, inserted._id);
      throw new Error(`Booking conflict — ${roomCode} was just taken. Please retry.`);
    }

    // Generate invoice PDF and store on the booking row (non-blocking — booking succeeds even if invoice fails).
    try {
      await generateAndStoreInvoice(inserted._id);
      console.log('>>> SERVER invoice generated for', inserted.bookingNumber);
    } catch (e) {
      console.log('>>> SERVER invoice generation failed for', inserted.bookingNumber, ':', e.message);
    }

    return inserted;
  }
);

// Admin-only: guests cannot self-cancel (they contact the hotel). This prevents
// anyone with a booking ID from cancelling someone else's reservation.
export const cancelBooking = webMethod(
  Permissions.Admin,
  async (bookingId) => {
    const b = await wixData.get(BOOKINGS, bookingId);
    if (!b) throw new Error(`No booking ${bookingId}`);
    b.status = 'Cancelled';
    return wixData.update(BOOKINGS, b);
  }
);

// ============================================================================
// BLOCKING (admin only)
// ============================================================================

/*
 * blockRoom(roomCode, checkIn, checkOut, quantity, note)
 *   Blocks `quantity` units of a room type for the date range.
 *   If existing bookings overlap, the block is REDUCED to what fits (never
 *   overriding guests). Returns { booking, warnings }.
 *   Raises if zero units can be blocked.
 */
export const blockRoom = webMethod(
  Permissions.Admin,
  async (roomCode, checkIn, checkOut, quantity = 1, note = '') => {
    if (!(roomCode in ROOM_UNITS)) throw new Error(`Unknown room type '${roomCode}'`);
    if (nightsBetween(checkIn, checkOut) <= 0) throw new Error('checkOut must be after checkIn');
    if (quantity < 1) throw new Error('quantity must be >= 1');

    // Find the minimum free units across the whole range.
    let minFree = ROOM_UNITS[roomCode];
    const rows = await overlappingRows(roomCode, checkIn, checkOut);
    const nights = nightsBetween(checkIn, checkOut);
    for (let d = 0; d < nights; d++) {
      const probe = new Date(checkIn);
      probe.setDate(probe.getDate() + d);
      let bookedThatNight = 0;
      for (const row of rows) {
        if (new Date(row.checkIn) <= probe && probe < new Date(row.checkOut)) {
          bookedThatNight += (row.quantity || 1);
        }
      }
      minFree = Math.min(minFree, ROOM_UNITS[roomCode] - bookedThatNight);
    }

    const actual = Math.min(quantity, minFree);
    const warnings = [];
    if (actual < quantity) {
      warnings.push(
        `${roomCode}: requested ${quantity} unit(s) blocked, but only ${actual} available ` +
        `for the full range (${checkIn} to ${checkOut}). Reduced to ${actual}.`
      );
    }
    if (actual < 1) {
      throw new Error(
        `Cannot block ${roomCode}: all units already booked for the requested period ` +
        `(${checkIn} to ${checkOut}).`
      );
    }

    const toInsert = {
      roomCode,
      checkIn: new Date(checkIn),
      checkOut: new Date(checkOut),
      guests: 1,
      status: 'blocked',
      quantity: actual,
      note,
    };
    const inserted = await wixData.insert(BOOKINGS, toInsert);
    return { booking: inserted, warnings };
  }
);

/*
 * unblock(bookingId) — remove a blocked entry.
 */
export const unblock = webMethod(
  Permissions.Admin,
  async (bookingId) => {
    const b = await wixData.get(BOOKINGS, bookingId);
    if (!b) throw new Error(`No booking ${bookingId}`);
    if (b.status !== 'blocked') throw new Error(`Booking ${bookingId} is not a block (status=${b.status})`);
    await wixData.remove(BOOKINGS, bookingId);
    return b;
  }
);

/*
 * blockAllRooms(checkIn, checkOut, note) — hotel closure.
 * Creates one block per room type, consuming the FULL unit count (or whatever
 * fits after accounting for existing bookings).
 * Returns a list of { roomCode, booking, warnings }.
 */
export const blockAllRooms = webMethod(
  Permissions.Admin,
  async (checkIn, checkOut, note = '') => {
    const results = [];
    for (const roomCode of Object.keys(ROOM_UNITS)) {
      try {
        const { booking, warnings } = await blockRoom(roomCode, checkIn, checkOut, ROOM_UNITS[roomCode], note);
        results.push({ roomCode, booking, warnings });
      } catch (e) {
        results.push({ roomCode, booking: null, warnings: [e.message] });
      }
    }
    return results;
  }
);

/*
 * listBlocks(roomCode) — return all blocked bookings, optionally filtered.
 */
export const listBlocks = webMethod(
  Permissions.Admin,
  async (roomCode = null) => {
    let q = wixData.query(BOOKINGS).eq('status', 'blocked').limit(1000);
    if (roomCode) q = q.eq('roomCode', roomCode);
    const res = await q.find();
    return res.items;
  }
);
