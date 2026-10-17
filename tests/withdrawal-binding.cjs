'use strict';
// Withdrawal-safe privacy binding: actual Head (source + packed) -> relay iframe -> worker graph.
// Offline only; network denied by the fixture. Run:
//   node.exe --experimental-vm-modules tests/withdrawal-binding.cjs </dev/null
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./attribution-clock-v2.cjs');
const KEY = 'wl_click_attribution', CLEAR = 'wl_click_attribution_clear_pending', REVOKED = 'wl_click_attribution_revoked', DAY = 86400000;
const touch = (id, days = 1) => ({ capturedAt: new Date(Date.now() - days * DAY - 1000).toISOString(), gclid: id, gbraid: '', wbraid: '', msclkid: '' });
const rec = (id, days = 1) => JSON.stringify({ v: 1, first: touch(id, days), latest: touch(id, days) });
const ENABLED = { ok: true, suspendGoogleAds: false };
const workerOps = f => f.trace.filter(t => t.edge === 'worker' && t.d && t.d.type === 'wbe-click-attribution').map(t => t.d.op);
const revokes = f => f.trace.filter(t => t.edge === 'ack' && t.d && t.d.type === 'wbe-click-revoke');
const withdraw = f => f.head.window.dataLayer.push(['consent', 'update', { ad_user_data: 'denied' }]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const READINESS = ['open', 'read', 'confirm'];

for (const packed of [false, true]) {
  const P = packed ? ' [packed]' : ' [source]';
  const fx = o => fixture({ packed, ...o });

  test('W1 initial denial: held copy binds and erases its mirror without flags, readiness or capture' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true, denied: true, workerStorage: [[KEY, rec('INERT_W1')]] });
    try {
      await f.settle();
      assert.equal(f.api.trackingFlagState(), 'hold');
      assert.equal(f.workerStorage.has(KEY), false, 'mirror erased while held');
      assert.equal(f.workerStorage.get(REVOKED), '1', 'worker partition closed by the Head-authorized revoke');
      assert.deepEqual(workerOps(f).filter(o => READINESS.includes(o)), [], 'no readiness/open/read/confirm');
      assert.equal(f.counts().rpcs, 0); assert.equal(f.counts().externalCalls, 0);
      assert.equal(f.api.getStoredClickIds(undefined, true), null);
    } finally { f.close(); }
  });

  test('W2 withdrawal while the flag fetch is pending erases while held' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true, pageStorage: [[KEY, rec('INERT_W2')]], workerStorage: [[KEY, rec('INERT_W2')]] });
    try {
      let done; const pending = f.api.resolveTrackingFlags(() => new Promise(r => { done = r; }));
      await f.settle();
      assert.ok(f.workerStorage.has(KEY), 'positive control: binding alone never deletes');
      withdraw(f); await f.settle();
      assert.equal(f.api.trackingFlagState(), 'hold');
      assert.equal(f.workerStorage.has(KEY), false, 'erased while still held');
      assert.equal(f.storage.has(KEY), false, 'Head erased the page copy');
      assert.deepEqual(workerOps(f).filter(o => READINESS.includes(o)), []);
      done(ENABLED); await pending; await f.api.waitForClickAttribution(); await f.settle();
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'no resurrection after release');
      assert.equal(f.workerStorage.has(KEY), false);
    } finally { f.close(); }
  });

  test('W3a enabled copy whose readiness never runs still erases on later withdrawal' + P, { timeout: 10000 }, async () => {
    const f = await fx({ workerStorage: [[KEY, rec('INERT_W3A')]] });
    try {
      await f.settle();
      assert.equal(f.api.trackingFlagState(), 'enabled');
      assert.deepEqual(workerOps(f).filter(o => READINESS.includes(o)), [], 'readiness never ran');
      withdraw(f); await f.settle();
      assert.equal(f.workerStorage.has(KEY), false);
    } finally { f.close(); }
  });

  test('W3b failed handshake (open dropped) then later withdrawal: copy still notified and partition closed' + P, { timeout: 10000 }, async () => {
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W3B')]], requestDelay: d => d && d.op === 'open' ? 5000 : 0 });
    try {
      await f.api.waitForClickAttribution().catch(() => {});
      await sleep(700);
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'handshake failed: nothing admitted');
      f.workerStorage.set(KEY, rec('INERT_W3B_LATER_COPY')); // e.g. written by another copy afterwards
      withdraw(f); await f.settle();
      assert.equal(f.workerStorage.has(KEY), false, 'later withdrawal still erases');
      assert.equal(f.workerStorage.get(REVOKED), '1');
    } finally { f.close(); }
  });

  test('W4 stale/forged notifications: wrong nonce or unbound channel never erases; destroyed/replaced frame handled' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true, workerStorage: [[KEY, rec('INERT_W4')]] });
    try {
      await f.settle();
      // Forge through the relay: a revoke with a random nonce/channel (no binding owns it).
      const forged = { type: 'wbe-click-revoke', v: 2, schema: 1, nonce: 'a'.repeat(32), channel: 'b'.repeat(32) };
      f.relayToWorker(forged); await f.settle();
      assert.ok(f.workerStorage.has(KEY), 'unbound nonce ignored');
      assert.equal(f.workerStorage.has(REVOKED), false);
      // Destroyed frame: Head notifications to a detached frame must not throw or block other bindings.
      f.detachFrame(); withdraw(f); await f.settle();
      assert.ok(f.workerStorage.has(KEY), 'liveness limit: no transport, no erase (safety: still unreadable while held)');
      assert.equal(f.api.getStoredClickIds(undefined, true), null);
    } finally { f.close(); }
  });

  test('W5 shared storage: another copy mid-readiness (confirm delayed) cannot resurrect after withdrawal' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true, pageStorage: [[KEY, rec('INERT_W5')]], requestDelay: d => d && d.op === 'confirm' ? 120 : 0 });
    try {
      const b = await f.copy({ enabled: true });
      const ready = b.api.waitForClickAttribution();
      await sleep(40);
      assert.ok(workerOps(f).includes('confirm'), 'copy B confirm in flight');
      withdraw(f); await f.settle();
      await ready; await sleep(300); await f.settle();
      assert.equal(f.workerStorage.has(KEY), false, 'no resurrection by the delayed confirm');
      assert.equal(b.api.getStoredClickIds(undefined, true), null);
      assert.equal(f.api.getStoredClickIds(undefined, true), null);
    } finally { f.close(); }
  });

  test('W6 separate storage model: every bound copy erases its own partition' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true, workerStorage: [[KEY, rec('INERT_W6A')]] });
    try {
      const b = await f.copy({ separateStorage: true, storage: [[KEY, rec('INERT_W6B')]] });
      await f.settle();
      withdraw(f); await f.settle();
      assert.equal(f.workerStorage.has(KEY), false, 'copy A partition erased');
      assert.equal(b.storage.has(KEY), false, 'copy B partition erased');
    } finally { f.close(); }
  });

  test('W7 positive controls: no withdrawal -> hold keeps mirror; binding reads/admits nothing; enabled readiness unchanged' + P, { timeout: 10000 }, async () => {
    const base = await fixture({ packed, pageStorage: [[KEY, rec('INERT_W7')]] });
    let baseline;
    try { await base.api.waitForClickAttribution(); baseline = JSON.stringify(base.api.getStoredClickIds(undefined, true)); } finally { base.close(); }
    const f = await fx({ flagsHeld: true, pageStorage: [[KEY, rec('INERT_W7')]], workerStorage: [[KEY, rec('INERT_W7_OLD', 3)]] });
    try {
      const bytes = JSON.stringify([...f.workerStorage]);
      await f.settle();
      assert.equal(JSON.stringify([...f.workerStorage]), bytes, 'hold + binding never deletes or writes');
      assert.equal(revokes(f).length, 0, 'granted Head sends nothing to the binding (no grant/consent signal)');
      assert.equal(f.api.getStoredClickIds(undefined, true), null);
      assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
      await f.api.waitForClickAttribution();
      assert.ok(f.api.getStoredClickIds(undefined, true), 'enabled readiness still admits');
      assert.ok(baseline && baseline !== 'null');
    } finally { f.close(); }
  });

  test('W8 regrant after withdrawal never restores; repeated withdrawal idempotent' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true, pageStorage: [[KEY, rec('INERT_W8')]], workerStorage: [[KEY, rec('INERT_W8')]] });
    try {
      withdraw(f); await f.settle(); withdraw(f); await f.settle();
      assert.equal(f.workerStorage.has(KEY), false);
      f.head.window.dataLayer.push(['consent', 'update', { ad_user_data: 'granted' }]); await f.settle();
      assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
      await f.api.waitForClickAttribution(); await f.settle();
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'Google grant never re-establishes provenance');
    } finally { f.close(); }
  });

  test('W9 single-slot channel: copy B admitted, copy A re-opens (replaces B channel), withdrawal still revokes B (separate storage)' + P, { timeout: 10000 }, async () => {
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W9')]] });
    try {
      const b = await f.copy({ enabled: true, separateStorage: true });
      await b.api.waitForClickAttribution();
      assert.ok(b.api.getStoredClickIds(undefined, true), 'B admitted on its own channel');
      await f.api.waitForClickAttribution(); // A's open replaces the Head's single channel slot
      assert.ok(f.api.getStoredClickIds(undefined, true), 'A admitted');
      withdraw(f); await f.settle();
      assert.equal(b.api.getStoredClickIds(undefined, true), null, 'B no longer serves IDs after withdrawal');
      assert.equal(b.storage.has(KEY), false, 'B partition erased');
      assert.equal(f.api.getStoredClickIds(undefined, true), null);
    } finally { f.close(); }
  });

  test('W10 Head ignores bind from a non-bridge frame/origin; relay rejects malformed bind envelopes' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true, denied: true, workerStorage: [[KEY, rec('INERT_W10')]] });
    try {
      const before = revokes(f).length;
      const n = 'c'.repeat(32), bind = { source: 'wbe-click-attribution', v: 2, schema: 1, op: 'bind', sequence: 1, nonce: n, channel: 'f'.repeat(32), policy: null, record: null };
      const forgedFrame = [], wrongOrigin = [];
      f.toHead(bind, { postMessage: d => forgedFrame.push(d) }, 'https://inert.filesusr.com'); // wrong source window
      f.toHead(bind, undefined, 'https://evil.invalid');  // wrong origin, real frame
      withdraw(f); await f.settle();
      assert.equal(forgedFrame.length, 0, 'forged frame never registered or notified');
      assert.equal(revokes(f).filter(r => r.d.nonce === n).length, 0, 'unauthenticated bind never registered');
      for (const bad of [{ record: JSON.parse(rec('X')) }, { sequence: 0 }, { channel: '' }, { policy: {} }]) {
        f.relayFromWorker({ type: 'wbe-click-attribution', v: 2, schema: 1, op: 'bind', sequence: 1, nonce: 'e'.repeat(32), channel: '9'.repeat(32), policy: null, record: null, ...bad });
      }
      await f.settle();
      assert.equal(revokes(f).filter(r => r.d.nonce === 'e'.repeat(32)).length, 0, 'relay drops malformed bind');
      assert.ok(revokes(f).length >= before);
    } finally { f.close(); }
  });

  test('W11 bind carries no attribution: Head never answers a bind with records or results; trace shows only revoke on denial' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true, pageStorage: [[KEY, rec('INERT_W11')]] });
    try {
      await f.settle();
      const results = f.trace.filter(t => t.edge === 'ack' && t.d && t.d.type === 'wbe-click-attribution-result');
      assert.equal(results.length, 0, 'no result envelope for bind');
      const binds = f.trace.filter(t => t.edge === 'worker' && t.d && t.d.op === 'bind');
      assert.equal(binds.length, 1); assert.equal(binds[0].d.record, null); assert.equal(binds[0].d.policy, null);
    } finally { f.close(); }
  });

  test('W12 explicit denial already in the dataLayer before the Head loads (init-time revoke path) still notifies later bindings' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true, priorDataLayer: [['consent', 'update', { ad_user_data: 'denied' }]], workerStorage: [[KEY, rec('INERT_W12')]] });
    try {
      await f.settle();
      assert.equal(f.workerStorage.has(KEY), false, 'bind after an init-time denial is answered with a revoke');
      assert.deepEqual(workerOps(f).filter(o => READINESS.includes(o)), []);
    } finally { f.close(); }
  });

  test('W13 delayed bind delivery while denied still revokes; enabled flags never admit a denied visitor' + P, { timeout: 10000 }, async () => {
    const f = await fx({ denied: true, flagsHeld: true, pageStorage: [], requestDelay: d => d && d.op === 'bind' ? 30 : 0 });
    try {
      assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
      await sleep(80); await f.settle();
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'denied: nothing admitted');
      assert.equal(f.workerStorage.get(REVOKED), '1', 'bind-time revoke applied (safe direction only)');
    } finally { f.close(); }
  });

  // In-session regrant needs the (disabled) banner; stale-revoke-after-reaccept is covered in the banner
  // fixture by click-attribution-corrections 'fresh reaccept ... despite a delayed revoke' (mutation R1).
  test('W14 lost delivery (all revokes dropped): liveness limit measured across a later granted load' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true, pageStorage: [[KEY, rec('INERT_W14')]], workerStorage: [[KEY, rec('INERT_W14')]], holdAck: d => d.type === 'wbe-click-revoke' });
    let page, workerCopy;
    try {
      await f.settle(); withdraw(f); await f.settle();
      assert.equal(f.storage.has(KEY), false, 'Head erased its own copy');
      assert.ok(f.workerStorage.has(KEY), 'LIVENESS LIMIT: no delivery -> worker copy not erased in this session');
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'SAFETY: still unreadable while held');
      page = [...f.storage]; workerCopy = [...f.workerStorage];
    } finally { f.close(); }
    const g = await fx({ pageStorage: page, workerStorage: workerCopy });
    try {
      await g.api.waitForClickAttribution(); await g.settle();
      const ids = g.api.getStoredClickIds(undefined, true);
      assert.equal(ids, null, 'withdrawn IDs not re-admitted at the next granted load');
      assert.equal(g.storage.has(KEY), false, 'not restored to the Head copy');
      assert.equal(g.workerStorage.has(KEY), false, 'eventual erase at the next readiness (liveness only)');
    } finally { g.close(); }
  });

  const hex = c => c.repeat(32);
  const bindMsg = (nonce, channel, seq = 1, extra = {}) => ({ source: 'wbe-click-attribution', v: 2, schema: 1, op: 'bind', sequence: seq, nonce, channel, policy: null, record: null, ...extra });
  const revokedNonces = f => revokes(f).map(r => r.d.nonce);

  test('W16 authenticated-frame DIRECT malformed binds are rejected by the receiving Head (positive control: valid direct bind registers)' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true });
    try {
      const bad = [
        ['policy', bindMsg(hex('1'), hex('a'), 1, { policy: {} })],
        ['record', bindMsg(hex('2'), hex('a'), 1, { record: JSON.parse(rec('X')) })],
        ['channel empty', bindMsg(hex('3'), '')],
        ['channel non-hex', bindMsg(hex('4'), 'g'.repeat(32))],
        ['channel proto', bindMsg(hex('5'), '__proto__')],
        ['nonce non-hex', bindMsg('Z'.repeat(32), hex('b'))],
        ['nonce short', bindMsg('ab', hex('c'))],
      ];
      for (const [, d] of bad) f.toHead(d);
      f.toHead(bindMsg(hex('9'), hex('d'))); // positive control
      withdraw(f); await f.settle();
      const got = revokedNonces(f);
      assert.ok(got.includes(hex('9')), 'valid direct bind registered and notified');
      for (const [name, d] of bad) assert.ok(!got.includes(d.nonce), 'rejected: ' + name);
    } finally { f.close(); }
  });

  test('W17 adversarial delayed OLDER bind (worker->Head reordering) never replaces the newer binding' + P, { timeout: 10000 }, async () => {
    let first = true;
    const f = await fx({ flagsHeld: true, workerStorage: [[KEY, rec('INERT_W17')]], requestDelay: d => d && d.op === 'open' ? 5000 : d && d.op === 'bind' && first ? (first = false, 200) : 0 }); // open never reaches the Head: no channel C
    try {
      // copy re-binds at readiness: the second bind overtakes the delayed first one
      assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
      const ready = f.api.waitForClickAttribution(); await sleep(20); await f.settle();
      await sleep(300); await f.settle(); await ready.catch(() => {});
      const binds = f.trace.filter(x => x.edge === 'relay' && x.d && x.d.op === 'bind').map(x => x.d.sequence);
      assert.deepEqual(binds.slice(0, 2), [2, 1], 'older bind delivered after the newer one');
      f.workerStorage.set(KEY, rec('INERT_W17_AFTER'));
      withdraw(f); await f.settle();
      assert.equal(f.workerStorage.has(KEY), false, 'current nonce still notified');
    } finally { f.close(); }
  });

  test('W18 withdrawal while the rotating bind is in flight: old-nonce revoke ignored, bind-time revoke for the new nonce erases (both Head->worker orders)' + P, { timeout: 10000 }, async () => {
    for (const reverse of [false, true]) {
      let n = 0; const held = [];
      const f = await fx({ pageStorage: [[KEY, rec('INERT_W18')]], requestDelay: d => d && d.op === 'bind' && ++n === 2 ? 100 : 0,
        holdAck: d => reverse && d.type === 'wbe-click-revoke' });
      try {
        const ready = f.api.waitForClickAttribution(); await sleep(20);
        withdraw(f); await sleep(200); await f.settle();
        if (reverse) { const h = f.heldAcks.splice(0); h.reverse().forEach(d => d()); await f.settle(); }
        await ready.catch(() => {});
        assert.ok(revokes(f).length >= 2, 'old and new nonce revokes both issued');
        assert.equal(f.workerStorage.has(KEY), false, 'erased (reverse=' + reverse + ')');
        assert.equal(f.api.getStoredClickIds(undefined, true), null);
      } finally { f.close(); }
    }
  });

  test('W19 MEASURED LIMIT: enabled/admitted copies with all revokes dropped stay readable in-session until delivery (single and two-copy)' + P, { timeout: 10000 }, async () => {
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W19')]], holdAck: d => d.type === 'wbe-click-revoke' });
    try {
      const b = await f.copy({ separateStorage: true, enabled: true });
      await f.api.waitForClickAttribution(); await b.api.waitForClickAttribution();
      assert.ok(f.api.getStoredClickIds(undefined, true) && b.api.getStoredClickIds(undefined, true), 'both admitted');
      withdraw(f); await f.settle();
      assert.equal(f.storage.has(KEY), false, 'Head copy erased');
      // No delivery -> no worker-side enforcement. This is a liveness/enforcement limit, not safety:
      assert.ok(f.api.getStoredClickIds(undefined, true), 'LIMIT: admitted copy A still serves IDs without delivery');
      assert.ok(b.api.getStoredClickIds(undefined, true), 'LIMIT: admitted copy B still serves IDs without delivery');
      for (const d of f.heldAcks.splice(0)) d(); await f.settle();
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'delivery enforces A');
      assert.equal(b.api.getStoredClickIds(undefined, true), null, 'delivery enforces B');
      assert.equal(f.workerStorage.has(KEY), false); assert.equal(b.storage.has(KEY), false);
    } finally { f.close(); }
  });

  test('W20 lifecycle: hard cap 16 per relay frame, no eviction of live recipients; replaced frame drops old bindings' + P, { timeout: 10000 }, async () => {
    const f = await fx({ flagsHeld: true });
    try {
      const own = f.trace.filter(x => x.edge === 'worker' && x.d && x.d.op === 'bind').length; // worker copy's own binding(s)
      const ids = Array.from({ length: 20 }, (_, i) => (i + 16).toString(16).padStart(2, '0').repeat(16));
      ids.forEach(id => f.toHead(bindMsg(id, id)));
      withdraw(f); await f.settle();
      const got = new Set(revokedNonces(f));
      const accepted = ids.filter(id => got.has(id)).length;
      assert.equal(accepted + own, 16, 'cap 16 including the worker copy');
      assert.ok(ids.slice(0, 16 - own).every(id => got.has(id)), 'earliest (live) recipients kept, not evicted');
      // a bind from a different authenticated frame prunes bindings of the replaced frame
      const before = revokes(f).length;
      f.replaceFrame(); f.toHead(bindMsg(hex('e'), hex('e')), f.currentFrame());
      withdraw(f); await f.settle();
      const after = revokes(f).slice(before).map(r => r.d.nonce);
      assert.deepEqual(after.filter(x => x !== hex('e')).filter(x => ids.includes(x)), [], 'old-frame bindings pruned');
    } finally { f.close(); }
  });

  // ---------------- O3 contract: readiness requires the copy's CURRENT authenticated privacy binding ----------------
  const results = f => f.trace.filter(x => x.edge === 'ack' && x.d && x.d.type === 'wbe-click-attribution-result');
  const refusals = f => results(f).filter(x => x.d.op === 'open' && x.d.allowed === false);
  const bindsOf = f => f.trace.filter(x => x.edge === 'worker' && x.d && x.d.op === 'bind').map(x => x.d);
  const openMsg = (nonce, channel) => ({ source: 'wbe-click-attribution', v: 2, schema: 1, op: 'open', sequence: 1, nonce, channel, policy: null, record: null });

  for (const shared of [false, true]) test('W22 CONTRACT capacity overflow (' + (shared ? 'shared' : 'separate') + ' storage): refused copy is never admitted, its storage is byte-unchanged, no consent/REVOKED change; bound copies still work and still erase on withdrawal' + P, { timeout: 30000 }, async () => {
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W22')]] });
    try {
      for (let i = 0; i < 15; i++) await f.copy({ separateStorage: true });
      const live = await f.copy(shared ? {} : { separateStorage: true, storage: [[KEY, rec('INERT_W22_LIVE')]] });
      if (shared) f.workerStorage.set(KEY, rec('INERT_W22_LIVE'));
      const st = shared ? f.workerStorage : live.storage, before = JSON.stringify([...st]), page = f.storage.get(KEY);
      assert.equal(await live.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
      await live.api.waitForClickAttribution(); await f.settle();
      assert.ok(refusals(f).length >= 1, 'Head answered the unbound open with a non-destructive refusal');
      assert.equal(live.api.getStoredClickIds(undefined, true), null, 'refused copy not admitted');
      assert.equal(JSON.stringify([...st]), before, 'storage byte-unchanged on capacity failure (no erase, no REVOKED, no CLEAR)');
      assert.equal(f.storage.get(KEY), page, 'Head page copy not cleared by the refusal');
      assert.equal(f.storage.get('wbe_consent_choice') ?? null, null, 'no consent denial manufactured');
      await f.api.waitForClickAttribution(); await f.settle();
      assert.ok(f.api.getStoredClickIds(undefined, true), 'positive control: bound copy still readies/admits (refusal took no channel slot)');
      withdraw(f); await f.settle();
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'bound copy revoked on withdrawal');
      assert.equal(live.api.getStoredClickIds(undefined, true), null, 'refused copy never serves IDs');
      if (shared) assert.equal(f.workerStorage.has(KEY), false, 'consent revoke still erases shared storage');
      await sleep(600); await f.settle();
      assert.ok(!String(st.get(KEY) || '').includes('INERT_W22_LIVE') || !shared, 'no resurrection in shared storage');
    } finally { f.close(); }
  });

  for (const shared of [false, true]) test('W23a CONTRACT lost refusal (' + (shared ? 'shared' : 'separate') + ' storage, another copy admitted): unverified binding is a NON-DESTRUCTIVE no-admission hold; late refusal changes nothing; admitted copy unaffected; withdrawal still erases bound copies' + P, { timeout: 30000 }, async () => {
    let drop = true;
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W23')]], holdAck: d => drop && d.type === 'wbe-click-attribution-result' && d.op === 'open' && d.allowed === false });
    try {
      await f.api.waitForClickAttribution(); await f.settle();
      assert.ok(f.api.getStoredClickIds(undefined, true), 'positive control: copy A admitted');
      for (let i = 0; i < 15; i++) await f.copy({ separateStorage: true });
      const live = await f.copy(shared ? { enabled: true } : { separateStorage: true, storage: [[KEY, rec('INERT_W23_LIVE')]], enabled: true });
      const st = shared ? f.workerStorage : live.storage, before = JSON.stringify([...st]);
      await live.api.waitForClickAttribution(); await sleep(50); await f.settle();
      assert.equal(live.api.getStoredClickIds(undefined, true), null, 'lost refusal: no admission');
      assert.equal(JSON.stringify([...st]), before, 'lost refusal: KEY/CLEAR/REVOKED byte-unchanged' + (shared ? ' (A\'s admitted KEY intact)' : ''));
      assert.ok(f.api.getStoredClickIds(undefined, true), 'copy A still serves its valid admission');
      drop = false; for (const d of f.heldAcks.splice(0)) d(); await f.settle();
      assert.equal(JSON.stringify([...st]), before, 'late refusal: still byte-unchanged');
      assert.equal(live.api.getStoredClickIds(undefined, true), null);
      withdraw(f); await f.settle();
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'genuine withdrawal still revokes the bound copy');
      if (shared) assert.equal(f.workerStorage.has(KEY), false, 'genuine withdrawal still erases shared storage');
      assert.equal(live.api.getStoredClickIds(undefined, true), null, 'unverified copy never serves');
      await sleep(600); await f.settle();
      if (shared) assert.equal(f.workerStorage.has(KEY), false, 'no resurrection');
    } finally { f.close(); }
  });

  test('W23b CONTRACT lost reply for a BOUND open: timeout keeps storage byte-unchanged; the late authenticated success wakes a fresh readiness that admits normally' + P, { timeout: 30000 }, async () => {
    let n = 0;
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W23B')]], workerStorage: [[KEY, rec('INERT_W23B', 2)]], ackDelay: 0, holdAck: d => d.type === 'wbe-click-attribution-result' && d.op === 'open' && ++n === 1 });
    try {
      const before = JSON.stringify([...f.workerStorage]);
      const ready = f.api.waitForClickAttribution(); await sleep(650); await f.settle();
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'timed out: no admission');
      assert.equal(JSON.stringify([...f.workerStorage]), before, 'timeout (transport uncertainty): byte-unchanged, no erase');
      for (const d of f.heldAcks.splice(0)) d(); await sleep(400); await f.settle(); await ready.catch(() => {});
      assert.ok(f.api.getStoredClickIds(undefined, true), 'late authenticated success wakes a fresh, normally admitted readiness');
    } finally { f.close(); }
  });

  test('W23c stale outcome: an old-epoch open success delivered after a NEWER readiness is ignored; a withdrawal during the unverified hold is not undone by late results' + P, { timeout: 30000 }, async () => {
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W23C')]], workerStorage: [[KEY, rec('INERT_W23C')]], holdAck: d => d.type === 'wbe-click-attribution-result' && d.op === 'open' });
    try {
      const r1 = f.api.waitForClickAttribution(); await sleep(650); await f.settle(); await r1.catch(() => {});
      const held1 = f.heldAcks.splice(0);
      assert.ok(f.workerStorage.has(KEY), 'positive control: unverified hold preserved the copy');
      withdraw(f); await f.settle();
      for (const d of held1) d(); await sleep(400); await f.settle();
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'late success after withdrawal never admits');
      assert.equal(f.workerStorage.has(KEY), false, 'withdrawal erase stands (no resurrection)');
    } finally { f.close(); }
  });

  test('W24 wrong copy / mismatched nonce / unknown copy opens are refused; malformed channel gets no reply; Head copy and channel slot untouched' + P, { timeout: 15000 }, async () => {
    const f = await fx({ flagsHeld: true, pageStorage: [[KEY, rec('INERT_W24')]] });
    try {
      const b = await f.copy({ separateStorage: true }); await f.settle();
      const [a0, b0] = bindsOf(f);
      f.toHead(openMsg(hex('1'), a0.channel));       // A's copy id, wrong nonce
      f.toHead(openMsg(a0.nonce, b0.channel));       // A's nonce, B's copy id
      f.toHead(openMsg(hex('2'), hex('3')));         // unknown copy id
      f.toHead(openMsg(hex('4'), 'z'.repeat(32)));   // malformed channel
      f.toHead(openMsg(hex('5'), '__proto__'.padEnd(32, '_')));
      await f.settle();
      const r = refusals(f).map(x => x.d.nonce);
      for (const n of [hex('1'), a0.nonce, hex('2')]) assert.ok(r.includes(n), 'refused ' + n.slice(0, 4));
      assert.equal(results(f).filter(x => [hex('4'), hex('5')].includes(x.d.nonce)).length, 0, 'malformed channel: no reply');
      assert.equal(results(f).filter(x => x.d.allowed === true).length, 0, 'nothing allowed');
      assert.ok(f.storage.has(KEY), 'Head page copy not cleared by refusals');
      assert.equal(await f.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
      await f.api.waitForClickAttribution();
      assert.ok(f.api.getStoredClickIds(undefined, true), 'positive control: the genuine current binding opens and admits');
    } finally { f.close(); }
  });

  test('W25 stale epoch: after rotation an open with the OLD bound nonce is refused; the current one is allowed' + P, { timeout: 15000 }, async () => {
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W25')]] });
    try {
      await f.api.waitForClickAttribution(); await f.settle();
      const [first, second] = bindsOf(f);
      assert.ok(first && second && first.channel === second.channel && first.nonce !== second.nonce, 'rotated nonce, same copy id');
      const opens = f.trace.filter(x => x.edge === 'worker' && x.d && x.d.op === 'open').map(x => x.d);
      assert.equal(opens[0].nonce, second.nonce, 'open nonce IS the freshly bound privacy nonce');
      assert.equal(opens[0].channel, second.channel, 'open carries the copy id');
      f.toHead(openMsg(first.nonce, first.channel)); await f.settle();
      assert.ok(refusals(f).some(x => x.d.nonce === first.nonce), 'stale nonce refused');
      assert.ok(f.api.getStoredClickIds(undefined, true), 'current epoch unaffected');
    } finally { f.close(); }
  });

  test('W26 open overtakes its bind (worker->Head reordering): refused non-destructively; storage unchanged; next readiness binds and admits' + P, { timeout: 15000 }, async () => {
    let n = 0;
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W26')]], workerStorage: [[KEY, rec('INERT_W26')]], requestDelay: d => d && d.op === 'bind' && ++n === 2 ? 300 : 0 });
    try {
      const before = JSON.stringify([...f.workerStorage]);
      await f.api.waitForClickAttribution(); await f.settle();
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'not admitted');
      assert.equal(JSON.stringify([...f.workerStorage]), before, 'storage unchanged');
      await sleep(400); await f.settle();
      await f.api.waitForClickAttribution(); await f.settle();
      assert.ok(f.api.getStoredClickIds(undefined, true), 'liveness: a later readiness binds and admits');
    } finally { f.close(); }
  });
  const workerOpsAll = f => f.trace.filter(t => t.edge === 'worker' && t.d && t.d.op).map(t => t.d.op);

  test('W28 a refused open never takes the single channel slot: a bound copy mid-readiness still completes and admits' + P, { timeout: 15000 }, async () => {
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W28')]], policyDelay: 150 });
    try {
      const ready = f.api.waitForClickAttribution(); await sleep(40);
      assert.ok(workerOpsAll(f).includes('read') || workerOpsAll(f).includes('open'), 'bound copy mid-readiness');
      f.toHead(openMsg(hex('6'), hex('7'))); await f.settle();
      assert.ok(refusals(f).some(x => x.d.nonce === hex('6')), 'foreign open refused');
      await ready; await f.settle();
      assert.ok(f.api.getStoredClickIds(undefined, true), 'bound copy still admitted');
    } finally { f.close(); }
  });

  test('W29 binding is frame-bound: the same copy id + nonce opened from a REPLACED authenticated frame is refused' + P, { timeout: 15000 }, async () => {
    const f = await fx({ flagsHeld: true, pageStorage: [[KEY, rec('INERT_W29')]] });
    try {
      await f.settle(); const [b0] = bindsOf(f);
      const nf = f.replaceFrame(); const seen = [];
      nf.postMessage = d => seen.push(d);
      f.toHead(openMsg(b0.nonce, b0.channel), nf); await f.settle();
      assert.ok(seen.some(d => d.type === 'wbe-click-attribution-result' && d.op === 'open' && d.allowed === false), 'refused from the replaced frame');
      assert.equal(seen.filter(d => d.allowed === true).length, 0);
    } finally { f.close(); }
  });

  test('W30 previously admitted copy whose next open is refused (its rotating bind delayed) stops serving IDs immediately; storage unchanged' + P, { timeout: 15000 }, async () => {
    let n = 0;
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W30')]], requestDelay: d => d && d.op === 'bind' && ++n === 3 ? 400 : 0 });
    try {
      await f.api.waitForClickAttribution(); await f.settle();
      assert.ok(f.api.getStoredClickIds(undefined, true), 'admitted on epoch 1');
      const before = JSON.stringify([...f.workerStorage]);
      await f.api.waitForClickAttribution(); await f.settle();
      assert.ok(refusals(f).length >= 1, 'epoch 2 open overtook its bind and was refused');
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'no stale admission served while unbound');
      assert.equal(JSON.stringify([...f.workerStorage]), before, 'storage unchanged');
    } finally { f.close(); }
  });

  test('W31 CONTRACT crypto unavailable (cannot establish a binding) in SHARED storage with a healthy admitted copy: no send, no admission, KEY/CLEAR/REVOKED unchanged, healthy copy unaffected; genuine withdrawal still deletes' + P, { timeout: 20000 }, async () => {
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W31')]] });
    try {
      await f.api.waitForClickAttribution(); await f.settle();
      assert.ok(f.api.getStoredClickIds(undefined, true), 'healthy copy A admitted');
      const before = JSON.stringify([...f.workerStorage]), posts0 = f.trace.filter(x => x.edge === 'worker').length;
      const realCrypto = f.worker.crypto; f.worker.crypto = undefined; // permanent incapability for the new copy's work
      let b;
      try {
        b = await f.copy({});
        assert.equal(await b.api.resolveTrackingFlags(async () => ENABLED), 'enabled');
        await b.api.waitForClickAttribution(); await f.settle();
      } finally { f.worker.crypto = realCrypto; }
      assert.equal(f.trace.filter(x => x.edge === 'worker').length, posts0, 'incapable copy sends nothing (no bind, no open)');
      assert.equal(b.api.getStoredClickIds(undefined, true), null, 'no admission');
      assert.equal(JSON.stringify([...f.workerStorage]), before, 'KEY/CLEAR/REVOKED byte-unchanged (healthy copy KEY intact)');
      assert.ok(f.api.getStoredClickIds(undefined, true), 'healthy copy still serves');
      withdraw(f); await f.settle();
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'genuine withdrawal revokes the healthy copy');
      assert.equal(f.workerStorage.has(KEY), false, 'genuine withdrawal still deletes shared storage');
      assert.equal(b.api.getStoredClickIds(undefined, true), null);
    } finally { f.close(); }
  });

  test('W32 CONTRACT whole realm without crypto from load (separate storage): nothing sent at all, no admission, stored bytes preserved; Head copy still erased on withdrawal' + P, { timeout: 20000 }, async () => {
    const f = await fx({ noCrypto: true, pageStorage: [[KEY, rec('INERT_W32')]], workerStorage: [[KEY, rec('INERT_W32')]] });
    try {
      const before = JSON.stringify([...f.workerStorage]);
      await f.api.waitForClickAttribution(); await f.settle();
      assert.equal(f.api.getStoredClickIds(undefined, true), null, 'no admission');
      assert.equal(f.trace.filter(x => x.edge === 'worker').length, 0, 'no bind, no open, nothing sent');
      assert.equal(JSON.stringify([...f.workerStorage]), before, 'KEY/CLEAR/REVOKED bytes preserved');
      withdraw(f); await f.settle();
      assert.equal(f.storage.has(KEY), false, 'Head copy erased on genuine withdrawal');
    } finally { f.close(); }
  });
}

test('W15 adapter wiring (static): Summary binds at load before the flag read; master binds before its flag await', () => {
  const fs = require('node:fs'), path = require('node:path'), src = p => fs.readFileSync(path.join(__dirname, '..', 'velo', p), 'utf8');
  const s = src('page-booking-summary.js'), bind = s.indexOf('try { initClickAttribution($w); } catch (_) {}'), flags = s.indexOf('_trackingFlags = resolveTrackingFlags(');
  assert.ok(bind > 0 && flags > bind, 'Summary binds before resolving flags');
  const m = src('masterPage.js'), mb = m.indexOf('initClickAttribution('), mf = m.indexOf('resolveTrackingFlags(');
  assert.ok(mb > 0 && mf > mb, 'master binds before resolving flags');
});

// ---------------- O3: actual Summary page booking while UNBOUND ----------------
test('W27 Summary page: missing binding evidence (bind never reaches the Head) -> booking still created, no click IDs; Head-gated AW form handoff unchanged', { timeout: 30000 }, async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const file = path.join(__dirname, 'ads-custom-form.cjs'), source = fs.readFileSync(file, 'utf8');
  const box = { require, __dirname, __filename: file, console: { log() {}, warn() {}, error() {} }, process, setTimeout, clearTimeout, structuredClone, URL, Buffer };
  vm.runInNewContext(source.slice(0, source.indexOf('\n(async()=>{')) + '\nthis.fixture=fixture;', box);
  const run = async dropBind => { const x = await box.fixture({ consent: 'yes', dropBind, stored: { [KEY]: rec('INERT_W27', 1) } }); await x.submit(); await x.settle(); return x; };
  const ctl = await run(false), unbound = await run(true);
  assert.ok(ctl.p.payloads.length >= 1, 'control booking created');
  assert.equal(ctl.events().filter(e => e[1] === 'form_submit').length, 1, 'control: AW handoff when bound');
  assert.ok(JSON.stringify(ctl.p.payloads[0]).includes('INERT_W27'), 'control: stored ID reaches the booking');
  assert.equal(unbound.p.payloads.length, ctl.p.payloads.length, 'unbound: booking still created');
  assert.equal(JSON.stringify(unbound.p.payloads).includes('INERT_W27'), false, 'unbound: no click ID in any booking payload');
  // The Ads-form handoff is a separate Head-gated protocol (consent checked in the Head at send time), not worker attribution:
  assert.equal(unbound.events().filter(e => e[1] === 'form_submit').length, ctl.events().filter(e => e[1] === 'form_submit').length, 'unbound: Head-gated AW form handoff unchanged (not attribution)');
});

test('W27b Summary page: the open reply is lost (unverified binding) -> booking still created, no click IDs, stored KEY preserved', { timeout: 30000 }, async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const file = path.join(__dirname, 'ads-custom-form.cjs'), source = fs.readFileSync(file, 'utf8');
  const box = { require, __dirname, __filename: file, console: { log() {}, warn() {}, error() {} }, process, setTimeout, clearTimeout, structuredClone, URL, Buffer };
  vm.runInNewContext(source.slice(0, source.indexOf('\n(async()=>{')) + '\nthis.fixture=fixture;', box);
  const stored = rec('INERT_W27B', 1);
  const run = async dropOpenReply => { const x = await box.fixture({ consent: 'yes', dropOpenReply, stored: { [KEY]: stored } }); await x.submit(); await x.settle(); return x; };
  const ctl = await run(false), lost = await run(true);
  assert.ok(JSON.stringify(ctl.p.payloads[0]).includes('INERT_W27B'), 'control: stored ID reaches the booking');
  assert.equal(lost.p.payloads.length, ctl.p.payloads.length, 'lost reply: booking still created');
  assert.equal(JSON.stringify(lost.p.payloads).includes('INERT_W27B'), false, 'lost reply: no click ID');
  assert.equal(lost.store.get(KEY), stored, 'lost reply: stored attribution preserved byte-exact');
});
