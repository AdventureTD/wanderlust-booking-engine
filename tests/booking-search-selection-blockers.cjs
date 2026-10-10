const fs=require('fs'),path=require('path'),vm=require('vm');
const repo=path.resolve(__dirname,'..');
const original=fs.readFileSync(repo+'/tests/legacy-date-handoff.cjs','utf8');
const focused=fs.readFileSync(repo+'/tests/booking-search-selection-totals.cjs','utf8');
const helpers=focused.slice(focused.indexOf('const selectionIds'),focused.indexOf('(async()=>{',focused.indexOf('const selectionIds')));
const tests=String.raw`
(async()=>{
 await test('independent mixed three room types exact totals and options',async()=>{
 const s=await setup({searchAvailability:async()=>({ok:true,requestedNights:6,results:[row(),{...row(),roomCode:'two_bedroom',occupancy:6},{...row(),roomCode:'penthouse_apartment',roomFee:75}]})});
 qty(s,1);qty(s,1,1);qty(s,1,2);assert.equal(s.w('#selectedRooms').text,'3 rooms');assert.equal(s.w('#totalGuests').text,'6 guests total');
 change(room(s,1).w('#numberofGuests'),'5');assert.equal(s.w('#totalGuests').text,'9 guests total');qty(s,0,1);assert.equal(s.w('#totalGuests').text,'4 guests total');
 await s.w('#btnSummary').click();assert.equal(s.nav.length,1);const q=new URL(s.nav[0],'https://inert.invalid').searchParams;await quote.verifyLockedPricingQuote(q.get('quote'),{packageId:pkg._id,checkIn:q.get('ci'),checkOut:q.get('co')});
 });
 await test('independent retained data identity preserves one live handler',async()=>{
 const s=await setup(),rep=s.w('#searchResultsRepeater'),r=room(s),handler=r.w('#roomQtyDropdown').listeners.change[0];qty(s,1);rep.data=rep.data.map(x=>({...x}));qty(s,2);assert.equal(s.w('#selectedRooms').text,'2 rooms');assert.equal(r.w('#roomQtyDropdown').listeners.change.length,1);assert.equal(r.w('#roomQtyDropdown').listeners.change[0],handler);
 });
 await test('independent optional missing selectors do not block essential controls',async()=>{
 const s=await setup(),real=s.c.$w;s.c.$w=id=>{if(['#line102','#packageTitle','#packageAmenities'].includes(id))throw Error('missing optional');return real(id);};qty(s,2);assert.equal(s.w('#selectedRooms').text,'2 rooms');assert.equal(s.w('#btnSummary').enabled,true);qty(s,0);assert.equal(s.w('#btnSummary').collapsed,true);
 });
 await test('independent readonly flags use methods not flag setters',async()=>{
 const s=await setup(),el=s.w('#btnSummary');let enabled=el.enabled;Object.defineProperty(el,'enabled',{get:()=>enabled,set(){throw Error('readonly');}});el.enable=()=>enabled=true;el.disable=()=>enabled=false;qty(s,1);assert.equal(enabled,true);qty(s,0);assert.equal(enabled,false);
 });
 for(const value of ['1.5','-1','NaN','2junk'])await test('independent invalid quantity '+value+' is not admitted',async()=>{
 const s=await setup();qty(s,value);await s.w('#btnSummary').click();assert.equal(s.nav.length,0,'invalid raw quantity navigated');assert.equal(vm.runInContext('_selections.length',s.c),0);
 });
 for(const value of ['2.5','-1','NaN','7'])await test('independent invalid guests '+value+' are not admitted',async()=>{
 const s=await setup();qty(s,1);change(room(s).w('#numberofGuests'),value);await s.w('#btnSummary').click();assert.equal(s.nav.length,0,'invalid guests navigated');assert.equal(s.w('#btnSummary').enabled,false);
 });
 await test('independent async show expand late completion cannot revive zero selection',async()=>{
 const s=await setup(),el=s.w('#selectionBox'),pending=[];
 el.show=function(){return new Promise(resolve=>pending.push(()=>{this.hidden=false;resolve();}));};
 el.expand=function(){return new Promise(resolve=>pending.push(()=>{this.collapsed=false;resolve();}));};
 qty(s,1);assert.equal(pending.length,2);qty(s,0);assert.equal(el.collapsed,true);pending.forEach(f=>f());await flush();assert.equal(el.hidden,true,'late show revived zero selection');assert.equal(el.collapsed,true,'late expand revived zero selection');
 });
 await test('independent reentrant zero selection during show leaves all hidden',async()=>{
 const s=await setup(),el=s.w('#selectionBox'),show=el.show;let once=false;el.show=function(){show.call(this);if(!once){once=true;qty(s,0);}};qty(s,1);visibility(s,false);assert.equal(s.w('#btnSummary').enabled,false);
 });
 await test('independent failed replacement denies detached callbacks and clears prices',async()=>{
 let fail=false;const s=await setup({searchAvailability:async()=>{if(fail)throw Error('inert');return {ok:true,requestedNights:6,results:[row()]};}});const old=room(s);qty(s,2);fail=true;await s.run();change(old.w('#roomQtyDropdown'),'3');visibility(s,false);assert.equal(s.w('#finalTotal').text,'');await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
 });

 for(const id of selectionIds) await test('all-control late visibility completion '+id,async()=>{
  const s=await setup(),el=s.w('#'+id),pending=[];
  el.show=function(){return new Promise(resolve=>pending.push(()=>{this.hidden=false;resolve();}));};
  el.expand=function(){return new Promise(resolve=>pending.push(()=>{this.collapsed=false;resolve();}));};
  qty(s,1);assert.equal(pending.length,2);qty(s,0);for(const finish of pending.splice(0))finish();await flush();visibility(s,false);assert.equal(s.w('#btnSummary').enabled,false);
 });
 for(const id of selectionIds) await test('all-control synchronous deselection reentry '+id,async()=>{
  const s=await setup(),el=s.w('#'+id);let calls=0;el.show=function(){assert.ok(++calls<5);qty(s,0);this.hidden=false;};
  qty(s,1);await flush();visibility(s,false);assert.equal(s.w('#btnSummary').enabled,false);await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
 });
 await test('late collapse cannot conceal final valid selection',async()=>{
  const s=await setup();qty(s,1);const pending=[];
  for(const id of selectionIds){const el=s.w('#'+id);el.hide=function(){return new Promise(r=>pending.push(()=>{this.hidden=true;r();}));};el.collapse=function(){return new Promise(r=>pending.push(()=>{this.collapsed=true;r();}));};}
  qty(s,0);qty(s,2);for(const finish of pending.splice(0))finish();await flush();visibility(s,true);assert.equal(s.w('#totalGuests').text,'4 guests total');assert.equal(s.w('#btnSummary').enabled,true);
 });
 await test('visibility throws and rejected native promises are contained',async()=>{
  const s=await setup();s.w('#line102').show=()=>{throw Error('inert');};s.w('#line103').expand=()=>Promise.reject(Error('inert'));
  qty(s,1);await flush();assert.equal(s.w('#btnSummary').enabled,true);qty(s,0);await flush();assert.equal(s.w('#btnSummary').enabled,false);
 });
 for(const value of ['1.5','2junk','-1','NaN','4','',' 1','1e0']) await test('navigation rereads raw quantity '+JSON.stringify(value),async()=>{
  const s=await setup();qty(s,1);room(s).w('#roomQtyDropdown').value=value;await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.equal(s.w('#btnSummary').enabled,false);
 });
 for(const value of ['2.5','2junk','-1','NaN','7','','1']) await test('navigation rereads raw guests '+JSON.stringify(value),async()=>{
  const s=await setup();qty(s,1);room(s).w('#numberofGuests').value=value;await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.equal(s.w('#btnSummary').enabled,false);assert.ok(!s.w('#totalGuests').text.includes('NaN'));
 });
 await test('invalid selected row denies mixed cart rather than partial navigation',async()=>{
  const s=await setup({searchAvailability:async()=>({ok:true,requestedNights:6,results:[row(),{...row(),roomCode:'two_bedroom',occupancy:6}]})});qty(s,1);qty(s,1,1);change(room(s,1).w('#numberofGuests'),'7');await s.w('#btnSummary').click();assert.equal(s.nav.length,0);assert.equal(s.w('#btnSummary').enabled,false);assert.equal(s.w('#finalTotal').text,'');
  qty(s,0,1);assert.equal(s.w('#totalGuests').text,'2 guests total');await s.w('#btnSummary').click();assert.equal(s.nav.length,1);
 });
 await test('navigation rereads valid programmatic values and retains current quote',async()=>{
  const s=await setup();qty(s,1);room(s).w('#roomQtyDropdown').value='2';await s.w('#btnSummary').click();assert.equal(s.nav.length,1);const q=new URL(s.nav[0],'https://inert.invalid').searchParams;assert.ok(q.get('rc').includes(':2:2:'));assert.equal(s.w('#totalGuests').text,'4 guests total');await quote.verifyLockedPricingQuote(q.get('quote'),{packageId:pkg._id,checkIn:q.get('ci'),checkOut:q.get('co')});
 });
 await test('late native enable completion cannot authorize deselected cart',async()=>{
  const s=await setup(),b=s.w('#btnSummary');let release;b.enable=function(){return new Promise(r=>release=()=>{this.enabled=true;r();});};qty(s,1);qty(s,0);release();await flush();visibility(s,false);assert.equal(b.enabled,false);await b.click();assert.equal(s.nav.length,0);
 });
 await test('nested invalid guest edit cancels outer enable intent',async()=>{
  const s=await setup(),el=s.w('#selectionBox');el.show=function(){this.hidden=false;change(room(s).w('#numberofGuests'),'NaN');};qty(s,1);await flush();assert.equal(s.w('#btnSummary').enabled,false);assert.equal(s.w('#finalTotal').text,'');await s.w('#btnSummary').click();assert.equal(s.nav.length,0);
 });
 await test('unchanged valid refresh does not repeat visibility transitions',async()=>{
  const s=await setup();qty(s,1);const before=s.trace.filter(x=>selectionIds.includes(x[1].slice(1))).length;qty(s,2);assert.equal(s.trace.filter(x=>selectionIds.includes(x[1].slice(1))).length,before);visibility(s,true);
 });
 await test('late previous search collapse cannot hide new selection',async()=>{
  const s=await setup();qty(s,1);const pending=[];
  for(const id of selectionIds){const el=s.w('#'+id);el.hide=function(){return new Promise(r=>pending.push(()=>{this.hidden=true;r();}));};el.collapse=function(){return new Promise(r=>pending.push(()=>{this.collapsed=true;r();}));};}
  await s.run();qty(s,2);for(const finish of pending.splice(0))finish();await flush();visibility(s,true);assert.equal(s.w('#btnSummary').enabled,true);
 });
 console.log(JSON.stringify({timezone:process.env.TZ,cases},null,2));assert.equal(cases.length,82);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+original.slice(0,original.indexOf('(async()=>{'))+helpers+tests+'})',{filename:__filename})(require,repo+'/tests');
