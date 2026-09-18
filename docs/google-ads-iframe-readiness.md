# Bounded iframe readiness recovery (candidate; not deployed)

Base: `dc98dc8d109e1076f45f142da504f755ccbb2b1d`.

## Runtime copy list

Only `velo/public/clickAttribution.js` changes. After different-author review and owner-approved Git delivery, replace the entire **Public / clickAttribution.js** file. Do not copy this candidate before review. No Head, iframe, tracking, masterPage, Summary, backend, phone helper, npm package, consent UI, collection, destination or setting update is required. Commit approval is not deployment approval. No Head Apply is part of this change.

The existing Head and iframe protocol is reused without additional messages. The generated Head stays 14,802 UTF-16 characters in full CRLF form (15,000 cap); readable `.source.html` remains development-only.

## Why this fixes the witnessed ordering

The worker previously timed out open at 500 ms, returned closed, and discarded the valid allowed response after the iframe loaded about five seconds later. An open result is only a transport handshake: the actual Head permits open even when the saved consent choice is denied. It is **not** consent permission.

The ordinary request deadline remains 500 ms. After an open timeout, keep a separate bounded readiness watch for that exact request's nonce, sequence and captured revision. A late exact-schema open result with a null record can consume that watch once. It never completes the old request or writes attribution. Instead, an allowed hint initiates a fresh cryptographic nonce/open, fresh policy read, authenticated read and confirm through the unchanged secure iframe/Head bindings. Only the new confirmed result can make attribution available.

Each explicit wait owns a ten-second readiness window and at most two event-driven recovery attempts. The deadline is checked immediately before open/read/confirm posts and inside the deferred policy invocation, not just when accepting a late hint. A request already dispatched before expiry may finish afterward; this is not transport cancellation. There is no polling, repeated timer posting or new `iframeLoaded` trust. An absent response expires the watch without retry. A late negative reply cancels recovery and fails closed. Clear, suspension, a superseding wait, and observed revocation cancel the watch; dispatch-time nonce/revision checks prevent an invalidated request's later timeout from arming a replacement. Old continuations cannot overwrite a newer completed wait's permission.

`attributionDenied()` still means **unavailable for optional collection**: it is true for unready transport as well as explicit consent denial. The readiness watch represents transport uncertainty privately. This does not write/clear any visitor consent choice, synthesize acceptance, or make timeout equivalent to an actual visitor opt-out. Saved denial remains in the unchanged Head policy gate until a valid new choice. No denied optional contact snapshot is exposed.

## Booking lifetime and limits

Homepage/master initialization can recover in the background while the document remains alive. The caller is not held for the ten-second window. A booking that runs before transport readiness still proceeds without optional attribution/contacts; a later recovery cannot resurrect its captured permission handle or resend its completed conversion. The existing 2,000 ms redirect is unchanged. This is not a promise to capture IDs when an iframe never loads, no reply arrives, loading exceeds the finite window, the worker/document ends, or a guest books before readiness.

The historical R2 limit remains: an already-issued permitted confirmation can arrive before an undelivered revocation. This protocol is not atomic observation of the page's current consent. The first delivered revocation invalidates the worker epoch. Original R2 is retained as a failing safety probe, not hidden by a weaker assertion.

## Offline verification

Run with Node's experimental VM modules and the existing network-denial preload:

```
node --experimental-vm-modules --test tests/click-attribution-readiness.cjs
```

The new suite uses actual worker, Head and iframe source. An inert queued component models the observed request delivery after frame loading, not Wix's undocumented queue implementation. It covers five-second recovery, never-frame/no-response, finite retries/expiry, malformed hints, origin/source/multiple-frame rejection, stale/replayed results, denied choices, lifecycle changes, withdrawal/reacceptance, overlapping waits, and the actual fresh AUTH -> Summary -> journal -> inert serialized-wire producer, including early-booking denial and out-of-order concurrent bookings.

Separate checkpoint evidence executes the **unmodified published compiled master bundle** in a native VM with this actual Head/iframe chain: immediate delivery succeeds; five-second queued delivery returns closed near 500 ms, then receives an allowed open without issuing read. Candidate GREEN uses repository source, not a fabricated replacement published bundle. No new live events, Editor/OAuth/provider calls or bookings were performed.

The existing crypto/lint 11, prior independent 12, bounded union 143, generated-Head 56 and attribution 41 regressions are also rerun. Counts overlap. Hosted compiler/publication and live readiness behavior require separately authorized verification; offline success is not deployment evidence.
