import wixData from 'wix-data';
import { Buffer } from 'buffer';

// Private transport only. No ACK, duplicate exception or digest grants authority.
const schemas={
 Bookings:['_id','roomCode','assignedRoom','quantity','checkIn','checkOut','bookingNumber','operationId','payloadDigest','guests','note','status'],
 BookingSummary:['_id','bookingNumber','bookingDate','checkIn','checkOut','guestName','guestEmail','guestPhone','marketSource','notes','packageTitle','roomCount','status'],
 GuestBookingCompletions:['_id','schemaVersion','kind','outcome','acceptanceId','operationId','audience','rootDigest','manifestId','manifestDigest','admissionId','cartDirectionId','bookingNumber','primaryBookingRowId','projectionCanonical','projectionDigest','bookingRowsCanonical','bookingRowsDigest','summaryId','summaryCanonical','summaryDigest','financialDigest','recipient','recipientBindingDigest']
};
const metadata=['_owner','_createdDate','_updatedDate'];
function fail(){throw Error('INTEGRITY');}
function answer(status,record){return Object.assign(Object.create(null),{status},record?{record}:{});}
function key(c,id){return typeof id==='string'&&(c==='Bookings'?/^pb1-cg2_[A-Za-z0-9_-]{43}_[pta]-r[1-4]$/:c==='BookingSummary'?/^gbs1-[a-f0-9]{64}$/:/^gbc1-[a-f0-9]{64}$/).test(id);}
export function canonicalGuestBookingCompletionRecord(collection,value){
 const fields=schemas[collection];if(!fields||!value||Object.getPrototypeOf(value)!==Object.prototype)fail();
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value),out={},envelope={};
 if(keys.length<fields.length||keys.length>fields.length+3)fail();
 for(const k of keys){const d=ds[k];if(typeof k!=='string'||(!fields.includes(k)&&!metadata.includes(k))||!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();let v=d.value;
  if(metadata.includes(k)){if(k==='_owner'){if(v!==null&&(typeof v!=='string'||v.length>256))fail();}else{if(!v||Object.getPrototypeOf(v)!==Date.prototype||Reflect.ownKeys(v).length)fail();const t=Date.prototype.getTime.call(v);if(!Number.isSafeInteger(t))fail();v=Date.prototype.toISOString.call(v);}}
  else if(typeof v!=='string'&&!(typeof v==='number'&&Number.isSafeInteger(v)&&!Object.is(v,-0)))fail();
  envelope[k]=v;
 }
 for(const k of fields){if(!Object.hasOwn(ds,k))fail();out[k]=ds[k].value;}
 if(!key(collection,out._id))fail();
 const numeric=collection==='Bookings'?['assignedRoom','quantity','guests']:collection==='BookingSummary'?['roomCount']:['schemaVersion'];
 for(const k of fields)if(numeric.includes(k)?typeof out[k]!=='number':typeof out[k]!=='string')fail();
 if(collection==='Bookings'&&(out.status!=='pending'||out.quantity!==1||out.guests<1))fail();
 if(collection==='BookingSummary'&&(out.status!=='pending'||out.roomCount<1||out.roomCount>4))fail();
 if(collection==='GuestBookingCompletions'&&(out.schemaVersion!==1||out.kind!=='booking-completion'||out.outcome!=='CONFIRMED'))fail();
 const now=Object.getOwnPropertyDescriptors(value);if(Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(now).length!==keys.length)fail();
 for(const k of keys){const a=ds[k],b=now[k];if(!b||!Object.is(a.value,b.value)||a.get!==b.get||a.set!==b.set||a.enumerable!==b.enumerable||a.writable!==b.writable||a.configurable!==b.configurable)fail();}
 if(Buffer.byteLength(JSON.stringify(envelope),'utf8')>400000)throw Error('UNKNOWN');
 const canonical=JSON.stringify(out);if(Buffer.byteLength(canonical,'utf8')>400000)throw Error('UNKNOWN');return canonical;
}
export function createGuestBookingCompletionStore(scope){
 if(!scope||typeof scope.reserveExact!=='function'||typeof scope.chargeBytes!=='function'||typeof scope.measure!=='function'||typeof scope.reserveMutationReadback!=='function')fail();
 let selection=null;
 const options=()=>({suppressAuth:true,suppressHooks:true,consistentRead:true});
 function admitPage(c,items,token){
  let size=2;const rows=[];
  for(let i=0;i<items.length;i++){
   const item=items[i],text=canonicalGuestBookingCompletionRecord(c,item),envelope=Object.create(null);
   // Native admission above precedes detached scalar envelope construction.
   for(const k of Reflect.ownKeys(item)){const d=Object.getOwnPropertyDescriptor(item,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();envelope[k]=k==='_createdDate'||k==='_updatedDate'?Date.prototype.toISOString.call(d.value):d.value;}
   size+=Buffer.byteLength(JSON.stringify(envelope),'utf8')+(i?1:0);rows.push(JSON.parse(text));
  }
  if(token)scope.settleReadback(token,size);else scope.chargeBytes(size);
  return rows;
 }
 function page(raw,max){const d=Object.getOwnPropertyDescriptor(raw,'items');if(!d||!Object.hasOwn(d,'value')||!Array.isArray(d.value)||d.value.length>max)fail();const items=d.value;
  if(Reflect.ownKeys(items).length!==items.length+1)fail();for(let i=0;i<items.length;i++){const x=Object.getOwnPropertyDescriptor(items,String(i));if(!x||!Object.hasOwn(x,'value')||!x.enumerable)fail();}
  let p=raw,method;for(let depth=0;p&&depth<8;depth++,p=Object.getPrototypeOf(p)){const m=Object.getOwnPropertyDescriptor(p,'hasNext');if(m){if(!Object.hasOwn(m,'value')||typeof m.value!=='function')fail();method=m.value;break;}}
  if(!method)fail();const more=method.call(raw);if(typeof more!=='boolean')fail();return {items,more};
 }
 async function exact(c,id,token){try{if(!schemas[c]||!key(c,id))fail();if(token)scope.beginReadback(token,c,id);else scope.reserveExact();const raw=await wixData.query(c).eq('_id',id).limit(2).find(options());const p=page(raw,2),rows=admitPage(c,p.items,token);if(rows.length>1)fail();if(p.more)throw Error('UNKNOWN');if(!rows.length)return answer('ABSENT');const record=rows[0];if(record._id!==id)fail();return answer('FOUND',record);}catch(e){scope.poison();return answer(e.message==='INTEGRITY'?'INTEGRITY':'UNKNOWN');}}
 async function scan(c,field,value){try{if(!schemas[c]||!(c==='GuestBookingCompletions'?['acceptanceId']:['bookingNumber','operationId']).includes(field)||typeof value!=='string')fail();let cursor=null;const rows=[];
  for(let n=0;n<100;n++){scope.reserveExact();let q=wixData.query(c).eq(field,value);if(cursor!==null)q=q.gt('_id',cursor);const p=page(await q.ascending('_id').limit(100).find(options()),100);
   for(const row of admitPage(c,p.items)){if(row[field]!==value||(cursor!==null&&row._id<=cursor))fail();cursor=row._id;rows.push(row);}
   if(!p.more)return Object.assign(answer('FOUND'),{rows});if(p.items.length!==100)fail();
  }throw Error('UNKNOWN');
 }catch(e){scope.poison();return answer(e.message==='INTEGRITY'?'INTEGRITY':'UNKNOWN');}}
 async function insert(c,candidate){try{const text=canonicalGuestBookingCompletionRecord(c,candidate),row=JSON.parse(text);
   if(selection&&(selection.collection!==c||selection.text!==text))fail();
   const token=selection?selection.token:scope.reserveMutationReadback(c,row._id,Buffer.byteLength(text,'utf8')+4096+2);
   scope.startMutation(token,c,row._id);
   try{await wixData.insert(c,row,{suppressAuth:true,suppressHooks:true});}catch{}
   const found=await exact(c,row._id,token);if(found.status!=='FOUND'){scope.poison();return answer(found.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');}
   if(canonicalGuestBookingCompletionRecord(c,found.record)!==text)fail();return found;
  }catch(e){scope.poison();return answer(e.message==='INTEGRITY'?'INTEGRITY':'UNKNOWN');}}
 return Object.assign(Object.create(null),{
  reserveSelection:(c,row)=>{if(selection)fail();const text=canonicalGuestBookingCompletionRecord(c,row);selection={collection:c,text,token:scope.reserveMutationReadback(c,row._id,Buffer.byteLength(text,'utf8')+4096+2)};},
  exact:(c,id,category='target-exact')=>scope.measure(category,()=>exact(c,id)),
  scan:(c,field,value,category=c==='BookingSummary'?'summary-identity':field==='operationId'?'class-identity':'booking-identity')=>scope.measure(category,()=>scan(c,field,value)),
  insert:(c,row)=>scope.measure('selected-readback',()=>insert(c,row))
 });
}
