# Legacy Summary: explicit Ads form notification (candidate)

**Independent review required; not installed or live-verified. Replacement engine remains HOLD.**

## What this does—and does not prove

After existing contact validation, Summary sends a contact-free `prepare` notification. Only after every room returns a successful result with the shared booking number does it send `complete`. The head sends exactly `gtag('event', 'form_submit', {send_to:'AW-788746633'})` if its separate affirmative-consent gate and current field checks pass. Failed/partial/uncertain bookings never send `complete`. Booking, invoice, existing GA4 purchase, backend Ads/journal/no-replay and the 2000ms home redirect are unchanged. Optional collection exceptions are contained.

There is **no `gtag('set','user_data',...)`**, no email/hash in the Velo/iframe notification, and no contact-bearing GA4/logged event parameters. The head reads the existing manual email field only after consent, retains an ephemeral in-memory value for equality checking, and never logs, persists or forwards that value itself. One pending state per frame is retained until replaced/consumed or page teardown; a pending notification is eligible for at most ten minutes. This is not a new customer-data store.

Google documents manual CSS selectors and separately documents custom-code `user_data` followed by AW-routed `form_submit`. This candidate deliberately uses the existing manual selector rather than global `user_data`, because global parameter scope is not isolated by `send_to`. **The documentation does not prove the selector will attach email to this event.** Offline tests prove the explicit event seam, not Google's remote collector. Collection effectiveness is a mandatory later verification gate; if it fails, stop rather than introduce a global setter or send identifiers through purchase.

References checked:
- https://support.google.com/google-ads/answer/11021502?hl=en
- https://support.google.com/tagmanager/answer/12131703?hl=en
- https://developers.google.com/tag-platform/gtagjs/routing
- https://developers.google.com/tag-platform/gtagjs/reference

## Exact coordinated runtime files

Copy only these reviewed files from the eventual approved Git revision:

1. `velo/page-booking-summary.js` → existing **legacy Booking Summary page code**.
2. `velo/public/tracking.js` → **Public / tracking.js** (both new exports are required).
3. `velo/custom-code/event-bridge-iframe.html` → existing **Master Page HTML component `#wbeEventBridge`**, replacing its HTML, not adding another component.
4. `velo/custom-code/google-tag-and-consent.html` → existing **Google tag + consent Head Custom Code entry**, replacing it, not adding a second entry.

No backend file, collection, secret, invoice template, pricing logic, Microsoft tag or replacement page is part of this installation.

## Owner decisions / activation prerequisites

The committed candidate deliberately retains `BANNER_ENABLED = false` and `GRANT_ALL_WITHOUT_BANNER = true`. **In that configuration the new form handoff remains OFF, even though existing Google signals are automatically granted. This is not a working collection deployment until the consent prerequisites below are satisfied.**

1. Approve activating the existing banner, its added booking-email advertising-measurement disclosure, and the choice retention policy. In the same head entry set `BANNER_ENABLED = true` and `GRANT_ALL_WITHOUT_BANNER = false`. This changes existing tag consent behavior for visitors who do not accept; do not silently install these flag changes. Review privacy-policy wording and the delivered **Cookie settings** control before activation. This persistent native button appears only when the banner is enabled, remains after Accept/Deny and on returning granted/denied visits, and reopens the banner; **Deny** withdraws consent and invalidates pending notifications. Verify keyboard access, visibility and placement in published Wix. This patch does not introduce a new CMP or claim jurisdictional compliance.
2. Only a trusted Accept All click (or a nonexpired record written by that revised banner) opens the gate. The new `wbe_consent_choice_v2` record records `source: banner-click-v2`, choice and time; retention is 180 days. Old scalar `wbe_consent_choice`, unknown/automatic/expired records and all-true Wix policy never authorize this channel. Existing automatic Google grant and `wbeConsentGranted` do not open it. Deny and observed Google consent **update** `ad_user_data: denied` close it and replace the persisted grant with denial (removing stale authority first if the subsequent write fails); ordinary initial default-denied is not a withdrawal. External denial also resets the advertising grant cache so a fresh trusted acceptance really updates Google. A cross-tab v2 storage change closes the local gate conservatively and requires a fresh choice/reload; it never adopts a cross-tab grant. The original timestamp is preserved on reads and checked on each prepare and complete: exact 180-day expiry, future/malformed timestamps and observed clock rollback close eligibility. Reacceptance can renew retention but never revive old pending work. If saving acceptance fails, only bounded current-session permission is retained. No client can guarantee durable preference changes when the browser refuses both removal and writes; the current page still closes immediately. Deny never prevents booking.
3. Bind the head to the actual HTML component: the published outer iframe must have the unique exact title **`WBE event bridge`**. The head requires exactly one `iframe[title="WBE event bridge"]`, matching `contentWindow`, and event origin equal to that iframe's nonopaque `src` origin. Verify Wix's accessibility/title setting actually produces this DOM title. If Wix cannot supply that exact binding, STOP and obtain a reviewed binding adjustment; do not remove source/origin checks. This has not been verified in live Wix.
4. The iframe relay additionally requires its parent's origin and referrer origin to be `https://www.wanderlustcaribbean.com`. Preview, alternate hostname, opaque origin, missing referrer or a Wix nested-frame topology may therefore suppress the notification. Verify the real published relationship without weakening the checks. Ordinary existing generic tracking remains unchanged.
5. Keep the already-correct Ads manual email selector exactly `#comp-mqo6cvon input[type="email"][name="email"]`; Form interactions ON; automatic user-data detection OFF; email only. The head uses that same selector, requires exactly one field and unchanged email between prepare/complete. Do not add a conversion action or switch account-wide methods. Customer-data terms and destination eligibility remain separate prerequisites.

## Offline verification

Run from repository root:

```text
node --experimental-vm-modules tests/ads-custom-form.cjs
node --experimental-vm-modules tests/ads-consent-lifecycle.cjs
node tests/attribution-hotfix.cjs
node --experimental-vm-modules tests/google-ads-identifier-async.cjs
node tests/google-ads-private-journal.cjs
```

The new harness runs the full actual Summary callback with inert SDK/backend boundaries, the native ESM tracking module with resolved inert Wix imports, and actual iframe/head inline scripts in separate VM contexts. It validates Summary's actual tracking import names. It never loads the external Google script or performs a booking/provider request. Browser DOM and trusted clicks are explicitly simulated: these tests are not published Wix frame compatibility or legal consent verification. Existing source pins are updated only for the two changed pinned runtime files; listener assertions distinguish the new dedicated listener/storage observer from the unchanged generic purchase listener.

## Separately authorized live acceptance (pending)

After independent review and owner installation, verify exact published bytes and iframe binding, banner choice provenance and selector resolution. Observe a separately authorized successful booking with network capture active through navigation; do not create an unsolicited booking, click an owner's paid ad, fabricate click IDs, or resend historical uncertain imports. Check the specific AW destination and supported user-data indicators without exporting contacts/hashes/full payloads. Verify denied/unknown consent emits no new handoff, and ensure no duplicate automatic form trigger or GA4 identifier contamination. Record trigger delivery, email collection, ingestion/processing, and matching/attribution separately. Passing offline tests does not establish these outcomes or clear historical diagnostics.

## Rollback

Retain the previous four runtime files and flag values before installing. Restore all four together from base `65002a1603dcfcbcf5074d92583606a2c79c01b1`; leave backend sending/journal settings untouched and never replay bookings. To disable just this candidate handoff while investigating, retain its consent gate closed (banner disabled); do not reenable silent collection as a workaround. Preserve the v2 consent record unless the owner explicitly authorizes removing consent preferences. Reverting code does not repair or delete historical analytics.
