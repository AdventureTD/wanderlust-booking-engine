// Guest-callable, capability-gated BookingSummary operations. Replaces the
// former client-side full-row BookingSummary read/update on the Summary page.
// Accepts no field values from the caller and returns no row data or PII.
import { Permissions, webMethod } from 'wix-web-module';
import { verifySummaryCapability, capabilityUnexpired } from 'backend/bookingSummaryCapability';
import { clearSummaryReporting } from 'backend/bookingSummaryWriter';

// Clear-only reporting refresh: the Summary page calls this only when the
// booking-time attribution snapshot was invalidated (withdrawal/clear) after
// first-room creation. It can never set or change identifiers.
export const clearBookingSummaryReporting = webMethod(
  Permissions.Anyone,
  async (bookingNumber, capability) => {
    const row = await verifySummaryCapability(bookingNumber, capability);
    if (!row) return { ok: false, reasonCode: 'CAPABILITY_DENIED' };
    if (!capabilityUnexpired(capability)) return { ok: false, reasonCode: 'CAPABILITY_DENIED' }; // immediately before dispatch
    try {
      // One field-scoped patch: 4 identifiers '' and 2 paid touches null on the bound row.
      await clearSummaryReporting(row._id, bookingNumber);
      return { ok: true };
    } catch (_) { return { ok: false, reasonCode: 'UNAVAILABLE' }; }
  }
);
