'use strict';
// Offline: actual worker/Head/iframe, actual master startup and Summary callback.
// Existing fixtures only supply SDK/DOM/network boundaries. No backend loads.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const repo=path.resolve(__dirname,'..'), tests=path.join(repo,'tests');
const read=p=>fs.readFileSync(repo+'/'+p,'utf8');
const tick=ms=>new Promise(r=>setTimeout(r,ms));
const slice=(s,a,b)=>s.split(/\r?\n/).slice(a-1,b).join('\n');
let support=read('tests/click-attribution-corrections.cjs').split("test('partitioned page ID")[0];
// Preserve real async postMessage ordering, unlike historical synchronous fixture ingress.
support=support.replace("if(drop)return;for(const f of listeners.message||[])f({data:d,source:frame,origin:frameOrigin});if(onMessage)onMessage({data:d});", "if(drop)return;setTimeout(()=>{for(const f of listeners.message||[])f({data:d,source:frame,origin:frameOrigin});if(onMessage)onMessage({data:d});},0);");
support=support.replaceAll('console:{log(){},error(){}}','console:{log:(x)=>diagnosticLogs.push(x),error(){}}');
const diagnosticLogs=[];
support=support.replace("const iframe=vm.createContext", "let iframe=vm.createContext");
support=support.replace("const component={onMessage:f=>{onMessage=f;},postMessage:d=>iframe.window.onmessage({data:d,source:parent,origin})};", "const component={onMessage:f=>{onMessage=f;},postMessage:d=>setTimeout(()=>iframe.window.onmessage({data:d,source:parent,origin}),0)};");
support=support.replace('return {readReady,deliveries,frameNode,','return {component,remount(){iframe=vm.createContext({window:{parent},document:{referrer:origin+\'/\'},URL});vm.runInContext(read(\'custom-code/event-bridge-iframe.html\').match(/<script>([\\s\\S]*?)<\\/script>/)[1],iframe);},readReady,deliveries,frameNode,');
const box={require,__dirname:tests,console,setTimeout,clearTimeout,URL,diagnosticLogs};vm.runInNewContext(support+'\nthis.fixture=fixture;',box);
const pagebox={require:require('module').createRequire(tests+'/attribution-hotfix.cjs'),__dirname:tests,console};
vm.runInNewContext(read('tests/attribution-hotfix.cjs').split('function bookingBackend')[0]+'\nthis.page=page;',pagebox);
const master=read('velo/masterPage.js').replace(/^import .*;\r?$/gm,'');
const summary=read('velo/page-booking-summary.js'), search=read('velo/page-booking-search.js');
function lifecycle(f,logs,settings){const w=()=>f.component;w.onReady=()=>{};const c=vm.createContext({$w:w,...f.api,getAllSettings:settings|| (async()=>({suspendGoogleAds:0})),wixWindowFrontend:{rendering:{env:'browser'}},consentPolicy:{getCurrentConsentPolicy:async()=>({policy:{analytics:true,advertising:true}})},console:{log:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}});vm.runInContext(master+'\nthis.start=initBrowserTracking;',c);return c;}
async function idle(f){await tick(220);}
async function scenario(mode){
 const logs=[];diagnosticLogs.length=0;let slow=false,policyCalls=0;
 const f=await box.fixture({query:'',policyRead:async()=>{policyCalls++;if(slow)await tick(650);return {v:1,requirement:'NOT_REQUIRED',policyKey:'a'.repeat(64),observedAt:Date.now()};}});
 let result;
 try {
  // Home, Search and Summary navigation each use real master initialization.
  let l=lifecycle(f,logs);await l.start();await idle(f);assert.notEqual(f.api.getStoredClickIds(undefined,true),null);
  if(mode.includes('fresh-worker'))await f.reconstruct();
  if(mode.includes('remount'))f.remount();
  l=lifecycle(f,logs);await l.start();
  // Exact Search settings/tracking/capture slice, independent Settings await.
  vm.runInContext('(async()=>{'+slice(search,341,355)+'})()',l);await idle(f);
  if(mode.includes('fresh-worker'))await f.reconstruct();
  if(mode.includes('remount'))f.remount();
  if(mode==='policy-timeout')slow=true;
  if(mode==='wrong-title')f.head.document.querySelectorAll=()=>[];
  if(mode==='withdrawal')f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);
  l=lifecycle(f,logs);await l.start();
  // Summary's Settings false comes after awaits in its initializer, before enabled Continue.
  vm.runInContext('{const settings={suspendGoogleAds:0};'+slice(summary,384,389)+'}',l);
  await tick(mode==='policy-timeout'||mode==='wrong-title'?550:45);
  const preClickDenied=f.api.getStoredClickIds(undefined,true)===null;
  // Entire actual Summary source + real registered Continue callback from existing fixture.
  const p=await pagebox.page({setup:"_summaryRooms=[{roomCode:'adventure_suite',qty:1,numGuests:2}];",book:async()=>({bookingNumber:'OFFLINE-HANDSHAKE',conversionCapability:'inert-not-a-real-capability'})});
  p.c.console={log:(...x)=>logs.push(x),error:(...x)=>logs.push(x),warn:(...x)=>logs.push(x)};
  p.c.initClickAttribution=()=>f.api.initClickAttribution(()=>f.component);p.c.waitForClickAttribution=f.api.waitForClickAttribution;p.c.getStoredClickIds=f.api.getStoredClickIds;
  f.api.initTracking(()=>f.component);p.c.trackPurchase=f.api.trackPurchase;
  // Avoid clear from success masking the measured snapshot; actual clear is unrelated to initial handoff.
  p.c.clearClickIds=f.api.clearClickIds;
  let redirects=0;p.c.wixLocation.to=()=>redirects++;
  await p.click();await tick(40);for(const timer of p.timers)timer();await tick(10);
  const purchaseCount=f.head.window.dataLayer.filter(d=>d&&d[0]==='event'&&d[1]==='purchase').length;
  result={mode,preClickDenied,policyCalls,googleCalls:p.ads.length,handoffCount:logs.filter(x=>x[0]?.event==='GOOGLE_ADS_BROWSER_HANDOFF').length,purchaseCount,redirects,analyticsCatch:logs.some(x=>String(x[0]).includes('analytics error')),protocol:f.posts.filter(d=>d.source==='wbe-click-attribution'||d.type==='wbe-click-attribution-result').map(d=>({direction:d.source?'request':'result',op:d.op,allowed:d.allowed})),masterCaptureCount:logs.filter(x=>x[0]==='[WBE-MASTER] captureClickIds started').length};
  assert.equal(purchaseCount,1);assert.equal(redirects,1);assert.equal(result.analyticsCatch,false);
  const expected=['policy-timeout','wrong-title','withdrawal'].includes(mode)?0:1;
  assert.equal(p.ads.length,expected);assert.equal(result.handoffCount,expected);
  const diagnostics=require('./attribution-diagnostic-console.cjs').events(diagnosticLogs.concat(logs.map(x=>x[0])));
  const wanted={'policy-timeout':'TIMEOUT','wrong-title':'FRAME_BINDING',withdrawal:'WITHDRAWAL'}[mode]||'READY_EMPTY';
  assert.ok(diagnostics.some(x=>x.reason===wanted),wanted);
  assert.ok(diagnostics.some(x=>x.stage==='browser'&&x.reason===(expected?'RPC_INVOKED':'ATTRIBUTION_NULL')));
  result.diagnostics=diagnostics;
  assert.equal(p.invoices.length,1);
  // No later readiness/regrant can resend this completed capture.
  slow=false;if(mode==='wrong-title')f.head.document.querySelectorAll=s=>s==='iframe[title="WBE event bridge"]'?[f.frameNode]:[];
  await f.ready();await tick(40);assert.equal(p.ads.length,expected);
  return result;
 } finally {f.api.setSuspendGoogleAds(true);f.close();}
}
(async()=>{const results=[];for(const mode of ['retained-worker-frame','fresh-worker-retained-frame','fresh-worker-remount','retained-worker-remount','policy-timeout','wrong-title','withdrawal']){const r=await scenario(mode);results.push(r);console.log(JSON.stringify({...r,protocol:undefined}));}})().catch(e=>{console.error(e);process.exitCode=1;});
