import { createHash } from 'crypto';

// Private metadata revision protocol only. No completion/lifecycle/access authority.
const FIELDS = ['schemaVersion', 'bookingIdentity', 'baseDigest', 'previousRevisionId', 'commandId', 'actorId', 'changes', 'invoiceRevisionId'];
const CONTACT = ['guestName', 'guestEmail', 'guestPhone', 'notes'];
const HEX = /^[0-9a-f]{64}$/;
const REV = /^bcr1-[0-9a-f]{64}$/;
export function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function text(value, max = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
}
// Admit JSON data only, without calling user toJSON or getters. Limits are local.
export function detached(value, depth = 0) {
  if (depth > 20) throw Error('depth');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (!value || typeof value !== 'object') throw Error('data');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = Array.isArray(value) ? [] : Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || !descriptors[key].enumerable || !('value' in descriptors[key])) throw Error('descriptor');
    Object.defineProperty(result, key, { value: detached(descriptors[key].value, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  if (JSON.stringify(result).length > 60000) throw Error('envelope');
  return result;
}
export function revisionId(bookingIdentity, baseDigest, previousRevisionId) {
  return 'bcr1-' + digest('wbe.current-revision.v1\n' + JSON.stringify([bookingIdentity, baseDigest, previousRevisionId]));
}
export function command(value) {
  const v = detached(value);
  if (!v || Array.isArray(v) || Object.keys(v).length !== FIELDS.length || FIELDS.some(k => !Object.hasOwn(v, k))) throw Error('fields');
  if (v.schemaVersion !== 1 || !text(v.bookingIdentity) || typeof v.baseDigest !== 'string' || !HEX.test(v.baseDigest) ||
      !(v.previousRevisionId === null || typeof v.previousRevisionId === 'string' && REV.test(v.previousRevisionId)) ||
      !text(v.commandId) || !text(v.actorId) || !(v.invoiceRevisionId === null || text(v.invoiceRevisionId))) throw Error('identity');
  if (!v.changes || Array.isArray(v.changes) || typeof v.changes !== 'object') throw Error('changes');
  if (Object.keys(v.changes).some(k => !CONTACT.includes(k) || typeof v.changes[k] !== 'string' || v.changes[k].length > 10000)) throw Error('change field');
  const changes = Object.create(null);
  for (const k of CONTACT) if (Object.hasOwn(v.changes, k)) changes[k] = v.changes[k];
  return { schemaVersion: 1, bookingIdentity: v.bookingIdentity, baseDigest: v.baseDigest, previousRevisionId: v.previousRevisionId, commandId: v.commandId, actorId: v.actorId, changes, invoiceRevisionId: v.invoiceRevisionId };
}
export function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('record');
  const application = Object.create(null);
  let metadataSize = 0;
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !d || !d.enumerable || !('value' in d)) throw Error('record descriptor');
    if (key === '_createdDate' || key === '_updatedDate') {
      const time = Date.prototype.getTime.call(d.value);
      if (!Number.isFinite(time)) throw Error('metadata date');
      metadataSize += key.length + 32;
    } else application[key] = d.value;
  }
  const v = detached(application);
  if (JSON.stringify(v).length + metadataSize > 60000) throw Error('storage envelope');
  const id = v._id;
  delete v._id;
  // SDK metadata does not participate in application identity.
  if (Object.hasOwn(v, '_owner')) {
    if (!(v._owner === null || typeof v._owner === 'string' && v._owner.length <= 256)) throw Error('owner');
    delete v._owner;
  }
  const c = command(v);
  if (id !== revisionId(c.bookingIdentity, c.baseDigest, c.previousRevisionId)) throw Error('record identity');
  return { _id: id, ...c };
}
export function base(value, identity) {
  const b = detached(value);
  if (!b || b.bookingIdentity !== identity || !text(identity) || typeof b.baseDigest !== 'string' || !HEX.test(b.baseDigest) || !b.original || typeof b.original !== 'object' || Array.isArray(b.original) || digest(JSON.stringify(b.original)) !== b.baseDigest) throw Error('base provenance binding');
  const changes = Object.create(null);
  for (const k of CONTACT) if (Object.hasOwn(b.original, k)) {
    if (typeof b.original[k] !== 'string') throw Error('base contact');
    changes[k] = b.original[k];
  }
  return { bookingIdentity: identity, baseDigest: b.baseDigest, changes };
}
