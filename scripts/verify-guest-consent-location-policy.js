'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname, '../velo/backend/guestConsentLocationPolicy.js');
const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
function load(text) {
  const context = vm.createContext({});
  vm.runInContext(text.replace('export function ', 'function ') + '\nthis.resolve = typeof resolveGuestConsentRequirement === "function" ? resolveGuestConsentRequirement : undefined;', context);
  return { context, resolve: context.resolve };
}
const candidate = load(source);
assert.equal(typeof candidate.resolve, 'function', 'resolver named export exists');
function check(name, expression, expected, instance = candidate) {
  const input = vm.runInContext(expression, instance.context);
  assert.equal(instance.resolve(input), expected, name);
}
const dto = (rows = '[]', country = 'CA', state = '') => `({v:1,location:{status:'KNOWN',countryCode:'${country}',usStateCode:'${state}'},requirements:{status:'COMPLETE',rows:${rows}}})`;
check('complete empty means no configurable receipt requirement, NOT consent or opt-out clearance', dto(), 'NOT_REQUIRED');
check('unknown is unresolved', `({v:1,location:{status:'UNKNOWN'},requirements:{status:'COMPLETE',rows:[]}})`, 'UNRESOLVED');
check('unavailable is unresolved', `({v:1,location:{status:'KNOWN',countryCode:'CA',usStateCode:''},requirements:{status:'UNAVAILABLE'}})`, 'UNRESOLVED');
check('missing envelope is unresolved', 'null', 'UNRESOLVED');
const changed = (body, base = dto()) => `(() => { const x=${base}; ${body}; return x; })()`;
for (const [label, body] of [
  ['extra envelope', 'x.extra=1'], ['missing version', 'delete x.v'], ['coerced version', "x.v='1'"],
  ['unknown fields', "x.location={status:'UNKNOWN',countryCode:'CA'}"],
  ['partial read', "x.requirements.status='PARTIAL'"], ['missing rows','delete x.requirements.rows'],
  ['US state mandatory', "x.location.countryCode='US'"], ['nonUS state',"x.location.usStateCode='NY'"],
  ['lowercase',"x.location.countryCode='ca'"], ['newline',"x.location.countryCode='CA\\n'"],
  ['boxed',"x.location.countryCode=new String('CA')"], ['symbol','x[Symbol()]=1'],
  ['nonenumerable',"Object.defineProperty(x,'extra',{value:1})"], ['custom prototype','Object.setPrototypeOf(x,{})']
]) check(label, changed(body), 'UNRESOLVED');
check('inherited fields', `Object.create(${dto()})`, 'UNRESOLVED');
check('getter not invoked', changed("Object.defineProperty(x,'v',{get(){throw Error('getter invoked')}})"), 'UNRESOLVED');
check('throwing reflection', `new Proxy(${dto()}, {ownKeys(){throw Error('trap')}})`, 'UNRESOLVED');
check('cap overflow', dto('Array.from({length:4097},()=>({countryCode:"CA",usStateCode:"",consentRequired:false}))'), 'UNRESOLVED');
check('sparse rows', dto('new Array(1)'), 'UNRESOLVED');
check('invalid unrelated row', dto('[{countryCode:"FR",usStateCode:"NY",consentRequired:false}]'), 'UNRESOLVED');
check('boolean not coerced', dto('[{countryCode:"CA",usStateCode:"",consentRequired:"false"}]'), 'UNRESOLVED');
// All flags below are synthetic policy, not laws or deployment seeds.
const rule = (countryCode, usStateCode, consentRequired) => ({countryCode, usStateCode, consentRequired});
const pool = [rule('US','',false),rule('US','',true),rule('US','NY',false),rule('US','NY',true),rule('US','CA',true),rule('CA','',true)];
function oracle(rows, country, state) {
  const matches = rows.filter(r => r.countryCode === country).filter(r => r.usStateCode === '' || r.usStateCode === state);
  return matches.map(r => r.consentRequired).includes(true) ? 'REQUIRED' : 'NOT_REQUIRED';
}
let oracleCases = 0;
for (const a of pool) for (const b of pool) for (const c of pool) {
  const rows = [a,b,c];
  for (const [country,state] of [['US','NY'],['CA',''],['FR','']]) {
    check('bounded independent OR oracle', dto(JSON.stringify(rows),country,state), oracle(rows,country,state));
    oracleCases++;
  }
}
check('matching true cannot skip corrupt trailing unrelated row', dto(JSON.stringify([rule('CA','',true),rule('FR','','true')])), 'UNRESOLVED');
check('lexical fabricated codes establish no authority', dto('[]','ZZ',''), 'NOT_REQUIRED');
check('lexical fabricated state establishes no membership', dto('[]','US','ZZ'), 'NOT_REQUIRED');
check('cap final true retained', dto('Array.from({length:4096},(_,i)=>({countryCode:"CA",usStateCode:"",consentRequired:i===4095}))'), 'REQUIRED');
const drift = changed(`x.requirements.rows=[new Proxy({countryCode:'CA',usStateCode:'',consentRequired:false},{ownKeys(t){x.location.countryCode='FR';return Reflect.ownKeys(t)}})]`);
check('later row changes prior location', drift, 'UNRESOLVED');
check('second-pass descriptor drift', `(() => {let scans=0; const x=${dto()}; return new Proxy(x,{ownKeys(t){if(++scans===2)t.v=2;return Reflect.ownKeys(t)}})})()`, 'UNRESOLVED');
check('final descriptor trap changes prototype', `(() => {let scans=0; const x=${dto()}; return new Proxy(x,{ownKeys(t){scans++;return Reflect.ownKeys(t)},getOwnPropertyDescriptor(t,k){const d=Reflect.getOwnPropertyDescriptor(t,k);if(scans===2&&k==='requirements')Object.setPrototypeOf(t,{});return d}})})()`, 'UNRESOLVED');
let edgeCases = 0;
const withRow = dto('[{countryCode:"CA",usStateCode:"",consentRequired:false}]');
for (const [target, fields] of [['x',['v','location','requirements']],['x.location',['status','countryCode','usStateCode']],['x.requirements',['status','rows']],['x.requirements.rows[0]',['countryCode','usStateCode','consentRequired']]]) {
  for (const field of fields) {
    for (const action of [`delete ${target}.${field}`, `Object.defineProperty(${target},'${field}',{enumerable:false})`, `Object.defineProperty(${target},'${field}',{get(){globalThis.accessorCalls++;return undefined}})`]) {
      vm.runInContext('globalThis.accessorCalls=0', candidate.context);
      check('exact mandatory enumerable data field '+target+'.'+field, changed(action,withRow), 'UNRESOLVED');
      assert.equal(candidate.context.accessorCalls,0,'accessor bodies never invoked'); edgeCases++;
    }
  }
  for (const action of [`${target}.extra=1`,`${target}[Symbol()]=1`,`Object.setPrototypeOf(${target},{})`,`Object.defineProperty(${target},'hidden',{value:1})`]) {
    check('exact shape '+target,changed(action,withRow),'UNRESOLVED'); edgeCases++;
  }
}
for (const code of ['','A','AAA','ca','CΑ','ＣＡ',' CA','CA ','CA\n','CA\r','CA\u2028']) {
  check('lexical country '+JSON.stringify(code), changed(`x.location.countryCode=${JSON.stringify(code)}`), 'UNRESOLVED');
  check('lexical state '+JSON.stringify(code), changed(`x.location.usStateCode=${JSON.stringify(code)}`,dto('[]','US','NY')), 'UNRESOLVED'); edgeCases+=2;
}
for (const value of ['undefined','null','0','1',"'true'","'false'",'new Boolean(false)','{}']) {
  check('primitive Boolean '+value,changed(`x.requirements.rows[0].consentRequired=${value}`,withRow),'UNRESOLVED'); edgeCases++;
}
for (const action of ["x.requirements.rows['01']=1",'x.requirements.rows[Symbol()]=1',"Object.defineProperty(x.requirements.rows,'0',{get(){throw Error('must not run')}})",'Object.setPrototypeOf(x.requirements.rows,null)',"x.requirements.rows=Object.create(Array.prototype)",'x.location=[]',"x.requirements={status:'UNAVAILABLE',rows:[]}","x.location={status:'UNKNOWN',usStateCode:''}"]) {
  check('invalid array/variant',changed(action,withRow),'UNRESOLVED'); edgeCases++;
}
check('cap valid false',dto('Array.from({length:4096},()=>({countryCode:"CA",usStateCode:"",consentRequired:false}))'),'NOT_REQUIRED');
check('cap corrupt last',dto('Array.from({length:4096},(_,i)=>({countryCode:"CA",usStateCode:"",consentRequired:i===4095?null:true}))'),'UNRESOLVED');
check('US unknown state even with country true',dto('[{countryCode:"US",usStateCode:"",consentRequired:true}]','US',''),'UNRESOLVED');
check('null prototypes',changed('Object.setPrototypeOf(x,null);Object.setPrototypeOf(x.location,null);Object.setPrototypeOf(x.requirements,null)'),'NOT_REQUIRED');
check('record insertion order irrelevant',`({requirements:{rows:[],status:'COMPLETE'},location:{usStateCode:'',countryCode:'CA',status:'KNOWN'},v:1})`,'NOT_REQUIRED');
const frozen = vm.runInContext(changed('Object.freeze(x.location);Object.freeze(x.requirements.rows);Object.freeze(x.requirements);Object.freeze(x)'),candidate.context);
const before = JSON.stringify(frozen);
assert.equal(candidate.resolve(frozen),'NOT_REQUIRED');
assert.equal(JSON.stringify(frozen),before,'frozen caller remains unchanged');
const mutable = vm.runInContext(dto(),candidate.context);
const primitive = candidate.resolve(mutable);
assert.equal(Object.isFrozen(mutable),false,'caller not frozen');
mutable.location.countryCode='US';
assert.equal(primitive,'NOT_REQUIRED','returned primitive independent of post-call edits');
// Mutations happen in isolated VM realms so no test runner intrinsics are poisoned.
for (const poison of [
  "Reflect.ownKeys=()=>[]", "Object.getOwnPropertyDescriptor=()=>undefined", "Object.getPrototypeOf=()=>null", "Array.isArray=()=>false", "Object.is=()=>false",
  "Object.defineProperty(Array.prototype,'0',{set(){throw Error('private array setter')},configurable:true})",
  "Object.defineProperty(Object.prototype,'get',{get(){throw Error('inherited descriptor getter')},configurable:true})",
  "Reflect.ownKeys.call=()=>{throw Error('poisoned call')}"
]) {
  const isolated=load(source);
  check('trusted captured closure '+poison,`(() => {const x=${dto()};let once=false;return new Proxy(x,{ownKeys(t){if(!once){once=true;${poison}}return ['v','location','requirements']}})})()`,'NOT_REQUIRED',isolated);
}
assert.deepEqual([...source.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m=>m[1]),['resolveGuestConsentRequirement'],'exact single export');
const executable = source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
assert.doesNotMatch(executable,/\b(?:import|require|async|await|Promise|fetch|console|Date|process|setTimeout|setInterval)\b/,'no imports or effect APIs');
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]); }
for(const other of walk(path.join(__dirname,'../velo')).filter(p=>/\.(?:js|jsw)$/.test(p)&&p!==file)) {
  assert.doesNotMatch(fs.readFileSync(other,'utf8'), /(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*guestConsentLocationPolicy/, 'no production incoming imports: '+other);
}
// Opt-out/withdrawal are independent authoritative eligibility facts, not DTO
// policy fields. NOT_REQUIRED neither clears a choice nor creates a grant.
for (const extra of ['optOut','withdrawn','receipt','provider','verified','complete','title','notes','_id']) {
  check('no metadata or choice authority '+extra,changed(`x.requirements.rows[0][${JSON.stringify(extra)}]=true`,withRow),'UNRESOLVED');
}
for (const trap of ['getPrototypeOf','getOwnPropertyDescriptor']) {
  check('reflective failure '+trap,`new Proxy(${dto()},{${trap}(){throw Error('inspection failure')}})`,'UNRESOLVED');
}
check('callable proxy is not a record',`new Proxy(()=>{}, {ownKeys(){return ['v','location','requirements']}})`,'UNRESOLVED');
check('final key drift',`(() => {let n=0;const x=${dto()};return new Proxy(x,{ownKeys(t){if(++n===2)t.extra=1;return Reflect.ownKeys(t)}})})()`,'UNRESOLVED');
check('final flags drift',`(() => {let n=0;const x=${dto()};return new Proxy(x,{ownKeys(t){if(++n===2)Object.defineProperty(t,'v',{writable:false});return Reflect.ownKeys(t)}})})()`,'UNRESOLVED');
// Each one-point mutant has an original-pass / mutant-ERR_ASSERTION witness.
// Syntax errors, loader faults, exceptions and timeout kills never count.
const trueRow = dto('[{countryCode:"CA",usStateCode:"",consentRequired:true}]');
const mutants = [
 ['invert-output', "return required ? 'REQUIRED' : 'NOT_REQUIRED';", "return required ? 'NOT_REQUIRED' : 'REQUIRED';", trueRow, 'REQUIRED'],
 ['drop-required', 'required = true;', 'required = false;', trueRow, 'REQUIRED'],
 ['early-true-skips-allrow', 'required = true;', "return 'REQUIRED';", dto(JSON.stringify([rule('CA','',true),rule('FR','','true')])), 'UNRESOLVED'],
 ['lose-country-scope', 'row.countryCode === location.countryCode &&', 'true &&', dto('[{countryCode:"FR",usStateCode:"",consentRequired:true}]'), 'NOT_REQUIRED'],
 ['lose-state-scope', "row.usStateCode === '' || (row.countryCode === 'US' && row.usStateCode === location.usStateCode)", "row.usStateCode === '' || row.countryCode === 'US'", dto('[{countryCode:"US",usStateCode:"CA",consentRequired:true}]','US','NY'), 'NOT_REQUIRED'],
 ['cap-overflow-admitted', 'length > 4096', 'length > 4097', dto('Array.from({length:4097},()=>({countryCode:"CA",usStateCode:"",consentRequired:false}))'), 'UNRESOLVED'],
 ['cap-inclusive-offbyone', 'length > 4096', 'length >= 4096', dto('Array.from({length:4096},()=>({countryCode:"CA",usStateCode:"",consentRequired:false}))'), 'NOT_REQUIRED'],
 ['omit-final-stability', 'let node = observations;', 'let node = null;', drift, 'UNRESOLVED'],
 ['lose-boolean-validation', "typeof row.consentRequired !== 'boolean'", 'false', dto('[{countryCode:"CA",usStateCode:"",consentRequired:0}]'), 'UNRESOLVED'],
 ['permit-unknown-US-state', "!token(location.usStateCode) :", "false :", dto('[]','US',''), 'UNRESOLVED'],
 ['live-ownKeys', 'const ownKeys = Reflect.ownKeys;', 'const ownKeys = value => Reflect.ownKeys(value);', `(() => {const x=${dto()};let once=false;return new Proxy(x,{ownKeys(){if(!once){once=true;Reflect.ownKeys=()=>[]}return ['v','location','requirements']}})})()`, 'NOT_REQUIRED'],
 ['inherited-private-storage', 'const values = { __proto__: null };', 'const values = {};', `(() => {const x=${dto()};return new Proxy(x,{ownKeys(){Object.defineProperty(Object.prototype,'v',{set(){throw Error('redirected storage')},configurable:true});return ['v','location','requirements']}})})()`, 'NOT_REQUIRED']
];
let killed = 0;
for (const [name, from, to, expression, expected] of mutants) {
  assert.equal(source.split(from).length,2,'unique mutation anchor '+name);
  check('original witness '+name,expression,expected,load(source));
  const mutant=load(source.replace(from,to));
  let failure;
  try { check('mutant witness '+name,expression,expected,mutant); } catch(error) { failure=error; }
  assert.equal(failure?.code,'ERR_ASSERTION','causal semantic kill '+name);
  assert.equal(failure?.message.startsWith('mutant witness '+name),true,'named witness '+name);
  killed++;
  console.log('semantic mutant killed:',name,'ERR_ASSERTION');
}
console.log('guest consent location: PASS', {oracleCases,edgeCases,semanticMutantsKilled:killed});
