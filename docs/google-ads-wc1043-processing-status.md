# WC-1043 fixed processing status diagnostic

Candidate based on `82187d3bdbd6baffba78766b6a82bd258f101098`. Independent review and GitHub delivery are required before installation. The owner has explicitly authorized the narrow Editor update and publication; this file is not evidence that either happened.

## Installation and execution

After approval, install the complete reviewed `velo/backend/dataManagerClient.web.js` and then `velo/backend/googleAdsProcessingDiagnostic.js` using full-file backup, explicit save, reload and complete source comparison. Do not replace unrelated drafts. Check hosted diagnostics and publish only the authorized change after reconciling any unrelated draft conflict.

In private Backend **googleAdsProcessingDiagnostic.js**, use the function-specific tester for **readWC1043ProcessingStatus()**, with empty parameters. Do not run the WC-1038 CMS diagnostic, Preview, an ingestion function or a cancellation function. The entry is a private `.js` export, not a new web method, public endpoint or Permissions.Admin wrapper. Editor/backend-code access is its execution boundary.

One invocation uses the existing server-side OAuth helper (cached token or one token exchange) and at most one bodyless GET:

`https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=071b3837-db3c-4d58-be16-1a2092d9f4cf`

Account **9426928570**, action **7690532327**. The original literal receipt was read from WC-1043's retained RESULT, not derived from a booking number. Any supplied argument, including undefined, denies before OAuth. No caller-selected URL, request, account or action exists.

## Transport and identity

The previous status GET and existing OAuth helper did not request redirect denial. This candidate adds an opt-in boolean to the existing OAuth helper, used only by the new fixed diagnostic path, and `redirect: 'error'` to that path's GET. Existing sender/default transport remains unchanged. No new auth export or scope is added. The helper's imported sanitizer has no IO; initializers only define constants/functions and in-memory token cache. OAuth exchanges and token-cache refresh are credential lifecycle effects, not conversion mutations. No datastore, journal, data hook, provider ingestion or adjustment is invoked.

The existing whole-call 15-second deadline bounds waiting across OAuth, fetch and body; late auth cannot start the status GET. It does not cancel an in-flight OAuth/fetch or prevent the existing OAuth helper from completing after timeout. Hosted redirect-option enforcement remains unverified locally. Buffered response text is capped before JSON parsing at 64 KiB; this is not a streaming network-memory limit. Projected output is capped at 16 KiB.

Google's documented response has **no requestId echo**. Binding therefore comes from the hardcoded HTTPS GET plus exact response destination. A contradictory optional requestId fails REQUEST_ID_MISMATCH; anything other than one matching account/action destination fails DESTINATION_MISMATCH without returning foreign identities. The emitted requestId is the fixed query identity, not a claimed provider echo.

## Safe result

Retain only the already-projected result: fixed requestId, observation time, HTTP status, failure/completeness markers, matching account/action, finite request status, decimal-string record count and allowlisted processing error/warning reason/count pairs. Arbitrary messages, field text, contacts, contact hashes, authorization values and raw bodies are deliberately discarded. The current request-status API represents processing reasons/counts, not arbitrary field messages. Unknown reasons remain UNKNOWN and incomplete, never synthesized.

HTTP 200 ingestion acknowledgment is not this processing result. A returned SUCCESS is not evidence of an attributed/countable advertising conversion. Preserve FAILED, PARTIAL_SUCCESS, PROCESSING and incomplete evidence as returned. Do not retry an upload or alter production records to diagnose a failure.

## Sources

- https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve
- https://datamanager.googleapis.com/$discovery/rest?version=v1

Fresh discovery verified GET `v1/requestStatus:retrieve`, query `requestId`, Data Manager scope and response `requestStatusPerDestination`. No provider status request was made during local preparation.

## Local verification

`node --experimental-vm-modules --test tests/google-ads-processing-*.test.cjs tests/google-ads-attribution-wc1038.test.cjs`

Native ESM tests use inert Wix/crypto boundaries, including the actual transitive OAuth and sanitizer modules. Entry absence, missing redirect denial and contradictory-identity acceptance were retained as separate RED cases before changes. Additional inherited-behavior controls are baseline-GREEN, not new behavioral RED. Hosted import/authentication, installed source parity, publication and the real WC-1043 processing result remain NOTRUN until the approved deployment/execution.
