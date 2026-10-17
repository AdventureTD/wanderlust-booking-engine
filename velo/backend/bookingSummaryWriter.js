// Private backend module, never a web module. The ONLY BookingSummary row writer
// for existing rows. Every write is a field-scoped Data Items SDK patch in the
// documented direct form items.patch(collection, itemId, fieldModifications,
// options) with condition bookingNumber === expected; nothing re-writes a row
// read earlier. Callers pass server-derived item ids; this module never accepts
// caller-chosen field names. Elevation (auth.elevate, documented replacement for
// suppressAuth in the SDK) is applied only where the caller context is a public
// web method; admin paths run with the caller's own permissions.
import { items } from '@wix/data';
import { auth } from '@wix/essentials';

const COLLECTION = 'BookingSummary';
const validId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const LEGACY = ['gclid', 'gbraid', 'wbraid', 'msclkid'];
const TOUCHES = ['firstPaidTouch', 'latestPaidTouch'];
const FLAGS = new Set(['googleConversionUploaded', 'microsoftConversionUploaded']);
// Aggregate fields computed by updateBookingSummary from Bookings rows/arguments.
const ALWAYS = ['checkIn', 'checkOut', 'roomCount', 'status', 'notes'];
const IF_PRESENT = ['guestName', 'guestEmail', 'guestPhone', 'marketSource', 'packageTitle', 'bookingDate'];
const set = (fieldPath, value) => ({ fieldPath, action: 'SET_FIELD', value });

async function patch(itemId, bookingNumber, modifications, { elevated = true, suppressHooks = false } = {}) {
  if (!validId(itemId) || !validId(bookingNumber) || !modifications.length) throw new Error('INVALID_PATCH');
  const run = elevated ? auth.elevate(items.patch) : items.patch;
  const options = { condition: items.filter().eq('bookingNumber', bookingNumber) };
  if (suppressHooks) options.suppressHooks = true;
  return run(COLLECTION, itemId, modifications, options);
}

// P2 refresh of an existing row. Reporting is monotonic on existing rows: an
// explicit null paid touch clears it; non-empty identifiers/touches are never
// (re)written after creation, so a delayed or retried call carrying stale
// reporting cannot resurrect data cleared by withdrawal. Flags and cancellation
// fields are never written here.
export async function patchSummaryRefresh(itemId, bookingNumber, aggregate, reporting) {
  const mods = [];
  for (const k of ALWAYS) if (aggregate[k] !== undefined) mods.push(set(k, aggregate[k]));
  for (const k of IF_PRESENT) if (aggregate[k] !== undefined && aggregate[k] !== null && aggregate[k] !== '') mods.push(set(k, aggregate[k]));
  for (const k of TOUCHES) if (reporting && Object.prototype.hasOwnProperty.call(reporting, k) && reporting[k] === null) mods.push(set(k, null));
  return patch(itemId, bookingNumber, mods);
}
// P3: capability-gated withdrawal clear.
export async function clearSummaryReporting(itemId, bookingNumber) {
  return patch(itemId, bookingNumber, [...LEGACY.map(k => set(k, '')), ...TOUCHES.map(k => set(k, null))]);
}
// P4: single status flag.
export async function setSummaryFlag(itemId, bookingNumber, flag, options = {}) {
  if (!FLAGS.has(flag)) throw new Error('INVALID_FLAG');
  return patch(itemId, bookingNumber, [set(flag, true)], options);
}
// P5: cancellation-owned fields (admin path; caller permissions; hooks suppressed as before).
export async function setSummaryCancellation(itemId, bookingNumber, settlement, reason) {
  return patch(itemId, bookingNumber, [set('status', 'Cancelled'), set('cancellationSettlement', settlement), set('cancellationReason', reason)], { elevated: false, suppressHooks: true });
}
// P6: invoice date mirror (server-derived values only).
export async function mirrorSummaryDates(itemId, bookingNumber, checkIn, checkOut, bookingDate) {
  return patch(itemId, bookingNumber, [set('checkIn', checkIn), set('checkOut', checkOut), set('bookingDate', bookingDate)]);
}
