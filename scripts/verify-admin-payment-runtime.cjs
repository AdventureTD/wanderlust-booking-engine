// Actual page/backend, inert SDK. Missing ID behavior from published Wix selector.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./admin-payment-fixture.cjs');
const vm = require('node:vm');
// Original independent witnesses, preserved verbatim.
test('REVIEW full initialization four detail renders absent legacy controls single payment',async()=>{const f=fixture();missing(f,['#btnRecordPayment','#btnRecordRefund','#paymentStatusText']);for(const r of f.ready)await r();for(let i=0;i<4;i++)await f.open();f.input();await f.click();assert.equal(f.rpc,1);assert.equal(f.rows.length,1);assert.equal(f.el('#btnPmtSave').handlers.length,1);assert.equal(f.el('#btnPmtSave').label,'Recorded');});
test('REVIEW optional wrong-type legacy controls ignored',async()=>{const f=fixture();const old=f.page.$w;f.page.$w=id=>['#btnRecordPayment','#btnRecordRefund'].includes(id)?{disable:1,enable:'bad'}:old(id);await f.open();f.input();await f.click();assert.equal(f.rpc,1);});
test('REVIEW throwing disable getter releases busy gate after repair',async()=>{const f=fixture();await f.open();f.input();const b=f.el('#btnPmtSave');const original=b.disable;Object.defineProperty(b,'disable',{configurable:true,get(){throw Error('synthetic control getter');}});await f.click().catch(()=>{});Object.defineProperty(b,'disable',{configurable:true,writable:true,value:original});await f.click();assert.equal(f.rpc,1,'repaired control must not leave permanent zero-RPC busy latch');});
test('REVIEW hidden status show/expand errors retain finite button feedback',async()=>{const f=fixture();await f.open();f.input();const s=f.el('#paymentStatusText');s.show=()=>{throw Error('synthetic show');};s.expand=()=>{throw Error('synthetic expand');};f.el('#inputPayAmount').value='';await f.click();assert.equal(f.rpc,0);assert.equal(f.el('#btnPmtSave').label,'Check payment details');});
test('REVIEW arbitrary RPC exception not copied into newly shown status',async()=>{const f=fixture();await f.open();f.input();f.page.adminRecordPayment=async()=>{throw Error('SYNTHETIC_PRIVATE_PAYMENT_NOTE');};await f.click();assert.equal(f.rows.length,0);assert.ok(!f.el('#paymentStatusText').text.includes('SYNTHETIC_PRIVATE_PAYMENT_NOTE'),'finite status must not echo arbitrary backend exception');});
test('REVIEW missing status stale completion leaves new view label and input intact',async()=>{const f=fixture();missing(f,['#paymentStatusText']);await f.open();f.input();let release,entered;const started=new Promise(r=>entered=r);const gate=new Promise(r=>release=r);const original=f.page.adminRecordPayment;f.page.adminRecordPayment=async p=>{entered();await gate;return original(p);};const watchdog=setTimeout(()=>{throw Error('RPC barrier timeout');},2000);const p=f.click();await started;clearTimeout(watchdog);vm.runInContext('_detailRevision++; _currentBooking = {bookingNumber:"NEW-SYNTHETIC"};',f.page);f.el('#inputPayAmount').value='777';f.el('#btnPmtSave').label='New view';release();await p;assert.equal(f.rpc,1);assert.equal(f.el('#inputPayAmount').value,'777');assert.equal(f.el('#btnPmtSave').label,'New view');});
test('REVIEW missing status known ACK cleanup failure reports payment recorded',async()=>{const f=fixture();missing(f,['#paymentStatusText']);await f.open();f.input();Object.defineProperty(f.el('#inputPayAmount'),'value',{get(){return '100.00';},set(){throw Error('synthetic setter');}});await f.click();assert.equal(f.rpc,1);assert.equal(f.rows.length,1);assert.equal(f.el('#btnPmtSave').label,'Payment recorded');});
for (const absent of [['#btnRecordPayment'], ['#btnRecordRefund'], ['#btnRecordPayment', '#btnRecordRefund', '#paymentStatusText']]) {
  test('Save absent-selector boundary ' + absent.join(','), async () => {
    const f = fixture({rpcLost:true});
    missing(f, absent);
    for (const ready of f.ready) await ready();
    await f.open(); await f.open(); f.input();
    await f.click(); await f.click();
    assert.equal(f.rpc, 2);
    assert.equal(f.rows.length, 1);
    assert.equal(f.requests[0].operationId, f.requests[1].operationId);
    assert.equal(f.el('#btnPmtSave').handlers.length, 1);
    assert.equal(f.el('#btnPmtSave').enabled, true);
    f.input(); await f.click();
    assert.equal(f.rows.length, 2);
    assert.notEqual(f.requests[1].operationId, f.requests[2].operationId);
  });
}
for (const capability of ['noCrypto', 'noSubtle', 'noGetRandomValues', 'noRandomUUID']) {
  test('worker capability boundary ' + capability, async () => {
    const f = fixture();
    const real = f.page.crypto;
    f.page.crypto = capability === 'noCrypto' ? undefined : {
      subtle: capability === 'noSubtle' ? undefined : real.subtle,
      getRandomValues: capability === 'noGetRandomValues' ? undefined : real.getRandomValues.bind(real),
    };
    missing(f, ['#btnRecordPayment', '#btnRecordRefund', '#paymentStatusText']);
    await f.open(); f.input(); await f.click();
    assert.equal(f.rpc, capability === 'noRandomUUID' ? 1 : 0);
    assert.equal(f.rows.length, capability === 'noRandomUUID' ? 1 : 0);
    assert.equal(f.el('#btnPmtSave').label, capability === 'noRandomUUID' ? 'Recorded' : 'Check payment details');
    assert.equal(f.el('#btnPmtSave').enabled, true);
  });
}
test('existing hidden payment status is shown without exposing payload in fallback label', async () => {
  const f = fixture(); await f.open(); f.input();
  const status=f.el('#paymentStatusText'); let shown=0,expanded=0;
  status.show=()=>shown++;status.expand=()=>expanded++;
  f.el('#inputPayAmount').value=''; await f.click();
  assert.match(status.text,/Please enter a positive amount/);
  assert.equal(shown,1); assert.equal(expanded,1); assert.equal(f.rpc,0);
});
for (const property of ['disable', 'enable', 'enabled']) {
  test('control getter ' + property + ' cannot strand Save', async () => {
    const f=fixture(); await f.open(); f.input(); const b=f.el('#btnPmtSave'); const original=b[property];
    Object.defineProperty(b,property,{configurable:true,get(){throw Error('private control detail');}});
    await f.click().catch(()=>{});
    Object.defineProperty(b,property,{configurable:true,writable:true,value:original});
    await f.click(); assert.equal(f.rpc,1); assert.equal(f.rows.length,1);
  });
}
for (const fault of ['show-throw', 'expand-throw', 'show-reject', 'expand-reject', 'text-getter', 'selector']) {
  test('finite button feedback survives status ' + fault, async () => {
    const f=fixture(); await f.open(); f.input(); f.el('#inputPayAmount').value='';
    const status=f.el('#paymentStatusText');
    if (fault==='selector') { const w=f.page.$w; f.page.$w=id=>{if(id==='#paymentStatusText')throw Error('private');return w(id);}; }
    else if(fault==='text-getter') Object.defineProperty(status,'text',{get(){throw Error('private');}});
    else status[fault.split('-')[0]]=()=>{if(fault.endsWith('reject'))return Promise.reject(Error('private'));throw Error('private');};
    await f.click(); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.rpc,0); assert.equal(f.el('#btnPmtSave').label,'Check payment details');
  });
}
for (const [index, failure] of [Error('SYNTHETIC_PRIVATE_PAYMENT_NOTE'), {message:'Invalid payment details PRIVATE'}, {get message(){throw Error('private');}}, {code:'WDE0074',message:'private SDK detail'}].entries()) {
  test('RPC exception has finite private-free feedback ' + index, async () => {
    const f=fixture(); await f.open(); f.input(); let calls=0; const logs=[];
    f.page.console={log(){},warn(...args){logs.push(args);},error(...args){logs.push(args);}};
    f.page.adminRecordPayment=async()=>{calls++;throw failure;};
    await f.click(); assert.equal(calls,1); assert.match(f.el('#paymentStatusText').text,/Payment not confirmed/);
    assert.doesNotMatch(f.el('#paymentStatusText').text,/PRIVATE|private|SDK/); assert.equal(logs.length,0);
    assert.ok(f.storage.get('wbe.adminPayment.journal.v1'));
  });
}
test('known backend old-page error maps to controlled version instruction',async()=>{
  const f=fixture();await f.open();f.input();f.page.adminRecordPayment=async()=>{throw Error('Payment operation ID required. Reload the updated admin page; do not repeat an uncertain old-page payment.');};
  await f.click();assert.match(f.el('#paymentStatusText').text,/updated admin page/);
});
test('success feedback does not echo warning or payment identifier',async()=>{
 const f=fixture();await f.open();f.input();f.page.adminRecordPayment=async()=>({ok:true,paymentId:'PRIVATE_ID',warning:'PRIVATE_NOTE'});
 await f.click();assert.doesNotMatch(f.el('#paymentStatusText').text,/PRIVATE/);assert.match(f.el('#paymentStatusText').text,/Recorded/);
});
test('optional control selector exceptions are contained per selector', async () => {
  const f=fixture(); await f.open(); f.input(); const w=f.page.$w;
  f.page.$w=id=>{if(id==='#btnRecordPayment')throw Error('private selector');return w(id);};
  await f.click(); assert.equal(f.rpc,1); assert.equal(f.rows.length,1); assert.equal(f.el('#btnPmtSave').enabled,true);
});
test('late rejected visibility cannot overwrite newer booking feedback', async () => {
  const f=fixture();await f.open();f.input();f.el('#inputPayAmount').value='';let reject;
  const pending=new Promise((_,r)=>reject=r);f.el('#paymentStatusText').show=()=>pending;
  await f.click();vm.runInContext('_detailRevision++; _currentBooking={bookingNumber:"NEW-SYNTHETIC"};',f.page);
  f.el('#btnPmtSave').label='New view';f.el('#paymentStatusText').text='New status';
  reject(Error('private'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.el('#btnPmtSave').label,'New view');assert.equal(f.el('#paymentStatusText').text,'New status');assert.equal(f.rpc,0);
});
function missing(f, ids) {
  const original = f.page.$w;
  const w = id => ids.includes(id) ? [] : original(id);
  w.onReady = original.onReady;
  f.page.$w = w;
}
test('one Save works when optional legacy buttons are absent (Wix returns [])', async () => {
  const f = fixture();
  missing(f, ['#btnRecordPayment', '#btnRecordRefund']);
  for (const ready of f.ready) await ready();
  await f.open(); f.input();
  assert.equal(f.el('#btnPmtSave').handlers.length, 1);
  await f.click();
  assert.equal(f.rpc, 1, f.el('#paymentStatusText').text);
  assert.equal(f.rows.length, 1);
  assert.equal(f.el('#btnPmtSave').enabled, true);
});
test('payment error remains visible when the optional status text is absent', async () => {
  const f = fixture();
  missing(f, ['#paymentStatusText']);
  await f.open(); f.input();
  f.el('#inputPayAmount').value = '';
  await f.click();
  assert.equal(f.rpc, 0);
  assert.equal(f.el('#btnPmtSave').label, 'Check payment details');
  assert.equal(f.el('#btnPmtSave').enabled, true);
});
