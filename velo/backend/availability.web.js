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
import { getAllSettings } from 'backend/settings.web';

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
async function updateBookingSummary(bookingNumber, checkInArg, checkOutArg, optGuest) {
  if (!bookingNumber) {
    console.log('>>> updateBookingSummary SKIPPED — no bookingNumber');
    return;
  }
  console.log('>>> updateBookingSummary START for', bookingNumber);

  try {
    // Try to read existing summary first (for dates during cancel, invoice, etc.)
    let checkIn = checkInArg || null;
    let checkOut = checkOutArg || null;

    if (!checkIn || !checkOut) {
      const existingSummaryRes = await wixData.query(BOOKING_SUMMARIES)
        .eq('bookingNumber', bookingNumber)
        .limit(1)
        .find();
      if (existingSummaryRes.items.length > 0) {
        const es = existingSummaryRes.items[0];
        if (!checkIn && es.checkIn) checkIn = es.checkIn;
        if (!checkOut && es.checkOut) checkOut = es.checkOut;
      }
    }

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
    let guestName = optGuest && optGuest.guestName ? optGuest.guestName : '';
    let guestEmail = optGuest && optGuest.guestEmail ? optGuest.guestEmail : '';
    let guestPhone = optGuest && optGuest.guestPhone ? optGuest.guestPhone : '';
    let roomCount = 0;
    let status = '';

    let promoDiscount = 0;
    let promoCode = '';
    let totalDiscountAmount = 0;

    for (const row of res.items) {
      totalRoomTotal += (row.roomTotal || 0);
      totalAccommodationVat += (row.accomodationVat || 0);
      totalPackageVat += (row.packageVat || 0);
      totalPropertyFee += (row.propertyFee || 0);
      roomCount++;

      if (!status && row.status) status = row.status;
      if (!promoCode && row.promoCode) promoCode = row.promoCode;
      if (!promoDiscount && row.promoDiscount) promoDiscount = parseFloat(row.promoDiscount) || 0;
    }

    // Room-level financials are already discounted at write time (createBooking applies promo).
    // Compute total promo dollar savings by reversing the discount ratio on the aggregated subtotal.
    if (promoCode && promoDiscount > 0) {
      const grossRatio = 1 - promoDiscount;
      if (grossRatio > 0) {
        const grossRoomTotal = totalRoomTotal / grossRatio;
        totalDiscountAmount = Math.round((grossRoomTotal - totalRoomTotal) * 100) / 100;
      }
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
      promoCode,
      promoDiscountAmount: totalDiscountAmount,
      status: status || 'confirmed'
    };

    console.log('>>> updateBookingSummary computed:', JSON.stringify(summary).substring(0,200));

    const existing = await wixData.query(BOOKING_SUMMARIES)
      .eq('bookingNumber', bookingNumber)
      .limit(1)
      .find();

    if (existing.items.length > 0) {
      summary._id = existing.items[0]._id;
      // Preserve existing bookingDate when updating so the original creation date stays
      summary.bookingDate = existing.items[0].bookingDate || new Date();
      console.log('>>> updateBookingSummary UPDATING row', existing.items[0]._id);
      await wixData.update(BOOKING_SUMMARIES, summary);
      console.log('>>> updateBookingSummary UPDATE complete');
    } else {
      summary.bookingDate = new Date();
      console.log('>>> updateBookingSummary INSERTING new row with bookingDate');
      await wixData.insert(BOOKING_SUMMARIES, summary);
      console.log('>>> updateBookingSummary INSERT complete');
    }
  } catch (e) {
    console.log('>>> updateBookingSummary ERROR:', e.message);
    throw e; // re-throw so caller can log it too
  }
}
async function overlappingCount(roomCode, checkIn, checkOut) {
  let total = 0;
  const seenIds = [];

  // Primary: join via BookingSummary (new canonical path)
  const summaryRes = await wixData.query(BOOKING_SUMMARIES)
    .lt('checkIn', new Date(checkOut))
    .gt('checkOut', new Date(checkIn))
    .limit(1000)
    .find();

  const overlapNumbers = [];
  for (const s of summaryRes.items) {
    if (s.bookingNumber && overlapNumbers.indexOf(String(s.bookingNumber)) === -1) {
      overlapNumbers.push(String(s.bookingNumber));
    }
  }

  if (overlapNumbers.length > 0) {
    const res = await wixData.query(BOOKINGS)
      .eq('roomCode', roomCode)
      .hasSome('status', ['confirmed', 'hold', 'blocked'])
      .hasSome('bookingNumber', overlapNumbers)
      .limit(1000)
      .find();
    for (const row of res.items) {
      total += (row.quantity || 1);
      if (row._id) seenIds.push(row._id);
    }
  }

  return total;
}

async function overlappingRows(roomCode, checkIn, checkOut) {
  const rows = [];
  const seenIds = [];
  const summaryDateMap = {}; // bookingNumber -> {checkIn, checkOut}

  // Primary: join via BookingSummary
  const summaryRes = await wixData.query(BOOKING_SUMMARIES)
    .lt('checkIn', new Date(checkOut))
    .gt('checkOut', new Date(checkIn))
    .limit(1000)
    .find();

  const overlapNumbers = [];
  for (const s of summaryRes.items) {
    if (s.bookingNumber) {
      const num = String(s.bookingNumber);
      if (overlapNumbers.indexOf(num) === -1) {
        overlapNumbers.push(num);
        if (s.checkIn && s.checkOut) {
          summaryDateMap[num] = { checkIn: s.checkIn, checkOut: s.checkOut };
        }
      }
    }
  }

  if (overlapNumbers.length > 0) {
    const res = await wixData.query(BOOKINGS)
      .eq('roomCode', roomCode)
      .hasSome('status', ['confirmed', 'hold', 'blocked'])
      .hasSome('bookingNumber', overlapNumbers)
      .limit(1000)
      .find();
    for (const row of res.items) {
      if (!row.checkIn && summaryDateMap[String(row.bookingNumber)]) {
        row.checkIn = summaryDateMap[String(row.bookingNumber)].checkIn;
        row.checkOut = summaryDateMap[String(row.bookingNumber)].checkOut;
      }
      rows.push(row);
      if (row._id) seenIds.push(row._id);
    }
  }

  return rows;
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

    const promoDiscountRate = parseFloat(booking.promoDiscount) || 0;
    const discountRatio = promoDiscountRate > 0 && promoDiscountRate < 1 ? (1 - promoDiscountRate) : 1;

    const toInsert = {
      roomCode: roomCode,
      // checkIn and checkOut are intentionally stored only in BookingSummary
      // to maintain single source of truth for booking dates.
      guests: guests,
      status: booking.status || 'confirmed',
      quantity: 1,
      roomTotal: Math.round((roomTotal || 0) * discountRatio * 100) / 100,
      propertyFee: Math.round((propertyFee || 0) * discountRatio * 100) / 100,
      accomodationVat: Math.round((accomodationVat || 0) * discountRatio * 100) / 100,
      packageVat: Math.round((packageVat || 0) * discountRatio * 100) / 100,
      grandTotal: Math.round((grandTotal || 0) * discountRatio * 100) / 100,
      bookingNumber: invoiceNumber || '',
      note: saveNote || '',
      promoCode: booking.promoCode || '',
      promoDiscount: booking.promoDiscount || 0,
      promoApplied: true,
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

    // Update booking summary — pass dates + guest info so the summary row is complete
    console.log('>>> SERVER calling updateBookingSummary for', inserted.bookingNumber);
    try {
      await updateBookingSummary(inserted.bookingNumber, checkIn, checkOut, {
        guestName: guestName || '',
        guestEmail: guestEmail || '',
        guestPhone: guestPhone || '',
      });
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

    // Read dates from BookingSummary (single source of truth)
    let checkInDate = '', checkOutDate = '';
    let summaryRow = null;
    try {
      const summaryRes = await wixData.query(BOOKING_SUMMARIES)
        .eq('bookingNumber', bookingNumber)
        .limit(1)
        .find();
      if (summaryRes.items.length > 0) {
        summaryRow = summaryRes.items[0];
        if (summaryRow.checkIn) checkInDate = new Date(summaryRow.checkIn).toISOString().slice(0, 10);
        if (summaryRow.checkOut) checkOutDate = new Date(summaryRow.checkOut).toISOString().slice(0, 10);
      }
    } catch (summaryErr) {
      console.log('>>> issueBookingInvoice BookingSummary read ERROR:', summaryErr.message);
    }

    // Look up package title & amenities from Packages collection by nights
    let packageTitle = '';
    let includedAmenities = '';
    try {
      const nights = nightsBetween(checkInDate, checkOutDate);
      if (nights > 0) {
        const pkgRes = await wixData.query('Packages').limit(100).find();
        for (const pkg of pkgRes.items) {
          const itemNights = pkg.NumberOfNights || pkg.numberOfNights || pkg.numberofnights || 0;
          if (Number(itemNights) === Number(nights)) {
            packageTitle = pkg.title_fld || pkg.Title || pkg.title || pkg.name || pkg.Name || '';
            includedAmenities = pkg.includedAmenities || '';
            break;
          }
        }
      }
    } catch (pkgErr) {}

    const guest = {
      name: summaryRow && summaryRow.guestName ? summaryRow.guestName : '',
      email: summaryRow && summaryRow.guestEmail ? summaryRow.guestEmail : '',
      phone: summaryRow && summaryRow.guestPhone ? summaryRow.guestPhone : '',
    };

    const dates = {
      checkIn: checkInDate,
      checkOut: checkOutDate,
      roomCode: bookingsRes.items.map(function (r) { return r.roomCode; }).join(', ')
    };

    // Fetch table-driven allocation ratio from Settings for the invoice PDF.
    let accommodationShare = 0.5;
    try {
      const settings = await getAllSettings();
      accommodationShare = Number(settings.accommodationShare || 0.5);
    } catch (e) {}

    const line_items = [];
    const display_line_items = [];
    let subtotal_net = 0;
    let total_vat = 0;
    let total_property_fee = 0;
    let total_acc_vat = 0;
    let total_pkg_vat = 0;

    // Promo code stored on first booking row (all rows in group share same code).
    const promoDiscount = parseFloat(firstRow.promoDiscount) || 0;
    const promoCode = firstRow.promoCode || '';
    // createBooking now writes discounted room-level financials, so do not double-discount.
    const alreadyDiscounted = firstRow.promoApplied === true;

    for (const row of bookingsRes.items) {
      const nights = nightsBetween(checkInDate || dates.checkIn, checkOutDate || dates.checkOut);
      const roomTotal = row.roomTotal || 0;
      const propertyFee = row.propertyFee || 0;
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

      display_line_items.push({
        label: displayName,
        quantity: nights,
        unit_price: nights > 0 ? roomTotal / nights : 0,
        net: roomTotal,
        vat_rate: 0,
        vat: accVat + pkgVat,
        gross: roomTotal + accVat + pkgVat
      });

      subtotal_net += roomTotal;
      total_vat += accVat + pkgVat;
      total_property_fee += propertyFee;
      total_acc_vat += accVat;
      total_pkg_vat += pkgVat;
    }

    // Promo handling. createBooking now writes discounted room-level financials
    // (when a promo is used). If the values are already discounted, we just
    // aggregate them; otherwise we apply the discount to gross aggregates here.
    let promoDiscountAmount = 0;
    let discountRatio = 1;
    if (promoDiscount > 0) {
      if (alreadyDiscounted) {
        // subtotal_net/total_vat/total_property_fee are already net values.
        // Compute the discount amount for display by reversing the discount.
        const grossRatio = 1 - promoDiscount;
        if (grossRatio > 0) {
          const grossSubtotal = subtotal_net / grossRatio;
          promoDiscountAmount = Math.round((grossSubtotal - subtotal_net) * 100) / 100;
        }
        discountRatio = 1;
      } else {
        promoDiscountAmount = Math.round(subtotal_net * promoDiscount * 100) / 100;
        discountRatio = subtotal_net > 0 ? (subtotal_net - promoDiscountAmount) / subtotal_net : 1;
      }
    }

    const discountedSubtotal = alreadyDiscounted ? subtotal_net : Math.round((subtotal_net - promoDiscountAmount) * 100) / 100;
    const discountedPropertyFee = alreadyDiscounted ? total_property_fee : Math.round(total_property_fee * discountRatio * 100) / 100;
    const discountedTotalVat = alreadyDiscounted ? total_vat : Math.round(total_vat * discountRatio * 100) / 100;
    const discountedAccVat = alreadyDiscounted ? total_acc_vat : Math.round(total_acc_vat * discountRatio * 100) / 100;
    const discountedPkgVat = alreadyDiscounted ? total_pkg_vat : Math.round(total_pkg_vat * discountRatio * 100) / 100;
    const discountedTotal = Math.round((discountedSubtotal + discountedPropertyFee + discountedTotalVat) * 100) / 100;

    // Rebuild line_items for discounted amounts
    const discounted_line_items = [];
    for (const li of line_items) {
      const discountedNet = alreadyDiscounted ? li.net : Math.round(li.net * discountRatio * 100) / 100;
      const discountedVat = alreadyDiscounted ? li.vat : Math.round(li.vat * discountRatio * 100) / 100;
      const finalUnitPrice = li.quantity > 0 ? discountedNet / li.quantity : 0;
      discounted_line_items.push({
        label: li.label,
        tax_class: li.tax_class,
        quantity: li.quantity,
        unit_price: finalUnitPrice,
        net: discountedNet,
        vat_rate: li.vat_rate,
        vat: discountedVat,
        gross: discountedNet + discountedVat
      });
    }

    const quoteBreakdown = {
      line_items: discounted_line_items,
      display_line_items,
      subtotal_net: discountedSubtotal,
      total_vat: discountedTotalVat,
      total: discountedTotal,
      property_fee_rate: discountedSubtotal > 0 ? discountedPropertyFee / discountedSubtotal : 0,
      property_fee: discountedPropertyFee,
      currency: 'USD',
      vat_by_class: {
        accommodation: discountedAccVat,
        standard: discountedPkgVat
      },
      package_title: packageTitle,
      included_amenities: includedAmenities,
      check_in: checkInDate,
      check_out: checkOutDate,
      accommodationShare: accommodationShare,
      promo_code: promoCode,
      promo_discount_rate: promoDiscount,
      promo_discount_amount: discountAmount,
    };

    console.log('>>> issueBookingInvoice calling invoice service with dates:', JSON.stringify({
      checkIn: dates.checkIn,
      checkOut: dates.checkOut,
      guestPresent: !!(guest.name && guest.email),
      accommodationShare: accommodationShare,
    }));

    const result = await callIssueInvoice(guest, quoteBreakdown, dates, true, bookingNumber);
    console.log('>>> issueBookingInvoice full service result keys:', Object.keys(result || {}).join(','));
    console.log('>>> CALENDAR result from invoice service:', JSON.stringify(
      result._calendar_debug || result.calendar || result.calendar_error || 'no-calendar-field'
    ));

    // Return diagnostics in the webMethod response so callers can inspect.
    const returnPayload = {
      invoice_number: result.invoice_number,
      invoice_url: result.invoice_url,
      total: result.total,
      emailed: result.emailed,
      _calendar_debug: result._calendar_debug || null,
      calendar: result.calendar || null,
      calendar_error: result.calendar_error || null,
      service_error: result.error || null,
    };

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

    return returnPayload;
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
      // checkIn and checkOut intentionally stored only in BookingSummary
      guests: 1,
      status: 'blocked',
      quantity: actual,
      note: note,
      bookingNumber: await getNextBookingNumber(),
    };
    const inserted = await wixData.insert(BOOKINGS, toInsert);

    // Create/update BookingSummary so overlapping joins find this block
    try {
      await updateBookingSummary(inserted.bookingNumber, checkIn, checkOut);
    } catch (e) {
      console.log('>>> blockRoom updateBookingSummary ERROR:', e.message);
    }

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

export const validatePromoCode = webMethod(
  Permissions.Anyone,
  async (code) => {
    if (!code || !code.trim()) {
      return { valid: false, reason: 'No promo code provided.' };
    }
    const now = new Date();
    try {
      const res = await wixData.query('PromoCodes').limit(1).find();
      let found = null;
      for (const item of res.items) {
        // Wix Data may return title-fld or title depending on collection field name.
        const itemTitle = item.title || item.Title || item.title_fld || '';
        if (String(itemTitle).trim().toUpperCase() === String(code).trim().toUpperCase()) {
          found = item;
          break;
        }
      }
      if (!found) {
        return { valid: false, reason: 'Promo code not found.' };
      }
      const startDate = found.startDate ? new Date(found.startDate) : null;
      const endDate = found.endDate ? new Date(found.endDate) : null;
      if (startDate && now < startDate) {
        return { valid: false, reason: 'Promo code is not yet active.' };
      }
      if (endDate) {
        // End date is inclusive; treat midnight of end date as inclusive end of that day.
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        if (now > endOfDay) {
          return { valid: false, reason: 'Promo code has expired.' };
        }
      }
      const discount = parseFloat(found.discount) || 0;
      if (discount <= 0 || discount > 1) {
        return { valid: false, reason: 'Invalid discount value.' };
      }
      return { valid: true, code: code, discount: discount };
    } catch (e) {
      return { valid: false, reason: 'Error validating promo code: ' + e.message };
    }
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
