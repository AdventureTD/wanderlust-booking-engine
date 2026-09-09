'use strict';
// Dedicated GP02 only. No default body, historical registry or discovery.
const assert=require('node:assert/strict');
assert.ok(process.argv.length===3 && ['--gp02-distinct-fixture','--controls'].includes(process.argv[2]),'exact selector required before loading');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const L=require('./distinct-loader.cjs');
const read=L.validate('producer'),source=L.prefix('producer');
const compile=()=>vm.compileFunction(source+`\nreturn {database,issue,subject, instrument(wrap){const original=subject;subject=(db,hooks={})=>wrap(original,db,hooks);}};`,['require','Buffer','__dirname']);
if(process.argv[2]==='--controls') {
  compile(); // Compile only: even declaration initialization is NOT evaluated.
  console.log('PASS producer 31-module pins/edges and exact native wrapper compile; zero backend evaluation');
} else {
  const output=path.resolve(L.ROOT,'../booking-invoice-delivery-distinct-fixture');
  fs.mkdirSync(output); // Exclusive directory: fail rather than overwrite evidence.
  let db,pending;const sessions=[],steps=[];let exit=1;
  const timer=setTimeout(()=>{fs.writeFileSync(path.join(output,'timeout.json'),JSON.stringify({exit:124,db,pending,steps,sessions}));process.exit(124);},120000);
  async function run(){
    const api=compile()(L.restrictedRequire(read),Buffer,path.join(L.ROOT,'scripts'));
    const writable=new Set(['GuestBookingAcceptances','GuestBookingAllocationManifests','GuestBookingAcquisitionControls','RoomBookingClaimEvents','Bookings','BookingSummary','GuestBookingCompletions']);
    api.instrument((original,store,hooks)=>{
      const record={trace:[],loaded:[],acknowledged:[]};sessions.push(record);
      const s=original(store,{...hooks,before(c,row){assert.ok(writable.has(c),'forbidden writer '+c);},after(c,row){record.acknowledged.push({c,row:structuredClone(row)});}});
      record.trace=s.trace;record.loaded=s.loadedBackendNames;
      // Keep serializable loaded names current without exposing backend authority.
      Object.defineProperty(record,'loaded',{enumerable:true,get:()=>s.loadedBackendNames()});
      return s;
    });
    db=api.database();db.rows.GuestBookingCompletions=[];db.rows.BookingPayments=[];
    const revisions=structuredClone(db.rows.GuestBookingFinancialRevisions);
    const config=structuredClone(db.config),keys=structuredClone(db.keys);
    Object.freeze(db.rows.BookingPayments);
    const groups=[{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'penthouse_apartment',quantity:1,guests:2}];
    const issued=await api.issue(db,groups); // Actual issuer, acceptance and handoff assertions in frozen issue().
    assert.equal(db.rows.GuestBookingAcceptances.length,1);assert.equal(db.rows.GuestBookingAllocationManifests.length,1);
    const acceptance=db.rows.GuestBookingAcceptances[0];assert.equal(issued.A,acceptance._id);
    pending=structuredClone(db);
    let confirmed=false;
    for(let iteration=0;iteration<200;iteration++){
      const s=api.subject(db),before=structuredClone(db);
      const result=await s.load('backend/guestBookingPhysicalAcquisition').resumeGuestBookingPhysicalAcquisition(issued.A);
      steps.push({iteration,result:structuredClone(result),trace:s.trace,before,retained:structuredClone(db)});
      assert.ok(s.trace.filter(t=>t.op==='insert').length<=1,'one insert per resume');
      assert.deepEqual(db.rows.GuestBookingFinancialRevisions,revisions);assert.deepEqual(db.rows.BookingPayments,[]);
      assert.deepEqual(db.config,config);assert.deepEqual(db.keys,keys);
      if(result.status==='CONFIRMED'){confirmed=true;break;}
      assert.ok(['ACQUISITION_PENDING','COMPLETION_PENDING'].includes(result.status),'unexpected '+JSON.stringify(result));
    }
    assert.ok(confirmed,'200 invocation cap');assert.equal(db.rows.GuestBookingCompletions.length,1);
    const receipt=db.rows.GuestBookingCompletions[0];assert.equal(receipt.outcome,'CONFIRMED');
    assert.deepEqual(db.rows.Bookings,JSON.parse(receipt.bookingRowsCanonical));
    assert.deepEqual(db.rows.BookingSummary,[JSON.parse(receipt.summaryCanonical)]);
    const projection=JSON.parse(receipt.projectionCanonical);
    assert.deepEqual(projection.summary.acceptedCalculation,JSON.parse(acceptance.capsule).calculation);
    assert.deepEqual(projection.summary.acceptedCalculation.groups.map(g=>[g.index,g.roomCode]),[[0,'adventure_suite'],[1,'penthouse_apartment']]);
    assert.deepEqual([...new Set(sessions.flatMap(s=>s.loaded))].sort(),Object.keys(L.pins.producer).map(n=>n.slice(5,-3)).sort());
    const artifact={version:1,sourceHashes:L.pins.producer,expected:{acceptanceId:acceptance._id,operationId:acceptance.operationId,rootDigest:acceptance.rootDigest},db,pending};
    for(const k of ['acceptanceId','operationId','rootDigest'])assert.equal(receipt[k],artifact.expected[k]);
    const bytes=JSON.stringify(artifact,null,2)+'\n';
    fs.writeFileSync(path.join(output,'completion-authority-distinct-groups.json'),bytes,{flag:'wx'});
    fs.writeFileSync(path.join(output,'artifact-hashes.json'),JSON.stringify({raw:L.sha(bytes),canonicalLF:L.sha(bytes)}),{flag:'wx'});
    exit=0;console.log('PASS GP02 distinct actual writer fixture '+L.sha(bytes));
  }
  run().catch(error=>{console.error(error);steps.push({error:String(error),stack:error.stack});process.exitCode=1;}).finally(()=>{
    clearTimeout(timer);fs.writeFileSync(path.join(output,'producer-evidence.json'),JSON.stringify({exit,normalization:L.pins.normalization,sourceHashes:L.pins,steps,sessions,db,pending},null,2),{flag:'wx'});
  });
}
