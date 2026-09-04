// Structural guard for disconnected deterministic booking-row persistence.
// Run: node scripts/verify-room-booking-row-isolation.js
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
const adapterPath = path.join(veloRoot, 'backend', 'roomBookingRows.js');
const adapter = fs.readFileSync(adapterPath, 'utf8');
const imports = adapter.split('\n').filter(function(line) { return /^import /.test(line); });
const exportNames = (adapter.match(/export async function\s+\w+/g) || [])
  .map(function(statement) { return statement.replace('export async function ', ''); })
  .sort();

check(imports.length === 1 && /from ['"]wix-data['"]/.test(imports[0]),
  'booking-row adapter imports only wix-data');
check(JSON.stringify(exportNames) === JSON.stringify([
  'appendPhysicalBookingRows',
  'loadOperationBookingRows'
]), 'booking-row adapter exposes only deterministic load and append ports');
check(!/\bwebMethod\b|wix-web-module|Permissions\./.test(adapter),
  'booking-row adapter exposes no public web method');
check(!/\.(save|update|remove|bulkInsert|bulkUpdate|bulkRemove)\s*\(/.test(adapter),
  'booking-row adapter cannot overwrite, delete, or bulk-write booking rows');
check(!/from ['"]backend\//.test(adapter),
  'booking-row adapter has no orchestration or production backend dependency');
check(!/BookingSummary|Calendar|invoice|advertis|email|fetch\s*\(/i.test(adapter),
  'booking-row adapter has no summary, Calendar, invoice, advertising, email, or network side effect');

for (const file of javascriptFiles(veloRoot)) {
  if (file === adapterPath) continue;
  const source = fs.readFileSync(file, 'utf8');
  check(!/backend\/roomBookingRows['"]|roomBookingRows\.js/.test(source),
    path.relative(root, file) + ' remains disconnected from booking-row persistence');
}
