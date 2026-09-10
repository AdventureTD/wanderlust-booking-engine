// Pure dispatch mapping + actual crypto. Stubbed journal: ZERO native authority.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const root=require('node:path').resolve(__dirname,'../..')+'/';
const candidate=root+'velo/backend/guestBookingInvoicePrivateDispatcher.js';
const ids=[];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const mac=(k,b)=>crypto.createHmac('sha256',Buffer.from(k,'hex')).update(b).digest('hex');
const json=v=>Buffer.from(JSON.stringify(v));
const pins=JSON.parse(fs.readFileSync(__dirname+'/source-pins.json','utf8'));
for(const [name,pin]of Object.entries(pins))assert.equal(sha(Buffer.from(fs.readFileSync(root+name,'utf8').replace(/\r\n/g,'\n'))),pin.canonicalLF,name);
// The journal/config are explicit mapping stubs; this is NOT full graph admission.
const k='11'.repeat(32),sk='66'.repeat(32),O='22'.repeat(32),A=sha('wbe.acceptance-id.v2\0'+O),I='44'.repeat(32);
async function fixture(){
 let now=1000000,channel=k,atRelease=false;const calls=[];
 const context=vm.createContext({Buffer,Date:class extends Date{static now(){return now;}}});
 const exports=(name,values)=>new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context,identifier:name});
 const secrets={getSecretValue:async name=>({value:({WBE_GUEST_INVOICE_SITE_ORIGIN:'https://example.test',WBE_INVOICE_SERVICE_URL:'https://wanderlust-invoice-service.onrender.com',WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify({activeKid:'k',keys:[{kid:'k',keyHex:channel}]}),WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify({activeKid:'s',keys:[{kid:'s',keyHex:sk}]})})[name]})};
 let result={status:'DENIED'};
 const modules={crypto:exports('crypto',{createHash:crypto.createHash,createHmac:crypto.createHmac,timingSafeEqual:crypto.timingSafeEqual}),buffer:exports('buffer',{Buffer}),'wix-secrets-backend.v2':exports('secrets',{secrets}),'wix-auth':exports('elevate',{elevate:x=>x}),'backend/guestBookingInvoiceAuthorityConfig':exports('config',{readGuestBookingInvoiceSiteAudience:async()=> 'test'}),'backend/guestBookingInvoiceDelivery':exports('inert-journal',{guestBookingInvoiceDeliveryBoundOperation:async(ctx,op,payload)=>{calls.push({ctx,op,payload}); if(atRelease==='expiry')now=1900000;if(atRelease==='key')channel='77'.repeat(32);return typeof result==='function'?result(op,payload):result;}})};
 for(const [name,path]of [['backend/guestBookingInvoiceTransportAuth','guestBookingInvoiceTransportAuth.js'],['dispatcher','guestBookingInvoicePrivateDispatcher.js']]){
  let source=fs.readFileSync(root+'velo/backend/'+path,'utf8');
  if(name.includes('TransportAuth'))source+='\ntransportEnabled=()=>true;\n'; // only default gate seam, never enrollment
  modules[name]=new vm.SourceTextModule(source,{context,identifier:name});
 }
 await modules.dispatcher.link(name=>{assert.ok(modules[name],name);return modules[name];});await modules.dispatcher.evaluate();
 function request(op,payload={}){
  const claims=[1,'guest-invoice-service','initial','https://example.test','test',A,O,'33'.repeat(32),I,'55'.repeat(32),1000000,1900000];
  const enc=json(claims).toString('base64url'),scope='wgis1.s.'+enc+'.'+mac(sk,'wbe.guest-invoice.scope.v1\ns\n'+enc);
  const body=json({protocol:'guest-invoice-journal/v1',scope,operation:op,payload});
  const rid='aa'.repeat(32),stamp='1000000';
  const headers={'Content-Type':'application/json','X-WBE-GI-Kid':'k','X-WBE-GI-Time':stamp,'X-WBE-GI-Request':rid,'X-WBE-GI-Mac':mac(k,json(['wbe.guest-invoice.http.v1','render-to-wix','k','POST','https://example.test','/_functions/guestInvoiceJournal',stamp,rid,sha(body)]))};
  return {body,headers};
 }
 return {calls,request,dispatch:modules.dispatcher.namespace.dispatchGuestInvoiceJournal,auth:modules['backend/guestBookingInvoiceTransportAuth'].namespace,setResult:x=>result=x,fence:x=>atRelease=x,setNow:x=>now=x,check(response,request){assert.equal(response.headers['X-WBE-GI-Mac'],mac(k,json(['wbe.guest-invoice.response.v1','render-to-wix-response','k','https://example.test','/_functions/guestInvoiceJournal','aa'.repeat(32),sha(request.body),200,sha(response.body)])));}};
}
(async()=>{
 assert.ok(fs.existsSync(candidate),'missing private dispatcher');
 const f=await fixture(),q=f.request('readIssuance'),response=await f.dispatch(q.body,q.headers);
 f.check(response,q);assert.equal(f.calls.length,1);assert.equal(f.calls[0].op,'readIssuance');assert.deepEqual(Object.keys(f.calls[0].payload),[]);assert.equal(f.auth.transportExpectation(f.calls[0].ctx).issuanceId,I);assert.equal(JSON.parse(response.body).result.status,'DENIED');ids.push('JS_READ_CAPTURE_SAME_OPAQUE_CONTEXT');
 for(const [op,payload]of [['commitArtifact',{encoded:'eA==',mimeDigest:sha('x'),pdfDigest:'bb'.repeat(32),rendererVersion:'word'}],['tryStart',{artifactDigest:'88'.repeat(32),invocationNonce:'99'.repeat(32)}],['recordAck',{artifactDigest:'88'.repeat(32),invocationNonce:'99'.repeat(32),providerMessageId:'id'}]]){
  const g=await fixture(),q=g.request(op,payload);
  if(op==='tryStart')g.setResult((operation,p)=>({won:true,invocationNonce:p.invocationNonce,artifactDigest:p.artifactDigest}));
  const r=await g.dispatch(q.body,q.headers);g.check(r,q);assert.equal(g.calls.length,1);assert.equal(g.calls[0].op,op);assert.deepEqual(JSON.parse(JSON.stringify(g.calls[0].payload)),payload);ids.push('JS_MAPPING_'+op);
 }
 for(const fault of ['bytes','headers','expiry']){
  const g=await fixture(),q=g.request('readIssuance');
  if(fault==='bytes')q.body[q.body.length-1]=32;
  if(fault==='headers')q.headers['x-wbe-gi-kid']='k';
  if(fault==='expiry')g.setNow(1900000);
  await assert.rejects(g.dispatch(q.body,q.headers));assert.equal(g.calls.length,0);ids.push('JS_PRE_DISPATCH_DENY_'+fault);
 }
 for(const fault of ['expiry','key']){
  const g=await fixture(),q=g.request('tryStart',{artifactDigest:'88'.repeat(32),invocationNonce:'99'.repeat(32)});g.fence(fault);
  g.setResult((o,p)=>({won:true,invocationNonce:p.invocationNonce,artifactDigest:p.artifactDigest}));
  await assert.rejects(g.dispatch(q.body,q.headers));assert.equal(g.calls.length,1);ids.push('JS_RESPONSE_RELEASE_DENY_'+fault);
 }
 {
  const g=await fixture(),q=g.request('tryStart',{artifactDigest:'88'.repeat(32),invocationNonce:'99'.repeat(32)}),original=Buffer.from(q.body);
  const pending=g.dispatch(q.body,q.headers);q.body.fill(32);q.headers['X-WBE-GI-Mac']='00'.repeat(32);
  const r=await pending;g.check(r,{body:original});assert.equal(g.calls[0].op,'tryStart');assert.equal(g.calls[0].payload.invocationNonce,'99'.repeat(32));ids.push('JS_ORIGINAL_BYTES_HEADERS_OWNED_BEFORE_AWAIT');
 }
 assert.equal(ids.length,10);
 console.log(JSON.stringify({classification:'PURE_MAPPING_ACTUAL_CRYPTO_NO_NATIVE_AUTHORITY',caseIds:ids}));
})().catch(e=>{console.error(e);process.exitCode=1;});
