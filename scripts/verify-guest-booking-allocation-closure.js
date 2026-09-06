'use strict';
// Finite baseline-GREEN contract additions. Actual modules, synthetic SDK only.
const fs=require('node:fs'),vm=require('node:vm');
let source=fs.readFileSync(__dirname+'/verify-guest-booking-allocation-manifest.js','utf8');
const marker="test('exact .25",i=source.indexOf(marker);if(i<0)throw Error('fixture boundary');
source=source.slice(0,i)+String.raw`
async function finishAcceptance(s,offer){
 assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule)).status,'ACCEPTED_PENDING');
 const db=s.state.db;for(const c of ['GuestBookingAllocationManifests','RoomBookingClaimEvents','Bookings','BookingSummary'])db.rows[c]=[];
 const accepted=plain(db.rows.GuestBookingAcceptances[0]);db.keys=null;db.config=null;db.rows.GuestBookingFinancialRevisions=[];return {db,accepted,offer};
}
async function winner(f){
 const s=fresh(f);assert.equal((await run(s,f)).status,'ALLOCATION_HANDOFF_PENDING');const r=plain(stored(f)),t=JSON.parse(r.manifestCanonical);
 assert.equal(t[3][6],f.accepted.capsule);assert.deepEqual(JSON.parse(t[3][6]).calculation,plain(f.offer.display));
 const x=fresh(f,true);assert.equal((await run(x,f)).status,'ALLOCATION_HANDOFF_PENDING');assert.deepEqual(stored(f),r);
 assert.ok(x.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestBookingAllocationManifests'].includes(t.collection)));
 assert.deepEqual(f.db.rows.GuestBookingAcceptances,[f.accepted]);return t;
}
test('C06 actual inventory nonempty differing nightly union retained on restart',async()=>{
 const issuer=subject(),f=await finishAcceptance(issuer,await prepared(issuer)),h=fresh(f),core=h.load('backend/roomBookingCommitRules');
 for(const [index,roomCode,checkIn,checkOut]of [[1,'two_bedroom_apartment','2027-01-01','2027-01-02'],[2,'penthouse_apartment','2027-01-02','2027-01-03']]){
  const plan=core.buildPhysicalCommitPlan(h.realm({occupiedUnits:[],occupiedUnitsByNight:{[checkIn]:[]},migrationIssueRows:[],duplicateUnitClaims:[],unknownStatusRows:[]}),h.realm([]),h.realm({operationId:'historyoperation000'+index,bookingNumber:'OLD'+index,payloadDigest:String(index).repeat(64),checkIn,checkOut,roomCode,quantity:1}));
  f.db.rows.RoomBookingClaimEvents.push(...plain(plan.acquisitions));for(const row of plain(plan.bookingRows))f.db.rows.Bookings.push({_id:row._id,bookingNumber:row.bookingNumber,status:'confirmed',assignedRoom:row.assignedRoom,quantity:1,roomCode,checkIn,checkOut});
 }
 const s=fresh(f),reader=s.load('backend/guestBookingAllocationEvidence'),e=await reader.readGuestBookingAllocationEvidence('2027-01-01','2027-01-03');assert.equal(e.status,'READY');
 const oracle=s.load('backend/roomInventoryRules').buildInventorySnapshot(s.realm(f.db.rows.Bookings),'2027-01-01','2027-01-03');
 assert.deepEqual(plain(e.inventorySnapshot.occupiedUnitsByNight),{'2027-01-01':[2],'2027-01-02':[1]});assert.deepEqual(plain(e.inventorySnapshot.occupiedUnits),[1,2]);assert.deepEqual(plain(e.inventorySnapshot.occupiedUnitsByNight),plain(oracle.occupiedUnitsByNight));
 const t=await winner(f);assert.deepEqual(t[9],plain(e.planningEvidence));assert.equal(t[9][2].length,6);assert.deepEqual(t[9][3],t[9][2].map(r=>[r._id,null,null,null]));
});
test('C09 actual split26 versus merged24 manifest preserves every component',async()=>{
 for(const split of [true,false]){const s=subject();configureRevision(s.state.db,{...revision,package:{...revision.package,baseRate:0.05}});const p=input(),q=JSON.parse(Buffer.from(p.pricingQuoteToken.split('.')[0],'base64url'));q.baseRate=0.05;q.totalPerPerson=0.05;const encoded=Buffer.from(JSON.stringify(q)).toString('base64url');p.pricingQuoteToken=encoded+'.'+crypto.createHmac('sha256',QUOTE_KEY).update(encoded).digest('base64url');
 p.priceGroups=split?[{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:1,guests:2}]:[{roomCode:'adventure_suite',quantity:2,guests:2}];
 const offer=await prepared(s,p);assert.equal(offer.display.totals.grandTotalCents,split?26:24);const f=await finishAcceptance(s,offer),t=await winner(f);assert.deepEqual(JSON.parse(t[3][6]).calculation,plain(offer.display));assert.deepEqual(t[5][0][3],split?[[0,1],[1,1]]:[[0,1],[0,2]]);}
});
test('C13 actual qualification race winner is manifest authority after restart',async()=>{
 const db=durable(),a=subject(db),offer=await prepared(a),b=subject(db),entered=gate(),finish=gate();a.state.beforeInsert=async()=>{entered.release();await finish.promise;};a.state.loseAck=true;
 const pending=a.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule);await entered.promise;b.state.now=NOW+1;const acceptedResult=await b.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule);assert.equal(acceptedResult.status,'ACCEPTED_PENDING');const accepted=plain(db.rows.GuestBookingAcceptances[0]);finish.release();assert.deepEqual(plain(await pending),plain(acceptedResult));assert.equal(accepted.validatedAtMs,NOW+1);
 for(const c of ['GuestBookingAllocationManifests','RoomBookingClaimEvents','Bookings','BookingSummary'])db.rows[c]=[];db.keys=null;db.config=null;db.rows.GuestBookingFinancialRevisions=[];
 const t=await winner({db,accepted,offer});assert.equal(t[3][12],NOW+1);assert.equal(t[3][13],accepted.rootDigest);
});
(async()=>{let failures=0;for(const [name,fn]of tests){try{await fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name,e);}}console.log(tests.length+' finite closure suites; '+failures+' failures; live-Wix unverified');if(failures)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
`+'\n`,context);';
vm.runInNewContext(source,{require,Buffer,console,process,__dirname});
