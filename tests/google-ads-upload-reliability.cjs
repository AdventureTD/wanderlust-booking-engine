// Actual modules executed with inert SDK/OAuth/fetch boundaries. No network.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
function client(body, status = 200, mode = '') {
  const calls = [], logs = [];
  const source = fs.readFileSync(path.join(root, 'velo/backend/dataManagerClient.web.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const context = vm.createContext({ Buffer, URLSearchParams, Date,
    console: {log: (...v) => logs.push(v), error: (...v) => logs.push(v)},
    getSecret: async () => { if (mode === 'oauth') throw Error('private-secret'); return 'inert'; },
    crypto: {createSign: () => ({update: () => ({sign: () => Buffer.from('inert')})})},
    fetch: async (url, options) => {
      calls.push({url, options});
      if (url.includes('oauth2')) return {ok:true, json:async()=>({access_token:'inert-token', expires_in:3600})};
      if (mode === 'lost') throw Error('private-response');
      return {ok:status >= 200 && status < 300, status, text:async()=>body};
    }
  });
  vm.runInContext(source + '\nthis.ingest = ingestEvent;', context);
  return {ingest: context.ingest, calls, logs};
}
for (const [name, body, status, mode, outcome, code] of [
  ['missing ID', '{}', 200, '', 'unknown', 'MISSING_REQUEST_ID'],
  ['empty array', '[]', 200, '', 'unknown', 'MISSING_REQUEST_ID'],
  ['malformed JSON', '{', 200, '', 'unknown', 'INVALID_RESPONSE'],
  ['HTTP failure', 'private-response', 500, '', 'unknown', 'HTTP_ERROR'],
  ['lost response', '', 200, 'lost', 'unknown', 'TRANSPORT_ERROR'],
  ['OAuth failure before ingest', '', 200, 'oauth', 'not_attempted', 'PRE_SEND_FAILURE'],
  ['explicit rejection', '{"requestId":"id","errors":[{"message":"private-response"}]}', 200, '', 'processingfailure', 'REJECTED_RESPONSE']
]) test(name, async () => {
  const c = client(body, status, mode);
  await assert.rejects(c.ingest(payload), e => e.outcome === outcome && e.code === code && !e.message.includes('private-'));
  assert.equal(c.calls.filter(c=>c.url.includes('events:ingest')).length, mode === 'oauth' ? 0 : 1);
  assert.ok(!JSON.stringify(c.logs).includes('private-'));
});
test('request ID with warnings acknowledges ingestion, preserves economics without payload logging', async () => {
  const c = client('{"requestId":"id","fieldWarnings":[{"message":"private-response"}]}');
  const r = await c.ingest(payload);
  assert.equal(r.requestId, 'id');
  assert.equal(r.fieldWarnings.length, 1);
  assert.deepEqual(JSON.parse(c.calls[1].options.body), payload);
  assert.ok(!JSON.stringify(c.logs).includes('private-'));
});
const payload = {destinations:[{productDestinationId:'inert'}], events:[{transactionId:'SYNTHETIC', conversionValue:5898.15, userData:{userIdentifiers:[{emailAddress:'private-hash'}]}}]};
test('empty successful ingest is unknown, never accepted', async () => {
  const c = client('');
  await assert.rejects(c.ingest(payload), e => e.outcome === 'unknown' && e.code === 'MISSING_REQUEST_ID');
  assert.equal(c.calls.filter(c=>c.url.includes('events:ingest')).length, 1);
});
