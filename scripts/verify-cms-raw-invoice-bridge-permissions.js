'use strict';

// Declaration metadata only: this does not emulate or prove Wix authorization.
// The real handler is compiled but never invoked; no secrets or network are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const filename = path.resolve(__dirname, '../velo/backend/issueInvoice.web.js');
const source = fs.readFileSync(filename, 'utf8');
const imports = [
  "import { Permissions, webMethod } from 'wix-web-module';",
  "import { fetch } from 'wix-fetch';",
  "import { getSecret } from 'wix-secrets-backend';",
  "import { getAllSettings } from 'backend/settings.web';",
];
const exportDeclaration = 'export const issueInvoice =';
const admissionImports = [
  "import { currentUser } from 'wix-users-backend';",
  "import { prepareOwnerIssuance, invoiceJournalOperation } from 'backend/invoiceEmailJournal';",
];
const admissionDeclaration = 'export const prepareOwnerInvoiceDispatch =';
const dispatchExports = ['getOwnerInvoiceDispatch', 'dispatchOwnerInvoice'];

function inspect(text, admission = true) {
  let executable = text;
  for (const declaration of [...imports, ...(admission ? admissionImports : [])]) {
    assert.equal(executable.split(declaration).length - 1, 1, 'Expected exact import');
    executable = executable.replace(declaration, '');
  }
  assert.equal(executable.split(exportDeclaration).length - 1, 1, 'Preserve issueInvoice export');
  executable = executable.replace(exportDeclaration, 'globalThis.issueInvoice =');
  if (admission) {
    assert.equal(executable.split(admissionDeclaration).length - 1, 1, 'Preserve exact admission export');
    executable = executable.replace(admissionDeclaration, 'globalThis.prepareOwnerInvoiceDispatch =');
    for (const name of dispatchExports) {
      const declaration = `export const ${name} =`;
      assert.equal(executable.split(declaration).length - 1, 1, `Preserve exact ${name} export`);
      executable = executable.replace(declaration, `globalThis.${name} =`);
    }
  }
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
    currentUser: { get id() { return unexpected(); } },
    prepareOwnerIssuance: unexpected,
    invoiceJournalOperation: unexpected,
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(executable, context, { filename, timeout: 1000 });
  assert.equal(declarations.length, admission ? 4 : 1, 'Exact webMethod declaration count');
  assert.deepEqual(Object.keys(context).filter(key => declarations.includes(context[key])),
    admission ? ['prepareOwnerInvoiceDispatch', ...dispatchExports, 'issueInvoice'] : ['issueInvoice']);
  assert.strictEqual(context.issueInvoice, declarations[admission ? 3 : 0]);
  if (admission) assert.strictEqual(context.prepareOwnerInvoiceDispatch, declarations[0]);
  if (admission) dispatchExports.forEach((name, index) => assert.strictEqual(context[name], declarations[index + 1]));
  return { ...context.issueInvoice, admission: context.prepareOwnerInvoiceDispatch,
    getOwnerInvoiceDispatch: context.getOwnerInvoiceDispatch, dispatchOwnerInvoice: context.dispatchOwnerInvoice };
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
assert.equal(original.admission.permission, 'Admin', 'prepareOwnerInvoiceDispatch must declare Permissions.Admin');
const admissionSite = 'export const prepareOwnerInvoiceDispatch = webMethod(Permissions.Admin,';
assert.equal(source.split(admissionSite).length - 1, 1);
const admissionReversed = inspect(source.replace(admissionSite, admissionSite.replace('Permissions.Admin', 'Permissions.Anyone')));
assert.equal(admissionReversed.admission.permission, 'Anyone');
assert.equal(admissionReversed.admission.handler.toString(), original.admission.handler.toString());
assert.equal(admissionReversed.handler.toString(), original.handler.toString());
assert.throws(() => assert.equal(admissionReversed.admission.permission, 'Admin'), {
  code: 'ERR_ASSERTION', actual: 'Anyone', expected: 'Admin',
});
assert.throws(() => inspect(source + '\nimport extra from "backend/unreviewed";'), { name: 'SyntaxError' });
assert.throws(() => inspect(source + '\nwebMethod(Permissions.Admin, () => {});'), /Exact webMethod declaration count/);
console.log('PASS: new Admin export reversal and unreviewed import/declaration isolation');

// Finite current-source witnesses: only these two actual dispatch/status exports.
for (const name of dispatchExports) {
  const assertDispatchAdmin = metadata => assert.equal(metadata[name].permission, 'Admin', `${name} must declare Permissions.Admin`);
  assertDispatchAdmin(original);
  const site = `export const ${name} = webMethod(Permissions.Admin,`;
  assert.equal(source.split(site).length - 1, 1, `Exactly one ${name} permission reversal site`);
  const reversedSource = source.replace(site, site.replace('Permissions.Admin', 'Permissions.Anyone'));
  const position = source.indexOf(site) + site.lastIndexOf('Admin');
  assert.equal(reversedSource.slice(0, position), source.slice(0, position));
  assert.equal(reversedSource.slice(position + 'Anyone'.length), source.slice(position + 'Admin'.length));
  const reversedMetadata = inspect(reversedSource);
  assert.equal(reversedMetadata[name].permission, 'Anyone');
  assert.equal(reversedMetadata.handler.toString(), original.handler.toString());
  assert.equal(reversedMetadata.admission.handler.toString(), original.admission.handler.toString());
  assert.equal(reversedMetadata.admission.permission, 'Admin');
  assertAdmin(reversedMetadata);
  for (const other of dispatchExports) {
    assert.equal(reversedMetadata[other].handler.toString(), original[other].handler.toString());
    if (other !== name) assert.equal(reversedMetadata[other].permission, 'Admin', `${other} permission unchanged`);
  }
  assert.throws(() => assertDispatchAdmin(reversedMetadata), {
    code: 'ERR_ASSERTION', actual: 'Anyone', expected: 'Admin',
  });
  console.log(`PASS: ${name} single-site Admin-to-Anyone reversal caught by the same declaration assertion`);
}

// Keep the historical permission witness and legacy callback causal comparison.
const baseline = execFileSync('git', ['show', '6bce9b12ce0a557f4eb7c73601a96a3e88d4b48b:velo/backend/issueInvoice.web.js'],
  { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
assert.equal(createHash('sha256').update(baseline).digest('hex'), '2031b697ba5588e121e44cff1bb569dd0d0d4fb38b301e8aaa1a0100859714dc');
const historical = inspect(baseline, false);
assertAdmin(historical);
assert.equal(historical.handler.toString().replace(/\r\n/g, '\n'), original.handler.toString().replace(/\r\n/g, '\n'),
  'Entire legacy callback unchanged under canonical LF comparison');
const historicalSites = [...baseline.matchAll(permissionSite)];
assert.equal(historicalSites.length, 1);
const historicalIndex = historicalSites[0].index + historicalSites[0][0].lastIndexOf('Admin');
const historicalMutant = inspect(baseline.slice(0, historicalIndex) + 'Anyone' + baseline.slice(historicalIndex + 'Admin'.length), false);
assert.equal(historicalMutant.handler.toString(), historical.handler.toString());
assert.throws(() => assertAdmin(historicalMutant), { code: 'ERR_ASSERTION', actual: 'Anyone', expected: 'Admin' });
console.log('PASS: exact baseline legacy callback and original Admin-to-Anyone causal assertion');
console.log('LIMIT: metadata inspection only; no actual Wix permission enforcement or service execution tested');
