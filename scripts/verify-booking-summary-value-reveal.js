// Regression guard for Booking Summary placeholder-value flashes.
// Run: node scripts/verify-booking-summary-value-reveal.js

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'velo', 'page-booking-summary.js');
const source = fs.readFileSync(file, 'utf8');

function fail(message) {
  console.error('FAIL | ' + message);
  process.exit(1);
}

const onReadyStart = source.indexOf('$w.onReady(function () {');
const hideCall = source.indexOf('hideInitialSummaryValues();', onReadyStart);
const initCall = source.indexOf('initSummary()', onReadyStart);
if (onReadyStart < 0 || hideCall < 0 || initCall < 0 || hideCall > initCall) {
  fail('initial summary values are not hidden before asynchronous initialization');
}

const safeTextStart = source.indexOf('function safeText(id, txt) {');
const safeTextEnd = source.indexOf('\n}', safeTextStart);
const safeTextBody = source.slice(safeTextStart, safeTextEnd);
const assignAt = safeTextBody.indexOf('.text = txt');
const showAt = safeTextBody.indexOf('.show');
if (assignAt < 0 || showAt < 0 || assignAt > showAt) {
  fail('safeText must assign the value before showing the element');
}

const safeItemStart = source.indexOf('function safeItem($item, selector, action, val) {');
const safeItemEnd = source.indexOf('\n}', safeItemStart);
const safeItemBody = source.slice(safeItemStart, safeItemEnd);
const itemAssignAt = safeItemBody.indexOf("if (action === 'text') el.text = val;");
const itemShowAt = safeItemBody.indexOf('el.show');
if (itemAssignAt < 0 || itemShowAt < 0 || itemAssignAt > itemShowAt) {
  fail('safeItem must assign repeater values before showing the element');
}

if (!source.includes("if (typeof guestEl.show === 'function') guestEl.show();")) {
  fail('guest count is not shown after its repeater value is assigned');
}
if (!source.includes("if (feeText && typeof feeEl.show === 'function') feeEl.show();")) {
  fail('Penthouse fee is not shown after its repeater value is assigned');
}

if (!source.includes("'summaryRoomsRepeater'")) {
  fail('room repeater is not included in the initial hidden-value set');
}

const valueIdsStart = source.indexOf('const valueIds = [');
const valueIdsEnd = source.indexOf('];', valueIdsStart);
const valueIdsBlock = source.slice(valueIdsStart, valueIdsEnd);
['basePackage', 'promoAmount', 'promoDiscountText', 'adjustedPackage'].forEach(function (id) {
  if (valueIdsBlock.includes("'" + id + "'")) {
    fail(id + ' is force-shown even though it has no initial visible value');
  }
});

console.log('PASS | Booking Summary values are assigned before they are revealed');
