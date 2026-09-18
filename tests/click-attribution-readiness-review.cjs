'use strict';
// Independent schedules over the existing actual Head/iframe/worker fixture.
// Head/worker wall-clock sampling is controlled; protocol source is untouched.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
let src=fs.readFileSync(__dirname+'/click-attribution-corrections.cjs','utf8').split("test('partitioned page ID")[0];
function replaceOnce(a,b){assert.equal(src.split(a).length,2,'fixture seam '+a);src=src.replace(a,b);}
replaceOnce('policyRead}={})','policyRead, clock=Date}={})');
replaceOnce("crypto:require('node:crypto').webcrypto,Date,console", "crypto:require('node:crypto').webcrypto,Date:clock,console");
replaceOnce("crypto:require('node:crypto').webcrypto,window,document", "crypto:require('node:crypto').webcrypto,Date:clock,window,document");
replaceOnce("const component={onMessage:f=>{onMessage=f;},postMessage:d=>iframe.window.onmessage({data:d,source:parent,origin})};", "const sent=[];const component={onMessage:f=>{onMessage=f;},postMessage(d){sent.push({op:d.op,nonce:d.nonce,at:clock.now()});iframe.window.onmessage({data:d,source:parent,origin});}};");
replaceOnce('return {readReady,deliveries,frameNode,','return {sent,readReady,deliveries,frameNode,');
replaceOnce('close(){for(const t of timers)','close(){api.setSuspendGoogleAds(true);for(const t of timers)');
const box={require,__dirname,console,setTimeout,clearTimeout,URL};vm.runInNewContext(src+'\nthis.fixture=fixture;',box);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function clock(){let n=Date.now();return class extends Date{constructor(...args){super(...(args.length?args:[n]));}static now(){return n;}static advance(ms){n+=ms;}};}
const policy=c=>({v:1,requirement:'NOT_REQUIRED',policyKey:'a'.repeat(64),observedAt:c.now()});
for(const edge of ['read','confirm'])test('review: recovery cannot dispatch '+edge+' at original window deadline',{timeout:3000},async()=>{
 const c=clock();let policyCalls=0;
 const f=await box.fixture({clock:c,hold:d=>d.op==='open'||edge==='confirm'&&d.op==='read',policyRead:async()=>{policyCalls++;if(edge==='read')c.advance(100);return policy(c);}});
 try{
  const start=c.now();await f.ready();assert.equal(f.sent.length,1);
  c.advance(9900);f.deliveries[0].deliver();await sleep(10);
  assert.equal(f.sent.length,2);assert.notEqual(f.sent[0].nonce,f.sent[1].nonce);
  f.deliveries[1].deliver();await sleep(20);
  if(edge==='confirm'){assert.equal(f.sent.at(-1).op,'read');c.advance(100);f.deliveries[2].deliver();await sleep(20);}
  assert.equal(policyCalls,1);
  assert.equal(f.sent.filter(p=>p.at>=start+10000).length,0,'no dispatch at/after original deadline');
  assert.equal(f.api.getStoredClickIds(undefined,true),null);
 }finally{f.close();}
});
for(const edge of ['hint','policy'])test('review: expiry before '+edge+' dispatch remains closed',{timeout:3000},async()=>{
 const c=clock();let calls=0;const f=await box.fixture({clock:c,hold:d=>d.op==='open',policyRead:async()=>{calls++;return policy(c);}});
 try{
  await f.ready();if(edge==='policy'){c.advance(9900);f.deliveries[0].deliver();await sleep(10);c.advance(100);f.deliveries[1].deliver();}
  else {c.advance(10000);for(let i=0;i<5;i++)f.deliveries[0].deliver();}
  await sleep(30);assert.equal(calls,0);assert.equal(f.sent.length,edge==='policy'?2:1);assert.equal(f.api.getStoredClickIds(undefined,true),null);
 }finally{f.close();}
});
test('review: replay hints cannot replenish two recovery attempts',{timeout:4000},async()=>{
 const f=await box.fixture({hold:d=>d.op==='open'});try{
  await f.ready();for(let i=0;i<2;i++){f.deliveries[i].deliver();f.deliveries[i].deliver();await sleep(550);}
  assert.equal(f.sent.length,3);for(let repeat=0;repeat<5;repeat++)for(const d of f.deliveries)d.deliver();
  await sleep(20);assert.equal(f.sent.length,3);assert.equal(f.api.getStoredClickIds(undefined,true),null);
 }finally{f.close();}
});
