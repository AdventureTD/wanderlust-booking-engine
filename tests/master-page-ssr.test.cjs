'use strict';
// Actual masterPage ESM; inert Wix/public boundaries, no network or provider IO.
// Run: node --experimental-vm-modules --test tests/master-page-ssr.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../velo/masterPage.js'), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('onReady remained blocked by handshake')), 500);
    })]);
  } finally { clearTimeout(timer); }
}
async function fixture(options = {}) {
  const calls = [], errors = [];
  let ready;
  const w = () => { calls.push('component'); throw new Error('unexpected element access'); };
  w.onReady = fn => { assert.equal(ready, undefined); ready = fn; };
  const context = vm.createContext({ $w: w, console: { log() {}, error(...args) { errors.push(args); } } });
  const invoke = (name, fallback) => (...args) => {
    calls.push(name);
    return Object.hasOwn(options, name) ? options[name](...args) : fallback?.(...args);
  };
  const consentPolicy = {
    getCurrentConsentPolicy: invoke('consent', () => Promise.resolve({ policy: {} })),
    onConsentPolicyChanged: invoke('watch')
  };
  const rendering = Object.hasOwn(options, 'rendering') ? options.rendering : { env: options.env ?? 'browser' };
  const modules = {
    'wix-window-frontend': { default: { rendering }, consentPolicy },
    'backend/settings': { getAllSettings: invoke('settings', () => Promise.resolve({})) },
    'public/tracking': {
      setSuspendGoogleAds: invoke('suspend', value => { calls.push(value); }),
      initTracking: invoke('tracking'), initClickAttribution: invoke('attribution'),
      waitForClickAttribution: invoke('wait', () => Promise.resolve()),
      captureClickIds: invoke('capture')
    }
  };
  const master = new vm.SourceTextModule(source, { context });
  await master.link(specifier => {
    assert.ok(Object.hasOwn(modules, specifier), `unexpected import ${specifier}`);
    const exports = modules[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await master.evaluate();
  assert.equal(typeof ready, 'function');
  assert.deepEqual(calls, [], 'evaluation must only register onReady');
  return { ready, calls, errors };
}

test('server onReady returns before settings, tracking or consent', async () => {
  const f = await fixture({ env: 'backend' });
  await bounded(f.ready());
  assert.deepEqual(f.calls, [], 'SSR must not query settings or initialize tracking/consent');
});

test('pending handshake does not hold onReady or consent; capture waits for resolution', async () => {
  const gate = deferred();
  const f = await fixture({ wait: () => gate.promise });
  try {
    await bounded(f.ready());
    assert.ok(f.calls.includes('wait'));
    assert.ok(f.calls.includes('consent'));
    assert.ok(f.calls.includes('watch'));
    assert.ok(!f.calls.includes('capture'));
    gate.resolve();
    await turn();
    assert.equal(f.calls.filter(x => x === 'capture').length, 1);
    assert.ok(f.calls.indexOf('consent') < f.calls.indexOf('capture'));
    assert.deepEqual(f.errors, []);
  } finally { gate.resolve(); await turn(); }
});

for (const env of ['unknown', '', undefined, null]) {
  test(`non-browser environment ${String(env)} fails closed`, async () => {
    const f = await fixture({ rendering: { env }, settings: () => { throw new Error('must not call'); } });
    await bounded(f.ready());
    assert.deepEqual(f.calls, []);
  });
}
test('missing rendering fails closed inside outer catch', async () => {
  const f = await fixture({ rendering: undefined });
  await bounded(f.ready());
  assert.deepEqual(f.calls, []);
  assert.equal(f.errors.length, 1);
});
test('server skips even a synchronously throwing imported settings function', async () => {
  const f = await fixture({ env: 'backend', settings: () => { throw new Error('SDK unavailable'); } });
  await bounded(f.ready());
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.errors, []);
});
for (const value of [1, '1']) {
  test(`browser forwards suspended setting ${JSON.stringify(value)} before tracking`, async () => {
    const f = await fixture({ settings: async () => ({ suspendGoogleAds: value }) });
    await bounded(f.ready()); await turn();
    assert.deepEqual(f.calls.slice(0, 5), ['settings', 'suspend', true, 'tracking', 'attribution']);
    assert.equal(f.calls.filter(x => x === 'capture').length, 1);
    assert.deepEqual(f.errors, []);
  });
}
for (const sync of [false, true]) {
  test(`settings ${sync ? 'throw' : 'rejection'} preserves existing fallback`, async () => {
    const f = await fixture({ settings: () => {
      if (sync) throw new Error('settings failed');
      return Promise.reject(new Error('settings failed'));
    } });
    await bounded(f.ready()); await turn();
    assert.deepEqual(f.calls.slice(0, 5), ['settings', 'suspend', false, 'tracking', 'attribution']);
    assert.ok(f.calls.includes('consent'));
    assert.ok(f.calls.includes('capture'));
    assert.deepEqual(f.errors, []);
  });
}
test('browser still waits for settings before initialization', async () => {
  const gate = deferred();
  const f = await fixture({ settings: () => gate.promise });
  let done = false;
  const result = f.ready().then(() => { done = true; });
  try {
    await turn();
    assert.equal(done, false);
    assert.deepEqual(f.calls, ['settings']);
    gate.resolve({ suspendGoogleAds: '1' });
    await bounded(result); await turn();
    assert.deepEqual(f.calls.slice(0, 5), ['settings', 'suspend', true, 'tracking', 'attribution']);
  } finally { gate.resolve({}); await bounded(result); }
});
for (const phase of ['wait', 'capture']) for (const sync of [false, true]) {
  test(`${phase} ${sync ? 'throw' : 'rejection'} is contained without unhandled rejection`, async () => {
    const unhandled = [];
    const listener = error => unhandled.push(error);
    process.on('unhandledRejection', listener);
    const gate = deferred();
    const failure = new Error(`${phase} failed`);
    const options = { wait: () => gate.promise };
    options[phase] = () => { if (sync) throw failure; return Promise.reject(failure); };
    try {
      const f = await fixture(options);
      await bounded(f.ready());
      assert.ok(f.calls.includes('consent'));
      gate.resolve();
      await turn(); await turn();
      assert.equal(f.errors.length, 1);
      assert.equal(f.errors[0][1], failure.message);
      assert.equal(f.calls.includes('capture'), phase === 'capture');
      assert.deepEqual(unhandled, []);
    } finally { gate.resolve(); process.removeListener('unhandledRejection', listener); }
  });
}
test('late handshake rejection does not capture and leaves consent initialized', async () => {
  const gate = deferred();
  const f = await fixture({ wait: () => gate.promise });
  try {
    await bounded(f.ready());
    assert.ok(f.calls.includes('watch'));
    gate.reject(new Error('late handshake failure'));
    await turn(); await turn();
    assert.ok(!f.calls.includes('capture'));
    assert.equal(f.errors.length, 1);
  } finally { gate.resolve(); }
});

test('actual public import closure has no evaluation or SSR SDK effects', async () => {
  const calls = [];
  const deny = name => () => { calls.push(name); throw new Error(`forbidden ${name}`); };
  let ready;
  const w = deny('component');
  w.onReady = fn => { ready = fn; };
  const context = vm.createContext({ $w: w, console: { log: deny('log'), error: deny('error') },
    setTimeout: deny('timer'), clearTimeout: deny('clearTimer') });
  const sdk = {
    'wix-window-frontend': { default: { rendering: { env: 'backend' } },
      consentPolicy: { getCurrentConsentPolicy: deny('consent') } },
    'wix-storage-frontend': { local: { getItem: deny('storage'), setItem: deny('storage'), removeItem: deny('storage') } },
    'wix-location-frontend': { default: new Proxy({}, { get: deny('location') }) },
    'backend/adsFormRequirement.web': { getAdsFormRequirement: deny('policy RPC') },
    'wix-data': { default: new Proxy({}, { get: deny('data') }) }
  };
  // Read the real settings source too; production frontend uses Wix's RPC boundary.
  const files = { master: 'masterPage.js', 'public/tracking': 'public/tracking.js',
    'public/clickAttribution': 'public/clickAttribution.js', 'backend/settings': 'backend/settings.web.js' };
  const cache = new Map();
  function load(id) {
    if (cache.has(id)) return cache.get(id);
    assert.ok(Object.hasOwn(sdk, id) || Object.hasOwn(files, id), `unexpected import ${id}`);
    const values = sdk[id];
    const module = values ? new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context }) : new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '../velo', files[id]), 'utf8'), { context });
    cache.set(id, module);
    return module;
  }
  const master = load('master');
  await master.link(load); await master.evaluate();
  assert.deepEqual(calls, []);
  assert.equal(typeof ready, 'function');
  await bounded(ready());
  assert.deepEqual(calls, []);
  assert.ok(cache.has('public/clickAttribution'));
  assert.ok(cache.has('backend/settings'));
});
