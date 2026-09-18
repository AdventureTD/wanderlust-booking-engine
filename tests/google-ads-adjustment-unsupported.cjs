'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
async function fixture({ suspended = false, result, retracted = false } = {}) {
  const rows = new Map(), calls = [];
  const key = (c,id) => c + ':' + id;
  rows.set(key('Bookings','room'), {_id:'room',bookingNumber:'INERT',status:'Confirmed',quantity:1,checkIn:new Date('2026-10-01'),checkOut:new Date('2026-10-05')});
  rows.set(key('BookingSummary','summary'), {_id:'summary',bookingNumber:'INERT',status:'Confirmed',googleConversionUploaded:true,googleConversionRetracted:retracted});
  const sdk = {
    async get(c,id) { return structuredClone(rows.get(key(c,id))); },
    async update(c,r) { calls.push(['update',c]); rows.set(key(c,r._id),structuredClone(r)); return structuredClone(r); },
    query(c) { let filters=[]; return {eq(k,v){filters.push([k,v]);return this;},limit(){return this;},async find(){return {items:[...rows.entries()].filter(([k,v])=>k.startsWith(c+':')&&filters.every(([f,x])=>v[f]===x)).map(([,v])=>structuredClone(v))};}};}
  };
  const forbidden = () => { calls.push(['FORBIDDEN']); throw Error('NO_PROVIDER_IO'); };
  const external = {
    crypto:{default:crypto}, 'wix-data':{default:sdk},
    'libphonenumber-js/max':{parsePhoneNumberFromString:(s,o)=>require('libphonenumber-js/max').parsePhoneNumberFromString(s,JSON.parse(JSON.stringify(o)))},
    'wix-web-module':{Permissions:{Anyone:0,Admin:1},webMethod:(_,f)=>f},
    'wix-fetch':{fetch:forbidden}, 'wix-secrets-backend':{getSecret:forbidden},
    'wix-users-backend':{currentUser:{loggedIn:true,getRoles:async()=>[{title:'Admin'}]}},
    'backend/settings.web':{getAllSettings:async()=>({suspendGoogleAds:suspended?'1':'0'}),incrementSetting:forbidden},
    'backend/search.web':{searchAvailability:forbidden},
    'backend/rateResolver':{normalizePriceModifier:forbidden,roundMoney:forbidden},
    'backend/pricingQuote':{verifyLockedPricingQuote:forbidden},
    'backend/googleAdsAttemptJournal':{recordPrivateGoogleAdsAttempt:forbidden,mintGoogleAdsCapability:forbidden},
    'backend/dataManagerClient.web':{ingestEvent:forbidden}
  };
  if (result) external['backend/googleAdsConversions.web']={isGoogleAdsSuspended:async()=>suspended,adjustBookingConversion:async()=>structuredClone(result)};
  const context=vm.createContext({Date,console:{log(){},error(){}},Buffer}), cache=new Map();
  function make(id) {
    if(cache.has(id))return cache.get(id);
    const e=external[id]; const m=e?new vm.SyntheticModule(Object.keys(e),function(){for(const k of Object.keys(e))this.setExport(k,e[k]);},{context}):new vm.SourceTextModule(fs.readFileSync(path.join(__dirname,'../velo',id+'.js'),'utf8'),{context,identifier:id});
    cache.set(id,m);return m;
  }
  async function load(id){const m=make(id); if(m.status==='unlinked')await m.link(make);if(m.status==='linked')await m.evaluate();return m.namespace;}
  return {rows,calls,load};
}
for(const adjustmentType of ['RETRACTION','RESTATEMENT','UNKNOWN']) test('unsupported '+adjustmentType+' never dispatches',async()=>{
  const f=await fixture(), c=await f.load('backend/googleAdsConversions.web');
  const r=await c.adjustBookingConversion({transactionId:'INERT',adjustmentType,newValue:'oops'});
  assert.equal(r.ok,false);assert.equal(r.outcome,'NOT_ATTEMPTED');assert.equal(r.reasonCode,'UNSUPPORTED_ADJUSTMENT_ROUTE');assert.deepEqual(f.calls,[]);
});
for(const route of ['adminCancelBooking','cancelBooking']) for(const kind of ['actual','suspended','unknown','ingestionAck','legacyOk','existingFlag']) test(route+' preserves cancellation without false retraction: '+kind,async()=>{
  const result=kind==='unknown'?{ok:false,outcome:'UNKNOWN'}:kind==='ingestionAck'?{ok:true,outcome:'INGESTION_ACKNOWLEDGED'}:kind==='legacyOk'?{ok:true}:undefined;
  const f=await fixture({suspended:kind==='suspended',result,retracted:kind==='existingFlag'});
  const c=await f.load(route==='adminCancelBooking'?'backend/adminConsole.web':'backend/availability.web');
  await c[route](route==='adminCancelBooking'?'INERT':'room');
  assert.equal(f.rows.get('Bookings:room').status,'Cancelled');
  const summary=f.rows.get('BookingSummary:summary');
  assert.equal(summary.googleConversionRetracted===true,kind==='existingFlag');
  assert.equal(summary.googleConversionUploaded,true);
  assert.equal(f.calls.some(c=>c[0]==='FORBIDDEN'),false);
});
