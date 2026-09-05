// DISCONNECTED private backend metadata signer. Supplied digests are NOT full-intent
// authority. No web exposure until full-intent, persistence and Wix runtime gates.
// Trusted module-load realm and inert upstream DTOs required; stable lying Proxies
// are not detectable. No secrets, pricing keys, clocks, persistence or IO here.
import crypto from 'crypto';
import { Buffer } from 'buffer';
import { checkVerifiedGuestClaims, classifyGuestIntentAdmission } from 'backend/guestBookingAccessPolicy';

const create = Object.create, freeze = Object.freeze, proto = Object.getPrototypeOf;
const descriptor = Object.getOwnPropertyDescriptor, ownKeys = Reflect.ownKeys;
const define = Object.defineProperty, same = Object.is, integer = Number.isSafeInteger;
const ordinary = Object.prototype, arrayProto = Array.prototype, isArray = Array.isArray;
const has = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
const exec = Function.prototype.call.bind(RegExp.prototype.exec);
const from = Buffer.from, isBuffer = Buffer.isBuffer;
const randomBytes = crypto.randomBytes, createHmac = crypto.createHmac;
const timingSafeEqual = crypto.timingSafeEqual;
const update = crypto.Hmac && crypto.Hmac.prototype.update;
const digest = crypto.Hmac && crypto.Hmac.prototype.digest;
const apply = Reflect.apply;
const hexSlice = Function.prototype.call.bind(Buffer.prototype.hexSlice);
const base64Slice = Function.prototype.call.bind(Buffer.prototype.base64Slice);
const asciiSlice = Function.prototype.call.bind(Buffer.prototype.asciiSlice);
function byteString(b,encoding){
  const n=byteLength(b);
  return encoding==='hex'?hexSlice(b,0,n):encoding==='base64'?base64Slice(b,0,n):asciiSlice(b,0,n);
}
const readByte = Function.prototype.call.bind(Buffer.prototype.readUInt8);
const byteLength = Function.prototype.call.bind(descriptor(proto(Uint8Array.prototype),'length').get);
const repeat = Function.prototype.call.bind(String.prototype.repeat);
// Manual translation avoids mutable RegExp symbol hooks.
function translate(s,a,b){let out='';for(let i=0;i<s.length;i++)out+=s[i]===a?b:s[i];return out;}
const split = Function.prototype.call.bind(String.prototype.split);
const parse = JSON.parse;
function decode(s){
  if(typeof s!=='string'||s.length<1||matches(/[^A-Za-z0-9_-]/,s))return null;
  const pad=s.length%4; if(pad===1)return null;
  const b=from(translate(translate(s,'-','+'),'_','/')+(pad===2?'==':pad===3?'=':''),'base64');
  return isBuffer(b)&&encode(b)===s?b:null;
}
function envelope(token){
  if(typeof token!=='string'||token.length<1||token.length>1024||matches(/[^\x00-\x7f]/,token))return null;
  const p=split(token,'.');
  if(p.length!==4||p[0]!=='wgb1'||!kid(p[1])||p[2].length<1||p[2].length>768||p[3].length!==43)return null;
  const payload=decode(p[2]),signature=decode(p[3]);
  if(!payload||byteLength(payload)<1||byteLength(payload)>576||!signature||!bytes(signature,32))return null;
  for(let i=0;i<byteLength(payload);i++)if(readByte(payload,i)>127)return null;
  const text=byteString(payload,'ascii'),t=parse(text);
  if(!isArray(t)||t.length!==8||t[0]!==1||(t[1]!=='guest-bootstrap'&&t[1]!=='guest-access')||!audience(t[2])||!hex(t[3])||!hex(t[4])||!hex(t[5])||!time(t[6])||!time(t[7]))return null;
  const c=create(null);for(let i=0;i<8;i++)put(c,claimKeys[i],t[i]);
  if(canonical(c)!==text)return null;
  const e=create(null);e.claims=c;e.kid=p[1];e.signature=signature;e.wire=p[0]+'.'+p[1]+'.'+p[2];return e;
}
function time(n){return typeof n==='number'&&integer(n)&&n>=0&&!same(n,-0);}
function bytes(b,n){return isBuffer(b)&&byteLength(b)===n;}
function encode(b){return translate(translate(translate(byteString(b,'base64'),'+','-'),'/','_'),'=','');}
const claimKeys=['v','purpose','audience','intentId','intentDigest','quoteDigest','issuedAtMs','expiresAtMs'];
function canonical(c){return '[1,"'+c.purpose+'","'+c.audience+'","'+c.intentId+'","'+c.intentDigest+'","'+c.quoteDigest+'",'+c.issuedAtMs+','+c.expiresAtMs+']';}
function mac(key,wire){
  const h=createHmac('sha256',key);
  if(apply(update,h,['WBE-GUEST-BOOKING-CREDENTIAL\u0000'+wire,'utf8'])!==h)throw 0;
  const b=apply(digest,h,[]);if(!bytes(b,32))throw 0;return b;
}
function sign(c,k,key){const wire='wgb1.'+k+'.'+encode(from(canonical(c),'ascii'));return wire+'.'+encode(mac(key,wire));}
function claims(p,a,id,b,issue,expiry){const c=create(null);const values=[1,p,a,id,b.intentDigest,b.quoteDigest,issue,expiry];for(let i=0;i<8;i++)put(c,claimKeys[i],values[i]);return c;}
function snapshotBinding(value,obs){
  const b=inspect(value,['v','intentDigest','quoteDigest','quoteExpiresAtMs','roomQuantities'],obs);
  if(!b||b.v!==1||!hex(b.intentDigest)||!hex(b.quoteDigest)||!time(b.quoteExpiresAtMs))return null;
  const q=list(b.roomQuantities,1,4,obs);if(!q)return null;
  const detached=[];for(let i=0;i<q.length;i++)put(detached,i,q[i]);b.roomQuantities=detached;return b;
}
function put(o,k,v) { const d=create(null); d.value=v;d.enumerable=true;d.writable=true;d.configurable=true;define(o,k,d); }
function observations() {const o=create(null);o.length=0;return o;}
function inspect(value,keys,obs,array=false) {
  if(!value || typeof value!=='object') return null;
  const p=proto(value);
  if(array ? !isArray(value)||p!==arrayProto : p!==ordinary&&p!==null) return null;
  const actual=ownKeys(value); if(actual.length!==keys.length) return null;
  const out=create(null),ds=create(null);
  for(let i=0;i<keys.length;i++) {
    const k=keys[i],d=descriptor(value,k);
    if(!d || !has(d,'value') || d.enumerable!==(array&&k==='length'?false:true)) return null;
    put(out,k,d.value);put(ds,k,d);
  }
  const o=create(null);o.value=value;o.p=p;o.keys=actual;o.ds=ds;put(obs,obs.length,o);obs.length++;
  return out;
}
function stable(obs) {
  for(let i=0;i<obs.length;i++) {
    const o=obs[i];if(proto(o.value)!==o.p)return false;
    const ks=ownKeys(o.value);if(ks.length!==o.keys.length)return false;
    for(let j=0;j<ks.length;j++) {
      const k=ks[j],a=o.ds[k],b=descriptor(o.value,k);
      if(k!==o.keys[j]||!a||!b||!has(b,'value')||!same(a.value,b.value)||a.enumerable!==b.enumerable||a.writable!==b.writable||a.configurable!==b.configurable)return false;
    }
  }
  return true;
}
function list(value,min,max,obs) {
  if(!isArray(value)||proto(value)!==arrayProto)return null;
  const d=descriptor(value,'length');if(!d||!has(d,'value')||!integer(d.value)||d.value<min||d.value>max||d.configurable!==false)return null;
  const keys=create(null);keys.length=d.value+1;
  for(let i=0;i<d.value;i++)put(keys,i,''+i);put(keys,d.value,'length');
  return inspect(value,keys,obs,true);
}
function matches(re,s) {return exec(re,s)!==null;}
function audience(s){return typeof s==='string'&&s.length>=1&&s.length<=128&&matches(/^[A-Za-z0-9]/,s)&&!matches(/[^A-Za-z0-9._:-]/,s);}
function kid(s){return typeof s==='string'&&s.length>=1&&s.length<=32&&matches(/^[A-Za-z0-9]/,s)&&!matches(/[^A-Za-z0-9_-]/,s);}
function hex(s){return typeof s==='string'&&s.length===64&&!matches(/[^a-f0-9]/,s);}
export function createGuestBookingCredentials(input) {
  try {
    if(typeof randomBytes!=='function'||typeof createHmac!=='function'||typeof timingSafeEqual!=='function'||typeof update!=='function'||typeof digest!=='function'||typeof from!=='function'||typeof isBuffer!=='function')return 'DENIED';
    const obs=observations(),c=inspect(input,['audience','activeKid','keys'],obs);
    if(!c||!audience(c.audience)||!kid(c.activeKid))return 'DENIED';
    const entries=list(c.keys,1,3,obs);if(!entries)return 'DENIED';
    const ring=create(null),materials=create(null);let active=false;
    for(let i=0;i<entries.length;i++) {
      const e=inspect(entries[i],['kid','keyHex'],obs);
      if(!e||!kid(e.kid)||!hex(e.keyHex)||has(ring,e.kid)||has(materials,e.keyHex))return 'DENIED';
      put(ring,e.kid,from(e.keyHex,'hex'));put(materials,e.keyHex,true);
      if(e.kid===c.activeKid)active=true;
    }
    if(!active||!stable(obs))return 'DENIED';
    const cAudience=c.audience,cKid=c.activeKid,service=create(null);
    put(service,'prepareBootstrap',function(input){
      try {
        const obs=observations(),a=inspect(input,['intentBinding','nowMs'],obs);
        if(!a||!time(a.nowMs))return 'DENIED';
        const b=snapshotBinding(a.intentBinding,obs);if(!b||!stable(obs))return 'DENIED';
        const cap=a.nowMs>9007199254740991-3600000?9007199254740991:a.nowMs+3600000;
        const expiry=b.quoteExpiresAtMs<cap?b.quoteExpiresAtMs:cap;
        // Validate policy metadata before RNG; this temporary ID has no authority.
        const c=claims('guest-bootstrap',cAudience,repeat('0',64),b,a.nowMs,expiry);
        if(classifyGuestIntentAdmission({claims:c,command:'bootstrap',expectedAudience:cAudience,nowMs:a.nowMs,intentBinding:b,acceptedContext:null})!=='NEW_INTENT_ELIGIBLE')return 'DENIED';
        const random=randomBytes(32);if(!bytes(random,32))return 'DENIED';
        c.intentId=byteString(random,'hex');
        if(classifyGuestIntentAdmission({claims:c,command:'bootstrap',expectedAudience:cAudience,nowMs:a.nowMs,intentBinding:b,acceptedContext:null})!=='NEW_INTENT_ELIGIBLE'||!stable(obs))return 'DENIED';
        return sign(c,cKid,ring[cKid]);
      } catch {return 'DENIED';}
    });
    function verifyCredential(input){
      try {
        const obs=observations(),a=inspect(input,['token','command','nowMs'],obs);
        if(!a||!time(a.nowMs)||(a.command!=='bootstrap'&&a.command!=='resume'&&a.command!=='status')||!stable(obs))return 'DENIED';
        const e=envelope(a.token);if(!e||!has(ring,e.kid)||e.claims.audience!==cAudience)return 'DENIED';
        const expected=mac(ring[e.kid],e.wire);
        if(timingSafeEqual(expected,e.signature)!==true)return 'DENIED';
        if(checkVerifiedGuestClaims({claims:e.claims,command:a.command,expectedAudience:cAudience,nowMs:a.nowMs})!=='CLAIMS_ELIGIBLE'||!stable(obs))return 'DENIED';
        return freeze(e.claims);
      }catch{return 'DENIED';}
    }
    put(service,'verifyCredential',verifyCredential);
    put(service,'attenuateBootstrap',function(input){
      try {
        const obs=observations(),a=inspect(input,['bootstrapToken','nowMs'],obs);
        if(!a||!time(a.nowMs)||!stable(obs))return 'DENIED';
        const c=verifyCredential({token:a.bootstrapToken,command:'resume',nowMs:a.nowMs});
        if(c==='DENIED'||c.purpose!=='guest-bootstrap'||!stable(obs))return 'DENIED';
        const access=create(null);for(let i=0;i<8;i++)put(access,claimKeys[i],c[claimKeys[i]]);
        access.purpose='guest-access';return sign(access,cKid,ring[cKid]);
      }catch{return 'DENIED';}
    });
    return freeze(service);
  } catch {return 'DENIED';}
}
