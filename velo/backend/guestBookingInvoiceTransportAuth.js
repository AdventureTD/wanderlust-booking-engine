import { secrets } from 'wix-secrets-backend.v2';
import { elevate } from 'wix-auth';
import { readGuestBookingInvoiceSiteAudience } from 'backend/guestBookingInvoiceAuthorityConfig';

// Disconnected fence prerequisite ONLY. No wire verifier/mint/endpoint exists.
// No exported enrollment or enable switch: production cannot obtain a handle yet.
// A later separately reviewed in-module authenticator must call the private
// enrollment function only after original-byte channel and sealed-scope checks.
// Tests expose enrollment/local enable ONLY by explicit compile-time instrumentation.
let transportEnabled = () => false;
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
 need(transportEnabled()===true);
 const siteOrigin=await secret('WBE_GUEST_INVOICE_SITE_ORIGIN');
 const renderOrigin=await secret('WBE_INVOICE_SERVICE_URL');
 const audience=await readGuestBookingInvoiceSiteAudience();
 const channel=ring(await secret('WBE_GUEST_INVOICE_CHANNEL_KEYS'));
 const scope=ring(await secret('WBE_GUEST_INVOICE_SCOPE_KEYS'));
 return Object.freeze({siteOrigin,renderOrigin,audience,channel,scope});
}
export async function withTransportFence(handle,phase,invoke){
 const entry=context(handle);
 need(phases.includes(phase)&&typeof invoke==='function');
 need(transportEnabled()===true);
 const fresh=await currentConfiguration();
 need(fresh.siteOrigin===entry.siteOrigin&&fresh.renderOrigin===entry.renderOrigin&&fresh.renderOrigin===RENDER&&fresh.audience===entry.audience);
 need(fresh.channel[entry.channelKid]===entry.channelKeyIdentity&&fresh.scope[entry.scopeKid]===entry.scopeKeyIdentity);
 // No await, getters, page inspection or SDK property access follows this closing
 // clock/local-state fence. The trusted caller captures SDK and argument references
 // first; invoke must synchronously enter the native call, not await before it.
 need(context(handle)===entry&&transportEnabled()===true);validTime(entry);
 return invoke();
}
