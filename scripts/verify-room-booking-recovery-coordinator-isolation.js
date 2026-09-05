// Structural isolation guard for the disconnected recovery coordinator.
// Run: node scripts/verify-room-booking-recovery-coordinator-isolation.js
const fs = require('fs');
const path = require('path');
let assertions = 0;
function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error('FAIL: ' + message);
  console.log('PASS: ' + message);
}
function javascriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push.apply(files, javascriptFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}
const root = path.join(__dirname, '..');
const velo = path.join(root, 'velo');
const target = path.join(velo, 'backend', 'roomBookingRecoveryCoordinator.js');
const source = fs.readFileSync(target, 'utf8');
const imports = source.match(/^import[\s\S]*?;$/gm) || [];
const exportNames = (source.match(/export (?:async )?function\s+\w+/g) || [])
  .map(function(value) { return value.replace(/export (?:async )?function\s+/, ''); });
check(imports.length === 1 &&
  /^import \{ computeRoomBookingPayloadDigest \} from ['"]backend\/roomBookingPayloadDigest['"];$/.test(imports[0]),
  'recovery coordinator has exactly the synchronous payload-digest import');
check(JSON.stringify(exportNames) === JSON.stringify(['coordinatePhysicalBookingRecovery']),
  'recovery coordinator exposes only coordinatePhysicalBookingRecovery');
check(!/wix-data|wixData|wix-web-module|\bwebMethod\b|Permissions\.|fetch\s*\(/.test(source),
  'recovery coordinator has no Wix, database, public-web, or network integration');
check(!/roomBookingCommit|roomBookingRows|roomBookingRowRecovery|roomBookingCoordinator/.test(
  source.replace(/roomBookingRecoveryCoordinator/g, '')),
  'recovery coordinator imports no commit, row adapter, recovery adapter, or normal coordinator');
check(!/calendar|invoice|pricing|search|advertis|email|hook|job|provision|compensat/i.test(source),
  'recovery coordinator has no unrelated side-effect or compensation integration');
check(!/\.(?:insert|save|update|remove|bulkInsert|bulkUpdate|bulkRemove|query|get)\s*\(/.test(source),
  'recovery coordinator performs effects only through its two explicit ports');
for (const file of javascriptFiles(velo)) {
  if (file === target) continue;
  const other = fs.readFileSync(file, 'utf8');
  check(!/backend\/roomBookingRecoveryCoordinator['"]|roomBookingRecoveryCoordinator\.js/.test(other),
    path.relative(root, file) + ' remains disconnected from recovery coordination');
}
console.log(`Room booking recovery coordinator isolation passed (${assertions} assertions).`);
