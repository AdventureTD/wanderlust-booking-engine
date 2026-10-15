const fs=require('fs'),vm=require('vm');
const repo=require('path').resolve(__dirname,'..');
const base=fs.readFileSync(repo+'/tests/legacy-date-handoff.cjs','utf8');
const focus=fs.readFileSync(repo+'/tests/booking-search-selection-totals.cjs','utf8');
const helpers=focus.slice(focus.indexOf('const selectionIds'),focus.indexOf('(async()=>{',focus.indexOf('const selectionIds')));
const tests=String.raw`
(async()=>{
 for(const n of [0,1,2,3])for(const g of [2,3,4,5,6])await test('fresh valid existing option quantity '+n+' guests '+g,async()=>{
  const s=await setup({searchAvailability:async()=>({ok:true,requestedNights:6,results:[{...row(),roomCode:'two_bedroom',occupancy:6}]})});
  const r=room(s);assert.deepEqual(Array.from(r.w('#roomQtyDropdown').options,o=>o.value),['0','1','2','3']);assert.deepEqual(Array.from(r.w('#numberOfGuests').options,o=>o.value),['2','3','4','5','6']);assert.equal(r.w('#numberOfGuests').value,'2');
  change(r.w('#numberOfGuests'),String(g));qty(s,n);assert.equal(s.w('#selectedRooms').text,n+' rooms');assert.equal(s.w('#totalGuests').text,(n*g)+' guests total');visibility(s,n>0);
  await s.w('#btnSummary').click();assert.equal(s.nav.length,n?1:0);
  if(n){const q=new URL(s.nav[0],'https://inert.invalid').searchParams;assert.equal(q.get('rc'),'two_bedroom:'+n+':'+g+':0');await quote.verifyLockedPricingQuote(q.get('quote'),{packageId:pkg._id,checkIn:q.get('ci'),checkOut:q.get('co')});}
 });
 await test('fresh mixed totals and unused invalid guest isolation',async()=>{
  const s=await setup({searchAvailability:async()=>({ok:true,requestedNights:6,results:[row(),{...row(),roomCode:'two_bedroom',occupancy:6}]})});qty(s,2);assert.equal(s.w('#totalGuests').text,'4 guests total');change(room(s,1).w('#numberOfGuests'),'NaN');assert.equal(s.w('#totalGuests').text,'4 guests total');assert.equal(s.w('#btnSummary').enabled,true);change(room(s,1).w('#numberOfGuests'),'4');qty(s,1,1);assert.equal(s.w('#totalGuests').text,'8 guests total');qty(s,0,1);room(s,1).w('#numberOfGuests').value='invalid';await s.w('#btnSummary').click();assert.equal(s.nav.length,1);
 });
 await test('fresh every missing optional control is individually isolated',async()=>{
  for(const missing of selectionIds.filter(id=>id!=='btnSummary')){const s=await setup(),real=s.c.$w;s.c.$w=id=>{if(id==='#'+missing)throw Error('absent');return real(id);};qty(s,1);for(const id of selectionIds.filter(id=>id!==missing)){assert.equal(s.w('#'+id).hidden,false,id+' after missing '+missing);assert.equal(s.w('#'+id).collapsed,false);}assert.equal(s.w('#btnSummary').enabled,true);qty(s,0);assert.equal(s.w('#btnSummary').enabled,false);}
 });
 await test('fresh rejected enable after applied side effect fails closed',async()=>{
  const s=await setup(),b=s.w('#btnSummary');let release,calls=0;
  b.enable=function(){calls++;return new Promise((resolve,reject)=>{release=()=>{this.enabled=true;reject(Error('inert applied then rejected enable'));};});};
  qty(s,1);assert.equal(calls,1);release();await flush();assert.equal(b.enabled,false,'rejected enable must fail closed rather than remain enabled');assert.equal(calls,1,'no unbounded enable retry');
 });
 await test('fresh one-shot disable rejection after selection zero fails closed',async()=>{
  const s=await setup(),b=s.w('#btnSummary');qty(s,1);let calls=0;const native=b.disable;
  b.disable=function(){if(++calls===1)return Promise.reject(Error('inert disable failure'));return native.call(this);};
  qty(s,0);await flush();await b.click();assert.equal(s.nav.length,0,'empty cart navigation still denied');assert.equal(b.enabled,false,'one-shot rejected disable leaves zero-selection button enabled even after guarded click refresh');assert.ok(calls<=2,'bounded recovery');
 });
 await test('fresh stale rejected enable reconciles zero and does not navigate',async()=>{
  const s=await setup(),b=s.w('#btnSummary');let reject;b.enable=function(){return new Promise((a,r)=>reject=()=>{this.enabled=true;r(Error('old'));});};qty(s,1);qty(s,0);reject();await flush();visibility(s,false);assert.equal(b.enabled,false);await b.click();assert.equal(s.nav.length,0);
 });
 for(const id of selectionIds)for(const [method,axis] of [['show','hidden'],['expand','collapsed']])await test('one-shot rejected '+method+' recovers '+id,async()=>{
  const s=await setup(),el=s.w('#'+id),native=el[method];let calls=0;
  el[method]=function(){if(++calls===1)return Promise.reject(Error('inert'));return native.call(this);};
  qty(s,1);await flush();assert.equal(el[axis],false);assert.equal(calls,2);visibility(s,true);
 });
 for(const [method,axis,opposite] of [['hide','hidden','show'],['collapse','collapsed','expand']])await test('stale rejected '+method+' cannot conceal latest selection',async()=>{
  const s=await setup(),el=s.w('#selectionBox');qty(s,1);let release;
  el[method]=function(){return new Promise((resolve,reject)=>release=()=>{this[axis]=true;reject(Error('old'));});};
  qty(s,0);qty(s,1);release();await flush();assert.equal(el[axis],false);visibility(s,true);
 });
 await test('persistent disable refusal is bounded unknown and navigation remains denied',async()=>{
  const s=await setup(),b=s.w('#btnSummary'),warnings=[];qty(s,1);let calls=0;
  s.c.console={...s.c.console,warn:(...args)=>warnings.push(args)};
  b.disable=()=>{calls++;return Promise.reject(Error('private failure detail'));};
  qty(s,0);await flush();for(let i=0;i<5;i++){await b.click();await flush();}
  assert.equal(calls,2);assert.equal(b.enabled,true,'SDK refusal cannot be claimed disabled');assert.equal(s.nav.length,0);
  assert.equal(vm.runInContext('_summaryControlStates.get($w("#btnSummary")).disabled.applied',s.c),null);
  assert.deepEqual(warnings,[['Booking Search summary UI transition failed; state unknown.']]);
 });
 await test('rejected enable latches fallback until fresh selection intent then valid Continue recovers',async()=>{
  const s=await setup(),b=s.w('#btnSummary'),native=b.enable;let calls=0;
  b.enable=function(){calls++;this.enabled=true;return Promise.reject(Error('inert'));};
  qty(s,1);await flush();assert.equal(b.enabled,false);qty(s,2);await flush();assert.equal(calls,1);assert.equal(b.enabled,false);
  b.enable=native;qty(s,0);qty(s,1);await flush();assert.equal(b.enabled,true);await b.click();assert.equal(s.nav.length,1);
  const q=new URL(s.nav[0],'https://inert.invalid').searchParams;await quote.verifyLockedPricingQuote(q.get('quote'),{packageId:pkg._id,checkIn:q.get('ci'),checkOut:q.get('co')});
 });
 await test('persistent enable and disable refusal stops and new intent recovers',async()=>{
  const s=await setup(),b=s.w('#btnSummary'),enable=b.enable,disable=b.disable,warnings=[];let enables=0,disables=0;
  s.c.console={...s.c.console,warn:(...args)=>warnings.push(args)};
  b.enable=function(){enables++;this.enabled=true;return Promise.reject(Error('inert'));};b.disable=()=>{disables++;return Promise.reject(Error('inert'));};
  qty(s,1);await flush();qty(s,2);await flush();assert.equal(enables,1);assert.equal(disables,1);assert.equal(warnings.length,1);
  assert.equal(vm.runInContext('_summaryControlStates.get($w("#btnSummary")).disabled.applied',s.c),null);
  b.enable=enable;b.disable=disable;qty(s,0);qty(s,1);await flush();assert.equal(b.enabled,true);
 });
 for(const [method,axis] of [['show','hidden'],['expand','collapsed']])await test('persistent '+method+' refusal stops and new intent recovers',async()=>{
  const s=await setup(),el=s.w('#selectionBox'),native=el[method],warnings=[];let calls=0;
  s.c.console={...s.c.console,warn:(...args)=>warnings.push(args)};
  el[method]=()=>{calls++;return Promise.reject(Error('inert'));};qty(s,1);await flush();qty(s,2);await flush();assert.equal(calls,2);assert.equal(el[axis],true);assert.equal(warnings.length,1);
  el[method]=native;qty(s,0);qty(s,1);await flush();visibility(s,true);
 });
 console.log(JSON.stringify({timezone:process.env.TZ,cases},null,2));assert.equal(cases.length,80);assert.equal(cases.filter(c=>!c.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+base.slice(0,base.indexOf('(async()=>{'))+helpers+tests+'})',{filename:__filename})(require,repo+'/tests');
