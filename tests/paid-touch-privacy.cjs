'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{createRequire}=require('node:module'),req=createRequire(root+'/tests/attribution-hotfix.cjs');
const src=fs.readFileSync(root+'/tests/attribution-hotfix.cjs','utf8');const c={require:req,__dirname:root+'/tests',console};vm.runInNewContext(src.slice(0,src.indexOf('function bookingBackend'))+'\nthis.pageFactory=page;',c);
const {fixture}=req('./attribution-clock-v2.cjs');

// Intercept every worker console level through the actual tracking module.
{
 const file=root+'/tests/click-attribution-corrections.cjs',src=fs.readFileSync(file,'utf8');
 const logs=[],observerConsole=Object.fromEntries(['log','warn','error','info','debug'].map(k=>[k,(...args)=>logs.push({level:k,args})]));
 const ctx={require:createRequire(file),__dirname:root+'/tests',console,setTimeout,clearTimeout,URL,observerConsole};
 const code=src.slice(0,src.indexOf("test('partitioned")).replaceAll('console:{log(){},error(){}}','console:observerConsole');
 vm.runInNewContext(code+'\nthis.make=fixture;',ctx);
 for(const mode of ['storage-error','uninitialized','bridge-error','suspended','sent']) test('tracking all-level fixed-code privacy '+mode,async()=>{
  const f=await ctx.make();try{
   logs.length=0;
   if(mode==='storage-error'){f.workerStore.getItem=()=>{throw Error('PRIVATE_TRACKING_ID')};assert.equal(f.api.getStoredClickIds(),null)}
   else {
    if(mode!=='uninitialized')f.api.initTracking(()=>({onMessage(){},postMessage(){if(mode==='bridge-error')throw {private:'PRIVATE_TRACKING_ID'}}}));
    if(mode==='suspended')f.api.setSuspendGoogleAds(true);
    f.api.pushDataLayer({event:'PRIVATE_TRACKING_ID',gclid:'PRIVATE_TRACKING_ID'});
   }
   assert.equal(JSON.stringify(logs).includes('PRIVATE_TRACKING_ID'),false);assert.ok(logs.length);
  }finally{f.close()}
 });
}
// Independent reporting-write privacy witness; root-only relocation.
{
'use strict';
// Independent actual Summary reporting-write rejection witness; no live SDK.
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=require('node:path').resolve(__dirname,'..'),file=root+'/tests/attribution-hotfix.cjs',req=createRequire(file),src=fs.readFileSync(file,'utf8');
const c={require:req,__dirname:root+'/tests',console};vm.runInNewContext(src.slice(0,src.indexOf('function bookingBackend'))+'\nthis.pageFactory=page;',c);
const {fixture}=req('./attribution-clock-v2.cjs');
// Migrated (security remediation): the page no longer reads/writes BookingSummary.
// Booking-time reporting travels in the createBooking payload; a withdrawal after
// first-room creation uses only the capability-gated clear RPC. Its rejection
// must not expose identifiers at any console level, and no client BookingSummary
// access may occur.
for(const throws of [false,true])test('independent Summary attribution reporting clear exception privacy '+throws,async()=>{
 const first={capturedAt:new Date(Date.now()-86400000).toISOString(),gclid:'PRIVATE_NOTES_FIRST',gbraid:'',wbraid:'',msclkid:''};
 const f=await fixture({query:'msclkid=PRIVATE_NOTES_LATEST',pageStorage:[['wl_click_attribution',JSON.stringify(first)]]});
 try{
  let count=0,clears=0,client=0;
  const p=await c.pageFactory({book:async()=>{if(++count===1){f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await new Promise(r=>setTimeout(r,20));}return {bookingNumber:'OFFLINE-SNAPSHOT',summaryCapability:'bsc1.INERT_CAPABILITY'};}}),logs=[];
  p.c.console=Object.fromEntries(['log','warn','error','info','debug'].map(k=>[k,(...args)=>logs.push({level:k,args})]));
  p.c.waitForClickAttribution=f.api.waitForClickAttribution;p.c.getStoredClickIds=f.api.getStoredClickIds;
  p.c.wixData.query=collection=>{client++;throw Error('CLIENT_DATA_FORBIDDEN '+collection);};
  p.c.wixData.update=()=>{client++;throw Error('CLIENT_DATA_FORBIDDEN');};
  p.c.clearBookingSummaryReporting=(bookingNumber,capability)=>{clears++;assert.equal(bookingNumber,'OFFLINE-SNAPSHOT');assert.equal(capability,'bsc1.INERT_CAPABILITY');
   if(throws)return Promise.reject(Error('rejected PRIVATE_NOTES_LATEST'));return Promise.resolve({ok:true});};
  await p.click();for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(client,0,'no client BookingSummary access');assert.equal(clears,1);
  assert.equal(p.payloads.length,2);assert.equal(p.invoices.length,1);
  assert.equal(p.payloads[0].firstPaidTouch.gclid,'PRIVATE_NOTES_FIRST');assert.equal(p.payloads[0].latestPaidTouch.msclkid,'PRIVATE_NOTES_LATEST');
  assert.ok(!p.payloads[1].gclid&&!p.payloads[1].msclkid&&p.payloads[1].firstPaidTouch===null,'later room omits withdrawn IDs');
  assert.equal(p.ads.length,0,'withdrawn snapshot never uploads');
  assert.equal(JSON.stringify(logs).includes('PRIVATE_NOTES_'),false,'reporting-clear exceptions must not expose first/latest IDs through Summary console');
  assert.equal(JSON.stringify(logs).includes('INERT_CAPABILITY'),false,'capability never logged');
 }finally{f.close()}
});

}
for (const microsoftFirst of [false,true]) test('Summary first/latest identifier privacy '+microsoftFirst,async()=>{
 const first={capturedAt:new Date(Date.now()-86400000).toISOString(),gclid:microsoftFirst?'':'INERT_FIRST',gbraid:'',wbraid:'',msclkid:microsoftFirst?'INERT_FIRST':''};
 const f=await fixture({query:(microsoftFirst?'gclid':'msclkid')+'=INERT_PRIVATE_LATEST',pageStorage:[['wl_click_attribution',JSON.stringify(first)]]});
 try{const p=await c.pageFactory();const logs=[];p.c.console={log:(...x)=>logs.push(x),warn(){},error(){}};p.c.waitForClickAttribution=f.api.waitForClickAttribution;p.c.getStoredClickIds=f.api.getStoredClickIds;await p.click();assert.equal(p.invoices.length,1);assert.equal(p.payloads[0].latestPaidTouch[microsoftFirst?'gclid':'msclkid'],'INERT_PRIVATE_LATEST');assert.equal(JSON.stringify(logs).includes('INERT_FIRST'),false,'first identifier must remain private');assert.equal(JSON.stringify(logs).includes('INERT_PRIVATE_LATEST'),false,'actual Summary console serialized latest-only advertising identifier');}finally{f.close()}
});

// Permanent reviewer assertions (repo-relative root), plus marking-error cases.
{
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=require('node:path').resolve(__dirname,'..'),file=root+'/tests/attribution-hotfix.cjs',req=createRequire(file);
const src=fs.readFileSync(file,'utf8'),c={require:req,__dirname:root+'/tests',console};vm.runInNewContext(src.slice(0,src.indexOf('function bookingBackend'))+'\nthis.pageFactory=page;',c);
const {fixture}=req('./attribution-clock-v2.cjs');
for(const mode of ['result-echo-positive','reject-message','reject-object','sync-throw','mark-sync-throw','mark-reject']) test('fresh review Summary all console levels '+mode,async()=>{
 const first={capturedAt:new Date(Date.now()-86400000).toISOString(),gclid:'',gbraid:'',wbraid:'',msclkid:'PRIVATE_FIRST_MS'};
 const f=await fixture({query:'gclid=PRIVATE_LATEST_GOOGLE',pageStorage:[['wl_click_attribution',JSON.stringify(first)]]});
 try{
  const p=await c.pageFactory(),logs=[];let calls=0;
  p.c.console=Object.fromEntries(['log','warn','error','info','debug'].map(k=>[k,(...args)=>logs.push({level:k,args})]));
  p.c.waitForClickAttribution=f.api.waitForClickAttribution;p.c.getStoredClickIds=f.api.getStoredClickIds;
  let markCalls=0;
  p.c.recordMicrosoftBookingConversion=payload=>{calls++;assert.equal(payload.msclkid,'PRIVATE_FIRST_MS');
   if(mode.startsWith('mark-')) {
    // Migrated: the backend marks the flag; the page must not touch BookingSummary.
    p.c.wixData.query=()=>{markCalls++;if(mode==='mark-sync-throw')throw Error('PRIVATE_FIRST_MS');return {eq(){return this},limit(){return this},find(){return Promise.reject({private:'PRIVATE_FIRST_MS'})}}};
    assert.ok(Object.prototype.hasOwnProperty.call(payload,'summaryCapability'),'capability travels only to the backend');
    return Promise.resolve({ok:true});
   }
   if(mode==='reject-message')return Promise.reject(new Error('provider rejected '+payload.msclkid));
   if(mode==='reject-object')return Promise.reject({msclkid:payload.msclkid});
   if(mode==='sync-throw')throw Error('provider rejected '+payload.msclkid);
   return Promise.resolve({ok:false,payload,detail:'PRIVATE_LATEST_GOOGLE'});
  };
  await p.click();for(let i=0;i<30;i++)await Promise.resolve();
  if(mode.startsWith('mark-'))assert.equal(markCalls,0,'no client BookingSummary read/update after Microsoft success');
  assert.equal(calls,1);assert.equal(p.invoices.length,1);assert.equal(p.payloads[0].latestPaidTouch.gclid,'PRIVATE_LATEST_GOOGLE');
  assert.equal(JSON.stringify(logs).includes('PRIVATE_FIRST_MS'),false,'Microsoft error path must not emit raw first identifier at any console level');
  assert.equal(JSON.stringify(logs).includes('PRIVATE_LATEST_GOOGLE'),false);
 }finally{f.close()}
});

}
