import { issueGuestBookingOffer } from 'backend/guestBookingOfferIssuer';
import { acceptGuestBookingOffer } from 'backend/guestBookingAcceptance';
import { readOwnGuestBookingCompletionStatus } from 'backend/guestBookingCompletionStatus';

// Private preparation only: no incoming UI consumer, public method or completion authority.
// Callers supply inert same-realm Summary snapshots and explicitly confirm the returned handle.
function detach(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  for (const key of Object.keys(value)) copy[key] = detach(value[key]);
  return copy;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
export function createGuestBookingSummaryStatusConnector() {
  let retained = null, generation = 0;
  function invalidate() { generation++; retained = null; }
  return Object.freeze({
    invalidate,
    async prepare(snapshot) {
      invalidate();
      const current = generation;
      const {summaryRooms, ...input} = snapshot;
      input.priceGroups = summaryRooms.map(g => ({roomCode:g.roomCode, quantity:g.qty, guests:g.numGuests}));
      const result = await issueGuestBookingOffer(input);
      if (generation !== current) return Object.freeze({status:'STALE'});
      if (result === 'DENIED') return Object.freeze({status:'DENIED'});
      const handle = freeze({status:'OFFER', display:detach(result.display), packageTitle:result.packageTitle, offerExpiresAtMs:result.offerExpiresAtMs});
      retained = {handle, token:result.token, capsule:result.capsule};
      return handle;
    },
    async readStatus(handle) {
      if (!retained || handle !== retained.handle) return {status:'DENIED'};
      const subject = retained;
      const result = await readOwnGuestBookingCompletionStatus(subject.token, subject.capsule);
      if (retained !== subject) return {status:'STALE'};
      return result;
    },
    async confirm(handle) {
      if (!retained || handle !== retained.handle) return {status:'DENIED'};
      return acceptGuestBookingOffer(retained.token, retained.capsule);
    }
  });
}
