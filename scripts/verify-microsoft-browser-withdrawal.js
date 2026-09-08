'use strict';
// Actual complete inline sources; inert DOM/UET only. No remote script execution.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const inline = p => [...read(p).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m => !/\bsrc=/.test(m[1])).map(m => m[2]).join('\n');
const microsoft = inline('velo/custom-code/microsoft-uet-and-events.html');
const google = inline('velo/custom-code/google-tag-and-consent.html');
const key = 'wbe_consent_choice';
const tests = [];
function test(id, run) { tests.push({id, run}); }
function harness(o = {}) {
  o.frame ||= {contentWindow:{}};
  let messageId=0;
  const bridgeOrigin='https://bridge.synthetic.invalid';
  const listeners = {}, nodes = [], loaders = [], calls = [], writes = [];
  const storage = o.storage || new Map(o.choice === undefined ? [] : [[key, o.choice]]);
  const emit = (type, e = {}) => (listeners[type] || []).forEach(fn => fn(e));
  const listen = (type, fn) => (listeners[type] ||= []).push(fn);
  function element(tag) {
    const handlers = {};
    const el = {tag, style:{}, children:[], setAttribute(){}, addEventListener(t,f){handlers[t]=f;}, click(){handlers.click();},
      appendChild(n){this.children.push(n);n.parentNode=this;}, removeChild(n){if(o.domError)throw Error('DOM');n.parentNode=null;}};
    nodes.push(el); return el;
  }
  const document = {readyState:'complete', body:element('body'), createElement:element, addEventListener:listen,
    dispatchEvent(e){if(o.notificationError)throw Error('notification');emit(e.type,e);},
    getElementById(id){if(o.domError)throw Error('DOM');return id === 'wbeEventBridge' ? o.frame : nodes.find(n=>n.id===id && n.parentNode);},
    getElementsByTagName(){return [{parentNode:{insertBefore(s){loaders.push(s);}}}];}};
  const localStorage = {getItem(k){if(o.readError)throw Error('read');return storage.get(k) ?? null;},setItem(k,v){writes.push([k,v]);if(o.writeError)throw Error('write');storage.set(k,v);}};
  const w = {document,localStorage,location:{origin:'https://www.wanderlustcaribbean.com',pathname:'/booking',href:'https://www.wanderlustcaribbean.com/?msclkid=public-fixture'},
    addEventListener:listen, console:{log(){}}, Event:class {constructor(type){this.type=type;}}, dataLayer:[]};
  w.window=w;
  w.UET=function(options){calls.push(['constructor',options.enableAutoSpaTracking]);if(o.onConstruct)o.onConstruct(w);this.push=(...args)=>{calls.push(JSON.parse(JSON.stringify(args)));if(o.onPush)o.onPush(args,w);};};
  const context=vm.createContext(w);
  function runGoogle(){let code=o.google || google;if(o.enabled)code=code.replace('var BANNER_ENABLED = false;', 'var BANNER_ENABLED = true;');vm.runInContext(code,context);}
  function trusted(data){emit('message',{data,origin:bridgeOrigin,source:o.frame.contentWindow});}
  function runMicrosoft(){vm.runInContext((o.microsoft || microsoft).replace("var MICROSOFT_BRIDGE_ORIGIN = '';",`var MICROSOFT_BRIDGE_ORIGIN = '${bridgeOrigin}';`),context);trusted({type:'wbe-microsoft-message',version:1,id:'initial',kind:'route',page_path:'/wanderlust-booking',payload:null});}
  function complete(){for(const s of loaders){const fn=s.onload || s.onreadystatechange;if(fn){fn.call(s);fn.call(s);}}}
  const h={w,o,storage,calls,writes,loaders,emit,runGoogle,runMicrosoft,complete,
    message(payload){trusted({type:'wbe-microsoft-message',version:1,id:'event-'+(++messageId),kind:'event',page_path:'/wanderlust-booking',payload});},
    deny(){w.wbeWithdrawConsent();},
    button(label){return nodes.find(n=>n.textContent===label);},
    events(){return calls.filter(c=>c[0]==='event');}};
  return h;
}
function stored(code=microsoft){const h=harness({choice:'denied',microsoft:code});h.runMicrosoft();h.complete();assert.equal(h.loaders.length,0,'CAUSAL: stored denial blocks loader');assert.equal(h.calls.length,0);}
test('M01',()=>stored());
test('M02',()=>{for(const order of ['google','microsoft'])for(const writeError of [false,true]){const h=harness({writeError});if(order==='google'){h.runGoogle();h.deny();h.runMicrosoft();}else{h.runMicrosoft();h.message({event:'purchase'});h.runGoogle();h.deny();}assert.equal(h.w.wbeAdvertisingWithdrawn,true,'CAUSAL: actual denial publishes sticky negative');h.complete();h.message({event:'purchase'});h.message({event:'begin_booking'});assert.equal(h.calls.length,0,'CAUSAL: queued and later purchase suppressed');}});
test('M03',()=>{const h=harness();h.runGoogle();h.runMicrosoft();h.message({event:'purchase'});h.message({event:'room_view'});h.deny();h.complete();h.complete();assert.deepEqual(h.calls,[]);const c=harness();c.runMicrosoft();c.complete();c.complete();assert.deepEqual(c.calls,[['constructor',false],['pageLoad']]);});
const actions=['view_booking_search','room_view','begin_booking','search_no_results','purchase','custom'];
function readyDenied(code=microsoft){const h=harness({microsoft:code,writeError:true});h.runGoogle();h.runMicrosoft();h.complete();h.message({event:'purchase',value:1});assert.equal(h.events().length,1);h.deny();for(const event of actions)h.message({event});assert.equal(h.events().length,1,'CAUSAL: later mapped events suppressed');}
test('M04',()=>readyDenied());
function drain(code=microsoft){let n=0;const h=harness({microsoft:code,onPush(args,w){if(args[0]==='event' && ++n===1)w.wbeAdvertisingWithdrawn=true;}});h.runMicrosoft();h.message({event:'purchase'});h.message({event:'room_view'});h.complete();h.message({event:'purchase'});assert.equal(h.events().length,1,'CAUSAL: per-item drain fence');}
test('M05',()=>{drain();let n=0;const h=harness({onPush(args,w){if(args[0]==='event' && ++n===1)w.wbeWithdrawConsent();}});h.runGoogle();h.runMicrosoft();h.message({event:'purchase'});h.message({event:'room_view'});h.complete();h.message({event:'purchase'});assert.equal(h.events().length,1);});
test('M06',()=>{for(const mode of ['stored','latch','constructor']){const h=harness({onConstruct:mode==='constructor'?w=>{w.wbeAdvertisingWithdrawn=true;}:undefined});h.runMicrosoft();h.message({event:'purchase'});if(mode==='stored')h.storage.set(key,'denied');if(mode==='latch')h.w.wbeAdvertisingWithdrawn=true;h.complete();h.complete();assert.equal(h.events().length,0);assert.equal(h.calls.filter(c=>c[0]==='pageLoad').length,0);assert.equal(h.calls.filter(c=>c[0]==='constructor').length,mode==='constructor'?1:0);}});
test('M07',()=>{for(const [k,v] of [[key,'denied'],[null,null],[key,null],[key,'{bad'],[key,'granted']]){const h=harness({choice:'granted'});h.runMicrosoft();h.complete();const before=h.writes.length;h.emit('storage',{key:k,newValue:v,storageArea:h.w.localStorage});assert.equal(h.writes.length,before);assert.equal(h.w.localStorage.getItem(key),'granted');h.w.wbeAdvertisingWithdrawn=false;h.message({event:'purchase'});assert.equal(h.events().length,0,'standalone readable storage private latch');}const h=harness();h.runMicrosoft();h.complete();h.emit('storage',{key:'other'});h.emit('storage',{key,storageArea:{}});h.message({event:'purchase'});assert.equal(h.events().length,1);const fail=harness({readError:true});fail.runMicrosoft();assert.equal(fail.loaders.length,0);});
test('M08',()=>{for(const choice of [undefined,'granted']){const h=harness({choice,enabled:true});h.runGoogle();h.runMicrosoft();h.complete();h.button('Accept All').click();h.emit('wbeConsentGranted',{detail:{status:'NOT_REQUIRED'}});h.emit('wbeAdvertisingWithdrawn');assert.notEqual(h.w.wbeAdvertisingWithdrawn,true,'bare notification is not negative authority');h.deny();h.button('Accept All').click();h.message({event:'purchase',consent:'granted'});assert.equal(h.events().length,0);assert.ok(h.calls.every(c=>c[0]!=='consent'));}});
function publication(code=google){const h=harness({google:code,writeError:true});h.runGoogle();h.runMicrosoft();h.complete();h.deny();assert.equal(h.w.wbeAdvertisingWithdrawn,true,'CAUSAL: negative publisher');h.message({event:'purchase'});assert.equal(h.events().length,0);}
test('M09',()=>{publication();for(const mode of ['tag','storage','dom','notification']){const h=harness({enabled:true,writeError:mode==='storage'});h.runGoogle();h.button('Accept All').click();h.runMicrosoft();h.complete();if(mode==='tag')h.w.gtag=(...a)=>{if(a[0]==='consent')throw Error('tag');};if(mode==='dom')h.o.domError=true;if(mode==='notification')h.o.notificationError=true;assert.doesNotThrow(()=>h.deny());h.message({event:'purchase'});assert.equal(h.events().length,0);assert.equal(h.w.wbeAdvertisingWithdrawn,true);}});
test('M10',()=>{const command={type:'wbe-consent-deny',version:1};const site='https://www.wanderlustcaribbean.com',origin='https://bridge.synthetic.invalid';function setup(enabled=true){const frame={};const h=harness({frame:{contentWindow:frame},google:enabled?google.replace("var DENIAL_BRIDGE_ORIGIN = '';",`var DENIAL_BRIDGE_ORIGIN = '${origin}';`):google});h.runGoogle();h.runMicrosoft();h.complete();frame.parent=h.w;const sent=[];h.w.postMessage=(data,target)=>{sent.push({data,target});h.emit('message',{data,origin,source:frame});};vm.runInNewContext(inline('velo/custom-code/event-bridge-iframe.html'),{window:frame});return {h,frame,sent,relay(data=command){frame.onmessage({data,source:h.w,origin:site});}};}const t=setup();t.relay();assert.equal(t.h.w.wbeAdvertisingWithdrawn,true);t.h.message({event:'purchase'});assert.equal(t.h.events().length,0);assert.deepEqual(JSON.parse(JSON.stringify(t.sent)),[{data:command,target:site}]);for(const mode of ['origin','source','frame','version','extra','disabled','site','message-name']){const t=setup(mode!=='disabled');if(mode==='frame')t.h.o.frame={contentWindow:{}};if(mode==='site')t.h.w.location.origin='https://evil.invalid';let data=mode==='version'?{...command,version:2}:mode==='extra'?{...command,extra:true}:mode==='message-name'?{type:'wbeAdvertisingWithdrawn'}:command;t.h.emit('message',{data,origin:mode==='origin'?'https://evil.invalid':origin,source:mode==='source'?{}:t.frame});assert.notEqual(t.h.w.wbeAdvertisingWithdrawn,true,mode);}for(const field of ['origin','source']){const t=setup();t.frame.onmessage({data:command,source:t.h.w,origin:site,[field]:field==='source'?{}:'https://evil.invalid'});assert.equal(t.sent.length,0);}assert.ok(google.includes("var DENIAL_BRIDGE_ORIGIN = '';"));});
test('M11',()=>{const h=harness();h.runGoogle();h.runMicrosoft();h.complete();const mapping=['view_booking_search','view_item','begin_checkout','search_no_results','purchase','custom'];actions.forEach((event,i)=>{h.message({event,value:42,currency:'USD',transaction_id:'public-fixture',nights:3,guests:2,check_in:'fixture-in',check_out:'fixture-out',room_code:'fixture-room'});assert.deepEqual(h.events().at(-1),['event',mapping[i],{page_path:'/wanderlust-booking',revenue_value:42,currency:'USD',transaction_id:'public-fixture',nights:3,guests:2,check_in:'fixture-in',check_out:'fixture-out',room_code:'fixture-room'}]);});h.deny();const before=h.calls.length;for(const event of actions)h.message({event,consent:'granted'});h.emit('message',{data:{type:'wbe-consent-grant',version:1},origin:h.w.location.origin,source:h.w});assert.equal(h.calls.length,before);});
test('M12',()=>{const h=harness({enabled:true});h.runGoogle();h.runMicrosoft();h.complete();h.deny();const reload=harness({storage:h.storage});reload.runMicrosoft();assert.equal(reload.loaders.length,0);h.button('Accept All').click();h.storage.clear();h.w.wbeAdvertisingWithdrawn=false;h.message({event:'purchase'});assert.equal(h.events().length,0,'private page latch survives public overwrite and lost storage');const lost=harness();lost.runMicrosoft();assert.equal(lost.loaders.length,1,'LIMIT: fresh context cannot recover lost custody; not consent authority');assert.ok(lost.calls.every(c=>c[0]!=='consent'));});
test('M13',()=>require('./verify-event-bridge.js').run());
function replaceOnce(s,a,b){assert.equal(s.split(a).length,2,'unique mutation');return s.replace(a,b);}
function kill(label,code,witness){new vm.Script(code);let e;try{witness(code);}catch(error){e=error;}assert.ok(e instanceof assert.AssertionError && e.message.includes('CAUSAL:'),label+' must fail semantic assertion');console.log('KILLED | '+label+' | sha256='+require('node:crypto').createHash('sha256').update(code).digest('hex'));}
function spaFence(code=microsoft){const h=harness({microsoft:code});h.runMicrosoft();h.complete();let reads=0;const data={type:'wbe-microsoft-message',version:1,id:'spa-fence',kind:'route',payload:null,get page_path(){if(++reads===2)h.w.wbeAdvertisingWithdrawn=true;return '/';}};h.emit('message',{data,origin:'https://bridge.synthetic.invalid',source:h.o.frame.contentWindow});assert.equal(h.events().length,0,'CAUSAL: manual SPA push fence after route read');}
function sendFence(code=microsoft){const h=harness({microsoft:code});h.runMicrosoft();h.complete();const payload={event:'purchase',get value(){h.w.wbeAdvertisingWithdrawn=true;return 42;}};h.message(payload);assert.equal(h.events().length,0,'CAUSAL: send fence after payload read');}
function queueFence(code=microsoft){
  // Test-only observation of the real private queue, never a production API.
  code=replaceOnce(code,'var pendingEvents = [];','var pendingEvents = []; w.__queueCount = function () { return pendingEvents.length; };');
  const h=harness({microsoft:code,writeError:true});h.runGoogle();h.runMicrosoft();
  h.message({event:'purchase'});assert.equal(h.w.__queueCount(),1);
  h.deny();assert.equal(h.w.__queueCount(),0,'CAUSAL: actual withdrawal empties owned queue');
  h.message({event:'purchase'});assert.equal(h.w.__queueCount(),0,'CAUSAL: withdrawn work never re-enqueues');
  h.complete();assert.equal(h.calls.length,0);
  const q=harness({microsoft:code});q.runMicrosoft();
  q.message({event:'purchase',get value(){q.w.wbeAdvertisingWithdrawn=true;return 42;}});
  assert.equal(q.w.__queueCount(),0,'CAUSAL: enqueue fence after payload read');
}
const m03=tests.find(t=>t.id==='M03').run;
tests.find(t=>t.id==='M03').run=()=>{m03();queueFence();};
function constructorFlag(code=microsoft){const h=harness({microsoft:code});h.runMicrosoft();h.complete();assert.deepEqual(h.calls,[['constructor',false],['pageLoad']],'CAUSAL: ordinary constructor disables automatic SPA');}
test('M14',()=>{constructorFlag();kill('constructor false-to-true',replaceOnce(microsoft,'enableAutoSpaTracking: false','enableAutoSpaTracking: true'),constructorFlag);queueFence();kill('enqueue boundary',replaceOnce(microsoft,'function sendEvent(action, params) {\n      if (isWithdrawn()) return;','function sendEvent(action, params) {'),queueFence);stored();drain();publication();sendFence();kill('send/enqueue boundary',replaceOnce(microsoft,'function sendEvent(action, params) {\n      if (isWithdrawn()) return;','function sendEvent(action, params) {'),sendFence);kill('drain boundary',replaceOnce(microsoft,'sendEvent(pendingEvents[i][0], pendingEvents[i][1]);',"w[queueName].push('event', pendingEvents[i][0], pendingEvents[i][1]);"),drain);let loader=replaceOnce(microsoft,'    if (isWithdrawn()) return;\n    var script','    var script');loader=replaceOnce(loader,'    if (isWithdrawn()) return;\n    firstScript.parentNode','    firstScript.parentNode');kill('loader boundary',loader,stored);kill('negative publication',replaceOnce(google,'    window.wbeAdvertisingWithdrawn = true;','    void 0;'),publication);spaFence();kill('manual SPA boundary',replaceOnce(microsoft,'function sendEvent(action, params) {\n      if (isWithdrawn()) return;','function sendEvent(action, params) {'),spaFence);});
test('M15',()=>{const {spawnSync}=require('node:child_process');for(const file of ['verify-google-consent-transitions.js','verify-guest-consent-browser-ingress.js']){const result=spawnSync(process.execPath,[path.join(__dirname,file)],{encoding:'utf8',timeout:60000});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');assert.equal(result.status,0,file+' real child exit');}for(const source of [google,microsoft])assert.doesNotMatch(source,/guestConsent|wbe_browser_negative_v1|fetch\s*\(|XMLHttpRequest|sendBeacon|import\s/);});
assert.deepEqual(tests.map(t=>t.id),Array.from({length:15},(_,i)=>'M'+String(i+1).padStart(2,'0')));
let failed=0, pending=0;
for(const {id,run} of tests){if(!run){pending++;console.log('NOT RUN | '+id+' | provider SPA contract pending');continue;}try{run();console.log('PASS | '+id);}catch(e){failed++;console.error('FAIL | '+id+' | '+e.stack);}}
console.log(`${tests.length-failed-pending} complete IDs, ${failed} failed, ${pending} NOT RUN`);
process.exitCode=failed?1:0;
