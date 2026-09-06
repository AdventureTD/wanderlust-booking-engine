import { readGuestBookingCredentialAuthority, acceptanceDigest, acceptanceTime, boundedJson, exactFields, buildGuestBookingAcceptanceRoot } from 'backend/guestBookingIssuerAuthority';
import { validateGuestBookingOfferCapsule } from 'backend/guestBookingOfferIssuer';
import { insertGuestBookingAcceptance, readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';

// V2 is deliberately separate from v1 acceptedAtMs. No confirmation or room IO.
const fields=['schemaVersion','validityPolicy','_id','operationId','audience','bookingNumber','capsule','intentDigest','quoteDigest','issuedAtMs','offerExpiresAtMs','credentialKid','validatedAtMs'];
function body(r){const b={};for(const k of fields)b[k]=r[k];return b;}
export function validateGuestBookingAcceptanceRoot(value){
 try {
  // Provider dates are metadata, not application admission evidence.
  const copy=Object.create(null);
  for(const k of Reflect.ownKeys(value)){
   const d=Object.getOwnPropertyDescriptor(value,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw Error('row');
   if(k==='_createdDate'||k==='_updatedDate'){if(!(d.value instanceof Date)||!Number.isFinite(Date.prototype.getTime.call(d.value)))throw Error('metadata');}
   else {if(typeof d.value!=='string'&&typeof d.value!=='number')throw Error('scalar field');copy[k]=d.value;}
  }
  const r=exactFields(copy,[...fields,'rootDigest']);boundedJson(JSON.stringify(r),160000);
  if(r.schemaVersion!==2||r.validityPolicy!=='backend-complete-validation-v2'||typeof r.operationId!=='string'||!/^[a-f0-9]{64}$/.test(r.operationId)||r._id!==acceptanceDigest('wbe.acceptance-id.v2',r.operationId)||typeof r.audience!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(r.audience)||typeof r.credentialKid!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(r.credentialKid))throw Error('identity');
  const checked=validateGuestBookingOfferCapsule(r.capsule);if(checked==='DENIED')throw Error('offer');const o=checked.offer;
  if(r.bookingNumber!==o.bookingNumber||r.intentDigest!==checked.binding.intentDigest||r.quoteDigest!==checked.binding.quoteDigest||r.issuedAtMs!==o.issuedAtMs||r.offerExpiresAtMs!==o.offerExpiresAtMs||!Number.isSafeInteger(r.validatedAtMs)||Object.is(r.validatedAtMs,-0)||r.validatedAtMs<r.issuedAtMs||r.validatedAtMs>=r.offerExpiresAtMs||r.rootDigest!==acceptanceDigest('wbe.acceptance-root.v2',JSON.stringify(body(r))))throw Error('qualification');
  return {root:r,calculation:o.calculation};
 }catch{return 'DENIED';}
}
async function authenticate(token,capsule,command){
 if(typeof token!=='string'||token.length>1024||typeof capsule!=='string'||capsule.length>120000)return 'DENIED';
 const keys=await readGuestBookingCredentialAuthority();if(keys==='DENIED')return 'DENIED';
 const authenticatedAtMs=acceptanceTime();const claims=keys.service.verifyCredential({token,command,nowMs:authenticatedAtMs});if(claims==='DENIED')return 'DENIED';
 const checked=validateGuestBookingOfferCapsule(capsule);if(checked==='DENIED'||claims.intentDigest!==checked.binding.intentDigest||claims.quoteDigest!==checked.binding.quoteDigest||claims.issuedAtMs!==checked.offer.issuedAtMs||claims.expiresAtMs!==checked.offer.offerExpiresAtMs)return 'DENIED';
 return {claims,checked,authenticatedAtMs,kid:token.split('.')[1],id:acceptanceDigest('wbe.acceptance-id.v2',claims.intentId)};
}
function reconcile(result,a,capsule){
 if(result.status==='INTEGRITY')return {status:'INTEGRITY'};
 if(result.status!=='FOUND')return {status:'UNKNOWN'};
 const valid=validateGuestBookingAcceptanceRoot(result.root);if(valid==='DENIED')return {status:'INTEGRITY'};const r=valid.root,c=a.claims;
 if(r._id!==a.id||r.operationId!==c.intentId||r.audience!==c.audience||r.capsule!==capsule||r.intentDigest!==c.intentDigest||r.quoteDigest!==c.quoteDigest||r.issuedAtMs!==c.issuedAtMs||r.offerExpiresAtMs!==c.expiresAtMs)return {status:'INTEGRITY'};
 return {status:'ACCEPTED_PENDING',bookingNumber:r.bookingNumber};
}
export async function acceptGuestBookingOffer(token,capsule){
 try {
  const a=await authenticate(token,capsule,'bootstrap');if(a==='DENIED')return {status:'DENIED'};
  const c=a.claims,o=a.checked.offer;
  const r=buildGuestBookingAcceptanceRoot(capsule,o,c,a.kid,0);
  // All awaited validation is complete. No await/queue between this sample and insert invocation.
  const now=acceptanceTime();if(now<a.authenticatedAtMs||now<c.issuedAtMs||now>=c.expiresAtMs)return {status:'DENIED'};
  r.validatedAtMs=now;r.rootDigest=acceptanceDigest('wbe.acceptance-root.v2',JSON.stringify(body(r)));
  await insertGuestBookingAcceptance(r);
  return reconcile(await readGuestBookingAcceptance(a.id),a,capsule);
 }catch{return {status:'UNKNOWN'};}
}
export async function readOwnGuestBookingAcceptance(token,capsule){
 try {const a=await authenticate(token,capsule,'status');if(a==='DENIED')return {status:'DENIED'};return reconcile(await readGuestBookingAcceptance(a.id),a,capsule);}
 catch{return {status:'DENIED'};}
}
