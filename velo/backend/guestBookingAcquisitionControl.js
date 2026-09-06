import { readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';
import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';
import { readGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestStore';
import { buildGuestBookingAllocationBinding, validateGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestRules';
import { reconcileGuestBookingAcquisitionControl } from 'backend/guestBookingAcquisitionControlStore';
import { createGuestBookingAcquisitionReadScope } from 'backend/guestBookingAcquisitionContentionEvidence';
import { canonicalGuestBookingAcquisitionControl } from 'backend/guestBookingAcquisitionControlRules';

// Private nonterminal decision tracer under enforced compliant writers and
// immutable storage. No physical effects, clocks, credentials or caller causes.
function outcome(status,groups){const r=Object.create(null);r.status=status;if(groups)r.groups=groups;return r;}
function exact(read,candidate){
 if(read.status==='INTEGRITY')return 'INTEGRITY';
 if(read.status!=='FOUND')return 'UNKNOWN';
 return canonicalGuestBookingAcquisitionControl(read.record)===canonicalGuestBookingAcquisitionControl(candidate)?'MATCH':'INTEGRITY';
}
export async function resumeGuestBookingAcquisitionControl(acceptanceId){
 if(arguments.length!==1||typeof acceptanceId!=='string'||!/^[a-f0-9]{64}$/.test(acceptanceId))return outcome('INTEGRITY');
 try{
  const scope=createGuestBookingAcquisitionReadScope();
  function reconcile(candidate){scope.reserveExact();return reconcileGuestBookingAcquisitionControl(candidate);}
  scope.reserveExact();const a=await readGuestBookingAcceptance(acceptanceId);if(a.status==='INTEGRITY')return outcome('INTEGRITY');if(a.status!=='FOUND')return outcome('UNKNOWN');
  const root=validateGuestBookingAcceptanceRoot(a.root);if(root==='DENIED'||root.root._id!==acceptanceId)return outcome('INTEGRITY');
  const binding=buildGuestBookingAllocationBinding(root);scope.reserveExact();const m=await readGuestBookingAllocationManifest(binding.manifestId);
  if(m.status==='INTEGRITY')return outcome('INTEGRITY');if(m.status!=='FOUND')return outcome('UNKNOWN');
  if(!validateGuestBookingAllocationManifest(m.record,root))return outcome('INTEGRITY');
  const M=m.record,anchor={_id:'ra2-cart-'+acceptanceId,acquisitionProtocolVersion:2,kind:'admission',acceptanceId,manifestId:M._id,manifestDigest:M.manifestDigest,manifestCanonical:M.manifestCanonical};
  const read=await reconcile(anchor),match=exact(read,anchor);if(match!=='MATCH')return outcome(match);
  if(!validateGuestBookingAllocationManifest({_id:read.record.manifestId,schemaVersion:1,manifestCanonical:read.record.manifestCanonical,manifestDigest:read.record.manifestDigest},root))return outcome('INTEGRITY');
  let evidence=await scope.read(acceptanceId);
  if(evidence.status!=='EVIDENCED')return outcome(evidence.status);
  if(!evidence.direction&&evidence.causes.length){
   const cause=evidence.causes[0],proposal={_id:'ra2-direction-'+acceptanceId,acquisitionProtocolVersion:2,kind:'cart-direction',admissionId:anchor._id,manifestDigest:M.manifestDigest,direction:'compensate',causeOperationId:cause.operationId,causeIndex:cause.index,causeResourceClaimId:cause.resourceClaimId};
   const winner=await reconcile(proposal);
   if(winner.status==='INTEGRITY')return outcome('INTEGRITY');if(winner.status!=='FOUND')return outcome('UNKNOWN');
   // Re-derive the ACTUAL winner's cause, never equality with our losing proposal.
   evidence=await scope.read(acceptanceId);
   if(evidence.status!=='EVIDENCED')return outcome(evidence.status);if(!evidence.direction)return outcome('UNKNOWN');
  }
  const groups=[];
  for(const b of binding.classBindings){
   if(evidence.direction){evidence=await scope.read(acceptanceId);if(evidence.status!=='EVIDENCED')return outcome(evidence.status);if(!evidence.direction)return outcome('UNKNOWN');}
   const operationId=b[0],start={_id:'ra2-start-'+operationId,acquisitionProtocolVersion:2,kind:'group-start',admissionId:anchor._id,manifestDigest:M.manifestDigest,operationId,direction:evidence.direction?'skip':'start'};
   const winner=await reconcile(start);
   if(winner.status==='INTEGRITY')return outcome('INTEGRITY');if(winner.status!=='FOUND')return outcome('UNKNOWN');
   const actual=winner.record;
   if(actual.direction==='skip'&&!evidence.direction){evidence=await scope.read(acceptanceId);if(evidence.status!=='EVIDENCED')return outcome(evidence.status);if(!evidence.direction)return outcome('UNKNOWN');}
   const status=exact(winner,{...start,direction:actual.direction});if(status!=='MATCH')return outcome(status);
   const g=Object.create(null);g.operationId=operationId;g.direction=actual.direction;groups.push(g);
  }
  return outcome('DECISION_PENDING',groups);
 }catch{return outcome('UNKNOWN');}
}
