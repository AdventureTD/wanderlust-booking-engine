'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..');const KEY='wl_click_attribution';

// Worker admission boundaries; fixtures execute actual Head/relay/worker modules.
{
const {createRequire}=require('node:module');
const file=root+'/tests/click-attribution-corrections.cjs',text=fs.readFileSync(file,'utf8');
const ctx={require:createRequire(file),__dirname:root+'/tests',console,setTimeout,clearTimeout,URL};
vm.runInNewContext(text.slice(0,text.indexOf("test('partitioned"))+'\nthis.make=fixture;',ctx);
const pause=()=>new Promise(r=>setTimeout(r,20));
for(const packed of [false,true]) {
 for(const mode of ['before-regrant-read','before-next-read','reconstruct-revoked']) test('worker excludes revoked proposal '+mode+' '+packed,{timeout:5000},async()=>{
  process.env.WBE_CLICK_DEPLOY=packed?'1':'0';const f=await ctx.make({banner:true,query:'gclid=REVOKED_FIRST'});
  try {
   f.click('Accept All');f.visit('msclkid=REVOKED_LATEST');await f.ready();const old=f.workerStore.getItem(KEY);
   f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await pause();
   f.click('Cookie settings');f.click('Accept All');
   if(mode==='before-next-read'){f.visit('gclid=FRESH_ONLY');await f.ready();}
   f.workerStore.setItem(KEY,old);
   if(mode==='reconstruct-revoked')await f.reconstruct();
   const start=f.posts.length;await f.ready();
   const proposed=f.posts.slice(start).filter(d=>d.source==='wbe-click-attribution'&&d.op==='read');
   assert.equal(proposed.length,1);assert.equal(proposed[0].record,null,'old local bytes must never be proposed into the Head merge');
   const current=f.api.getStoredClickIds();assert.equal(current?.gclid??'',mode==='before-next-read'?'FRESH_ONLY':'');
  }finally{f.close()}
 });
 for(const legacy of [false,true]) test('worker 14-day persisted first migration and reconstruction positive '+legacy+' '+packed,{timeout:5000},async()=>{
  process.env.WBE_CLICK_DEPLOY=packed?'1':'0';const f=await ctx.make({query:'msclkid=LEGIT_LATEST'});
  try {
   const touch={gclid:'LEGIT_14_DAY_FIRST',gbraid:'',wbraid:'',msclkid:'',capturedAt:new Date(Date.now()-14*86400000).toISOString()};
   f.workerStore.setItem(KEY,JSON.stringify(legacy?touch:{v:1,first:touch,latest:touch}));
   await f.reconstruct();assert.equal(f.api.getStoredClickIds(),null);await f.ready();
   const current=f.api.getStoredClickIds();assert.equal(current.gclid,touch.gclid);assert.equal(current.capturedAt,touch.capturedAt);assert.equal(current.paidTouches.latest.msclkid,'LEGIT_LATEST');
   await f.reconstruct();await f.ready();assert.equal(f.api.getStoredClickIds().capturedAt,touch.capturedAt);
  }finally{f.close()}
 });
 test('worker best effort marker survives removal failure and reconstruction '+packed,{timeout:5000},async()=>{
  process.env.WBE_CLICK_DEPLOY=packed?'1':'0';const f=await ctx.make({banner:true,query:'gclid=REVOKED_FIRST'});let remove;
  try {
   f.click('Accept All');await f.ready();remove=f.workerStore.removeItem;f.workerStore.removeItem=k=>{if(k===KEY)throw Error('INERT');return remove(k)};
   f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await pause();
   assert.equal(f.workerStore.getItem('wl_click_attribution_revoked'),'1');
   await f.reconstruct();f.click('Cookie settings');f.click('Accept All');const start=f.posts.length;await f.ready();
   assert.equal(f.posts.slice(start).find(d=>d.source==='wbe-click-attribution'&&d.op==='read').record,null);assert.equal(f.api.getStoredClickIds(),null);
  }finally{if(remove)f.workerStore.removeItem=remove;f.close()}
 });
}
}
function fixture(packed){
 const storage=new Map(),nodes=[],listeners={},posts=[];let failDelete=false,now=Date.UTC(2026,8,1);
 const element=()=>{const e={style:{},children:[],addEventListener(t,f){this[t]=f},setAttribute(){},appendChild(x){this.children.push(x);x.parentNode=this},removeChild(x){this.children=this.children.filter(v=>v!==x)}};nodes.push(e);return e};
 const frame={postMessage(d){posts.push(structuredClone(d))}};const window={location:{href:'https://www.wanderlustcaribbean.com/?gclid=OLD'},dataLayer:[],addEventListener(t,f){(listeners[t]??=[]).push(f)}};
 const context=vm.createContext({window,URL,crypto:require('node:crypto').webcrypto,performance:{now:()=>10},setTimeout:()=>0,clearTimeout(){},Date:class extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}},console:{log(){}},document:{body:element(),createElement:element,readyState:'complete',addEventListener(){},getElementById(id){return nodes.find(n=>n.id===id&&n.parentNode)||null},querySelectorAll(){return[{src:'https://inert.filesusr.com/x',contentWindow:frame,isConnected:true}]}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>{if(failDelete&&k===KEY)throw Error('inert remove failure');storage.delete(k)}}});Object.defineProperty(context,'dataLayer',{get:()=>window.dataLayer});
 const html=fs.readFileSync(root+'/velo/custom-code/google-tag-and-consent'+(packed?'':'.source')+'.html','utf8');const code=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/BANNER_ENABLED\s*=\s*false/,'BANNER_ENABLED=true');
 vm.runInContext(code,context);
 return {storage,posts,run:s=>vm.runInContext(s,context),deny(){vm.runInContext("gtag('consent','update',{ad_user_data:'denied'})",context)},fail(){failDelete=true},accept(){nodes.find(n=>n.textContent==='Accept All').click({isTrusted:true})},rerun(query){now+=1000;window.location.href='https://www.wanderlustcaribbean.com/?'+query;vm.runInContext(code,context)},confirm(){const nonce='a'.repeat(32);let sequence=1;const send=d=>(listeners.message||[]).forEach(f=>f({data:d,source:frame,origin:'https://inert.filesusr.com'}));const msg={source:'wbe-click-attribution',v:2,schema:1,nonce,sequence,channel:'',op:'open',policy:null,record:null};send(msg);const channel=posts.at(-1).channel;const policy={v:2,audience:'https://www.wanderlustcaribbean.com',purpose:'attribution',phase:'read',nonce,challenge:channel,requirement:'NOT_REQUIRED',policyKey:'b'.repeat(64),observedAt:now};send({...msg,sequence:2,channel,op:'read',policy});send({...msg,sequence:3,channel,op:'confirm',policy});return posts.at(-1)}};
}
for(const packed of [false,true]){
 test('review successful withdrawal plus fresh landing positive control '+packed,()=>{const f=fixture(packed);f.deny();assert.equal(f.storage.has(KEY),false);f.accept();f.rerun('gclid=FRESH');const d=f.confirm();assert.equal(d.allowed,true);assert.equal(d.record.first.gclid,'FRESH');assert.equal(d.record.latest.gclid,'FRESH')});
 test('review successful withdrawal plus direct return positive control '+packed,()=>{const f=fixture(packed);f.deny();f.accept();f.rerun('');const d=f.confirm();assert.equal(d.allowed,true);assert.equal(d.record,null)});
 test('review failed deletion must not resurrect old touch after trusted regrant '+packed,()=>{const f=fixture(packed);f.fail();f.deny();f.accept();f.rerun('');const d=f.confirm();assert.equal(d.allowed,true);assert.equal(d.record,null,'old denied retained storage is not fresh capture authority')});
 test('review reintroduced cache must not join valid fresh URL after regrant '+packed,()=>{const f=fixture(packed);const old=f.storage.get(KEY);f.deny();f.storage.set(KEY,old);f.accept();f.rerun('gclid=FRESH');const d=f.confirm();assert.equal(d.allowed,true);assert.equal(d.record.first.gclid,'FRESH','post-denial fresh capture must not inherit old cached first')});
}

for(const packed of [false,true]) {
 test('postgrant fresh capture survives direct rerun without timestamp renewal '+packed,()=>{const f=fixture(packed);f.fail();f.deny();f.accept();f.rerun('gclid=FRESH');const a=f.confirm().record;assert.equal(a.first.gclid,'FRESH');f.rerun('');assert.deepEqual(f.confirm().record,a)});
 test('postgrant fresh capture does not admit reintroduced predenial bytes '+packed,()=>{const f=fixture(packed);const old=f.storage.get(KEY);f.deny();f.accept();f.rerun('gclid=FRESH');assert.equal(f.confirm().record.first.gclid,'FRESH');f.storage.set(KEY,old);assert.equal(f.confirm().record,null);f.rerun('msclkid=NEXT');const a=f.confirm().record;assert.equal(a.first.msclkid,'NEXT');assert.equal(a.first.gclid,'');assert.equal(a.latest.msclkid,'NEXT')});
}

// Permanent unchanged reviewer assertions (repo-relative root).
{
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=require('node:path').resolve(__dirname,'..'),file=root+'/tests/click-attribution-corrections.cjs',KEY='wl_click_attribution';
const text=fs.readFileSync(file,'utf8');
const ctx={require:createRequire(file),__dirname:root+'/tests',console,setTimeout,clearTimeout,URL};
vm.runInNewContext(text.slice(0,text.indexOf("test('partitioned"))+'\nthis.make=fixture;',ctx);
const pause=()=>new Promise(r=>setTimeout(r,20));
for(const packed of [false,true]) for(const mode of ['delete-fails','reinsert-after-empty','reinsert-after-fresh','same-ID-fresh-positive','normal-empty-positive']) {
 test('fresh review worker epoch '+mode+' '+(packed?'packed':'source'),{timeout:5000},async()=>{
  process.env.WBE_CLICK_DEPLOY=packed?'1':'0';
  const f=await ctx.make({banner:true,query:'gclid=DENIED_FIRST'});
  let remove;
  try {
   f.click('Accept All');f.visit('msclkid=DENIED_LATEST');await f.ready();
   const old=f.workerStore.getItem(KEY),snap=f.api.getStoredClickIds();
   assert.equal(snap.gclid,'DENIED_FIRST');assert.equal(snap.paidTouches.latest.msclkid,'DENIED_LATEST');
   if(mode==='delete-fails'){remove=f.workerStore.removeItem;f.workerStore.removeItem=k=>{if(k===KEY)throw Error('INERT_REMOVE_FAILURE');return remove(k)}}
   f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await pause();
   assert.equal(f.api.getStoredClickIds(),null,'while denied no identifiers');
   assert.equal(f.pageStore.getItem(KEY),null);
   f.click('Cookie settings');f.click('Accept All');
   assert.equal(f.api.getStoredClickIds(snap),null,'old snapshot cannot survive regrant');
   if(mode==='same-ID-fresh-positive') f.visit('gclid=DENIED_FIRST');
   if(mode==='reinsert-after-fresh') f.visit('gclid=FRESH_ONLY');
   await f.ready();
   const ack=f.posts.filter(x=>x.type==='wbe-click-attribution-result'&&x.op==='confirm').at(-1);
   assert.equal(ack.allowed,true);
   if(mode==='same-ID-fresh-positive'){
    const current=f.api.getStoredClickIds();assert.equal(current.gclid,'DENIED_FIRST');assert.equal(current.paidTouches.latest.msclkid,'');assert.notEqual(current.capturedAt,snap.capturedAt);assert.equal(f.api.getStoredClickIds(snap),null);return;
   }
   if(mode==='reinsert-after-fresh'){assert.equal(f.api.getStoredClickIds().gclid,'FRESH_ONLY');f.workerStore.setItem(KEY,old);}
   else {assert.equal(ack.record,null,'Head authorizes empty, not denied old state');if(mode==='reinsert-after-empty')f.workerStore.setItem(KEY,old);}
   const observed=f.api.getStoredClickIds();
   assert.equal(observed,null,'DENIED worker bytes must not be admitted by a new empty/fresh Head epoch');
  } finally {if(remove)f.workerStore.removeItem=remove;f.close();}
 });
}

}

// Permanent unchanged reviewer assertions (repo-relative root).
{
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=require('node:path').resolve(__dirname,'..'),file=root+'/tests/click-attribution-corrections.cjs',KEY='wl_click_attribution';
const text=fs.readFileSync(file,'utf8');
const ctx={require:createRequire(file),__dirname:root+'/tests',console,setTimeout,clearTimeout,URL};
vm.runInNewContext(text.slice(0,text.indexOf("test('partitioned"))+'\nthis.make=fixture;',ctx);
const pause=()=>new Promise(r=>setTimeout(r,20));

const pageFile=root+'/tests/attribution-hotfix.cjs',pageText=fs.readFileSync(pageFile,'utf8'),pc={require:createRequire(pageFile),__dirname:root+'/tests',console};
vm.runInNewContext(pageText.slice(0,pageText.indexOf('function bookingBackend'))+'\nthis.pageFactory=page;',pc);
for(const packed of [false,true])test('fresh review denied worker IDs reach actual Summary '+packed,{timeout:5000},async()=>{
 process.env.WBE_CLICK_DEPLOY=packed?'1':'0';const f=await ctx.make({banner:true,query:'gclid=DENIED_FIRST'});let remove;
 try{
  f.click('Accept All');f.visit('msclkid=DENIED_LATEST');await f.ready();
  remove=f.workerStore.removeItem;f.workerStore.removeItem=k=>{if(k===KEY)throw Error('INERT_REMOVE_FAILURE');return remove(k)};
  f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await pause();assert.equal(f.api.getStoredClickIds(),null);
  f.click('Cookie settings');f.click('Accept All');
  const p=await pc.pageFactory();p.c.waitForClickAttribution=f.api.waitForClickAttribution;p.c.getStoredClickIds=f.api.getStoredClickIds;
  await p.click();assert.equal(p.invoices.length,1);assert.equal(p.payloads.length,2);
  assert.equal(f.posts.filter(x=>x.type==='wbe-click-attribution-result'&&x.op==='confirm').at(-1).record,null);
  assert.deepEqual({first:p.payloads[0].firstPaidTouch,latest:p.payloads[0].latestPaidTouch,google:p.ads[0]?.gclid||''},{first:null,latest:null,google:''},'actual Summary and provider must not consume denied first/latest from failed worker cleanup');
 }finally{if(remove)f.workerStore.removeItem=remove;f.close()}
});

}
