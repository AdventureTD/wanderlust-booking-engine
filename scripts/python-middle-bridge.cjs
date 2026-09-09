'use strict';
// External test-only adapter: unchanged frozen declaration prefix, native hooks.
// No main(), native case bodies, other verifier or producer is dispatched.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, 'verify-guest-booking-invoice-delivery.js'), 'utf8');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'), '801afb35e13b9af1848aef650165d4a92df67a89e295853622753c42764cfeb6');
function extract(start, end) {
  assert.equal(source.split(start).length, 2);
  const rest = source.split(start)[1];
  assert.ok(rest.includes(end));
  return rest.split(end)[0];
}
const prefix = source.split('async function main(){')[0];
assert.equal(source.split('async function main(){').length, 2);
const nativeHook = extract("const run=await call(s.f,'tryStart',s.startPayload,async e=>{\n      if(e.phase==='beforeInsert'", '\n    });');
// Restore the exact beginning consumed by the unambiguous extraction marker.
const nativeBody = "\n      if(e.phase==='beforeInsert'" + nativeHook;
const driftBody = extract("const run=await call(f,operation,operation==='commitArtifact'?s.input:operation==='tryStart'?s.startPayload:s.ackPayload,async e=>{", '\n        });');
const tail = `
async function middleBridge() {
  graphRegression(); // compile-only graph admission before actual backend IO
  if (process.argv[2] === '--preflight') {
    assert.equal(cases.size + 2, 89);
    console.log('PASS frozen graph; 89 declared cases; native GDR01/GDR02 hooks extracted');
    return;
  }
  assert.equal(process.argv[2], '--middle-bridge');
  assert.equal(process.argv.length, 3);
  const f=fixture(); await admission(f);
  const root=structuredClone(f.db.rows[JOURNAL][0]);
  const original=structuredClone(f.db.rows);
  console.log(JSON.stringify({issuanceId:root._id}));
  const lines=require('node:readline').createInterface({input:process.stdin});
  for await (const line of lines) {
    const request=JSON.parse(line), operation=request.operation, payload=request.payload||{};
    if(operation==='snapshot') {
      console.log(JSON.stringify({result:{rows:structuredClone(f.db.rows)},trace:[]}));continue;
    }
    assert.ok(['readIssuance','commitArtifact','tryStart','recordAck'].includes(operation));
    const schedule=request.schedule;
    let hook, evidence=null;
    const before=structuredClone(f.db.rows);
    if(schedule?.kind==='drift') {
      assert.ok(['commitArtifact','tryStart'].includes(operation));
      const {target,dimension,timing}=schedule;
      assert.ok(['receipt','admission'].includes(target));
      assert.ok(['recipient','amount','order'].includes(dimension));
      assert.ok(['initial','second'].includes(timing));
      const s={root}; let changed=0, expected;
      const mutate=()=>{drift(f,target,dimension);changed++;expected=structuredClone(f.db.rows);};
      if(timing==='initial') mutate();
      hook=async e=>{${driftBody}\n};
      evidence=run=>{
        assert.equal(changed,1);assert.equal(run.result.status,'UNAVAILABLE');noGrant(run.result);
        assert.equal(inserts(run.trace).length,0);assert.deepEqual(f.db.rows,expected);
        for(const name of Object.keys(original)) if(name!==JOURNAL&&name!=='GuestBookingCompletions') assert.deepEqual(f.db.rows[name],original[name]);
        return {schedule,changed,before,after:structuredClone(f.db.rows)};
      };
    } else if(schedule?.kind==='nativeStart') {
      assert.equal(operation,'tryStart');
      const fault=schedule.fault;
      assert.ok(['before','lostAck','unreadable','mismatch'].includes(fault));
      const record=expectedStage({root},'START',payload);
      let applied=false,hits=0;const native=[];
      hook=async e=>{${nativeBody}\n};
      evidence=run=>{
        assert.equal(hits,1);assert.equal(run.result.status,'OWNER_REVIEW_REQUIRED');noGrant(run.result);
        exactAttempts(run.trace,record._id);assert.deepEqual(native,[record]);
        assert.equal(run.trace.filter(t=>t.op==='insertAck'&&t.id===record._id).length,['unreadable','mismatch'].includes(fault)?1:0);
        const expected={...before,[JOURNAL]:[...before[JOURNAL],...(fault==='before'?[]:[record])]};
        assert.deepEqual(f.db.rows,expected);unchangedExceptJournal(f,before);
        return {schedule,hits,applied,native,before,after:structuredClone(f.db.rows)};
      };
    } else assert.equal(schedule,undefined);
    const run=await call(f,operation,payload,hook);
    if(evidence) run.evidence=evidence(run);
    console.log(JSON.stringify(run));
  }
}
return middleBridge();
`;
// Native host allocation avoids host/VM strict-equality fixture mismatches.
vm.compileFunction(prefix + tail, ['require','__dirname'], {filename:__filename})(require,__dirname)
  .catch(error=>{console.error(error);process.exitCode=1;});
