# Bounded Data Manager HTTP error diagnostics

Candidate based on `132f45325788d6e7463b094a3d6e288946e581e0`. Requires independent review and GitHub delivery before owner installation. This change does not diagnose the historical HTTP 400 itself: that response body was not retained, and WC-1030/WC-1031 must not be replayed to recover it.

## Retained evidence

For a non-success HTTP response, the existing private RESULT `reasonCode` Text field can contain:

```text
HTTP_ERROR|{"reasons":["INVALID_ARGUMENT","INVALID_SHA256_FORMAT"],"fields":["events[].userData.userIdentifiers[].emailAddress"]}
```

No CMS fields, types or permissions change. `statusCode` remains the HTTP status; `outcome` remains UNKNOWN; `requestId` stays empty. The guest RPC still returns only `HTTP_ERROR`, not the diagnostic suffix. No success flag, retry grant, cancellation, historical update or new provider request is introduced.

Only finite allowlisted reason enums and schema field names survive. Sources are top-level `error.status`, `google.rpc.ErrorInfo.reason`, and `google.rpc.BadRequest.fieldViolations` structured `reason`/`field` entries. Snake-case field names map to known camelCase names; array indices become `[]`. Reasons and fields are independently summarized, not paired causes. Unknown reasons, unknown path segments, unsupported detail types, messages, descriptions, metadata, domains, contacts, contact hashes, tokens and raw bodies are discarded. A response that supplies only freeform text cannot yield a specific safe cause; its row remains plain `HTTP_ERROR`.

The parser admits at most 16 KiB of UTF-8 text, visits at most 16 details and 16 violations per supported detail, then projects the first 16 candidates per list into at most 3 unique reasons and 3 unique paths. Paths are limited to 8 segments and 128 output characters. The diagnostic reasonCode is below 768 ASCII bytes; the existing 2 KiB application-row limit remains enforced. Oversized or malformed HTTP bodies yield no diagnostic suffix. This bounds parsing and retention, **not** the memory or duration of Wix `res.text()` buffering; the transport already buffers that response. No streaming or hosted timeout guarantee is claimed.

The private journal revalidates the structured diagnostic projection at its boundary. Its AUTH admission, native unique ATTEMPT/readback gate, permanent uncertainty tombstones, default-OFF settings, legacy upload/retraction flags and frontend 2000-ms redirect are unchanged. HTTP diagnostics do not establish processing rejection, successful ingestion or attribution.

## Owner installation after review

Copy both files from the same reviewed GitHub revision:

- `velo/backend/dataManagerClient.web.js`
- `velo/backend/googleAdsAttemptJournal.js` (private `.js`, not a web module)

The journal now imports the sanitizer from the client, so do not install it against an older client. No other runtime file is needed for this delta on the existing journal installation. Keep all live settings unchanged; no Wix access, deployment, activation, booking, replay, cancel, token retrieval or provider send is authorized by this candidate. New evidence may be observed only during a separately authorized future attempt. Existing rows are immutable and are not enriched retroactively.

## Offline verification

```bash
node --test tests/google-ads-http-diagnostics.cjs tests/google-ads-upload-reliability.cjs
node tests/attribution-hotfix.cjs
node --check velo/backend/dataManagerClient.web.js
node --check velo/backend/googleAdsAttemptJournal.js
git diff --check
```

The diagnostics test imports the existing private-journal suite and its inert SDK fixture, preserving its admission, no-replay, flag, reconstruction and Summary coverage. OAuth and HTTP boundaries are inert. The new tests exercise actual client, journal, sender, insert/readback and duplicate denial; none execute a live SDK or provider. The baseline tracer failed because RESULT retained only `HTTP_ERROR`; the candidate passes. Separate in-memory source mutations remove body size checks, reason allowlisting, field allowlisting or malformed-JSON containment and each cause a corresponding assertion failure. These are negative controls, not historical baseline failures.

References: [Data Manager ErrorReason](https://developers.google.com/data-manager/api/reference/rest/v1/ErrorReason), [ErrorInfo](https://developers.google.com/data-manager/api/reference/rest/v1/ErrorInfo). The allowlist is intentionally finite: new provider enums require review rather than automatic raw retention.
