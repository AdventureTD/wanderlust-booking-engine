'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./complete-cancellation.cjs');
const {fixture:pageFixture}=require('./cancellation-page.cjs');
test('late actual invoice date mirror preserves cancelled Summary',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 let release,seen;const reached=new Promise(r=>seen=r),gate=new Promise(r=>release=r);let held=false;
 const f=await fixture({count:1,calendarAck:true,beforeUpdate:async(c,row)=>{if(!held&&c==='BookingSummary'&&row.bookingDate){held=true;seen();await gate;}}});
 const source=fs.readFileSync(path.join(__dirname,'../velo/backend/availability.web.js'),'utf8');
 const code=source.slice(source.indexOf('export const issueBookingInvoice ='),source.indexOf('export const cancelBooking =')).replace('export const','const');
 const helper=fs.readFileSync(path.join(__dirname,'../velo/backend/bookingCancellation.js'),'utf8').replace(/^import.*;$/gm,'').replace(/export /g,'');
 const ctx=vm.createContext({wixData:f.sdk,items:f.patchItems,BOOKINGS:'Bookings',BOOKING_SUMMARIES:'BookingSummary',Date,Permissions:{Anyone:0},webMethod:(p,f)=>f,console:{log(){}},getActiveInvoice:async()=>null,nightsBetween:()=>0,buildQuoteBreakdown:async()=>({}),getNextInvoiceNumber:async()=>'INERT',callIssueInvoice:async()=>({invoice_number:'INERT'}),recordBookingInvoice:async()=>{},toDate:x=>x?new Date(x):null});
 vm.runInContext(helper+'\n'+code+'\nglobalThis.invoke=issueBookingInvoice;',ctx);
 const invoice=ctx.invoke('WC-1038');const watchdog=setTimeout(()=>{release();throw Error('mirror watchdog');},5000);
 try{await reached;assert.equal((await f.api.adminCancelBooking('WC-1038','')).coreComplete,true);release();await invoice;
 assert.equal(f.db.BookingSummary[0].status,'Cancelled');assert.equal((await f.api.adminGetBooking('WC-1038')).cancellation.coreComplete,true);
 }finally{release();clearTimeout(watchdog);}
});
test('actual admin Save excludes cancellation-owned status',async()=>{
 const calls=[];const f=pageFixture({adminUpdateBooking:async(...args)=>{calls.push(args);return {ok:false};}});
 f.api.setBooking({bookingNumber:'WC-1038',status:'confirmed'});f.$w('#inputStatusDropdown').value='confirmed';f.$w('#inputGuestName').value='changed';
 await f.$w('#btnSaveChanges').click();assert.equal(calls.length,1);assert.equal(Object.hasOwn(calls[0][1],'status'),false);
});
for(const kind of ['missing','extra','active','quantity','count','settlement','summary'])test('reopen rejects changed original cancellation '+kind,async()=>{
 const f=await fixture({count:2,calendarAck:true});await f.api.adminCancelBooking('WC-1038','');
 assert.equal((await f.api.adminGetBooking('WC-1038')).cancellation.coreComplete,true);
 const operation=JSON.stringify(f.db.BookingCancellationOperations);
 if(kind==='missing')f.db.Bookings.pop();
 if(kind==='extra')f.db.Bookings.push({...f.db.Bookings[0],_id:'extra'});
 if(kind==='active')f.db.Bookings[0].status='confirmed';
 if(kind==='quantity'){f.db.Bookings[0].quantity=2;f.db.BookingSummary[0].roomCount=3;}
 if(kind==='count')f.db.BookingSummary[0].roomCount=3;
 if(kind==='settlement')f.db.BookingSummary[0].cancellationSettlement='OTHER';
 if(kind==='summary')f.db.BookingSummary[0].status='confirmed';
 const before=f.calls.length;const d=await f.api.adminGetBooking('WC-1038');
 assert.equal(d.cancellation.coreComplete,false);
 assert.equal(d.cancellation.reservation,'NOT_VERIFIED');
 assert.equal(JSON.stringify(f.db.BookingCancellationOperations),operation);
 assert.equal(f.calls.slice(before).filter(x=>['insert','update','patch','network'].includes(x[0])).length,0);
});
for(const collection of ['Bookings','BookingSummary'])test('delayed admin edit cannot resurrect '+collection,async()=>{
 let release,seen;const reached=new Promise(r=>seen=r),gate=new Promise(r=>release=r);let held=false;
 const f=await fixture({count:1,calendarAck:true,beforeUpdate:async(c,row)=>{if(!held&&c===collection&&row.guestName==='changed'){held=true;seen();await gate;}}});
 const edit=f.api.adminUpdateBooking('WC-1038',{guestName:'changed'}).catch(e=>e.message);
 const watchdog=setTimeout(()=>{release();throw Error('watchdog');},5000);
 try{await reached;assert.equal((await f.api.adminCancelBooking('WC-1038','')).coreComplete,true);release();await edit;
 assert.equal(f.db.Bookings[0].status,'Cancelled');assert.equal(f.db.BookingSummary[0].status,'Cancelled');
 assert.equal((await f.api.adminGetBooking('WC-1038')).cancellation.coreComplete,true);
 }finally{release();clearTimeout(watchdog);}
});
test('ordinary admin edit cannot request status reactivation',async()=>{
 const f=await fixture({count:1});await assert.rejects(f.api.adminUpdateBooking('WC-1038',{status:'confirmed'}),/status/i);
 assert.equal(f.calls.filter(c=>['insert','update'].includes(c[0])).length,0);
});
