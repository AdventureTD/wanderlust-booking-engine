const {fixture}=require('./admin-payment-fixture.cjs');
const assert=require('node:assert/strict'); const test=require('node:test'); const fs=require('node:fs');
const KEY='wbe.adminPayment.pending.v1';const observations=[];
// Original reviewer assertions below are unchanged; observations stay in memory.
const tok=n=>n.toString(16).padStart(32,'0');
test('INDEPENDENT: failed amount clearing cannot turn unchanged retry into new payment',async()=>{
 const f=fixture();await f.open();f.input();f.el('#notes').value='';
 const amount=f.el('#inputPayAmount');Object.defineProperty(amount,'value',{get:()=> '100.00',set:()=>{throw Error('UI setter unavailable');},configurable:true});
 await f.click();await f.click();observations.push({case:'clear-input-failure',rows:f.rows.length,requests:f.requests,status:f.el('#paymentStatusText').text});assert.equal(f.rows.length,1,'unchanged submitted fields must not silently mint another operation after failed clearing');
});
test('INDEPENDENT: post-delete storage read failure and reload must not duplicate',async()=>{
 const f=fixture();await f.open();f.input();const get=f.page.session.getItem;const remove=f.page.session.removeItem;let removed=false;
 f.page.session.removeItem=k=>{remove(k);removed=true;};f.page.session.getItem=k=>{if(removed)throw Error('storage read unavailable');return get(k);};
 await f.click();const firstStatus=f.el('#paymentStatusText').text;const g=fixture({storage:f.storage,retainedRows:f.rows});await g.open();g.input();await g.click();
 observations.push({case:'post-delete-read-failure-reload',rows:g.rows.length,firstStatus,first:f.requests,second:g.requests});assert.equal(g.rows.length,1,'failure UI plus lost recovery token must not cause a new identity on same-tab recovery');
});
test('INDEPENDENT: concurrent same operation returns winner when fourth slot fills during summary read',async()=>{
 const f=fixture();for(let i=1;i<=3;i++)await f.api.adminRecordPayment({...f.request,operationId:tok(i)});
 const query=f.ctx.wixData.query;let blocked=false,release,entered;const gate=new Promise(r=>release=r),seen=new Promise(r=>entered=r);
 f.ctx.wixData.query=c=>{const q=query(c);if(c==='BookingSummary'&&!blocked){const find=q.find;q.find=async()=>{blocked=true;entered();await gate;return find();};}return q;};
 const watchdog=setTimeout(()=>release(),2000);try{const b=f.api.adminRecordPayment(f.request);await seen;const a=await f.api.adminRecordPayment(f.request);release();const result=await b;observations.push({case:'capacity-replay-race',winner:a,contender:result,rows:f.rows.length});assert.equal(result.ok,true,'same already recorded operation must return recorded result, not cap error');}finally{release();clearTimeout(watchdog);}
});
test('INDEPENDENT: default date remains original across midnight uncertain retry',async()=>{
 const f=fixture({rpcLost:true});await f.open();f.input();f.el('#inputPayDate').value='';let now='2026-10-20T23:59:59.000Z';class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}}f.page.Date=Clock;
 await f.click();now='2026-10-21T00:00:01.000Z';await f.click();observations.push({case:'default-date-retry',rpc:f.rpc,rows:f.rows.length,status:f.el('#paymentStatusText').text});assert.equal(f.rpc,2,'unchanged blank-date UI should reconcile original payload');assert.equal(f.requests[0].datePaid,f.requests[1].datePaid);
});
for(const failure of ['throw','noop','stale'])test('INDEPENDENT: storage remove '+failure+' retains same operation',async()=>{
 const f=fixture();await f.open();f.input();const remove=f.page.session.removeItem;let old;f.page.session.removeItem=k=>{old=f.storage.get(k);if(failure==='throw')throw Error('cannot remove');if(failure==='stale'){remove(k);f.storage.set(k,old);}};
 await f.click();assert.equal(f.rows.length,1);f.page.session.removeItem=remove;await f.click();assert.equal(f.rows.length,1);assert.equal(f.requests[0].operationId,f.requests[1].operationId);
});
for(const pending of ['{"id":"bad"}','A'.repeat(32),'a'.repeat(32)+'\n','null'])test('INDEPENDENT: malformed pending token denied '+JSON.stringify(pending),async()=>{
 const f=fixture({storage:new Map([[KEY,pending]])});await f.open();f.input();await f.click();assert.equal(f.rpc,0);assert.equal(f.rows.length,0);assert.equal(f.storage.get(KEY),pending);
});
test('INDEPENDENT: storage set no-op fails closed',async()=>{const f=fixture();await f.open();f.input();f.page.session.setItem=()=>{};await f.click();assert.equal(f.rpc,0);});
test('INDEPENDENT: permission read rejection never becomes absent authority',async()=>{const f=fixture();f.ctx.wixData.get=async()=>{throw Object.assign(Error('permission denied'),{code:'WDE0027'});};await assert.rejects(f.api.adminRecordPayment(f.request),/permission/);assert.equal(f.writes.length,0);});
test('INDEPENDENT: direct missing get error fails closed rather than inserting',async()=>{const f=fixture();f.ctx.wixData.get=async()=>{throw Object.assign(Error('not found'),{code:'WDE0073'});};await assert.rejects(f.api.adminRecordPayment(f.request));assert.equal(f.writes.length,0);});
test('INDEPENDENT: two page realms same pending token native insert wins once',async()=>{const rows=[],storage=new Map([[KEY,tok(10)]]);const a=fixture({storage:new Map(storage),retainedRows:rows}),b=fixture({storage:new Map(storage),retainedRows:rows});await a.open();await b.open();a.input();b.input();await Promise.all([a.click(),b.click()]);assert.equal(rows.length,1);assert.equal(a.rpc+b.rpc,2);});
test('INDEPENDENT: independent tabs identical intentional entries stay distinct',async()=>{const rows=[];const a=fixture({retainedRows:rows}),b=fixture({retainedRows:rows});await a.open();await b.open();a.input();b.input();await Promise.all([a.click(),b.click()]);assert.equal(rows.length,2);assert.notEqual(rows[0]._id,rows[1]._id);});
test('INDEPENDENT: transport rejects before server then unchanged retry',async()=>{const f=fixture();await f.open();f.input();const rpc=f.page.adminRecordPayment;let first;f.page.adminRecordPayment=async p=>{first={...p};throw Error('transport unavailable');};await f.click();assert.equal(f.rows.length,0);f.page.adminRecordPayment=rpc;await f.click();assert.equal(f.rows.length,1);assert.equal(first.operationId,f.requests[0].operationId);});
test('INDEPENDENT: lost RPC ACK then explicit detail refresh preserves retry token',async()=>{const f=fixture({rpcLost:true});await f.open();f.input();await f.click();await f.open();await f.click();assert.equal(f.rows.length,1);assert.equal(f.requests[0].operationId,f.requests[1].operationId);});
test('INDEPENDENT: successful ACK followed by refresh rejection does not resend on empty input',async()=>{const f=fixture();await f.open();f.input();f.page.adminGetBooking=async()=>{throw Error('refresh unavailable');};await f.click();await f.click();assert.equal(f.rows.length,1);assert.equal(f.rpc,1);});
test('INDEPENDENT: old recovered token with changed booking conflicts without overwrite',async()=>{const f=fixture();await f.api.adminRecordPayment(f.request);const g=fixture({storage:new Map([[KEY,f.request.operationId]]),retainedRows:f.rows});await g.open();g.input();const get=g.page.adminGetBooking;g.page.adminGetBooking=async()=>{const d=await get('AUDIT-SYNTHETIC');return {...d,summary:{...d.summary,bookingNumber:'OTHER'}};};await g.page.audit.openDetail('OTHER');await g.click();assert.equal(g.rows.length,1);assert.match(g.el('#paymentStatusText').text,/conflicts/);assert.equal(g.storage.get(KEY),f.request.operationId);});
test('INDEPENDENT: revoked admin replay rejected',async()=>{const f=fixture();await f.api.adminRecordPayment(f.request);f.ctx.currentUser.loggedIn=false;await assert.rejects(f.api.adminRecordPayment(f.request),/Unauthorized/);assert.equal(f.writes.length,1);});

for (const refund of [false,true]) for (const reload of [false,true]) test(`FIX: failed clear retains ACK across reload=${reload} refund=${refund}`,async()=>{
 const f=fixture();await f.open();f.input();if(refund)f.el('#inputPayAmount').value='-100';
 const amount=f.el('#inputPayAmount'),original=amount.value;Object.defineProperty(amount,'value',{get:()=>original,set:()=>{throw Error('clear fault');},configurable:true});
 await f.click();assert.equal(f.rows.length,1);assert.match(f.el('#paymentStatusText').text,/recorded/i);
 const g=reload?fixture({storage:f.storage,retainedRows:f.rows}):f;if(reload){await g.open();g.input();if(refund)g.el('#inputPayAmount').value='-100';}
 await g.click();assert.equal(g.rows.length,1);assert.equal(g.requests.at(-1).operationId,f.requests[0].operationId);
});
for(const refund of [false,true])for(const reload of [false,true])for(const dates of [
 ['2026-03-07T23:59:59-05:00','2026-03-09T00:00:01-04:00'],
 ['2026-10-31T23:59:59-04:00','2026-11-02T00:00:01-05:00']
])test(`FIX: frozen blank date DST ${dates[0]} refund=${refund} reload=${reload}`,async()=>{
 const f=fixture();await f.open();f.input();if(refund)f.el('#inputPayAmount').value='-100';f.el('#inputPayDate').value='';
 let now=dates[0];class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}}f.page.Date=Clock;
 const method=refund?'adminRecordRefund':'adminRecordPayment',rpc=f.page[method];f.page[method]=async p=>{await rpc(p);throw Error('ACK lost');};await f.click();
 assert.equal(f.rows.length,1);now=dates[1];const g=reload?fixture({storage:f.storage,retainedRows:f.rows}):f;
 if(reload){await g.open();g.input();if(refund)g.el('#inputPayAmount').value='-100';g.el('#inputPayDate').value='';}else g.page[method]=rpc;
 g.page.Date=Clock;await g.click();assert.equal(g.rows.length,1);assert.equal(g.requests.at(-1).operationId,f.requests[0].operationId);assert.equal(g.requests.at(-1).datePaid,f.requests[0].datePaid);assert.equal(g.rpc,reload?1:2);
});
test('FIX: changed explicit date after reload conflicts before RPC',async()=>{const f=fixture({rpcLost:true});await f.open();f.input();await f.click();const g=fixture({storage:f.storage,retainedRows:f.rows});await g.open();g.input();g.el('#inputPayDate').value='2026-10-21';await g.click();assert.equal(g.rpc,0);assert.equal(g.rows.length,1);});
test('FIX: failed clear and automatic detail render never fabricates fresh intent',async()=>{const f=fixture();await f.open();f.input();const a=f.el('#inputPayAmount');Object.defineProperty(a,'value',{get:()=> '100',set:()=>{},configurable:true});await f.click();await f.open();await f.click();assert.equal(f.rows.length,1);assert.equal(f.requests[0].operationId,f.requests[1].operationId);});
test('FIX: journal carries only token hash date state and canonical digest',async()=>{const f=fixture({rpcLost:true});await f.open();f.input();f.el('#notes').value='private note é 🏝';await f.click();assert.equal(f.rows.length,1);const j=JSON.parse(f.storage.get('wbe.adminPayment.journal.v1'));assert.deepEqual(Object.keys(j).sort(),['date','fingerprint','id','state']);const crypto=require('node:crypto');const p=f.requests[0];const canonical=JSON.stringify([false,p.bookingNumber,100,p.datePaid,p.paymentMethod,p.note]);assert.equal(j.fingerprint,crypto.createHash('sha256').update(canonical).digest('hex'));assert.equal(JSON.stringify([...f.storage]).includes('private note'),false);assert.equal(JSON.stringify([...f.storage]).includes(p.bookingNumber),false);});
for(const fault of ['read','write','write-applied-read'])test('FIX: acknowledged storage '+fault+' never permits a second identity',async()=>{
 const f=fixture();await f.open();f.input();const get=f.page.session.getItem,set=f.page.session.setItem,rpc=f.page.adminRecordPayment;
 f.page.adminRecordPayment=async p=>{const result=await rpc(p);if(fault==='read')f.page.session.getItem=()=>{throw Error('read fault');};else if(fault==='write')f.page.session.setItem=()=>{throw Error('write fault');};else f.page.session.setItem=(k,v)=>{set(k,v);f.page.session.getItem=()=>{throw Error('postwrite read fault');};};return result;};
 await f.click();assert.match(f.el('#paymentStatusText').text,/recorded/i);assert.equal(f.rows.length,1);await f.click();assert.equal(f.rpc,1);
 const g=fixture({storage:f.storage,retainedRows:f.rows});await g.open();g.input();await g.click();assert.equal(g.rows.length,1);assert.equal(g.requests[0].operationId,f.requests[0].operationId);
});
test('FIX: fingerprint uses existing server rounding at fractional cents',async()=>{const f=fixture({rpcLost:true});await f.open();f.input();f.el('#inputPayAmount').value='1.005';await f.click();assert.equal(f.rows.length,1);const j=JSON.parse(f.storage.get('wbe.adminPayment.journal.v1')),p=f.requests[0];const canonical=JSON.stringify([false,p.bookingNumber,f.rows[0].paymentAmount,p.datePaid,p.paymentMethod,p.note]);assert.equal(j.fingerprint,require('node:crypto').createHash('sha256').update(canonical).digest('hex'));});
for(const refund of [false,true])for(const fault of ['full','throw','read-throw','absent'])test(`FIX: capacity loser ${fault} refund=${refund}`,async()=>{
 const f=fixture();const method=refund?'adminRecordRefund':'adminRecordPayment';for(let i=1;i<=3;i++)await f.api.adminRecordPayment({...f.request,operationId:tok(i)});
 const query=f.ctx.wixData.query;let blocked=false,release,entered;const gate=new Promise(r=>release=r),seen=new Promise(r=>entered=r);
 f.ctx.wixData.query=c=>{const q=query(c);if(c==='BookingSummary'&&!blocked){const find=q.find;q.find=async()=>{blocked=true;entered();await gate;return find();};}return q;};
 const watchdog=setTimeout(()=>release(),2000);try{const loser=f.api[method](f.request);await seen;const winner=await f.api[method](f.request);
 if(fault==='throw')f.ctx.wixData.query=c=>{const q=query(c);if(c==='BookingPayments')q.find=async()=>{throw Error('capacity read fault');};return q;};
 if(fault==='read-throw')f.ctx.wixData.get=async()=>{throw Error('winner read fault');};if(fault==='absent')f.ctx.wixData.get=async()=>null;
 release();if(fault==='read-throw')await assert.rejects(loser,/winner read/);else {const r=await loser;assert.equal(r.ok,fault!=='absent');if(r.ok)assert.equal(r.paymentId,winner.paymentId);}assert.equal(f.rows.length,4);assert.equal(f.writes.length,4);
 }finally{release();clearTimeout(watchdog);}
});
for(const refund of [false,true])for(const fault of ['throw','noop','stale'])test(`FIX: removal ${fault} plus reload refund=${refund}`,async()=>{const f=fixture();await f.open();f.input();if(refund)f.el('#inputPayAmount').value='-100';const remove=f.page.session.removeItem;f.page.session.removeItem=k=>{if(fault==='throw')throw Error('remove fault');if(fault==='stale'){const old=f.storage.get(k);remove(k);f.storage.set(k,old);}};await f.click();const g=fixture({storage:f.storage,retainedRows:f.rows});await g.open();g.input();if(refund)g.el('#inputPayAmount').value='-100';await g.click();assert.equal(g.rows.length,1);assert.equal(f.requests[0].operationId,g.requests[0].operationId);});
test('FIX: successful confirmed clear allows distinct equal-value entry',async()=>{const f=fixture();await f.open();f.input();await f.click();assert.equal(f.el('#inputPayAmount').value,'');f.input();await f.click();assert.equal(f.rows.length,2);assert.notEqual(f.rows[0]._id,f.rows[1]._id);});
