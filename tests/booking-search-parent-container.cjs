// Actual Search callbacks; inert SDK. Published topology is independently pinned below.
// Provenance: booking-search-missing-summary-live/component-evidence.json:
// comp-mv2qt78p = selectionbox; children comp-mv2qu1xl / comp-mv2rtkq2 / comp-mv2s1laj.
const fs = require('fs'), path = require('path'), vm = require('vm');
const legacy = fs.readFileSync(path.join(__dirname, 'legacy-date-handoff.cjs'), 'utf8');
const totals = fs.readFileSync(path.join(__dirname, 'booking-search-selection-totals.cjs'), 'utf8');
const start = totals.indexOf('const tests = String.raw`') + 'const tests = String.raw`'.length;
const end = totals.indexOf('(async()=>{', start);
if (start < 24 || end < start) throw Error('Missing selection fixture seam');
const support = totals.slice(start, end).replace('function elements() {', 'function inertElements() {');
const tests = String.raw`
// Fixed inventory: never derive IDs from production source or create unknown selectors.
// Only the documented summary topology below models published ancestry; remaining
// controls are explicit inert page/repeater prerequisites, not a full Wix DOM claim.
const inventory = ('selection vacationDates nightsDominica roomsSelected selectedRoomsContainer yourSelection selectedRooms totalGuests priceSummary packageText subTotalBooking penthouseText penthouseFee totalText finalTotal selectionbox line102 line103 line104 line106 packageTitle packageName3 packageAmenities bookingHelp btnSummary ' +
 'section1 page1 accommodationText bookingSummaryContainer box3 btnSearchRooms datePickerCheckIn datePickerCheckOut hotelRoomPhotos jpegBackground messagesContainer nightsText numTotalGuests packageContainer packageName packageName2 packagePrice packageRepeater searchResultsRepeater selectionPanel specialtyTours statusText transSummary ' +
 'additionalFeeText box7 defaultOccupancy description numRooms numberOfGuests occupancy occupancyText penthouseFeeText radioPackage roomAvailability roomFeeText roomName roomPrice roomQtyDropdown roomThumb roomType roomname2 selectedBadge vectorImage2').split(' ');
const children = ['yourSelection','selectedRooms','totalGuests'];
function elements() {
 const ui = inertElements();
 // Predeclare all allowed elements. Subsequent selection cannot manufacture one.
 for (const id of inventory) ui.w('#'+id);
 const lookup = id => { if (!ui.all.has(id)) throw Error('Unknown element: '+id); return ui.all.get(id); };
 lookup.onReady = ui.w.onReady;
 for (const id of ['page1','section1']) { lookup('#'+id).hidden=false; lookup('#'+id).collapsed=false; }
 lookup('#section1').parent=lookup('#page1');
 for (const id of ['selectionbox',...children,'selectedRoomsContainer','bookingHelp','accommodationText']) {
  const el=lookup('#'+id);el.parent=lookup(children.includes(id)?'#selectionbox':'#section1');
  el.hidden=id==='bookingHelp';el.collapsed=id!=='bookingHelp';
 }
 return {...ui,w:lookup};
}
function visible(el) { for(let node=el;node;node=node.parent) if(node.hidden||node.collapsed)return false;return true; }
function assertChildren(s,expected) { for(const id of children)assert.equal(visible(s.w('#'+id)),expected,id+' effective ancestor visibility'); }
(async()=>{
 await test('published lowercase parent makes selected child text effectively visible',async()=>{
  const s=await setup();assert.throws(()=>s.w('#selectionBox'),/Unknown element/);
  assert.throws(()=>s.w('#inventedControl'),/Unknown element/);
  assertChildren(s,false);qty(s,1);
  assert.equal(s.w('#selectedRooms').text,'1 rooms');assert.equal(s.w('#totalGuests').text,'2 guests total');
  for(const id of children){assert.equal(s.w('#'+id).hidden,false);assert.equal(s.w('#'+id).collapsed,false);}
  // These own flags already passed with the typo; only ancestor-aware visibility exposes it.
  assertChildren(s,true);assert.equal(s.w('#selectionbox').collapsed,false);
  assert.equal(visible(s.w('#bookingHelp')),true);
  assert.equal(s.w('#selectedRoomsContainer').parent,s.w('#section1'));
  // Search already reveals accommodationText as a result header; it is not
  // an unrelated-hidden sentinel. Preserve the actual hidden gallery/row price.
  assert.equal(s.w('#hotelRoomPhotos').collapsed,true);
  assert.equal(room(s).w('#roomPrice').hidden,true);
 });
 await test('visible children cannot paint through collapsed or hidden actual parent',async()=>{
  const s=await setup();qty(s,1);const parent=s.w('#selectionbox');
  for(const id of children){s.w('#'+id).show();s.w('#'+id).expand();}
  parent.show();parent.collapse();assertChildren(s,false);
  parent.expand();assertChildren(s,true);parent.hide();assertChildren(s,false);
  parent.show();assertChildren(s,true);
 });
 await test('last deselection and date invalidation collapse actual parent and help',async()=>{
  const s=await setup();qty(s,2);assertChildren(s,true);qty(s,0);assertChildren(s,false);
  for(const id of ['selectionbox','bookingHelp',...children]){assert.equal(s.w('#'+id).hidden,true);assert.equal(s.w('#'+id).collapsed,true);}
  qty(s,1);assertChildren(s,true);change(s.w('#datePickerCheckOut'),null);assertChildren(s,false);
  assert.equal(s.w('#selectionbox').collapsed,true);assert.equal(visible(s.w('#bookingHelp')),false);
  await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
 });
 console.log(JSON.stringify({timezone:process.env.TZ,cases},null,2));assert.equal(cases.length,3);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+legacy.slice(0,legacy.indexOf('(async()=>{'))+support+tests+'})',{filename:__filename})(require,__dirname);
