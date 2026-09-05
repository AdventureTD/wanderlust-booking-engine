'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const root = path.resolve(__dirname, '..');
const candidatePath = path.join(root, 'velo/backend/strictLockedPricingQuote.js');
const KEY = 'PUBLIC-ONLY-LOCKED-QUOTE-FIXTURE-KEY-0001';
const NOW = 1800000000000;
// PUBLIC fixture only. Fixed UTF-8 bytes and HMAC independently computed with
// Python json.dumps(ensure_ascii=False, separators=(',', ':')), base64.urlsafe_b64encode
// and hmac.new(KEY.encode('utf8'), payloadSegment.encode('utf8'), hashlib.sha256).
const GOLDEN = {
  "nonceHex": "000102030405060708090a0b",
  "payloadUtf8": "{\"v\":1,\"nonce\":\"000102030405060708090a0b\",\"issuedAt\":1800000000000,\"expiresAt\":1800003600000,\"checkIn\":\"2027-01-01\",\"checkOut\":\"2027-01-03\",\"nights\":2,\"packageId\":\"public-package\",\"packageTitle\":\"Public \u00e9 \ud83d\ude00 \\\"package\\\"\",\"baseRate\":123.4567,\"priceModifier\":1.125,\"totalPerPerson\":277.78}",
  "payloadHex": "7b2276223a312c226e6f6e6365223a22303030313032303330343035303630373038303930613062222c226973737565644174223a313830303030303030303030302c22657870697265734174223a313830303030333630303030302c22636865636b496e223a22323032372d30312d3031222c22636865636b4f7574223a22323032372d30312d3033222c226e6967687473223a322c227061636b6167654964223a227075626c69632d7061636b616765222c227061636b6167655469746c65223a225075626c696320c3a920f09f9880205c227061636b6167655c22222c226261736552617465223a3132332e343536372c2270726963654d6f646966696572223a312e3132352c22746f74616c506572506572736f6e223a3237372e37387d",
  "payloadSegment": "eyJ2IjoxLCJub25jZSI6IjAwMDEwMjAzMDQwNTA2MDcwODA5MGEwYiIsImlzc3VlZEF0IjoxODAwMDAwMDAwMDAwLCJleHBpcmVzQXQiOjE4MDAwMDM2MDAwMDAsImNoZWNrSW4iOiIyMDI3LTAxLTAxIiwiY2hlY2tPdXQiOiIyMDI3LTAxLTAzIiwibmlnaHRzIjoyLCJwYWNrYWdlSWQiOiJwdWJsaWMtcGFja2FnZSIsInBhY2thZ2VUaXRsZSI6IlB1YmxpYyDDqSDwn5iAIFwicGFja2FnZVwiIiwiYmFzZVJhdGUiOjEyMy40NTY3LCJwcmljZU1vZGlmaWVyIjoxLjEyNSwidG90YWxQZXJQZXJzb24iOjI3Ny43OH0",
  "macHex": "b0f19517b9136926d803882d5f39709b719371667150c1d290794694829d64b5",
  "signatureSegment": "sPGVF7kTaSbYA4gtXzlwm3GTcWZxUMHSkHlGlIKdZLU",
  "token": "eyJ2IjoxLCJub25jZSI6IjAwMDEwMjAzMDQwNTA2MDcwODA5MGEwYiIsImlzc3VlZEF0IjoxODAwMDAwMDAwMDAwLCJleHBpcmVzQXQiOjE4MDAwMDM2MDAwMDAsImNoZWNrSW4iOiIyMDI3LTAxLTAxIiwiY2hlY2tPdXQiOiIyMDI3LTAxLTAzIiwibmlnaHRzIjoyLCJwYWNrYWdlSWQiOiJwdWJsaWMtcGFja2FnZSIsInBhY2thZ2VUaXRsZSI6IlB1YmxpYyDDqSDwn5iAIFwicGFja2FnZVwiIiwiYmFzZVJhdGUiOjEyMy40NTY3LCJwcmljZU1vZGlmaWVyIjoxLjEyNSwidG90YWxQZXJQZXJzb24iOjI3Ny43OH0.sPGVF7kTaSbYA4gtXzlwm3GTcWZxUMHSkHlGlIKdZLU",
  "claims": {
    "v": 1,
    "nonce": "000102030405060708090a0b",
    "issuedAt": 1800000000000,
    "expiresAt": 1800003600000,
    "checkIn": "2027-01-01",
    "checkOut": "2027-01-03",
    "nights": 2,
    "packageId": "public-package",
    "packageTitle": "Public \u00e9 \ud83d\ude00 \"package\"",
    "baseRate": 123.4567,
    "priceModifier": 1.125,
    "totalPerPerson": 277.78
  }
};
let count = 0;
const caseNames = [];
function test(name, fn) {
  try { fn(); count++; caseNames.push(name); } catch (error) { error.testName = name; throw error; }
}
// Mutants alter only in-memory candidate source; each must fail a named semantic assertion.
const mutants = [
  ['skip-mac', [["if (!call(equal, crypto, [signature, call(digest, hmac, [])]))", 'if (false)']], 'signature byte 0'],
  ['omit-package-match', [['for (let i = 0; i < 4; i++) if (claims[expectedFields[i]]', 'for (let i = 1; i < 4; i++) if (claims[expectedFields[i]]']], 'match expected packageId'],
  ['expiry-inclusive', [['now < c.expiresAt', 'now <= c.expiresAt']], "trusted time 76"],
  ['skip-issued-at', [['c.issuedAt <= now &&', '']], "trusted time 75"],
  ['skip-lifetime', [['c.expiresAt - c.issuedAt === 3600000 &&', '']], "claim semantics 87"],
  ['skip-derived-nights', [['c.nights === co - ci', 'true']], "date and nights 126"],
  ['coerce-number', [['if (value === null || typeof value !== fieldType(key))', "if (fieldType(key) === 'number' && typeof value === 'string') { lexemes[key] = value; value = number(value); }\n    if (value === null || typeof value !== fieldType(key))"]], 'numeric string total'],
  ['allow-duplicates', [['count < 12', 'count < 13'], [' || claims[key] !== undefined', ''], ['count === 11 &&', 'count >= 11 &&']], "strict flat JSON 47"],
  ['skip-base64-roundtrip', [['return b64(bytes) === s ? bytes : null;', 'return bytes;']], 'signature nonzero pad bits'],
  ['replacement-utf8', [['const text = utf8(decoded);', "const text = call(toString, decoded, ['utf8']);"]], "malformed UTF8 69"],
  ['trim-title', [['claims[key] = value;', "claims[key] = key === 'packageTitle' ? value.trim() : value;"]], 'preserve title whitespace'],
  ['trim-key', [["[quoteSecret, 'utf8']", "[quoteSecret.trim(), 'utf8']"]], 'preserve private key whitespace'],
  ['trim-token', [["const constraints = snapshot(expected);", 'token = token.trim();\n    const constraints = snapshot(expected);']], "bad transport 3"],
  ['zero-default', [['result.claims = freeze(claims);', 'claims.totalPerPerson = claims.totalPerPerson || 1;\n    result.claims = freeze(claims);']], "valid financial and Unicode 105"],
  ['recalculate-total', [['result.claims = freeze(claims);', 'claims.totalPerPerson = claims.baseRate * claims.priceModifier * claims.nights;\n    result.claims = freeze(claims);']], 'actual issuer fractional Unicode immutable result'],
  ['canonical-json-only', [['const claims = parsed.claims;', "const claims = parsed.claims; if (JSON.stringify(claims) !== text) return 'DENIED';"]], 'alternate authenticated spelling'],
  ['sorted-keys-only', [['const claims = parsed.claims;', "const claims = parsed.claims; if (Object.keys(claims).join() !== Object.keys(claims).sort().join()) return 'DENIED';"]], 'actual issuer fractional Unicode immutable result'],
  ['ascii-title-only', [['c.packageTitle.length <= 4096', 'c.packageTitle.length <= 4096 && !/[^\\x00-\\x7f]/.test(c.packageTitle)']], 'actual issuer fractional Unicode immutable result'],
  ['cents-base-only', [['c.baseRate >= 0', 'c.baseRate >= 0 && safeInteger(c.baseRate * 100)']], 'actual issuer fractional Unicode immutable result'],
  ['mutable-result', [['return freeze(result);', 'return result;']], 'actual issuer fractional Unicode immutable result'],
  ['prototyped-result', [['const result = create(null);', 'const result = {};']], 'actual issuer fractional Unicode immutable result'],
  ['skip-final-prototype-check', [["if (prototype(input) !== proto) return null;", '']], 'final descriptor prototype drift'],
  ['skip-descriptor-stability', [["if (!stable(expected, constraints)) return 'DENIED';", '']], "hostile expected new Proxy({...fixture}, {getOwnPropertyDescriptor(t,k){const d=Object.getOwnPropertyDescriptor(t,k); if(k===\"packageId\") {this.n=(this.n||0)+1; if(this.n>1)d.writable=false;} return d;}})"]
];
function mutatedSource(name) {
  const mutant = mutants.find(m => m[0] === name);
  assert.ok(mutant, 'unknown mutant');
  let source = fs.readFileSync(candidatePath, 'utf8');
  for (const [before, after] of mutant[1]) {
    assert.equal(source.split(before).length, 2, 'unique mutation anchor ' + name);
    source = source.replace(before, after);
  }
  return source;
}
function load(file, mappings, extra = {}, source) {
  let text = source === undefined ? fs.readFileSync(path.join(root, file), 'utf8') : source;
  const names = [];
  text = text.replace(/^import (.+) from '([^']+)';$/gm, (line, binding, spec) => {
    assert.ok(Object.hasOwn(mappings, spec), 'unexpected import ' + spec);
    return binding.startsWith('{') ? `const ${binding} = imports[${JSON.stringify(spec)}];` : `const ${binding} = imports[${JSON.stringify(spec)}];`;
  });
  text = text.replace(/export (async )?function (\w+)/g, (_, a, n) => { names.push(n); return (a || '') + 'function ' + n; });
  assert.ok(!/\b(import|export)\s/.test(text), 'unmapped module syntax');
  const context = extra.__context || vm.createContext({ imports: mappings, Buffer, ...extra });
  context.imports = mappings;
  const exports = vm.runInContext('(function(){\n' + text + '\n;return {' + names.join(',') + '};})()', context, { filename: file });
  return { exports, context };
}
function candidate(source) {
  return load('velo/backend/strictLockedPricingQuote.js', { crypto, buffer: { Buffer } }, {}, source);
}
function expected(c) { return { packageId: c.packageId, checkIn: c.checkIn, checkOut: c.checkOut, nights: c.nights }; }
function inRealm(subject, e) { return vm.runInContext('(' + JSON.stringify(e) + ')', subject.context); }
function signText(text, key = KEY, domain = '') {
  const p = Buffer.from(text).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', key).update(domain + p, 'utf8').digest('base64url');
}
function sign(c) { return signText(JSON.stringify(c)); }
function success(subject, token, claims) {
  const e = subject.context ? inRealm(subject, expected(claims)) : expected(claims);
  const r = subject.exports.verifyStrictLockedPricingQuote(token, e, KEY, NOW);
  assert.notEqual(r, 'DENIED', 'authentic issuer quote must pass');
  assert.equal(r.token, token);
  assert.equal(r.purpose, 'locked-pricing-quote');
  assert.equal(Object.getPrototypeOf(r), null);
  assert.equal(Object.getPrototypeOf(r.claims), null);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.claims));
  assert.deepEqual({ ...r.claims }, { ...claims });
}
async function issuer(fixture, nonceHex) {
  const data = { query(collection) {
    assert.ok(['Packages', 'SeasonalRates', 'Bookings', 'BookingSummary'].includes(collection));
    const q = {};
    for (const method of ['eq', 'limit', 'hasSome', 'lt', 'gt']) q[method] = () => q;
    q.find = async () => ({ items: collection === 'Packages' ? [fixture.pkg] : collection === 'SeasonalRates' ? fixture.rules || [] : collection === 'Bookings' ? fixture.bookings || [] : [], hasNext: () => false });
    return q;
  } };
  const resolver = load('velo/backend/rateResolver.js', { 'wix-data': data, 'backend/settings.web': { getAllSettings: async () => fixture.settings || {} } }).exports;
  class Clock extends Date { static now() { return NOW; } }
  let nonceCalls = 0;
  const issuerCrypto = nonceHex === undefined ? crypto : { ...crypto, randomBytes(size) {
    assert.equal(size, 12); nonceCalls++;
    const bytes = Buffer.from(nonceHex, 'hex'); assert.equal(bytes.length, 12); return bytes;
  } };
  const old = load('velo/backend/pricingQuote.js', { crypto: issuerCrypto, 'wix-data': data, 'wix-secrets-backend': { getSecret: async name => { assert.equal(name, 'WBE_PRICING_QUOTE_SECRET'); return KEY; } }, 'backend/rateResolver': resolver }, { Date: Clock }).exports;
  const result = await old.createLockedPricingQuote('public-package', '2027-01-01', '2027-01-03');
  if (nonceHex !== undefined) assert.equal(nonceCalls, 1, 'actual issuer invoked public nonce fixture');
  const [p, mac] = result.token.split('.');
  assert.equal(mac, crypto.createHmac('sha256', KEY).update(p).digest('base64url'));
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url').toString('utf8')), JSON.parse(JSON.stringify(result.quote)));
  await old.verifyLockedPricingQuote(result.token, expected(result.quote));
  return result;
}
// Executed in a fresh native ESM subprocess. Only static harness code is serialized;
// candidate source is imported untranslated and crypto/buffer are actual built-ins.
async function nativeCoverage(source, c, KEY, NOW) {
  const moduleURL = suffix => 'data:text/javascript;base64,' + Buffer.from(source + suffix).toString('base64');
  const { verifyStrictLockedPricingQuote: verify } = await import(moduleURL(''));
  const names = [];
  function test(name, fn) { try { fn(); names.push('R2 native ' + name); } catch (error) { error.testName = 'R2 native ' + name; throw error; } }
  const expected = c => ({ packageId: c.packageId, checkIn: c.checkIn, checkOut: c.checkOut, nights: c.nights });
  const signed = p => p + '.' + crypto.createHmac('sha256', KEY).update(p, 'utf8').digest('base64url');
  const sign = text => signed(Buffer.from(text).toString('base64url'));
  const text = JSON.stringify(c), token = sign(text);
  const deny = (t, e = expected(c)) => assert.equal(verify(t, e, KEY, NOW), 'DENIED');
  function pass(t, claims = c) {
    const r = verify(t, expected(claims), KEY, NOW);
    assert.notEqual(r, 'DENIED'); assert.deepEqual({ ...r.claims }, claims);
    assert.equal(r.token, t); assert.equal(r.purpose, 'locked-pricing-quote');
    assert.equal(Object.getPrototypeOf(r), null); assert.equal(Object.getPrototypeOf(r.claims), null);
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.claims));
  }
  test('actual built-ins success', () => pass(token));
  test('authenticated payload unused pad bits', () => {
    let padded = text; while (Buffer.byteLength(padded) % 3 === 0) padded += ' ';
    const p = Buffer.from(padded).toString('base64url'), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const alias = p.slice(0, -1) + alphabet[alphabet.indexOf(p.at(-1)) + 1];
    assert.notEqual(alias, p); assert.deepEqual(Buffer.from(alias, 'base64url'), Buffer.from(p, 'base64url'));
    pass(signed(p)); deny(signed(alias));
  });
  test('payload altered without resign', () => {
    const [p, s] = token.split('.');
    const changed = Buffer.from(p, 'base64url').toString('utf8').replace('277.78', '277.79');
    assert.notEqual(changed, text);
    pass(sign(changed), { ...c, totalPerPerson: 277.79 });
    deny(Buffer.from(changed).toString('base64url') + '.' + s);
  });
  for (const ch of ['+', '/', '=', '\n', ' ', '\t', '\r']) for (const segment of [0, 1])
    test('forbidden ' + JSON.stringify(ch) + ' segment ' + segment, () => {
      const parts = token.split('.'); parts[segment] = parts[segment].slice(0, -1) + ch; deny(parts.join('.'));
    });
  for (const p of ['', 'A', 'AAAAA']) test('payload invalid length ' + p.length, () => deny(signed(p)));
  const titleText = JSON.stringify({ ...c, packageTitle: 'MARK' });
  const malformed = [
    ['array root', '[]'], ['null root', 'null'], ['boolean root', 'true'], ['number root', '42'], ['empty object', '{}'],
    ['prototype key', '{"__proto__":1,' + text.slice(1)], ['currency key', '{"currency":"USD",' + text.slice(1)],
    ['trailing comma', text.slice(0, -1) + ',}'], ['trailing junk', text + 'x'], ['comment', '/*x*/' + text],
    ...['01', '+1', '0x1', '1.', '1e'].map(n => ['number grammar ' + n, text.replace('"v":1', '"v":' + n)]),
    ['invalid escape', titleText.replace('MARK', 'bad\\x20')],
    ['literal newline', titleText.replace('MARK', 'bad\n')], ['literal NUL', titleText.replace('MARK', 'bad\0')],
    ['lone low surrogate', titleText.replace('MARK', 'bad\\uDFFF')],
    ['short unicode escape', titleText.replace('MARK', 'bad\\u123')],
    ['unterminated string', titleText.slice(0, titleText.indexOf('MARK')) + 'bad\\'],
    ['duplicate first', text.replace('"v":1,', '"v":1,"v":1,')], ['duplicate last', text.slice(0, -1) + ',"v":1}']
  ];
  for (const [name, bad] of malformed) test('signed malformed JSON ' + name, () => deny(sign(bad)));
  test('legal escaped title controls', () => { const v = { ...c, packageTitle: '\0\n\r\t\b\f' }; pass(sign(JSON.stringify(v)), v); });
  for (const size of [128, 129]) test('numeric lexical length ' + size, () => {
    const lexeme = '1.' + '0'.repeat(size - 2); assert.equal(lexeme.length, size); assert.equal(Number(lexeme), 1);
    const t = sign(text.replace('"v":1', '"v":' + lexeme)); size === 128 ? pass(t) : deny(t);
  });
  for (const size of [0, 1, 256, 257]) test('package bound ' + size, () => {
    const v = { ...c, packageId: 'x'.repeat(size) }, t = sign(JSON.stringify(v));
    size >= 1 && size <= 256 ? pass(t, v) : deny(t, expected(v));
  });
  for (const size of [0, 4096, 4097]) test('title bound ' + size, () => {
    const v = { ...c, packageTitle: 'x'.repeat(size) }, t = sign(JSON.stringify(v)); size <= 4096 ? pass(t, v) : deny(t);
  });
  test('next representable unsafe total', () => {
    const ceiling = Number.MAX_SAFE_INTEGER / 100, dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, ceiling); const bits = dv.getBigUint64(0); dv.setBigUint64(0, bits + 1n);
    const next = dv.getFloat64(0); assert.ok(next > ceiling);
    pass(sign(JSON.stringify({ ...c, totalPerPerson: ceiling })), { ...c, totalPerPerson: ceiling });
    deny(sign(JSON.stringify({ ...c, totalPerPerson: next })));
  });
  for (const [name, changes] of [
    ['checkIn', { checkIn: '2027-01-02', nights: 1 }],
    ['checkOut', { checkOut: '2027-01-04', nights: 3 }],
    ['shifted same nights', { checkIn: '2027-01-02', checkOut: '2027-01-04' }]
  ]) test('valid mismatched expected stay ' + name, () => {
    const v = { ...c, ...changes }; pass(sign(JSON.stringify(v)), v); deny(token, expected(v));
  });
  for (const phase of [1, 2]) test('Proxy intrinsic poison ' + (phase === 1 ? 'initial' : 'final'), () => {
    let hits = 0, attacks = 0, calls = 0; const old = Object.freeze;
    const poisoned = () => { calls++; throw new Error('public poison'); };
    const e = new Proxy(expected(c), { ownKeys(t) {
      if (++hits === phase) { attacks++; Object.freeze = poisoned; } return Reflect.ownKeys(t);
    } });
    let r; try { r = verify(token, e, KEY, NOW); } finally { Object.freeze = old; }
    assert.equal(Object.freeze, old); assert.equal(hits, 2); assert.equal(attacks, 1); assert.equal(calls, 0);
    assert.notEqual(r, 'DENIED'); assert.deepEqual({ ...r.claims }, c);
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.claims)); pass(token);
  });
  const oldEqual = crypto.timingSafeEqual, comparisons = [];
  crypto.timingSafeEqual = function(a, b) { comparisons.push([a.length, b.length]); return oldEqual(a, b); };
  let spy;
  try { spy = (await import(moduleURL('\n// public comparison spy'))).verifyStrictLockedPricingQuote; }
  finally { crypto.timingSafeEqual = oldEqual; }
  test('real timingSafeEqual length preguard delegation', () => {
    assert.equal(crypto.timingSafeEqual, oldEqual);
    for (const size of [0, 1, 31, 33, 34]) {
      const t = token.split('.')[0] + '.' + Buffer.alloc(size).toString('base64url');
      assert.equal(spy(t, expected(c), KEY, NOW), 'DENIED');
    }
    assert.equal(comparisons.length, 0);
    assert.notEqual(spy(token, expected(c), KEY, NOW), 'DENIED');
    const [p, s] = token.split('.'), b = Buffer.from(s, 'base64url'); b[0] ^= 1;
    assert.equal(spy(p + '.' + b.toString('base64url'), expected(c), KEY, NOW), 'DENIED');
    assert.deepEqual(comparisons, [[32, 32], [32, 32]]);
  });
  // Cause errors IN the real primitives, rather than throwing from a fake.
  // Instrumentation is confined to this fresh process and restored even on import failure.
  for (const method of ['createHmac', 'timingSafeEqual']) {
    const old = crypto[method]; let calls = 0, primitiveErrors = 0;
    crypto[method] = function(...args) {
      calls++;
      try { return method === 'createHmac' ? old('public-invalid-digest', args[1]) : old(args[0], Buffer.alloc(31)); }
      catch (error) { primitiveErrors++; throw error; }
    };
    let fail;
    try { fail = (await import(moduleURL('\n// public real primitive error ' + method))).verifyStrictLockedPricingQuote; }
    finally { crypto[method] = old; }
    test('caught real primitive error ' + method, () => {
      assert.equal(crypto[method], old); assert.equal(calls, 0);
      assert.equal(fail(token, expected(c), KEY, NOW), 'DENIED');
      assert.equal(calls, 1); assert.equal(primitiveErrors, 1); pass(token);
    });
  }
  assert.equal(new Set(names).size, names.length);
  return { passed: true, names, cases: names.length, nativeESM: true, actualBuiltins: true };
}
function runNativeCoverage(claims) {
  const { spawnSync } = require('child_process');
  const source = fs.readFileSync(candidatePath, 'utf8');
  const script = "import assert from 'node:assert/strict'; import crypto from 'crypto'; import { Buffer } from 'buffer';\n" +
    '(' + nativeCoverage.toString() + ')(' + [source, claims, KEY, NOW].map(v => JSON.stringify(v)).join(',') +
    ').then(r => console.log(JSON.stringify(r))).catch(e => { console.error(JSON.stringify({code:e.code,testName:e.testName,message:e.message,stack:e.stack})); process.exitCode=1; });';
  const child = spawnSync(process.execPath, ['--input-type=module'], { input: script, encoding: 'utf8', timeout: 30000 });
  assert.equal(child.error, undefined, 'native subprocess must not time out');
  assert.equal(child.status, 0, 'native subprocess failed: ' + child.stderr);
  assert.equal(child.stderr, '');
  const result = JSON.parse(child.stdout); assert.equal(result.passed, true);
  assert.equal(result.cases, result.names.length); assert.equal(new Set(result.names).size, result.cases);
  for (const name of result.names) { count++; caseNames.push(name); }
  return result;
}
async function main() {
  const subject = candidate(process.env.STRICT_QUOTE_MUTANT ? mutatedSource(process.env.STRICT_QUOTE_MUTANT) : undefined);
  const result = await issuer({ pkg: { _id: 'public-package', numberOfNights: 2, title: 'Public é 😀 "package"', baseRate: 123.4567, priceModifier: 1.125 } });
  assert.equal(result.quote.totalPerPerson, 277.78);
  test('actual issuer fractional Unicode immutable result', () => success(subject, result.token, result.quote));
  const c = { ...result.quote };
  const deny = (token, e = expected(c), key = KEY, now = NOW) => assert.equal(subject.exports.verifyStrictLockedPricingQuote(token, inRealm(subject, e), key, now), 'DENIED');
  test('noncanonical authenticated payload padding', () => {
    const p = result.token.split('.')[0] + '=';
    deny(p + '.' + crypto.createHmac('sha256', KEY).update(p).digest('base64url'));
  });
  for (const token of ['', result.token + '\n', result.token + '.', result.token.replace('.', '..'), 42, null, {}, result.token.split('.')[0] + '.A']) test('bad transport ' + count, () => deny(token));
  for (let i = 0; i < 32; i++) test('signature byte ' + i, () => {
    const [p, s] = result.token.split('.'); const b = Buffer.from(s, 'base64url'); b[i] ^= 1; deny(p + '.' + b.toString('base64url'));
  });
  test('wrong private key', () => deny(result.token, expected(c), KEY + 'x'));
  for (const key of [null, {}, 'short', 'x'.repeat(16385)]) test('key admission ' + count, () => deny(result.token, expected(c), key));
  for (const text of [JSON.stringify(c).replace('{', '{"v":1,'), JSON.stringify(c).replace('{', '{"\\u0076":1,'), JSON.stringify({ ...c, purpose: 'x' }), JSON.stringify({ ...c, packageTitle: '\ud800' }), JSON.stringify(c).replace('"v":1', '"v":true'), JSON.stringify(c).replace('"v":1', '"v":null'), JSON.stringify(c).replace('"v":1', '"v":[]'), JSON.stringify(c).replace('"v":1', '"v":{}'), JSON.stringify(c) + ' {}', '\ufeff' + JSON.stringify(c)]) test('strict flat JSON ' + count, () => deny(signText(text)));
  for (const field of Object.keys(c)) { const omitted = { ...c }; delete omitted[field]; test('missing ' + field, () => deny(sign(omitted))); }
  for (const bytes of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0x80], [0xe2, 0x82]]) test('malformed UTF8 ' + count, () => {
    const prefix = Buffer.from(JSON.stringify(c).replace(c.packageTitle.replaceAll('"', '\\"'), 'UNUSED'));
    const text = JSON.stringify({ ...c, packageTitle: 'MARK' });
    deny(signText(Buffer.concat([Buffer.from(text.split('MARK')[0]), Buffer.from(bytes), Buffer.from(text.split('MARK')[1])])));
  });
  test('alternate authenticated spelling', () => success(subject, signText(' \n' + JSON.stringify(c).replace('"v":1', '"\\u0076":1.0e0') + '\t'), c));
  for (const now of [NOW - 1, c.expiresAt, c.expiresAt + 1, -1, 1.5, '1800000000000', null, Number.MAX_SAFE_INTEGER + 1]) test('trusted time ' + count, () => deny(result.token, expected(c), KEY, now));
  for (const now of [NOW, c.expiresAt - 1]) test('time inclusive issue exclusive expiry ' + count, () => assert.notEqual(subject.exports.verifyStrictLockedPricingQuote(result.token, inRealm(subject, expected(c)), KEY, now), 'DENIED'));
  for (const changes of [{ v: 2 }, { nonce: 'A'.repeat(24) }, { expiresAt: c.expiresAt + 1 }, { expiresAt: c.expiresAt - 1 }, { issuedAt: NOW + 1, expiresAt: c.expiresAt + 1 }, { baseRate: -1 }, { priceModifier: 0 }, { priceModifier: -1 }, { totalPerPerson: -1 }, { totalPerPerson: Number.MAX_SAFE_INTEGER / 100 + 0.02 }, { packageTitle: 'x'.repeat(4097) }, { packageId: ' ' }, { packageId: 'x\n' }]) test('claim semantics ' + count, () => deny(sign({ ...c, ...changes })));
  for (const [field, lexeme] of [['issuedAt', '1800000000000.00001'], ['v', '1.00000000000000001'], ['nights', '2.00000000000000001'], ['baseRate', '1e-999'], ['priceModifier', '1e-999'], ['baseRate', '1e999'], ['v', '0'.repeat(129)]]) test('numeric lexeme ' + count, () => deny(signText(JSON.stringify(c).replace(JSON.stringify(field) + ':' + c[field], JSON.stringify(field) + ':' + lexeme))));
  for (const changes of [{ baseRate: 0, totalPerPerson: 0 }, { baseRate: 1e300, totalPerPerson: 0 }, { baseRate: 1e-7, priceModifier: 5e-324, totalPerPerson: 0 }, { totalPerPerson: Number.MAX_SAFE_INTEGER / 100 }, { packageTitle: '\ufffd\u0000é😀e\u0301' }]) test('valid financial and Unicode ' + count, () => { const value = { ...c, ...changes }; success(subject, sign(value), value); });
  for (const field of Object.keys(expected(c))) {
    const e = expected(c); delete e[field]; test('mandatory expected ' + field, () => deny(result.token, e));
    const changed = { ...expected(c), [field]: field === 'nights' ? 3 : 'other' }; test('match expected ' + field, () => deny(result.token, changed));
  }
  for (const e of [null, {}, { ...expected(c), extra: 1 }, { ...expected(c), nights: '2' }]) test('expected shape ' + count, () => deny(result.token, e));
  for (const changes of [{ checkIn: '2027-02-29', checkOut: '2027-03-03' }, { checkIn: '1900-02-29', checkOut: '1900-03-03' }, { checkIn: '2027-13-01' }, { checkOut: c.checkIn }, { nights: 3 }]) test('date and nights ' + count, () => { const v = { ...c, ...changes }; deny(sign(v), expected(v)); });
  for (const [ci, co, nights] of [['0000-02-28', '0000-03-01', 2], ['0099-12-31', '0100-01-01', 1], ['2000-02-28', '2000-03-01', 2], ['1900-02-28', '1900-03-01', 1], ['0000-01-01', '9999-12-31', 3652424]]) test('Gregorian independent ' + ci, () => { const v = { ...c, checkIn: ci, checkOut: co, nights }; success(subject, sign(v), v); });
  subject.context.fixture = expected(c);
  for (const expression of [
    'Object.assign(Object.create(null), fixture)',
    'Object.freeze({...fixture})'
  ]) test('inert expected ' + expression, () => assert.notEqual(subject.exports.verifyStrictLockedPricingQuote(result.token, vm.runInContext(expression, subject.context), KEY, NOW), 'DENIED'));
  subject.context.calls = 0;
  for (const expression of [
    'Object.defineProperty({...fixture}, "packageId", {get(){calls++; return fixture.packageId}})',
    'Object.assign(Object.create({}), fixture)',
    'Object.defineProperty({...fixture}, "extra", {value:1})',
    '({...fixture, [Symbol()]:1})',
    'new Proxy({...fixture}, {getOwnPropertyDescriptor(){throw 1}})',
    'new Proxy({...fixture}, {getOwnPropertyDescriptor(t,k){const d=Object.getOwnPropertyDescriptor(t,k); if(k==="packageId") {this.n=(this.n||0)+1; if(this.n>1)d.writable=false;} return d;}})'
  ]) test('hostile expected ' + expression, () => assert.equal(subject.exports.verifyStrictLockedPricingQuote(result.token, vm.runInContext(expression, subject.context), KEY, NOW), 'DENIED'));
  assert.equal(subject.context.calls, 0);
  const mutations = [
    ['Object.create', 'Object.freeze', 'Object.getPrototypeOf', 'Object.getOwnPropertyDescriptor', 'Object.is', 'Object.prototype.hasOwnProperty', 'Reflect.ownKeys', 'Reflect.apply', 'JSON.parse', 'Number.isSafeInteger', 'Number.isFinite', 'Math.round', 'Math.floor', 'String.prototype.slice', 'String.prototype.indexOf', 'String.prototype.charCodeAt', 'RegExp.prototype.exec', 'Function.prototype.call', 'Function.prototype.apply'],
    ['imports.crypto.createHmac', 'imports.crypto.timingSafeEqual', 'imports.crypto.Hmac.prototype.update', 'imports.crypto.Hmac.prototype.digest', 'Buffer.from', 'Buffer.prototype.toString', 'Buffer.prototype.base64Slice', 'Buffer.prototype.utf8Slice']
  ];
  for (const group of mutations) for (const target of group) test('captured ' + target, () => {
    const isolated = candidate(); const e = inRealm(isolated, expected(c));
    const restore = vm.runInContext(`(()=>{const old=${target};${target}=()=>{throw 77};return ()=>{${target}=old};})()`, isolated.context);
    let r; try { r = isolated.exports.verifyStrictLockedPricingQuote(result.token, e, KEY, NOW); } finally { restore(); }
    assert.notEqual(r, 'DENIED', 'captured ' + target);
  });
  test('no inherited then assimilation', () => {
    vm.runInContext('Object.prototype.then=function(){calls++}', subject.context);
    try { success(subject, result.token, c); assert.equal(subject.context.calls, 0); } finally { vm.runInContext('delete Object.prototype.then', subject.context); }
  });
  const fixtures = [
    { name: 'zero-empty-no-alias', pkg: { baseRate: 0, priceModifier: 0 }, total: 0, title: '', modifier: 1 },
    { name: 'actual-exponent', pkg: { baseRate: 1e-7, priceModifier: 1e-7, title: 'tiny' }, total: 0, title: 'tiny', modifier: 1e-7 },
    { name: 'seasonal', pkg: { baseRate: 999, priceModifier: 1.25, title: 'seasonal' }, rules: [{ start: '2027-01-01', end: '2027-01-02', nightlyRate: 17.123 }], total: 42.8, title: 'seasonal', modifier: 1.25 },
    { name: 'demand-rounded', pkg: { baseRate: 123.4567, priceModifier: 1.125, title: 'e\u0301 / \\ " 😀' }, settings: { demandPricing: 0, demandRoomQty: 4, demand50: 1.15, demand75: 1.333 }, bookings: [{ status: 'confirmed', quantity: 3, checkIn: '2027-01-01', checkOut: '2027-01-03' }], total: 370.28, title: 'e\u0301 / \\ " 😀', modifier: 1.125 }
  ];
  for (const f of fixtures) {
    const actual = await issuer({ ...f, pkg: { _id: 'public-package', numberOfNights: 2, ...f.pkg } });
    test('actual issuer ' + f.name, () => {
      assert.equal(actual.quote.totalPerPerson, f.total, 'public golden total ' + f.name);
      assert.equal(actual.quote.packageTitle, f.title); assert.equal(actual.quote.priceModifier, f.modifier);
      success(subject, actual.token, actual.quote);
      if (f.name === 'actual-exponent') assert.ok(Buffer.from(actual.token.split('.')[0], 'base64url').toString('utf8').includes('1e-7'));
    });
  }
  const policy = load('velo/backend/guestBookingAccessPolicy.js', {});
  const guest = load('velo/backend/guestBookingCredentials.js', { crypto, buffer: { Buffer }, 'backend/guestBookingAccessPolicy': policy.exports }, { __context: policy.context });
  const service = guest.exports.createGuestBookingCredentials(inRealm(guest, { audience: 'wgb:public-test', activeKid: 'test-a', keys: [{ kid: 'test-a', keyHex: '01'.repeat(32) }] }));
  assert.notEqual(service, 'DENIED');
  const guestToken = service.prepareBootstrap(inRealm(guest, { intentBinding: { v: 1, intentDigest: 'b'.repeat(64), quoteDigest: 'c'.repeat(64), quoteExpiresAtMs: NOW + 10000, roomQuantities: [1] }, nowMs: NOW }));
  assert.equal(typeof guestToken, 'string'); assert.notEqual(guestToken, 'DENIED');
  test('actual guest accepts its own credential', () => assert.notEqual(service.verifyCredential(inRealm(guest, { token: guestToken, command: 'resume', nowMs: NOW })), 'DENIED'));
  test('actual guest token denied by quote', () => deny(guestToken));
  test('quote denied by actual guest verifier', () => assert.equal(service.verifyCredential(inRealm(guest, { token: result.token, command: 'resume', nowMs: NOW })), 'DENIED'));
  test('same public key guest domain fails quote', () => deny(signText(JSON.stringify(c), KEY, 'WBE-GUEST-BOOKING-CREDENTIAL\0')));
  test('valid mismatched package', () => deny(result.token, { ...expected(c), packageId: 'another-package' }));
  test('numeric string total', () => deny(sign({ ...c, totalPerPerson: String(c.totalPerPerson) })));
  test('preserve title whitespace', () => { const v = { ...c, packageTitle: '  title  ' }; success(subject, sign(v), v); });
  test('preserve private key whitespace', () => {
    const key = ' ' + KEY + ' ';
    const token = signText(JSON.stringify(c), key);
    assert.notEqual(subject.exports.verifyStrictLockedPricingQuote(token, inRealm(subject, expected(c)), key, NOW), 'DENIED');
  });
  test('signature nonzero pad bits', () => {
    const [p, s] = result.token.split('.'); const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const alias = s.slice(0, -1) + alphabet[alphabet.indexOf(s.at(-1)) + 1];
    assert.deepEqual(Buffer.from(alias, 'base64url'), Buffer.from(s, 'base64url'));
    deny(p + '.' + alias);
  });
  for (const change of ['value', 'enumerable', 'configurable', 'prototype', 'keys']) test('observed drift ' + change, () => {
    subject.context.change = change;
    const e = vm.runInContext(`new Proxy({...fixture}, {
      getOwnPropertyDescriptor(t,k) {
        const d=Object.getOwnPropertyDescriptor(t,k);
        if(k==='packageId' && (this.n=(this.n||0)+1)>1) {
          if(change==='value') d.value='changed';
          if(change==='enumerable') d.enumerable=false;
          if(change==='configurable') d.configurable=false;
        }
        return d;
      },
      getPrototypeOf(t){return change==='prototype' && (this.p=(this.p||0)+1)>1 ? null : Object.getPrototypeOf(t)},
      ownKeys(t){return change==='keys' && (this.k=(this.k||0)+1)>1 ? ['packageId','checkIn','checkOut'] : Reflect.ownKeys(t)}
    })`, subject.context);
    assert.equal(subject.exports.verifyStrictLockedPricingQuote(result.token, e, KEY, NOW), 'DENIED');
  });
  test('final descriptor prototype drift', () => {
    const e = vm.runInContext(`new Proxy({...fixture}, {
      getOwnPropertyDescriptor(t,k) {
        const d=Object.getOwnPropertyDescriptor(t,k);
        if(k==='nights' && (this.n=(this.n||0)+1)===2) Object.setPrototypeOf(t, {});
        return d;
      }
    })`, subject.context);
    assert.equal(subject.exports.verifyStrictLockedPricingQuote(result.token, e, KEY, NOW), 'DENIED');
  });
  for (const field of Object.keys(c)) {
    for (const bad of [null, true, [], {}, typeof c[field] === 'number' ? String(c[field]) : 7])
      test('wrong claim type ' + field + ' ' + JSON.stringify(bad), () => deny(sign({ ...c, [field]: bad })));
  }
  test('authenticated alternate key order', () => {
    const reversed = Object.fromEntries(Object.entries(c).reverse()); success(subject, sign(reversed), c);
  });
  test('exact token bound', () => {
    const text = JSON.stringify(c);
    const token = signText(text + ' '.repeat(12255 - Buffer.byteLength(text)));
    assert.equal(token.length, 16384); success(subject, token, c);
    test('token bound plus one', () => { const oversized = token + 'A'; assert.equal(oversized.length, 16385); deny(oversized); });
    test('payload bound plus one', () => deny(signText(text + ' '.repeat(12289 - Buffer.byteLength(text)))));
  });
  for (const size of [32, 16384]) test('exact key bound ' + size, () => {
    const key = 'k'.repeat(size); const token = signText(JSON.stringify(c), key);
    assert.notEqual(subject.exports.verifyStrictLockedPricingQuote(token, inRealm(subject, expected(c)), key, NOW), 'DENIED');
  });
  test('isolated candidate contract', () => {
    const source = fs.readFileSync(candidatePath, 'utf8');
    assert.deepEqual(source.match(/^import .+;$/gm), ["import crypto from 'crypto';", "import { Buffer } from 'buffer';"]);
    assert.deepEqual(source.match(/export function \w+/g), ['export function verifyStrictLockedPricingQuote']);
    assert.ok(!/\b(?:Date|process|console|setTimeout|fetch|webMethod)\b|randomBytes|wix-/.test(source));
    function scan(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(file);
        else if (file !== candidatePath && /\.(?:js|jsw)$/.test(file))
          assert.ok(!fs.readFileSync(file, 'utf8').includes('strictLockedPricingQuote'), 'no production wiring: ' + file);
      }
    }
    scan(path.join(root, 'velo'));
  });
  for (const modifier of [-1, 'malformed', null]) {
    const actual = await issuer({ pkg: { _id: 'public-package', numberOfNights: 2, baseRate: 12.34, priceModifier: modifier } });
    test('actual issuer normalized modifier ' + modifier, () => {
      assert.equal(actual.quote.priceModifier, 1); assert.equal(actual.quote.totalPerPerson, 24.68);
      success(subject, actual.token, actual.quote);
    });
  }
  const overflow = await issuer({ pkg: { _id: 'public-package', numberOfNights: 2, baseRate: 1e308, priceModifier: 1 } });
  test('actual issuer overflow serializes null and denies', () => {
    assert.equal(overflow.quote.totalPerPerson, Infinity);
    assert.equal(JSON.parse(Buffer.from(overflow.token.split('.')[0], 'base64url').toString()).totalPerPerson, null);
    deny(overflow.token);
  });
  for (const target of ['String.fromCharCode', 'Number']) test('additional captured ' + target, () => {
    const isolated = candidate(); const e = inRealm(isolated, expected(c));
    const restore = vm.runInContext(`(()=>{const old=${target};${target}=()=>{throw 77};return ()=>{${target}=old};})()`, isolated.context);
    let value; try { value = isolated.exports.verifyStrictLockedPricingQuote(result.token, e, KEY, NOW); } finally { restore(); }
    assert.notEqual(value, 'DENIED');
  });
  // Append closure cases after the original suite to retain all pinned causal names.
  const goldenActual = await issuer({ pkg: { _id: 'public-package', numberOfNights: 2,
    title: 'Public é 😀 "package"', baseRate: 123.4567, priceModifier: 1.125 } }, GOLDEN.nonceHex);
  test('R1 actual issuer fixed public golden bytes and strict acceptance', () => {
    const [p, s] = goldenActual.token.split('.'), bytes = Buffer.from(p, 'base64url');
    assert.equal(bytes.toString('hex'), GOLDEN.payloadHex);
    assert.equal(bytes.toString('utf8'), GOLDEN.payloadUtf8);
    assert.equal(p, GOLDEN.payloadSegment); assert.equal(s, GOLDEN.signatureSegment);
    assert.equal(Buffer.from(s, 'base64url').toString('hex'), GOLDEN.macHex);
    assert.equal(crypto.createHmac('sha256', KEY).update(p, 'utf8').digest('hex'), GOLDEN.macHex);
    assert.equal(goldenActual.token, GOLDEN.token);
    assert.deepEqual({ ...goldenActual.quote }, GOLDEN.claims);
    success(subject, goldenActual.token, GOLDEN.claims);
  });
  const native = runNativeCoverage(GOLDEN.claims);
  const kills = [];
  if (!process.env.STRICT_QUOTE_MUTANT) {
    const { spawnSync } = require('child_process');
    for (const [name, , causal] of mutants) {
      const child = spawnSync(process.execPath, [__filename], { encoding: 'utf8', timeout: 30000, env: { ...process.env, STRICT_QUOTE_MUTANT: name } });
      let failure; try { failure = JSON.parse(child.stderr.trim()); } catch (_) { failure = {}; }
      assert.equal(child.error, undefined, 'no timeout credit: ' + name);
      assert.equal(child.status, 1, 'mutant survived: ' + name);
      assert.equal(failure.code, 'ERR_ASSERTION', 'semantic assertion required: ' + name + child.stderr);
      assert.equal(typeof failure.testName, 'string', 'named causal case required: ' + name);
      if (causal) assert.equal(failure.testName, causal, 'causal test for ' + name);
      kills.push({ name, sourceSha256: crypto.createHash('sha256').update(mutatedSource(name)).digest('hex'), replacements: mutants.find(m => m[0] === name)[1], ...failure });
    }
  }
  assert.equal(new Set(caseNames).size, count, 'distinct named test cases');
  assert.equal(new Set(kills.map(k => k.name)).size, kills.length, 'distinct named mutants');
  const hashes = {};
  for (const [name, file] of [['candidate', candidatePath], ['harness', __filename]]) {
    const bytes = fs.readFileSync(file);
    hashes[name] = { raw: crypto.createHash('sha256').update(bytes).digest('hex'),
      canonicalLF: crypto.createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g, '\n')).digest('hex') };
  }
  console.log(JSON.stringify({ passed: true, cases: count, caseNames, native, hashes, mutants: kills.length, kills }));
}
main().catch(error => { console.error(JSON.stringify({ code: error.code, testName: error.testName, message: error.message, stack: error.stack })); process.exitCode = 1; });
