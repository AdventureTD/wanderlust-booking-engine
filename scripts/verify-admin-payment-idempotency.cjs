const {fixture}=require('./admin-payment-fixture.cjs');
const assert=require('node:assert/strict');
const test=require('node:test');
test('concurrent duplicate backend operation inserts once',async()=>{
 const f=fixture();await Promise.all([f.api.adminRecordPayment(f.request),f.api.adminRecordPayment(f.request)]);assert.equal(f.rows.length,1);
});
test('shared synchronous gate blocks doubledispatch across controls',async()=>{
 const f=fixture();f.ready[0]();await f.open();f.input();await Promise.all([f.click(),f.click('#btnRecordPayment')]);assert.equal(f.rpc,1);assert.equal(f.rows.length,1);
});
test('repeated onReady binds legacy payment and refund once',async()=>{
 const f=fixture();f.ready[0]();f.ready[0]();assert.equal(f.el('#btnRecordPayment').handlers.length,1);assert.equal(f.el('#btnRecordRefund').handlers.length,1);
});
test('RPC acknowledgment lost preserves operation on retry',async()=>{
 const f=fixture({rpcLost:true});await f.open();f.input();await f.click();await f.click();assert.equal(f.rows.length,1);assert.equal(f.requests[0].operationId,f.requests[1].operationId);assert.ok(f.requests[0].operationId);
});
test('four actual detail renders and ONE click produce ONE payment',async()=>{
 const f=fixture();for(let i=0;i<4;i++)await f.open();f.input();await f.click();
 assert.equal(f.rows.length,1);assert.equal(f.rpc,1);assert.equal(f.el('#btnPmtSave').handlers.length,1);
});
