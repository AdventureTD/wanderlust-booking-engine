// Offline native-module boundary: real resolver/reader, inert Wix SDK only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const prep = '0dc2bbde66b7bd52c8f5ebf66449277dc0f77d76';
function source(name) {
  const file = path.join(root, 'velo/backend', name+'.js');
  return fs.existsSync(file) ? fs.readFileSync(file,'utf8') : cp.execFileSync('git',['show',`${prep}:velo/backend/${name}.js`],{cwd:root,encoding:'utf8'});
}
async function run(rows, adapter = false) {
  const context = vm.createContext({setTimeout,clearTimeout,createHash:require('node:crypto').createHash});
  const calls=[];
  context.sdkFind = (collection,after,limit,opts)=> {
    calls.push({collection,after,limit,opts});
    if (rows === 'error') throw Error('inert SDK unavailable');
    return JSON.stringify(rows.filter(r=>!after||r._id>after).slice(0,limit));
  };
  vm.runInContext(`const wixData={query(collection){let after='',size=100;return {gt(k,v){after=v;return this},ascending(){return this},limit(n){size=n;return this},async find(opts){const items=JSON.parse(sdkFind(collection,after,size,opts));return {items,hasNext(){return items.length===size}}}}}};`,context);
  vm.runInContext(source('guestConsentLocationPolicy').replace('export function','function')+'\nglobalThis.resolveGuestConsentRequirement=resolveGuestConsentRequirement;',context);
  // Separate module scopes; actual import is bound to real module export in same realm.
  vm.runInContext('(function(){'+source('guestConsentRequirementsReader').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function')+'\nglobalThis.readGuestConsentRequirementsObservation=readGuestConsentRequirementsObservation;})();',context);
  if(adapter) {
    const file=path.join(root,'velo/backend/adsFormRequirement.web.js');
    if(!fs.existsSync(file)) return {result:'UNRESOLVED',calls};
    vm.runInContext('const Permissions={Anyone:"Anyone"}; function webMethod(permission, fn){if(permission!=="Anyone")throw Error("permission");return fn}',context);
    vm.runInContext('(function(){'+fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace('export const','const')+'\nglobalThis.getAdsFormRequirement=getAdsFormRequirement;})();',context);
    const result=await vm.runInContext('getAdsFormRequirement()',context);
    return {result:result.requirement,calls,context};
  }
  const result = await vm.runInContext(`(async()=>{const o=await readGuestConsentRequirementsObservation(); if(o.status!=='OBSERVED') return 'UNRESOLVED'; return resolveGuestConsentRequirement({v:1,location:{status:'UNKNOWN'},requirements:{status:'COMPLETE',rows:o.rules}});})()`,context);
  return {result,calls};
}
(async()=>{
  const empty=await run([]);
  assert.equal(empty.result,'NOT_REQUIRED','complete valid empty rules do not need geography');
  assert.equal(empty.calls.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(empty.calls[0].opts)),{suppressAuth:true,consistentRead:true,suppressHooks:true});
  console.log('PASS empty complete rules without geographic lookup');
  assert.equal((await run([],true)).result,'NOT_REQUIRED','native web adapter exposes current no-geography policy');
  console.log('PASS native web adapter');
  const rule=(id,countryCode,usStateCode,consentRequired)=>({_id:id,countryCode,usStateCode,consentRequired});
  const cases=[
    ['allfalse',[rule('a','US','',false),rule('b','CA','',false)],'NOT_REQUIRED'],
    ['future country true',[rule('a','CA','',true)],'UNRESOLVED'],
    ['future state true',[rule('a','US','CA',true)],'UNRESOLVED'],
    ['invalid country',[rule('a','XX','',false)],'UNRESOLVED'],
    ['invalid state',[rule('a','US','ZZ',false)],'UNRESOLVED'],
    ['string boolean',[rule('a','CA','','false')],'UNRESOLVED'],
    ['SDK error','error','UNRESOLVED'],
    ['absent optional state',[{_id:'a',countryCode:'CA',consentRequired:false}],'NOT_REQUIRED'],
    ['null optional state',[rule('a','CA',null,false)],'UNRESOLVED'],
    ['late positive page',Array.from({length:101},(_,i)=>rule(String(i).padStart(4,'0'),'US','CA',i===100)),'UNRESOLVED'],
    ['overflow',Array.from({length:4097},(_,i)=>rule(String(i).padStart(4,'0'),'CA','',false)),'UNRESOLVED']
  ];
  for(const [name,rows,expected] of cases){assert.equal((await run(rows,true)).result,expected,name);console.log('PASS '+name)}
  const endpoint=await run([],true);
  assert.equal((await vm.runInContext('getAdsFormRequirement({location:{status:"KNOWN",countryCode:"CA"}})',endpoint.context)).requirement,'UNRESOLVED');
  assert.equal(endpoint.calls.length,1,'caller input rejected before additional SDK IO');
  console.log('PASS rejects caller supplied authority');
  console.log('TOTAL 14 cases');
})().catch(e=>{console.error(e);process.exitCode=1});
