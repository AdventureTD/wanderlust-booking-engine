import wixData from 'wix-data';
import { items } from '@wix/data';
import { cancelReservation, cancellationRows, isCancelled, assertCancellationWriteAllowed, reservationCancellationVerified } from 'backend/bookingCancellation';
import { Permissions, webMethod } from 'wix-web-module';
import { cancellationEffects, readCancellationEffects } from 'backend/cancellationEffects';

import { currentUser } from 'wix-users-backend';
import { searchAvailability } from 'backend/search.web';
import { issueBookingInvoice } from 'backend/availability.web';


const BOOKINGS = 'Bookings';
const BOOKING_SUMMARIES = 'BookingSummary';
const BOOKING_PAYMENTS = 'BookingPayments';
const BOOKING_INVOICES = 'BookingInvoices';
const INVOICE_SERVICE_URL_KEY = 'WBE_INVOICE_SERVICE_URL';
const SHARED_SECRET_KEY = 'WBE_SHARED_SECRET';
const MAX_PAYMENT_RECORDS_PER_BOOKING = 4;

// Permissions.Admin on the webMethod restricts calls to signed-in members with
// admin privileges. This adds an explicit role check as a second layer.
async function requireAdmin() {
  try {
    if (!currentUser.loggedIn) throw new Error('Not signed in');
    const roles = await currentUser.getRoles();
    const names = (roles || []).map(function (r) { return (r && (r.title || r.name || r.roleName)) || ''; });
    const ok = names.some(function (n) { return /admin/i.test(n); });
    if (!ok) throw new Error('Admin role required. Roles: ' + names.join(','));
  } catch (e) {
    throw new Error('Unauthorized: ' + (e && e.message || e));
  }
}

function money(n) {
  const v = Number(n);
  return isNaN(v) ? 0 : Math.round(v * 100) / 100;
}

function paymentRecordLimitReached(paymentRows) {
  return (paymentRows || []).length >= MAX_PAYMENT_RECORDS_PER_BOOKING;
}

async function ensurePaymentRecordCapacity(bookingNumber) {
  const existing = await wixData.query(BOOKING_PAYMENTS)
    .eq('bookingNumber', bookingNumber)
    .limit(MAX_PAYMENT_RECORDS_PER_BOOKING + 1)
    .find();
  if (paymentRecordLimitReached(existing.items)) {
    return 'A booking can contain a maximum of ' + MAX_PAYMENT_RECORDS_PER_BOOKING + ' payment or refund records.';
  }
  return '';
}

function normalizeDate(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), 12, 0, 0));
  }
  let str = String(v).trim();
  const tIndex = str.indexOf('T');
  if (tIndex !== -1) str = str.substring(0, tIndex);
  const spaceIndex = str.indexOf(' ');
  if (spaceIndex !== -1) str = str.substring(0, spaceIndex);
  const parts = str.split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  const out = new Date(Date.UTC(y, m, d, 12, 0, 0));
  return isNaN(out.getTime()) ? null : out;
}

function isoDate(d) {
  if (!d) return '';
  try {
    const dt = d instanceof Date ? d : normalizeDate(d);
    if (!dt || isNaN(dt.getTime())) return '';
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  } catch (e) { return ''; }
}

// ---------- LIST ----------

export const adminListBookings = webMethod(
  Permissions.Admin,
  async ({ search, status, dateFrom, dateTo, sortBy, sortDir, limit }) => {
    await requireAdmin();
    const fromDate = normalizeDate(dateFrom);
    const toDate = normalizeDate(dateTo);
    let q = wixData.query(BOOKING_SUMMARIES).limit(Math.min(limit || 100, 500));

    if (status && status !== 'All') q = q.eq('status', status);
    if (fromDate) q = q.ge('checkOut', fromDate);
    if (toDate) q = q.le('checkOut', toDate);

    if (search) {
      const s = String(search).trim();
      // wix-data has no OR across fields in one query; search by bookingNumber
      // first, then fall back to guestName contains. We do two queries.
      const byBn = await wixData.query(BOOKING_SUMMARIES)
        .contains('bookingNumber', s).limit(50).find();
      const byName = await wixData.query(BOOKING_SUMMARIES)
        .contains('guestName', s).limit(50).find();
      const byEmail = await wixData.query(BOOKING_SUMMARIES)
        .contains('guestEmail', s).limit(50).find();
      const seen = {};
      const items = [];
      [byBn, byName, byEmail].forEach(function (res) {
        res.items.forEach(function (it) {
          if (!seen[it._id]) { seen[it._id] = true; items.push(it); }
        });
      });
      // Apply status/date filters in memory for searched sets
      const filtered = items.filter(function (it) {
        if (status && status !== 'All' && it.status !== status) return false;
        if (fromDate && isoDate(it.checkOut || '') < isoDate(fromDate)) return false;
        if (toDate && isoDate(it.checkOut || '') > isoDate(toDate)) return false;
        return true;
      });
      return { ok: true, items: sortItems(await attachActiveInvoices(filtered), sortBy, sortDir) };
    }

    const res = await q.find();
    return { ok: true, items: sortItems(await attachActiveInvoices(res.items), sortBy, sortDir) };
  }
);


async function attachActiveInvoices(items) {
  const numbers = items.map(function (i) { return i.bookingNumber; }).filter(Boolean);
  const map = {};
  if (numbers.length) {
    const invRes = await wixData.query(BOOKING_INVOICES)
      .hasSome('bookingNumber', numbers)
      .eq('status', 'Active')
      .limit(500)
      .find();
    invRes.items.forEach(function (inv) {
      if (!map[inv.bookingNumber]) map[inv.bookingNumber] = inv;
    });
  }
  return items.map(function (i) {
    const inv = map[i.bookingNumber];
    i.grandTotal = inv ? inv.grandTotal : 0;
    i.activeInvoice = inv || null;
    return i;
  });
}

function sortItems(items, sortBy, sortDir) {
  const field = sortBy || 'checkIn';
  const dir = (sortDir || 'asc') === 'desc' ? -1 : 1;
  return items.slice().sort(function (a, b) {
    const av = a[field] == null ? '' : String(a[field]);
    const bv = b[field] == null ? '' : String(b[field]);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

// ---------- DETAIL ----------

export const adminGetBooking = webMethod(
  Permissions.Admin,
  async (bookingNumber) => {
    await requireAdmin();
    const summaries = await cancellationRows(BOOKING_SUMMARIES, bookingNumber);
    if (summaries.length !== 1) return { ok: false, error: 'Exactly one BookingSummary required' };
    const summary = summaries[0];
    const bRes = { items: await cancellationRows(BOOKINGS, bookingNumber) };
    const pRes = { items: await cancellationRows(BOOKING_PAYMENTS, bookingNumber) };
    const invoices = (await cancellationRows(BOOKING_INVOICES, bookingNumber)).sort((a,b) => new Date(b._createdDate || 0).getTime() - new Date(a._createdDate || 0).getTime());
    const activeInvoice = invoices.find(function (i) { return i.status === 'Active'; }) || invoices[0] || null;

    const payments = pRes.items.map(paymentDto);
    return {
      ok: true,
      cancellation: cancellationProjection(await reservationCancellationVerified(summary,bRes.items) ? 'CANCELLED' : 'NOT_VERIFIED', await readCancellationEffects(summary)),
      summary: summary,
      rooms: bRes.items,
      payments: payments,
      invoices: invoices,
      activeInvoice: activeInvoice,
      totals: computeTotals(activeInvoice || summary, payments, summary),
    };
  }
);

function cancellationProjection(reservation, effects) {
  const coreComplete = reservation === 'CANCELLED' && effects.email === 'ACKNOWLEDGED' && effects.calendar === 'CANCELLED';
  // GA4 transport receipt is deliberately not processing confirmation.
  const complete = coreComplete && effects.ads === 'ACKNOWLEDGED' && effects.ga4 === 'ACKNOWLEDGED';
  return {reservation, coreComplete, complete, effects};
}

function paymentDto(p) {
  return {
    paymentId: p.paymentId || p._id,
    bookingNumber: p.bookingNumber,
    datePaid: p.datePaid,
    paymentAmount: money(p.paymentAmount),
    paymentType: p.paymentType || (money(p.paymentAmount) < 0 ? 'refund' : 'payment'),
    paymentMethod: p.paymentMethod || '',
    note: p.note || '',
  };
}

function computeTotals(invoiceOrSummary, payments, summary) {
  const grand = money(invoiceOrSummary && (invoiceOrSummary.grandTotal || invoiceOrSummary.totalInvoice));
  let paid = 0, refunded = 0;
  payments.forEach(function (p) {
    const amt = money(p.paymentAmount);
    if (amt >= 0) paid += amt; else refunded += -amt;
  });
  return {
    grandTotal: grand,
    totalPaid: money(paid),
    totalRefunded: money(refunded),
    balance: summary && isCancelled(summary.status) && summary.cancellationSettlement === 'FULL_NO_FEE' ? 0 : money(grand - paid + refunded),
  };
}

// ---------- UPDATE ----------

// Server-side field patch preserves cancellation-owned status/settlement fields.
// No read/merge/update fallback: that would restore the stale-writer race.
async function patchAdminFields(collection, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  let patch = items.patch(collection,id);
  for (const key of keys) patch = patch.setField(key,fields[key]);
  await patch.run();
}

export const adminUpdateBooking = webMethod(
  Permissions.Admin,
  async (bookingNumber, changes) => {
    await requireAdmin();
    if (!bookingNumber) throw new Error('bookingNumber required');
    const ch = changes || {};
    if (ch.status !== undefined) throw new Error('Status changes require the dedicated cancellation workflow; reactivation is not supported');

    const sRes = await wixData.query(BOOKING_SUMMARIES)
      .eq('bookingNumber', bookingNumber).limit(1).find();
    if (!sRes.items.length) return { ok: false, error: 'BookingSummary not found' };
    const summary = sRes.items[0];

    const bRes = await wixData.query(BOOKINGS)
      .eq('bookingNumber', bookingNumber).limit(50).find();
    if (!bRes.items.length) return { ok: false, error: 'No Bookings rows' };
    const rooms = bRes.items;

    const iRes = await wixData.query(BOOKING_INVOICES)
      .eq('bookingNumber', bookingNumber)
      .hasSome('status', ['Active', 'Draft'])
      .descending('_createdDate')
      .limit(1)
      .find();
    const invoice = iRes.items[0] || null;

    const rawCi = ch.checkIn || isoDate(summary.checkIn);
    const rawCo = ch.checkOut || isoDate(summary.checkOut);
    const newCi = normalizeDate(rawCi) || summary.checkIn;
    const newCo = normalizeDate(rawCo) || summary.checkOut;
    const datesChanged = (isoDate(newCi) !== isoDate(summary.checkIn)) || (isoDate(newCo) !== isoDate(summary.checkOut));
    const invoiceTriggerFields = ['checkIn','checkOut','roomTotal','grandTotal','accommodationVat','packageVat','propertyFee','promoCode','promoDiscountAmount'];
    const invoiceFieldsChanged = invoiceTriggerFields.some(function (k) { return ch[k] !== undefined; });

    // Availability check when dates changed (exclude this booking's own rows).
    if (datesChanged) {
      const av = await searchAvailability(new Date(newCi), new Date(newCo));
      if (!av.ok) return { ok: false, error: 'Availability check failed: ' + (av.error || '') };
      const needed = {};
      rooms.forEach(function (r) { needed[r.roomCode] = (needed[r.roomCode] || 0) + (r.quantity || 1); });
      for (const rc of Object.keys(needed)) {
        const row = (av.results || []).find(function (x) { return x.roomCode === rc && x.status === 'full'; });
        if (!row || row.maxQty < needed[rc]) {
          return {
            ok: false,
            error: 'Room ' + rc + ' not available for ' + newCi + ' to ' + newCo +
              ' (need ' + needed[rc] + ', found ' + (row ? row.maxQty : 0) + ').',
          };
        }
      }
    }

    // Apply to Bookings rows (no financial fields).
    for (const r of rooms) {
      const updated = {};
      if (ch.guestName !== undefined) updated.guestName = ch.guestName;
      if (ch.guestEmail !== undefined) updated.guestEmail = ch.guestEmail;
      if (ch.guestPhone !== undefined) updated.guestPhone = ch.guestPhone;
      if (ch.numGuests !== undefined) updated.guests = Number(ch.numGuests) || r.guests;

      if (datesChanged) { updated.checkIn = newCi instanceof Date ? newCi : new Date(newCi); updated.checkOut = newCo instanceof Date ? newCo : new Date(newCo); }
      await assertCancellationWriteAllowed(bookingNumber);
      await patchAdminFields(BOOKINGS, r._id, updated);
    }

    // Apply to BookingSummary (no financial fields).
    const sUpd = {};
    if (ch.guestName !== undefined) sUpd.guestName = ch.guestName;
    if (ch.guestEmail !== undefined) sUpd.guestEmail = ch.guestEmail;
    if (ch.guestPhone !== undefined) sUpd.guestPhone = ch.guestPhone;

    if (ch.notes !== undefined) sUpd.notes = ch.notes;
    if (ch.gclid !== undefined) sUpd.gclid = ch.gclid;
    if (ch.gbraid !== undefined) sUpd.gbraid = ch.gbraid;
    if (ch.wbraid !== undefined) sUpd.wbraid = ch.wbraid;
    if (ch.googleConversionUploaded !== undefined) sUpd.googleConversionUploaded = ch.googleConversionUploaded;
    if (ch.googleConversionRetracted !== undefined) sUpd.googleConversionRetracted = ch.googleConversionRetracted;
    if (datesChanged) { sUpd.checkIn = newCi instanceof Date ? newCi : new Date(newCi); sUpd.checkOut = newCo instanceof Date ? newCo : new Date(newCo); }
    await assertCancellationWriteAllowed(bookingNumber);
    await patchAdminFields(BOOKING_SUMMARIES, summary._id, sUpd);

    // Apply financial changes to the active/draft BookingInvoices record.
    if (invoice) {
      const invUpd = Object.assign({}, invoice);
      if (ch.roomTotal !== undefined) invUpd.roomTotal = money(ch.roomTotal);
      if (ch.grandTotal !== undefined) invUpd.grandTotal = money(ch.grandTotal);
      if (ch.accommodationVat !== undefined) invUpd.accommodationVat = money(ch.accommodationVat);
      if (ch.packageVat !== undefined) invUpd.packageVat = money(ch.packageVat);
      if (ch.propertyFee !== undefined) invUpd.propertyFee = money(ch.propertyFee);
      if (ch.promoCode !== undefined) invUpd.promoCode = ch.promoCode;
      if (ch.promoDiscountAmount !== undefined) invUpd.promoDiscountAmount = money(ch.promoDiscountAmount);
      if (datesChanged) { invUpd.checkIn = new Date(newCi); invUpd.checkOut = new Date(newCo); }
      await assertCancellationWriteAllowed(invoice.bookingNumber);
    await wixData.update(BOOKING_INVOICES, invUpd);
    }

    // Generate new invoice when material details changed.
    let invoiceResult = null;
    if (invoiceFieldsChanged) {
      try {
        invoiceResult = await issueBookingInvoice(bookingNumber, false);
      } catch (invErr) {
        console.log('>>> adminUpdateBooking invoice generation ERROR:', invErr.message);
        invoiceResult = { error: invErr.message };
      }
    }

    return { ok: true, bookingNumber: bookingNumber, invoiceGenerated: invoiceFieldsChanged, invoiceResult: invoiceResult };
  }
);

export const adminUpdateInvoice = webMethod(
  Permissions.Admin,
  async (invoiceId, changes) => {
    await requireAdmin();
    if (!invoiceId) return { ok: false, error: 'invoiceId required' };
    const ch = changes || {};
    const invRes = await wixData.query(BOOKING_INVOICES)
      .eq('_id', invoiceId)
      .limit(1)
      .find();
    if (!invRes.items.length) return { ok: false, error: 'Invoice not found' };
    const invoice = invRes.items[0];
    const invUpd = Object.assign({}, invoice);

    if (ch.invoiceNumber !== undefined) invUpd.invoiceNumber = String(ch.invoiceNumber || '');
    if (ch.checkIn !== undefined) invUpd.checkIn = normalizeDate(ch.checkIn) || invoice.checkIn;
    if (ch.checkOut !== undefined) invUpd.checkOut = normalizeDate(ch.checkOut) || invoice.checkOut;
    if (ch.roomTotal !== undefined) invUpd.roomTotal = money(ch.roomTotal);
    if (ch.grandTotal !== undefined) invUpd.grandTotal = money(ch.grandTotal);
    if (ch.packageVat !== undefined) invUpd.packageVat = money(ch.packageVat);
    if (ch.accommodationVat !== undefined) invUpd.accommodationVat = money(ch.accommodationVat);
    if (ch.propertyFee !== undefined) invUpd.propertyFee = money(ch.propertyFee);
    if (ch.promoCode !== undefined) invUpd.promoCode = String(ch.promoCode || '');
    if (ch.promoDiscountAmount !== undefined) invUpd.promoDiscountAmount = money(ch.promoDiscountAmount);

    await assertCancellationWriteAllowed(invoice.bookingNumber);
    await wixData.update(BOOKING_INVOICES, invUpd);
    return { ok: true, invoiceId: invoiceId };
  }
);

// ---------- INVOICES ----------

export const adminListInvoices = webMethod(
  Permissions.Admin,
  async (bookingNumber) => {
    await requireAdmin();
    const res = await wixData.query(BOOKING_INVOICES)
      .eq('bookingNumber', bookingNumber)
      .descending('_createdDate')
      .limit(200)
      .find();
    return { ok: true, items: res.items };
  }
);

export const adminIssueNewInvoice = webMethod(
  Permissions.Admin,
  async (bookingNumber) => {
    await requireAdmin();
    if (!bookingNumber) throw new Error('bookingNumber required');
    await assertCancellationWriteAllowed(bookingNumber);
    const result = await issueBookingInvoice(bookingNumber, true);
    return { ok: true, bookingNumber: bookingNumber, invoiceNumber: result.invoice_number, invoiceUrl: result.invoice_url };
  }
);

// ---------- CANCEL ----------

export const adminCancelBooking = webMethod(
  Permissions.Admin,
  async (bookingNumber, reason) => {
    await requireAdmin();
    if (typeof bookingNumber !== 'string' || !bookingNumber || bookingNumber.length > 100 ||
        (reason !== undefined && (typeof reason !== 'string' || reason.length > 2000))) throw new Error('Invalid cancellation input');
    const context = await cancelReservation(bookingNumber, reason);
    const effects = await cancellationEffects(context);
    return { ok: true, bookingNumber, ...cancellationProjection('CANCELLED', effects) };
  }
);

// ---------- PAYMENTS ----------

async function nextPaymentId() {
  const res = await wixData.query(BOOKING_PAYMENTS)
    .descending('paymentId').limit(1).find();
  let maxN = 0;
  if (res.items.length) {
    const m = String(res.items[0].paymentId || '').match(/P-(\d+)/);
    if (m) maxN = parseInt(m[1], 10) || 0;
  }
  return 'P-' + ('0000' + (maxN + 1)).slice(-4);
}

export const adminRecordPayment = webMethod(
  Permissions.Admin,
  async ({ bookingNumber, amount, datePaid, paymentMethod, note }) => {
    await requireAdmin();
    if (!bookingNumber) throw new Error('bookingNumber required');
    const amt = money(amount);
    if (amt <= 0) return { ok: false, error: 'Payment amount must be positive' };

    const sRes = await wixData.query(BOOKING_SUMMARIES)
      .eq('bookingNumber', bookingNumber).limit(1).find();
    if (!sRes.items.length) return { ok: false, error: 'BookingSummary not found' };

    const capacityError = await ensurePaymentRecordCapacity(bookingNumber);
    if (capacityError) return { ok: false, error: capacityError };

    const warn = await overpaymentWarning(sRes.items[0], amt);
    const paymentId = await nextPaymentId();
    await wixData.insert(BOOKING_PAYMENTS, {
      paymentId: paymentId,
      bookingNumber: bookingNumber,
      datePaid: datePaid ? new Date(datePaid) : new Date(),
      paymentAmount: amt,
      paymentType: 'Credit Card',
      paymentMethod: paymentMethod || 'Terminal',
      note: note || '',
    });
    return { ok: true, paymentId: paymentId, warning: warn };
  }
);

export const adminRecordRefund = webMethod(
  Permissions.Admin,
  async ({ bookingNumber, amount, datePaid, paymentMethod, note }) => {
    await requireAdmin();
    if (!bookingNumber) throw new Error('bookingNumber required');
    const amt = money(amount);
    if (amt <= 0) return { ok: false, error: 'Refund amount must be positive' };

    const sRes = await wixData.query(BOOKING_SUMMARIES)
      .eq('bookingNumber', bookingNumber).limit(1).find();
    if (!sRes.items.length) return { ok: false, error: 'BookingSummary not found' };

    const capacityError = await ensurePaymentRecordCapacity(bookingNumber);
    if (capacityError) return { ok: false, error: capacityError };

    const warn = await overRefundWarning(sRes.items[0], amt);
    const paymentId = await nextPaymentId();
    await wixData.insert(BOOKING_PAYMENTS, {
      paymentId: paymentId,
      bookingNumber: bookingNumber,
      datePaid: datePaid ? new Date(datePaid) : new Date(),
      paymentAmount: -amt,
      paymentType: 'refund',
      paymentMethod: paymentMethod || 'Terminal',
      note: note || '',
    });
    return { ok: true, paymentId: paymentId, warning: warn };
  }
);

async function getActiveInvoiceForBooking(bookingNumber) {
  const res = await wixData.query(BOOKING_INVOICES)
    .eq('bookingNumber', bookingNumber)
    .hasSome('status', ['Active', 'Draft'])
    .descending('_createdDate')
    .limit(1)
    .find();
  return res.items[0] || null;
}

async function overpaymentWarning(summary, additionalPayment) {
  const invoice = await getActiveInvoiceForBooking(summary.bookingNumber);
  const pRes = await wixData.query(BOOKING_PAYMENTS)
    .eq('bookingNumber', summary.bookingNumber).limit(200).find();
  const t = computeTotals(invoice || summary, pRes.items.map(paymentDto));
  if (t.totalPaid + additionalPayment > t.grandTotal && t.grandTotal > 0) {
    return 'This payment would bring total paid above the invoice total (' +
      (t.totalPaid + additionalPayment) + ' > ' + t.grandTotal + ').';
  }
  return null;
}

async function overRefundWarning(summary, additionalRefund) {
  const invoice = await getActiveInvoiceForBooking(summary.bookingNumber);
  const pRes = await wixData.query(BOOKING_PAYMENTS)
    .eq('bookingNumber', summary.bookingNumber).limit(200).find();
  const t = computeTotals(invoice || summary, pRes.items.map(paymentDto));
  if (t.totalRefunded + additionalRefund > t.totalPaid) {
    return 'This refund would exceed total payments received (' +
      (t.totalRefunded + additionalRefund) + ' > ' + t.totalPaid + ').';
  }
  return null;
}
