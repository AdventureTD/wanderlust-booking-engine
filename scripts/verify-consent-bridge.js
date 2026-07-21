// Ad-hoc verification for velo/masterPage.js consent bridge.
// Run: node scripts/verify-consent-bridge.js
// Not a test suite — exercises the pure policy-gate logic against
// every consent shape the Wix banner can produce.

function policyAllowsAds(policy) {
  return !!(policy && (policy.advertising || policy.analytics));
}

const cases = [
  ['full consent granted', { essential: true, functional: true, analytics: true, advertising: true }, true],
  ['advertising only', { essential: true, advertising: true, analytics: false }, true],
  ['analytics only', { essential: true, analytics: true, advertising: false }, true],
  ['essential only -> blocked', { essential: true, advertising: false, analytics: false }, false],
  ['empty policy -> blocked', {}, false],
  ['undefined policy -> blocked', undefined, false],
];

let pass = 0, fail = 0;
for (const [name, input, expected] of cases) {
  const actual = policyAllowsAds(input);
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}`);
  ok ? pass++ : fail++;
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
