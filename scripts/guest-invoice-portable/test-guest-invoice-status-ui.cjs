'use strict';
// New finite local integration test, not inherited exact-byte fixture admission.
// Reuse unchanged booking SDK/compiler; invoice-only in-memory extension.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,verify,manifest,fixtureCrypto}=require('./custody.cjs');verify();
const OUT=process.env.GI_OUTPUT;assert.ok(OUT,'GI_OUTPUT required');
const {fixture,detach}=require(ROOT+'/scripts/guest-book-confirm-search/sdk.cjs');
const vector=JSON.parse(fs.readFileSync(ROOT+'/scripts/guest-summary/booking-guest-offer-public-vector.json'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function graph(){return {graph:manifest.graph};}
function setup(history){
 const config={WBE_GUEST_INVOICE_ENABLED:'true',WBE_GUEST_INVOICE_SITE_ORIGIN:'https://www.wanderlustcaribbean.com',WBE_INVOICE_SERVICE_URL:'https://wanderlust-invoice-service.onrender.com',WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'11'.repeat(32)}]}),WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'22'.repeat(32)}]})};
 const f=fixture({mode:'SDK01',initial:history.db,secretValues:{...vector.secrets,WBE_GUEST_INVOICE_ENABLED:'true',WBE_GUEST_INVOICE_SITE_ORIGIN:'https://www.wanderlustcaribbean.com',WBE_INVOICE_SERVICE_URL:'https://wanderlust-invoice-service.onrender.com',WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'11'.repeat(32)}]}),WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'22'.repeat(32)}]})}});
 const posts=[];const rows=detach(history.rows),invoiceTrace=[];const original=f.wix; original.insert=async()=>{f.trace.push({op:'FORBIDDEN-WRITE'});throw Error('READONLY fixture forbids booking writes');};
 f.wix={...original,query(c){if(c!=='GuestBookingInvoiceIssuances'&&c!=='BookingPayments')return original.query(c);
 let field,value,n;return {eq(k,v){field=k;value=v;return this;},limit(v){n=v;return this;},async find(options){assert.deepEqual(options,{suppressAuth:true,suppressHooks:true,consistentRead:true});assert.equal(n,c==='BookingPayments'?1:2);assert.equal(field,c==='BookingPayments'?'bookingNumber':'_id');invoiceTrace.push({op:'find',collection:c,field,value});const found=c==='BookingPayments'?[]:rows.filter(r=>r[field]===value);return {items:detach(found),hasNext(){return false;}};}};
 },async insert(){invoiceTrace.push({op:'FORBIDDEN-WRITE'});throw Error('READONLY fixture forbids invoice writes');}};
 const clock={now:vector.now},admission=graph(),vm=require('node:vm'),cache=new Map();
 const ext={'wix-http-functions':{response:v=>v},'wix-secrets-backend':{getSecret:async name=>{throw Error('owner/trusted secret forbidden');}},https:{request(url,options,callback){posts.push({url,options});throw Error('READONLY fixture forbids network');const emitter=new (require('events').EventEmitter)();emitter.end=body=>{posts.at(-1).body=body;queueMicrotask(()=>emitter.emit('error',Error('inert transport unavailable')));};emitter.destroy=()=>{};return emitter;}},crypto:{...fixtureCrypto,default:fixtureCrypto},buffer:{Buffer},'wix-data':{default:f.wix},'wix-auth':{elevate:fn=>fn},'wix-secrets-backend.v2':{secrets:{async getSecretValue(name){if(Object.hasOwn(config,name))return {value:config[name]};return f.secrets.getSecretValue(name);}}},'wix-web-module':{Permissions:{Anyone:'Anyone'},webMethod(permission,fn){assert.equal(permission,'Anyone');return fn;}}};
 function load(id){if(cache.has(id))return cache.get(id);let m;
 if(ext[id]){const values=ext[id];m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{identifier:id});}
 else {assert.ok(admission.graph[id]);const raw=fs.readFileSync(ROOT+'/'+id);assert.equal(sha(Buffer.from(raw.toString().replace(/\r\n/g,'\n'))),admission.graph[id].canonical_lf_sha256);m=new vm.SourceTextModule(raw.toString(),{identifier:id});}
 cache.set(id,m);return m;}
 async function api(n){const m=load('velo/backend/'+n+'.js');if(m.status==='unlinked')await m.link((spec,parent)=>{const edge=admission.graph[parent.identifier].imports.find(e=>e.specifier===spec);assert.ok(edge);return load(edge.target||spec);});if(m.status==='linked')await m.evaluate();return m.namespace;}
 return {f,rows,invoiceTrace,clock,admission,posts,config,load:api};
}

const NativeDate=Date;let now=vector.now;
function FixtureDate(...args){return args.length?new NativeDate(...args):new NativeDate(now);}
FixtureDate.prototype=NativeDate.prototype;FixtureDate.now=()=>now;FixtureDate.parse=NativeDate.parse;FixtureDate.UTC=NativeDate.UTC;global.Date=FixtureDate;
const BASE=OUT;
function retained(name='happy-final') {
 const file=BASE+'/'+name+'/fresh-native.json',h=JSON.parse(fs.readFileSync(file));
 // Retained native producer snapshots, not synthetic authority. Restore only native Date fields.
 function revive(v){if(!v||typeof v!=='object')return;for(const k of Object.keys(v)){if(['_createdDate','_updatedDate'].includes(k)&&typeof v[k]==='string')v[k]=new NativeDate(v[k]);else revive(v[k]);}}
 revive(h.db);revive(h.rows);return h;
}
function credentialFor(root,purpose='guest-access'){
 // NEW independent fixture-only credential reconstruction using inert original key.
 // Does not create, change or authorize any retained acceptance/completion/ACK row.
 const config=JSON.parse(vector.secrets.WBE_GUEST_BOOKING_KEYS),kid=root.credentialKid;
 const claims=[1,purpose,root.audience,root.operationId,root.intentDigest,root.quoteDigest,root.issuedAtMs,root.offerExpiresAtMs];
 const wire='wgb1.'+kid+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url');
 const key=config.keys.find(k=>k.kid===kid).keyHex;
 return {token:wire+'.'+crypto.createHmac('sha256',Buffer.from(key,'hex')).update('WBE-GUEST-BOOKING-CREDENTIAL\0'+wire).digest('base64url'),capsule:root.capsule};
}
async function check(history,expected,alter){
 const s=setup(history),api=await s.load('guestBookingSummaryService.web');
 const c=credentialFor(history.db.GuestBookingAcceptances[0]);if(alter)alter(c,s);
 const before=JSON.stringify({db:s.f.snapshot(),rows:s.rows});
 const result=await api.readGuestBookingSummaryStatus(c);
 assert.equal(result.status,'CONFIRMED',JSON.stringify(result));
 assert.equal(result.invoiceStatus,expected,'authenticated retained invoice projection missing/wrong');
 assert.deepEqual(Object.keys(result).sort(),['bookingNumber','invoiceStatus','status']);
 assert.equal(JSON.stringify({db:s.f.snapshot(),rows:s.rows}),before);
 assert.equal(s.posts.length,0);assert.ok(s.invoiceTrace.every(t=>t.op==='find'));assert.ok(s.f.trace.every(t=>t.op!=='FORBIDDEN-WRITE'));
 return {result,reads:s.f.trace.filter(t=>t.op==='find').length,invoiceReads:s.invoiceTrace.length};
}
async function main(){
 const h=retained();
 // Exact applied issuance prefix in original producer trace, no made-up ACK.
 h.rows=h.rows.filter(r=>r.kind==='INITIAL_ISSUANCE');
 const results=[{id:'STATUS-PENDING',...await check(h,'PENDING')}];
 results.push({id:'STATUS-VERIFIED-ACK',...await check(retained(),'PROVIDER_ACCEPTED')});
 for(const name of ['start-loss-final','provider-loss-final','journal-start-loss-final'])results.push({id:'STATUS-'+name,...await check(retained(name),'OWNER_REVIEW_REQUIRED')});
 for(const field of ['artifactDigest','invocationNonce','providerMessageId','documentDigest','issuanceId']){
  const bad=retained();bad.rows.find(r=>r.kind==='ACK')[field]=field==='providerMessageId'?'invalid id': 'ff'.repeat(32);
  results.push({id:'STATUS-CORRUPT-ACK-'+field,...await check(bad,'UNAVAILABLE')});
 }
 const corrupt=retained();corrupt.rows.find(r=>r.kind==='PREPARED').encoded='YQ==';results.push({id:'STATUS-CORRUPT-ARTIFACT',...await check(corrupt,'UNAVAILABLE')});
 const absent=retained();absent.rows=[];results.push({id:'STATUS-INVOICE-FAILURE-BOOKING-CONFIRMED',...await check(absent,'UNAVAILABLE')});
 const other=retained('ingress-loss-final');assert.notEqual(other.db.GuestBookingAcceptances[0]._id,retained().db.GuestBookingAcceptances[0]._id);
 const borrowed=retained();borrowed.rows=other.rows;results.push({id:'STATUS-OTHER-ISSUANCE-DENIED',...await check(borrowed,'UNAVAILABLE')});
 const s=setup(retained()),api=await s.load('guestBookingSummaryService.web'),c=credentialFor(retained().db.GuestBookingAcceptances[0]);
 const n=s.f.trace.length;
 assert.deepEqual(await api.readGuestBookingSummaryStatus({...c,capsule:other.db.GuestBookingAcceptances[0].capsule}),{status:'DENIED'});
 assert.equal(s.invoiceTrace.length,0);results.push({id:'STATUS-OTHER-GUEST-DENIED'});
 now=retained().db.GuestBookingAcceptances[0].offerExpiresAtMs;
 assert.deepEqual(await api.readGuestBookingSummaryStatus(c),{status:'DENIED'});assert.equal(s.invoiceTrace.length,0);results.push({id:'STATUS-EXPIRED-DENIED'});now=vector.now;
 const originalQuery=s.f.wix.query;s.f.wix.query=function(collection){const q=originalQuery(collection);if(collection==='GuestBookingInvoiceIssuances'){const find=q.find;q.find=async function(...args){const r=await find.apply(this,args);now=retained().db.GuestBookingAcceptances[0].offerExpiresAtMs;return r;};}return q;};
 assert.deepEqual(await api.readGuestBookingSummaryStatus(c),{status:'DENIED'});results.push({id:'STATUS-EXPIRED-DURING-INVOICE-READ-DENIED'});now=vector.now;
 const failedRead=await check(retained(),'UNAVAILABLE',(_,s)=>{const query=s.f.wix.query;s.f.wix.query=function(c){if(c==='GuestBookingInvoiceIssuances')throw Error('inert invoice store unavailable');return query(c);};});results.push({id:'STATUS-THROWN-INVOICE-FAILURE-BOOKING-CONFIRMED',...failedRead});
 assert.equal(new Set(results.map(r=>r.id)).size,17);console.log(JSON.stringify({status:'PASS',count:results.length,results}));
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={setup,retained,credentialFor,check,vector,setNow:v=>now=v};
