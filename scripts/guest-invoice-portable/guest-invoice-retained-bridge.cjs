'use strict';
// New finite local integration test, not inherited exact-byte fixture admission.
// Reuse unchanged booking SDK/compiler; invoice-only in-memory extension.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,verify,manifest,fixtureCrypto}=require('./custody.cjs');verify();
const OUT=process.argv[2];const MODE=process.argv[3]||'happy';let active,pending;const emit=v=>console.log(JSON.stringify(v));
const {fixture,detach}=require(ROOT+'/scripts/guest-book-confirm-search/sdk.cjs');
const vector=JSON.parse(fs.readFileSync(ROOT+'/scripts/guest-summary/booking-guest-offer-public-vector.json'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function graph(){return {graph:manifest.graph};}
function setup(){
 const config={WBE_GUEST_INVOICE_ENABLED:'true',WBE_GUEST_INVOICE_SITE_ORIGIN:'https://www.wanderlustcaribbean.com',WBE_INVOICE_SERVICE_URL:'https://wanderlust-invoice-service.onrender.com',WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'11'.repeat(32)}]}),WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'22'.repeat(32)}]})};
 const f=fixture({initial:{GuestBookingFinancialRevisions:[vector.revisionRow],Rooms:[{_id:'suite',roomCode:'adventure_suite'}]},secretValues:{...vector.secrets,WBE_GUEST_INVOICE_ENABLED:'true',WBE_GUEST_INVOICE_SITE_ORIGIN:'https://www.wanderlustcaribbean.com',WBE_INVOICE_SERVICE_URL:'https://wanderlust-invoice-service.onrender.com',WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'11'.repeat(32)}]}),WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'22'.repeat(32)}]})}});
 const posts=[];const rows=[],invoiceTrace=[];const original=f.wix;
 f.wix={...original,query(c){if(c!=='GuestBookingInvoiceIssuances'&&c!=='BookingPayments')return original.query(c);
 let field,value,n;return {eq(k,v){field=k;value=v;return this;},limit(v){n=v;return this;},async find(options){assert.deepEqual(options,{suppressAuth:true,suppressHooks:true,consistentRead:true});assert.equal(n,c==='BookingPayments'?1:2);assert.equal(field,c==='BookingPayments'?'bookingNumber':'_id');invoiceTrace.push({op:'find',collection:c,field,value});const found=c==='BookingPayments'?[]:rows.filter(r=>r[field]===value);return {items:detach(found),hasNext(){return false;}};}};
 },async insert(c,row,options){if(c!=='GuestBookingInvoiceIssuances')return original.insert(c,row,options);assert.ok(['INITIAL_ISSUANCE','PREPARED','START','ACK'].includes(row.kind));assert.deepEqual(options,{suppressAuth:true,suppressHooks:true});invoiceTrace.push({op:'insert',collection:c,kind:row.kind,id:row._id});if(rows.some(r=>r._id===row._id))throw Error('duplicate');rows.push(detach(row));if(MODE==='start-loss'&&row.kind==='START')throw Error('inert native START applied then lost ACK');return detach(row);}};
 const clock={now:vector.now},admission=graph(),vm=require('node:vm'),cache=new Map();
 const ext={'wix-http-functions':{response:v=>v},'wix-secrets-backend':{getSecret:async name=>{throw Error('owner/trusted secret forbidden');}},https:{request(url,options,callback){posts.push({url,options});const emitter=new (require('events').EventEmitter)();emitter.end=body=>{posts.at(-1).body=body;pending={emitter,callback};emit({kind:'dispatch',url,headers:options.headers,bytes:Buffer.from(body).toString('base64'),now:vector.now});};emitter.destroy=()=>{};return emitter;}},crypto:{...fixtureCrypto,default:fixtureCrypto},buffer:{Buffer},'wix-data':{default:f.wix},'wix-auth':{elevate:fn=>fn},'wix-secrets-backend.v2':{secrets:{async getSecretValue(name){if(Object.hasOwn(config,name))return {value:config[name]};return f.secrets.getSecretValue(name);}}},'wix-web-module':{Permissions:{Anyone:'Anyone'},webMethod(permission,fn){assert.equal(permission,'Anyone');return fn;}}};
 function load(id){if(cache.has(id))return cache.get(id);let m;
 if(ext[id]){const values=ext[id];m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{identifier:id});}
 else {assert.ok(admission.graph[id]);const raw=fs.readFileSync(ROOT+'/'+id);assert.equal(sha(Buffer.from(raw.toString().replace(/\r\n/g,'\n'))),admission.graph[id].canonical_lf_sha256);m=new vm.SourceTextModule(raw.toString(),{identifier:id});}
 cache.set(id,m);return m;}
 async function api(n){const m=load('velo/backend/'+n+'.js');if(m.status==='unlinked')await m.link((spec,parent)=>{const edge=admission.graph[parent.identifier].imports.find(e=>e.specifier===spec);assert.ok(edge);return load(edge.target||spec);});if(m.status==='linked')await m.evaluate();return m.namespace;}
 return {f,rows,invoiceTrace,clock,admission,posts,load:api};
}

const NativeDate=Date;
function FixtureDate(...args){return args.length?new NativeDate(...args):new NativeDate(vector.now);}
FixtureDate.prototype=NativeDate.prototype;FixtureDate.now=()=>vector.now;FixtureDate.parse=NativeDate.parse;FixtureDate.UTC=NativeDate.UTC;global.Date=FixtureDate;
const rl=require('readline').createInterface({input:process.stdin});
rl.on('line',async line=>{try{
 const command=JSON.parse(line);
 if(command.kind==='journal'){
  const http=await active.load('http-functions');
  const response=await http.post_guestInvoiceJournal({method:'POST',url:command.url,headers:command.headers,body:{buffer:async()=>Buffer.from(command.bytes,'base64')}});
  emit({kind:'journal',status:response.status,headers:response.headers,bytes:Buffer.from(response.body).toString('base64')});
 }else if(command.kind==='dispatch-result'){
  if(MODE==='ingress-loss')pending.emitter.emit('error',Error('inert ingress response lost'));
  else {const res=new (require('events').EventEmitter)();res.statusCode=command.status;res.headers={};res.destroy=()=>{};pending.callback(res);res.emit('data',Buffer.from(command.body));res.emit('end');}
 }else if(command.kind==='snapshot'){emit({kind:'snapshot',rows:active.rows,db:active.f.snapshot(),trace:active.invoiceTrace});}
 else if(command.kind==='close'){rl.close();}
 }catch(e){emit({kind:'error',error:e.stack});process.exitCode=1;}});
(async()=>{
 active=setup();const api=await active.load('guestBookingSummaryService.web'),{priceGroups,...input}=vector.purchase;
 const offer=await api.prepareGuestBookingSummary({...input,summaryRooms:vector.summaryRooms});assert.equal(offer.status,'OFFER');
 assert.equal((await api.confirmGuestBookingSummary(JSON.parse(JSON.stringify(offer.credential)))).status,'ACCEPTED_PENDING');
 const recovery=await active.load('guestBookingCompletionRecovery');const visits=[];
 for(let i=0;i<64&&!active.rows.length;i++)visits.push(await recovery.recoverGuestBookingCompletionsAndAdmitInvoices());
 assert.equal((await api.readGuestBookingSummaryStatus(offer.credential)).status,'CONFIRMED');
 const before=JSON.stringify(active.f.snapshot());
 const root=active.rows.find(x=>x.kind==='INITIAL_ISSUANCE');assert.ok(root);
 const auth=await active.load('guestBookingInvoiceTransportAuth');
 // Observed retained START/ACK must avoid another production HTTP send entirely.
 const retry=await auth.sendGuestInvoiceForRecoveredAcceptance(root.acceptanceId,root.operationId,root.rootDigest,root._id);
 assert.equal(active.posts.length,1,'retained START or ACK must suppress sender replay');
 assert.equal(JSON.stringify(active.f.snapshot()),before,'invoice failure/delivery cannot mutate booking');
 fs.writeFileSync(OUT+'/fresh-native.json',JSON.stringify({db:active.f.snapshot(),rows:active.rows,invoiceTrace:active.invoiceTrace,trace:active.f.trace,visits,retry,graph:active.admission},null,2));
 emit({kind:'done',retry,stages:active.rows.map(x=>x.kind),posts:active.posts.length,publicStatus:'CONFIRMED'});
})().catch(e=>{emit({kind:'error',error:e.stack});process.exitCode=1;rl.close();});
