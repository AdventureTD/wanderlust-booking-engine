import { createGuestBookingCompletionStore } from 'backend/guestBookingCompletionStore';
import { readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';
import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';
import { readGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestStore';
import { buildGuestBookingAllocationBinding, validateGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestRules';
import { readGuestBookingAcquisitionControl, reconcileGuestBookingAcquisitionControl } from 'backend/guestBookingAcquisitionControlStore';
import { canonicalGuestBookingAcquisitionControl } from 'backend/guestBookingAcquisitionControlRules';
import { createGuestBookingAcquisitionReadScope } from 'backend/guestBookingAcquisitionContentionEvidence';
import { guardGuestBookingPhysicalAcquisition, copyGuestBookingPhysicalAcquisition, equalGuestBookingPhysicalClaim, validateGuestBookingPhysicalLedger, scanGuestBookingPhysicalClaims, readGuestBookingPhysicalClaim, reconcileGuestBookingPhysicalClaim } from 'backend/guestBookingPhysicalAcquisitionStore';

// Private ordinary acquisition and immutable cart-direction materialization.
// Stops before projection writes; neither direction grants confirmation.
const create=Object.create,SafeError=Error;
const guard=guardGuestBookingPhysicalAcquisition,copy=copyGuestBookingPhysicalAcquisition,equal=equalGuestBookingPhysicalClaim;
function result(status,extra){const r=create(null);r.status=status;if(extra)for(const k of Object.keys(extra))r[k]=extra[k];return r;}
function need(v){if(!v)throw new SafeError('UNKNOWN');}
function check(v){if(!v)throw new SafeError('INTEGRITY');}
function bytes(v){let n=0;for(const c of JSON.stringify(v)){const x=c.codePointAt(0);n+=x<128?1:x<2048?2:x<65536?3:4;}return n;}
// Called only after the unchanged native acceptance validator succeeds. Owner
// has no 256-unit bound here. Never serialize the SDK root or its Date objects.
function acceptancePageBytes(value){
 const out=create(null);
 for(const k of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw new SafeError('INTEGRITY');const v=d.value;out[k]=k==='_createdDate'||k==='_updatedDate'?Reflect.apply(Date.prototype.toISOString,v,[]):v;if(out[k]!==null&&!['string','number'].includes(typeof out[k]))throw new SafeError('INTEGRITY');}
 let n=2;for(const c of JSON.stringify(out)){const v=c.codePointAt(0);n+=v<128?1:v<2048?2:v<65536?3:4;}return n;
}
function completion(I,n){return {_id:'rc1-op-'+I.operationId+'-c',protocolVersion:1,claimKey:'operation:'+I.operationId+':completion',generation:1,eventType:'complete',claimType:'operation-completion',operationId:I.operationId,bookingRowId:I.bookingRowId,bookingNumber:I.bookingNumber,payloadDigest:I.payloadDigest,decisionFenceVersion:1,completionState:'complete',confirmedResourceCount:n};}
export function createGuestBookingPhysicalAcquisitionSession(){
 const scope=createGuestBookingAcquisitionReadScope(),session=create(null),completionStore=createGuestBookingCompletionStore(scope);
 let completionVerification=false,passToken=null,terminalModel=false;
 session.reserveReadback=()=>{guard();scope.reserveExact();};
 session.completionStore=()=>{guard();return completionStore;};
 // Only admitted first-pass measurements seed the private reload hold. No caller
 // count/byte budget or reservation token crosses this session boundary.
 session.verifyCompletion=async function(state,present,receipt,invoke){
  try{
   guard();need(!completionVerification);completionVerification=true;
   const snapshot=scope.snapshot(),c=snapshot.categories,plan=create(null);
   const phaseNames=['physical','model-root','model-manifest','target-exact','booking-identity','class-identity','summary-identity'];
   for(const name of phaseNames){const v=c[name];need((v.spentFinds>0||(terminalModel&&(name==='model-root'||name==='model-manifest')))&&v.pages===v.spentFinds);plan[name]={finds:v.spentFinds,bytes:v.spentBytes,pages:v.pages};}
   const n=state.bookingRows.length,K=new Set(state.bookingRows.map(r=>r.operationId)).size;
   const targetNames=['target-exact','booking-identity','class-identity','summary-identity'];
   const targetFinds=targetNames.reduce((v,k)=>v+c[k].spentFinds,0);
   need(targetFinds===n+K+3);
   // The admitted exact/identity set must be a deterministic terminal prefix.
   check(present.every((t,i)=>t===state.targets[i]));
   const prefix=present.length,receiptCapacity=bytes(state.expected)+4096+2;
   let targetBytes=targetNames.reduce((v,k)=>v+c[k].spentBytes,0);
   const fixedFinds=2*(c.physical.spentFinds+c['model-root'].spentFinds+c['model-manifest'].spentFinds);
   const fixedBytes=2*(c.physical.spentBytes+c['model-root'].spentBytes+c['model-manifest'].spentBytes);
   // Each remaining invocation is checked separately, not summed. Future rows
   // use canonical application + the same admitted metadata envelope as readback.
   for(let p=prefix;p<=state.targets.length;p++){
    if(receipt.status!=='FOUND'){
     const selected=state.targets[p];
     const readback=selected?bytes(selected.row)+4096+2:receiptCapacity;
     need(fixedFinds+2*targetFinds+4<=30000);
     need(fixedBytes+2*targetBytes+c['early-receipt'].spentBytes+c['early-binding'].spentBytes+2+readback<=400000);
    }
    if(p===state.targets.length){
     const receiptBytes=receipt.status==='FOUND'?c['early-receipt'].spentBytes:receiptCapacity;
     need(fixedFinds+2*targetFinds+2<=30000);
     need(fixedBytes+2*targetBytes+2*receiptBytes<=400000);
    }else{
     const t=state.targets[p],prior=state.targets.slice(0,p);
     const size=bytes(t.row)+4096;
     // Exact and identity brackets already exist, including empty class pages.
     targetBytes+=(t.collection==='Bookings'?3:2)*size;
     if(t.collection==='Bookings'){
      if(prior.some(v=>v.collection==='Bookings'))targetBytes++;
      if(prior.some(v=>v.collection==='Bookings'&&v.row.operationId===t.row.operationId))targetBytes++;
     }
    }
   }
   plan['final-receipt']={finds:1,bytes:c['early-receipt'].spentBytes,pages:1};
   const token=scope.reserveVerification('completion-reload',plan);
   if(receipt.status!=='FOUND'){const selected=state.targets[prefix]||{collection:'GuestBookingCompletions',row:state.expected};completionStore.reserveSelection(selected.collection,selected.row);}
   return await scope.verify(token,'completion-reload',invoke);
  }catch(e){scope.poison();throw e;}
 };
 session.readCompletionModel=async function(A){
  guard();if(terminalModel)return scope.passModel(passToken,A);
  // A failed or unfinished physical pass cannot fall back to model IO.
  need(passToken===null);
  const accepted=await scope.measure('model-root',async()=>{
   guard();scope.reserveExact();const a=await readGuestBookingAcceptance(A);guard();
   if(a.status==='ABSENT')scope.chargeBytes(2);if(a.status==='INTEGRITY')throw new SafeError('INTEGRITY');need(a.status==='FOUND');
   const root=validateGuestBookingAcceptanceRoot(a.root);check(root!=='DENIED'&&root.root._id===A);scope.chargeBytes(acceptancePageBytes(a.root));return root;
  });
  const record=await scope.measure('model-manifest',async()=>{
   const binding=buildGuestBookingAllocationBinding(accepted);scope.reserveExact();const m=await readGuestBookingAllocationManifest(binding.manifestId);guard();
   if(m.status==='ABSENT')scope.chargeBytes(2);if(m.status==='INTEGRITY')throw new SafeError('INTEGRITY');need(m.status==='FOUND');
   scope.chargeBytes(bytes([m.record])+4096);check(validateGuestBookingAllocationManifest(m.record,accepted));return m.record;
  });
  return {accepted,record};
 };
 // Nonescaping scope/token: only this session can select its control transport.
 session.reconcileControl=candidate=>{guard();return reconcileGuestBookingAcquisitionControl(candidate,scope);};
 session.reconcileResource=candidate=>{guard();return reconcileGuestBookingPhysicalClaim(candidate,scope);};
 session.costSnapshot=()=>{guard();return scope.snapshot();};
 session.read=async function(A){
  let token=null,terminal=false,finished=false;
  try{
   guard();token=scope.beginPhysicalPass(A);passToken=token;terminalModel=false;let controlBytes=0;
   async function control(id){const r=terminal?scope.passLookup(token,'GuestBookingAcquisitionControls',id):await readGuestBookingAcquisitionControl(id,scope);guard();if(r.status==='INTEGRITY')throw new SafeError('INTEGRITY');need(r.status==='FOUND'||r.status==='ABSENT');if(r.record&&r.record.kind!=='admission'){controlBytes+=bytes(canonicalGuestBookingAcquisitionControl(r.record));need(controlBytes<=400000);}return r.record;}
   async function resource(id){const r=terminal?scope.passLookup(token,'RoomBookingClaimEvents',id):await readGuestBookingPhysicalClaim(id,scope);guard();need(r.status==='FOUND'||r.status==='ABSENT');return r.record;}
   scope.reserveExact();const a=await readGuestBookingAcceptance(A);guard();if(a.status==='INTEGRITY')throw new SafeError('INTEGRITY');if(a.status==='ABSENT')scope.chargeBytes(2);need(a.status==='FOUND');
   const root=validateGuestBookingAcceptanceRoot(a.root);check(root!=='DENIED'&&root.root._id===A);scope.chargeBytes(acceptancePageBytes(a.root));
   const binding=buildGuestBookingAllocationBinding(root);scope.reserveExact();const m=await readGuestBookingAllocationManifest(binding.manifestId);guard();if(m.status==='INTEGRITY')throw new SafeError('INTEGRITY');if(m.status==='ABSENT')scope.chargeBytes(2);need(m.status==='FOUND');scope.chargeBytes(bytes([m.record])+4096);check(validateGuestBookingAllocationManifest(m.record,root));guard();
   const M=m.record,T=JSON.parse(M.manifestCanonical),G=T[6].length,N=T[6].reduce((n,p)=>n+p.acquisitions.length-1,0);
   // New pass: A/M/anchor/direction + start/root/I/C/Q per G + gate/a/r per N.
   // Reserve footprint conservatively (not charged IO): two S5 passes plus our
   // 4+5G+3N pass and one readback. W01 actually traverses only one S5 pass.
   need(2*(4+6*G+3*N)+(4+5*G+3*N)+1<=30000);
   const anchor={_id:'ra2-cart-'+A,acquisitionProtocolVersion:2,kind:'admission',acceptanceId:A,manifestId:M._id,manifestDigest:M.manifestDigest,manifestCanonical:M.manifestCanonical};
   const futureRows=[],futureControls=[];
   for(const plan of T[6]){const I=plan.acquisitions[0],R=plan.acquisitions.slice(1),O=I.operationId,C=completion(I,R.length),common={acquisitionProtocolVersion:2,admissionId:anchor._id,manifestDigest:M.manifestDigest,operationId:O};
    futureRows.push(...plan.acquisitions,C,{_id:'rc1-op-'+O+'-d',protocolVersion:1,claimKey:'operation:'+O+':decision',generation:1,eventType:'decide',claimType:'operation-decision',operationId:O,bookingRowId:I.bookingRowId,bookingNumber:I.bookingNumber,payloadDigest:I.payloadDigest,decisionFenceVersion:1,operationIdentityId:I._id,operationCompletionId:C._id,manifestVersion:I.manifestVersion,completionState:'complete',confirmedResourceCount:R.length,decisionState:'compensate'},...R.map(r=>({...r,_id:r._id.slice(0,-1)+'r',eventType:'release',releaseReason:'accepted-acquisition-contention'})));
    futureControls.push({...common,_id:'ra2-start-'+O,kind:'group-start',direction:'start'},{...common,_id:'ra2-root-'+O,kind:'root',operationIdentityId:I._id},...R.map((r,j)=>({...common,_id:'ra2-gate-'+O+'-p'+j,kind:'gate',rootId:'ra2-root-'+O,index:j,resourceClaimId:r._id,direction:'acquire'})));
   }
   need(futureRows.length<=10000&&bytes(futureRows)<=400000&&bytes(futureControls)<=400000);
   const stored=await control(anchor._id);
   if(!stored)return result('CANDIDATE',{collection:'control',candidate:copy(anchor)});
   check(canonicalGuestBookingAcquisitionControl(stored)===canonicalGuestBookingAcquisitionControl(anchor));
   check(validateGuestBookingAllocationManifest({_id:stored.manifestId,schemaVersion:1,manifestDigest:stored.manifestDigest,manifestCanonical:stored.manifestCanonical},root));guard();
   const evidence=await scope.readPhysicalPass(token,root,M,stored);guard();if(evidence.status!=='EVIDENCED')return result(evidence.status,{reason:evidence.reason});
   terminal=scope.hasTerminalPass(token);
   const direction=await control('ra2-direction-'+A);
   if(direction){need(evidence.direction);check(canonicalGuestBookingAcquisitionControl(direction)===canonicalGuestBookingAcquisitionControl(evidence.direction));}
   else need(!evidence.direction);
   const groups=[],positives=[];
   for(let i=0;i<G;i++){
    const I=T[6][i].acquisitions[0],R=T[6][i].acquisitions.slice(1),O=T[5][i][0];check(I.operationId===O);
    const common={acquisitionProtocolVersion:2,admissionId:anchor._id,manifestDigest:M.manifestDigest,operationId:O};
    const start={...common,_id:'ra2-start-'+O,kind:'group-start',direction:'start'},rt={...common,_id:'ra2-root-'+O,kind:'root',operationIdentityId:I._id};
    const proposals=[start,rt,...R.map((r,j)=>({...common,_id:'ra2-gate-'+O+'-p'+j,kind:'gate',rootId:rt._id,index:j,resourceClaimId:r._id,direction:'acquire'}))],controls=[];
    for(const proposal of proposals){const r=await control(proposal._id);if(r){const expected=proposal.kind==='root'?proposal:{...proposal,direction:r.direction};check(canonicalGuestBookingAcquisitionControl(r)===canonicalGuestBookingAcquisitionControl(expected));if(r.direction==='seal'||r.direction==='skip')need(direction);}controls.push(r);}
    const found=new Map();for(const id of [I._id,...R.flatMap(r=>[r._id,r._id.slice(0,-1)+'r']),'rc1-op-'+O+'-c','rc1-op-'+O+'-d']){const r=await resource(id);if(r){positives.push(r);found.set(id,r);}}
    groups.push({I,R,O,proposals,controls,found});
   }
   const scan=terminal?{rows:scope.passLedger(token)}:await scanGuestBookingPhysicalClaims(scope);guard();const ledger=scan.rows,byId=new Map();
   for(const r of ledger){check(!byId.has(r._id));byId.set(r._id,r);}
   for(const r of positives){if(byId.has(r._id))check(equal(byId.get(r._id),r));else{ledger.push(r);byId.set(r._id,r);}}
   need(ledger.length<=10000&&bytes(ledger)<=400000);
   // Include remaining same-cart settlement footprint, not merely today's prefix.
   const supported=[...ledger];for(const r of futureRows)if(!byId.has(r._id))supported.push(r);need(supported.length<=10000&&bytes(supported)<=400000);
   validateGuestBookingPhysicalLedger(ledger);guard();
   let selected=null;const reports=[];
   function select(collection,candidate){if(!selected)selected=result('CANDIDATE',{collection,candidate:copy(candidate)});}
   if(!direction&&evidence.causes.length){const c=evidence.causes[0];select('control',{_id:'ra2-direction-'+A,acquisitionProtocolVersion:2,kind:'cart-direction',admissionId:anchor._id,manifestDigest:M.manifestDigest,direction:'compensate',causeOperationId:c.operationId,causeIndex:c.index,causeResourceClaimId:c.resourceClaimId});}
   for(const g of groups){const {I,R,O,proposals,controls,found}=g;
    const events=ledger.filter(r=>r.operationId===O);
    // Terminal rows are evidence dependencies, never independent abort authority.
    if(events.some(r=>r.eventType==='release'||r.claimType==='operation-decision'))need(direction);
    const ownI=found.get(I._id);
    if(controls[0]?.direction==='skip'){check(!controls[1]&&!ownI&&!controls.slice(2).some(Boolean)&&events.length===0);reports.push(result('SKIPPED',{operationId:O}));continue;}
    if(controls[1]){need(controls[0]);check(controls[0].direction==='start');}if(ownI){need(controls[1]);check(equal(ownI,I));}
    let prefix=true,k=0,boundary=-1;
    for(let j=0;j<R.length;j++){
     const gate=controls[j+2],r=found.get(R[j]._id),own=r&&r.operationId===O;
     if(boundary>=0)check(!gate&&!own);
     if(gate){need(ownI&&prefix);if(gate.direction==='seal'){need(direction);check(!own);boundary=j;}}
     if(own){need(gate);check(gate.direction==='acquire');check(equal(r,R[j]));}
     if(r&&!own&&gate?.direction==='acquire'&&prefix){need(evidence.causes.some(c=>c.operationId===O&&c.index===j&&c.resourceClaimId===R[j]._id));boundary=j;}
     prefix=prefix&&!!own&&gate?.direction==='acquire';if(prefix)k++;
    }
    const closed=k===R.length||boundary===k,C=completion(I,k);C.completionState=k===R.length?'complete':'stopped';
    const Q={_id:'rc1-op-'+O+'-d',protocolVersion:1,claimKey:'operation:'+O+':decision',generation:1,eventType:'decide',claimType:'operation-decision',operationId:O,bookingRowId:I.bookingRowId,bookingNumber:I.bookingNumber,payloadDigest:I.payloadDigest,decisionFenceVersion:1,operationIdentityId:I._id,operationCompletionId:C._id,manifestVersion:I.manifestVersion,completionState:C.completionState,confirmedResourceCount:k,decisionState:'compensate'};
    Q.decisionState=direction?direction.direction:'compensate';
    const L=direction?.direction==='commit-rows'?[]:R.slice(0,k).map(r=>({...r,_id:r._id.slice(0,-1)+'r',eventType:'release',releaseReason:'accepted-acquisition-contention'}));
    for(const r of events){const expected=[I,...R,C,Q,...L].find(v=>v._id===r._id);check(!!expected);if(r.claimType==='operation-completion'||r.claimType==='operation-decision'||r.eventType==='release')need(closed);check(equal(r,expected));}
    if(found.get(C._id)){need(closed);check(equal(found.get(C._id),C));}
    if(found.get(Q._id)){need(direction&&closed&&found.get(C._id));check(equal(found.get(Q._id),Q));}
    let missingRelease=false;
    for(let j=L.length-1;j>=0;j--){const released=found.get(L[j]._id);if(released){need(direction&&direction.direction==='compensate'&&closed&&found.get(C._id)&&found.get(Q._id));check(equal(released,L[j]));need(!missingRelease);}else missingRelease=true;}
    if(!controls[0]){select('control',{...proposals[0],direction:direction?'skip':'start'});continue;}
    if(!controls[1]){select('control',proposals[1]);continue;}
    if(!ownI){select('resource',I);continue;}
    if(closed){
     if(!found.get(C._id))select('resource',C);
     else if(direction){
      if(!found.get(Q._id))select('resource',Q);
      else for(let j=L.length-1;j>=0;j--){if(!found.get(L[j]._id)){select('resource',L[j]);break;}}
     }
    }
    else{
     const r=R[k];
     // A valid empty ledger does not establish released prior generations.
     for(let generation=1;generation<r.generation;generation++){const prior=ledger.find(v=>v.claimKey===r.claimKey&&v.generation===generation&&v.eventType==='acquire');need(prior&&byId.has(prior._id.slice(0,-1)+'r'));}
     if(!controls[k+2])select('control',{...proposals[k+2],direction:direction?'seal':'acquire'});
     else {check(controls[k+2].direction==='acquire');select('resource',r);}
    }
    const report=create(null);report.operationId=O;report.confirmedResourceCount=k;reports.push(report);
   }
   if(direction&&!terminal){const fresh=await scope.read(A);guard();if(fresh.status!=='EVIDENCED')return result(fresh.status);need(fresh.direction);check(canonicalGuestBookingAcquisitionControl(fresh.direction)===canonicalGuestBookingAcquisitionControl(direction));}
   guard();if(selected)return selected;
   if(direction){need(reports.length===G);if(terminal){scope.finishPhysicalPass(token,true);finished=true;terminalModel=true;}return result(direction.direction==='commit-rows'?'CART_COMMIT_MATERIALIZED_PENDING_PROJECTION':'GROUP_SETTLEMENT_VERIFIED',{groups:reports});}
   if(evidence.causes.length)return result('UNKNOWN');
   need(reports.length===G&&evidence.commitReady);return result('CANDIDATE',{collection:'control',candidate:copy({_id:'ra2-direction-'+A,acquisitionProtocolVersion:2,kind:'cart-direction',admissionId:anchor._id,manifestDigest:M.manifestDigest,direction:'commit-rows',causeOperationId:null,causeIndex:null,causeResourceClaimId:null})});
  }catch(e){scope.poison();return result(e.message==='INTEGRITY'?'INTEGRITY':'UNKNOWN');}
  finally{if(token&&!finished){terminalModel=false;try{scope.finishPhysicalPass(token,false);}catch(_){scope.poison();}}}
 };
 return session;
}
