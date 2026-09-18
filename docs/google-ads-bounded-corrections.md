# Bounded Ads corrections: reviewed source and owner installation gates

## Status and limits

**Bounded source/behavior review PASS; live Wix unverified.** This is a GitHub source handoff, not publication approval or proof of hosted execution. Parent baseline: `9f8eab6247857f5fe3ac4e3bbc73068c03a978fb`. No Wix Editor, CMS, Ads configuration, OAuth/provider call, real booking, replay, cancellation or retirement was performed for this delivery.

The correction:

- Transfers the early Head first-touch click record across the partitioned page/worker stores using the dedicated iframe channel. Preserves literal `+` and percent-decodes URL components exactly once. Validates record shape/age, source/origin, channel, sequence and operation; clear targets the converted record.
- Binds a captured Summary object privately to the worker revision and exact retained record. Rechecks after room/query awaits and immediately before Google and Microsoft payload construction. Received withdrawal, suspension or clear invalidates old work; same-ID reacceptance does not revive it. Invalid permission suppresses contacts as well as click IDs; essential booking contacts remain reservation data.
- Preserves original allocation-issued Google capability, immutable attempt/result journal and no-replay behavior. No new public authority endpoint, token mint, retry, durable consent schema or grant provenance was added. Commercial authority remains UNVERIFIED.
- Uses shared metadata-based phone normalization with the selected calling code; preserves explicit valid international numbers and omits invalid marketing hashes. Unrecognized supplied numeric phone contacts do not abort the booking. Corrects email whitespace and Unicode-name normalization without changing existing Gmail/domain/punctuation policy.
- Rejects invalid click-ID types, malformed/overflowing timestamps and invalid USD amounts before claim/provider entry. Legitimate zero and zoned timestamps remain supported.
- Returns `NOT_ATTEMPTED / UNSUPPORTED_ADJUSTMENT_ROUTE` for adjustments, without OAuth or ingestion. Both cancellation callers preserve retracted flags rather than inventing completion, including during suspension. Reservation cancellation remains independent. **Actual conversion retractions/restatements are not implemented.** Do not use renamed ingestion events as adjustments.

### Exact withdrawal boundary (R1 versus R2)

R1 was a concrete received-withdrawal defect: Summary held primitives across room awaits and sent after the worker had already cleared attribution. Its unchanged original regression now passes with two saved rooms, one invoice callback, one redirect timer, AUTH only and zero optional Google wire entries. The positive control retains AUTH/ATTEMPT/RESULT and the original ID; same-input repeat cannot send again.

The last controllable boundary in this correction is the synchronous frontend invocation of the backend sender. The worker uses its last accepted state, matching revision and exact original record, with no await between its final check and payload/send. A synchronous purchase callback that delivers withdrawal (even then throws) is fenced. Microsoft has a separate final check. Once a backend invocation starts, later backend awaits/provider work cannot be recalled by this worker. Earlier dispatched room IDs are not retroactively erased.

R2's unchanged original assertion still FAILS: an earlier successful Head confirmation can be held while a later revocation remains undelivered, then be consumed before that revocation. At confirmation issuance the actual Head was eligible; the worker has not received any newer negative observation. The fresh reviewer probe explicitly verifies that delivering the queued revocation invalidates that exact returned snapshot immediately. This is an asynchronous-observation limit, **not** proof of current shared Head/worker state or atomic consent. Do not say the original three-probe file is wholly green (it is 2/3, exit 1), and do not reinterpret R1 as this limit.

A clear advances the worker epoch conservatively even when its old target differs from a later stored record. The later record is preserved, but already-captured handles in that epoch are invalidated; optional conversion loss is possible. This is not resurrection or authority substitution. The independent concurrent test uses two legitimate fresh allocations for disjoint stays over one inert store: withdrawal of one suppresses its upload while the other retains its own original capability and ID.

The established contact-free form path and generic analytics remain separate. Production banner flag remains OFF; no universal opt-in or forced choice was added. NOT_REQUIRED follows the existing completed location/rules decision, not an invented affirmative consent receipt. Existing Microsoft retry/logging behavior and the generic Head event listener are not redesigned or globally certified by this bounded review.

## Single-file `globalThis` compatibility follow-up (locally verified; hosted NOTRUN)

The owner reports the coordinated files from `e172b1f178dffa99b70c73a583ff2a77df08ae07` are installed in the correct Public/Backend locations and `libphonenumber-js@1.13.13` is installed. Publish stopped on Public `clickAttribution.js` line 8:21: `no-undef` for `globalThis`. The matching new Head has **not** been Applied; the old live version remains retained. These are owner-reported installation facts, not an independently observed hosted build.

After independent review and GitHub delivery, **replace only `velo/public/clickAttribution.js` → Dev Mode → Public → `clickAttribution.js` (whole file)**. Do not reinstall the coordinated set, change packages, or Apply the Head to diagnose this error. Save and retry the owner-controlled publish/build under the existing approval. If it still fails, retain the exact new build message and leave Head unapplied. The already staged matching Head remains a separate coordinated activation step after successful publication; this candidate does not perform or authorize that step.

The correction declares only `globalThis` read-only to ESLint; it does not disable `no-undef` or create a runtime global. The existing source had **no `typeof globalThis` guard**. It now checks optional Web Crypto and returns no nonce on absence/throw/malformed return, stopping before a channel request. Valid Web Crypto still fills the same 16-byte `Uint8Array`; no weaker randomness, browser `window`, eval, or imported public crypto fallback is used. The clear path no longer rejects solely because crypto is unavailable. A hostile replacement which mimics a valid Web Crypto implementation is not authenticated by these shape checks; actual cryptographic runtime support remains a hosted prerequisite.

Evidence and limitations:
- Wix documents JavaScript support through ES2020: https://dev.wix.com/docs/develop-websites/articles/coding-with-velo/java-script-velo/java-script-support
- `globalThis` is an ES2020 standard global: https://tc39.es/ecma262/2020/#sec-globalthis
- ESLint explicitly documents `/*global */` declarations for `no-undef`: https://eslint.org/docs/latest/rules/no-undef . The declaration is configuration, not runtime capability evidence.
- **No official Wix guarantee of inline global-comment acceptance or exact hosted lint configuration was located.** This candidate reproduces the exact original 8:21 diagnostic with a local legacy-global ESLint configuration, but must not be described as having passed Wix compilation. The owner retry is necessary; do not replace that missing evidence with the assumption that ES2020 support guarantees worker Web Crypto.
- Local ESLint 8.57.1 configuration: `parserOptions: {ecmaVersion:2019, sourceType:'module'}`, `env:{es6:true}`, `globals:{setTimeout:'readonly',clearTimeout:'readonly'}`, `rules:{'no-undef':['error',{typeof:true}],'no-global-assign':'error'}`. This deliberately lacks `globalThis`; it is a matching-rule reproduction, **not a recovered Wix config/version**.
- Run the new test with separately installed tooling, without modifying runtime dependencies: `npm install --prefix <tool-directory> --ignore-scripts --no-audit --no-fund eslint@8.57.1`, then `NODE_PATH=<tool-directory>/node_modules node --experimental-vm-modules --test tests/click-attribution-globalthis-compat.cjs`.
- Tests use the VM's native `globalThis`, never a host `{globalThis: ...}` injection. A negative explicitly deletes the VM global; real Node Web Crypto is an inert positive fixture, not evidence of Wix support. Missing globals/methods, throwing getters/methods, and malformed returns deny optional attribution with no channel post. Original channel/fresh-producer/reviewer assertions are preserved.

**Hosted Wix compile, worker crypto observation, publication, Head Apply and provider verification: NOTRUN by this candidate.** Original R2's undelivered-revocation limit above is unchanged.

## Coordinated owner installation inventory (original full delivery; not the follow-up copy list)

Use the **Raw** contents from the exact delivery commit, not rendered line numbers or snippets. Do not publish a partial set. The final handoff provides commit-pinned links.

| Repository file | Wix destination |
|---|---|
| `velo/public/phoneNormalization.js` | Public `phoneNormalization.js` (new) |
| `velo/public/clickAttribution.js` | Public `clickAttribution.js` (new) |
| `velo/public/tracking.js` | Public `tracking.js` (replace whole file) |
| `velo/backend/hashUtils.web.js` | Backend `hashUtils.web.js` |
| `velo/backend/googleAdsConversions.web.js` | Backend `googleAdsConversions.web.js` |
| `velo/backend/availability.web.js` | Backend `availability.web.js` |
| `velo/backend/adminConsole.web.js` | Backend `adminConsole.web.js` |
| `velo/masterPage.js` | Site masterPage code |
| `velo/page-booking-summary.js` | Existing Booking Summary page code |
| `velo/custom-code/event-bridge-iframe.html` | Existing `#wbeEventBridge` HTML component on Master Page |
| `velo/custom-code/google-tag-and-consent.html` | Existing Google Custom Code Head entry; replace, do not add a second owner |

`velo/custom-code/google-tag-and-consent.source.html` is readable **build input only; do not paste it into Wix**. Package files, scripts, tests, static pins and this document are repository support, not Wix page modules. Existing Microsoft importer, Data Manager client, journal, settings and policy modules remain baseline dependencies, not replacement files in this delivery. No new collection, field, secret, permission or Ads account setting is required by this bounded delta; the pre-existing journal/policy prerequisites must already be valid.

### Mandatory npm/build prerequisite — NOTRUN in Wix

Exact tested package: **`libphonenumber-js@1.13.13`**. Exact import in the shared public helper:

```js
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
```

Local installed package version, named CJS/ESM exports, max metadata and actual parser execution are verified. Its `./max` export maps import to `./max/index.js` and require to `./max/index.cjs`. This does **not** establish that Wix supports that version/subpath or selects the compatible branch. **Real Wix frontend/backend compile: NOTRUN.** Wix-supported availability of exact 1.13.13: NOT VERIFIED.

Owner procedure, before installing dependent code: Packages & Apps → npm → Install npm package; locate `libphonenumber-js`, confirm exact version **1.13.13** is offered/supported. If already installed, use Installed Packages → More Actions → Choose a version, rather than adding a duplicate. Select the exact version and build the shared public helper, Summary and backend hash/conversion consumers. Stop on unavailable version or unresolved `libphonenumber-js/max`; do not substitute latest, `/min` or root import. The repository lockfile does not install packages in Wix.

References:
- https://dev.wix.com/docs/develop-websites/articles/coding-with-velo/packages/work-with-npm-packages-in-the-editor
- https://dev.wix.com/docs/develop-websites/articles/coding-with-velo/packages/about-npm-packages

The official compatibility warning about ES/native modules is why the dual-export package still needs a real Wix build. No hosted-support claim follows from successful Node imports.

### Channel and complete-Head prerequisites

- Preserve component ID `#wbeEventBridge`; the rendered outer iframe title must be exactly `WBE event bridge`, unique and connected. In HTML Settings this is **What's in the embed? / Add alt text here**, not an inner `<title>`. Confirm canonical parent origin `https://www.wanderlustcaribbean.com` and actual frame origin binding. Preview/alternate origins are deliberately not granted by weakening the origin checks.
- Verify standard Web Crypto `globalThis.crypto.getRandomValues` in the real Velo worker and Head realm. Missing crypto fails optional attribution closed; local injection of Node Web Crypto is not hosted proof.
- The **entire generated Head HTML**, including loader, wrappers and comments, measures 14,795 UTF-16 units in LF and **14,802** after full CRLF conversion, below Wix's 15,000 cap by **198**. Do not paste fences or add text. The raw internal budget was explicitly raised from 14,000 to 14,900; the old reserve is not preserved. Permanent tests check raw and full CRLF copies plus deterministic readable/deploy parity; compression and mangling stay OFF.
- Preserve existing Google/Microsoft tag ownership and consent flags. No extra duplicate custom-code entry, collector setting, forced grant or tracking diagnostic is part of this installation.

## Reproducible local verification

Use an isolated checkout of the delivered commit and Node supporting `--experimental-vm-modules`. Install exact lockfile dependencies with `npm ci --ignore-scripts` (or `npm ci --offline --ignore-scripts` when cached). This contacts only npm if needed, not Ads. Then run from repository root in Git Bash/POSIX:

```sh
export NODE_OPTIONS="--require $(pwd)/tests/ads-review-network-deny.cjs"
node --experimental-vm-modules --test tests/google-ads-adjustment-unsupported.cjs tests/google-ads-contact-validation.cjs tests/google-ads-identifier-async.cjs tests/google-ads-private-journal.cjs tests/google-ads-processing-native.test.cjs tests/google-ads-processing-diagnostic.test.cjs tests/google-ads-processing-bounds.test.cjs tests/click-attribution-corrections.cjs tests/google-ads-fresh-producer.cjs tests/google-ads-final-review.cjs
node --experimental-vm-modules tests/attribution-hotfix.cjs
node --experimental-vm-modules tests/ads-custom-form.cjs
node --experimental-vm-modules tests/ads-consent-lifecycle.cjs
node --experimental-vm-modules tests/ads-location-integration.cjs
node --experimental-vm-modules tests/google-ads-diagnostic-client-fallback.cjs
node --experimental-vm-modules tests/google-ads-diagnostic-runtime.cjs
node --experimental-vm-modules tests/google-ads-http-diagnostics.cjs
node --experimental-vm-modules tests/google-ads-upload-reliability.cjs
WBE_CLICK_DEPLOY=1 node --experimental-vm-modules --test tests/click-attribution-corrections.cjs tests/google-ads-fresh-producer.cjs tests/google-ads-final-review.cjs
node scripts/build-google-tag.cjs --check
node tests/google-tag-size.cjs
node tests/google-tag-build-parity.cjs
```

On Windows Git Bash use a native `C:/.../tests/ads-review-network-deny.cjs` absolute path in NODE_OPTIONS if `pwd` returns an MSYS `/c/...` path. All business SDK/signing/provider boundaries are inert fixtures; guard output must report `OFFLINE_NETWORK_ATTEMPTS=0`. Union/deploy and individually repeated scripts overlap: do not add their counts as unique tests. Node's experimental VM warning is expected.

Source pins are static authoring-time SHA-256 values over CRLF→LF only, not runtime self-pinning. The existing three-entry assertion is unchanged. After independent semantic approval, these exact replacement identities were authorized:

| File | Canonical SHA-256 |
|---|---|
| `velo/page-booking-summary.js` | `f9c068bad5da22fe1c3c9cd0a0c1d830dfaca901e2475238bc797dc61b53ce7d` |
| `velo/backend/availability.web.js` | `d2d0e44d5b2f1a3639d313f3ed10379ff6dc7a0a0acf0a845d608bd4be433fb5` |
| `velo/custom-code/google-tag-and-consent.source.html` | `5a3f01d435100c8c2e5e52757b850e118cffffe87ff35b6a714def321e81ddb4` |

Original independent R1/R2 probe and historical outputs remain unchanged in the owner's checkpoints. The portable reviewer test describes R2 as an expected observation limit rather than silently rewriting the original failed safety assertion.

## Owner-hosted prepublication plan — all NOTRUN

This plan is not authorization for a new booking, provider call or publication.

1. Save the current owner-installed files/custom-code entry/package version for rollback; compare the real draft to the stated baseline before replacing whole files. Stop if unrelated owner edits would be overwritten.
2. Complete exact package availability and public/backend build checks above. Install the coordinated draft files without publishing a partial set. A Node syntax check is not a Wix compile.
3. Compile every affected public/page/backend consumer. Do not execute booking, invoice, cancellation, retry, status or sender exports as a compile test. Record native compiler errors, exact package version and resolved subpath.
4. Check existing rendered frame metadata and worker crypto in an owner-approved provider-free environment; no raw contacts, cookies or IDs need to be logged. Do not deliberately navigate a tracking-enabled published page as if that were network-inert. Where Preview cannot reproduce canonical origin/title, record the gate unresolved rather than modifying runtime checks.
5. In an isolated provider-disabled harness, repeat the named positive/denial, malformed response, reconstruction, first-touch, withdrawal/reacceptance, throw, clear and concurrent schedules. Confirm two saved-room fixture results, no denied optional contacts/IDs, original capability and zero replay, unchanged invoice callback and actual 2000ms redirect setting. No synthetic identifier may be uploaded to Google/Microsoft.
6. Before any eventual publication, the owner must accept the asynchronous/no-cancellation limits and complete remaining hosted checks. Any live booking/provider observation needs separate explicit approval; prefer approved observation of a legitimate future transaction, not historical resend. Processing acknowledgment, processing SUCCESS, matching and campaign attribution are separate results.

## Rollback

Before publication, abandon/revert only this draft's coordinated changes using the saved installed snapshot. After any separately approved installation, rollback must be coordinated across worker, iframe, Head and consumers; do not leave mixed protocol versions or uninstall the phone package while imports still use it. Baseline Git files are available at `9f8eab6247857f5fe3ac4e3bbc73068c03a978fb`, but baseline contains the known withdrawn-snapshot and false-retraction defects: **do not restore its adjustment transport as a routine rollback**. Prefer a separately reviewed forward rollback retaining unsupported adjustments and preventing optional dispatch. Never erase AUTH/ATTEMPT/RESULT, reset upload/retraction flags, delete bookings or resend conversions to roll back code. No historical attribution or false retracted flag is repaired by this delivery.
