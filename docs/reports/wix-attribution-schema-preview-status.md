# Attribution schema and read-only Wix Preview checks

## Result

The approved schema additions and read-only Preview checks were performed. This is **not a live-release or end-to-end attribution pass**. Publication and Head activation remain blocked.

## CMS changes verified

| Collection | Field ID | Display name | Type |
|---|---|---|---|
| BookingSummary | firstPaidTouch | First Paid Touch | Object |
| BookingSummary | latestPaidTouch | Latest Paid Touch | Object |

Both fields were saved, their settings reopened to read back the type and exact ID, and their presence independently verified after a full editor reload. No existing guest row was edited or backfilled; collection permissions were not changed. CMS management was opened to access Manage Fields, but guest rows were not extracted.

These are reporting metadata additions, not the deferred Booking Summary access/security redesign.

## Read-only hosted observations

- **Home:** Wix Preview executed masterPage and the new public flag request returned `enabled`.
- **Booking Search:** Preview executed the page and masterPage. Both reported tracking flags `enabled`. Date inputs were empty, the page displayed Check Availability, and initialization logs showed scrolling and the Summary-button handler registered. No search, guest-form submission or booking creation was performed. An initial BOOK NOW navigation check was sampled before navigation settled; it is not counted as a Search pass. A subsequent explicit Search Preview confirmed the page loaded.
- **Booking Summary:** Preview executed the page, read its reference data, and reached `The locked pricing quote is missing`. This is expected with no prepared quote; it is not a complete valid-booking rendering or checkout test. The first master flag resolution reported `hold`; a repeat reported `enabled`. No root cause for the initial hold was established. Neither Continue nor a conversion-import method was invoked.
- **Head handshake:** `ATTR_DIAG` reported `open / TIMEOUT` in Preview. The matching dashboard Head remains unapplied. Preview has explicit Wix functionality limitations. This observation does not establish a production failure or a successful protocol handshake.
- **Browser exceptions:** No uncaught page errors were captured by the Playwright pageerror listener during these checks. This is narrower than asserting that every backend operation or worker completed without error.
- **Precautions:** A temporary browser request guard blocked the configured Google/Bing analytics host list on the editor page and its frames. Actual blocked hosts were `pagead2.googlesyndication.com` and `ade.googlesyndication.com`. This is supplementary protection, not proof of server-side blocking. No booking/invoice/import action was invoked.

## Correction to the earlier idle-editor diagnostic check

Opening and running the actual pages populated diagnostics that were absent from the earlier idle-model snapshot. The later snapshot contained 95 empty-block lint diagnostics and one `wix-window-frontend` type-declaration diagnostic. The latter references a source line already in the editor backup; the runtime Search scroll call executed. A transient Summary snapshot also showed import/type, Date/localStorage, optional-element and Button-property diagnostics. These are not all demonstrated release blockers, but must not be hidden behind a claim of “no editor warnings.” No production source was changed merely to silence these diagnostics.

After the checks, all eight saved Velo model hashes still matched the previously installed/tested files. The editor was returned from Preview to Home.

## Remaining release gates

- Coordinate the matching Head activation with Wix publication; neither occurred here.
- Verify a successful hosted build and the coordinated protocol in the target release environment; Preview is not a replacement for that verification.
- Separately authorize a controlled booking/import test before creating a booking or sending a conversion. Valid single-/multi-room completion, first/latest persistence, actual user-data matching and the Google diagnostics remain unverified live.
- Keep collection-security remediation deferred and explicitly unresolved.

Machine-readable observations and model hashes: [wix-attribution-hosted-checks.json](wix-attribution-hosted-checks.json).
