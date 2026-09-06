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
const productionRoot = path.resolve(__dirname, '../velo');
const credentialPath = path.join(productionRoot, 'backend/guestBookingCredentials.js');
const credentialSource = fs.readFileSync(credentialPath, 'utf8');

// Exact conditional private acquisition candidate: acceptance-acquisition-direction-private-review.json.
// Four backend paths only; the fifth reviewed file is a verifier, never a runtime dependency.
// No physical-engine, public-consumer or live activation approval.
const acquisitionPrivatePins = {
  "velo/backend/guestBookingAcquisitionContentionEvidence.js": {
    "sha256": "50f6202635b2a2e11be3051ee40544572f2eb41119746ac9f20bbaf657c60fbf",
    "imports": [
      "import wixData from 'wix-data';",
      "import { readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';",
      "import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';",
      "import { readGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestStore';",
      "import { buildGuestBookingAllocationBinding, validateGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestRules';",
      "import { validateRetainedClaimLedger } from 'backend/guestBookingAllocationRetainedRules';",
      "import { readGuestBookingAcquisitionControl } from 'backend/guestBookingAcquisitionControlStore';",
      "import { canonicalGuestBookingAcquisitionControl } from 'backend/guestBookingAcquisitionControlRules';"
    ],
    "exports": [
      "export function createGuestBookingAcquisitionReadScope(){",
      "export async function readGuestBookingAcquisitionContentionEvidence(A){"
    ]
  },
  "velo/backend/guestBookingAcquisitionControl.js": {
    "sha256": "6cd0b108848964da1cfca8ca212b5758ff2057e6554a75c9980c8e5097c6dd45",
    "imports": [
      "import { readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';",
      "import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';",
      "import { readGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestStore';",
      "import { buildGuestBookingAllocationBinding, validateGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestRules';",
      "import { reconcileGuestBookingAcquisitionControl } from 'backend/guestBookingAcquisitionControlStore';",
      "import { createGuestBookingAcquisitionReadScope } from 'backend/guestBookingAcquisitionContentionEvidence';",
      "import { canonicalGuestBookingAcquisitionControl } from 'backend/guestBookingAcquisitionControlRules';"
    ],
    "exports": [
      "export async function resumeGuestBookingAcquisitionControl(acceptanceId){"
    ]
  },
  "velo/backend/guestBookingAcquisitionControlRules.js": {
    "sha256": "cba4477c5f3ec2758154474121e84342ed97486d8d487f9349c0795571b6a7d3",
    "imports": [
      "import { Buffer } from 'buffer';"
    ],
    "exports": [
      "export function isGuestBookingAcquisitionControlId(id){",
      "export function decodeGuestBookingAcquisitionControl(value,metadata=false){",
      "export function canonicalGuestBookingAcquisitionControl(value){"
    ]
  },
  "velo/backend/guestBookingAcquisitionControlStore.js": {
    "sha256": "c1c4d567a9c3c300ce2c5dcd48d11e4467e643e740343874f8822028591dc8fc",
    "imports": [
      "import wixData from 'wix-data';",
      "import { decodeGuestBookingAcquisitionControl, canonicalGuestBookingAcquisitionControl, isGuestBookingAcquisitionControlId } from 'backend/guestBookingAcquisitionControlRules';"
    ],
    "exports": [
      "export async function readGuestBookingAcquisitionControl(id){",
      "export async function reconcileGuestBookingAcquisitionControl(candidate){"
    ]
  }
};
const acquisitionPrivateReferences = /canonicalGuestBookingAcquisitionControl|createGuestBookingAcquisitionReadScope|decodeGuestBookingAcquisitionControl|guestBookingAcquisitionContentionEvidence|guestBookingAcquisitionControl|guestBookingAcquisitionControlRules|guestBookingAcquisitionControlStore|isGuestBookingAcquisitionControlId|readGuestBookingAcquisitionContentionEvidence|readGuestBookingAcquisitionControl|reconcileGuestBookingAcquisitionControl|resumeGuestBookingAcquisitionControl/i;

function acquisitionReferenceText(text) {
  return text.replace(/\\(?:\r\n|[\n\r\u2028\u2029])/g, '')
    .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b, c) => {
      const n = parseInt(a || b || c, 16);
      return n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd';
    }).replace(/\\([^\r\n])/g, '$1');
}
// null delegates to the unchanged historical guards; false denies, true admits
// ONLY a pinned file. Do not resolve aliases before exact path comparison.
function acquisitionPrivateEdge(file, source) {
  const pin = Object.hasOwn(acquisitionPrivatePins, file) ? acquisitionPrivatePins[file] : null;
  const text = source.replace(/\r\n/g, '\n');
  if (!pin) return acquisitionPrivateReferences.test(acquisitionReferenceText(text)) ? false : null;
  if (JSON.stringify(text.match(/^import .*$/gm) || []) !== JSON.stringify(pin.imports)) return false;
  if (JSON.stringify(text.match(/^export .*$/gm) || []) !== JSON.stringify(pin.exports)) return false;
  return require('node:crypto').createHash('sha256').update(text, 'utf8').digest('hex') === pin.sha256;
}
function runAcquisitionIsolationMetatests(gate) {
  const names = [], witnesses = [], mutantHashes = new Set();
  const accepted = (file, text) => {
    try { return gate(file, text) !== false; }
    catch (error) { if (error.code !== 'ERR_ASSERTION') throw error; return false; }
  };
  const controls = Object.keys(acquisitionPrivatePins).map(file =>
    [file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8')]);
  const probes = [];
  for (const [file, source] of controls) {
    const pin = acquisitionPrivatePins[file], module = path.basename(file, '.js');
    probes.push(['exact ' + module, file, source, true],
      ['CRLF ' + module, file, source.replace(/\r?\n/g, '\r\n'), true]);
    for (const [name, text] of [
      ['body', source + '\nvoid 0;\n'], ['extra export', source + '\nexport const bridge = 1;'],
      ['extra import', source + "\nimport 'wix-data';"], ['dynamic import', source + "\nimport('wix-data');"],
      ['reexport', source + "\nexport * from 'wix-data';"], ['web bridge', source + '\nexport const bridge = webMethod();'],
      ['BOM', '\ufeff' + source], ['space', source + ' '], ['lone CR', source.replace(/\r?\n/g, '\r')]
    ]) probes.push([name + ' ' + module, file, text, false]);
    for (const declaration of pin.imports) {
      const spec = declaration.match(/'([^']+)'/)[1];
      for (const [name, text] of [
        ['missing', source.replace(declaration, '')], ['duplicate', source + '\n' + declaration],
        ['path alias', source.replace(declaration, declaration.replace(spec, './nested/../' + spec))],
        ['escaped path', source.replace(declaration, declaration.replace(spec, '\\u{00000062}' + spec.slice(1)))]
      ]) probes.push([name + ' ' + module + ' ' + spec, file, text, false]);
    }
    for (const other of ['velo/public/' + module + '.js', 'velo/backend/' + module + '.web.js',
      'velo/backend/' + module + '.jsw', 'velo/pages/' + module + '.js',
      'velo/backend/nested/../' + module + '.js', './' + file, file.toUpperCase()])
      probes.push(['copy ' + other, other, source, false]);
    for (const consumer of ['velo/backend/consumer.js', 'velo/public/consumer.js', 'velo/pages/consumer.js', 'velo/backend/consumer.web.js', 'velo/backend/consumer.jsw']) {
      for (const [form, wrap] of [
        ['static', spec => `import * as alias from '${spec}';`],
        ['dynamic', spec => `import('${spec}');`],
        ['require', spec => `require('${spec}');`],
        ['reexport', spec => `export * from '${spec}';`]
      ]) {
        for (const spec of ['backend/' + module, './nested/../' + module + '.js',
          'backend/\\u{000000' + module.charCodeAt(0).toString(16) + '}' + module.slice(1), 'backend/\\u' + module.charCodeAt(0).toString(16).padStart(4, '0') + module.slice(1), 'backend/\\x' + module.charCodeAt(0).toString(16) + module.slice(1)])
          probes.push([consumer + ' ' + form + ' ' + spec, consumer, wrap(spec), false]);
        for (const [ending, terminator] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r'], ['LS', '\u2028'], ['PS', '\u2029']]) {
          probes.push([consumer + ' ' + form + ' ' + module + ' ' + ending, consumer,
            wrap('backend/' + module.slice(0, 6) + '\\' + terminator + module.slice(6)), false]);
        }
      }
    }
  }
  for (const spec of ['backend/unrelatedUtility', 'backend/\\u{00000075}nrelatedUtility'])
    probes.push(['benign ' + spec, 'velo/backend/inert.js', `import('${spec}');`, true]);
  for (const [ending, terminator] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r'], ['LS', '\u2028'], ['PS', '\u2029']])
    probes.push(['benign continuation ' + ending, 'velo/backend/inert.js', "import('backend/unrelated\\" + terminator + "Utility');", true]);
  // Exact declared exports and named incoming references, not only module names.
  for (const [file, source] of controls) {
    const pin = acquisitionPrivatePins[file];
    for (const declaration of pin.exports) {
      const name = declaration.match(/^export (?:async )?function (\w+)/)[1];
      probes.push(['removed export ' + name, file, source.replace(declaration, ''), false],
        ['renamed export ' + name, file, source.replace(declaration, declaration.replace(name, name + 'Changed')), false]);
      for (const consumer of ['velo/public/exportBridge.js', 'velo/backend/exportBridge.web.js'])
        probes.push(['named bridge ' + consumer + ' ' + name, consumer, `export { ${name} } from 'backend/other';`, false]);
    }
  }
  // All legal continuations and arbitrarily leading-zero braced escapes remain
  // lexical data. No synthetic consumer is linked or evaluated.
  for (const zeros of [7, 32, 256]) {
    const escaped = '\\u{' + '0'.repeat(zeros) + '67}uestBookingAcquisitionControl';
    probes.push(['leading zeros forbidden ' + zeros, 'velo/backend/decoder.web.js', `import('backend/${escaped}');`, false],
      ['leading zeros benign ' + zeros, 'velo/backend/decoder.web.js', `import('backend/\\u{${'0'.repeat(zeros)}75}nrelatedUtility');`, true]);
  }
  for (const [name, file, text, expected] of probes) {
    for (const [controlFile, controlText] of controls)
      assert.equal(accepted(controlFile, controlText), true, 'acquisition positive before ' + name);
    assert.equal(accepted(file, text), expected, 'acquisition isolation ' + name);
    names.push(name);
  }
  assert.equal(new Set(names).size, names.length, 'unique acquisition fixtures');
  // One identical function replacement per guard, multiple causal witnesses.
  // The full real guard is exercised; mutated production text is never executed.
  const intact = acquisitionPrivateEdge;
  const bypass = function acquisitionPrivateEdge(file, source) { return true; };
  for (const [name, file, text] of probes.filter(p => !p[3] &&
    (p[0].startsWith('body ') || p[0].startsWith('extra export ') || p[0].startsWith('extra import ') || p[0].startsWith('copy ') || p[0].startsWith('reexport ') || p[0].startsWith('web bridge ') || p[0].includes('consumer.web.js dynamic backend/guestBooking')))) {
    const witness = () => assert.equal(accepted(file, text), false, 'causal acquisition fence ' + name);
    witness();
    let failure;
    try {
      acquisitionPrivateEdge = bypass;
      assert.equal(accepted(file, text), true, 'bypass reaches forbidden acquisition ' + name);
      try { witness(); } catch (error) { failure = error; }
    } finally { acquisitionPrivateEdge = intact; }
    assert.equal(failure && failure.code, 'ERR_ASSERTION', 'causal acquisition assertion ' + name);
    assert.ok(failure.message.startsWith('causal acquisition fence ' + name), 'intended acquisition witness ' + name);
    witness(); witnesses.push(name);
    const verifier = fs.readFileSync(__filename, 'utf8');
    assert.equal(verifier.split(intact.toString()).length - 1, 1, 'unique acquisition gate mutation target');
    const mutant = verifier.replace(intact.toString(), bypass.toString());
    mutantHashes.add(require('node:crypto').createHash('sha256').update(mutant).digest('hex'));
  }
  assert.equal(new Set(witnesses).size, witnesses.length, 'unique acquisition witnesses');
  const fixtureHashes = [...new Set(probes.map(([, file, text, expected]) => require('node:crypto').createHash('sha256').update(JSON.stringify([file, text, expected])).digest('hex')))];
  const report = {cases:names.length, distinctFixtures:fixtureHashes.length, fixtureHashes, names, mutantApplications:witnesses.length, mutantCount:mutantHashes.size, mutantHashes:[...mutantHashes], witnessCount:witnesses.length, witnesses};
  console.log(JSON.stringify({acquisitionIsolationMetatests:report}));
  return report;
}

// Exact private allocation candidate: acceptance-allocation-private-final-review-v2.
// Canonical LF only; no public activation, aliases, or new runtime consumers.
const allocationPrivatePins = {
  "velo/backend/guestBookingAllocationEvidence.js": {
    "sha256": "1766af3f330c5cc4520364f16f4757d963a90fbeeb6104c1090ec8a5cdec505d",
    "imports": [
      "import wixData from 'wix-data';",
      "import { buildInventorySnapshot } from 'backend/roomInventoryRules';"
    ],
    "exports": [
      "export async function readGuestBookingAllocationEvidence(checkIn,checkOut){"
    ]
  },
  "velo/backend/guestBookingAllocationHandoff.js": {
    "sha256": "08a6a838867fab6854855ba0615c7a603e98575d0e805b1a8daa47bdb333f74f",
    "imports": [
      "import { readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';",
      "import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';",
      "import { readGuestBookingAllocationManifest, insertGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestStore';",
      "import { buildGuestBookingAllocationBinding, buildGuestBookingAllocationManifest, validateGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestRules';",
      "import { readGuestBookingAllocationEvidence } from 'backend/guestBookingAllocationEvidence';",
      "import { buildWholeCartAllocation } from 'backend/wholeCartPlanningRules';"
    ],
    "exports": [
      "export async function handoffGuestBookingAllocation(acceptanceId){"
    ]
  },
  "velo/backend/guestBookingAllocationManifestRules.js": {
    "sha256": "ed57ec1e9c98e7a22aa4119d207f498c177c2e3ece6d0e724b64dd008e0975d9",
    "imports": [
      "import { createHash } from 'crypto';",
      "import { Buffer } from 'buffer';",
      "import { validatePhysicalCommit } from 'backend/roomBookingCommitRules';",
      "import { validateRetainedClaimLedger } from 'backend/guestBookingAllocationRetainedRules';"
    ],
    "exports": [
      "export function buildGuestBookingAllocationBinding(validatedRoot){",
      "export function buildGuestBookingAllocationManifest(validatedRoot,allocation,evidence){",
      "export function validateGuestBookingAllocationManifest(record,validatedRoot){"
    ]
  },
  "velo/backend/guestBookingAllocationManifestStore.js": {
    "sha256": "e26fd317eb167f867c71b30c2461c6aa890e6186d33b5e61d3fe90352bceedb1",
    "imports": [
      "import wixData from 'wix-data';",
      "import { Buffer } from 'buffer';"
    ],
    "exports": [
      "export async function insertGuestBookingAllocationManifest(record){try{const row=copy(record);await wixData.insert(collection,row,{suppressAuth:true,suppressHooks:true});return 'ACKNOWLEDGED';}catch{return 'UNRESOLVED';}}",
      "export async function readGuestBookingAllocationManifest(id){"
    ]
  },
  "velo/backend/guestBookingAllocationRetainedRules.js": {
    "sha256": "4c84039c5c72e3958fdcf3b30e6466c440dabe726009f25720fb5030bafd1b8c",
    "imports": [],
    "exports": [
      "export function validateRetainedClaimLedger(ledger) {"
    ]
  },
  "velo/backend/roomBookingCommitRules.js": {
    "sha256": "bf104d909eab461e1553860b1e7b2448ce0ed155ae84a0537a92c581ec0c853a",
    "imports": [
      "import { evaluateAutomaticAvailability } from 'backend/roomAvailabilityRules';"
    ],
    "exports": [
      "export function buildPhysicalCommitPlan(snapshot, claimLedger, request) {",
      "export function validatePhysicalCommit(plan, bookingRows, acquisitions) {",
      "export function planPhysicalRollback(acquisitions, releaseReason) {"
    ]
  },
  "velo/backend/wholeCartPlanningRules.js": {
    "sha256": "1489d16427533df800253e1f1d6fce61e0418ff222103f8916a17bcb36cc5896",
    "imports": [
      "import { buildPhysicalCommitPlan } from 'backend/roomBookingCommitRules';"
    ],
    "exports": [
      "export function buildWholeCartAllocation(input) {"
    ]
  }
};
const allocationPrivateReferences = /buildGuestBookingAllocationBinding|buildGuestBookingAllocationManifest|buildPhysicalCommitPlan|buildWholeCartAllocation|guestBookingAllocationEvidence|guestBookingAllocationHandoff|guestBookingAllocationManifestRules|guestBookingAllocationManifestStore|guestBookingAllocationRetainedRules|handoffGuestBookingAllocation|insertGuestBookingAllocationManifest|planPhysicalRollback|readGuestBookingAllocationEvidence|readGuestBookingAllocationManifest|roomBookingCommitRules|validateGuestBookingAllocationManifest|validatePhysicalCommit|validateRetainedClaimLedger|wholeCartPlanningRules/i;

function allocationReferenceText(text) {
  return text.replace(/\\(?:\r\n|[\n\r\u2028\u2029])/g, '')
    .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b, c) => {
      const n = parseInt(a || b || c, 16);
      return n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd';
    }).replace(/\\([^\r\n])/g, '$1');
}
// null delegates to the unchanged historical guards; false denies, true admits
// ONLY a pinned file. Do not resolve aliases before exact path comparison.
function allocationPrivateEdge(file, source) {
  const pin = Object.hasOwn(allocationPrivatePins, file) ? allocationPrivatePins[file] : null;
  const text = source.replace(/\r\n/g, '\n');
  if (!pin) return allocationPrivateReferences.test(allocationReferenceText(text)) ? false : null;
  if (JSON.stringify(text.match(/^import .*$/gm) || []) !== JSON.stringify(pin.imports)) return false;
  if (JSON.stringify(text.match(/^export .*$/gm) || []) !== JSON.stringify(pin.exports)) return false;
  return require('node:crypto').createHash('sha256').update(text, 'utf8').digest('hex') === pin.sha256;
}
function runAllocationIsolationMetatests(gate) {
  const names = [], witnesses = [], mutantHashes = new Set();
  const accepted = (file, text) => {
    try { return gate(file, text) !== false; }
    catch (error) { if (error.code !== 'ERR_ASSERTION') throw error; return false; }
  };
  const controls = Object.keys(allocationPrivatePins).map(file =>
    [file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8')]);
  const probes = [];
  for (const [file, source] of controls) {
    const pin = allocationPrivatePins[file], module = path.basename(file, '.js');
    probes.push(['exact ' + module, file, source, true],
      ['CRLF ' + module, file, source.replace(/\r?\n/g, '\r\n'), true]);
    for (const [name, text] of [
      ['body', source + '\nvoid 0;\n'], ['extra export', source + '\nexport const bridge = 1;'],
      ['extra import', source + "\nimport 'wix-data';"], ['dynamic import', source + "\nimport('wix-data');"],
      ['reexport', source + "\nexport * from 'wix-data';"], ['web bridge', source + '\nexport const bridge = webMethod();'],
      ['BOM', '\ufeff' + source], ['space', source + ' '], ['lone CR', source.replace(/\r?\n/g, '\r')]
    ]) probes.push([name + ' ' + module, file, text, false]);
    for (const declaration of pin.imports) {
      const spec = declaration.match(/'([^']+)'/)[1];
      for (const [name, text] of [
        ['missing', source.replace(declaration, '')], ['duplicate', source + '\n' + declaration],
        ['path alias', source.replace(declaration, declaration.replace(spec, './nested/../' + spec))],
        ['escaped path', source.replace(declaration, declaration.replace(spec, '\\u{00000062}' + spec.slice(1)))]
      ]) probes.push([name + ' ' + module + ' ' + spec, file, text, false]);
    }
    for (const other of ['velo/public/' + module + '.js', 'velo/backend/' + module + '.web.js',
      'velo/backend/' + module + '.jsw', 'velo/pages/' + module + '.js',
      'velo/backend/nested/../' + module + '.js', './' + file, file.toUpperCase()])
      probes.push(['copy ' + other, other, source, false]);
    for (const consumer of ['velo/backend/consumer.js', 'velo/public/consumer.js', 'velo/pages/consumer.js', 'velo/backend/consumer.web.js', 'velo/backend/consumer.jsw']) {
      for (const [form, wrap] of [
        ['static', spec => `import * as alias from '${spec}';`],
        ['dynamic', spec => `import('${spec}');`],
        ['require', spec => `require('${spec}');`],
        ['reexport', spec => `export * from '${spec}';`]
      ]) {
        for (const spec of ['backend/' + module, './nested/../' + module + '.js',
          'backend/\\u{000000' + module.charCodeAt(0).toString(16) + '}' + module.slice(1), 'backend/\\u' + module.charCodeAt(0).toString(16).padStart(4, '0') + module.slice(1), 'backend/\\x' + module.charCodeAt(0).toString(16) + module.slice(1)])
          probes.push([consumer + ' ' + form + ' ' + spec, consumer, wrap(spec), false]);
        for (const [ending, terminator] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r'], ['LS', '\u2028'], ['PS', '\u2029']]) {
          probes.push([consumer + ' ' + form + ' ' + module + ' ' + ending, consumer,
            wrap('backend/' + module.slice(0, 6) + '\\' + terminator + module.slice(6)), false]);
        }
      }
    }
  }
  for (const spec of ['backend/unrelatedUtility', 'backend/\\u{00000075}nrelatedUtility'])
    probes.push(['benign ' + spec, 'velo/backend/inert.js', `import('${spec}');`, true]);
  for (const [ending, terminator] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r'], ['LS', '\u2028'], ['PS', '\u2029']])
    probes.push(['benign continuation ' + ending, 'velo/backend/inert.js', "import('backend/unrelated\\" + terminator + "Utility');", true]);
  // Exact declared exports and named incoming references, not only module names.
  for (const [file, source] of controls) {
    const pin = allocationPrivatePins[file];
    for (const declaration of pin.exports) {
      const name = declaration.match(/^export (?:async )?function (\w+)/)[1];
      probes.push(['removed export ' + name, file, source.replace(declaration, ''), false],
        ['renamed export ' + name, file, source.replace(declaration, declaration.replace(name, name + 'Changed')), false]);
      for (const consumer of ['velo/public/exportBridge.js', 'velo/backend/exportBridge.web.js'])
        probes.push(['named bridge ' + consumer + ' ' + name, consumer, `export { ${name} } from 'backend/other';`, false]);
    }
  }
  // All legal continuations and arbitrarily leading-zero braced escapes remain
  // lexical data. No synthetic consumer is linked or evaluated.
  for (const zeros of [7, 32, 256]) {
    const escaped = '\\u{' + '0'.repeat(zeros) + '67}uestBookingAllocationHandoff';
    probes.push(['leading zeros forbidden ' + zeros, 'velo/backend/decoder.web.js', `import('backend/${escaped}');`, false],
      ['leading zeros benign ' + zeros, 'velo/backend/decoder.web.js', `import('backend/\\u{${'0'.repeat(zeros)}75}nrelatedUtility');`, true]);
  }
  for (const [name, file, text, expected] of probes) {
    for (const [controlFile, controlText] of controls)
      assert.equal(accepted(controlFile, controlText), true, 'allocation positive before ' + name);
    assert.equal(accepted(file, text), expected, 'allocation isolation ' + name);
    names.push(name);
  }
  assert.equal(new Set(names).size, names.length, 'unique allocation fixtures');
  // One identical function replacement per guard, multiple causal witnesses.
  // The full real guard is exercised; mutated production text is never executed.
  const intact = allocationPrivateEdge;
  const bypass = () => true;
  for (const [name, file, text] of probes.filter(p => !p[3] &&
    (p[0].startsWith('body ') || p[0].startsWith('extra export ') || p[0].startsWith('extra import ') || p[0].startsWith('copy ') || p[0].startsWith('reexport ') || p[0].startsWith('web bridge ') || p[0].includes('consumer.web.js dynamic backend/guestBooking')))) {
    const witness = () => assert.equal(accepted(file, text), false, 'causal allocation fence ' + name);
    witness();
    let failure;
    try {
      allocationPrivateEdge = bypass;
      assert.equal(accepted(file, text), true, 'bypass reaches forbidden allocation ' + name);
      try { witness(); } catch (error) { failure = error; }
    } finally { allocationPrivateEdge = intact; }
    assert.equal(failure && failure.code, 'ERR_ASSERTION', 'causal allocation assertion ' + name);
    assert.ok(failure.message.startsWith('causal allocation fence ' + name), 'intended allocation witness ' + name);
    witness(); witnesses.push(name);
    mutantHashes.add(require('node:crypto').createHash('sha256').update(bypass.toString()).digest('hex'));
  }
  assert.equal(new Set(witnesses).size, witnesses.length, 'unique allocation witnesses');
  const report = {cases:names.length, names, mutantApplications:witnesses.length, mutantCount:mutantHashes.size, mutantHashes:[...mutantHashes], witnessCount:witnesses.length, witnesses};
  console.log(JSON.stringify({allocationIsolationMetatests:report}));
  return report;
}

// Exact private acceptance graph reviewed in acceptance-private-slice-review-v3.
// Local isolation pins only: no public activation or implementation self-approval.
const acceptancePrivatePins = {
  "velo/backend/guestBookingIssuerAuthority.js": {
    "sha256": "b5578ae7bcdef12eb54ad37f3775a5ac3ccccdbe292e89b4561ed5498804919b",
    "imports": [
      "import crypto from 'crypto';",
      "import { Buffer } from 'buffer';",
      "import wixData from 'wix-data';",
      "import { secrets } from 'wix-secrets-backend.v2';",
      "import { elevate } from 'wix-auth';",
      "import { createGuestBookingCredentials } from 'backend/guestBookingCredentials';"
    ],
    "exports": [
      "export function acceptanceDigest(domain,text) {",
      "export function buildGuestBookingAcceptanceRoot(capsule,o,c,kid,validatedAtMs) {",
      "export function acceptanceTime() {",
      "export function boundedJson(text,max=120000) {",
      "export function exactFields(value,names) {",
      "export function snapshotAcceptancePage(page,max){",
      "export async function readGuestBookingCredentialAuthority() {",
      "export async function readGuestBookingIssuerAuthority() {"
    ]
  },
  "velo/backend/guestBookingOfferIssuer.js": {
    "sha256": "fc01e66d6cf480d352a29729e4350e49c0fe83db184185e220fd5e3a76e634c0",
    "imports": [
      "import { Buffer } from 'buffer';",
      "import { canonicalizeGuestBookingPurchaseInput } from 'backend/guestBookingPurchaseInput';",
      "import { calculateGuestBookingFinancials } from 'backend/guestBookingFinancialCalculation';",
      "import { readLockedPricingQuoteAuthority } from 'backend/lockedPricingQuoteAuthority';",
      "import { readGuestBookingIssuerAuthority, acceptanceDigest, acceptanceTime, boundedJson, exactFields, buildGuestBookingAcceptanceRoot } from 'backend/guestBookingIssuerAuthority';"
    ],
    "exports": [
      "export function validateGuestBookingOfferCapsule(capsule){",
      "export async function issueGuestBookingOffer(input){"
    ]
  },
  "velo/backend/guestBookingAcceptanceStore.js": {
    "sha256": "3cb3f02fbb92168364c21169e30834ba75980768de35e14ca9a2b9f8aa25a75c",
    "imports": [
      "import wixData from 'wix-data';",
      "import { boundedJson, snapshotAcceptancePage } from 'backend/guestBookingIssuerAuthority';"
    ],
    "exports": [
      "export async function insertGuestBookingAcceptance(root){",
      "export async function readGuestBookingAcceptance(id){",
      "export async function scanGuestBookingAcceptances(cursor){"
    ]
  },
  "velo/backend/guestBookingAcceptance.js": {
    "sha256": "a24b038118bbc3d94794e7d30f33262443a57a5f63e92c13aab9b91b8a4fdb31",
    "imports": [
      "import { readGuestBookingCredentialAuthority, acceptanceDigest, acceptanceTime, boundedJson, exactFields, buildGuestBookingAcceptanceRoot } from 'backend/guestBookingIssuerAuthority';",
      "import { validateGuestBookingOfferCapsule } from 'backend/guestBookingOfferIssuer';",
      "import { insertGuestBookingAcceptance, readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';"
    ],
    "exports": [
      "export function validateGuestBookingAcceptanceRoot(value){",
      "export async function acceptGuestBookingOffer(token,capsule){",
      "export async function readOwnGuestBookingAcceptance(token,capsule){"
    ]
  },
  "velo/backend/guestBookingAcceptanceDiscovery.js": {
    "sha256": "a5da677120ae6a5bbf0a09cc95391eb06de9dca40d3b14c9999e1ae7d898ab1f",
    "imports": [
      "import { scanGuestBookingAcceptances } from 'backend/guestBookingAcceptanceStore';",
      "import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';"
    ],
    "exports": [
      "export async function discoverGuestBookingAcceptances(cursor){"
    ]
  }
};
const acceptancePrivateReferences = /acceptGuestBookingOffer|acceptanceDigest|acceptanceTime|boundedJson|buildGuestBookingAcceptanceRoot|discoverGuestBookingAcceptances|exactFields|guestBookingAcceptance|guestBookingAcceptanceDiscovery|guestBookingAcceptanceStore|guestBookingIssuerAuthority|guestBookingOfferIssuer|insertGuestBookingAcceptance|issueGuestBookingOffer|readGuestBookingAcceptance|readGuestBookingCredentialAuthority|readGuestBookingIssuerAuthority|readOwnGuestBookingAcceptance|scanGuestBookingAcceptances|snapshotAcceptancePage|validateGuestBookingAcceptanceRoot|validateGuestBookingOfferCapsule/i;

function acceptanceReferenceText(text) {
  return text.replace(/\\(?:\r\n|[\n\r\u2028\u2029])/g, '')
    .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b, c) => {
      const n = parseInt(a || b || c, 16);
      return n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd';
    }).replace(/\\([^\r\n])/g, '$1');
}
// null delegates to the unchanged historical guards; false denies, true admits
// ONLY a pinned file. Do not resolve aliases before exact path comparison.
function acceptancePrivateEdge(file, source) {
  const pin = Object.hasOwn(acceptancePrivatePins, file) ? acceptancePrivatePins[file] : null;
  const text = source.replace(/\r\n/g, '\n');
  if (!pin) return acceptancePrivateReferences.test(acceptanceReferenceText(text)) ? false : null;
  if (JSON.stringify(text.match(/^import .*$/gm) || []) !== JSON.stringify(pin.imports)) return false;
  if (JSON.stringify(text.match(/^export .*$/gm) || []) !== JSON.stringify(pin.exports)) return false;
  return require('node:crypto').createHash('sha256').update(text, 'utf8').digest('hex') === pin.sha256;
}
function runAcceptanceIsolationMetatests(gate) {
  const names = [], witnesses = [], mutantHashes = new Set();
  const accepted = (file, text) => {
    try { return gate(file, text) !== false; }
    catch (error) { if (error.code !== 'ERR_ASSERTION') throw error; return false; }
  };
  const controls = Object.keys(acceptancePrivatePins).map(file =>
    [file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8')]);
  const probes = [];
  for (const [file, source] of controls) {
    const pin = acceptancePrivatePins[file], module = path.basename(file, '.js');
    probes.push(['exact ' + module, file, source, true],
      ['CRLF ' + module, file, source.replace(/\r?\n/g, '\r\n'), true]);
    for (const [name, text] of [
      ['body', source + '\nvoid 0;\n'], ['extra export', source + '\nexport const bridge = 1;'],
      ['extra import', source + "\nimport 'wix-data';"], ['dynamic import', source + "\nimport('wix-data');"],
      ['reexport', source + "\nexport * from 'wix-data';"], ['web bridge', source + '\nexport const bridge = webMethod();'],
      ['BOM', '\ufeff' + source], ['space', source + ' '], ['lone CR', source.replace(/\r?\n/g, '\r')]
    ]) probes.push([name + ' ' + module, file, text, false]);
    for (const declaration of pin.imports) {
      const spec = declaration.match(/'([^']+)'/)[1];
      for (const [name, text] of [
        ['missing', source.replace(declaration, '')], ['duplicate', source + '\n' + declaration],
        ['path alias', source.replace(declaration, declaration.replace(spec, './nested/../' + spec))],
        ['escaped path', source.replace(declaration, declaration.replace(spec, '\\u{00000062}' + spec.slice(1)))]
      ]) probes.push([name + ' ' + module + ' ' + spec, file, text, false]);
    }
    for (const other of ['velo/public/' + module + '.js', 'velo/backend/' + module + '.web.js',
      'velo/backend/' + module + '.jsw', 'velo/pages/' + module + '.js',
      'velo/backend/nested/../' + module + '.js', './' + file, file.toUpperCase()])
      probes.push(['copy ' + other, other, source, false]);
    for (const consumer of ['velo/backend/consumer.js', 'velo/public/consumer.js', 'velo/pages/consumer.js', 'velo/backend/consumer.web.js', 'velo/backend/consumer.jsw']) {
      for (const [form, wrap] of [
        ['static', spec => `import * as alias from '${spec}';`],
        ['dynamic', spec => `import('${spec}');`],
        ['require', spec => `require('${spec}');`],
        ['reexport', spec => `export * from '${spec}';`]
      ]) {
        for (const spec of ['backend/' + module, './nested/../' + module + '.js',
          'backend/\\u{00000067}' + module.slice(1), 'backend/\\u0067' + module.slice(1), 'backend/\\x67' + module.slice(1)])
          probes.push([consumer + ' ' + form + ' ' + spec, consumer, wrap(spec), false]);
        for (const [ending, terminator] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r'], ['LS', '\u2028'], ['PS', '\u2029']]) {
          probes.push([consumer + ' ' + form + ' ' + module + ' ' + ending, consumer,
            wrap('backend/' + module.slice(0, 6) + '\\' + terminator + module.slice(6)), false]);
        }
      }
    }
  }
  for (const spec of ['backend/unrelatedUtility', 'backend/\\u{00000075}nrelatedUtility'])
    probes.push(['benign ' + spec, 'velo/backend/inert.js', `import('${spec}');`, true]);
  for (const [ending, terminator] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r'], ['LS', '\u2028'], ['PS', '\u2029']])
    probes.push(['benign continuation ' + ending, 'velo/backend/inert.js', "import('backend/unrelated\\" + terminator + "Utility');", true]);
  for (const [name, file, text, expected] of probes) {
    for (const [controlFile, controlText] of controls)
      assert.equal(accepted(controlFile, controlText), true, 'acceptance positive before ' + name);
    assert.equal(accepted(file, text), expected, 'acceptance isolation ' + name);
    names.push(name);
  }
  assert.equal(new Set(names).size, names.length, 'unique acceptance fixtures');
  // One identical function replacement per guard, multiple causal witnesses.
  // The full real guard is exercised; mutated production text is never executed.
  const intact = acceptancePrivateEdge;
  const bypass = () => true;
  for (const [name, file, text] of probes.filter(p => !p[3] &&
    (p[0].startsWith('body ') || p[0].startsWith('extra export ') || p[0].startsWith('extra import ') || p[0].startsWith('copy ') || p[0].includes('consumer.web.js dynamic backend/guestBooking')))) {
    const witness = () => assert.equal(accepted(file, text), false, 'causal acceptance fence ' + name);
    witness();
    let failure;
    try {
      acceptancePrivateEdge = bypass;
      assert.equal(accepted(file, text), true, 'bypass reaches forbidden acceptance ' + name);
      try { witness(); } catch (error) { failure = error; }
    } finally { acceptancePrivateEdge = intact; }
    assert.equal(failure && failure.code, 'ERR_ASSERTION', 'causal acceptance assertion ' + name);
    assert.ok(failure.message.startsWith('causal acceptance fence ' + name), 'intended acceptance witness ' + name);
    witness(); witnesses.push(name);
    mutantHashes.add(require('node:crypto').createHash('sha256').update(bypass.toString()).digest('hex'));
  }
  assert.equal(new Set(witnesses).size, witnesses.length, 'unique acceptance witnesses');
  const report = {cases:names.length, names, mutantCount:mutantHashes.size, mutantHashes:[...mutantHashes], witnessCount:witnesses.length, witnesses};
  console.log(JSON.stringify({acceptanceIsolationMetatests:report}));
  return report;
}

function assertGuestIsolation(entries) {
 for (const [file, text] of entries) {
  const relative = file.split(path.sep).join('/').replace(path.resolve(__dirname, '..').split(path.sep).join('/') + '/', '');
  const acquisition = acquisitionPrivateEdge(relative, text);
  assert.notEqual(acquisition, false, 'pinned private acquisition only: ' + file);
  if (acquisition === true) continue;
  const allocation = allocationPrivateEdge(relative, text);
  assert.notEqual(allocation, false, 'pinned private allocation only: ' + file);
  if (allocation === true) continue;
  const acceptance = acceptancePrivateEdge(relative, text);
  assert.notEqual(acceptance, false, 'pinned private acceptance only: ' + file);
  if (acceptance === true) continue;
  if (path.resolve(file) === path.resolve(sourcePath)) continue;
  if (path.resolve(file) === credentialPath) {
   const imports = [
    "import crypto from 'crypto';",
    "import { Buffer } from 'buffer';",
    "import { checkVerifiedGuestClaims, classifyGuestIntentAdmission } from 'backend/guestBookingAccessPolicy';"
   ];
   let remainder = text;
   for (const statement of imports) {
    assert.equal(remainder.split(statement).length-1, 1, 'exact credential import: '+statement);
    remainder = remainder.replace(statement, '');
   }
   assert.equal(remainder.includes('guestBookingAccessPolicy'), false, 'extra credential policy dependency');
   // Fail-closed snapshot of this disconnected candidate, NOT implementation
   // approval. A filename/import regex alone cannot exclude arbitrary effects
   // (including computed ambient calls). Any byte change requires gate review.
   assert.equal(require('node:crypto').createHash('sha256').update(text).digest('hex'),
    'c34364e2196a67016b4def3850149478015fd41d35a42fe5a590d2c6d5750c9f', 'credential snapshot');
   continue;
  }
  assert.equal(text.includes('guestBookingAccessPolicy'), false, 'disconnected policy consumer: '+file);
  assert.equal(text.includes('guestBookingCredentials'), false, 'disconnected credential consumer: '+file);
 }
}
// In-memory fixtures exercise the same gate as the real production tree. Each
// negative changes one known-good control; failures must be named assertions.
runAcquisitionIsolationMetatests((file, text) => assertGuestIsolation([[path.resolve(__dirname, '..') + '/' + file, text]]));
runAllocationIsolationMetatests((file, text) => assertGuestIsolation([[path.resolve(__dirname, '..') + '/' + file, text]]));
runAcceptanceIsolationMetatests((file, text) => assertGuestIsolation([[path.resolve(__dirname, '..') + '/' + file, text]]));
const isolationControl = [[credentialPath, credentialSource]];
assert.doesNotThrow(() => assertGuestIsolation(isolationControl), 'approved disconnected credential dependency');count++;
const isolationCases = [
 ['unexpected dependency', credentialPath, "\nimport fs from 'fs';", 'credential snapshot'],
 ['unexpected effect', credentialPath, '\nglobalThis["fetch"]("https://invalid.test");', 'credential snapshot'],
 ['production credential consumer', path.join(productionRoot,'backend/isolation-fixture.web.js'), "import { createGuestBookingCredentials } from 'backend/guestBookingCredentials';", 'disconnected credential consumer'],
 ['production policy consumer', path.join(productionRoot,'pages/isolation-fixture.js'), "import { checkVerifiedGuestClaims } from 'backend/guestBookingAccessPolicy';", 'disconnected policy consumer'],
 ['same basename elsewhere', path.join(productionRoot,'pages/guestBookingCredentials.js'), credentialSource, 'disconnected policy consumer']
];
for (const [label, file, text, reason] of isolationCases) {
 const entries = file === credentialPath ? [[file, credentialSource+text]] : [...isolationControl, [file, text]];
 assert.throws(() => assertGuestIsolation(entries), error => error.code === 'ERR_ASSERTION' && error.message.includes(reason), label);count++;
}
for (const [before, after, reason] of [
 ['checkVerifiedGuestClaims, classifyGuestIntentAdmission', 'checkVerifiedGuestClaims, classifyAcceptedIntentRecovery', 'exact credential import'],
 ['checkVerifiedGuestClaims, classifyGuestIntentAdmission', 'checkVerifiedGuestClaims, classifyGuestIntentAdmission, classifyAcceptedIntentRecovery', 'exact credential import'],
 ['checkVerifiedGuestClaims, classifyGuestIntentAdmission', 'checkVerifiedGuestClaims as claims, classifyGuestIntentAdmission', 'exact credential import'],
 ["from 'backend/guestBookingAccessPolicy'", "from './guestBookingAccessPolicy.js'", 'exact credential import'],
 ["import crypto from 'crypto';", "import crypto from 'node:crypto';", 'exact credential import'],
 ["import { Buffer } from 'buffer';", "import { Buffer } from 'node:buffer';", 'exact credential import']
]) {
 assert.equal(credentialSource.split(before).length-1, 1, 'unique isolation mutation');count++;
 assert.throws(() => assertGuestIsolation([[credentialPath, credentialSource.replace(before, after)]]), error => error.code === 'ERR_ASSERTION' && error.message.includes(reason), 'changed approved import rejected');count++;
}
console.log(`guest isolation: approved control and ${isolationCases.length+6} named negative fixtures passed (in-memory only)`);
const productionEntries = productionFiles(productionRoot).filter(file => /\.(?:js|mjs|cjs|jsx|ts|tsx|jsw)$/.test(file)).map(file => [file, fs.readFileSync(file,'utf8')]);
assertGuestIsolation(productionEntries);count++;
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
