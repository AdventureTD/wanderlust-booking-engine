'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const candidate = 'velo/backend/guestBookingCompletionProjection.js';
assert.ok(fs.existsSync(path.join(root, candidate)), 'missing deterministic completion projection feature');
const url = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
async function main() {
  const groupsURL = url(read('velo/backend/guestBookingPriceGroups.js'));
  const financialURL = url(read('velo/backend/guestBookingFinancialCalculation.js').replace("'backend/guestBookingPriceGroups'", JSON.stringify(groupsURL)));
  const {calculateGuestBookingFinancials} = await import(financialURL);
  const source = read(candidate);
  const {projectGuestBookingCompletion} = await import(url(source.replace("'backend/guestBookingFinancialCalculation'", JSON.stringify(financialURL))));
  // Reuse the existing financial suite's public fixture factory verbatim, not a fake producer.
  const fixtureSource = read('scripts/verify-guest-booking-financial-calculation.js');
  const setup = fixtureSource.match(/const setup = `([\s\S]*?)`;/)[1];
  const vm = require('node:vm');
  const fixtureFactors = overrides => JSON.parse(vm.runInNewContext(setup + '\nJSON.stringify(factors(' + JSON.stringify(overrides) + '))', {calculateGuestBookingFinancials}));
  function fixture(overrides = {}) {
    const factors = fixtureFactors({totalPerPerson:.05,priceGroups:[{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:1,guests:2}],...overrides});
    const calculation = calculateGuestBookingFinancials(factors);
    assert.notEqual(calculation, 'DENIED');
    const purchase = ['wbe.guest-purchase-input',1,'2026-10-01','2026-10-03','pkg','synthetic-quote','',['Guest','guest@example.test','123','+1','accepted note','direct'],['','','',''],factors.priceGroups.map(g=>[g.roomCode,g.quantity,g.guests])];
    const root = {acceptanceId:'a'.repeat(64),rootDigest:'b'.repeat(64),operationId:'c'.repeat(64),bookingNumber:'W'+ 'd'.repeat(48),validatedAtMs:1700000000000};
    const bookingRows = [], classBindings = [];
    factors.priceGroups.forEach((g,index)=>{
      let binding=classBindings.find(b=>b.roomCode===g.roomCode);
      if(!binding){binding={roomCode:g.roomCode,refs:[]};classBindings.push(binding);}
      for(let ordinal=0;ordinal<g.quantity;ordinal++){
        const _id='row-'+bookingRows.length;
        binding.refs.push({originalGroupIndex:index,ordinal,bookingRowId:_id});
        bookingRows.push({_id,roomCode:g.roomCode,assignedRoom:'unit-'+bookingRows.length,quantity:1,checkIn:purchase[2],checkOut:purchase[3],bookingNumber:root.bookingNumber,operationId:root.operationId,payloadDigest:'e'.repeat(64)});
      }
    });
    return {root,capsule:{inputCanonical:JSON.stringify(purchase),quote:{packageTitle:'Accepted package'},factors,calculation},plan:{manifestId:'manifest-synthetic',manifestDigest:'f'.repeat(64),primaryBookingRowId:bookingRows[0]._id,bookingRows,classBindings}};
  }
  const project = f => projectGuestBookingCompletion(JSON.stringify(f));
  const f=fixture(), before=JSON.stringify(f), result=project(f);
  assert.equal(result.kind,'PARTIAL_PROJECTION_PROPOSAL');
  assert.equal(result.summary.acceptedCalculation.totals.grandTotalCents,26);
  assert.equal(JSON.stringify(result.summary.acceptedCalculation),JSON.stringify(f.capsule.calculation));
  assert.deepEqual(result.plannedBookingRows.map(r=>r.originalGroupIndex),[0,1]);
  assert.deepEqual(result.plannedBookingRows.map(r=>r._id),['row-0','row-1']);
  assert.equal(JSON.stringify(f),before);
  console.log('PASS P01 original calculator-produced duplicate groups and exact physical mapping');
  const reject = mutate => {const f=fixture();mutate(f);assert.equal(project(f),'DENIED');};
  for(const n of [1,2,3,4]) {
    const priceGroups=Array.from({length:Math.min(n,3)},()=>({roomCode:'adventure_suite',quantity:1,guests:2}));
    if(n===4)priceGroups.push({roomCode:'penthouse_apartment',quantity:1,guests:2});
    const p=project(fixture({priceGroups,penthouseRoomFee:n===4?0:null}));
    assert.equal(p.kind,'PARTIAL_PROJECTION_PROPOSAL');assert.equal(p.plannedBookingRows.length,n);
  }
  for(const mutate of [
    f=>f.plan.bookingRows.pop(),f=>f.plan.bookingRows.push({...f.plan.bookingRows[0]}),
    f=>f.plan.classBindings[0].refs.pop(),f=>f.plan.classBindings[0].refs.push({...f.plan.classBindings[0].refs[0]}),
    f=>f.plan.bookingRows[0].checkIn='2026-02-30',f=>f.plan.bookingRows[0].checkOut='2026-10-04',
    f=>f.plan.bookingRows[0].bookingNumber='OTHER',f=>f.plan.bookingRows[0].operationId='0'.repeat(64),
    f=>f.plan.bookingRows[0].roomCode='penthouse_apartment',f=>f.plan.primaryBookingRowId='row-1',
    f=>f.plan.classBindings[0].refs[0].ordinal=2,f=>f.plan.bookingRows[1].assignedRoom=f.plan.bookingRows[0].assignedRoom,
    f=>f.capsule.factors.priceGroups.push({roomCode:'adventure_suite',quantity:3,guests:2})
  ]) reject(mutate);
  console.log('PASS P02 finite row/ref/date/identity/four-room admission');
  for(const key of ['grossCents','discountCents','roomTotalCents','propertyFeeCents','accommodationVatCents','packageVatCents','grandTotalCents']) {
    reject(f=>{f.capsule.calculation=JSON.parse(JSON.stringify(f.capsule.calculation));f.capsule.calculation.groups[0][key]++;});
    reject(f=>{f.capsule.calculation=JSON.parse(JSON.stringify(f.capsule.calculation));f.capsule.calculation.totals[key]++;});
  }
  reject(f=>{f.capsule.calculation=JSON.parse(JSON.stringify(f.capsule.calculation));f.capsule.calculation.groups.reverse();});
  reject(f=>{f.capsule.factors.priceGroups=[{roomCode:'adventure_suite',quantity:2,guests:2}];f.capsule.calculation=calculateGuestBookingFinancials(f.capsule.factors);});
  console.log('PASS P03 baseline-GREEN original calculation reconciliation, no repricing IO');
  assert.equal(JSON.stringify(project(f)),JSON.stringify(result));
  assert.equal(result.summary.bookingDate,'2023-11-14T22:13:20.000Z');
  for(const [key,value] of Object.entries({bookingNumber:f.root.bookingNumber,guestName:'Guest',guestEmail:'guest@example.test',guestPhone:'123',dialingCode:'+1',notes:'accepted note',marketSource:'direct',packageTitle:'Accepted package',roomCount:2,totalGuests:4,checkIn:'2026-10-01',checkOut:'2026-10-03'}))assert.equal(result.summary[key],value,key);
  console.log('PASS P04 stable complete Summary mapping');
  const digest=(domain,value)=>crypto.createHash('sha256').update(domain+'\n'+JSON.stringify(value)).digest('hex');
  const binding=result.receiptBindingProposal;
  assert.ok(binding,'missing inert receipt-binding proposal');
  assert.equal(binding.kind,'UNTRUSTED_RECEIPT_BINDING_PROPOSAL');
  assert.equal(binding.financialDigest,digest('wbe.completion-financial.v1',result.summary.acceptedCalculation));
  assert.equal(binding.summaryDigest,digest('wbe.completion-summary.v1',result.summary));
  assert.deepEqual(binding.rowDigests,result.plannedBookingRows.map(r=>digest('wbe.completion-row.v1',r)));
  assert.deepEqual(binding.bookingRowIds,['row-0','row-1']);
  assert.equal(binding.recipient,'guest@example.test');
  assert.ok(!JSON.stringify(result).includes('CONFIRMED'));
  assert.equal(result.status,undefined);assert.equal(binding.outcome,undefined);
  const imports=[...source.matchAll(/^import .* from '([^']+)';/gm)].map(m=>m[1]);
  assert.deepEqual(imports,['backend/guestBookingFinancialCalculation','crypto','buffer']);
  assert.ok(!/wix-|fetch\(|Date\.now|Math\.random|guestBookingCredentials|guestBookingAllocationManifest/.test(source));
  console.log('PASS P05 digest-bound inert proposal, no completion authority');
  const metadata=fixture();metadata.root._owner=null;metadata.root._createdDate='2026-01-01T00:00:00.000Z';
  metadata.plan.bookingRows.forEach(r=>{r._owner=null;r._updatedDate='2026-01-02T00:00:00.000Z';});
  assert.equal(JSON.stringify(project(metadata)),JSON.stringify(result),'SDK metadata excluded from application identity');
  reject(f=>f.plan.bookingRows[0].status='confirmed');
  reject(f=>f.capsule.guestEmail='override@example.test');
  reject(f=>f.root._owner='x'.repeat(262144));
  reject(f=>f.plan.bookingRows[0]._owner={unexpected:true});
  reject(f=>f.capsule.quote.packageTitle=null);
  reject(f=>{const p=JSON.parse(f.capsule.inputCanonical);p[7][1]=null;f.capsule.inputCanonical=JSON.stringify(p);});
  let hooks=0;assert.equal(projectGuestBookingCompletion({toString(){hooks++;return before;}}),'DENIED');assert.equal(hooks,0);
  assert.equal(projectGuestBookingCompletion(before,{}),'DENIED');
  reject(f=>{f.plan.bookingRows[0]._id=null;f.plan.classBindings[0].refs[0].bookingRowId=null;f.plan.primaryBookingRowId=null;});
  const reorderedKeys=fixture();reorderedKeys.plan.bookingRows=reorderedKeys.plan.bookingRows.map(r=>Object.fromEntries(Object.entries(r).reverse()));
  assert.equal(JSON.stringify(project(reorderedKeys)),JSON.stringify(result));
  const mixed=fixture({priceGroups:[{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:2,guests:2},{roomCode:'two_bedroom_apartment',quantity:1,guests:3}],penthouseRoomFee:10.005});
  mixed.plan.bookingRows.reverse();mixed.plan.primaryBookingRowId=mixed.plan.bookingRows[0]._id;
  const mapped=project(mixed);assert.equal(mapped.kind,'PARTIAL_PROJECTION_PROPOSAL');
  assert.deepEqual(mapped.plannedBookingRows.map(r=>[r.originalGroupIndex,r.ordinal,r.guests]),[[2,0,3],[1,1,2],[1,0,2],[0,0,2]]);
  assert.equal(JSON.stringify(mapped.summary.acceptedCalculation),JSON.stringify(mixed.capsule.calculation));
  for(const directory of ['velo']) {
    function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())scan(p);else if(/\.(js|jsw|html)$/.test(e.name)&&p!==path.join(root,candidate))assert.ok(!fs.readFileSync(p,'utf8').includes('guestBookingCompletionProjection'),'no incoming production consumer: '+p);}}
    scan(path.join(root,directory));
  }
  console.log('PASS P06 normalized metadata separation, full envelope and inert text boundary');
  console.log('SUMMARY '+JSON.stringify({criteria:['P01','P02','P03','P04','P05','P06'],count:6,scope:'synthetic normalized plan/root; actual financial calculator fixtures; no runtime authority'}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
