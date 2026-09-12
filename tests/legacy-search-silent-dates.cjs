// Actual onReady-registered Search callbacks; reuse inert Wix/real quote harness.
const fs = require('fs'), path = require('path'), vm = require('vm');
const original = fs.readFileSync(path.join(__dirname, 'legacy-date-handoff.cjs'), 'utf8');
const marker = original.indexOf('(async()=>{');
if (marker < 0) throw Error('Legacy harness entry point missing');
// Model a visible editor placeholder so startup cannot pass by fixture hiding it.
const setup = 'const ui=elements(), nav=[], stored=new Map(), calls=[];';
if (!original.includes(setup)) throw Error('Legacy Search setup missing');
const prefix = original.slice(0, marker).replace(setup, setup + "ui.w('#statusText').html='EDITOR';ui.w('#statusText').show();ui.w('#statusText').expand();");
const tests = `
function edit(s,id,value) {
 const el=s.w(id);el.value=value;el.change({target:{value}});
}
function silent(s) {
 assert.equal(s.w('#statusText').html.replace(/<[^>]*>/g,''),'','date editing must not display a status message');
}
(async()=>{
 await test('startup clears a visible editor status before any date callback',async()=>{
  const s=await search();silent(s);assert.equal(s.calls.length,0);
 });
 await test('first check-in defaults checkout without warning; checkout edit stays silent',async()=>{
  let searches=0;const s=await search({searchAvailability:async()=>{searches++;return {ok:true,results:[]};}});
  s.w('#datePickerCheckIn').value=null;s.w('#datePickerCheckOut').value=null;
  edit(s,'#datePickerCheckIn',day(11));silent(s);
  assert.equal(s.w('#datePickerCheckOut').value.getTime(),day(11).getTime());
  edit(s,'#datePickerCheckOut',day(17));silent(s);
  assert.equal(searches,0);assert.equal(s.calls.length,0);assert.equal(s.nav.length,0);
 });
 for (const [name,ci,co,message] of [
  ['missing dates',null,null,/Please select check-in and check-out dates/],
  ['same-day stay',day(11),day(11),/Check-in date must be before/],
  ['reversed stay',day(17),day(11),/Check-in date must be before/]
 ]) await test('Check Availability validates '+name+' only on click',async()=>{
  let searches=0,packages=0;const s=await search({searchAvailability:async()=>{searches++;return {ok:true,results:[]};},packageExistsForNights:async()=>{packages++;return true;}});
  edit(s,'#datePickerCheckIn',ci);edit(s,'#datePickerCheckOut',co);silent(s);
  await s.run();assert.match(s.w('#statusText').html,message);
  assert.equal(s.w('#statusText').hidden,false);assert.equal(s.w('#statusText').collapsed,false);
  assert.equal(searches,0);assert.equal(packages,0);assert.equal(s.calls.length,0);
 });
 for (const id of ['#datePickerCheckIn','#datePickerCheckOut']) {
  await test('editing clears prior validation error '+id,async()=>{
   const s=await search();s.w('#datePickerCheckOut').value=day(11);await s.run();
   assert.match(s.w('#statusText').html,/Check-in date must be before/);
   edit(s,id,day(id.endsWith('In')?12:18));silent(s);
   assert.equal(s.w('#btnSummary').hidden,true);assert.equal(s.nav.length,0);
  });
  await test('editing after valid search silently rejects detached room/package callbacks '+id,async()=>{
   const s=await search();await s.run();const oldRoom=s.select(),oldPackage=elements();
   const rep=s.w('#packageRepeater');rep.itemReady(oldPackage.w,rep.data[0]);
   for(const k of ['_wbe_rc','_wbe_ci','_wbe_co','_wbe_pkg','_wbe_quote'])s.stored.set(k,'old');
   edit(s,id,day(id.endsWith('In')?12:18));silent(s);
   oldRoom.w('#roomQtyDropdown').change({target:{value:'2'}});
   oldRoom.w('#numberOfGuests').change({target:{value:'2'}});
   oldPackage.w('#packageContainer').click();silent(s);
   assert.equal(vm.runInContext('_selections.length',s.c),0);
   assert.equal(vm.runInContext('_selectedPackage',s.c),null);
   assert.equal(s.w('#searchResultsRepeater').data.length,0);assert.equal(rep.data.length,0);
   assert.equal(s.w('#btnSummary').hidden,true);assert.equal(s.w('#bookingSummaryContainer').hidden,true);
   assert.equal(s.stored.size,0);assert.equal(s.nav.length,0);
  });
 }
 await test('check-in preserves a later checkout and advances an earlier checkout silently',async()=>{
  const s=await search();edit(s,'#datePickerCheckIn',day(12));silent(s);
  assert.equal(s.w('#datePickerCheckOut').value.getTime(),day(17).getTime());
  edit(s,'#datePickerCheckIn',day(18));silent(s);
  assert.equal(s.w('#datePickerCheckOut').value.getTime(),day(18).getTime());
 });
 await test('valid search after silent edits still prices and navigates exact dates',async()=>{
  const s=await search();edit(s,'#datePickerCheckIn',day(11));edit(s,'#datePickerCheckOut',day(17));silent(s);
  await s.run();assert.match(s.w('#statusText').html,/Found 1 result for 6 nights/);
  s.select();assert.equal(s.w('#finalTotal').text,'$9,240.00');
  await s.w('#btnSummary').click();assert.equal(s.nav.length,1);
  const q=new URL(s.nav[0],'https://inert.invalid').searchParams;
  assert.equal(q.get('ci'),'2027-04-11');assert.equal(q.get('co'),'2027-04-17');
  assert.equal(q.get('rc'),'adventure_suite:2:2:0');assert.equal(q.get('pkg'),pkg._id);
  const verified=await quote.verifyLockedPricingQuote(q.get('quote'),{packageId:pkg._id,checkIn:q.get('ci'),checkOut:q.get('co')});
  assert.equal(verified.totalPerPerson,2310);
 });
 for(const phase of ['package existence','availability','availability rejection','package lookup','quote','alternates']) await test('edit while pending '+phase+' fences late completion without warning',async()=>{
  let release,reject,entered=0;const gate=new Promise((resolve,fail)=>{release=resolve;reject=fail;});
  const pause=()=>{entered++;return gate;};let response;
  const overrides={};
  if(phase==='package existence'){overrides.packageExistsForNights=pause;response=true;}
  if(phase.startsWith('availability')){overrides.searchAvailability=pause;response={ok:true,requestedNights:6,results:[row()]};}
  if(phase==='package lookup'){overrides.getPackagesByNights=pause;response=[{...pkg}];}
  if(phase==='quote'){overrides.createPricingQuote=pause;response=await quote.createLockedPricingQuote(pkg._id,'2027-04-11','2027-04-17');}
  if(phase==='alternates'){
   overrides.searchAvailability=async()=>({ok:true,requestedNights:6,results:[]});overrides.suggestAlternateDates=pause;
   response={suggestions:[{checkIn:'2027-04-20T12:00:00',checkOut:'2027-04-26T12:00:00',label:'STALE'}]};
  }
  const s=await search(overrides);
  try {
   await s.run();assert.equal(entered,1,'actual callback must reach the paused dependency');
   edit(s,'#datePickerCheckOut',day(18));silent(s);
   if(phase==='availability rejection')reject(Error('STALE ERROR'));else release(response);
   await flush();silent(s);
   assert.equal(vm.runInContext('_selectedPackage',s.c),null);assert.equal(vm.runInContext('_selections.length',s.c),0);
   assert.equal(s.w('#searchResultsRepeater').data.length,0);assert.equal(s.w('#packageRepeater').data.length,0);
   assert.equal(s.w('#btnSummary').hidden,true);assert.equal(s.nav.length,0);assert.equal(s.stored.size,0);
  } finally {release(response);await flush();}
 });
 console.log(JSON.stringify({timezone:process.env.TZ,resolvedTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone,offset:new Date(2027,3,11,12).getTimezoneOffset(),cases},null,2));
 assert.equal(cases.length,17);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+prefix+tests+'})', {filename:__filename})(require,__dirname);
