'use strict';
// Baseline-GREEN finite C11 coverage through actual static rules and durable winner.
const fs=require('node:fs'),vm=require('node:vm');
let source=fs.readFileSync(__dirname+'/verify-guest-booking-allocation-manifest.js','utf8');
const i=source.indexOf("test('exact .25");if(i<0)throw Error('fixture boundary');
source=source.slice(0,i)+String.raw`
function readOnly(s){assert.ok(s.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestBookingAllocationManifests'].includes(t.collection)));}
test('C11 rehashed static tuple and exact store matrix',async()=>{
 const s0=subject(),p=input();p.note='Primary';p.priceGroups=[{roomCode:'adventure_suite',quantity:2,guests:2},{roomCode:'penthouse_apartment',quantity:1,guests:2}];const offer=await prepared(s0,p);assert.equal((await s0.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule)).status,'ACCEPTED_PENDING');const db=s0.state.db;for(const c of ['GuestBookingAllocationManifests','RoomBookingClaimEvents','Bookings','BookingSummary'])db.rows[c]=[];const f={db,offer,accepted:plain(db.rows.GuestBookingAcceptances[0])};db.keys=null;db.config=null;db.rows.GuestBookingFinancialRevisions=[];
 const seed=fresh(f);assert.equal((await run(seed,f)).status,'ALLOCATION_HANDOFF_PENDING');const good=plain(stored(f));
 const changes=[['domain',t=>t[0]='foreign'],['version',t=>t[1]=2],['tuple-extra',t=>t.push(0)],['tuple-missing',t=>t.pop()],['manifest-id',t=>t[2]+='x'],['planner',t=>t[4]='other'],['foreign-root',t=>t[3][13]='0'.repeat(64)],['class-order',t=>t[5].reverse()],['class-binding',t=>t[5][0][0]+='x'],['commitment',t=>t[5][0][6]='0'.repeat(64)],['expected-omit',t=>t[7].pop()],['expected-reorder',t=>t[7].reverse()],['primary',t=>t[8]=t[7][0]],['note',t=>t[5][1][5][0]='changed'],['references',t=>t[5][1][3][0][0]=1],['row-order',t=>t[6][1].bookingRows.reverse()],['unsafe',t=>t[6][0].acquisitions[0].generation=9007199254740992],['nonfinite',t=>t[6][0].acquisitions[0].generation=null]];
 let cases=0;for(const [name,change] of changes){const r=plain(good),t=JSON.parse(r.manifestCanonical);change(t);r.manifestCanonical=JSON.stringify(t);if(name==='nonfinite')r.manifestCanonical=r.manifestCanonical.replace('"generation":null','"generation":1e400');rehash(r);const x=fresh(f,true),rules=x.load('backend/guestBookingAllocationManifestRules');assert.equal(rules.validateGuestBookingAllocationManifest(x.realm(r),validated(x,f.accepted)),false,name);f.db.rows.GuestBookingAllocationManifests=[r];assert.equal((await run(x,f)).status,'INTEGRITY',name);readOnly(x);assert.deepEqual(db.rows.GuestBookingAcceptances,[f.accepted]);console.log('C11 '+name+' INTEGRITY');cases++;}
 for(const name of ['store-missing','store-extra','store-schema','negative-zero']){const r=plain(good);if(name==='store-missing')delete r.schemaVersion;if(name==='store-extra')r.extra='x';if(name==='store-schema')r.schemaVersion=2;if(name==='negative-zero'){r.manifestCanonical=r.manifestCanonical.replace('"generation":1','"generation":-0');rehash(r);}const x=fresh(f,true);assert.equal(x.load('backend/guestBookingAllocationManifestRules').validateGuestBookingAllocationManifest(x.realm(r),validated(x,f.accepted)),false,name);f.db.rows.GuestBookingAllocationManifests=[r];assert.equal((await run(x,f)).status,name==='negative-zero'?'INTEGRITY':'UNKNOWN',name);readOnly(x);assert.deepEqual(db.rows.GuestBookingAcceptances,[f.accepted]);console.log('C11 '+name+' static invalid; transport '+(name==='negative-zero'?'INTEGRITY':'UNKNOWN'));cases++;}
 f.db.rows.GuestBookingAllocationManifests=[good];const x=fresh(f,true);assert.equal((await run(x,f)).status,'ALLOCATION_HANDOFF_PENDING');readOnly(x);assert.deepEqual(stored(f),good);assert.equal(JSON.parse(good.manifestCanonical)[3][6],offer.capsule);assert.deepEqual(JSON.parse(offer.capsule).calculation,plain(offer.display));assert.equal(cases,22);console.log('C11 cases=22 negatives + unchanged winner positive');
});
test('C11 SDK response omits _id, manifestCanonical or manifestDigest',async()=>{
 const f=await setup(),seed=fresh(f);assert.equal((await run(seed,f)).status,'ALLOCATION_HANDOFF_PENDING');const good=plain(stored(f)),before=plain(f.db.rows);
 for(const key of ['_id','manifestCanonical','manifestDigest']){
  const row=plain(good);delete row[key];const x=fresh(f,true);
  assert.equal(x.load('backend/guestBookingAllocationManifestRules').validateGuestBookingAllocationManifest(x.realm(row),validated(x,f.accepted)),false,key);
  const query=x.wix.query;let responses=0;
  // Delete only at the SDK response boundary: removing stored _id hides the row from eq.
  x.wix.query=c=>{const q=query(c),find=q.find;q.find=async o=>{const page=await find(o);if(c==='GuestBookingAllocationManifests'){assert.equal(page.items.length,1,key);assert.equal(page.items[0]._id,good._id,key);page.items[0]=x.realm(row);assert.equal(Object.hasOwn(page.items[0],key),false,key);responses++;}return page;};return q;};
  assert.equal((await run(x,f)).status,'UNKNOWN',key);assert.equal(responses,1,key);readOnly(x);
  assert.deepEqual(f.db.rows.GuestBookingAcceptances,[f.accepted]);assert.deepEqual(stored(f),good);assert.deepEqual(f.db.rows,before);
  console.log('C11 SDK missing '+key+' static false; handoff UNKNOWN; only exact reads; unchanged acceptance/store');
 }
});
(async()=>{let failures=0;for(const [name,fn]of tests){try{await fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name,e);}}if(failures)process.exitCode=1;})();
`+'\n`,context);';vm.runInNewContext(source,{require,Buffer,console,process,__dirname});
