// Run with TypeScript on NODE_PATH and WIX_FETCH_TYPES pointing to published wix-fetch.d.ts.
// Uses actual source without executing it; unrelated unresolved SDK imports remain visible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const sourcePath = process.env.CANCELLATION_SOURCE || path.join(__dirname, '../velo/backend/cancellationEffects.js');
const typesPath = process.env.WIX_FETCH_TYPES;
assert.ok(typesPath, 'WIX_FETCH_TYPES must identify the unmodified published Wix declaration');
function diagnostics(source) {
  const options = {allowJs:true, checkJs:true, noEmit:true, target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext, skipLibCheck:true};
  const host = ts.createCompilerHost(options);
  const original = host.readFile.bind(host);
  host.readFile = file => path.resolve(file) === path.resolve(sourcePath) ? source : original(file);
  const program = ts.createProgram([sourcePath, typesPath], options, host);
  return ts.getPreEmitDiagnostics(program).map(d => ({code:d.code, message:ts.flattenDiagnosticMessageText(d.messageText,' '), line:d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line+1 : null}));
}
const source = fs.readFileSync(sourcePath,'utf8');
const observed = diagnostics(source);
if (process.env.TYPING_DIAGNOSTICS_OUT) fs.writeFileSync(process.env.TYPING_DIAGNOSTICS_OUT, JSON.stringify({typescript:ts.version,sourcePath,typesPath,diagnostics:observed},null,2));
test('all cancellation fetch requests retain checked Wix-compatible extension options', () => {
  assert.deepEqual(observed.filter(d => d.code === 2353), []);
  assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)|@type\s*\{any\}/);
});
test('request extension annotations reject redirect, timeout and body type corruption', () => {
  for (const [from,to] of [["redirect:'error'","redirect:'follow'"],['timeout:8000',"timeout:'8000'"],['body:JSON.stringify(body)','body:123']]) {
    assert.ok(source.includes(from), 'mutation anchor: '+from);
    const mutated = diagnostics(source.replace(from,to));
    assert.ok(mutated.some(d => d.code === 2322), 'checked assignment rejects '+to);
  }
});
