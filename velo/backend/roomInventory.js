import wixData from 'wix-data';
import { buildInventorySnapshot } from 'backend/roomInventoryRules';

// Backend-only read adapter. It is intentionally not a web method and is not
// imported by Booking Search, booking writes, hooks, calendar, or owner blocks.
const READ_OPTIONS = { suppressAuth: true, consistentRead: true };

async function findAllPages(query) {
  const items = [];
  let page = await query.limit(1000).find(READ_OPTIONS);
  while (true) {
    if (!page || typeof page !== 'object') {
      throw new Error('Wix Data paging returned no page');
    }
    if (!Array.isArray(page.items)) {
      throw new Error('Wix Data paging result has invalid items');
    }
    if (typeof page.hasNext !== 'function') {
      throw new Error('Wix Data paging result is missing hasNext()');
    }
    items.push.apply(items, page.items);
    if (!page.hasNext()) break;
    if (typeof page.next !== 'function') {
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
  buildInventorySnapshot([], checkIn, checkOut);
  const bookingRows = await findAllPages(wixData.query('Bookings'));
  const summaryRows = await findAllPages(wixData.query('BookingSummary'));
  const resolvedRows = resolveInventoryDates(bookingRows, summaryRows);
  return buildInventorySnapshot(resolvedRows, checkIn, checkOut);
}
