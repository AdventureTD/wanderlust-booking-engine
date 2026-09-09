import wixData from 'wix-data';
import { decodeGuestBookingAcquisitionControl, canonicalGuestBookingAcquisitionControl, isGuestBookingAcquisitionControlId } from 'backend/guestBookingAcquisitionControlRules';

// Proposed private collection; no provisioning and no production consumer.
const collection='GuestBookingAcquisitionControls';
const insert=wixData.insert,query=wixData.query,apply=Reflect.apply;
const desc=Object.getOwnPropertyDescriptor,keys=Reflect.ownKeys,proto=Object.getPrototypeOf;
function result(status,record){const out=Object.create(null);out.status=status;if(record)out.record=record;return out;}
function data(v,k){const d=desc(v,k);if(!d||!desc(d,'value'))throw Error('data');return d.value;}
const stringify=JSON.stringify,create=Object.create,same=Object.is;
const getTime=Date.prototype.getTime,toISO=Date.prototype.toISOString,dateProto=Date.prototype;
function bytes(text){let n=0;for(const c of text){const v=c.codePointAt(0);n+=v<128?1:v<2048?2:v<65536?3:4;}return n;}
// Existing decoder admits native grammar first. Serialize ONLY detached scalar
// fields, with native dates explicitly rendered, never the raw SDK object.
function envelope(value){
 const record=decodeGuestBookingAcquisitionControl(value,true),names=keys(value),ds=names.map(k=>desc(value,k)),p=proto(value),out=create(null),dates=[];
 for(let i=0;i<names.length;i++){
  const k=names[i],d=ds[i];if(!d||!desc(d,'value')||!d.enumerable)throw Error('data');
  if(k==='_owner'){if(d.value!==null&&(typeof d.value!=='string'||d.value.length>256))throw Error('owner');out[k]=d.value;}
  else if(k==='_createdDate'||k==='_updatedDate'){
   const v=d.value;if(!v||proto(v)!==dateProto||keys(v).length)throw Error('date');
   const t=apply(getTime,v,[]);if(!Number.isSafeInteger(t))throw Error('date');dates.push([v,t]);out[k]=apply(toISO,v,[]);
  }else {if(!desc(record,k)||!same(record[k],d.value))throw Error('drift');out[k]=record[k];}
 }
 const again=keys(value);if(proto(value)!==p||again.length!==names.length)throw Error('drift');
 for(let i=0;i<names.length;i++){const a=ds[i],b=desc(value,names[i]);if(again[i]!==names[i]||!b||!desc(b,'value')||!same(a.value,b.value)||a.enumerable!==b.enumerable||a.writable!==b.writable||a.configurable!==b.configurable)throw Error('drift');}
 for(const [v,t]of dates)if(proto(v)!==dateProto||keys(v).length||apply(getTime,v,[])!==t)throw Error('drift');
 if(canonicalGuestBookingAcquisitionControl(decodeGuestBookingAcquisitionControl(value,true))!==canonicalGuestBookingAcquisitionControl(record))throw Error('drift');
 return {record,text:stringify(out)};
}
function page(value){
 const items=data(value,'items'),n=data(items,'length');
 if(!Array.isArray(items)||!Number.isSafeInteger(n)||n<0||n>1||keys(items).length!==n+1)throw Error('page');
 const rows=[];for(let i=0;i<n;i++){const d=desc(items,String(i));if(!d||!d.enumerable)throw Error('array');rows.push(envelope(data(items,String(i))));}
 let p=value,method;const chain=[];
 for(let i=0;p!==null&&i<9;i++){const ks=keys(p),ds=ks.map(k=>desc(p,k));chain.push([p,proto(p),ks,ds]);const d=desc(p,'hasNext');if(d){if(!desc(d,'value')||typeof d.value!=='function')throw Error('method');method=d.value;break;}p=proto(p);}
 if(!method||apply(method,value,[])!==false)throw Error('page');
 for(const [v,pr,ks,ds]of chain){const now=keys(v);if(proto(v)!==pr||now.length!==ks.length)throw Error('drift');for(let i=0;i<ks.length;i++){const a=ds[i],b=desc(v,ks[i]);if(now[i]!==ks[i]||!b||a.value!==b.value||a.get!==b.get||a.set!==b.set||a.enumerable!==b.enumerable||a.writable!==b.writable||a.configurable!==b.configurable)throw Error('drift');}}
 if(data(value,'items')!==items||data(items,'length')!==n||keys(items).length!==n+1)throw Error('drift');
 for(let i=0;i<n;i++)if(envelope(data(items,String(i))).text!==rows[i].text)throw Error('drift');
 // [] costs two bytes even for an absent exact; commas counted once per page.
 return {rows:rows.map(r=>r.record),bytes:2+rows.reduce((n,r,i)=>n+bytes(r.text)+(i?1:0),0)};
}
async function exact(id,scope,token){
 try{
  if(!isGuestBookingAcquisitionControlId(id)){if(scope)scope.poison();return result('INTEGRITY');}
  const q=apply(query,wixData,[collection]).eq('_id',id).limit(2),find=q.find;
  if(scope){if(token)scope.beginReadback(token,collection,id);else scope.reserveExact();}
  const admitted=page(await apply(find,q,[{suppressAuth:true,suppressHooks:true,consistentRead:true}]));
  if(scope){if(token)scope.settleReadback(token,admitted.bytes);else scope.chargeBytes(admitted.bytes);}
  const rows=admitted.rows;
  if(!rows.length){if(token)scope.poison();return result('ABSENT');}
  if(rows[0]._id!==id){if(scope)scope.poison();return result('INTEGRITY');}return result('FOUND',rows[0]);
 }catch{if(scope)scope.poison();return result('UNRESOLVED');}
}
// Legacy one-argument readers remain compatible. The physical coordinator always
// supplies its private scope; extra public arguments cannot carry readback credit.
export async function readGuestBookingAcquisitionControl(id,scope){return exact(id,scope);}
// Internal adapter, not an authority certificate or raw public booking API.
export async function reconcileGuestBookingAcquisitionControl(candidate,scope){
 let row;try{row=decodeGuestBookingAcquisitionControl(candidate);}catch{if(scope)scope.poison();return result('INTEGRITY');}
 let token;
 try{
  if(scope){
   // Application envelope fit is separate from the read counter. The existing
   // owner<=256/two finite dates grammar fits +4096; include [] explicitly.
   const applicationBytes=bytes(stringify(row));if(applicationBytes>400000)throw Error('envelope');
   token=scope.reserveMutationReadback(collection,row._id,applicationBytes+4096+2);
   scope.startMutation(token,collection,row._id);
  }
 }catch{if(scope)scope.poison();return result('UNRESOLVED');}
 try{await apply(insert,wixData,[collection,row,{suppressAuth:true,suppressHooks:true}]);}catch{/* ACK is not authority; one reserved exact readback, never reinsert. */}
 return exact(row._id,scope,token);
}
