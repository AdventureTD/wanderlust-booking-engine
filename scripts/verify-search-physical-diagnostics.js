// Actual committed/candidate modules; inert SDK only. No live IO.
process.env.TZ = 'UTC';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const baseline = '2039faee1b6f0773fd6fe48d744f1dd3edda8c6b';
const files = ['search.web', 'roomAvailability', 'roomAvailabilityRules', 'roomInventory', 'roomInventoryRules', 'roomAssignmentRules', 'wbeConfig'];
const originals = Object.fromEntries(files.map(name => [name, cp.execFileSync('git', ['show', `${baseline}:velo/backend/${name}.js`], {cwd: root}).toString('utf8')]));
const baselinePins = {
  'search.web':'71b5a62c279b45a9db04feb8d6a91826490a72c9e43ec944352c71ae39c34aec',
  roomAvailability:'e025929694d0f0982c517e43409fb921ccca3269a68fc6bd949920bc2c523807',
  roomAvailabilityRules:'578b42bcc63c28720b9a08aae9dea42761a42febcfc62449efe5313a7164b6f4',
  roomInventory:'675bc376151986acf54f104890a358ef52b8f66418afd530aaa83248c4204fc2',
  roomInventoryRules:'6bc0520cb3940b0399f43d8f5df7b493c666f221621bb80bc3e7004c8de89899',
  roomAssignmentRules:'9d685cc29821181e482c84cf1d9ecf0fd463fc03dbf12617d3fcfb76e9dd46b2',
  wbeConfig:'ab2605869199c1d586dad2643f1f838abda1f6f3d1d18cc4ac4d0743edce70f2'
};
for (const name of files) assert.equal(crypto.createHash('sha256').update(originals[name]).digest('hex'), baselinePins[name], 'raw committed baseline pin ' + name);
const candidates = Object.fromEntries(files.map(name => [name, fs.readFileSync(path.join(root, 'velo/backend', name + '.js'), 'utf8')]));
const build = '[WBE-SEARCH-PHYSICAL-DIAG-1]';
function runtime(sources, setup = '', logMode = '', seam = '') {
  const logs = [], trace = [];
  const context = vm.createContext({trace, console: {log(...args) {logs.push(args); if (logMode === 'throw') throw new Error('LOG_PRIVATE');}}});
  if (logMode === 'getter') Object.defineProperty(context.console, 'log', {get() {throw new Error('LOG_PRIVATE');}});
  vm.runInContext(`
    var db = {Bookings: [], BookingSummary: [], Rooms: [{roomCode:'adventure_suite'}], HotelClosures: []};
    var fail = null, reads = {}, errorValue = {message:'GUEST_PRIVATE', code:'GUEST_PRIVATE'};
    var pageOverride = null;
    var wixData = {query(collection) {
      trace.push(['query', collection]);
      const steps = [];
      return {
        le(...a) {steps.push(['le', ...a]); return this;},
        ge(...a) {steps.push(['ge', ...a]); return this;},
        limit(...a) {steps.push(['limit', ...a]); return this;},
        async find(options) {
          reads[collection] = (reads[collection] || 0) + 1;
          trace.push(['find', collection, steps, options]);
          if (fail) fail(collection, reads[collection], options);
          if (pageOverride) {const p = pageOverride(collection, options); if (p !== undefined) return p;}
          return {items:db[collection], hasNext() {trace.push(['hasNext', collection]); return false;}};
        }
      };
    }};
    var Permissions = {Anyone:'Anyone'};
    function webMethod(permission, fn) {const wrap = (...args) => fn(...args); wrap.permission = permission; return wrap;}
    var modules = {};
    ${setup}
  `, context);
  const cache = {};
  function load(name) {
    assert.ok(files.includes(name), 'closed module graph');
    if (cache[name]) return cache[name];
    const exports = [...sources[name].matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map(m => m[1]);
    let source = sources[name].replace(/^import (.+) from '([^']+)';$/gm, (_, binding, spec) => {
      if (spec === 'wix-data') return '';
      if (spec === 'wix-web-module') return '';
      assert.ok(spec.startsWith('backend/'), 'backend imports only');
      const target = spec.slice(8); load(target);
      return `const ${binding} = modules[${JSON.stringify(target)}];`;
    }).replace(/export /g, '');
    if (name === 'search.web' && seam) vm.runInContext(seam, context);
    context.modules[name] = vm.runInContext(`(() => {${source}\nreturn {${exports.join(',')}};})()`, context, {filename: name + '.js'});
    return cache[name] = context.modules[name];
  }
  return {context, logs, trace, load, run(code) {return vm.runInContext(code, context);}};
}
const cases = [];
function test(id, setup, expression, markers = [], options = {}) {cases.push({id, setup, expression, markers, options});}
function normalized(value) {return JSON.stringify(value);}
async function outcome(r, expression) {
  try {return {result: await r.run(expression)};} catch(error) {return {error, identity: error === r.context.errorValue};}
}
async function check(c) {
  const a = runtime(originals, c.setup, c.options.baselineLogMode || '', c.options.seam), b = runtime(candidates, c.setup, c.options.logMode, c.options.seam);
  a.load(c.options.module || 'search.web'); b.load(c.options.module || 'search.web');
  const x = await outcome(a, c.expression), y = await outcome(b, c.expression);
  if (c.options.suppressionException) {
    assert.ok(Object.hasOwn(x,'error'), c.id + ': old identifying log threw');
    assert.equal(y.result.ok,true, c.id + ': intentional exception suppression');
    assert.match(x.error.message, /PRIVATE/);
  } else if (Object.hasOwn(x, 'error') || Object.hasOwn(y, 'error')) {
    assert.ok(Object.hasOwn(x, 'error') && Object.hasOwn(y, 'error'), c.id + ': both throw');
    assert.equal(x.identity, y.identity, c.id + ': thrown identity');
    if (!x.identity) assert.equal(x.error.message, y.error.message, c.id + ': fixed error');
  } else assert.equal(normalized(x.result), normalized(y.result), c.id + ': response parity');
  assert.equal(normalized(a.trace), normalized(b.trace), c.id + ': exact ordered IO');
  for (const marker of c.markers) assert.ok(b.logs.some(args => args[0] === build && args[1] === marker), c.id + ': missing ' + marker);
  for (const args of b.logs) {
    assert.equal(args[0], build, c.id + ': only diagnostic logs');
    assert.equal(args.length, 2, c.id + ': literal-only envelope');
    assert.match(args[1], /^[a-z_]+$/);
  }
  assert.ok(!normalized(b.logs).includes('PRIVATE'), c.id + ': privacy');
  if (c.options.verify) c.options.verify(a, b, x, y);
  console.log('PASS ' + c.id);
}
const search = `modules['search.web'].searchAvailability('2027-06-01', '2027-06-09')`;
const inventory = `modules.roomInventory.loadInventorySnapshot('2027-06-01', '2027-06-09')`;
test('reader-bookings-failure', `fail = (c) => {if(c === 'Bookings') throw errorValue;};`, inventory, ['bookings_read_failed'], {module:'roomInventory', verify(a,b,x,y) {assert.equal(x.identity,true); assert.equal(y.identity,true);}});
test('reader-summaries-failure', `fail = c => {if(c === 'BookingSummary') throw errorValue;};`, inventory, ['summaries_read_failed'], {module:'roomInventory'});
for (const [id, page] of Object.entries({null:'null', items:'{items:null}', hasNext:'{items:[]}', next:'{items:[],hasNext(){return true;}}'})) {
  test('reader-paging-' + id, `pageOverride = (c) => c === 'Bookings' ? ${page} : undefined;`, inventory, ['paging_shape_invalid','bookings_read_failed'], {module:'roomInventory'});
}
test('reader-invalid-dates', '', `modules.roomInventory.loadInventorySnapshot('bad', 'bad')`, ['request_dates_invalid'], {module:'roomInventory'});
test('reader-resolution-failure', `db.Bookings = [{get bookingNumber(){throw errorValue;}}];`, inventory, ['date_resolution_failed'], {module:'roomInventory'});
test('reader-snapshot-failure', `db.Bookings = [{status:{toString(){throw errorValue;}}}];`, inventory, ['snapshot_build_failed'], {module:'roomInventory'});
const validSnapshot = `({occupiedUnits:[], occupiedUnitsByNight:{'2027-06-01':[]}, migrationIssueRows:[], duplicateUnitClaims:[], unknownStatusRows:[]})`;
for (const [id, mutate, marker] of [
  ['invalid', 'snapshot = null;', 'snapshot_invalid'],
  ['migration', 'snapshot.migrationIssueRows.push({guest:"PRIVATE"});', 'inventory_migration_required'],
  ['conflict', 'snapshot.duplicateUnitClaims.push({guest:"PRIVATE"});', 'inventory_conflict_review_required'],
  ['status', 'snapshot.unknownStatusRows.push({guest:"PRIVATE"});', 'inventory_status_review_required']
]) test('rules-' + id, `var snapshot = ${validSnapshot}; ${mutate}`, `modules.roomAvailabilityRules.evaluateAutomaticAvailability(snapshot, 'adventure_suite', 1)`, [marker], {module:'roomAvailabilityRules'});
const physicalBooking = `{_id:'ROW_PRIVATE',bookingNumber:'BOOKING_PRIVATE',roomCode:'penthouse_apartment',quantity:1,assignedRoom:1,status:'confirmed',checkIn:'2027-06-01',checkOut:'2027-06-03'}`;
const partialSetup = `db.Rooms = [{roomCode:'penthouse_apartment'}]; db.Bookings = [${physicalBooking}]; db.BookingSummary = [{bookingNumber:'BOOKING_PRIVATE',checkIn:'2027-06-01',checkOut:'2027-06-03'}];`;
test('search-initial', `fail = c => {if(c === 'Bookings') throw errorValue;};`, search, ['coordinator_unknown_failure','initial_physical_failed']);
test('search-partial', partialSetup + `fail = (c,n,o) => {if(c === 'Bookings' && o.consistentRead && n === 3) throw errorValue;};`, search, ['coordinator_unknown_failure','partial_physical_failed']);
test('search-duplicate', `db.Rooms.push({roomCode:'adventure_suite'});`, search, ['duplicate_room_code']);
test('search-dto-seam', '', search, ['physical_dto_invalid','initial_physical_failed'], {seam:`modules.roomAvailability.loadRoomAvailability = async () => [];`});
test('search-debug-suppressed', partialSetup, search, [], {verify(a,b,x,y) {assert.ok(a.logs.some(args => normalized(args).includes('BOOKING_PRIVATE'))); assert.equal(b.logs.length,0); assert.equal(y.result.results[0].status,'partial');}});
test('graph-success', '', search, [], {verify(a,b,x,y) {assert.equal(y.result.ok,true); assert.equal(y.result.results[0].maxQty,3); assert.equal(b.load('search.web').searchAvailability.permission,'Anyone');}});
test('graph-occupied-cap', `db.Bookings = [${physicalBooking}]; db.Bookings[0].assignedRoom=3; db.Bookings[0].roomCode='adventure_suite'; db.Bookings[0].checkOut='2027-06-09';`, search, [], {verify(a,b,x,y) {assert.equal(y.result.results[0].maxQty,1);}});
for (const [id, setup, marker] of [
  ['migration', `db.Bookings = [${physicalBooking}]; delete db.Bookings[0].assignedRoom;`, 'inventory_migration_required'],
  ['status', `db.Bookings = [${physicalBooking}]; db.Bookings[0].status='PRIVATE';`, 'inventory_status_review_required'],
  ['conflict', `db.Bookings = [${physicalBooking},${physicalBooking}];`, 'inventory_conflict_review_required'],
  ['outside-window-migration', `db.Bookings = [${physicalBooking}]; db.Bookings[0].checkIn='2026-01-01'; db.Bookings[0].checkOut='2026-01-02'; delete db.Bookings[0].assignedRoom;`, 'inventory_migration_required'],
  ['precedence', `db.Bookings = [${physicalBooking},${physicalBooking},{status:'PRIVATE'}]; db.Bookings[0].quantity=2;`, 'inventory_migration_required']
]) test('graph-' + id, setup, search, [marker,'initial_physical_failed'], {verify(a,b,x,y) {assert.equal(y.result.ok,false); assert.equal(b.logs.filter(args => args[1].startsWith('inventory_')).length,1);}});
for (const c of ['Bookings','BookingSummary','Rooms']) test('legacy-read-rethrow-' + c, `fail = (c,n,o) => {if(c === '${c}' && !o.consistentRead) throw errorValue;};`, search, [], {verify(a,b,x,y) {assert.equal(x.identity,true); assert.equal(y.identity,true);}});
for (const c of ['Bookings','BookingSummary']) {
  test('reader-next-rethrow-' + c, `pageOverride = (c,o) => c === '${c}' && o.consistentRead ? {items:[],hasNext(){return true;},async next(){trace.push(['next',c]); throw errorValue;}} : undefined;`, inventory, [c === 'Bookings'?'bookings_read_failed':'summaries_read_failed'], {module:'roomInventory',verify(a,b,x,y){assert.equal(y.identity,true);}});
  test('reader-paging-success-' + c, `pageOverride = (c,o) => c === '${c}' && o.consistentRead ? {items:[],hasNext(){return true;},async next(){trace.push(['next',c]);return {items:[],hasNext(){return false;}};}} : undefined;`, search);
}
const alternates = `modules['search.web'].suggestAlternateDates('2027-06-01','2027-06-09')`;
test('alternate-success', '', alternates, [], {verify(a,b,x,y) {assert.equal(y.result.suggestions.length,3);}});
test('alternate-failure', `fail = c => {if(c === 'Bookings') throw errorValue;};`, alternates, ['initial_physical_failed'], {verify(a,b,x,y) {assert.equal(y.result.suggestions.length,0);assert.equal(b.logs.filter(a=>a[1]==='initial_physical_failed').length,30);}});
test('closure-swallowed', `fail = c => {if(c === 'HotelClosures') throw errorValue;};`, search);
test('closure-return', `db.HotelClosures = [{startDate:'2027-06-01',endDate:'2027-06-10',reason:'Fixture closure'}];`, search);
test('minimum-stay', '', `modules['search.web'].searchAvailability('2027-06-01','2027-06-02')`);
test('invalid-order', '', `modules['search.web'].searchAvailability('2027-06-09','2027-06-01')`);
for (const [id, value] of Object.entries({
  string:`'PRIVATE thrown string'`, message:`{message:'Inventory migration required PRIVATE',code:'WDE0027',name:'PRIVATE'}`,
  inherited:`Object.create({message:'PRIVATE',code:'WDE0033'})`, accessor:`Object.defineProperties({}, {message:{get(){getterReads++;throw 'PRIVATE';}},code:{get(){getterReads++;return 'WDE0027';}},name:{get(){getterReads++;return 'PRIVATE';}}})`,
  proxy:`new Proxy({}, {get(){getterReads++;throw 'PRIVATE';},getOwnPropertyDescriptor(){getterReads++;throw 'PRIVATE';}})`, number:'123', nil:'null', undef:'undefined'
})) test('privacy-' + id, `var getterReads=0; errorValue=${value}; fail=c=>{if(c==='Bookings') throw errorValue;};`, inventory, ['bookings_read_failed'], {module:'roomInventory',verify(a,b,x,y) {assert.equal(y.identity,true);assert.equal(b.context.getterReads,0);}});
for (const c of cases.filter(c=>c.id.startsWith('privacy-'))) test(c.id + '-search', c.setup, search, ['bookings_read_failed','coordinator_unknown_failure','initial_physical_failed'], {verify(a,b,x,y) {assert.equal(y.result.ok,false);assert.equal(b.context.getterReads,0);}});
test('suppression-log-exception', '', search, [], {baselineLogMode:'throw',logMode:'throw',suppressionException:true});
test('suppression-serialization-exception', `JSON.stringify = () => {throw new Error('SERIALIZATION_PRIVATE');};`, search, [], {suppressionException:true});
// Repeat every admitted failure and success with throwing console calls/getters.
// Baseline console is nonthrowing: suppression is the declared intentional exception.
for (const original of cases.slice()) for (const mode of ['throw','getter']) {
  test(original.id + '-log-' + mode, original.setup, original.expression, mode === 'getter' ? [] : original.markers, {...original.options, logMode:mode, verify:undefined});
}
(async () => {
  const selected = process.argv[2] ? cases.filter(c => c.id.includes(process.argv[2])) : cases;
  assert.ok(selected.length);
  for (const c of selected) await check(c);
  console.log('COMPLETED ' + selected.length);
  console.log('BASELINE_SHA256 ' + JSON.stringify(Object.fromEntries(files.map(n => [n, crypto.createHash('sha256').update(originals[n]).digest('hex')]))));
})().catch(e => {console.error(e); process.exitCode = 1;});
