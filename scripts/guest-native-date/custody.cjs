'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'../..');
// Frozen author-time digest. Never update from current input during verification.
const MANIFEST_SHA256='533804ffeb1c95db555544c25fef623467631ea5293453883507f7b98fbc8d4f';
function canonical(raw){return Buffer.from(raw.toString('latin1').replace(/\r\n/g,'\n'),'latin1');}
function sha(raw){return crypto.createHash('sha256').update(raw).digest('hex');}
function verify(){
 const raw=fs.readFileSync(path.join(__dirname,'pins.json'));
 assert.equal(sha(canonical(raw)),MANIFEST_SHA256,'manifest custody');
 const manifest=JSON.parse(raw.toString('utf8'));
 assert.equal(manifest.schema,1);assert.equal(Object.keys(manifest.files).length,98);
 assert(Array.isArray(manifest.binary));
 for(const [p,digest] of Object.entries(manifest.files)){
  assert(/^[A-Za-z0-9_.\/-]+$/.test(p)&&!p.startsWith('/')&&!p.split('/').includes('..'),'repo-relative finite path');
  assert(/^[a-f0-9]{64}$/.test(digest));
  const bytes=fs.readFileSync(path.join(ROOT,p));
  assert.equal(sha(manifest.binary.includes(p)?bytes:canonical(bytes)),digest,p);
 }
 return manifest;
}
module.exports={ROOT,verify};
if(require.main===module)verify();
