// Private, append-only Admin document admission. No dispatch/start capability yet.
import wixData from 'wix-data';
import { createHash } from 'crypto';

const COLLECTION = 'InvoiceEmailJournal';
const WRITE = { suppressAuth: true, suppressHooks: true };
const READ = { ...WRITE, consistentRead: true };
const HOTEL = 'info@wanderlustcaribbean.com';
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const COMPONENTS = ['grossCents', 'discountCents', 'roomTotalCents', 'propertyFeeCents',
  'accommodationVatCents', 'packageVatCents', 'totalVatCents', 'grandTotalCents'];
function deny(reason) { throw new Error(`owner_invoice_${reason}`); }
function shape(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) deny('shape');
  const keys = Object.keys(value);
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !required.includes(key) && !optional.includes(key))) deny('fields');
}
function text(value, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) deny('text');
}
function cents(value) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) deny('cents');
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) deny('date');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) deny('date');
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || Object.is(value, -0))) deny('number');
  if (!['string', 'number'].includes(typeof value)) deny('value');
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function key(namespace, ...parts) { return hash(canonical([namespace, ...parts])); }
function validate(command) {
  shape(command, ['requestId', 'invoiceNumber', 'revision', 'issueDate', 'guest', 'checkIn', 'checkOut', 'roomCode', 'purpose', 'payments', 'financial'], ['bookingNumber', 'parentIssuanceId', 'reissueReason']);
  if (typeof command.requestId !== 'string' || typeof command.revision !== 'string' ||
      !UUID.test(command.requestId) || !UUID.test(command.revision)) deny('uuid');
  text(command.invoiceNumber, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command.invoiceNumber)) deny('invoice_number');
  day(command.issueDate); day(command.checkIn); day(command.checkOut);
  if (command.checkOut <= command.checkIn) deny('stay');
  text(command.roomCode, 2000);
  shape(command.guest, ['name', 'email', 'phone']);
  text(command.guest.name); text(command.guest.phone); text(command.guest.email, 254);
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(command.guest.email)) deny('mailbox');
  if (command.guest.phone.replace(/\D/g, '').length < 7) deny('phone');
  if (!['guest_invoice', 'owner_copy'].includes(command.purpose)) deny('purpose');
  if (Object.hasOwn(command, 'bookingNumber')) text(command.bookingNumber, 100);
  if (Object.hasOwn(command, 'parentIssuanceId') || Object.hasOwn(command, 'reissueReason')) {
    if (typeof command.parentIssuanceId !== 'string' || !/^[a-f0-9]{64}$/.test(command.parentIssuanceId)) deny('parent');
    text(command.reissueReason, 2000);
  }
  if (!Array.isArray(command.payments) || command.payments.length > 1000) deny('payments');
  for (const payment of command.payments) {
    shape(payment, ['datePaid', 'paymentAmountCents']); day(payment.datePaid); cents(payment.paymentAmountCents);
  }
  const f = command.financial;
  shape(f, ['currency', 'components', 'lines']);
  if (f.currency !== 'USD') deny('currency');
  shape(f.components, COMPONENTS);
  const c = f.components;
  COMPONENTS.forEach(name => cents(c[name]));
  if (c.grossCents !== c.discountCents + c.roomTotalCents ||
      c.totalVatCents !== c.accommodationVatCents + c.packageVatCents ||
      c.grandTotalCents !== c.roomTotalCents + c.propertyFeeCents + c.totalVatCents) deny('reconciliation');
  if (!Array.isArray(f.lines) || !f.lines.length || f.lines.length > 1000) deny('lines');
  let net = 0; let accommodationVat = 0; let packageVat = 0;
  for (const line of f.lines) {
    shape(line, ['label', 'taxClass', 'quantity', 'roomQuantity', 'unitPriceCents', 'netCents', 'vatCents', 'grossCents', 'vatRateBasisPoints']);
    text(line.label, 2000);
    for (const name of ['quantity', 'roomQuantity', 'unitPriceCents', 'netCents', 'vatCents', 'grossCents', 'vatRateBasisPoints']) cents(line[name]);
    if (!line.quantity || !line.roomQuantity || line.vatRateBasisPoints > 10000 || !['accommodation', 'standard'].includes(line.taxClass) || line.grossCents !== line.netCents + line.vatCents) deny('line');
    net += line.netCents;
    if (line.taxClass === 'accommodation') accommodationVat += line.vatCents;
    else packageVat += line.vatCents;
    [net, accommodationVat, packageVat].forEach(cents);
  }
  if (net !== c.roomTotalCents || accommodationVat !== c.accommodationVatCents || packageVat !== c.packageVatCents) deny('line_reconciliation');
}
async function appendExact(record) {
  // Lost insert ACK is safe to reconcile ONLY for admission, never a send grant.
  try { await wixData.insert(COLLECTION, record, WRITE); } catch (_) { /* exact read decides */ }
  const stored = await wixData.get(COLLECTION, record._id, READ);
  if (!stored) deny('unavailable');
  const projected = {};
  for (const name of Object.keys(record)) projected[name] = stored[name];
  if (canonical(projected) !== canonical(record)) deny('conflict');
  if (Object.keys(stored).some(name => !Object.hasOwn(record, name) && !['_createdDate', '_updatedDate', '_owner'].includes(name))) deny('integrity');
  return record;
}
function exactStored(stored, expected) {
  shape(stored, Object.keys(expected), ['_createdDate', '_updatedDate', '_owner']);
  const projected = {};
  for (const name of Object.keys(expected)) projected[name] = stored[name];
  if (canonical(projected) !== canonical(expected)) deny('conflict');
}
function validRoot(stored) {
  const fields = ['_id', 'kind', 'actorId', 'document', 'documentDigest', 'purpose', 'to', 'cc', 'from'];
  shape(stored, fields, ['_createdDate', '_updatedDate', '_owner']);
  const application = {};
  fields.forEach(name => { application[name] = stored[name]; });
  text(stored.actorId);
  if (stored.kind !== 'ISSUANCE' || typeof stored.document !== 'string') deny('integrity');
  let document;
  try { document = JSON.parse(stored.document); } catch (_) { deny('integrity'); }
  if (document.schema !== 'owner-invoice-document/v1' || Object.hasOwn(document, 'requestId')) deny('integrity');
  const { schema, ...facts } = document;
  validate({ requestId: '12345678-1234-4234-8234-123456789abc', ...facts });
  if (canonical(document) !== stored.document || hash(stored.document) !== stored.documentDigest ||
      key('owner-invoice-revision/v1', facts.invoiceNumber, facts.revision) !== stored._id ||
      stored.purpose !== facts.purpose || stored.to !== (facts.purpose === 'owner_copy' ? HOTEL : facts.guest.email) ||
      stored.cc !== (facts.purpose === 'owner_copy' ? '' : HOTEL) || stored.from !== HOTEL ||
      Buffer.byteLength(canonical(application), 'utf8') > 160000) deny('integrity');
  return facts;
}
async function appendRoot(record) {
  let acknowledged = false;
  try { await wixData.insert(COLLECTION, record, WRITE); acknowledged = true; } catch (_) { /* admission reconciliation only */ }
  const stored = await wixData.get(COLLECTION, record._id, READ);
  if (!stored) deny('unavailable');
  validRoot(stored);
  // Only a duplicate/lost ACK can reconcile another creator's exact winner.
  exactStored(stored, acknowledged ? record : { ...record, actorId: stored.actorId });
  return stored;
}
async function inspectParent(facts, issuanceId) {
  let id = facts.parentIssuanceId;
  const seen = new Set([issuanceId]);
  let immediate;
  while (id) {
    if (seen.has(id) || seen.size > 100) deny('parent_lineage');
    seen.add(id);
    const root = await wixData.get(COLLECTION, id, READ);
    if (!root || root._id !== id) deny('parent_integrity');
    const parent = validRoot(root);
    if (parent.invoiceNumber !== facts.invoiceNumber) deny('parent_invoice');
    if (!immediate) immediate = root;
    id = parent.parentIssuanceId;
  }
  if (!immediate) return;
  const start = await wixData.get(COLLECTION, key('invoice-send-start/v1', immediate._id), READ);
  const ack = await wixData.get(COLLECTION, key('invoice-send-ack/v1', immediate._id), READ);
  if (start === null && ack === null) return;
  // Unknown SDK values are not complete absence; stage readers never grant send.
  if (!start) deny('parent_integrity');
  shape(start, ['_id', 'kind', 'issuanceId', 'documentDigest', 'artifactDigest', 'workerBootId', 'invocationNonce'], ['_createdDate', '_updatedDate', '_owner']);
  if (start._id !== key('invoice-send-start/v1', immediate._id) || start.kind !== 'START' ||
      start.issuanceId !== immediate._id || start.documentDigest !== immediate.documentDigest ||
      typeof start.artifactDigest !== 'string' || !/^[a-f0-9]{64}$/.test(start.artifactDigest)) deny('parent_integrity');
  text(start.workerBootId); text(start.invocationNonce);
  if (ack === null) deny('parent_owner_review_required');
  shape(ack, ['_id', 'kind', 'issuanceId', 'documentDigest', 'artifactDigest', 'invocationNonce', 'to', 'cc', 'from', 'providerMessageId', 'status'], ['_createdDate', '_updatedDate', '_owner']);
  text(ack.providerMessageId);
  const expected = { _id: key('invoice-send-ack/v1', immediate._id), kind: 'ACK', issuanceId: immediate._id,
    documentDigest: immediate.documentDigest, artifactDigest: start.artifactDigest, invocationNonce: start.invocationNonce,
    to: immediate.to, cc: immediate.cc, from: immediate.from, providerMessageId: ack.providerMessageId, status: 'provider_accepted' };
  exactStored(ack, expected);
  await inspectParentArtifact(immediate, start.artifactDigest);
}
async function inspectParentArtifact(root, artifactDigest) {
  // Retained stage integrity only, not MIME semantic validation or a send grant.
  const fields = ['_id', 'kind', 'issuanceId', 'documentDigest', 'to', 'cc', 'from',
    'chunkIds', 'mimeDigest', 'byteLength', 'pdfDigest', 'rendererVersion'];
  const manifest = await wixData.get(COLLECTION, key('invoice-artifact/v1', root._id), READ);
  shape(manifest, fields, ['_createdDate', '_updatedDate', '_owner']);
  const application = {};
  fields.forEach(name => { application[name] = manifest[name]; });
  if (manifest._id !== key('invoice-artifact/v1', root._id) || manifest.kind !== 'ARTIFACT' ||
      manifest.issuanceId !== root._id || manifest.documentDigest !== root.documentDigest ||
      ['to', 'cc', 'from'].some(name => manifest[name] !== root[name]) ||
      Buffer.byteLength(canonical(application), 'utf8') > 160000 || hash(canonical(application)) !== artifactDigest) deny('parent_artifact');
  for (const name of ['mimeDigest', 'pdfDigest']) {
    if (typeof manifest[name] !== 'string' || !/^[a-f0-9]{64}$/.test(manifest[name])) deny('parent_artifact');
  }
  text(manifest.rendererVersion);
  cents(manifest.byteLength);
  if (!manifest.byteLength || manifest.byteLength > 8388608 || !Array.isArray(manifest.chunkIds) ||
      !manifest.chunkIds.length || manifest.chunkIds.length > 128) deny('parent_artifact');
  let encoded = '';
  for (const id of manifest.chunkIds) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) deny('parent_artifact');
    const chunk = await wixData.get(COLLECTION, id, READ);
    shape(chunk, ['_id', 'kind', 'data', 'digest'], ['_createdDate', '_updatedDate', '_owner']);
    if (chunk._id !== id || chunk.kind !== 'ARTIFACT_CHUNK' || typeof chunk.data !== 'string' ||
        !chunk.data.length || chunk.data.length > 100000 || typeof chunk.digest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(chunk.digest)) deny('parent_artifact');
    const bytes = Buffer.from(chunk.data, 'base64');
    if (bytes.toString('base64') !== chunk.data || createHash('sha256').update(bytes).digest('hex') !== chunk.digest ||
        key('invoice-artifact-chunk/v1', chunk.digest) !== id) deny('parent_artifact');
    encoded += chunk.data;
    if (encoded.length > 11184812) deny('parent_artifact');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.length !== manifest.byteLength ||
      createHash('sha256').update(bytes).digest('hex') !== manifest.mimeDigest) deny('parent_artifact');
}
export async function prepareOwnerIssuance(actorId, input) {
  text(actorId);
  // Validate before canonicalizing, detach before the first asynchronous SDK call.
  validate(input);
  const snapshot = JSON.parse(canonical(input));
  const { requestId, ...facts } = snapshot;
  const document = canonical({ schema: 'owner-invoice-document/v1', ...facts });
  if (Buffer.byteLength(document, 'utf8') > 160000) deny('oversize');
  const documentDigest = hash(document);
  const issuanceId = key('owner-invoice-revision/v1', facts.invoiceNumber, facts.revision);
  const request = { _id: key('owner-invoice-request/v1', actorId, requestId), kind: 'REQUEST',
    actorId, requestId, issuanceId, documentDigest, document };
  const issuance = { _id: issuanceId, kind: 'ISSUANCE', actorId, document, documentDigest,
    purpose: facts.purpose, to: facts.purpose === 'owner_copy' ? HOTEL : facts.guest.email,
    cc: facts.purpose === 'owner_copy' ? '' : HOTEL, from: HOTEL };
  if ([request, issuance].some(record => Buffer.byteLength(canonical(record), 'utf8') > 160000)) deny('oversize');
  const retained = await wixData.get(COLLECTION, request._id, READ);
  if (retained !== null) {
    if (!retained) deny('unavailable');
    exactStored(retained, request);
  } else {
    if (facts.parentIssuanceId) await inspectParent(facts, issuanceId);
    await appendExact(request);
  }
  await appendRoot(issuance);
  return { status: 'durably_prepared', issuanceId, revision: facts.revision, documentDigest };
}

// Consumer tranche: append-only effect records. Admission bytes above unchanged.
function digestId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) deny('digest');
}
function application(record) {
  const out = {};
  for (const name of Object.keys(record)) {
    if (!['_createdDate', '_updatedDate', '_owner'].includes(name)) out[name] = record[name];
  }
  return out;
}
async function rootFor(id) {
  digestId(id);
  const root = await wixData.get(COLLECTION, id, READ);
  validRoot(root);
  if (root._id !== id) deny('integrity');
  return application(root);
}
async function artifactBytes(root, manifest) {
  shape(manifest, ['_id', 'kind', 'issuanceId', 'documentDigest', 'to', 'cc', 'from', 'chunkIds', 'mimeDigest', 'byteLength', 'pdfDigest', 'rendererVersion']);
  if (manifest._id !== key('invoice-artifact/v1', root._id) || manifest.kind !== 'ARTIFACT' ||
      manifest.issuanceId !== root._id || manifest.documentDigest !== root.documentDigest ||
      ['to', 'cc', 'from'].some(n => manifest[n] !== root[n])) deny('artifact');
  digestId(manifest.mimeDigest); digestId(manifest.pdfDigest); text(manifest.rendererVersion);
  cents(manifest.byteLength);
  if (!manifest.byteLength || manifest.byteLength > 8388608 || !Array.isArray(manifest.chunkIds) ||
      !manifest.chunkIds.length || manifest.chunkIds.length > 128 || Buffer.byteLength(canonical(manifest)) > 160000) deny('artifact');
  let encoded = '';
  for (let index = 0; index < manifest.chunkIds.length; index++) {
    const id = manifest.chunkIds[index]; digestId(id);
    const stored = await wixData.get(COLLECTION, id, READ);
    if (!stored) deny('artifact');
    const chunk = application(stored);
    validateChunk(chunk);
    if (chunk._id !== id || (index < manifest.chunkIds.length - 1 && chunk.data.length !== 100000)) deny('artifact');
    encoded += chunk.data;
    if (encoded.length > 11184812) deny('artifact');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.length !== manifest.byteLength ||
      createHash('sha256').update(bytes).digest('hex') !== manifest.mimeDigest) deny('artifact');
  return encoded;
}
function validateChunk(chunk) {
  shape(chunk, ['_id', 'kind', 'data', 'digest']);
  digestId(chunk.digest);
  if (chunk.kind !== 'ARTIFACT_CHUNK' || typeof chunk.data !== 'string' || !chunk.data.length || chunk.data.length > 100000) deny('chunk');
  const bytes = Buffer.from(chunk.data, 'base64');
  if (bytes.toString('base64') !== chunk.data || createHash('sha256').update(bytes).digest('hex') !== chunk.digest ||
      chunk._id !== key('invoice-artifact-chunk/v1', chunk.digest)) deny('chunk');
}
async function stateFor(root) {
  const get = async ns => {
    const row = await wixData.get(COLLECTION, key(ns, root._id), READ);
    if (row === null) return null;
    if (!row) deny('unavailable');
    return application(row);
  };
  const artifact = await get('invoice-artifact/v1');
  const encoded = artifact ? await artifactBytes(root, artifact) : '';
  const artifactDigest = artifact ? hash(canonical(artifact)) : '';
  const start = await get('invoice-send-start/v1');
  const ack = await get('invoice-send-ack/v1');
  if (start) {
    text(start.workerBootId); text(start.invocationNonce);
    if (!artifact) deny('integrity');
    exactStored(start, {_id: key('invoice-send-start/v1', root._id), kind: 'START', issuanceId: root._id,
      documentDigest: root.documentDigest, artifactDigest, workerBootId: start.workerBootId, invocationNonce: start.invocationNonce});
  }
  if (ack) {
    if (!start || typeof ack.providerMessageId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(ack.providerMessageId)) deny('ack');
    exactStored(ack, {_id: key('invoice-send-ack/v1', root._id), kind: 'ACK', issuanceId: root._id,
      documentDigest: root.documentDigest, artifactDigest, invocationNonce: start.invocationNonce,
      to: root.to, cc: root.cc, from: root.from, providerMessageId: ack.providerMessageId, status: 'provider_accepted'});
  }
  return {root, artifact, encoded, artifactDigest, start, ack};
}
export async function invoiceJournalOperation(input) {
  shape(input, ['operation', 'issuanceId', 'payload']);
  if (!['readIssuance', 'putChunk', 'commitArtifact', 'tryStart', 'recordAck'].includes(input.operation)) deny('operation');
  const root = await rootFor(input.issuanceId);
  const p = input.payload;
  if (input.operation === 'readIssuance') { shape(p, []); return stateFor(root); }
  if (input.operation === 'putChunk') {
    validateChunk(p);
    await appendExact(p);
    return {stored: p._id};
  }
  if (input.operation === 'commitArtifact') {
    await artifactBytes(root, p);
    // First complete manifest wins; a loser must load that winner's MIME.
    try { await wixData.insert(COLLECTION, p, WRITE); } catch (_) { /* no send grant */ }
    return stateFor(root);
  }
  const state = await stateFor(root);
  if (input.operation === 'tryStart') {
    shape(p, ['artifactDigest', 'workerBootId', 'invocationNonce']);
    text(p.workerBootId); text(p.invocationNonce);
    if (!state.artifact || p.artifactDigest !== state.artifactDigest) deny('artifact');
    const record = {_id: key('invoice-send-start/v1', root._id), kind: 'START', issuanceId: root._id,
      documentDigest: root.documentDigest, artifactDigest: p.artifactDigest, workerBootId: p.workerBootId, invocationNonce: p.invocationNonce};
    // Never reconcile a duplicate or lost insert ACK into a send grant.
    try { await wixData.insert(COLLECTION, record, WRITE); }
    catch (_) { return {won: false}; }
    try { exactStored(await wixData.get(COLLECTION, record._id, READ), record); }
    catch (_) { return {won: false}; }
    return {won: true, invocationNonce: p.invocationNonce, artifactDigest: p.artifactDigest};
  }
  shape(p, ['artifactDigest', 'invocationNonce', 'providerMessageId']);
  if (!state.start || p.artifactDigest !== state.artifactDigest || p.invocationNonce !== state.start.invocationNonce ||
      typeof p.providerMessageId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(p.providerMessageId)) deny('ack');
  const ack = {_id: key('invoice-send-ack/v1', root._id), kind: 'ACK', issuanceId: root._id,
    documentDigest: root.documentDigest, artifactDigest: p.artifactDigest, invocationNonce: p.invocationNonce,
    to: root.to, cc: root.cc, from: root.from, providerMessageId: p.providerMessageId, status: 'provider_accepted'};
  await appendExact(ack);
  return stateFor(root);
}
