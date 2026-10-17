'use strict';
const { attributionOnly } = require(__dirname + '/support/privacy-bind-projection.cjs'); // O3 P2
// public-tracking-flags: real backend/publicFlags.web.js, real public/tracking.js
// + clickAttribution/adsPolicyProtocol/paidTouchState, and the actual Head/relay/
// worker graph (attribution-clock-v2 fixture). Offline only; network denied.
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../velo'), read = p => fs.readFileSync(path.join(root, p), 'utf8');
const KEY = 'wl_click_attribution', REVOKED = 'wl_click_attribution_revoked', DAY = 86400000;
const touch = (id, days = 0) => ({ capturedAt: new Date(Date.now() - days * DAY - 1000).toISOString(), gclid: id, gbraid: '', wbraid: '', msclkid: '' });
const record = (id, days = 0) => JSON.stringify({ v: 1, first: touch(id, days), latest: touch(id, days) });
const ENABLED = { ok: true, suspendGoogleAds: false }, SUSPENDED = { ok: true, suspendGoogleAds: true };
const tick = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; }

// ---------------- Server getter ----------------
async function server({ rows, throws, hang } = {}) {
  const queries = [], methods = [], timers = [];
  const wixData = { query(c) { const q = { c, eq: [], limit: null, opts: null }; queries.push(q);
    return { eq(k, v) { q.eq.push([k, v]); return this; }, limit(n) { q.limit = n; return this; },
      find(o) { q.opts = o; if (throws) return Promise.reject(new Error('INERT_READ_ERROR')); if (hang) return new Promise(() => {}); return Promise.resolve({ items: structuredClone(rows) }); } }; } }; // keeps NaN/Infinity/-0/undefined
  const context = vm.createContext({ setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; }, clearTimeout: t => { if (t) t.cleared = true; }, Promise });
  const ext = { 'wix-data': { default: wixData }, 'wix-web-module': { Permissions: { Anyone: 'ANYONE_SENTINEL', Admin: 'ADMIN' }, webMethod: (...args) => { methods.push(args); return args[1]; } } };
  const m = new vm.SourceTextModule(read('backend/publicFlags.web.js'), { context });
  await m.link(s => { assert.ok(ext[s], 'unexpected import ' + s); return new vm.SyntheticModule(Object.keys(ext[s]), function () { for (const k of Object.keys(ext[s])) this.setExport(k, ext[s][k]); }, { context }); });
  await m.evaluate();
  assert.deepEqual(Object.keys(m.namespace), ['getPublicTrackingFlags'], 'single export');
  return { fn: m.namespace.getPublicTrackingFlags, queries, methods, timers };
}
const row = value => ({ _id: 'x', key: 'suspendGoogleAds', value });
const HELD_JSON = JSON.stringify({ ok: false, suspendGoogleAds: true });

test('server: one Anyone webMethod, no cache option, exact single-key consistent read', async () => {
  const s = await server({ rows: [row('0')] });
  assert.equal(s.methods.length, 1); assert.equal(s.methods[0].length, 2, 'no webMethod options (no cache)'); assert.equal(s.methods[0][0], 'ANYONE_SENTINEL');
  assert.equal(JSON.stringify(await s.fn()), JSON.stringify(ENABLED));
  await s.fn();
  assert.equal(s.queries.length, 2, 'uncached: every call reads');
  const q = s.queries[0];
  assert.equal(q.c, 'Settings'); assert.equal(JSON.stringify(q.eq), JSON.stringify([['key', 'suspendGoogleAds']])); assert.equal(q.limit, 2);
  assert.equal(JSON.stringify(q.opts), JSON.stringify({ suppressAuth: true, consistentRead: true }));
  assert.equal(s.timers[0].ms, 2500); assert.equal(s.timers[0].cleared, true);
});

test('server: strict recognized values; everything else is ok:false + suspended; exact keys only', async () => {
  const cases = [
    ['0', ENABLED], [' 0 ', ENABLED], ['0\n', ENABLED], [0, ENABLED], [-0, ENABLED],
    ['1', SUSPENDED], [' 1\t', SUSPENDED], [1, SUSPENDED],
    ['', null], [' ', null], ['true', null], ['false', null], ['01', null], ['1.0', null], ['00', null], ['yes', null],
    [null, null], [undefined, null], [true, null], [false, null], [NaN, null], [Infinity, null], [-Infinity, null],
    [2, null], [0.5, null], [-1, null], [{}, null], [[], null], [['1'], null]
  ];
  for (const [value, want] of cases) {
    const s = await server({ rows: [row(value)] });
    const got = await s.fn();
    assert.equal(JSON.stringify(Object.keys(got)), '["ok","suspendGoogleAds"]', String(value));
    assert.equal(JSON.stringify(got), want ? JSON.stringify(want) : HELD_JSON, 'value ' + JSON.stringify(value));
  }
});

test('server: missing, duplicate, wrong key, read error and timeout all fail safe', async () => {
  for (const [name, opts] of Object.entries({
    missing: { rows: [] }, duplicate: { rows: [row('0'), row('0')] }, duplicateMixed: { rows: [row('0'), row('1')] },
    wrongKey: { rows: [{ _id: 'x', key: 'suspendgoogleads', value: '0' }] }, nullRow: { rows: [null] }, readError: { throws: true }
  })) { const s = await server(opts); assert.equal(JSON.stringify(await s.fn()), HELD_JSON, name); }
  const s = await server({ hang: true });
  const pending = s.fn(); await tick();
  assert.equal(s.timers[0].ms, 2500); s.timers[0].fn();
  assert.equal(JSON.stringify(await pending), HELD_JSON, 'timeout');
});

// ---------------- Client: real tracking + clickAttribution ----------------
async function client({ store = [], getter, rpc } = {}) {
  const timers = [], allPosts = [], rpcs = [], writes = [], handlers = [];
  const storage = new Map(store);
  const local = { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => { writes.push(['set', k]); storage.set(k, v); }, removeItem: k => { writes.push(['remove', k]); storage.delete(k); } };
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Date, performance: require('node:perf_hooks').performance, crypto: require('node:crypto').webcrypto,
    setTimeout: (fn, ms) => { const t = { fn, ms, done: false }; timers.push(t); return t; }, clearTimeout: t => { if (t) t.done = true; } });
  const ext = { 'wix-storage-frontend': { local }, 'wix-location-frontend': { default: { url: '', query: {} } },
    'backend/adsFormRequirement.web': { getAdsFormRequirement: async b => { rpcs.push(b); return rpc ? rpc(b) : null; } } };
  const cache = new Map();
  const load = s => {
    if (cache.has(s)) return cache.get(s);
    const e = ext[s]; let m;
    if (e) m = new vm.SyntheticModule(Object.keys(e), function () { for (const k of Object.keys(e)) this.setExport(k, e[k]); }, { context });
    else { assert.ok(s.startsWith('public/'), 'unexpected import ' + s); m = new vm.SourceTextModule(read(s + '.js'), { context }); }
    cache.set(s, m); return m;
  };
  const m = load('public/tracking'); await m.link(load); await m.evaluate();
  const api = m.namespace;
  const component = { onMessage: f => handlers.push(f), postMessage: d => allPosts.push(JSON.parse(JSON.stringify(d))) };
  const w = () => component;
  api.initTracking(w); api.initClickAttribution(w);
  const flagTimers = () => timers.filter(t => !t.done && t.ms === api.TRACKING_FLAG_TIMEOUT_MS);
  const deliver = d => handlers.forEach(f => f({ data: d }));
  // O3 P2: raw allPosts retained; posts projects out ONLY validated privacy-only binds.
  return { api, storage, writes, allPosts, get posts() { return attributionOnly(allPosts); }, rpcs, timers, flagTimers, getter, deliver };
}
const blockedEverything = async c => {
  c.api.pushDataLayer({ event: 'x' }); c.api.trackPurchase({ transactionId: 't', value: 1 });
  assert.equal(c.api.prepareAdsFormSubmission(), 0);
  assert.equal(c.api.getStoredClickIds(), null); assert.equal(c.api.getStoredClickIds(undefined, true), null);
  await c.api.waitForClickAttribution();
  assert.equal(c.posts.length, 0, 'no bridge/datalayer/attribution posts'); assert.equal(c.rpcs.length, 0, 'no policy RPC');
};

test('client: initial state is a NON-DESTRUCTIVE hold (no sends, no readiness, no storage writes)', async () => {
  const held = record('INERT_HELD');
  const c = await client({ store: [[KEY, held], [REVOKED, '1']] });
  assert.equal(c.api.trackingFlagState(), 'hold');
  await blockedEverything(c);
  assert.deepEqual(c.writes, [], 'hold never erases, revokes or writes');
  assert.equal(c.storage.get(KEY), held, 'stored bytes unchanged');
  assert.equal(c.storage.get(REVOKED), '1', 'revocation marker untouched (no revival)');
});

test('client: valid enabled releases the hold; valid suspended uses the existing destructive suspension (sticky)', async () => {
  const e = await client();
  assert.equal(await e.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
  e.api.pushDataLayer({ event: 'x' }); assert.equal(e.posts.filter(p => p.type === 'wbe-datalayer-event').length, 1);
  const s = await client({ store: [[KEY, record('INERT_SUSPEND')]] });
  assert.equal(await s.api.resolveTrackingFlags(async () => SUSPENDED), 'suspended');
  assert.equal(s.storage.has(KEY), false, 'real suspension erases (existing path)'); assert.equal(s.storage.get(REVOKED), '1');
  s.api.setSuspendGoogleAds(false);
  assert.equal(s.api.trackingFlagState(), 'suspended');
  await blockedEverything(s);
});

test('client: malformed, ok:false, rejection, sync throw and non-function getters keep the hold', async () => {
  const bad = [{ ok: false, suspendGoogleAds: true }, { ok: false, suspendGoogleAds: false }, { ok: true, suspendGoogleAds: 'false' }, { ok: true, suspendGoogleAds: 0 },
    { ok: true }, { suspendGoogleAds: false }, { ok: true, suspendGoogleAds: false, extra: 1 }, { ok: 'true', suspendGoogleAds: false }, null, undefined, [], 'enabled', 0, false];
  for (const r of bad) {
    const c = await client({ store: [[KEY, record('INERT')]] });
    assert.equal(await c.api.resolveTrackingFlags(async () => r), 'hold', JSON.stringify(r));
    await blockedEverything(c); assert.deepEqual(c.writes, []);
  }
  for (const g of [async () => { throw Error('x'); }, () => { throw Error('sync'); }, undefined, null, 'getter']) {
    const c = await client();
    assert.equal(await c.api.resolveTrackingFlags(g), 'hold'); await blockedEverything(c);
  }
});

test('client: bounded timeout holds; a late enable or late suspend after timeout is ignored entirely', async () => {
  for (const late of [ENABLED, SUSPENDED]) {
    const c = await client({ store: [[KEY, record('INERT_LATE')]] });
    assert.equal(c.api.TRACKING_FLAG_TIMEOUT_MS, 3000);
    const d = deferred(); const p = c.api.resolveTrackingFlags(() => d.promise);
    const [t] = c.flagTimers(); assert.ok(t); t.done = true; t.fn();
    assert.equal(await p, 'hold');
    d.resolve(late); await tick();
    assert.equal(c.api.trackingFlagState(), 'hold', 'late ' + JSON.stringify(late) + ' ignored');
    assert.deepEqual(c.writes, []); await blockedEverything(c);
  }
});

test('client precedence: sticky suspension over generation; current-generation-only enable', async () => {
  const run = async steps => {
    const c = await client(); const ds = {};
    for (const [op, name, value] of steps) {
      if (op === 'start') { ds[name] = deferred(); ds[name].p = c.api.resolveTrackingFlags(() => ds[name].promise); }
      else if (op === 'resolve') { ds[name].resolve(value); await ds[name].p; }
      else if (op === 'reject') { ds[name].reject(Error('x')); await ds[name].p; }
      await tick();
    }
    return c;
  };
  // older enabled after newer suspended -> suspended
  let c = await run([['start', 'g1'], ['start', 'g2'], ['resolve', 'g2', SUSPENDED], ['resolve', 'g1', ENABLED]]);
  assert.equal(c.api.trackingFlagState(), 'suspended');
  // newer enabled after an applied suspension -> still suspended (no session re-enable)
  c = await run([['start', 'g1'], ['resolve', 'g1', SUSPENDED], ['start', 'g2'], ['resolve', 'g2', ENABLED]]);
  assert.equal(c.api.trackingFlagState(), 'suspended');
  // stale (older-generation) suspension after newer enabled -> suspended
  c = await run([['start', 'g1'], ['start', 'g2'], ['resolve', 'g2', ENABLED], ['resolve', 'g1', SUSPENDED]]);
  assert.equal(c.api.trackingFlagState(), 'suspended');
  // older enabled while a newer read is pending -> discarded, held until current resolves
  c = await run([['start', 'g1'], ['start', 'g2'], ['resolve', 'g1', ENABLED]]);
  assert.equal(c.api.trackingFlagState(), 'hold');
  c = await run([['start', 'g1'], ['start', 'g2'], ['resolve', 'g1', ENABLED], ['resolve', 'g2', ENABLED]]);
  assert.equal(c.api.trackingFlagState(), 'enabled');
  // ok:false or rejection of any generation never enables and returns the hold
  c = await run([['start', 'g1'], ['start', 'g2'], ['resolve', 'g2', ENABLED], ['resolve', 'g1', { ok: false, suspendGoogleAds: true }]]);
  assert.equal(c.api.trackingFlagState(), 'hold');
  c = await run([['start', 'g1'], ['resolve', 'g1', ENABLED], ['start', 'g2'], ['reject', 'g2']]);
  assert.equal(c.api.trackingFlagState(), 'hold');
  // older rejection after a newer enabled result returns the hold
  c = await run([['start', 'g1'], ['start', 'g2'], ['resolve', 'g2', ENABLED], ['reject', 'g1']]);
  assert.equal(c.api.trackingFlagState(), 'hold');
  // legacy setter never releases the hold
  c = await client(); c.api.setSuspendGoogleAds(false); assert.equal(c.api.trackingFlagState(), 'hold'); await blockedEverything(c);
});

const HOLD_RESULT = { ok: false, suspendGoogleAds: true };
const adsPosts = (c, op) => c.posts.filter(p => p.type === 'wbe-ads-form' && p.op === op);
const ack = (c, start) => c.deliver({ type: 'wbe-ads-form-started', v: 2, sequence: start.sequence, phase: start.phase, nonce: start.nonce, challenge: 'a'.repeat(32) });
const policyFor = b => ({ ...b, observedAt: 0, policyKey: 'b'.repeat(64), requirement: 'NOT_REQUIRED' });

test('ads form: control (enabled) posts a prepare result; hold before the ACK stops before the policy RPC', async () => {
  const ctl = await client({ rpc: async b => policyFor(b) });
  await ctl.api.resolveTrackingFlags(async () => ENABLED);
  assert.ok(ctl.api.prepareAdsFormSubmission() > 0);
  ack(ctl, adsPosts(ctl, 'start')[0]); await tick(60);
  assert.equal(ctl.rpcs.length, 1); assert.equal(adsPosts(ctl, 'result').length, 1, 'control: enabled flow completes');
  const c = await client({ rpc: async b => policyFor(b) });
  await c.api.resolveTrackingFlags(async () => ENABLED);
  assert.ok(c.api.prepareAdsFormSubmission() > 0);
  const start = adsPosts(c, 'start')[0]; assert.ok(start);
  assert.equal(await c.api.resolveTrackingFlags(async () => HOLD_RESULT), 'hold');
  ack(c, start); await tick(60);
  assert.equal(c.rpcs.length, 0, 'no policy RPC after hold'); assert.equal(adsPosts(c, 'result').length, 0);
  assert.deepEqual(c.writes, [], 'hold wrote nothing');
});

test('ads form: hold applied while the policy RPC is in flight discards its valid result; completion after hold never starts', async () => {
  const pending = deferred();
  const c = await client({ rpc: () => pending.promise });
  await c.api.resolveTrackingFlags(async () => ENABLED);
  c.api.prepareAdsFormSubmission(); ack(c, adsPosts(c, 'start')[0]); await tick(60);
  assert.equal(c.rpcs.length, 1, 'RPC dispatched while enabled');
  assert.equal(await c.api.resolveTrackingFlags(async () => HOLD_RESULT), 'hold');
  pending.resolve(policyFor(c.rpcs[0])); await tick(60);
  assert.equal(adsPosts(c, 'result').length, 0, 'valid late policy not forwarded while held');
  // Completion continuation after a prepared policy, with hold applied before completion.
  const d = await client({ rpc: async b => policyFor(b) });
  await d.api.resolveTrackingFlags(async () => ENABLED);
  const seq = d.api.prepareAdsFormSubmission(); ack(d, adsPosts(d, 'start')[0]); await tick(60);
  assert.equal(adsPosts(d, 'result').length, 1);
  assert.equal(await d.api.resolveTrackingFlags(async () => HOLD_RESULT), 'hold');
  d.api.completeAdsFormSubmission(seq); await tick(60);
  assert.equal(adsPosts(d, 'start').filter(p => p.phase === 'complete').length, 0, 'no complete phase while held');
});

// ---------------- Option B / sec-bs2 readiness graph (actual Head + relay + worker) ----------------
const { fixture } = require('./attribution-clock-v2.cjs');
const workerOps = f => attributionOnly(f.trace.filter(t => t.edge === 'worker' && t.d && t.d.type === 'wbe-click-attribution').map(t => t.d)).map(d => d.op);

test('graph: held readiness performs no channel/read/confirm/erase; release then behaves exactly as never-held', { timeout: 10000 }, async () => {
  const opts = { pageStorage: [[KEY, record('INERT_PAGE', 2)]] };
  const base = await fixture(opts);
  let baseline;
  try { await base.api.waitForClickAttribution(); baseline = { ids: JSON.stringify(base.api.getStoredClickIds(undefined, true)), ops: workerOps(base), key: base.workerStorage.get(KEY) }; } finally { base.close(); }
  assert.ok(baseline.ids && baseline.ids !== 'null', 'baseline admits the page record');
  assert.ok(baseline.ops.length >= 3, 'baseline performed open/read/confirm');
  const f = await fixture({ ...opts, flagsHeld: true });
  try {
    const before = JSON.stringify([...f.workerStorage]);
    assert.equal(f.api.trackingFlagState(), 'hold');
    await f.api.waitForClickAttribution(); await f.settle();
    assert.deepEqual(workerOps(f), [], 'no open/read/confirm while held');
    assert.equal(f.counts().rpcs, 0, 'no policy RPC while held');
    assert.equal(JSON.stringify([...f.workerStorage]), before, 'worker storage untouched while held');
    assert.equal(f.api.getStoredClickIds(undefined, true), null);
    assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
    await f.api.waitForClickAttribution();
    assert.equal(JSON.stringify(f.api.getStoredClickIds(undefined, true)), baseline.ids, 'same admitted record as never-held');
    assert.deepEqual(workerOps(f), baseline.ops); assert.equal(f.workerStorage.get(KEY), baseline.key);
  } finally { f.close(); }
});

test('graph: expired worker copy held for the hold duration is not extended or revived on release', { timeout: 10000 }, async () => {
  const expired = record('INERT_EXPIRED', 91);
  const f = await fixture({ flagsHeld: true, workerStorage: [[KEY, expired]] });
  try {
    await f.api.waitForClickAttribution();
    assert.equal(f.workerStorage.get(KEY), expired, 'hold leaves bytes as-is (no lifetime refresh)');
    assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
    await f.api.waitForClickAttribution();
    const ids = f.api.getStoredClickIds(undefined, true);
    assert.equal(JSON.stringify(ids || null).indexOf('INERT_EXPIRED'), -1, 'expired touch never surfaces');
    assert.notEqual(f.workerStorage.get(KEY), expired, 'release readiness does not re-store the expired copy');
  } finally { f.close(); }
});

test('graph: withdrawal while held (no channel) -> IDs unreadable while held; release erases via Head denial', { timeout: 10000 }, async () => {
  const f = await fixture({ flagsHeld: true, pageStorage: [[KEY, record('INERT_WD', 1)]], workerStorage: [[KEY, record('INERT_WD', 1)]] });
  try {
    f.head.window.dataLayer.push(['consent', 'update', { ad_user_data: 'denied' }]); await f.settle();
    assert.equal(f.api.getStoredClickIds(undefined, true), null);
    assert.deepEqual(workerOps(f), []);
    assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
    await f.api.waitForClickAttribution(); await f.settle();
    assert.equal(f.api.getStoredClickIds(undefined, true), null, 'withdrawn IDs never admitted after release');
    assert.equal(f.workerStorage.has(KEY), false, 'worker copy erased on release readiness');
  } finally { f.close(); }
});

test('graph: withdrawal on a bound channel while returned to hold still revokes and erases', { timeout: 10000 }, async () => {
  const f = await fixture({ pageStorage: [[KEY, record('INERT_BOUND', 1)]] });
  try {
    await f.api.waitForClickAttribution();
    assert.ok(f.api.getStoredClickIds(undefined, true), 'admitted while enabled');
    assert.equal(await f.api.resolveTrackingFlags(async () => ({ ok: false, suspendGoogleAds: true })), 'hold');
    assert.equal(f.api.getStoredClickIds(undefined, true), null, 'held: unreadable');
    f.head.window.dataLayer.push(['consent', 'update', { ad_user_data: 'denied' }]); await f.settle();
    assert.equal(f.workerStorage.has(KEY), false, 'bound-channel revoke still erases while held');
    assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
    assert.equal(f.api.getStoredClickIds(undefined, true), null, 'no revival after release');
  } finally { f.close(); }
});

test('graph: snapshot taken while enabled -> null while held; hold fences its epoch (no revival on release), storage kept; fresh readiness re-admits', { timeout: 10000 }, async () => {
  const f = await fixture({ pageStorage: [[KEY, record('INERT_SNAP', 1)]] });
  try {
    await f.api.waitForClickAttribution();
    const snap = f.api.getStoredClickIds(undefined, true); assert.ok(snap && snap.gclid === 'INERT_SNAP');
    const bytes = JSON.stringify([...f.workerStorage]);
    assert.equal(await f.api.resolveTrackingFlags(async () => HOLD_RESULT), 'hold');
    assert.equal(f.api.getStoredClickIds(snap), null); assert.equal(f.api.getStoredClickIds(undefined, true), null);
    assert.equal(JSON.stringify([...f.workerStorage]), bytes, 'hold: no erase, no closePartition marker');
    assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
    assert.equal(f.api.getStoredClickIds(snap), null, 'pre-hold snapshot epoch is fenced: never revived');
    assert.equal(JSON.stringify([...f.workerStorage]), bytes, 'release alone writes nothing');
    await f.api.waitForClickAttribution();
    const fresh = f.api.getStoredClickIds(undefined, true);
    assert.ok(fresh && fresh.gclid === 'INERT_SNAP', 'no manufactured denial: fresh readiness re-admits the same record');
  } finally { f.close(); }
});

test('graph: empty (contact-only) snapshot from an empty admission is also unreadable while held', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.api.waitForClickAttribution();
    const empty = f.api.getStoredClickIds(undefined, true);
    assert.ok(empty && Object.keys(empty).length === 0, 'control: empty admission snapshot exists when enabled');
    assert.equal(f.api.getStoredClickIds(empty), empty);
    assert.equal(await f.api.resolveTrackingFlags(async () => HOLD_RESULT), 'hold');
    assert.equal(f.api.getStoredClickIds(empty), null, 'held: empty snapshot revalidation returns null');
    assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
    assert.equal(f.api.getStoredClickIds(empty), null, 'released: pre-hold empty snapshot stays fenced');
    await f.api.waitForClickAttribution();
    const again = f.api.getStoredClickIds(undefined, true);
    assert.ok(again && Object.keys(again).length === 0, 'fresh readiness re-admits empty (no manufactured denial)');
  } finally { f.close(); }
});

test('graph: hold never suppresses clearClickIds/clearPageAttribution: unscoped clear while held erases; pre-hold snapshot clear is a stale-epoch no-op (B4)', { timeout: 10000 }, async () => {
  const f = await fixture({ pageStorage: [[KEY, record('INERT_CLR', 1)]] });
  try {
    await f.api.waitForClickAttribution();
    const snap = f.api.getStoredClickIds(undefined, true); assert.ok(snap && snap.gclid === 'INERT_CLR');
    assert.ok(f.workerStorage.has(KEY));
    assert.equal(await f.api.resolveTrackingFlags(async () => HOLD_RESULT), 'hold');
    await f.api.clearClickIds(snap); await f.settle();
    assert.ok(f.workerStorage.has(KEY), 'pre-hold snapshot clear is a stale-epoch no-op (existing B4 rule)');
    await f.api.clearClickIds(); await f.settle();
    assert.equal(f.workerStorage.has(KEY), false, 'unscoped clear erases while held');
    assert.ok(workerOps(f).includes('clear'), 'clear reached the Head on the bound channel');
  } finally { f.close(); }
});

test('graph: hold applied mid-handshake (read delayed) fences the in-flight readiness: no store/admit, no revoke; fresh readiness after release equals never-held', { timeout: 10000 }, async () => {
  const opts = { pageStorage: [[KEY, record('INERT_MID', 1)]], requestDelay: d => d && d.op === 'read' ? 120 : 0 };
  const base = await fixture(opts); let baseline;
  try { await base.api.waitForClickAttribution(); baseline = { ids: JSON.stringify(base.api.getStoredClickIds(undefined, true)), bytes: JSON.stringify([...base.workerStorage]) }; } finally { base.close(); }
  const f = await fixture(opts);
  try {
    const startBytes = JSON.stringify([...f.workerStorage]);
    const ready = f.api.waitForClickAttribution();
    await new Promise(r => setTimeout(r, 40)); // read is in flight
    assert.ok(workerOps(f).includes('read'));
    assert.equal(await f.api.resolveTrackingFlags(async () => HOLD_RESULT), 'hold');
    await ready; await f.settle();
    assert.equal(f.api.getStoredClickIds(undefined, true), null, 'held: unreadable');
    assert.equal(JSON.stringify([...f.workerStorage]), startBytes, 'fenced: no store/admit, no revoke marker, no erase');
    assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
    assert.equal(f.api.getStoredClickIds(undefined, true), null, 'release alone admits nothing');
    await f.api.waitForClickAttribution();
    assert.equal(JSON.stringify(f.api.getStoredClickIds(undefined, true)), baseline.ids, 'fresh readiness equals never-held');
    assert.equal(JSON.stringify([...f.workerStorage]), baseline.bytes);
  } finally { f.close(); }
});

test('graph: withdrawal while the flag fetch is still unresolved -> never admitted; erased at first readiness after release', { timeout: 10000 }, async () => {
  const f = await fixture({ flagsHeld: true, pageStorage: [[KEY, record('INERT_PEND', 1)]], workerStorage: [[KEY, record('INERT_PEND', 1)]] });
  try {
    const flag = deferred(); const resolving = f.api.resolveTrackingFlags(() => flag.promise);
    f.head.window.dataLayer.push(['consent', 'update', { ad_user_data: 'denied' }]); await f.settle();
    assert.equal(f.api.trackingFlagState(), 'hold'); assert.deepEqual(workerOps(f), []);
    flag.resolve(ENABLED); assert.equal(await resolving, 'enabled');
    await f.api.waitForClickAttribution(); await f.settle();
    assert.equal(f.api.getStoredClickIds(undefined, true), null);
    assert.equal(f.workerStorage.has(KEY), false);
  } finally { f.close(); }
});

test('parent probe 1: a new read synchronously re-holds already-enabled consumers until it resolves', { timeout: 10000 }, async () => {
  const f = await fixture();
  let finish;
  try {
    const result = f.api.resolveTrackingFlags(() => new Promise(r => { finish = r; }));
    assert.equal(f.api.trackingFlagState(), 'hold', 'held before the getter settles');
    f.api.pushDataLayer({ event: 'x' }); assert.equal(f.api.getStoredClickIds(undefined, true), null);
    finish(ENABLED); assert.equal(await result, 'enabled');
  } finally { if (finish) finish(HOLD_RESULT); f.close(); }
});

test('parent probe 2: hold during a deferred policy read fences readiness before any worker store', { timeout: 10000 }, async () => {
  const base = await fixture({ pageStorage: [[KEY, record('INERT_PARENT', 0)]] });
  try { await base.api.waitForClickAttribution(); assert.ok(base.workerStorage.has(KEY), 'positive control admits'); } finally { base.close(); }
  let entered, release; const atRead = new Promise(r => { entered = r; }), gate = new Promise(r => { release = r; });
  const f = await fixture({ pageStorage: [[KEY, record('INERT_PARENT', 0)]], onRead: async () => { entered(); await gate; } });
  try {
    const ready = f.api.waitForClickAttribution(); await atRead;
    assert.equal(await f.api.resolveTrackingFlags(async () => HOLD_RESULT), 'hold');
    const before = f.workerStorage.get(KEY);
    release(); await ready; await f.settle();
    assert.equal(f.workerStorage.get(KEY), before, 'held continuation never stores/admits');
    assert.ok(!workerOps(f).includes('confirm'), 'no confirm after the fence');
  } finally { release(); f.close(); }
});

// ---------------- Actual Summary page: getter timeout keeps booking available ----------------
function adsFixture() {
  const file = path.join(__dirname, 'ads-custom-form.cjs'), source = fs.readFileSync(file, 'utf8');
  const box = { require, __dirname, __filename: file, console: { log() {}, warn() {}, error() {} }, process, setTimeout, clearTimeout, structuredClone, URL, Buffer };
  vm.runInNewContext(source.slice(0, source.indexOf('\n(async()=>{')) + '\nthis.fixture=fixture;', box);
  return box.fixture;
}
test('Summary page: getter times out -> booking still created, no click IDs, no AW handoff or purchase event', { timeout: 20000 }, async () => {
  const fixtureAds = adsFixture();
  const run = async held => {
    const x = await fixtureAds({ consent: 'yes', flagsHeld: held, stored: { [KEY]: record('INERT_STORED_G', 1) } });
    if (held) {
      const p = x.tracking.namespace.resolveTrackingFlags(() => new Promise(() => {}));
      assert.equal(await p, 'hold', 'real 3000 ms timeout keeps the hold');
    }
    await x.submit(); await x.settle();
    return x;
  };
  const enabled = await run(false), held = await run(true);
  assert.ok(enabled.p.payloads.length >= 1, 'control booking created');
  assert.equal(enabled.events().filter(e => e[1] === 'form_submit').length, 1, 'control: AW handoff when enabled');
  assert.equal(held.p.payloads.length, enabled.p.payloads.length, 'held: booking still created (hold is not a reservation gate)');
  assert.equal(held.events().filter(e => e[1] === 'form_submit').length, 0, 'held: no AW handoff');
  assert.equal(held.events().filter(e => e[1] === 'purchase').length, 0, 'held: no purchase event');
  assert.ok(JSON.stringify(enabled.p.payloads[0]).includes('INERT_STORED_G'), 'control: stored ID reaches the booking when enabled');
  assert.equal(JSON.stringify(held.p.payloads).includes('INERT_STORED_G'), false, 'held: no click ID or paid touch in any booking payload');
  for (const k of ['gclid', 'gbraid', 'wbraid', 'msclkid']) assert.ok(!held.p.payloads[0][k], 'held: empty ' + k);
});

test('Summary page: hold applied mid-Ads-form policy await -> booking still created, no AW handoff; enabled control hands off', { timeout: 20000 }, async () => {
  const fixtureAds = adsFixture();
  const run = async hold => {
    let x = null, applied = 0;
    x = await fixtureAds({ consent: 'yes', policyRead: async () => {
      if (hold && x) { applied++; await x.tracking.namespace.resolveTrackingFlags(async () => HOLD_RESULT); }
    } });
    await x.submit(); await x.settle();
    return { x, applied };
  };
  const ctl = await run(false), held = await run(true);
  assert.equal(ctl.x.events().filter(e => e[1] === 'form_submit').length, 1, 'control handoff');
  assert.ok(held.applied >= 1, 'hold applied during the form policy await');
  assert.equal(held.x.tracking.namespace.trackingFlagState(), 'hold');
  assert.equal(held.x.p.payloads.length, ctl.x.p.payloads.length, 'booking still created');
  assert.equal(held.x.events().filter(e => e[1] === 'form_submit').length, 0, 'no AW handoff after hold');
  assert.equal(held.x.events().filter(e => e[1] === 'purchase').length, 0, 'no purchase event after hold');
});

// ---------------- Static adapter checks ----------------
test('static: adapters use the getter only for the suspend flag; Summary fee/tax untouched; no legacy setter calls', () => {
  const master = read('masterPage.js'), search = read('page-booking-search.js'), summary = read('page-booking-summary.js');
  for (const [n, s] of [['master', master], ['search', search], ['summary', summary]]) {
    assert.match(s, /import \{ getPublicTrackingFlags \} from 'backend\/publicFlags\.web';/, n);
    assert.match(s, /resolveTrackingFlags\(getPublicTrackingFlags\)/, n);
    assert.equal(/setSuspendGoogleAds\(/.test(s), false, n + ' never calls the legacy setter');
    assert.equal(/settings\.suspendGoogleAds/.test(s), false, n + ' never reads the dictionary flag');
    assert.equal(/from 'public\/clickAttribution'/.test(s), false, n + ' uses tracking wrappers only');
  }
  assert.equal(/backend\/settings/.test(master) || /backend\/settings/.test(search), false, 'master/search no longer import backend/settings');
  // Portable snapshot of the exact historical fee/tax lines, not this candidate.
  const frozen = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/summary-fee-tax-baseline.json'), 'utf8')).lines.join('\n');
  const fee = s => s.split(/\r?\n/).filter(l => /propertyFeeRate|taxRate_|getAllSettings\(\)/.test(l)).join('\n');
  assert.equal(fee(summary), fee(frozen), 'fee/tax display and its Settings read unchanged');
  const click = summary.slice(summary.indexOf('initClickAttribution($w);\n'.replace('\n', '')), summary.indexOf('att = getStoredClickIds(undefined, true);'));
  assert.ok(click.indexOf('await _trackingFlags;') > 0 && click.indexOf('await _trackingFlags;') < click.indexOf('await waitForClickAttribution();'), 'Summary click awaits the bounded flag result before readiness');
  const m = master.slice(master.indexOf('async function initBrowserTracking'));
  assert.ok(m.indexOf('initClickAttribution($w);') < m.indexOf('await resolveTrackingFlags'), 'listeners bound before the await');
  assert.ok(m.indexOf("if (flags !== 'enabled') return;") < m.indexOf('waitForClickAttribution()'), 'no readiness unless enabled');
});
