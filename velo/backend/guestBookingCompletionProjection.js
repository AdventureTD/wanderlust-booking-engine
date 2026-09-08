import { calculateGuestBookingFinancials } from 'backend/guestBookingFinancialCalculation';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';

const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const digest=(domain,value)=>hash(domain+'\n'+JSON.stringify(value));
const acceptanceDigest=(domain,text)=>hash(domain+'\0'+text);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const rootKeys=['schemaVersion','validityPolicy','_id','operationId','audience','bookingNumber','capsule','intentDigest','quoteDigest','issuedAtMs','offerExpiresAtMs','credentialKid','validatedAtMs','rootDigest'];
const rowKeys=['_id','roomCode','assignedRoom','quantity','checkIn','checkOut','bookingNumber','operationId','payloadDigest'];
function exact(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length)throw Error('record');
  const result={};
  for(const key of keys){if(!Object.hasOwn(value,key))throw Error('field');result[key]=value[key];}
  return result;
}
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function day(s){
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('date');
  const d=new Date(s+'T00:00:00Z');if(d.toISOString().slice(0,10)!==s)throw Error('date');return d.getTime()/86400000;
}
// Detached application JSON only: consistency is not retained-store admission,
// authenticated offer validation, claim-ledger permission, or completion authority.
export function projectGuestBookingCompletion(normalizedJson) {
  try {
    if(arguments.length!==1||typeof normalizedJson!=='string'||Buffer.byteLength(normalizedJson,'utf8')>262144)throw Error('envelope');
    const input=exact(JSON.parse(normalizedJson),['v','acceptanceRoot','allocationManifest']);
    if(input.v!==2)throw Error('version');
    const r=exact(input.acceptanceRoot,rootKeys);
    if(Buffer.byteLength(JSON.stringify(r),'utf8')>160000||r.schemaVersion!==2||r.validityPolicy!=='backend-complete-validation-v2'||!hex(r.operationId)||r._id!==acceptanceDigest('wbe.acceptance-id.v2',r.operationId))throw Error('root');
    if(typeof r.audience!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(r.audience)||typeof r.credentialKid!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(r.credentialKid))throw Error('identity');
    if(typeof r.bookingNumber!=='string'||!/^[A-Z][A-Z0-9-]{0,15}[a-f0-9]{48}$/.test(r.bookingNumber)||typeof r.capsule!=='string')throw Error('booking');
    const body=exact(Object.fromEntries(Object.entries(r).slice(0,-1)),rootKeys.slice(0,-1));
    if(r.rootDigest!==acceptanceDigest('wbe.acceptance-root.v2',JSON.stringify(body)))throw Error('root digest');
    const capsule=exact(JSON.parse(r.capsule),['v','policy','inputCanonical','quote','revisionId','revisionDigest','revisionBytes','factors','calculation','bookingNumber','issuedAtMs','offerExpiresAtMs']);
    const purchase=JSON.parse(capsule.inputCanonical);
    if(!Array.isArray(purchase)||purchase.length!==10||purchase[0]!=='wbe.guest-purchase-input'||purchase[1]!==1||purchase.slice(2,7).some(v=>typeof v!=='string'))throw Error('purchase');
    if(capsule.v!==2||capsule.policy!==r.validityPolicy||capsule.bookingNumber!==r.bookingNumber||capsule.issuedAtMs!==r.issuedAtMs||capsule.offerExpiresAtMs!==r.offerExpiresAtMs||r.intentDigest!==acceptanceDigest('wbe.complete-offer.v2',r.capsule)||r.quoteDigest!==acceptanceDigest('wbe.quote.v1',purchase[5]))throw Error('capsule binding');
    if([r.issuedAtMs,r.offerExpiresAtMs,r.validatedAtMs].some(t=>!Number.isSafeInteger(t)||t<0)||r.validatedAtMs<r.issuedAtMs||r.validatedAtMs>=r.offerExpiresAtMs)throw Error('time');
    const quote=exact(capsule.quote,['v','nonce','issuedAt','expiresAt','checkIn','checkOut','nights','packageId','packageTitle','baseRate','priceModifier','totalPerPerson']);
    if(quote.v!==1||typeof quote.packageTitle!=='string'||quote.packageTitle.length>4096||quote.checkIn!==purchase[2]||quote.checkOut!==purchase[3]||quote.packageId!==purchase[4]||quote.nights!==capsule.factors.nights||quote.totalPerPerson!==capsule.factors.totalPerPerson||!Number.isSafeInteger(quote.issuedAt)||quote.issuedAt>r.issuedAtMs||quote.expiresAt!==r.offerExpiresAtMs)throw Error('quote');
    // Payload equality is structural only; no signature/issuer authentication.
    if(!same(JSON.parse(Buffer.from(purchase[5].split('.')[0],'base64').toString('utf8')),capsule.quote))throw Error('quote payload');
    if(typeof capsule.revisionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(capsule.revisionId)||typeof capsule.revisionBytes!=='string'||capsule.revisionDigest!==acceptanceDigest('wbe.financial-revision.v1',capsule.revisionBytes))throw Error('revision');
    if(!Array.isArray(purchase[7])||purchase[7].length!==6||purchase[7].some(v=>typeof v!=='string')||!purchase[7][0]||!purchase[7][1])throw Error('contacts');
    if(!Array.isArray(purchase[8])||purchase[8].length!==4||purchase[8].some(v=>typeof v!=='string'))throw Error('attribution');
    const calculation=calculateGuestBookingFinancials(capsule.factors);
    if(calculation==='DENIED'||!same(calculation,capsule.calculation)||!same(purchase[9],calculation.groups.map(g=>[g.roomCode,g.quantity,g.guests]))||day(purchase[3])-day(purchase[2])!==capsule.factors.nights||calculation.totals.totalRooms<1||calculation.totals.totalRooms>4)throw Error('financial reconciliation');
    const m=exact(input.allocationManifest,['_id','schemaVersion','manifestCanonical','manifestDigest']);
    const encoded=Buffer.from(r.operationId,'hex').toString('base64url');
    if(m.schemaVersion!==1||m._id!=='ga2_'+encoded||typeof m.manifestCanonical!=='string'||Buffer.byteLength(m.manifestCanonical,'utf8')>400000||m.manifestDigest!==hash(m.manifestCanonical))throw Error('manifest');
    const t=JSON.parse(m.manifestCanonical);
    if(!Array.isArray(t)||t.length!==10||t[0]!=='wbe.acceptance-allocation-manifest'||t[1]!==1||t[2]!==m._id||!same(t[3],rootKeys.map(k=>r[k]))||!Array.isArray(t[9])||!((t[4]==='whole-cart-planner-c3a5b1fa-v1'&&t[9][0]===1)||(t[4]==='whole-cart-held-sources-v2'&&t[9][0]===2)))throw Error('manifest context');
    const classes=[['penthouse_apartment','p',[1]],['two_bedroom_apartment','t',[2]],['adventure_suite','a',[3,4,5]]].filter(([code])=>purchase[9].some(g=>g[0]===code));
    if(!Array.isArray(t[5])||!Array.isArray(t[6])||t[5].length!==classes.length||t[6].length!==classes.length)throw Error('classes');
    const plannedBookingRows=[],units=new Set();let primaryBookingRowId;
    classes.forEach(([code,suffix,allowed],c)=>{
      const b=t[5][c],p=exact(t[6][c],['acquisitions','bookingRows','primaryRowId']);
      const refs=[],guests=[],notes=[];
      purchase[9].forEach((g,i)=>{if(g[0]===code)for(let q=1;q<=g[1];q++){refs.push([i,q]);guests.push(g[2]);notes.push(i===0&&q===1?purchase[7][4]:'');}});
      const operationId='cg2_'+encoded+'_'+suffix;
      const payloadDigest=hash(JSON.stringify(['wbe.accepted-allocation-payload',1,r._id,r.operationId,r.rootDigest,r.capsule,r.bookingNumber,operationId,code,purchase[2],purchase[3],refs.length,refs,guests,notes]));
      if(!same(b,[operationId,code,refs.length,refs,guests,notes,payloadDigest])||!Array.isArray(p.bookingRows)||p.bookingRows.length!==refs.length||p.primaryRowId!=='pb1-'+operationId+'-r1'||!Array.isArray(p.acquisitions)||!p.acquisitions.length)throw Error('binding');
      if(refs[0][0]===0)primaryBookingRowId=p.primaryRowId;
      p.bookingRows.forEach((raw,j)=>{
        const row=exact(raw,rowKeys);
        if(row._id!=='pb1-'+operationId+'-r'+(j+1)||row.roomCode!==code||!Number.isSafeInteger(row.assignedRoom)||!allowed.includes(row.assignedRoom)||units.has(row.assignedRoom)||row.quantity!==1||row.checkIn!==purchase[2]||row.checkOut!==purchase[3]||row.bookingNumber!==r.bookingNumber||row.operationId!==operationId||row.payloadDigest!==payloadDigest)throw Error('row');
        units.add(row.assignedRoom);
        for(let n=day(row.checkIn);n<day(row.checkOut);n++){
          const night=new Date(n*86400000).toISOString().slice(0,10);
          if(p.acquisitions.filter(a=>a.claimType==='unit'&&a.bookingRowId===row._id&&a.night===night&&a.unit===row.assignedRoom).length!==1||p.acquisitions.filter(a=>a.claimType==='capacity'&&a.bookingRowId===row._id&&a.night===night).length!==1)throw Error('row acquisitions');
        }
        plannedBookingRows.push({...row,originalGroupIndex:refs[j][0],ordinal:refs[j][1]-1,guests:guests[j],note:notes[j]});
      });
      for(const a of p.acquisitions){
        const row=p.bookingRows.find(row=>row._id===a.bookingRowId);
        if(!row||a.operationId!==operationId||a.payloadDigest!==payloadDigest||a.bookingNumber!==r.bookingNumber||a.eventType!=='acquire'||a.protocolVersion!==1)throw Error('acquisition binding');
        if(a.claimType==='operation'){
          if(a.bookingRowId!==p.primaryRowId||a.manifestCheckIn!==purchase[2]||a.manifestCheckOut!==purchase[3]||a.manifestRoomCode!==code||a.manifestUnits!==p.bookingRows.map(row=>row.assignedRoom).join(',')||a.manifestBookingRowIds!==p.bookingRows.map(row=>row._id).join('|'))throw Error('operation binding');
        }else if(!['unit','capacity'].includes(a.claimType)||day(a.night)<day(row.checkIn)||day(a.night)>=day(row.checkOut)||(a.claimType==='unit'&&a.unit!==row.assignedRoom))throw Error('resource binding');
      }
      if(p.acquisitions.filter(a=>a.claimType==='operation').length!==1)throw Error('operation');
    });
    if(plannedBookingRows.length!==calculation.totals.totalRooms||!same(t[7],plannedBookingRows.map(row=>row._id))||t[8]!==primaryBookingRowId)throw Error('ordered rows');
    const summary={_id:'gbs1-'+r._id,bookingNumber:r.bookingNumber,
      acceptanceId:r._id,rootDigest:r.rootDigest,manifestId:m._id,manifestDigest:m.manifestDigest,
      bookingDate:new Date(r.validatedAtMs).toISOString(),checkIn:purchase[2],checkOut:purchase[3],
      guestName:purchase[7][0],guestEmail:purchase[7][1],guestPhone:purchase[7][2],dialingCode:purchase[7][3],
      notes:purchase[7][4],marketSource:purchase[7][5],packageTitle:quote.packageTitle,
      roomCount:calculation.totals.totalRooms,totalGuests:calculation.totals.totalGuests,acceptedCalculation:calculation,
      financialDigest:digest('wbe.completion-financial.v1',calculation)};
    const receiptBindingProposal={kind:'UNTRUSTED_RECEIPT_BINDING_PROPOSAL',v:2,
      proposedReceiptId:'gbc1-'+r._id,acceptanceId:r._id,rootDigest:r.rootDigest,
      manifestId:m._id,manifestDigest:m.manifestDigest,cartDirectionId:'ra2-direction-'+r._id,
      bookingNumber:r.bookingNumber,bookingRowIds:plannedBookingRows.map(row=>row._id),primaryBookingRowId,
      rowDigests:plannedBookingRows.map(row=>digest('wbe.completion-row.v2',row)),summaryId:summary._id,
      summaryDigest:digest('wbe.completion-summary.v2',summary),financialDigest:summary.financialDigest,recipient:summary.guestEmail};
    return {kind:'PARTIAL_PROJECTION_PROPOSAL',plannedBookingRows,summary,receiptBindingProposal};
  } catch { return 'DENIED'; }
}
