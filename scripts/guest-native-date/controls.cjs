'use strict';
// Finite disposable-copy tests. No application producer is executed.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'../..'),prefix='scripts/guest-native-date/';
const manifest=require('./custody.cjs').verify();
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'native-date-portability-'));
const results=[];
try {
 for(const p of [...Object.keys(manifest.files),prefix+'pins.json',prefix+'custody.cjs']){
  const target=path.join(tmp,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(ROOT,p),target);
 }
 const fixture=prefix+'ledger.json',source='velo/backend/guestBookingAllocationEvidence.js';
 const specs=[['lf',fixture,'lf',true],['paired-crlf',fixture,'crlf',true]];
 for(const target of [fixture,source,prefix+'pins.json'])for(const mutation of ['missing','append','lone-cr','bom','invalid'])specs.push([target+':'+mutation,target,mutation,false]);
 const binary=manifest.binary[0];specs.push(['binary-tamper',binary,'append',false]);
 const preload=path.join(tmp,'sentinel.cjs');fs.writeFileSync(preload,"const vm=require('vm');const old=vm.createContext;vm.createContext=(...a)=>{console.log('RUNTIME_VM_SENTINEL');return old(...a);};\n");
 for(const [id,rel,mutation,positive] of specs){
  const target=path.join(tmp,rel),original=fs.readFileSync(target);
  try{
   if(mutation==='missing')fs.unlinkSync(target);
   else fs.writeFileSync(target,mutation==='lf'?Buffer.from(original.toString('latin1').replace(/\r\n/g,'\n'),'latin1'):mutation==='crlf'?Buffer.from(original.toString('latin1').replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'),'latin1'):mutation==='bom'?Buffer.concat([Buffer.from([239,187,191]),original]):mutation==='invalid'?Buffer.from('{invalid'):Buffer.concat([original,Buffer.from(mutation==='lone-cr'?'\r':' ')]));
   for(const entry of ['custody.cjs','boundaries.cjs']){
    const r=cp.spawnSync(process.execPath,['--require',preload,path.join(tmp,prefix,entry)],{cwd:tmp,encoding:'utf8',timeout:30000});
    const sentinel=r.stdout?.includes('RUNTIME_VM_SENTINEL');
    const passed=positive?r.status===0&&(entry!=='boundaries.cjs'||sentinel):r.status!==0&&!sentinel;
    results.push({id,entry,exit:r.status,passed,runtimeEntered:!!sentinel,stdout:r.stdout,stderr:r.stderr});
   }
  }finally{fs.writeFileSync(target,original);}
 }
 console.log(JSON.stringify({cases:results.length,passed:results.every(r=>r.passed),results},null,2));
 assert.equal(results.length,36);assert(results.every(r=>r.passed));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
