# MasterPage browser-readiness detachment

Source-only candidate; independent review and reviewed GitHub delivery are required before installation. Not installed or published.

The synchronous browser-only onReady wrapper launches optional initialization without returning its promise. Settings still settles before suspension, tracking and attribution initialization. Capture still follows handshake settlement; consent observation remains independent of the handshake, after Settings. Existing Settings-error fallback is unchanged. This removes an optional readiness dependency, not a guaranteed first-paint delay or a proven 504 repair.

## Owner installation, when ready

1. After independent review and GitHub delivery, use the reviewed `velo/masterPage.js` file only.
2. In Wix Editor, inspect unrelated unpublished changes before proceeding. Paste the complete file into **MasterPage** site-wide code, then **Save**.
3. **Publish** only when the owner is ready and any unrelated drafts have been approved for publication.
4. Check fresh direct-entry Home and Offers pages, desktop/mobile menus, browser console, and tracking/consent behavior. Preview alone does not verify SSR. No booking submission is required for this narrow check.

No Head/custom-code, Public, backend, collections, packages, CSS or design changes are needed. Do not paste the test file. Rollback is the prior reviewed MasterPage source, followed by owner Save/Publish; do not alter consent defaults or suspension settings.

Local source tests establish callback return and dependency ordering only. They do not establish hosted visual paint timing, live channel completion, Google Ads recovery or booking correctness.
