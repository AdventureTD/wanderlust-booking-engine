'use strict';
// Dedicated AR loader. No historical verifier, producer or admission writer runs.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),J='GuestBookingInvoiceIssuances';
const pins=JSON.parse(fs.readFileSync(path.join(__dirname,'actual-reader-transport-pins.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const plain=x=>JSON.parse(JSON.stringify(x));
const texts={};
// v2: raw pins retain reviewed custody; byte admission is CRLF-to-LF only.
assert.equal(pins.version,2);assert.equal(pins.bytePolicy,'canonical-LF-v2');
function read(file,pin){const b=fs.readFileSync(file);const normalized=Buffer.from(b.toString('latin1').replace(/\r\n/g,'\n'),'latin1');assert.match(pin.raw,/^[a-f0-9]{64}$/);assert.match(pin.canonicalLF,/^[a-f0-9]{64}$/);assert.equal(sha(normalized),pin.canonicalLF,file);return normalized.toString('utf8');}
function inspect(){
 const visited=new Set();
 for(const [file,pin] of Object.entries(pins.runtime)){
  const text=read(path.join(ROOT,file),pin);texts[file]=text;
  assert.doesNotMatch(text,/\b(?:require\s*\(|import\s*\()/);
  const mod=new vm.SourceTextModule(text);
  assert.deepEqual([...mod.dependencySpecifiers],pin.edges,file+' imports');
  assert.deepEqual([...text.matchAll(/^export (?:async )?function (\w+)/gm)].map(m=>m[1]),pin.exports,file+' exports');
 }
 function visit(file){if(visited.has(file))return;visited.add(file);assert.ok(Object.hasOwn(pins.runtime,file));for(const edge of pins.runtime[file].edges){if(edge.startsWith('backend/'))visit('velo/'+edge+'.js');else assert.ok(['wix-data','wix-auth','wix-secrets-backend.v2','buffer','crypto'].includes(edge));}}
 visit('velo/backend/guestBookingInvoiceDelivery.js');assert.deepEqual([...visited].sort(),Object.keys(pins.runtime).sort());
 assert.ok(!Object.hasOwn(pins.runtime,'velo/backend/guestBookingInvoiceIssuance.js'));
 read(path.join(ROOT,pins.reviewedFenceVerifier.path),pins.reviewedFenceVerifier);
 for(const [file,pin] of Object.entries(pins.artifacts))read(path.join(ROOT,file),pin);
 return {runtimeFiles:visited.size,artifacts:Object.keys(pins.artifacts).length,backendEvaluations:0};
}
function artifact(suffix){const names=Object.keys(pins.artifacts).filter(p=>p.endsWith(suffix));assert.equal(names.length,1);return JSON.parse(read(path.join(ROOT,names[0]),pins.artifacts[names[0]]));}
function fixtures(){
 const a=artifact('completion-authority-distinct-groups.json'),b=artifact('completion-authority-foreign.json');
 assert.equal(a.version,1);assert.equal(b.version,1);
 assert.deepEqual(a.sourceHashes,artifact('distinct-source-pins.json').producer);
 assert.deepEqual(b.sourceHashes,artifact('completion-authority-dependencies.json').files);
 const ev=artifact('retained-native-evidence.json');assert.equal(ev.exit,0);
 const final=ev.stderr.filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).at(-1);
 for(const [k,v] of Object.entries(a.db.rows))assert.deepEqual(final.rows[k],v,k+' retained writer equality');
 const journal=final.rows[J];assert.deepEqual(journal.map(r=>r.kind),['INITIAL_ISSUANCE','PREPARED','START','ACK']);
 for(const row of journal){assert.equal(ev.trace.filter(e=>e.op==='insert'&&e.collection===J&&e.id===row._id).length,1);assert.equal(ev.trace.filter(e=>e.op==='insertAck'&&e.collection===J&&e.id===row._id).length,1);}
 return {a,b,journal};
}
function replaceOnce(text,old,next){assert.equal(text.split(old).length,2,old);return text.replace(old,next);}
// Instrumentation is observer-only except private test enrollment/local clock/OFF.
// It never supplies or rewrites a completion/projection result.
function instrument(file,text){
 if(file.endsWith('/guestBookingInvoiceTransportAuth.js'))text+='\nexport function arEnroll(v){return registerVerifiedTransportRequest(v);}\ntransportEnabled=()=>arEnabled();\n';
 if(file.endsWith('/guestBookingCompletionAuthority.js')){
  text=replaceOnce(text,'export async function readTransportBoundGuestBookingCompletion(ctx){','async function actualCompletionAuthority(ctx){');
  text+='\nexport async function readTransportBoundGuestBookingCompletion(ctx){await arEvent({phase:"readerEntry"});const result=await actualCompletionAuthority(ctx);await arEvent({phase:"readerExit",result});return result;}\n';
  text=replaceOnce(text,'const found=await store.exact(c,key,category);','await arEvent({phase:"retainedAwait",category,collection:c,id:key});\n    const found=await store.exact(c,key,category);\n    await arEvent({phase:"retainedReturn",category,collection:c,id:key});');
 }
 return text;
}
async function worker(f,journal,hook=async()=>{},contextChanges={}){
 const db=structuredClone(f.db);db.rows[J]=structuredClone(journal);
 const trace=[],cache=new Map();let now=1800010000000,enabled=true,position=0;
 const config={siteOrigin:'https://fixture.example',renderOrigin:'https://wanderlust-invoice-service.onrender.com',channel:{activeKid:'c',keys:[{kid:'c',keyHex:'4'.repeat(64)}]},scope:{activeKid:'s',keys:[{kid:'s',keyHex:'5'.repeat(64)}]}};
 const controls={db,trace,config,expire:()=>{now=1800010900000;},off:()=>{enabled=false;},revoke:()=>{config.scope.keys[0].keyHex='9'.repeat(64);},get position(){return position;}};
 async function event(e){if(e.phase==='readerEntry')position++;const entry={...plain(e),position};trace.push(entry);return hook(entry,controls);}
 const context=vm.createContext({Buffer,arEvent:event,arEnabled:()=>enabled});
 // Keep native same-realm Date prototype; only the sampled clock is injected.
 context.arNow=()=>now;vm.runInContext('Date.now=arNow;',context);
 const realm=x=>vm.runInContext('('+JSON.stringify(x)+')',context);
 const collections=new Set([...Object.keys(db.rows),'BookingPayments',J]);
 const wix={query(collection){assert.ok(collections.has(collection),'undeclared read '+collection);const predicates=[];let cap=100,sorted=false;
  const q={eq(k,v){predicates.push([k,v,false]);return q;},gt(k,v){predicates.push([k,v,true]);return q;},limit(n){cap=n;return q;},ascending(k){assert.equal(k,'_id');sorted=true;return q;},async find(options){
   assert.deepEqual(plain(options),{suppressAuth:true,suppressHooks:true,consistentRead:true});
   const override=await event({phase:'find',collection,predicates,limit:cap});
   if(override?.page)return override.page;
   let rows=override?.rows??(db.rows[collection]||[]).filter(row=>predicates.every(([k,v,gt])=>gt?row[k]>v:row[k]===v));
   if(sorted)rows=rows.slice().sort((a,b)=>a._id<b._id?-1:a._id>b._id?1:0);
   return {items:realm(rows.slice(0,cap)),hasNext(){return rows.length>cap;}};
  }};return q;},insert(collection,row,options){
   assert.equal(collection,J,'booking/receipt/producer mutations forbidden');assert.ok(['PREPARED','START','ACK'].includes(row.kind),'admission writer forbidden');
   assert.deepEqual(plain(options),{suppressAuth:true,suppressHooks:true});
   trace.push({phase:'nativeAttempt',position,collection,row:plain(row)});
   return (async()=>{await event({phase:'beforeNative',collection,row});if(db.rows[J].some(r=>r._id===row._id))throw Error('duplicate');db.rows[J].push(plain(row));await event({phase:'nativeEffect',collection,row});trace.push({phase:'nativeAck',position,collection,row:plain(row)});return realm(row);})();
  }};
 const sdk={'wix-data':{default:wix},'wix-auth':{elevate:f=>f},buffer:{Buffer},crypto:{...crypto,randomBytes(){throw Error('producer RNG forbidden');}},'wix-secrets-backend.v2':{secrets:{async getSecretValue(name){
  await event({phase:'secret',name});const values={WBE_GUEST_BOOKING_KEYS:JSON.stringify(db.keys),WBE_GUEST_INVOICE_SITE_ORIGIN:config.siteOrigin,WBE_INVOICE_SERVICE_URL:config.renderOrigin,WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify(config.channel),WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify(config.scope)};assert.ok(Object.hasOwn(values,name),'undeclared secret');return realm({value:values[name]});
 }}}};sdk.crypto.default=sdk.crypto;
 async function load(name){if(cache.has(name))return cache.get(name);let mod;
  if(Object.hasOwn(sdk,name)){const values=sdk[name];mod=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context,identifier:name});}
  else {assert.match(name,/^backend\/[A-Za-z0-9]+$/);const file='velo/'+name+'.js';assert.ok(Object.hasOwn(texts,file),'closed actual module '+name);mod=new vm.SourceTextModule(instrument(file,texts[file]),{context,identifier:name});}
  cache.set(name,mod);return mod;
 }
 const main=await load('backend/guestBookingInvoiceDelivery');await main.link((spec,ref)=>{if(ref.identifier.startsWith('backend/'))assert.ok(pins.runtime['velo/'+ref.identifier+'.js'].edges.includes(spec),'per-consumer edge');return load(spec);});await main.evaluate();
 const auth=cache.get('backend/guestBookingInvoiceTransportAuth').namespace,reader=cache.get('backend/guestBookingCompletionAuthority').namespace;
 assert.deepEqual(Object.keys(reader).sort(),['readRecoveredGuestBookingCompletion','readTransportBoundGuestBookingCompletion']);
 assert.equal(typeof reader.readTransportBoundGuestBookingCompletion,'function');
 const receipt=f.db.rows.GuestBookingCompletions[0],root=journal.find(r=>r.kind==='INITIAL_ISSUANCE');
 const original={siteOrigin:config.siteOrigin,renderOrigin:config.renderOrigin,audience:f.db.keys.audience,...f.expected,issuanceId:root?root._id:'1'.repeat(64),scopeVersion:1,purpose:'guest-invoice-service',revision:'initial',scopeId:'6'.repeat(64),issuedAtMs:now,expiresAtMs:now+900000,scopeKid:'s',channelKid:'c',scopeKeyIdentity:'5'.repeat(64),channelKeyIdentity:'4'.repeat(64),sealedScopeIdentity:'retained-reader-fixture',direction:'render-to-wix',method:'POST',path:'/_functions/guestInvoiceJournal',requestId:'7'.repeat(64),requestBodyDigest:'8'.repeat(64),...contextChanges};
 const ctx=auth.arEnroll(original);assert.ok(Object.isFrozen(ctx));assert.ok(Object.isFrozen(auth.transportExpectation(ctx)));
 const calls=[];
 async function call(operation,payload={},legacy=false){const start=trace.length,before=plain(db.rows);const result=plain(await (legacy?main.namespace.guestBookingInvoiceDeliveryOperation(...Object.values(f.expected),operation,realm(payload)):main.namespace.guestBookingInvoiceDeliveryBoundOperation(ctx,operation,realm(payload))));const witness={operation,legacy,result,before,after:plain(db.rows),trace:trace.slice(start),loaded:[...cache.keys()].sort()};calls.push(witness);return witness;}
 return {call,db,trace,calls,controls,ctx,original,auth,reader,realm,expected:f.expected,receipt};
}
module.exports={inspect,fixtures,worker,sha,plain,J,pins,instrument};
