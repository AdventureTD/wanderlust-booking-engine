'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, evalSource } = require('./google-ads-private-journal.cjs');

function observed(f, log) {
  return evalSource('backend/googleAdsAttemptJournal.js', {
    ...f.globals, console: { log }
  }, ['recordPrivateGoogleAdsAttempt']).recordPrivateGoogleAdsAttempt;
}
test('attempt acquisition uncertainty logs UNKNOWN rather than claiming no attempt', async () => {
  const f = fixture({ loseInsert: 'ATTEMPT' }), token = await f.mint(), logs = [];
  const result = await observed(f, (...args) => logs.push(args))(
    f.booking({ conversionCapability: token }), payload);
  assert.equal(result.outcome, 'UNKNOWN');
  assert.deepEqual(JSON.parse(JSON.stringify(logs)), [[{
    event: 'GOOGLE_ADS_PRE_ATTEMPT', schemaVersion: 1,
    outcome: 'UNKNOWN', reasonCode: 'ATTEMPT_EXISTS_OR_UNAVAILABLE'
  }]]);
  assert.equal(f.sends, 0);
  assert.equal([...f.rows.values()].filter(r => r.kind === 'ATTEMPT').length, 1);
});

// Additional coverage is baseline-GREEN on the two tracer implementations.
for (const reason of ['DISABLED_OR_SUSPENDED', 'CAPABILITY_REQUIRED', 'CAPABILITY_DENIED',
  'INVALID_PAYLOAD', 'ADMISSION_UNAVAILABLE', 'DESTINATION_CHANGED', 'CAPABILITY_EXPIRED_OR_DISABLED']) {
  for (const throws of [false, true]) test(`finite denial ${reason}; logger throws=${throws}`, async () => {
    const f = fixture(), token = await f.mint(), logs = [];
    const b = f.booking({ conversionCapability: token });
    let build = payload;
    if (reason === 'DISABLED_OR_SUSPENDED') f.settings.suspendGoogleAds = '1';
    if (reason === 'CAPABILITY_REQUIRED') b.conversionCapability = 'PRIVATE_INVALID';
    if (reason === 'CAPABILITY_DENIED') b.conversionCapability = 'gac1.' + 'f'.repeat(64);
    if (reason === 'INVALID_PAYLOAD') b.currency = 'PRIVATE_CURRENCY';
    if (reason === 'ADMISSION_UNAVAILABLE') build = () => { throw Error('PRIVATE_EXCEPTION'); };
    if (reason === 'DESTINATION_CHANGED') build = () => ({ destinations: [{ operatingAccount: { accountId: 'PRIVATE_DESTINATION' } }] });
    if (reason === 'CAPABILITY_EXPIRED_OR_DISABLED') build = () => { f.settings.suspendGoogleAds = '1'; return payload(); };
    const before = JSON.stringify([...f.rows]);
    const result = await observed(f, (...args) => { logs.push(args); if (throws) throw Error('PRIVATE_LOGGER'); })(b, build);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: false, outcome: 'NOT_ATTEMPTED', reasonCode: reason });
    assert.deepEqual(JSON.parse(JSON.stringify(logs)), [[{ event: 'GOOGLE_ADS_PRE_ATTEMPT', schemaVersion: 1, outcome: 'NOT_ATTEMPTED', reasonCode: reason }]]);
    assert.equal(JSON.stringify([...f.rows]), before);
    assert.equal(f.sends, 0);
  });
}
for (const mode of ['failInsert', 'loseInsert', 'failGet']) test(`attempt uncertainty ${mode} remains no-send despite throwing logger`, async () => {
  const f = fixture({ [mode]: 'ATTEMPT' }), token = await f.mint(), logs = [];
  const invoke = observed(f, (...args) => { logs.push(args); throw Error('PRIVATE_LOGGER'); });
  for (let i = 0; i < 2; i++) {
    const r = await invoke(f.booking({ conversionCapability: token }), payload);
    assert.equal(r.reasonCode, 'ATTEMPT_EXISTS_OR_UNAVAILABLE');
    assert.equal(r.outcome, 'UNKNOWN');
  }
  assert.equal(logs.length, 2);
  for (const args of logs) assert.deepEqual(JSON.parse(JSON.stringify(args)), [{ event: 'GOOGLE_ADS_PRE_ATTEMPT', schemaVersion: 1, outcome: 'UNKNOWN', reasonCode: 'ATTEMPT_EXISTS_OR_UNAVAILABLE' }]);
  assert.equal(f.sends, 0);
});
test('successful dispatch emits no denial log; replay logs uncertainty without resend', async () => {
  const f = fixture(), token = await f.mint(), logs = [];
  const invoke = observed(f, (...args) => logs.push(args));
  const b = f.booking({ conversionCapability: token });
  assert.equal((await invoke(b, payload)).ok, true);
  assert.equal(logs.length, 0);
  assert.equal((await invoke(b, payload)).outcome, 'UNKNOWN');
  assert.equal(logs.length, 1);
  assert.equal(f.sends, 1);
});

const payload = () => ({ destinations: [{ operatingAccount: { accountId: '1234567890' }, productDestinationId: '123456' }] });

test('pre-admission invalid payload emits only finite structured operational metadata', async () => {
  const f = fixture(), token = await f.mint(), logs = [];
  const result = await observed(f, (...args) => logs.push(args))(
    f.booking({ conversionCapability: token, value: -1 }), payload);
  assert.equal(result.reasonCode, 'INVALID_PAYLOAD');
  assert.deepEqual(JSON.parse(JSON.stringify(logs)), [[{
    event: 'GOOGLE_ADS_PRE_ATTEMPT', schemaVersion: 1,
    outcome: 'NOT_ATTEMPTED', reasonCode: 'INVALID_PAYLOAD'
  }]]);
  assert.equal(f.sends, 0);
  assert.equal([...f.rows.values()].filter(r => r.kind === 'ATTEMPT').length, 0);
});
