# Draft for Google Ads support — NOT SUBMITTED

Account: 9426928570. Conversion action: Booking - API Import (7690532327). Browser tag: AW-788746633.

Please investigate enhanced-conversion matching diagnostics, not an ingestion rejection.

Request 1ea5a58b-2dd5-451f-8051-38928c74d72f, transaction WC-1048, event time 2026-10-20T03:45:10.553Z, 5898.15 USD. Native status on 2026-10-22T00:18:16.050Z was SUCCESS, one record, correct destination, no errors or warnings. The action UI still reports missing user-provided data and no matches to web events, last ping October 21.

A passive event-time capture observed prepare/complete phases, populated visible email field, and email-bearing /pagead/form-data/788746633 and /ccm/form-data/788746633 requests. We did not retain contact values/hashes, response bodies or browser consent flags. Current stored-email intercepted controls produce valid browser hashes matching backend hashing; this is not historical-byte proof. Account terms, enhanced-conversions enablement, auto-tagging and conversion-account/tag identity are verified.

The owner test had no retained paid-click ID. We do not assume it deserves ad credit. Current importer omits optional explicit consent; we do not equate omitted consent with denied consent.

Please clarify:
1. Did this exact event's user data match an eligible website event, and if not, is there a diagnostic distinguishing missing browser event, consent restrictions and identity mismatch?
2. Did it lack an eligible prior ad interaction? What request-specific evidence is available to establish that separately from website matching?
3. What conditions and diagnostic refresh window explain the persistent missing-data/no-match warnings despite these browser requests and successful ingestion?
4. In isolated blocked tests the current browser tag retains Gmail plus suffixes but Data Manager formatting documentation requires removing them. What is the supported way to keep browser and import identities aligned? Browser retains googlemail.com; our backend currently rewrites it to gmail.com, a separately identified mismatch not applicable to WC-1048's email.

Comparison request WC-1046: 63652579-8bde-4f64-8620-0f7c68dd8f22, also SUCCESS/one record/no processing errors or warnings. No conversion resends were performed.

No guest identifiers are included in this draft. Any further identifier sharing requires a secure approved support route.
