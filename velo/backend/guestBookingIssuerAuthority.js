import crypto from 'crypto';
import { Buffer } from 'buffer';
import wixData from 'wix-data';
import { secrets } from 'wix-secrets-backend.v2';
import { elevate } from 'wix-auth';
import { createGuestBookingCredentials } from 'backend/guestBookingCredentials';

// Private configuration only; no defaults, cache, public bridge or provisioning.
const parse=JSON.parse,stringify=JSON.stringify,clock=Date.now;
export function acceptanceDigest(domain,text) {
  if(typeof domain!=='string'||typeof text!=='string')throw Error('encoding');
  return crypto.createHash('sha256').update(domain+'\u0000'+text,'utf8').digest('hex');
}
export function buildGuestBookingAcceptanceRoot(capsule,o,c,kid,validatedAtMs) {
 const r={schemaVersion:2,validityPolicy:o.policy,_id:acceptanceDigest('wbe.acceptance-id.v2',c.intentId),operationId:c.intentId,audience:c.audience,bookingNumber:o.bookingNumber,capsule,intentDigest:c.intentDigest,quoteDigest:c.quoteDigest,issuedAtMs:c.issuedAtMs,offerExpiresAtMs:c.expiresAtMs,credentialKid:kid,validatedAtMs};
 r.rootDigest=acceptanceDigest('wbe.acceptance-root.v2',stringify(r));return r;
}
export function acceptanceTime() {
  const n=clock();if(!Number.isSafeInteger(n)||n<0||Object.is(n,-0))throw Error('clock');return n;
}
export function boundedJson(text,max=120000) {
  if(typeof text!=='string'||text.length===0||Buffer.byteLength(text,'utf8')>max)throw Error('size');
  const value=parse(text);if(stringify(value)!==text)throw Error('noncanonical JSON');return value;
}
export function exactFields(value,names) {
  if(value===null||typeof value!=='object'||Array.isArray(value))throw Error('record');
  const p=Object.getPrototypeOf(value);if(p!==Object.prototype&&p!==null)throw Error('prototype');
  const keys=Reflect.ownKeys(value);if(keys.length!==names.length)throw Error('fields');
  const result=Object.create(null);
  for(const k of names){const d=Object.getOwnPropertyDescriptor(value,k);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error('descriptor');result[k]=d.value;}
  for(const k of names){const d=Object.getOwnPropertyDescriptor(value,k);if(!d||!Object.hasOwn(d,'value')||!Object.is(d.value,result[k]))throw Error('drift');}
  if(Object.getPrototypeOf(value)!==p)throw Error('drift');return result;
}
function ownData(value,name){
 const d=Object.getOwnPropertyDescriptor(value,name);if(!d||!Object.hasOwn(d,'value'))throw Error('transport descriptor');return d.value;
}
export function snapshotAcceptancePage(page,max){
 // SDK prototypes are permitted, inherited row fields are not. Only the SDK
 // hasNext data method is invoked, never a property getter or row method.
 const items=ownData(page,'items');if(!Array.isArray(items))throw Error('transport array');
 const n=ownData(items,'length');if(!Number.isSafeInteger(n)||n<0||n>max||Reflect.ownKeys(items).length!==n+1)throw Error('transport length');
 const rows=[];
 for(let i=0;i<n;i++){
  const row=ownData(items,String(i));if(row===null||typeof row!=='object'||Array.isArray(row))throw Error('transport row');
  const names=Reflect.ownKeys(row);if(names.length>32)throw Error('transport fields');const copy=Object.create(null);
  for(const k of names){if(typeof k!=='string')throw Error('transport symbol');const d=Object.getOwnPropertyDescriptor(row,k);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error('transport accessor');copy[k]=d.value;}
  for(const k of names)if(!Object.is(ownData(row,k),copy[k]))throw Error('transport drift');
  if(Reflect.ownKeys(row).length!==names.length)throw Error('transport drift');rows.push(copy);
 }
 let owner=page,method;
 for(let depth=0;owner!==null&&depth<8;depth++,owner=Object.getPrototypeOf(owner)){
  const d=Object.getOwnPropertyDescriptor(owner,'hasNext');if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')throw Error('transport method');method=d.value;break;}
 }
 if(!method)throw Error('transport method');const more=Reflect.apply(method,page,[]);if(typeof more!=='boolean')throw Error('transport continuation');
 if(ownData(page,'items')!==items||ownData(items,'length')!==n)throw Error('transport drift');
 return {items:rows,more};
}
async function secretJson(name) {
  const response=await elevate(secrets.getSecretValue)(name);
  const d=Object.getOwnPropertyDescriptor(response,'value');
  if(!d||!Object.hasOwn(d,'value'))throw Error('secret');return boundedJson(d.value,16384);
}
export async function readGuestBookingCredentialAuthority() {
  try {
    const config=await secretJson('WBE_GUEST_BOOKING_KEYS');
    const service=createGuestBookingCredentials(config);if(service==='DENIED')return 'DENIED';
    return {service,audience:config.audience,activeKid:config.activeKid};
  }catch{return 'DENIED';}
}
export async function readGuestBookingIssuerAuthority() {
  try {
    const c=exactFields(await secretJson('WBE_GUEST_BOOKING_ISSUER_CONFIG'),['v','revisionId','revisionDigest','numberPrefix']);
    if(c.v!==1||typeof c.revisionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(c.revisionId)||typeof c.revisionDigest!=='string'||!/^[a-f0-9]{64}$/.test(c.revisionDigest)||typeof c.numberPrefix!=='string'||!/^[A-Z][A-Z0-9-]{0,15}$/.test(c.numberPrefix))return 'DENIED';
    const keys=await readGuestBookingCredentialAuthority();if(keys==='DENIED')return 'DENIED';
    const page=snapshotAcceptancePage(await wixData.query('GuestBookingFinancialRevisions').eq('_id',c.revisionId).limit(2).find({suppressAuth:true,suppressHooks:true,consistentRead:true}),2);
    if(page.items.length!==1||page.more!==false)return 'DENIED';
    const row=page.items[0],id=Object.getOwnPropertyDescriptor(row,'_id'),bytes=Object.getOwnPropertyDescriptor(row,'revisionBytes');
    if(!id||!Object.hasOwn(id,'value')||id.value!==c.revisionId||!bytes||!Object.hasOwn(bytes,'value'))return 'DENIED';
    boundedJson(bytes.value,24000);
    if(acceptanceDigest('wbe.financial-revision.v1',bytes.value)!==c.revisionDigest)return 'DENIED';
    return {keys,revisionId:c.revisionId,revisionDigest:c.revisionDigest,revisionBytes:bytes.value,bookingNumber:c.numberPrefix+crypto.randomBytes(24).toString('hex')};
  }catch{return 'DENIED';}
}
