'use strict';
// Full actual policy producer/worker/tracking/relay/Head; inert native SDK only.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../velo'),origin='https://www.wanderlustcaribbean.com',frameOrigin='https://inert.filesusr.com';
const read=p=>fs.readFileSync(path.join(root,p),'utf8'),inline=p=>read(p).match(/<script>([\s\S]*?)<\/script>/)[1];
async function fixture(o={}) {
 const timers=new Set(),trace=[],storage=new Map(),workerStorage=new Map(),listeners=[],receivers=[];
 let externalCalls=0;const deny=()=>{externalCalls++;throw Error('OFFLINE_NETWORK_DENIED');};
 const network={fetch:deny,XMLHttpRequest:deny,WebSocket:deny,Image:deny};
 const clocks={head:100,worker:200,server:Date.now()+(o.serverOffset||0)};
 const timer=(fn,ms)=>{const t=setTimeout(()=>{timers.delete(t);fn();},ms);timers.add(t);return t;};
 const wall=offset=>class extends Date {static now(){return Date.now()+offset;}};
 const crypto=require('node:crypto').webcrypto;
 const parent={},frame={},field={value:'inert@example.invalid'};
 const dispatch=d=>listeners.forEach(f=>f({data:d,source:frame,origin:frameOrigin}));
 const node={src:frameOrigin+'/bridge',contentWindow:frame,isConnected:true};
 const window={location:{href:origin+'/?'+(o.query||'')},dataLayer:[],addEventListener:(t,f)=>{if(t==='message')listeners.push(f);}};
 const head=vm.createContext({...network,Date:wall(o.headOffset||0),performance:o.noHeadClock?undefined:{now:()=>clocks.head},crypto:o.noCrypto?undefined:crypto,setTimeout:timer,clearTimeout,URL,window,document:{readyState:'complete',querySelectorAll:s=>s.includes('iframe')?[node]:[field],addEventListener(){},getElementById(){return null;}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},console:{log(){}}});
 Object.defineProperty(head,'dataLayer',{get:()=>window.dataLayer});
 if(o.denied)storage.set('wbe_consent_choice','denied');
 if(o.malformedConsent)storage.set('wbe_consent_choice_v2','{');
 vm.runInContext(inline((o.packed||process.env.WBE_V2_PACKED==='1')?'custom-code/google-tag-and-consent.html':'custom-code/google-tag-and-consent.source.html'),head);
 const iframe=vm.createContext({window:{parent},document:{referrer:origin+'/'},URL});
 vm.runInContext(inline('custom-code/event-bridge-iframe.html'),iframe);
 parent.postMessage=(d,target)=>{assert.equal(target,origin);trace.push({edge:'relay',d:structuredClone(d)});if(d.source)dispatch(d);else receivers.forEach(f=>f({data:d}));};
 frame.postMessage=(d,target)=>{assert.equal(target,frameOrigin);trace.push({edge:'ack',d:structuredClone(d)});const deliver=()=>iframe.window.onmessage({data:d,source:parent,origin});if(o.ackDelay)timer(deliver,o.ackDelay);else deliver();};
 const component={onMessage:f=>receivers.push(f),postMessage:d=>{trace.push({edge:'worker',d:structuredClone(d)});const deliver=()=>iframe.window.onmessage({data:d,source:parent,origin});if(o.beforeRelay)o.beforeRelay(d,clocks);const delay=o.requestDelay?o.requestDelay(d):0;if(delay)timer(deliver,delay);else deliver();}};
 let nativeReads=0,rpcs=0;
 const server=vm.createContext({...network,Date:class extends Date {static now(){return clocks.server;}},setTimeout:timer,clearTimeout,console});
 server.find=async()=>{nativeReads++;if(o.policyDelay)await new Promise(r=>timer(r,o.policyDelay));if(o.onRead)await o.onRead(nativeReads,clocks);return JSON.stringify(o.rows||[]);};
 vm.runInContext('const sdk={query(){return {ascending(){return this},limit(){return this},async find(){return {items:JSON.parse(await find()),hasNext(){return false}}}}}};',server);
 const backend=new Map();
 const synthetic=(context,values)=>new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context});
 function loadBackend(s){if(backend.has(s))return backend.get(s);let m;if(s==='wix-data')m=synthetic(server,{default:vm.runInContext('sdk',server)});else if(s==='wix-web-module')m=synthetic(server,{Permissions:{Anyone:'Anyone'},webMethod:(_,f)=>f});else if(s==='crypto')m=synthetic(server,{createHash:require('node:crypto').createHash});else {assert.ok(s.startsWith('backend/'));m=new vm.SourceTextModule(read(s+'.js'),{context:server});}backend.set(s,m);return m;}
 const endpoint=loadBackend('backend/adsFormRequirement.web');await endpoint.link(loadBackend);await endpoint.evaluate();
 const worker=vm.createContext({...network,Date:wall(o.workerOffset||0),performance:o.noWorkerClock?undefined:{now:()=>clocks.worker},crypto:o.noCrypto?undefined:(o.badWorkerCrypto?{getRandomValues:()=>new Uint8Array(16)}:crypto),setTimeout:timer,clearTimeout,console:{log(){},warn(){},error(){}}}),cache=new Map();
 const rpc=async request=>{rpcs++;trace.push({edge:'rpc',d:structuredClone(request)});const json=JSON.stringify(request);const result=await vm.runInContext('globalThis.call('+ (json===undefined?'':json) +')',server);return o.response?o.response(structuredClone(result),request):structuredClone(result);};
 server.call=endpoint.namespace.getAdsFormRequirement;
 function load(s){if(cache.has(s))return cache.get(s);let m;if(s==='backend/adsFormRequirement.web')m=synthetic(worker,{getAdsFormRequirement:rpc});else if(s==='wix-storage-frontend')m=synthetic(worker,{local:{getItem:k=>workerStorage.get(k)??null,setItem:(k,v)=>workerStorage.set(k,v),removeItem:k=>workerStorage.delete(k)}});else if(s==='wix-location-frontend')m=synthetic(worker,{default:{url:origin,query:{}}});else {assert.ok(s.startsWith('public/'));m=new vm.SourceTextModule(read(s+'.js'),{context:worker});}cache.set(s,m);return m;}
 const tracking=load('public/tracking');await tracking.link(load);await tracking.evaluate();const api=tracking.namespace;api.initTracking(()=>component);api.initClickAttribution(()=>component);
 return {api,head,worker,server,trace,clocks,storage,endpoint:request=>{server.arg=JSON.stringify(request);return vm.runInContext('call(JSON.parse(arg))',server);},counts:()=>({nativeReads,rpcs,externalCalls}),forms:()=>window.dataLayer.filter(x=>x[0]==='event'&&x[1]==='form_submit'),async settle(){for(let i=0;i<150;i++)await Promise.resolve();},close(){api.setSuspendGoogleAds(true);for(const t of timers)clearTimeout(t);}};
}
module.exports={fixture};
if(require.main===module){
 for(const offset of [0,86400000,-86400000])test('v2 actual graph accepts independent server offset '+offset,async()=>{const f=await fixture({serverOffset:offset,headOffset:12345,workerOffset:-12345});try{await f.api.waitForClickAttribution();assert.ok(f.api.getStoredClickIds(undefined,true));assert.equal(f.counts().nativeReads,1);assert.equal(f.trace.find(x=>x.edge==='rpc').d.v,2);}finally{f.close();}});
 test('v2 actual graph accepts fresh 600ms native policy and both optional form ACK phases',async()=>{const f=await fixture({policyDelay:600});try{await f.api.waitForClickAttribution();assert.ok(f.api.getStoredClickIds(undefined,true));const seq=f.api.prepareAdsFormSubmission();f.api.completeAdsFormSubmission(seq);await new Promise(r=>setTimeout(r,1300));await f.settle();assert.equal(f.forms().length,1);assert.equal(f.counts().nativeReads,3);for(const call of f.trace.filter(x=>x.edge==='rpc')){const pos=f.trace.indexOf(call);assert.ok(f.trace.slice(0,pos).some(x=>x.edge==='ack'&&(x.d.challenge===call.d.challenge||x.d.channel===call.d.challenge)));}assert.equal(f.counts().externalCalls,0);}finally{f.close();}});
 test('v2 producer rejects malformed and old calls before native IO',async()=>{const f=await fixture();try{for(const d of [{v:1},{v:2},null,{v:2,audience:origin,purpose:'form',phase:'read',nonce:'a'.repeat(32),challenge:'b'.repeat(32)}])assert.equal((await f.endpoint(d)).requirement,'UNRESOLVED');assert.equal(f.counts().nativeReads,0);}finally{f.close();}});
}
