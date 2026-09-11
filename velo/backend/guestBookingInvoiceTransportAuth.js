import { guestBookingInvoiceDeliveryBoundOperation, guestBookingInvoiceDeliveryOperation } from 'backend/guestBookingInvoiceDelivery';
import { request as httpsRequest } from 'https';
import { secrets } from 'wix-secrets-backend.v2';
import { elevate } from 'wix-auth';
import { readGuestBookingInvoiceSiteAudience } from 'backend/guestBookingInvoiceAuthorityConfig';

import { createHash, createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { Buffer } from 'buffer';

// NEW prospective signed wire, disconnected and default-OFF. Not Render legacy
// compatibility. No endpoint, retained-authority mint API or enable export.
// Private crypto primitives do NOT confer retained booking authority.
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const wireJson = value => Buffer.from(JSON.stringify(value), 'utf8');
function hmac(key, bytes){return createHmac('sha256',Buffer.from(key,'hex')).update(bytes).digest('hex');}
function sealScope(claims,kid,key){
 const encoded=wireJson(claims).toString('base64url');
 return 'wgis1.'+kid+'.'+encoded+'.'+hmac(key,'wbe.guest-invoice.scope.v1\n'+kid+'\n'+encoded);
}
function requestMac(m,bytes,key){
 return hmac(key,wireJson(['wbe.guest-invoice.http.v1',m.direction,m.kid,'POST',m.destinationOrigin,m.path,m.time,m.requestId,digest(bytes)]));
}
function responseMac(m,requestDigest,status,bytes,key){
 return hmac(key,wireJson(['wbe.guest-invoice.response.v1',m.direction+'-response',m.kid,m.destinationOrigin,m.path,m.requestId,requestDigest,status,digest(bytes)]));
}
// Exact secret opt-in; missing or inaccessible configuration denies before IO.
const contexts = new WeakMap();
const RENDER = 'https://wanderlust-invoice-service.onrender.com';
const HEX = /^[a-f0-9]{64}$/;
const KID = /^[A-Za-z0-9_-]{1,32}$/;
const phases = Object.freeze(['subjectRead','preMutation','resultGrant','responseRelease']);
const fields = Object.freeze(['siteOrigin','renderOrigin','audience','acceptanceId','operationId','rootDigest','issuanceId',
 'scopeVersion','purpose','revision','scopeId','issuedAtMs','expiresAtMs','scopeKid','channelKid',
 'scopeKeyIdentity','channelKeyIdentity','sealedScopeIdentity','direction','method','path','requestId','requestBodyDigest']);
function deny(){throw Error('guest_invoice_transport_unavailable');}
function need(value){if(!value)deny();}
function own(value,name){
 need(value!==null&&typeof value==='object');
 const d=Object.getOwnPropertyDescriptor(value,name);
 need(d&&Object.hasOwn(d,'value')&&d.enumerable);return d.value;
}
function origin(value){return typeof value==='string'&&/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value);}
function validTime(entry){
 const now=Date.now();
 need(Number.isSafeInteger(now)&&now>=0&&!Object.is(now,-0));
 need(entry.issuedAtMs<=now+30000&&now<entry.expiresAtMs);
}
function context(handle){
 need(handle!==null&&typeof handle==='object'&&contexts.has(handle));
 return contexts.get(handle);
}
function registerVerifiedTransportRequest(input){
 need(input!==null&&typeof input==='object'&&!Array.isArray(input)&&Object.getOwnPropertySymbols(input).length===0);
 need(Object.getOwnPropertyNames(input).length===fields.length);
 const entry=Object.create(null);
 for(const name of fields){const value=own(input,name);need(typeof value==='string'||typeof value==='number');entry[name]=value;}
 need(origin(entry.siteOrigin)&&entry.renderOrigin===RENDER);
 need(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.audience));
 for(const name of ['acceptanceId','operationId','rootDigest','issuanceId','scopeId','scopeKeyIdentity','channelKeyIdentity','requestId','requestBodyDigest'])need(typeof entry[name]==='string'&&HEX.test(entry[name]));
 need(KID.test(entry.scopeKid)&&KID.test(entry.channelKid));
 need(entry.scopeVersion===1&&entry.purpose==='guest-invoice-service'&&entry.revision==='initial');
 need(entry.direction==='render-to-wix'&&entry.method==='POST'&&entry.path==='/_functions/guestInvoiceJournal');
 need(entry.sealedScopeIdentity.length>0&&entry.sealedScopeIdentity.length<=4096);
 for(const name of ['issuedAtMs','expiresAtMs'])need(Number.isSafeInteger(entry[name])&&entry[name]>=0&&!Object.is(entry[name],-0));
 need(entry.expiresAtMs-entry.issuedAtMs===900000);validTime(entry);
 const handle=Object.freeze(Object.create(null));contexts.set(handle,Object.freeze(entry));return handle;
}
export function transportExpectation(handle){
 const entry=context(handle);
 return Object.freeze({siteOrigin:entry.siteOrigin,audience:entry.audience,acceptanceId:entry.acceptanceId,
  operationId:entry.operationId,rootDigest:entry.rootDigest,issuanceId:entry.issuanceId});
}
async function secret(name){
 const read=elevate(secrets.getSecretValue);
 const value=own(await read(name),'value');
 need(typeof value==='string'&&value.length>0&&value.length<=16384);return value;
}
function ring(text){
 const value=JSON.parse(text);
 need(JSON.stringify(value)===text&&Object.keys(value).length===2);
 const active=own(value,'activeKid'),keys=own(value,'keys');
 need(typeof active==='string'&&KID.test(active)&&Array.isArray(keys)&&keys.length>=1&&keys.length<=2);
 const result=Object.create(null);
 for(const row of keys){
  need(Object.keys(row).length===2);
  const kid=own(row,'kid'),key=own(row,'keyHex');
  need(typeof kid==='string'&&KID.test(kid)&&typeof key==='string'&&HEX.test(key)&&!Object.hasOwn(result,kid));result[kid]=key;
 }
 need(Object.hasOwn(result,active));return Object.freeze(result);
}
async function currentConfiguration(){
 need(await secret('WBE_GUEST_INVOICE_ENABLED')==='true');
 const siteOrigin=await secret('WBE_GUEST_INVOICE_SITE_ORIGIN');
 const renderOrigin=await secret('WBE_INVOICE_SERVICE_URL');
 const audience=await readGuestBookingInvoiceSiteAudience();
 const channelText=await secret('WBE_GUEST_INVOICE_CHANNEL_KEYS'),scopeText=await secret('WBE_GUEST_INVOICE_SCOPE_KEYS');
 const channel=ring(channelText),scope=ring(scopeText);
 return Object.freeze({siteOrigin,renderOrigin,audience,channel,scope,
  channelKid:JSON.parse(channelText).activeKid,scopeKid:JSON.parse(scopeText).activeKid});
}
export async function withTransportFence(handle,phase,invoke){
 const entry=context(handle);
 need(phases.includes(phase)&&typeof invoke==='function');
 const fresh=await currentConfiguration();
 need(fresh.siteOrigin===entry.siteOrigin&&fresh.renderOrigin===entry.renderOrigin&&fresh.renderOrigin===RENDER&&fresh.audience===entry.audience);
 need(fresh.channel[entry.channelKid]===entry.channelKeyIdentity&&fresh.scope[entry.scopeKid]===entry.scopeKeyIdentity);
 // No await, getters, page inspection or SDK property access follows this closing
 // clock/local-state fence. The trusted caller captures SDK and argument references
 // first; invoke must synchronously enter the native call, not await before it.
 need(context(handle)===entry);validTime(entry);
 return invoke();
}

// Private server continuation only. No client/web method can choose this subject.
// The discovery/admission caller supplies independently captured scalar A/O/D/I;
// all retained authority is reloaded by the existing journal, never the hint DTO.
export async function sendGuestInvoiceForRecoveredAcceptance(a,o,d,i){
 try{
  need(arguments.length===4&&[a,o,d,i].every(hex));
  need(a===digest(Buffer.from('wbe.acceptance-id.v2\0'+o,'utf8')));
  const expected=Object.freeze({acceptanceId:a,operationId:o,rootDigest:d,issuanceId:i});
  const config=await currentConfiguration();
  need(origin(config.siteOrigin)&&config.renderOrigin===RENDER);
  const state=await guestBookingInvoiceDeliveryOperation(a,o,d,'readIssuance',{});
  need(state.root&&state.root._id===expected.issuanceId&&state.root.acceptanceId===expected.acceptanceId&&
   state.root.operationId===expected.operationId&&state.root.rootDigest===expected.rootDigest&&state.root.audience===config.audience);
  // Observations only: a prior or uncertain START is never dispatched again.
  if(state.start||state.ack)return {status:state.ack?'PROVIDER_ACCEPTED':'OWNER_REVIEW_REQUIRED'};
  need(state.status==='READY');
  const now=Date.now();need(Number.isSafeInteger(now)&&now>=0);
  const claims=[1,'guest-invoice-service','initial',config.siteOrigin,config.audience,a,o,d,i,randomBytes(32).toString('hex'),now,now+900000];
  const scope=sealScope(claims,config.scopeKid,config.scope[config.scopeKid]);
  const body=wireJson({protocol:'guest-invoice-dispatch/v1',scope});
  const meta=Object.freeze({direction:'wix-to-render',destinationOrigin:RENDER,path:'/private/guest-invoice/v1/dispatch',
   kid:config.channelKid,time:String(now),requestId:randomBytes(32).toString('hex')});
  const headers=Object.freeze({'Content-Type':'application/json','Content-Length':String(body.length),
   'X-WBE-GI-Kid':meta.kid,'X-WBE-GI-Time':meta.time,'X-WBE-GI-Request':meta.requestId,
   'X-WBE-GI-Mac':requestMac(meta,body,config.channel[meta.kid])});
  const fresh=await currentConfiguration();
  need(fresh.siteOrigin===config.siteOrigin&&fresh.renderOrigin===RENDER&&fresh.audience===config.audience&&
   fresh.scope[config.scopeKid]===config.scope[config.scopeKid]&&fresh.channel[meta.kid]===config.channel[meta.kid]);
  need(Date.now()-now<=60000);validTime({issuedAtMs:now,expiresAtMs:now+900000});
  try{await postDispatch(body,headers);}catch{/* Uncertain response NEVER grants or retries START. */}
  // HTTP outcome is not delivery authority (Render result is not signed).
  // Reload the retained journal even after timeout; no second POST in this call.
  const after=await guestBookingInvoiceDeliveryOperation(a,o,d,'readIssuance',{});
  need(after.root&&after.root._id===i&&after.root.audience===config.audience);
  return {status:after.ack?'PROVIDER_ACCEPTED':after.start?'OWNER_REVIEW_REQUIRED':'UNAVAILABLE'};
 }catch{return {status:'UNAVAILABLE'};}
}
function postDispatch(body,headers){
 return new Promise((resolve,reject)=>{
  const req=httpsRequest(RENDER+'/private/guest-invoice/v1/dispatch',{
   method:'POST',headers,agent:false,timeout:60000
  },res=>{
   // No redirects/retries/proxies, no result-based send grant, bounded drain.
   if(res.statusCode!==200||res.headers['content-encoding']){res.destroy();reject(Error('dispatch_unavailable'));return;}
   let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>8192){res.destroy();reject(Error('dispatch_oversize'));}});
   res.on('error',reject);res.on('end',resolve);
  });
  req.on('error',reject);req.on('timeout',()=>{req.destroy();reject(Error('dispatch_timeout'));});req.end(body);
 });
}

// Binary ownership is established synchronously before the first await.
function ownedBytes(value,cap){
 need(Buffer.isBuffer(value)&&value.length>0&&value.length<=cap);
 return Buffer.from(value);
}
function hex(value){return typeof value==='string'&&HEX.test(value);}
function macEqual(actual,expected){need(hex(actual)&&timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex')));}
function shape(value,names){
 need(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getOwnPropertySymbols(value).length===0);
 need(Object.getOwnPropertyNames(value).length===names.length);
 const out=Object.create(null);for(const name of names)out[name]=own(value,name);return out;
}
function requestHeaders(input,length){
 const values=Object.create(null);
 need(input!==null&&typeof input==='object'&&!Array.isArray(input)&&Object.getOwnPropertySymbols(input).length===0);
 for(const name of Object.getOwnPropertyNames(input)){
  const lower=name.toLowerCase();
  if(!['content-type','content-length','content-encoding','x-wbe-gi-kid','x-wbe-gi-time','x-wbe-gi-request','x-wbe-gi-mac'].includes(lower))continue;
  need(!Object.hasOwn(values,lower));const value=own(input,name);need(typeof value==='string');values[lower]=value;
 }
 need(!Object.hasOwn(values,'content-encoding')&&values['content-type']==='application/json');
 if(Object.hasOwn(values,'content-length'))need(values['content-length']===String(length));
 const kid=values['x-wbe-gi-kid'],time=values['x-wbe-gi-time'],requestId=values['x-wbe-gi-request'];
 need(typeof kid==='string'&&KID.test(kid)&&typeof time==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(time));
 need(Number.isSafeInteger(Number(time))&&hex(requestId)&&hex(values['x-wbe-gi-mac']));
 return Object.freeze({kid,time,requestId,mac:values['x-wbe-gi-mac']});
}
function asciiJson(bytes){
 need(bytes.every(n=>n<=127));const value=JSON.parse(bytes.toString('ascii'));
 need(wireJson(value).equals(bytes));return value;
}
function scopeClaims(wire,fresh){
 need(typeof wire==='string'&&wire.length<=4096);
 const match=/^wgis1\.([A-Za-z0-9_-]{1,32})\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(wire);need(match);
 const [,kid,encoded,mac]=match;need(Object.hasOwn(fresh.scope,kid));
 macEqual(mac,hmac(fresh.scope[kid],'wbe.guest-invoice.scope.v1\n'+kid+'\n'+encoded));
 const bytes=Buffer.from(encoded,'base64url');need(bytes.toString('base64url')===encoded);
 const c=asciiJson(bytes);need(Array.isArray(c)&&c.length===12);
 need(c[0]===1&&c[1]==='guest-invoice-service'&&c[2]==='initial');
 need(origin(c[3])&&c[3]===fresh.siteOrigin&&c[4]===fresh.audience&&typeof c[4]==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(c[4]));
 for(let i=5;i<=9;i++)need(hex(c[i]));
 need(c[5]===digest(Buffer.from('wbe.acceptance-id.v2\0'+c[6],'utf8')));
 for(const t of [c[10],c[11]])need(Number.isSafeInteger(t)&&t>=0&&!Object.is(t,-0));
 need(c[11]-c[10]===900000);validTime({issuedAtMs:c[10],expiresAtMs:c[11]});
 return {siteOrigin:c[3],renderOrigin:RENDER,audience:c[4],acceptanceId:c[5],operationId:c[6],rootDigest:c[7],issuanceId:c[8],
  scopeVersion:1,purpose:c[1],revision:c[2],scopeId:c[9],issuedAtMs:c[10],expiresAtMs:c[11],scopeKid:kid,scopeKeyIdentity:fresh.scope[kid],sealedScopeIdentity:wire};
}
function requestBody(bytes){
 const parsed=shape(asciiJson(bytes),['protocol','scope','operation','payload']);need(parsed.protocol==='guest-invoice-journal/v1');
 const names={readIssuance:[],commitArtifact:['encoded','mimeDigest','pdfDigest','rendererVersion'],tryStart:['artifactDigest','invocationNonce'],recordAck:['artifactDigest','invocationNonce','providerMessageId']};
 need(typeof parsed.operation==='string'&&Object.hasOwn(names,parsed.operation));
 const p=shape(parsed.payload,names[parsed.operation]);
 for(const name of ['artifactDigest','invocationNonce','mimeDigest','pdfDigest'])if(Object.hasOwn(p,name))need(hex(p[name]));
 if(parsed.operation==='commitArtifact'){
  need(typeof p.encoded==='string'&&p.encoded.length>0&&p.encoded.length<=397808);
  const raw=Buffer.from(p.encoded,'base64');need(raw.toString('base64')===p.encoded&&digest(raw)===p.mimeDigest);
  need(['word','reportlab','reportlab-fallback'].includes(p.rendererVersion));
 }
 if(parsed.operation==='recordAck')need(typeof p.providerMessageId==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(p.providerMessageId));
 parsed.payload=p;need(wireJson(parsed).equals(bytes));return parsed;
}
// Actual Wix boundary. Capture observable identity before body/config awaits.
// Wix exposes a header object; reject duplicate protected names visible there.
export async function handleGuestInvoiceJournalHttp(request){
 const failure=()=>({status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:'{"status":"UNAVAILABLE"}'});
 try{
  const method=own(request,'method'),url=own(request,'url'),input=own(request,'headers');
  const headers=Object.create(null);
  for(const name of Object.getOwnPropertyNames(input))headers[name]=own(input,name);
  const bodyObject=own(request,'body'),read=bodyObject.buffer.bind(bodyObject);
  const config=await currentConfiguration();
  need(method==='POST'&&url===config.siteOrigin+'/_functions/guestInvoiceJournal');
  const raw=ownedBytes(await read(),450000);
  const handle=await verifyTransportRequest(raw,headers);
  need(url===transportExpectation(handle).siteOrigin+'/_functions/guestInvoiceJournal');
  const result=await dispatchVerifiedJournal(handle);
  return {status:result.status,headers:result.headers,body:result.body};
 }catch{return failure();}
}

const wireRequests=new WeakMap();
// Auth owns this edge so no caller can select operation/payload after verifying,
// obtain the private request record, or inject a substitute journal callback.
export async function dispatchGuestInvoiceJournal(originalBytes,observableHeaders){
 const handle=await verifyTransportRequest(originalBytes,observableHeaders);
 return dispatchVerifiedJournal(handle);
}
async function dispatchVerifiedJournal(handle){
 const request=wireRequests.get(handle);need(request);
 const result=await guestBookingInvoiceDeliveryBoundOperation(handle,request.operation,request.payload);
 return releaseTransportResponse(handle,result);
}

export async function verifyTransportRequest(originalBytes,headers){
 const bytes=ownedBytes(originalBytes,450000),h=requestHeaders(headers,bytes.length);
 const fresh=await currentConfiguration();need(origin(fresh.siteOrigin)&&fresh.renderOrigin===RENDER);
 const now=Date.now();need(Number.isSafeInteger(now)&&now>=0&&Math.abs(now-Number(h.time))<=60000);
 need(Object.hasOwn(fresh.channel,h.kid));
 const m=Object.freeze({direction:'render-to-wix',destinationOrigin:fresh.siteOrigin,path:'/_functions/guestInvoiceJournal',...h});
 macEqual(h.mac,requestMac(m,bytes,fresh.channel[h.kid]));
 const parsed=requestBody(bytes),entry=scopeClaims(parsed.scope,fresh);
 Object.assign(entry,{channelKid:h.kid,channelKeyIdentity:fresh.channel[h.kid],direction:m.direction,method:'POST',path:m.path,requestId:h.requestId,requestBodyDigest:digest(bytes)});
 const handle=registerVerifiedTransportRequest(entry);
 wireRequests.set(handle,Object.freeze({meta:m,operation:parsed.operation,payload:Object.freeze(parsed.payload)}));
 // Closing fresh admission after authentication is not retained completion proof.
 return withTransportFence(handle,'subjectRead',()=>handle);
}
function responseResult(value,entry,request){
 if(Object.hasOwn(value,'won')){
  const r=shape(value,['won','invocationNonce','artifactDigest']);
  need(r.won===true&&request.operation==='tryStart'&&r.invocationNonce===request.payload.invocationNonce&&r.artifactDigest===request.payload.artifactDigest);return r;
 }
 if(Object.hasOwn(value,'root')){
  // Wire schema/subject binding only. Retained projection/MIME authority remains
  // the actual journal/reader's responsibility, not these transport DTO checks.
  const r=shape(value,['status','root','payments','artifact','start','ack']);
  const root=shape(r.root,['_id','schemaVersion','kind','revision','audience','acceptanceId','operationId','rootDigest','receiptId','projectionDigest','financialDigest','recipientBindingDigest','projectionCanonical','to','cc','from']);
  need(root.schemaVersion===1&&root.kind==='INITIAL_ISSUANCE'&&root.revision==='initial');
  for(const name of Object.keys(root))if(name!=='schemaVersion')need(typeof root[name]==='string');
  for(const name of ['_id','acceptanceId','operationId','rootDigest','projectionDigest','financialDigest','recipientBindingDigest'])need(hex(root[name]));
  for(const name of ['audience','acceptanceId','operationId','rootDigest'])need(root[name]===entry[name]);
  need(root._id===entry.issuanceId&&root.receiptId==='gbc1-'+entry.acceptanceId);
  need(Array.isArray(r.payments)&&r.payments.length===0&&Object.getOwnPropertyNames(r.payments).length===1&&Object.getOwnPropertySymbols(r.payments).length===0);
  const stageNames={artifact:['_id','kind','issuanceId','documentDigest','encoded','mimeDigest','pdfDigest','rendererVersion','artifactDigest'],start:['_id','kind','issuanceId','documentDigest','artifactDigest','invocationNonce'],ack:['_id','kind','issuanceId','documentDigest','artifactDigest','invocationNonce','providerMessageId']};
  for(const name of ['artifact','start','ack'])if(r[name]!==null){
   const s=shape(r[name],stageNames[name]);for(const k of Object.keys(s))need(typeof s[k]==='string');
   need(s.kind===({artifact:'PREPARED',start:'START',ack:'ACK'})[name]&&s.issuanceId===root._id&&s.documentDigest===root.projectionDigest);
   for(const k of ['_id','issuanceId','documentDigest','artifactDigest','mimeDigest','pdfDigest','invocationNonce'])if(Object.hasOwn(s,k))need(hex(s[k]));
   if(name==='artifact'){
    const raw=Buffer.from(s.encoded,'base64');need(s.encoded.length>0&&s.encoded.length<=397808&&raw.toString('base64')===s.encoded&&digest(raw)===s.mimeDigest);
    need(['word','reportlab','reportlab-fallback'].includes(s.rendererVersion));
   }
   if(name==='ack')need(/^[A-Za-z0-9_-]{1,256}$/.test(s.providerMessageId));r[name]=s;
  }
  need(!r.start||(r.artifact&&r.start.artifactDigest===r.artifact.artifactDigest));
  need(!r.ack||(r.start&&r.ack.artifactDigest===r.start.artifactDigest&&r.ack.invocationNonce===r.start.invocationNonce));
  need(r.status===(r.ack?'PROVIDER_ACCEPTED':r.start?'OWNER_REVIEW_REQUIRED':'READY'));
  r.root=root;r.payments=[];return r;
 }
 const r=shape(value,['status']);need(['DENIED','UNAVAILABLE','OWNER_REVIEW_REQUIRED'].includes(r.status));return r;
}
export async function releaseTransportResponse(handle,result){
 const entry=context(handle),request=wireRequests.get(handle);need(request);
 // Validate/detach/serialize/bound BEFORE any awaited configuration refresh.
 const body=ownedBytes(wireJson({protocol:'guest-invoice-journal/v1',result:responseResult(result,entry,request)}),900000);
 return withTransportFence(handle,'responseRelease',()=>Object.freeze({status:200,body,headers:Object.freeze({
  'Content-Type':'application/json','Cache-Control':'no-store','X-WBE-GI-Kid':entry.channelKid,
  'X-WBE-GI-Request':entry.requestId,'X-WBE-GI-Mac':responseMac(request.meta,entry.requestBodyDigest,200,body,entry.channelKeyIdentity)
 })}));
}
