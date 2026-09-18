'use strict';
// Synthetic-only native producer graph. No preseeded booking, Summary or AUTH.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../velo');
async function producer(){
 const rows=new Map(),trace=[],wires=[];let id=0,entropy=0,bookingSequence=0;
 const key=(c,id)=>c+':'+id,copy=structuredClone;
 const cols=new Set(['Packages','SeasonalRates','Rooms','Bookings','BookingSummary','BookingInvoices','GoogleAdsAttemptJournal']);
 const sdk={
  async insert(c,row){assert.ok(cols.has(c));assert.ok(['Bookings','BookingSummary','BookingInvoices','GoogleAdsAttemptJournal'].includes(c));const saved={...copy(row),_id:row._id||'INERT_'+(++id)};assert.ok(!rows.has(key(c,saved._id)),'unique native insert');rows.set(key(c,saved._id),copy(saved));trace.push(['insert',c,saved.kind||'']);return copy(saved);},
  async get(c,id){assert.ok(cols.has(c));trace.push(['get',c]);return copy(rows.get(key(c,id)));},
  async update(c,row){assert.ok(['BookingSummary','BookingInvoices'].includes(c));assert.ok(rows.has(key(c,row._id)));rows.set(key(c,row._id),copy(row));trace.push(['update',c]);return copy(row);},
  async remove(){throw Error('UNEXPECTED_REMOVE');},
  query(c){assert.ok(cols.has(c),c);let filters=[],cap=1000,sort;
   return {eq(k,v){filters.push(r=>r[k]===v);return this;},lt(k,v){filters.push(r=>r[k]<v);return this;},gt(k,v){filters.push(r=>r[k]>v);return this;},hasSome(k,v){filters.push(r=>v.includes(r[k]));return this;},limit(n){cap=n;return this;},descending(k){sort=k;return this;},async find(){trace.push(['find',c]);let items=[...rows].filter(([k,v])=>k.startsWith(c+':')&&filters.every(f=>f(v))).map(([,v])=>copy(v));if(sort)items.sort((a,b)=>a[sort]<b[sort]?1:-1);assert.ok(items.length<=cap,'fixture must not silently paginate');return {items,hasNext:()=>false};}};
  }
 };
 rows.set(key('Packages','INERT_PACKAGE'),{_id:'INERT_PACKAGE',title:'Inert package',numberOfNights:1,baseRate:100,priceModifier:1});
 const deny=()=>{throw Error('NETWORK_DENIED');};
 const context=vm.createContext({Date,Buffer,URLSearchParams,console:{log(){},warn(){},error(){}},fetch:deny,XMLHttpRequest:deny,WebSocket:deny});
 const settings={googleAdsPrivateJournalEnabled:'1',suspendGoogleAds:'0'};
 const external={
  'crypto':{default:{...crypto,randomBytes:n=>Buffer.alloc(n,++entropy),createSign:()=>({update(){return this;},sign:()=>Buffer.from('INERT_SIGNATURE')})}},
  'wix-data':{default:sdk},'wix-web-module':{Permissions:{Anyone:0,Admin:1},webMethod:(_,fn)=>fn},
  'backend/settings.web':{getAllSettings:async()=>({...settings}),incrementSetting:async name=>{assert.equal(name,'bookingNumber');return ++bookingSequence===1?'INERT_FRESH':'INERT_FRESH_'+bookingSequence;}},
  'libphonenumber-js/max':{parsePhoneNumberFromString:(s,o)=>require('libphonenumber-js/max').parsePhoneNumberFromString(s,JSON.parse(JSON.stringify(o)))},
  'wix-secrets-backend':{getSecret:async name=>{const secrets={WBE_PRICING_QUOTE_SECRET:'INERT_PRICING_SECRET_NOT_LIVE_0123456789',GOOGLE_ADS_CUSTOMER_ID:'1234567890',GOOGLE_ADS_CONVERSION_ACTION_ID:'123456',GOOGLE_SA_CLIENT_EMAIL:'offline@example.invalid',GOOGLE_SA_PRIVATE_KEY:'INERT_NOT_A_KEY'};assert.ok(name in secrets,name);return secrets[name];}},
  'wix-fetch':{fetch:async(url,options)=>{trace.push(['fetch',url]);if(url==='https://oauth2.googleapis.com/token')return {ok:true,json:async()=>({access_token:'INERT_NOT_A_TOKEN',expires_in:3600})};assert.equal(url,'https://datamanager.googleapis.com/v1/events:ingest');assert.equal(options.method,'post');wires.push(JSON.parse(options.body));return {ok:true,status:200,text:async()=>JSON.stringify({requestId:'inert-fresh-receipt'}),json:async()=>({requestId:'inert-fresh-receipt'})};}}
 };
 const allowed=new Set(['backend/availability.web','backend/googleAdsConversions.web','backend/googleAdsAttemptJournal','backend/dataManagerClient.web','backend/googleAdsHttpDiagnostics','backend/hashUtils.web','backend/rateResolver','backend/pricingQuote','public/phoneNormalization']);
 const cache=new Map();function make(s){if(cache.has(s))return cache.get(s);let m;if(external[s]){const e=external[s];m=new vm.SyntheticModule(Object.keys(e),function(){for(const k of Object.keys(e))this.setExport(k,e[k]);},{context,identifier:s});}else{assert.ok(allowed.has(s),'unadmitted '+s);m=new vm.SourceTextModule(fs.readFileSync(path.join(root,s+'.js'),'utf8'),{context,identifier:s});}cache.set(s,m);return m;}
 const availability=make('backend/availability.web');await availability.link(make);await availability.evaluate();
 const quote=await cache.get('backend/pricingQuote').namespace.createLockedPricingQuote('INERT_PACKAGE','2027-01-01','2027-01-02');
 assert.equal([...rows].filter(([k])=>!k.startsWith('Packages:')).length,0,'quote cannot seed authority');
 return {rows,trace,wires,sdk,quote,availability:availability.namespace,sender:cache.get('backend/googleAdsConversions.web').namespace,cache};
}
function support(file,boundary,name){const text=fs.readFileSync(path.join(__dirname,file),'utf8');const pos=text.indexOf(boundary);assert.ok(pos>0);const box={require,__dirname,console,structuredClone,Buffer,URL,URLSearchParams,Date,setTimeout,clearTimeout};vm.runInNewContext(text.slice(0,pos)+'\nthis.factory='+name+';',box);return box.factory;}
for(const phone of [{label:'valid NANP',raw:'2025550100',dial:'1'},{label:'unrecognized optional marketing phone',raw:'7700900123',dial:'44'}])
test('fresh actual allocation to Summary journal wire: '+phone.label,{timeout:5000},async()=>{
 const f=await producer();
 const bridge=await support('click-attribution-corrections.cjs',"test('partitioned",'fixture')({query:'gclid=INERT+EXACT&gbraid=INERT_BRAID&msclkid=INERT_MS'});
 try{
 const responses=[];const makePage=support('attribution-hotfix.cjs','function bookingBackend','page');
 const page=await makePage({setup:"_summaryRooms=[{roomCode:'adventure_suite',qty:1,numGuests:2},{roomCode:'two_bedroom_apartment',qty:1,numGuests:3}];_selectedPackageId='INERT_PACKAGE';_pricingQuoteToken="+JSON.stringify(f.quote.token)+';',book:async p=>{const r=await f.availability.createBooking(p);responses.push(r);return r;}});
 page.w('#inputGuestPhone').value=phone.raw;page.w('#inputDialingCode').value=phone.dial;
 page.c.waitForClickAttribution=()=>bridge.ready();page.c.getStoredClickIds=bridge.api.getStoredClickIds;page.c.clearClickIds=bridge.api.clearClickIds;page.c.wixData=f.sdk;
 let upload;page.c.recordBookingConversion=p=>{upload=f.sender.recordBookingConversion(p);return upload;};
 await page.click();assert.equal(responses.length,2,'optional marketing normalization must not block either room reservation');assert.ok(upload,'actual Summary dispatched optional conversion');await upload;
 // Optional Summary then() cleanup may still be scheduled; its actual read/clear
 // traverses the same page/worker bridge rather than clearing a separate fixture.
 await new Promise(r=>setTimeout(r,30));
 assert.equal(responses.length,2);assert.match(responses[0].conversionCapability,/^gac1\.[a-f0-9]{64}$/);assert.equal(responses[1].conversionCapability,undefined);
 const records=[...f.rows.values()],auth=records.filter(r=>r.kind==='AUTH');assert.equal(auth.length,1);assert.deepEqual(records.filter(r=>r.kind).map(r=>r.kind),['AUTH','ATTEMPT','RESULT']);
 const summary=records.find(r=>r.guestEmail);assert.equal(auth[0].roomId,responses[0]._id);assert.equal(auth[0].summaryId,summary._id);assert.equal(auth[0].tokenHash,crypto.createHash('sha256').update(responses[0].conversionCapability).digest('hex'));assert.equal(summary.gclid,'INERT+EXACT');assert.ok(page.payloads.every(p=>p.gclid==='INERT+EXACT'&&p.gbraid==='INERT_BRAID'&&p.msclkid==='INERT_MS'));
 assert.equal(f.wires.length,1);assert.equal(f.wires[0].events[0].userData.userIdentifiers.some(i=>'phoneNumber' in i),phone.label==='valid NANP');
 if(phone.label!=='valid NANP')assert.equal(summary.guestPhone,phone.raw,'unrecognized phone is retained literally for reservation contact, not repaired into E.164');
 assert.equal(f.wires[0].events[0].transactionId,responses[0].bookingNumber);assert.equal(f.wires[0].events[0].adIdentifiers.gclid,'INERT+EXACT');
 assert.equal([...f.rows.keys()].filter(k=>k.startsWith('Bookings:')).length,2);
 const invoice=[...f.rows].find(([k])=>k.startsWith('BookingInvoices:'))[1];assert.equal(invoice.grandTotal,587.5);assert.equal(page.invoices.length,1);assert.equal(page.timers.length,1);
 const authIndex=f.trace.findIndex(t=>t[0]==='insert'&&t[2]==='AUTH');assert.ok(authIndex>f.trace.findIndex(t=>t[0]==='insert'&&t[1]==='BookingSummary'));
 assert.equal(bridge.workerStore.getItem('wl_click_attribution'),null);assert.equal(bridge.pageStore.getItem('wl_click_attribution'),null);
 }finally{bridge.close();}
});

// Actual consumer lifecycle, actual fresh producer AUTH; no seeded admission.
for (const schedule of ['first','additional','final','after-final-await','query','reaccept','same-record-reaccept','clear','clear-reaccept','contact-only','contact-denial','contact-reaccept','capture-throw','wait-reject','microsoft-denial'])
test('fresh Summary consumption fence: '+schedule,{timeout:8000},async()=>{
 const f=await producer();
 const bridge=await support('click-attribution-corrections.cjs',"test('partitioned",'fixture')({query:schedule.startsWith('contact')?'':'gclid=INERT_OLD&msclkid=INERT_MS',banner:schedule.includes('reaccept'),hold:d=>schedule==='after-final-await'&&d.type==='wbe-click-revoke'});
 try {
 if(schedule.includes('reaccept'))bridge.click('Accept All');
 await bridge.ready();
 const original=bridge.api.getStoredClickIds(undefined,true);
 assert.ok(original);
 const tick=()=>new Promise(r=>setTimeout(r,20));
 let changed=false;
 async function change(){
  if(changed)return;changed=true;
  if(schedule.startsWith('clear'))await bridge.api.clearClickIds(original);
  else {bridge.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await tick();}
  assert.equal(bridge.api.getStoredClickIds(original),null,'original snapshot must lose authority');
  if(schedule.includes('reaccept')){
   if(!schedule.startsWith('clear')){bridge.click('Cookie settings');bridge.click('Accept All');}
   const fresh=schedule==='same-record-reaccept'?original:{gclid:'INERT_NEW',gbraid:'',wbraid:'',msclkid:'',capturedAt:new Date().toISOString()};
   bridge.pageStore.setItem('wl_click_attribution',JSON.stringify(fresh));
   await bridge.ready();assert.equal(bridge.api.getStoredClickIds().gclid,fresh.gclid);
   assert.equal(bridge.api.getStoredClickIds(original),null,'reaccept must not revive original work');
  }
 }
 let count=0,upload,ms=0;
 const page=await support('attribution-hotfix.cjs','function bookingBackend','page')({setup:"_summaryRooms=[1,2,3].map(()=>({roomCode:'adventure_suite',qty:1,numGuests:2}));_selectedPackageId='INERT_PACKAGE';_pricingQuoteToken="+JSON.stringify(f.quote.token)+';',book:async p=>{
  const r=await f.availability.createBooking(p);count++;
  const at=schedule==='additional'?2:schedule==='final'?3:1;
  if(!['contact-only','query','capture-throw','wait-reject','after-final-await'].includes(schedule)&&count===at)await change();
  return r;
 }});
 page.c.waitForClickAttribution=async()=>{if(schedule==='wait-reject')throw Error('INERT_READINESS');};
 page.c.getStoredClickIds=schedule==='capture-throw'?()=>{throw Error('INERT_CAPTURE');}:bridge.api.getStoredClickIds;
 page.c.clearClickIds=bridge.api.clearClickIds;
 page.c.wixData={...f.sdk,query(c){const q=f.sdk.query(c);const find=q.find;q.find=async()=>{const result=await find();if(c==='BookingSummary'&&schedule==='query')await change();return result;};return q;}};
 page.c.recordBookingConversion=p=>{upload=f.sender.recordBookingConversion(p);return upload;};
 page.c.recordMicrosoftBookingConversion=async()=>{ms++;return {ok:false};};
 if(schedule==='after-final-await'){
  const track=page.c.trackPurchase;page.c.trackPurchase=p=>{track(p);bridge.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);assert.equal(bridge.deliveries.length,1);bridge.deliveries[0].deliver();assert.equal(bridge.api.getStoredClickIds(original),null);};
 }
 await page.click();if(upload)await upload;await page.click();
 assert.equal(count,3);assert.equal(page.invoices.length,1);assert.equal(page.timers.length,1);
 assert.equal([...f.rows.keys()].filter(k=>k.startsWith('Bookings:')).length,3);
 assert.equal([...f.rows.values()].filter(r=>r.kind==='AUTH').length,1);
 assert.equal(ms,0);
 const allowed=schedule==='contact-only';assert.equal(f.wires.length,allowed?1:0);
 if(allowed){assert.ok(f.wires[0].events[0].userData);assert.equal(f.wires[0].events[0].adIdentifiers,undefined);}
 else {assert.equal(upload,undefined);assert.deepEqual([...f.rows.values()].filter(r=>r.kind).map(r=>r.kind),['AUTH']);}
 const boundary=schedule==='additional'?2:schedule==='final'?3:1;
 if(changed)for(const p of page.payloads.slice(boundary))assert.ok(!p.gclid&&!p.msclkid,'later room must omit revoked IDs');
 }finally{bridge.close();}
});

test('two concurrent fresh bookings keep original capabilities and click snapshots separate',{timeout:8000},async()=>{
 const f=await producer(),bridges=[],pages=[],uploads=[],inputs=[];
 try {
 for(const id of ['INERT_A','INERT_B']){
  const b=await support('click-attribution-corrections.cjs',"test('partitioned",'fixture')({query:'gclid='+id});bridges.push(b);
  const p=await support('attribution-hotfix.cjs','function bookingBackend','page')({setup:"_summaryRooms=[{roomCode:'adventure_suite',qty:1,numGuests:2}];_selectedPackageId='INERT_PACKAGE';_pricingQuoteToken="+JSON.stringify(f.quote.token)+';',book:q=>f.availability.createBooking(q)});
  p.c.waitForClickAttribution=()=>b.ready();p.c.getStoredClickIds=b.api.getStoredClickIds;p.c.wixData=f.sdk;
  p.c.recordBookingConversion=q=>{inputs.push(q);const u=f.sender.recordBookingConversion(q);uploads.push(u);return u;};pages.push(p);
 }
 await Promise.all(pages.map(p=>p.click()));await Promise.all(uploads);
 assert.equal(f.wires.length,2);assert.equal(new Set(inputs.map(p=>p.transactionId)).size,2);assert.equal(new Set(inputs.map(p=>p.conversionCapability)).size,2);
 for(const p of inputs){const event=f.wires.find(w=>w.events[0].transactionId===p.transactionId).events[0];assert.equal(event.adIdentifiers.gclid,p.gclid);assert.equal((await f.sender.recordBookingConversion(p)).ok,false);}
 assert.equal(f.wires.length,2);assert.equal([...f.rows.values()].filter(r=>r.kind==='AUTH').length,2);assert.equal([...f.rows.values()].filter(r=>r.kind==='ATTEMPT').length,2);
 for(const p of pages){assert.equal(p.invoices.length,1);assert.equal(p.timers.length,1);}
 }finally{bridges.forEach(b=>b.close());}
});

test('actual Microsoft importer remains compatible with shared contact helper; wire contains only its legacy click fields',async()=>{
 for(const phone of ['+12025550100','not-a-phone']){
  const wires=[],context=vm.createContext({Date,URLSearchParams,console:{log(){},error(){}}}),cache=new Map();
  const external={'crypto':{default:crypto},'wix-web-module':{Permissions:{Anyone:0,Admin:1},webMethod:(_,f)=>f},'wix-data':{default:{}},'backend/settings.web':{getAllSettings:async()=>({})},'wix-secrets-backend':{getSecret:async()=> 'INERT_ONLY'},'libphonenumber-js/max':{parsePhoneNumberFromString:(s,o)=>require('libphonenumber-js/max').parsePhoneNumberFromString(s,JSON.parse(JSON.stringify(o)))},'wix-fetch':{fetch:async(url,o)=>{
   if(url==='https://login.microsoftonline.com/common/oauth2/v2.0/token')return {ok:true,text:async()=>JSON.stringify({access_token:'INERT_TOKEN',expires_in:3600})};
   assert.equal(url,'https://bingads.microsoft.com/Api/Advertiser/CampaignManagement/v13/OfflineConversion/ApplyOfflineConversions');wires.push(JSON.parse(o.body));return {ok:true,text:async()=> '{}'};
  }}};
  const allowed=new Set(['backend/microsoftAdsConversions.web','backend/hashUtils.web','public/phoneNormalization']);
  function load(s){if(cache.has(s))return cache.get(s);const e=external[s];let m;if(e)m=new vm.SyntheticModule(Object.keys(e),function(){for(const k of Object.keys(e))this.setExport(k,e[k]);},{context});else{assert.ok(allowed.has(s),s);m=new vm.SourceTextModule(fs.readFileSync(path.join(root,s+'.js'),'utf8'),{context});}cache.set(s,m);return m;}
  const m=load('backend/microsoftAdsConversions.web');await m.link(load);await m.evaluate();
  assert.equal((await m.namespace.recordMicrosoftBookingConversion({transactionId:'INERT',msclkid:'INERT_MS',value:0,currency:'USD',conversionTime:'2027-01-01T00:00:00Z',email:'fixture@example.invalid',phone})).ok,true);
  assert.equal(wires.length,1);assert.deepEqual(wires[0],{CustomerAccountId:'INERT_ONLY',CustomerId:'INERT_ONLY',OfflineConversions:[{MSCLKID:'INERT_MS',ConversionName:'Booking Confirmed',ConversionValue:0,ConversionCurrencyCode:'USD',ConversionTime:'2027-01-01T00:00:00.000Z',ConversionGoalId:'INERT_ONLY'}]});
 }
});
