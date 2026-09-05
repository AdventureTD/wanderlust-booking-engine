import { secrets } from 'wix-secrets-backend.v2';
import { elevate } from 'wix-auth';
import { verifyStrictLockedPricingQuote } from 'backend/strictLockedPricingQuote';

const readSecret = secrets.getSecretValue;
const elevateSecret = elevate;
const verify = verifyStrictLockedPricingQuote;
const clock = Date.now;
const dateReceiver = Date;
const apply = Reflect.apply;
const exec = RegExp.prototype.exec;
const create = Object.create;
const descriptor = Object.getOwnPropertyDescriptor;
const ownKeys = Reflect.ownKeys;
const prototype = Object.getPrototypeOf;
const ordinary = Object.prototype;
const hasOwn = Object.prototype.hasOwnProperty;
const safeInteger = Number.isSafeInteger;
const same = Object.is;
function sameDescriptor(a, b) {
  return !!b && apply(hasOwn, b, ['value']) && same(a.value, b.value) &&
    a.enumerable === b.enumerable && a.writable === b.writable && a.configurable === b.configurable;
}
const freeze = Object.freeze;
const fields = freeze(['packageId', 'checkIn', 'checkOut', 'nights']);
function snapshot(input) {
  if (input === null || typeof input !== 'object') return null;
  const proto = prototype(input);
  if (proto !== null && proto !== ordinary) return null;
  const result = create(null);
  const descriptors = create(null);
  const keys = ownKeys(input);
  if (keys.length !== 4) return null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    let allowed = false;
    for (let j = 0; j < 4; j++) if (key === fields[j]) allowed = true;
    if (!allowed) return null;
    const d = descriptor(input, key);
    if (!d || !d.enumerable || !apply(hasOwn, d, ['value'])) return null;
    const value = d.value;
    if (key === 'nights') {
      if (!safeInteger(value) || value <= 0) return null;
    } else if (typeof value !== 'string') return null;
    else if (key === 'packageId') {
      if (value.length < 1 || value.length > 256) return null;
    } else if (value.length !== 10 || !apply(exec, /^[0-9]{4}-[0-9]{2}-[0-9]{2}/, [value])) return null;
    result[key] = value;
    descriptors[key] = d;
  }
  if (prototype(input) !== proto) return null;
  const afterKeys = ownKeys(input);
  if (afterKeys.length !== 4 || prototype(input) !== proto) return null;
  for (let i = 0; i < 4; i++) {
    const key = afterKeys[i];
    if (!apply(hasOwn, descriptors, [key]) || !sameDescriptor(descriptors[key], descriptor(input, key))) return null;
  }
  if (prototype(input) !== proto) return null;
  return freeze(result);
}

function secretValue(response) {
  if (response === null || typeof response !== 'object') return null;
  const proto = prototype(response);
  if (proto !== null && proto !== ordinary) return null;
  const d = descriptor(response, 'value');
  if (!d || !d.enumerable || !apply(hasOwn, d, ['value'])) return null;
  const value = d.value;
  if (typeof value !== 'string' || value.length < 32 || value.length > 16384) return null;
  if (prototype(response) !== proto || !sameDescriptor(d, descriptor(response, 'value')) || prototype(response) !== proto) return null;
  return value;
}

// Private and disconnected: a quote is not complete purchase authorization.
export async function readLockedPricingQuoteAuthority(token, expected) {
  try {
    if (arguments.length !== 2) return 'DENIED';
    if (typeof token !== 'string' || token.length < 1 || token.length > 16384) return 'DENIED';
    const transport = apply(exec, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}/, [token]);
    if (!transport || transport[0].length !== token.length) return 'DENIED';
    const frozenExpected = snapshot(expected);
    if (!frozenExpected) return 'DENIED';
    const reader = elevateSecret(readSecret);
    const response = await reader('WBE_PRICING_QUOTE_SECRET');
    const key = secretValue(response);
    if (key === null) return 'DENIED';
    return verify(token, frozenExpected, key, apply(clock, dateReceiver, []));
  } catch (_) { return 'DENIED'; }
}
