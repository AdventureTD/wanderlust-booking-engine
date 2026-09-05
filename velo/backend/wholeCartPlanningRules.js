import { buildPhysicalCommitPlan } from 'backend/roomBookingCommitRules';

// Disconnected candidate allocation, never acquisition or persistence proof.
// The unchanged core owns ledger, date, topology, parity and manifest validation.
// Boundary: detached plain-data evidence only. Raw Wix Date metadata requires a
// separately validated reader/normalization adapter; this module does not provide it.
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
// after caller traps, before delegating. Do not patch globals or copy core code.
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
function requestsFor(input) {
  exact(input,ENVELOPE); exact(input.inventorySnapshot,SNAPSHOT);
  if(!isArray(input.claimLedger) || !isArray(input.groupRequests) || input.groupRequests.length<1 || input.groupRequests.length>3 || typeof input.primaryOperationId!=='string') fail();
  const requests=input.groupRequests, ordered=[];
  let primary=false;
  for(let i=0;i<requests.length;i++) {
    const r=requests[i]; exact(r,REQUEST);
    for(let k=0;k<REQUEST.length-1;k++) if(typeof r[REQUEST[k]]!=='string') fail();
    if(!contains(ORDER,r.roomCode) || typeof r.quantity!=='number' || !isInteger(r.quantity) || r.quantity<1 || r.quantity>(r.roomCode==='adventure_suite'?3:1)) fail();
    if(r.bookingNumber!==requests[0].bookingNumber || r.checkIn!==requests[0].checkIn || r.checkOut!==requests[0].checkOut) fail();
    for(let j=0;j<i;j++) if(r.operationId===requests[j].operationId || r.roomCode===requests[j].roomCode) fail();
    if(r.operationId===input.primaryOperationId) primary=true;
  }
  if(!primary) fail();
  for(let k=0;k<ORDER.length;k++) for(let i=0;i<requests.length;i++) if(requests[i].roomCode===ORDER[k]) append(ordered,requests[i]);
  return ordered;
}
function advance(snapshot, ledger, plan) {
  for(let i=0;i<plan.acquisitions.length;i++) append(ledger,plan.acquisitions[i]);
  const nights=ownKeys(snapshot.occupiedUnitsByNight), union=[];
  for(let i=0;i<nights.length;i++) {
    const night=nights[i], prior=snapshot.occupiedUnitsByNight[night], next=[];
    for(let unit=1;unit<=5;unit++) {
      let used=contains(prior,unit);
      for(let r=0;r<plan.bookingRows.length;r++) if(plan.bookingRows[r].assignedRoom===unit) used=true;
      if(used) { append(next,unit); if(!contains(union,unit)) append(union,unit); }
    }
    put(snapshot.occupiedUnitsByNight,night,next);
  }
  const sorted=[];
  for(let unit=1;unit<=5;unit++) if(contains(union,unit)) append(sorted,unit);
  put(snapshot,'occupiedUnits',sorted);
}
export function buildWholeCartAllocation(input) {
  const data=detach(input);
  guardCoreIntrinsics();
  const requests=requestsFor(data);
  const snapshot=data.inventorySnapshot, ledger=data.claimLedger;
  const groupPlans=[], expectedRowIds=[];
  let primaryRowId;
  for(let i=0;i<requests.length;i++) {
    const request=requests[i];
    // First invocation receives the entire unmodified detached base evidence.
    const plan=buildPhysicalCommitPlan(snapshot,ledger,request);
    append(groupPlans,plan);
    for(let r=0;r<plan.bookingRows.length;r++) append(expectedRowIds,plan.bookingRows[r]._id);
    if(request.operationId===data.primaryOperationId) primaryRowId=plan.primaryRowId;
    advance(snapshot,ledger,plan);
  }
  return {groupPlans,expectedRowIds,primaryRowId};
}
