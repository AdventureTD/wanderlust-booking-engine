// Actual Search click handler; emulate Wix dispatch for every assigned row.
const fs = require('fs'), path = require('path'), vm = require('vm');
const original = fs.readFileSync(path.join(__dirname, 'legacy-date-handoff.cjs'), 'utf8');
const prefix = original.slice(0, original.indexOf('(async()=>{'));
const tests = `
function observeRows(s) {
 const rep=s.w('#searchResultsRepeater'), assignments=[], ready=[], cards=[];
 let data=rep.data;
 Object.defineProperty(rep,'data',{get:()=>data,set:rows=>{
  data=rows;assignments.push(Array.from(rows));cards.length=0;
  for(const r of rows){ready.push(r);const item=elements();rep.itemReady(item.w,r);cards.push(item);}
 }});
 return {assignments,ready,cards};
}
const dec=(code,status,ci,co,maxQty=1)=>({...row(),roomCode:code,roomName:code,status,maxQty,availableNights:co-ci,availableCheckIn:'2026-12-'+ci+'T00:00:00.000Z',availableCheckOut:'2026-12-'+co+'T00:00:00.000Z'});
(async()=>{
 await test('Dec9-Dec16 Adventure displayed; WC1011 Penthouse partial never mounted or tracked',async()=>{
  // Penthouse occupied Dec3-Dec12; only Dec12-Dec16 is returned as an alternative.
  const views=[], full=dec('adventure_suite','full',9,16,2), partial=dec('penthouse','partial',12,16);
  // Pad the single-digit civil day in the fixture, not in production.
  full.availableCheckIn='2026-12-09T00:00:00.000Z';
  const s=await search({searchAvailability:async()=>({ok:true,requestedNights:7,results:[partial,full]}),trackRoomView:x=>views.push(x.roomCode)});
  const seen=observeRows(s);s.w('#datePickerCheckIn').value=new Date(2026,11,9,12);s.w('#datePickerCheckOut').value=new Date(2026,11,16,12);
  const oldNights=pkg.numberOfNights;try{pkg.numberOfNights=7;await s.run();}finally{pkg.numberOfNights=oldNights;}
  assert.deepEqual(Array.from(s.w('#searchResultsRepeater').data,r=>r.roomCode),['adventure_suite']);
  assert.deepEqual(seen.ready.map(r=>r.roomCode),['adventure_suite']);assert.equal(seen.cards.length,1);
  assert.equal(seen.cards[0].w('#roomQtyDropdown').enabled,true);assert.deepEqual(views,['adventure_suite']);
  assert.match(s.w('#statusText').html,/Found 1 result for 7 nights/);
 });
 const invalid=[['partial',{...row(12,17),status:'partial'}],['unavailable',{...row(),status:'unavailable'}],['zero quantity',{...row(),maxQty:0}],['negative quantity',{...row(),maxQty:-1}],['missing quantity',{...row(),maxQty:undefined}],['mismatched checkin',row(12,17)],['mismatched checkout',row(11,18)],['missing date',{...row(),availableCheckOut:null}]];
 for(const [name,bad] of invalid) await test(name+' replacement clears all prior cards without dispatching invalid rows',async()=>{
  let n=0,alternates=0;const views=[];
  const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results:++n===1?[row()]:[bad]}),trackRoomView:x=>views.push(x.roomCode),suggestAlternateDates:async()=>{alternates++;return {suggestions:[]};}});
  const seen=observeRows(s);await s.run();assert.equal(seen.cards.length,1);const old=s.select();
  seen.ready.length=0;views.length=0;seen.assignments.length=0;await s.run();
  assert.equal(s.w('#searchResultsRepeater').data.length,0);assert.equal(seen.cards.length,0);assert.equal(seen.ready.length,0);
  assert.ok(seen.assignments.every(rows=>rows.length===0));assert.deepEqual(views,[]);assert.equal(alternates,1);
  old.w('#roomQtyDropdown').change({target:{value:'2'}});assert.equal(vm.runInContext('_selections.length',s.c),0);
  assert.equal(s.w('#packageRepeater').data.length,0);assert.equal(s.w('#btnSummary').hidden,true);
  await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.equal(s.stored.size,0);
 });
 await test('all exact positive rows retain order, quantity controls and room views',async()=>{
  const views=[], results=[{...row(),maxQty:1},{...row(),roomCode:'penthouse',maxQty:2}];
  const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results}),trackRoomView:x=>views.push(x.roomCode)});const seen=observeRows(s);await s.run();
  assert.deepEqual(Array.from(s.w('#searchResultsRepeater').data,r=>r.roomCode),['adventure_suite','penthouse']);
  assert.deepEqual(seen.ready.map(r=>r.roomCode),views);assert.equal(seen.cards.length,2);
  assert.deepEqual(seen.cards.map(c=>c.w('#roomQtyDropdown').options.length),[2,3]);
  assert.ok(seen.cards.every(c=>c.w('#roomQtyDropdown').enabled));
 });
 console.log(JSON.stringify({timezone:process.env.TZ,resolvedTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone,cases},null,2));
 assert.equal(cases.length,10);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+prefix+tests+'})', {filename:__filename})(require,__dirname);
