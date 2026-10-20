# WC-1048 — first request-specific status

The instrumented owner booking was WC-1048. Immutable journal RESULT shows INGESTION_ACKNOWLEDGED, HTTP 200, request ID `1ea5a58b-2dd5-451f-8051-38928c74d72f`. Original event: 5898.15 USD, transaction WC-1048, 2026-10-20T03:45:10.553Z. Destination account 9426928570/action 7690532327.

Native Google status observed at 2026-10-20T03:49:28.167Z: **PROCESSING**, HTTP200, correct destination. Record count not yet available. Empty error/warning arrays at this stage are not final no-error evidence. The local projection marks INCOMPLETE_DATA because Google has not reached a final state; this is not an upload rejection.

## Browser evidence
Both form phases completed while the email field was populated and visible. Form-policy responses: prepare 390ms, complete 312ms. The 1500ms timeout was NOT observed in this booking. Browser requests included form_submit and email-bearing /pagead/form-data/788746633 and /ccm/form-data/788746633. Backend log identifier types: emailAddress,phoneNumber. These are request observations, not proof of Google's response/acceptance or identity matching. Browser capture did not retain contact values/hashes or Google response bodies.

The action UI was refreshed and set to October 1–19 (account-local date). It still shows Misconfigured, missing user-provided data and no matching web events, last-ping date October 19. These action-level diagnostics are not request-specific proof of this new upload's failure. No new attributed purchase is established.

The separate adminListBookings permission denial recurred; Admin permission unchanged. Invoice receipt has not been newly confirmed by the owner.

## Safety and next check
Temporary private fixed-ID strict status reader passed 6/6 offline tests, then executed in Wix's function tester. The original source was restored, saved, reloaded and exactly compared. No publication, Ads settings change, conversion resend, cancellation or collection-permission change.

A one-shot follow-up was scheduled for 2026-10-20T00:21:20.691912-04:00 (job c403a3777c12). It checks this exact request rather than resending it. No further booking is currently needed. Historical WC-1046 root cause remains unproven; this test rules out the suspected timeout for WC-1048 only.
