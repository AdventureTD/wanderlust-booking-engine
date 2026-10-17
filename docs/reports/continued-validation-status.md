# Continued attribution testing — no further publication

## Scope and state

Tom authorized continued testing while unavailable, reserving any further website publication for his return. No product source, editor draft, Head entry, collection permission or Ads setting was changed in this pass. The previously approved live release remains **27118**. No guest reservation was selected, booking confirmed, invoice sent or conversion imported.

## Executed checks

- Re-ran the standard generated-Head/parity check and full offline suite: **87/87 executable scripts passed**. Evidence: `continued-validation-offline-results.json`.
- Captured six guarded browser checkpoints: fresh desktop Home, desktop Home reload, fresh narrow-viewport Home, narrow-viewport reload, direct live Search, and live mixed-room Summary. All stayed on **27118** and eventually logged **READY_EMPTY**. Summary required waiting for its asynchronous handshake after the UI appeared; the final evidence includes that settled result.
- The narrow viewport was 390×844 in desktop Chromium, not a real mobile device or mobile-user-agent test.
- The live mixed-room case preserved one Adventure Suite/two guests and one Two Bedroom Apartment/three guests, February 14–21, 2027, and displayed **$15,991.46**. It used normal live routing without the test selector. Contact fields remained blank; Confirm Booking was not clicked.
- There were no captured business-write attempts. Measurement requests were guarded; readiness logs are not proof of delivered Google measurement or matched conversions.

## Startup error investigation

The XML-as-JSON startup exception is now reproducible on fresh Home contexts, not merely a one-off observation. Two fresh Home captures produced the exception; both recorded:

`GET https://cdn.bannersnack.com/wix/wanderlustcaribbean.com.json` → **403**, content type **application/xml**.

The observed Bannersnack loader (`https://app.bannersnack.com/public/bswix.js`) was retrieved and inspected. It fetches that hostname-specific JSON file and immediately calls `response.json()` without checking HTTP success. This provides a concrete explanation for the XML parsing error. Neither Home reload nor the Search/Summary checkpoints reproduced it. Tracking still reached READY_EMPTY in every checkpoint.

No Bannersnack code was modified, disabled or uninstalled. Recommended follow-up: inventory its visible site usage, then repair its configuration with the vendor or remove it only if confirmed unused and approved. The fresh-context evidence supersedes the earlier report's limited nonrecurrence observation. There is still no browser source stack; attribution of the error rests on the paired network evidence and the retrieved loader's explicit parse path.

## Google Ads read-only findings

API lookup confirmed conversion action **7690532327 / Booking - API Import** is ENABLED, UPLOAD_CLICKS, PURCHASE, primary for its goal, included in conversions, and uses a 90-day click-through window.

Its offline-upload summary returned client UNKNOWN, status EXCELLENT, one total event, one successful event, zero pending events and no alerts. The last-upload timestamp is **2026-10-08 16:30:55.941423**—before this release. This is historical upload-status evidence, not a new-code test or proof of attribution.

After reloading the authenticated Ads page and waiting for data, its selected reporting interval was October 10–16. It displayed **Misconfigured**, **No attempted imports with user-provided data**, and a last recorded conversion of July 20. The earlier cached page had shown the two older missing/mismatched-user-data warnings; their absence from the refreshed display is **not evidence that the fixes resolved them**. The historical upload summary and current UI have different scopes and must not be conflated.

No Google Ads configuration was edited. See `continued-validation-diagnostics.json` for the captured fields and fresh UI text.

## Safe provider validation: supported by Google, not exposed by this booking path

Google documents `validateOnly: true` for Data Manager events ingestion: the request is validated but not executed, and only errors—not ingestion results—are returned. It catches fast-fail validation errors but does not prove successful later processing or customer matching.

Sources:
- https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest
- https://developers.google.com/data-manager/api/devguides/concepts/best-practices

The loaded editor copies of `googleAdsConversions.web.js`, `googleAdsAttemptJournal.js` and `dataManagerClient.web.js` matched the repository. The existing booking entry point constructs a real purchase payload and does not pass through a caller's validateOnly option. The client also treats a successful response without a requestId as MISSING_REQUEST_ID. Therefore, simply injecting validateOnly into the existing production attempt path would not be a sound validation implementation and could consume or confuse real attempt history.

No provider validation-only request was executed. A dedicated, non-persisting validator would need its own response handling and tested separation from reservation creation and the production one-attempt journal. It should not require collecting real guest details for synthetic schema tests. No such endpoint was installed or published in this pass.

## Remaining boundary for Tom's return

The safe regression, runtime and diagnostic checks above are complete. Genuine paid-click/contact matching remains unproven. That requires an identified legitimate reservation or a specifically agreed isolated validation setup; no historical guest booking was chosen or replayed, and no artificial purchase was submitted to the primary conversion action.

No further tests are represented as running after this report. Remaining decisions and any future website publication are held for Tom's return. The separate BookingSummary access/security redesign remains deferred.

## Evidence

- `continued-validation-browser-results.json` — six sanitized browser captures, read back and aggregated in code.
- `continued-validation-diagnostics.json` — live Ads findings, validation documentation and capture summaries.
- `continued-validation-offline-results.json` — 87-script result map.
