// Pure rules verification; fixtures execute in the module's native VM realm.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.join(__dirname, '../velo/backend/roomBookingInvoiceAllocationRules.js');
assert.ok(fs.existsSync(sourcePath), 'physical-room invoice allocator must exist');
const source = fs.readFileSync(sourcePath, 'utf8');
const cases = [];
function test(name, body) { cases.push({ name, body: body.toString() }); }
const setup = `
const alloc = allocatePhysicalRoomInvoiceAmounts;
const input = (prices = [100, 300], discountMinor = 100, propertyFeeMinor = 3, accommodationVatMinor = 5, packageVatMinor = 1) => ({
 rows: prices.map((preDiscountMinor, i) => ({bookingRowId: 'pb1-invoicetrace00001-r' + (i+1), preDiscountMinor})),
 discountMinor, propertyFeeMinor, accommodationVatMinor, packageVatMinor
});
const eq = (a,b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const invalid = x => assert.throws(() => alloc(x), e => e.constructor === Error && e.message === 'Invalid physical room invoice allocation');
function prototypeDrift(where, trap, pass) {
 const x = input();
 const target = where === 'top' ? x : where === 'array' ? x.rows : x.rows[0];
 const key = where === 'top' ? 'packageVatMinor' : where === 'array' ? 'length' : 'preDiscountMinor';
 const changedProto = where === 'array' ? {} : null;
 let calls = 0, changed = false;
 function drift() {
  if (++calls === pass) { Object.setPrototypeOf(target, changedProto); changed = true; }
 }
 const proxy = new Proxy(target, {
  ownKeys(t) { const keys = Reflect.ownKeys(t); if (trap === 'ownKeys') drift(); return keys; },
  getOwnPropertyDescriptor(t,k) {
   const d = Reflect.getOwnPropertyDescriptor(t,k);
   if (trap === 'descriptor' && k === key) drift();
   return d;
  }
 });
 let argument = x;
 if (where === 'top') argument = proxy; else if (where === 'array') x.rows = proxy; else x.rows[0] = proxy;
 let error;
 try { alloc(argument); } catch (e) { error = e; }
 // Prove the actual target changed at the intended observation, not just that
 // an unrelated validation failure happened before the attack was reached.
 assert.equal(changed, true, 'prototype attack reached');
 assert.ok(calls >= pass, 'intended trap observation reached');
 assert.equal(Object.getPrototypeOf(target), changedProto, 'actual target prototype changed');
 assert.ok(error, 'prototype drift must reject');
 assert.equal(error.constructor, Error);
 assert.equal(error.message, 'Invalid physical room invoice allocation');
}
`;
for (const where of ['top','array','row']) for (const trap of ['ownKeys','descriptor']) {
 test('late prototype drift rejects: ' + where + '/' + trap,
  new Function('prototypeDrift(' + JSON.stringify(where) + ',' + JSON.stringify(trap) + ',2);'));
 test('intermediate prototype drift rejects: ' + where + '/' + trap,
  new Function('prototypeDrift(' + JSON.stringify(where) + ',' + JSON.stringify(trap) + ',1);'));
}
test('different physical prices preserve authoritative amounts', () => {
 const result = alloc(input());
 eq(result, {rows:[
 {bookingRowId:'pb1-invoicetrace00001-r1',preDiscountMinor:100,discountMinor:25,netMinor:75,propertyFeeMinor:1,accommodationVatMinor:1,packageVatMinor:0,totalMinor:77},
 {bookingRowId:'pb1-invoicetrace00001-r2',preDiscountMinor:300,discountMinor:75,netMinor:225,propertyFeeMinor:2,accommodationVatMinor:4,packageVatMinor:1,totalMinor:232}
 ],totals:{preDiscountMinor:400,discountMinor:100,netMinor:300,propertyFeeMinor:3,accommodationVatMinor:5,packageVatMinor:1,totalMinor:309}});
});
test('deep frozen detached output', () => {
 const original = input(); const out = alloc(original);
 assert.ok(Object.isFrozen(out)); assert.ok(Object.isFrozen(out.rows));
 assert.ok(Object.isFrozen(out.totals)); out.rows.forEach(row => assert.ok(Object.isFrozen(row)));
 original.rows[0].preDiscountMinor = 99; assert.equal(out.rows[0].preDiscountMinor,100);
});
test('largest remainder ties and permutation use lexical IDs', () => {
 const x = input([1,1,1],1,1,1,1); const a = alloc(x);
 eq(a.rows.map(r => [r.discountMinor,r.netMinor,r.propertyFeeMinor]),[[1,0,0],[0,1,1],[0,1,0]]);
 for (const order of [[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]) eq(alloc({...x,rows:order.map(i=>x.rows[i])}),a);
});
test('zero and full discount', () => {
 for (let n=1;n<=5;n++) {
  const zero = alloc(input(Array(n).fill(0),0,0,0,0)); assert.equal(zero.totals.totalMinor,0);
  const full = alloc(input(Array(n).fill(7),7*n,0,0,0)); assert.equal(full.totals.netMinor,0);
 }
 eq(alloc(input([0,3],0,1,0,0)).rows.map(r=>r.propertyFeeMinor),[0,1]);
});
test('BigInt products and safe sum boundaries', () => {
 const max = Number.MAX_SAFE_INTEGER;
 const a = alloc(input([4503599627370495,4503599627370496],4503599627370495,1,0,0));
 eq(a.rows.map(r=>r.discountMinor),[2251799813685247,2251799813685248]);
 assert.equal(a.totals.totalMinor,4503599627370497);
 assert.equal(alloc(input([max],0,0,0,0)).totals.totalMinor,max);
 const b = alloc(input([4503599627370495,1],0,4503599627370495,0,0));
 eq(b.rows.map(r=>r.propertyFeeMinor),[4503599627370494,1]); assert.equal(b.totals.totalMinor,max);
 invalid(input([max,1],0,0,0,0)); invalid(input([max,1],1,0,0,0)); invalid(input([max],0,1,0,0));
});
test('bounded independent rational allocation oracle 1..5 rows', () => {
 function oracle(amount, weights) {
  const sum=weights.reduce((a,b)=>a+b,0); if(!sum) return weights.map(()=>0);
  const out=weights.map(w=>Math.floor(amount*w/sum));
  const order=weights.map((w,i)=>({i,r:(amount*w)%sum})).sort((a,b)=>b.r-a.r||a.i-b.i);
  for(let i=0,left=amount-out.reduce((a,b)=>a+b,0);i<left;i++)out[order[i].i]++;
  return out;
 }
 for(let n=1;n<=5;n++)for(let seed=0;seed<40;seed++) {
  const prices=Array.from({length:n},(_,i)=>(seed*7+i*11)%19);
  const sum=prices.reduce((a,b)=>a+b,0), d=sum?seed%(sum+1):0;
  const taxes=sum>d?[seed%7,seed%5,seed%3]:[0,0,0];
  const out=alloc(input(prices,d,...taxes)), discounts=oracle(d,prices), nets=prices.map((p,i)=>p-discounts[i]);
  eq(out.rows.map(r=>r.discountMinor),discounts);
  for(const [k,amount] of [['propertyFeeMinor',taxes[0]],['accommodationVatMinor',taxes[1]],['packageVatMinor',taxes[2]]]) eq(out.rows.map(r=>r[k]),oracle(amount,nets));
  for(const key of Object.keys(out.totals)) assert.equal(out.rows.reduce((s,r)=>s+r[key],0),out.totals[key]);
  assert.equal(out.totals.totalMinor,sum-d+taxes.reduce((a,b)=>a+b,0));
 }
});
test('strict scalars, ID format, duplicate IDs and inconsistent amounts', () => {
 for(const bad of [undefined,null,true,'1',1n,-0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,{},[],()=>1]) {
  for(const key of ['discountMinor','propertyFeeMinor','accommodationVatMinor','packageVatMinor']) invalid({...input(),[key]:bad});
  const x=input(); x.rows[0].preDiscountMinor=bad; invalid(x);
 }
 for(const id of ['',1,null,' pb1-invoicetrace00001-r1','pb1-short-r1','pb1-invoicetrace00001-r0','pb1-invoicetrace00001-r6','pb1-invoicetrace00001-r01','pb1-invoicetrace00001-r1\n']) {const x=input();x.rows[0].bookingRowId=id;invalid(x);}
 const x=input();x.rows[1].bookingRowId=x.rows[0].bookingRowId;invalid(x);
 invalid(input([1],2,0,0,0));
 for(const prices of [[0],[1]])for(const fees of [[1,0,0],[0,1,0],[0,0,1]]) invalid(input(prices,prices[0],...fees));
});
test('exact own data records and dense ordinary arrays without callbacks', () => {
 let callbacks=0; const getter=()=>{callbacks++;return 0;};
 for(const bad of [null,undefined,[],()=>{},new Date(),Object.create(input())]) invalid(bad);
 for(const where of ['top','row','array'])for(const attack of ['extra','symbol','getter','hidden','missing','proto']) {
  const x=input(), target=where==='top'?x:where==='row'?x.rows[0]:x.rows;
  const key=where==='top'?'discountMinor':where==='row'?'preDiscountMinor':'0';
  if(attack==='extra')target.extra=1;
  if(attack==='symbol')target[Symbol('x')]=1;
  if(attack==='getter')Object.defineProperty(target,key,{get:getter,configurable:true,enumerable:true});
  if(attack==='hidden')Object.defineProperty(target,key,{enumerable:false});
  if(attack==='missing')delete target[key];
  if(attack==='proto')Object.setPrototypeOf(target,{});
  invalid(x);
 }
 for(const rows of [[],Array(6).fill(input().rows[0]),{0:input().rows[0],length:1},Object.create(Array.prototype)]) invalid({...input(),rows});
 const coercible={valueOf:getter,toString:getter,[Symbol.toPrimitive]:getter}; invalid({...input(),discountMinor:coercible});
 assert.equal(callbacks,0);
 const x=input();Object.setPrototypeOf(x,null);x.rows.forEach(r=>Object.setPrototypeOf(r,null));Object.freeze(x.rows[0]);Object.freeze(x.rows);Object.freeze(x); assert.equal(alloc(x).totals.totalMinor,309);
});
test('descriptor, key order and prototype drift or throwing proxies reject', () => {
 for(const mode of ['value','flags','keys','proto','throw'])for(const where of ['top','row','array']) {
  const x=input();const target=where==='top'?x:where==='row'?x.rows[0]:x.rows;let count=0;
  const key=where==='top'?'discountMinor':where==='row'?'preDiscountMinor':'0';
  const proxy=new Proxy(target,{
   getPrototypeOf(t){if(mode==='throw')throw 123;if(mode==='proto')return ++count===1?Reflect.getPrototypeOf(t):null;return Reflect.getPrototypeOf(t);},
   ownKeys(t){const k=Reflect.ownKeys(t);return mode==='keys'&&++count>1?k.reverse():k;},
   getOwnPropertyDescriptor(t,k){const d=Reflect.getOwnPropertyDescriptor(t,k);if(k===key&&(mode==='value'||mode==='flags')&&++count>1){if(mode==='value')d.value=where==='array'?{...t[0]}:0;else d.writable=!d.writable;}return d;}
  });
  if(where==='top')invalid(proxy);else {if(where==='row')x.rows[0]=proxy;else x.rows=proxy;invalid(x);}
 }
 const revoked=Proxy.revocable(input(),{});revoked.revoke();invalid(revoked.proxy);
});
test('captured intrinsic closure withstands synchronous trap poisoning', () => {
 const x=input(); let attacked=0, invoked=0;
 const replacements=[[Reflect,'ownKeys'],[Object,'getOwnPropertyDescriptor'],[Object,'getPrototypeOf'],[Object,'is'],[Object,'defineProperty'],[Object,'create'],[Object,'freeze'],[Array,'isArray'],[Number,'isSafeInteger'],[Reflect,'apply'],[Array.prototype,'sort'],[RegExp.prototype,'test']];
 const originals=replacements.map(([o,k])=>o[k]); const oldBigInt=BigInt,oldNumber=Number,oldError=Error;
 const proxy=new Proxy(x,{ownKeys(t){attacked++;replacements.forEach(([o,k])=>{o[k]=()=>{invoked++;throw 42;};});globalThis.BigInt=globalThis.Number=globalThis.Error=()=>{invoked++;throw 42;};return originals[0](t);}});
 let out;
 try {out=alloc(proxy);} finally {replacements.forEach(([o,k],i)=>{o[k]=originals[i];});globalThis.BigInt=oldBigInt;globalThis.Number=oldNumber;globalThis.Error=oldError;}
 assert.ok(attacked>0);assert.equal(invoked,0);assert.equal(out.totals.totalMinor,309);
});
test('all permutations for 1..5 rows are identical and output is exact', () => {
 let permutations=0;
 function visit(prefix, rest, original, expected) {
  if(!rest.length) {const out=alloc({...original,rows:prefix});eq(out,expected);permutations++;return;}
  rest.forEach((row,i)=>visit([...prefix,row],rest.filter((_,j)=>i!==j),original,expected));
 }
 for(let n=1;n<=5;n++){const x=input(Array.from({length:n},(_,i)=>i+1),0,2,3,4);visit([],x.rows,x,alloc(x));}
 assert.equal(permutations,153);
 const out=alloc(input([0,3],0,0,0,0));
 assert.equal(Object.getPrototypeOf(out),null); assert.equal(Object.getPrototypeOf(out.totals),null);
 eq(Reflect.ownKeys(out),['rows','totals']);
 out.rows.forEach(row=>{assert.equal(Object.getPrototypeOf(row),null);for(const k of Object.keys(out.totals)){assert.ok(Number.isSafeInteger(row[k]));assert.ok(!Object.is(row[k],-0));assert.ok(row[k]>=0);}});
});
test('cross-node mutation, signed zero drift and inherited index poison', () => {
 const x=input(); let calls=0;
 x.rows[1]=new Proxy(x.rows[1],{ownKeys(t){if(++calls===1)x.discountMinor=1;return Reflect.ownKeys(t);}});invalid(x);
 const y=input([0],0,0,0,0);let reads=0;
 y.rows[0]=new Proxy(y.rows[0],{getOwnPropertyDescriptor(t,k){const d=Reflect.getOwnPropertyDescriptor(t,k);if(k==='preDiscountMinor'&&++reads>1)d.value=-0;return d;}});invalid(y);
 const z=input();let attacked=0,out; const def=Object.defineProperty;
 const p=new Proxy(z,{ownKeys(t){attacked++;def(Array.prototype,'0',{value:'poison',writable:false,configurable:true});return Reflect.ownKeys(t);}});
 try {out=alloc(p);} finally {delete Array.prototype[0];}
 assert.ok(attacked>0);assert.equal(out.totals.totalMinor,309);
});
test('rounded floating product changes a real penny allocation', () => {
 const out=alloc(input([4503599626549888,4503598670555644],4503599148493903,0,0,0));
 eq(out.rows.map(r=>r.discountMinor),[2251799813245512,2251799335248391]);
});
test('accessor descriptor cannot borrow an inherited data value', () => {
 const x=input();let invoked=0;
 Object.defineProperty(x,'discountMinor',{get(){invoked++;return 100;},enumerable:true,configurable:true});
 // The proxy poisons after fixture construction; native descriptor objects for
 // accessors have no own value, so ordinary d.value would inherit this forgery.
 const p=new Proxy(x,{ownKeys(t){Object.prototype.value=100;return Reflect.ownKeys(t);}});
 try {invalid(p);} finally {delete Object.prototype.value;}
 assert.equal(invoked,0);
});
function run(text, verbose = false) {
 let passed = 0; const failures = [];
 for (const c of cases) {
  const context = vm.createContext({assert});
  try {
   vm.runInContext(text.replace(/export function /g, 'function ') + '\n' + setup + '\n(' + c.body + ')();', context, {timeout:2000});
   passed++;
   if (verbose) console.log('PASS ' + c.name);
  } catch (error) { failures.push(c.name + ': ' + error.message); }
 }
 if (failures.length) throw new Error(failures.join('\n'));
 return passed;
}
console.log('Invoice allocation: ' + run(source, true) + ' behavioral cases passed');
// Finite single-site witnesses, not an exhaustive mutation-closure claim.
// Compile first: syntax failures cannot count as behavioral kills. Run pristine
// baseline above, then unchanged cases in fresh native realms for every mutant.
const mutations = [
 ['product-addition','const product = total * weights[i];','const product = total + weights[i];'],
 ['floating-product','const product = total * weights[i];','const product = toBig(toNumber(total) * toNumber(weights[i]));'],
 ['remainder-division','product % denominator','product / denominator'],
 ['reverse-remainder','remainders[i] > remainders[winner]','remainders[i] < remainders[winner]'],
 ['reverse-tie','remainders[i] > remainders[winner]','remainders[i] >= remainders[winner]'],
 ['residual-off-by-one','penny < left','penny + 1n < left'],
 ['residual-not-consumed','put(remainders, winner, -1n);','put(remainders, winner, remainders[winner]);'],
 ['net-addition','const net = pre - discount;','const net = pre + discount;'],
 ['fee-wrong-weights','apportion(fee, nets)','apportion(fee, prices)'],
 ['vat-wrong-weights','apportion(accommodation, nets)','apportion(accommodation, prices)'],
 ['package-wrong-weights','apportion(packages, nets)','apportion(packages, prices)'],
 ['reverse-output','row.bookingRowId < rows[j - 1].bookingRowId','row.bookingRowId > rows[j - 1].bookingRowId'],
 ['allow-negative-zero',' || same(value, -0)',''],
 // Omitted candidate: deleting isSafe alone still rejects fractions at BigInt
 // conversion and oversized nonnegative amounts at aggregate bounds.
 ['skip-stability','stable(first, second);',''],
 ['skip-closing-prototype','if (prototype(value) !== proto) fail();',''],
 ['skip-data-descriptor',"!descriptor(d, 'value')",'false'],
 ['skip-id-format','apply(exec, ID, [rows[i].bookingRowId]) === null','false'],
 ['skip-duplicate','rows[i].bookingRowId === rows[j].bookingRowId','false'],
 ['allow-overflow','total > MAX','false'],
 ['allow-pre-overflow','pre > MAX','false'],
 ['allow-zero-net-taxes','net === 0n &&','false &&'],
 ['unfrozen-output','return freeze(output);','return output;'],
 ['live-ownkeys','const keys = ownKeys(value);','const keys = Reflect.ownKeys(value);'],
 ['live-safe-integer','!isSafe(value)','!Number.isSafeInteger(value)']
];
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let killed=0;
for(const [id,anchor,replacement] of mutations) {
 assert.equal(source.split(anchor).length,2,'unique mutation anchor: '+id);
 const mutant=source.replace(anchor,replacement);
 new vm.Script(mutant.replace(/export function /g,'function '));
 let failure;try{run(mutant);}catch(error){failure=error;}
 assert.ok(failure,'surviving mutant: '+id);
 killed++;
 console.log('KILL '+id+' offset='+source.indexOf(anchor)+' sha256='+hash(mutant)+' witness='+failure.message);
}
console.log('Mutation witnesses: '+killed+'/'+mutations.length+' killed');
console.log('SOURCE SHA256 '+hash(source));
console.log('TEST SHA256 '+hash(fs.readFileSync(__filename)));
