// Regression guard for the production page-context attribution responder.
// Run: node scripts/verify-production-attribution-responder.js

const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'velo', 'custom-code', 'attribution-bridge-responder.html');

function fail(message) {
  console.error('FAIL | ' + message);
  process.exit(1);
}
if (!fs.existsSync(file)) fail('production attribution responder artifact is missing');
const source = fs.readFileSync(file, 'utf8');
function requireText(text, message) {
  if (!source.includes(text)) fail(message);
}

requireText("var IFRAME_ORIGIN = 'https://www-wanderlustcaribbean-com.filesusr.com';",
  'responder does not whitelist the verified Wix iframe origin');
requireText("event.origin !== IFRAME_ORIGIN", 'responder does not reject unexpected iframe origins');
requireText("d.source !== 'wbe-attribution-bridge-page-request'", 'responder does not filter request source');
requireText("d.version !== 1", 'responder does not require protocol version 1');
requireText("localStorage.getItem('wl_click_attribution')", 'responder does not read the existing page capture');
requireText("type: 'wbe-attribution-bridge-page-response'", 'responder does not produce the bridge response');
requireText("event.source.postMessage", 'responder does not reply to the requesting iframe window');
requireText("}, IFRAME_ORIGIN);", 'responder reply target is not origin-restricted');
requireText("var ATTRIBUTION_WINDOW_DAYS = 90;", 'responder does not enforce the attribution window');
requireText("String(value).trim().slice(0, maxLength)", 'responder does not length-limit returned values');

[
  'createBooking', 'issueBookingInvoice', 'recordBookingConversion',
  'recordMicrosoftBookingConversion', 'googleAdsConversions',
  'microsoftAdsConversions', 'dataManagerClient', 'dataLayer.push',
  "localStorage.setItem('wl_click_attribution'"
].forEach(function (forbidden) {
  if (source.includes(forbidden)) fail('responder contains forbidden side effect: ' + forbidden);
});

console.log('PASS | production attribution responder is read-only and origin-restricted');
