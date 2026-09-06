import { scanGuestBookingAcceptances } from 'backend/guestBookingAcceptanceStore';
import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';

// Private handoff only, NOT a full-cart completion engine or scheduled job.
// One page per invocation. Resume nextCursor; after exhaustion start at null.
export async function discoverGuestBookingAcceptances(cursor){
 const page=await scanGuestBookingAcceptances(cursor);if(page.status!=='PAGE')return page;
 const contexts=[],invalid=[];
 for(const row of page.rows){
  const valid=validateGuestBookingAcceptanceRoot(row);
  if(valid==='DENIED'){invalid.push(row._id);continue;}
  contexts.push({operationId:valid.root.operationId,bookingNumber:valid.root.bookingNumber,capsule:valid.root.capsule,calculation:valid.calculation,rootDigest:valid.root.rootDigest});
 }
 return {status:'PAGE',contexts,invalid,nextCursor:page.nextCursor,exhausted:page.exhausted};
}
