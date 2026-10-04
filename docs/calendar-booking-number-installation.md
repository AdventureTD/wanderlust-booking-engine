# Calendar booking numbers and cancellation identity

## Release scope

This is a code-only, review-required change. It does not cancel, reconcile, relabel, delete, or resend anything in production. Do not replay WC-1041 or any older cancellation to test installation.

Candidate parent: `1f823594467261e8430847a7d09c494f1af31b20`. Only runtime replacement: `scripts/google-calendar-webhook.gs`. The release commit must be pinned after independent review; a moving branch is not an installation pin.

| Destination | Action after separate deployment approval |
|---|---|
| Existing Google Apps Script Calendar web app | Replace its complete Calendar webhook source with the reviewed committed `scripts/google-calendar-webhook.gs`; publish a new version of the **same deployment**, preserving its URL and executor. Do not create another project. |
| Render invoice service | **No code deployment required for this delta.** Existing creation payload already includes `bookingNumber`. Its Calendar module and routes are unchanged. Keep Auto-Deploy **Off**. |
| Wix backend/pages | **No paste, Editor access, or publication required for this delta.** Existing Admin cancellation and deletion-proof consumer are unchanged. |
| Wix CMS | No collections, fields, migration, or data writes. |
| Secrets / Script Properties | No new secret or settings. Preserve existing `WBE_CALENDAR_SECRET`, every `booking:*` mapping/tombstone, Render URL and matching secret. Never copy secret values into source or chat. |

Historical installation evidence records Apps Script version 5 with archived-source parity to the deletion release and Render `08b41fc0f66a0b6af61140c828e2ff3cbc9d2793`. A fresh read-only Render `/health` during this change confirmed that exact SHA. Apps Script was not reopened/reverified. Do not invent the next version number; record the actual selected version when an approved installation occurs. The owner's latest Wix publication reference is `9a3ee61` / revision `26587`; the candidate parent includes newer attribution work and must NOT be installed wholesale for this Calendar-only change.

## Behavior

- New booking-bound events include the exact `WC-…` token in title and description. Example title: `WC-1041 — Wanderlust Caribbean Booking: <existing name>`. No additional guest information is introduced; existing title/description content is preserved.
- Existing exact-token labels are not duplicated; `WC-10410` is not `WC-1041`.
- Original incoming title and dates remain the retained replay comparison. An identical reissued invoice does not recreate or retroactively relabel an older bound event.
- New mappings retain booking number, calendar ID and event ID. START and completed mapping must read back exactly before dispatch / success respectively. An uncertain completed mapping is UNKNOWN, not success; retries cannot recreate an event from STARTED.
- Invalid supplied identifiers fail closed instead of being coerced or falling into unbound legacy creation. A truly omitted booking number retains the pre-existing legacy creation contract.
- Cancellation still requires the exact retained calendar/event identity, matching event tag and executor-owned calendar. Conflicting retained booking numbers deny deletion. Older records without the redundant booking-number field remain compatible through their exact property key and event tag.
- A visible title is a human aid, **never deletion authority**. Unbound historical events remain NEEDS_RECONCILIATION; no title/date search, broad scan, backfill or manual deletion is added.
- Receipt contract is unchanged: versioned DELETED proof is required by Render and Wix. Exceptions/uncertainty remain UNKNOWN; absent unattempted events remain reconciliation-needed. A canceled reservation is not proof of Calendar deletion.
- Calendar.getEventById null is not an HTTP 404. Existing retained-attempt/owned-calendar checks remain unchanged. Email START/ACK no-retry rules remain unchanged.

## Dates, inventory and updates

The current production-compatible webhook creates **one event per guest booking**, not one per physical room or derived owner block. Cancellation of child Bookings rows and inventory release remain owned by Wix `bookingCancellation.js`; this delta does not alter those rules or delete owner-block events.

There is no supported Calendar update action in this branch. A changed stay/title for an existing binding requires reconciliation; the webhook does not overwrite it. Recompute/admin-save paths are not automatic Calendar updates. Existing calendar events are not migrated. All-day local civil parsing and exclusive checkout are unchanged and tested in America/Barbados, America/New_York and UTC.

## Verification and rollout gate

Run `node --test tests/calendar-booking-number.cjs` and `node --experimental-vm-modules --test tests/calendar-deletion-contract.cjs`. The latter crosses the actual Apps Script response, Python Calendar mapper, extracted Render handler and Wix receipt consumer with inert provider/storage boundaries. This is local behavior testing, not a live deletion.

Before any approved installation, independently review the exact committed source and preserve current deployment/source/version metadata without exporting secrets. After installation, read back the selected deployed source/version and confirm the same deployment URL, executor and preserved properties. A GitHub push or Apps Script Save does not deploy the receiver. Do not call `/calendar-debug`, which creates an event.

Future live create/cancel verification requires separate explicit authorization for an exact booking. Read back the specific retained mapping and deletion receipt; do not infer success from title search or booking status. WC-1041's actual Calendar result and cancellation journal have NOT been independently inspected by this implementation; its removal and incident cause remain **unverified**.
