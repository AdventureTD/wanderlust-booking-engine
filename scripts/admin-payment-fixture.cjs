// Offline audit: exact exported source, inert SDK/UI only; no network or credentials.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = process.env.PAYMENT_SOURCE_ROOT || require('node:path').resolve(__dirname,'..');
const pagePath = 'velo/page-admin-bookings.js';
const backendPath = 'velo/backend/adminConsole.web.js';
const source = p => fs.readFileSync(path.join(root,p),'utf8');
const strip = s => s.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm,'').replace(/^export /gm,'');
const denied = () => { throw Error('OUT OF SCOPE SIDE EFFECT'); };
function fixture({dataset=false, lostAck=false, invoiceThrows=false, storage=new Map(), noCrypto=false, unauthorized=false, rpcLost=false, retainedRows=[]}={}) {
  const rows = retainedRows;
  const writes = [];
  let rpc = 0, invoiceCalls = 0, lose = lostAck, loseRpc = rpcLost;
 const requests=[];
  const summary = {_id:'SYNTHETIC-SUMMARY',bookingNumber:'AUDIT-SYNTHETIC',status:'confirmed',grandTotal:1000};
  const invoice = {_id:'SYNTHETIC-INVOICE',bookingNumber:summary.bookingNumber,status:'Active',grandTotal:1000};
  function collection(c) {
    if(c==='BookingPayments') return rows;
    if(c==='BookingSummary') return [summary];
    if(c==='BookingInvoices') return [invoice];
    if(c==='Bookings') return [{_id:'SYNTHETIC-ROOM',bookingNumber:summary.bookingNumber,roomCode:'TEST',quantity:1,status:'confirmed'}];
    throw Error('Unadmitted collection '+c);
  }
  const wixData = {
    query(c) { const filters=[]; let max=Infinity, descending;
      return {eq(k,v){filters.push(r=>r[k]===v);return this;},hasSome(k,v){filters.push(r=>v.includes(r[k]));return this;},limit(n){max=n;return this;},descending(k){descending=k;return this;},
        async find(){let result=collection(c).filter(r=>filters.every(f=>f(r))).map(r=>({...r}));if(descending)result.sort((a,b)=>String(b[descending]||'').localeCompare(String(a[descending]||'')));return {items:result.slice(0,max)};}};
    },
    async get(c,id,options){assert.equal(options.consistentRead,true);const row=collection(c).find(r=>r._id===id);return row ? {...row} : null;},
    async insert(c,p){assert.equal(c,'BookingPayments');if(p._id && rows.some(r=>r._id===p._id))throw Object.assign(Error('duplicate'),{code:'WDE0074'});const row={...p,_id:p._id || 'SYNTHETIC-ROW-'+(rows.length+1)};writes.push({collection:c,payload:{...p}});rows.push(row);if(lose){lose=false;throw Error('SYNTHETIC insert applied then acknowledgment lost');}return {...row};},
    update:denied,save:denied,remove:denied
  };
  const ctx = vm.createContext({Date,console:{log(){},warn(){},error(){}},wixData,items:{patch:denied},Permissions:{Admin:'Admin'},webMethod:(_p,f)=>f,
    currentUser:{loggedIn:!unauthorized,getRoles:async()=>[{title:'Admin'}]},cancellationRows:async(c,b)=>collection(c).filter(r=>r.bookingNumber===b).map(r=>({...r})),
    isCancelled:s=>/^(cancelled|canceled)$/i.test(s),reservationCancellationVerified:async()=>false,readCancellationEffects:async()=>({}),
    cancelReservation:denied,assertCancellationWriteAllowed:denied,cancellationEffects:denied,searchAvailability:denied,
    issueBookingInvoice:async()=>{invoiceCalls++;if(invoiceThrows)throw Error('SYNTHETIC invoice failure');return {};}});
  vm.runInContext(strip(source(backendPath))+'\nthis.api={adminRecordPayment,adminRecordRefund,adminGetBooking,computeTotals};',ctx,{filename:backendPath});
  const els = new Map(); const ready=[]; const timers=[];
  function el(id){if(!els.has(id)){let x={value:'',text:'',style:{},label:'Save',handlers:[],enabled:true,onClick(f){this.handlers.push(f);},onChange(){},onKeyPress(){},onItemReady(){},expand(){},collapse(){},show(){},hide(){},disable(){this.enabled=false;},enable(){this.enabled=true;}};if(dataset)x.dataset={};els.set(id,x);}return els.get(id);}
  const w=id=>el(id);w.onReady=f=>ready.push(f);
  const page=vm.createContext({Date,crypto:noCrypto ? undefined : crypto.webcrypto,session:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},console:{log(){},warn(){},error(){}},$w:w,setTimeout:f=>timers.push(f),wixLocation:{},
    adminRecordPayment:async p=>{rpc++;requests.push({...p});const r=await ctx.api.adminRecordPayment(p);if(loseRpc){loseRpc=false;throw Error('lost RPC ACK');}return r;},adminRecordRefund:async p=>{rpc++;requests.push({...p});return ctx.api.adminRecordRefund(p);},adminGetBooking:ctx.api.adminGetBooking,
    adminListBookings:async()=>({ok:true,items:[]}),adminUpdateBooking:denied,adminUpdateInvoice:denied,adminCancelBooking:denied,adminIssueNewInvoice:denied});
  vm.runInContext(strip(source(pagePath))+'\nthis.audit={openDetail,renderDetail,recordPayment,recordRefund};',page,{filename:pagePath});
  return {rows,writes,requests,storage,ctx,el,ready,timers,api:ctx.api,page,summary,get rpc(){return rpc;},get invoiceCalls(){return invoiceCalls;},
    async open(){await page.audit.openDetail(summary.bookingNumber);},
    input(){el('#inputPayAmount').value='100.00';el('#inputPayDate').value='2026-10-20';el('#notes').value='inert audit';},
    async click(id='#btnPmtSave'){await Promise.all(el(id).handlers.slice().map(f=>f({})));},
    request:{operationId:'0123456789abcdef0123456789abcdef',bookingNumber:summary.bookingNumber,amount:100,datePaid:'2026-10-20',paymentMethod:'Terminal',note:'inert audit'}};
}

module.exports={fixture};
