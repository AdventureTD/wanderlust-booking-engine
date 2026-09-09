import { secrets } from 'wix-secrets-backend.v2';
import { elevate } from 'wix-auth';
import { Buffer } from 'buffer';

// Private site identity only. No signing-key validation, issuer, cache or fallback.
export async function readGuestBookingInvoiceSiteAudience() {
 if(arguments.length!==0)return null;
 try {
  const response=await elevate(secrets.getSecretValue)('WBE_GUEST_BOOKING_KEYS');
  const d=Object.getOwnPropertyDescriptor(response,'value');
  if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string'||Buffer.byteLength(d.value,'utf8')>16384)return null;
  const config=JSON.parse(d.value);
  if(config===null||typeof config!=='object'||Array.isArray(config)||JSON.stringify(config)!==d.value)return null;
  const a=Object.getOwnPropertyDescriptor(config,'audience');
  return a&&Object.hasOwn(a,'value')&&typeof a.value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(a.value)?a.value:null;
 }catch{return null;}
}
