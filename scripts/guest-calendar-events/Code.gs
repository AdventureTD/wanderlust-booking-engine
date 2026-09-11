// Separate Apps Script deployment; NEVER paste beside the legacy doPost.
// Execute as the explicitly configured owner. All properties absent => OFF.
function calendarNeed(v){if(!v)throw Error('DENIED');}
function calendarMac(key,text){return Utilities.computeHmacSha256Signature(text,key,Utilities.Charset.UTF_8).map(function(v){return ('0'+((v+256)%256).toString(16)).slice(-2);}).join('');}
function calendarEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;var diff=0;for(var i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function calendarOutput(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function calendarResource(r){
 calendarNeed(r&&r.kind==='calendar#event'&&typeof r.id==='string'&&/^[a-f0-9]{64}$/.test(r.id));
 if(r.status==='cancelled')return {id:r.id,status:'cancelled'};
 calendarNeed(r.status==='confirmed'&&typeof r.summary==='string'&&typeof r.description==='string');
 calendarNeed(r.start&&r.end&&typeof r.start.date==='string'&&typeof r.end.date==='string'&&!Object.prototype.hasOwnProperty.call(r.start,'dateTime')&&!Object.prototype.hasOwnProperty.call(r.end,'dateTime'));
 calendarNeed(r.extendedProperties&&r.extendedProperties.private&&typeof r.extendedProperties.private.wbeCalendarBinding==='string');
 return {id:r.id,status:r.status,summary:r.summary,description:r.description,start:{date:r.start.date},end:{date:r.end.date},extendedProperties:{private:{wbeCalendarBinding:r.extendedProperties.private.wbeCalendarBinding}}};
}
function calendarConsumeNonce(p){
 // Transport replay defense only; never booking authority or an insert grant.
 // Keep consumed nonces for the entire signed validity window. No cache use.
 var lock=LockService.getScriptLock();calendarNeed(lock.tryLock(1000));
 try{
  var store=PropertiesService.getScriptProperties(),key='gct.nonce.'+p.nonce,now=Date.now();
  calendarNeed(Number.isSafeInteger(p.issuedAt)&&p.issuedAt<=now+30000&&now-p.issuedAt<=120000);
  calendarNeed(store.getProperty(key)===null);
  var all=store.getProperties(),count=0;
  Object.keys(all).forEach(function(k){if(k.indexOf('gct.nonce.')===0){if(Number(all[k])<now)store.deleteProperty(k);else count++;}});
  calendarNeed(count<1000);
  var expiry=String(p.issuedAt+120000);store.setProperty(key,expiry);
  calendarNeed(store.getProperty(key)===expiry);
 }finally{lock.releaseLock();}
}
function doPost(e){
 try{
  var c=JSON.parse(PropertiesService.getScriptProperties().getProperty('WBE_GUEST_CALENDAR_EVENTS'));
  calendarNeed(c&&c.enabled===true&&c.mode==='APPS_SCRIPT_EVENTS_V1'&&c.purpose==='wbe.guest-calendar.new-booking.v1'&&c.newBookingsOnly===true&&c.legacyExcluded===true);
  calendarNeed(typeof c.key==='string'&&/^[a-f0-9]{64}$/.test(c.key));
  calendarNeed(typeof c.calendarId==='string'&&/^[-A-Za-z0-9._+]+@[-A-Za-z0-9.]+$/.test(c.calendarId)&&c.calendarId.length<=240);
  calendarNeed(typeof c.executor==='string'&&/^[-A-Za-z0-9._+]+@[-A-Za-z0-9.]+$/.test(c.executor)&&Session.getEffectiveUser().getEmail()===c.executor);
  calendarNeed(typeof c.endpoint==='string'&&/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{1,256}\/exec$/.test(c.endpoint));
  calendarNeed(e&&e.postData&&e.postData.type==='application/json'&&typeof e.postData.contents==='string'&&e.postData.contents.length<=32768);
  var envelope=JSON.parse(e.postData.contents);
  calendarNeed(envelope&&typeof envelope.payload==='string'&&envelope.payload.length<=24576&&calendarEqual(envelope.mac,calendarMac(c.key,'request\n'+envelope.payload)));
  var p=JSON.parse(envelope.payload);
  calendarNeed(p&&Object.keys(p).sort().join(',')==='audience,calendarId,endpoint,eventId,executor,issuedAt,method,mode,nonce,purpose,resourceText');
  ['purpose','mode','audience','endpoint','executor','calendarId'].forEach(function(k){calendarNeed(typeof c[k]==='string'&&p[k]===c[k]);});
  calendarNeed(p.method==='insert'||p.method==='get');
  calendarNeed(typeof p.eventId==='string'&&/^[a-f0-9]{64}$/.test(p.eventId)&&typeof p.nonce==='string'&&/^[a-f0-9]{64}$/.test(p.nonce));
  calendarNeed(Number.isSafeInteger(p.issuedAt)&&p.issuedAt<=Date.now()+30000&&Date.now()-p.issuedAt<=120000);
  calendarNeed(typeof p.resourceText==='string'&&p.resourceText.length<=16384);
  if(p.method==='insert'){
   var resource=JSON.parse(p.resourceText);
   calendarNeed(resource&&resource.id===p.eventId&&Object.keys(resource).sort().join(',')==='description,end,extendedProperties,id,start,summary');
   calendarNeed(typeof resource.summary==='string'&&resource.summary.length<=2100&&typeof resource.description==='string'&&resource.description.length<=2100);
   ['start','end'].forEach(function(k){calendarNeed(resource[k]&&Object.keys(resource[k]).join(',')==='date'&&typeof resource[k].date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(resource[k].date)&&new Date(resource[k].date+'T00:00:00Z').toISOString().slice(0,10)===resource[k].date);});
   calendarNeed(resource.end.date>resource.start.date);
   calendarNeed(resource.extendedProperties&&Object.keys(resource.extendedProperties).join(',')==='private'&&Object.keys(resource.extendedProperties.private).join(',')==='wbeCalendarBinding'&&/^[a-f0-9]{64}$/.test(resource.extendedProperties.private.wbeCalendarBinding));
  }else calendarNeed(p.resourceText==='');
  calendarConsumeNonce(p);
  var url='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(c.calendarId)+'/events';
  var options={method:p.method==='insert'?'post':'get',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},followRedirects:false,muteHttpExceptions:true,validateHttpsCertificates:true};
  if(p.method==='insert'){url+='?sendUpdates=none';options.contentType='application/json';options.payload=p.resourceText;}else url+='/'+p.eventId;
  var code=0,observed=null;
  try{var response=UrlFetchApp.fetch(url,options);code=response.getResponseCode();if(code===200||code===201){var text=response.getContentText();calendarNeed(text.length<=32768);observed=calendarResource(JSON.parse(text));code=200;}}catch(ignore){code=0;observed=null;}
  var answer=JSON.stringify({nonce:p.nonce,method:p.method,calendarId:p.calendarId,eventId:p.eventId,code:code,resource:observed});
  return calendarOutput({payload:answer,mac:calendarMac(c.key,'response\n'+envelope.payload+'\n'+answer)});
 }catch(ignore){return calendarOutput({status:'denied'});}
}
