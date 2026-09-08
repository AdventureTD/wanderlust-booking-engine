import wixData from 'wix-data';
import { buildInventorySnapshot } from 'backend/roomInventoryRules';

// Backend-only read adapter. It is intentionally not a web method and is not
// imported by Booking Search, booking writes, hooks, calendar, or owner blocks.
// Temporary source-local diagnostics never inspect caught errors or record data.
// Each literal-only console access is contained so logging cannot replace a throw.
const READ_OPTIONS = { suppressAuth: true, consistentRead: true };

async function findAllPages(query) {
  const items = [];
  let page = await query.limit(1000).find(READ_OPTIONS);
  while (true) {
    if (!page || typeof page !== 'object') {
      try { console.log('[WBE-SEARCH-PHYSICAL-DIAG-1]', 'paging_shape_invalid'); } catch (_) {}
      throw new Error('Wix Data paging returned no page');
    }
    if (!Array.isArray(page.items)) {
      try { console.log('[WBE-SEARCH-PHYSICAL-DIAG-1]', 'paging_shape_invalid'); } catch (_) {}
      throw new Error('Wix Data paging result has invalid items');
    }
    if (typeof page.hasNext !== 'function') {
      try { console.log('[WBE-SEARCH-PHYSICAL-DIAG-1]', 'paging_shape_invalid'); } catch (_) {}
      throw new Error('Wix Data paging result is missing hasNext()');
    }
    items.push.apply(items, page.items);
    if (!page.hasNext()) break;
    if (typeof page.next !== 'function') {
      try { console.log('[WBE-SEARCH-PHYSICAL-DIAG-1]', 'paging_shape_invalid'); } catch (_) {}
      throw new Error('Wix Data paging result is missing next()');
    }
    page = await page.next();
  }
  return items;
}

function bookingNumberKey(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function hasStoredDates(row) {
  return row && row.checkIn !== null && row.checkIn !== undefined && row.checkIn !== '' &&
    row.checkOut !== null && row.checkOut !== undefined && row.checkOut !== '';
}

function resolveInventoryDates(bookingRows, summaryRows) {
  const summaryByBookingNumber = Object.create(null);
  for (const summary of (summaryRows || [])) {
    const key = bookingNumberKey(summary && summary.bookingNumber);
    if (
      key &&
      !Object.prototype.hasOwnProperty.call(summaryByBookingNumber, key) &&
      hasStoredDates(summary)
    ) {
      summaryByBookingNumber[key] = summary;
    }
  }
  return (bookingRows || []).map(function(row) {
    const resolved = Object.assign({}, row, { dateSource: 'Bookings' });
    if (hasStoredDates(row)) return resolved;
    const summary = summaryByBookingNumber[bookingNumberKey(row && row.bookingNumber)];
    if (!summary) return resolved;
    resolved.checkIn = summary.checkIn;
    resolved.checkOut = summary.checkOut;
    resolved.dateSource = 'BookingSummary';
    return resolved;
  });
}

export async function loadInventorySnapshot(checkIn, checkOut) {
  // Validate before accessing Wix Data so malformed requests cannot trigger an
  // unnecessary collection scan.
  try {
    buildInventorySnapshot([], checkIn, checkOut);
  } catch (error) {
    try { console.log('[WBE-SEARCH-PHYSICAL-DIAG-1]', 'request_dates_invalid'); } catch (_) {}
    throw error;
  }
  let bookingRows;
  try {
    bookingRows = await findAllPages(wixData.query('Bookings'));
  } catch (error) {
    try { console.log('[WBE-SEARCH-PHYSICAL-DIAG-1]', 'bookings_read_failed'); } catch (_) {}
    throw error;
  }
  let summaryRows;
  try {
    summaryRows = await findAllPages(wixData.query('BookingSummary'));
  } catch (error) {
    try { console.log('[WBE-SEARCH-PHYSICAL-DIAG-1]', 'summaries_read_failed'); } catch (_) {}
    throw error;
  }
  let resolvedRows;
  try {
    resolvedRows = resolveInventoryDates(bookingRows, summaryRows);
  } catch (error) {
    try { console.log('[WBE-SEARCH-PHYSICAL-DIAG-1]', 'date_resolution_failed'); } catch (_) {}
    throw error;
  }
  try {
    return buildInventorySnapshot(resolvedRows, checkIn, checkOut);
  } catch (error) {
    try { console.log('[WBE-SEARCH-PHYSICAL-DIAG-1]', 'snapshot_build_failed'); } catch (_) {}
    throw error;
  }
}
