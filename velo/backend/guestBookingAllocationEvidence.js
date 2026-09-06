import wixData from 'wix-data';
import { buildInventorySnapshot } from 'backend/roomInventoryRules';

const keys=Reflect.ownKeys,desc=Object.getOwnPropertyDescriptor,proto=Object.getPrototypeOf,apply=Reflect.apply,same=Object.is;
const objectProto=Object.prototype,arrayProto=Array.prototype,dateProto=Date.prototype,getTime=Date.prototype.getTime,toISO=Date.prototype.toISOString;
const claimFields=['_id','protocolVersion','claimKey','eventType','claimType','generation','night','capacitySlot','unit','operationId','payloadDigest','bookingNumber','bookingRowId','releaseReason','manifestVersion','manifestCheckIn','manifestCheckOut','manifestRoomCode','manifestUnits','manifestBookingRowIds','manifestResourceClaimIds','completionState','confirmedResourceCount','decisionFenceVersion','operationIdentityId','operationCompletionId','decisionState'];
const base=['_id','protocolVersion','claimKey','generation','eventType','claimType','operationId','bookingRowId','bookingNumber','payloadDigest'];
const manifest=['manifestVersion','manifestCheckIn','manifestCheckOut','manifestRoomCode','manifestUnits','manifestBookingRowIds','manifestResourceClaimIds'];
const metadata=['_owner','_createdDate','_updatedDate'];
const bookingFields=['_id','bookingNumber','status','checkIn','checkOut','assignedRoom','quantity','roomCode','autoOwnerBlock'];
const summaryFields=['_id','bookingNumber','checkIn','checkOut'];
function fail(reason='UNRESOLVED'){throw Error(reason);}
function bytes(s){let n=0;for(const c of s){const v=c.codePointAt(0);n+=v<128?1:v<2048?2:v<65536?3:4;}return n;}
function budget(value){if(bytes(JSON.stringify(value))>400000)fail('BUDGET');}
function id(v){return typeof v==='string'&&v.length>0&&v.length<=128&&/^[\x20-\x7e]+$/.test(v);}
function nativeDate(v){if(proto(v)!==dateProto||keys(v).length)fail();const a=apply(getTime,v,[]),b=apply(getTime,v,[]);if(!Number.isSafeInteger(a)||!same(a,b)||proto(v)!==dateProto||keys(v).length)fail();return a;}
function snapshotRow(value,allowed){
 if(!value||typeof value!=='object'||proto(value)!==objectProto)fail();
 const k=keys(value),first=[],out={};if(k.length>allowed.length+3)fail();
 for(const name of k){if(typeof name!=='string'||(!allowed.includes(name)&&!metadata.includes(name)))fail();const d=desc(value,name);if(!d||!desc(d,'value')||!d.enumerable)fail();let v=d.value;if(name==='_createdDate'||name==='_updatedDate')v=nativeDate(v);else if(name==='_owner'){if(typeof v!=='string'||v.length>256)fail();}else if((name==='checkIn'||name==='checkOut')&&v!==null&&typeof v==='object'){nativeDate(v);v=apply(toISO,v,[]);}else if(v!==null&&typeof v!=='string'&&typeof v!=='number'&&typeof v!=='boolean')fail();if(typeof v==='number'&&(!Number.isFinite(v)||same(v,-0)))fail();if(typeof v==='string'&&v.length>60000)fail();first.push(d);out[name]=v;}
 const again=keys(value);if(again.length!==k.length)fail();for(let i=0;i<k.length;i++){const d=desc(value,k[i]),a=first[i];if(again[i]!==k[i]||!d||!desc(d,'value')||!same(d.value,a.value)||d.enumerable!==a.enumerable||d.configurable!==a.configurable||d.writable!==a.writable)fail();if(k[i]==='_createdDate'||k[i]==='_updatedDate'){if(nativeDate(d.value)!==out[k[i]])fail();}else if((k[i]==='checkIn'||k[i]==='checkOut')&&d.value!==null&&typeof d.value==='object'){if(apply(toISO,d.value,[])!==out[k[i]])fail();}}if(proto(value)!==objectProto||!id(out._id))fail();return out;
}
function page(value,allowed){
 const d=desc(value,'items');if(!d||!desc(d,'value')||!d.enumerable)fail();const source=d.value;if(!Array.isArray(source)||proto(source)!==arrayProto)fail();
 const ak=keys(source),length=desc(source,'length');if(!length||length.value>100||ak.length!==length.value+1)fail();const items=[],ds=[];
 for(let i=0;i<length.value;i++){if(ak[i]!==String(i))fail();const r=desc(source,String(i));if(!r||!desc(r,'value')||!r.enumerable)fail();ds.push(r);items.push(snapshotRow(r.value,allowed));}
 const chain=[];let p=value,method;for(let depth=0;p!==null&&depth<=8;depth++){const pk=keys(p),pd=pk.map(k=>desc(p,k));chain.push([p,proto(p),pk,pd]);const m=desc(p,'hasNext');if(m){if(!desc(m,'value')||typeof m.value!=='function')fail();method=m.value;break;}p=proto(p);}if(!method)fail();const more=apply(method,value,[]);if(typeof more!=='boolean')fail();
 for(const [node,pr,k,descriptors] of chain){const now=keys(node);if(proto(node)!==pr||now.length!==k.length)fail();for(let i=0;i<k.length;i++){const a=descriptors[i],b=desc(node,k[i]);if(now[i]!==k[i]||!b||!same(a.value,b.value)||a.get!==b.get||a.set!==b.set||a.writable!==b.writable||a.enumerable!==b.enumerable||a.configurable!==b.configurable)fail();}if(proto(node)!==pr)fail();}
 if(keys(source).length!==ak.length||desc(source,'length').value!==items.length)fail();for(let i=0;i<items.length;i++){const r=desc(source,String(i));if(!r||r.value!==ds[i].value||JSON.stringify(snapshotRow(r.value,allowed))!==JSON.stringify(items[i]))fail();}if(proto(source)!==arrayProto)fail();return {items,more};
}
async function scan(collection,allowed){let cursor=null;const rows=[];for(let n=0;n<100;n++){let q=wixData.query(collection);if(cursor!==null)q=q.gt('_id',cursor);const p=page(await q.ascending('_id').limit(100).find({suppressAuth:true,suppressHooks:true,consistentRead:true}),allowed);for(const r of p.items){if(cursor!==null&&r._id<=cursor)fail();cursor=r._id;rows.push(r);}budget(rows);if(!p.more)return rows;if(p.items.length!==100)fail();}fail('BUDGET');}
function claim(row){
 let expected=[...base];switch(row.claimType){case 'operation':expected.push(...manifest);if(Object.hasOwn(row,'decisionFenceVersion'))expected.push('decisionFenceVersion');break;case 'operation-completion':expected.push('completionState','confirmedResourceCount');if(Object.hasOwn(row,'decisionFenceVersion'))expected.push('decisionFenceVersion');break;case 'operation-decision':expected.push('decisionFenceVersion','operationIdentityId','operationCompletionId','manifestVersion','completionState','confirmedResourceCount','decisionState');break;case 'capacity':case 'unit':expected.push('night',row.claimType==='capacity'?'capacitySlot':'unit');if(row.eventType==='release')expected.push('releaseReason');break;default:fail();}
 const present=keys(row).filter(k=>!metadata.includes(k));if(present.length!==expected.length||expected.some(k=>!present.includes(k)))fail();const out={};for(const k of claimFields)if(present.includes(k)){const v=row[k];if(typeof v!=='string'&&typeof v!=='number')fail();if(typeof v==='number'&&(!Number.isSafeInteger(v)||same(v,-0)))fail();out[k]=v;}return out;
}
function endpoint(v){
 if(typeof v==='number'){if(!Number.isFinite(v))fail();const d=new Date(v);if(!Number.isFinite(apply(getTime,d,[])))fail();return v;}
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(v))fail();const d=new Date(v),prefix=new Date(v.slice(0,10)+'T00:00:00.000Z');if(!Number.isFinite(apply(getTime,d,[]))||apply(toISO,prefix,[]).slice(0,10)!==v.slice(0,10))fail();return v;
}
function inventory(bookings,summaries){
 for(const s of summaries){for(const k of ['checkIn','checkOut'])if(Object.hasOwn(s,k))endpoint(s[k]);}
 return bookings.map(r=>{const out={};for(const k of bookingFields)if(Object.hasOwn(r,k))out[k]=r[k];for(const k of ['checkIn','checkOut'])if(Object.hasOwn(out,k))endpoint(out[k]);
  if(!Object.hasOwn(out,'checkIn')||!Object.hasOwn(out,'checkOut')){const matches=summaries.filter(s=>s.bookingNumber===out.bookingNumber);if(matches.length!==1||!Object.hasOwn(matches[0],'checkIn')||!Object.hasOwn(matches[0],'checkOut'))fail();for(const k of ['checkIn','checkOut']){if(Object.hasOwn(out,k)&&new Date(out[k]).getTime()!==new Date(matches[0][k]).getTime())fail();out[k]=matches[0][k];}}
  if(new Date(out.checkIn).getTime()>=new Date(out.checkOut).getTime())fail();return out;});
}
export async function readGuestBookingAllocationEvidence(checkIn,checkOut){
 try{
  // Bound before asking the inventory projector to enumerate nights.
  const nights=(new Date(checkOut).getTime()-new Date(checkIn).getTime())/86400000;if(!Number.isSafeInteger(nights)||nights<1||nights>800)fail('UNSUPPORTED_PLAN');
  const raw=await scan('RoomBookingClaimEvents',claimFields),ledger=raw.map(claim),sidecar=raw.map(r=>[r._id,r._owner??null,r._createdDate??null,r._updatedDate??null]);
  const bookings=await scan('Bookings',bookingFields),summaries=await scan('BookingSummary',summaryFields);
  const full=buildInventorySnapshot(inventory(bookings,summaries),checkIn,checkOut),snapshot={occupiedUnits:full.occupiedUnits,occupiedUnitsByNight:full.occupiedUnitsByNight,migrationIssueRows:full.migrationIssueRows,duplicateUnitClaims:full.duplicateUnitClaims,unknownStatusRows:full.unknownStatusRows};
  const planningEvidence=[1,snapshot,ledger,sidecar];budget(planningEvidence);return {status:'READY',inventorySnapshot:snapshot,claimLedger:ledger,planningEvidence};
 }catch(e){return {status:'UNRESOLVED',reason:['BUDGET','UNSUPPORTED_PLAN'].includes(e.message)?e.message:'EVIDENCE'};}
}
