// public/tracking.js
// Shared FRONT-END helper module (lives under "Public" in Velo).
// Captures Google Ads click IDs (gclid/gbraid/wbraid) from the landing URL,
// persists them across pages, and pushes dataLayer events for GA4 / Google Ads.

import { getAdsFormRequirement } from 'backend/adsFormRequirement.web';
import { localBudget, remainingBudget, closeBudget, monotonicNow, freshPolicyNonce, policyRequest, validPolicy, withinBudget } from 'public/adsPolicyProtocol';
import { local } from 'wix-storage-frontend';
import { normalizePaidTouches } from 'public/paidTouchState';
import { initClickAttribution as initAttribution, waitForClickAttribution as waitAttribution, clearPageAttribution, attributionDenied, attributionRevision, attributionStorageAdmitted, suspendAttribution, fenceAttribution } from 'public/clickAttribution';
export function initClickAttribution(w) { initAttribution(w); }
// Readiness never runs while flags are held or suspended: no channel, read,
// confirm or erase on behalf of an unresolved flag (non-destructive hold).
export function waitForClickAttribution() {
  if (trackingHeld() || _suspendGoogleAds) return Promise.resolve();
  return waitAttribution();
}

// Public tracking flags. Initial state is a NON-DESTRUCTIVE hold: sends, the Ads
// form path, attribution readiness and stored-ID reads are blocked, but nothing
// is revoked, erased or written. Only a current-generation, exactly-shaped
// {ok:true, suspendGoogleAds:false} enables. A valid suspension from ANY
// generation is sticky for this module instance (no re-enable this session) and
// uses the existing destructive suspension. Anything else (ok:false, malformed,
// rejection, timeout) keeps or returns the hold. A response after its own
// timeout is ignored entirely. Controls only consumers wired through this module.
export const TRACKING_FLAG_TIMEOUT_MS = 3000;
let _flagState = 'hold', _flagGeneration = 0;
export function trackingFlagState() { return _flagState; }
function trackingHeld() { return _flagState !== 'enabled'; }
// Entering (or re-entering) the hold is NON-DESTRUCTIVE but fences in-flight work:
// fenceAttribution cancels late readiness wakes and bumps the attribution revision
// so an already-running readiness cannot store/admit after its awaits (existing
// B2/B4 supersession checks), and any pending Ads form continuation is dropped.
// No revoke, erase, closePartition or consent inference; clears stay exempt.
function enterHold() {
  if (_flagState === 'suspended') return;
  _flagState = 'hold';
  _adsFormPending = null;
  fenceAttribution();
}
function validTrackingFlags(r) {
  return !!r && typeof r === 'object' && !Array.isArray(r) &&
    Object.keys(r).sort().join(',') === 'ok,suspendGoogleAds' &&
    r.ok === true && typeof r.suspendGoogleAds === 'boolean';
}
function applyTrackingFlags(r, generation) {
  if (_flagState === 'suspended') return;
  if (!validTrackingFlags(r)) { enterHold(); return; }
  if (r.suspendGoogleAds) { _flagState = 'suspended'; setSuspendGoogleAds(true); return; }
  if (generation === _flagGeneration) _flagState = 'enabled';
}
export function resolveTrackingFlags(getter) {
  const generation = ++_flagGeneration;
  enterHold(); // A new read holds consumers synchronously until it resolves.
  return new Promise(resolve => {
    let settled = false, timer = null;
    const settle = () => { if (settled) return false; settled = true; clearTimeout(timer); return true; };
    timer = setTimeout(() => { if (settle()) { enterHold(); resolve(_flagState); } }, TRACKING_FLAG_TIMEOUT_MS);
    let call;
    try { call = Promise.resolve(typeof getter === 'function' ? getter() : null); }
    catch (_) { call = Promise.resolve(null); }
    call.then(r => {
      if (!settle()) return; // Late after its own timeout: ignored entirely.
      applyTrackingFlags(r, generation);
      resolve(_flagState);
    }, () => { if (settle()) { enterHold(); resolve(_flagState); } });
  });
}


const STORAGE_KEY = 'wl_click_attribution';
const CLICK_PARAMS = ['gclid', 'gbraid', 'wbraid', 'msclkid'];


// Only the bound Head handshake captures identifiers; worker URLs are not authority.
export function captureClickIds() { return getStoredClickIds(); }

const attributionSnapshots = new WeakMap();
// No argument: legacy ID read. includeEmpty: capture policy-authorized contact-only
// work too. Passing that exact snapshot revalidates its original worker epoch;
// never substitute a later touch or reauthorize old work after reacceptance.
export function getStoredClickIds(snapshot, includeEmpty = false) {
  if (trackingHeld()) return null; // Held: no read-side erase or snapshot.
  try {
    const raw = local.getItem(STORAGE_KEY);
    if (snapshot !== undefined) {
      if (attributionDenied() || !attributionStorageAdmitted(raw)) return null;
      const saved = attributionSnapshots.get(snapshot);
      if (!saved || saved.revision !== attributionRevision() || saved.raw !== raw) return null;
      if (saved.raw) {
        const current = getStoredClickIds();
        if (!current || JSON.stringify(current.paidTouches) !== JSON.stringify(snapshot.paidTouches)) return null;
      }
      return snapshot;
    }
    if (!raw) {
      if (!includeEmpty || attributionDenied() || !attributionStorageAdmitted(raw)) return null;
      const empty = Object.freeze({});
      attributionSnapshots.set(empty, { revision: attributionRevision(), raw });
      return empty;
    }
    const state = normalizePaidTouches(JSON.parse(raw), Date.now());
    if (!state) { local.removeItem(STORAGE_KEY); return null; }
    if (attributionDenied() || !attributionStorageAdmitted(raw)) return null;
    if (state.first) Object.freeze(state.first);
    Object.freeze(state.latest); Object.freeze(state);
    const record = { capturedAt: state.first ? state.first.capturedAt : '', paidTouches: state };
    CLICK_PARAMS.forEach(k => { record[k] = state.first ? state.first[k] : ''; });
    Object.freeze(record);
    attributionSnapshots.set(record, { revision: attributionRevision(), raw });
    return record;
  } catch (err) {
    console.error('ATTR_STORAGE_READ_FAILED');
    return null;
  }
}

// Clears stored attribution after a successful conversion upload.
export function clearClickIds(snapshot) {
  // A late upload completion after withdrawal cannot recreate a private retry
  // copy or open a fresh permission channel. Internal pending-clear recovery
  // stays in clickAttribution and does not pass this public capture boundary.
  if (attributionDenied()) { fenceAttribution(); return; }
  if (snapshot !== undefined) {
    const saved = attributionSnapshots.get(snapshot);
    if (!saved || saved.revision !== attributionRevision()) return;
  }
  return clearPageAttribution(snapshot);
}

// Push an event onto window.dataLayer for the Google tag to pick up.
// Velo's localStorage is partitioned from the page (proved null from console),
// so events go through the hidden wbeEventBridge HTML iframe on the Master
// Page: Velo -> iframe.postMessage -> parent window -> head snippet -> dataLayer.
// Public modules can't use the $w global, so page code injects it once.
let _$w = null;
let _suspendGoogleAds = false;

export function initTracking(w) {
  _$w = w;
  try {
    const bridge = w('#wbeEventBridge');
    if (_adsFormBridge === bridge) return;
    _adsFormBridge = bridge;
    bridge.onMessage(event => {
      const d = event && event.data, wait = _adsFormAck;
      if (!wait || bridge !== _adsFormBridge || !d ||
          Object.keys(d).sort().join(',') !== 'challenge,nonce,phase,sequence,type,v' ||
          d.type !== 'wbe-ads-form-started' || d.v !== 2 || d.sequence !== wait.sequence ||
          d.phase !== wait.phase || d.nonce !== wait.nonce ||
          typeof d.challenge !== 'string' || !/^[a-f0-9]{32}$/.test(d.challenge)) return;
      _adsFormAck = null;
      wait.resolve(d);
    });
  } catch (_) { _adsFormBridge = null; }
}

// Dedicated contact-free channel. Never put identifiers in generic event params.
let _adsFormSequence = 0, _adsFormPending = null, _adsFormBridge = null, _adsFormAck = null;
// Each phase owns a worker-local lease and waits for a Head-local start ACK.
// Completion does not replace the Head's original email/consent revision.
async function readAdsFormPolicy(pending, phase) {
  const budget = localBudget(1500), nonce = freshPolicyNonce();
  let wait;
  try {
    if (!nonce || !_adsFormBridge || !remainingBudget(budget)) return null;
    const ack = await withinBudget(() => new Promise(resolve => {
      wait = { sequence: pending.sequence, phase, nonce, resolve };
      if (_adsFormAck) _adsFormAck.resolve(null);
      _adsFormAck = wait;
      _adsFormBridge.postMessage({ type: 'wbe-ads-form', v: 2, op: 'start',
        phase, sequence: pending.sequence, nonce, policy: null });
    }), budget);
    if (!ack || _adsFormPending !== pending || _suspendGoogleAds || trackingHeld()) return null;
    const binding = policyRequest('form', phase, nonce, ack.challenge);
    const result = await withinBudget(() => _adsFormPending === pending && !_suspendGoogleAds && !trackingHeld() ? getAdsFormRequirement(binding) : null, budget);
    if (!remainingBudget(budget) || !validPolicy(result, binding) ||
        _adsFormPending !== pending || _suspendGoogleAds || trackingHeld()) return null;
    if (phase === 'complete' && (!pending.policy || result.policyKey !== pending.policy.policyKey ||
        result.requirement !== pending.policy.requirement || !Number.isFinite(monotonicNow()) ||
        monotonicNow() - pending.at >= 600000)) return null;
    _adsFormBridge.postMessage({ type: 'wbe-ads-form', v: 2, op: 'result',
      phase, sequence: pending.sequence, nonce, policy: result });
    return result;
  } catch (_) { return null; }
  finally { if (_adsFormAck === wait) _adsFormAck = null; closeBudget(budget); }
}
export function prepareAdsFormSubmission() {
  if (_suspendGoogleAds || trackingHeld() || !_$w || !_adsFormBridge) return 0;
  const sequence = ++_adsFormSequence;
  const pending = { sequence, completing: false, at: monotonicNow() };
  if (!Number.isFinite(pending.at)) return 0;
  _adsFormPending = pending;
  pending.ready = readAdsFormPolicy(pending, 'prepare').then(policy => {
    pending.policy = policy;
    return policy;
  });
  return sequence; // Booking never awaits optional Ads IO.
}
export function completeAdsFormSubmission(sequence) {
  const pending = _adsFormPending;
  if (!pending || pending.sequence !== sequence || pending.completing) return;
  pending.completing = true;
  void (async () => {
    try {
      const before = await pending.ready;
      if (!before || _adsFormPending !== pending || _suspendGoogleAds || trackingHeld() ||
          !Number.isFinite(monotonicNow()) || monotonicNow() - pending.at >= 600000) return;
      await readAdsFormPolicy(pending, 'complete');
    } catch (_) { /* No reservation dependency, no retry or contact/error logging. */ }
    finally { if (_adsFormPending === pending) _adsFormPending = null; }
  })();
}

export function setSuspendGoogleAds(value) {
  // Legacy setter: false never re-enables after a flag-derived suspension (sticky)
  // and never releases the flag hold (only resolveTrackingFlags can).
  if (!value && _flagState === 'suspended') return;
  suspendAttribution(value);
  _suspendGoogleAds = !!value;
  if (_suspendGoogleAds) _adsFormPending = null;
  console.log('[WBE-TRACKING] Google Ads / Analytics suspended:', _suspendGoogleAds);
}

export function pushDataLayer(payload) {
  try {
    if (_suspendGoogleAds) {
      console.log('TRACKING_SUSPENDED');
      return;
    }
    if (trackingHeld()) {
      console.log('TRACKING_HELD');
      return;
    }
    if (!_$w) {
      console.warn('TRACKING_NOT_INITIALIZED');
      return;
    }
    const bridge = _$w('#wbeEventBridge');
    bridge.postMessage({ type: 'wbe-datalayer-event', payload: payload });
    console.log('TRACKING_EVENT_SENT');
  } catch (err) {
    console.error('TRACKING_BRIDGE_FAILED');
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
