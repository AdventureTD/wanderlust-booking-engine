// masterPage.js (site-wide Velo file)
// Captures Google Ads click identifiers on every page and persists them so
// they survive cross-page navigation until the visitor books.
// Also bridges Wix's cookie-consent state to the Google tag's Consent Mode:
// when the visitor accepts the Wix cookie banner, we fire the custom
// 'wbeConsentGranted' DOM event that custom-code/google-tag-and-consent.html
// listens for, upgrading consent from denied → granted (enables remarketing).

import { captureClickIds } from 'public/tracking';
import { consentPolicy } from 'wix-window-frontend';
import { local } from 'wix-storage-frontend';

const CONSENT_FLAG = 'wbe_consent_granted';

// Velo's sandbox blocks DOM event dispatch, so we flag localStorage instead;
// the head custom code watches this key and upgrades Google Consent Mode.
function fireConsentGranted() {
  try {
    local.setItem(CONSENT_FLAG, new Date().toISOString());
    console.log('[WBE-CONSENT] consent flag set (wbe_consent_granted)');
  } catch (e) {
    console.error('[WBE-CONSENT] flag write failed:', e && e.message || e);
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
      fireConsentGranted();
      return;
    }

    // 2. Watch for changes — fires when the visitor clicks Accept on the banner.
    if (typeof consentPolicy.onConsentPolicyChanged === 'function') {
      consentPolicy.onConsentPolicyChanged(function (event) {
        const p = event && (event.policy || (event.detail && event.detail.policy));
        console.log('[WBE-CONSENT] policy changed:', JSON.stringify(p));
        if (policyAllowsAds(p)) fireConsentGranted();
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
