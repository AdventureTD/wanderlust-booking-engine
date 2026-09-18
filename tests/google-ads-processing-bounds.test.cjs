const {test} = require('node:test');
const assert = require('node:assert/strict');
const {load,payload,names,token} = require('./google-ads-processing-test-helper.cjs');
async function observe(options) { const h = await load(options); const out = await h.api[names[0]](); assert.equal(h.logs.length,0); assert.equal(JSON.stringify(out).includes(token),false); assert.equal(h.timers.size,0); return {h,out}; }
test('auth synchronous, Promise and thenable are awaited; invalid/rejected auth is contained', async () => {
  for (const auth of [() => token, () => Promise.resolve(token), () => ({then(resolve){resolve(token);}})]) {
    const {h,out} = await observe({auth}); assert.equal(out.projectionComplete,true); assert.equal(h.calls[0].init.headers.Authorization,'Bearer '+token);
  }
  for (const auth of [() => {throw Error(token);}, () => Promise.reject(Error(token)), () => ({then(a,b){b(Error(token));}}), () => '', () => null, () => ({}), () => 'bad\r\nheader']) {
    const {h,out} = await observe({auth}); assert.equal(out.failureCode,'AUTH_FAILED'); assert.equal(h.calls.length,0);
  }
});
test('HTTP/provider/body failures never expose raw errors and never retry', async () => {
  for (const status of [301,400,401,403,404,429,500,503]) {
    const {h,out} = await observe({fetch: () => ({status,text(){throw Error('must not read failure body');}})});
    assert.equal(out.httpStatus,status); assert.equal(out.failureCode,'HTTP_ERROR'); assert.equal(h.calls.length,1);
  }
  for (const fetch of [() => {throw Error(token);}, () => Promise.reject(Error(token)), () => ({status:200,text:()=>Promise.reject(Error(token))})]) {
    const {h,out} = await observe({fetch}); assert.equal(out.failureCode,'READ_FAILED'); assert.equal(h.calls.length,1);
  }
});
test('preparse UTF8 cap, malformed JSON and response shape failures are explicit', async () => {
  for (const text of ['{', 'null', '[]', '{}', JSON.stringify({requestStatusPerDestination:[]}), 'x'.repeat(65537), 'é'.repeat(32769), 42]) {
    const {out} = await observe({fetch:()=>({status:200,text:()=>text})}); assert.equal(out.projectionComplete,false); assert.notEqual(out.failureCode,null);
  }
  const base = JSON.stringify(payload());
  assert.equal((await observe({fetch:()=>({status:200,text:()=>base+' '.repeat(65536-Buffer.byteLength(base))})})).out.projectionComplete,true);
});
test('counts/shapes/status/union bounds cannot be laundered into success', async () => {
  const edits = [
    b=>b.requestStatusPerDestination=Array(11).fill(b.requestStatusPerDestination[0]),
    b=>b.requestStatusPerDestination[0]=null,
    b=>b.requestStatusPerDestination[0].requestStatus=token,
    b=>delete b.requestStatusPerDestination[0].eventsIngestionStatus,
    b=>b.requestStatusPerDestination[0].audienceMembersIngestionStatus={},
    b=>b.requestStatusPerDestination[0].errorInfo={errorCounts:Array(65).fill({reason:'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND',recordCount:'1'})},
    b=>b.requestStatusPerDestination[0].warningInfo={warningCounts:[null]},
    b=>b.requestStatusPerDestination[0].errorInfo={errorCounts:{}},
    b=>b.requestStatusPerDestination[0].errorInfo=null,
    b=>b.requestStatusPerDestination[0].eventsIngestionStatus.recordCount='9223372036854775808',
    ...['-1','1.5','1e0','01',1,null,token].map(v=>b=>b.requestStatusPerDestination[0].eventsIngestionStatus.recordCount=v)
  ];
  for (const edit of edits) { const body=payload('SUCCESS'); edit(body); const {out}=await observe({payload:body}); assert.equal(out.projectionComplete,false); }
  const body=payload(); body.requestStatusPerDestination[0].requestStatus='SUCCESS';
  assert.equal((await observe({payload:body})).out.projectionComplete,false);
});
test('valid JSON exceeding UTF8 cap is rejected before projection, including multibyte padding', async () => {
  const base=JSON.stringify(payload());
  for(const text of [base+' '.repeat(65537-Buffer.byteLength(base)), JSON.stringify({...payload(),ignored:'é'.repeat(33000)})]) {
    const {out}=await observe({fetch:()=>({status:200,text:()=>text})}); assert.equal(out.failureCode,'RESPONSE_TOO_LARGE');
  }
});
test('all request states, missing error evidence, unknown warnings and numeric extremes stay explicit', async()=>{
  for(const status of ['REQUEST_STATUS_UNKNOWN','PROCESSING','PARTIAL_SUCCESS','FAILED','SUCCESS']) {
    const b=payload(); b.requestStatusPerDestination[0].requestStatus=status;
    if(status==='PROCESSING'||status==='SUCCESS') delete b.requestStatusPerDestination[0].errorInfo;
    const {out}=await observe({payload:b}); assert.equal(out.destinations[0].requestStatus,status);
    assert.equal(out.projectionComplete,!['REQUEST_STATUS_UNKNOWN','PROCESSING'].includes(status));
  }
  for(const value of ['0','9223372036854775807']) {
    const b=payload(); b.requestStatusPerDestination[0].eventsIngestionStatus.recordCount=value;
    assert.equal((await observe({payload:b})).out.destinations[0].recordCount,value);
  }
  const b=payload(); delete b.requestStatusPerDestination[0].errorInfo;
  assert.equal((await observe({payload:b})).out.projectionComplete,false);
  b.requestStatusPerDestination[0].warningInfo={warningCounts:[{reason:token,recordCount:'1'}]};
  const {out}=await observe({payload:b}); assert.equal(out.unknownReasonPresent,true); assert.equal(out.destinations[0].warnings[0].reason,'UNKNOWN');
  b.requestStatusPerDestination[0].warningInfo.warningCounts=Array(65).fill({reason:'PROCESSING_WARNING_REASON_INTERNAL_ERROR',recordCount:'1'});
  assert.equal((await observe({payload:b})).out.failureCode,'INVALID_SCHEMA');
});
test('output capped at 16KiB rather than truncating reason evidence', async () => {
  const body=payload(); const row=body.requestStatusPerDestination[0];
  row.errorInfo.errorCounts=Array(64).fill({reason:'PROCESSING_ERROR_REASON_DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED',recordCount:'9223372036854775807'});
  body.requestStatusPerDestination=Array(10).fill(row);
  // Use 2 rows to remain under input byte cap while exceeding output cap.
  body.requestStatusPerDestination=body.requestStatusPerDestination.slice(0,2);
  const {out}=await observe({payload:body}); assert.equal(out.failureCode,'OUTPUT_TOO_LARGE'); assert.ok(Buffer.byteLength(JSON.stringify(out))<=16384);
});
test('one whole-call deadline bounds auth, fetch and text; late auth cannot GET', async () => {
  for (const stage of ['auth','fetch','text']) {
    let release; const pending=new Promise(r=>release=r);
    const h=await load(stage==='auth'?{auth:()=>pending}:stage==='fetch'?{fetch:()=>pending}:{fetch:()=>({status:200,text:()=>pending})});
    const result=h.api[names[0]]();
    for(let i=0;i<10;i++) await Promise.resolve();
    assert.equal(h.timers.size,1); const timer=[...h.timers.values()][0]; assert.equal(timer.ms,15000); timer.fn();
    const out=await result; assert.equal(out.failureCode,'TIMEOUT'); assert.equal(out.projectionComplete,false);
    release(stage==='auth'?token:stage==='fetch'?{status:200,text:()=>JSON.stringify(payload())}:JSON.stringify(payload()));
    for(let i=0;i<10;i++) await Promise.resolve();
    assert.equal(h.calls.length,stage==='auth'?0:1); assert.equal(h.logs.length,0); assert.equal(h.timers.size,0);
  }
});
