import crypto from 'crypto';
import { Buffer } from 'buffer';

const create = Object.create;
const freeze = Object.freeze;
const parse = JSON.parse;
const from = Buffer.from;
const apply = Reflect.apply;
const toString = Buffer.prototype.toString;
const makeHmac = crypto.createHmac;
const equal = crypto.timingSafeEqual;
const update = crypto.Hmac.prototype.update;
const digest = crypto.Hmac.prototype.digest;
const stringSlice = String.prototype.slice;
const stringIndex = String.prototype.indexOf;
const stringReplace = String.prototype.replace;
const regexExec = RegExp.prototype.exec;
function slice(s, a, b) { return call(stringSlice, s, [a, b]); }
function index(s, q, start) { return call(stringIndex, s, [q, start]); }
function match(re, s) { return call(regexExec, re, [s]); }
function b64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += alphabet[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += alphabet[c & 63];
  }
  return out;
}
const char = String.fromCharCode;
function utf8(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++];
    let n, more, minimum;
    if (a < 128) { n = a; more = 0; minimum = 0; }
    else if (a >= 0xc2 && a <= 0xdf) { n = a & 31; more = 1; minimum = 0x80; }
    else if (a >= 0xe0 && a <= 0xef) { n = a & 15; more = 2; minimum = 0x800; }
    else if (a >= 0xf0 && a <= 0xf4) { n = a & 7; more = 3; minimum = 0x10000; }
    else return null;
    if (i + more > bytes.length) return null;
    for (let j = 0; j < more; j++) { const b = bytes[i++]; if (b < 0x80 || b > 0xbf) return null; n = n * 64 + (b & 63); }
    if (n < minimum || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
    if (n <= 0xffff) out += char(n);
    else { n -= 0x10000; out += char(0xd800 + (n >> 10), 0xdc00 + (n & 1023)); }
  }
  return out;
}
function decode(s) {
  if (!s.length || s.length % 4 === 1 || match(/[^A-Za-z0-9_-]/, s)) return null;
  let text = '';
  for (let i = 0; i < s.length; i++) text += s[i] === '-' ? '+' : s[i] === '_' ? '/' : s[i];
  while (text.length % 4) text += '=';
  const bytes = call(from, Buffer, [text, 'base64']);
  return b64(bytes) === s ? bytes : null;
}
function call(fn, receiver, args) { return apply(fn, receiver, args); }

const number = Number;
const finite = Number.isFinite;
const codeAt = String.prototype.charCodeAt;
const fields = freeze(['v', 'nonce', 'issuedAt', 'expiresAt', 'checkIn', 'checkOut', 'nights', 'packageId', 'packageTitle', 'baseRate', 'priceModifier', 'totalPerPerson']);
function unicode(s) {
  for (let i = 0; i < s.length; i++) {
    const n = call(codeAt, s, [i]);
    if (n >= 0xd800 && n <= 0xdbff) {
      if (++i >= s.length) return false;
      const low = call(codeAt, s, [i]);
      if (low < 0xdc00 || low > 0xdfff) return false;
    } else if (n >= 0xdc00 && n <= 0xdfff) return false;
  }
  return true;
}
function fieldType(key) {
  for (let i = 0; i < fields.length; i++) if (fields[i] === key) return i === 1 || (i >= 4 && i <= 5) || i === 7 || i === 8 ? 'string' : 'number';
  return '';
}
function flat(text) {
  let pos = 0;
  const claims = create(null);
  const lexemes = create(null);
  function ws() { while (text[pos] === ' ' || text[pos] === '\t' || text[pos] === '\r' || text[pos] === '\n') pos++; }
  function quoted() {
    const start = pos++;
    while (pos < text.length) {
      const ch = text[pos++];
      if (ch === '\\') { pos++; continue; }
      if (ch === '"') {
        const value = parse(slice(text, start, pos));
        return unicode(value) ? value : null;
      }
    }
    return null;
  }
  ws();
  if (text[pos++] !== '{') return null;
  for (let count = 0; count < 12; count++) {
    ws(); if (text[pos] !== '"') return null;
    const key = quoted();
    if (key === null || !fieldType(key) || claims[key] !== undefined) return null;
    ws(); if (text[pos++] !== ':') return null;
    ws();
    let value;
    if (text[pos] === '"') value = quoted();
    else {
      const start = pos;
      while (pos < text.length && text[pos] !== ',' && text[pos] !== '}' && text[pos] !== ' ' && text[pos] !== '\t' && text[pos] !== '\r' && text[pos] !== '\n') {
        if (pos - start >= 128 || text[pos] === '[' || text[pos] === '{') return null;
        pos++;
      }
      const lexeme = slice(text, start, pos);
      const m = match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/, lexeme);
      if (!m || m[0].length !== lexeme.length) return null;
      value = number(lexeme);
      if (!finite(value)) return null;
      lexemes[key] = lexeme;
    }
    if (value === null || typeof value !== fieldType(key)) return null;
    claims[key] = value;
    ws();
    const end = text[pos++];
    if (end === '}') { ws(); return count === 11 && pos === text.length ? { claims, lexemes } : null; }
    if (end !== ',') return null;
  }
  return null;
}

const safeInteger = Number.isSafeInteger;
const round = Math.round;
const maxSafe = Number.MAX_SAFE_INTEGER;
function exactInteger(s) {
  // Grammar already checked. Bound exponent work independently of its magnitude.
  const m = match(/^-?([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?/, s);
  const digits = m[1] + (m[2] || '');
  if (!match(/[1-9]/, digits)) return true;
  const shift = number(m[3] || '0') - (m[2] || '').length;
  if (shift < -digits.length || shift > 16) return false;
  if (shift < 0) for (let i = digits.length + shift; i < digits.length; i++) if (digits[i] !== '0') return false;
  // Once fractional digits are all zero, safeInteger proves exact representability.
  return safeInteger(number(s));
}
function packageId(s) {
  return typeof s === 'string' && s.length >= 1 && s.length <= 256 && unicode(s) &&
    !match(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/, s) &&
    !!match(/[^\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/, s);
}
function semantics(c, lexemes, now) {
  if (!safeInteger(now) || now < 0) return false;
  for (let i = 0; i < fields.length; i++) {
    const key = fields[i];
    if (fieldType(key) !== 'number') continue;
    const lexeme = lexemes[key];
    const mantissa = match(/^-?([0-9]+)(?:\.([0-9]+))?/, lexeme);
    if (c[key] === 0 && match(/[1-9]/, mantissa[1] + (mantissa[2] || ''))) return false;
    if ((key === 'v' || key === 'issuedAt' || key === 'expiresAt' || key === 'nights') && (!safeInteger(c[key]) || !exactInteger(lexeme))) return false;
  }
  return c.v === 1 && c.nonce.length === 24 && !match(/[^0-9a-f]/, c.nonce) &&
    c.issuedAt >= 0 && c.expiresAt > c.issuedAt && c.expiresAt - c.issuedAt === 3600000 &&
    c.issuedAt <= now && now < c.expiresAt && c.nights > 0 &&
    packageId(c.packageId) && c.packageTitle.length <= 4096 &&
    c.baseRate >= 0 && c.priceModifier > 0 && c.totalPerPerson >= 0 &&
    c.totalPerPerson <= maxSafe / 100 && safeInteger(round(c.totalPerPerson * 100));
}

const ownKeys = Reflect.ownKeys;
const descriptor = Object.getOwnPropertyDescriptor;
const prototype = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const hasOwn = Object.prototype.hasOwnProperty;
const same = Object.is;
const floor = Math.floor;
const expectedFields = freeze(['packageId', 'checkIn', 'checkOut', 'nights']);
function day(s) {
  if (typeof s !== 'string' || s.length !== 10 || !match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/, s)) return null;
  const year = number(slice(s, 0, 4));
  const month = number(slice(s, 5, 7));
  const date = number(slice(s, 8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || date < 1 || date > lengths[month - 1]) return null;
  // March-based Gregorian era algorithm, including astronomical year zero.
  const y = year - (month <= 2 ? 1 : 0);
  const era = floor(y / 400);
  const yoe = y - era * 400;
  const mp = month + (month > 2 ? -3 : 9);
  return era * 146097 + yoe * 365 + floor(yoe / 4) - floor(yoe / 100) + floor((153 * mp + 2) / 5) + date - 1;
}
function stay(c) {
  const ci = day(c.checkIn);
  const co = day(c.checkOut);
  return ci !== null && co !== null && co > ci && safeInteger(c.nights) && c.nights === co - ci;
}
function snapshot(input) {
  if (input === null || typeof input !== 'object') return null;
  const proto = prototype(input);
  if (proto !== null && proto !== objectPrototype) return null;
  const keys = ownKeys(input);
  if (keys.length !== 4) return null;
  const values = create(null);
  const descriptors = create(null);
  for (let i = 0; i < 4; i++) {
    const key = keys[i];
    let allowed = false;
    for (let j = 0; j < 4; j++) if (key === expectedFields[j]) allowed = true;
    if (!allowed) return null;
    const d = descriptor(input, key);
    if (!d || !d.enumerable || !call(hasOwn, d, ['value'])) return null;
    if (typeof d.value !== (key === 'nights' ? 'number' : 'string')) return null;
    values[key] = d.value;
    descriptors[key] = d;
  }
  // Close the scan: the final descriptor trap may have changed the prototype.
  if (prototype(input) !== proto) return null;
  return packageId(values.packageId) && stay(values) ? { proto, values, descriptors } : null;
}
function stable(input, before) {
  const after = snapshot(input);
  if (!after || after.proto !== before.proto) return false;
  for (let i = 0; i < 4; i++) {
    const key = expectedFields[i];
    const a = before.descriptors[key];
    const b = after.descriptors[key];
    if (!same(a.value, b.value) || a.writable !== b.writable || a.enumerable !== b.enumerable || a.configurable !== b.configurable) return false;
  }
  return true;
}

// Disconnected cryptographic reader. Key and clock must be backend-private.
export function verifyStrictLockedPricingQuote(token, expected, quoteSecret, nowMs) {
  try {
    if (typeof token !== 'string' || token.length < 1 || token.length > 16384 || typeof quoteSecret !== 'string' || quoteSecret.length < 32 || quoteSecret.length > 16384) return 'DENIED';
    const constraints = snapshot(expected);
    if (!constraints) return 'DENIED';
    const dot = index(token, '.');
    if (dot < 1 || index(token, '.', dot + 1) !== -1) return 'DENIED';
    const encoded = slice(token, 0, dot);
    const sig = slice(token, dot + 1);
    if (sig.length !== 43) return 'DENIED';
    const signature = decode(sig);
    const decoded = decode(encoded);
    if (!signature || signature.length !== 32 || !decoded || decoded.length < 1 || decoded.length > 12288) return 'DENIED';
    const hmac = call(makeHmac, crypto, ['sha256', call(from, Buffer, [quoteSecret, 'utf8'])]);
    call(update, hmac, [call(from, Buffer, [encoded, 'utf8'])]);
    if (!call(equal, crypto, [signature, call(digest, hmac, [])])) return 'DENIED';
    const text = utf8(decoded);
    if (text === null) return 'DENIED';
    const parsed = flat(text);
    if (!parsed) return 'DENIED';
    const claims = parsed.claims;
    if (!semantics(claims, parsed.lexemes, nowMs) || !stay(claims)) return 'DENIED';
    for (let i = 0; i < 4; i++) if (claims[expectedFields[i]] !== constraints.values[expectedFields[i]]) return 'DENIED';
    if (!stable(expected, constraints)) return 'DENIED';
    const result = create(null);
    result.purpose = 'locked-pricing-quote';
    result.token = token;
    result.claims = freeze(claims);
    return freeze(result);
  } catch (_) { return 'DENIED'; }
}
