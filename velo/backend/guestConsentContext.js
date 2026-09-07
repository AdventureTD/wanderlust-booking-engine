// Private browser capability for negative advertising authority only.
import crypto from 'crypto';
import { Buffer } from 'buffer';
import { insertConsentBrowserContext, readConsentBrowserContext, recordConsentBrowserWithdrawal, readConsentBrowserWithdrawal } from 'backend/guestConsentWithdrawalStore';

const AUDIENCE = 'wanderlust-consent-negative-v1';
const TOKEN = /^wcn1\.([a-f0-9]{64})\.([a-f0-9]{64})$/;
function digest(id, secret) {
  return crypto.createHash('sha256').update(Buffer.from('wbe.consent.capability.v1\0' + JSON.stringify([1, AUDIENCE, id, secret]), 'utf8')).digest('hex');
}
async function authenticate(token, deadline) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return { status: 'DENIED' };
  const [, id, secret] = TOKEN.exec(token);
  const found = await readConsentBrowserContext(id, deadline);
  if (found.status === 'INTEGRITY') return { status: 'INTEGRITY' };
  if (found.status === 'ABSENT') return { status: 'DENIED' };
  if (found.status !== 'FOUND') return { status: 'UNKNOWN' };
  const actual = Buffer.from(digest(id, secret), 'hex');
  const expected = Buffer.from(found.row.capabilityDigest, 'hex');
  if (!crypto.timingSafeEqual(actual, expected)) return { status: 'DENIED' };
  return { status: 'AUTHENTICATED', id };
}
// Private T2 consumer only; never expose this ID through a guest endpoint.
export async function resolveGuestConsentBrowserContext(token, deadline) {
  const start = Date.now();
  if (arguments.length !== 2 || typeof token !== 'string' || !Number.isSafeInteger(start) || start < 0 ||
      !Number.isSafeInteger(deadline) || deadline <= start || deadline > start + 10000) return { status: 'DENIED' };
  try {
    const result = await authenticate(token, deadline);
    const now = Date.now();
    if (!Number.isSafeInteger(now) || now < start || now >= deadline) return { status: 'UNKNOWN' };
    return result;
  } catch (_) { return { status: 'UNKNOWN' }; }
}
export async function createGuestConsentBrowserContext() {
  if (arguments.length !== 0) return { status: 'UNKNOWN' };
  const deadline = Date.now() + 10000;
  try {
    const id = crypto.randomBytes(32).toString('hex');
    const secret = crypto.randomBytes(32).toString('hex');
    const result = await insertConsentBrowserContext(id, digest(id, secret), deadline);
    return result.status === 'RECORDED' && Date.now() < deadline
      ? { status: 'CREATED', token: `wcn1.${id}.${secret}` } : { status: 'UNKNOWN' };
  } catch (_) { return { status: 'UNKNOWN' }; }
}
export async function withdrawGuestConsentBrowser(token) {
  if (arguments.length !== 1) return { status: 'DENIED' };
  const deadline = Date.now() + 10000;
  try {
    const auth = await authenticate(token, deadline);
    if (auth.status !== 'AUTHENTICATED') return { status: auth.status };
    if (Date.now() >= deadline) return { status: 'UNKNOWN' };
    return await recordConsentBrowserWithdrawal(auth.id, deadline);
  } catch (_) { return { status: 'UNKNOWN' }; }
}
export async function readGuestConsentBrowserNegative(token) {
  if (arguments.length !== 1) return { status: 'DENIED' };
  const deadline = Date.now() + 10000;
  try {
    const auth = await authenticate(token, deadline);
    if (auth.status !== 'AUTHENTICATED') return { status: auth.status === 'UNKNOWN' ? 'UNRESOLVED' : auth.status };
    if (Date.now() >= deadline) return { status: 'UNRESOLVED' };
    return await readConsentBrowserWithdrawal(auth.id, deadline);
  } catch (_) { return { status: 'UNRESOLVED' }; }
}
