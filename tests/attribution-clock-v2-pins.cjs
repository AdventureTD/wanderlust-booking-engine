'use strict';
// Static authoring-time custody. Never regenerate pins during verification.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'attribution-clock-v2-sources.json'),'utf8'));
assert.equal(manifest.v,1);assert.ok(Object.keys(manifest.protected).length>=50);assert.ok(Object.keys(manifest.candidate).length>=7);
let count=0;
for(const group of ['protected','candidate','support'])for(const [name,pin] of Object.entries(manifest[group])){
 assert.ok(!path.isAbsolute(name)&&!name.split('/').includes('..'));
 const bytes=fs.readFileSync(path.join(root,name));
 const normalized=Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
 assert.equal(crypto.createHash('sha256').update(normalized).digest('hex'),pin.canonical_lf_sha256,name);count++;
}
const artifact=fs.readFileSync(path.join(root,'velo/custom-code/google-tag-and-consent.html'),'utf8');
assert.equal(artifact.length,14877);assert.ok(artifact.length<=14900);
console.log('PASS static v2 source custody '+count+' entries; protected booking/Summary/invoice graph unchanged');
