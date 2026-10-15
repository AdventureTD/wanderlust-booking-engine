// Actual page module; inert SDK/tracking, real quote issuer, additive Wix events.
const fs = require('fs'), path = require('path'), vm = require('vm');
const original = fs.readFileSync(path.join(__dirname, 'legacy-date-handoff.cjs'), 'utf8');
const marker = original.indexOf('(async()=>{');
if (marker < 0) throw Error('Missing actual-page fixture seam');
const tests = String.raw`
const selectionIds = 'selection vacationDates nightsDominica roomsSelected selectedRoomsContainer yourSelection selectedRooms totalGuests priceSummary packageText subTotalBooking penthouseText penthouseFee totalText finalTotal selectionBox line102 line103 line104 line106 packageTitle packageName3 packageAmenities btnSummary'.split(' ');
function elements() {
 const all=new Map(), trace=[]; let ready;
 function w(id) {
  if(!all.has(id)) {
   const listeners={click:[],change:[],itemReady:[]}, rows=new Map(); let data=[];
   const el={text:'EDITOR',html:'',value:'',hidden:true,collapsed:true,enabled:true,link:'',listeners,rows,
    show(){this.hidden=false;trace.push(['show',id]);},hide(){this.hidden=true;},expand(){this.collapsed=false;trace.push(['expand',id]);},collapse(){this.collapsed=true;},
    disable(){this.enabled=false;},enable(){this.enabled=true;},
    onClick(f){listeners.click.push(f);},onChange(f){listeners.change.push(f);},onItemReady(f){listeners.itemReady.push(f);},
    click(e){return Promise.all(listeners.click.map(f=>f(e)));},change(e){listeners.change.forEach(f=>f(e));},
    itemReady(scope,item){listeners.itemReady.forEach(f=>f(scope,item));},
    forEachItem(f){for(const item of data){const scope=rows.get(item._id);if(scope)f(scope.w,item);}}
   };
   Object.defineProperty(el,'data',{get:()=>data,set(next){data=next;for(const key of rows.keys())if(!next.some(x=>x._id===key))rows.delete(key);for(const item of next){if(!rows.has(item._id)){const scope=elements();rows.set(item._id,scope);el.itemReady(scope.w,item);}}}});
   all.set(id,el);
  }
  return all.get(id);
 }
 w.onReady=f=>ready=f;
 return {w,all,trace,ready:()=>ready()};
}
function visibility(s,visible){for(const id of selectionIds){assert.equal(s.w('#'+id).collapsed,!visible,id+' collapsed');assert.equal(s.w('#'+id).hidden,!visible,id+' hidden');}}
function change(el,value){el.value=value;el.change({target:{value}});}
function room(s,index=0){const rep=s.w('#searchResultsRepeater');return rep.rows.get(rep.data[index]._id);}
function qty(s,value,index=0){change(room(s,index).w('#roomQtyDropdown'),String(value));}
async function setup(overrides={}){const s=await search(overrides);await s.run();return s;}
(async()=>{
 await test('initial and searched zero selection stay collapsed without summary flash',async()=>{
  const s=await search();visibility(s,false);await s.run();visibility(s,false);
  assert.equal(s.trace.filter(([op,id])=>selectionIds.includes(id.slice(1))).length,0);
  await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
 });
 await test('one room and two rooms multiply guests; zero collapses every ID',async()=>{
  const s=await setup();qty(s,1);visibility(s,true);assert.equal(s.w('#selectedRooms').text,'1 rooms');assert.equal(s.w('#totalGuests').text,'2 guests total');
  qty(s,2);assert.equal(s.w('#selectedRooms').text,'2 rooms');assert.equal(s.w('#totalGuests').text,'4 guests total');
  qty(s,0);visibility(s,false);assert.equal(s.w('#btnSummary').enabled,false);await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
 });
 await test('mixed quantities and higher Two Bedroom guests use scoped exact ID',async()=>{
  const s=await setup({searchAvailability:async()=>({ok:true,requestedNights:6,results:[row(),{...row(),roomCode:'two_bedroom',roomName:'Two Bedroom',occupancy:6,baseOccupancy:2}]})});
  qty(s,2);change(room(s,1).w('#numberOfGuests'),'4');qty(s,1,1);
  assert.equal(s.w('#selectedRooms').text,'3 rooms');assert.equal(s.w('#totalGuests').text,'8 guests total');
  change(room(s,1).w('#numberOfGuests'),'6');assert.equal(s.w('#totalGuests').text,'10 guests total');
  qty(s,0,1);assert.equal(s.w('#totalGuests').text,'4 guests total');change(room(s,1).w('#numberOfGuests'),'5');assert.equal(s.w('#totalGuests').text,'4 guests total');
  assert.deepEqual(Array.from(room(s,1).w('#numberOfGuests').options,o=>o.value),['2','3','4','5','6']);
 });
 await test('Penthouse removal clears displayed fee instead of retaining stale money',async()=>{
  const s=await setup({searchAvailability:async()=>({ok:true,requestedNights:6,results:[row(),{...row(),roomCode:'penthouse_apartment',roomFee:75}]})});
  qty(s,1);qty(s,1,1);assert.equal(s.w('#penthouseFee').text,'$450.00');assert.equal(s.w('#finalTotal').text,'$9,690.00');
  qty(s,0,1);visibility(s,true);assert.equal(s.w('#penthouseFee').text,'$0.00');assert.equal(s.w('#finalTotal').text,'$4,620.00');
 });
 await test('date edits refresh civil nights and clearing dates clears stale nights',async()=>{
  const s=await setup();qty(s,1);change(s.w('#datePickerCheckOut'),day(18));visibility(s,false);assert.equal(s.w('#nightsDominica').text,'7 nights in Dominica');
  change(s.w('#datePickerCheckOut'),null);assert.equal(s.w('#nightsDominica').text,'0 nights in Dominica');visibility(s,false);
  await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
 });
 await test('repeated readiness preserves choices and binds room listeners once',async()=>{
  const s=await setup(),rep=s.w('#searchResultsRepeater'),r=room(s);qty(s,2);
  rep.itemReady(r.w,rep.data[0]);
  assert.equal(r.w('#roomQtyDropdown').listeners.change.length,1);assert.equal(r.w('#numberOfGuests').listeners.change.length,1);
  assert.equal(r.w('#roomQtyDropdown').value,'2');assert.equal(s.w('#selectedRooms').text,'2 rooms');
 });
 await test('removed same-ID room callbacks cannot revive selection',async()=>{
  const s=await setup(),old=room(s);qty(s,1);await s.run();visibility(s,false);
  change(old.w('#roomQtyDropdown'),'2');visibility(s,false);qty(s,1);assert.equal(s.w('#selectedRooms').text,'1 rooms');
 });
 for(const [ci,co] of [[new Date(2027,2,10,0),new Date(2027,2,17,23)],[new Date(2026,9,28,0),new Date(2026,10,4,23)]]) await test('seven civil nights across DST '+ci.getMonth(),async()=>{
  const s=await search({getPackagesByNights:async()=>[{...pkg,numberOfNights:7}],createPricingQuote:async(id,a,b)=>({quote:{packageId:id,checkIn:a,checkOut:b,nights:7},pricing:{totalPerPerson:100},token:'INERT'}),searchAvailability:async(a,b)=>({ok:true,requestedNights:7,results:[{...row(),availableNights:7,availableCheckIn:a.toISOString(),availableCheckOut:b.toISOString()}]})});
  s.w('#datePickerCheckIn').value=ci;s.w('#datePickerCheckOut').value=co;await s.run();qty(s,1);visibility(s,true);assert.equal(s.w('#nightsDominica').text,'7 nights in Dominica');
 });
 await test('quote failure permits visible selection but blanks prices and denies navigation',async()=>{
  const s=await setup({createPricingQuote:async()=>{throw Error('inert quote failure');}});qty(s,1);visibility(s,true);
  for(const id of ['subTotalBooking','penthouseFee','finalTotal'])assert.equal(s.w('#'+id).text,'');
  assert.equal(s.w('#btnSummary').enabled,false);assert.equal(s.w('#bookingSummaryContainer').collapsed,false);
  await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.equal(s.stored.size,0);
 });
 for(const boundary of ['searchAvailability','getPackagesByNights','createPricingQuote']) await test('late '+boundary+' cannot reopen invalidated selection',async()=>{
  let release;const gate=new Promise(r=>release=r);
  const result=boundary==='searchAvailability'?{ok:true,requestedNights:6,results:[row()]}:boundary==='getPackagesByNights'?[pkg]:await quote.createLockedPricingQuote(pkg._id,'2027-04-11','2027-04-17');
  const s=await search({[boundary]:()=>gate});await s.run();change(s.w('#datePickerCheckOut'),null);release(result);await flush();visibility(s,false);
  assert.equal(s.w('#finalTotal').text,'');await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
 });
 await test('invalid reversed and invalid Date values keep summary collapsed',async()=>{
  const s=await setup();qty(s,1);change(s.w('#datePickerCheckOut'),day(10));visibility(s,false);assert.equal(s.w('#nightsDominica').text,'0 nights in Dominica');
  change(s.w('#datePickerCheckIn'),new Date('invalid'));visibility(s,false);await s.run();await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
 });
 await test('failed replacement quote cannot revive old package amenities or money',async()=>{
  let fail=false;const s=await setup({getPackagesByNights:async()=>[{...pkg,includedAmenities:'OLD AMENITIES'}],createPricingQuote:async(id,ci,co)=>{if(fail)throw Error('inert quote failure');return quote.createLockedPricingQuote(id,ci,co);}});
  qty(s,1);assert.equal(s.w('#packageAmenities').text,'OLD AMENITIES');fail=true;await s.run();qty(s,1);visibility(s,true);
  assert.equal(s.w('#packageAmenities').text,'');assert.equal(s.w('#packageTitle').text,'');assert.equal(s.w('#finalTotal').text,'');await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
 });
 await test('removed physical room cannot act on same-ID replacement within current search',async()=>{
  const s=await setup(),rep=s.w('#searchResultsRepeater'),old=room(s),data=rep.data;
  rep.data=[];rep.data=data;change(old.w('#roomQtyDropdown'),'2');visibility(s,false);qty(s,1);assert.equal(s.w('#selectedRooms').text,'1 rooms');
 });
 console.log(JSON.stringify({timezone:process.env.TZ,cases},null,2));assert.equal(cases.length,16);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+original.slice(0,marker)+tests+'})',{filename:__filename})(require,__dirname);
