// Pure ordered room-group bytes; not purchase, pricing or availability authority.
// Inert same-realm DTOs only; stable lying Proxies are outside this boundary.
const getPrototype = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const descriptor = Object.getOwnPropertyDescriptor;
const create = Object.create;
const same = Object.is;
const isArray = Array.isArray;
const integer = Number.isSafeInteger;
const recordPrototype = Object.prototype;
const arrayPrototype = Array.prototype;

function snapshot(value, kind, journal) {
  if (value === null || typeof value !== 'object') return null;
  const proto = getPrototype(value);
  if (kind === 'array' ? !isArray(value) || proto !== arrayPrototype : proto !== recordPrototype && proto !== null) return null;
  const keys = ownKeys(value);
  if (kind === 'array' ? keys.length < 2 || keys.length > 5 : keys.length !== (kind === 'outer' ? 1 : 3)) return null;
  const values = create(null);
  const descriptors = create(null);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (kind === 'array' ? key !== (i === keys.length - 1 ? 'length' : '' + i) : kind === 'outer' ? key !== 'priceGroups' : key !== 'roomCode' && key !== 'quantity' && key !== 'guests') return null;
    const d = descriptor(value, key);
    if (!d || !descriptor(d, 'value') || !descriptor(d, 'writable')) return null;
    if (kind === 'array' && key === 'length') {
      if (d.enumerable !== false || d.configurable !== false || d.value !== keys.length - 1) return null;
    } else if (d.enumerable !== true) return null;
    values[key] = d.value;
    descriptors[key] = d;
  }
  if (getPrototype(value) !== proto) return null;
  journal[journal.length++] = {value, proto, keys, descriptors};
  return values;
}

function stable(entry) {
  const {value, proto, keys, descriptors} = entry;
  if (getPrototype(value) !== proto) return false;
  const again = ownKeys(value);
  if (again.length !== keys.length) return false;
  for (let i = 0; i < keys.length; i++) {
    if (again[i] !== keys[i]) return false;
    const d = descriptor(value, keys[i]);
    const before = descriptors[keys[i]];
    if (!d || !descriptor(d, 'value') || !descriptor(d, 'writable') ||
        !same(d.value, before.value) || d.enumerable !== before.enumerable ||
        d.configurable !== before.configurable || d.writable !== before.writable) return false;
  }
  return getPrototype(value) === proto;
}

export function canonicalizeGuestBookingPriceGroups(input) {
  try {
    const journal = create(null);
    journal.length = 0;
    const outer = snapshot(input, 'outer', journal);
    if (!outer) return 'DENIED';
    const groups = snapshot(outer.priceGroups, 'array', journal);
    if (!groups) return 'DENIED';
    let text = '[1,[';
    let total = 0, suites = 0, penthouses = 0, bedrooms = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = snapshot(groups[i], 'group', journal);
      if (!g) return 'DENIED';
      if (!integer(g.quantity) || g.quantity < 1 || g.quantity > 4 ||
          !integer(g.guests)) return 'DENIED';
      if (g.roomCode === 'adventure_suite') {
        if (g.guests !== 2) return 'DENIED';
        suites += g.quantity;
      } else if (g.roomCode === 'penthouse_apartment') {
        if (g.guests !== 2) return 'DENIED';
        penthouses += g.quantity;
      } else if (g.roomCode === 'two_bedroom_apartment') {
        if (g.guests !== 3 && g.guests !== 4) return 'DENIED';
        bedrooms += g.quantity;
      } else return 'DENIED';
      total += g.quantity;
      if (total > 4 || suites > 3 || penthouses > 1 || bedrooms > 1) return 'DENIED';
      text += (i ? ',' : '') + '["' + g.roomCode + '",' + g.quantity + ',' + g.guests + ']';
    }
    for (let i = 0; i < journal.length; i++) if (!stable(journal[i])) return 'DENIED';
    return text + ']]';
  } catch (_) {
    return 'DENIED';
  }
}
