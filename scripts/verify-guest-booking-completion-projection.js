'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const candidate='velo/backend/guestBookingCompletionProjection.js';
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const clone=x=>JSON.parse(JSON.stringify(x));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const ad=(d,s)=>hash(d+'\0'+s);
const digest=(d,x)=>hash(d+'\n'+JSON.stringify(x));
async function main(){
  const groupsURL=url(read('velo/backend/guestBookingPriceGroups.js'));
  const financialURL=url(read('velo/backend/guestBookingFinancialCalculation.js').replace("'backend/guestBookingPriceGroups'",JSON.stringify(groupsURL)));
  const {calculateGuestBookingFinancials:calc}=await import(financialURL);
  const source=read(candidate), loaded=source.replace("'backend/guestBookingFinancialCalculation'",JSON.stringify(financialURL));
  const {projectGuestBookingCompletion:projectText}=await import(url(loaded));
  const project=f=>projectText(JSON.stringify(f));
  const pass=[];
  const done=id=>{assert.ok(!pass.includes(id));pass.push(id);console.log('PASS '+id);};
  const golden=JSON.parse(read('scripts/fixtures/allocation-identity-golden.json'));
  const tuple=JSON.parse(golden.manifestCanonical);
  const native={v:2,acceptanceRoot:golden.accepted,allocationManifest:{_id:tuple[2],schemaVersion:1,manifestCanonical:golden.manifestCanonical,manifestDigest:golden.manifestDigest}};
  const result=project(native);
  assert.equal(result.kind,'PARTIAL_PROJECTION_PROPOSAL','NM01 exact saved native envelope must project');
  assert.deepEqual(result.plannedBookingRows[0],{...tuple[6][0].bookingRows[0],originalGroupIndex:0,ordinal:0,guests:2,note:tuple[5][0][5][0]});
  assert.equal(result.plannedBookingRows[0].assignedRoom,3);
  assert.equal(native.acceptanceRoot._id,'c58f1d1ac9708ccde2b5397e706412802905bc3c224c0bc350cd04a738e2fa2f');
  done('NM01');
  const editManifest=(f,fn)=>{const t=JSON.parse(f.allocationManifest.manifestCanonical);fn(t);f.allocationManifest.manifestCanonical=JSON.stringify(t);f.allocationManifest.manifestDigest=hash(f.allocationManifest.manifestCanonical);};
  const reject=(fn,base=native)=>{const f=clone(base);fn(f);assert.equal(project(f),'DENIED');};
  const rejectM=(fn,base=native)=>reject(f=>editManifest(f,fn),base);
  for(const change of [
    t=>t[6][0].bookingRows[0].operationId=golden.accepted.operationId,
    t=>t[6][0].bookingRows[0].operationId=t[5][0][0].slice(0,-1)+'p',
    t=>t[6][0].bookingRows[0].payloadDigest='e'.repeat(64),
    t=>t[5][0][6]='e'.repeat(64),t=>t[3][3]='08'.repeat(32),t=>t[3][6]+=' ',t=>t[2]+='x',
    t=>t[6][0].acquisitions[1].payloadDigest='e'.repeat(64)
  ])rejectM(change);
  reject(f=>f.acceptanceRoot.operationId='08'.repeat(32));
  reject(f=>f.allocationManifest._id+='x');
  done('NM02');
  // CONSTRUCTED retained-schema variations, NOT issuer/planner/writer output.
  // Saved golden above is the only captured retained vector. No restricted producer
  // suite is imported/executed and no multi-group native provenance is claimed.
  function fixture(groups=[['adventure_suite',1,2],['adventure_suite',2,2]],note='Café 李',rate=.05){
    const f=clone(native),r=f.acceptanceRoot,c=JSON.parse(r.capsule),u=JSON.parse(c.inputCanonical);
    u[9]=groups;u[7][4]=note;c.inputCanonical=JSON.stringify(u);
    c.factors.priceGroups=groups.map(([roomCode,quantity,guests])=>({roomCode,quantity,guests}));
    c.factors.totalPerPerson=rate;c.quote.totalPerPerson=rate;
    c.factors.penthouseRoomFee=groups.some(g=>g[0]==='penthouse_apartment')?10.005:null;
    c.calculation=calc(c.factors);assert.notEqual(c.calculation,'DENIED');
    // Explicitly constructed unsigned token payload, never issuer authority.
    u[5]=Buffer.from(JSON.stringify(c.quote)).toString('base64url')+'.constructed-not-authenticated';
    c.inputCanonical=JSON.stringify(u);r.quoteDigest=ad('wbe.quote.v1',u[5]);
    r.capsule=JSON.stringify(c);r.intentDigest=ad('wbe.complete-offer.v2',r.capsule);
    r.rootDigest=ad('wbe.acceptance-root.v2',JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='rootDigest'))));
    const t=clone(tuple);t[3]=Object.values(r);t[5]=[];t[6]=[];t[7]=[];
    let slot=0;
    for(const [code,suffix,firstUnit] of [['penthouse_apartment','p',1],['two_bedroom_apartment','t',2],['adventure_suite','a',3]]){
      const refs=[],guests=[],notes=[];
      groups.forEach((g,i)=>{if(g[0]===code)for(let q=1;q<=g[1];q++){refs.push([i,q]);guests.push(g[2]);notes.push(i===0&&q===1?note:'');}});
      if(!refs.length)continue;
      const op='cg2_'+Buffer.from(r.operationId,'hex').toString('base64url')+'_'+suffix;
      const payload=hash(JSON.stringify(['wbe.accepted-allocation-payload',1,r._id,r.operationId,r.rootDigest,r.capsule,r.bookingNumber,op,code,u[2],u[3],refs.length,refs,guests,notes]));
      t[5].push([op,code,refs.length,refs,guests,notes,payload]);
      const rows=refs.map((ref,j)=>({_id:'pb1-'+op+'-r'+(j+1),roomCode:code,assignedRoom:firstUnit+j,quantity:1,checkIn:u[2],checkOut:u[3],bookingNumber:r.bookingNumber,operationId:op,payloadDigest:payload}));
      const acquisitions=[];
      for(const row of rows){
        slot++;
        for(const night of ['2027-01-01','2027-01-02'])for(const type of ['capacity','unit']){
          const n=type==='unit'?row.assignedRoom:slot,letter=type==='unit'?'u':'s';
          acquisitions.push({_id:'rc1-'+night.replaceAll('-','')+'-'+letter+n+'-000001-a',protocolVersion:1,claimKey:type+':'+night+':'+n,generation:1,eventType:'acquire',claimType:type,night,operationId:op,bookingRowId:row._id,bookingNumber:r.bookingNumber,payloadDigest:payload,[type==='unit'?'unit':'capacitySlot']:n});
        }
      }
      const operation={...clone(tuple[6][0].acquisitions[0]),_id:'rc1-op-'+op+'-a',claimKey:'operation:'+op,operationId:op,bookingRowId:rows[0]._id,bookingNumber:r.bookingNumber,payloadDigest:payload,manifestRoomCode:code,manifestUnits:rows.map(r=>r.assignedRoom).join(','),manifestBookingRowIds:rows.map(r=>r._id).join('|'),manifestResourceClaimIds:acquisitions.map(a=>a._id).join('|')};
      t[6].push({acquisitions:[operation,...acquisitions],bookingRows:rows,primaryRowId:rows[0]._id});t[7].push(...rows.map(r=>r._id));
      if(refs[0][0]===0)t[8]=rows[0]._id;
    }
    f.allocationManifest.manifestCanonical=JSON.stringify(t);f.allocationManifest.manifestDigest=hash(f.allocationManifest.manifestCanonical);
    return f;
  }
  const duplicates=fixture(),d=project(duplicates);assert.equal(d.kind,'PARTIAL_PROJECTION_PROPOSAL');
  assert.deepEqual(d.plannedBookingRows.map(r=>[r.originalGroupIndex,r.ordinal,r.guests]),[[0,0,2],[1,0,2],[1,1,2]]);
  assert.deepEqual(d.plannedBookingRows.map(r=>r._id.split('-r').pop()),['1','2','3']);
  for(const change of [t=>t[5][0][3].pop(),t=>t[5][0][3][1]=t[5][0][3][0],t=>t[5][0][3][0][1]=0,t=>t[6][0].bookingRows.pop(),t=>t[6][0].bookingRows.push(t[6][0].bookingRows[0])])rejectM(change,duplicates);
  done('NM03');
  const mixed=fixture([['adventure_suite',2,2],['penthouse_apartment',1,2],['two_bedroom_apartment',1,3]]),mix=project(mixed);
  assert.equal(mix.kind,'PARTIAL_PROJECTION_PROPOSAL');
  assert.deepEqual(mix.plannedBookingRows.map(r=>[r.originalGroupIndex,r.ordinal]),[[1,0],[2,0],[0,0],[0,1]]);
  assert.equal(mix.receiptBindingProposal.primaryBookingRowId,mix.plannedBookingRows[2]._id);
  assert.notEqual(mix.receiptBindingProposal.primaryBookingRowId,mix.plannedBookingRows[0]._id);
  for(const change of [t=>t[8]=t[7][0],t=>t[7].reverse(),t=>t[6][2].bookingRows.reverse(),t=>t[6][0].primaryRowId=t[8]])rejectM(change,mixed);
  done('NM04');
  assert.deepEqual(d.plannedBookingRows.map(r=>r.assignedRoom),[3,4,5]);
  for(const value of ['3','unit-3',1,2,6,null,3.5])rejectM(t=>t[6][0].bookingRows[0].assignedRoom=value);
  rejectM(t=>delete t[6][0].bookingRows[0].assignedRoom);
  rejectM(t=>t[6][0].bookingRows[1].assignedRoom=3,duplicates);
  rejectM(t=>t[6][0].bookingRows[0].roomCode='penthouse_apartment');
  done('NM05');
  assert.deepEqual(d.plannedBookingRows.map(r=>r.note),['Café 李','','']);assert.equal(d.summary.notes,'Café 李');
  const empty=project(fixture(undefined,''));assert.equal(empty.kind,'PARTIAL_PROJECTION_PROPOSAL');assert.ok(empty.plannedBookingRows.every(r=>r.note===''));assert.equal(empty.summary.notes,'');
  for(const change of [t=>t[5][0][5][1]='Café 李',t=>t[5][0][5][0]='',t=>t[5][0][4][1]=3,t=>t[5][0][4].pop()])rejectM(change,duplicates);
  assert.deepEqual(mix.plannedBookingRows.map(r=>r.note),['','','Café 李','']);
  done('NM06');
  // Rebind all enclosing root/manifest/class facts after economic corruption so
  // these assertions reach calculator reconciliation, not a stale outer hash.
  function editCapsule(f,fn){
    const r=f.acceptanceRoot,c=JSON.parse(r.capsule);fn(c);r.capsule=JSON.stringify(c);r.intentDigest=ad('wbe.complete-offer.v2',r.capsule);
    r.rootDigest=ad('wbe.acceptance-root.v2',JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='rootDigest'))));
    editManifest(f,t=>{t[3]=Object.values(r);const u=JSON.parse(c.inputCanonical);t[5].forEach((b,i)=>{
      b[6]=hash(JSON.stringify(['wbe.accepted-allocation-payload',1,r._id,r.operationId,r.rootDigest,r.capsule,r.bookingNumber,b[0],b[1],u[2],u[3],b[2],b[3],b[4],b[5]]));
      for(const row of [...t[6][i].bookingRows,...t[6][i].acquisitions])row.payloadDigest=b[6];
    });});
  }
  assert.equal(JSON.stringify(d.summary.acceptedCalculation),JSON.stringify(JSON.parse(duplicates.acceptanceRoot.capsule).calculation));
  assert.equal(d.summary.totalGuests,6);assert.equal(mix.summary.roomCount,4);
  for(const key of ['grossCents','discountCents','roomTotalCents','propertyFeeCents','accommodationVatCents','packageVatCents','grandTotalCents']){
    reject(f=>editCapsule(f,c=>c.calculation.groups[0][key]++),duplicates);
    reject(f=>editCapsule(f,c=>c.calculation.totals[key]++),duplicates);
  }
  for(const key of ['totalVatCents','totalRooms','totalGuests'])reject(f=>editCapsule(f,c=>c.calculation.totals[key]++),duplicates);
  reject(f=>editCapsule(f,c=>c.calculation.groups.reverse()),duplicates);
  reject(f=>editCapsule(f,c=>{c.factors.priceGroups=[{roomCode:'adventure_suite',quantity:3,guests:2}];c.calculation=calc(c.factors);}),duplicates);
  reject(f=>editCapsule(f,c=>{c.factors.priceGroups.reverse();c.calculation=calc(c.factors);}),duplicates);
  reject(f=>editCapsule(f,c=>{c.factors.priceGroups[0].quantity=3;}),mixed);
  const rounding=project(fixture([['adventure_suite',1,2],['adventure_suite',1,2]]));assert.equal(rounding.kind,'PARTIAL_PROJECTION_PROPOSAL');assert.equal(rounding.summary.acceptedCalculation.totals.grandTotalCents,26);
  for(let n=1;n<=4;n++){const groups=Array.from({length:Math.min(n,3)},()=>['adventure_suite',1,2]);if(n===4)groups.push(['penthouse_apartment',1,2]);const p=project(fixture(groups));assert.equal(p.kind,'PARTIAL_PROJECTION_PROPOSAL');assert.equal(p.plannedBookingRows.length,n);}
  done('NM07');
  const before=JSON.stringify(native);assert.equal(JSON.stringify(project(native)),JSON.stringify(result));
  const fresh=await import(url(loaded+'\n// fresh pure module'));
  assert.equal(JSON.stringify(fresh.projectGuestBookingCompletion(before)),JSON.stringify(result));
  const u=JSON.parse(JSON.parse(native.acceptanceRoot.capsule).inputCanonical),c=JSON.parse(native.acceptanceRoot.capsule);
  for(const [key,value] of Object.entries({bookingNumber:native.acceptanceRoot.bookingNumber,guestName:u[7][0],guestEmail:u[7][1],guestPhone:u[7][2],dialingCode:u[7][3],notes:u[7][4],marketSource:u[7][5],packageTitle:c.quote.packageTitle,checkIn:u[2],checkOut:u[3],bookingDate:new Date(native.acceptanceRoot.validatedAtMs).toISOString(),roomCount:1,totalGuests:2}))assert.equal(result.summary[key],value,key);
  const detached=project(native);detached.plannedBookingRows[0].assignedRoom=5;assert.throws(()=>{detached.summary.acceptedCalculation.groups[0].grossCents++;},TypeError);assert.equal(JSON.stringify(native),before);assert.deepEqual(project(native),result);
  reject(f=>editCapsule(f,c=>c.quote.checkOut='2027-01-04'));
  reject(f=>editCapsule(f,c=>c.quote.packageTitle='Unbound replacement'));
  reject(f=>editCapsule(f,c=>c.quote.nonce='ff'.repeat(12)));
  reject(f=>editCapsule(f,c=>c.bookingNumber='OTHER'));
  reject(f=>f.acceptanceRoot.validatedAtMs++);
  done('NM08');
  // P06 policy intentionally changes: v2 is APPLICATION ONLY. Former permissive
  // synthetic metadata and arbitrary physical reorder positives are obsolete.
  for(const change of [f=>f.v=1,f=>f.extra=true,f=>delete f.acceptanceRoot.rootDigest,f=>f.acceptanceRoot._owner=null,f=>f.allocationManifest._owner=null,f=>f.acceptanceRoot.capsule+='x'.repeat(160000),f=>f.pad='x'.repeat(262144),f=>f.allocationManifest.schemaVersion=2])reject(change);
  rejectM(t=>t[1]=2);rejectM(t=>t[4]='unknown');rejectM(t=>t[9][0]=9);rejectM(t=>t[6][0].bookingRows[0].status='confirmed');
  assert.equal(project({root:{},capsule:{},plan:{}}),'DENIED');
  let hooks=0;assert.equal(projectText({toString(){hooks++;return before;}}),'DENIED');assert.equal(hooks,0);assert.equal(projectText(before,{}),'DENIED');
  const keys=clone(native);keys.acceptanceRoot=Object.fromEntries(Object.entries(keys.acceptanceRoot).reverse());editManifest(keys,t=>t[6][0].bookingRows[0]=Object.fromEntries(Object.entries(t[6][0].bookingRows[0]).reverse()));
  // Manifest raw bytes differ, hence manifest-dependent output digests differ;
  // native row application key order itself is canonical and unchanged.
  const reordered=project(keys);assert.equal(reordered.kind,'PARTIAL_PROJECTION_PROPOSAL');assert.deepEqual(reordered.plannedBookingRows,result.plannedBookingRows);
  assert.deepEqual(Object.keys(result.plannedBookingRows[0]),['_id','roomCode','assignedRoom','quantity','checkIn','checkOut','bookingNumber','operationId','payloadDigest','originalGroupIndex','ordinal','guests','note']);
  done('NM09');
  // Verbatim saved actual writer observations from writer-reader-final-run4.log,
  // WR01 JSON line 16. JSON Date serialization is NOT native SDK admission.
  const legacy={booking:{roomCode:'adventure_suite',guests:2,status:'confirmed',quantity:1,roomFee:0,bookingNumber:'WC-1',checkIn:'2030-01-01T12:00:00.000Z',checkOut:'2030-01-02T12:00:00.000Z',note:'ordinary note',_id:'public-0002'},summary:{bookingNumber:'WC-1',checkIn:'2030-01-01T12:00:00.000Z',checkOut:'2030-01-02T12:00:00.000Z',guestName:'Public Guest',guestEmail:'fixture@example.invalid',guestPhone:'000',marketSource:'fixture',roomCount:1,status:'confirmed',gclid:'public-gclid',gbraid:'public-gbraid',wbraid:'public-wbraid',msclkid:'public-msclkid',googleConversionUploaded:false,microsoftConversionUploaded:false,notes:'ordinary note',bookingDate:'2026-09-08T12:00:00.000Z',packageTitle:'Public fixture',_id:'public-0004'}};
  assert.equal(project(legacy),'DENIED');rejectM(t=>t[6][0].bookingRows[0]=legacy.booking);
  const binding=result.receiptBindingProposal;assert.equal(binding.kind,'UNTRUSTED_RECEIPT_BINDING_PROPOSAL');assert.equal(binding.v,2);
  assert.equal(binding.financialDigest,digest('wbe.completion-financial.v1',result.summary.acceptedCalculation));
  assert.equal(binding.summaryDigest,digest('wbe.completion-summary.v2',result.summary));
  assert.deepEqual(binding.rowDigests,result.plannedBookingRows.map(r=>digest('wbe.completion-row.v2',r)));
  assert.deepEqual(binding.bookingRowIds,tuple[7]);assert.equal(binding.primaryBookingRowId,tuple[8]);assert.equal(binding.recipient,u[7][1]);
  for(const p of [result,d,mix]){assert.ok(!JSON.stringify(p).includes('CONFIRMED'));assert.equal(p.status,undefined);assert.equal(p.receiptBindingProposal.outcome,undefined);}
  assert.deepEqual([...source.matchAll(/^import .* from '([^']+)';/gm)].map(m=>m[1]),['backend/guestBookingFinancialCalculation','crypto','buffer']);
  assert.ok(!/wix-|fetch\(|Date\.now|Math\.random|guestBookingCredentials|guestBookingAllocationManifest|\.insert\(|\.save\(|\.remove\(/.test(source));
  function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())scan(p);else if(/\.(js|jsw|html)$/.test(e.name)&&p!==path.join(root,candidate))assert.ok(!fs.readFileSync(p,'utf8').includes('guestBookingCompletionProjection'),'no incoming production consumer: '+p);}}
  scan(path.join(root,'velo'));done('NM10');
  // P01/P02/P03/P04/P05 economics/admission/Summary/proposal retained above;
  // P06 replaces SDK-metadata/legacy-seam claims with explicit v2 rejection.
  // Captured ordinary actual issuer -> acceptance -> handoff application records.
  // Replaying these vectors does not approve their dirty producer dependencies,
  // authenticate credentials, reserve rooms or establish completion authority.
  const captured=JSON.parse(read('scripts/fixtures/completion-projection-native-multigroup.json'));
  assert.equal(captured.status,'CAPTURED');assert.equal(captured.cases.length,2);
  assert.deepEqual(captured.cases.map(c=>c.id),['NM03-native-producer','NM04-native-producer']);
  for(const [index,c] of captured.cases.entries()){
    assert.equal(c.status,'CAPTURED');assert.equal(c.acceptance.status,'ACCEPTED_PENDING');
    assert.equal(c.handoff.status,'ALLOCATION_HANDOFF_PENDING');
    assert.equal(c.acceptanceReadback.status,'FOUND');assert.equal(c.manifestReadback.status,'FOUND');
    assert.deepEqual(c.envelope,{v:2,acceptanceRoot:c.acceptanceReadback.root,allocationManifest:c.manifestReadback.record});
    const r=c.envelope.acceptanceRoot,m=c.envelope.allocationManifest,t=JSON.parse(m.manifestCanonical),capsule=JSON.parse(r.capsule),u=JSON.parse(capsule.inputCanonical);
    assert.equal(r.capsule,c.offer.capsule);assert.equal(u[5],c.input.pricingQuoteToken);
    assert.equal(c.handoff.manifestId,m._id);assert.equal(m.manifestDigest,hash(m.manifestCanonical));
    assert.deepEqual(t[3],Object.values(r));assert.equal(t[2],m._id);
    const inserts=c.trace.filter(x=>x.op==='insert');
    assert.deepEqual(inserts.map(x=>x.collection),['GuestBookingAcceptances','GuestBookingAllocationManifests']);
    for(const [j,record] of [r,m].entries()){
      assert.deepEqual(inserts[j].application,record);
      assert.deepEqual(inserts[j].options,{suppressAuth:true,suppressHooks:true});
      assert.ok(c.trace.some(x=>x.op==='find'&&x.collection===inserts[j].collection&&x.items.length===1&&JSON.stringify(x.items[0])===JSON.stringify(record)&&x.options.consistentRead===true));
    }
    assert.deepEqual(c.counts,{GuestBookingFinancialRevisions:1,GuestBookingAcceptances:1,GuestBookingAllocationManifests:1,RoomBookingClaimEvents:0,Bookings:0,BookingSummary:0});
    const expectedGroups=index===0?[['adventure_suite',1,2],['adventure_suite',2,2]]:[['adventure_suite',2,2],['penthouse_apartment',1,2],['two_bedroom_apartment',1,3]];
    assert.deepEqual(c.groups,expectedGroups);assert.deepEqual(u[9],expectedGroups);
    assert.deepEqual(capsule.factors.priceGroups,expectedGroups.map(([roomCode,quantity,guests])=>({roomCode,quantity,guests})));
    const p=project(c.envelope);assert.equal(p.kind,'PARTIAL_PROJECTION_PROPOSAL',c.id);
    // Saved JSON asserts application values, not native prototype/Date admission.
    assert.deepEqual(clone(p),c.projection);assert.deepEqual(clone(p.summary.acceptedCalculation),capsule.calculation);
    assert.deepEqual(clone(p.summary.acceptedCalculation),c.offer.display);
    assert.equal(JSON.stringify(calc(capsule.factors)),JSON.stringify(capsule.calculation));
    assert.deepEqual(t[5].map(b=>b[1]),index===0?['adventure_suite']:['penthouse_apartment','two_bedroom_apartment','adventure_suite']);
    assert.deepEqual(t[5].map(b=>b[3]),index===0?[[[0,1],[1,1],[1,2]]]:[[[1,1]],[[2,1]],[[0,1],[0,2]]]);
    for(const [j,b] of t[5].entries()){
      const suffix={penthouse_apartment:'p',two_bedroom_apartment:'t',adventure_suite:'a'}[b[1]];
      assert.equal(b[0],'cg2_'+Buffer.from(r.operationId,'hex').toString('base64url')+'_'+suffix);assert.notEqual(b[0],r.operationId);
      const payload=hash(JSON.stringify(['wbe.accepted-allocation-payload',1,r._id,r.operationId,r.rootDigest,r.capsule,r.bookingNumber,b[0],b[1],u[2],u[3],b[2],b[3],b[4],b[5]]));
      assert.equal(b[6],payload);
      for(const row of [...t[6][j].bookingRows,...t[6][j].acquisitions]){assert.equal(row.operationId,b[0]);assert.equal(row.payloadDigest,payload);}
      assert.deepEqual(t[6][j].bookingRows.map((row,k)=>row._id),t[6][j].bookingRows.map((row,k)=>'pb1-'+b[0]+'-r'+(k+1)));
      assert.equal(t[6][j].acquisitions[0].manifestUnits,t[6][j].bookingRows.map(row=>row.assignedRoom).join(','));
    }
    assert.deepEqual(p.plannedBookingRows.map(row=>[row.originalGroupIndex,row.ordinal]),index===0?[[0,0],[1,0],[1,1]]:[[1,0],[2,0],[0,0],[0,1]]);
    assert.deepEqual(p.plannedBookingRows.map(row=>row.assignedRoom),index===0?[3,4,5]:[1,2,3,4]);
    assert.deepEqual(p.plannedBookingRows.map(row=>row.note),index===0?['Café 李','','']:['','','Café 李','']);
    assert.equal(p.summary.notes,'Café 李');assert.equal(p.receiptBindingProposal.primaryBookingRowId,p.plannedBookingRows[index===0?0:2]._id);
    if(index===1)assert.notEqual(p.receiptBindingProposal.primaryBookingRowId,p.plannedBookingRows[0]._id);
    assert.equal(new Set(p.plannedBookingRows.map(row=>row._id)).size,p.plannedBookingRows.length);
    done(c.id);
  }
  assert.equal(pass.length,12);
  console.log('SUMMARY '+JSON.stringify({criteria:pass,count:pass.length,priorPolicy:['P01','P02','P03','P04','P05','P06'],scope:'v2 untrusted application projection; constructed negatives plus two captured actual native multigroup producer vectors',coverageGaps:[],remainingReview:['independent exact fixture/verifier review','dirty producer dependencies are provenance only, not approved runtime or commit closure'],restricted:'NOT RUN'}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
