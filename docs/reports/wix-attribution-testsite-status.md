# Wix test-site deployment and pre-confirmation check

> Historical blocker report. The subsequently approved routing correction and successful candidate Summary checks are documented in [routing-fix-status.md](routing-fix-status.md). Live publication remains blocked.

## Status: test deployment verified; candidate Summary test BLOCKED

Wix Release Manager shows **Test Site 27114 at 0% exposure**, while **Live Site 27108 remains at 100%**. A fresh isolated browser loaded test revision 27114. An unauthenticated static fetch independently confirmed default live revision 27108 after testing. Release Manager also displayed “Version not found” labels; those labels are retained as an observation, not silently translated into build success/failure. The served test revision and its running Search are the deployment evidence. An earlier tab initially loaded revision 27113 before the new test revision became available; it is not used as the candidate acceptance run.

Test entry: `https://www.wanderlustcaribbean.com/?rc=test-site`

No live Publish or dashboard Head Apply was performed. The release test's normal-visitor exposure remains zero; possession of the test URL can still provide access. This is a Wix release candidate on the existing site, not a separately cloned database or a fully isolated business system.

## What worked on revision 27114

Using a fresh context with request interception installed before navigation:

- Home and Booking Search executed; the new `getPublicTrackingFlags` endpoint was requested.
- Selected February 14–21, 2027 through the calendar controls.
- Search returned three accommodation types and two seven-night packages.
- The Explorer package displayed $2,721.95 per guest.
- Selecting one Adventure Suite for two guests displayed $5,443.90 package charges and enabled Continue with Booking.
- The normal `createPricingQuote` path was exercised. No contact information was entered.
- No uncaught page error was captured. This is not proof that every unexercised backend export builds or runs.

## Blocking finding: reserved URL parameter collision

Wix selects its test version using `rc=test-site`. Search currently constructs the Summary URL with `?rc=<selected rooms>`, and Summary reads `getParam('rc')` to reconstruct the selection.

The real Continue-with-Booking navigation replaced Wix's test selector with the room list. The browser then loaded **Summary revision 27108**, not test revision 27114. The live Summary successfully read the signed quote and displayed the selected room and a total of $6,396.59, but **this is excluded from the draft's Summary acceptance result**. No Confirm Booking action followed.

This is an observed test-environment routing problem. It does not establish that customers' current live booking flow is broken. It prevents this test from proving that the new Summary code works with a valid quote.

Official Wix documentation describes test URLs and Release Manager exposure but did not establish an alternative supported routing selector that avoids this collision:
- https://support.wix.com/en/article/test-sites-viewing-your-test-site-url
- https://support.wix.com/en/article/about-test-sites

No candidate code, production route contract, traffic exposure or live Head was changed to work around the test. The frozen attribution scope was not silently widened.

## Safety and limits

The clean test context blocked measurement requests and guarded named booking/invoice/conversion mutations. Captured RPC paths included flags, room names, messages, availability, packages, quote creation and quote reading. None invoked createBooking, recordBookingConversion, createDraftInvoice, updateBookingSummary or sendInvoice. Confirm Booking was not clicked. Browser-side guards are supplementary, not guarantees against arbitrary server-side effects.

The matching Head is still unapplied; the observed attribution open handshake timed out. This run does not validate consent delivery, user-data matching, first/latest persistence into a completed booking or Google diagnostics. No new tests of the deferred security redesign were performed.

## Next required decision

Use a narrowly scoped, backward-compatible room-selection query key that does not collide with Wix's `rc` selector, preserving existing live links and keeping `rc=test-site` during test navigation. Review and test that routing change before replacing the frozen candidate and redeploying the test site. Then repeat valid single-/multi-room Summary checks without confirmation. Do not publish merely to bypass the testing limitation.

Evidence: [wix-attribution-testsite-results.json](wix-attribution-testsite-results.json).
