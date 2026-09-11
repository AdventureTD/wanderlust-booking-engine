'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'pins-v1.json'),'utf8'));
function verify(){
 assert.equal(manifest.schema,'guest-invoice-portable-pins/v1');
 assert.equal(Object.keys(manifest.files).length,70,'finite closure required');
 for(const [id,pin] of Object.entries(manifest.files)){
  assert.ok(!path.isAbsolute(id)&&!id.includes('..')&&!id.includes('\\'),'relative member required');
  const file=path.resolve(ROOT,id);assert.ok(fs.realpathSync(file).startsWith(fs.realpathSync(ROOT)+path.sep),'escaped root');
  let bytes=fs.readFileSync(file);
  if(!pin.binary){assert.ok(!bytes.subarray(0,3).equals(Buffer.from([239,187,191])),'BOM forbidden: '+id);bytes=Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));assert.ok(!bytes.includes(13),'lone CR forbidden: '+id);}
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),pin.sha256,'source pin: '+id);
 }
 for(const [id,node] of Object.entries(manifest.graph))assert.equal(node.canonical_lf_sha256,manifest.files[id].sha256);
}
// Public, deterministic TEST entropy only. Distinct modes create distinct actual issuer subjects.
let counter=0;
const fixtureCrypto={...crypto,randomBytes(n){let out=Buffer.alloc(0);while(out.length<n)out=Buffer.concat([out,crypto.createHash('sha256').update('portable-inert-v1/'+(process.env.GI_CASE||'negative')+'/'+counter++).digest()]);return out.subarray(0,n);}};
module.exports={ROOT,manifest,verify,fixtureCrypto};
if(require.main===module){verify();console.log('CUSTODY PASS; runtime evaluated=0');}
