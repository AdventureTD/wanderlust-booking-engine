import { readGuestBookingCredentialAuthority, acceptanceDigest, acceptanceTime } from 'backend/guestBookingIssuerAuthority';
import { validateGuestBookingOfferCapsule } from 'backend/guestBookingOfferIssuer';
import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';
import { readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';
import { readRecoveredGuestBookingCompletion } from 'backend/guestBookingCompletionAuthority';
import { createGuestBookingPhysicalAcquisitionSession } from 'backend/guestBookingPhysicalAcquisitionEvidence';

// Private, disconnected guest deputy. A booking number or recovery tuple is not
// a guest credential. No legacy acceptedContext, invoice capability or recovery.
const answer=status=>({status});
function bind(result,claims,capsule,id){
 if(result.status==='INTEGRITY')return answer('INTEGRITY');
 if(result.status!=='FOUND')return answer('UNKNOWN');
 const valid=validateGuestBookingAcceptanceRoot(result.root);
 if(valid==='DENIED')return answer('INTEGRITY');
 const r=valid.root;
 if(r._id!==id||r.operationId!==claims.intentId||r.audience!==claims.audience||r.capsule!==capsule||r.intentDigest!==claims.intentDigest||r.quoteDigest!==claims.quoteDigest||r.issuedAtMs!==claims.issuedAtMs||r.offerExpiresAtMs!==claims.expiresAtMs)return answer('INTEGRITY');
 return {status:'BOUND',root:r};
}
export async function readOwnGuestBookingCompletionStatus(token,capsule){
 if(arguments.length!==2||typeof token!=='string'||token.length===0||token.length>1024||typeof capsule!=='string'||capsule.length===0||capsule.length>120000)return answer('DENIED');
 let guestEligible=null;
 try{
  const keys=await readGuestBookingCredentialAuthority();if(keys==='DENIED')return answer('DENIED');
  let sampledAtMs;
  try{sampledAtMs=acceptanceTime();}catch{return answer('DENIED');}
  const claims=keys.service.verifyCredential({token,command:'status',nowMs:sampledAtMs});
  if(claims==='DENIED')return answer('DENIED');
  // Guest disclosure clock only. Never passed to, or used to stop, recovery.
  function eligible(){
   try{const now=acceptanceTime();if(now<sampledAtMs||now<claims.issuedAtMs||now>=claims.expiresAtMs)return false;sampledAtMs=now;return true;}
   catch{return false;}
  }
  guestEligible=eligible;
  const checked=validateGuestBookingOfferCapsule(capsule);
  if(checked==='DENIED'||claims.intentDigest!==checked.binding.intentDigest||claims.quoteDigest!==checked.binding.quoteDigest||claims.issuedAtMs!==checked.offer.issuedAtMs||claims.expiresAtMs!==checked.offer.offerExpiresAtMs)return answer('DENIED');
  const id=acceptanceDigest('wbe.acceptance-id.v2',claims.intentId);
  const own=bind(await readGuestBookingAcceptance(id),claims,capsule,id);
  if(!eligible())return answer('DENIED');
  if(own.status!=='BOUND')return answer(own.status);
  const root=own.root;
  const retained=await readRecoveredGuestBookingCompletion(root._id,root.operationId,root.rootDigest);
  if(!eligible())return answer('DENIED');
  const confirmed=retained.status==='VERIFIED_COMPLETION';
  if(!confirmed){
   if(retained.status==='INTEGRITY')return answer('INTEGRITY');
   // UNKNOWN is not pending. Admit only the validated pre-acquisition prefix;
   // candidate data is observed and discarded, never executed or disclosed.
   const session=createGuestBookingPhysicalAcquisitionSession(),store=session.completionStore();
   const first=await store.exact('GuestBookingCompletions','gbc1-'+id,'early-receipt');
   if(!eligible())return answer('DENIED');
   if(first.status!=='ABSENT')return answer(first.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');
   const model=await session.readCompletionModel(id);
   if(!eligible())return answer('DENIED');
   const modelOwn=bind({status:'FOUND',root:model.accepted.root},claims,capsule,id);
   if(modelOwn.status!=='BOUND'||modelOwn.root.rootDigest!==root.rootDigest)return answer('INTEGRITY');
   const state=await session.read(id);
   if(!eligible())return answer('DENIED');
   if(state.status!=='CANDIDATE'||state.collection!=='control'||state.candidate.kind!=='admission')return answer(state.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');
   const c=state.candidate;
   if(c.acceptanceId!==id||c._id!=='ra2-cart-'+id||c.manifestId!==model.record._id||c.manifestDigest!==model.record.manifestDigest||c.manifestCanonical!==model.record.manifestCanonical)return answer('INTEGRITY');
   const last=await store.exact('GuestBookingCompletions','gbc1-'+id,'early-receipt');
   if(!eligible())return answer('DENIED');
   if(last.status!=='ABSENT')return answer(last.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');
  }
  const finalOwn=bind(await readGuestBookingAcceptance(id),claims,capsule,id);
  if(!eligible())return answer('DENIED');
  if(finalOwn.status!=='BOUND')return answer(finalOwn.status);
  if(finalOwn.root.rootDigest!==root.rootDigest)return answer('INTEGRITY');
  const finalKeys=await readGuestBookingCredentialAuthority();
  if(!eligible()||finalKeys==='DENIED'||finalKeys.service.verifyCredential({token,command:'status',nowMs:sampledAtMs})==='DENIED')return answer('DENIED');
  return confirmed?{status:'CONFIRMED',bookingNumber:root.bookingNumber}:answer('ACCEPTED_PENDING');
 }catch{return answer(guestEligible&&!guestEligible()?'DENIED':'UNKNOWN');}
}
