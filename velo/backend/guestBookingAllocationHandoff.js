import { readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';
import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';
import { readGuestBookingAllocationManifest, insertGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestStore';
import { buildGuestBookingAllocationBinding, buildGuestBookingAllocationManifest, validateGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestRules';
import { readGuestBookingAllocationEvidence } from 'backend/guestBookingAllocationEvidence';
import { buildWholeCartAllocation } from 'backend/wholeCartPlanningRules';

// Effect-free allocation handoff; no guest credential, deadline or room writer.
function winner(read,root,binding){
 if(read.status==='INTEGRITY')return {status:'INTEGRITY'};
 if(read.status!=='FOUND')return {status:'UNKNOWN'};
 if(!validateGuestBookingAllocationManifest(read.record,root))return {status:'INTEGRITY'};
 return {status:'ALLOCATION_HANDOFF_PENDING',bookingNumber:root.root.bookingNumber,manifestId:binding.manifestId};
}
export async function handoffGuestBookingAllocation(acceptanceId){
 if(typeof acceptanceId!=='string'||!/^[a-f0-9]{64}$/.test(acceptanceId))return {status:'INTEGRITY'};
 try{
  const read=await readGuestBookingAcceptance(acceptanceId);if(read.status==='INTEGRITY')return {status:'INTEGRITY'};if(read.status!=='FOUND')return {status:'UNKNOWN'};
  const root=validateGuestBookingAcceptanceRoot(read.root);if(root==='DENIED'||root.root._id!==acceptanceId)return {status:'INTEGRITY'};
  const binding=buildGuestBookingAllocationBinding(root),existing=await readGuestBookingAllocationManifest(binding.manifestId);
  if(existing.status!=='ABSENT')return winner(existing,root,binding);
  const evidence=await readGuestBookingAllocationEvidence(binding.checkIn,binding.checkOut);if(evidence.status!=='READY')return {status:'ALLOCATION_PENDING',reason:evidence.reason};
  let record;try{const allocation=buildWholeCartAllocation({inventorySnapshot:evidence.inventorySnapshot,claimLedger:evidence.claimLedger,groupRequests:binding.groupRequests,primaryOperationId:binding.primaryOperationId});record=buildGuestBookingAllocationManifest(root,allocation,evidence.planningEvidence);}catch(e){return {status:'ALLOCATION_PENDING',reason:e.message==='BUDGET'?'BUDGET':'UNSUPPORTED_PLAN'};}
  await insertGuestBookingAllocationManifest(record);
  return winner(await readGuestBookingAllocationManifest(binding.manifestId),root,binding);
 }catch{return {status:'UNKNOWN'};}
}
