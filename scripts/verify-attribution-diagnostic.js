// Phase 1 regression guard for the isolated attribution diagnostic.
// Run: node scripts/verify-attribution-diagnostic.js

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const files = {
  page: path.join(root, 'velo', 'page-attribution-diagnostic.js'),
  iframe: path.join(root, 'velo', 'custom-code', 'attribution-diagnostic-bridge.html'),
  responder: path.join(root, 'velo', 'custom-code', 'attribution-diagnostic-responder.html')
};

function fail(message) {
  console.error('FAIL | ' + message);
  process.exit(1);
}
function read(name) {
  if (!fs.existsSync(files[name])) fail(name + ' artifact is missing');
  return fs.readFileSync(files[name], 'utf8');
}
function requireText(source, text, message) {
  if (!source.includes(text)) fail(message);
}

const page = read('page');
const iframe = read('iframe');
const responder = read('responder');

requireText(page, "import wixLocationFrontend from 'wix-location-frontend';", 'page code does not inspect direct Velo location data');
requireText(page, "wixLocationFrontend.query", 'page code does not read direct Velo query parameters');
requireText(page, "Velo direct query gclid:", 'status does not report direct gclid visibility');
requireText(page, "Velo direct query msclkid:", 'status does not report direct msclkid visibility');
requireText(page, "#attributionTestBridge", 'page code does not target #attributionTestBridge');
requireText(page, "bridge.onMessage(function (event)", 'page code does not listen to the HTML Component');
requireText(page, "data.type === 'wbe-attribution-ready'", 'page code does not wait for the ready handshake');
requireText(page, "type: 'wbe-attribution-request'", 'page code does not request attribution after ready');
requireText(page, "data.type === 'wbe-attribution-response'", 'page code does not accept the returned attribution');
requireText(page, "wl_click_attribution_diagnostic", 'page code must use a diagnostic-only Velo storage key');

requireText(iframe, "type: 'wbe-attribution-ready'", 'iframe does not announce readiness');
requireText(iframe, "d.type === 'wbe-attribution-request'", 'iframe does not receive the Velo request');
requireText(iframe, "source: 'wbe-attribution-diagnostic-request'", 'iframe does not relay the request to page context');
requireText(iframe, "d.type === 'wbe-attribution-page-response'", 'iframe does not receive the page-context response');
requireText(iframe, "type: 'wbe-attribution-response'", 'iframe does not relay the response to Velo');

requireText(responder, "d.source !== 'wbe-attribution-diagnostic-request'", 'responder does not filter diagnostic requests');
requireText(responder, "localStorage.getItem('wl_click_attribution')", 'responder does not read the existing page-context capture');
requireText(responder, "type: 'wbe-attribution-page-response'", 'responder does not reply to the iframe');
requireText(responder, "event.source.postMessage", 'responder does not reply to the requesting iframe window');

const combined = page + iframe + responder;
[
  'createBooking', 'issueBookingInvoice', 'recordBookingConversion',
  'recordMicrosoftBookingConversion', 'googleAdsConversions',
  'microsoftAdsConversions', 'dataManagerClient'
].forEach(function (forbidden) {
  if (combined.includes(forbidden)) fail('diagnostic imports or invokes forbidden production path: ' + forbidden);
});
if (page.includes("local.setItem('wl_click_attribution',")) {
  fail('diagnostic must not write the production Velo attribution key');
}

// Deterministic protocol simulation.
const fake = {
  gclid: 'WBE_TEST_GCLID_A1',
  gbraid: 'WBE_TEST_GBRAID_A1',
  wbraid: 'WBE_TEST_WBRAID_A1',
  msclkid: 'WBE_TEST_MSCLKID_A1',
  capturedAt: '2026-08-29T12:00:00.000Z'
};
const pageStorage = { wl_click_attribution: JSON.stringify(fake) };
const veloStorage = {};
let requestId = null;

function parentReceives(message, iframeWindow) {
  if (message.source === 'wbe-attribution-diagnostic-request') {
    const raw = pageStorage.wl_click_attribution;
    iframeWindow({
      type: 'wbe-attribution-page-response',
      requestId: message.requestId,
      payload: raw ? JSON.parse(raw) : null,
      iframeOrigin: 'https://diagnostic-iframe.example'
    });
  } else if (message.type === 'wbe-attribution-response') {
    if (message.requestId !== requestId) fail('response requestId mismatch');
    veloStorage.wl_click_attribution_diagnostic = JSON.stringify(message.payload);
  }
}
function iframeReceives(message) {
  if (message.type === 'wbe-attribution-request') {
    parentReceives({
      source: 'wbe-attribution-diagnostic-request',
      requestId: message.requestId
    }, iframeReceives);
  } else if (message.type === 'wbe-attribution-page-response') {
    parentReceives({
      type: 'wbe-attribution-response',
      requestId: message.requestId,
      payload: message.payload,
      iframeOrigin: message.iframeOrigin
    }, iframeReceives);
  }
}

requestId = 'WBE_DIAG_REQUEST_1';
iframeReceives({ type: 'wbe-attribution-request', requestId: requestId });
const roundTrip = JSON.parse(veloStorage.wl_click_attribution_diagnostic || 'null');
if (!roundTrip || roundTrip.gclid !== fake.gclid || roundTrip.msclkid !== fake.msclkid) {
  fail('fake Google and Microsoft IDs did not complete the diagnostic round trip');
}

console.log('PASS | isolated attribution diagnostic is complete and production-safe');
