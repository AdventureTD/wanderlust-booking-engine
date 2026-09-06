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
 if(keys(source).length!==ak.length||desc(source,'length').value!==items.length)evidenceFail();for(let i=0;i<items.length;i++){const r=desc(source,String(i));if(!r||r.value!==ds[i].value||JSON.stringify(snapshotRow(r.value,allowed))!==JSON.stringify(items[i]))evidenceFail();}if(proto(source)!==arrayProto)evidenceFail();const out=create(null);out.items=items;out.more=more;return out;
}
async function scan(collection,allowed){let cursor=null;const rows=[];for(let n=0;n<100;n++){let q=apply(query,wixData,[collection]);if(cursor!==null)q=q.gt('_id',cursor);q=q.ascending('_id').limit(100);const find=q.find;const raw=await apply(find,q,[{suppressAuth:true,suppressHooks:true,consistentRead:true}]);guardCoreIntrinsics();const p=page(raw,allowed);guardCoreIntrinsics();for(const r of p.items){if(cursor!==null&&r._id<=cursor)evidenceFail();cursor=r._id;rows.push(r);}budget(rows);if(!p.more){const out=create(null);out.rows=rows;return out;}if(p.items.length!==100)evidenceFail();}evidenceFail('BUDGET');}
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
 let reads=0;
 const scope=create(null);
 scope.reserveExact=function(){if(reads>=30000)evidenceFail('UNSUPPORTED_EVIDENCE');reads++;};
 scope.remaining=function(){return 30000-reads;};
 scope.used=function(){return reads;};
 scope.read=function(A){return readScopedEvidence(A,scope);};
 return scope;
}
export async function readGuestBookingAcquisitionContentionEvidence(A){
 if(arguments.length!==1)return answer('INTEGRITY');
 return createGuestBookingAcquisitionReadScope().read(A);
}
async function readScopedEvidence(A,scope){
 if(typeof A!=='string'||!/^[a-f0-9]{64}$/.test(A))return answer('INTEGRITY');
 try{
  guardCoreIntrinsics();let controlBytes=0;
  function count(){scope.reserveExact();}
  async function control(id){count();const r=await readGuestBookingAcquisitionControl(id);guardCoreIntrinsics();if(r.status==='INTEGRITY')evidenceFail('INTEGRITY');if(r.status==='ABSENT')return answer('ABSENT');if(r.status!=='FOUND')evidenceFail('UNKNOWN');controlBytes+=bytes(canonicalGuestBookingAcquisitionControl(r.record));if(controlBytes>400000)evidenceFail('UNSUPPORTED_EVIDENCE');return r;}
  async function resourceRead(id,expected){count();check(typeof id==='string'&&/^rc1-[A-Za-z0-9_-]+$/.test(id));let q=apply(query,wixData,['RoomBookingClaimEvents']).eq('_id',id).limit(2);const find=q.find,raw=await apply(find,q,[{suppressAuth:true,suppressHooks:true,consistentRead:true}]);guardCoreIntrinsics();const p=page(raw,claimFields);guardCoreIntrinsics();check(p.items.length<=1);if(p.more)evidenceFail('UNKNOWN');if(!p.items.length)return answer('ABSENT');if(expected)for(const k of ['_id','protocolVersion','claimKey','generation','eventType','claimType','night','capacitySlot','unit'])check(p.items[0][k]===expected[k]);const row=claim(p.items[0]);check(row._id===id);return answer('FOUND',{record:row});}
  count();const a=await readGuestBookingAcceptance(A);guardCoreIntrinsics();if(a.status==='INTEGRITY')evidenceFail('INTEGRITY');need(a.status==='FOUND');const root=validateGuestBookingAcceptanceRoot(a.root);check(root!=='DENIED'&&root.root._id===A);
  const binding=buildGuestBookingAllocationBinding(root);count();const m=await readGuestBookingAllocationManifest(binding.manifestId);guardCoreIntrinsics();if(m.status==='INTEGRITY')evidenceFail('INTEGRITY');need(m.status==='FOUND');check(validateGuestBookingAllocationManifest(m.record,root));
  // Anchor is separately bounded by the actual manifest validator, not subordinate buffer.
  count();const ar=await readGuestBookingAcquisitionControl('ra2-cart-'+A);guardCoreIntrinsics();if(ar.status==='INTEGRITY')evidenceFail('INTEGRITY');need(ar.status==='FOUND');const anchor=ar.record,M=m.record;
  check(anchor.kind==='admission'&&anchor.acceptanceId===A&&anchor.manifestId===M._id&&anchor.manifestDigest===M.manifestDigest&&anchor.manifestCanonical===M.manifestCanonical);
  check(validateGuestBookingAllocationManifest({_id:anchor.manifestId,schemaVersion:1,manifestDigest:anchor.manifestDigest,manifestCanonical:anchor.manifestCanonical},root));
  const T=JSON.parse(anchor.manifestCanonical),groups=[];
  let expected=1;for(const p of T[6])expected+=5+3*(p.acquisitions.length-1);expected+=T[6].length;
  if(expected>scope.remaining())evidenceFail('UNSUPPORTED_EVIDENCE');
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
  const scanResult=await scan('RoomBookingClaimEvents',claimFields);guardCoreIntrinsics();const ledger=scanResult.rows.map(claim),byId=new Map();
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
  const causes=[];
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
   if(hasEffects){need(direction);check(direction.direction==='compensate');}
   if(start&&start.direction==='skip')need(direction&&direction.direction==='compensate');
   if(events.some(r=>r.claimType==='operation-decision'&&r.decisionState==='commit-rows')&&causes.length)check(false);
  }
  // Cart-wide decision contradictions include groups before/after the cause.
  if(causes.length)check(!ledger.some(r=>groups.some(g=>g.O===r.operationId)&&r.claimType==='operation-decision'&&r.decisionState==='commit-rows'));
  if(direction){
   if(direction.direction==='commit-rows'){if(causes.length)evidenceFail('INTEGRITY');return answer('UNKNOWN',{reason:'UNSUPPORTED_DIRECTION'});}
   const g=groups.find(g=>g.O===direction.causeOperationId);check(!!g&&direction.causeIndex<g.R.length&&g.R[direction.causeIndex]._id===direction.causeResourceClaimId);
   need(causes.some(c=>c.operationId===direction.causeOperationId&&c.index===direction.causeIndex&&c.resourceClaimId===direction.causeResourceClaimId));
  }
  guardCoreIntrinsics();return answer('EVIDENCED',{direction,causes,reads:scope.used()});
 }catch(e){return answer(e.message==='INTEGRITY'?'INTEGRITY':'UNKNOWN',{reason:['BUDGET','UNSUPPORTED_EVIDENCE'].includes(e.message)?'UNSUPPORTED_EVIDENCE':'EVIDENCE'});}
}
