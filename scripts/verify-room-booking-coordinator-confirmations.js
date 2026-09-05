// Disconnected causal regressions. No Wix/network access and no source rewriting.
// Run: node scripts/verify-room-booking-coordinator-confirmations.js
// Optional CASE_ID selects one mutation witness; MUTANT_SOURCE is handled by the
// external mutation harness preload, never by this verifier.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// Reuse the established VM loader, canonical plans, projection and port fixtures
// without executing that verifier's test IIFE. Compile in Node's realm so the
// fixture records retain the prototypes expected by its coordinator VM.
const fixturePath = path.join(__dirname, 'verify-room-booking-coordinator.js');
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const boundary = fixtureSource.indexOf('(async function() {');
assert.ok(boundary > 0, 'existing verifier fixture boundary exists');
const fixtures = new Module(fixturePath, module);
fixtures.filename = fixturePath;
fixtures.paths = module.paths;
fixtures._compile(fixtureSource.slice(0, boundary) +
  '\nmodule.exports = { loadCoordinator, makePlan, projected, confirmations, portsFor };', fixturePath);
const { loadCoordinator, makePlan, projected, confirmations, portsFor } = fixtures.exports;
const trusted = { guests: 2, roomFee: 199, note: 'confirmation witness' };
const tests = [];
function test(id, name, run) { tests.push({ id, name, run }); }
async function invoke(plan, hooks, editPorts) {
  const calls = [];
  const ports = portsFor(plan, calls, hooks);
  if (editPorts) editPorts(ports);
  let result, error;
  try {
    result = await loadCoordinator(projected, () => '1'.repeat(64)).api
      .coordinatePhysicalBookingCommit(plan, trusted, ports);
  } catch (caught) { error = caught; }
  return { result, error, calls, trace: calls.map(call => call[0]) };
}
function summary(outcome) {
  return { error: outcome.error ? {
    message: outcome.error.message, code: outcome.error.code,
    operationId: outcome.error.operationId
  } : null, trace: outcome.trace, returned: !!outcome.result };
}
function recovery(outcome, trace, plan) {
  assert.deepEqual(summary(outcome), {
    error: { message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED',
      operationId: plan.bookingRows[0].operationId }, trace, returned: false
  }, 'must map failure and stop at the exact effect boundary');
}
function repairResourceReferences(plan) {
  plan.acquisitions[0].manifestResourceClaimIds = plan.acquisitions.slice(1).map(e => e._id).join('|');
}
function resourceId(event) {
  const number = event.claimType === 'capacity' ? event.capacitySlot : event.unit;
  event._id = 'rc1-' + event.night.replace(/-/g, '') + '-' +
    (event.claimType === 'capacity' ? 's' : 'u') + number + '-' +
    String(event.generation).padStart(6, '0') + '-a';
  event.claimKey = event.claimType + ':' + event.night + ':' + number;
}
for (const [id, name, mutate] of [
  [92, 'string generation with otherwise matching resource ID', e => { e.generation = '1'; resourceId(e); }],
  [93, 'zero generation with matching resource ID', e => { e.generation = 0; resourceId(e); }],
  [94, 'generation 1000000 with matching resource ID', e => { e.generation = 1000000; resourceId(e); }],
  [95, 'fractional capacity slot with matching ID and claim key', e => { e.capacitySlot = 1.5; resourceId(e); }],
  [96, 'capacity slot five with matching ID and claim key', e => { e.capacitySlot = 5; resourceId(e); }],
  [97, 'wrong resource ID also installed in manifest', e => { e._id = 'wrong-resource-id'; }],
  [98, 'resource protocolVersion two', e => { e.protocolVersion = 2; }],
  [99, 'wrong resource claimKey', e => { e.claimKey = 'capacity:2027-11-05:4'; }],
  [100, 'release masquerading as acquisition', e => { e.eventType = 'release'; }],
  [102, 'resource night disagrees with canonical ID and position', e => { e.night = '2027-11-06'; }],
  [103, 'resource belongs to another operation', e => { e.operationId = 'anotheroperation01'; }],
  [105, 'resource booking number mismatch', e => { e.bookingNumber = 'WC-OTHER'; }],
  [106, 'resource payload digest mismatch', e => { e.payloadDigest = '2'.repeat(64); }]
]) {
  test(id, name, async () => {
    const plan = makePlan({});
    mutate(plan.acquisitions[1]);
    repairResourceReferences(plan);
    const out = await invoke(plan);
    assert.deepEqual(summary(out), { error: { message: 'Invalid coordinator plan',
      code: undefined, operationId: undefined }, trace: [], returned: false },
    'invalid resource must reject before any claims, decision or rows');
  });
}
for (const [id, name, corrupt] of [
  [114, 'extra confirmation after the complete expected prefix', r => {
    r.confirmed.push({ ...r.confirmed[0] }); return r;
  }],
  [115, 'first confirmation has wrong identity', r => {
    const key = 'eventId' in r.confirmed[0] ? 'eventId' : 'rowId';
    r.confirmed[0][key] = 'wrong-first-id'; return r;
  }],
  [118, 'unsupported disposition', r => {
    r.confirmed[0].disposition = 'rejected'; return r;
  }],
  [119, 'ownKeys trap throws during confirmation snapshot', r => new Proxy(r, {
    ownKeys() { throw new Error('confirmation snapshot trap'); }
  })]
]) {
  test(id, name, async () => {
    for (const phase of ['claims', 'decision', 'rows']) {
      const plan = makePlan({ units: [3, 4, 5] });
      const hooks = {};
      hooks[phase] = phase === 'decision' ? operationId => corrupt({
        state: 'CONFIRMED', confirmed: [{ eventId: 'rc1-op-' + operationId + '-d', disposition: 'inserted' }]
      }) : items => corrupt(confirmations(items, phase === 'rows' ? 'rowId' : 'eventId', '_id'));
      const out = await invoke(plan, hooks);
      recovery(out, ['claims', 'decision', 'rows'].slice(0,
        ['claims', 'decision', 'rows'].indexOf(phase) + 1), plan);
    }
  });
}
for (const [id, phase, name, attack] of [
  [120, 'claims', 'acquisition record cannot be overwritten', items => Reflect.set(items[1], 'bookingNumber', 'CORRUPTED')],
  [121, 'claims', 'acquisition array cannot lose its last event', items => Reflect.set(items, 'length', items.length - 1)],
  [134, 'rows', 'row array cannot lose its last row', items => Reflect.set(items, 'length', items.length - 1)]
]) {
  test(id, name, async () => {
    const plan = makePlan({ units: [3, 4, 5] });
    let writeAccepted;
    const hooks = { [phase]: items => {
      // Return complete confirmations even after the attempted corruption; this
      // isolates integrity of the actual port payload from confirmation count.
      const response = confirmations(items, phase === 'rows' ? 'rowId' : 'eventId', '_id');
      writeAccepted = attack(items);
      return response;
    } };
    const out = await invoke(plan, hooks);
    assert.equal(writeAccepted, false, 'port must not be able to mutate captured payload');
    assert.equal(out.error, undefined);
    assert.deepEqual(out.trace, ['claims', 'decision', 'rows']);
  });
}
for (const [id, field, expected] of [[124, 'status', 'confirmed'], [125, 'autoOwnerBlock', false]]) {
  test(id, 'exact committed ' + field + ' on port and return row', async () => {
    const out = await invoke(makePlan({ units: [3, 4, 5] }));
    assert.equal(out.error, undefined);
    for (const row of out.calls[2][1]) assert.equal(row[field], expected, 'every persisted row ' + field);
    assert.equal(out.result[field], expected, 'returned row ' + field);
  });
}
test(128, 'returned checkout is a detached mutable Date', async () => {
  const out = await invoke(makePlan({}));
  assert.equal(out.error, undefined);
  assert.ok(out.result.checkOut instanceof Date, 'checkout must be a Date, not port timestamp string');
  assert.equal(out.result.checkOut.toISOString(), '2027-11-07T12:00:00.000Z');
  out.result.checkOut.setUTCFullYear(2040);
  assert.equal(out.calls[2][1][0].checkOut, '2027-11-07T12:00:00.000Z');
});
for (const [id, port] of [[136, 'appendRoomOperationDecision'], [137, 'appendBookingRows']]) {
  test(id, 'nonfunction ' + port + ' prevents even claims', async () => {
    const plan = makePlan({});
    const out = await invoke(plan, {}, ports => { ports[port] = {}; });
    recovery(out, [], plan);
  });
}
for (const [id, phase] of [[150, 'claims'], [151, 'decision']]) {
  test(id, phase + ' synchronous and asynchronous errors never leak', async () => {
    for (const mode of ['throw', 'reject']) {
      const plan = makePlan({});
      const secret = new Error('private adapter diagnostic');
      const out = await invoke(plan, { [phase]: () => {
        if (mode === 'throw') throw secret;
        return Promise.reject(secret);
      } });
      recovery(out, phase === 'claims' ? ['claims'] : ['claims', 'decision'], plan);
      assert.notEqual(out.error, secret);
    }
  });
}

(async () => {
  const selected = process.env.CASE_ID ? tests.filter(t => String(t.id) === process.env.CASE_ID) : tests;
  assert.ok(selected.length, 'requested test exists');
  let failures = 0;
  for (const { id, name, run } of selected) {
    try { await run(); console.log('PASS [' + id + '] ' + name); }
    catch (error) {
      failures += 1;
      console.error('FAIL [' + id + '] ' + name + '\n' + error.stack);
    }
  }
  console.log(JSON.stringify({ tests: selected.length, failures }));
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
