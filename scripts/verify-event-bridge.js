// Ad-hoc verification for the wbeEventBridge dataLayer bridge.
// Run: node scripts/verify-event-bridge.js
// Simulates the three contexts (Velo worker, iframe relay, parent page) and
// proves events traverse with params intact. Not a test suite.

const dataLayer = [];
const parentListeners = [];
const parentWindow = { postMessage: function (msg) { parentListeners.forEach(fn => fn({ data: msg })); } };

// Head snippet listener (parent page)
parentListeners.push(function (event) {
  var d = event && event.data;
  if (d && d.source === 'wbe-event-bridge' && d.payload) { dataLayer.push(d.payload); }
});

// Iframe relay (custom-code/event-bridge-iframe.html logic)
const iframe = {
  onmessage: function (event) {
    var d = event && event.data;
    if (d && d.type === 'wbe-datalayer-event' && d.payload) {
      parentWindow.postMessage({ source: 'wbe-event-bridge', payload: d.payload }, '*');
    }
  },
};

// Velo tracking.js pushDataLayer
const bridgeEl = { postMessage: function (msg) { iframe.onmessage({ data: msg }); } };
let _$w = null;
function initTracking(w) { _$w = w; }
function pushDataLayer(payload) {
  if (!_$w) return;
  _$w('#wbeEventBridge').postMessage({ type: 'wbe-datalayer-event', payload: payload });
}

let pass = 0, fail = 0;
function check(n, a, e) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${n}`);
  ok ? pass++ : fail++;
}

pushDataLayer({ event: 'view_booking_search' });
check('dropped before initTracking', dataLayer.length, 0);

initTracking(function () { return bridgeEl; });
pushDataLayer({ event: 'view_booking_search' });
pushDataLayer({ event: 'begin_booking', nights: 7, value: 2590, currency: 'USD' });
pushDataLayer({ event: 'room_view', room_code: 'adventure_suite', nights: 7 });
check('3 events reached dataLayer', dataLayer.length, 3);
check('begin_booking params intact', dataLayer[1], { event: 'begin_booking', nights: 7, value: 2590, currency: 'USD' });
check('room_view params intact', dataLayer[2], { event: 'room_view', room_code: 'adventure_suite', nights: 7 });

iframe.onmessage({ data: { type: 'other' } });
check('unrelated iframe message ignored', dataLayer.length, 3);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
