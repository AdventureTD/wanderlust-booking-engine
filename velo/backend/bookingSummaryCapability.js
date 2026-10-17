// Private backend module, never a web module: no guest-callable mint.
// Stateless, booking-bound capability for the guest that just created a fresh
// booking. It authorizes only the narrow BookingSummary operations exported by
// backend/bookingSummaryReporting.web and the Microsoft upload status flag.
// A bookingNumber is sequential and suppressAuth is not authorization: every
// use must present this HMAC capability bound to the exact Summary row _id.
import crypto from 'crypto';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { setSummaryFlag } from 'backend/bookingSummaryWriter';

// Domain-separated reuse of the existing pricing-quote HMAC secret (>=32 chars).
const SECRET_KEY = 'WBE_PRICING_QUOTE_SECRET';
const DOMAIN = 'wbe-booking-summary-capability\n1\n';
const PREFIX = 'bsc1';
const TTL_MS = 30 * 60 * 1000;
const SKEW_MS = 60 * 1000;
const READ = { suppressAuth: true, consistentRead: true };
const validId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const TOKEN = /^bsc1\.([0-9]{13})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;

async function secret() {
  const value = await getSecret(SECRET_KEY);
  if (typeof value !== 'string' || value.length < 32) throw new Error('CONFIGURATION');
  return value;
}
function mac(key, bookingNumber, summaryId, expiresAt, nonce) {
  return crypto.createHmac('sha256', key)
    .update(DOMAIN + bookingNumber + '\n' + summaryId + '\n' + expiresAt + '\n' + nonce, 'utf8')
    .digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function equal(a, b) {
  const left = Buffer.from(String(a), 'utf8'), right = Buffer.from(String(b), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Called ONLY from createBooking after a freshly allocated first-room save and
// a newly created Summary row. Returns '' on any failure; never logged.
export async function mintSummaryCapability(bookingNumber, summaryId) {
  try {
    if (!validId(bookingNumber) || !validId(summaryId)) return '';
    const expiresAt = String(Date.now() + TTL_MS);
    const nonce = crypto.randomBytes(16).toString('hex');
    return PREFIX + '.' + expiresAt + '.' + nonce + '.' + mac(await secret(), bookingNumber, summaryId, expiresAt, nonce);
  } catch (_) { return ''; }
}

// Synchronous expiry check; callers repeat it immediately before dispatching a write.
export function capabilityUnexpired(capability) {
  const match = typeof capability === 'string' ? TOKEN.exec(capability) : null;
  return !!match && Number(match[1]) > Date.now();
}

// Returns the single bound Summary row, or null. Never throws, never logs inputs.
export async function verifySummaryCapability(bookingNumber, capability) {
  try {
    if (!validId(bookingNumber) || typeof capability !== 'string') return null;
    const match = TOKEN.exec(capability);
    if (!match) return null;
    const expiresAt = Number(match[1]), now = Date.now();
    if (!(expiresAt > now) || expiresAt > now + TTL_MS + SKEW_MS) return null;
    const rows = await wixData.query('BookingSummary').eq('bookingNumber', bookingNumber).limit(2).find(READ);
    if (!rows || !Array.isArray(rows.items) || rows.items.length !== 1) return null;
    const row = rows.items[0];
    if (!row || row.bookingNumber !== bookingNumber || !validId(row._id)) return null;
    if (!equal(mac(await secret(), bookingNumber, row._id, match[1], match[2]), match[3])) return null;
    // Re-check expiry after the query/secret awaits.
    return capabilityUnexpired(capability) ? row : null;
  } catch (_) { return null; }
}

// Used only by backend/microsoftAdsConversions.web after a server-confirmed
// upload. One field-scoped patch of one flag on the bound row (bookingNumber condition).
export async function markMicrosoftConversionUploaded(bookingNumber, capability) {
  const row = await verifySummaryCapability(bookingNumber, capability);
  if (!row) return false;
  if (row.microsoftConversionUploaded === true) return true;
  if (!capabilityUnexpired(capability)) return false; // immediately before dispatch
  try {
    await setSummaryFlag(row._id, bookingNumber, 'microsoftConversionUploaded');
    return true;
  } catch (_) { return false; }
}
