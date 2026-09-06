'use strict';
// Real private orchestration with public in-memory SDK transport, not completion proof.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const fixture=fs.readFileSync(path.join(__dirname,'verify-guest-booking-acceptance.js'),'utf8');
const boundary=fixture.indexOf("test('real issuer");assert.ok(boundary>1000);
const context=vm.createContext({require,Buffer,console,process,__dirname});
vm.runInContext(fixture.slice(0,boundary).replaceAll('2027-01-01','2028-02-28').replaceAll('2027-01-03','2028-03-01')+String.raw`
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

(async()=>{const f=await setup(),s=fresh(f);assert.equal((await run(s,f)).status,'ALLOCATION_HANDOFF_PENDING');const r=plain(stored(f)),t=JSON.parse(r.manifestCanonical);assert.deepEqual(Object.keys(t[9][1].occupiedUnitsByNight),['2028-02-28','2028-02-29']);const x=fresh(f,true);assert.equal((await run(x,f)).status,'ALLOCATION_HANDOFF_PENDING');assert.deepEqual(stored(f),r);assert.equal(t[3][6],f.accepted.capsule);assert.ok(x.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestBookingAllocationManifests'].includes(t.collection)));console.log('PASS actual accepted leap-day manifest -> static restart winner; no planner/current evidence IO on winner');})().catch(e=>{console.error(e);process.exitCode=1;});
`,context);
