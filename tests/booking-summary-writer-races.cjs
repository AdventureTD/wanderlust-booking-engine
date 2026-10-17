'use strict';
// Round-4 writer policy: field-scoped conditional patches (documented direct-form
// items.patch; fake models only documented semantics; elevation recorded, not
// proven) and monotonic reporting. Offline, inert data only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const {makeDataItemsFake}=require('./summary-patch-fake.cjs');
const SECRET='INERT_PRICING_SECRET_NOT_LIVE_0123456789';
const deferred=()=>{let release;const p=new Promise(r=>release=r);return {p,release};};
const tick=()=>new Promise(r=>setImmediate(r));

function world(o={}){
 const rows=new Map();let now=Date.parse('2027-01-01T12:00:00Z');const gates=[];
 const store={get:(c,id)=>{assert.equal(c,'BookingSummary');return rows.get(id);},set:(c,id,row)=>rows.set(id,row)};
 const fake=makeDataItemsFake(store,{beforePatch:async x=>{for(const g of gates)if(g.match(x))await g.p;if(o.onPatch)await o.onPatch(x,api);}});
 const sdk={query(){const f=[];return {eq(k,v){f.push(r=>r[k]===v);return this;},limit(){return this;},async find(){if(o.onFind)await o.onFind(api);return {items:[...rows.values()].filter(r=>f.every(x=>x(r))).map(r=>structuredClone(r))};}};},async update(){throw Error('FULL-ROW UPDATE FORBIDDEN');},async insert(){throw Error('UNEXPECTED_INSERT');}};
 class FakeDate extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const context=vm.createContext({Date:FakeDate,Buffer,URLSearchParams,console:{log(){},error(){}}});
 const external={...fake.externals,'crypto':{default:crypto},'wix-data':{default:sdk},'wix-web-module':{Permissions:{Anyone:'Anyone',Admin:'Admin'},webMethod:(_,f)=>f},'wix-secrets-backend':{getSecret:async()=>SECRET}};
 const cache=new Map();
 function load(s){if(cache.has(s))return cache.get(s);const e=external[s];let m;if(e)m=new vm.SyntheticModule(Object.keys(e),function(){for(const k of Object.keys(e))this.setExport(k,e[k]);},{context});
  else{assert.ok(['backend/bookingSummaryCapability','backend/bookingSummaryReporting.web','backend/bookingSummaryWriter'].includes(s),'unadmitted '+s);m=new vm.SourceTextModule(read('velo/'+s+'.js'),{context,identifier:s});}cache.set(s,m);return m;}
 async function mod(s){const m=load(s);if(m.status==='unlinked')await m.link(load);if(m.status==='linked')await m.evaluate();return m.namespace;}
 const api={rows,calls:fake.calls,mod,advance:ms=>{now+=ms;},hold:match=>{const d=deferred();gates.push({match,p:d.p});return d.release;},
  seed:(id,bn,x={})=>rows.set(id,{_id:id,bookingNumber:bn,notes:'ORIGINAL_NOTE',status:'confirmed',grandTotal:100,roomCount:1,gclid:'INERT_G',gbraid:'',wbraid:'',msclkid:'INERT_MS',
   firstPaidTouch:{capturedAt:'2026-12-31T00:00:00.000Z',gclid:'INERT_G',gbraid:'',wbraid:'',msclkid:''},latestPaidTouch:{capturedAt:'2027-01-01T00:00:00.000Z',gclid:'',gbraid:'',wbraid:'',msclkid:'INERT_MS'},
   googleConversionUploaded:false,microsoftConversionUploaded:false,cancellationSettlement:'',...x})};
 return api;
}
async function modules(w){return {cap:await w.mod('backend/bookingSummaryCapability'),rep:await w.mod('backend/bookingSummaryReporting.web'),writer:await w.mod('backend/bookingSummaryWriter')};}
const cleared=r=>r.gclid===''&&r.gbraid===''&&r.wbraid===''&&r.msclkid===''&&r.firstPaidTouch===null&&r.latestPaidTouch===null;
const fp=x=>x.fieldModifications.map(m=>m.fieldPath);
const has=(fields,x)=>JSON.stringify(fp(x))===JSON.stringify(fields);

test('writer: each operation is one conditional direct-form patch of a fixed field set; elevation only on public paths',async()=>{
 const w=world();w.seed('S','WC-1');const {writer}=await modules(w);
 await writer.patchSummaryRefresh('S','WC-1',{checkIn:'a',checkOut:'b',roomCount:2,status:'confirmed',notes:'n',guestName:'',guestEmail:'x@example.invalid',marketSource:undefined,packageTitle:null,injected:'EVIL',gclid:'EVIL',googleConversionUploaded:false,microsoftConversionUploaded:false,cancellationSettlement:'EVIL',status2:'EVIL'},{gclid:'STALE',firstPaidTouch:{gclid:'STALE'},latestPaidTouch:null});
 await writer.clearSummaryReporting('S','WC-1');
 await writer.setSummaryFlag('S','WC-1','microsoftConversionUploaded');
 await writer.setSummaryFlag('S','WC-1','googleConversionUploaded',{suppressHooks:true});
 await writer.setSummaryFlag('S','WC-1','microsoftConversionUploaded',{elevated:false});
 await writer.setSummaryCancellation('S','WC-1','NONE','INERT');
 await writer.mirrorSummaryDates('S','WC-1','c','d','e');
 const c=w.calls;assert.equal(c.length,7);
 assert.equal(JSON.stringify(c.map(x=>x.fields)),JSON.stringify([['checkIn','checkOut','roomCount','status','notes','guestEmail','latestPaidTouch'],['gclid','gbraid','wbraid','msclkid','firstPaidTouch','latestPaidTouch'],['microsoftConversionUploaded'],['googleConversionUploaded'],['microsoftConversionUploaded'],['status','cancellationSettlement','cancellationReason'],['checkIn','checkOut','bookingDate']]));
 assert.equal(JSON.stringify(c.map(x=>x.elevated)),JSON.stringify([true,true,true,true,false,false,true]));
 assert.ok(c.every(x=>x.collection==='BookingSummary'&&x.options.condition),'every patch is conditional on bookingNumber');
 assert.equal(JSON.stringify(c.map(x=>x.options.suppressHooks)),JSON.stringify([false,false,false,true,false,true,false]));
 for(const bad of [['S','WC-1','status'],['S','WC-1','__proto__']])await assert.rejects(writer.setSummaryFlag(...bad));
 for(const [id,bn] of [['','WC-1'],['S',''],['S/..','WC-1'],[{},'WC-1']])await assert.rejects(writer.clearSummaryReporting(id,bn));
 await assert.rejects(writer.clearSummaryReporting('S','WC-OTHER'),/condition/,'condition binds the row to its bookingNumber');
 assert.equal(c.length,8,'invalid inputs never dispatch; condition miss dispatches and fails closed');
});

test('W1 refresh is monotonic: explicit non-empty reporting is ignored on existing rows; explicit null clears',async()=>{
 const w=world();w.seed('S','WC-2');const {writer}=await modules(w);
 await writer.clearSummaryReporting('S','WC-2');
 await writer.patchSummaryRefresh('S','WC-2',{roomCount:2},{gclid:'STALE_G',msclkid:'STALE_MS',firstPaidTouch:{capturedAt:'2026-01-01T00:00:00.000Z',gclid:'STALE_G',gbraid:'',wbraid:'',msclkid:''},latestPaidTouch:{capturedAt:'2026-01-01T00:00:00.000Z',gclid:'',gbraid:'',wbraid:'',msclkid:'STALE_MS'}});
 assert.ok(cleared(w.rows.get('S')),'stale explicit reporting cannot resurrect');assert.equal(w.rows.get('S').roomCount,2);
 w.seed('T','WC-3');await writer.patchSummaryRefresh('T','WC-3',{},{firstPaidTouch:null});
 assert.equal(w.rows.get('T').firstPaidTouch,null);assert.equal(w.rows.get('T').latestPaidTouch.msclkid,'INERT_MS','omitted touch untouched');assert.equal(w.rows.get('T').gclid,'INERT_G','legacy untouched');
});

for(const [name,setup] of [
 ['I1 mark delayed after completed clear: identifiers stay cleared, flag set',async(w,m,t)=>{const rel=w.hold(x=>has(['microsoftConversionUploaded'],x));const mark=m.cap.markMicrosoftConversionUploaded('WC-9',t);await tick();assert.equal((await m.rep.clearBookingSummaryReporting('WC-9',t)).ok,true);rel();assert.equal(await mark,true);}],
 ['I2 clear delayed after completed mark: flag stays set, identifiers cleared',async(w,m,t)=>{const rel=w.hold(x=>fp(x).includes('gclid'));const clear=m.rep.clearBookingSummaryReporting('WC-9',t);await tick();assert.equal(await m.cap.markMicrosoftConversionUploaded('WC-9',t),true);rel();assert.equal((await clear).ok,true);}],
 ['I3 clear delayed across concurrent aggregate/cancellation/journal/date writers: all preserved',async(w,m,t)=>{const rel=w.hold(x=>fp(x).includes('gclid'));const clear=m.rep.clearBookingSummaryReporting('WC-9',t);await tick();
   await m.writer.patchSummaryRefresh('S','WC-9',{notes:'CONCURRENT_NOTE',roomCount:3,status:'confirmed'},{});await m.writer.setSummaryFlag('S','WC-9','googleConversionUploaded',{suppressHooks:true});await m.writer.mirrorSummaryDates('S','WC-9','2027-02-01','2027-02-02','2027-01-01');await m.writer.setSummaryCancellation('S','WC-9','NONE','INERT_REASON');rel();assert.equal((await clear).ok,true);}],
 ['I3b refresh carrying explicit stale reporting delayed past the clear: no resurrection',async(w,m,t)=>{const rel=w.hold(x=>fp(x).includes('roomCount'));const refresh=m.writer.patchSummaryRefresh('S','WC-9',{roomCount:2},{gclid:'INERT_G',firstPaidTouch:{gclid:'INERT_G'},latestPaidTouch:{msclkid:'INERT_MS'}});await tick();assert.equal((await m.rep.clearBookingSummaryReporting('WC-9',t)).ok,true);rel();await refresh;}]
]) test(name,async()=>{
 const w=world();w.seed('S','WC-9');const m=await modules(w);const t=await m.cap.mintSummaryCapability('WC-9','S');
 await setup(w,m,t);const s=w.rows.get('S');
 assert.ok(cleared(s),'reporting cleared at the end: '+JSON.stringify({g:s.gclid,f:s.firstPaidTouch}));
 if(name.startsWith('I1')||name.startsWith('I2'))assert.equal(s.microsoftConversionUploaded,true);
 if(name.startsWith('I3 ')){assert.equal(s.notes,'CONCURRENT_NOTE');assert.equal(s.roomCount,3);assert.equal(s.googleConversionUploaded,true);assert.equal(s.checkIn,'2027-02-01');assert.equal(s.status,'Cancelled');assert.equal(s.cancellationReason,'INERT_REASON');}
 assert.equal(s.grandTotal,100,'unlisted field never dropped');
});

test('I4 row deleted/recreated between verify and dispatch: old id patch fails closed; new row untouched',async()=>{
 const w=world();w.seed('A','WC-4');const m=await modules(w);const t=await m.cap.mintSummaryCapability('WC-4','A');
 const rel=w.hold(x=>x.itemId==='A');const clear=m.rep.clearBookingSummaryReporting('WC-4',t);await tick();
 w.rows.delete('A');w.seed('B','WC-4');rel();
 assert.equal(JSON.stringify(await clear),'{"ok":false,"reasonCode":"UNAVAILABLE"}');assert.equal(w.rows.has('A'),false,'no upsert');assert.equal(w.rows.get('B').gclid,'INERT_G');
 // Same _id reused for a different booking: the condition fails closed.
 const w2=world();w2.seed('A','WC-5');const m2=await modules(w2);const t2=await m2.cap.mintSummaryCapability('WC-5','A');
 const rel2=w2.hold(x=>x.itemId==='A');const c2=m2.rep.clearBookingSummaryReporting('WC-5',t2);await tick();w2.rows.set('A',{...w2.rows.get('A'),bookingNumber:'WC-OTHER'});rel2();
 assert.equal((await c2).ok,false);assert.equal(w2.rows.get('A').gclid,'INERT_G');
});

test('I5 expiry: rechecked after the verify awaits and immediately before dispatch; no patch when invalid (clear and mark separately)',async()=>{
 for(const op of ['clear','mark']){
  const w=world({onFind:async a=>a.advance(2000)});w.seed('S','WC-6');const m=await modules(w);
  const t=await m.cap.mintSummaryCapability('WC-6','S');w.advance(30*60*1000-1000);
  if(op==='clear')assert.equal((await m.rep.clearBookingSummaryReporting('WC-6',t)).ok,false);else assert.equal(await m.cap.markMicrosoftConversionUploaded('WC-6',t),false);
  assert.equal(w.calls.length,0,op+': no patch dispatched');assert.equal(w.rows.get('S').gclid,'INERT_G');assert.equal(w.rows.get('S').microsoftConversionUploaded,false);
 }
});

test('I6 Google journal flag and Microsoft mark concurrent (normal flow): both flags set',async()=>{
 const w=world();w.seed('S','WC-7');const m=await modules(w);const t=await m.cap.mintSummaryCapability('WC-7','S');
 const rel=w.hold(x=>has(['googleConversionUploaded'],x));const g=m.writer.setSummaryFlag('S','WC-7','googleConversionUploaded',{suppressHooks:true});await tick();
 assert.equal(await m.cap.markMicrosoftConversionUploaded('WC-7',t),true);rel();await g;
 assert.equal(w.rows.get('S').googleConversionUploaded,true);assert.equal(w.rows.get('S').microsoftConversionUploaded,true);
});

test('residual (documented, not a guarantee): same-field aggregate writers are last-writer-wins',async()=>{
 const w=world();w.seed('S','WC-8');const {writer}=await modules(w);
 const rel=w.hold(x=>has(['checkIn','checkOut','bookingDate'],x));const mirror=writer.mirrorSummaryDates('S','WC-8','MIRROR_IN','MIRROR_OUT','D');await tick();
 await writer.patchSummaryRefresh('S','WC-8',{checkIn:'REFRESH_IN',checkOut:'REFRESH_OUT'},{});rel();await mirror;
 assert.equal(w.rows.get('S').checkIn,'MIRROR_IN','LWW on shared aggregate fields; outside the withdrawal claim');
});

// Actual createBooking/updateBookingSummary (offline producer): delayed or second-caller
// additional-room calls carrying stale explicit reporting cannot resurrect a clear.
function support(file,boundary,name){const source=read('tests/'+file),i=source.indexOf(boundary);assert.ok(i>0);const box={require,__dirname,console,structuredClone,Buffer,URL,URLSearchParams,Date,setTimeout,clearTimeout};vm.runInNewContext(source.slice(0,i)+'\nthis.factory='+name+';',box);return box.factory;}
for(const mode of ['delayed-additional-room','second-caller-after-clear','retried-additional-room'])test('actual createBooking: '+mode+' with stale explicit legacy IDs and retained paid touches cannot resurrect cleared reporting',{timeout:10000},async()=>{
 const f=await support('google-ads-fresh-producer.cjs','function support','producer')();
 const touch=(id,ms)=>({capturedAt:new Date(Date.now()-86400000).toISOString(),gclid:id,gbraid:'',wbraid:'',msclkid:ms});
 const base={checkIn:'2027-01-01',checkOut:'2027-01-02',quantity:1,status:'confirmed',guestName:'Inert',guestEmail:'inert@example.invalid',guestPhone:'2025550100',packageId:'INERT_PACKAGE',pricingQuoteToken:f.quote.token,
  gclid:'INERT_STALE_G',msclkid:'INERT_STALE_MS',firstPaidTouch:touch('INERT_STALE_G',''),latestPaidTouch:touch('','INERT_STALE_MS')};
 const r1=await f.availability.createBooking({...base,roomCode:'adventure_suite',guests:2});
 assert.ok(r1.summaryCapability);const bn=r1.bookingNumber;
 const row=()=>[...f.rows].find(([k])=>k.startsWith('BookingSummary:'))[1];
 assert.equal(row().gclid,'INERT_STALE_G');
 const stale={...base,roomCode:'two_bedroom_apartment',guests:3,bookingNumber:bn};
 if(mode==='delayed-additional-room'){
  let release;const gate=new Promise(r=>release=r);f.patchHooks.before=async x=>{if(x.fieldModifications.some(m=>m.fieldPath==='roomCount')){f.patchHooks.before=null;await gate;}};
  const room2=f.availability.createBooking(stale);
  for(let i=0;i<500&&f.patchHooks.before;i++)await tick();
  assert.equal(f.patchHooks.before,null,'room-2 refresh patch is held at dispatch before the clear');
  assert.equal(JSON.stringify(await f.reporting.clearBookingSummaryReporting(bn,r1.summaryCapability)),'{"ok":true}');release();const r2=await room2;assert.equal(r2.bookingNumber,bn);
 } else {
  assert.equal(JSON.stringify(await f.reporting.clearBookingSummaryReporting(bn,r1.summaryCapability)),'{"ok":true}');
  const r2=await f.availability.createBooking(stale);assert.equal(r2.bookingNumber,bn);assert.equal(r2.summaryCapability,undefined);
  if(mode==='retried-additional-room')await f.availability.createBooking({...stale,roomCode:'penthouse_apartment',guests:1}).catch(()=>{});
 }
 const s=row();assert.ok(cleared(s),mode+': '+JSON.stringify({g:s.gclid,ms:s.msclkid,f:s.firstPaidTouch,l:s.latestPaidTouch}));
 assert.ok(s.roomCount>=2,'aggregate still refreshed');assert.equal(s.guestEmail,'inert@example.invalid');
});

test('static: no full-row BookingSummary writes; elevation and direct-form patch only in the writer; W9 admin builder patch is the only other patch site',()=>{
 const dir=path.join(root,'velo/backend'),files=fs.readdirSync(dir).filter(f=>f.endsWith('.js'));
 for(const f of files){const s=read('velo/backend/'+f);
  assert.equal(/wixData\s*\.\s*(update|save|bulkUpdate|bulkSave)\s*\(\s*(['"]BookingSummary['"]|BOOKING_SUMMARIES)/.test(s),false,f+' full-row BookingSummary write');
  if(f!=='bookingSummaryWriter.js')assert.equal(/@wix\/essentials|wix-auth|elevate\s*\(/.test(s),false,f+' elevation outside writer');
  if(!['bookingSummaryWriter.js','adminConsole.web.js'].includes(f))assert.equal(/items\s*\.\s*patch\s*\(/.test(s),false,f+' patch outside writer/admin');}
 const admin=read('velo/backend/adminConsole.web.js');assert.deepEqual([...admin.matchAll(/items\s*\.\s*patch\s*\(([^)]*)\)/g)].map(x=>x[1]),['collection,id'],'W9: one Admin-only builder patch (no elevation, no condition); excluded from claims, see docs');
 const w=read('velo/backend/bookingSummaryWriter.js');assert.equal(/webMethod|wix-web-module/.test(w),false);
 assert.equal((w.match(/run\(COLLECTION, itemId, modifications, options\)/g)||[]).length,1,'single dispatch site');
 assert.ok(/condition: items\.filter\(\)\.eq\('bookingNumber', bookingNumber\)/.test(w),'every dispatch is conditional');
 const insert=(read('velo/backend/availability.web.js').match(/wixData\.insert\(BOOKING_SUMMARIES/g)||[]).length;assert.equal(insert,1,'P1 insert only');
});
