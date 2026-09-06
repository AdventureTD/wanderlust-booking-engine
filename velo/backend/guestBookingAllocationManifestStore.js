import wixData from 'wix-data';
import { Buffer } from 'buffer';

// Private fixed immutable store. Acknowledgment never substitutes for readback.
const collection='GuestBookingAllocationManifests';
const descriptor=Object.getOwnPropertyDescriptor,ownKeys=Reflect.ownKeys,prototype=Object.getPrototypeOf,apply=Reflect.apply,getTime=Date.prototype.getTime;
const fields=['_id','schemaVersion','manifestCanonical','manifestDigest'];
function key(id){if(typeof id!=='string'||!/^ga2_[A-Za-z0-9_-]{43}$/.test(id))return false;const b=id.slice(4);return Buffer.from(b,'base64url').length===32&&Buffer.from(b,'base64url').toString('base64url')===b;}
function copy(value,metadata=[]){
 const out={};const first=Object.getOwnPropertyDescriptors(value),keys=ownKeys(value),p=prototype(value);
 for(const k of keys){const d=first[k];if(typeof k!=='string'||!d||!descriptor(d,'value')||!d.enumerable)throw Error('record');const v=d.value;if(k==='_owner'){if(typeof v!=='string'||v.length>256)throw Error('metadata');metadata.push([k,v]);}else if(k==='_createdDate'||k==='_updatedDate'){if(prototype(v)!==Date.prototype||ownKeys(v).length||!Number.isSafeInteger(apply(getTime,v,[])))throw Error('metadata');metadata.push([k,apply(getTime,v,[])]);}else{if(!fields.includes(k)||(k==='schemaVersion'?v!==1:typeof v!=='string'))throw Error('record');out[k]=v;}}
 const again=ownKeys(value);if(again.length!==keys.length)throw Error('record');for(let i=0;i<keys.length;i++){const a=first[keys[i]],b=descriptor(value,keys[i]);if(again[i]!==keys[i]||!b||!descriptor(b,'value')||a.value!==b.value||a.enumerable!==b.enumerable||a.configurable!==b.configurable||a.writable!==b.writable)throw Error('record');}if(prototype(value)!==p||fields.some(k=>!Object.hasOwn(out,k))||!key(out._id)||Buffer.byteLength(out.manifestCanonical,'utf8')>400000||!/^[a-f0-9]{64}$/.test(out.manifestDigest))throw Error('record');for(const [k,v]of metadata){const current=descriptor(value,k).value;if(k==='_owner'?current!==v:prototype(current)!==Date.prototype||ownKeys(current).length||apply(getTime,current,[])!==v)throw Error('metadata');}return out;
}
export async function insertGuestBookingAllocationManifest(record){try{const row=copy(record);await wixData.insert(collection,row,{suppressAuth:true,suppressHooks:true});return 'ACKNOWLEDGED';}catch{return 'UNRESOLVED';}}
export async function readGuestBookingAllocationManifest(id){
 if(!key(id))return {status:'INTEGRITY'};
 try{
  const result=await wixData.query(collection).eq('_id',id).limit(2).find({suppressAuth:true,suppressHooks:true,consistentRead:true});
  const itemsDescriptor=descriptor(result,'items');if(!itemsDescriptor||!descriptor(itemsDescriptor,'value'))throw Error('page');const items=itemsDescriptor.value,ld=descriptor(items,'length');if(!Array.isArray(items)||!ld||ld.value>1||ownKeys(items).length!==ld.value+1)throw Error('page');
  const rows=[],metadata=[];for(let i=0;i<ld.value;i++){const d=descriptor(items,String(i));if(!d||!descriptor(d,'value')||!d.enumerable)throw Error('page');const m=[];rows.push(copy(d.value,m));metadata.push(m);}
  let p=result,method;const chain=[];for(let n=0;p!==null&&n<=8;n++){chain.push([p,prototype(p),Object.getOwnPropertyDescriptors(p)]);const d=descriptor(p,'hasNext');if(d){if(!descriptor(d,'value')||typeof d.value!=='function')throw Error('page');method=d.value;break;}p=prototype(p);}if(!method)throw Error('page');const more=apply(method,result,[]);if(more!==false)throw Error('page');
  for(const [v,pr,ds]of chain){const k=ownKeys(ds),now=ownKeys(v);if(prototype(v)!==pr||k.length!==now.length)throw Error('page');for(let i=0;i<k.length;i++){const a=ds[k[i]],b=descriptor(v,k[i]);if(k[i]!==now[i]||!b||a.value!==b.value||a.get!==b.get||a.set!==b.set||a.enumerable!==b.enumerable||a.writable!==b.writable||a.configurable!==b.configurable)throw Error('page');}}
  if(descriptor(result,'items').value!==items||descriptor(items,'length').value!==rows.length||ownKeys(items).length!==rows.length+1)throw Error('page');for(let i=0;i<rows.length;i++){const m=[];if(JSON.stringify(copy(descriptor(items,String(i)).value,m))!==JSON.stringify(rows[i])||JSON.stringify(m)!==JSON.stringify(metadata[i]))throw Error('page');}
  if(!rows.length)return {status:'ABSENT'};if(rows[0]._id!==id)return {status:'INTEGRITY'};return {status:'FOUND',record:rows[0]};
 }catch{return {status:'UNRESOLVED'};}
}
