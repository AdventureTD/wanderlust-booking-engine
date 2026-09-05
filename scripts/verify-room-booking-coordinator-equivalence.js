// Disconnected C3 equivalence counterexamples. No source or live effects.
// CASE_ID=N node [-r <preload.cjs>] scripts/verify-room-booking-coordinator-equivalence.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..', 'velo', 'backend');
const context = vm.createContext({ crypto: require('crypto'), assert, console, caseId: Number(process.env.CASE_ID || 0) });
function load(name, exports) {
  const source = fs.readFileSync(path.join(root, name + '.js'), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace(/export (async )?function /g, '$1function ');
  vm.runInContext('{\n' + source + '\nObject.assign(globalThis, {' + exports.join(',') + '});\n}', context);
}
load('roomBookingPayloadRules', ['canonicalizeRoomBookingCommitPayload']);
load('roomBookingCommitProjectionRules', ['projectRoomBookingCommitPayload']);
load('roomBookingPayloadDigest', ['computeRoomBookingPayloadDigest']);
load('roomBookingCoordinator', ['coordinatePhysicalBookingCommit']);
const helpers = fs.readFileSync(path.join(__dirname, 'verify-room-booking-coordinator.js'), 'utf8');
vm.runInContext(helpers.slice(helpers.indexOf('function days('), helpers.indexOf('(async function()')), context);
vm.runInContext('(' + (async function run() {
  const ids = caseId ? [caseId] : [35, 39, 42, 46, 58, 59, 62, 112, 135];
  for (const id of ids) {
    const plan = makePlan({ checkIn: '2028-01-01', checkOut: '2028-01-02' });
    const trusted = { guests: 2, roomFee: 0, note: '' };
    const payload = projectRoomBookingCommitPayload({ operationId: plan.bookingRows[0].operationId,
      bookingNumber: plan.bookingRows[0].bookingNumber, roomCode: 'adventure_suite',
      checkIn: '2028-01-01', checkOut: '2028-01-02', bookingRowIds: [plan.primaryRowId], ...trusted });
    const digest = computeRoomBookingPayloadDigest(payload);
    [...plan.bookingRows, ...plan.acquisitions].forEach(x => { x.payloadDigest = digest; });
    const calls = [];
    let touches = 0;
    let ports = portsFor(plan, calls);
    if (id === 35 || id === 42 || id === 39) {
      ports = portsFor(plan, calls, { claims(events) {
        const reply = confirmations(events, 'eventId', '_id');
        if (id === 35) {
          const item = reply.confirmed[0];
          delete item.disposition; item.extra = 'inserted';
          Object.defineProperty(Array.prototype, '-1', { configurable: true,
            value: { value: 'inserted', enumerable: true, configurable: true, writable: true } });
        } else if (id === 42) {
          const item = reply.confirmed[0];
          delete reply.confirmed[0]; reply.confirmed.extra = item;
          Object.defineProperty(Array.prototype, '-1', { configurable: true,
            value: { value: item, enumerable: true, configurable: true, writable: true } });
        } else {
          const length = { valueOf() { touches++; return events.length; } };
          reply.confirmed = new Proxy(reply.confirmed, { getOwnPropertyDescriptor(target, key) {
            const d = Reflect.getOwnPropertyDescriptor(target, key);
            if (key === 'length') d.value = length;
            return d;
          } });
        }
        return reply;
      } });
    }
    if (id === 46 || id === 62) {
      if (id === 46) {
        plan.bookingRows[0].checkIn = '2027-13-01';
        plan.bookingRows[0].checkOut = '2027-13-02';
        plan.acquisitions[0].manifestCheckIn = '2027-13-01';
        plan.acquisitions[0].manifestCheckOut = '2027-13-02';
      } else {
        [...plan.bookingRows, ...plan.acquisitions].forEach(x => { x.payloadDigest = 'invalid'; });
      }
      plan.acquisitions[0] = new Proxy(plan.acquisitions[0], {
        getPrototypeOf(target) { touches++; return Reflect.getPrototypeOf(target); }
      });
    }
    if (id === 58) {
      plan.bookingRows = [];
      Object.defineProperty(Array.prototype, '0', { configurable: true,
        get() { touches++; return undefined; } });
    }
    if (id === 59) {
      plan.bookingRows = Array.from({ length: 4 }, () => ({ ...plan.bookingRows[0] }));
      plan.bookingRows[0] = new Proxy(plan.bookingRows[0], {
        getPrototypeOf(target) { touches++; return Reflect.getPrototypeOf(target); }
      });
    }
    if (id === 135) {
      ports.appendClaimEvents = new Proxy({}, { apply() { touches++; },
        get() { touches++; }, getPrototypeOf() { touches++; } });
    }
    const savedExec = RegExp.prototype.exec;
    if (id === 112) {
      RegExp.prototype.exec = function(value) {
        if (this.source === '^[0-9a-f]{64}$' && ++touches === 2) throw new Error('hostile exec');
        return Reflect.apply(savedExec, this, [value]);
      };
    }
    let error;
    try { await coordinatePhysicalBookingCommit(plan, trusted, ports); }
    catch (caught) { error = caught; }
    finally { RegExp.prototype.exec = savedExec; delete Array.prototype['-1']; if (id === 58) delete Array.prototype['0']; }
    if (id === 112) {
      assert.strictEqual(error && error.message, 'Invalid coordinator plan');
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(touches, 2, 'both coordinator digest regex checks execute through the inherited exec hook');
    } else if ([35,39,42].includes(id)) {
      assert.strictEqual(error && error.code, 'RECOVERY_REQUIRED', 'ID' + id + ': malformed confirmation must not authorize downstream writes; calls=' + calls.map(x => x[0]));
      assert.deepStrictEqual(calls.map(x => x[0]), ['claims']);
      assert.strictEqual(touches, 0, 'invalid length must not be coerced');
    } else if (id === 135) {
      assert.strictEqual(error && error.code, 'RECOVERY_REQUIRED');
      assert.strictEqual(touches, 0); assert.strictEqual(calls.length, 0);
    } else {
      assert.strictEqual(error && error.message, 'Invalid coordinator plan');
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(touches, 0, 'ID' + id + ': rejected prerequisite must not inspect later hostile values');
    }
    console.log('PASS ID' + id);
  }
}).toString() + ')()', context).catch(error => { console.error(error); process.exitCode = 1; });
