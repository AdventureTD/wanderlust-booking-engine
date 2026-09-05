const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.join(__dirname, '../velo/backend/guestBookingPriceGroups.js');
const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
function load(text) {
  return vm.runInThisContext(`(() => { ${text.replace(/export function /g, 'function ')}; return typeof canonicalizeGuestBookingPriceGroups === 'function' ? canonicalizeGuestBookingPriceGroups : undefined; })()`);
}
const candidate = load(source);
function canonicalize(value) {
  let result;
  assert.doesNotThrow(() => { result = candidate(value); }, 'inspection never escapes');
  return result;
}
let count = 0;
function eq(actual, expected, label) { count++; assert.equal(actual, expected, label); }
const group = (roomCode = 'adventure_suite', quantity = 1, guests = 2) => ({roomCode, quantity, guests});
const input = () => ({priceGroups: [group()]});
eq(typeof candidate, 'function', 'sole canonicalizer exists');
eq(canonicalize(input()), '[1,[["adventure_suite",1,2]]]', 'one suite exact ASCII tuple');
const ordered = [group('adventure_suite', 2), group('two_bedroom_apartment', 1, 4), group('penthouse_apartment')];
eq(canonicalize({priceGroups: ordered}), '[1,[["adventure_suite",2,2],["two_bedroom_apartment",1,4],["penthouse_apartment",1,2]]]', 'original ordered boundaries');
eq(canonicalize({priceGroups: [group(), group('adventure_suite', 2)]}), '[1,[["adventure_suite",1,2],["adventure_suite",2,2]]]', 'duplicate groups remain separate');
eq(canonicalize({priceGroups: ordered.slice().reverse()}), '[1,[["penthouse_apartment",1,2],["two_bedroom_apartment",1,4],["adventure_suite",2,2]]]', 'reordering changes bytes');
for (const [field, values] of [
  ['roomCode', ['', 'suite', 'ADVENTURE_SUITE', 'adventure_suite ', 'adventure_suite\n', 'аdventure_suite', null, {}, 1]],
  ['quantity', [0, -0, -1, 5, 1.5, NaN, Infinity, -Infinity, '1', 1n, null, undefined, new Number(1), Number.MAX_SAFE_INTEGER + 1]],
  ['guests', [0, -0, -1, 1, 3, 4, 2.5, NaN, Infinity, '2', 2n, null, undefined, new Number(2)]]
]) for (const value of values) {
  const a = input(); a.priceGroups[0][field] = value;
  eq(canonicalize(a), 'DENIED', `literal scalar ${field}`);
}
// Independent oracle enumerates every ordered length 1..4 vector over the
// four allowed class/occupancy pairs and quantities 1..4 (16-symbol alphabet).
const atoms = [];
for (const [code, guests] of [['adventure_suite', 2], ['penthouse_apartment', 2], ['two_bedroom_apartment', 3], ['two_bedroom_apartment', 4]]) {
  for (let quantity = 1; quantity <= 4; quantity++) atoms.push(group(code, quantity, guests));
}
let combinations = 0;
function oracle(groups) {
  const rooms = groups.flatMap(g => Array(g.quantity).fill(g.roomCode));
  const allowed = rooms.length <= 4 && ['adventure_suite', 'penthouse_apartment', 'two_bedroom_apartment'].every((code, i) => rooms.filter(r => r === code).length <= [3, 1, 1][i]);
  return allowed ? JSON.stringify([1, groups.map(g => [g.roomCode, g.quantity, g.guests])]) : 'DENIED';
}
function enumerate(groups) {
  if (groups.length) { combinations++; eq(canonicalize({priceGroups: groups}), oracle(groups), 'bounded oracle ' + combinations); }
  if (groups.length < 4) for (const atom of atoms) enumerate([...groups, atom]);
}
enumerate([]);
eq(combinations, 69904, 'exhaustive bounded ordered combinations');
for (const guests of [1, 2, 3, 4, 5]) {
  eq(canonicalize({priceGroups: [group('penthouse_apartment', 1, guests)]}), guests === 2 ? '[1,[["penthouse_apartment",1,2]]]' : 'DENIED', 'penthouse occupancy');
  eq(canonicalize({priceGroups: [group('two_bedroom_apartment', 1, guests)]}), [3, 4].includes(guests) ? `[1,[["two_bedroom_apartment",1,${guests}]]]` : 'DENIED', 'two bedroom occupancy');
}
for (const priceGroups of [[], Array(5).fill(group())]) eq(canonicalize({priceGroups}), 'DENIED', 'length cap');
let invoked = 0;
const success = '[1,[["adventure_suite",1,2]]]';
const locations = [a => a, a => a.priceGroups, a => a.priceGroups[0]];
function replaceAt(a, index, value) { if (index === 0) return value; if (index === 1) a.priceGroups = value; else a.priceGroups[0] = value; return a; }
for (let location = 0; location < 3; location++) {
  for (const key of Reflect.ownKeys(locations[location](input())).filter(k => k !== 'length')) {
    for (const mode of ['missing', 'accessor', 'nonenumerable']) {
      const a = input(), target = locations[location](a);
      if (mode === 'missing') delete target[key];
      if (mode === 'accessor') Object.defineProperty(target, key, {get() { invoked++; throw Error('getter'); }, enumerable: true});
      if (mode === 'nonenumerable') Object.defineProperty(target, key, {enumerable: false});
      eq(canonicalize(a), 'DENIED', `${mode} at ${location}.${key}`);
    }
  }
  for (const key of ['extra', 'then', 'toJSON', '__proto__', 'price', 'status', 'bookingNumber', 'quote', 'digest', 'consent', 'roomCount', 'totalGuests', 'physicalUnit', Symbol.iterator, Symbol('hidden')]) {
    const a = input(); Object.defineProperty(locations[location](a), key, {value() { invoked++; }});
    eq(canonicalize(a), 'DENIED', 'reject authority/executable/hidden extra ' + location);
  }
  for (const bad of [undefined, null, 42, true, 'x', 1n, Symbol(), () => {}, new Date(), new String('x'), Object.create(locations[location](input()))]) {
    eq(canonicalize(replaceAt(input(), location, bad)), 'DENIED', 'nonordinary node ' + location);
  }
  { const a = input(); Object.setPrototypeOf(locations[location](a), {}); eq(canonicalize(a), 'DENIED', 'custom prototype'); }
  if (location !== 1) { const a = input(); Object.setPrototypeOf(locations[location](a), null); eq(canonicalize(a), success, 'null prototype record'); }
  { const a = input(); Object.freeze(locations[location](a)); eq(canonicalize(a), success, 'frozen input'); }
  for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
    const a = input(); eq(canonicalize(replaceAt(a, location, new Proxy(locations[location](a), {[trap]() { throw Error('inspection'); }}))), 'DENIED', 'thrown inspection ' + trap);
  }
}
for (const bad of [new Array(2), Object.assign(Object.create(Array.prototype), {0: group(), length: 1}), Object.setPrototypeOf([group()], null)]) eq(canonicalize({priceGroups: bad}), 'DENIED', 'ordinary dense array only');
{ const a = input(); a.priceGroups[0] = {guests: 2, quantity: 1, roomCode: 'adventure_suite'}; eq(canonicalize(a), success, 'property insertion order immaterial'); }
{ const a = input(); a.priceGroups[0] = {roomCode: 'adventure_suite', qty: 1, numGuests: 2}; eq(canonicalize(a), 'DENIED', 'no legacy aliases'); }
{ const a = input(), before = Object.getOwnPropertyDescriptors(a.priceGroups[0]); const result = canonicalize(a); assert.deepEqual(Object.getOwnPropertyDescriptors(a.priceGroups[0]), before); count++; eq(Object.isFrozen(a.priceGroups[0]), false, 'no freeze caller'); a.priceGroups[0].quantity = 3; eq(result, success, 'detached primitive result'); }
eq(invoked, 0, 'no caller hooks');
// Observable descriptor/key/prototype drift must fail, including closing checks.
for (let location = 0; location < 3; location++) {
  for (const mode of ['prototype', 'keys', 'value', 'writable', 'configurable', 'enumerable', 'closing-first', 'closing-second']) {
    const a = input(), target = locations[location](a), keys = Reflect.ownKeys(target);
    let scans = 0, prototypes = 0;
    const proxy = new Proxy(target, {
      getPrototypeOf(t) { const p = Reflect.getPrototypeOf(t); return mode === 'prototype' && ++prototypes > 1 ? (p === null ? Object.prototype : null) : p; },
      ownKeys(t) { scans++; const result = Reflect.ownKeys(t); return mode === 'keys' && scans > 1 ? (result.length === 1 ? [...result, 'extra'] : result.reverse()) : result; },
      getOwnPropertyDescriptor(t, k) {
        const d = Reflect.getOwnPropertyDescriptor(t, k);
        if (k === keys[keys.length - 1] && ((mode === 'closing-first' && scans === 1) || (mode === 'closing-second' && scans === 2))) Object.setPrototypeOf(t, null);
        if (scans > 1 && k !== 'length') {
          if (mode === 'value') d.value = k === 'quantity' ? 2 : undefined;
          if (['writable', 'configurable', 'enumerable'].includes(mode)) d[mode] = !d[mode];
        }
        return d;
      }
    });
    eq(canonicalize(replaceAt(a, location, proxy)), 'DENIED', `observable ${mode} location ${location}`);
  }
}
{ const a = input(); a.priceGroups[0] = new Proxy(a.priceGroups[0], {ownKeys(t) { a.priceGroups = [group('penthouse_apartment')]; return Reflect.ownKeys(t); }}); eq(canonicalize(a), 'DENIED', 'nested inspection changes ancestor'); }
{ const a = {priceGroups: [group(), group()]}; a.priceGroups[1] = new Proxy(a.priceGroups[1], {ownKeys(t) { a.priceGroups[0].quantity = 2; return Reflect.ownKeys(t); }}); eq(canonicalize(a), 'DENIED', 'later group changes earlier snapshot'); }
// Each hostile realm is fresh. Load first, poison during the outer prototype
// inspection, restore before assertions. No post-import captured value is faked.
function realmProbe(text, mode) {
  return vm.runInNewContext(`(() => {
    ${text.replace(/export function /g, 'function ')}
    const define = Object.defineProperty, desc = Object.getOwnPropertyDescriptor;
    const nativeKeys = Reflect.ownKeys, proto = Object.getPrototypeOf;
    const saved = [];
    let hooks = 0;
    function change(obj, key, value) { saved.push([obj, key, desc(obj, key)]); define(obj, key, {value, configurable: true, writable: true}); }
    const mode = ${JSON.stringify(mode)};
    const g = {roomCode: 'adventure_suite', quantity: 1, guests: 2};
    let groups = [g];
    if (mode === 'array-brand') {
      groups = Object.assign(Object.create(Array.prototype), {0:g});
      define(groups, 'length', {value:1, writable:true, enumerable:false, configurable:false});
    }
    if (mode === 'hide-extra') g.extra = true;
    if (mode === 'forge-data') define(g, 'quantity', {get() { hooks++; return 1; }, enumerable:true, configurable:true});
    if (mode === 'fraction') g.quantity = 1.5;
    if (mode === 'custom-proto') Object.setPrototypeOf(g, {});
    if (mode === 'same-value') {
      let scans = 0;
      groups[0] = new Proxy(g, {ownKeys(t) { scans++; return nativeKeys(t); }, getOwnPropertyDescriptor(t,k) { const d = desc(t,k); if (scans > 1 && k === 'quantity') d.value = -0; return d; }});
    }
    let armed = true;
    const a = new Proxy({priceGroups:groups}, {getPrototypeOf(t) {
      if (armed) {
        armed = false;
        if (mode === 'hide-extra') change(Reflect, 'ownKeys', v => { hooks++; return nativeKeys(v).filter(k => k !== 'extra'); });
        if (mode === 'forge-data') change(Object, 'getOwnPropertyDescriptor', (v,k) => { hooks++; return v === g && k === 'quantity' ? {value:1,writable:true,enumerable:true,configurable:true} : desc(v,k); });
        if (mode === 'fraction') change(Number, 'isSafeInteger', () => { hooks++; return true; });
        if (mode === 'array-brand') change(Array, 'isArray', () => { hooks++; return true; });
        if (mode === 'custom-proto') change(Object, 'getPrototypeOf', v => { hooks++; return v === g ? Object.prototype : proto(v); });
        if (mode === 'same-value') change(Object, 'is', () => { hooks++; return true; });
        if (mode === 'all-globals') for (const key of ['Object','Array','Reflect','Number']) change(globalThis, key, {});
        if (mode === 'create') change(Object, 'create', () => { hooks++; throw Error('live create'); });
        if (mode === 'inherited-descriptors') for (const key of ['get','set','value','writable']) { saved.push([Object.prototype,key,desc(Object.prototype,key)]); define(Object.prototype,key,{__proto__:null,get() { hooks++; throw Error('inherited descriptor'); },configurable:true}); }
        if (mode === 'private-slots') for (const key of ['priceGroups','quantity','guests','roomCode','length','0']) { saved.push([Object.prototype,key,desc(Object.prototype,key)]); define(Object.prototype,key,{__proto__:null,set() { hooks++; throw Error('private assignment'); },configurable:true}); }
        if (mode === 'array-index') { saved.push([Array.prototype,'0',desc(Array.prototype,'0')]); define(Array.prototype,'0',{value:'blocked', writable:false,configurable:true}); }
        if (mode === 'own-call') for (const fn of [nativeKeys,desc,proto,Array.isArray,Object.is,Number.isSafeInteger,Object.create]) change(fn, 'call', () => { hooks++; throw Error('live call'); });
      }
      return proto(t);
    }});
    let result;
    try { result = canonicalizeGuestBookingPriceGroups(a); }
    finally { for (let i = saved.length - 1; i >= 0; i--) { const s = saved[i]; if (s[2]) define(s[0],s[1],s[2]); else delete s[0][s[1]]; } }
    return {result,hooks,attacked:!armed};
  })()`);
}
for (const mode of ['hide-extra', 'forge-data', 'fraction', 'array-brand', 'custom-proto', 'same-value', 'all-globals', 'create', 'inherited-descriptors', 'private-slots', 'array-index', 'own-call']) {
  const result = realmProbe(source, mode);
  eq(result.result, ['hide-extra', 'forge-data', 'fraction', 'array-brand', 'custom-proto', 'same-value'].includes(mode) ? 'DENIED' : success, 'captured intrinsic ' + mode);
  eq(result.hooks, 0, 'no poisoned hook ' + mode);
  eq(result.attacked, true, 'attack executed ' + mode);
}
// Bounded causal mutants: mutate source only in memory, never repository files.
// Every probe passes against the real candidate before killing its named mutant.
let mutants = 0;
function kill(name, before, after, probe) {
  eq(source.split(before).length, 2, 'unique mutant anchor ' + name);
  const mutated = source.replace(before, after);
  probe(source);
  let failure;
  try { probe(mutated); } catch (error) { failure = error; }
  eq(failure && failure.code, 'ERR_ASSERTION', 'causal assertion kill ' + name);
  eq(/attack ran|poisoned hook not used/.test(failure.message), false, 'semantic result killed ' + name);
  mutants++;
  console.log(`mutant killed: ${name} (${failure.message.split('\n')[0]})`);
}
function outputProbe(make, expected, label) {
  return text => assert.equal(load(text)(make()), expected, label);
}
kill('aggregate-cap', 'total > 4 || ', '', outputProbe(
  () => ({priceGroups: [group('adventure_suite', 3), group('penthouse_apartment'), group('two_bedroom_apartment', 1, 3)]}), 'DENIED', 'aggregate five denied'));
kill('duplicate-class-cap', 'suites += g.quantity;', 'suites = g.quantity;', outputProbe(
  () => ({priceGroups: [group('adventure_suite', 2), group('adventure_suite', 2)]}), 'DENIED', 'duplicate suite demand denied'));
kill('per-room-occupancy', "if (g.guests !== 2) return 'DENIED';\n        suites", "if (g.guests !== 2 && g.guests !== 4) return 'DENIED';\n        suites", outputProbe(
  () => ({priceGroups: [group('adventure_suite', 2, 4)]}), 'DENIED', 'group total is not occupancy'));
kill('reverse-original-order', 'snapshot(groups[i],', 'snapshot(groups[groups.length - 1 - i],', outputProbe(
  () => ({priceGroups: [group(), group('penthouse_apartment')]}), '[1,[["adventure_suite",1,2],["penthouse_apartment",1,2]]]', 'original order retained'));
kill('drop-duplicate-boundary', "text += (i ? ',' : '')", "if (i && g.roomCode === groups[i - 1].roomCode) continue;\n      text += (i ? ',' : '')", outputProbe(
  () => ({priceGroups: [group(), group()]}), '[1,[["adventure_suite",1,2],["adventure_suite",1,2]]]', 'duplicate boundary retained'));
kill('skip-stability', "if (!stable(journal[i])) return 'DENIED';", 'if (false) return \'DENIED\';', outputProbe(
  () => { const a = input(); a.priceGroups[0] = new Proxy(a.priceGroups[0], {ownKeys(t) { a.priceGroups = [group('penthouse_apartment')]; return Reflect.ownKeys(t); }}); return a; }, 'DENIED', 'ancestor drift denied'));
for (const [name, before, after, mode, expected] of [
  ['live-ownKeys', 'const ownKeys = Reflect.ownKeys;', 'const ownKeys = value => Reflect.ownKeys(value);', 'hide-extra', 'DENIED'],
  ['live-descriptor', 'const descriptor = Object.getOwnPropertyDescriptor;', 'const descriptor = (value, key) => Object.getOwnPropertyDescriptor(value, key);', 'forge-data', 'DENIED'],
  ['live-integer', 'const integer = Number.isSafeInteger;', 'const integer = value => Number.isSafeInteger(value);', 'fraction', 'DENIED'],
  ['live-array-brand', 'const isArray = Array.isArray;', 'const isArray = value => Array.isArray(value);', 'array-brand', 'DENIED'],
  ['live-prototype', 'const getPrototype = Object.getPrototypeOf;', 'const getPrototype = value => Object.getPrototypeOf(value);', 'custom-proto', 'DENIED'],
  ['live-same-value', 'const same = Object.is;', 'const same = (a, b) => Object.is(a, b);', 'same-value', 'DENIED'],
  ['live-create', 'const create = Object.create;', 'const create = value => Object.create(value);', 'create', success],
  ['inherited-private-slots', 'const values = create(null);', 'const values = {};', 'private-slots', success]
]) kill(name, before, after, text => {
  const result = realmProbe(text, mode);
  assert.equal(result.attacked, true, name + ' attack ran');
  // Result first: killing these cannot be credited merely to hook accounting.
  assert.equal(result.result, expected, name + ' semantic result');
  assert.equal(result.hooks, 0, name + ' poisoned hook not used');
});
// Static dependency barrier plus preservation of the approved baseline sources.
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
assert.deepEqual(code.match(/\bexport\b[^\n]*/g), ['export function canonicalizeGuestBookingPriceGroups(input) {']); count++;
eq(/\b(?:import|require|async|await|Promise|fetch|XMLHttpRequest|WebSocket|process|globalThis|Date|crypto|console|setTimeout|setInterval|eval|Function)\b|Math\s*\.\s*random/.test(code), false, 'no dependencies or effectful runtime facilities');
const crypto = require('node:crypto');
for (const [file, hash] of [
  ['velo/backend/guestBookingAccessPolicy.js', 'bbc14fb6951dbc7b677e9ca9202a2906d0da7bd5a2b322e56ca147e7e21dad35'],
  ['velo/backend/guestBookingCredentials.js', 'c34364e2196a67016b4def3850149478015fd41d35a42fe5a590d2c6d5750c9f'],
  ['velo/backend/search.web.js', '71b5a62c279b45a9db04feb8d6a91826490a72c9e43ec944352c71ae39c34aec'],
  ['velo/page-booking-search.js', '4b47dd273155650a2424d841d87b4adc64fffc4a5c9f7b0f4d2c34fdb061b318']
]) {
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
  eq(crypto.createHash('sha256').update(content).digest('hex'), hash, 'baseline preservation (LF normalized) ' + file);
}
const purchaseInputFile = 'velo/backend/guestBookingPurchaseInput.js';
const purchaseInputSource = fs.readFileSync(path.join(__dirname, '..', purchaseInputFile), 'utf8');
const approvedImport = "import { canonicalizeGuestBookingPriceGroups } from 'backend/guestBookingPriceGroups';";
function isolatedProductionFile(file, text) {
  if (file === calculationFile) {
    const canonicalLF = text.replace(/\r\n/g, '\n');
    const body = canonicalLF.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    if (body.split(approvedImport).length !== 2) return false;
    const remainder = body.replace(approvedImport, '');
    if (JSON.stringify(body.match(/\bexport\b[^\n]*/g)) !== JSON.stringify(['export function calculateGuestBookingFinancials(factors) {'])) return false;
    if (/\b(?:import|require|from|async|await|Promise|fetch|XMLHttpRequest|WebSocket|process|globalThis|Date|crypto|console|setTimeout|setInterval|eval|Function)\b|Math\s*\.\s*random/.test(remainder)) return false;
    // UTF-8 SHA-256, CRLF -> LF ONLY; candidate pending independent review.
    return crypto.createHash('sha256').update(canonicalLF, 'utf8').digest('hex') === '3dc9fae1c48a48e78b34608c57970e73fae546c65e7c3a31449359f01a67fe71';
  }
  if (file !== purchaseInputFile) {
    // Lexical disconnection barrier, not a general JS resolver. Decode literal
    // Unicode/hex aliases without evaluating sources; retain raw-name checks.
    const decoded = text.replace(/\\(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2}))/g,
      (escape, point, unicode, hex) => {
        const value = parseInt(point || unicode || hex, 16);
        return value <= 0x10ffff ? String.fromCodePoint(value) : escape;
      });
    return !/guestBooking(?:PriceGroups|PurchaseInput|FinancialCalculation)/.test(text) &&
      !/guestBooking(?:PriceGroups|PurchaseInput|FinancialCalculation)/.test(decoded);
  }
  // Reviewed source pin is SHA-256 over UTF-8 with CRLF -> LF ONLY.
  // No trim, BOM removal, lone-CR conversion or other normalization. A changed
  // body needs a fresh review; lexical checks alone cannot prove effect freedom.
  const canonicalLF = text.replace(/\r\n/g, '\n');
  const body = canonicalLF.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (body.split(approvedImport).length !== 2) return false;
  const remainder = body.replace(approvedImport, '');
  // These exact captured-intrinsic expressions do not construct/evaluate code.
  const facilities = remainder.replace(/Function\.prototype\.call\.bind\((?:String\.prototype\.(?:charCodeAt|slice)|RegExp\.prototype\.exec)\)/g, '');
  if (/\b(?:import|require|from|async|await|Promise|fetch|XMLHttpRequest|WebSocket|process|globalThis|Date|crypto|console|setTimeout|setInterval|eval|Function)\b|Math\s*\.\s*random/.test(facilities)) return false;
  return crypto.createHash('sha256').update(canonicalLF, 'utf8').digest('hex') === 'a3b3583d0971c06f36301aa948479315def667e0e73d4accb8c854daab17489a';
}
// Calculator candidate pin is an isolation exception, not review/publication approval.
const calculationFile = 'velo/backend/guestBookingFinancialCalculation.js';
const calculationSource = fs.readFileSync(path.join(__dirname, '..', calculationFile), 'utf8');
// Causal in-memory isolation probes: never write or execute the mutated sources.
eq(isolatedProductionFile(calculationFile, calculationSource), true, 'exact pinned calculator dependency admitted');
eq(isolatedProductionFile(calculationFile, calculationSource.replace(/\r?\n/g, '\r\n')), true, 'calculator CRLF equivalent admitted');
eq(isolatedProductionFile(purchaseInputFile, purchaseInputSource), true, 'approved pure purchase-input dependency admitted');
eq(isolatedProductionFile(purchaseInputFile, purchaseInputSource.replace(/\r?\n/g, '\r\n')), true, 'reviewed source CRLF equivalent admitted');
eq(isolatedProductionFile('velo/backend/unrelated.js', 'export const inert = 1;'), true, 'unrelated inert file admitted');
const isolationMutations = [
  ['renamed candidate', 'velo/backend/renamed.js', purchaseInputSource],
  ['same basename outside backend', 'velo/guestBookingPurchaseInput.js', purchaseInputSource],
  ['extra named import', purchaseInputFile, purchaseInputSource.replace('{ canonicalizeGuestBookingPriceGroups }', '{ canonicalizeGuestBookingPriceGroups, other }')],
  ['different dependency', purchaseInputFile, purchaseInputSource.replace("from 'backend/guestBookingPriceGroups'", "from 'backend/other'")],
  ['missing import', purchaseInputFile, purchaseInputSource.replace(approvedImport, '')],
  ['duplicate import', purchaseInputFile, purchaseInputSource + '\n' + approvedImport],
  ['side effect import', purchaseInputFile, purchaseInputSource + "\nimport 'wix-data';"],
  ['reexport', purchaseInputFile, purchaseInputSource + "\nexport * from 'backend/other';"],
  ['dynamic import', purchaseInputFile, purchaseInputSource + "\nimport('wix-data');"],
  ['require dependency', purchaseInputFile, purchaseInputSource + "\nrequire('wix-data');"],
  ['network effect', purchaseInputFile, purchaseInputSource + "\nfetch('https://invalid.example');"],
  ['logging effect', purchaseInputFile, purchaseInputSource + "\nconsole.log('synthetic');"],
  ['time effect', purchaseInputFile, purchaseInputSource + '\nDate.now();'],
  ['random effect', purchaseInputFile, purchaseInputSource + '\nMath.random();'],
  ['obfuscated effect', purchaseInputFile, purchaseInputSource + "\nglobalThis['fe'+'tch']('https://invalid.example');"],
  ['unreviewed body', purchaseInputFile, purchaseInputSource.replace('out.length > 262144', 'out.length > 1')],
  ['production consumer', 'velo/backend/consumer.js', "import { canonicalizeGuestBookingPurchaseInput } from 'backend/guestBookingPurchaseInput';"],
  ['dynamic production consumer', 'velo/page-synthetic.js', "import('backend/guestBookingPurchaseInput');"],
  ['production group consumer', 'velo/backend/consumer.js', approvedImport]
];
for (const [name, file, text] of isolationMutations) {
  eq(isolatedProductionFile(purchaseInputFile, purchaseInputSource), true, 'positive control before ' + name);
  eq(isolatedProductionFile(file, text), false, 'isolation rejects ' + name);
}
// Every calculator rejection has an immediately preceding real-source control.
const calculationMutations = [
  ['other backend path', 'velo/backend/otherCalculator.js', calculationSource],
  ['same basename outside backend', 'velo/guestBookingFinancialCalculation.js', calculationSource],
  ['page copy', 'velo/page-synthetic.js', calculationSource],
  ['web copy', 'velo/backend/guestBookingFinancialCalculation.web.js', calculationSource],
  ['missing import', calculationFile, calculationSource.replace(approvedImport, '')],
  ['duplicate import', calculationFile, calculationSource + '\n' + approvedImport],
  ['extra named import', calculationFile, calculationSource.replace('{ canonicalizeGuestBookingPriceGroups }', '{ canonicalizeGuestBookingPriceGroups, other }')],
  ['aliased import', calculationFile, calculationSource.replace('{ canonicalizeGuestBookingPriceGroups }', '{ canonicalizeGuestBookingPriceGroups as alias }')],
  ['escaped dependency', calculationFile, calculationSource.replace('backend/guestBookingPriceGroups', 'backend/guestBooking\\u0050riceGroups')],
  ['other dependency', calculationFile, calculationSource.replace('backend/guestBookingPriceGroups', 'backend/other')],
  ['side effect import', calculationFile, calculationSource + "\nimport 'wix-data';"],
  ['reexport', calculationFile, calculationSource + "\nexport * from 'backend/other';"],
  ['dynamic import', calculationFile, calculationSource + "\nimport('wix-data');"],
  ['require', calculationFile, calculationSource + "\nrequire('wix-data');"],
  ['extra export', calculationFile, calculationSource + '\nexport const other = 1;'],
  ['renamed export', calculationFile, calculationSource.replace('export function calculateGuestBookingFinancials', 'export function other')],
  ['changed body', calculationFile, calculationSource.replace('const epsilon = Number.EPSILON;', 'const epsilon = 0;')],
  ['extra whitespace', calculationFile, calculationSource + ' '],
  ['BOM', calculationFile, '\ufeff' + calculationSource],
  ['lone CR', calculationFile, calculationSource.replace(/\r?\n/g, '\r')],
  ['comment addition', calculationFile, calculationSource + '\n// unreviewed'],
  ['escaped alias effect', calculationFile, calculationSource + "\nconst f = globalThis['fe'+'tch']; f('https://invalid.example');"]
];
const calculationImport = "import { calculateGuestBookingFinancials } from 'backend/guestBookingFinancialCalculation';";
for (const file of ['velo/backend/consumer.js', 'velo/page-synthetic.js', 'velo/backend/consumer.web.js', 'velo/backend/guestBookingFinancialAuthority.js']) {
  for (const [name, text] of [
    ['static incoming', calculationImport],
    ['aliased incoming', calculationImport.replace('calculateGuestBookingFinancials }', 'calculateGuestBookingFinancials as alias }')],
    ['reexport incoming', "export { calculateGuestBookingFinancials } from 'backend/guestBookingFinancialCalculation';"],
    ['star reexport incoming', "export * from 'backend/guestBookingFinancialCalculation';"],
    ['dynamic incoming', "import('backend/guestBookingFinancialCalculation');"],
    ['require incoming', "require('backend/guestBookingFinancialCalculation');"],
    ['escaped unicode incoming', "import('backend/guestBooking\\u0046inancialCalculation');"],
    ['escaped hex incoming', "require('backend/guestBooking\\x46inancialCalculation');"],
    ['escaped codepoint incoming', "export * from 'backend/guestBooking\\u{46}inancialCalculation';"]
  ]) calculationMutations.push([name + ' ' + file, file, text]);
}
for (const [name, file, text] of calculationMutations) {
  eq(isolatedProductionFile(calculationFile, calculationSource), true, 'calculator positive control before ' + name);
  eq(isolatedProductionFile(file, text), false, 'calculator isolation rejects ' + name);
}
function scanProduction(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) scanProduction(file);
    else if (/\.js$/.test(entry.name) && file !== sourcePath) {
      const relative = path.relative(path.join(__dirname, '..'), file).split(path.sep).join('/');
      eq(isolatedProductionFile(relative, fs.readFileSync(file, 'utf8')), true, 'reviewed dependency only; no production consumers ' + relative);
    }
  }
}
scanProduction(path.join(__dirname, '../velo'));
eq(candidate.length, 1, 'one DTO argument, no injected ports');
eq(canonicalize(input()), success, 'fabricated structural input passes without authority');
eq(mutants, 14, 'bounded named mutant count');
console.log(`guest price groups: ${count} counted assertions passed; ${combinations} exhaustive vectors; ${mutants} causal named mutants killed (additional probe assertions uncounted)`);
