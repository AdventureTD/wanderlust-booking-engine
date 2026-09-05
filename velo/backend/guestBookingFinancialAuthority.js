import wixData from 'wix-data';
import { canonicalizeGuestBookingPurchaseInput } from 'backend/guestBookingPurchaseInput';
import { readLockedPricingQuoteAuthority } from 'backend/lockedPricingQuoteAuthority';
import { calculateGuestBookingFinancials } from 'backend/guestBookingFinancialCalculation';

// Private sequential read observations, NOT booking authorization or an atomic
// catalog revision. No callers, writes, cache, current repricing or public DTO.
const query = wixData.query;
const apply = Reflect.apply;
const parse = JSON.parse;
const create = Object.create;
const freeze = Object.freeze;
const descriptor = Object.getOwnPropertyDescriptor;
const prototype = Object.getPrototypeOf;
const keys = Reflect.ownKeys;
const same = Object.is;
const define = Object.defineProperty;
const ordinary = Object.prototype;
const arrayPrototype = Array.prototype;
const isArray = Array.isArray;
const integer = Number.isSafeInteger;
const finite = Number.isFinite;
const number = Number;
const floor = Math.floor;
const exec = RegExp.prototype.exec;
const slice = String.prototype.slice;
const clock = Date.now;
const dateReceiver = Date;
const dateTime = Date.prototype.getTime;
function record(values) {
  const out = create(null), names = keys(values);
  for (let i=0;i<names.length;i++) out[names[i]]=values[names[i]];
  return out;
}
function put(a,i,value) { define(a,''+i,record({value,enumerable:true,writable:true,configurable:true})); }
function deep(value) {
  if (value === null || typeof value !== 'object') return value;
  const names=keys(value);
  for (let i=0;i<names.length;i++) deep(value[names[i]]);
  return freeze(value);
}
function matches(re,s) { const m=apply(exec,re,[s]); return m!==null && m[0].length===s.length; }
function day(s) {
  if (typeof s!=='string' || !matches(/[0-9]{4}-[0-9]{2}-[0-9]{2}/,s)) throw 0;
  const y=number(apply(slice,s,[0,4])),m=number(apply(slice,s,[5,7])),d=number(apply(slice,s,[8,10]));
  const lengths=[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  if(m<1||m>12||d<1||d>lengths[m-1]) throw 0;
  let n=365*y+floor((y+3)/4)-floor((y+99)/100)+floor((y+399)/400)+d;
  for(let i=0;i<m-1;i++)n+=lengths[i];
  return n;
}
function equalDescriptor(a,b) {
  return !!b && !!descriptor(b,'value') && same(a.value,b.value) && a.enumerable===b.enumerable && a.writable===b.writable && a.configurable===b.configurable;
}
function scalar(value,budget) {
  if (typeof value==='string') {
    if(value.length>4096 || (budget.text+=value.length)>262144) throw 0;
    return value;
  }
  if(value===null || typeof value==='number' || typeof value==='boolean') return value;
  // SDK native Date only; captured accessor does not invoke row hooks.
  const milliseconds=apply(dateTime,value,[]);
  if(!finite(milliseconds)) throw 0;
  return freeze(record({kind:'date',milliseconds}));
}
// Read only consumed descriptors: unrelated media/PII is never enumerated.
// Observable descriptor/prototype drift denies; stable lying proxies and
// pre-initialization realm compromise are outside this inert DTO model.
function row(value,names,budget) {
  if(value===null||typeof value!=='object')throw 0;
  const proto=prototype(value);
  if(proto!==null&&proto!==ordinary)throw 0;
  const out=create(null), before=create(null);
  for(let i=0;i<names.length;i++) {
    const k=names[i],d=descriptor(value,k);before[k]=d;
    if(!d){out[k]=freeze(record({present:false}));continue;}
    if(!d.enumerable||!descriptor(d,'value'))throw 0;
    out[k]=freeze(record({present:true,value:scalar(d.value,budget)}));
  }
  if(prototype(value)!==proto)throw 0;
  for(let i=0;i<names.length;i++) {
    const k=names[i],d=descriptor(value,k);
    if(before[k] ? !equalDescriptor(before[k],d) : d!==undefined)throw 0;
  }
  if(prototype(value)!==proto)throw 0;
  return freeze(out);
}
function required(r,k) {if(!r[k].present)throw 0;return r[k].value;}
function id(r) {const v=required(r,'_id');if(typeof v!=='string'||v.length<1||v.length>256)throw 0;return v;}
function updated(r) {
  if(!r._updatedDate.present)return null;
  const d=r._updatedDate.value;
  if(d===null||typeof d!=='object'||d.kind!=='date')throw 0;
  return d.milliseconds;
}
function decimal(v,whole=false) {
  if(typeof v==='string') {
    if(v.length<1||v.length>64||!matches(whole?/(?:0|[1-9][0-9]*)/:/(?:0|[1-9][0-9]*)(?:\.[0-9]+)?/,v))throw 0;
    const n=number(v);
    if(n===0&&apply(exec,/[1-9]/,[v])!==null)throw 0;
    v=n;
  }
  if(typeof v!=='number'||!finite(v)||v<0||(whole&&!integer(v)))throw 0;
  return v===0?0:v;
}
function numeric(v,positive=false) {if(typeof v!=='number'||!finite(v)||v<0||(positive&&v===0))throw 0;return v;}
// SDK methods are trusted transport operations, but getters are not executed.
function method(value,key) {
  let p=value;
  for(let i=0;p!==null&&p!==ordinary&&i<16;i++,p=prototype(p)) {
    const d=descriptor(p,key);
    if(d){if(!descriptor(d,'value')||typeof d.value!=='function')throw 0;return d.value;}
  }
  throw 0;
}
function invoke(value,key,args) {return apply(method(value,key),value,args);}
function options(){return record({suppressAuth:true,consistentRead:true});}
function page(response,max,names,budget,promoKey=null) {
  if(response===null||typeof response!=='object')throw 0;
  const responsePrototype=prototype(response);
  const d=descriptor(response,'items');
  if(!d||!d.enumerable||!descriptor(d,'value'))throw 0;
  const items=d.value;
  if(!isArray(items)||prototype(items)!==arrayPrototype)throw 0;
  const length=descriptor(items,'length'), own=keys(items);
  if(!length||!integer(length.value)||length.value<0||length.value>max||own.length!==length.value+1)throw 0;
  const copied=[],journal=create(null);
  for(let i=0;i<length.value;i++) {
    const a=descriptor(items,''+i);
    if(own[i]!==''+i||!a||!a.enumerable||!descriptor(a,'value'))throw 0;
    journal[i]=a;put(copied,i,promoKey===null?row(a.value,names,budget):promoRow(a.value,promoKey,budget));
  }
  const hasNext=method(response,'hasNext');
  const more=apply(hasNext,response,[]);
  if(more!==true&&more!==false)throw 0;
  if(!equalDescriptor(d,descriptor(response,'items'))||prototype(items)!==arrayPrototype||!equalDescriptor(length,descriptor(items,'length')))throw 0;
  const again=keys(items);
  if(again.length!==own.length)throw 0;
  for(let i=0;i<own.length;i++)if(own[i]!==again[i])throw 0;
  for(let i=0;i<length.value;i++)if(!equalDescriptor(journal[i],descriptor(items,''+i)))throw 0;
  if(prototype(response)!==responsePrototype)throw 0;
  return record({rows:copied,more});
}
async function unique(collection,key,value,names,budget) {
  let q=apply(query,wixData,[collection]);
  q=invoke(q,'eq',[key,value]);q=invoke(q,'limit',[2]);
  const response=await invoke(q,'find',[options()]);
  const p=page(response,2,names,budget);
  if(p.more||p.rows.length!==1)throw 0;
  const r=p.rows[0];id(r);if(required(r,key)!==value)throw 0;
  return r;
}
const packageFields=['_id','numberOfNights','NumberOfNights','numberofnights','baseRate','priceModifier','_updatedDate'];
const settingFields=['_id','key','value','_updatedDate'];
function packageFact(r,nights) {
  const aliases=create(null);let count=0;
  for(let i=1;i<=3;i++) {const k=packageFields[i];aliases[k]=r[k];if(r[k].present){const n=decimal(r[k].value,true);if(n===0||n!==nights)throw 0;count++;}}
  if(!count)throw 0;
  return record({_id:id(r),nightAliases:aliases,baseRate:numeric(required(r,'baseRate')),priceModifier:numeric(required(r,'priceModifier'),true),updatedAtMs:updated(r)});
}
async function setting(key,budget) {
  const r=await unique('Settings','key',key,settingFields,budget);
  const raw=required(r,'value'),value=decimal(raw);
  // Legacy zero means fallback rates, not approved tax exemption.
  if(value===0)throw 0;
  return record({_id:id(r),key,value:raw,parsedValue:value,updatedAtMs:updated(r)});
}
const trim = String.prototype.trim;
const upper = String.prototype.toUpperCase;
const utcYear = Date.prototype.getUTCFullYear;
const utcMonth = Date.prototype.getUTCMonth;
const utcDate = Date.prototype.getUTCDate;
const NativeDate = Date;
const promoTitles=['_id','title','Title','title_fld'];
const promoSelected=['_id','title','Title','title_fld','discount','minimumNights','startDate','endDate','_updatedDate'];
function comparison(s) {
  if(typeof s!=='string'||s.length<1||s.length>256)throw 0;
  const key=apply(upper,apply(trim,s,[]),[]);
  if(key.length===0)throw 0;
  return key;
}
function aliasKey(r) {
  let key=null;
  for(let i=1;i<4;i++)if(r[promoTitles[i]].present) {
    const k=comparison(r[promoTitles[i]].value);
    if(key!==null&&key!==k)throw 0;
    key=k;
  }
  if(key===null)throw 0;
  return key;
}
function promoRow(value,key,budget) {
  const titles=row(value,promoTitles,budget);id(titles);
  if(aliasKey(titles)!==key)return titles;
  const selected=row(value,promoSelected,budget);
  for(let i=0;i<promoTitles.length;i++) {
    const k=promoTitles[i];
    if(titles[k].present!==selected[k].present||titles[k].value!==selected[k].value)throw 0;
  }
  return selected;
}
function endpoint(tag) {
  if(!tag.present||tag.value===null||tag.value==='')return null;
  const v=tag.value;
  if(typeof v==='string')return day(v);
  if(v===null||typeof v!=='object'||v.kind!=='date')throw 0;
  const d=new NativeDate(v.milliseconds);
  const y=apply(utcYear,d,[]),m=apply(utcMonth,d,[])+1,n=apply(utcDate,d,[]);
  if(y<0||y>9999)throw 0;
  const ys=('0000'+y),ms='0'+m,ds='0'+n;
  return day(apply(slice,ys,[-4])+'-'+apply(slice,ms,[-2])+'-'+apply(slice,ds,[-2]));
}
function promoFact(r,submittedCode,key,nights,checkIn,checkOut,pages,rows) {
  const discount=decimal(required(r,'discount'));
  if(discount===0||discount>1)throw 0;
  const min=r.minimumNights;
  const minimumNights=!min.present||min.value===null||min.value===''?0:decimal(min.value,true);
  const startDay=endpoint(r.startDate),endDay=endpoint(r.endDate);
  if(minimumNights>nights||(startDay!==null&&endDay!==null&&startDay>endDay)||
    (startDay!==null&&day(checkIn)<startDay)||(endDay!==null&&day(checkOut)-1>endDay))throw 0;
  return record({_id:id(r),submittedCode,comparisonKey:key,raw:r,discountRate:discount,minimumNights,startDay,endDay,updatedAtMs:updated(r),
    scan:record({strategy:'explicit-keyset-find-v1',pages,rows,exhausted:true,atomic:false})});
}
async function readPromo(submittedCode,nights,checkIn,checkOut,budget) {
  const key=comparison(submittedCode);let selected=null,last=null,count=0;
  // next() option propagation is NOT documented by the inspected Velo docs;
  // never rely on it or pass invented next(options). Explicit lexicographic
  // keyset queries reapply both options on EVERY page. Runtime ACL/options,
  // _id collation and SDK result descriptor compatibility remain rollout gates.
  // Concurrent inserts/deletes can still change this sequential observation.
  for(let index=0;index<10;index++) {
    let q=apply(query,wixData,['PromoCodes']);
    if(last!==null)q=invoke(q,'gt',['_id',last]);
    q=invoke(q,'ascending',['_id']);q=invoke(q,'limit',[100]);
    const response=await invoke(q,'find',[options()]);
    const p=page(response,100,promoTitles,budget,key);
    if(p.more&&p.rows.length!==100)throw 0;
    for(let i=0;i<p.rows.length;i++) {
      const r=p.rows[i],current=id(r);
      if(last!==null&&current<=last)throw 0;
      last=current;count++;
      if(aliasKey(r)===key){if(selected!==null)throw 0;selected=r;}
    }
    if(!p.more){if(selected===null)throw 0;return promoFact(selected,submittedCode,key,nights,checkIn,checkOut,index+1,count);}
  }
  throw 0;
}
export async function readGuestBookingFinancialPreview(purchaseInput) {
  try {
    if(arguments.length!==1)return 'DENIED';
    const inputCanonical=canonicalizeGuestBookingPurchaseInput(purchaseInput);
    if(typeof inputCanonical!=='string'||inputCanonical==='DENIED'||inputCanonical.length>262144)return 'DENIED';
    const t=parse(inputCanonical);
    if(!isArray(t)||t.length!==10||t[0]!=='wbe.guest-purchase-input'||t[1]!==1||!isArray(t[7])||t[7].length!==6||!isArray(t[8])||t[8].length!==4||!isArray(t[9])||t[9].length<1||t[9].length>4)throw 0;
    const checkIn=t[2],checkOut=t[3],packageId=t[4],token=t[5],promo=t[6];
    if(typeof packageId!=='string'||typeof token!=='string'||typeof promo!=='string')throw 0;
    const nights=day(checkOut)-day(checkIn),priceGroups=[];
    for(let i=0;i<t[9].length;i++){const g=t[9][i];if(!isArray(g)||g.length!==3)throw 0;put(priceGroups,i,freeze(record({roomCode:g[0],quantity:g[1],guests:g[2]})));}
    freeze(priceGroups);
    const expected=freeze(record({packageId,checkIn,checkOut,nights}));
    const quote=await readLockedPricingQuoteAuthority(token,expected);
    if(quote==='DENIED')return 'DENIED';
    const budget=record({text:0});
    const pkg=packageFact(await unique('Packages','_id',packageId,packageFields,budget),nights);
    let room=null;
    for(let i=0;i<priceGroups.length;i++)if(priceGroups[i].roomCode==='penthouse_apartment') {
      const r=await unique('Rooms','roomCode','penthouse_apartment',['_id','roomCode','roomFee','_updatedDate'],budget);
      room=record({_id:id(r),roomCode:required(r,'roomCode'),roomFee:numeric(required(r,'roomFee')),updatedAtMs:updated(r)});
      break;
    }
    const property=await setting('propertyFeeRate',budget);
    const accommodation=await setting('taxRate_accommodation',budget);
    const standard=await setting('taxRate_standard',budget);
    const promoRecord=promo===''?null:await readPromo(promo,nights,checkIn,checkOut,budget);
    const catalog=record({package:pkg,room,settings:record({propertyFeeRate:property,taxRate_accommodation:accommodation,taxRate_standard:standard}),promo:promoRecord});
    const factors=record({v:1,nights,totalPerPerson:quote.claims.totalPerPerson,penthouseRoomFee:room===null?null:room.roomFee===0?0:room.roomFee,propertyFeeRate:property.parsedValue,taxRateAccommodation:accommodation.parsedValue,taxRateStandard:standard.parsedValue,promoDiscountRate:promoRecord===null?0:promoRecord.discountRate,priceGroups});
    const calculation=calculateGuestBookingFinancials(factors);
    if(calculation==='DENIED')return 'DENIED';
    const observedAtMs=apply(clock,dateReceiver,[]);
    if(!integer(observedAtMs)||observedAtMs<0||quote.claims.issuedAt>observedAtMs||observedAtMs>=quote.claims.expiresAt)return 'DENIED';
    return deep(record({v:1,purpose:'guest-booking-financial-preview',inputCanonical,quote,catalog,factors,calculation,observedAtMs}));
  } catch (_) {return 'DENIED';}
}
