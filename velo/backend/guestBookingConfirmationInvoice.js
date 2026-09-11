import { readOwnGuestBookingAcceptedSubject } from 'backend/guestBookingAcceptance';

// Compatibility name for the private explicit-confirm deputy. The durable
// acceptance itself is the work item, including when the web acknowledgement is
// lost. Physical acquisition/admission now belong exclusively to the private
// continuation worker, not a guest request or read-only status poll.
// Fixed work: one authenticated exact acceptance read, zero scans/projections.
// No elapsed timeout is claimed for an already-started SDK/secret request.
export async function completeOwnGuestBookingAndAdmitInvoice(token,capsule){
 if(arguments.length!==2)return {status:'DENIED'};
 try{
  const bound=await readOwnGuestBookingAcceptedSubject(token,capsule);
  if(bound.status!=='BOUND')return {status:bound.status};
  return {status:'ACCEPTED_PENDING'};
 }catch{return {status:'ACCEPTED_PENDING'};}
}
