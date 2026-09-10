'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {load,fixture,tokenFor,root,admission}=require('./loader.cjs');
const cases={};
function context(f=fixture('completion-authority-history.json'),options={}){
 const db=structuredClone(f.db),before=JSON.stringify(db.rows),s=load(db,options),r=f.db.rows.GuestBookingAcceptances.find(r=>r._id===f.expected.acceptanceId);
 return {f,db,before,s,capsule:r.capsule,token:tokenFor(f),r};
}
function unchanged(x){assert.equal(JSON.stringify(x.db.rows),x.before);assert.ok(x.s.trace.every(t=>['find','secret'].includes(t.op)));}
cases.S01=async()=>{
 assert.ok(fs.existsSync(path.join(root,admission.candidate.id)),'private authenticated status implementation required');
 const x=context();assert.deepEqual(Object.keys(x.s.api),['readOwnGuestBookingCompletionStatus']);
 assert.deepEqual(await x.s.read(x.token,x.capsule),{status:'CONFIRMED',bookingNumber:x.r.bookingNumber});
 assert.equal(x.s.trace[0].op,'secret');assert.equal(x.s.trace[1].c,'GuestBookingAcceptances');
 assert.deepEqual(x.s.trace[1].predicates,[['_id',x.r._id,false]]);unchanged(x);
};
cases.S02=async()=>{
 for(const when of ['root','receipt'])for(const mode of ['expiry','backwards','invalid']){
  let triggered=false;const x=context(undefined,{hook:async({c,clock})=>{
   if(!triggered&&c===(when==='root'?'GuestBookingAcceptances':'GuestBookingCompletions')){triggered=true;clock.now=mode==='expiry'?1800003600000:mode==='backwards'?1799999999999:NaN;}
  }});
  assert.deepEqual(await x.s.read(x.token,x.capsule),{status:'DENIED'},when+' '+mode);assert.ok(triggered);unchanged(x);
 }
};
cases.S03=async()=>{
 for(const mode of ['missing','drift','expired','keys']){
  let receipts=0,final=false;const x=context(undefined,{hook:async({c,db,clock})=>{
   if(c==='GuestBookingCompletions'&&++receipts===2)final=true;
   else if(final&&c==='GuestBookingAcceptances'){
    if(mode==='missing')return {rows:[]};
    if(mode==='drift')return {rows:[{...db.rows[c][0],validatedAtMs:1800000000001}]};
    if(mode==='expired')clock.now=1800003600000;
   }
   if(final&&mode==='keys')db.keys={audience:'wbe:fixture',activeKid:'retired',keys:[]};
  }});
  assert.deepEqual(await x.s.read(x.token,x.capsule),{status:mode==='missing'?'UNKNOWN':mode==='drift'?'INTEGRITY':'DENIED'},mode);
  assert.ok(final);unchanged(x);
 }
};
cases.S04=async()=>{
 const f=fixture('completion-authority-history.json');f.db=f.pending;
 const x=context(f);
 assert.deepEqual(await x.s.read(x.token,x.capsule),{status:'ACCEPTED_PENDING'});
 assert.deepEqual(await x.s.read(x.token,x.capsule),{status:'ACCEPTED_PENDING'});unchanged(x);
};
cases.S05=async()=>{
 const f=fixture('completion-authority-history.json'),good=tokenFor(f),cap=f.db.rows.GuestBookingAcceptances[0].capsule;
 const wrong=[good.slice(0,-1)+(good.endsWith('A')?'B':'A'),tokenFor(f,'invoice-access'),tokenFor(f,'guest-bootstrap',{audience:'foreign'}),tokenFor(f,'guest-bootstrap',{},'unknown'),tokenFor(f,'guest-bootstrap',{},undefined,'34'.repeat(32)),tokenFor(f,'guest-bootstrap',{intentDigest:'0'.repeat(64)}),tokenFor(f,'guest-bootstrap',{quoteDigest:'0'.repeat(64)}),tokenFor(f,'guest-bootstrap',{issuedAtMs:1799999999999}),tokenFor(f,'guest-bootstrap',{expiresAtMs:1800003599999})];
 for(const token of wrong){const x=context();assert.deepEqual(await x.s.read(token,cap),{status:'DENIED'});assert.equal(x.s.trace.filter(t=>t.op==='find').length,0);unchanged(x);}
 for(const args of [[],[good],[good,cap,'extra'],[{},cap],[new String(good),cap],[good,{}],[good,''],[good,'x'.repeat(120001)],['x'.repeat(1025),cap]]){const x=context();assert.deepEqual(await x.s.read(...args),{status:'DENIED'});assert.deepEqual(x.s.trace,[]);unchanged(x);}
 for(const capsule of [cap+' ',fixture('completion-authority-foreign.json').db.rows.GuestBookingAcceptances[0].capsule]){const x=context();assert.deepEqual(await x.s.read(good,capsule),{status:'DENIED'});assert.equal(x.s.trace.filter(t=>t.op==='find').length,0);unchanged(x);}
 for(const now of [1800003600000,1800003600001,1799999999999,NaN]){const x=context(undefined,{clock:{now}});assert.deepEqual(await x.s.read(x.token,x.capsule),{status:'DENIED'});assert.equal(x.s.trace.filter(t=>t.op==='find').length,0);unchanged(x);}
 for(const keys of [null,{audience:'wbe:fixture',activeKid:'retired',keys:[]}]){const x=context();x.db.keys=keys;assert.deepEqual(await x.s.read(x.token,x.capsule),{status:'DENIED'});assert.equal(x.s.trace.filter(t=>t.op==='find').length,0);unchanged(x);}
};
cases.S06=async()=>{
 const foreign=fixture('completion-authority-foreign.json');
 for(const mode of ['absent','duplicate','malformed','foreign','same-number-foreign','unreadable']){
  const x=context(undefined,{hook:async({c,db})=>{if(c!=='GuestBookingAcceptances')return;
   if(mode==='unreadable')throw Error('inert unavailable');
   if(mode==='absent')return {rows:[]};if(mode==='duplicate')return {rows:[db.rows[c][0],db.rows[c][0]]};
   if(mode==='malformed')return {rows:[{...db.rows[c][0],rootDigest:'0'.repeat(64)}]};
   const other=structuredClone(foreign.db.rows[c][0]);if(mode==='same-number-foreign')other.bookingNumber=db.rows[c][0].bookingNumber;
   return {rows:[other]};
  }});
  assert.deepEqual(await x.s.read(x.token,x.capsule),{status:['absent','unreadable'].includes(mode)?'UNKNOWN':'INTEGRITY'},mode);
  assert.equal(x.s.trace.filter(t=>t.op==='find').length,1);unchanged(x);
 }
 const x=context();const otherSubject=tokenFor(x.f,'guest-bootstrap',{intentId:foreign.expected.operationId});
 assert.deepEqual(await x.s.read(otherSubject,x.capsule),{status:'UNKNOWN'});assert.deepEqual(x.s.trace[1].predicates,[['_id',foreign.expected.acceptanceId,false]]);unchanged(x);
};
cases.S07=async()=>{
 const foreign=fixture('completion-authority-foreign.json');
 for(const mode of ['absent','duplicate','foreign','same-number-foreign','wrong-root','partial-bookings','receipt-alone','late-absent','late-foreign','unreadable']){
  let receipts=0;const f=fixture('completion-authority-history.json');
  if(mode==='partial-bookings')f.db.rows.Bookings.pop();
  if(mode==='receipt-alone'){f.db.rows.RoomBookingClaimEvents=[];f.db.rows.GuestBookingAcquisitionControls=[];f.db.rows.Bookings=[];f.db.rows.BookingSummary=[];}
  const x=context(f,{hook:async({c,db})=>{if(c!=='GuestBookingCompletions')return;receipts++;
   if(mode==='unreadable')throw Error('inert unavailable');
   if(mode==='absent'||mode==='late-absent'&&receipts>=2)return {rows:[]};
   if(mode==='duplicate')return {rows:[db.rows[c][0],db.rows[c][0]]};
   if(mode==='wrong-root')return {rows:[{...db.rows[c][0],rootDigest:'0'.repeat(64)}]};
   if(mode==='foreign'||mode==='same-number-foreign'||mode==='late-foreign'&&receipts===2){const other=structuredClone(foreign.db.rows[c][0]);if(mode==='same-number-foreign')other.bookingNumber=db.rows[c][0].bookingNumber;return {rows:[other]};}
  }});
  const result=await x.s.read(x.token,x.capsule);
  assert.deepEqual(Object.keys(result),['status'],mode);assert.ok(['UNKNOWN','INTEGRITY'].includes(result.status),mode+JSON.stringify(result));unchanged(x);
 }
};
cases.S08=async()=>{
 for(const name of ['completion-authority-history.json','completion-authority-foreign.json']){
  const x=context(fixture(name));const access=x.s.attenuate(x.token);assert.equal(access,tokenFor(x.f,'guest-access'));
  const expected={status:'CONFIRMED',bookingNumber:x.r.bookingNumber};
  for(const token of [x.token,access,access])assert.deepEqual(await x.s.read(token,x.capsule),expected);
  const fresh=load(x.db);assert.notEqual(fresh.api.readOwnGuestBookingCompletionStatus,x.s.api.readOwnGuestBookingCompletionStatus);
  assert.deepEqual(await fresh.read(access,x.capsule),expected);assert.ok(fresh.trace.every(t=>['find','secret'].includes(t.op)));unchanged(x);
  x.s.clock.now=x.r.offerExpiresAtMs;const start=x.s.trace.length;assert.deepEqual(await x.s.read(access,x.capsule),{status:'DENIED'});assert.equal(x.s.trace.slice(start).filter(t=>t.op==='find').length,0);unchanged(x);
 }
};
cases.S09=async()=>{
 for(const mode of ['acceptance-only','bad-manifest','foreign-manifest','receipt-appears','expiry','compensated']){
  const f=fixture(mode==='compensated'?'completion-authority-compensated.json':'completion-authority-history.json');if(mode!=='compensated')f.db=f.pending;
  if(mode==='acceptance-only')f.db.rows.GuestBookingAllocationManifests=[];
  if(mode==='bad-manifest')f.db.rows.GuestBookingAllocationManifests[0].manifestDigest='0'.repeat(64);
  if(mode==='foreign-manifest')f.db.rows.GuestBookingAllocationManifests=fixture('completion-authority-foreign.json').db.rows.GuestBookingAllocationManifests;
  let receipts=0;const x=context(f,{hook:async({c,clock})=>{
   if(c==='GuestBookingCompletions'&&++receipts===3){
    if(mode==='receipt-appears')return {rows:fixture('completion-authority-history.json').db.rows.GuestBookingCompletions};
    if(mode==='expiry')clock.now=1800003600000;
   }
  }});
  const result=await x.s.read(x.token,x.capsule);assert.deepEqual(Object.keys(result),['status']);
  assert.ok((mode==='expiry'?['DENIED']:['UNKNOWN','INTEGRITY']).includes(result.status),mode+JSON.stringify(result));unchanged(x);
 }
 const f=fixture('completion-authority-history.json');f.db=f.pending;const x=context(f);const access=x.s.attenuate(x.token);
 assert.deepEqual(await x.s.read(access,x.capsule),{status:'ACCEPTED_PENDING'});unchanged(x);
};
cases.S10=async()=>{
 const x=context();assert.deepEqual(await x.s.read(x.token,x.capsule),{status:'CONFIRMED',bookingNumber:x.r.bookingNumber});unchanged(x);
 const allowed=new Set([...Object.keys(admission.graph),admission.candidate.id]);assert.deepEqual(new Set(x.s.loaded),allowed);
 for(const id of allowed)assert.ok(!/guestBooking(?:CompletionRecovery|PhysicalAcquisition|InvoiceIssuance|InvoiceDelivery|AcceptanceDiscovery)\.js$/.test(id),'no producer/recovery/delivery');
 function scan(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isDirectory())scan(p);else if(/\.(?:js|jsw|html)$/.test(d.name)&&p!==path.join(root,admission.candidate.id))assert.ok(!/guestBookingCompletionStatus|readOwnGuestBookingCompletionStatus/.test(fs.readFileSync(p,'utf8')),'disconnected '+p);}}
 scan(path.join(root,'velo'));
};
cases.S11=async()=>{
 const f=fixture('completion-authority-history.json');f.db=f.pending;
 const x=context(f,{hook:async({c,clock})=>{if(c==='GuestBookingAllocationManifests'){clock.now=1800003600000;throw Error('expired during unreadable model');}}});
 assert.deepEqual(await x.s.read(x.token,x.capsule),{status:'DENIED'});unchanged(x);
};
cases.S12=async()=>{
 let release,entered,held=false,done=false;const gate=new Promise(r=>release=r),entry=new Promise(r=>entered=r);
 const x=context(undefined,{hook:async({c})=>{if(c==='GuestBookingCompletions'&&!held){held=true;entered();await gate;}}});
 let timer;const watchdog=new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('paused-read watchdog')),3000));
 try{
  const pending=x.s.read(x.token,x.capsule).then(r=>{done=true;return r;});await Promise.race([entry,watchdog]);assert.equal(done,false);
  x.s.clock.now=x.r.offerExpiresAtMs;release();assert.deepEqual(await Promise.race([pending,watchdog]),{status:'DENIED'});unchanged(x);
  const e=x.f.expected,result=await x.s.retained(e.acceptanceId,e.operationId,e.rootDigest);
  assert.equal(result.status,'VERIFIED_COMPLETION');unchanged(x);
 }finally{release();clearTimeout(timer);}
};
cases.S13=async()=>{
 const v=JSON.parse(fs.readFileSync(path.join(__dirname,'credential-vector.json'))),x=context();
 assert.equal(x.token,v.bootstrap);assert.equal(x.s.attenuate(x.token),v.access);
 assert.deepEqual(await x.s.read(v.bootstrap,x.capsule),{status:'CONFIRMED',bookingNumber:x.r.bookingNumber});
 assert.deepEqual(await x.s.read(v.access,x.capsule),{status:'CONFIRMED',bookingNumber:x.r.bookingNumber});unchanged(x);
};
async function main(){const ids=process.argv.slice(2);assert.equal(ids.length,1,'exactly one explicit case; no default dispatch');assert.ok(Object.hasOwn(cases,ids[0]),'unknown selector');await cases[ids[0]]();console.log(JSON.stringify({completed:1,cases:ids}));}
main().catch(e=>{console.error(e);process.exitCode=1;});
