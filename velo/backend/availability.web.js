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
const BOOKING_SUMMARIES = 'BookingSummary';
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

const ROOM_DISPLAY_NAMES = {
  adventure_suite: 'Adventure Suite',
  penthouse_apartment: 'Penthouse Apartment',
  two_bedroom_apartment: 'Two Bedroom Apartment',
};

function getRoomDisplayName(roomCode) {
  return ROOM_DISPLAY_NAMES[roomCode] || (roomCode || '').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

/* ---------- helpers ---------- */
async function getNextBookingNumber() {
  const PREFIX = 'WBE-INV-';
  const PAD = 4;
  let maxNum = 0;
  let page = await wixData.query(BOOKINGS)
    .limit(1000)
    .find();
  while (page.items.length) {
    for (const item of page.items) {
      const bn = item.bookingNumber;
      if (bn) {
        const m = String(bn).match(/(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxNum) maxNum = n;
        }
      }
    }
    if (page.hasNext()) {
      page = await page.next();
    } else {
      break;
    }
  }
  let candidate = maxNum + 1;
  let attempts = 0;
  while (attempts < 5) {
    const numStr = PREFIX + String(candidate).padStart(PAD, '0');
    const exist = await wixData.query(BOOKINGS)
      .eq('bookingNumber', numStr)
      .limit(1)
      .find();
    if (exist.items.length === 0) {
      return numStr;
    }
    candidate++;
    attempts++;
  }
  throw new Error('Failed to generate unique booking number');
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
async function callIssueInvoice(guest, quoteBreakdown, dates, sendEmail, invoiceNumber) {
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
  if (invoiceNumber) {
    body.invoice_number = invoiceNumber;
  }

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

  const displayName = getRoomDisplayName(booking.roomCode);

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
    result = await callIssueInvoice(guest, quoteBreakdown, dates, true, '');
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
    bookingNumber: result.invoice_number,
    total: result.total,
    emailed: result.emailed || false
  };
}

/* ---------- availability helpers ---------- */
async function updateBookingSummary(bookingNumber) {
  if (!bookingNumber) {
    console.log('>>> updateBookingSummary SKIPPED — no bookingNumber');
    return;
  }
  console.log('>>> updateBookingSummary START for', bookingNumber);

  try {
    const res = await wixData.query(BOOKINGS)
      .eq('bookingNumber', bookingNumber)
      .limit(1000)
      .find();

    console.log('>>> updateBookingSummary found', res.items.length, 'rows');

    if (res.items.length === 0) {
      console.log('>>> updateBookingSummary ABORT — zero rows found');
      return;
    }

    let totalRoomTotal = 0;
    let totalAccommodationVat = 0;
    let totalPackageVat = 0;
    let totalPropertyFee = 0;
    let checkIn = null, checkOut = null;
    let guestName = '', guestEmail = '', guestPhone = '';
    let roomCount = 0;
    let status = '';

    for (const row of res.items) {
      totalRoomTotal += (row.roomTotal || 0);
      totalAccommodationVat += (row.accomodationVat || 0);
      totalPackageVat += (row.packageVat || 0);
      totalPropertyFee += (row.propertyFee || 0);
      roomCount++;

      if (!checkIn || new Date(row.checkIn) < new Date(checkIn)) {
        checkIn = row.checkIn;
      }
      if (!checkOut || new Date(row.checkOut) > new Date(checkOut)) {
        checkOut = row.checkOut;
      }
      guestName = row.guestName || guestName;
      guestEmail = row.guestEmail || guestEmail;
      guestPhone = row.guestPhone || guestPhone;
      if (!status && row.status) status = row.status;
    }

    const summary = {
      bookingNumber,
      checkIn,
      checkOut,
      guestName,
      guestEmail,
      guestPhone,
      roomCount,
      roomTotal: Math.round((totalRoomTotal + Number.EPSILON) * 100) / 100,
      accommodationVat: Math.round((totalAccommodationVat + Number.EPSILON) * 100) / 100,
      packageVat: Math.round((totalPackageVat + Number.EPSILON) * 100) / 100,
      propertyFee: Math.round((totalPropertyFee + Number.EPSILON) * 100) / 100,
      grandTotal: Math.round((totalRoomTotal + totalAccommodationVat + totalPackageVat + totalPropertyFee + Number.EPSILON) * 100) / 100,
      status: status || 'confirmed'
    };

    console.log('>>> updateBookingSummary computed:', JSON.stringify(summary).substring(0,200));

    const existing = await wixData.query(BOOKING_SUMMARIES)
      .eq('bookingNumber', bookingNumber)
      .limit(1)
      .find();

    if (existing.items.length > 0) {
      summary._id = existing.items[0]._id;
      console.log('>>> updateBookingSummary UPDATING row', existing.items[0]._id);
      await wixData.update(BOOKING_SUMMARIES, summary);
      console.log('>>> updateBookingSummary UPDATE complete');
    } else {
      console.log('>>> updateBookingSummary INSERTING new row');
      await wixData.insert(BOOKING_SUMMARIES, summary);
      console.log('>>> updateBookingSummary INSERT complete');
    }
  } catch (e) {
    console.log('>>> updateBookingSummary ERROR:', e.message);
    throw e; // re-throw so caller can log it too
  }
}
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
    const roomDisplay = getRoomDisplayName(roomCode);
    if (!(roomCode in ROOM_UNITS)) throw new Error('Unknown room type \'' + roomDisplay + '\'');
    if (nightsBetween(checkIn, checkOut) <= 0) throw new Error('checkOut must be after checkIn');
    if (guests < ROOM_MIN_OCCUPANCY[roomCode]) {
      throw new Error(roomDisplay + ' requires at least ' + ROOM_MIN_OCCUPANCY[roomCode] + ' guests (no single-guest bookings); requested ' + guests);
    }
    if (guests > ROOM_MAX_OCCUPANCY[roomCode]) {
      throw new Error(roomDisplay + ' sleeps ' + ROOM_MAX_OCCUPANCY[roomCode] + '; requested ' + guests);
    }

    const available = await isAvailable(roomCode, checkIn, checkOut);
    if (!available) {
      throw new Error('No ' + roomDisplay + ' available for ' + checkIn + ' to ' + checkOut);
    }

    // Generate booking number if not provided
    let invoiceNumber = bookingNumber || '';
    if (!invoiceNumber) {
      try {
        invoiceNumber = await getNextBookingNumber();
      } catch (e) {
        console.log('>>> SERVER getNextBookingNumber ERROR:', e.message);
        invoiceNumber = '';
      }
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
    console.log('>>> SERVER toInsert keys:', Object.keys(toInsert).join(', '));
    console.log('>>> SERVER toInsert financials => roomTotal:', toInsert.roomTotal, '| propertyFee:', toInsert.propertyFee, '| accomodationVat:', toInsert.accomodationVat, '| packageVat:', toInsert.packageVat, '| grandTotal:', toInsert.grandTotal, '| bookingNumber:', toInsert.bookingNumber);
    const inserted = await wixData.insert(BOOKINGS, toInsert);
    console.log('>>> SERVER insert returned keys:', Object.keys(inserted).join(', '));
    console.log('>>> SERVER insert returned financials => roomTotal:', inserted.roomTotal, '| propertyFee:', inserted.propertyFee, '| accomodationVat:', inserted.accomodationVat, '| packageVat:', inserted.packageVat, '| grandTotal:', inserted.grandTotal, '| bookingNumber:', inserted.bookingNumber);
    try {
      const verify = await wixData.get(BOOKINGS, inserted._id);
      console.log('>>> SERVER verify-db row keys:', Object.keys(verify).join(', '));
      console.log('>>> SERVER verify-db financials => roomTotal:', verify.roomTotal, '| propertyFee:', verify.propertyFee, '| accomodationVat:', verify.accomodationVat, '| packageVat:', verify.packageVat, '| grandTotal:', verify.grandTotal, '| bookingNumber:', verify.bookingNumber);
    } catch (ve) {
      console.log('>>> SERVER verify-db ERROR:', ve.message);
    }

    // Post-insert safety re-check (race-condition guard).
    const countNow = await overlappingCount(roomCode, checkIn, checkOut);
    if (countNow > ROOM_UNITS[roomCode]) {
      await wixData.remove(BOOKINGS, inserted._id);
      throw new Error('Booking conflict — ' + roomCode + ' was just taken. Please retry.');
    }

    // Update booking summary
    console.log('>>> SERVER calling updateBookingSummary for', inserted.bookingNumber);
    try {
      await updateBookingSummary(inserted.bookingNumber);
    } catch (e) {
      console.log('>>> SERVER updateBookingSummary ERROR:', e.message);
    }

    console.log('>>> SERVER createBooking complete. bookingNumber:', inserted.bookingNumber);
    return inserted;
  }
);

export const issueBookingInvoice = webMethod(
  Permissions.Anyone,
  async (bookingNumber) => {
    if (!bookingNumber) throw new Error('bookingNumber required');

    const bookingsRes = await wixData.query(BOOKINGS)
      .eq('bookingNumber', bookingNumber)
      .limit(1000)
      .find();

    if (bookingsRes.items.length === 0) {
      throw new Error('No bookings found for ' + bookingNumber);
    }

    const firstRow = bookingsRes.items[0];
    const guest = {
      name: firstRow.guestName || '',
      email: firstRow.guestEmail || '',
      phone: firstRow.guestPhone || ''
    };

    const dates = {
      checkIn: firstRow.checkIn.toISOString().slice(0, 10),
      checkOut: firstRow.checkOut.toISOString().slice(0, 10),
      roomCode: bookingsRes.items.map(function (r) { return r.roomCode; }).join(', ')
    };

    const line_items = [];
    let subtotal_net = 0;
    let total_vat = 0;
    let total_property_fee = 0;

    for (const row of bookingsRes.items) {
      const nights = nightsBetween(row.checkIn, row.checkOut);
      const roomTotal = row.roomTotal || 0;
      const propertyFee = row.propertyFee || 0;
      const accommodationShare = 0.5;
      const taxRateAccommodation = 0.10;
      const taxRateStandard = 0.15;

      const accNet = roomTotal * accommodationShare;
      const advNet = roomTotal * (1 - accommodationShare);
      const accVat = accNet * taxRateAccommodation;
      const pkgVat = advNet * taxRateStandard;

      const accUnitPrice = nights > 0 ? accNet / nights : 0;
      const advUnitPrice = nights > 0 ? advNet / nights : 0;

      const displayName = getRoomDisplayName(row.roomCode);

      line_items.push({
        label: displayName + ' — Accommodation',
        tax_class: 'accommodation',
        quantity: nights,
        unit_price: accUnitPrice,
        net: accNet,
        vat_rate: taxRateAccommodation,
        vat: accVat,
        gross: accNet + accVat
      });

      line_items.push({
        label: displayName + ' — Activities & Services',
        tax_class: 'standard',
        quantity: nights,
        unit_price: advUnitPrice,
        net: advNet,
        vat_rate: taxRateStandard,
        vat: pkgVat,
        gross: advNet + pkgVat
      });

      subtotal_net += roomTotal;
      total_vat += accVat + pkgVat;
      total_property_fee += propertyFee;
    }

    const total = subtotal_net + total_property_fee + total_vat;

    const quoteBreakdown = {
      line_items,
      subtotal_net: Math.round((subtotal_net + Number.EPSILON) * 100) / 100,
      total_vat: Math.round((total_vat + Number.EPSILON) * 100) / 100,
      total: Math.round((total + Number.EPSILON) * 100) / 100,
      property_fee_rate: subtotal_net > 0 ? total_property_fee / subtotal_net : 0,
      property_fee: Math.round((total_property_fee + Number.EPSILON) * 100) / 100,
      currency: 'USD'
    };

    const result = await callIssueInvoice(guest, quoteBreakdown, dates, true, bookingNumber);

    const invoiceUrl = result.invoice_url || '';

    for (const row of bookingsRes.items) {
      if (!row.invoiceUrl) {
        row.invoiceUrl = invoiceUrl;
        await wixData.update(BOOKINGS, row);
      }
    }

    try {
      const summaryRes = await wixData.query(BOOKING_SUMMARIES)
        .eq('bookingNumber', bookingNumber)
        .limit(1)
        .find();

      if (summaryRes.items.length > 0) {
        const summaryItem = summaryRes.items[0];
        summaryItem.invoiceUrl = invoiceUrl;
        await wixData.update(BOOKING_SUMMARIES, summaryItem);
      }
    } catch (summaryErr) {
      console.log('>>> issueBookingInvoice Booking Summary update skipped:', summaryErr.message);
    }

    return result;
  }
);

export const cancelBooking = webMethod(
  Permissions.Admin,
  async (bookingId) => {
    const b = await wixData.get(BOOKINGS, bookingId);
    if (!b) throw new Error('No booking ' + bookingId);
    b.status = 'Cancelled';
    const updated = await wixData.update(BOOKINGS, b);

    if (b.bookingNumber) {
      try {
        await updateBookingSummary(b.bookingNumber);
      } catch (e) {
        console.log('>>> SERVER updateBookingSummary ERROR after cancel:', e.message);
      }
    }

    return updated;
  }
);

export const blockRoom = webMethod(
  Permissions.Admin,
  async (roomCode, checkIn, checkOut, quantity, note) => {
    quantity = quantity || 1;
    note = note || '';
    const roomDisplay = getRoomDisplayName(roomCode);
    if (!(roomCode in ROOM_UNITS)) throw new Error('Unknown room type \'' + roomDisplay + '\'');
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
        roomDisplay + ': requested ' + quantity + ' unit(s) blocked, but only ' + actual + ' available for the full range (' + checkIn + ' to ' + checkOut + '). Reduced to ' + actual + '.'
      );
    }
    if (actual < 1) {
      throw new Error(
        'Cannot block ' + roomDisplay + ': all units already booked for the requested period (' + checkIn + ' to ' + checkOut + ').'
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
