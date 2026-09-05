'use strict';

// Declaration metadata only: this does not emulate or prove Wix authorization.
// The real handler is compiled but never invoked; no secrets or network are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../velo/backend/issueInvoice.web.js');
const source = fs.readFileSync(filename, 'utf8');
const imports = [
  "import { Permissions, webMethod } from 'wix-web-module';",
  "import { fetch } from 'wix-fetch';",
  "import { getSecret } from 'wix-secrets-backend';",
  "import { getAllSettings } from 'backend/settings.web';",
];
const exportDeclaration = 'export const issueInvoice =';

function inspect(text) {
  let executable = text;
  for (const declaration of imports) {
    assert.equal(executable.split(declaration).length - 1, 1, 'Expected exact import');
    executable = executable.replace(declaration, '');
  }
  assert.equal(executable.split(exportDeclaration).length - 1, 1, 'Preserve issueInvoice export');
  executable = executable.replace(exportDeclaration, 'globalThis.issueInvoice =');
  const declarations = [];
  const unexpected = () => assert.fail('Declaration inspection must not call dependencies');
  const context = vm.createContext({
    Permissions: Object.freeze({ Admin: 'Admin', Anyone: 'Anyone', SiteMember: 'SiteMember' }),
    webMethod(permission, handler) {
      assert.equal(typeof handler, 'function');
      const metadata = Object.freeze({ permission, handler });
      declarations.push(metadata);
      return metadata;
    },
    fetch: unexpected,
    getSecret: unexpected,
    getAllSettings: unexpected,
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(executable, context, { filename, timeout: 1000 });
  assert.equal(declarations.length, 1, 'Exactly one webMethod declaration');
  assert.deepEqual(Object.keys(context).filter(key => declarations.includes(context[key])), ['issueInvoice']);
  assert.strictEqual(context.issueInvoice, declarations[0]);
  return context.issueInvoice;
}

function assertAdmin(metadata) {
  assert.equal(metadata.permission, 'Admin', 'issueInvoice must declare Permissions.Admin');
}

const original = inspect(source);
assertAdmin(original);
console.log('PASS: real issueInvoice declaration is Admin; export and callback present (not invoked)');

const permissionSite = /export const issueInvoice = webMethod\(\s*Permissions\.(Admin)\b/g;
const sites = [...source.matchAll(permissionSite)];
assert.equal(sites.length, 1, 'Exactly one declaration permission reversal site');
const index = sites[0].index + sites[0][0].lastIndexOf('Admin');
const reversed = source.slice(0, index) + 'Anyone' + source.slice(index + 'Admin'.length);
assert.equal(reversed.slice(0, index), source.slice(0, index));
assert.equal(reversed.slice(index + 'Anyone'.length), source.slice(index + 'Admin'.length));
const mutated = inspect(reversed);
assert.equal(mutated.permission, 'Anyone');
assert.equal(mutated.handler.toString(), original.handler.toString(), 'Reversal preserves entire callback');
assert.throws(() => assertAdmin(mutated), {
  code: 'ERR_ASSERTION',
  actual: 'Anyone',
  expected: 'Admin',
});
console.log('PASS: single-site Admin-to-Anyone reversal caught by the same declaration assertion');
console.log('LIMIT: metadata inspection only; no actual Wix permission enforcement or service execution tested');
