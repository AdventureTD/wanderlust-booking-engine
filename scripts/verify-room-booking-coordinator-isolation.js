// Structural guard for the disconnected booking coordinator tracer.
// Run: node scripts/verify-room-booking-coordinator-isolation.js
const fs = require('fs');
const path = require('path');

function check(condition, message) {
  console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
  if (!condition) process.exitCode = 1;
}

function javascriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push.apply(files, javascriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

const root = path.join(__dirname, '..');
const veloRoot = path.join(root, 'velo');
const coordinatorPath = path.join(veloRoot, 'backend', 'roomBookingCoordinator.js');
const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
const exportNames = (coordinator.match(/export async function\s+\w+/g) || [])
  .map(function(statement) { return statement.replace('export async function ', ''); });

check(!/^import /m.test(coordinator), 'booking coordinator tracer has no platform imports');
check(JSON.stringify(exportNames) === JSON.stringify(['coordinatePhysicalBookingCommit']),
  'booking coordinator tracer exposes only its explicit-port orchestration function');
check(!/\bwebMethod\b|wix-web-module|Permissions\./.test(coordinator),
  'booking coordinator tracer exposes no public web method');
check(!/wix-data|wixData|fetch\s*\(|getSecret|calendar|invoice|advertis|email/i.test(coordinator),
  'booking coordinator tracer uses no Wix, database, network, Calendar, invoice, advertising, or email APIs');
check(!/\.(insert|save|update|remove|bulkInsert|bulkUpdate|bulkRemove)\s*\(/.test(coordinator),
  'booking coordinator tracer performs effects only through explicit ports');

for (const file of javascriptFiles(veloRoot)) {
  if (file === coordinatorPath) continue;
  const source = fs.readFileSync(file, 'utf8');
  check(!/backend\/roomBookingCoordinator['"]|roomBookingCoordinator\.js/.test(source),
    path.relative(root, file) + ' remains disconnected from the booking coordinator tracer');
}
