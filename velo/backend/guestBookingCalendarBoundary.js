import wixData from 'wix-data';
import { createHash } from 'crypto';
import { captureGuestBookingCalendarScope, calendarCompletionExpectation, calendarScopeCurrent } from 'backend/guestBookingCalendarAuthority';
import { readCalendarBoundGuestBookingCompletion } from 'backend/guestBookingCompletionAuthority';
import { calendarEvents } from 'backend/guestBookingCalendarEvents';

// Proposed local-fixture collection only; no live collection is provisioned.
// Immutable rows: _id, schemaVersion=1, kind, canonical (bounded JSON text).
// IDs are per acceptance, NOT per destination: a config switch cannot create a
// second grant. No invoice rows, START capability, rooms or owner reservations.
const collection='GuestBookingCalendarJournal',hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const answer=status=>({status}),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function need(v){if(!v)throw Error('INTEGRITY');}
function rowText(row){
 need(row&&typeof row==='object'&&!Array.isArray(row));
 const keys=Object.keys(row),required=['_id','schemaVersion','kind','canonical'];
 need(required.every(k=>Object.hasOwn(row,k))&&keys.every(k=>required.includes(k)||['_owner','_createdDate','_updatedDate'].includes(k)));
 need(row.schemaVersion===1&&['DESIRED','ATTEMPT','ACK','UNCERTAIN'].includes(row.kind)&&typeof row._id==='string'&&/^gcc1-[a-f0-9]{64}-(desired|attempt|ack|uncertain)$/.test(row._id));
 need(row._id.endsWith('-'+row.kind.toLowerCase())&&typeof row.canonical==='string'&&row.canonical.length<=16384);
 return JSON.stringify({_id:row._id,schemaVersion:1,kind:row.kind,canonical:row.canonical});
}
async function exact(id){
 const p=await wixData.query(collection).eq('_id',id).limit(2).find({suppressAuth:true,suppressHooks:true,consistentRead:true});
 need(p&&Array.isArray(p.items)&&p.items.length<=1&&typeof p.hasNext==='function'&&p.hasNext()===false);
 if(!p.items.length)return null;
 const row=JSON.parse(rowText(p.items[0]));need(row._id===id);return row;
}
async function retain(row,exclusive=false){
 const text=rowText(row);let won=false;
 try{const returned=await wixData.insert(collection,JSON.parse(text),{suppressAuth:true,suppressHooks:true});won=rowText(returned)===text;}catch{}
 const found=await exact(row._id);need(found&&rowText(found)===text);
 return exclusive?won:true;
}
function day(s){need(typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s);return s;}
function desiredFor(expected,completion){
 const s=completion.projection.summary;
 need(s&&s.acceptanceId===expected.acceptanceId&&s.rootDigest===expected.rootDigest);
 need(typeof s.guestName==='string'&&s.guestName.trim().length>0&&s.guestName.length<=2048);
 const start=day(s.checkIn),end=day(s.checkOut);need(end>start);
 const identity=[expected.purpose,expected.audience,expected.calendarId,expected.acceptanceId];
 const binding=hash(JSON.stringify([...identity,expected.operationId,expected.rootDigest,s.guestName,start,end]));
 return {...expected,resource:{id:hash(JSON.stringify(identity)),summary:'Wanderlust Caribbean Booking: '+s.guestName,description:'Wanderlust Booking: '+s.guestName,start:{date:start},end:{date:end},extendedProperties:{private:{wbeCalendarBinding:binding}}}};
}
function matches(resource,desired){
 const expected=desired.resource;
 return resource&&resource.status==='confirmed'&&Object.keys(expected).every(k=>same(resource[k],expected[k]));
}
// Trusted private continuation subject only, captured before producer awaits.
// Existing ATTEMPT is permanent uncertainty custody until exact provider ACK.
export async function advanceRecoveredGuestBookingCalendar(acceptanceId,operationId,rootDigest){
 try{
  if(arguments.length!==3)return answer('DENIED');
  const scope=await captureGuestBookingCalendarScope(acceptanceId,operationId,rootDigest);if(!scope)return answer('OFF');
  const expected=calendarCompletionExpectation(scope),completion=await readCalendarBoundGuestBookingCompletion(scope);
  if(completion.status!=='VERIFIED_COMPLETION')return answer('UNRESOLVED');
  const desired=desiredFor(expected,completion),canonical=JSON.stringify(desired),desiredDigest=hash(canonical),base='gcc1-'+acceptanceId;
  const make=(kind,text)=>({_id:base+'-'+kind.toLowerCase(),schemaVersion:1,kind,canonical:text});
  const d=make('DESIRED',canonical),binding=JSON.stringify({desiredDigest,calendarId:desired.calendarId,eventId:desired.resource.id}),attempt=make('ATTEMPT',binding),ack=make('ACK',binding);
  const current=await exact(d._id);
  if(current)need(rowText(current)===rowText(d));
  else {if(!await calendarScopeCurrent(scope))return answer('OFF');await retain(d);}
  const a=await exact(attempt._id),k=await exact(ack._id);
  if(k){need(a&&rowText(a)===rowText(attempt)&&rowText(k)===rowText(ack));return answer('ACK');}
  let won=false;
  if(a)need(rowText(a)===rowText(attempt));
  else {if(!await calendarScopeCurrent(scope))return answer('OFF');won=await retain(attempt,true);}
  if(!await calendarScopeCurrent(scope))return answer('OWNER_REVIEW');
  let resource;
  try{
   resource=won?await calendarEvents.insert(desired.calendarId,JSON.stringify(desired.resource),scope):await calendarEvents.get(desired.calendarId,desired.resource.id,scope);
  }catch{
   // All errors, including 404/409, are uncertainty, never a retry insert grant.
   try{await retain(make('UNCERTAIN',binding));}catch{/* ATTEMPT itself retains uncertainty */}
   return answer('OWNER_REVIEW');
  }
  if(!matches(resource,desired))return answer('OWNER_REVIEW');
  await retain(ack);return answer('ACK');
 }catch{return answer('UNRESOLVED');}
}
