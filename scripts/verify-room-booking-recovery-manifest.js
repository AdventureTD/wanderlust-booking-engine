// Behavioral tests for the committed room recovery manifest capability.
// Run: node scripts/verify-room-booking-recovery-manifest.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let assertionCount = 0;
function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    const copy = {};
    Object.keys(value).sort().forEach(function(key) { copy[key] = comparable(value[key]); });
    return copy;
  }
  return value;
}
function assertEqual(actual, expected, message) {
  assertionCount += 1;
  const left = JSON.stringify(comparable(actual));
  const right = JSON.stringify(comparable(expected));
  if (left !== right) throw new Error(`FAIL: ${message}\nExpected: ${right}\nActual:   ${left}`);
  console.log('PASS: ' + message);
}
async function assertRecovery(run, operationId, message) {
  let error = null;
  try { await run(); } catch (caught) { error = caught; }
  assertEqual(error && { message: error.message, code: error.code, operationId: error.operationId }, {
    message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED', operationId
  }, message);
}

const sourcePath = path.join(__dirname, '..', 'velo', 'backend', 'roomBookingCommit.js');
const rawSource = fs.readFileSync(sourcePath, 'utf8');
function evaluateActual() {
  const source = rawSource
    .replace(/^import .*;\s*$/gm, '')
    .replace(/export async function /g, 'async function ')
    + '\nthis.recoveryManifestLoader = typeof loadCommittedRoomRecoveryManifest === "function" ? loadCommittedRoomRecoveryManifest : null;';
  const context = { wixData: null };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}
function evaluateWithStub(dispatch) {
  const source = rawSource
    .replace(/^import .*;\s*$/gm, '')
    .replace('export async function loadCompletedRoomClaimSet(',
      'async function loadCompletedRoomClaimSetOriginal(')
    .replace('// Disconnected committed-evidence capability for the future recovery coordinator.',
      'const loadCompletedRoomClaimSet = this.completedLoader;\n' +
      '// Disconnected committed-evidence capability for the future recovery coordinator.')
    .replace(/export async function /g, 'async function ')
    + '\nthis.recoveryManifestLoader = loadCommittedRoomRecoveryManifest;';
  const context = { wixData: null, completedLoader: dispatch };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}
function inRealm(context, value) {
  context.jsonFixture = JSON.stringify(value);
  const result = vm.runInContext('JSON.parse(jsonFixture)', context);
  delete context.jsonFixture;
  return result;
}

function roomCodeFor(units) {
  if (units.join(',') === '1') return 'penthouse_apartment';
  if (units.join(',') === '2') return 'two_bedroom_apartment';
  return 'adventure_suite';
}
function buildEvidence(operationId, units) {
  units = units || [3];
  const checkIn = '2027-11-05';
  const checkOut = '2027-11-06';
  const bookingNumber = 'WC-7001';
  const payloadDigest = 'a'.repeat(64);
  const rowIds = units.map(function(unit, index) {
    return 'pb1-' + operationId + '-r' + (index + 1);
  });
  const acquisitions = [];
  units.forEach(function(unit, index) {
    acquisitions.push({
      _id: 'rc1-20271105-s' + (index + 1) + '-000001-a', protocolVersion: 1,
      claimKey: 'capacity:2027-11-05:' + (index + 1), generation: 1,
      eventType: 'acquire', claimType: 'capacity', night: checkIn,
      capacitySlot: index + 1, operationId, bookingRowId: rowIds[index],
      bookingNumber, payloadDigest
    });
  });
  units.forEach(function(unit, index) {
    acquisitions.push({
      _id: 'rc1-20271105-u' + unit + '-000001-a', protocolVersion: 1,
      claimKey: 'unit:2027-11-05:' + unit, generation: 1,
      eventType: 'acquire', claimType: 'unit', night: checkIn, unit,
      operationId, bookingRowId: rowIds[index], bookingNumber, payloadDigest
    });
  });
  const identity = {
    _id: 'rc1-op-' + operationId + '-a', protocolVersion: 1,
    claimKey: 'operation:' + operationId, generation: 1, eventType: 'acquire',
    claimType: 'operation', operationId, bookingRowId: rowIds[0], bookingNumber,
    payloadDigest, manifestVersion: 1, manifestCheckIn: checkIn,
    manifestCheckOut: checkOut, manifestRoomCode: roomCodeFor(units),
    manifestUnits: units.join(','), manifestBookingRowIds: rowIds.join('|'),
    manifestResourceClaimIds: acquisitions.map(function(record) { return record._id; }).join('|'),
    decisionFenceVersion: 1
  };
  const completion = {
    _id: 'rc1-op-' + operationId + '-c', protocolVersion: 1,
    claimKey: 'operation:' + operationId + ':completion', generation: 1,
    eventType: 'complete', claimType: 'operation-completion', operationId,
    bookingRowId: rowIds[0], bookingNumber, payloadDigest, completionState: 'complete',
    confirmedResourceCount: acquisitions.length, decisionFenceVersion: 1
  };
  const decision = {
    _id: 'rc1-op-' + operationId + '-d', protocolVersion: 1,
    claimKey: 'operation:' + operationId + ':decision', generation: 1,
    eventType: 'decide', claimType: 'operation-decision', operationId,
    bookingRowId: rowIds[0], bookingNumber, payloadDigest, decisionFenceVersion: 1,
    operationIdentityId: identity._id, operationCompletionId: completion._id,
    manifestVersion: 1, completionState: 'complete',
    confirmedResourceCount: acquisitions.length, decisionState: 'commit-rows'
  };
  return { identity, acquisitions, completion, decision };
}
function expectedCapability(evidence, units) {
  return {
    operationId: evidence.identity.operationId,
    bookingNumber: evidence.identity.bookingNumber,
    payloadDigest: evidence.identity.payloadDigest,
    roomCode: evidence.identity.manifestRoomCode,
    checkIn: evidence.identity.manifestCheckIn,
    checkOut: evidence.identity.manifestCheckOut,
    units: units.slice(),
    bookingRowIds: evidence.identity.manifestBookingRowIds.split('|')
  };
}
function installActualEvidence(context, evidence, calls) {
  const byId = Object.create(null);
  byId[evidence.identity._id] = evidence.identity;
  evidence.acquisitions.forEach(function(record) { byId[record._id] = record; });
  byId[evidence.completion._id] = evidence.completion;
  byId[evidence.decision._id] = evidence.decision;
  context.wixData = { get: function(collection, id, options) {
    calls.push({ collection, id, options });
    return Promise.resolve(Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null);
  } };
}

(async function() {
  const actualContext = evaluateActual();
  assertEqual(typeof actualContext.recoveryManifestLoader, 'function',
    'claim adapter exports the committed recovery manifest loader');
  const operationId = 'recoverymanifestop01';
  const evidence = buildEvidence(operationId, [3]);
  const calls = [];
  installActualEvidence(actualContext, evidence, calls);
  const actual = await actualContext.recoveryManifestLoader(operationId);
  assertEqual(actual, expectedCapability(evidence, [3]),
    'marked exact commit evidence yields only the normalized recovery capability');
  assertEqual(calls.map(function(call) { return call.id; }), [evidence.identity._id]
    .concat(evidence.acquisitions.map(function(record) { return record._id; }))
    .concat([evidence.completion._id, evidence.decision._id])
    .concat(evidence.acquisitions.map(function(record) { return record._id.slice(0, -1) + 'r'; })),
  'B2 reuses A3c exact identity, acquisitions, completion, decision, releases read order');
  assertEqual(calls.every(function(call) {
    return call.collection === 'RoomBookingClaimEvents' &&
      JSON.stringify(call.options) === JSON.stringify({ suppressAuth: true, consistentRead: true, suppressHooks: true });
  }), true, 'B2 performs no reads beyond A3c authoritative evidence loading');

  const topologies = [[1], [2], [3], [4], [3, 4], [3, 4, 5]];
  for (let index = 0; index < topologies.length; index += 1) {
    const units = topologies[index];
    const topologyId = 'manifesttopology' + String(index + 1).padStart(2, '0');
    const topologyEvidence = buildEvidence(topologyId, units);
    const topologyCalls = [];
    installActualEvidence(actualContext, topologyEvidence, topologyCalls);
    assertEqual(await actualContext.recoveryManifestLoader(topologyId),
      expectedCapability(topologyEvidence, units),
      'canonical supported topology ' + units.join(',') + ' is normalized');
  }

  const outputDescriptors = Object.getOwnPropertyDescriptors(actual);
  assertEqual(Reflect.ownKeys(actual), [
    'operationId', 'bookingNumber', 'payloadDigest', 'roomCode', 'checkIn', 'checkOut',
    'units', 'bookingRowIds'
  ], 'capability exposes exactly the ordered own-data contract');
  assertEqual(Object.keys(outputDescriptors).every(function(key) {
    const descriptor = outputDescriptors[key];
    return Object.prototype.hasOwnProperty.call(descriptor, 'value') && descriptor.writable &&
      descriptor.enumerable && descriptor.configurable;
  }), true, 'every capability field is detached writable enumerable configurable own data');
  assertEqual({
    unitsPrototype: Object.getPrototypeOf(actual.units) === vm.runInContext('Array.prototype', actualContext),
    rowsPrototype: Object.getPrototypeOf(actual.bookingRowIds) === vm.runInContext('Array.prototype', actualContext),
    unitKeys: Reflect.ownKeys(actual.units), rowKeys: Reflect.ownKeys(actual.bookingRowIds),
    unitTypes: actual.units.map(function(value) { return typeof value; }),
    rowTypes: actual.bookingRowIds.map(function(value) { return typeof value; })
  }, {
    unitsPrototype: true, rowsPrototype: true, unitKeys: ['0', 'length'],
    rowKeys: ['0', 'length'], unitTypes: ['number'], rowTypes: ['string']
  }, 'units and bookingRowIds are dense detached ordinary typed arrays');
  evidence.identity.manifestUnits = '5';
  evidence.identity.manifestBookingRowIds = 'changed';
  assertEqual(actual, expectedCapability(buildEvidence(operationId, [3]), [3]),
    'later mutation of raw evidence cannot alter the returned capability');

  let behavior = null;
  let loaderCalls = [];
  const stubContext = evaluateWithStub(function(id) {
    loaderCalls.push(id);
    return behavior(id);
  });
  function setEvidence(value) {
    behavior = function() { return inRealm(stubContext, value); };
  }
  const baseId = 'stubmanifestoper01';
  const base = buildEvidence(baseId, [3, 4]);
  setEvidence(base);
  assertEqual(await stubContext.recoveryManifestLoader(baseId), expectedCapability(base, [3, 4]),
    'independently validated A3c evidence is accepted through one loader call');
  assertEqual(loaderCalls, [baseId], 'A3c loader is invoked exactly once with the operation ID');

  loaderCalls = [];
  for (const invalidId of [null, '', 'short', 'bad operation id', 'a'.repeat(65)]) {
    await assertRecovery(function() { return stubContext.recoveryManifestLoader(invalidId); }, invalidId,
      'invalid operation ID fails closed before evidence loading: ' + String(invalidId));
  }
  assertEqual(loaderCalls, [], 'invalid operation IDs never invoke A3c');

  behavior = function() { throw new Error('loader failed'); };
  await assertRecovery(function() { return stubContext.recoveryManifestLoader(baseId); }, baseId,
    'A3c loader throw is collapsed to exact RECOVERY_REQUIRED');
  behavior = function() { return Promise.reject(new Error('loader rejected')); };
  await assertRecovery(function() { return stubContext.recoveryManifestLoader(baseId); }, baseId,
    'A3c loader rejection is collapsed to exact RECOVERY_REQUIRED');

  const malformedCases = [
    ['legacy unmarked identity', function(value) { delete value.identity.decisionFenceVersion; }],
    ['legacy unmarked completion', function(value) { delete value.completion.decisionFenceVersion; }],
    ['stopped completion', function(value) { value.completion.completionState = 'stopped'; value.decision.completionState = 'stopped'; }],
    ['wrong decision', function(value) { value.decision.decisionState = 'compensate'; }],
    ['partial acquisitions', function(value) { value.acquisitions.pop(); }],
    ['misbound acquisition operation', function(value) { value.acquisitions[0].operationId = 'foreignoperation01'; }],
    ['misbound acquisition row', function(value) { value.acquisitions[0].bookingRowId = value.identity.manifestBookingRowIds.split('|')[1]; }],
    ['misordered acquisitions', function(value) { value.acquisitions.reverse(); }],
    ['extra evidence field', function(value) { value.extra = true; }],
    ['extra identity field', function(value) { value.identity.extra = true; }],
    ['extra acquisition field', function(value) { value.acquisitions[0].extra = true; }],
    ['extra completion field', function(value) { value.completion.extra = true; }],
    ['extra decision field', function(value) { value.decision.extra = true; }],
    ['wrong completion count', function(value) { value.completion.confirmedResourceCount -= 1; value.decision.confirmedResourceCount -= 1; }],
    ['wrong identity fence', function(value) { value.identity.decisionFenceVersion = 2; }],
    ['wrong completion fence', function(value) { value.completion.decisionFenceVersion = 2; }],
    ['wrong decision fence', function(value) { value.decision.decisionFenceVersion = 2; }],
    ['incomplete row correlation', function(value) { value.identity.manifestBookingRowIds = value.identity.manifestBookingRowIds.split('|')[0]; }]
  ];
  for (const entry of malformedCases) {
    const malformed = buildEvidence(baseId, [3, 4]);
    entry[1](malformed);
    setEvidence(malformed);
    await assertRecovery(function() { return stubContext.recoveryManifestLoader(baseId); }, baseId,
      entry[0] + ' fails closed');
  }

  let vmEvidence = inRealm(stubContext, buildEvidence(baseId, [3, 4]));
  Object.defineProperty(vmEvidence.identity, 'bookingNumber', {
    enumerable: true, configurable: true, get: function() { throw new Error('getter invoked'); }
  });
  behavior = function() { return vmEvidence; };
  await assertRecovery(function() { return stubContext.recoveryManifestLoader(baseId); }, baseId,
    'accessor evidence fails closed without value access');

  vmEvidence = inRealm(stubContext, buildEvidence(baseId, [3, 4]));
  Object.setPrototypeOf(vmEvidence.decision, { inherited: true });
  behavior = function() { return vmEvidence; };
  await assertRecovery(function() { return stubContext.recoveryManifestLoader(baseId); }, baseId,
    'inherited evidence fails closed');

  vmEvidence = inRealm(stubContext, buildEvidence(baseId, [3, 4]));
  vmEvidence.acquisitions[Symbol('extra')] = true;
  behavior = function() { return vmEvidence; };
  await assertRecovery(function() { return stubContext.recoveryManifestLoader(baseId); }, baseId,
    'symbol-bearing acquisition array fails closed');

  vmEvidence = inRealm(stubContext, buildEvidence(baseId, [3, 4]));
  delete vmEvidence.acquisitions[1];
  behavior = function() { return vmEvidence; };
  await assertRecovery(function() { return stubContext.recoveryManifestLoader(baseId); }, baseId,
    'sparse acquisition evidence fails closed');

  vmEvidence = inRealm(stubContext, buildEvidence(baseId, [3, 4]));
  let ownKeyPass = 0;
  vmEvidence.decision = new Proxy(vmEvidence.decision, {
    ownKeys: function(target) {
      ownKeyPass += 1;
      const keys = Reflect.ownKeys(target);
      return ownKeyPass === 2 ? keys.slice().reverse() : keys;
    }
  });
  behavior = function() { return vmEvidence; };
  await assertRecovery(function() { return stubContext.recoveryManifestLoader(baseId); }, baseId,
    'unstable evidence key order fails closed');

  let releasePending;
  const mutationContext = evaluateWithStub(function() {
    return new Promise(function(resolve) { releasePending = resolve; });
  });
  const mutationId = 'mutationmanifest01';
  const mutationEvidence = inRealm(mutationContext, buildEvidence(mutationId, [3]));
  const pending = mutationContext.recoveryManifestLoader(mutationId);
  mutationContext.completedLoader = function() { throw new Error('replacement loader used'); };
  vm.runInContext([
    'Object.getOwnPropertyDescriptors = function() { throw new Error("mutated Object intrinsic"); };',
    'Object.getPrototypeOf = function() { throw new Error("mutated Object intrinsic"); };',
    'Reflect.ownKeys = function() { throw new Error("mutated Reflect intrinsic"); };',
    'Array.isArray = function() { return false; };',
    'Number.isInteger = function() { return false; };'
  ].join('\n'), mutationContext);
  releasePending(mutationEvidence);
  assertEqual(await pending, expectedCapability(buildEvidence(mutationId, [3]), [3]),
    'caller loader replacement and post-await intrinsic mutation cannot alter the result');

  assertEqual(/from ['"]backend\//.test(rawSource), false,
    'recovery manifest capability remains disconnected from other backend modules');
  assertEqual(/\bloadCommittedRoomRecoveryManifest\b/.test(rawSource), true,
    'focused verifier exercises the committed recovery manifest export');
  console.log(`Recovery manifest verification passed (${assertionCount} assertions).`);
})().catch(function(error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
