// public/tracking.js
// Shared FRONT-END helper module (lives under "Public" in Velo).
// Captures Google Ads click IDs (gclid/gbraid/wbraid) from the landing URL,
// persists them across pages, and pushes dataLayer events for GA4 / Google Ads.

import { local } from 'wix-storage-frontend';
import wixLocationFrontend from 'wix-location-frontend';

const STORAGE_KEY = 'wl_click_attribution';
const CLICK_PARAMS = ['gclid', 'gbraid', 'wbraid'];
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
    let query = wixLocationFrontend.query || {};
    console.log('[WBE-TRACKING] wixLocationFrontend.query:', JSON.stringify(query));
    console.log('[WBE-TRACKING] wixLocationFrontend.url:', wixLocationFrontend.url);

    // Fallback: parse the raw URL because Wix does not always expose ad params in query object.
    if (!query.gclid && !query.gbraid && !query.wbraid) {
      const rawParams = parseUrlParams(wixLocationFrontend.url);
      console.log('[WBE-TRACKING] raw URL params:', JSON.stringify(rawParams));
      if (rawParams.gclid || rawParams.gbraid || rawParams.wbraid) {
        query = rawParams;
      }
    }

    const found = {};
    for (let i = 0; i < CLICK_PARAMS.length; i++) {
      const p = CLICK_PARAMS[i];
      if (query[p]) { found[p] = query[p]; }
    }

    console.log('[WBE-TRACKING] parsed click IDs:', JSON.stringify(found));

    if (Object.keys(found).length === 0) { return getStoredClickIds(); }

    const existing = getStoredClickIds();
    if (existing && existing.gclid) { return existing; }

    const record = {
      gclid: found.gclid || '',
      gbraid: found.gbraid || '',
      wbraid: found.wbraid || '',
      landingUrl: wixLocationFrontend.url || '',
      capturedAt: new Date().toISOString()
    };
    local.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  } catch (err) {
    console.error('captureClickIds failed:', err && err.message || err);
    return null;
  }
}

// Returns stored attribution object or null if none/expired.
export function getStoredClickIds() {
  try {
    const raw = local.getItem(STORAGE_KEY);
    if (!raw) { return null; }
    const record = JSON.parse(raw);

    if (record.capturedAt) {
      const ageMs = Date.now() - new Date(record.capturedAt).getTime();
      const maxMs = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs > maxMs) {
        local.removeItem(STORAGE_KEY);
        return null;
      }
    }
    return record;
  } catch (err) {
    console.error('getStoredClickIds failed:', err && err.message || err);
    return null;
  }
}

// Clears stored attribution after a successful conversion upload.
export function clearClickIds() {
  try { local.removeItem(STORAGE_KEY); } catch (err) { /* noop */ }
}

const DATALAYER_QUEUE_KEY = 'wbe_dataLayer_queue';

function pushToQueue(payload) {
  try {
    const raw = local.getItem(DATALAYER_QUEUE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    queue.push(payload);
    local.setItem(DATALAYER_QUEUE_KEY, JSON.stringify(queue));
    console.log('[WBE-GTAG] queued event:', payload.event || payload);
    return true;
  } catch (err) {
    console.error('[WBE-GTAG] queue push failed:', err && err.message || err);
    return false;
  }
}

// Push an event onto window.dataLayer for the Google tag to pick up.
export function pushDataLayer(payload) {
  // Wix Velo page/public modules do not have access to window, so we stage events
  // in localStorage and the custom-code script in the page head flushes them.
  pushToQueue(payload);
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
