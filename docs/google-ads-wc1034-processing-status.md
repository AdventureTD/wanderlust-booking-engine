# WC-1034 private processing-status candidate

Prepared for independently reviewed Git delivery. Git delivery is not Wix installation or hosted execution. No Wix installation, hosted run, live OAuth or authenticated Google request was performed by this diagnostic workstream. **Hosted: NOTRUN.**

## Narrow runtime change

`velo/backend/googleAdsProcessingDiagnostic.js` adds `readWC1034ProcessingStatus()` at line **23** with fixed request `82e091ac-6686-4a7d-ab9e-5a2aada23c32`. Existing WC-1035/WC-1036 exports remain unchanged. This addition uses the existing awaited auth, single encoded GET to `https://datamanager.googleapis.com/v1/requestStatus:retrieve`, account `9426928570` / action `7690532327` projection, privacy allowlists and bounds. Arguments, even explicit undefined, fail before auth. No generic input, public endpoint, POST to the status provider, journal/CMS write, event upload or adjustment is added. The existing auth helper may perform its normal OAuth token exchange only when the owner later runs the diagnostic; no credentials or scopes change.

The shared 15-second deadline bounds waiting, not cancellation of in-flight IO. Late auth cannot start the GET. The 64-KiB UTF-8 limit applies before JSON parsing after buffered text retrieval; it is not a streaming limit. Existing 10-destination, 64-error/64-warning-per-destination and 16-KiB output bounds remain. `projectionComplete` describes structural evidence, not successful attribution. `recordCount` is total processed records, not an attributed/success count. FAILED with known errors can be structurally complete. PROCESSING, unknown statuses/reasons, missing evidence and destination mismatch remain incomplete.

## Owner handoff after independent review and Git delivery

1. Use the exact independently reviewed GitHub commit/file supplied by the parent agent (not an unpushed candidate link). Copy the **whole** runtime file into Wix Backend `googleAdsProcessingDiagnostic.js`, retaining private `.js`, then **Save**. No other file, secret, scope or collection changes.
2. **No Publish required** for this saved-draft private diagnostic. Use the gutter tester beside line 23, `export async function readWC1034ProcessingStatus() {`. Verify that exact name in its test tab, clear old output, leave parameters empty, and Run once within that named function tester. Do not use generic site Run/Preview. Stop if the named tester is unavailable; do not add a wrapper.
3. Return only its sanitized output. Do not run the preserved WC-1035/WC-1036 exports. The latter remains outside the six-test cleanup scope. Do not upload, replay, retract, cancel or delete anything.

Private export means backend/editor callable, not a new owner-identity gate. Saved-draft testing can make real external reads; local fixture results are not hosted evidence.

## Offline verification

Run from the repository root:

```sh
node --check velo/backend/googleAdsProcessingDiagnostic.js
node --experimental-vm-modules --test tests/google-ads-processing-wc1034.test.cjs tests/google-ads-processing-diagnostic.test.cjs tests/google-ads-processing-bounds.test.cjs tests/google-ads-processing-native.test.cjs
```

Tests load actual runtime as native ESM with inert auth/fetch boundaries. The new entry tracer failed on the absent export before implementation. Additional safety cases exercise existing shared behavior through the new export. The inherited two-export namespace assertion is extended only by the new exact export; all old per-export assertions remain. New timeout coverage invokes the captured actual timer callback; it does not claim elapsed hosted timing. No live token or provider call is used.

## Read-only adjustment eligibility evidence (not an upload plan)

The preserved cleanup ledger contains exactly WC-1030 through WC-1035, all **HOLD**. WC-1036 is excluded. Historical wire transaction IDs, timestamps, values/currencies and exact attributed counts/values are UNKNOWN; source-derived booking IDs are intended bindings, not proof of original transmitted bytes. An ingestion acknowledgment and even downstream SUCCESS do not establish attribution or adjustment eligibility. This reader cannot recover the original wire ID or certify a retractable conversion.

### Supported route and identity requirements

- Google's [adjustment guide](https://developers.google.com/google-ads/api/docs/conversions/upload-adjustments) documents `ConversionAdjustmentUploadService.uploadConversionAdjustments` for already recorded conversions. Only the conversion-managing account may upload adjustments. The action must be enabled and have a supported type: `SALESFORCE`, `UPLOAD_CLICKS`, or `WEBPAGE` (guide spelling). Do not infer that enum solely from UI label “Import from clicks.”
- A potential future RETRACTION must reference the **same original order_id and conversion action**; original order ID is required if one was assigned, and for WEBPAGE. Use a zoned adjustment timestamp after the original conversion, `partial_failure=true`, and no restatement value for a retraction. No executable adjustment payload is provided here. Adjustment guide notes GCLID/GBRAID support, not WBRAID; original matching route remains an eligibility check.
- Official [migration mapping](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/upgrade/field-mappings) maps Ads `order_id` to Data Manager `transaction_id` and maps the destination to the conversion customer/action. This establishes field correspondence, **not blanket proof that every Data Manager original in this account can be adjusted**. The inspected public documents do not conclusively certify this exact account/original cross-ingestion case. Obtain explicit provider confirmation if action/original evidence does not resolve it. Do not apply an initial-upload migration restriction to the adjustment service by assumption.
- [Data Manager REST reference](https://developers.google.com/data-manager/api/reference/rest) distinguishes event ingestion, audience removal and processing-status reads; it supplies no basis for treating audience removal or invented `purchase_retraction`/`purchase_adjustment` events as conversion adjustments.

### API access: important fresh documentation change

The live [developer-token policy page](https://developers.google.com/google-ads/api/docs/api-policy/developer-token), updated September 11, 2026, says developer tokens were sunset September 9: access levels now attach to the Google Cloud project, and requests can omit developer tokens with compatible client libraries. It says not to apply in the old manager API Center. This conflicts with still-current-looking [OAuth overview](https://developers.google.com/google-ads/api/docs/oauth/overview) and migration mapping text that says a developer token is required. Prefer the specific dated policy; **do not request a new token or assert that token possession establishes access**. Confirm the existing Cloud project's production access level on its Google Ads API Overview page and compatible API/client route. Older-client token configuration may exist; only its presence/compatibility is relevant, never its value.

Google Ads API access still requires authorized `https://www.googleapis.com/auth/adwords` credentials, the enabled API and authorized user/service-account access to the conversion-owning customer (plus correct manager login context when applicable). Data Manager's `https://www.googleapis.com/auth/datamanager` scope and a browser login are not substitutes. [Data Manager access documentation](https://developers.google.com/data-manager/api/devguides/quickstart/set-up-access) separately lists the Ads scope when using both APIs. No credential inspection, minting, scope modification or authenticated API probe is authorized here.

### UI/CSV route and finite windows

[Google Help](https://support.google.com/google-ads/answer/7686280?hl=en) documents Goals → Conversions → Uploads → plus → View templates → “Conversions adjustments”, or preparing data in Data Manager. The template uses original Order ID, exact Conversion Name, Adjustment Time and Adjustment Type `RETRACT`; retain template columns, no contacts or additional columns, no adjusted value for retraction. This is a documented path, **not a claim that this account currently exposes it**. The prior account inspection only exposed “Go to Data Manager”; no adjustment template/import surface was established. A generic Remove CSV is not equivalent.

The same Help page says overall adjustments within **54 days**, with **7-day autobidding readability**. [About adjustments](https://support.google.com/google-ads/answer/7686447?hl=en) separately says **55 days for Hotel Ads**. A hotel business is not automatically Hotel Ads. [Initial import guidelines](https://support.google.com/google-ads/answer/15081888?hl=en) say enhanced-conversions-for-leads originals uploaded more than **63 days after the last click** are not imported; this is not a retraction window. [Adjustment errors](https://developers.google.com/google-ads/api/reference/rpc/v22/ConversionAdjustmentUploadErrorEnum.ConversionAdjustmentUploadError) describe CONVERSION_EXPIRED beyond 54 days and TOO_RECENT_CONVERSION before at least 24 hours. Unknown original timestamps prevent an exact deadline calculation.

### Minimum account questions / read-only check procedure

1. Who owns action `7690532327` for customer `9426928570`—this customer or a manager? Read action details without changing anything; capture exact name, enabled state, source/type and conversion-tracking owner. UI labels may not expose the exact API enum; mark unresolved rather than guessing. An already authorized separately approved read-only Ads API query can inspect the action metadata if needed, but is NOTRUN here.
2. Does that conversion-owning account expose the documented **Conversions adjustments** template/import surface? Owner or parent UI worker may inspect/download the blank official template only; stop before upload, preview/apply, setup or source creation. If absent, record absence on the inspected surface, not an invented alternate UI or transaction report.
3. If no usable UI route exists, does the owner already have a production-approved Google Cloud Ads API project and an authorized adwords principal for this account/action? Confirm only nonsecret metadata/access level and manager context. Do not request credentials/token values or broaden scopes. No existing access means BLOCKED pending separate authorization, not a reason to alter the current Data Manager helper.
4. Can Google provide exact original order-ID/action/recording evidence and confirm that these Data Manager originals are supported within the adjustment window? Preserve exact supplied identifiers, original timestamp provenance and any provider statement. If no per-transaction retrieval/report is available, say so. Aggregates, invoices, source-derived IDs and recordCount do not establish that evidence.

The separate read-only account access check (`google-ads-adjustment-access-check.md`, observed September 18, 2026) found **no usable existing CSV RETRACT route on the inspected surfaces**: Uploads showed only Go to Data Manager, API Manage exposed usage/logs, and File upload opened a new-connection wizard, not an established adjustment route. Account-wide availability remains UNKNOWN, not unsupported. Do not repeat a new-connection setup or deliver a RETRACT file on that basis.

Original conversion time is not a required adjustment payload field when matching by order ID; it is required for the alternative GCLID/time pair. Original timing still establishes eligibility and adjustment ordering (after original conversion, before upload). Do not substitute ATTEMPT/RESULT or booking creation time for an unretained eventTimestamp.

Current statuses: documented generic adjustment routes **SUPPORTED**; existing CSV route on inspected account surfaces **NO**; alternative account-wide route **UNKNOWN**; current Ads API access **UNVERIFIED**; exact originals and cross-ingestion eligibility **UNVERIFIED**; all six retractions **HOLD / NOT AUTHORIZED**. No mutation, validate-only upload, cleanup ledger change, attribution repair or new conversion is performed or implied. No retractable-original eligibility or upload-ready RETRACT file is delivered.
