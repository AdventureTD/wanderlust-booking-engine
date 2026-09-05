// Structural isolation guard for strict missing-suffix booking-row recovery.
// Run: node scripts/verify-room-booking-row-recovery-isolation.js
const fs = require('fs');
const path = require('path');
let assertions = 0;
function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error('FAIL: ' + message);
  console.log('PASS: ' + message);
}
const root = path.join(__dirname, '..');
const adapterPath = path.join(root, 'velo', 'backend', 'roomBookingRowRecovery.js');
const source = fs.readFileSync(adapterPath, 'utf8');
const imports = source.split('\n').filter(line => /^import /.test(line));
const exportNames = (source.match(/export (?:async )?function\s+\w+/g) || [])
  .map(value => value.replace(/export (?:async )?function\s+/, ''));
check(imports.length === 1 && /^import wixData from ['"]wix-data['"];$/.test(imports[0]),
  'adapter imports only wix-data');
check(JSON.stringify(exportNames) === JSON.stringify(['appendMissingPhysicalBookingRows']),
  'adapter exports only appendMissingPhysicalBookingRows');
check(/\bwixData\b/.test(source) && /\bquery\b/.test(source) && /\bget\b/.test(source) && /\binsert\b/.test(source),
  'adapter is limited to Bookings query/get/insert persistence');
check(!/\.(?:save|update|remove|bulkInsert|bulkUpdate|bulkRemove)\s*\(/.test(source),
  'adapter has no overwrite, delete, or bulk-write operation');
check(!/\bwebMethod\b|wix-web-module|Permissions\./.test(source),
  'adapter exposes no public integration');
check(!/from ['"]backend\//.test(source),
  'adapter has no backend orchestration dependency');
check(!/BookingSummary|RoomBookingClaimEvents|Calendar|invoice|advertis|email|fetch\s*\(/i.test(source),
  'adapter has no unrelated side-effect dependency');
check((source.match(/['"]Bookings['"]/g) || []).length === 1,
  'Bookings is the adapter’s only collection');
console.log(`Room booking row recovery isolation passed (${assertions} assertions).`);
