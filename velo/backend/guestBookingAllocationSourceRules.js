import { buildInventorySnapshot, inventoryUnitsForRow } from 'backend/roomInventoryRules';
import { validateRetainedClaimLedger } from 'backend/guestBookingAllocationRetainedRules';

// Source consistency, not authentication or an atomic scan certificate.
const BOOKING=['_id','bookingNumber','status','checkIn','checkOut','assignedRoom','quantity','roomCode','autoOwnerBlock','operationId','payloadDigest'];
const SUMMARY=['_id','bookingNumber','checkIn','checkOut'];
const SNAP=['occupiedUnits','occupiedUnitsByNight','migrationIssueRows','duplicateUnitClaims','unknownStatusRows'];
function fail(){throw Error('Unresolved allocation sources');}
function endpoint(v){
 if(typeof v==='number'){if(!Number.isSafeInteger(v)||Object.is(v,-0)||Math.abs(v)>8640000000000000)fail();return v;}
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(v))fail();
 const d=new Date(v),p=new Date(v.slice(0,10)+'T00:00:00.000Z');if(!Number.isFinite(d.getTime())||!Number.isFinite(p.getTime())||p.toISOString().slice(0,10)!==v.slice(0,10))fail();return v;
}
function rows(values,fields,metadata){
 if(!Array.isArray(values)||!Array.isArray(metadata)||values.length!==metadata.length||values.length>10000)fail();
 let last='';
 for(let i=0;i<values.length;i++){
  const r=values[i];if(!r||Object.getPrototypeOf(r)!==Object.prototype||typeof r._id!=='string'||r._id.length>128||! /^[\x20-\x7e]+$/.test(r._id)||r._id<=last)fail();last=r._id;
  for(const k of Reflect.ownKeys(r)){const d=Object.getOwnPropertyDescriptor(r,k);if(typeof k!=='string'||(fields&&!fields.includes(k))||!Object.hasOwn(d,'value')||!d.enumerable)fail();const v=d.value;if(typeof v!=='string'&&typeof v!=='number'&&typeof v!=='boolean'&&v!==null)fail();if(typeof v==='number'&&(!Number.isSafeInteger(v)||Object.is(v,-0)))fail();if(typeof v==='string'&&v.length>60000)fail();}
  const m=metadata[i];if(!Array.isArray(m)||m.length!==4||m[0]!==r._id||(m[1]!==null&&(typeof m[1]!=='string'||m[1].length>256))||m.slice(2).some(v=>v!==null&&(!Number.isSafeInteger(v)||Object.is(v,-0)||Math.abs(v)>8640000000000000)))fail();
  for(const k of ['checkIn','checkOut'])if(Object.hasOwn(r,k))endpoint(r[k]);
  if(Object.hasOwn(r,'operationId')&&(typeof r.operationId!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(r.operationId)))fail();
  if(Object.hasOwn(r,'payloadDigest')&&(typeof r.payloadDigest!=='string'||!/^[a-f0-9]{64}$/.test(r.payloadDigest)))fail();
 }
}
export function projectAllocationSourceRows(bookings,summaries,checkIn,checkOut){
 const resolved=bookings.map(r=>{
  const out={...r};for(const k of ['checkIn','checkOut'])if(Object.hasOwn(out,k))endpoint(out[k]);
  if(!Object.hasOwn(out,'checkIn')||!Object.hasOwn(out,'checkOut')){
   const matches=summaries.filter(s=>s.bookingNumber===out.bookingNumber);if(matches.length!==1)fail();
   for(const k of ['checkIn','checkOut']){endpoint(matches[0][k]);if(Object.hasOwn(out,k)&&new Date(out[k]).getTime()!==new Date(matches[0][k]).getTime())fail();out[k]=matches[0][k];}
  }
  if(new Date(out.checkIn).getTime()>=new Date(out.checkOut).getTime())fail();return out;
 });
 const full=buildInventorySnapshot(resolved,checkIn,checkOut),snapshot={};for(const k of SNAP)snapshot[k]=full[k];return {snapshot,guestRows:full.guestRows};
}
function owner(r){return JSON.stringify([r.operationId,r.payloadDigest,r.bookingNumber,r.bookingRowId]);}
function day(v){return new Date(v).toISOString().slice(0,10);}
// Validate ALL reserved rows before query-window occupancy projection. Pending
// rows contribute no second occupancy charge; retained capacity/unit claims do.
function reservedRows(bookings,ledger){
 for(const row of bookings){
  if(!row._id.startsWith('pb1-cg2'))continue;
  const match=/^pb1-(cg2_[A-Za-z0-9_-]{43}_[pta])-r([1-4])$/.exec(row._id);
  if(!match||row.status!=='pending'||Object.hasOwn(row,'autoOwnerBlock')||row.operationId!==match[1]||typeof row.payloadDigest!=='string'||!/^[a-f0-9]{64}$/.test(row.payloadDigest)||typeof row.bookingNumber!=='string'||!row.bookingNumber||row.quantity!==1||!Number.isSafeInteger(row.assignedRoom))fail();
  for(const k of ['checkIn','checkOut'])if(typeof row[k]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row[k])||day(row[k])!==row[k])fail();
  const O=row.operationId,events=ledger.filter(r=>r.operationId===O);
  const identities=events.filter(r=>r.claimType==='operation'),completions=events.filter(r=>r.claimType==='operation-completion'),decisions=events.filter(r=>r.claimType==='operation-decision');
  if(identities.length!==1||completions.length!==1||decisions.length!==1||events.some(r=>r.eventType==='release'))fail();
  const I=identities[0],C=completions[0],Q=decisions[0],ids=I.manifestBookingRowIds.split('|'),position=ids.indexOf(row._id);
  if(position!==Number(match[2])-1||I.manifestUnits.split(',')[position]!==String(row.assignedRoom)||I.manifestRoomCode!==row.roomCode||I.manifestCheckIn!==row.checkIn||I.manifestCheckOut!==row.checkOut||I.payloadDigest!==row.payloadDigest||I.bookingNumber!==row.bookingNumber||I.decisionFenceVersion!==1)fail();
  if(C.completionState!=='complete'||C.decisionFenceVersion!==1||Q.decisionState!=='commit-rows'||Q.completionState!=='complete'||Q.operationIdentityId!==I._id||Q.operationCompletionId!==C._id||Q.confirmedResourceCount!==C.confirmedResourceCount)fail();
  const nights=(new Date(row.checkOut).getTime()-new Date(row.checkIn).getTime())/86400000;if(!Number.isSafeInteger(nights)||nights<1||nights>800)fail();
  if(C.confirmedResourceCount!==ids.length*nights*2)fail();
  for(let n=0;n<nights;n++){
   const night=new Date(new Date(row.checkIn).getTime()+n*86400000).toISOString().slice(0,10);
   for(const type of ['capacity','unit']){
    const matches=events.filter(r=>r.claimType===type&&r.eventType==='acquire'&&r.bookingRowId===row._id&&r.night===night);
    if(matches.length!==1)fail();const r=matches[0];
    if(r.payloadDigest!==row.payloadDigest||r.bookingNumber!==row.bookingNumber||(type==='unit'&&r.unit!==row.assignedRoom)||!I.manifestResourceClaimIds.split('|').includes(r._id))fail();
   }
  }
 }
}
function reconcile(evidence,checkIn,checkOut,additional){
 const ledger=evidence[2].concat(additional);validateRetainedClaimLedger(ledger);
 reservedRows(evidence[4],ledger);
 const projected=projectAllocationSourceRows(evidence[4],evidence[5],checkIn,checkOut),raw=projected.snapshot;
 if(JSON.stringify(raw)!==JSON.stringify(evidence[1])||raw.migrationIssueRows.length||raw.duplicateUnitClaims.length||raw.unknownStatusRows.length)fail();
 const active=ledger.filter(r=>r.eventType==='acquire'&&['unit','capacity'].includes(r.claimType)&&!ledger.some(v=>v.eventType==='release'&&v.claimKey===r.claimKey&&v.generation===r.generation));
 const effective={...raw,occupiedUnits:[],occupiedUnitsByNight:{},occupiedCapacityByNight:{}};
 for(const night of Object.keys(raw.occupiedUnitsByNight)){
  const capacities=active.filter(r=>r.night===night&&r.claimType==='capacity'),units=active.filter(r=>r.night===night&&r.claimType==='unit');
  const co=capacities.map(owner),uo=units.map(owner);if(new Set(co).size!==co.length||new Set(uo).size!==uo.length||uo.some(o=>!co.includes(o)))fail();
  let legacyCapacity=0;
  for(const row of projected.guestRows){
   if(day(row.checkIn)>night||day(row.checkOut)<=night)continue;
   if(!row._id.startsWith('pb1-')&&!Object.hasOwn(row,'operationId')&&!Object.hasOwn(row,'payloadDigest')){
    const legacyUnits=inventoryUnitsForRow(row);if(legacyUnits.length!==row.quantity||units.some(u=>legacyUnits.includes(u.unit)))fail();
    legacyCapacity+=row.quantity;continue;
   }
   const matches=units.filter(u=>u.bookingRowId===row._id&&u.bookingNumber===row.bookingNumber&&u.unit===Number(row.assignedRoom));if(matches.length!==1)fail();
   const u=matches[0],identity=ledger.find(v=>v.claimType==='operation'&&v.operationId===u.operationId);
   const ids=identity.manifestBookingRowIds.split('|'),position=ids.indexOf(row._id);
   if(position<0||Number(identity.manifestUnits.split(',')[position])!==u.unit||identity.manifestRoomCode!==row.roomCode||row.quantity!==1||identity.manifestCheckIn!==day(row.checkIn)||identity.manifestCheckOut!==day(row.checkOut))fail();
   for(const k of ['operationId','payloadDigest'])if(Object.hasOwn(row,k)&&row[k]!==u[k])fail();
   if(ledger.some(v=>v.claimType==='operation-decision'&&v.operationId===u.operationId&&v.decisionState==='compensate'))fail();
  }
  effective.occupiedCapacityByNight[night]=capacities.length+legacyCapacity;
  if(effective.occupiedCapacityByNight[night]>4)fail();
  effective.occupiedUnitsByNight[night]=[...new Set([...raw.occupiedUnitsByNight[night],...units.map(r=>r.unit)])].sort((a,b)=>a-b);
 }
 effective.occupiedUnits=[...new Set(Object.values(effective.occupiedUnitsByNight).flat())].sort((a,b)=>a-b);
 return {effectiveSnapshot:effective,claimLedger:ledger};
}
export function canonicalizeAllocationSources(evidence,checkIn,checkOut){
 if(!Array.isArray(evidence)||evidence.length!==8||evidence[0]!==2)fail();
 const count=(new Date(checkOut).getTime()-new Date(checkIn).getTime())/86400000;if(!Number.isSafeInteger(count)||count<1||count>800)fail();
 rows(evidence[2],null,evidence[3]);validateRetainedClaimLedger(evidence[2]);rows(evidence[4],BOOKING,evidence[6]);rows(evidence[5],SUMMARY,evidence[7]);
 if(JSON.stringify(evidence).length>400000)fail();reconcile(evidence,checkIn,checkOut,[]);return evidence;
}
export function allocationConstraintsFromSources(evidence,checkIn,checkOut,additional=[]){
 canonicalizeAllocationSources(evidence,checkIn,checkOut);return reconcile(evidence,checkIn,checkOut,additional);
}
