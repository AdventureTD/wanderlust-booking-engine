/*
 * Wanderlust Booking Engine — Velo backend: availability, booking, blocking, and invoice generation.
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
 * Completely self-contained — no imports of custom backend modules.
 * Only built-in Wix modules: wix-data, wix-web-module, wix-fetch, wix-secrets-backend.
 */

import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';

const BOOKINGS = 'Bookings';
const INVOICE_SERVICE_URL_KEY = 'WBE_INVOICE_SERVICE_URL';
const SHARED_SECRET_KEY = 'WBE_SHARED_SECRET';

/* ---------- room config (inlined from wbeConfig.js) ---------- */
const ROOM_UNITS = {
  adventure_suite: 3,
  penthouse_apartment: 1,
  two_bedroom_apartment: 1,
};

const ROOM_MAX_OCCUPANCY = {
  adventure_suite: 2,
  penthouse_apartment: 2,
  two_bedroom_apartment: 4,
};

const ROOM_MIN_OCCUPANCY = {
  adventure_suite: 2,
  penthouse_apartment: 2,
  two_bedroom_apartment: 3,
};

/* ---------- helpers ---------- */
async function getNextBookingNumber() {
  return "";
}

function nightsBetween(checkIn, checkOut) {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function capitaliseWords(s) {
  return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function snakeCaseKeys(obj) {
  if (Array.isArray(obj)) return obj.map(snakeCaseKeys);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const sk = k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
      out[sk] = snakeCaseKeys(v);
    }
    return out;
  }
  return obj;
}

/* ---------- invoice service call (inlined from issueInvoice.web.js) ---------- */
async function callIssueInvoice(guest, quoteBreakdown, dates, sendEmail) {
  const serviceUrl = await getSecret(INVOICE_SERVICE_URL_KEY);
  const secret = await getSecret(SHARED_SECRET_KEY);
  if (!serviceUrl || !secret) {
    throw new Error('Invoice service not configured. Set WBE_INVOICE_SERVICE_URL and WBE_SHARED_SECRET in Secrets Manager.');
  }

  const body = {
    guest: guest,
    quote_breakdown: snakeCaseKeys(quoteBreakdown),
    issue_date: new Date().toISOString().slice(0, 10),
    check_in: dates.checkIn,
    check_out: dates.checkOut,
    room_code: Array.isArray(dates.roomCode) ? dates.roomCode.join(', ') : dates.roomCode,
    send_email: sendEmail,
  };

  const res = await fetch(serviceUrl + '/issue-invoice', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'X-WBE-Secret': secret,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('Invoice service error ' + res.status + ': ' + text);
  }

  return res.json();
}

/* ---------- quote breakdown (inlined from invoice.web.js) ---------- */
function buildQuoteBreakdown(booking) {
  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  const roomTotal = booking.roomTotal || 0;
  const propertyFee = booking.propertyFee || 0;
  const accommodationShare = 0.5;
  const taxRateAccommodation = 0.10;
  const taxRateStandard = 0.15;

  const accNet = roomTotal * accommodationShare;
  const advNet = roomTotal * (1 - accommodationShare);
  const accVat = accNet * taxRateAccommodation;
  const pkgVat = advNet * taxRateStandard;

  const accUnitPrice = nights > 0 ? accNet / nights : 0;
  const advUnitPrice = nights > 0 ? advNet / nights : 0;

  const displayName = capitaliseWords((booking.roomCode || '').replace(/_/g, ' '));

  return {
    line_items: [
      {
        label: displayName + ' — Accommodation',
        tax_class: 'accommodation',
        quantity: nights,
        unit_price: accUnitPrice,
        net: accNet,
        vat_rate: taxRateAccommodation,
        vat: accVat,
        gross: accNet + accVat
      },
      {
        label: displayName + ' — Activities & Services',
        tax_class: 'standard',
        quantity: nights,
        unit_price: advUnitPrice,
        net: advNet,
        vat_rate: taxRateStandard,
        vat: pkgVat,
        gross: advNet + pkgVat
      }
    ],
    subtotal_net: roomTotal,
    total_vat: Math.round((accVat + pkgVat + Number.EPSILON) * 100) / 100,
    total: roomTotal + propertyFee + accVat + pkgVat,
    property_fee_rate: roomTotal > 0 ? propertyFee / roomTotal : 0,
    property_fee: propertyFee,
    currency: 'USD'
  };
}

async function generateAndStoreInvoice(bookingId) {
  console.log('>>> INVOICE generate called for bookingId:', bookingId);

  const booking = await wixData.get(BOOKINGS, bookingId);
  if (!booking) throw new Error('Booking ' + bookingId + ' not found');

  const quoteBreakdown = buildQuoteBreakdown(booking);
  console.log('>>> INVOICE quote total:', quoteBreakdown.total);

  const guest = {
    name: booking.guestName || '',
    email: booking.guestEmail || '',
    phone: booking.guestPhone || ''
  };
  const dates = {
    checkIn: booking.checkIn.toISOString().slice(0, 10),
    checkOut: booking.checkOut.toISOString().slice(0, 10),
    roomCode: booking.roomCode || ''
  };

  let result;
  try {
    result = await callIssueInvoice(guest, quoteBreakdown, dates, true);
    console.log('>>> INVOICE service returned number:', result.invoice_number);
  } catch (e) {
    console.log('>>> INVOICE callIssueInvoice ERROR:', e.message);
    throw new Error('Invoice generation failed: ' + e.message);
  }

  // Store invoice number in bookingNumber field (minimal update pattern)
  const updateObj = {
    _id: booking._id,
    bookingNumber: result.invoice_number
  };
  try {
    await wixData.save(BOOKINGS, updateObj);
    console.log('>>> INVOICE booking save SUCCESS with', result.invoice_number);
  } catch (err) {
    console.log('>>> INVOICE wixData.save FAILED:', err.message);
  }

  return {
    invoiceNumber: result.invoice_number,
    total: result.total,
    emailed: result.emailed || false
  };
}

/* ---------- availability helpers ---------- */
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

/* ---------- exported methods ---------- */
export const isAvailable = webMethod(
  Permissions.Anyone,
  async (roomCode, checkIn, checkOut) => {
    if (!(roomCode in ROOM_UNITS)) {
      throw new Error('Unknown room type \'' + roomCode + '\'');
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
    if (!(roomCode in ROOM_UNITS)) throw new Error('Unknown room type \'' + roomCode + '\'');
    const booked = await overlappingCount(roomCode, checkIn, checkOut);
    return Math.max(0, ROOM_UNITS[roomCode] - booked);
  }
);

export const createBooking = webMethod(
  Permissions.Anyone,
  async (booking) => {
    console.log('>>> SERVER createBooking called:', JSON.stringify(booking).substring(0,200));
    const roomCode = booking.roomCode;
    const checkIn = booking.checkIn;
    const checkOut = booking.checkOut;
    const guests = booking.guests || 1;
    const guestName = booking.guestName;
    const guestEmail = booking.guestEmail;
    const guestPhone = booking.guestPhone;
    const roomTotal = booking.roomTotal;
    const accomodationVat = booking.accomodationVat;
    const packageVat = booking.packageVat;
    const propertyFee = booking.propertyFee;
    const grandTotal = booking.grandTotal;
    const note = booking.note;
    let saveNote = note;
    const bookingNumber = booking.bookingNumber;
    const country = booking.country;

    console.log('>>> SERVER roomCode:', roomCode, 'checkIn:', checkIn, 'checkOut:', checkOut, 'guests:', guests);
    if (!(roomCode in ROOM_UNITS)) throw new Error('Unknown room type \'' + roomCode + '\'');
    if (nightsBetween(checkIn, checkOut) <= 0) throw new Error('checkOut must be after checkIn');
    if (guests < ROOM_MIN_OCCUPANCY[roomCode]) {
      throw new Error(roomCode + ' requires at least ' + ROOM_MIN_OCCUPANCY[roomCode] + ' guests (no single-guest bookings); requested ' + guests);
    }
    if (guests > ROOM_MAX_OCCUPANCY[roomCode]) {
      throw new Error(roomCode + ' sleeps ' + ROOM_MAX_OCCUPANCY[roomCode] + '; requested ' + guests);
    }

    const available = await isAvailable(roomCode, checkIn, checkOut);
    if (!available) {
      throw new Error('No ' + roomCode + ' available for ' + checkIn + ' to ' + checkOut);
    }

    // Generate invoice BEFORE inserting — so invoice number is included from the start
    let invoiceNumber = bookingNumber || '';
    try {
      const quoteBreakdown = buildQuoteBreakdown({
        roomCode,
        checkIn: new Date(checkIn),
        checkOut: new Date(checkOut),
        roomTotal: roomTotal || 0,
        propertyFee: propertyFee || 0,
      });
      const guest = {
        name: guestName || '',
        email: guestEmail || '',
        phone: guestPhone || ''
      };
      const dates = {
        checkIn: checkIn,
        checkOut: checkOut,
        roomCode: roomCode
      };
      const result = await callIssueInvoice(guest, quoteBreakdown, dates, true);
      invoiceNumber = result.invoice_number;
      console.log('>>> SERVER invoice generated BEFORE insert:', invoiceNumber);
    } catch (e) {
      console.log('>>> SERVER invoice generation failed BEFORE insert:', e.message);
      // Preserve error in note so admin can see why invoice is missing
      saveNote = (saveNote || '') + ' [Invoice error: ' + (e.message || 'unknown') + ']';
    }

    const toInsert = {
      roomCode: roomCode,
      checkIn: new Date(checkIn),
      checkOut: new Date(checkOut),
      guests: guests,
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
      bookingNumber: invoiceNumber || '',
      country: country || '',
      note: saveNote || '',
    };
    const inserted = await wixData.insert(BOOKINGS, toInsert);

    // Post-insert safety re-check (race-condition guard).
    const countNow = await overlappingCount(roomCode, checkIn, checkOut);
    if (countNow > ROOM_UNITS[roomCode]) {
      await wixData.remove(BOOKINGS, inserted._id);
      throw new Error('Booking conflict — ' + roomCode + ' was just taken. Please retry.');
    }

    console.log('>>> SERVER createBooking complete. bookingNumber:', inserted.bookingNumber);
    return inserted;
  }
);

export const cancelBooking = webMethod(
  Permissions.Admin,
  async (bookingId) => {
    const b = await wixData.get(BOOKINGS, bookingId);
    if (!b) throw new Error('No booking ' + bookingId);
    b.status = 'Cancelled';
    return wixData.update(BOOKINGS, b);
  }
);

export const blockRoom = webMethod(
  Permissions.Admin,
  async (roomCode, checkIn, checkOut, quantity, note) => {
    quantity = quantity || 1;
    note = note || '';
    if (!(roomCode in ROOM_UNITS)) throw new Error('Unknown room type \'' + roomCode + '\'');
    if (nightsBetween(checkIn, checkOut) <= 0) throw new Error('checkOut must be after checkIn');
    if (quantity < 1) throw new Error('quantity must be >= 1');

    let minFree = ROOM_UNITS[roomCode];
    const rows = await overlappingRows(roomCode, checkIn, checkOut);
    const nights = nightsBetween(checkIn, checkOut);
    for (let d = 0; d < nights; d++) {
      const probe = new Date(checkIn);
      probe.setDate(probe.getDate() + d);
      let bookedThatNight = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
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
        roomCode + ': requested ' + quantity + ' unit(s) blocked, but only ' + actual + ' available for the full range (' + checkIn + ' to ' + checkOut + '). Reduced to ' + actual + '.'
      );
    }
    if (actual < 1) {
      throw new Error(
        'Cannot block ' + roomCode + ': all units already booked for the requested period (' + checkIn + ' to ' + checkOut + ').'
      );
    }

    const toInsert = {
      roomCode: roomCode,
      checkIn: new Date(checkIn),
      checkOut: new Date(checkOut),
      guests: 1,
      status: 'blocked',
      quantity: actual,
      note: note,
    };
    const inserted = await wixData.insert(BOOKINGS, toInsert);
    return { booking: inserted, warnings: warnings };
  }
);

export const unblock = webMethod(
  Permissions.Admin,
  async (bookingId) => {
    const b = await wixData.get(BOOKINGS, bookingId);
    if (!b) throw new Error('No booking ' + bookingId);
    if (b.status !== 'blocked') throw new Error('Booking ' + bookingId + ' is not a block (status=' + b.status + ')');
    await wixData.remove(BOOKINGS, bookingId);
    return b;
  }
);

export const blockAllRooms = webMethod(
  Permissions.Admin,
  async (checkIn, checkOut, note) => {
    note = note || '';
    const results = [];
    const roomCodes = Object.keys(ROOM_UNITS);
    for (let i = 0; i < roomCodes.length; i++) {
      const roomCode = roomCodes[i];
      try {
        const outcome = await blockRoom(roomCode, checkIn, checkOut, ROOM_UNITS[roomCode], note);
        results.push({ roomCode: roomCode, booking: outcome.booking, warnings: outcome.warnings });
      } catch (e) {
        results.push({ roomCode: roomCode, booking: null, warnings: [e.message] });
      }
    }
    return results;
  }
);

export const listBlocks = webMethod(
  Permissions.Admin,
  async (roomCode) => {
    let q = wixData.query(BOOKINGS).eq('status', 'blocked').limit(1000);
    if (roomCode) q = q.eq('roomCode', roomCode);
    const res = await q.find();
    return res.items;
  }
);
