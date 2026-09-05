// Regression: late prototype drift must fail closed at every snapshot boundary.
// Run: node scripts/verify-room-booking-coordinator-final-snapshot.js
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const fixturePath = path.join(__dirname, 'verify-room-booking-coordinator.js');
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const boundary = fixtureSource.indexOf('(async function() {');
assert.ok(boundary > 0, 'fixture boundary exists');
const fixture = new Module(fixturePath, module);
fixture.filename = fixturePath;
fixture.paths = module.paths;
fixture._compile(fixtureSource.slice(0, boundary) +
  '\nmodule.exports={loadCoordinator,makePlan,projected,portsFor,confirmations};', fixturePath);
const { loadCoordinator, makePlan, projected, portsFor, confirmations } = fixture.exports;
const cases = ['plan', 'trusted', 'bookingRows', 'row', 'acquisitions', 'identity', 'resource', 'ports'];
for (const phase of ['claims', 'decision', 'rows']) {
  for (const shape of ['outer', 'array', 'item']) cases.push(phase + ':' + shape);
}

(async () => {
  let count = 0;
  for (const name of cases) {
    for (const trap of ['ownKeys', 'getOwnPropertyDescriptor']) {
      let plan = makePlan({});
      let trusted = { guests: 2, roomFee: 0, note: '' };
      const calls = [];
      let drifted = false;
      function drifting(target) {
        let scans = 0;
        const keys = Reflect.ownKeys(target);
        const lastKey = keys[keys.length - 1];
        return new Proxy(target, {
          ownKeys(record) {
            scans++;
            if (trap === 'ownKeys' && scans === 2) {
              Object.setPrototypeOf(record, { changed: true }); drifted = true;
            }
            return Reflect.ownKeys(record);
          },
          getOwnPropertyDescriptor(record, key) {
            if (trap === 'getOwnPropertyDescriptor' && scans === 2 && key === lastKey) {
              Object.setPrototypeOf(record, { changed: true }); drifted = true;
            }
            return Object.getOwnPropertyDescriptor(record, key);
          }
        });
      }
      const hooks = {};
      const [phase, shape] = name.split(':');
      if (shape) hooks[phase] = items => {
        let response = phase === 'decision'
          ? { state: 'CONFIRMED', confirmed: [{ eventId: 'rc1-op-' + items + '-d', disposition: 'inserted' }] }
          : confirmations(items, phase === 'rows' ? 'rowId' : 'eventId', '_id');
        if (shape === 'outer') response = drifting(response);
        if (shape === 'array') response.confirmed = drifting(response.confirmed);
        if (shape === 'item') response.confirmed[0] = drifting(response.confirmed[0]);
        return response;
      };
      let ports = portsFor(plan, calls, hooks);
      if (name === 'plan') plan = drifting(plan);
      if (name === 'trusted') trusted = drifting(trusted);
      if (name === 'bookingRows') plan.bookingRows = drifting(plan.bookingRows);
      if (name === 'row') plan.bookingRows[0] = drifting(plan.bookingRows[0]);
      if (name === 'acquisitions') plan.acquisitions = drifting(plan.acquisitions);
      if (name === 'identity') plan.acquisitions[0] = drifting(plan.acquisitions[0]);
      if (name === 'resource') plan.acquisitions[1] = drifting(plan.acquisitions[1]);
      if (name === 'ports') ports = drifting(ports);
      let error;
      try {
        await loadCoordinator(projected, () => '1'.repeat(64)).api.coordinatePhysicalBookingCommit(plan, trusted, ports);
      } catch (caught) { error = caught; }
      assert.equal(drifted, true, name + ': fixture reaches final scan');
      const recovery = name === 'ports' || !!shape;
      const trace = shape ? ['claims', 'decision', 'rows'].slice(0, ['claims', 'decision', 'rows'].indexOf(phase) + 1) : [];
      assert.deepEqual({ message: error && error.message, code: error && error.code,
        operationId: error && error.operationId, calls: calls.map(call => call[0]) }, {
        message: recovery ? 'RECOVERY_REQUIRED' : 'Invalid coordinator plan',
        code: recovery ? 'RECOVERY_REQUIRED' : undefined,
        operationId: recovery ? 'coordinatortrace01' : undefined, calls: trace
      }, name + ': ' + trap + ' late prototype drift stops at the exact boundary');
      count++;
      console.log('PASS: final-snapshot ' + name + ' ' + trap);
    }
  }
  console.log('PASS COUNT: ' + count);
})().catch(error => { console.error(error); process.exitCode = 1; });
