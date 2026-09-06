import wixData from 'wix-data';
import { resolveGuestConsentRequirement } from 'backend/guestConsentLocationPolicy';

const freeze = Object.freeze;
const now = Date.now;
const safeInteger = Number.isSafeInteger;
const schedule = setTimeout, unschedule = clearTimeout;
const PromiseCtor = Promise, promiseResolve = Promise.resolve, then = Promise.prototype.then;
const apply = Reflect.apply;
const record = value => freeze(value);
// Supported vocabulary, not legal jurisdictions or every ISO exception.
// UN M49 English ISO-alpha2: https://unstats.un.org/unsd/methodology/m49/overview/
const countries = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
// USPS Appendix B, only the 50 states: https://pe.usps.com/text/pub28/28apb.htm
// DC, possessions, freely associated states and military codes are unsupported.
const states = 'AK AL AR AZ CA CO CT DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY'.split(' ');
const includes = Array.prototype.includes;
const hasOwn = Object.prototype.hasOwnProperty;
const descriptor = Object.getOwnPropertyDescriptor, prototype = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys, isArray = Array.isArray;
const objectPrototype = Object.prototype, arrayPrototype = Array.prototype;
// Capture callable data descriptors, allowing SDK class prototypes but never
// Object.prototype fallbacks. Bounded traversal also rejects prototype cycles.
function method(receiver,key) {
  let value=receiver;
  for (let depth=0;depth<16 && value !== null && value !== objectPrototype;depth++) {
    if (typeof value !== 'object' && typeof value !== 'function') throw 0;
    const d=descriptor(value,key);
    if (d !== undefined) {
      if (!descriptor(d,'value') || typeof d.value !== 'function') throw 0;
      return d.value;
    }
    value=prototype(value);
  }
  throw 0;
}
let query;
try { query=method(wixData,'query'); } catch (_) { query=null; }
function invoke(receiver,key,args) { return apply(method(receiver,key),receiver,args); }
function data(value, key, optional = false) {
  const d = descriptor(value,key);
  if (d === undefined && optional) return undefined;
  if (!d || !descriptor(d,'value') || d.enumerable !== true) throw 0;
  return d.value;
}
const same = Object.is, define = Object.defineProperty;
function append(array,value) {
  define(array,''+array.length,{__proto__:null,value,writable:true,enumerable:true,configurable:true});
}
function observe(value, fields, observations, array = false) {
  const proto = prototype(value), saved = {__proto__:null};
  const keys = array ? ownKeys(value) : fields;
  for (let i=0;i<keys.length;i++) {
    const key=keys[i], d=descriptor(value,key);
    if (d !== undefined && (!descriptor(d,'value') || !descriptor(d,'writable'))) throw 0;
    saved[key]=d;
  }
  if (prototype(value) !== proto) throw 0;
  observations.head={__proto__:null,value,proto,keys,saved,array,next:observations.head};
  return saved;
}
function confirm(observations) {
  for(let n=observations.head;n;n=n.next) {
    if(prototype(n.value)!==n.proto) throw 0;
    if(n.array) {
      const keys=ownKeys(n.value);
      if(keys.length!==n.keys.length) throw 0;
      for(let i=0;i<keys.length;i++) if(keys[i]!==n.keys[i]) throw 0;
    }
    for(let i=0;i<n.keys.length;i++) {
      const key=n.keys[i], old=n.saved[key], d=descriptor(n.value,key);
      if(old===undefined ? d!==undefined : (!d || !descriptor(d,'value') ||
          !same(d.value,old.value) || d.enumerable!==old.enumerable ||
          d.configurable!==old.configurable || d.writable!==old.writable)) throw 0;
    }
    // Must remain after the last descriptor trap, not only at scan entry.
    if(prototype(n.value)!==n.proto) throw 0;
  }
}
function rowSnapshot(value, observations) {
  if (value === null || typeof value !== 'object' || isArray(value)) throw 0;
  const p = prototype(value);
  if (p !== null && p !== objectPrototype) throw 0;
  const row = {__proto__:null};
  const fields = ['_id','_updatedDate','countryCode','usStateCode','consentRequired'];
  const saved=observe(value,fields,observations);
  for (let i=0;i<fields.length;i++) {
    const key=fields[i], d=saved[key];
    if (d === undefined && (key === '_updatedDate' || key === 'usStateCode')) continue;
    if (!d || d.enumerable!==true) throw 0;
    row[key]=d.value;
  }
  return row;
}
function itemsSnapshot(result, observations) {
  if (result === null || typeof result !== 'object') throw 0;
  observe(result,['items'],observations);
  const items=data(result,'items');
  if (!isArray(items) || prototype(items) !== arrayPrototype) throw 0;
  const length=descriptor(items,'length').value;
  if (!safeInteger(length) || length < 0 || length > 100) throw 0;
  observe(items,null,observations,true);
  const keys=ownKeys(items);
  if (keys.length !== length+1) throw 0;
  const rows=[];
  for (let i=0;i<length;i++) {
    if (keys[i] !== ''+i) throw 0;
    append(rows,rowSnapshot(data(items,''+i),observations));
  }
  if (keys[length] !== 'length') throw 0;
  return rows;
}
const dateTime = Date.prototype.getTime;
function project(row) {
  const countryCode = row.countryCode, consentRequired = row.consentRequired;
  const present = apply(hasOwn,row,['usStateCode']);
  const usStateCode = present ? row.usStateCode : '';
  if (typeof countryCode !== 'string' || !apply(includes,countries,[countryCode]) ||
      typeof consentRequired !== 'boolean' || typeof usStateCode !== 'string' ||
      (usStateCode !== '' && (countryCode !== 'US' || !apply(includes,states,[usStateCode])))) throw 0;
  let updatedAtMs = null;
  if (apply(hasOwn,row,['_updatedDate'])) {
    updatedAtMs = apply(dateTime,row._updatedDate,[]);
    if (!safeInteger(updatedAtMs) || updatedAtMs < 0) throw 0;
  }
  return {__proto__:null,
    rule:record({__proto__:null,countryCode,usStateCode,consentRequired}),
    evidence:record({__proto__:null,id:row._id,updatedAtMs,
      stateEncoding:!present ? 'ABSENT' : usStateCode === '' ? 'EMPTY_STRING' : 'TOKEN'})};
}
function requirement() {
  return resolveGuestConsentRequirement(record({__proto__:null,v:1,
    location:record({__proto__:null,status:'UNKNOWN'}),
    requirements:record({__proto__:null,status:'UNAVAILABLE'})}));
}
function unavailable(reason) {
  if (requirement() !== 'UNRESOLVED') reason = 'INVALID_DATA';
  return record({__proto__:null,v:1,purpose:'guest-consent-requirements-observation',
    status:'UNAVAILABLE',requirement:'UNRESOLVED',reason});
}
export async function readGuestConsentRequirementsObservation() {
  if (arguments.length !== 0) return unavailable('INVALID_CALL');
  let reason = 'INVALID_DATA', startedAtMs, lastTime;
  function time() {
    const t = now();
    if (!safeInteger(t) || t < 0 || (lastTime !== undefined && t < lastTime)) {reason='INVALID_DATA';throw 0;}
    lastTime=t;
    if (startedAtMs !== undefined && t-startedAtMs >= 10000) {reason='READ_TIMEOUT';throw 0;}
    return t;
  }
  function wait(pending) {
    return new PromiseCtor((resolve,reject)=>{
      let settled=false, timer;
      const finish=(ok,value)=>{
        if(settled)return;settled=true;unschedule(timer);
        if(ok)resolve({__proto__:null,value});else reject(0);
      };
      try { apply(then,apply(promiseResolve,PromiseCtor,[pending]),[v=>finish(true,v),()=>finish(false)]); }
      catch (_) { finish(false); }
      // Handle the started read even if the post-find clock is expired/invalid.
      // Synchronous SDK work cannot be preempted; deduct it before waiting.
      if (!settled) try {
        const remaining=10000-(time()-startedAtMs);
        timer=schedule(()=>{if(!settled){reason='READ_TIMEOUT';finish(false);}},remaining);
      } catch (_) { finish(false); }
    });
  }
  const rules = [], rows = [], results = [];
  let pages = 0, lastId = '';
  try {
    startedAtMs=time();
    while (true) {
      time();
      reason='READ_FAILED';
      if (pages === 41) return unavailable('INCOMPLETE_READ');
      let q = apply(query,wixData,['ConsentRequirements']);
      if (lastId !== '') q = invoke(q,'gt',['_id',lastId]);
      q=invoke(q,'ascending',['_id']);
      q=invoke(q,'limit',[100]);
      time();
      const pending=invoke(q,'find',[record({__proto__:null,suppressAuth:true,consistentRead:true,suppressHooks:true})]);
      const result=(await wait(pending)).value;
      time();
      reason='INVALID_DATA';
      pages++;
      if (apply(includes,results,[result])) return unavailable('INVALID_DATA');
      append(results,result);
      const observations={__proto__:null,head:null};
      const items = itemsSnapshot(result,observations);
      const hasNext=method(result,'hasNext');
      reason='READ_FAILED';
      const more = apply(hasNext,result,[]);
      reason='INVALID_DATA';
      if (typeof more !== 'boolean') return unavailable('INVALID_DATA');
      for (let i=0;i<items.length;i++) {
        const row=items[i];
        if (rules.length === 4096) return unavailable('OVERFLOW');
        if (typeof row._id !== 'string' || row._id === '' || row._id.length > 256 || row._id <= lastId) return unavailable('INVALID_DATA');
        const projected = project(row);
        append(rules,projected.rule);
        append(rows,projected.evidence);
        lastId = row._id;
      }
      confirm(observations);
      if (more && items.length < 100) return unavailable('INCOMPLETE_READ');
      time();
      if (!more) break;
    }
  } catch (_) { return unavailable(reason); }
  if (requirement() !== 'UNRESOLVED') return unavailable('INVALID_DATA');
  return record({__proto__:null,v:1,purpose:'guest-consent-requirements-observation',
    status:'OBSERVED',requirement:'UNRESOLVED',location:record({__proto__:null,status:'UNKNOWN'}),
    rules:freeze(rules),evidence:record({__proto__:null,collectionId:'ConsentRequirements',
      scan:record({__proto__:null,strategy:'explicit-keyset-find-v1',status:'EXHAUSTED',pages,rows:rules.length,
        pageSize:100,maxRows:4096,maxPages:41,atomic:false,coherentRevision:null}),
      startedAtMs,completedAtMs:lastTime,rows:freeze(rows)})});
}
