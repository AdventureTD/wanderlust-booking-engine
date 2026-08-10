
import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { getAllSettings, incrementSetting } from 'backend/settings.web';
import { adjustBookingConversion, isGoogleAdsSuspended } from 'backend/googleAdsConversions.web';
import { normalizePriceModifier, roundMoney } from 'backend/rateResolver';
import { verifyLockedPricingQuote } from 'backend/pricingQuote';

const BOOKINGS = 'Bookings';
const BOOKING_SUMMARIES = 'BookingSummary';
const BOOKING_INVOICES = 'BookingInvoices';
const INVOICE_SERVICE_URL_KEY = 'WBE_INVOICE_SERVICE_URL';
const SHARED_SECRET_KEY = 'WBE_SHARED_SECRET';

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

async function getNextBookingNumber() {
  try {
    const next = await incrementSetting('bookingNumber');
    return 'WC-' + next;
  } catch (e) {
    console.log('>>> getNextBookingNumber fallback error:', e.message);
    // Fallback: find highest existing WC-* number.
    const res = await wixData.query(BOOKING_SUMMARIES)
      .startsWith('bookingNumber', 'WC-')
      .descending('bookingNumber')
      .limit(1)
      .find({ suppressAuth: true });
    let last = 1000;
    if (res.items.length > 0) {
      const bn = String(res.items[0].bookingNumber || 'WC-1000');
      const m = bn.match(/WC-(\d+)/);
      if (m) last = parseInt(m[1], 10);
    }
    return 'WC-' + (last + 1);
  }
}

async function getNextInvoiceNumber() {
  return String(await incrementSetting('invoiceNumber'));
}

function nightsBetween(checkIn, checkOut) {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function normalizeDate(v) {
  if (!v) return null;
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), 12, 0, 0));
  let str = String(v).trim();
  // Strip any time/timezone suffix starting with 'T' or space.
  const tIndex = str.indexOf('T');
  if (tIndex !== -1) str = str.substring(0, tIndex);
  const spaceIndex = str.indexOf(' ');
  if (spaceIndex !== -1) str = str.substring(0, spaceIndex);
  if (!str) return null;
  const parts = str.split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  const out = new Date(Date.UTC(y, m, d, 12, 0, 0));
  return isNaN(out.getTime()) ? null : out;
}

function toDate(v) {
  return normalizeDate(v);
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

async function getPackagePricingForBooking(packageId, nights) {
  const n = Number(nights);
  if (!n || n <= 0) throw new Error('A positive stay length is required');

  let item = null;
  if (packageId) {
    const selected = await wixData.query('Packages').eq('_id', packageId).limit(1).find();
    item = selected.items[0] || null;
    if (!item) throw new Error('Selected package was not found');
    const itemNights = item.numberOfNights || item.NumberOfNights || item.numberofnights || 0;
    if (Number(itemNights) !== n) {
      throw new Error('Selected package does not match the requested stay length');
    }
  } else {
    const res = await wixData.query('Packages').limit(1000).find();
    item = res.items.find(function (candidate) {
      const itemNights = candidate.numberOfNights || candidate.NumberOfNights || candidate.numberofnights || 0;
      return Number(itemNights) === n;
    }) || null;
  }

  if (!item) throw new Error('No package exists for ' + n + ' nights');
  const baseRate = Number(item.baseRate);
  if (!Number.isFinite(baseRate) || baseRate < 0) throw new Error('Selected package has an invalid baseRate');
  return {
    _id: item._id,
    title: item.title || item.title_fld || item.Title || item.name || item.Name || '',
    baseRate,
    priceModifier: normalizePriceModifier(item.priceModifier),
  };
}

async function getAuthoritativeRoomFee(roomCode) {
  if (roomCode !== 'penthouse_apartment') return 0;
  const result = await wixData.query('Rooms').eq('roomCode', roomCode).limit(1).find();
  const fee = Number(result.items[0] && result.items[0].roomFee);
  return Number.isFinite(fee) && fee > 0 ? fee : 0;
}

async function callIssueInvoice(guest, quoteBreakdown, dates, sendEmail, invoiceNumber, ownerOnly, payments, bookingNumber) {
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
    owner_only: !!ownerOnly,
  };
  if (invoiceNumber) {
    body.invoice_number = invoiceNumber;
  }
  if (payments && payments.length) {
    body.payments = payments;
  }
  if (bookingNumber) {
    body.booking_number = bookingNumber;
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


async function archiveActiveInvoice(bookingNumber) {
  const res = await wixData.query(BOOKING_INVOICES)
    .eq('bookingNumber', bookingNumber)
    .eq('status', 'Active')
    .limit(100)
    .find({ suppressAuth: true });
  for (const item of res.items) {
    item.status = 'History';
    await wixData.update(BOOKING_INVOICES, item, { suppressAuth: true });
  }
}

async function recordBookingInvoice(bookingNumber, invoiceNumber, invoiceUrl, totals, checkIn, checkOut) {
  // Reuse the current Active or most-recent Draft/Active invoice row instead of always creating a new one.
  const existingRes = await wixData.query(BOOKING_INVOICES)
    .eq('bookingNumber', bookingNumber)
    .hasSome('status', ['Active', 'Draft'])
    .descending('_createdDate')
    .limit(1)
    .find({ suppressAuth: true });

  const row = existingRes.items[0] || {};
  row.bookingNumber = bookingNumber;
  row.invoiceNumber = invoiceNumber;
  row.invoiceUrl = invoiceUrl || row.invoiceUrl || '';
  row.checkIn = toDate(checkIn);
  row.checkOut = toDate(checkOut);
  row.roomTotal = totals.roomTotal || 0;
  row.grandTotal = totals.grandTotal || 0;
  row.accommodationVat = totals.accommodationVat || 0;
  row.packageVat = totals.packageVat || 0;
  row.propertyFee = totals.propertyFee || 0;
  row.promoCode = totals.promoCode || row.promoCode || '';
  row.promoDiscountAmount = totals.promoDiscountAmount || 0;
  row.status = 'Active';
  console.log('>>> recordBookingInvoice row to save:', JSON.stringify({ invoiceNumber: row.invoiceNumber, invoiceUrl: row.invoiceUrl, status: row.status, _id: row._id || 'new' }));

  if (row._id) {
    await wixData.update(BOOKING_INVOICES, row, { suppressAuth: true });
    return row;
  }

  // No existing invoice row — archive any strays and insert fresh.
  await archiveActiveInvoice(bookingNumber);
  return await wixData.insert(BOOKING_INVOICES, row, { suppressAuth: true });
}

async function buildQuoteBreakdown(bookingNumber) {
  const inv = await getActiveInvoice(bookingNumber);
  if (!inv) {
    throw new Error('No active or draft invoice found for ' + bookingNumber);
  }

  const checkInDate = toDate(inv.checkIn);
  const checkOutDate = toDate(inv.checkOut);
  const nights = nightsBetween(checkInDate, checkOutDate);
  const roomTotal = inv.roomTotal || 0;
  const propertyFee = inv.propertyFee || 0;
  const accommodationShare = 0.5;
  const taxRateAccommodation = 0.10;
  const taxRateStandard = 0.15;

  const accNet = roomTotal * accommodationShare;
  const advNet = roomTotal * (1 - accommodationShare);
  const accVat = accNet * taxRateAccommodation;
  const pkgVat = advNet * taxRateStandard;

  const accUnitPrice = nights > 0 ? accNet / nights : 0;
  const advUnitPrice = nights > 0 ? advNet / nights : 0;

  // Build display line items from the actual Bookings rows for this booking.
  const bookingsRes = await wixData.query(BOOKINGS)
    .eq('bookingNumber', bookingNumber)
    .limit(1000)
    .find();
  const totalGuests = bookingsRes.items.reduce(function (sum, row) { return sum + (row.guests || 0); }, 0);
  const display_line_items = [];
  for (const row of bookingsRes.items) {
    const displayName = getRoomDisplayName(row.roomCode);
    const rowNights = nightsBetween(checkInDate, checkOutDate);
    const rowTotal = (roomTotal / bookingsRes.items.length) || 0;
    const displayGross = rowTotal > 0 && inv.promoDiscountAmount > 0 && inv.promoCode
      ? rowTotal + (inv.promoDiscountAmount / bookingsRes.items.length)
      : rowTotal;
    display_line_items.push({
      label: displayName,
      quantity: rowNights,
      room_quantity: row.quantity || 1,
      unit_price: rowNights > 0 ? displayGross / rowNights : 0,
      net: displayGross,
      vat_rate: 0,
      vat: 0,
      gross: displayGross
    });
  }

  return {
    line_items: [
      {
        label: 'Accommodation',
        tax_class: 'accommodation',
        quantity: nights,
        unit_price: accUnitPrice,
        net: accNet,
        vat_rate: taxRateAccommodation,
        vat: accVat,
        gross: accNet + accVat
      },
      {
        label: 'Activities & Services',
        tax_class: 'standard',
        quantity: nights,
        unit_price: advUnitPrice,
        net: advNet,
        vat_rate: taxRateStandard,
        vat: pkgVat,
        gross: advNet + pkgVat
      }
    ],
    display_line_items,
    subtotal_net: roomTotal,
    total_vat: Math.round((accVat + pkgVat + Number.EPSILON) * 100) / 100,
    total: roomTotal + propertyFee + accVat + pkgVat,
    property_fee_rate: roomTotal > 0 ? propertyFee / roomTotal : 0,
    property_fee: propertyFee,
    currency: 'USD',
    vat_by_class: {
      accommodation: accVat,
      standard: pkgVat
    },
    promo_code: inv.promoCode || '',
    promo_discount_amount: inv.promoDiscountAmount || 0,
    check_in: checkInDate ? checkInDate.toISOString().slice(0, 10) : '',
    check_out: checkOutDate ? checkOutDate.toISOString().slice(0, 10) : '',
    accommodationShare: accommodationShare,
    total_guests: totalGuests
  };
}

async function generateAndStoreInvoice(bookingId) {
  console.log('>>> INVOICE generate called for bookingId:', bookingId);

  const booking = await wixData.get(BOOKINGS, bookingId);
  if (!booking) throw new Error('Booking ' + bookingId + ' not found');

  const quoteBreakdown = await buildQuoteBreakdown(booking.bookingNumber);
  console.log('>>> INVOICE quote total:', quoteBreakdown.total);

  const guest = {
    name: booking.guestName || '',
    email: booking.guestEmail || '',
    phone: booking.guestPhone || ''
  };
  const dates = {
    checkIn: quoteBreakdown.check_in,
    checkOut: quoteBreakdown.check_out,
    roomCode: booking.roomCode || ''
  };

  let result;
  try {
    result = await callIssueInvoice(guest, quoteBreakdown, dates, true, '', false, [], booking.bookingNumber);
    console.log('>>> INVOICE service returned number:', result.invoice_number);
  } catch (e) {
    console.log('>>> INVOICE callIssueInvoice ERROR:', e.message);
    throw new Error('Invoice generation failed: ' + e.message);
  }

  return {
    bookingNumber: result.invoice_number,
    total: result.total,
    emailed: result.emailed || false
  };
}

async function updateBookingSummary(bookingNumber, checkInArg, checkOutArg, optGuest, optAttribution, optPackageTitle) {
  if (!bookingNumber) {
    console.log('>>> updateBookingSummary SKIPPED — no bookingNumber');
    return;
  }
  console.log('>>> updateBookingSummary START for', bookingNumber, 'checkInArg:', checkInArg, 'checkOutArg:', checkOutArg);

  try {
    let checkIn = checkInArg || null;
    let checkOut = checkOutArg || null;

    // Fallback: derive dates from the Bookings rows if not provided.
    if (!checkIn || !checkOut) {
      const bookingsRes = await wixData.query(BOOKINGS)
        .eq('bookingNumber', bookingNumber)
        .limit(1000)
        .find();
      for (const row of bookingsRes.items) {
        if (!checkIn && row.checkIn) checkIn = row.checkIn;
        if (!checkOut && row.checkOut) checkOut = row.checkOut;
      }
    }

    // Fallback: use existing summary dates if still missing.
    if (!checkIn || !checkOut) {
      const existingSummaryRes = await wixData.query(BOOKING_SUMMARIES)
        .eq('bookingNumber', bookingNumber)
        .limit(1)
        .find({ suppressAuth: true });
      if (existingSummaryRes.items.length > 0) {
        const es = existingSummaryRes.items[0];
        if (!checkIn && es.checkIn) checkIn = es.checkIn;
        if (!checkOut && es.checkOut) checkOut = es.checkOut;
      }
    }

    console.log('>>> updateBookingSummary resolved checkIn:', checkIn, 'checkOut:', checkOut);

    const res = await wixData.query(BOOKINGS)
      .eq('bookingNumber', bookingNumber)
      .limit(1000)
      .find();

    console.log('>>> updateBookingSummary found', res.items.length, 'rows');

    if (res.items.length === 0) {
      console.log('>>> updateBookingSummary ABORT — zero rows found');
      return;
    }

    let guestName = optGuest && optGuest.guestName ? optGuest.guestName : '';
    let guestEmail = optGuest && optGuest.guestEmail ? optGuest.guestEmail : '';
    let guestPhone = optGuest && optGuest.guestPhone ? optGuest.guestPhone : '';
    let roomCount = 0;
    let status = '';
    let notes = '';

    for (const row of res.items) {
      roomCount += (row.quantity || 1);
      if (!status && row.status) status = row.status;
      if (!notes && row.note) notes = row.note;
    }

    const att = optAttribution || {};
    const anyGclid = att.gclid || '';
    const anyGbraid = att.gbraid || '';
    const anyWbraid = att.wbraid || '';
    const anyMsclkid = att.msclkid || '';

    const nowUtc = new Date();
    const todayNoonUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 12, 0, 0));
    const summary = {
      bookingNumber,
      checkIn: toDate(checkIn) || null,
      checkOut: toDate(checkOut) || null,
      guestName,
      guestEmail,
      guestPhone,
      roomCount,
      status: status || 'confirmed',
      gclid: anyGclid,
      gbraid: anyGbraid,
      wbraid: anyWbraid,
      msclkid: anyMsclkid,
      notes: notes || '',
      bookingDate: todayNoonUtc,
      packageTitle: optPackageTitle || ''
    };

    console.log('>>> updateBookingSummary computed:', JSON.stringify(summary).substring(0, 200));

    const existing = await wixData.query(BOOKING_SUMMARIES)
      .eq('bookingNumber', bookingNumber)
      .limit(1)
      .find({ suppressAuth: true });

    if (existing.items.length > 0) {
      summary._id = existing.items[0]._id;
      const existingBookingDate = toDate(existing.items[0].bookingDate);
      console.log('>>> updateBookingSummary existing bookingDate:', existingBookingDate, 'raw:', existing.items[0].bookingDate);
      summary.bookingDate = existingBookingDate || todayNoonUtc;
      console.log('>>> updateBookingSummary final bookingDate (update):', summary.bookingDate);
      const existingAtt = existing.items[0];
      // BookingSummary uses the CMS field key `packageTitle`.
      // Preserve it when later summary refreshes do not receive a package title,
      // and recover any value briefly written to the misspelled packageTitlle key.
      if (!summary.packageTitle) {
        summary.packageTitle = existingAtt.packageTitle || existingAtt.packageTitlle || '';
      }
      if (!summary.gbraid && existingAtt.gbraid) summary.gbraid = existingAtt.gbraid;
      if (!summary.wbraid && existingAtt.wbraid) summary.wbraid = existingAtt.wbraid;
      if (!summary.msclkid && existingAtt.msclkid) summary.msclkid = existingAtt.msclkid;
      if (existingAtt.googleConversionUploaded) summary.googleConversionUploaded = existingAtt.googleConversionUploaded;
      if (existingAtt.googleConversionRetracted) summary.googleConversionRetracted = existingAtt.googleConversionRetracted;
      if (existingAtt.microsoftConversionUploaded) summary.microsoftConversionUploaded = existingAtt.microsoftConversionUploaded;
      if (existingAtt.microsoftConversionRetracted) summary.microsoftConversionRetracted = existingAtt.microsoftConversionRetracted;
      console.log('>>> updateBookingSummary UPDATING row', existing.items[0]._id);
      await wixData.update(BOOKING_SUMMARIES, summary, { suppressAuth: true });
      console.log('>>> updateBookingSummary UPDATE complete');
    } else {
      console.log('>>> updateBookingSummary INSERTING new row with bookingDate:', summary.bookingDate);
      await wixData.insert(BOOKING_SUMMARIES, summary, { suppressAuth: true });
      console.log('>>> updateBookingSummary INSERT complete');
    }
  } catch (e) {
    console.log('>>> updateBookingSummary ERROR:', e.message);
    throw e;
  }
}
async function overlappingCount(roomCode, checkIn, checkOut) {
  let total = 0;
  const seenIds = [];

  const summaryRes = await wixData.query(BOOKING_SUMMARIES)
    .lt('checkIn', toDate(checkOut) || new Date(checkOut))
    .gt('checkOut', toDate(checkIn) || new Date(checkIn))
    .limit(1000)
    .find({ suppressAuth: true });

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
      .find({ suppressAuth: true });
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

  const summaryRes = await wixData.query(BOOKING_SUMMARIES)
    .lt('checkIn', toDate(checkOut) || new Date(checkOut))
    .gt('checkOut', toDate(checkIn) || new Date(checkIn))
    .limit(1000)
    .find({ suppressAuth: true });

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
      .find({ suppressAuth: true });
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

async function createDraftInvoice(bookingNumber, financials, checkIn, checkOut, packageTitle) {
  // Only create one draft row per booking. If a draft/active row already exists,
  // update it instead so multiple rooms don't create duplicate invoice rows.
  const existingRes = await wixData.query(BOOKING_INVOICES)
    .eq('bookingNumber', bookingNumber)
    .hasSome('status', ['Active', 'Draft'])
    .descending('_createdDate')
    .limit(1)
    .find({ suppressAuth: true });

  const invoiceNumber = financials.invoiceNumber || '';
  const updates = {
    invoiceNumber,
    invoiceUrl: '',
    checkIn: toDate(checkIn),
    checkOut: toDate(checkOut),
    roomTotal: financials.roomTotal || 0,
    grandTotal: financials.grandTotal || 0,
    accommodationVat: financials.accommodationVat || 0,
    packageVat: financials.packageVat || 0,
    propertyFee: financials.propertyFee || 0,
    promoCode: financials.promoCode || '',
    promoDiscountAmount: financials.promoDiscountAmount || 0,
    packageTitle: packageTitle || ''
  };

  try {
    if (existingRes.items.length > 0) {
      const existing = existingRes.items[0];
      // Accumulate numeric financial fields across multiple rooms.
      existing.invoiceNumber = updates.invoiceNumber;
      existing.checkIn = updates.checkIn;
      existing.checkOut = updates.checkOut;
      existing.invoiceUrl = updates.invoiceUrl;
      existing.promoCode = updates.promoCode || existing.promoCode || '';
      existing.packageTitle = existing.packageTitle || updates.packageTitle || '';
      existing.roomTotal = Number(existing.roomTotal || 0) + Number(updates.roomTotal || 0);
      existing.propertyFee = Number(existing.propertyFee || 0) + Number(updates.propertyFee || 0);
      existing.accommodationVat = Number(existing.accommodationVat || 0) + Number(updates.accommodationVat || 0);
      existing.packageVat = Number(existing.packageVat || 0) + Number(updates.packageVat || 0);
      existing.grandTotal = Number(existing.grandTotal || 0) + Number(updates.grandTotal || 0);
      existing.promoDiscountAmount = Number(existing.promoDiscountAmount || 0) + Number(updates.promoDiscountAmount || 0);
      await wixData.update(BOOKING_INVOICES, existing, { suppressAuth: true });
      return existing;
    }

    const newRow = Object.assign({ bookingNumber, status: 'Draft' }, updates);
    return await wixData.insert(BOOKING_INVOICES, newRow, { suppressAuth: true });
  } catch (e) {
    console.log('>>> createDraftInvoice ERROR:', e.message);
    throw e;
  }
}

async function getActiveInvoice(bookingNumber) {
  try {
    const res = await wixData.query(BOOKING_INVOICES)
      .eq('bookingNumber', bookingNumber)
      .hasSome('status', ['Active', 'Draft'])
      .descending('_createdDate')
      .limit(1)
      .find({ suppressAuth: true });
    return res.items[0] || null;
  } catch (e) {
    console.log('>>> getActiveInvoice ERROR:', e.message);
    return null;
  }
}

async function createBookingImpl(booking) {
  console.log('>>> SERVER createBooking called:', JSON.stringify(booking).substring(0, 200));
  const roomCode = booking.roomCode;
  const checkIn = toDate(booking.checkIn);
  const checkOut = toDate(booking.checkOut);
  if (!checkIn || !checkOut) throw new Error('checkIn and checkOut must be valid dates');
  const guests = booking.guests || 1;
  const guestName = booking.guestName;
  const guestEmail = booking.guestEmail;
  const guestPhone = booking.guestPhone;
  const note = booking.note;
  let saveNote = note;
  const providedBookingNumber = booking.bookingNumber;
  const quantity = Math.max(1, parseInt(booking.quantity || 1, 10) || 1);

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

  const currentlyBooked = await overlappingCount(roomCode, checkIn, checkOut);
  if (currentlyBooked + quantity > ROOM_UNITS[roomCode]) {
    throw new Error('Only ' + (ROOM_UNITS[roomCode] - currentlyBooked) + ' ' + roomDisplay + '(s) available for ' + checkIn + ' to ' + checkOut);
  }

  let bookingNumber = providedBookingNumber || '';
  if (!bookingNumber) {
    try {
      bookingNumber = await getNextBookingNumber();
      console.log('>>> SERVER generated bookingNumber:', bookingNumber);
    } catch (e) {
      console.log('>>> SERVER getNextBookingNumber ERROR:', e.message);
      bookingNumber = '';
    }
  }
  if (!bookingNumber) {
    bookingNumber = 'WC-' + Date.now();
    console.log('>>> SERVER fallback bookingNumber:', bookingNumber);
  }

  const nights = nightsBetween(checkIn, checkOut);
  const currentPackage = await getPackagePricingForBooking(booking.packageId || '', nights);
  const lockedQuote = await verifyLockedPricingQuote(booking.pricingQuoteToken, {
    packageId: currentPackage._id,
    checkIn,
    checkOut,
  });
  const packagePricing = {
    packageId: lockedQuote.packageId,
    packageTitle: lockedQuote.packageTitle || currentPackage.packageTitle,
    baseRate: Number(lockedQuote.baseRate),
    priceModifier: normalizePriceModifier(lockedQuote.priceModifier),
  };
  const stayPricing = { totalPerPerson: Number(lockedQuote.totalPerPerson) };
  const roomFee = await getAuthoritativeRoomFee(roomCode);
  const grossRoomTotal = roundMoney(
    (stayPricing.totalPerPerson * guests * quantity) + (roomFee * nights * quantity)
  );

  let promoDiscountRate = 0;
  let promoCode = '';
  if (booking.promoCode && String(booking.promoCode).trim()) {
    const promoResult = await validatePromoCodeImpl(String(booking.promoCode).trim(), nights);
    if (!promoResult.valid) throw new Error(promoResult.reason || 'Invalid promo code');
    promoDiscountRate = promoResult.discount;
    promoCode = promoResult.code;
  }

  // Promo applies to the entire booking subtotal before taxes and property fee.
  const computedRoomTotal = roundMoney(grossRoomTotal * (1 - promoDiscountRate));
  const settings = await getAllSettings();
  const propertyFeeRate = parseFloat(settings.propertyFeeRate) || 0.05;
  const accommodationShare = 0.5;
  const taxRateAccommodation = parseFloat(settings.taxRate_accommodation) || 0.10;
  const taxRateAdventure = parseFloat(settings.taxRate_standard) || 0.15;
  const computedPropertyFee = roundMoney(computedRoomTotal * propertyFeeRate);
  const computedAccVat = roundMoney(computedRoomTotal * accommodationShare * taxRateAccommodation);
  const computedPkgVat = roundMoney(computedRoomTotal * (1 - accommodationShare) * taxRateAdventure);
  const computedGrandTotal = roundMoney(computedRoomTotal + computedPropertyFee + computedAccVat + computedPkgVat);

  const toInsert = {
    roomCode: roomCode,
    guests: guests,
    status: booking.status || 'confirmed',
    quantity: quantity,
    roomFee: roomFee,
    bookingNumber: bookingNumber,
    checkIn: toDate(checkIn),
    checkOut: toDate(checkOut),
    note: saveNote || ''
  };
  console.log('>>> SERVER toInsert keys:', Object.keys(toInsert).join(', '), '| bookingNumber:', toInsert.bookingNumber);
  const inserted = await wixData.insert(BOOKINGS, toInsert);
  inserted.bookingNumber = bookingNumber || inserted.bookingNumber || '';

  const packageTitle = packagePricing.packageTitle || booking.packageTitle || '';

  const financials = {
    roomTotal: computedRoomTotal,
    propertyFee: computedPropertyFee,
    accommodationVat: computedAccVat,
    packageVat: computedPkgVat,
    grandTotal: computedGrandTotal,
    promoCode,
    promoDiscountAmount: roundMoney(grossRoomTotal - computedRoomTotal)
  };

  try {
    await createDraftInvoice(inserted.bookingNumber, financials, checkIn, checkOut, packageTitle);
    console.log('>>> SERVER draft invoice created for', inserted.bookingNumber);
  } catch (e) {
    console.log('>>> SERVER createDraftInvoice ERROR:', e.message);
  }

  const countNow = await overlappingCount(roomCode, checkIn, checkOut);
  if (countNow > ROOM_UNITS[roomCode]) {
    await wixData.remove(BOOKINGS, inserted._id);
    throw new Error('Booking conflict — ' + roomCode + ' was just taken. Please retry.');
  }

  console.log('>>> SERVER calling updateBookingSummary for', inserted.bookingNumber);
  try {
    await updateBookingSummary(inserted.bookingNumber, toDate(checkIn), toDate(checkOut), {
      guestName: guestName || '',
      guestEmail: guestEmail || '',
      guestPhone: guestPhone || ''
    }, {
      gclid: booking.gclid || '',
      gbraid: booking.gbraid || '',
      wbraid: booking.wbraid || '',
      msclkid: booking.msclkid || ''
    }, packageTitle);
  } catch (e) {
    console.log('>>> SERVER updateBookingSummary ERROR:', e.message);
  }

  console.log('>>> SERVER createBooking complete. bookingNumber:', inserted.bookingNumber);
  return inserted;
}

export const createBooking = webMethod(
  Permissions.Anyone,
  createBookingImpl
);


export const issueBookingInvoice = webMethod(
  Permissions.Anyone,
  async (bookingNumber, ownerOnly) => {
    ownerOnly = ownerOnly || false;
    if (!bookingNumber) throw new Error('bookingNumber required');

    const bookingsRes = await wixData.query(BOOKINGS)
      .eq('bookingNumber', bookingNumber)
      .limit(1000)
      .find();

    if (bookingsRes.items.length === 0) {
      throw new Error('No bookings found for ' + bookingNumber);
    }

    const firstRow = bookingsRes.items[0];

    let checkInDate = '', checkOutDate = '';
    let summaryRow = null;
    try {
      const summaryRes = await wixData.query(BOOKING_SUMMARIES)
        .eq('bookingNumber', bookingNumber)
        .limit(1)
        .find({ suppressAuth: true });
      if (summaryRes.items.length > 0) {
        summaryRow = summaryRes.items[0];
        if (summaryRow.checkIn) checkInDate = new Date(summaryRow.checkIn).toISOString().slice(0, 10);
        if (summaryRow.checkOut) checkOutDate = new Date(summaryRow.checkOut).toISOString().slice(0, 10);
      }
    } catch (summaryErr) {
      console.log('>>> issueBookingInvoice BookingSummary read ERROR:', summaryErr.message);
    }

    const activeInvoice = await getActiveInvoice(bookingNumber);
    if (!checkInDate || !checkOutDate) {
      if (activeInvoice && activeInvoice.checkIn && activeInvoice.checkOut) {
        checkInDate = new Date(activeInvoice.checkIn).toISOString().slice(0, 10);
        checkOutDate = new Date(activeInvoice.checkOut).toISOString().slice(0, 10);
      }
    }

    let packageTitle = summaryRow && summaryRow.packageTitle
      ? summaryRow.packageTitle
      : (activeInvoice && activeInvoice.packageTitle ? activeInvoice.packageTitle : '');
    let includedAmenities = '';
    try {
      const nights = nightsBetween(checkInDate, checkOutDate);
      if (nights > 0) {
        const pkgRes = await wixData.query('Packages').limit(1000).find();
        for (const pkg of pkgRes.items) {
          const itemNights = pkg.NumberOfNights || pkg.numberOfNights || pkg.numberofnights || 0;
          const candidateTitle = pkg.title_fld || pkg.Title || pkg.title || pkg.name || pkg.Name || '';
          const titleMatches = packageTitle
            ? String(candidateTitle).trim() === String(packageTitle).trim()
            : true;
          if (Number(itemNights) === Number(nights) && titleMatches) {
            if (!packageTitle) packageTitle = candidateTitle;
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

    const quoteBreakdown = await buildQuoteBreakdown(bookingNumber);
    quoteBreakdown.package_title = packageTitle;
    quoteBreakdown.included_amenities = includedAmenities;

    const dates = {
      checkIn: checkInDate,
      checkOut: checkOutDate,
      roomCode: bookingsRes.items.map(function (r) { return r.roomCode; }).join(', ')
    };

    console.log('>>> issueBookingInvoice calling invoice service with dates:', JSON.stringify({
      checkIn: dates.checkIn,
      checkOut: dates.checkOut,
      guestPresent: !!(guest.name && guest.email),
      accommodationShare: quoteBreakdown.accommodationShare,
    }));

    const invoiceNumber = await getNextInvoiceNumber();

    // Fetch payments for this booking to show in the Payment Summary section.
    let payments = [];
    try {
      const payRes = await wixData.query('BookingPayments')
        .eq('bookingNumber', bookingNumber)
        .find();
      payments = (payRes.items || []).map(function (p) {
        return {
          datePaid: p.datePaid ? p.datePaid.toISOString().slice(0, 10) : '',
          paymentAmount: p.paymentAmount || 0
        };
      });
    } catch (payErr) {
      console.log('>>> issueBookingInvoice payment fetch error:', payErr.message);
    }

    const result = await callIssueInvoice(guest, quoteBreakdown, dates, true, invoiceNumber, ownerOnly, payments, bookingNumber);
    console.log('>>> issueBookingInvoice full service result keys:', Object.keys(result || {}).join(','));
    console.log('>>> issueBookingInvoice full service result:', JSON.stringify(result));
    console.log('>>> CALENDAR result from invoice service:', JSON.stringify(
      result._calendar_debug || result.calendar || result.calendar_error || 'no-calendar-field'
    ));

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
    console.log('>>> issueBookingInvoice invoiceUrl from service:', invoiceUrl);

    const totals = {
      roomTotal: quoteBreakdown.subtotal_net || 0,
      grandTotal: quoteBreakdown.total || 0,
      accommodationVat: (quoteBreakdown.vat_by_class && quoteBreakdown.vat_by_class.accommodation) || 0,
      packageVat: (quoteBreakdown.vat_by_class && quoteBreakdown.vat_by_class.standard) || 0,
      propertyFee: quoteBreakdown.property_fee || 0,
      promoCode: quoteBreakdown.promo_code || '',
      promoDiscountAmount: quoteBreakdown.promo_discount_amount || 0
    };

    try {
      await recordBookingInvoice(bookingNumber, invoiceNumber, invoiceUrl, totals, toDate(checkInDate), toDate(checkOutDate));
      console.log('>>> issueBookingInvoice recorded invoice', invoiceNumber, 'for booking', bookingNumber);
    } catch (invErr) {
      console.log('>>> issueBookingInvoice recordBookingInvoice ERROR:', invErr.message);
    }

    // Mirror active invoice dates onto BookingSummary.
    try {
      const summaryRes = await wixData.query(BOOKING_SUMMARIES)
        .eq('bookingNumber', bookingNumber)
        .limit(1)
        .find({ suppressAuth: true });
      if (summaryRes.items.length > 0) {
        const sItem = summaryRes.items[0];
        sItem.checkIn = toDate(checkInDate);
        sItem.checkOut = toDate(checkOutDate);
        sItem.bookingDate = toDate(sItem.bookingDate) || toDate(new Date().toISOString());
        await wixData.update(BOOKING_SUMMARIES, sItem, { suppressAuth: true });
        console.log('>>> issueBookingInvoice mirrored dates to BookingSummary');
      }
    } catch (e) {
      console.log('>>> issueBookingInvoice mirror dates ERROR:', e.message);
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

      try {
        const summaryRes = await wixData.query(BOOKING_SUMMARIES)
          .eq('bookingNumber', b.bookingNumber)
          .limit(1)
          .find({ suppressAuth: true });
        if (summaryRes.items.length > 0) {
          const summary = summaryRes.items[0];
          if (summary.googleConversionUploaded === true && summary.googleConversionRetracted !== true) {
            let adjResult;
            if (await isGoogleAdsSuspended()) {
              console.log('[WBE-CANCEL] skipping Google Ads conversion retraction — suspendGoogleAds is enabled');
              adjResult = { ok: true, suspended: true };
            } else {
              adjResult = await adjustBookingConversion({
                transactionId: b.bookingNumber,
                gclid: summary.gclid || '',
                gbraid: summary.gbraid || '',
                wbraid: summary.wbraid || '',
                email: summary.guestEmail || '',
                phone: summary.guestPhone || '',
                originalEvent: { conversionTime: summary.bookingDate || new Date().toISOString() },
                adjustmentType: 'RETRACTION',
                currency: 'USD'
              });
            }
            console.log('>>> SERVER cancelBooking adjustment result:', JSON.stringify(adjResult).substring(0, 300));
            if (adjResult && adjResult.ok) {
              summary.googleConversionRetracted = true;
              summary.status = 'In Process';
              await wixData.update(BOOKING_SUMMARIES, summary);
            }
          }
        }
      } catch (adjErr) {
        console.log('>>> SERVER cancelBooking adjustment ERROR:', adjErr.message);
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
      guests: 1,
      status: 'blocked',
      quantity: actual,
      note: note,
      checkIn: toDate(checkIn),
      checkOut: toDate(checkOut),
      bookingNumber: await getNextBookingNumber(),
    };
    const inserted = await wixData.insert(BOOKINGS, toInsert);

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

async function validatePromoCodeImpl(code, totalGuestNights) {
  if (!code || !code.trim()) {
    return { valid: false, reason: 'No promo code provided.' };
  }
  const now = new Date();
  try {
    const res = await wixData.query('PromoCodes').limit(1000).find();
    let found = null;
    for (const item of res.items) {
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
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      if (now > endOfDay) {
        return { valid: false, reason: 'Promo code has expired.' };
      }
    }
    const minimumNights = parseInt(found.minimumNights, 10) || 0;
    if (minimumNights > 0 && (totalGuestNights || 0) < minimumNights) {
      return { valid: false, reason: `Promo code requires a minimum of ${minimumNights} nights.` };
    }

    const discount = parseFloat(found.discount) || 0;
    if (discount <= 0 || discount > 1) {
      return { valid: false, reason: 'Invalid discount value.' };
    }
    const description = found.description || found.Description || found.desc || found.Desc || found.description_fld || '';
    return { valid: true, code: String(code).trim(), discount, description };
  } catch (e) {
    return { valid: false, reason: 'Error validating promo code: ' + e.message };
  }
}

export const validatePromoCode = webMethod(
  Permissions.Anyone,
  validatePromoCodeImpl
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