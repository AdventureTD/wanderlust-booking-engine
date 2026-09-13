// Static contract only; behavioral evidence: node tests/attribution-hotfix.cjs
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'velo', 'page-booking-summary.js'), 'utf8');
assert.ok(source.includes('const financialSnapshot = _financialSnapshot;'));
assert.ok(source.includes('Object.freeze({ value: discountedGrandTotal, currency: \'USD\' })'));
assert.ok(source.includes('Number.isFinite(discountedGrandTotal)'));
assert.ok(source.includes('const grandTotal = financialSnapshot.value;'));
const confirm = source.slice(source.indexOf('function wireContinueButton()'));
assert.ok(!confirm.includes("safeTextRead('grandTotal"), 'display must not supply purchase money');
console.log('PASS | confirmed purchase uses captured numeric financial snapshot, not display text');
