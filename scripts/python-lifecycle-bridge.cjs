'use strict';
// Dedicated test-only multiplexed native bridge; no shared verifier edits.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname,'verify-guest-booking-invoice-delivery.js'),'utf8');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'801afb35e13b9af1848aef650165d4a92df67a89e295853622753c42764cfeb6');
assert.equal(source.split('async function main(){').length,2);
const prefix = source.split('async function main(){')[0];
const tail = `
async function lifecycleBridge() {
  graphRegression();
  if(process.argv[2]==='--preflight') {console.log('PASS frozen graph; native lifecycle adapter compiled');return;}
  assert.equal(process.argv[2],'--lifecycle-bridge');assert.equal(process.argv.length,3);
  const f=fixture();await admission(f);
  const root=structuredClone(f.db.rows[JOURNAL][0]);
  console.log(JSON.stringify({issuanceId:root._id}));
  let race=null;
  const pending=new Set();
  const emit=(id,value)=>console.log(JSON.stringify({id,...value}));
  async function handle(request) {
    const {id,operation,payload={},client='control'}=request;
    if(operation==='snapshot') {emit(id,{result:{rows:structuredClone(f.db.rows)},trace:[]});return;}
    if(operation==='armRace') {
      assert.equal(race,null);
      let release,reject;
      const gate=new Promise((yes,no)=>{release=yes;reject=no;});
      race={before:structuredClone(f.db.rows),attempts:[],gate,release,reject,arrived:false};
      race.timer=setTimeout(()=>reject(Error('native START barrier timeout')),10000);
      emit(id,{result:{armed:true},trace:[]});return;
    }
    assert.ok(['readIssuance','commitArtifact','tryStart','recordAck'].includes(operation));
    const native=[];
    const hook=async e=>{
      if(e.phase==='beforeInsert'&&e.row.kind==='START') {
        native.push(structuredClone(e.row));
        if(race&&!race.arrived) {
          race.attempts.push({client,row:structuredClone(e.row)});
          if(race.attempts.length===2) {
            assert.notEqual(race.attempts[0].client,race.attempts[1].client);
            assert.notEqual(race.attempts[0].row.invocationNonce,race.attempts[1].row.invocationNonce);
            assert.deepEqual(f.db.rows,race.before,'no native write before both arrivals');
            race.arrived=true;clearTimeout(race.timer);race.release();
          }
          await race.gate;
        }
      }
    };
    const run=await call(f,operation,payload,hook);
    emit(id,{...run,evidence:{client,native,race:race?{arrived:race.arrived,attempts:race.attempts,before:race.before}:null}});
  }
  const lines=require('node:readline').createInterface({input:process.stdin});
  for await(const line of lines) {
    const request=JSON.parse(line);
    const task=handle(request).catch(error=>{console.error(error);process.exitCode=1;emit(request.id,{error:String(error)});});
    pending.add(task);task.finally(()=>pending.delete(task));
  }
  await Promise.all(pending);if(race) clearTimeout(race.timer);
}
return lifecycleBridge();
`;
vm.compileFunction(prefix+tail,['require','__dirname'],{filename:__filename})(require,__dirname)
  .catch(error=>{console.error(error);process.exitCode=1;});
