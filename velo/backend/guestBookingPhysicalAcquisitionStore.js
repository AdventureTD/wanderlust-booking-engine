import wixData from 'wix-data';
import { validateRetainedClaimLedger } from 'backend/guestBookingAllocationRetainedRules';
// Private W01 transport. Fixed ledger only; activation remains prohibited.
const query=wixData.query;
// Captured two-pass/core boundary reused from the byte-verified planner.
const ownKeys = Reflect.ownKeys;
const descriptor = Object.getOwnPropertyDescriptor;
const prototype = Object.getPrototypeOf;
const define = Object.defineProperty;
const create = Object.create;
const same = Object.is;
const isArray = Array.isArray;
const isInteger = Number.isInteger;
const text = String;
const SafeError = Error;
const OBJECT_PROTO = Object.prototype;
const ARRAY_PROTO = Array.prototype;
const ENVELOPE = ['inventorySnapshot','claimLedger','groupRequests','primaryOperationId'];
const SNAPSHOT = ['occupiedUnits','occupiedUnitsByNight','migrationIssueRows','duplicateUnitClaims','unknownStatusRows'];
const REQUEST = ['operationId','bookingNumber','payloadDigest','checkIn','checkOut','roomCode','quantity'];
const ORDER = ['penthouse_apartment','two_bedroom_apartment','adventure_suite'];
function fail() { throw new SafeError('Invalid whole-cart allocation'); }
function put(target, key, value) { define(target,key,{__proto__:null,value,enumerable:true,writable:true,configurable:true}); }
function append(target, value) { put(target,target.length,value); }
function contains(list, value) { for(let i=0;i<list.length;i++) if(list[i]===value) return true; return false; }
function exact(value, fields) {
  if(value===null || typeof value!=='object' || isArray(value)) fail();
  const keys=ownKeys(value);
  if(keys.length!==fields.length) fail();
  for(let i=0;i<keys.length;i++) if(!contains(fields,keys[i])) fail();
}
// Two complete graph passes, not a JSON clone or accessor reads. Private copies
// use ordinary own data descriptors even when source descriptors are readonly.
function capture(value, nodes, ancestors) {
  if(value===null || typeof value==='string' || typeof value==='number' || typeof value==='boolean') return value;
  if(typeof value!=='object' || ancestors.length>=32 || contains(ancestors,value)) fail();
  const proto=prototype(value), array=isArray(value);
  if(array ? proto!==ARRAY_PROTO : proto!==null && proto!==OBJECT_PROTO) fail();
  const keys=ownKeys(value), ds=[], copy=array?[]:create(proto);
  for(let i=0;i<keys.length;i++) {
    const key=keys[i];
    if(typeof key!=='string' || (array && key!==(i===keys.length-1?'length':text(i)))) fail();
    const d=descriptor(value,key);
    if(!d || !descriptor(d,'value') || d.enumerable!==(array && key==='length'?false:true)) fail();
    if(array && key==='length' && (d.value!==keys.length-1 || d.configurable!==false)) fail();
    append(ds,d);
  }
  if(prototype(value)!==proto) fail();
  append(nodes,{source:value,proto,keys,ds});
  append(ancestors,value);
  for(let i=0;i<keys.length;i++) if(!(array && keys[i]==='length')) put(copy,keys[i],capture(ds[i].value,nodes,ancestors));
  ancestors.length-=1;
  return copy;
}
function stable(first, second) {
  if(first.length!==second.length) fail();
  for(let n=0;n<first.length;n++) {
    const a=first[n], b=second[n];
    if(a.source!==b.source || a.proto!==b.proto || a.keys.length!==b.keys.length) fail();
    for(let i=0;i<a.keys.length;i++) {
      const d=a.ds[i], e=b.ds[i];
      if(a.keys[i]!==b.keys[i] || !same(d.value,e.value) || d.enumerable!==e.enumerable || d.writable!==e.writable || d.configurable!==e.configurable) fail();
    }
  }
}
function detach(input) {
  try {
    const first=[],second=[];
    const result=capture(input,first,[]);
    capture(input,second,[]);
    stable(first,second);
    return result;
  } catch (_) { fail(); }
}
// The older core intentionally uses live built-ins. Capture their complete
// reachable descriptor closure at module load and refuse changed intrinsics
// after caller traps, before delegating. Never patch globals. The retained
// validator uses the same guard for its static core-derived grammar.
const GLOBAL = globalThis;
const GLOBAL_NAMES = ['Object','Array','Number','String','RegExp','Date','Math','JSON','Reflect','Error','Function','isNaN'];
function intrinsicClosure() {
  const objects=[], nodes=[], bindings=[];
  for(let i=0;i<GLOBAL_NAMES.length;i++) {
    const d=descriptor(GLOBAL,GLOBAL_NAMES[i]); append(bindings,d);
    if(d && descriptor(d,'value')) append(objects,d.value);
  }
  for(let n=0;n<objects.length;n++) {
    const value=objects[n];
    if(value===null || (typeof value!=='object' && typeof value!=='function')) continue;
    let visited=false;
    for(let i=0;i<nodes.length;i++) if(nodes[i].value===value) visited=true;
    if(visited) continue;
    const proto=prototype(value), keys=ownKeys(value), ds=[];
    append(nodes,{value,proto,keys,ds});
    if(proto!==null) append(objects,proto);
    for(let i=0;i<keys.length;i++) {
      const d=descriptor(value,keys[i]); append(ds,d);
      if(descriptor(d,'value')) { if(d.value!==null && (typeof d.value==='object' || typeof d.value==='function')) append(objects,d.value); }
      else { if(d.get) append(objects,d.get); if(d.set) append(objects,d.set); }
    }
  }
  return {bindings,nodes};
}
const INTRINSICS = intrinsicClosure();
function descriptorEqual(a,b) {
  if(!a || !b) return false;
  const fields=['value','get','set','enumerable','configurable','writable'];
  for(let i=0;i<fields.length;i++) {
    const d=descriptor(a,fields[i]), e=descriptor(b,fields[i]);
    if(!!d!==!!e || (d && !same(d.value,e.value))) return false;
  }
  return true;
}
function guardCoreIntrinsics() {
  for(let i=0;i<GLOBAL_NAMES.length;i++) if(!descriptorEqual(INTRINSICS.bindings[i],descriptor(GLOBAL,GLOBAL_NAMES[i]))) fail();
  for(let n=0;n<INTRINSICS.nodes.length;n++) {
    const node=INTRINSICS.nodes[n], keys=ownKeys(node.value);
    if(prototype(node.value)!==node.proto || keys.length!==node.keys.length) fail();
    for(let i=0;i<keys.length;i++) if(keys[i]!==node.keys[i] || !descriptorEqual(node.ds[i],descriptor(node.value,keys[i]))) fail();
  }
}

const keys=Reflect.ownKeys,desc=Object.getOwnPropertyDescriptor,proto=Object.getPrototypeOf,apply=Reflect.apply;
const objectProto=Object.prototype,arrayProto=Array.prototype,dateProto=Date.prototype,getTime=Date.prototype.getTime,toISO=Date.prototype.toISOString;
const claimFields=['_id','protocolVersion','claimKey','eventType','claimType','generation','night','capacitySlot','unit','operationId','payloadDigest','bookingNumber','bookingRowId','releaseReason','manifestVersion','manifestCheckIn','manifestCheckOut','manifestRoomCode','manifestUnits','manifestBookingRowIds','manifestResourceClaimIds','completionState','confirmedResourceCount','decisionFenceVersion','operationIdentityId','operationCompletionId','decisionState'];
const base=['_id','protocolVersion','claimKey','generation','eventType','claimType','operationId','bookingRowId','bookingNumber','payloadDigest'];
const manifest=['manifestVersion','manifestCheckIn','manifestCheckOut','manifestRoomCode','manifestUnits','manifestBookingRowIds','manifestResourceClaimIds'];
const metadata=['_owner','_createdDate','_updatedDate'];
const bookingFields=['_id','bookingNumber','status','checkIn','checkOut','assignedRoom','quantity','roomCode','autoOwnerBlock'];
const summaryFields=['_id','bookingNumber','checkIn','checkOut'];
function evidenceFail(reason='UNKNOWN'){throw new SafeError(reason);}
function bytes(s){let n=0;for(const c of s){const v=c.codePointAt(0);n+=v<128?1:v<2048?2:v<65536?3:4;}return n;}
function budget(value){if(bytes(JSON.stringify(value))>400000)evidenceFail('BUDGET');}
function id(v){return typeof v==='string'&&v.length>0&&v.length<=128&&/^[\x20-\x7e]+$/.test(v);}
function nativeDate(v){if(proto(v)!==dateProto||keys(v).length)evidenceFail();const a=apply(getTime,v,[]),b=apply(getTime,v,[]);if(!Number.isSafeInteger(a)||!same(a,b)||proto(v)!==dateProto||keys(v).length)evidenceFail();return a;}
function snapshotRow(value,allowed){
 if(!value||typeof value!=='object'||proto(value)!==objectProto)evidenceFail();
 const k=keys(value),first=[],out={};if(k.length>allowed.length+3)evidenceFail();
 for(const name of k){if(typeof name!=='string'||(!allowed.includes(name)&&!metadata.includes(name)))evidenceFail();const d=desc(value,name);if(!d||!desc(d,'value')||!d.enumerable)evidenceFail();let v=d.value;if(name==='_createdDate'||name==='_updatedDate')v=nativeDate(v);else if(name==='_owner'){if(typeof v!=='string'||v.length>256)evidenceFail();}else if((name==='checkIn'||name==='checkOut')&&v!==null&&typeof v==='object'){nativeDate(v);v=apply(toISO,v,[]);}else if(v!==null&&typeof v!=='string'&&typeof v!=='number'&&typeof v!=='boolean')evidenceFail();if(typeof v==='number'&&(!Number.isFinite(v)||same(v,-0)))evidenceFail();if(typeof v==='string'&&v.length>60000)evidenceFail();first.push(d);out[name]=v;}
 const again=keys(value);if(again.length!==k.length)evidenceFail();for(let i=0;i<k.length;i++){const d=desc(value,k[i]),a=first[i];if(again[i]!==k[i]||!d||!desc(d,'value')||!same(d.value,a.value)||d.enumerable!==a.enumerable||d.configurable!==a.configurable||d.writable!==a.writable)evidenceFail();if(k[i]==='_createdDate'||k[i]==='_updatedDate'){if(nativeDate(d.value)!==out[k[i]])evidenceFail();}else if((k[i]==='checkIn'||k[i]==='checkOut')&&d.value!==null&&typeof d.value==='object'){if(apply(toISO,d.value,[])!==out[k[i]])evidenceFail();}}if(proto(value)!==objectProto||!id(out._id))evidenceFail();return out;
}
function page(value,allowed){
 const d=desc(value,'items');if(!d||!desc(d,'value')||!d.enumerable)evidenceFail();const source=d.value;if(!Array.isArray(source)||proto(source)!==arrayProto)evidenceFail();
 const ak=keys(source),length=desc(source,'length');if(!length||length.value>100||ak.length!==length.value+1)evidenceFail();const items=[],ds=[];
 for(let i=0;i<length.value;i++){if(ak[i]!==String(i))evidenceFail();const r=desc(source,String(i));if(!r||!desc(r,'value')||!r.enumerable)evidenceFail();ds.push(r);items.push(snapshotRow(r.value,allowed));}
 const chain=[];let p=value,method;for(let depth=0;p!==null&&depth<=8;depth++){const pk=keys(p),pd=pk.map(k=>desc(p,k));chain.push([p,proto(p),pk,pd]);const m=desc(p,'hasNext');if(m){if(!desc(m,'value')||typeof m.value!=='function')evidenceFail();method=m.value;break;}p=proto(p);}if(!method)evidenceFail();const more=apply(method,value,[]);if(typeof more!=='boolean')evidenceFail();
 for(const [node,pr,k,descriptors] of chain){const now=keys(node);if(proto(node)!==pr||now.length!==k.length)evidenceFail();for(let i=0;i<k.length;i++){const a=descriptors[i],b=desc(node,k[i]);if(now[i]!==k[i]||!b||!same(a.value,b.value)||a.get!==b.get||a.set!==b.set||a.writable!==b.writable||a.enumerable!==b.enumerable||a.configurable!==b.configurable)evidenceFail();}if(proto(node)!==pr)evidenceFail();}
 const closingKeys=keys(source);if(proto(source)!==arrayProto||closingKeys.length!==ak.length||!descriptorEqual(length,desc(source,'length')))evidenceFail();for(let i=0;i<ak.length;i++)if(closingKeys[i]!==ak[i])evidenceFail();for(let i=0;i<items.length;i++){const r=desc(source,String(i));if(!descriptorEqual(ds[i],r)||JSON.stringify(snapshotRow(r.value,allowed))!==JSON.stringify(items[i]))evidenceFail();}if(proto(source)!==arrayProto)evidenceFail();const out=create(null);out.items=items;out.more=more;return out;
}
async function scan(collection,allowed,scope){try{let cursor=null;const rows=[];for(let n=0;n<100;n++){let q=apply(query,wixData,[collection]);if(cursor!==null)q=q.gt('_id',cursor);q=q.ascending('_id').limit(100);const find=q.find;if(scope)scope.reserveExact();const raw=await apply(find,q,[{suppressAuth:true,suppressHooks:true,consistentRead:true}]);guardCoreIntrinsics();const p=page(raw,allowed);guardCoreIntrinsics();if(scope)scope.chargeBytes(admittedClaimPageBytes(p.items));for(const r of p.items){if(cursor!==null&&r._id<=cursor)evidenceFail();cursor=r._id;rows.push(r);}budget(rows);if(!p.more){const out=create(null);out.rows=rows;return out;}if(p.items.length!==100)evidenceFail();}evidenceFail('BUDGET');}catch(e){if(scope)scope.poison();throw e;}}
function claim(row){
 let expected=[...base];switch(row.claimType){case 'operation':expected.push(...manifest);if(Object.hasOwn(row,'decisionFenceVersion'))expected.push('decisionFenceVersion');break;case 'operation-completion':expected.push('completionState','confirmedResourceCount');if(Object.hasOwn(row,'decisionFenceVersion'))expected.push('decisionFenceVersion');break;case 'operation-decision':expected.push('decisionFenceVersion','operationIdentityId','operationCompletionId','manifestVersion','completionState','confirmedResourceCount','decisionState');break;case 'capacity':case 'unit':expected.push('night',row.claimType==='capacity'?'capacitySlot':'unit');if(row.eventType==='release')expected.push('releaseReason');break;default:evidenceFail();}
 const present=keys(row).filter(k=>!metadata.includes(k));if(present.length!==expected.length||expected.some(k=>!present.includes(k)))evidenceFail();const out={};for(const k of claimFields)if(present.includes(k)){const v=row[k];if(typeof v!=='string'&&typeof v!=='number')evidenceFail();if(typeof v==='number'&&(!Number.isSafeInteger(v)||same(v,-0)))evidenceFail();out[k]=v;}return out;
}

function answer(status,extra){const out=create(null);out.status=status;if(extra)for(const k of keys(extra))put(out,k,extra[k]);return out;}
function equal(a,b){return JSON.stringify(claim(a))===JSON.stringify(claim(b));}
function need(v){if(!v)evidenceFail('UNKNOWN');return v;}
function check(v){if(!v)evidenceFail('INTEGRITY');}

const insert=wixData.insert;
export function guardGuestBookingPhysicalAcquisition(){guardCoreIntrinsics();}
export function copyGuestBookingPhysicalAcquisition(value){const v=detach(value);guardCoreIntrinsics();return v;}
export function equalGuestBookingPhysicalClaim(a,b){guardCoreIntrinsics();return equal(a,b);}
export function validateGuestBookingPhysicalLedger(rows){const v=detach(rows);guardCoreIntrinsics();validateRetainedClaimLedger(v);guardCoreIntrinsics();}
function admittedClaimPageBytes(items){let total=2;for(let i=0;i<items.length;i++){const row=create(null);for(const key of keys(items[i]))put(row,key,key==='_createdDate'||key==='_updatedDate'?apply(toISO,new Date(items[i][key]),[]):items[i][key]);total+=bytes(JSON.stringify(row))+(i?1:0);}return total;}
export async function scanGuestBookingPhysicalClaims(scope){try{const r=await scan('RoomBookingClaimEvents',claimFields,scope);guardCoreIntrinsics();return answer('FOUND',{rows:r.rows.map(claim)});}catch(e){if(scope)scope.poison();throw e;}}
export async function readGuestBookingPhysicalClaim(id,scope){return readPhysicalClaim(id,scope);}
async function readPhysicalClaim(id,scope,token){
 try{
 guardCoreIntrinsics();check(typeof id==='string'&&/^rc1-[A-Za-z0-9_-]+$/.test(id));
 const q=apply(query,wixData,['RoomBookingClaimEvents']).eq('_id',id).limit(2),find=q.find;
 if(scope){if(token)scope.beginReadback(token,'RoomBookingClaimEvents',id);else scope.reserveExact();}
 const raw=await apply(find,q,[{suppressAuth:true,suppressHooks:true,consistentRead:true}]);guardCoreIntrinsics();
 const p=page(raw,claimFields);guardCoreIntrinsics();check(p.items.length<=1);need(!p.more);
 if(scope){const cost=admittedClaimPageBytes(p.items);if(token)scope.settleReadback(token,cost);else scope.chargeBytes(cost);}
 if(!p.items.length){if(token)scope.poison();return answer('ABSENT');}const row=claim(p.items[0]);check(row._id===id);return answer('FOUND',{record:row});
 }catch(e){if(scope)scope.poison();throw e;}
}
export async function reconcileGuestBookingPhysicalClaim(candidate,scope){
 try{
 const row=claim(detach(candidate));guardCoreIntrinsics();
 let token;if(scope){const applicationBytes=bytes(JSON.stringify(row));if(applicationBytes>400000)evidenceFail('BUDGET');token=scope.reserveMutationReadback('RoomBookingClaimEvents',row._id,applicationBytes+4096+2);scope.startMutation(token,'RoomBookingClaimEvents',row._id);}
 try{await apply(insert,wixData,['RoomBookingClaimEvents',row,{suppressAuth:true,suppressHooks:true}]);}catch{}
 guardCoreIntrinsics();const found=await readPhysicalClaim(row._id,scope,token);guardCoreIntrinsics();
 if(found.status!=='FOUND')return answer('UNKNOWN');
 // Opposite ownership is never adopted as physical success; fresh evidence resolves contention.
 const matching=equal(found.record,row);if(!matching&&scope)scope.poison();return answer(matching?'ACQUISITION_PENDING':'UNKNOWN');
 }catch(e){if(scope)scope.poison();throw e;}
}
