// Private disconnected guest delivery journal. No HTTP/recovery/public consumer.
// A/O/D must come from trusted server discovery, never caller-selected guest IDs.
import wixData from 'wix-data';
import { createHash } from 'crypto';
import { readRecoveredGuestBookingCompletion } from 'backend/guestBookingCompletionAuthority';

const COLLECTION = 'GuestBookingInvoiceIssuances';
const WRITE = Object.freeze({ suppressAuth: true, suppressHooks: true });
const READ = Object.freeze({ ...WRITE, consistentRead: true });
const HOTEL = 'info@wanderlustcaribbean.com';
const HEX = /^[a-f0-9]{64}$/;
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const key = (domain, values) => hash(domain + '\0' + JSON.stringify(values));
function deny() { throw Error('guest_delivery_unavailable'); }
function data(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.getOwnPropertySymbols(row).length) deny();
  const result = Object.create(null);
  for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(row))) {
    if (!Object.hasOwn(d, 'value') || !d.enumerable) deny();
    if (name === '_owner') {
      if (d.value !== null && (typeof d.value !== 'string' || d.value.length > 256)) deny();
    } else if (name === '_createdDate' || name === '_updatedDate') {
      if (!Number.isFinite(Date.prototype.getTime.call(d.value))) deny();
    } else result[name] = d.value;
  }
  return result;
}
function equal(actual, expected) {
  const row = data(actual);
  if (Object.keys(row).length !== Object.keys(expected).length ||
      Object.keys(expected).some(k => !Object.hasOwn(row,k) || row[k] !== expected[k])) deny();
  return row;
}
async function exact(collection, id) {
  const page = await wixData.query(collection).eq('_id', id).limit(2).find(READ);
  const d = page && Object.getOwnPropertyDescriptor(page, 'items');
  if (!d || !Object.hasOwn(d,'value') || !Array.isArray(d.value) ||
      typeof page.hasNext !== 'function' || page.hasNext() !== false || d.value.length > 1) deny();
  if (!d.value.length) return null;
  const item = Object.getOwnPropertyDescriptor(d.value,'0');
  if (!item || !Object.hasOwn(item,'value')) deny();
  return data(item.value);
}
async function authority(a,o,d) {
  const completion = await readRecoveredGuestBookingCompletion(a,o,d);
  if (completion.status !== 'VERIFIED_COMPLETION') deny();
  const r = completion.receipt;
  const expected = Object.freeze({
    _id:key('wbe.guest-initial-invoice.v1',[r.audience,r._id,'initial',r.recipientBindingDigest]),
    schemaVersion:1, kind:'INITIAL_ISSUANCE', revision:'initial', audience:r.audience,
    acceptanceId:a, operationId:o, rootDigest:d, receiptId:r._id,
    projectionDigest:r.projectionDigest, financialDigest:r.financialDigest,
    recipientBindingDigest:r.recipientBindingDigest, projectionCanonical:r.projectionCanonical,
    to:r.recipient, cc:HOTEL, from:HOTEL
  });
  equal(await exact(COLLECTION,expected._id),expected);
  // Finite initial tranche: positively established empty payment history ONLY.
  // Nonempty/unknown payments defer; never convert failed reads into zero paid.
  const page = await wixData.query('BookingPayments').eq('bookingNumber',r.bookingNumber).limit(1).find(READ);
  const rows = page && Object.getOwnPropertyDescriptor(page,'items');
  if (!rows || !Object.hasOwn(rows,'value') || !Array.isArray(rows.value) || rows.value.length ||
      typeof page.hasNext !== 'function' || page.hasNext() !== false) deny();
  return expected;
}
function stageId(root,kind) { return key('wbe.guest-invoice-delivery.v1',[root._id,kind]); }
function artifactRecord(root,input) {
  const p=data(input);
  equal(p,{encoded:p.encoded,mimeDigest:p.mimeDigest,pdfDigest:p.pdfDigest,rendererVersion:p.rendererVersion});
  if (typeof p.encoded!=='string' || !p.encoded.length || p.encoded.length>120000 ||
      typeof p.mimeDigest!=='string' || !HEX.test(p.mimeDigest) ||
      typeof p.pdfDigest!=='string' || !HEX.test(p.pdfDigest) ||
      !['word','reportlab','reportlab-fallback'].includes(p.rendererVersion)) deny();
  const raw=Buffer.from(p.encoded,'base64');
  if (raw.toString('base64')!==p.encoded || createHash('sha256').update(raw).digest('hex')!==p.mimeDigest) deny();
  return Object.freeze({_id:stageId(root,'PREPARED'),kind:'PREPARED',issuanceId:root._id,
    documentDigest:root.projectionDigest,...p,
    artifactDigest:key('wbe.guest-invoice-artifact.v1',[root._id,root.projectionDigest,p.mimeDigest,p.pdfDigest,p.rendererVersion])});
}
function startRecord(root,artifact,payload) {
  const p=data(payload);
  equal(p,{artifactDigest:p.artifactDigest,invocationNonce:p.invocationNonce});
  if (!artifact || p.artifactDigest!==artifact.artifactDigest ||
      typeof p.invocationNonce!=='string' || !HEX.test(p.invocationNonce)) deny();
  return Object.freeze({_id:stageId(root,'START'),kind:'START',issuanceId:root._id,
    documentDigest:root.projectionDigest,...p});
}
function ackRecord(root,start,payload) {
  const p=data(payload);
  equal(p,{artifactDigest:p.artifactDigest,invocationNonce:p.invocationNonce,providerMessageId:p.providerMessageId});
  if (!start || p.artifactDigest!==start.artifactDigest || p.invocationNonce!==start.invocationNonce ||
      typeof p.providerMessageId!=='string' || !/^[A-Za-z0-9_-]{1,256}$/.test(p.providerMessageId)) deny();
  return Object.freeze({_id:stageId(root,'ACK'),kind:'ACK',issuanceId:root._id,
    documentDigest:root.projectionDigest,...p});
}
async function state(root) {
  let artifact=await exact(COLLECTION,stageId(root,'PREPARED'));
  let start=await exact(COLLECTION,stageId(root,'START'));
  let ack=await exact(COLLECTION,stageId(root,'ACK'));
  if (artifact) artifact=equal(artifact,artifactRecord(root,{
    encoded:artifact.encoded,mimeDigest:artifact.mimeDigest,pdfDigest:artifact.pdfDigest,rendererVersion:artifact.rendererVersion}));
  if (start) start=equal(start,startRecord(root,artifact,{artifactDigest:start.artifactDigest,invocationNonce:start.invocationNonce}));
  if (ack) ack=equal(ack,ackRecord(root,start,{artifactDigest:ack.artifactDigest,invocationNonce:ack.invocationNonce,providerMessageId:ack.providerMessageId}));
  return {status:ack?'PROVIDER_ACCEPTED':start?'OWNER_REVIEW_REQUIRED':'READY',root,payments:[],artifact,start,ack};
}
async function append(record) {
  try { await wixData.insert(COLLECTION,record,WRITE); } catch (_) { /* never used for START */ }
  equal(await exact(COLLECTION,record._id),record);
}
export async function guestBookingInvoiceDeliveryOperation(a,o,d,operation,payload) {
  if (arguments.length !== 5 || [a,o,d].some(v=>typeof v!=='string'||!HEX.test(v)) ||
      a!==hash('wbe.acceptance-id.v2\0'+o) ||
      !['readIssuance','commitArtifact','tryStart','recordAck'].includes(operation)) return {status:'DENIED'};
  let attemptedStart=false;
  try {
    const root = await authority(a,o,d);
    const current=await state(root);
    if (operation==='readIssuance') { equal(payload,{}); return current; }
    if (operation==='recordAck') {
      const record=ackRecord(root,current.start,payload);
      if (current.ack) {equal(current.ack,record);return current;}
      equal(await authority(a,o,d),root);
      await append(record);
      return await state(root);
    }
    if (current.start || current.ack) return current;
    if (operation==='commitArtifact') {
      const record=artifactRecord(root,payload);
      if (current.artifact) {equal(current.artifact,record);return current;}
      equal(await authority(a,o,d),root);
      await append(record);
      return await state(root);
    }
    const record=startRecord(root,current.artifact,payload);
    equal(await authority(a,o,d),root);
    // Only this native insertion's positive acknowledgment AND exact readback
    // confer an ephemeral grant. Duplicate/lost ACK must NEVER reconstruct it.
    attemptedStart=true;
    equal(await wixData.insert(COLLECTION,record,WRITE),record);
    equal(await exact(COLLECTION,record._id),record);
    equal(await authority(a,o,d),root);
    return {won:true,invocationNonce:record.invocationNonce,artifactDigest:record.artifactDigest};
  } catch (_) { return {status:attemptedStart?'OWNER_REVIEW_REQUIRED':'UNAVAILABLE'}; }
}
