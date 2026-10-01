'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const copy=x=>structuredClone(x);
const crypto=require('node:crypto');
const testKey=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
async function fixture(options={},retained){
 const db=retained||{Bookings:Array.from({length:options.count??51},(_,i)=>({_id:'r'+i,bookingNumber:'WC-1038',roomCode:'suite',quantity:1,status:'confirmed'})),BookingSummary:[{_id:'s',bookingNumber:'WC-1038',guestName:'INERT',guestEmail:'test@example.invalid',checkIn:new Date('2027-02-27T12:00:00Z'),checkOut:new Date('2027-03-07T12:00:00Z'),status:'confirmed',roomCount:options.count??51}],BookingInvoices:[{_id:'i',bookingNumber:'WC-1038',grandTotal:22286.74,status:'Active'}],BookingPayments:[],BookingReports:[],BookingCancellationOperations:[],BookingCancellationEffects:[],BookingCancellationAnalytics:[],Settings:[{_id:'ads-switch',key:'suspendGoogleAds',value:'0'}]};
 const calls=[];const sdk={query(c){let filters=[],lim=50;const q={eq(k,v){filters.push(r=>r[k]===v);return q;},hasSome(k,v){filters.push(r=>v.includes(r[k]));return q;},descending(){return q;},limit(n){lim=n;return q;},async find(){calls.push(['query',c]);if(options.missing===c)throw Error('MISSING_COLLECTION');const rows=db[c].filter(r=>filters.every(f=>f(r)));function page(start){return {items:copy(rows.slice(start,start+lim)),totalCount:rows.length,hasNext(){return start+lim<rows.length;},async next(){return page(start+lim);}};}return page(0);}};return q;},async get(c,id){calls.push(['get',c,id]);if(options.onGet)await options.onGet(c,id,db);return copy(db[c].find(r=>r._id===id)||null);},async insert(c,row){calls.push(['insert',c,row._id]);if(options.fail===c+':'+row._id)throw Error('WRITE_FAILURE');if(db[c].some(r=>r._id===row._id))throw Error('DUPLICATE');db[c].push(copy(row));if(options.onInsert)await options.onInsert(c,row,db);if(options.lost===c+':'+row._id)throw Error('ACK_LOST');return copy(row);},async update(c,row){calls.push(['update',c,row._id]);if(options.fail===c+':'+row._id)throw Error('WRITE_FAILURE');if(options.beforeUpdate)await options.beforeUpdate(c,row,db);const i=db[c].findIndex(r=>r._id===row._id);assert.ok(i>=0);db[c][i]=copy(row);if(options.onUpdate)await options.onUpdate(c,row,db);if(options.lost===c+':'+row._id)throw Error('ACK_LOST');return copy(row);}};
 const patchItems={patch(c,id){const fields={};const builder={setField(k,v){fields[k]=copy(v);return builder;},async run(){calls.push(['update',c,id,'patch',copy(fields)]);if(options.fail===c+':'+id)throw Error('WRITE_FAILURE');if(options.beforeUpdate)await options.beforeUpdate(c,{_id:id,...fields},db);const i=db[c].findIndex(r=>r._id===id);assert.ok(i>=0);db[c][i]={...db[c][i],...copy(fields)};if(options.onUpdate)await options.onUpdate(c,copy(db[c][i]),db);if(options.lost===c+':'+id)throw Error('ACK_LOST');return copy(db[c][i]);}};return builder;}};
 const deny=()=>{throw Error('FORBIDDEN');};
 const ext={'@wix/data':{items:patchItems},'crypto':{default:crypto},'wix-data':{default:sdk},'wix-web-module':{Permissions:{Admin:1,Anyone:0},webMethod:(p,f)=>f},'wix-users-backend':{currentUser:{loggedIn:true,getRoles:async()=>[{title:'Admin'}]}},'wix-secrets-backend':{getSecret:async k=>{calls.push(['secret',k]);if(options.secretFail)throw Error('SECRET');if(options.secrets&&k in options.secrets)return options.secrets[k];return k==='WBE_INVOICE_SERVICE_URL'?'https://inert.invalid':k==='WBE_GA4_MEASUREMENT_ID'?'G-INERT':'inert';}},'wix-fetch':{fetch:async(url,args)=>{calls.push(['network',url,(url.includes('oauth2.googleapis.com')?args.body:JSON.parse(args.body)),args.headers,args.redirect]);if(options.onNetwork)await options.onNetwork(url,db);if(url.endsWith('/reconcile-cancellation-calendar')&&options.calendarAck)return {ok:true,json:async()=>({status:'CANCELLED',booking_number:'WC-1038',event_id:'exact-event',calendar_id:'owner-calendar',disposition:'DELETED',deletion_version:1})};if(url.includes('oauth2.googleapis.com'))return {ok:true,json:async()=>({access_token:'inert-token'}),text:async()=>JSON.stringify({access_token:'inert-token'})};if(url.includes('googleads.googleapis.com'))return {ok:true,json:async()=>({results:[{orderId:'WC-1038',conversionAction:'customers/123/conversionActions/456',adjustmentType:'RETRACTION'}]}),text:async()=>JSON.stringify({results:[JSON.parse(args.body).conversionAdjustments[0]]})};if(url.includes('/debug/mp/collect'))return {ok:true,json:async()=>({validationMessages:[]}),text:async()=>JSON.stringify({validationMessages:[]})};if(url.includes('/mp/collect'))return {ok:true,status:204};if(options.hang)return new Promise(()=>{});if(options.sendFail)throw Error('TRANSPORT');return {ok:true,status:200,json:async()=>options.malformed?{}:{ok:true,operation_id:JSON.parse(args.body).operation_id,gmail_message_id:'receipt',booking_number:'WC-1038'}};}},'backend/search.web':{searchAvailability:deny},'backend/availability.web':{issueBookingInvoice:deny},'backend/googleAdsConversions.web':{adjustBookingConversion:deny,isGoogleAdsSuspended:deny}};
 const ctx=vm.createContext({Date,Buffer,URLSearchParams,console:{log(){},warn(){},error(){}},setTimeout,clearTimeout});const cache=new Map();
 function load(id){if(cache.has(id))return cache.get(id);let m;if(ext[id]){const e=ext[id];m=new vm.SyntheticModule(Object.keys(e),function(){Object.keys(e).forEach(k=>this.setExport(k,e[k]));},{context:ctx});}else {assert.ok(/^backend\/(adminConsole.web|bookingCancellation|cancellationEffects)$/.test(id),'Denied import '+id);m=new vm.SourceTextModule(fs.readFileSync(path.join(root,'velo',id+'.js'),'utf8'),{context:ctx,identifier:id});}cache.set(id,m);return m;}
 const m=load('backend/adminConsole.web');await m.link(load);await m.evaluate();return {db,calls,options,sdk,patchItems,api:m.namespace};
}
test('full no-fee cancellation paginates and reads back reservation before optional effects',async()=>{
 const f=await fixture();const before=JSON.stringify([f.db.BookingInvoices,f.db.BookingPayments]);
 const r=await f.api.adminCancelBooking('WC-1038','Full cancellation');
 assert.equal(f.db.Bookings.filter(r=>r.status==='Cancelled').length,51);
 assert.equal(f.db.BookingSummary[0].status,'Cancelled');assert.equal(r.reservation,'CANCELLED');
 assert.equal(JSON.stringify([f.db.BookingInvoices,f.db.BookingPayments]),before);
 assert.equal(r.complete,false);
});
test('preflight rejects invalid quantity without any write',async()=>{
 const f=await fixture({count:1});f.db.Bookings[0].quantity=0;
 await assert.rejects(f.api.adminCancelBooking('WC-1038',''),/Invalid room/);
 assert.equal(f.calls.filter(x=>['insert','update'].includes(x[0])).length,0);
});
test('cancelled detail exposes zero current due while keeping original historical amount',async()=>{
 const f=await fixture();await f.api.adminCancelBooking('WC-1038','');
 const r=await f.api.adminGetBooking('WC-1038');assert.equal(r.totals.balance,0);
 assert.equal(r.totals.grandTotal,22286.74);assert.equal(r.rooms.length,51);
});
test('concurrent cancellations share one persistent email claim and provider receipt',async()=>{
 const f=await fixture({count:2});const rs=await Promise.all([f.api.adminCancelBooking('WC-1038',''),f.api.adminCancelBooking('WC-1038','')]);
 assert.equal(f.calls.filter(x=>x[0]==='network'&&x[1].endsWith('/send-cancellation-email')).length,1);
 const again=await fixture({},f.db);const r=await again.api.adminCancelBooking('WC-1038','');
 assert.equal(r.effects.email,'ACKNOWLEDGED');assert.equal(again.calls.filter(x=>x[0]==='network'&&x[1].endsWith('/send-cancellation-email')).length,0);
});
test('cancellation wires authenticated Calendar reconciliation after reservation readback',async()=>{
 const f=await fixture({count:1});await f.api.adminCancelBooking('WC-1038','');
 const call=f.calls.find(x=>x[0]==='network'&&x[1].endsWith('/reconcile-cancellation-calendar'));
 assert.ok(call);assert.equal(call[2].booking_number,'WC-1038');
});
test('reviewed original GA4 metadata sends one refund with original client and amount',async()=>{
 const f=await fixture({count:1});f.db.BookingCancellationAnalytics.push({_id:'s',bookingNumber:'WC-1038',ga4:{approved:true,clientId:'original.client',transactionId:'WC-1038',value:20000,currency:'USD',measurementId:'G-INERT',duplicateCheckClear:true,consentEligible:true,consentValidUntil:new Date(Date.now()+60000).toISOString(),withdrawn:false}});
 const r=await f.api.adminCancelBooking('WC-1038','');const sends=f.calls.filter(x=>x[0]==='network'&&x[1].startsWith('https://www.google-analytics.com/mp/collect?'));
 assert.equal(sends.length,1);assert.equal(sends[0][2].client_id,'original.client');assert.equal(sends[0][2].events[0].params.value,20000);assert.equal(r.effects.ga4,'RECEIVED_UNVERIFIED');
 const again=await fixture({},f.db);await again.api.adminCancelBooking('WC-1038','');assert.equal(again.calls.filter(x=>x[0]==='network'&&x[1].startsWith('https://www.google-analytics.com/mp/collect?')).length,0);
});
test('private reviewed Ads retraction uses Ads API not event ingestion and retains receipt',async()=>{
 const f=await fixture({count:1,secrets:{WBE_GOOGLE_ADS_ADJUSTMENTS_ENABLED:'true',GOOGLE_ADS_CUSTOMER_ID:'123',GOOGLE_ADS_CONVERSION_ACTION_ID:'456',GOOGLE_ADS_LOGIN_CUSTOMER_ID:'',GOOGLE_ADS_DEVELOPER_TOKEN:'A'.repeat(22),GOOGLE_SA_CLIENT_EMAIL:'inert@example.invalid',GOOGLE_SA_PRIVATE_KEY:testKey}});
 f.db.BookingCancellationAnalytics.push({_id:'s',bookingNumber:'WC-1038',ads:{approved:true,originalRecorded:true,consentEligible:true,withdrawn:false,consentValidUntil:new Date(Date.now()+60000).toISOString(),orderId:'WC-1038',customerId:'123',conversionActionId:'456'}});
 const r=await f.api.adminCancelBooking('WC-1038','');const sends=f.calls.filter(x=>x[0]==='network'&&x[1].includes('googleads.googleapis.com'));
 assert.equal(sends.length,1);assert.equal(sends[0][2].conversionAdjustments[0].adjustmentType,'RETRACTION');assert.equal(sends[0][2].partialFailure,true);assert.equal(r.effects.ads,'ACKNOWLEDGED');assert.equal(typeof sends[0][3]['developer-token'],'string');
 assert.equal(f.calls.filter(x=>x[0]==='network'&&x[1].includes('datamanager')).length,0);
});
test('historically cancelled reservation never starts a new email without prior-delivery reconciliation',async()=>{
 const f=await fixture({count:1});f.db.BookingSummary[0].status=' CANCELED ';f.db.Bookings[0].status='Cancelled';const r=await f.api.adminCancelBooking('WC-1038','');
 assert.equal(f.calls.filter(x=>x[0]==='network'&&x[1].endsWith('/send-cancellation-email')).length,0);assert.equal(r.effects.email,'NEEDS_RECONCILIATION');
});
test('quantity total must match Summary before a cancellation claim',async()=>{const f=await fixture({count:1});f.db.BookingSummary[0].roomCount=2;await assert.rejects(f.api.adminCancelBooking('WC-1038',''),/Room count/);assert.equal(f.calls.filter(x=>['insert','update'].includes(x[0])).length,0);});
test('admin readback reports retained email state without replaying any effect',async()=>{const f=await fixture({count:1});await f.api.adminCancelBooking('WC-1038','');const before=f.calls.length;const r=await f.api.adminGetBooking('WC-1038');assert.equal(r.cancellation.reservation,'CANCELLED');assert.equal(r.cancellation.effects.email,'ACKNOWLEDGED');assert.equal(f.calls.slice(before).filter(x=>['insert','update','network','secret'].includes(x[0])).length,0);});
test('effect native IDs remain bounded for a UUID Summary identity',async()=>{const f=await fixture({count:1});f.db.BookingSummary[0]._id='12345678-1234-1234-1234-123456789abc';await f.api.adminCancelBooking('WC-1038','');assert.ok(f.db.BookingCancellationEffects.every(r=>r._id.length<=36));});
module.exports={fixture};
