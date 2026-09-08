/* Independent synthetic protocol fixtures; not actual writer/receipt authority. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const names = ['bookingCurrentRevisionRules.js', 'bookingCurrentRevisionStore.js', 'bookingCurrentRevision.js'];
async function load() {
  const context = vm.createContext({});
  const modules = new Map();
  const c = new vm.SyntheticModule(['createHash'], function () { this.setExport('createHash', crypto.createHash); }, { context });
  for (const name of names) {
    const p = path.join(root, 'velo/backend', name);
    assert.ok(fs.existsSync(p), `missing private prerequisite: ${name}`);
    const source = fs.readFileSync(p, 'utf8');
    const m = new vm.SourceTextModule(source, { context, identifier: name });
    // Inspect the complete closure before any module evaluation.
    for (const edge of m.dependencySpecifiers) assert.ok(edge === 'crypto' || names.includes(edge.replace('./', '')), `forbidden edge ${edge}`);
    modules.set(name, m);
  }
  for (const m of modules.values()) if (m.status === 'unlinked') await m.link(edge => edge === 'crypto' ? c : modules.get(edge.replace('./', '')));
  for (const m of modules.values()) if (m.status === 'linked') await m.evaluate();
  return { context, api: modules.get(names[2]).namespace, rules: modules.get(names[0]).namespace, store: modules.get(names[1]).namespace };
}
const copy = v => JSON.parse(JSON.stringify(v));
async function fixture(rows = new Map()) {
  const loaded = await load();
  const trace = [];
  let loseAck = false;
  const native = {
    async get(collection, id) { trace.push(['get', collection, id]); return rows.has(id) ? { ...copy(rows.get(id)), _owner: null, _createdDate: new Date(0), _updatedDate: new Date(0) } : null; },
    async insert(collection, row) {
      trace.push(['insert', collection, row._id]);
      if (rows.has(row._id)) throw Error('duplicate');
      rows.set(row._id, copy(row));
      if (loseAck) { loseAck = false; throw Error('lost ACK'); }
      return copy(row);
    }
  };
  const original = { guestName: 'Original', guestEmail: 'original@example.test', guestPhone: '123', notes: 'legacy', status: 'Cancelled', groups: [{ cents: 1001 }], recipient: 'original@example.test' };
  const base = { bookingIdentity: 'legacy-booking-1', baseDigest: crypto.createHash('sha256').update(JSON.stringify(original)).digest('hex'), original };
  // Trusted admission seams are synthetic; NOT authenticated owner/receipt evidence.
  const service = loaded.api.createBookingCurrentRevision({
    store: loaded.store.createBookingCurrentRevisionStore(native),
    resolveBase: async id => id === base.bookingIdentity ? copy(base) : null,
    authorizeCommand: async (b, cmd) => cmd.actorId === 'fixture-admin',
    authorizeDocument: async (b, id) => id === 'authorized-document-1'
  });
  const cmd = (changes = { notes: 'revised' }, previousRevisionId = null, commandId = 'command-1') => ({ schemaVersion: 1, bookingIdentity: base.bookingIdentity, baseDigest: base.baseDigest, previousRevisionId, commandId, actorId: 'fixture-admin', changes, invoiceRevisionId: null });
  return { ...loaded, rows, trace, original, base, service, cmd, loseAck: () => { loseAck = true; } };
}
const tests = {
  async A1() {
    const f = await fixture(); const before = JSON.stringify(f.original);
    const r = await f.service.readCurrent(f.base.bookingIdentity);
    assert.equal(r.status, 'CURRENT'); assert.equal(r.revisionId, null);
    assert.deepEqual(copy(r.changes), { guestName: 'Original', guestEmail: 'original@example.test', guestPhone: '123', notes: 'legacy' });
    assert.equal(JSON.stringify(f.original), before); assert.equal(f.trace.filter(x => x[0] === 'insert').length, 0);
  },
  async A2() {
    const f = await fixture(); const before = JSON.stringify(f.original);
    for (const changes of [{ status: 'confirmed' }, { groups: [] }, { recipient: 'other@example.test' }, { checkIn: '2026-01-01' }]) assert.equal((await f.service.append(f.cmd(changes))).status, 'INVALID');
    assert.equal((await f.service.append({ ...f.cmd(), baseDigest: '0'.repeat(64) })).status, 'INVALID');
    assert.equal(f.rows.size, 0);
    assert.equal((await f.service.append(f.cmd({ guestEmail: 'contact@example.test' }))).status, 'APPLIED');
    assert.equal(JSON.stringify(f.original), before);
    assert.equal(f.original.recipient, 'original@example.test');
  },
  async A3() {
    for (const order of [['left', 'right'], ['right', 'left']]) {
      const f = await fixture();
      const commands = order.map(x => f.cmd({ notes: x }, null, x));
      const outcomes = await Promise.all(commands.map(c => f.service.append(c)));
      assert.deepEqual(outcomes.map(x => x.status), ['APPLIED', 'CONFLICT']);
      assert.equal(f.rows.size, 1); assert.equal((await f.service.readCurrent(f.base.bookingIdentity)).changes.notes, order[0]);
      const retained = JSON.stringify([...f.rows]);
      assert.equal((await f.service.append(commands[1])).status, 'CONFLICT');
      assert.equal(JSON.stringify([...f.rows]), retained);
    }
  },
  async A4() {
    const f = await fixture(); f.loseAck(); const command = f.cmd();
    assert.equal((await f.service.append(command)).status, 'APPLIED');
    const restarted = await fixture(f.rows);
    assert.notEqual(restarted.api.createBookingCurrentRevision, f.api.createBookingCurrentRevision);
    assert.equal((await restarted.service.append(command)).status, 'APPLIED');
    assert.equal(restarted.trace.filter(x => x[0] === 'insert').length, 0);
    assert.equal(f.rows.size, 1);
  },
  async A5() {
    for (const corruption of ['incomplete', 'foreign', 'cyclic']) {
      const f = await fixture(); assert.equal((await f.service.append(f.cmd())).status, 'APPLIED');
      const [id, row] = [...f.rows][0];
      if (corruption === 'incomplete') delete row.commandId;
      if (corruption === 'foreign') row.bookingIdentity = 'foreign-booking';
      if (corruption === 'cyclic') row.previousRevisionId = id;
      f.rows.set(id, row); const n = f.trace.filter(x => x[0] === 'insert').length;
      assert.equal((await f.service.readCurrent(f.base.bookingIdentity)).status, 'UNRESOLVED');
      assert.equal((await f.service.append(f.cmd())).status, 'UNRESOLVED');
      assert.equal(f.trace.filter(x => x[0] === 'insert').length, n);
    }
    const f = await fixture();
    assert.equal((await f.service.append(f.cmd({}, 'bcr1-' + '1'.repeat(64)))).status, 'CONFLICT');
    assert.equal((await f.service.append({ ...f.cmd(), actorId: 'stranger' })).status, 'DENIED');
  },
  async A6() {
    const f = await fixture();
    assert.equal((await f.service.append({ ...f.cmd(), invoiceRevisionId: 'foreign-document' })).status, 'DENIED');
    assert.equal((await f.service.append({ ...f.cmd({ guestName: 'Current' }), invoiceRevisionId: 'authorized-document-1' })).status, 'APPLIED');
    let r = await f.service.readCurrent(f.base.bookingIdentity);
    assert.equal(r.invoiceRevisionId, 'authorized-document-1');
    const previous = r.revisionId;
    assert.equal((await f.service.append(f.cmd({ notes: 'second' }, previous, 'command-2'))).status, 'APPLIED');
    r = await f.service.readCurrent(f.base.bookingIdentity);
    assert.equal(r.changes.guestName, 'Current'); assert.equal(r.changes.notes, 'second');
    assert.equal(r.invoiceRevisionId, 'authorized-document-1');
    assert.deepEqual(Object.keys(r).sort(), ['changes', 'invoiceRevisionId', 'revisionId', 'status']);
    assert.equal(f.original.status, 'Cancelled');
    assert.ok(f.trace.every(x => x[1] === 'BookingCurrentRevisions'));
  },
  async R1() {
    // Actual service-produced history; inert SDK and synthetic admission only.
    const f = await fixture();
    const commands = [];
    let previous = null;
    const inserts = worker => worker.trace.filter(x => x[0] === 'insert').length;
    for (let n = 1; n <= 255; n++) {
      const c = f.cmd({ notes: `revision-${n}` }, previous, `command-${n}`);
      commands.push(c);
      const result = await f.service.append(c);
      assert.equal(result.status, 'APPLIED', `supported append ${n}`);
      previous = result.revisionId;
      assert.equal(f.rows.size, n); assert.equal(inserts(f), n);
      if (n >= 254) {
        const start = f.trace.length;
        const current = await f.service.readCurrent(f.base.bookingIdentity);
        assert.deepEqual(copy(current), { status: 'CURRENT', revisionId: previous,
          changes: { guestName: 'Original', guestEmail: 'original@example.test', guestPhone: '123', notes: `revision-${n}` }, invoiceRevisionId: null });
        assert.equal(f.trace.slice(start).filter(x => x[0] === 'get').length, n + 1, 'rows plus successor absence');
      }
    }
    const retained = JSON.stringify([...f.rows]);
    const current = copy(await f.service.readCurrent(f.base.bookingIdentity));
    const unsupported = f.cmd({ notes: 'revision-256' }, previous, 'command-256');
    assert.equal((await f.service.append(unsupported)).status, 'UNRESOLVED', 'unsupported new append must deny before mutation');
    assert.equal(inserts(f), 255); assert.equal(f.rows.size, 255);
    assert.equal(JSON.stringify([...f.rows]), retained);
    assert.deepEqual(copy(await f.service.readCurrent(f.base.bookingIdentity)), current);
    const restarted = await fixture(f.rows);
    assert.notEqual(restarted.context, f.context);
    for (const key of ['api', 'store', 'rules']) assert.notEqual(restarted[key], f[key]);
    for (const worker of [f, restarted]) {
      const before = inserts(worker);
      for (const c of [commands[0], commands[254]]) {
        const result = await worker.service.append(c);
        assert.deepEqual(copy(result), { status: 'APPLIED', revisionId: worker.rules.revisionId(c.bookingIdentity, c.baseDigest, c.previousRevisionId) });
      }
      assert.equal((await worker.service.append(unsupported)).status, 'UNRESOLVED', 'same denied command retry');
      assert.equal(inserts(worker), before, 'replays and denial must attempt zero inserts');
      assert.equal(worker.rows.size, 255);
      assert.equal(JSON.stringify([...worker.rows]), retained);
      assert.deepEqual(copy(await worker.service.readCurrent(f.base.bookingIdentity)), current);
    }
    assert.equal(inserts(restarted), 0);
  }
};
(async () => {
  const requested = process.argv.slice(2);
  assert.ok(requested.length === 0 || (requested.length === 1 && requested[0] === '--boundary-only'), 'unsupported test selection');
  const selected = requested.length ? [['R1', tests.R1]] : Object.entries(tests);
  let executed = 0;
  for (const [id, test] of selected) { await test(); executed++; console.log(`${id} PASS (synthetic private protocol)`); }
  assert.equal(executed, requested.length ? 1 : 7); console.log(JSON.stringify({ executed, ids: selected.map(([id]) => id) }));
})().catch(e => { console.error(e); process.exitCode = 1; });
