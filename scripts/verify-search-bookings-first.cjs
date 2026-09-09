'use strict';
// Standalone inert consumer: no producers, subprocesses, network or file writes.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../velo/backend');
const graph = {
  'search.web.js': ['wix-data', 'wix-web-module', 'backend/wbeConfig', 'backend/roomAvailability'],
  'roomAvailability.js': ['backend/roomInventory', 'backend/roomAvailabilityRules'],
  'roomInventory.js': ['wix-data', 'backend/roomInventoryRules'],
  'roomInventoryRules.js': ['backend/roomAssignmentRules'],
  'roomAvailabilityRules.js': ['backend/roomAssignmentRules'],
  'roomAssignmentRules.js': [], 'wbeConfig.js': []
};
function resolve(spec) {
  assert.match(spec, /^backend\/[A-Za-z][A-Za-z0-9.]*$/);
  const name = spec.slice(8).replace(/\.js$/, '') + '.js';
  assert.ok(Object.hasOwn(graph, name), 'undeclared module');
  return name;
}
const compiled = {};
for (const name of Object.keys(graph)) {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  const imports = [];
  let body = source.replace(/^import (.+?) from '([^']+)';\r?$/gm, (_, binding, spec) => {
    imports.push(spec);
    if (spec.startsWith('backend/')) resolve(spec);
    return 'const ' + binding + ' = load(' + JSON.stringify(spec) + ');';
  });
  assert.deepEqual(imports, graph[name]);
  assert.ok(!/\bimport\s*\(/.test(body));
  const exports = [...body.matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map(m => m[1]);
  body = body.replace(/export /g, '');
  compiled[name] = vm.compileFunction(body + '\nreturn {' + exports.join(',') + '};', ['load', 'console']);
}
function database(rows = [], summaries = [], pageSize = 1, fault = '') {
  const storage = { Bookings: rows, BookingSummary: summaries, Rooms: codes.map(roomCode => ({roomCode})), HotelClosures: [] };
  const trace = []; let writes = 0;
  const sdk = { query(collection) {
    assert.ok(Object.hasOwn(storage, collection));
    let limit = 1000; const predicates = [];
    const q = {
      limit(n) { limit = n; return q; },
      le(k,v) { predicates.push(row => row[k] <= v); return q; },
      ge(k,v) { predicates.push(row => row[k] >= v); return q; },
      async find(options) {
        const selected = storage[collection].filter(row => predicates.every(p => p(row)));
        const width = Math.min(limit, pageSize);
        function page(offset) {
          trace.push({collection, offset, options: structuredClone(options)});
          if (collection === 'Bookings' && offset > 0 && fault === 'throw') throw Error('inert page failure');
          if (collection === 'Bookings' && offset > 0 && fault === 'malformed') return {items: null};
          return {items: structuredClone(selected.slice(offset, offset + width)), hasNext() { return offset + width < selected.length; }, async next() {return page(offset + width);} };
        }
        // Legacy Rooms/closure reads have no traversal: keep these complete.
        if (collection === 'Rooms' || collection === 'HotelClosures') return {items: structuredClone(selected.slice(0,limit)), hasNext() {return false;}};
        return page(0);
      }
    }; return q;
  }};
  for (const method of ['insert','update','save','remove','bulkInsert','bulkUpdate','bulkRemove']) sdk[method] = () => { writes++; throw Error('forbidden write'); };
  return {sdk, storage, trace, get writes() { return writes; }};
}
function loader(db) {
  const cache = new Map();
  function load(spec) {
    if (spec === 'wix-data') return db.sdk;
    if (spec === 'wix-web-module') return {Permissions: {Anyone: 'Anyone'}, webMethod(permission, fn) { assert.equal(permission, 'Anyone'); return (...args) => fn(...args); }};
    const name = resolve(spec);
    if (!cache.has(name)) cache.set(name, compiled[name](load, {log() {}}));
    return cache.get(name);
  }
  return {load, cache};
}
const codes = ['penthouse_apartment','two_bedroom_apartment','adventure_suite'];
const ci = '2027-11-05', co = '2027-11-09';
function booking(unit = 1, start = ci, end = co, extra = {}) {
  return {_id: 'row-'+unit+'-'+start, bookingNumber: 'booking-'+unit, roomCode: codes[unit === 1 ? 0 : unit === 2 ? 1 : 2], status: 'confirmed', quantity: 1, assignedRoom: unit, checkIn: start, checkOut: end, ...extra};
}
const passed = [];
function pass(id) { assert.ok(!passed.includes(id)); passed.push(id); console.log('PASS '+id); }
async function controls() {
  assert.throws(() => resolve('backend/../secret')); assert.throws(() => resolve('backend/producer'));
  assert.equal(resolve('backend/roomInventory'), resolve('backend/roomInventory.js'));
  const date = new Date(ci); const db = database([booking(1,date,new Date(co)), booking(2)], [], 1);
  const l = loader(db); assert.equal(l.cache.size,0);
  const first = await db.sdk.query('Bookings').limit(1000).find({consistentRead:true});
  assert.ok(first.items[0].checkIn instanceof Date); assert.equal(first.items[0].checkIn.getTime(),date.getTime());
  assert.notEqual(first.items[0],db.storage.Bookings[0]); assert.equal(first.hasNext(),true);
  const second = await first.next(); assert.equal(second.items[0].assignedRoom,2); assert.equal(second.hasNext(),false);
  const filtered = await db.sdk.query('Bookings').ge('assignedRoom',2).le('assignedRoom',2).find({}); assert.equal(filtered.items.length,1); assert.equal(filtered.items[0].assignedRoom,2);
  const raw = structuredClone(db.storage); assert.deepEqual(db.storage,raw); const changed = structuredClone(raw); changed.Bookings[0].quantity=2; assert.throws(() => assert.deepEqual(db.storage,changed));
  assert.equal(l.cache.size,0); assert.equal(db.writes,0); pass('C01-loader-realm-pagination-zero-dispatch');
}
async function check(id, rows, summaries, expected, end=co, fault='') {
  const db = database(rows,summaries,1,fault); const before = structuredClone(db.storage);
  const l = loader(db); const result = await l.load('backend/search.web').searchAvailability(ci,end);
  assert.deepEqual(db.storage,before); assert.equal(db.writes,0);
  if (expected === null) { assert.equal(result.ok,false,id); assert.deepEqual(result.results,[]); }
  else {
    assert.equal(result.ok,true,id);
    const actual = result.results.map(r => [r.roomCode,r.maxQty,r.status,r.availableCheckIn.slice(0,10),r.availableCheckOut.slice(0,10),r.availableNights]);
    assert.deepEqual(actual,expected,id);
  }
  assert.equal(l.cache.size,7); pass(id); return {result,trace:db.trace};
}
function full(qtys, end=co, n=4) {return codes.flatMap((code,i) => qtys[i] ? [[code,qtys[i],'full',ci,end,n]] : []);}
async function snapshotBudget() {
  // Preserve the reviewer's occupied-class fixture and exact result vector.
  for (const nights of [30,4,6]) {
    const end = new Date(ci); end.setUTCDate(end.getUTCDate()+nights);
    const co = end.toISOString().slice(0,10);
    const db = database([booking(1,ci,co)],[],1000);
    const before = structuredClone(db.storage);
    const actual = await loader(db).load('backend/search.web').searchAvailability(ci,co);
    assert.equal(actual.ok,true);
    assert.deepEqual(actual.results.map(r=>[r.roomCode,r.status,r.maxQty,r.availableNights]),
      [[codes[1],'full',1,nights],[codes[2],'full',3,nights]]);
    assert.deepEqual(db.storage,before); assert.equal(db.writes,0);
    console.log(JSON.stringify({probeNights:nights,candidateWindows:(nights-3)*(nights-2)/2,inventoryReads:db.trace.length,fixedReads:2}));
    assert.equal(db.trace.length,2,'one complete inventory traversal per Search, not per candidate window');
    for (const collection of ['Bookings','BookingSummary']) assert.equal(db.trace.filter(r=>r.collection===collection).length,1);
    pass('S01-reviewer-budget-'+nights);
  }
}
async function snapshotSemantics() {
  // Page count, not subwindow count: six retained Booking pages plus three
  // Summary pages. Exact fallback compatibility is compared below.
  for (const width of [1,2,1000]) {
    const end='2027-12-05';
    const rows=[booking(1,ci,end),...Array.from({length:5},(_,i)=>booking(2,'2028-01-01','2028-01-05',{_id:'old-'+i,status:'cancelled'}))];
    const summaries=Array.from({length:3},(_,i)=>({bookingNumber:'unused-'+i,checkIn:ci,checkOut:end}));
    const db=database(rows,summaries,width); const before=structuredClone(db.storage);
    const search=loader(db).load('backend/search.web').searchAvailability;
    const result=await search(ci,end);
    assert.equal(result.ok,true); assert.deepEqual(result.results.map(r=>r.roomCode),codes.slice(1));
    assert.equal(db.trace.length,Math.ceil(rows.length/width)+Math.ceil(summaries.length/width));
    assert.deepEqual(db.storage,before); assert.equal(db.writes,0);
    pass('S02-paged-budget-'+width);
  }
  {
    const db=database([booking()],[],1); const search=loader(db).load('backend/search.web').searchAvailability;
    const before=structuredClone(db.storage);
    const first=await search(ci,co); assert.equal(first.ok,true); assert.deepEqual(first.results.map(r=>r.roomCode),codes.slice(1));
    assert.deepEqual(db.storage,before); assert.equal(db.trace.length,2);
    db.storage.Bookings=[]; const nextBefore=structuredClone(db.storage);
    const second=await search(ci,co); assert.equal(second.ok,true); assert.deepEqual(second.results.map(r=>r.roomCode),codes);
    assert.equal(db.trace.length,4); assert.deepEqual(db.storage,nextBefore); assert.equal(db.writes,0);
    pass('S03-second-request-fresh');
  }
  // Compare exact detached subwindows to the unchanged actual one-shot reader,
  // not to nightly-count arithmetic. Fixtures cover quantity topology, varying
  // owner capacity, continuous units, manual/automatic blocks and Summary dates.
  const end='2027-11-15';
  const histories=[
    [booking(3,ci,'2027-11-10'),booking(4,'2027-11-10',end)],
    [booking(1,ci,'2027-11-10'),booking(2,'2027-11-10',end)],
    [booking(5,ci,end)],
    [booking(1,ci,'2027-11-07',{status:'Blocked'}),booking(2,ci,end,{autoOwnerBlock:true})],
    [booking(1,null,null)]
  ];
  for (let h=0;h<histories.length;h++) {
    const summaries=[{bookingNumber:'booking-1',checkIn:ci,checkOut:'2027-11-07'}];
    const db=database(histories[h],summaries,1); const before=structuredClone(db.storage);
    const api=loader(db).load('backend/roomAvailability');
    const read=await api.loadRoomAvailabilityWindowReader(new Date(ci),new Date(end));
    const reads=db.trace.length;
    const oracle=database(structuredClone(histories[h]),structuredClone(summaries),1);
    const oracleBefore=structuredClone(oracle.storage);
    const oneShot=loader(oracle).load('backend/roomAvailability').loadRoomAvailability;
    for(let length=4;length<=10;length++) for(let start=0;start+length<=10;start++) {
      const a=new Date(ci);a.setUTCDate(a.getUTCDate()+start);const b=new Date(a);b.setUTCDate(b.getUTCDate()+length);
      assert.deepEqual(read(a,b),await oneShot(a,b));
    }
    assert.equal(db.trace.length,reads); assert.deepEqual(db.storage,before);assert.equal(db.writes,0);
    assert.deepEqual(oracle.storage,oracleBefore);assert.equal(oracle.writes,0);
    const returned=read(new Date(ci),new Date(end));returned[0].maxQuantity=99;
    assert.notEqual(read(new Date(ci),new Date(end))[0].maxQuantity,99);
    assert.throws(()=>read(new Date('2027-11-04'),new Date(end)),/Invalid inventory window/);
    assert.throws(()=>read(new Date(ci),new Date('2027-11-16')),/Invalid inventory window/);
    assert.throws(()=>read(new Date(co),new Date(ci)),/Invalid inventory window/);
    assert.throws(()=>read(new Date('bad'),new Date(end)),/Invalid inventory window/);
    // Fixture change is visible to a new request, never to this retained reader.
    db.storage.Bookings.push(booking(1,'2028-01-01','2028-01-05',{_id:'bad',status:'unknown'}));
    assert.deepEqual(read(new Date(ci),new Date(end)),await oneShot(new Date(ci),new Date(end)));
    await assert.rejects(()=>api.loadRoomAvailabilityWindowReader(new Date(ci),new Date(end)),/Inventory status review required/);
    pass('S04-exact-window-equivalence-'+h);
  }
  await check('S05-earliest-equal-partial',[booking(1,'2027-11-09','2027-11-11')],[],
    [[codes[0],1,'partial',ci,'2027-11-09',4],...full([0,1,3],'2027-11-15',10)],'2027-11-15');
  await check('S06-partial-suite-quantity',[booking(3,ci,'2027-11-07'),booking(4,ci,'2027-11-07')],[],
    [...full([1,1,0],'2027-11-11',6),[codes[2],3,'partial','2027-11-07','2027-11-11',4]],'2027-11-11');
  await check('S07-global-error-no-partial',[booking(1,ci,'2027-11-07'),booking(2,'2028-01-01','2028-01-05',{quantity:2})],[],null,'2027-11-11');
  await check('S08-full-conflict-no-partial',[booking(1,ci,'2027-11-07'),booking(1,ci,'2027-11-07',{_id:'duplicate'})],[],null,'2027-11-11');
}
async function dateFallbackContract() {
  await check('B18-canonical-host-independent',[],[],full([1,1,3]));
  const summary={bookingNumber:'booking-1',checkIn:ci,checkOut:co};
  for(const [label,missing] of [['null',null],['undefined',undefined],['empty','']]) {
    await check('B08-both-missing-unique-'+label,[booking(1,ci,co,{checkIn:missing,checkOut:missing})],[summary],full([0,1,3]));
    await check('B08-only-checkOut-missing-'+label,[booking(1,ci,co,{checkOut:missing})],[summary],null);
    await check('B08-only-checkIn-missing-'+label,[booking(1,ci,co,{checkIn:missing})],[summary],null);
  }
  for(const [label,other] of [['identical',{...summary}],['conflicting',{...summary,checkIn:'2027-12-05',checkOut:'2027-12-09'}],['incomplete',{bookingNumber:'booking-1'}]]) {
    for(const reverse of [false,true]) {
      const summaries=reverse?[other,summary]:[summary,other];
      await check('B08-duplicate-'+label+'-'+reverse,[booking(1,null,null)],summaries,null);
      await check('B08-direct-wins-'+label+'-'+reverse,[booking()],summaries,full([0,1,3]));
    }
  }
  await check('B08-no-fallback-deny',[booking(1,null,null)],[],null);
  await check('B08-invalid-unique-fallback-deny',[booking(1,null,null)],[{...summary,checkIn:'bad'}],null);
  await check('B08-invalid-direct-no-repair',[booking(1,'bad',co)],[summary],null);
  await check('B08-reversed-direct-no-repair',[booking(1,co,ci)],[summary],null);
  for(const [label,start,end] of [
    ['SDK-midnight',new Date(ci),new Date(co)],
    ['SDK-UTCnoon',new Date(ci+'T12:00:00.000Z'),new Date(co+'T12:00:00.000Z')],
    ['offset-UTC-crossing','2027-11-06T00:00:00+14:00','2027-11-10T00:00:00+14:00'],
    ['SDK-offset-UTC-crossing',new Date('2027-11-06T00:00:00+14:00'),new Date('2027-11-10T00:00:00+14:00')]
  ]) {
    // Verify native Date identity at the SDK response boundary, not JSON fixtures.
    if(start instanceof Date) {
      const db=database([booking(1,start,end)]); const page=await db.sdk.query('Bookings').find({});
      assert.ok(page.items[0].checkIn instanceof Date); assert.equal(page.items[0].checkIn.getTime(),start.getTime());
    }
    await check('B18-occupancy-'+label,[booking(1,start,end)],[],full([0,1,3]));
    await check('B18-fallback-'+label,[booking(1,null,null)],[{...summary,checkIn:start,checkOut:end}],full([0,1,3]));
  }
  for(const [label,start,end] of [
    ['canonical-checkout','2027-11-01',ci],['canonical-checkin',co,'2027-11-13'],
    ['SDK-noon-checkout',new Date('2027-11-01T12:00:00Z'),new Date(ci+'T12:00:00Z')],
    ['offset-checkout','2027-11-02T00:00:00+14:00','2027-11-06T00:00:00+14:00']
  ]) await check('B18-exclusive-'+label,[booking(1,start,end)],[],full([1,1,3]));
  // Source-extracted parseDate only; no page initialization/package/tracking code.
  const pageSource=fs.readFileSync(path.resolve(__dirname,'../velo/page-booking-search.js'),'utf8');
  assert.ok(pageSource.includes('const res = await searchAvailability(pickerCalendarDate(ciDate), pickerCalendarDate(coDate));'));
  const parseSource=pageSource.match(/function parseDate\(v\) \{[\s\S]*?\n\}/)[0];
  const parse=vm.compileFunction(parseSource+'; return parseDate;',[])();
  for(const [label,start,end] of [
    ['canonical',ci,co],['SDK-noon',new Date(ci+'T12:00:00Z'),new Date(co+'T12:00:00Z')],
    ['picker-local',new Date(2027,10,5),new Date(2027,10,9)]
  ]) {
    const a=parse(start), b=parse(end);
    if(start instanceof Date) assert.equal(a,start);
    // Documented JSON transport model, not actual Wix RPC execution.
    const args=JSON.parse(JSON.stringify([a,b]));
    assert.equal(typeof args[0],'string'); assert.equal(args[0],a.toISOString());
    const db=database([booking(1,new Date(ci+'T12:00:00Z'),new Date(co+'T12:00:00Z'))]);
    const before=structuredClone(db.storage);
    const result=await loader(db).load('backend/search.web').searchAvailability(...args);
    assert.equal(result.ok,true);
    assert.deepEqual(result.results.map(r=>[r.roomCode,r.maxQty,r.status,r.availableCheckIn.slice(0,10),r.availableCheckOut.slice(0,10),r.availableNights]),full([0,1,3]));
    assert.deepEqual(db.storage,before);assert.equal(db.writes,0);assert.equal(db.trace.length,2);
    console.log(JSON.stringify({representation:label,timezone:process.env.TZ,args})); pass('B18-page-parse-JSON-model-'+label);
  }
  for(const [label,extra] of [['unit',{assignedRoom:null}],['quantity',{quantity:2}],['status',{status:'unknown'}]])
    await check('B08-fallback-strict-'+label,[booking(1,null,null,extra)],[summary],null);
}
async function alternateLabelContract() {
  assert.ok(['UTC','America/New_York','Pacific/Kiritimati'].includes(process.env.TZ));
  // Canonical backend dates, not browser picker transport or CMS provenance.
  const vectors = [
    ['fall-DST','2027-11-05','2027-11-09','2027-11-06'],
    ['spring-DST','2027-03-12','2027-03-16','2027-03-13'],
    ['year-rollover','2027-12-30','2028-01-03','2027-12-31']
  ];
  const label = iso => { const [y,m,d] = iso.slice(0,10).split('-'); return Number(m)+'/'+Number(d)+'/'+y; };
  for (const [id,start,end,first] of vectors) {
    const db=database(); const before=structuredClone(db.storage); const l=loader(db);
    const result=await l.load('backend/search.web').suggestAlternateDates(start,end);
    assert.equal(result.ok,true); assert.equal(result.nights,4); assert.equal(result.suggestions.length,3);
    assert.equal(result.suggestions[0].checkIn,first+'T00:00:00.000Z');
    assert.equal(l.cache.size,7); assert.deepEqual(db.storage,before); assert.equal(db.writes,0);
    assert.equal(db.trace.length,6,'three successful windows, one inventory traversal each');
    for (const collection of ['Bookings','BookingSummary']) assert.equal(db.trace.filter(r=>r.collection===collection).length,3);
    for (let i=0;i<result.suggestions.length;i++) {
      const row=result.suggestions[i];
      assert.equal(Date.parse(row.checkIn),Date.parse(first)+i*86400000);
      assert.equal(Date.parse(row.checkOut)-Date.parse(row.checkIn),4*86400000);
      assert.match(row.checkIn,/T00:00:00\.000Z$/); assert.match(row.checkOut,/T00:00:00\.000Z$/);
      console.log(JSON.stringify({alternateVector:id,timezone:process.env.TZ,row}));
      assert.equal(row.checkInLabel,label(row.checkIn),id+' checkIn label must match returned calendar date');
      assert.equal(row.checkOutLabel,label(row.checkOut),id+' checkOut label must match returned calendar date');
      assert.equal(row.label,'('+label(row.checkIn)+' – '+label(row.checkOut)+')');
    }
    pass('ALT-label-'+id);
  }
}
async function main() {
  await controls(); if (process.argv[2] === 'controls') return;
  if (process.argv[2] === 'alternate-label') { await alternateLabelContract(); assert.equal(passed.length,4); return; }
  if (process.argv[2] === 'date-fallback') { await dateFallbackContract(); return; }
  if (process.argv[2] === 'date-canonical') {
    await check('B18-canonical-host-independent',[],[],full([1,1,3])); return;
  }
  if (process.argv[2] === 'fallback-partial') {
    await check('B08-one-direct-missing-deny',[booking(1,ci,null)],[{bookingNumber:'booking-1',checkIn:ci,checkOut:co}],null); return;
  }
  if (process.argv[2] === 'fallback-duplicate') {
    const summary={bookingNumber:'booking-1',checkIn:ci,checkOut:co};
    await check('B08-duplicate-identical-deny',[booking(1,null,null)],[summary,{...summary}],null); return;
  }
  if (process.argv[2] === 'date-dst') {
    const db=database(); const before=structuredClone(db.storage);
    const result=await loader(db).load('backend/search.web').searchAvailability('2027-03-12','2027-03-18');
    assert.equal(result.ok,true);
    for(const row of result.results) {
      assert.equal(row.availableCheckIn,'2027-03-12T00:00:00.000Z');
      assert.equal(row.availableCheckOut,'2027-03-18T00:00:00.000Z');
    }
    assert.deepEqual(db.storage,before); assert.equal(db.writes,0); pass('B18-DST-exact-UTC-window');
    const partialDb=database([booking(1,'2027-03-12','2027-03-14')]);
    const partialBefore=structuredClone(partialDb.storage);
    const partial=await loader(partialDb).load('backend/search.web').searchAvailability('2027-03-12','2027-03-18');
    assert.equal(partial.ok,true); const row=partial.results.find(r=>r.roomCode===codes[0]);
    assert.ok(row,'DST partial must be present'); assert.equal(row.status,'partial');
    assert.equal(row.availableCheckIn,'2027-03-14T00:00:00.000Z');
    assert.equal(row.availableCheckOut,'2027-03-18T00:00:00.000Z'); assert.equal(row.availableNights,4);
    assert.deepEqual(partialDb.storage,partialBefore);assert.equal(partialDb.writes,0);
    pass('B18-DST-partial-exact-UTC-window'); return;
  }
  if (process.argv[2] === 'snapshot') { await snapshotBudget(); await snapshotSemantics(); return; }
  if (process.argv[2] === 'red') {
    await check('B07-staleSummary-free-fixed-class',[booking(1,'2027-12-05','2027-12-09')],[{bookingNumber:'booking-1',checkIn:ci,checkOut:co}],full([1,1,3])); return;
  }
  assert.equal(process.argv[2], 'focus');
  await check('B01-empty',[],[],full([1,1,3]));
  for (const [label,summary] of [['missing',[]],['empty',[{bookingNumber:'booking-1'}]],['malformed',[{bookingNumber:'booking-1',checkIn:'bad',checkOut:'bad'}]],['stale',[{bookingNumber:'booking-1',checkIn:'2027-12-05',checkOut:'2027-12-09'}]]]) {
    await check('B02-B07-'+label,[booking()],summary,full([0,1,3]));
  }
  await check('B03-no-summary',[booking(3)],[],full([1,1,1]));
  await check('B03-B07-stale',[booking(3)],[{bookingNumber:'booking-3',checkIn:'2027-12-05',checkOut:'2027-12-09'}],full([1,1,1]));
  await check('B07-staleSummary-free-fixed-class',[booking(1,'2027-12-05','2027-12-09')],[{bookingNumber:'booking-1',checkIn:ci,checkOut:co}],full([1,1,3]));
  const paged = await check('B14-continuous-unit',[booking(3,ci,'2027-11-07'),booking(4,'2027-11-07',co)],[],full([1,1,0]));
  assert.ok(paged.trace.some(r => r.collection==='Bookings' && r.offset===1 && r.options.consistentRead===true));
  await check('B02-native-Date',[booking(1,new Date(ci),new Date(co))],[],full([0,1,3]));
  await check('B16-partial',[booking(1,ci,'2027-11-07')],[],[[codes[0],1,'partial','2027-11-07','2027-11-11',4],...full([0,1,3],'2027-11-11',6)],'2027-11-11');
  for (const [label,extra] of [['unassigned',{assignedRoom:null}],['aggregate',{quantity:2}],['unknown-status',{status:'unknown'}],['string-quantity',{quantity:'1'}]]) await check('strict-'+label,[booking(1,ci,co,extra)],[],null);
  await check('manual-block',[booking(1,ci,co,{status:' Blocked ',autoOwnerBlock:false})],[],full([0,1,3]));
  for (const fault of ['throw','malformed']) await check('paging-'+fault,[booking(1),booking(2)],[],null,co,fault);
}
main().then(() => console.log(JSON.stringify({completed:passed.length,ids:passed}))).catch(error => {console.error(error); console.error(JSON.stringify({completed:passed.length,ids:passed})); process.exitCode=1;});
