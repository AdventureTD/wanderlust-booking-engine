'use strict';
// Actual client -> private journal -> inert insert/readback. No live boundaries.
const { fixture, evalSource } = require('./google-ads-private-journal.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const errorBody = details => JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'PRIVATE ECHO', details } });
async function observe(text) {
  const f = fixture({ transport: async () => ({ ok: false, status: 400, text: async () => text }) });
  const token = await f.mint(), booking = f.booking({ conversionCapability: token });
  const result = await f.sender.recordBookingConversion(booking);
  const row = [...f.rows.values()].find(r => r.kind === 'RESULT');
  assert.ok(row, 'HTTP failure must retain RESULT');
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.reasonCode, 'HTTP_ERROR', 'public classification stays unchanged');
  assert.equal(row.statusCode, 400);
  assert.equal(row.requestId, '');
  assert.equal(f.rows.get('BookingSummary:summary-inert').googleConversionUploaded, undefined);
  await f.sender.recordBookingConversion(booking);
  await f.sender.retryBookingConversion('WC-INERT');
  assert.equal(f.sends, 1, 'diagnostics never authorize replay');
  assert.ok(Buffer.byteLength(JSON.stringify(row)) <= 2048);
  return row;
}
test('standard Google ErrorInfo and BadRequest retain only reason enums and schema paths', async () => {
  const row = await observe(errorBody([
    { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'INVALID_SHA256_FORMAT', domain: 'datamanager.googleapis.com', metadata: { private: 'PRIVATE ECHO' } },
    { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [
      { field: 'events[0].user_data.user_identifiers[1].email_address', reason: 'INVALID_FORMAT', description: 'PRIVATE ECHO' }
    ] }
  ]));
  assert.equal(row.reasonCode, 'HTTP_ERROR|' + JSON.stringify({ reasons: ['INVALID_ARGUMENT', 'INVALID_SHA256_FORMAT', 'INVALID_FORMAT'], fields: ['events[].userData.userIdentifiers[].emailAddress'] }));
  assert.ok(!JSON.stringify(row).includes('PRIVATE ECHO'));
});

for (const [name, text] of [
  ['empty', ''], ['invalid JSON', '{'], ['HTML', '<html>PRIVATE ECHO</html>'],
  ['null', 'null'], ['array', '[]'], ['wrong details type', '{"error":{"details":42}}'],
  ['null details', '{"error":{"details":[null,42,[],{"@type":"unknown","reason":"INVALID_FORMAT"}]}}'],
  ['huge valid JSON', errorBody([]) + ' '.repeat(16385)],
  ['huge malformed JSON', '{' + 'x'.repeat(1024 * 1024)],
  ['nested JSON', '['.repeat(9000) + ']'.repeat(9000)]
]) test('malformed/oversized HTTP body fails closed: ' + name, async () => {
  assert.equal((await observe(text)).reasonCode, 'HTTP_ERROR');
});
test('16 KiB parsing boundary uses UTF-8 bytes and rejects cap-plus-one', async () => {
  const text = errorBody([]);
  const exact = text + ' '.repeat(16384 - Buffer.byteLength(text));
  assert.match((await observe(exact)).reasonCode, /INVALID_ARGUMENT/);
  assert.equal((await observe(exact + ' ')).reasonCode, 'HTTP_ERROR');
  const unicode = JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'é'.repeat(9000) } });
  assert.ok(unicode.length < 16384 && Buffer.byteLength(unicode) > 16384);
  assert.equal((await observe(unicode)).reasonCode, 'HTTP_ERROR');
});
test('malicious echoed contacts, hashes, tokens and descriptions never escape the client or journal', async () => {
  const privateValues = ['inert-person@example.invalid', '+15551234567', 'a'.repeat(64), 'SECRET_TOKEN_ABCDEF', 'gac1.' + 'b'.repeat(64)];
  const details = privateValues.flatMap(value => [
    { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: value, domain: value, metadata: { resource: value } },
    { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [
      { field: value, reason: value, description: value },
      { field: 'events[0].userData.' + value, reason: value },
      { field: 'events[15551234567].userData', reason: value }
    ] }
  ]);
  const body = errorBody(details);
  const client = evalSource('backend/dataManagerClient.web.js', { fetch: async () => ({ ok: false, status: 400, text: async () => body }) }, ['ingestEvent']);
  client.getAccessToken = async () => 'INERT-OAUTH';
  await assert.rejects(client.ingestEvent({}), error => {
    assert.equal(error.code, 'HTTP_ERROR');
    for (const value of privateValues) assert.ok(!JSON.stringify(error).includes(value) && !error.message.includes(value));
    assert.ok(!JSON.stringify(error).includes('PRIVATE ECHO'));
    return true;
  });
  const row = await observe(body);
  assert.equal(row.reasonCode, 'HTTP_ERROR|' + JSON.stringify({ reasons: ['INVALID_ARGUMENT'], fields: [] }));
  for (const value of privateValues) assert.ok(!JSON.stringify(row).includes(value));
});
test('journal independently revalidates supplied diagnostics and ignores them on other failures', async () => {
  for (const code of ['HTTP_ERROR', 'TRANSPORT_ERROR']) {
    const f = fixture({ provider: async () => { throw Object.assign(Error('PRIVATE ECHO'), {
      code, outcome: 'unknown', httpStatus: 400,
      httpDiagnostics: { reasons: ['SECRET_TOKEN_ABCDEF'], fields: ['events.inert-person@example.invalid'], message: 'PRIVATE ECHO' }
    }); } });
    const token = await f.mint();
    await f.sender.recordBookingConversion(f.booking({ conversionCapability: token }));
    const row = [...f.rows.values()].find(r => r.kind === 'RESULT');
    assert.equal(row.reasonCode, code);
    assert.ok(!JSON.stringify(row).includes('PRIVATE ECHO'));
  }
});
test('finite deduplicated output bounds retain schema-only paths without indices', async () => {
  const details = [
    { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'INVALID_FORMAT' },
    { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'INVALID_FORMAT' },
    { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [
      { field: 'events[0].userData.userIdentifiers[1].emailAddress', reason: 'INVALID_SHA256_FORMAT' },
      { field: 'events[2].user_data.user_identifiers[3].email_address', reason: 'INVALID_FORMAT' },
      { field: 'events[0].userData.userIdentifiers[0].phoneNumber', reason: 'INVALID_HEX_ENCODING' },
      { field: 'destinations[0].operatingAccount.accountId' }, { field: 'encoding' }
    ] }
  ];
  const row = await observe(errorBody(details));
  const d = JSON.parse(row.reasonCode.slice('HTTP_ERROR|'.length));
  assert.deepEqual(d.reasons, ['INVALID_ARGUMENT', 'INVALID_FORMAT', 'INVALID_SHA256_FORMAT']);
  assert.deepEqual(d.fields, ['events[].userData.userIdentifiers[].emailAddress', 'events[].userData.userIdentifiers[].phoneNumber', 'destinations[].operatingAccount.accountId']);
  assert.ok(row.reasonCode.length < 768);
  const late = Array.from({ length: 16 }, () => null).concat(details);
  assert.equal((await observe(errorBody(late))).reasonCode, 'HTTP_ERROR|' + JSON.stringify({ reasons: ['INVALID_ARGUMENT'], fields: [] }));
});
