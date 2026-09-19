# Master-page browser-only tracking deployment

## Scope

Install **only `velo/masterPage.js`** into Wix's site-wide `masterPage.js`, after independent review and GitHub delivery. Save, then Publish. Do not restore older site code or replace Public modules, backend Settings, Head custom code, iframe HTML, packages, or other pages for this fix.

The existing Velo API is a synchronous property: [`wixWindowFrontend.rendering.env`](https://dev.wix.com/docs/velo/apis/wix-window-frontend/rendering/env). Only `browser` enters initialization; `backend` and unknown values do not. No new SDK package is required.

Browser startup still awaits Settings and preserves the current suspension/fallback behavior. The attribution handshake runs in a caught background Promise chain; capture follows successful handshake settlement, not onReady completion. Rejection skips capture. The independent consent observer starts without waiting for the handshake. Tracking's existing permission checks remain authoritative.

## Published-site verification (not performed by local tests)

1. After Save and Publish, open fresh direct requests to Home and Offers, not just client-side navigation. Record published revision, route, response status and original HTML.
2. In each original response source, verify the relevant Wix `clientSideRender` value is `false` and the expected Stylable stylesheet metadata is present. Compare the header/menu styling with its expected appearance. Do not use the hydrated DOM alone as SSR evidence.
3. Check normal browser tracking initialization and consent observation; delayed iframe readiness must not block page startup. Keep existing consent/suspension settings unchanged; do not manufacture paid-ad clicks.
4. Visit the normal booking path to confirm navigation/rendering without confirming a booking or creating a reservation. Any pre-existing Summary invalid-target problem remains outside this change.
5. If SSR fallback or styling problems remain, preserve original response evidence for Wix Support. Do not broaden this fix or roll back unrelated work without a separate decision.

Wix Preview never renders server-side. Local native-VM tests establish branch/order/error handling and inert import behavior, **not the hosted SSR budget**, full-page Stylable recovery, or a fix for HTTP 504 errors.

## Local regression

```sh
node --experimental-vm-modules --test tests/master-page-ssr.test.cjs
node --experimental-vm-modules --test tests/click-attribution-corrections.cjs tests/click-attribution-readiness.cjs tests/click-attribution-readiness-review.cjs
```

Use the existing lockfile dependencies (`npm ci --offline --ignore-scripts --no-audit --no-fund` when cached). No package manifest or lockfile changes are part of this release. Node's VM Modules experimental warning is expected.
