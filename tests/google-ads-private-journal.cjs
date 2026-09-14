'use strict';
// Actual source, inert native SDK/transport. Fixed entropy is TEST ONLY.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,'velo',f),'utf8');
function evalSource(file,globals,names){const c=vm.createContext({Date,Buffer,console:{log(){},error(){},warn(){}},Permissions:{Anyone:'Anyone',Admin:'Admin'},webMethod:(_,f)=>f,fetch(){throw Error('NETWORK DENIED');},...globals});vm.runInContext(read(file).replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+'\nObject.assign(this,{'+names.join(',')+'});',c);return c;}
function fixture(opts={}){
 const rows=new Map(),trace=[],settings={googleAdsPrivateJournalEnabled:'1',suspendGoogleAds:'0',...opts.settings};let sends=0,entropy=0;
 const key=(c,id)=>c+':'+id,copy=r=>r&&structuredClone(r);
 const sdk={async insert(c,r,o){trace.push(['insert',c,r.kind]);if(opts.failInsert===r.kind)throw Error('inert failure');const k=key(c,r._id);if(rows.has(k))throw Error('duplicate');rows.set(k,copy(r));if(opts.loseInsert===r.kind)throw Error('lost ACK');return copy(r);},async get(c,id,o){trace.push(['get',c]);const r=rows.get(key(c,id));if(opts.failGet && opts.failGet===r?.kind)throw Error('inert read failure');return copy(r);},async update(c,r,o){trace.push(['update',c]);if(opts.failFlag)throw Error('inert update failure');rows.set(key(c,r._id),copy(r));return copy(r);},query(c){let field,value;return {eq(f,v){field=f;value=v;return this;},limit(){return this;},async find(){return {items:[...rows.entries()].filter(([k,r])=>k.startsWith(c+':')&&r[field]===value).map(([,r])=>copy(r))};}};}};
 const globals={wixData:sdk,getAllSettings:async()=>{if(opts.onSettings)opts.onSettings();if(opts.failSettings)throw Error('settings');return settings;},crypto:{...crypto,randomBytes:n=>Buffer.alloc(n,++entropy)},getSecret:async n=>n==='GOOGLE_ADS_CUSTOMER_ID'?'1234567890':'123456',buildUserIdentifiers:()=>[{emailAddress:'0'.repeat(64)}],ingestEvent:async()=>{sends++;if(opts.provider)return opts.provider();return {requestId:'INERT-ACK',fieldWarnings:[{private:'never retain'}]};}};
 if(opts.transport){const client=evalSource('backend/dataManagerClient.web.js',{...globals,fetch:async(...args)=>{sends++;return opts.transport(...args);}},['ingestEvent']);client.getAccessToken=async()=> 'INERT-OAUTH';globals.ingestEvent=client.ingestEvent;}
 const helper=path.join(root,'velo/backend/googleAdsAttemptJournal.js');if(fs.existsSync(helper))Object.assign(globals,evalSource('backend/googleAdsAttemptJournal.js',globals,['mintGoogleAdsCapability','recordPrivateGoogleAdsAttempt']));
 const sender=evalSource('backend/googleAdsConversions.web.js',globals,['recordBookingConversion','retryBookingConversion']);
 function booking(extra={}){return {transactionId:'WC-INERT',value:123.45,currency:'USD',email:'inert@example.invalid',...extra};}
 async function mint(){const summary={_id:'summary-inert',bookingNumber:'WC-INERT',checkIn:new Date('2027-01-01T12:00:00Z'),checkOut:new Date('2027-01-02T12:00:00Z'),bookingDate:new Date('2026-09-14T12:00:00Z')};rows.set(key('BookingSummary',summary._id),copy(summary));return globals.mintGoogleAdsCapability({bookingNumber:'WC-INERT',_id:'room-inert'},summary);}
 return {rows,trace,settings,globals,sender,booking,mint,sdk,get sends(){return sends;}};
}
test('forged or missing authority causes zero journal writes and provider calls',async()=>{const f=fixture();for(const capability of [undefined,'forged','gac1.'+'a'.repeat(64)]){const r=await f.sender.recordBookingConversion(f.booking({conversionCapability:capability}));assert.equal(r.ok,false);}assert.equal(f.sends,0);assert.equal(f.trace.filter(x=>x[0]==='insert').length,0);});
function producer(f,opts={}) {
 const c=vm.createContext({...f.globals,getAllSettings:async()=>f.settings,Date,console:{log(){},error(){}},toDate:x=>x?new Date(x):null,getRoomDisplayName:x=>x,ROOM_UNITS:{A:3},ROOM_MIN_OCCUPANCY:{A:1},ROOM_MAX_OCCUPANCY:{A:2},nightsBetween:()=>1,overlappingCount:async()=>0,getNextBookingNumber:async()=>{if(opts.fallback)throw Error('number');return 'WC-INERT';},BOOKINGS:'Bookings',wouldExceedBookingRoomLimit:()=>false,getPackagePricingForBooking:async()=>({_id:'P'}),verifyLockedPricingQuote:async()=>({packageId:'P',baseRate:100,totalPerPerson:100}),normalizePriceModifier:()=>1,getAuthoritativeRoomFee:async()=>0,roundMoney:x=>x,
 createDraftInvoice:async()=>{if(opts.draftFailure)throw Error('draft');return {_id:'invoice-inert'};},
 updateBookingSummary:async()=>{if(opts.summaryFailure)throw Error('summary');const row={_id:'summary-inert',bookingNumber:'WC-INERT',bookingDate:new Date(),checkIn:new Date('2027-01-01T12:00:00Z')};f.rows.set('BookingSummary:summary-inert',structuredClone(row));return {item:row,created:!opts.existingSummary};},
 wixData:{...f.sdk,query:()=>({eq(){return this;},limit(){return this;},find:async()=>({items:opts.prior?[{_id:'old'}]:[]})}),insert:async(_,row)=>{if(opts.roomFailure)throw Error('room');return {...row,_id:'room-inert'};}}});
 const source=read('backend/availability.web.js'),a=source.indexOf('async function createBookingImpl('),b=source.indexOf('\nexport const createBooking =',a);vm.runInContext(source.slice(a,b),c);
 return extra=>c.createBookingImpl({roomCode:'A',checkIn:'2027-01-01',checkOut:'2027-01-02',...extra});
}
test('newly allocated successful first-room response alone carries private capability',async()=>{
 const f=fixture(),save=producer(f),result=await save();assert.match(result.conversionCapability||'',/^gac1\.[a-f0-9]{64}$/);
 assert.equal([...f.rows.values()].filter(r=>r.kind==='AUTH').length,1);
 const r=await f.sender.recordBookingConversion(f.booking({conversionCapability:result.conversionCapability}));assert.equal(r.ok,true);assert.equal(f.sends,1);
 for(const opts of [{draftFailure:true},{summaryFailure:true},{roomFailure:true},{fallback:true},{prior:true},{existingSummary:true},{}]){
  const g=fixture(),result=await producer(g,opts)(Object.keys(opts).length?{}:{bookingNumber:'WC-INERT'});
  assert.equal(result.conversionCapability,undefined);assert.equal([...g.rows.values()].filter(r=>r.kind==='AUTH').length,0);
 }
});
test('actual Summary passes first response capability only to Google without changing GA4 or redirect',async()=>{
 const support=fs.readFileSync(path.join(root,'tests/attribution-hotfix.cjs'),'utf8');
 const c=vm.createContext({require,__dirname:path.join(root,'tests'),process,console});
 vm.runInContext(support.slice(0,support.indexOf('const watchdog='))+'\nthis.makePage=page;',c);
 const token='gac1.'+'b'.repeat(64),logs=[];
 const p=await c.makePage({book:async(_,n)=>({bookingNumber:'WC-INERT',...(n===1?{conversionCapability:token}:{})})});
 p.c.console={log:(...v)=>logs.push(v),error:(...v)=>logs.push(v),warn(){}};
 await p.click();assert.equal(p.ads[0].conversionCapability,token);assert.equal(p.purchases[0].value,587.5);
 assert.ok(p.payloads.every(x=>!x.conversionCapability));assert.ok(!JSON.stringify(logs).includes(token));
 assert.equal(p.invoices.length,1);assert.ok(p.timers.length>0);
 assert.match(read('page-booking-summary.js'),/2000/);assert.doesNotMatch(read('page-booking-summary.js'),/summary\.googleConversionUploaded\s*=/);
});
test('valid concurrent callers produce one native attempt and one provider entry',async()=>{
 const f=fixture(),token=await f.mint(),b=f.booking({conversionCapability:token});
 const results=await Promise.all([f.sender.recordBookingConversion(b),f.sender.recordBookingConversion(b)]);
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(f.sends,1);
 const auth=[...f.rows.values()].find(r=>r.kind==='AUTH'),result=[...f.rows.values()].find(r=>r.kind==='RESULT');
 assert.equal(result.requestId,'INERT-ACK');assert.equal(result.warningPresent,true);assert.equal(result.commercialAuthority,'UNVERIFIED');
 assert.equal(JSON.stringify([...f.rows.values()]).includes(token),false);assert.equal(JSON.stringify([...f.rows.values()]).includes('never retain'),false);
 assert.equal(f.rows.get('BookingSummary:summary-inert').googleConversionUploaded,true);
 assert.equal(f.rows.get('BookingSummary:summary-inert').checkIn.toISOString(),'2027-01-01T12:00:00.000Z');assert.equal(auth.summaryId,'summary-inert');
});
for(const mode of ['wrongBooking','wrongToken','purpose','version','expiry','summaryId','destination'])test('authority denial without attempt writes: '+mode,async()=>{
 const f=fixture(),token=await f.mint(),b=f.booking({conversionCapability:token});const auth=[...f.rows.values()].find(r=>r.kind==='AUTH');
 if(mode==='wrongBooking')b.transactionId='WC-1030';if(mode==='wrongToken')b.conversionCapability='gac1.'+'f'.repeat(64);
 if(mode==='purpose')auth.purpose='invoice';if(mode==='version')auth.schemaVersion=2;if(mode==='expiry')auth.expiresAt=new Date(0);
 if(mode==='summaryId')auth.summaryId='';if(mode==='destination')auth.destinationAction='999';
 const before=f.trace.filter(x=>x[0]==='insert').length,r=await f.sender.recordBookingConversion(b);assert.equal(r.ok,false);assert.equal(f.sends,0);assert.equal(f.trace.filter(x=>x[0]==='insert').length,before);
});
for(const opts of [{settings:{googleAdsPrivateJournalEnabled:undefined}},{settings:{suspendGoogleAds:'1'}},{settings:{suspendGoogleAds:undefined}},{failSettings:true},{failInsert:'AUTH'},{loseInsert:'AUTH'},{failGet:'AUTH'}])test('issuance safely declines unavailable/suppressed configuration '+JSON.stringify(opts),async()=>{
 const f=fixture(opts),r=await producer(f)();assert.equal(r.outcome,undefined);assert.equal(r.conversionCapability,undefined);assert.equal(f.sends,0);
 if(opts.settings||opts.failSettings)assert.equal(f.trace.filter(x=>x[0]==='insert').length,0);
});
for(const opts of [{failInsert:'ATTEMPT'},{loseInsert:'ATTEMPT'},{failGet:'ATTEMPT'}])test('claim insert/readback uncertainty never enters provider '+JSON.stringify(opts),async()=>{
 const f=fixture(opts),token=await f.mint(),b=f.booking({conversionCapability:token});await f.sender.recordBookingConversion(b);await f.sender.recordBookingConversion(b);assert.equal(f.sends,0);
});
for(const opts of [{failInsert:'RESULT'},{loseInsert:'RESULT'},{failGet:'RESULT'},{failFlag:true},{}])test('lost browser response/receipt or legacy flag failure never resends '+JSON.stringify(opts),async()=>{
 const f=fixture(opts),token=await f.mint(),b=f.booking({conversionCapability:token});
 // Discard the first RPC value: persistence occurs inside the actual backend call.
 await f.sender.recordBookingConversion(b);await f.sender.recordBookingConversion(b);await f.sender.retryBookingConversion('WC-INERT');assert.equal(f.sends,1);
 assert.equal([...f.rows.values()].filter(r=>r.kind==='ATTEMPT').length,1);
 if(!opts.failInsert)assert.equal([...f.rows.values()].find(r=>r.kind==='RESULT').outcome,'INGESTION_ACKNOWLEDGED');
});
for(const [text,outcome] of [['','UNKNOWN'],['[]','UNKNOWN'],['{}','UNKNOWN'],[JSON.stringify({requestId:'INERT-REAL-CLIENT-ACK',fieldWarnings:[{}]}),'INGESTION_ACKNOWLEDGED'],[JSON.stringify({requestId:'x'.repeat(513)}),'UNKNOWN'],[JSON.stringify({error:{message:'PRIVATE PROVIDER BODY'}}),'EXPLICIT_REJECTION']])test('actual Data Manager client bounded persisted transport outcome '+text.slice(0,40),async()=>{
 const f=fixture({transport:async()=>({ok:true,status:200,text:async()=>text})}),token=await f.mint();await f.sender.recordBookingConversion(f.booking({conversionCapability:token}));
 const result=[...f.rows.values()].find(r=>r.kind==='RESULT');assert.equal(result.outcome,outcome);assert.equal(f.sends,1);assert.equal(JSON.stringify(result).includes('PRIVATE PROVIDER BODY'),false);
 await f.sender.recordBookingConversion(f.booking({conversionCapability:token}));assert.equal(f.sends,1);
});
test('provider applied then throws leaves a durable UNKNOWN and no replay',async()=>{
 const f=fixture({provider:async()=>{throw Object.assign(Error('SECRET BODY'),{code:'TRANSPORT_ERROR',outcome:'unknown'});}}),token=await f.mint();
 const r=await f.sender.recordBookingConversion(f.booking({conversionCapability:token}));assert.equal(r.outcome,'UNKNOWN');assert.equal([...f.rows.values()].find(x=>x.kind==='RESULT').outcome,'UNKNOWN');await f.sender.recordBookingConversion(f.booking({conversionCapability:token}));assert.equal(f.sends,1);assert.equal(JSON.stringify([...f.rows.values()]).includes('SECRET BODY'),false);
});
test('private AUTH cannot be overwritten by public Summary updater',async()=>{
 const f=fixture(),token=await f.mint(),before=JSON.stringify([...f.rows.values()].filter(r=>r.kind==='AUTH'));
 const c=evalSource('backend/availability.web.js',{...f.globals,wixData:{...f.sdk,query(collection){return {eq(){return this;},limit(){return this;},async find(){return {items:collection==='Bookings'?[{quantity:1,status:'confirmed'}]:[f.rows.get('BookingSummary:summary-inert')]};}};}}},['updateBookingSummary']);
 await c.updateBookingSummary('WC-INERT',new Date('2027-01-01T12:00:00Z'),new Date('2027-01-02T12:00:00Z'),{guestEmail:'attacker@example.invalid'},{});
 assert.equal(f.rows.get('BookingSummary:summary-inert').guestEmail,'attacker@example.invalid');assert.equal(JSON.stringify([...f.rows.values()].filter(r=>r.kind==='AUTH')),before);
 const denied=await f.sender.recordBookingConversion(f.booking({conversionCapability:'gac1.'+'f'.repeat(64)}));assert.equal(denied.ok,false);assert.equal(f.sends,0);
});
test('a reconstructed backend invocation cannot regain the retained native attempt',async()=>{
 const f=fixture(),token=await f.mint(),b=f.booking({conversionCapability:token});await f.sender.recordBookingConversion(b);
 const helper=evalSource('backend/googleAdsAttemptJournal.js',f.globals,['mintGoogleAdsCapability','recordPrivateGoogleAdsAttempt']);
 const sender=evalSource('backend/googleAdsConversions.web.js',{...f.globals,...helper},['recordBookingConversion']);
 assert.notEqual(sender.recordBookingConversion,f.sender.recordBookingConversion);assert.equal((await sender.recordBookingConversion(b)).ok,false);assert.equal(f.sends,1);
});
test('a bound Summary ID reassigned to another booking cannot receive the legacy flag',async()=>{
 const f=fixture(),token=await f.mint();f.rows.get('BookingSummary:summary-inert').bookingNumber='OTHER';
 const r=await f.sender.recordBookingConversion(f.booking({conversionCapability:token}));assert.equal(r.ok,true);assert.equal(r.legacyFlagUpdated,false);assert.equal(f.rows.get('BookingSummary:summary-inert').googleConversionUploaded,undefined);
});
test('booking ingress never logs a raw object that could contain a capability',()=>{
 assert.doesNotMatch(read('backend/availability.web.js'),/JSON\.stringify\(booking\)/);
});
test('expiry is rechecked after the final awaited configuration read',async()=>{
 const original=Date.now;let reads=0;
 try {
  const f=fixture({onSettings(){if(++reads===3)Date.now=()=>original()+31*60*1000;}}),token=await f.mint();
  const r=await f.sender.recordBookingConversion(f.booking({conversionCapability:token}));assert.equal(r.ok,false);assert.equal(f.sends,0);assert.equal([...f.rows.values()].filter(x=>x.kind==='ATTEMPT').length,0);
 } finally {Date.now=original;}
});
module.exports={fixture,evalSource,read,producer};
