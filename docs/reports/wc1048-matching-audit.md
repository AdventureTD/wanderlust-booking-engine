# WC-1048 matching audit — processing succeeded, attribution unresolved

## Newly verified evidence

* Exact Google status at 2026-10-22T00:18:16.050Z: SUCCESS, one record, HTTP200, correct account/action, complete projection, no processing errors/warnings.
* Live read-only Ads API: enhanced conversions for leads enabled; customer-data terms accepted; auto-tagging enabled; conversion customer is 9426928570; conversion tracking ID 788746633 matches browser AW-788746633; cross-account conversion tracking ID is zero.
* Retained WC-1048 browser capture reports READY_EMPTY. Current BookingSummary record (booking reference reverified) has no gclid, gbraid, wbraid, firstPaidTouch or latestPaidTouch. This does not exclude an unknown signed-in prior ad interaction; ad-attribution eligibility is unproven.
* A private read of WC-1048's CURRENT stored email showed it is neither Gmail nor Googlemail and has no plus alias. No contact value or hash was saved. In an isolated browser with measurement blocked, the configured selector generated valid hashes matching the actual repository backend hashing function for this email. Editor hash source matches repository except line endings/final newline. This is a current-data reproduction, NOT proof of the historical uploaded identifier or browser bytes.
* The ordinary synthetic control also passed. Actual browser email-hash validity and exact equality from the original WC-1048 session remain unknowable from the retained parameter-presence-only capture. The original page has since navigated to Home.

## Reproduced normalization mismatches — not WC-1048's demonstrated cause

Gmail plus-alias control: the loaded Google browser tag removed dots but retained the plus suffix. Backend hashEmail removes both dots and the plus suffix. Valid hashes differed.

Googlemail control without plus suffix: browser retained googlemail.com, while backend rewrote the domain to gmail.com. Valid hashes differed. Data Manager's current formatting documentation prescribes dot/plus removal but does not prescribe that domain rewrite.

These results establish browser/backend hash mismatches for those inputs. They do not establish Google's internal matching outcome, explain WC-1048's ordinary-domain test, or justify silently changing all normalization. The explicit-user-data condition followed selector-only in the same context, so it is not a clean independent A/B test; selector-only is the primary observation.

## Consent evidence gap

Installed googleAdsConversions.web.js builds neither request-level nor event-level consent. Installed journal/client source matches repository; client serializes the payload without adding consent. Data Manager permits consent on requests or events, and Google recommends supplying it. Optional schema acceptance is not proof of attribution eligibility. Historical browser gcs/gcd/ad_user_data state was not retained. No inference of consent denial is warranted, and blanket CONSENT_GRANTED must not be added as a workaround.

## Current Google UI

Fresh action diagnostics on October 21 still show Misconfigured, missing user-provided data, no matches to web events, last ping October 21, and last recorded conversion July 20. These are action-level diagnostics, not WC-1048-specific rejection reasons.

## Decision

Do not resend the conversion or request another booking. Main account configuration and ordinary-email hash construction are not reproduced failures. The next external diagnostic is a Google support correlation of the successful request with the persistent user-data warnings and any eligible ad-interaction match. A draft is saved alongside this report, not submitted.

Separate remedial scope: normalize Googlemail according to the current Data Manager contract and verify parity; investigate the browser-versus-documented Gmail-plus discrepancy before choosing normalization; trace event-time consent into server ingestion without inventing consent. These require tests and separate approval for any live installation/publication; none has been changed in this audit.

## Safety and limitations

All controlled measurement requests were blocked. The direct Summary page's normally hidden email field was made visible ONLY in the isolated context, not production. Current stored data and current code cannot reconstruct original bytes. No Ads setting, CMS record, live code, collection permission or booking was changed. The earlier temporary status reader was restored/save/reload-verified. Broader BookingSummary access redesign remains deferred.

## Sources

- https://developers.google.com/data-manager/api/devguides/concepts/formatting
- https://developers.google.com/data-manager/api/reference/rest/v1/Consent
- https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest
- https://support.google.com/google-ads/answer/11021502
- https://support.google.com/google-ads/answer/15097349?hl=en

See wc1048-matching-audit.json for sanitized test comparisons. These tests confirm observations, not a fixed production attribution pipeline.
