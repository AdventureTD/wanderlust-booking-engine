// Regression test for Google Apps Script calendar date parsing.
// Run: node scripts/verify-google-calendar-dates.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.TZ = 'America/Dominica';

const webhookPath = path.join(__dirname, 'google-calendar-webhook.gs');
const source = fs.readFileSync(webhookPath, 'utf8');
const context = { Date, JSON };
vm.createContext(context);
vm.runInContext(source, context);

if (typeof context.parseLocalCalendarDate !== 'function') {
  console.error('FAIL | parseLocalCalendarDate helper is missing');
  process.exit(1);
}

const checkIn = context.parseLocalCalendarDate('2026-12-25');
const checkOut = context.parseLocalCalendarDate('2026-12-31');

function assertLocalDate(label, actual, year, monthIndex, day) {
  const pass = actual.getFullYear() === year && actual.getMonth() === monthIndex && actual.getDate() === day;
  if (!pass) {
    console.error(`FAIL | ${label} parsed as ${actual.toString()}`);
    process.exit(1);
  }
}

assertLocalDate('check-in', checkIn, 2026, 11, 25);
assertLocalDate('exclusive check-out', checkOut, 2026, 11, 31);

const occupiedNights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000);
if (occupiedNights !== 6) {
  console.error(`FAIL | expected 6 occupied nights, got ${occupiedNights}`);
  process.exit(1);
}

console.log('PASS | Dec 25–31 parses locally as six occupied nights (Dec 25–30)');
