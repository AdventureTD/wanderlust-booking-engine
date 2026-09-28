import wixData from 'wix-data';

const OPS = 'BookingCancellationOperations';
const READ = { suppressAuth: true, consistentRead: true };
const WRITE = { suppressAuth: true, suppressHooks: true };
export function isCancelled(value) { return /^(cancelled|canceled)$/.test(String(value || '').trim().toLowerCase()); }

export async function cancellationRows(collection, bookingNumber) {
  let page = await wixData.query(collection).eq('bookingNumber', bookingNumber).limit(1000).find(READ);
  const rows = [], ids = new Set();
  for (let pages = 0; pages < 100; pages++) {
    if (!page || !Array.isArray(page.items) || typeof page.hasNext !== 'function') throw new Error('Incomplete cancellation read');
    for (const row of page.items) {
      if (!row || !row._id || row.bookingNumber !== bookingNumber || ids.has(row._id)) throw new Error('Invalid cancellation row');
      ids.add(row._id); rows.push(row);
    }
    if (!page.hasNext()) return rows;
    page = await page.next();
  }
  throw new Error('Cancellation page bound exceeded');
}

// Observed-state fence, not a CAS or a transaction. Recheck immediately before each legacy write.
export async function assertCancellationWriteAllowed(bookingNumber) {
  if (!bookingNumber) throw new Error('Booking identity required for cancellation fence');
  if ((await cancellationRows(OPS,bookingNumber)).length) throw new Error('Cancellation in progress; use Resume / Reconcile Cancellation');
  const summaries = await cancellationRows('BookingSummary',bookingNumber);
  if (summaries.length !== 1 || isCancelled(summaries[0].status)) throw new Error('Cancellation in progress or booking summary unavailable');
}

function membership(rooms) {
  return rooms.map(r => ({id:r._id, quantity:r.quantity, roomCode:r.roomCode})).sort((a,b) => a.id.localeCompare(b.id));
}

function matchesDecision(operation, summary, rooms) {
  return operation && operation._id === summary._id && operation.summaryId === summary._id &&
    operation.bookingNumber === summary.bookingNumber && operation.settlement === 'FULL_NO_FEE' &&
    Number.isSafeInteger(operation.roomCount) && operation.roomCount > 0 && summary.roomCount === operation.roomCount &&
    rooms.length > 0 && rooms.every(r => r.bookingNumber === summary.bookingNumber && Number.isSafeInteger(r.quantity) && r.quantity > 0 && r.roomCode) &&
    rooms.reduce((n,r) => n+r.quantity,0) === operation.roomCount &&
    JSON.stringify(operation.roomIds) === JSON.stringify(rooms.map(r => r._id).sort()) &&
    JSON.stringify(operation.membership) === JSON.stringify(membership(rooms));
}

export async function reservationCancellationVerified(summary, rooms) {
  const operations = await cancellationRows(OPS, summary.bookingNumber);
  return operations.length === 1 && matchesDecision(operations[0],summary,rooms) &&
    isCancelled(summary.status) && summary.cancellationSettlement === operations[0].settlement &&
    summary.cancellationReason === operations[0].reason && rooms.every(r => isCancelled(r.status));
}

export async function cancelReservation(bookingNumber, reason) {
  const summaries = await cancellationRows('BookingSummary', bookingNumber);
  if (summaries.length !== 1) throw new Error('Exactly one BookingSummary required');
  const summary = summaries[0];
  const rooms = await cancellationRows('Bookings', bookingNumber);
  if (!rooms.length) throw new Error('No Bookings rows');
  for (const room of rooms) {
    if (!Number.isSafeInteger(room.quantity) || room.quantity <= 0 || !room.roomCode) throw new Error('Invalid room quantity or code');
  }
  if (!Number.isSafeInteger(summary.roomCount) || summary.roomCount !== rooms.reduce((n,r) => n + r.quantity, 0)) throw new Error('Room count mismatch');
  // One immutable decision per Summary, using Wix insert's native unique _id.
  // Replays perform only idempotent status assignments; no expiring lock or CAS.
  const retained = await cancellationRows(OPS, bookingNumber);
  let operation = retained[0];
  if (!operation) {
    operation = { _id: summary._id, bookingNumber, summaryId: summary._id,
      legacyCancelled: isCancelled(summary.status), roomIds: rooms.map(r => r._id).sort(), roomCount:summary.roomCount,
      membership:membership(rooms), reason: String(reason || ''), settlement: 'FULL_NO_FEE' };
    try { await wixData.insert(OPS, operation, WRITE); } catch (_) { /* read retained winner, including lost ACK */ }
    operation = await wixData.get(OPS, summary._id, READ);
  }
  if (retained.length > 1 || !matchesDecision(operation,summary,rooms)) throw new Error('Cancellation decision unavailable or membership changed');
  for (const row of rooms) {
    if (!isCancelled(row.status)) await wixData.update('Bookings', { ...row, status: 'Cancelled' }, WRITE);
  }
  if (!isCancelled(summary.status) || summary.cancellationSettlement !== operation.settlement) {
    await wixData.update('BookingSummary', { ...summary, status: 'Cancelled', cancellationSettlement: operation.settlement,
      cancellationReason: operation.reason }, WRITE);
  }
  const after = await cancellationRows('Bookings', bookingNumber);
  const parent = await wixData.get('BookingSummary', summary._id, READ);
  if (!parent || !(await reservationCancellationVerified(parent,after))) throw new Error('Cancellation readback pending');
  return { operation, summary: parent, rooms: after };
}
