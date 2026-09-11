import { acceptanceDigest } from 'backend/guestBookingIssuerAuthority';
import { transportExpectation, withTransportFence } from 'backend/guestBookingInvoiceTransportAuth';
import { readGuestBookingInvoiceSiteAudience } from 'backend/guestBookingInvoiceAuthorityConfig';
import { createGuestBookingPhysicalAcquisitionSession } from 'backend/guestBookingPhysicalAcquisitionEvidence';
import { readGuestBookingCompletionEvidence } from 'backend/guestBookingCompletionEvidence';
import { canonicalGuestBookingCompletionRecord } from 'backend/guestBookingCompletionStore';

// Recovery-only private handoff. Future sole production caller: InvoiceIssuance.
// Module graph/private accepted-store custody supplies actor authority. These IDs
// must be captured from discovery BEFORE awaited coordination, never a receipt.
// No public capability, guest expiry, recovery hook or effect is implemented here.
const terminal='CART_COMMIT_MATERIALIZED_PENDING_PROJECTION';
const answer=status=>({status});
function need(value){if(!value)throw Error('INTEGRITY');}
function own(value,key){
 need(value!==null&&typeof value==='object');
 const d=Object.getOwnPropertyDescriptor(value,key);
 need(d&&Object.hasOwn(d,'value')&&d.enumerable);return d.value;
}
function bound(root,expected,receipt=false){
 need(own(root,receipt?'acceptanceId':'_id')===expected.acceptanceId&&
      own(root,'operationId')===expected.operationId&&
      own(root,'rootDigest')===expected.rootDigest&&
      own(root,'audience')===expected.audience);
 if(receipt)need(own(root,'_id')==='gbc1-'+expected.acceptanceId);
}
async function readBoundRetainedCompletion(expected){
 try {
  // Keep mutation-capable factories local; only read/verification closures reach
  // the existing suffix. Its ABSENT selection path is never admitted.
  const session=createGuestBookingPhysicalAcquisitionSession(),store=session.completionStore();
  const A=expected.acceptanceId,id='gbc1-'+A;
  const receipt=await store.exact('GuestBookingCompletions',id,'early-receipt');
  if(own(receipt,'status')!=='FOUND')return answer(receipt.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');
  const initialText=canonicalGuestBookingCompletionRecord('GuestBookingCompletions',own(receipt,'record'));
  const initial=JSON.parse(initialText);bound(initial,expected,true);
  let finalText=null;
  const reads=Object.freeze({
   exact:async(c,key,category)=>{
    const found=await store.exact(c,key,category);
    if(category==='final-receipt'){
     need(c==='GuestBookingCompletions'&&key===id);
     const status=own(found,'status');
     if(status!=='FOUND')throw Error(status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');
     const text=canonicalGuestBookingCompletionRecord(c,own(found,'record'));
     bound(JSON.parse(text),expected,true);need(text===initialText);finalText=text;
    }
    return found;
   },
   scan:(...args)=>store.scan(...args)
  });
  const readPhysical=()=>session.read(A);
  const first=await readPhysical();
  if(own(first,'status')!==terminal)return answer(first.status==='UNKNOWN'?'UNKNOWN':'INTEGRITY');
  const readModel=async()=>{
   const model=await session.readCompletionModel(A);
   const accepted=own(model,'accepted');bound(own(accepted,'root'),expected);
   // Session validates actual retained acceptance and manifest on each pass,
   // including its measured terminal pass-model. Do not bypass its accounting.
   own(model,'record');return model;
  };
  const verify=(state,present,seen,invoke)=>{
   need(own(seen,'status')==='FOUND');
   need(canonicalGuestBookingCompletionRecord('GuestBookingCompletions',own(seen,'record'))===initialText);
   return session.verifyCompletion(state,present,seen,invoke);
  };
  const result=await readGuestBookingCompletionEvidence(A,reads,readModel,readPhysical,receipt,verify);
  if(own(result,'status')!=='CONFIRMED')return answer(result.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');
  need(finalText!==null&&finalText===initialText);
  const retained=JSON.parse(finalText);bound(retained,expected,true);
  return {status:'VERIFIED_COMPLETION',receipt:retained,projection:JSON.parse(retained.projectionCanonical)};
 }catch(e){return answer(e.message==='INTEGRITY'?'INTEGRITY':'UNKNOWN');}
}
// The same retained algorithm receives the original immutable subject, never a
// newly configured audience. This wrapper does not alter durable recovery expiry.
export async function readTransportBoundGuestBookingCompletion(ctx){
 try {
  if(arguments.length!==1)return answer('DENIED');
  const expected=transportExpectation(ctx);
  return await withTransportFence(ctx,'subjectRead',()=>readBoundRetainedCompletion(expected));
 }catch{return answer('UNKNOWN');}
}
export async function readRecoveredGuestBookingCompletion(acceptanceId,operationId,rootDigest){
 if(arguments.length!==3||![acceptanceId,operationId,rootDigest].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))return answer('DENIED');
 if(acceptanceId!==acceptanceDigest('wbe.acceptance-id.v2',operationId))return answer('DENIED');
 const audience=await readGuestBookingInvoiceSiteAudience();
 if(audience===null)return answer('UNKNOWN');
 return readBoundRetainedCompletion(Object.freeze({audience,acceptanceId,operationId,rootDigest}));
}
