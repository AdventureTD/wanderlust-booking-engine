'use strict';
// Lazy REVOKED initialization (approved minimal fix for the master-page-ssr #27
// import-time SDK storage read). Actual clickAttribution + adsPolicyProtocol +
// paidTouchState modules; only wix-storage-frontend and the backend web method
// are inert boundaries. Oracle: an unscoped clear erases KEY (and writes
// REVOKED) only when the partition is OPEN at first use; when the partition is
// CLOSED (REVOKED marker present, or storage throws) it is a no-op for KEY.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const read = p => fs.readFileSync(path.join(__dirname, '../velo/public', p), 'utf8');
const KEY = 'wl_click_attribution', CLEAR = 'wl_click_attribution_clear_pending', REVOKED = 'wl_click_attribution_revoked';

function sharedStorage(seed = {}) {
  const m = new Map(Object.entries(seed)), calls = [];
  let throwing = false;
  const failKeys = new Set(); // per-key read failure (KEY vs REVOKED distinguished)
  return {
    m, calls, failKeys,
    set throwing(v) { throwing = v; },
    local: {
      getItem(k) { calls.push(['get', k]); if (throwing || failKeys.has(k)) throw Error('STORAGE_DENIED'); return m.has(k) ? m.get(k) : null; },
      setItem(k, v) { calls.push(['set', k]); if (throwing) throw Error('STORAGE_DENIED'); m.set(k, String(v)); },
      removeItem(k) { calls.push(['remove', k]); if (throwing) throw Error('STORAGE_DENIED'); m.delete(k); }
    }
  };
}
// Each call is a fresh module realm (a separate bundle copy / Velo realm).
async function load(storage) {
  const context = vm.createContext({ setTimeout, clearTimeout, console: { log() {}, error() {} }, globalThis: { crypto: webcrypto, performance } });
  const ext = {
    'wix-storage-frontend': { local: storage.local },
    'backend/adsFormRequirement.web': { getAdsFormRequirement: async () => { throw Error('NO_BACKEND'); } }
  };
  const src = { 'public/clickAttribution': read('clickAttribution.js'), 'public/adsPolicyProtocol': read('adsPolicyProtocol.js'), 'public/paidTouchState': read('paidTouchState.js') };
  const cache = new Map();
  const make = id => {
    if (cache.has(id)) return cache.get(id);
    let m;
    if (ext[id]) { const e = ext[id]; m = new vm.SyntheticModule(Object.keys(e), function () { for (const k of Object.keys(e)) this.setExport(k, e[k]); }, { context }); }
    else if (src[id]) m = new vm.SourceTextModule(src[id], { context, identifier: id });
    else throw Error('unexpected import ' + id);
    cache.set(id, m); return m;
  };
  const root = make('public/clickAttribution');
  await root.link(make); await root.evaluate();
  return root.namespace;
}
const touch = (gclid, at = new Date().toISOString()) => ({ capturedAt: at, gclid, gbraid: '', wbraid: '', msclkid: '' });
const recordBytes = gclid => { const t = touch(gclid); return JSON.stringify({ v: 1, first: t, latest: t }); };
const revokedReads = s => s.calls.filter(c => c[0] === 'get' && c[1] === REVOKED).length;
const noComponent = () => null; // no bridge component: no channel, no posts

test('SSR import closure: module evaluation performs zero storage calls (even with throwing storage)', async () => {
  const s = sharedStorage({ [REVOKED]: '1', [KEY]: recordBytes('INERT_SSR') }); s.throwing = true;
  await load(s);
  assert.deepEqual(s.calls, []);
});

test('positive control: open partition at first use -> unscoped clear erases KEY and writes REVOKED', async () => {
  const s = sharedStorage({ [KEY]: recordBytes('INERT_OPEN') });
  const ca = await load(s);
  assert.equal(revokedReads(s), 0, 'not read at import');
  await ca.clearPageAttribution();
  assert.equal(revokedReads(s), 1, 'read once at first use');
  assert.equal(s.m.has(KEY), false); assert.equal(s.m.get(REVOKED), '1'); assert.ok(s.m.has(CLEAR));
});

test('REVOKED present before first use -> closed: unscoped clear is a KEY no-op (eager-equivalent)', async () => {
  const bytes = recordBytes('INERT_CLOSED');
  const s = sharedStorage({ [REVOKED]: '1', [KEY]: bytes });
  const ca = await load(s);
  await ca.clearPageAttribution();
  assert.equal(s.m.get(KEY), bytes); assert.equal(s.m.has(CLEAR), false);
});

test('throwing storage at first use stays fail-closed, no throw; recovery later does not reopen', async () => {
  const bytes = recordBytes('INERT_THROW');
  const s = sharedStorage({ [KEY]: bytes }); s.throwing = true;
  const ca = await load(s);
  ca.initClickAttribution(noComponent); // first browser entry latches closed
  s.throwing = false;
  await ca.clearPageAttribution();
  assert.equal(s.m.get(KEY), bytes, 'closed partition never erases unadmitted bytes');
});

test('synchronous early entry latches start-of-use state: later marker add/remove does not flip it', async () => {
  // open at init; marker added afterwards -> still open (latched)
  const a = sharedStorage({ [KEY]: recordBytes('INERT_LATCH_OPEN') });
  const ca = await load(a);
  ca.initClickAttribution(noComponent);
  a.m.set(REVOKED, '1');
  await ca.clearPageAttribution();
  assert.equal(a.m.has(KEY), false, 'latched open at first entry');
  // closed at init; marker removed afterwards -> still closed
  const bytes = recordBytes('INERT_LATCH_CLOSED');
  const b = sharedStorage({ [REVOKED]: '1', [KEY]: bytes });
  const cb = await load(b);
  cb.initClickAttribution(noComponent);
  b.m.delete(REVOKED);
  await cb.clearPageAttribution();
  assert.equal(b.m.get(KEY), bytes, 'latched closed at first entry');
});

test('re-initialization and repeated entries read REVOKED exactly once per realm', async () => {
  const s = sharedStorage({ [REVOKED]: '1' });
  const ca = await load(s);
  ca.initClickAttribution(noComponent); ca.initClickAttribution(noComponent);
  await ca.clearPageAttribution(); await ca.waitForClickAttribution();
  assert.equal(revokedReads(s), 1);
});

test('waitForClickAttribution before any bridge (no component) performs no storage IO; later first use still latches closed', async () => {
  const bytes = recordBytes('INERT_WAIT');
  const s = sharedStorage({ [REVOKED]: '1', [KEY]: bytes });
  const ca = await load(s);
  await ca.waitForClickAttribution();
  assert.deepEqual(s.calls, [], 'no component: returns before any storage access');
  await ca.clearPageAttribution();
  assert.equal(revokedReads(s), 1); assert.equal(s.m.get(KEY), bytes);
});

test('shared storage, two copies: each realm latches independently at its own first use', async () => {
  const bytes = recordBytes('INERT_SHARED');
  const s = sharedStorage({ [KEY]: bytes });
  const a = await load(s), b = await load(s);
  b.initClickAttribution(noComponent); // B latches OPEN
  await a.clearPageAttribution();      // A first use: OPEN -> erases, writes REVOKED
  assert.equal(s.m.has(KEY), false); assert.equal(s.m.get(REVOKED), '1');
  const c = await load(s);             // later copy: imports while REVOKED present
  s.m.set(KEY, bytes);
  await c.clearPageAttribution();      // C latches CLOSED
  assert.equal(s.m.get(KEY), bytes);
});

test('documented divergence window (import -> first use): marker set in the window -> closed (stricter); removed in the window -> open, reconciliation only (no admission)', async () => {
  const bytes = recordBytes('INERT_WINDOW');
  const s1 = sharedStorage({ [KEY]: bytes });
  const c1 = await load(s1); s1.m.set(REVOKED, '1');
  await c1.clearPageAttribution();
  assert.equal(s1.m.get(KEY), bytes, 'eager would have been open; lazy is closed (stricter)');
  const s2 = sharedStorage({ [REVOKED]: '1', [KEY]: bytes });
  const c2 = await load(s2); s2.m.delete(REVOKED); // e.g. another copy's authenticated admission in the window
  assert.equal(c2.attributionStorageAdmitted(bytes), false, 'never admitted without its own bound Head confirm');
  assert.equal(c2.attributionDenied(), true);
  await c2.clearPageAttribution();
  assert.equal(s2.m.has(KEY), false, 'lazy is open in this window: unscoped clear may reconcile (erase), never admit');
});

// Reviewer-reproduced path (r2): direct first-use clear BEFORE init, storage failing, then recovery.
// Sticky rule: a failure while establishing the start-of-use revocation state latches CLOSED for the realm.
test('r2: all storage throws on direct first-use clear -> recovery -> clear: stays closed, KEY preserved', async () => {
  const bytes = recordBytes('INERT_R2_ALL');
  const s = sharedStorage({ [KEY]: bytes }); s.throwing = true;
  const ca = await load(s);
  await ca.clearPageAttribution();
  s.throwing = false;
  await ca.clearPageAttribution();
  assert.equal(s.m.get(KEY), bytes, 'previously unadmitted KEY never erased after recovery');
  assert.equal(s.m.has(CLEAR), false); assert.equal(s.m.has(REVOKED), false);
  assert.equal(revokedReads(s), 1, 'latched by the first (failed) attempt; no re-read after recovery');
  assert.equal(ca.attributionDenied(), true); assert.equal(ca.attributionStorageAdmitted(bytes), false);
});
test('r2: KEY read throws, REVOKED present and readable -> closed; recovery -> clear preserves KEY', async () => {
  const bytes = recordBytes('INERT_R2_KEY_CLOSED');
  const s = sharedStorage({ [REVOKED]: '1', [KEY]: bytes }); s.failKeys.add(KEY);
  const ca = await load(s);
  await ca.clearPageAttribution();
  s.failKeys.clear();
  await ca.clearPageAttribution();
  assert.equal(s.m.get(KEY), bytes); assert.equal(revokedReads(s), 1);
});
test('r2: REVOKED read throws, KEY readable -> closed (fail-closed) and KEY preserved after recovery', async () => {
  const bytes = recordBytes('INERT_R2_REV_THROW');
  const s = sharedStorage({ [KEY]: bytes }); s.failKeys.add(REVOKED);
  const ca = await load(s);
  await ca.clearPageAttribution();
  assert.equal(s.m.get(KEY), bytes, 'closed while REVOKED unreadable');
  s.failKeys.clear();
  await ca.clearPageAttribution();
  assert.equal(s.m.get(KEY), bytes, 'sticky closed after recovery'); assert.equal(revokedReads(s), 1);
});
test('r2 eager-equivalent (disclosed): REVOKED absent and readable, only KEY read throws -> OPEN latch; recovery -> clear erases (same as O3 eager)', async () => {
  const bytes = recordBytes('INERT_R2_KEY_OPEN');
  const s = sharedStorage({ [KEY]: bytes }); s.failKeys.add(KEY);
  const ca = await load(s);
  await ca.clearPageAttribution();
  assert.equal(s.m.get(KEY), bytes, 'KEY unreadable: nothing to compare, nothing erased');
  s.failKeys.clear();
  await ca.clearPageAttribution();
  assert.equal(s.m.has(KEY), false); assert.equal(s.m.get(REVOKED), '1'); assert.equal(revokedReads(s), 1);
});
test('r2 positive control: direct first-use clear with healthy storage erases and latches once', async () => {
  const s = sharedStorage({ [KEY]: recordBytes('INERT_R2_OK') });
  const ca = await load(s);
  await ca.clearPageAttribution(); await ca.clearPageAttribution();
  assert.equal(s.m.has(KEY), false); assert.equal(revokedReads(s), 1);
});
