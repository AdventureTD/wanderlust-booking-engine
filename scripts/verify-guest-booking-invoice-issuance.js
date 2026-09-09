'use strict';
// New consumer-only selection. Never imports/runs another verifier or producer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const JOURNAL = 'GuestBookingInvoiceIssuances';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
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
  assert.equal(sha(bytes), hashes[name]);
  const f = JSON.parse(bytes); assert.deepEqual(f.sourceHashes, pins); return f;
}
function worker(db, hook = async () => {}) {
  const trace = [], context = vm.createContext({Buffer}), cache = new Map();
  const realm = value => vm.runInContext('(' + JSON.stringify(value) + ')', context);
  const wix = {
    query(collection) {
      const predicates = []; let limit = 100, sort = false;
      const q = {
        eq(key, value) { predicates.push([key, value, false]); return q; },
        gt(key, value) { predicates.push([key, value, true]); return q; },
        limit(value) { limit = value; return q; },
        ascending(key) { assert.equal(key, '_id'); sort = true; return q; },
        async find(options) {
          assert.deepEqual(JSON.parse(JSON.stringify(options)), {suppressAuth:true, suppressHooks:true, consistentRead:true});
          trace.push({op:'find', collection, predicates:structuredClone(predicates), limit});
          const override = await hook({phase:'find', collection, predicates, db, trace});
          let rows = override?.rows || (db.rows[collection] || []).filter(row => predicates.every(([key, value, gt]) => gt ? row[key] > value : row[key] === value));
          if (sort) rows = rows.slice().sort((a,b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
          if (override?.page) return override.page;
          return {items:override?.nativeRows || realm(rows.slice(0,limit)), hasNext(){return rows.length > limit;}};
        }
      }; return q;
    },
    async insert(collection, value, options) {
      trace.push({op:'insert', collection, id:value._id});
      assert.equal(collection, JOURNAL, 'all booking and Admin writes forbidden');
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
      assert.ok(Object.hasOwn(pins,file) || Object.hasOwn(readerPins,file) || name === 'backend/guestBookingInvoiceIssuance', 'closed module ' + name);
      mod = new vm.SourceTextModule(fs.readFileSync(path.join(ROOT,file),'utf8'), {context, identifier:name});
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
async function test(id, fn) {await fn(); cases.push(id); console.log('PASS ' + id);}
async function main() {
  assert.deepEqual(process.argv.slice(2), ['--admission'], 'explicit consumer-only selector required');
  await test('GI01', async () => {
    const f = fixture(), before = structuredClone(f.db.rows);
    const reader = worker(f.db);
    assert.equal((await (await reader.api('backend/guestBookingCompletionAuthority')).readRecoveredGuestBookingCompletion(...args(f))).status, 'VERIFIED_COMPLETION');
    assert.deepEqual(f.db.rows, before, 'actual retained-reader positive is read-only');
    assert.ok(fs.existsSync(path.join(ROOT,'velo/backend/guestBookingInvoiceIssuance.js')), 'actual initial issuance consumer required');
    const {result, w} = await advance(f);
    assert.equal(result.status, 'INITIAL_ISSUANCE_ADMITTED');
    assert.equal(f.db.rows[JOURNAL].length, 1);
    assert.equal(result.issuanceId, f.db.rows[JOURNAL][0]._id);
    assert.equal(w.trace.filter(t=>t.op==='insert').length, 1);
    for (const [collection,rows] of Object.entries(before)) assert.deepEqual(f.db.rows[collection], rows);
  });
  await test('GI02_RESTART', async () => {
    const f = fixture(); const first = await advance(f);
    const retained = structuredClone(f.db.rows);
    const again = await advance(f);
    assert.deepEqual(again.result, first.result);
    assert.deepEqual(f.db.rows, retained);
    assert.equal(again.w.trace.filter(t=>t.op==='insert').length, 0, 'completed admission replay never attempts insert');
  });
  await test('GI03_CANONICAL_AUTHORITY', async () => {
    const f = fixture(); await advance(f);
    const receipt = f.db.rows.GuestBookingCompletions[0], row = f.db.rows[JOURNAL][0];
    const identity = sha(Buffer.from('wbe.guest-initial-invoice.v1\0' + JSON.stringify([receipt.audience,receipt._id,'initial',receipt.recipientBindingDigest])));
    assert.equal(row._id, identity);
    assert.equal(row.projectionCanonical, receipt.projectionCanonical);
    assert.equal(row.financialDigest, receipt.financialDigest);
    assert.equal(row.recipientBindingDigest, receipt.recipientBindingDigest);
    assert.deepEqual([row.to,row.cc,row.from], [receipt.recipient,'info@wanderlustcaribbean.com','info@wanderlustcaribbean.com']);
    const p = JSON.parse(row.projectionCanonical);
    assert.deepEqual(p.summary.acceptedCalculation.groups.map(g=>[g.index,g.grossCents,g.grandTotalCents]), [[0,20001,23501],[1,20001,23501]]);
    assert.deepEqual(p.plannedBookingRows.map(r=>[r.originalGroupIndex,r.assignedRoom,r.note]), [[0,3,'Café 李'],[1,4,'']]);
    assert.equal(p.summary.acceptedCalculation.totals.grandTotalCents, 47002);
    assert.equal(Object.hasOwn(row,'payments'), false, 'no invented payment snapshot');
    assert.equal(Object.hasOwn(row,'invoiceNumber'), false, 'no unreviewed counter/number assignment');
  });
  await test('GI04_INPUT', async () => {
    const f = fixture(), good = args(f), bad = [[],good.slice(0,2),good.concat('extra')];
    for (let i=0;i<3;i++) for (const value of [[good[i]],new String(good[i]),' '+good[i],good[i].toUpperCase(),null,{},'a'.repeat(63)]) {
      const a=good.slice(); a[i]=value; bad.push(a);
    }
    bad.push(['0'.repeat(64),good[1],good[2]]);
    for (const a of bad) {const {result,w}=await advance(f,undefined,a); assert.deepEqual(result,{status:'DENIED'}); assert.deepEqual(w.trace,[]);}
  });
  await test('GI05_PENDING_AND_FRESH_REVALIDATION', async () => {
    for (const edit of [f=>{f.db=f.pending;},f=>{f.db.rows.GuestBookingCompletions=[];},f=>{f.db.rows.Bookings.pop();}]) {
      const f=fixture(); edit(f); const before=structuredClone(f.db.rows), {result,w}=await advance(f);
      assert.ok(['UNKNOWN','INTEGRITY'].includes(result.status)); assert.deepEqual(f.db.rows,before);
      assert.ok(w.trace.every(t=>t.op==='find'||t.op==='secret'));
      assert.ok(!w.trace.some(t=>t.collection===JOURNAL));
    }
    const f=fixture(); await advance(f); f.db.rows.GuestBookingCompletions=[];
    const before=structuredClone(f.db.rows), {result,w}=await advance(f);
    assert.deepEqual(result,{status:'UNKNOWN'}); assert.deepEqual(f.db.rows,before);
    assert.ok(!w.trace.some(t=>t.collection===JOURNAL), 'existing admission cannot replace retained completion authority');
  });
  await test('GI06_FOREIGN_EXPECTATION', async () => {
    const a=fixture(), b=fixture('foreign'); assert.equal((await advance(b)).result.status,'INITIAL_ISSUANCE_ADMITTED');
    const {result,w}=await advance(a,async({phase,collection})=>phase==='find'&&collection==='GuestBookingCompletions'?{rows:b.db.rows.GuestBookingCompletions}:undefined);
    assert.deepEqual(result,{status:'INTEGRITY'}); assert.ok(!w.trace.some(t=>t.collection===JOURNAL));
    assert.equal(w.trace.filter(t=>t.op==='find').length,1);
  });
  await test('GI07_ADMISSION_FAULT_MATRIX', async () => {
    for (const mode of ['initialRead','beforeInsert','lostAck','ackReadUnavailable','lostAckReadUnavailable']) {
      const f=fixture(); let inserted=false;
      const hook=async e=>{
        if(e.collection!==JOURNAL)return;
        if(e.phase==='beforeInsert'&&mode==='beforeInsert')throw Error('definitely not inserted');
        if(e.phase==='afterInsert'){inserted=true;if(mode==='lostAck'||mode==='lostAckReadUnavailable')throw Error('applied lost ACK');}
        if(e.phase==='find'&&(mode==='initialRead'||inserted&&['ackReadUnavailable','lostAckReadUnavailable'].includes(mode)))throw Error('unreadable');
      };
      const {result,w}=await advance(f,hook);
      assert.equal(result.status,mode==='lostAck'?'INITIAL_ISSUANCE_ADMITTED':'UNKNOWN', mode);
      assert.equal((f.db.rows[JOURNAL]||[]).length, inserted?1:0);
      assert.equal(w.trace.filter(t=>t.op==='insert').length,mode==='initialRead'?0:1);
      const retained=structuredClone(f.db.rows), retry=await advance(f);
      assert.equal(retry.result.status,'INITIAL_ISSUANCE_ADMITTED');
      assert.equal(retry.w.trace.filter(t=>t.op==='insert').length,inserted?0:1);
      if(inserted)assert.deepEqual(f.db.rows,retained);
    }
  });
  await test('GI08_CONFLICT_NO_OVERWRITE', async () => {
    for (const mode of ['recipient','financial','extra','duplicate','accessor']) {
      const f=fixture(); await advance(f); const row=f.db.rows[JOURNAL][0];
      if(mode==='recipient')row.to='other@example.test';
      if(mode==='financial')row.financialDigest='0'.repeat(64);
      if(mode==='extra')row.unapproved=true;
      if(mode==='duplicate')f.db.rows[JOURNAL].push(structuredClone(row));
      let getters=0;
      const hook=async e=>{if(mode==='accessor'&&e.collection===JOURNAL&&e.phase==='find'){
        const malicious={...row}; Object.defineProperty(malicious,'to',{enumerable:true,get(){getters++;return row.to;}});
        // The transport preserves this exact object rather than JSON-normalizing it.
        return {nativeRows:[malicious]};
      }};
      const before=structuredClone(f.db.rows), {result,w}=await advance(f,hook);
      assert.deepEqual(result,{status:'INTEGRITY'},mode); assert.deepEqual(f.db.rows,before);
      assert.equal(w.trace.filter(t=>t.op==='insert').length,0); assert.equal(getters,0);
    }
  });
  await test('GI09_TWO_MODULE_WORKERS', async () => {
    const f=fixture(); let release, reached;
    const gate=new Promise(resolve=>{release=resolve;}), paused=new Promise(resolve=>{reached=resolve;});
    let timer;
    const watchdog=new Promise((_,reject)=>{timer=setTimeout(()=>{release();reject(Error('concurrency watchdog'));},5000);});
    let first;
    try {
      first=advance(f,async e=>{if(e.phase==='beforeInsert'){reached();await gate;}});
      await Promise.race([paused,watchdog]);
      const second=await Promise.race([advance(f),watchdog]); const retained=structuredClone(f.db.rows); release();
      const one=await Promise.race([first,watchdog]);
      assert.deepEqual(one.result,second.result); assert.equal(one.result.status,'INITIAL_ISSUANCE_ADMITTED');
      assert.deepEqual(f.db.rows,retained); assert.equal(f.db.rows[JOURNAL].length,1);
      assert.equal(one.w.trace.filter(t=>t.op==='insert').length,1);
      assert.equal(second.w.trace.filter(t=>t.op==='insert').length,1);
    } finally {release();clearTimeout(timer);if(first)await first;}
  });
  await test('GI10_RETIRED_KEYS_AND_UNAVAILABLE_CONFIG', async () => {
    const f=fixture(); f.db.keys={audience:'wbe:fixture',activeKid:'retired',keys:[]};
    assert.equal((await advance(f)).result.status,'INITIAL_ISSUANCE_ADMITTED');
    const g=fixture(); g.db.secretFailure=true;
    const {result,w}=await advance(g); assert.deepEqual(result,{status:'UNKNOWN'});
    assert.deepEqual(w.trace,[{op:'secret',name:'WBE_GUEST_BOOKING_KEYS'}]);
  });
  await test('GI11_DISCONNECTED_GRAPH', async () => {
    const source=fs.readFileSync(path.join(ROOT,'velo/backend/guestBookingInvoiceIssuance.js'),'utf8');
    const mod=new vm.SourceTextModule(source);
    assert.deepEqual(mod.dependencySpecifiers,['wix-data','crypto','backend/guestBookingCompletionAuthority']);
    const incoming=[];
    function scan(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
      const file=path.join(dir,item.name);if(item.isDirectory()){scan(file);continue;}
      if(item.name.endsWith('.html')) {
        assert.doesNotMatch(fs.readFileSync(file,'utf8'),/guestBookingInvoiceIssuance/,'HTML incoming admission consumer');
        continue;
      }
      if(!/\.(js|jsw)$/.test(item.name))continue;
      const text=fs.readFileSync(file,'utf8');
      const name=path.relative(ROOT,file).replace(/\\/g,'/');
      if(name==='velo/backend/guestBookingInvoiceIssuance.js')continue;
      const parsed=new vm.SourceTextModule(text);
      if(name==='velo/backend/guestBookingCompletionRecovery.js') {
        assert.equal(sha(text.split(String.fromCharCode(13,10)).join(String.fromCharCode(10))),'03717d326e5ead7ac6b44674bc9b09b072a2cefb7b2038d67ef545e2b64ea098','exact recovery admission source');
        assert.deepEqual([...parsed.dependencySpecifiers],['backend/guestBookingAcceptanceDiscovery','backend/guestBookingPhysicalAcquisition','backend/guestBookingRecoveryProgressStore','backend/guestBookingInvoiceIssuance','backend/guestBookingIssuerAuthority'],'exact recovery admission edges');
      } else assert.doesNotMatch(text,/guestBookingInvoiceIssuance/,'other incoming admission consumer');
      if(parsed.dependencySpecifiers.some(s=>/guestBookingInvoiceIssuance(?:\.js)?$/.test(s)))incoming.push(name);
      assert.ok(!/import\s*\([^)]*guestBookingInvoiceIssuance/.test(text),'dynamic incoming consumer');
    }}
    scan(path.join(ROOT,'velo'));assert.deepEqual(incoming,['velo/backend/guestBookingCompletionRecovery.js']);
    const f=fixture(), {result,w}=await advance(f);
    assert.deepEqual(Object.keys(result),['status','issuanceId']);
    assert.ok(w.trace.every(t=>['find','secret','insert'].includes(t.op)));
    assert.ok(w.trace.filter(t=>t.op==='insert').every(t=>t.collection===JOURNAL));
  });
  await test('GI12_UNKNOWN_PAGE_NO_ADMISSION', async () => {
    for(const more of [undefined,null,0,'',true]){
      const f=fixture(), {result,w}=await advance(f,async e=>e.collection===JOURNAL&&e.phase==='find'?{page:{items:[],hasNext(){return more;}}}:undefined);
      assert.notEqual(result.status,'INITIAL_ISSUANCE_ADMITTED');
      assert.equal(w.trace.filter(t=>t.op==='insert').length,0,'only positively exhausted absence permits admission');
    }
  });
  await test('GI13_SDK_CANNOT_REBIND_EXPECTATION', async () => {
    const f=fixture(); let reached=false;
    const {result}=await advance(f,async e=>{if(e.phase==='input'){
      reached=true; Reflect.set(e.input,'to','redirect@example.test');
    }});
    assert.ok(reached); assert.equal(result.status,'INITIAL_ISSUANCE_ADMITTED');
    assert.equal(f.db.rows[JOURNAL][0].to,f.db.rows.GuestBookingCompletions[0].recipient);
  });
  assert.equal(new Set(cases).size,cases.length);
  assert.equal(cases.length, 13);
  console.log(JSON.stringify({completed:cases.length,cases}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
