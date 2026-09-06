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
// Approved two-file review v2: disconnected observation only. The final
// three-file review remains separate; this pin grants no runtime authority.
const readerFile = 'velo/backend/guestConsentRequirementsReader.js';
const readerCanonicalLFSha256 = 'cfd3dddc3ee10c94bd4bcf0a76ec3badcee829fea9e286dec7917cbe8e36d4b4';
const readerImports = [
  "import wixData from 'wix-data';",
  "import { resolveGuestConsentRequirement } from 'backend/guestConsentLocationPolicy';"
];
const readerExport = 'export async function readGuestConsentRequirementsObservation() {';
const readerSource = fs.readFileSync(path.join(__dirname, '..', readerFile), 'utf8');
// Conservative reference screening, not a general JavaScript parser. Comments
// and inert mentions are deliberately not exemptions for production files.
function consentReferenceText(text) {
  return text.replace(/\\(?:\r\n|[\n\r\u2028\u2029])/g, '')
    .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b, c) => {
    const n = parseInt(a || b || c, 16);
    return n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd';
  }).replace(/\\([^\r\n])/g, '$1');
}
function assertConsentEdge(other, source) {
  const text = source.replace(/\r\n/g, '\n');
  if (other === readerFile) {
    assert.deepEqual(text.match(/^import .+;$/gm), readerImports, 'exact reader imports');
    assert.deepEqual(text.match(/^export .*$/gm), [readerExport], 'exact reader export');
    assert.equal(require('node:crypto').createHash('sha256').update(text, 'utf8').digest('hex'), readerCanonicalLFSha256, 'approved canonical LF reader body');
    return;
  }
  assert.doesNotMatch(consentReferenceText(text), /guestConsentLocationPolicy|resolveGuestConsentRequirement|guestConsentRequirementsReader|readGuestConsentRequirementsObservation/i, 'no production incoming consent references: '+other);
}
// Fixtures are inert strings only; never create or execute production consumers.
const isolationCases = [];
function isolationProbe(name, other, text, allowed, gate = assertConsentEdge) {
  gate(readerFile, readerSource);
  if (allowed) gate(other, text);
  else assert.throws(() => gate(other, text), error => error.code === 'ERR_ASSERTION', 'isolation denial '+name);
  isolationCases.push(name);
}
isolationProbe('incoming reader', 'velo/backend/consumer.js', "import { readGuestConsentRequirementsObservation } from 'backend/guestConsentRequirementsReader';", false);
const consumerPaths = ['velo/backend/consumer.js', 'velo/page-synthetic.js', 'velo/public/consumer.js',
  'velo/backend/consumer.web.js', 'velo/backend/consumer.jsw', 'velo/public/guestConsentRequirementsReader.js',
  'velo/backend/nested/../guestConsentRequirementsReader.js', 'velo/backend/GuestConsentRequirementsReader.js'];
const forms = [
  ['static', spec => `import { x } from '${spec}';`],
  ['binding alias', spec => `import { x as alias } from '${spec}';`],
  ['namespace', spec => `import * as alias from '${spec}';`],
  ['side effect', spec => `import '${spec}';`],
  ['relative alias', spec => `import './nested/../${spec}.js';`],
  ['dynamic', spec => `import('${spec}');`],
  ['require', spec => `require('${spec}');`],
  ['reexport', spec => `export * from '${spec}';`],
  ['named reexport', spec => `export { x } from '${spec}';`]
];
isolationProbe('exact reader', readerFile, readerSource, true);
isolationProbe('CRLF reader', readerFile, readerSource.replace(/\r?\n/g, '\r\n'), true);
isolationProbe('inert unrelated', consumerPaths[0], 'export const inert = 1;', true);
for (const other of consumerPaths) {
  isolationProbe('wrong reader path '+other, other, readerSource, false);
  for (const module of ['guestConsentLocationPolicy', 'guestConsentRequirementsReader']) {
    for (const [name, wrap] of forms) {
      isolationProbe(module+' '+name+' '+other, other, wrap('backend/'+module), false);
      isolationProbe('benign '+module+' '+name+' '+other, other, wrap('backend/unrelatedUtility'), true);
    }
  }
}
const readerChanges = [
  ['body', readerSource.replace('arguments.length !== 0', 'arguments.length !== 1')],
  ['extra import', readerSource+"\nimport 'wix-data';"],
  ['dynamic', readerSource+"\nimport('wix-data');"],
  ['require', readerSource+"\nrequire('wix-data');"],
  ['reexport', readerSource+"\nexport * from 'wix-data';"],
  ['extra export', readerSource+'\nexport const endpoint = 1;'],
  ['renamed export', readerSource.replace(readerExport, readerExport.replace('readGuestConsentRequirementsObservation','other'))],
  ['binding alias', readerSource.replace('{ resolveGuestConsentRequirement }','{ resolveGuestConsentRequirement as alias }')],
  ['whitespace', readerSource+' '], ['BOM', '\ufeff'+readerSource],
  ['lone CR', readerSource.replace(/\r?\n/g, '\r')]
];
for (const declaration of readerImports) {
  const spec = declaration.match(/'([^']+)'/)[1];
  readerChanges.push(['missing '+spec, readerSource.replace(declaration, '')],
    ['alias '+spec, readerSource.replace(spec, './nested/../'+spec)],
    ['escaped '+spec, readerSource.replace(spec, '\\u'+spec.charCodeAt(0).toString(16).padStart(4,'0')+spec.slice(1))]);
}
for (const [name, text] of readerChanges) {
  assert.notEqual(text, readerSource, 'mutation reached '+name);
  isolationProbe('reader rejects '+name, readerFile, text, false);
}
for (const module of ['guestConsentLocationPolicy', 'guestConsentRequirementsReader', 'resolveGuestConsentRequirement', 'readGuestConsentRequirementsObservation']) {
  const hex = module.charCodeAt(0).toString(16);
  for (const escape of ['\\u'+hex.padStart(4,'0'),'\\x'+hex,'\\u{'+hex+'}']) {
    const escaped = escape+module.slice(1);
    isolationProbe('escaped '+module+' '+escape, consumerPaths[0], `import('backend/${escaped}');`, false);
  }
}
// Native parser evidence only: no fixture is linked, evaluated or imported.
const unicodeCases = [];
for (const digits of [7, 9, 64]) {
  for (const module of ['guestConsentLocationPolicy', 'guestConsentRequirementsReader']) {
    for (const [form, wrap] of forms) {
      const spec = 'backend/\\u{'+('67'.padStart(digits, '0'))+'}'+module.slice(1);
      const benignSpec = 'backend/\\u{'+('75'.padStart(digits, '0'))+'}nrelatedUtility';
      const dependency = spec => form === 'dynamic' || form === 'require' ? [] :
        [form === 'relative alias' ? './nested/../'+spec+'.js' : spec];
      unicodeCases.push({name:digits+' digits '+module+' '+form, text:wrap(spec), benign:wrap(benignSpec),
        dependencies:dependency('backend/'+module), benignDependencies:dependency('backend/unrelatedUtility')});
    }
  }
}
// Preserve value bounds, including overflow; digit count is not a value bound.
const unicodeBounds = [
  ['000000000', '\u0000', true], ['00000d800', '\ud800', true],
  ['00010ffff', '\u{10ffff}', true], ['000110000', '\ufffd', false],
  ['1000067', '\ufffd', false], ['f'.repeat(400), '\ufffd', false]
].map(([digits, decoded, valid]) => ({text:"import 'backend/\\u{"+digits+"}utility';",
  dependencies:['backend/'+decoded+'utility'], valid, digits, decoded}));
for (const c of unicodeBounds) {
  assert.equal(consentReferenceText('\\u{'+c.digits+'}'), c.decoded, 'Unicode value bound '+c.digits);
}
const unicodeParser = require('node:child_process').spawnSync(process.execPath,
  ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning', '-e', `
    const assert = require('node:assert/strict'), vm = require('node:vm');
    const fixtures = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    for (const c of fixtures.cases) {
      assert.deepEqual(new vm.SourceTextModule(c.text).dependencySpecifiers, c.dependencies, c.name);
      assert.deepEqual(new vm.SourceTextModule(c.benign).dependencySpecifiers, c.benignDependencies, 'benign '+c.name);
    }
    for (const c of fixtures.bounds) {
      if (c.valid) assert.deepEqual(new vm.SourceTextModule(c.text).dependencySpecifiers, c.dependencies, c.digits);
      else assert.throws(() => new vm.SourceTextModule(c.text), SyntaxError, c.digits);
    }
  `], {input:JSON.stringify({cases:unicodeCases, bounds:unicodeBounds}), encoding:'utf8', timeout:10000});
assert.ifError(unicodeParser.error);
assert.equal(unicodeParser.status, 0, 'parser-only Unicode fixtures: '+unicodeParser.stderr);
for (const c of unicodeCases) {
  isolationProbe('benign leading-zero Unicode '+c.name, consumerPaths[0], c.benign, true);
  isolationProbe('required denial leading-zero Unicode '+c.name, consumerPaths[0], c.text, false);
}
const continuationCases = [];
const continuationFailures = [];
for (const [ending, terminator] of [['LF','\n'],['CRLF','\r\n'],['CR','\r'],['LS','\u2028'],['PS','\u2029']]) {
  for (const module of ['guestConsentLocationPolicy','guestConsentRequirementsReader']) {
    for (const [form, wrap] of forms) {
      const name = ending+' '+module+' '+form;
      const text = wrap('backend/'+module.slice(0,6)+'\\'+terminator+module.slice(6));
      const benign = wrap('backend/unrelated'+'\\'+terminator+'Utility');
      isolationProbe('benign continuation '+name, consumerPaths[0], benign, true);
      let denied = false;
      try { assertConsentEdge(consumerPaths[0], text); }
      catch (error) { if (error.code !== 'ERR_ASSERTION') throw error; denied = true; }
      if (!denied) continuationFailures.push(name);
      isolationCases.push('denied continuation '+name);
      continuationCases.push({name, ending, text, benign});
    }
  }
}
assert.deepEqual(continuationFailures, [], 'all legal JS literal continuations must be denied');
assert.equal(new Set(isolationCases).size, isolationCases.length, 'distinct isolation fixture names');
// Compile only our verifier gate, never the synthetic consumer source. Each
// one-point gate reversion needs original GREEN / mutant named ERR_ASSERTION /
// restored GREEN. Syntax faults, other exceptions and timeouts cannot count.
function gateFromText(gateText, decoderText = consentReferenceText.toString()) {
  return vm.runInThisContext(`(function(assert, require, readerFile, readerImports, readerExport, readerCanonicalLFSha256) {
    const consentReferenceText = (${decoderText}); return (${gateText});
  })`)(assert, require, readerFile, readerImports, readerExport, readerCanonicalLFSha256);
}
function admitted(gate, other, text) {
  try { gate(other, text); return true; }
  catch (error) { if (error.code !== 'ERR_ASSERTION') throw error; return false; }
}
const gateText = assertConsentEdge.toString();
const decoderText = consentReferenceText.toString();
const gateReversions = [];
function causalGateReversion(name, from, to, witnesses, decoder = false) {
  const original = decoder ? decoderText : gateText;
  assert.equal(original.split(from).length, 2, 'unique gate anchor '+name);
  const changed = original.replace(from, to);
  const intact = gateFromText(gateText);
  const mutant = gateFromText(decoder ? gateText : changed, decoder ? changed : decoderText);
  const evidence = [];
  for (const [label, other, text, expected] of witnesses) {
    const witnessName = 'causal consent gate '+name+' '+label;
    const witness = gate => assert.equal(admitted(gate, other, text), expected, witnessName);
    witness(assertConsentEdge);
    witness(intact);
    assert.equal(admitted(mutant, other, text), !expected, 'mutant changes admission '+witnessName);
    assert.equal(admitted(mutant, consumerPaths[0], "import('backend/unrelatedUtility');"), true, 'mutant benign control '+witnessName);
    if (decoder) {
      mutant(readerFile, readerSource);
      for (const c of continuationCases.filter(c => c.ending === 'LF' || c.ending === 'CRLF')) {
        assert.equal(admitted(mutant, consumerPaths[0], c.text), false, 'legacy decoder retains '+c.name);
        mutant(consumerPaths[0], c.benign);
      }
    }
    let failure;
    try { witness(mutant); } catch (error) { failure = error; }
    assert.equal(failure?.code, 'ERR_ASSERTION', 'causal assertion only '+witnessName);
    assert.ok(failure.message.startsWith(witnessName), 'exact causal witness '+witnessName);
    witness(assertConsentEdge);
    evidence.push({label, code:failure.code});
  }
  gateReversions.push({name, from, to, mutantSHA256:require('node:crypto').createHash('sha256').update(changed).digest('hex'), witnesses:evidence});
}
causalGateReversion('revert precise allowance', 'if (other === readerFile)', 'if (false)', [
  ['approved reader', readerFile, readerSource, true]
]);
causalGateReversion('loosen exact path', 'other === readerFile', "other.endsWith('/guestConsentRequirementsReader.js')", [
  ['public copy', 'velo/public/guestConsentRequirementsReader.js', readerSource, false],
  ['normalized alias', 'velo/backend/nested/../guestConsentRequirementsReader.js', readerSource, false]
]);
const hashGuard = "assert.equal(require('node:crypto').createHash('sha256').update(text, 'utf8').digest('hex'), readerCanonicalLFSha256, 'approved canonical LF reader body');";
causalGateReversion('delete reviewed body pin', hashGuard, '', [
  ['body drift', readerFile, readerChanges[0][1], false],
  ['extra dynamic edge', readerFile, readerChanges.find(c => c[0] === 'dynamic')[1], false]
]);
causalGateReversion('delete incoming reference fence', 'assert.doesNotMatch(consentReferenceText(text),', 'return; assert.doesNotMatch(consentReferenceText(text),', [
  ['policy caller', consumerPaths[0], "import('backend/guestConsentLocationPolicy');", false],
  ['reader caller', consumerPaths[0], "import('backend/guestConsentRequirementsReader');", false]
]);
causalGateReversion('revert LF CRLF only decoder', String.raw`/\\(?:\r\n|[\n\r\u2028\u2029])/g`, String.raw`/\\\r?\n/g`,
  continuationCases.filter(c => c.ending !== 'LF' && c.ending !== 'CRLF').map(c => [c.name, consumerPaths[0], c.text, false]), true);
causalGateReversion('revert six-digit Unicode cap', '[0-9a-f]+', '[0-9a-f]{1,6}',
  unicodeCases.map(c => [c.name, consumerPaths[0], c.text, false]), true);
const oldUnicodeGate = gateFromText(gateText, decoderText.replace('[0-9a-f]+', '[0-9a-f]{1,6}'));
for (const c of unicodeCases) oldUnicodeGate(consumerPaths[0], c.benign);
for (const c of continuationCases) {
  assert.equal(admitted(oldUnicodeGate, consumerPaths[0], c.text), false, 'Unicode reversion retains '+c.name);
  oldUnicodeGate(consumerPaths[0], c.benign);
}
assert.equal(new Set(gateReversions.map(m => m.mutantSHA256)).size, gateReversions.length, 'unique gate mutants');
console.log('consent isolation: PASS '+JSON.stringify({cases:isolationCases.length, continuationCases:continuationCases.length,
  unicodeCases:unicodeCases.length, unicodeBounds:unicodeBounds.length,
  unicodeParserFixtures:unicodeCases.length*2+unicodeBounds.length,
  gateMutantsKilled:gateReversions.length, causalWitnesses:gateReversions.reduce((n,m)=>n+m.witnesses.length,0),
  readerCanonicalLFSha256, gateReversions}));
assertConsentEdge(readerFile, readerSource);
for(const other of walk(path.join(__dirname,'../velo')).filter(p=>/\.(?:js|jsw)$/.test(p)&&p!==file)) {
  assertConsentEdge(path.relative(path.join(__dirname, '..'), other).split(path.sep).join('/'), fs.readFileSync(other,'utf8'));
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
