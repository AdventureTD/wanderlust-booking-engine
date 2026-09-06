'use strict';
// Permanent concrete retained-evidence regressions; synthetic transport only.
const fs=require('node:fs'),vm=require('node:vm');
const dir=__dirname;
let source=fs.readFileSync(dir+'/verify-guest-booking-allocation-manifest.js','utf8');
const marker='(async()=>{let failures=0;'; const i=source.indexOf(marker);if(i<0)throw Error('fixture boundary');
source=source.slice(0,i)+String.raw`
(async()=>{
 const f=await setup(),s=fresh(f),core=s.load('backend/roomBookingCommitRules');
 const history=core.buildPhysicalCommitPlan(s.realm({occupiedUnits:[],occupiedUnitsByNight:{'2026-01-01':[]},migrationIssueRows:[],duplicateUnitClaims:[],unknownStatusRows:[]}),s.realm([]),s.realm({operationId:'historyoperation0001',bookingNumber:'HISTORY',payloadDigest:'1'.repeat(64),checkIn:'2026-01-01',checkOut:'2026-01-02',roomCode:'adventure_suite',quantity:1}));
 f.db.rows.RoomBookingClaimEvents=plain(history.acquisitions);
 assert.equal((await run(s,f)).status,'ALLOCATION_HANDOFF_PENDING');const original=plain(stored(f));
 // Test-only exposure of unchanged private validation functions, not allocation.
 const coreText=fs.readFileSync(path.join(root,'velo/backend/roomBookingCommitRules.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export function /g,'function ');
 const staticCore=vm.runInContext('(function(){'+coreText+';return {validateClaimLedger,isValidClaimEvent};})()',s.context);
 const baseline=JSON.parse(original.manifestCanonical)[9][2];staticCore.validateClaimLedger(s.realm(baseline));
 const cases=[
 ['id-only-row',t=>{t[9][2]=[{_id:'x'}];t[9][3]=[['x',null,null,null]];},'ledger'],
 ['missing-generation',t=>{delete t[9][2][0].generation;},'ledger'],
 ['invalid-generation-zero',t=>{t[9][2][0].generation=0;},'ledger'],
 ['invalid-protocol-version',t=>{t[9][2][0].protocolVersion=2;},'ledger'],
 ['invalid-event-kind',t=>{t[9][2][0].eventType='unknown';},'ledger'],
 ['missing-operation-history',t=>{const j=t[9][2].findIndex(r=>r.claimType==='operation');t[9][2].splice(j,1);t[9][3].splice(j,1);},'ledger'],
 ['missing-first-acquisition-with-later-acquisition',t=>{const id=history.acquisitions[1]._id,j=t[9][2].findIndex(r=>r._id===id);t[9][2].splice(j,1);t[9][3].splice(j,1);},'ledger'],
 ['sidecar-outside-native-Date-range',t=>{t[9][3][0][2]=Number.MAX_SAFE_INTEGER;},'date'],
 ['snapshot-missing-all-stay-nights',t=>{t[9][1].occupiedUnitsByNight={};},'snapshot'],
 ['snapshot-impossible-calendar-day',t=>{t[9][1].occupiedUnitsByNight={'2027-02-30':[]};},'snapshot']
 ];

 // All claim kinds from a real complete compensated/released history.
 const op=plain(history.acquisitions[0]);
 const complete={_id:'rc1-op-'+op.operationId+'-c',protocolVersion:1,claimKey:'operation:'+op.operationId+':completion',generation:1,eventType:'complete',claimType:'operation-completion',operationId:op.operationId,bookingRowId:op.bookingRowId,bookingNumber:op.bookingNumber,payloadDigest:op.payloadDigest,completionState:'complete',confirmedResourceCount:history.acquisitions.length-1,decisionFenceVersion:1};
 const decision={_id:'rc1-op-'+op.operationId+'-d',protocolVersion:1,claimKey:'operation:'+op.operationId+':decision',generation:1,eventType:'decide',claimType:'operation-decision',operationId:op.operationId,bookingRowId:op.bookingRowId,bookingNumber:op.bookingNumber,payloadDigest:op.payloadDigest,decisionFenceVersion:1,operationIdentityId:op._id,operationCompletionId:complete._id,manifestVersion:1,completionState:'complete',confirmedResourceCount:complete.confirmedResourceCount,decisionState:'compensate'};
 const full=plain([...history.acquisitions,complete,decision,...core.planPhysicalRollback(history.acquisitions,'Synthetic cancellation')]);
 const fieldOrder=['_id','protocolVersion','claimKey','eventType','claimType','generation','night','capacitySlot','unit','operationId','payloadDigest','bookingNumber','bookingRowId','releaseReason','manifestVersion','manifestCheckIn','manifestCheckOut','manifestRoomCode','manifestUnits','manifestBookingRowIds','manifestResourceClaimIds','completionState','confirmedResourceCount','decisionFenceVersion','operationIdentityId','operationCompletionId','decisionState'];
 function retain(t,rows){t[9][2]=plain(rows).sort((a,b)=>a._id<b._id?-1:1).map(r=>{const o={};for(const k of fieldOrder)if(Object.hasOwn(r,k))o[k]=r[k];return o;});t[9][3]=t[9][2].map(r=>[r._id,null,null,null]);}
 for(let j=0;j<full.length;j++){
  const row=full[j],label=row.claimType+'-'+row.eventType;
  for(const key of Object.keys(row))if(key!=='decisionFenceVersion'||row.claimType==='operation-decision')cases.push(['required-'+label+'-'+key,t=>{const rows=plain(full);delete rows[j][key];retain(t,rows);},'shape']);
  const foreign=row.claimType==='operation'?'operationIdentityId':row.claimType==='operation-completion'?'operationIdentityId':'manifestCheckIn';
  cases.push(['foreign-'+label+'-'+foreign,t=>{const rows=plain(full);rows[j][foreign]=foreign==='manifestCheckIn'?'2026-01-01':op._id;retain(t,rows);},'shape']);
 }

 // Finite linked-history and domain controls; no allocation replay on winner reads.
 const stopped={...complete,completionState:'stopped',confirmedResourceCount:1};
 const committed={...decision,decisionState:'commit-rows'};
 const positives=[['identity-only',[op]],['partial-prefix',plain(history.acquisitions.slice(0,2))],['complete',plain([...history.acquisitions,complete])],['stopped',[op,plain(history.acquisitions[1]),stopped]],['committed',plain([...history.acquisitions,complete,committed])],['compensated',full],['release-suffix',full.slice(0,-1)],['legacy-complete',plain([...history.acquisitions,complete]).map(r=>{delete r.decisionFenceVersion;return r;})]];
 const next=core.buildPhysicalCommitPlan(s.realm({occupiedUnits:[],occupiedUnitsByNight:{'2026-01-01':[]},migrationIssueRows:[],duplicateUnitClaims:[],unknownStatusRows:[]}),s.realm(full),s.realm({operationId:'historyoperation0002',bookingNumber:'HISTORY2',payloadDigest:'2'.repeat(64),checkIn:'2026-01-01',checkOut:'2026-01-02',roomCode:'adventure_suite',quantity:1}));
 positives.push(['generation-reuse',plain([...full,...next.acquisitions])]);
 for(const [name,rows]of positives){staticCore.validateClaimLedger(s.realm(rows));const r=plain(original),t=JSON.parse(r.manifestCanonical);retain(t,rows);r.manifestCanonical=JSON.stringify(t);rehash(r);f.db.rows.GuestBookingAllocationManifests=[r];const x=fresh(f,true);assert.equal(x.load('backend/guestBookingAllocationManifestRules').validateGuestBookingAllocationManifest(x.realm(r),validated(x,f.accepted)),true,name);assert.equal((await run(x,f)).status,'ALLOCATION_HANDOFF_PENDING',name);assert.ok(x.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestBookingAllocationManifests'].includes(t.collection)));}
 const mutations=[
 ['orphan-release',r=>{const release=r.find(e=>e.eventType==='release');r.splice(0,r.length,release);}],['orphan-completion',r=>r.splice(0,r.length,complete)],
 ['orphan-decision',r=>r.splice(r.findIndex(e=>e.claimType==='operation-completion'),1)],
 ['count-mismatch',r=>r.find(e=>e.claimType==='operation-completion').confirmedResourceCount=0],
 ['fence-mismatch',r=>delete r.find(e=>e.claimType==='operation-completion').decisionFenceVersion],
 ['digest-mismatch',r=>r[1].payloadDigest='3'.repeat(64)],['number-mismatch',r=>r[1].bookingNumber='OTHER'],
 ['release-hole',r=>r.splice(r.findIndex(e=>e.eventType==='release'),1)],
 ['wrong-fence',r=>r[0].decisionFenceVersion=2],['resource-fence',r=>r[1].decisionFenceVersion=1],
 ['capacity-zero',r=>r[1].capacitySlot=0],['capacity-five',r=>r[1].capacitySlot=5],
 ['unit-zero',r=>r[2].unit=0],['unit-six',r=>r[2].unit=6],
 ['generation-million',r=>r[1].generation=1000000],['generation-gap',r=>{r.push(...plain(next.acquisitions));r.splice(0,full.length);}],
 ['completion-negative',r=>r.find(e=>e.claimType==='operation-completion').confirmedResourceCount=-1],
 ['completion-overbound',r=>r.find(e=>e.claimType==='operation-completion').confirmedResourceCount=6401],
 ['release-reason-empty',r=>r.find(e=>e.eventType==='release').releaseReason=''],
 ['operation-id-short',r=>r[0].operationId='short'],['digest-uppercase',r=>r[0].payloadDigest='A'.repeat(64)]
 ];
 for(const [name,mutate]of mutations)cases.push([name,t=>{const rows=plain(full);mutate(rows);retain(t,rows);},'history']);
 for(const value of [8640000000000001,-8640000000000001])cases.push(['sidecar-bound-'+value,t=>{t[9][3][0][2]=value;},'date']);
 for(const value of [null,-1,0,8640000000000000,-8640000000000000]){const r=plain(original),t=JSON.parse(r.manifestCanonical);t[9][3][0][2]=value;r.manifestCanonical=JSON.stringify(t);rehash(r);assert.equal(s.load('backend/guestBookingAllocationManifestRules').validateGuestBookingAllocationManifest(s.realm(r),validated(s,f.accepted)),true,'valid Date sidecar '+value);}
 const snapshotCases=[['array',n=>[]],['missing',n=>Object.fromEntries(Object.entries(n).slice(1))],['extra',n=>({...n,'2099-01-01':[]})],['reordered',n=>Object.fromEntries(Object.entries(n).reverse())],['unit-zero',n=>{n[Object.keys(n)[0]]=[0];return n;}],['unit-six',n=>{n[Object.keys(n)[0]]=[6];return n;}],['unit-duplicate',n=>{n[Object.keys(n)[0]]=[1,1];return n;}],['unit-unsorted',n=>{n[Object.keys(n)[0]]=[2,1];return n;}],['union-mismatch',n=>{n[Object.keys(n)[0]]=[1];return n;}]];
 for(const [name,mutate]of snapshotCases)cases.push(['snapshot-'+name,t=>{t[9][1].occupiedUnitsByNight=mutate(t[9][1].occupiedUnitsByNight);},'snapshot']);
 cases.push(['snapshot-diagnostics',t=>{t[9][1].unknownStatusRows=['unresolved'];},'snapshot']);
 const negativeZero=plain(original),zeroTuple=JSON.parse(negativeZero.manifestCanonical);zeroTuple[9][3][0][2]=123456789;negativeZero.manifestCanonical=JSON.stringify(zeroTuple).replace(',123456789,',',-0,');assert.ok(Object.is(JSON.parse(negativeZero.manifestCanonical)[9][3][0][2],-0));rehash(negativeZero);f.db.rows.GuestBookingAllocationManifests=[negativeZero];const zx=fresh(f,true);assert.equal(zx.load('backend/guestBookingAllocationManifestRules').validateGuestBookingAllocationManifest(zx.realm(negativeZero),validated(zx,f.accepted)),false);assert.equal((await run(zx,f)).status,'INTEGRITY');assert.ok(zx.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestBookingAllocationManifests'].includes(t.collection)));
 console.log(positives.length+' valid linked-history controls; 5 Date sidecar controls; raw negative-zero rejection');
 let failures=0, count=0;
 for(const [name,change,kind]of cases){
  if(process.argv[2] && process.argv[2]!==kind)continue;count++;try{
  const r=plain(original),t=JSON.parse(r.manifestCanonical);change(t);r.manifestCanonical=JSON.stringify(t);rehash(r);
  let coreRejected=null;if(kind==='ledger'){try{staticCore.validateClaimLedger(s.realm(t[9][2]));coreRejected=false;}catch(e){assert.equal(e.message,'Invalid claim ledger');coreRejected=true;}assert.equal(coreRejected,true,name);}
  if(kind==='date')assert.equal(Number.isNaN(new Date(t[9][3][0][2]).getTime()),true);
  f.db.rows.GuestBookingAllocationManifests=[r];const x=fresh(f,true);
  const accepted=x.load('backend/guestBookingAllocationManifestRules').validateGuestBookingAllocationManifest(x.realm(r),validated(x,f.accepted));
  assert.equal(accepted,false,'malformed retained evidence must reject: '+name);
  const result=await run(x,f);assert.equal(result.status,'INTEGRITY');
  assert.ok(x.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestBookingAllocationManifests'].includes(t.collection)));
  assert.equal(JSON.parse(r.manifestCanonical)[3][6],f.accepted.capsule);
  console.log('PASS '+name);
  }catch(e){failures++;console.error('FAIL '+name,e);}
 }
 console.log(count+' retained witnesses; '+failures+' failures');if(failures)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
`+'\n`,context);';
vm.runInNewContext(source,{require,Buffer,console,process,__dirname:dir});
