'use strict';
// Semantic trace projection for withdrawal-binding O3 (approved P2). Harnesses KEEP the raw capture
// (allSent / allPosts / f.trace); the projected attribution view excludes ONLY exact privacy-only
// binds, each of which is asserted: exact envelope keys, type/v/schema, op 'bind', policy and record
// null, 32-hex nonce and copy id, safe-integer sequence strictly increasing per copy id.
const assert = require('node:assert/strict');
const HEX = /^[a-f0-9]{32}$/;
function assertPrivacyBind(d) {
  assert.equal(Object.keys(d).sort().join(','), 'channel,nonce,op,policy,record,schema,sequence,type,v', 'excluded item is an exact bind envelope');
  assert.equal(d.type, 'wbe-click-attribution'); assert.equal(d.v, 2); assert.equal(d.schema, 1); assert.equal(d.op, 'bind');
  assert.equal(d.policy, null, 'bind carries no policy'); assert.equal(d.record, null, 'bind carries no record');
  assert.match(d.nonce, HEX, 'bind nonce'); assert.match(d.channel, HEX, 'bind copy id');
  assert.ok(Number.isSafeInteger(d.sequence) && d.sequence >= 1, 'bind sequence');
}
function projector() {
  const seq = new Map();
  return {
    // true = attribution item (kept in the projected view); false = validated privacy-only bind
    take(d) {
      if (!d || d.op !== 'bind') return true;
      assertPrivacyBind(d);
      assert.ok(d.sequence > (seq.get(d.channel) || 0), 'bind sequence strictly increasing per copy');
      seq.set(d.channel, d.sequence);
      return false;
    }
  };
}
function attributionOnly(list) { const p = projector(); return list.filter(d => p.take(d)); }
module.exports = { assertPrivacyBind, projector, attributionOnly };
