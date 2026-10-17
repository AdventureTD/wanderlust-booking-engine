'use strict';
// Runs synthetic/offline harnesses only. No Wix editor or live booking access.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const out=path.resolve(process.env.WBE_TEST_OUTPUT || path.join(root,'.test-results'));
fs.mkdirSync(out,{recursive:true});
const names=process.argv.slice(2);
const files=(names.length?names:fs.readdirSync(path.join(root,'tests')).filter(n=>/\.(cjs|test\.js)$/.test(n))).sort();
const env={...process.env,NODE_PATH:path.join(root,'node_modules'),WIX_FETCH_TYPES:path.join(root,'node_modules/corvid-types/types/common/wix-fetch.d.ts')};
let results={};
for(const file of files){
 if(!/^[a-zA-Z0-9_.-]+$/.test(file))throw Error('Invalid test filename');
 const r=cp.spawnSync(process.execPath,['--experimental-vm-modules',path.join(root,'tests',file)],{cwd:root,env,encoding:'utf8',timeout:1800000,maxBuffer:32*1024*1024});
 const log=(r.stdout||'')+(r.stderr||'');
 fs.writeFileSync(path.join(out,file+'.log'),log);
 results[file]={rc:r.status,signal:r.signal,error:r.error?String(r.error.message):null};
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results},null,2));
 console.log(file+': '+r.status);
}
const failed=Object.entries(results).filter(([,r])=>r.rc!==0);
console.log(JSON.stringify({files:files.length,passed:files.length-failed.length,failed:failed.map(([n])=>n)}));
process.exitCode=failed.length?1:0;
