# WC-1046 matching-path investigation — further evidence

## Confirmed account observations
The expanded Booking - API Import diagnostics show October 19 last-ping dates and say:
- "Your Google tag is firing, but is not capturing user provided data. Configure your tag to send user provided data to Google Ads."
- "Your imported user-provided data (eg, email addresses) has no matches to web events. Use the Google tag on your website to send user-provided data."
These are action-level diagnostics, not a request-specific rejection of WC-1046. Its request-status SUCCESS remains valid.

The AW-788746633 tag's user-provided-data capability is enabled. Manual email collection is enabled with `#comp-mqo6cvon input[type="email"][name="email"]`; automatic collection, manual phone, and manual address are not enabled. The served Google JavaScript contains the same enabled manual email setting and selector. The published Summary DOM contains exactly one matching input. This rules out a missing/wrong configured selector in the inspected current environment. No account settings were edited.

## Isolated browser control — executed, not a provider send
Loaded the published Summary and Google library in an isolated Chrome context. All Google measurement requests were aborted; before entering synthetic email, all other non-library outgoing requests were blocked too. No booking was created.

An initial direct-Summary test produced no email payload with selector-only form_submit, while explicit user_data produced one. That initial comparison had a visibility confound: without a quote, Summary hides its content. It is NOT evidence that the production selector is broken.

A corrected control made the existing input and its ancestors visible only within the isolated test browser, retaining the actual selector and served tag. Both selector-only form_submit and explicit user_data then produced outgoing form-data requests containing the independently verified SHA-256 of the synthetic email (Google encodes the digest in base64url). These requests were intercepted, not delivered. The result proves the current selector/tag can collect a visible email; it does not prove WC-1046's actual form event fired, that its input was visible at that instant, or that Google matched the customer.

See `wc1046-matching-browser-control.json`. Synthetic contacts and hashes are not included in its output. The original visibility was false; the controlled visibility was true. This is not a complete natural booking-funnel test.

## Actual-source offline timing reproduction
Used the existing ads-custom-form harness against actual Summary, tracking, bridge, Head and policy modules, with simulated CMS responses. Automatic/no-required-consent fixture:

| Simulated policy-read delay | Browser form_submit | Backend conversion invocation | Invoice invocation |
|---|---:|---:|---:|
| 0 ms | 1 | 1 | 1 |
| 1700 ms | 0 | 1 | 1 |

Both assertions passed, exit 0. The harness is network-inert. The 1500 ms per-phase policy deadline intentionally fails closed, and its failure is swallowed as optional tracking. Thus an invoice and accepted backend upload can coexist with a missing browser matching event. This is a reproduced possible mechanism, NOT established as WC-1046's historical root cause. Do not loosen consent checks or change deadlines without testing the actual failure.

## Remaining evidence boundary and controlled retest
WC-1046's retained journal lacks the historical complete user-data payload, form prepare/complete timings, and browser form-data request. Current reproduction cannot recover those historical bytes. A further owner-operated test booking is justified to capture the exact missing boundary, not to force an ad-attributed purchase.

A passive observer is prepared on the existing Chrome Booking Search tab. It records sanitized bridge phases, field-present/value-present/visible booleans, policy RPC timing, and Google endpoint/event/email-parameter presence. It does not log contact values or hashes, alter production code, or submit anything. Owner should prepare a booking and pause before Confirm so capture and Wix logs can be checked first. A new direct test still cannot guarantee ad-attributed revenue without an eligible interaction.

No production changes, publication, Ads settings edits, WC-1046 retry, or cancellation occurred. Current source remains unchanged; diagnosis is not complete.
