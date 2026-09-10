'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const IDS=['SDK01','E2E01','RETRY01','INVENTORY01','LEGACY01','AUTH01'];
const id=process.argv[2],evidence=path.join(__dirname,'evidence');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function sdk01(){
 const {fixture,detach}=require('./sdk.cjs'),{compileGraph,compileSource,createLoader}=require('./loader.cjs');
 const checks=[],traces=[];
 async function check(name,fn){await fn();checks.push(name);}
 const options={suppressAuth:true,suppressHooks:true,consistentRead:true};
 const rows=n=>Array.from({length:n},(_,i)=>({_id:String(i).padStart(5,'0')}));
 await check('exact-conjunctive-keyset-options',async()=>{
  const f=fixture({mode:'SDK01',initial:{Bookings:[{_id:'a',bookingNumber:'x'},{_id:'b',bookingNumber:'y'},{_id:'c',bookingNumber:'x'}]}});
  const p=await f.wix.query('Bookings').eq('bookingNumber','x').gt('_id','a').ascending('_id').limit(100).find(options);
  assert.deepEqual(p.items,[{_id:'c',bookingNumber:'x'}]);assert.equal(p.hasNext(),false);
  assert.deepEqual(f.trace[0].predicates,[['eq','bookingNumber','x'],['gt','_id','a']]);assert.deepEqual(f.trace[0].options,options);
  assert.equal((await f.wix.query('Bookings').eq('_id','missing').limit(2).find()).items.length,0);
  assert.equal((await f.wix.query('Bookings').eq('_id','b').limit(2).find()).items[0].bookingNumber,'y');
  assert.equal(f.trace[1].options,undefined);f.assertBackendFree();traces.push(f.trace);
 });
 await check('conjunctive-date-overlap',async()=>{
  const d=s=>new Date(s+'T00:00:00.000Z');
  const f=fixture({mode:'SDK01',initial:{HotelClosures:[{_id:'a',startDate:d('2026-01-01'),endDate:d('2026-01-05')},{_id:'b',startDate:d('2026-01-01'),endDate:d('2026-01-02')},{_id:'c',startDate:d('2026-01-07'),endDate:d('2026-01-09')}]}});
  const p=await f.wix.query('HotelClosures').le('startDate',d('2026-01-06')).ge('endDate',d('2026-01-03')).limit(100).find(options);
  assert.deepEqual(p.items.map(r=>r._id),['a']);assert.ok(p.items[0].startDate instanceof Date);p.items[0].startDate.setUTCFullYear(1900);assert.equal(f.snapshot().HotelClosures[0].startDate.getUTCFullYear(),2026);f.assertBackendFree();traces.push(f.trace);
 });
 for(const [c,n] of [['GuestBookingAcceptances',25],['RoomBookingClaimEvents',100],['Bookings',1000],['BookingSummary',1000]])await check('page-'+c,async()=>{
  const f=fixture({mode:'SDK01',initial:{[c]:rows(n+1)}});let q=f.wix.query(c);if(n!==1000)q=q.ascending('_id');
  const p=await q.limit(n).find(options);assert.equal(p.items.length,n);assert.equal(p.hasNext(),true);
  const tail=await p.next();assert.deepEqual(tail.items.map(r=>r._id),[String(n).padStart(5,'0')]);assert.equal(tail.hasNext(),false);await assert.rejects(tail.next(),/final page/);
  if(n!==1000){const keyset=await f.wix.query(c).gt('_id',p.items.at(-1)._id).ascending('_id').limit(n).find(options);assert.deepEqual(keyset.items,tail.items);const empty=await f.wix.query(c).gt('_id',tail.items[0]._id).ascending('_id').limit(n).find(options);assert.deepEqual(empty.items,[]);assert.equal(empty.hasNext(),false);}
  f.assertBackendFree();traces.push(f.trace);
 });
 await check('numeric-descending-progress',async()=>{
  const f=fixture({mode:'SDK01',initial:{GuestBookingRecoveryProgress:[{_id:'a',stream:'s',sequence:2},{_id:'b',stream:'s',sequence:10},{_id:'c',stream:'other',sequence:99},{_id:'d',stream:'s',sequence:1}]}});
  const p=await f.wix.query('GuestBookingRecoveryProgress').eq('stream','s').descending('sequence').limit(2).find(options);
  assert.deepEqual(p.items.map(r=>r.sequence),[10,2]);assert.equal(p.hasNext(),true);f.assertBackendFree();traces.push(f.trace);
 });
 await check('detached-native-types-and-winners',async()=>{
  const f=fixture({mode:'SDK01'}),row=Object.assign(Object.create(null),{_id:'sentinel',date:new Date(0),nested:{a:[1]}});
  const ack=await f.wix.insert('GuestBookingAcceptances',row,options);assert.equal(Object.getPrototypeOf(ack),null);assert.equal(Object.getPrototypeOf(ack.nested),Object.prototype);assert.ok(ack.date instanceof Date);row.nested.a[0]=99;ack.date.setTime(900);
  await assert.rejects(f.wix.insert('GuestBookingAcceptances',{_id:'sentinel',different:true},options),/duplicate/);
  await f.wix.insert('GuestBookingAllocationManifests',{_id:'sentinel'},options);
  const p=await f.wix.query('GuestBookingAcceptances').eq('_id','sentinel').limit(2).find(options);assert.equal(p.items[0].date.getTime(),0);assert.deepEqual(p.items[0].nested.a,[1]);assert.equal(p.items[0]._id,'sentinel');assert.equal(Object.getPrototypeOf(p.items[0]),null);
  assert.equal(f.snapshot().GuestBookingAcceptances.length,1);assert.equal(f.trace.filter(e=>e.op==='insert-attempt').length,3);assert.equal(f.trace.filter(e=>e.op==='insert-applied').length,2);assert.throws(()=>detach({get x(){throw Error('must not call');}}),/accessor/);f.assertBackendFree();traces.push(f.trace);
 });
 await check('before-after-apply-readback-faults',async()=>{
  const f=fixture({mode:'SDK01'});f.armFault('before-apply','Bookings','before');await assert.rejects(f.wix.insert('Bookings',{_id:'before'},options),/before-apply/);assert.equal(f.snapshot().Bookings.length,0);
  f.armFault('after-apply','Bookings','after');await assert.rejects(f.wix.insert('Bookings',{_id:'after',value:7},options),/after-apply/);assert.equal(f.snapshot().Bookings.length,1);assert.equal(f.prefixes.length,1);assert.equal(f.prefixes[0].label,'NON_AUTHORITATIVE_SENTINEL');
  f.armFault('read','Bookings','after');await assert.rejects(f.wix.query('Bookings').eq('_id','after').limit(2).find(options),/read/);
  assert.equal((await f.wix.query('Bookings').eq('_id','after').limit(2).find(options)).items[0].value,7);await assert.rejects(f.wix.insert('Bookings',{_id:'after',value:99},options),/duplicate/);assert.equal(f.snapshot().Bookings[0].value,7);f.assertBackendFree();traces.push(f.trace);
 });
 await check('closed-surfaces-and-empty-business',async()=>{
  const f=fixture();assert.ok(Object.values(f.snapshot()).every(r=>r.length===0));
  assert.throws(()=>f.wix.query('Invoices'),/denied/);assert.throws(()=>f.wix.query('Bookings').limit(101),/denied/);await assert.rejects(f.wix.query('Bookings').descending('sequence').limit(100).find(options),/shape/);
  await assert.rejects(f.wix.insert('Rooms',{_id:'x'},options),/denied/);assert.throws(()=>fixture({initial:{GuestBookingCompletions:[{_id:'fake'}]}}),/seeding/);assert.throws(()=>fixture({initial:{Bookings:[{_id:'pb1-fake'}]}}),/seeding/);
  for(const method of ['save','update','remove','bulkInsert','get'])assert.equal(f.wix[method],undefined);
  assert.equal(f.trace.length,0);f.assertBackendFree();traces.push(f.trace);
 });
 await check('compile-only-42-exact-graph',async()=>{
  const state=compileGraph();assert.equal(state.compiled.size,42);
  const f=fixture(),loader=createLoader(f,{now:0});assert.equal(loader.cache.size,0);assert.equal(loader.compiledCount,42);assert.throws(()=>loader.load('velo/backend/search.web.js'),/admission pending/);f.assertBackendFree();
  const pin={imports:[]};
  assert.doesNotThrow(()=>compileSource('inert-comment','// No routing/export to guest APIs; not activated.\nexport const x=1;',pin,{}));
  assert.doesNotThrow(()=>compileSource('inert-syntax','export const x=1;\nexport async function y(){return x;}',pin,{}));
  for(const source of ["import('backend/x')","require('node:net')","export default 1;"])assert.throws(()=>compileSource('inert-negative',source,pin,{}));
  assert.throws(()=>compileSource('inert-negative',"import x from 'backend/../../escape';",{imports:[{binding:'x',specifier:'backend/../../escape',target:'velo/../escape.js'}]},{}),/escape/);
 });
 assert.equal(checks.length,11); // Exact completed SDK controls; no business case credit.
 assert.ok(Object.keys(require.cache).every(p=>!/[\\/]velo[\\/]/.test(p)));
 fs.writeFileSync(path.join(evidence,'SDK01-trace.json'),JSON.stringify({kind:'NON_AUTHORITATIVE_SENTINELS_DISCARDED',traces},null,2)+'\n');
 return {id:'SDK01',status:'PASS',checks,backendEvaluations:0,producerCalls:0,businessCases:0};
}
(async()=>{
 if(!IDS.includes(id)||process.argv.length!==3)throw Error('One exact selector required: '+IDS.join(', '));
 // This receipt is a process/custody check, not a cryptographic authorization system.
 const reviewPath=process.env.BOOKING_MILESTONE_REVIEW_FILE;
 if(!reviewPath)throw Error('BLOCKED: independent fixture/source admission review required; no selector executed');
 const review=JSON.parse(fs.readFileSync(reviewPath,'utf8')),custody=fs.readFileSync(path.join(__dirname,'custody.json'));
 assert.equal(review.custodySha256,hash(custody),'review custody mismatch');assert.equal(review.verdict,'PASS');assert.equal(review.independent,true);assert.ok(review.selectors.includes(id),'selector not reviewed');
 const pins=JSON.parse(custody);for(const [rel,pin] of Object.entries(pins.files))assert.equal(hash(fs.readFileSync(path.join(root(),rel))),pin,'support/source changed: '+rel);
 if(id!=='SDK01')throw Error('NOT_IMPLEMENTED: '+id+' requires SDK01 PASS and behavioral TDD; no business result claimed');
 const timeout=JSON.parse(fs.readFileSync(path.join(__dirname,'admission.json'))).bounds.selectorWatchdogMs;
 let timer;try{const result=await Promise.race([sdk01(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('watchdog')),timeout);})]);fs.writeFileSync(path.join(evidence,id+'-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}finally{clearTimeout(timer);}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
function root(){return path.resolve(__dirname,'../..');}
