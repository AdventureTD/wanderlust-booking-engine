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
// Exact reviewed T2 and B06 payloads; LF pins do not authorize live activation.
const consentBoundaryPins = {
  "velo/backend/guestConsent.web.js": {
    "sha256": "d08ed967b4b709a84ee65e1847b3c4782b8f977a7a4f4f066a68164fb9da0a72",
    "imports": [
      "import { webMethod, Permissions } from 'wix-web-module';",
      "import { createGuestConsentBrowserContext as issue, withdrawGuestConsentBrowser as withdraw, readGuestConsentBrowserNegative as observe } from 'backend/guestConsentContext';"
    ],
    "exports": [
      "export const createGuestConsentBrowserContext = webMethod(Permissions.Anyone, async (...args) => {",
      "export const withdrawGuestConsentBrowser = webMethod(Permissions.Anyone, async (...args) => {",
      "export const readGuestConsentBrowserNegative = webMethod(Permissions.Anyone, async (...args) => {"
    ]
  },
  "velo/masterPage.js": {
    "sha256": "ff25144a6640274b9da44fc8907c22f2c9efc14e93f0e86164946431c52d38f9",
    "imports": [
      "import { captureClickIds, initTracking, setSuspendGoogleAds } from 'public/tracking';",
      "import { getAllSettings } from 'backend/settings';",
      "import { consentPolicy, rendering } from 'wix-window-frontend';",
      "import { local } from 'wix-storage-frontend';",
      "import { createGuestConsentBrowserContext, withdrawGuestConsentBrowser, readGuestConsentBrowserNegative } from 'backend/guestConsent.web';"
    ],
    "exports": []
  },
  "velo/backend/guestConsentBookingLink.js": {
    "sha256": "2f7fbbce5fef566430349d84be0c267849873190952c1ced0222f26303029441",
    "imports": [
      "import wixData from 'wix-data';",
      "import crypto from 'crypto';",
      "import { Buffer } from 'buffer';",
      "import { resolveGuestConsentBrowserContext } from 'backend/guestConsentContext';",
      "import { readConsentBrowserWithdrawal } from 'backend/guestConsentWithdrawalStore';",
      "import { readGuestBookingCredentialAuthority, acceptanceDigest, acceptanceTime, snapshotAcceptancePage } from 'backend/guestBookingIssuerAuthority';",
      "import { readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';",
      "import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';"
    ],
    "exports": [
      "export async function linkGuestConsentBrowserToAcceptedBooking(browserToken, bookingToken, capsule) {",
      "export async function readGuestConsentBookingNegative(acceptanceId) {"
    ]
  },
  "velo/backend/guestConsentContext.js": {
    "sha256": "485790d844de14cf47cb81544c4f4aa038be51da8802ec21a56dabba88296bdd",
    "imports": [
      "import crypto from 'crypto';",
      "import { Buffer } from 'buffer';",
      "import { insertConsentBrowserContext, readConsentBrowserContext, recordConsentBrowserWithdrawal, readConsentBrowserWithdrawal } from 'backend/guestConsentWithdrawalStore';"
    ],
    "exports": [
      "export async function resolveGuestConsentBrowserContext(token, deadline) {",
      "export async function createGuestConsentBrowserContext() {",
      "export async function withdrawGuestConsentBrowser(token) {",
      "export async function readGuestConsentBrowserNegative(token) {"
    ]
  },
  "velo/backend/guestConsentWithdrawalStore.js": {
    "sha256": "7bdfd2255dba841612f0388497294e138e630c97f630278905b2e41fbf3411d6",
    "imports": [
      "import wixData from 'wix-data';",
      "import crypto from 'crypto';",
      "import { Buffer } from 'buffer';"
    ],
    "exports": [
      "export async function insertConsentBrowserContext(id, digest, deadline) {",
      "export async function readConsentBrowserContext(id, deadline) {",
      "export async function recordConsentBrowserWithdrawal(contextId, deadline) {",
      "export async function readConsentBrowserWithdrawal(contextId, deadline) {"
    ]
  }
};
function consentReferenceText(text) {
  return text.replace(/\\(?:\r\n|[\n\r\u2028\u2029])/g, '')
    .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b, c) => {
      const n = parseInt(a || b || c, 16);
      return n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd';
    }).replace(/\\([^\r\n])/g, '$1');
}
function consentBoundaryEdge(file, source) {
  let text = source.replace(/\r\n/g, '\n');
  // Only the independently reviewed Microsoft addition may reconstruct the historical master.
  // Keep its original import/body pin below: neither arbitrary observers nor new web edges qualify.
  if (file === 'velo/masterPage.js' &&
      crypto.createHash('sha256').update(text).digest('hex') === '1c9d6695a340022138697f649cef101ac770729c1f3f20227a440b6b8187c2c6') {
    text = text.replace(
      "import { captureClickIds, initTracking, setSuspendGoogleAds, observeMicrosoftPage } from 'public/tracking';",
      "import { captureClickIds, initTracking, setSuspendGoogleAds } from 'public/tracking';"
    ).replace("$w.onReady(function () {\n  // Ordinary page-ready observation, not settled rendering/title or onChange.\n  if (rendering.env === 'browser') {\n    try { observeMicrosoftPage($w); } catch (_) { /* Booking remains independent. */ }\n  }\n});\n\n", '');
  }
  const pin = Object.hasOwn(consentBoundaryPins, file) ? consentBoundaryPins[file] : null;
  if (!pin) return !/guestConsent\.web|guestConsentContext|guestConsentWithdrawalStore|guestConsentBookingLink|resolveGuestConsentBrowserContext|insertConsentBrowserContext|readConsentBrowserContext|recordConsentBrowserWithdrawal|readConsentBrowserWithdrawal|linkGuestConsentBrowserToAcceptedBooking|readGuestConsentBookingNegative/i.test(consentReferenceText(text));
  return JSON.stringify(text.match(/^import .*$/gm) || []) === JSON.stringify(pin.imports) &&
    JSON.stringify(text.match(/^export .*$/gm) || []) === JSON.stringify(pin.exports) &&
    crypto.createHash('sha256').update(text).digest('hex') === pin.sha256;
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
  for (const file of Object.keys(consentBoundaryPins)) assert.equal(consentBoundaryEdge(file, fs.readFileSync(path.join(root, file), 'utf8')), true, 'L04-R2 exact reviewed consent pin ' + file);
  const { sources, store } = await load(sdk());
  assert.deepEqual(Object.keys(api).sort(), ['createGuestConsentBrowserContext', 'readGuestConsentBrowserNegative', 'resolveGuestConsentBrowserContext', 'withdrawGuestConsentBrowser'].sort());
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
        if (/\.(?:js|jsw|html)$/.test(file)) assert.equal(consentBoundaryEdge(path.relative(root, file).split(path.sep).join('/'), bytes.toString()), true, 'unexpected incoming production consumer: ' + file);
      }
    }
  }
  // B06 fixtures exercise the actual scanner, not a parallel reference predicate.
  function assertWebScreen(edge = consentBoundaryEdge) {
    for (const [file, reexport, escaped] of [
      ['velo/pages/inert-consent-page.js', false, false],
      ['velo/public/inert-consent-reexport.js', true, false],
      ['velo/public/inert-consent-reexport.jsw', true, true],
      ['velo/pages/inert-consent-escaped.js', false, true]
    ]) for (const forbidden of [false, true]) {
      const dependency = forbidden ? 'backend/guestConsent.web' : 'backend/benignFixture';
      const literal = escaped ? dependency.replace('Consent', 'Con\\u0073ent') : dependency;
      const body = reexport ? `export { withdrawGuestConsentBrowser } from '${literal}';` :
        `import { withdrawGuestConsentBrowser } from '${literal}';`;
      const parsed = new vm.SourceTextModule(body);
      assert.deepEqual(parsed.dependencySpecifiers, [dependency]);
      assert.equal(parsed.status, 'unlinked');
      const absolute = path.join(root, file), fixtureHashes = new Map();
      const fakeFS = { readdirSync: () => [{ name: path.basename(absolute), isDirectory: () => false }],
        readFileSync: () => Buffer.from(body) };
      const realm = vm.createContext({ fs: fakeFS, path, crypto, assert, contextPath, storePath,
        oldHashes: fixtureHashes, dir: path.dirname(absolute), root, consentBoundaryEdge: edge });
      let denied = false;
      try { vm.runInContext(`(${scan.toString()})(dir)`, realm); }
      catch (error) {
        assert.equal(error.code, 'ERR_ASSERTION');
        assert.ok(error.message.startsWith('unexpected incoming production consumer: ' + absolute));
        denied = true;
      }
      assert.equal(fixtureHashes.get(absolute), crypto.createHash('sha256').update(body).digest('hex'));
      assert.equal(denied, forbidden, 'B06 web reference screening: ' + file + ' forbidden=' + forbidden);
    }
  }
  assertWebScreen();
  const webAnchor = 'guestConsent\\.web|';
  assert.equal(consentBoundaryEdge.toString().split(webAnchor).length, 2);
  const missingWebScreen = consentBoundaryEdge.toString().replace(webAnchor, '');
  const oldEdge = vm.runInNewContext('(' + missingWebScreen + ')', { consentBoundaryPins, consentReferenceText, crypto });
  assert.throws(() => assertWebScreen(oldEdge), error => error.code === 'ERR_ASSERTION' &&
    error.message.startsWith('B06 web reference screening: velo/pages/inert-consent-page.js forbidden=true'));
  for (const file of ['velo/backend/guestConsent.web.js', 'velo/masterPage.js']) {
    const actual = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(consentBoundaryEdge(file, actual), true, 'B06 exact reviewed consumer ' + file);
    assert.equal(consentBoundaryEdge('velo/pages/unapproved-copy.js', actual), false, 'B06 copied consumer path denied');
    for (const [kind, drift] of [
      ['byte', actual + '\n// inert byte drift\n'],
      ['import', actual.replace(/^import .*$/m, "import { inert } from 'backend/benignFixture';")],
      ['export', actual + '\nexport const inertFixture = 1;\n']
    ]) {
      const parsed = new vm.SourceTextModule(drift);
      assert.equal(parsed.status, 'unlinked');
      assert.equal(consentBoundaryEdge(file, drift), false, 'B06 exact pinned ' + kind + ' drift denied: ' + file);
    }
  }
  console.log('B06 exact web/master pins, paired decoded page/reexport fixtures and byte/import/export/path negatives PASS; missing-web-screen reversal rejected; mutant-sha256=' + crypto.createHash('sha256').update(missingWebScreen).digest('hex'));
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
        oldHashes: fixtureHashes, dir: path.dirname(file), root, consentBoundaryEdge });
      let denied = false;
      try { vm.runInContext(`(${scanSource})(dir)`, realm); }
      catch (error) {
        assert.equal(error.code, 'ERR_ASSERTION');
        assert.ok(error.message.startsWith('unexpected incoming production consumer: ' + file));
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
// T2 fixture reuses the actual acceptance harness's public issuer inputs and loader.
// Only SDK fixture plumbing is extended; no production authentication is replaced.
function linkFixture(history, mutations = {}) {
  let fixture = fs.readFileSync(path.join(root, 'scripts/verify-guest-booking-acceptance.js'), 'utf8').split('const tests=[];')[0];
  fixture = fixture.replace('vm.createContext({})', 'vm.createContext({setTimeout,clearTimeout})')
    .replace("r.bookingNumber===value.bookingNumber", "(collection==='GuestBookingAcceptances'&&r.bookingNumber===value.bookingNumber)");
  fixture = fixture.replace("op:'find',collection,filter,options", "op:'find',collection,filter,limit,sort,options");
  const shim = { ...fs, readFileSync(file, ...args) {
    const text = fs.readFileSync(file, ...args), transform = mutations[path.basename(file)];
    return transform ? transform(text) : text;
  } };
  const fixtureModule = { exports: {} };
  vm.runInNewContext(fixture + '\nmodule.exports={subject,durable,input,NOW};', { require: name => name === 'node:fs' ? shim : name === 'node:crypto' && mutations.fixtureCrypto ? mutations.fixtureCrypto : require(name), __dirname: path.join(root, 'scripts'), Buffer, module: fixtureModule, setTimeout, clearTimeout });
  const f = fixtureModule.exports, db = history || f.durable();
  for (const name of [contexts, negatives, 'GuestConsentBookingLinks']) db.rows[name] ||= [];
  const s = f.subject(db); s.input = f.input; s.NOW = f.NOW;
  const originalLoad = s.load;
  s.load = name => {
    const actual = originalLoad(name);
    if (name !== 'backend/guestConsentBookingLink') return actual;
    return Object.fromEntries(Object.keys(actual).map(method => [method, async (...args) => {
      const offset = s.state.trace.length;
      const result = await actual[method](...args);
      assert.deepEqual(Reflect.ownKeys(result), ['status'], 'L04-R3 status-only result; no PII/root/capsule/number/context/token');
      const allowed = method === 'linkGuestConsentBrowserToAcceptedBooking' ? ['LINKED','DENIED','INTEGRITY','UNKNOWN'] : ['WITHDRAWN','UNRESOLVED','INTEGRITY'];
      assert.ok(allowed.includes(result.status), 'L04-R3 exact negative-only status set');
      for (const entry of s.state.trace.slice(offset)) {
        assert.ok(['find','secret','insert'].includes(entry.op), 'L04-R3 no SDK update/save/remove/bulk');
        if (entry.op === 'insert') assert.equal(entry.collection, 'GuestConsentBookingLinks', 'L04-R3 only immutable link insert; no booking mutation');
      }
      return result;
    }]));
  };
  return s;
}
async function linkExpiryClassificationTests() {
  const outcomes = [];
  for (const phase of ['duplicate', 'readback']) {
    const s = linkFixture(), o = await s.load('backend/guestBookingOfferIssuer').issueGuestBookingOffer(s.realm(s.input()));
    assert.notEqual(o, 'DENIED');
    assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(o.token, o.capsule)).status, 'ACCEPTED_PENDING');
    const b = await s.load('backend/guestConsentContext').createGuestConsentBrowserContext();
    assert.equal(b.status, 'CREATED');
    const api = s.load('backend/guestConsentBookingLink');
    const create = () => api.linkGuestConsentBrowserToAcceptedBooking(b.token, o.token, o.capsule);
    if (phase === 'duplicate') assert.equal((await create()).status, 'LINKED');
    const query = s.wix.query; let reads = 0;
    s.wix.query = collection => {
      const q = query(collection), find = q.find;
      q.find = async options => {
        const page = await find(options);
        if (collection === 'GuestConsentBookingLinks' && ++reads === (phase === 'duplicate' ? 1 : 2)) {
          const hasNext = page.hasNext;
          page.hasNext = function () { s.state.now = o.offerExpiresAtMs; return hasNext.call(page); };
        }
        return page;
      }; return q;
    };
    s.state.now = o.offerExpiresAtMs - 1; s.state.trace = [];
    const result = await create();
    assert.equal(s.state.now, o.offerExpiresAtMs);
    assert.equal(s.state.trace.filter(t => t.op === 'insert').length, phase === 'duplicate' ? 0 : 1);
    assert.equal(s.state.db.rows.GuestConsentBookingLinks.length, 1, 'L01-R4 association retained, no rollback');
    outcomes.push({ phase, status: result.status });
  }
  assert.deepEqual(outcomes, [{ phase: 'duplicate', status: 'DENIED' }, { phase: 'readback', status: 'DENIED' }], 'L01-R4 closing classification expiry denies acknowledgement');
  console.log('L01-R4 duplicate/readback hasNext expiry DENIED; zero/one authorized inserts retained PASS');
}
async function linkPrepared(mutations = {}) {
  const s = linkFixture(undefined, mutations), o = await s.load('backend/guestBookingOfferIssuer').issueGuestBookingOffer(s.realm(s.input()));
  assert.notEqual(o, 'DENIED');
  const acceptance = s.load('backend/guestBookingAcceptance');
  assert.equal((await acceptance.acceptGuestBookingOffer(o.token, o.capsule)).status, 'ACCEPTED_PENDING');
  const ctx = s.load('backend/guestConsentContext'), b = await ctx.createGuestConsentBrowserContext();
  assert.equal(b.status, 'CREATED');
  const api = s.load('backend/guestConsentBookingLink'), rootRow = s.state.db.rows.GuestBookingAcceptances[0];
  return { s, o, ctx, b, api, acceptance, rootRow, create: (...args) => api.linkGuestConsentBrowserToAcceptedBooking(...(args.length ? args : [b.token, o.token, o.capsule])) };
}
function linkIntercept(s, hook) {
  const original = s.wix.query;
  s.wix.query = collection => { const q = original(collection), find = q.find; q.find = async options => hook(collection, await find(options)); return q; };
}
function linkReplace(source, anchor, replacement) {
  assert.equal(source.split(anchor).length, 2, 'L01-R3 unique causal anchor');
  return source.replace(anchor, replacement);
}
async function linkClosureTests() {
  const links = 'GuestConsentBookingLinks';
  {
    const {s,o,b,ctx,create} = await linkPrepared();
    const good = [b.token,o.token,o.capsule]; let cases = 0;
    for (let i=0;i<3;i++) for (const value of [undefined,null,{},[],new String(good[i]),1,true,()=>{},'', 'bad', good[i]+' ', good[i]+'\n']) {
      // Whitespace around valid JSON is permitted; malformed capsule cases below are not normalized tokens.
      if (i===2 && typeof value==='string' && value.trim()===o.capsule) continue;
      const args=good.slice();args[i]=value;s.state.trace=[];
      assert.equal((await create(...args)).status,'DENIED','L01-R1 argument '+i);assert.equal(s.state.trace.length,0);cases++;
    }
    for(const args of [[],good.slice(0,1),good.slice(0,2),[...good,{}],[b.token,'wgb1.k.'+'a'.repeat(1000)+'.'+'a'.repeat(43),o.capsule],[b.token,o.token,' '.repeat(120001)],[b.token,o.token,'"'+'é'.repeat(60000)+'"']]) {
      s.state.trace=[]; const result=await s.load('backend/guestConsentBookingLink').linkGuestConsentBrowserToAcceptedBooking(...args);
      assert.equal(result.status,'DENIED');assert.equal(s.state.trace.length,0);cases++;
    }
    for(const args of [[],[b.token],[b.token,s.state.now+1,{}],[b.token,null],[b.token,NaN],[b.token,Infinity],[b.token,new Number(s.state.now+1)],[b.token,s.state.now],[b.token,s.state.now-1],[b.token,s.state.now+10001],[{},s.state.now+1],['bad',s.state.now+1]]) {
      s.state.trace=[];assert.equal((await ctx.resolveGuestConsentBrowserContext(...args)).status,'DENIED');assert.equal(s.state.trace.length,0);
    }
    console.log('L01-R1 finite malformed/arity/deadline zero IO PASS; creation cases='+cases);
  }
  {
    const {s,o,b,create,rootRow,acceptance} = await linkPrepared();
    for(const field of ['operationId','audience','intentDigest','quoteDigest','_id','rootDigest','issuedAtMs','offerExpiresAtMs']) {
      const bad={...rootRow};bad[field]=typeof bad[field]==='number'?bad[field]+1:field==='audience'?'foreign':'0'.repeat(64);
      s.state.db.rows.GuestBookingAcceptances=[bad];s.state.trace=[];
      assert.ok(['INTEGRITY','UNKNOWN'].includes((await create()).status),'L01-R2 '+field);
      assert.equal(s.state.trace.filter(t=>t.op==='insert').length,0,'L01-R2 '+field+' zero insert');
    }
    s.state.db.rows.GuestBookingAcceptances=[rootRow];
    // Same capsule and intent, real credential issuer and acceptance writer under foreign configured audience.
    const foreign=linkFixture(undefined,{fixtureCrypto:{...crypto,randomBytes(n){assert.equal(n,32);return Buffer.from(rootRow.operationId,'hex');}}});foreign.state.db.keys.audience='foreign';
    const issuer=foreign.load('backend/guestBookingOfferIssuer'), credentials=foreign.load('backend/guestBookingCredentials').createGuestBookingCredentials(foreign.realm(foreign.state.db.keys));
    const binding=issuer.validateGuestBookingOfferCapsule(o.capsule).binding;
    const token=credentials.prepareBootstrap(foreign.realm({intentBinding:JSON.parse(JSON.stringify(binding)),nowMs:foreign.state.now}));
    assert.notEqual(token,'DENIED');
    assert.equal((await foreign.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(token,o.capsule)).status,'ACCEPTED_PENDING');
    const foreignRoot=foreign.state.db.rows.GuestBookingAcceptances[0];
    assert.equal(foreignRoot._id,rootRow._id,'L01-R2 foreign writer same intent ID reaches binding');
    assert.notEqual(acceptance.validateGuestBookingAcceptanceRoot(s.realm(foreignRoot)),'DENIED');
    s.state.db.rows.GuestBookingAcceptances=[foreignRoot];s.state.trace=[];
    assert.equal((await create()).status,'INTEGRITY');assert.equal(s.state.trace.filter(t=>t.op==='insert').length,0);
    console.log('L01-R2 individual root mismatches and real foreign-audience writer binding PASS');
  }
  for(const phase of ['readback','scan']) for(const mode of ['error','missing','empty','partial','conflict','digest','accessor','bad-date','native']) {
    const {s,ctx,b,api,rootRow,create}=await linkPrepared();
    if(phase==='scan'){assert.equal((await create()).status,'LINKED');assert.equal((await ctx.withdrawGuestConsentBrowser(b.token)).status,'RECORDED');}
    let reads=0,getters=0;
    linkIntercept(s,(collection,page)=>{
      if(collection!==links || (phase==='readback' && ++reads!==2))return page;
      if(mode==='error')throw Error('unavailable');
      if(mode==='missing')return {};
      if(mode==='empty')return {items:[],hasNext(){return false;}};
      if(mode==='partial')return {items:[],hasNext(){return true;}};
      const row=page.items[0];assert.ok(row);
      if(mode==='conflict')row.contextId='0'.repeat(64);
      if(mode==='digest')row.recordDigest='0'.repeat(64);
      if(mode==='accessor')Object.defineProperty(row,'recordDigest',{enumerable:true,get(){getters++;throw Error('getter');}});
      if(mode==='bad-date')row._createdDate='not Date';
      if(mode==='native'){row._createdDate=vm.runInContext('new Date(Date.now())',s.context);row._updatedDate=vm.runInContext('new Date(Date.now())',s.context);row._owner='fixture';assert.equal(vm.runInContext('(value)=>Date.prototype.getTime.call(value)',s.context)(row._createdDate),s.state.now);return Object.assign(Object.create({hasNext(){return false;}}),{items:page.items});}
      return page;
    });
    s.state.trace=[];const result=phase==='scan'?await api.readGuestConsentBookingNegative(rootRow._id):await create();
    assert.deepEqual(Object.keys(result),['status'],'L04-R3 status-only result');
    if(mode==='native')assert.equal(result.status,phase==='scan'?'WITHDRAWN':'LINKED');
    else assert.ok((phase==='scan'?['UNRESOLVED','INTEGRITY']:['UNKNOWN','INTEGRITY']).includes(result.status),'L03-R1 '+phase+' '+mode+' '+result.status);
    assert.equal(getters,0,'L03-R1 accessor never invoked');
    assert.ok(s.state.trace.filter(t=>t.op==='insert').every(t=>t.collection===links));
  }
  {
    const {s,create}=await linkPrepared();const insert=s.wix.insert;
    s.wix.insert=async(c,row,options)=>c===links?{}:insert(c,row,options);
    assert.equal((await create()).status,'UNKNOWN','L03-R1 false success ack requires persistence');assert.equal(s.state.db.rows[links].length,0);
  }
  console.log('L03-R1 finite readback/scan transport and false-ack baseline-GREEN PASS');
  {
    const {s,o,ctx,b,api,rootRow,create}=await linkPrepared();assert.equal((await create()).status,'LINKED');
    const b2=await ctx.createGuestConsentBrowserContext();assert.equal((await api.linkGuestConsentBrowserToAcceptedBooking(b2.token,o.token,o.capsule)).status,'LINKED');
    const sorted=s.state.db.rows[links].slice().sort((a,b)=>a._id<b._id?-1:1);
    const token=[b.token,b2.token].find(t=>t.split('.')[1]===sorted[1].contextId);assert.equal((await ctx.withdrawGuestConsentBrowser(token)).status,'RECORDED');
    let reads=0;linkIntercept(s,(c,p)=>{if(c===negatives&&++reads===1)throw Error('failed earlier negative');return p;});
    assert.equal((await api.readGuestConsentBookingNegative(rootRow._id)).status,'WITHDRAWN');assert.equal(reads,2);
    console.log('L03-R2 failed earlier observation then proved later negative PASS');
  }
  {
    const {s,b,ctx,rootRow,api,create}=await linkPrepared();
    for(const duplicate of [false,true]) {
      s.state.trace=[];assert.equal((await create()).status,'LINKED');
      const trace=JSON.parse(JSON.stringify(s.state.trace)),linkRow=s.state.db.rows[links][0];
      assert.deepEqual(trace.map(t=>[t.op,t.collection||t.name]),[['find',contexts],['secret','WBE_GUEST_BOOKING_KEYS'],['find','GuestBookingAcceptances'],['find',links],...(!duplicate?[['insert',links],['find',links]]:[])],'L04-R1 exact create trace');
      for(const t of trace){if(t.op==='secret')continue;assert.deepEqual(t.options,t.op==='find'?{suppressAuth:true,suppressHooks:true,consistentRead:true}:{suppressAuth:true,suppressHooks:true});if(t.op==='find'){assert.equal(t.limit,2);assert.equal(t.sort,null);assert.deepEqual(t.filter,['_id',t.collection===contexts?b.token.split('.')[1]:t.collection===links?linkRow._id:rootRow._id]);}}
    }
    const count=s.state.db.rows[links].length,fresh=await ctx.createGuestConsentBrowserContext();assert.equal(fresh.status,'CREATED');assert.equal(s.state.db.rows[links].length,count,'L02-R1 new browser no automatic link');assert.equal((await ctx.readGuestConsentBrowserNegative(fresh.token)).status,'UNRESOLVED');
    await ctx.withdrawGuestConsentBrowser(b.token);s.state.trace=[];assert.equal((await api.readGuestConsentBookingNegative(rootRow._id)).status,'WITHDRAWN');
    const scan=s.state.trace.find(t=>t.collection===links);assert.deepEqual(Array.from(scan.filter),['acceptanceId',rootRow._id]);assert.equal(scan.limit,25);assert.equal(scan.sort,'_id');
    console.log('L04-R1 exact create/duplicate and retained query shape/options PASS');
  }
}
async function linkCausalTests() {
  for(const kind of ['auth','binding','final-insert']) {
    for(const reversed of [false,true]) {
      const mutations = !reversed ? {} : kind==='auth' ? {'guestConsentContext.js':source=>linkReplace(source,'if (!crypto.timingSafeEqual(actual, expected))','if (false)')} : {'guestConsentBookingLink.js':source=>kind==='binding' ? linkReplace(source,'return root._id === acceptanceId && root.operationId === claims.intentId &&','return true || root._id === acceptanceId && root.operationId === claims.intentId &&') : linkReplace(source,'        verify(root);\n        return wixData.insert(COLLECTION, row, WRITE);','        return wixData.insert(COLLECTION, row, WRITE);')};
      const {s,o,b,create}=await linkPrepared(mutations);
      let args=[b.token,o.token,o.capsule];
      if(kind==='auth')args[0]=b.token.slice(0,-1)+(b.token.endsWith('0')?'1':'0');
      if(kind==='binding')args[2]='{}';
      if(kind==='final-insert') {
        s.state.now=o.offerExpiresAtMs-1;
        linkIntercept(s,(collection,page)=>collection==='GuestConsentBookingLinks'?{items:[],hasNext(){queueMicrotask(()=>{s.state.now=o.offerExpiresAtMs;});return false;}}:page);
      }
      s.state.trace=[];await create(...args);
      const forbidden=s.state.trace.filter(t=>kind==='auth' ? t.op==='secret'||t.collection==='GuestBookingAcceptances'||t.collection==='GuestConsentBookingLinks' : t.op==='insert');
      const witness=()=>assert.equal(forbidden.length,0,'L01-R3 '+kind+' zero forbidden IO');
      if(reversed) {assert.ok(forbidden.length>0,'L01-R3 reversal reaches forbidden IO');assert.throws(witness,error=>error.code==='ERR_ASSERTION'&&error.message.startsWith('L01-R3 '+kind+' zero forbidden IO'));}
      else witness();
    }
    console.log('L01-R3 '+kind+' baseline-GREEN and causal zero-IO assertion failure PASS');
  }
}
async function isolationTests() {
  for (const file of Object.keys(consentBoundaryPins)) {
    const source=fs.readFileSync(path.join(root,file),'utf8');
    assert.equal(consentBoundaryEdge(file,source),true,'L04-R2 reviewed source prerequisite');
    assert.doesNotMatch(source,/wixData\s*(?:\[|\.\s*(?:update|save|remove|bulk\w*)\s*\()/,'L04-R3 SDK receiver mutation restriction');
    assert.doesNotMatch(source,/webMethod|Permissions|fetch\s*\(|import\s*\(|require\s*\(/,'L04-R3 no public/network/dynamic bridge');
  }
  const linkSource=fs.readFileSync(path.join(root,'velo/backend/guestConsentBookingLink.js'),'utf8');
  assert.deepEqual(linkSource.match(/command: '[^']+'/g),["command: 'status'","command: 'status'"],'L04-R3 credential command remains status only');
  assert.deepEqual(linkSource.match(/wixData\.insert\([^;]+/g),['wixData.insert(COLLECTION, row, WRITE)'],'L04-R3 only link insert site');
  assert.match(linkSource,/const COLLECTION = 'GuestConsentBookingLinks';/);
  for (const [file,hash] of Object.entries({
    'velo/backend/guestBookingCredentials.js':'c34364e2196a67016b4def3850149478015fd41d35a42fe5a590d2c6d5750c9f',
    'velo/backend/guestBookingAccessPolicy.js':'bbc14fb6951dbc7b677e9ca9202a2906d0da7bd5a2b322e56ca147e7e21dad35'
  })) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),hash,'L04-R3 unchanged credential purpose/command whitelist '+file);

  const reports = [], gateHashes = new Set(), mutantHashes = new Set();
  const files = ['verify-guest-booking-access-policy.js', 'verify-guest-booking-price-groups.js',
    'verify-guest-booking-purchase-input.js', 'verify-locked-pricing-quote-authority.js', 'verify-strict-locked-pricing-quote.js'];
  for (const name of files) {
    const source = fs.readFileSync(path.join(root, 'scripts', name), 'utf8');
    const start = source.indexOf('const acceptancePrivatePins =');
    const marker = '  return report;\n}';
    const end = source.indexOf(marker, source.indexOf('function runAcceptanceIsolationMetatests', start));
    assert.ok(start >= 0 && end > start, 'L04 exact extracted gate boundary');
    const extracted = source.slice(start, end + marker.length);
    const realm = vm.createContext({require, fs, path, assert, __dirname:path.join(root, 'scripts'), console:{log(){}}});
    vm.runInContext(extracted + ';globalThis.report=runAcceptanceIsolationMetatests((file,text)=>acceptancePrivateEdge(file,text));', realm);
    const report = JSON.parse(JSON.stringify(realm.report));
    assert.equal(report.cases, report.names.length); assert.equal(report.witnessCount, report.witnesses.length);
    assert.equal(report.mutantCount, report.mutantHashes.length);
    report.mutantHashes.forEach(h => mutantHashes.add(h));
    const hash = crypto.createHash('sha256').update(extracted).digest('hex'); gateHashes.add(hash);
    reports.push({file:name, extractedHash:hash, ...report});
  }
  const cases = [], witnesses = [], boundaryMutantHashes = new Set();
  const bypass = () => true;
  function check(name, file, text, expected) {
    assert.equal(consentBoundaryEdge(file,text),expected,'L04-R3 '+name); cases.push(name);
    if (!expected) {
      const witness = gate => assert.equal(gate(file,text),false,'L04-R3 causal '+name);
      witness(consentBoundaryEdge);
      assert.throws(()=>witness(bypass),e=>e.code==='ERR_ASSERTION'&&e.message.startsWith('L04-R3 causal '+name));
      witnesses.push(name); boundaryMutantHashes.add(crypto.createHash('sha256').update(bypass.toString()).digest('hex'));
    }
  }
  for (const [file,pin] of Object.entries(consentBoundaryPins)) {
    const source=fs.readFileSync(path.join(root,file),'utf8'), module=path.basename(file,'.js');
    check('exact '+module,file,source,true);
    check('LF/CRLF '+module,file,source.replace(/\r?\n/g,'\r\n'),true);
    for (const [kind,text] of [['body',source+'\nvoid 0;'],['import',source+"\nimport 'buffer';"],['export',source+'\nexport const extra=1;']]) {
      assert.equal(new vm.SourceTextModule(text).status,'unlinked');
      check(kind+' drift '+module,file,text,false);
    }
    check('alias '+module,'velo/backend/nested/../'+module+'.js',source,false);
    for (const consumer of ['velo/public/inert.js','velo/pages/inert.js','velo/backend/inert.js','velo/backend/inert.web.js','velo/backend/inert.jsw']) {
      for (const [form,wrap] of [['static',s=>`import * as x from '${s}';`],['dynamic',s=>`import('${s}');`],['reexport',s=>`export * from '${s}';`],['encoded',null]]) {
        for (const forbidden of [false,true]) {
          const spec=forbidden?'backend/'+module:'backend/benignFixture';
          // Encode only the module's first character; both sides remain parser-valid.
          const text=form==='encoded'?`export * from 'backend/\\u{${spec.charCodeAt(8).toString(16)}}${spec.slice(9)}';`:wrap(spec);
          const parsed=new vm.SourceTextModule(text); assert.equal(parsed.status,'unlinked');
          if(form!=='dynamic') assert.deepEqual(parsed.dependencySpecifiers,[spec]);
          check([module,consumer,form,forbidden].join(' '),consumer,text,!forbidden);
        }
      }
    }
    for(const declaration of pin.exports) {
      const name=declaration.match(/function (\w+)/)[1];
      if (module === 'guestConsentContext' && name !== 'resolveGuestConsentBrowserContext') continue;
      check('export reference '+name,'velo/backend/inert.js',`export { ${name} } from 'backend/other';`,false);
    }
  }
  assert.equal(new Set(cases).size,cases.length); assert.equal(new Set(witnesses).size,witnesses.length);
  const summary={scope:'extracted acceptance gates plus consent boundary ONLY; not full five scripts',
    gateApplications:reports.length,uniqueGateHashes:gateHashes.size,
    acceptanceFixtures:reports.reduce((n,r)=>n+r.cases,0),
    acceptanceWitnessApplications:reports.reduce((n,r)=>n+r.witnessCount,0),
    acceptanceUniqueMutantHashes:[...mutantHashes],boundaryFixtures:cases.length,
    boundaryWitnessApplications:witnesses.length,boundaryUniqueMutantHashes:[...boundaryMutantHashes],reports,cases,witnesses};
  console.log(JSON.stringify({T2Isolation:summary}));
}

async function linkTests() {
  await linkExpiryClassificationTests();
  await linkClosureTests();
  await linkCausalTests();
  const file = path.join(root, 'velo/backend/guestConsentBookingLink.js');
  assert.ok(fs.existsSync(file), 'L01 MISSING-FEATURE RED: actual private link module absent (not behavioral RED)');
  const s = linkFixture(), o = await s.load('backend/guestBookingOfferIssuer').issueGuestBookingOffer(s.realm(s.input()));
  assert.notEqual(o, 'DENIED');
  assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(o.token, o.capsule)).status, 'ACCEPTED_PENDING');
  const context = s.load('backend/guestConsentContext'), browser = await context.createGuestConsentBrowserContext();
  assert.equal(browser.status, 'CREATED');
  s.state.trace = [];
  assert.equal((await s.load('backend/guestConsentBookingLink').linkGuestConsentBrowserToAcceptedBooking(browser.token, o.token, o.capsule)).status, 'LINKED', 'L01 actual issuer/root/browser link');
  assert.equal(s.state.db.rows.GuestConsentBookingLinks.length, 1);
  console.log('L01 first actual authenticated link vertical slice PASS');
  const link = s.load('backend/guestConsentBookingLink'), row = s.state.db.rows.GuestBookingAcceptances[0];
  const create = (...args) => link.linkGuestConsentBrowserToAcceptedBooking(...args);
  const writes = () => s.state.trace.filter(t => t.op === 'insert');
  const secretReads = () => s.state.trace.filter(t => t.op === 'secret');
  const reset = () => { s.state.trace = []; };
  const creds = s.load('backend/guestBookingCredentials').createGuestBookingCredentials(s.realm(s.state.db.keys));
  const access = creds.attenuateBootstrap(s.realm({ bootstrapToken: o.token, nowMs: s.state.now }));
  assert.notEqual(access, 'DENIED'); reset();
  assert.equal((await create(browser.token, access, o.capsule)).status, 'LINKED'); assert.equal(writes().length, 0);
  for (const args of [[browser.token, o.token, o.capsule, {}], ['booking-number', o.token, o.capsule], [browser.token, 'booking-number', o.capsule], [browser.token, o.token, 'x'], [browser.token, o.token, ' '.repeat(120001)]]) {
    reset(); assert.equal((await create(...args)).status, 'DENIED'); assert.equal(s.state.trace.length, 0);
  }
  reset();
  assert.equal((await create(browser.token.slice(0,-1) + (browser.token.endsWith('0')?'1':'0'), o.token, o.capsule)).status, 'DENIED');
  assert.equal(secretReads().length, 0); assert.equal(writes().length, 0); assert.ok(s.state.trace.every(t=>t.collection===contexts));
  reset(); assert.equal((await create(browser.token, o.token.slice(0,-1)+(o.token.endsWith('A')?'B':'A'), o.capsule)).status, 'DENIED');
  assert.ok(s.state.trace.every(t=>t.op==='secret'||t.collection===contexts)); assert.equal(writes().length,0);
  reset(); assert.equal((await create(browser.token, o.token, '{}')).status, 'INTEGRITY'); assert.equal(writes().length, 0);
  // An independently writer-produced, internally valid foreign root, returned at the exact read boundary.
  const foreign = await s.load('backend/guestBookingOfferIssuer').issueGuestBookingOffer(s.realm({...s.input(),guestName:'Foreign Fixture'}));
  assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(foreign.token,foreign.capsule)).status,'ACCEPTED_PENDING');
  const foreignRow = s.state.db.rows.GuestBookingAcceptances[1];
  assert.notEqual(s.load('backend/guestBookingAcceptance').validateGuestBookingAcceptanceRoot(s.realm(foreignRow)),'DENIED');
  const originalQuery = s.wix.query;
  function readHook(hook) {
    s.wix.query = collection => {
      const q = originalQuery(collection), find = q.find;
      q.find = async options => { const p = await find(options); return await hook(collection,p) || p; }; return q;
    };
  }
  readHook(async (collection,p)=>collection==='GuestBookingAcceptances'?{items:s.realm([foreignRow]),hasNext(){return false;}}:p);
  reset(); assert.equal((await create(browser.token,o.token,o.capsule)).status,'INTEGRITY'); assert.equal(writes().length,0); s.wix.query=originalQuery;
  const savedRoots = s.state.db.rows.GuestBookingAcceptances; s.state.db.rows.GuestBookingAcceptances=[];
  reset(); assert.equal((await create(browser.token,o.token,o.capsule)).status,'UNKNOWN'); assert.equal(writes().length,0); s.state.db.rows.GuestBookingAcceptances=savedRoots;
  for (const boundary of ['key','root','pre-read','queued-insert','regression']) {
    const next = await context.createGuestConsentBrowserContext(); assert.equal(next.status,'CREATED');
    s.state.now=o.offerExpiresAtMs-5;
    if(boundary==='key')s.state.secretHook=async()=>{s.state.now=o.offerExpiresAtMs;};
    readHook(async(collection,p)=>{
      if(boundary==='root'&&collection==='GuestBookingAcceptances')s.state.now=o.offerExpiresAtMs;
      if(boundary==='pre-read'&&collection==='GuestConsentBookingLinks')s.state.now=o.offerExpiresAtMs;
      if(boundary==='regression'&&collection==='GuestBookingAcceptances')s.state.now--;
      if(boundary==='queued-insert'&&collection==='GuestConsentBookingLinks')return {items:[],hasNext(){queueMicrotask(()=>{s.state.now=o.offerExpiresAtMs;});return false;}};
      return p;
    });
    reset(); assert.equal((await create(next.token,o.token,o.capsule)).status,'DENIED','L01 '+boundary); assert.equal(writes().length,0,'L01 '+boundary+' zero insert');
    s.state.secretHook=null; s.wix.query=originalQuery; s.state.now=s.NOW;
  }
  console.log('L01 focused real attenuation/authentication/binding/expiry-boundary controls PASS (not full contract matrix)');
  const second = await context.createGuestConsentBrowserContext(); assert.equal(second.status,'CREATED');
  assert.equal((await create(second.token, o.token, o.capsule)).status,'LINKED');
  assert.equal((await context.withdrawGuestConsentBrowser(browser.token)).status,'RECORDED');
  assert.equal((await link.readGuestConsentBookingNegative(row._id)).status,'WITHDRAWN');
  assert.equal((await link.readGuestConsentBookingNegative(foreignRow._id)).status,'UNRESOLVED');
  const third = await context.createGuestConsentBrowserContext(); assert.equal(third.status,'CREATED');
  assert.equal((await context.withdrawGuestConsentBrowser(third.token)).status,'RECORDED');
  assert.equal((await create(third.token,foreign.token,foreign.capsule)).status,'LINKED');
  assert.equal((await link.readGuestConsentBookingNegative(foreignRow._id)).status,'WITHDRAWN');
  console.log('L03 both actual link/withdraw orderings PASS');
  const history = JSON.parse(JSON.stringify(s.state.db)); history.rows[contexts]=[]; history.keys=null; history.config=null; history.rows.GuestBookingFinancialRevisions=[];
  // Provider metadata added to actual writer-produced application rows, serialized for restart.
  for(const collection of ['GuestBookingAcceptances','GuestConsentBookingLinks',negatives]) for(const item of history.rows[collection]) {
    item._createdDate=new Date(s.NOW).toISOString();item._updatedDate=new Date(s.NOW).toISOString();
    if(collection!=='GuestBookingAcceptances')item._owner='fixture';
  }
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(),'wbe-consent-t2-'));
  const historyPath=path.join(evidence,'writer-history.json'); fs.writeFileSync(historyPath,JSON.stringify({db:history,id:row._id,now:o.offerExpiresAtMs+1}));
  const child=spawnSync(process.execPath,['--experimental-vm-modules',__filename,'--link-restart',historyPath],{encoding:'utf8',timeout:15000});
  assert.equal(child.status,0,child.stderr); assert.match(child.stdout,/L02 fresh-process retained negative PASS/);
  const reversal=spawnSync(process.execPath,['--experimental-vm-modules',__filename,'--link-restart',historyPath,'required-context'],{encoding:'utf8',timeout:15000});
  assert.equal(reversal.status,1);assert.match(reversal.stderr,/L02 fresh-process durable association/);assert.match(reversal.stderr,/UNRESOLVED/);
  console.log('L02-R1 native metadata restart and L02-R2 context-required causal reversal PASS');
  console.log('L02 expired/keyless/contextless actual writer-history fresh process PASS: '+historyPath);
  for(const mode of ['lost-ack','absent','corrupt','concurrent','late-started']) {
    const b=await context.createGuestConsentBrowserContext(); assert.equal(b.status,'CREATED');
    const insert=s.wix.insert;
    s.wix.insert=async(collection,value,options)=>{
      if(collection!=='GuestConsentBookingLinks')return insert(collection,value,options);
      if(mode==='absent'){s.state.trace.push({op:'insert',collection});throw Error('before commit');}
      const result=await insert(collection,value,options);
      if(mode==='corrupt')s.state.db.rows[collection].find(r=>r._id===value._id).extra=true;
      if(mode==='late-started')s.state.now=o.offerExpiresAtMs;
      if(mode!=='concurrent')throw Error('lost acknowledgement');return result;
    };
    if(mode==='late-started')s.state.now=o.offerExpiresAtMs-5;
    reset();
    if(mode==='concurrent')assert.deepEqual((await Promise.all([create(b.token,o.token,o.capsule),create(b.token,o.token,o.capsule)])).map(r=>r.status),['LINKED','LINKED']);
    else assert.equal((await create(b.token,o.token,o.capsule)).status,mode==='lost-ack'?'LINKED':mode==='corrupt'?'INTEGRITY':mode==='late-started'?'DENIED':'UNKNOWN','L03 '+mode);
    s.wix.insert=insert; s.state.now=s.NOW;
  }
  console.log('L03 focused immutable duplicate/concurrent/lost-ack/absent/corrupt/valid-start-late-ack PASS');
  // Bounded observation is not a link-creation cap; all rows below are actual writer output.
  s.state.db.rows.GuestConsentBookingLinks=s.state.db.rows.GuestConsentBookingLinks.filter(r=>!r.extra);
  const additional=[];
  for(let i=0;i<27;i++) { const b=await context.createGuestConsentBrowserContext(); assert.equal(b.status,'CREATED'); assert.equal((await create(b.token,foreign.token,foreign.capsule)).status,'LINKED');additional.push(b.token); }
  const sorted=s.state.db.rows.GuestConsentBookingLinks.filter(r=>r.acceptanceId===foreignRow._id).sort((a,b)=>a._id<b._id?-1:1);
  const lastContext=sorted[sorted.length-1].contextId, lastToken=additional.find(t=>t.split('.')[1]===lastContext)||third.token;
  s.state.db.rows[negatives]=[]; assert.equal((await context.withdrawGuestConsentBrowser(lastToken)).status,'RECORDED');
  reset(); assert.equal((await link.readGuestConsentBookingNegative(foreignRow._id)).status,'UNRESOLVED'); assert.ok(s.state.trace.length<=27);
  const firstToken=additional.find(t=>t.split('.')[1]===sorted[0].contextId)||third.token;
  assert.equal((await context.withdrawGuestConsentBrowser(firstToken)).status,'RECORDED');
  reset(); assert.equal((await link.readGuestConsentBookingNegative(foreignRow._id)).status,'WITHDRAWN');
  assert.ok(s.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestConsentBookingLinks',negatives].includes(t.collection)));
  for(const t of s.state.trace)assert.deepEqual(JSON.parse(JSON.stringify(t.options)),{suppressAuth:true,suppressHooks:true,consistentRead:true});
  assert.deepEqual(Object.keys(link).sort(),['linkGuestConsentBrowserToAcceptedBooking','readGuestConsentBookingNegative'].sort());
  console.log('L03 bounded first-page negative/overflow and L04 focused fixed read options/counts/negative-only exports PASS');
  // Real 10-second timer, deliberately nonadvancing valid clock: timeout must latch,
  // not restart orchestration merely because the sampled clock has not advanced.
  const timedBrowser=await context.createGuestConsentBrowserContext(); assert.equal(timedBrowser.status,'CREATED');
  const originalInsert=s.wix.insert; let rejectLate,pendingRow;
  s.wix.insert=(collection,value,options)=>{
    if(collection!=='GuestConsentBookingLinks')return originalInsert(collection,value,options);
    s.state.trace.push({op:'insert',collection}); pendingRow=JSON.parse(JSON.stringify(value));
    return new Promise((_,reject)=>{rejectLate=reject;});
  };
  const errors=[],listener=e=>errors.push(e);process.on('unhandledRejection',listener);
  const watchdog=setTimeout(()=>{throw Error('L03 timeout watchdog');},15000);
  try {
    reset(); assert.equal((await create(timedBrowser.token,o.token,o.capsule)).status,'UNKNOWN');
    assert.equal(s.state.trace[s.state.trace.length-1].op,'insert','L03 timeout stops readback even with stationary clock');
    const atReturn=JSON.stringify(s.state.trace); s.state.db.rows.GuestConsentBookingLinks.push(pendingRow);rejectLate(Error('late rejection'));
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(JSON.stringify(s.state.trace),atReturn);assert.equal(errors.length,0);
  } finally {clearTimeout(watchdog);process.removeListener('unhandledRejection',listener);s.wix.insert=originalInsert;if(rejectLate)rejectLate(Error('cleanup'));}
  console.log('L03 actual shared-deadline timeout/no post-return IO/late commit-rejection PASS');
  console.log('T2 permitted implementation/coverage PASS: L01-R1, L01-R2, L01-R3, L01-R4, L02-R1, L02-R2, L03-R1, L03-R2, L04-R1. L04-R2 and isolation-specific L04-R3 PENDING independent exact-hash review/pin phase; NOT full-suite GREEN.');
}
async function linkRestart() {
  const h=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
  const mutations=process.argv[4]==='required-context'?{'guestConsentBookingLink.js':source=>linkReplace(source,
    "const raw = await b.io(() => wixData.query(COLLECTION).eq('acceptanceId', acceptanceId)",
    "if ((await wixData.query('GuestConsentBrowserContexts').limit(2).find(READ)).items.length === 0) return { status: 'UNRESOLVED' }; const raw = await b.io(() => wixData.query(COLLECTION).eq('acceptanceId', acceptanceId)")} : {};
  const s=linkFixture(h.db,mutations);s.state.now=h.now;let restored=0;
  linkIntercept(s,(collection,page)=>{
    for(const item of page.items)for(const field of ['_createdDate','_updatedDate'])if(Object.hasOwn(item,field)){
      s.context.metadataText=item[field];item[field]=vm.runInContext('new Date(metadataText)',s.context);
      assert.equal(vm.runInContext('(value)=>value instanceof Date && Number.isFinite(Date.prototype.getTime.call(value))',s.context)(item[field]),true,'L02-R1 native metadata identity');restored++;
    }
    return page;
  });
  assert.equal((await s.load('backend/guestConsentBookingLink').readGuestConsentBookingNegative(h.id)).status,'WITHDRAWN','L02 fresh-process durable association');
  assert.ok(restored>=6,'L02-R1 root/link/negative metadata restored');
  assert.ok(s.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestConsentBookingLinks',negatives].includes(t.collection)));
  console.log('L02 fresh-process retained negative PASS');
}
(process.argv[2] === '--isolation' ? isolationTests() : process.argv[2] === '--link' ? linkTests() : process.argv[2] === '--link-restart' ? linkRestart() : main()).catch(error => { console.error(error); process.exitCode = 1; });
