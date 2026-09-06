import wixData from 'wix-data';
import { decodeGuestBookingAcquisitionControl, canonicalGuestBookingAcquisitionControl, isGuestBookingAcquisitionControlId } from 'backend/guestBookingAcquisitionControlRules';

// Proposed private collection; no provisioning and no production consumer.
const collection='GuestBookingAcquisitionControls';
const insert=wixData.insert,query=wixData.query,apply=Reflect.apply;
const desc=Object.getOwnPropertyDescriptor,keys=Reflect.ownKeys,proto=Object.getPrototypeOf;
function result(status,record){const out=Object.create(null);out.status=status;if(record)out.record=record;return out;}
function data(v,k){const d=desc(v,k);if(!d||!desc(d,'value'))throw Error('data');return d.value;}
function page(value){
 const items=data(value,'items'),n=data(items,'length');
 if(!Array.isArray(items)||!Number.isSafeInteger(n)||n<0||n>1||keys(items).length!==n+1)throw Error('page');
 const rows=[];for(let i=0;i<n;i++){const d=desc(items,String(i));if(!d||!d.enumerable)throw Error('array');rows.push(decodeGuestBookingAcquisitionControl(data(items,String(i)),true));}
 let p=value,method;const chain=[];
 for(let i=0;p!==null&&i<9;i++){const ks=keys(p),ds=ks.map(k=>desc(p,k));chain.push([p,proto(p),ks,ds]);const d=desc(p,'hasNext');if(d){if(!desc(d,'value')||typeof d.value!=='function')throw Error('method');method=d.value;break;}p=proto(p);}
 if(!method||apply(method,value,[])!==false)throw Error('page');
 for(const [v,pr,ks,ds]of chain){const now=keys(v);if(proto(v)!==pr||now.length!==ks.length)throw Error('drift');for(let i=0;i<ks.length;i++){const a=ds[i],b=desc(v,ks[i]);if(now[i]!==ks[i]||!b||a.value!==b.value||a.get!==b.get||a.set!==b.set||a.enumerable!==b.enumerable||a.writable!==b.writable||a.configurable!==b.configurable)throw Error('drift');}}
 if(data(value,'items')!==items||data(items,'length')!==n||keys(items).length!==n+1)throw Error('drift');
 for(let i=0;i<n;i++)if(canonicalGuestBookingAcquisitionControl(decodeGuestBookingAcquisitionControl(data(items,String(i)),true))!==canonicalGuestBookingAcquisitionControl(rows[i]))throw Error('drift');
 return rows;
}
export async function readGuestBookingAcquisitionControl(id){
 if(!isGuestBookingAcquisitionControlId(id))return result('INTEGRITY');
 try{
  const q=apply(query,wixData,[collection]).eq('_id',id).limit(2),find=q.find;
  const rows=page(await apply(find,q,[{suppressAuth:true,suppressHooks:true,consistentRead:true}]));
  if(!rows.length)return result('ABSENT');if(rows[0]._id!==id)return result('INTEGRITY');return result('FOUND',rows[0]);
 }catch{return result('UNRESOLVED');}
}
// Internal adapter, not an authority certificate or raw public booking API.
export async function reconcileGuestBookingAcquisitionControl(candidate){
 let row;try{row=decodeGuestBookingAcquisitionControl(candidate);}catch{return result('INTEGRITY');}
 try{await apply(insert,wixData,[collection,row,{suppressAuth:true,suppressHooks:true}]);}catch{/* Every outcome requires exact readback. */}
 return readGuestBookingAcquisitionControl(row._id);
}
