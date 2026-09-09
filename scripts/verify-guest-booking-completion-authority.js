'use strict';
// Only this dedicated ordinary reader suite runs. No imported verifier/wrapper.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),fixtures=path.join(__dirname,'fixtures'),NOW=1800000000000;
const pins=JSON.parse(fs.readFileSync(path.join(fixtures,'completion-authority-dependencies.json'))).files;
const newModules=new Set(['backend/guestBookingCompletionAuthority','backend/guestBookingInvoiceAuthorityConfig']);
const digest=(domain,text)=>crypto.createHash('sha256').update(domain+'\0'+text).digest('hex');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonicalDependencyPins={"99d710d44db65e524d4a5fdef175a73f8cfa111598e248b781ee003260768d22":"6bc0520cb3940b0399f43d8f5df7b493c666f221621bb80bc3e7004c8de89899","16572380e1d0594a860d685965699d630bfbf6c59d4c6f518dc391cdaf104a1c":"9d685cc29821181e482c84cf1d9ecf0fd463fc03dbf12617d3fcfb76e9dd46b2","67cb28960e810558482d26d87e264f75fd47c406089a2be99746037ffca77163":"578b42bcc63c28720b9a08aae9dea42761a42febcfc62449efe5313a7164b6f4"};
for(const [p,h] of Object.entries(pins))assert.equal(sha(fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n')),canonicalDependencyPins[h]||h,p);
function subject(db,{writer=false,hook=()=>{},mutateSource=(n,s)=>s,mutateApi=()=>{}}={}){
 const trace=[],ctx=vm.createContext({Buffer}),realm=x=>vm.runInContext('('+JSON.stringify(x)+')',ctx),modules={};
 ctx.clock=()=>NOW;vm.runInContext('Date.now=()=>clock()',ctx);
 const wix={query(c){const predicates=[];let n=100,sort=false;const q={eq(k,v){predicates.push([k,v,false]);return q;},gt(k,v){predicates.push([k,v,true]);return q;},limit(v){n=v;return q;},ascending(k){assert.equal(k,'_id');sort=true;return q;},async find(o){trace.push({op:'find',c,predicates:structuredClone(predicates),n});assert.deepEqual(JSON.parse(JSON.stringify(o)),{suppressAuth:true,suppressHooks:true,consistentRead:true});const injected=await hook({c,predicates,trace,db});let rows=injected?.rows||(db.rows[c]||[]).filter(r=>predicates.every(([k,v,gt])=>gt?r[k]>v:r[k]===v));if(sort)rows=rows.slice().sort((a,b)=>a._id<b._id?-1:a._id>b._id?1:0);return {items:realm(rows.slice(0,n)),hasNext(){return rows.length>n;}};}};return q;},async insert(c,r,o){trace.push({op:'insert',c});assert.ok(writer,'reader SDK insertion forbidden');const row=JSON.parse(JSON.stringify(r));db.rows[c]??=[];if(db.rows[c].some(v=>v._id===row._id))throw Error('duplicate');db.rows[c].push(row);return realm(row);}};
 const inertCrypto=Object.assign({},crypto,{randomBytes(n){trace.push({op:'rng'});assert.ok(writer,'reader RNG forbidden');return crypto.randomBytes(n);}});
 Object.assign(modules,{crypto:inertCrypto,buffer:{Buffer},'wix-data':wix,'wix-auth':{elevate:f=>f},'wix-secrets-backend.v2':{secrets:{async getSecretValue(n){trace.push({op:'secret',n});if(db.secretFailure)throw Error('unreadable');return realm({value:n==='WBE_PRICING_QUOTE_SECRET'?'PUBLIC-READER-QUOTE-FIXTURE-ONLY-KEY':n==='WBE_GUEST_BOOKING_ISSUER_CONFIG'?JSON.stringify(db.config):JSON.stringify(db.keys)});}}}});
 function load(name){if(Object.hasOwn(modules,name))return modules[name];assert.match(name,/^backend\/[A-Za-z0-9]+$/,'canonical loader path');assert.ok(newModules.has(name)||Object.hasOwn(pins,'velo/'+name+'.js'),'closed dependency '+name);const names=[];let source=mutateSource(name,fs.readFileSync(path.join(root,'velo',name+'.js'),'utf8'));source=source.replace(/^import (.+) from '([^']+)';$/gm,(_,binding,spec)=>{load(spec);return `const ${binding}=imports[${JSON.stringify(spec)}];`;}).replace(/export (async )?function (\w+)/g,(_,a,n)=>{names.push(n);return (a||'')+'function '+n;});ctx.imports=modules;const api=vm.runInContext('(function(){'+source+';return {'+names.join(',')+'};})()',ctx,{filename:name});
 if(!writer&&name==='backend/guestBookingPhysicalAcquisitionEvidence'){const factory=api.createGuestBookingPhysicalAcquisitionSession;api.createGuestBookingPhysicalAcquisitionSession=()=>{const s=factory();for(const key of ['reserveReadback','reconcileControl','reconcileResource'])s[key]=()=>{trace.push({op:key});throw Error('forbidden mutation capability');};const store=s.completionStore();for(const key of ['insert','reserveSelection'])store[key]=()=>{trace.push({op:key});throw Error('forbidden mutation capability');};return s;};}
 mutateApi(name,api,trace);return modules[name]=api;
 }
 return {load,trace,realm,wix};
}
async function produce(){
 const revision=JSON.stringify({v:1,package:{id:'package',nights:2,baseRate:100.005,priceModifier:1},penthouseRoomFee:10.005,propertyFeeRate:0.05,taxRateAccommodation:0.1,taxRateStandard:0.15,promos:[]});
 const db={rows:{GuestBookingFinancialRevisions:[{_id:'revision-1',revisionBytes:revision}],GuestBookingAcceptances:[],GuestBookingAllocationManifests:[],GuestBookingAcquisitionControls:[],RoomBookingClaimEvents:[],Bookings:[],BookingSummary:[],GuestBookingCompletions:[]},config:{v:1,revisionId:'revision-1',revisionDigest:digest('wbe.financial-revision.v1',revision),numberPrefix:'TEST-'},keys:{audience:'wbe:fixture',activeKid:'fixture',keys:[{kid:'fixture',keyHex:'12'.repeat(32)}]}};
 const s=subject(db,{writer:true});const q={v:1,nonce:'000102030405060708090a0b',issuedAt:NOW,expiresAt:NOW+3600000,checkIn:'2027-01-01',checkOut:'2027-01-03',nights:2,packageId:'package',packageTitle:'Reader fixture stay',baseRate:100.005,priceModifier:1,totalPerPerson:100.005};const p=Buffer.from(JSON.stringify(q)).toString('base64url');
 const input={v:1,checkIn:q.checkIn,checkOut:q.checkOut,packageId:'package',pricingQuoteToken:p+'.'+crypto.createHmac('sha256','PUBLIC-READER-QUOTE-FIXTURE-ONLY-KEY').update(p).digest('base64url'),promoCode:'',guestName:'Fixture Guest',guestEmail:'fixture@example.test',guestPhone:'1234567',dialingCode:'1',note:'Café 李',marketSource:'',gclid:'',gbraid:'',wbraid:'',msclkid:'',priceGroups:[{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:1,guests:2}]};
 const offer=await s.load('backend/guestBookingOfferIssuer').issueGuestBookingOffer(s.realm(input));assert.notEqual(offer,'DENIED','actual offer setup');assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule)).status,'ACCEPTED_PENDING');
 const discovery=await s.load('backend/guestBookingAcceptanceDiscovery').discoverGuestBookingAcceptances(null);assert.equal(discovery.contexts.length,1);const c=discovery.contexts[0],expected={acceptanceId:c.acceptanceId,operationId:c.operationId,rootDigest:c.rootDigest};assert.equal(expected.acceptanceId,digest('wbe.acceptance-id.v2',expected.operationId));
 assert.equal((await s.load('backend/guestBookingAllocationHandoff').handoffGuestBookingAllocation(expected.acceptanceId)).status,'ALLOCATION_HANDOFF_PENDING');
 const pending=structuredClone(db);let last;for(let i=0;i<100;i++){const worker=subject(db,{writer:true});last=await worker.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(expected.acceptanceId);if(last.status==='CONFIRMED')break;assert.ok(['ACQUISITION_PENDING','COMPLETION_PENDING'].includes(last.status),JSON.stringify(last));}assert.equal(last.status,'CONFIRMED','bounded actual writer completion');assert.equal(db.rows.GuestBookingCompletions.length,1);
 return {version:1,sourceHashes:pins,expected,db,pending};
}
function noEffects(s){assert.ok(s.trace.every(t=>['find','secret'].includes(t.op)),JSON.stringify(s.trace));}
async function readFixture(f,options={},args){const db=structuredClone(f.db),before=structuredClone(db.rows),s=subject(db,options),e=f.expected;const r=await s.load('backend/guestBookingCompletionAuthority').readRecoveredGuestBookingCompletion(...(args||[e.acceptanceId,e.operationId,e.rootDigest]));noEffects(s);return {db,before,s,r};}
function replaceOnce(source,old,text){assert.equal(source.split(old).length,2,'unique causal anchor');return source.replace(old,text);}
const cases=[];async function test(id,fn){await fn();cases.push(id);console.log('PASS '+id);}
async function main(){
 await test('CONFIG01',async()=>{assert.ok(fs.existsSync(path.join(root,'velo/backend/guestBookingInvoiceAuthorityConfig.js')),'audience-only config implementation required');const s=subject({rows:{},keys:{audience:'wbe:fixture',activeKid:'retired',keys:[]}});const api=s.load('backend/guestBookingInvoiceAuthorityConfig');assert.deepEqual(Object.keys(api),['readGuestBookingInvoiceSiteAudience']);assert.equal(await api.readGuestBookingInvoiceSiteAudience(),'wbe:fixture');assert.deepEqual(s.trace,[{op:'secret',n:'WBE_GUEST_BOOKING_KEYS'}]);assert.equal(await api.readGuestBookingInvoiceSiteAudience('override'),null);});
 if(['--produce','--produce-foreign'].includes(process.argv[2])){const f=await produce(),name=process.argv[2]==='--produce'?'completion-authority-history.json':'completion-authority-foreign.json';assert.ok(!fs.existsSync(path.join(fixtures,name)),'never overwrite frozen history');fs.writeFileSync(path.join(fixtures,name),JSON.stringify(f,null,2)+'\n');console.log('PRODUCER_COMPLETE '+name+' '+sha(fs.readFileSync(path.join(fixtures,name))));return;}
 if(process.argv[2]==='--produce-compensated'){
  const a=JSON.parse(fs.readFileSync(path.join(fixtures,'completion-authority-history.json'))),b=JSON.parse(fs.readFileSync(path.join(fixtures,'completion-authority-foreign.json')));
  assert.equal(sha(fs.readFileSync(path.join(fixtures,'completion-authority-history.json'))),'ee07c3ac0067452deb334c0b2e4086c26cf3e5ab18d740cca77f0a520395bed9');
  assert.equal(sha(fs.readFileSync(path.join(fixtures,'completion-authority-foreign.json'))),'9546cdcfa9ee27e8a376fb4714159c8902794c511af35e8aba7b82132bcc2506');
  const db=structuredClone(b.db);
  // Compatible chronological prefix: A accepted/planned, no resources acquired;
  // B then completes. Preserve only native rows from those actual producers.
  for(const [c,rows] of Object.entries(a.pending.rows))for(const row of rows){const present=db.rows[c].find(r=>r._id===row._id);if(present)assert.deepEqual(present,row);else db.rows[c].push(structuredClone(row));}
  const input=structuredClone(db),visits=[];let result;
  for(let i=0;i<100;i++){const s=subject(db,{writer:true});result=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(a.expected.acceptanceId);visits.push({result:JSON.parse(JSON.stringify(result)),trace:s.trace});if(result.status==='GROUP_SETTLEMENT_VERIFIED')break;assert.equal(result.status,'ACQUISITION_PENDING');}
  assert.equal(result.status,'GROUP_SETTLEMENT_VERIFIED');assert.ok(!db.rows.GuestBookingCompletions.some(r=>r.acceptanceId===a.expected.acceptanceId));
  const file=path.join(fixtures,'completion-authority-compensated.json');assert.ok(!fs.existsSync(file),'never overwrite frozen history');
  fs.writeFileSync(file,JSON.stringify({version:1,sourceHashes:pins,expected:a.expected,input,db,visits},null,2)+'\n');console.log('PRODUCER_COMPENSATED '+sha(fs.readFileSync(file)));return;
 }
 const history=JSON.parse(fs.readFileSync(path.join(fixtures,'completion-authority-history.json')));
 await test('B01',async()=>{assert.ok(fs.existsSync(path.join(root,'velo/backend/guestBookingCompletionAuthority.js')),'private retained reader implementation required');const db=structuredClone(history.db),before=structuredClone(db.rows),s=subject(db);const {acceptanceId:A,operationId:O,rootDigest:D}=history.expected;const api=s.load('backend/guestBookingCompletionAuthority');assert.deepEqual(Object.keys(api),['readRecoveredGuestBookingCompletion']);const r=await api.readRecoveredGuestBookingCompletion(A,O,D);assert.equal(r.status,'VERIFIED_COMPLETION');assert.equal(JSON.stringify(r.receipt),JSON.stringify(db.rows.GuestBookingCompletions[0]));assert.equal(JSON.stringify(r.projection),r.receipt.projectionCanonical);assert.deepEqual(db.rows,before);assert.ok(s.trace.every(t=>['find','secret'].includes(t.op)));assert.equal(s.trace[1].c,'GuestBookingCompletions');});
 await ordinaryCases(history);
 assert.equal(new Set(cases).size,cases.length);
 assert.equal(cases.length,22,'all admitted reader cases completed');
 console.log(JSON.stringify({completed:cases.length,cases}));
}

async function ordinaryCases(history){
 const A=history.expected,foreign=JSON.parse(fs.readFileSync(path.join(fixtures,'completion-authority-foreign.json')));
 for(const [name,f,hash] of [['history',history,'ee07c3ac0067452deb334c0b2e4086c26cf3e5ab18d740cca77f0a520395bed9'],['foreign',foreign,'9546cdcfa9ee27e8a376fb4714159c8902794c511af35e8aba7b82132bcc2506']]){
  assert.equal(sha(fs.readFileSync(path.join(fixtures,'completion-authority-'+name+'.json'))),hash);
  assert.deepEqual(f.sourceHashes,pins);
 }
 const onlyStatus=r=>{assert.deepEqual(Object.keys(r),['status']);assert.notEqual(r.status,'VERIFIED_COMPLETION');};
 const changed=edit=>{const f=structuredClone(history);edit(f);return f;};
 await test('B01_FINANCIAL',async()=>{
  const {r}=await readFixture(history);assert.equal(r.status,'VERIFIED_COMPLETION');
  const p=JSON.parse(JSON.stringify(r.projection));
  assert.deepEqual(p.plannedBookingRows.map(v=>[v.originalGroupIndex,v.ordinal,v.assignedRoom,v.note]),[[0,0,3,'Café 李'],[1,0,4,'']]);
  assert.deepEqual(p.summary.acceptedCalculation.groups.map(g=>[g.index,g.grossCents,g.grandTotalCents]),[[0,20001,23501],[1,20001,23501]]);
  assert.deepEqual(p.summary.acceptedCalculation.totals,{grossCents:40002,discountCents:0,roomTotalCents:40002,propertyFeeCents:2000,accommodationVatCents:2000,packageVatCents:3000,grandTotalCents:47002,totalVatCents:5000,totalRooms:2,totalGuests:4});
  assert.equal(r.receipt.primaryBookingRowId,p.plannedBookingRows[0]._id);assert.equal(r.receipt.recipient,'fixture@example.test');
  const h=(d,t)=>sha(Buffer.from(d+'\n'+t));
  assert.equal(r.receipt.projectionDigest,h('wbe.completion-projection-record.v1',r.receipt.projectionCanonical));
  assert.equal(r.receipt.recipientBindingDigest,h('wbe.completion-recipient.v1',JSON.stringify([r.receipt.audience,A.acceptanceId,A.rootDigest,r.receipt.manifestDigest,r.receipt.bookingNumber,r.receipt.summaryId,r.receipt.recipient,r.receipt.financialDigest])));
 });
 await test('B02',async()=>{
  const good=[A.acceptanceId,A.operationId,A.rootDigest];
  const bad=[[],good.concat('extra'),good.slice(0,2)];
  for(let i=0;i<3;i++)for(const v of [[good[i]],new String(good[i]),good[i].toUpperCase(),' '+good[i],null,{},'0'.repeat(63)]){const a=good.slice();a[i]=v;bad.push(a);}
  bad.push(['0'.repeat(64),A.operationId,A.rootDigest]);
  for(const args of bad){const {r,s}=await readFixture(history,{},args);assert.equal(r.status,'DENIED');onlyStatus(r);assert.deepEqual(s.trace,[]);}
 });
 await test('CONFIG02',async()=>{
  for(const keys of [{},null,[],{audience:''},{audience:' bad'},{audience:'a'.repeat(129)},{audience:[]}]){
   const {r,s}=await readFixture(changed(f=>f.db.keys=keys));assert.equal(r.status,'UNKNOWN');onlyStatus(r);assert.deepEqual(s.trace,[{op:'secret',n:'WBE_GUEST_BOOKING_KEYS'}]);
  }
  const missing=await readFixture(changed(f=>f.db.secretFailure=true));assert.equal(missing.r.status,'UNKNOWN');assert.equal(missing.s.trace.length,1);
  const retired=await readFixture(changed(f=>f.db.keys={audience:'wbe:fixture',keys:[],activeKid:'retired'}));assert.equal(retired.r.status,'VERIFIED_COMPLETION');
 });
 await test('B03_FOREIGN',async()=>{
  assert.notEqual(A.acceptanceId,foreign.expected.acceptanceId);
  assert.equal(history.db.rows.GuestBookingCompletions[0].recipient,foreign.db.rows.GuestBookingCompletions[0].recipient);
  assert.equal((await readFixture(foreign)).r.status,'VERIFIED_COMPLETION');
  const f={...foreign,expected:A};const {r,s}=await readFixture(f,{hook:({c})=>c==='GuestBookingCompletions'?{rows:foreign.db.rows[c]}:undefined});
  onlyStatus(r);assert.equal(s.trace.filter(t=>t.op==='find').length,1);
  assert.deepEqual(s.trace[1].predicates,[['_id','gbc1-'+A.acceptanceId,false]]);
 });
 await test('B03_BINDINGS',async()=>{
  for(const f of [changed(f=>f.db.keys.audience='wbe:other'),changed(f=>f.expected.rootDigest='0'.repeat(64)),changed(f=>f.db.rows.GuestBookingCompletions[0].rootDigest='0'.repeat(64))]){
   const {r,s}=await readFixture(f);assert.equal(r.status,'INTEGRITY');onlyStatus(r);assert.equal(s.trace.filter(t=>t.op==='find').length,1);
  }
 });
 await test('B03_LATE_MODEL',async()=>{
  for(const pass of [1,2]){let observed=0;
   const {r}=await readFixture(history,{mutateApi(n,api){if(n==='backend/guestBookingPhysicalAcquisitionEvidence'){const create=api.createGuestBookingPhysicalAcquisitionSession;api.createGuestBookingPhysicalAcquisitionSession=()=>{const s=create(),read=s.readCompletionModel;s.readCompletionModel=async(...a)=>{const m=await read(...a);if(++observed===pass)return {...m,accepted:{...m.accepted,root:foreign.db.rows.GuestBookingAcceptances[0]}};return m;};return s;};}}});
   assert.equal(observed,pass);assert.equal(r.status,'INTEGRITY');onlyStatus(r);
  }
 });
 await test('B03_LATE_RECEIPT',async()=>{
  let receipts=0;const {r}=await readFixture(history,{hook({c}){if(c==='GuestBookingCompletions'&&++receipts===2)return {rows:foreign.db.rows[c]};}});
  assert.equal(receipts,2);onlyStatus(r);
 });
 await test('B04',async()=>{
  const inputs=[{...history,db:history.pending},changed(f=>f.db.rows.GuestBookingCompletions=[]),changed(f=>{f.db.rows.GuestBookingCompletions=[];f.db.rows.Bookings=[];f.db.rows.BookingSummary=[];})];
  for(const f of inputs){const {r,s}=await readFixture(f);assert.equal(r.status,'UNKNOWN');onlyStatus(r);assert.equal(s.trace.filter(t=>t.op==='find').length,1);}
  const {r}=await readFixture(changed(f=>f.db.rows.Bookings.pop()));assert.equal(r.status,'INTEGRITY');onlyStatus(r);
 });

 await test('B04_COMPENSATED',async()=>{
  const file=path.join(fixtures,'completion-authority-compensated.json');assert.equal(sha(fs.readFileSync(file)),'349ee400de6556fd56c30a2f12399fada8479220d3a72d9e0d8db57574107818');
  const f=JSON.parse(fs.readFileSync(file));assert.deepEqual(f.sourceHashes,pins);
  assert.equal(f.visits.at(-1).result.status,'GROUP_SETTLEMENT_VERIFIED');assert.equal(f.visits.at(-1).result.groups[0].confirmedResourceCount,0);
  assert.ok(!f.db.rows.GuestBookingCompletions.some(r=>r.acceptanceId===f.expected.acceptanceId));
  const {r,s}=await readFixture(f);assert.equal(r.status,'UNKNOWN');onlyStatus(r);assert.equal(s.trace.filter(t=>t.op==='find').length,1);
 });
 await test('B05_TARGETS',async()=>{
  for(const c of ['Bookings','BookingSummary','GuestBookingCompletions'])for(const mode of ['missing','duplicate','extra','conflict']){
   const f=changed(f=>{const rows=f.db.rows[c];if(mode==='missing')rows.pop();if(mode==='duplicate')rows.push(structuredClone(rows[0]));if(mode==='extra')rows.push({...rows[0],_id:c==='Bookings'?rows[0]._id.replace(/-r[1-4]$/,'-r3'):'gbs1-'+('0'.repeat(64))});if(mode==='conflict')rows[0][c==='Bookings'?'note':c==='BookingSummary'?'guestEmail':'recipient']='altered@example.test';});
   // Extra receipts with a distinct ID are not part of exact receipt authority.
   if(c==='GuestBookingCompletions'&&mode==='extra')continue;
   const {r}=await readFixture(f);onlyStatus(r);
  }
 });
 await test('B05_IDENTITIES',async()=>{
  for(const field of ['bookingNumber','operationId']){
   const {r}=await readFixture(changed(f=>{const row={...f.db.rows.Bookings[0],_id:f.db.rows.Bookings[0]._id.replace(/-r[1-4]$/,'-r3')};row[field==='bookingNumber'?'operationId':'bookingNumber']='different';f.db.rows.Bookings.push(row);}));onlyStatus(r);assert.equal(r.status,'INTEGRITY');
  }
 });
 await test('B05_REHASHED',async()=>{
  for(const type of ['recipient','financial']){
   const {r}=await readFixture(changed(f=>{const r=f.db.rows.GuestBookingCompletions[0],p=JSON.parse(r.projectionCanonical),h=(d,t)=>sha(Buffer.from(d+'\n'+t));
    if(type==='recipient'){r.recipient=p.summary.guestEmail='altered@example.test';const s=JSON.parse(r.summaryCanonical);s.guestEmail=r.recipient;r.summaryCanonical=JSON.stringify(s);r.summaryDigest=h('wbe.completion-summary-record.v1',r.summaryCanonical);f.db.rows.BookingSummary[0].guestEmail=r.recipient;}
    else {p.summary.acceptedCalculation.groups[0].grandTotalCents++;p.summary.acceptedCalculation.totals.grandTotalCents++;r.financialDigest=p.summary.financialDigest=h('wbe.completion-financial.v1',JSON.stringify(p.summary.acceptedCalculation));}
    r.projectionCanonical=JSON.stringify(p);r.projectionDigest=h('wbe.completion-projection-record.v1',r.projectionCanonical);
    r.recipientBindingDigest=h('wbe.completion-recipient.v1',JSON.stringify([r.audience,r.acceptanceId,r.rootDigest,r.manifestDigest,r.bookingNumber,r.summaryId,r.recipient,r.financialDigest]));
   }));onlyStatus(r);assert.equal(r.status,'INTEGRITY');
  }
 });
 await test('B05_UNREADABLE',async()=>{
  for(const collection of ['GuestBookingCompletions','GuestBookingAcceptances','Bookings','BookingSummary']){let hit=0;const {r}=await readFixture(history,{hook({c}){if(c===collection){hit++;throw Error('inert unreadable');}}});assert.ok(hit);onlyStatus(r);assert.equal(r.status,'UNKNOWN');}
 });


 await test('B05_LATE_UNAVAILABLE',async()=>{
  for(const mode of ['throw','absent']){let receipts=0;
   const {r}=await readFixture(history,{hook({c}){if(c==='GuestBookingCompletions'&&++receipts===2){if(mode==='throw')throw Error('late unreadable');return {rows:[]};}}});
   assert.equal(receipts,2);assert.equal(r.status,'UNKNOWN');onlyStatus(r);
  }
 });
 await test('B05_BUDGET',async()=>{
  const stable=changed(f=>f.db.rows.GuestBookingCompletions[0]._owner='x'.repeat(256));
  assert.equal((await readFixture(stable)).r.status,'VERIFIED_COMPLETION');
  let receipts=0;const {r}=await readFixture(history,{hook({c,db}){if(c==='GuestBookingCompletions'&&++receipts===2)return {rows:[{...db.rows[c][0],_owner:'x'.repeat(256)}]};}});
  assert.equal(receipts,2);assert.equal(r.status,'UNKNOWN');onlyStatus(r);
  // Valid metadata changes no canonical authority bytes, but exceeds the actual
  // final-receipt verification byte hold measured on the first receipt read.
 });
 await test('B07',async()=>{
  const first=await readFixture(history);assert.equal(first.r.status,'VERIFIED_COMPLETION');first.r.receipt.recipient='changed';first.r.projection.summary.guestEmail='changed';
  assert.deepEqual(first.db.rows,first.before);assert.deepEqual(Object.keys(first.r),['status','receipt','projection']);
  const e=A,again=await first.s.load('backend/guestBookingCompletionAuthority').readRecoveredGuestBookingCompletion(e.acceptanceId,e.operationId,e.rootDigest);assert.equal(again.status,'VERIFIED_COMPLETION');assert.equal(again.receipt.recipient,'fixture@example.test');noEffects(first.s);
  const fresh=await readFixture(history);assert.equal(fresh.r.status,'VERIFIED_COMPLETION');assert.equal(fresh.r.receipt.recipient,'fixture@example.test');assert.deepEqual(fresh.db.rows,fresh.before);
 });
 await causalCases(history);
 await sourceCases();
}
async function causalCases(history){
 const authority='backend/guestBookingCompletionAuthority',suffix='backend/guestBookingCompletionEvidence';
 await test('B06_EXPECTATION_CAUSAL',async()=>{
  const f=structuredClone(history);f.expected.rootDigest='0'.repeat(64);
  const intact=await readFixture(f);assert.equal(intact.r.status,'INTEGRITY');
  const mutant=await readFixture(f,{mutateSource(n,s){if(n!==authority)return s;const start=s.indexOf('function bound('),end=s.indexOf('async function readBoundRetainedCompletion');assert.ok(start>=0&&end>start);return s.slice(0,start)+'function bound(){}\n'+s.slice(end);}});
  assert.equal(mutant.r.status,'VERIFIED_COMPLETION');assert.notEqual(mutant.r.receipt.rootDigest,f.expected.rootDigest);
 });
 await test('B06_CAPTURE_CAUSAL',async()=>{
  const skip=(n,s)=>n===suffix?replaceOnce(s,"const current=await store.exact('GuestBookingCompletions','gbc1-'+A,'final-receipt');","return answer('CONFIRMED'); const current=await store.exact('GuestBookingCompletions','gbc1-'+A,'final-receipt');"):s;
  const intact=await readFixture(history,{mutateSource:skip});assert.equal(intact.r.status,'INTEGRITY');assert.equal(intact.s.trace.filter(t=>t.c==='GuestBookingCompletions').length,1);
  const mutant=await readFixture(history,{mutateSource(n,s){s=skip(n,s);return n===authority?replaceOnce(s,'need(finalText!==null&&finalText===initialText);','finalText=initialText;'):s;}});
  assert.equal(mutant.r.status,'VERIFIED_COMPLETION');assert.equal(mutant.s.trace.filter(t=>t.c==='GuestBookingCompletions').length,1);
 });
 await test('B06_FOUND_CAUSAL',async()=>{
  const altered=(n,s)=>n===suffix?replaceOnce(s,'verifyCompletion(state,present,receipt,async()=>','verifyCompletion(state,present,{...receipt,status:\'ABSENT\'},async()=>'):s;
  const intact=await readFixture(history,{mutateSource:altered});assert.equal(intact.r.status,'INTEGRITY');
  const db=structuredClone(history.db),s=subject(db,{mutateSource(n,text){text=altered(n,text);return n===authority?replaceOnce(text,"need(own(seen,'status')==='FOUND');",'/* causal deletion */'):text;}}),e=history.expected;
  const r=await s.load(authority).readRecoveredGuestBookingCompletion(e.acceptanceId,e.operationId,e.rootDigest);
  assert.notEqual(r.status,'VERIFIED_COMPLETION');assert.ok(s.trace.some(t=>t.op==='reserveSelection'),'deletion reaches forbidden reservation, not incidental exception');assert.deepEqual(db.rows,history.db.rows);
 });
}
async function sourceCases(){
 await test('B08',async()=>{
  assert.equal(typeof vm.SourceTextModule,'function','run node --experimental-vm-modules');
  // Native parser; no module linking or evaluation. Narrow incoming-edge guard.
  const names=['guestBookingCompletionAuthority','guestBookingInvoiceAuthorityConfig'];
  function inspect(file,source){
   const parsed=new vm.SourceTextModule(source);
   for(const spec of parsed.dependencySpecifiers){const name=spec.replace(/\.js$/,'').split('/').pop();if(!names.includes(name))continue;
    const allowed=name==='guestBookingCompletionAuthority'?['velo/backend/guestBookingInvoiceIssuance.js']:['velo/backend/guestBookingCompletionAuthority.js'];
    assert.ok(allowed.includes(file),'forbidden incoming edge '+file+' -> '+spec);
   }
   // Computed imports/requires containing private names are not admitted.
   for(const m of source.matchAll(/\b(?:import|require)\s*\(([^)]*)\)/g))assert.ok(file==='velo/backend/diagnostics.web.js'&&m[1]==="'backend/search.web'",'dynamic module source forbidden');
  }
  for(const ext of ['.js','.web.js','.jsw'])for(const text of ["import { readRecoveredGuestBookingCompletion } from 'backend/guestBookingCompletionAuthority';","export * from 'backend/guestBookingCompletionAuthority.js';"]){assert.throws(()=>inspect('velo/backend/public'+ext,text),/forbidden incoming edge/);}
  assert.throws(()=>inspect('velo/page-summary.js',"import 'backend/guestBookingCompletionAuthority';"),/forbidden incoming edge/);
  inspect('velo/backend/guestBookingInvoiceIssuance.js',"import { readRecoveredGuestBookingCompletion } from 'backend/guestBookingCompletionAuthority';");
  inspect('velo/backend/benign.jsw',"export function unrelated(){return 'benign';}");
  assert.throws(()=>inspect('velo/backend/public.jsw',"import 'backend/guestBookingCompletion\\u0041uthority';"),/forbidden incoming edge/);
  assert.throws(()=>inspect('velo/backend/public.js',"const privateName='guestBookingCompletionAuthority'; import(privateName);"),/dynamic module source forbidden/);
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  for(const file of walk(path.join(root,'velo')).filter(f=>/\.(?:js|jsw)$/.test(f)))inspect(path.relative(root,file).replace(/\\/g,'/'),fs.readFileSync(file,'utf8'));
  const src=fs.readFileSync(path.join(root,'velo/backend/guestBookingCompletionAuthority.js'),'utf8');
  assert.deepEqual([...src.matchAll(/^export (?:async )?function (\w+)\(([^)]*)\)/gm)].map(m=>[m[1],m[2]]),[['readRecoveredGuestBookingCompletion','acceptanceId,operationId,rootDigest']]);
  assert.ok(!/export\s+(?:const|class|\{|default|\*)/.test(src));
 });
}

main().catch(e=>{console.error(e);console.error(JSON.stringify({completed:cases.length,cases}));process.exitCode=1;});
