'use strict';
// Inert SDK only. Native ESM linking below preserves every source import/export.
const { fixture, evalSource } = require('./google-ads-private-journal.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '../velo/backend');
const payload = async () => ({destinations:[{operatingAccount:{accountId:'1234567890'},productDestinationId:'123456'}],events:[]});
async function retained(f, record) {
  const token = await f.mint(), booking = f.booking({conversionCapability:token});
  const before = structuredClone(f.rows.get('BookingSummary:summary-inert'));
  const result = await record(booking, payload);
  assert.equal(result.outcome, 'UNKNOWN'); assert.equal(result.reasonCode, 'HTTP_ERROR');
  const rows = [...f.rows.values()].filter(r => r.kind);
  assert.deepEqual(rows.map(r => r.kind), ['AUTH','ATTEMPT','RESULT']);
  const row = rows[2];
  assert.equal(row.outcome,'UNKNOWN'); assert.equal(row.statusCode,400);
  assert.equal(row.requestId,''); assert.equal(row.warningPresent,false);
  assert.ok(Buffer.byteLength(JSON.stringify(row)) <= 2048);
  assert.deepEqual(f.rows.get('BookingSummary:summary-inert'),before);
  assert.equal((await record(booking,payload)).reasonCode,'ATTEMPT_EXISTS_OR_UNAVAILABLE');
  assert.equal(f.sends,1);
  return row;
}
const fail = () => { throw Error('PRIVATE ECHO'); };
for (const [name, sanitizer] of [
  // Exact independent-review witnesses: do not relax to merely no private leak.
  ['oversized array', () => ({reasons:['X'.repeat(3000)],fields:[]})],
  ['extra private property', () => ({reasons:['INVALID_ARGUMENT'],fields:[],privateEcho:'INERT_PRIVATE_SENTINEL'})],
  ['object reason', () => ({reasons:[{privateEcho:'INERT_PRIVATE_SENTINEL'}],fields:[]})],
  ['custom toJSON', () => ({reasons:['INVALID_ARGUMENT'],fields:[],toJSON(){return {privateEcho:'INERT_PRIVATE_SENTINEL'};}})],
  ['too many approved reasons', () => ({reasons:['INVALID_ARGUMENT','INTERNAL','UNAVAILABLE','NOT_FOUND'],fields:[]})],
  ['unapproved reason', () => ({reasons:['INERT_PRIVATE_SENTINEL'],fields:[]})],
  ['numeric field index', () => ({reasons:[],fields:['events[123].userData']})],
  ['unapproved field', () => ({reasons:[],fields:['events.INERT_PRIVATE_SENTINEL']})],
  ['object field', () => ({reasons:[],fields:[{privateEcho:'INERT_PRIVATE_SENTINEL'}]})],
  ['array extra property', () => ({reasons:Object.assign(['INVALID_ARGUMENT'],{privateEcho:'INERT_PRIVATE_SENTINEL'}),fields:[]})],
  ['array getter', () => ({reasons:Object.defineProperty([],0,{get:fail}),fields:[]})],
  ['async', async () => ({reasons:[],fields:[]})],
  ['pending', () => new Promise(() => {})],
  ['undefined', () => undefined], ['empty', () => ({})],
  ['missing fields', () => ({reasons:[]})], ['wrong arrays', () => ({reasons:7,fields:'PRIVATE ECHO'})],
  ['throw', fail], ['getter', () => ({get reasons(){return fail();},fields:[]})],
  ['thenable', () => ({then:fail})], ['revoked proxy', () => {const p=Proxy.revocable({},{});p.revoke();return p.proxy;}]
]) test('optional sanitizer return cannot suppress RESULT: '+name, {timeout:2000}, async () => {
  const f=fixture({provider:async()=>{throw {code:'HTTP_ERROR',outcome:'unknown',httpStatus:400,httpDiagnostics:{}};}});
  const journal=evalSource('backend/googleAdsAttemptJournal.js',{...f.globals,sanitizeHttpErrorDiagnostics:sanitizer},['recordPrivateGoogleAdsAttempt']);
  assert.equal((await retained(f,journal.recordPrivateGoogleAdsAttempt)).reasonCode,'HTTP_ERROR');
});
for (const [name, diagnostics] of [
  ['getter', {get reasons(){return fail();}}],
  ['slice', {reasons:Object.assign(['INVALID_ARGUMENT'],{slice:fail})}],
  ['thenable', {then:fail}], ['null', null]
]) test('hostile diagnostic input cannot suppress RESULT: '+name, async () => {
  const f=fixture({provider:async()=>{throw {code:'HTTP_ERROR',outcome:'unknown',httpStatus:400,httpDiagnostics:diagnostics};}});
  await retained(f,f.globals.recordPrivateGoogleAdsAttempt);
});
test('throwing diagnostic property cannot suppress RESULT', async () => {
  const f=fixture({provider:async()=>{throw {code:'HTTP_ERROR',outcome:'unknown',httpStatus:400,get httpDiagnostics(){return fail();}};}});
  assert.equal((await retained(f,f.globals.recordPrivateGoogleAdsAttempt)).reasonCode,'HTTP_ERROR');
});

test('journal vocabulary exactly matches helper and fresh projection ignores inherited serialization', async () => {
  const helper=evalSource('backend/googleAdsHttpDiagnostics.js',{},['HTTP_REASON_CODES','HTTP_FIELD_NAMES']);
  const f=fixture({provider:async()=>{throw {code:'HTTP_ERROR',outcome:'unknown',httpStatus:400};}});
  let serialized=0;
  const toJSON=()=>{serialized++;return {privateEcho:'INERT_PRIVATE_SENTINEL'};};
  const reasons=['INVALID_ARGUMENT','INTERNAL','NOT_FOUND'];
  const fields=['events[].userData.userIdentifiers[].emailAddress','destinations[].operatingAccount.accountId','events[].transactionId'];
  Object.setPrototypeOf(reasons,Object.assign(Object.create(Array.prototype),{toJSON}));
  Object.setPrototypeOf(fields,Object.assign(Object.create(Array.prototype),{toJSON}));
  const output=Object.assign(Object.create({toJSON}),{reasons,fields});
  const journal=evalSource('backend/googleAdsAttemptJournal.js',{...f.globals,sanitizeHttpErrorDiagnostics:()=>output},
    ['recordPrivateGoogleAdsAttempt','DIAGNOSTIC_REASONS','DIAGNOSTIC_FIELDS']);
  assert.deepEqual([...journal.DIAGNOSTIC_REASONS],[...helper.HTTP_REASON_CODES]);
  assert.deepEqual([...journal.DIAGNOSTIC_FIELDS],[...helper.HTTP_FIELD_NAMES]);
  const row=await retained(f,journal.recordPrivateGoogleAdsAttempt);
  assert.equal(row.reasonCode,'HTTP_ERROR|'+JSON.stringify({reasons:[...reasons],fields:[...fields]}));
  assert.equal(serialized,0,'never invoke helper-returned object/array serializers');
});

// No stripped imports: Node links real client/journal/helper source and resolves
// named exports. SDK and transport are synthetic; this is not a Wix host emulator.
test('native module wiring uses one private synchronous sanitizer in both consumers', async () => {
  assert.equal(typeof vm.SourceTextModule,'function','run with --experimental-vm-modules');
  const helper='googleAdsHttpDiagnostics.js';
  for(const file of ['dataManagerClient.web.js','googleAdsAttemptJournal.js']) {
    assert.match(fs.readFileSync(path.join(root,file),'utf8'), /import \{ sanitizeHttpErrorDiagnostics \} from 'backend\/googleAdsHttpDiagnostics';/);
  }
  const f=fixture(); let sends=0;
  const context=vm.createContext({Buffer,Date,URLSearchParams});
  const cache=new Map();
  const external={
    'crypto':{default:{...f.globals.crypto,createSign:()=>({update(){return this;},sign:()=>Buffer.from('inert')})}},
    'wix-data':{default:f.sdk},
    'backend/settings.web':{getAllSettings:f.globals.getAllSettings},
    'wix-secrets-backend':{getSecret:async n=>n==='GOOGLE_SA_PRIVATE_KEY'?'INERT':f.globals.getSecret(n)},
    'wix-fetch':{fetch:async url=>{
      if(url==='https://oauth2.googleapis.com/token')return {ok:true,json:async()=>({access_token:'INERT',expires_in:3600})};
      assert.equal(url,'https://datamanager.googleapis.com/v1/events:ingest'); sends++;
      return {ok:false,status:400,text:async()=>JSON.stringify({error:{status:'INVALID_ARGUMENT',message:'PRIVATE ECHO'}})};
    }}
  };
  function load(specifier) {
    if(cache.has(specifier))return cache.get(specifier);
    let module;
    if(external[specifier]) {
      const values=external[specifier];
      module=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context});
    } else {
      assert.ok(['backend/googleAdsAttemptJournal','backend/dataManagerClient.web','backend/googleAdsHttpDiagnostics'].includes(specifier), 'unexpected import '+specifier);
      module=new vm.SourceTextModule(fs.readFileSync(path.join(root,specifier.slice(8)+'.js'),'utf8'),{context,identifier:specifier});
    }
    cache.set(specifier,module); return module;
  }
  const journal=load('backend/googleAdsAttemptJournal'); await journal.link(load); await journal.evaluate();
  const projection=cache.get('backend/googleAdsHttpDiagnostics').namespace.sanitizeHttpErrorDiagnostics({reasons:['INVALID_ARGUMENT'],fields:[]});
  assert.equal(projection.then,undefined); assert.ok(Array.isArray(projection.reasons));
  assert.ok(!('sanitizeHttpErrorDiagnostics' in cache.get('backend/dataManagerClient.web').namespace));
  const token=await journal.namespace.mintGoogleAdsCapability({bookingNumber:'WC-INERT',_id:'room-inert'},{bookingNumber:'WC-INERT',_id:'summary-inert'});
  const booking=f.booking({conversionCapability:token});
  await journal.namespace.recordPrivateGoogleAdsAttempt(booking,payload);
  const row=[...f.rows.values()].find(r=>r.kind==='RESULT');
  assert.equal(row.reasonCode,'HTTP_ERROR|'+JSON.stringify({reasons:['INVALID_ARGUMENT'],fields:[]}));
  assert.equal(row.outcome,'UNKNOWN'); assert.equal(row.statusCode,400);
  await journal.namespace.recordPrivateGoogleAdsAttempt(booking,payload); assert.equal(sends,1);
  assert.ok(!JSON.stringify(row).includes('PRIVATE ECHO'));
});
