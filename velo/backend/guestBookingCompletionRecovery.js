import { discoverGuestBookingAcceptances } from 'backend/guestBookingAcceptanceDiscovery';
import { resumeGuestBookingPhysicalAcquisition } from 'backend/guestBookingPhysicalAcquisition';
import { createGuestBookingRecoveryProgressStore } from 'backend/guestBookingRecoveryProgressStore';
import { advanceInitialGuestInvoiceForRecoveredAcceptance } from 'backend/guestBookingInvoiceIssuance';
import { acceptanceDigest } from 'backend/guestBookingIssuerAuthority';

// Snapshot independent private discovery authority BEFORE coordinator awaits.
// Invalid invoice context never prevents accepted booking recovery.
function invoiceSubject(page, selected){
 try{
  const matches=page.contexts.filter(c=>Object.getOwnPropertyDescriptor(c,'acceptanceId')?.value===selected);
  if(matches.length!==1)return null;
  const values=['acceptanceId','operationId','rootDigest'].map(k=>{
   const d=Object.getOwnPropertyDescriptor(matches[0],k);
   return d&&Object.hasOwn(d,'value')&&d.enumerable?d.value:null;
  });
  if(!values.every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||values[0]!==selected||values[0]!==acceptanceDigest('wbe.acceptance-id.v2',values[1]))return null;
  return Object.freeze(values);
 }catch{return null;}
}

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
    const subject=invoiceSubject(page,selected);
    try{
     const result=await resumeGuestBookingPhysicalAcquisition(selected);
     classification=result&&typeof result.status==='string'&&!['UNKNOWN','UNRESOLVED'].includes(result.status)?'COORDINATOR_RETURNED':'COORDINATOR_UNRESOLVED';
     // Status is only a scheduling hint. Actual admission reloads retained authority
     // and site audience. Await its bounded IO; never detach work or grant START.
     const outcome=result&&Object.getOwnPropertyDescriptor(result,'status');
     if(subject&&outcome&&Object.hasOwn(outcome,'value')&&outcome.value==='CONFIRMED'){
      try{await advanceInitialGuestInvoiceForRecoveredAcceptance(...subject);}catch{/* Invoice uncertainty cannot alter this booking visit. */}
     }
    }catch{classification='COORDINATOR_UNRESOLVED';}
   }
  }
  return await store.append(selected,classification,page.exhausted&&page.sourceCount<=1);
 }catch{return {status:'UNRESOLVED'};}
}
