# WC-1046 — request-specific processing diagnosis

## Finding
Google returned **SUCCESS** for request `63652579-8bde-4f64-8620-0f7c68dd8f22`, observed at `2026-10-19T20:22:25.687Z` through Wix's private backend function tester. This is a real request-status GET, not a simulated provider response or a repeated conversion upload.

| Field | Observed result |
|---|---|
| HTTP status | 200 |
| Google Ads account | 9426928570 |
| Conversion action | 7690532327 (Booking - API Import) |
| Destination match | true |
| Request status | SUCCESS |
| Record count | 1 |
| Processing errors | Empty list |
| Processing warnings | Empty list |
| Projection complete | true |
| Unknown reason present | false |

The sanitized UI output is preserved verbatim in [wc1046-processing-status-ui.txt](wc1046-processing-status-ui.txt). It is a projection of Google's response, not a raw API-response dump. The response does not echo the request ID; the private diagnostic binds identity to the fixed HTTPS GET and checks the account/action.

## Correction to the earlier interpretation
The October 19 Ads UI review showed an October 17 Data Manager date row with one error and zero success. That row did not expose this request ID. The exact-request result now establishes successful processing for WC-1046; the date-level row must not be treated as evidence that this booking failed processing. The reason for the UI/API discrepancy remains unresolved.

## What this proves, and what it does not
The October 17 immutable journal RESULT recorded ingestion acknowledgment for WC-1046 at 5898.15 USD, and the owner confirmed invoice receipt. The current exact-request check adds successful processing. It does not prove that Google matched the contact to an eligible ad interaction or credited a purchase/revenue.

The earlier October 19 UI review (October 1–19 reporting range) showed zero conversions and zero value, including conversion-time metrics, and the action still showed Misconfigured plus user-provided-data/matching warnings. These were earlier UI observations, not refreshed by this status-only call. The booking session had READY_EMPTY (no captured paid-click ID). An absent eligible match is a possible explanation for no credited conversion, not a confirmed request-level error. A direct test booking cannot guarantee attributed revenue.

## Execution and cleanup
- Backed up the existing private diagnostic source and confirmed it matched the repository.
- Added only a temporary fixed-ID private reader calling the existing strict status-read path: no ingest call, booking/CMS write, generic public endpoint, or retry.
- Adapted the existing fixed-reader tests in an isolated scratch mirror: **6 tests passed, 0 failed**, exit 0. These are offline safety tests, separate from the real Google GET.
- Ran the specific reader through Wix's backend function tester and expanded the returned destination, errors, and warnings.
- The general editor Run control initially opened Home Preview; it did not execute the backend status reader. Returned to the editor and used the function-specific gutter control and `tbf-run-button` for the actual GET.
- Restored the original diagnostic source, saved, reloaded, and verified exact source equality with the backup; temporary reader absent. Restored source SHA-256: `fbebb8b72d8f1dde0ce33d21892476b0f2b37fec51c09a93d5f119c3a2781d33`.
- No new publication, conversion resend, cancellation, Ads configuration edit, or collection-permission change. Production code is unchanged by this investigation. No independent reviewer was used.

## Recommended next investigation
Investigate eligibility/customer matching and the remaining action-level diagnostics, not an unproven upload-processing defect. Do not resend WC-1046 or manufacture a paid click. Use request-specific status as the processing evidence, and keep matching/attribution/revenue as separate gates.

Reference: [Google Data Manager diagnostics](https://developers.google.com/data-manager/api/devguides/diagnostics).
