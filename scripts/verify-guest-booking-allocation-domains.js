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
 async function witness(name,rows,valid){
  if(valid)staticCore.validateClaimLedger(s.realm(rows));else assert.throws(()=>staticCore.validateClaimLedger(s.realm(rows)),/Invalid claim ledger/,name);
  const r=plain(original),t=JSON.parse(r.manifestCanonical);retain(t,rows);r.manifestCanonical=JSON.stringify(t);rehash(r);f.db.rows.GuestBookingAllocationManifests=[r];const x=fresh(f,true);
  assert.equal(x.load('backend/guestBookingAllocationManifestRules').validateGuestBookingAllocationManifest(x.realm(r),validated(x,f.accepted)),valid,name);
  assert.equal((await run(x,f)).status,valid?'ALLOCATION_HANDOFF_PENDING':'INTEGRITY',name);
  assert.ok(x.state.trace.every(t=>t.op==='find'&&['GuestBookingAcceptances','GuestBookingAllocationManifests'].includes(t.collection)),name);
  assert.equal(t[3][6],f.accepted.capsule,name);assert.deepEqual(stored(f),r,name);checked++;console.log('PASS '+name);
 }
 // Renaming all operation-dependent fields ensures length/grammar, not a stale ID, is tested.
 for(const [value,valid]of [['o'.repeat(16),true],['o'.repeat(64),true],['o'.repeat(15),false],['o'.repeat(65),false],['o'.repeat(15)+'.',false]]){
  const rows=plain(full);for(const row of rows)for(const k of Object.keys(row))if(typeof row[k]==='string')row[k]=row[k].split(op.operationId).join(value);
  await witness('C02 operation '+value.length+'/'+valid,rows,valid);
 }
 for(const [value,valid]of [['B',true],['B'.repeat(128),true],['',false],['B'.repeat(129),false],[' B',false],['B\nX',false]]){const rows=plain(full);for(const row of rows)row.bookingNumber=value;await witness('C02 booking '+JSON.stringify(value),rows,valid);}
 for(const [value,valid]of [['R'.repeat(256),true],['R'.repeat(257),false],[' R',false],['R\nX',false]]){const rows=plain(full);for(const row of rows)if(row.eventType==='release')row.releaseReason=value;await witness('C02 reason '+JSON.stringify(value),rows,valid);}
 for(const value of ['1'.repeat(63),'1'.repeat(65),'g'.repeat(64)]){const rows=plain(full);for(const row of rows)row.payloadDigest=value;await witness('C02 digest '+value,rows,false);}
 // Every normalized kind/event gets its own legal ordinary oracle control.
 for(let j=0;j<full.length;j++){
  await witness('C03 legal '+full[j].claimType+'/'+full[j].eventType,full,true);
  for(const [key,value]of [['eventType','unknown'],['claimKey','wrong'],['_id','wrong'],['bookingRowId','pb1-'+op.operationId+'-r2']]){const rows=plain(full);rows[j][key]=value;await witness('C03 '+full[j].claimType+'/'+full[j].eventType+'/'+key,rows,false);}
 }
 const pairs=[['manifestVersion',2],['manifestCheckIn','2026-02-30'],['manifestCheckOut','2026-01-01'],['manifestRoomCode','unknown'],['manifestUnits','1'],['manifestBookingRowIds',''],['manifestResourceClaimIds',op.manifestResourceClaimIds.split('|').slice(1).join('|')],['manifestResourceClaimIds',op.manifestResourceClaimIds.split('|').reverse().join('|')]];
 for(const [key,value]of pairs){const rows=plain(full);rows[0][key]=value;await witness('C03 manifest '+key+'/'+value,rows,false);}
 // Multi-row legal manifest is necessary to reach genuine row-ID order denial.
 const two=core.buildPhysicalCommitPlan(s.realm({occupiedUnits:[],occupiedUnitsByNight:{'2026-01-01':[]},migrationIssueRows:[],duplicateUnitClaims:[],unknownStatusRows:[]}),s.realm([]),s.realm({operationId:op.operationId,bookingNumber:op.bookingNumber,payloadDigest:op.payloadDigest,checkIn:'2026-01-01',checkOut:'2026-01-02',roomCode:'adventure_suite',quantity:2}));
 await witness('C03 legal two-row',plain(two.acquisitions),true);
 for(const units of ['3,3','4,3']){const rows=plain(two.acquisitions);rows[0].manifestUnits=units;await witness('C03 two-row units '+units,rows,false);}
 for(const mode of ['omit','reorder']){const rows=plain(two.acquisitions),ids=rows[0].manifestBookingRowIds.split('|');rows[0].manifestBookingRowIds=(mode==='omit'?ids.slice(1):ids.reverse()).join('|');await witness('C03 row IDs '+mode,rows,false);}
 console.log(checked+' finite retained domain witnesses; baseline-GREEN, no production changes');
})().catch(e=>{console.error(e);process.exitCode=1;});
`+'\n`,context);';
vm.runInNewContext(source,{require,Buffer,console,process,__dirname:dir});
