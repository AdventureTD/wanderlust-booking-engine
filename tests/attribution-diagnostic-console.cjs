'use strict';
const assert = require('node:assert/strict');
// Model Wix's opaque worker-console object rendering, not application logging.
function render(value) { return typeof value === 'string' ? value : 'Object No Properties'; }
function events(values) {
  const copied = values.map(render).filter(x => x.includes('ATTR_DIAG'));
  return copied.map(text => {
    assert.ok(text.startsWith('ATTR_DIAG '));
    const value = JSON.parse(text.slice('ATTR_DIAG '.length));
    assert.deepEqual(Object.keys(value).sort(), ['event', 'reason', 'stage', 'v']);
    assert.equal(value.event, 'ATTR_DIAG');
    assert.equal(value.v, 1);
    assert.equal(typeof value.stage, 'string');
    assert.equal(typeof value.reason, 'string');
    assert.ok(text.length < 190);
    return value;
  });
}
assert.equal(render({event:'ATTR_DIAG'}), 'Object No Properties');
module.exports = {render, events};
