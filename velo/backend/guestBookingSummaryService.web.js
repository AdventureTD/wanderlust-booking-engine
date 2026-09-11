import { Permissions, webMethod } from 'wix-web-module';
import { issueGuestBookingOffer } from 'backend/guestBookingOfferIssuer';
import { acceptGuestBookingOffer, readOwnGuestBookingAcceptance } from 'backend/guestBookingAcceptance';
import { readOwnGuestBookingCompletionStatus } from 'backend/guestBookingCompletionStatus';
import { completeOwnGuestBookingAndAdmitInvoice } from 'backend/guestBookingConfirmationInvoice';

// Candidate-only wire boundary. Credentials remain purpose-bound; no booking
// number, client display or coordinator result can authorize confirmation.
function credential(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || typeof value.token !== 'string' || typeof value.capsule !== 'string') return null;
  return {token:value.token,capsule:value.capsule};
}
export const prepareGuestBookingSummary = webMethod(Permissions.Anyone, async (snapshot) => {
  try {
    const {summaryRooms,...input}=snapshot;
    input.priceGroups=summaryRooms.map(g=>({roomCode:g.roomCode,quantity:g.qty,guests:g.numGuests}));
    const offer=await issueGuestBookingOffer(input);
    if(offer==='DENIED')return {status:'DENIED'};
    return {status:'OFFER',display:offer.display,packageTitle:offer.packageTitle,offerExpiresAtMs:offer.offerExpiresAtMs,credential:{token:offer.token,capsule:offer.capsule}};
  } catch { return {status:'DENIED'}; }
});
export const confirmGuestBookingSummary = webMethod(Permissions.Anyone, async (value) => {
  const c=credential(value);if(!c)return {status:'DENIED'};
  const result=await acceptGuestBookingOffer(c.token,c.capsule);
  if(result.status==='ACCEPTED_PENDING'){
    // Await only the caller's authenticated explicit command, never a global sweep.
    // Keep the existing minimal DTO; the read-only status revalidates completion.
    try{await completeOwnGuestBookingAndAdmitInvoice(c.token,c.capsule);}catch{/* durable acceptance is not undone */}
  }
  return {status:result.status};
});
export const readGuestBookingSummaryStatus = webMethod(Permissions.Anyone, async (value) => {
  const c=credential(value);if(!c)return {status:'DENIED'};
  const own=await readOwnGuestBookingAcceptance(c.token,c.capsule);
  if(own.status!=='ACCEPTED_PENDING')return {status:own.status};
  // Read-only disclosure. Private recovery owns booking and invoice work.
  // A guest poll must never initiate issuance, START, or provider delivery.
  return readOwnGuestBookingCompletionStatus(c.token,c.capsule);
});
