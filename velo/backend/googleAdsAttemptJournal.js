// Private backend module, never a web module. No guest-callable mint/read/retry.
import crypto from 'crypto';
import wixData from 'wix-data';
import { getAllSettings } from 'backend/settings.web';
import { getSecret } from 'wix-secrets-backend';
import { ingestEvent, sanitizeHttpErrorDiagnostics } from 'backend/dataManagerClient.web';

const COLLECTION = 'GoogleAdsAttemptJournal';
const OPTIONS = { suppressAuth: true, suppressHooks: true };
const READ_OPTIONS = { ...OPTIONS, consistentRead: true };
const PURPOSE = 'google-ads-purchase-attempt';
const VERSION = 1;
const TTL_MS = 30 * 60 * 1000;
const validId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const hash = v => crypto.createHash('sha256').update(v, 'utf8').digest('hex');
// Fixed 36-character native IDs; never use save/upsert to acquire a send grant.
const key = (kind, bookingNumber) => kind + '-' + hash(PURPOSE + '\n1\n' + bookingNumber).slice(0, 32);
const denied = reasonCode => ({ ok: false, outcome: 'NOT_ATTEMPTED', reasonCode });
async function enabled() {
  try {
    const s = await getAllSettings();
    return String(s.googleAdsPrivateJournalEnabled).trim() === '1' &&
      String(s.suspendGoogleAds).trim() === '0';
  } catch (_) { return false; }
}
async function destination() {
  const account = await getSecret('GOOGLE_ADS_CUSTOMER_ID');
  const action = await getSecret('GOOGLE_ADS_CONVERSION_ACTION_ID');
  if (![account, action].every(x => typeof x === 'string' && /^\d{1,20}$/.test(x))) throw new Error('CONFIGURATION');
  return { destinationAccount: account, destinationAction: action };
}
async function insertVerified(row) {
  if (Buffer.byteLength(JSON.stringify(row), 'utf8') > 2048) throw new Error('ROW_LIMIT');
  await wixData.insert(COLLECTION, row, OPTIONS);
  const stored = await wixData.get(COLLECTION, row._id, READ_OPTIONS);
  if (!stored || Object.keys(row).some(k => JSON.stringify(stored[k]) !== JSON.stringify(row[k]))) throw new Error('READBACK');
}

// Called ONLY after a freshly allocated first-room save, invoice save and Summary
// save succeeded. The caller never passes guest-chosen authority or contacts.
export async function mintGoogleAdsCapability(room, summary) {
  try {
    if (!await enabled()) return '';
    if (!room || !summary || !validId(room.bookingNumber) || !validId(room._id) ||
        !validId(summary._id) || summary.bookingNumber !== room.bookingNumber) return '';
    const dest = await destination();
    const token = 'gac1.' + crypto.randomBytes(32).toString('hex');
    const row = { _id: key('aut', room.bookingNumber), kind: 'AUTH', schemaVersion: VERSION,
      purpose: PURPOSE, bookingNumber: room.bookingNumber, roomId: room._id,
      summaryId: summary._id, tokenHash: hash(token), ...dest,
      recordedAt: new Date(), expiresAt: new Date(Date.now() + TTL_MS), commercialAuthority: 'UNVERIFIED' };
    await insertVerified(row);
    return token;
  } catch (_) { return ''; } // Attribution setup must not turn a saved booking into a failure.
}

function transportResult(response, error) {
  if (error) {
    const outcomes = { not_attempted: 'NOT_ATTEMPTED', processingfailure: 'EXPLICIT_REJECTION', unknown: 'UNKNOWN' };
    const codes = ['PRE_SEND_FAILURE','TRANSPORT_ERROR','HTTP_ERROR','INVALID_RESPONSE','REJECTED_RESPONSE','MISSING_REQUEST_ID'];
    const diagnostics = error.code === 'HTTP_ERROR' ? sanitizeHttpErrorDiagnostics(error.httpDiagnostics) : null;
    const suffix = diagnostics && (diagnostics.reasons.length || diagnostics.fields.length) ? '|' + JSON.stringify(diagnostics) : '';
    return { outcome: outcomes[error.outcome] || 'UNKNOWN',
      reasonCode: (codes.includes(error.code) ? error.code : 'TRANSPORT_UNKNOWN') + suffix,
      statusCode: Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599 ? error.httpStatus : 0,
      requestId: '', warningPresent: false };
  }
  if (!response || response.ok === false || response.error || (Array.isArray(response.errors) && response.errors.length)) {
    return { outcome: 'UNKNOWN', reasonCode: 'INVALID_RESPONSE', requestId: '', warningPresent: false, statusCode: 0 };
  }
  const id = response.requestId;
  // Retain the original identifier, never trim/truncate it into an ACK.
  if (typeof id !== 'string' || id.length > 512 || !/^[\x21-\x7e]+$/.test(id)) {
    return { outcome: 'UNKNOWN', reasonCode: 'MISSING_REQUEST_ID', requestId: '', warningPresent: false, statusCode: 0 };
  }
  return { outcome: 'INGESTION_ACKNOWLEDGED', reasonCode: 'REQUEST_ID', requestId: id,
    warningPresent: Array.isArray(response.fieldWarnings) && response.fieldWarnings.length > 0, statusCode: 200 };
}

export async function recordPrivateGoogleAdsAttempt(booking, buildPayload) {
  if (!await enabled()) return denied('DISABLED_OR_SUSPENDED');
  if (!booking || !validId(booking.transactionId) || typeof booking.conversionCapability !== 'string' ||
      !/^gac1\.[a-f0-9]{64}$/.test(booking.conversionCapability)) return denied('CAPABILITY_REQUIRED');
  // Capture primitives before any await; no mutable client object becomes authority.
  const subject = booking.transactionId, tokenHash = hash(booking.conversionCapability);
  let auth, payload;
  try {
    auth = await wixData.get(COLLECTION, key('aut', subject), READ_OPTIONS);
    if (!auth || auth.kind !== 'AUTH' || auth.schemaVersion !== VERSION || auth.purpose !== PURPOSE ||
        auth.bookingNumber !== subject || !validId(auth.summaryId) || !validId(auth.roomId) ||
        typeof auth.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(auth.tokenHash) ||
        !crypto.timingSafeEqual(Buffer.from(tokenHash), Buffer.from(auth.tokenHash)) ||
        !(auth.expiresAt instanceof Date) || !(auth.expiresAt.getTime() > Date.now())) return denied('CAPABILITY_DENIED');
    // Payload economics and contacts remain UNVERIFIED; mutable Summary/invoices
    // cannot confer financial truth. Destination and subject are server bound.
    if (typeof booking.value !== 'number' || !Number.isFinite(booking.value) || booking.value < 0 || booking.currency !== 'USD') return denied('INVALID_PAYLOAD');
    payload = await buildPayload({ ...booking, transactionId: subject });
    const dest = payload.destinations[0];
    if (dest.operatingAccount.accountId !== auth.destinationAccount || dest.productDestinationId !== auth.destinationAction) return denied('DESTINATION_CHANGED');
    if (!await enabled() || !(auth.expiresAt.getTime() > Date.now())) return denied('CAPABILITY_EXPIRED_OR_DISABLED');
  } catch (_) { return denied('ADMISSION_UNAVAILABLE'); }
  const attemptKey = key('att', subject);
  const base = { schemaVersion: VERSION, purpose: PURPOSE, bookingNumber: subject,
    attemptKey, destinationAccount: auth.destinationAccount, destinationAction: auth.destinationAction,
    commercialAuthority: 'UNVERIFIED' };
  try {
    await insertVerified({ ...base, _id: attemptKey, kind: 'ATTEMPT', recordedAt: new Date(), outcome: 'UNKNOWN' });
  } catch (_) {
    // Duplicate, missing collection, lost insert ACK or readback all fail closed.
    return { ok: false, outcome: 'UNKNOWN', reasonCode: 'ATTEMPT_EXISTS_OR_UNAVAILABLE' };
  }
  let response, error;
  try { response = await ingestEvent(payload); } catch (e) { error = e; }
  const result = transportResult(response, error);
  try {
    await insertVerified({ ...base, ...result, _id: key('res', subject), kind: 'RESULT', recordedAt: new Date() });
  } catch (_) { return { ok: false, outcome: 'UNKNOWN', reasonCode: 'RESULT_PERSISTENCE_UNKNOWN' }; }
  let legacyFlagUpdated = false;
  if (result.outcome === 'INGESTION_ACKNOWLEDGED') {
    try {
      const summary = await wixData.get('BookingSummary', auth.summaryId, READ_OPTIONS);
      if (summary && summary.bookingNumber === subject) {
        // Keep native dates, financials and both legacy retraction flags intact.
        await wixData.update('BookingSummary', { ...summary, googleConversionUploaded: true }, OPTIONS);
        legacyFlagUpdated = true;
      }
    } catch (_) { /* Durable RESULT survives; never resend to repair this flag. */ }
  }
  return { ok: result.outcome === 'INGESTION_ACKNOWLEDGED', outcome: result.outcome,
    reasonCode: result.reasonCode.split('|')[0], legacyFlagUpdated };
}
