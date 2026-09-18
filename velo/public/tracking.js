// public/tracking.js
// Shared FRONT-END helper module (lives under "Public" in Velo).
// Captures Google Ads click IDs (gclid/gbraid/wbraid) from the landing URL,
// persists them across pages, and pushes dataLayer events for GA4 / Google Ads.

import { getAdsFormRequirement } from 'backend/adsFormRequirement.web';
import { local } from 'wix-storage-frontend';
import { initClickAttribution as initAttribution, waitForClickAttribution as waitAttribution, clearPageAttribution, attributionDenied, attributionRevision, suspendAttribution } from 'public/clickAttribution';
export function initClickAttribution(w) { initAttribution(w); }
export function waitForClickAttribution() { return waitAttribution(); }
import wixLocationFrontend from 'wix-location-frontend';

const STORAGE_KEY = 'wl_click_attribution';
const CLICK_PARAMS = ['gclid', 'gbraid', 'wbraid', 'msclkid'];
const ATTRIBUTION_WINDOW_DAYS = 90;

function parseUrlParams(url) {
  try {
    const out = {};
    const idx = (url || '').indexOf('?');
    if (idx === -1) { return out; }
    const qs = url.substring(idx + 1);
    const pairs = qs.split('&');
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : decodeURIComponent(pair.substring(0, eq));
      const value = eq === -1 ? '' : decodeURIComponent(pair.substring(eq + 1));
      out[key] = value;
    }
    return out;
  } catch (e) {
    return {};
  }
}

// Reads click IDs from URL query and stores them (first-touch wins).
export function captureClickIds() {
  try {
    if (_suspendGoogleAds || attributionDenied()) {
      console.log('[WBE-TRACKING] suspended — skipping click-id capture');
      return null;
    }
    // Wix's location API strips ad-click parameters from the URL in some cases,
    // so read the real browser URL first and use Wix data only as fallback.
    const rawBrowserUrl = (typeof window !== 'undefined' && window.location && window.location.href) || '';
    let query = parseUrlParams(rawBrowserUrl);



    // Fallback to Wix APIs if window.location is unavailable.
    if (!query.gclid && !query.gbraid && !query.wbraid && !query.msclkid) {
      query = wixLocationFrontend.query || {};

      if (!query.gclid && !query.gbraid && !query.wbraid && !query.msclkid) {
        query = parseUrlParams(wixLocationFrontend.url);

      }
    }

    const found = {};
    for (let i = 0; i < CLICK_PARAMS.length; i++) {
      const p = CLICK_PARAMS[i];
      if (typeof query[p] === 'string' && query[p].length <= 512 && /^[\x21-\x7e]+$/.test(query[p])) { found[p] = query[p]; }
    }



    if (Object.keys(found).length === 0) { return getStoredClickIds(); }

    const existing = getStoredClickIds();
    if (existing && (existing.gclid || existing.gbraid || existing.wbraid || existing.msclkid)) { return existing; }

    const record = {
      gclid: found.gclid || '',
      gbraid: found.gbraid || '',
      wbraid: found.wbraid || '',
      msclkid: found.msclkid || '',

      capturedAt: new Date().toISOString()
    };
    local.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  } catch (err) {
    console.error('captureClickIds failed:', err && err.message || err);
    return null;
  }
}

const attributionSnapshots = new WeakMap();
// No argument: legacy ID read. includeEmpty: capture policy-authorized contact-only
// work too. Passing that exact snapshot revalidates its original worker epoch;
// never substitute a later touch or reauthorize old work after reacceptance.
export function getStoredClickIds(snapshot, includeEmpty = false) {
  try {
    const raw = local.getItem(STORAGE_KEY);
    if (snapshot !== undefined) {
      if (attributionDenied()) return null;
      const saved = attributionSnapshots.get(snapshot);
      if (!saved || saved.revision !== attributionRevision() || saved.raw !== raw) return null;
      if (saved.raw && !getStoredClickIds()) return null;
      return snapshot;
    }
    if (!raw) {
      if (!includeEmpty || attributionDenied()) return null;
      const empty = Object.freeze({});
      attributionSnapshots.set(empty, { revision: attributionRevision(), raw });
      return empty;
    }
    const value = JSON.parse(raw);
    const at = value && typeof value.capturedAt === 'string' ? Date.parse(value.capturedAt) : NaN;
    const ageMs = Date.now() - at;
    const maxMs = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxMs ||
        !CLICK_PARAMS.every(k => value[k] === undefined || (typeof value[k] === 'string' && value[k].length <= 512 && (value[k] === '' || /^[\x21-\x7e]+$/.test(value[k]))))) {
      local.removeItem(STORAGE_KEY);
      return null;
    }
    if (attributionDenied()) return null;
    const record = { capturedAt: value.capturedAt };
    CLICK_PARAMS.forEach(k => { record[k] = value[k] || ''; });
    Object.freeze(record);
    attributionSnapshots.set(record, { revision: attributionRevision(), raw });
    return record;
  } catch (err) {
    console.error('getStoredClickIds failed:', err && err.message || err);
    return null;
  }
}

// Clears stored attribution after a successful conversion upload.
export function clearClickIds(snapshot) {
  return clearPageAttribution(snapshot);
}

// Push an event onto window.dataLayer for the Google tag to pick up.
// Velo's localStorage is partitioned from the page (proved null from console),
// so events go through the hidden wbeEventBridge HTML iframe on the Master
// Page: Velo -> iframe.postMessage -> parent window -> head snippet -> dataLayer.
// Public modules can't use the $w global, so page code injects it once.
let _$w = null;
let _suspendGoogleAds = false;

export function initTracking(w) { _$w = w; }

// Dedicated contact-free channel. Never put identifiers in generic event params.
let _adsFormSequence = 0, _adsFormPending = null;
// A read may outlive its deadline, but can never publish a late permission.
async function readAdsFormPolicy() {
  let timer;
  const started = Date.now();
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => getAdsFormRequirement()),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 750); })
    ]);
    const now = Date.now();
    if (!result || Object.keys(result).sort().join(',') !== 'observedAt,policyKey,requirement,v' ||
        result.v !== 1 || !['REQUIRED', 'NOT_REQUIRED'].includes(result.requirement) ||
        typeof result.policyKey !== 'string' || !/^[a-f0-9]{64}$/.test(result.policyKey) ||
        !Number.isSafeInteger(result.observedAt) || now < result.observedAt ||
        now - result.observedAt > 1500 || now < started || now - started >= 750) return null;
    return { v: 1, requirement: result.requirement, policyKey: result.policyKey, observedAt: result.observedAt };
  } catch (_) { return null; }
  finally { clearTimeout(timer); }
}
export function prepareAdsFormSubmission() {
  if (_suspendGoogleAds || !_$w) return 0;
  const sequence = ++_adsFormSequence;
  const pending = { sequence, completing: false, at: Date.now() };
  _adsFormPending = pending;
  try {
    _$w('#wbeEventBridge').postMessage({ type: 'wbe-ads-form', phase: 'begin', sequence, policy: null });
  } catch (_) { _adsFormPending = null; return 0; }
  pending.ready = (async () => {
    try {
      const policy = await readAdsFormPolicy();
      if (!policy || _adsFormPending !== pending || _suspendGoogleAds) return null;
      _$w('#wbeEventBridge').postMessage({ type: 'wbe-ads-form', phase: 'prepare', sequence, policy });
      return policy;
    } catch (_) { return null; }
  })();
  return sequence; // Booking never awaits optional Ads IO.
}
export function completeAdsFormSubmission(sequence) {
  const pending = _adsFormPending;
  if (!pending || pending.sequence !== sequence || pending.completing) return;
  pending.completing = true;
  void (async () => {
    try {
      const before = await pending.ready;
      if (!before || _adsFormPending !== pending || _suspendGoogleAds) return;
      const policy = await readAdsFormPolicy();
      if (!policy || _adsFormPending !== pending || _suspendGoogleAds ||
          policy.policyKey !== before.policyKey || policy.requirement !== before.requirement ||
          Date.now() < pending.at || Date.now() - pending.at > 600000) return;
      _$w('#wbeEventBridge').postMessage({ type: 'wbe-ads-form', phase: 'complete', sequence, policy });
    } catch (_) { /* No reservation dependency, no retry or contact/error logging. */ }
    finally { if (_adsFormPending === pending) _adsFormPending = null; }
  })();
}

export function setSuspendGoogleAds(value) {
  suspendAttribution(value);
  _suspendGoogleAds = !!value;
  if (_suspendGoogleAds) _adsFormPending = null;
  console.log('[WBE-TRACKING] Google Ads / Analytics suspended:', _suspendGoogleAds);
}

export function pushDataLayer(payload) {
  try {
    if (_suspendGoogleAds) {
      console.log('[WBE-TRACKING] suspended — dropping event:', payload.event || payload);
      return;
    }
    if (!_$w) {
      console.warn('[WBE-GTAG] initTracking($w) not called; dropping event:', payload.event || payload);
      return;
    }
    const bridge = _$w('#wbeEventBridge');
    bridge.postMessage({ type: 'wbe-datalayer-event', payload: payload });
    console.log('[WBE-GTAG] sent event to bridge:', payload.event || payload);
  } catch (err) {
    console.error('[WBE-GTAG] bridge send failed:', err && err.message || err);
  }
}

// Fires when a visitor begins the booking funnel.
export function trackBeginBooking(details) {
  const d = details || {};
  const payload = {
    event: 'begin_booking',
    currency: d.currency || 'USD'
  };
  if (d.value) { payload.value = d.value; }
  if (d.checkIn) { payload.check_in = d.checkIn; }
  if (d.checkOut) { payload.check_out = d.checkOut; }
  if (d.nights) { payload.nights = d.nights; }
  if (d.guests) { payload.guests = d.guests; }
  pushDataLayer(payload);
}

// Fires when the booking search page loads — top-of-funnel audience pool.
export function trackViewBookingSearch() {
  pushDataLayer({ event: 'view_booking_search' });
}

// Fires once per room shown in search results — room-level interest signal.
export function trackRoomView(details) {
  const d = details || {};
  const payload = { event: 'room_view' };
  if (d.roomCode) { payload.room_code = d.roomCode; }
  if (d.nights) { payload.nights = d.nights; }
  pushDataLayer(payload);
}

// Fires when a search returns zero availability — high-intent visitor who hit
// a wall; prime audience for "dates freed up" remarketing.
export function trackSearchNoResults(details) {
  const d = details || {};
  const payload = { event: 'search_no_results' };
  if (d.nights) { payload.nights = d.nights; }
  if (d.checkIn) { payload.check_in = d.checkIn; }
  pushDataLayer(payload);
}

// Fires on confirmed booking (client-side signal).
export function trackPurchase(booking) {
  const payload = {
    event: 'purchase',
    transaction_id: booking.transactionId,
    value: booking.value,
    currency: booking.currency || 'USD'
  };
  if (booking.items && booking.items.length > 0) {
    payload.items = booking.items;
  }
  pushDataLayer(payload);
}
