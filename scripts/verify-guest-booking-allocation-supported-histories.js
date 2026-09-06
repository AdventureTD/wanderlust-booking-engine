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
 // All claim kinds from a real complete compensated/released history.
 const op=plain(history.acquisitions[0]);
 const complete={_id:'rc1-op-'+op.operationId+'-c',protocolVersion:1,claimKey:'operation:'+op.operationId+':completion',generation:1,eventType:'complete',claimType:'operation-completion',operationId:op.operationId,bookingRowId:op.bookingRowId,bookingNumber:op.bookingNumber,payloadDigest:op.payloadDigest,completionState:'complete',confirmedResourceCount:history.acquisitions.length-1,decisionFenceVersion:1};
 const decision={_id:'rc1-op-'+op.operationId+'-d',protocolVersion:1,claimKey:'operation:'+op.operationId+':decision',generation:1,eventType:'decide',claimType:'operation-decision',operationId:op.operationId,bookingRowId:op.bookingRowId,bookingNumber:op.bookingNumber,payloadDigest:op.payloadDigest,decisionFenceVersion:1,operationIdentityId:op._id,operationCompletionId:complete._id,manifestVersion:1,completionState:'complete',confirmedResourceCount:complete.confirmedResourceCount,decisionState:'compensate'};
 const full=plain([...history.acquisitions,complete,decision,...core.planPhysicalRollback(history.acquisitions,'Synthetic cancellation')]);
 const fieldOrder=['_id','protocolVersion','claimKey','eventType','claimType','generation','night','capacitySlot','unit','operationId','payloadDigest','bookingNumber','bookingRowId','releaseReason','manifestVersion','manifestCheckIn','manifestCheckOut','manifestRoomCode','manifestUnits','manifestBookingRowIds','manifestResourceClaimIds','completionState','confirmedResourceCount','decisionFenceVersion','operationIdentityId','operationCompletionId','decisionState'];
 function retain(t,rows){t[9][2]=plain(rows).sort((a,b)=>a._id<b._id?-1:1).map(r=>{const o={};for(const k of fieldOrder)if(Object.hasOwn(r,k))o[k]=r[k];return o;});t[9][3]=t[9][2].map(r=>[r._id,null,null,null]);}
 let checked=0;
 for(const legacy of [false,true])for(let acquired=0;acquired<history.acquisitions.length;acquired++){
  const prefix=plain(history.acquisitions.slice(0,acquired+1));
  if(legacy)delete prefix[0].decisionFenceVersion;
  const c={...plain(complete),completionState:acquired===history.acquisitions.length-1?'complete':'stopped',confirmedResourceCount:acquired};if(legacy)delete c.decisionFenceVersion;
  const d={...plain(decision),completionState:c.completionState,confirmedResourceCount:acquired};
  const variants=[['prefix',prefix],['completion',[...prefix,c]]];
  const rollback=plain(core.planPhysicalRollback(s.realm(prefix),'Synthetic suffix'));
  for(let released=0;released<=acquired;released++)variants.push(['released-'+released,[...prefix,c,...(legacy?[]:[d]),...rollback.slice(0,released)]]);
  if(!legacy&&c.completionState==='complete')variants.push(['commit',[...prefix,c,{...d,decisionState:'commit-rows'}]]);
  for(const [kind,rows]of variants){
   const name=[legacy,acquired,kind].join('/');staticCore.validateClaimLedger(s.realm(rows));
   const r=plain(original),t=JSON.parse(r.manifestCanonical);retain(t,rows);r.manifestCanonical=JSON.stringify(t);rehash(r);
   const x=fresh(f,true);f.db.rows.GuestBookingAllocationManifests=[r];
   assert.equal(x.load('backend/guestBookingAllocationManifestRules').validateGuestBookingAllocationManifest(x.realm(r),validated(x,f.accepted)),true,name);
   assert.equal((await run(x,f)).status,'ALLOCATION_HANDOFF_PENDING',name);
   assert.ok(x.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestBookingAllocationManifests'].includes(t.collection)),name);assert.equal(JSON.parse(r.manifestCanonical)[3][6],f.accepted.capsule,name);assert.deepEqual(stored(f),r,name);checked++;
  }
 }
 assert.equal(checked,25);
 console.log('PASS '+checked+' independent legacy/fenced prefix, zero-count stopped, completion, decision and every release-suffix controls; baseline-GREEN permanent promotion.');
})().catch(e=>{console.error(e);process.exitCode=1;});
`+'\n`,context);';
vm.runInNewContext(source,{require,Buffer,console,process,__dirname:dir});
