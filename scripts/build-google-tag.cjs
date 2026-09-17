'use strict';
// Packaging only: no compression, renaming, property mangling or source maps.
// Keep all HTML (including loader order/attributes) byte-for-byte outside JS.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { minify } = require('terser');
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'velo/custom-code/google-tag-and-consent.source.html');
const outputPath = path.join(root, 'velo/custom-code/google-tag-and-consent.html');
async function build(source = fs.readFileSync(sourcePath, 'utf8')) {
  const matches = [...source.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi)];
  if (matches.length !== 2 || matches[0][2] !== '' || matches[1][1] !== '<script>') throw Error('Unexpected script structure; review build parser before changing HTML');
  const inline = matches[1];
  new vm.Script(inline[2]);
  const result = await minify(inline[2], {
    compress: false,
    mangle: false,
    sourceMap: false,
    format: { comments: false, ascii_only: true, inline_script: true, beautify: false }
  });
  new vm.Script(result.code);
  const start = inline.index + inline[1].length;
  const output = source.slice(0, start) + result.code + source.slice(start + inline[2].length);
  if (output.length > 14000) throw Error(`Whole HTML exceeds 14000-unit packaging budget: ${output.length}`);
  return output;
}
if (require.main === module) build().then(output => {
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(outputPath, 'utf8') !== output) throw Error('Stale generated Google tag; run npm run build:google-tag');
  } else fs.writeFileSync(outputPath, output);
  console.log(JSON.stringify({ utf16: output.length, unicode: [...output].length, bytes: Buffer.byteLength(output), remaining: 15000 - output.length }));
}).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { build };
