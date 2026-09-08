// Private owner-document selection, not booking completion or guest authority.
import wixData from 'wix-data';
import { createHash } from 'crypto';
import { readOwnerInvoiceDocumentLineage } from 'backend/invoiceEmailJournal';
import { createBookingCurrentRevision } from './bookingCurrentRevision.js';
import { createBookingCurrentRevisionStore } from './bookingCurrentRevisionStore.js';
import { command, detached } from './bookingCurrentRevisionRules.js';

const READ = {suppressAuth:true, suppressHooks:true, consistentRead:true};
const WRITE = {suppressAuth:true, suppressHooks:true};
const HEX = /^[a-f0-9]{64}$/;
const CONTACT = ['guestName','guestEmail','guestPhone'];
function id(value) {
  if (typeof value !== 'string' || !HEX.test(value)) throw Error('owner_invoice_id');
}
function contact(facts) {
  return {guestName:facts.guest.name,guestEmail:facts.guest.email,guestPhone:facts.guest.phone};
}
function matching(changes, facts) {
  const expected = contact(facts);
  return CONTACT.every(k => changes[k] === expected[k]);
}
function setup(rootId, actorId, checkAuthority, captured) {
  const identity = 'owner-document:' + rootId;
  const store = createBookingCurrentRevisionStore({
    get: async (collection, key) => {
      checkAuthority();
      const value = await wixData.get(collection,key,READ);
      checkAuthority();
      if (value === undefined) throw Error('owner_invoice_unavailable');
      return value;
    },
    insert: async (collection, row) => {
      checkAuthority();
      const value = await wixData.insert(collection,row,WRITE);
      checkAuthority(); return value;
    }
  });
  const read = selected => readOwnerInvoiceDocumentLineage(rootId,selected,checkAuthority);
  const service = createBookingCurrentRevision({store,
    resolveBase: async requested => {
      if (requested !== identity) throw Error('owner_invoice_identity');
      const {root} = await read(rootId);
      // Fixed insertion order is part of the base digest contract.
      const original = {document:root.record.document,...contact(root.facts)};
      return {bookingIdentity:identity,original,baseDigest:createHash('sha256').update(JSON.stringify(original),'utf8').digest('hex')};
    },
    authorizeCommand: async (base, candidate) => {
      checkAuthority();
      return !!captured && candidate.actorId === actorId && candidate.bookingIdentity === identity &&
        candidate.baseDigest === base.baseDigest && JSON.stringify(candidate) === JSON.stringify(captured);
    },
    authorizeDocument: async (_base, selected, actor) => {
      checkAuthority();
      if (!captured || actor !== actorId || selected !== captured.invoiceRevisionId) return false;
      const {selected:document} = await read(selected);
      return matching(captured.changes,document.facts);
    }
  });
  async function current() {
    const result = await service.readCurrent(identity);
    if (result.status !== 'CURRENT') return {status:'UNRESOLVED'};
    // readCurrent does not invoke authorizeDocument: explicitly authenticate the
    // retained effective selection and contacts, including original-root default.
    const selectedId = result.invoiceRevisionId === null ? rootId : result.invoiceRevisionId;
    id(selectedId);
    const {selected} = await read(selectedId);
    if (!matching(result.changes,selected.facts)) return {status:'UNRESOLVED'};
    checkAuthority();
    return result;
  }
  return {service,current};
}
export async function associateOwnerInvoiceRevision(input, actorId, checkAuthority) {
  checkAuthority();
  const association = detached(input);
  const fields = ['rootIssuanceId','invoiceRevisionId','commandId','baseDigest','previousRevisionId','changes'];
  if (!association || Array.isArray(association) || Object.keys(association).length !== fields.length || fields.some(k => !Object.hasOwn(association,k))) throw Error('owner_invoice_association');
  id(association.rootIssuanceId); id(association.invoiceRevisionId);
  if (association.rootIssuanceId === association.invoiceRevisionId) throw Error('owner_invoice_child_required');
  if (!association.changes || CONTACT.some(k => !Object.hasOwn(association.changes,k))) throw Error('owner_invoice_contacts');
  const captured = command({schemaVersion:1,bookingIdentity:'owner-document:'+association.rootIssuanceId,baseDigest:association.baseDigest,
    previousRevisionId:association.previousRevisionId,commandId:association.commandId,actorId,changes:association.changes,invoiceRevisionId:association.invoiceRevisionId});
  try {
    const adapter = setup(association.rootIssuanceId,actorId,checkAuthority,captured);
    const result = await adapter.service.append(captured);
    const documentCurrent = await adapter.current();
    checkAuthority();
    if (result.status === 'APPLIED' && documentCurrent.status !== 'CURRENT') return {status:'UNRESOLVED',documentCurrent};
    return {...result,documentCurrent};
  } catch (_) { checkAuthority(); return {status:'UNRESOLVED'}; }
}
export async function readOwnerInvoiceCurrentRevision(rootId, actorId, checkAuthority) {
  checkAuthority(); id(rootId);
  try {
    const result = await setup(rootId,actorId,checkAuthority,null).current();
    checkAuthority(); return result;
  } catch (_) { checkAuthority(); return {status:'UNRESOLVED'}; }
}
