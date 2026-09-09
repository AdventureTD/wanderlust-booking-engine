import wixData from 'wix-data';
import { readGuestBookingAcceptance } from 'backend/guestBookingAcceptanceStore';
import { validateGuestBookingAcceptanceRoot } from 'backend/guestBookingAcceptance';
import { readGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestStore';
import { buildGuestBookingAllocationBinding, validateGuestBookingAllocationManifest } from 'backend/guestBookingAllocationManifestRules';
import { validateRetainedClaimLedger } from 'backend/guestBookingAllocationRetainedRules';
import { readGuestBookingAcquisitionControl } from 'backend/guestBookingAcquisitionControlStore';
import { canonicalGuestBookingAcquisitionControl } from 'backend/guestBookingAcquisitionControlRules';

// Read-only conditional evidence. Requires immutable create-only rc1 storage and
// independently enforced compliant writers BEFORE effectful activation. No caller
// witness flags, foreign control recursion, inventory projection or resource writes.
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
async function scan(collection,allowed,scope){try{let cursor=null;const rows=[],pages=[];for(let n=0;n<100;n++){let q=apply(query,wixData,[collection]);if(cursor!==null)q=q.gt('_id',cursor);q=q.ascending('_id').limit(100);const find=q.find;if(scope)scope.reserveExact();const raw=await apply(find,q,[{suppressAuth:true,suppressHooks:true,consistentRead:true}]);guardCoreIntrinsics();const p=page(raw,allowed);guardCoreIntrinsics();if(scope)scope.chargeBytes(admittedClaimPageBytes(p.items));pages.push(detach(p));for(const r of p.items){if(cursor!==null&&r._id<=cursor)evidenceFail();cursor=r._id;rows.push(r);}budget(rows);if(!p.more){const out=create(null);out.rows=rows;out.pages=pages;return out;}if(p.items.length!==100)evidenceFail();}evidenceFail('BUDGET');}catch(e){if(scope)scope.poison();throw e;}}
function claim(row){
 let expected=[...base];switch(row.claimType){case 'operation':expected.push(...manifest);if(Object.hasOwn(row,'decisionFenceVersion'))expected.push('decisionFenceVersion');break;case 'operation-completion':expected.push('completionState','confirmedResourceCount');if(Object.hasOwn(row,'decisionFenceVersion'))expected.push('decisionFenceVersion');break;case 'operation-decision':expected.push('decisionFenceVersion','operationIdentityId','operationCompletionId','manifestVersion','completionState','confirmedResourceCount','decisionState');break;case 'capacity':case 'unit':expected.push('night',row.claimType==='capacity'?'capacitySlot':'unit');if(row.eventType==='release')expected.push('releaseReason');break;default:evidenceFail();}
 const present=keys(row).filter(k=>!metadata.includes(k));if(present.length!==expected.length||expected.some(k=>!present.includes(k)))evidenceFail();const out={};for(const k of claimFields)if(present.includes(k)){const v=row[k];if(typeof v!=='string'&&typeof v!=='number')evidenceFail();if(typeof v==='number'&&(!Number.isSafeInteger(v)||same(v,-0)))evidenceFail();out[k]=v;}return out;
}

function answer(status,extra){const out=create(null);out.status=status;if(extra)for(const k of keys(extra))put(out,k,extra[k]);return out;}
function equal(a,b){return JSON.stringify(claim(a))===JSON.stringify(claim(b));}
function need(v){if(!v)evidenceFail('UNKNOWN');return v;}
function check(v){if(!v)evidenceFail('INTEGRITY');}
// Private no-argument factory: bookkeeping only, never caller authority. Each
// coordinator owns one closure across all reloads; concurrent invocations do not
// share/reset it. reserveExact reserves one imminent transport read, including
// reconciliation readback BEFORE its insert, so exhaustion cannot dispatch it.
export function createGuestBookingAcquisitionReadScope(){
 let reads=0,spentBytes=0,heldFinds=0,heldBytes=0,mutations=0,heldMutation=0,stopped=false;
 const reservations=new WeakMap(),verifications=new WeakMap(),scope=create(null),categories=create(null);
 let category='physical',activeVerification=null,pendingVerifications=0;
 let physicalPass=null;
 function frozenCopy(value){const out=detach(value);function freeze(v){if(v&&typeof v==='object'){for(const k of keys(v))freeze(v[k]);Object.freeze(v);}return v;}return freeze(out);}
 function current(token){if(stopped||!physicalPass||physicalPass.token!==token)deny();return physicalPass;}
 scope.beginPhysicalPass=function(A){if(stopped||physicalPass?.reading)deny();const token=Object.freeze(create(null));physicalPass={token,A,reading:true,loading:false,attempted:false,data:null,complete:false};return token;};
 scope.readPhysicalPass=async function(token,root,manifest,anchor){
  const pass=current(token);if(!pass.reading||pass.loading||pass.attempted)deny();pass.loading=true;pass.attempted=true;
  try{
   // Only the existing private physical reader supplies these natively admitted,
   // already charged arguments. Freeze before traversal; never reuse across passes.
   // Removing duplicate reads assumes immutable create-only bindings/compliant
   // writers: it cannot detect a transient datastore replacement at a removed read.
   const originals={root,manifest,anchor},opening=[];
   const tuple=frozenCopy(capture(originals,opening,[]));guardCoreIntrinsics();
   const admitted=()=>{if(current(token)!==pass||!pass.reading||!pass.loading)deny();return tuple;};
   return await readScopedEvidence(pass.A,scope,data=>{
    if(current(token)!==pass||!pass.reading)deny();
    const closing=[];capture(originals,closing,[]);stable(opening,closing);guardCoreIntrinsics();
    // Compare ORIGINAL arguments, not the private frozen tuple with itself.
    check(JSON.stringify(root)===JSON.stringify(data.accepted)&&JSON.stringify(manifest)===JSON.stringify(data.record));
    check(canonicalGuestBookingAcquisitionControl(anchor)===canonicalGuestBookingAcquisitionControl(data.anchor));
    pass.data=frozenCopy(data);
   },admitted);
  }catch(e){scope.poison();throw e;}finally{pass.loading=false;}
 };
 scope.hasTerminalPass=token=>!!current(token).data;
 scope.passLookup=function(token,collection,id){const p=current(token);if(!p.reading||!p.data)deny();const entries=collection==='GuestBookingAcquisitionControls'?p.data.controls:collection==='RoomBookingClaimEvents'?p.data.resources:null;if(!entries)deny();const entry=entries.find(e=>e.id===id);if(!entry)deny();return detach(entry.outcome);};
 scope.passLedger=function(token){const p=current(token);if(!p.reading||!p.data)deny();return detach(p.data.rawLedger).map(claim);};
 scope.finishPhysicalPass=function(token,complete){const p=current(token);if(!p.reading)deny();p.reading=false;p.complete=complete===true&&!!p.data;if(!p.complete)p.data=null;};
 scope.passModel=function(token,A){const p=current(token);if(p.reading||!p.complete||p.A!==A||!p.data)deny();return detach({accepted:p.data.accepted,record:p.data.record});};
 const names=['physical','model-root','model-manifest','early-receipt','early-binding','target-exact','booking-identity','class-identity','summary-identity','final-receipt','selected-readback'];
 for(const name of names)categories[name]={spentFinds:0,spentBytes:0,pages:0};
 scope.measure=async function(name,invoke){if(!names.includes(name)||typeof invoke!=='function')deny();const prior=category;category=name;try{return await invoke();}catch(e){stopped=true;throw e;}finally{category=prior;}};
 function deny(){stopped=true;evidenceFail('UNSUPPORTED_EVIDENCE');}
 function integer(n){if(!Number.isSafeInteger(n)||n<0||same(n,-0))deny();}
 function capacity(findCount,byteCount){
  integer(findCount);integer(byteCount);
  if(stopped||findCount>30000-reads-heldFinds||byteCount>400000-spentBytes-heldBytes)deny();
 }
 function credit(token,state,c,id){
  const r=token&&typeof token==='object'?reservations.get(token):null;
  const bound=state==='held'||state==='inserted';
  if(stopped||!r||r.state!==state||(bound&&(typeof c!=='string'||typeof id!=='string'||r.collection!==c||r.id!==id)))deny();
  return r;
 }
 // Private sequential protocol. The session must derive these capacities from
 // admitted measurements; a detached snapshot is never a reservation token.
 scope.reserveVerification=function(phase,plan){
  if(activeVerification||typeof phase!=='string'||!phase||!plan||typeof plan!=='object')deny();
  const buckets=create(null);let finds=0,bytes=0;
  const keys=Object.keys(plan);if(!keys.length||keys.length>names.length)deny();
  for(const name of keys){
   if(!names.includes(name)||name==='selected-readback')deny();
   const b=plan[name];if(!b||typeof b!=='object')deny();
   integer(b.finds);integer(b.bytes);integer(b.pages);if(b.pages>b.finds)deny();
   buckets[name]={finds:b.finds,bytes:b.bytes,pages:b.pages};finds+=b.finds;bytes+=b.bytes;
  }
  capacity(finds,bytes);const token=Object.freeze(create(null));
  verifications.set(token,{phase,buckets,state:'held'});heldFinds+=finds;heldBytes+=bytes;pendingVerifications++;return token;
 };
 scope.verify=async function(token,phase,invoke){
  const r=token&&typeof token==='object'?verifications.get(token):null;
  if(stopped||activeVerification||!r||r.state!=='held'||r.phase!==phase||typeof invoke!=='function')deny();
  r.state='reading';activeVerification=r;
  try{
   const value=await invoke();if(stopped)deny();
   // Only residual capacity is released. Each consumed find/response remains
   // spent; failure leaves residual holds intact and permanently poisons scope.
   for(const b of Object.values(r.buckets)){heldFinds-=b.finds;heldBytes-=b.bytes;}
   r.state='settled';pendingVerifications--;return value;
  }catch(e){stopped=true;r.state='failed';throw e;}finally{activeVerification=null;}
 };
 function consumeVerification(finds,bytes,pages){
  if(stopped)deny();const b=activeVerification.buckets[category];
  if(!b||finds>b.finds||bytes>b.bytes||pages>b.pages)deny();
  b.finds-=finds;b.bytes-=bytes;b.pages-=pages;heldFinds-=finds;heldBytes-=bytes;
 }
 // Existing native transport signatures consume their active category hold.
 // Without a verification phase these remain ordinary, once-only debits.
 scope.reserveExact=function(){if(activeVerification)consumeVerification(1,0,0);else capacity(1,0);reads++;categories[category].spentFinds++;};
 scope.chargeBytes=function(n){integer(n);if(activeVerification)consumeVerification(0,n,1);else capacity(0,n);spentBytes+=n;categories[category].spentBytes+=n;categories[category].pages++;};
 scope.poison=function(){stopped=true;};
 scope.remaining=function(){return stopped?0:30000-reads-heldFinds;};
 // Only the currently executing physical bucket can satisfy its own preflight.
 scope.physicalRemaining=function(){return scope.remaining()+(stopped||category!=='physical'?0:activeVerification?.buckets.physical?.finds||0);};
 scope.used=function(){return reads;};
 scope.snapshot=function(){return Object.freeze(Object.assign(create(null),{
  spentFinds:reads,spentBytes,heldFinds,heldBytes,spentMutations:mutations,heldMutations:heldMutation,
  categories:Object.freeze(Object.assign(create(null),...names.map(name=>({[name]:Object.freeze(Object.assign(create(null),categories[name]))}))))
 }));};
 // Tokens carry no caller-visible data and are valid only in this closure.
 // Hold count + bytes + the separate mutation slot atomically before insertion.
 // Transport integration is a later bounded part; ACK never settles a token.
 scope.reserveMutationReadback=function(collection,id,byteCapacity){
  if(typeof collection!=='string'||!collection||typeof id!=='string'||!id)deny();
  capacity(1,byteCapacity);if(mutations+heldMutation>=1)deny();
  const token=Object.freeze(create(null));
  reservations.set(token,{collection,id,byteCapacity,state:'held'});
  heldFinds++;heldBytes+=byteCapacity;heldMutation++;return token;
 };
 scope.startMutation=function(token,c,id){if(pendingVerifications)deny();const r=credit(token,'held',c,id);r.state='inserted';heldMutation--;mutations++;};
 scope.beginReadback=function(token,c,id){const r=credit(token,'inserted',c,id);r.state='reading';heldFinds--;reads++;categories['selected-readback'].spentFinds++;};
 scope.settleReadback=function(token,actualBytes){
  const r=credit(token,'reading');integer(actualBytes);
  // Oversize/invalid response ends the invocation; keep holds and spent finds.
  if(actualBytes>r.byteCapacity)deny();
  r.state='settled';heldBytes-=r.byteCapacity;spentBytes+=actualBytes;categories['selected-readback'].spentBytes+=actualBytes;categories['selected-readback'].pages++;
 };
 scope.abandonMutationReadback=function(token,c,id){
  const r=credit(token,'held',c,id);r.state='abandoned';heldFinds--;heldBytes-=r.byteCapacity;heldMutation--;
 };
 scope.read=function(A){return readScopedEvidence(A,scope);};
 return scope;
}
export async function readGuestBookingAcquisitionContentionEvidence(A){
 if(arguments.length!==1)return answer('INTEGRITY');
 return createGuestBookingAcquisitionReadScope().read(A);
}
// Admitted-record envelope bytes, NOT wire bytes or provider quotas. Count JSON
// array brackets/commas once per actual page, including the empty exact page.
// snapshotRow already admitted native dates; restore ISO cost before projection.
function admittedClaimPageBytes(items){
 let total=2;
 for(let i=0;i<items.length;i++){
  const row=create(null);
  for(const key of keys(items[i]))put(row,key,key==='_createdDate'||key==='_updatedDate'?apply(toISO,new Date(items[i][key]),[]):items[i][key]);
  total+=bytes(JSON.stringify(row))+(i?1:0);
 }
 return total;
}
// Called only after the unchanged native acceptance validator succeeds. Owner
// has no 256-unit bound here. Never serialize the SDK root or its Date objects.
function acceptancePageBytes(value){
 const out=create(null);
 for(const k of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw new SafeError('INTEGRITY');const v=d.value;out[k]=k==='_createdDate'||k==='_updatedDate'?Reflect.apply(Date.prototype.toISOString,v,[]):v;if(out[k]!==null&&!['string','number'].includes(typeof out[k]))throw new SafeError('INTEGRITY');}
 let n=2;for(const c of JSON.stringify(out)){const v=c.codePointAt(0);n+=v<128?1:v<2048?2:v<65536?3:4;}return n;
}
async function readScopedEvidence(A,scope,publish,admitted){
 if(typeof A!=='string'||!/^[a-f0-9]{64}$/.test(A))return answer('INTEGRITY');
 try{
  guardCoreIntrinsics();let controlBytes=0;const controls=[],resources=[];
  function retain(entries,id,outcome){entries.push({id,outcome:detach(outcome)});return outcome;}
  function count(){scope.reserveExact();}
  async function control(id){const r=await readGuestBookingAcquisitionControl(id,scope);guardCoreIntrinsics();if(r.status==='INTEGRITY')evidenceFail('INTEGRITY');if(r.status==='ABSENT')return retain(controls,id,answer('ABSENT'));if(r.status!=='FOUND')evidenceFail('UNKNOWN');controlBytes+=bytes(canonicalGuestBookingAcquisitionControl(r.record));if(controlBytes>400000)evidenceFail('UNSUPPORTED_EVIDENCE');return retain(controls,id,r);}
  async function resourceRead(id,expected){check(typeof id==='string'&&/^rc1-[A-Za-z0-9_-]+$/.test(id));let q=apply(query,wixData,['RoomBookingClaimEvents']).eq('_id',id).limit(2);const find=q.find;count();const raw=await apply(find,q,[{suppressAuth:true,suppressHooks:true,consistentRead:true}]);guardCoreIntrinsics();const p=page(raw,claimFields);guardCoreIntrinsics();check(p.items.length<=1);if(p.more)evidenceFail('UNKNOWN');scope.chargeBytes(admittedClaimPageBytes(p.items));const row=p.items.length?claim(p.items[0]):null;if(!row)return retain(resources,id,answer('ABSENT'));if(expected)for(const k of ['_id','protocolVersion','claimKey','generation','eventType','claimType','night','capacitySlot','unit'])check(row[k]===expected[k]);check(row._id===id);return retain(resources,id,answer('FOUND',{record:row}));}
  let root,M,anchor;
  if(admitted){
   const tuple=admitted();root=validateGuestBookingAcceptanceRoot(tuple.root.root);
   check(root!=='DENIED'&&root.root._id===A&&JSON.stringify(root)===JSON.stringify(tuple.root));
   M=tuple.manifest;anchor=tuple.anchor;
   check(M._id===buildGuestBookingAllocationBinding(root).manifestId&&validateGuestBookingAllocationManifest(M,root));
   canonicalGuestBookingAcquisitionControl(anchor);guardCoreIntrinsics();
  }else{
   count();const a=await readGuestBookingAcceptance(A);guardCoreIntrinsics();if(a.status==='INTEGRITY')evidenceFail('INTEGRITY');if(a.status==='ABSENT')scope.chargeBytes(2);need(a.status==='FOUND');root=validateGuestBookingAcceptanceRoot(a.root);check(root!=='DENIED'&&root.root._id===A);scope.chargeBytes(acceptancePageBytes(a.root));
   const binding=buildGuestBookingAllocationBinding(root);count();const m=await readGuestBookingAllocationManifest(binding.manifestId);guardCoreIntrinsics();if(m.status==='INTEGRITY')evidenceFail('INTEGRITY');if(m.status==='ABSENT')scope.chargeBytes(2);need(m.status==='FOUND');scope.chargeBytes(bytes(JSON.stringify([m.record]))+4096);check(validateGuestBookingAllocationManifest(m.record,root));M=m.record;
   // Public contention and trailing fallback retain their native tuple reads.
   const ar=await readGuestBookingAcquisitionControl('ra2-cart-'+A,scope);guardCoreIntrinsics();if(ar.status==='INTEGRITY')evidenceFail('INTEGRITY');need(ar.status==='FOUND');anchor=ar.record;
  }
  // Anchor is separately bounded by the actual manifest validator, not subordinate buffer.
  check(anchor._id==='ra2-cart-'+A&&anchor.kind==='admission'&&anchor.acceptanceId===A&&anchor.manifestId===M._id&&anchor.manifestDigest===M.manifestDigest&&anchor.manifestCanonical===M.manifestCanonical);
  check(validateGuestBookingAllocationManifest({_id:anchor.manifestId,schemaVersion:1,manifestDigest:anchor.manifestDigest,manifestCanonical:anchor.manifestCanonical},root));
  const T=JSON.parse(anchor.manifestCanonical),groups=[];
  let expected=1;for(const p of T[6])expected+=5+3*(p.acquisitions.length-1);expected+=T[6].length;
  if(expected>scope.physicalRemaining())evidenceFail('UNSUPPORTED_EVIDENCE');
  const dr=await control('ra2-direction-'+A),direction=dr.record||null;
  function bound(r){if(r)check(r.admissionId===anchor._id&&r.manifestDigest===M.manifestDigest);}
  bound(direction);
  const positives=[];
  for(let i=0;i<T[5].length;i++){
   const O=T[5][i][0],I=T[6][i].acquisitions[0],R=T[6][i].acquisitions.slice(1);check(I.operationId===O);
   const start=(await control('ra2-start-'+O)).record,rt=(await control('ra2-root-'+O)).record,gates=[];
   bound(start);bound(rt);if(start)check(start.kind==='group-start'&&start.operationId===O);if(rt)check(rt.kind==='root'&&rt.operationId===O&&rt.operationIdentityId===I._id);
   for(let j=0;j<R.length;j++){const g=(await control('ra2-gate-'+O+'-p'+String(j))).record;bound(g);if(g)check(g.kind==='gate'&&g.operationId===O&&g.index===j&&g.rootId==='ra2-root-'+O&&g.resourceClaimId===R[j]._id);gates.push(g);}
   const exactRows=new Map();for(const id of [I._id,...R.flatMap(r=>[r._id,r._id.slice(0,-1)+'r']),'rc1-op-'+O+'-c','rc1-op-'+O+'-d']){const r=await resourceRead(id,R.find(candidate=>candidate._id===id));if(r.record){positives.push(r.record);exactRows.set(id,r.record);}}
   groups.push({O,I,R,start,rt,gates,exactRows});
  }
  const scanResult=await scan('RoomBookingClaimEvents',claimFields,scope);guardCoreIntrinsics();const ledger=scanResult.rows.map(claim),byId=new Map();
  for(const r of ledger){check(!byId.has(r._id));byId.set(r._id,r);}
  for(const r of positives){if(byId.has(r._id))check(equal(byId.get(r._id),r));else{ledger.push(r);byId.set(r._id,r);}}
  if(ledger.length>10000)evidenceFail('UNSUPPORTED_EVIDENCE');budget(ledger);
  // Known local binding contradictions must not be hidden by generic history UNKNOWN.
  for(const g of groups)for(const r of ledger.filter(r=>r.operationId===g.O)){
   check(r.payloadDigest===g.I.payloadDigest&&r.bookingNumber===g.I.bookingNumber);
   if(r.claimType==='operation')check(equal(r,g.I));
   else if(r.claimType==='capacity'||r.claimType==='unit'){
    const id=r.eventType==='release'?r._id.slice(0,-1)+'a':r._id,candidate=g.R.find(c=>c._id===id);check(!!candidate);
    const acquired={...r,_id:id,eventType:'acquire'};delete acquired.releaseReason;check(equal(acquired,candidate));
   }else check(r.bookingRowId===g.I.bookingRowId);
  }
  const inert=detach(ledger);guardCoreIntrinsics();try{validateRetainedClaimLedger(inert);}catch{evidenceFail('UNKNOWN');}guardCoreIntrinsics();
  const causes=[];let commitReady=true;
  for(const g of groups){
   const {O,I,R,start,rt,gates,exactRows}=g,identity=exactRows.get(I._id),events=ledger.filter(r=>r.operationId===O),hasEffects=events.some(r=>r.eventType==='release'||r.claimType==='operation-decision');
   if(start&&start.direction==='skip')check(!rt&&!identity&&!gates.some(Boolean)&&events.length===0);
   if(rt){need(start);check(start.direction==='start');}if(identity){need(rt);check(equal(identity,I));}
   let boundary=-1,prefix=true;
   for(let j=0;j<R.length;j++){
    const gate=gates[j],actual=exactRows.get(R[j]._id),own=actual&&actual.operationId===O;
    if(boundary>=0)check(!gate&&!own);
    if(gate){need(rt&&identity);need(prefix);if(gate.direction==='seal'){check(!own);boundary=j;}}
    if(own){need(gate);check(gate.direction==='acquire');check(equal(actual,R[j]));}
    if(actual&&!own){
     // Exact physical key fields must match even though owner/booking are foreign.
     for(const k of ['_id','protocolVersion','claimKey','generation','eventType','claimType','night','capacitySlot','unit'])check(actual[k]===R[j][k]);
     if(boundary<0)boundary=j;
     if(start&&start.direction==='start'&&rt&&identity&&gate&&gate.direction==='acquire'&&prefix){
      const ownerId='rc1-op-'+actual.operationId+'-a',owner=await resourceRead(ownerId);need(owner.record&&byId.get(ownerId));check(equal(owner.record,byId.get(ownerId)));causes.push({operationId:O,index:j,resourceClaimId:R[j]._id});
     }
    }
    prefix=prefix&&!!own&&!!gate&&gate.direction==='acquire';
   }
   if(hasEffects){need(direction);for(const r of events){if(r.eventType==='release')check(direction.direction==='compensate');if(r.claimType==='operation-decision')check(r.decisionState===direction.direction);}}
   if(start&&start.direction==='skip')need(direction&&direction.direction==='compensate');
   const C=exactRows.get('rc1-op-'+O+'-c');
   const complete=!!(start&&start.direction==='start'&&rt&&identity&&prefix&&C&&C.completionState==='complete'&&C.confirmedResourceCount===R.length&&C.decisionFenceVersion===1&&I.decisionFenceVersion===1&&!events.some(r=>r.eventType==='release'||(r.claimType==='operation-decision'&&r.decisionState!=='commit-rows')));
   commitReady=commitReady&&complete;
   if(events.some(r=>r.claimType==='operation-decision'&&r.decisionState==='commit-rows')&&causes.length)check(false);
  }
  // Cart-wide decision contradictions include groups before/after the cause.
  if(causes.length)check(!ledger.some(r=>groups.some(g=>g.O===r.operationId)&&r.claimType==='operation-decision'&&r.decisionState==='commit-rows'));
  if(direction){
   if(direction.direction==='commit-rows'){check(!causes.length);need(commitReady);}
   else{const g=groups.find(g=>g.O===direction.causeOperationId);check(!!g&&direction.causeIndex<g.R.length&&g.R[direction.causeIndex]._id===direction.causeResourceClaimId);
   need(causes.some(c=>c.operationId===direction.causeOperationId&&c.index===direction.causeIndex&&c.resourceClaimId===direction.causeResourceClaimId));}
  }
  // commitReady alone is insufficient: every exact terminal dependency and
  // every release absence must have actually been queried in this traversal.
  const outcome=id=>resources.find(e=>e.id===id)?.outcome;
  const terminalEligible=direction?.direction==='commit-rows'&&commitReady&&!causes.length&&groups.every(g=>
   g.start?.direction==='start'&&g.rt&&g.gates.every(v=>v?.direction==='acquire')&&
   [g.I._id,...g.R.map(r=>r._id),'rc1-op-'+g.O+'-c','rc1-op-'+g.O+'-d'].every(id=>outcome(id)?.status==='FOUND')&&
   outcome('rc1-op-'+g.O+'-d').record.decisionState==='commit-rows'&&
   g.R.every(r=>outcome(r._id.slice(0,-1)+'r')?.status==='ABSENT'));
  guardCoreIntrinsics();
  if(publish&&terminalEligible)publish({accepted:root,record:M,anchor,controls,resources,rawPages:scanResult.pages,rawLedger:scanResult.rows,reconciledLedger:ledger});
  return answer('EVIDENCED',{direction,causes,commitReady:commitReady&&!causes.length,reads:scope.used()});
 }catch(e){scope.poison();return answer(e.message==='INTEGRITY'?'INTEGRITY':'UNKNOWN',{reason:['BUDGET','UNSUPPORTED_EVIDENCE'].includes(e.message)?'UNSUPPORTED_EVIDENCE':'EVIDENCE'});}
}
