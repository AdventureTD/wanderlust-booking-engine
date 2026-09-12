// Reuse the existing actual-page harness and signed quote producer; no live IO.
const fs = require('fs'), path = require('path'), vm = require('vm');
const original = fs.readFileSync(path.join(__dirname, 'legacy-date-handoff.cjs'), 'utf8');
const prefix = original.slice(0, original.indexOf('(async()=>{'));
const tests = `
(async()=>{
 for (const message of ['Loading', 'Failure: search again']) await test('shared hidden ancestors preserved: '+message, async()=>{
  const ui=elements();
  const page={hidden:true,collapsed:true,show(){this.hidden=false;},expand(){this.collapsed=false;}};
  const section={hidden:true,collapsed:true,parent:page,show(){this.hidden=false;},expand(){this.collapsed=false;}};
  const sibling={hidden:false,collapsed:false,text:'UNRELATED EDITOR PLACEHOLDER',parent:section};
  ui.w('#bookingStatus').parent=section;
  const ctx=vm.createContext({$w:ui.w,console});vm.runInContext(clean('page-booking-summary.js'),ctx);
  ctx.message=message;vm.runInContext('hideInitialSummaryValues();showInitializationStatus(message)',ctx);
  assert.equal(page.hidden,true);assert.equal(page.collapsed,true);
  assert.equal(section.hidden,true);assert.equal(section.collapsed,true);
  assert.equal(sibling.hidden,false);assert.equal(sibling.collapsed,false);
  assert.equal(ui.w('#bookingStatus').text,message);assert.equal(ui.w('#bookingStatus').hidden,false);
 });
 for (const stage of ['amenities','query']) for (const outcome of ['reject','resolve']) await test('late title '+stage+' '+outcome+' is inert',async()=>{
  let settle,entered=0,calls=0;
  const gate=new Promise((resolve,reject)=>settle=()=>outcome==='reject'?reject(Error('late rejected')):resolve(stage==='amenities'?{title:'Late'}:{items:[pkg]}));
  const title=pkg.title;pkg.title='';let made;
  try {made=await quote.createLockedPricingQuote(pkg._id,'2027-04-11','2027-04-17');} finally {pkg.title=title;}
  const customSDK={query(name){if(name==='Rooms')return sdk.query(name);calls++;return {limit(){return this;},find(){entered++;return stage==='query'?gate:Promise.reject(Error('fallback rejected'));}};}};
  const s=await summary(made.token,'2027-04-17',{getPackagesByNights:async()=>[{...pkg,title:''}],getPackageAmenities:()=>{if(stage==='amenities'){entered++;return gate;}return Promise.resolve({});},wixData:customSDK});
  assert.equal(entered,1);s.timers[0]();
  const snapshot=()=>JSON.stringify([...s.all].map(([id,el])=>[id,el.text,el.html,el.hidden,el.collapsed,el.enabled,el.data,typeof el.click]));
  const before=snapshot(),queries=calls;settle();await flush();
  assert.equal(calls,queries,'no query after timeout');
  assert.equal(snapshot(),before,'no UI mutation after timeout');
  assert.equal(s.w('#summaryRoomsRepeater').hidden,true);assert.equal(s.w('#btnContinue').click,undefined);
 });
 console.log(JSON.stringify({timezone:process.env.TZ,cases},null,2));
 assert.equal(cases.length,6);assert.equal(cases.filter(x=>!x.pass).length,0);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
`;
vm.runInThisContext('(function(require,__dirname){'+prefix+tests+'})', {filename:__filename})(require,__dirname);
