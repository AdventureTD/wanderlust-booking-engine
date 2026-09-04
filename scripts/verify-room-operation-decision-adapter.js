// Behavioral verifier for the disconnected operation-decision adapter.
// Run: node scripts/verify-room-operation-decision-adapter.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    const copy = {};
    Reflect.ownKeys(value).filter(function(key) { return typeof key === 'string'; }).sort()
      .forEach(function(key) { copy[key] = comparable(value[key]); });
    return copy;
  }
  return value;
}
function assertEqual(actual, expected, message) {
  const left = JSON.stringify(comparable(actual));
  const right = JSON.stringify(comparable(expected));
  if (left !== right) throw new Error('FAIL: ' + message + '\nExpected: ' + right + '\nActual:   ' + left);
  console.log('PASS: ' + message);
}
function assertThrows(run, message) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  if (!error || error.message !== 'Invalid claim ledger') {
    throw new Error('FAIL: ' + message + '\nActual: ' + (error && error.message));
  }
  console.log('PASS: ' + message);
}

const source = fs.readFileSync(path.join(__dirname, '..', 'velo', 'backend', 'roomBookingCommit.js'), 'utf8')
  .replace(/^import .*;\s*$/gm, '')
  .replace(/export async function /g, 'async function ')
  + '\nthis.adapter = { appendRoomOperationDecision: typeof appendRoomOperationDecision === "function" ? appendRoomOperationDecision : null, appendRoomClaimEvents };';
function loadDecisionContext() {
  const loaded = { wixData: {} };
  vm.createContext(loaded);
  vm.runInContext(source, loaded);
  return loaded;
}
const context = loadDecisionContext();

const operationId = 'decisionoperation001';
const identity = {
  _id: 'rc1-op-' + operationId + '-a', protocolVersion: 1,
  claimKey: 'operation:' + operationId, generation: 1, eventType: 'acquire',
  claimType: 'operation', operationId: operationId,
  bookingRowId: 'pb1-' + operationId + '-r1', bookingNumber: 'WC-DECISION-1',
  payloadDigest: 'a'.repeat(64), decisionFenceVersion: 1, manifestVersion: 1,
  manifestCheckIn: '2027-11-05', manifestCheckOut: '2027-11-06',
  manifestRoomCode: 'adventure_suite', manifestUnits: '3',
  manifestBookingRowIds: 'pb1-' + operationId + '-r1',
  manifestResourceClaimIds: 'rc1-20271105-s1-000001-a|rc1-20271105-u3-000001-a'
};
const capacity = {
  _id: 'rc1-20271105-s1-000001-a', protocolVersion: 1,
  claimKey: 'capacity:2027-11-05:1', generation: 1, eventType: 'acquire',
  claimType: 'capacity', night: '2027-11-05', capacitySlot: 1,
  operationId: operationId, bookingRowId: identity.bookingRowId,
  bookingNumber: identity.bookingNumber, payloadDigest: identity.payloadDigest
};
const unit = {
  _id: 'rc1-20271105-u3-000001-a', protocolVersion: 1,
  claimKey: 'unit:2027-11-05:3', generation: 1, eventType: 'acquire',
  claimType: 'unit', night: '2027-11-05', unit: 3,
  operationId: operationId, bookingRowId: identity.bookingRowId,
  bookingNumber: identity.bookingNumber, payloadDigest: identity.payloadDigest
};
function completion(state, count, marked) {
  const value = {
    _id: 'rc1-op-' + operationId + '-c', protocolVersion: 1,
    claimKey: 'operation:' + operationId + ':completion', generation: 1,
    eventType: 'complete', claimType: 'operation-completion', operationId: operationId,
    bookingRowId: identity.bookingRowId, bookingNumber: identity.bookingNumber,
    payloadDigest: identity.payloadDigest, completionState: state,
    confirmedResourceCount: count
  };
  if (marked !== false) value.decisionFenceVersion = 1;
  return value;
}
function expectedDecision(state, completionState, count) {
  return {
    _id: 'rc1-op-' + operationId + '-d', protocolVersion: 1,
    claimKey: 'operation:' + operationId + ':decision', generation: 1,
    eventType: 'decide', claimType: 'operation-decision', operationId: operationId,
    bookingRowId: identity.bookingRowId, bookingNumber: identity.bookingNumber,
    payloadDigest: identity.payloadDigest, decisionFenceVersion: 1,
    operationIdentityId: identity._id,
    operationCompletionId: 'rc1-op-' + operationId + '-c', manifestVersion: 1,
    completionState: completionState, confirmedResourceCount: count, decisionState: state
  };
}
function stopped(classification) {
  return { state: 'STOPPED', confirmed: [], failed: {
    index: 0, eventId: 'rc1-op-' + operationId + '-d', classification: classification
  } };
}
function makeStore(terminal) {
  return new Map([identity, capacity, unit, terminal].map(function(item) { return [item._id, Object.assign({}, item)]; }));
}
function install(store, behavior, calls) {
  context.wixData = {
    get: function(collection, id, options) {
      calls.push({ type: 'get', collection, id, options });
      return Promise.resolve(store.get(id) || null);
    },
    insert: function(collection, item, options) {
      calls.push({ type: 'insert', collection, item, options });
      if (behavior === 'throw-after-write') {
        store.set(item._id, Object.assign({}, item));
        return Promise.reject(new Error('timeout'));
      }
      if (store.has(item._id)) return Promise.reject(new Error('WDE0074'));
      store.set(item._id, Object.assign({}, item));
      return Promise.resolve({ _id: 'untrusted' });
    }
  };
}

(async function() {
  assertEqual(typeof context.adapter.appendRoomOperationDecision, 'function',
    'adapter exports the backend-only operation decision function');

  const rulesSource = fs.readFileSync(path.join(__dirname, '..', 'velo', 'backend',
    'roomBookingCommitRules.js'), 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/export function /g, 'function ')
    + '\nthis.internal = { validateClaimLedger, claimState };';
  const rulesContext = { evaluateAutomaticAvailability: function() {} };
  vm.createContext(rulesContext);
  vm.runInContext(rulesSource, rulesContext);
  const validLedger = [identity, capacity, unit, completion('complete', 2),
    expectedDecision('commit-rows', 'complete', 2)];
  rulesContext.internal.validateClaimLedger(validLedger);
  assertEqual(rulesContext.internal.claimState(validLedger,
    'operation:' + operationId + ':decision'), {
    active: false, acquisition: null, nextGeneration: 1
  }, 'decision events validate but are excluded from resource claim history');
  const malformedLedgerDecision = Object.assign({}, validLedger[4], { operationCompletionId: 'wrong' });
  assertThrows(function() {
    rulesContext.internal.validateClaimLedger(validLedger.slice(0, 4).concat([malformedLedgerDecision]));
  }, 'general ledger rejects an incorrectly bound decision event');
  const unitRelease = Object.assign({}, unit, {
    _id: unit._id.slice(0, -1) + 'r',
    eventType: 'release',
    releaseReason: 'decision fence test'
  });
  assertThrows(function() {
    rulesContext.internal.validateClaimLedger(validLedger.concat([unitRelease]));
  }, 'general ledger rejects commit decision plus unit release');
  assertThrows(function() {
    rulesContext.internal.validateClaimLedger(validLedger.slice(0, 4).concat([unitRelease]));
  }, 'general ledger rejects marked releases without a compensate decision');
  rulesContext.internal.validateClaimLedger(validLedger.slice(0, 4).concat([
    expectedDecision('compensate', 'complete', 2), unitRelease
  ]));
  assertEqual(true, true, 'general ledger accepts exact compensate decision plus reverse release suffix');
  let inheritedDecisionGetterCalls = 0;
  const inheritedDecisionPrototype = {};
  Object.defineProperty(inheritedDecisionPrototype, 'decisionState', {
    enumerable: true,
    configurable: true,
    get: function() {
      inheritedDecisionGetterCalls += 1;
      return 'commit-rows';
    }
  });
  const inheritedDecision = Object.assign({}, expectedDecision('commit-rows', 'complete', 2));
  delete inheritedDecision.decisionState;
  Object.setPrototypeOf(inheritedDecision, inheritedDecisionPrototype);
  assertThrows(function() {
    rulesContext.internal.validateClaimLedger(validLedger.slice(0, 4).concat([inheritedDecision]));
  }, 'general ledger rejects inherited decision fields');
  assertEqual(inheritedDecisionGetterCalls, 0,
    'general ledger rejects inherited decision accessors without executing hooks');
  let inheritedClaimTypeGetterCalls = 0;
  const inheritedClaimTypePrototype = {};
  Object.defineProperty(inheritedClaimTypePrototype, 'claimType', {
    enumerable: true,
    configurable: true,
    get: function() {
      inheritedClaimTypeGetterCalls += 1;
      return 'operation-decision';
    }
  });
  const inheritedClaimTypeDecision = Object.assign({}, expectedDecision('commit-rows', 'complete', 2));
  delete inheritedClaimTypeDecision.claimType;
  Object.setPrototypeOf(inheritedClaimTypeDecision, inheritedClaimTypePrototype);
  assertThrows(function() {
    rulesContext.internal.validateClaimLedger(validLedger.slice(0, 4).concat([inheritedClaimTypeDecision]));
  }, 'general ledger rejects an inherited decision discriminator');
  assertEqual(inheritedClaimTypeGetterCalls, 0,
    'general ledger rejects inherited decision discriminators without executing hooks');

  let calls = [];
  let store = makeStore(completion('complete', 2));
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'), {
    state: 'CONFIRMED', confirmed: [{ eventId: 'rc1-op-' + operationId + '-d', disposition: 'inserted' }]
  }, 'complete full acquisition prefix confirms commit decision');
  assertEqual(store.get('rc1-op-' + operationId + '-d'), expectedDecision('commit-rows', 'complete', 2),
    'commit decision has the exact deterministic schema');
  assertEqual(calls.map(function(call) { return call.type + ':' + (call.id || call.item._id); }), [
    'get:' + identity._id, 'get:' + capacity._id, 'get:' + unit._id,
    'get:rc1-op-' + operationId + '-c', 'get:rc1-op-' + operationId + '-d',
    'get:rc1-20271105-s1-000001-r', 'get:rc1-20271105-u3-000001-r',
    'insert:rc1-op-' + operationId + '-d', 'get:rc1-op-' + operationId + '-d'
  ], 'fresh eligibility reads use exact deterministic order and decision readback');
  assertEqual({
    allFrozen: calls.every(function(call) { return Object.isFrozen(call.options); }),
    uniqueOptions: new Set(calls.map(function(call) { return call.options; })).size === calls.length,
    ordinary: calls.every(function(call) {
      const prototype = Object.getPrototypeOf(call.options);
      return prototype !== null && Object.getPrototypeOf(prototype) === null;
    }),
    readFlags: calls.filter(function(call) { return call.type === 'get'; }).map(function(call) {
      return {
        suppressAuth: call.options.suppressAuth,
        consistentRead: call.options.consistentRead,
        suppressHooks: call.options.suppressHooks
      };
    }),
    writeFlags: calls.filter(function(call) { return call.type === 'insert'; }).map(function(call) {
      return {
        suppressAuth: call.options.suppressAuth,
        hasConsistentRead: Object.prototype.hasOwnProperty.call(call.options, 'consistentRead'),
        suppressHooks: call.options.suppressHooks
      };
    })
  }, {
    allFrozen: true, uniqueOptions: true, ordinary: true,
    readFlags: Array(8).fill({ suppressAuth: true, consistentRead: true, suppressHooks: true }),
    writeFlags: [{ suppressAuth: true, hasConsistentRead: false, suppressHooks: true }]
  }, 'every I/O receives fresh immutable options with exact read and write flags');

  calls = [];
  store = makeStore(completion('complete', 2));
  install(store, 'throw-after-write', calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'compensate'), {
    state: 'CONFIRMED', confirmed: [{ eventId: 'rc1-op-' + operationId + '-d', disposition: 'already-present' }]
  }, 'ambiguous insert outcome reconciles only from authoritative readback');

  calls = [];
  store = new Map([identity, capacity, completion('stopped', 1)].map(function(item) {
    return [item._id, Object.assign({}, item)];
  }));
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'compensate'), {
    state: 'CONFIRMED', confirmed: [{ eventId: 'rc1-op-' + operationId + '-d', disposition: 'inserted' }]
  }, 'stopped exact strict prefix authorizes compensation');

  calls = [];
  const foreignOperationId = 'foreignoperation0001';
  const foreignUnit = Object.assign({}, unit, {
    operationId: foreignOperationId,
    bookingRowId: 'pb1-' + foreignOperationId + '-r1',
    bookingNumber: 'WC-FOREIGN-1',
    payloadDigest: 'b'.repeat(64)
  });
  store = new Map([identity, capacity, foreignUnit, completion('stopped', 1)].map(function(item) {
    return [item._id, Object.assign({}, item)];
  }));
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'compensate'), {
    state: 'CONFIRMED', confirmed: [{ eventId: 'rc1-op-' + operationId + '-d', disposition: 'inserted' }]
  }, 'foreign resource contention terminates the owned prefix and authorizes compensation');

  calls = [];
  store = new Map([identity, capacity, completion('stopped', 1)].map(function(item) {
    return [item._id, Object.assign({}, item)];
  }));
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('INTEGRITY'), 'stopped completion cannot authorize commit');
  assertEqual(calls.filter(function(call) { return call.type === 'insert'; }).length, 0,
    'ineligible operation performs zero writes');

  const legacyIdentity = Object.assign({}, identity); delete legacyIdentity.decisionFenceVersion;
  const legacyCompletion = completion('complete', 2, false);
  calls = [];
  store = new Map([legacyIdentity, capacity, unit, legacyCompletion].map(function(item) {
    return [item._id, item];
  }));
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'compensate'),
    stopped('LEGACY_UNFENCED'), 'legacy unmarked operation fails closed');
  assertEqual(calls.length, 1, 'legacy marker failure stops after identity read');

  calls = [];
  store = makeStore(completion('complete', 2));
  store.set('rc1-20271105-u3-000001-r', Object.assign({}, unit, {
    _id: 'rc1-20271105-u3-000001-r', eventType: 'release', releaseReason: 'prior'
  }));
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'compensate'),
    stopped('INTEGRITY'), 'fresh decision rejects an existing release');

  calls = [];
  store = makeStore(completion('complete', 2));
  store.set('rc1-op-' + operationId + '-d', expectedDecision('compensate', 'complete', 2));
  store.set('rc1-20271105-u3-000001-r', Object.assign({}, unit, {
    _id: 'rc1-20271105-u3-000001-r', eventType: 'release', releaseReason: 'partial'
  }));
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'compensate'), {
    state: 'CONFIRMED', confirmed: [{ eventId: 'rc1-op-' + operationId + '-d', disposition: 'already-present' }]
  }, 'existing exact compensate reconciles after partial releases');

  calls = [];
  store = makeStore(completion('complete', 2));
  store.set('rc1-op-' + operationId + '-d', expectedDecision('commit-rows', 'complete', 2));
  store.set('rc1-20271105-u3-000001-r', Object.assign({}, unit, {
    _id: 'rc1-20271105-u3-000001-r', eventType: 'release', releaseReason: 'corrupt'
  }));
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('INTEGRITY'), 'existing commit rejects every release anomaly');

  calls = [];
  store = makeStore(completion('complete', 2));
  store.set('rc1-op-' + operationId + '-d', expectedDecision('compensate', 'complete', 2));
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('DECISION_CONFLICT'), 'opposite exact decision is a decision conflict');

  calls = [];
  store = makeStore(completion('complete', 2));
  const poisoned = expectedDecision('commit-rows', 'complete', 2);
  poisoned.bookingNumber = 'OTHER';
  store.set(poisoned._id, poisoned);
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('IDEMPOTENCY_CONFLICT'), 'same-operation poisoned binding is an idempotency conflict');

  calls = [];
  install(makeStore(completion('complete', 2)), null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'invalid'),
    stopped('INTEGRITY'), 'invalid decision input fails closed');
  assertEqual(calls.length, 0, 'invalid input causes zero I/O');

  const injected = expectedDecision('commit-rows', 'complete', 2);
  let injectedIo = 0;
  context.wixData = { insert: function() { injectedIo += 1; }, get: function() { injectedIo += 1; } };
  assertEqual(await context.adapter.appendRoomClaimEvents([injected]), stopped('INTEGRITY'),
    'general claim append callers cannot inject decisions');
  assertEqual(injectedIo, 0, 'decision injection is rejected before I/O');

  calls = [];
  store = makeStore(completion('complete', 2));
  const hostileIdentity = Object.assign({}, identity);
  let getterCalls = 0;
  Object.defineProperty(hostileIdentity, 'bookingNumber', {
    enumerable: true, configurable: true,
    get: function() { getterCalls += 1; return identity.bookingNumber; }
  });
  store.set(identity._id, hostileIdentity);
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('INTEGRITY'), 'stored identity accessors fail closed');
  assertEqual({ getterCalls: getterCalls, writes: calls.filter(function(call) {
    return call.type === 'insert';
  }).length }, { getterCalls: 0, writes: 0 }, 'hostile accessors never execute and have zero effects');

  calls = [];
  store = makeStore(completion('complete', 2));
  const symbolIdentity = Object.assign({}, identity);
  symbolIdentity[Symbol('shadow')] = 'x';
  store.set(identity._id, symbolIdentity);
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('INTEGRITY'), 'symbol-keyed authoritative evidence fails closed');

  calls = [];
  store = makeStore(completion('complete', 2));
  const abnormalIdentity = Object.assign(Object.create({}), identity);
  store.set(identity._id, abnormalIdentity);
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('INTEGRITY'), 'abnormal evidence prototypes fail closed');

  calls = [];
  store = makeStore(completion('complete', 2));
  store.set(capacity._id, Object.assign({}, capacity, { extra: true }));
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('INTEGRITY'), 'extra acquisition evidence fields fail closed');

  calls = [];
  store = makeStore(completion('complete', 2));
  install(store, null, calls);
  const capturedOwner = context.wixData;
  let firstRead = true;
  let redirectedCalls = 0;
  capturedOwner.get = function(collection, id, options) {
    if (this !== capturedOwner) throw new Error('wrong captured get owner');
    calls.push({ type: 'get', collection, id, options, ownerIsCaptured: true });
    const value = store.get(id) || null;
    if (!firstRead) return Promise.resolve(value);
    firstRead = false;
    return {
      then: function(resolve) {
        context.wixData = {
          get: function() { redirectedCalls += 1; throw new Error('redirected get'); },
          insert: function() { redirectedCalls += 1; throw new Error('redirected insert'); }
        };
        resolve(value);
      }
    };
  };
  capturedOwner.insert = function(collection, item, options) {
    if (this !== capturedOwner) throw new Error('wrong captured insert owner');
    calls.push({ type: 'insert', collection, item, options, ownerIsCaptured: true });
    if (store.has(item._id)) return Promise.reject(new Error('WDE0074'));
    store.set(item._id, Object.assign({}, item));
    return Promise.resolve({ _id: 'untrusted' });
  };
  const capturedOwnerResult = await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows');
  assertEqual(capturedOwnerResult, {
    state: 'CONFIRMED', confirmed: [{
      eventId: 'rc1-op-' + operationId + '-d', disposition: 'inserted'
    }]
  }, 'retained thenables and live global replacement cannot redirect captured I/O');
  assertEqual({
    owners: calls.map(function(call) { return call.ownerIsCaptured; }),
    inserts: calls.filter(function(call) { return call.type === 'insert'; }).length,
    redirectedCalls: redirectedCalls
  }, { owners: Array(9).fill(true), inserts: 1, redirectedCalls: 0 },
  'every read and write dispatch retains the originally captured owner and functions');

  const decisionIntrinsicPoisons = [
    ['Object.create', 'Object.create = function() { throw new Error("poisoned Object.create"); };'],
    ['Object.defineProperty', 'Object.defineProperty = function() { throw new Error("poisoned Object.defineProperty"); };'],
    ['Object.defineProperties', 'Object.defineProperties = function() { throw new Error("poisoned Object.defineProperties"); };'],
    ['Reflect.ownKeys', 'Reflect.ownKeys = function() { throw new Error("poisoned Reflect.ownKeys"); };'],
    ['Promise.prototype.then', 'Promise.prototype.then = function() { throw new Error("poisoned Promise.then"); };'],
    ['Array constructor', 'Array = function() { throw new Error("poisoned Array"); };'],
    ['String constructor', 'String = function() { throw new Error("poisoned String"); };'],
    ['RegExp.prototype.exec', 'RegExp.prototype.exec = function() { throw new Error("poisoned RegExp.exec"); };']
  ];
  for (const intrinsicPoison of decisionIntrinsicPoisons) {
    const intrinsicContext = loadDecisionContext();
    const intrinsicStore = makeStore(completion('complete', 2));
    let firstIntrinsicRead = true;
    intrinsicContext.wixData = {
      get: function(collection, id) {
        const value = intrinsicStore.get(id) || null;
        if (!firstIntrinsicRead) return Promise.resolve(value);
        firstIntrinsicRead = false;
        return { then: function(resolve) {
          vm.runInContext(intrinsicPoison[1], intrinsicContext);
          resolve(value);
        } };
      },
      insert: function(collection, item) {
        intrinsicStore.set(item._id, Object.assign({}, item));
        return Promise.resolve(item);
      }
    };
    assertEqual({
      result: await intrinsicContext.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
      persisted: intrinsicStore.get('rc1-op-' + operationId + '-d')
    }, {
      result: {
        state: 'CONFIRMED', confirmed: [{
          eventId: 'rc1-op-' + operationId + '-d', disposition: 'inserted'
        }]
      },
      persisted: expectedDecision('commit-rows', 'complete', 2)
    }, 'decision path retains captured ' + intrinsicPoison[0] + ' after its first thenable');
  }

  const immutableDecisionContext = loadDecisionContext();
  const immutableDecisionStore = makeStore(completion('complete', 2));
  let immutableDecisionAttempts = null;
  let decisionFrozenAtInsert = null;
  immutableDecisionContext.wixData = {
    get: function(collection, id) {
      return Promise.resolve(immutableDecisionStore.get(id) || null);
    },
    insert: function(collection, item) {
      decisionFrozenAtInsert = Object.isFrozen(item);
      immutableDecisionAttempts = [
        Reflect.set(item, 'bookingNumber', 'WC-MUTATED-1'),
        Reflect.set(item, 'payloadDigest', 'b'.repeat(64)),
        Reflect.set(item, 'decisionState', 'compensate')
      ];
      immutableDecisionStore.set(item._id, Object.assign({}, item));
      return Promise.resolve(item);
    }
  };
  assertEqual({
    result: await immutableDecisionContext.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    frozenAtInsert: decisionFrozenAtInsert,
    mutationAttempts: immutableDecisionAttempts,
    persisted: immutableDecisionStore.get('rc1-op-' + operationId + '-d')
  }, {
    result: {
      state: 'CONFIRMED', confirmed: [{
        eventId: 'rc1-op-' + operationId + '-d', disposition: 'inserted'
      }]
    },
    frozenAtInsert: true,
    mutationAttempts: [false, false, false],
    persisted: expectedDecision('commit-rows', 'complete', 2)
  }, 'decision insert cannot mutate immutable bindings used by authoritative readback');

  calls = [];
  store = makeStore(completion('complete', 2));
  install(store, null, calls);
  const unresolvedGet = context.wixData.get;
  context.wixData.get = function(collection, id, options) {
    if (id === unit._id) return Promise.reject(new Error('timeout'));
    return unresolvedGet.call(this, collection, id, options);
  };
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('UNRESOLVED'), 'authoritative read uncertainty is unresolved with zero effects');
  assertEqual(calls.filter(function(call) { return call.type === 'insert'; }).length, 0,
    'read uncertainty never reaches decision insertion');

  for (const missingFunction of ['get', 'insert']) {
    calls = [];
    const incompleteOwner = {};
    incompleteOwner[missingFunction === 'get' ? 'insert' : 'get'] = function() {
      calls.push({ type: 'unexpected' });
      return Promise.resolve(null);
    };
    context.wixData = incompleteOwner;
    assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'compensate'),
      stopped('UNRESOLVED'), 'decision I/O requires an own callable ' + missingFunction + ' function');
    assertEqual(calls.length, 0, 'missing ' + missingFunction + ' fails before I/O dispatch');
  }

  calls = [];
  store = makeStore(completion('complete', 2));
  const ownerBoundIo = {
    get: function(collection, id, options) {
      if (this !== ownerBoundIo) throw new Error('wrong get owner');
      calls.push({ type: 'get', options: options });
      return Promise.resolve(store.get(id) || null);
    },
    insert: function(collection, item, options) {
      if (this !== ownerBoundIo) throw new Error('wrong insert owner');
      calls.push({ type: 'insert', options: options });
      store.set(item._id, Object.assign({}, item));
      return Promise.resolve(item);
    }
  };
  context.wixData = ownerBoundIo;
  assertEqual((await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows')).state,
    'CONFIRMED', 'decision I/O dispatch retains the captured Wix Data owner');
  assertEqual(calls.every(function(call) {
    return (call.type === 'get'
      ? call.options.consistentRead === true
      : !Object.prototype.hasOwnProperty.call(call.options, 'consistentRead')) &&
      call.options.suppressAuth === true && call.options.suppressHooks === true;
  }), true, 'decision I/O uses exact strong-read and hook-suppressed write options');

  calls = [];
  assertEqual(await context.adapter.appendRoomOperationDecision('short', 'compensate'), {
    state: 'STOPPED', confirmed: [], failed: {
      index: 0, eventId: 'rc1-op-short-d', classification: 'INTEGRITY'
    }
  }, 'noncanonical operation IDs fail before evidence lookup');
  assertEqual(calls.length, 0, 'noncanonical operation IDs perform zero I/O');

  const foreignIdentity = Object.assign({}, identity, {
    operationId: foreignOperationId,
    manifestBookingRowIds: 'pb1-' + foreignOperationId + '-r1'
  });
  const foreignCapacity = Object.assign({}, capacity, {
    operationId: foreignOperationId, bookingRowId: 'pb1-' + foreignOperationId + '-r1'
  });
  const foreignManifestUnit = Object.assign({}, unit, {
    operationId: foreignOperationId, bookingRowId: 'pb1-' + foreignOperationId + '-r1'
  });
  const foreignCompletion = Object.assign({}, completion('complete', 2), {
    operationId: foreignOperationId, bookingRowId: foreignIdentity.bookingRowId
  });
  const corruptIdentityCases = [
    ['operation ID', new Map([
      [identity._id, foreignIdentity], [capacity._id, foreignCapacity],
      [unit._id, foreignManifestUnit], [foreignCompletion._id, foreignCompletion]
    ])],
    ['deterministic ID', new Map([
      [identity._id, Object.assign({}, identity, { _id: 'rc1-op-' + operationId + '-x' })],
      [capacity._id, capacity], [unit._id, unit],
      [completion('complete', 2)._id, completion('complete', 2)]
    ])]
  ];
  for (const corruptIdentityCase of corruptIdentityCases) {
    calls = [];
    store = corruptIdentityCase[1];
    install(store, null, calls);
    assertEqual({
      result: await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
      calls: calls.map(function(call) { return call.type + ':' + (call.id || call.item._id); }),
      decisionIds: Array.from(store.keys()).filter(function(id) { return id.endsWith('-d'); })
    }, {
      result: stopped('INTEGRITY'), calls: ['get:' + identity._id], decisionIds: []
    }, 'identity evidence binds its exact canonical ' + corruptIdentityCase[0] + ' before effects');
  }

  calls = [];
  const malformedManifestIdentity = Object.assign({}, identity, { manifestUnits: '5' });
  store = new Map([[identity._id, malformedManifestIdentity]]);
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'compensate'),
    stopped('INTEGRITY'), 'malformed authoritative manifests fail closed');

  calls = [];
  store = new Map([
    [identity._id, Object.assign({}, identity)],
    [unit._id, Object.assign({}, unit)],
    [completion('stopped', 1)._id, completion('stopped', 1)]
  ]);
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'compensate'),
    stopped('INTEGRITY'), 'a hole before a later acquisition is not an authoritative prefix');
  assertEqual(calls.map(function(call) {
    return call.type + ':' + (call.id || call.item._id);
  }), ['get:' + identity._id, 'get:' + capacity._id, 'get:' + unit._id],
  'a missing first acquisition cannot compress a later acquisition into a writable prefix');

  const acquisitionMutations = [
    ['deterministic ID', { _id: 'rc1-20271105-s2-000001-a' }],
    ['operation', { operationId: 'foreignoperation0001' }],
    ['booking number', { bookingNumber: 'WC-OTHER' }],
    ['payload digest', { payloadDigest: 'b'.repeat(64) }],
    ['booking row', { bookingRowId: 'pb1-' + operationId + '-r2' }]
  ];
  for (const mutation of acquisitionMutations) {
    calls = [];
    store = makeStore(completion('complete', 2));
    store.set(capacity._id, Object.assign({}, capacity, mutation[1]));
    install(store, null, calls);
    assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
      stopped('INTEGRITY'), 'acquisition evidence binds its exact ' + mutation[0]);
    assertEqual(calls.filter(function(call) { return call.type === 'insert'; }).length, 0,
      'invalid acquisition ' + mutation[0] + ' performs zero writes');
  }

  calls = [];
  store = makeStore(completion('complete', 2));
  store.set(capacity._id, Object.assign({}, capacity, {
    _id: 'rc1-20271105-s2-000001-a',
    claimKey: 'capacity:2027-11-05:2', capacitySlot: 2
  }));
  install(store, null, calls);
  assertEqual({
    result: await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    calls: calls.map(function(call) { return call.type + ':' + (call.id || call.item._id); })
  }, {
    result: stopped('INTEGRITY'), calls: ['get:' + identity._id, 'get:' + capacity._id]
  }, 'acquisition lookup key binds an internally coherent record to its exact deterministic ID');

  calls = [];
  store = makeStore(completion('complete', 2));
  const hostileCompletion = completion('complete', 2);
  let completionGetterCalls = 0;
  Object.defineProperty(hostileCompletion, 'completionState', {
    enumerable: true, configurable: true,
    get: function() { completionGetterCalls += 1; return 'complete'; }
  });
  store.set(hostileCompletion._id, hostileCompletion);
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('INTEGRITY'), 'hostile completion evidence fails closed');
  assertEqual(completionGetterCalls, 0, 'hostile completion accessors never execute');

  const completionMutations = [
    ['ID', { _id: 'rc1-op-' + operationId + '-x' }],
    ['claim key', { claimKey: 'operation:' + operationId }],
    ['fence', { decisionFenceVersion: 2 }],
    ['operation', { operationId: 'foreignoperation0001' }],
    ['booking row', { bookingRowId: 'pb1-' + operationId + '-r2' }],
    ['booking number', { bookingNumber: 'WC-OTHER' }],
    ['payload digest', { payloadDigest: 'b'.repeat(64) }],
    ['state', { completionState: 'pending' }],
    ['count type', { confirmedResourceCount: '2' }],
    ['prefix count', { confirmedResourceCount: 1 }]
  ];
  for (const mutation of completionMutations) {
    calls = [];
    store = makeStore(completion('complete', 2));
    store.set('rc1-op-' + operationId + '-c', Object.assign({}, completion('complete', 2), mutation[1]));
    install(store, null, calls);
    assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
      stopped('INTEGRITY'), 'completion evidence binds exact ' + mutation[0]);
  }

  const completionGuardCases = [
    ['unmarked completion retains legacy classification', completion('complete', 2, false),
      'compensate', 'LEGACY_UNFENCED', false],
    ['completion lookup key binds its exact record ID', Object.assign({}, completion('complete', 2), {
      _id: 'rc1-op-' + operationId + '-x'
    }), 'commit-rows', 'INTEGRITY', false],
    ['pending completion state is not terminal', completion('pending', 2),
      'compensate', 'INTEGRITY', false],
    ['complete completion requires the full acquisition count', completion('complete', 1),
      'commit-rows', 'INTEGRITY', true],
    ['stopped completion requires a strict acquisition prefix', completion('stopped', 2),
      'compensate', 'INTEGRITY', false]
  ];
  for (const completionGuardCase of completionGuardCases) {
    calls = [];
    store = makeStore(completionGuardCase[1]);
    if (completionGuardCase[4]) store.delete(unit._id);
    store.set('rc1-op-' + operationId + '-c', completionGuardCase[1]);
    install(store, null, calls);
    assertEqual({
      result: await context.adapter.appendRoomOperationDecision(operationId, completionGuardCase[2]),
      calls: calls.map(function(call) { return call.type + ':' + (call.id || call.item._id); })
    }, {
      result: stopped(completionGuardCase[3]),
      calls: ['get:' + identity._id, 'get:' + capacity._id, 'get:' + unit._id,
        'get:rc1-op-' + operationId + '-c']
    }, completionGuardCase[0] + ' before decision effects');
  }

  calls = [];
  store = makeStore(completion('stopped', 1));
  store.delete(unit._id);
  install(store, null, calls);
  assertEqual((await context.adapter.appendRoomOperationDecision(operationId, 'compensate')).state,
    'CONFIRMED', 'stopped compensation remains eligible for exact schema verification');
  assertEqual(store.get('rc1-op-' + operationId + '-d'),
    expectedDecision('compensate', 'stopped', 1),
    'stopped compensation decision preserves the terminal completion state');

  calls = [];
  store = makeStore(completion('complete', 2));
  const digestConflict = expectedDecision('commit-rows', 'complete', 2);
  digestConflict.payloadDigest = 'b'.repeat(64);
  store.set(digestConflict._id, digestConflict);
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('IDEMPOTENCY_CONFLICT'), 'same-operation decision digest mismatch is an idempotency conflict');

  calls = [];
  store = makeStore(completion('complete', 2));
  const malformedExistingDecision = expectedDecision('commit-rows', 'complete', 2);
  malformedExistingDecision.manifestVersion = 2;
  store.set(malformedExistingDecision._id, malformedExistingDecision);
  install(store, null, calls);
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('INTEGRITY'), 'same-state malformed decision evidence is not an idempotent match');

  calls = [];
  store = makeStore(completion('complete', 2));
  store.set('rc1-op-' + operationId + '-d', expectedDecision('commit-rows', 'stopped', 2));
  install(store, null, calls);
  assertEqual({
    result: await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    calls: calls.map(function(call) { return call.type + ':' + (call.id || call.item._id); })
  }, {
    result: stopped('INTEGRITY'),
    calls: ['get:' + identity._id, 'get:' + capacity._id, 'get:' + unit._id,
      'get:rc1-op-' + operationId + '-c', 'get:rc1-op-' + operationId + '-d']
  }, 'same-direction decision matches exact completion state and count before reconciliation');

  calls = [];
  store = makeStore(completion('complete', 2));
  install(store, null, calls);
  const releaseUncertaintyGet = context.wixData.get;
  context.wixData.get = function(collection, id, options) {
    if (id === 'rc1-20271105-s1-000001-r') return Promise.reject(new Error('timeout'));
    return releaseUncertaintyGet.call(this, collection, id, options);
  };
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('UNRESOLVED'), 'release-fence read uncertainty remains unresolved');

  calls = [];
  store = makeStore(completion('complete', 2));
  context.wixData = {
    get: async function(collection, id) {
      if (id === 'rc1-op-' + operationId + '-d') return null;
      return store.get(id) || null;
    },
    insert: async function() { return { _id: 'untrusted' }; }
  };
  assertEqual(await context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    stopped('UNRESOLVED'), 'missing post-insert decision readback remains unresolved');

  // Two callers contend on one deterministic ID; exactly one decision wins.
  store = makeStore(completion('complete', 2));
  context.wixData = {
    get: async function(collection, id) { return store.get(id) || null; },
    insert: async function(collection, item) {
      if (store.has(item._id)) throw new Error('WDE0074');
      store.set(item._id, Object.assign({}, item));
      await Promise.resolve();
      return item;
    }
  };
  const race = await Promise.all([
    context.adapter.appendRoomOperationDecision(operationId, 'commit-rows'),
    context.adapter.appendRoomOperationDecision(operationId, 'compensate')
  ]);
  assertEqual(race.map(function(result) { return result.state === 'CONFIRMED' ? 'CONFIRMED' : result.failed.classification; }).sort(),
    ['CONFIRMED', 'DECISION_CONFLICT'], 'concurrent opposite decisions have exactly one winner');
  const persistedRaceDecision = store.get('rc1-op-' + operationId + '-d');
  assertEqual({
    exactWinner: persistedRaceDecision,
    releaseCount: Array.from(store.values()).filter(function(item) {
      return item && item.eventType === 'release';
    }).length
  }, {
    exactWinner: expectedDecision(persistedRaceDecision.decisionState, 'complete', 2),
    releaseCount: 0
  }, 'opposite-decision contention persists one exact winner and no release state');

  store = makeStore(completion('complete', 2));
  context.wixData = {
    get: async function(collection, id) { return store.get(id) || null; },
    insert: async function(collection, item) {
      if (store.has(item._id)) throw new Error('WDE0074');
      store.set(item._id, Object.assign({}, item));
      await Promise.resolve();
      return item;
    }
  };
  const sameDirectionRace = await Promise.all([
    context.adapter.appendRoomOperationDecision(operationId, 'compensate'),
    context.adapter.appendRoomOperationDecision(operationId, 'compensate')
  ]);
  assertEqual({
    states: sameDirectionRace.map(function(result) { return result.state; }),
    dispositions: sameDirectionRace.map(function(result) {
      return result.confirmed && result.confirmed[0] && result.confirmed[0].disposition;
    }).sort(),
    persisted: store.get('rc1-op-' + operationId + '-d')
  }, {
    states: ['CONFIRMED', 'CONFIRMED'],
    dispositions: ['already-present', 'inserted'],
    persisted: expectedDecision('compensate', 'complete', 2)
  }, 'same-direction decision contention converges on one exact persisted winner');

  console.log('Operation decision adapter verifier passed.');
})().catch(function(error) { console.error(error.stack || error); process.exitCode = 1; });
