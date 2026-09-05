// Disconnected descriptor/shape/calendar regression witnesses for the commit coordinator.
// Run: node scripts/verify-room-booking-coordinator-descriptors.js [--case ID]
// Mutation runner: MUTANT_SOURCE=... node --require .../preload.cjs this-script --case ID
// Only the exported coordinator is exercised. No Wix imports, network, or persistent writes.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIGEST = '1'.repeat(64);
const OP = 'descriptortrace01';
function loadCoordinator() {
  const file = path.join(__dirname, '..', 'velo', 'backend', 'roomBookingCoordinator.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/export async function /g, 'async function ') +
    '\nthis.api = { coordinatePhysicalBookingCommit };';
  const context = {
    Date, Object, Array, Error, Number, String, RegExp, Reflect,
    projectRoomBookingCommitPayload: input => ({ rows: input.bookingRowIds.map(() => ({
      guests: input.guests, roomFee: 0, note: input.note
    })) }),
    computeRoomBookingPayloadDigest: () => DIGEST
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.api.coordinatePhysicalBookingCommit;
}
// Same one-row operation/capacity/unit manifest structure as the main coordinator verifier.
function makePlan(start = '2027-11-05', nights = 2) {
  const date = offset => new Date(Date.parse(start + 'T00:00:00.000Z') + offset * 86400000)
    .toISOString().slice(0, 10);
  const checkIn = date(0), checkOut = date(nights);
  const rowId = 'pb1-' + OP + '-r1';
  const common = { operationId: OP, bookingRowId: rowId, bookingNumber: 'WC-DESC', payloadDigest: DIGEST };
  const resources = [];
  for (const type of ['capacity', 'unit']) {
    for (let index = 0; index < nights; index += 1) {
      const night = date(index), number = type === 'capacity' ? 1 : 3;
      resources.push({
        _id: 'rc1-' + night.replace(/-/g, '') + '-' + (type === 'capacity' ? 's' : 'u') + number + '-000001-a',
        protocolVersion: 1, claimKey: type + ':' + night + ':' + number, generation: 1,
        eventType: 'acquire', claimType: type, night,
        [type === 'capacity' ? 'capacitySlot' : 'unit']: number, ...common
      });
    }
  }
  return {
    acquisitions: [{
      _id: 'rc1-op-' + OP + '-a', protocolVersion: 1, claimKey: 'operation:' + OP,
      generation: 1, eventType: 'acquire', claimType: 'operation', ...common,
      decisionFenceVersion: 1, manifestVersion: 1, manifestCheckIn: checkIn,
      manifestCheckOut: checkOut, manifestRoomCode: 'adventure_suite', manifestUnits: '3',
      manifestBookingRowIds: rowId, manifestResourceClaimIds: resources.map(x => x._id).join('|')
    }, ...resources],
    bookingRows: [{ _id: rowId, roomCode: 'adventure_suite', assignedRoom: 3, quantity: 1,
      checkIn, checkOut, bookingNumber: common.bookingNumber, operationId: OP, payloadDigest: DIGEST }],
    primaryRowId: rowId
  };
}
function confirmation(items, key) {
  return { state: 'CONFIRMED', confirmed: Array.from(items, item => ({ [key]: item._id, disposition: 'inserted' })) };
}
function ports(calls) {
  return {
    appendClaimEvents: async events => { calls.push('claims'); return confirmation(events, 'eventId'); },
    appendRoomOperationDecision: async id => {
      calls.push('decision'); return confirmation([{ _id: 'rc1-op-' + id + '-d' }], 'eventId');
    },
    appendBookingRows: async rows => { calls.push('rows'); return confirmation(rows, 'rowId'); }
  };
}
function changeDate(plan, field, day) {
  plan.bookingRows[0][field] = day;
  plan.acquisitions[0][field === 'checkIn' ? 'manifestCheckIn' : 'manifestCheckOut'] = day;
}
const cases = new Map();
function witness(id, name, prepare, accepted = false) { cases.set(id, { name, prepare, accepted }); }
witness(19, 'port own apply property cannot replace captured Reflect.apply', f => {
  f.ports.appendClaimEvents.apply = () => { f.touches += 1; throw new Error('attacker apply invoked'); };
}, true);
witness(22, 'second ownKeys cannot add a suffix key', f => {
  let pass = 0;
  f.plan = new Proxy(f.plan, { ownKeys: target => ++pass === 1 ? Reflect.ownKeys(target) : [...Reflect.ownKeys(target), 'extra'],
    getOwnPropertyDescriptor: (target, key) => key === 'extra' ? { value: 7, enumerable: true, configurable: true, writable: true } : Object.getOwnPropertyDescriptor(target, key) });
});
for (const id of [23, 24, 31]) witness(id, 'second first key changes while descriptor value stays identical', f => {
  let pass = 0;
  f.plan = new Proxy(f.plan, {
    ownKeys: target => { const keys = Reflect.ownKeys(target); if (++pass === 2) keys[0] = 'alias'; return keys; },
    getOwnPropertyDescriptor: (target, key) => Object.getOwnPropertyDescriptor(target, key === 'alias' ? 'acquisitions' : key)
  });
});
for (const [id, flag] of [[25, 'value'], [26, 'enumerable'], [27, 'configurable'], [28, 'writable'], [32, 'value']]) {
  witness(id, 'second descriptor changes ' + flag, f => {
    let reads = 0;
    f.plan = new Proxy(f.plan, { getOwnPropertyDescriptor: (target, key) => {
      if (key === 'primaryRowId' && ++reads === 2) {
        // Actually change the target for the nonconfigurable descriptor: obey Proxy invariants.
        if (flag === 'configurable') Object.defineProperty(target, key, { configurable: false });
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        descriptor[flag] = flag === 'value' ? 'changed-primary-id' : false;
        return descriptor;
      }
      return Object.getOwnPropertyDescriptor(target, key);
    } });
  });
}
witness(29, 'initial wrong prototype cannot be repaired by ownKeys trap', f => {
  Object.setPrototypeOf(f.plan, { hostile: true });
  f.plan = new Proxy(f.plan, { ownKeys: target => { Object.setPrototypeOf(target, Object.prototype); return Reflect.ownKeys(target); } });
});
witness(30, 'intermediate prototype drift cannot be hidden by a later repair', f => {
  let scans = 0;
  f.plan = new Proxy(f.plan, { ownKeys: target => {
    Object.setPrototypeOf(target, ++scans === 1 ? { hostile: true } : Object.prototype);
    return Reflect.ownKeys(target);
  } });
});
witness(33, 'array record rejected without executing its prototype trap', f => {
  f.plan = new Proxy([], { getPrototypeOf: () => { f.touches += 1; return Object.prototype; } });
});
witness(37, 'Array.prototype impostor is not an actual bookingRows array', f => {
  const fake = Object.create(Array.prototype);
  Object.defineProperty(fake, 'length', { value: 1, writable: true, configurable: false, enumerable: false });
  fake[0] = f.plan.bookingRows[0];
  f.plan.bookingRows = fake;
});
witness(41, 'normal array with non-writable length must be rejected', f => {
  Object.defineProperty(f.plan.bookingRows, 'length', { writable: false });
});
witness(43, 'array item must have writable ordinary-data flags', f => {
  Object.defineProperty(f.plan.bookingRows, '0', { writable: false });
});
witness(44, 'date separators must be canonical hyphens', f => changeDate(f.plan, 'checkIn', '2027/11/05'));
witness(45, 'month zero cannot alias January', f => {
  f.plan = makePlan('2027-01-05'); changeDate(f.plan, 'checkIn', '2027-00-05');
});
witness(46, 'month thirteen cannot alias next January', f => {
  f.plan = makePlan('2028-01-05'); changeDate(f.plan, 'checkIn', '2027-13-05');
});
witness(47, 'day zero cannot alias previous month final day', f => {
  f.plan = makePlan('2027-10-31'); changeDate(f.plan, 'checkIn', '2027-11-00');
});
witness(48, 'November day 31 cannot alias December first', f => {
  f.plan = makePlan('2027-12-01'); changeDate(f.plan, 'checkIn', '2027-11-31');
});
witness(49, 'zero-night complete empty resource manifest must be rejected', f => { f.plan = makePlan('2027-11-05', 0); });
witness(50, '801-night otherwise complete manifest must be rejected', f => { f.plan = makePlan('2027-11-05', 801); });

async function run(id, test) {
  const coordinate = loadCoordinator();
  const calls = [];
  const fixture = { plan: makePlan(), trusted: { guests: 2, roomFee: 0, note: 'descriptor witness' }, ports: ports(calls), touches: 0 };
  test.prepare(fixture);
  let result, error;
  try { result = await coordinate(fixture.plan, fixture.trusted, fixture.ports); }
  catch (caught) { error = caught; }
  const observed = { error: error ? error.message : null, calls, touches: fixture.touches, returnedId: result ? result._id : null };
  const expected = test.accepted
    ? { error: null, calls: ['claims', 'decision', 'rows'], touches: 0, returnedId: fixture.plan.primaryRowId }
    : { error: 'Invalid coordinator plan', calls: [], touches: 0, returnedId: null };
  assert.deepEqual(observed, expected, 'witness ' + id + ': ' + test.name);
  console.log(JSON.stringify({ id, name: test.name, status: 'PASS', observed }));
}
(async () => {
  const selection = process.argv.indexOf('--case');
  const selected = selection < 0 ? [...cases] : [[Number(process.argv[selection + 1]), cases.get(Number(process.argv[selection + 1]))]];
  for (const [id, test] of selected) {
    assert.ok(test, 'unknown witness ID ' + id);
    await run(id, test);
  }
  console.log('PASS: coordinator descriptor witnesses (' + selected.length + ')');
})().catch(error => { console.error(error); process.exitCode = 1; });
