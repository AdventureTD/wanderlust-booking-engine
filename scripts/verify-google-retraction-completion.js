'use strict';
// Actual entrypoints/transport/summary refresh; inert SDK only.
// Run: node --experimental-vm-modules scripts/verify-google-retraction-completion.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../velo/backend');
const graph = {
  'availability.web.js': ['wix-data','wix-web-module','wix-fetch','wix-secrets-backend','backend/settings.web','backend/googleAdsConversions.web','backend/rateResolver','backend/pricingQuote'],
  'adminConsole.web.js': ['wix-data','wix-web-module','wix-secrets-backend','wix-fetch','wix-users-backend','backend/search.web','backend/availability.web','backend/googleAdsConversions.web'],
  'googleAdsConversions.web.js': ['wix-web-module','wix-secrets-backend','backend/dataManagerClient.web','backend/hashUtils.web','backend/settings.web','wix-data'],
  'dataManagerClient.web.js': ['wix-secrets-backend','wix-fetch','crypto']
};
const deny = () => { throw Error('Unexpected inert IO'); };
// Exact causal source reversions, applied in memory only; never repository writes.
const mutants = {
  'unsafe-response-logging': ['googleAdsConversions.web.js',"console.log('[WBE-GOOGLE] adjustment ingestEvent response received');","console.log('[WBE-GOOGLE] adjustment ingestEvent raw response:', JSON.stringify(response));"],
  'warnings-rejection': ['googleAdsConversions.web.js','if (fields.fieldWarnings && !validAdjustmentWarnings(fields.fieldWarnings.value)) return false;','if (fields.fieldWarnings) return false;'],
  'availability-skip': ['availability.web.js','adjResult = { ok: false, suspended: true };','adjResult = { ok: true, suspended: true };'],
  'admin-skip': ['adminConsole.web.js','result = { ok: false, suspended: true };','result = { ok: true, suspended: true };'],
  'unconditional-ack': ['googleAdsConversions.web.js','if (!isAcknowledgedAdjustment(response)) {','if (false) {'],
  'status-coupling': ['availability.web.js','summary.googleConversionRetracted = true;','summary.googleConversionRetracted = true; summary.status = "In Process";']
};
function source(file) {
  let text=fs.readFileSync(path.join(root,file),'utf8');
  const name=process.argv[2];
  if(name){assert.ok(Object.hasOwn(mutants,name));const [target,old,replacement]=mutants[name];if(file===target){assert.equal(text.split(old).length,2);text=text.replace(old,replacement);}}
  return text;
}
function database() {
  const rows = { Bookings: [], BookingSummary: [] }, writes = [];
  const clone = v => structuredClone(v);
  const sdk = {
    query(c) { assert.ok(Object.hasOwn(rows,c)); let filters = [], cap = Infinity;
      const q = { eq(k,v) { filters.push([k,v]); return q; }, limit(n) { cap=n; return q; }, async find() { return {items: clone(rows[c].filter(r => filters.every(([k,v])=>r[k]===v)).slice(0,cap))}; } }; return q;
    },
    async get(c,id) { assert.ok(Object.hasOwn(rows,c)); return clone(rows[c].find(r=>r._id===id)); },
    async update(c,row) { assert.ok(Object.hasOwn(rows,c)); const i=rows[c].findIndex(r=>r._id===row._id); assert.ok(i>=0); writes.push({c,row:clone(row)}); if (sdk.failAck && c==='BookingSummary' && row.googleConversionRetracted===true) throw Error('inert storage failure'); rows[c][i]=clone(row); return clone(row); },
    insert: deny
  }; return {rows,writes,sdk};
}
async function fixture(o={}) {
  const db=database(), trace={ingest:[],secrets:[],email:0,oauth:0,settings:0,logs:[]};
  const dates={checkIn:new Date('2026-01-02T12:00:00Z'),checkOut:new Date('2026-01-04T12:00:00Z'),bookingDate:new Date('2026-01-01T12:00:00Z')};
  db.rows.Bookings=[{_id:'room',bookingNumber:'fixture',status:'Confirmed',quantity:1,roomCode:'adventure_suite',...dates}];
  if(o.multi) db.rows.Bookings.unshift({...db.rows.Bookings[0],_id:'sibling'});
  db.rows.BookingSummary=[{_id:'summary',bookingNumber:'fixture',status:o.status||'Confirmed',googleConversionUploaded:o.uploaded===undefined?true:o.uploaded,...dates,gclid:'inert-click',guestEmail:'guest@example.invalid',notes:'retained'}];
  if(Object.hasOwn(o,'retracted')) db.rows.BookingSummary[0].googleConversionRetracted=o.retracted;
  if (Object.hasOwn(o,'bookingDate')) db.rows.BookingSummary[0].bookingDate=o.bookingDate;
  if (o.absentDate) delete db.rows.BookingSummary[0].bookingDate;
  if (o.missingIdentity) { db.rows.Bookings[0].bookingNumber=''; db.rows.BookingSummary[0].bookingNumber=''; }
  db.sdk.failAck=o.storageFail;
  const context=vm.createContext({console:{log(...args){if(String(args[0]).includes('cancelBooking adjustment result') || String(args[0]).includes('adjustment ingestEvent raw response'))trace.logs.push(args.join(' '));},error(){}},Buffer,URLSearchParams,Date});
  const inert={
    'wix-data':{default:db.sdk},
    'wix-web-module':{Permissions:{Admin:'Admin',Anyone:'Anyone'},webMethod(p,fn){return fn;}},
    'wix-users-backend':{currentUser:{loggedIn:true,async getRoles(){return [{title:'Admin'}];}}},
    'backend/settings.web':{async getAllSettings(){const n=trace.settings++; return {suspendGoogleAds:(o.suspension||[0])[Math.min(n,(o.suspension||[0]).length-1)]};},incrementSetting:deny,observeAdvertisingSuspension:deny},
    'backend/hashUtils.web':{buildUserIdentifiers(){return [];}},
    'backend/rateResolver':{normalizePriceModifier:deny,roundMoney:deny},
    'backend/pricingQuote':{verifyLockedPricingQuote:deny},
    'backend/search.web':{searchAvailability:deny},
    'wix-secrets-backend':{async getSecret(k){trace.secrets.push(k); if(o.secretFail && k.startsWith('GOOGLE_ADS')) throw Error('inert payload secret failure'); return 'inert-public-placeholder';}},
    'crypto':{default:{createSign(){return {update(){return this;},sign(){return Buffer.from('inert-signature');}};}}},
    'wix-fetch':{async fetch(url,opt){
      if(url.endsWith('/send-cancellation-email')){trace.email++;return {ok:true,status:200};}
      if(url==='https://oauth2.googleapis.com/token'){trace.oauth++;return {ok:!o.oauthFail,status:o.oauthFail?500:200,async text(){return 'inert OAuth failure';},async json(){return {access_token:'inert-token',expires_in:3600};}};}
      assert.equal(url,'https://datamanager.googleapis.com/v1/events:ingest');trace.ingest.push(JSON.parse(opt.body));
      if(o.fetchFail)throw Error('inert dispatch rejection');
      return {ok:!o.httpFail,status:o.httpFail?500:200,async text(){if(o.textFail)throw Error('inert text rejection');return Object.hasOwn(o,'body')?o.body:'{"requestId":"inert-request"}';}};
    }}
  };
  const cache=new Map();
  async function actual(file){
    assert.ok(Object.hasOwn(graph,file),'exact canonical module allowlist');
    if(cache.has(file))return cache.get(file);
    const mod=new vm.SourceTextModule(source(file)+(o.extraImport && file==='dataManagerClient.web.js'?o.extraImport:''),{context,identifier:file});cache.set(file,mod);
    assert.deepEqual(Array.from(mod.dependencySpecifiers),graph[file]);
    await mod.link(async spec=>{
      if(spec==='backend/dataManagerClient.web' && o.responseSeam){
        const value=vm.runInContext(o.responseSeam,context);
        return new vm.SyntheticModule(['ingestEvent'],function(){this.setExport('ingestEvent',async()=>value);},{context});
      }
      if(spec==='backend/googleAdsConversions.web' && o.rejectAdjustment){
        const values={isGoogleAdsSuspended:async()=>false,adjustBookingConversion:async()=>{throw Error('inert rejected webMethod');}};
        return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});
      }
      const file=spec.startsWith('backend/')?spec.slice(8)+'.js':null;
      if(file && Object.hasOwn(graph,file))return actual(file);
      assert.ok(Object.hasOwn(inert,spec),'unexpected import '+spec);
      const values=inert[spec];return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});
    });return mod;
  }
  if (o.loaderOnly) return {...db,trace,actual,cache};
  // Preload shared dependencies sequentially to avoid partially linked cycles.
  for(const file of ['dataManagerClient.web.js','googleAdsConversions.web.js','availability.web.js','adminConsole.web.js']){const m=await actual(file);await m.evaluate();}
  const call=async who=> who==='availability'?cache.get('availability.web.js').namespace.cancelBooking('room'):cache.get('adminConsole.web.js').namespace.adminCancelBooking('fixture','inert reason');
  return {...db,trace,call,actual,cache,adjust:cache.get('googleAdsConversions.web.js').namespace.adjustBookingConversion};
}
const cases=[];const test=(id,fn)=>cases.push({id,fn});
test('fixture/conjunction-limit-detached-native-update',async()=>{const d=database();d.rows.Bookings=[{_id:'a',a:1,b:2,date:new Date(0)},{_id:'b',a:1,b:3}];const q=await d.sdk.query('Bookings').eq('a',1).eq('b',2).limit(1).find();assert.equal(q.items.length,1);assert.ok(q.items[0].date instanceof Date);q.items[0].a=4;assert.equal(d.rows.Bookings[0].a,1);await d.sdk.update('Bookings',q.items[0]);assert.equal((await d.sdk.get('Bookings','a')).a,4);});
const outcomes = [
    ['outer-suspended',{suspension:[1]},false],['inner-suspended',{suspension:[0,1]},false],['ack',{},true],
    ['empty',{body:''},false],['null',{body:'null'},false],['array',{body:'[]'},false],['object',{body:'{}'},false],['synthetic-ok',{body:'{"ok":true}'},false],['false',{body:'{"ok":false}'},false],['errors',{body:'{"errors":["error"]}'},false],['id-errors',{body:'{"requestId":"id","errors":["error"]}'},false],['blank-id',{body:'{"requestId":" "}'},false],['unknown',{body:'{"requestId":"id","unsupportedMetadata":[]}'},false],
    ['payload-secret',{secretFail:true},false],['oauth',{oauthFail:true},false],['fetch-rejection',{fetchFail:true},false],['text-rejection',{textFail:true},false],['malformed-json',{body:'{'},false],['http-error',{httpFail:true},false],['rejected-webmethod',{rejectAdjustment:true},false]
  ];
for(const who of ['availability','admin']){
  for(const [label,options,ack]of outcomes)test(`${who}/${label}`,async()=>{
    const f=await fixture(options),result=await f.call(who),s=f.rows.BookingSummary[0];
    assert.equal(s.googleConversionRetracted===true,ack,'retraction completion requires ACK');
    assert.equal(s.status,'Cancelled','ads must not reset business cancellation');assert.equal(f.rows.Bookings[0].status,'Cancelled');assert.equal(s.googleConversionUploaded,true);
    assert.ok(s.bookingDate instanceof Date);assert.equal(s.gclid,'inert-click');assert.ok(!Object.hasOwn(s,'googleConversionRetractionDate'));
    const unsent=label.includes('suspended')||['payload-secret','oauth','rejected-webmethod'].includes(label);
    assert.equal(f.trace.ingest.length,unsent?0:1);
    if(label.includes('suspended'))assert.equal(f.trace.secrets.filter(k=>k.startsWith('GOOGLE')).length,0);
    if(who==='availability' && label==='outer-suspended')assert.ok(f.trace.logs.some(s=>s.endsWith('result: false true')),'outer skip reports noncompletion');
    if(who==='admin'){assert.equal(result.ok,true);assert.equal(result.adsRetraction.result.ok,ack);assert.match(s.notes,/Cancellation on/);assert.equal(f.trace.email,1);assert.equal(result.email.ok,true);}else assert.equal(result.status,'Cancelled');
    if(ack){const e=f.trace.ingest[0].events[0];assert.equal(e.transactionId,'fixture');assert.equal(e.eventName,'purchase_retraction');assert.equal(e.conversionValue,0);assert.equal(e.eventTimestamp,'2026-01-01T12:00:00.000Z');}
  });
}
const adjustment={transactionId:'fixture',adjustmentType:'RETRACTION',originalEvent:{conversionTime:'2026-01-01T12:00:00Z'}};
for(const [label,options,ack]of [['ack',{},true],['suspended',{suspension:[1]},false],['nonack',{body:'{}'},false]])test(`page/extracted-handler/${label}`,async()=>{
  const f=await fixture(options),result=await f.call('admin'),messages=[];
  const page=fs.readFileSync(path.resolve(root,'../page-admin-bookings.js'),'utf8');const start=page.indexOf('async function cancelBooking() {');assert.ok(start>0);
  const context=vm.createContext({_currentBooking:{bookingNumber:'fixture'},val:()=>'',txt:(id,msg)=>messages.push(msg),adminCancelBooking:async()=>result,openDetail:async()=>{},refreshList(){}});
  vm.runInContext(page.slice(start),context);await context.cancelBooking();assert.match(messages.at(-1),/^Cancelled\./);assert.equal(messages.at(-1).includes('conversion retracted.'),ack);assert.equal(messages.at(-1).includes('retraction FAILED:'),!ack);assert.match(messages.at(-1),/Cancellation email sent/);
});
for(const status of ['Confirmed','In Process'])for(const [label,options,ack]of [['ack',{},true],['nonack',{body:'{}'},false],['suspended',{suspension:[1]},false],['uncertain',{fetchFail:true},false]])test(`direct/${status}/${label}`,async()=>{
  const f=await fixture({...options,status}),before=structuredClone(f.rows);const result=await f.adjust(adjustment);assert.equal(result.ok,ack);assert.deepEqual(f.rows,before);assert.deepEqual(f.writes,[]);
});
for(const [label,args,options]of [['missing-id',{...adjustment,transactionId:''},{}],['invalid-date',{...adjustment,originalEvent:{conversionTime:'invalid'}},{}],['payload-secret',adjustment,{secretFail:true}],['oauth',adjustment,{oauthFail:true}]])test(`direct/known-unsent/${label}`,async()=>{const f=await fixture(options);assert.equal((await f.adjust(args)).ok,false);assert.equal(f.trace.ingest.length,0);assert.deepEqual(f.writes,[]);});
for(const [label,responseSeam]of [
  ['inherited-id','Object.create({requestId:"id"})'],['accessor-id','Object.defineProperty({},"requestId",{get(){return "id";},enumerable:true})'],['inherited-ok','Object.assign(Object.create({ok:true}),{requestId:"id"})'],['accessor-ok','Object.defineProperty({requestId:"id"},"ok",{get(){return true;}})'],['malformed-errors','({requestId:"id",errors:{length:0}})'],['subclass-errors','({requestId:"id",errors:new (class extends Array {})()})']
])test(`direct/response-seam/${label}`,async()=>{const f=await fixture({responseSeam});assert.equal((await f.adjust(adjustment)).ok,false);assert.deepEqual(f.writes,[]);});
for(const type of ['RETRACTION','RESTATEMENT'])test(`direct/positive/${type}`,async()=>{const f=await fixture({body:'{"requestId":"  exact-id  ","ok":true,"errors":[]}'});const result=await f.adjust({...adjustment,adjustmentType:type,newValue:7});assert.equal(result.ok,true);assert.equal(result.response.requestId,'  exact-id  ');assert.equal(f.trace.ingest.length,1);assert.equal(f.trace.ingest[0].events[0].conversionValue,type==='RETRACTION'?0:7);assert.deepEqual(f.writes,[]);});
for(const who of ['availability','admin']){
 for(const [label,options]of [['not-uploaded',{uploaded:false}],['already-retracted',{retracted:true}]])test(`${who}/gate/${label}`,async()=>{const f=await fixture(options);await f.call(who);assert.equal(f.trace.ingest.length,0);assert.equal(f.trace.settings,0);assert.equal(f.rows.BookingSummary[0].googleConversionRetracted===true,label==='already-retracted');});
 test(`${who}/storage-after-ack`,async()=>{const f=await fixture({storageFail:true});if(who==='admin')await assert.rejects(f.call(who),/storage failure/);else assert.equal((await f.call(who)).status,'Cancelled');assert.equal(f.trace.ingest.length,1);assert.notEqual(f.rows.BookingSummary[0].googleConversionRetracted,true);});
}
test('availability/multi-child-business-parity',async()=>{const ack=await fixture({multi:true}),skip=await fixture({multi:true,suspension:[1]});await ack.call('availability');await skip.call('availability');assert.equal(ack.rows.BookingSummary[0].status,'Confirmed');const a=structuredClone(ack.rows),b=structuredClone(skip.rows);delete a.BookingSummary[0].googleConversionRetracted;assert.deepEqual(a,b);});
test('admin/already-cancelled-replay',async()=>{const f=await fixture({status:'Cancelled'});const r=await f.call('admin');assert.equal(r.error,'Already cancelled');assert.equal(f.trace.ingest.length,0);assert.deepEqual(f.writes,[]);});
test('availability/retained-repeat-exposure-not-retry-authority',async()=>{const f=await fixture({body:'{}'});await f.call('availability');await f.call('availability');assert.equal(f.trace.ingest.length,2,'characterizes inherited resend exposure, NOT safe retry');assert.notEqual(f.rows.BookingSummary[0].googleConversionRetracted,true);});

// Public send-events success example; synthetic inert replay, not account evidence.
// https://developers.google.com/data-manager/api/devguides/events/send-events#success_responses
const publishedId='126365e1-16d0-4c81-9de9-f362711e250a';
const publishedWarning={field:'events.events[0].cart_data.items[0].merchant_product_id',description:'The merchant product ID is missing in the cart item.',reason:'WARNING_REASON_CART_DATA_ITEM_MERCHANT_PRODUCT_ID_MISSING'};
for(const [label,body] of [
 ['documented-minimal',{requestId:publishedId}],
 ['documented-warning',{requestId:publishedId,fieldWarnings:[publishedWarning]}],
 ['empty-warning-array',{requestId:publishedId,fieldWarnings:[]}]
]) for(const who of ['direct','availability','admin']) test(`warnings/published/${label}/${who}`,async()=>{
 const f=await fixture({body:JSON.stringify(body)}),before=structuredClone(f.rows);
 const r=who==='direct'?await f.adjust(adjustment):await f.call(who);
 const ack=who==='direct'?r.ok:f.rows.BookingSummary[0].googleConversionRetracted===true;
 assert.equal(ack,true,'documented successful request requires ACK (not processing proof)');
 assert.equal(f.trace.ingest.length,1);
 if(who==='direct'){assert.deepEqual(f.rows,before);assert.deepEqual(f.writes,[]);assert.equal(JSON.stringify(r.response),JSON.stringify(body));}
 else {assert.equal(f.rows.BookingSummary[0].status,'Cancelled');assert.equal(f.rows.Bookings[0].status,'Cancelled');
  if(who==='admin'){assert.equal(r.adsRetraction.result.ok,true);assert.equal(JSON.stringify(r.adsRetraction.result.response),JSON.stringify(body));assert.match(f.rows.BookingSummary[0].notes,/Cancellation on/);assert.equal(f.trace.email,1);}
  else {assert.ok(f.trace.logs.some(s=>s.endsWith('result: true false')),'validated ACK status retained without response disclosure');assert.ok(f.trace.logs.every(s=>!s.includes(publishedId)&&!s.includes(publishedWarning.description)),'no response payload in adjustment logs');}
 }
});

// Exact independent-review witness: serialization must not turn an accessor into ACK data.
for(const who of ['direct','availability','admin']) test(`logging/self-replacing-fieldWarnings/${who}`,async()=>{
 const responseSeam='(()=>{globalThis.warningGetterReads=0;const r={requestId:"id"};Object.defineProperty(r,"fieldWarnings",{enumerable:true,configurable:true,get(){globalThis.warningGetterReads++;Object.defineProperty(r,"fieldWarnings",{enumerable:true,configurable:true,value:[]});return [];}});return r;})()';
 const f=await fixture({responseSeam}),before=structuredClone(f.rows);
 const result=who==='direct'?await f.adjust(adjustment):await f.call(who);
 // Exercise the escaped web-method result too, not just the first backend log.
 JSON.stringify(result);
 const reads=vm.runInContext('warningGetterReads',f.cache.get('googleAdsConversions.web.js').context);
 const ack=who==='direct'?result.ok:f.rows.BookingSummary[0].googleConversionRetracted===true;
 assert.deepEqual({reads,ack},{reads:0,ack:false},'unvalidated response logging must read zero getters and never ACK');
 assert.equal(f.trace.ingest.length,0,'explicit descriptor seam, no provider dispatch');
 if(who==='direct'){assert.deepEqual(f.rows,before);assert.deepEqual(f.writes,[]);assert.equal(Object.hasOwn(result,'response'),false);}
 else {assert.equal(f.rows.BookingSummary[0].status,'Cancelled');assert.equal(f.rows.Bookings[0].status,'Cancelled');assert.equal(f.writes.length,2);if(who==='admin'){assert.equal(result.adsRetraction.result.ok,false);assert.equal(Object.hasOwn(result.adsRetraction.result,'response'),false);assert.equal(f.trace.email,1);}}
});

// Finite schema-boundary seams; unlike published fixtures these bypass JSON transport.
// FieldWarning members are optional; requestId remains required. No new business fields.
const warningCases=[
 ['omitted-members','({requestId:"id",fieldWarnings:[{}]})',true],
 ['empty-strings','({requestId:"id",fieldWarnings:[{field:"",description:""}]})',true],
 ['generic-reason','({requestId:"id",fieldWarnings:[{reason:"WARNING_REASON_GENERIC"}]})',true],
 ['null-list','({requestId:"id",fieldWarnings:null})',false],
 ['object-list','({requestId:"id",fieldWarnings:{length:0}})',false],
 ['string-list','({requestId:"id",fieldWarnings:""})',false],
 ['inherited-list','Object.assign(Object.create({fieldWarnings:[]}),{requestId:"id"})',false],
 ['accessor-list','Object.defineProperty({requestId:"id"},"fieldWarnings",{get(){return [];}})',false],
 ['sparse-list','({requestId:"id",fieldWarnings:new Array(1)})',false],
 ['decorated-list','({requestId:"id",fieldWarnings:Object.assign([],{extra:true})})',false],
 ['symbol-list','({requestId:"id",fieldWarnings:Object.assign([],{[Symbol("extra")]:true})})',false],
 ['subclass-list','({requestId:"id",fieldWarnings:new (class extends Array {})()})',false],
 ['null-prototype-list','({requestId:"id",fieldWarnings:Object.setPrototypeOf([],null)})',false],
 ['accessor-item','({requestId:"id",fieldWarnings:Object.defineProperty([],"0",{get(){return {};}})})',false],
 ['null-item','({requestId:"id",fieldWarnings:[null]})',false],
 ['array-item','({requestId:"id",fieldWarnings:[[]]})',false],
 ['string-item','({requestId:"id",fieldWarnings:["warning"]})',false],
 ['inherited-member','({requestId:"id",fieldWarnings:[Object.create({field:"path"})]})',false],
 ['null-prototype-item','({requestId:"id",fieldWarnings:[Object.create(null)]})',false],
 ['accessor-member','({requestId:"id",fieldWarnings:[Object.defineProperty({},"field",{get(){return "path";}})]})',false],
 ['unknown-member','({requestId:"id",fieldWarnings:[{error:"failure"}]})',false],
 ['symbol-member','({requestId:"id",fieldWarnings:[{[Symbol("extra")]:true}]})',false],
 ['number-field','({requestId:"id",fieldWarnings:[{field:1}]})',false],
 ['boxed-description','({requestId:"id",fieldWarnings:[{description:new String("warning")}]})',false],
 ['null-description','({requestId:"id",fieldWarnings:[{description:null}]})',false],
 ['unknown-reason','({requestId:"id",fieldWarnings:[{reason:"WARNING_REASON_UNKNOWN"}]})',false],
 ['number-reason','({requestId:"id",fieldWarnings:[{reason:0}]})',false],
 ['missing-id','({fieldWarnings:[]})',false],
 ['blank-id','({requestId:" ",fieldWarnings:[]})',false],
 ['inherited-id','Object.assign(Object.create({requestId:"id"}),{fieldWarnings:[]})',false],
 ['accessor-id','Object.defineProperty({fieldWarnings:[]},"requestId",{get(){return "id";}})',false],
 ['errors-plus-warning','({requestId:"id",fieldWarnings:[],errors:["failure"]})',false],
 ['false-plus-warning','({requestId:"id",fieldWarnings:[],ok:false})',false],
 ['unknown-plus-warning','({requestId:"id",fieldWarnings:[],partialFailureError:{}})',false]
];
for(const who of ['direct','availability','admin']) for(const [label,responseSeam,ack] of warningCases) test(`warnings/schema/${who}/${label}`,async()=>{
 const f=await fixture({responseSeam}),before=structuredClone(f.rows);
 const r=who==='direct'?await f.adjust(adjustment):await f.call(who);
 assert.equal(f.trace.ingest.length,0,'descriptor seam, not actual transport');
 if(who==='direct'){assert.equal(r.ok,ack,'warning schema classification');assert.deepEqual(f.rows,before);assert.deepEqual(f.writes,[]);}
 else {const s=f.rows.BookingSummary[0];assert.equal(s.googleConversionRetracted===true,ack,'warning schema cannot manufacture completion');assert.equal(s.status,'Cancelled');assert.equal(f.rows.Bookings[0].status,'Cancelled');assert.equal(f.writes.length,2+(who==='availability'&&ack?1:0));if(who==='admin'){assert.equal(r.adsRetraction.result.ok,ack);assert.equal(f.trace.email,1);assert.match(s.notes,/Cancellation on/);}}
});

// Frozen coverage ledger C1-C5. These are baseline-GREEN regressions, not runtime edits.
const flagCases=[['absent',{}],['false',{retracted:false}],['null',{retracted:null}],['zero',{retracted:0}],['empty',{retracted:''}],['true',{retracted:true}],['truthy',{retracted:'retained'}]];
for(const who of ['availability','admin']) for(const [outcome,options,ack] of outcomes) for(const [flag,flags] of flagCases) test(`coverage/C1/${who}/${outcome}/${flag}`,async()=>{
  const f=await fixture({...options,...flags}),before=structuredClone(f.rows.BookingSummary[0]);
  const result=await f.call(who),s=f.rows.BookingSummary[0];
  const eligible=who==='availability'?flags.retracted!==true:!flags.retracted;
  const promoted=eligible&&ack;
  // Availability refresh deliberately omits falsey retained flags; compare its own write snapshot.
  const business=who==='availability'?f.writes.find(w=>w.c==='BookingSummary').row:before;
  assert.equal(Object.hasOwn(s,'googleConversionRetracted'),promoted||Object.hasOwn(business,'googleConversionRetracted'));
  assert.equal(s.googleConversionRetracted,promoted?true:business.googleConversionRetracted);
  assert.equal(f.writes.length,2+(who==='availability'&&promoted?1:0),'no failure-only advertising write');
  assert.equal(s.status,'Cancelled');assert.equal(f.rows.Bookings[0].status,'Cancelled');
  for(const key of ['bookingNumber','gclid','checkIn','checkOut','bookingDate','googleConversionUploaded']) assert.deepEqual(s[key],business[key]);
  assert.ok(!Object.hasOwn(s,'googleConversionRetractionDate'));
  const unsent=outcome.includes('suspended')||['payload-secret','oauth','rejected-webmethod'].includes(outcome);
  assert.equal(f.trace.ingest.length,eligible&&!unsent?1:0);
  if(!eligible){assert.equal(f.trace.settings,0);assert.equal(f.trace.secrets.filter(k=>k.startsWith('GOOGLE')).length,0);}
  if(who==='admin'){assert.equal(result.ok,true);assert.equal(result.adsRetraction.attempted,eligible);assert.match(s.notes,/^retained\nCancellation on \d{4}-\d{2}-\d{2}: inert reason$/);assert.equal(f.trace.email,1);assert.equal(result.email.ok,true);}
  else assert.equal(result.status,'Cancelled');
});
for(const who of ['availability','admin']) for(const [label,opts] of [['invalid-string',{bookingDate:'invalid'}],['invalid-Date',{bookingDate:new Date(NaN)}],['absent',{absentDate:true}]]) test(`coverage/C2/${who}/${label}`,async()=>{
  const f=await fixture(opts),result=await f.call(who),s=f.rows.BookingSummary[0];
  const repaired=(who==='availability'&&label!=='invalid-Date')||label==='absent';
  assert.equal(s.googleConversionRetracted===true,repaired);assert.equal(f.trace.ingest.length,repaired?1:0);
  assert.equal(s.status,'Cancelled');assert.equal(f.rows.Bookings[0].status,'Cancelled');
  assert.equal(f.writes.length,2+(who==='availability'&&repaired?1:0));
  if(who==='admin'){assert.equal(result.adsRetraction.result.ok,repaired);assert.equal(f.trace.email,1);assert.match(s.notes,/Cancellation on/);if(!repaired)assert.match(result.adsRetraction.result.error,/Invalid conversion timestamp/);}
  if(repaired)assert.ok(Number.isFinite(Date.parse(f.trace.ingest[0].events[0].eventTimestamp)));
});
for(const who of ['availability','admin']) test(`coverage/C2/${who}/missing-identity`,async()=>{
  const f=await fixture({missingIdentity:true});
  if(who==='admin')assert.equal((await f.call(who)).error,'BookingSummary not found');else assert.equal((await f.call(who)).status,'Cancelled');
  assert.equal(f.trace.ingest.length,0);assert.equal(f.trace.oauth,0);assert.notEqual(f.rows.BookingSummary[0].googleConversionRetracted,true);
});
for(const who of ['availability','admin']) for(const [label,options,eligible] of [['truthy-upload',{uploaded:'yes'},who==='admin'],['truthy-retracted',{retracted:'yes'},who==='availability']]) test(`coverage/C3/${who}/${label}`,async()=>{
  const f=await fixture(options);await f.call(who);assert.equal(f.trace.ingest.length,eligible?1:0);assert.equal(f.rows.BookingSummary[0].googleConversionUploaded,options.uploaded||true);assert.equal(f.rows.BookingSummary[0].googleConversionRetracted,eligible?true:options.retracted);assert.equal(f.writes.length,2+(who==='availability'&&eligible?1:0));
});
const descriptorCases=[
 ['inherited-id','Object.create({requestId:"id"})',false],
 ['accessor-id','Object.defineProperty({},"requestId",{get(){return "id";},enumerable:true})',false],
 ['inherited-ok','Object.assign(Object.create({ok:true}),{requestId:"id"})',false],
 ['accessor-ok','Object.defineProperty({requestId:"id"},"ok",{get(){return true;}})',false],
 ['malformed-errors','({requestId:"id",errors:{length:0}})',false],
 ['subclass-errors','({requestId:"id",errors:new (class extends Array {})()})',false],

 ['inherited-errors','Object.assign(Object.create({errors:[]}),{requestId:"id"})',false],
 ['accessor-errors','Object.defineProperty({requestId:"id"},"errors",{get(){return [];}})',false],
 ['numeric-ok','({requestId:"id",ok:1})',false],
 ['string-ok','({requestId:"id",ok:"true"})',false],
 ['null-ok','({requestId:"id",ok:null})',false],
 ['number-id','({requestId:1})',false],
 ['boxed-id','({requestId:new String("id")})',false],
 ['null-id','({requestId:null})',false],
 ['decorated-errors','({requestId:"id",errors:Object.assign([],{extra:true})})',false],
 ['sparse-errors','({requestId:"id",errors:new Array(1)})',false],
 ['null-prototype-errors','({requestId:"id",errors:Object.setPrototypeOf([],null)})',false],
 ['unknown-symbol','({requestId:"id",[Symbol("extra")]:true})',false],
 ['unknown-accessor','Object.defineProperty({requestId:"id"},"extra",{get(){return true;}})',false],
 ['nonenumerable-own','Object.defineProperty({},"requestId",{value:"  exact-id  "})',true],
 ['empty-errors','({requestId:"  exact-id  ",errors:[]})',true]
];
for(const who of ['direct','availability','admin']) for(const [label,responseSeam,ack] of descriptorCases) test(`coverage/C4/${who}/${label}`,async()=>{
  const f=await fixture({responseSeam}),before=structuredClone(f.rows);
  const result=who==='direct'?await f.adjust(adjustment):await f.call(who);
  assert.equal(f.trace.ingest.length,0,'explicit response seam, not transport evidence');
  if(who==='direct'){assert.equal(result.ok,ack);assert.deepEqual(f.rows,before);assert.deepEqual(f.writes,[]);if(ack)assert.equal(result.response.requestId,'  exact-id  ');}
  else {const s=f.rows.BookingSummary[0];assert.equal(s.googleConversionRetracted===true,ack);assert.equal(f.writes.length,2+(who==='availability'&&ack?1:0));assert.equal(s.status,'Cancelled');if(who==='admin'){assert.equal(result.adsRetraction.result.ok,ack);assert.equal(f.trace.email,1);assert.match(s.notes,/Cancellation on/);}}
});
for(const file of ['../availability.web.js','/availability.web.js','availability.web.js.js','backend/availability.web.js','guestBookingAcceptance.js']) test(`coverage/C5/path/${file}`,async()=>{
 const f=await fixture({loaderOnly:true});const n=f.cache.size;assert.equal(n,0);await assert.rejects(f.actual(file),/exact canonical module allowlist/);assert.equal(f.cache.size,n);assert.deepEqual(f.writes,[]);assert.equal(f.trace.ingest.length,0);
});
for(const spec of ['../guestBookingAcceptance.js','backend/unknown','node:fs','https://example.invalid/code.js']) test(`coverage/C5/import/${spec}`,async()=>{await assert.rejects(fixture({extraImport:`\nimport ${JSON.stringify(spec)};`}),/Expected values to be strictly deep-equal/);});
test('coverage/C5/canonical-cache',async()=>{const f=await fixture();for(const file of Object.keys(graph))assert.equal(await f.actual(file),f.cache.get(file));assert.equal(f.cache.size,4);assert.deepEqual(f.writes,[]);});

(async()=>{assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);let failed=0;for(const c of cases){try{await c.fn();console.log('PASS '+c.id);}catch(e){failed++;console.error('FAIL '+c.id+' '+e.stack);}}console.log(JSON.stringify({total:cases.length,failed,ids:cases.map(c=>c.id)}));process.exitCode=failed?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
