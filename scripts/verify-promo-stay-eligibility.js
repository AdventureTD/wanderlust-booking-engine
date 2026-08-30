const fs = require('fs');
const backend = fs.readFileSync('velo/backend/availability.web.js', 'utf8');
const page = fs.readFileSync('velo/page-booking-summary.js', 'utf8');

function check(condition, message) {
  console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
  if (!condition) process.exitCode = 1;
}

check(
  /validatePromoCodeImpl\(code,\s*totalGuestNights,\s*checkIn,\s*checkOut\)/.test(backend),
  'backend promo validation receives stay dates'
);
check(backend.includes('lastOccupiedNight'), 'backend evaluates the final occupied night rather than checkout morning');
check(backend.includes('stayStart < promoStart'), 'backend rejects stays beginning before the promo window');
check(backend.includes('lastOccupiedNight > promoEnd'), 'backend rejects stays ending after the promo window');
check(
  page.includes('dateToStr(_summaryCis)') && page.includes('dateToStr(_summaryCos)'),
  'Booking Summary sends canonical date-only stay strings'
);
check(!page.includes("const notExpiredReasons = ['Promo code is not yet active.', 'Promo code has expired.'];"), 'frontend no longer labels not-yet-active codes as expired');
check(page.includes("safeText('bookingStatus', reason"), 'frontend displays the backend promo reason verbatim');
check(/if \(!code\)[\s\S]*?safeText\('bookingStatus', ''\)/.test(page), 'clearing the promo input clears stale booking errors');

const rulesStart = backend.indexOf('function promoDateOnly');
const rulesEnd = backend.indexOf('async function validatePromoCodeImpl', rulesStart);
if (rulesStart < 0 || rulesEnd < 0) {
  check(false, 'promo stay eligibility helper is testable');
} else {
  const vm = require('vm');
  const context = { Date };
  vm.createContext(context);
  vm.runInContext(backend.slice(rulesStart, rulesEnd) + '\nthis.checkStay = promoStayEligibility;', context);
  check(context.checkStay('2026-11-01', '2026-11-22', '2026-11-08', '2026-11-15').valid, 'Nov 8–15 stay qualifies for Nov 1–22 promo window');
  check(context.checkStay('2026-11-01', '2026-11-22', '2026-11-08', '2026-11-23').valid, 'promo end date includes the final occupied night');
  check(!context.checkStay('2026-11-01', '2026-11-22', '2026-10-31', '2026-11-08').valid, 'stay beginning before promo window is rejected');
  check(!context.checkStay('2026-11-01', '2026-11-22', '2026-11-08', '2026-11-24').valid, 'stay with a night after promo window is rejected');
  check(context.checkStay('2026-11-01T00:00:00+13:00', '2026-11-22T00:00:00-10:00', '2026-11-08', '2026-11-15').valid, 'date-only promo fields preserve their written calendar dates across offsets');
}
