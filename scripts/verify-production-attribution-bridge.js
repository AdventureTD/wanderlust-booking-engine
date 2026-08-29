// Regression guard for the production-only attribution HTML Component.
// Run: node scripts/verify-production-attribution-bridge.js

const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'velo', 'custom-code', 'attribution-bridge-iframe.html');

function fail(message) {
  console.error('FAIL | ' + message);
  process.exit(1);
}
if (!fs.existsSync(file)) fail('production attribution bridge artifact is missing');
const source = fs.readFileSync(file, 'utf8');
function requireText(text, message) {
  if (!source.includes(text)) fail(message);
}

requireText("var PARENT_ORIGIN = 'https://www.wanderlustcaribbean.com';",
  'bridge does not restrict parent messages to the production site origin');
requireText("type: 'wbe-attribution-bridge-ready'", 'bridge does not announce readiness');
requireText("d.type === 'wbe-attribution-bridge-request'", 'bridge does not receive the Velo request');
requireText("source: 'wbe-attribution-bridge-page-request'", 'bridge does not request page-context attribution');
requireText("d.type === 'wbe-attribution-bridge-page-response'", 'bridge does not receive the page-context response');
requireText("type: 'wbe-attribution-bridge-response'", 'bridge does not relay attribution to Velo');
requireText("version: 1", 'bridge protocol is not versioned');
requireText("event.origin !== PARENT_ORIGIN", 'bridge does not reject messages from unexpected parent origins');

[
  'localStorage', 'wix-storage', 'createBooking', 'issueBookingInvoice',
  'recordBookingConversion', 'recordMicrosoftBookingConversion',
  'wbe-datalayer-event', 'wbe-event-bridge'
].forEach(function (forbidden) {
  if (source.includes(forbidden)) fail('bridge contains forbidden concern: ' + forbidden);
});

console.log('PASS | production attribution bridge is isolated and origin-restricted');
