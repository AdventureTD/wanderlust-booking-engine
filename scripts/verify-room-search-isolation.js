// Structural compatibility gate for physical inventory in Booking Search.
// Run: node scripts/verify-room-search-isolation.js
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

function check(condition, message) {
  console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
  if (!condition) process.exitCode = 1;
}

const root = path.join(__dirname, '..');
const searchPath = path.join(root, 'velo', 'backend', 'search.web.js');
const pagePath = path.join(root, 'velo', 'page-booking-search.js');
const coordinatorPath = path.join(root, 'velo', 'backend', 'roomAvailability.js');
const search = fs.readFileSync(searchPath, 'utf8');
const page = fs.readFileSync(pagePath, 'utf8');
const coordinator = fs.readFileSync(coordinatorPath, 'utf8');

const coordinatorImports = search.match(/^import[^\n;]+from ['"]backend\/roomAvailability['"];?\s*$/gm) || [];
check(coordinatorImports.length === 1 &&
  /import \{ loadRoomAvailability \} from ['"]backend\/roomAvailability['"]/.test(coordinatorImports[0]),
  'Search has exactly one narrow coordinator import');
check(!/roomAssignments|wixDataPaging|ownerBlocks|roomAvailabilityRules|roomInventory(?:Rules)?/.test(search),
  'Search does not import or reference rejected or lower-level inventory modules');
check(!/\.(insert|update|remove|save|bulkInsert|bulkUpdate|bulkRemove)\s*\(/.test(search),
  'Search integration adds no data-write operation');
check(/physicalCapMap\s*\(/.test(search) && /physicalAvailabilityFor\s*\(/.test(search),
  'Search validates and request-locally caches coordinator results');
check(/Math\.min\(units - maxBooked, physicalMaxQty\)/.test(search),
  'full availability remains the minimum of legacy and physical capacity');
check(/Math\.min\(minFreePartial, partialPhysicalMax\)/.test(search),
  'partial availability remains the minimum of legacy and exact-window physical capacity');
check(!/search\.web|page-booking-search/.test(coordinator),
  'coordinator remains independent of Search and page modules');

const baselinePage = childProcess.execFileSync('git', [
  'show', 'HEAD:velo/page-booking-search.js'
], { cwd: root, encoding: 'utf8' });
check(page.replace(/\r\n/g, '\n') === baselinePage.replace(/\r\n/g, '\n'),
  'Booking Search page source remains identical to HEAD');
check(!/backend\/roomAvailability['"]/.test(page),
  'Booking Search page does not directly import the coordinator');

const unrelatedProtectedFiles = [
  path.join(root, 'velo', 'backend', 'availability.web.js'),
  path.join(root, 'velo', 'backend', 'adminConsole.web.js'),
  path.join(root, 'velo', 'backend', 'roomInventory.js'),
  path.join(root, 'velo', 'backend', 'roomInventoryRules.js'),
  path.join(root, 'velo', 'backend', 'roomAvailabilityRules.js')
];
for (const file of unrelatedProtectedFiles) {
  const source = fs.readFileSync(file, 'utf8');
  check(!/backend\/roomAvailability['"]/.test(source),
    path.relative(root, file) + ' remains disconnected from the coordinator');
}
