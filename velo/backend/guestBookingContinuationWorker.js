import { recoverGuestBookingCompletionsAndAdmitInvoices } from 'backend/guestBookingCompletionRecovery';

// Private trusted-host entrypoint, deliberately not a .web.js or HTTP handler.
// Configure a recurring host separately; this file does not activate a schedule.
// One invocation awaits ONE durable journal visit, not an unbounded drain. The
// journal cursor advances even for unresolved subjects and rotates at the tail.
// Every new invocation/restart reads that retained cursor, never process memory.
// Acceptance is the work item: interruption before a separate enqueue ACK cannot
// strand it. Completed-but-unadmitted subjects are revalidated on later sweeps.
// Native producer read/page/byte reservations remain enforced; no occupancy is
// truncated to meet a wall-clock claim. A hosted single-quantum budget remains an
// activation check, not something a between-visit timer can guarantee.
export async function runGuestBookingContinuation(){
 if(arguments.length!==0)return {status:'INTEGRITY'};
 return await recoverGuestBookingCompletionsAndAdmitInvoices();
}
