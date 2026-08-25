// Regression guard: confirmed purchases must read the actual Wix total element.
// Run: node scripts/verify-purchase-value-source.js

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'velo', 'page-booking-summary.js');
const source = fs.readFileSync(file, 'utf8');

const expected = "const grandTotalText = (safeTextRead('grandTotal') || safeTextRead('grandTotal1') || safeTextRead('grandTotalText'))";

if (!source.includes(expected)) {
  console.error('FAIL | confirmed purchase does not read #grandTotal before fallback IDs');
  process.exit(1);
}

console.log('PASS | confirmed purchase reads #grandTotal before fallback IDs');
