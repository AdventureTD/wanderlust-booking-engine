# Wix attribution draft preparation — verified status

> Historical preparation checkpoint. Subsequent approval added and verified the two Object fields and enabled read-only Preview checks. The earlier missing-schema and zero-marker observations below are superseded by [schema and Preview findings](wix-attribution-schema-preview-status.md). Head activation and publication remain pending.

## Saved in the editor, NOT published

Site: `14f74eb6-ba7d-4c80-aa74-7886cb2babfb` (Wanderlust Caribbean).

Following Tom's editor-preparation approval, the existing Chrome session was used without restarting the browser. Relevant editor sources were backed up before replacement. Eight Velo files were saved and verified again after a full editor reload:

- `public/paidTouchState.js` — newly created.
- `backend/publicFlags.web.js` — newly created, read-only.
- `public/clickAttribution.js`
- `public/tracking.js`
- `public/pages/masterPage.js`
- Booking Search (`public/pages/z6bea.js`)
- Booking Summary (`public/pages/f04do.js`)
- `backend/availability.web.js` — the existing GitHub-baseline first/latest reporting code was not yet in the editor; see scope clarification below.

The `wbeEventBridge` component's HTML was backed up, replaced and reopened for exact readback. After saving and reloading the editor, its loaded iframe script also matched the candidate. Wix displayed **Your changes are saved**. The loaded Monaco models reported no severity-4/8 warning/error markers; this is **not** proof of a hosted publish build or an end-to-end runtime test. No Run, Preview, Publish, real booking or provider send was invoked.

## Crucial correction to the repository-only inventory

The earlier report's “35 existing backend files unchanged” was relative to Git baseline `2b946df`, NOT the editor. Fresh inspection found the editor predates the first/latest-touch reporting support already in that baseline. Its `availability.web.js` differed only in that reporting support. Copying the tested baseline version into the draft adds allowlisted/detached `firstPaidTouch` and `latestPaidTouch` reporting and their preservation/clear behavior. It does not introduce the deferred Summary capability/writer/security modules, change permissions, or redesign booking allocation.

The Search source matched the repository baseline. Summary differences beyond the new flag adapter were existing attribution reporting and value-free diagnostic changes already in the tested candidate. Public tracking and click-attribution sources were older. Phone normalization, Settings and masterPage had only trailing-newline differences where noted. The direct Google importer and private Google attempt journal matched the baseline and were left untouched.

## Publication prerequisites — not completed or silently waived

1. **Head snippet is still the existing active version.** The existing `google-tag-and-consent` entry was opened read-only and backed up (14,893 characters). Its settings are Head / All pages / Load code once / Essential. It differs from the tested 14,874-character candidate. The dialog was cancelled without editing or Apply. No proven draft-only save path exists in this dashboard UI; treat Apply as live activation. It must be coordinated with publication of the saved iframe/Velo set, never presented as already updated.
2. **First/latest reporting fields are absent from the inspected BookingSummary schema tree.** Neither `firstPaidTouch` nor `latestPaidTouch` appears. Do not assume undeclared fields are a validated production schema. Before publishing this reporting version, explicitly provision/verify the two Object fields, or revise/test a different agreed reporting scope. No collection field or permission was changed during this editor work; no guest records were opened. Adding fields is distinct from the deferred collection-security redesign, but changes live CMS metadata and is not hidden inside a code-only draft save.
3. **Hosted verification remains pending.** No compile/publish build, real CMP/banner-to-worker delivery, method-proxy execution, real conversion processing/matching, or Enhanced Conversions warning resolution was established. A controlled test-site plan and explicit publication/real-send authorization remain necessary.

## Dependencies and backups

The editor package list shows `libphonenumber-js 1.13.13` and `@wix/data 1.0.522`; neither was installed or upgraded. The new public flag endpoint uses built-in Wix APIs. Offline type definitions are not a substitute for hosted verification.

Local exact backups and evidence:
`C:/Users/TomDe/AppData/Local/hermes/profiles/ric/marketing-reference/google-ads/editor-backups/20261017T110910Z/`

Files include original-source `manifest.json`, baseline diffs, `applied-models.json`, `reload-verification.json`, `event-bridge-before.html`, `event-bridge-after.html`, `head-before.html`, and the metadata-only `booking-summary-field-inventory.json`. Source backups remain local, not an indiscriminate upload of editor content.

## Safety boundary

Do **not publish the editor by itself**: its new protocol set must be coordinated with the matching Head snippet, and the reporting schema must be resolved first. The current saved editor is a staged preparation state, not release completion. The live site's code and dashboard Head were not changed by this operation. Existing collection-security exposure remains; this draft does not fix it.
