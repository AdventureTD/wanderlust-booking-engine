'use strict';
// M0 r4 MODEL STORE (r3 store plus a DURING-readback phase for get/listPage). It implements, as explicit UNPROVEN adapter capabilities:
//   A1  insertUnique is atomic (exactly one concurrent insert of a key wins).
//   A2  casUpdate is an atomic compare-and-set on an integer version.
//   A3  get is linearizable / read-your-writes.
//   A4  any operation may fail before applying, or apply and lose its ACK; a readback may fail.
//   A8  store-evaluated time condition: a write carrying {notAfter} applies only if
//       storeNow < notAfter AT APPLY; otherwise it returns 'late' (definitely not applied).
//   A9  conditional insert: {guard:{ns,key,pred}} applies only if pred(guardRecord.value) holds
//       AT APPLY. The predicate check and the insert are one atomic step, serialized against
//       every CAS. Otherwise it returns 'fenced' (definitely not applied).
//   A11 the store clock and the contract clock are one monotonic clock (the injected clock).
//   A12 complete enumeration: listPage() pages come from ONE snapshot identified by asOf (a
//       global commit sequence). Records carry the seq of their last write. A complete
//       enumeration whose asOf >= S contains every record whose write committed at seq <= S.
// Wix is NOT assumed to provide A8, A9 or A12. This store is a model, not evidence.
// Test controls (rules, gates, stale pages, outage) are separate from the adapter contract.

class StoreFault extends Error {
  constructor(kind, op) { super('STORE_FAULT ' + kind + ' ' + op); this.kind = kind; this.op = op; }
}

function createStoreR3({ clock, pageSize = 2 } = {}) {
  if (!clock || typeof clock.now !== 'function') throw new Error('store clock required');
  const data = new Map();               // `${ns}\u0000${key}` -> { version, seq, value }
  const applied = [];                   // committed writes {op, ns, key, seq, time, value}
  const opLog = [];                     // every invocation {n, op, ns, key, phase}
  const rules = [];                     // test interference rules
  const snapshots = new Map();
  let seq = 0, opCount = 0;
  const K = (ns, key) => ns + '\u0000' + key;
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  // A rule is { phase:'before'|'after', op, ns, match(info), action, once }.
  // action: 'fail' | 'ackLost' | 'stale' | async (info) => any (interference / pause)
  async function intercept(phase, info) {
    let fault = null;
    for (const r of rules.slice()) {
      if (r.phase !== phase || (r.op && r.op !== info.op) || (r.ns && r.ns !== info.ns) || !r.match(info)) continue;
      if (r.once !== false) rules.splice(rules.indexOf(r), 1);
      if (typeof r.action === 'function') { const v = await r.action(info); if (typeof v === 'string') fault = fault || v; }
      else fault = fault || r.action;
    }
    return fault;
  }
  function commit(op, ns, key, rec, value) {
    applied.push({ op, ns, key, seq: rec.seq, time: clock.now(), version: rec.version, value: clone(value) });
  }

  const store = {
    async insertUnique(ns, key, value, cond = {}) {
      const info = { n: ++opCount, op: 'insert', ns, key, value: clone(value), cond };
      opLog.push(info);
      const f = await intercept('before', info);
      if (f === 'fail') throw new StoreFault('before', 'insert');
      // ---- atomic apply step (no await between checks and write) ----
      let result;
      const id = K(ns, key);
      if (cond.notAfter !== undefined && !(clock.now() < cond.notAfter)) result = 'late';
      else if (cond.guard && !(() => { const g = data.get(K(cond.guard.ns, cond.guard.key)); return !!g && cond.guard.pred(clone(g.value)); })()) result = 'fenced';
      else if (data.has(id)) result = 'duplicate';
      else { const rec = { version: 1, seq: ++seq, value: clone(value) }; data.set(id, rec); commit('insert', ns, key, rec, value); result = 'inserted'; }
      info.result = result;
      const g = await intercept('after', info);
      if (g === 'ackLost' || f === 'ackLost') throw new StoreFault('ackLost', 'insert');
      return result;
    },
    async casUpdate(ns, key, expectedVersion, value, cond = {}) {
      const info = { n: ++opCount, op: 'cas', ns, key, value: clone(value), expectedVersion, cond };
      opLog.push(info);
      const f = await intercept('before', info);
      if (f === 'fail') throw new StoreFault('before', 'cas');
      let result;
      const id = K(ns, key), cur = data.get(id);
      if (cond.notAfter !== undefined && !(clock.now() < cond.notAfter)) result = 'late';
      else if (!cur || cur.version !== expectedVersion) result = 'conflict';
      else { const rec = { version: cur.version + 1, seq: ++seq, value: clone(value) }; data.set(id, rec); commit('cas', ns, key, rec, value); result = 'ok'; }
      info.result = result;
      const g = await intercept('after', info);
      if (g === 'ackLost' || f === 'ackLost') throw new StoreFault('ackLost', 'cas');
      return result;
    },
    async get(ns, key) {
      const info = { n: ++opCount, op: 'get', ns, key };
      opLog.push(info);
      const f = await intercept('before', info);
      if (f) throw new StoreFault('read', 'get');
      const cur = data.get(K(ns, key));
      const out = cur ? { version: cur.version, seq: cur.seq, value: clone(cur.value) } : null;   // read linearizes here
      info.result = out;
      const g = await intercept('after', info);          // DURING readback: result captured, not yet delivered
      if (g === 'fail') throw new StoreFault('read', 'get');
      return out;
    },
    // A12: paginated enumeration from one snapshot.
    async listPage(ns, cursor = null) {
      const info = { n: ++opCount, op: 'list', ns, key: cursor ? cursor.snap + ':' + cursor.offset : 'start' };
      opLog.push(info);
      const f = await intercept('before', info);
      if (f === 'fail') throw new StoreFault('read', 'list');
      let snap;
      if (!cursor) {
        let asOf = seq, rows = [...data.entries()].filter(([id]) => id.startsWith(ns + '\u0000'));
        if (f === 'stale') { asOf = Math.max(0, seq - 1); rows = rows.filter(([, r]) => r.seq <= asOf); } // stale snapshot (test control)
        snap = { id: 's' + (snapshots.size + 1), asOf, items: rows.sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, r]) => ({ key: id.slice(ns.length + 1), version: r.version, seq: r.seq, value: clone(r.value) })) };
        snapshots.set(snap.id, snap);
      } else {
        snap = snapshots.get(cursor.snap);
        if (!snap) throw new StoreFault('read', 'list');
      }
      const offset = cursor ? cursor.offset : 0;
      const items = snap.items.slice(offset, offset + pageSize);
      const next = offset + pageSize < snap.items.length ? { snap: snap.id, offset: offset + pageSize } : null;
      const out = { items: clone(items), next, asOf: snap.asOf };
      info.result = 'page';
      const g = await intercept('after', info);          // DURING readback of a page
      if (g === 'fail') throw new StoreFault('read', 'list');
      return out;
    },
    // ---- test controls (NOT part of the adapter contract) ----
    rule(r) { rules.push({ once: true, match: () => true, ...r }); return r; },
    clearRules() { rules.length = 0; },
    gate(phase, op, ns, match = () => true) {
      let release, reachedR; const reached = new Promise(r => { reachedR = r; }); const p = new Promise(r => { release = r; });
      rules.push({ phase, op, ns, match, once: true, action: async () => { reachedR(); await p; } });
      return { reached, open: () => release() };
    },
    forceSet(ns, key, value) { const rec = { version: 1, seq: ++seq, value: clone(value) }; data.set(K(ns, key), rec); commit('force', ns, key, rec, value); },
    peek(ns, key) { const v = data.get(K(ns, key)); return v ? clone(v.value) : undefined; },
    peekRec(ns, key) { const v = data.get(K(ns, key)); return v ? clone(v) : undefined; },
    keys(ns) { return [...data.keys()].filter(id => id.startsWith(ns + '\u0000')).map(id => id.slice(ns.length + 1)).sort(); },
    values(ns) { return [...data.entries()].filter(([id]) => id.startsWith(ns + '\u0000')).map(([, r]) => clone(r.value)); },
    get seq() { return seq; },
    applied, opLog
  };
  return store;
}
module.exports = { createStoreR3, StoreFault };
