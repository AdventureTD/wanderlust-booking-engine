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
function setup(){
 const config={WBE_GUEST_INVOICE_ENABLED:'true',WBE_GUEST_INVOICE_SITE_ORIGIN:'https://www.wanderlustcaribbean.com',WBE_INVOICE_SERVICE_URL:'https://wanderlust-invoice-service.onrender.com',WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'11'.repeat(32)}]}),WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'22'.repeat(32)}]})};
 const f=fixture({initial:{GuestBookingFinancialRevisions:[vector.revisionRow],Rooms:[{_id:'suite',roomCode:'adventure_suite'}]},secretValues:{...vector.secrets,WBE_GUEST_INVOICE_ENABLED:'true',WBE_GUEST_INVOICE_SITE_ORIGIN:'https://www.wanderlustcaribbean.com',WBE_INVOICE_SERVICE_URL:'https://wanderlust-invoice-service.onrender.com',WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'11'.repeat(32)}]}),WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify({activeKid:'local',keys:[{kid:'local',keyHex:'22'.repeat(32)}]})}});
 const posts=[];const rows=[],invoiceTrace=[];const original=f.wix;
 f.wix={...original,query(c){if(c!=='GuestBookingInvoiceIssuances'&&c!=='BookingPayments')return original.query(c);
 let field,value,n;return {eq(k,v){field=k;value=v;return this;},limit(v){n=v;return this;},async find(options){assert.deepEqual(options,{suppressAuth:true,suppressHooks:true,consistentRead:true});assert.equal(n,c==='BookingPayments'?1:2);assert.equal(field,c==='BookingPayments'?'bookingNumber':'_id');invoiceTrace.push({op:'find',collection:c,field,value});const found=c==='BookingPayments'?[]:rows.filter(r=>r[field]===value);return {items:detach(found),hasNext(){return false;}};}};
 },async insert(c,row,options){if(c!=='GuestBookingInvoiceIssuances')return original.insert(c,row,options);assert.ok(['INITIAL_ISSUANCE','PREPARED','START','ACK'].includes(row.kind));assert.deepEqual(options,{suppressAuth:true,suppressHooks:true});invoiceTrace.push({op:'insert',collection:c,kind:row.kind,id:row._id});if(rows.some(r=>r._id===row._id))throw Error('duplicate');rows.push(detach(row));return detach(row);}};
 const clock={now:vector.now},admission=graph(),vm=require('node:vm'),cache=new Map();
 const ext={'wix-http-functions':{response:v=>v},'wix-secrets-backend':{getSecret:async name=>{throw Error('owner/trusted secret forbidden');}},https:{request(url,options,callback){posts.push({url,options});const emitter=new (require('events').EventEmitter)();emitter.end=body=>{posts.at(-1).body=body;queueMicrotask(()=>emitter.emit('error',Error('inert transport unavailable')));};emitter.destroy=()=>{};return emitter;}},crypto:{...fixtureCrypto,default:fixtureCrypto},buffer:{Buffer},'wix-data':{default:f.wix},'wix-auth':{elevate:fn=>fn},'wix-secrets-backend.v2':{secrets:{async getSecretValue(name){if(Object.hasOwn(config,name))return {value:config[name]};return f.secrets.getSecretValue(name);}}},'wix-web-module':{Permissions:{Anyone:'Anyone'},webMethod(permission,fn){assert.equal(permission,'Anyone');return fn;}}};
 function load(id){if(cache.has(id))return cache.get(id);let m;
 if(ext[id]){const values=ext[id];m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{identifier:id});}
 else {assert.ok(admission.graph[id]);const raw=fs.readFileSync(ROOT+'/'+id);assert.equal(sha(Buffer.from(raw.toString().replace(/\r\n/g,'\n'))),admission.graph[id].canonical_lf_sha256);m=new vm.SourceTextModule(raw.toString(),{identifier:id});}
 cache.set(id,m);return m;}
 async function api(n){const m=load('velo/backend/'+n+'.js');if(m.status==='unlinked')await m.link((spec,parent)=>{const edge=admission.graph[parent.identifier].imports.find(e=>e.specifier===spec);assert.ok(edge);return load(edge.target||spec);});if(m.status==='linked')await m.evaluate();return m.namespace;}
 return {f,rows,invoiceTrace,clock,admission,posts,config,load:api};
}
async function run(){
 const NativeDate=Date;
 function FixtureDate(...args){return args.length?new NativeDate(...args):new NativeDate(vector.now);}
 FixtureDate.prototype=NativeDate.prototype;FixtureDate.now=()=>vector.now;FixtureDate.parse=NativeDate.parse;FixtureDate.UTC=NativeDate.UTC;global.Date=FixtureDate;
 const s=setup(),api=await s.load('guestBookingSummaryService.web'),{priceGroups,...input}=vector.purchase;
 const offer=await api.prepareGuestBookingSummary({...input,summaryRooms:vector.summaryRooms});assert.equal(offer.status,'OFFER');
 assert.equal((await api.confirmGuestBookingSummary(JSON.parse(JSON.stringify(offer.credential)))).status,'ACCEPTED_PENDING');
 const before=JSON.stringify(s.f.snapshot()),n=s.f.trace.filter(t=>t.op==='insert-attempt').length;
 const status=await api.readGuestBookingSummaryStatus(offer.credential);
 if(process.argv[2]==='readonly'){
 assert.equal(JSON.stringify(s.f.snapshot()),before,'public status must be read-only');assert.equal(s.f.trace.filter(t=>t.op==='insert-attempt').length,n);assert.equal(s.rows.length,0);
 console.log(JSON.stringify({id:'PUBLIC-READONLY',status:'PASS',publicStatus:status}));return;
 }
 const recovery=await s.load('guestBookingCompletionRecovery');
 assert.equal(typeof recovery.recoverGuestBookingCompletionsAndAdmitInvoices,'function','trusted completion-to-issuance entry absent');
 const visits=[];
 for(let i=0;i<64&&!s.rows.length;i++)visits.push(await recovery.recoverGuestBookingCompletionsAndAdmitInvoices());
 const db=s.f.snapshot();
 fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(OUT+'/booking-last-state.json',JSON.stringify({db,visits,invoiceTrace:s.invoiceTrace,trace:s.f.trace},null,2));
 assert.equal(db.GuestBookingCompletions.length,1,'actual writer completion required');assert.equal(s.rows.length,1,'same trusted recovery must admit issuance');
 assert.equal(db.GuestBookingAllocationManifests.length,1,'allocation handoff preserved');
 const root=db.GuestBookingAcceptances[0],issuance=s.rows[0];
 assert.equal(issuance.acceptanceId,root._id);assert.equal(issuance.operationId,root.operationId);assert.equal(issuance.rootDigest,root.rootDigest);
 assert.equal((await api.readGuestBookingSummaryStatus(offer.credential)).status,'CONFIRMED');
 fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(OUT+'/fresh-producer-last.json',JSON.stringify({db,rows:s.rows,trace:s.f.trace,invoiceTrace:s.invoiceTrace,posts:s.posts},null,2));
 assert.equal(s.posts.length,1,'post-admission production sender must enter transport after retained authority');
 assert.equal((await api.readGuestBookingSummaryStatus(offer.credential)).status,'CONFIRMED');
 if(['receiver','negatives'].includes(process.argv[2])){
  const http=await s.load('http-functions');assert.equal(typeof http.post_guestInvoiceJournal,'function','actual Wix journal export missing');
  const scope=JSON.parse(s.posts[0].body).scope,body=Buffer.from(JSON.stringify({protocol:'guest-invoice-journal/v1',scope,operation:'readIssuance',payload:{}}));
  const requestId='aa'.repeat(32),time=String(vector.now),site='https://www.wanderlustcaribbean.com';
  const mac=crypto.createHmac('sha256',Buffer.from('11'.repeat(32),'hex')).update(JSON.stringify(['wbe.guest-invoice.http.v1','render-to-wix','local','POST',site,'/_functions/guestInvoiceJournal',time,requestId,sha(body)])).digest('hex');
  const result=await http.post_guestInvoiceJournal({method:'POST',url:site+'/_functions/guestInvoiceJournal',headers:{'content-type':'application/json','x-wbe-gi-kid':'local','x-wbe-gi-time':time,'x-wbe-gi-request':requestId,'x-wbe-gi-mac':mac},body:{buffer:async()=>body}});
  assert.equal(result.status,200);assert.equal(JSON.parse(result.body).result.root._id,issuance._id);
  if(process.argv[2]==='negatives'){
   const auth=await s.load('guestBookingInvoiceTransportAuth');
   const beforePosts=s.posts.length;
   assert.equal((await auth.sendGuestInvoiceForRecoveredAcceptance(root._id,root.operationId,root.rootDigest,'ff'.repeat(32))).status,'UNAVAILABLE');
   assert.equal(s.posts.length,beforePosts,'cross-issuance cannot mint');
   const other=await api.prepareGuestBookingSummary({...input,summaryRooms:vector.summaryRooms});assert.equal(other.status,'OFFER');
   assert.equal((await api.confirmGuestBookingSummary(JSON.parse(JSON.stringify(other.credential)))).status,'ACCEPTED_PENDING');
   const otherRoot=s.f.snapshot().GuestBookingAcceptances.find(x=>x._id!==root._id);assert.ok(otherRoot);
   assert.equal((await auth.sendGuestInvoiceForRecoveredAcceptance(otherRoot._id,otherRoot.operationId,otherRoot.rootDigest,issuance._id)).status,'UNAVAILABLE');
   assert.equal(s.posts.length,beforePosts,'independently accepted other subject cannot borrow issuance');
   const originalConfig=s.config.WBE_GUEST_INVOICE_SITE_ORIGIN;
   const request={method:'POST',url:site+'/_functions/guestInvoiceJournal',headers:{'content-type':'application/json','x-wbe-gi-kid':'local','x-wbe-gi-time':time,'x-wbe-gi-request':requestId,'x-wbe-gi-mac':mac},body:{buffer:async()=>body}};
   const count=s.invoiceTrace.length;
   for(const bad of [{...request,method:'GET'},{...request,url:site+'/_functions/other'},{...request,headers:{...request.headers,'X-WBE-GI-Mac':mac}},{...request,body:{buffer:async()=>Buffer.concat([body,Buffer.from(' ')])}}])assert.equal((await http.post_guestInvoiceJournal(bad)).status,503);
   assert.equal(s.invoiceTrace.length,count,'invalid channel must not read journal');
   s.config.WBE_GUEST_INVOICE_ENABLED='false';assert.equal((await http.post_guestInvoiceJournal(request)).status,503);s.config.WBE_GUEST_INVOICE_ENABLED='true';
   s.config.WBE_GUEST_INVOICE_SITE_ORIGIN='https://wrong.example';
   const switched={...request,url:'https://wrong.example/_functions/guestInvoiceJournal',body:{buffer:async()=>{s.config.WBE_GUEST_INVOICE_SITE_ORIGIN=originalConfig;return body;}}};
   assert.equal((await http.post_guestInvoiceJournal(switched)).status,503,'authenticated destination must match captured actual URL after configuration await');
  }
  fs.writeFileSync(OUT+'/receiver-native.json',JSON.stringify({status:result.status,result:JSON.parse(result.body),invoiceTrace:s.invoiceTrace},null,2));
 }
 console.log(JSON.stringify({id:'RETAINED-POST-ADMISSION-SENDER',status:'PASS',posts:s.posts.length,completion:db.GuestBookingCompletions.length}));
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});
