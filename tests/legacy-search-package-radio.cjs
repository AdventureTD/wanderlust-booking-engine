// Actual Search source; inert Wix rows retain IDs and registrations are additive.
const fs=require('fs'),path=require('path'),vm=require('vm');
const original=fs.readFileSync(path.join(__dirname,'legacy-date-handoff.cjs'),'utf8');
const marker=original.indexOf('(async()=>{');
if(marker<0)throw Error('Missing harness entry');
const tests=`
function mount(s, missing=false) {
 const rep=s.w('#packageRepeater'), ready=[], rows=new Map();let data=[];
 rep.onItemReady=f=>{ready.push(f);rep.itemReady=f;};
 function make(p){
  const item=elements(), registrations=new Map(), lookups=[];
  const scope=id=>{lookups.push(id);if(id==='#vectorImage1'||(missing&&id==='#radioPackage'))throw Error('Deleted element');return item.w(id);};
  for(const id of ['#packageContainer','#packageName2','#nightsText','#specialtyTours','#packagePrice','#radioPackage']){
   const el=item.w(id), clicks=[],changes=[];registrations.set(id,{clicks,changes});
   el.onClick=f=>clicks.push(f);el.onChange=f=>changes.push(f);
   el.click=()=>clicks.forEach(f=>f());el.change=()=>changes.forEach(f=>f());
  }
  const radio=item.w('#radioPackage');radio.options=[{label:'Owner label',value:'owner-value'}];radio.selectedIndex=0;
  return {scope,item,p,radio,registrations,lookups};
 }
 Object.defineProperty(rep,'data',{get:()=>data,set:next=>{
  data=next;for(const id of rows.keys())if(!next.some(p=>p._id===id))rows.delete(id);
  for(const p of next){if(rows.has(p._id)){rows.get(p._id).p=p;continue;}const r=make(p);rows.set(p._id,r);ready.forEach(f=>f(r.scope,p));}
 }});
 rep.forEachItem=f=>rows.forEach(r=>f(r.scope,r.p));
 return {rep,rows,ready,make};
}
async function setup(missing=false){
 const list=[{...pkg,_id:'scuba',title:'Scuba',includedAmenities:'Dive'}, {...pkg,_id:'first',title:'Same',includedAmenities:'First'}, {...pkg,_id:'other',title:'Same',includedAmenities:'Other'}];
 quote.wixData={query(){let id;const q={eq(k,v){id=v;return q;},limit(){return q;},async find(){return {items:list.filter(p=>p._id===id)};}};return q;}};
 quote.resolvePerPersonStay=async(ci,co,rate)=>({totalPerPerson:rate*6,averageNightlyRate:rate});
 const s=await search({getPackagesByNights:async()=>list});const m=mount(s,missing);await s.run();return {s,m};
}
function selected(s){return vm.runInContext('_selectedPackage._id',s.c);}
function visuals(m,id){for(const [key,r] of m.rows){assert.equal(r.radio.selectedIndex,key===id?0:undefined,key);assert.deepEqual(r.radio.options,[{label:'Owner label',value:'owner-value'}]);assert.ok(!r.lookups.includes('#vectorImage1'));}}
(async()=>{
 await test('first visible quoted non-Scuba row is selected immediately; other radios clear',async()=>{
  const {s,m}=await setup();assert.deepEqual(Array.from(m.rep.data,p=>p._id),['first','other','scuba']);assert.equal(selected(s),'first');visuals(m,'first');
  const late=m.make(m.rep.data[0]);m.rep.itemReady(late.scope,late.p);assert.equal(late.radio.selectedIndex,0);
 });
 await test('radio change selects actual package, amenities, price and signed Summary handoff',async()=>{
  const {s,m}=await setup();s.select();const r=m.rows.get('other');r.radio.change();assert.equal(selected(s),'other');visuals(m,'other');assert.equal(s.w('#packageAmenities').text,'Other');assert.equal(s.w('#finalTotal').text,'$9,504.00');
  assert.equal(r.registrations.get('#radioPackage').changes.length,1);m.rows.get('scuba').item.w('#packageContainer').click();assert.equal(selected(s),'scuba');visuals(m,'scuba');r.radio.change();
  await s.w('#btnSummary').click();const q=new URL(s.nav[0],'https://inert.invalid').searchParams;assert.equal(q.get('pkg'),'other');assert.equal(q.get('quote'),vm.runInContext('_selectedPackage.pricingQuoteToken',s.c));await quote.verifyLockedPricingQuote(q.get('quote'),{packageId:'other',checkIn:q.get('ci'),checkOut:q.get('co')});
 });
 await test('retained rows refresh without duplicate handlers and remain selectable',async()=>{
  const {s,m}=await setup();const r=m.rows.get('other'),fn=r.registrations.get('#radioPackage').changes[0];r.radio.change();
  vm.runInContext('loadPackageOptions(6, _activeSearch)',s.c);await flush();assert.equal(m.rows.get('other'),r);visuals(m,'first');assert.equal(m.ready.length,1);assert.equal(r.registrations.get('#radioPackage').changes.length,1);assert.equal(r.registrations.get('#packageContainer').clicks.length,1);fn();assert.equal(selected(s),'other');visuals(m,'other');
 });
 await test('removed same-ID radio and late readiness cannot act on replacement',async()=>{
  const {s,m}=await setup();const old=m.rows.get('other'),ready=m.rep.itemReady;
  await s.run();ready(old.scope,old.p);old.radio.change();assert.equal(selected(s),'first');visuals(m,'first');m.rows.get('other').radio.change();assert.equal(selected(s),'other');visuals(m,'other');
 });
 await test('missing radio safely preserves existing row selection',async()=>{const {s,m}=await setup(true);m.rows.get('other').item.w('#packageContainer').click();assert.equal(selected(s),'other');assert.equal(s.w('#packageAmenities').text,'Other');});
 console.log(JSON.stringify({cases},null,2));assert.equal(cases.length,5);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+original.slice(0,marker)+tests+'})',{filename:__filename})(require,__dirname);
