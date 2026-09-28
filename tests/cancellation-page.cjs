const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(options={}){const elements=new Map(),calls=[],loads=new Map();const $w=id=>{if(!elements.has(id))elements.set(id,{value:'',style:{},onClick(f){this.click=f;},onItemReady(){},show(){},hide(){},expand(){},collapse(){},disable(){this.disabled=true;},enable(){this.disabled=false;}});return elements.get(id);};$w.onReady=()=>{};
 const c=vm.createContext({$w,console:{log(){},warn(){},error(){}},Date,setTimeout:()=>{},adminUpdateBooking:options.adminUpdateBooking,adminGetBooking:bn=>new Promise((resolve,reject)=>{resolve.reject=reject;loads.set(bn,resolve);}),adminCancelBooking:async(...args)=>{calls.push(args);if(options.pending) return new Promise(resolve=>{options.finish=resolve;});return {ok:false};}});
 const src=fs.readFileSync(path.join(__dirname,'../velo/page-admin-bookings.js'),'utf8').replace(/^import[\s\S]*?;\s*$/gm,'');vm.runInContext(src+'\nglobalThis.api={openDetail,cancelBooking,wireDetailPanel,setBooking:b=>{_currentBooking=b;}};',c);c.api.wireDetailPanel();return {api:c.api,$w,calls,loads};}
test('failed next selection cannot cancel stale booking',async()=>{const f=fixture();f.api.setBooking({bookingNumber:'WC-1038'});const p=f.api.openDetail('WC-1036');f.loads.get('WC-1036')({ok:false});await p;await f.$w('#btnCancelBooking').click();assert.equal(f.calls.length,0);});
test('out of order details retain latest target and display actual room identities',async()=>{const f=fixture();const old=f.api.openDetail('WC-1038'),recent=f.api.openDetail('WC-1036');
 f.loads.get('WC-1036')({ok:true,summary:{bookingNumber:'WC-1036'},rooms:[{_id:'real-row',roomCode:'suite',quantity:2,status:'confirmed'}]});await recent;
 f.loads.get('WC-1038')({ok:true,summary:{bookingNumber:'WC-1038'},rooms:[]});await old;
 assert.match(f.$w('#detailTitle').text,/WC-1036/);assert.match(f.$w('#detailStatusText').text,/real-row/);
});
test('explicit target confirmation and inflight latch prevent repeated dispatch',async()=>{
 const options={pending:true},f=fixture(options);const p=f.api.openDetail('WC-1038');f.loads.get('WC-1038')({ok:true,summary:{bookingNumber:'WC-1038'},rooms:[{_id:'r',roomCode:'suite',quantity:1}]});await p;
 const arm=f.$w('#btnCancelBooking').click();assert.equal(f.calls.length,0);await arm;assert.match(f.$w('#cancelStatusText').text,/WC-1038/);
 const send=f.$w('#btnCancelBooking').click();await f.$w('#btnCancelBooking').click();assert.equal(f.calls.length,1);assert.equal(f.$w('#btnCancelBooking').disabled,true);
 options.finish({ok:false,error:'inert'});await send;
});
module.exports={fixture};
