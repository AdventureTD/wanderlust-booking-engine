// masterPage.js (site-wide Velo file)
// Captures Google Ads click identifiers on every page and persists them so
// they survive cross-page navigation until the visitor books.
// Also bridges Wix's cookie-consent state to the Google tag's Consent Mode:
// when the visitor accepts the Wix cookie banner, we fire the custom
// 'wbeConsentGranted' DOM event that custom-code/google-tag-and-consent.html
// listens for, upgrading consent from denied → granted (enables remarketing).

import { captureClickIds, initTracking, setSuspendGoogleAds } from 'public/tracking';
import { getAllSettings } from 'backend/settings';
import { consentPolicy, rendering } from 'wix-window-frontend';
import { local } from 'wix-storage-frontend';
import { createGuestConsentBrowserContext, withdrawGuestConsentBrowser, readGuestConsentBrowserNegative } from 'backend/guestConsent.web';

// Separate from analytics and booking initialization. Custody is not HttpOnly,
// human identity, or cross-tab atomic storage. UI/topology remain activation gates.
const NEGATIVE_KEY = 'wbe_browser_negative_v1';
const browserToken = value => typeof value === 'string' && value.length === 134 && /^wcn1\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value);
let negativeCustody = { token: null, negative: false };
let custodyRaw = null, withdrawalFlight = null, withdrawalEpoch = 0;
function feedback(text) {
  try { $w('#consentWithdrawalStatus').text = text; } catch (_) { /* Optional UI. */ }
}
function localDenial() {
  try { $w('#wbeEventBridge').postMessage({ type: 'wbe-consent-deny', version: 1 }); } catch (_) { /* Still attempt server withdrawal. */ }
}
function refreshCustody() {
  try {
    const raw = local.getItem(NEGATIVE_KEY);
    if (raw !== custodyRaw) {
      let saved;
      try { saved = JSON.parse(raw); } catch (_) {}
      negativeCustody = { token: saved && browserToken(saved.token) ? saved.token : null,
        negative: negativeCustody.negative || !!(saved && saved.negative === true) };
      custodyRaw = raw;
    }
  } catch (_) { /* Keep in-memory custody and negative intent. */ }
}
function saveCustody() {
  try {
    const raw = JSON.stringify(negativeCustody);
    local.setItem(NEGATIVE_KEY, raw);
    custodyRaw = raw;
  } catch (_) { /* Explicit retry can still reuse the in-memory token. */ }
}
async function consentWait(invoke) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(invoke), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Unavailable')), 12000);
    })]);
  } finally { clearTimeout(timer); }
}
function pendingFeedback() {
  feedback('Withdrawal requested; server confirmation pending. Local denial delivery is not verified. If browser custody was lost, prior identity cannot be recovered here.');
}
async function performWithdrawal() {
  const epoch = ++withdrawalEpoch;
  refreshCustody();
  negativeCustody.negative = true;
  saveCustody();
  localDenial(); // Suppression request first; posting is not delivery proof.
  pendingFeedback();
  let token = negativeCustody.token;
  try {
    if (!token) {
      const issuingRaw = custodyRaw;
      const result = await consentWait(() => createGuestConsentBrowserContext());
      if (!result || result.status !== 'CREATED' || !browserToken(result.token)) return;
      refreshCustody();
      // Never overwrite custody replaced/cleared by another context mid-issuance.
      if (custodyRaw !== issuingRaw || negativeCustody.token !== token || epoch !== withdrawalEpoch) return;
      token = result.token;
      negativeCustody.token = token;
      saveCustody();
    }
    const result = await consentWait(() => withdrawGuestConsentBrowser(token));
    refreshCustody();
    if (epoch !== withdrawalEpoch || negativeCustody.token !== token) { pendingFeedback(); return; }
    if (result && result.status === 'RECORDED') {
      feedback('Server withdrawal recorded for this browser context. Local denial delivery is not verified.');
    }
  } catch (_) { /* Retain pending and same-token explicit retry; no error echo. */ }
}
$w.onReady(function () {
  if (rendering.env !== 'browser') return;
  refreshCustody();
  try {
    $w('#btnWithdrawAdvertising').onClick(function () {
      if (!withdrawalFlight) withdrawalFlight = performWithdrawal().finally(() => { withdrawalFlight = null; });
      return withdrawalFlight;
    });
  } catch (_) { /* Missing proposed control cannot break booking. */ }
  if (negativeCustody.negative) { localDenial(); pendingFeedback(); }
  const token = negativeCustody.token, epoch = withdrawalEpoch;
  if (token) {
    consentWait(() => readGuestConsentBrowserNegative(token)).then(result => {
      refreshCustody();
      if (epoch !== withdrawalEpoch || negativeCustody.token !== token) return;
      if (result && result.status === 'WITHDRAWN') {
        negativeCustody.negative = true; saveCustody(); localDenial();
        feedback('Server withdrawal observed for this browser context. Local denial delivery is not verified.');
      }
    }).catch(() => {});
  }
});

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

$w.onReady(async function () {
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
    console.log('[WBE-MASTER] captureClickIds started');
    const ids = captureClickIds();
    console.log('[WBE-MASTER] captureClickIds result:', JSON.stringify(ids));
    initConsentBridge();
  } catch (err) {
    console.error('[WBE-MASTER] error:', err && err.message || err);
  }
});
