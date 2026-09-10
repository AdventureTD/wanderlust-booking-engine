'use strict';
// AR01-AR06 only. Actual retained reader, actual Auth/Delivery; inert native SDK.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const L=require('./actual-reader-transport-loader.cjs');
const {plain,sha,J}=L,tests=new Map(),witnesses=[];let current=null,fixtures;
const add=(id,fn)=>{assert.ok(!tests.has(id));tests.set(id,fn);};
const ops=['readIssuance','commitArtifact','tryStart','recordAck'];
const payload=(op)=>{const p=fixtures.journal[1],s=fixtures.journal[2],a=fixtures.journal[3];return op==='commitArtifact'?Object.fromEntries(['encoded','mimeDigest','pdfDigest','rendererVersion'].map(k=>[k,p[k]])):op==='tryStart'?{artifactDigest:s.artifactDigest,invocationNonce:s.invocationNonce}:op==='recordAck'?{artifactDigest:a.artifactDigest,invocationNonce:a.invocationNonce,providerMessageId:a.providerMessageId}:{};};
const initial=op=>fixtures.journal.slice(0,op==='recordAck'?3:op==='tryStart'?2:1);
async function worker(op='readIssuance',hook,changes={},f=fixtures.a){const w=await L.worker(f,initial(op),hook,changes);witnesses.push({id:current,calls:w.calls,trace:w.trace,original:w.original});return w;}
const attempts=x=>x.trace.filter(e=>e.phase==='nativeAttempt');
const downstream=x=>x.trace.filter(e=>e.phase==='find'&&[J,'BookingPayments'].includes(e.collection));
const exits=x=>x.trace.filter(e=>e.phase==='readerExit');
function safe(x,count=0,status='UNAVAILABLE'){assert.equal(x.result.status,status);assert.notEqual(x.result.won,true);assert.equal(x.result.root,undefined);assert.equal(attempts(x).length,count);if(!count)assert.deepEqual(x.after,x.before);else assert.deepEqual(x.after,{...x.before,[J]:[...x.before[J],fixtures.journal[2]]});}
function stable(x){for(const k of new Set([...Object.keys(x.before),...Object.keys(x.after)]))if(k!==J)assert.deepEqual(x.after[k],x.before[k],k);}
function readerStatus(x,status){assert.ok(exits(x).length>0,'actual exported reader must execute');assert.equal(exits(x).at(-1).result.status,status);}
for(const op of ops)add('AR01_bound_valid_operations_'+op,async()=>{
 const w=await worker(op),x=await w.call(op,payload(op));
 const n=op==='readIssuance'?1:op==='tryStart'?3:2;
 assert.equal(exits(x).length,n);assert.ok(exits(x).every(e=>e.result.status==='VERIFIED_COMPLETION'));
 const receipt=fixtures.a.db.rows.GuestBookingCompletions[0];for(const e of exits(x))assert.deepEqual(e.result.receipt,receipt);
 assert.equal(x.trace.filter(e=>e.phase==='retainedReturn'&&e.category==='final-receipt').length,n);
 stable(x);assert.equal(attempts(x).length,op==='readIssuance'?0:1);
 const root=fixtures.journal[0];assert.equal(root.to,receipt.recipient);const projection=JSON.parse(root.projectionCanonical);
 assert.deepEqual(projection.summary.acceptedCalculation.groups.map(g=>[g.index,g.roomCode,g.grandTotalCents]),[[0,'adventure_suite',23500],[1,'penthouse_apartment',25851]]);
 assert.equal(projection.summary.acceptedCalculation.totals.grandTotalCents,49351);
 if(op==='tryStart'){assert.equal(x.result.won,true);assert.equal(x.trace.filter(e=>e.phase==='nativeAck').length,1);const ackIndex=x.trace.findIndex(e=>e.phase==='nativeAck');assert.ok(x.trace.slice(ackIndex+1).some(e=>e.phase==='find'&&e.collection===J&&e.predicates.some(([k,v])=>k==='_id'&&v===fixtures.journal[2]._id)));}
 else {assert.equal(x.result.status,op==='recordAck'?'PROVIDER_ACCEPTED':'READY');assert.deepEqual(x.result.root,root);}
 assert.deepEqual(x.after[J],op==='readIssuance'?initial(op):[...initial(op),fixtures.journal[op==='commitArtifact'?1:op==='tryStart'?2:3]]);
 const replay=await w.call(op,payload(op));assert.notEqual(replay.result.won,true);assert.equal(attempts(replay).length,0);assert.deepEqual(replay.after,replay.before);
});
for(const fault of ['beforeEffect','lostAck','readback'])add('AR01_bound_valid_operations_START_'+fault,async()=>{
 let hit=0,applied=false;
 const w=await worker('tryStart',async e=>{if(e.phase==='nativeEffect'){applied=true;if(fault==='lostAck'){hit++;throw Error('lost native ACK');}}if(e.phase==='beforeNative'&&fault==='beforeEffect'){hit++;throw Error('before effect');}if(applied&&fault==='readback'&&e.phase==='find'&&e.collection===J){hit++;throw Error('unreadable keyed readback');}});
 const x=await w.call('tryStart',payload('tryStart'));assert.equal(hit,1);assert.equal(x.result.status,'OWNER_REVIEW_REQUIRED');assert.notEqual(x.result.won,true);assert.equal(attempts(x).length,1);assert.deepEqual(x.after[J],[...initial('tryStart'),...(fault==='beforeEffect'?[]:[fixtures.journal[2]])]);stable(x);
});
add('AR02_original_subject_foreign_independent_B_control',async()=>{
 const w=await worker('readIssuance',undefined,{},fixtures.b);const before=plain(w.db.rows);const result=plain(await w.reader.readTransportBoundGuestBookingCompletion(w.ctx));
 witnesses.at(-1).directResult=result;assert.equal(result.status,'VERIFIED_COMPLETION');assert.deepEqual(result.receipt,fixtures.b.db.rows.GuestBookingCompletions[0]);assert.equal(downstream(w).length,0);assert.deepEqual(w.db.rows,before);
});
add('AR02_original_subject_foreign_original_A_over_B',async()=>{
 const w=await worker('readIssuance',undefined,fixtures.a.expected,fixtures.b);const x=await w.call('readIssuance');safe(x);readerStatus(x,'UNKNOWN');assert.equal(downstream(x).length,0);
});
for(const timing of ['initial','prewrite','postStart'])add('AR02_original_subject_foreign_audience_'+timing,async()=>{
 const position={initial:1,prewrite:2,postStart:3}[timing];let hit=0;
 const w=await worker('tryStart',async(e,c)=>{if(e.phase==='readerEntry'&&e.position===position){c.db.keys.audience='other:audience';hit++;}}),x=await w.call('tryStart',payload('tryStart'));
 assert.equal(hit,1);safe(x,timing==='postStart'?1:0,timing==='postStart'?'OWNER_REVIEW_REQUIRED':'UNAVAILABLE');readerStatus(x,'UNKNOWN');
 assert.equal(x.trace.filter(e=>e.position===position&&e.phase==='find').length,0);
 for(const e of downstream(x))if(e.collection==='BookingPayments')assert.equal(e.predicates[0][1],fixtures.a.db.rows.GuestBookingCompletions[0].bookingNumber);
 assert.equal(w.auth.transportExpectation(w.ctx).audience,fixtures.a.db.keys.audience);
});
for(const field of ['acceptanceId','operationId','rootDigest','audience','_id'])add('AR03_receipt_and_root_substitution_receipt_'+field,async()=>{
 const w=await worker();const row=w.db.rows.GuestBookingCompletions[0];let hook;
 if(field==='_id'){
  // Native exact lookup returns a grammar-valid foreign ID: actual store rejects.
  row._id='gbc1-'+fixtures.b.expected.acceptanceId;
 }else row[field]=field==='audience'?'other:audience':fixtures.b.expected[field];
 const x=await w.call('readIssuance');safe(x);readerStatus(x,field==='_id'?'UNKNOWN':'INTEGRITY');assert.equal(downstream(x).length,0);
 assert.equal(x.trace.filter(e=>e.phase==='find'&&e.collection==='GuestBookingAcceptances').length,0);
});
add('AR03_receipt_and_root_substitution_native_foreign_receipt_id',async()=>{
 const w=await worker('readIssuance',async e=>{if(e.phase==='find'&&e.collection==='GuestBookingCompletions')return {rows:[fixtures.b.db.rows.GuestBookingCompletions[0]]};});
 const x=await w.call('readIssuance');safe(x);readerStatus(x,'INTEGRITY');assert.equal(downstream(x).length,0);
});
for(const field of ['_id','operationId','rootDigest','audience'])add('AR03_receipt_and_root_substitution_root_'+field,async()=>{
 const w=await worker();w.db.rows.GuestBookingAcceptances[0][field]=field==='audience'?'other:audience':fixtures.b.expected[field==='_id'?'acceptanceId':field];
 const x=await w.call('readIssuance');safe(x);readerStatus(x,field==='_id'?'UNKNOWN':'INTEGRITY');assert.equal(downstream(x).length,0);assert.ok(x.trace.some(e=>e.phase==='find'&&e.collection==='GuestBookingAcceptances'));
});
for(const field of ['acceptanceId','operationId','rootDigest','audience','issuanceId'])add('AR03_receipt_and_root_substitution_context_'+field,async()=>{
 const changes={[field]:field==='audience'?'other:audience':field==='issuanceId'?'a'.repeat(64):fixtures.b.expected[field]};
 const w=await worker('readIssuance',undefined,changes),x=await w.call('readIssuance');
 safe(x,0,['acceptanceId','operationId'].includes(field)?'DENIED':'UNAVAILABLE');assert.equal(downstream(x).length,0);
 if(field==='issuanceId')readerStatus(x,'VERIFIED_COMPLETION');else if(field==='rootDigest')readerStatus(x,'INTEGRITY');else if(field==='audience')readerStatus(x,'UNKNOWN');else assert.equal(exits(x).length,0);
});
add('AR03_receipt_and_root_substitution_context_custody',async()=>{
 const w=await worker('tryStart');const expected=plain(w.auth.transportExpectation(w.ctx));
 for(const k of Object.keys(w.original))w.original[k]=typeof w.original[k]==='number'?0:'changed';assert.deepEqual(plain(w.auth.transportExpectation(w.ctx)),expected);
 for(const ctx of [null,{},Object.freeze({...w.ctx}),{verified:true,...expected}]){const x=plain(await w.reader.readTransportBoundGuestBookingCompletion(ctx));assert.equal(x.status,'UNKNOWN');}
 assert.equal(w.trace.filter(e=>e.phase==='find'||e.phase==='secret').length,0);
 const x=await w.call('tryStart',payload('tryStart'));assert.equal(x.result.won,true);
});
for(const fault of ['absent','pending','conflicting','duplicate','unreadable','financial','recipient'])add('AR04_retained_invalid_'+fault,async()=>{
 const w=await worker('readIssuance',async e=>{if(fault==='unreadable'&&e.phase==='find'&&e.collection==='GuestBookingCompletions')throw Error('storage unavailable');});
 const rows=w.db.rows,receipt=rows.GuestBookingCompletions[0];
 if(fault==='absent')rows.GuestBookingCompletions=[];
 if(fault==='pending'){w.db.rows={...structuredClone(fixtures.a.pending.rows),[J]:structuredClone(initial('readIssuance'))};}
 if(fault==='conflicting')receipt.bookingNumber=fixtures.b.db.rows.GuestBookingCompletions[0].bookingNumber;
 if(fault==='duplicate')rows.GuestBookingCompletions.push(structuredClone(receipt));
 if(['financial','recipient'].includes(fault)){
  const p=JSON.parse(receipt.projectionCanonical);
  if(fault==='financial') {p.summary.acceptedCalculation.totals.grandTotalCents++;receipt.financialDigest=sha('wbe.completion-financial.v1\n'+JSON.stringify(p.summary.acceptedCalculation));p.summary.financialDigest=receipt.financialDigest;}
  else {p.summary.guestEmail='different@example.test';receipt.recipient=p.summary.guestEmail;const s=JSON.parse(receipt.summaryCanonical);s.guestEmail=receipt.recipient;receipt.summaryCanonical=JSON.stringify(s);receipt.summaryDigest=sha('wbe.completion-summary-record.v1\n'+receipt.summaryCanonical);}
  receipt.projectionCanonical=JSON.stringify(p);receipt.projectionDigest=sha('wbe.completion-projection-record.v1\n'+receipt.projectionCanonical);
  receipt.recipientBindingDigest=sha('wbe.completion-recipient.v1\n'+JSON.stringify([receipt.audience,receipt.acceptanceId,receipt.rootDigest,receipt.manifestDigest,receipt.bookingNumber,receipt.summaryId,receipt.recipient,receipt.financialDigest]));
  assert.equal(receipt.projectionDigest,sha('wbe.completion-projection-record.v1\n'+receipt.projectionCanonical));
 }
 const x=await w.call('readIssuance');safe(x);readerStatus(x,['absent','pending','unreadable'].includes(fault)?'UNKNOWN':'INTEGRITY');assert.equal(downstream(x).length,0);
 if(['financial','recipient','conflicting'].includes(fault))assert.ok(x.trace.some(e=>e.phase==='find'&&e.collection==='GuestBookingAllocationManifests'),'reach retained model, not malformed schema');
});
for(const op of ['commitArtifact','tryStart','recordAck'])for(const action of ['expire','revoke'])for(const phase of ['readerAwait','finalReceipt'])add(`AR05_bound_await_expiry_${op}_${action}_${phase}_prewrite`,async()=>{
 let hit=0;
 const w=await worker(op,async(e,c)=>{if(e.position===2&&!hit&&((phase==='readerAwait'&&e.phase==='find'&&e.collection==='GuestBookingAcceptances')||(phase==='finalReceipt'&&e.phase==='retainedReturn'&&e.category==='final-receipt'))){c[action]();hit++;}});
 const x=await w.call(op,payload(op));assert.equal(hit,1);safe(x);readerStatus(x,'VERIFIED_COMPLETION');assert.equal(exits(x).length,2);
});
for(const action of ['expire','revoke'])for(const phase of ['readerAwait','finalReceipt'])add(`AR05_bound_await_expiry_tryStart_${action}_${phase}_postStart`,async()=>{
 let hit=0;const w=await worker('tryStart',async(e,c)=>{if(e.position===3&&!hit&&((phase==='readerAwait'&&e.phase==='find'&&e.collection==='GuestBookingAcceptances')||(phase==='finalReceipt'&&e.phase==='retainedReturn'&&e.category==='final-receipt'))){c[action]();hit++;}});
 const x=await w.call('tryStart',payload('tryStart'));assert.equal(hit,1);safe(x,1,'OWNER_REVIEW_REQUIRED');readerStatus(x,'VERIFIED_COMPLETION');assert.equal(exits(x).length,3);
 const replay=await w.call('tryStart',payload('tryStart'));safe(replay);assert.deepEqual(replay.after,x.after);
});
for(const op of ops)for(const fault of ['nonempty','unreadable','incomplete'])add(`AR06_payments_and_legacy_recovery_${op}_${fault}`,async()=>{
 let hit=0;const w=await worker(op,async e=>{if(e.phase==='find'&&e.collection==='BookingPayments'){hit++;if(fault==='unreadable')throw Error('payment read');return fault==='nonempty'?{rows:[{_id:'payment',bookingNumber:e.predicates[0][1],amount:1}]}:{page:{items:[],hasNext(){return true;}}};}});
 const x=await w.call(op,payload(op));assert.equal(hit,1);safe(x);readerStatus(x,'VERIFIED_COMPLETION');
});
add('AR06_payments_and_legacy_recovery_expired_OFF',async()=>{
 const w=await worker('commitArtifact');w.controls.expire();w.controls.off();w.db.keys.keys=[];w.db.keys.activeKid='expired';
 const before=plain(w.db.rows);const recovered=plain(await w.reader.readRecoveredGuestBookingCompletion(...Object.values(fixtures.a.expected)));witnesses.at(-1).directResult=recovered;
 assert.equal(recovered.status,'VERIFIED_COMPLETION');assert.deepEqual(w.db.rows,before);
 for(const op of ops){const x=await w.call(op,payload(op),true);assert.equal(x.trace.filter(e=>e.phase==='secret'&&e.name!=='WBE_GUEST_BOOKING_KEYS').length,0);stable(x);if(op==='tryStart')assert.equal(x.result.won,true);else assert.equal(x.result.status,op==='recordAck'?'PROVIDER_ACCEPTED':'READY');}
 const bound=await w.call('readIssuance');safe(bound);readerStatus(bound,'UNKNOWN');assert.equal(downstream(bound).length,0);
 assert.equal(w.trace.filter(e=>e.phase==='secret'&&e.name!=='WBE_GUEST_BOOKING_KEYS').length,0);
});
const args=process.argv.slice(2);
assert.equal(args.length,1,'one explicit AR selector required');
assert.ok(args[0]==='--inspect'||args[0]==='--list'||tests.has(args[0]),'unknown/default/restricted selector denied before loading');
const inspection=L.inspect();
if(args[0]==='--inspect'){L.fixtures();for(const [file] of Object.entries(L.pins.runtime)){const text=fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n');new (require('node:vm').SourceTextModule)(L.instrument(file,text));}console.log(JSON.stringify({inspection,ids:[...tests.keys()],status:'SOURCE_SCHEMA_INSPECTED',backendEvaluations:0}));}
else if(args[0]==='--list')console.log(JSON.stringify([...tests.keys()]));
else {
 assert.ok(process.env.AR_EVIDENCE_PATH,'external evidence path required');fixtures=L.fixtures();current=args[0];
 const timer=setTimeout(()=>{console.error('AR native watchdog');fs.writeFileSync(process.env.AR_EVIDENCE_PATH,JSON.stringify({id:current,status:'TIMEOUT',witnesses}));process.exit(124);},60000);
 (async()=>{let status='RED';try{await tests.get(current)();status='PASS';console.log(JSON.stringify({id:current,status,completed:1,actualReader:true}));}finally{clearTimeout(timer);fs.writeFileSync(process.env.AR_EVIDENCE_PATH,JSON.stringify({id:current,status,witnesses}));}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
}
