# Google Ads attribution and Booking Summary access
## Final offline milestone report — not release completion

**Prepared for Tom · 16 October 2026 · Frozen candidate: baseline-remediation r2, `clickAttribution.js` SHA-256 prefix `3a65c799`.** This prefix identifies a file, not a Git commit. The candidate is an uncommitted isolated working tree based on `2b946df`.

## GitHub handoff update — supersedes earlier delivery-status statements

The accepted offline candidate and conditional M0 r4 model are now saved on the **review branch**, not merged to main:

- Branch: `ric/attribution-booking-access-review`
- Verified code commit: `49b5dc0b755b0ff38d7bd1e24e47d0a27f8b0c99`
- GitHub: https://github.com/AdventureTD/wanderlust-booking-engine/tree/ric/attribution-booking-access-review
- Remote branch readback matched the local commit exactly before this report update.

### What was saved and rechecked

The attribution/BookingSummary baseline-remediation r2 candidate is in `velo/` with its tests. The separately accepted conditional checkout model is under `research/m0-checkout-contract/` and is **not connected to Velo**. The original reviewed trees were preserved.

Ric personally reran the accepted candidate (88/88 test files), then the assembled GitHub tree. The first assembled run exposed a test referencing a sibling local folder. A repository-contained historical fee/tax fixture replaced that dependency, retaining the original assertion. Its targeted suite passed 24/24; an in-memory fee mutation failed as intended. The corrected assembled suite passed **88/88**. Build verification passed at **14,874 characters**. The copied M0 suite passed **52/52**; one trailing-whitespace-only cleanup was made for Git's check. Historical independent M0 verification and its limitations are in `m0-r4-independent-review.md` alongside this report. No paid agent calls were used for this GitHub preparation.

### Later owner decisions and model work

Guest online reservations are limited to **four physical rooms**, with occupancy per room (one cart entry's occupancy applies to each room in its quantity). The admitted original price is honored. Failed or uncertain room saves require owner review without a guest invoice; reserved rooms remain held, with no automatic retry or release. Later owner additions remain direct Wix CMS edits. No production checkout duration was selected.

M0 progressed through rejected revisions before r4 received conditional offline acceptance. It models single-checkout authority, uncertainty, irreversible guest closure, cancellation fencing, and review obligations. It does **not** implement Wix storage capabilities, physical-room continuity, real owner authentication, invoice sending or CMS synchronization. Invoice-identity uncertainty after confirmed reservation success has no separate durable reconciliation obligation in this model.

### This is a verified preservation milestone, not completion of all implementation

The review branch remains **NOT READY FOR WIX INSTALLATION**. Read `../RELEASE-BLOCKERS.md` first. The sibling intake gate remains unintegrated; the actual Velo guest cap still needs reconciliation from 5 to the owner-approved 4. The additional original-checkout authorization, admin-save, invoice/Microsoft access, logging, collision and containment findings are not fixed by saving this branch. Unaccepted historical experiments and raw local logs were not indiscriminately uploaded.

Current Wix documentation confirms primary-instance `consistentRead` and single-item patch operations; that evidence does not establish the model's atomic cross-record claim/deadline or complete snapshot requirements. Therefore no unsupported Wix adapter was invented. A reproducible fresh-clone dependency bootstrap also remains to be added; verification used the existing pinned external toolchain. Main, Wix editor, published code and collection permissions are unchanged. **Explicit approval is required before any Wix editor update.**

The sections below retain their earlier milestone evidence; statements that nothing is committed/pushed are historical and superseded by this handoff update. Live-fix and permission-change limitations remain in force.

## Executive conclusion (earlier offline milestone)

- **The offline remediation milestone is accepted; a production release is not.** The latest recorded full run has **88 test files with exit code 0 out of 88**. This report independently parsed that result file; it did not rerun the tests. No current candidate changes have been committed, pushed, installed on production or published. [R2 §§6–8]
- **One earlier live repair was observed:** replacing the broken `/ubv1` Google loader with the standard loader restored library loading and some Google hits. That is not proof that Enhanced Conversions or imports work. The same Head restore left the Head incompatible with the older bridge/frontend; the last captured live state, on 15 October, still dropped attribution messages. The coordinated repair exists only in the isolated candidate. [A §0, F0–F2, E3]
- **Google Ads outcomes remain unproven:** import acceptance/matching, conversion-action mapping, Enhanced Conversions settings and email attachment, and form transmission before redirect have not been shown fixed. The earlier report's “about 70%” estimate is unsupported, not a measured probability or an established root-cause link. Neither October defect establishes the cause of September's zero attributed purchases. [A E1–E4, U1–U5]
- **BookingSummary access needs a controlled security release.** Historical permission captures allowed Anyone to read, insert, update and remove rows containing contact, booking, financial and attribution information. Those captures are not a fresh verification of today's permissions; no live anonymous data access or exploitation was attempted. The candidate removes guest-page collection access and introduces restricted backend writes, but production permission restriction is not done. [B §§2, 3, I9]
- **Important gaps remain:** the sibling intake gate is absent from this candidate; even that gate does not provide deployment containment. Caller-supplied booking numbers, public invoice/Microsoft paths, admin stale writes and possible sensitive logging need separate review. No additional security fixes were authorized or implemented for this report. [B §§5.2–5.4, C-1, addendum r2]

**Decision:** retain the frozen offline candidate and evidence. Do not treat the green suite, the earlier loader repair or limited staging checks as permission to publish or restrict collections.

## Business-rule clarification: multiple rooms in the original checkout

Guests cannot add rooms themselves after a completed reservation. Later additions are requested from Tom and performed manually by the owner. Nothing in this report proposes changing that rule.

References below to “additional-room” authorization concern rooms 2 and later **within the same original multi-room checkout**. The Summary page saves those rooms with the booking number returned for the first room. The security question is how the backend distinguishes a legitimate continuation of that checkout from a caller supplying an arbitrary booking number. It is not evidence of a guest-facing post-booking amendment feature or observed misuse. Any future fix must preserve initial multi-room checkout and owner-only later additions.

The source reports subsequently appended this clarification (BookingSummary hash prefix `ad529afb`; Ads `89949fee`). The source versions listed in §8 identify the earlier versions used for the original synthesis.

## 1. Scope and evidence rules

This is a read-only synthesis of the complete consolidated reports and both evidence inventories, including their latest **OWNER-REPORT CAVEATS**, plus the r2 remediation report and recorded result JSONs. Source keys below resolve to absolute artifact paths in §8; section names identify the precise support. No network, site, shared-repository, code, commit or push changes were made for this report. Only this Markdown deliverable was written.

| Status used here | Meaning |
|---|---|
| Previously observed live | An effect was captured historically on production; not a fresh runtime check. |
| Offline accepted / isolated | Implemented and tested in the frozen local candidate, not released. |
| Limited staging evidence | A named mechanism or function was tested on a separate staging site; not the whole booking flow or production. |
| Open / blocked | Not fixed, not verified, or awaiting separately approved work. |

The current workspace is `C:/Users/TomDe/AppData/Local/hermes/profiles/claude/work/baseline-remediation/`. Earlier source-body claims of `790140fd`, 87/88 passing, and unapplied hotfix pins are superseded by r2. The BookingSummary modules remain unchanged from the reviewed sec-bs2 set. [A addendum r2; B addendum r2; R2 §§2, 5–8]

## 2. Google Ads: issues → changes → verification → status

| Issue and evidence | Fix or system change | Verification and present limit | Status |
|---|---|---|---|
| `/ubv1` returned 404 HTML on 13 October; the external Google library never loaded and queued tag calls produced no Google traffic. Its installation/removal window is unknown. | The owner's earlier Head restore used the standard Google loader. | 15 October evidence shows library 200 responses and Google collection hits on Home, booking and availability. Booking Summary and `form_submit` were not observed. [A F0, E1] | **Previously observed live, loader only.** |
| Restored Head `1f82359` requires `schema:1`; bridge/frontend remained on the older `82187d3` contract. Attribution envelopes were rejected, Summary received no click attribution and skipped the Google import call. | Coordinated Head, relay and frontend protocol repair in the candidate. Re-pasting the old Head was only an alternative recommendation/local override, not an applied fix. | Controlled response override changed TIMEOUT to READY_EMPTY and restored policy reads. This establishes the observed protocol mismatch, not a completed booking/import. Last live capture remained broken. [A E3, F1–F2] | **Isolated repair; not live-verified.** |
| “Tag is missing user-provided data” and “No user-provided data matches.” | Loader repair addresses one historical obstacle; no proven form/EC diagnostic fix. | Form prepare/complete leases, consent, binding, unchanged email and redirect timing can prevent the hit. Which condition fails is unknown. The public container showed email-only collection; phone contribution and actual email attachment are unproven. The 70% estimate is not evidence. [A E1–E2, U1–U5] | **Open.** |
| No proven accepted/matched import or validated conversion-action mapping. | Google upload serializer/client are unchanged in the candidate; no serializer defect was identified in the review. | Owner must confirm the action mapping without disclosing the secret. Installed backend revision, request receipt, processing and matching still need evidence. Email-only bookings remain outside the click-ID-gated import path. September zero purchases cannot be causally assigned to October skew. [A E2–E4, U1–U3] | **Open.** |
| Candidate lost the first upload identifier after the prior first touch expired; clear/readiness and supersession races could mishandle newer state. | `capturePaidTouch` and Head first-touch renewal; readiness fence, revision/ownership checks and clock handling. | Recorded new-lifetime, readiness and supersession tests/mutations support the modeled fixes. Some defensive guards remain mutation-undistinguished. [A E5–E7] | **Isolated.** |
| Published master-page Settings import compiled to an empty stub, so client `suspendGoogleAds` defaulted false. | New `getPublicTrackingFlags` web method, non-destructive tracking hold and master/Search/Summary adapters. | Offline flag tests pass. Published Search/Summary bundles were not captured; real proxy shape, timing and production flag value remain unknown. This flag does not control Head tags or server uploads. [A E8, U6–U7; B Q3] | **Isolated.** |
| Held or replaced copies needed an authenticated withdrawal path; unverified readiness must not delete retained attribution. | Per-copy privacy binding across Head/relay/worker; unverified outcomes hold without admission or storage deletion. | Offline binding tests pass; actual banner signals, storage partitions and message delivery are not proven. See §5 for W19. [A §§4–5] | **Isolated, with residuals.** |
| Import-time REVOKED storage access and a first-use clear ordering defect. | Lazy latch at first use; r2 reads/latches REVOKED before KEY I/O. | 14/14 lazy-init cases; narrower guarantee described in §5. [R2 §§1–4, 8] | **Offline accepted.** |
| Generic `wbe-event-bridge` listener lacks origin/frame checks; googlemail normalization question remains undefined. | No change in this candidate. | Separate hardening/assessment work, not proven exploit or proven normalization defect. [A E9–E10] | **Open.** |

## 3. BookingSummary: issues → system changes → status

### Historical exposure and why a permission-only change is unsafe

The persisted-permissions capture at **2026-10-16T05:17:59Z** recorded BookingSummary as Anyone read/insert/update/remove; Bookings as Anyone read/insert/update with privileged remove; and BookingInvoices/Settings as Anyone read with CMS-editor writes. These are historical configuration observations, **not freshly verified current access or demonstrated exploitation**. BookingSummary includes contact information, notes, dates, financial mirrors, click IDs and conversion flags. Configured public access therefore presents confidentiality and integrity concerns, including downstream availability/pricing inputs. [B §§2.1–2.4]

The captured guest page queried and rewrote full Summary rows for notes/reporting and Microsoft flags. Restricting access before replacing those dependencies can break the guest flow. Booking numbers are sequential identifiers, **not authorization**; neither `suppressAuth` nor elevation authorizes a caller. [B §§2.3–2.4, 5.1]

| Issue | Candidate system change | Evidence / boundary | Status |
|---|---|---|---|
| Browser full-row reads and writes require public collection access. | Remove both client BookingSummary blocks. Notes persist via Bookings and backend aggregation; withdrawal uses a clear-only backend method. | Offline page tests reject any BookingSummary access. No page-trigger staging test. Direct data-API exposure closes only after an approved permission transition. [B C1, I1–I2] | **Isolated; permissions not changed.** |
| Full-row read/modify/write can restore cleared identifiers or revert unrelated flags. | Private field-scoped conditional patch writer; fixed field lists and row booking-number condition. Existing-row refresh does not write non-empty attribution; initial insert remains full-row. | Writer-race tests support scoped changes, not universal race elimination. Admin stale writes and same-field last-writer-wins remain. [B §§3.1, 4 I7, 5.4] | **Isolated.** |
| Withdrawal needs a safe write after public Update is removed. | `clearBookingSummaryReporting` accepts only booking number and row-bound HMAC capability, returns fixed outcomes and clears only four click IDs/two touch fields. | G2b tested the unchanged clear path with logged-out caller, Admin-only synthetic collection, six denials, valid clear and replay. Modules were subsequently removed and staging republished. [B C2–C4, I4–I5; A F3] | **Limited staging evidence, not production.** |
| A booking number alone cannot authorize clear/flag operations. | Capability binds booking number, row ID, expiry and nonce; strict verification and expiry recheck. Mint only on fresh-allocation conditions. | G2b exercised verification; mint came from an admin scaffold, not guest `createBooking`. Stateless token is not revocable during its 30-minute TTL. [B §3.2, C2, §5.4] | **Isolated; partial staging.** |
| Client could set the Microsoft uploaded flag. | Server marks only after accepted provider response plus valid capability; token detached from provider payload. | Offline tested. Does not authorize the pre-existing public upload endpoint itself. [B §3.3, I3] | **Isolated.** |
| Permission restriction would break unelevated public-path writers. | Elevated refresh, reporting clear, Google flag and invoice date mirror; cancellation/admin retry remain non-elevated. | G2 proved the direct elevated conditional-patch mechanism on staging with data 1.0.522/essentials 1.0.15. G2b covered the candidate clear, not all writers. [B C4–C9, I6–I8] | **Mechanism/clear only staging-verified.** |
| Restriction needs safe intake containment. | A limited Settings-based gate exists in sibling `work/intake-gate` only. | **Absent from baseline-remediation.** Its 24/24 offline tests do not prove containment: public direct Bookings writes bypass it and admitted work can finish after closure. No bounded drain exists. [B C11, §5.2, C-1] | **Missing integration; containment blocked.** |

### Security and operational gaps that remain explicit

| Priority concern | What is supported by evidence; what is not fixed |
|---|---|
| **Additional-room caller authorization** | `createBooking` accepts caller-supplied `bookingNumber` in the sec-bs2-derived availability path (line 731 onward), inserts into that booking and invokes elevated Summary refresh. It can change non-empty guest-contact fields and aggregates. Candidate narrowing protects flags/non-empty attribution but does not resolve this caller-authorization concern. No exploit was attempted. [B §5.4, C-9, addendum r2] |
| **Invoice and Microsoft public surfaces** | Anyone invoice-by-number can trigger invoice/email/calendar and date mirroring; elevation does not authorize the caller. Public Microsoft conversion upload accepts caller payloads; its suspension read fails open on Settings errors. Capability protection of the flag is not protection of the upload endpoint. [B §5.4] |
| **Admin stale writes** | Admin page sends loaded fields back; W9 can restore cleared IDs or stale flags. Same-field races also remain for dates, status and notes. “No writer can restore” was withdrawn. Manual CMS edits remain outside guarantees. [B §5.4, C-4] |
| **Possible PII in existing logs** | `availability.web.js:512` prints the first 200 characters of serialized Summary. The line is confirmed; possible guest/contact content is inferred from field order, not inspected with real data. Existing Microsoft payload/provider-response logs also need review. New modules' value-free logging does not make the whole system PII-free. [B §3.6, C-8, addendum r2] |
| **Public diagnostics and missing dependency coverage** | Captured installed diagnostics expose booking numbers, identifiers/schema or caller-selected queries. Removal requires dependency review. Protected-page bindings, two other pages, form storage/automations and several collection permissions remain unverified. `incrementSetting` public callability is unknown; do not infer it from the master reader defect. [B §§2.3–2.4, 5.3] |
| **Authorization-safe failure is not operational success** | Denied elevated writes can leave stale mirrors or uncleared reporting. Secret misconfiguration breaks capability-dependent operations. There is no runtime-proven Admin-only-compatible rollback version; reopening public CRUD is not the default recovery. [B §§5.1, 5.4] |

## 4. What the offline evidence proves

| Evidence | Result and qualification |
|---|---|
| Latest full recorded run | `candidate-r2-rerun.json`: **88 entries, 88 exit-code-zero results**, independently parsed for this report. These are test files, not 88 individual assertions or hosted checks. |
| Earlier r2 run | `candidate-r2.json`: 87/88, with `click-attribution-readiness.cjs` case #8 failing once. Fifteen subsequent reruns and the full rerun passed. A load-sensitive timing flake is **suspected**, not a proven root cause. Earlier failure evidence is retained. |
| Comparison against O3 | Recorded classification: 10 formerly failing files fixed, 77 passing in both with identical counts, one new passing file, zero recorded regressions. Earlier historical 75/85, 76/86 and 87/88 figures are not the latest milestone result. |
| Targeted evidence | Lazy REVOKED 14/14; hotfix custody 41/41; withdrawal binding 71/71; readiness 27/27; master SSR 27/27. Accepted hotfix pins are applied, not still proposed. |
| Build/custody | Recorded build check exit code 0; packed Head remains 14,874 characters. This is not proof of Wix's actual Custom Code normalization/limit behavior. Raw and LF-canonical hashes differ legitimately; do not mistake newline normalization for a different candidate. |
| Toolchain limitation | Typing evidence uses published `wix-fetch.d.ts` from `corvid-types 0.4.454`, last modified in **2023**. Its match to current hosted Wix typing is unverified. |

Sources: [R2 §§4–8; A E11 and OWNER-REPORT CAVEATS]. Results are recorded execution evidence, not newly executed tests in this reporting task.

## 5. Privacy, SSR and hosted-runtime limits

- **Narrow lazy-REVOKED guarantee:** a REVOKED-read failure latches closed, persistently for that copy. A **KEY-only** failure when the marker is absent and readable remains eager-equivalent: open for reconciliation, no erasure while KEY is unreadable, erasure possible after recovery. It is not a universal “any storage failure stays closed” guarantee. Admission still requires the protocol checks. [R2 §§3, 8, FREEZE]
- **SSR residual:** import-time storage I/O is removed, but Summary's `onReady → initClickAttribution` can read REVOKED there if executed under SSR. Lazy initialization is not proof of no SSR storage access everywhere. [R2 §8; A OWNER-REPORT CAVEATS]
- **W19 transport limit:** an already enabled/admitted copy can continue serving in-session IDs if every revoke message is lost. Erasure requires delivered signals; offline models do not establish real Wix delivery/ordering, banner mapping or browser storage partitioning. Retained bytes in separate storage can remain unreadable until re-verification, revoke or expiry; unreadability is not erasure. [A §5, U6]
- Binding capacity is 16 copies per relay frame; refusal is a no-admission liveness limitation and capacity recovery depends on frame replacement. Suspension is sticky per copy, not globally guaranteed. The Ads form handoff is Head-consent gated, not privacy-binding gated. [A §5]
- Hosted checks remain necessary for banner/consent signals, Chromium/Safari/Firefox partitioning, copy lifecycle, postMessage order, flag proxy/latency, crypto failure and consent-to-erase behavior. Offline passing tests cannot settle these. [A U6, §7]

## 6. File/function inventory of the milestone

Paths below are relative to the **absolute candidate workspace in §1**, unless marked sibling. This is the decision-relevant change inventory; the complete manifests/diffs are indexed in [AI], [BI] and [R2 §7]. No bulk hash listing is needed to understand the scope.

| File(s) | Function/change and boundary |
|---|---|
| `velo/custom-code/google-tag-and-consent.source.html` and generated `google-tag-and-consent.html` | Head protocol, `aS` first-touch renewal, current-binding open checks and compact call-time wrappers. Source/packed files must stay paired. |
| `velo/custom-code/event-bridge-iframe.html` | Relay privacy-bind allowlist and copy-ID validation; coordinated protocol component. |
| `velo/public/clickAttribution.js` (`3a65c799`) | `fenceAttribution`, `waitAttribution`, `clearPageAttribution`, binding/open-channel behavior and r2 `closedPartition`/`storedRecord` latch ordering. |
| `velo/public/paidTouchState.js`; `velo/public/tracking.js` | `capturePaidTouch`; `clearClickIds`, `resolveTrackingFlags`, `enterHold`, `trackingHeld`. |
| `velo/backend/publicFlags.web.js` | `getPublicTrackingFlags`, minimal public tracking-flag endpoint. |
| `velo/masterPage.js`; `velo/page-booking-search.js`; `velo/page-booking-summary.js` | Flag/hold adapters; Summary removes client collection writes and carries capability for clear/Microsoft mark. |
| `velo/backend/bookingSummaryWriter.js` | Private `patch`, `patchSummaryRefresh`, `clearSummaryReporting`, `setSummaryFlag`, `setSummaryCancellation`, `mirrorSummaryDates`; no web-method export. |
| `velo/backend/bookingSummaryCapability.js` | `mintSummaryCapability`, `verifySummaryCapability`, `capabilityUnexpired`, `markMicrosoftConversionUploaded`. |
| `velo/backend/bookingSummaryReporting.web.js` | Clear-only `clearBookingSummaryReporting`. |
| `velo/backend/availability.web.js` | `updateBookingSummary` field patch; `createBooking` fresh capability mint; `issueBookingInvoice` date mirror. **No intake gate in this version.** Existing log/caller-number concerns remain. |
| `velo/backend/microsoftAdsConversions.web.js` | `recordMicrosoftBookingConversion` token detachment/server mark; admin retry field patch. Public upload authorization unchanged. |
| `velo/backend/googleAdsAttemptJournal.js`; `velo/backend/bookingCancellation.js` | Google single-field journal mark; cancellation patch. |
| `velo/backend/googleAdsConversions.web.js`; `dataManagerClient.web.js`; `hashUtils.web.js` | Unchanged versus base modulo line endings; no new import/matching/normalization fix claimed. |
| `tests/revoked-lazy-init.cjs`, `tests/booking-summary-security.cjs`, `tests/booking-summary-writer-races.cjs`, `tests/summary-patch-fake.cjs`, custody manifests and other repaired fixtures | Regression/race/negative controls and accepted source pins; faithful additive message-handler fixtures and typing/toolchain repairs. Full list in manifests, not a claim of hosted verification. |
| `docs/booking-summary-security.md` | Existing frozen documentation is **stale**: its HMAC-only authorization explanation overstates coverage. Elevation also occurs outside Summary HMAC paths. |
| **Sibling only:** `C:/Users/TomDe/AppData/Local/hermes/profiles/claude/work/intake-gate/velo/backend/bookingIntakeGate.js` and adapters | Limited entry/pre-insert and invoice gating plus Admin invoice split. Not integrated into this milestone. Any inclusion requires explicit integration and regression review. |

Sources: [A §4; B §§3.1–3.4, C-1–C-2; R2 §§2, 5, 7]. The older staging plan names O3 rather than r2 and must be updated before use. Historical claims that pins are pending, the intake gate is in the lineage, or all writers prevent restoration must not be carried into a release checklist.

## 7. Risk-staged recommendations — not implementation authorization

| Stage | Recommended decision/work | Gate before proceeding |
|---|---|---|
| **1. Security and containment review** | Prioritize captured public collection exposure; additional-room, invoice and Microsoft caller authorization; admin stale writes; possible PII logs and installed diagnostics. Refresh permissions/dependencies through approved read-only checks. Decide separate remediation scope. | No new fixes authorized here. No live guest-data probing. Do not flip permissions first. |
| **2. Build a coherent release candidate** | Resolve missing sibling integration; design reviewed intake containment and bounded drain, including direct-write bypass and insert/rollback authorization. Correct stale docs and rebase staging plan to exact candidate. Preserve frozen evidence separately. | A gate merge alone is insufficient. Timeouts or a quiet row list are not proof of quiescence. Full review/regression required after changes. |
| **3. Approved hosted staging** | Confirm exact dependencies: retain data 1.0.522 and review essentials 1.0.15 installation/transitives. Exercise full guest mint/page/refresh/flags/mirror/cancellation, negative controls and privacy matrix. | G2/G2b do not substitute for the full flow. Production essentials install is still pending in the evidence. |
| **4. Controlled production preparation and permission transition** | Back up/diff actual installed files, Head, relay, schema and permissions; verify touch fields, current suspension values, dependencies and switches. Coordinate Head save versus Velo publication to avoid skew. | Owner approval, reviewed containment, operational recovery and G3–G5 evidence. No runtime-proven restricted-access fallback exists. Permission restriction stays blocked until gates are met. |
| **5. Prove measurement outcomes** | Confirm action mapping and Ads UI terms/EC configuration; approved zero-egress email-attachment check; then an owner-controlled genuine ad-click booking with privacy-safe evidence of form timing, request receipt and processing/matching. Re-read diagnostics after processing delay. | Separate approvals; do not send fabricated conversions. Neither queued events, loader success nor a request ID alone proves attributed revenue or cleared warnings. |

The source validation plan suggests a 24–72-hour processing/diagnostic follow-up and a 24–48-hour permission-transition watch window; these are proposed observation windows, not guarantees. [A §§6–7; B §§5–6]

## 8. Source register and audit trail

All citations above use these absolute artifacts. Sections refer to source headings/identifiers, not inferred live state. Consolidated reports and inventories were read in full; source report hashes below were recomputed from raw bytes for this deliverable.

- **[A]** `C:/Users/TomDe/AppData/Local/hermes/profiles/claude/reports/final-deliverable/ADS-ATTRIBUTION-CONSOLIDATED.txt` — SHA-256 prefix **a628c1d4**. Especially §0, §1 F0–F7, §2 E1–E12, §3 U1–U14, §§4–8, addendum r2 and OWNER-REPORT CAVEATS (lines 383–391).
- **[B]** `C:/Users/TomDe/AppData/Local/hermes/profiles/claude/reports/final-deliverable/BOOKINGSUMMARY-ACCESS-CONSOLIDATED.txt` — **10f37019**. Especially §§2–5, §6, contradictions C-1–C-10, addendum r2 and OWNER-REPORT CAVEATS (lines 511–519).
- **[AI]** `C:/Users/TomDe/AppData/Local/hermes/profiles/claude/reports/final-deliverable/ADS-EVIDENCE-INVENTORY.txt` — sections A–D map underlying reports, runtime captures, candidate files and base blobs. Its section E embeds an **older** consolidated-report hash; use current [A] above instead.
- **[BI]** `C:/Users/TomDe/AppData/Local/hermes/profiles/claude/reports/final-deliverable/BOOKINGSUMMARY-EVIDENCE-INVENTORY.txt` — source/file inventory and Cross-checks; distinguishes raw working-tree bytes from LF Git blobs.
- **[R2]** `C:/Users/TomDe/AppData/Local/hermes/profiles/claude/reports/baseline-remediation/r2/REPORT-R2.txt` — **a6e51218**; §§1–3 correction/guarantee, §§4–6 tests, §7 custody, §8 residuals and FREEZE offline acceptance.
- **Latest parsed results:** `C:/Users/TomDe/AppData/Local/hermes/profiles/claude/reports/baseline-remediation/r2/candidate-r2-rerun.json` — `count` and `results`; earlier run: `C:/Users/TomDe/AppData/Local/hermes/profiles/claude/reports/baseline-remediation/r2/candidate-r2.json`; comparison: `C:/Users/TomDe/AppData/Local/hermes/profiles/claude/reports/baseline-remediation/r2/comparison-r2.json` — `classification` and `counts`.
- **Historical permission capture:** `C:/Users/TomDe/AppData/Local/hermes/profiles/ric/marketing-reference/google-ads/intake-production-preflight/persisted-permissions-api.json` — capture provenance and operation mapping summarized in [B §2.1]; not refreshed for this report.
- **Staging scope:** `C:/Users/TomDe/AppData/Local/hermes/profiles/claude/reports/bookingsummary-security/round4/data-1.0.522-compat/G2B-EVIDENCE-REVIEW.txt` — clear-function integration and scope limits, summarized in [A F3; B C2–C4].

**Completion boundary:** the report explains identified attribution defects, isolated fixes and the BookingSummary access redesign with its residual risks. Offline acceptance is complete; integration, containment, hosted validation, permission changes, publication and verified Ads outcomes are not.
