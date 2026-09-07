// Disconnected private negative association; never booking completion or send authority.
import wixData from 'wix-data';
import crypto from 'crypto';
import { Buffer } from 'buffer';
import { resolveGuestConsentBrowserContext } from 'backend/guestConsentContext';
import { readConsentBrowserWithdrawal } from 'backend/guestConsentWithdrawalStore';
import { readGuestBookingCredentialAuthority, acceptanceDigest, acceptanceTime, snapshotAcceptancePage } from 'backend/guestBookingIssuerAuthority';
import { readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';
import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';

const AUDIENCE = 'wanderlust-consent-negative-v1';
const COLLECTION = 'GuestConsentBookingLinks';
const READ = { suppressAuth: true, suppressHooks: true, consistentRead: true };
const WRITE = { suppressAuth: true, suppressHooks: true };
const id = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = (domain, values) => crypto.createHash('sha256').update(Buffer.from(domain + '\0' + JSON.stringify(values), 'utf8')).digest('hex');
function budget() {
  let last = acceptanceTime(), stopped = false;
  const deadline = last + 10000;
  function sample() {
    if (stopped) throw Error('UNKNOWN');
    const now = acceptanceTime();
    if (now < last) throw Error('DENIED');
    last = now;
    if (now >= deadline) throw Error('UNKNOWN');
    return now;
  }
  async function io(invoke) {
    sample();
    let timer;
    try {
      const pending = Promise.resolve().then(() => { sample(); return invoke(); });
      const result = await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => { stopped = true; reject(Error('UNKNOWN')); }, deadline - last);
      })]);
      sample();
      return result;
    } finally { clearTimeout(timer); }
  }
  return { deadline, sample, io };
}
function linkRow(contextId, root) {
  const acceptanceId = root._id, bookingAudience = root.audience, acceptanceRootDigest = root.rootDigest;
  const scope = 'OPTIONAL_ADVERTISING_ALL', source = 'AUTHENTICATED_ACCEPTED_INTENT_LINK';
  const linkId = hash('wbe.consent.booking-link-id.v1', [1, AUDIENCE, contextId, bookingAudience, acceptanceId]);
  return { _id: linkId, schemaVersion: 1, audience: AUDIENCE, contextId, bookingAudience, acceptanceId, acceptanceRootDigest, scope, source,
    recordDigest: hash('wbe.consent.booking-link-record.v1', [1, linkId, AUDIENCE, contextId, bookingAudience, acceptanceId, acceptanceRootDigest, scope, source]) };
}
function exact(row, expected) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(row);
  for (const key of Reflect.ownKeys(descriptors)) {
    const d = descriptors[key];
    if (!d.enumerable || !Object.hasOwn(d, 'value')) return false;
    if (Object.hasOwn(expected, key)) { if (d.value !== expected[key]) return false; }
    else if (key === '_owner') { if (typeof d.value !== 'string') return false; }
    else if (key === '_createdDate' || key === '_updatedDate') {
      try { if (!(d.value instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(d.value))) return false; } catch (_) { return false; }
    } else return false;
  }
  return Object.keys(expected).every(key => Object.hasOwn(descriptors, key));
}
function bound(root, claims, acceptanceId, capsule) {
  return root._id === acceptanceId && root.operationId === claims.intentId && root.audience === claims.audience &&
    root.intentDigest === claims.intentDigest && root.quoteDigest === claims.quoteDigest && root.issuedAtMs === claims.issuedAtMs &&
    root.offerExpiresAtMs === claims.expiresAtMs && root.capsule === capsule;
}
function classify(page, expected) {
  let p;
  try { p = snapshotAcceptancePage(page, 2); } catch (_) { return 'INTEGRITY'; }
  if (p.more) return 'UNKNOWN';
  if (!p.items.length) return 'ABSENT';
  return p.items.length === 1 && exact(p.items[0], expected) ? 'FOUND' : 'INTEGRITY';
}
export async function linkGuestConsentBrowserToAcceptedBooking(browserToken, bookingToken, capsule) {
  if (arguments.length !== 3 || typeof browserToken !== 'string' || browserToken.length !== 134 ||
      !/^wcn1\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(browserToken) || typeof bookingToken !== 'string' || bookingToken.length > 1024 ||
      !/^wgb1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(bookingToken) ||
      typeof capsule !== 'string' || !capsule.length || Buffer.byteLength(capsule, 'utf8') > 120000) return { status: 'DENIED' };
  try { JSON.parse(capsule); } catch (_) { return { status: 'DENIED' }; }
  try {
    const b = budget();
    const browser = await b.io(() => resolveGuestConsentBrowserContext(browserToken, b.deadline));
    if (browser.status !== 'AUTHENTICATED') return { status: browser.status === 'INTEGRITY' ? 'INTEGRITY' : browser.status === 'DENIED' ? 'DENIED' : 'UNKNOWN' };
    const keys = await b.io(() => readGuestBookingCredentialAuthority());
    if (keys === 'DENIED') return { status: 'DENIED' };
    const claims = keys.service.verifyCredential({ token: bookingToken, command: 'status', nowMs: b.sample() });
    if (claims === 'DENIED') return { status: 'DENIED' };
    const acceptanceId = acceptanceDigest('wbe.acceptance-id.v2', claims.intentId);
    const found = await b.io(() => readGuestBookingAcceptance(acceptanceId));
    // Only this invocation's loaded key snapshot is checked. No persisted per-intent revocation claim.
    function verify(root) {
      const now = b.sample();
      const current = keys.service.verifyCredential({ token: bookingToken, command: 'status', nowMs: now });
      if (current === 'DENIED' || now < claims.issuedAtMs || now >= claims.expiresAtMs ||
          (root && !bound(root, current, acceptanceId, capsule))) throw Error('DENIED');
    }
    verify();
    if (found.status !== 'FOUND') return { status: found.status === 'INTEGRITY' ? 'INTEGRITY' : 'UNKNOWN' };
    const checked = validateGuestBookingAcceptanceRoot(found.root);
    if (checked === 'DENIED' || !bound(checked.root, claims, acceptanceId, capsule)) return { status: 'INTEGRITY' };
    const root = checked.root, row = linkRow(browser.id, root);
    async function read() {
      const page = await b.io(() => { verify(root); return wixData.query(COLLECTION).eq('_id', row._id).limit(2).find(READ); });
      verify(root);
      const result = classify(page, row);
      verify(root);
      return result;
    }
    const before = await read();
    if (before === 'FOUND') return { status: 'LINKED' };
    if (before !== 'ABSENT') return { status: before === 'INTEGRITY' ? 'INTEGRITY' : 'UNKNOWN' };
    try {
      await b.io(() => {
        // Check INSIDE the queued closure: no await/queue between proof and actual SDK insert.
        verify(root);
        return wixData.insert(COLLECTION, row, WRITE);
      });
    } catch (_) { /* Lost acknowledgement is reconciled only while authority/deadline remains valid. */ }
    verify(root);
    const after = await read();
    return { status: after === 'FOUND' ? 'LINKED' : after === 'INTEGRITY' ? 'INTEGRITY' : 'UNKNOWN' };
  } catch (error) { return { status: error.message === 'DENIED' ? 'DENIED' : 'UNKNOWN' }; }
}
export async function readGuestConsentBookingNegative(acceptanceId) {
  if (arguments.length !== 1 || !id(acceptanceId)) return { status: 'UNRESOLVED' };
  try {
    const b = budget();
    const found = await b.io(() => readGuestBookingAcceptance(acceptanceId));
    if (found.status !== 'FOUND') return { status: found.status === 'INTEGRITY' ? 'INTEGRITY' : 'UNRESOLVED' };
    const checked = validateGuestBookingAcceptanceRoot(found.root);
    if (checked === 'DENIED' || checked.root._id !== acceptanceId) return { status: 'INTEGRITY' };
    const raw = await b.io(() => wixData.query(COLLECTION).eq('acceptanceId', acceptanceId).ascending('_id').limit(25).find(READ));
    let page;
    try { page = snapshotAcceptancePage(raw, 25); } catch (_) { return { status: 'INTEGRITY' }; }
    let last = null, corrupt = false;
    for (const row of page.items) {
      if (!id(row._id) || !id(row.contextId) || (last !== null && row._id <= last)) { corrupt = true; continue; }
      last = row._id;
      if (!exact(row, linkRow(row.contextId, checked.root))) { corrupt = true; continue; }
      const negative = await b.io(() => readConsentBrowserWithdrawal(row.contextId, b.deadline));
      if (negative.status === 'WITHDRAWN') return { status: 'WITHDRAWN' };
      if (negative.status === 'INTEGRITY') corrupt = true;
    }
    return { status: corrupt ? 'INTEGRITY' : 'UNRESOLVED' };
  } catch (_) { return { status: 'UNRESOLVED' }; }
}
