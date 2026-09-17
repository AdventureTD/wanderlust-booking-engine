'use strict';
// Actual ESM backend graph. Only Wix SDK, webMethod wrapper and timer boundary inert.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
async function fixture(mode){
 const calls=[],timers=[];let release;
 const context=vm.createContext({setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}});
 context.record=(value)=>calls.push(JSON.parse(value));
 context.pause=()=>new Promise(r=>release=r);
 vm.runInContext(`const wixData={query(collection){return {ascending(k){return this},limit(n){return this},gt(){return this},async find(options){record(JSON.stringify({collection,options}));${mode==='timeout'?'await pause();':''} return {items:${mode==='duplicate'?"[{_id:'a',countryCode:'CA',consentRequired:false},{_id:'a',countryCode:'CA',consentRequired:false}]":mode==='invalidDate'?"[{_id:'a',countryCode:'CA',consentRequired:false,_updatedDate:new Date(NaN)}]":"[{_id:'a',countryCode:'CA',consentRequired:false}]"},hasNext(){return ${mode==='incomplete'||mode==='timeout'?'true':'false'}}}}}}};`,context);
 const cache=new Map();
 async function load(spec){
  if(cache.has(spec))return cache.get(spec);
  let m;
  if(spec.startsWith('backend/')){
   m=new vm.SourceTextModule(fs.readFileSync(path.join(root,'velo',spec+'.js'),'utf8'),{context});cache.set(spec,m);await m.link(load);return m;
  }
  const values=spec==='wix-data'?{default:vm.runInContext('wixData',context)}:spec==='crypto'?{createHash:require('node:crypto').createHash}:spec==='wix-web-module'?{Permissions:{Anyone:'Anyone'},webMethod:(permission,fn)=>{assert.equal(permission,'Anyone');return fn;}}:null;
  assert.ok(values,'allowed import '+spec);
  m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});cache.set(spec,m);return m;
 }
 const module=await load('backend/adsFormRequirement.web');await module.evaluate();
 return {call:module.namespace.getAdsFormRequirement,calls,timers,release:()=>release()};
}
(async()=>{
 for(const mode of ['incomplete','duplicate','invalidDate']){
  const f=await fixture(mode);assert.equal((await f.call()).requirement,'UNRESOLVED');
  assert.equal(f.calls.length,1);console.log('PASS backend '+mode);
 }
 const f=await fixture('timeout');const pending=f.call();
 for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(f.timers.length,1);assert.ok(f.timers[0].ms>0&&f.timers[0].ms<=10000);
 f.timers[0].fn();assert.equal((await pending).requirement,'UNRESOLVED');
 f.release();for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(f.calls.length,1,'late result cannot resume scan after deadline');
 console.log('PASS backend deadline latch and late result zero successor IO (inert timer invocation)');
 const ordinary=await fixture('ordinary');const a=await ordinary.call(),b=await ordinary.call();
 assert.equal(a.requirement,'NOT_REQUIRED');assert.equal(a.policyKey,b.policyKey);assert.equal(ordinary.calls.length,2,'no server cache');
 assert.deepEqual(ordinary.calls[0],{collection:'ConsentRequirements',options:{suppressAuth:true,consistentRead:true,suppressHooks:true}});
 assert.deepEqual(Object.keys(a).sort(),['observedAt','policyKey','requirement','v']);
 console.log('PASS backend fresh native read/minimal DTO/stable content comparison, not snapshot');
})().catch(e=>{console.error(e);process.exitCode=1;});
