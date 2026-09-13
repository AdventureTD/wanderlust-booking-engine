// Actual Search handlers with the existing inert Wix harness and real quote HMAC.
const fs = require('fs'), path = require('path'), vm = require('vm');
const original = fs.readFileSync(path.join(__dirname, 'legacy-date-handoff.cjs'), 'utf8');
const marker = original.indexOf('(async()=>{');
if (marker < 0) throw Error('Legacy harness entry point missing');
const prefix = original.slice(0, marker);
const tests = `
function packages(titles) {
 return titles.map((title,i)=>({...pkg,_id:'offer-'+i,title,baseRate:100+i,specialtyTours:'tour-'+i,includedAmenities:'amenities-'+i}));
}
function issuer(list) {
 // Only inert SDK/rate boundaries change: issue and verify actual signed quotes.
 quote.wixData={query(name){let id;const q={eq(k,v){assert.equal(k,'_id');id=v;return q;},limit(){return q;},async find(){assert.equal(name,'Packages');return {items:list.filter(p=>p._id===id)};}};return q;}};
 quote.resolvePerPersonStay=async(ci,co,rate)=>({totalPerPerson:rate*6,averageNightlyRate:rate});
 return (id,ci,co)=>quote.createLockedPricingQuote(id,ci,co);
}
async function ordered(list, expected, invalid=[]) {
 const issue=issuer(list), made=new Map();
 const s=await search({getPackagesByNights:async()=>list,createPricingQuote:async(id,ci,co)=>{
  if(invalid.includes(id))throw Error('inert quote rejection');
  const result=await issue(id,ci,co);made.set(id,result);return result;
 }});
 await s.run();const rep=s.w('#packageRepeater');
 assert.deepEqual(Array.from(rep.data,p=>p._id),expected,'visible packages must be stable non-Scuba then Scuba');
 assert.deepEqual(Array.from(vm.runInContext('_availablePackages',s.c),p=>p._id),expected);
 for(const p of rep.data){
  const source=list.find(x=>x._id===p._id), q=made.get(p._id), item=elements();rep.itemReady(item.w,p);
  assert.equal(p.title,source.title);assert.equal(p.specialtyTours,source.specialtyTours);assert.equal(p.includedAmenities,source.includedAmenities);
  assert.equal(p.pricingQuoteToken,q.token);assert.equal(p.stayTotalPerPerson,q.pricing.totalPerPerson);assert.equal(p.averageNightlyRate,q.pricing.averageNightlyRate);
  assert.equal(item.w('#packageName2').text,source.title||'');
  assert.equal(item.w('#packagePrice').text,'$'+q.pricing.totalPerPerson.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
 }
 if(expected.length){assert.equal(vm.runInContext('_selectedPackage._id',s.c),expected[0]);assert.equal(s.w('#packageName2').text,list.find(p=>p._id===expected[0]).title||'');}
 else {assert.equal(vm.runInContext('_selectedPackage',s.c),null);await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.equal(s.stored.size,0);}
 return {s,made};
}
(async()=>{
 await test('interleaved resolved titles are stably partitioned before default and rendering',async()=>{
  await ordered(packages(['Scuba escape','Explorer','Night SCUBA adventure','Relax','preScUbApost','Family']),['offer-1','offer-3','offer-5','offer-0','offer-2','offer-4']);
 });
 for(const [name,titles,expected] of [
  ['all Scuba',['SCUBA','Scuba escape','preScUbApost'],['offer-0','offer-1','offer-2']],
  ['none Scuba',['Zulu','Alpha','Scu ba',''],['offer-0','offer-1','offer-2','offer-3']],
  ['one Scuba',['scuba'],['offer-0']],['one ordinary',['Explorer'],['offer-0']],
  ['empty list',[],[]]
 ]) await test(name+' retains original within-group order',()=>ordered(packages(titles),expected));
 await test('invalid quoted offers are excluded before ordering and default selection',()=>ordered(packages(['Explorer rejected','Scuba good','Relax good','SCUBA rejected','Family good']),['offer-2','offer-4','offer-1'],['offer-0','offer-3']));
 await test('no valid quotes cannot select or hand off a package',()=>ordered(packages(['Scuba','Explorer']),[],['offer-0','offer-1']));
 await test('manual bottom Scuba click preserves ID title amount and signed handoff',async()=>{
  const list=packages(['Scuba escape','Explorer','SCUBA night']),{s,made}=await ordered(list,['offer-1','offer-0','offer-2']);
  s.select();const rep=s.w('#packageRepeater'),item=elements();rep.itemReady(item.w,rep.data[2]);item.w('#packageContainer').click();
  assert.equal(vm.runInContext('_selectedPackage._id',s.c),'offer-2');assert.equal(s.w('#packageName').text,'SCUBA night');
  assert.equal(s.w('#finalTotal').text,'$2,448.00');
  await s.w('#btnSummary').click();assert.equal(s.nav.length,1);
  const q=new URL(s.nav[0],'https://inert.invalid').searchParams;
  assert.equal(q.get('pkg'),'offer-2');assert.equal(q.get('quote'),made.get('offer-2').token);
  assert.equal(s.stored.get('_wbe_pkg'),'offer-2');assert.equal(s.stored.get('_wbe_quote'),made.get('offer-2').token);
  assert.equal(q.get('rc'),'adventure_suite:2:2:0');assert.equal(q.get('ci'),'2027-04-11');assert.equal(q.get('co'),'2027-04-17');
  const verified=await quote.verifyLockedPricingQuote(q.get('quote'),{packageId:'offer-2',checkIn:q.get('ci'),checkOut:q.get('co')});
  assert.equal(verified.totalPerPerson,612);assert.equal(verified.packageTitle,'SCUBA night');
 });
 for(const phase of ['lookup','quote']) await test('late '+phase+' cannot replace newer ordered packages',async()=>{
  const list=packages(['Scuba','Explorer','SCUBA night']),issue=issuer(list);let release,entered=0;
  const gate=new Promise(r=>release=r),calls=[];
  const s=await search({getPackagesByNights:()=>{if(phase==='lookup'&&++entered===1)return gate;return Promise.resolve(list);},createPricingQuote:async(id,ci,co)=>{
   calls.push([id,ci]);const made=await issue(id,ci,co);if(phase==='quote'&&ci==='2027-04-11'){entered++;await gate;}return made;
  }});
  try {
   await s.run();assert.equal(entered,phase==='lookup'?1:3);
   s.w('#datePickerCheckIn').value=day(12);s.w('#datePickerCheckOut').value=day(18);await s.run();
   const before=JSON.stringify(s.w('#packageRepeater').data),selected=vm.runInContext('_selectedPackage',s.c);
   assert.deepEqual(Array.from(s.w('#packageRepeater').data,p=>p._id),['offer-1','offer-0','offer-2']);
   release(list);await flush();assert.equal(JSON.stringify(s.w('#packageRepeater').data),before);assert.equal(vm.runInContext('_selectedPackage',s.c),selected);
   if(phase==='lookup')assert.ok(calls.every(c=>c[1]==='2027-04-12'));
   assert.equal(s.nav.length,0);assert.equal(s.stored.size,0);
  } finally {release(list);await flush();}
 });
 console.log(JSON.stringify({timezone:process.env.TZ,resolvedTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone,offset:new Date(2027,3,11,12).getTimezoneOffset(),cases},null,2));
 assert.equal(cases.length,11);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+prefix+tests+'})', {filename:__filename})(require,__dirname);
