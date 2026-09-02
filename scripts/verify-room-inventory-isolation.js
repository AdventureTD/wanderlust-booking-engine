// Structural guard for the isolated read-only inventory modules.
// Run: node scripts/verify-room-inventory-isolation.js
const fs = require('fs');
const path = require('path');

function check(condition, message) {
  console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
  if (!condition) process.exitCode = 1;
}

const root = path.join(__dirname, '..');
const adapterPath = path.join(root, 'velo', 'backend', 'roomInventory.js');
const rulesPath = path.join(root, 'velo', 'backend', 'roomInventoryRules.js');
const adapter = fs.readFileSync(adapterPath, 'utf8');
const rules = fs.readFileSync(rulesPath, 'utf8');

check(!/\bwebMethod\b/.test(adapter), 'inventory adapter exposes no public web method');
check(!/\.(insert|update|remove|save)\s*\(/.test(adapter + '\n' + rules), 'inventory modules contain no Wix Data writes');
check(!/(calendar|ownerBlocks|availability|adminConsole|data\.js|page-)/.test(adapter.split('\n').filter(function(line) { return /^import /.test(line); }).join('\n')), 'inventory adapter imports no write, calendar, search, or page modules');
check(!/from ['"]backend\/roomInventory['"]/.test(rules), 'pure inventory rules do not import the Wix adapter');

const protectedFiles = [
  path.join(root, 'velo', 'page-booking-search.js'),
  path.join(root, 'velo', 'backend', 'search.web.js'),
  path.join(root, 'velo', 'backend', 'availability.web.js'),
  path.join(root, 'velo', 'backend', 'adminConsole.web.js')
];
for (const file of protectedFiles) {
  const source = fs.readFileSync(file, 'utf8');
  check(!/roomInventory/.test(source), path.relative(root, file) + ' remains disconnected from Module 2');
}
