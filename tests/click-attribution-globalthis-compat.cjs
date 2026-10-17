'use strict';
const { attributionOnly } = require(__dirname + '/support/privacy-bind-projection.cjs'); // O3 P2
// ESLint is a separately pinned test tool; no Wix runtime dependency is added.
// Migrated to the current module graph: clickAttribution -> adsPolicyProtocol
// (the actual globalThis/crypto consumer) + paidTouchState, and the current v2
// schema:1 policy-bound handshake. All original fail-closed assertions retained.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Linter } = require('eslint');
const read = p => fs.readFileSync(path.join(__dirname, '../velo/public', p), 'utf8');
const source = read('clickAttribution.js'), protocol = read('adsPolicyProtocol.js'), touches = read('paidTouchState.js');
// Same legacy-global reproduction as before; `console` is the Velo-provided host
// logging global used by fixed-code diagnostics since 9e6afd6 (not globalThis).
const config = {
  parserOptions: { ecmaVersion: 2019, sourceType: 'module' },
  env: { es6: true },
  globals: { setTimeout: 'readonly', clearTimeout: 'readonly', console: 'readonly' },
  rules: { 'no-undef': ['error', { typeof: true }], 'no-global-assign': 'error' }
};
test('legacy global inventory accepts actual modules without weakening no-undef', () => {
  const lint = new Linter();
  for (const [name, text] of [['clickAttribution', source], ['adsPolicyProtocol', protocol], ['paidTouchState', touches]]) {
    assert.deepEqual(lint.verify(text, config), [], name);
    assert.ok(lint.verify(text + '\nmissingCompatSentinel();', config).some(x => x.ruleId === 'no-undef'), name + ' sentinel');
  }
  // paidTouchState is pure: it must not reference globalThis at all.
  assert.equal(/globalThis/.test(touches), false);
  for (const [name, text] of [['clickAttribution', source], ['adsPolicyProtocol', protocol]])
    assert.ok(lint.verify(text + '\nglobalThis = {};', config).some(x => x.ruleId === 'no-global-assign'), name + ' assign');
  // Both globalThis consumers must keep their explicit declaration.
  for (const [name, text] of [['clickAttribution', source], ['adsPolicyProtocol', protocol]]) {
    const stripped = text.replace(/\/\* global globalThis:readonly \*\//, '');
    assert.notEqual(stripped, text, name + ' declares globalThis');
  }
  const strippedProtocol = protocol.replace(/\/\* global globalThis:readonly \*\//, '');
  assert.ok(lint.verify(strippedProtocol, config).some(x => x.ruleId === 'no-undef' && x.message.includes('globalThis')));
  assert.ok(lint.verify('console.log(1);', { ...config, globals: { setTimeout: 'readonly', clearTimeout: 'readonly' } }).some(x => x.ruleId === 'no-undef'), 'console allowance is explicit, not implicit');
});
const CHANNEL = 'b'.repeat(32);
async function fixture(setup = '', crypto = webcrypto) {
  const values = new Map(), allPosts = [], logs = [];
  let handler, policyReads = 0;
  const record = { capturedAt: new Date().toISOString(), gclid: 'INERT_COMPAT', gbraid: '', wbraid: '', msclkid: '' };
  const context = vm.createContext({ crypto, setTimeout, clearTimeout, performance: { now: () => performance.now() },
    console: { log: (...a) => logs.push(a.join(' ')), warn() {}, error() {} } });
  assert.equal(Object.hasOwn(context, 'globalThis'), false, 'do not inject a host globalThis object');
  vm.runInContext(setup, context);
  const external = {
    'wix-storage-frontend': { local: { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) } },
    // Inert policy endpoint: echoes the exact v2 binding, as the real endpoint does.
    'backend/adsFormRequirement.web': { getAdsFormRequirement: async binding => { policyReads++;
      return { ...binding, requirement: 'NOT_REQUIRED', policyKey: 'a'.repeat(64), observedAt: Date.now() }; } }
  };
  const real = { 'public/adsPolicyProtocol': protocol, 'public/paidTouchState': touches };
  const cache = new Map();
  const load = s => {
    if (cache.has(s)) return cache.get(s);
    let m;
    if (real[s]) m = new vm.SourceTextModule(real[s], { context });
    else if (external[s]) m = new vm.SyntheticModule(Object.keys(external[s]), function () { for (const [k,v] of Object.entries(external[s])) this.setExport(k,v); }, { context });
    else throw Error('Unexpected import ' + s);
    cache.set(s, m); return m;
  };
  const module = new vm.SourceTextModule(source, { context });
  await module.link(load);
  await module.evaluate();
  const api = module.namespace;
  api.initClickAttribution(() => ({ onMessage: f => { handler = f; }, postMessage: d => {
    allPosts.push(d);
    // Inert authenticated-channel peer modelling the Head's v2 schema:1 replies,
    // not a real iframe/provider. Only confirm returns the reconciled record.
    const state = { v: 1, first: record, latest: record };
    handler({ data: { type: 'wbe-click-attribution-result', v: 2, schema: 1, op: d.op, sequence: d.sequence, nonce: d.nonce,
      channel: CHANNEL, allowed: true, record: d.op === 'confirm' ? state : null } });
  } }));
  // O3 P2: raw allPosts retained; posts projects out ONLY validated privacy-only binds.
  return { api, values, allPosts, get posts() { return attributionOnly(allPosts); }, logs, record, context, get policyReads() { return policyReads; } };
}
test('native VM global and real Web Crypto produce valid fresh nonce and optional IDs', async () => {
  const f = await fixture();
  assert.equal(vm.runInContext('typeof globalThis.crypto.getRandomValues', f.context), 'function', 'native VM globalThis exposes injected crypto');
  await f.api.waitForClickAttribution();
  assert.equal(f.api.attributionDenied(), false);
  assert.deepEqual(f.posts.slice(0, 3).map(d => d.op), ['open', 'read', 'confirm']);
  assert.ok(f.posts.every(d => d.v === 2 && d.schema === 1));
  assert.equal(f.policyReads, 1);
  assert.equal(JSON.parse(f.values.get('wl_click_attribution')).first.gclid, 'INERT_COMPAT');
  const first = f.posts[0].nonce;
  assert.match(first, /^[a-f0-9]{32}$/);
  await f.api.waitForClickAttribution();
  assert.equal(f.posts[3].op, 'open');
  assert.match(f.posts[3].nonce, /^[a-f0-9]{32}$/);
  assert.notEqual(f.posts[3].nonce, first);
});
const cases = [
  ['deleted globalThis', 'delete this.globalThis;'],
  ['missing crypto', 'delete this.crypto;'],
  ['missing method', 'this.crypto = {};'],
  ['throwing crypto getter', "Object.defineProperty(this, 'crypto', { get() { throw Error('INERT_PRIVATE'); } });"],
  ['throwing random method', "this.crypto = { getRandomValues() { throw Error('INERT_PRIVATE'); } };"],
  ['malformed string return', "this.crypto = { getRandomValues() { return 'INERT_PRIVATE'; } };"],
  ['malformed short typed array', 'this.crypto = { getRandomValues() { return new Uint8Array(1); } };'],
  ['malformed custom iterable', "this.crypto = { getRandomValues() { return { [Symbol.iterator]() { throw Error('INERT_PRIVATE'); } }; } };"],
  ['undefined return', 'this.crypto = { getRandomValues() {} };']
];
for (const [name, setup] of cases) test(name + ' fails closed without rejected clear or any channel post', async () => {
  const f = await fixture(setup);
  if (name === 'deleted globalThis') assert.equal(vm.runInContext('typeof globalThis', f.context), 'undefined');
  f.values.set('wl_click_attribution', JSON.stringify(f.record));
  await assert.doesNotReject(f.api.waitForClickAttribution());
  assert.equal(f.api.attributionDenied(), true);
  // O3 (approved non-destructive missing verification): crypto-only failure = cannot establish a binding, NOT withdrawal.
  // Before: the unadmitted copy was erased. After: bytes preserved, no CLEAR/REVOKED; still denied (line above) and nothing sent (below).
  // 'deleted globalThis' also removes the monotonic clock, so the UNCHANGED permanently-unusable-clock rule still erases there.
  if (name === 'deleted globalThis') assert.equal(f.values.has('wl_click_attribution'), false);
  else assert.equal(f.values.get('wl_click_attribution'), JSON.stringify(f.record), 'stored bytes preserved');
  assert.equal(f.values.has('wl_click_attribution_clear_pending'), false); assert.equal(f.values.has('wl_click_attribution_revoked'), false);
  await assert.doesNotReject(f.api.clearPageAttribution(f.record));
  assert.equal(f.posts.length, 0, 'no malformed nonce or optional identifier leaves the worker');
  assert.equal(f.policyReads, 0);
  assert.equal(JSON.stringify(f.logs).includes('INERT_'), false, 'no identifier or thrown message is logged');
  // With a working clock, the closure must be caused by the crypto boundary itself.
  if (name !== 'deleted globalThis') assert.ok(f.logs.some(l => l.includes('"stage":"open"') && l.includes('CRYPTO_UNAVAILABLE')), 'crypto-caused closure');
});
