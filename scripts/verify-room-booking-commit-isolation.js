// Structural guard for disconnected write-time room assignment modules.
// Run: node scripts/verify-room-booking-commit-isolation.js
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
const rulesPath = path.join(veloRoot, 'backend', 'roomBookingCommitRules.js');
const rules = fs.readFileSync(rulesPath, 'utf8');
const imports = rules.split('\n').filter(function(line) { return /^import /.test(line); });
const exportNames = (rules.match(/export function\s+\w+/g) || [])
  .map(function(statement) { return statement.replace('export function ', ''); })
  .sort();

check(!/\bwebMethod\b|wix-web-module|Permissions\./.test(rules),
  'pure commit rules expose no public web method');
check(!/wix-data|wixData|fetch\s*\(|getSecret|calendar|invoice|advertis|email/i.test(rules),
  'pure commit rules use no Wix, database, network, calendar, invoice, advertising, or email APIs');
check(!/\.(insert|update|remove|save|bulkInsert|bulkUpdate|bulkRemove)\s*\(/.test(rules),
  'pure commit rules contain no data writes');
check(imports.length === 1 && /from ['"]backend\/roomAvailabilityRules['"]/.test(imports[0]),
  'pure commit rules import only the pure availability evaluator');
check(JSON.stringify(exportNames) === JSON.stringify([
  'buildPhysicalCommitPlan',
  'planPhysicalRollback',
  'validatePhysicalCommit'
]), 'pure commit rules expose only plan, post-write validation, and rollback planning');

const adapterPath = path.join(veloRoot, 'backend', 'roomBookingCommit.js');
const adapter = fs.readFileSync(adapterPath, 'utf8');
const adapterImports = adapter.split('\n').filter(function(line) { return /^import /.test(line); });
const adapterExports = (adapter.match(/export async function\s+\w+/g) || [])
  .map(function(statement) { return statement.replace('export async function ', ''); })
  .sort();
check(adapterImports.length === 1 && /from ['"]wix-data['"]/.test(adapterImports[0]),
  'claim adapter imports only wix-data');
check(JSON.stringify(adapterExports) === JSON.stringify([
  'appendRoomClaimEvents',
  'loadCompletedRoomClaimSet',
  'loadRoomClaimLedger'
]), 'claim adapter exposes only ledger read, completed evidence read, and sequential append operations');
check(!/\bwebMethod\b|wix-web-module|Permissions\./.test(adapter),
  'claim adapter exposes no public web method');
check(!/\.(save|update|remove|bulkInsert|bulkUpdate|bulkRemove)\s*\(/.test(adapter),
  'claim adapter uses no overwrite, delete, or bulk persistence API');
check(!/from ['"]backend\//.test(adapter),
  'claim adapter remains disconnected from booking, search, and orchestration modules');

const protectedFiles = javascriptFiles(veloRoot).filter(function(file) {
  return file !== rulesPath && file !== adapterPath;
});
for (const file of protectedFiles) {
  const source = fs.readFileSync(file, 'utf8');
  check(!/backend\/roomBookingCommitRules['"]|roomBookingCommitRules\.js/.test(source),
    path.relative(root, file) + ' remains disconnected from pure commit rules');
  check(!/backend\/roomBookingCommit['"]|roomBookingCommit\.js/.test(source),
    path.relative(root, file) + ' remains disconnected from the future commit adapter');
}
