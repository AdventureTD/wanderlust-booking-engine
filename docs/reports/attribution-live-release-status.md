# Attribution live release — verified results

## Published and activated

With Tom's explicit coordinated-release approval, the existing `google-tag-and-consent` Head entry was replaced with the tested candidate and the tested Wix draft was published. **Live version 27118 is now at 100% exposure.** Release Manager retains Test Site 27117 at 0%. No new Head entry was created; placement, page scope and load behavior were left unchanged.

Before activation, all eight scoped editor models matched the repository and the editor iframe matched the candidate. The existing Head matched its prior backup and was backed up again. The new 14,874-UTF-16-unit snippet was saved and reopened for exact readback before the editor publication. Wix subsequently displayed “Your site is published and live online”; default public HTML, a fresh browser and Release Manager independently reported version 27118.

Code source: `573c995ca67380ee4f478937983456c00e5abd24`, branch `ric/attribution-only`. The underlying release passed the recorded 87-script fresh-clone regression run and the test-site single-/mixed-room checks before this activation. No new product-code edits were made in this release step.

## What was verified live

- Exactly **one** inline Head script body matched the candidate.
- Exactly **one** HTML component frame matched the tested iframe bridge scripts.
- The no-click-ID tracking handshake reported **`READY_EMPTY`** on initial Home load and again on reload, replacing the previously observed open timeout. The new tracking flag method returned enabled, and the policy-requirement method was requested.
- Google runtime containers `G-MKGG3X1WP9` and `AW-788746633` were present. Their actual observed `googletagmanager.com/gtag/js` URLs separately returned HTTP 200 JavaScript. Cross-origin browser timing exposed zero status/size fields; those fields were not misrepresented as HTTP response evidence.
- On the normal live URL (without `rc=test-site`), Search completed availability/selection and navigated to Summary with `rooms=adventure_suite:1:2:0`. Summary remained on **27118**, accepted the signed quote, and displayed **$6,396.59** for the previously tested February 14–21, 2027 single-suite/two-guest selection. Contact fields stayed empty and Confirm Booking was not clicked.
- Captured RPC paths included flags, reference data, availability, quote creation/read and attribution policy. No booking-creation, invoice, Summary-update or conversion-import method was invoked.

## One unresolved observation

The initial fresh Home load produced one uncaught exception: `Unexpected token '<', "<?xml vers"... is not valid JSON`. It did not recur on reload, Search navigation or Summary initialization. The observation was captured without a source stack, so its origin is **not established**. Do not label it harmless or claim a completely error-free release. The handshake and pre-confirmation checks above succeeded despite it; retain it for follow-up if it recurs.

## Explicit limits

This release is **published and smoke-checked**, not end-to-end conversion acceptance:

- `READY_EMPTY` proves the tested empty-attribution exchange, not delivery of a paid click ID or hashed contact data.
- No real guest contact details, synthetic ad identifiers, reservation, invoice or conversion import were used.
- Browser measurement endpoints were intentionally guarded during validation; logged send intentions are not proof of provider delivery. These temporary browser guards do not change site or Ads-account configuration.
- Booking persistence, invoice delivery, provider acceptance/matching, and Google's Enhanced Conversions warnings remain unverified by this run. A controlled booking/import test needs separate approval.
- No collection permissions or deferred Booking Summary security components were changed. The previously documented access/security limitations remain unresolved.

## Evidence and rollback boundary

Structured results: [attribution-live-release-results.json](attribution-live-release-results.json).

Fresh Head backup and model manifest: `C:/Users/TomDe/AppData/Local/hermes/profiles/ric/marketing-reference/google-ads/editor-backups/live-release-20261017T151501Z/`. Earlier draft/bridge backups remain in the installation reports.

If rollback becomes necessary, coordinate the prior Wix release and its matching saved Head; reverting only one can reintroduce protocol mismatch. No rollback was performed, and restoring code is not a guarantee that earlier browser attribution state can be recovered.
