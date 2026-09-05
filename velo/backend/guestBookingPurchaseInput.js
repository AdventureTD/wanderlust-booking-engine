// Disconnected input bytes only: no quote, consent or financial authority.
import { canonicalizeGuestBookingPriceGroups } from 'backend/guestBookingPriceGroups';
const codeAt = Function.prototype.call.bind(String.prototype.charCodeAt);
function unicode(s, multiline) {
  for (let i=0; i<s.length; i++) {
    const c=codeAt(s,i);
    if ((c<32 && !(multiline && (c===9 || c===10 || c===13))) || (c>=127 && c<=159) || (!multiline && (c===8232 || c===8233))) return false;
    if (c>=55296 && c<=56319) {
      if (++i>=s.length) return false;
      const low=codeAt(s,i); if (low<56320 || low>57343) return false;
    } else if (c>=56320 && c<=57343) return false;
  }
  return true;
}
function stringify(s) {
  let out='"';
  const hex='0123456789abcdef';
  for (let i=0;i<s.length;i++) {
    const c=codeAt(s,i);
    if (c===34) out+='\\"';
    else if (c===92) out+='\\\\';
    else if (c>=32 && c<=126) out+=s[i];
    else out+='\\u'+hex[(c>>>12)&15]+hex[(c>>>8)&15]+hex[(c>>>4)&15]+hex[c&15];
  }
  return out+'"';
}
const slice = Function.prototype.call.bind(String.prototype.slice);
const getPrototype = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const descriptor = Object.getOwnPropertyDescriptor;
const create = Object.create;
const recordPrototype = Object.prototype;
const fields = 'v checkIn checkOut packageId pricingQuoteToken promoCode guestName guestEmail guestPhone dialingCode note marketSource gclid gbraid wbraid msclkid priceGroups'.split(' ');
const arrayPrototype = Array.prototype;
const isArray = Array.isArray;
const same = Object.is;
const define = Object.defineProperty;
const groupFields = ['roomCode','quantity','guests'];
function snapshot(value, kind, journal) {
  if (value === null || typeof value !== 'object') return null;
  const proto = getPrototype(value), array = kind === 'array';
  if (array ? !isArray(value) || proto !== arrayPrototype : proto !== null && proto !== recordPrototype) return null;
  const keys = ownKeys(value), names = kind === 'outer' ? fields : groupFields;
  if (array ? keys.length<2 || keys.length>5 : keys.length !== names.length) return null;
  const a=create(null), descriptors=create(null);
  for (let i=0;i<keys.length;i++) {
    const key=array ? (i===keys.length-1 ? 'length' : ''+i) : names[i];
    if (array && keys[i]!==key) return null;
    const d=descriptor(value,key);
    if (!d || !descriptor(d,'value') || !descriptor(d,'writable')) return null;
    if (array && key==='length') {
      if (d.enumerable!==false || d.configurable!==false || d.value!==keys.length-1) return null;
    } else if (d.enumerable!==true) return null;
    if (kind==='outer' && (key==='v' ? d.value!==1 : key!=='priceGroups' && typeof d.value!=='string')) return null;
    a[key]=d.value; descriptors[key]=d;
  }
  if (getPrototype(value)!==proto) return null;
  journal[journal.length++]={value,proto,keys,descriptors};
  return a;
}
function stable(entry) {
  const {value,proto,keys,descriptors}=entry;
  if (getPrototype(value)!==proto) return false;
  const again=ownKeys(value);
  if (again.length!==keys.length) return false;
  for (let i=0;i<keys.length;i++) {
    if (again[i]!==keys[i]) return false;
    const d=descriptor(value,keys[i]), before=descriptors[keys[i]];
    if (!d || !descriptor(d,'value') || !descriptor(d,'writable') || !same(d.value,before.value) || d.writable!==before.writable || d.enumerable!==before.enumerable || d.configurable!==before.configurable) return false;
  }
  return getPrototype(value)===proto;
}
const exec = Function.prototype.call.bind(RegExp.prototype.exec);
function test(pattern, value) { return exec(pattern,value) !== null; }
const caps = [0,10,10,256,16384,256,256,320,32,8,8192,256,2048,2048,2048,2048];
const blank = /^[\u0009-\u000d \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/;
const floor = Math.floor;
function ordinal(s) {
  if (!test(/^[0-9]{4}-[0-9]{2}-[0-9]{2}(?![\s\S])/,s)) return null;
  const y=+slice(s,0,4), m=+slice(s,5,7), d=+slice(s,8,10);
  const leap=y%4===0 && (y%100!==0 || y%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (m<1 || m>12 || d<1 || d>days[m-1]) return null;
  // Days before this year; year zero is a leap year. No Date or night loop.
  let n=365*y+floor((y+3)/4)-floor((y+99)/100)+floor((y+399)/400)+d;
  for (let i=0;i<m-1;i++) n+=days[i];
  return n;
}
function scalars(a) {
  for (let i=1;i<fields.length-1;i++) if (a[fields[i]].length > caps[i]) return false;
  if (!a.guestName.length || test(blank,a.guestName) || !a.packageId.length || test(blank,a.packageId) || (a.promoCode.length && test(blank,a.promoCode))) return false;
  if (!a.guestEmail.length || !test(/@/,a.guestEmail)) return false;
  if (!test(/^\+?[0-9]+(?![\s\S])/,a.guestPhone) || !test(/^[0-9]*(?![\s\S])/,a.dialingCode)) return false;
  if (!test(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}(?![\s\S])/,a.pricingQuoteToken)) return false;
  const start=ordinal(a.checkIn), end=ordinal(a.checkOut);
  if (start === null || end === null || end<=start) return false;
  for (let i=1;i<fields.length-1;i++) if (!unicode(a[fields[i]],fields[i] === 'note')) return false;
  return true;
}
export function canonicalizeGuestBookingPurchaseInput(input) {
  try {
    const journal=create(null); journal.length=0;
    const a = snapshot(input,'outer',journal);
    if (!a || !scalars(a)) return 'DENIED';
    const original=snapshot(a.priceGroups,'array',journal);
    if (!original) return 'DENIED';
    const detached=[];
    for (let i=0;i<original.length;i++) {
      const g=snapshot(original[i],'group',journal);
      if (!g) return 'DENIED';
      const d=create(null); d.value=g; d.enumerable=true; d.writable=true; d.configurable=true;
      define(detached,''+i,d);
    }
    const groups = canonicalizeGuestBookingPriceGroups({priceGroups:detached});
    if (groups === 'DENIED') return 'DENIED';
    for (let i=0;i<journal.length;i++) if (!stable(journal[i])) return 'DENIED';
    const out = '["wbe.guest-purchase-input",1,' + stringify(a.checkIn)+','+stringify(a.checkOut)+','+stringify(a.packageId)+','+stringify(a.pricingQuoteToken)+','+stringify(a.promoCode)+',['+stringify(a.guestName)+','+stringify(a.guestEmail)+','+stringify(a.guestPhone)+','+stringify(a.dialingCode)+','+stringify(a.note)+','+stringify(a.marketSource)+'],['+stringify(a.gclid)+','+stringify(a.gbraid)+','+stringify(a.wbraid)+','+stringify(a.msclkid)+'],'+slice(groups,3,-1)+']';
    return out.length > 262144 ? 'DENIED' : out;
  } catch (_) { return 'DENIED'; }
}
