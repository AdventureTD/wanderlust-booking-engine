'use strict';
// Local SDK/platform-authentication fixture only: no hosted Wix or network proof.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const rows = new Map();
const trace = [];
let role = 'Admin';
let actor = 'fixture-admin';
let failRoot = false;
let loseRequestAck = false;
let loseRootAck = false;
let insertHook = null;
let getHook = null;
let queryHook = null;
let bridgeSecrets = false;
let dispatchFetch = null;
const externalTrace = [];

// Traverse actual production consumers; parse fixtures in exactly the same gate.
function incomingExclusions(files, oldFilter = false) {
  const seen = [];
  for (const [filename, source] of files) {
    if (!(oldFilter ? /\.js$/ : /\.(?:js|jsw)$/).test(filename)) continue;
    seen.push(filename);
    const module = new vm.SourceTextModule(source, { identifier: filename });
    if (['velo/backend/issueInvoice.web.js', 'velo/backend/http-functions.js',
         'velo/backend/invoiceEmailJournal.js'].includes(filename)) continue;
    assert.ok(!/\b(?:prepareOwnerInvoiceDispatch|dispatchOwnerInvoice|getOwnerInvoiceDispatch|listOwnerInvoiceReviews|invoiceEmailJournal|post_invoiceEmailJournal)\b/.test(source),
      `forbidden journal consumer: ${filename}`);
    for (const dependency of module.dependencySpecifiers) {
      if (/issueInvoice(?:\.web)?(?:\.js)?$/.test(dependency)) {
        assert.match(source, /import\s*\{\s*issueInvoice(?:\s+as\s+\w+)?\s*\}\s*from\s*['"]backend\/issueInvoice(?:\.web)?['"]/, filename);
        assert.ok(!/import\s*\(|export\s*\*/.test(source), `indirect invoice consumer: ${filename}`);
      }
    }
  }
  return seen;
}
function verifyIncomingExclusions() {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const filename = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(filename);
      else if (/\.(?:js|jsw)$/.test(filename)) files.push([filename, fs.readFileSync(path.join(root, filename), 'utf8')]);
    }
  }
  walk('velo');
  assert.equal(incomingExclusions(files).length, files.length);
  for (const extension of ['js', 'web.js', 'jsw']) {
    const filename = `velo/backend/inert-consumer.${extension}`;
    const forbidden = [[filename, "import { prepareOwnerInvoiceDispatch as mint } from 'backend/issueInvoice.web'; export const call = mint;"]];
    assert.throws(() => incomingExclusions(forbidden), /forbidden journal consumer/);
    assert.deepEqual(incomingExclusions([[filename, "import { issueInvoice as legacy } from 'backend/issueInvoice.web'; export const call = legacy;"]]), [filename]);
    if (extension === 'jsw') assert.deepEqual(incomingExclusions(forbidden, true), [], 'old JS-only filter misses forbidden JSW');
  }
  console.log(`PASS N2 incoming exclusions: ${files.length} actual JS/web.js/JSW files; forbidden/legacy-alias controls`);
}
const clone = value => JSON.parse(JSON.stringify(value));
async function load(enabled = true, entry = 'entry') {
  const context = vm.createContext({ Buffer, console });
  const modules = new Map();
  const synthetic = (name, exports) => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context, identifier: name });
  const fixtures = {
    'wix-web-module': { Permissions: { Admin: 'Admin' }, webMethod: (permission, callback) => async (...args) => {
      assert.equal(permission, 'Admin');
      if (role !== 'Admin') throw new Error('platform_denied');
      return callback(...args);
    } },
    'wix-users-backend': { currentUser: { get id() { return actor; } } },
    'wix-fetch': { fetch: (...args) => { externalTrace.push(['fetch', ...args]); if (dispatchFetch) return dispatchFetch(...args); throw new Error('NETWORK_DENIED'); } },
    'wix-secrets-backend': { getSecret: name => { externalTrace.push(['secret', name]); if (dispatchFetch && name === 'WBE_INVOICE_SERVICE_URL') return 'https://fixture.invalid'; if (process.env.ENDPOINT_FIXTURE || bridgeSecrets || dispatchFetch) return 'fixture-only'; throw new Error('SECRET_DENIED'); } },
    'wix-http-functions': { response: value => value },
    'backend/settings.web': { getAllSettings: () => { throw new Error('SETTINGS_DENIED'); } },
    crypto: { createHash: crypto.createHash, timingSafeEqual: crypto.timingSafeEqual },
    'wix-data': { default: {
      query(collection) {
        assert.equal(collection, 'InvoiceEmailJournal');
        let cursor = null;
        const q = {
          eq(k, v) { assert.equal(k, 'kind'); assert.equal(v, 'ISSUANCE'); return q; },
          ascending(k) { assert.equal(k, '_id'); return q; },
          limit(n) { assert.equal(n, 2); return q; },
          gt(k, v) { assert.equal(k, '_id'); cursor = v; return q; },
          async find(options) {
            assert.deepEqual(clone(options), {suppressAuth:true,suppressHooks:true,consistentRead:true});
            trace.push(['query', collection, cursor]);
            const all = [...rows.values()].filter(r => r.kind === 'ISSUANCE' && (cursor === null || r._id > cursor)).sort((a,b) => a._id.localeCompare(b._id));
            const page = {items: clone(all.slice(0,2)), hasNext: () => all.length > 2};
            return queryHook ? queryHook(page) : page;
          }
        }; return q;
      },
      async insert(collection, record, options) {
        trace.push(['insert', collection, record._id]);
        assert.equal(collection, 'InvoiceEmailJournal');
        assert.deepEqual(clone(options), { suppressAuth: true, suppressHooks: true });
        if (failRoot && record.kind === 'ISSUANCE') throw new Error('fixture_root_offline');
        if (rows.has(record._id)) throw new Error('duplicate');
        rows.set(record._id, clone(record));
        if (insertHook) await insertHook(record);
        if (loseRootAck && record.kind === 'ISSUANCE') throw new Error('fixture_root_lost_ack');
        if (loseRequestAck && record.kind === 'REQUEST') throw new Error('fixture_lost_ack');
        return clone(record);
      },
      async get(collection, id, options) {
        trace.push(['get', collection, id]);
        assert.equal(collection, 'InvoiceEmailJournal');
        assert.equal(options.consistentRead, true);
        if (getHook) return getHook(id);
        return rows.has(id) ? clone(rows.get(id)) : null;
      },
    } },
  };
  async function resolve(name) {
    if (modules.has(name)) return modules.get(name);
    let module;
    if (fixtures[name]) module = synthetic(name, fixtures[name]);
    else {
      const filename = name === 'entry' ? 'velo/backend/issueInvoice.web.js' : `${name.replace(/^backend\//, 'velo/backend/')}.js`;
      let source = fs.readFileSync(path.join(root, filename), 'utf8');
      // Only activation is substituted. No validator, authority or writer is replaced.
      if (enabled) source = source.replace('const OWNER_INVOICE_JOURNAL_ENABLED = false;', 'const OWNER_INVOICE_JOURNAL_ENABLED = true;');
      module = new vm.SourceTextModule(source, { context, identifier: filename });
    }
    modules.set(name, module);
    await module.link(resolve);
    return module;
  }
  const module = await resolve(entry);
  await module.evaluate();
  return module.namespace;
}
const command = {
  requestId: '12345678-1234-4234-8234-123456789abc',
  revision: '22345678-1234-4234-8234-123456789abc',
  invoiceNumber: 'TEST-OWNER-1', issueDate: '2026-09-07',
  guest: { name: 'Fixture Guest', email: 'guest@example.invalid', phone: '1234567890' },
  checkIn: '2026-10-01', checkOut: '2026-10-02', roomCode: 'Fixture',
  purpose: 'guest_invoice', payments: [],
  financial: { currency: 'USD', components: { grossCents: 10000, discountCents: 0, roomTotalCents: 10000,
    propertyFeeCents: 500, accommodationVatCents: 1000, packageVatCents: 0, totalVatCents: 1000, grandTotalCents: 11500 },
    lines: [{ label: 'Fixture room', taxClass: 'accommodation', quantity: 1, roomQuantity: 1,
      unitPriceCents: 10000, netCents: 10000, vatCents: 1000, grossCents: 11000, vatRateBasisPoints: 1000 }] },
};
(async () => {
  if (process.env.ENDPOINT_FIXTURE) {
    const file = process.env.ENDPOINT_FIXTURE;
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      saved.rows.forEach(row => rows.set(row._id, row));
      trace.push(...saved.trace);
    }
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    // Inert persistence-boundary failures, after actual native fixture insertion.
    let insertedStart = false;
    insertHook = async record => {
      if (record.kind !== 'START') return;
      insertedStart = true;
      if (process.env.ENDPOINT_FAULT === 'start_insert_ack_loss') throw new Error('inert_insert_ack_loss');
    };
    getHook = async id => {
      const record = rows.get(id);
      if (insertedStart && record?.kind === 'START' && process.env.ENDPOINT_FAULT === 'start_readback_loss') {
        throw new Error('inert_readback_loss');
      }
      return record ? clone(record) : null;
    };
    let result;
    if (input.fixture === 'prepare') {
      result = await (await load()).prepareOwnerInvoiceDispatch(clone(command));
    } else if (input.fixture === 'status' || input.fixture === 'dispatch-retained') {
      const api = await load();
      const before = trace.length;
      result = await api[input.fixture === 'status' ? 'getOwnerInvoiceDispatch' : 'dispatchOwnerInvoice'](input.issuanceId);
      assert.ok(trace.slice(before).every(call => call[0] === 'get'));
      assert.deepEqual(externalTrace, [], 'retained status/dispatch never wakes sender or reads secrets');
    } else {
      const api = await load(true, 'backend/http-functions');
      const response = await api.post_invoiceEmailJournal({headers: {'x-wbe-secret': 'fixture-only'}, body: {text: async () => JSON.stringify(input)}});
      assert.equal(response.status, Number(process.env.ENDPOINT_EXPECT_STATUS || 200), response.body);
      result = JSON.parse(response.body);
    }
    fs.writeFileSync(file, JSON.stringify({rows: [...rows.values()], trace}));
    console.log(JSON.stringify(result));
    return;
  }
  verifyIncomingExclusions();
  bridgeSecrets = true;
  const bridge = await load(true, 'backend/http-functions');
  for (const supplied of [undefined, '', 'wrong']) {
    const before = trace.length;
    const response = await bridge.post_invoiceEmailJournal({ headers: {'x-wbe-secret': supplied},
      body: { text: async () => { throw new Error('unauthenticated_body_read'); } } });
    assert.equal(response.status, 401);
    assert.deepEqual(trace.slice(before), []);
    assert.equal(rows.size, 0);
  }
  const invalidBridgeBodies = ['REQUEST', 'ISSUANCE', 'insert', 'update', 'remove', 'save', 'prepareOwnerIssuance'].map(operation =>
    ({operation, issuanceId: 'a'.repeat(64), payload: {}}));
  invalidBridgeBodies.push({operation: 'readIssuance', issuanceId: 'a'.repeat(64), payload: {}, callbackUrl: 'https://forbidden.invalid'},
    {operation: 'insert', collection: 'Bookings', payload: {kind: 'ISSUANCE'}});
  for (const body of invalidBridgeBodies) {
    const before = trace.length;
    const response = await bridge.post_invoiceEmailJournal({headers: {'x-wbe-secret': 'fixture-only'},
      body: {text: async () => JSON.stringify(body)}});
    assert.equal(response.status, 409);
    assert.deepEqual(trace.slice(before), [], 'forbidden bridge command has zero SDK IO');
    assert.equal(rows.size, 0);
  }
  bridgeSecrets = false;
  console.log('PASS N2 actual HTTP bridge: missing/wrong authentication and forbidden creation/write/callback commands, zero SDK IO');
  const api = await load();
  assert.equal(typeof api.listOwnerInvoiceReviews, 'function', 'R1 missing actual Admin list export');
  assert.equal(typeof api.prepareOwnerInvoiceDispatch, 'function', 'missing actual Admin durable prepare export');
  {
  rows.clear();
  const queueRoot = await api.prepareOwnerInvoiceDispatch(clone(command));
  const queueBefore = [trace.length, externalTrace.length];
  const page = clone(await api.listOwnerInvoiceReviews(null));
  assert.equal(page.protocol, 'owner-invoice-review-page/v1');
  assert.equal(page.snapshot, false);
  assert.equal(page.cycleEndObserved, true);
  assert.equal(page.items[0].issuanceId, queueRoot.issuanceId);
  assert.equal(page.items[0].classification, 'pending_prestart');
  assert.ok(trace.slice(queueBefore[0]).every(t => ['get','query'].includes(t[0])));
  assert.equal(externalTrace.length, queueBefore[1]);
  for (const bad of [undefined, [], {}, new String('a'.repeat(64)), 'A'.repeat(64)]) {
    const before = trace.length;
    await assert.rejects(() => api.listOwnerInvoiceReviews(bad), /owner_invoice_/);
    assert.equal(trace.length, before);
  }
  await assert.rejects(() => api.listOwnerInvoiceReviews(null, {}), /cursor/);
  for (const denied of ['Anonymous','Member']) {
    role = denied; const before = trace.length;
    await assert.rejects(() => api.listOwnerInvoiceReviews(null), /platform_denied/);
    assert.equal(trace.length, before);
  }
  role = 'Admin'; actor = '';
  await assert.rejects(() => api.listOwnerInvoiceReviews(null), /actor/);
  actor = 'other-admin';
  await assert.rejects(() => (async () => (await load(false)).listOwnerInvoiceReviews(null))(), /disabled/);
  assert.equal((await api.listOwnerInvoiceReviews(null)).items[0].issuanceId, queueRoot.issuanceId);
  actor = 'fixture-admin';
  assert.deepEqual(Object.keys(page.items[0]).sort(), ['classification','invoiceNumber','issuanceId','needsOwnerReview','purpose','revision','status']);
  for (let index = 0; index < 3; index++) {
    const c = clone(command); c.invoiceNumber = 'QUEUE-' + index; c.requestId = crypto.randomUUID();
    await api.prepareOwnerInvoiceDispatch(c);
  }
  const first = clone(await api.listOwnerInvoiceReviews(null));
  const second = clone(await api.listOwnerInvoiceReviews(first.nextCursor));
  assert.equal(first.items.length, 2); assert.equal(first.cycleEndObserved, false);
  assert.equal(second.items.length, 2); assert.equal(second.cycleEndObserved, true);
  assert.equal(second.nextCursor, null);
  assert.ok(first.items[1].issuanceId < second.items[0].issuanceId);
  assert.equal((await api.listOwnerInvoiceReviews('f'.repeat(64))).items.length, 0);
  for (const mutate of [p => ({...p, hasNext: () => 'yes'}), p => ({items: [], hasNext: () => true}),
    p => ({...p, items: [p.items[0],p.items[0]]}), p => ({...p, items: p.items.slice().reverse()}),
    p => ({...p, items: [{_id: ['a'.repeat(64)],kind:'ISSUANCE'}]}), () => {throw Error('PRIVATE');}]) {
    queryHook = mutate;
    const bad = clone(await api.listOwnerInvoiceReviews(null));
    assert.equal(bad.scanStatus, 'unavailable'); assert.equal(bad.nextCursor, null);
    assert.deepEqual(bad.items, []); assert.equal(bad.cycleEndObserved, false);
  }
  queryHook = null;
  const brokenId = first.items[0].issuanceId;
  const savedRoot = clone(rows.get(brokenId)); rows.get(brokenId).documentDigest = '0'.repeat(64);
  const partial = clone(await api.listOwnerInvoiceReviews(null));
  assert.equal(partial.scanStatus, 'partial'); assert.equal(partial.items.length, 2);
  assert.deepEqual(Object.keys(partial.items[0]).sort(), ['classification','issuanceId','needsOwnerReview','reason','status']);
  assert.equal(partial.items[0].classification, 'unresolved');
  rows.set(brokenId, savedRoot);
  for (const value of [undefined, null]) {
    getHook = id => id === brokenId ? value : (rows.has(id) ? clone(rows.get(id)) : null);
    assert.equal((await api.listOwnerInvoiceReviews(null)).scanStatus, 'partial');
  }
  getHook = null;
  // Behind-cursor concurrent insertion is found after reset, not a snapshot.
  let behind;
  for (let i=0; i<100 && !behind; i++) {
    const c = clone(command); c.invoiceNumber = 'LATE-' + i; c.requestId = crypto.randomUUID();
    const r = await api.prepareOwnerInvoiceDispatch(c);
    if (r.issuanceId < first.nextCursor) behind = r.issuanceId;
  }
  assert.ok(behind);
  const continuation = await api.listOwnerInvoiceReviews(first.nextCursor);
  assert.equal(continuation.snapshot, false);
  let cursor = null, found = false;
  do { const p = await api.listOwnerInvoiceReviews(cursor); found ||= p.items.some(i => i.issuanceId === behind); cursor = p.nextCursor; } while (cursor);
  assert.ok(found);
  rows.clear();
  console.log('PASS R1-R6 bounded queue auth/privacy/keyset/quarantine/reset controls (durable effect histories in Python)');
  }
  // Finite R2-R6 coverage additions: actual writers and Admin reads, baseline-GREEN.
  {
    const covered = [];
    const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    const key = (ns, id) => sha(JSON.stringify([ns, id]));
    const journal = await load(true, 'backend/invoiceEmailJournal');
    const op = (operation, issuanceId, payload) => journal.invoiceJournalOperation({operation, issuanceId, payload});
    const restore = saved => { rows.clear(); for (const [id, value] of JSON.parse(saved)) rows.set(id, value); };
    async function observed(expected, id) {
      const before = trace.length, outside = externalTrace.length, stored = JSON.stringify([...rows]);
      const fresh = await load();
      const page = clone(await fresh.listOwnerInvoiceReviews(null));
      const detail = clone(await fresh.getOwnerInvoiceDispatch(id));
      const item = page.items.find(i => i.issuanceId === id);
      assert.ok(item, 'actual queried root visible');
      for (const result of [item, detail]) {
        assert.equal(result.classification, expected);
        assert.equal(result.needsOwnerReview, ['start_uncertain','unresolved'].includes(expected));
        const fields = expected === 'unresolved' ? ['classification','issuanceId','needsOwnerReview','reason','status'] :
          ['classification','invoiceNumber','issuanceId','needsOwnerReview','purpose','revision','status'];
        if (result === detail && expected === 'ack_provider_accepted') fields.push('providerMessageId');
        assert.deepEqual(Object.keys(result).sort(), fields.sort());
      }
      assert.deepEqual(Object.keys(page).sort(), ['cycleEndObserved','items','nextCursor','protocol','scanStatus','snapshot']);
      assert.equal(page.scanStatus, expected === 'unresolved' ? 'partial' : 'ok');
      assert.equal(page.snapshot, false);
      assert.ok(trace.slice(before).every(t => ['get','query'].includes(t[0])), 'read paths zero mutations');
      assert.equal(externalTrace.length, outside, 'read paths zero secret/service/provider IO');
      assert.equal(JSON.stringify([...rows]), stored);
      assert.ok(!JSON.stringify([page, detail]).includes('PRIVATE_CORRUPTION'));
      return {page, detail};
    }
    async function artifact(id, bytes) {
      const rootRow = rows.get(id), encoded = bytes.toString('base64'), chunkIds = [];
      for (let offset = 0; offset < encoded.length; offset += 100000) {
        const data = encoded.slice(offset, offset + 100000), digest = sha(Buffer.from(data, 'base64'));
        const chunk = {_id:key('invoice-artifact-chunk/v1',digest),kind:'ARTIFACT_CHUNK',data,digest};
        await op('putChunk', id, chunk); chunkIds.push(chunk._id);
      }
      const manifest = {_id:key('invoice-artifact/v1',id),kind:'ARTIFACT',issuanceId:id,
        documentDigest:rootRow.documentDigest,to:rootRow.to,cc:rootRow.cc,from:rootRow.from,
        chunkIds,mimeDigest:sha(bytes),byteLength:bytes.length,pdfDigest:sha('inert PDF'),rendererVersion:'queue-fixture/v1'};
      const state = await op('commitArtifact',id,manifest);
      assert.equal(state.artifact.byteLength,bytes.length);
      return state;
    }
    rows.clear(); bridgeSecrets = true;
    const scanBridge = await load(true, 'backend/http-functions');
    const request = body => ({headers:{'x-wbe-secret':'fixture-only'},body:{text:async()=>JSON.stringify(body)}});
    const mixed = [
      {operation:'scanPending',cursor:null,issuanceId:'a'.repeat(64)},
      {operation:'scanPending',cursor:null,payload:{}},
      {operation:'readIssuance',issuanceId:'a'.repeat(64),payload:{},cursor:null},
      ...['query','collection','url','limit','unknown'].map(k=>({operation:'scanPending',cursor:null,[k]:'PRIVATE_CORRUPTION'}))
    ];
    for (const body of mixed) {
      const before = trace.length;
      const response = await scanBridge.post_invoiceEmailJournal(request(body));
      assert.equal(response.status,409); assert.equal(response.headers['Cache-Control'],'no-store');
      assert.equal(trace.length,before); assert.equal(rows.size,0);
    }
    for (const bad of [new String('a'.repeat(64)), [], {}, undefined]) {
      const before=trace.length;
      await assert.rejects(()=>journal.invoiceJournalOperation({operation:'scanPending',cursor:bad}),/owner_invoice_/);
      assert.equal(trace.length,before);
    }
    for (const enabled of [true,false]) {
      const response = await (await load(enabled,'backend/http-functions')).post_invoiceEmailJournal(request({operation:'scanPending',cursor:null}));
      assert.equal(response.status,enabled?200:503); assert.equal(response.headers['Cache-Control'],'no-store');
    }
    const unauthorized = await scanBridge.post_invoiceEmailJournal({headers:{},body:{text:async()=>{throw Error('must not read');}}});
    assert.equal(unauthorized.status,401); assert.equal(unauthorized.headers['Cache-Control'],'no-store');
    queryHook=()=>{throw Error('PRIVATE_CORRUPTION');};
    const unavailable=await scanBridge.post_invoiceEmailJournal(request({operation:'scanPending',cursor:null}));
    assert.equal(unavailable.headers['Cache-Control'],'no-store');
    assert.equal(JSON.parse(unavailable.body).scanStatus,'unavailable');
    queryHook=null; bridgeSecrets=false;
    covered.push('R2.mixed-variants-zero-sdk','R2.no-store-success-denial-unavailable');
    const rootResult=await api.prepareOwnerInvoiceDispatch(clone(command)), id=rootResult.issuanceId;
    await observed('pending_prestart',id);
    const prepared=await artifact(id,Buffer.from('PRIVATE_CORRUPTION inert MIME bytes'));
    await observed('pending_prestart',id);
    covered.push('R3.artifact-only-actual-writer-list-detail');
    const grant=await op('tryStart',id,{artifactDigest:prepared.artifactDigest,workerBootId:'queue-boot',invocationNonce:'queue-nonce'});
    assert.equal(grant.won,true);
    const provisional=await observed('start_uncertain',id);
    assert.equal(provisional.detail.status,'owner_review_required');
    assert.ok(![...rows.values()].some(r=>['PREP_FAILURE','UNCERTAIN'].includes(r.kind)));
    const startId=key('invoice-send-start/v1',id), ackId=key('invoice-send-ack/v1',id);
    const beforeWrong=JSON.stringify([...rows]);
    await assert.rejects(()=>op('recordAck',id,{artifactDigest:prepared.artifactDigest,invocationNonce:'wrong',providerMessageId:'fixture-late'}),/ack/);
    assert.equal(JSON.stringify([...rows]),beforeWrong);
    await op('recordAck',id,{artifactDigest:prepared.artifactDigest,invocationNonce:'queue-nonce',providerMessageId:'fixture-late'});
    const cleared=await observed('ack_provider_accepted',id);
    assert.equal(cleared.detail.providerMessageId,'fixture-late');
    assert.equal(cleared.page.items[0].status,'provider_accepted');
    // ACK is an inert provider-boundary fact; no provider is invoked by this queue test.
    covered.push('R6.late-bound-ack-clears-fresh-list-detail');
    const retained=JSON.stringify([...rows]), chunkId=prepared.artifact.chunkIds[0];
    const corruptions=[
      ['start-kind',()=>{rows.get(startId).kind='BAD';}],
      ['start-nonce',()=>{rows.get(startId).invocationNonce='';}],
      ['start-artifact-binding',()=>{rows.get(startId).artifactDigest='0'.repeat(64);}],
      ['ack-without-start',()=>rows.delete(startId)],
      ['ack-kind',()=>{rows.get(ackId).kind='BAD';}],
      ['ack-nonce-binding',()=>{rows.get(ackId).invocationNonce='wrong';}],
      ['ack-message-id',()=>{rows.get(ackId).providerMessageId='bad message';}],
      ['ack-recipient-binding',()=>{rows.get(ackId).to='wrong@example.invalid';}],
      ['ack-artifact-binding',()=>{rows.get(ackId).artifactDigest='0'.repeat(64);}],
      ['chunk-missing',()=>rows.delete(chunkId)],
      ['chunk-tampered',()=>{rows.get(chunkId).data='YmFk';}],
      ['root-digest',()=>{rows.get(id).documentDigest='0'.repeat(64);}]
    ];
    for (const [label, corrupt] of corruptions) {
      restore(retained); corrupt(); await observed('unresolved',id); covered.push('R4.'+label);
    }
    for (const target of [id,prepared.artifact._id,chunkId,startId,ackId]) {
      for (const mode of ['undefined','throw']) {
        restore(retained);
        getHook=targetId=>{if(targetId===target){if(mode==='throw')throw Error('PRIVATE_CORRUPTION');return undefined;}return rows.has(targetId)?clone(rows.get(targetId)):null;};
        await observed('unresolved',id); getHook=null;
        covered.push('R4.'+[id,prepared.artifact._id,chunkId,startId,ackId].indexOf(target)+'-'+mode);
      }
    }
    restore(retained); rows.delete(ackId); await observed('start_uncertain',id);
    rows.delete(startId); await observed('pending_prestart',id);
    covered.push('R4.explicit-null-absence-controls');
    rows.clear();
    const maximum=Buffer.alloc(8388608,65);
    for(let index=0;index<2;index++) {
      const c={...clone(command),invoiceNumber:'QUEUE-MAX-'+index,requestId:crypto.randomUUID()};
      const admitted=await api.prepareOwnerInvoiceDispatch(c);
      const state=await artifact(admitted.issuanceId,maximum);
      assert.equal(state.artifact.chunkIds.length,112);
    }
    const beforeMax=trace.length, outsideMax=externalTrace.length;
    const maxPage=await api.listOwnerInvoiceReviews(null);
    assert.equal(maxPage.scanStatus,'ok');assert.equal(maxPage.items.length,2);
    assert.equal(maxPage.cycleEndObserved,true);
    const calls=trace.slice(beforeMax);
    assert.equal(calls.filter(t=>t[0]==='query').length,1);
    assert.equal(calls.filter(t=>t[0]==='get').length,232);
    assert.equal(calls.length,233);assert.ok(calls.length<=265);
    assert.equal(externalTrace.length,outsideMax);
    // 128 is a nominal chunk-count cap, dominated by the actual 8 MiB MIME cap.
    // 127 full nonfinal chunks require 9,525,000 bytes before the last chunk.
    const maximumRoot=[...rows.values()].find(r=>r.kind==='ISSUANCE');
    const maximumManifest=rows.get(key('invoice-artifact/v1',maximumRoot._id));
    maximumManifest.chunkIds=Array(128).fill(maximumManifest.chunkIds[0]);
    const beforeInvalid=trace.length;
    const invalidMaximum=await api.listOwnerInvoiceReviews(null);
    assert.equal(invalidMaximum.scanStatus,'partial');
    assert.equal(invalidMaximum.items.find(i=>i.issuanceId===maximumRoot._id).classification,'unresolved');
    assert.ok(trace.slice(beforeInvalid).length<=265);
    covered.push('R5.reachable-233-sdk-with-nominal-265-ceiling','R5.128-chunk-dominated-limit-denial');
    assert.equal(covered.length,29);
    console.log(JSON.stringify({queueCoverage:covered,validMaximumPageSdkCalls:calls.length,nominalSdkCeiling:265,exact265Reachable:false}));
    rows.clear();
  }
  // A1: actual Admin callback, fresh storage, no JSON transport of test values.
  const identifierCases = [];
  for (const field of ['requestId', 'revision', 'parentIssuanceId']) {
    const valid = field === 'parentIssuanceId' ? 'a'.repeat(64) : command[field];
    for (const [type, value] of [['array', [valid]], ['object', {}], ['null', null],
      ['number', 123], ['boolean', true], ['boxed-string', new String(valid)]]) {
      rows.clear();
      const invalid = clone(command);
      invalid[field] = value;
      if (field === 'parentIssuanceId') invalid.reissueReason = 'explicit';
      const before = trace.length;
      let outcome;
      try { outcome = (await api.prepareOwnerInvoiceDispatch(invalid)).status; }
      catch (error) { outcome = error.message; }
      identifierCases.push({ field, type, outcome, io: trace.slice(before), records: rows.size });
    }
  }
  console.log(JSON.stringify({ identifierCases }));
  assert.equal(identifierCases.length, 18);
  for (const test of identifierCases) {
    assert.equal(test.outcome, test.field === 'parentIssuanceId' ? 'owner_invoice_parent' : 'owner_invoice_uuid',
      `${test.field} ${test.type}: primitive string required`);
    assert.deepEqual(test.io, [], 'invalid identifier must perform zero SDK IO');
    assert.equal(test.records, 0);
  }
  rows.clear();
  const result = await api.prepareOwnerInvoiceDispatch(clone(command));
  assert.equal(result.status, 'durably_prepared');
  assert.match(result.issuanceId, /^[a-f0-9]{64}$/);
  assert.equal(rows.size, 2);
  assert.deepEqual([...rows.values()].map(x => x.kind), ['REQUEST', 'ISSUANCE']);
  const issuance = rows.get(result.issuanceId);
  assert.equal(issuance.actorId, actor);
  assert.equal(issuance.to, command.guest.email);
  assert.equal(issuance.cc, 'info@wanderlustcaribbean.com');
  assert.equal(crypto.createHash('sha256').update(issuance.document).digest('hex'), issuance.documentDigest);
  // Actual missing Admin wiring must fail before implementation (RED).
  for (const method of ['dispatchOwnerInvoice', 'getOwnerInvoiceDispatch']) {
    assert.equal(typeof api[method], 'function', `missing actual Admin ${method} export`);
    for (const deniedRole of ['Anonymous', 'Member']) {
      role = deniedRole;
      const before = [trace.length, externalTrace.length];
      await assert.rejects(() => api[method](result.issuanceId), /platform_denied/);
      assert.deepEqual([trace.length, externalTrace.length], before);
    }
    role = 'Admin'; actor = '';
    const before = [trace.length, externalTrace.length];
    await assert.rejects(() => api[method](result.issuanceId), /actor/);
    actor = 'fixture-admin';
    await assert.rejects(() => (async () => (await load(false))[method](result.issuanceId))(), /disabled/);
    for (const invalid of [[result.issuanceId], {issuanceId: result.issuanceId, actorId: actor}, null, 'A'.repeat(64)]) {
      await assert.rejects(() => api[method](invalid), /owner_invoice_/);
    }
    assert.deepEqual([trace.length, externalTrace.length], before);
    const immutableBefore = JSON.stringify([...rows]);
    const externalBefore = externalTrace.length;
    assert.equal((await api[method]('f'.repeat(64))).classification, 'unresolved');
    assert.equal(externalTrace.length, externalBefore, 'missing root never reaches transport/secrets');
    assert.equal(JSON.stringify([...rows]), immutableBefore);
  }
  const statusBefore = [trace.length, externalTrace.length];
  assert.deepEqual(clone(await api.getOwnerInvoiceDispatch(result.issuanceId)), {
    issuanceId: result.issuanceId, invoiceNumber: command.invoiceNumber, revision: command.revision, purpose: command.purpose, status: 'preparation_retryable', classification: 'pending_prestart', needsOwnerReview: false});
  assert.equal(externalTrace.length, statusBefore[1], 'status never wakes service');
  assert.ok(trace.slice(statusBefore[0]).every(call => call[0] === 'get'));
  dispatchFetch = async (url, options) => {
    assert.equal(url, 'https://fixture.invalid/issue-invoice');
    assert.equal(options.method, 'post');
    assert.equal(options.headers['X-WBE-Secret'], 'fixture-only');
    assert.deepEqual(JSON.parse(options.body), {protocol: 'owner-invoice-journal-v1', issuance_id: result.issuanceId});
    return {ok: true}; // HTTP boundary fixture only; Python endpoint chain tested separately.
  };
  const dispatchBefore = trace.length;
  actor = 'second-admin'; // creator audit is not per-Admin document ownership.
  assert.equal((await api.dispatchOwnerInvoice(result.issuanceId)).status, 'preparation_retryable');
  assert.ok(trace.slice(dispatchBefore).every(call => call[0] === 'get'));
  assert.equal(rows.get(result.issuanceId).actorId, 'fixture-admin');
  actor = 'fixture-admin'; dispatchFetch = null;
  console.log('PASS Admin dispatch/status actual callbacks: default OFF, actor/role/root binding, read-only status, fixed journal payload; synthetic platform/HTTP boundary');
  if (process.env.N3_ROOT_FIXTURE) fs.writeFileSync(process.env.N3_ROOT_FIXTURE, JSON.stringify(issuance));
  actor = 'second-admin';
  assert.equal((await api.prepareOwnerInvoiceDispatch(clone(command))).issuanceId, result.issuanceId,
    'P4 cross-Admin same document must converge');
  assert.equal(rows.get(result.issuanceId).actorId, 'fixture-admin');
  assert.equal([...rows.values()].filter(r => r.kind === 'REQUEST').length, 2);
  actor = 'fixture-admin';
  // Reconstructed actual modules use only durable fixture records.
  const restart = await load();
  assert.equal((await restart.prepareOwnerInvoiceDispatch(clone(command))).issuanceId, result.issuanceId);
  assert.equal(rows.size, 3);
  for (const denied of ['Anonymous', 'Member']) {
    role = denied;
    const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(command)), /platform_denied/);
    assert.equal(trace.length, before);
  }
  role = 'Admin'; actor = '';
  const before = trace.length;
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(command)), /actor/);
  assert.equal(trace.length, before);
  actor = 'fixture-admin';
  const off = await load(false);
  await assert.rejects(() => off.prepareOwnerInvoiceDispatch(clone(command)), /disabled/);
  assert.equal(trace.length, before);
  const negativeCases = [
    c => { c.ownerOnly = true; }, c => { c.completed = true; },
    c => { c.guestToken = 'not-authority'; }, c => { c.actorId = 'spoofed'; },
    c => { c.to = 'other@example.invalid'; }, c => { delete c.payments; },
    c => { c.guest.email = 'victim@example.invalid\r\nBcc: other@example.invalid'; },
    c => { c.guest.email = 'a@example.invalid,b@example.invalid'; },
    c => { c.financial.components.grandTotalCents += 1; },
    c => { c.financial.lines[0].netCents += 1; },
    c => { c.financial.components.discountCents = -0; },
    c => { c.financial.components.discountCents = NaN; },
    c => { c.issueDate = '2026-02-30'; }, c => { c.revision = 'not-a-uuid'; },
  ];
  for (const change of negativeCases) {
    const invalid = clone(command); change(invalid);
    const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(invalid), /owner_invoice_/);
    assert.equal(trace.length, before, 'invalid command must perform zero SDK IO');
  }
  for (const change of [c => { c.guest.email = 'other@example.invalid'; }, c => { c.purpose = 'owner_copy'; },
    c => { c.payments.push({ datePaid: '2026-09-07', paymentAmountCents: 100 }); },
    c => { c.revision = '32345678-1234-4234-8234-123456789abc'; }]) {
    const changed = clone(command); change(changed);
    const old = JSON.stringify([...rows]);
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(changed), /conflict/);
    assert.equal(JSON.stringify([...rows]), old);
  }
  const oversizedRecord = clone(command);
  oversizedRecord.requestId = '72345678-1234-4234-8234-123456789abc';
  oversizedRecord.revision = '82345678-1234-4234-8234-123456789abc';
  oversizedRecord.financial.lines = Array.from({ length: 35 }, (_, index) => ({
    ...clone(command.financial.lines[0]), label: '"'.repeat(1900),
    ...(index ? { unitPriceCents: 0, netCents: 0, vatCents: 0, grossCents: 0 } : {}),
  }));
  const beforeOversize = trace.length;
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(oversizedRecord), /oversize/,
    'escaped canonical record must fit the cap, not just its nested document');
  assert.equal(trace.length, beforeOversize);
  const anotherRequest = clone(command);
  anotherRequest.requestId = '42345678-1234-4234-8234-123456789abc';
  const concurrent = await Promise.all([api.prepareOwnerInvoiceDispatch(anotherRequest), restart.prepareOwnerInvoiceDispatch(anotherRequest)]);
  assert.ok(concurrent.every(x => x.issuanceId === result.issuanceId));
  assert.equal([...rows.values()].filter(x => x.kind === 'ISSUANCE').length, 1);
  // A request/root crash is represented by SDK failure, not a seeded root.
  const crashedCommand = clone(command);
  crashedCommand.requestId = '52345678-1234-4234-8234-123456789abc';
  crashedCommand.revision = '62345678-1234-4234-8234-123456789abc';
  failRoot = true; loseRequestAck = true;
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(crashedCommand), /unavailable/);
  const durable = [...rows.values()].find(x => x.requestId === crashedCommand.requestId);
  assert.ok(durable);
  assert.equal(rows.has(durable.issuanceId), false);
  failRoot = false; loseRequestAck = false;
  // Serialize the actual writer's entire database; reconstruct objects/modules.
  const durableBytes = JSON.stringify([...rows]);
  rows.clear();
  for (const [id, record] of JSON.parse(durableBytes)) rows.set(id, record);
  const recovered = await load();
  assert.equal((await recovered.prepareOwnerInvoiceDispatch(crashedCommand)).issuanceId, durable.issuanceId);
  const persistedRequest = [...rows.values()].find(x => x.kind === 'REQUEST');
  assert.equal(persistedRequest.document, issuance.document);
  const admissionBaseline = { records: clone([...rows.values()]), trace: clone(trace) };
  rows.clear();
  const missingParent = clone(command);
  missingParent.parentIssuanceId = 'abcdef01'.repeat(8);
  missingParent.reissueReason = 'explicit';
  const beforeMissing = trace.length;
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(missingParent), /parent/);
  assert.equal(trace.slice(beforeMissing).filter(x => x[0] === 'insert').length, 0);
  const parentResult = await api.prepareOwnerInvoiceDispatch(clone(command));
  const exactStrings = clone(command);
  exactStrings.requestId = command.requestId.toUpperCase();
  exactStrings.revision = command.revision.toUpperCase();
  exactStrings.parentIssuanceId = parentResult.issuanceId;
  exactStrings.reissueReason = 'explicit';
  exactStrings.purpose = 'owner_copy';
  const exactResult = await api.prepareOwnerInvoiceDispatch(exactStrings);
  assert.equal(exactResult.status, 'durably_prepared');
  assert.equal(exactResult.revision, exactStrings.revision);
  const exactRoot = rows.get(exactResult.issuanceId);
  const exactRequest = [...rows.values()].find(record => record.kind === 'REQUEST' && record.requestId === exactStrings.requestId);
  assert.equal(exactRequest.requestId, exactStrings.requestId);
  const exactDocument = JSON.parse(exactRoot.document);
  assert.equal(exactDocument.revision, exactStrings.revision);
  assert.equal(exactDocument.parentIssuanceId, exactStrings.parentIssuanceId);
  assert.equal(exactRoot.actorId, actor);
  assert.equal(exactRoot.to, 'info@wanderlustcaribbean.com');
  assert.equal(exactRoot.cc, '');
  assert.equal(exactRoot.from, 'info@wanderlustcaribbean.com');
  const exactRestart = await load();
  assert.equal((await exactRestart.prepareOwnerInvoiceDispatch(exactStrings)).issuanceId, exactResult.issuanceId);
  assert.equal(rows.size, 4);
  // P3 ordinary SDK crash after retained REQUEST, followed by parent START.
  const child = clone(exactStrings);
  child.requestId = '92345678-1234-4234-8234-123456789abc';
  child.revision = 'a2345678-1234-4234-8234-123456789abc';
  failRoot = true;
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(child), /unavailable/);
  failRoot = false;
  const stageKey = (domain, id) => crypto.createHash('sha256').update(JSON.stringify([domain, id])).digest('hex');
  const parentBytes = JSON.stringify(rows.get(parentResult.issuanceId));
  // SDK stage fixture only; NOT a production sender or dispatch grant.
  const start = { _id: stageKey('invoice-send-start/v1', parentResult.issuanceId), kind: 'START',
    issuanceId: parentResult.issuanceId, documentDigest: rows.get(parentResult.issuanceId).documentDigest,
    artifactDigest: 'a'.repeat(64), workerBootId: 'fixture-boot', invocationNonce: 'fixture-invocation' };
  rows.set(start._id, start);
  const reconstructed = await load();
  const finished = await reconstructed.prepareOwnerInvoiceDispatch(clone(child));
  assert.equal(finished.status, 'durably_prepared');
  assert.equal(JSON.parse(rows.get(finished.issuanceId).document).revision, child.revision);
  assert.equal(JSON.stringify(rows.get(parentResult.issuanceId)), parentBytes);
  const newer = clone(child);
  newer.requestId = 'b2345678-1234-4234-8234-123456789abc';
  newer.revision = 'c2345678-1234-4234-8234-123456789abc';
  const uncertainBefore = trace.length;
  await assert.rejects(() => reconstructed.prepareOwnerInvoiceDispatch(newer), /owner_review_required/);
  assert.equal(trace.slice(uncertainBefore).filter(x => x[0] === 'insert').length, 0);
  assert.equal((await reconstructed.prepareOwnerInvoiceDispatch(clone(child))).issuanceId, finished.issuanceId);
  assert.equal(JSON.stringify(rows.get(parentResult.issuanceId)), parentBytes);
  for (const corrupt of [r => { r.actorId = false; }, r => { r.documentDigest = 'b'.repeat(64); },
    r => { r.to = 'changed@example.invalid'; }, r => { r.extra = 1; }, r => { r.kind = 'REQUEST'; }]) {
    const saved = clone(rows.get(parentResult.issuanceId));
    const bad = clone(saved); corrupt(bad); rows.set(saved._id, bad);
    const before = trace.length;
    await assert.rejects(() => reconstructed.prepareOwnerInvoiceDispatch(newer), /owner_invoice_/);
    assert.equal(trace.slice(before).filter(x => x[0] === 'insert').length, 0);
    rows.set(saved._id, saved);
  }
  // P2 local immutable stage envelopes, not an actual sender/MIME preparation chain.
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const payload = Buffer.from('fixture artifact bytes');
  const chunk = { _id: stageKey('invoice-artifact-chunk/v1', digest(payload)), kind: 'ARTIFACT_CHUNK',
    data: payload.toString('base64'), digest: digest(payload) };
  const manifest = { _id: stageKey('invoice-artifact/v1', parentResult.issuanceId), kind: 'ARTIFACT',
    issuanceId: parentResult.issuanceId, documentDigest: start.documentDigest, to: issuance.to, cc: issuance.cc,
    from: issuance.from, chunkIds: [chunk._id], mimeDigest: digest(payload), byteLength: payload.length,
    pdfDigest: digest(Buffer.from('fixture PDF')), rendererVersion: 'fixture/v1' };
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
    value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
  start.artifactDigest = digest(canonical(manifest)); rows.set(start._id, clone(start));
  const ack = { _id: stageKey('invoice-send-ack/v1', start.issuanceId), kind: 'ACK', issuanceId: start.issuanceId,
    documentDigest: start.documentDigest, artifactDigest: start.artifactDigest, invocationNonce: start.invocationNonce,
    to: issuance.to, cc: issuance.cc, from: issuance.from, providerMessageId: 'fixture-message-id', status: 'provider_accepted' };
  rows.set(ack._id, clone(ack)); rows.set(manifest._id, clone(manifest)); rows.set(chunk._id, clone(chunk));
  actor = 'second-admin';
  assert.equal((await reconstructed.prepareOwnerInvoiceDispatch(clone(newer))).status, 'durably_prepared',
    'P2 exact START ACK and complete bound artifact permits explicit child');
  actor = 'fixture-admin';
  const stageBaseline = JSON.stringify([...rows]);
  const restore = () => { rows.clear(); for (const [id, r] of JSON.parse(stageBaseline)) rows.set(id, r); };
  let cases = 0;
  // Fresh commands must deny broken parent/stage evidence without any writes.
  for (const corrupt of [
    () => rows.delete(chunk._id), () => rows.delete(manifest._id),
    () => { rows.get(chunk._id).data = 'YmFk'; },
    () => { rows.get(ack._id).invocationNonce = 'wrong'; },
    () => { rows.get(ack._id).status = 'delivered'; },
    () => { rows.get(manifest._id).to = 'wrong@example.invalid'; },
    () => { rows.get(parentResult.issuanceId).kind = 'REQUEST'; },
    () => { rows.get(parentResult.issuanceId).actorId = false; }
  ]) {
    restore(); corrupt();
    const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(newer)), /owner_invoice_/);
    assert.equal(trace.slice(before).filter(t => t[0] === 'insert').length, 0); cases++;
  }
  restore();
  for (const mode of ['unknown', 'failure']) {
    getHook = id => { if (id === start._id) { if (mode === 'failure') throw new Error('read_failure'); return undefined; }
      return rows.has(id) ? clone(rows.get(id)) : null; };
    const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(newer)), /owner_invoice_|read_failure/);
    assert.equal(trace.slice(before).filter(t => t[0] === 'insert').length, 0); getHook = null; cases++;
  }
  // Child's own uncertainty and parent's later ACK never produce a new grant/revision.
  const childRoot = rows.get(finished.issuanceId);
  const childManifest = { ...manifest, _id: stageKey('invoice-artifact/v1', childRoot._id),
    issuanceId: childRoot._id, documentDigest: childRoot.documentDigest,
    to: childRoot.to, cc: childRoot.cc, from: childRoot.from };
  rows.set(childManifest._id, clone(childManifest));
  const childStart = { ...start, _id: stageKey('invoice-send-start/v1', childRoot._id),
    issuanceId: childRoot._id, documentDigest: childRoot.documentDigest,
    artifactDigest: digest(canonical(childManifest)) };
  assert.notEqual(childStart.documentDigest, start.documentDigest);
  assert.equal(childManifest.documentDigest, childRoot.documentDigest);
  assert.equal(rows.has(stageKey('invoice-send-ack/v1', childRoot._id)), false);
  assert.deepEqual(rows.get(ack._id), ack);
  rows.set(childStart._id, childStart);
  const replayBefore = trace.length;
  const replayRows = JSON.stringify([...rows]);
  const replay = await api.prepareOwnerInvoiceDispatch(clone(child));
  assert.deepEqual(clone(replay), clone(finished));
  assert.equal(JSON.stringify([...rows]), replayRows, 'no new START, root, revision or stored grant');
  assert.deepEqual(Object.keys(replay).sort(), ['documentDigest', 'issuanceId', 'revision', 'status']);
  assert.equal(replay.issuanceId, finished.issuanceId);
  assert.ok(trace.slice(replayBefore).filter(t => t[0] === 'insert').every(t => t[2] === finished.issuanceId));
  for (const change of [c => { c.reissueReason = 'changed'; }, c => { c.parentIssuanceId = 'b'.repeat(64); }]) {
    const bad = clone(child); change(bad); const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(bad), /conflict/);
    assert.equal(trace.slice(before).filter(t => t[0] === 'insert').length, 0); cases++;
  }
  // Exact acknowledged readback is stricter than duplicate/lost-ACK creator reconciliation.
  rows.clear(); loseRootAck = true;
  assert.equal((await api.prepareOwnerInvoiceDispatch(clone(command))).status, 'durably_prepared');
  loseRootAck = false;
  rows.clear(); insertHook = r => { if (r.kind === 'ISSUANCE') rows.get(r._id).actorId = 'unexpected-actor'; };
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(command)), /conflict/);
  insertHook = null; cases++;
  rows.clear();
  const first = api.prepareOwnerInvoiceDispatch(clone(command));
  actor = 'second-admin';
  const second = api.prepareOwnerInvoiceDispatch({ ...clone(command), requestId: 'd2345678-1234-4234-8234-123456789abc' });
  const winners = await Promise.all([first, second]);
  assert.ok(winners.every(x => x.issuanceId === result.issuanceId));
  assert.equal([...rows.values()].filter(r => r.kind === 'ISSUANCE').length, 1);
  assert.deepEqual([...rows.values()].filter(r => r.kind === 'REQUEST').map(r => r.actorId).sort(), ['fixture-admin', 'second-admin']);
  assert.equal(rows.get(result.issuanceId).actorId, 'fixture-admin');
  actor = 'fixture-admin';
  const parentSnapshot = clone(rows.get(result.issuanceId));
  const linked = { ...clone(command), requestId: 'e2345678-1234-4234-8234-123456789abc',
    revision: 'f2345678-1234-4234-8234-123456789abc', parentIssuanceId: result.issuanceId, reissueReason: 'explicit' };
  for (const mutate of [
    d => { d.requestId = command.requestId; },
    d => { d.invoiceNumber = 'OTHER'; },
    d => { d.parentIssuanceId = result.issuanceId; d.reissueReason = 'cycle'; },
    d => { d.parentIssuanceId = 'f'.repeat(64); d.reissueReason = 'forward'; }
  ]) {
    const bad = clone(parentSnapshot), d = JSON.parse(bad.document); mutate(d);
    bad.document = canonical(d); bad.documentDigest = digest(bad.document);
    rows.set(result.issuanceId, bad);
    const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(linked)), /owner_invoice_/);
    assert.equal(trace.slice(before).filter(t => t[0] === 'insert').length, 0); cases++;
  }
  rows.set(result.issuanceId, parentSnapshot);
  for (const mutate of [c => { delete c.reissueReason; }, c => { c.parentIssuanceId = stageKey('owner-invoice-revision/v1', 'unused'); },
    c => { c.parentIssuanceId = digest(canonical(['owner-invoice-revision/v1', c.invoiceNumber, c.revision])); }]) {
    const bad = clone(linked); mutate(bad); const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(bad), /owner_invoice_/);
    assert.equal(trace.slice(before).filter(t => t[0] === 'insert').length, 0); cases++;
  }
  // #6/P1: actual writer creates a valid OTHER identity, isolating same-number denial.
  const other = await api.prepareOwnerInvoiceDispatch({ ...clone(command), invoiceNumber: 'OTHER',
    requestId: '02345678-1234-4234-8234-123456789abc' });
  assert.equal(other.status, 'durably_prepared');
  assert.equal(other.issuanceId, digest(canonical(['owner-invoice-revision/v1', 'OTHER', command.revision])));
  const wrongParentBefore = trace.length;
  const wrongParentRows = JSON.stringify([...rows]);
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch({ ...clone(linked), parentIssuanceId: other.issuanceId }),
    /^Error: owner_invoice_parent_invoice$/);
  assert.equal(trace.slice(wrongParentBefore).filter(t => t[0] === 'insert').length, 0);
  assert.equal(JSON.stringify([...rows]), wrongParentRows);
  getHook = id => {
    const stored = rows.has(id) ? clone(rows.get(id)) : null;
    if (stored && stored.kind === 'ISSUANCE') {
      stored._createdDate = new Date('2026-09-07T00:00:00Z');
      stored._owner = null;
      stored._updatedDate = 'metadata outside application size '.repeat(6000);
      assert.equal(stored._owner, null);
      assert.ok(stored._createdDate instanceof Date);
    }
    return stored;
  };
  assert.equal((await api.prepareOwnerInvoiceDispatch(clone(command))).status, 'durably_prepared', 'allowlisted Wix Date metadata is outside root equality');
  getHook = null;
  assert.equal(cases, 20);
  console.log(JSON.stringify({ n3AdditionalCases: cases, stageFixturesOnly: true }));
  console.log(JSON.stringify({ tracer: 'Admin prepare -> actual immutable store -> restarted readback', negativeCases: negativeCases.length,
    ...admissionBaseline, exactStringOwnerControl: { records: [...rows.values()], trace: trace.slice(admissionBaseline.trace.length) },
    completeCriteria: [], partialCriteria: [1, 2, 7, 8] }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
