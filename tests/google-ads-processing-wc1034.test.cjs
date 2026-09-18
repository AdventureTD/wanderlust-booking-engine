const {test} = require('node:test');
const assert = require('node:assert/strict');
const {load,payload,token} = require('./google-ads-processing-test-helper.cjs');
const name = 'readWC1034ProcessingStatus';
const id = '82e091ac-6686-4a7d-ab9e-5a2aada23c32';

test('WC1034 arguments deny before any auth or GET, including undefined', async () => {
  for (const args of [[undefined],[null],['other-id'],[{}],[1,2]]) {
    const h = await load();
    const out = await h.api[name](...args);
    assert.equal(out.failureCode,'ARGUMENTS_NOT_ALLOWED');
    assert.equal(out.requestId,id);
    assert.equal(h.authCalls(),0); assert.equal(h.calls.length,0);
    assert.equal(h.timers.size,0);
  }
});
test('WC1034 awaits auth and fences late auth after original deadline', async () => {
  for (const timeout of [false,true]) {
    let release;
    const h = await load({auth:()=>new Promise(resolve=>{release=resolve;})});
    const pending = h.api[name]();
    assert.equal(h.authCalls(),1); assert.equal(h.calls.length,0);
    assert.equal([...h.timers.values()][0].ms,15000);
    if (timeout) [...h.timers.values()][0].fn();
    release(token);
    const out = await pending;
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.calls.length,timeout?0:1);
    assert.equal(out.failureCode,timeout?'TIMEOUT':null);
    assert.equal(h.timers.size,0);
    assert.equal(JSON.stringify(out).includes(token),false);
  }
});
test('WC1034 preserves finite statuses and totals, never claims attributed count', async () => {
  for (const status of ['SUCCESS','FAILED','PARTIAL_SUCCESS','PROCESSING','REQUEST_STATUS_UNKNOWN','PRIVATE_STATUS']) {
    const body=payload(status);
    const row=body.requestStatusPerDestination[0];
    if(status==='PARTIAL_SUCCESS') row.errorInfo=payload('FAILED').requestStatusPerDestination[0].errorInfo;
    row.eventsIngestionStatus.recordCount='9223372036854775807';
    row.privateContact=token;
    const h=await load({payload:body}); const out=await h.api[name]();
    assert.equal(out.destinations[0].requestStatus,status==='PRIVATE_STATUS'?'REQUEST_STATUS_UNKNOWN':status);
    assert.equal(out.destinations[0].recordCount,'9223372036854775807');
    assert.equal(out.projectionComplete,['SUCCESS','FAILED','PARTIAL_SUCCESS'].includes(status));
    assert.equal('successCount' in out.destinations[0],false);
    assert.equal('attributedCount' in out.destinations[0],false);
    assert.equal(JSON.stringify(out).includes(token),false); assert.equal(h.logs.length,0);
  }
});
test('WC1034 mismatched destination and unknown private reasons fail closed without disclosure', async () => {
  const body=payload(); const row=body.requestStatusPerDestination[0];
  row.destination.operatingAccount.accountId='0000000000';
  row.errorInfo.errorCounts[0]={reason:token,recordCount:'-1',message:token};
  const h=await load({payload:body}); const out=await h.api[name]();
  assert.equal(out.projectionComplete,false); assert.equal(out.unknownReasonPresent,true);
  assert.equal(out.destinations[0].accountId,null);
  assert.equal(out.destinations[0].errors[0].reason,'UNKNOWN');
  assert.equal(out.destinations[0].errors[0].recordCount,null);
  assert.equal(JSON.stringify(out).includes(token),false);
});
test('WC1034 HTTP error never reads provider body; auth rejection never starts GET', async () => {
  let bodies=0;
  const h=await load({fetch:()=>({status:403,text:()=>{bodies++;throw Error(token);}})});
  const out=await h.api[name]();
  assert.equal(out.failureCode,'HTTP_ERROR'); assert.equal(bodies,0);
  assert.equal(h.calls.length,1); assert.equal(JSON.stringify(out).includes(token),false);
  const denied=await load({auth:()=>Promise.reject(Error(token))});
  assert.equal((await denied.api[name]()).failureCode,'AUTH_FAILED');
  assert.equal(denied.calls.length,0); assert.equal(denied.logs.length,0);
});

test('WC1034 native ESM fixed zero-arg reader performs exactly one encoded GET', async () => {
  const h = await load({payload:payload('SUCCESS')});
  assert.equal(typeof h.api[name], 'function');
  assert.equal(h.api[name].length, 0);
  const out = await h.api[name]();
  assert.equal(out.requestId,id);
  assert.equal(h.authCalls(),1);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].url,'https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId='+encodeURIComponent(id));
  assert.deepEqual(h.calls[0].init.method,'GET');
  assert.equal('body' in h.calls[0].init,false);
  assert.equal(h.calls[0].init.headers.Authorization,'Bearer '+token);
  assert.equal(out.destinations[0].accountId,'9426928570');
  assert.equal(out.destinations[0].productDestinationId,'7690532327');
  assert.equal(out.destinations[0].recordCount,'1');
  assert.equal(out.destinations[0].requestStatus,'SUCCESS');
  assert.equal(out.projectionComplete,true);
  assert.equal(JSON.stringify(out).includes(token),false);
  assert.equal(h.logs.length,0);
  assert.equal(h.timers.size,0);
});
