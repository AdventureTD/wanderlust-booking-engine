# Private processing-status diagnostic

**Git delivery is not Wix installation or execution. Use the independently reviewed revision supplied with delivery; hosted Wix execution and both real request-status reads remain NOTRUN until the owner performs the named tests below.**

## Scope

Add only `velo/backend/googleAdsProcessingDiagnostic.js` to Wix Backend. This is a private `.js` file, not a web module or public endpoint. Existing `dataManagerClient.web.js` exports the awaited `getAccessToken()` and already uses the `https://www.googleapis.com/auth/datamanager` scope. Leave that helper, hashing, ingestion transport, booking flow and journal untouched. No new secret, collection, setting or publication is required for the named draft functional tests.

| Named function (zero arguments) | Existing booking receipt | Fixed request ID |
|---|---|---|
| `readWC1035ProcessingStatus()` | WC-1035, owner test | `956aa6b6-f5b1-409d-aed0-d48b120ac6a9` |
| `readWC1036ProcessingStatus()` | WC-1036, real booking; preserve | `0e453038-1a79-4b99-af2d-cd433bc8cf4f` |

Each invocation makes at most one status GET, without a body, to `https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=...`. These retained IDs already have ingestion acknowledgments. No discovery/booking lookup or derived authorization occurs. An invocation may also use the existing server-side OAuth token exchange. It never calls ingestion or adjustment, automatically retries/polls, writes CMS/journal, or logs response/errors.

## Owner installation after independent review and Git delivery

1. Use the reviewed GitHub revision supplied with delivery. Open `velo/backend/googleAdsProcessingDiagnostic.js`, choose **Raw**, and copy the entire file.
2. In Wix Editor, open **Backend**, create a **new private JavaScript (.js) file** named `googleAdsProcessingDiagnostic.js`, paste and **Save**. Do not create `.web.js`, `.jsw`, an HTTP function, or a public page caller. Do not replace existing files.
3. **Do not Publish for this diagnostic.** The supported function tester runs the saved backend draft. This is not proof of published backend parity, and no site-wide generic Run/Preview is needed.
4. Confirm the exact exported function name in the function-specific testing tab opened by the **gutter play icon beside `readWC1035ProcessingStatus`**. Leave Set Parameters empty (no arguments). Do not press a generic site Run button. If the named tester is unavailable or the function name is wrong, stop; do not add a public/Admin wrapper without separate review.
5. The bounded execution request is: **Run `readWC1035ProcessingStatus()` once for processing READ only.** This is a **real Google-account status GET**, not a fake fixture. It uses server credentials without displaying them. Retain only the returned sanitized object.
6. Then separately: **Run `readWC1036ProcessingStatus()` once for processing READ only**, following the same name/empty-parameter check. This reads the real retained request; it does not alter the real booking.
7. Return those two output objects, including `requestId`, `observedAtUtc`, `httpStatus`, `failureCode`, `projectionComplete`, and `destinations`. Do not retrieve tokens, secrets, provider bodies or contact data. Do not retry uploads or alter journal rows even if processing is `FAILED`.

## Interpretation and limits

- `FAILED`, `PARTIAL_SUCCESS`, `SUCCESS`, `PROCESSING`, and `REQUEST_STATUS_UNKNOWN` are provider status enums. They are not ingestion HTTP acceptance or attribution. `SUCCESS` can have warnings.
- `projectionComplete` means the bounded expected-destination projection is structurally usable, not that the conversion succeeded. `FAILED` with known details can be a complete diagnostic. Processing/unknown status, missing details, unknown reasons, malformed counts, or destination mismatch are incomplete.
- `recordCount` is total events, **including failures**, not a success count. Error/warning counts are nonnegative signed-int64-range decimal strings. Do not sum reasons as distinct failed events.
- Only account `9426928570` and action `7690532327` are emitted, and only for an exact expected operating-account/type/action match. Mismatched IDs are not echoed. Provider enum values outside finite **ProcessingErrorReason / ProcessingWarningReason** vocabularies become `UNKNOWN`; synchronous ingestion `ErrorReason` is not used.
- Unknown fields/messages/details/contact/hash values are never copied. Input is capped at 64 KiB UTF-8 before JSON parsing; at most 10 destinations and 64 error or warning pairs per destination; output is capped at 16 KiB. Oversize evidence is rejected explicitly, not silently truncated.
- One 15-second deadline covers auth, GET, and body awaiting. It bounds the returned wait and prevents a late auth result from starting a GET. The existing OAuth helper and `wix-fetch` are not cancellable through this wrapper; an already-running operation can finish after timeout. `wix-fetch.text()` buffers before the parse cap; this is not a streaming-memory bound.
- The private `.js` export is callable by site backend code and authorized Editor collaborators; it is not a frontend endpoint or an owner-identity authentication mechanism. Use only the owner's named tester in this workflow.

## Offline verification

```sh
node --check velo/backend/googleAdsProcessingDiagnostic.js
node --experimental-vm-modules --test tests/google-ads-processing-diagnostic.test.cjs tests/google-ads-processing-bounds.test.cjs tests/google-ads-processing-native.test.cjs
```

The harness executes unmodified source with native ESM linking. Boundary tests inject inert auth/fetch; a separate test links the actual existing `.web` auth helper and its actual private sanitizer, replacing only Wix fetch/secrets/crypto SDK boundaries with conspicuously inert values. No local test reads secrets or connects to OAuth/Google/Wix. The pinned discovery fixture is official public schema, not an actual processing result. Local fixture success does not verify hosted Wix execution or the bookings' actual reasons.

## Official support

- Google method, response shape, statuses, processing error/warning enums: https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve
- Public live discovery: https://datamanager.googleapis.com/$discovery/rest?version=v1
- Wix supports exported functions in private `.js` backend files and distinguishes real data effects from Preview labelling: https://dev.wix.com/docs/develop-websites-sdk/test-your-site/test-backend-functions/about-functional-testing.md
- Named gutter play, function tab, empty arguments and its own Run control: https://dev.wix.com/docs/develop-websites-sdk/test-your-site/test-backend-functions/test-backend-functions-with-functional-testing.md
