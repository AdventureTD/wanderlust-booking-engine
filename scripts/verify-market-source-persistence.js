// Regression guard for BookingSummary.marketSource persistence.
// Run: node scripts/verify-market-source-persistence.js

const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'velo', 'page-booking-summary.js'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '..', 'velo', 'backend', 'availability.web.js'), 'utf8');

function requireText(source, text, message) {
  if (!source.includes(text)) {
    console.error('FAIL | ' + message);
    process.exit(1);
  }
}

requireText(page, "const marketSource = safeVal('marketSource').trim();",
  'Booking Summary does not read #marketSource');

const payloadMatches = page.match(/marketSource:\s*marketSource/g) || [];
if (payloadMatches.length < 2) {
  console.error('FAIL | marketSource is not passed for both first and additional room payloads');
  process.exit(1);
}

requireText(backend, "marketSource: optGuest && optGuest.marketSource ? String(optGuest.marketSource).trim() : '',",
  'backend summary does not persist marketSource');
requireText(backend, "if (!summary.marketSource && existingAtt.marketSource) summary.marketSource = existingAtt.marketSource;",
  'later summary refreshes can clear marketSource');

console.log('PASS | marketSource flows from #marketSource to BookingSummary and is preserved');
