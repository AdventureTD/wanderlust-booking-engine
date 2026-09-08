import { calculateGuestBookingFinancials } from 'backend/guestBookingFinancialCalculation';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';

const digest=(domain,value)=>createHash('sha256').update(domain+'\n'+JSON.stringify(value)).digest('hex');

const rowKeys=['_id','roomCode','assignedRoom','quantity','checkIn','checkOut','bookingNumber','operationId','payloadDigest'];
function exact(value,keys,metadata=false){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('record');
  const result={};
  for(const key of Object.keys(value)){
    if(keys.includes(key))continue;
    if(!metadata||!['_owner','_createdDate','_updatedDate'].includes(key))throw Error('extra field');
    const v=value[key];
    if(key==='_owner' ? v!==null&&(typeof v!=='string'||v.length>256) : typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw Error('metadata');
  }
  for(const key of keys){if(!Object.hasOwn(value,key))throw Error('missing field');result[key]=value[key];}
  return result;
}
// JSON text is a normalized private seam, not native SDK or hostile-realm admission.
// Private normalized-fixture projection only. No acceptance, storage or completion authority.
export function projectGuestBookingCompletion(normalizedJson) {
  try {
    if(arguments.length!==1||typeof normalizedJson!=='string'||Buffer.byteLength(normalizedJson,'utf8')>262144)throw Error('envelope');
    const input=exact(JSON.parse(normalizedJson),['root','capsule','plan']);
    const root=exact(input.root,['acceptanceId','rootDigest','operationId','bookingNumber','validatedAtMs'],true);
    const capsule=exact(input.capsule,['inputCanonical','quote','factors','calculation']);
    const plan=exact(input.plan,['manifestId','manifestDigest','primaryBookingRowId','bookingRows','classBindings']);
    exact(capsule.quote,['packageTitle']);
    if(typeof capsule.quote.packageTitle!=='string'||capsule.quote.packageTitle.length>4096||typeof capsule.inputCanonical!=='string')throw Error('capsule text');
    if(typeof plan.manifestId!=='string'||!plan.manifestId||plan.manifestId.length>256)throw Error('manifest id');
    plan.bookingRows=plan.bookingRows.map(r=>exact(r,rowKeys,true));
    plan.classBindings=plan.classBindings.map(b=>{const c=exact(b,['roomCode','refs']);c.refs=c.refs.map(r=>exact(r,['originalGroupIndex','ordinal','bookingRowId']));return c;});
    const purchase=JSON.parse(capsule.inputCanonical);
    if(!Array.isArray(purchase[7])||purchase[7].length!==6||purchase[7].some(v=>typeof v!=='string')||!purchase[7][0]||!purchase[7][1])throw Error('guest fields');
    if(!Array.isArray(purchase[8])||purchase[8].length!==4||purchase[8].some(v=>typeof v!=='string'))throw Error('attribution metadata');
    const calculation=calculateGuestBookingFinancials(capsule.factors);
    if(calculation==='DENIED'||JSON.stringify(calculation)!==JSON.stringify(capsule.calculation))throw Error('financial reconciliation');
    if(!Array.isArray(purchase)||purchase.length!==10||purchase[0]!=='wbe.guest-purchase-input'||purchase[1]!==1)throw Error('purchase');
    const day=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('date');const d=new Date(s+'T00:00:00Z');if(d.toISOString().slice(0,10)!==s)throw Error('date');return d.getTime()/86400000;};
    if(day(purchase[3])-day(purchase[2])!==capsule.factors.nights)throw Error('stay');
    if(JSON.stringify(purchase[9])!==JSON.stringify(calculation.groups.map(g=>[g.roomCode,g.quantity,g.guests])))throw Error('ordered groups');
    if(calculation.totals.totalRooms<1||calculation.totals.totalRooms>4||plan.bookingRows.length!==calculation.totals.totalRooms)throw Error('rooms');
    const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
    if(!hex(root.acceptanceId)||!hex(root.rootDigest)||!hex(root.operationId)||!hex(plan.manifestDigest))throw Error('binding');
    if(typeof root.bookingNumber!=='string'||!/^[A-Z][A-Z0-9-]{0,15}[a-f0-9]{48}$/.test(root.bookingNumber))throw Error('booking number');
    if(!Number.isSafeInteger(root.validatedAtMs)||root.validatedAtMs<0)throw Error('time');
    const expected=new Set();calculation.groups.forEach(g=>{for(let i=0;i<g.quantity;i++)expected.add(g.index+':'+i);});
    const refs=new Map(),classes=new Set();
    for(const binding of plan.classBindings){
      if(classes.has(binding.roomCode)||!binding.refs.length)throw Error('class');classes.add(binding.roomCode);
      for(const ref of binding.refs){
        const key=ref.originalGroupIndex+':'+ref.ordinal,g=calculation.groups[ref.originalGroupIndex];
        if(!Number.isSafeInteger(ref.originalGroupIndex)||!Number.isSafeInteger(ref.ordinal)||!expected.delete(key)||!g||g.roomCode!==binding.roomCode||refs.has(ref.bookingRowId))throw Error('ref');
        refs.set(ref.bookingRowId,{...ref,roomCode:binding.roomCode});
      }
    }
    if(expected.size||refs.size!==plan.bookingRows.length||plan.primaryBookingRowId!==plan.bookingRows[0]._id)throw Error('complete refs');
    const units=new Set();
    for(const row of plan.bookingRows){
      if(typeof row._id!=='string'||!row._id||row._id.length>256)throw Error('row id');
      const ref=refs.get(row._id);
      if(!ref||row.roomCode!==ref.roomCode||row.quantity!==1||row.checkIn!==purchase[2]||row.checkOut!==purchase[3]||row.bookingNumber!==root.bookingNumber||row.operationId!==root.operationId||!hex(row.payloadDigest)||typeof row.assignedRoom!=='string'||!row.assignedRoom||units.has(row.assignedRoom))throw Error('row');
      units.add(row.assignedRoom);refs.delete(row._id);
    }
    const plannedBookingRows=plan.bookingRows.map(row=>{
      const ref=plan.classBindings.flatMap(b=>b.refs).find(r=>r.bookingRowId===row._id);
      return {...row,originalGroupIndex:ref.originalGroupIndex,ordinal:ref.ordinal,
        guests:capsule.calculation.groups[ref.originalGroupIndex].guests,note:purchase[7][4]};
    });
    const summary={_id:'gbs1-'+root.acceptanceId,bookingNumber:root.bookingNumber,
        acceptanceId:root.acceptanceId,rootDigest:root.rootDigest,manifestId:plan.manifestId,manifestDigest:plan.manifestDigest,
        bookingDate:new Date(root.validatedAtMs).toISOString(),checkIn:purchase[2],checkOut:purchase[3],
        guestName:purchase[7][0],guestEmail:purchase[7][1],guestPhone:purchase[7][2],dialingCode:purchase[7][3],
        notes:purchase[7][4],marketSource:purchase[7][5],packageTitle:capsule.quote.packageTitle,
        roomCount:calculation.totals.totalRooms,totalGuests:calculation.totals.totalGuests,acceptedCalculation:calculation,
        financialDigest:digest('wbe.completion-financial.v1',calculation)};
    const receiptBindingProposal={kind:'UNTRUSTED_RECEIPT_BINDING_PROPOSAL',v:1,
      proposedReceiptId:'gbc1-'+root.acceptanceId,acceptanceId:root.acceptanceId,rootDigest:root.rootDigest,
      manifestId:plan.manifestId,manifestDigest:plan.manifestDigest,cartDirectionId:'ra2-direction-'+root.acceptanceId,
      bookingNumber:root.bookingNumber,bookingRowIds:plannedBookingRows.map(r=>r._id),
      rowDigests:plannedBookingRows.map(r=>digest('wbe.completion-row.v1',r)),summaryId:summary._id,
      summaryDigest:digest('wbe.completion-summary.v1',summary),financialDigest:summary.financialDigest,recipient:summary.guestEmail};
    return {kind:'PARTIAL_PROJECTION_PROPOSAL',plannedBookingRows,summary,receiptBindingProposal};
  } catch { return 'DENIED'; }
}
