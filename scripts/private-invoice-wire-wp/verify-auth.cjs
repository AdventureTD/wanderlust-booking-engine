'use strict';
// Closed pure-auth loader. No application imports or datastore/provider bindings.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const base=path.resolve(process.env.WP_ROOT||path.join(__dirname,'../..'));
// External trust inputs are mandatory; candidate records cannot approve themselves.
function preflight(){
 const env=process.env;
 for(const key of ['WP_ROOT','WP_INSPECTOR','WP_INSPECTOR_SHA256','WP_ORIGINAL_MANIFEST','WP_SUPPORT_RECORD','WP_SUPPORT_SHA256','WP_SHAPE','WP_PYTHON'])assert(env[key],`missing external ${key}`);
 assert(/^[0-9a-f]{64}$/.test(env.WP_INSPECTOR_SHA256));
 const helper=fs.readFileSync(env.WP_INSPECTOR);
 assert.equal(crypto.createHash('sha256').update(helper).digest('hex'),env.WP_INSPECTOR_SHA256,'external helper anchor');
 const run=require('node:child_process').spawnSync(env.WP_PYTHON,['-B',env.WP_INSPECTOR,base,env.WP_ORIGINAL_MANIFEST,env.WP_SUPPORT_RECORD,env.WP_SUPPORT_SHA256,env.WP_SHAPE],{encoding:'utf8',timeout:30000});
 assert.equal(run.status,0,run.stderr||String(run.error||'preflight failure'));
 const report=JSON.parse(run.stdout);assert.equal(report.classification,'BYTE_INSPECTION_ONLY_NOT_BEHAVIOR');
 return report;
}
const inspection=preflight();
if(process.argv.includes('--inspect-only')){console.log(JSON.stringify(inspection));process.exit(0);}
let deliverySentinelCalls=0;
const deliverySentinel=Object.freeze({guestBookingInvoiceDeliveryBoundOperation(){deliverySentinelCalls++;throw new Error('PURE_AUTH_DELIVERY_FORBIDDEN');}});
// Sentinel is NOT actual Delivery loading, cycle evidence, or native authority.
const fixture={now:1700000000000,enabled:true,reads:0,afterRead:null};
const config={
 WBE_GUEST_INVOICE_SITE_ORIGIN:'https://example.test',
 WBE_INVOICE_SERVICE_URL:'https://wanderlust-invoice-service.onrender.com',
 WBE_GUEST_BOOKING_KEYS:JSON.stringify({audience:'fixture-site'}),
 WBE_GUEST_INVOICE_CHANNEL_KEYS:JSON.stringify({activeKid:'c1',keys:[{kid:'c1',keyHex:'11'.repeat(32)}]}),
 WBE_GUEST_INVOICE_SCOPE_KEYS:JSON.stringify({activeKid:'s1',keys:[{kid:'s1',keyHex:'22'.repeat(32)}]})
};
const loaded=[];
const sandbox=vm.createContext({Buffer,Date:class extends Date{static now(){return fixture.now;}},__enabled:()=>fixture.enabled});
function load(rel){
 assert(['velo/backend/guestBookingInvoiceTransportAuth.js','velo/backend/guestBookingInvoiceAuthorityConfig.js'].includes(rel));
 let s=fs.readFileSync(path.join(base,rel),'utf8');loaded.push(rel);
 const exports=[];
 s=s.replace(/^import \{ ([^}]+) \} from '([^']+)';$/gm,(_,names,dep)=>{
  const allow=rel.endsWith('TransportAuth.js')?['backend/guestBookingInvoiceDelivery','wix-secrets-backend.v2','wix-auth','backend/guestBookingInvoiceAuthorityConfig','crypto','buffer']:['wix-secrets-backend.v2','wix-auth','buffer'];assert(allow.includes(dep));
  return `const {${names}}=__imports[${JSON.stringify(dep)}];`;
 });
 s=s.replace(/export (async )?function (\w+)/g,(_,a,n)=>{exports.push(n);return `${a||''}function ${n}`;});
 if(rel.endsWith('TransportAuth.js')){
  assert(s.includes('let transportEnabled = () => false;'));
  s=s.replace('let transportEnabled = () => false;','let transportEnabled = __enabled;');
  s+='\nconst testOnly={};\n';
  for(const n of ['sealScope','requestMac','responseMac','wireJson','scopeClaims','requestBody'])s+=`testOnly.${n}=typeof ${n}==='function'?${n}:undefined;\n`;
  exports.push('testOnly');
 }
 const imports={'buffer':{Buffer},'crypto':crypto,'wix-auth':{elevate:f=>f},'wix-secrets-backend.v2':{secrets:{getSecretValue:async name=>{fixture.reads++;if(fixture.afterRead)await fixture.afterRead(name);assert(Object.hasOwn(config,name));return {value:config[name]};}}}};
 if(rel.endsWith('TransportAuth.js'))imports['backend/guestBookingInvoiceAuthorityConfig']=load('velo/backend/guestBookingInvoiceAuthorityConfig.js');
 if(rel.endsWith('TransportAuth.js'))imports['backend/guestBookingInvoiceDelivery']=deliverySentinel;
 sandbox.__imports=imports;
 return vm.runInContext(`(function(__imports){${s}\nreturn {${exports.join(',')}};})(__imports)`,sandbox,{filename:rel});
}
const auth=load('velo/backend/guestBookingInvoiceTransportAuth.js');
const oracleJSON=x=>Buffer.from(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const mac=(key,x)=>crypto.createHmac('sha256',Buffer.from(key,'hex')).update(x).digest('hex');
const operationId='33'.repeat(32);
const claims=[1,'guest-invoice-service','initial',config.WBE_GUEST_INVOICE_SITE_ORIGIN,'fixture-site',hash('wbe.acceptance-id.v2\0'+operationId),operationId,'44'.repeat(32),'55'.repeat(32),'66'.repeat(32),fixture.now,fixture.now+900000];
const encoded=oracleJSON(claims).toString('base64url');
const scope='wgis1.s1.'+encoded+'.'+mac('22'.repeat(32),'wbe.guest-invoice.scope.v1\ns1\n'+encoded);
const body=oracleJSON({protocol:'guest-invoice-journal/v1',scope,operation:'tryStart',payload:{artifactDigest:'77'.repeat(32),invocationNonce:'88'.repeat(32)}});
const meta={direction:'render-to-wix',destinationOrigin:'https://example.test',path:'/_functions/guestInvoiceJournal',kid:'c1',time:String(fixture.now),requestId:'99'.repeat(32)};
const expectedMac=mac('11'.repeat(32),oracleJSON(['wbe.guest-invoice.http.v1',meta.direction,meta.kid,'POST',meta.destinationOrigin,meta.path,meta.time,meta.requestId,hash(body)]));
const headers={'Content-Type':'application/json','X-WBE-GI-Kid':'c1','X-WBE-GI-Time':meta.time,'X-WBE-GI-Request':meta.requestId,'X-WBE-GI-Mac':expectedMac};
const cases=[];async function test(id,fn){await fn();cases.push(id);}
(async()=>{
 await test('WA01-real-scope-request-vectors',()=>{
  assert.equal(typeof auth.testOnly.sealScope,'function','missing new scope crypto');
  assert.equal(auth.testOnly.sealScope(claims,'s1','22'.repeat(32)),scope);
  assert.equal(auth.testOnly.requestMac(meta,body,'11'.repeat(32)),expectedMac);
 });
 await test('WA02-original-byte-enrollment',async()=>{
  assert.equal(typeof auth.verifyTransportRequest,'function','missing authenticated enrollment');
  const original=Buffer.from(body);const pending=auth.verifyTransportRequest(original,headers);original.fill(0);
  const ctx=await pending;assert.equal(auth.transportExpectation(ctx).operationId,operationId);
  assert.throws(()=>auth.transportExpectation({}));
  await assert.rejects(auth.verifyTransportRequest(Buffer.concat([body,Buffer.from(' ')]),headers));
  const changed=scope.slice(0,-1)+(scope.endsWith('0')?'1':'0');
  const bytes=Buffer.from(body.toString().replace(scope,changed));
  await assert.rejects(auth.verifyTransportRequest(bytes,{...headers,'X-WBE-GI-Mac':auth.testOnly.requestMac(meta,bytes,'11'.repeat(32))}));
 });
 await test('WA03-postserialization-release-fence',async()=>{
  assert.equal(typeof auth.releaseTransportResponse,'function','missing response release');
  const ctx=await auth.verifyTransportRequest(body,headers);
  const result={won:true,invocationNonce:'88'.repeat(32),artifactDigest:'77'.repeat(32)};
  const promise=auth.releaseTransportResponse(ctx,result);result.invocationNonce='00'.repeat(32);
  const response=await promise;
  assert.equal(response.body.toString(),JSON.stringify({protocol:'guest-invoice-journal/v1',result:{won:true,invocationNonce:'88'.repeat(32),artifactDigest:'77'.repeat(32)}}));
  assert.equal(response.headers['X-WBE-GI-Mac'],mac('11'.repeat(32),oracleJSON(['wbe.guest-invoice.response.v1','render-to-wix-response','c1',meta.destinationOrigin,meta.path,meta.requestId,hash(body),200,hash(response.body)])));
  fixture.afterRead=()=>{fixture.now=claims[11];};
  await assert.rejects(auth.releaseTransportResponse(ctx,{status:'DENIED'}));fixture.afterRead=null;fixture.now=claims[10];
 });
 const projection='é e\u0301 😀 \u2028\u2029\b\t\n\f\r\u0000 " \\ \ufffd \ud800';
 const root={_id:claims[8],schemaVersion:1,kind:'INITIAL_ISSUANCE',revision:'initial',audience:claims[4],acceptanceId:claims[5],operationId:claims[6],rootDigest:claims[7],receiptId:'gbc1-'+claims[5],projectionDigest:'aa'.repeat(32),financialDigest:'bb'.repeat(32),recipientBindingDigest:'cc'.repeat(32),projectionCanonical:projection,to:'fixture@example.test',cc:'info@wanderlustcaribbean.com',from:'info@wanderlustcaribbean.com'};
 const rich={status:'PROVIDER_ACCEPTED',root,payments:[],artifact:{_id:'dd'.repeat(32),kind:'PREPARED',issuanceId:root._id,documentDigest:root.projectionDigest,encoded:'YQ==',mimeDigest:hash('a'),pdfDigest:'ee'.repeat(32),rendererVersion:'word',artifactDigest:'77'.repeat(32)},start:{_id:'ff'.repeat(32),kind:'START',issuanceId:root._id,documentDigest:root.projectionDigest,artifactDigest:'77'.repeat(32),invocationNonce:'88'.repeat(32)},ack:{_id:'01'.repeat(32),kind:'ACK',issuanceId:root._id,documentDigest:root.projectionDigest,artifactDigest:'77'.repeat(32),invocationNonce:'88'.repeat(32),providerMessageId:'fixture-id'}};
 let richResponse;
 await test('WA04-rich-unicode-original-value',async()=>{
  const ctx=await auth.verifyTransportRequest(body,headers);
  richResponse=await auth.releaseTransportResponse(ctx,rich);
  assert.equal(richResponse.body.toString(),JSON.stringify({protocol:'guest-invoice-journal/v1',result:rich}));
  assert.equal(JSON.parse(richResponse.body).result.root.projectionCanonical,projection);
  assert(!richResponse.body.includes(Buffer.from([0xed,0xa0,0x80])));
  await assert.rejects(auth.releaseTransportResponse(ctx,{...rich,root:{...root,operationId:'00'.repeat(32)}}));
 });
 let bridgeResponse;
 if(process.argv.includes('--wp03-bridge')){
  const input=JSON.parse(fs.readFileSync(0,'utf8'));
  await test('WA05-python-tryStart-pure-auth-loop',async()=>{
   const original=Buffer.from(input.bodyHex,'hex');
   const ctx=await auth.verifyTransportRequest(original,input.headers);
   // Artificial DTO only, NEVER a native START winner or retained producer.
   const result={won:true,invocationNonce:'88'.repeat(32),artifactDigest:'77'.repeat(32)};
   const response=await auth.releaseTransportResponse(ctx,result);
   bridgeResponse={status:response.status,bodyHex:response.body.toString('hex'),headers:response.headers};
  });
 }
 assert.equal(deliverySentinelCalls,0,'Delivery sentinel must never be called');
 assert.deepEqual(loaded,['velo/backend/guestBookingInvoiceTransportAuth.js','velo/backend/guestBookingInvoiceAuthorityConfig.js']);
 console.log(JSON.stringify({deliverySentinelCalls,cases,count:cases.length,loaded,scope,bodyHex:body.toString('hex'),requestMac:expectedMac,richHex:richResponse.body.toString('hex'),richMac:richResponse.headers['X-WBE-GI-Mac'],bridgeResponse}));
})().catch(e=>{console.error(e);process.exitCode=1;});
