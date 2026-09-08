const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cp = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sourcePath = 'velo/backend/search.web.js';
const baseline = cp.execFileSync('git', ['show', 'a07b213071355c9224a90d2d706ea3dd8944f64a:' + sourcePath], {cwd: root, encoding:'utf8'});
const candidate = fs.readFileSync(path.join(root, sourcePath), 'utf8');
const marker = '[WBE-SEARCH-DIAG-legacy-a07b213-v1]';
function load(source, options = {}) {
  const logs = [], queries = [];
  const wixData = {query(collection) {
    const trace = [collection]; queries.push(trace);
    const q = {};
    for (const method of ['le','ge','limit']) q[method] = (...args) => {trace.push([method,...args.map(x => x instanceof Date ? x.toISOString() : x)]); return q;};
    q.find = async (...args) => {
      assert.equal(args.length,1);
      assert.deepEqual(Object.keys(args[0]),['suppressAuth']);
      assert.equal(args[0].suppressAuth,true);
      trace.push(['find', {suppressAuth:args[0].suppressAuth}]);
      if (options.fail === collection) throw options.error;
      return options.responses?.[collection] || {items: []};
    };
    return q;
  }};
  const context = vm.createContext({wixData, Date, ROOM_UNITS:{suite:3}, Permissions:{Anyone:'anyone'}, webMethod:(permission, fn) => {assert.equal(permission,'anyone'); return (...args) => fn(...args);}, console:{log:(...args) => {if(options.consoleThrows) throw options.error; logs.push(args);}, error:(...args) => {if(options.consoleThrows) throw options.error; logs.push(args);}}});
  const imports = source.match(/^import .*;$/gm);
  assert.deepEqual(imports, baseline.match(/^import .*;$/gm));
  vm.runInContext(source.replace(/^import .*;$/gm,'').replace(/export const /g,'const ') + '\nthis.api = {searchAvailability,suggestAlternateDates};',context,{timeout:1000});
  return {api:context.api,logs,queries};
}
const stages = run => run.logs.filter(x=>x[0]===marker).map(x=>x[1]);
const plain = x => JSON.parse(JSON.stringify(x));
async function main() {
  const run=load(candidate);
  await run.api.searchAvailability('2026-10-01','2026-10-08');
  assert.ok(stages(run).includes('entry'), 'missing diagnostic entry/build marker');
  const successStages = ['entry','HotelClosures:start','HotelClosures:ok','Rooms:start','Rooms:ok','Bookings:start','Bookings:ok','BookingSummary:start','BookingSummary:ok','processing:start','processing:ok'];
  assert.deepEqual(stages(run),successStages);
  const fixtures = [
    {},
    {responses:{Rooms:{items:[{roomCode:'suite',name:'GUEST_SECRET',mainPhoto:'wix:image://v1/media/file'}]},Bookings:{items:[{roomCode:'suite',bookingNumber:'GUEST_SECRET',quantity:1}]},BookingSummary:{items:[{bookingNumber:'GUEST_SECRET',checkIn:'2026-10-01',checkOut:'2026-10-08'}]}}},
    {responses:{HotelClosures:{items:[{startDate:'2026-10-01',endDate:'2026-10-08',reason:'GUEST_SECRET'}]}}},
    {responses:{Rooms:{items:[{roomCode:'suite',minNightsAllowed:10},{roomCode:'suite',units:3},{roomCode:'suite',units:2}]}}}
  ];
  for (const options of fixtures) {
    const a=load(baseline,options),b=load(candidate,options);
    assert.deepEqual(plain(await b.api.searchAvailability('2026-10-01','2026-10-08')),plain(await a.api.searchAvailability('2026-10-01','2026-10-08')));
    assert.deepEqual(b.queries,a.queries);
    assert.ok(!JSON.stringify(b.logs).includes('GUEST_SECRET'));
    if(options.responses?.HotelClosures) assert.deepEqual(stages(b),['entry','HotelClosures:start','HotelClosures:ok','closure:blocked']);
  }
  for(const collection of ['HotelClosures','Rooms','Bookings','BookingSummary']) {
    let getters=0;
    const error={message:'GUEST_SECRET',code:'GUEST_SECRET'};
    Object.defineProperty(error,'name',{get(){getters++;throw Error('getter');}});
    const options={fail:collection,error};
    const a=load(baseline,options),b=load(candidate,options);
    if(collection==='HotelClosures') assert.deepEqual(plain(await b.api.searchAvailability('2026-10-01','2026-10-08')),plain(await a.api.searchAvailability('2026-10-01','2026-10-08')));
    else for(const loaded of [a,b]) await assert.rejects(loaded.api.searchAvailability('2026-10-01','2026-10-08'),e=>e===error);
    assert.deepEqual(b.queries,a.queries);
    assert.ok(stages(b).includes(collection+':failed'));
    assert.equal(getters,0);
    assert.ok(!JSON.stringify(b.logs).includes('GUEST_SECRET'));
  }
  // Documented Wix codes, injected into the actual module; not captured live errors.
  // https://dev.wix.com/docs/velo/apis/wix-data/error-codes
  let classifierGetters=0;
  const accessorError=new Error('GUEST_SECRET');
  for(const key of ['code','message','stack']) Object.defineProperty(accessorError,key,{get(){classifierGetters++;throw Error('getter');}});
  const classifiedErrors=[
    [Object.assign(new Error('The current user does not have permissions to read on the Bookings collection.'),{code:'WDE0027'}),'permission'],
    [Object.assign(new Error('Validation error. GUEST_SECRET'),{code:'WDE0076'}),'validation'],
    [Object.assign(new Error('Invalid limit parameter -1. limit parameter must be a positive number.'),{code:'WDE0033'}),'validation'],
    [Object.assign(new Error('GUEST_SECRET permission validation WDE0027'),{code:'GUEST_SECRET'}),'unclassified'],
    [Object.assign(new Error('Operation time limit exceeded.'),{code:'WDE0028'}),'unclassified'],
    [Object.create({code:'WDE0027',message:'GUEST_SECRET'}),'unclassified'],
    [accessorError,'unclassified']
  ];
  for(const [error,classification] of classifiedErrors) {
    const a=load(baseline,{fail:'Bookings',error}),b=load(candidate,{fail:'Bookings',error});
    for(const loaded of [a,b]) await assert.rejects(loaded.api.searchAvailability('2026-10-01','2026-10-08'),e=>e===error);
    assert.deepEqual(b.queries,a.queries);
    const details=b.logs.find(x=>x[0]===marker && x[1]==='Bookings:failed')[2];
    assert.equal(details.classification,classification);
    assert.ok(!JSON.stringify(b.logs).includes('GUEST_SECRET'));
    assert.ok(!JSON.stringify(b.logs).includes('WDE0027'));
  }
  assert.equal(classifierGetters,0);
  const error={message:'GUEST_SECRET'};
  const broken={};Object.defineProperty(broken,'roomCode',{get(){throw error;}});
  const fail=load(candidate,{responses:{Rooms:{items:[broken]}}});
  await assert.rejects(fail.api.searchAvailability('2026-10-01','2026-10-08'),e=>e===error);
  assert.ok(stages(fail).includes('processing:failed'));
  const throwing=load(candidate,{consoleThrows:true,error});
  assert.equal((await throwing.api.searchAvailability('2026-10-01','2026-10-08')).ok,true);
  for(const dates of [['2026-10-08','2026-10-01'],['2026-10-01','2026-10-02']]) {
    const a=load(baseline),b=load(candidate);
    assert.deepEqual(plain(await a.api.searchAvailability(...dates)),plain(await b.api.searchAvailability(...dates)));
    assert.deepEqual(b.queries,[]);
  }
  const a=load(baseline),b=load(candidate);
  assert.deepEqual(plain(await a.api.suggestAlternateDates('2026-10-01','2026-10-08')),plain(await b.api.suggestAlternateDates('2026-10-01','2026-10-08')));
  assert.deepEqual(b.queries,a.queries);
  console.log('PASS entry/build; exact stages; 4 fixture parity; 4 read failures; own-accessor privacy; processing original throw; console containment; 2 validation returns; alternate-date parity; no network/writes');
}
const watchdog=setTimeout(()=>{console.error('FAIL watchdog');process.exit(1);},10000);
main().then(()=>clearTimeout(watchdog),error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
