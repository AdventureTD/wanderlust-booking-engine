import { request } from 'https';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Buffer } from 'buffer';
import { secrets } from 'wix-secrets-backend.v2';
import { elevate } from 'wix-auth';
import { calendarCompletionExpectation, calendarScopeCurrent } from 'backend/guestBookingCalendarAuthority';

const purpose='wbe.guest-calendar.new-booking.v1',cap=65536;
function need(v){if(!v)throw Error('CALENDAR_TRANSPORT_DENIED');}
const mac=(key,text)=>createHmac('sha256',key).update(text,'utf8').digest('hex');
// One native POST, no retry/agent reuse. ContentService's one-time redirect is
// fetched with GET, never a replay of the request body or authentication.
function exchange(endpoint,body){
 return new Promise((resolve,reject)=>{
  let stopped=false,active,timer;
  const finish=(err,value)=>{if(stopped)return;stopped=true;clearTimeout(timer);if(err){reject(Error('CALENDAR_TRANSPORT_UNCERTAIN'));if(active)active.destroy();}else resolve(value);};
  timer=setTimeout(()=>finish(true),15000);
  function send(url,method){
   if(stopped)return;
   try{
    active=request(url,{method,agent:false,headers:method==='POST'?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body,'utf8'),'Accept':'application/json'}:{Accept:'application/json'}},res=>{
     if(stopped){res.destroy();return;}
     if(method==='POST'&&[302,303].includes(res.statusCode)){
      const location=res.headers.location;
      if(typeof location!=='string'||location.length>4096||!/^https:\/\/script\.googleusercontent\.com\/macros\/echo\?[^\s#]+$/.test(location)){res.destroy();finish(true);return;}
      res.destroy();send(location,'GET');return;
     }
     if(res.statusCode!==200||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();finish(true);return;}
     let size=0;const chunks=[];
     res.on('data',chunk=>{if(stopped)return;size+=chunk.length;if(size>cap){res.destroy();finish(true);}else chunks.push(Buffer.from(chunk));});
     res.on('end',()=>finish(false,Buffer.concat(chunks).toString('utf8')));
     res.on('error',()=>finish(true));res.on('aborted',()=>finish(true));
    });
    active.on('error',()=>finish(true));active.end(method==='POST'?body:undefined);
   }catch{finish(true);}
  }
  send(endpoint,'POST');
 });
}
async function call(method,calendarId,eventId,resourceText,scope){
 const expected=calendarCompletionExpectation(scope);
 need(expected&&expected.mode==='APPS_SCRIPT_EVENTS_V1'&&expected.purpose===purpose&&expected.calendarId===calendarId);
 need(typeof expected.endpoint==='string'&&/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{1,256}\/exec$/.test(expected.endpoint));
 need(typeof calendarId==='string'&&/^[-A-Za-z0-9._+]+@[-A-Za-z0-9.]+$/.test(calendarId));
 need(typeof eventId==='string'&&/^[a-f0-9]{64}$/.test(eventId));
 need(eventId===createHash('sha256').update(JSON.stringify([purpose,expected.audience,calendarId,expected.acceptanceId]),'utf8').digest('hex'));
 need(typeof resourceText==='string'&&Buffer.byteLength(resourceText,'utf8')<=16384);
 const result=await elevate(secrets.getSecretValue)('WBE_GUEST_CALENDAR_EVENTS_KEY');
 need(typeof result.value==='string'&&/^[a-f0-9]{64}$/.test(result.value));
 need(await calendarScopeCurrent(scope));
 const key=result.value,nonce=randomBytes(32).toString('hex');
 const payload=JSON.stringify({purpose,mode:expected.mode,audience:expected.audience,endpoint:expected.endpoint,executor:expected.executor,calendarId,method,eventId,resourceText,nonce,issuedAt:Date.now()});
 const body=JSON.stringify({payload,mac:mac(key,'request\n'+payload)});need(Buffer.byteLength(body,'utf8')<=32768);
 const envelope=JSON.parse(await exchange(expected.endpoint,body));
 need(envelope&&typeof envelope.payload==='string'&&typeof envelope.mac==='string'&&/^[a-f0-9]{64}$/.test(envelope.mac));
 need(timingSafeEqual(Buffer.from(envelope.mac,'hex'),Buffer.from(mac(key,'response\n'+payload+'\n'+envelope.payload),'hex')));
 const response=JSON.parse(envelope.payload);need(response&&response.nonce===nonce&&response.method===method&&response.calendarId===calendarId&&response.eventId===eventId);
 need(response.code===200&&response.resource&&typeof response.resource==='object');
 return response.resource;
}
// Called only by the retained Calendar boundary. This adapter cannot mint an
// ATTEMPT grant. Errors expose neither credentials nor provider response text.
export const calendarEvents=Object.freeze({
 async insert(calendarId,resourceText,expected){need(typeof resourceText==='string');const resource=JSON.parse(resourceText);return call('insert',calendarId,resource.id,resourceText,expected);},
 async get(calendarId,eventId,expected){return call('get',calendarId,eventId,'',expected);}
});
