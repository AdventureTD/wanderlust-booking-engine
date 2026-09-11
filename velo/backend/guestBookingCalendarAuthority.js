import { secrets } from 'wix-secrets-backend.v2';
import { elevate } from 'wix-auth';
import { acceptanceDigest } from 'backend/guestBookingIssuerAuthority';

// New, private Calendar purpose. No invoice transport capability is accepted.
// Missing configuration is OFF. Concrete production identity is never inferred.
const purpose='wbe.guest-calendar.new-booking.v1',scopes=new WeakMap();
async function configuration(){
 try{
  const response=await elevate(secrets.getSecretValue)('WBE_GUEST_CALENDAR_LOCAL_BOUNDARY');
  if(typeof response.value!=='string'||response.value.length>4096)return null;
  const c=JSON.parse(response.value);
  if(!c||c.enabled!==true||c.purpose!==purpose||c.newBookingsOnly!==true||c.legacyExcluded!==true)return null;
  if(typeof c.audience!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(c.audience))return null;
  if(typeof c.calendarId!=='string'||!/^[-A-Za-z0-9._+]+@[-A-Za-z0-9.]+$/.test(c.calendarId)||c.calendarId.length>240)return null;
  if(c.mode==='LOCAL_FIXTURE'){
   if(Object.keys(c).sort().join(',')!=='audience,calendarId,enabled,legacyExcluded,mode,newBookingsOnly,purpose'||!c.calendarId.endsWith('.invalid'))return null;
   return Object.freeze({purpose,audience:c.audience,calendarId:c.calendarId,mode:c.mode});
  }
  if(c.mode!=='APPS_SCRIPT_EVENTS_V1'||Object.keys(c).sort().join(',')!=='audience,calendarId,enabled,endpoint,executor,legacyExcluded,mode,newBookingsOnly,purpose')return null;
  if(typeof c.executor!=='string'||!/^[-A-Za-z0-9._+]+@[-A-Za-z0-9.]+$/.test(c.executor)||c.executor.length>240)return null;
  if(typeof c.endpoint!=='string'||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{1,256}\/exec$/.test(c.endpoint))return null;
  return Object.freeze({purpose,audience:c.audience,calendarId:c.calendarId,mode:c.mode,executor:c.executor,endpoint:c.endpoint});
 }catch{return null;}
}
export async function captureGuestBookingCalendarScope(acceptanceId,operationId,rootDigest){
 if(arguments.length!==3||![acceptanceId,operationId,rootDigest].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))return null;
 if(acceptanceId!==acceptanceDigest('wbe.acceptance-id.v2',operationId))return null;
 const config=await configuration();if(!config)return null;
 const handle=Object.freeze(Object.create(null));
 scopes.set(handle,Object.freeze({...config,acceptanceId,operationId,rootDigest}));return handle;
}
export function calendarCompletionExpectation(handle){
 const expected=scopes.get(handle);if(!expected)throw Error('DENIED');return expected;
}
export async function calendarScopeCurrent(handle){
 const expected=scopes.get(handle);if(!expected)return false;
 const c=await configuration();return c!==null&&c.purpose===expected.purpose&&c.audience===expected.audience&&c.calendarId===expected.calendarId&&c.mode===expected.mode&&c.executor===expected.executor&&c.endpoint===expected.endpoint;
}
