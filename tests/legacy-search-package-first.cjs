// Actual page callbacks with inert SDK/transport; inherited real quote signer.
const fs=require('fs'),path=require('path'),vm=require('vm');
const original=fs.readFileSync(path.join(__dirname,'legacy-date-handoff.cjs'),'utf8');
const marker=original.indexOf('(async()=>{');
if(marker<0)throw Error('Missing harness entry');
const tests=`
function trace(s){
 const events=[];
 for(const id of ['#packageRepeater','#searchResultsRepeater']){
  const el=s.w(id);let data=el.data;
  Object.defineProperty(el,'data',{get:()=>data,set:v=>{data=v;events.push([id,'data',v.length]);if(id==='#searchResultsRepeater'&&v.length)events.push(['selected',vm.runInContext('_selectedPackage && _selectedPackage._id',s.c)]);}});
  for(const action of ['show','expand']){const old=el[action];el[action]=function(){events.push([id,action]);return old.call(this);};}
 }
 return events;
}
function ordered(events){
 const p=events.findIndex(e=>e[0]==='#packageRepeater'&&e[1]==='data'&&e[2]>0);
 const r=events.findIndex(e=>e[0]==='#searchResultsRepeater'&&e[1]==='data'&&e[2]>0);
 assert.ok(p>=0&&r>p,JSON.stringify(events));
 for(const action of ['show','expand'])assert.ok(events.findIndex(e=>e[0]==='#searchResultsRepeater'&&e[1]===action)>p,JSON.stringify(events));
 assert.equal(events.find(e=>e[0]==='selected')[1],pkg._id);
}
(async()=>{
 await test('delayed package list holds room data and reveal until quoted default is populated',async()=>{
  let release,fetches=0;const gate=new Promise(r=>release=r);
  const s=await search({getPackagesByNights:()=>{fetches++;return gate;}}),events=trace(s);
  await s.run();assert.equal(fetches,1);
  try {assert.equal(s.w('#searchResultsRepeater').data.length,0);assert.equal(s.w('#searchResultsRepeater').hidden,true);}finally{release([{...pkg}]);await flush();}
  ordered(events);assert.equal(s.calls.length,1);
 });
 await test('ordinary success populates packages and selects default before rooms',async()=>{const s=await search(),events=trace(s);await s.run();ordered(events);assert.equal(s.calls.length,1);});
 await test('old package completion cannot replace newer room/package data',async()=>{
  let release,n=0;const gate=new Promise(r=>release=r);const s=await search({getPackagesByNights:()=>++n===1?gate:Promise.resolve([{...pkg}])}),events=trace(s);
  await s.run();s.w('#datePickerCheckIn').value=day(12);s.w('#datePickerCheckOut').value=day(18);await s.run();const before=JSON.stringify(events);release([{...pkg}]);await flush();assert.equal(JSON.stringify(events),before);assert.equal(s.calls.length,1);assert.equal(s.w('#searchResultsRepeater').data[0].availableCheckIn,row(12,18).availableCheckIn);
 });
 await test('old quote completion after date invalidation cannot reveal rooms',async()=>{
  let release;const gate=new Promise(r=>release=r);const s=await search({createPricingQuote:async(p,ci,co)=>{const result=await quote.createLockedPricingQuote(p,ci,co);await gate;return result;}});await s.run();s.w('#datePickerCheckOut').value=day(18);s.w('#datePickerCheckOut').change({target:{value:day(18)}});release();await flush();assert.equal(s.w('#searchResultsRepeater').data.length,0);assert.equal(s.w('#searchResultsRepeater').hidden,true);assert.equal(s.w('#packageRepeater').data.length,0);assert.equal(vm.runInContext('_selectedPackage',s.c),null);
 });
 await test('older availability does not start duplicate package fetch',async()=>{
  let release,n=0,fetches=0;const gate=new Promise(r=>release=r);const s=await search({searchAvailability:async(ci,co)=>++n===1?gate:{ok:true,requestedNights:6,results:[row(12,18)]},getPackagesByNights:async()=>{fetches++;return [{...pkg}];}}),events=trace(s);await s.run();s.w('#datePickerCheckIn').value=day(12);s.w('#datePickerCheckOut').value=day(18);await s.run();release({ok:true,requestedNights:6,results:[row()]});await flush();ordered(events);assert.equal(fetches,1);assert.equal(s.calls.length,1);
 });
 for(const mode of ['empty packages','rejected packages','rejected quote','mismatched quote'])await test(mode+' preserves room-display policy but denies Summary',async()=>{
  const overrides=mode==='empty packages'?{getPackagesByNights:async()=>[]}:mode==='rejected packages'?{getPackagesByNights:async()=>{throw Error('inert');}}:mode==='rejected quote'?{createPricingQuote:async()=>{throw Error('inert');}}:{createPricingQuote:async(p,ci,co)=>{const made=await quote.createLockedPricingQuote(p,ci,co);made.quote.checkOut='2027-04-18';return made;}};
  const s=await search(overrides);await s.run();assert.match(s.w('#statusText').html,/No packages|Unable to/);assert.equal(s.w('#searchResultsRepeater').data.length,1);assert.equal(s.w('#searchResultsRepeater').hidden,false);assert.equal(s.w('#packageRepeater').data.length,0);assert.equal(vm.runInContext('_selectedPackage',s.c),null);await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.equal(s.stored.size,0);
 });
 for(const mode of ['empty rooms','partial rooms','no packages for nights','availability failure'])await test(mode+' clears prior data without package lookup',async()=>{
  const s=await search();await s.run();let fetches=0;s.c.getPackagesByNights=async()=>{fetches++;return [{...pkg}];};
  if(mode==='no packages for nights')s.c.packageExistsForNights=async()=>false;
  else s.c.searchAvailability=async()=>mode==='availability failure'?{ok:false,error:'inert'}:{ok:true,requestedNights:6,results:mode==='empty rooms'?[]:[{...row(),status:'partial'}]};
  await s.run();assert.equal(fetches,0);assert.equal(s.w('#searchResultsRepeater').data.length,0);assert.equal(s.w('#packageRepeater').data.length,0);
 });
 console.log(JSON.stringify({cases},null,2));assert.equal(cases.length,13);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+original.slice(0,marker)+tests+'})',{filename:__filename})(require,__dirname);
