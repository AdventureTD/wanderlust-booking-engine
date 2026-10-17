'use strict';
// ARCHIVE (not a release regression; excluded from tests/*.cjs runs). HISTORICAL measured-defect test W21, moved VERBATIM from tests/withdrawal-binding.cjs (variant A).
// Expected PASS on withdrawal-binding-a (defect present), expected FAIL on O3 (defect fixed: the refused
// copy is never admitted). It is not part of the O3 green suite; run it explicitly for RED->GREEN evidence:
//   node.exe --experimental-vm-modules tests/archive/withdrawal-binding-historical-w21.cjs </dev/null
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('../attribution-clock-v2.cjs');
const KEY = 'wl_click_attribution', DAY = 86400000;
const touch = (id, days = 1) => ({ capturedAt: new Date(Date.now() - days * DAY - 1000).toISOString(), gclid: id, gbraid: '', wbraid: '', msclkid: '' });
const rec = (id, days = 1) => JSON.stringify({ v: 1, first: touch(id, days), latest: touch(id, days) });
const withdraw = f => f.head.window.dataLayer.push(['consent', 'update', { ad_user_data: 'denied' }]);
for (const packed of [false, true]) {
  const P = packed ? ' [packed]' : ' [source]';
  const fx = o => fixture({ packed, ...o });
  test('W21 MEASURED CAPACITY LIMIT: re-created copies in one frame exhaust the cap; a live, enabled, admitted 17th copy is refused and keeps serving IDs after withdrawal with WORKING transport' + P, { timeout: 20000 }, async () => {
    const f = await fx({ pageStorage: [[KEY, rec('INERT_W21')]] });
    try {
      for (let i = 0; i < 15; i++) await f.copy({ separateStorage: true }); // torn-down/re-created copies never unbind
      const live = await f.copy({ separateStorage: true, enabled: true }); // 17th binding in this frame (original + 15 + this)
      await live.api.waitForClickAttribution(); await f.settle();
      assert.ok(live.api.getStoredClickIds(undefined, true), 'live copy admitted');
      await f.api.waitForClickAttribution(); await f.settle(); // another copy's open takes the single channel slot C
      withdraw(f); await f.settle();
      assert.equal(f.storage.has(KEY), false, 'Head copy erased; transport working');
      assert.ok(live.api.getStoredClickIds(undefined, true), 'LIMIT: refused live copy has no withdrawal path (needs a decision, see report)');
    } finally { f.close(); }
  });
}
