// Behavioral verification for disconnected physical-row recovery coordination.
// Run: node scripts/verify-room-booking-recovery-coordinator.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
  if (value && typeof value === 'object') {
    const copy = {};
    Object.keys(value).sort().forEach(function(key) { copy[key] = comparable(value[key]); });
    return copy;
  }
  return value;
}
function equal(actual, expected, message) {
  const left = JSON.stringify(comparable(actual));
  const right = JSON.stringify(comparable(expected));
  if (left !== right) throw new Error('FAIL: ' + message + '\nExpected: ' + right + '\nActual: ' + left);
  console.log('PASS: ' + message);
}
async function rejection(run, message) {
  try { await run(); } catch (error) { return error; }
  throw new Error('FAIL: ' + (message || 'expected RECOVERY_REQUIRED rejection'));
}

const backend = path.join(__dirname, '..', 'velo', 'backend');
const context = { crypto };
vm.createContext(context);
const realmDate = vm.runInContext('Date', context);
vm.runInContext('(function() {\n' +
  fs.readFileSync(path.join(backend, 'roomBookingPayloadRules.js'), 'utf8')
    .replace(/export function /g, 'function ') +
  '\nthis.canonicalizeRoomBookingCommitPayload = canonicalizeRoomBookingCommitPayload;\n}).call(this);', context);
vm.runInContext('(function() {\n' +
  fs.readFileSync(path.join(backend, 'roomBookingPayloadDigest.js'), 'utf8')
    .replace(/^import crypto from ['"]crypto['"];\s*$/m, '')
    .replace(/^import \{ canonicalizeRoomBookingCommitPayload \} from ['"].*['"];\s*$/m, '')
    .replace(/export function /g, 'function ') +
  '\nthis.computeRoomBookingPayloadDigest = computeRoomBookingPayloadDigest;\n}).call(this);', context);
const coordinatorSource = fs.readFileSync(path.join(backend, 'roomBookingRecoveryCoordinator.js'), 'utf8');
vm.runInContext('(function() {\n' + coordinatorSource
  .replace(/^import \{ computeRoomBookingPayloadDigest \}\s*from ['"]backend\/roomBookingPayloadDigest['"];\s*$/m, '')
  .replace(/export async function /g, 'async function ') +
  '\nthis.coordinatePhysicalBookingRecovery = coordinatePhysicalBookingRecovery;\n}).call(this);', context);
const make = vm.runInContext(`(function() {
  const operationId = 'recoverycoord001';
  const request = {
    operationId: operationId,
    bookingNumber: 'WC-4001',
    roomCode: 'adventure_suite',
    quantity: 2,
    checkIn: '2028-01-10',
    checkOut: '2028-01-12',
    rowProjectionPolicy: 1,
    payloadDigest: '',
    rows: [
      { index: 1, bookingRowId: 'pb1-' + operationId + '-r1', guests: 2, roomFee: 0, note: 'Late arrival' },
      { index: 2, bookingRowId: 'pb1-' + operationId + '-r2', guests: 2, roomFee: 0, note: '' }
    ]
  };
  const canonical = {
    operationId: request.operationId, bookingNumber: request.bookingNumber,
    roomCode: request.roomCode, quantity: request.quantity, checkIn: request.checkIn,
    checkOut: request.checkOut, rowProjectionPolicy: request.rowProjectionPolicy,
    rows: request.rows
  };
  request.payloadDigest = computeRoomBookingPayloadDigest(canonical);
  function manifest() {
    return {
      operationId: operationId, bookingNumber: 'WC-4001', payloadDigest: request.payloadDigest,
      roomCode: 'adventure_suite', checkIn: '2028-01-10', checkOut: '2028-01-12',
      units: [3, 4],
      bookingRowIds: ['pb1-' + operationId + '-r1', 'pb1-' + operationId + '-r2']
    };
  }
  function confirmation() {
    return { state: 'CONFIRMED', confirmed: [
      { rowId: 'pb1-' + operationId + '-r1', disposition: 'already-present' },
      { rowId: 'pb1-' + operationId + '-r2', disposition: 'inserted' }
    ] };
  }
  return { operationId: operationId, request: request, digest: request.payloadDigest,
    manifest: manifest, confirmation: confirmation };
})()`, context);
const realmClone = vm.runInContext('(value) => JSON.parse(JSON.stringify(value))', context);
const refreshDigest = vm.runInContext(`(request) => {
  request.payloadDigest = computeRoomBookingPayloadDigest({
    operationId: request.operationId, bookingNumber: request.bookingNumber,
    roomCode: request.roomCode, quantity: request.quantity, checkIn: request.checkIn,
    checkOut: request.checkOut, rowProjectionPolicy: request.rowProjectionPolicy,
    rows: request.rows
  });
}`, context);

(async function() {
  const calls = [];
  const ports = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
  ports.loadCommittedRecoveryManifest = async function(operationId) {
    calls.push(['manifest', operationId, Object.isFrozen(this)]);
    return make.manifest();
  };
  ports.appendMissingBookingRows = async function(rows) {
    calls.push(['rows', comparable(rows), Object.isFrozen(this), Object.isFrozen(rows), rows.every(Object.isFrozen)]);
    return make.confirmation();
  };
  const result = await context.coordinatePhysicalBookingRecovery(make.request, ports);
  const expectedRows = [3, 4].map(function(unit, index) {
    return {
      _id: 'pb1-' + make.operationId + '-r' + (index + 1),
      roomCode: 'adventure_suite', assignedRoom: unit, quantity: 1,
      checkIn: '2028-01-10T12:00:00.000Z', checkOut: '2028-01-12T12:00:00.000Z',
      bookingNumber: 'WC-4001', operationId: make.operationId, payloadDigest: make.digest,
      status: 'confirmed', autoOwnerBlock: false, guests: 2, roomFee: 0,
      note: index === 0 ? 'Late arrival' : ''
    };
  });
  equal(calls, [
    ['manifest', make.operationId, true],
    ['rows', expectedRows, true, true, true]
  ], 'digest-gated recovery loads the manifest then appends its exact frozen physical projection');
  equal(result, Object.assign({}, expectedRows[0], {
    checkIn: new Date(expectedRows[0].checkIn), checkOut: new Date(expectedRows[0].checkOut)
  }), 'successful recovery returns a detached primary booking row with Date values');
  equal({ checkInDate: result.checkIn instanceof realmDate, checkOutDate: result.checkOut instanceof realmDate },
    { checkInDate: true, checkOutDate: true }, 'primary timestamps are Date instances');

  async function preflightFailure(mutator, message) {
    const candidate = realmClone(make.request);
    mutator(candidate);
    let ioCalls = 0;
    const candidatePorts = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
    candidatePorts.loadCommittedRecoveryManifest = async function() { ioCalls += 1; return make.manifest(); };
    candidatePorts.appendMissingBookingRows = async function() { ioCalls += 1; return make.confirmation(); };
    const error = await rejection(function() {
      return context.coordinatePhysicalBookingRecovery(candidate, candidatePorts);
    }, message);
    equal({ message: error.message, code: error.code, operationId: error.operationId, ioCalls: ioCalls }, {
      message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED', operationId: make.operationId, ioCalls: 0
    }, message);
  }
  await preflightFailure(function(candidate) { candidate.payloadDigest = candidate.payloadDigest.toUpperCase(); },
    'uppercase digests fail before recovery I/O');
  await preflightFailure(function(candidate) { candidate.payloadDigest = '0'.repeat(64); },
    'digest mismatches fail before recovery I/O');
  await preflightFailure(function(candidate) { candidate.extra = true; },
    'extra request fields fail before recovery I/O while preserving the operation identity');
  await preflightFailure(function(candidate) { candidate.rows[0].assignedRoom = 5; },
    'caller-controlled room assignments are rejected before recovery I/O');
  await preflightFailure(function(candidate) {
    Object.defineProperty(candidate.rows[0], 'note', { enumerable: true, get: function() { throw new Error('getter'); } });
  }, 'request accessors are rejected without execution or I/O');
  await preflightFailure(function(candidate) { candidate.rows[Symbol('extra')] = true; },
    'symbol-bearing row arrays fail before recovery I/O');
  await preflightFailure(function(candidate) { delete candidate.rows[1]; },
    'sparse request rows fail before recovery I/O');
  const alternatingProxyFactory = vm.runInContext(`(target) => {
    target.extra = true;
    let calls = 0;
    const complete = Reflect.ownKeys(target);
    const exact = complete.filter(key => key !== 'extra');
    return new Proxy(target, {
      ownKeys: function() {
        calls += 1;
        return calls === 4 ? exact : complete;
      }
    });
  }`, context);
  const alternatingRequest = alternatingProxyFactory(realmClone(make.request));
  let alternatingIo = 0;
  const alternatingPorts = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
  alternatingPorts.loadCommittedRecoveryManifest = async function() { alternatingIo += 1; return make.manifest(); };
  alternatingPorts.appendMissingBookingRows = async function() { alternatingIo += 1; return make.confirmation(); };
  const alternatingError = await rejection(function() {
    return context.coordinatePhysicalBookingRecovery(alternatingRequest, alternatingPorts);
  });
  equal({ code: alternatingError.code, operationId: alternatingError.operationId, ioCalls: alternatingIo }, {
    code: 'RECOVERY_REQUIRED', operationId: make.operationId, ioCalls: 0
  }, 'alternating proxy topology cannot hide an extra request field between descriptor reads');

  async function candidateFailure(candidate, message, expectedOperationId) {
    let ioCalls = 0;
    const candidatePorts = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
    candidatePorts.loadCommittedRecoveryManifest = async function() { ioCalls += 1; return make.manifest(); };
    candidatePorts.appendMissingBookingRows = async function() { ioCalls += 1; return make.confirmation(); };
    const error = await rejection(function() {
      return context.coordinatePhysicalBookingRecovery(candidate, candidatePorts);
    }, message);
    equal({ code: error.code, operationId: error.operationId, ioCalls: ioCalls }, {
      code: 'RECOVERY_REQUIRED', operationId: expectedOperationId, ioCalls: 0
    }, message);
  }
  const customPrototypeRequest = realmClone(make.request);
  Object.setPrototypeOf(customPrototypeRequest, {});
  await candidateFailure(customPrototypeRequest,
    'custom-prototype request records fail closed before recovery I/O', undefined);

  context.__candidate = realmClone(make.request);
  const firstKeySequenceRequest = vm.runInContext(`(function(target) {
    target.extra = true;
    let calls = 0;
    const complete = Reflect.ownKeys(target);
    const exact = complete.filter(function(key) { return key !== 'extra'; });
    return new Proxy(target, { ownKeys: function() { calls += 1; return calls <= 3 ? complete : exact; } });
  })(__candidate)`, context);
  delete context.__candidate;
  await candidateFailure(firstKeySequenceRequest,
    'the first descriptor key sequence must match the request key sequence', make.operationId);

  context.__candidate = realmClone(make.request);
  const secondKeySequenceRequest = vm.runInContext(`(function(target) {
    target.extra = true;
    let calls = 0;
    const complete = Reflect.ownKeys(target);
    const exact = complete.filter(function(key) { return key !== 'extra'; });
    return new Proxy(target, { ownKeys: function() { calls += 1; return calls === 5 ? complete : exact; } });
  })(__candidate)`, context);
  delete context.__candidate;
  await candidateFailure(secondKeySequenceRequest,
    'the request key sequence must match the second descriptor key sequence', make.operationId);

  await preflightFailure(function(candidate) {
    Object.defineProperty(candidate, 'bookingNumber', {
      value: candidate.bookingNumber, enumerable: false, writable: true, configurable: true
    });
  }, 'non-enumerable request record fields fail before recovery I/O');
  await preflightFailure(function(candidate) {
    context.__rows = candidate.rows;
    candidate.rows = vm.runInContext(`(function(rows) {
      let reads = 0;
      return new Proxy(rows, { getOwnPropertyDescriptor: function(target, key) {
        if (key === 'length' && (reads += 1) === 2) Object.defineProperty(target, 'length', { writable: false });
        return Reflect.getOwnPropertyDescriptor(target, key);
      } });
    })(__rows)`, context);
    delete context.__rows;
  }, 'array length descriptors must remain stable across the snapshot');
  await preflightFailure(function(candidate) {
    candidate.rows.extra = true;
    context.__rows = candidate.rows;
    candidate.rows = vm.runInContext("new Proxy(__rows, { ownKeys: function() { return ['0', '1', 'extra', 'length']; } })", context);
    delete context.__rows;
  }, 'dense arrays reject additional own keys beyond indexes and length');
  await preflightFailure(function(candidate) {
    context.__rows = candidate.rows;
    candidate.rows = vm.runInContext("new Proxy(__rows, { ownKeys: function() { return ['1', '0', 'length']; } })", context);
    delete context.__rows;
  }, 'dense array index keys must appear in canonical index order');
  await preflightFailure(function(candidate) {
    Object.defineProperty(candidate.rows, '0', {
      value: candidate.rows[0], enumerable: false, writable: true, configurable: true
    });
  }, 'non-enumerable dense array items fail before recovery I/O');

  async function manifestFailure(mutator, message) {
    const candidate = realmClone(make.request);
    const manifest = make.manifest();
    mutator(manifest);
    let appendCalls = 0;
    const candidatePorts = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
    candidatePorts.loadCommittedRecoveryManifest = async function() { return manifest; };
    candidatePorts.appendMissingBookingRows = async function() { appendCalls += 1; return make.confirmation(); };
    const error = await rejection(function() {
      return context.coordinatePhysicalBookingRecovery(candidate, candidatePorts);
    });
    equal({ message: error.message, code: error.code, operationId: error.operationId, appendCalls: appendCalls }, {
      message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED', operationId: make.operationId, appendCalls: 0
    }, message);
  }
  const scalarMutations = [
    ['operationId', 'otheroperation001'], ['bookingNumber', 'WC-OTHER'],
    ['payloadDigest', 'f'.repeat(64)], ['roomCode', 'penthouse_apartment'],
    ['checkIn', '2028-01-11'], ['checkOut', '2028-01-13']
  ];
  for (const mutation of scalarMutations) {
    await manifestFailure(function(manifest) { manifest[mutation[0]] = mutation[1]; },
      'manifest ' + mutation[0] + ' must bind to the canonical request');
  }
  await manifestFailure(function(manifest) { manifest.units = [3]; },
    'manifest unit count must bind to quantity');
  await manifestFailure(function(manifest) { manifest.bookingRowIds[1] = manifest.bookingRowIds[0]; },
    'manifest row IDs must bind positionally to canonical rows');
  await manifestFailure(function(manifest) { manifest.units[1] = 5; },
    'manifest units must form the authoritative normalized room topology');
  await manifestFailure(function(manifest) { manifest.units[0] = 3.5; },
    'manifest units must be safe numeric unit integers');
  await manifestFailure(function(manifest) { manifest.extra = true; },
    'extra manifest fields cannot authorize persistence');
  await manifestFailure(function(manifest) {
    Object.defineProperty(manifest, 'roomCode', { enumerable: true, get: function() { throw new Error('getter'); } });
  }, 'manifest accessors are rejected without reaching persistence');
  await manifestFailure(function(manifest) { manifest.units[Symbol('extra')] = 3; },
    'symbol-bearing manifest arrays are rejected');
  await manifestFailure(function(manifest) { delete manifest.bookingRowIds[1]; },
    'sparse manifest arrays are rejected');
  await manifestFailure(function(manifest) { Object.setPrototypeOf(manifest.units, {}); },
    'custom manifest array prototypes are rejected');

  async function recoveryCase(candidate, manifest, confirmation, expected, message) {
    let ioCalls = 0;
    const candidatePorts = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
    candidatePorts.loadCommittedRecoveryManifest = async function() { ioCalls += 1; return manifest; };
    candidatePorts.appendMissingBookingRows = async function() { ioCalls += 1; return confirmation; };
    let value;
    let error;
    try { value = await context.coordinatePhysicalBookingRecovery(candidate, candidatePorts); }
    catch (caught) { error = caught; }
    equal({ fulfilled: !error, code: error && error.code, ioCalls: ioCalls,
      roomCode: value && value.roomCode }, expected, message);
  }
  const manifestRoomCodeRequest = realmClone(make.request);
  manifestRoomCodeRequest.quantity = 1;
  manifestRoomCodeRequest.rows.length = 1;
  refreshDigest(manifestRoomCodeRequest);
  const manifestRoomCode = make.manifest();
  manifestRoomCode.payloadDigest = manifestRoomCodeRequest.payloadDigest;
  manifestRoomCode.roomCode = 'penthouse_apartment';
  manifestRoomCode.units = realmClone([1]);
  manifestRoomCode.bookingRowIds.length = 1;
  const manifestRoomCodeConfirmation = make.confirmation();
  manifestRoomCodeConfirmation.confirmed.length = 1;
  await recoveryCase(manifestRoomCodeRequest, manifestRoomCode, manifestRoomCodeConfirmation,
    { fulfilled: false, code: 'RECOVERY_REQUIRED', ioCalls: 1 },
    'manifest roomCode must exactly bind to the canonical request roomCode');

  const manifestUnitCount = make.manifest();
  manifestUnitCount.units = realmClone([3, 4, 5]);
  await recoveryCase(realmClone(make.request), manifestUnitCount, make.confirmation(),
    { fulfilled: false, code: 'RECOVERY_REQUIRED', ioCalls: 1 },
    'manifest unit count must equal canonical request quantity even for a valid topology');

  async function topologyFailure(roomCode, guests, unit, message) {
    const candidate = realmClone(make.request);
    candidate.roomCode = roomCode;
    candidate.quantity = 1;
    candidate.rows.length = 1;
    candidate.rows[0].guests = guests;
    refreshDigest(candidate);
    const manifest = make.manifest();
    manifest.payloadDigest = candidate.payloadDigest;
    manifest.roomCode = roomCode;
    manifest.units = realmClone([unit]);
    manifest.bookingRowIds.length = 1;
    const confirmation = make.confirmation();
    confirmation.confirmed.length = 1;
    await recoveryCase(candidate, manifest, confirmation,
      { fulfilled: false, code: 'RECOVERY_REQUIRED', ioCalls: 1 }, message);
  }
  await topologyFailure('penthouse_apartment', 2, 2,
    'penthouse recovery rejects physical unit 2');
  await topologyFailure('two_bedroom_apartment', 3, 1,
    'two-bedroom recovery rejects physical unit 1');
  await topologyFailure('adventure_suite', 2, 5,
    'single-unit adventure recovery rejects physical unit 5');

  const tripleRequest = realmClone(make.request);
  tripleRequest.quantity = 3;
  tripleRequest.rows.push(realmClone({
    index: 3, bookingRowId: 'pb1-' + make.operationId + '-r3', guests: 2, roomFee: 0, note: ''
  }));
  refreshDigest(tripleRequest);
  const tripleManifest = make.manifest();
  tripleManifest.payloadDigest = tripleRequest.payloadDigest;
  tripleManifest.units = realmClone([3, 4, 5]);
  tripleManifest.bookingRowIds.push('pb1-' + make.operationId + '-r3');
  const tripleConfirmation = make.confirmation();
  tripleConfirmation.confirmed.push(realmClone({
    rowId: 'pb1-' + make.operationId + '-r3', disposition: 'inserted'
  }));
  await recoveryCase(tripleRequest, tripleManifest, tripleConfirmation,
    { fulfilled: true, ioCalls: 2, roomCode: 'adventure_suite' },
    'adventure recovery accepts the authoritative three-unit topology [3,4,5]');

  async function confirmationFailure(mutator, message) {
    const confirmation = make.confirmation();
    mutator(confirmation);
    let appendCalls = 0;
    const candidatePorts = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
    candidatePorts.loadCommittedRecoveryManifest = async function() { return make.manifest(); };
    candidatePorts.appendMissingBookingRows = async function() { appendCalls += 1; return confirmation; };
    const error = await rejection(function() {
      return context.coordinatePhysicalBookingRecovery(realmClone(make.request), candidatePorts);
    }, message);
    equal({ message: error.message, code: error.code, operationId: error.operationId, appendCalls: appendCalls }, {
      message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED', operationId: make.operationId, appendCalls: 1
    }, message);
  }
  await confirmationFailure(function(value) { value.state = 'STOPPED'; },
    'only an exact CONFIRMED append state succeeds');
  await confirmationFailure(function(value) { value.confirmed.pop(); },
    'confirmation must cover every expected physical row');
  await confirmationFailure(function(value) { value.confirmed.reverse(); },
    'confirmation order must match expected row order');
  await confirmationFailure(function(value) { value.confirmed[0].rowId = 'wrong'; },
    'confirmation row IDs bind to detached expected IDs');
  await confirmationFailure(function(value) { value.confirmed[0].disposition = 'updated'; },
    'confirmation dispositions are closed to inserted and already-present');
  await confirmationFailure(function(value) { value.confirmed[0].extra = true; },
    'extra confirmation item fields fail closed');
  await confirmationFailure(function(value) { value.extra = true; },
    'extra confirmation envelope fields fail closed');
  await confirmationFailure(function(value) { delete value.confirmed[1]; },
    'sparse confirmation arrays fail closed');
  await confirmationFailure(function(value) {
    Object.defineProperty(value.confirmed[0], 'rowId', { enumerable: true, get: function() { throw new Error('getter'); } });
  }, 'confirmation accessors fail closed without execution');
  await confirmationFailure(function(value) { value.confirmed[Symbol('extra')] = true; },
    'confirmation symbols fail closed');
  await confirmationFailure(function(value) { value.state = 'confirmed'; },
    'lowercase confirmed append state fails closed');

  const canonicalizationErrorRequest = realmClone(make.request);
  canonicalizationErrorRequest.bookingNumber = ' bad';
  let canonicalizationIo = 0;
  const canonicalizationPorts = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
  canonicalizationPorts.loadCommittedRecoveryManifest = async function() { canonicalizationIo += 1; return make.manifest(); };
  canonicalizationPorts.appendMissingBookingRows = async function() { canonicalizationIo += 1; return make.confirmation(); };
  const canonicalizationError = await rejection(function() {
    return context.coordinatePhysicalBookingRecovery(canonicalizationErrorRequest, canonicalizationPorts);
  });
  equal({ message: canonicalizationError.message, code: canonicalizationError.code,
    operationId: canonicalizationError.operationId, ioCalls: canonicalizationIo }, {
    message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED', operationId: make.operationId, ioCalls: 0
  }, 'preflight canonicalization errors normalize to the exact recovery boundary');

  const delayedRequest = realmClone(make.request);
  const delayedManifest = make.manifest();
  const delayedConfirmation = make.confirmation();
  let resolveManifest;
  const pendingManifest = new Promise(function(resolve) { resolveManifest = resolve; });
  const hardenedCalls = [];
  const hardenedPorts = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
  hardenedPorts.loadCommittedRecoveryManifest = function() {
    hardenedCalls.push('captured-manifest');
    return pendingManifest;
  };
  hardenedPorts.appendMissingBookingRows = async function(rows) {
    hardenedCalls.push(['captured-append', comparable(rows)]);
    delayedManifest.units[0] = 5;
    delayedManifest.bookingRowIds[0] = 'mutated-after-snapshot';
    return delayedConfirmation;
  };
  const hardenedRun = context.coordinatePhysicalBookingRecovery(delayedRequest, hardenedPorts);
  delayedRequest.bookingNumber = 'MUTATED-CALLER';
  delayedRequest.rows[0].guests = 99;
  hardenedPorts.loadCommittedRecoveryManifest = async function() { throw new Error('redirected manifest'); };
  hardenedPorts.appendMissingBookingRows = async function() { throw new Error('redirected append'); };
  vm.runInContext(`
    this.__savedIntrinsics = {
      create: Object.create,
      descriptors: Object.getOwnPropertyDescriptors,
      prototype: Object.getPrototypeOf,
      apply: Reflect.apply,
      indexOf: Array.prototype.indexOf,
      resolve: Promise.resolve,
      Error: Error,
      Date: Date
    };
    Object.create = function() { throw new Error('mutated create'); };
    Object.getOwnPropertyDescriptors = function() { throw new Error('mutated descriptors'); };
    Object.getPrototypeOf = function() { throw new Error('mutated prototype'); };
    Reflect.apply = function() { throw new Error('mutated apply'); };
    Array.prototype.indexOf = function() { throw new Error('mutated indexOf'); };
    Promise.resolve = function() { throw new Error('mutated resolve'); };
    this.Error = function() { throw new __savedIntrinsics.Error('mutated Error'); };
    this.Date = function() { throw new __savedIntrinsics.Error('mutated Date'); };
  `, context);
  resolveManifest(delayedManifest);
  let hardenedResult;
  try {
    hardenedResult = await hardenedRun;
  } finally {
    vm.runInContext(`
      Object.create = __savedIntrinsics.create;
      Object.getOwnPropertyDescriptors = __savedIntrinsics.descriptors;
      Object.getPrototypeOf = __savedIntrinsics.prototype;
      Reflect.apply = __savedIntrinsics.apply;
      Array.prototype.indexOf = __savedIntrinsics.indexOf;
      Promise.resolve = __savedIntrinsics.resolve;
      this.Error = __savedIntrinsics.Error;
      this.Date = __savedIntrinsics.Date;
      delete this.__savedIntrinsics;
    `, context);
  }
  equal({ result: hardenedResult, calls: hardenedCalls }, {
    result: Object.assign({}, expectedRows[0], {
      checkIn: new Date(expectedRows[0].checkIn), checkOut: new Date(expectedRows[0].checkOut)
    }),
    calls: ['captured-manifest', ['captured-append', expectedRows]]
  }, 'caller, port, manifest, constructor, and intrinsic mutation after suspension cannot redirect recovery');

  async function postAwaitGlobalSuccess(mutateSource, restoreSource, message) {
    let resolveLoaded;
    const pendingLoaded = new Promise(function(resolve) { resolveLoaded = resolve; });
    let appendCalls = 0;
    const candidatePorts = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
    candidatePorts.loadCommittedRecoveryManifest = function() { return pendingLoaded; };
    candidatePorts.appendMissingBookingRows = async function() { appendCalls += 1; return make.confirmation(); };
    const pending = context.coordinatePhysicalBookingRecovery(realmClone(make.request), candidatePorts);
    vm.runInContext(mutateSource, context);
    resolveLoaded(make.manifest());
    let value;
    let error;
    try { value = await pending; }
    catch (caught) { error = caught; }
    finally { vm.runInContext(restoreSource, context); }
    equal({ fulfilled: !error, id: value && value._id, appendCalls: appendCalls }, {
      fulfilled: true, id: 'pb1-' + make.operationId + '-r1', appendCalls: 1
    }, message);
  }
  await postAwaitGlobalSuccess(
    "this.__savedPostAwaitArray = Array; this.Array = function() { throw new Error('MUTATED_ARRAY'); };",
    'this.Array = __savedPostAwaitArray; delete this.__savedPostAwaitArray;',
    'post-await expected-row allocation ignores replacement of the global Array constructor');
  await postAwaitGlobalSuccess(
    "this.__savedPostAwaitFreeze = Object.freeze; Object.freeze = function() { throw new Error('MUTATED_FREEZE_ROW'); };",
    'Object.freeze = __savedPostAwaitFreeze; delete this.__savedPostAwaitFreeze;',
    'post-await row freezing ignores replacement of global Object.freeze');
  await postAwaitGlobalSuccess(
    "this.__savedPostAwaitFreeze = Object.freeze; Object.freeze = function() { throw new Error('MUTATED_FREEZE_ROWS'); };",
    'Object.freeze = __savedPostAwaitFreeze; delete this.__savedPostAwaitFreeze;',
    'post-await rows-array freezing ignores replacement of global Object.freeze');

  async function portFailure(failingPort, message) {
    const candidatePorts = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
    candidatePorts.loadCommittedRecoveryManifest = failingPort === 'manifest'
      ? async function() { throw new Error('transport'); }
      : async function() { return make.manifest(); };
    candidatePorts.appendMissingBookingRows = failingPort === 'append'
      ? async function() { throw new Error('transport'); }
      : async function() { return make.confirmation(); };
    const error = await rejection(function() {
      return context.coordinatePhysicalBookingRecovery(realmClone(make.request), candidatePorts);
    });
    equal({ message: error.message, code: error.code, operationId: error.operationId }, {
      message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED', operationId: make.operationId
    }, message);
  }
  await portFailure('manifest', 'manifest loader rejection collapses to the exact recovery boundary');
  await portFailure('append', 'append rejection collapses to the exact recovery boundary');

  async function inheritedIndexPoisonCase(suspension) {
    let resolveManifestPoison;
    let resolveAppendPoison;
    let signalAppendStarted;
    const pendingManifestPoison = new Promise(function(resolve) { resolveManifestPoison = resolve; });
    const pendingAppendPoison = new Promise(function(resolve) { resolveAppendPoison = resolve; });
    const appendStarted = new Promise(function(resolve) { signalAppendStarted = resolve; });
    let appendOwnIndex = false;
    let appendedPoison = false;
    const poisonPorts = vm.runInContext('({ loadCommittedRecoveryManifest: null, appendMissingBookingRows: null })', context);
    poisonPorts.loadCommittedRecoveryManifest = function() {
      return suspension === 'manifest' ? pendingManifestPoison : make.manifest();
    };
    poisonPorts.appendMissingBookingRows = function(rows) {
      appendOwnIndex = Object.prototype.hasOwnProperty.call(rows, '0');
      appendedPoison = rows[0] === context.__arrayIndexPoison;
      signalAppendStarted();
      return suspension === 'append' ? pendingAppendPoison : make.confirmation();
    };
    const pending = context.coordinatePhysicalBookingRecovery(realmClone(make.request), poisonPorts);
    if (suspension === 'append') await appendStarted;
    vm.runInContext(`
      this.__savedArrayPrototypeZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
      this.__arrayIndexPoison = Object.freeze({ inherited: true });
      Object.defineProperty(Array.prototype, '0', {
        value: __arrayIndexPoison, enumerable: false, writable: false, configurable: true
      });
    `, context);
    if (suspension === 'manifest') resolveManifestPoison(make.manifest());
    else resolveAppendPoison(make.confirmation());
    let value;
    let error;
    try { value = await pending; }
    catch (caught) { error = caught; }
    finally {
      vm.runInContext(`
        if (__savedArrayPrototypeZero) {
          Object.defineProperty(Array.prototype, '0', __savedArrayPrototypeZero);
        } else {
          delete Array.prototype[0];
        }
        delete this.__savedArrayPrototypeZero;
        delete this.__arrayIndexPoison;
      `, context);
    }
    return { fulfilled: !error, id: value && value._id, appendOwnIndex: appendOwnIndex,
      appendedPoison: appendedPoison };
  }
  const pendingManifestPoisonResult = await inheritedIndexPoisonCase('manifest');
  const pendingAppendPoisonResult = await inheritedIndexPoisonCase('append');
  equal({ manifest: pendingManifestPoisonResult, append: pendingAppendPoisonResult }, {
    manifest: { fulfilled: true, id: 'pb1-' + make.operationId + '-r1',
      appendOwnIndex: true, appendedPoison: false },
    append: { fulfilled: true, id: 'pb1-' + make.operationId + '-r1',
      appendOwnIndex: true, appendedPoison: false }
  }, 'B2-01 pending manifest and append recovery ignores non-writable inherited Array index properties');

  console.log('Room booking recovery coordinator verifier passed.');
})().catch(function(error) { console.error(error); process.exitCode = 1; });
