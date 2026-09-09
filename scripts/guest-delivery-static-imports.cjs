'use strict';
// Parse only. Never link, evaluate, import, or invoke application modules.
const fs = require('node:fs');
const vm = require('node:vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const result = {};
for (const [name, source] of Object.entries(input)) {
  result[name] = [...new vm.SourceTextModule(source, {identifier: name}).dependencySpecifiers].sort();
}
process.stdout.write(JSON.stringify(result));
