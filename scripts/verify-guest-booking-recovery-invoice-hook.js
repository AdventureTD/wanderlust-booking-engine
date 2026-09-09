'use strict';
// Recovery hook only. Standalone inert retained-history harness; no producer dispatch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const JOURNAL = 'GuestBookingInvoiceIssuances';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.deepEqual(process.argv.slice(2),['--hook'],'only explicit hook selector admitted');
const admission=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/recovery-invoice-hook-admission.json')));
for(const [file,hash] of Object.entries({...admission.files,...admission.fixtures})) {
 const source=fs.readFileSync(path.join(ROOT,file),'utf8').replace(/\r\n/g,'\n');
 assert.equal(sha(source),hash,'hook custody '+file);
 if(admission.edges[file]) {
  const edges=[...source.matchAll(/from ['"]([^'"]+)/g)].map(m=>m[1]);
  assert.deepEqual(edges,admission.edges[file]);
  for(const edge of edges)assert.ok(edge.startsWith('backend/')?Object.hasOwn(admission.files,'velo/'+edge+'.js'):['buffer','crypto','wix-auth','wix-data','wix-secrets-backend.v2'].includes(edge));
 }
}
const pins = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/completion-authority-dependencies.json'))).files;
const canonicalPins = {
  'velo/backend/roomInventoryRules.js': '6bc0520cb3940b0399f43d8f5df7b493c666f221621bb80bc3e7004c8de89899',
  'velo/backend/roomAssignmentRules.js': '9d685cc29821181e482c84cf1d9ecf0fd463fc03dbf12617d3fcfb76e9dd46b2',
  'velo/backend/roomAvailabilityRules.js': '578b42bcc63c28720b9a08aae9dea42761a42febcfc62449efe5313a7164b6f4'
};
const readerPins = {
  'velo/backend/guestBookingCompletionAuthority.js': '5aca0d1ef923a5a6a884696ec4333feee292f49e8b6e22c5c3ad84ac1f66dd65',
  'velo/backend/guestBookingInvoiceAuthorityConfig.js': '206164914acdc21a1accba71234437f92f6debc410e250d47e8c2919b77fb305'
};
for (const [file, hash] of Object.entries({...pins, ...canonicalPins, ...readerPins})) {
  assert.equal(sha(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n')), hash, file);
}
function fixture(name = 'history') {
  const hashes = {history: 'ee07c3ac0067452deb334c0b2e4086c26cf3e5ab18d740cca77f0a520395bed9', foreign: '9546cdcfa9ee27e8a376fb4714159c8902794c511af35e8aba7b82132bcc2506'};
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/completion-authority-' + name + '.json'));
  assert.equal(sha(bytes.toString('utf8').replace(/\r\n/g, '\n')), hashes[name]);
  const f = JSON.parse(bytes); assert.deepEqual(f.sourceHashes, pins); return f;
}
function worker(db, hook = async () => {}, capture = null) {
  const trace = [], context = vm.createContext({Buffer, TextEncoder, __capture:capture}), cache = new Map();
  if(db.fixtureNow) vm.runInContext('Date.now = () => '+JSON.stringify(db.fixtureNow),context);
  const realm = value => vm.runInContext('(' + JSON.stringify(value) + ')', context);
  const wix = {
    query(collection) {
      const predicates = []; let limit = 100, sort = false, descending = null;
      const q = {
        eq(key, value) { predicates.push([key, value, false]); return q; },
        gt(key, value) { predicates.push([key, value, true]); return q; },
        limit(value) { limit = value; return q; },
        descending(key) { descending = key; return q; },
        ascending(key) { assert.equal(key, '_id'); sort = true; return q; },
        async find(options) {
          assert.deepEqual(JSON.parse(JSON.stringify(options)), {suppressAuth:true, suppressHooks:true, consistentRead:true});
          trace.push({op:'find', collection, predicates:structuredClone(predicates), limit});
          const override = await hook({phase:'find', collection, predicates, db, trace});
          let rows = override?.rows || (db.rows[collection] || []).filter(row => predicates.every(([key, value, gt]) => gt ? row[key] > value : row[key] === value));
          if (sort) rows = rows.slice().sort((a,b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
          if (descending) rows = rows.slice().sort((a,b)=>b[descending]-a[descending]);
          if (override?.page) return override.page;
          return {items:override?.nativeRows || realm(rows.slice(0,limit)), hasNext(){return rows.length > limit;}};
        }
      }; return q;
    },
    async insert(collection, value, options) {
      trace.push({op:'insert', collection, id:value._id});
      assert.ok([JOURNAL,'GuestBookingRecoveryProgress'].includes(collection), 'booking/START/provider writes forbidden: '+collection);
      assert.deepEqual(JSON.parse(JSON.stringify(options)), {suppressAuth:true, suppressHooks:true});
      await hook({phase:'input', collection, input:value, db, trace});
      const row = JSON.parse(JSON.stringify(value));
      await hook({phase:'beforeInsert', collection, row, db, trace});
      db.rows[collection] ||= [];
      if (db.rows[collection].some(r => r._id === row._id)) throw Error('duplicate');
      db.rows[collection].push(structuredClone(row));
      await hook({phase:'afterInsert', collection, row, db, trace});
      return realm(row);
    }
  };
  const sdk = {
    'wix-data': {default:wix}, 'wix-auth': {elevate:f=>f}, buffer:{Buffer},
    crypto:{...crypto, randomBytes(){trace.push({op:'rng'}); throw Error('RNG forbidden');}},
    'wix-secrets-backend.v2': {secrets:{async getSecretValue(name) {
      trace.push({op:'secret', name}); assert.equal(name, 'WBE_GUEST_BOOKING_KEYS');
      if (db.secretFailure) throw Error('unavailable'); return realm({value:JSON.stringify(db.keys)});
    }}}
  };
  sdk.crypto.default = sdk.crypto;
  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    let mod;
    if (Object.hasOwn(sdk, name)) {
      const values = sdk[name];
      mod = new vm.SyntheticModule(Object.keys(values), function(){for (const [k,v] of Object.entries(values)) this.setExport(k,v);}, {context, identifier:name});
    } else {
      assert.match(name, /^backend\/[A-Za-z0-9]+$/);
      const file = 'velo/' + name + '.js';
      assert.ok(Object.hasOwn(pins,file) || Object.hasOwn(readerPins,file) || ['backend/guestBookingInvoiceIssuance','backend/guestBookingCompletionRecovery','backend/guestBookingRecoveryProgressStore'].includes(name), 'closed module ' + name);
      let source=fs.readFileSync(path.join(ROOT,file),'utf8');
      if(capture && name==='backend/guestBookingCompletionRecovery') {
        const anchor='const page=await discoverGuestBookingAcceptances(state.head.afterSourceId);';
        assert.equal(source.split(anchor).length,2);
        source=source.replace(anchor,anchor+'globalThis.__capture(page);');
      }
      mod = new vm.SourceTextModule(source, {context, identifier:name});
    }
    cache.set(name,mod); return mod;
  }
  async function api(name) {const mod = await load(name); if (mod.status === 'unlinked') await mod.link(spec=>load(spec)); if (mod.status === 'linked') await mod.evaluate(); return mod.namespace;}
  return {api, trace};
}
const args = f => [f.expected.acceptanceId, f.expected.operationId, f.expected.rootDigest];
async function advance(f, hook, supplied) {
  const w = worker(f.db, hook);
  const api = await w.api('backend/guestBookingInvoiceIssuance');
  assert.deepEqual(Object.keys(api), ['advanceInitialGuestInvoiceForRecoveredAcceptance']);
  const result = await api.advanceInitialGuestInvoiceForRecoveredAcceptance(...(supplied || args(f)));
  return {w, result:JSON.parse(JSON.stringify(result))};
}
const cases = [];
async function test(id, fn) {await fn(); cases.push(id); console.log('PASS '+id);}
async function recover(f, hook) {
 const w=worker(f.db,hook), api=await w.api('backend/guestBookingCompletionRecovery');
 const result=await api.recoverGuestBookingCompletions();
 return {w,result};
}
async function main() {
 assert.deepEqual(process.argv.slice(2),['--hook']);
 await test('RH01_ACTUAL_COMPLETED_RECOVERY_ADMITS',async()=>{
  const f=fixture(), before=structuredClone(f.db.rows);
  const {w,result}=await recover(f);
  assert.equal(result.status,'ADVANCED');
  assert.equal((f.db.rows[JOURNAL]||[]).length,1,'confirmed actual recovery must admit invoice');
  for(const [c,rows] of Object.entries(before)) assert.deepEqual(f.db.rows[c],rows);
  assert.ok(w.trace.every(t=>t.op!=='insert'||[JOURNAL,'GuestBookingRecoveryProgress'].includes(t.collection)));
 });
 await test('RH02_RESTART_NO_DUPLICATE_ADMISSION_OR_START',async()=>{
  const f=fixture(); await recover(f); const admitted=structuredClone(f.db.rows[JOURNAL]);
  const {w,result}=await recover(f);
  assert.equal(result.status,'ADVANCED'); assert.deepEqual(f.db.rows[JOURNAL],admitted);
  assert.deepEqual(w.trace.filter(t=>t.op==='insert').map(t=>t.collection),['GuestBookingRecoveryProgress']);
 });
 await test('RH03_RETIRED_KEYS_NO_DEPOSIT_NO_GUEST_CREDENTIAL',async()=>{
  const f=fixture(); f.db.keys={audience:f.db.keys.audience};
  f.db.fixtureNow=Date.parse('2100-01-01T00:00:00Z');
  assert.equal(f.db.rows.BookingPayments,undefined);
  const {result}=await recover(f); assert.equal(result.status,'ADVANCED');
  assert.equal(f.db.rows[JOURNAL].length,1);
 });
 await test('RH04_INVOICE_UNCERTAINTY_PRESERVES_CONFIRMATION',async()=>{
  for(const mode of ['config','beforeInsert','lostAckReadback']) {
   const f=fixture(), before=structuredClone(f.db.rows); let inserted=false;
   if(mode==='config')f.db.secretFailure=true;
   const {w,result}=await recover(f,async e=>{
    if(e.collection!==JOURNAL)return;
    if(mode==='beforeInsert'&&e.phase==='beforeInsert')throw Error('unsent');
    if(mode==='lostAckReadback'&&e.phase==='afterInsert'){inserted=true;throw Error('lost ACK');}
    if(mode==='lostAckReadback'&&inserted&&e.phase==='find')throw Error('unreadable');
   });
   assert.equal(result.status,'ADVANCED',mode);
   assert.equal(f.db.rows.GuestBookingRecoveryProgress[0].classification,'COORDINATOR_RETURNED');
   for(const [c,rows] of Object.entries(before))assert.deepEqual(f.db.rows[c],rows);
   f.db.secretFailure=false;
   const reader=worker(f.db);
   assert.equal((await(await reader.api('backend/guestBookingCompletionAuthority')).readRecoveredGuestBookingCompletion(...args(f))).status,'VERIFIED_COMPLETION');
   const retry=await recover(f); assert.equal(retry.result.status,'ADVANCED');
   assert.equal(f.db.rows[JOURNAL].length,1);
   if(inserted)assert.equal(retry.w.trace.filter(t=>t.op==='insert'&&t.collection===JOURNAL).length,0);
  }
 });
 await test('RH05_SNAPSHOT_BEFORE_COORDINATOR_AWAIT',async()=>{
  const f=fixture(), foreign=fixture('foreign'); let page, changed=false;
  const w=worker(f.db,async e=>{
   if(page&&!changed&&e.phase==='find'&&e.collection==='GuestBookingCompletions'){
    changed=true;
    Object.assign(page.contexts[0],foreign.expected);
   }
  },p=>{page=p;});
  const result=await(await w.api('backend/guestBookingCompletionRecovery')).recoverGuestBookingCompletions();
  assert.equal(result.status,'ADVANCED'); assert.equal(changed,true);
  assert.equal(f.db.rows[JOURNAL][0].acceptanceId,f.expected.acceptanceId);
  assert.equal(f.db.rows[JOURNAL][0].operationId,f.expected.operationId);
 });
 await test('RH06_FOREIGN_LOCAL_SWEEP_IS_AUTHORIZED',async()=>{
  const f=fixture('foreign'); const {result}=await recover(f);
  assert.equal(result.status,'ADVANCED'); assert.equal(f.db.rows[JOURNAL][0].acceptanceId,f.expected.acceptanceId);
 });
 await test('RH07_READ_ONLY_OBSERVERS_NEVER_WAKE_RECOVERY',async()=>{
  const f=fixture(),before=structuredClone(f.db.rows),w=worker(f.db);
  await(await w.api('backend/guestBookingAcceptanceDiscovery')).discoverGuestBookingAcceptances(null);
  await(await w.api('backend/guestBookingRecoveryProgressStore')).createGuestBookingRecoveryProgressStore().head();
  assert.equal((await(await w.api('backend/guestBookingCompletionAuthority')).readRecoveredGuestBookingCompletion(...args(f))).status,'VERIFIED_COMPLETION');
  assert.deepEqual(f.db.rows,before); assert.equal(w.trace.filter(t=>t.op==='insert').length,0);
 });
 await test('RH08_UNRESOLVED_COORDINATOR_NEVER_ADMITS',async()=>{
  const f=fixture(),before=structuredClone(f.db.rows);
  const {w,result}=await recover(f,async e=>{if(e.phase==='find'&&e.collection==='GuestBookingCompletions')throw Error('receipt unavailable');});
  assert.equal(result.status,'ADVANCED');
  assert.equal(f.db.rows.GuestBookingRecoveryProgress[0].classification,'COORDINATOR_UNRESOLVED');
  assert.ok(!w.trace.some(t=>t.collection===JOURNAL||t.op==='secret'));
  for(const [c,rows] of Object.entries(before))assert.deepEqual(f.db.rows[c],rows);
 });
 await test('RH09_INVALID_SNAPSHOT_DEFERS_ONLY_INVOICE',async()=>{
  for(const value of ['0'.repeat(64),[],null]) {
   const f=fixture(),w=worker(f.db,undefined,p=>{p.contexts[0].operationId=value;});
   assert.equal((await(await w.api('backend/guestBookingCompletionRecovery')).recoverGuestBookingCompletions()).status,'ADVANCED');
   assert.equal(f.db.rows.GuestBookingRecoveryProgress[0].classification,'COORDINATOR_RETURNED');
   assert.equal(f.db.rows[JOURNAL],undefined);
  }
 });
 await test('RH10_PENDING_READ_ONLY_NO_AUTHORITY',async()=>{
  const f=fixture(); f.db=f.pending; const before=structuredClone(f.db.rows),w=worker(f.db);
  assert.notEqual((await(await w.api('backend/guestBookingCompletionAuthority')).readRecoveredGuestBookingCompletion(...args(f))).status,'VERIFIED_COMPLETION');
  assert.deepEqual(f.db.rows,before);assert.equal(w.trace.filter(t=>t.op==='insert').length,0);
 });
 assert.equal(cases.length,10);
 console.log(JSON.stringify({cases,count:cases.length}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
