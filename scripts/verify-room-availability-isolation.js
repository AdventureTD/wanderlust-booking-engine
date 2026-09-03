// Structural guard for the isolated pure availability module.
// Run: node scripts/verify-room-availability-isolation.js
const fs = require('fs');
const path = require('path');

function check(condition, message) {
  console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
  if (!condition) process.exitCode = 1;
}

const root = path.join(__dirname, '..');
const rulesPath = path.join(root, 'velo', 'backend', 'roomAvailabilityRules.js');
const rules = fs.readFileSync(rulesPath, 'utf8');
const imports = rules.split('\n').filter(function(line) { return /^import /.test(line); });

check(!/\bwebMethod\b/.test(rules), 'availability rules expose no public web method');
check(!/wix-|wixData|fetch\s*\(|getSecret/.test(rules), 'availability rules use no Wix, database, network, or secret APIs');
check(!/\.(insert|update|remove|save)\s*\(/.test(rules), 'availability rules contain no data writes');
check(
  imports.length === 1 && /from ['"]backend\/roomAssignmentRules['"]/.test(imports[0]),
  'availability rules import only the pure assignment module'
);
check(!/backend\/roomInventory['"]/.test(rules), 'availability rules do not import the Wix inventory adapter');

const protectedFiles = [
  path.join(root, 'velo', 'page-booking-search.js'),
  path.join(root, 'velo', 'backend', 'search.web.js'),
  path.join(root, 'velo', 'backend', 'availability.web.js'),
  path.join(root, 'velo', 'backend', 'adminConsole.web.js'),
  path.join(root, 'velo', 'backend', 'roomInventory.js'),
  path.join(root, 'velo', 'backend', 'roomInventoryRules.js')
];
for (const file of protectedFiles) {
  const source = fs.readFileSync(file, 'utf8');
  check(!/roomAvailabilityRules/.test(source), path.relative(root, file) + ' remains disconnected from Module 3');
}
