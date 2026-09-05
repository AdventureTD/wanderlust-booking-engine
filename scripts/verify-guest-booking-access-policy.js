const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.join(__dirname, '../velo/backend/guestBookingAccessPolicy.js');
const names = ['checkVerifiedGuestClaims', 'classifyGuestIntentAdmission', 'classifyAcceptedIntentRecovery'];
let source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
if(process.env.GUEST_POLICY_MUTANT) {const [before,after]=JSON.parse(process.env.GUEST_POLICY_MUTANT);assert.ok(source.includes(before),'mutant target exists');source=source.replace(before,after);}
const policy = vm.runInThisContext(`(() => { ${source.replace(/export function /g, 'function ')}; return {${names.map(n => `${n}:typeof ${n} === 'function' ? ${n} : undefined`).join(',')}}; })()`);
let count = 0;
function eq(actual, expected, label) { count++; assert.equal(actual, expected, label); }
const claims = () => ({v:1,purpose:'guest-bootstrap',audience:'wbe:test:fixture',intentId:'a'.repeat(64),intentDigest:'b'.repeat(64),quoteDigest:'c'.repeat(64),issuedAtMs:1000,expiresAtMs:2000});
const args = () => ({claims:claims(),command:'bootstrap',expectedAudience:'wbe:test:fixture',nowMs:1500});
eq(typeof policy.checkVerifiedGuestClaims, 'function', 'real claims predicate exists');
eq(policy.checkVerifiedGuestClaims(args()), 'CLAIMS_ELIGIBLE', 'valid bootstrap claims');
for (const command of ['bootstrap','resume','status','BOOTSTRAP','append','']) for (const purpose of ['guest-bootstrap','guest-access','pricing']) {
  const a=args(); a.command=command; a.claims.purpose=purpose;
  eq(policy.checkVerifiedGuestClaims(a), ['bootstrap','resume','status'].includes(command) && (purpose==='guest-bootstrap'||purpose==='guest-access'&&command!=='bootstrap') ? 'CLAIMS_ELIGIBLE':'DENIED', 'purpose command matrix');
}
for (const target of ['outer','claims']) {
 for (const key of Object.keys(target==='outer'?args():claims())) { const a=args(); delete (target==='outer'?a:a.claims)[key]; eq(policy.checkVerifiedGuestClaims(a),'DENIED',`missing ${target}.${key}`); }
 for (const key of ['extra','then','toJSON',Symbol('x')]) { const a=args(); Object.defineProperty(target==='outer'?a:a.claims,key,{value:1}); eq(policy.checkVerifiedGuestClaims(a),'DENIED','extra own field'); }
}
for (const key of ['intentId','intentDigest','quoteDigest','audience']) for (const value of [null,undefined,1,{},new String('a'),'', 'A'.repeat(64),'a'.repeat(63),'a'.repeat(65), 'a'.repeat(64)+'\n',' abc','é']) {
 if(key==='audience' && typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && !value.endsWith('\n')) continue;
 const a=args(); a.claims[key]=value; eq(policy.checkVerifiedGuestClaims(a),'DENIED',`scalar ${key}`);
}
for (const key of ['nowMs','issuedAtMs','expiresAtMs']) for (const value of [-0,-1,NaN,Infinity,1.5,'1500',null,undefined,1n,Number.MAX_SAFE_INTEGER+1]) { const a=args(); (key==='nowMs'?a:a.claims)[key]=value; eq(policy.checkVerifiedGuestClaims(a),'DENIED',`time ${key}`); }
for (const [issued,expires,now,want] of [[1500,2000,1500,true],[1501,2000,1500,false],[1000,2000,2000,false],[1000,2000,1999,true],[1000,1000,1000,false],[0,3600000,0,true],[0,3600001,0,false]]) { const a=args(); a.claims.issuedAtMs=issued;a.claims.expiresAtMs=expires;a.nowMs=now;eq(policy.checkVerifiedGuestClaims(a),want?'CLAIMS_ELIGIBLE':'DENIED','time boundary'); }
let invoked=0;
for(const key of Object.keys(claims())) { const a=args(); Object.defineProperty(a.claims,key,{get(){invoked++; throw Error('getter');},enumerable:true}); eq(policy.checkVerifiedGuestClaims(a),'DENIED','no getter'); }
eq(invoked,0,'getters never invoked');
for(const bad of [null,undefined,[],new Date(),()=>{},Object.create(claims())]) eq(policy.checkVerifiedGuestClaims(bad),'DENIED','invalid outer');
const binding=()=>({v:1,intentDigest:'b'.repeat(64),quoteDigest:'c'.repeat(64),quoteExpiresAtMs:2500,roomQuantities:[2,1,1]});
const admission=()=>({...args(),intentBinding:binding(),acceptedContext:null});
eq(typeof policy.classifyGuestIntentAdmission,'function','admission export exists');
eq(policy.classifyGuestIntentAdmission(admission()),'NEW_INTENT_ELIGIBLE','new whole intent');
for(const purpose of ['guest-bootstrap','guest-access']) for(const command of ['bootstrap','resume','status']) {const a=admission();a.command=command;a.claims.purpose=purpose;eq(policy.classifyGuestIntentAdmission(a),purpose==='guest-bootstrap'&&command==='bootstrap'?'NEW_INTENT_ELIGIBLE':'DENIED','not-found command matrix');}
let quantityCases=0;
function quantities(prefix) {
 if(prefix.length) {const a=admission();a.intentBinding.roomQuantities=prefix;quantityCases++;eq(policy.classifyGuestIntentAdmission(a),prefix.reduce((sum,n)=>sum+n,0)<=4?'NEW_INTENT_ELIGIBLE':'DENIED','aggregate '+prefix);}
 if(prefix.length<4) for(let n=1;n<=4;n++) quantities([...prefix,n]);
}
quantities([]); eq(quantityCases,340,'all bounded quantity vectors');
for(const q of [[],[1,1,1,1,1],[0],[-0],[-1],[1.5],['1'],[NaN],[Infinity],[1n],new Array(2),Object.assign([1],{extra:1})]) {const a=admission();a.intentBinding.roomQuantities=q;eq(policy.classifyGuestIntentAdmission(a),'DENIED','invalid quantities');}
for(const key of Object.keys(binding())) {const a=admission();delete a.intentBinding[key];eq(policy.classifyGuestIntentAdmission(a),'DENIED','binding missing '+key);}
for(const key of ['intentDigest','quoteDigest']) {const a=admission();a.intentBinding[key]='d'.repeat(64);eq(policy.classifyGuestIntentAdmission(a),'DENIED','binding digest mismatch');}
{const a=admission();a.intentBinding.quoteExpiresAtMs=1999;eq(policy.classifyGuestIntentAdmission(a),'DENIED','expiry beyond quote');}
const accepted=()=>({v:1,audience:'wbe:test:fixture',intentId:'a'.repeat(64),issuedAtMs:1000,expiresAtMs:2000,acceptedAtMs:1100,guestAccess:'active',intentBinding:binding()});
const existing=()=>({...admission(),acceptedContext:accepted()});
eq(policy.classifyGuestIntentAdmission(existing()),'ACCEPTED_RESUME_ELIGIBLE','existing bootstrap resumes');
for(const command of ['bootstrap','resume','status']) for(const purpose of ['guest-bootstrap','guest-access']) for(const revoked of [false,true]) for(const now of [1500,2000,3000]) {
 const a=existing();a.command=command;a.claims.purpose=purpose;a.nowMs=now;a.acceptedContext.guestAccess=revoked?'revoked':'active';
 eq(policy.classifyGuestIntentAdmission(a),revoked||now>=2000||purpose==='guest-access'&&command==='bootstrap'?'DENIED':command==='status'?'ACCEPTED_STATUS_ELIGIBLE':'ACCEPTED_RESUME_ELIGIBLE','accepted command expiry revocation matrix');
}
for(const [key,value] of [['audience','other'],['intentId','d'.repeat(64)],['issuedAtMs',999],['expiresAtMs',1999],['acceptedAtMs',2000],['acceptedAtMs',1501],['guestAccess','unknown'],['v',2]]) {const a=existing();a.acceptedContext[key]=value;eq(policy.classifyGuestIntentAdmission(a),'DENIED','accepted '+key);}
for(const [key,value] of [['v',2],['intentDigest','d'.repeat(64)],['quoteDigest','d'.repeat(64)],['quoteExpiresAtMs',2501],['roomQuantities',[1,2,1]],['roomQuantities',[2,2]],['roomQuantities',[2,1]]]) {const a=existing();a.acceptedContext.intentBinding[key]=value;eq(policy.classifyGuestIntentAdmission(a),'DENIED','full binding '+key);}
{const a=existing();a.acceptedContext.acceptedAtMs=1000;eq(policy.classifyGuestIntentAdmission(a),'ACCEPTED_RESUME_ELIGIBLE','accepted at issue');}
const recovery=()=>({expectedAudience:'wbe:test:fixture',expectedIntentId:'a'.repeat(64),nowMs:3000,acceptedContext:accepted()});
eq(typeof policy.classifyAcceptedIntentRecovery,'function','recovery export exists');
for(const guestAccess of ['active','revoked']) {const a=recovery();a.acceptedContext.guestAccess=guestAccess;eq(policy.classifyAcceptedIntentRecovery(a),'ACCEPTED_PROTOCOL_RECOVERY_ELIGIBLE','historical accepted recovery beyond both expiries');}
for(const [key,value] of [['expectedAudience','other'],['expectedIntentId','d'.repeat(64)],['nowMs',1099],['acceptedContext',null],['claims',claims()],['isAdmin',true],['bookingNumber','WC-123']]) {const a=recovery();a[key]=value;eq(policy.classifyAcceptedIntentRecovery(a),'DENIED','internal boundary '+key);}
// Shared adversarial DTO tests exercise each nested location of every signature.
const suites=[
 [policy.checkVerifiedGuestClaims,args,['','claims'],'CLAIMS_ELIGIBLE'],
 [policy.classifyGuestIntentAdmission,existing,['','claims','intentBinding','acceptedContext','acceptedContext.intentBinding'],'ACCEPTED_RESUME_ELIGIBLE'],
 [policy.classifyAcceptedIntentRecovery,recovery,['','acceptedContext','acceptedContext.intentBinding'],'ACCEPTED_PROTOCOL_RECOVERY_ELIGIBLE']
];
function get(a,p) {return p?p.split('.').reduce((v,k)=>v[k],a):a;}
function set(a,p,v) {if(!p)return v;const ks=p.split('.');const last=ks.pop();get(a,ks.join('.'))[last]=v;return a;}
for(const [fn,factory,locations,success] of suites) for(const location of locations) {
 for(const key of Object.keys(get(factory(),location))) {
  const a=factory();delete get(a,location)[key];eq(fn(a),'DENIED','missing '+location+'.'+key);
  const b=factory();Object.defineProperty(get(b,location),key,{get(){invoked++;return 1;},enumerable:true});eq(fn(b),'DENIED','accessor '+location+'.'+key);
  const c=factory();Object.defineProperty(get(c,location),key,{enumerable:false});eq(fn(c),'DENIED','nonenumerable required');
 }
 for(const key of ['then','toJSON','bookingNumber','__proto__',Symbol.iterator,Symbol('hidden')]) {const a=factory();Object.defineProperty(get(a,location),key,{value(){invoked++;}});eq(fn(a),'DENIED','unknown own key');}
 for(const value of [undefined,null,42,'token',true,1n,Symbol(),()=>{},[],new Date(),new String('x')]) eq(fn(set(factory(),location,value)),fn===policy.classifyGuestIntentAdmission&&location==='acceptedContext'&&value===null?'NEW_INTENT_ELIGIBLE':'DENIED','record scalar categories');
 {const a=factory();const obj=get(a,location);Object.setPrototypeOf(obj,{...obj});eq(fn(a),'DENIED','custom prototype');}
 {const a=factory();Object.setPrototypeOf(get(a,location),null);eq(fn(a),success,'null prototype record');}
 {const a=factory();Object.freeze(get(a,location));eq(fn(a),success,'frozen record');}
 for(const trap of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor']) {const a=factory();eq(fn(set(a,location,new Proxy(get(a,location),{[trap](){throw Error('reflection');}}))),'DENIED','thrown '+trap);}
 for(const trap of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor']) {
  const a=factory(), target=get(a,location);let calls=0;
  const handler=trap==='getPrototypeOf'?{getPrototypeOf(t){return ++calls===1?Object.prototype:null;}}:trap==='ownKeys'?{ownKeys(t){const keys=Reflect.ownKeys(t);return ++calls===1?keys:keys.reverse();}}:{getOwnPropertyDescriptor(t,k){const d=Object.getOwnPropertyDescriptor(t,k);if(++calls>Object.keys(t).length && d) return {...d,writable:!d.writable};return d;}};
  eq(fn(set(a,location,new Proxy(target,handler))),'DENIED','observable changing '+trap);
 }
}
eq(invoked,0,'no executable property invoked anywhere');
for(const [fn,factory,,success] of suites) {
 const a=factory(), before=structuredClone(a);eq(fn(a),success,'graph success');assert.deepEqual(a,before,'caller graph unchanged');count++;
 const result=fn(a);a.nowMs=999999;eq(result,success,'primitive immutable result');eq(typeof result,'string','not an effect capability');
}
for(const location of ['intentBinding.roomQuantities','acceptedContext.intentBinding.roomQuantities']) {
 for(const mode of ['symbol','nonenumerable','accessor','custom','sparse','throw','changing']) {
  const a=existing(), q=get(a,location);
  if(mode==='symbol')q[Symbol('x')]=1;
  if(mode==='nonenumerable')Object.defineProperty(q,'x',{value:1});
  if(mode==='accessor')Object.defineProperty(q,'0',{get(){invoked++;return 2;}});
  if(mode==='custom')Object.setPrototypeOf(q,{});
  if(mode==='sparse')delete q[1];
  if(mode==='throw')set(a,location,new Proxy(q,{ownKeys(){throw Error('array');}}));
  if(mode==='changing'){let reads=0;set(a,location,new Proxy(q,{getOwnPropertyDescriptor(t,k){const d=Object.getOwnPropertyDescriptor(t,k);return k==='0'&&++reads>1?{...d,value:1}:d;}}));}
  eq(policy.classifyGuestIntentAdmission(a),'DENIED','array '+mode);
 }
 const a=existing();Object.freeze(get(a,location));eq(policy.classifyGuestIntentAdmission(a),'ACCEPTED_RESUME_ELIGIBLE','frozen dense array');
}
for(const value of ['a','Z'.repeat(128),'wbe:test_env-1.2']) {const a=args();a.expectedAudience=value;a.claims.audience=value;eq(policy.checkVerifiedGuestClaims(a),'CLAIMS_ELIGIBLE','audience accepted bounds');}
for(const value of ['', 'a'.repeat(129),'a\n','a\r','a\u2028','_a',':a','a/b',' a','Ａ']) {const a=args();a.expectedAudience=value;a.claims.audience=value;eq(policy.checkVerifiedGuestClaims(a),'DENIED','audience rejected bounds');}
for(const key of ['intentId','intentDigest','quoteDigest']) for(const value of ['0'.repeat(64),'f'.repeat(64)]) {const a=args();a.claims[key]=value;eq(policy.checkVerifiedGuestClaims(a),'CLAIMS_ELIGIBLE','hex bounds');}
for(const [fn,factory,locations] of suites) for(const loc of locations) for(const key of Object.keys(get(factory(),loc))) {
 if(!key.endsWith('Ms'))continue;
 for(const bad of [-0,-1,1.5,NaN,Infinity,'1000',1n,new Date(),Number.MAX_SAFE_INTEGER+1]) {const a=factory();get(a,loc)[key]=bad;eq(fn(a),'DENIED','all time locations '+loc+'.'+key);}
}
{const a=args();a.claims.issuedAtMs=Number.MAX_SAFE_INTEGER-1;a.claims.expiresAtMs=Number.MAX_SAFE_INTEGER;a.nowMs=Number.MAX_SAFE_INTEGER-1;eq(policy.checkVerifiedGuestClaims(a),'CLAIMS_ELIGIBLE','max safe times');}
{const a=recovery();a.nowMs=Number.MAX_SAFE_INTEGER;eq(policy.classifyAcceptedIntentRecovery(a),'ACCEPTED_PROTOCOL_RECOVERY_ELIGIBLE','recovery max time');}
for(const [key,value] of [['acceptedAtMs',999],['acceptedAtMs',2000],['guestAccess','unknown'],['expiresAtMs',2501],['issuedAtMs',2000]]) {const a=recovery();a.acceptedContext[key]=value;eq(policy.classifyAcceptedIntentRecovery(a),'DENIED','historical chronology '+key);}
// Captured dependencies remain usable after import. No pre-import corruption claim.
{
 const replacements=[[Reflect,'ownKeys'],[Object,'getPrototypeOf'],[Object,'getOwnPropertyDescriptor'],[Object,'create'],[Object,'defineProperty'],[Object,'is'],[Object.prototype,'hasOwnProperty'],[Array,'isArray'],[Number,'isSafeInteger'],[RegExp.prototype,'test'],[RegExp.prototype,'exec'],[Date,'now'],[JSON,'stringify'],[console,'log']];
 const originals=replacements.map(([o,k])=>o[k]);const a=existing();let result;
 try {for(const [o,k] of replacements)o[k]=()=>{throw Error('uncaptured dependency');};result=policy.classifyGuestIntentAdmission(a);}finally {replacements.forEach(([o,k],i)=>{o[k]=originals[i];});}
 eq(result,'ACCEPTED_RESUME_ELIGIBLE','captured intrinsics');
}
{
 const a=existing();let calls=0;const saved=Object.getOwnPropertyDescriptor(Object.prototype,'value');
 try {Object.defineProperty(Object.prototype,'value',{configurable:true,get(){calls++;throw Error('descriptor pollution');}});eq(policy.classifyGuestIntentAdmission(a),'ACCEPTED_RESUME_ELIGIBLE','safe private descriptor');}finally {delete Object.prototype.value;if(saved)Object.defineProperty(Object.prototype,'value',saved);}
 eq(calls,0,'no inherited descriptor getter');
}
assert.deepEqual([...source.matchAll(/export function (\w+)/g)].map(m=>m[1]).sort(),[...names].sort());count++;
eq(/\b(?:import|require|fetch|setTimeout|setInterval|async|console|process|Date|crypto)\b/.test(source.replace(/\/\/[^\n]*/g,'')),false,'no effect APIs or imports');
function productionFiles(dir) {return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?productionFiles(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of productionFiles(path.join(__dirname,'../velo'))) if(file!==sourcePath && path.resolve(file)!==path.resolve(sourcePath) && /\.(js|web\.js)$/.test(file)) eq(fs.readFileSync(file,'utf8').includes('guestBookingAccessPolicy'),false,'disconnected '+path.basename(file));
if(!process.env.GUEST_POLICY_MUTANT) {
 const mutants=[
 ['sum>4','sum>5'], ['a.nowMs<c.expiresAtMs','a.nowMs<=c.expiresAtMs'], ['!same(n,-0)','true'],
 ["r.guestAccess!=='active'","false"], ['a.roomQuantities[i]!==b.roomQuantities[i]','false'],
 ['r.issuedAtMs!==c.issuedAtMs','false'],['r.expiresAtMs!==c.expiresAtMs','false'],
 ['r.intentId!==c.intentId','false'],['r.audience!==c.audience','false'],
 ['a.quoteExpiresAtMs!==b.quoteExpiresAtMs','false'],
 ['function stable(observations) {','function stable(observations) { return true;'],
 ['r && r.audience===a.expectedAudience','r && a.nowMs<r.expiresAtMs && r.audience===a.expectedAudience']
 ];
 for(const mutant of mutants) {const run=require('node:child_process').spawnSync(process.execPath,[__filename],{encoding:'utf8',timeout:30000,env:{...process.env,GUEST_POLICY_MUTANT:JSON.stringify(mutant)}});eq(run.status,1,'mutant assertion exit '+mutant[0]);eq((run.stderr||'').includes('AssertionError [ERR_ASSERTION]'),true,'causal assertion mutant '+mutant[0]);eq(/SyntaxError|ReferenceError|TypeError/.test(run.stderr||''),false,'no incidental error mutant');}
 console.log(`causal assertion mutants: ${mutants.length} killed`);
}
console.log(`guest access policy: ${count} assertions passed; ${quantityCases} exhaustive quantity vectors`);
// Future adapters must prove signature-before-read, scoped authoritative lookup,
// same-ID unknown-result reconciliation, durable expiry race checks and protocol fences.
// These pure tests do not authenticate, run CMS, commit/compensate, or deploy.
