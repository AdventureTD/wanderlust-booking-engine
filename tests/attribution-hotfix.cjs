'use strict';
// Actual checkout source, repo-relative; all external boundaries are inert.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const cases=[];
function realm(extra={}) { const deny=()=>{throw Error('OFFLINE_NETWORK_DENIED');}; return vm.createContext({console:{log(){},warn(){},error(){}},fetch:deny,XMLHttpRequest:deny,WebSocket:deny,Image:deny,...extra},{codeGeneration:{strings:false,wasm:false}}); }
const run=(c,s)=>vm.runInContext(s,c,{timeout:2000});
async function test(id,fn){try{await fn();cases.push({id,pass:true});}catch(e){cases.push({id,pass:false,error:e.stack});}}
async function page(options={}) {
 const elements=new Map(),payloads=[],purchases=[],ads=[],invoices=[],timers=[];
 const w=id=>{if(!elements.has(id))elements.set(id,{text:'',value:'',disable(){this.disabled=true;},enable(){this.disabled=false;},show(){},hide(){},expand(){},collapse(){},onClick(f){this.click=f;},onItemReady(f){this.ready=f;},onBlur(f){this.blur=f;},onKeyPress(){},onKeyDown(){},onInput(){}});return elements.get(id);};w.onReady=()=>{};
 w('#inputGuestName').value='Offline Fixture';w('#inputGuestEmail').value='fixture@example.invalid';w('#inputGuestPhone').value='2025550100';
 const c=realm({$w:w,setTimeout:f=>{timers.push(f);return timers.length;},clearTimeout(){},getPackageBaseRate:async()=>100,getStoredClickIds:()=>({}),getPackageAmenities:async()=>({title:'Offline'}),validatePromoCode:options.promo|| (async()=>({valid:true,discount:0.5,description:'Offline'})),
 wixData:{query:()=>({eq(){return this;},limit(){return this;},find:async()=>({items:[]})})},
 createBooking:async p=>{payloads.push(JSON.parse(JSON.stringify(p)));if(options.book){const result=await options.book(p,payloads.length);if(result!==undefined)return result;}return {bookingNumber:'OFFLINE-SNAPSHOT'};},
 trackPurchase:p=>{purchases.push({...p});if(options.track)options.track();},recordBookingConversion:async p=>{ads.push({...p});return {ok:false};},issueBookingInvoice:async()=>{invoices.push('invoice');if(options.invoice) return options.invoice();return {emailed:false};},wixLocation:{to(){}}});
 run(c,read('velo/page-booking-summary.js').replace(/^import .*;\r?\n/gm,''));
 run(c,"_summaryRooms=[{roomCode:'adventure_suite',qty:2,numGuests:2},{roomCode:'two_bedroom_apartment',qty:1,numGuests:1}];_summaryNights=1;_summaryCis='2027-01-01';_summaryCos='2027-01-02';_summarySettings={};_selectedPackageBaseRate=100;_selectedPackageTitle='Offline';initRoomRepeater();");
 if(options.setup)run(c,options.setup);
 if(!options.noRender)await run(c,'renderSummary()');
 run(c,'wireContinueButton();wirePromoCode();');
 return {c,w,payloads,purchases,ads,invoices,timers,click:()=>w('#btnContinue').click()};
}
function bookingBackend(options={}) {
 const writes=[];
 const c=realm({toDate:x=>x?new Date(x):null,getRoomDisplayName:x=>x,ROOM_UNITS:{A:1},ROOM_MIN_OCCUPANCY:{A:1},ROOM_MAX_OCCUPANCY:{A:2},nightsBetween:()=>1,
 overlappingCount:async()=>{if(options.readError)throw Error('Only 0 available');return 1;},
 getNextBookingNumber:async()=>{writes.push('number');throw Error('unexpected allocation');},wixData:{insert(){writes.push('insert');throw Error('unexpected write');}}});
 const a=read('velo/backend/availability.web.js'),start=a.indexOf('async function createBookingImpl('),end=a.indexOf('\nexport const createBooking =',start);
 assert.ok(start>0&&end>start);run(c,a.slice(start,end));return {c,writes};
}
async function main(){
 for(const conflict of [false,true])await test('actual backend post-insert path preserves success or uncertainty '+conflict,async()=>{
  const b=bookingBackend();let reads=0;Object.assign(b.c,{overlappingCount:async()=>++reads===1?0:(conflict?2:1),getNextBookingNumber:async()=> 'OFFLINE-KNOWN',BOOKINGS:'Bookings',wouldExceedBookingRoomLimit:()=>false,getPackagePricingForBooking:async()=>({_id:'P'}),verifyLockedPricingQuote:async()=>({packageId:'P',baseRate:100,totalPerPerson:100}),normalizePriceModifier:()=>1,getAuthoritativeRoomFee:async()=>0,roundMoney:x=>x,getAllSettings:async()=>({}),createDraftInvoice:async()=>{b.writes.push('draft');},updateBookingSummary:async()=>{b.writes.push('summary');},wixData:{query:()=>({eq(){return this;},limit(){return this;},find:async()=>({items:[]})}),insert:async(_,row)=>{b.writes.push('insert');return {...row,_id:'OFFLINE-ROW'};},remove:async()=>{b.writes.push('remove');}}});
  const result=await b.c.createBookingImpl({roomCode:'A',checkIn:'2027-01-01',checkOut:'2027-01-02'});assert.equal(result.bookingNumber,'OFFLINE-KNOWN');assert.equal(result.outcome,conflict?'UNKNOWN':undefined);assert.deepEqual(b.writes,conflict?['insert','draft','remove']:['insert','draft','summary']);
 });
 await test('pinned checkout sources match reviewed canonical bytes',()=>{
  const pins=JSON.parse(read('tests/attribution-hotfix-sources.json'));assert.equal(Object.keys(pins).length,3);
  for(const [file,hash] of Object.entries(pins))assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,file)).toString('utf8').replace(/\r\n/g,'\n')).digest('hex'),hash,file);
 });

 await test('negative numeric money skips analytics without blocking invoice',async()=>{
  const p=await page({setup:'_selectedPackageStayTotal=-100;_hasSelectedPackageStayTotal=true;'});await p.click();assert.equal(p.purchases.length,0);assert.equal(p.ads.length,0);assert.equal(p.invoices.length,1);
 });
 await test('100 percent promo preserves legitimate zero',async()=>{
  const p=await page({setup:"_promoDiscount=1;_promoCodeApplied='FREE';"});await p.click();assert.equal(p.purchases[0].value,0);assert.equal(p.ads[0].value,0);
 });
 await test('repeated head configuration remains outside listener guard',()=>{
  const listeners=[];const c=realm({document:{addEventListener(){},getElementById(){return {};}},localStorage:{getItem:()=>null,setItem(){}},location:{href:'https://offline.invalid/'},addEventListener:(t,f)=>listeners.push({t,f})});c.window=c;const body=read('velo/custom-code/google-tag-and-consent.html').match(/<script>([\s\S]*?)<\/script>/)[1];run(c,body);run(c,body);assert.equal(listeners.filter(x=>x.t==='message').length,2);assert.equal(listeners.filter(x=>x.t==='storage').length,1);assert.equal(run(c,"dataLayer.filter(x=>x[0]==='config').length"),4);assert.equal(run(c,"dataLayer.filter(x=>x[0]==='consent'&&x[1]==='default').length"),2);
 });
 await test('promo controls stay disabled through awaited price rendering',async()=>{
  const p=await page();let release;const gate=new Promise(r=>release=r);p.c.getPackageBaseRate=()=>gate;run(p.c,'_selectedPackageBaseRate=0;');p.w('#promoCode').value='HALF';p.w('#btnApplyPromo').click();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(p.w('#promoCode').disabled,true);assert.equal(p.w('#btnApplyPromo').disabled,true);await p.click();assert.equal(p.payloads.length,0);release(100);for(let i=0;i<30;i++)await Promise.resolve();assert.equal(p.w('#promoCode').disabled,false);await p.click();assert.equal(p.payloads.length,2);
 });

 for(const [reasonCode,booking,setup] of [
 ['INVALID_DATES',{checkIn:''},null],['UNKNOWN_ROOM',{roomCode:'BAD'},null],['INVALID_STAY',{},b=>{b.c.nightsBetween=()=>0;}],['MIN_OCCUPANCY',{guests:-1},null],['MAX_OCCUPANCY',{guests:3},null]
 ]) await test('actual backend definitive validation '+reasonCode,async()=>{
  const b=bookingBackend();if(setup)setup(b);const result=await b.c.createBookingImpl({roomCode:'A',checkIn:'2027-01-01',checkOut:'2027-01-02',...booking});assert.equal(result.outcome,'NO_RESERVATION');assert.equal(result.reasonCode,reasonCode);assert.deepEqual(b.writes,[]);
  const p=await page({book:async()=>result});await p.click();assert.equal(p.payloads.length,1);assert.equal(run(p.c,'_bookingInProgress'),false);assert.equal(p.invoices.length,0);
 });

 await test('actual backend uncertain insert returns known reference without safe-retry authority',async()=>{
  const b=bookingBackend();Object.assign(b.c,{overlappingCount:async()=>0,getNextBookingNumber:async()=> 'OFFLINE-KNOWN',BOOKINGS:'Bookings',wouldExceedBookingRoomLimit:()=>false,getPackagePricingForBooking:async()=>({_id:'P'}),verifyLockedPricingQuote:async()=>({packageId:'P',baseRate:100,totalPerPerson:100}),normalizePriceModifier:()=>1,getAuthoritativeRoomFee:async()=>0,roundMoney:x=>x,getAllSettings:async()=>({}),wixData:{query:()=>({eq(){return this;},limit(){return this;},find:async()=>({items:[]})}),insert:async()=>{b.writes.push('insert');throw Error('ACK lost');}}});
  const result=await b.c.createBookingImpl({roomCode:'A',checkIn:'2027-01-01',checkOut:'2027-01-02'});assert.equal(result.outcome,'UNKNOWN');assert.equal(result.bookingNumber,'OFFLINE-KNOWN');assert.deepEqual(b.writes,['insert']);
  const p=await page({book:async()=>result});await p.click();await p.click();assert.equal(p.payloads.length,1);assert.equal(p.invoices.length,0);assert.match(p.w('#bookingStatus').text,/OFFLINE-KNOWN/);assert.match(p.w('#bookingStatus').text,/contact/i);
 });

 await test('promo freezes actual input and Apply through validation and overlapping render',async()=>{
  let release;const gate=new Promise(r=>release=r);let calls=0;const p=await page({promo:()=>{calls++;return gate;}});
  p.w('#promoCode').value='OLD';p.w('#btnApplyPromo').click();assert.equal(p.w('#promoCode').disabled,true);assert.equal(p.w('#btnApplyPromo').disabled,true);
  await run(p.c,'renderSummary()');assert.equal(p.w('#promoCode').disabled,true);assert.equal(p.w('#btnApplyPromo').disabled,true);
  // Wix prevents guest editing disabled controls; replay callbacks still must not dispatch.
  p.w('#btnApplyPromo').click();p.w('#promoCode').blur();await p.click();assert.equal(calls,1);assert.equal(p.payloads.length,0);
  release({valid:true,discount:.5,description:'Offline'});for(let i=0;i<30;i++)await Promise.resolve();assert.equal(p.w('#promoCode').disabled,false);assert.equal(p.w('#btnApplyPromo').disabled,false);
  p.w('#promoCode').value='NEW';p.w('#btnApplyPromo').click();for(let i=0;i<30;i++)await Promise.resolve();await p.click();assert.ok(p.payloads.every(x=>x.promoCode==='NEW'));assert.equal(calls,2);
 });
 await test('programmatic changed-input pending callback cannot submit stale promo',async()=>{
  let release;const gate=new Promise(r=>release=r);const p=await page({promo:()=>gate});p.w('#promoCode').value='OLD';p.w('#btnApplyPromo').click();p.w('#promoCode').value='NEW';p.w('#btnApplyPromo').click();release({valid:true,discount:.5,description:'Offline'});for(let i=0;i<30;i++)await Promise.resolve();await p.click();assert.ok(p.payloads.length===0||p.payloads.every(x=>x.promoCode==='NEW'));
 });
 await test('promo error restores controls after rendering',async()=>{
  const p=await page({promo:async()=>{throw Error('inert validation');}});p.w('#promoCode').value='BAD';p.w('#btnApplyPromo').click();for(let i=0;i<30;i++)await Promise.resolve();assert.equal(p.w('#promoCode').disabled,false);assert.equal(p.w('#btnApplyPromo').disabled,false);assert.equal(run(p.c,'_promoPending'),false);
 });

 await test('trusted first-room rejection unlocks correction and retry',async()=>{
  const b=bookingBackend();let reject=true;const p=await page({book:async()=>reject?b.c.createBookingImpl({roomCode:'A',checkIn:'2027-01-01',checkOut:'2027-01-02'}):undefined});
  await p.click();assert.equal(p.payloads.length,1);assert.equal(run(p.c,'_bookingInProgress'),false);assert.equal(p.w('#btnContinue').disabled,false);assert.equal(p.w('#promoCode').disabled,false);assert.equal(p.invoices.length,0);assert.match(p.w('#bookingStatus').text,/availability|available/i);reject=false;await p.click();assert.equal(p.payloads.length,3);
 });
 await test('local preparation failure unlocks without dispatch or rejected handler',async()=>{
  const p=await page();p.c.getStoredClickIds=()=>{throw Error('inert preparation failure');};await p.click();assert.equal(p.payloads.length,0);assert.equal(run(p.c,'_bookingInProgress'),false);assert.equal(p.w('#btnContinue').disabled,false);assert.match(p.w('#bookingStatus').text,/try again/i);
 });
 for(const response of [null,{}, {outcome:'NO_RESERVATION',reasonCode:'UNTRUSTED'}])await test('malformed result cannot confirm or unlock '+JSON.stringify(response),async()=>{
  const p=await page({book:async()=>response});await p.click();await p.click();assert.equal(p.payloads.length,1);assert.equal(run(p.c,'_bookingInProgress'),true);assert.equal(p.invoices.length,0);assert.equal(p.timers.length,0);assert.match(p.w('#bookingStatus').text,/contact/i);
 });
 await test('arbitrary no-write-looking thrown text remains uncertain without replay',async()=>{
  const p=await page({book:async()=>{throw Error('Only 0 available; NO_RESERVATION');}});await p.click();await p.click();assert.equal(p.payloads.length,1);assert.equal(run(p.c,'_bookingInProgress'),true);assert.match(p.w('#bookingStatus').text,/contact/i);assert.match(p.w('#bookingStatus').text,/do not.*reload/i);
 });
 for(const structured of [false,true])await test('partial failure retains reference and untouched successor '+structured,async()=>{
  const p=await page({setup:"_summaryRooms=[{roomCode:'A',qty:1,numGuests:1},{roomCode:'B',qty:1,numGuests:1},{roomCode:'C',qty:1,numGuests:1}];",book:async(_,n)=>{if(n===2){if(structured)return {outcome:'NO_RESERVATION',reasonCode:'UNAVAILABLE',message:'Unavailable'};throw Error('uncertain save');}}});await p.click();await p.click();assert.equal(p.payloads.length,3);assert.equal(run(p.c,'_bookingInProgress'),true);assert.equal(p.invoices.length,0);assert.match(p.w('#bookingStatus').text,/contact/i);assert.match(p.w('#bookingStatus').text,/OFFLINE-SNAPSHOT/);
 });

 await test('actual backend sold-out result explicitly proves no reservation without allocating number',async()=>{
  const b=bookingBackend();const result=await b.c.createBookingImpl({roomCode:'A',checkIn:'2027-01-01',checkOut:'2027-01-02'});
  assert.equal(result.outcome,'NO_RESERVATION');assert.equal(result.reasonCode,'UNAVAILABLE');assert.deepEqual(b.writes,[]);
 });
 await test('actual backend read exception is not converted to safe rejection by its text',async()=>{
  const b=bookingBackend({readError:true});await assert.rejects(b.c.createBookingImpl({roomCode:'A',checkIn:'2027-01-01',checkOut:'2027-01-02'}));assert.deepEqual(b.writes,[]);
 });
 await test('head duplicate installation consumes one message once',()=>{
  const listeners=[];const c=realm({document:{addEventListener(){},getElementById(){return {};}},localStorage:{getItem:()=>null,setItem(){}},location:{href:'https://offline.invalid/'},addEventListener:(t,f)=>listeners.push({t,f})});c.window=c;
  const html=read('velo/custom-code/google-tag-and-consent.html');const body=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  run(c,body);run(c,body);
  for(const {t,f} of listeners)if(t==='message')f({data:{source:'wbe-event-bridge',payload:{event:'purchase',transaction_id:'OFFLINE',value:0,currency:'USD'}}});
  assert.equal(listeners.filter(x=>x.t==='message').length,2);assert.equal(listeners.filter(x=>x.t==='storage').length,1);assert.equal(run(c,"dataLayer.filter(x=>x[0]==='event'&&x[1]==='purchase').length"),1);
 });
 await test('rendered numeric value survives display corruption during save',async()=>{
  let release;const gate=new Promise(r=>release=r);const p=await page({book:async(_,n)=>{if(n===1)await gate;}});
  const task=p.click();try{p.w('#grandTotal').text='N/A';p.w('#grandTotal1').text='';p.w('#grandTotalText').text='';}finally{release();}await task;
  assert.equal(p.purchases[0].value,587.5);assert.equal(p.ads[0].value,587.5);assert.equal(p.invoices.length,1);
 });
 for(const [id,options] of [ ['missing',{noRender:true}], ['malformed',{setup:"_selectedPackageStayTotal=NaN;_hasSelectedPackageStayTotal=true;"}], ['infinite',{setup:"_selectedPackageStayTotal=Infinity;_hasSelectedPackageStayTotal=true;"}] ]) await test('invalid '+id+' value skips analytics not confirmation/invoice',async()=>{
  const p=await page(options);await p.click();assert.equal(p.purchases.length,0);assert.equal(p.ads.length,0);assert.equal(p.invoices.length,1);assert.equal(p.timers.length,1);assert.match(p.w('#bookingStatus').text,/Booking confirmed/);
 });
 await test('explicit zero stays zero despite nonzero display and invoice rejection',async()=>{
  const p=await page({setup:'_selectedPackageStayTotal=0;_hasSelectedPackageStayTotal=true;',invoice:async()=>{throw Error('inert failure');}});p.w('#grandTotal').text='$999.00';await p.click();assert.equal(p.purchases[0].value,0);assert.equal(p.ads[0].value,0);assert.equal(p.invoices.length,1);assert.equal(p.timers.length,1);
 });
 await test('throwing analytics cannot prevent confirmed invoice/redirect',async()=>{
  const p=await page({track:()=>{throw Error('inert analytics');}});await p.click();assert.equal(p.invoices.length,1);assert.equal(p.timers.length,1);
 });
 await test('reentrant and repeated Continue submits one cart',async()=>{
  let release;const gate=new Promise(r=>release=r);const p=await page({book:async(_,n)=>{if(n===1)await gate;}});const first=p.click();const second=p.click();release();await Promise.all([first,second]);await p.click();assert.equal(p.payloads.length,2);assert.equal(p.purchases.length,1);
 });
 await test('room removal and promo callbacks cannot mutate booking in progress',async()=>{
  let release;const gate=new Promise(r=>release=r);const p=await page({book:async(_,n)=>{if(n===1)await gate;}});
  const row=new Map();const item=id=>{if(!row.has(id))row.set(id,{onClick(f){this.click=f;}});return row.get(id);};p.w('#summaryRoomsRepeater').ready(item,{roomCode:'two_bedroom_apartment'});
  const task=p.click();try{item('#removeBtn').click();p.w('#promoCode').value='HALF';p.w('#btnApplyPromo').click();await Promise.resolve();assert.equal(run(p.c,'_summaryRooms.length'),2);assert.equal(run(p.c,'_promoDiscount'),0);}finally{release();await task;}
 });
 await test('detached cart and promo retained across first booking await',async()=>{
  let release;const gate=new Promise(r=>release=r);const p=await page({book:async(_,n)=>{if(n===1)await gate;}});const task=p.click();try{run(p.c,"_summaryRooms[1].qty=9;_promoDiscount=.5;_promoCodeApplied='CHANGED';_summaryCos='2027-02-01';");}finally{release();await task;}
  assert.equal(p.payloads[1].quantity,1);assert.equal(p.payloads[1].promoDiscount,0);assert.equal(p.payloads[1].checkOut,'2027-01-02');assert.equal(p.purchases[0].value,587.5);
 });
 await test('pending promo must settle and render before Continue',async()=>{
  let release;const gate=new Promise(r=>release=r);const p=await page({promo:()=>gate});p.w('#promoCode').value='HALF';p.w('#btnApplyPromo').click();await p.click();assert.equal(p.payloads.length,0);release({valid:true,discount:.5,description:'Offline'});for(let i=0;i<12;i++)await Promise.resolve();await p.click();assert.equal(p.payloads.length,2);assert.equal(p.purchases[0].value,293.75);
 });
 await test('Summary additional rooms retain every actual draft contribution',async()=>{
  let row=null;const clone=x=>structuredClone(x);const sdk={query(){return {eq(){return this;},hasSome(){return this;},descending(){return this;},limit(){return this;},async find(){const snapshot=clone(row);await Promise.resolve();return {items:snapshot?[snapshot]:[]};}};},async insert(_,v){row={...clone(v),_id:'OFFLINE-INVOICE'};return clone(row);},async update(_,v){row=clone(v);return clone(row);}};
  const c=realm({wixData:sdk,BOOKING_INVOICES:'BookingInvoices',toDate:x=>x});const a=read('velo/backend/availability.web.js');const start=a.indexOf('async function createDraftInvoice(');const end=a.indexOf('\n}',start)+2;assert.ok(start>0&&end>start);run(c,a.slice(start,end));
  const p=await page({setup:"_summaryRooms=[{roomCode:'A',qty:1,numGuests:1},{roomCode:'B',qty:1,numGuests:1},{roomCode:'C',qty:1,numGuests:1}];",book:async(_,n)=>{const v=n*100;await c.createDraftInvoice('OFFLINE-SNAPSHOT',{roomTotal:v,grandTotal:v*1.2,propertyFee:v*.1,accommodationVat:v*.05,packageVat:v*.05,promoDiscountAmount:0},'2027-01-01','2027-01-02','Offline');}});
  await p.click();assert.equal(p.payloads.length,3);assert.equal(row.roomTotal,600);assert.equal(row.grandTotal,720);assert.equal(p.invoices.length,1);
 });
 await test('pending render blocks Continue until numeric snapshot is ready',async()=>{
  let release;const gate=new Promise(r=>release=r);const p=await page();p.c.getPackageBaseRate=()=>gate;run(p.c,'_selectedPackageBaseRate=0;');const rendering=run(p.c,'renderSummary()');await p.click();try{assert.equal(p.payloads.length,0);}finally{release(100);await rendering;}await p.click();assert.equal(p.payloads.length,2);assert.equal(p.purchases[0].value,587.5);
 });
 // Already-passing baseline controls: retained without a production change.
 await test('control: ordinary multi-quantity booking keeps displayed numeric total',async()=>{
  const p=await page();await p.click();assert.equal(p.purchases[0].value,587.5);assert.equal(p.payloads[0].quantity,2);assert.equal(p.payloads[0].guests,2);assert.equal(p.invoices.length,1);
 });
 await test('control: real rendered zero remains zero',async()=>{
  const p=await page({setup:'_selectedPackageStayTotal=0;_hasSelectedPackageStayTotal=true;'});await p.click();assert.equal(p.purchases[0].value,0);assert.equal(p.invoices.length,1);
 });
 console.log(JSON.stringify({timezone:process.env.TZ,cases},null,2));assert.equal(cases.length,41);assert.equal(cases.filter(x=>!x.pass).length,0);
}
const watchdog=setTimeout(()=>{console.error('WATCHDOG');process.exit(2);},10000);
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
