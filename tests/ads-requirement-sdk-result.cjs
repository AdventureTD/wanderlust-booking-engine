'use strict';
// Source-linked ESM; inert Wix only. Same-realm arrays/rows, native crypto.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
async function fixture(mode){
 const timers=[];let release;
 const context=vm.createContext({setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},pause:()=>new Promise(r=>release=r)});
 context.mode=mode;
 vm.runInContext(`
 globalThis.trace={finds:0,getters:0,hasNext:0,rowGetters:0};
 function row(i){return {_id:String(i).padStart(5,'0'),countryCode:'CA',consentRequired:mode==='true',_updatedDate:new Date(0)};}
 class Result {
  constructor(rows,more){this.rows=rows;this.more=more;this.reads=0;}
  get items(){
   if(!(this instanceof Result)||++this.reads!==1)throw Error('items receiver/repeated read');
   trace.getters++;
   if(mode==='throwGetter')throw Error('inert');
   return this.rows;
  }
  hasNext(){
   if(!(this instanceof Result)||this.reads!==1)throw Error('hasNext receiver');trace.hasNext++;
   if(mode==='throwNext')throw Error('inert');
   if(mode==='mutate')this.rows[0].consentRequired=true;
   return mode==='invalidNext'?'false':this.more;
  }
 }
 class Query {
  gt(key,id){if(key!=='_id'||id!==String(trace.finds*100-1).padStart(5,'0'))throw Error('cursor');return this;}
  ascending(key){if(key!=='_id')throw Error('order');return this;}
  limit(n){if(n!==100)throw Error('limit');return this;}
  async find(o){
   const page=trace.finds++;
   if(Object.keys(o).sort().join(',')!=='consistentRead,suppressAuth,suppressHooks'||o.suppressAuth!==true||o.consistentRead!==true||o.suppressHooks!==true)throw Error('options');
   if(mode==='reject')throw Error('inert');
   if(mode==='hung')await pause();
   let rows=mode==='empty'||mode==='hung'?[]:[row(page*100)];
   if(mode==='malformed')rows={length:0};
   if(mode==='oversize')rows=Array.from({length:101},(_,i)=>row(i));
   if(mode==='duplicate')rows=[row(0),row(0)];
   if(mode==='sparse')rows=new Array(1);
   if(mode==='arrayExtra')rows.extra=true;
   if(mode==='rowGetter')Object.defineProperty(rows[0],'countryCode',{enumerable:true,get(){trace.rowGetters++;return 'CA';}});
   if(mode==='rowPrototype')Object.setPrototypeOf(rows[0],{extra:true});
   if(mode==='badBoolean')rows[0].consentRequired='false';
   if(mode==='dateString')rows[0]._updatedDate='2026-01-01T00:00:00.000Z';
   if(mode==='overflow'||mode==='multipage'||mode==='lateTrue')rows=Array.from({length:100},(_,i)=>row(page*100+i));
   if(mode==='lateTrue'&&page===1)rows[99].consentRequired=true;
   const result=new Result(rows,mode==='incomplete'||mode==='overflow'||((mode==='multipage'||mode==='lateTrue')&&page===0));
   if(mode==='ownGetter')Object.defineProperty(result,'items',{get(){trace.getters++;this.reads++;return rows;}});
   if(mode==='nonenumerableData')Object.defineProperty(result,'items',{value:rows});
   if(mode==='nonenumerableData')result.reads=1;
   return result;
  }
 }
 globalThis.wixData={query(c){if(c!=='ConsentRequirements')throw Error('collection');return new Query();}};
 `,context);
 const cache=new Map();
 async function load(spec){
  if(cache.has(spec))return cache.get(spec);
  if(spec.startsWith('backend/')){
   const m=new vm.SourceTextModule(fs.readFileSync(path.join(root,'velo',spec+'.js'),'utf8'),{context,identifier:spec});cache.set(spec,m);await m.link(load);return m;
  }
  const values=spec==='wix-data'?{default:context.wixData}:spec==='crypto'?{createHash:require('node:crypto').createHash}:spec==='wix-web-module'?{Permissions:{Anyone:'Anyone'},webMethod:(p,f)=>{assert.equal(p,'Anyone');return f;}}:null;
  assert.ok(values,'allowlisted import '+spec);
  const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});cache.set(spec,m);return m;
 }
 const endpoint=await load('backend/adsFormRequirement.web');await endpoint.evaluate();
 const diagnostic=await load('backend/adsRequirementDiagnostics');await diagnostic.evaluate();
 return {call:endpoint.namespace.getAdsFormRequirement,reader:cache.get('backend/guestConsentRequirementsReader').namespace.readGuestConsentRequirementsObservation,diagnostic:diagnostic.namespace,trace:context.trace,timers,release:()=>release()};
}
(async()=>{
 let cases=0;
 // This exact hosted representation must succeed, not silently remain closed.
 const empty=await fixture('empty');
 assert.deepEqual(JSON.parse(JSON.stringify(await empty.diagnostic.diagnoseAdsRequirementRead())),{v:1,stage:'READER',reason:'OBSERVED',pages:1,rows:0});
 assert.equal((await empty.call()).requirement,'NOT_REQUIRED');
 assert.equal(empty.trace.getters,2);assert.equal(empty.trace.hasNext,2);cases++;console.log('PASS inherited nonenumerable getter empty -> OBSERVED / NOT_REQUIRED');
 for(const [mode,expected]of [['true','UNRESOLVED'],['false','NOT_REQUIRED'],['multipage','NOT_REQUIRED'],['lateTrue','UNRESOLVED'],['ownGetter','NOT_REQUIRED'],['nonenumerableData','NOT_REQUIRED']]){
  const f=await fixture(mode),dto=await f.call();assert.equal(dto.requirement,expected);
  assert.deepEqual(Object.keys(dto).sort(),['observedAt','policyKey','requirement','v']);
  assert.equal(f.trace.finds,mode==='multipage'||mode==='lateTrue'?2:1);assert.equal(f.trace.getters,mode==='nonenumerableData'?0:f.trace.finds);assert.equal(f.trace.hasNext,f.trace.finds);cases++;console.log('PASS '+mode);
 }
 for(const [mode,reason]of [['malformed','INVALID_DATA'],['throwGetter','INVALID_DATA'],['oversize','INVALID_DATA'],['duplicate','INVALID_DATA'],['sparse','INVALID_DATA'],['arrayExtra','INVALID_DATA'],['rowGetter','INVALID_DATA'],['rowPrototype','INVALID_DATA'],['badBoolean','INVALID_DATA'],['dateString','INVALID_DATA'],['invalidNext','INVALID_DATA'],['throwNext','READ_FAILED'],['mutate','INVALID_DATA'],['incomplete','INCOMPLETE_READ'],['overflow','OVERFLOW'],['reject','READ_FAILED']]){
  const f=await fixture(mode),read=await f.reader();assert.equal(read.status,'UNAVAILABLE',mode);assert.equal(read.reason,reason,mode);
  assert.deepEqual(JSON.parse(JSON.stringify(await f.call())),{v:1,requirement:'UNRESOLVED'},mode);
  assert.equal(f.trace.rowGetters,0);assert.equal(f.trace.getters,mode==='reject'?0:f.trace.finds);cases++;console.log('PASS '+mode);
 }
 {
  const f=await fixture('hung'),pending=f.call();for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(f.timers.length,1);assert.ok(f.timers[0].ms>0&&f.timers[0].ms<=10000);f.timers[0].fn();
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)),{v:1,requirement:'UNRESOLVED'});
  f.release();for(let i=0;i<20;i++)await Promise.resolve();assert.equal(f.trace.finds,1);assert.equal(f.trace.getters,0);cases++;console.log('PASS hung read, controlled deadline, late result ignored');
 }
 {
  const f=await fixture('empty');assert.deepEqual(JSON.parse(JSON.stringify(await f.call(undefined))),{v:1,requirement:'UNRESOLVED'});assert.equal(f.trace.finds,0);cases++;console.log('PASS no-argument boundary');
 }
 {
  const f=await fixture('empty');assert.deepEqual(JSON.parse(JSON.stringify(await f.diagnostic.diagnoseAdsRequirementSdkShape())),{v:1,stage:'RESULT',reason:'SHAPE_ONLY',queryKind:'OWN_DATA',findKind:'INHERITED_DATA',itemsKind:'INHERITED_ACCESSOR',itemsEnumerable:false,itemCount:null,hasNextKind:'INHERITED_DATA'});assert.equal(f.trace.getters,0);assert.equal(f.trace.hasNext,0);cases++;console.log('PASS hosted shape reproduction, diagnostic remains getter-free');
 }
 assert.equal(cases,26);console.log(JSON.stringify({status:'PASS',cases,label:'actual ESM; inert SDK; controlled timeout, not elapsed hosted timing'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
