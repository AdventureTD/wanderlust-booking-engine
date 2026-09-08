'use strict';
// Run: node --experimental-vm-modules scripts/verify-advertising-suspension-failclosed.js
// Actual web modules + actual settings reader; all other imports are inert.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const graph = {
  'googleAdsConversions.web.js': ['wix-web-module', 'wix-secrets-backend', 'backend/dataManagerClient.web', 'backend/hashUtils.web', 'backend/settings.web', 'wix-data'],
  'microsoftAdsConversions.web.js': ['wix-web-module', 'wix-secrets-backend', 'wix-fetch', 'wix-data', 'backend/settings.web', 'backend/hashUtils.web'],
  'settings.web.js': ['wix-data']
};
async function load(provider, setting) {
  const trace = { sends: [], secrets: [], writes: [], queries: [] };
  const summary = { _id: 'fixture', bookingNumber: 'fixture', grandTotal: 125, gclid: 'fixture-click', msclkid: 'fixture-click', status: 'Confirmed' };
  const snapshot = { ...summary };
  const context = vm.createContext({ console: { log() {}, error() {} }, URLSearchParams });
  const sdk = {
    query(collection) {
      trace.queries.push(collection);
      const q = { eq() { return q; }, limit() { return q; }, async find() {
        if (collection === 'Settings') {
          if (setting === 'reject') throw new Error('inert settings failure');
          if (setting === 'malformed-page') return {};
          if (typeof setting === 'function') return setting(trace);
          const items = setting === 'missing' ? [] : [{ _id: 'g', key: 'suspendGoogleAds', value: setting }, { _id: 'm', key: 'suspendMicrosoftAds', value: setting }];
          return { items, totalCount: items.length, hasNext() { return false; } };
        }
        assert.equal(collection, 'BookingSummary');
        return { items: [summary] };
      } };
      return q;
    },
    async update(collection, value) { trace.writes.push(collection); assert.equal(collection, 'BookingSummary'); return value; }
  };
  const inert = {
    'wix-web-module': { Permissions: { Anyone: 'Anyone', Admin: 'Admin' }, webMethod(permission, fn) { fn.permission = permission; return fn; } },
    'wix-secrets-backend': { async getSecret(key) { trace.secrets.push(key); return 'inert-public-fixture'; } },
    'wix-data': { default: sdk },
    'backend/hashUtils.web': { buildUserIdentifiers() { return []; } },
    'backend/dataManagerClient.web': { async ingestEvent(payload) { trace.sends.push({ kind: 'conversion', payload }); return { ok: true }; } },
    'wix-fetch': { async fetch(url, options) {
      const auth = url.includes('login.microsoftonline.com');
      trace.sends.push({ kind: auth ? 'auth' : 'conversion', payload: JSON.parse(auth ? '{}' : options.body) });
      return { ok: true, async text() { return auth ? '{"access_token":"inert-token","expires_in":3600}' : '{}'; } }; } }
  };
  const cache = new Map();
  async function actual(file) {
    if (cache.has(file)) return cache.get(file);
    assert.ok(Object.hasOwn(graph, file), 'unexpected actual module');
    const mod = new vm.SourceTextModule(fs.readFileSync(path.join(root, 'velo/backend', file), 'utf8'), { context, identifier: file });
    assert.deepEqual(Array.from(mod.dependencySpecifiers), graph[file], 'exact import closure');
    cache.set(file, mod);
    await mod.link(async (specifier) => {
      if (specifier === 'backend/settings.web') return actual('settings.web.js');
      assert.ok(Object.hasOwn(inert, specifier), 'unexpected import: ' + specifier);
      const values = inert[specifier];
      return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
    });
    return mod;
  }
  const mod = await actual(provider + 'AdsConversions.web.js');
  await mod.evaluate();
  return { api: mod.namespace, settings: cache.get('settings.web.js').namespace, trace, summary, snapshot };
}
const cases = [];
function test(id, fn) { cases.push({ id, fn }); }
const booking = { transactionId: 'fixture', value: 125, currency: 'USD', gclid: 'fixture-click', msclkid: 'fixture-click', conversionTime: '2026-01-01T00:00:00Z' };
for (const provider of ['google', 'microsoft']) {
  for (const operation of ['record', 'retry']) {
    const name = operation + (provider === 'microsoft' ? 'Microsoft' : '') + 'BookingConversion';
    for (const [label, value, permitted] of [
      ['read-rejection', 'reject', false], ['malformed-page', 'malformed-page', false],
      ['missing', 'missing', false], ['null', null, false], ['blank', '', false],
      ['garbage', 'unknown', false], ['boolean', false, false], ['other-number', 2, false],
      ['array-zero', [0], false], ['object', {}, false],
      ['one-number', 1, false], ['one-string', ' 1 ', false],
      ['zero-number', 0, true], ['zero-string', ' 0 ', true]
    ]) test(`${provider}/${operation}/${label}`, async () => {
      const { api, trace, summary, snapshot } = await load(provider, value);
      assert.equal(api[name].permission, operation === 'record' ? 'Anyone' : 'Admin');
      const result = await api[name](operation === 'record' ? { ...booking } : 'fixture');
      if (!permitted) {
        assert.equal(trace.sends.length, 0, 'denial must precede all outbound requests');
        assert.equal(result.ok, false);
        assert.equal(trace.secrets.length, 0);
        assert.deepEqual(trace.writes, []);
        assert.deepEqual(trace.queries, ['Settings']);
        assert.deepEqual(summary, snapshot, 'inert confirmed summary unchanged; not full booking-flow evidence');
      } else {
        assert.equal(result.ok, true);
        assert.equal(trace.sends.filter(x => x.kind === 'conversion').length, 1);
        assert.equal(summary.status, 'Confirmed');
        assert.deepEqual(trace.writes, operation === 'retry' ? ['BookingSummary'] : []);
      }
    });
  }
}
// A zero on an incomplete first page is not permission.
for (const provider of ['google', 'microsoft']) for (const operation of ['record', 'retry']) {
  test(`${provider}/${operation}/strict-incomplete-zero`, async () => {
    const key = provider === 'google' ? 'suspendGoogleAds' : 'suspendMicrosoftAds';
    const { api, trace, summary, snapshot } = await load(provider, () => ({
      items: [{ _id: 'target', key, value: 0 }], totalCount: 2, hasNext() { return false; }
    }));
    const name = operation + (provider === 'microsoft' ? 'Microsoft' : '') + 'BookingConversion';
    const result = await api[name](operation === 'record' ? { ...booking } : 'fixture');
    assert.equal(trace.sends.length, 0, 'incomplete zero must not authorize outbound');
    assert.equal(result.ok, false);
    assert.deepEqual(trace.secrets, []);
    assert.deepEqual(trace.writes, []);
    assert.deepEqual(trace.queries, ['Settings']);
    assert.deepEqual(summary, snapshot);
  });
}
// Actual reader protocol and real record/retry consumers over inert SDK pages.
function observationFixture(mode, key, trace) {
  const row = { _id: 'target', key, value: 0 };
  const other = { _id: 'other', key: 'unrelated', value: 'not-an-ad-setting' };
  const page = (items, totalCount, more = false) => ({ items, totalCount, hasNext() { return more; } });
  let first = page([row], 1);
  if (mode === 'one') row.value = 1;
  if (mode === 'missing') first = page([other], 1);
  if (mode === 'duplicate-same' || mode === 'duplicate-conflict') first = page([{ ...row, _id: 'duplicate', value: mode === 'duplicate-same' ? 0 : 1 }, row], 2);
  if (mode === 'inherited-value') first.items = [Object.assign(Object.create({ value: 0 }), { _id: 'target', key })];
  if (mode === 'getter-value') Object.defineProperty(row, 'value', { get() { throw Error('accessor must not run'); } });
  if (mode === 'inherited-items') first = Object.assign(Object.create({ items: [row] }), { totalCount: 1, hasNext() { return false; } });
  if (mode === 'bad-key') first.items.push({ _id: 'bad', key: null });
  if (mode === 'bad-id') row._id = '';
  if (mode === 'missing-total') delete first.totalCount;
  if (mode === 'string-total') first.totalCount = '1';
  if (mode === 'negative-total') first.totalCount = -1;
  if (mode === 'unsafe-total') first.totalCount = Number.MAX_SAFE_INTEGER + 1;
  if (mode === 'overflow') first.totalCount = 0;
  if (mode === 'missing-hasNext') delete first.hasNext;
  if (mode === 'nonboolean-hasNext') first.hasNext = () => 'false';
  if (mode === 'throw-hasNext') first.hasNext = () => { throw Error('inert hasNext failure'); };
  if (mode === 'contradictory-more') first.hasNext = () => true;
  if (mode === 'oversize-page') first = page(Array.from({ length: 1001 }, (_, i) => ({ ...other, _id: String(i) })), 1001);
  if (mode.startsWith('pages-')) {
    first = page([row], 2, true);
    let second = page([other], 2);
    if (mode === 'pages-target-late') { first.items = [other]; second.items = [row]; }
    if (mode === 'pages-missing') { first.items = [other]; second.items = [{ ...other, _id: 'other2' }]; }
    if (mode === 'pages-duplicate-same' || mode === 'pages-duplicate-conflict') second.items = [{ ...row, _id: 'duplicate', value: mode.endsWith('conflict') ? 1 : 0 }];
    if (mode === 'pages-repeat') second = first;
    if (mode === 'pages-empty') second.items = [];
    if (mode === 'pages-changing-total') second.totalCount = 3;
    if (mode === 'pages-extra') second.items.push({ ...other, _id: 'extra' });
    if (mode === 'pages-malformed') second = {};
    if (mode === 'pages-no-progress') { first.items = []; }
    first.next = async () => {
      trace.pages = (trace.pages || 0) + 1;
      assert.ok(trace.pages <= 3, 'reader must terminate repeated pages');
      if (mode === 'pages-reject') throw Error('inert next failure');
      return second;
    };
    if (mode === 'pages-missing-next') delete first.next;
  }
  if (mode === 'beyond-first-thousand') {
    first = page(Array.from({ length: 1000 }, (_, i) => ({ ...other, _id: String(i) })), 1001, true);
    first.next = async () => { trace.pages = (trace.pages || 0) + 1; return page([row], 1001); };
  }
  return first;
}
const observationModes = ['zero', 'one', 'missing', 'duplicate-same', 'duplicate-conflict', 'inherited-value', 'getter-value', 'inherited-items', 'bad-key', 'bad-id', 'missing-total', 'string-total', 'negative-total', 'unsafe-total', 'overflow', 'missing-hasNext', 'nonboolean-hasNext', 'throw-hasNext', 'contradictory-more', 'oversize-page', 'pages-complete', 'pages-target-late', 'pages-missing', 'pages-duplicate-same', 'pages-duplicate-conflict', 'pages-repeat', 'pages-empty', 'pages-changing-total', 'pages-extra', 'pages-malformed', 'pages-no-progress', 'pages-reject', 'pages-missing-next', 'beyond-first-thousand'];
for (const provider of ['google', 'microsoft']) for (const mode of observationModes) {
  const key = provider === 'google' ? 'suspendGoogleAds' : 'suspendMicrosoftAds';
  const expected = ['zero', 'inherited-items', 'pages-complete', 'pages-target-late', 'beyond-first-thousand'].includes(mode) ? 0 : mode === 'one' ? 1 : null;
  test(`${provider}/reader/${mode}`, async () => {
    const { settings, trace } = await load(provider, t => observationFixture(mode, key, t));
    assert.equal(await settings.observeAdvertisingSuspension(key), expected);
    assert.deepEqual(trace.sends, []);
    assert.deepEqual(trace.secrets, []);
    assert.deepEqual(trace.writes, []);
    if (expected === 0 && mode.startsWith('pages-') || mode === 'beyond-first-thousand') assert.equal(trace.pages, 1);
  });
  for (const operation of ['record', 'retry']) test(`${provider}/${operation}/observation-${mode}`, async () => {
    const { api, trace, summary, snapshot } = await load(provider, t => observationFixture(mode, key, t));
    const name = operation + (provider === 'microsoft' ? 'Microsoft' : '') + 'BookingConversion';
    const result = await api[name](operation === 'record' ? { ...booking } : 'fixture');
    assert.equal(result.ok, expected === 0);
    if (expected === 0) {
      assert.equal(trace.sends.filter(x => x.kind === 'conversion').length, 1);
      if (mode.startsWith('pages-') || mode === 'beyond-first-thousand') assert.equal(trace.pages, 1, 'must traverse before permission');
    } else {
      assert.deepEqual(trace.sends, [], 'unresolved observation must deny all outbound');
      assert.deepEqual(trace.secrets, []);
      assert.deepEqual(trace.writes, []);
      assert.deepEqual(trace.queries, ['Settings']);
      assert.deepEqual(summary, snapshot);
    }
  });
}
test('reader/unsupported-key-no-io', async () => {
  const { settings, trace } = await load('google', 0);
  for (const key of ['privateSetting', '__proto__', null, ['suspendGoogleAds']]) assert.equal(await settings.observeAdvertisingSuspension(key), null);
  assert.deepEqual(trace.queries, []);
  assert.equal(settings.observeAdvertisingSuspension.permission, undefined, 'plain backend export, not public webMethod');
});
test('reader/legacy-map-semantics-preserved', async () => {
  const { settings, trace } = await load('google', t => observationFixture('duplicate-conflict', 'suspendGoogleAds', t));
  assert.equal((await settings.getAllSettings()).suspendGoogleAds, 0, 'legacy map still overwrites duplicate');
  assert.equal(trace.pages, undefined);
});
// Legacy adjustment semantics are deliberately separate from positive purchases.
for (const value of [0, 1, 'reject']) for (const type of ['RETRACTION', 'RESTATEMENT']) {
  test(`google/adjust/${type}/${value}`, async () => {
    const { api, trace } = await load('google', value);
    assert.equal(api.adjustBookingConversion.permission, 'Admin');
    assert.equal(await api.isGoogleAdsSuspended(), value === 1);
    const result = await api.adjustBookingConversion({ ...booking, adjustmentType: type, newValue: 75 });
    assert.equal(result.ok, value !== 1);
    assert.equal(trace.sends.length, value === 1 ? 0 : 1);
    if (value !== 1) assert.equal(trace.sends[0].payload.events[0].eventName, type === 'RETRACTION' ? 'purchase_retraction' : 'purchase_adjustment');
    assert.deepEqual(trace.writes, []);
  });
}
(async () => {
  const results = [];
  for (const { id, fn } of cases) {
    try { await fn(); results.push({ id, passed: true }); }
    catch (err) { results.push({ id, passed: false, error: String(err.stack) }); }
  }
  assert.equal(new Set(results.map(x => x.id)).size, cases.length);
  console.log(JSON.stringify({ results, total: results.length, failed: results.filter(x => !x.passed).length }, null, 2));
  process.exitCode = results.some(x => !x.passed) ? 1 : 0;
})().catch(err => { console.error(err); process.exitCode = 1; });
