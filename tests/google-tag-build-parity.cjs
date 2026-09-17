'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const cp = require('node:child_process');
const { parse } = require('acorn');
const { build } = require('../scripts/build-google-tag.cjs');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'velo/custom-code/google-tag-and-consent.html');
const source = fs.readFileSync(target.replace('.html', '.source.html'), 'utf8');
const deployed = fs.readFileSync(target, 'utf8');
const inline = html => html.match(/<script>([\s\S]*?)<\/script>/)[1];
const skeleton = html => html.replace(/(<script>)[\s\S]*?(<\/script>)/, '$1$2');
const ast = js => JSON.parse(JSON.stringify(parse(js, {ecmaVersion: 'latest', sourceType: 'script'}), (key, value) => ['start', 'end', 'raw'].includes(key) ? undefined : value));
(async () => {
  assert.equal(await build(), deployed, 'committed deploy artifact must equal fresh build');
  assert.equal(await build(), await build(), 'repeated builds must be identical');
  assert.equal(skeleton(deployed), skeleton(source), 'HTML, loader, attributes and script order unchanged');
  assert.deepEqual(ast(inline(deployed)), ast(inline(source)), 'identical AST apart from positions/literal spelling; no logic removed or renamed');
  new vm.Script(inline(deployed));
  assert.ok(!/sourceMappingURL|sourceURL/.test(deployed));
  console.log('PASS deterministic build, full HTML structure, script syntax and AST parity');
  // Execute the same inert full-chain and lifecycle suites in separate processes.
  // Only the readable comparison intercepts this single HTML file; the normal
  // runs below and all ordinary test commands read the real deploy artifact.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wbe-head-parity-'));
  try {
    const preload = path.join(scratch, 'readable.cjs');
    fs.writeFileSync(preload, `const fs=require('node:fs'),path=require('node:path');const read=fs.readFileSync;fs.readFileSync=function(file,...args){if(typeof file==='string'&&path.resolve(file)===${JSON.stringify(target)})file=${JSON.stringify(target.replace('.html', '.source.html'))};return read.call(this,file,...args);};`);
    let count = 0;
    for (const suite of ['ads-custom-form.cjs', 'ads-consent-lifecycle.cjs', 'ads-location-integration.cjs']) {
      const run = readable => cp.spawnSync(process.execPath, ['--experimental-vm-modules', ...(readable ? ['--require', preload] : []), path.join(root, 'tests', suite)], {cwd: root, encoding:'utf8', timeout:60000});
      const compact = run(false), readable = run(true);
      assert.equal(compact.status, 0, compact.stdout + compact.stderr);
      assert.equal(readable.status, 0, readable.stdout + readable.stderr);
      assert.equal(compact.stdout, readable.stdout, `${suite}: runtime case results must match`);
      count++;
      console.log(`PASS readable/deploy runtime parity: ${suite}`);
    }
    assert.equal(count, 3);
  } finally { fs.rmSync(scratch, {recursive:true, force:true}); }
})().catch(error => {console.error(error); process.exitCode=1;});
