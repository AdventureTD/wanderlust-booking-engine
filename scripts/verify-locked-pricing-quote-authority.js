'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const root = path.resolve(__dirname, '..');
const adapterPath = path.join(root, 'velo/backend/lockedPricingQuoteAuthority.js');
const strictPath = path.join(root, 'velo/backend/strictLockedPricingQuote.js');
const KEY = ' PUBLIC-ONLY-é-QUOTE-FIXTURE-KEY-0001 ';
const NOW = 1800000000000;
const claims = {v:1, nonce:'000102030405060708090a0b', issuedAt:NOW, expiresAt:NOW+3600000, checkIn:'2027-01-01', checkOut:'2027-01-03', nights:2, packageId:'public-package', packageTitle:' Public é 😀 ', baseRate:123.4567, priceModifier:1.125, totalPerPerson:0};
const expected = c => Object.assign(Object.create(null), {packageId:c.packageId, checkIn:c.checkIn, checkOut:c.checkOut, nights:c.nights});
function signText(text, key=KEY) { const p=Buffer.from(text).toString('base64url'); return p+'.'+crypto.createHmac('sha256',key).update(p).digest('base64url'); }
const sign = (c=claims,key=KEY) => signText(JSON.stringify(c),key);
function load(source, mappings, context) {
  const names=[];
  const text=source.replace(/^import (.+) from '([^']+)';$/gm, (_,binding,spec)=>{
    assert.ok(Object.hasOwn(mappings,spec),'unexpected import '+spec);
    return `const ${binding} = imports[${JSON.stringify(spec)}];`;
  }).replace(/export (async )?function (\w+)/g, (_,a,n)=>{names.push(n);return (a||'')+'function '+n;});
  assert.ok(!/\b(import|export)\s/.test(text),'unmapped module syntax');
  context.imports=mappings;
  return vm.runInContext('(function(){'+text+';return {'+names.join(',')+'};})()',context);
}
// Mutations remain in memory; each witness uses fresh actual modules/real crypto.
let activeAdapter = null;
let activeStrict = null;
const adapterSource = () => activeAdapter || fs.readFileSync(adapterPath,'utf8');
function subject(source, strictSource) {
  const state={now:NOW, reads:0, elevations:0, clocks:0, response:()=>Object.assign(Object.create(null),{value:KEY})};
  const context=vm.createContext({});
  context.clock=()=>{state.clocks++;if(state.clockError)throw state.clockError;return state.now;};
  vm.runInContext('Date.now = function(){return clock();}',context);
  const verifier=load(strictSource||activeStrict||fs.readFileSync(strictPath,'utf8'),{crypto,buffer:{Buffer}},context);
  const raw=(...args)=>{state.reads++;assert.deepEqual(args,['WBE_PRICING_QUOTE_SECRET'],'literal secret name');return state.response();};
  const secrets={getSecretValue:raw};
  const auth={elevate(fn){state.elevations++;assert.equal(fn,raw,'exact elevation target');if(state.elevationError)throw state.elevationError;return state.badElevation?null:(...args)=>fn(...args);}};
  const exports=load(source||adapterSource(),{'wix-secrets-backend.v2':{secrets},'wix-auth':auth,'backend/strictLockedPricingQuote':verifier},context);
  return {state,context,secrets,auth,read:exports.readLockedPricingQuoteAuthority};
}
function success(r,t=sign(),c=claims){assert.notEqual(r,'DENIED');assert.equal(r.token,t);assert.equal(r.purpose,'locked-pricing-quote');assert.deepEqual({...r.claims},c);assert.deepEqual(Object.keys(r).sort(),['claims','purpose','token']);assert.equal(Object.getPrototypeOf(r),null);assert.equal(Object.getPrototypeOf(r.claims),null);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.claims));}
const tests=[];
function test(name,fn){tests.push([name,fn]);}
test('documented response real HMAC preserved zero Unicode factors',async()=>{const s=subject();success(await s.read(sign(),expected(claims)));assert.equal(s.state.reads,1);assert.equal(s.state.elevations,1);});
test('wrong arity denies before IO',async()=>{const s=subject();assert.equal(await s.read(sign(),expected(claims),KEY,NOW),'DENIED');assert.equal(s.state.reads,0);});
test('bad transport denies before IO',async()=>{for(const t of ['',new String(sign()),sign()+'\n','a.'+'a'.repeat(42),'a='.repeat(9000)]){const s=subject();assert.equal(await s.read(t,expected(claims)),'DENIED');assert.equal(s.state.reads,0);}});
function pending(s){let resolve;s.state.response=()=>new Promise(r=>{resolve=r;});return value=>resolve(value===undefined?Object.assign(Object.create(null),{value:KEY}):value);}
test('snapshot preserves original across suspended read',async()=>{const s=subject(),e=expected(claims),done=pending(s);const p=s.read(sign(),e);e.packageId='other';done();success(await p);assert.equal(e.packageId,'other');});
test('expected shape and bounds deny before elevation without hooks',async()=>{let hooks=0;const bad=[null,{},Object.assign(expected(claims),{extra:1}),Object.assign(expected(claims),{packageId:''}),Object.assign(expected(claims),{packageId:'p'.repeat(257)}),Object.assign(expected(claims),{checkIn:'2027-1-01'}),Object.assign(expected(claims),{checkOut:'2027-01-03\n'}),Object.assign(expected(claims),{nights:0}),Object.assign(expected(claims),{nights:1.5}),Object.assign(expected(claims),{nights:Number.MAX_SAFE_INTEGER+1}),Object.assign(expected(claims),{packageId:{toString(){hooks++;return 'public-package';}}}),Object.defineProperty(expected(claims),'packageId',{get(){hooks++;return claims.packageId;}}),Object.defineProperty(expected(claims),'nights',{value:2,enumerable:false}),Object.assign(Object.create({}),expected(claims)),Object.assign(expected(claims),{[Symbol('extra')]:1})];for(const e of bad){const s=subject();assert.equal(await s.read(sign(),e),'DENIED');assert.equal(s.state.reads,0);assert.equal(s.state.elevations,0);}assert.equal(hooks,0);});
test('expected observable descriptor drift denied before IO',async()=>{for(const mode of ['value','writable','enumerable','configurable','prototype','keys']){const s=subject();let count=0;const e=new Proxy(expected(claims),{getOwnPropertyDescriptor(t,k){const d=Object.getOwnPropertyDescriptor(t,k);if(k==='nights'){count++;if(count===1&&mode==='prototype')Object.setPrototypeOf(t,{});if(count===1&&mode==='keys')t.extra=1;if(count===2){if(mode==='value')d.value=3;else if(['writable','enumerable','configurable'].includes(mode))d[mode]=false;}}return d;}});assert.equal(await s.read(sign(),e),'DENIED',mode);assert.equal(s.state.reads,0,mode);}});
const FINAL_EXPECTED_PROTOTYPE_WITNESS = 'expected final descriptor second scan prototype drift denies before IO';
test(FINAL_EXPECTED_PROTOTYPE_WITNESS,async()=>{
  const s=subject(),t=sign();
  // Use an admitted same-realm ordinary record, as in the native ESM probe.
  const target=vm.runInContext('('+JSON.stringify(expected(claims))+')',s.context);
  let nightsReads=0,drift=0;
  const descriptors=[];
  const e=new Proxy(target,{getOwnPropertyDescriptor(input,key){
    const d=Object.getOwnPropertyDescriptor(input,key);
    descriptors.push(key);
    // Return the unchanged descriptor; only the final prototype guard can see this.
    if(key==='nights'&&++nightsReads===2){Object.setPrototypeOf(input,{});drift++;}
    return d;
  }});
  const r=await s.read(t,e);
  assert.equal(drift,1,'second-scan prototype attack ran exactly once');
  assert.equal(nightsReads,2,'exactly two nights descriptor reads');
  assert.deepEqual(descriptors,['packageId','checkIn','checkOut','nights','packageId','checkIn','checkOut','nights'],'attack is the final descriptor of scan two');
  // A deletion must reach authentic strict success once, not a setup/loader failure.
  if(r!=='DENIED'){
    success(r,t);
    assert.deepEqual([s.state.elevations,s.state.reads,s.state.clocks],[1,1,1],'closing-guard deletion admits authentic quote with one read');
  }
  assert.equal(r,'DENIED',FINAL_EXPECTED_PROTOTYPE_WITNESS);
  assert.deepEqual([s.state.elevations,s.state.reads,s.state.clocks],[0,0,0],'late expected prototype drift denies before elevation, secret IO and clock');
});
test('private snapshot frozen before IO structural witness',async()=>{const src=adapterSource();assert.match(src,/return freeze\(result\);/);assert.ok(src.indexOf('const frozenExpected = snapshot(expected);')<src.indexOf("await reader('WBE_PRICING_QUOTE_SECRET')"));});
test('secret response own enumerable bounded data only before clock',async()=>{let hooks=0;const record=v=>Object.assign(Object.create(null),{value:v});const bad=[undefined,null,KEY,{},Object.create({value:KEY}),Object.defineProperty(Object.create(null),'value',{get(){hooks++;return KEY;},enumerable:true}),Object.defineProperty(Object.create(null),'value',{value:KEY,enumerable:false}),record(''),record('x'.repeat(31)),record('x'.repeat(16385)),record(new String(KEY)),record({toString(){hooks++;return KEY;}}),record(123)];for(const value of bad){const s=subject();s.state.response=()=>value;assert.equal(await s.read(sign(),expected(claims)),'DENIED');assert.equal(s.state.reads,1);assert.equal(s.state.clocks,0);}assert.equal(hooks,0);});
test('secret observed descriptor prototype drift denies before clock',async()=>{for(const mode of ['value','writable','enumerable','configurable','prototype-first','prototype-last']){const s=subject();let count=0;s.state.response=()=>new Proxy(Object.assign(Object.create(null),{value:KEY}),{getOwnPropertyDescriptor(t,k){const d=Object.getOwnPropertyDescriptor(t,k);count++;if(mode==='prototype-first'&&count===1||mode==='prototype-last'&&count===2)Object.setPrototypeOf(t,{});if(count===2){if(mode==='value')d.value=KEY+'changed';else if(['writable','enumerable','configurable'].includes(mode))d[mode]=false;}return d;}});assert.equal(await s.read(sign(),expected(claims)),'DENIED',mode);assert.equal(s.state.clocks,0,mode);}});
// Additional regression witnesses exercise already-green behavior; no production changes.
for(const field of ['packageId','checkIn','checkOut','nights']){
  const alternate={packageId:'other-package',checkIn:'2026-12-31',checkOut:'2027-01-04',nights:3};
  for(const originalMatches of [true,false])test('snapshot causal '+field+' '+originalMatches,async()=>{
    const s=subject(),e=expected(claims),done=pending(s);
    const alt=expected(claims);if(field==='packageId')alt.packageId=alternate.packageId;else if(field==='checkIn'){alt.checkIn=alternate.checkIn;alt.nights=3;}else{alt.checkOut=alternate.checkOut;alt.nights=3;}
    if(!originalMatches)Object.assign(e,alt);
    const p=s.read(sign(),e);assert.equal(s.state.reads,1);Object.assign(e,originalMatches?alt:expected(claims));done();
    if(originalMatches)success(await p);else assert.equal(await p,'DENIED');
  });
  test('real signed coherent alternate '+field,async()=>{const c={...claims};if(field==='packageId')c.packageId=alternate.packageId;else if(field==='checkIn'){c.checkIn=alternate.checkIn;c.nights=3;}else{c.checkOut=alternate.checkOut;c.nights=3;}const s=subject();success(await s.read(sign(c),expected(c)),sign(c),c);});
}
for(const mode of ['delete','getter','prototype','revoke'])test('no postawait caller reads '+mode,async()=>{const s=subject();let hooks=0;const e=expected(claims),rev=Proxy.revocable(e,{}),done=pending(s);const p=s.read(sign(),mode==='revoke'?rev.proxy:e);if(mode==='delete')delete e.nights;if(mode==='getter')Object.defineProperty(e,'packageId',{get(){hooks++;throw Error('hook');}});if(mode==='prototype')Object.setPrototypeOf(e,{});if(mode==='revoke')rev.revoke();done();success(await p);assert.equal(hooks,0);});
for(const [label,now,pass]of [['issue-1',NOW-1,false],['issue',NOW,true],['expiry-1',NOW+3599999,true],['expiry',NOW+3600000,false],['expiry+1',NOW+3600001,false]])test('clock '+label,async()=>{const s=subject();s.state.now=now;const r=await s.read(sign(),expected(claims));if(pass)success(r);else assert.equal(r,'DENIED');assert.equal(s.state.clocks,1);});
test('pending expires before secret settles',async()=>{const s=subject(),done=pending(s);s.state.now=NOW+3599999;const p=s.read(sign(),expected(claims));assert.equal(s.state.clocks,0);s.state.now=NOW+3600000;done();assert.equal(await p,'DENIED');assert.equal(s.state.clocks,1);});
test('pending becomes issued before secret settles',async()=>{const s=subject(),done=pending(s);s.state.now=NOW-1;const p=s.read(sign(),expected(claims));assert.equal(s.state.clocks,0);s.state.now=NOW;done();success(await p);});
for(const [label,now]of [['negative',-1],['fraction',NOW+.5],['unsafe',Number.MAX_SAFE_INTEGER+1],['nan',NaN],['infinity',Infinity],['string',String(NOW)],['boxed',new Number(NOW)]])test('invalid clock '+label,async()=>{const s=subject();s.state.now=now;assert.equal(await s.read(sign(),expected(claims)),'DENIED');});
test('throwing clock denies',async()=>{const s=subject();s.state.clockError=Object.create(null);assert.equal(await s.read(sign(),expected(claims)),'DENIED');});
for(const length of [32,16384])test('secret valid bound '+length,async()=>{const key='x'.repeat(length),s=subject();s.state.response=()=>Object.assign(Object.create(null),{value:key});success(await s.read(sign(claims,key),expected(claims)),sign(claims,key));});
test('ordinary same realm DTO and response metadata ignored',async()=>{const s=subject();const e=vm.runInContext('('+JSON.stringify(expected(claims))+')',s.context);s.context.publicKey=KEY;const r=vm.runInContext('({value:publicKey,get metadata(){throw Error("metadata read");}})',s.context);s.state.response=()=>new Proxy(r,{ownKeys(){throw Error('metadata enumeration');}});success(await s.read(sign(),e));});
for(const mode of ['throw','reject','elevate-throw','elevate-nonfunction'])test('secret failure '+mode,async()=>{const s=subject();let hooks=0;const error=Object.defineProperties(Object.create(null),{message:{get(){hooks++;throw 0;}},toString:{value(){hooks++;throw 0;}}});if(mode==='throw')s.state.response=()=>{throw error;};if(mode==='reject')s.state.response=()=>Promise.reject(error);if(mode==='elevate-throw')s.state.elevationError=error;if(mode==='elevate-nonfunction')s.state.badElevation=true;assert.equal(await s.read(sign(),expected(claims)),'DENIED');assert.equal(s.state.reads,mode.startsWith('elevate')?0:1);assert.equal(s.state.clocks,0);assert.equal(hooks,0);});
test('no cache key rotation then failed read',async()=>{const s=subject(),b=KEY+'B';success(await s.read(sign(),expected(claims)));s.state.response=()=>Object.assign(Object.create(null),{value:b});const tb=sign(claims,b);success(await s.read(tb,expected(claims)),tb);assert.equal(await s.read(sign(),expected(claims)),'DENIED');s.state.response=()=>{throw Object.create(null);};assert.equal(await s.read(tb,expected(claims)),'DENIED');assert.equal(s.state.reads,4);});
test('concurrent reverse settlement isolates key expected clock',async()=>{const s=subject(),resolvers=[];s.state.response=()=>new Promise(r=>resolvers.push(r));const b=KEY+'B',c={...claims,packageId:'second'};const a=s.read(sign(),expected(claims)),d=s.read(sign(c,b),expected(c));assert.equal(s.state.reads,2);resolvers[1](Object.assign(Object.create(null),{value:b}));success(await d,sign(c,b),c);s.state.now=NOW+3600000;resolvers[0](Object.assign(Object.create(null),{value:KEY}));assert.equal(await a,'DENIED');});
test('never settled read remains pending not timeout denial',async()=>{const s=subject();s.state.response=()=>new Promise(()=>{});let settled=false;s.read(sign(),expected(claims)).then(()=>{settled=true;});await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.equal(s.state.reads,1);assert.equal(s.state.clocks,0);});
test('captured imports survive replacement',async()=>{const s=subject();s.secrets.getSecretValue=()=>{throw Error('replacement');};s.auth.elevate=()=>{throw Error('replacement');};vm.runInContext('Date.now=()=>0;',s.context);success(await s.read(sign(),expected(claims)));assert.equal(s.state.clocks,1);});
test('actual verifier rejects wrong key',async()=>{const s=subject();assert.equal(await s.read(sign(claims,KEY+'wrong'),expected(claims)),'DENIED');});
for(const [name,text]of [['duplicate',JSON.stringify(claims).replace('{','{"v":1,')],['unknown',JSON.stringify({...claims,unknown:1})],['numeric-string',JSON.stringify({...claims,totalPerPerson:'0'})],['invalid-utf8',Buffer.concat([Buffer.from('{"packageTitle":"'),Buffer.from([0xc0,0xaf]),Buffer.from('"}')])]])test('real signed invalid '+name,async()=>{const s=subject();assert.equal(await s.read(signText(text),expected(claims)),'DENIED');});
const token=sign(),[payload,signature]=token.split('.');
for(const [label,t]of [['tampered-payload',payload.slice(0,-1)+(payload.endsWith('A')?'B':'A')+'.'+signature],['sig-byte',payload+'.'+(signature[0]==='A'?'B':'A')+signature.slice(1)],['sig-short',payload+'.'+signature.slice(1)],['sig-long',token+'A'],['sig-padding',token+'='],['sig-noncanonical',token.slice(0,-1)+'B'],['sig-alphabet',token.slice(0,-1)+'+'],['payload-noncanonical','Zh.'+crypto.createHmac('sha256',KEY).update('Zh').digest('base64url')]])test('signature transport '+label,async()=>{const s=subject();assert.equal(await s.read(t,expected(claims)),'DENIED');});
test('supplied verified record cannot replace token',async()=>{const s=subject();const fake=Object.assign(Object.create(null),{purpose:'locked-pricing-quote',token:sign(),claims});assert.equal(await s.read(fake,expected(claims)),'DENIED');assert.equal(s.state.reads,0);});
test('async captured intrinsics and null prototype result assimilation',async()=>{
  const s=subject(),done=pending(s),t=sign(),p=s.read(t,expected(claims));
  vm.runInContext(`globalThis.saved=[];globalThis.thenCalls=0;const getDescriptor=Object.getOwnPropertyDescriptor;
    function poison(o,k,v){saved.push([o,k,getDescriptor(o,k)]);Object.defineProperty(o,k,{value:v,writable:true,configurable:true});}
    const fail=()=>{throw Error('poison');};
    poison(Object.prototype,'then',function(resolve){thenCalls++;resolve('REPLACED');});
    for(const k of ['packageId','claims','purpose','value']){saved.push([Object.prototype,k,Object.getOwnPropertyDescriptor(Object.prototype,k)]);Object.defineProperty(Object.prototype,k,{set:fail,configurable:true});}
    for(const [o,keys] of [[Object,['create','freeze','getOwnPropertyDescriptor','getPrototypeOf','is']],[Reflect,['apply','ownKeys']],[Number,['isSafeInteger','isFinite']],[Date,['now']],[RegExp.prototype,['exec']],[Object.prototype,['hasOwnProperty']]])for(const k of keys)poison(o,k,fail);
  `,s.context);
  try{done();success(await p,t);assert.equal(s.context.thenCalls,0);}finally{vm.runInContext(`for(let i=saved.length-1;i>=0;i--){const [o,k,d]=saved[i];if(d)Reflect.defineProperty(o,k,d);else delete o[k];}`,s.context);}
});
test('SDK thenable mutation cannot replace captured inputs',async()=>{const s=subject(),e=expected(claims);s.state.response=()=>({then(resolve){e.packageId='changed';vm.runInContext('Date.now=()=>0',s.context);resolve(Object.assign(Object.create(null),{value:KEY}));}});success(await s.read(sign(),e));});

// Two-file review v2: disconnected private preview ONLY, not runtime approval.
const financialReaderFile = 'velo/backend/guestBookingFinancialAuthority.js';
const financialReaderCanonicalLFSha256 = '809eba5ea270965c8566f3815b96599300535d23e2e3fcd2cf372d28fd076973';
const financialReaderImports = [
  "import wixData from 'wix-data';",
  "import { canonicalizeGuestBookingPurchaseInput } from 'backend/guestBookingPurchaseInput';",
  "import { readLockedPricingQuoteAuthority } from 'backend/lockedPricingQuoteAuthority';",
  "import { calculateGuestBookingFinancials } from 'backend/guestBookingFinancialCalculation';"
];
const financialReaderExport = 'export async function readGuestBookingFinancialPreview(purchaseInput) {';
function financialReferenceText(text) {
  return text.replace(/\\(?:\r\n|[\n\r\u2028\u2029])/g, '')
    .replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b, c) => {
      const n = parseInt(a || b || c, 16);
      return n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd';
    }).replace(/\\([^\r\n])/g, '$1');
}
function financialReaderAllowed(file, source) {
  const text = source.replace(/\r\n/g, '\n');
  if (file !== financialReaderFile)
    return !/guestBookingFinancialAuthority|readGuestBookingFinancialPreview/i.test(financialReferenceText(text));
  if (JSON.stringify(text.match(/^import .+;$/gm)) !== JSON.stringify(financialReaderImports)) return false;
  if (JSON.stringify(text.match(/^export .*$/gm)) !== JSON.stringify([financialReaderExport])) return false;
  let body = text;
  for (const declaration of financialReaderImports) body = body.replace(declaration, '');
  body = body.replace(financialReaderExport, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (/\b(?:import|export|require)\b|strictLockedPricingQuote/i.test(financialReferenceText(body))) return false;
  return require('node:crypto').createHash('sha256').update(text, 'utf8').digest('hex') === financialReaderCanonicalLFSha256;
}
let financialReaderMetatests;
function runFinancialReaderMetatests(gate) {
  const source = fs.readFileSync(path.join(__dirname, '..', financialReaderFile), 'utf8');
  const names = [];
  const accepted = (file, text) => {
    try { return gate(file, text) !== false; }
    catch (error) { if (error.code !== 'ERR_ASSERTION') throw error; return false; }
  };
  function probe(name, file, text, expected) {
    assert.equal(accepted(financialReaderFile, source), true, 'reader positive control before ' + name);
    assert.equal(accepted(file, text), expected, 'reader isolation ' + name);
    names.push(name);
  }
  probe('exact graph', financialReaderFile, source, true);
  probe('CRLF equivalent', financialReaderFile, source.replace(/\r?\n/g, '\r\n'), true);
  probe('unrelated inert', 'velo/backend/inert.js', 'export const inert = 1;', true);
  for (const file of ['velo/backend/other.js', 'velo/pages/page.js', 'velo/public/file.js',
    'velo/backend/reader.web.js', 'velo/backend/reader.jsw', 'velo/public/guestBookingFinancialAuthority.js',
    'velo/backend/nested/../guestBookingFinancialAuthority.js']) {
    probe('wrong path ' + file, file, source, false);
    for (const [name, text] of [
      ['static', "import { readGuestBookingFinancialPreview } from 'backend/guestBookingFinancialAuthority';"],
      ['binding alias', "import { readGuestBookingFinancialPreview as alias } from 'backend/guestBookingFinancialAuthority';"],
      ['namespace', "import * as alias from 'backend/guestBookingFinancialAuthority';"],
      ['relative alias', "import './nested/../guestBookingFinancialAuthority.js';"],
      ['dynamic', "import('backend/guestBookingFinancialAuthority');"],
      ['require', "require('backend/guestBookingFinancialAuthority');"],
      ['reexport', "export * from 'backend/guestBookingFinancialAuthority';"],
      ['named reexport', "export { readGuestBookingFinancialPreview } from 'backend/guestBookingFinancialAuthority';"],
      ['unicode', String.raw`import('backend/guestBookingFinancial\u0041uthority');`],
      ['hex', String.raw`require('backend/guestBookingFinancial\x41uthority');`],
      ['codepoint', String.raw`export * from 'backend/guestBookingFinancial\u{41}uthority';`],
      ['continuation', "import('backend/guestBookingFinancial\\\nAuthority');"]
    ]) probe(name + ' ' + file, file, text, false);
  }
  // Synthetic consumer text is data only: never import, require or evaluate it.
  const continuationCases = [];
  for (const [ending, terminator] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r'], ['LS', '\u2028'], ['PS', '\u2029']]) {
    for (const [form, wrap] of [
      ['static', spec => `import * as alias from '${spec}';`],
      ['dynamic', spec => `import('${spec}');`],
      ['require', spec => `require('${spec}');`],
      ['reexport', spec => `export * from '${spec}';`]
    ]) {
      const split = '\\' + terminator;
      continuationCases.push({ name: ending + ' ' + form, ending,
        text: wrap('backend/guestBookingFinancial' + split + 'Authority'),
        benign: wrap('backend/unrelated' + split + 'Utility') });
    }
  }
  const continuationFailures = [];
  for (const { name, text, benign } of continuationCases) {
    assert.equal(accepted(financialReaderFile, source), true, 'reader positive control before continuation ' + name);
    assert.equal(accepted('velo/backend/consumer.js', benign), true, 'benign continuation ' + name);
    names.push('benign continuation ' + name);
    if (accepted('velo/backend/consumer.js', text)) continuationFailures.push(name);
    names.push('prohibited continuation ' + name);
  }
  assert.deepEqual(continuationFailures, [], 'complete gate must reject every legal literal continuation');
  const changes = [
    ['body', source.replace('if(arguments.length!==1)', 'if(arguments.length!==2)')],
    ['extra import', source + "\nimport 'wix-data';"],
    ['direct strict', source + "\nimport { verifyStrictLockedPricingQuote } from 'backend/strictLockedPricingQuote';"],
    ['dynamic', source + "\nimport('wix-data');"],
    ['require', source + "\nrequire('wix-data');"],
    ['reexport', source + "\nexport * from 'wix-data';"],
    ['public method', source + '\nexport const endpoint = webMethod();'],
    ['renamed export', source.replace(financialReaderExport, financialReaderExport.replace('readGuestBookingFinancialPreview', 'other'))],
    ['whitespace', source + ' '], ['BOM', '\ufeff' + source], ['lone CR', source.replace(/\r?\n/g, '\r')]
  ];
  for (const declaration of financialReaderImports) {
    const spec = declaration.match(/'([^']+)'/)[1];
    changes.push(['missing ' + spec, source.replace(declaration, '')],
      ['aliased ' + spec, source.replace(spec, './nested/../' + spec)],
      ['escaped ' + spec, source.replace(spec, spec.replace(/.$/, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')))]);
  }
  changes.push(['binding alias', source.replace('{ readLockedPricingQuoteAuthority }', '{ readLockedPricingQuoteAuthority as alias }')]);
  for (const [name, text] of changes) {
    assert.notEqual(text, source, 'mutation reached ' + name);
    probe(name, financialReaderFile, text, false);
  }
  assert.equal(new Set(names).size, names.length);
  const causalWitnesses = [];
  for (const [name, file, text] of [
    ['incoming reader ban', 'velo/backend/consumer.js', "import { readGuestBookingFinancialPreview } from 'backend/guestBookingFinancialAuthority';"],
    ['changed reader body', financialReaderFile, source.replace('if(arguments.length!==1)', 'if(arguments.length!==2)')],
    ['direct reader strict edge', financialReaderFile, source + "\nimport { verifyStrictLockedPricingQuote } from 'backend/strictLockedPricingQuote';"]
  ]) {
    const witness = () => assert.equal(accepted(file, text), false, 'causal reader fence ' + name);
    witness();
    const intact = financialReaderAllowed;
    let failure, admitted;
    try {
      // One unique guard-bypass mutant, three witnesses; never a source mutant.
      financialReaderAllowed = () => true;
      admitted = accepted(file, text);
      try { witness(); } catch (error) { failure = error; }
    } finally { financialReaderAllowed = intact; }
    assert.equal(admitted, true, 'deleted fence reaches forbidden admission ' + name);
    assert.equal(failure && failure.code, 'ERR_ASSERTION', 'causal assertion required ' + name);
    assert.ok(failure.message.startsWith('causal reader fence ' + name), 'intended witness ' + name);
    witness();
    causalWitnesses.push(name);
  }
  // Revert only the decoder to its prior LF/CRLF behavior, never production.
  const legacyFinancialReferenceText = text => text.replace(/\\\r?\n/g, '')
    .replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b, c) => {
      const n = parseInt(a || b || c, 16);
      return n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd';
    }).replace(/\\([^\r\n])/g, '$1');
  const decoderCausalWitnesses = [];
  for (const { name, ending, text, benign } of continuationCases) {
    if (ending === 'LF' || ending === 'CRLF') continue;
    const witness = () => assert.equal(accepted('velo/backend/consumer.js', text), false, 'causal continuation decoder ' + name);
    witness();
    const intact = financialReferenceText;
    let failure, admitted;
    try {
      financialReferenceText = legacyFinancialReferenceText;
      assert.equal(accepted(financialReaderFile, source), true, 'legacy decoder exact reader ' + name);
      assert.equal(accepted('velo/backend/consumer.js', benign), true, 'legacy decoder benign ' + name);
      for (const control of continuationCases.filter(c => c.ending === 'LF' || c.ending === 'CRLF'))
        assert.equal(accepted('velo/backend/consumer.js', control.text), false, 'legacy decoder retains ' + control.name);
      admitted = accepted('velo/backend/consumer.js', text);
      try { witness(); } catch (error) { failure = error; }
    } finally { financialReferenceText = intact; }
    assert.equal(admitted, true, 'decoder reversion reaches forbidden admission ' + name);
    assert.equal(failure && failure.code, 'ERR_ASSERTION', 'decoder causal assertion required ' + name);
    assert.ok(failure.message.startsWith('causal continuation decoder ' + name), 'intended decoder witness ' + name);
    witness();
    decoderCausalWitnesses.push(name);
  }
  assert.equal(new Set(decoderCausalWitnesses).size, decoderCausalWitnesses.length);
  return { passed: true, cases: names.length, names, financialReaderCanonicalLFSha256, guardMutantsKilled: 1, causalWitnesses, continuationCases: continuationCases.length, decoderMutantsKilled: decoderCausalWitnesses.length ? 1 : 0, decoderCausalWitnesses };
}


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

function noImporter(file,source){
  const acquisition = acquisitionPrivateEdge(file, source);
  assert.notEqual(acquisition, false, 'pinned private acquisition only: ' + file);
  if (acquisition === true) return;
  const allocation = allocationPrivateEdge(file, source);
  assert.notEqual(allocation, false, 'pinned private allocation only: ' + file);
  if (allocation === true) return;
  const acceptance = acceptancePrivateEdge(file, source);
  assert.notEqual(acceptance, false, 'pinned private acceptance only: ' + file);
  if (acceptance === true) return;

  assert.ok(financialReaderAllowed(file, source), "pinned private reader only: " + file);
  if (file === financialReaderFile) return;
  // Decode JS string escapes before checking alternate bindings/path aliases.
  const decoded=source.replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,(_,a,b,c)=>String.fromCodePoint(parseInt(a||b||c,16)));
  assert.doesNotMatch(decoded,/lockedPricingQuoteAuthority/i,'adapter importer '+file);
}
function isolation(src=adapterSource()){
  assert.deepEqual(src.match(/^import .*;$/gm),["import { secrets } from 'wix-secrets-backend.v2';","import { elevate } from 'wix-auth';","import { verifyStrictLockedPricingQuote } from 'backend/strictLockedPricingQuote';"]);
  assert.deepEqual(src.match(/^export .*$/gm),['export async function readLockedPricingQuoteAuthority(token, expected) {']);
  assert.equal((src.match(/\bimport\b/g)||[]).length,3);assert.equal((src.match(/\bexport\b/g)||[]).length,1);
  assert.doesNotMatch(src,/\b(console|fetch|require|process|setTimeout|setInterval|Promise|wixData)\b/);
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(/\.(js|jsw)$/.test(file)&&path.resolve(file)!==adapterPath)noImporter(path.relative(root,file).split(path.sep).join('/'),fs.readFileSync(file,'utf8'));}}
  walk(path.join(root,'velo'));
}
test('exact acquisition private graph isolation',async()=>runAcquisitionIsolationMetatests(noImporter));
test('exact allocation private graph isolation',async()=>runAllocationIsolationMetatests(noImporter));
test('exact acceptance private graph isolation',async()=>runAcceptanceIsolationMetatests(noImporter));
test('exact private imports exports zero production importers',async()=>isolation());
test('pinned reader graph and no incoming reader consumers',async()=>{financialReaderMetatests=runFinancialReaderMetatests(noImporter);});
test('clock remains last synchronous verifier argument and return unchanged',async()=>{const src=adapterSource();assert.match(src,/return verify\(token, frozenExpected, key, apply\(clock, dateReceiver, \[\]\)\);/);});
// Coverage additions below test existing behavior, not new production slices.
test('caller supplied signing key cannot confer authority',async()=>{const s=subject(),attacker=KEY+'attacker';assert.equal(await s.read(sign(claims,attacker),expected(claims),attacker),'DENIED');assert.equal(s.state.reads,0);});
test('caller supplied time cannot renew expired quote',async()=>{const s=subject();s.state.now=claims.expiresAt;assert.equal(await s.read(sign(),expected(claims),NOW),'DENIED');assert.equal(s.state.reads,0);});
test('same token needs fresh read after successful read fails',async()=>{const s=subject(),t=sign();success(await s.read(t,expected(claims)));s.state.response=()=>{throw Object.create(null);};assert.equal(await s.read(t,expected(claims)),'DENIED');assert.equal(s.state.reads,2);});
test('no module initialization IO or clock',async()=>{const s=subject();assert.equal(s.state.reads,0);assert.equal(s.state.elevations,0);assert.equal(s.state.clocks,0);});
test('wrong low arity denies before IO',async()=>{const s=subject();assert.equal(await s.read(),'DENIED');assert.equal(await s.read(sign()),'DENIED');assert.equal(s.state.reads,0);});
test('valid JSON payload pad bits are still noncanonical',async()=>{
  let text=JSON.stringify(claims);while(Buffer.byteLength(text)%3===0)text+=' ';
  const canonical=Buffer.from(text).toString('base64url'),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const changed=canonical.slice(0,-1)+alphabet[alphabet.indexOf(canonical.slice(-1))+1];
  assert.deepEqual(Buffer.from(changed,'base64url'),Buffer.from(canonical,'base64url'),'same valid JSON bytes');
  const s=subject();success(await s.read(signText(text),expected(claims)),signText(text));
  const t=changed+'.'+crypto.createHmac('sha256',KEY).update(changed).digest('base64url');
  assert.equal(await s.read(t,expected(claims)),'DENIED','noncanonical payload with real matching HMAC');
});
test('full claim schema malformed UTF8 cannot use replacement decoding',async()=>{
  const c={...claims,packageTitle:'UTF8-MARKER'},[before,after]=JSON.stringify(c).split('UTF8-MARKER');
  const s=subject();success(await s.read(sign(c),expected(c)),sign(c),c);
  const bytes=Buffer.concat([Buffer.from(before),Buffer.from([0xc0,0xaf]),Buffer.from(after)]);
  assert.equal(await s.read(signText(bytes),expected(claims)),'DENIED','malformed UTF8 inside otherwise complete valid claims');
});
for(const [name,file,source]of [
  ['second backend','velo/backend/second.js',"import { readLockedPricingQuoteAuthority } from 'backend/lockedPricingQuoteAuthority';"],
  ['page','velo/pages/page.js',"import { readLockedPricingQuoteAuthority } from 'backend/lockedPricingQuoteAuthority';"],
  ['web','velo/backend/endpoint.web.js',"import { readLockedPricingQuoteAuthority } from 'backend/lockedPricingQuoteAuthority';"],
  ['reexport','velo/backend/other.js',"export * from 'backend/lockedPricingQuoteAuthority';"],
  ['binding alias','velo/backend/other.js',"import { readLockedPricingQuoteAuthority as other } from 'backend/lockedPricingQuoteAuthority';"],
  ['path alias','velo/backend/other.js',"import { readLockedPricingQuoteAuthority } from './nested/../lockedPricingQuoteAuthority.js';"],
  ['dynamic','velo/backend/other.js',"import('backend/lockedPricingQuoteAuthority');"],
  ['require','velo/backend/other.js',"require('backend/lockedPricingQuoteAuthority');"],
  ['escaped path','velo/backend/other.js',String.raw`import * as other from 'backend/lockedPricingQuote\u0041uthority';`]
])test('disconnected scanner rejects '+name,async()=>assert.throws(()=>noImporter(file,source),{code:'ERR_ASSERTION'}));
test('adapter allowlist rejects alternate binding and added dynamic edge',async()=>{
  assert.throws(()=>isolation(adapterSource().replace('{ verifyStrictLockedPricingQuote }','{ verifyStrictLockedPricingQuote as other }')),{code:'ERR_ASSERTION'});
  assert.throws(()=>isolation(adapterSource()+"\nimport('backend/strictLockedPricingQuote');"),{code:'ERR_ASSERTION'});
});

const VERIFY='return verify(token, frozenExpected, key, apply(clock, dateReceiver, []));';
const SNAPSHOT='const frozenExpected = snapshot(expected);\n    if (!frozenExpected) return \'DENIED\';';
const READ="const response = await reader('WBE_PRICING_QUOTE_SECRET');";
const mutations=[];
function mutant(name,witness,replacements,target='adapter',expectedAssertion){mutations.push({name,witness,replacements,target,expectedAssertion});}
mutant('omit closing expected prototype guard',FINAL_EXPECTED_PROTOTYPE_WITNESS,[[
  '  if (prototype(input) !== proto) return null;\n  return freeze(result);',
  '  return freeze(result);'
]],'adapter',FINAL_EXPECTED_PROTOTYPE_WITNESS);
mutant('bypass actual verifier','actual verifier rejects wrong key',[[VERIFY,"return freeze(create(null));"]]);
mutant('bypass real MAC comparison','actual verifier rejects wrong key',[["if (!call(equal, crypto, [signature, call(digest, hmac, [])])) return 'DENIED';",'/* MAC comparison omitted */']],'strict');
mutant('omit canonical base64url roundtrip','valid JSON payload pad bits are still noncanonical',[["return b64(bytes) === s ? bytes : null;","return bytes;"]],'strict');
mutant('lenient replacement UTF8 decoding','full claim schema malformed UTF8 cannot use replacement decoding',[["function utf8(bytes) {","function utf8(bytes) {\n  return call(toString, bytes, ['utf8']);"]],'strict');
mutant('accept supplied verified record','supplied verified record cannot replace token',[["if (arguments.length !== 2) return 'DENIED';","if (token && typeof token === 'object') return token;\n    if (arguments.length !== 2) return 'DENIED';"]]);
mutant('wrong secret name','documented response real HMAC preserved zero Unicode factors',[["reader('WBE_PRICING_QUOTE_SECRET')","reader('WRONG_PUBLIC_FIXTURE_NAME')"]]);
mutant('coerce boxed response value','secret response own enumerable bounded data only before clock',[["const value = d.value;\n  if (typeof value !== 'string'","const value = String(d.value);\n  if (typeof value !== 'string'"]]);
mutant('primitive secret response fallback','secret response own enumerable bounded data only before clock',[["function secretValue(response) {","function secretValue(response) {\n  if (typeof response === 'string') return response;"]]);
mutant('caller chosen signing key','caller supplied signing key cannot confer authority',[["if (arguments.length !== 2) return 'DENIED';",'/* extra key admitted */'],[VERIFY,'return verify(token, frozenExpected, arguments[2], apply(clock, dateReceiver, []));']]);
mutant('caller chosen time','caller supplied time cannot renew expired quote',[["if (arguments.length !== 2) return 'DENIED';",'/* extra time admitted */'],[VERIFY,'return verify(token, frozenExpected, key, arguments[2]);']]);
for(const field of ['packageId','checkIn','checkOut','nights'])mutant('reread expected field '+field,'snapshot causal '+field+' true',[[VERIFY,`return verify(token, Object.assign(create(null), frozenExpected, {${field}:expected.${field}}), key, apply(clock, dateReceiver, []));`]]);
mutant('snapshot only after await','snapshot preserves original across suspended read',[[SNAPSHOT,'/* snapshot moved below IO */'],[READ,READ+'\n    '+SNAPSHOT]]);
mutant('caller expected after await','snapshot preserves original across suspended read',[[VERIFY,'return verify(token, expected, key, apply(clock, dateReceiver, []));']]);
mutant('omit private snapshot freeze','private snapshot frozen before IO structural witness',[["return freeze(result);","return result;"]]);
mutant('clock before await','pending expires before secret settles',[[READ,'const early = apply(clock, dateReceiver, []);\n    '+READ],[VERIFY,'return verify(token, frozenExpected, key, early);']]);
mutant('clock sampled at module initialization','no module initialization IO or clock',[["const dateReceiver = Date;","const dateReceiver = Date;\nconst early = clock();"],[VERIFY,'return verify(token, frozenExpected, key, early);']]);
mutant('allow expiry equality','clock expiry',[["now < c.expiresAt","now <= c.expiresAt"]],'strict');
mutant('ordinary result wrapper','async captured intrinsics and null prototype result assimilation',[[VERIFY,'return {...verify(token, frozenExpected, key, apply(clock, dateReceiver, []))};']]);
mutant('cache successful key','no cache key rotation then failed read',[["const readSecret = secrets.getSecretValue;","let cached;\nconst readSecret = secrets.getSecretValue;"],["const key = secretValue(response);","const key = cached || (cached = secretValue(response));"]]);
mutant('cache secret promise','concurrent reverse settlement isolates key expected clock',[["const readSecret = secrets.getSecretValue;","let cached;\nconst readSecret = secrets.getSecretValue;"],[READ,"const response = await (cached || (cached = reader('WBE_PRICING_QUOTE_SECRET')));"]]);
mutant('cache successful result','same token needs fresh read after successful read fails',[["const readSecret = secrets.getSecretValue;","let cached;\nconst readSecret = secrets.getSecretValue;"],["if (arguments.length !== 2) return 'DENIED';","if (cached) return cached;\n    if (arguments.length !== 2) return 'DENIED';"],[VERIFY,'return (cached = verify(token, frozenExpected, key, apply(clock, dateReceiver, [])));']]);
mutant('read failure reuses last success','same token needs fresh read after successful read fails',[["const readSecret = secrets.getSecretValue;","let cached;\nconst readSecret = secrets.getSecretValue;"],[VERIFY,'return (cached = verify(token, frozenExpected, key, apply(clock, dateReceiver, [])));'],["} catch (_) { return 'DENIED'; }","} catch (_) { return cached || 'DENIED'; }"]]);
// Coherent stays make a single date/nights equality redundant with the others.
// These grouped dependency mutants remove matching without invalid-calendar masking.
for(const [name,condition,witness]of [
  ['omit package match',"expectedFields[i] !== 'packageId'",'snapshot causal packageId false'],
  ['omit coherent arrival and nights matches',"expectedFields[i] !== 'checkIn' && expectedFields[i] !== 'nights'",'snapshot causal checkIn false'],
  ['omit coherent departure and nights matches',"expectedFields[i] !== 'checkOut' && expectedFields[i] !== 'nights'",'snapshot causal checkOut false']
])mutant(name,witness,[["if (claims[expectedFields[i]] !== constraints.values[expectedFields[i]])",`if (${condition} && claims[expectedFields[i]] !== constraints.values[expectedFields[i]])`]],'strict');
async function runMutants(){
  const outcomes=[];
  for(const m of mutations){
    let source=fs.readFileSync(m.target==='strict'?strictPath:adapterPath,'utf8');
    for(const [before,after]of m.replacements){assert.equal(source.split(before).length-1,1,'unique mutation anchor '+m.name);source=source.replace(before,after);}
    const witness=tests.find(([name])=>name===m.witness);assert.ok(witness,'named witness '+m.name);
    if(m.target==='strict')activeStrict=source;else activeAdapter=source;
    let failure;
    try{
      // Compile/link independently first. A source/load failure is never a kill.
      subject();
      try{await witness[1]();}catch(e){failure=e;}
    }finally{activeAdapter=null;activeStrict=null;}
    assert.ok(failure,'SURVIVED '+m.name);
    assert.equal(failure.code,'ERR_ASSERTION','not a semantic assertion '+m.name);
    if(m.expectedAssertion)assert.ok(failure.message.startsWith(m.expectedAssertion+'\n'),'wrong named semantic assertion '+m.name);
    outcomes.push({...m,killed:true,error:{name:failure.name,code:failure.code,message:failure.message}});
    // Causal GREEN control: the identical witness must pass on untouched source.
    await witness[1]();
  }
  assert.equal(new Set(outcomes.map(x=>x.name)).size,outcomes.length);
  return outcomes;
}
function hashes(file){const raw=fs.readFileSync(file);return {raw:crypto.createHash('sha256').update(raw).digest('hex'),canonicalLF:crypto.createHash('sha256').update(raw.toString('utf8').replace(/\r\n/g,'\n')).digest('hex')};}
async function main(){assert.ok(fs.existsSync(adapterPath),'adapter module must exist');const names=[];for(const [name,fn]of tests){try{await fn();names.push(name);}catch(e){e.testName=name;throw e;}}assert.equal(new Set(names).size,names.length);const mutants=await runMutants();console.log(JSON.stringify({passed:true,cases:names.length,caseNames:names,mutantsKilled:mutants.length,mutants,hashes:{adapter:hashes(adapterPath),harness:hashes(__filename),strict:hashes(strictPath)},actualVerifier:true,actualCrypto:true,financialReaderMetatests},null,2));}
main().catch(e=>{console.error(e);process.exitCode=1;});
