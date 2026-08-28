// Regression guard for explicit conversion-upload checkbox defaults.
// Run: node scripts/verify-conversion-upload-defaults.js

const fs = require('fs');
const path = require('path');
const backend = fs.readFileSync(
  path.join(__dirname, '..', 'velo', 'backend', 'availability.web.js'),
  'utf8'
);

function requireText(text, message) {
  if (!backend.includes(text)) {
    console.error('FAIL | ' + message);
    process.exit(1);
  }
}

requireText('googleConversionUploaded: false,',
  'new BookingSummary rows do not default googleConversionUploaded to No');
requireText('microsoftConversionUploaded: false,',
  'new BookingSummary rows do not default microsoftConversionUploaded to No');
requireText('if (existingAtt.googleConversionUploaded) summary.googleConversionUploaded = true;',
  'later summary updates do not preserve a successful Google upload');
requireText('if (existingAtt.microsoftConversionUploaded) summary.microsoftConversionUploaded = true;',
  'later summary updates do not preserve a successful Microsoft upload');

console.log('PASS | conversion upload fields default to No and preserve later success');
