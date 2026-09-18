const {test} = require('node:test');
const assert = require('node:assert/strict');
const {load,payload,names,ids,token} = require('./google-ads-processing-test-helper.cjs');
test('two private zero-argument exports read only their retained requests', async () => {
  const h = await load();
  assert.deepEqual(Object.keys(h.api).sort(), [...names, 'readWC1034ProcessingStatus'].sort());
  for (let i=0; i<names.length; i++) {
    assert.equal(h.api[names[i]].length, 0);
    const out = await h.api[names[i]]();
    assert.equal(out.requestId, ids[i]);
    assert.equal(out.projectionComplete, true);
    assert.equal(out.destinations[0].requestStatus, 'FAILED');
    assert.equal(out.destinations[0].recordCount, '1');
    assert.equal(out.destinations[0].errors[0].reason, 'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND');
    assert.equal(h.calls[i].url, 'https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=' + encodeURIComponent(ids[i]));
    assert.equal(h.calls[i].init.method, 'GET');
    assert.equal(Object.hasOwn(h.calls[i].init, 'body'), false);
    assert.equal(h.calls[i].init.headers.Authorization, 'Bearer ' + token);
    assert.equal(JSON.stringify(out).includes(token), false);
  }
  assert.equal(h.calls.length, 2); assert.equal(h.logs.length, 0); assert.equal(h.timers.size, 0);
});
test('caller arguments are rejected before auth, including explicit undefined', async () => {
  for (const name of names) for (const args of [[undefined], [{}], ['arbitrary'], [ids[0]], [null]]) {
    const h = await load(); const out = await h.api[name](...args);
    assert.equal(out.failureCode, 'ARGUMENTS_NOT_ALLOWED');
    assert.equal(out.projectionComplete, false); assert.equal(h.authCalls(), 0); assert.equal(h.calls.length, 0);
  }
});
test('privacy projection preserves FAILED, warnings, total counts and unknown markers', async () => {
  const body = payload(); const row = body.requestStatusPerDestination[0];
  row.message = token; row.destination.reference = token;
  row.errorInfo.errorCounts.push({ reason: token, recordCount: '2', message: token });
  row.warningInfo = { warningCounts: [{reason: 'PROCESSING_WARNING_REASON_INTERNAL_ERROR', recordCount: '1', description: token}] };
  const h = await load({payload: body}); const out = await h.api[names[0]]();
  assert.equal(out.projectionComplete, false); assert.equal(out.unknownReasonPresent, true);
  assert.equal(out.destinations[0].requestStatus, 'FAILED');
  assert.equal(out.destinations[0].errors[1].reason, 'UNKNOWN');
  assert.equal(out.destinations[0].warnings[0].reason, 'PROCESSING_WARNING_REASON_INTERNAL_ERROR');
  assert.equal(out.destinations[0].recordCount, '1');
  assert.equal(JSON.stringify(out).includes(token), false); assert.equal(h.logs.length, 0);
  assert.equal('successCount' in out.destinations[0], false);
});
test('mismatched destination never echoes unexpected account/action', async () => {
  const body = payload(); body.requestStatusPerDestination[0].destination.operatingAccount.accountId = token;
  const h = await load({payload:body}); const out = await h.api[names[0]]();
  assert.equal(out.projectionComplete, false); assert.equal(out.destinations[0].destinationMatch, false);
  assert.equal(out.destinations[0].accountId, null); assert.equal(JSON.stringify(out).includes(token), false);
});
