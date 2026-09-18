'use strict';
// Inert actual Summary -> tracking -> HTML component -> head. No Google loader.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const inline = p => read(p).match(/<script>([\s\S]*?)<\/script>/)[1];
const support = read('tests/attribution-hotfix.cjs').split('function bookingBackend')[0];
const sandbox = { require, __dirname: path.join(root, 'tests'), console };
vm.runInNewContext(support + '\nthis.makePage=page;', sandbox);
async function fixture(opts = {}) {
  const logs = [], messages = [], listeners = {}, buttons = {}, store = new Map();
  if (opts.stored) for (const [k,v] of Object.entries(opts.stored)) store.set(k,v);
  const field = { value: 'fixture@example.invalid' };
  let workerListener;
  const workerStore = new Map();
  const frame = {}, parent = {}, frameElement = { contentWindow: frame, src: 'https://fixture.invalid/bridge', isConnected: true };
  const handlers = new Map(), createdElements = [], documentListeners = {};
  const element = () => { const el = { style: {}, children: [], parentNode: null,
    appendChild(child) { this.children.push(child); child.parentNode=this; },
    removeChild(child) { this.children.splice(this.children.indexOf(child),1); child.parentNode=null; },
    setAttribute() {}, addEventListener(t,f) { if(t==='click') { handlers.set(this,f); buttons[this.textContent]=event=>{ assert.ok(attached(this),'cannot click detached '+this.textContent); f(event); }; } } }; createdElements.push(el); return el; };
  const body=element();
  const attached = el => el===body || !!el.parentNode && attached(el.parentNode);
  const visit = (el,id) => el.id===id ? el : el.children.map(c=>visit(c,id)).find(Boolean);
  const click = label => { const entry=[...handlers].find(([el])=>attached(el)&&el.textContent===label); assert.ok(entry,'attached button: '+label); entry[1]({isTrusted:true}); };
  const document = { readyState: opts.readyState || 'complete', body, addEventListener(t,f) { (documentListeners[t] ||= []).push(f); }, getElementById(id) { return visit(body,id)||null; }, createElement: element,
    querySelectorAll(s) { return s === 'iframe[title="WBE event bridge"]' ? [frameElement] : opts.missingField ? [] : [field]; } };
  const window = { dataLayer: opts.priorDataLayer || [], location: { href: 'https://www.wanderlustcaribbean.com'+(opts.route || '/booking-summary') }, addEventListener(t, f) { (listeners[t] ||= []).push(f); } };
  const deny = () => { throw Error('OFFLINE_NETWORK_DENIED'); };
  const head = vm.createContext({ crypto:require('node:crypto').webcrypto, window, document, localStorage: { getItem:k=>{if(opts.storageReadFails)throw Error('inert storage read failure');return store.get(k)||null;}, removeItem:k=>store.delete(k), setItem:(k,v)=>{if(opts.storageWriteFails)throw Error('inert storage failure');store.set(k,v);} }, console:{ log:(...x)=>logs.push(x), error:(...x)=>logs.push(x) }, URL, fetch:deny, XMLHttpRequest:deny, Image:deny, WebSocket:deny });
  Object.defineProperty(head, 'dataLayer', { get:()=>window.dataLayer });
  let headSource = inline(opts.headFile || 'velo/custom-code/google-tag-and-consent.html');
  // Packaging removes whitespace only; retain explicit synthetic banner-ON coverage
  // against the deployable artifact and fail if either fixture seam disappears.
  if (!opts.automatic) {
    assert.match(headSource, /var BANNER_ENABLED\s*=\s*false;/);
    assert.match(headSource, /var GRANT_ALL_WITHOUT_BANNER\s*=\s*true;/);
    headSource = headSource.replace(/var BANNER_ENABLED\s*=\s*false;/, 'var BANNER_ENABLED=true;').replace(/var GRANT_ALL_WITHOUT_BANNER\s*=\s*true;/, 'var GRANT_ALL_WITHOUT_BANNER=false;');
  }
  if (opts.now !== undefined) vm.runInContext('Date.now=()=>'+opts.now,head);
  vm.runInContext(headSource, head);
  const dispatch = (data, overrides={}) => { for (const f of listeners.message || []) f({data, source:frame, origin:'https://fixture.invalid',...overrides}); };
  parent.postMessage = data => { messages.push(JSON.parse(JSON.stringify(data))); if (!opts.pause) { if(data.source) dispatch(data); else if(workerListener) workerListener({data}); } };
  const iframe = vm.createContext({ window:{parent}, document:{referrer:'https://www.wanderlustcaribbean.com/'}, URL });
  vm.runInContext(inline('velo/custom-code/event-bridge-iframe.html'), iframe);
  frame.postMessage = data => iframe.window.onmessage({data,source:parent,origin:'https://www.wanderlustcaribbean.com'});
  const context = vm.createContext({crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,console:{log:(...x)=>logs.push(x),warn(){},error(){}}});
    // Keep existing form begin/complete schedules separate from attribution
    // reads; both still execute the same actual backend policy implementation.
    const policyCalls=[], attributionPolicyCalls=[];
    const policyContext=new (require('node:async_hooks').AsyncLocalStorage)();
    context.sdkFind = async () => {
      if(policyContext.getStore()==='attribution') attributionPolicyCalls.push([]);
      else {policyCalls.push([]);if(opts.policyRead) await opts.policyRead(policyCalls.length);}
      if(opts.policyRows === 'error') throw Error('inert policy failure');
      return JSON.stringify(opts.policyRows || []);
    };
    vm.runInContext(`const sdk={query(){return {ascending(){return this},limit(){return this},async find(){const items=JSON.parse(await sdkFind());return {items,hasNext(){return false}}}}}}`,context);
    const cache=new Map();
    async function load(spec, ref) {
      if(spec==='backend/adsFormRequirement.web' && ref?.identifier==='public/clickAttribution') {
        return new vm.SyntheticModule(['getAdsFormRequirement'],function(){
          this.setExport('getAdsFormRequirement',()=>policyContext.run('attribution',()=>cache.get(spec).namespace.getAdsFormRequirement()));
        },{context});
      }
      if(cache.has(spec))return cache.get(spec);
      let m;
      if(spec.startsWith('backend/') || spec === 'public/clickAttribution') {
        m=new vm.SourceTextModule(read('velo/'+spec+'.js'),{context,identifier:spec});cache.set(spec,m);return m;
      }
      let values;
      if(spec==='wix-data') values={default:vm.runInContext('sdk',context)};
      else if(spec==='wix-web-module') values={Permissions:{Anyone:'Anyone'},webMethod:(_,fn)=>async(...args)=>{
        assert.equal(args.length,0,'no contact or caller policy authority');
        const result=await fn(...args);
      if(opts.policyResult)return opts.policyResult(JSON.parse(JSON.stringify(result)),policyCalls.length);
        return opts.policyRows === undefined ? {v:1,requirement:'REQUIRED',policyKey:'a'.repeat(64),observedAt:Date.now()} : JSON.parse(JSON.stringify(result));
      }};
      else if(spec==='crypto') values={createHash:require('node:crypto').createHash};
      else if(spec==='wix-storage-frontend') values={local:{getItem:k=>workerStore.get(k)||null,setItem:(k,v)=>workerStore.set(k,v),removeItem:k=>workerStore.delete(k)}};
      else if(spec==='wix-location-frontend') values={default:{url:'',query:{}}};
      else throw Error('unapproved import '+spec);
      m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context});cache.set(spec,m);return m;
    }
    const tracking = new vm.SourceTextModule(read('velo/public/tracking.js'), {context});
    await tracking.link(load);
  await tracking.evaluate();
  const names = read('velo/page-booking-summary.js').match(/import \{([^}]+)\} from 'public\/tracking';/)[1].split(',').map(x=>x.trim());
  for (const name of names) assert.equal(typeof tracking.namespace[name],'function','real tracking import: '+name);
  const p = await sandbox.makePage({book:opts.book});
  p.w('#wbeEventBridge').onMessage = fn => {workerListener=fn;};
  p.w('#wbeEventBridge').postMessage = data => { messages.push(JSON.parse(JSON.stringify(data))); iframe.window.onmessage({data,source:parent,origin:'https://www.wanderlustcaribbean.com'}); };
  tracking.namespace.initTracking(p.w);
  for (const k of Object.getOwnPropertyNames(tracking.namespace)) p.c[k] = tracking.namespace[k];
  if(opts.suspended) tracking.namespace.setSuspendGoogleAds(true);
  if(opts.invalid) p.w('#inputGuestEmail').value = 'invalid';
  if(opts.consent === 'yes') buttons['Accept All']?.({isTrusted:true});
  if(opts.consent === 'synthetic') buttons['Accept All']?.({isTrusted:false});
  if(opts.consent === 'no') buttons.Deny?.({isTrusted:true});
  const settle=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
  return {createdElements,documentListeners,policyCalls,attributionPolicyCalls,tracking,settle,store,listeners,iframe,frameElement,document,click,p,head,window,buttons,messages,logs,field,dispatch,events:()=>window.dataLayer.filter(x=>x[0]==='event'), submit:async()=>{await p.click();await p.click();await settle();}};
}
(async()=>{
  const f = await fixture({consent:'yes'}); await f.submit();
  assert.equal(f.events().filter(x=>x[1]==='form_submit').length,1,'successful affirmative booking must emit exactly one AW handoff');
  assert.deepEqual(JSON.parse(JSON.stringify(f.events().find(x=>x[1]==='form_submit')[2])),{send_to:'AW-788746633'});
  console.log('PASS actual linked successful affirmative submit');
  for (const options of [{consent:'no'},{},{automatic:true},{consent:'synthetic'},{consent:'yes',invalid:true},{consent:'yes',suspended:true},{consent:'yes',missingField:true},{consent:'yes',book:async()=>{throw Error('inert failure');}},{consent:'yes',book:async(p,n)=> n===2?{outcome:'UNKNOWN'}:undefined}]) {
    const x = await fixture(options); await x.submit();
    assert.equal(x.events().filter(e=>e[1]==='form_submit').length,0);
  }
  console.log('PASS deny/unknown/automatic/synthetic/invalid/suspended/missing field/failure/partial');
  for (const mode of ['withdraw','regrant','field','pageEmail','googleDenied']) {
    let release, entered;
    const ready = new Promise(r=>entered=r), pause = new Promise(r=>release=r);
    const x = await fixture({consent:'yes',book:async(_,n)=>{if(n===1){entered();await pause;}}});
    const watchdog=setTimeout(()=>{throw Error('paused test timed out');},5000);
    try {
      const pending=x.p.click(); await ready;
      await x.settle(); // Policy prepare is now asynchronous; change the selector after its actual snapshot.
      await x.p.click(); // actual duplicate while booking awaits
      if(mode==='withdraw'||mode==='regrant') { x.buttons['Cookie settings']({isTrusted:true}); x.buttons.Deny({isTrusted:true}); }
      if(mode==='regrant') { x.buttons['Cookie settings']({isTrusted:true}); x.buttons['Accept All']({isTrusted:true}); }
      if(mode==='field') x.field.value='changed@example.invalid';
      if(mode==='pageEmail') x.p.w('#inputGuestEmail').value='changed@example.invalid';
      if(mode==='googleDenied') vm.runInContext("gtag('consent','update',{ad_user_data:'denied'})",x.head);
      release(); await pending; await x.settle();
      assert.equal(x.events().filter(e=>e[1]==='form_submit').length,0,mode);
      assert.equal(x.p.payloads.length,2,'tracking cannot block booking');
    } finally {release();clearTimeout(watchdog);}
  }
  console.log('PASS stale consent, changed email, duplicate pending and external denial');
  for(const d of f.messages.filter(d=>d.source==='wbe-ads-form')) f.dispatch(d);
  assert.equal(f.events().filter(e=>e[1]==='form_submit').length,1,'replayed pair cannot send again');
  const sent = JSON.stringify([f.messages,f.logs,f.events()]);
  for(const contact of ['fixture@example.invalid','2025550100','Offline Fixture']) assert.ok(!sent.includes(contact));
  assert.equal(f.window.dataLayer.filter(x=>x[0]==='set'&&x[1]==='user_data').length,0);
  const purchase=f.events().find(x=>x[1]==='purchase');
  assert.deepEqual(Object.keys(purchase[2]).sort(),['currency','transaction_id','value']);
  assert.equal(f.p.payloads.length,2); assert.equal(f.p.ads.length,1); assert.equal(f.p.invoices.length,1);
  assert.ok(f.p.timers.length>0,'existing redirect remains scheduled');
  console.log('PASS replay, privacy, purchase/backend/invoice preservation');
  for (const saved of ['granted',JSON.stringify({source:'automatic',choice:'granted',at:Date.now()}),JSON.stringify({source:'banner-click-v2',choice:'granted',at:0})]) {
    const x=await fixture({stored:{wbe_consent_choice:'granted',wbe_consent_choice_v2:saved}});await x.submit();assert.equal(x.events().filter(e=>e[1]==='form_submit').length,0);
  }
  const returning=await fixture({stored:{wbe_consent_choice_v2:JSON.stringify({source:'banner-click-v2',choice:'granted',at:Date.now()})}});await returning.submit();assert.equal(returning.events().filter(e=>e[1]==='form_submit').length,1);
  console.log('PASS persisted affirmative provenance versus old/default/expired records');
  for(const mode of ['wrong-source','wrong-origin','extra-field','complete-first','expired']) {
    const x=await fixture({consent:'yes',pause:true});await x.submit();
    const pair=x.messages.filter(d=>d.source==='wbe-ads-form');assert.equal(pair.length,3);
    if(mode==='wrong-source') for(const d of pair)x.dispatch(d,{source:{}});
    if(mode==='wrong-origin') for(const d of pair)x.dispatch(d,{origin:'https://untrusted.invalid'});
    if(mode==='extra-field') for(const d of pair)x.dispatch({...d,email:'never-forward@example.invalid'});
    if(mode==='complete-first') x.dispatch(pair[2]);
    if(mode==='expired') {x.dispatch(pair[0]);x.dispatch(pair[1]);vm.runInContext('Date.now = () => '+(Date.now()+700000),x.head);x.dispatch(pair[2]);}
    assert.equal(x.events().filter(e=>e[1]==='form_submit').length,0,mode);
  }
  assert.match(read('velo/page-booking-summary.js'),/setTimeout\(function \(\) \{[\s\S]*?2000\)/);
  console.log('PASS exact schema, source/origin, ordering, expiry, unchanged 2000ms redirect');
})().catch(e=>{console.error(e);process.exitCode=1;});
