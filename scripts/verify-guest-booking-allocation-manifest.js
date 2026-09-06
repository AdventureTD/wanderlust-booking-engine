'use strict';
// Real private orchestration with public in-memory SDK transport, not completion proof.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const fixture=fs.readFileSync(path.join(__dirname,'verify-guest-booking-acceptance.js'),'utf8');
const boundary=fixture.indexOf("test('real issuer");assert.ok(boundary>1000);
const context=vm.createContext({require,Buffer,console,process,__dirname});
vm.runInContext(fixture.slice(0,boundary)+String.raw`
async function setup(fee=10.005){
 const s=subject();configureRevision(s.state.db,{...revision,penthouseRoomFee:fee});
 const p=input();p.priceGroups=[{roomCode:'penthouse_apartment',quantity:1,guests:2}];
 const offer=await prepared(s,p);assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule)).status,'ACCEPTED_PENDING');
 const db=s.state.db;for(const c of ['GuestBookingAllocationManifests','RoomBookingClaimEvents','Bookings','BookingSummary'])db.rows[c]=[];
 const accepted=plain(db.rows.GuestBookingAcceptances[0]);db.keys=null;db.config=null;db.rows.GuestBookingFinancialRevisions=[];
 return {db,accepted,offer};
}
function fresh(f,forbid=false){
 const s=subject(f.db);s.context.clock=()=>{throw Error('clock forbidden');};s.state.secretHook=()=>{throw Error('keys forbidden');};
 const query=s.wix.query;s.wix.query=c=>{if(forbid&&['RoomBookingClaimEvents','Bookings','BookingSummary','GuestBookingFinancialRevisions'].includes(c))throw Error('evidence forbidden');return query(c);};
 if(forbid){s.load('backend/wholeCartPlanningRules').buildWholeCartAllocation=()=>{throw Error('planner forbidden');};s.load('backend/roomBookingCommitRules').buildPhysicalCommitPlan=()=>{throw Error('core planning forbidden');};}
 return s;
}
const run=(s,f)=>s.load('backend/guestBookingAllocationHandoff').handoffGuestBookingAllocation(f.accepted._id);
const stored=f=>f.db.rows.GuestBookingAllocationManifests[0];
function rehash(r){r.manifestDigest=crypto.createHash('sha256').update(r.manifestCanonical).digest('hex');return r;}
function validated(s,r){const v=s.load('backend/guestBookingAcceptance').validateGuestBookingAcceptanceRoot(s.realm(r));assert.notEqual(v,'DENIED');return v;}
function noEffects(s,f){assert.ok(s.state.trace.every(t=>t.op!=='insert'||t.collection==='GuestBookingAllocationManifests'));assert.deepEqual(f.db.rows.GuestBookingAcceptances,[f.accepted]);assert.equal(f.db.rows.Bookings.length,0);assert.equal(f.db.rows.BookingSummary.length,0);}
// Baseline-GREEN coverage: do not manufacture RED for correct existing behavior.
test('exact .25 and 10.005 capsules and every financial component survive keyless static winner',async()=>{
 for(const fee of [.25,10.005]){const f=await setup(fee),s=fresh(f);assert.equal((await run(s,f)).status,'ALLOCATION_HANDOFF_PENDING');const r=plain(stored(f)),t=JSON.parse(r.manifestCanonical);assert.equal(t[3][6],f.offer.capsule);assert.equal(JSON.parse(t[3][6]).factors.penthouseRoomFee,fee);assert.deepEqual(JSON.parse(t[3][6]).calculation,plain(f.offer.display));const x=fresh(f,true);assert.equal((await run(x,f)).status,'ALLOCATION_HANDOFF_PENDING');assert.deepEqual(stored(f),r);assert.ok(x.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestBookingAllocationManifests'].includes(t.collection)));noEffects(s,f);}
});
test('valid different concurrent winner is adopted rather than compared with losing plan',async()=>{
 const f=await setup(),seed=fresh(f);assert.equal((await run(seed,f)).status,'ALLOCATION_HANDOFF_PENDING');const alternative=plain(stored(f)),t=JSON.parse(alternative.manifestCanonical),p=t[6][0];
 // Another legal capacity choice, not a replay or a current-availability assertion.
 for(const e of p.acquisitions)if(e.claimType==='capacity'){e.capacitySlot=2;e.claimKey='capacity:'+e.night+':2';e._id=e._id.replace('-s1-','-s2-');}
 p.acquisitions[0].manifestResourceClaimIds=p.acquisitions.slice(1).map(e=>e._id).join('|');alternative.manifestCanonical=JSON.stringify(t);rehash(alternative);
 assert.equal(seed.load('backend/guestBookingAllocationManifestRules').validateGuestBookingAllocationManifest(seed.realm(alternative),validated(seed,f.accepted)),true);
 f.db.rows.GuestBookingAllocationManifests=[];const a=fresh(f),b=fresh(f,true),entered=gate(),finish=gate();let losing;
 const insert=a.wix.insert;a.wix.insert=async(c,r,o)=>{losing=plain(r);entered.release();await finish.promise;return insert(c,r,o);};
 const pending=run(a,f);await entered.promise;assert.equal(await b.load('backend/guestBookingAllocationManifestStore').insertGuestBookingAllocationManifest(b.realm(alternative)),'ACKNOWLEDGED');finish.release();assert.equal((await pending).status,'ALLOCATION_HANDOFF_PENDING');assert.notEqual(losing.manifestCanonical,alternative.manifestCanonical);assert.deepEqual(stored(f),alternative);noEffects(a,f);
});
test('lost acknowledgement and unreadable post-insert readback recover unchanged on reset',async()=>{
 for(const unreadable of [false,true]){const f=await setup(),s=fresh(f);s.state.loseAck=true;if(unreadable)s.state.beforeInsert=()=>{s.state.findError=true;};assert.equal((await run(s,f)).status,unreadable?'UNKNOWN':'ALLOCATION_HANDOFF_PENDING');const r=plain(stored(f));assert.ok(r);const x=fresh(f,true);assert.equal((await run(x,f)).status,'ALLOCATION_HANDOFF_PENDING');assert.deepEqual(stored(f),r);noEffects(s,f);}
});
test('unknown delayed insert with current absence remains discoverable and never aborts',async()=>{
 const f=await setup(),s=fresh(f);let delayed;const insert=s.wix.insert;s.wix.insert=async(c,r,o)=>{delayed=()=>insert(c,r,o);throw Error('write outcome unknown');};
 assert.equal((await run(s,f)).status,'UNKNOWN');assert.equal(f.db.rows.GuestBookingAllocationManifests.length,0);assert.equal((await fresh(f).load('backend/guestBookingAcceptanceDiscovery').discoverGuestBookingAcceptances(null)).contexts.length,1);
 await delayed();const x=fresh(f,true);assert.equal((await run(x,f)).status,'ALLOCATION_HANDOFF_PENDING');noEffects(s,f);
});
test('internally valid foreign qualification manifest fails complete root binding',async()=>{
 const f=await setup(),s=fresh(f);assert.equal((await run(s,f)).status,'ALLOCATION_HANDOFF_PENDING');const foreign=plain(f.accepted);foreign.validatedAtMs++;const fields=['schemaVersion','validityPolicy','_id','operationId','audience','bookingNumber','capsule','intentDigest','quoteDigest','issuedAtMs','offerExpiresAtMs','credentialKid','validatedAtMs'],body={};for(const k of fields)body[k]=foreign[k];foreign.rootDigest=hash('wbe.acceptance-root.v2',JSON.stringify(body));const v=validated(s,foreign),rules=s.load('backend/guestBookingAllocationManifestRules'),binding=rules.buildGuestBookingAllocationBinding(v),e=await s.load('backend/guestBookingAllocationEvidence').readGuestBookingAllocationEvidence(binding.checkIn,binding.checkOut);assert.equal(e.status,'READY');const allocation=s.load('backend/wholeCartPlanningRules').buildWholeCartAllocation(s.realm({inventorySnapshot:e.inventorySnapshot,claimLedger:e.claimLedger,groupRequests:binding.groupRequests,primaryOperationId:binding.primaryOperationId})),r=rules.buildGuestBookingAllocationManifest(v,allocation,e.planningEvidence);assert.equal(rules.validateGuestBookingAllocationManifest(r,v),true);assert.equal(rules.validateGuestBookingAllocationManifest(r,validated(s,f.accepted)),false);f.db.rows.GuestBookingAllocationManifests=[plain(r)];const x=fresh(f,true);assert.equal((await run(x,f)).status,'INTEGRITY');assert.ok(x.state.trace.every(t=>t.op==='find'));noEffects(x,f);
});
test('manifest native Date metadata mutation during hasNext cannot yield success',async()=>{
 const f=await setup(),s=fresh(f);assert.equal((await run(s,f)).status,'ALLOCATION_HANDOFF_PENDING');const x=fresh(f,true),query=x.wix.query;
 x.wix.query=c=>{const q=query(c),find=q.find;q.find=async o=>{const page=await find(o);if(c==='GuestBookingAllocationManifests'){x.context.row=page.items[0];const date=vm.runInContext('row._createdDate=new Date(1700000000000)',x.context);assert.equal(vm.runInContext('row._createdDate instanceof Date',x.context),true);page.hasNext=()=>{date.setTime(1700000000001);return false;};}return page;};return q;};
 const r=await run(x,f);assert.equal(r.status,'UNKNOWN','unstable SDK metadata must not be adopted');assert.ok(x.state.trace.every(t=>t.op==='find'));
});
(async()=>{let failures=0;for(const [name,fn]of tests){try{await fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name,e);}}console.log(tests.length+' finite manifest/handoff suites; '+failures+' failures; live-Wix unverified');if(failures)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
`,context);
