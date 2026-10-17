'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'velo/custom-code/google-tag-and-consent.html'), 'utf8');
assert.ok(html.length <= 14900, `Whole pasted HTML must leave >=100 UTF-16 units below Wix's 15000 limit; got ${html.length}`);
const crlf = html.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
assert.ok(crlf.length < 15000, `Complete Windows-pasted HTML exceeds Wix cap: ${crlf.length}`);
// Documented packaging budget applies to BOTH newline representations (paid-touch-installation.md).
assert.ok(crlf.length <= 14900, `CRLF-pasted HTML exceeds 14900-unit packaging budget: ${crlf.length}`);
assert.ok(!html.includes('\r') && html.charCodeAt(0) !== 0xfeff && /^[\x00-\x7f]*$/.test(html), 'artifact must be LF-only ASCII without BOM');
console.log('PASS complete CRLF HTML size', crlf.length, 'project-budget headroom', 14900-crlf.length, '(Wix 15000 cap headroom', 15000-crlf.length + ')');
console.log('PASS whole pasted HTML size', JSON.stringify({utf16: html.length, unicode: [...html].length, bytes: Buffer.byteLength(html), budget: 14900, budgetHeadroom: 14900 - html.length}));
