'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./complete-cancellation.cjs');
const {fixture:page}=require('./cancellation-page.cjs');
const emailCalls=f=>f.calls.filter(x=>x[0]==='network'&&x[1].endsWith('/send-cancellation-email'));
test('recovery: actual multiple SDK pages preserve WC-1036 and all financial history',async()=>{
 const f=await fixture({count:1001});
 f.db.Bookings.push({_id:'other',bookingNumber:'WC-1036',roomCode:'suite',quantity:2,status:'confirmed'});
 f.db.BookingSummary.push({_id:'other-summary',bookingNumber:'WC-1036',status:'confirmed',roomCount:2});
 const before=JSON.stringify([f.db.Bookings.at(-1),f.db.BookingSummary.at(-1),f.db.BookingInvoices,f.db.BookingPayments]);
 await f.api.adminCancelBooking('WC-1038','');
 assert.equal(f.db.Bookings.filter(x=>x.bookingNumber==='WC-1038'&&x.status==='Cancelled').length,1001);
 assert.equal(JSON.stringify([f.db.Bookings.at(-1),f.db.BookingSummary.at(-1),f.db.BookingInvoices,f.db.BookingPayments]),before);
});
test('recovery: each child and Summary failure resumes without premature email',async()=>{
 for(const fail of ['Bookings:r0','Bookings:r1','Bookings:r2','BookingSummary:s']){
  const f=await fixture({count:3,fail});await assert.rejects(f.api.adminCancelBooking('WC-1038',''),/WRITE_FAILURE/);
  assert.equal(emailCalls(f).length,0);
  const retry=await fixture({},f.db);const result=await retry.api.adminCancelBooking('WC-1038','');
  assert.equal(result.reservation,'CANCELLED');assert.ok(retry.db.Bookings.every(x=>x.status==='Cancelled'));assert.equal(emailCalls(retry).length,1);
 }
});
test('recovery: malformed or lost send response never automatically resends',async()=>{
 for(const option of ['malformed','sendFail']){
  const f=await fixture({count:1,[option]:true});const result=await f.api.adminCancelBooking('WC-1038','');assert.equal(result.effects.email,'UNKNOWN');
  const retry=await fixture({},f.db);assert.equal((await retry.api.adminCancelBooking('WC-1038','')).effects.email,'UNKNOWN');assert.equal(emailCalls(retry).length,0);
 }
});
test('recovery: pre-send configuration failure can retry safely',async()=>{
 const f=await fixture({count:1,secretFail:true});const result=await f.api.adminCancelBooking('WC-1038','');assert.equal(result.effects.email,'UNSENT_CONFIGURATION');assert.equal(emailCalls(f).length,0);
 const retry=await fixture({},f.db);assert.equal((await retry.api.adminCancelBooking('WC-1038','')).effects.email,'ACKNOWLEDGED');assert.equal(emailCalls(retry).length,1);
});
test('recovery: no or duplicate Summary and absent children reject without mutation',async()=>{
 for(const mode of ['empty','duplicate','children']){
  const f=await fixture({count:1});if(mode==='empty')f.db.BookingSummary=[];if(mode==='duplicate')f.db.BookingSummary.push({...f.db.BookingSummary[0],_id:'duplicate'});if(mode==='children')f.db.Bookings=[];
  await assert.rejects(f.api.adminCancelBooking('WC-1038',''));assert.equal(f.calls.filter(x=>['insert','update','network'].includes(x[0])).length,0);
 }
});
test('recovery: all visible current balances respect no-fee settlement',async()=>{
 const f=page(),p=f.api.openDetail('WC-1038');f.loads.get('WC-1038')({ok:true,summary:{bookingNumber:'WC-1038',status:'Cancelled',cancellationSettlement:'FULL_NO_FEE'},rooms:[{_id:'r',quantity:1}],totals:{grandTotal:22286.74,totalPaid:0,totalRefunded:0,balance:0}});await p;
 assert.equal(f.$w('#remBalance').text,f.$w('#balanceText').text);
 assert.match(f.$w('#invoiceTotalText').text,/historical/i);
});
test('recovery: loading and failed selection disable destructive button',async()=>{
 const f=page();const p=f.api.openDetail('WC-1038');assert.equal(f.$w('#btnCancelBooking').disabled,true);
 f.loads.get('WC-1038')({ok:false});await p;assert.equal(f.$w('#btnCancelBooking').disabled,true);
});
