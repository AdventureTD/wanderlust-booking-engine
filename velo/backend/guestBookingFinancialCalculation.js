import { canonicalizeGuestBookingPriceGroups } from 'backend/guestBookingPriceGroups';

// Pure numerical result only: factors are not pricing or purchase authority.
const round = Math.round;
const epsilon = Number.EPSILON;
const maximum = Number.MAX_SAFE_INTEGER;
function bounded(x) {
  if (!finite(x) || x < 0 || x > maximum) throw 0;
  return x === 0 ? 0 : x;
}
function dollars(x) { bounded(x); bounded(x * 100); return x === 0 ? 0 : x; }
function multiply(a, b) {
  const x = a * b;
  if (a !== 0 && b !== 0 && x === 0) throw 0;
  return dollars(x);
}
function add(a, b) { return dollars(a + b); }
function money(x) {
  dollars(x);
  const shifted = bounded(x + epsilon);
  const scaled = bounded(shifted * 100);
  const rounded = bounded(round(scaled));
  return dollars(rounded / 100);
}
function cents(x) {
  dollars(x);
  const scaled = bounded(x * 100), c = bounded(round(scaled));
  if (!integer(c) || c / 100 !== x) throw 0;
  return c === 0 ? 0 : c;
}
function sum(a, b) {
  if (!integer(a) || !integer(b) || a < 0 || b < 0 || a > maximum - b) throw 0;
  const result = a + b;
  if (!integer(result)) throw 0;
  return result === 0 ? 0 : result;
}
function reconcile(g) {
  if (sum(g.discountCents,g.roomTotalCents) !== g.grossCents ||
      sum(sum(sum(g.roomTotalCents,g.propertyFeeCents),g.accommodationVatCents),g.packageVatCents) !== g.grandTotalCents) throw 0;
}

const getPrototype = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const descriptor = Object.getOwnPropertyDescriptor;
const create = Object.create;
const freeze = Object.freeze;
const define = Object.defineProperty;
const same = Object.is;
const isArray = Array.isArray;
const integer = Number.isSafeInteger;
const finite = Number.isFinite;
const recordPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const factorKeys = ['v','nights','totalPerPerson','penthouseRoomFee','propertyFeeRate',
  'taxRateAccommodation','taxRateStandard','promoDiscountRate','priceGroups'];
const groupKeys = ['roomCode','quantity','guests'];
const componentKeys = ['grossCents','discountCents','roomTotalCents','propertyFeeCents',
  'accommodationVatCents','packageVatCents','grandTotalCents'];

// Only inert own data is inspected. Stable lying proxies / pre-import realm
// compromise are outside this DTO boundary; observable drift fails closed.
function snapshot(value, expected, journal) {
  if (value === null || typeof value !== 'object') throw 0;
  const proto = getPrototype(value);
  const array = expected === null;
  if (array ? !isArray(value) || proto !== arrayPrototype : proto !== recordPrototype && proto !== null) throw 0;
  const keys = ownKeys(value);
  if (array ? keys.length < 2 || keys.length > 5 : keys.length !== expected.length) throw 0;
  const values = create(null), descriptors = create(null);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    let admitted = false;
    if (array) admitted = key === (i === keys.length - 1 ? 'length' : '' + i);
    else for (let j = 0; j < expected.length; j++) if (key === expected[j]) admitted = true;
    if (!admitted) throw 0;
    const d = descriptor(value, key);
    if (!d || !descriptor(d,'value') || !descriptor(d,'writable')) throw 0;
    if (array && key === 'length') {
      if (d.enumerable !== false || d.configurable !== false || d.value !== keys.length - 1) throw 0;
    } else if (d.enumerable !== true) throw 0;
    values[key] = d.value;
    descriptors[key] = d;
  }
  const entry = create(null);
  entry.value = value; entry.proto = proto; entry.keys = keys; entry.descriptors = descriptors;
  journal[journal.length++] = entry;
  return values;
}
function stable(journal) {
  for (let i = 0; i < journal.length; i++) {
    const e = journal[i];
    if (getPrototype(e.value) !== e.proto) throw 0;
    const keys = ownKeys(e.value);
    if (keys.length !== e.keys.length) throw 0;
    for (let j = 0; j < keys.length; j++) {
      if (keys[j] !== e.keys[j]) throw 0;
      const d = descriptor(e.value, keys[j]), before = e.descriptors[keys[j]];
      if (!d || !descriptor(d,'value') || !descriptor(d,'writable') || !same(d.value,before.value) ||
          d.enumerable !== before.enumerable || d.configurable !== before.configurable || d.writable !== before.writable) throw 0;
    }
    if (getPrototype(e.value) !== e.proto) throw 0;
  }
}
function nonnegative(x) { return typeof x === 'number' && finite(x) && x >= 0; }
function record(values) {
  const result = create(null), keys = ownKeys(values);
  for (let i = 0; i < keys.length; i++) result[keys[i]] = values[keys[i]];
  return result;
}
function put(array, index, value) {
  define(array, index, record({value,writable:true,enumerable:true,configurable:true}));
}

export function calculateGuestBookingFinancials(factors) {
  try {
    if (arguments.length !== 1) return 'DENIED';
    const journal = create(null); journal.length = 0;
    const f = snapshot(factors, factorKeys, journal);
    const vector = snapshot(f.priceGroups, null, journal);
    const detached = [];
    let penthouse = false;
    for (let i = 0; i < vector.length; i++) {
      const g = snapshot(vector[i], groupKeys, journal);
      put(detached, i, g);
      if (g.roomCode === 'penthouse_apartment') penthouse = true;
    }
    f.priceGroups = detached;
    if (f.v !== 1 || !integer(f.nights) || f.nights < 1) return 'DENIED';
    for (let i = 2; i < factorKeys.length - 1; i++) {
      const key = factorKeys[i];
      if (key !== 'penthouseRoomFee' && !nonnegative(f[key])) return 'DENIED';
    }
    if (f.promoDiscountRate > 1 || (penthouse ? !nonnegative(f.penthouseRoomFee) : f.penthouseRoomFee !== null)) return 'DENIED';
    stable(journal);
    if (canonicalizeGuestBookingPriceGroups({priceGroups:detached}) === 'DENIED') return 'DENIED';
    const result = calculate(f);
    stable(journal);
    return result;
  } catch (_) { return 'DENIED'; }
}

function calculate(factors) {
  const groups = [];
  const totals = record({grossCents:0,discountCents:0,roomTotalCents:0,propertyFeeCents:0,
    accommodationVatCents:0,packageVatCents:0,grandTotalCents:0,totalVatCents:0,totalRooms:0,totalGuests:0});
  for (let index = 0; index < factors.priceGroups.length; index++) {
    const {roomCode, quantity:q, guests:g} = factors.priceGroups[index];
    const F = roomCode === 'penthouse_apartment' ? factors.penthouseRoomFee : 0;
    // Checked operations retain the source's left associativity and group boundary.
    const G = money(add(multiply(multiply(factors.totalPerPerson, g), q), multiply(multiply(F, factors.nights), q)));
    const N = money(multiply(G, (1 - factors.promoDiscountRate)));
    const D = money(G - N);
    const PF = money(multiply(N, factors.propertyFeeRate));
    const AV = money(multiply(multiply(N, 0.5), factors.taxRateAccommodation));
    const PV = money(multiply(multiply(N, (1 - 0.5)), factors.taxRateStandard));
    const T = money(add(add(add(N, PF), AV), PV));
    const group = record({index,roomCode,quantity:q,guests:g,grossCents:cents(G),discountCents:cents(D),
      roomTotalCents:cents(N),propertyFeeCents:cents(PF),accommodationVatCents:cents(AV),
      packageVatCents:cents(PV),grandTotalCents:cents(T)});
    reconcile(group);
    put(groups, index, freeze(group));
    for (let i = 0; i < componentKeys.length; i++) {
      const key = componentKeys[i];
      totals[key] = sum(totals[key], group[key]);
    }
    totals.totalRooms = sum(totals.totalRooms, q);
    totals.totalGuests = sum(totals.totalGuests, q * g);
  }
  totals.totalVatCents = sum(totals.accommodationVatCents, totals.packageVatCents);
  reconcile(totals);
  return freeze(record({v:1,currency:'USD',rounding:'original-group-backend-v1',groups:freeze(groups),totals:freeze(totals)}));
}
