'use strict';
const assert=require('node:assert/strict');
assert.ok(process.argv.length===3 && ['--gp02-distinct-bridge','--controls'].includes(process.argv[2]),'exact selector required before loading');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const L=require('./distinct-loader.cjs'),read=L.validate('consumer'),source=L.prefix('consumer');
const compile=()=>vm.compileFunction(source+'\nreturn worker;', ['assert','fs','path','vm','crypto','Buffer','ROOT','JOURNAL','pins','readerPins']);
if(process.argv[2]==='--controls'){
  compile();console.log('PASS consumer closed graph and whole worker compile; zero backend evaluation');
}else{
  const admission=JSON.parse(fs.readFileSync(path.join(__dirname,'distinct-artifact-admission.json'),'utf8'));
  assert.equal(admission.status,'REVIEWED_ARTIFACT');
  assert.equal(admission.path,'scripts/fixtures/completion-authority-distinct-groups.json');
  assert.match(admission.sha256CanonicalLF,/^[a-f0-9]{64}$/);
  const bytes=fs.readFileSync(path.resolve(L.ROOT,admission.path));assert.equal(L.sha(L.canonical(bytes)),admission.sha256CanonicalLF);
  const f=JSON.parse(bytes);assert.equal(f.version,1);assert.deepEqual(f.sourceHashes,L.pins.producer);
  assert.ok(!Object.hasOwn(f.db.rows,'GuestBookingInvoiceIssuances'),'no fabricated journal');
  const worker=compile()(assert,{readFileSync:read},path,vm,crypto,Buffer,L.ROOT,'GuestBookingInvoiceIssuances',L.pins.consumer,{});
  const before=structuredClone(f.db.rows),trace=[];
  const args=[f.expected.acceptanceId,f.expected.operationId,f.expected.rootDigest];
  function unchanged(){for(const key of new Set([...Object.keys(before),...Object.keys(f.db.rows)]))if(key!=='GuestBookingInvoiceIssuances')assert.deepEqual(f.db.rows[key],before[key],key);}
  const emit=v=>console.log(JSON.stringify(v));
  const timer=setTimeout(()=>{console.error('bridge 90s deadline');process.exit(124);},90000);
  async function run(){
    const w=worker(f.db),api=await w.api('backend/guestBookingInvoiceIssuance');
    const admitted=await api.advanceInitialGuestInvoiceForRecoveredAcceptance(...args);
    trace.push(...w.trace);assert.equal(admitted.status,'INITIAL_ISSUANCE_ADMITTED');unchanged();
    assert.equal(f.db.rows.GuestBookingInvoiceIssuances.length,1);
    const root=f.db.rows.GuestBookingInvoiceIssuances[0];
    emit({issuanceId:root._id,trace:w.trace});
    let count=0;
    for await(const line of require('node:readline').createInterface({input:process.stdin})){
      assert.ok(++count<=16,'16 operation cap');assert.ok(Buffer.byteLength(line)<=2000000,'request size');
      const request=JSON.parse(line);assert.deepEqual(Object.keys(request).sort(),['operation','payload']);
      const {operation,payload}=request;
      assert.ok(['readIssuance','commitArtifact','tryStart','recordAck','snapshot'].includes(operation),'unknown operation before worker evaluation');
      if(operation==='snapshot'){unchanged();emit({result:{rows:structuredClone(f.db.rows)},trace:[]});continue;}
      const s=worker(f.db),a=await s.api('backend/guestBookingInvoiceDelivery');
      const result=await a.guestBookingInvoiceDeliveryOperation(...args,operation,payload);
      trace.push(...s.trace);unchanged();emit({result,trace:s.trace});
    }
    unchanged();
  }
  run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{clearTimeout(timer);console.error(JSON.stringify({trace,rows:f.db.rows}));});
}
