'use strict';
let assertions=0, fixtureLoads=0;
const baseAssert = require('node:assert/strict');
const assert = new Proxy(baseAssert,{apply(t,self,args){assertions++;return Reflect.apply(t,self,args)},get(t,k){const v=t[k];return typeof v==='function' ? (...args)=>{assertions++;return Reflect.apply(v,t,args)} : v}});
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
if (!vm.SourceTextModule) {
  const r = require('node:child_process').spawnSync(process.execPath,
    ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning', __filename], {stdio:'inherit'});
  process.exit(r.status ?? 1);
}
const root = path.join(__dirname, '..');
const file = path.join(root, 'velo/backend/guestConsentRequirementsReader.js');
const source = process.env.CONSENT_READER_MUTANT ? Buffer.from(process.env.CONSENT_READER_MUTANT,'base64').toString() : fs.existsSync(file) ? fs.readFileSync(file,'utf8') : '';
const policySource = fs.readFileSync(path.join(root,'velo/backend/guestConsentLocationPolicy.js'),'utf8');
async function load(setup = '') {
  fixtureLoads++;
  const context = vm.createContext({});
  vm.runInContext(`
    globalThis.now=1000; Date.now=()=>now;
    globalThis.timers=new Map(); let timerId=0;
    globalThis.setTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id};
    globalThis.clearTimeout=id=>timers.delete(id);
    globalThis.calls=[]; globalThis.pages=[{items:[],hasNext(){return false}}];
    globalThis.row=(i,extra={})=>({_id:String(i).padStart(5,'0'),countryCode:'CA',consentRequired:false,...extra});
    globalThis.batch=(start,n)=>Array.from({length:n},(_,i)=>row(start+i));
    class Query {
      gt(...args){calls.push(['gt',...args]);return this}
      ascending(...args){calls.push(['ascending',...args]);return this}
      limit(...args){calls.push(['limit',...args]);return this}
      find(options){calls.push(['find',options]);const p=pages.shift();return typeof p==='function'?p():Promise.resolve(p)}
    }
    globalThis.wixData={query(id){calls.push(['query',id]);return new Query()}};
    ${setup}
  `,context);
  const sdk = new vm.SyntheticModule(['default'],function(){this.setExport('default',context.wixData)},{context});
  const policy = new vm.SourceTextModule(policySource,{context,identifier:'policy'});
  await policy.link(()=>{throw Error('Policy must have no dependencies')});
  await policy.evaluate();
  const reader = new vm.SourceTextModule(source,{context,identifier:'reader'});
  await reader.link(spec => {
    if(spec==='wix-data') return sdk;
    if(spec==='backend/guestConsentLocationPolicy') return policy;
    throw Error('Unexpected import '+spec);
  });
  await reader.evaluate();
  return {context,read:reader.namespace.readGuestConsentRequirementsObservation,policy:policy.namespace.resolveGuestConsentRequirement,
    run:expr=>vm.runInContext(expr,context)};
}
const plain = x=>JSON.parse(JSON.stringify(x));
let checks=0;
async function test(name,fn){if(process.env.CONSENT_READER_CASE && process.env.CONSENT_READER_CASE!==name)return;try{await fn()}catch(e){console.error('CAUSAL_CASE '+name);if(e && typeof e==='object')e.message=name+': '+e.message;throw e}checks++;console.log('PASS '+name)}
let policyVectors=0,nativeVectors=0,mutantsKilled=0,nativeReversionWitnesses=0;
const sha=s=>require('node:crypto').createHash('sha256').update(s).digest('hex');
function saveEvidence(name,value){
  const dir=path.join(process.env.LOCALAPPDATA || require('node:os').tmpdir(),'hermes/checkpoints/guest-consent-reader-evidence',sha(source));
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(value,null,2));
}
function nativeWitness(text,hook,reversion){
  const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
  const sdk=url('export default globalThis.sdk');
  const module=url(text.replace("'wix-data'",JSON.stringify(sdk)).replace("'backend/guestConsentLocationPolicy'",JSON.stringify(url(policySource))));
  const code=`import assert from 'node:assert/strict';
    process.on('uncaughtException',e=>{console.error(JSON.stringify({code:e.code,message:e.message,actual:e.actual,expected:e.expected}));process.exitCode=1});
    let callbacks=0,attacks=0,queries=0;
    const define=Object.defineProperty;
    const items=new Proxy([{_id:'a',countryCode:'CA',consentRequired:false}],{ownKeys(t){
      if(!attacks++)for(const k of ${JSON.stringify(hook==='both'?['get','set']:[hook])})define(Object.prototype,k,{__proto__:null,configurable:true,get(){callbacks++;return undefined}});
      return Reflect.ownKeys(t);
    }});
    globalThis.sdk={query(){queries++;return {ascending(){return this},limit(){return this},find(){return ${hook==='deadline'?'new Promise(()=>{})':'Promise.resolve({items,hasNext(){return false}})'}}}}};
    const {readGuestConsentRequirementsObservation:read}=await import(${JSON.stringify(module)});
    const start=Date.now();let out;
    try{out=await read()}finally{delete Object.prototype.get;delete Object.prototype.set}
    ${hook==='deadline'?"assert.equal(out.reason,'READ_TIMEOUT');assert.equal(queries,1);console.log(JSON.stringify({reason:out.reason,queries,elapsed:Date.now()-start}));":`assert.equal(attacks>0,true);assert.equal(callbacks,0,'native descriptor callbacks');assert.equal(out.status,'OBSERVED');console.log(JSON.stringify({callbacks,attacks,status:out.status}));`}
  `;
  const result=require('node:child_process').spawnSync(process.execPath,['--input-type=module'],{input:code,encoding:'utf8',timeout:18000});
  if(!reversion)saveEvidence('native-'+hook,{sourceSHA:sha(text),status:result.status,stdout:result.stdout,stderr:result.stderr});
  return result;
}
async function main(){
  await test('private module dependency and caller isolation remains disconnected',async()=>{
    const parsed=new vm.SourceTextModule(source);
    assert.deepEqual(parsed.dependencySpecifiers,['wix-data','backend/guestConsentLocationPolicy']);
    assert.deepEqual([...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m=>m[1]),['readGuestConsentRequirementsObservation']);
    assert.doesNotMatch(source,/export\s+default|\b(?:fetch|console|require)\s*[.(]|\.(?:insert|update|save|remove|bulkInsert|bulkUpdate|bulkRemove|next|skip|eq)\s*\(/);
    function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.(?:js|jsw)$/.test(p)&&p!==file){const text=fs.readFileSync(p,'utf8');const m=new vm.SourceTextModule(text);for(const spec of m.dependencySpecifiers)assert(!spec.includes('guestConsentRequirementsReader'),'incoming caller '+p)}}}
    walk(path.join(root,'velo'));
  });
  await test('empty exhausted observation uses actual private read and remains unresolved',async()=>{
    const x=await load();
    assert.equal(typeof x.read,'function','reader named export exists');
    const out=await x.read();
    assert.deepEqual(plain(out),{v:1,purpose:'guest-consent-requirements-observation',status:'OBSERVED',requirement:'UNRESOLVED',location:{status:'UNKNOWN'},rules:[],evidence:{collectionId:'ConsentRequirements',scan:{strategy:'explicit-keyset-find-v1',status:'EXHAUSTED',pages:1,rows:0,pageSize:100,maxRows:4096,maxPages:41,atomic:false,coherentRevision:null},startedAtMs:1000,completedAtMs:1000,rows:[]}});
    assert.deepEqual(plain(x.context.calls),[['query','ConsentRequirements'],['ascending','_id'],['limit',100],['find',{suppressAuth:true,consistentRead:true,suppressHooks:true}]]);
  });
  await test('invalid calls reject before IO; provider errors are opaque unavailable',async()=>{
    const x=await load();
    for(const arg of [undefined,null,{ip:'fake'},{countryCode:'CA'},{status:'COMPLETE',rows:[]}]){
      const out=await x.read(arg);
      assert.deepEqual(plain(out),{v:1,purpose:'guest-consent-requirements-observation',status:'UNAVAILABLE',requirement:'UNRESOLVED',reason:'INVALID_CALL'});
    }
    assert.equal(x.context.calls.length,0);
    const y=await load("pages=[()=>Promise.reject(Error('private provider detail'))]");
    assert.deepEqual(plain(await y.read()),{v:1,purpose:'guest-consent-requirements-observation',status:'UNAVAILABLE',requirement:'UNRESOLVED',reason:'READ_FAILED'});
  });
  await test('100+1 explicit keyset scan preserves every rule and row evidence',async()=>{
    const x=await load("pages=[{items:batch(0,100),hasNext(){return true}},{items:[row(100,{consentRequired:true,usStateCode:'',_updatedDate:new Date(1234)})],hasNext(){return false}}]");
    const out=await x.read();
    assert.equal(out.rules.length,101);
    assert.deepEqual(plain(out.rules[100]),{countryCode:'CA',usStateCode:'',consentRequired:true});
    assert.deepEqual(plain(out.evidence.rows[100]),{id:'00100',updatedAtMs:1234,stateEncoding:'EMPTY_STRING'});
    assert.deepEqual(plain(out.evidence.rows[0]),{id:'00000',updatedAtMs:null,stateEncoding:'ABSENT'});
    assert.equal(out.evidence.scan.pages,2);
    assert.equal(out.evidence.scan.rows,101);
    assert.equal(out.requirement,'UNRESOLVED');
    assert.deepEqual(plain(x.context.calls).slice(4),[['query','ConsentRequirements'],['gt','_id','00099'],['ascending','_id'],['limit',100],['find',{suppressAuth:true,consistentRead:true,suppressHooks:true}]]);
    const opts=x.context.calls.filter(x=>x[0]==='find').map(x=>x[1]);
    assert.notEqual(opts[0],opts[1]);opts.forEach(o=>assert(Object.isFrozen(o)));
  });
  await test('bounded exhaustion rejects invalid pagination without a prefix',async()=>{
    for(const [setup,reason] of [
      ["pages=[{items:[],hasNext(){return true}}]",'INCOMPLETE_READ'],
      ["pages=[{items:batch(0,1),hasNext(){return true}}]",'INCOMPLETE_READ'],
      ["pages=[{items:[],hasNext(){return 'false'}}]",'INVALID_DATA'],
      ["pages=[{items:batch(0,101),hasNext(){return false}}]",'INVALID_DATA'],
      ["pages=[{items:[row(1),row(1)],hasNext(){return false}}]",'INVALID_DATA'],
      ["pages=[{items:[row(2),row(1)],hasNext(){return false}}]",'INVALID_DATA'],
      ["const p={items:batch(0,100),hasNext(){return true}};pages=[p,p]",'INVALID_DATA'],
      ["pages=Array.from({length:41},(_,i)=>({items:batch(i*100,i===40?97:100),hasNext(){return i!==40}}))",'OVERFLOW'],
      ["pages=[{items:batch(0,100),hasNext(){return true}},()=>Promise.reject(Error('secret'))]",'READ_FAILED']
    ]){
      const x=await load(setup), out=await x.read();assert.equal(out.reason,reason,setup);
      assert.equal(out.status,'UNAVAILABLE');assert.equal('rules' in out,false);assert(x.context.calls.filter(c=>c[0]==='find').length<=41);
    }
    for(const n of [100,4096]){
      const x=await load(`pages=Array.from({length:Math.ceil(${n}/100)},(_,i)=>({items:batch(i*100,Math.min(100,${n}-i*100)),hasNext(){return i+1<Math.ceil(${n}/100)}}))`);
      const out=await x.read();assert.equal(out.rules.length,n);assert.equal(out.status,'OBSERVED');
    }
  });
  await test('overall deadline bounds pending IO and validates monotonic clock',async()=>{
    const x=await load("pages=[()=>new Promise((resolve,reject)=>{globalThis.lateResolve=resolve;globalThis.lateReject=reject})]");
    const pending=x.read();
    for(let i=0;i<8;i++) await Promise.resolve();
    assert.equal(x.context.timers.size,1,'each pending find has remaining-deadline timer');
    x.run('now=11000; for(const t of timers.values())t.fn()');
    assert.equal((await pending).reason,'READ_TIMEOUT');
    assert.equal(x.context.timers.size,0);
    x.run('lateResolve({items:batch(0,100),hasNext(){throw Error("late inspection")}})');
    for(let i=0;i<8;i++) await Promise.resolve();
    assert.equal(x.context.calls.filter(c=>c[0]==='query').length,1);
    for(const change of ['now=999','now=NaN','now=Infinity','now=1.5','now=-1']){
      const y=await load(`pages=[()=>{${change};return Promise.resolve({items:[],hasNext(){return false}})}]`);
      assert.equal((await y.read()).reason,'INVALID_DATA',change);
      assert.equal(y.context.timers.size,0);
    }
    const y=await load("pages=[{items:batch(0,100),hasNext(){now=9000;return true}},()=>new Promise(()=>{})]");
    const p=y.read();for(let i=0;i<20;i++)await Promise.resolve();
    assert.equal([...y.context.timers.values()][0].ms,2000);
    y.run('now=11000;for(const t of timers.values())t.fn()');assert.equal((await p).reason,'READ_TIMEOUT');
  });
  await test('synchronous find elapsed time reduces pending budget and expires without orphaned rejection',async()=>{
    // Advance only the isolated fixture clock: no busy-wait or blocked event loop.
    const unhandled=[];
    const onUnhandled=error=>unhandled.push(error);
    process.on('unhandledRejection',onUnhandled);
    try {
      for(const [returnedAt,expectedBudget] of [[9000,2000],[10999,1],[11000,null],[12000,null]]){
        const x=await load(`globalThis.scheduled=[];const schedule=setTimeout;
          globalThis.setTimeout=(fn,ms)=>{scheduled.push(ms);return schedule(fn,ms)};
          pages=[()=>{now=${returnedAt};return new Promise((resolve,reject)=>{globalThis.lateReject=reject})}]`);
        let out;
        const pending=x.read().then(value=>{out=value});
        for(let i=0;i<20;i++)await Promise.resolve();
        assert.deepEqual(plain(x.context.scheduled),expectedBudget===null?[]:[expectedBudget],
          'post-find remaining budget at '+returnedAt);
        if(expectedBudget!==null){
          assert.equal(out,undefined,'pending until remaining deadline');
          x.run('now=11000;for(const t of timers.values())t.fn()');
        }else{
          assert.notEqual(out,undefined,'already expired find settles without firing timer');
        }
        await pending;
        assert.deepEqual(plain(out),{v:1,purpose:'guest-consent-requirements-observation',status:'UNAVAILABLE',requirement:'UNRESOLVED',reason:'READ_TIMEOUT'});
        assert.equal(x.context.timers.size,0);
        x.run("lateReject(Error('late private SDK rejection'))");
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(unhandled.length,0,'late SDK rejection remains handled at '+returnedAt);
        assert.equal(x.context.calls.filter(c=>c[0]==='query').length,1);
        assert.equal(x.context.calls.filter(c=>c[0]==='find').length,1);
      }
      for(const [body,reason] of [
        ["now=9000;throw Error('private synchronous SDK failure')",'READ_FAILED'],
        ["now=12000;throw Error('private synchronous SDK failure')",'READ_FAILED'],
        ["now=9000;return Promise.reject(Error('private asynchronous SDK failure'))",'READ_FAILED'],
        ["now=12000;return Promise.reject(Error('already expired SDK failure'))",'READ_TIMEOUT'],
        ["now=NaN;return Promise.reject(Error('invalid clock SDK failure'))",'INVALID_DATA']
      ]){
        const x=await load(`pages=[()=>{${body}}]`);
        assert.deepEqual(plain(await x.read()),{v:1,purpose:'guest-consent-requirements-observation',status:'UNAVAILABLE',requirement:'UNRESOLVED',reason});
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(unhandled.length,0);
        assert.equal(x.context.timers.size,0);
        assert.equal(x.context.calls.filter(c=>c[0]==='find').length,1);
      }
    } finally { process.removeListener('unhandledRejection',onUnhandled); }
  });
  await test('supported vocabulary and all-row field semantics fail closed',async()=>{
    // Public UN M49 English ISO-alpha2 extraction, 248 entries. No runtime network.
    const countries='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
    const states='AK AL AR AZ CA CO CT DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY'.split(' ');
    assert.equal(countries.length,248);assert.equal(states.length,50);
    for(const countryCode of countries){
      const x=await load(`pages=[{items:[row(0,{countryCode:'${countryCode}'})],hasNext(){return false}}]`);
      assert.equal((await x.read()).status,'OBSERVED',countryCode);
    }
    for(const usStateCode of states){
      const x=await load(`pages=[{items:[row(0,{countryCode:'US',usStateCode:'${usStateCode}'})],hasNext(){return false}}]`);
      const out=await x.read();assert.equal(out.status,'OBSERVED',usStateCode);assert.equal(out.evidence.rows[0].stateEncoding,'TOKEN');
    }
    const bad=[
      "countryCode:'ZZ'","countryCode:'TW'","countryCode:'XK'","countryCode:'ca'","countryCode:' CA'","countryCode:new String('CA')",
      "usStateCode:null","usStateCode:undefined","usStateCode:1","usStateCode:new String('NY')","usStateCode:' '","usStateCode:'NY'","countryCode:'US',usStateCode:'ZZ'",
      ...['DC','PR','GU','AS','VI','MP','FM','MH','PW','AA','AE','AP','ny','New York'].map(s=>`countryCode:'US',usStateCode:'${s}'`),
      ...['null','undefined','1','0',"'false'",'new Boolean(true)'].map(s=>'consentRequired:'+s),
      ...['null',"'2026-01-01'",'new Date(NaN)','new Date(-1)','{}'].map(s=>'_updatedDate:'+s),
      "_id:''","_id:'x'.repeat(257)","_id:1"
    ];
    for(const fields of bad){
      const x=await load(`pages=[{items:[row(0,{consentRequired:true}),row(1,{${fields}})],hasNext(){return false}}]`);
      assert.equal((await x.read()).reason,'INVALID_DATA',fields);
    }
    for(const key of ['countryCode','consentRequired','_id']){
      const x=await load(`const r=row(0);delete r.${key};pages=[{items:[r],hasNext(){return false}}]`);assert.equal((await x.read()).reason,'INVALID_DATA',key);
    }
    const x=await load("pages=[{items:[row(0,{countryCode:'US',usStateCode:'NY',consentRequired:false}),row(1,{countryCode:'US',usStateCode:'NY',consentRequired:true})],hasNext(){return false}}]");
    assert.deepEqual(plain((await x.read()).rules).map(r=>r.consentRequired),[false,true]);
  });
  await test('inert descriptor projection never invokes accessors or traverses metadata',async()=>{
    for(const target of ["r,'countryCode'","r,'usStateCode'","r,'_updatedDate'","p,'items'","a,'0'"]){
      const x=await load(`globalThis.gets=0;const r=row(0),a=[r],p={items:a,hasNext(){return false}};Object.defineProperty(${target},{enumerable:true,get(){gets++;return 'CA'}});pages=[p]`);
      assert.equal((await x.read()).reason,'INVALID_DATA',target);assert.equal(x.context.gets,0,target);
    }
    for(const change of ["delete a[0]","a.extra=1","a[Symbol()]=1","Object.setPrototypeOf(a,null)","Object.setPrototypeOf(r,{})","Object.defineProperty(r,'consentRequired',{enumerable:false})"]){
      const x=await load(`const r=row(0),a=[r];${change};pages=[{items:a,hasNext(){return false}}]`);assert.equal((await x.read()).reason,'INVALID_DATA',change);
    }
    const x=await load("globalThis.gets=0;const r=row(0);Object.defineProperty(r,'notes',{get(){gets++;throw 0}});Object.defineProperty(r,'title',{get(){gets++;throw 0}});globalThis.original=r;pages=[Object.freeze({items:Object.freeze([Object.freeze(r)]),hasNext(){return false}})]");
    const out=await x.read();assert.equal(out.status,'OBSERVED');assert.equal(x.context.gets,0);
    function frozenGraph(v){if(v&&typeof v==='object'){assert(Object.isFrozen(v));assert.equal(Object.getPrototypeOf(v),Array.isArray(v)?x.run('Array.prototype'):null);for(const k of Object.keys(v))frozenGraph(v[k])}}
    frozenGraph(out);
    const y=await load("globalThis.original=row(0);pages=[{items:[original],hasNext(){return false}}]");
    const saved=await y.read();y.run("original.countryCode='ZZ';original.consentRequired=true");assert.equal(saved.rules[0].countryCode,'CA');assert.equal(saved.rules[0].consentRequired,false);assert.equal(y.run('Object.isFrozen(original)'),false);
  });
  await test('captured SDK callables exclude Object.prototype and preserve class receivers',async()=>{
    const x=await load();x.run("wixData.query=()=>{throw Error('late replacement')}");assert.equal((await x.read()).status,'OBSERVED','query captured at import');
    for(const setup of [
      "delete wixData.query;Object.prototype.query=function(){throw Error('must not invoke')}",
      "Object.defineProperty(wixData,'query',{get(){globalThis.gets++;return ()=>{throw 0}}})"
    ]){const y=await load('globalThis.gets=0;'+setup);assert.equal((await y.read()).reason,'READ_FAILED');assert.equal(y.context.gets,0)}
    for(const setup of [
      "delete Query.prototype.find;Object.prototype.find=function(){gets++;return Promise.resolve(pages[0])}",
      "Object.defineProperty(Query.prototype,'find',{get(){gets++;return ()=>Promise.resolve(pages[0])}})"
    ]){const y=await load('globalThis.gets=0;'+setup);assert.equal((await y.read()).reason,'READ_FAILED');assert.equal(y.context.gets,0)}
    const y=await load("globalThis.gets=0;pages=[{items:[]}];Object.prototype.hasNext=function(){gets++;return false}");
    assert.equal((await y.read()).reason,'INVALID_DATA');assert.equal(y.context.gets,0);
    const z=await load("class Result {constructor(){this.items=[row(0)]} hasNext(){if(!(this instanceof Result))throw 0;return false}};pages=[new Result()]");
    assert.equal((await z.read()).status,'OBSERVED');
  });
  await test('SDK hasNext rejection is an opaque read failure',async()=>{
    const x=await load("pages=[{items:[row(0)],hasNext(){throw Error('private SDK detail')}}]");
    assert.deepEqual(plain(await x.read()),{v:1,purpose:'guest-consent-requirements-observation',status:'UNAVAILABLE',requirement:'UNRESOLVED',reason:'READ_FAILED'});
  });
  await test('final reflection closes row array and result descriptor drift',async()=>{
    for(const setup of [
      "const r=row(0);pages=[{items:[r],hasNext(){r.countryCode='US';return false}}]",
      "const r=row(0);let n=0;const proxy=new Proxy(r,{getOwnPropertyDescriptor(t,k){const d=Reflect.getOwnPropertyDescriptor(t,k);if(k==='consentRequired' && ++n===2)Object.setPrototypeOf(t,{});return d}});pages=[{items:[proxy],hasNext(){return false}}]",
      "const a=[row(0)];pages=[{items:a,hasNext(){a.extra=1;return false}}]",
      "const p={items:[row(0)],hasNext(){Object.setPrototypeOf(p,{});return false}};pages=[p]",
      "const p={items:[row(0)],hasNext(){return false}};let n=0;pages=[new Proxy(p,{getOwnPropertyDescriptor(t,k){const d=Reflect.getOwnPropertyDescriptor(t,k);if(k==='items' && ++n===2)Object.setPrototypeOf(t,{});return d}})]"
      ,"const p={items:[row(0)],hasNext(){return false}};let n=0;pages=[new Proxy(p,{getOwnPropertyDescriptor(t,k){const d=Reflect.getOwnPropertyDescriptor(t,k);if(k==='items' && ++n===3)Object.setPrototypeOf(t,{});return d}})]"
      ,"const a=[row(0)];let n=0;const p=new Proxy(a,{getOwnPropertyDescriptor(t,k){const d=Reflect.getOwnPropertyDescriptor(t,k);if(k==='length' && ++n===3)Object.setPrototypeOf(t,null);return d}});pages=[{items:p,hasNext(){return false}}]"
    ]){const x=await load(setup);assert.equal((await x.read()).reason,'INVALID_DATA',setup)}
  });
  await test('post-await intrinsic and inherited-array poisoning cannot redirect output',async()=>{
    for(const poison of [
      "Array.prototype.push=function(){attacks++;throw 0}",
      "Array.prototype.includes=function(){attacks++;return true}",
      "Array.prototype[Symbol.iterator]=function(){attacks++;throw 0}",
      "Object.defineProperty(Array.prototype,'0',{configurable:true,set(){attacks++;throw 0}})",
      "Object.prototype.then=function(resolve){attacks++;resolve('GRANTED')}"
    ]){
      const x=await load(`globalThis.attacks=0;const p={__proto__:null,items:[row(0)],hasNext(){return false}};pages=[()=>Promise.resolve().then(()=>{${poison};return p})]`);
      const out=await x.read();assert.equal(out.status,'OBSERVED',poison);assert.equal(out.requirement,'UNRESOLVED');assert.equal(x.context.attacks,0,poison);
    }
  });
  await test('captured reflection and construction survive late replacement',async()=>{
    for(const target of ['Object.freeze','Object.getPrototypeOf','Object.getOwnPropertyDescriptor','Object.defineProperty','Object.is','Reflect.ownKeys','Reflect.apply','Array.isArray','Number.isSafeInteger','Date.prototype.getTime']){
      const x=await load(`globalThis.attacks=0;const p={items:[row(0,{_updatedDate:new Date(1234)})],hasNext(){return false}};pages=[()=>Promise.resolve().then(()=>{${target}=()=>{attacks++;throw 0};return p})]`);
      let out;await assert.doesNotReject(async()=>{out=await x.read()},target+' reader must settle successfully');assert.equal(out.status,'OBSERVED',target);assert.equal(out.evidence.rows[0].updatedAtMs,1234);assert.equal(x.context.attacks,0,target);
    }
  });
  await test('actual policy accepts projected synthetic rows without granting observation authority',async()=>{
    const cases=[
      ['CA','',[], 'NOT_REQUIRED'],
      ['CA','',[{countryCode:'US',usStateCode:'NY',consentRequired:true}], 'NOT_REQUIRED'],
      ['US','NY',[{countryCode:'US',usStateCode:'',consentRequired:false},{countryCode:'US',usStateCode:'NY',consentRequired:true}], 'REQUIRED'],
      ['US','NY',[{countryCode:'US',usStateCode:'',consentRequired:true},{countryCode:'US',usStateCode:'NY',consentRequired:false}], 'REQUIRED'],
      ['US','',[{countryCode:'US',usStateCode:'',consentRequired:true}], 'UNRESOLVED']
    ];
    for(const [country,state,rules,expected] of cases){
      const x=await load(`pages=[{items:${JSON.stringify(rules)}.map((r,i)=>row(i,r)),hasNext(){return false}}]`);
      const out=await x.read();assert.equal(out.requirement,'UNRESOLVED');x.context.projected=out.rules;
      for(const reverse of [false,true]){
        const envelope=x.run(`({v:1,location:{status:'KNOWN',countryCode:${JSON.stringify(country)},usStateCode:${JSON.stringify(state)}},requirements:{status:'COMPLETE',rows:${reverse?'[...projected].reverse()':'projected'}}})`);
        assert.equal(x.policy(envelope),expected);policyVectors++;
      }
      const restrictions=Object.freeze({optOut:true,withdrawn:true,providerRestricted:true});
      assert.equal(out.requirement,'UNRESOLVED');assert.deepEqual(restrictions,{optOut:true,withdrawn:true,providerRestricted:true});
      assert.equal('optOut' in out,false);
    }
    const compatibility=await load();
    for(const expression of [
      "({v:1,location:{status:'UNKNOWN'},requirements:{status:'COMPLETE',rows:[]}})",
      "({v:1,location:{status:'KNOWN',countryCode:'CA',usStateCode:''},requirements:{status:'UNAVAILABLE'}})",
      "({v:1,location:{status:'KNOWN',countryCode:'CA',usStateCode:''},requirements:{status:'COMPLETE',rows:[{countryCode:'CA',usStateCode:'',consentRequired:true},{countryCode:'FR',usStateCode:'',consentRequired:'false'}]}})"
    ]){assert.equal(compatibility.policy(compatibility.run(expression)),'UNRESOLVED');policyVectors++}
    const x=await load("pages=[{items:batch(0,100),hasNext(){return true}},()=>{globalThis.edited=true;return Promise.resolve({items:[row(100,{consentRequired:true})],hasNext(){return false}})}]");
    const out=await x.read();assert.equal(x.context.edited,true);assert.equal(out.evidence.scan.atomic,false);assert.equal(out.evidence.scan.coherentRevision,null);assert.equal(out.requirement,'UNRESOLVED');
  });
  await test('native ESM inherited descriptor hooks remain inert',async()=>{
    for(const hook of ['get','set','both']){
      const result=nativeWitness(source,hook,false);nativeVectors++;
      assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/"callbacks":0/);
    }
  });
  await test('real wall-clock deadline settles a never-resolving SDK read',async()=>{
    const result=nativeWitness(source,'deadline',false);nativeVectors++;
    assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);
    assert.equal(report.reason,'READ_TIMEOUT');assert(report.elapsed>=9900 && report.elapsed<16000);assert.equal(report.queries,1);
  });
  await test('named causal reader mutations fail their original-green witnesses',async()=>{
    const mutations=[
      ['drop-suppressAuth','suppressAuth:true,','', 'empty exhausted observation uses actual private read and remains unresolved'],
      ['drop-consistentRead','consistentRead:true,','', 'empty exhausted observation uses actual private read and remains unresolved'],
      ['drop-suppressHooks',',suppressHooks:true','', 'empty exhausted observation uses actual private read and remains unresolved'],
      ['skip-later-page','if (!more) break;','if (true) break;', '100+1 explicit keyset scan preserves every rule and row evidence'],
      ['omit-confirm','      confirm(observations);','', 'final reflection closes row array and result descriptor drift'],
      ['omit-final-prototype','    // Must remain after the last descriptor trap, not only at scan entry.\n    if(prototype(n.value)!==n.proto) throw 0;','', 'final reflection closes row array and result descriptor drift'],
      ['live-define',"define(array,''+array.length,","Object.defineProperty(array,''+array.length,", 'captured reflection and construction survive late replacement'],
      ['live-freeze','value => freeze(value)','value => Object.freeze(value)', 'captured reflection and construction survive late replacement'],
      ['live-prototype','const proto = prototype(value), saved','const proto = Object.getPrototypeOf(value), saved', 'captured reflection and construction survive late replacement'],
      ['live-descriptor',"const d = descriptor(value,key);","const d = Object.getOwnPropertyDescriptor(value,key);", 'captured reflection and construction survive late replacement'],
      ['live-includes','apply(includes,results,[result])','results.includes(result)', 'post-await intrinsic and inherited-array poisoning cannot redirect output'],
      ['live-array-push','append(results,result);','results.push(result);', 'post-await intrinsic and inherited-array poisoning cannot redirect output']
    ];
    const finalFunction=source.slice(source.indexOf('function confirm('),source.indexOf('function rowSnapshot('));
    const closing='    // Must remain after the last descriptor trap, not only at scan entry.\n    if(prototype(n.value)!==n.proto) throw 0;';
    mutations.push(['early-placement-final-prototype',finalFunction,finalFunction.replace(closing,'').replace('    for(let i=0;i<n.keys.length;i++) {','    if(prototype(n.value)!==n.proto) throw 0;\n    for(let i=0;i<n.keys.length;i++) {'),'final reflection closes row array and result descriptor drift']);
    const deadlineCase='synchronous find elapsed time reduces pending budget and expires without orphaned rejection';
    // lastTime is the pre-find clock sample here: reverting the refresh restores
    // the causal stale budget without reverting unrelated reader protections.
    mutations.push(['stale-pre-find-budget','const remaining=10000-(time()-startedAtMs);',
      'const remaining=10000-(lastTime-startedAtMs);',deadlineCase]);
    const originalGreen=require('node:child_process').spawnSync(process.execPath,
      ['--experimental-vm-modules','--disable-warning=ExperimentalWarning',__filename],
      {encoding:'utf8',timeout:30000,env:{...process.env,CONSENT_READER_MUTANT:Buffer.from(source).toString('base64'),CONSENT_READER_CASE:deadlineCase}});
    saveEvidence('stale-pre-find-budget-original-green',{sourceSHA:sha(source),status:originalGreen.status,stdout:originalGreen.stdout,stderr:originalGreen.stderr});
    assert.equal(originalGreen.status,0,originalGreen.stderr);
    assert(originalGreen.stdout.includes('PASS '+deadlineCase));
    for(const [name,anchor,replacement,caseName] of mutations){
      assert.equal(source.split(anchor).length,2,name+' anchor');
      const mutant=source.replace(anchor,replacement), result=require('node:child_process').spawnSync(process.execPath,['--experimental-vm-modules','--disable-warning=ExperimentalWarning',__filename],{encoding:'utf8',timeout:30000,env:{...process.env,CONSENT_READER_MUTANT:Buffer.from(mutant).toString('base64'),CONSENT_READER_CASE:caseName}});
      saveEvidence(name,{anchor,replacement,sourceSHA:sha(source),mutantSHA:sha(mutant),status:result.status,stdout:result.stdout,stderr:result.stderr});
      assert.equal(result.status,1,name);assert.match(result.stderr,/ERR_ASSERTION/);assert(result.stderr.includes(caseName),name+' causal suite');mutantsKilled++;
    }
    const anchor="{__proto__:null,value,writable:true,enumerable:true,configurable:true}";
    assert.equal(source.split(anchor).length,2);
    for(const hook of ['get','set','both']){
      const mutant=source.replace(anchor,"{value,writable:true,enumerable:true,configurable:true}"),result=nativeWitness(mutant,hook,true);
      saveEvidence('ordinary-descriptor-'+hook,{anchor,replacement:'{value,writable:true,enumerable:true,configurable:true}',sourceSHA:sha(source),mutantSHA:sha(mutant),status:result.status,stdout:result.stdout,stderr:result.stderr});
      assert.equal(result.status,1);assert.match(result.stderr,/ERR_ASSERTION/);assert.match(result.stderr,/native descriptor callbacks/);const failure=JSON.parse(result.stderr);assert.equal(failure.code,'ERR_ASSERTION');assert.equal(failure.actual,hook==='both'?2:1);assert.equal(failure.expected,0);nativeReversionWitnesses++;
    }
    mutantsKilled++;
  });
  console.log('guest consent reader: PASS',{suites:checks,assertions,fixtureLoads,policyVectors,nativeVectors,mutantsKilled,nativeReversionWitnesses});
}
main().catch(e=>{console.error(e);process.exitCode=1});
