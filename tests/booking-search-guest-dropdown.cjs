// Actual Search source and signed quote issuer; inert, case-sensitive Wix controls.
const fs = require('fs'), path = require('path'), vm = require('vm');
const original = fs.readFileSync(path.join(__dirname, 'legacy-date-handoff.cjs'), 'utf8');
const marker = original.indexOf('(async()=>{');
if (marker < 0) throw Error('Missing actual-page fixture seam');
const tests = String.raw`
function elements() {
 const all=new Map(); let ready;
 function w(id) {
  // Unlike the older auto-creating fixture, the mistaken selector cannot exist.
  if(id === '#numberofGuests') throw Error('Unknown element: '+id);
  if(!all.has(id)) {
   const listeners={click:[],change:[],itemReady:[]}, rows=new Map(); let data=[];
   const el={text:'EDITOR',html:'',value:'',options:[],hidden:true,collapsed:true,enabled:true,link:'',listeners,rows,
    show(){this.hidden=false;},hide(){this.hidden=true;},expand(){this.collapsed=false;},collapse(){this.collapsed=true;},
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
 return {w,all,ready:()=>ready()};
}
const rooms=[
 {roomCode:'adventure_suite',roomName:'Adventure Suite',baseOccupancy:2,occupancy:2},
 {roomCode:'penthouse_apartment',roomName:'Penthouse Apartment',baseOccupancy:2,occupancy:2},
 {roomCode:'two_bedroom_apartment',roomName:'Two Bedroom Apartment',baseOccupancy:3,occupancy:4}
];
async function setup(){const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results:rooms.map(r=>({...row(),...r}))})});await s.run();return s;}
function item(s,index){const rep=s.w('#searchResultsRepeater');return rep.rows.get(rep.data[index]._id);}
function change(el,value){el.value=value;el.change({target:{value}});}
(async()=>{
 await test('real #numberOfGuests has options and defaults 2 / 2 / 3 on first render',async()=>{
  const s=await setup();
  for(const [index,expected] of [['2'],['2'],['3','4']].entries()) {
   const guests=item(s,index).w('#numberOfGuests');
   assert.deepEqual(Array.from(guests.options,o=>o.value),expected,rooms[index].roomName+' options');
   assert.equal(guests.value,expected[0],rooms[index].roomName+' default');
   assert.equal(guests.enabled,true);assert.equal(guests.listeners.change.length,1);
   assert.equal(item(s,index).w('#roomQtyDropdown').value,'0','room selection default unchanged');
  }
 });
 await test('fixtures match actual backend configured minimum and maximum occupancy',async()=>{
  const config=vm.createContext({});vm.runInContext(clean('backend/wbeConfig.js'),config);
  for(const r of rooms){
   assert.equal(vm.runInContext('ROOM_MIN_OCCUPANCY['+JSON.stringify(r.roomCode)+']',config),r.baseOccupancy);
   assert.equal(vm.runInContext('ROOM_MAX_OCCUPANCY['+JSON.stringify(r.roomCode)+']',config),r.occupancy);
  }
 });
 await test('four guests survive repeated readiness, quantity changes and summary refresh',async()=>{
  const s=await setup(),r=item(s,2),rep=s.w('#searchResultsRepeater');
  change(r.w('#numberOfGuests'),'4');change(r.w('#roomQtyDropdown'),'1');
  rep.itemReady(r.w,rep.data[2]);vm.runInContext('updateSelectionPanel()',s.c);
  change(r.w('#roomQtyDropdown'),'0');change(r.w('#roomQtyDropdown'),'1');
  assert.equal(r.w('#numberOfGuests').value,'4');assert.equal(r.w('#numberOfGuests').listeners.change.length,1);
  assert.equal(r.w('#roomQtyDropdown').listeners.change.length,1);assert.equal(s.w('#totalGuests').text,'4 guests total');
  assert.equal(s.w('#finalTotal').text,'$9,240.00');
  await s.w('#btnSummary').click();assert.equal(s.nav.length,1);
  assert.equal(new URL(s.nav[0],'https://inert.invalid').searchParams.get('rc'),'two_bedroom_apartment:1:4:0');
 });
 await test('mixed default guests feed totals without revealing unrelated hidden elements',async()=>{
  const s=await setup();for(let i=0;i<rooms.length;i++)change(item(s,i).w('#roomQtyDropdown'),'1');
  assert.equal(s.w('#totalGuests').text,'7 guests total');assert.equal(s.w('#selectedRooms').text,'3 rooms');
  assert.equal(s.w('#finalTotal').text,'$16,170.00');
  for(let i=0;i<rooms.length;i++)assert.equal(item(s,i).w('#roomPrice').hidden,true);
 });
 await test('unavailable defensive rows clear and disable the exact guest control',async()=>{
  const s=await setup(),r=elements(),guests=r.w('#numberOfGuests');guests.options=[{label:'4',value:'4'}];
  s.w('#searchResultsRepeater').itemReady(r.w,{...row(),status:'partial'});
  assert.equal(guests.options.length,0);assert.equal(guests.enabled,false);assert.equal(guests.listeners.change.length,0);
 });
 await test('new search resets defaults and detached guest callbacks stay inactive',async()=>{
  const s=await setup(),old=item(s,2);change(old.w('#numberOfGuests'),'4');change(old.w('#roomQtyDropdown'),'1');
  await s.run();assert.equal(item(s,2).w('#numberOfGuests').value,'3');
  change(old.w('#numberOfGuests'),'4');assert.equal(s.w('#btnSummary').hidden,true);
  change(item(s,2).w('#roomQtyDropdown'),'1');assert.equal(s.w('#totalGuests').text,'3 guests total');
 });
 await test('explicit room defaults survive absent and different CMS base occupancy',async()=>{
  const backend=fs.readFileSync(path.join(root,'backend/search.web.js'),'utf8');
  const normalization=backend.match(/const maxOcc = rm\.maxOccupancy \|\| 2;\s*const baseOcc = rm\.baseOccupancy \|\| maxOcc;/);
  assert.ok(normalization,'actual backend occupancy normalization');
  for(const suppliedBase of [undefined,1,2,3,4]){
   const results=rooms.map(r=>{
    const rm={maxOccupancy:r.occupancy};if(suppliedBase!==undefined)rm.baseOccupancy=suppliedBase;
    const normalized=new Function('rm',normalization[0]+'return {occupancy:maxOcc,baseOccupancy:baseOcc};')(rm);
    return {...row(),...r,...normalized};
   });
   const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results})});await s.run();
   for(const [i,expected] of ['2','2','3'].entries()){
    const dd=item(s,i).w('#numberOfGuests');
    assert.equal(dd.value,expected,rooms[i].roomCode+' CMS base '+suppliedBase);
    const min=Math.min(suppliedBase||rooms[i].occupancy,Number(expected));
    assert.deepEqual(Array.from(dd.options,o=>o.value),Array.from({length:rooms[i].occupancy-min+1},(_,n)=>String(min+n)));
   }
  }
 });
 await test('room default never exceeds returned maximum and invalid active guests block handoff',async()=>{
  for(const max of [1,2,3,4,0]){
   const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results:[{...row(),...rooms[2],baseOccupancy:4,occupancy:max}]})});await s.run();
   const r=item(s,0),dd=r.w('#numberOfGuests');
   assert.equal(dd.value,max>0?String(Math.min(3,max)):'','maximum '+max);
   assert.ok(dd.options.every(o=>Number(o.value)>0&&Number(o.value)<=max));
   change(r.w('#roomQtyDropdown'),'1');change(dd,String(max+1));
   assert.equal(s.w('#btnSummary').enabled,false);await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
  }
 });
 await test('compatible CMS options and four guest choice survive reread and reach Summary',async()=>{
  for(const baseOccupancy of [2,4]){
   const s=await search({searchAvailability:async()=>({ok:true,requestedNights:6,results:[{...row(),...rooms[2],baseOccupancy}]})});await s.run();
   const r=item(s,0),rep=s.w('#searchResultsRepeater'),dd=r.w('#numberOfGuests');
   assert.deepEqual(Array.from(dd.options,o=>o.value),baseOccupancy===2?['2','3','4']:['3','4']);
   for(const value of baseOccupancy===2?['2','4']:['4']){
    change(dd,value);change(r.w('#roomQtyDropdown'),'1');rep.itemReady(r.w,rep.data[0]);vm.runInContext('updateSelectionPanel()',s.c);
    assert.equal(dd.value,value);assert.equal(s.w('#totalGuests').text,value+' guests total');
   }
   await s.w('#btnSummary').click();assert.equal(s.nav.length,1);
   assert.equal(new URL(s.nav[0],'https://inert.invalid').searchParams.get('rc'),'two_bedroom_apartment:1:4:0');
  }
 });
 console.log(JSON.stringify({cases},null,2));assert.equal(cases.length,9);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+original.slice(0,marker)+tests+'})',{filename:__filename})(require,__dirname);
