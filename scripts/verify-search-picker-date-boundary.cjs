'use strict';
// Extracted real page handlers, never page/onReady evaluation or producers.
const fs = require('fs'), path = require('path'), vm = require('vm');
const assert = require('assert/strict'), crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const pins = {
  'velo/backend/search.web.js':'9ee7cec295395cdc77b57015fa34978bb8deb072da7e5516641fbcf97b2b5017',
  'velo/backend/roomAvailability.js':'416c0611ec37c5e8363ae7119ad93c8122bd830f7c9d3b38a3c65394745acfe6',
  'velo/backend/roomInventory.js':'ea98da3edb69254dc1ffd008886a43df653ab54bc9d034412537274760cdebc5',
  'velo/backend/roomInventoryRules.js':'6bc0520cb3940b0399f43d8f5df7b493c666f221621bb80bc3e7004c8de89899',
  'velo/backend/roomAvailabilityRules.js':'578b42bcc63c28720b9a08aae9dea42761a42febcfc62449efe5313a7164b6f4',
  'velo/backend/roomAssignmentRules.js':'9d685cc29821181e482c84cf1d9ecf0fd463fc03dbf12617d3fcfb76e9dd46b2',
  'velo/backend/wbeConfig.js':'ab2605869199c1d586dad2643f1f838abda1f6f3d1d18cc4ac4d0743edce70f2',
  'scripts/verify-search-bookings-first.cjs':'e05dade6dd92e0013192f7a0013d289df9f8e157dba5982dd47d263a49fa709f'
};
for (const [file,hash] of Object.entries(pins)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')).digest('hex'),hash,file);
const fixtureSource=fs.readFileSync(path.join(root,'scripts/verify-search-bookings-first.cjs'),'utf8').replace(/\r\n/g,'\n');
const prefix=fixtureSource.slice(0,fixtureSource.indexOf('async function check('));
assert.ok(prefix.endsWith('}\n'));
assert.ok(!prefix.includes('async function snapshot'));
const fixture=vm.compileFunction(prefix+'\nreturn {database,loader,booking,controls};',['require','__dirname'])(require,__dirname);
const source=fs.readFileSync(path.join(root,'velo/page-booking-search.js'),'utf8');
function extract(name) {
  const match=source.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n\\}'));
  assert.ok(match,'missing actual function '+name); return match[0];
}
const names=['parseDate','searchHandler','showAlternateDates','buildAltUrl','applyUrlDatesIfPresent','setRoomSelection','pricingStay'];
if(source.includes('function pickerCalendarDate(')) names.push('pickerCalendarDate');
const summaryStart=source.indexOf('summaryBtn.onClick(() => {');
const summaryEnd=source.indexOf('\n    });',summaryStart);
assert.ok(summaryStart>0 && summaryEnd>summaryStart);
const summaryBody=source.slice(summaryStart+'summaryBtn.onClick(() => {'.length,summaryEnd);
const pageFunctions=names.map(extract).join('\n');
const noops=['syncSummaryButtonWithResults','hideSearchHeader','hideAlternateDates','clearSelections','trackSearchNoResults','updateSelectionPanel','trackRoomView','showSearchHeader','loadPackageInfo'];
function page(start,end,backend,variant='full') {
  const elements={datePickerCheckIn:{value:start},datePickerCheckOut:{value:end},searchResultsRepeater:{data:[],expand(){},show(){}}};
  const calls=[],pending=[],messages=[],navigation=[],stored={};
  const api={};
  for(const method of ['searchAvailability','suggestAlternateDates']) api[method]=async(...args)=>{
    const wire=JSON.parse(JSON.stringify(args)); calls.push({method,args,wire});
    if(variant==='empty' && method==='searchAvailability') return {ok:true,results:[],requestedNights:4};
    if(variant==='unavailable' && method==='searchAvailability') return {ok:true,results:[{maxQty:0,status:'unavailable'}],requestedNights:4};
    return backend[method](...wire);
  };
  const env={...Object.fromEntries(noops.map(n=>[n,()=>{}])),...api,
    assert,console:{log(){},error(){}},tryFind:id=>elements[id]||null,$w:()=>[],
    safeText:t=>messages.push(t),packageExistsForNights:async()=>true,
    wixLocation:{query:{},to:url=>navigation.push(url)},localStorage:{setItem:(k,v)=>{stored[k]=v;}},
    roomSelectionRequiredMessage:()=>'', summaryUrl:'/booking-summary'};
  // Inert pricing boundary only: no pricing issuer/backend is loaded here.
  const body='let _summaryNights=0,_searchCheckIn=null,_searchCheckOut=null,_cachedPerPersonStayTotal=0,_hasCachedStayPricing=false; let _selections=[],_selectedPackage=null;\n'+pageFunctions+
    '\nfunction loadPackageOptions(nights){const stay=pricingStay();assert.equal(nights,stay.nights);_selectedPackage={_id:"pkg",pricingQuoteToken:"token",quoteCheckIn:stay.checkIn,quoteCheckOut:stay.checkOut};}'+
    '\nconst realAlternate=showAlternateDates; showAlternateDates=(...args)=>{const p=realAlternate(...args);pending.push(p);return p;};'+
    '\nreturn {searchHandler,showAlternateDates,buildAltUrl,applyUrlDatesIfPresent,summary:()=>{'+summaryBody+'},select:rows=>{for(const r of rows)setRoomSelection(r.roomCode,r.roomName,r.qty,r.numGuests,r.availableCheckIn,r.availableCheckOut,r.roomFee);},state:()=>({_summaryNights,_searchCheckIn,_searchCheckOut})};';
  const functions=vm.compileFunction(body,[...Object.keys(env),'pending'])(...Object.values(env),pending);
  return {...functions,elements,calls,pending,messages,navigation,stored,location:env.wixLocation};
}
const cases=[
  ['ordinary','2027-11-05','2027-11-09',0],
  ['spring-DST','2027-03-12','2027-03-18',0],
  ['fall-DST','2027-11-05','2027-11-11',0],
  ['leap-month','2028-02-27','2028-03-02',0],
  ['year-rollover','2027-12-29','2028-01-02',0],
  ['picker-noon','2027-11-05','2027-11-09',12]
];
function local(s,h=0){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,h);}
const passed=[];
function pass(id){assert.ok(!passed.includes(id));passed.push(id);console.log('PASS '+id);}
function wire(p,method,a,b){const c=p.calls.find(x=>x.method===method);assert.ok(c,method);assert.deepEqual(c.wire,[a,b],method+' exact calendar JSON');assert.deepEqual(c.args,[a,b],method+' primitive boundary');}
async function main(){
  const mode=process.argv[2]; assert.ok(['search','alternate','links','all'].includes(mode),'explicit selector required');
  await fixture.controls();
  console.log(JSON.stringify({TZ:process.env.TZ,resolved:Intl.DateTimeFormat().resolvedOptions().timeZone,localPicker:local('2027-11-05').toISOString(),springOffsets:[local('2027-03-12').getTimezoneOffset(),local('2027-03-18').getTimezoneOffset()]}));
  for(const [label,a,b,h] of cases){
    const start=local(a,h),end=local(b,h),millis=[start.getTime(),end.getTime()];
    if(mode==='search'||mode==='all'){
      const db=fixture.database(),before=structuredClone(db.storage),backend=fixture.loader(db).load('backend/search.web');
      const p=page(start,end,backend);await p.searchHandler();
      wire(p,'searchAvailability',a,b); assert.equal(p.calls.length,1);
      assert.deepEqual([start.getTime(),end.getTime()],millis);assert.equal(p.state()._searchCheckIn,start);assert.equal(p.state()._searchCheckOut,end);
      const results=p.elements.searchResultsRepeater.data;assert.equal(results.length,3);
      for(const r of results){assert.equal(r.availableCheckIn,a+'T00:00:00.000Z');assert.equal(r.availableCheckOut,b+'T00:00:00.000Z');}
      p.select([{...results[0],qty:1,numGuests:2,roomFee:0}]);assert.equal(p.state()._summaryNights,results[0].availableNights);p.summary();
      const q=new URL(p.navigation[0],'https://inert.invalid').searchParams;
      assert.equal(q.get('ci'),a);assert.equal(q.get('co'),b);assert.equal(p.stored._wbe_ci,a);assert.equal(p.stored._wbe_co,b);assert.equal(q.get('quote'),'token');
      assert.deepEqual(db.storage,before);assert.equal(db.writes,0);pass('picker-search-summary-'+label);
    }
    if(mode==='alternate'||mode==='all'){
      const db=fixture.database(),before=structuredClone(db.storage),backend=fixture.loader(db).load('backend/search.web');
      const p=page(start,end,backend);await p.showAlternateDates(start,end);wire(p,'suggestAlternateDates',a,b);
      assert.deepEqual(db.storage,before);assert.equal(db.writes,0);pass('picker-alternate-'+label);
    }
    if(mode==='links'||mode==='all'){
      const db=fixture.database(),before=structuredClone(db.storage),backend=fixture.loader(db).load('backend/search.web');
      const p=page(null,null,backend);const url=p.buildAltUrl(a+'T00:00:00.000Z',b+'T00:00:00.000Z');
      const q=new URL(url,'https://inert.invalid').searchParams;assert.equal(q.get('ci'),a,'alternate link calendar check-in');assert.equal(q.get('co'),b);
      p.location.query=Object.fromEntries(q);assert.equal(p.applyUrlDatesIfPresent(),true);await p.searchHandler();wire(p,'searchAvailability',a,b);
      assert.deepEqual(db.storage,before);assert.equal(db.writes,0);pass('alternate-link-auto-search-'+label);
    }
  }
  if(mode==='all'){
    for(const [label,a,occupiedEnd,b] of [['spring','2027-03-12','2027-03-14','2027-03-18'],['fall','2027-11-05','2027-11-07','2027-11-11']]){
      const db=fixture.database([fixture.booking(1,a,occupiedEnd)]),before=structuredClone(db.storage),api=fixture.loader(db).load('backend/search.web');
      const p=page(local(a),local(b),api);await p.searchHandler();wire(p,'searchAvailability',a,b);
      const r=p.elements.searchResultsRepeater.data.find(r=>r.roomCode==='penthouse_apartment');
      assert.ok(r);assert.equal(r.status,'partial');assert.equal(r.availableNights,4);
      assert.equal(r.availableCheckIn,occupiedEnd+'T00:00:00.000Z');assert.equal(r.availableCheckOut,b+'T00:00:00.000Z');
      p.select([{...r,qty:1,numGuests:2}]);assert.equal(p.state()._summaryNights,r.availableNights);p.summary();const q=new URL(p.navigation[0],'https://inert.invalid').searchParams;
      assert.equal(q.get('ci'),occupiedEnd);assert.equal(q.get('co'),b);assert.equal(p.stored._wbe_ci,occupiedEnd);assert.equal(p.stored._wbe_co,b);
      assert.deepEqual(db.storage,before);assert.equal(db.writes,0);pass('partial-'+label+'-summary');
    }
    for(const variant of ['empty','unavailable']){
      const db=fixture.database(),before=structuredClone(db.storage),api=fixture.loader(db).load('backend/search.web');
      const p=page(local('2027-11-05'),local('2027-11-09'),api,variant);await p.searchHandler();await Promise.all(p.pending);
      wire(p,'searchAvailability','2027-11-05','2027-11-09');wire(p,'suggestAlternateDates','2027-11-05','2027-11-09');assert.equal(p.calls.length,2);
      assert.deepEqual(db.storage,before);assert.equal(db.writes,0);pass('no-results-branch-'+variant);
    }
    for(const [label,start,end] of [['missing',null,local('2027-11-09')],['reversed',local('2027-11-09'),local('2027-11-05')],['equal',local('2027-11-05'),local('2027-11-05')]]){
      const p=page(start,end,{});await p.searchHandler();assert.equal(p.calls.length,0);assert.equal(p.messages.length,1);pass('validation-'+label);
    }
  }
  assert.equal(passed.length,mode==='all'?25:6);console.log(JSON.stringify({completed:passed,count:passed.length}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
