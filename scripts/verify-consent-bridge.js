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
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../velo/masterPage.js'),'utf8').replace(/^import .*;\r?\n/gm,'');
for (const env of ['browser','backend']) {
  const ready=[], trace=[]; const w=()=>({onClick(){}});w.onReady=f=>ready.push(f);
  vm.runInNewContext(source,{$w:w,rendering:{env},local:{getItem(){return null;}},
    observeMicrosoftPage(given){assert.equal(given,w);trace.push('observe');},
    getAllSettings(){trace.push('settings');return new Promise(()=>{});},console:{log(){},error(){}}});
  ready.forEach(f=>f());
  assert.equal(trace.filter(x=>x==='observe').length,env==='browser'?1:0,'CAUSAL: browser-only ordinary master observation');
  if(env==='browser') assert.ok(trace.indexOf('observe')<trace.indexOf('settings'),'observation before backend await');
}
console.log('PASS | actual master browser-only page-ready observation before settings await');
process.exit(fail ? 1 : 0);
