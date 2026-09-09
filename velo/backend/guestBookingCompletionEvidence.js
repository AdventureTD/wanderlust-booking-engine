import { projectGuestBookingCompletion } from 'backend/guestBookingCompletionProjection';
import { canonicalGuestBookingCompletionRecord } from 'backend/guestBookingCompletionStore';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';

// Private suffix of the actual physical coordinator, never a public proposal API.
const terminal='CART_COMMIT_MATERIALIZED_PENDING_PROJECTION';
const hash=(domain,text)=>createHash('sha256').update(domain+'\n'+text,'utf8').digest('hex');
const answer=status=>Object.assign(Object.create(null),{status});
function need(v,status='UNKNOWN'){if(!v)throw Error(status);}
export async function readGuestBookingCompletionEvidence(A,store,readModel,readPhysical,receipt,verifyCompletion){
 try{
  async function model(){
   const {accepted,record}=await readModel(),R=accepted.root,m={record};
   need(R._id===A,'INTEGRITY');
   const M={_id:m.record._id,schemaVersion:m.record.schemaVersion,manifestCanonical:m.record.manifestCanonical,manifestDigest:m.record.manifestDigest};
   const P=projectGuestBookingCompletion(JSON.stringify({v:2,acceptanceRoot:R,allocationManifest:M}));need(P!=='DENIED','INTEGRITY');
   const bookingRows=P.plannedBookingRows.map(r=>({_id:r._id,roomCode:r.roomCode,assignedRoom:r.assignedRoom,quantity:r.quantity,checkIn:r.checkIn,checkOut:r.checkOut,bookingNumber:r.bookingNumber,operationId:r.operationId,payloadDigest:r.payloadDigest,guests:r.guests,note:r.note,status:'pending'}));
   const s=P.summary,summary={_id:s._id,bookingNumber:s.bookingNumber,bookingDate:s.bookingDate,checkIn:s.checkIn,checkOut:s.checkOut,guestName:s.guestName,guestEmail:s.guestEmail,guestPhone:s.guestPhone,marketSource:s.marketSource,notes:s.notes,packageTitle:s.packageTitle,roomCount:s.roomCount,status:'pending'};
   const projectionCanonical=JSON.stringify({v:1,plannedBookingRows:P.plannedBookingRows,summary:s}),bookingRowsCanonical=JSON.stringify(bookingRows),summaryCanonical=JSON.stringify(summary);
   const expected={_id:'gbc1-'+A,schemaVersion:1,kind:'booking-completion',outcome:'CONFIRMED',acceptanceId:A,operationId:R.operationId,audience:R.audience,rootDigest:R.rootDigest,manifestId:M._id,manifestDigest:M.manifestDigest,admissionId:'ra2-cart-'+A,cartDirectionId:'ra2-direction-'+A,bookingNumber:R.bookingNumber,primaryBookingRowId:P.receiptBindingProposal.primaryBookingRowId,projectionCanonical,projectionDigest:hash('wbe.completion-projection-record.v1',projectionCanonical),bookingRowsCanonical,bookingRowsDigest:hash('wbe.completion-booking-records.v1',bookingRowsCanonical),summaryId:summary._id,summaryCanonical,summaryDigest:hash('wbe.completion-summary-record.v1',summaryCanonical),financialDigest:s.financialDigest,recipient:s.guestEmail,recipientBindingDigest:hash('wbe.completion-recipient.v1',JSON.stringify([R.audience,A,R.rootDigest,M.manifestDigest,R.bookingNumber,summary._id,s.guestEmail,s.financialDigest]))};
   const targets=bookingRows.map(row=>({collection:'Bookings',row})).concat([{collection:'BookingSummary',row:summary}]);
   const receiptText=canonicalGuestBookingCompletionRecord('GuestBookingCompletions',expected);
   // Full future public payload and lossless private receipt must fit before first row.
   need(Buffer.byteLength(JSON.stringify([bookingRows,summary,expected]),'utf8')<=400000);
   for(const t of targets)canonicalGuestBookingCompletionRecord(t.collection,t.row);
   return {targets,expected,receiptText,bookingRows,summary};
  }
  const state=await model();
  if(receipt.status==='FOUND')need(canonicalGuestBookingCompletionRecord('GuestBookingCompletions',receipt.record)===state.receiptText,'INTEGRITY');
  let missing=null;const present=[];
  async function readTargets(reload){for(const t of state.targets){const found=await store.exact(t.collection,t.row._id);if(found.status==='ABSENT'){need(receipt.status!=='FOUND'&&(!reload||!present.includes(t)),'INTEGRITY');if(!reload&&!missing)missing=t;continue;}need(found.status==='FOUND',found.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');need(canonicalGuestBookingCompletionRecord(t.collection,found.record)===canonicalGuestBookingCompletionRecord(t.collection,t.row),'INTEGRITY');if(reload)need(present.includes(t),'INTEGRITY');else present.push(t);}}
  async function identity(c,field,value,expected){const scan=await store.scan(c,field,value);need(scan.status==='FOUND',scan.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');need(scan.rows.length===expected.length,'INTEGRITY');for(const row of expected){const matches=scan.rows.filter(r=>r._id===row._id);need(matches.length===1,'INTEGRITY');need(canonicalGuestBookingCompletionRecord(c,matches[0])===canonicalGuestBookingCompletionRecord(c,row),'INTEGRITY');}}
  async function identities(targets){
   const rows=targets.filter(t=>t.collection==='Bookings').map(t=>t.row);
   await identity('Bookings','bookingNumber',state.expected.bookingNumber,rows);
   // Include every expected class even when NONE of its targets is present.
   for(const O of new Set(state.bookingRows.map(r=>r.operationId)))await identity('Bookings','operationId',O,rows.filter(r=>r.operationId===O));
   await identity('BookingSummary','bookingNumber',state.expected.bookingNumber,targets.filter(t=>t.collection==='BookingSummary').map(t=>t.row));
  }
  await readTargets(false);
  // Exact positives and exactly unchanged absences bind BOTH identity passes.
  await identities(present);
  need(typeof verifyCompletion==='function');
  return await verifyCompletion(state,present,receipt,async()=>{
   // Reserve the complete reload and selected readback before any second pass.
   const physical=await readPhysical();need(physical.status===terminal,physical.status==='UNKNOWN'?'UNKNOWN':'INTEGRITY');
   const fresh=await model();need(fresh.receiptText===state.receiptText,'INTEGRITY');await readTargets(true);
   await identities(present);
   const current=await store.exact('GuestBookingCompletions','gbc1-'+A,'final-receipt');
   need(current.status===receipt.status,current.status==='INTEGRITY'?'INTEGRITY':'UNKNOWN');
   if(current.status==='FOUND'){need(!missing&&canonicalGuestBookingCompletionRecord('GuestBookingCompletions',current.record)===state.receiptText,'INTEGRITY');return answer('CONFIRMED');}
   need(current.status==='ABSENT');
   if(missing)return Object.assign(answer('CANDIDATE'),{collection:missing.collection,candidate:missing.row});
   return Object.assign(answer('CANDIDATE'),{collection:'GuestBookingCompletions',candidate:state.expected});
  });
 }catch(e){return answer(e.message==='INTEGRITY'?'INTEGRITY':'UNKNOWN');}
}
