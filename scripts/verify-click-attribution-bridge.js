// Regression guard for page-localStorage -> Velo click attribution bridge.
// Run: node scripts/verify-click-attribution-bridge.js

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const head = fs.readFileSync(path.join(root, 'velo', 'custom-code', 'google-tag-and-consent.html'), 'utf8');
const iframe = fs.readFileSync(path.join(root, 'velo', 'custom-code', 'event-bridge-iframe.html'), 'utf8');
const tracking = fs.readFileSync(path.join(root, 'velo', 'public', 'tracking.js'), 'utf8');
const summaryPage = fs.readFileSync(path.join(root, 'velo', 'page-booking-summary.js'), 'utf8');
const availability = fs.readFileSync(path.join(root, 'velo', 'backend', 'availability.web.js'), 'utf8');

function requireText(source, text, message) {
  if (!source.includes(text)) {
    console.error('FAIL | ' + message);
    process.exit(1);
  }
}

requireText(head, "d.source === 'wbe-click-attribution-request'",
  'head code does not answer attribution requests from the iframe');
requireText(head, "localStorage.getItem('wl_click_attribution')",
  'head code does not read the captured page-context attribution');
requireText(head, "d.source === 'wbe-click-attribution-clear'",
  'head code cannot clear page-context attribution after conversion');

requireText(iframe, "d.type === 'wbe-click-attribution-request'",
  'iframe does not relay Velo attribution requests to the parent page');
requireText(iframe, "d.type === 'wbe-click-attribution-response'",
  'iframe does not relay parent attribution responses back to Velo');
requireText(iframe, "type: 'wbe-click-attribution'",
  'iframe does not emit the Velo-facing attribution message');

requireText(tracking, "bridge.onMessage(function (event) {",
  'Velo does not listen for attribution returned by the iframe');
requireText(tracking, "data.type !== 'wbe-click-attribution'",
  'Velo does not recognize the returned attribution payload');
requireText(tracking, "local.setItem(STORAGE_KEY, JSON.stringify(record));",
  'returned attribution is not persisted in Velo storage');
requireText(tracking, "type: 'wbe-click-attribution-clear'",
  'conversion cleanup does not clear page-context attribution');

['gclid', 'gbraid', 'wbraid'].forEach(function (id) {
  const payloadOccurrences = summaryPage.match(new RegExp(id + ':\\s*clickIds\\.' + id, 'g')) || [];
  if (payloadOccurrences.length < 3) {
    console.error('FAIL | ' + id + ' is not sent in first-room, additional-room, and Google conversion payloads');
    process.exit(1);
  }
});
requireText(availability, "if (!summary.gclid && existingAtt.gclid) summary.gclid = existingAtt.gclid;",
  'later BookingSummary refreshes can clear a stored gclid');

// Protocol simulation: Velo request -> iframe -> parent page storage -> iframe -> Velo.
const pageStorage = {
  wl_click_attribution: JSON.stringify({
    gclid: 'test-google-click',
    gbraid: '',
    wbraid: '',
    msclkid: 'test-microsoft-click',
    capturedAt: '2026-08-28T12:00:00.000Z'
  })
};
let veloRecord = null;
let veloListener = null;

const parentWindow = {
  receiveFromIframe(message, iframeWindow) {
    if (message.source === 'wbe-click-attribution-request') {
      const raw = pageStorage.wl_click_attribution || null;
      iframeWindow.receiveFromParent({
        type: 'wbe-click-attribution-response',
        payload: raw ? JSON.parse(raw) : null
      });
    }
    if (message.source === 'wbe-click-attribution-clear') {
      delete pageStorage.wl_click_attribution;
    }
    if (message.type === 'wbe-click-attribution' && veloListener) {
      veloListener({ data: message });
    }
  }
};

const iframeWindow = {
  receiveFromVelo(message) { this.route(message); },
  receiveFromParent(message) { this.route(message); },
  route(message) {
    if (message.type === 'wbe-click-attribution-request') {
      parentWindow.receiveFromIframe({ source: 'wbe-click-attribution-request' }, this);
    }
    if (message.type === 'wbe-click-attribution-response') {
      parentWindow.receiveFromIframe({ type: 'wbe-click-attribution', payload: message.payload }, this);
    }
    if (message.type === 'wbe-click-attribution-clear') {
      parentWindow.receiveFromIframe({ source: 'wbe-click-attribution-clear' }, this);
    }
  }
};

const bridge = {
  onMessage(listener) { veloListener = listener; },
  postMessage(message) { iframeWindow.receiveFromVelo(message); }
};

bridge.onMessage(function (event) {
  if (event.data && event.data.type === 'wbe-click-attribution') {
    veloRecord = event.data.payload;
  }
});
bridge.postMessage({ type: 'wbe-click-attribution-request' });
if (!veloRecord || veloRecord.gclid !== 'test-google-click' || veloRecord.msclkid !== 'test-microsoft-click') {
  console.error('FAIL | attribution request/response did not complete a round trip');
  process.exit(1);
}
bridge.postMessage({ type: 'wbe-click-attribution-clear' });
if (pageStorage.wl_click_attribution !== undefined) {
  console.error('FAIL | attribution clear did not reach page storage');
  process.exit(1);
}

console.log('PASS | click IDs bridge from page localStorage to Velo and clear in both contexts');
