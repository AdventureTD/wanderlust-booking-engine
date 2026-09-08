'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), cp = require('child_process');
const paths = ['velo/public/tracking.js','velo/custom-code/event-bridge-iframe.html','velo/custom-code/microsoft-uet-and-events.html','velo/custom-code/google-tag-and-consent.html'];
const baseline = process.argv.includes('--baseline') || process.argv.includes('--baseline-fs10');
const sources = paths.map(p => baseline ? cp.execFileSync('git',['show','875f1800704b7309daa45a6074abfdd78e0ba0b7:'+p],{encoding:'utf8'}) : fs.readFileSync(p,'utf8'));
if(process.argv.includes('--relay-preclosure')) {
  const before=fs.readFileSync(process.argv[process.argv.indexOf('--relay-preclosure')+1],'utf8');
  assert.equal(require('crypto').createHash('sha256').update(before).digest('hex'),'2232d7d6e4b1b13841c470438aa4b25b9c39ad8309bf1478c9f0af86b19395d8');sources[1]=before;
}
// Exact frontend-only graph: imports are checked then replaced, never evaluated.
assert.deepStrictEqual([...sources[0].matchAll(/^import .* from '([^']+)';/gm)].map(m=>m[1]), ['wix-storage-frontend','wix-location-frontend','backend/settings.web']);
function fixture(options={}) {
  const queue=[], timers=new Map(), listeners={}, docListeners={}, calls=[], scripts=[], history=[], held=[]; let id=0, callback, holdReceiver=null;
  const site='https://www.wanderlustcaribbean.com', origin='https://bridge.synthetic.invalid';
  const storage={getItem(){return null;},setItem(){},removeItem(){}};
  const frameListeners={};
  let hopHold=null;const hopHeld=[];
  const bridgeWindow={postMessage(data,target){assert.strictEqual(target,origin);queue.push(()=>{if(hopHold && hopHold(data))hopHeld.push(data);else relay.onmessage({data,source:parent,origin:site});});}};
  const frame={contentWindow:bridgeWindow,addEventListener(k,f){(frameListeners[k] ||= []).push(f);}};
  const parent={postMessage(data,target){assert.strictEqual(target,site);history.push(data);queue.push(()=>{if(callback){if(data.type==='wbe-operational-ack'&&data.phase==='state'&&data.receiver===holdReceiver)held.push(()=>callback({data}));else callback({data});}for(const f of listeners.message||[]){try{f({data,source:bridgeWindow,origin});}catch(e){if(options.listenerError)options.listenerError(e);else throw e;}}});}};
  const document={readyState:'complete',getElementById(k){return k==='wbeEventBridge'?frame:null;},addEventListener(k,f){(docListeners[k] ||= []).push(f);},dispatchEvent(e){for(const f of docListeners[e.type]||[])f(e);},createElement(){return {};},getElementsByTagName(){return [{parentNode:{insertBefore(s){scripts.push(s);}}}];}};
  const common={console:{log(){},error(){}},crypto:require('crypto').webcrypto,Uint8Array,URL,Event,localStorage:storage,setTimeout(f,delay){timers.set(++id,f);if(options.timer)options.timer(f,delay);return id;},clearTimeout(i){timers.delete(i);}};
  const head={...common,document,location:{origin:site,pathname:'/',href:site+'/'},addEventListener(k,f){(listeners[k] ||= []).push(f);},UET:function(){calls.push(['constructor']);this.push=(...a)=>calls.push(a);}};head.window=head;
  for(const index of [2,3]) {const source=sources[index].replace("MICROSOFT_BRIDGE_ORIGIN = ''","MICROSOFT_BRIDGE_ORIGIN = '"+origin+"'").replace("OPERATIONAL_BRIDGE_ORIGIN = ''","OPERATIONAL_BRIDGE_ORIGIN = '"+origin+"'");vm.runInNewContext([...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n'),head,{filename:paths[index]});}
  const relay={...common,parent};relay.window=relay;vm.runInNewContext([...sources[1].matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n'),relay,{filename:paths[1]});
  const component={onMessage(f){callback=f;},postMessage(data){history.push(data);queue.push(()=>relay.onmessage({data,source:parent,origin:site}));}};
  const producer={...common,local:storage,wixLocationFrontend:{url:site+'/',query:{}},getAdvertisingSuspension(){throw Error('backend forbidden');}};
  vm.runInNewContext(sources[0].replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+'\nthis.api={initTracking,observeMicrosoftPage,setSuspendGoogleAds,trackPurchase};',producer,{filename:paths[0]});
  function pump(){let n=0;while(queue.length){assert(++n<500,'transport loop');queue.shift()();}}
  function tick(){const batch=[...timers.values()];timers.clear();for(const f of batch)f();pump();}
  function wrap(target,hop){const post=target.postMessage;target.postMessage=function(d,...args){
    if(options.fault)options.fault(hop,'before',d);
    const result=post.call(this,d,...args);
    if(options.fault)options.fault(hop,'after',d);
    return result;
  };}
  wrap(component,'component');wrap(parent,'relay');wrap(bridgeWindow,'head');
  function freshProducer(){const c={...common,local:storage,wixLocationFrontend:{url:site+'/',query:{}},getAdvertisingSuspension(){throw Error('backend forbidden');}};
    vm.runInNewContext(sources[0].replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+'\nthis.api={initTracking,observeMicrosoftPage,setSuspendGoogleAds,trackPurchase};',c,{filename:paths[0]});return c.api;}
  function freshRelay(){const c={...common,parent};c.window=c;vm.runInNewContext([...sources[1].matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n'),c,{filename:paths[1]});relay.onmessage=c.onmessage;return c;}
  const api=producer.api;api.observeMicrosoftPage(()=>component);
  return {api,pump,tick,calls,head,scripts,history,queue,timers,frameListeners,component,freshProducer,freshRelay, producerInject(data){callback({data});}, producerState(){return vm.runInNewContext('({withdrawn:microsoftWithdrawn, microsoft:microsoftQueue.length, google:googleQueue.length, fault:opFault})',producer);}, holdHop(fn){hopHold=fn;}, hopHeld, releaseHop(){hopHold=null;while(hopHeld.length)relay.onmessage({data:hopHeld.shift(),source:parent,origin:site});pump();}, inject(data,source=parent,eventOrigin=site){relay.onmessage({data,source,origin:eventOrigin});}, headInject(data){for(const f of listeners.message||[])f({data,source:bridgeWindow,origin});}, hold(receiver){holdReceiver=receiver;},release(){holdReceiver=null;while(held.length)held.shift()();pump();}};
}
if(process.argv.includes('--baseline-fs10')){const f=fixture();f.api.setSuspendGoogleAds(false);f.pump();f.tick();f.api.trackPurchase({transactionId:'already-relayed',value:0,currency:'EUR'});f.pump();f.api.setSuspendGoogleAds(true);f.pump();assert.equal(f.calls.length,0);f.scripts[0].onload();assert(f.calls.some(a=>a[1]==='purchase'&&a[2].transaction_id==='already-relayed'));console.log('LIMITATION | baseline FS10 actual-source purchase drains after producer ON');process.exit(0);}
// Actual loader queue: uncertain attempted work is not retryable.
if(process.argv.includes('--ms-loader-review')) {
  let failures=0, count=0;
  function loaderCheck(id,fn){count++;try{fn();console.log('PASS | '+id);}catch(e){failures++;console.error('FAIL | '+id+' | '+e.stack);}}
  for(const mode of ['throw','positive','ON','withdrawal','UNRESOLVED','replacement']) {
    const errors=[], f=fixture({listenerError:e=>errors.push(e.message)});
    function settle(){for(let i=0;i<9;i++){const batch=[...f.timers.values()];f.timers.clear();for(const fn of batch)try{fn();}catch(e){errors.push(e.message);}f.pump();}}
    f.api.setSuspendGoogleAds(false);f.pump();settle();
    f.api.trackPurchase({transactionId:'loader-first',value:0,currency:'EUR'});
    f.api.trackPurchase({transactionId:'loader-second',value:12,currency:'USD'});f.pump();
    let attempted=0;
    f.head.UET=function(){f.calls.push(['constructor']);this.push=(...x)=>{
      f.calls.push(x);
      if(x[0]!=='event'||x[1]!=='purchase'||++attempted!==1)return;
      if(mode==='ON'){f.api.setSuspendGoogleAds(true);f.pump();}
      if(mode==='withdrawal'){f.head.wbeAdvertisingWithdrawn=true;f.head.document.dispatchEvent(new Event('wbeAdvertisingWithdrawn'));f.pump();}
      if(mode==='UNRESOLVED'){f.api.setSuspendGoogleAds(null);f.pump();}
      if(mode==='replacement')f.head.document.getElementById=()=>({contentWindow:{}});
      if(mode!=='positive')throw Error('loader purchase applied then threw');
    };};
    try{f.scripts[0].onload();}catch(e){errors.push(e.message);}settle();
    const purchases=()=>f.calls.filter(x=>x[0]==='event'&&x[1]==='purchase').map(x=>[x[2].transaction_id,x[2].revenue_value,x[2].currency]);
    console.log('TRACE | MS-LOADER-'+mode+' | '+JSON.stringify({purchases:purchases(),attempted,errors,timers:f.timers.size}));
    const both=[['loader-first',0,'EUR'],['loader-second',12,'USD']];
    loaderCheck(mode==='throw'?'MS-LOADER-THROW-starvation':'MS-LOADER-'+mode+'-initial',()=>{
      assert.deepStrictEqual(purchases(),['throw','positive'].includes(mode)?both:both.slice(0,1),'untouched loader successor must progress only under current permission');
      assert.equal(f.timers.size,0,'bounded loader settling');
    });
    f.api.setSuspendGoogleAds(false);f.pump();settle();
    loaderCheck(mode==='throw'?'MS-LOADER-THROW-duplicate':'MS-LOADER-'+mode+'-fresh-OFF',()=>{
      assert.equal(purchases().filter(x=>x[0]==='loader-first').length,1,'fresh OFF must never replay uncertain first purchase');
      assert.deepStrictEqual(purchases(),['throw','positive','UNRESOLVED'].includes(mode)?both:both.slice(0,1),'fresh OFF preserves successor eligibility and exact UET purchase fields/order');
      assert.equal(f.timers.size,0);
    });
  }
  assert.equal(count,12);if(failures)process.exitCode=1;
}
let completed=0;
function check(name,fn){fn();completed++;console.log('PASS | '+name);}
check('PS01-initial-unresolved-actual-four',()=>{const f=fixture();f.pump();f.scripts[0].onload();f.pump();assert.equal(f.calls.length,0);assert.equal(f.head.dataLayer.filter(a=>a[0]==='config').length,2);assert.equal(f.head.dataLayer.filter(a=>a[0]==='event').length,0);});
check('PS02-real-bind-off-business',()=>{const f=fixture();f.api.trackPurchase({transactionId:'zero',value:0,currency:'EUR'});f.pump();assert.equal(f.head.dataLayer.filter(a=>a[0]==='event').length,0);f.api.setSuspendGoogleAds(false);f.pump();f.tick();assert(f.history.some(x=>x.type==='wbe-operational-ack'&&x.receiver==='google'&&x.phase==='state'),'missing actual Google state ACK gate');assert(f.history.some(x=>x.type==='wbe-operational-ack'&&x.receiver==='microsoft'&&x.phase==='state'),'missing actual Microsoft state ACK gate');f.scripts[0].onload();f.tick();assert(f.calls.some(a=>a[0]==='event'&&a[1]==='purchase'&&a[2].transaction_id==='zero'&&a[2].revenue_value===0&&a[2].currency==='EUR'));assert(f.head.dataLayer.some(a=>a[0]==='event'&&a[1]==='purchase'&&a[2].value===0&&a[2].currency==='EUR'));});
check('PS03-delivered-ON-clears-before-loader',()=>{const f=fixture();f.api.setSuspendGoogleAds(false);f.pump();f.tick();f.api.trackPurchase({transactionId:'cleared',value:0,currency:'EUR'});f.pump();f.api.setSuspendGoogleAds(true);f.pump();f.scripts[0].onload();f.tick();assert.equal(f.calls.length,0,'ON must clear head route and pending purchase before loader');f.api.setSuspendGoogleAds(false);f.pump();f.tick();assert.equal(f.calls.length,0,'OFF cannot resurrect cleared route');f.api.observeMicrosoftPage(()=>{throw Error('missing attachment');});});
for(const receiver of ['google','microsoft'])check('PS02-held-'+receiver,()=>{const f=fixture();f.pump();f.hold(receiver);f.api.setSuspendGoogleAds(false);f.api.trackPurchase({transactionId:'held',value:0,currency:'EUR'});f.pump();f.tick();assert.equal(f.history.filter(x=>x.type==='wbe-operational-business').length,0,'both current state receipts required');f.release();f.tick();assert(f.history.some(x=>x.type==='wbe-operational-business'));});
check('PS03-new-route-and-purchase-after-clear',()=>{const f=fixture();f.api.setSuspendGoogleAds(false);f.pump();f.tick();f.api.setSuspendGoogleAds(true);f.pump();f.scripts[0].onload();f.api.setSuspendGoogleAds(false);f.pump();f.tick();assert.equal(f.calls.length,0);f.api.observeMicrosoftPage(()=>f.component);f.api.trackPurchase({transactionId:'fresh',value:12,currency:'USD'});f.pump();f.tick();assert(f.calls.some(a=>a[1]==='purchase'&&a[2].transaction_id==='fresh'));assert.equal(f.head.dataLayer.filter(a=>a[0]==='consent'&&a[1]==='update').length,0);});
check('PS09-load-hook-invalidates-deferred-head',()=>{const f=fixture();f.api.setSuspendGoogleAds(false);f.pump();f.tick();f.api.trackPurchase({transactionId:'old-document',value:0,currency:'EUR'});f.pump();f.frameListeners.load.forEach(fn=>fn());f.scripts[0].onload();f.tick();assert.equal(f.calls.length,0);});
check('PS06-terminal-deadline-rejects-late-ACK',()=>{const f=fixture();f.pump();f.hold('google');f.api.setSuspendGoogleAds(false);f.api.trackPurchase({transactionId:'late',value:1});f.pump();for(let i=0;i<7;i++)f.tick();assert.equal(f.timers.size,0);f.release();f.tick();assert.equal(f.history.filter(x=>x.type==='wbe-operational-business').length,0);});
check('PS06-silent-ON-loss-LIMITATION',()=>{const f=fixture();f.api.setSuspendGoogleAds(false);f.pump();f.tick();f.api.trackPurchase({transactionId:'silent-loss',value:0,currency:'EUR'});f.pump();const post=f.component.postMessage;f.component.postMessage=d=>{if(d.type==='wbe-operational-state'&&d.state==='ON')return;post(d);};f.api.setSuspendGoogleAds(true);for(let i=0;i<7;i++)f.tick();f.scripts[0].onload();assert(f.calls.some(a=>a[1]==='purchase'&&a[2].transaction_id==='silent-loss'),'snapshot limitation witness must remain explicit');console.log('LIMITATION | lost ON leaves remote queue under last received OFF');});
check('PS04-missed-ON-watermark-clears-route',()=>{const f=fixture();f.api.setSuspendGoogleAds(false);f.pump();f.tick();const post=f.component.postMessage;f.component.postMessage=d=>{if(d.type==='wbe-operational-state'&&d.state==='ON')return;post(d);};f.api.setSuspendGoogleAds(true);f.api.setSuspendGoogleAds(false);f.pump();f.tick();f.scripts[0].onload();assert.equal(f.calls.length,0,'watermark must clear old route eligibility even when ON was missed');});
assert.equal(completed,10);console.log('Completed assertions groups: '+completed);
// Relay assertions observe actual relay egress, not only downstream rejection.
if(process.argv.includes('--relay-closure') || process.argv.includes('--head-duplicate')) {
  let failures=0, count=0;
  function closure(id,fn){count++;try{fn();console.log('PASS | '+id);}catch(e){failures++;console.error('FAIL | '+id+' | '+e.message);}}
  function ready(){const f=fixture();f.api.setSuspendGoogleAds(false);f.pump();f.tick();f.api.trackPurchase({transactionId:'relay-control',value:0,currency:'EUR'});f.pump();return f;}
  function last(f,type){return f.history.filter(x=>x.type==='wbe-operational-'+type).at(-1);}
  function denied(f,d,...args){const n=f.history.length;f.inject(d,...args);assert.equal(f.history.length,n,'relay must not forward rejected traffic');}
  if(process.argv.includes('--relay-closure')) {
    closure('RC-PS02-unbound-state-business-ACK',()=>{const f=fixture();f.holdHop(d=>d.type==='wbe-operational-ack'&&d.phase==='bound'&&d.receiver==='google');f.pump();const b=last(f,'bind'), ack=last(f,'ack');assert.equal(ack.receiver,'microsoft');f.inject(ack);f.pump();const s={...b,type:'wbe-operational-state',revision:1,state:'OFF',discardThrough:0};denied(f,s);denied(f,{...s,type:'wbe-operational-ack',receiver:'microsoft',phase:'state'});denied(f,{...b,type:'wbe-operational-business',revision:1,channel:'google',message:{type:'wbe-datalayer-event',payload:{event:'purchase'}}});f.releaseHop();f.api.setSuspendGoogleAds(false);f.pump();f.tick();assert(f.history.some(x=>x.type==='wbe-operational-business'));});
    closure('RC-PS02-current-state-two-distinct-receipts',()=>{const f=ready();f.holdHop(d=>d.type==='wbe-operational-ack'&&d.phase==='state'&&d.receiver==='microsoft');f.api.setSuspendGoogleAds(false);f.pump();const s=last(f,'state'), b={...last(f,'business'),revision:s.revision};const a=last(f,'ack');assert.equal(a.receiver,'google');f.inject(a);denied(f,b);f.releaseHop();const n=f.history.length;f.inject(b);assert.equal(f.history.length,n+1);});
    closure('RC-PS04-stale-wrongtuple-business',()=>{const f=ready(), business=last(f,'business'), state=last(f,'state'), ack=last(f,'ack');f.api.setSuspendGoogleAds(true);f.pump();denied(f,business);denied(f,state);denied(f,ack);f.api.setSuspendGoogleAds(false);f.pump();const current={...business,revision:last(f,'state').revision};for(const key of ['producerSession','relayBoot','googleBoot','microsoftBoot'])denied(f,{...current,[key]:current[key]==='f'.repeat(32)?'e'.repeat(32):'f'.repeat(32)});});
    closure('RC-PS04-watermark-and-equal-conflict',()=>{const f=ready();f.api.setSuspendGoogleAds(true);f.pump();f.api.setSuspendGoogleAds(false);f.pump();const s=last(f,'state');denied(f,{...s,revision:s.revision+1,discardThrough:0});f.inject({...s,state:'UNRESOLVED'});denied(f,s);denied(f,{...last(f,'business'),revision:s.revision});});
    closure('RC-PS05-origin-source-direction-descriptors',()=>{const f=ready(), b=last(f,'business');denied(f,b,{});denied(f,b,undefined,'');denied(f,last(f,'ready'));denied(f,{...b,extra:true});denied(f,{type:'wbe-datalayer-event',payload:{event:'purchase'}});denied(f,{...b,revision:b.revision+1});denied(f,Object.assign(Object.create({foreign:true}),b));let reads=0;const x={};Object.defineProperty(x,'type',{enumerable:true,get(){reads++;return b.type;}});denied(f,x);const payload={};Object.defineProperty(payload,'event',{enumerable:true,get(){reads++;return 'purchase';}});denied(f,{...b,channel:'google',message:{type:'wbe-datalayer-event',payload}});const inherited=Object.create(b);denied(f,inherited);const wrongNested={...b,message:{...b.message,extra:true}};denied(f,wrongNested);assert.equal(reads,0,'no rejected getters may execute');});
    closure('RC-PS08-relay-duplicate-bind-no-head-reset',()=>{const f=ready(), b=last(f,'bind'), n=f.history.filter(x=>x.type===b.type).length;f.inject(b);f.pump();assert.equal(f.history.filter(x=>x.type===b.type).length,n,'bound duplicate must not reset actual heads');f.scripts[0].onload();assert(f.calls.some(x=>x[1]==='purchase'));const oldState=last(f,'state');f.api.setSuspendGoogleAds(true);f.pump();f.inject(b);f.pump();denied(f,oldState);const before=f.history.length;f.inject({type:'wbe-consent-deny',version:1});assert.equal(f.history.length,before+1);});
  }
  if(process.argv.includes('--head-duplicate')) for(const receiver of ['google','microsoft']) closure('RC-PS08-direct-'+receiver+'-duplicate-bind-OUTSIDE-OWNERSHIP',()=>{const f=ready();f.headInject(last(f,'bind'));f.pump();if(receiver==='microsoft'){f.scripts[0].onload();assert(f.calls.some(x=>x[1]==='purchase'),'actual Microsoft head duplicate BIND resets acknowledged OFF');}else{const n=f.head.dataLayer.filter(x=>x[0]==='event').length;f.headInject(last(f,'business'));assert.equal(f.head.dataLayer.filter(x=>x[0]==='event').length,n+1,'actual Google head duplicate BIND resets acknowledged OFF');}});
  if(process.argv.includes('--head-duplicate')) {
    function effects(f){return JSON.stringify([f.calls,Array.from(f.head.dataLayer).filter(x=>x[0]==='event')]);}
    function duplicate(f,b){const before=effects(f), timers=[...f.timers.entries()];f.headInject(b);assert.equal(effects(f),before,'BIND cannot replay positive effects');assert.deepStrictEqual([...f.timers.entries()],timers,'BIND cannot alter timers');f.pump();}
    closure('BC-PS08-bind-before-OFF',()=>{const f=fixture();f.pump();duplicate(f,last(f,'bind'));f.scripts[0].onload();f.tick();assert.equal(f.calls.length,0);f.api.setSuspendGoogleAds(false);f.pump();f.tick();assert.equal(f.calls.filter(x=>x[0]==='constructor').length,1);});
    closure('BC-PS08-bind-ON-OFF-watermark-dedup',()=>{const f=ready(), b=last(f,'bind'), old=last(f,'state'), business=f.history.filter(x=>x.type==='wbe-operational-business');f.api.setSuspendGoogleAds(true);f.pump();duplicate(f,b);f.headInject(old);f.scripts[0].onload();f.tick();assert.equal(f.calls.length,0);f.api.setSuspendGoogleAds(false);f.pump();duplicate(f,b);const current=last(f,'state');const before=effects(f);for(const x of business.filter(x=>x.channel==='microsoft'))f.headInject({...x,revision:current.revision});f.tick();assert.equal(effects(f),before,'BIND must preserve Microsoft transport dedup and cleared route');f.api.observeMicrosoftPage(()=>f.component);f.api.trackPurchase({transactionId:'after-bind',value:0,currency:'EUR'});f.pump();f.tick();assert.equal(f.calls.filter(x=>x[1]==='purchase').length,1);assert(f.calls.some(x=>x[1]==='purchase'&&x[2].transaction_id==='after-bind'));});
    closure('BC-PS08-bind-withdrawal',()=>{const f=ready();f.head.wbeAdvertisingWithdrawn=true;f.head.document.dispatchEvent(new Event('wbeAdvertisingWithdrawn'));duplicate(f,last(f,'bind'));const before=effects(f);f.scripts[0].onload();f.api.setSuspendGoogleAds(true);f.api.setSuspendGoogleAds(false);f.pump();f.tick();f.headInject(last(f,'business'));assert.equal(effects(f),before);});
    closure('BC-PS08-bind-tuple-fault',()=>{const f=ready(), b=last(f,'bind');f.headInject({...b,producerSession:b.producerSession==='f'.repeat(32)?'e'.repeat(32):'f'.repeat(32)});duplicate(f,b);const before=effects(f);f.headInject(last(f,'state'));f.headInject(last(f,'business'));f.scripts[0].onload();f.tick();assert.equal(effects(f),before,'different owner cannot reset retained heads');});
    for(const receiver of ['google','microsoft']) {
      closure('BC-PS08-'+receiver+'-bound-ACK-throw',()=>{const f=ready(), source=f.head.document.getElementById('wbeEventBridge').contentWindow, post=source.postMessage;source.postMessage=function(d,o){if(d.type==='wbe-operational-ack'&&d.phase==='bound'&&d.receiver===receiver)throw Error('bound ACK failure');return post(d,o);};duplicate(f,last(f,'bind'));source.postMessage=post;if(receiver==='microsoft'){f.scripts[0].onload();assert.equal(f.calls.filter(x=>x[1]==='purchase').length,1);}else{const n=f.head.dataLayer.filter(x=>x[0]==='event').length;f.headInject(last(f,'business'));assert.equal(f.head.dataLayer.filter(x=>x[0]==='event').length,n+1);}});
      closure('BC-PS08-'+receiver+'-state-ACK-recovery',()=>{const f=ready(), source=f.head.document.getElementById('wbeEventBridge').contentWindow, post=source.postMessage, s=last(f,'state');source.postMessage=function(d,o){if(d.type==='wbe-operational-ack'&&d.phase==='state'&&d.receiver===receiver)throw Error('state ACK failure');return post(d,o);};f.headInject(s);source.postMessage=post;duplicate(f,last(f,'bind'));if(receiver==='microsoft'){f.scripts[0].onload();assert.equal(f.calls.length,0);}else{const before=effects(f);f.headInject(last(f,'business'));assert.equal(effects(f),before);}f.headInject(s);f.pump();f.tick();if(receiver==='microsoft')assert.equal(f.calls.filter(x=>x[1]==='purchase').length,1);else{const n=f.head.dataLayer.filter(x=>x[0]==='event').length;f.headInject(last(f,'business'));assert.equal(f.head.dataLayer.filter(x=>x[0]==='event').length,n+1);}const before=effects(f);f.headInject(s);f.pump();f.tick();duplicate(f,last(f,'bind'));f.tick();assert.equal(effects(f),before,'successful state retry and BIND cannot replay drain/constructor');});
    }
  }
  console.log('Relay closure selected: '+count+' failures: '+failures);if(failures)process.exitCode=1;
}

// Pre-iframe negative recovery uses the actual four-source queued fixture.
if(process.argv.includes('--withdrawal-recovery')) {
  const setup=require('./verify-event-bridge.js').setup;
  const h=setup(), sends=[], post=h.bridge.postMessage;
  h.bridge.postMessage=function(d){sends.push(d);return post(d);};
  const state=()=>vm.runInContext('({withdrawn:microsoftWithdrawn,microsoft:microsoftQueue.length,google:googleQueue.length})',h.producer);
  h.observe('/');h.producer.trackPurchase({transactionId:'withdraw-retained',value:42,currency:'EUR'});
  assert(state().microsoft>0 && state().google>0);
  const lookup=h.parent.document.getElementById;
  h.parent.document.getElementById=()=>null;
  h.parent.wbeAdvertisingWithdrawn=true;h.emit({data:{}});
  assert.equal(state().withdrawn,false,'negative lost while iframe absent');
  h.parent.document.getElementById=lookup;
  h.connect();
  assert.equal(state().withdrawn,true,'F06 validated discovery must latch producer before business');
  assert.equal(state().microsoft,0);assert.equal(state().google,0);
  assert.equal(sends.filter(d=>d.type==='wbe-operational-business').length,0,'F06 no producer business before negative recovery');
  const probe=sends.find(d=>d.type==='wbe-operational-probe');assert(probe);
  const negative=()=>h.messages.filter(x=>x.data.type==='wbe-microsoft-withdrawn').length;
  let n=negative();
  for(const event of [{data:probe,source:{},origin:'https://bridge.synthetic.invalid'},{data:probe,source:h.frame,origin:'https://evil.invalid'},{data:{...probe,extra:true},source:h.frame,origin:'https://bridge.synthetic.invalid'}])h.emit(event);
  assert.equal(negative(),n,'invalid operational discovery cannot retrigger negative');
  let reads=0;const accessor={};Object.defineProperty(accessor,'producerSession',{enumerable:true,get(){reads++;return probe.producerSession;}});
  h.emit({data:{type:probe.type,version:1},source:h.frame,origin:'https://bridge.synthetic.invalid'});
  Object.defineProperties(accessor,{type:{value:probe.type,enumerable:true},version:{value:1,enumerable:true}});
  h.emit({data:accessor,source:h.frame,origin:'https://bridge.synthetic.invalid'});
  assert.equal(reads,0);assert.equal(negative(),n);
  for(let i=0;i<3;i++)h.emit({data:probe,source:h.frame,origin:'https://bridge.synthetic.invalid'});
  assert.equal(negative(),n+3,'one existing negative notification per validated repeated discovery');
  h.parent.wbeAdvertisingWithdrawn=false;
  h.producer.setSuspendGoogleAds(true);h.producer.setSuspendGoogleAds(false);
  h.observe('/booking-summary');h.producer.trackPurchase({transactionId:'cannot-revive',value:1});
  for(let i=0;i<7;i++)h.tick();
  assert.equal(state().withdrawn,true);assert.equal(state().microsoft,0);assert.equal(state().google,0);
  assert.equal(sends.filter(d=>d.type==='wbe-operational-business').length,0,'F06 no resumed producer business for either provider');
  assert.equal(h.timers.size,0);assert.equal(h.calls.length,0);assert.equal(h.google.length,0);
  assert.equal(h.parent.dataLayer.filter(x=>x[0]==='consent'&&x[1]==='update'&&Object.values(x[2]).includes('granted')).length,0);
  console.log('PASS | F06-P2-pre-iframe-negative-recovery-and-trusted-repeat-controls');
}

// Finite baseline-preservation coverage; stop at first RED, never edit runtime.
if(process.argv.includes('--coverage-closure')) {
  const cases=[];
  const add=(id,fn)=>cases.push([id,fn]);
  const last=(f,type)=>f.history.filter(x=>x.type==='wbe-operational-'+type).at(-1);
  const purchases=f=>f.calls.filter(x=>x[1]==='purchase');
  function ready(){const f=fixture();f.api.setSuspendGoogleAds(false);f.pump();f.tick();f.api.trackPurchase({transactionId:'retained',value:0,currency:'EUR'});f.pump();return f;}
  function noLate(f,loader){const n=f.head.dataLayer.filter(x=>x[0]==='event').length;loader();f.headInject(last(f,'business'));f.tick();assert.equal(f.calls.length,0);assert.equal(f.head.dataLayer.filter(x=>x[0]==='event').length,n);}
  add('CC01-PS09-same-WindowProxy-load',()=>{const f=ready(),frame=f.head.document.getElementById('wbeEventBridge'),source=frame.contentWindow,loader=f.scripts[0].onload;f.frameListeners.load.forEach(fn=>fn());assert.strictEqual(frame.contentWindow,source);noLate(f,loader);});
  add('CC02-PS09-element-replacement',()=>{const f=ready(),frame=f.head.document.getElementById('wbeEventBridge'),loader=f.scripts[0].onload;const replacement={contentWindow:frame.contentWindow,addEventListener(){}};assert.notStrictEqual(replacement,frame);f.head.document.getElementById=k=>k==='wbeEventBridge'?replacement:null;noLate(f,loader);});
  add('CC03-PS09-overlapping-head-evaluation',()=>{const f=ready(),loader=f.scripts[0].onload;const old=[f.head.__wbeOpGeneration_microsoft,f.head.__wbeOpGeneration_google];for(const i of [2,3]){const source=sources[i].replace("MICROSOFT_BRIDGE_ORIGIN = ''","MICROSOFT_BRIDGE_ORIGIN = 'https://bridge.synthetic.invalid'").replace("OPERATIONAL_BRIDGE_ORIGIN = ''","OPERATIONAL_BRIDGE_ORIGIN = 'https://bridge.synthetic.invalid'");vm.runInNewContext([...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n'),f.head,{filename:paths[i]});}assert.equal(f.head.__wbeOpGeneration_microsoft,old[0]+1);assert.equal(f.head.__wbeOpGeneration_google,old[1]+1);noLate(f,loader);});
  add('CC04-PS07-reentrant-constructor-ON',()=>{const f=ready();f.head.UET=function(){f.calls.push(['constructor']);this.push=(...a)=>f.calls.push(a);f.api.setSuspendGoogleAds(true);f.pump();};f.scripts[0].onload();assert.deepStrictEqual(f.calls,[['constructor']]);f.api.setSuspendGoogleAds(false);f.pump();f.api.observeMicrosoftPage(()=>f.component);f.pump();f.tick();assert.equal(f.calls.filter(x=>x[0]==='constructor').length,1);assert.equal(f.calls.filter(x=>x[0]==='pageLoad').length,1);assert.equal(purchases(f).length,0);});
  add('CC05-PS07-reentrant-pageLoad-UNRESOLVED',()=>{const f=ready();f.head.UET=function(){f.calls.push(['constructor']);this.push=(...a)=>{f.calls.push(a);if(a[0]==='pageLoad'){f.api.setSuspendGoogleAds(null);f.pump();}};};f.scripts[0].onload();assert.equal(purchases(f).length,0);f.api.setSuspendGoogleAds(false);f.pump();f.tick();assert.equal(f.calls.filter(x=>x[0]==='constructor').length,1);assert.equal(f.calls.filter(x=>x[0]==='pageLoad').length,1);assert.equal(purchases(f).length,1);assert.equal(purchases(f)[0][2].transaction_id,'retained');assert.equal(purchases(f)[0][2].revenue_value,0);assert.equal(purchases(f)[0][2].currency,'EUR');});
  add('CC06-PS07-reentrant-drain-withdrawal',()=>{const f=ready();f.api.trackPurchase({transactionId:'successor',value:12,currency:'USD'});f.pump();f.head.UET=function(){f.calls.push(['constructor']);this.push=(...a)=>{f.calls.push(a);if(a[1]==='purchase'){f.head.wbeAdvertisingWithdrawn=true;f.head.document.dispatchEvent(new Event('wbeAdvertisingWithdrawn'));}};};f.scripts[0].onload();f.pump();f.api.setSuspendGoogleAds(false);f.pump();f.tick();assert.equal(purchases(f).length,1);assert.equal(purchases(f)[0][2].transaction_id,'retained');});
  add('CC07-PS07-reentrant-state-ACK-load',()=>{const f=ready(),source=f.head.document.getElementById('wbeEventBridge').contentWindow,post=source.postMessage,loader=f.scripts[0].onload;let entries=0;source.postMessage=(d,o)=>{if(d.type==='wbe-operational-ack'&&d.phase==='state'){entries++;f.frameListeners.load.forEach(fn=>fn());}return post(d,o);};f.headInject(last(f,'state'));assert.equal(entries,1);noLate(f,loader);});
  add('CC08-PS06-stale-flight-exhaustion-late-ACK',()=>{const f=fixture();f.pump();f.hold('google');f.api.setSuspendGoogleAds(false);f.pump();const stale=[...f.timers.values()];f.api.setSuspendGoogleAds(null);f.pump();const n=f.history.length;stale.forEach(fn=>fn());assert.equal(f.history.length,n,'cancelled timers must not post obsolete state');const attempts=[],post=f.component.postMessage;f.component.postMessage=d=>{attempts.push(d);return post(d);};f.api.setSuspendGoogleAds(false);f.api.trackPurchase({transactionId:'late-bounded',value:0,currency:'EUR'});f.pump();const s=last(f,'state');for(let i=0;i<7;i++)f.tick();assert.equal(attempts.filter(x=>x.type===s.type&&x.revision===s.revision).length,5);assert.equal(f.timers.size,0);const before=f.history.length;f.api.initTracking(()=>f.component);assert.equal(f.history.length,before);f.release();f.tick();assert.equal(f.history.filter(x=>x.type==='wbe-operational-business').length,0);assert.equal(f.timers.size,0);});
  add('CC09-PS09-failed-lookup-old-callback',()=>{const f=fixture();f.pump();f.hold('google');f.api.setSuspendGoogleAds(false);f.api.trackPurchase({transactionId:'orphan',value:1});f.pump();const stale=[...f.timers.values()];f.api.initTracking(()=>{throw Error('missing component');});const n=f.history.length;stale.forEach(fn=>fn());f.release();f.tick();assert.equal(f.history.length,n);assert.equal(f.history.filter(x=>x.type==='wbe-operational-business').length,0);});
  add('CC10-PS05-producer-accessor-zero-reads',()=>{const f=fixture();f.pump();let reads=0;const data={};Object.defineProperty(data,'type',{enumerable:true,get(){reads++;return 'wbe-operational-ready';}});const n=f.history.length;f.producerInject(data);assert.equal(reads,0,'producer rejected opValid fallback must not read accessor type');assert.equal(f.history.length,n);
    for(const key of ['type','version']){const g=fixture();let count=0;const d={type:'wbe-microsoft-withdrawn',version:1};Object.defineProperty(d,key,{enumerable:true,get(){count++;return key==='type'?'wbe-microsoft-withdrawn':1;}});g.producerInject(d);assert.equal(count,0,'negative '+key+' getter must not execute');assert.equal(g.producerState().withdrawn,false);}
    for(const d of [Object.create({type:'wbe-microsoft-withdrawn',version:1}),{type:'wbe-microsoft-withdrawn',version:2},{type:'wbe-microsoft-ready',version:1},Object.defineProperty({type:'wbe-microsoft-withdrawn'},'version',{value:1})]){const g=fixture();g.api.trackPurchase({transactionId:'no-bypass',value:0,currency:'EUR'});g.producerInject(d);assert.equal(g.producerState().withdrawn,false);assert.equal(g.history.filter(x=>x.type==='wbe-operational-business').length,0);}
    for(const fault of [false,true]){const g=fixture();if(fault){g.api.initTracking(()=>({...g.component}));assert.equal(g.producerState().fault,true);}g.api.trackPurchase({transactionId:'negative-control',value:0,currency:'EUR'});assert(g.producerState().microsoft>0);assert(g.producerState().google>0);g.producerInject({type:'wbe-microsoft-withdrawn',version:1});assert.equal(g.producerState().withdrawn,true,'ordinary negative is synchronous even after control fault');assert.equal(g.producerState().microsoft,0);assert.equal(g.producerState().google,0);g.api.setSuspendGoogleAds(false);g.pump();g.tick();g.api.trackPurchase({transactionId:'sticky',value:1});assert.equal(g.producerState().withdrawn,true);assert.equal(g.producerState().microsoft,0);assert.equal(g.producerState().google,0);assert.equal(g.history.filter(x=>x.type==='wbe-operational-business').length,0);}
  });
  add('CC11-PS05-direct-head-nested-own-data',()=>{for(const channel of ['google','microsoft'])for(const inherited of [false,true]){const f=ready();f.scripts[0].onload();const b=f.history.filter(x=>x.type==='wbe-operational-business'&&x.channel===channel&&x.message.payload&&x.message.payload.event==='purchase').at(-1);let reads=0;const payload=inherited?Object.create({event:'purchase'}):{};if(!inherited)Object.defineProperty(payload,'event',{enumerable:true,get(){reads++;return 'purchase';}});const message={...b.message,payload};if(channel==='microsoft')message.id='coverage-nested-'+(inherited?'inherited':'accessor');console.log('ITERATION | CC11-'+channel+'-'+(inherited?'inherited':'accessor'));const n=JSON.stringify([f.calls,Array.from(f.head.dataLayer)]);f.headInject({...b,message});assert.equal(reads,0,channel+' rejected nested getter must not execute');assert.equal(JSON.stringify([f.calls,Array.from(f.head.dataLayer)]),n,channel+' inherited payload must not dispatch');}});
  add('CC12-PS05-direct-head-wrapper-prototype',()=>{for(const channel of ['google','microsoft']){const f=ready();f.scripts[0].onload();const b=f.history.filter(x=>x.type==='wbe-operational-business'&&x.channel===channel&&x.message.payload&&x.message.payload.event==='purchase').at(-1);const message={...b.message};if(channel==='microsoft')message.id='coverage-prototype';const candidate={...b,message};console.log('ITERATION | CC12-'+channel+'-wrapper-denials');const n=JSON.stringify([f.calls,Array.from(f.head.dataLayer)]);f.headInject(Object.create(candidate));f.headInject(Object.assign(Object.create({foreign:true}),candidate));assert.equal(JSON.stringify([f.calls,Array.from(f.head.dataLayer)]),n,channel+' unknown wrapper prototype must be denied');f.headInject(candidate);assert.notEqual(JSON.stringify([f.calls,Array.from(f.head.dataLayer)]),n,'own-data positive control');console.log('ITERATION | CC12-'+channel+'-ordinary-positive');const before=JSON.stringify([f.calls,Array.from(f.head.dataLayer)]);const nullMessage=Object.assign(Object.create(null),message,{payload:Object.assign(Object.create(null),message.payload,{transaction_id:"envelope-second",value:12,currency:"USD"})});if(channel==='microsoft')nullMessage.id='coverage-null-prototype';f.headInject(Object.assign(Object.create(null),candidate,{message:nullMessage}));assert.notEqual(JSON.stringify([f.calls,Array.from(f.head.dataLayer)]),before,'null-prototype own-data positive control');const sent=channel==='microsoft'?purchases(f).slice(-2).map(x=>[x[2].transaction_id,x[2].revenue_value,x[2].currency]):Array.from(f.head.dataLayer).filter(x=>x[0]==='event'&&x[1]==='purchase').slice(-2).map(x=>[x[2].transaction_id,x[2].value,x[2].currency]);assert.deepStrictEqual(sent,[['retained',0,'EUR'],['envelope-second',12,'USD']],'own-data provider identity/value/currency/order');console.log('ITERATION | CC12-'+channel+'-null-positive');}});
  assert.equal(cases.length,12);let attempted=0,passed=0;
  for(const [id,fn] of cases){attempted++;try{fn();passed++;console.log('PASS | '+id);}catch(e){console.error('FAIL | '+id+' | '+e.stack);process.exitCode=1;break;}}
  console.log('Coverage closure attempted: '+attempted+' passed: '+passed+' NOTRUN: '+(cases.length-attempted));
}

// Independent review's finite C1/C2/C3 ledger; no provider/network execution.
if(process.argv.includes('--finite-review')) {
 const cases=[],add=(id,f)=>cases.push([id,f]);
 const last=(f,t)=>f.history.filter(x=>x.type==='wbe-operational-'+t).at(-1);
 const effects=f=>JSON.stringify([f.calls,Array.from(f.head.dataLayer).filter(x=>x[0]==='event')]);
 for(const [hop,kind] of [['component','probe'],['component','bind'],['component','state'],['relay','probe'],['relay','bind'],['relay','state'],['relay','ready'],['relay','ack'],['head','discovery'],['head','ack']])for(const phase of ['before','after'])add('C1-'+hop+'-'+kind+'-'+phase,()=>{
  let failed=0;const attempts=[],errors=[];
  const f=fixture({listenerError(e){errors.push(e);},fault(h,p,d){if(h==='component'&&p==='before')attempts.push(d);if(h===hop&&p===phase&&d.type==='wbe-operational-'+kind&&failed===0){failed++;throw Error('inert control '+hop+' '+phase);}}});
  f.api.trackPurchase({transactionId:'control-retry',value:0,currency:'EUR'});f.api.setSuspendGoogleAds(false);f.pump();
  assert.equal(failed,1,'actual named hop reached');
  for(let i=0;i<7;i++)f.tick();f.scripts[0].onload();f.tick();
  assert.equal(f.calls.filter(x=>x[1]==='purchase').length,1,'bounded autonomous recovery');
  assert.equal(f.head.dataLayer.filter(x=>x[0]==='event'&&x[1]==='purchase').length,1);
  assert.equal(errors.length,hop==='head'&&kind==='discovery'?1:0,'browser listener exceptions recorded, not transport success');
  const groups=new Map();for(const d of attempts){const k=JSON.stringify(d);groups.set(k,(groups.get(k)||0)+1);}assert([...groups.values()].every(n=>n<=5));assert.equal(f.timers.size,0);
 });

 for(const hop of ['relay','head'])for(const receiver of ['google','microsoft'])for(const ackPhase of ['bound','state'])for(const phase of ['before','after'])add('C1-'+hop+'-'+receiver+'-'+ackPhase+'-ACK-'+phase,()=>{
  let failures=0;const attempts=[];
  const f=fixture({fault(h,p,d){if(h==='component'&&p==='before')attempts.push(d);if(h===hop&&p===phase&&d.type==='wbe-operational-ack'&&d.phase===ackPhase&&d.receiver===receiver&&!failures){failures++;throw Error('inert receipt failure');}}});
  f.api.trackPurchase({transactionId:'ack-retry',value:0,currency:'EUR'});f.api.setSuspendGoogleAds(false);f.pump();
  assert.equal(failures,1);for(let i=0;i<7;i++)f.tick();f.scripts[0].onload();f.tick();
  if(hop==='head'&&ackPhase==='state'&&phase==='after')console.log('TRACE | C1-'+receiver+'-state-ACK-after | '+JSON.stringify({attempts,history:f.history,calls:f.calls,google:Array.from(f.head.dataLayer).filter(x=>x[0]==='event'),timers:f.timers.size}));
  assert.equal(f.calls.filter(x=>x[1]==='purchase').length,1,'actual Microsoft purchase after ACK transport recovery');assert.equal(f.head.dataLayer.filter(x=>x[0]==='event'&&x[1]==='purchase').length,1);assert.equal(f.timers.size,0);
  const counts=new Map();for(const d of attempts){const k=JSON.stringify(d);counts.set(k,(counts.get(k)||0)+1);}assert([...counts.values()].every(n=>n<=5));
 });
 for(const hop of ['component','relay','head'])add('C1-'+hop+'-persistent-before-state-no-release',()=>{
  let failures=0;const attempts=[];
  const f=fixture({fault(h,p,d){if(h==='component'&&p==='before'&&d.type==='wbe-operational-state')attempts.push(d);if(h===hop&&p==='before'&&(hop==='head'?d.type==='wbe-operational-ack'&&d.phase==='state'&&d.receiver==='google':d.type==='wbe-operational-state')){failures++;throw Error('inert permanent failure');}}});
  f.api.setSuspendGoogleAds(false);f.api.trackPurchase({transactionId:'must-not-release',value:0,currency:'EUR'});f.pump();for(let i=0;i<7;i++)f.tick();f.scripts[0].onload();f.tick();assert(failures>0);assert.equal(attempts.length,5,'actual component state attempts');assert.equal(f.calls.filter(x=>x[1]==='purchase').length,0);assert.equal(f.head.dataLayer.filter(x=>x[0]==='event').length,0);assert.equal(f.history.filter(x=>x.type==='wbe-operational-business').length,0);assert.equal(f.timers.size,0);
 });
 for(const replaceRelay of [false,true])add('C2-fresh-producer-'+(replaceRelay?'fresh-relay':'retained-relay')+'-retained-heads',()=>{
  const f=fixture();f.api.setSuspendGoogleAds(false);f.pump();f.tick();const old=f.history.filter(d=>['wbe-operational-bind','wbe-operational-state','wbe-operational-ack','wbe-operational-ready'].includes(d.type));
  const before=effects(f);if(replaceRelay)f.freshRelay();const api=f.freshProducer();assert.notStrictEqual(api,f.api);api.observeMicrosoftPage(()=>f.component);api.trackPurchase({transactionId:'new-owner',value:0,currency:'EUR'});api.setSuspendGoogleAds(false);f.pump();
  for(const d of old){f.producerInject(d);f.headInject(d);}for(let i=0;i<7;i++)f.tick();f.scripts[0].onload();f.tick();assert.equal(f.calls.filter(x=>x[1]==='purchase').length,0,'fresh owner cannot deliver purchase into retained heads');assert.equal(f.head.dataLayer.filter(x=>x[0]==='event').length,0);assert.equal(f.history.filter(x=>x.type==='wbe-operational-business'&&x.message.payload&&x.message.payload.transaction_id==='new-owner').length,0);
  // Retained old OFF route may initialize UET: no instantaneous owner oracle is claimed.
  const fresh=fixture();fresh.api.setSuspendGoogleAds(false);fresh.api.trackPurchase({transactionId:'coordinated',value:0,currency:'EUR'});fresh.pump();fresh.tick();fresh.scripts[0].onload();fresh.tick();assert.equal(fresh.calls.filter(x=>x[1]==='purchase').length,1,'coordinated fresh contexts progress');
 });
 add('C3-actual-UET-all-funnel-mappings',()=>{
  const h=require('./verify-event-bridge.js').setup();h.observe('/');
  h.producer.trackViewBookingSearch();h.producer.trackRoomView({roomCode:'suite',nights:7});h.producer.trackBeginBooking({value:42,currency:'EUR',nights:7,guests:2,checkIn:'2026-09-07',checkOut:'2026-09-14'});h.producer.trackSearchNoResults({nights:7,checkIn:'2026-09-07'});h.producer.trackPurchase({transactionId:'zero',value:0,currency:'EUR'});h.producer.setSuspendGoogleAds(false);h.connect();h.complete();h.pump();
  assert.deepStrictEqual(h.calls.filter(x=>x[0]==='event'),[
   ['event','view_booking_search',{page_path:'/'}],['event','view_item',{page_path:'/',nights:7,room_code:'suite'}],['event','begin_checkout',{page_path:'/',revenue_value:42,currency:'EUR',nights:7,guests:2,check_in:'2026-09-07',check_out:'2026-09-14'}],['event','search_no_results',{page_path:'/',nights:7,check_in:'2026-09-07'}],['event','purchase',{page_path:'/',revenue_value:0,currency:'EUR',transaction_id:'zero'}]]);
 });
 for(const boundary of ['producer','google','microsoft'])add('C3-primitive-counter-version-tuple-'+boundary,()=>{
  const f=fixture();f.pump();f.hold('google');f.api.setSuspendGoogleAds(false);f.api.trackPurchase({transactionId:'matrix',value:0,currency:'EUR'});f.pump();
  const state=last(f,'state'),ack={...state,type:'wbe-operational-ack',receiver:'google',phase:'state'};
  // Direct heads have actual acknowledged OFF; producer's second receipt is held.
  const base=boundary==='producer'?ack:state;const send=boundary==='producer'?d=>f.producerInject(d):d=>f.headInject(d);
  const invalid=[null,undefined,true,false,0,1,'',[],new String('x'),{...base,version:'1'},{...base,version:2},{...base,type:1}];
  for(const k of ['revision','discardThrough'])for(const v of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'0',null,{},[]])invalid.push({...base,[k]:v});
  for(const k of ['producerSession','relayBoot','googleBoot','microsoftBoot'])for(const v of ['',null,[],{},new String(base[k]),base[k].toUpperCase(),'f'.repeat(31),'z'.repeat(32)])invalid.push({...base,[k]:v});
  invalid.push({...base,state:'bad'},{...base,discardThrough:base.revision+1},{...base,state:'ON',discardThrough:0});
  if(boundary==='producer')invalid.push({...base,receiver:'other'},{...base,receiver:new String('google')},{...base,phase:'other'},{...base,phase:new String('state')});
  const before=effects(f),n=f.history.length;for(const d of invalid)send(d);assert.equal(effects(f),before);assert.equal(f.history.length,n,'malformed traffic yields no ACK or producer release');
  f.release();f.tick();f.scripts[0].onload();f.tick();assert.equal(f.calls.filter(x=>x[1]==='purchase').length,1);assert.equal(f.head.dataLayer.filter(x=>x[0]==='event'&&x[1]==='purchase').length,1,'ordinary positive remains');
 });
 let passed=0;for(const [id,fn] of cases){try{fn();passed++;console.log('PASS | '+id);}catch(e){console.error('FAIL | '+id+' | '+e.stack);process.exitCode=1;}}
 console.log(JSON.stringify({finiteReview:cases.map(x=>x[0]),passed,total:cases.length}));
}

// Removed-item uncertainty must not starve never-dispatched successors.
if(process.argv.includes('--successor-review')) {
 for(const receiver of ['google','microsoft'])for(const mode of ['after','before','ON','withdrawal','replacement','UNRESOLVED']) {
  const id='ST-'+receiver+'-'+mode;
  try {
   let f,failed=0,attempts=0;const zero=new Set(),errors=[],entered=[];
   f=fixture({timer(fn,delay){if(delay===0)zero.add(fn);},fault(h,p,d){if(h==='head'&&p==='after'&&d.type==='wbe-operational-ack'&&d.phase==='state'&&d.receiver===receiver&&d.state==='OFF'&&!failed++){throw Error('ACK delivered then throw');}}});
   f.api.trackPurchase({transactionId:'never-replay-first',value:0,currency:'EUR'});
   f.api.trackPurchase({transactionId:'never-dispatched-second',value:12,currency:'USD'});
   f.api.setSuspendGoogleAds(false);f.pump();
   for(const [key,fn]of [...f.timers])if(zero.has(fn)){f.timers.delete(key);fn();}f.pump();
   const business=f.history.filter(x=>x.type==='wbe-operational-business'&&x.channel===receiver&&x.message.payload&&x.message.payload.event==='purchase');
   assert.deepStrictEqual([...new Set(business.map(x=>x.message.payload.transaction_id))],['never-replay-first','never-dispatched-second'],'both original envelopes actually handed to deferred head');
   const sent=()=>(receiver==='google'?Array.from(f.head.dataLayer):f.calls).filter(x=>x[0]==='event'&&x[1]==='purchase').map(x=>[x[2].transaction_id,receiver==='google'?x[2].value:x[2].revenue_value,x[2].currency]);
   assert.deepStrictEqual(sent(),[]);
   function callback(x,emit){
    if(x[0]!=='event'||x[1]!=='purchase')return emit();
    entered.push([x[2].transaction_id,receiver==='google'?x[2].value:x[2].revenue_value,x[2].currency]);
    if(attempts++)return emit();
    if(mode!=='before')emit();
    if(mode==='ON'){f.api.setSuspendGoogleAds(true);f.pump();}
    if(mode==='UNRESOLVED'){f.api.setSuspendGoogleAds(null);f.pump();}
    if(mode==='withdrawal'){f.head.wbeAdvertisingWithdrawn=true;f.head.document.dispatchEvent(new Event('wbeAdvertisingWithdrawn'));f.pump();}
    if(mode==='replacement'){const frame=f.head.document.getElementById('wbeEventBridge'),replacement={contentWindow:frame.contentWindow,addEventListener(){}};assert.notStrictEqual(replacement,frame);f.head.document.getElementById=()=>replacement;}
    throw Error('inert removed-item callback '+mode);
   }
   if(receiver==='google'){const push=f.head.dataLayer.push;f.head.dataLayer.push=function(x){return callback(x,()=>push.call(this,x));};}
   else f.head.UET=function(){f.calls.push(['constructor']);this.push=(...x)=>callback(x,()=>f.calls.push(x));};
   f.scripts[0].onload();
   function settle(){for(let i=0;i<9;i++){const batch=[...f.timers.values()];f.timers.clear();for(const fn of batch)try{fn();}catch(e){errors.push(e.message);}f.pump();}}
   settle();
   console.log('TRACE | '+id+' | '+JSON.stringify({sent:sent(),entered,errors,timers:f.timers.size,business}));
   const first=['never-replay-first',0,'EUR'],second=['never-dispatched-second',12,'USD'];
   assert.deepStrictEqual(sent(),mode==='after'?[first,second]:mode==='before'?[second]:[first],'never-dispatched successor progress only under current permission/lifecycle fences');
   assert.deepStrictEqual(entered,['after','before'].includes(mode)?[first,second]:[first],'uncertain first never replayed; fenced successor never invoked');
   assert.equal(f.timers.size,0);
   if(mode==='UNRESOLVED'){f.api.setSuspendGoogleAds(false);f.pump();settle();assert.deepStrictEqual(sent(),[first,second],'retained successor progresses only after fresh OFF');}
   if(mode==='ON'||mode==='withdrawal'){f.api.setSuspendGoogleAds(false);f.pump();settle();assert.deepStrictEqual(sent(),[first],'fresh OFF cannot resurrect cleared or withdrawn successors');}
   const stable=sent();settle();assert.deepStrictEqual(sent(),stable,'no duplicate timer replay');
   console.log('PASS | '+id);
  }catch(e){console.error('FAIL | '+id+' | '+e.stack);process.exitCode=1;}
 }
}

// ACK uncertainty owns only never-dispatched business; no provider-send retries.
if(process.argv.includes('--ack-throw-review')) {
 const purchases=(f,r)=>(r==='google'?Array.from(f.head.dataLayer):f.calls).filter(x=>x[0]==='event'&&x[1]==='purchase');
 for(const receiver of ['google','microsoft'])for(const mode of ['queued','reentrant','drain-reentrant','ON','withdrawal','persistent'])check('AT-'+receiver+'-'+mode,()=>{
  let failures=0,posts=0,f;const zero=new Set();
  function immediate(){for(const [id,fn] of [...f.timers])if(zero.has(fn)){f.timers.delete(id);fn();}f.pump();}
  f=fixture({timer(fn,delay){if(delay===0)zero.add(fn);},fault(h,p,d){if(h==='head'&&p==='after'&&d.type==='wbe-operational-ack'&&d.phase==='state'&&d.receiver===receiver&&d.state==='OFF'){
   posts++;if(!failures||mode==='persistent'){failures++;if(mode==='reentrant'){f.pump();immediate();}throw Error('delivered ACK then throw');}
  }}});
  f.api.trackPurchase({transactionId:'ack-first',value:0,currency:'EUR'});
  f.api.trackPurchase({transactionId:'ack-second',value:12,currency:'USD'});
  f.api.setSuspendGoogleAds(false);f.pump();immediate();
  assert.equal(purchases(f,receiver).length,0,'ambiguous ACK must not grant provider delivery');
  const business=f.history.filter(x=>x.type==='wbe-operational-business'&&x.channel===receiver);
  assert(business.some(x=>x.message.payload&&x.message.payload.transaction_id==='ack-first'),'producer consumed delivered receipt');
  let loaded=false;
  if(mode==='drain-reentrant'){
   let injected=false;const inject=()=>{if(injected)return;injected=true;f.api.trackPurchase({transactionId:'ack-third',value:3,currency:'CAD'});f.pump();};
   if(receiver==='google'){const push=f.head.dataLayer.push;f.head.dataLayer.push=function(x){const result=push.call(this,x);if(x[0]==='event'&&x[1]==='purchase')inject();return result;};}
   else f.head.UET=function(){f.calls.push(['constructor']);this.push=(...x)=>{f.calls.push(x);if(x[1]==='purchase')inject();};};
   f.scripts[0].onload();loaded=true;
  }
  if(mode==='ON'){f.api.setSuspendGoogleAds(true);f.pump();f.api.setSuspendGoogleAds(false);f.pump();}
  if(mode==='withdrawal'){f.head.wbeAdvertisingWithdrawn=true;f.head.document.dispatchEvent(new Event('wbeAdvertisingWithdrawn'));f.pump();f.api.setSuspendGoogleAds(false);f.pump();}
  for(let i=0;i<7;i++)f.tick();if(!loaded)f.scripts[0].onload();f.tick();
  const sent=purchases(f,receiver).map(x=>[x[2].transaction_id,receiver==='google'?x[2].value:x[2].revenue_value,x[2].currency]);
  assert.deepStrictEqual(sent,mode==='drain-reentrant'?[['ack-first',0,'EUR'],['ack-second',12,'USD'],['ack-third',3,'CAD']]:['queued','reentrant'].includes(mode)?[['ack-first',0,'EUR'],['ack-second',12,'USD']]:[],'retained original purchase order or negative clearing');
  if(mode==='persistent')assert.equal(posts,5,'bounded autonomous receiver ACK attempts');
  assert.equal(f.timers.size,0);
  const before=JSON.stringify(sent);for(let i=0;i<3;i++)f.tick();
  assert.equal(JSON.stringify(purchases(f,receiver).map(x=>[x[2].transaction_id,receiver==='google'?x[2].value:x[2].revenue_value,x[2].currency])),before,'no duplicate business retry');
 });
}
