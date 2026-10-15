// Actual Search callbacks using the existing additive-event selection fixture.
const fs=require('fs'),path=require('path'),vm=require('vm');
const original=fs.readFileSync(path.join(__dirname,'legacy-date-handoff.cjs'),'utf8');
const focused=fs.readFileSync(path.join(__dirname,'booking-search-selection-totals.cjs'),'utf8');
const helpers=focused.slice(focused.indexOf('const selectionIds'),focused.indexOf('(async()=>{',focused.indexOf('const selectionIds')));
const tests=String.raw`
function visible(s,id,expected){assert.equal(s.w('#'+id).hidden,!expected,id+' hidden');assert.equal(s.w('#'+id).collapsed,!expected,id+' collapsed');}
(async()=>{
 await test('line104 follows initial collapsed room selection and deselection',async()=>{
  const s=await search();visible(s,'line104',false);await s.run();visible(s,'line104',false);
  qty(s,1);visible(s,'line104',true);qty(s,2);visible(s,'line104',true);qty(s,0);visible(s,'line104',false);
 });
 await test('packageName3 mirrors selected scoped title through package switches',async()=>{
  const other={...pkg,_id:'other-package',title:'Other Explorer'};
  const s=await setup({getPackagesByNights:async()=>[pkg,other],createPricingQuote:async(id,ci,co)=>({quote:{packageId:id,checkIn:ci,checkOut:co,nights:6},pricing:{totalPerPerson:2310},token:'INERT-'+id})});
  const rep=s.w('#packageRepeater'),first=rep.rows.get(pkg._id),second=rep.rows.get(other._id);
  qty(s,1);assert.equal(s.w('#packageName3').text,first.w('#packageName2').text);visible(s,'packageName3',true);
  await second.w('#packageName2').click();assert.equal(s.w('#packageName3').text,second.w('#packageName2').text);
  await first.w('#radioPackage').change();assert.equal(s.w('#packageName3').text,first.w('#packageName2').text);
  qty(s,0);visible(s,'packageName3',false);
 });
 await test('new summary controls start hidden and blank without package or room selection',async()=>{
  const s=await search();visible(s,'line104',false);visible(s,'packageName3',false);assert.equal(s.w('#packageName3').text,'');
  await s.run();visible(s,'line104',false);visible(s,'packageName3',false);assert.equal(s.w('#packageName3').text,pkg.title);
 });
 await test('multiple room types retain summary until the last room is deselected',async()=>{
  const s=await setup({searchAvailability:async()=>({ok:true,requestedNights:6,results:[row(),{...row(),roomCode:'two_bedroom',occupancy:6}]})});
  qty(s,2);qty(s,1,1);qty(s,0);visible(s,'line104',true);visible(s,'packageName3',true);assert.equal(s.w('#packageName3').text,pkg.title);
  qty(s,0,1);visible(s,'line104',false);visible(s,'packageName3',false);
 });
 await test('clearing dates blanks packageName3 and detached package clicks cannot restore it',async()=>{
  const s=await setup(),rep=s.w('#packageRepeater'),old=rep.rows.get(pkg._id);qty(s,1);
  change(s.w('#datePickerCheckOut'),null);await old.w('#packageName2').click();
  assert.equal(s.w('#packageName3').text,'');visible(s,'line104',false);visible(s,'packageName3',false);
  change(s.w('#datePickerCheckOut'),day(17));await s.run();qty(s,1);await old.w('#packageName2').click();
  assert.equal(s.w('#packageName3').text,rep.rows.get(pkg._id).w('#packageName2').text);visible(s,'packageName3',true);
 });
 await test('failed replacement quote clears external package identity with rooms selected',async()=>{
  let fail=false;const s=await setup({createPricingQuote:async(id,ci,co)=>{if(fail)throw Error('inert');return quote.createLockedPricingQuote(id,ci,co);}});
  qty(s,1);assert.equal(s.w('#packageName3').text,pkg.title);fail=true;await s.run();qty(s,1);
  assert.equal(s.w('#packageName3').text,'');visible(s,'packageName3',true);assert.equal(s.w('#btnSummary').enabled,false);
 });
 for(const boundary of ['getPackagesByNights','createPricingQuote'])await test('late '+boundary+' cannot restore new summary identity',async()=>{
  let release;const gate=new Promise(r=>release=r),s=await search({[boundary]:()=>gate});await s.run();change(s.w('#datePickerCheckOut'),null);
  release(boundary==='getPackagesByNights'?[pkg]:await quote.createLockedPricingQuote(pkg._id,'2027-04-11','2027-04-17'));await flush();
  assert.equal(s.w('#packageName3').text,'');visible(s,'packageName3',false);visible(s,'line104',false);
 });
 await test('late highlight uses current selected title and cannot reopen cleared summary',async()=>{
  const timers=[],other={...pkg,_id:'other-package',title:'Alternate Explorer'};
  const s=await setup({setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length;},getPackagesByNights:async()=>[pkg,other],createPricingQuote:async(id,ci,co)=>({quote:{packageId:id,checkIn:ci,checkOut:co,nights:6},pricing:{totalPerPerson:2310},token:'INERT-'+id})});
  const rep=s.w('#packageRepeater');qty(s,1);await rep.rows.get(other._id).w('#box7').click();
  const highlights=timers.filter(x=>x.ms===100);assert.ok(highlights.length);highlights.forEach(x=>x.f());assert.equal(s.w('#packageName3').text,other.title);
  qty(s,0);highlights.forEach(x=>x.f());visible(s,'packageName3',false);visible(s,'line104',false);
  change(s.w('#datePickerCheckOut'),null);highlights.forEach(x=>x.f());assert.equal(s.w('#packageName3').text,'');visible(s,'packageName3',false);
 });
 console.log(JSON.stringify({cases},null,2));assert.equal(cases.length,9);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+original.slice(0,original.indexOf('(async()=>{'))+helpers+tests+'})',{filename:__filename})(require,__dirname);
