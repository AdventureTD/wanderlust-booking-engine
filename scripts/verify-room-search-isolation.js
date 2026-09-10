// Structural compatibility gate for physical inventory in Booking Search.
// Run: node scripts/verify-room-search-isolation.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
  /import \{ loadRoomAvailabilityWindowReader \} from ['"]backend\/roomAvailability['"]/.test(coordinatorImports[0]),
  'Search has exactly one narrow coordinator import');
check(!/roomAssignments|wixDataPaging|ownerBlocks|roomAvailabilityRules|roomInventory(?:Rules)?/.test(search),
  'Search does not import or reference rejected or lower-level inventory modules');
check(!/\.(insert|update|remove|save|bulkInsert|bulkUpdate|bulkRemove)\s*\(/.test(search),
  'Search integration adds no data-write operation');
check(/physicalCapMap\s*\(/.test(search) && /physicalAvailabilityFor\s*\(/.test(search),
  'Search validates and request-locally caches coordinator results');
check(search.includes('? physicalCaps[code] : 0;') && !/maxBooked|BOOKING_SUMMARY|loadAllBookings/.test(search),
  'full availability uses only validated Bookings-first snapshot capacity');
check(search.includes('const caps = await physicalAvailabilityFor(windowStart, windowEnd);') &&
  search.includes('const partialMaxQty = partialWindow.quantity;'),
  'partial availability uses the validated exact-window quantity');
check(!/search\.web|page-booking-search/.test(coordinator),
  'coordinator remains independent of Search and page modules');

// Exact approved source pin; only checkout CRLF is canonicalized, never trim.
check(crypto.createHash('sha256').update(page.replace(/\r\n/g, '\n')).digest('hex') ===
  '220392d3bd25315f2a1f73bb2bedd5e9346688835932f224138d84707b73dd69',
  'Booking Search page matches the approved picker source');
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
