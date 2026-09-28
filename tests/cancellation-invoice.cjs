const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../velo/backend/availability.web.js'),'utf8');
test('actual invoice caller rejects cancelled Summary before invoice or Calendar work',async()=>{
 const calls=[];const sdk={query(c){return {eq(){return this;},limit(){return this;},async find(){calls.push(c);return {items:[c==='Bookings'?{_id:'r',bookingNumber:'WC-1038',status:'Cancelled'}:{_id:'s',bookingNumber:'WC-1038',status:'Cancelled'}],hasNext:()=>false};}};},get:async()=>null};
 const code=source.slice(source.indexOf('export const issueBookingInvoice ='),source.indexOf('export const cancelBooking =')).replace('export const','const');
 const context=vm.createContext({wixData:sdk,BOOKINGS:'Bookings',BOOKING_SUMMARIES:'BookingSummary',Permissions:{Anyone:0},webMethod:(p,f)=>f,console:{log(){}},isCancelled:v=>/^cancelled$/i.test(v),assertInvoiceAllowed:undefined,Date,getActiveInvoice:async()=>{throw Error('INVOICE_WORK_REACHED');}});
 vm.runInContext(code+'\nglobalThis.issue=issueBookingInvoice;',context);
 await assert.rejects(context.issue('WC-1038'),/Cancelled booking cannot issue/);
});
test('cancelled Summary independently blocks invoice even when children are inconsistent',async()=>{
 const sdk={query(c){return {eq(){return this;},limit(){return this;},async find(){return {items:[c==='Bookings'?{_id:'r',bookingNumber:'WC-1038',status:'confirmed'}:{_id:'s',bookingNumber:'WC-1038',status:' CANCELED '}],hasNext:()=>false};}};}};
 const code=source.slice(source.indexOf('export const issueBookingInvoice ='),source.indexOf('export const cancelBooking =')).replace('export const','const');
 const context=vm.createContext({wixData:sdk,BOOKINGS:'Bookings',BOOKING_SUMMARIES:'BookingSummary',Permissions:{Anyone:0},webMethod:(p,f)=>f,console:{log(){}},Date,getActiveInvoice:async()=>{throw Error('INVOICE_WORK_REACHED');}});
 vm.runInContext(code+'\nglobalThis.issue=issueBookingInvoice;',context);
 await assert.rejects(context.issue('WC-1038'),/Cancelled booking cannot issue/);
});
