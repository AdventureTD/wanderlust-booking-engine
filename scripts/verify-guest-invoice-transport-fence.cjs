'use strict';
// Finite actual-delivery tests. Completion is an explicit synthetic authority seam.
// No producer, historical verifier, endpoint, HTTP client or provider is loaded.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const witnesses=[];let currentCase=null;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const key=(domain,values)=>sha(domain+'\0'+JSON.stringify(values));
const file=n=>fs.readFileSync(path.join(ROOT,'velo/backend/'+n+'.js'),'utf8').replace(/\r\n/g,'\n');
const delivery=file('guestBookingInvoiceDelivery');
const authPath=path.join(ROOT,'velo/backend/guestBookingInvoiceTransportAuth.js');
const hasAuth=fs.existsSync(authPath);
const authSource=hasAuth?file('guestBookingInvoiceTransportAuth'):null;
const imports=s=>[...s.matchAll(/^import\s+.+?\s+from\s+['"]([^'"]+)['"];?$/gm)].map(m=>m[1]).sort();
// Source graph checked before compiling/evaluating any backend code.
assert.deepEqual(imports(delivery),['backend/guestBookingCompletionAuthority',...(hasAuth?['backend/guestBookingInvoiceTransportAuth']:[]),'crypto','wix-data'].sort());
if(hasAuth) assert.deepEqual(imports(authSource),['backend/guestBookingInvoiceAuthorityConfig','wix-auth','wix-secrets-backend.v2'].sort());
console.log('SOURCE_GRAPH_PASS: actual Delivery/Auth; synthetic CompletionAuthority/audience + inert SDK. No transitive runtime/producers.');
function compile(source,bindings,exportNames,extra='') {
  source=source.replace(/^import\s+.+?\s+from\s+['"][^'"]+['"];?\n/gm,'').replace(/export /g,'');
  return vm.compileFunction(source+'\n'+extra+'\nreturn {'+exportNames.join(',')+'};',Object.keys(bindings))(...Object.values(bindings));
}
const O='a'.repeat(64),A=sha('wbe.acceptance-id.v2\0'+O),D='d'.repeat(64),J='GuestBookingInvoiceIssuances';
const receipt={_id:'gbc1-'+A,audience:'fixture',acceptanceId:A,operationId:O,rootDigest:D,recipientBindingDigest:'e'.repeat(64),projectionDigest:'f'.repeat(64),financialDigest:'1'.repeat(64),projectionCanonical:'{"fixture":"synthetic"}',recipient:'fixture@example.test',bookingNumber:'synthetic-booking'};
const I=key('wbe.guest-initial-invoice.v1',[receipt.audience,receipt._id,'initial',receipt.recipientBindingDigest]);
const root={_id:I,schemaVersion:1,kind:'INITIAL_ISSUANCE',revision:'initial',audience:receipt.audience,acceptanceId:A,operationId:O,rootDigest:D,receiptId:receipt._id,projectionDigest:receipt.projectionDigest,financialDigest:receipt.financialDigest,recipientBindingDigest:receipt.recipientBindingDigest,projectionCanonical:receipt.projectionCanonical,to:receipt.recipient,cc:'info@wanderlustcaribbean.com',from:'info@wanderlustcaribbean.com'};
const preparedInput={encoded:Buffer.from('inert journal MIME, not renderer evidence').toString('base64'),mimeDigest:sha('inert journal MIME, not renderer evidence'),pdfDigest:'2'.repeat(64),rendererVersion:'word'};
const artifact={_id:key('wbe.guest-invoice-delivery.v1',[I,'PREPARED']),kind:'PREPARED',issuanceId:I,documentDigest:root.projectionDigest,...preparedInput,artifactDigest:key('wbe.guest-invoice-artifact.v1',[I,root.projectionDigest,preparedInput.mimeDigest,preparedInput.pdfDigest,'word'])};
const startInput={artifactDigest:artifact.artifactDigest,invocationNonce:'3'.repeat(64)};
const start={_id:key('wbe.guest-invoice-delivery.v1',[I,'START']),kind:'START',issuanceId:I,documentDigest:root.projectionDigest,...startInput};
const ackInput={...startInput,providerMessageId:'inert-provider-id'};
const ack={_id:key('wbe.guest-invoice-delivery.v1',[I,'ACK']),kind:'ACK',issuanceId:I,documentDigest:root.projectionDigest,...ackInput};
function worker(operation,hook=async()=>{}) {
 const rows=[structuredClone(root),...(operation==='commitArtifact'?[]:[structuredClone(artifact)]),...(operation==='recordAck'?[structuredClone(start)]:[])];
 const trace=[]; let now=1000, enabled=true;
 const config={siteOrigin:'https://fixture.example',renderOrigin:'https://wanderlust-invoice-service.onrender.com',audience:'fixture',channel:{activeKid:'c',keys:[{kid:'c',keyHex:'4'.repeat(64)}]},scope:{activeKid:'s',keys:[{kid:'s',keyHex:'5'.repeat(64)}]}};
 const event=async e=>{trace.push(e); await hook(e,{config,rows,trace,expire:()=>{now=901000;},off:()=>{enabled=false;}});};
 let auth;
 // Closure-only fixture enabled accessor; never a production export.
 if(hasAuth) {
  const secrets={async getSecretValue(name){await event({phase:'config',name});const values={WBE_GUEST_INVOICE_SITE_ORIGIN:config.siteOrigin,WBE_INVOICE_SERVICE_URL:config.renderOrigin,WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify(config.channel),WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify(config.scope)};assert.ok(Object.hasOwn(values,name));return {value:values[name]};}};
  auth=compile(authSource,{secrets,elevate:f=>f,readGuestBookingInvoiceSiteAudience:async()=>config.audience,Date:{now:()=>now},enabledFixture:()=>enabled},['transportExpectation','withTransportFence','enrollFixture'],'function enrollFixture(value){return registerVerifiedTransportRequest(value);}\ntransportEnabled=()=>enabledFixture();');
 }
 const original={siteOrigin:config.siteOrigin,renderOrigin:config.renderOrigin,audience:'fixture',acceptanceId:A,operationId:O,rootDigest:D,issuanceId:I,scopeVersion:1,purpose:'guest-invoice-service',revision:'initial',scopeId:'6'.repeat(64),issuedAtMs:1000,expiresAtMs:901000,scopeKid:'s',channelKid:'c',scopeKeyIdentity:'5'.repeat(64),channelKeyIdentity:'4'.repeat(64),sealedScopeIdentity:'fixture-sealed-scope',direction:'render-to-wix',method:'POST',path:'/_functions/guestInvoiceJournal',requestId:'7'.repeat(64),requestBodyDigest:'8'.repeat(64)};
 const ctx=hasAuth?auth.enrollFixture(original):Object.freeze({});
 async function completion(a,o,d){await event({phase:'authority'});return {status:'VERIFIED_COMPLETION',receipt:structuredClone(receipt)};}
 async function boundCompletion(c){const x=auth.transportExpectation(c); return auth.withTransportFence(c,'subjectRead',()=>completion(x.acceptanceId,x.operationId,x.rootDigest));}
 const wixData={query(collection){const predicates=[];let limit;
  const q={eq(k,v){predicates.push([k,v]);return q;},limit(n){limit=n;return q;},async find(){await event({phase:'find',collection,predicates:structuredClone(predicates)});const selected=(collection===J?rows:[]).filter(r=>predicates.every(([k,v])=>r[k]===v));return {items:structuredClone(selected.slice(0,limit)),hasNext(){trace.push({phase:'hasNext',collection});if(worker.hasNextHook)worker.hasNextHook(collection,{config,expire:()=>{now=901000;}});return selected.length>limit;}};}};return q;},
  insert(collection,row,options){assert.equal(collection,J);assert.deepEqual(options,{suppressAuth:true,suppressHooks:true});trace.push({phase:'nativeAttempt',kind:row.kind});return (async()=>{await event({phase:'beforeNativeEffect',kind:row.kind});if(rows.some(r=>r._id===row._id))throw Error('duplicate');rows.push(structuredClone(row));await event({phase:'nativeAck',kind:row.kind});return structuredClone(row);})();}};
 const names=['guestBookingInvoiceDeliveryOperation',...(hasAuth?['guestBookingInvoiceDeliveryBoundOperation']:[])];
 const api=compile(delivery,{wixData,createHash:crypto.createHash,readRecoveredGuestBookingCompletion:completion,readTransportBoundGuestBookingCompletion:boundCompletion,transportExpectation:auth?.transportExpectation,withTransportFence:auth?.withTransportFence},names);
 const payload=operation==='commitArtifact'?preparedInput:operation==='tryStart'?startInput:operation==='recordAck'?ackInput:{};
 return {ctx,original,auth,config,rows,trace,api,run:async(legacy=false,c=ctx)=>{const before=structuredClone(rows);const result=await (legacy||!hasAuth?api.guestBookingInvoiceDeliveryOperation(A,O,D,operation,payload):api.guestBookingInvoiceDeliveryBoundOperation(c,operation,payload));witnesses.push({id:currentCase,operation,legacy,before,after:structuredClone(rows),trace:structuredClone(trace),result:structuredClone(result)});return result;}};
}
const tests=new Map();const add=(id,fn)=>tests.set(id,fn);
add('F01_expiry_after_prewrite_authority',async()=>{
 let counts=0;const w=worker('commitArtifact',async(e,c)=>{if(e.phase==='find'&&e.collection==='BookingPayments'&&++counts===2)c.expire();});
 const before=structuredClone(w.rows),result=await w.run();
 assert.equal(w.trace.filter(e=>e.phase==='nativeAttempt').length,0,'expired prewrite authority must cause zero native attempts');
 assert.notEqual(result.won,true);assert.deepEqual(w.rows,before);
});
const invalidations={expiry:c=>c.expire(),off:c=>c.off(),site:c=>{c.config.siteOrigin='https://other.example';},audience:c=>{c.config.audience='other';},channelRemoved:c=>{c.config.channel={activeKid:'next',keys:[{kid:'next',keyHex:'9'.repeat(64)}]};},scopeRemoved:c=>{c.config.scope={activeKid:'next',keys:[{kid:'next',keyHex:'9'.repeat(64)}]};},channelReplaced:c=>{c.config.channel.keys[0].keyHex='9'.repeat(64);},scopeReplaced:c=>{c.config.scope.keys[0].keyHex='9'.repeat(64);}};
for(const operation of ['commitArtifact','tryStart','recordAck']) {
 for(const [change,mutate] of Object.entries(invalidations)) for(const timing of ['prewrite','finalRefresh']) {
  add(`F02_${operation}_${change}_${timing}`,async()=>{
   let payments=0,refreshes=0,changed=0;
   const w=worker(operation,async(e,c)=>{
    if(e.phase==='find'&&e.collection==='BookingPayments')payments++;
    if(e.phase==='config'&&e.name==='WBE_GUEST_INVOICE_SITE_ORIGIN')refreshes++;
    if(!changed&&((timing==='prewrite'&&e.phase==='find'&&e.collection==='BookingPayments'&&payments===2)||(timing==='finalRefresh'&&e.phase==='config'&&e.name==='WBE_GUEST_INVOICE_SITE_ORIGIN'&&refreshes===3))){mutate(c);changed++;}
   });
   const before=structuredClone(w.rows),r=await w.run();assert.equal(changed,1);
   assert.equal(w.trace.filter(e=>e.phase==='nativeAttempt').length,0);assert.deepEqual(w.rows,before);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.root,undefined);assert.notEqual(r.won,true);
  });
 }
 add(`F03_${operation}_positive_rotation`,async()=>{
  let rotated=0;const w=worker(operation,async(e,c)=>{if(e.phase==='authority'&&!rotated){for(const ring of ['channel','scope']){c.config[ring].keys.push({kid:'next',keyHex:'9'.repeat(64)});c.config[ring].activeKid='next';}rotated++;}});
  const r=await w.run();assert.equal(rotated,1);assert.equal(w.trace.filter(e=>e.phase==='nativeAttempt').length,1);assert.deepEqual(w.rows.at(-1),operation==='commitArtifact'?artifact:operation==='tryStart'?start:ack);
  if(operation==='tryStart')assert.equal(r.won,true);else assert.equal(r.status,operation==='recordAck'?'PROVIDER_ACCEPTED':'READY');
  const before=structuredClone(w.rows),attempts=w.trace.filter(e=>e.phase==='nativeAttempt').length;const replay=await w.run();assert.notEqual(replay.won,true);assert.equal(w.trace.filter(e=>e.phase==='nativeAttempt').length,attempts);assert.deepEqual(w.rows,before);
 });
 for(const change of ['expiry','off','channelReplaced','scopeReplaced'])add(`F04_${operation}_${change}_nativeAck`,async()=>{
  let changed=0;const w=worker(operation,async(e,c)=>{if(e.phase==='nativeAck'){invalidations[change](c);changed++;}});
  const before=structuredClone(w.rows),r=await w.run();assert.equal(changed,1);assert.notEqual(r.won,true);assert.equal(r.root,undefined);assert.equal(w.trace.filter(e=>e.phase==='nativeAttempt').length,1);
  assert.deepEqual(w.rows,[...before,operation==='commitArtifact'?artifact:operation==='tryStart'?start:ack]);
  const retained=structuredClone(w.rows);const replay=await w.run();assert.notEqual(replay.won,true);assert.equal(w.trace.filter(e=>e.phase==='nativeAttempt').length,1);assert.deepEqual(w.rows,retained);
 });
 add(`F05_${operation}_legacy_unchanged`,async()=>{
  const w=worker(operation,async(e,c)=>{if(e.phase==='authority'){c.expire();c.off();c.config.audience='other';}});
  const r=await w.run(true);assert.equal(w.trace.filter(e=>e.phase==='config').length,0);assert.equal(w.trace.filter(e=>e.phase==='nativeAttempt').length,1);
  if(operation==='tryStart')assert.equal(r.won,true);else assert.equal(r.status,operation==='recordAck'?'PROVIDER_ACCEPTED':'READY');
  assert.equal((await w.api.guestBookingInvoiceDeliveryOperation(A,O,D,'readIssuance',{},{})).status,'DENIED');
 });
}
for(const phase of ['keyedReadback','finalAuthority','resultGrant','responseRelease'])add(`F06_START_expiry_${phase}`,async()=>{
 let native=false,changed=0,refreshes=0,authorities=0;
 const w=worker('tryStart',async(e,c)=>{
  if(e.phase==='nativeAck')native=true;
  if(e.phase==='authority')authorities++;
  if(e.phase==='config'&&e.name==='WBE_GUEST_INVOICE_SCOPE_KEYS')refreshes++;
  if(!changed&&((phase==='keyedReadback'&&native&&e.phase==='find'&&e.collection===J)||(phase==='finalAuthority'&&e.phase==='authority'&&authorities===3)||(phase==='resultGrant'&&e.phase==='config'&&e.name==='WBE_GUEST_INVOICE_SCOPE_KEYS'&&refreshes===5)||(phase==='responseRelease'&&e.phase==='config'&&e.name==='WBE_GUEST_INVOICE_SCOPE_KEYS'&&refreshes===6))){c.expire();changed++;}
 });
 const r=await w.run();assert.equal(changed,1);assert.equal(r.status,'OWNER_REVIEW_REQUIRED');assert.notEqual(r.won,true);assert.deepEqual(w.rows,[root,artifact,start]);assert.equal(w.trace.filter(e=>e.phase==='nativeAttempt').length,1);
});
add('F07_context_custody',async()=>{
 const w=worker('tryStart');assert.equal(Object.isFrozen(w.ctx),true);const e=w.auth.transportExpectation(w.ctx);assert.equal(Object.isFrozen(e),true);assert.equal(Object.hasOwn(e,'scopeKeyIdentity'),false);
 w.original.audience='other';w.original.expiresAtMs=0;assert.equal(w.auth.transportExpectation(w.ctx).audience,'fixture');
 for(const fake of [undefined,null,true,()=>true,{},Object.freeze({...w.ctx}),{verified:true,...w.original}]) {const r=await w.api.guestBookingInvoiceDeliveryBoundOperation(fake,'tryStart',startInput);assert.notEqual(r.won,true);}
 assert.equal(w.trace.length,0);assert.equal((await w.run()).won,true);
});
add('F08_hasNext_expiry',async()=>{
 let n=0;worker.hasNextHook=(collection,c)=>{if(collection==='BookingPayments'&&++n===2)c.expire();};
 try{const w=worker('tryStart'),r=await w.run();assert.equal(n,2);assert.equal(r.status,'UNAVAILABLE');assert.equal(w.trace.filter(e=>e.phase==='nativeAttempt').length,0);}finally{worker.hasNextHook=null;}
});
for(const kind of ['beforeEffect','lostAck','unreadableReadback'])add(`F09_START_${kind}`,async()=>{
 let native=false;const w=worker('tryStart',async(e)=>{if(e.phase==='nativeAck')native=true;if((kind==='beforeEffect'&&e.phase==='beforeNativeEffect')||(kind==='lostAck'&&e.phase==='nativeAck')||(kind==='unreadableReadback'&&native&&e.phase==='find'))throw Error('inert native failure');});
 const r=await w.run();assert.equal(r.status,'OWNER_REVIEW_REQUIRED');assert.notEqual(r.won,true);assert.equal(w.trace.filter(e=>e.phase==='nativeAttempt').length,1);assert.deepEqual(w.rows,kind==='beforeEffect'?[root,artifact]:[root,artifact,start]);
});
for(const operation of ['commitArtifact','recordAck','readIssuance'])add(`F10_${operation}_expired_existing`,async()=>{
 let changed=0;const w=worker(operation,async(e,c)=>{if(!changed&&e.phase==='find'&&e.collection===J&&e.predicates.some(([,v])=>v===ack._id)){c.expire();changed++;}});
 if(operation==='commitArtifact')w.rows.push(structuredClone(artifact));if(operation==='recordAck')w.rows.push(structuredClone(ack));
 const before=structuredClone(w.rows),r=await w.run();assert.equal(changed,1);assert.notEqual(r.won,true);assert.equal(r.root,undefined);assert.equal(w.trace.filter(e=>e.phase==='nativeAttempt').length,0);assert.deepEqual(w.rows,before);
});
const selected=process.argv.slice(2);if(selected[0]==='--list'){assert.equal(selected.length,1);console.log(JSON.stringify([...tests.keys()]));process.exit(0);}assert.ok(selected.length,'explicit finite IDs required');assert.ok(selected.every(id=>tests.has(id)),'unknown selector');
(async()=>{const watchdog=setTimeout(()=>{console.error('WATCHDOG');process.exit(2);},30000);try{let count=0;for(const id of selected){currentCase=id;await tests.get(id)();console.log('PASS '+id);count++;}assert.equal(count,selected.length);console.log(JSON.stringify({completed:count,ids:selected,nativeProcess:'node',providerCalls:0}));}finally{clearTimeout(watchdog);if(process.env.FENCE_EVIDENCE_PATH)fs.writeFileSync(process.env.FENCE_EVIDENCE_PATH,JSON.stringify(witnesses,null,2));}})().catch(e=>{console.error(e);process.exitCode=1;});
