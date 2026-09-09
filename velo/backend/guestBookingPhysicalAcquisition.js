import { createGuestBookingPhysicalAcquisitionSession } from 'backend/guestBookingPhysicalAcquisitionEvidence';
import { guardGuestBookingPhysicalAcquisition } from 'backend/guestBookingPhysicalAcquisitionStore';
import { canonicalGuestBookingAcquisitionControl } from 'backend/guestBookingAcquisitionControlRules';
import { readGuestBookingCompletionEvidence } from 'backend/guestBookingCompletionEvidence';

// Private synthetic W01 only. No routing/export to guest APIs; not activated.
const create=Object.create;
function result(status){const r=create(null);r.status=status;return r;}
export async function resumeGuestBookingPhysicalAcquisition(acceptanceId){
 if(arguments.length!==1||typeof acceptanceId!=='string'||!/^[a-f0-9]{64}$/.test(acceptanceId))return result('INTEGRITY');
 try{
  guardGuestBookingPhysicalAcquisition();
  const session=createGuestBookingPhysicalAcquisitionSession();
  const store=session.completionStore();
  // Receipt absence is admitted before ANY physical/control/terminal mutation.
  const receipt=await store.exact('GuestBookingCompletions','gbc1-'+acceptanceId,'early-receipt');
  if(!['FOUND','ABSENT'].includes(receipt.status))return result(receipt.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');
  if(receipt.status==='ABSENT'){
   const related=await store.scan('GuestBookingCompletions','acceptanceId',acceptanceId,'early-binding');
   if(related.status!=='FOUND')return result(related.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');
   // A positive binding scan cannot be erased by the preceding exact miss.
   // A concurrent valid receipt is retried verification-only next invocation.
   if(related.rows.length)return result('UNKNOWN');
  }
  async function readPhysical(){
   // Each of the three possible scans now owns its actual page debits.
   return await session.read(acceptanceId);
  }
  const next=await readPhysical();
  guardGuestBookingPhysicalAcquisition();
  if(receipt.status==='FOUND'||next.status==='CART_COMMIT_MATERIALIZED_PENDING_PROJECTION'){
   if(next.status!=='CART_COMMIT_MATERIALIZED_PENDING_PROJECTION')return result(next.status==='UNKNOWN'?'UNKNOWN':'INTEGRITY');
   const completion=await readGuestBookingCompletionEvidence(acceptanceId,store,()=>session.readCompletionModel(acceptanceId),readPhysical,receipt,(state,present,initial,invoke)=>session.verifyCompletion(state,present,initial,invoke));
   guardGuestBookingPhysicalAcquisition();
   if(completion.status!=='CANDIDATE')return completion;
   if(receipt.status==='FOUND')return result('INTEGRITY');
   const retained=await store.insert(completion.collection,completion.candidate);
   guardGuestBookingPhysicalAcquisition();
   if(retained.status!=='FOUND')return result(retained.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');
   return result(completion.collection==='GuestBookingCompletions'?'CONFIRMED':'COMPLETION_PENDING');
  }
  if(next.status!=='CANDIDATE')return next;
  if(next.collection==='resource')return await session.reconcileResource(next.candidate);
  const winner=await session.reconcileControl(next.candidate);guardGuestBookingPhysicalAcquisition();
  if(winner.status==='INTEGRITY')return result('INTEGRITY');
  if(winner.status!=='FOUND')return result('UNKNOWN');
  // A competing immutable gate/start direction is not our proposal's authority.
  // A fresh invocation must validate it; this quantum cannot issue another effect.
  const matching=canonicalGuestBookingAcquisitionControl(winner.record)===canonicalGuestBookingAcquisitionControl(next.candidate);
  guardGuestBookingPhysicalAcquisition();return result(matching?'ACQUISITION_PENDING':'UNKNOWN');
 }catch{return result('UNKNOWN');}
}
