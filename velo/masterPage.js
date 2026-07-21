// masterPage.js (site-wide Velo file)
// Captures Google Ads click identifiers on every page and persists them so
// they survive cross-page navigation until the visitor books.
// Also bridges Wix's cookie-consent state to the Google tag's Consent Mode:
// when the visitor accepts the Wix cookie banner, we fire the custom
// 'wbeConsentGranted' DOM event that custom-code/google-tag-and-consent.html
// listens for, upgrading consent from denied → granted (enables remarketing).

import { captureClickIds } from 'public/tracking';
import { consentPolicy } from 'wix-window-frontend';

// wix-storage-frontend 'local' is partitioned from the page's localStorage, and
// DOM event dispatch is sandboxed — so we postMessage the page's window, which
// IS shared between the Velo worker and the head custom code.
function fireConsentGranted(policy) {
  try {
    if (typeof window !== 'undefined' && window.postMessage) {
      const msg = {
        type: 'wbeConsentGranted',
        at: new Date().toISOString(),
        analytics: !!(policy && policy.analytics),
        advertising: !!(policy && policy.advertising),
      };
      // Broadcast a few times so the head script receives it even if its
      // message listener wasn't attached yet when we first fire.
      window.postMessage(msg, '*');
      setTimeout(function () { window.postMessage(msg, '*'); }, 500);
      setTimeout(function () { window.postMessage(msg, '*'); }, 1500);
      setTimeout(function () { window.postMessage(msg, '*'); }, 3000);
      console.log('[WBE-CONSENT] posted wbeConsentGranted to window:', JSON.stringify(msg));
    } else {
      console.error('[WBE-CONSENT] window.postMessage unavailable');
    }
  } catch (e) {
    console.error('[WBE-CONSENT] postMessage failed:', e && e.message || e);
  }
}

function policyAllowsAds(policy) {
  // Wix policy object: { essential: true, functional: bool, analytics: bool, advertising: bool }
  return !!(policy && (policy.advertising || policy.analytics));
}

async function initConsentBridge() {
  try {
    // 1. Current state — covers returning visitors who already accepted.
    const current = await consentPolicy.getCurrentConsentPolicy();
    console.log('[WBE-CONSENT] current policy:', JSON.stringify(current && current.policy));
    if (policyAllowsAds(current && current.policy)) {
      fireConsentGranted(current.policy);
      return;
    }

    // 2. Watch for changes — fires when the visitor clicks Accept on the banner.
    if (typeof consentPolicy.onConsentPolicyChanged === 'function') {
      consentPolicy.onConsentPolicyChanged(function (event) {
        const p = event && (event.policy || (event.detail && event.detail.policy));
        console.log('[WBE-CONSENT] policy changed:', JSON.stringify(p));
        if (policyAllowsAds(p)) fireConsentGranted(p);
      });
    }
  } catch (e) {
    console.error('[WBE-CONSENT] bridge init failed:', e && e.message || e);
  }
}

$w.onReady(function () {
  console.log('[WBE-MASTER] captureClickIds started');
  const ids = captureClickIds();
  console.log('[WBE-MASTER] captureClickIds result:', JSON.stringify(ids));
  initConsentBridge();
});
