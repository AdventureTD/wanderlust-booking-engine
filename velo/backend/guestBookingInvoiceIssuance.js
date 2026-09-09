// Private initial-issuance admission only. Disconnected from recovery and delivery.
// Admission is NOT a send grant, rendered document, capability, or delivery status.
import wixData from 'wix-data';
import { createHash } from 'crypto';
import { readRecoveredGuestBookingCompletion } from 'backend/guestBookingCompletionAuthority';

const COLLECTION = 'GuestBookingInvoiceIssuances';
const WRITE = Object.freeze({ suppressAuth: true, suppressHooks: true });
const READ = Object.freeze({ ...WRITE, consistentRead: true });
const HOTEL = 'info@wanderlustcaribbean.com';
const HEX = /^[a-f0-9]{64}$/;
const MAX_BYTES = 160000;
const digest = (domain, text) => createHash('sha256').update(domain + '\0' + text, 'utf8').digest('hex');
const status = value => ({ status: value });

function proposal(receipt) {
  const issuanceId = digest('wbe.guest-initial-invoice.v1', JSON.stringify([
    receipt.audience, receipt._id, 'initial', receipt.recipientBindingDigest
  ]));
  // Preserve canonical producer bytes; do not merge groups or reconstruct taxes.
  // No invoice-number counter, current payment lookup, or invented empty payments.
  return {
    _id: issuanceId, schemaVersion: 1, kind: 'INITIAL_ISSUANCE', revision: 'initial',
    audience: receipt.audience, acceptanceId: receipt.acceptanceId,
    operationId: receipt.operationId, rootDigest: receipt.rootDigest,
    receiptId: receipt._id, projectionDigest: receipt.projectionDigest,
    financialDigest: receipt.financialDigest,
    recipientBindingDigest: receipt.recipientBindingDigest,
    projectionCanonical: receipt.projectionCanonical,
    to: receipt.recipient, cc: HOTEL, from: HOTEL
  };
}

function exactApplication(row, expected) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(row);
  if (Object.getOwnPropertySymbols(row).length) return false;
  const required = Object.keys(expected);
  for (const key of Reflect.ownKeys(descriptors)) {
    const field = descriptors[key];
    if (!Object.hasOwn(field, 'value')) return false;
    if (required.includes(key)) {
      if (!field.enumerable || field.value !== expected[key]) return false;
    } else if (key === '_owner') {
      if (field.value !== null && (typeof field.value !== 'string' || field.value.length > 256)) return false;
    } else if (key === '_createdDate' || key === '_updatedDate') {
      try { if (!Number.isFinite(Date.prototype.getTime.call(field.value))) return false; }
      catch (_) { return false; }
    } else return false;
  }
  return required.every(key => Object.hasOwn(descriptors, key));
}

async function readExact(expected) {
  const page = await wixData.query(COLLECTION).eq('_id', expected._id).limit(2).find(READ);
  const field = page && Object.getOwnPropertyDescriptor(page, 'items');
  if (!field || !Object.hasOwn(field, 'value') || !Array.isArray(field.value) ||
      typeof page.hasNext !== 'function') return 'UNKNOWN';
  const rows = field.value;
  const more = page.hasNext();
  if (typeof more !== 'boolean') return 'UNKNOWN';
  if (more || rows.length > 1) return 'INTEGRITY';
  if (!rows.length) return 'ABSENT';
  const row = Object.getOwnPropertyDescriptor(rows, '0');
  if (!row || !Object.hasOwn(row, 'value')) return 'INTEGRITY';
  return exactApplication(row.value, expected) ? 'FOUND' : 'INTEGRITY';
}

export async function advanceInitialGuestInvoiceForRecoveredAcceptance(acceptanceId, operationId, rootDigest) {
  if (arguments.length !== 3 || [acceptanceId, operationId, rootDigest].some(
    value => typeof value !== 'string' || !HEX.test(value)) ||
    acceptanceId !== digest('wbe.acceptance-id.v2', operationId)) return status('DENIED');
  try {
    // Private actor custody supplies permission; these public digests do not.
    // Reader revalidates even an existing issuance; no status-only shortcuts.
    const completion = await readRecoveredGuestBookingCompletion(acceptanceId, operationId, rootDigest);
    if (completion.status !== 'VERIFIED_COMPLETION') return status(completion.status);
    const expected = Object.freeze(proposal(completion.receipt));
    if (Buffer.byteLength(JSON.stringify(expected), 'utf8') > MAX_BYTES) return status('UNKNOWN');
    const existing = await readExact(expected);
    if (existing === 'FOUND') return { status: 'INITIAL_ISSUANCE_ADMITTED', issuanceId: expected._id };
    if (existing !== 'ABSENT') return status(existing);
    // Reconciliation is safe for this immutable admission ONLY, never for START.
    try { await wixData.insert(COLLECTION, expected, WRITE); } catch (_) { /* exact read decides */ }
    const retained = await readExact(expected);
    if (retained !== 'FOUND') return status(retained === 'ABSENT' ? 'UNKNOWN' : retained);
    return { status: 'INITIAL_ISSUANCE_ADMITTED', issuanceId: expected._id };
  } catch (_) {
    return status('UNKNOWN');
  }
}
