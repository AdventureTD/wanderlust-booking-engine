import { record } from './bookingCurrentRevisionRules.js';

// OFF-PRODUCTION adapter seam. No SDK instance, collection provisioning or consumers.
// The integration must supply native nonoverwriting custom-ID insert and exact get.
// A failed/incomplete read must reject, never return null (known absent only).
const COLLECTION = 'BookingCurrentRevisions';
export function createBookingCurrentRevisionStore(storage) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.insert !== 'function') throw Error('private storage required');
  async function read(id) {
    try {
      const raw = await storage.get(COLLECTION, id);
      if (raw === null) return { status: 'ABSENT' };
      const row = record(raw);
      if (row._id !== id) return { status: 'UNRESOLVED' };
      return { status: 'FOUND', row };
    } catch (_) { return { status: 'UNRESOLVED' }; }
  }
  async function append(value) {
    let row;
    try { row = record(value); } catch (_) { return { status: 'INVALID' }; }
    const prior = await read(row._id);
    if (prior.status === 'UNRESOLVED') return prior;
    if (prior.status === 'FOUND') return { status: JSON.stringify(prior.row) === JSON.stringify(row) ? 'APPLIED' : 'CONFLICT', row: prior.row };
    // Never trust an insert response or retry a mutation after lost ACK.
    try { await storage.insert(COLLECTION, row); } catch (_) { /* reconcile exact immutable winner */ }
    const retained = await read(row._id);
    if (retained.status !== 'FOUND') return { status: 'UNRESOLVED' };
    return { status: JSON.stringify(retained.row) === JSON.stringify(row) ? 'APPLIED' : 'CONFLICT', row: retained.row };
  }
  return Object.freeze({ read, append });
}
