const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname,'../velo/backend',name),'utf8');

test('invoice comparator uses numeric Date values accepted by Wix checker', () => {
  const text = source('adminConsole.web.js');
  assert.match(text, /new Date\(b\._createdDate \|\| 0\)\.getTime\(\) - new Date\(a\._createdDate \|\| 0\)\.getTime\(\)/);
  const dates = [null, '2026-01-01', '2026-02-01', 'invalid'];
  for (const a of dates) for (const b of dates) {
    assert.ok(Object.is(new Date(b || 0) - new Date(a || 0), new Date(b || 0).getTime() - new Date(a || 0).getTime()));
  }
});
test('backend node-fetch redirect extension is explicitly typed without suppression or cast', () => {
  const text = source('cancellationEffects.js');
  assert.match(text, /@type \{\{method: string, redirect: 'error', headers: Object<string, string>, body: string\}\}/);
  assert.match(text, /const emailRequest = \{ method: 'post', redirect: 'error'/);
  assert.match(text, /fetch\(url \+ '\/v2\/send-cancellation-email', emailRequest\)/);
  assert.doesNotMatch(text, /@ts-(ignore|nocheck|expect-error)|@type\s*\{any\}/);
});
