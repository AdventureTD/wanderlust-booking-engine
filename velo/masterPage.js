// masterPage.js (site-wide Velo file)
// Captures Google Ads click identifiers on every page and persists them so
// they survive cross-page navigation until the visitor books.
// Also bridges Wix's cookie-consent state to the Google tag's Consent Mode:
// when the visitor accepts the Wix cookie banner, we fire the custom
// 'wbeConsentGranted' DOM event that custom-code/google-tag-and-consent.html
// listens for, upgrading consent from denied → granted (enables remarketing).

import { captureClickIds, initTracking } from 'public/tracking';
import { consentPolicy } from 'wix-window-frontend';

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
  initTracking($w);
  console.log('[WBE-MASTER] captureClickIds started');
  const ids = captureClickIds();
  console.log('[WBE-MASTER] captureClickIds result:', JSON.stringify(ids));
  initConsentBridge();
});
