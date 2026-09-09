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
  assert.equal(sha(bytes.toString('utf8').replace(/\r\n/g,'\n')), hashes[name]);
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
      trace.push({op:'insertAck', collection, id:row._id});
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
      assert.ok(Object.hasOwn(pins,file) || Object.hasOwn(readerPins,file) || ['backend/guestBookingInvoiceIssuance','backend/guestBookingInvoiceDelivery'].includes(name), 'closed module ' + name);
      mod = new vm.SourceTextModule(fs.readFileSync(path.join(ROOT,file),'utf8'), {context, identifier:name});
    }
    cache.set(name,mod); return mod;
  }
  async function api(name) {const mod = await load(name); if (mod.status === 'unlinked') await mod.link(spec=>load(spec)); if (mod.status === 'linked') await mod.evaluate(); return mod.namespace;}
  return {api, trace};
}

const args = f => [f.expected.acceptanceId, f.expected.operationId, f.expected.rootDigest];
async function admission(f) {
  const w=worker(f.db);
  const a=await w.api('backend/guestBookingInvoiceIssuance');
  assert.equal((await a.advanceInitialGuestInvoiceForRecoveredAcceptance(...args(f))).status,'INITIAL_ISSUANCE_ADMITTED');
}
async function call(f, operation='readIssuance', payload={}, hook) {
  const w=worker(f.db,hook);
  const a=await w.api('backend/guestBookingInvoiceDelivery');
  return {result:JSON.parse(JSON.stringify(await a.guestBookingInvoiceDeliveryOperation(...args(f),operation,payload))),trace:w.trace};
}
// Finite assertion-only closure: GDR01-GDR04. No producer setup or sends.
const cases = new Map();
const add = (id, body) => {assert.ok(!cases.has(id)); cases.set(id, body);};
const stageKey = (root, kind) => sha('wbe.guest-invoice-delivery.v1\0' + JSON.stringify([root._id,kind]));
const inserts = trace => trace.filter(t=>t.op==='insert');
const noGrant = result => assert.notEqual(result.won,true);
function unchangedExceptJournal(f, before) {
  for (const name of new Set([...Object.keys(before),...Object.keys(f.db.rows)])) {
    if (name!==JOURNAL) assert.deepEqual(f.db.rows[name],before[name],name);
  }
}
function exactAttempts(trace, id, count=1) {
  assert.deepEqual(inserts(trace),Array.from({length:count},()=>({op:'insert',collection:JOURNAL,id})));
}
function expectedStage(s, kind, payload) {
  return {_id:stageKey(s.root,kind),kind,issuanceId:s.root._id,documentDigest:s.root.projectionDigest,...payload};
}
async function setup(stage='admitted') {
  const f=fixture(); await admission(f);
  const read=await call(f); assert.equal(read.result.status,'READY');
  const root=structuredClone(read.result.root);
  const encoded=Buffer.from('inert MIME fixture, Python semantic validation tested separately').toString('base64');
  const input={encoded,mimeDigest:sha(Buffer.from(encoded,'base64')),pdfDigest:'a'.repeat(64),rendererVersion:'word'};
  const s={f,root,input};
  if(stage!=='admitted') {
    const p=await call(f,'commitArtifact',input); assert.equal(p.result.status,'READY');
    s.artifact=structuredClone(p.result.artifact);
    s.startPayload={artifactDigest:s.artifact.artifactDigest,invocationNonce:'b'.repeat(64)};
    s.ackPayload={...s.startPayload,providerMessageId:'inert-id'};
    if(stage==='started') assert.equal((await call(f,'tryStart',s.startPayload)).result.won,true);
  }
  return s;
}
// Mutate real retained rows, never substitute completion/admission return values.
function drift(f, target, dimension) {
  const row=target==='receipt'?f.db.rows.GuestBookingCompletions[0]:f.db.rows[JOURNAL][0];
  const before=structuredClone(row);
  if(dimension==='recipient') row[target==='receipt'?'recipient':'to']='different@example.test';
  else {
    const projection=JSON.parse(row.projectionCanonical);
    if(dimension==='amount') projection.summary.acceptedCalculation.totals.grandTotalCents+=1;
    else {
      assert.equal(projection.summary.acceptedCalculation.groups.length,2);
      projection.summary.acceptedCalculation.groups.reverse();
      projection.plannedBookingRows.reverse();
    }
    row.projectionCanonical=JSON.stringify(projection);
  }
  assert.notDeepEqual(row,before,'drift must change retained authority');
  return ()=>{for(const k of Object.keys(row)) delete row[k]; Object.assign(row,before);};
}
for(const operation of ['commitArtifact','tryStart','recordAck']) {
  for(const target of ['receipt','admission']) for(const dimension of ['recipient','amount','order']) {
    for(const timing of ['initial','second']) {
      add(`GDR01_${operation}_${target}_${dimension}_${timing}`,async()=>{
        const s=await setup(operation==='commitArtifact'?'admitted':operation==='tryStart'?'prepared':'started');
        const {f}=s, original=structuredClone(f.db.rows);
        let changed=0, expected;
        const mutate=()=>{drift(f,target,dimension); changed++; expected=structuredClone(f.db.rows);};
        if(timing==='initial') mutate();
        const run=await call(f,operation,operation==='commitArtifact'?s.input:operation==='tryStart'?s.startPayload:s.ackPayload,async e=>{
          if(timing==='second' && !changed && e.phase==='find' && e.collection===JOURNAL && e.predicates.some(([k,v])=>k==='_id'&&v===stageKey(s.root,'PREPARED'))) {
            // state() is reached only after the first successful authority pass.
            assert.equal(e.trace.filter(t=>t.op==='find'&&t.collection==='BookingPayments').length,1);
            mutate();
          }
        });
        assert.equal(changed,1); assert.equal(run.result.status,'UNAVAILABLE'); noGrant(run.result);
        assert.equal(inserts(run.trace).length,0); assert.deepEqual(f.db.rows,expected);
        for(const name of Object.keys(original)) if(name!==JOURNAL&&name!=='GuestBookingCompletions') assert.deepEqual(f.db.rows[name],original[name]);
        if(target==='admission') assert.deepEqual(f.db.rows.GuestBookingCompletions,original.GuestBookingCompletions);
      });
    }
  }
}
for(const target of ['receipt','admission']) for(const dimension of ['recipient','amount','order']) {
  add(`GDR01_postStart_${target}_${dimension}`,async()=>{
    const s=await setup('prepared'), before=structuredClone(s.f.db.rows);
    const start=expectedStage(s,'START',s.startPayload); let restore, expected;
    const run=await call(s.f,'tryStart',s.startPayload,async e=>{
      if(e.phase==='afterInsert'&&e.row.kind==='START') {restore=drift(s.f,target,dimension); expected=structuredClone(s.f.db.rows);}
    });
    assert.equal(typeof restore,'function'); assert.equal(run.result.status,'OWNER_REVIEW_REQUIRED'); noGrant(run.result);
    exactAttempts(run.trace,start._id); assert.deepEqual(s.f.db.rows,expected);
    assert.deepEqual(s.f.db.rows[JOURNAL].filter(r=>r.kind==='START'),[start]);
    restore(); assert.deepEqual(s.f.db.rows,{...before,[JOURNAL]:[...before[JOURNAL],start]});
    const retained=structuredClone(s.f.db.rows);
    for(const op of ['readIssuance','tryStart']) {
      const retry=await call(s.f,op,op==='tryStart'?{...s.startPayload,invocationNonce:'c'.repeat(64)}:{});
      assert.equal(retry.result.status,'OWNER_REVIEW_REQUIRED'); noGrant(retry.result);
      assert.equal(inserts(retry.trace).length,0); assert.deepEqual(s.f.db.rows,retained);
    }
    unchangedExceptJournal(s.f,before);
  });
}
add('GDR01_unchanged_control',async()=>{
  const s=await setup(), before=structuredClone(s.f.db.rows);
  const p=await call(s.f,'commitArtifact',s.input); assert.equal(p.result.status,'READY');
  const payload={artifactDigest:p.result.artifact.artifactDigest,invocationNonce:'b'.repeat(64)};
  assert.equal((await call(s.f,'tryStart',payload)).result.won,true);
  assert.equal((await call(s.f,'recordAck',{...payload,providerMessageId:'inert-id'})).result.status,'PROVIDER_ACCEPTED');
  unchangedExceptJournal(s.f,before);
});
for(const fault of ['before','lostAck','unreadable','mismatch']) {
  add(`GDR02_START_${fault}`,async()=>{
    const s=await setup('prepared'), before=structuredClone(s.f.db.rows), record=expectedStage(s,'START',s.startPayload);
    let applied=false, hits=0; const native=[];
    const run=await call(s.f,'tryStart',s.startPayload,async e=>{
      if(e.phase==='beforeInsert'&&e.row.kind==='START') {native.push(structuredClone(e.row)); if(fault==='before'){hits++;throw Error('before START');}}
      if(e.phase==='afterInsert'&&e.row.kind==='START') {applied=true; if(fault==='lostAck'){hits++;throw Error('lost START acknowledgment');}}
      if(applied&&e.phase==='find'&&e.collection===JOURNAL&&e.predicates.some(([k,v])=>k==='_id'&&v===record._id)) {
        if(fault==='unreadable'){hits++;throw Error('START readback unavailable');}
        if(fault==='mismatch'){hits++;return {rows:[{...record,invocationNonce:'c'.repeat(64)}]};}
      }
    });
    assert.equal(hits,1); assert.equal(run.result.status,'OWNER_REVIEW_REQUIRED'); noGrant(run.result);
    exactAttempts(run.trace,record._id); assert.deepEqual(native,[record]);
    assert.equal(run.trace.filter(t=>t.op==='insertAck'&&t.id===record._id).length,['unreadable','mismatch'].includes(fault)?1:0);
    const expected={...before,[JOURNAL]:[...before[JOURNAL],...(fault==='before'?[]:[record])]};
    assert.deepEqual(s.f.db.rows,expected); unchangedExceptJournal(s.f,before);
    const read=await call(s.f); assert.equal(read.result.status,fault==='before'?'READY':'OWNER_REVIEW_REQUIRED');
    noGrant(read.result); assert.equal(inserts(read.trace).length,0); assert.deepEqual(s.f.db.rows,expected);
    if(fault!=='before') {
      assert.deepEqual(read.result.start,record);
      const retry=await call(s.f,'tryStart',{...s.startPayload,invocationNonce:'c'.repeat(64)});
      assert.equal(retry.result.status,'OWNER_REVIEW_REQUIRED'); noGrant(retry.result);
      assert.equal(inserts(retry.trace).length,0); assert.deepEqual(s.f.db.rows,expected);
    }
  });
}
add('GDR03_COMPETING_START_WORKERS',async()=>{
  const s=await setup('prepared'), before=structuredClone(s.f.db.rows), attempts=[];
  let arrive, release, timer;
  const both=new Promise(resolve=>{arrive=resolve;});
  const gate=new Promise((resolve,reject)=>{release=resolve;timer=setTimeout(()=>reject(Error('START barrier timeout')),10000);});
  const hook=workerId=>async e=>{
    if(e.phase==='beforeInsert'&&e.row.kind==='START') {
      attempts.push({workerId,row:structuredClone(e.row)});
      if(attempts.length===2) arrive();
      await gate;
    }
  };
  // call() constructs a distinct VM context and canonical module cache per worker.
  const payloads=[s.startPayload,{...s.startPayload,invocationNonce:'c'.repeat(64)}];
  const pending=payloads.map((p,i)=>call(s.f,'tryStart',p,hook(i)));
  try {
    await Promise.race([both,gate]);
    assert.deepEqual(s.f.db.rows,before,'neither worker inserted before release');
    assert.equal(attempts.length,2); release();
    const runs=await Promise.all(pending), records=payloads.map(p=>expectedStage(s,'START',p));
    for(let i=0;i<2;i++) {exactAttempts(runs[i].trace,records[i]._id);assert.deepEqual(attempts.find(a=>a.workerId===i).row,records[i]);}
    const winners=runs.map((r,i)=>r.result.won===true?i:-1).filter(i=>i!==-1);
    assert.equal(winners.length,1); const winner=winners[0], loser=1-winner;
    assert.equal(runs[loser].result.status,'OWNER_REVIEW_REQUIRED'); noGrant(runs[loser].result);
    assert.equal(runs[winner].result.invocationNonce,records[winner].invocationNonce);
    assert.equal(runs[winner].result.artifactDigest,records[winner].artifactDigest);
    const expected={...before,[JOURNAL]:[...before[JOURNAL],records[winner]]}; assert.deepEqual(s.f.db.rows,expected);
    assert.equal(runs.flatMap(r=>r.trace).filter(t=>t.op==='insertAck').length,1);
    for(const p of payloads) {
      const fresh=await call(s.f,'tryStart',p); assert.equal(fresh.result.status,'OWNER_REVIEW_REQUIRED');noGrant(fresh.result);
      assert.equal(inserts(fresh.trace).length,0);assert.deepEqual(s.f.db.rows,expected);
    }
    unchangedExceptJournal(s.f,before);
  } finally {clearTimeout(timer);release();await Promise.allSettled(pending);}
});
for(const fault of ['missingStart','artifact','nonce','provider']) {
  add(`GDR04_ACK_reject_${fault}`,async()=>{
    const s=await setup(fault==='missingStart'?'prepared':'started'), before=structuredClone(s.f.db.rows);
    const payload={...s.ackPayload};
    if(fault==='artifact') payload.artifactDigest='d'.repeat(64);
    if(fault==='nonce') payload.invocationNonce='c'.repeat(64);
    if(fault==='provider') payload.providerMessageId='not a valid/provider id';
    const run=await call(s.f,'recordAck',payload);assert.equal(run.result.status,'UNAVAILABLE');noGrant(run.result);
    assert.equal(inserts(run.trace).length,0);assert.deepEqual(s.f.db.rows,before);
  });
}
add('GDR04_ACK_exact_replay_conflict',async()=>{
  const s=await setup('started'), before=structuredClone(s.f.db.rows), record=expectedStage(s,'ACK',s.ackPayload);
  const run=await call(s.f,'recordAck',s.ackPayload);assert.equal(run.result.status,'PROVIDER_ACCEPTED');exactAttempts(run.trace,record._id);
  const expected={...before,[JOURNAL]:[...before[JOURNAL],record]};assert.deepEqual(s.f.db.rows,expected);assert.deepEqual(run.result.ack,record);
  for(const conflict of [false,true]) {
    const replay=await call(s.f,'recordAck',{...s.ackPayload,providerMessageId:conflict?'other-id':'inert-id'});
    assert.equal(replay.result.status,conflict?'UNAVAILABLE':'PROVIDER_ACCEPTED');
    if(!conflict) assert.deepEqual(replay.result.ack,record);
    assert.equal(inserts(replay.trace).length,0);assert.deepEqual(s.f.db.rows,expected);
  }
});
for(const fault of ['exact','unreadable','mismatch']) {
  add(`GDR04_ACK_lostAck_${fault}`,async()=>{
    const s=await setup('started'), before=structuredClone(s.f.db.rows), record=expectedStage(s,'ACK',s.ackPayload);
    let applied=false, lost=0, reconciliation=0;const native=[];
    const run=await call(s.f,'recordAck',s.ackPayload,async e=>{
      if(e.phase==='beforeInsert'&&e.row.kind==='ACK') native.push(structuredClone(e.row));
      if(e.phase==='afterInsert'&&e.row.kind==='ACK'){applied=true;lost++;throw Error('lost ACK acknowledgment');}
      if(applied&&e.phase==='find'&&e.collection===JOURNAL&&e.predicates.some(([k,v])=>k==='_id'&&v===record._id)) {
        reconciliation++;
        if(fault==='unreadable') throw Error('ACK reconciliation unavailable');
        if(fault==='mismatch') return {rows:[{...record,providerMessageId:'other-id'}]};
      }
    });
    assert.equal(lost,1);assert.equal(reconciliation,fault==='exact'?2:1);
    assert.equal(run.result.status,fault==='exact'?'PROVIDER_ACCEPTED':'UNAVAILABLE');noGrant(run.result);
    exactAttempts(run.trace,record._id);assert.deepEqual(native,[record]);assert.equal(run.trace.filter(t=>t.op==='insertAck').length,0);
    const expected={...before,[JOURNAL]:[...before[JOURNAL],record]};assert.deepEqual(s.f.db.rows,expected);unchangedExceptJournal(s.f,before);
    if(fault==='exact') assert.deepEqual(run.result.ack,record);
    for(const op of ['readIssuance','recordAck']) {
      const fresh=await call(s.f,op,op==='recordAck'?s.ackPayload:{});assert.equal(fresh.result.status,'PROVIDER_ACCEPTED');assert.deepEqual(fresh.result.ack,record);
      assert.equal(inserts(fresh.trace).length,0);assert.deepEqual(s.f.db.rows,expected);
    }
  });
}
// GDR05-GDR08: finite retained-history regressions; no producer execution.
add('GDR05_PREPARED_replay_conflict',async()=>{
  const s=await setup('prepared'), before=structuredClone(s.f.db.rows);
  for(const conflict of [false,true]) {
    const run=await call(s.f,'commitArtifact',{...s.input,pdfDigest:conflict?'d'.repeat(64):s.input.pdfDigest});
    assert.equal(run.result.status,conflict?'UNAVAILABLE':'READY');noGrant(run.result);
    if(!conflict) assert.deepEqual(run.result.artifact,s.artifact);
    assert.equal(inserts(run.trace).length,0);assert.deepEqual(s.f.db.rows,before);
  }
});
for(const fault of ['base64','mimeHash']) add(`GDR05_PREPARED_invalid_${fault}`,async()=>{
  const s=await setup(), before=structuredClone(s.f.db.rows), payload={...s.input};
  if(fault==='base64') payload.encoded+='!'; else payload.mimeDigest='d'.repeat(64);
  const run=await call(s.f,'commitArtifact',payload);
  assert.equal(run.result.status,'UNAVAILABLE');noGrant(run.result);
  assert.equal(inserts(run.trace).length,0);assert.deepEqual(s.f.db.rows,before);
});
const chainFaults=[['START','missingPrepared'],['ACK','missingStart'],
  ...['PREPARED','START','ACK'].flatMap(kind=>['issuanceId','documentDigest','artifactDigest'].map(field=>[kind,field])),
  ['ACK','invocationNonce']];
for(const [kind,fault] of chainFaults) add(`GDR05_CHAIN_${kind}_${fault}`,async()=>{
  const s=await setup('started');
  assert.equal((await call(s.f,'recordAck',s.ackPayload)).result.status,'PROVIDER_ACCEPTED');
  if(fault==='missingPrepared') s.f.db.rows[JOURNAL]=s.f.db.rows[JOURNAL].filter(r=>!['PREPARED','ACK'].includes(r.kind));
  else if(fault==='missingStart') s.f.db.rows[JOURNAL]=s.f.db.rows[JOURNAL].filter(r=>r.kind!=='START');
  else s.f.db.rows[JOURNAL].find(r=>r.kind===kind)[fault]='d'.repeat(64);
  const before=structuredClone(s.f.db.rows);
  for(const [op,payload] of [['readIssuance',{}],['commitArtifact',s.input],['tryStart',s.startPayload],['recordAck',s.ackPayload]]) {
    const run=await call(s.f,op,payload);assert.equal(run.result.status,'UNAVAILABLE');noGrant(run.result);
    assert.equal(inserts(run.trace).length,0);assert.deepEqual(s.f.db.rows,before);
  }
});
for(const operation of ['readIssuance','commitArtifact','tryStart','recordAck']) for(const fault of ['nonempty','throw','incomplete']) {
  add(`GDR06_PAYMENT_${operation}_${fault}`,async()=>{
    const s=await setup(operation==='recordAck'?'started':operation==='tryStart'?'prepared':'admitted');
    const before=structuredClone(s.f.db.rows);let hits=0;
    const payload=operation==='commitArtifact'?s.input:operation==='tryStart'?s.startPayload:operation==='recordAck'?s.ackPayload:{};
    const run=await call(s.f,operation,payload,async e=>{
      if(e.phase==='find'&&e.collection==='BookingPayments') {
        hits++;assert.equal(e.predicates.length,1);assert.equal(e.predicates[0][0],'bookingNumber');
        if(fault==='throw') throw Error('payment read unavailable');
        return fault==='nonempty'?{rows:[{_id:'inert-payment',bookingNumber:e.predicates[0][1],amount:1}]}:{page:{items:[],hasNext(){return true;}}};
      }
    });
    assert.equal(hits,1);assert.equal(run.result.status,'UNAVAILABLE');noGrant(run.result);
    assert.equal(Object.hasOwn(run.result,'payments'),false,'no fabricated empty-payment success');
    assert.equal(inserts(run.trace).length,0);assert.deepEqual(s.f.db.rows,before);
  });
}
for(const state of ['unavailable','uncertain','pending']) add(`GDR07_BOOKING_SEPARATION_${state}`,async()=>{
  const s=await setup(state==='uncertain'?'started':'admitted');
  assert.ok(s.f.db.rows.Bookings.length>0);assert.ok(s.f.db.rows.GuestBookingCompletions.length>0);
  // Pending seam: remove completion receipt from retained history, not a fabricated API result.
  if(state==='pending') s.f.db.rows.GuestBookingCompletions=[];
  const before=structuredClone(s.f.db.rows);
  for(const [op,payload] of [['readIssuance',{}],['commitArtifact',s.input],['tryStart',s.startPayload||{artifactDigest:'a'.repeat(64),invocationNonce:'b'.repeat(64)}],['recordAck',s.ackPayload||{artifactDigest:'a'.repeat(64),invocationNonce:'b'.repeat(64),providerMessageId:'inert-id'}]]) {
    const run=await call(s.f,op,state==='uncertain'&&op==='recordAck'?{...payload,invocationNonce:'c'.repeat(64)}:payload,async e=>{if(state==='unavailable'&&e.phase==='find'&&e.collection==='BookingPayments') throw Error('unavailable payment history');});
    assert.equal(run.result.status,state==='uncertain'&&op!=='recordAck'?'OWNER_REVIEW_REQUIRED':'UNAVAILABLE');
    noGrant(run.result);unchangedExceptJournal(s.f,before);
    assert.equal(inserts(run.trace).length,0);assert.deepEqual(s.f.db.rows,before);
  }
});
const deliveryEdges={
  'velo/backend/guestBookingInvoiceDelivery.js':['wix-data','crypto','backend/guestBookingCompletionAuthority'],
  'velo/backend/guestBookingInvoiceIssuance.js':['wix-data','crypto','backend/guestBookingCompletionAuthority']
};
const deliveryPins={
  'velo/backend/guestBookingInvoiceDelivery.js':'b5e27047f870a38a9aaddb13b63deca711775c69bfbcb9edee057f1e20d54ea2',
  'velo/backend/guestBookingInvoiceIssuance.js':'797933fb958b1f6ecebd51e7a6ab87048b518d8993d26bf00c56b5a46919f681'
};
function sourceEdges(text) {return [...new vm.SourceTextModule(text).dependencySpecifiers];}
const scanExtension=file=>/\.(?:js|jsw|html)$/i.test(file);
function incoming(file,text) {
  file=file.replace(/\\/g,'/');
  if(!scanExtension(file)||Object.hasOwn(deliveryEdges,file)) return;
  if(file==='velo/backend/guestBookingCompletionRecovery.js') {
    assert.equal(sha(text.split(String.fromCharCode(13,10)).join(String.fromCharCode(10))),'03717d326e5ead7ac6b44674bc9b09b072a2cefb7b2038d67ef545e2b64ea098','exact recovery admission source');
    assert.deepEqual(sourceEdges(text),['backend/guestBookingAcceptanceDiscovery','backend/guestBookingPhysicalAcquisition','backend/guestBookingRecoveryProgressStore','backend/guestBookingInvoiceIssuance','backend/guestBookingIssuerAuthority'],'exact recovery admission edges');
    return; // Hash-bound admission only; never a recovery -> delivery exemption.
  }
  // Conservative lexical guard also catches dynamic imports, require, reexports and HTML references.
  assert.doesNotMatch(text,/guestBookingInvoice(?:Delivery|Issuance)/,'incoming delivery/admission consumer '+file);
}
function graphRegression() {
  const allPins={...pins,...canonicalPins,...readerPins,...deliveryPins}, visited=new Set();
  function visit(file) {
    if(visited.has(file)) return;visited.add(file);
    assert.ok(Object.hasOwn(allPins,file),'exact dependency pin '+file);
    const text=fs.readFileSync(path.join(ROOT,file),'utf8').replace(/\r\n/g,'\n');
    assert.equal(sha(text),allPins[file],file);
    assert.doesNotMatch(text,/\b(?:import\s*\(|require\s*\()/,'no dynamic dependency '+file);
    const edges=sourceEdges(text);
    if(Object.hasOwn(deliveryEdges,file)) assert.deepEqual(edges,deliveryEdges[file],file+' exact edges');
    for(const edge of edges) {
      if(edge.startsWith('backend/')) {assert.match(edge,/^backend\/[A-Za-z0-9]+$/);visit('velo/'+edge+'.js');}
      else assert.ok(['wix-data','wix-auth','buffer','crypto','wix-secrets-backend.v2'].includes(edge),'SDK edge '+edge);
    }
  }
  Object.keys(deliveryEdges).forEach(visit);
  function walk(dir) {for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
    const full=path.join(dir,e.name);
    if(e.isDirectory()) walk(full);else if(scanExtension(e.name)) incoming(path.relative(ROOT,full).replace(/\\/g,'/'),fs.readFileSync(full,'utf8'));
  }}
  walk(path.join(ROOT,'velo'));
  for(const ext of ['js','web.js','jsw','html']) {
    const file='velo/backend/recovery-probe.'+ext;
    const forbidden="import { guestBookingInvoiceDeliveryOperation as op } from 'backend/guestBookingInvoiceDelivery'; export const recover = op;";
    const benign="import { readRecoveredGuestBookingCompletion as read } from 'backend/guestBookingCompletionAuthority'; export const observe = read;";
    assert.deepEqual(sourceEdges(forbidden),['backend/guestBookingInvoiceDelivery']);
    assert.deepEqual(sourceEdges(benign),['backend/guestBookingCompletionAuthority']);
    assert.throws(()=>incoming(file,forbidden),/incoming delivery\/admission consumer/);
    assert.doesNotThrow(()=>incoming(file,benign));
    assert.throws(()=>incoming(file,"export * from 'backend/guestBookingInvoiceIssuance';"),/incoming delivery\/admission consumer/);
    if(ext==='jsw') {
      assert.equal(/\.(?:js|html)$/i.test(file),false,'old filter omits parser-valid jsw consumer');
      assert.equal(scanExtension(file),true,'new filter reverses omission');
    }
  }
  for(const [file,edges] of Object.entries(deliveryEdges)) {
    const text=fs.readFileSync(path.join(ROOT,file),'utf8');
    assert.throws(()=>assert.deepEqual(sourceEdges(text+"\nimport 'backend/guestBookingRecovery';"),edges),assert.AssertionError);
  }
}
add('GDR08_DISCONNECTED_GRAPH_REGRESSION',async()=>graphRegression());
async function main(){
  const selected=process.argv[3];
  assert.equal(process.argv[2],'--delivery');
  assert.ok(process.argv.length===3 || (process.argv.length===4&&cases.has(selected)),'finite --delivery [exact case ID] only');
  graphRegression(); // Compile/read-only dependency admission before any backend evaluation.
  if(selected) {await cases.get(selected)(); console.log('PASS '+selected); return;}
  const f=fixture(); await admission(f);
  assert.ok(fs.existsSync(path.join(ROOT,'velo/backend/guestBookingInvoiceDelivery.js')),'guest delivery consumer must exist');
  const before=structuredClone(f.db.rows);
  const {result,trace}=await call(f);
  assert.equal(result.status,'READY');
  assert.equal(result.root._id,f.db.rows[JOURNAL][0]._id);
  assert.deepEqual(result.root,f.db.rows[JOURNAL][0]);
  assert.deepEqual(result.payments,[]);
  assert.equal(result.artifact,null);
  assert.deepEqual(f.db.rows,before);
  assert.ok(trace.every(t=>t.op!=='insert'));
  console.log('PASS GD01_READ_ACTUAL_ADMISSION');
  const encoded=Buffer.from('inert MIME fixture, Python semantic validation tested separately').toString('base64');
  const artifact={encoded,mimeDigest:sha(Buffer.from(encoded,'base64')),pdfDigest:'a'.repeat(64),rendererVersion:'word'};
  const prepared=await call(f,'commitArtifact',artifact);
  assert.equal(prepared.result.status,'READY');
  assert.equal(prepared.result.artifact.encoded,encoded);
  assert.equal(prepared.result.artifact.issuanceId,result.root._id);
  const expectedArtifact=expectedStage({root:result.root},'PREPARED',{
    ...artifact,artifactDigest:sha('wbe.guest-invoice-artifact.v1\0'+JSON.stringify([result.root._id,result.root.projectionDigest,artifact.mimeDigest,artifact.pdfDigest,artifact.rendererVersion]))
  });
  assert.deepEqual(prepared.result.artifact,expectedArtifact);exactAttempts(prepared.trace,expectedArtifact._id);
  const preparedRows={...before,[JOURNAL]:[...before[JOURNAL],expectedArtifact]};
  assert.deepEqual(f.db.rows,preparedRows);
  const preparedRead=await call(f);assert.equal(preparedRead.result.status,'READY');noGrant(preparedRead.result);
  assert.deepEqual(preparedRead.result.artifact,expectedArtifact);assert.equal(inserts(preparedRead.trace).length,0);assert.deepEqual(f.db.rows,preparedRows);
  const start=await call(f,'tryStart',{artifactDigest:prepared.result.artifact.artifactDigest,invocationNonce:'b'.repeat(64)});
  assert.equal(start.result.won,true);
  assert.equal(start.result.invocationNonce,'b'.repeat(64));
  const expectedStart=expectedStage({root:result.root},'START',{artifactDigest:expectedArtifact.artifactDigest,invocationNonce:'b'.repeat(64)});
  exactAttempts(start.trace,expectedStart._id);
  const startedRows={...before,[JOURNAL]:[...preparedRows[JOURNAL],expectedStart]};assert.deepEqual(f.db.rows,startedRows);
  for(const op of ['readIssuance','tryStart']) {
    const fresh=await call(f,op,op==='tryStart'?{artifactDigest:expectedArtifact.artifactDigest,invocationNonce:'c'.repeat(64)}:{});
    assert.equal(fresh.result.status,'OWNER_REVIEW_REQUIRED');noGrant(fresh.result);assert.deepEqual(fresh.result.start,expectedStart);
    assert.equal(inserts(fresh.trace).length,0);assert.deepEqual(f.db.rows,startedRows);unchangedExceptJournal(f,before);
  }
  assert.equal((await call(f,'tryStart',{artifactDigest:prepared.result.artifact.artifactDigest,invocationNonce:'c'.repeat(64)})).result.status,'OWNER_REVIEW_REQUIRED');
  assert.equal((await call(f)).result.status,'OWNER_REVIEW_REQUIRED');
  const ack=await call(f,'recordAck',{artifactDigest:prepared.result.artifact.artifactDigest,invocationNonce:'b'.repeat(64),providerMessageId:'inert-id'});
  assert.equal(ack.result.status,'PROVIDER_ACCEPTED');
  const replay=await call(f);
  assert.equal(replay.result.status,'PROVIDER_ACCEPTED');
  assert.equal(replay.trace.filter(t=>t.op==='insert').length,0);
  const expectedAck=expectedStage({root:result.root},'ACK',{artifactDigest:expectedArtifact.artifactDigest,invocationNonce:'b'.repeat(64),providerMessageId:'inert-id'});
  exactAttempts(ack.trace,expectedAck._id);assert.deepEqual(ack.result.ack,expectedAck);assert.deepEqual(replay.result.ack,expectedAck);
  const acceptedRows={...before,[JOURNAL]:[...startedRows[JOURNAL],expectedAck]};assert.deepEqual(f.db.rows,acceptedRows);
  for(const op of ['readIssuance','tryStart']) {
    const fresh=await call(f,op,op==='tryStart'?{artifactDigest:expectedArtifact.artifactDigest,invocationNonce:'c'.repeat(64)}:{});
    assert.equal(fresh.result.status,'PROVIDER_ACCEPTED');noGrant(fresh.result);assert.deepEqual(fresh.result.ack,expectedAck);
    assert.equal(inserts(fresh.trace).length,0);assert.deepEqual(f.db.rows,acceptedRows);unchangedExceptJournal(f,before);
  }
  console.log('PASS GD02_PREPARED_START_ACK_RESTART');
  for(const [id,body] of cases) {await body();console.log('PASS '+id);}
}
async function bridge(){
  const f=fixture(); await admission(f);
  console.log(JSON.stringify({issuanceId:f.db.rows[JOURNAL][0]._id}));
  const lines=require('node:readline').createInterface({input:process.stdin});
  for await (const line of lines){
    const request=JSON.parse(line);
    const value=await call(f,request.operation,request.payload||{});
    console.log(JSON.stringify(value));
  }
}
if(process.argv[2]==='--bridge' && process.argv.length===3) bridge().catch(e=>{console.error(e);process.exitCode=1;});
else main().catch(e=>{console.error(e);process.exitCode=1;});
