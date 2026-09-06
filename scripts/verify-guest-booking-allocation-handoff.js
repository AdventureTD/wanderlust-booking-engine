'use strict';
// Reuse the real acceptance verifier's public fixture transport, never its tests.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const fixture=fs.readFileSync(path.join(__dirname,'verify-guest-booking-acceptance.js'),'utf8');
const boundary=fixture.indexOf("test('real issuer");assert.ok(boundary>1000);
const context=vm.createContext({require,Buffer,console,process,__dirname});
vm.runInContext(fixture.slice(0,boundary)+`
(async()=>{
 assert.ok(fs.existsSync(path.join(root,'velo/backend/guestBookingAllocationHandoff.js')),'missing feature: private acceptance-to-allocation handoff');
 const s=subject();configureRevision(s.state.db,{...revision,penthouseRoomFee:0.25});
 const p=input();p.note='Original primary suite only';p.priceGroups=[{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:2,guests:2}];
 const offer=await prepared(s,p);assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule)).status,'ACCEPTED_PENDING');
 const db=s.state.db,accepted=plain(db.rows.GuestBookingAcceptances[0]);
 db.rows.GuestBookingAllocationManifests=[];db.rows.Bookings=[];db.rows.BookingSummary=[];
 // Real historical ledger outside the requested stay, not an empty-ledger substitute.
 const core=s.load('backend/roomBookingCommitRules');
 const old=core.buildPhysicalCommitPlan(s.realm({occupiedUnits:[],occupiedUnitsByNight:{'2026-01-01':[]},migrationIssueRows:[],duplicateUnitClaims:[],unknownStatusRows:[]}),s.realm([]),s.realm({operationId:'historicaloperation01',bookingNumber:'HISTORY',payloadDigest:'1'.repeat(64),checkIn:'2026-01-01',checkOut:'2026-01-02',roomCode:'adventure_suite',quantity:1}));
 db.rows.RoomBookingClaimEvents=plain(old.acquisitions);
 db.keys=null;db.config=null;db.rows.GuestBookingFinancialRevisions=[];
 function restarted(forbid){
  const x=subject(db);x.state.now=offer.offerExpiresAtMs+1;x.context.clock=()=>{throw Error('clock forbidden');};x.state.secretHook=()=>{throw Error('keys forbidden');};
  const query=x.wix.query;x.wix.query=collection=>{if(forbid&&['Bookings','BookingSummary','RoomBookingClaimEvents','GuestBookingFinancialRevisions'].includes(collection))throw Error('evidence forbidden');const q=query(collection),find=q.find;q.find=async options=>{const page=await find(options);if(collection==='RoomBookingClaimEvents'){x.context.rows=page.items;vm.runInContext("for(const r of rows)r._createdDate=new Date(1700000000000)",x.context);assert.equal(vm.runInContext('rows.every(r=>r._createdDate instanceof Date)',x.context),true);}return page;};return q;};
  if(forbid){x.load('backend/wholeCartPlanningRules').buildWholeCartAllocation=()=>{throw Error('planner forbidden');};x.load('backend/roomBookingCommitRules').buildPhysicalCommitPlan=()=>{throw Error('core planning forbidden');};}
  return x;
 }
 const fresh=restarted(false);const discovery=await fresh.load('backend/guestBookingAcceptanceDiscovery').discoverGuestBookingAcceptances(null);assert.equal(discovery.status,'PAGE');assert.equal(discovery.contexts.length,1);
 const id=fresh.load('backend/guestBookingIssuerAuthority').acceptanceDigest('wbe.acceptance-id.v2',discovery.contexts[0].operationId);
 const result=await fresh.load('backend/guestBookingAllocationHandoff').handoffGuestBookingAllocation(id);assert.equal(result.status,'ALLOCATION_HANDOFF_PENDING',JSON.stringify(result));
 assert.equal(result.bookingNumber,accepted.bookingNumber);assert.equal(db.rows.GuestBookingAllocationManifests.length,1);
 const stored=plain(db.rows.GuestBookingAllocationManifests[0]),m=JSON.parse(stored.manifestCanonical);
 assert.equal(m[3][6],offer.capsule);assert.equal(JSON.parse(m[3][6]).factors.penthouseRoomFee,0.25);
 assert.deepEqual(m[5].map(b=>[b[1],b[2],b[3],b[5]]),[['penthouse_apartment',1,[[1,1]],['']],['adventure_suite',3,[[0,1],[2,1],[2,2]],['Original primary suite only','','']]]);
 assert.equal(m[7].length,4);assert.equal(m[8],'pb1-'+m[5][1][0]+'-r1');assert.equal(m[9][2].length,old.acquisitions.length);assert.ok(m[9][3].every(r=>r[2]===1700000000000));assert.ok(m[9][2].every(r=>!Object.hasOwn(r,'_createdDate')));
 for(const name of ['RoomBookingClaimEvents','Bookings','BookingSummary'])assert.ok(fresh.state.trace.some(t=>t.collection===name&&t.op==='find'&&t.options.consistentRead&&t.options.suppressAuth&&t.options.suppressHooks));
 const reset=restarted(true);assert.equal((await reset.load('backend/guestBookingAcceptanceDiscovery').discoverGuestBookingAcceptances(null)).status,'PAGE');
 const again=await reset.load('backend/guestBookingAllocationHandoff').handoffGuestBookingAllocation(id);assert.deepEqual(plain(again),plain(result));assert.deepEqual(db.rows.GuestBookingAllocationManifests,[stored]);
 assert.ok(reset.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestBookingAllocationManifests'].includes(t.collection)));
 assert.equal(db.rows.Bookings.length,0);assert.equal(db.rows.BookingSummary.length,0);assert.deepEqual(db.rows.GuestBookingAcceptances,[accepted]);
 console.log('PASS first coherent real acceptance -> allocation manifest -> keyless static winner tracer (four rooms, .25, original duplicate groups, native Date sidecar); live-Wix unverified');
})().catch(e=>{console.error(e);process.exitCode=1;});`,context);
