// Attribution Diagnostic page code — Phase 1 only.
// Expected Wix IDs:
//   HTML Component: #attributionTestBridge
//   Optional text element: #attributionStatus
// This page never creates bookings or calls an advertising API.

import { local } from 'wix-storage-frontend';
import wixLocationFrontend from 'wix-location-frontend';

const BRIDGE_ID = '#attributionTestBridge';
const STATUS_ID = '#attributionStatus';
const DIAGNOSTIC_STORAGE_KEY = 'wl_click_attribution_diagnostic';
const ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'msclkid'];
const TIMEOUT_MS = 8000;

function setStatus(lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
  console.log('[WBE-ATTR-DIAG]', text.replace(/\n/g, ' | '));
  try {
    const el = $w(STATUS_ID);
    el.text = text;
    if (typeof el.expand === 'function') el.expand();
    if (typeof el.show === 'function') el.show();
  } catch (e) {
    // #attributionStatus is optional; Wix live logs remain the fallback.
  }
}

function cleanId(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, 512);
}

function sanitizeAttribution(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const clean = {
    gclid: cleanId(source.gclid),
    gbraid: cleanId(source.gbraid),
    wbraid: cleanId(source.wbraid),
    msclkid: cleanId(source.msclkid),
    capturedAt: cleanId(source.capturedAt),
    landingUrl: cleanId(source.landingUrl)
  };
  const hasAnyId = ID_KEYS.some(function (key) { return !!clean[key]; });
  return hasAnyId ? clean : null;
}

function readDirectVeloAttribution() {
  try {
    const query = wixLocationFrontend.query || {};
    return {
      gclid: cleanId(query.gclid),
      gbraid: cleanId(query.gbraid),
      wbraid: cleanId(query.wbraid),
      msclkid: cleanId(query.msclkid),
      url: cleanId(wixLocationFrontend.url)
    };
  } catch (e) {
    return { gclid: '', gbraid: '', wbraid: '', msclkid: '', url: '' };
  }
}

function masked(value) {
  if (!value) return 'No';
  const s = String(value);
  return 'Yes — ' + s.slice(0, 12) + (s.length > 12 ? '…' : '') + ' (' + s.length + ' chars)';
}

$w.onReady(function () {
  // Clear only the diagnostic Velo key so every run proves a fresh round trip.
  try { local.removeItem(DIAGNOSTIC_STORAGE_KEY); } catch (e) {}
  const directVelo = readDirectVeloAttribution();

  let bridge;
  try {
    bridge = $w(BRIDGE_ID);
  } catch (e) {
    setStatus([
      'STOP — diagnostic bridge not found.',
      'Expected HTML Component ID: ' + BRIDGE_ID
    ]);
    return;
  }

  let requestSent = false;
  let activeRequestId = '';
  let finished = false;

  const timeoutHandle = setTimeout(function () {
    if (finished) return;
    setStatus([
      'STOP — attribution diagnostic timed out.',
      'Bridge ready: ' + (requestSent ? 'Yes' : 'No'),
      'No booking or conversion call was made.'
    ]);
  }, TIMEOUT_MS);

  bridge.onMessage(function (event) {
    try {
      const data = event && event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'wbe-attribution-ready' && !requestSent) {
        requestSent = true;
        activeRequestId = 'WBE_DIAG_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
        setStatus([
          'Bridge ready: Yes',
          'Request sent: Yes',
          'Waiting for page-context attribution…'
        ]);
        bridge.postMessage({
          type: 'wbe-attribution-request',
          version: 1,
          requestId: activeRequestId
        });
        return;
      }

      if (data.type === 'wbe-attribution-response') {
        if (!requestSent || data.requestId !== activeRequestId) {
          console.warn('[WBE-ATTR-DIAG] ignored response with unknown requestId');
          return;
        }

        finished = true;
        clearTimeout(timeoutHandle);
        const record = sanitizeAttribution(data.payload);
        if (!record) {
          setStatus([
            'Bridge ready: Yes',
            'Page response received: Yes',
            'STOP — no captured ad IDs were present in page localStorage.',
            'Velo direct query gclid: ' + masked(directVelo.gclid),
            'Velo direct query gbraid: ' + masked(directVelo.gbraid),
            'Velo direct query wbraid: ' + masked(directVelo.wbraid),
            'Velo direct query msclkid: ' + masked(directVelo.msclkid),
            'Velo URL still contains a query: ' + (directVelo.url.indexOf('?') >= 0 ? 'Yes' : 'No'),
            'Use the WBE_TEST URL in a fresh incognito window.',
            'Iframe origin observed: ' + (data.iframeOrigin || '(not reported)')
          ]);
          return;
        }

        local.setItem(DIAGNOSTIC_STORAGE_KEY, JSON.stringify(record));
        const readBack = JSON.parse(local.getItem(DIAGNOSTIC_STORAGE_KEY) || 'null');
        if (!readBack) throw new Error('diagnostic Velo storage read-back failed');

        setStatus([
          'PASS — page-context IDs reached Velo.',
          'Google gclid: ' + masked(readBack.gclid),
          'Google gbraid: ' + masked(readBack.gbraid),
          'Google wbraid: ' + masked(readBack.wbraid),
          'Microsoft msclkid: ' + masked(readBack.msclkid),
          'Velo direct query gclid: ' + masked(directVelo.gclid),
          'Velo direct query gbraid: ' + masked(directVelo.gbraid),
          'Velo direct query wbraid: ' + masked(directVelo.wbraid),
          'Velo direct query msclkid: ' + masked(directVelo.msclkid),
          'Velo URL still contains a query: ' + (directVelo.url.indexOf('?') >= 0 ? 'Yes' : 'No'),
          'Captured at: ' + (readBack.capturedAt || '(missing)'),
          'Iframe origin observed: ' + (data.iframeOrigin || '(not reported)'),
          'Stored only under: ' + DIAGNOSTIC_STORAGE_KEY,
          'No booking or conversion call was made.'
        ]);
      }
    } catch (e) {
      finished = true;
      clearTimeout(timeoutHandle);
      setStatus([
        'STOP — diagnostic response error.',
        String(e && e.message || e),
        'No booking or conversion call was made.'
      ]);
    }
  });

  setStatus([
    'Attribution diagnostic started.',
    'Waiting for #attributionTestBridge to announce ready…',
    'No booking or conversion call will be made.'
  ]);
});
