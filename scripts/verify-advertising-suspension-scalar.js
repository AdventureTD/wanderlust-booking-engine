'use strict';
// node --experimental-vm-modules scripts/verify-advertising-suspension-scalar.js
// Only settings.web.js is evaluated. SDK stubs cannot load other backends.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sourcePath = path.resolve(__dirname, '../velo/backend/settings.web.js');
const source = fs.readFileSync(sourcePath, 'utf8');
async function load(read) {
  const trace = [];
  const registrations = [];
  const anyone = Symbol('Anyone');
  const context = vm.createContext({});
  const sdk = new Proxy({ query(collection) {
    trace.push('query'); assert.equal(collection, 'Settings');
    return { limit(n) {
      trace.push('limit'); assert.equal(n, 1000);
      return { async find(options) {
        trace.push('find');
        assert.equal(options.suppressAuth, true);
        assert.equal(options.consistentRead, true);
        assert.deepEqual(Object.keys(options).sort(), ['consistentRead', 'suppressAuth']);
        return read();
      } };
    } };
  } }, { get(target, key) {
    if (!(key in target)) { trace.push('FORBIDDEN:' + String(key)); throw Error('forbidden SDK operation'); }
    return target[key];
  } });
  const stubs = {
    'wix-data': { default: sdk },
    'wix-web-module': { Permissions: { Anyone: anyone }, webMethod(...args) {
      const [permission, callback] = args;
      const wrapped = async (...input) => callback(...input);
      registrations.push({ permission, callback, wrapped, args });
      return wrapped;
    } }
  };
  const mod = new vm.SourceTextModule(source, { context, identifier: sourcePath });
  for (const dependency of mod.dependencySpecifiers) {
    assert.ok(Object.hasOwn(stubs, dependency), 'unauthorized dependency: ' + dependency);
  }
  await mod.link(specifier => {
    assert.ok(Object.hasOwn(stubs, specifier));
    const values = stubs[specifier];
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await mod.evaluate();
  return { api: mod.namespace, trace, registrations, anyone };
}
const cases = [];
function test(id, fn) { cases.push({ id, fn }); }
const row = (value, key = 'suspendGoogleAds', id = 'target') => ({ _id: id, key, value });
const page = (items, totalCount = items.length) => ({ items, totalCount, hasNext() { return false; } });
test('P1-01-public-endpoint-registration', async () => {
  const h = await load(() => page([row(0)]));
  assert.equal(typeof h.api.getAdvertisingSuspension, 'function', 'missing public scalar endpoint');
  assert.equal(h.registrations.length, 1, 'only scalar becomes public');
  const registration = h.registrations[0];
  assert.equal(registration.permission, h.anyone);
  assert.equal(registration.args.length, 2, 'no cache options');
  assert.equal(registration.callback, h.api.observeAdvertisingSuspension, 'reuse actual observer');
  assert.equal(registration.wrapped, h.api.getAdvertisingSuspension);
  assert.equal(await h.api.getAdvertisingSuspension('suspendGoogleAds'), 0);
  assert.deepEqual(h.trace, ['query', 'limit', 'find']);
});
// These additional cases characterize the unchanged observer through the new
// registered endpoint (baseline-GREEN coverage, not additional production REDs).
const invalidKeys = [undefined, null, false, true, 0, 1, '', 'Settings', 'invoiceNumber',
  'suspendgoogleads', ' suspendGoogleAds', 'suspendGoogleAds ', 'suspendGoogleAds\u0000',
  ['suspendGoogleAds'], new String('suspendGoogleAds'), {}, 1n, Symbol('key'),
  { toString() { throw Error('must not coerce'); } }];
invalidKeys.forEach((key, index) => test('P1-02-invalid-key-' + index, async () => {
  const h = await load(() => { throw Error('must not read'); });
  assert.equal(await h.api.getAdvertisingSuspension(key), null);
  assert.deepEqual(h.trace, [], 'invalid keys require zero SDK calls');
}));
for (const key of ['suspendGoogleAds', 'suspendMicrosoftAds']) {
  for (const [label, value, expected] of [
    ['zero', 0, 0], ['one', 1, 1], ['string-zero', ' 0 ', 0], ['string-one', '\t1\n', 1],
    ['null', null, null], ['undefined', undefined, null], ['false', false, null],
    ['true', true, null], ['empty', '', null], ['blank', ' ', null], ['two', 2, null],
    ['nan', NaN, null], ['infinity', Infinity, null], ['array', [0], null],
    ['object', {}, null], ['boxed', new Number(0), null], ['double-zero', '00', null]
  ]) test(`P1-03-${key}-${label}`, async () => {
    const h = await load(() => page([row(value, key)]));
    assert.equal(await h.api.getAdvertisingSuspension(key), expected);
    assert.deepEqual(h.trace, ['query', 'limit', 'find']);
  });
}
const malformed = [
  ['missing-target', () => page([{ _id: 'private', key: 'privateOther', value: 'PRIVATE' }])],
  ['empty', () => page([])], ['missing-page', () => null],
  ['missing-total', () => ({ items: [row(0)], hasNext() { return false; } })],
  ['negative-total', () => page([], -1)], ['fraction-total', () => page([], 1.5)],
  ['incomplete-count', () => page([row(0)], 2)], ['excess-count', () => page([row(0)], 0)],
  ['duplicate-key', () => page([row(0), row(0, 'suspendGoogleAds', 'second')])],
  ['conflicting-key', () => page([row(0), row(1, 'suspendGoogleAds', 'second')])],
  ['duplicate-id', () => page([row(0), row(0, 'privateOther')])],
  ['blank-id', () => page([row(0, 'suspendGoogleAds', ' ')])],
  ['inherited-id', () => page([Object.assign(Object.create({ _id: 'target' }), { key: 'suspendGoogleAds', value: 0 })])],
  ['accessor-value', () => page([{ _id: 'target', key: 'suspendGoogleAds', get value() { throw Error('PRIVATE'); } }])],
  ['bad-items', () => ({ items: {}, totalCount: 1, hasNext() { return false; } })],
  ['missing-hasNext', () => ({ items: [row(0)], totalCount: 1 })],
  ['nonboolean-hasNext', () => ({ ...page([row(0)]), hasNext() { return 0; } })],
  ['hasNext-error', () => ({ ...page([row(0)]), hasNext() { throw Error('PRIVATE'); } })],
  ['read-error', () => { throw Error('PRIVATE SETTINGS FAILURE'); }],
  ['empty-progress', () => ({ ...page([], 2), hasNext() { return true; }, next() { throw Error('must not advance'); } })],
  ['missing-next', () => ({ ...page([row(0)], 2), hasNext() { return true; } })],
  ['next-error', () => ({ ...page([row(0)], 2), hasNext() { return true; }, next() { throw Error('PRIVATE'); } })],
  ['changed-total', () => ({ ...page([row(0)], 2), hasNext() { return true; }, next() { return page([row(1, 'other', 'other')], 3); } })],
  ['duplicate-later-key', () => ({ ...page([row(0)], 2), hasNext() { return true; }, next() { return page([row(0, 'suspendGoogleAds', 'later')], 2); } })],
  ['duplicate-later-id', () => ({ ...page([row(0)], 2), hasNext() { return true; }, next() { return page([row(0, 'other')], 2); } })]
];
for (const [label, fixture] of malformed) test('P1-04-' + label, async () => {
  const h = await load(fixture);
  const result = await h.api.getAdvertisingSuspension('suspendGoogleAds');
  assert.equal(result, null, 'no private data/error returned');
  assert.equal(JSON.stringify(result), 'null');
  assert.ok(!h.trace.some(x => x.startsWith('FORBIDDEN:')));
});
for (const value of [0, 1]) test('P1-05-target-beyond-first-page-' + value, async () => {
  let nextCalls = 0;
  const items = Array.from({ length: 1000 }, (_, i) => row('PRIVATE', 'private-' + i, 'id-' + i));
  const h = await load(() => ({ ...page(items, 1001), hasNext() { return true; },
    next() { nextCalls++; return page([row(value)], 1001); } }));
  assert.equal(await h.api.getAdvertisingSuspension('suspendGoogleAds'), value);
  assert.equal(nextCalls, 1);
  assert.deepEqual(h.trace, ['query', 'limit', 'find']);
});
test('P1-06-no-cache-new-ON-and-failure', async () => {
  let state = 0;
  const h = await load(() => { if (state === null) throw Error('PRIVATE'); return page([row(state)]); });
  assert.equal(await h.api.getAdvertisingSuspension('suspendGoogleAds'), 0);
  state = 1;
  assert.equal(await h.api.getAdvertisingSuspension('suspendGoogleAds'), 1);
  state = null;
  assert.equal(await h.api.getAdvertisingSuspension('suspendGoogleAds'), null);
  assert.deepEqual(h.trace, ['query', 'limit', 'find', 'query', 'limit', 'find', 'query', 'limit', 'find']);
});
(async () => {
  console.log('SOURCE_SHA256 ' + crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'));
  const completed = [];
  for (const { id, fn } of cases) {
    try { await fn(); completed.push(id); console.log('PASS ' + id); }
    catch (error) { console.error('FAIL ' + id); console.error(error); console.log(JSON.stringify({ completed, failed: id })); process.exitCode = 1; return; }
  }
  assert.equal(new Set(completed).size, cases.length);
  console.log(JSON.stringify({ completed, count: completed.length, failed: 0 }));
})();
