'use strict';
// Independent reviewer schedules. Native runtime; all SDK/provider edges inert.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function support(file,boundary,name){const text=fs.readFileSync(path.join(__dirname,file),'utf8'),at=text.indexOf(boundary);assert.ok(at>0);const box={require,__dirname,console,structuredClone,Buffer,URL,URLSearchParams,Date,setTimeout,clearTimeout};vm.runInNewContext(text.slice(0,at)+'\nthis.factory='+name+';',box);return box.factory;}
const bridge=support('click-attribution-corrections.cjs',"test('partitioned",'fixture');
const producer=support('google-ads-fresh-producer.cjs','for(const phone of','producer');
const page=support('attribution-hotfix.cjs','function bookingBackend','page');
const key='wl_click_attribution',tick=()=>new Promise(r=>setTimeout(r,10));
async function held(f,n=1){for(let i=0;i<60&&f.deliveries.length<n;i++)await tick();assert.equal(f.deliveries.length,n);}
async function booking(f,b,book){const p=await page({setup:"_summaryRooms=[{roomCode:'adventure_suite',qty:1,numGuests:2},{roomCode:'two_bedroom_apartment',qty:1,numGuests:3}];_selectedPackageId='INERT_PACKAGE';_pricingQuoteToken="+JSON.stringify(f.quote.token)+';',book:book|| (q=>f.availability.createBooking(q))});p.c.waitForClickAttribution=async()=>{};p.c.getStoredClickIds=b.api.getStoredClickIds;p.c.wixData=f.sdk;return p;}
function completed(p){assert.equal(p.payloads.length,2);assert.equal(p.invoices.length,1);assert.equal(p.timers.length,1);}
test('review limit: issued confirm precedes unseen revoke; first delivered revoke invalidates exact snapshot',{timeout:4000},async()=>{
 const b=await bridge({hold:d=>d.op==='confirm'||d.type==='wbe-click-revoke'});
 try{const ready=b.ready();await held(b);const answer=b.deliveries[0];assert.equal(answer.d.allowed,true);b.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await held(b,2);assert.equal(b.pageStore.getItem(key),null);
 answer.deliver();await ready;const snapshot=b.api.getStoredClickIds(undefined,true);assert.equal(snapshot.gclid,'INERT_EXACT_FIRST','documented undelivered-state limit, not atomic consent');assert.equal(b.api.getStoredClickIds(snapshot),snapshot);
 b.deliveries[1].deliver();assert.equal(b.api.getStoredClickIds(snapshot),null);assert.equal(b.api.getStoredClickIds(undefined,true),null);assert.equal(b.workerStore.getItem(key),null);
 }finally{b.close();}
});
for(const contactOnly of [false,true])test('review: actual purchase transport withdraws then throws; contacts and IDs denied, booking intact '+contactOnly,{timeout:6000},async()=>{
 const f=await producer(),b=await bridge({query:contactOnly?'':'gclid=INERT_CALLBACK&msclkid=INERT_MS',hold:d=>d.type==='wbe-click-revoke'});
 try{await b.ready();const p=await booking(f,b);let google=0,ms=0,callbacks=0;
 b.api.initTracking(()=>({postMessage(){callbacks++;b.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);assert.equal(b.deliveries.length,1);b.deliveries[0].deliver();throw Error('INERT_AFTER_DELIVERY');}}));
 p.c.trackPurchase=b.api.trackPurchase;p.c.recordBookingConversion=q=>{google++;return f.sender.recordBookingConversion(q);};p.c.recordMicrosoftBookingConversion=async()=>{ms++;return {ok:false};};await p.click();completed(p);assert.equal(callbacks,1);assert.equal(google,0);assert.equal(ms,0);assert.equal(f.wires.length,0);assert.deepEqual([...f.rows.values()].filter(r=>r.kind).map(r=>r.kind),['AUTH']);
 }finally{b.close();}
});
test('review: synchronous optional sender throw never removes invoice callback or redirect',{timeout:6000},async()=>{
 const f=await producer(),b=await bridge();try{await b.ready();const p=await booking(f,b);let calls=0;p.c.recordBookingConversion=()=>{calls++;throw Error('INERT_RPC_THROW');};await p.click();completed(p);assert.equal(calls,1);assert.equal(f.wires.length,0);}finally{b.close();}
});
test('review: reaccept identical record creates new handle but never revives prior invocation',{timeout:6000},async()=>{
 const b=await bridge({banner:true});try{b.click('Accept All');await b.ready();const first=b.api.getStoredClickIds(undefined,true),bytes=b.workerStore.getItem(key);b.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await tick();assert.equal(b.api.getStoredClickIds(first),null);b.click('Cookie settings');b.click('Accept All');b.pageStore.setItem(key,bytes);await b.ready();const next=b.api.getStoredClickIds(undefined,true);assert.equal(next.gclid,first.gclid);assert.equal(b.api.getStoredClickIds(next),next);assert.equal(b.api.getStoredClickIds(first),null);assert.equal(b.api.getStoredClickIds(JSON.parse(JSON.stringify(next))),null);}finally{b.close();}
});
test('review: old clear preserves later record but conservatively invalidates outstanding epoch handles',{timeout:6000},async()=>{
 const b=await bridge();try{await b.ready();const old=b.api.getStoredClickIds(undefined,true);await b.api.clearClickIds(old);const fresh={...old,gclid:'INERT_NEW_TOUCH',capturedAt:new Date().toISOString()};b.pageStore.setItem(key,JSON.stringify(fresh));await b.ready();const next=b.api.getStoredClickIds(undefined,true);await b.api.clearClickIds(old);assert.equal(JSON.parse(b.pageStore.getItem(key)).gclid,'INERT_NEW_TOUCH');assert.equal(b.api.getStoredClickIds().gclid,'INERT_NEW_TOUCH');assert.equal(b.api.getStoredClickIds(next),null);assert.equal(b.api.getStoredClickIds(old),null);}finally{b.close();}
});
test('review: concurrent native bookings, one withdrawn at room await, one positive original capability',{timeout:8000},async()=>{
 const f=await producer(),a=await bridge({query:'gclid=INERT_A'}),b=await bridge({query:'gclid=INERT_B'});let release;
 try{await a.ready();await b.ready();let entered;const at=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let count=0;
 const pa=await booking(f,a,async q=>{const result=await f.availability.createBooking(q);if(++count===1){entered();await gate;}return result;});const pb=await booking(f,b);const otherQuote=await f.cache.get('backend/pricingQuote').namespace.createLockedPricingQuote('INERT_PACKAGE','2027-02-01','2027-02-02');vm.runInContext("_summaryCis='2027-02-01';_summaryCos='2027-02-02';_pricingQuoteToken="+JSON.stringify(otherQuote.token)+';',pb.c);let upload,inputs=[];
 pa.c.recordBookingConversion=q=>{inputs.push(q);return f.sender.recordBookingConversion(q);};pb.c.recordBookingConversion=q=>{inputs.push(q);upload=f.sender.recordBookingConversion(q);return upload;};
 const pending=pa.click();await at;await pb.click();await upload;a.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await tick();release();await pending;completed(pa);completed(pb);assert.equal(inputs.length,1);assert.equal(f.wires.length,1);assert.equal(f.wires[0].events[0].adIdentifiers.gclid,'INERT_B');assert.equal([...f.rows.values()].filter(r=>r.kind==='AUTH').length,2);assert.equal([...f.rows.keys()].filter(k=>k.startsWith('Bookings:')).length,4);assert.equal((await f.sender.recordBookingConversion(inputs[0])).ok,false);assert.equal(f.wires.length,1);
 }finally{if(release)release();a.close();b.close();}
});
test('review: all literal plus / single percent decode fields survive two native rooms and serializer',{timeout:6000},async()=>{
 const f=await producer(),b=await bridge({query:'gclid=INERT+A&gbraid=INERT%2BB&wbraid=INERT%252BC&msclkid=INERT%2BMS'});
 try{await b.ready();const p=await booking(f,b);let upload;p.c.recordBookingConversion=q=>upload=f.sender.recordBookingConversion(q);await p.click();await upload;completed(p);for(const q of p.payloads){assert.equal(q.gclid,'INERT+A');assert.equal(q.gbraid,'INERT+B');assert.equal(q.wbraid,'INERT%2BC');assert.equal(q.msclkid,'INERT+MS');}assert.deepEqual(JSON.parse(JSON.stringify(f.wires[0].events[0].adIdentifiers)),{gclid:'INERT+A',gbraid:'INERT+B',wbraid:'INERT%2BC'});assert.equal(f.wires[0].events[0].conversionValue,587.5);assert.equal(f.wires[0].events[0].currency,'USD');
 }finally{b.close();}
});
