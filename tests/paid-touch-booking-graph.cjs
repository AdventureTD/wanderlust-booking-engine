'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {fixture}=require('./attribution-clock-v2.cjs');
function support(file,boundary,name){const source=fs.readFileSync(path.join(__dirname,file),'utf8'),i=source.indexOf(boundary);assert.ok(i>0);const box={require,__dirname,console,structuredClone,Buffer,URL,URLSearchParams,Date,setTimeout,clearTimeout};vm.runInNewContext(source.slice(0,i)+'\nthis.factory='+name+';',box);return box.factory;}
const producer=support('google-ads-fresh-producer.cjs','function support','producer');
const pageFactory=support('attribution-hotfix.cjs','function bookingBackend','page');
const KEY='wl_click_attribution';
for(const packed of [false,true])test('actual Head/Summary/fresh booking/journal wire preserves latest reporting through successful upload clear '+(packed?'packed':'source'),{timeout:8000},async()=>{
 const first={capturedAt:new Date(Date.now()-86400000).toISOString(),gclid:'INERT_ORIGINAL',gbraid:'',wbraid:'',msclkid:''};
 const bridge=await fixture({packed,query:'msclkid=INERT_LATEST_MS',pageStorage:[[KEY,JSON.stringify(first)]]});
 try{
  const f=await producer();let upload;const results=[];
  const page=await pageFactory({setup:"_summaryRooms=[{roomCode:'adventure_suite',qty:1,numGuests:2},{roomCode:'two_bedroom_apartment',qty:1,numGuests:3}];_selectedPackageId='INERT_PACKAGE';_pricingQuoteToken="+JSON.stringify(f.quote.token)+';',book:async p=>{const r=await f.availability.createBooking(p);results.push(r);return r;}});
  page.c.waitForClickAttribution=bridge.api.waitForClickAttribution;page.c.getStoredClickIds=bridge.api.getStoredClickIds;page.c.clearClickIds=bridge.api.clearClickIds;page.c.wixData=f.sdk;
  page.c.recordBookingConversion=p=>{upload=f.sender.recordBookingConversion(p);return upload};
  await page.click();assert.ok(upload);await upload;await bridge.settle();
  assert.equal(results.length,2);assert.equal(f.wires.length,1);assert.equal(f.wires[0].events[0].adIdentifiers.gclid,'INERT_ORIGINAL');
  const summary=[...f.rows].find(([k])=>k.startsWith('BookingSummary:'))[1];
  assert.equal(summary.firstPaidTouch.gclid,'INERT_ORIGINAL');assert.equal(summary.firstPaidTouch.capturedAt,first.capturedAt);
  assert.equal(summary.latestPaidTouch.msclkid,'INERT_LATEST_MS');assert.equal(summary.latestPaidTouch.gclid,'');
  assert.equal(summary.gclid,'INERT_ORIGINAL');assert.equal(summary.msclkid,'');
  assert.ok(page.payloads.every(p=>p.firstPaidTouch.gclid==='INERT_ORIGINAL'&&p.latestPaidTouch.msclkid==='INERT_LATEST_MS'));
  assert.equal(bridge.storage.has(KEY),false);assert.equal(bridge.workerStorage.has(KEY),false);
  assert.equal(page.invoices.length,1);assert.equal(page.timers.length,1);
  for(const [k,v] of f.rows)if(k.startsWith('Bookings:')){assert.equal(v.firstPaidTouch,undefined);assert.equal(v.latestPaidTouch,undefined)}
 }finally{bridge.close()}
});
