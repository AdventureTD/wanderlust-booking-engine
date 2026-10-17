'use strict';
// Fail if this release drifts into booking backend or nontracking Summary work.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),acorn=require('acorn');
const root=path.resolve(__dirname,'..');
const manifest=require('./fixtures/attribution-only-scope.json');
const digest=s=>crypto.createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
for(const [file,hash] of Object.entries(manifest.backend))assert.equal(digest(fs.readFileSync(path.join(root,file),'utf8')),hash,'baseline backend changed: '+file);
const actual=fs.readdirSync(path.join(root,'velo/backend')).filter(n=>/\.js$/.test(n)).map(n=>'velo/backend/'+n).sort();
assert.deepEqual(actual,[...Object.keys(manifest.backend),'velo/backend/publicFlags.web.js'].sort(),'unexpected backend additions/removals');
const text=fs.readFileSync(path.join(root,'velo/page-booking-summary.js'),'utf8').replace(/\r\n/g,'\n');
const tree=acorn.parse(text,{ecmaVersion:'latest',sourceType:'module'});
const functions=Object.fromEntries(tree.body.filter(n=>n.type==='FunctionDeclaration').map(n=>[n.id.name,text.slice(n.start,n.end)]));
for(const [name,hash] of Object.entries(manifest.summaryFunctions)){
 let body=functions[name];assert.equal(typeof body,'string',name);
 if(name==='wireContinueButton'){
  assert.equal(body.split('await _trackingFlags;').length-1,1,'one bounded flag await');
  body=body.replace('      await _trackingFlags;\n','');
 }
 assert.equal(digest(body),hash,'Summary business function changed: '+name);
}
assert.deepEqual(Object.keys(functions).sort(),manifest.functionNames.sort());
assert.ok(!text.includes('bookingSummaryReporting.web'));
assert.ok(!fs.existsSync(path.join(root,'research/m0-checkout-contract')));
console.log('PASS attribution-only scope: baseline booking backends and protected Summary functions unchanged; only publicFlags backend added.');
