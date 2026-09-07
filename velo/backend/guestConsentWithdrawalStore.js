// Private, disconnected negative-only Wix boundary. No positive consent authority.
import wixData from 'wix-data';
import crypto from 'crypto';
import { Buffer } from 'buffer';

const AUDIENCE = 'wanderlust-consent-negative-v1';
const HEX = /^[a-f0-9]{64}$/;
const READ = { suppressAuth: true, suppressHooks: true, consistentRead: true };
const WRITE = { suppressAuth: true, suppressHooks: true };
const validId = value => typeof value === 'string' && HEX.test(value);
const hash = (domain, values) => crypto.createHash('sha256').update(Buffer.from(domain + '\0' + JSON.stringify(values), 'utf8')).digest('hex');
const active = deadline => Number.isSafeInteger(deadline) && deadline > Date.now() && deadline <= Date.now() + 10000;
function contextRow(id, digest) {
  return { _id: id, schemaVersion: 1, audience: AUDIENCE, capabilityDigest: digest, scope: 'BROWSER_NEGATIVE_ONLY' };
}
function negativeRow(contextId) {
  const scope = 'OPTIONAL_ADVERTISING_ALL', source = 'EXPLICIT_BROWSER_WITHDRAWAL';
  const id = hash('wbe.consent.withdrawal-id.v1', [1, AUDIENCE, contextId, scope]);
  return { _id: id, schemaVersion: 1, audience: AUDIENCE, contextId, scope, source,
    recordDigest: hash('wbe.consent.withdrawal-record.v1', [1, id, AUDIENCE, contextId, scope, source]) };
}
function exact(row, expected) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(row);
  for (const key of Reflect.ownKeys(descriptors)) {
    const d = descriptors[key];
    if (!Object.hasOwn(d, 'value')) return false;
    if (Object.hasOwn(expected, key)) { if (d.value !== expected[key]) return false; }
    else if (key === '_owner') { if (typeof d.value !== 'string') return false; }
    else if (key === '_createdDate' || key === '_updatedDate') {
      try { if (!Number.isFinite(Date.prototype.getTime.call(d.value))) return false; } catch (_) { return false; }
    } else return false;
  }
  return Object.keys(expected).every(key => Object.hasOwn(descriptors, key));
}
// Each individual SDK wait is bounded. A timed-out write may still commit;
// its settled result is consumed, but cannot start another SDK operation.
async function io(deadline, invoke) {
  if (!active(deadline)) throw new Error('Unavailable');
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => { if (!active(deadline)) throw new Error('Unavailable'); return invoke(); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Unavailable')), Math.max(0, deadline - Date.now())); })
    ]);
    if (!active(deadline)) throw new Error('Unavailable');
    return result;
  } finally { clearTimeout(timer); }
}
async function read(collection, id, expected, deadline) {
  try {
    const page = await io(deadline, () => wixData.query(collection).eq('_id', id).limit(2).find(READ));
    if (!page || !Array.isArray(page.items) || typeof page.hasNext !== 'function') return { status: 'UNRESOLVED' };
    if (page.hasNext() !== false) return { status: 'UNRESOLVED' };
    if (page.items.length === 0) return { status: 'ABSENT' };
    if (page.items.length !== 1) return { status: 'INTEGRITY' };
    const row = page.items[0];
    if (collection === 'GuestConsentBrowserContexts') {
      const d = row && Object.getOwnPropertyDescriptor(row, 'capabilityDigest');
      if (!d || !Object.hasOwn(d, 'value') || !validId(d.value)) return { status: 'INTEGRITY' };
      expected = contextRow(id, d.value);
    }
    if (!exact(row, expected)) return { status: 'INTEGRITY' };
    return { status: 'FOUND', row: expected };
  } catch (_) { return { status: 'UNRESOLVED' }; }
}
export async function insertConsentBrowserContext(id, digest, deadline) {
  if (arguments.length !== 3 || !validId(id) || !validId(digest) || !active(deadline)) return { status: 'UNKNOWN' };
  const row = contextRow(id, digest);
  try { await io(deadline, () => wixData.insert('GuestConsentBrowserContexts', row, WRITE)); } catch (_) { /* Reconcile only within original deadline. */ }
  if (!active(deadline)) return { status: 'UNKNOWN' };
  const result = await read('GuestConsentBrowserContexts', id, row, deadline);
  return { status: result.status === 'FOUND' && exact(result.row, row) ? 'RECORDED' : 'UNKNOWN' };
}
export async function readConsentBrowserContext(id, deadline) {
  if (arguments.length !== 2 || !validId(id) || !active(deadline)) return { status: 'UNRESOLVED' };
  return read('GuestConsentBrowserContexts', id, null, deadline);
}
export async function recordConsentBrowserWithdrawal(contextId, deadline) {
  if (arguments.length !== 2 || !validId(contextId) || !active(deadline)) return { status: 'UNKNOWN' };
  const row = negativeRow(contextId);
  const before = await read('GuestConsentWithdrawals', row._id, row, deadline);
  if (before.status === 'FOUND') return { status: 'RECORDED' };
  if (before.status === 'INTEGRITY') return { status: 'INTEGRITY' };
  if (before.status !== 'ABSENT' || !active(deadline)) return { status: 'UNKNOWN' };
  try { await io(deadline, () => wixData.insert('GuestConsentWithdrawals', row, WRITE)); } catch (_) { /* A conflict/ack is not success. */ }
  if (!active(deadline)) return { status: 'UNKNOWN' };
  const after = await read('GuestConsentWithdrawals', row._id, row, deadline);
  return { status: after.status === 'FOUND' ? 'RECORDED' : after.status === 'INTEGRITY' ? 'INTEGRITY' : 'UNKNOWN' };
}
export async function readConsentBrowserWithdrawal(contextId, deadline) {
  if (arguments.length !== 2 || !validId(contextId) || !active(deadline)) return { status: 'UNRESOLVED' };
  const row = negativeRow(contextId);
  const result = await read('GuestConsentWithdrawals', row._id, row, deadline);
  return { status: result.status === 'FOUND' ? 'WITHDRAWN' : result.status === 'INTEGRITY' ? 'INTEGRITY' : 'UNRESOLVED' };
}
