// Fixed private bridge: reconstruct original admitted roots, never new command authority.
import { response } from 'wix-http-functions';
import { getSecret } from 'wix-secrets-backend';
import { createHash, timingSafeEqual } from 'crypto';
import { invoiceJournalOperation } from 'backend/invoiceEmailJournal';
import { handleGuestBookingContinuation } from 'backend/guestBookingContinuationHttp';
import { handleGuestInvoiceJournalHttp } from 'backend/guestBookingInvoiceTransportAuth';

export async function post_guestInvoiceJournal(request) {
  return response(await handleGuestInvoiceJournalHttp(request));
}

// Dedicated default-OFF trusted host edge, separate from owner invoice auth.
export async function post_guestBookingContinuation(request) {
  return response(await handleGuestBookingContinuation(request));
}

const OWNER_INVOICE_JOURNAL_ENABLED = false;
export async function post_invoiceEmailJournal(request) {
  const reply = (status, value) => response({status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}, body: JSON.stringify(value)});
  if (!OWNER_INVOICE_JOURNAL_ENABLED) return reply(503, {error: 'disabled'});
  const secret = await getSecret('WBE_SHARED_SECRET');
  const supplied = request.headers['x-wbe-secret'];
  if (typeof secret !== 'string' || !secret || typeof supplied !== 'string' || supplied.length > 4096 ||
      !timingSafeEqual(createHash('sha256').update(secret).digest(), createHash('sha256').update(supplied).digest())) {
    return reply(401, {error: 'unauthorized'});
  }
  try {
    const body = await request.body.text();
    if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 160000) return reply(413, {error: 'oversize'});
    return reply(200, await invoiceJournalOperation(JSON.parse(body)));
  } catch (_) {
    return reply(409, {error: 'journal_unavailable_or_conflict'});
  }
}
