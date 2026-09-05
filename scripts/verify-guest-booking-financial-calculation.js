'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const candidatePath = path.join(root, 'velo/backend/guestBookingFinancialCalculation.js');
assert.ok(fs.existsSync(candidatePath), 'calculator implementation is missing');
const source = fs.readFileSync(candidatePath, 'utf8');
const dependency = fs.readFileSync(path.join(root, 'velo/backend/guestBookingPriceGroups.js'), 'utf8');
// Extract only actual numerical statements. No Wix module or booking side effect runs.
const backend = fs.readFileSync(path.join(root, 'velo/backend/availability.web.js'), 'utf8');
const resolver = fs.readFileSync(path.join(root, 'velo/backend/rateResolver.js'), 'utf8');
function extract(text, pattern, label) {
  const match = text.match(pattern); assert.ok(match, 'source extraction: ' + label); return match[0];
}
const roundingSource = extract(resolver, /export function roundMoney\(value\) \{[^}]+\}/, 'roundMoney').replace('export ', '');
const grossSource = extract(backend, /const grossRoomTotal = roundMoney\([\s\S]*?\);/, 'gross');
const blockSource = extract(backend, /const computedRoomTotal = roundMoney\([\s\S]*?const computedGrandTotal = roundMoney\([^;]+;/, 'financial block')
  .replace('const settings = await getAllSettings();', 'const settings = fixtureSettings;');
assert.ok(!blockSource.includes('await'), 'only Settings await may be replaced');
const discountSource = extract(backend, /promoDiscountAmount: roundMoney\([^\n]+\)/, 'discount').replace('promoDiscountAmount: ', '');
const legacySource = `${roundingSource}\nfunction legacy(f,g) {
 const stayPricing={totalPerPerson:f.totalPerPerson}, guests=g.guests, quantity=g.quantity;
 const roomFee=g.roomCode==='penthouse_apartment'?f.penthouseRoomFee:0, nights=f.nights, promoDiscountRate=f.promoDiscountRate;
 const fixtureSettings={propertyFeeRate:f.propertyFeeRate,taxRate_accommodation:f.taxRateAccommodation,taxRate_standard:f.taxRateStandard};
 ${grossSource}\n${blockSource}
 return [grossRoomTotal,${discountSource},computedRoomTotal,computedPropertyFee,computedAccVat,computedPkgVat,computedGrandTotal].map(x=>Math.round(x*100));
}`;
const setup = `
const suite = (quantity = 1) => ({roomCode:'adventure_suite', quantity, guests:2});
const factors = (overrides = {}) => ({v:1,nights:2,totalPerPerson:100,penthouseRoomFee:null,propertyFeeRate:.05,taxRateAccommodation:.1,taxRateStandard:.15,promoDiscountRate:0,priceGroups:[suite()],...overrides});
const calc = calculateGuestBookingFinancials;
const components = ['grossCents','discountCents','roomTotalCents','propertyFeeCents','accommodationVatCents','packageVatCents','grandTotalCents'];
const amounts = x => components.map(k => x[k]);
`;
function run(body, candidate = source) {
  let assertionCount = 0;
  const countedAssert = {};
  for (const key of ['ok','equal','notEqual','deepEqual','notDeepEqual','throws','doesNotThrow']) {
    countedAssert[key] = (...args) => { assertionCount++; return assert[key](...args); };
  }
  const context = vm.createContext({assert:countedAssert});
  const instrumentedDependency = dependency.replace('export function', 'function').replace('function canonicalizeGuestBookingPriceGroups(input) {', 'function canonicalizeGuestBookingPriceGroups(input) { globalThis.__dependencyCalls=(globalThis.__dependencyCalls||0)+1; globalThis.__dependencyInput=input;');
  try {
    vm.runInContext(`const canonicalizeGuestBookingPriceGroups = (() => {${instrumentedDependency} return canonicalizeGuestBookingPriceGroups;})();\n${candidate.replace(/^import .*;\r?\n/m, '').replace('export function', 'function')}\n${setup}\n${legacySource}\n${body}`, context, {timeout:2000});
  } catch (error) { error.mutantReached = context.__mutantReached === true; throw error; }
  return {assertions:assertionCount, rationalVectors:context.__rationalVectors || 0, parityVectors:context.__parityVectors || 0};
}
const tests = [];
function test(name, body) { tests.push({name, body}); }
test('whole-stay original backend component table', `
assert.deepEqual(amounts(calc(factors()).totals), [20000,0,20000,1000,1000,1500,23500]);
assert.equal(calc.length, 1);
`);
test('public group policy uses actual committed canonicalizer', `
assert.equal(calc(factors({priceGroups:[suite(4)]})), 'DENIED');
assert.equal(calc(factors({priceGroups:[suite(3),{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'two_bedroom_apartment',quantity:1,guests:3}],penthouseRoomFee:0})), 'DENIED');
for (const roomCode of ['adventure_suite','penthouse_apartment','two_bedroom_apartment','unknown']) {
 for (const guests of [0,1,2,3,4,5]) {
  const valid = roomCode === 'two_bedroom_apartment' ? guests === 3 || guests === 4 : roomCode !== 'unknown' && guests === 2;
  assert.equal(calc(factors({priceGroups:[{roomCode,guests,quantity:1}],penthouseRoomFee:roomCode === 'penthouse_apartment' ? 0 : null})) !== 'DENIED', valid);
 }
}
const cart = calc(factors({priceGroups:[suite(2),{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'two_bedroom_apartment',quantity:1,guests:4}],penthouseRoomFee:0}));
assert.equal(cart.totals.totalRooms,4); assert.equal(cart.totals.totalGuests,10);
`);
test('exact inert factors admission without coercion or hooks', `
for (const bad of [null, undefined, 1, [], Object.create({}), new Number(1)]) assert.equal(calc(bad),'DENIED');
assert.equal(calc(factors(), {}),'DENIED');
for (const key of Object.keys(factors())) {const f=factors(); delete f[key]; assert.equal(calc(f),'DENIED',key);}
for (const key of ['extra',Symbol('extra')]) {const f=factors(); f[key]=1; assert.equal(calc(f),'DENIED');}
for (const key of ['totalPerPerson','propertyFeeRate','taxRateAccommodation','taxRateStandard','promoDiscountRate']) {
 for (const bad of ['1',null,undefined,true,new Number(1),NaN,Infinity,-1]) assert.equal(calc(factors({[key]:bad})),'DENIED',key);
}
for (const nights of [0,-1,1.2,Infinity,Number.MAX_SAFE_INTEGER+1,'2']) assert.equal(calc(factors({nights})),'DENIED');
assert.equal(calc(factors({v:2})),'DENIED'); assert.equal(calc(factors({promoDiscountRate:1.01})),'DENIED');
assert.equal(calc(factors({penthouseRoomFee:0})),'DENIED');
assert.equal(calc(factors({priceGroups:[{roomCode:'penthouse_apartment',quantity:1,guests:2}]})),'DENIED');
let hooks=0;
for (const level of ['outer','array','group']) {
 const f=factors(); const target=level==='outer'?f:level==='array'?f.priceGroups:f.priceGroups[0];
 const key=level==='outer'?'totalPerPerson':level==='array'?'0':'guests';
 Object.defineProperty(target,key,{enumerable:true,get(){hooks++;return 2;}});
 assert.equal(calc(f),'DENIED');
}
assert.equal(hooks,0);
const sparse=factors(); delete sparse.priceGroups[0]; assert.equal(calc(sparse),'DENIED');
const hidden=factors(); Object.defineProperty(hidden,'nights',{enumerable:false}); assert.equal(calc(hidden),'DENIED');
const drift=factors(); drift.priceGroups[0]=new Proxy(suite(),{ownKeys(t){drift.totalPerPerson=999; return Reflect.ownKeys(t);}});
assert.equal(calc(drift),'DENIED');
assert.equal(calc(factors({propertyFeeRate:2})).totals.propertyFeeCents,40000);
`);
test('detached deeply frozen null-prototype exact result', `
const f = factors({priceGroups:[suite(),suite()]}); const result=calc(f);
assert.ok(Object.isFrozen(result)); assert.equal(Object.getPrototypeOf(result),null);
assert.deepEqual(Object.keys(result),['v','currency','rounding','groups','totals']);
assert.ok(Object.isFrozen(result.groups)); assert.notEqual(result.groups,f.priceGroups);
for (const g of result.groups) { assert.ok(Object.isFrozen(g)); assert.equal(Object.getPrototypeOf(g),null); assert.deepEqual(Object.keys(g),['index','roomCode','quantity','guests',...components]); }
assert.ok(Object.isFrozen(result.totals)); assert.equal(Object.getPrototypeOf(result.totals),null);
assert.deepEqual(Object.keys(result.totals),[...components,'totalVatCents','totalRooms','totalGuests']);
f.priceGroups[0].quantity=3; f.totalPerPerson=7;
assert.equal(result.groups[0].quantity,1); assert.equal(result.totals.grossCents,40000);
`);
test('post-import intrinsic poisoning cannot alter numerical witness or invoke hooks', `
const nativeKeys=Reflect.ownKeys, nativeDefine=Object.defineProperty;
let reached=0, hooks=0;
const f=factors(); f.priceGroups[0]=new Proxy(suite(),{ownKeys(t){
 if (!reached++) {
  const poison=()=>{hooks++;throw Error('poison invoked');};
  Object.keys=poison; Object.create=poison; Object.freeze=poison;
  Object.getPrototypeOf=poison; Object.getOwnPropertyDescriptor=poison;
  Object.defineProperty=poison;
  Reflect.ownKeys=poison; Object.is=poison; Number.isFinite=poison;
  Number.isSafeInteger=poison; Array.isArray=poison; Math.round=poison;
  String.prototype.endsWith=poison; Array.prototype[Symbol.iterator]=poison;
  nativeDefine(Array.prototype,'0',{configurable:true,set:poison});
 }
 return nativeKeys(t);
}});
const result=calc(f);
assert.equal(result === 'DENIED',false); assert.equal(result.totals.grandTotalCents,23500);
assert.ok(reached>0); assert.equal(hooks,0);
`);
test('precision rejects overflow unsafe cumulative cents underflow and unreconciled total', `
for (const totalPerPerson of [Number.MAX_VALUE,Number.MAX_SAFE_INTEGER/100]) assert.equal(calc(factors({totalPerPerson})),'DENIED');
assert.equal(calc(factors({totalPerPerson:1e13+1.975,promoDiscountRate:.123})),'DENIED');
assert.equal(calc(factors({totalPerPerson:2e13,priceGroups:[suite(),suite(),suite()],propertyFeeRate:0,taxRateAccommodation:0,taxRateStandard:0})),'DENIED');
assert.equal(calc(factors({totalPerPerson:.005,propertyFeeRate:Number.MIN_VALUE})),'DENIED');
assert.equal(calc(factors({totalPerPerson:1e14,promoDiscountRate:1})),'DENIED');
assert.notEqual(calc(factors({totalPerPerson:1e10,propertyFeeRate:0,taxRateAccommodation:0,taxRateStandard:0})),'DENIED');
`);
test('source-extracted table and split .26 versus merged .24 causal witness', `
const penthouse={roomCode:'penthouse_apartment',quantity:1,guests:2};
const table=[
 [{},[20000,0,20000,1000,1000,1500,23500]],
 [{totalPerPerson:123.45,penthouseRoomFee:10.005,nights:3,promoDiscountRate:.1,priceGroups:[penthouse]},[27692,2769,24923,1246,1246,1869,29284]],
 [{totalPerPerson:123.45,penthouseRoomFee:10.005,nights:3,promoDiscountRate:1,priceGroups:[penthouse]},[27692,27692,0,0,0,0,0]],
 [{totalPerPerson:0},[0,0,0,0,0,0,0]],
 [{totalPerPerson:.05},[10,0,10,1,1,1,13]],
 [{totalPerPerson:.05,priceGroups:[suite(2)]},[20,0,20,1,1,2,24]],
 [{totalPerPerson:0,penthouseRoomFee:10.005,nights:3,priceGroups:[penthouse]},[3002,0,3002,150,150,225,3527]]
];
for (const [overrides, expected] of table) {
 const f=factors(overrides); assert.deepEqual(legacy(f,f.priceGroups[0]),expected);
 assert.deepEqual(amounts(calc(f).totals),expected);
}
const split=calc(factors({totalPerPerson:.05,priceGroups:[suite(),suite()]}));
assert.equal(split.totals.grandTotalCents,26);
assert.equal(calc(factors({totalPerPerson:.05,priceGroups:[suite(2)]})).totals.grandTotalCents,24);
assert.deepEqual(split.groups.map(g=>[g.index,g.quantity,g.grandTotalCents]),[[0,1,13],[1,1,13]]);
const ordered=calc(factors({priceGroups:[penthouse,suite(),{roomCode:'two_bedroom_apartment',quantity:1,guests:3},suite()],penthouseRoomFee:1}));
assert.deepEqual(ordered.groups.map(g=>[g.index,g.roomCode]),[[0,'penthouse_apartment'],[1,'adventure_suite'],[2,'two_bedroom_apartment'],[3,'adventure_suite']]);
`);
test('zero rates differ deliberately from legacy fallback and normalize signed zero', `
const f=factors({propertyFeeRate:-0,taxRateAccommodation:0,taxRateStandard:-0});
assert.deepEqual(legacy(f,f.priceGroups[0]),[20000,0,20000,1000,1000,1500,23500]);
assert.deepEqual(amounts(calc(f).totals),[20000,0,20000,0,0,0,20000]);
const z=calc(factors({totalPerPerson:-0,propertyFeeRate:-0,taxRateAccommodation:-0,taxRateStandard:-0,promoDiscountRate:-0}));
for (const k of components) {assert.equal(z.totals[k],0);assert.equal(Object.is(z.totals[k],-0),false);assert.equal(Object.is(z.groups[0][k],-0),false);}
`);
test('independent integer-rational oracle on binary-exact factor grid', `
// Inputs/intermediate pre-R amounts are binary-exact on this restricted grid.
// Oracle uses integer rational half-up, not candidate or legacy roundMoney.
const halfUp=(num,den)=>(2n*num+den)/(2n*den);
let checked=0;
for (let P=0;P<=100;P++) for (let d=0;d<=4;d++) for (const rate of [0,1,2,4]) {
 const gross=BigInt(P)*200n;
 const net=halfUp(gross*BigInt(4-d),4n);
 const fee=halfUp(net*BigInt(rate),8n);
 const vat=halfUp(net*BigInt(rate),16n);
 const expected=[gross,gross-net,net,fee,vat,vat,net+fee+vat+vat].map(Number);
 const f=factors({totalPerPerson:P,promoDiscountRate:d/4,propertyFeeRate:rate/8,taxRateAccommodation:rate/8,taxRateStandard:rate/8});
 assert.deepEqual(amounts(calc(f).totals),expected); checked++;
}
assert.equal(checked,2020); globalThis.__rationalVectors=checked;
`);
test('binary threshold and fractional factor source parity', `
for (const [P,c] of [[.002499999999999,0],[.0025,1],[.002500000000001,1],[.5025,101],[1.3375,268]]) {
 assert.equal(calc(factors({totalPerPerson:P,propertyFeeRate:0,taxRateAccommodation:0,taxRateStandard:0})).totals.grossCents,c);
}
for (const totalPerPerson of [.0025,.005,.05,.075,.145,1.005,1.3375,123.4567,99999.999])
 for (const promoDiscountRate of [0,.1,.333333333333,.5,.99,1])
 for (const roomFee of [0,.001,10.005,101.009]) {
  const f=factors({totalPerPerson,promoDiscountRate,nights:3,penthouseRoomFee:roomFee,priceGroups:[{roomCode:'penthouse_apartment',quantity:1,guests:2}]});
  assert.deepEqual(amounts(calc(f).totals),legacy(f,f.priceGroups[0]));
  globalThis.__parityVectors=(globalThis.__parityVectors||0)+1;
 }
const discount=calc(factors({totalPerPerson:.025,promoDiscountRate:.1,propertyFeeRate:0,taxRateAccommodation:0,taxRateStandard:0}));
assert.deepEqual(amounts(discount.totals),[5,0,5,0,0,0,5]);
`);
test('remaining strict group fee and observable drift contract cases', `
const penthouse={roomCode:'penthouse_apartment',quantity:1,guests:2};
for (const fee of [null,undefined,'0',true,new Number(0),-1,NaN,Infinity]) assert.equal(calc(factors({priceGroups:[penthouse],penthouseRoomFee:fee})),'DENIED');
for (const roomCode of ['penthouse_apartment','two_bedroom_apartment']) assert.equal(calc(factors({priceGroups:[{roomCode,quantity:2,guests:roomCode==='penthouse_apartment'?2:3}],penthouseRoomFee:roomCode==='penthouse_apartment'?0:null})),'DENIED');
for (const quantity of [0,-1,1.5,'1',new Number(1),NaN,Infinity]) assert.equal(calc(factors({priceGroups:[{...suite(),quantity}]})),'DENIED');
for (const level of ['array','group']) {
 const f=factors(), target=level==='array'?f.priceGroups:f.priceGroups[0];
 Object.setPrototypeOf(target,{}); assert.equal(calc(f),'DENIED');
}
for (const key of ['extra',Symbol('extra')]) {
 const f=factors(); f.priceGroups[0][key]=1; assert.equal(calc(f),'DENIED');
}
const f=factors(); let scans=0; const nativeDescriptor=Object.getOwnPropertyDescriptor;
f.priceGroups[0]=new Proxy(suite(),{getOwnPropertyDescriptor(t,k){const d=nativeDescriptor(t,k); if(k==='guests' && ++scans===2) Object.setPrototypeOf(t,{}); return d;}});
assert.equal(calc(f),'DENIED'); assert.equal(scans,2);
const valid=factors({priceGroups:[penthouse],penthouseRoomFee:-0,totalPerPerson:-0});
const result=calc(valid); assert.equal(Object.is(result.groups[0].grossCents,-0),false);
assert.equal(result.currency,'USD'); assert.equal(result.rounding,'original-group-backend-v1');
assert.equal(result.totals.totalVatCents,result.totals.accommodationVatCents+result.totals.packageVatCents);
assert.equal(__dependencyCalls>0,true); assert.notEqual(__dependencyInput.priceGroups,valid.priceGroups);
`);

test('null-prototype factors and inherited then hooks remain inert', `
const nativeDefine=Object.defineProperty, nativeKeys=Reflect.ownKeys;
const f=Object.assign(Object.create(null),factors());
f.priceGroups[0]=Object.assign(Object.create(null),suite());
let hooks=0,reached=0;
const desc=Object.create(null); desc.configurable=true; desc.get=()=>{hooks++;return undefined;};
f.priceGroups[0]=new Proxy(f.priceGroups[0],{ownKeys(t){if(!reached++) {
 nativeDefine(Object.prototype,'then',desc);
} return nativeKeys(t);}});
const r=calc(f);
assert.notEqual(r,'DENIED'); assert.equal(r.totals.grandTotalCents,23500);
assert.equal(r.then,undefined); assert.equal(r.totals.then,undefined); assert.equal(r.groups[0].then,undefined);
assert.equal(hooks,0); assert.ok(reached>0);
`);
test('array predicate captured before outer inspection poison', `
const nativeKeys=Reflect.ownKeys; let hooks=0,reached=0;
const f=new Proxy(factors(),{ownKeys(t){reached++;Array.isArray=()=>{hooks++;return false;};return nativeKeys(t);}});
const r=calc(f); assert.notEqual(r,'DENIED'); assert.equal(r.totals.grandTotalCents,23500); assert.ok(reached>0); assert.equal(hooks,0);
`);

// Each mutant is applied in memory at one exact site, after a GREEN original
// witness in a fresh realm. No production file is rewritten. Helper witnesses
// explicitly isolate layered guards; they are not called end-to-end kills.
const mutants=[];
function mutant(name, anchor, replacement, body, scope='public calculator') {
  mutants.push({name,anchor,replacement,body,scope});
}
const expr=(s)=>`(globalThis.__mutantReached=true, (${s}))`;
const witness=(overrides,field,value)=>`const r=calc(factors(${overrides})); assert.equal(r !== 'DENIED' && r.totals.${field},${value});`;
mutant('whole-stay price not multiplied by nights','multiply(factors.totalPerPerson, g)',expr('multiply(factors.totalPerPerson * factors.nights, g)'),witness('{}','grandTotalCents',23500));
mutant('fractional fee not rounded early','factors.penthouseRoomFee : 0',expr('money(factors.penthouseRoomFee)')+' : 0',tests[6].body);
mutant('fee charged per room not guest','multiply(multiply(F, factors.nights), q)',expr('multiply(multiply(F * g, factors.nights), q)'),tests[6].body);
mutant('quantity retained in gross','multiply(multiply(factors.totalPerPerson, g), q)',expr('multiply(factors.totalPerPerson, g)'),witness('{priceGroups:[suite(2)]}','grossCents',40000));
mutant('promo applied before property fee','multiply(N, factors.propertyFeeRate)',expr('multiply(G, factors.propertyFeeRate)'),tests[6].body);
mutant('promo applied before accommodation VAT','multiply(multiply(N, 0.5), factors.taxRateAccommodation)',expr('multiply(multiply(G, 0.5), factors.taxRateAccommodation)'),tests[6].body);
mutant('promo applied before package VAT','multiply(multiply(N, (1 - 0.5)), factors.taxRateStandard)',expr('multiply(multiply(G, 0.5), factors.taxRateStandard)'),tests[6].body);
mutant('discount is rounded gross minus rounded net','money(G - N)',expr('money(multiply(G, factors.promoDiscountRate))'),witness('{totalPerPerson:.025,promoDiscountRate:.1,propertyFeeRate:0,taxRateAccommodation:0,taxRateStandard:0}','discountCents',0));
mutant('accommodation fixed half share','multiply(N, 0.5)',expr('multiply(N, 1)'),witness('{}','accommodationVatCents',1000));
mutant('package VAT uses standard rate','multiply(multiply(N, (1 - 0.5)), factors.taxRateStandard)',expr('multiply(multiply(N, 0.5), factors.taxRateAccommodation)'),witness('{}','packageVatCents',1500));
mutant('VAT rounded separately before grand sum','const T = money(add(add(add(N, PF), AV), PV));','globalThis.__mutantReached=true; const T = money(N + PF + money(N * .5 * (factors.taxRateAccommodation + factors.taxRateStandard)));',witness('{totalPerPerson:.05}','grandTotalCents',13));
mutant('property fee not taxed','multiply(multiply(N, 0.5), factors.taxRateAccommodation)',expr('multiply(multiply(N + PF, 0.5), factors.taxRateAccommodation)'),witness('{}','accommodationVatCents',1000));
mutant('original duplicate groups not merged','const groups = [];','globalThis.__mutantReached=true; if(factors.priceGroups.length===2 && factors.priceGroups[0].roomCode===factors.priceGroups[1].roomCode) { factors.priceGroups[0].quantity += factors.priceGroups[1].quantity; factors.priceGroups.length=1; } const groups = [];',witness('{totalPerPerson:.05,priceGroups:[suite(),suite()]}','grandTotalCents',26));
mutant('original vector ordering preserved','const groups = [];','globalThis.__mutantReached=true; factors.priceGroups.reverse(); const groups = [];',tests[6].body);
mutant('quantity weighted guest total','q * g',expr('g'),witness('{priceGroups:[suite(2)]}','totalGuests',4));
mutant('aggregate sums rather than replaces cents','sum(totals[key], group[key])',expr('group[key]'),witness('{priceGroups:[suite(),suite()]}','grandTotalCents',47000));
mutant('epsilon source rounding','x + epsilon',expr('x'),`assert.equal(money(1.005),1.01);`,'numerical helper');
mutant('round rather than truncate','round(scaled)',expr('Math.floor(scaled)'),witness('{totalPerPerson:.0025,propertyFeeRate:0,taxRateAccommodation:0,taxRateStandard:0}','grossCents',1));
mutant('underflow multiplication guard','if (a !== 0 && b !== 0 && x === 0) throw 0;','globalThis.__mutantReached=true;',tests[5].body);
mutant('finite guard','!finite(x) || x < 0 || x > maximum',expr('x < 0 || x > maximum'),`assert.throws(()=>bounded(NaN));`,'numerical helper');
mutant('nonnegative guard','!finite(x) || x < 0 || x > maximum',expr('!finite(x) || x > maximum'),`assert.throws(()=>bounded(-1));`,'numerical helper');
mutant('scaled cents bound','bounded(x * 100);', 'globalThis.__mutantReached=true;',`assert.throws(()=>dollars(Number.MAX_SAFE_INTEGER/10));`,'numerical helper');
mutant('safe magnitude bound','!finite(x) || x < 0 || x > maximum',expr('!finite(x) || x < 0'),`assert.throws(()=>bounded(Number.MAX_SAFE_INTEGER+1));`,'numerical helper');
mutant('cents roundtrip guard','if (!integer(c) || c / 100 !== x) throw 0;','globalThis.__mutantReached=true; if (!integer(c)) throw 0;',`assert.throws(()=>cents(.001));`,'numerical helper');
mutant('safe integer operands for cumulative sum','!integer(a) || !integer(b) || a < 0 || b < 0 || a > maximum - b',expr('a < 0 || b < 0 || a > maximum - b'),`assert.throws(()=>sum(.5,.5));`,'numerical helper');
mutant('nonnegative operands for cumulative sum','!integer(a) || !integer(b) || a < 0 || b < 0 || a > maximum - b',expr('!integer(a) || !integer(b) || a > maximum - b'),`assert.throws(()=>sum(-1,1));`,'numerical helper');
mutant('reconcile discount and gross','sum(g.discountCents,g.roomTotalCents) !== g.grossCents',expr('false'),`assert.throws(()=>reconcile({discountCents:1,roomTotalCents:1,grossCents:1,propertyFeeCents:0,accommodationVatCents:0,packageVatCents:0,grandTotalCents:1}));`,'numerical helper');
mutant('reconcile independently rounded grand','sum(sum(sum(g.roomTotalCents,g.propertyFeeCents),g.accommodationVatCents),g.packageVatCents) !== g.grandTotalCents',expr('false'),tests[5].body);
mutant('actual group dependency gate','canonicalizeGuestBookingPriceGroups({priceGroups:detached})',expr("'bypassed'"),tests[1].body);
mutant('observable descriptor stability','function stable(journal) {','function stable(journal) { globalThis.__mutantReached=true; return;',tests[2].body);
// Exact use sites, not const-to-let cosmetic mutants. The proxy poisons after
// trusted initialization; actual dependency remains captured and operational.
for (const [name,anchor,live] of [
 ['round','round(scaled)','Math.round(scaled)'],
 ['finite','finite(x)','Number.isFinite(x)'],
 ['integer','integer(f.nights)','Number.isSafeInteger(f.nights)'],
 ['prototype','getPrototype(e.value)','Object.getPrototypeOf(e.value)'],
 ['keys','ownKeys(e.value)','Reflect.ownKeys(e.value)'],
 ['descriptor',"descriptor(d,'value')","Object.getOwnPropertyDescriptor(d,'value')"],
 ['create','create(null)','Object.create(null)'],
 ['freeze','freeze(group)','Object.freeze(group)'],
 ['identity','same(d.value,before.value)','Object.is(d.value,before.value)']
]) mutant('captured '+name+' use survives late poison',anchor,expr(live),tests[4].body);

mutant('captured array predicate survives early poison','isArray(value)',expr('Array.isArray(value)'),tests[12].body);
mutant('captured define survives late poison','define(array, index, record({value,writable:true,enumerable:true,configurable:true}))',expr('Object.defineProperty(array, index, record({value,writable:true,enumerable:true,configurable:true}))'),tests[4].body);
mutant('cumulative bound and integer result defense','if (!integer(a) || !integer(b) || a < 0 || b < 0 || a > maximum - b) throw 0;\n  const result = a + b;\n  if (!integer(result)) throw 0;', 'globalThis.__mutantReached=true; const result = a + b;',tests[5].body);

const summary={suites:tests.length,assertions:0,rationalVectors:0,parityVectors:0,mutants:0,publicMutants:0,helperMutants:0};
for (const t of tests) {
 const counts=run(t.body); for(const key of ['assertions','rationalVectors','parityVectors']) summary[key]+=counts[key];
 console.log('PASS '+t.name+' '+JSON.stringify(counts));
}
const hash=s=>require('node:crypto').createHash('sha256').update(s).digest('hex');
for (const m of mutants) {
 const offset=source.indexOf(m.anchor); assert.ok(offset>=0,'missing anchor: '+m.name);
 // Only first exact occurrence is mutated; offset identifies repeated anchors.
 const candidate=source.slice(0,offset)+m.replacement+source.slice(offset+m.anchor.length);
 run(m.body); // original GREEN is mandatory for every exact witness
 let error; try {run(m.body,candidate);} catch(e) {error=e;}
 assert.ok(error,'SURVIVED: '+m.name);
 assert.equal(error.code,'ERR_ASSERTION','noncausal error: '+m.name+' '+error.stack);
 assert.equal(error.mutantReached,true,'unreached mutation: '+m.name);
 summary.mutants++; summary[m.scope==='numerical helper'?'helperMutants':'publicMutants']++;
 console.log('KILLED '+JSON.stringify({name:m.name,scope:m.scope,offset,anchor:m.anchor,replacement:m.replacement,sha256:hash(candidate),code:error.code,error:error.message,stack:error.stack}));
}
console.log('SUMMARY '+JSON.stringify(summary));

// GFC-C1: native ESM avoids the VM/global instrumentation abort under inherited
// descriptor hooks. Data URLs relocate only the static dependency specifier;
// the actual group module is neither stubbed nor instrumented. No files written.
async function nativeDescriptorProbe() {
 const assert = (await import('node:assert/strict')).default;
 const fs = await import('node:fs');
 const {calculatorURL, dependencyURL, hook, boundary, variant} = JSON.parse(fs.readFileSync(0, 'utf8'));
 const {calculateGuestBookingFinancials:calc} = await import(calculatorURL);
 const {canonicalizeGuestBookingPriceGroups:canonicalize} = await import(dependencyURL);
 const caseName = hook + '/' + boundary;
 const define = Object.defineProperty, keys = Reflect.ownKeys;
 // Fresh subprocess must start pristine; deletion in finally restores exactly.
 assert.equal(Object.getOwnPropertyDescriptor(Object.prototype,'get'),undefined);
 assert.equal(Object.getOwnPropertyDescriptor(Object.prototype,'set'),undefined);
 const counts = {get:0,set:0}; let reached=0, scans=0;
 const f = {v:1,nights:2,totalPerPerson:100,penthouseRoomFee:null,propertyFeeRate:.05,taxRateAccommodation:.1,taxRateStandard:.15,promoDiscountRate:0,priceGroups:[{roomCode:'adventure_suite',quantity:1,guests:2}]};
 const original = calc(f);
 assert.equal(original.totals.grandTotalCents,23500);
 assert.equal(canonicalize({priceGroups:f.priceGroups}),'[1,[["adventure_suite",1,2]]]');
 assert.equal(calc({...f,priceGroups:[{roomCode:'adventure_suite',quantity:4,guests:2}]}),'DENIED');
 function install() {
  reached++;
  for (const key of hook==='both'?['get','set']:[hook]) {
   const d=Object.create(null); d.configurable=true;
   d.get=()=>{counts[key]++;return undefined;};
   define(Object.prototype,key,d);
  }
 }
 let input=f;
 if (boundary==='outer') input=new Proxy(f,{ownKeys(t){if(++scans===1)install();return keys(t);}});
 else f.priceGroups[0]=new Proxy(f.priceGroups[0],{ownKeys(t){if(++scans===(boundary==='group-first'?1:2))install();return keys(t);}});
 let result;
 // No await, assertions, serialization or I/O until BOTH globals are restored.
 try { result=calc(input); }
 finally { delete Object.prototype.get; delete Object.prototype.set; }
 const evidence={caseName,variant,hook,boundary,reached,scans,counts,result:result==='DENIED'?result:result.totals.grandTotalCents};
 try {
  assert.equal(reached,1,'attack installed once: '+caseName);
  assert.deepEqual(counts,{get:0,set:0},'inherited descriptor callbacks must remain zero: '+caseName);
  assert.notEqual(result,'DENIED','valid calculation survives: '+caseName);
  assert.deepEqual(result,original,'exact original result survives: '+caseName);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.groups)&&Object.isFrozen(result.groups[0])&&Object.isFrozen(result.totals));
  for (const record of [result,result.groups[0],result.totals]) assert.equal(Object.getPrototypeOf(record),null);
  console.log(JSON.stringify({...evidence,passed:true}));
 } catch (error) {
  console.log(JSON.stringify({...evidence,passed:false,code:error.code,message:error.message,actual:error.actual,expected:error.expected,operator:error.operator,stack:error.stack}));
  process.exitCode=1;
 }
}
function verifyNativeDescriptors() {
 const {spawnSync} = require('node:child_process');
 const anchor='define(array, index, record({value,writable:true,enumerable:true,configurable:true}))';
 const replacement='define(array, index, {value,writable:true,enumerable:true,configurable:true})';
 const importSpecifier="'backend/guestBookingPriceGroups'";
 assert.equal(hash(source),'3dc9fae1c48a48e78b34608c57970e73fae546c65e7c3a31449359f01a67fe71','GFC-C1 source pin; rebase witnesses explicitly if source changes');
 assert.equal(hash(dependency),'d787fea9c954650a7003953b9620e6862f4a44bcfa0b7e41818837d8ca3cfad8','actual group dependency pin');
 assert.equal(source.split(anchor).length,2,'unique descriptor reversion site');
 assert.equal(source.split(importSpecifier).length,2,'unique static import relocation');
 const offset=source.indexOf(anchor), reverted=source.replace(anchor,replacement);
 assert.equal(hash(reverted),'48a4c66d236b88e8e965cec69613dc71df4e213d8aa228f2a04de2083d974169');
 const url=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
 const dependencyURL=url(dependency);
 const childCode='('+nativeDescriptorProbe.toString()+')().catch(error=>{console.error(error);process.exitCode=1;});';
 const nativeSummary={originalCases:0,reversionCases:0,uniqueReversionMutants:1};
 for (const hook of ['get','set','both']) for (const boundary of ['outer','group-first','group-second']) {
  const caseName=hook+'/'+boundary;
  // Each fresh original must pass before its identically configured reversion.
  for (const variant of ['original','ordinary-descriptor-reversion']) {
   const candidate=variant==='original'?source:reverted;
   const calculatorURL=url(candidate.replace(importSpecifier,JSON.stringify(dependencyURL)));
   const child=spawnSync(process.execPath,['--input-type=module','--eval',childCode],{
    input:JSON.stringify({calculatorURL,dependencyURL,hook,boundary,variant}),
    encoding:'utf8',timeout:15000,maxBuffer:1024*1024,cwd:root
   });
   const diagnostic=caseName+' '+variant+' '+JSON.stringify({status:child.status,signal:child.signal,error:child.error?.message,stdout:child.stdout,stderr:child.stderr});
   assert.equal(child.error,undefined,diagnostic);
   assert.equal(child.signal,null,diagnostic);
   assert.equal(child.stderr,'',diagnostic);
   assert.equal(child.status,variant==='original'?0:1,diagnostic);
   // A crash, loader error, extra output or wrong assertion cannot earn credit.
   const evidence=JSON.parse(child.stdout.trim());
   assert.equal(evidence.caseName,caseName,diagnostic);
   assert.equal(evidence.variant,variant,diagnostic);
   assert.equal(evidence.hook,hook,diagnostic);
   assert.equal(evidence.boundary,boundary,diagnostic);
   assert.equal(evidence.reached,1,diagnostic);
   assert.equal(evidence.scans,variant==='original'?3:boundary==='group-second'?2:1,diagnostic);
   if (variant==='original') {
    assert.equal(evidence.passed,true,diagnostic);
    assert.deepEqual(evidence.counts,{get:0,set:0},diagnostic);
    assert.equal(evidence.result,23500,diagnostic);
    nativeSummary.originalCases++;
   } else {
    const expectedCounts={get:hook==='set'?0:1,set:hook==='get'?0:1};
    assert.equal(evidence.passed,false,diagnostic);
    assert.equal(evidence.code,'ERR_ASSERTION',diagnostic);
    assert.ok(evidence.message.startsWith('inherited descriptor callbacks must remain zero: '+caseName+'\n'),diagnostic);
    assert.equal(evidence.operator,'deepStrictEqual',diagnostic);
    assert.deepEqual(evidence.actual,expectedCounts,diagnostic);
    assert.deepEqual(evidence.expected,{get:0,set:0},diagnostic);
    assert.deepEqual(evidence.counts,expectedCounts,diagnostic);
    assert.equal(evidence.result,'DENIED',diagnostic);
    nativeSummary.reversionCases++;
   }
   console.log('NATIVE_DESCRIPTOR '+JSON.stringify({sha256:hash(candidate),dependencySha256:hash(dependency),offset,anchor,replacement,status:child.status,...evidence}));
  }
 }
 assert.deepEqual(nativeSummary,{originalCases:9,reversionCases:9,uniqueReversionMutants:1});
 // Separate witness accounting: do not inflate the existing 42 (33 public/9
 // helper) mutants or the 13-suite / 2457 internal-assertion summary above.
 console.log('NATIVE_DESCRIPTOR_SUMMARY '+JSON.stringify(nativeSummary));
}
verifyNativeDescriptors();
