// Actual Search callbacks + actual night-only reader and quote HMAC, all IO inert.
const fs=require('fs'),path=require('path'),vm=require('vm');
const original=fs.readFileSync(path.join(__dirname,'legacy-date-handoff.cjs'),'utf8');
const marker=original.indexOf('(async()=>{');
const radio=fs.readFileSync(path.join(__dirname,'legacy-search-package-radio.cjs'),'utf8');
const mountSource=radio.slice(radio.indexOf('function mount('),radio.indexOf('async function setup('));
if(marker<0||!mountSource)throw Error('Missing harness seam');
const tests=`
${mountSource}
const list=[
 {...pkg,_id:'scuba',numberOfNights:7,baseRate:2702.97,title:'8-day Scuba Multi-Sport',includedAmenities:'Diving included'},
 {...pkg,_id:'explorer',numberOfNights:7,baseRate:2527.78,title:'8-day Explorer',includedAmenities:'Explore without diving'}
];
async function setup(nightList=list){
 const timers=[], gates=[];
 quote.wixData={query(){let id;const q={eq(k,v){id=v;return q;},limit(){return q;},async find(){return {items:list.filter(p=>p._id===id)};}};return q;}};
 quote.resolvePerPersonStay=async(ci,co,rate)=>({totalPerPerson:rate,averageNightlyRate:rate/7});
 const packages=vm.createContext({Permissions:{Anyone:0},webMethod:(p,f)=>f,wixData:{query(){const q={limit(){return q;},async find(){return {items:nightList};}};return q;}}});
 vm.runInContext(clean('backend/packages.web.js')+';globalThis.readAmenities=getPackageAmenities;',packages);
 const s=await search({setTimeout:f=>{timers.push(f);return timers.length;},getPackagesByNights:async()=>list,
  getPackageAmenities:n=>new Promise(resolve=>gates.push(async()=>resolve(await packages.readAmenities(n)))),
  searchAvailability:async(ci,co)=>({ok:true,requestedNights:7,results:[{...row(),availableNights:7,availableCheckIn:ci.toISOString(),availableCheckOut:co.toISOString()}]})});
 s.w('#datePickerCheckIn').value=new Date(2026,10,7,12);s.w('#datePickerCheckOut').value=new Date(2026,10,14,12);
 const m=mount(s);await s.run();
 return {s,m,timers,gates,release:async()=>{for(const release of gates.splice(0))await release();await flush();},tick:()=>{for(const f of timers.splice(0))f();}};
}
function identity(s,m,id,qty=1){
 const p=list.find(p=>p._id===id);
 assert.equal(vm.runInContext('_selectedPackage._id',s.c),id);
 for(const [key,r] of m.rows)assert.equal(r.radio.selectedIndex,key===id?0:undefined);
 assert.equal(s.w('#packageName').text,p.title);
 assert.equal(s.w('#packageAmenities').text,p.includedAmenities);
 assert.equal(s.w('#packageName').collapsed,false);assert.equal(s.w('#packageAmenities').collapsed,false);
 assert.equal(m.rows.get(id).item.w('#packagePrice').text,'$'+p.baseRate.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
 assert.equal(s.w('#numTotalGuests').text,String(qty*2));
 assert.equal(s.w('#finalTotal').text,'$'+(p.baseRate*qty*2).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
}
async function handoff(s,id,qty=1){
 await s.w('#btnSummary').click();assert.equal(s.nav.length,1);
 const q=new URL(s.nav[0],'https://inert.invalid').searchParams;
 assert.equal(q.get('pkg'),id);assert.equal(q.get('ci'),'2026-11-07');assert.equal(q.get('co'),'2026-11-14');assert.equal(q.get('rc'),'adventure_suite:'+qty+':2:0');
 assert.equal(q.get('quote'),vm.runInContext('_selectedPackage.pricingQuoteToken',s.c));assert.equal(s.stored.get('_wbe_pkg'),id);assert.equal(s.stored.get('_wbe_quote'),q.get('quote'));
 const verified=await quote.verifyLockedPricingQuote(q.get('quote'),{packageId:id,checkIn:q.get('ci'),checkOut:q.get('co')});assert.equal(verified.totalPerPerson,list.find(p=>p._id===id).baseRate);
}
(async()=>{
 await test('late night-only Scuba response cannot overwrite default Explorer summary',async()=>{
  const x=await setup();const {s,m}=x;s.select(undefined,'1');x.tick();identity(s,m,'explorer');await x.release();identity(s,m,'explorer');await handoff(s,'explorer');
 });
 await test('default summary is bound before delayed highlight timer runs',async()=>{
  const x=await setup();x.s.select(undefined,'1');identity(x.s,x.m,'explorer');await x.release();x.tick();identity(x.s,x.m,'explorer');
 });
 await test('manual Scuba then Explorer survives late response and actual room quantity changes',async()=>{
  const x=await setup(),{s,m}=x;const room=s.select(undefined,'1');x.tick();m.rows.get('scuba').radio.change();identity(s,m,'scuba');
  room.w('#roomQtyDropdown').value='2';room.w('#roomQtyDropdown').change({target:{value:'2'}});identity(s,m,'scuba',2);
  m.rows.get('explorer').radio.change();await x.release();identity(s,m,'explorer',2);await handoff(s,'explorer',2);
 });
 await test('manual Scuba remains bound through late response, room refresh and signed handoff',async()=>{
  const x=await setup([...list].reverse()),{s,m}=x;x.tick();s.select(undefined,'1');m.rows.get('scuba').radio.change();await x.release();s.select(undefined,'2');identity(s,m,'scuba',2);await handoff(s,'scuba',2);
 });
 await test('obsolete night response and highlight cannot revive invalidated summary',async()=>{
  const x=await setup(),{s,m}=x;s.select(undefined,'1');x.tick();s.w('#datePickerCheckOut').value=new Date(2026,10,15,12);s.w('#datePickerCheckOut').change({target:{value:s.w('#datePickerCheckOut').value}});await x.release();x.tick();assert.equal(vm.runInContext('_selectedPackage',s.c),null);assert.equal(s.w('#packageName').collapsed,true);assert.equal(s.w('#packageAmenities').collapsed,true);await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
 });
 await test('selecting package without amenities clears previous package amenities',async()=>{
  const saved=list[1].includedAmenities;list[1].includedAmenities='';
  try {const x=await setup();x.tick();x.s.select(undefined,'1');x.m.rows.get('scuba').radio.change();assert.equal(x.s.w('#packageAmenities').text,'Diving included');x.m.rows.get('explorer').radio.change();assert.equal(x.s.w('#packageName').text,list[1].title);assert.equal(x.s.w('#packageAmenities').text,'');assert.equal(x.s.w('#packageAmenities').collapsed,true);await x.release();await handoff(x.s,'explorer');}finally{list[1].includedAmenities=saved;}
 });
 console.log(JSON.stringify({cases},null,2));assert.equal(cases.length,6);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+original.slice(0,marker)+tests+'})',{filename:__filename})(require,__dirname);
