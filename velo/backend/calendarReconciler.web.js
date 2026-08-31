import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';
import { findAll } from 'backend/wixDataPaging';
import { syncBookingRoomCalendar } from 'backend/calendarSync';
import { reconcileOwnerBlocks } from 'backend/ownerBlocks';

async function reconcileRoomCalendarImpl() {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - (30 * 60 * 1000));
  const rows = await findAll(wixData.query('Bookings')
    .hasSome('status', ['confirmed', 'Confirmed', 'hold', 'Hold', 'blocked', 'Blocked', 'In-House', 'in-house', 'Checked-Out', 'checked-out', 'Pending Confirmation', 'pending confirmation', 'Cancelled', 'cancelled', 'Canceled', 'canceled']),
    { suppressAuth: true, consistentRead: true });

  const pending = rows.filter(function (row) {
    if (Math.max(1, Number(row.quantity) || 1) !== 1 || row.deferCalendarSync) return false;
    const retryAt = row.calendarNextRetryAt ? new Date(row.calendarNextRetryAt) : null;
    const retryDue = !retryAt || retryAt <= now;
    const status = String(row.calendarSyncStatus || 'pending').toLowerCase();
    return retryDue && (status === 'pending' || status === 'error' || !row.calendarSyncStatus);
  }).slice(0, 100);

  let ownerResult = null;
  try {
    ownerResult = await reconcileOwnerBlocks();
  } catch (error) {
    ownerResult = { ok: false, error: error.message };
  }

  let synced = 0;
  let failed = 0;
  for (const row of pending) {
    const result = await syncBookingRoomCalendar(row);
    if (result && result.ok) synced += 1;
    else failed += 1;
  }

  const staleClaims = await findAll(wixData.query('InvoiceClaims')
    .eq('state', 'processing')
    .lt('createdAt', staleBefore), { suppressAuth: true, consistentRead: true });
  for (const claim of staleClaims) {
    claim.state = 'manual_review';
    claim.error = 'Invoice result remained ambiguous for more than 30 minutes';
    await wixData.update('InvoiceClaims', claim, { suppressAuth: true, suppressHooks: true });
    const summaries = await wixData.query('BookingSummary')
      .eq('bookingNumber', claim.bookingNumber)
      .limit(1)
      .find({ suppressAuth: true });
    if (summaries.items.length) {
      const summary = summaries.items[0];
      summary.invoiceIssueStatus = 'manual_review';
      await wixData.update('BookingSummary', summary, { suppressAuth: true, suppressHooks: true });
    }
  }

  return { ok: failed === 0 && (!ownerResult || ownerResult.ok !== false), scanned: pending.length, synced, failed, staleInvoiceClaims: staleClaims.length, ownerResult };
}

export const reconcileRoomCalendar = webMethod(
  Permissions.Admin,
  reconcileRoomCalendarImpl
);

export const clearExpiredOwnerReconciliationLock = webMethod(
  Permissions.Admin,
  async () => {
    const lock = await wixData.get('BookingLocks', 'owner-block-reconcile', { suppressAuth: true });
    if (!lock) return { ok: true, removed: false };
    if (lock.expiresAt && new Date(lock.expiresAt) > new Date()) {
      throw new Error('Owner reconciliation lock is still active');
    }
    await wixData.remove('BookingLocks', 'owner-block-reconcile', { suppressAuth: true, suppressHooks: true });
    return { ok: true, removed: true };
  }
);
