// Disconnected pure rules. Caller must supply verified authoritative minor units;
// this module does not price rooms, calculate rates, or authorize client amounts.
// IDs: pb1-<16..64 ASCII alphanumeric/underscore/hyphen operation>-r<1..5>.
// Largest remainder allocation: discount uses pre-discount weights; each fee/VAT
// uses net weights. Ties and output order use ascending lexical bookingRowId.
// Exact own enumerable data records (Object.prototype or null), ordinary dense
// arrays, and stable two-pass graph descriptors/prototypes only. No coercion.
const KEYS = ['rows', 'discountMinor', 'propertyFeeMinor', 'accommodationVatMinor', 'packageVatMinor'];
const ROW_KEYS = ['bookingRowId', 'preDiscountMinor'];
const MONEY_KEYS = ['preDiscountMinor', 'discountMinor', 'netMinor', 'propertyFeeMinor', 'accommodationVatMinor', 'packageVatMinor', 'totalMinor'];
const ownKeys = Reflect.ownKeys;
const descriptor = Object.getOwnPropertyDescriptor;
const prototype = Object.getPrototypeOf;
const define = Object.defineProperty;
const create = Object.create;
const freeze = Object.freeze;
const same = Object.is;
const isArray = Array.isArray;
const isSafe = Number.isSafeInteger;
const apply = Reflect.apply;
const exec = RegExp.prototype.exec;
const toBig = BigInt;
const toNumber = Number;
const toString = String;
const SafeError = Error;
const OBJECT_PROTO = Object.prototype;
const ARRAY_PROTO = Array.prototype;
const MAX = 9007199254740991n;
const ID = /^pb1-[A-Za-z0-9_-]{16,64}-r[1-5]$(?![\s\S])/;
function fail() { throw new SafeError('Invalid physical room invoice allocation'); }
function put(target, key, value) {
  define(target, key, { value, enumerable: true, configurable: true, writable: true });
}
function record() { return create(null); }
function append(array, value) { put(array, array.length, value); }
function amount(value) {
  if (typeof value !== 'number' || !isSafe(value) || value < 0 || same(value, -0)) fail();
  return toBig(value);
}
function snapshot(value, fields, array) {
  if (value === null || typeof value !== 'object') fail();
  const proto = prototype(value);
  if (array ? !isArray(value) || proto !== ARRAY_PROTO : isArray(value) || (proto !== null && proto !== OBJECT_PROTO)) fail();
  const keys = ownKeys(value);
  const descriptors = [];
  const values = record();
  if (!array && keys.length !== fields.length) fail();
  if (array && (keys.length < 2 || keys.length > 6)) fail();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (typeof key !== 'string') fail();
    if (array) {
      if (key !== (i === keys.length - 1 ? 'length' : toString(i))) fail();
    } else {
      let found = false;
      for (let j = 0; j < fields.length; j++) if (key === fields[j]) found = true;
      if (!found) fail();
    }
    const d = descriptor(value, key);
    if (!d || !descriptor(d, 'value') || d.enumerable !== (key !== 'length' || !array)) fail();
    if (array && key === 'length' && (d.value !== keys.length - 1 || d.configurable !== false)) fail();
    append(descriptors, d);
    put(values, key, d.value);
  }
  if (prototype(value) !== proto) fail();
  return { proto, keys, descriptors, values };
}
function graph(input) {
  const nodes = [];
  const top = snapshot(input, KEYS, false); append(nodes, top);
  const list = snapshot(top.values.rows, null, true); append(nodes, list);
  const rows = [];
  for (let i = 0; i < list.values.length; i++) {
    const row = snapshot(list.values[i], ROW_KEYS, false);
    append(nodes, row); append(rows, row.values);
  }
  return { nodes, values: top.values, rows };
}
function stable(a, b) {
  if (a.nodes.length !== b.nodes.length) fail();
  for (let n = 0; n < a.nodes.length; n++) {
    const x = a.nodes[n], y = b.nodes[n];
    if (x.proto !== y.proto || x.keys.length !== y.keys.length) fail();
    for (let i = 0; i < x.keys.length; i++) {
      const d = x.descriptors[i], e = y.descriptors[i];
      if (x.keys[i] !== y.keys[i] || !same(d.value, e.value) ||
          d.enumerable !== e.enumerable || d.writable !== e.writable || d.configurable !== e.configurable) fail();
    }
  }
}
function apportion(total, weights) {
  let denominator = 0n;
  for (let i = 0; i < weights.length; i++) denominator += weights[i];
  const shares = [], remainders = [];
  let left = total;
  for (let i = 0; i < weights.length; i++) {
    const product = total * weights[i];
    const share = denominator === 0n ? 0n : product / denominator;
    append(shares, share);
    append(remainders, denominator === 0n ? 0n : product % denominator);
    left -= share;
  }
  // At most rows-1 residual pennies. Strict > keeps the first lexical ID on ties.
  for (let penny = 0n; penny < left; penny++) {
    let winner = 0;
    for (let i = 1; i < weights.length; i++) if (remainders[i] > remainders[winner]) winner = i;
    put(shares, winner, shares[winner] + 1n);
    put(remainders, winner, -1n);
  }
  return shares;
}
export function allocatePhysicalRoomInvoiceAmounts(input) {
  try {
    const first = graph(input), second = graph(input);
    stable(first, second);
    const values = first.values, rows = first.rows;
    const discount = amount(values.discountMinor), fee = amount(values.propertyFeeMinor);
    const accommodation = amount(values.accommodationVatMinor), packages = amount(values.packageVatMinor);
    for (let i = 0; i < rows.length; i++) {
      if (typeof rows[i].bookingRowId !== 'string' || apply(exec, ID, [rows[i].bookingRowId]) === null) fail();
      amount(rows[i].preDiscountMinor);
      for (let j = 0; j < i; j++) if (rows[i].bookingRowId === rows[j].bookingRowId) fail();
    }
    // Bounded insertion sort avoids mutable Array prototype dispatch.
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]; let j = i;
      while (j > 0 && row.bookingRowId < rows[j - 1].bookingRowId) { put(rows, j, rows[j - 1]); j--; }
      put(rows, j, row);
    }
    let pre = 0n; const prices = [];
    for (let i = 0; i < rows.length; i++) { const price = toBig(rows[i].preDiscountMinor); pre += price; append(prices, price); }
    const net = pre - discount;
    const total = net + fee + accommodation + packages;
    if (pre > MAX || discount > pre || total > MAX || (net === 0n && (fee !== 0n || accommodation !== 0n || packages !== 0n))) fail();
    const discounts = apportion(discount, prices), nets = [];
    for (let i = 0; i < rows.length; i++) append(nets, prices[i] - discounts[i]);
    const fees = apportion(fee, nets), accommodations = apportion(accommodation, nets), packageAmounts = apportion(packages, nets);
    const outputRows = [];
    for (let i = 0; i < rows.length; i++) {
      const row = record(); put(row, 'bookingRowId', rows[i].bookingRowId);
      const amounts = [prices[i], discounts[i], nets[i], fees[i], accommodations[i], packageAmounts[i], nets[i] + fees[i] + accommodations[i] + packageAmounts[i]];
      for (let k = 0; k < MONEY_KEYS.length; k++) put(row, MONEY_KEYS[k], toNumber(amounts[k]));
      append(outputRows, freeze(row));
    }
    const totals = record(), amounts = [pre, discount, net, fee, accommodation, packages, total];
    for (let k = 0; k < MONEY_KEYS.length; k++) put(totals, MONEY_KEYS[k], toNumber(amounts[k]));
    const output = record(); put(output, 'rows', freeze(outputRows)); put(output, 'totals', freeze(totals));
    return freeze(output);
  } catch (_) { fail(); }
}
