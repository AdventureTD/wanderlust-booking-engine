# WC-1037 private processing diagnostic — candidate

UNCOMMITTED; independent parent review required before Git delivery. Hosted execution and actual Google GET: NOTRUN. This is a read-only diagnostic, not an Ads conversion fix.

The only runtime addition is zero-argument `readWC1037ProcessingStatus()` in private `velo/backend/googleAdsProcessingDiagnostic.js`, fixed to the observed WC-1037 RESULT request `18818d9b-212a-43a6-9619-a29d1727644f`. WC-1038 has no verified request ID and no reader is added. Historical WC-1034/35/36 functions, destination 9426928570 / 7690532327, projection vocabulary, size limits, deadline and OAuth scope remain unchanged. Arguments including explicit undefined deny before OAuth. The normal OAuth token exchange may POST; the processing operation is exactly one GET with no body. No upload, replay, adjustment, booking/journal write or frontend change.

## Access boundary and invocation

The existing reader is NOT a Permissions.Admin web method or an owner-identity authenticated endpoint. It is a private backend `.js` export; the source has no incoming frontend/admin/HTTP caller. Backend code and authorized Wix code-editor testers can call it. Do not claim an inert VM test proves Wix platform administrator enforcement. No general-purpose reader or anonymous RPC is introduced, and no safe already-installed wrapper accepting WC-1037 was found.

After independent review, deliver the complete runtime file via an exact committed GitHub link. The owner may replace the existing private Backend `googleAdsProcessingDiagnostic.js` with those reviewed bytes and Save; preserve `.js`, not `.web.js` or `.jsw`. No Publish is required for documented saved-draft function testing. Do not alter other files or secrets.

Official documented execution is the function-specific backend code-editor tester: open this file, select the gutter play icon beside **readWC1037ProcessingStatus** (line 29 in this candidate), verify that exact function name in the testing tab, clear old output, leave parameter JSON empty, and Run that function once. Return only the sanitized object. Do not run upload/retry functions or historical diagnostic functions. Documentation: https://dev.wix.com/docs/develop-websites-sdk/test-your-site/test-backend-functions/test-backend-functions-with-functional-testing and https://dev.wix.com/docs/develop-websites-sdk/test-your-site/test-backend-functions/about-functional-testing . These steps describe the documented owner route, not an agent-performed or hosted-tested run.

**No-editor limitation:** no separate dashboard/backend runner was established. Installing this module alone does not execute it. If the owner also excludes the code-editor function tester, this candidate cannot currently produce the live result; stop and arrange an explicitly approved authenticated read-only caller separately. Do not invent a dashboard Run control, anonymous endpoint or booking UI change. The agent did not open Editor.

## Evidence interpretation

Actual GET endpoint: `https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=18818d9b-212a-43a6-9619-a29d1727644f`. Capture the actual returned sanitized requestId, observedAtUtc, httpStatus, projectionComplete, unknownReasonPresent, failureCode and per-destination projected status/count/errors/warnings. Do not echo contacts, hashes, bearer tokens or raw error bodies.

Ingestion acknowledgment is not processing success. Processing SUCCESS is not attribution. A complete FAILED projection is not a successful conversion. recordCount includes failed records and is not attributed count. Unknown/mismatched fields remain incomplete. Fifteen seconds bounds waiting, not cancellation; the JSON cap follows buffered text, not a streaming limit. No retry is authorized.

## Local verification

Actual native ESM with inert auth/fetch boundaries. New entry tracer RED: absent export; GREEN after six-line fixed-reader addition. Six WC-1037 tests cover exact GET, zero arguments, delayed/rejected auth, deadline fence, finite statuses/counts, mismatched destinations, unknown/private reasons, no sensitive echo and sanitized HTTP errors. Existing processing tests remain in the regression run; namespace expectation gains only the new named export. External network-deny preload records zero network attempts. No Wix Admin login simulation is claimed.

```sh
node --experimental-vm-modules --test tests/google-ads-processing-wc1037.test.cjs tests/google-ads-processing-wc1034.test.cjs tests/google-ads-processing-diagnostic.test.cjs tests/google-ads-processing-bounds.test.cjs tests/google-ads-processing-native.test.cjs
```
