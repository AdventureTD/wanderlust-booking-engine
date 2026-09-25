// masterPage.js (site-wide Velo file)
// Captures Google Ads click identifiers on every page and persists them so
// they survive cross-page navigation until the visitor books.
// Also bridges Wix's cookie-consent state to the Google tag's Consent Mode:
// when the visitor accepts the Wix cookie banner, we fire the custom
// 'wbeConsentGranted' DOM event that custom-code/google-tag-and-consent.html
// listens for, upgrading consent from denied → granted (enables remarketing).

import { captureClickIds, initTracking, setSuspendGoogleAds, initClickAttribution, waitForClickAttribution } from 'public/tracking';
import { getAllSettings } from 'backend/settings';
import wixWindowFrontend, { consentPolicy } from 'wix-window-frontend';

// Velo's worker sandbox blocks every bridge to the page context (DOM events,
// window.postMessage, and wix-storage's partitioned localStorage). Consent is
// therefore upgraded by the head custom code watching the CMP's own dataLayer
// events; this watcher stays for visibility/logging of the policy state.
function policyAllowsAds(policy) {
  // Wix policy object: { essential: true, functional: bool, analytics: bool, advertising: bool }
  return !!(policy && (policy.advertising || policy.analytics));
}

async function initConsentBridge() {
  try {
    // 1. Current state — covers returning visitors who already accepted.
    const current = await consentPolicy.getCurrentConsentPolicy();
    console.log('[WBE-CONSENT] current policy:', JSON.stringify(current && current.policy));

    // Watch for changes — fires when the visitor clicks Accept on the banner.
    // The head custom code independently upgrades Google consent from the CMP's
    // own dataLayer events, so this is purely observational.
    if (typeof consentPolicy.onConsentPolicyChanged === 'function') {
      consentPolicy.onConsentPolicyChanged(function (event) {
        const p = event && (event.policy || (event.detail && event.detail.policy));
        console.log('[WBE-CONSENT] policy changed:', JSON.stringify(p), '| allowsAds:', policyAllowsAds(p));
      });
    }
  } catch (e) {
    console.error('[WBE-CONSENT] bridge init failed:', e && e.message || e);
  }
}

$w.onReady(function () {
  try {
    // HTML-component tracking is browser-only; keep it out of Wix's SSR budget.
    if (wixWindowFrontend.rendering.env !== 'browser') return;
    // Optional Settings and tracking must not hold browser readiness.
    void initBrowserTracking();
  } catch (err) {
    console.error('[WBE-MASTER] error:', err && err.message || err);
  }
});

async function initBrowserTracking() {
  try {
    let settings = {};
    try { settings = await getAllSettings(); } catch (e) {}
    const suspend = String(settings.suspendGoogleAds).trim() === '1' || Number(settings.suspendGoogleAds) === 1;
    if (typeof setSuspendGoogleAds === 'function') {
      setSuspendGoogleAds(suspend);
    } else {
      console.log('[WBE-MASTER] setSuspendGoogleAds import not ready, suspend defaults to false');
    }

    initTracking($w);
    initClickAttribution($w);
    // Do not hold onReady (or the consent observer) for the iframe handshake.
    // Capture still follows settlement; contain both wait and capture failures.
    Promise.resolve().then(() => waitForClickAttribution()).then(() => {
      console.log('[WBE-MASTER] captureClickIds started');
      return captureClickIds();
    }).catch(err => {
      console.error('[WBE-MASTER] error:', err && err.message || err);
    });

    initConsentBridge();
  } catch (err) {
    console.error('[WBE-MASTER] error:', err && err.message || err);
  }
}
