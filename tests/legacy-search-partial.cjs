// Actual Search handlers via the existing inert Wix/transport harness.
const fs = require('fs'), path = require('path'), vm = require('vm');
const original = fs.readFileSync(path.join(__dirname, 'legacy-date-handoff.cjs'), 'utf8');
const prefix = original.slice(0, original.indexOf('(async()=>{'));
const tests = `
function mount(s,r) {const item=elements();s.w('#searchResultsRepeater').itemReady(item.w,r);return item;}
function denySelection(s,item) {
 const dd=item.w('#roomQtyDropdown'), guests=item.w('#numberOfGuests');
 assert.equal(dd.enabled,false,'non-full row quantity must be disabled');
 assert.deepEqual(Array.from(dd.options,x=>x.value),['0']);assert.equal(dd.value,'0');
 assert.equal(guests.enabled,false);
 if(dd.change)dd.change({target:{value:'2'}});
 if(guests.change)guests.change({target:{value:'2'}});
 assert.equal(vm.runInContext('_selections.length',s.c),0);
}
(async()=>{
 await test('Dec1-Dec9 partial-only response cannot advertise or price eight-night inventory',async()=>{
  let alternatives=0, packages=0, amenities=0;
  const response={ok:true,requestedNights:8,results:[{roomCode:'adventure_suite',units:3,maxQty:2,status:'partial',availableCheckIn:'2026-12-05T00:00:00.000Z',availableCheckOut:'2026-12-09T00:00:00.000Z',availableNights:4}]};
  const s=await search({searchAvailability:async()=>response,getPackagesByNights:async()=>{packages++;return [pkg];},getPackageAmenities:async()=>{amenities++;return pkg;},suggestAlternateDates:async()=>{alternatives++;return {suggestions:[{checkIn:'2026-12-10T12:00:00',checkOut:'2026-12-18T12:00:00',label:'Dec 10–18'}]};}});
  s.w('#datePickerCheckIn').value=new Date(2026,11,1,12);s.w('#datePickerCheckOut').value=new Date(2026,11,9,12);
  await s.run();
  const item=mount(s,s.w('#searchResultsRepeater').data[0]);denySelection(s,item);
  assert.equal(item.w('#numRooms').text,'');assert.match(item.w('#roomAvailability').text,/partial.*search again/i);
  assert.equal(packages,0);assert.equal(amenities,0);assert.equal(s.calls.length,0);
  assert.equal(s.w('#btnSummary').hidden,true);assert.equal(s.w('#packageRepeater').data.length,0);
  assert.equal(s.w('#bookingSummaryContainer').hidden,true);assert.equal(vm.runInContext('_selectedPackage',s.c),null);
  assert.equal(alternatives,1);assert.match(s.w('#statusText').html,/wanderlust-booking\\?ci=2026-12-10&co=2026-12-18&auto=1/);
  assert.equal(s.w('#datePickerCheckIn').value.getDate(),1,'alternative is not auto-selected');
  await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.equal(s.stored.size,0);
 });
 for (const [name,r] of [['different checkout',row(11,18)],['different checkin',row(12,17)],['missing dates',{...row(),availableCheckIn:null}],['partial with exact dates',{...row(),status:'partial'}]]) await test(name+' is not requested-stay inventory',async()=>{
  const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results:[r]})});await s.run();
  denySelection(s,mount(s,s.w('#searchResultsRepeater').data[0]));
  assert.equal(s.calls.length,0);assert.equal(s.w('#btnSummary').hidden,true);
  await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.equal(s.stored.size,0);
 });
 await test('mixed full and partial counts and prices only full selections',async()=>{
  const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results:[{...row(12,17),roomCode:'partial_suite',status:'partial'},row()]})});await s.run();
  const rows=s.w('#searchResultsRepeater').data;
  denySelection(s,mount(s,rows[0]));assert.match(s.w('#statusText').html,/Found 1 result for 6 nights/);
  const item=s.select(rows[1]);assert.equal(item.w('#roomQtyDropdown').enabled,true);
  assert.equal(s.w('#finalTotal').text,'$9,240.00');
  await s.w('#btnSummary').click();assert.equal(s.nav.length,1);
  const q=new URL(s.nav[0],'https://inert.invalid').searchParams;
  assert.equal(q.get('rc'),'adventure_suite:2:2:0');assert.equal(q.get('ci'),'2027-04-11');assert.equal(q.get('co'),'2027-04-17');
 });
 await test('partial replacement invalidates old room and package callbacks',async()=>{
  let n=0;const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results:[++n===1?row():{...row(12,17),status:'partial'}]})});
  await s.run();const oldRoom=s.select(),oldPackage=elements(),rep=s.w('#packageRepeater');rep.itemReady(oldPackage.w,rep.data[0]);
  await s.run();oldRoom.w('#roomQtyDropdown').change({target:{value:'2'}});oldRoom.w('#numberOfGuests').change({target:{value:'2'}});oldPackage.w('#packageContainer').click();
  assert.equal(vm.runInContext('_selections.length',s.c),0);assert.equal(vm.runInContext('_selectedPackage',s.c),null);
  assert.equal(s.w('#packageRepeater').data.length,0);assert.equal(s.w('#btnSummary').hidden,true);
  await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.equal(s.stored.size,0);
 });
 await test('late partial response cannot replace a newer full stay',async()=>{
  let release,n=0;const gate=new Promise(r=>release=r);
  const s=await search({searchAvailability:async()=>++n===1?gate:{ok:true,requestedNights:6,results:[row(12,18)]}});
  await s.run();s.w('#datePickerCheckIn').value=day(12);s.w('#datePickerCheckOut').value=day(18);await s.run();
  release({ok:true,requestedNights:6,results:[{...row(11,15),status:'partial'}]});await flush();
  assert.equal(s.w('#searchResultsRepeater').data[0].status,'full');s.select();await s.w('#btnSummary').click();assert.equal(s.nav.length,1);
 });
 await test('late alternate response cannot overwrite newer full results',async()=>{
  let release,n=0;const gate=new Promise(r=>release=r);
  const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results:[++n===1?{...row(11,15),status:'partial'}:row()]}),suggestAlternateDates:()=>gate});
  await s.run();await s.run();const status=s.w('#statusText').html;
  release({suggestions:[{checkIn:'2027-04-20T12:00:00',checkOut:'2027-04-26T12:00:00',label:'STALE'}]});await flush();
  assert.equal(s.w('#statusText').html,status);s.select();await s.w('#btnSummary').click();assert.equal(s.nav.length,1);
 });
 console.log(JSON.stringify({timezone:process.env.TZ,cases},null,2));
 assert.equal(cases.length,9);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+prefix+tests+'})', {filename:__filename})(require,__dirname);
