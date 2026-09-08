// AUTHORED ONLY: execution requires independent five-path dependency admission.
// Run only after that approval: node --experimental-vm-modules this-file.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const clone = x => structuredClone(x);
async function harness(retained = new Map(), enabled = true) {
  const trace = []; const user = {id:'platform-admin', loggedIn:true, role:'Admin'};
  let fault = null; const hooks = {get:null, insert:null, after:null};
  const sourceHashes = {};
  const data = {
    async get(collection, id, options) {
      trace.push(['get', collection, id]); assert.equal(options.consistentRead, true);
      if (fault) { const f = fault; fault = null; return f(collection, id); }
      let value = clone(retained.get(collection + ':' + id) ?? null);
      if (hooks.get) value = await hooks.get(collection, id, value);
      if (hooks.after) hooks.after('get', collection, id);
      return value;
    },
    async insert(collection, row) {
      trace.push(['insert', collection, row._id]);
      if (hooks.insert) await hooks.insert(collection, row);
      const key = collection + ':' + row._id;
      if (retained.has(key)) throw Error('duplicate');
      retained.set(key, clone(row));
      if (hooks.after) hooks.after('insert', collection, row._id);
      return clone(row);
    }
  };
  for (const method of ['update','save','remove','bulkInsert','bulkUpdate','bulkRemove','query']) {
    data[method]=(...args)=>{trace.push([method,...args]);throw Error('forbidden SDK operation');};
  }
  const context = vm.createContext({Buffer, console}); const cache = new Map();
  const sdk = {
    'wix-data':{default:data}, crypto:{createHash:crypto.createHash},
    'wix-users-backend':{currentUser:user},
    'wix-web-module':{Permissions:{Admin:'Admin'}, webMethod:(permission, fn) => {
      assert.equal(permission, 'Admin');
      return async (...args) => { if (user.role !== 'Admin') throw Error('platform denied'); return fn(...args); };
    }},
    'wix-fetch':{fetch:() => {trace.push(['provider']); throw Error('forbidden');}},
    'wix-secrets-backend':{getSecret:() => {trace.push(['secret']); throw Error('forbidden');}},
    'backend/settings.web':{getAllSettings:() => {trace.push(['settings']); throw Error('forbidden');}}
  };
  async function load(spec, parent) {
    const name = sdk[spec] ? spec : spec.startsWith('backend/') ? 'velo/' + spec + '.js' : path.posix.normalize(path.posix.join(path.posix.dirname(parent), spec));
    if (cache.has(name)) return cache.get(name);
    let mod;
    if (sdk[name]) mod = new vm.SyntheticModule(Object.keys(sdk[name]), function () { for (const [k,v] of Object.entries(sdk[name])) this.setExport(k,v); }, {context});
    else {
      let source = fs.readFileSync(path.join(root,name),'utf8');
      sourceHashes[name] = crypto.createHash('sha256').update(source).digest('hex');
      // Inert future fixture only; production OFF bytes are never changed.
      if (enabled && name === 'velo/backend/issueInvoice.web.js') source = source.replace('const OWNER_INVOICE_JOURNAL_ENABLED = false;', 'const OWNER_INVOICE_JOURNAL_ENABLED = true;');
      mod = new vm.SourceTextModule(source,{context,identifier:name});
    }
    cache.set(name,mod); await mod.link((s,m) => load(s,m.identifier)); return mod;
  }
  const endpoint = await load('backend/issueInvoice.web',''); await endpoint.evaluate();
  return {api:endpoint.namespace, retained, trace, user, hooks, sourceHashes, failNext:f => {fault=f;}};
}
const uuid = n => `12345678-1234-4234-8234-${String(n).padStart(12,'0')}`;
function document(n, extra={}) {
  return {requestId:uuid(n),revision:uuid(n),invoiceNumber:'TEST-1',issueDate:'2026-01-01',
    guest:{name:'Original',email:'original@example.com',phone:'1234567890'},checkIn:'2026-02-01',checkOut:'2026-02-02',roomCode:'A',purpose:'guest_invoice',payments:[],
    financial:{currency:'USD',components:{grossCents:100,discountCents:0,roomTotalCents:100,propertyFeeCents:0,accommodationVatCents:0,packageVatCents:0,totalVatCents:0,grandTotalCents:100},lines:[{label:'Original line',taxClass:'accommodation',quantity:1,roomQuantity:1,unitPriceCents:100,netCents:100,vatCents:0,grossCents:100,vatRateBasisPoints:0}]},...extra};
}
async function fixture() {
  const h = await harness();
  const a = await h.api.prepareOwnerInvoiceDispatch(document(1));
  const b = await h.api.prepareOwnerInvoiceDispatch(document(2,{parentIssuanceId:a.issuanceId,reissueReason:'Contact correction',guest:{name:'Changed',email:'changed@example.com',phone:'9876543210'}}));
  const row = h.retained.get('InvoiceEmailJournal:'+a.issuanceId);
  const facts = JSON.parse(row.document);
  const original = {document:row.document,guestName:facts.guest.name,guestEmail:facts.guest.email,guestPhone:facts.guest.phone};
  const command = {rootIssuanceId:a.issuanceId,invoiceRevisionId:b.issuanceId,commandId:'selection-1',baseDigest:crypto.createHash('sha256').update(JSON.stringify(original)).digest('hex'),previousRevisionId:null,changes:{guestName:'Changed',guestEmail:'changed@example.com',guestPhone:'9876543210',notes:'Association annotation only'}};
  h.trace.length=0; return {h,a,b,command};
}
const mutations = h => h.trace.filter(x => x[0] !== 'get');
async function main() {
  // C1 endpoint append/status, immutable original and recipient-bound child.
  const {h,a,b,command} = await fixture(); const before = clone([...h.retained]);
  const applied = await h.api.prepareOwnerInvoiceDispatch(null,command);
  assert.equal(applied.status,'APPLIED');
  const status = await h.api.getOwnerInvoiceDispatch(a.issuanceId,{currentRevision:true});
  assert.equal(status.issuanceId,a.issuanceId); assert.equal(status.status,'preparation_retryable');
  assert.equal(status.documentCurrent.invoiceRevisionId,b.issuanceId);
  for (const [key,row] of before) assert.deepEqual(h.retained.get(key),row);
  assert.ok(mutations(h).every(x => x[0] === 'insert' && x[1] === 'BookingCurrentRevisions'));
  // C2 genuine auth/malformed rejects: zero business IO (not lineage validation).
  for (const bad of [{...command,actorId:'forged'},{...command,changes:{notes:'incomplete'}},{...command,rootIssuanceId:[]}]) {
    h.trace.length=0; await assert.rejects(() => h.api.prepareOwnerInvoiceDispatch(null,bad)); assert.deepEqual(h.trace,[]);
  }
  h.user.id=' '; h.trace.length=0;
  await assert.rejects(() => h.api.prepareOwnerInvoiceDispatch(null,command)); assert.deepEqual(h.trace,[]); h.user.id='platform-admin';
  // C3 retained validation needs reads, but must never mutate.
  for (const bad of [{...command,baseDigest:'0'.repeat(64)},{...command,invoiceRevisionId:'0'.repeat(64)},{...command,changes:{...command.changes,guestEmail:'foreign@example.com'}}]) {
    h.trace.length=0; const result=await h.api.prepareOwnerInvoiceDispatch(null,bad);
    assert.notEqual(result.status,'APPLIED'); assert.ok(h.trace.length>0); assert.ok(h.trace.length<1000); assert.deepEqual(mutations(h),[]);
  }
  // C4 fresh module exact replay and conflicting predecessor winner.
  const fresh=await harness(h.retained); assert.equal((await fresh.api.prepareOwnerInvoiceDispatch(null,command)).status,'APPLIED'); assert.deepEqual(mutations(fresh),[]);
  fresh.trace.length=0; assert.equal((await fresh.api.prepareOwnerInvoiceDispatch(null,{...command,commandId:'loser'})).status,'CONFLICT'); assert.deepEqual(mutations(fresh),[]);
  // C5 incomplete root read is unresolved, never absence or resend.
  fresh.trace.length=0; fresh.failNext(() => undefined);
  assert.equal((await fresh.api.prepareOwnerInvoiceDispatch(null,command)).status,'UNRESOLVED'); assert.deepEqual(mutations(fresh),[]);
  // C6 status is read-only and retains historical delivery identity.
  fresh.trace.length=0; const current=await fresh.api.getOwnerInvoiceDispatch(a.issuanceId,{currentRevision:true});
  assert.equal(current.revision,uuid(1)); assert.equal(current.documentCurrent.status,'CURRENT'); assert.deepEqual(mutations(fresh),[]);
  await closureCases();
}
// Permanent finite contract additions. Every case remains NOTRUN until admitted.
const plain = x => JSON.parse(JSON.stringify(x));
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const canonical = x => Array.isArray(x) ? '['+x.map(canonical).join(',')+']' : x && typeof x === 'object' ? '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}' : JSON.stringify(x);
const journalKey = (ns,...parts) => sha(canonical([ns,...parts]));
const revisionKey = (c,prev) => 'bcr1-'+sha('wbe.current-revision.v1\n'+JSON.stringify(['owner-document:'+c.rootIssuanceId,c.baseDigest,prev]));
const journalSnapshot = h => JSON.stringify([...h.retained].filter(([k])=>k.startsWith('InvoiceEmailJournal:')));
const noEffects = h => assert.deepEqual(mutations(h).filter(x=>x[0]!=='insert'||x[1]!=='BookingCurrentRevisions'),[]);
const noMutations = h => assert.deepEqual(mutations(h),[]);
const callAssociation = (h,c) => h.api.prepareOwnerInvoiceDispatch(null,c);
const callStatus = (h,id) => h.api.getOwnerInvoiceDispatch(id,{currentRevision:true});
function rewriteDocument(h,id,edit) {
  // Explicit corrupt/alternative retained-storage seam, not native writer provenance.
  const row=h.retained.get('InvoiceEmailJournal:'+id); const facts=JSON.parse(row.document);
  edit(facts); row.document=canonical(facts); row.documentDigest=sha(row.document);
  row.purpose=facts.purpose; row.to=facts.purpose==='owner_copy'?'info@wanderlustcaribbean.com':facts.guest.email;
  row.cc=facts.purpose==='owner_copy'?'':'info@wanderlustcaribbean.com';
  return row;
}
function revisionRow(c,previous,n) {
  return {_id:revisionKey(c,previous),schemaVersion:1,bookingIdentity:'owner-document:'+c.rootIssuanceId,baseDigest:c.baseDigest,previousRevisionId:previous,commandId:'chain-'+n,actorId:'platform-admin',changes:clone(c.changes),invoiceRevisionId:c.invoiceRevisionId};
}
async function closureCases() {
  const done=[];
  async function test(id,fn) {await fn();done.push(id);}
  await test('C1.1',async()=>{
    const {h,a,b,command:c}=await fixture();
    const original=await callStatus(h,a.issuanceId);
    assert.deepEqual(plain(original.documentCurrent),{status:'CURRENT',revisionId:null,invoiceRevisionId:null,changes:{guestName:'Original',guestEmail:'original@example.com',guestPhone:'1234567890'}});
    const r=await callAssociation(h,c); assert.equal(r.status,'APPLIED');
    assert.deepEqual(plain(r.documentCurrent),{status:'CURRENT',revisionId:r.revisionId,invoiceRevisionId:b.issuanceId,changes:c.changes});
    assert.deepEqual(h.retained.get('BookingCurrentRevisions:'+r.revisionId),{...revisionRow(c,null,0),commandId:c.commandId});
    assert.deepEqual(plain((await callStatus(h,a.issuanceId)).documentCurrent),plain(r.documentCurrent));
  });
  await test('C1.2',async()=>{
    const {h,a,command:c}=await fixture(); const bytes=journalSnapshot(h); const before=clone([...h.retained]);
    const r=await callAssociation(h,c); assert.equal(r.status,'APPLIED'); await callStatus(h,a.issuanceId);
    assert.equal(journalSnapshot(h),bytes); for(const [k,v] of before) assert.deepEqual(h.retained.get(k),v);
    assert.deepEqual(mutations(h),[['insert','BookingCurrentRevisions',r.revisionId]]); noEffects(h);
  });
  await test('C2.1',async()=>{
    const {h,a,command:c}=await fixture();
    for(const [role,loggedIn] of [['Member',true],['Anonymous',false]]) {
      Object.assign(h.user,{role,loggedIn}); h.trace.length=0;
      await assert.rejects(()=>callAssociation(h,c),/platform denied/); await assert.rejects(()=>callStatus(h,a.issuanceId),/platform denied/); assert.deepEqual(h.trace,[]);
    }
    Object.assign(h.user,{role:'Admin',loggedIn:true}); assert.equal((await callAssociation(h,c)).status,'APPLIED');
  });
  await test('C2.2',async()=>{
    const {h,a,command:c}=await fixture();
    for(const [field,value] of [['loggedIn',false],['loggedIn',undefined],['loggedIn','true'],['loggedIn',1],['id',undefined],['id',''],['id',' '],['id',[]],['id',new String('platform-admin')]]) {
      const old=h.user[field]; h.user[field]=value;h.trace.length=0;
      await assert.rejects(()=>callAssociation(h,c)); await assert.rejects(()=>callStatus(h,a.issuanceId));assert.deepEqual(h.trace,[]);h.user[field]=old;
    }
    const bad=[{...c,actorId:'forged'},{...c,authority:true},{...c,changes:{notes:'incomplete'}},{...c,changes:{...c.changes,notes:'x'.repeat(60001)}},{...c,rootIssuanceId:[]},Object.defineProperty({...c},'commandId',{get(){assert.fail('accessor executed');},enumerable:true}),{...c,[Symbol('extra')]:1},Object.defineProperty({...c},'hidden',{value:1})];
    for(const field of ['financial','payments','status','confirmed','bookingIdentity','purpose','checkIn','bookingNumber']) bad.push({...c,changes:{...c.changes,[field]:'forbidden'}});
    for(const value of bad){h.trace.length=0;await assert.rejects(()=>callAssociation(h,value));assert.deepEqual(h.trace,[]);}
    for(const args of [[],[null,c,{}],[document(1),c]]){h.trace.length=0;await assert.rejects(()=>h.api.prepareOwnerInvoiceDispatch(...args));assert.deepEqual(h.trace,[]);}
    for(const options of [null,{},false,{currentRevision:false},{currentRevision:true,extra:1},{currentRevision:true,[Symbol('x')]:1},Object.defineProperty({},'currentRevision',{value:true}),Object.defineProperty({},'currentRevision',{get(){assert.fail('option getter executed');},enumerable:true})]){h.trace.length=0;await assert.rejects(()=>h.api.getOwnerInvoiceDispatch(a.issuanceId,options));assert.deepEqual(h.trace,[]);}
    for(const args of [[],[a.issuanceId,{},{}],[[]]]){h.trace.length=0;await assert.rejects(()=>h.api.getOwnerInvoiceDispatch(...args));assert.deepEqual(h.trace,[]);}
  });
  await test('C2.3',async()=>{
    const seed=await fixture(); const initial=clone(seed.h.retained);
    for(const mode of ['associate','status']) {
      const invoke=h=>mode==='associate'?callAssociation(h,seed.command):callStatus(h,seed.a.issuanceId);
      const positive=await harness(clone(initial)); await invoke(positive);
      // Every actual authority property read, including before NEW IO/final return.
      for(const transition of ['id','loggedIn']) {
        const control=await harness(clone(initial));let reads=0;
        Object.defineProperty(control.user,transition,{get(){reads++;return transition==='id'?'platform-admin':true;}});await invoke(control);
        for(let cut=1;cut<=reads;cut++) {
          if(cut===1&&transition==='id')continue; // Different Admin at capture is valid.
          const h=await harness(clone(initial));let n=0,at=null;
          Object.defineProperty(h.user,transition,{get(){if(++n>=cut){if(at===null)at=h.trace.length;return transition==='id'?'other-admin':false;}return transition==='id'?'platform-admin':true;}});
          await assert.rejects(()=>invoke(h)); assert.notEqual(at,null);
          assert.equal(h.trace.length,at,'no IO after captured authority rejection');noEffects(h);
          for(const x of mutations(h))assert.ok(h.retained.has(x[1]+':'+x[2]),'authorized insert not deleted');
        }
      }
      // SDK response-time drift. Status legacy reads may finish; no new reads after that phase.
      for(let cut=1;cut<=positive.trace.length;cut++) for(const transition of ['id','logout']) {
        const h=await harness(clone(initial));let n=0;
        h.hooks.after=()=>{if(++n===cut){if(transition==='id')h.user.id='other-admin';else h.user.loggedIn=false;}};
        await assert.rejects(()=>invoke(h)); noEffects(h);
        const legacyPrefix=mode==='status'?4:0;
        assert.ok(h.trace.length<=Math.max(cut,legacyPrefix),'no next NEW privileged SDK call');
        for(const x of mutations(h))assert.ok(h.retained.has(x[1]+':'+x[2]));
      }
    }
  });
  await test('C3.1',async()=>{
    const scenarios={foreignBase:({c})=>{c.baseDigest='0'.repeat(64);},foreignInvoice:({h,b})=>{rewriteDocument(h,b.issuanceId,d=>{d.invoiceNumber='FOREIGN';});},unrelated:({h,b})=>{rewriteDocument(h,b.issuanceId,d=>{delete d.parentIssuanceId;delete d.reissueReason;});},missingAncestor:({h,b})=>{rewriteDocument(h,b.issuanceId,d=>{d.parentIssuanceId='0'.repeat(64);});},cycle:({h,b})=>{rewriteDocument(h,b.issuanceId,d=>{d.parentIssuanceId=b.issuanceId;});},malformed:({h,b})=>{h.retained.get('InvoiceEmailJournal:'+b.issuanceId).document='not-json';},digest:({h,b})=>{h.retained.get('InvoiceEmailJournal:'+b.issuanceId).documentDigest='0'.repeat(64);},wrongId:({h,b})=>{h.retained.get('InvoiceEmailJournal:'+b.issuanceId)._id='0'.repeat(64);},recipient:({h,b})=>{h.retained.get('InvoiceEmailJournal:'+b.issuanceId).to='foreign@example.com';},depth:({h,b})=>{
      let parent=b.issuanceId;const template=clone(h.retained.get('InvoiceEmailJournal:'+parent));
      for(let n=0;n<101;n++){const row=clone(template);const facts=JSON.parse(row.document);facts.revision=uuid(100+n);facts.parentIssuanceId=parent;row._id=journalKey('owner-invoice-revision/v1',facts.invoiceNumber,facts.revision);row.document=canonical(facts);row.documentDigest=sha(row.document);h.retained.set('InvoiceEmailJournal:'+row._id,row);parent=row._id;} b.issuanceId=parent;
    }};
    for(const [label,edit] of Object.entries(scenarios)){
      const f=await fixture();const c=clone(f.command);edit({...f,c});if(label==='depth')c.invoiceRevisionId=f.b.issuanceId;
      if(label==='foreignInvoice') {const old=f.h.retained.get('InvoiceEmailJournal:'+f.b.issuanceId);const facts=JSON.parse(old.document);old._id=journalKey('owner-invoice-revision/v1',facts.invoiceNumber,facts.revision);f.h.retained.delete('InvoiceEmailJournal:'+f.b.issuanceId);f.h.retained.set('InvoiceEmailJournal:'+old._id,old);c.invoiceRevisionId=old._id;}
      const before=clone([...f.h.retained]);const r=await callAssociation(f.h,c);assert.notEqual(r.status,'APPLIED',label);assert.ok(f.h.trace.length>0&&f.h.trace.length<1000,label);noMutations(f.h);assert.deepEqual([...f.h.retained],before);
    }
    const {h,a,command:c}=await fixture();h.trace.length=0;await assert.rejects(()=>callAssociation(h,{...c,invoiceRevisionId:a.issuanceId}),/child_required/);assert.deepEqual(h.trace,[]);
  });
  await test('C3.2',async()=>{
    const edits=[d=>{d.checkIn='2026-01-31';},d=>{d.checkOut='2026-02-03';},d=>{d.issueDate='2026-01-02';},d=>{d.financial.lines[0].label='Rewritten';},d=>{d.financial.lines[0].unitPriceCents++;},d=>{d.purpose='owner_copy';},d=>{d.payments=[{datePaid:'2026-01-01',paymentAmountCents:1}];},d=>{d.bookingNumber='foreign-booking';},d=>{d.roomCode='B';}];
    for(const edit of edits){const {h,b,command:c}=await fixture();rewriteDocument(h,b.issuanceId,edit);const before=journalSnapshot(h);assert.notEqual((await callAssociation(h,c)).status,'APPLIED');assert.ok(h.trace.length>0);noMutations(h);assert.equal(journalSnapshot(h),before);}
    // Two distinct zero-valued lines make reversal meaningful while sums stay valid.
    const f=await fixture();for(const id of [f.a.issuanceId,f.b.issuanceId])rewriteDocument(f.h,id,d=>{d.financial.lines.push({...d.financial.lines[0],label:'Second',netCents:0,grossCents:0,unitPriceCents:0});});
    const rootRow=f.h.retained.get('InvoiceEmailJournal:'+f.a.issuanceId);const facts=JSON.parse(rootRow.document);f.command.baseDigest=sha(JSON.stringify({document:rootRow.document,guestName:facts.guest.name,guestEmail:facts.guest.email,guestPhone:facts.guest.phone}));
    rewriteDocument(f.h,f.b.issuanceId,d=>d.financial.lines.reverse());assert.notEqual((await callAssociation(f.h,f.command)).status,'APPLIED');noMutations(f.h);
    const p=await fixture();const before=journalSnapshot(p.h);assert.equal((await callAssociation(p.h,p.command)).status,'APPLIED');assert.equal(journalSnapshot(p.h),before);
  });
  await test('C3.3',async()=>{
    const {h,a,command:c}=await fixture();rewriteDocument(h,a.issuanceId,d=>{d.financial.lines[0].label='x'.repeat(2000);for(let n=0;n<35;n++)d.financial.lines.push({...d.financial.lines[0],netCents:0,grossCents:0,unitPriceCents:0});});
    assert.ok(h.retained.get('InvoiceEmailJournal:'+a.issuanceId).document.length>60000);
    const oversized=await callStatus(h,a.issuanceId);assert.equal(oversized.status,'preparation_retryable');assert.deepEqual(plain(oversized.documentCurrent),{status:'UNRESOLVED'});noMutations(h);
    for(const bad of ['binding','contact']){const f=await fixture();const applied=await callAssociation(f.h,f.command);assert.equal(applied.status,'APPLIED');const row=f.h.retained.get('BookingCurrentRevisions:'+applied.revisionId);if(bad==='binding')row.invoiceRevisionId='0'.repeat(64);else row.changes.guestEmail='foreign@example.com';f.h.trace.length=0;const plainDelivery=await f.h.api.getOwnerInvoiceDispatch(f.a.issuanceId);const {documentCurrent,...delivery}=plain(await callStatus(f.h,f.a.issuanceId));assert.deepEqual(documentCurrent,{status:'UNRESOLVED'});assert.deepEqual(delivery,plain(plainDelivery));noMutations(f.h);}
  });
  await test('C4.1',async()=>{
    const {h,command:c}=await fixture();assert.equal((await callAssociation(h,c)).status,'APPLIED');const before=clone([...h.retained]);
    const fresh=await harness(h.retained);assert.notEqual(fresh.api,h.api);assert.equal((await callAssociation(fresh,c)).status,'APPLIED');assert.equal((await callAssociation(fresh,{...c,commandId:'loser'})).status,'CONFLICT');noMutations(fresh);assert.deepEqual([...h.retained],before);
  });
  await test('C4.2',async()=>{
    for(const winner of [0,1]){
      const f=await fixture();const workers=[await harness(f.h.retained),await harness(f.h.retained)];const commands=[f.command,{...f.command,commandId:'competing',changes:{...f.command.changes,notes:'other valid note'}}];
      let arrive;const arrived=new Promise(r=>{arrive=r;});let count=0;const releases=[];const held=workers.map((h,i)=>{h.hooks.insert=async(collection)=>{assert.equal(collection,'BookingCurrentRevisions');if(++count===2)arrive();await new Promise(r=>{releases[i]=r;});};});void held;
      let timer;const watchdog=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('C4.2 barrier timeout')),5000);});
      const work=workers.map((h,i)=>callAssociation(h,commands[i]));
      try{await Promise.race([arrived,watchdog]);releases[winner]();const won=await Promise.race([work[winner],watchdog]);assert.equal(won.status,'APPLIED');releases[1-winner]();assert.equal((await Promise.race([work[1-winner],watchdog])).status,'CONFLICT');
        assert.equal(workers.reduce((n,h)=>n+mutations(h).length,0),2);workers.forEach(noEffects);const before=clone([...f.h.retained]);const fresh=await harness(f.h.retained);assert.equal((await callAssociation(fresh,commands[winner])).status,'APPLIED');assert.equal((await callAssociation(fresh,commands[1-winner])).status,'CONFLICT');assert.equal((await callStatus(fresh,f.a.issuanceId)).documentCurrent.changes.notes,commands[winner].changes.notes);noMutations(fresh);assert.deepEqual([...f.h.retained],before);
      }finally{releases.forEach(r=>r());clearTimeout(timer);await Promise.allSettled(work);}
    }
  });
  await test('C5.1',async()=>{
    const f=await fixture();const initial=clone(f.h.retained);
    for(const mode of ['associate','status']){
      const invoke=h=>mode==='associate'?callAssociation(h,f.command):callStatus(h,f.a.issuanceId);const good=await harness(clone(initial));await invoke(good);
      const reads=good.trace.filter(x=>x[0]==='get').length;
      // All actual read positions, including store preinsert/readback and final selection.
      for(let cut=1;cut<=reads;cut++)for(const fault of ['undefined','throw']){
        const h=await harness(clone(initial));let n=0;h.hooks.get=(_collection,_id,value)=>{if(++n===cut){if(fault==='throw')throw Error('read unavailable');return undefined;}return value;};
        const r=await invoke(h);assert.ok(n>=cut);noEffects(h);assert.ok(h.trace.length<1000);
        if(mode==='associate')assert.equal(r.status,'UNRESOLVED');else assert.ok(r.status==='journal_unavailable'||r.documentCurrent.status==='UNRESOLVED');
        // A failure before insertion denies writes; postinsert failure preserves its row.
        const native=mutations(h);assert.ok(native.length<=1);for(const x of native)assert.ok(h.retained.has(x[1]+':'+x[2]));
        const firstInsert=good.trace.findIndex(x=>x[0]==='insert');const failedGet=good.trace.map((x,i)=>[x,i]).filter(([x])=>x[0]==='get')[cut-1][1];if(firstInsert<0||failedGet<firstInsert)noMutations(h);
      }
    }
    const absent=await harness(clone(initial));assert.equal((await callAssociation(absent,f.command)).status,'APPLIED','verified null absence permits append');
    // Missing C5.1 histories: actual prepared grandchild and retained selection.
    const lineage=await fixture();
    const child=await lineage.h.api.prepareOwnerInvoiceDispatch(document(3,{parentIssuanceId:lineage.b.issuanceId,reissueReason:'Further contact correction',guest:{name:'Changed',email:'changed@example.com',phone:'9876543210'}}));
    assert.equal(child.status,'durably_prepared');
    const command={...lineage.command,invoiceRevisionId:child.issuanceId};
    const unselected=clone(lineage.h.retained);lineage.h.trace.length=0;
    const selected=await callAssociation(lineage.h,command);assert.equal(selected.status,'APPLIED');
    assert.deepEqual(mutations(lineage.h),[['insert','BookingCurrentRevisions',selected.revisionId]]);
    const retainedSelection=clone(lineage.h.retained);
    for(const mode of ['associate','status']){
      const storage=mode==='associate'?unselected:retainedSelection;
      const invoke=h=>mode==='associate'?callAssociation(h,command):callStatus(h,lineage.a.issuanceId);
      const good=await harness(clone(storage));const positive=await invoke(good);
      assert.equal(mode==='associate'?positive.status:positive.documentCurrent.status,mode==='associate'?'APPLIED':'CURRENT');
      assert.deepEqual(plain(positive.documentCurrent),{status:'CURRENT',revisionId:selected.revisionId,invoiceRevisionId:child.issuanceId,changes:command.changes});
      if(mode==='status')noMutations(good);
      // Bind fault sites to exact selected/ancestor IDs, not an unselected root read.
      const targets=mode==='associate'?[lineage.b.issuanceId]:[child.issuanceId,lineage.b.issuanceId];
      for(const target of targets){
        const positions=good.trace.map((x,i)=>[x,i]).filter(([x])=>x[0]==='get'&&x[1]==='InvoiceEmailJournal'&&x[2]===target).map(([,i])=>i);
        assert.ok(positions.length>0,'required selected/ancestor read reached');
        for(const position of positions)for(const fault of ['undefined','throw']){
          const h=await harness(clone(storage));let hit=false;
          h.hooks.get=(col,id,value)=>{if(h.trace.length-1===position){assert.equal(col,'InvoiceEmailJournal');assert.equal(id,target);hit=true;if(fault==='throw')throw Error('lineage read unavailable');return undefined;}return value;};
          const result=await invoke(h);assert.equal(hit,true);assert.ok(h.trace.length<1000);noEffects(h);
          if(mode==='associate')assert.equal(result.status,'UNRESOLVED');
          else{assert.equal(result.status,'preparation_retryable');assert.equal(result.issuanceId,lineage.a.issuanceId);assert.equal(result.revision,uuid(1));assert.deepEqual(plain(result.documentCurrent),{status:'UNRESOLVED'});}
          const expected=good.trace.slice(0,position).filter(x=>x[0]==='insert');
          assert.deepEqual(mutations(h),expected,'only insertion already authorized before read fault');
          const expectedStorage=clone(storage);for(const x of expected)expectedStorage.set(x[1]+':'+x[2],clone(good.retained.get(x[1]+':'+x[2])));
          assert.deepEqual([...h.retained],[...expectedStorage],'retained history and any authorized winner preserved');
          assert.equal(journalSnapshot(h),journalSnapshot({retained:storage}));
        }
      }
    }
  });
  await test('C5.2',async()=>{
    for(const unreadable of [false,true]){
      const {h,a,command:c}=await fixture();let inserted=false;h.hooks.after=(op,col)=>{if(op==='insert'&&col==='BookingCurrentRevisions'){inserted=true;throw Error('lost ACK after apply');}};
      h.hooks.get=(col,_id,v)=>inserted&&unreadable&&col==='BookingCurrentRevisions'?undefined:v;
      const r=await callAssociation(h,c);assert.equal(r.status,unreadable?'UNRESOLVED':'APPLIED');assert.equal(mutations(h).length,1);noEffects(h);const before=clone([...h.retained]);
      const fresh=await harness(h.retained);assert.equal((await callAssociation(fresh,c)).status,'APPLIED');assert.equal((await callStatus(fresh,a.issuanceId)).documentCurrent.status,'CURRENT');noMutations(fresh);assert.deepEqual([...h.retained],before);
    }
  });
  await test('C5.3',async()=>{
    const {h,a,command:c}=await fixture();let previous=null;const commands=[];
    // Unchanged production 256-read limit: 255 rows plus verified successor absence.
    for(let n=0;n<255;n++){const next={...c,previousRevisionId:previous,commandId:'chain-'+n};commands.push(next);const r=await callAssociation(h,next);assert.equal(r.status,'APPLIED','supported append '+n);previous=r.revisionId;}
    assert.equal((await callStatus(h,a.issuanceId)).documentCurrent.revisionId,previous);h.trace.length=0;const before=clone([...h.retained]);const next={...c,previousRevisionId:previous,commandId:'exhausted'};assert.equal((await callAssociation(h,next)).status,'UNRESOLVED');noMutations(h);assert.deepEqual([...h.retained],before);
    const fresh=await harness(h.retained);for(const cmd of [commands[0],commands.at(-1)])assert.equal((await callAssociation(fresh,cmd)).status,'APPLIED');assert.equal((await callStatus(fresh,a.issuanceId)).documentCurrent.revisionId,previous);noMutations(fresh);
    // Explicit unsupported retained-history seam, not an authorized append.
    const row=revisionRow(c,previous,255);h.retained.set('BookingCurrentRevisions:'+row._id,row);const exhausted=await harness(h.retained);assert.equal((await callStatus(exhausted,a.issuanceId)).documentCurrent.status,'UNRESOLVED');assert.equal((await callAssociation(exhausted,next)).status,'UNRESOLVED');noMutations(exhausted);
  });
  await test('C6.1',async()=>{
    for(const stage of ['prestart','start','ack']){
      const f=await fixture();assert.equal((await callAssociation(f.h,f.command)).status,'APPLIED');seedDeliveryHistory(f.h,f.a.issuanceId,stage);
      const before=clone([...f.h.retained]);const fresh=await harness(f.h.retained);const legacy=plain(await fresh.api.getOwnerInvoiceDispatch(f.a.issuanceId));const {documentCurrent,...delivery}=plain(await callStatus(fresh,f.a.issuanceId));
      assert.deepEqual(delivery,legacy);assert.equal(delivery.issuanceId,f.a.issuanceId);assert.equal(delivery.revision,uuid(1));assert.equal(delivery.status,{prestart:'preparation_retryable',start:'owner_review_required',ack:'provider_accepted'}[stage]);if(stage==='ack')assert.equal(delivery.providerMessageId,'fixture-provider-id');assert.equal(documentCurrent.status,'CURRENT');noMutations(fresh);assert.deepEqual([...f.h.retained],before);
    }
  });
  await test('C6.2',async()=>{
    for(const outcome of ['success','denied','unresolved']){
      const f=await fixture();const witnesses=[['Bookings:confirmed',{_id:'confirmed',status:'confirmed',guestEmail:'original@example.com'}],['Bookings:pending',{_id:'pending',status:'pending',guestEmail:'pending@example.com'}]];for(const [k,v] of witnesses)f.h.retained.set(k,clone(v));const historical=journalSnapshot(f.h);
      let c=f.command;if(outcome==='denied')c={...c,changes:{...c.changes,guestEmail:'foreign@example.com'}};if(outcome==='unresolved')f.h.hooks.get=(col,id,v)=>col==='BookingCurrentRevisions'?undefined:v;
      const r=await callAssociation(f.h,c);assert.equal(r.status,{success:'APPLIED',denied:'DENIED',unresolved:'UNRESOLVED'}[outcome]);await callStatus(f.h,f.a.issuanceId);for(const [k,v] of witnesses)assert.deepEqual(f.h.retained.get(k),v);assert.equal(journalSnapshot(f.h),historical);noEffects(f.h);assert.ok(f.h.trace.every(x=>x[1]!=='Bookings'));
      assert.deepEqual(mutations(f.h),outcome==='success'?[['insert','BookingCurrentRevisions',r.revisionId]]:[]);
      const beforeStatus=clone([...f.h.retained]);f.h.trace.length=0;
      const status=await callStatus(f.h,f.a.issuanceId);
      assert.equal(status.status,'preparation_retryable');assert.equal(status.issuanceId,f.a.issuanceId);assert.equal(status.revision,uuid(1));
      const expectedCurrent=outcome==='unresolved'?{status:'UNRESOLVED'}:outcome==='success'?{status:'CURRENT',revisionId:r.revisionId,invoiceRevisionId:f.b.issuanceId,changes:f.command.changes}:{status:'CURRENT',revisionId:null,invoiceRevisionId:null,changes:{guestName:'Original',guestEmail:'original@example.com',guestPhone:'1234567890'}};
      assert.deepEqual(plain(status.documentCurrent),expectedCurrent,'denied association leaves original-root CURRENT, not denied status');
      noMutations(f.h);assert.ok(f.h.trace.length>0&&f.h.trace.every(x=>x[1]!=='Bookings'));assert.deepEqual([...f.h.retained],beforeStatus);
      // Explicit status denial with the same confirmed/pending witnesses retained.
      f.h.user.loggedIn=false;f.h.trace.length=0;
      await assert.rejects(()=>callStatus(f.h,f.a.issuanceId),/owner_invoice_actor_required/);
      assert.deepEqual(f.h.trace,[]);assert.deepEqual([...f.h.retained],beforeStatus);
      for(const [k,v] of witnesses)assert.deepEqual(f.h.retained.get(k),v);assert.equal(journalSnapshot(f.h),historical);
    }
  });
  await test('C6.3',async()=>{
    const {h,a}=await fixture();assert.deepEqual(Object.keys(plain(a)).sort(),['documentDigest','issuanceId','revision','status']);assert.equal(a.status,'durably_prepared');h.trace.length=0;
    assert.deepEqual(plain(await h.api.getOwnerInvoiceDispatch(a.issuanceId)),{issuanceId:a.issuanceId,invoiceNumber:'TEST-1',revision:uuid(1),purpose:'guest_invoice',status:'preparation_retryable',classification:'pending_prestart',needsOwnerReview:false});noMutations(h);
    const off=await harness(h.retained,false);await assert.rejects(()=>off.api.prepareOwnerInvoiceDispatch(document(3)),/disabled/);await assert.rejects(()=>callStatus(off,a.issuanceId),/disabled/);assert.deepEqual(off.trace,[]);
    assert.match(fs.readFileSync(path.join(root,'velo/backend/invoiceEmailJournal.js'),'utf8'),/const OWNER_INVOICE_REQUEST_RECOVERY_ENABLED = false;/);
  });
  const expected=['C1.1','C1.2','C2.1','C2.2','C2.3','C3.1','C3.2','C3.3','C4.1','C4.2','C5.1','C5.2','C5.3','C6.1','C6.2','C6.3'];
  assert.deepEqual(done,expected);assert.equal(new Set(done).size,expected.length);
  console.log(JSON.stringify({executed:done,evidence:'inert actual consumer; synthetic corrupt/stage seams explicitly labeled; no live proof'}));
}
function seedDeliveryHistory(h,id,stage) {
  // Valid synthetic retained effect history; no provider/send endpoint is invoked.
  if(stage==='prestart')return;const root=h.retained.get('InvoiceEmailJournal:'+id);const bytes=Buffer.from('inert MIME fixture');const digest=sha(bytes);
  const chunk={_id:journalKey('invoice-artifact-chunk/v1',digest),kind:'ARTIFACT_CHUNK',data:bytes.toString('base64'),digest};
  const artifact={_id:journalKey('invoice-artifact/v1',id),kind:'ARTIFACT',issuanceId:id,documentDigest:root.documentDigest,to:root.to,cc:root.cc,from:root.from,chunkIds:[chunk._id],mimeDigest:digest,byteLength:bytes.length,pdfDigest:sha('inert PDF'),rendererVersion:'fixture'};
  const artifactDigest=sha(canonical(artifact));const start={_id:journalKey('invoice-send-start/v1',id),kind:'START',issuanceId:id,documentDigest:root.documentDigest,artifactDigest,workerBootId:'fixture-boot',invocationNonce:'fixture-nonce'};
  for(const row of [chunk,artifact,start])h.retained.set('InvoiceEmailJournal:'+row._id,row);
  if(stage==='ack'){const ack={_id:journalKey('invoice-send-ack/v1',id),kind:'ACK',issuanceId:id,documentDigest:root.documentDigest,artifactDigest,invocationNonce:start.invocationNonce,to:root.to,cc:root.cc,from:root.from,providerMessageId:'fixture-provider-id',status:'provider_accepted'};h.retained.set('InvoiceEmailJournal:'+ack._id,ack);}
}
if (require.main === module) main().catch(e => {console.error(e);process.exitCode=1;});
