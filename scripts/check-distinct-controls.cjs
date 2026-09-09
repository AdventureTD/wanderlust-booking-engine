'use strict';
const assert=require('node:assert/strict');
assert.ok(process.argv.length===3&&process.argv[2]==='--controls','exact controls selector');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const L=require('./distinct-loader.cjs');
let checked=0;
for(const kind of ['producer','consumer']){
  L.validate(kind);
  for(const [file,digest] of Object.entries(L.pins[kind])){
    const absolute=path.join(L.ROOT,file),text=L.canonical(fs.readFileSync(absolute));
    for(const bytes of [Buffer.from(text),Buffer.from(text.replace(/\n/g,'\r\n'))]){
      assert.equal(L.reader({[file]:digest},()=>bytes)(absolute,'utf8'),text);
    }
    assert.throws(()=>L.reader({[file]:digest},()=>Buffer.from(text+'\n'))(absolute,'utf8'),/whole-file pin/);
    checked++;
  }
  for(const target of ['../escape.js','velo/backend/unknown.js','velo/backend/guestBookingAcceptance.js/../../escape.js'])
    assert.throws(()=>L.reader(L.pins[kind],()=>{throw Error('reader must not be reached');})(path.resolve(L.ROOT,target),'utf8'),/path escape|undeclared source/);
}
for(const table of [L.pins.prefix,L.pins.consumerPrefix])for(const [file,digest] of Object.entries(table)){
  const absolute=path.join(L.ROOT,file),text=L.canonical(fs.readFileSync(absolute));
  for(const bytes of [Buffer.from(text),Buffer.from(text.replace(/\n/g,'\r\n'))]) assert.equal(L.reader(table,()=>bytes)(absolute,'utf8'),text);
  assert.throws(()=>L.reader(table,()=>Buffer.from(text+'// appended content\n'))(absolute,'utf8'),/whole-file pin/);
}
// Full producer declaration initialization only. Every backend read is a hard failure.
let backendReads=0;
const inert=L.restrictedRequire(()=>{backendReads++;throw Error('backend dispatch forbidden');});
const source=L.prefix('producer');
const api=vm.compileFunction(source+'\nreturn {database};',['require','Buffer','__dirname'])(inert,Buffer,path.join(L.ROOT,'scripts'));
const db=api.database();db.rows.GuestBookingCompletions=[];db.rows.BookingPayments=[];
const snapshot=structuredClone(db);assert.deepEqual(db,snapshot);assert.equal(backendReads,0);
db.rows.Bookings.push({_id:'native-mutation'});assert.throws(()=>assert.deepEqual(db,snapshot));db.rows.Bookings.pop();assert.deepEqual(db,snapshot);
const trace=[];assert.deepEqual(trace,[]);trace.push({op:'insert'});assert.throws(()=>assert.deepEqual(trace,[]));
assert.throws(()=>assert.deepEqual(['penthouse','suite'],['suite','penthouse']));
const outputs=[];
for(const script of ['produce-guest-invoice-distinct-fixture.cjs','gp02-distinct-consumer.cjs']){
  for(const args of [[],['--unknown'],['--controls','extra'],['--produce']]){
    const run=cp.spawnSync(process.execPath,[path.join(__dirname,script),...args],{encoding:'utf8',timeout:15000});
    assert.equal(run.status,1);assert.match(run.stderr,/exact selector required before loading/);
    outputs.push({script,args,exit:run.status,stdout:run.stdout,stderr:run.stderr});
  }
  const run=cp.spawnSync(process.execPath,[path.join(__dirname,script),'--controls'],{encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr);outputs.push({script,args:['--controls'],exit:run.status,stdout:run.stdout,stderr:run.stderr});
}
console.log(JSON.stringify({status:'PASS',scope:'backend-free only',checkedSourceEntries:checked,backendReads,outputs},null,2));
