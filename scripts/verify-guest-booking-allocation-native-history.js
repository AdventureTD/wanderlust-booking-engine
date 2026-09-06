'use strict';
// Synthetic rc1 history only. Native metadata is made at the SDK boundary.
const fs=require('node:fs'),vm=require('node:vm');
const dir=__dirname;
let source=fs.readFileSync(dir+'/verify-guest-booking-allocation-evidence.js','utf8');
const marker='(async()=>{let failures=0;';const i=source.indexOf(marker);if(i<0)throw Error('fixture boundary');
source=source.slice(0,i)+String.raw`
(async()=>{
 for(const expression of ['new Date(1700000000000)','new Date(8640000000000000)','new Date(-8640000000000000)','new Date(8640000000000001)','new Number(1700000000000)']){
  const {s,accepted}=await setup(),core=s.load('backend/roomBookingCommitRules');
  const old=core.buildPhysicalCommitPlan(s.realm({occupiedUnits:[],occupiedUnitsByNight:{'2026-01-01':[]},migrationIssueRows:[],duplicateUnitClaims:[],unknownStatusRows:[]}),s.realm([]),s.realm({operationId:'historyoperation0001',bookingNumber:'HISTORY',payloadDigest:'1'.repeat(64),checkIn:'2026-01-01',checkOut:'2026-01-02',roomCode:'adventure_suite',quantity:1}));
  const op=plain(old.acquisitions[0]);
  const complete={_id:'rc1-op-'+op.operationId+'-c',protocolVersion:1,claimKey:'operation:'+op.operationId+':completion',generation:1,eventType:'complete',claimType:'operation-completion',operationId:op.operationId,bookingRowId:op.bookingRowId,bookingNumber:op.bookingNumber,payloadDigest:op.payloadDigest,completionState:'complete',confirmedResourceCount:old.acquisitions.length-1,decisionFenceVersion:1};
  const decision={_id:'rc1-op-'+op.operationId+'-d',protocolVersion:1,claimKey:'operation:'+op.operationId+':decision',generation:1,eventType:'decide',claimType:'operation-decision',operationId:op.operationId,bookingRowId:op.bookingRowId,bookingNumber:op.bookingNumber,payloadDigest:op.payloadDigest,decisionFenceVersion:1,operationIdentityId:op._id,operationCompletionId:complete._id,manifestVersion:1,completionState:'complete',confirmedResourceCount:complete.confirmedResourceCount,decisionState:'compensate'};
  const ledger=plain([...old.acquisitions,complete,decision,...core.planPhysicalRollback(old.acquisitions,'Synthetic cancellation')]);s.state.db.rows.RoomBookingClaimEvents=ledger;
  pages(s,(p,c)=>{if(c==='RoomBookingClaimEvents'){s.context.rows=p.items;vm.runInContext('for(const r of rows){r._owner="fixture-owner";r._createdDate='+expression+';r._updatedDate=new Date(1700000000001);}',s.context);if(expression.startsWith('new Date'))assert.equal(vm.runInContext('rows.every(r=>r._createdDate instanceof Date)',s.context),true);}return p;});
  const expected=['new Date(8640000000000001)','new Number(1700000000000)'].includes(expression)?'ALLOCATION_PENDING':'ALLOCATION_HANDOFF_PENDING';
  const result=await handoff(s,accepted);assert.equal(result.status,expected,expression);
  if(expected==='ALLOCATION_HANDOFF_PENDING'){
   const evidence=JSON.parse(s.state.db.rows.GuestBookingAllocationManifests[0].manifestCanonical)[9];assert.equal(evidence[2].length,ledger.length);assert.ok(evidence[2].every(r=>!Object.hasOwn(r,'_createdDate')&&!Object.hasOwn(r,'_updatedDate')&&!Object.hasOwn(r,'_owner')));assert.ok(evidence[3].every(r=>r[1]==='fixture-owner'&&r[2]===new Date(Number(expression.match(/-?\d+/)[0])).getTime()&&r[3]===1700000000001));
   for(const r of ledger)assert.deepEqual(evidence[2].find(e=>e._id===r._id),r);
  }else noInsert(s);
  console.log(JSON.stringify({expression,status:result.status,completeDecisionReleasedHistory:true,allApplicationFieldsPreserved:expected==='ALLOCATION_HANDOFF_PENDING'}));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
`+'\n`,context);';
vm.runInNewContext(source,{require,Buffer,console,process,__dirname:dir});
