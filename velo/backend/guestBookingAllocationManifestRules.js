import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import { validatePhysicalCommit } from 'backend/roomBookingCommitRules';
import { validateRetainedClaimLedger } from 'backend/guestBookingAllocationRetainedRules';

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

// Private allocation authority only; never a financial projection or completion.
const ROOT_FIELDS=['schemaVersion','validityPolicy','_id','operationId','audience','bookingNumber','capsule','intentDigest','quoteDigest','issuedAtMs','offerExpiresAtMs','credentialKid','validatedAtMs','rootDigest'];
const CLASSES=['penthouse_apartment','two_bedroom_apartment','adventure_suite'];
const TOKENS=['p','t','a'];
const ROW_FIELDS=['_id','roomCode','assignedRoom','quantity','checkIn','checkOut','bookingNumber','operationId','payloadDigest'];
const OP_FIELDS=['_id','protocolVersion','claimKey','generation','eventType','claimType','operationId','bookingRowId','bookingNumber','payloadDigest','decisionFenceVersion','manifestVersion','manifestCheckIn','manifestCheckOut','manifestRoomCode','manifestUnits','manifestBookingRowIds','manifestResourceClaimIds'];
const RESOURCE_FIELDS=['_id','protocolVersion','claimKey','generation','eventType','claimType','night','operationId','bookingRowId','bookingNumber','payloadDigest'];
const SNAP_FIELDS=['occupiedUnits','occupiedUnitsByNight','migrationIssueRows','duplicateUnitClaims','unknownStatusRows'];
const CLAIM_FIELDS=['_id','protocolVersion','claimKey','eventType','claimType','generation','night','capacitySlot','unit','operationId','payloadDigest','bookingNumber','bookingRowId','releaseReason','manifestVersion','manifestCheckIn','manifestCheckOut','manifestRoomCode','manifestUnits','manifestBookingRowIds','manifestResourceClaimIds','completionState','confirmedResourceCount','decisionFenceVersion','operationIdentityId','operationCompletionId','decisionState'];
function digest(bytes){return createHash('sha256').update(bytes,'utf8').digest('hex');}
function bounded(bytes){if(typeof bytes!=='string'||Buffer.byteLength(bytes,'utf8')>400000)throw Error('BUDGET');return bytes;}
function ordered(value,fields){exact(value,fields);const out={};for(const k of fields)out[k]=value[k];return out;}
function finite(value){if(typeof value==='number'&&(!Number.isSafeInteger(value)||Object.is(value,-0)))fail();if(value&&typeof value==='object')for(const k of Object.keys(value))finite(value[k]);}
function rootTuple(root){return ROOT_FIELDS.map(k=>root[k]);}
export function buildGuestBookingAllocationBinding(validatedRoot){
 const r=detach(validatedRoot.root);guardCoreIntrinsics();
 if(typeof r.operationId!=='string'||!/^[a-f0-9]{64}$/.test(r.operationId))fail();
 const encoded=Buffer.from(r.operationId,'hex').toString('base64url');if(encoded.length!==43||Buffer.from(encoded,'base64url').toString('hex')!==r.operationId)fail();
 const purchase=JSON.parse(JSON.parse(r.capsule).inputCanonical),groups=purchase[9],classBindings=[],groupRequests=[];
 let total=0;for(const g of groups){if(!Array.isArray(g)||g.length!==3||!CLASSES.includes(g[0])||!Number.isSafeInteger(g[1])||g[1]<1||!Number.isSafeInteger(g[2])||(g[0]==='two_bedroom_apartment'?![3,4].includes(g[2]):g[2]!==2))fail();total+=g[1];}if(total<1||total>4)fail();
 let primaryOperationId;
 for(let c=0;c<CLASSES.length;c++){
  const roomCode=CLASSES[c],operationId='cg2_'+encoded+'_'+TOKENS[c],refs=[],guests=[],notes=[];
  for(let i=0;i<groups.length;i++)if(groups[i][0]===roomCode)for(let q=1;q<=groups[i][1];q++){refs.push([i,q]);guests.push(groups[i][2]);notes.push(i===0&&q===1?purchase[7][4]:'');if(i===0)primaryOperationId=operationId;}
  const quantity=refs.length;if(!quantity)continue;if(quantity>(c===2?3:1))fail();
  const allocationPayloadDigest=digest(JSON.stringify(['wbe.accepted-allocation-payload',1,r._id,r.operationId,r.rootDigest,r.capsule,r.bookingNumber,operationId,roomCode,purchase[2],purchase[3],quantity,refs,guests,notes]));
  classBindings.push([operationId,roomCode,quantity,refs,guests,notes,allocationPayloadDigest]);
  groupRequests.push({operationId,bookingNumber:r.bookingNumber,payloadDigest:allocationPayloadDigest,checkIn:purchase[2],checkOut:purchase[3],roomCode,quantity});
 }
 return {manifestId:'ga2_'+encoded,acceptanceRootTuple:rootTuple(r),classBindings,groupRequests,primaryOperationId,primaryRowId:'pb1-'+primaryOperationId+'-r1',checkIn:purchase[2],checkOut:purchase[3]};
}
function canonicalPlans(plans,binding){
 if(!Array.isArray(plans)||plans.length!==binding.classBindings.length)fail();
 const result=[],rowIds=[],ids=new Set(),resources=new Set();
 for(let i=0;i<plans.length;i++){
  const p=ordered(plans[i],['acquisitions','bookingRows','primaryRowId']),b=binding.classBindings[i],req=binding.groupRequests[i];
  if(!Array.isArray(p.acquisitions)||!Array.isArray(p.bookingRows)||p.bookingRows.length!==b[2])fail();
  p.acquisitions=p.acquisitions.map(e=>ordered(e,e.claimType==='operation'?OP_FIELDS:[...RESOURCE_FIELDS,e.claimType==='capacity'?'capacitySlot':'unit']));
  p.bookingRows=p.bookingRows.map(r=>ordered(r,ROW_FIELDS));
  for(const r of p.bookingRows){if(r.operationId!==req.operationId||r.bookingNumber!==req.bookingNumber||r.payloadDigest!==req.payloadDigest||r.roomCode!==req.roomCode||r.checkIn!==req.checkIn||r.checkOut!==req.checkOut)fail();if(ids.has(r._id))fail();ids.add(r._id);rowIds.push(r._id);}
  for(const e of p.acquisitions){if(e.operationId!==req.operationId||e.bookingNumber!==req.bookingNumber||e.payloadDigest!==req.payloadDigest||ids.has(e._id))fail();ids.add(e._id);if(e.claimType!=='operation'){const key=JSON.stringify([e.claimType,e.night,e.claimType==='capacity'?e.capacitySlot:e.unit]);if(resources.has(key))fail();resources.add(key);}}
  finite(p);guardCoreIntrinsics();if(validatePhysicalCommit(p,p.bookingRows,p.acquisitions)!==true)fail();guardCoreIntrinsics();result.push(p);
 }
 if(rowIds.length>4||!rowIds.includes(binding.primaryRowId))fail();return {plans:result,rowIds};
}
function canonicalEvidence(input,binding){
 if(!Array.isArray(input)||input.length!==4||input[0]!==1)fail();
 const s=ordered(input[1],SNAP_FIELDS),ledger=input[2],metadata=input[3];
 if(!Array.isArray(ledger)||!Array.isArray(metadata)||ledger.length!==metadata.length||ledger.length>10000)fail();
 for(const name of ['occupiedUnits','migrationIssueRows','duplicateUnitClaims','unknownStatusRows'])if(!Array.isArray(s[name]))fail();
 if(s.migrationIssueRows.length||s.duplicateUnitClaims.length||s.unknownStatusRows.length)fail();
 function units(v){if(!Array.isArray(v)||v.some((u,i)=>!Number.isSafeInteger(u)||u<1||u>5||(i&&v[i-1]>=u)))fail();return v;}
 units(s.occupiedUnits);
 if(!s.occupiedUnitsByNight||prototype(s.occupiedUnitsByNight)!==OBJECT_PROTO||Array.isArray(s.occupiedUnitsByNight))fail();
 const start=new Date(binding.checkIn+'T00:00:00.000Z').getTime(),end=new Date(binding.checkOut+'T00:00:00.000Z').getTime(),count=(end-start)/86400000;
 if(!Number.isSafeInteger(count)||count<1||count>800)fail();
 const keys=Object.keys(s.occupiedUnitsByNight),nights={},union=new Set();if(keys.length!==count)fail();
 for(let i=0;i<count;i++){const n=new Date(start+i*86400000).toISOString().slice(0,10);if(keys[i]!==n)fail();nights[n]=units(s.occupiedUnitsByNight[n]);for(const u of nights[n])union.add(u);}
 if(JSON.stringify([...union].sort((a,b)=>a-b))!==JSON.stringify(s.occupiedUnits))fail();s.occupiedUnitsByNight=nights;
 let last='';const normalized=ledger.map((r,i)=>{if(typeof r._id!=='string'||r._id<=last)fail();last=r._id;const fields=CLAIM_FIELDS.filter(k=>Object.hasOwn(r,k)),out=ordered(r,fields);for(const k of fields)if(typeof out[k]!=='string'&&typeof out[k]!=='number')fail();const m=metadata[i];if(!Array.isArray(m)||m.length!==4||m[0]!==r._id||(m[1]!==null&&(typeof m[1]!=='string'||m[1].length>256))||m.slice(2).some(v=>v!==null&&(!Number.isSafeInteger(v)||Object.is(v,-0)||v < -8640000000000000||v > 8640000000000000)))fail();return out;});
 validateRetainedClaimLedger(normalized);
 const evidence=[1,s,normalized,metadata];finite(evidence);bounded(JSON.stringify(evidence));return evidence;
}
function tuple(binding,allocation,evidence){const p=canonicalPlans(allocation.groupPlans,binding);if(JSON.stringify(allocation.expectedRowIds)!==JSON.stringify(p.rowIds)||allocation.primaryRowId!==binding.primaryRowId)fail();return ['wbe.acceptance-allocation-manifest',1,binding.manifestId,binding.acceptanceRootTuple,'whole-cart-planner-c3a5b1fa-v1',binding.classBindings,p.plans,p.rowIds,binding.primaryRowId,canonicalEvidence(evidence,binding)];}
export function buildGuestBookingAllocationManifest(validatedRoot,allocation,evidence){
 const b=buildGuestBookingAllocationBinding(validatedRoot),a=detach(allocation),e=detach(evidence);guardCoreIntrinsics();const manifestCanonical=bounded(JSON.stringify(tuple(b,a,e)));return {_id:b.manifestId,schemaVersion:1,manifestCanonical,manifestDigest:digest(manifestCanonical)};
}
export function validateGuestBookingAllocationManifest(record,validatedRoot){
 try{
  const r=detach(record);guardCoreIntrinsics();exact(r,['_id','schemaVersion','manifestCanonical','manifestDigest']);bounded(r.manifestCanonical);if(r.schemaVersion!==1||r.manifestDigest!==digest(r.manifestCanonical))fail();
  const t=JSON.parse(r.manifestCanonical);finite(t);if(!Array.isArray(t)||t.length!==10)fail();const b=buildGuestBookingAllocationBinding(validatedRoot);if(r._id!==b.manifestId)fail();
  const reconstructed=tuple(b,{groupPlans:t[6],expectedRowIds:t[7],primaryRowId:t[8]},t[9]);if(JSON.stringify(reconstructed)!==r.manifestCanonical)fail();guardCoreIntrinsics();return true;
 }catch{return false;}
}
