'use strict';
// ESLint is a separately pinned test tool; no Wix runtime dependency is added.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { Linter } = require('eslint');
const source = fs.readFileSync(path.join(__dirname, '../velo/public/clickAttribution.js'), 'utf8');
const config = {
  parserOptions: { ecmaVersion: 2019, sourceType: 'module' },
  env: { es6: true },
  globals: { setTimeout: 'readonly', clearTimeout: 'readonly' },
  rules: { 'no-undef': ['error', { typeof: true }], 'no-global-assign': 'error' }
};
test('legacy global inventory accepts actual module without weakening no-undef', () => {
  const lint = new Linter();
  assert.deepEqual(lint.verify(source, config), []);
  assert.ok(lint.verify(source + '\nmissingCompatSentinel();', config).some(x => x.ruleId === 'no-undef'));
  assert.ok(lint.verify(source + '\nglobalThis = {};', config).some(x => x.ruleId === 'no-global-assign'));
  const stripped = source.replace(/\/\* global globalThis:readonly \*\//, '');
  assert.ok(lint.verify(stripped, config).some(x => x.ruleId === 'no-undef' && x.message.includes('globalThis')));
});
async function fixture(setup = '', crypto = webcrypto) {
  const values = new Map(), posts = [];
  let handler, policyReads = 0;
  const record = { capturedAt: new Date().toISOString(), gclid: 'INERT_COMPAT', gbraid: '', wbraid: '', msclkid: '' };
  const context = vm.createContext({ crypto, setTimeout, clearTimeout });
  assert.equal(Object.hasOwn(context, 'globalThis'), false, 'do not inject a host globalThis object');
  vm.runInContext(setup, context);
  const external = {
    'wix-storage-frontend': { local: { getItem: k => values.get(k) || null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) } },
    'backend/adsFormRequirement.web': { getAdsFormRequirement: async () => { policyReads++; return { v:1, requirement:'NOT_REQUIRED', policyKey:'a'.repeat(64), observedAt:Date.now() }; } }
  };
  const module = new vm.SourceTextModule(source, { context });
  await module.link(s => new vm.SyntheticModule(Object.keys(external[s]), function () {
    for (const [k,v] of Object.entries(external[s])) this.setExport(k,v);
  }, { context }));
  await module.evaluate();
  const api = module.namespace;
  api.initClickAttribution(() => ({ onMessage: f => { handler = f; }, postMessage: d => {
    posts.push(d);
    // Inert authenticated-channel peer, not a real iframe/provider.
    handler({ data: { type:'wbe-click-attribution-result', v:1, op:d.op, sequence:d.sequence, nonce:d.nonce,
      channel:'b'.repeat(32), allowed:true, record:d.op === 'clear' ? null : record } });
  } }));
  return { api, values, posts, record, context, get policyReads() { return policyReads; } };
}
test('native VM global and real Web Crypto produce valid fresh nonce and optional IDs', async () => {
  const f = await fixture();
  await f.api.waitForClickAttribution();
  assert.equal(f.api.attributionDenied(), false);
  assert.equal(JSON.parse(f.values.get('wl_click_attribution')).gclid, 'INERT_COMPAT');
  const first = f.posts[0].nonce;
  assert.match(first, /^[a-f0-9]{32}$/);
  await f.api.waitForClickAttribution();
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
  assert.equal(f.values.has('wl_click_attribution'), false);
  await assert.doesNotReject(f.api.clearPageAttribution(f.record));
  assert.equal(f.posts.length, 0, 'no malformed nonce or optional identifier leaves the worker');
  assert.equal(f.policyReads, 0);
});
