import { readGuestBookingAllocationEvidence } from 'backend/guestBookingAllocationEvidence';
import { allocationConstraintsFromSources } from 'backend/guestBookingAllocationSourceRules';

// Search and allocation share validated retained-claim occupancy. Pending row
// labels never confer confirmation, and projected rows are not charged twice.
export async function loadInventorySnapshot(checkIn, checkOut) {
  const evidence = await readGuestBookingAllocationEvidence(checkIn, checkOut);
  if (evidence.status !== 'READY') throw new Error('Unresolved inventory evidence');
  return allocationConstraintsFromSources(evidence.planningEvidence, checkIn, checkOut).effectiveSnapshot;
}
