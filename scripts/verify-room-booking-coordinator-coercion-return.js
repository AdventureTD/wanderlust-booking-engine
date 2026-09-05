// Causal regressions in one native VM realm, using real projection and digest.
// Run: node scripts/verify-room-booking-coordinator-coercion-return.js
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function subject() {
  const context = vm.createContext({ assert, crypto: require('crypto') });
  for (const [file, name] of [
    ['roomBookingCommitProjectionRules', 'projectRoomBookingCommitPayload'],
    ['roomBookingPayloadRules', 'canonicalizeRoomBookingCommitPayload'],
    ['roomBookingPayloadDigest', 'computeRoomBookingPayloadDigest'],
    ['roomBookingCoordinator', 'coordinatePhysicalBookingCommit']
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '../velo/backend', file + '.js'), 'utf8')
      .replace(/^import .*;\s*$/gm, '').replace(/export (async )?function /g, '$1function ');
    vm.runInContext('(function(){"use strict";\n' + source +
      '\nglobalThis.' + name + '=' + name + ';})()', context);
  }
  const helpers = fs.readFileSync(path.join(__dirname, 'verify-room-booking-coordinator.js'), 'utf8');
  const start = helpers.indexOf('function days(');
  const end = helpers.indexOf('(async function()');
  assert.ok(start >= 0 && end > start, 'fixture boundaries exist');
  vm.runInContext(helpers.slice(start, end) + `
    function fixture() {
      const plan = makePlan({units: [3, 4]});
      const trusted = {guests: 2, roomFee: 0, note: 'exact primary'};
      const first = plan.bookingRows[0];
      const projected = projectRoomBookingCommitPayload({
        operationId: first.operationId, bookingNumber: first.bookingNumber,
        roomCode: first.roomCode, checkIn: first.checkIn, checkOut: first.checkOut,
        bookingRowIds: plan.bookingRows.map(row => row._id), ...trusted
      });
      const digest = computeRoomBookingPayloadDigest(projected);
      [...plan.bookingRows, ...plan.acquisitions].forEach(row => row.payloadDigest = digest);
      return {plan, trusted};
    }
  `, context);
  return context;
}

(async () => {
  await vm.runInContext(`(async () => {
    const {plan, trusted} = fixture();
    const calls = [];
    let touches = 0;
    plan.acquisitions[1].generation = {toString() { touches++; return '1'; }};
    let error;
    try { await coordinatePhysicalBookingCommit(plan, trusted, portsFor(plan, calls)); }
    catch (caught) { error = caught; }
    assert.equal(error && error.message, 'Invalid coordinator plan');
    assert.equal(calls.length, 0, 'invalid generation performs no port I/O');
    assert.equal(touches, 0, 'generation must be type-checked before any coercion hook');
  })()`, subject());
  console.log('PASS: invalid generation rejected without coercion or port I/O');
  await vm.runInContext(`(async () => {
    const {plan, trusted} = fixture();
    const calls = [];
    let armed = false;
    let touches = 0;
    let observedAwaitLookup = false;
    let sentRows;
    const ports = portsFor(plan, calls, {rows(rows) {
      sentRows = rows;
      const response = confirmations(rows, 'rowId', '_id');
      return new Proxy(response, {
        get(target, key, receiver) {
          if (key === 'then') observedAwaitLookup = true;
          return Reflect.get(target, key, receiver);
        },
        getPrototypeOf(target) {
          // This trap runs in validation, after the async port result has resolved.
          assert.equal(observedAwaitLookup, true, 'port result resolved before validation');
          if (!armed) {
            armed = true;
            Object.defineProperty(Object.prototype, 'then', {
              configurable: true,
              value(resolve) { touches++; resolve('NOT_PRIMARY_ROW'); }
            });
          }
          return Reflect.getPrototypeOf(target);
        }
      });
    }});
    let value;
    try { value = await coordinatePhysicalBookingCommit(plan, trusted, ports); }
    finally { if (armed) delete Object.prototype.then; }
    assert.equal(armed, true, 'final confirmation installs inherited then');
    assert.deepEqual(Array.from(calls, call => call[0]), ['claims', 'decision', 'rows']);
    assert.equal(touches, 0, 'detached primary return must not assimilate inherited then');
    // Null prototype is the documented return contract: direct fields and real Dates,
    // no synthetic own then property, and no ambient Object.prototype inheritance.
    assert.equal(Object.getPrototypeOf(value), null);
    const expected = {
      _id: plan.primaryRowId, roomCode: 'adventure_suite', assignedRoom: 3, quantity: 1,
      checkIn: new Date('2027-11-05T12:00:00.000Z'),
      checkOut: new Date('2027-11-07T12:00:00.000Z'),
      bookingNumber: 'WC-5001', operationId: 'coordinatortrace01',
      payloadDigest: plan.bookingRows[0].payloadDigest, status: 'confirmed',
      autoOwnerBlock: false, guests: 2, roomFee: 0, note: 'exact primary'
    };
    assert.deepEqual(Reflect.ownKeys(value), Reflect.ownKeys(expected), 'exact own fields');
    assert.equal(Object.hasOwn(value, 'then'), false);
    for (const key of Reflect.ownKeys(expected)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      assert.equal(descriptor.enumerable, true);
      assert.equal(descriptor.configurable, true);
      assert.equal(descriptor.writable, true);
      assert.ok(Object.hasOwn(descriptor, 'value'));
      if (key === 'checkIn' || key === 'checkOut') {
        assert.ok(value[key] instanceof Date, key + ' is a real same-realm Date');
        assert.equal(value[key].toISOString(), expected[key].toISOString());
      } else assert.equal(value[key], expected[key], key + ' directly usable');
    }
    assert.notEqual(value, sentRows[0]);
    assert.notEqual(value, plan.bookingRows[0]);
    value.checkIn.setUTCFullYear(2000);
    value.note = 'consumer mutation';
    assert.equal(sentRows[0].checkIn, '2027-11-05T12:00:00.000Z');
    assert.equal(sentRows[0].note, 'exact primary');
    assert.equal(plan.bookingRows[0].checkIn, '2027-11-05');
    assert.equal(trusted.note, 'exact primary');
  })()`, subject());
  console.log('PASS: final confirmation cannot assimilate detached exact primary return');
})().catch(error => { console.error(error); process.exitCode = 1; });
