'use strict';
// Actual ESM-linked hashing -> builder -> journal -> client JSON.stringify.
// Promise facade is a compatibility control, NOT a Wix runtime observation.
// All SDK/OAuth/provider boundaries are inert; no live credentials or sockets.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../velo/backend');
const plain = x => JSON.parse(JSON.stringify(x));
async function fixture(mode) {
  const rows = new Map(), wires = [], fetches = [];
  let entropy = 0;
  const key = (c, id) => c + ':' + id;
  const sdk = {
    async insert(c, row) {
      assert.equal(c, 'GoogleAdsAttemptJournal');
      assert.ok(!rows.has(key(c, row._id)), 'duplicate native ID');
      rows.set(key(c, row._id), structuredClone(row));
      return structuredClone(row);
    },
    async get(c, id) { return structuredClone(rows.get(key(c, id))); },
    async update() { throw Error('fixed HTTP400 must not update Summary'); }
  };
  const deny = () => { throw Error('NETWORK_DENIED'); };
  const context = vm.createContext({Date, Buffer, URLSearchParams, console:{log(){},warn(){},error(){}}, fetch:deny, XMLHttpRequest:deny, WebSocket:deny});
  const external = {
    'libphonenumber-js/max':{parsePhoneNumberFromString:(s,o)=>require('libphonenumber-js/max').parsePhoneNumberFromString(s,JSON.parse(JSON.stringify(o)))},
    'crypto':{default:{...crypto, randomBytes:n=>Buffer.alloc(n, ++entropy), createSign:()=>({update(){return this;},sign:()=>Buffer.from('INERT_SIGNATURE')})}},
    'wix-data':{default:sdk},
    'wix-web-module':{Permissions:{Anyone:'Anyone',Admin:'Admin'},webMethod:(_,fn)=>async(...args)=>fn(...args)},
    'backend/settings.web':{getAllSettings:async()=>({googleAdsPrivateJournalEnabled:'1',suspendGoogleAds:'0'})},
    'wix-secrets-backend':{getSecret:async n=>({GOOGLE_ADS_CUSTOMER_ID:'1234567890',GOOGLE_ADS_CONVERSION_ACTION_ID:'123456',GOOGLE_SA_CLIENT_EMAIL:'offline@example.invalid',GOOGLE_SA_PRIVATE_KEY:'INERT_NOT_A_KEY'})[n]},
    'wix-fetch':{fetch:async(url, options)=>{
      fetches.push(url);
      if(url === 'https://oauth2.googleapis.com/token') return {ok:true,json:async()=>({access_token:'INERT_NOT_A_TOKEN',expires_in:3600})};
      assert.equal(url,'https://datamanager.googleapis.com/v1/events:ingest');
      assert.equal(options.method,'post');
      assert.equal(typeof options.body,'string');
      wires.push(JSON.parse(options.body));
      // Fixed safety fixture for every payload; not a Google validator/result.
      return {ok:false,status:400,text:async()=>JSON.stringify({error:{status:'INVALID_ARGUMENT'}})};
    }}
  };
  const cache = new Map();
  function load(spec) {
    if(cache.has(spec)) return cache.get(spec);
    let mod;
    if(external[spec]) {
      const values=external[spec];
      mod=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context,identifier:spec});
    } else if(spec==='backend/hashUtils.web' && mode!=='sync') {
      const body=mode==='promise' ? 'return actual(pii);' : "throw Error('INERT_HASH_REJECTION');";
      mod=new vm.SourceTextModule("import { buildUserIdentifiers as actual } from 'actual/hashUtils.web'; export async function buildUserIdentifiers(pii) { "+body+' }',{context,identifier:spec});
    } else {
      assert.ok(['backend/googleAdsConversions.web','backend/googleAdsAttemptJournal','backend/dataManagerClient.web','backend/googleAdsHttpDiagnostics','backend/hashUtils.web','actual/hashUtils.web','public/phoneNormalization'].includes(spec),'unexpected import '+spec);
      mod=new vm.SourceTextModule(fs.readFileSync(path.join(root,spec==='public/phoneNormalization'?'../public/phoneNormalization.js':spec.split('/')[1]+'.js'),'utf8'),{context,identifier:spec});
    }
    cache.set(spec,mod);return mod;
  }
  const sender=load('backend/googleAdsConversions.web');await sender.link(load);await sender.evaluate();
  const summary={_id:'summary-inert',bookingNumber:'WC-INERT',googleConversionUploaded:false,googleConversionRetracted:false,bookingDate:new Date('2026-09-14T12:00:00Z')};
  rows.set(key('BookingSummary',summary._id),structuredClone(summary));
  const capability=await cache.get('backend/googleAdsAttemptJournal').namespace.mintGoogleAdsCapability({_id:'room-inert',bookingNumber:'WC-INERT'},summary);
  assert.match(capability,/^gac1\.[a-f0-9]{64}$/);
  return {sender:sender.namespace, rows, wires, fetches, summary, booking:{transactionId:'WC-INERT',value:123.45,currency:'USD',conversionTime:'2026-09-14T12:00:00Z',originalEvent:{conversionTime:'2026-09-14T12:00:00Z'},adjustmentType:'RETRACTION',conversionCapability:capability}};
}
const contacts={email:'fixture@example.invalid',phone:'+12025550100'};
const expected=[{emailAddress:crypto.createHash('sha256').update(contacts.email).digest('hex')},{phoneNumber:crypto.createHash('sha256').update(contacts.phone).digest('hex')}];
for(const mode of ['sync','promise']) for(const route of ['recordBookingConversion','adjustBookingConversion']) {
  test(`${route}: ${mode} helper preserves contact identifiers on serialized wire`,{timeout:3000},async()=>{
    const f=await fixture(mode), booking={...f.booking,...contacts};
    const result = await f.sender[route](booking);
    if(route==='adjustBookingConversion') { assert.equal(result.reasonCode,'UNSUPPORTED_ADJUSTMENT_ROUTE'); assert.deepEqual(f.fetches,[]); return; }
    assert.equal(f.wires.length,1);
    const payload=f.wires[0],event=payload.events[0];
    assert.equal(payload.encoding,'HEX');
    assert.deepEqual(payload.destinations,[{operatingAccount:{accountType:'GOOGLE_ADS',accountId:'1234567890'},productDestinationId:'123456'}]);
    assert.deepEqual(event.userData?.userIdentifiers,expected);
    assert.equal(event.eventName,route==='recordBookingConversion'?'purchase':'purchase_retraction');
    assert.equal(event.conversionValue,route==='recordBookingConversion'?123.45:0);
    assert.equal('adIdentifiers' in event,false);
    assert.deepEqual(f.rows.get('BookingSummary:summary-inert'),f.summary);
    if(route==='recordBookingConversion') {
      const before=plain([...f.rows.values()]);
      assert.deepEqual(before.filter(r=>r.kind).map(r=>r.kind),['AUTH','ATTEMPT','RESULT']);
      assert.equal(before.find(r=>r.kind==='RESULT').outcome,'UNKNOWN');
      assert.equal(before.find(r=>r.kind==='RESULT').requestId,'');
      assert.equal((await f.sender.recordBookingConversion(booking)).reasonCode,'ATTEMPT_EXISTS_OR_UNAVAILABLE');
      assert.deepEqual(plain([...f.rows.values()]),before,'tombstones retained on replay');
      assert.equal((await f.sender.retryBookingConversion()).reasonCode,'RETRY_DISABLED_UNKNOWN_HISTORY');
      assert.equal(f.wires.length,1);
    }
  });
  test(`${route}: ${mode} absent contacts stay absent with click-only input`,{timeout:3000},async()=>{
    const f=await fixture(mode);
    const result = await f.sender[route]({...f.booking,gclid:'INERT_NOT_A_REAL_CLICK'});
    if(route==='adjustBookingConversion') { assert.equal(result.reasonCode,'UNSUPPORTED_ADJUSTMENT_ROUTE'); assert.deepEqual(f.fetches,[]); return; }
    assert.equal(f.wires.length,1);
    assert.equal('userData' in f.wires[0].events[0],false);
    assert.deepEqual(f.wires[0].events[0].adIdentifiers,{gclid:'INERT_NOT_A_REAL_CLICK'});
  });
}
for(const route of ['recordBookingConversion','adjustBookingConversion']) test(`${route}: rejected helper performs zero transport IO`,{timeout:3000},async()=>{
  const f=await fixture('reject'), before=plain([...f.rows.values()]);
  const result=await f.sender[route]({...f.booking,...contacts});
  assert.equal(result.ok,false);
  if(route==='recordBookingConversion') {
    assert.equal(result.outcome,'NOT_ATTEMPTED');
    assert.equal(result.reasonCode,'ADMISSION_UNAVAILABLE');
  } else assert.equal(result.reasonCode,'UNSUPPORTED_ADJUSTMENT_ROUTE');
  assert.deepEqual(f.fetches,[],'neither OAuth nor provider entered');
  assert.deepEqual(f.wires,[]);
  assert.deepEqual(plain([...f.rows.values()]),before,'pre-admission failure leaves AUTH and Summary intact');
});
for(const mode of ['sync','promise']) test(`purchase: ${mode} no contacts and no clicks is denied without transport`,{timeout:3000},async()=>{
  const f=await fixture(mode);
  const result=await f.sender.recordBookingConversion(f.booking);
  assert.equal(result.reasonCode,'ADMISSION_UNAVAILABLE');
  assert.deepEqual(f.fetches,[]);
  assert.deepEqual([...f.rows.values()].filter(r=>r.kind).map(r=>r.kind),['AUTH']);
});
