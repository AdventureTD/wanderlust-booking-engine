'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'pins.json')));
function digest(p,binary=false){
 const raw=fs.readFileSync(path.join(ROOT,p));
 // Byte-preserving text admission: only paired CRLF becomes LF. No trimming,
 // decoding replacement, lone-CR deletion, or values derived into static pins.
 const admitted=binary?raw:Buffer.from(raw.toString('latin1').replace(/\r\n/g,'\n'),'latin1');
 return crypto.createHash('sha256').update(admitted).digest('hex');
}
function verify(){
 for(const [p,d] of Object.entries(manifest.support))assert.equal(digest(p,manifest.support_binary.includes(p)),d,p);
 for(const [p,v] of Object.entries(manifest.graph))assert.equal(digest(p),v.canonical_lf_sha256,p);
}
module.exports={ROOT,manifest,verify};
if(require.main===module)verify();
