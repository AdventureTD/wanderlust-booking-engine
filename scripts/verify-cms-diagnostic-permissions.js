const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const expected = {
  'debug.web.js': ['testQuery'],
  'diagnoseSearch.web.js': ['diagnoseSearch'],
  'diagnostics.web.js': ['getDataStatus', 'inspectAvailabilityData', 'testSearchDirect'],
  'listCollections.web.js': ['getNativeCollections'],
};
function inspect(name, source) {
  const declarations = [];
  const context = vm.createContext({
    wixData: Object.freeze({}), collections: Object.freeze({}),
    Permissions: Object.freeze({ Anyone: 'Anyone', Admin: 'Admin', SiteMember: 'SiteMember' }),
    webMethod(permission, handler) {
      assert.equal(typeof handler, 'function');
      const declaration = Object.freeze({ permission, handler });
      declarations.push(declaration);
      return declaration;
    },
  });
  const executable = source.replace(/^\s*import[^\n]*;\s*$/gm, '')
    .replace(/\bexport const (\w+)\s*=/g, 'globalThis.$1 =');
  vm.runInContext(executable, context, { filename: name, timeout: 1000 });
  const exports = Object.keys(context).filter(k => declarations.includes(context[k])).sort();
  assert.deepEqual(exports, expected[name]);
  assert.equal(declarations.length, expected[name].length);
  assert.ok(!/suppressAuth/.test(source), name + ' must not acquire a privileged generic-query bypass');
  return exports.map(key => ({ method: key, permission: context[key].permission }));
}
const observations = [];
for (const name of Object.keys(expected)) {
  const source = fs.readFileSync(path.join(root, 'velo/backend', name), 'utf8');
  for (const record of inspect(name, source)) observations.push({ file: name, ...record });
}
assert.ok(observations.every(r => r.permission === 'Admin'),
  'Every diagnostic export must be Admin-only: ' + JSON.stringify(observations));
console.log('PASS: ' + observations.length + ' real diagnostic declarations are Admin-only; exports preserved, no suppressAuth added');
let mutations = 0;
for (const name of Object.keys(expected)) {
  const source = fs.readFileSync(path.join(root, 'velo/backend', name), 'utf8');
  for (const match of source.matchAll(/Permissions\.Admin/g)) {
    const mutated = source.slice(0, match.index) + 'Permissions.Anyone' + source.slice(match.index + match[0].length);
    const records = inspect(name, mutated);
    assert.throws(() => assert.ok(records.every(r => r.permission === 'Admin')), { code: 'ERR_ASSERTION' });
    mutations++;
  }
}
assert.equal(mutations, observations.length);
console.log('PASS: ' + mutations + ' individual permission-reversal mutations caught by assertions');
