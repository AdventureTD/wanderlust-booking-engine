# Full/no-fee cancellation — completion candidate for independent review

Local implementation only. No Editor, CMS, provider operation, deployment, commit or push was performed. Do not push `main` as an installation step: Render may auto-deploy. This guide supersedes the earlier gap list; historical evidence is preserved in `C:/Users/TomDe/checkpoints/wc-1038-cancellation/recovery/`.

## Implemented behavior

- Exact-booking paginated preflight, immutable cancellation decision, resumable child/Summary cancellation and verified readback. Full/no-fee current balance is zero. Original invoice amounts, payments, refunds, unrelated bookings and closures are untouched.
- Email: same-invocation exclusive native START insert/readback authorizes one application transport attempt. Native START is never reset. Missing configuration before START may be retried; uncertain START/send/receipt is reconciliation-only. Request and response carry the retained 32-hex `operation_id`; mismatched responses cannot produce ACK. Gmail uses `num_retries=0` plus a cancellation-only requests transport with `HTTPAdapter(max_retries=0)`, `trust_env=False`, explicit timeouts and redirects disabled. It does not use httplib2 connection replay or AuthorizedHttp response-triggered credential refresh. The normal invoice sender keeps its existing Gmail transport. Wix request sets `redirect:'error'`; there is no application retry loop. Deployed Wix transport behavior still needs installation verification.
- **The authenticated email HTTP endpoint is NOT idempotent.** Repeating a request with the service secret can still send twice. Operation ID is a receipt binding, not a service-side durable authorization check. The supported caller is the Wix exclusive-START path, not manual HTTP replay, reverse-proxy POST retry or another dispatcher. Do not add retry middleware. No ephemeral Render filesystem is used as deduplication authority. If arbitrary authenticated replay must be supported, a durable Wix service-consumption callback remains separate work; it is not claimed here.
- Calendar: exact linked-event cancellation remains repeatable reconciliation, never event creation or a name/date search. Wix now retains `CALENDAR/CANCELLED` ACK with `eventId`, verifies readback and reads it on reopen/reconstruction. A saved ACK avoids another provider call. Lost ACK may read the winner; unresolved marking may be reconciled against the exact event. Unbound legacy events remain `NEEDS_RECONCILIATION`.
- `coreComplete` requires verified reservation cancellation, email ACK and Calendar ACK. `complete` also requires acknowledged Google outcomes. Missing metadata and GA4 `RECEIVED_UNVERIFIED` cannot count as whole-cancellation completion. No current GA4 transport path supplies processing proof, so that distinction remains visible rather than inventing success.
- The existing admin button becomes **Resume / Reconcile Cancellation** for cancelled records. Reopen displays retained effects; explicit confirmation resumes safe unfinished work, never resets email/Ads/GA4 START. Close and stale-load rejection invalidate old detail results.
- Observed-state fences remain defense in depth, not CAS or locks. Ordinary admin booking edits now use documented `@wix/data` field patches for Bookings and BookingSummary, excluding status and settlement; the invoice date mirror also patches only its three date fields. An already-dispatched edit cannot restore its old confirmed status. The admin status dropdown is read-only, and direct generic status edits are rejected (use dedicated cancellation; reactivation is unsupported). Delayed child, Summary and actual invoice-date-mirror schedules pass. No general transaction guarantee is claimed for contact/date/financial edits or invoice dispatch already in flight. Legacy new-booking creation and direct CMS writers are outside this finite shared-edit correction.
- Ads: exact Settings `suspendGoogleAds=0` is required; missing/duplicate/unavailable settings deny dispatch. Private approval and suspension are refreshed before OAuth, after OAuth, and after START/readback. Post-START denial leaves START retained and requires reconciliation.
- GA4: original client/transaction/value and private approval are required. Approval, booking identity and consent expiry are reread after debug validation and after START/readback. A withdrawal after the final observable read cannot be made atomic with an external Google request. Receipt remains `RECEIVED_UNVERIFIED`; no fabricated client ID or purchase resend exists.

## Private CMS installation requirements (not installed)

All collections below: trusted backend/admin access only; no public/member read or write. Verify Wix supplied `_id` preservation, exclusive collection-local insert conflict and consistent readback before activation. Missing operation collection now also blocks fenced legacy invoice/edit paths, so provision the private schema before installing those callers.

| Collection | `_id` | Fields |
|---|---|---|
| `BookingCancellationOperations` | Summary `_id` | `bookingNumber`, `summaryId`, `reason`, `settlement` Text; `legacyCancelled` Boolean; `roomIds` Array of Text; `roomCount` Number; `membership` Array of Objects (`id`, `quantity`, `roomCode`) |
| `BookingCancellationEffects` | First 32 lowercase hex of SHA256 UTF-8 `cancellation-v1:` + Summary `_id` + `:` + suffix | `bookingNumber`, `effect`, `state`, `messageId`, `eventId` Text |
| `BookingCancellationAnalytics` | Summary `_id` | `bookingNumber` Text; `ads`, `ga4` Objects |

Suffixes: `email`, `email-ack`, `ads`, `ads-ack`, `ga4`, `ga4-ack`, `calendar-ack`. Calendar does not require an exclusive START because its exact-event marking operation is repeatable. States: `STARTED`, `ACKNOWLEDGED`, `RECEIVED_UNVERIFIED`, `CANCELLED`. Never delete START to retry. Never seed ACK to clear a warning.

`BookingSummary`: Text `cancellationSettlement`, `cancellationReason`. Preserve all original financial/attribution fields. Bookings quantities and Summary roomCount must be native positive integers with matching total; do not rewrite source data to bypass rejection.

Private optional analytics records must be supplied only after original transaction, duplicate history and provider eligibility review:
- `ads`: `approved:true`, `originalRecorded:true`, original exact `orderId`, `customerId`, `conversionActionId`. Approval includes checking supported action type, original recording, adjustment timing and account access. An approved boolean is not provider evidence by itself.
- `ga4`: `approved:true`, `duplicateCheckClear:true`, `consentEligible:true`, `withdrawn:false`, future ISO `consentValidUntil`, original `clientId`, original `transactionId`, positive numeric original `value`, uppercase three-letter `currency`, exact `measurementId`.

WC-1038 original Google metadata is **not established**. Leave approval records absent until reconciled. This does not block core no-fee reservation cancellation; it does prevent claiming all external corrections complete. No automatic never-uploaded inference or manual success override is implemented.

## Existing/new hosting configuration

Wix existing secrets: `WBE_INVOICE_SERVICE_URL` (HTTPS origin without trailing slash), `WBE_SHARED_SECRET`. The service preserves `/send-cancellation-email` with its original request/response contract for the old deployed caller. The new caller uses `/v2/send-cancellation-email`, which requires the bound `operation_id` and never falls back to v1. Both use the cancellation-specific no-replay Gmail transport. Neither endpoint offers arbitrary-request deduplication.

Render: matching `WBE_SHARED_SECRET`, existing Gmail configuration, `WBE_CALENDAR_WEB_APP_URL`, `WBE_CALENDAR_SECRET`. Gmail retries are explicitly disabled for cancellation only. Apps Script requires Script Property `WBE_CALENDAR_SECRET` and verified owner/default calendar identity. It retains `booking:<bookingNumber>` exact calendar/event identity or an unbound-cancelled tombstone. Missing property fails closed, including legacy creation. Review quotas, ACL, retention and legacy identity reconciliation before installation.

Ads stays default off unless `WBE_GOOGLE_ADS_ADJUSTMENTS_ENABLED` is exactly `true`, Settings is explicitly unsuspended, and private approved metadata exists. Secrets: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_CONVERSION_ACTION_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (empty for direct access), `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`. Actual account credentials/eligibility were not inspected or exercised.

GA4 secrets: `WBE_GA4_MEASUREMENT_ID`, `WBE_GA4_API_SECRET`. There is no global GA4 enable secret; keep private approved records absent until authorized. Debug validation is an external request when activated.

## Coordinated rollout (owner action only, after independent delta approval)

1. Deliver the reviewed feature branch only. Do not merge/push main or infer Render auto-deploy settings. No deployment was performed here.
2. Provision private collection schemas, including immutable original `membership` and `roomCount`. Old candidate operations lacking these fields fail closed; do not invent a migration or overwrite retained intent. Reconcile any such records explicitly before activation.
3. Verify `@wix/data` is available to the site backend and the documented `items.patch(collection,id).setField(...).run()` compiles and works under the intended identities/collection ACLs. This is a new SDK dependency/host prerequisite; do not substitute `wixData.update`, read/merge/write or a pretend CAS if unavailable. The invoice mirror historically bypassed collection auth; the SDK patch must be authorized under the actual caller identity before activation. No auth elevation is invented here.
4. Deploy the additive service v2 route first under separately authorized controlled deployment. The original v1 caller remains compatible (same response without operation_id). Confirm v2 schema/auth and no POST retry middleware; never smoke-test by sending a real guest email without explicit approval.
5. Configure/migrate the existing Apps Script secret property and reconcile exact calendar identity before publishing its handler. Then publish the reviewed Wix backend/page together, with cancellation caller exclusively on v2. The status dropdown is display-only; generic reactivation is intentionally denied.
6. Verify exact installed bytes and hosted patch/native unique insert/readback behavior in an authorized inert test. Inventory availability still reads physical cancelled rows; no synthetic CAS, background reconciler or immutable-intent override was added. Do not claim full-system atomicity or permit direct CMS/legacy creation to rewrite a cancelled reservation.

Official SDK authority (public docs read during this correction):
- https://dev.wix.com/docs/sdk/backend-modules/data/items/patch
- https://dev.wix.com/docs/sdk/backend-modules/data/items/wix-data-patch/set-field
- https://dev.wix.com/docs/sdk/backend-modules/data/items/wix-data-patch/run

`patch` changes only specified fields; `run` supports a condition but this candidate does **not** invent or rely on a cross-collection condition/lock. Documentation labels the API developer preview: verify actual site support and permissions before installation. The fixture models server application of the submitted field modifications after a held network mutation, not a client-side merge presented as atomic.

## Official Ads contract verification

The earlier suspicion that v25 was invented is incorrect: official release notes list **v25 released 2026-07-22**. Official v25 proto specifies `POST /v25/customers/{customer_id=*}:uploadConversionAdjustments`, `adwords` scope, `partial_failure`, adjustment fields and result fields matching the candidate. Official access documentation permits service accounts with direct or linked-manager access; this does not prove our account has that access.

- https://developers.google.com/google-ads/api/docs/release-notes
- https://developers.google.com/google-ads/api/reference/rpc/v25/ConversionAdjustmentUploadService
- https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v25/services/conversion_adjustment_upload_service.proto
- https://developers.google.com/google-ads/api/docs/oauth/service-accounts
- https://developers.google.com/google-ads/api/docs/oauth/access-model
- https://developers.google.com/google-ads/api/docs/conversions/upload-adjustments

Supported adjustment action types include SALESFORCE, UPLOAD_CLICKS and WEBPAGE; original order ID is required for WEBPAGE or conversions originally supplied with order ID. Unsupported/unknown WC-1038 history must not be force-retracted. No live validate-only or provider call was made. The guessed REST reference URL failed; the official proto supplied the actual HTTP mapping.

## Verification and finite remaining gates

```text
node --experimental-vm-modules --test tests/cancellation-all.cjs
python -m unittest discover -s tests -p test_complete_cancellation.py -v
git diff --check
```

The original 44 tests are retained. Final blocker-fix union and unique-ID ledger are in `C:/Users/TomDe/checkpoints/wc-1038-cancellation/blocker-fixes/`; see `blocker-fixes.md` for exact counts, original reviewer RED probes, final GREEN outputs and the hash inventory against all 20 incoming files. Original recovery/completion/independent evidence is unchanged. Run the additional `test_cancellation_blockers.py` suite as well as the commands above.

Evidence is actual-source VM/AST execution over inert SDK/provider boundaries, with real Gmail discovery/HttpRequest, requests preparation and isolated FastAPI route/model/TestClient execution. It is not full service startup, live Wix/Google end-to-end testing, OS-process concurrency, Search integration or a whole-project regression run. Final source needs different-author delta review. Activation requires private schema/native insert-readback and SDK patch verification, coordinated installation and exact Calendar identity/ACL verification. No proxy/middleware POST retry is permitted. There is no cross-writer transaction or arbitrary HTTP replay tolerance. No background resume host is added.
