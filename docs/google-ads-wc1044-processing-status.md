# WC-1044 processing diagnostic — owner installation candidate

Pending independent review and commit-pinned GitHub delivery. No agent Editor access, installation, production execution or publication is authorized. Tom will install and run the reviewed file himself. This document does not claim deployment or a provider result.

## Single installation file

Replace only private Backend `googleAdsProcessingDiagnostic.js` with the complete reviewed `velo/backend/googleAdsProcessingDiagnostic.js` after preserving its current full contents. Save and verify the saved file. This adds one function; all existing reader and helper bodies remain unchanged. The existing `dataManagerClient.web.js` strict transport helper is reused without modification; this candidate does not deliver a replacement dependency. Stop if the installed dependency differs from the previously installed WC-1043 version.

In that private file's function-specific tester select **readWC1044ProcessingStatus()**. Leave parameters completely empty: do not supply a booking number, request ID, object, null or undefined. Do not select Preview, the WC-1038 CMS reader, upload, cancellation or another reader. Publication is a separate owner decision, not an instruction or authorization here.

Fixed binding:
- Request: `dc64a54c-135e-4381-a515-0f0ed6aae0e7`
- Account: `9426928570`
- Conversion action: `7690532327`

An invocation uses the existing server-side token cache/refresh and at most one bodyless status GET. Strict redirect denial applies to OAuth and GET. No ingest, adjustment, booking/business handler, CMS or journal read/write is invoked by this entry. There is no automatic polling or retry.

## Output and limitations

Return the complete sanitized object, expanding destinations/errors/warnings. It contains only the fixed request ID, observation time, HTTP status, completeness/failure flags, matching account/action, finite processing status, record count and allowlisted error/warning reason/count pairs. Do not copy secrets, raw provider bodies, contacts or contact hashes.

The fixed outbound query binds identity; the documented response need not echo requestId. Contradictory echoes and anything other than one matching destination fail closed. Existing 15-second whole-call waiting deadline, 64-KiB preparse cap and 16-KiB projected output cap are unchanged. The deadline does not cancel underlying requests; response buffering is not streaming-memory bounded. Hosted execution and redirect-option enforcement remain unverified by these local tests.

Do not infer WC-1044's failure reason from Google aggregate diagnostics or a conversion action setting. The existing reason vocabulary already includes `PROCESSING_ERROR_REASON_ONE_PER_CLICK_CONVERSION_ACTION_NOT_PERMITTED_WITH_BRAID`; only the actual exact-request receipt can establish whether it applies here. Do not change settings or resend the event. Processing SUCCESS does not establish advertising attribution or counted revenue.

## Local test command

`node --experimental-vm-modules --test tests/google-ads-processing-*.test.cjs tests/google-ads-attribution-wc1038.test.cjs`

Wix edges are inert; no production credentials or status endpoints are used in tests. The new entry tracer was RED before implementation and GREEN afterward. Additional WC-1044 controls exercise unchanged strict-reader behavior, not newly corrected helper flaws. Independent review, GitHub delivery, installed parity and the actual provider result remain separate pending gates.

## Documentation provenance

Parent retrieved Google's official requestStatus.retrieve documentation using direct urllib HTTP 200 after web_extract failed; retained text is `C:/Users/TomDe/checkpoints/google-ads-misconfigured-resolution/urgent-request-status-reference.txt`. This must not be relabeled as a parent web.run fetch. The implementation worker inspected the retained reference locally. No authenticated provider request was made.
