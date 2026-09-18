'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../velo'),key='wl_click_attribution',origin='https://www.wanderlustcaribbean.com',frameOrigin='https://inert.filesusr.com';
const read=p=>fs.readFileSync(path.join(root,require('node:process').env.WBE_CLICK_DEPLOY==='1'&&p==='custom-code/google-tag-and-consent.source.html'?'custom-code/google-tag-and-consent.html':p),'utf8');
const store=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
async function fixture({deny=false,drop=false,delay=0,query='gclid=INERT_EXACT_FIRST',banner=false,hold=()=>false,policyRead}={}){
 const pageStore=store(),workerStore=store(),listeners={},posts=[],timers=new Set(),deliveries=[];let onMessage,readIssued;
 const readReady=new Promise(resolve=>{readIssued=resolve;});
 if(deny)pageStore.setItem('wbe_consent_choice','denied');
 const parent={postMessage(d,target){assert.equal(target,origin);posts.push(d);if(drop)return;for(const f of listeners.message||[])f({data:d,source:frame,origin:frameOrigin});if(onMessage)onMessage({data:d});}};
 const frame={postMessage(d,target){assert.equal(target,frameOrigin);if(d.op==='read')readIssued();if(drop)return;const deliver=()=>iframe.window.onmessage({data:d,source:parent,origin});if(hold(d)){deliveries.push({d,deliver});return;}const timer=setTimeout(()=>{timers.delete(timer);deliver();},delay);timers.add(timer);}};
 const nodes=[];function element(){const e={style:{},children:[],parentNode:null,setAttribute(){},appendChild(n){n.parentNode=this;this.children.push(n);},removeChild(n){this.children=this.children.filter(x=>x!==n);n.parentNode=null;},addEventListener(k,f){this[k]=f;}};nodes.push(e);return e;}
 const body=element(),attached=e=>e===body||!!e.parentNode&&attached(e.parentNode);
 const frameNode={contentWindow:frame,src:frameOrigin+'/embed',isConnected:true};
 const document={body,referrer:origin+'/',addEventListener(){},createElement:element,getElementById:id=>nodes.find(n=>n.id===id&&attached(n))||null,querySelectorAll:s=>s==='iframe[title="WBE event bridge"]'?[frameNode]:[]};
 const window={location:{href:origin+'/?'+query},dataLayer:[],addEventListener:(k,f)=>(listeners[k]??=[]).push(f)};
 const head=vm.createContext({crypto:require('node:crypto').webcrypto,window,document,localStorage:pageStore,URL,console:{log(){},error(){}},setTimeout,clearTimeout});Object.defineProperty(head,'dataLayer',{get:()=>window.dataLayer});
 vm.runInContext(read('custom-code/google-tag-and-consent.source.html').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/var BANNER_ENABLED\s*=\s*false;/,'var BANNER_ENABLED = '+banner+';'),head);
 const iframe=vm.createContext({window:{parent},document:{referrer:origin+'/'},URL});vm.runInContext(read('custom-code/event-bridge-iframe.html').match(/<script>([\s\S]*?)<\/script>/)[1],iframe);
 const component={onMessage:f=>{onMessage=f;},postMessage:d=>iframe.window.onmessage({data:d,source:parent,origin})};
 async function worker(){
 const context=vm.createContext({crypto:require('node:crypto').webcrypto,Date,console:{log(){},error(){}},setTimeout,clearTimeout}),cache=new Map();
 const external={'wix-storage-frontend':{local:workerStore},'wix-location-frontend':{default:{query:{},url:origin+'/stripped'}},'backend/adsFormRequirement.web':{getAdsFormRequirement:policyRead|| (async()=>({v:1,requirement:'NOT_REQUIRED',policyKey:'a'.repeat(64),observedAt:Date.now()}))}};
 function make(s){if(cache.has(s))return cache.get(s);const e=external[s];const m=e?new vm.SyntheticModule(Object.keys(e),function(){for(const k of Object.keys(e))this.setExport(k,e[k]);},{context}):new vm.SourceTextModule(read(s+'.js'),{context});cache.set(s,m);return m;}
 const m=make('public/tracking');await m.link(make);await m.evaluate();const api=m.namespace;
 if(api.initClickAttribution)api.initClickAttribution(()=>component);else api.initTracking(()=>component);
 return api;
 }
 let api=await worker();
 return {readReady,deliveries,frameNode,click(text){const n=nodes.find(n=>n.textContent===text&&attached(n));assert.ok(n,'attached '+text);n.click({isTrusted:true});},get api(){return api;},async reconstruct(){const before=api;api=await worker();assert.notEqual(api,before);},pageStore,workerStore,posts,head,iframe,frame,parent,listeners,dropping(value){drop=value;},async ready(){if(api.waitForClickAttribution)await api.waitForClickAttribution();else api.captureClickIds();},close(){for(const t of timers)clearTimeout(t);}};
}
test('partitioned page ID reaches worker after delayed readiness; clear both partitions',async()=>{const f=await fixture({delay:15});try{await f.ready();assert.equal(f.api.getStoredClickIds()?.gclid,'INERT_EXACT_FIRST');await f.api.clearClickIds();await new Promise(r=>setTimeout(r,30));assert.equal(f.pageStore.getItem(key),null);assert.equal(f.workerStore.getItem(key),null);}finally{f.close();}});
test('stored opt-out denies transfer and erases old attribution',async()=>{const f=await fixture({deny:true});try{await f.ready();assert.equal(f.api.getStoredClickIds(),null);assert.equal(f.pageStore.getItem(key),null);}finally{f.close();}});
test('dropped channel resolves nonfatally with no stale ID',async()=>{const f=await fixture({drop:true});try{const start=Date.now();await f.ready();assert.ok(Date.now()-start<2000);assert.equal(f.api.getStoredClickIds(),null);}finally{f.close();}});
test('wrong source, wrong origin and extra fields obtain no attribution response',async()=>{const f=await fixture();try{await f.ready();const count=f.posts.length;for(const change of [{source:{}},{origin:'https://evil.invalid'},{data:{source:'wbe-click-attribution',v:1,op:'read',sequence:99,policy:null,email:'private'}}])for(const fn of f.listeners.message||[])fn({source:f.frame,origin:frameOrigin,data:{source:'wbe-click-attribution',v:1,op:'read',sequence:99,policy:null},...change});assert.equal(f.posts.length,count);}finally{f.close();}});
// Composed actual-source booking persistence and serializer tracer. Existing
// native journal fixture supplies an inert capability; no provider is entered.
test('first touch reconciles the older worker record into the page partition',async()=>{const f=await fixture();try{const old={gclid:'INERT_OLDER',gbraid:'',wbraid:'',msclkid:'',capturedAt:new Date(Date.now()-10000).toISOString()};f.workerStore.setItem(key,JSON.stringify(old));await f.ready();assert.equal(f.api.getStoredClickIds().gclid,'INERT_OLDER');assert.equal(JSON.parse(f.pageStore.getItem(key)).gclid,'INERT_OLDER');}finally{f.close();}});
test('clear is scoped to the converted snapshot, not a newer page touch',async()=>{const f=await fixture();try{await f.ready();const old=f.api.getStoredClickIds();const fresh={...old,gclid:'INERT_NEWER',capturedAt:new Date().toISOString()};f.pageStore.setItem(key,JSON.stringify(fresh));await f.api.clearClickIds(old);assert.equal(JSON.parse(f.pageStore.getItem(key)).gclid,'INERT_NEWER');}finally{f.close();}});
test('lost clear acknowledgement never clears a later session during retry',async()=>{const f=await fixture();try{await f.ready();const old=f.api.getStoredClickIds();f.dropping(true);await f.api.clearClickIds(old);const fresh={...old,gclid:'INERT_NEW_SESSION',capturedAt:new Date().toISOString()};f.workerStore.setItem(key,JSON.stringify(fresh));f.pageStore.setItem(key,JSON.stringify(fresh));f.dropping(false);await f.ready();assert.equal(f.api.getStoredClickIds().gclid,'INERT_NEW_SESSION');assert.equal(JSON.parse(f.pageStore.getItem(key)).gclid,'INERT_NEW_SESSION');}finally{f.close();}});
test('worker read rejects expired, future, malformed and nonstring stored IDs',async()=>{for(const change of [{capturedAt:'2000-01-01T00:00:00Z'},{capturedAt:'invalid'},{capturedAt:'2999-01-01T00:00:00Z'},{gclid:123},{gclid:' INERT '}]){const f=await fixture();try{f.workerStore.setItem(key,JSON.stringify({gclid:'INERT',gbraid:'',wbraid:'',msclkid:'',capturedAt:new Date().toISOString(),...change}));assert.equal(f.api.getStoredClickIds(),null);assert.equal(f.workerStore.getItem(key),null);}finally{f.close();}}});
test('URL capture preserves literal plus and decodes percent escapes exactly once',async()=>{
 for(const [query,expected] of [['gclid=INERT+A','INERT+A'],['gclid=INERT%2BA','INERT+A'],['gclid=INERT%252BA','INERT%2BA'],['gclid=INERT%20A',null],['gclid=INERT%ZZ',null]]) {
  const f=await fixture({query});try{await f.ready();assert.equal(f.api.getStoredClickIds()?.gclid??null,expected,query);}finally{f.close();}
 }
});
test('same-frame reconstructed worker can read again without replaying a consumed response',async()=>{
 const f=await fixture();try{await f.ready();const old=f.posts.find(d=>d.type==='wbe-click-attribution-result');await f.reconstruct();await f.ready();assert.equal(f.api.getStoredClickIds()?.gclid,'INERT_EXACT_FIRST');
 await f.api.clearClickIds();f.frame.postMessage(old,frameOrigin);await new Promise(r=>setTimeout(r,10));assert.equal(f.api.getStoredClickIds(),null);
 }finally{f.close();}
});
test('withdrawal between Head read and delayed Velo delivery cannot restore attribution',{timeout:3000},async()=>{
 const f=await fixture({delay:40});try{
  const ready=f.ready();await f.readReady;
  assert.ok(f.posts.some(d=>d.source==='wbe-click-attribution'&&d.op==='read'),'read reached actual Head');
  f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);
  assert.equal(f.pageStore.getItem(key),null,'actual denial cleared page storage');
  await ready;assert.equal(f.api.getStoredClickIds(),null,'stale permitted result must not repopulate worker');
 }finally{f.close();}
});
test('saved-denial change before delayed delivery remains denied after worker reconstruction',{timeout:3000},async()=>{
 const f=await fixture({delay:40});try{
  const ready=f.ready();await f.readReady;
  assert.ok(f.posts.some(d=>d.source==='wbe-click-attribution'&&d.op==='read'));
  f.pageStore.setItem('wbe_consent_choice','denied');
  for(const fn of f.listeners.storage||[])fn({key:'wbe_consent_choice'});
  await ready;assert.equal(f.api.getStoredClickIds(),null,'storage withdrawal fences delayed response');
  await f.reconstruct();assert.equal(f.api.getStoredClickIds(),null,'unvalidated reconstruction cannot expose retained IDs');
  await f.ready();assert.equal(f.api.getStoredClickIds(),null);
 }finally{f.close();}
});
const tick=()=>new Promise(r=>setTimeout(r,15));
test('reaccept without delivered revocation cannot recycle the old worker copy',{timeout:4000},async()=>{
 const f=await fixture({banner:true,hold:d=>d.type==='wbe-click-revoke'});try{
  f.click('Accept All');await f.ready();assert.ok(f.api.getStoredClickIds());
  f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);
  assert.equal(f.pageStore.getItem(key),null);
  f.click('Cookie settings');f.click('Accept All');await f.ready();
  assert.equal(f.pageStore.getItem(key),null,'no old worker-to-page restoration');
  assert.equal(f.workerStore.getItem(key),null,'fresh permission is not old ID authority');
 }finally{f.close();}
});
test('fresh reconstruction hides retained IDs until authenticated read',async()=>{
 const f=await fixture();try{await f.ready();await f.reconstruct();assert.equal(f.api.getStoredClickIds(),null);await f.ready();assert.equal(f.api.getStoredClickIds()?.gclid,'INERT_EXACT_FIRST');}finally{f.close();}
});
test('revocation deletes pending-clear identifier copy',async()=>{
 const f=await fixture();try{await f.ready();f.workerStore.setItem('wl_click_attribution_clear_pending',f.workerStore.getItem(key));f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await tick();assert.equal(f.workerStore.getItem(key),null);assert.equal(f.workerStore.getItem('wl_click_attribution_clear_pending'),null);}finally{f.close();}
});
test('fresh reaccept reads only fresh page attribution despite a delayed revoke',{timeout:4000},async()=>{
 const f=await fixture({banner:true,hold:d=>d.type==='wbe-click-revoke'});try{
  f.click('Accept All');await f.ready();const old=f.workerStore.getItem(key);
  f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);
  f.click('Cookie settings');f.click('Accept All');
  const fresh={...JSON.parse(old),gclid:'INERT_FRESH_ACCEPT',capturedAt:new Date().toISOString()};f.pageStore.setItem(key,JSON.stringify(fresh));
  await f.ready();assert.equal(f.api.getStoredClickIds()?.gclid,'INERT_FRESH_ACCEPT');
  for(const d of f.deliveries)d.deliver();await tick();assert.equal(f.api.getStoredClickIds()?.gclid,'INERT_FRESH_ACCEPT','old revoke cannot clear current epoch');
 }finally{f.close();}
});
for(const op of ['read','confirm'])test('withdraw reaccept and replay delayed '+op+' cannot restore either store',{timeout:4000},async()=>{
 let holding=true;const f=await fixture({banner:true,hold:d=>holding&&d.op===op});try{
  f.click('Accept All');const ready=f.ready();
  for(let i=0;i<30&&!f.deliveries.length;i++)await tick();assert.equal(f.deliveries.length,1);
  const old=f.deliveries[0];f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await tick();
  f.click('Cookie settings');f.click('Accept All');old.deliver();await ready;
  assert.equal(f.pageStore.getItem(key),null);assert.equal(f.workerStore.getItem(key),null);
  holding=false;await f.ready();old.deliver();await tick();
  assert.equal(f.pageStore.getItem(key),null);assert.equal(f.workerStore.getItem(key),null);
 }finally{f.close();}
});
test('policy await is fenced before withdrawal and reaccept',{timeout:4000},async()=>{
 let release,entered;const started=new Promise(r=>entered=r);const f=await fixture({banner:true,policyRead:()=>{entered();return new Promise(r=>release=r);}});try{
  f.click('Accept All');const ready=f.ready();await started;
  f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);f.click('Cookie settings');f.click('Accept All');await tick();
  release({v:1,requirement:'NOT_REQUIRED',policyKey:'a'.repeat(64),observedAt:Date.now()});await ready;
  assert.equal(f.posts.filter(d=>d.source==='wbe-click-attribution'&&d.op==='read').length,0);assert.equal(f.pageStore.getItem(key),null);assert.equal(f.workerStore.getItem(key),null);
 }finally{if(release)release(null);f.close();}
});
test('old authenticated request and open replay cannot restore cleared attribution',async()=>{
 const f=await fixture();try{await f.ready();const old=f.posts.filter(d=>d.source==='wbe-click-attribution');await f.reconstruct();await f.ready();await f.api.clearClickIds();
  for(const d of old)for(const fn of f.listeners.message||[])fn({data:d,source:f.frame,origin:frameOrigin});await tick();assert.equal(f.pageStore.getItem(key),null);assert.equal(f.workerStore.getItem(key),null);
  await f.ready();assert.equal(f.api.getStoredClickIds(),null);
 }finally{f.close();}
});
test('detached trusted frame cannot negotiate a channel',async()=>{const f=await fixture();try{f.frameNode.isConnected=false;await f.ready();assert.equal(f.api.getStoredClickIds(),null);}finally{f.close();}});
for(const mode of ['extra','nonce','channel','sequence','op','record'])test('malformed current confirmation stays closed: '+mode,{timeout:3000},async()=>{
 const f=await fixture({hold:d=>d.op==='confirm'});
 try {
  const ready=f.ready();for(let i=0;i<30&&!f.deliveries.length;i++)await tick();assert.equal(f.deliveries.length,1);
  const d={...f.deliveries[0].d};
  if(mode==='extra')d.email='INERT';if(mode==='nonce')d.nonce='0'.repeat(32);if(mode==='channel')d.channel='0'.repeat(32);if(mode==='sequence')d.sequence++;if(mode==='op')d.op='read';if(mode==='record')d.record={gclid:'INERT_BAD'};
  f.iframe.window.onmessage({data:d,source:f.parent,origin});await ready;
  assert.equal(f.api.getStoredClickIds(),null);assert.equal(f.api.getStoredClickIds(undefined,true),null);
 }finally{f.close();}
});
test('initial saved denial fences worker copy even when accepted before first read',async()=>{
 const f=await fixture({deny:true,banner:true});try{
  f.workerStore.setItem(key,JSON.stringify({gclid:'INERT_OLD_PARTITION',gbraid:'',wbraid:'',msclkid:'',capturedAt:new Date().toISOString()}));
  f.click('Cookie settings');f.click('Accept All');await f.ready();assert.equal(f.pageStore.getItem(key),null);assert.equal(f.workerStore.getItem(key),null);
 }finally{f.close();}
});
const clone=x=>JSON.parse(JSON.stringify(x));
const realm=x=>vm.createContext({Date,console:{log(){},error(){}},...x});
const run=(c,s)=>vm.runInContext(s,c);
const deny=()=>{throw Error('OFFLINE_DENIED');};
function persistence(){const rows=[],summary=[];const sdk={query(col){return {eq(){return this;},limit(){return this;},async find(){return {items:clone(col==='Bookings'?rows:summary)};}};},async insert(col,row){const saved={...clone(row),_id:'INERT_ROW_'+(rows.length+summary.length)};(col==='Bookings'?rows:summary).push(saved);return clone(saved);},async update(col,row){assert.equal(col,'BookingSummary');summary[0]=clone(row);return clone(row);},remove:deny};
 const c=realm({wixData:sdk,BOOKINGS:'Bookings',BOOKING_SUMMARIES:'BookingSummary',toDate:x=>x?new Date(x):null,getRoomDisplayName:x=>x,ROOM_UNITS:{A:10,B:10},ROOM_MIN_OCCUPANCY:{A:1,B:1},ROOM_MAX_OCCUPANCY:{A:4,B:4},nightsBetween:()=>1,overlappingCount:async()=>0,getNextBookingNumber:async()=> 'WC-INERT',wouldExceedBookingRoomLimit:()=>false,getPackagePricingForBooking:async()=>({_id:'P'}),verifyLockedPricingQuote:async()=>({packageId:'P',baseRate:100,totalPerPerson:100}),normalizePriceModifier:()=>1,getAuthoritativeRoomFee:async()=>0,roundMoney:x=>x,getAllSettings:async()=>({}),createDraftInvoice:async()=>({_id:'INERT_DRAFT'}),mintGoogleAdsCapability:async()=>''});
 const a=read('backend/availability.web.js');let start=a.indexOf('async function updateBookingSummary('),end=a.indexOf('\n}',start)+2;assert.ok(start>0&&end>start);run(c,a.slice(start,end));start=a.indexOf('async function createBookingImpl(');end=a.indexOf('\nexport const createBooking =',start);assert.ok(start>0&&end>start);run(c,a.slice(start,end));return {c,rows,summary,sdk};
}

test('Head to partitioned worker to two saved rooms to actual journal and serialized wire',async()=>{
 const bridge=await fixture({delay:15});
 try {
  const support=fs.readFileSync(path.join(__dirname,'attribution-hotfix.cjs'),'utf8').split('function bookingBackend')[0];
  const box={require,__dirname,console};vm.runInNewContext(support+'\nthis.makePage=page;',box);
  const senderSource=fs.readFileSync(path.join(__dirname,'google-ads-identifier-async.cjs'),'utf8').split('const contacts=')[0];
  const senderBox={require,__dirname,console,structuredClone,Buffer,URLSearchParams,Date};vm.runInNewContext(senderSource+'\nthis.makeSender=fixture;',senderBox);
  const sender=await senderBox.makeSender('sync'),db=persistence();
  const page=await box.makePage({setup:"_summaryRooms=[{roomCode:'A',qty:1,numGuests:1},{roomCode:'B',qty:1,numGuests:1}];",book:async payload=>{
   const result=await db.c.createBookingImpl(payload);return {...result,conversionCapability:sender.booking.conversionCapability};
  }});
  page.c.initClickAttribution=()=>{};
  page.c.waitForClickAttribution=()=>bridge.ready();page.c.getStoredClickIds=bridge.api.getStoredClickIds;page.c.wixData=db.sdk;
  let upload;page.c.recordBookingConversion=input=>{upload=sender.sender.recordBookingConversion(input);return upload;};
  await page.click();await upload;
  assert.equal(db.rows.length,2);assert.equal(db.summary[0].gclid,'INERT_EXACT_FIRST');
  assert.ok(page.payloads.every(p=>p.gclid==='INERT_EXACT_FIRST'));
  assert.equal(sender.wires.length,1);assert.equal(sender.wires[0].events[0].adIdentifiers.gclid,'INERT_EXACT_FIRST');
  assert.equal(page.timers.length,1);assert.equal(page.invoices.length,1);
 } finally {bridge.close();}
});
