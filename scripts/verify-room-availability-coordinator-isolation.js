// Structural guard for the backend-only availability coordinator.
// Run: node scripts/verify-room-availability-coordinator-isolation.js
const fs = require('fs');
const path = require('path');

function check(condition, message) {
  console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
  if (!condition) process.exitCode = 1;
}

const root = path.join(__dirname, '..');
const coordinatorPath = path.join(root, 'velo', 'backend', 'roomAvailability.js');
const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
const imports = coordinator.split('\n').filter(function(line) { return /^import /.test(line); });
const exportStatements = coordinator.match(/export\s+(?:async\s+)?function\s+\w+/g) || [];

check(!/\bwebMethod\b|wix-web-module|Permissions\./.test(coordinator),
  'coordinator exposes no public web method or permissions');
check(!/wix-data|wixData|fetch\s*\(|getSecret/.test(coordinator),
  'coordinator directly uses no database, network, or secret APIs');
check(!/\.(insert|update|remove|save|bulkInsert|bulkUpdate|bulkRemove)\s*\(/.test(coordinator),
  'coordinator contains no data writes');
check(imports.length === 2, 'coordinator has exactly two imports');
check(imports.some(function(line) {
  return /import \{ loadInventorySnapshot \} from ['"]backend\/roomInventory['"]/.test(line);
}), 'coordinator imports only the inventory snapshot reader operation');
check(imports.some(function(line) {
  return /import \{ maximumAutomaticQuantity \} from ['"]backend\/roomAvailabilityRules['"]/.test(line);
}), 'coordinator imports only the pure maximum-availability operation');
check(!/roomAssignments|wixDataPaging|ownerBlocks|calendar|adminConsole|search\.web/.test(coordinator),
  'coordinator does not restore rejected assignment, paging, owner, calendar, admin, or Search dependencies');
check(exportStatements.length === 1 && /loadRoomAvailability$/.test(exportStatements[0]),
  'coordinator exports only loadRoomAvailability');

const protectedFiles = [
  path.join(root, 'velo', 'page-booking-search.js'),
  path.join(root, 'velo', 'backend', 'search.web.js'),
  path.join(root, 'velo', 'backend', 'availability.web.js'),
  path.join(root, 'velo', 'backend', 'adminConsole.web.js'),
  path.join(root, 'velo', 'backend', 'roomInventory.js'),
  path.join(root, 'velo', 'backend', 'roomInventoryRules.js'),
  path.join(root, 'velo', 'backend', 'roomAvailabilityRules.js')
];
for (const file of protectedFiles) {
  const source = fs.readFileSync(file, 'utf8');
  check(!/backend\/roomAvailability['"]/.test(source),
    path.relative(root, file) + ' remains disconnected from the coordinator');
}
