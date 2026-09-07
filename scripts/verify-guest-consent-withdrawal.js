/* Local actual-module verification; inert Wix SDK, real Node crypto. Not live Wix. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
if (!vm.SourceTextModule) {
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', __filename, ...process.argv.slice(2)], { encoding: 'utf8' });
  process.stdout.write(run.stdout || ''); process.stderr.write(run.stderr || ''); process.exit(run.status ?? 1);
}
const root = path.resolve(__dirname, '..');
const contextPath = path.join(root, 'velo/backend/guestConsentContext.js');
const storePath = path.join(root, 'velo/backend/guestConsentWithdrawalStore.js');
assert.ok(fs.existsSync(contextPath) && fs.existsSync(storePath), 'N01 MISSING-FEATURE RED: private context and withdrawal modules not implemented (not behavioral RED)');
const contexts = 'GuestConsentBrowserContexts', negatives = 'GuestConsentWithdrawals';
function sdk(history = []) {
  const rows = new Map(history.map(([k, v]) => [k, { ...v, ...(v._createdDate ? { _createdDate: new Date(v._createdDate) } : {}) }]));
  const trace = [];
  const state = { rows, trace, hook: null };
  state.api = {
    query(collection) {
      assert.ok([contexts, negatives].includes(collection));
      let id;
      return { eq(field, value) { assert.equal(field, '_id'); id = value; return this; },
        limit(n) { assert.equal(n, 2); return this; },
        async find(options) {
          assert.deepEqual(JSON.parse(JSON.stringify(options)), { suppressAuth: true, suppressHooks: true, consistentRead: true });
          trace.push(['read', collection, id]);
          if (state.hook) { const result = await state.hook('read', collection, id); if (result !== undefined) return result; }
          const row = rows.get(collection + ':' + id);
          return { items: row ? [{ ...row }] : [], hasNext() { return false; } };
        } };
    },
    async insert(collection, row, options) {
      assert.ok([contexts, negatives].includes(collection));
      assert.deepEqual(JSON.parse(JSON.stringify(options)), { suppressAuth: true, suppressHooks: true });
      trace.push(['insert', collection, row._id]);
      if (state.hook) { const result = await state.hook('insert', collection, row); if (result !== undefined) return result; }
      const key = collection + ':' + row._id;
      if (rows.has(key)) throw new Error('conflict');
      rows.set(key, { ...row, _createdDate: new Date(1700000000000), _owner: 'sdk' });
      return rows.get(key);
    }
  };
  return state;
}
async function load(db, mutations = {}, clock = Date) {
  const realm = vm.createContext({ Buffer, Date: clock, setTimeout, clearTimeout });
  const sources = { context: fs.readFileSync(contextPath, 'utf8'), store: fs.readFileSync(storePath, 'utf8') };
  for (const [name, transform] of Object.entries(mutations)) sources[name] = transform(sources[name]);
  const mods = {};
  function synthetic(name, value) {
    return new vm.SyntheticModule(['default', ...Object.keys(value)], function () {
      this.setExport('default', value); for (const k of Object.keys(value)) this.setExport(k, value[k]);
    }, { context: realm, identifier: name });
  }
  mods.crypto = synthetic('crypto', crypto); mods.buffer = synthetic('buffer', { Buffer }); mods['wix-data'] = synthetic('wix-data', db.api);
  mods.store = new vm.SourceTextModule(sources.store, { context: realm, identifier: storePath });
  mods.context = new vm.SourceTextModule(sources.context, { context: realm, identifier: contextPath });
  await mods.context.link((specifier) => {
    if (specifier === 'backend/guestConsentWithdrawalStore') return mods.store;
    assert.ok(['crypto', 'buffer', 'wix-data'].includes(specifier), 'unexpected production import'); return mods[specifier];
  });
  await mods.context.evaluate();
  return { api: mods.context.namespace, store: mods.store.namespace, sources };
}
async function issued(db, mutations, clock) {
  const loaded = await load(db, mutations, clock);
  const result = await loaded.api.createGuestConsentBrowserContext();
  assert.equal(result.status, 'CREATED', 'N01 exact issuer readback');
  assert.match(result.token, /^wcn1\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
  return { ...loaded, token: result.token };
}
function memoryOnly(source) {
  const anchor = "result.status === 'FOUND' ? 'WITHDRAWN'";
  assert.equal(source.split(anchor).length, 2);
  return 'const memoryOnlyContexts = new Set();\n' + source
    .replace("if (before.status === 'FOUND') return { status: 'RECORDED' };", "if (before.status === 'FOUND') { memoryOnlyContexts.add(contextId); return { status: 'RECORDED' }; }")
    .replace("const after = await read('GuestConsentWithdrawals', row._id, row, deadline);", "memoryOnlyContexts.add(contextId); const after = await read('GuestConsentWithdrawals', row._id, row, deadline);")
    .replace(anchor, "memoryOnlyContexts.has(contextId) && result.status === 'FOUND' ? 'WITHDRAWN'");
}
async function main() {
  if (['--restart', '--restart-memory'].includes(process.argv[2])) {
    const data = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const db = sdk(data.history); const { api } = await load(db, process.argv[2] === '--restart-memory' ? { store: memoryOnly } : {});
    assert.equal((await api.readGuestConsentBrowserNegative(data.token)).status, 'WITHDRAWN', 'N03 fresh-process durable negative');
    assert.equal(db.trace.filter(x => x[0] === 'insert').length, 0);
    console.log('N03 fresh-process PASS'); return;
  }
  const db = sdk(); const { api, token } = await issued(db);
  assert.equal((await api.withdrawGuestConsentBrowser(token)).status, 'RECORDED', 'N01 persisted withdrawal readback');
  assert.equal((await api.readGuestConsentBrowserNegative(token)).status, 'WITHDRAWN');
  assert.equal(db.rows.size, 2);
  console.log('N01 actual crypto/context/authenticated withdrawal/readback PASS');
  const h = (domain, values) => crypto.createHash('sha256').update(domain + '\0' + JSON.stringify(values)).digest('hex');
  const [, id, secret] = token.split('.');
  const audience = 'wanderlust-consent-negative-v1';
  const stored = db.rows.get(contexts + ':' + id);
  assert.equal(stored.capabilityDigest, h('wbe.consent.capability.v1', [1, audience, id, secret]));
  assert.ok(!JSON.stringify([...db.rows]).includes(secret));
  const negativeId = h('wbe.consent.withdrawal-id.v1', [1, audience, id, 'OPTIONAL_ADVERTISING_ALL']);
  assert.equal(db.rows.get(negatives + ':' + negativeId).recordDigest,
    h('wbe.consent.withdrawal-record.v1', [1, negativeId, audience, id, 'OPTIONAL_ADVERTISING_ALL', 'EXPLICIT_BROWSER_WITHDRAWAL']));
  const bad = [undefined, null, {}, { token }, new String(token), '', token + ' ', token + '\n', token + '\r\n', token.toUpperCase(), token + '.x',
    'wgb1.' + id + '.' + secret, `wcn1.${'0'.repeat(64)}.${secret}`, `wcn1.${id}.${secret === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64)}`,
    `wcn1.${id}.${stored.capabilityDigest}`];
  for (const value of bad) {
    db.trace.length = 0;
    assert.equal((await api.withdrawGuestConsentBrowser(value)).status, 'DENIED');
    assert.equal((await api.readGuestConsentBrowserNegative(value)).status, 'DENIED');
    assert.equal(db.trace.filter(x => x[0] === 'insert').length, 0, 'N02 invalid credential must never write');
  }
  db.trace.length = 0;
  assert.equal((await api.withdrawGuestConsentBrowser(token, {})).status, 'DENIED');
  assert.equal((await api.readGuestConsentBrowserNegative(token, {})).status, 'DENIED');
  assert.equal((await api.createGuestConsentBrowserContext({})).status, 'UNKNOWN');
  assert.equal(db.trace.length, 0);
  console.log('N02 grammar/authentication/extra arguments/digest-not-bearer PASS');

  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'wbe-consent-t1-'));
  const historyPath = path.join(evidence, 'writer-history.json');
  fs.writeFileSync(historyPath, JSON.stringify({ token, history: [...db.rows] }));
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', __filename, '--restart', historyPath], { encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /N03 fresh-process PASS/);
  console.log('N03 actual fresh Node process PASS; writer-produced synthetic history:', historyPath);

  db.trace.length = 0;
  assert.equal((await api.withdrawGuestConsentBrowser(token)).status, 'RECORDED');
  assert.deepEqual(db.trace.map(x => x[0]), ['read', 'read'], 'N04 duplicate zero mutation IO');
  for (const mode of ['lost-ack', 'before-commit', 'read-error', 'malformed', 'conflicting']) {
    const d = sdk(); const x = await issued(d); let inserted = false;
    d.hook = async (op, collection, value) => {
      if (collection !== negatives) return;
      if (op === 'insert') {
        inserted = true;
        if (mode === 'lost-ack') d.rows.set(collection + ':' + value._id, { ...value, _updatedDate: new Date() });
        if (mode === 'malformed') d.rows.set(collection + ':' + value._id, { ...value, extra: true });
        if (mode === 'conflicting') d.rows.set(collection + ':' + value._id, { ...value, contextId: '0'.repeat(64) });
        throw new Error('synthetic uncertain transport');
      }
      if (inserted && mode === 'read-error') throw new Error('read failed');
    };
    assert.equal((await x.api.withdrawGuestConsentBrowser(x.token)).status,
      mode === 'lost-ack' ? 'RECORDED' : ['malformed', 'conflicting'].includes(mode) ? 'INTEGRITY' : 'UNKNOWN', 'N04 ' + mode);
    assert.equal(d.trace.filter(t => t[0] === 'insert' && t[1] === negatives).length, 1);
  }
  const raceDb = sdk(); const race = await issued(raceDb);
  const outcomes = await Promise.all([race.api.withdrawGuestConsentBrowser(race.token), race.api.withdrawGuestConsentBrowser(race.token)]);
  assert.deepEqual(outcomes.map(x => x.status), ['RECORDED', 'RECORDED']); assert.equal(raceDb.rows.size, 2);
  assert.equal(raceDb.trace.filter(t => t[0] === 'insert' && t[1] === negatives).length, 2, 'both absent pre-reads reach immutable arbitration');
  console.log('N04 duplicate/lost-ack/before-commit/read-error/conflict/concurrency PASS');

  const fresh = await api.createGuestConsentBrowserContext(); assert.equal(fresh.status, 'CREATED');
  assert.notEqual(fresh.token.split('.')[1], id); assert.notEqual(fresh.token.split('.')[2], secret);
  assert.equal((await api.readGuestConsentBrowserNegative(fresh.token)).status, 'UNRESOLVED');
  const loaded = await load(db); db.rows.delete(contexts + ':' + id);
  assert.equal((await loaded.store.readConsentBrowserWithdrawal(id, Date.now() + 10000)).status, 'WITHDRAWN');
  assert.equal((await api.readGuestConsentBrowserNegative(token)).status, 'DENIED');
  for (const mode of ['incomplete', 'error', 'empty', 'wrong-id', 'duplicate', 'bad-date', 'accessor']) {
    const d = sdk(); const x = await issued(d);
    let ownNegative;
    if (!['incomplete', 'error', 'empty'].includes(mode)) {
      assert.equal((await x.api.withdrawGuestConsentBrowser(x.token)).status, 'RECORDED');
      ownNegative = [...d.rows.values()].find(v => v.contextId);
      d.trace.length = 0;
    }
    d.hook = async (op, collection) => {
      if (op !== 'read' || collection !== negatives) return;
      if (mode === 'error') throw new Error('unavailable');
      if (mode === 'empty') return { items: [], hasNext() { return false; } };
      if (mode === 'incomplete') return { items: [], hasNext() { return true; } };
      const row = { ...ownNegative };
      if (mode === 'wrong-id') row._id = '0'.repeat(64);
      if (mode === 'bad-date') row._createdDate = 'not SDK Date';
      if (mode === 'accessor') Object.defineProperty(row, 'recordDigest', { get() { throw new Error('must not read accessor'); }, enumerable: true });
      return { items: mode === 'duplicate' ? [row, row] : [row], hasNext() { return false; } };
    };
    assert.equal((await x.api.readGuestConsentBrowserNegative(x.token)).status,
      ['incomplete', 'error', 'empty'].includes(mode) ? 'UNRESOLVED' : 'INTEGRITY', 'N05 ' + mode);
    assert.equal((await x.api.withdrawGuestConsentBrowser(x.token)).status,
      ['incomplete', 'error', 'empty'].includes(mode) ? 'UNKNOWN' : 'INTEGRITY');
    assert.equal(d.trace.filter(t => t[0] === 'insert' && t[1] === negatives).length, mode === 'empty' ? 1 : 0);
  }
  console.log('N05 unresolved observations/new custody/retained negative PASS');

  // Exact source boundary pins, including incoming production edges.
  const { sources, store } = await load(sdk());
  assert.deepEqual(Object.keys(api).sort(), ['createGuestConsentBrowserContext', 'readGuestConsentBrowserNegative', 'withdrawGuestConsentBrowser'].sort());
  assert.deepEqual(Object.keys(store).sort(), ['insertConsentBrowserContext', 'readConsentBrowserContext', 'recordConsentBrowserWithdrawal', 'readConsentBrowserWithdrawal'].sort());
  const imports = source => [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]).sort();
  assert.deepEqual(imports(sources.context), ['backend/guestConsentWithdrawalStore', 'buffer', 'crypto']);
  assert.deepEqual(imports(sources.store), ['buffer', 'crypto', 'wix-data']);
  for (const source of Object.values(sources)) assert.doesNotMatch(source, /webMethod|Permissions|console\.|fetch\s*\(|wixData\s*(?:\[|\.\s*(?:update|remove|save|bulk))|import\s*\(|require\s*\(/);
  const oldHashes = new Map();
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else {
        if (file === contextPath || file === storePath) continue;
        const bytes = fs.readFileSync(file); oldHashes.set(file, crypto.createHash('sha256').update(bytes).digest('hex'));
        if (/\.(?:js|jsw|html)$/.test(file)) assert.doesNotMatch(bytes.toString(), /guestConsentContext|guestConsentWithdrawalStore/, 'unexpected incoming production consumer: ' + file);
      }
    }
  }
  scan(path.join(root, 'velo'));
  // Inert, parser-valid public wrappers: never linked, evaluated or written to velo.
  function assertJswScreen(scanSource) {
    for (const forbidden of [false, true]) {
      const dependency = forbidden ? 'backend/guestConsentContext' : 'backend/benignFixture';
      const body = `export { withdrawGuestConsentBrowser } from '${dependency}';`;
      const parsed = new vm.SourceTextModule(body);
      assert.deepEqual(parsed.dependencySpecifiers, [dependency]);
      assert.equal(parsed.status, 'unlinked');
      const file = path.join(root, 'velo/public/inert-consent-fixture.jsw');
      const fixtureHashes = new Map();
      const fakeFS = {
        readdirSync: () => [{ name: path.basename(file), isDirectory: () => false }],
        readFileSync: () => Buffer.from(body)
      };
      const realm = vm.createContext({ fs: fakeFS, path, crypto, assert, contextPath, storePath,
        oldHashes: fixtureHashes, dir: path.dirname(file) });
      let denied = false;
      try { vm.runInContext(`(${scanSource})(dir)`, realm); }
      catch (error) {
        assert.equal(error.code, 'ERR_ASSERTION');
        assert.equal(error.message, 'unexpected incoming production consumer: ' + file);
        denied = true;
      }
      assert.equal(fixtureHashes.get(file), crypto.createHash('sha256').update(body).digest('hex'));
      assert.equal(denied, forbidden, forbidden ? 'N06 forbidden public .jsw reexport must be denied' : 'N06 benign public .jsw reexport must be admitted');
    }
  }
  assertJswScreen(scan.toString());
  const currentScreen = '/\\.(?:js|jsw|html)$/';
  assert.equal(scan.toString().split(currentScreen).length, 2, 'unique N06 suffix-screen reversal anchor');
  const oldScreen = scan.toString().replace(currentScreen, '/\\.(?:js|html)$/');
  assert.throws(() => assertJswScreen(oldScreen), error => error.code === 'ERR_ASSERTION' &&
    error.message.startsWith('N06 forbidden public .jsw reexport must be denied'), 'N06 old screen must fail the intended denial assertion');
  console.log('N06 paired parser-valid .jsw fixtures PASS; old-screen reversal rejected by intended denial assertion; mutant-sha256=' + crypto.createHash('sha256').update(oldScreen).digest('hex'));
  const boundary = sdk(); const b = await issued(boundary); boundary.trace.length = 0;
  for (const name of Object.keys(b.store)) {
    await b.store[name]({}, {}, {}); await b.store[name](id, Date.now() + 10001, 'extra');
  }
  assert.equal(boundary.trace.length, 0);

  // Shared controlled clock: started insert settles after deadline; no readback.
  let now = 1700000000000;
  class Clock extends Date { static now() { return now; } }
  const lateDb = sdk(); const late = await issued(lateDb, {}, Clock); lateDb.trace.length = 0;
  lateDb.hook = async (op, collection, row) => {
    if (op === 'insert' && collection === negatives) { lateDb.rows.set(collection + ':' + row._id, { ...row }); now += 10001; throw new Error('late ack'); }
  };
  assert.equal((await late.api.withdrawGuestConsentBrowser(late.token)).status, 'UNKNOWN');
  assert.deepEqual(lateDb.trace.map(x => x[0]), ['read', 'read', 'insert']);
  lateDb.hook = null; lateDb.trace.length = 0;
  assert.equal((await late.api.withdrawGuestConsentBrowser(late.token)).status, 'RECORDED');
  assert.deepEqual(lateDb.trace.map(x => x[0]), ['read', 'read']);

  // Real timer timeout (10s), pending write commits and rejects after return.
  const timedDb = sdk(); const timed = await issued(timedDb); let rejectLate, pendingRow;
  let startedResolve; const started = new Promise(resolve => { startedResolve = resolve; });
  timedDb.hook = (op, collection, row) => {
    if (op === 'insert' && collection === negatives) { pendingRow = row; startedResolve(); return new Promise((_, reject) => { rejectLate = reject; }); }
  };
  const lateErrors = []; const listener = error => lateErrors.push(error); process.on('unhandledRejection', listener);
  const watchdog = setTimeout(() => { throw new Error('N06 watchdog'); }, 15000);
  try {
    timedDb.trace.length = 0; const pending = timed.api.withdrawGuestConsentBrowser(timed.token); await started;
    assert.equal((await pending).status, 'UNKNOWN');
    const traceAtReturn = JSON.stringify(timedDb.trace);
    timedDb.rows.set(negatives + ':' + pendingRow._id, { ...pendingRow }); rejectLate(new Error('late rejected acknowledgement'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(JSON.stringify(timedDb.trace), traceAtReturn, 'N06 no post-timeout IO'); assert.equal(lateErrors.length, 0);
    timedDb.hook = null; timedDb.trace.length = 0;
    assert.equal((await timed.api.withdrawGuestConsentBrowser(timed.token)).status, 'RECORDED');
    assert.deepEqual(timedDb.trace.map(x => x[0]), ['read', 'read']);
  } finally { clearTimeout(watchdog); process.removeListener('unhandledRejection', listener); }

  function replaceOnce(source, old, replacement) {
    assert.equal(source.split(old).length, 2, 'unique causal mutation anchor'); return source.replace(old, replacement);
  }
  const nonpersist = sdk(); const np = await issued(nonpersist); nonpersist.hook = async (op, collection) => op === 'insert' && collection === negatives ? {} : undefined;
  await assert.rejects(async () => assert.equal((await np.api.withdrawGuestConsentBrowser(np.token)).status, 'RECORDED', 'N01 nonpersisting writer reversal'), /N01 nonpersisting writer reversal/);
  const bypassDb = sdk(); const bypass = await issued(bypassDb, { context: s => replaceOnce(s, 'if (!crypto.timingSafeEqual(actual, expected))', 'if (false)') });
  bypassDb.trace.length = 0;
  await bypass.api.withdrawGuestConsentBrowser(`wcn1.${bypass.token.split('.')[1]}.${'0'.repeat(64)}`);
  assert.throws(() => assert.equal(bypassDb.trace.filter(t => t[0] === 'insert').length, 0, 'N02 auth bypass forbidden write'), /N02 auth bypass forbidden write/);
  const memoryDb = sdk();
  const memory = await issued(memoryDb, { store: memoryOnly });
  assert.equal((await memory.api.withdrawGuestConsentBrowser(memory.token)).status, 'RECORDED');
  assert.equal((await memory.api.readGuestConsentBrowserNegative(memory.token)).status, 'WITHDRAWN', 'memory mutant live-process positive control');
  const memoryPath = path.join(evidence, 'memory-mutant-writer-history.json');
  fs.writeFileSync(memoryPath, JSON.stringify({ token: memory.token, history: [...memoryDb.rows] }));
  const memoryChild = spawnSync(process.execPath, ['--experimental-vm-modules', __filename, '--restart-memory', memoryPath], { encoding: 'utf8', timeout: 15000 });
  assert.equal(memoryChild.status, 1); assert.match(memoryChild.stderr, /N03 fresh-process durable negative/);
  for (const [file, hash] of oldHashes) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), hash);
  console.log('N06 exact boundary/IO/shared deadline/real timeout/late rejection/retry PASS');
  console.log('Causal witnesses: nonpersisting SDK writer, auth-bypass source reversal, memory-only source reversal rejected. N03 baseline and memory-only reversal both execute in fresh processes.');
  console.log('PASS N01-N06 local core; no live Wix/browser/booking-linkage or positive authority claims.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
