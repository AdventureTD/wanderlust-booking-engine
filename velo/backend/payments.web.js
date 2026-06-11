/*
 * Wanderlust Booking Engine — Velo backend: manual payments + balance due.
 * File location in Wix Editor: backend/payments.web.js
 *
 * Payments are processed manually; the admin records each one. Standard
 * schedule: 50% deposit at booking, 50% final ~30 days before check-in. But
 * payments are recorded flexibly (amount/date/type/note) so partials,
 * overpayments, and refunds work. Balance = grandTotal - sum(payments).
 *
 * Collections:
 *   Payments       — one row per payment (bookingId, amount, date, type, note)
 *   BookingReports — booking rows; we cache totalPaid/balanceDue/finalDueDate
 *                    on each for fast reporting.
 */

import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

const PAYMENTS = 'Payments';
const BOOKINGS = 'BookingReports';
const FINAL_DUE_DAYS = 30;
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

function finalDueDate(checkIn) {
  const d = new Date(checkIn);
  d.setDate(d.getDate() - FINAL_DUE_DAYS);
  return d;
}

// Recompute the cached payment fields on a booking row from its payments.
async function refreshBookingBalance(bookingId) {
  const booking = await wixData.get(BOOKINGS, bookingId);
  if (!booking) throw new Error(`No booking ${bookingId}`);

  let page = await wixData.query(PAYMENTS).eq('bookingId', bookingId).limit(1000).find();
  let pays = page.items;
  while (page.hasNext()) { page = await page.next(); pays = pays.concat(page.items); }

  const totalPaid = r2(pays.reduce((s, p) => s + (p.amount || 0), 0));
  const grand = booking.grandTotal || 0;
  booking.totalPaid = totalPaid;
  booking.balanceDue = r2(grand - totalPaid);
  booking.depositDue = r2(grand * 0.5);
  booking.finalDue = r2(grand - r2(grand * 0.5));
  booking.finalDueDate = booking.checkInDate ? finalDueDate(booking.checkInDate) : null;
  booking.paidInFull = booking.balanceDue <= 0;
  await wixData.update(BOOKINGS, booking);
  return booking;
}

/*
 * recordPayment(bookingId, { amount, date, ptype, note })
 *   ptype: 'deposit' | 'final' | 'other' | 'refund' (refund stored negative)
 * Inserts the payment and refreshes the booking's cached balance.
 */
export const recordPayment = webMethod(
  Permissions.Admin,
  async (bookingId, payment) => {
    const allowed = ['deposit', 'final', 'other', 'refund'];
    const ptype = payment.ptype || 'other';
    if (!allowed.includes(ptype)) throw new Error(`Invalid payment type: ${ptype}`);
    let amount = Number(payment.amount);
    if (ptype === 'refund' && amount > 0) amount = -amount;

    await wixData.insert(PAYMENTS, {
      bookingId,
      amount: r2(amount),
      date: payment.date ? new Date(payment.date) : new Date(),
      ptype,
      note: payment.note || '',
    });
    const booking = await refreshBookingBalance(bookingId);
    return {
      bookingId,
      totalPaid: booking.totalPaid,
      balanceDue: booking.balanceDue,
      paidInFull: booking.paidInFull,
    };
  }
);

// List payments for one booking (admin view).
export const listPayments = webMethod(
  Permissions.Admin,
  async (bookingId) => {
    let page = await wixData.query(PAYMENTS).eq('bookingId', bookingId)
      .ascending('date').limit(1000).find();
    let pays = page.items;
    while (page.hasNext()) { page = await page.next(); pays = pays.concat(page.items); }
    return pays;
  }
);

/*
 * balanceDueReport(startDate, endDate, dateField)
 * Admin enters a START and END date. Filters bookings by CHECK-OUT date in that
 * range (default) and returns each booking's balance due + report totals.
 * dateField may be 'checkOutDate' (default), 'dateBooked', or 'checkInDate'.
 * Excludes Cancelled and Pending Confirmation from the money totals.
 */
export const balanceDueReport = webMethod(
  Permissions.Admin,
  async (startDate, endDate, dateField = 'checkOutDate') => {
    if (!startDate || !endDate) throw new Error('Both start and end date required.');
    const allowed = ['checkOutDate', 'dateBooked', 'checkInDate'];
    if (!allowed.includes(dateField)) {
      throw new Error(`dateField must be one of ${allowed.join(', ')}`);
    }
    const from = new Date(startDate);
    const to = new Date(endDate);
    to.setHours(23, 59, 59, 999);

    let page = await wixData.query(BOOKINGS)
      .ge(dateField, from)
      .le(dateField, to)
      .ascending(dateField)
      .limit(1000)
      .find();
    let rows = page.items;
    while (page.hasNext()) { page = await page.next(); rows = rows.concat(page.items); }

    const NON_REVENUE = ['Cancelled', 'Pending Confirmation'];
    const out = [];
    const totals = { count: rows.length, revenueCount: 0,
      grandTotal: 0, totalPaid: 0, balanceDue: 0 };

    for (const b of rows) {
      const grand = b.grandTotal || 0;
      const paid = b.totalPaid || 0;
      const bal = r2(grand - paid);
      out.push({
        guestName: b.guestName,
        invoiceNumber: b.invoiceNumber,
        dateBooked: b.dateBooked,
        checkInDate: b.checkInDate,
        finalDueDate: b.finalDueDate,
        status: b.status,
        grandTotal: r2(grand),
        totalPaid: r2(paid),
        balanceDue: bal,
        paidInFull: bal <= 0,
      });
      if (!NON_REVENUE.includes(b.status)) {
        totals.revenueCount += 1;
        totals.grandTotal += grand;
        totals.totalPaid += paid;
        totals.balanceDue += bal;
      }
    }
    totals.grandTotal = r2(totals.grandTotal);
    totals.totalPaid = r2(totals.totalPaid);
    totals.balanceDue = r2(totals.balanceDue);
    return { rows: out, totals };
  }
);
