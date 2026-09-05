// Disconnected predicates, not authentication or authority to execute effects.
// Trusted module-load realm and upstream inert private DTOs are mandatory.
// Reflection stability is observable only; stable lying Proxies are not detectable.
const ownKeys = Reflect.ownKeys;
const proto = Object.getPrototypeOf;
const descriptor = Object.getOwnPropertyDescriptor;
const create = Object.create;
const define = Object.defineProperty;
const ordinary = Object.prototype;
const has = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
const same = Object.is;
const safeInteger = Number.isSafeInteger;
const regexExec = Function.prototype.call.bind(RegExp.prototype.exec);
function test(pattern, value) { return regexExec(pattern,value)!==null; }
const claimsKeys = ['v','purpose','audience','intentId','intentDigest','quoteDigest','issuedAtMs','expiresAtMs'];
const checkKeys = ['claims','command','expectedAudience','nowMs'];
function put(object, key, value) {
  const d = create(null);
  d.value = value; d.enumerable = true; d.writable = true; d.configurable = true;
  define(object, key, d);
}
function record(value, keys, observations) {
  if (value === null || typeof value !== 'object') return null;
  const p = proto(value);
  if (p !== null && p !== ordinary) return null;
  const actual = ownKeys(value);
  if (actual.length !== keys.length) return null;
  const out = create(null);
  const ds = create(null);
  for (let i=0;i<keys.length;i++) {
    const key = keys[i];
    const d = descriptor(value,key);
    if (!d || !has(d,'value') || d.enumerable !== true) return null;
    put(out,key,d.value); put(ds,key,d);
  }
  // Exact count plus every required descriptor rules out extra/symbol keys.
  const o = create(null);
  o.value=value; o.p=p; o.keys=actual; o.ds=ds;
  put(observations,observations.length,o); observations.length++;
  return out;
}
function stable(observations) {
  for(let i=0;i<observations.length;i++) {
    const o=observations[i];
    if(proto(o.value)!==o.p) return false;
    const keys=ownKeys(o.value);
    if(keys.length!==o.keys.length) return false;
    for(let j=0;j<keys.length;j++) {
      const key=keys[j];
      if(key!==o.keys[j]) return false;
      const before=o.ds[key], after=descriptor(o.value,key);
      if(!before || !after || !has(after,'value') || !same(before.value,after.value) || before.enumerable!==after.enumerable || before.configurable!==after.configurable || before.writable!==after.writable) return false;
    }
  }
  return true;
}
function observations() { const o=create(null); o.length=0; return o; }
function time(n) { return typeof n==='number' && safeInteger(n) && n>=0 && !same(n,-0); }
function hex(s) { return typeof s==='string' && s.length===64 && !test(/[^0-9a-f]/,s); }
function audience(s) { return typeof s==='string' && s.length>=1 && s.length<=128 && test(/^[A-Za-z0-9]/,s) && !test(/[^A-Za-z0-9._:-]/,s); }
function lifetime(c) { return time(c.issuedAtMs) && time(c.expiresAtMs) && c.issuedAtMs<c.expiresAtMs && c.expiresAtMs-c.issuedAtMs<=3600000; }
function eligible(a,c) {
  return c && c.v===1 && (a.command==='bootstrap'||a.command==='resume'||a.command==='status') && (c.purpose==='guest-bootstrap'||c.purpose==='guest-access'&&a.command!=='bootstrap') && audience(c.audience) && audience(a.expectedAudience) && c.audience===a.expectedAudience && hex(c.intentId) && hex(c.intentDigest) && hex(c.quoteDigest) && time(a.nowMs) && lifetime(c) && c.issuedAtMs<=a.nowMs && a.nowMs<c.expiresAtMs;
}
const arrayProto = Array.prototype;
const isArray = Array.isArray;
const bindingKeys = ['v','intentDigest','quoteDigest','quoteExpiresAtMs','roomQuantities'];
const admissionKeys = ['claims','command','expectedAudience','nowMs','intentBinding','acceptedContext'];
function quantities(value, obs) {
  if (!isArray(value) || proto(value)!==arrayProto) return null;
  const ld=descriptor(value,'length');
  if(!ld || !has(ld,'value') || !safeInteger(ld.value) || ld.value<1 || ld.value>4 || ld.enumerable!==false || ld.configurable!==false) return null;
  const keys=ownKeys(value);
  if(keys.length!==ld.value+1) return null;
  const out=create(null), ds=create(null);
  out.length=ld.value; put(ds,'length',ld);
  let sum=0;
  for(let i=0;i<out.length;i++) {
    const d=descriptor(value,i);
    if(!d || !has(d,'value') || d.enumerable!==true || typeof d.value!=='number' || !safeInteger(d.value) || d.value<1 || d.value>4) return null;
    put(out,i,d.value); put(ds,i,d); sum+=d.value;
  }
  if(sum>4) return null;
  const o=create(null); o.value=value;o.p=arrayProto;o.keys=keys;o.ds=ds;
  put(obs,obs.length,o);obs.length++;
  return out;
}
function binding(value,obs) {
  const b=record(value,bindingKeys,obs);
  if(!b || b.v!==1 || !hex(b.intentDigest) || !hex(b.quoteDigest) || !time(b.quoteExpiresAtMs)) return null;
  const q=quantities(b.roomQuantities,obs);
  if(!q) return null;
  b.roomQuantities=q;
  return b;
}
const acceptedKeys=['v','audience','intentId','issuedAtMs','expiresAtMs','acceptedAtMs','guestAccess','intentBinding'];
function accepted(value,now,obs) {
  const r=record(value,acceptedKeys,obs);
  if(!r || r.v!==1 || !audience(r.audience) || !hex(r.intentId) || !lifetime(r) || !time(r.acceptedAtMs) || !time(now) || (r.guestAccess!=='active' && r.guestAccess!=='revoked')) return null;
  const b=binding(r.intentBinding,obs);
  if(!b || r.issuedAtMs>r.acceptedAtMs || r.acceptedAtMs>now || r.acceptedAtMs>=r.expiresAtMs || r.expiresAtMs>b.quoteExpiresAtMs) return null;
  r.intentBinding=b;
  return r;
}
function equalBinding(a,b) {
  if(a.v!==b.v || a.intentDigest!==b.intentDigest || a.quoteDigest!==b.quoteDigest || a.quoteExpiresAtMs!==b.quoteExpiresAtMs || a.roomQuantities.length!==b.roomQuantities.length) return false;
  for(let i=0;i<a.roomQuantities.length;i++) if(a.roomQuantities[i]!==b.roomQuantities[i]) return false;
  return true;
}
export function classifyGuestIntentAdmission(input) {
  try {
    const obs=observations(), a=record(input,admissionKeys,obs);
    if(!a) return 'DENIED';
    const c=record(a.claims,claimsKeys,obs), b=binding(a.intentBinding,obs);
    if(!eligible(a,c) || !b || b.intentDigest!==c.intentDigest || b.quoteDigest!==c.quoteDigest) return 'DENIED';
    if(a.acceptedContext===null) return a.command==='bootstrap' && c.purpose==='guest-bootstrap' && c.expiresAtMs<=b.quoteExpiresAtMs && stable(obs) ? 'NEW_INTENT_ELIGIBLE':'DENIED';
    const r=accepted(a.acceptedContext,a.nowMs,obs);
    if(!r || r.audience!==c.audience || r.intentId!==c.intentId || r.issuedAtMs!==c.issuedAtMs || r.expiresAtMs!==c.expiresAtMs || r.guestAccess!=='active' || !equalBinding(r.intentBinding,b) || !stable(obs)) return 'DENIED';
    return a.command==='status' ? 'ACCEPTED_STATUS_ELIGIBLE':'ACCEPTED_RESUME_ELIGIBLE';
  } catch { return 'DENIED'; }
}
const recoveryKeys=['expectedAudience','expectedIntentId','nowMs','acceptedContext'];
export function classifyAcceptedIntentRecovery(input) {
  try {
    const obs=observations(), a=record(input,recoveryKeys,obs);
    if(!a || !audience(a.expectedAudience) || !hex(a.expectedIntentId) || !time(a.nowMs)) return 'DENIED';
    const r=accepted(a.acceptedContext,a.nowMs,obs);
    return r && r.audience===a.expectedAudience && r.intentId===a.expectedIntentId && stable(obs) ? 'ACCEPTED_PROTOCOL_RECOVERY_ELIGIBLE':'DENIED';
  } catch { return 'DENIED'; }
}
export function checkVerifiedGuestClaims(input) {
  try {
    const obs=observations(), a=record(input,checkKeys,obs);
    const c=a && record(a.claims,claimsKeys,obs);
    return a && eligible(a,c) && stable(obs) ? 'CLAIMS_ELIGIBLE':'DENIED';
  } catch { return 'DENIED'; }
}
