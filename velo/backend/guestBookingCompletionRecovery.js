import { handoffGuestBookingAllocation } from 'backend/guestBookingAllocationHandoff';
import { discoverGuestBookingAcceptances } from 'backend/guestBookingAcceptanceDiscovery';
import { resumeGuestBookingPhysicalAcquisition } from 'backend/guestBookingPhysicalAcquisition';
import { createGuestBookingRecoveryProgressStore } from 'backend/guestBookingRecoveryProgressStore';

// Off-production private quantum; deliberately absent from jobs.config.
// Checkpoints are visits, never confirmation, credential or provider authority.
function key(v){return typeof v==='string'&&v.length>0&&v.length<=128&&/^[\x20-\x7e]+$/.test(v);}
function validPage(p,cursor){
 if(!p||p.status!=='PAGE'||!Array.isArray(p.sourceIds)||!Array.isArray(p.contexts)||!Array.isArray(p.invalid)||p.sourceCount!==p.sourceIds.length||p.sourceCount>25||typeof p.exhausted!=='boolean')return false;
 const expected=['status','sourceIds','sourceCount','contexts','invalid','nextCursor','exhausted'];
 if(Object.keys(p).length!==expected.length||Object.keys(p).some(k=>!expected.includes(k)))return false;
 let last=cursor;
 for(const id of p.sourceIds){if(!key(id)||(last!==null&&id<=last))return false;last=id;}
 if(p.exhausted?p.nextCursor!==null:(p.sourceCount!==25||p.nextCursor!==last))return false;
 if(p.sourceCount===0&&!p.exhausted)return false;
 const seen=new Set();
 for(const partition of [p.contexts.map(c=>c&&c.acceptanceId),p.invalid]){
  let index=-1;
  for(const id of partition){const next=p.sourceIds.indexOf(id);if(next<=index||seen.has(id))return false;seen.add(id);index=next;}
 }
 if(p.contexts.some(c=>typeof c.acceptanceId!=='string'||!/^[a-f0-9]{64}$/.test(c.acceptanceId)))return false;
 return seen.size===p.sourceCount;
}
export async function recoverGuestBookingCompletions(){
 if(arguments.length!==0)return {status:'INTEGRITY'};
 try{
  const store=createGuestBookingRecoveryProgressStore();
  const state=await store.head();if(state.status!=='READY')return {status:'UNRESOLVED'};
  // Counter exhaustion/readback capacity deny BEFORE discovery or coordinator work.
  if(!store.reserve())return {status:'UNRESOLVED'};
  const page=await discoverGuestBookingAcceptances(state.head.afterSourceId);
  if(!page||page.status!=='PAGE')return {status:page&&page.status==='INTEGRITY'?'INTEGRITY':'UNRESOLVED'};
  if(!validPage(page,state.head.afterSourceId))return {status:'INTEGRITY'};
  const selected=page.sourceIds.length?page.sourceIds[0]:null;
  let classification='EMPTY_SWEEP';
  if(selected!==null){
   classification='INVALID_ROOT';
   if(!page.invalid.includes(selected)){
    // Actual acceptance-ID-only coordinator reloads receipt and all authority.
    // Unknown is visited, not confirmed; never detach an in-flight call.
    try{
     // Durable acceptance, not a guest credential or returned manifest, is authority.
     // Both actual APIs independently reload it; only manifest readiness opens physical work.
     classification='COORDINATOR_UNRESOLVED';
     const allocation=await handoffGuestBookingAllocation(selected);
     if(allocation&&allocation.status==='ALLOCATION_HANDOFF_PENDING'){
      const result=await resumeGuestBookingPhysicalAcquisition(selected);
      classification=result&&typeof result.status==='string'&&!['UNKNOWN','UNRESOLVED'].includes(result.status)?'COORDINATOR_RETURNED':'COORDINATOR_UNRESOLVED';
     }
    }catch{classification='COORDINATOR_UNRESOLVED';}
   }
  }
  return await store.append(selected,classification,page.exhausted&&page.sourceCount<=1);
 }catch{return {status:'UNRESOLVED'};}
}
