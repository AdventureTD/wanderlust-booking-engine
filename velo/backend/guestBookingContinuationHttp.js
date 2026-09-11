import { getSecret } from 'wix-secrets-backend';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import wixData from 'wix-data';
import { runGuestBookingContinuation } from 'backend/guestBookingContinuationWorker';

// Dedicated config/nonce collection are deployment prerequisites, default OFF.
// No guest credential, A/O/D, cursor or invoice-delivery grant enters this edge.
const purpose='guest-booking-continuation/v1', collection='GuestBookingTriggerNonces';
function sha(s){return createHash('sha256').update(s,'utf8').digest('hex');}
function mac(key,s){return createHmac('sha256',Buffer.from(key,'hex')).update(s,'utf8').digest('hex');}
function equal(a,b){return typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
function reply(status,value,signature){return {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...(signature?{'x-wbe-guest-mac':signature}:{})},body:typeof value==='string'?value:JSON.stringify(value)};}
function endpoint(v){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/_functions/guestBookingContinuation'&&u.href===v;}catch{return false;}}
export async function handleGuestBookingContinuation(request) {
  // Capture detached request identity BEFORE any await. Never reread caller objects.
  let method,url,supplied,readBody;
  try{method=request.method;url=request.url;supplied=request.headers['x-wbe-guest-mac'];readBody=request.body.text.bind(request.body);}catch{return reply(400,{error:'invalid'});}
  let config;
  try{config=JSON.parse(await getSecret('WBE_GUEST_CONTINUATION_CONFIG'));}catch{return reply(503,{error:'disabled'});}
  if(!config||config.enabled!==true)return reply(503,{error:'disabled'});
  const target=config.url,key=config.key;
  if(!endpoint(target)||typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))return reply(503,{error:'configuration'});
  if(method!=='POST'||url!==target||typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied))return reply(401,{error:'unauthorized'});
  let raw,body;
  try{
    raw=await readBody();
    if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>512)throw Error('body');
    body=JSON.parse(raw);
    if(!body||Object.keys(body).join(',')!=='v,purpose,timestamp,nonce'||body.v!==1||body.purpose!==purpose||!Number.isSafeInteger(body.timestamp)||typeof body.nonce!=='string'||!/^[a-f0-9]{64}$/.test(body.nonce)||JSON.stringify(body)!==raw)throw Error('shape');
  }catch{return reply(400,{error:'invalid'});}
  const original='WBE-GUEST-TRIGGER/1\nPOST\n'+target+'\n'+raw;
  if(!equal(supplied,mac(key,original))||Math.abs(Date.now()-body.timestamp)>30000)return reply(401,{error:'unauthorized'});
  // A fresh, immutable scope binds the response to THIS verified invocation.
  // Not an invoice Auth scope or reusable physical-stage capability.
  const scope=Object.freeze({nonce:body.nonce,requestDigest:sha(original),timestamp:body.timestamp});
  const claim={_id:sha(purpose+'\n'+scope.nonce),kind:purpose,requestDigest:scope.requestDigest,timestamp:scope.timestamp};
  try{
    // Duplicate OR ambiguous insert ACK is denied, never recovered as a grant.
    // A new signed nonce may reconcile business progress via its durable journal.
    await wixData.insert(collection,claim,{suppressAuth:true,suppressHooks:true});
    const retained=await wixData.get(collection,claim._id,{suppressAuth:true,suppressHooks:true,consistentRead:true});
    if(!retained||Object.keys(claim).some(k=>retained[k]!==claim[k]))throw Error('readback');
  }catch{return reply(409,{error:'unresolved_or_replay'});}
  // Secret lookup/claim latency cannot extend the request's freshness grant.
  if(Math.abs(Date.now()-scope.timestamp)>30000)return reply(401,{error:'expired'});
  let status='RETRY';
  try{
    const result=await runGuestBookingContinuation();
    if(result&&result.status==='ADVANCED')status=result.idle===true?'IDLE':'VISITED';
  }catch{/* Ambiguity is scheduling failure, never booking confirmation. */}
  const output=JSON.stringify({v:1,nonce:scope.nonce,requestDigest:scope.requestDigest,status});
  return reply(200,output,mac(key,'WBE-GUEST-TRIGGER-RESPONSE/1\n'+output));
}
