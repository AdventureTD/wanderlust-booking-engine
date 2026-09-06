'use strict';
// Real issuer/acceptance/manifest; only append-only SDK transport is emulated.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const fixture=fs.readFileSync(path.join(__dirname,'verify-guest-booking-acceptance.js'),'utf8');
const boundary=fixture.indexOf("test('real issuer");assert.ok(boundary>1000);
vm.runInContext(fixture.slice(0,boundary)+`
(async()=>{
 // E1: persisted fixture history from TWO actual accepted manifests. No physical writer.
 await (async()=>{ for(const properPrefix of [false,true]){
 const s=subject(),db=s.state.db;
 for(const c of ['GuestBookingAllocationManifests','GuestBookingAcquisitionControls','RoomBookingClaimEvents','Bookings','BookingSummary'])db.rows[c]=[];
 const insert=s.wix.insert;s.wix.insert=async(c,row,o)=>{if(c!=='GuestBookingAllocationManifests')return insert(c,row,o);db.rows[c].push(plain(row));return s.realm(row);};
 const accepted=[];
 for(let i=0;i<2;i++){
  const p=input();p.priceGroups=[{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:1,guests:2}];
  if(properPrefix&&i===1){const q=JSON.parse(Buffer.from(p.pricingQuoteToken.split('.')[0],'base64url'));q.checkIn=p.checkIn='2027-01-02';q.checkOut=p.checkOut='2027-01-04';const bytes=Buffer.from(JSON.stringify(q)).toString('base64url');p.pricingQuoteToken=bytes+'.'+crypto.createHmac('sha256',QUOTE_KEY).update(bytes).digest('base64url');}
  const offer=await prepared(s,p);assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule)).status,'ACCEPTED_PENDING');
  const a=db.rows.GuestBookingAcceptances[i];assert.equal((await s.load('backend/guestBookingAllocationHandoff').handoffGuestBookingAllocation(a._id)).status,'ALLOCATION_HANDOFF_PENDING');
  const M=db.rows.GuestBookingAllocationManifests[i],valid=s.load('backend/guestBookingAcceptance').validateGuestBookingAcceptanceRoot(s.realm(a));assert.notEqual(valid,'DENIED');assert.equal(s.load('backend/guestBookingAllocationManifestRules').validateGuestBookingAllocationManifest(s.realm(M),valid),true);accepted.push({A:a._id,M:plain(M),T:JSON.parse(M.manifestCanonical)});
 }
 const {A,M,T}=accepted[0],own=T[6][0].acquisitions,foreign=accepted[1].T[6][0].acquisitions,O=own[0].operationId;
 const j=own.findIndex(r=>r._id===foreign[1]._id)-1;assert.ok(properPrefix?j>0:j===0);assert.notEqual(O,foreign[0].operationId);
 const common={acquisitionProtocolVersion:2,admissionId:'ra2-cart-'+A,manifestDigest:M.manifestDigest,operationId:O};
 db.rows.GuestBookingAcquisitionControls=[{_id:'ra2-cart-'+A,acquisitionProtocolVersion:2,kind:'admission',acceptanceId:A,manifestId:M._id,manifestDigest:M.manifestDigest,manifestCanonical:M.manifestCanonical},{...common,_id:'ra2-start-'+O,kind:'group-start',direction:'start'},{...common,_id:'ra2-root-'+O,kind:'root',operationIdentityId:own[0]._id},{...common,_id:'ra2-gate-'+O+'-p0',kind:'gate',rootId:'ra2-root-'+O,index:0,resourceClaimId:own[1]._id,direction:'acquire'}];
 for(let h=1;h<=j;h++)db.rows.GuestBookingAcquisitionControls.push({...common,_id:'ra2-gate-'+O+'-p'+h,kind:'gate',rootId:'ra2-root-'+O,index:h,resourceClaimId:own[h+1]._id,direction:'acquire'});
 db.rows.RoomBookingClaimEvents=plain([...own.slice(0,j+1),foreign[0],foreign[1]]);const history=plain(db.rows.RoomBookingClaimEvents),capsule=M.manifestCanonical;
 db.keys=null;db.config=null;db.rows.GuestBookingFinancialRevisions=[];
 function restart(){const x=subject(db);x.state.now=db.rows.GuestBookingAcceptances[0].offerExpiresAtMs+1;x.context.clock=()=>{throw Error('clock forbidden');};x.state.secretHook=()=>{throw Error('key forbidden');};x.wix.insert=async(c,row,o)=>{assert.equal(c,'GuestBookingAcquisitionControls','NO physical/provider writes');x.state.trace.push({op:'insert',collection:c,id:row._id});if(!db.rows[c].some(r=>r._id===row._id))db.rows[c].push(plain(row));throw Error('lost ACK');};return x;}
 const seeded=plain(db.rows);
 let x=restart(),result=await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);
 assert.equal(result.status,'DECISION_PENDING');
 const direction=db.rows.GuestBookingAcquisitionControls.find(r=>r._id==='ra2-direction-'+A);
 assert.ok(direction,'E1 missing feature: actual persisted contention must create durable cart compensate');assert.equal(direction.direction,'compensate');assert.equal(direction.causeResourceClaimId,own[j+1]._id);assert.equal(direction.causeIndex,j);
 const skipped=db.rows.GuestBookingAcquisitionControls.find(r=>r._id==='ra2-start-'+T[5][1][0]);assert.equal(skipped.direction,'skip');
 const controls=plain(db.rows.GuestBookingAcquisitionControls);x=restart();result=await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);assert.equal(result.status,'DECISION_PENDING');assert.deepEqual(db.rows.GuestBookingAcquisitionControls,controls);assert.deepEqual(db.rows.RoomBookingClaimEvents,history);assert.equal(db.rows.GuestBookingAllocationManifests[0].manifestCanonical,capsule);assert.ok(x.state.trace.every(t=>!['Bookings','BookingSummary'].includes(t.collection)));
 // E9 scaled support-ceiling witness: actual A-only coordinator and real authority.
 // Only the private numeric ceiling is lowered in loaded source; no authority stub.
 // This proves cumulative enforcement, NOT reachability of 30000 under other budgets.
 if(j===0){
  db.rows=plain(seeded);const b=restart(),readFile=fs.readFileSync;
  let replacements=0;
  fs.readFileSync=function(file,...args){const data=readFile.call(this,file,...args);if(String(file).endsWith('guestBookingAcquisitionContentionEvidence.js')){const matches=data.match(/30000/g)||[];assert.ok(matches.length>0);replacements+=matches.length;return data.replace(/30000/g,'60');}return data;};
  let api;try{api=b.load('backend/guestBookingAcquisitionControl');}finally{fs.readFileSync=readFile;}
  assert.ok(replacements>0);const limited=await api.resumeGuestBookingAcquisitionControl(A);
  assert.equal(limited.status,'UNKNOWN','E9 shared exact-read budget survives repeated evidence/readbacks');
  const exactCalls=b.state.trace.filter(t=>t.op==='find'&&t.filter&&t.filter[2]!=='gt').length;
  assert.ok(exactCalls<=60,'E9 no exact transport call above cumulative ceiling: '+exactCalls);
  assert.equal(b.state.trace.some(t=>t.op==='insert'&&t.id==='ra2-start-'+T[5][1][0]),false,'E9 exhausted proof cannot insert skip');
  assert.deepEqual(db.rows.RoomBookingClaimEvents,seeded.RoomBookingClaimEvents);
  console.log('PASS E9 scaled cumulative ceiling actual exact calls='+exactCalls+'; 30000 reachability not claimed');
 }
 console.log('PASS E1 j='+j+' actual two accepted manifests -> fixture rc1 history -> persisted compensate/skip -> keyless lost-ACK restart; conditional writer invariant, NOT physical acquisition');
 const cases=[];
 async function probe(name,edit,expected,hook){
  db.rows=plain(seeded);edit(db.rows);const before=plain(db.rows.RoomBookingClaimEvents),x=restart();if(hook)hook(x);
  const r=await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);
  assert.equal(r.status,expected,name);assert.equal(x.state.trace.some(t=>t.op==='insert'&&t.id==='ra2-direction-'+A),false,name+' no direction');assert.equal(db.rows.GuestBookingAcquisitionControls.some(r=>r.direction==='skip'&&!seeded.GuestBookingAcquisitionControls.some(s=>s._id===r._id)),false,name+' no skip');
  assert.deepEqual(db.rows.RoomBookingClaimEvents,before,name+' resource immutable');assert.ok(x.state.trace.every(t=>t.op!=='insert'||t.collection==='GuestBookingAcquisitionControls'));cases.push(name);
 }
 for(const kind of ['group-start','root','gate']){
  await probe('E2 missing '+kind,rows=>{rows.GuestBookingAcquisitionControls=rows.GuestBookingAcquisitionControls.filter(r=>r.kind!==kind);},kind==='gate'&&j===0?'DECISION_PENDING':'UNKNOWN');
  await probe('E2 incompatible '+kind,rows=>{rows.GuestBookingAcquisitionControls.find(r=>r.kind===kind).manifestDigest='0'.repeat(64);},'INTEGRITY');
 }
 await probe('E2 missing identity',rows=>{rows.RoomBookingClaimEvents=rows.RoomBookingClaimEvents.filter(r=>r._id!==own[0]._id);},'UNKNOWN');
 for(const field of ['payloadDigest','bookingNumber','bookingRowId'])await probe('E2 same-O '+field,rows=>{rows.RoomBookingClaimEvents.find(r=>r._id===own[0]._id)[field]=field==='payloadDigest'?'0'.repeat(64):'wrong';},'INTEGRITY');
 await probe('E3 skip with root/identity',rows=>{rows.GuestBookingAcquisitionControls.find(r=>r.kind==='group-start').direction='skip';},'INTEGRITY');
 if(j>0)await probe('E3 seal with own',rows=>{rows.GuestBookingAcquisitionControls.find(r=>r.kind==='gate').direction='seal';},'INTEGRITY');
 await probe('E3 gate suffix after foreign',rows=>{rows.GuestBookingAcquisitionControls.push({...common,_id:'ra2-gate-'+O+'-p'+(j+1),kind:'gate',rootId:'ra2-root-'+O,index:j+1,resourceClaimId:own[j+2]._id,direction:'acquire'});},'INTEGRITY');
 for(const row of seeded.GuestBookingAcquisitionControls)await probe('E3 unreadable '+row._id,()=>{},'UNKNOWN',x=>{const query=x.wix.query;x.wix.query=c=>{const q=query(c),eq=q.eq,find=q.find;let id;q.eq=(k,v)=>{id=v;return eq(k,v);};q.find=async o=>{if(c==='GuestBookingAcquisitionControls'&&id===row._id)throw Error('unavailable');return find(o);};return q;};});
 for(const row of seeded.RoomBookingClaimEvents)await probe('E2 unreadable '+row._id,()=>{},'UNKNOWN',x=>{const query=x.wix.query;x.wix.query=c=>{const q=query(c),eq=q.eq,find=q.find;let id;q.eq=(k,v)=>{id=v;return eq(k,v);};q.find=async o=>{if(c==='RoomBookingClaimEvents'&&id===row._id)throw Error('unavailable');return find(o);};return q;};});
 for(const [field,value] of [['night','2027-01-09'],['generation',2],['capacitySlot',2],['claimType','unit'],['claimKey','wrong']])await probe('E2 fixed foreign '+field,rows=>{rows.RoomBookingClaimEvents.find(r=>r._id===foreign[1]._id)[field]=value;},'INTEGRITY');
 await probe('E10 contradictory commit winner',rows=>{rows.GuestBookingAcquisitionControls.push({_id:'ra2-direction-'+A,acquisitionProtocolVersion:2,kind:'cart-direction',admissionId:'ra2-cart-'+A,manifestDigest:M.manifestDigest,direction:'commit-rows',causeOperationId:null,causeIndex:null,causeResourceClaimId:null});},'INTEGRITY');
 assert.equal(cases.length,j===0?25:28);
 console.log('PASS finite subset (baseline-GREEN plus fixed-field classification RED/GREEN) j='+j+' '+JSON.stringify({count:cases.length,cases}));
 // Frozen closure assertions: baseline-GREEN unless execution identifies a causal RED.
 const closure=[];
 async function deny(name,edit,status='UNKNOWN',hook){await probe(name,edit,status,hook);closure.push(name);}
 async function positive(name,edit,hook){db.rows=plain(seeded);edit(db.rows);const before=plain(db.rows.RoomBookingClaimEvents),x=restart();if(hook)hook(x);const r=await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);assert.equal(r.status,'DECISION_PENDING',name);assert.deepEqual(db.rows.RoomBookingClaimEvents,before);assert.equal(db.rows.GuestBookingAllocationManifests[0].manifestCanonical,capsule);closure.push(name);return {x,r};}
 function resourceHook(transform){return x=>{const query=x.wix.query;x.wix.query=c=>{const q=query(c),find=q.find,eq=q.eq;let exact=false;q.eq=(k,v)=>{exact=true;return eq(k,v);};q.find=async o=>{const p=await find(o);return c==='RoomBookingClaimEvents'&&!exact?transform(p,x):p;};return q;};};}
 for(let h=0;h<j;h++){
  await deny('E2/E5 missing individual predecessor resource '+h,rows=>{rows.RoomBookingClaimEvents=rows.RoomBookingClaimEvents.filter(r=>r._id!==own[h+1]._id);});
  await deny('E2 missing individual predecessor gate '+h,rows=>{rows.GuestBookingAcquisitionControls=rows.GuestBookingAcquisitionControls.filter(r=>r._id!=='ra2-gate-'+O+'-p'+h);});
  await deny('E2 incompatible individual predecessor '+h,rows=>{rows.RoomBookingClaimEvents.find(r=>r._id===own[h+1]._id).bookingRowId='wrong';},'INTEGRITY');
  db.rows=plain(seeded);db.rows.RoomBookingClaimEvents=db.rows.RoomBookingClaimEvents.filter(r=>r._id!==own[h+1]._id);{const release=gate(),watchdog=setTimeout(()=>{console.error('E5 watchdog');process.exit(1);},15000);const delayed=(async()=>{await release.promise;db.rows.RoomBookingClaimEvents.push(plain(own[h+1]));throw Error('fixture materialization lost ACK');})().catch(e=>e.message);try{const before=restart();assert.equal((await before.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)).status,'UNKNOWN');assert.equal(before.state.trace.some(t=>t.op==='insert'&&t.id==='ra2-direction-'+A),false);release.release();assert.equal(await delayed,'fixture materialization lost ACK');const after=restart();assert.equal((await after.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)).status,'DECISION_PENDING');assert.deepEqual(db.rows.RoomBookingClaimEvents.slice().sort((a,b)=>a._id.localeCompare(b._id)),plain(seeded.RoomBookingClaimEvents).sort((a,b)=>a._id.localeCompare(b._id)));closure.push('E5 delayed predecessor before-apply and materialized lost-ACK '+h);}finally{clearTimeout(watchdog);}}
 }
 for(const field of ['admissionId','resourceClaimId','rootId','operationId','index'])await deny('E2 individual cause gate binding '+field,rows=>{const g=rows.GuestBookingAcquisitionControls.find(r=>r._id==='ra2-gate-'+O+'-p'+j);g[field]=field==='index'?j+1:field==='admissionId'?'ra2-cart-'+'0'.repeat(64):field==='resourceClaimId'?own[j+2]._id:field==='operationId'?accepted[1].T[5][0][0]:'ra2-root-'+accepted[1].T[5][0][0];},field==='admissionId'||field==='resourceClaimId'?'INTEGRITY':'UNKNOWN');
 for(const field of ['operationId','bookingRowId','payloadDigest','_id','unit'])await deny('E2 foreign binding '+field,rows=>{const r=rows.RoomBookingClaimEvents.find(r=>r._id===foreign[1]._id);r[field]=field==='unit'?2:field==='payloadDigest'?'0'.repeat(64):'wrong';},field==='unit'?'INTEGRITY':'UNKNOWN');
 await deny('E3 own suffix beyond fixed foreign',rows=>{rows.RoomBookingClaimEvents.push(plain(own[j+2]));});
 await deny('E3 out-of-plan local resource',rows=>{const r=plain(own[1]);r._id='rc1-20270109-s1-000001-a';r.night='2027-01-09';r.claimKey='capacity:2027-01-09:1';rows.RoomBookingClaimEvents.push(r);},'INTEGRITY');
 const other=T[6][1].acquisitions,otherO=other[0].operationId;
 function pendingOther(rows,acquire){const c={...common,operationId:otherO};rows.GuestBookingAcquisitionControls.push({...c,_id:'ra2-start-'+otherO,kind:'group-start',direction:'start'});if(acquire){rows.GuestBookingAcquisitionControls.push({...c,_id:'ra2-root-'+otherO,kind:'root',operationIdentityId:other[0]._id},{...c,_id:'ra2-gate-'+otherO+'-p0',kind:'gate',rootId:'ra2-root-'+otherO,index:0,resourceClaimId:other[1]._id,direction:'acquire'});rows.RoomBookingClaimEvents.push(plain(other[0]));}}
 for(const acquire of [false,true]){const out=await positive('E3 unrelated pending '+(acquire?'acquire':'start'),rows=>pendingOther(rows,acquire));assert.equal(out.r.groups.find(g=>g.operationId===otherO).direction,'start');}
 function terminalHistory(acquisitions,state){const op=acquisitions[0],count=acquisitions.length-1,c={_id:'rc1-op-'+op.operationId+'-c',protocolVersion:1,claimKey:'operation:'+op.operationId+':completion',generation:1,eventType:'complete',claimType:'operation-completion',operationId:op.operationId,bookingRowId:op.bookingRowId,bookingNumber:op.bookingNumber,payloadDigest:op.payloadDigest,completionState:state,confirmedResourceCount:count,decisionFenceVersion:1},d={_id:'rc1-op-'+op.operationId+'-d',protocolVersion:1,claimKey:'operation:'+op.operationId+':decision',generation:1,eventType:'decide',claimType:'operation-decision',operationId:op.operationId,bookingRowId:op.bookingRowId,bookingNumber:op.bookingNumber,payloadDigest:op.payloadDigest,decisionFenceVersion:1,operationIdentityId:op._id,operationCompletionId:c._id,manifestVersion:1,completionState:state,confirmedResourceCount:count,decisionState:'compensate'};return [...plain(acquisitions),c,d,...acquisitions.slice(1).reverse().map(r=>({...r,_id:r._id.slice(0,-1)+'r',eventType:'release',releaseReason:'fixture-compensate'}))];}
 for(const kind of ['completion','decision','release'])await deny('E3 incompatible local '+kind,rows=>{const h=terminalHistory(own.slice(0,j+1),'stopped');const r=h.find(r=>kind==='completion'?r.claimType==='operation-completion':kind==='decision'?r.claimType==='operation-decision':r.eventType==='release')||{...own[1],_id:own[1]._id.slice(0,-1)+'r',eventType:'release',releaseReason:'fixture'};if(kind==='completion')r.confirmedResourceCount++;rows.RoomBookingClaimEvents.push(r);});
 if(j===0){
  for(const state of ['stopped','complete']){
   const fh=terminalHistory(state==='complete'?foreign:foreign.slice(0,2),state);
   await positive('E4 retained foreign '+state+' reverse releases',rows=>{rows.RoomBookingClaimEvents=[plain(own[0]),...plain(fh)];});
   const next=plain(foreign.slice(0,2)),newO='finiteNextGeneration01';for(const r of next){r.operationId=newO;r.bookingRowId='pb1-'+newO+'-r1';r.bookingNumber='NEXT';r.payloadDigest='2'.repeat(64);if(r.claimType==='operation'){r._id='rc1-op-'+newO+'-a';r.claimKey='operation:'+newO;r.manifestBookingRowIds='pb1-'+newO+'-r1';r.manifestResourceClaimIds=r.manifestResourceClaimIds.replace(/000001/g,'000002');}else{r.generation=2;r._id=r._id.replace('000001','000002');}}
   // Complete predecessor release history; only first next-generation resource is materialized.
   await positive('E4 newer generation '+state,rows=>{rows.RoomBookingClaimEvents=[plain(own[0]),...plain(fh),...plain(next)];});
   const retained=plain(db.rows.RoomBookingClaimEvents);assert.equal(db.rows.GuestBookingAcquisitionControls.find(r=>r.kind==='cart-direction').causeResourceClaimId,foreign[1]._id);
   // Fixture immutable-ID arbitration, not a call to a physical writer.
   const stale=plain(own[1]);assert.ok(retained.some(r=>r._id===stale._id));const collided=retained.some(r=>r._id===stale._id);if(!collided)retained.push(stale);assert.equal(collided,true);assert.deepEqual(retained,db.rows.RoomBookingClaimEvents);closure.push('E5 stale old-ID collision '+state);
   for(const dep of ['release','operation','operation-completion','operation-decision'])await deny('E4 missing prior '+state+' '+dep,rows=>{rows.RoomBookingClaimEvents=[plain(own[0]),...plain(fh.filter(r=>dep==='release'?r._id!==foreign[1]._id.slice(0,-1)+'r':r.claimType!==dep)),...plain(next)];});
  }
  // Both actual helpers race immutable direction; alternate helper observes no first gate.
  for(const winnerIndex of [0,1]){
   db.rows=plain(seeded);pendingOther(db.rows,true);const fo=accepted[1].T[6][1].acquisitions;db.rows.RoomBookingClaimEvents.push(plain(fo[0]),plain(fo[1]));const before=plain(db.rows.RoomBookingClaimEvents),helpers=[restart(),restart()],entered=[gate(),gate()],release=[gate(),gate()];
   const q0=helpers[1].wix.query;helpers[1].wix.query=c=>{const q=q0(c),eq=q.eq,find=q.find;let id;q.eq=(k,v)=>{id=v;return eq(k,v);};q.find=async o=>id==='ra2-gate-'+O+'-p0'&&!db.rows.GuestBookingAcquisitionControls.some(r=>r.kind==='cart-direction')?{items:helpers[1].realm([]),hasNext(){return false;}}:find(o);return q;};
   for(let k=0;k<2;k++){const x=helpers[k],insert=x.wix.insert;x.wix.insert=async(c,row,o)=>{if(row.kind==='cart-direction'){assert.equal(row.causeOperationId,k?otherO:O);entered[k].release();await release[k].promise;}return insert(c,row,o);};}
   const watchdog=setTimeout(()=>{console.error('E6 watchdog');process.exit(1);},15000);try{const tasks=helpers.map(x=>x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A));await Promise.all(entered.map(g=>g.promise));release[winnerIndex].release();assert.equal((await tasks[winnerIndex]).status,'DECISION_PENDING');release[1-winnerIndex].release();assert.equal((await tasks[1-winnerIndex]).status,'DECISION_PENDING');assert.equal(db.rows.GuestBookingAcquisitionControls.filter(r=>r.kind==='cart-direction').length,1);assert.equal(db.rows.GuestBookingAcquisitionControls.find(r=>r.kind==='cart-direction').causeOperationId,winnerIndex?otherO:O);assert.deepEqual(db.rows.RoomBookingClaimEvents,before);closure.push('E6 actual two-helper race winner '+winnerIndex);}finally{clearTimeout(watchdog);}
  }
  for(const field of ['causeOperationId','causeIndex','causeResourceClaimId','manifestDigest'])await deny('E6 forged winner '+field,rows=>{const d=plain(direction);d[field]=field==='causeIndex'?own.length:field==='causeOperationId'?otherO:field==='causeResourceClaimId'?other[1]._id:'0'.repeat(64);rows.GuestBookingAcquisitionControls.push(d);},'INTEGRITY');
  await deny('E10 unsupported commit no verified cause',rows=>{rows.RoomBookingClaimEvents=[];rows.GuestBookingAcquisitionControls=rows.GuestBookingAcquisitionControls.filter(r=>r.kind==='admission');rows.GuestBookingAcquisitionControls.push({...plain(direction),direction:'commit-rows',causeOperationId:null,causeIndex:null,causeResourceClaimId:null});});
  for(const expr of ['-0','new Number(0)','NaN','Infinity','-1','0.5','Number.MAX_SAFE_INTEGER+1'])await deny('E10 realm cause index '+expr,rows=>{rows.GuestBookingAcquisitionControls.push(plain(direction));},'UNKNOWN',x=>{const query=x.wix.query;x.wix.query=c=>{const q=query(c),eq=q.eq,find=q.find;let id;q.eq=(k,v)=>{id=v;return eq(k,v);};q.find=async o=>{const p=await find(o);if(id==='ra2-direction-'+A){x.context.row=p.items[0];vm.runInContext('row.causeIndex='+expr,x.context);if(expr==='-0')assert.equal(Object.is(p.items[0].causeIndex,-0),true);}return p;};return q;};});
  for(const mode of ['intrinsic','then','reflection','metadata','method-drift'])await deny('E10 awaited hostile '+mode,()=>{},'UNKNOWN',resourceHook((p,x)=>{x.context.row=p.items[0];if(mode==='intrinsic')vm.runInContext('Array.prototype.map=function(){return [];}',x.context);if(mode==='then')vm.runInContext('Object.prototype.then=function(resolve){resolve({status:"FORGED"});}',x.context);if(mode==='reflection')p.items[0]=vm.runInContext('new Proxy(row,{ownKeys(){throw Error("hostile reflection");}})',x.context);if(mode==='metadata')vm.runInContext('row._owner="x".repeat(257)',x.context);if(mode==='method-drift'){const original=p.hasNext;p.hasNext=function(){p.hasNext=()=>false;return original();};}return p;}));
  db.rows=plain(seeded);{const x=restart();resourceHook((p,x)=>{x.wix.query=()=>{throw Error('replaced query must not execute');};return p;})(x);assert.equal((await x.load('backend/guestBookingAcquisitionContentionEvidence').readGuestBookingAcquisitionContentionEvidence(A)).status,'EVIDENCED');closure.push('E10 captured reader SDK query stable');}
  await positive('E9 valid native SDK metadata',()=>{},resourceHook((p,x)=>{x.context.row=p.items[0];vm.runInContext('row._createdDate=new Date(1700000000000);row._updatedDate=new Date(1700000000001);row._owner="fixture";',x.context);return p;}));
  // Real two-page keyset schedule: owner is appended behind the first page cursor.
  db.rows=plain(seeded);db.rows.RoomBookingClaimEvents=db.rows.RoomBookingClaimEvents.filter(r=>r._id!==foreign[0]._id);for(let k=0;k<101;k++){const r=plain(foreign[0]),f='zzFiniteFillerOperation'+String(k).padStart(3,'0');r.operationId=f;r._id='rc1-op-'+f+'-a';r.claimKey='operation:'+f;r.bookingRowId='pb1-'+f+'-r1';r.manifestBookingRowIds=r.bookingRowId;db.rows.RoomBookingClaimEvents.push(r);}
  {const x=restart();let pages=0;resourceHook((p,x)=>{pages++;if(pages===1){assert.equal(p.items.length,100);assert.ok(p.items[p.items.length-1]._id>foreign[0]._id);db.rows.RoomBookingClaimEvents.push(plain(foreign[0]));}return p;})(x);assert.equal((await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)).status,'UNKNOWN');assert.equal(pages,2);assert.equal(x.state.trace.some(t=>t.op==='insert'&&t.id==='ra2-direction-'+A),false);closure.push('E9 actual append behind cursor missing owner');const retry=restart();assert.equal((await retry.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)).status,'DECISION_PENDING');closure.push('E9 fresh two-page invocation recovers appended support');}
  for(const moreAtLimit of [false,true]){db.rows=plain(seeded);const x=restart();let pages=0;resourceHook((p,x)=>{const n=pages++;return {items:x.realm(Array.from({length:100},(_,k)=>({_id:'transport'+String(n*100+k).padStart(5,'0')}))),hasNext(){return pages<100||moreAtLimit;}};})(x);const r=await x.load('backend/guestBookingAcquisitionContentionEvidence').readGuestBookingAcquisitionContentionEvidence(A);assert.equal(pages,100);assert.equal(r.status,'UNKNOWN');assert.equal(r.reason,moreAtLimit?'UNSUPPORTED_EVIDENCE':'EVIDENCE');closure.push('E9 transport page100 row10000 more='+moreAtLimit);}
  // Earlier full-manifest envelope dominates the unscaled exact ceiling.
  // Deliberately UNDERSIZED legal resource fields: actual claimKey/bookingNumber are longer.
  const lower={_id:'rc1-20270101-u1-000001-a',protocolVersion:1,claimKey:'x',generation:1,eventType:'acquire',claimType:'unit',operationId:'x'.repeat(49),bookingRowId:'x'.repeat(56),bookingNumber:'x',payloadDigest:'x'.repeat(64),night:'2027-01-01',unit:1};
  const minBytes=Buffer.byteLength(JSON.stringify(lower)),maxResources=Math.floor(400000/minBytes),maxGroups=3,maxProofs=2+2*maxGroups,maxExact=3+1+maxGroups+maxProofs*(4+6*maxGroups+3*maxResources);assert.equal(minBytes,398);assert.ok(maxExact<30000);console.log('PASS E9 domination '+JSON.stringify({minBytes,maxResources,maxGroups,maxProofs,maxExact}));
  for(const buffer of ['resource','subordinate'])for(const delta of [0,-1]){
   db.rows=plain(seeded);const x=restart(),rules=x.load('backend/guestBookingAcquisitionControlRules');const limit=buffer==='resource'?Buffer.byteLength(JSON.stringify(seeded.RoomBookingClaimEvents)):seeded.GuestBookingAcquisitionControls.filter(r=>r.kind!=='admission').reduce((n,r)=>n+Buffer.byteLength(rules.canonicalGuestBookingAcquisitionControl(x.realm(r))),0);
   const readFile=fs.readFileSync,target=buffer==='resource'?"bytes(JSON.stringify(value))>400000":"controlBytes>400000";let replaced=0;fs.readFileSync=function(file,...args){const src=readFile.call(this,file,...args);if(!String(file).endsWith('guestBookingAcquisitionContentionEvidence.js'))return src;assert.equal(src.split(target).length,2);replaced++;return src.replace(target,target.replace('400000',String(limit+delta)));};let api;try{api=x.load('backend/guestBookingAcquisitionContentionEvidence');}finally{fs.readFileSync=readFile;}assert.equal(replaced,1);const r=await api.readGuestBookingAcquisitionContentionEvidence(A);assert.equal(r.status,delta===0?'EVIDENCED':'UNKNOWN',buffer+' scaled byte neighbor');if(delta<0)assert.equal(r.reason,'UNSUPPORTED_EVIDENCE');assert.equal(x.state.trace.some(t=>t.op==='insert'),false);closure.push('E9 scaled '+buffer+' byte neighbor '+delta);
  }
 }
 assert.equal(closure.length,j===0?60:21);console.log('PASS frozen closure j='+j+' '+JSON.stringify({count:closure.length,cases:closure}));
 const moreCases=[];
 const expectedKeys=[['GuestBookingAcquisitionControls','ra2-direction-'+A]];
 for(const plan of T[6]){const O=plan.acquisitions[0].operationId,R=plan.acquisitions.slice(1);for(const id of ['ra2-start-'+O,'ra2-root-'+O,...R.map((r,k)=>'ra2-gate-'+O+'-p'+k)])expectedKeys.push(['GuestBookingAcquisitionControls',id]);for(const id of [plan.acquisitions[0]._id,...R.flatMap(r=>[r._id,r._id.slice(0,-1)+'r']),'rc1-op-'+O+'-c','rc1-op-'+O+'-d'])expectedKeys.push(['RoomBookingClaimEvents',id]);}
 for(const [collection,id] of expectedKeys){await probe('E3 every expected unreadable '+collection+'/'+id,()=>{},'UNKNOWN',x=>{const query=x.wix.query;x.wix.query=c=>{const q=query(c),eq=q.eq,find=q.find;let key;q.eq=(k,v)=>{key=v;return eq(k,v);};q.find=async o=>{if(c===collection&&key===id)throw Error('expected read unavailable');return find(o);};return q;};});moreCases.push('E3 unreadable '+collection+'/'+id);}
 for(const mode of ['duplicate','descending','extra-field','nonboolean-more','partial-more','items-accessor','row-accessor','invalid-date','boxed-generation','negative-zero']){
  await probe('E9 resource page '+mode,()=>{},'UNKNOWN',x=>{const query=x.wix.query;x.wix.query=c=>{const q=query(c),eq=q.eq,find=q.find;let exact=false;q.eq=(k,v)=>{exact=true;return eq(k,v);};q.find=async o=>{const p=await find(o);if(c!=='RoomBookingClaimEvents'||exact)return p;x.context.items=p.items;const expr=mode==='duplicate'?'items.push(items[0]);':mode==='descending'?'items.reverse();':mode==='extra-field'?'items[0].extra=true;':mode==='invalid-date'?'items[0]._createdDate=new Date(NaN);':mode==='boxed-generation'?'items[0].generation=new Number(1);':mode==='negative-zero'?'items[0].generation=-0;':mode==='row-accessor'?"Object.defineProperty(items[0],'_id',{enumerable:true,get(){throw Error('accessor forbidden');}});":'';vm.runInContext(expr,x.context);if(mode==='items-accessor')return Object.defineProperty({},'items',{enumerable:true,get(){throw Error('accessor forbidden');}});return {items:p.items,hasNext(){return mode==='nonboolean-more'?1:mode==='partial-more';}};};return q;};});moreCases.push('E9 '+mode);
 }
 assert.equal(moreCases.length,expectedKeys.length+10);console.log('PASS remaining-matrix baseline-GREEN subset j='+j+' '+JSON.stringify({count:moreCases.length,cases:moreCases}));
 if(j===0){
 const timer=setTimeout(()=>{console.error('E7/E8 watchdog');process.exit(1);},30000),schedules=[];
 try{
 for(const kind of ['cart-direction','skip'])for(const phase of ['before-apply','after-apply-before-ack','after-ack-before-read'])for(const mode of ['absent','unreadable','incomplete','found']){
  if(phase==='before-apply'&&mode==='found')continue;
  db.rows=plain(seeded);const x=restart(),target=kind==='cart-direction'?'ra2-direction-'+A:'ra2-start-'+T[5][1][0],entered=gate(),release=gate();let attempted=false;
  const query=x.wix.query;
  x.wix.insert=async(c,row,o)=>{assert.equal(c,'GuestBookingAcquisitionControls');x.state.trace.push({op:'insert',collection:c,id:row._id,direction:row.direction});if(row._id===target){attempted=true;if(phase==='before-apply'){entered.release();await release.promise;throw Error('not applied');}}
   if(!db.rows[c].some(r=>r._id===row._id))db.rows[c].push(plain(row));if(row._id===target&&phase==='after-apply-before-ack'){entered.release();await release.promise;throw Error('lost ACK');}return x.realm(row);};
  x.wix.query=c=>{const q=query(c),eq=q.eq,find=q.find;let id;q.eq=(k,v)=>{id=v;return eq(k,v);};q.find=async o=>{if(c!=='GuestBookingAcquisitionControls'||id!==target||!attempted)return find(o);if(phase==='after-ack-before-read'){entered.release();await release.promise;}if(mode==='unreadable')throw Error('unavailable');if(mode==='absent')return {items:x.realm([]),hasNext(){return false;}};const p=await find(o);return mode==='incomplete'?{items:p.items,hasNext(){return true;}}:p;};return q;};
  const task=x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);await entered.promise;assert.equal(db.rows.GuestBookingAcquisitionControls.some(r=>r._id===target),phase!=='before-apply');release.release();const result=await task;assert.equal(result.status,mode==='found'?'DECISION_PENDING':'UNKNOWN');
  if(kind==='cart-direction'&&mode!=='found')assert.equal(x.state.trace.some(t=>t.op==='insert'&&t.direction==='skip'),false);
  const again=restart();assert.equal((await again.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)).status,'DECISION_PENDING');assert.equal(db.rows.GuestBookingAcquisitionControls.find(r=>r._id==='ra2-start-'+T[5][1][0]).direction,'skip');assert.deepEqual(db.rows.RoomBookingClaimEvents,seeded.RoomBookingClaimEvents);schedules.push({id:'E7',kind,phase,mode});
 }
 for(const winnerOrder of ['skip-first','start-first'])for(const lostAck of [false,true]){
  db.rows=plain(seeded);db.rows.RoomBookingClaimEvents=[];db.rows.GuestBookingAcquisitionControls=db.rows.GuestBookingAcquisitionControls.filter(r=>r.kind==='admission');
  const older=restart(),target='ra2-start-'+T[5][1][0],entered=gate(),release=gate();
  older.wix.insert=async(c,row,o)=>{assert.equal(c,'GuestBookingAcquisitionControls');older.state.trace.push({op:'insert',collection:c,id:row._id});if(row._id===target&&winnerOrder==='skip-first'){entered.release();await release.promise;}if(!db.rows[c].some(r=>r._id===row._id))db.rows[c].push(plain(row));if(row._id===target&&winnerOrder==='start-first'){entered.release();await release.promise;}if(lostAck)throw Error('lost ACK');return older.realm(row);};
  const pending=older.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);await entered.promise;
  for(const row of seeded.GuestBookingAcquisitionControls)if(!db.rows.GuestBookingAcquisitionControls.some(r=>r._id===row._id))db.rows.GuestBookingAcquisitionControls.push(plain(row));db.rows.RoomBookingClaimEvents=plain(seeded.RoomBookingClaimEvents);
  const helpers=await Promise.all([restart(),restart()].map(x=>x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)));assert.ok(helpers.every(r=>r.status==='DECISION_PENDING'));release.release();const r=await pending;assert.equal(r.status,'DECISION_PENDING');assert.equal(r.groups.find(g=>g.operationId===T[5][1][0]).direction,winnerOrder==='skip-first'?'skip':'start');assert.equal(db.rows.GuestBookingAcquisitionControls.filter(r=>r._id===target).length,1);assert.deepEqual(db.rows.RoomBookingClaimEvents,seeded.RoomBookingClaimEvents);assert.equal(db.rows.GuestBookingAcquisitionControls.some(r=>r.kind==='root'&&r.operationId===T[5][1][0]),false);schedules.push({id:'E8',winnerOrder,lostAck});
 }
 assert.equal(schedules.filter(r=>r.id==='E7').length,22);assert.equal(schedules.filter(r=>r.id==='E8').length,4);console.log('PASS permanent baseline-GREEN E7/E8 '+JSON.stringify({count:schedules.length,cases:schedules}));
 }finally{clearTimeout(timer);}
 }
 }})();
 const s=subject();configureRevision(s.state.db,{...revision,penthouseRoomFee:0.25});
 const p=input();p.note='Original primary only';p.priceGroups=[{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:2,guests:2}];
 const offer=await prepared(s,p);assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule)).status,'ACCEPTED_PENDING');
 const db=s.state.db,A=db.rows.GuestBookingAcceptances[0]._id;
 for(const c of ['GuestBookingAllocationManifests','GuestBookingAcquisitionControls','RoomBookingClaimEvents','Bookings','BookingSummary'])db.rows[c]=[];
 assert.equal((await s.load('backend/guestBookingAllocationHandoff').handoffGuestBookingAllocation(A)).status,'ALLOCATION_HANDOFF_PENDING');
 const source=plain(db.rows),M=source.GuestBookingAllocationManifests[0],T=JSON.parse(M.manifestCanonical);
 function fresh(){
  const x=subject(db);x.state.now=offer.offerExpiresAtMs+1;x.context.clock=()=>{throw Error('clock forbidden');};x.state.secretHook=()=>{throw Error('keys forbidden');};
  // Fixture acceptance store additionally arbitrates bookingNumber. Controls have no such index.
  x.wix.insert=async(c,row,options)=>{assert.equal(c,'GuestBookingAcquisitionControls','zero physical/other writes');x.state.trace.push({op:'insert',collection:c,id:row._id,options});const copy=plain(row);if(x.state.noApply)throw Error('before apply timeout');if(!db.rows[c].some(r=>r._id===copy._id))db.rows[c].push(copy);if(x.state.loseAck)throw Error('lost ACK');return x.realm(copy);};
  return x;
 }
 db.keys=null;db.config=null;db.rows.GuestBookingFinancialRevisions=[];
 assert.ok(fs.existsSync(path.join(root,'velo/backend/guestBookingAcquisitionControl.js')),'missing feature: durable start survives lost acknowledgment and erased-module restart');
 let x=fresh();x.state.loseAck=true;
 const first=await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);
 assert.equal(first.status,'DECISION_PENDING');assert.deepEqual(plain(first.groups),T[5].map(b=>({operationId:b[0],direction:'start'})));
 const anchor=db.rows.GuestBookingAcquisitionControls.find(r=>r.kind==='admission');assert.equal(anchor.manifestCanonical,M.manifestCanonical);assert.equal(JSON.parse(anchor.manifestCanonical)[3][6],offer.capsule);
 const durableControls=plain(db.rows.GuestBookingAcquisitionControls);
 x=fresh();const restarted=await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);assert.deepEqual(plain(restarted),plain(first));assert.deepEqual(db.rows.GuestBookingAcquisitionControls,durableControls);
 for(const c of ['RoomBookingClaimEvents','Bookings','BookingSummary'])assert.deepEqual(db.rows[c],source[c]);
 assert.ok(x.state.trace.every(t=>['GuestBookingAcceptances','GuestBookingAllocationManifests','GuestBookingAcquisitionControls','RoomBookingClaimEvents'].includes(t.collection)));
 console.log('PASS C1 real issuer -> full manifest anchor -> start lost ACK -> keyless erased restart; no root/identity/effects');
 // Baseline-GREEN negative/compatibility additions; no invented causal REDs.
 const saved=plain(db.rows);
 function restore(){db.rows=plain(saved);}
 function inserts(x){return x.state.trace.filter(t=>t.op==='insert');}
 for(const hint of ['',A.toUpperCase(),' '+A,{},null]){x=fresh();assert.equal((await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(hint)).status,'INTEGRITY');assert.equal(x.state.trace.length,0);}
 for(const collection of ['GuestBookingAcceptances','GuestBookingAllocationManifests']){restore();db.rows[collection]=[];x=fresh();assert.equal((await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)).status,'UNKNOWN');assert.equal(inserts(x).length,0);}
 restore();db.rows.GuestBookingAcquisitionControls=[];x=fresh();x.state.noApply=true;assert.equal((await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)).status,'UNKNOWN');assert.equal(inserts(x).length,1);assert.equal(db.rows.GuestBookingAcquisitionControls.length,0);
 restore();db.rows.GuestBookingAcquisitionControls=[];x=fresh();const query=x.wix.query;x.wix.query=c=>{const q=query(c),find=q.find;q.find=async o=>{if(c==='GuestBookingAcquisitionControls')throw Error('unknown');return find(o);};return q;};assert.equal((await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)).status,'UNKNOWN');assert.equal(inserts(x).length,1);assert.equal(db.rows.GuestBookingAcquisitionControls.length,1);
 // Full anchor independently rejects a different individually valid root AND manifest.
 restore();const changed=db.rows.GuestBookingAcceptances[0];changed.validatedAtMs++;
 const body={};for(const k of ['schemaVersion','validityPolicy','_id','operationId','audience','bookingNumber','capsule','intentDigest','quoteDigest','issuedAtMs','offerExpiresAtMs','credentialKid','validatedAtMs'])body[k]=changed[k];changed.rootDigest=hash('wbe.acceptance-root.v2',JSON.stringify(body));
 x=fresh();const valid=x.load('backend/guestBookingAcceptance').validateGuestBookingAcceptanceRoot(x.realm(changed));assert.notEqual(valid,'DENIED');
 db.rows.GuestBookingAllocationManifests=[];const planner=subject(db);assert.equal((await planner.load('backend/guestBookingAllocationHandoff').handoffGuestBookingAllocation(A)).status,'ALLOCATION_HANDOFF_PENDING');const replacement=db.rows.GuestBookingAllocationManifests[0];assert.equal(x.load('backend/guestBookingAllocationManifestRules').validateGuestBookingAllocationManifest(x.realm(replacement),valid),true);
 assert.equal((await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)).status,'INTEGRITY');assert.equal(inserts(x).length,1);assert.equal(inserts(x)[0].id,'ra2-cart-'+A);
 for(const [key,value]of [['manifestDigest','0'.repeat(64)],['manifestCanonical',M.manifestCanonical+' '],['extra',true]]){restore();db.rows.GuestBookingAllocationManifests[0][key]=value;x=fresh();assert.equal((await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)).status,key==='extra'?'UNKNOWN':'INTEGRITY');assert.equal(inserts(x).length,0);}
 for(const [key,value]of [['admissionId','ra2-cart-'+'0'.repeat(64)],['manifestDigest','0'.repeat(64)],['direction','skip'],['extra',true]]){restore();db.rows.GuestBookingAcquisitionControls.find(r=>r.kind==='group-start')[key]=value;x=fresh();const r=await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);assert.ok(['INTEGRITY','UNKNOWN'].includes(r.status));assert.equal(inserts(x).length,1);}
 restore();x=fresh();const rules=x.load('backend/guestBookingAcquisitionControlRules');
 assert.equal(rules.canonicalGuestBookingAcquisitionControl(x.realm(anchor)),JSON.stringify(['wbe.accepted-acquisition-control',2,'admission',['ra2-cart-'+A,2,'admission',A,M._id,M.manifestDigest,M.manifestCanonical]]));
 x.context.control=x.realm(anchor);x.context.calls=0;
 for(const expr of ["({...control,extra:true})","({...control,acquisitionProtocolVersion:3})","Object.assign(Object.create({inherited:true}),control)","Object.defineProperty({...control},'manifestDigest',{get(){calls++;return control.manifestDigest;},enumerable:true})","({...control,_createdDate:new Date(NaN)})","({...control,_createdDate:Object.assign(new Date(1),{hook:1})})","({...control,_owner:'x'.repeat(257)})"]){const row=vm.runInContext(expr,x.context);assert.throws(()=>rules.decodeGuestBookingAcquisitionControl(row,true),undefined,expr);}
 assert.equal(x.context.calls,0);const metadata=vm.runInContext('({...control,_createdDate:new Date(1700000000000),_owner:"fixture"})',x.context);assert.equal(rules.canonicalGuestBookingAcquisitionControl(rules.decodeGuestBookingAcquisitionControl(metadata,true)),rules.canonicalGuestBookingAcquisitionControl(x.realm(anchor)));assert.throws(()=>rules.decodeGuestBookingAcquisitionControl(metadata));
 restore();console.log('PASS bounded invalid hints/source/binding/UNKNOWN/canonical/metadata controls; C8 changed valid qualification+manifest denied against full anchor');
 // Baseline-GREEN promotion of the finite actual-module review probes: C1/C8 only.
 // The independent fixture keeps the original multi-group assertions above unchanged.
 // Full serialized anchor storage limits remain a runtime gate; manifest length is not item proof.
 const coverageTimer=setTimeout(()=>{console.error('C1/C8 coverage schedule timed out');process.exit(1);},30000);
 try {
 await (async()=>{
const results=[];
const s=subject(),offer=await prepared(s);assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule)).status,'ACCEPTED_PENDING');
const db=s.state.db,A=db.rows.GuestBookingAcceptances[0]._id;
for(const c of ['GuestBookingAllocationManifests','GuestBookingAcquisitionControls','RoomBookingClaimEvents','Bookings','BookingSummary'])db.rows[c]=[];
assert.equal((await s.load('backend/guestBookingAllocationHandoff').handoffGuestBookingAllocation(A)).status,'ALLOCATION_HANDOFF_PENDING');
const M=plain(db.rows.GuestBookingAllocationManifests[0]),accepted=plain(db.rows.GuestBookingAcceptances[0]);
db.keys=null;db.config=null;db.rows.GuestBookingFinancialRevisions=[];
function fresh(){const x=subject(db);x.state.now=offer.offerExpiresAtMs+1;x.context.clock=()=>{throw Error('clock forbidden');};x.state.secretHook=()=>{throw Error('keys forbidden');};x.wix.insert=async(c,row,o)=>{assert.equal(c,'GuestBookingAcquisitionControls');x.state.trace.push({op:'insert',collection:c,id:row._id});if(!db.rows[c].some(r=>r._id===row._id))db.rows[c].push(plain(row));return x.realm(row);};return x;}
let x=fresh();assert.equal((await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A)).status,'DECISION_PENDING');
const saved=plain(db.rows),anchor=saved.GuestBookingAcquisitionControls.find(r=>r.kind==='admission'),start=saved.GuestBookingAcquisitionControls.find(r=>r.kind==='group-start');
function restore(){db.rows=plain(saved);}
for(const kind of ['admission','group-start'])for(const phase of ['before-apply','after-apply-before-ack','after-ack-before-read'])for(const mode of ['absent','unreadable','incomplete','found']){
 if(phase==='before-apply'&&mode==='found')continue;
 restore();db.rows.GuestBookingAcquisitionControls=kind==='admission'?[]:[plain(anchor)];
 x=fresh();const target=kind==='admission'?anchor._id:start._id,entered=gate(),release=gate();let pauseSeen=false;
 const insert=x.wix.insert,query=x.wix.query;
 x.wix.insert=async(c,row,o)=>{if(row._id!==target)return insert(c,row,o);if(phase==='before-apply'){x.state.trace.push({op:'insert',collection:c,id:row._id});pauseSeen=true;entered.release();await release.promise;throw Error('before apply interrupted');}const r=await insert(c,row,o);if(phase==='after-apply-before-ack'){pauseSeen=true;entered.release();await release.promise;throw Error('lost acknowledgment');}return r;};
 x.wix.query=c=>{const q=query(c),eq=q.eq,find=q.find;let id;q.eq=(k,v)=>{id=v;return eq(k,v);};q.find=async o=>{if(c!=='GuestBookingAcquisitionControls'||id!==target||!x.state.trace.some(t=>t.op==='insert'&&t.id===target))return find(o);if(phase==='after-ack-before-read'){pauseSeen=true;entered.release();await release.promise;}if(mode==='unreadable')throw Error('read unavailable');if(mode==='absent')return {items:x.realm([]),hasNext(){return false;}};const p=await find(o);if(mode==='incomplete')return {items:p.items,hasNext(){return true;}};return p;};return q;};
 const task=x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);await entered.promise;assert.equal(pauseSeen,true);assert.equal(db.rows.GuestBookingAcquisitionControls.some(r=>r._id===target),phase!=='before-apply');
 assert.equal(x.state.trace.filter(t=>t.op==='insert').length,kind==='admission'?1:2);release.release();const r=await task;assert.equal(r.status,mode==='found'?'DECISION_PENDING':'UNKNOWN');if(mode!=='found')assert.equal(x.state.trace.filter(t=>t.op==='insert').length,kind==='admission'?1:2);
 const restart=fresh(),recovered=await restart.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);assert.equal(recovered.status,'DECISION_PENDING');assert.deepEqual(db.rows.GuestBookingAcquisitionControls,saved.GuestBookingAcquisitionControls);for(const c of ['RoomBookingClaimEvents','Bookings','BookingSummary'])assert.deepEqual(db.rows[c],saved[c]);results.push({case:'C1',kind,phase,read:mode,status:r.status,restart:recovered.status});
}
// A fresh helper completes while the older invocation is still paused.
for(const kind of ['admission','group-start'])for(const phase of ['before-apply','after-apply-before-ack','after-ack-before-read']){
 restore();db.rows.GuestBookingAcquisitionControls=kind==='admission'?[]:[plain(anchor)];const older=fresh(),target=kind==='admission'?anchor._id:start._id,entered=gate(),release=gate();const insert=older.wix.insert,query=older.wix.query;
 older.wix.insert=async(c,row,o)=>{if(row._id!==target)return insert(c,row,o);if(phase==='before-apply'){entered.release();await release.promise;return insert(c,row,o);}const v=await insert(c,row,o);if(phase==='after-apply-before-ack'){entered.release();await release.promise;throw Error('lost ACK');}return v;};
 older.wix.query=c=>{const q=query(c),eq=q.eq,find=q.find;let id;q.eq=(k,v)=>{id=v;return eq(k,v);};q.find=async o=>{if(c==='GuestBookingAcquisitionControls'&&id===target&&phase==='after-ack-before-read'&&older.state.trace.some(t=>t.op==='insert'&&t.id===target)){entered.release();await release.promise;}return find(o);};return q;};
 const pending=older.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);await entered.promise;const helper=fresh();const winner=await helper.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);assert.equal(winner.status,'DECISION_PENDING');assert.deepEqual(db.rows.GuestBookingAcquisitionControls,saved.GuestBookingAcquisitionControls);release.release();assert.equal((await pending).status,'DECISION_PENDING');assert.deepEqual(db.rows.GuestBookingAcquisitionControls,saved.GuestBookingAcquisitionControls);results.push({case:'C1-concurrent-restart',kind,phase,status:winner.status,duplicateRecords:0});
}
// Real alternate physical allocation for identical accepted root. No synthetic authority flags.
restore();x=fresh();const rootValid=x.load('backend/guestBookingAcceptance').validateGuestBookingAcceptanceRoot(x.realm(accepted));assert.notEqual(rootValid,'DENIED');const rules=x.load('backend/guestBookingAllocationManifestRules'),binding=rules.buildGuestBookingAllocationBinding(rootValid);
const snapshot={occupiedUnits:[3],occupiedUnitsByNight:{'2027-01-01':[3],'2027-01-02':[3]},migrationIssueRows:[],duplicateUnitClaims:[],unknownStatusRows:[]};
const emptySnapshot={...snapshot,occupiedUnits:[],occupiedUnitsByNight:{'2027-01-01':[],'2027-01-02':[]}};
const foreign=x.load('backend/roomBookingCommitRules').buildPhysicalCommitPlan(x.realm(emptySnapshot),x.realm([]),x.realm({operationId:'reviewforeignoperation01',bookingNumber:'REVIEW-FIXTURE',payloadDigest:'1'.repeat(64),checkIn:'2027-01-01',checkOut:'2027-01-03',roomCode:'adventure_suite',quantity:1}));
const ledger=plain(foreign.acquisitions).sort((a,b)=>a._id<b._id?-1:a._id>b._id?1:0),metadata=ledger.map(r=>[r._id,null,null,null]);
const allocation=x.load('backend/wholeCartPlanningRules').buildWholeCartAllocation(x.realm({inventorySnapshot:snapshot,claimLedger:ledger,groupRequests:plain(binding.groupRequests),primaryOperationId:binding.primaryOperationId}));
const alternative=rules.buildGuestBookingAllocationManifest(rootValid,allocation,x.realm([1,snapshot,ledger,metadata]));assert.equal(rules.validateGuestBookingAllocationManifest(alternative,rootValid),true);assert.equal(alternative._id,M._id);assert.notEqual(alternative.manifestCanonical,M.manifestCanonical);assert.notDeepEqual(JSON.parse(alternative.manifestCanonical)[6],JSON.parse(M.manifestCanonical)[6]);
db.rows.GuestBookingAllocationManifests=[plain(alternative)];assert.deepEqual(db.rows.GuestBookingAcceptances,[accepted]);x=fresh();let r=await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);assert.equal(r.status,'INTEGRITY');assert.deepEqual(x.state.trace.filter(t=>t.op==='insert').map(t=>t.id),[anchor._id]);assert.deepEqual(db.rows.GuestBookingAcquisitionControls,saved.GuestBookingAcquisitionControls);results.push({case:'C8',variant:'same-root-valid-alternate-physical-plan',status:r.status,subordinateWrites:0});
restore();db.rows.GuestBookingAllocationManifests=[{...plain(alternative),manifestDigest:M.manifestDigest}];x=fresh();r=await x.load('backend/guestBookingAcquisitionControl').resumeGuestBookingAcquisitionControl(A);assert.equal(r.status,'INTEGRITY');assert.equal(x.state.trace.filter(t=>t.op==='insert').length,0);assert.deepEqual(db.rows.GuestBookingAcquisitionControls,saved.GuestBookingAcquisitionControls);results.push({case:'C8',variant:'alternate-content-stale-digest',status:r.status,writes:0});
 assert.equal(results.filter(r=>r.case==='C1').length,22);
 assert.equal(results.filter(r=>r.case==='C1-concurrent-restart').length,6);
 assert.equal(results.filter(r=>r.case==='C8').length,2);
 assert.equal(results.length,30);
 restore();
 console.log('PASS permanent C1/C8 baseline-GREEN coverage '+JSON.stringify({pauseRead:22,concurrentRestart:6,sameRootAlternate:1,staleDigest:1,total:results.length,cases:results}));
 })();
 } finally { clearTimeout(coverageTimer); }
})().catch(e=>{console.error(e);process.exitCode=1;});`,vm.createContext({require,Buffer,console,process,__dirname,setTimeout,clearTimeout}));
