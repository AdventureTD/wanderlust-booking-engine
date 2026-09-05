// Exercise the real structural gate with read-only source overlays.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const gatePath = path.join(__dirname, 'verify-room-booking-commit-isolation.js');
const plannerPath = path.join(root, 'velo/backend/wholeCartPlanningRules.js');
const summaryPath = path.join(root, 'velo/page-booking-summary.js');
const gate = fs.readFileSync(gatePath, 'utf8');
function run(overrides = new Map()) {
  const output = [], processState = {exitCode: 0};
  const facade = Object.create(fs);
  facade.readFileSync = (file, options) => overrides.has(path.resolve(file)) ? overrides.get(path.resolve(file)) : fs.readFileSync(file, options);
  vm.runInNewContext(gate, {
    require(name) { return name === 'fs' ? facade : require(name); },
    __dirname, process: processState, console: {log(line) { output.push(line); }}
  }, {timeout: 10000});
  return {exitCode: processState.exitCode, failures: output.filter(line => line.startsWith('FAIL:'))};
}
const baseline = run();
assert.equal(baseline.exitCode, 0, 'legitimate disconnected pure planner must pass isolation: '+baseline.failures.join('; '));
console.log('PASS: legitimate disconnected pure planner passes the real structural gate');
const plannerSource = fs.readFileSync(plannerPath, 'utf8');
const withDatabaseImport = run(new Map([[path.resolve(plannerPath), "import wixData from 'wix-data';\n" + plannerSource]]));
assert.equal(withDatabaseImport.exitCode, 1, 'planner must not gain a database import through the pure dependency exception');
console.log('PASS: pure planner exception rejects a database import');
const injections = [
  ['dynamic dependency', plannerPath, plannerSource + "\nimport('wix-data');\n"],
  ['network call', plannerPath, plannerSource + "\nfetch('https://example.invalid');\n"],
  ['database write', plannerPath, plannerSource + "\nwixData.insert('Bookings', {});\n"],
  ['public endpoint', plannerPath, plannerSource + "\nwebMethod(Permissions.Anyone, buildWholeCartAllocation);\n"],
  ['production consumer', summaryPath, fs.readFileSync(summaryPath, 'utf8') + "\nimport { buildWholeCartAllocation } from 'backend/wholeCartPlanningRules';\n"]
];
const outcomes = injections.map(([name, file, source]) => ({name, exitCode: run(new Map([[path.resolve(file), source]])).exitCode}));
assert.deepEqual(outcomes.map(r => r.exitCode), injections.map(() => 1), 'every route out of the disconnected planner must stay forbidden: '+JSON.stringify(outcomes));
for (const outcome of outcomes) console.log('PASS: gate rejects '+outcome.name);
