// Ordinary D2-A transport only: public valid-shape records are NOT booking authority.
// Run: node --experimental-vm-modules scripts/verify-guest-booking-acquisition-control-store.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Buffer } = require('node:buffer');
const root = path.resolve(__dirname, '..');
const collection = 'GuestBookingAcquisitionControls';
const A = 'a'.repeat(64), digest = 'b'.repeat(64);
function proposal(direction, acceptance = A) {
  return { _id: 'ra2-direction-' + acceptance, acquisitionProtocolVersion: 2,
    kind: 'cart-direction', admissionId: 'ra2-cart-' + acceptance, manifestDigest: digest,
    direction, causeOperationId: direction === 'compensate' ? 'cg2_' + Buffer.alloc(32, 1).toString('base64url') + '_p' : null,
    causeIndex: direction === 'compensate' ? 0 : null,
    causeResourceClaimId: direction === 'compensate' ? 'rc1-20260908-s1-000000-a' : null };
}
function database() {
  const rows = new Map(), trace = [];
  const db = { rows, trace, beforeInsert: null, beforeApply: false, lostAck: false, unreadable: false, pageMode: null, owner: undefined };
  db.sdk = {
    async insert(c, row, options) {
      trace.push({ method: 'insert', c, id: row._id, direction: row.direction, options });
      if (db.beforeInsert) await db.beforeInsert(row);
      if (db.beforeApply) throw Error('before apply');
      const key = c + ':' + row._id;
      if (rows.has(key)) throw Error('duplicate native ID');
      rows.set(key, { ...row });
      if (db.lostAck) throw Error('applied, ACK lost');
      return { ...row };
    },
    query(c) {
      let id;
      const q = {
        eq(field, value) { assert.equal(field, '_id'); id = value; return q; },
        limit(n) { assert.equal(n, 2); return q; },
        async find(options) {
          trace.push({ method: 'find', c, id, options });
          if (db.unreadable) throw Error('read unavailable');
          const stored = rows.get(c + ':' + id);
          let items = stored ? [{ ...stored }] : [];
          if (items.length && db.owner !== undefined) items[0]._owner = db.owner;
          if (db.pageMode === 'extra-field' && items.length) items[0].unexpected = true;
          if (db.pageMode === 'two-rows') items = [...items, ...items];
          if (db.pageMode === 'wrong-id' && items.length) items[0] = proposal('commit-rows', 'c'.repeat(64));
          return { items, hasNext() { return db.pageMode === 'extra-page'; } };
        }
      };
      return q;
    },
    update() { assert.fail('forbidden update'); },
    save() { assert.fail('forbidden save'); },
    remove() { assert.fail('forbidden remove'); }
  };
  return db;
}
async function fresh(db) {
  // New actual module instances on every call; no acceptance harness or physical source.
  const rules = new vm.SourceTextModule(fs.readFileSync(path.join(root, 'velo/backend/guestBookingAcquisitionControlRules.js'), 'utf8'));
  const store = new vm.SourceTextModule(fs.readFileSync(path.join(root, 'velo/backend/guestBookingAcquisitionControlStore.js'), 'utf8'));
  const buffer = new vm.SyntheticModule(['Buffer'], function () { this.setExport('Buffer', Buffer); });
  const wix = new vm.SyntheticModule(['default'], function () { this.setExport('default', db.sdk); });
  await rules.link(specifier => { assert.equal(specifier, 'buffer'); return buffer; });
  await rules.evaluate();
  await store.link(specifier => {
    if (specifier === 'wix-data') return wix;
    assert.equal(specifier, 'backend/guestBookingAcquisitionControlRules'); return rules;
  });
  await store.evaluate();
  return { rules: rules.namespace, store: store.namespace };
}
function exact(found, wanted) {
  assert.equal(found.status, 'FOUND');
  assert.deepEqual({ ...found.record }, wanted);
}
function calls(db, methods) {
  assert.deepEqual(db.trace.map(t => t.method), methods);
  for (const t of db.trace) {
    assert.equal(t.c, collection);
    assert.deepEqual(t.options, t.method === 'insert' ? { suppressAuth: true, suppressHooks: true } :
      { suppressAuth: true, suppressHooks: true, consistentRead: true });
  }
}
const tests = {
  async A01() {
    const db = database(), { rules, store } = await fresh(db);
    for (const direction of ['commit-rows', 'compensate']) {
      const row = proposal(direction);
      assert.deepEqual({ ...rules.decodeGuestBookingAcquisitionControl(row) }, row);
      const invalid = [ { ...row, _id: 'bad' }, { ...row, admissionId: 'ra2-cart-' + 'c'.repeat(64) },
        { ...row, manifestDigest: 'bad' }, { ...row, extra: 'field' }, { ...row, direction: 'confirmed' },
        { ...row, acquisitionProtocolVersion: 1 } ];
      for (const field of ['causeOperationId', 'causeIndex', 'causeResourceClaimId']) {
        invalid.push({ ...row, [field]: direction === 'commit-rows' ? proposal('compensate')[field] : null });
      }
      for (const bad of invalid) {
        assert.throws(() => rules.decodeGuestBookingAcquisitionControl(bad));
        assert.equal((await store.reconcileGuestBookingAcquisitionControl(bad)).status, 'INTEGRITY');
      }
    }
    calls(db, []); assert.equal(db.rows.size, 0);
  },
  async A02() {
    for (const direction of ['commit-rows', 'compensate']) {
      const db = database(), { store } = await fresh(db), row = proposal(direction);
      exact(await store.reconcileGuestBookingAcquisitionControl(row), row);
      calls(db, ['insert', 'find']);
      assert.ok(db.trace.every(t => t.id === row._id));
      assert.deepEqual(db.rows.get(collection + ':' + row._id), row);
    }
  },
  async A03() {
    for (const winning of ['commit-rows', 'compensate']) {
      const db = database(), first = await fresh(db), second = await fresh(db);
      assert.notEqual(first.store.reconcileGuestBookingAcquisitionControl, second.store.reconcileGuestBookingAcquisitionControl);
      const losing = winning === 'commit-rows' ? 'compensate' : 'commit-rows';
      let release, entered;
      const paused = new Promise(resolve => { entered = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const watchdog = setTimeout(() => { console.error('A03 barrier timeout'); process.exit(1); }, 5000);
      db.beforeInsert = async row => { if (row.direction === losing) { entered(); await gate; } };
      const pending = second.store.reconcileGuestBookingAcquisitionControl(proposal(losing));
      try {
        await paused;
        const winner = await first.store.reconcileGuestBookingAcquisitionControl(proposal(winning));
        exact(winner, proposal(winning));
        release(); exact(await pending, proposal(winning));
        calls(db, ['insert', 'insert', 'find', 'find']);
        assert.deepEqual(db.trace.filter(t => t.method === 'insert').map(t => t.direction), [losing, winning]);
        assert.equal(db.rows.size, 1);
        assert.deepEqual(db.rows.get(collection + ':' + proposal(winning)._id), proposal(winning));
      } finally { release(); clearTimeout(watchdog); }
    }
  },
  async A04() {
    for (const direction of ['commit-rows', 'compensate']) {
      const db = database(), { store } = await fresh(db), row = proposal(direction);
      db.lostAck = true;
      exact(await store.reconcileGuestBookingAcquisitionControl(row), row);
      calls(db, ['insert', 'find']); assert.equal(db.rows.size, 1);
      const absent = database(); absent.beforeApply = true;
      const freshStore = (await fresh(absent)).store;
      assert.equal((await freshStore.reconcileGuestBookingAcquisitionControl(row)).status, 'ABSENT');
      calls(absent, ['insert', 'find']); assert.equal(absent.rows.size, 0);
    }
  },
  async A05() {
    for (const direction of ['commit-rows', 'compensate']) {
      const db = database(), original = await fresh(db), row = proposal(direction);
      db.unreadable = true;
      assert.equal((await original.store.reconcileGuestBookingAcquisitionControl(row)).status, 'UNRESOLVED');
      calls(db, ['insert', 'find']); assert.equal(db.rows.size, 1);
      db.unreadable = false;
      const restarted = await fresh(db);
      assert.notEqual(original.store.readGuestBookingAcquisitionControl, restarted.store.readGuestBookingAcquisitionControl);
      assert.notEqual(original.rules.decodeGuestBookingAcquisitionControl, restarted.rules.decodeGuestBookingAcquisitionControl);
      exact(await restarted.store.readGuestBookingAcquisitionControl(row._id), row);
      calls(db, ['insert', 'find', 'find']);
    }
  },
  async A06() {
    const db = database(), { store } = await fresh(db);
    const winner = { ...proposal('compensate'), manifestDigest: 'd'.repeat(64) };
    exact(await store.reconcileGuestBookingAcquisitionControl(winner), winner);
    exact(await store.reconcileGuestBookingAcquisitionControl(proposal('commit-rows')), winner);
    calls(db, ['insert', 'find', 'insert', 'find']); assert.equal(db.rows.size, 1);
    for (const mode of ['extra-field', 'two-rows', 'extra-page']) {
      db.pageMode = mode;
      assert.equal((await store.readGuestBookingAcquisitionControl(winner._id)).status, 'UNRESOLVED');
    }
    db.pageMode = 'wrong-id';
    assert.equal((await store.readGuestBookingAcquisitionControl(winner._id)).status, 'INTEGRITY');
  },
  async A08() {
    const db = database(), row = proposal('commit-rows'), other = proposal('compensate', 'c'.repeat(64));
    let worker = await fresh(db);
    exact(await worker.store.reconcileGuestBookingAcquisitionControl(row), row);
    const old = worker.store.reconcileGuestBookingAcquisitionControl;
    worker = null;
    worker = await fresh(db); assert.notEqual(old, worker.store.reconcileGuestBookingAcquisitionControl);
    exact(await worker.store.reconcileGuestBookingAcquisitionControl(other), other);
    exact(await worker.store.reconcileGuestBookingAcquisitionControl(proposal('compensate')), row);
    exact(await worker.store.readGuestBookingAcquisitionControl(other._id), other);
    calls(db, ['insert', 'find', 'insert', 'find', 'insert', 'find', 'find']);
    assert.equal(db.rows.size, 2);
    assert.deepEqual([...db.rows.keys()].sort(), [collection + ':' + row._id, collection + ':' + other._id].sort());
    assert.ok([...db.rows.values()].every(value => !Object.hasOwn(value, 'bookingNumber')));
  },
  async A07() {
    for (const direction of ['commit-rows', 'compensate']) {
      const db = database(), { rules, store } = await fresh(db), row = proposal(direction);
      const canonical = rules.canonicalGuestBookingAcquisitionControl(row);
      for (const owner of [null, '', 'ordinary-owner', 'x'.repeat(256)]) {
        const native = { ...row, _owner: owner };
        assert.equal(rules.canonicalGuestBookingAcquisitionControl(rules.decodeGuestBookingAcquisitionControl(native, true)), canonical);
        db.owner = owner;
        exact(await store.reconcileGuestBookingAcquisitionControl(row), row);
      }
      for (const owner of [false, 0, {}, [], 'x'.repeat(257)]) {
        assert.throws(() => rules.decodeGuestBookingAcquisitionControl({ ...row, _owner: owner }, true));
        db.owner = owner;
        assert.equal((await store.readGuestBookingAcquisitionControl(row._id)).status, 'UNRESOLVED');
      }
      assert.throws(() => rules.decodeGuestBookingAcquisitionControl({ ...row, _owner: null }));
    }
  }
};
(async () => {
  const ids = Object.keys(tests).sort();
  const selected = process.argv.slice(2);
  for (const id of selected) assert.ok(ids.includes(id), 'unknown case ' + id);
  let count = 0;
  for (const id of ids) if (!selected.length || selected.includes(id)) {
    await tests[id](); count++; console.log(id + ' PASS (ordinary transport only)');
  }
  assert.equal(count, selected.length || ids.length);
  console.log(JSON.stringify({ passed: count, ids: selected.length ? selected : ids, authority: false, liveWixVerified: false }));
})().catch(error => { console.error(error); process.exitCode = 1; });
