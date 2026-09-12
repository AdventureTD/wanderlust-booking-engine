// Offline actual-page handlers. SDK/transport/tracking are inert; real quote HMAC.
const fs = require('fs'), path = require('path'), vm = require('vm');
const assert = require('node:assert/strict'), crypto = require('crypto');
const root = process.env.WBE_LEGACY_TEST_ROOT || path.resolve(__dirname, '../velo');
const watchdog = setTimeout(() => { console.error('TEST WATCHDOG: unfinished assertions'); process.exit(1); }, 10000);
const clean = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
const pkg = {_id:'ff82bbe1-47c6-4c01-bccf-3e0606d09eb7', numberOfNights:6, baseRate:396, title:'7-day Explorer Package', priceModifier:1};
const forbidden = () => { throw Error('LIVE IO FORBIDDEN'); };
const sdk = {query(name) { const q = {eq:()=>q, hasSome:()=>q, limit:()=>q, find:async()=>({items:name==='Packages'?[pkg]:[]})}; return q; }, insert:forbidden, update:forbidden};
const quote = vm.createContext({Date, Buffer, crypto, wixData:sdk, getSecret:async()=>'INERT-TEST-ONLY-NOT-A-REAL-SECRET-123456789', normalizePriceModifier:x=>x, resolvePerPersonStay:async()=>({totalPerPerson:2310, averageNightlyRate:385})});
vm.runInContext(clean('backend/pricingQuote.js'), quote);
function elements() {
  const all = new Map(); let ready;
  function w(id) {
    if (!all.has(id)) all.set(id, {text:'EDITOR', html:'', value:'', hidden:true, collapsed:true, enabled:true, link:'', data:[],
      show(){this.hidden=false;}, hide(){this.hidden=true;}, expand(){this.collapsed=false;}, collapse(){this.collapsed=true;},
      disable(){this.enabled=false;}, enable(){this.enabled=true;}, onClick(f){this.click=f;}, onChange(f){this.change=f;}, onItemReady(f){this.itemReady=f;}, forEachItem(){}});
    return all.get(id);
  }
  w.onReady = f => ready=f;
  return {w, all, ready:()=>ready()};
}
const flush = async()=> { for(let i=0;i<20;i++) await new Promise(r=>setImmediate(r)); };
const day = d => new Date(2027,3,d,12);
const row = (ci=11,co=17) => ({roomCode:'adventure_suite',roomName:'Adventure Suite',maxQty:3,occupancy:2,baseOccupancy:2,status:'full',availableNights:co-ci,availableCheckIn:`2027-04-${ci}T00:00:00.000Z`,availableCheckOut:`2027-04-${co}T00:00:00.000Z`,roomFee:0});
async function search(overrides={}) {
  const ui=elements(), nav=[], stored=new Map(), calls=[];
  const c=vm.createContext({Date, console:{log(){},error(){}}, $w:ui.w, setTimeout:()=>0, localStorage:{setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)}, wixLocation:{query:{},to:u=>nav.push(u)}, wixWindow:{scrollTo(){}}, getAllSettings:async()=>({}), getRoomNames:async()=>({}), getActiveMessages:async()=>[], getPackageAmenities:async()=>pkg, packageExistsForNights:async()=>true, getPackagesByNights:async()=>[{...pkg}], searchAvailability:async()=>({ok:true,requestedNights:6,results:[row()]}), suggestAlternateDates:async()=>({suggestions:[]}), createPricingQuote:async(p,ci,co)=>{calls.push([p,ci,co]);return quote.createLockedPricingQuote(p,ci,co);}, ...Object.fromEntries(['initTracking','captureClickIds','trackViewBookingSearch','trackBeginBooking','trackRoomView','trackSearchNoResults','setSuspendGoogleAds'].map(k=>[k,()=>{}])), ...overrides});
  vm.runInContext(clean('page-booking-search.js'),c); await ui.ready();
  ui.w('#datePickerCheckIn').value=day(11); ui.w('#datePickerCheckOut').value=day(17);
  const run=async()=>{await ui.w('#btnSearchRooms').click();await flush();};
  const select=(r=ui.w('#searchResultsRepeater').data[0],qty='2')=>{const item=elements();ui.w('#searchResultsRepeater').itemReady(item.w,r);item.w('#roomQtyDropdown').value=qty;item.w('#roomQtyDropdown').change({target:{value:qty}});return item;};
  return {...ui,c,nav,stored,calls,run,select};
}
async function summary(token, co='2027-04-17', overrides={}) {
 const ui=elements(), timers=[];
 const parent={hidden:true,collapsed:true,show(){this.hidden=false;},expand(){this.collapsed=false;}};
 ui.w('#bookingStatus').parent=parent;
 const c=vm.createContext({Date,console:{log(){},error(){}},$w:ui.w,wixLocation:{query:{rc:'adventure_suite:2:2:0',ci:'2027-04-11',co,pkg:pkg._id,quote:token}},wixData:sdk,localStorage:{getItem:()=>null},initTracking(){},getAllSettings:async()=>({}),getRoomNames:async()=>({}),getPackagesByNights:async()=>[{...pkg}],readPricingQuote:(t,p,ci,co)=>quote.verifyLockedPricingQuote(t,{packageId:p,checkIn:ci,checkOut:co}),setSuspendGoogleAds(){},setTimeout:f=>{timers.push(f);return timers.length;},clearTimeout(){},...overrides});
 vm.runInContext(clean('page-booking-summary.js'),c);ui.ready();await flush();return {...ui,c,parent,timers};
}
const cases=[];
async function test(name,f) {try {await f();cases.push({name,pass:true});}catch(e){cases.push({name,pass:false,error:e.stack});}}
(async()=>{
 await test('Apr11-Apr17 request cannot hand off Apr18 row',async()=>{const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results:[row(11,18)]})});await s.run();s.select();await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.equal(s.stored.size,0);assert.match(s.w('#statusText').html,/search|dates/i);});
 await test('valid exact handoff preserves package and per-guest quantity',async()=>{const s=await search();await s.run();const item=s.select();assert.equal(item.w('#roomQtyDropdown').options.length,4);await s.w('#btnSummary').click();assert.equal(s.nav.length,1);const q=new URL(s.nav[0],'https://inert.invalid').searchParams;assert.equal(q.get('rc'),'adventure_suite:2:2:0');assert.equal(q.get('pkg'),pkg._id);assert.equal(q.get('ci'),'2027-04-11');assert.equal(q.get('co'),'2027-04-17');const verified=await quote.verifyLockedPricingQuote(q.get('quote'),{packageId:pkg._id,checkIn:q.get('ci'),checkOut:q.get('co')});assert.equal(verified.totalPerPerson,2310);assert.equal(s.w('#finalTotal').text,'$9,240.00');});
 await test('partial interval requires explicit new search',async()=>{const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results:[{...row(11,15),status:'partial'}]})});await s.run();s.select();await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.match(s.w('#statusText').html,/partial.*search again/i);});
 for (const id of ['#datePickerCheckIn','#datePickerCheckOut']) await test('date edit invalidates selections and quote '+id,async()=>{const s=await search();await s.run();const old=s.select();s.w(id).value=day(id.endsWith('In')?12:18);s.w(id).change({target:{value:s.w(id).value}});assert.equal(vm.runInContext('_selections.length',s.c),0);assert.equal(vm.runInContext('_selectedPackage',s.c),null);assert.equal(s.w('#searchResultsRepeater').data.length,0);old.w('#roomQtyDropdown').change({target:{value:'2'}});assert.equal(vm.runInContext('_selections.length',s.c),0);await s.w('#btnSummary').click();assert.equal(s.nav.length,0);});
 await test('older availability cannot overwrite newer results',async()=>{let release;const gate=new Promise(r=>release=r);let n=0;const s=await search({searchAvailability:async()=>++n===1?gate:{ok:true,requestedNights:6,results:[row(12,18)]}});await s.run();s.w('#datePickerCheckIn').value=day(12);s.w('#datePickerCheckOut').value=day(18);await s.run();release({ok:true,requestedNights:6,results:[row()]});await flush();assert.equal(s.w('#searchResultsRepeater').data[0].availableCheckIn,row(12,18).availableCheckIn);});
 await test('older package lookup cannot create a quote with newer mutable dates',async()=>{let release,n=0;const gate=new Promise(r=>release=r);const s=await search({getPackagesByNights:async()=>++n===1?gate:[{...pkg}]});await s.run();s.w('#datePickerCheckIn').value=day(12);s.w('#datePickerCheckOut').value=day(18);await s.run();release([{...pkg}]);await flush();assert.equal(s.calls.length,1);assert.equal(s.calls[0][1],'2027-04-12');});
 await test('older pending quote cannot publish or restore stale package callbacks',async()=>{let release,n=0;const gate=new Promise(r=>release=r);const s=await search({createPricingQuote:async(p,ci,co)=>{const made=await quote.createLockedPricingQuote(p,ci,co);if(++n===1){await gate;}return made;}});await s.run();s.w('#datePickerCheckIn').value=day(12);s.w('#datePickerCheckOut').value=day(18);await s.run();const token=vm.runInContext('_selectedPackage.pricingQuoteToken',s.c);release();await flush();assert.equal(vm.runInContext('_selectedPackage.pricingQuoteToken',s.c),token);});
 await test('detached same-ID package row callback cannot restore old quote',async()=>{const s=await search();await s.run();const old=elements();const rep=s.w('#packageRepeater');rep.itemReady(old.w,rep.data[0]);const click=old.w('#packageContainer').click;s.w('#datePickerCheckIn').value=day(12);s.w('#datePickerCheckOut').value=day(18);await s.run();const token=vm.runInContext('_selectedPackage.pricingQuoteToken',s.c);click();assert.equal(vm.runInContext('_selectedPackage.pricingQuoteToken',s.c),token);});
 await test('double Summary click produces only one navigation',async()=>{const s=await search();await s.run();s.select();await s.w('#btnSummary').click();await s.w('#btnSummary').click();assert.equal(s.nav.length,1);});
 await test('late quote after date edit cannot restore pricing',async()=>{let release;const gate=new Promise(r=>release=r);const s=await search({createPricingQuote:async(p,ci,co)=>{const made=await quote.createLockedPricingQuote(p,ci,co);await gate;return made;}});await s.run();s.w('#datePickerCheckOut').value=day(18);s.w('#datePickerCheckOut').change({target:{value:day(18)}});release();await flush();assert.equal(vm.runInContext('_selectedPackage',s.c),null);assert.equal(s.w('#packageRepeater').data.length,0);});
 await test('pending search rejects old package click and Summary',async()=>{let release,n=0;const gate=new Promise(r=>release=r);const s=await search({searchAvailability:async()=>++n===1?{ok:true,requestedNights:6,results:[row()]}:gate});await s.run();s.select();const old=elements();const rep=s.w('#packageRepeater');rep.itemReady(old.w,rep.data[0]);await s.run();old.w('#packageContainer').click();await s.w('#btnSummary').click();assert.equal(vm.runInContext('_selectedPackage',s.c),null);assert.equal(s.nav.length,0);release({ok:true,requestedNights:6,results:[]});await flush();});
 const made=await quote.createLockedPricingQuote(pkg._id,'2027-04-11','2027-04-17');
 await test('valid Summary executes real rendering and wires Continue only after validation',async()=>{const s=await summary(made.token);assert.equal(s.w('#bookingStatus').text,'');assert.equal(s.w('#btnContinue').enabled,true);assert.equal(typeof s.w('#btnContinue').click,'function');assert.equal(s.w('#grandTotal').hidden,false);assert.equal(s.w('#packageTotal').text,'$9,240.00');assert.equal(s.w('#totalGuests').text,'4');assert.equal(s.w('#totalNightsDisplay').text,'6 nights');});
 for (const [name,token,co] of [['mismatched dates',made.token,'2027-04-18'],['bad signature',made.token+'x','2027-04-17'],['missing quote','','2027-04-17']]) await test('Summary '+name+' sets recovery without revealing parents, hidden totals, no Continue',async()=>{const s=await summary(token,co);assert.equal(s.parent.hidden,true);assert.equal(s.parent.collapsed,true);assert.equal(s.w('#bookingStatus').hidden,false);assert.match(s.w('#bookingStatus').text,/search/i);assert.equal(s.w('#grandTotal').hidden,true);assert.equal(s.w('#btnContinue').enabled,false);assert.equal(s.w('#btnContinue').click,undefined);});
 await test('Summary pending load sets timeout status and late result cannot wire Continue',async()=>{let release;const gate=new Promise(r=>release=r);const s=await summary(made.token,'2027-04-17',{getAllSettings:()=>gate});assert.match(s.w('#bookingStatus').text,/loading/i);assert.equal(s.parent.hidden,true);assert.equal(s.timers.length,1);s.timers[0]();assert.match(s.w('#bookingStatus').text,/search/i);release({});await flush();assert.equal(s.w('#btnContinue').click,undefined);assert.equal(s.w('#grandTotal').hidden,true);});
 await test('Summary timeout during render fallback cannot reveal late financial values',async()=>{let release;const gate=new Promise(r=>release=r);const original=pkg.baseRate;pkg.baseRate=0;let zero;try{zero=await quote.createLockedPricingQuote(pkg._id,'2027-04-11','2027-04-17');}finally{pkg.baseRate=original;}const s=await summary(zero.token,'2027-04-17',{getPackageBaseRate:()=>gate});s.timers[0]();release(0);await flush();assert.equal(s.w('#grandTotal').hidden,true);assert.equal(s.w('#btnContinue').click,undefined);});
 console.log(JSON.stringify({timezone:process.env.TZ,cases},null,2));
 assert.equal(cases.length,18);
 assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
