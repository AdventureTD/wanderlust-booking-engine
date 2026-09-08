import { base, command, detached, revisionId } from './bookingCurrentRevisionRules.js';

const MAX_CHAIN_READS = 256;

// Private admission ports are mandatory trusted integration inputs, not DTO proofs.
// resolveBase must authenticate original provenance and its immutable identity binding.
// authorizeCommand admits the actor and exact change; authorizeDocument admits an
// existing independent document association. None of these ports is wired here.
// Historical completion and original recipient/economics remain outside this module.
export function createBookingCurrentRevision({ store, resolveBase, authorizeCommand, authorizeDocument }) {
  if (!store || typeof store.read !== 'function' || typeof store.append !== 'function' ||
      typeof resolveBase !== 'function' || typeof authorizeCommand !== 'function' || typeof authorizeDocument !== 'function') throw Error('private admission ports required');
  async function walk(b) {
    let previous = null;
    const rows = [];
    const visited = new Set();
    const changes = detached(b.changes);
    let invoiceRevisionId = null;
    // Finite supported chain; exhaustion is unknown, never current-at-truncation.
    for (let n = 0; n < MAX_CHAIN_READS; n++) {
      const id = revisionId(b.bookingIdentity, b.baseDigest, previous);
      if (visited.has(id)) return { status: 'UNRESOLVED' };
      visited.add(id);
      const found = await store.read(id);
      if (found.status === 'ABSENT') return { status: 'CURRENT', revisionId: previous, changes, invoiceRevisionId, rows };
      if (found.status !== 'FOUND') return { status: 'UNRESOLVED' };
      const row = found.row;
      if (row._id !== id || row.bookingIdentity !== b.bookingIdentity || row.baseDigest !== b.baseDigest || row.previousRevisionId !== previous || rows.some(r => r.commandId === row.commandId)) return { status: 'UNRESOLVED' };
      rows.push(row);
      Object.assign(changes, row.changes);
      if (row.invoiceRevisionId !== null) invoiceRevisionId = row.invoiceRevisionId;
      previous = id;
    }
    return { status: 'UNRESOLVED' };
  }
  async function readCurrent(identity) {
    try {
      const b = base(await resolveBase(identity), identity);
      const r = await walk(b);
      if (r.status !== 'CURRENT') return { status: 'UNRESOLVED' };
      // This projection is neither current lifecycle status nor any capability.
      return { status: 'CURRENT', revisionId: r.revisionId, changes: r.changes, invoiceRevisionId: r.invoiceRevisionId };
    } catch (_) { return { status: 'UNRESOLVED' }; }
  }
  async function append(input) {
    let c;
    try { c = command(input); } catch (_) { return { status: 'INVALID' }; }
    try {
      const b = base(await resolveBase(c.bookingIdentity), c.bookingIdentity);
      if (b.baseDigest !== c.baseDigest) return { status: 'INVALID' };
      if (await authorizeCommand(detached(b), detached(c)) !== true) return { status: 'DENIED' };
      if (c.invoiceRevisionId !== null && await authorizeDocument(detached(b), c.invoiceRevisionId, c.actorId) !== true) return { status: 'DENIED' };
      const current = await walk(b);
      if (current.status !== 'CURRENT') return { status: 'UNRESOLVED' };
      const row = { _id: revisionId(c.bookingIdentity, c.baseDigest, c.previousRevisionId), ...c };
      const existing = current.rows.find(r => r._id === row._id);
      if (existing) return { status: JSON.stringify(existing) === JSON.stringify(row) ? 'APPLIED' : 'CONFLICT', revisionId: existing._id };
      if (c.previousRevisionId !== current.revisionId || current.rows.some(r => r.commandId === c.commandId)) return { status: 'CONFLICT' };
      // Reserve the successor-absence read after the new row; replay above is read-only.
      if (current.rows.length >= MAX_CHAIN_READS - 1) return { status: 'UNRESOLVED' };
      const result = await store.append(row);
      return result.status === 'APPLIED' ? { status: 'APPLIED', revisionId: row._id } : { status: result.status };
    } catch (_) { return { status: 'UNRESOLVED' }; }
  }
  return Object.freeze({ append, readCurrent });
}
