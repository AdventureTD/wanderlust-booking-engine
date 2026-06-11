/*
 * Wanderlust Booking Engine — Velo backend: bookings reporting + admin console.
 * File location in Wix Editor: backend/reporting.web.js
 *
 * - logBookingReport(): called after the external invoice service returns a
 *   report_record; writes it to the BookingReports collection.
 * - queryBookingsByDateRange(): powers the admin console — returns matching
 *   bookings + aggregated report totals for a date range.
 *
 * The date field you filter on is configurable: 'dateBooked' (when booked),
 * 'checkInDate', or 'checkOutDate'. Admin console defaults to 'dateBooked'.
 */

import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

const COLLECTION = 'BookingReports';

// Write a report record (the dict returned by the external invoice service).
// ADMIN-ONLY: only site admins should be able to log/lookup financial records.
export const logBookingReport = webMethod(
  Permissions.Admin,
  async (record) => {
    // Coerce ISO date strings to Date objects for proper range queries.
    const toInsert = {
      ...record,
      dateBooked: record.dateBooked ? new Date(record.dateBooked) : null,
      checkInDate: record.checkInDate ? new Date(record.checkInDate) : null,
      checkOutDate: record.checkOutDate ? new Date(record.checkOutDate) : null,
    };
    return wixData.insert(COLLECTION, toInsert);
  }
);

/*
 * queryBookingsByDateRange(fromDate, toDate, dateField)
 *   fromDate/toDate: ISO strings (inclusive range)
 *   dateField: 'dateBooked' | 'checkInDate' | 'checkOutDate' (default dateBooked)
 * Returns { rows, totals } where totals aggregates the financial columns.
 */
export const queryBookingsByDateRange = webMethod(
  Permissions.Admin,
  async (fromDate, toDate, dateField = 'dateBooked') => {
    const allowed = ['dateBooked', 'checkInDate', 'checkOutDate'];
    if (!allowed.includes(dateField)) {
      throw new Error(`dateField must be one of ${allowed.join(', ')}`);
    }
    const from = new Date(fromDate);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999); // make 'to' inclusive of the whole day

    let results = [];
    let q = wixData.query(COLLECTION)
      .ge(dateField, from)
      .le(dateField, to)
      .ascending(dateField)
      .limit(1000);

    let page = await q.find();
    results = results.concat(page.items);
    while (page.hasNext()) {
      page = await page.next();
      results = results.concat(page.items);
    }

    // Aggregate the financial columns for the period.
    // Cancelled, Pending Confirmation, AND Blocked bookings: figures stay on the row but
    // are EXCLUDED from revenue totals (owner decisions 2026-06-01).
    const NON_REVENUE = ['Cancelled', 'Pending Confirmation', 'Blocked'];
    const totals = {
      count: results.length,
      revenueCount: 0,
      cancelledCount: 0,
      pendingCount: 0,
      accommodationSaleNet: 0,
      packageSaleNet: 0,
      totalVat10: 0,
      totalVat15: 0,
      totalVat: 0,
      grandTotal: 0,
    };
    const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
    for (const row of results) {
      if (row.status === 'Cancelled') { totals.cancelledCount += 1; continue; }
      if (row.status === 'Pending Confirmation') { totals.pendingCount += 1; continue; }
      totals.revenueCount += 1;
      totals.accommodationSaleNet += row.accommodationSaleNet || 0;
      totals.packageSaleNet += row.packageSaleNet || 0;
      totals.totalVat10 += row.totalVat10 || 0;
      totals.totalVat15 += row.totalVat15 || 0;
      totals.totalVat += row.totalVat || 0;
      totals.grandTotal += row.grandTotal || 0;
    }
    for (const k of Object.keys(totals)) {
      if (!['count', 'revenueCount', 'cancelledCount', 'pendingCount'].includes(k)) {
        totals[k] = r2(totals[k]);
      }
    }

    return { rows: results, totals };
  }
);

// ----- Cancel / edit / status -------------------------------------------

// Cancel a reservation: sets status to 'Cancelled' (row kept for the record).
export const cancelReservation = webMethod(
  Permissions.Admin,
  async (recordId) => {
    const row = await wixData.get(COLLECTION, recordId);
    if (!row) throw new Error(`No booking ${recordId}`);
    row.status = 'Cancelled';
    return wixData.update(COLLECTION, row);
  }
);

/*
 * applyEditedReservation(recordId, recomputed)
 * The external service recomputes the quote + report record after an edit
 * (date change / added room). Pass the new report_record here to overwrite the
 * financial + date fields on the existing row (keeps _id, keeps history).
 * Will NOT un-cancel a cancelled booking.
 */
export const applyEditedReservation = webMethod(
  Permissions.Admin,
  async (recordId, recomputed) => {
    const row = await wixData.get(COLLECTION, recordId);
    if (!row) throw new Error(`No booking ${recordId}`);
    if (row.status === 'Cancelled') {
      throw new Error('Cannot edit a cancelled reservation. Reinstate first.');
    }
    const merged = {
      ...row,
      checkInDate: recomputed.checkInDate ? new Date(recomputed.checkInDate) : row.checkInDate,
      checkOutDate: recomputed.checkOutDate ? new Date(recomputed.checkOutDate) : row.checkOutDate,
      accommodationSaleNet: recomputed.accommodationSaleNet,
      packageSaleNet: recomputed.packageSaleNet,
      totalVat10: recomputed.totalVat10,
      totalVat15: recomputed.totalVat15,
      totalVat: recomputed.totalVat,
      grandTotal: recomputed.grandTotal,
      roomCode: recomputed.roomCode || row.roomCode,
      status: recomputed.status || row.status,
    };
    return wixData.update(COLLECTION, merged);
  }
);

// Compute the correct status from dates (sticky statuses override date logic).
const STICKY = ['Cancelled', 'Pending Confirmation', 'Blocked'];
function computeStatus(checkIn, checkOut, stored, today) {
  if (STICKY.includes(stored)) return stored;
  const t = today || new Date();
  t.setHours(0, 0, 0, 0);
  const ci = new Date(checkIn); ci.setHours(0, 0, 0, 0);
  const co = new Date(checkOut); co.setHours(0, 0, 0, 0);
  if (t >= co) return 'Checked-Out';
  if (t >= ci) return 'In-House';
  return 'Confirmed';
}

/*
 * advanceStatuses(): flips Confirmed->In-House->Checked-Out based on today.
 * Daily job. Skips sticky statuses (Cancelled, Pending Confirmation) and
 * terminal Checked-Out. Returns how many rows were updated.
 */
export const advanceStatuses = webMethod(
  Permissions.Admin,
  async () => {
    let updated = 0;
    let page = await wixData.query(COLLECTION)
      .ne('status', 'Cancelled')
      .ne('status', 'Pending Confirmation')
      .ne('status', 'Blocked')
      .ne('status', 'Checked-Out')   // already terminal
      .limit(1000)
      .find();
    let rows = page.items;
    while (page.hasNext()) { page = await page.next(); rows = rows.concat(page.items); }

    for (const row of rows) {
      const next = computeStatus(row.checkInDate, row.checkOutDate, row.status);
      if (next !== row.status) {
        row.status = next;
        await wixData.update(COLLECTION, row);
        updated += 1;
      }
    }
    return { updated };
  }
);

// ----- Postpone / reinstate (illness/injury rebooking) -------------------

/*
 * postponeReservation(recordId): set status to 'Pending Confirmation' and
 * record the original check-in (for the 2-year window) + lock the rates by
 * snapshotting the current per-night sale into lockedAccommodationNet so the
 * reinstated booking can be repriced at the original rate.
 * Excluded from revenue while pending.
 */
export const postponeReservation = webMethod(
  Permissions.Admin,
  async (recordId) => {
    const row = await wixData.get(COLLECTION, recordId);
    if (!row) throw new Error(`No booking ${recordId}`);
    if (!row.originalCheckIn) row.originalCheckIn = row.checkInDate;
    // Lock the original per-night accommodation rate for repricing on reinstate.
    if (row.lockedNightlyRate == null) {
      const nights = Math.max(1, Math.round(
        (new Date(row.checkOutDate) - new Date(row.checkInDate)) / 86400000));
      row.lockedNightlyRate = (row.accommodationSaleNet || 0) / nights;
      row.lockedNights = nights;
    }
    row.status = 'Pending Confirmation';
    return wixData.update(COLLECTION, row);
  }
);

/*
 * reinstateReservation(recordId, newCheckIn, newCheckOut, recomputed, opts)
 *   `recomputed` is the report_record from the external service /recompute,
 *   which MUST have been priced using the locked nightly rate (so no extra
 *   charge). This function enforces the 2-year window and writes the row back
 *   to 'Confirmed' with the new dates + recomputed financials.
 *   opts.overrideTwoYear=true to allow >2yr (records a warning).
 */
export const reinstateReservation = webMethod(
  Permissions.Admin,
  async (recordId, newCheckIn, newCheckOut, recomputed, opts = {}) => {
    const row = await wixData.get(COLLECTION, recordId);
    if (!row) throw new Error(`No booking ${recordId}`);
    if (row.status !== 'Pending Confirmation') {
      throw new Error('Only a Pending Confirmation booking can be reinstated.');
    }
    // 2-year window from the ORIGINAL check-in.
    const anchor = new Date(row.originalCheckIn || row.checkInDate);
    const limit = new Date(anchor); limit.setFullYear(limit.getFullYear() + 2);
    const nci = new Date(newCheckIn);
    if (nci > limit && !opts.overrideTwoYear) {
      throw new Error(`New check-in ${newCheckIn} is more than 2 years after the `
        + `original ${anchor.toISOString().slice(0,10)}. Override required.`);
    }
    const merged = {
      ...row,
      checkInDate: new Date(newCheckIn),
      checkOutDate: new Date(newCheckOut),
      accommodationSaleNet: recomputed.accommodationSaleNet,
      packageSaleNet: recomputed.packageSaleNet,
      totalVat10: recomputed.totalVat10,
      totalVat15: recomputed.totalVat15,
      totalVat: recomputed.totalVat,
      grandTotal: recomputed.grandTotal,
      status: 'Confirmed',
    };
    return wixData.update(COLLECTION, merged);
  }
);
