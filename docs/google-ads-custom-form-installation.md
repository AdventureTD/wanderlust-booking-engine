# Legacy Summary: location-policy Ads form notification — review candidate

**Implemented and tested offline; NOT installed, published, independently approved, or provider-verified. No commit/push before independent review. Replacement engine remains HOLD.**

## What changes

The existing Summary validation and whole-cart-success handoff now consumes the real zero-argument `getAdsFormRequirement()` backend read through `public/tracking.js`. A synchronous contact-free `begin` fences the current choice before asynchronous work. Tracking reads policy before `prepare`, reads it again before `complete`, and requires the same requirement and content fingerprint. Summary never awaits either optional policy request. Each frontend read is capped at 750ms; a late result is ignored. The existing 2000ms home redirect is unchanged, not extended to wait for Ads.

The head emits only `gtag('event', 'form_submit', {send_to:'AW-788746633'})`, after full successful cart creation, current negative-state/choice checks, fresh policy evidence and unchanged selector value. Partial/failed/uncertain carts never complete the handoff. The existing backend Ads import/journal, GA4 purchase, pricing, reservation writes and invoicing remain separate and unchanged. This is not site-wide consent enforcement for those existing senders, native tags, GTM or Microsoft.

No contacts, hashes, caller geography or consent claims are sent to the policy endpoint. No IP or third-party GeoIP service is used. There is no global `user_data` setter, no contact-bearing generic event or GA4 parameter, and no contact logging. The head reads the manual selector only at eligible prepare, retains its value only in an ephemeral frame state for equality checking, and never forwards or persists that value. Pending eligibility lasts at most ten minutes; consumed state contains only a sequence. Invalidated pending states cannot dispatch; a replaced frame/page releases its old in-memory state.

**The explicit form event is not proof that Google attached email.** The retained manual selector plus AW-routed event still needs separately authorized provider-payload observation. Do not fix a failed provider check by adding a global setter or contacts to purchase.

## Cookie settings visibility correction — single Head replacement

This delta replaces **only** the existing Google tag + consent Head Custom Code
entry with the entire Raw `velo/custom-code/google-tag-and-consent.html` after
independent review. Keep its existing All pages scope. Do not create a second
entry or paste the development-only `.source.html`. All backend/public/page,
iframe, Microsoft, GA4 purchase, policy collection and provider settings remain
unchanged; the coordinated table below describes historical dependencies, not
an instruction to reinstall them for this correction.

Delivered `BANNER_ENABLED = false` now stops before creating either the Cookie
settings button or dialog, including on About and during DOMContentLoaded.
This is a UI-OFF correction, **not an active location-conditional UI feature**.
Empty/all-false rules need neither UI nor GeoIP; any true rule still produces
UNRESOLVED with the actual backend, not REQUIRED. No GeoIP or policy change is
introduced. Keep the flag OFF: flipping it alone would enable legacy universal
UI and is not an approved geographic gate. Future UI requires a separately
reviewed current applicable REQUIRED decision from trusted visitor location;
row existence or an unrelated true rule cannot establish a match.

Saved choices and denials continue to be loaded and enforced without controls.
There is no new in-page reacceptance/settings path in delivered OFF mode; no
negative preference is cleared or expired to compensate. Existing explicit UI
handlers remain exercised only in separately enabled synthetic REQUIRED tests,
not claimed as a currently reachable location feature.

## Wix 15,000-character packaging

For the Head Custom Code entry, copy the **entire raw contents** of
`velo/custom-code/google-tag-and-consent.html` from the approved GitHub revision,
including both script tags. Replace the existing entry; do not add a second tag.
This generated installation file is **10,931 UTF-16 code units / 10,931 Unicode
characters / 10,937 UTF-8 bytes**, including all HTML and comments, leaving
**4,069 characters** below Wix's 15,000-character limit. Do not paste the readable
`google-tag-and-consent.source.html` file: it intentionally exceeds that limit.

This visibility delta changes **only the installed Head HTML**. All other runtime
files in the coordinated installation table below remain unchanged. If the
preceding location-policy release has not yet been installed, its coordinated
dependencies are still required; this Head fix does not replace them. No provider,
policy, GeoIP, selector or consent-storage change is included.

Maintainers: edit `velo/custom-code/google-tag-and-consent.source.html`, never the
generated file, then run from the repository root:

```text
npm ci --ignore-scripts
npm run build:google-tag
npm run check:google-tag
npm run test:google-tag
```

Use the locked build dependencies; see the candidate checkpoint for the verified Node version. The lockfile pins build-only Terser and Acorn;
none is installed into Wix. Terser strips JavaScript comments/whitespace and
prints equivalent literals with **compression OFF, all mangling OFF, no source
map**. No branches, globals, listeners or safety checks are removed. All HTML
outside the inline script (including the async external loader and its order)
is preserved. LF attributes keep the build deterministic across checkouts.
Tests check identical JavaScript ASTs, deterministic output, full-file size and
readable/deploy parity through the actual inert Summary/tracking/policy/iframe/
head and consent lifecycle suites. The 21 existing CJS suites use the deployable
artifact by default. Offline success is not published-Wix/provider verification.

## Exact coordinated installation — after review and authorization only

Copy from the eventual approved revision, replacing existing files/entries rather than creating duplicate tags:

| Repository source | Wix target |
|---|---|
| `velo/backend/guestConsentLocationPolicy.js` | Backend / `guestConsentLocationPolicy.js` (private helper) |
| `velo/backend/guestConsentRequirementsReader.js` | Backend / `guestConsentRequirementsReader.js` (private helper) |
| `velo/backend/adsFormRequirement.web.js` | Backend / `adsFormRequirement.web.js` (new web module) |
| `velo/public/tracking.js` | Public / `tracking.js` |
| `velo/page-booking-summary.js` | Existing **legacy Booking Summary** page; business flow unchanged, explanatory comment only in this delta |
| `velo/custom-code/event-bridge-iframe.html` | Existing Master Page HTML component `#wbeEventBridge`, replace HTML |
| `velo/custom-code/google-tag-and-consent.html` | Existing Google tag + consent Head Custom Code entry, replace contents |

Dependencies: existing `wix-data`, `wix-web-module`, Wix frontend storage/location modules, and Wix-supported Node `crypto.createHash` (already used by this backend codebase). The backend module imports both private helpers using `backend/...`; tracking imports `backend/adsFormRequirement.web`. No new npm geolocation library, service, secret, paid plan, invoice dependency or scheduled job is needed. Install all dependent modules together; a missing module is not an acceptable live installation test.

Reuse the existing **LIVE `ConsentRequirements`** collection; do not create a replacement or add invented rows. Expected fields: `countryCode` Text (supported uppercase ISO alpha-2), optional `usStateCode` Text (blank/absent for country-wide, only 50 supported US states when nonblank), `consentRequired` Boolean. `notes` is administrative only. Preserve admin/private-only access; the public web method performs narrowly scoped elevated reads and does not expose rules or rows. Explicit null state, malformed fields, unknown vocabulary or unavailable collection are failures, not permission.

## Actual policy contract and limitations

* A fresh, fully exhausted, validated empty or all-false policy is **NOT_REQUIRED**, without locating anyone. This is the owner's configured receipt prerequisite, not an affirmative choice or legal exemption.
* Any true row, anywhere, currently produces **UNRESOLVED**, because this integration has no trusted visitor IP geography. Even a valid stored receipt does not override UNRESOLVED. If true rules are added, this extra Ads form event is suppressed until a separately reviewed trusted-IP integration exists. This candidate neither adopts nor promises a GeoIP provider. No location lookup is currently needed for empty/all-false rules.
* Backend scans use `_id`-ordered keyset reads, pages of 100, maximum 4096 rows / 41 pages / ten-second application deadline, with `suppressAuth:true`, `consistentRead:true`, `suppressHooks:true`. Failure, timeout, invalid/incomplete/overflow reads fail closed. Frontend's shorter deadline does not cancel an in-flight backend SDK query; the backend remains independently bounded.
* `consistentRead` is **not an atomic multipage snapshot**. This is an ordinary admin-only configuration read, assuming normal administrative maintenance rather than an adversarial concurrent writer. Avoid editing policy during guest submissions. Each phase does a new uncached scan. A SHA-256 content fingerprint of validated rules plus row IDs/update evidence detects observed changes; it is not a signature, guest credential, atomic revision or proof that no update occurred between/after observations. No fake coherent revision or new revision datastore is introduced.
* The minimized resolved DTO is exactly `{v:1, requirement, policyKey, observedAt}`. Error results are UNRESOLVED and rejected by the frontend gate. The browser checks current timestamps (at most 1500ms old, not future), a 750ms local read deadline and ten-minute submission lifetime. Significant server/browser clock skew suppresses this optional event; it does not block booking.
* Only the dedicated strict-schema channel accepts these observations. The relay requires the canonical parent origin; the head binds the unique frame source/origin, sequence, phase, policy shape and freshness. Generic message booleans, extra properties, wrong frames/origins and missing evidence do not authorize it. Normal same-site JavaScript/browser trust applies: this is not a cryptographic defense against compromised first-party script, extensions, developer tools or a visitor controlling their browser.

## Choices, denials and UI

Keep delivered `BANNER_ENABLED = false` and `GRANT_ALL_WITHOUT_BANNER = true`; **do not enable a universal banner**. With valid NOT_REQUIRED policy, no stored denial, and readable negative state, the new event works without a receipt. It creates no consent record. Default Google grants, disclosure acceptance, Wix all-true policy and completed bookings are never transformed into affirmative receipts.

`wbe_consent_choice_v2` is read independently of banner visibility, at beginning and both gated phases. Valid purposeful historical grants use exactly `source:'banner-click-v2', choice:'granted', at:<integer>`; the original timestamp is never renewed by a read. Only these explicit choices support the REQUIRED branch (the current backend never returns REQUIRED without future trusted geography). Grants expire at 180 days. Malformed, future or expired records conservatively close even the NOT_REQUIRED event until a new explicit choice; they do not silently become “no choice.” Observed clock rollback closes the current page. Automatic/legacy scalar grants supply no affirmative provenance.

Stored v2 denials and legacy `wbe_consent_choice:'denied'` have **no expiry**. Explicit Google **update** `ad_user_data:'denied'` closes pending work immediately, resets the advertising-grant cache, and persists a `google-denial-v1` negative record plus a small legacy negative fallback; Google **default** denial is initialization, not withdrawal. No stale grant is retained intentionally after external denial. Browser storage read failure closes the event. Failed grant persistence supplies no REQUIRED permission. If all preference writes/removal are refused, current-page denial remains effective but no client-only solution can guarantee durable denial after the browser discards that page; this is a storage limitation, not a promised cross-device consent store.

No **Cookie settings** button or dialog is created with the delivered banner OFF. In the retained separately enabled synthetic REQUIRED test path, **Deny** withdraws and invalidates pending submissions, including a policy read in flight; a trusted **Accept All** writes a fresh purposeful choice and removes the legacy denial without reviving an old sequence. This is handler regression coverage, not production geographic UI activation. Cross-tab changes invalidate the observing page and send a local Google denial, closing that page until a separately available explicit choice or reload reevaluates retained state. Reload never clears a denial. The observer never overwrites the other tab's saved choice or churns denial timestamps. A fresh page evaluates the actual stored choice again.

Narrow legacy correction: this head snippet's automatic and helper-based Google grants now honor stored denial/read failure instead of ignoring them when the banner is OFF. Existing raw `gtag` calls by other tags, generic event routing, click capture and the server import are not redesigned. Do not claim site-wide opt-out coverage or legal compliance from this scoped fix.

## Published binding prerequisites (not yet verified)

1. The published outer iframe must have unique exact title **`WBE event bridge`**. The head requires exactly one `iframe[title="WBE event bridge"]`, its matching `contentWindow`, and event origin equal to its nonopaque `src` origin. Verify Wix's accessibility/title setting produces that DOM. If unavailable, stop for a reviewed binding change; do not remove the fences.
2. The relay requires parent/referrer origin `https://www.wanderlustcaribbean.com`. Preview/alternate hostname, opaque origins, missing referrer or different nested-frame topology can suppress it. Verify the published relationship.
3. Keep the existing manual email selector `#comp-mqo6cvon input[type="email"][name="email"]`, email only, Form interactions ON, automatic user-data detection OFF. Require one field and unchanged value between actual asynchronous prepare and complete; Summary independently checks its original form email at whole-cart success. Do not add a conversion action or change account-wide methods. Verify destination/customer-data terms separately.
4. Verify no Cookie settings button or consent dialog appears on About or other pages, including a hard refresh. Local DOM fixtures do not prove published UI behavior; no new booking or provider call is needed for this visibility check.

## Offline verification

```text
node tests/ads-location-policy.cjs
node --experimental-vm-modules tests/ads-location-policy-boundaries.cjs
node --experimental-vm-modules tests/ads-location-integration.cjs
node --experimental-vm-modules tests/ads-custom-form.cjs
node --experimental-vm-modules tests/ads-consent-lifecycle.cjs
node tests/attribution-hotfix.cjs
node --experimental-vm-modules tests/google-ads-identifier-async.cjs
node tests/google-ads-private-journal.cjs
```

The new native-linked tracer executes actual Summary callbacks, tracking, backend web module, reader/resolver, iframe and head. Only SDK/storage/DOM/webmethod transport and provider boundaries are inert; rules are fixture data, never live CMS observations. Historical REQUIRED-branch tests use an explicitly synthetic webmethod response because the current backend correctly cannot issue REQUIRED. Malformed-response controls are labelled boundary injections. Original reviewer tests are retained outside the worktree; updated protocol assertions and source pins are author verification, **not independent approval**. Tests never load Google, call a live booking endpoint or send provider events.

## Later live verification and rollback

After review and separate installation authorization, verify published bytes and bindings, current LIVE schema/read availability, no button/dialog, retained returning choices and external-denial/reload handling. Whole-cart/provider verification is separate from this visibility fix. Only a separately authorized booking/provider observation may establish the AW event plus supported email-collection evidence. Retain privacy-minimized destination/indicator evidence, not contacts/hashes/full payloads. Keep trigger delivery, email collection, processing and attribution distinct. Do not replay historical uncertain imports or fabricate paid-ad interactions.

Retain all seven runtime files/entry contents and flag values before installation. Rollback the coordinated consumer files to base `98a5d408e1ec4a086056098adeee428459280da9`; remove the three newly introduced backend modules only after no imports refer to them. That base restores the old closed custom-form gate but also restores its banner-OFF saved-denial defect, so rollback needs an explicit owner decision, not a claim of equivalent consent behavior. Preserve stored denial preferences and all existing backend sender/journal settings. Banner OFF disables this local UI, not the policy-authorized Ads event. Do not erase consent preferences or replay bookings as rollback steps. Historical analytics are not repaired by any source rollback.
