# Future noncritical bug-fix upgrades

Items here are deferred, not authorization to implement or publish.

## Room-level stay dates for inventory

- **Priority:** Noncritical / future upgrade.
- **Status:** Deferred at Tom's request.
- **Problem:** Current legacy Search uses BookingSummary dates joined by bookingNumber rather than each Bookings row's dates. Missing summaries can exclude occupancy, and rooms with shorter stays can remain unavailable through the overall reservation checkout.
- **Desired behavior:** Use each Bookings row's checkIn, checkOut, roomCode, quantity and status for inventory. Treat checkout as exclusive so another guest can arrive that day. Rooms with different stay dates use separate rows; identical room-type/date groups may retain aggregate quantity. BookingSummary describes the overall reservation without overriding individual room dates.
- **Scope for later assessment:** Coordinate Search and booking-save availability checks. Assess mixed-length pricing, Summary, invoice, administrative and Calendar consumers before claiming end-to-end support. Define a safe legacy fallback for missing room dates, reconcile current reservations, and preserve records and financial values.
- **Acceptance cases:** Mixed-length room stays; same-day checkout/check-in; quantity greater than one; manual owner blocks without summaries; cancelled rows; conflicting or missing dates; consistent search/save decisions.
- **Current operational requirement:** Until upgraded, manual bookings/blocks need a matching BookingSummary with the correct dates. Adding that summary fixes a missing block but does not support mixed room stay lengths.
