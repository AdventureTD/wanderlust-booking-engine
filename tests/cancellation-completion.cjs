const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./complete-cancellation.cjs');
test('Calendar ACK survives reconstruction and reopen without another provider call',async()=>{
 const f=await fixture({count:1,calendarAck:true});const result=await f.api.adminCancelBooking('WC-1038','');assert.equal(result.effects.calendar,'CANCELLED');
 const again=await fixture({},f.db);const detail=await again.api.adminGetBooking('WC-1038');assert.equal(detail.cancellation.effects.calendar,'CANCELLED');assert.equal(detail.cancellation.coreComplete,true);assert.equal(detail.cancellation.complete,false);
 await again.api.adminCancelBooking('WC-1038','');assert.equal(again.calls.filter(c=>c[0]==='network').length,0);
});

const {fixture:pageFixture}=require('./cancellation-page.cjs');
test('reopen displays durable effects and explicit Resume button for already cancelled booking',async()=>{
 const f=pageFixture();const p=f.api.openDetail('WC-1038');f.loads.get('WC-1038')({ok:true,summary:{bookingNumber:'WC-1038',status:'Cancelled'},rooms:[{_id:'r',quantity:1}],cancellation:{reservation:'CANCELLED',coreComplete:true,complete:false,effects:{email:'ACKNOWLEDGED',calendar:'CANCELLED',ads:'NEEDS_RECONCILIATION',ga4:'NEEDS_RECONCILIATION'}}});await p;
 assert.match(f.$w('#cancelStatusText').text,/calendar=CANCELLED/);assert.match(f.$w('#btnCancelBooking').label,/Resume/);await f.$w('#btnCancelBooking').click();assert.match(f.$w('#cancelStatusText').text,/unknown.*never resent/i);
});

const crypto=require('node:crypto');
const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const adsSecrets={WBE_GOOGLE_ADS_ADJUSTMENTS_ENABLED:'true',GOOGLE_ADS_CUSTOMER_ID:'123',GOOGLE_ADS_CONVERSION_ACTION_ID:'456',GOOGLE_ADS_LOGIN_CUSTOMER_ID:'',GOOGLE_ADS_DEVELOPER_TOKEN:'A'.repeat(22),GOOGLE_SA_CLIENT_EMAIL:'inert@example.invalid',GOOGLE_SA_PRIVATE_KEY:key};
function adsApproval(f){f.db.BookingCancellationAnalytics.push({_id:'s',bookingNumber:'WC-1038',ads:{approved:true,originalRecorded:true,consentEligible:true,withdrawn:false,consentValidUntil:new Date(Date.now()+60000).toISOString(),orderId:'WC-1038',customerId:'123',conversionActionId:'456'}});}
test('Ads suspension and approval changes at OAuth and START prevent provider dispatch',async()=>{
 for(const phase of ['initial','oauth','start','oauth-approval','start-approval','missing-settings']){
  const options={count:1,secrets:adsSecrets};
  const change=db=>{if(phase.endsWith('approval'))db.BookingCancellationAnalytics[0].ads.approved=false;else db.Settings[0].value='1';};
  if(phase.startsWith('oauth'))options.onNetwork=async(url,db)=>{if(url.includes('oauth2.googleapis.com'))change(db);};
  if(phase.startsWith('start'))options.onInsert=async(c,row,db)=>{if(row.effect==='ADS')change(db);};
  const f=await fixture(options);adsApproval(f);if(phase==='initial')change(f.db);if(phase==='missing-settings')f.db.Settings=[];
  await f.api.adminCancelBooking('WC-1038','');assert.equal(f.calls.filter(c=>c[0]==='network'&&c[1].includes('googleads.googleapis.com')).length,0,phase);
 }
});

test('GA4 withdrawal during START readback prevents collect and never resets START',async()=>{
 const options={count:1,onGet:async(c,id,db)=>{if(c==='BookingCancellationEffects'&&db[c].some(r=>r._id===id&&r.effect==='GA4'&&r.state==='STARTED'))db.BookingCancellationAnalytics[0].ga4.withdrawn=true;}};
 const f=await fixture(options);f.db.BookingCancellationAnalytics.push({_id:'s',bookingNumber:'WC-1038',ga4:{approved:true,clientId:'original.client',transactionId:'WC-1038',value:20000,currency:'USD',measurementId:'G-INERT',duplicateCheckClear:true,consentEligible:true,consentValidUntil:new Date(Date.now()+60000).toISOString(),withdrawn:false}});
 await f.api.adminCancelBooking('WC-1038','');assert.equal(f.calls.filter(c=>c[0]==='network'&&c[1].startsWith('https://www.google-analytics.com/mp/collect')).length,0);
 f.db.BookingCancellationAnalytics[0].ga4.withdrawn=false;const again=await fixture({},f.db);await again.api.adminCancelBooking('WC-1038','');assert.equal(again.calls.filter(c=>c[0]==='network'&&c[1].includes('google-analytics.com')).length,0);
});

test('retained cancellation decision fences admin edit invoice edit and issuance before writes',async()=>{
 for(const method of ['adminUpdateBooking','adminUpdateInvoice','adminIssueNewInvoice']){
 const f=await fixture({count:1});f.db.BookingCancellationOperations.push({_id:'s',bookingNumber:'WC-1038'});
 await assert.rejects(f.api[method](method==='adminUpdateInvoice'?'i':'WC-1038',{guestName:'changed',grandTotal:1}),/Cancellation in progress/);
 assert.equal(f.calls.filter(c=>['update','insert','network'].includes(c[0])).length,0,method);
 }
});

const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('actual legacy cancel and invoice entry respect shared retained decision before any write',async()=>{
 for(const which of ['cancelBooking','issueBookingInvoice']){
 const calls=[];const sdk={get:async()=>({_id:'r',bookingNumber:'WC-1038',status:'confirmed'}),query(c){return {eq(){return this;},limit(){return this;},async find(){return {items:[{_id:c==='Bookings'?'r':'s',bookingNumber:'WC-1038',status:'confirmed'}],hasNext:()=>false};}};},update:async()=>{calls.push('WRITE');return {};}};
 const src=fs.readFileSync(path.join(__dirname,'../velo/backend/availability.web.js'),'utf8');const start=src.indexOf('export const '+which+' =');const end=src.indexOf('export const ',start+1);
 const helper=fs.readFileSync(path.join(__dirname,'../velo/backend/bookingCancellation.js'),'utf8').replace(/^import.*;$/gm,'').replace(/export /g,'');
 const ctx=vm.createContext({wixData:sdk,BOOKINGS:'Bookings',BOOKING_SUMMARIES:'BookingSummary',Permissions:{Admin:1,Anyone:0},webMethod:(p,f)=>f,console:{log(){}},getActiveInvoice:async()=>{throw Error('INVOICE_WORK_REACHED');}});
 vm.runInContext(helper+'\n'+src.slice(start,end).replace('export const','const')+'\nglobalThis.invoke='+which+';',ctx);
 await assert.rejects(ctx.invoke(which==='cancelBooking'?'r':'WC-1038'),/Cancellation in progress/);assert.equal(calls.length,0);
 }
});

test('email request binds retained operation and explicitly requests redirect denial',async()=>{
 const f=await fixture({count:1});await f.api.adminCancelBooking('WC-1038','');const call=f.calls.find(c=>c[0]==='network'&&c[1].endsWith('/send-cancellation-email'));
 const start=f.db.BookingCancellationEffects.find(r=>r.effect==='EMAIL'&&r.state==='STARTED');assert.equal(call[2].operation_id,start._id);assert.equal(call[4],'error');
});

test('closed detail cannot revive from late load and stale rejection cannot replace new detail',async()=>{
 const f=pageFixture();const old=f.api.openDetail('WC-1038');f.$w('#btnCloseDetail').click();f.loads.get('WC-1038')({ok:true,summary:{bookingNumber:'WC-1038'},rooms:[{_id:'r',quantity:1}]});await old;
 await f.$w('#btnCancelBooking').click();await f.$w('#btnCancelBooking').click();assert.equal(f.calls.length,0);
 const stale=f.api.openDetail('WC-1038'),next=f.api.openDetail('WC-1036');f.loads.get('WC-1036')({ok:true,summary:{bookingNumber:'WC-1036'},rooms:[{_id:'other',quantity:1}]});await next;const before=f.$w('#detailStatusText').text;f.loads.get('WC-1038').reject(Error('old error'));await stale;assert.equal(f.$w('#detailStatusText').text,before);
});

test('baseline GREEN: decision appearing between admin child writes stops later stale writes',async()=>{
 const f=await fixture({count:2,onUpdate:async(c,row,db)=>{if(c==='Bookings')db.BookingCancellationOperations.push({_id:'s',bookingNumber:'WC-1038'});}});
 await assert.rejects(f.api.adminUpdateBooking('WC-1038',{guestName:'changed',grandTotal:1}),/Cancellation in progress/);
 assert.equal(f.calls.filter(c=>c[0]==='update').length,1);assert.equal(f.db.BookingInvoices[0].grandTotal,22286.74);assert.equal(f.db.Bookings[1].guestName,undefined);
});
test('baseline GREEN: Calendar ACK loss reads retained receipt and unknown email remains nonretryable',async()=>{
 const ack=crypto.createHash('sha256').update('cancellation-v1:s:calendar-delete-ack-v1').digest('hex').slice(0,32);
 const f=await fixture({count:1,calendarAck:true,lost:'BookingCancellationEffects:'+ack});const out=await f.api.adminCancelBooking('WC-1038','');assert.equal(out.effects.calendar,'CANCELLED');
 const g=await fixture({count:1,malformed:true});await g.api.adminCancelBooking('WC-1038','');const again=await fixture({calendarAck:true},g.db);const result=await again.api.adminCancelBooking('WC-1038','');assert.equal(result.effects.email,'UNKNOWN');assert.equal(again.calls.filter(c=>c[0]==='network'&&c[1].endsWith('/send-cancellation-email')).length,0);
});
