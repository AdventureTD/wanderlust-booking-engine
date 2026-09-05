// Focused behavioral verification for strict missing-suffix recovery.
// Run: node scripts/verify-room-booking-row-recovery.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let assertions = 0;
const permanentFailures = [];
function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const copy = {};
    Object.keys(value).sort().forEach(function(key) { copy[key] = comparable(value[key]); });
    return copy;
  }
  return value;
}
function equal(actual, expected, message) {
  assertions += 1;
  const left = JSON.stringify(comparable(actual));
  const right = JSON.stringify(comparable(expected));
  if (left !== right) throw new Error(`FAIL: ${message}\nExpected: ${right}\nActual:   ${left}`);
  console.log('PASS: ' + message);
}
function permanentEqual(actual, expected, message) {
  assertions += 1;
  const left = JSON.stringify(comparable(actual));
  const right = JSON.stringify(comparable(expected));
  if (left !== right) {
    permanentFailures.push(`FAIL: ${message}\nExpected: ${right}\nActual:   ${left}`);
    console.error('FAIL: ' + message);
    return;
  }
  console.log('PASS: ' + message);
}
function cloneRow(row, additions) { return Object.assign({}, row, additions || {}); }

const sourcePath = path.join(__dirname, '..', 'velo', 'backend', 'roomBookingRowRecovery.js');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^import .*;\s*$/gm, '')
  .replace(/export async function /g, 'async function ')
  + '\nthis.adapter = { appendMissingPhysicalBookingRows };' +
    '\nthis.testApi = { INVALID, capability, dataProperty, scalarCount, takeExpectedSnapshot, ' +
    'snapshotExpected, stableItems, stableStored, validExpected };';

function rowSet(operationId, units) {
  const roomCode = units[0] === 1 ? 'penthouse_apartment' :
    units[0] === 2 ? 'two_bedroom_apartment' : 'adventure_suite';
  return units.map(function(unit, index) {
    return {
      _id: 'pb1-' + operationId + '-r' + (index + 1), roomCode,
      assignedRoom: unit, quantity: 1,
      checkIn: new Date('2027-11-05T12:00:00.000Z'),
      checkOut: new Date('2027-11-07T12:00:00.000Z'),
      bookingNumber: 'WC-7001', operationId, payloadDigest: 'a'.repeat(64),
      status: 'confirmed', autoOwnerBlock: false,
      guests: roomCode === 'two_bedroom_apartment' ? 3 : 2,
      roomFee: roomCode === 'penthouse_apartment' ? 175 : 0,
      note: index === 0 ? 'Late arrival' : ''
    };
  });
}
function page(items, next) {
  return {
    items,
    hasNext: function() { return !!next; },
    next: next ? function() { return Promise.resolve(next); } : undefined
  };
}

function contextFor(initialRows, configure) {
  const calls = [];
  const store = new Map((initialRows || []).map(function(row) { return [row._id, row]; }));
  const behavior = { findCount: 0, getCount: 0, insertCount: 0 };
  const wixData = {
    query: function(collection) {
      calls.push({ method: 'query', collection, receiver: this });
      const builder = {
        eq: function(field, value) {
          calls.push({ method: 'eq', field, value, receiver: this });
          this.operationId = value; return this;
        },
        limit: function(value) { calls.push({ method: 'limit', value, receiver: this }); return this; },
        find: function(options) {
          behavior.findCount += 1;
          calls.push({ method: 'find', options, receiver: this });
          if (behavior.find) return behavior.find.call(this, options, behavior.findCount);
          const items = Array.from(store.values()).filter(row => row.operationId === this.operationId);
          return Promise.resolve(page(items));
        }
      };
      return builder;
    },
    get: function(collection, id, options) {
      behavior.getCount += 1;
      calls.push({ method: 'get', collection, id, options, receiver: this });
      if (behavior.get) return behavior.get.call(this, collection, id, options, behavior.getCount);
      return Promise.resolve(store.get(id) || null);
    },
    insert: function(collection, row, options) {
      behavior.insertCount += 1;
      calls.push({ method: 'insert', collection, row, options, receiver: this });
      if (behavior.insert) return behavior.insert.call(this, collection, row, options, behavior.insertCount);
      if (store.has(row._id)) return Promise.reject(new Error('duplicate'));
      store.set(row._id, row);
      return Promise.resolve({ ignored: true });
    }
  };
  if (configure) configure({ behavior, calls, store, wixData });
  const context = { wixData, Date, Object, Reflect, Array, Number, String, RegExp, Promise, Error, Set, Map };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { adapter: context.adapter, calls, store, wixData, behavior, context };
}
function stopped(index, rowId, classification, confirmed) {
  return { state: 'STOPPED', confirmed: confirmed || [], failed: { index, rowId, classification } };
}
function inserts(subject) { return subject.calls.filter(call => call.method === 'insert'); }
function optionsAreFreshImmutable(subject) {
  const used = subject.calls.filter(call => call.options).map(call => call.options);
  return used.every(function(value, index) {
    const expected = Object.prototype.hasOwnProperty.call(value, 'consistentRead')
      ? ['suppressAuth', 'consistentRead', 'suppressHooks'] : ['suppressAuth', 'suppressHooks'];
    return Reflect.ownKeys(value).join(',') === expected.join(',') &&
      expected.every(function(key) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && descriptor.value === true && descriptor.enumerable === true &&
          descriptor.writable === false && descriptor.configurable === false;
      }) &&
      Object.getPrototypeOf(value) === Object.prototype && Object.isFrozen(value) &&
      Object.isExtensible(value) === false && used.indexOf(value) === index;
  });
}

(async function() {
  const rows = rowSet('recoveryadapter01', [3, 4]);

  async function causalInvalid(candidateRows, label, index) {
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows(candidateRows);
    equal({ state: result.state,
      classification: result.failed && result.failed.classification,
      index: result.failed && result.failed.index,
      calls: subject.calls.length },
      { state: 'STOPPED', classification: 'INTEGRITY', index: index, calls: 0 }, label);
  }
  async function causalValid(candidateRows, label) {
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows(candidateRows);
    equal({ state: result.state, inserts: inserts(subject).length },
      { state: 'CONFIRMED', inserts: candidateRows.length }, label);
  }
  await causalInvalid([cloneRow(rows[0], { bookingNumber: '' })],
    'empty booking number fails before Wix I/O', 0);
  const loneSurrogates = [
    ['D800', '\uD800'], ['DBFF', '\uDBFF'], ['DC00', '\uDC00'], ['DFFF', '\uDFFF']
  ];
  for (let index = 0; index < loneSurrogates.length; index += 1) {
    await causalInvalid([cloneRow(rows[0], { bookingNumber: 'WC-' + loneSurrogates[index][1] })],
      'lone surrogate ' + loneSurrogates[index][0] + ' fails before Wix I/O', 0);
  }
  await causalInvalid([cloneRow(rows[0], { note: 'N'.repeat(4097) })],
    'note above 4096 scalars fails before Wix I/O', 0);
  await causalInvalid([cloneRow(rows[0], { checkOut: new Date(rows[0].checkIn) })],
    'equal check-in and checkout fail before Wix I/O', 0);
  await causalInvalid([cloneRow(rows[0], { checkIn: new Date('2027-11-05T00:00:00.000Z') })],
    'off-noon Date fails before Wix I/O', 0);
  for (const guests of [2, 5]) {
    const invalidGuestRows = rowSet('guestboundary000' + guests, [2]);
    invalidGuestRows[0].guests = guests;
    await causalInvalid(invalidGuestRows,
      'two-bedroom guest boundary ' + guests + ' fails before Wix I/O', 0);
  }
  await causalInvalid(rowSet('badtopology00001', [5]),
    'invalid topology identifies the first row', 0);
  await causalValid([cloneRow(rows[0], { bookingNumber: 'B'.repeat(128) })],
    'booking number at 128 scalars is accepted');
  await causalValid([cloneRow(rows[0], { note: 'N'.repeat(4096) })],
    'note at 4096 scalars is accepted');
  await causalValid([cloneRow(rows[0], { bookingNumber: 'WC-\uD800\uDC00' })],
    'lowest valid surrogate pair is accepted');
  await causalValid([cloneRow(rows[0], { bookingNumber: 'WC-\uDBFF\uDFFF' })],
    'highest valid surrogate pair is accepted');
  await causalValid([cloneRow(rows[0], {
    checkIn: rows[0].checkIn.toISOString(),
    checkOut: rows[0].checkOut.toISOString()
  })], 'canonical date strings are accepted');
  for (const guests of [3, 4]) {
    const validGuestRows = rowSet('validguest00000' + guests, [2]);
    validGuestRows[0].guests = guests;
    await causalValid(validGuestRows,
      'two-bedroom guest boundary ' + guests + ' is accepted');
  }

  const empty = contextFor([]);
  equal(await empty.adapter.appendMissingPhysicalBookingRows([rows[0]]), {
    state: 'CONFIRMED', confirmed: [{ rowId: rows[0]._id, disposition: 'inserted' }]
  }, 'empty authoritative state inserts and confirms one deterministic row');
  equal(empty.calls.map(call => call.method),
    ['query', 'eq', 'limit', 'get', 'find', 'insert', 'get', 'query', 'eq', 'limit', 'get', 'find'],
    'one-row recovery performs initial agreement, readback, and final agreement');
  equal(optionsAreFreshImmutable(empty), true,
    'every Wix dispatch receives fresh immutable explicit read or write options');
  equal(empty.calls.filter(call => ['query', 'get', 'insert'].includes(call.method))
    .every(call => call.receiver === empty.wixData), true,
    'captured Wix methods use their actual owner receiver');
  equal(empty.calls.filter(call => call.options).map(call => call.method),
    ['get', 'find', 'insert', 'get', 'get', 'find'],
    'get, insert, and every query find receive exact explicit options');

  const full = contextFor(rows);
  equal(await full.adapter.appendMissingPhysicalBookingRows(rows), {
    state: 'CONFIRMED', confirmed: rows.map(row => ({ rowId: row._id, disposition: 'already-present' }))
  }, 'a full exact initial set confirms without writes');
  equal({ inserts: inserts(full).length, finds: full.behavior.findCount, gets: full.behavior.getCount },
    { inserts: 0, finds: 1, gets: 2 }, 'full initial state has no write or redundant final pass');

  const prefix = contextFor([rows[0]]);
  equal(await prefix.adapter.appendMissingPhysicalBookingRows(rows), {
    state: 'CONFIRMED', confirmed: [
      { rowId: rows[0]._id, disposition: 'already-present' },
      { rowId: rows[1]._id, disposition: 'inserted' }
    ]
  }, 'an exact prefix appends only its missing suffix');
  equal(inserts(prefix).map(call => call.row._id), [rows[1]._id],
    'prefix recovery never rewrites an already-present row');

  const hole = contextFor([rows[1]]);
  equal(await hole.adapter.appendMissingPhysicalBookingRows(rows),
    stopped(0, rows[0]._id, 'INTEGRITY'), 'a hole before a later exact row is integrity corruption');
  equal(inserts(hole).length, 0, 'a corrupt hole performs no writes');

  const extraRow = cloneRow(rows[0], { _id: 'pb1-' + rows[0].operationId + '-r99' });
  const extra = contextFor([extraRow]);
  equal(await extra.adapter.appendMissingPhysicalBookingRows(rows),
    stopped(rows.length, extraRow._id, 'INTEGRITY'), 'an unexpected operation row is integrity corruption');

  const disagree = contextFor([], function(env) {
    env.behavior.get = function(collection, id) { return Promise.resolve(cloneRow(rows[0], { _id: id })); };
    env.behavior.find = function() { return Promise.resolve(page([])); };
  });
  equal(await disagree.adapter.appendMissingPhysicalBookingRows([rows[0]]),
    stopped(0, rows[0]._id, 'UNRESOLVED'), 'get and operation-query presence disagreement is unresolved');
  equal(inserts(disagree).length, 0, 'ambiguous reads never write');

  const secondPage = page([rows[1]]);
  const firstPage = page([rows[0]], secondPage);
  const paged = contextFor(rows, function(env) {
    env.behavior.find = function() { return Promise.resolve(firstPage); };
  });
  equal((await paged.adapter.appendMissingPhysicalBookingRows(rows)).state, 'CONFIRMED',
    'all operation-query pages are consumed before classification');

  const repeated = page([]);
  repeated.hasNext = function() { return true; };
  repeated.next = function() { return Promise.resolve(repeated); };
  const repeatedPage = contextFor([], function(env) {
    env.behavior.find = function() { return Promise.resolve(repeated); };
  });
  equal(await repeatedPage.adapter.appendMissingPhysicalBookingRows([rows[0]]),
    stopped(0, rows[0]._id, 'UNRESOLVED'), 'a repeated query page is unresolved');
  equal(inserts(repeatedPage).length, 0, 'invalid pagination performs no writes');

  const duplicateRace = contextFor([], function(env) {
    env.behavior.insert = function(collection, row) {
      env.store.set(row._id, row);
      return Promise.reject(new Error('duplicate race'));
    };
  });
  equal(await duplicateRace.adapter.appendMissingPhysicalBookingRows(rows), {
    state: 'CONFIRMED', confirmed: rows.map(row => ({ rowId: row._id, disposition: 'already-present' }))
  }, 'insert rejection plus exact readback continues through the suffix');

  const badReadback = contextFor([], function(env) {
    env.behavior.insert = function() { return Promise.resolve({ untrusted: true }); };
  });
  equal(await badReadback.adapter.appendMissingPhysicalBookingRows([rows[0]]),
    stopped(0, rows[0]._id, 'UNRESOLVED'), 'resolved insert with absent readback stops unresolved');

  const drift = contextFor([], function(env) {
    env.behavior.find = function(options, count) {
      if (count === 2) env.store.set(extraRow._id, extraRow);
      return Promise.resolve(page(Array.from(env.store.values())));
    };
  });
  equal(await drift.adapter.appendMissingPhysicalBookingRows([rows[0]]),
    stopped(1, extraRow._id, 'INTEGRITY', [{ rowId: rows[0]._id, disposition: 'inserted' }]),
    'final complete verification detects a concurrent extra row');

  const concurrent = contextFor([]);
  const concurrentResults = await Promise.all([
    concurrent.adapter.appendMissingPhysicalBookingRows(rows),
    concurrent.adapter.appendMissingPhysicalBookingRows(rows)
  ]);
  equal(concurrentResults.map(result => result.state), ['CONFIRMED', 'CONFIRMED'],
    'same-direction concurrent recoverers converge through deterministic IDs');
  equal(concurrent.store.size, 2, 'concurrent recovery creates exactly one copy of each row');

  const withMetadata = rows.map(row => cloneRow(row, {
    _owner: 'owner-1', _createdDate: new Date('2027-01-01T00:00:00.000Z'),
    _updatedDate: new Date('2027-01-02T00:00:00.000Z')
  }));
  equal((await contextFor(withMetadata).adapter.appendMissingPhysicalBookingRows(rows)).state,
    'CONFIRMED', 'strict Wix metadata is accepted and stripped for comparison');
  for (const addition of [
    { _rogue: true }, { _owner: 5 }, { _createdDate: new Date('invalid') }
  ]) {
    const malformed = cloneRow(rows[0], addition);
    equal((await contextFor([malformed]).adapter.appendMissingPhysicalBookingRows([rows[0]])).failed.classification,
      'INTEGRITY', 'malformed stored metadata fails closed: ' + Object.keys(addition)[0]);
  }

  const conflict = contextFor([cloneRow(rows[0], { payloadDigest: 'b'.repeat(64) })]);
  equal(await conflict.adapter.appendMissingPhysicalBookingRows([rows[0]]),
    stopped(0, rows[0]._id, 'IDEMPOTENCY_CONFLICT'),
    'same-operation deterministic digest collision is an idempotency conflict');
  const foreign = contextFor([cloneRow(rows[0], { operationId: 'foreignoperation01' })], function(env) {
    env.behavior.find = function() { return Promise.resolve(page([env.store.get(rows[0]._id)])); };
  });
  equal((await foreign.adapter.appendMissingPhysicalBookingRows([rows[0]])).failed.classification,
    'INTEGRITY', 'a foreign operation occupying an expected ID is integrity corruption');

  const invalidCases = [
    [], [cloneRow(rows[0], { extra: true })], [cloneRow(rows[0], { guests: 1 })],
    [cloneRow(rows[0], { roomFee: 1 })],
    [rows[0], cloneRow(rows[1], { note: 'not empty' })],
    [cloneRow(rows[0], { checkIn: '2027-11-05T00:00:00.000Z' })],
    [cloneRow(rows[0], { bookingNumber: 'B'.repeat(129) })]
  ];
  for (let index = 0; index < invalidCases.length; index += 1) {
    const invalid = contextFor([]);
    const result = await invalid.adapter.appendMissingPhysicalBookingRows(invalidCases[index]);
    equal({ state: result.state,
      classification: result.failed && result.failed.classification,
      calls: invalid.calls.length },
      { state: 'STOPPED', classification: 'INTEGRITY', calls: 0 },
      'invalid expected-row contract fails before Wix I/O case ' + (index + 1));
  }

  const fourRow = contextFor([]);
  const fourRowResult = await fourRow.adapter.appendMissingPhysicalBookingRows(
    rowSet('fourrowwitness01', [3, 4, 5, 1]));
  equal({ state: fourRowResult.state,
    classification: fourRowResult.failed && fourRowResult.failed.classification,
    index: fourRowResult.failed && fourRowResult.failed.index,
    calls: fourRow.calls.length },
    { state: 'STOPPED', classification: 'INTEGRITY', index: 0, calls: 0 },
    'more than three expected rows fail at the preflight batch boundary');

  let expectedOwnKeyPass = 0;
  const unstableExpectedRow = new Proxy(rows[0], {
    ownKeys: function(target) {
      expectedOwnKeyPass += 1;
      const keys = Reflect.ownKeys(target);
      return expectedOwnKeyPass === 2 ? keys.slice().reverse() : keys;
    }
  });
  const unstableExpected = contextFor([]);
  equal((await unstableExpected.adapter.appendMissingPhysicalBookingRows([unstableExpectedRow])).state,
    'STOPPED', 'unstable expected-row descriptors fail closed');
  equal(unstableExpected.calls.length, 0,
    'unstable expected-row descriptors fail before Wix I/O');

  let reads = 0;
  const hostile = contextFor([], function(env) {
    env.behavior.get = function(collection, id) {
      reads += 1;
      if (reads !== 1) return Promise.resolve(env.store.get(id) || null);
      return { then: function(resolve) {
        env.wixData.get = function() { throw new Error('replacement get'); };
        env.wixData.query = function() { throw new Error('replacement query'); };
        env.wixData.insert = function() { throw new Error('replacement insert'); };
        resolve(null);
      } };
    };
  });
  equal((await hostile.adapter.appendMissingPhysicalBookingRows([rows[0]])).state, 'CONFIRMED',
    'retained hostile thenable cannot replace captured Wix dispatch');

  // B2-01: expected rows must be exact primitive schema values before any Wix I/O.
  for (const field of ['operationId', 'payloadDigest']) {
    let coercions = 0;
    const primitive = rows[0][field];
    const coercible = {
      toString: function() { coercions += 1; return primitive; },
      valueOf: function() { coercions += 1; return primitive; }
    };
    const candidate = cloneRow(rows[0], { [field]: coercible });
    if (field === 'operationId') candidate._id = rows[0]._id;
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows([candidate]);
    permanentEqual({ state: result.state, classification: result.failed && result.failed.classification,
      coercions, calls: subject.calls.length },
    { state: 'STOPPED', classification: 'INTEGRITY', coercions: 0, calls: 0 },
    'B2-01 rejects non-primitive ' + field + ' without coercion or Wix I/O');
  }
  for (const assignedCase of [
    { label: 'numeric string', value: '3' },
    { label: 'boxed number', value: new Number(3) }
  ]) {
    const candidate = cloneRow(rows[0], { assignedRoom: assignedCase.value });
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows([candidate]);
    permanentEqual({ state: result.state, classification: result.failed && result.failed.classification,
      calls: subject.calls.length },
    { state: 'STOPPED', classification: 'INTEGRITY', calls: 0 },
    'B2-01 requires assignedRoom to be a safe-integer number: ' + assignedCase.label);
  }

  const negativeZero = contextFor([]);
  const negativeZeroResult = await negativeZero.adapter.appendMissingPhysicalBookingRows([
    cloneRow(rows[0], { roomFee: -0 })
  ]);
  permanentEqual({ result: negativeZeroResult, calls: negativeZero.calls.length },
    { result: stopped(0, rows[0]._id, 'INTEGRITY'), calls: 0 },
    'mutation guard rejects negative-zero roomFee before Wix I/O');
  const wrongQuantity = contextFor([]);
  const wrongQuantityResult = await wrongQuantity.adapter.appendMissingPhysicalBookingRows([
    cloneRow(rows[0], { quantity: 2 })
  ]);
  permanentEqual({ result: wrongQuantityResult, calls: wrongQuantity.calls.length },
    { result: stopped(0, rows[0]._id, 'INTEGRITY'), calls: 0 },
    'mutation guard requires quantity exactly one before Wix I/O');

  const topologyOutcomes = [];
  for (const [index, units] of [[3], [4], [3, 4], [3, 4, 5]].entries()) {
    const topologyRows = rowSet('topologycoverage' + String(index + 1).padStart(2, '0'), units);
    const subject = contextFor(topologyRows);
    const result = await subject.adapter.appendMissingPhysicalBookingRows(topologyRows);
    topologyOutcomes.push({ units, state: result.state, inserts: inserts(subject).length });
  }
  permanentEqual(topologyOutcomes, [
    { units: [3], state: 'CONFIRMED', inserts: 0 },
    { units: [4], state: 'CONFIRMED', inserts: 0 },
    { units: [3, 4], state: 'CONFIRMED', inserts: 0 },
    { units: [3, 4, 5], state: 'CONFIRMED', inserts: 0 }
  ], 'mutation guard preserves every valid adventure-suite topology');

  // B2-02: descriptor inspection must reject accessors without invoking them.
  for (const property of ['query', 'get', 'insert']) {
    let getterRuns = 0;
    const subject = contextFor([], function(env) {
      const original = Object.getOwnPropertyDescriptor(env.wixData, property).value;
      Object.defineProperty(env.wixData, property, {
        configurable: true, enumerable: true,
        get: function() { getterRuns += 1; return original; }
      });
    });
    const result = await subject.adapter.appendMissingPhysicalBookingRows([rows[0]]);
    permanentEqual({ state: result.state, classification: result.failed && result.failed.classification,
      getterRuns, calls: subject.calls.length, inserts: inserts(subject).length },
    { state: 'STOPPED', classification: 'UNRESOLVED', getterRuns: 0, calls: 0, inserts: 0 },
    'B2-02 rejects wixData.' + property + ' accessors without execution');
  }

  for (const property of ['eq', 'limit', 'find']) {
    let getterRuns = 0;
    const subject = contextFor([], function(env) {
      env.wixData.query = function(collection) {
        env.calls.push({ method: 'query', collection, receiver: this });
        const builder = {};
        if (property === 'eq') {
          Object.defineProperty(builder, 'eq', { configurable: true, enumerable: true,
            get: function() { getterRuns += 1; throw new Error('hostile eq'); } });
          return builder;
        }
        builder.eq = function(field, value) {
          env.calls.push({ method: 'eq', field, value, receiver: this }); return this;
        };
        if (property === 'limit') {
          Object.defineProperty(builder, 'limit', { configurable: true, enumerable: true,
            get: function() { getterRuns += 1; throw new Error('hostile limit'); } });
          return builder;
        }
        builder.limit = function(value) {
          env.calls.push({ method: 'limit', value, receiver: this }); return this;
        };
        Object.defineProperty(builder, 'find', { configurable: true, enumerable: true,
          get: function() { getterRuns += 1; throw new Error('hostile find'); } });
        return builder;
      };
    });
    const result = await subject.adapter.appendMissingPhysicalBookingRows([rows[0]]);
    permanentEqual({ state: result.state, classification: result.failed && result.failed.classification,
      getterRuns, inserts: inserts(subject).length },
    { state: 'STOPPED', classification: 'UNRESOLVED', getterRuns: 0, inserts: 0 },
    'B2-02 rejects query-builder ' + property + ' accessors without execution');
  }

  for (const property of ['items', 'hasNext', 'next']) {
    let getterRuns = 0;
    const subject = contextFor([], function(env) {
      env.behavior.find = function() {
        const queryPage = {};
        Object.defineProperty(queryPage, 'items', property === 'items'
          ? { enumerable: true, get: function() { getterRuns += 1; throw new Error('hostile items'); } }
          : { enumerable: true, value: [] });
        Object.defineProperty(queryPage, 'hasNext', property === 'hasNext'
          ? { enumerable: true, get: function() { getterRuns += 1; throw new Error('hostile hasNext'); } }
          : { enumerable: true, value: function() { return property === 'next'; } });
        Object.defineProperty(queryPage, 'next', property === 'next'
          ? { enumerable: true, get: function() { getterRuns += 1; throw new Error('hostile next'); } }
          : { enumerable: true, value: undefined });
        return Promise.resolve(queryPage);
      };
    });
    const result = await subject.adapter.appendMissingPhysicalBookingRows([rows[0]]);
    permanentEqual({ state: result.state, classification: result.failed && result.failed.classification,
      getterRuns, inserts: inserts(subject).length },
    { state: 'STOPPED', classification: 'UNRESOLVED', getterRuns: 0, inserts: 0 },
    'B2-02 rejects page.' + property + ' accessors without execution');
  }

  // B2-03: every observation is detached before another untrusted call or await.
  {
    const mutable = cloneRow(rows[0], { payloadDigest: 'b'.repeat(64) });
    const subject = contextFor([], function(env) {
      env.behavior.get = function() { return Promise.resolve(cloneRow(rows[0])); };
      const originalPage = page;
      env.behavior.find = function() {
        return Promise.resolve({
          items: [mutable],
          hasNext: function() { return true; },
          next: function() { return { then: function(resolve) {
            mutable.payloadDigest = rows[0].payloadDigest;
            resolve(originalPage([]));
          } }; }
        });
      };
    });
    const result = await subject.adapter.appendMissingPhysicalBookingRows([rows[0]]);
    permanentEqual({ state: result.state, inserts: inserts(subject).length },
      { state: 'STOPPED', inserts: 0 },
      'B2-03 snapshots each page item before awaiting page.next');
  }
  {
    const mutable = cloneRow(rows[0], { payloadDigest: 'b'.repeat(64) });
    const subject = contextFor([], function(env) {
      env.behavior.get = function() { return Promise.resolve(cloneRow(rows[0])); };
      env.behavior.find = function() { return Promise.resolve({
        items: [mutable],
        hasNext: function() { mutable.payloadDigest = rows[0].payloadDigest; return false; },
        next: undefined
      }); };
    });
    const result = await subject.adapter.appendMissingPhysicalBookingRows([rows[0]]);
    permanentEqual({ state: result.state, inserts: inserts(subject).length },
      { state: 'STOPPED', inserts: 0 },
      'B2-03 snapshots each page item before dispatching page.hasNext');
  }
  {
    const pair = rowSet('pageitemsnapshot01', [3, 4]);
    const mutableSecond = cloneRow(pair[1], { payloadDigest: 'b'.repeat(64) });
    const subject = contextFor([], function(env) {
      env.behavior.get = function(collection, id) {
        return Promise.resolve(cloneRow(id === pair[0]._id ? pair[0] : pair[1]));
      };
      env.behavior.find = function() { return Promise.resolve({
        items: [cloneRow(pair[0]), mutableSecond],
        hasNext: function() { mutableSecond.payloadDigest = pair[1].payloadDigest; return false; },
        next: undefined
      }); };
    });
    const result = await subject.adapter.appendMissingPhysicalBookingRows(pair);
    permanentEqual({ state: result.state, inserts: inserts(subject).length },
      { state: 'STOPPED', inserts: 0 },
      'B2-03 snapshots every item in a multi-item page before later dispatch');
  }
  {
    const mutable = cloneRow(rows[0], { payloadDigest: 'b'.repeat(64) });
    const subject = contextFor([], function(env) {
      env.behavior.get = function() { return Promise.resolve(mutable); };
      env.behavior.find = function() {
        mutable.payloadDigest = rows[0].payloadDigest;
        return Promise.resolve(page([cloneRow(rows[0])]));
      };
    });
    const result = await subject.adapter.appendMissingPhysicalBookingRows([rows[0]]);
    permanentEqual({ state: result.state, inserts: inserts(subject).length },
      { state: 'STOPPED', inserts: 0 },
      'B2-03 snapshots a resolved get before later query dispatch');
  }
  {
    const pair = rowSet('getdispatchsnap01', [3, 4]);
    const mutableSecond = cloneRow(pair[1], { payloadDigest: 'b'.repeat(64) });
    const subject = contextFor([], function(env) {
      env.behavior.get = function(collection, id) {
        return Promise.resolve(id === pair[0]._id ? cloneRow(pair[0]) : mutableSecond);
      };
      env.behavior.find = function() {
        mutableSecond.payloadDigest = pair[1].payloadDigest;
        return Promise.resolve(page(pair.map(row => cloneRow(row))));
      };
    });
    const result = await subject.adapter.appendMissingPhysicalBookingRows(pair);
    permanentEqual({ state: result.state, inserts: inserts(subject).length },
      { state: 'STOPPED', inserts: 0 },
      'B2-03 snapshots every get in a multi-row set before query dispatch');
  }
  {
    const pair = rowSet('getawaitsnapshot01', [3, 4]);
    const mutableFirst = cloneRow(pair[0], { payloadDigest: 'b'.repeat(64) });
    const subject = contextFor([], function(env) {
      env.behavior.get = function(collection, id) {
        if (id === pair[0]._id) return Promise.resolve(mutableFirst);
        return { then: function(resolve) {
          mutableFirst.payloadDigest = pair[0].payloadDigest;
          resolve(cloneRow(pair[1]));
        } };
      };
      env.behavior.find = function() { return Promise.resolve(page(pair.map(row => cloneRow(row)))); };
    });
    const result = await subject.adapter.appendMissingPhysicalBookingRows(pair);
    permanentEqual({ state: result.state, inserts: inserts(subject).length },
      { state: 'STOPPED', inserts: 0 },
      'B2-03 snapshots each resolved get before awaiting the next get');
  }

  // B2-04: both get and query evidence must have stable key order and flags.
  function unstableStoredRow(row, kind) {
    let pass = 0;
    return new Proxy(cloneRow(row), {
      ownKeys: function(target) {
        pass += 1;
        const keys = Reflect.ownKeys(target);
        return kind === 'keys' && pass % 2 === 0 ? keys.slice().reverse() : keys;
      },
      getOwnPropertyDescriptor: function(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (kind === 'writable' && descriptor && key === 'status') descriptor.writable = pass % 2 === 1;
        return descriptor;
      }
    });
  }
  for (const sourceName of ['get', 'query']) {
    for (const kind of ['keys', 'writable']) {
      const unstable = unstableStoredRow(rows[0], kind);
      const subject = contextFor([], function(env) {
        env.behavior.get = function() {
          return Promise.resolve(sourceName === 'get' ? unstable : cloneRow(rows[0]));
        };
        env.behavior.find = function() {
          return Promise.resolve(page([sourceName === 'query' ? unstable : cloneRow(rows[0])]));
        };
      });
      const result = await subject.adapter.appendMissingPhysicalBookingRows([rows[0]]);
      permanentEqual({ state: result.state, classification: result.failed && result.failed.classification,
        inserts: inserts(subject).length },
      { state: 'STOPPED', classification: 'INTEGRITY', inserts: 0 },
      'B2-04 rejects unstable stored ' + kind + ' from ' + sourceName);
    }
  }

  const duplicateQuery = contextFor([rows[0]], function(env) {
    env.behavior.find = function() {
      return Promise.resolve(page([cloneRow(rows[0]), cloneRow(rows[0])]));
    };
  });
  permanentEqual(await duplicateQuery.adapter.appendMissingPhysicalBookingRows([rows[0]]),
    stopped(1, rows[0]._id, 'INTEGRITY'),
    'mutation guard rejects duplicate IDs returned by the operation query');

  const canonicalDisagreement = contextFor([rows[0]], function(env) {
    env.behavior.find = function() {
      return Promise.resolve(page([cloneRow(rows[0], { payloadDigest: 'b'.repeat(64) })]));
    };
  });
  permanentEqual(await canonicalDisagreement.adapter.appendMissingPhysicalBookingRows([rows[0]]),
    stopped(0, rows[0]._id, 'UNRESOLVED'),
    'mutation guard rejects canonical get/query disagreement as unresolved');

  // Permanent causal coverage for all 53 classified real B2 survivors.
  const api = contextFor([]).context.testApi;
  function validity(value) { return value === api.INVALID ? 'INVALID' : 'VALID'; }
  function deepProperty(depth) {
    let holder = {};
    Object.defineProperty(holder, 'x', {
      value: function() {}, enumerable: true, writable: false, configurable: true
    });
    for (let index = 0; index < depth; index += 1) holder = Object.create(holder);
    return holder;
  }
  function driftingExpected(field, change) {
    const target = cloneRow(rows[0]);
    let pass = 0;
    return new Proxy(target, {
      getOwnPropertyDescriptor: function(object, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (key === field) {
          pass += 1;
          return change(descriptor, pass);
        }
        return descriptor;
      }
    });
  }

  {
    const target = cloneRow(rows[0], { _owner: 'owner-1' });
    let pass = 0;
    const unstable = new Proxy(target, { ownKeys: function(object) {
      pass += 1;
      const keys = Reflect.ownKeys(object);
      return pass % 2 ? keys.filter(key => key !== '_owner') : keys;
    } });
    const subject = contextFor([rows[0]], function(env) {
      env.behavior.get = function() { return Promise.resolve(unstable); };
    });
    const result = await subject.adapter.appendMissingPhysicalBookingRows([rows[0]]);
    permanentEqual({ state: result.state, classification: result.failed && result.failed.classification },
      { state: 'STOPPED', classification: 'INTEGRITY' },
      'B2 survivor ID 16 rejects stored metadata key-set drift');
  }
  {
    Object.defineProperty(String.prototype, 'b2Capability', {
      configurable: true, value: function() {}
    });
    try {
      permanentEqual(validity(api.dataProperty('primitive-owner', 'b2Capability')), 'INVALID',
        'B2 survivor ID 24 rejects primitive capability owners');
    } finally {
      delete String.prototype.b2Capability;
    }
  }
  permanentEqual(validity(api.dataProperty(deepProperty(8), 'x')), 'INVALID',
    'B2 survivor ID 29 enforces the eight-holder capability limit');
  permanentEqual(validity(api.dataProperty(deepProperty(8), 'x')), 'INVALID',
    'B2 survivor ID 32 advances capability depth toward the limit');
  {
    const first = function() {};
    const second = function() {};
    let pass = 0;
    const unstable = new Proxy({}, { getOwnPropertyDescriptor: function(object, key) {
      if (key !== 'x') return undefined;
      pass += 1;
      return { value: pass % 2 ? first : second, enumerable: true, writable: true, configurable: true };
    } });
    permanentEqual(validity(api.dataProperty(unstable, 'x')), 'INVALID',
      'B2 survivor ID 46 rejects capability value drift');
  }
  permanentEqual(validity(api.capability({ get: 1 }, 'get')), 'INVALID',
    'B2 survivor ID 53 rejects non-callable capability values');
  {
    const items = [];
    Object.defineProperty(items, '0', {
      enumerable: true, configurable: true, get: function() { return cloneRow(rows[0]); }
    });
    const subject = contextFor([], function(env) {
      env.behavior.find = function() { return Promise.resolve(page(items)); };
    });
    const result = await subject.adapter.appendMissingPhysicalBookingRows([rows[0]]);
    permanentEqual({ classification: result.failed && result.failed.classification,
      index: result.failed && result.failed.index },
    { classification: 'UNRESOLVED', index: 0 },
    'B2 survivor ID 94 rejects accessor query items without reclassification');
  }
  {
    const unstable = driftingExpected('status', function(descriptor, pass) {
      return Object.assign({}, descriptor, { writable: pass % 2 === 1 });
    });
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows([unstable]);
    permanentEqual({ state: result.state, calls: subject.calls.length },
      { state: 'STOPPED', calls: 0 },
      'B2 survivor ID 136 rejects expected descriptor writability drift');
  }
  for (const id of [163, 167]) {
    const unstable = driftingExpected('payloadDigest', function(descriptor, pass) {
      return Object.assign({}, descriptor, { value: (pass % 2 ? 'a' : 'b').repeat(64) });
    });
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows([unstable]);
    permanentEqual({ state: result.state, calls: subject.calls.length },
      { state: 'STOPPED', calls: 0 },
      'B2 survivor ID ' + id + ' rejects expected payload drift between snapshots');
  }
  {
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows([
      cloneRow(rows[0], { bookingNumber: ' WC-7001' })
    ]);
    permanentEqual({ state: result.state, calls: subject.calls.length },
      { state: 'STOPPED', calls: 0 },
      'B2 survivor ID 186 rejects surrounding booking-number whitespace');
  }
  {
    const candidates = [rows[0], cloneRow(rows[1], { payloadDigest: 'b'.repeat(64) })];
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows(candidates);
    permanentEqual({ state: result.state, index: result.failed && result.failed.index,
      calls: subject.calls.length },
    { state: 'STOPPED', index: 1, calls: 0 },
    'B2 survivor ID 213 rejects a later-row digest mismatch');
  }
  {
    const candidates = [rows[0], cloneRow(rows[1], {
      checkIn: new Date('2027-11-06T12:00:00.000Z')
    })];
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows(candidates);
    permanentEqual({ state: result.state, index: result.failed && result.failed.index,
      calls: subject.calls.length },
    { state: 'STOPPED', index: 1, calls: 0 },
    'B2 survivor ID 219 rejects a later-row check-in mismatch');
  }
  {
    const candidates = rowSet('fractionalguests1', [2]);
    candidates[0].guests = 3.5;
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows(candidates);
    permanentEqual({ state: result.state, calls: subject.calls.length, inserts: inserts(subject).length },
      { state: 'STOPPED', calls: 0, inserts: 0 },
      'B2 survivor ID 230 rejects fractional guest counts before Wix I/O');
  }
  {
    const candidates = rowSet('validpenthouse01', [1]);
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows(candidates);
    permanentEqual({ state: result.state, inserts: inserts(subject).length },
      { state: 'CONFIRMED', inserts: 1 },
      'B2 survivor ID 250 accepts the valid penthouse topology');
  }
  {
    const candidates = rowSet('badunitmapping01', [2]);
    candidates[0].roomCode = 'adventure_suite';
    candidates[0].guests = 2;
    const subject = contextFor([]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows(candidates);
    permanentEqual({ state: result.state, calls: subject.calls.length },
      { state: 'STOPPED', calls: 0 },
      'B2 survivor ID 255 rejects adventure-suite unit two');
  }
  {
    const stored = Object.assign(Object.create(null), rows[0]);
    const subject = contextFor([stored]);
    const result = await subject.adapter.appendMissingPhysicalBookingRows([rows[0]]);
    permanentEqual({ state: result.state, classification: result.failed && result.failed.classification },
      { state: 'STOPPED', classification: 'INTEGRITY' },
      'B2 survivor ID 293 rejects null-prototype stored rows');
  }

  {
    const base = rowSet('metadataevidence1', [1])[0];
    const target = Object.assign({ _createdDate: new Date(0) }, base);
    let pass = 0;
    const unstable = new Proxy(target, {
      ownKeys: function() {
        pass += 1;
        return [pass % 2 ? '_createdDate' : '_updatedDate'].concat(Object.keys(base));
      },
      getOwnPropertyDescriptor: function(object, key) {
        if (key === '_updatedDate') {
          return { value: new Date(0), enumerable: true, writable: true, configurable: true };
        }
        return Reflect.getOwnPropertyDescriptor(object, key);
      }
    });
    permanentEqual(validity(api.stableStored(unstable)), 'INVALID',
      'B2 survivor ID 17 compares stored evidence from index zero');
  }
  {
    function callable() {}
    Object.defineProperty(callable, 'x', { value: 1 });
    permanentEqual(validity(api.dataProperty(callable, 'x')), 'VALID',
      'B2 survivor ID 27 accepts callable data-property owners');
  }
  permanentEqual(validity(api.dataProperty(deepProperty(8), 'x')), 'INVALID',
    'B2 survivor ID 30 rejects properties beyond depth seven');
  {
    const parent = {};
    Object.defineProperty(parent, 'x', { value: 1 });
    permanentEqual(validity(api.dataProperty(Object.create(parent), 'x')), 'VALID',
      'B2 survivor ID 36 accepts inherited stable data properties');
  }
  {
    const first = { x: 1 };
    const second = { x: 1 };
    let pass = 0;
    const unstable = new Proxy({}, { getPrototypeOf: function() {
      pass += 1;
      return pass % 2 ? first : second;
    } });
    permanentEqual(validity(api.dataProperty(unstable, 'x')), 'INVALID',
      'B2 survivor ID 42 rejects capability-holder drift');
  }
  {
    let pass = 0;
    const unstable = new Proxy({}, { getOwnPropertyDescriptor: function(object, key) {
      if (key !== 'x') return undefined;
      pass += 1;
      return { value: 1, enumerable: true, writable: pass % 2 === 1, configurable: true };
    } });
    permanentEqual(validity(api.dataProperty(unstable, 'x')), 'INVALID',
      'B2 survivor ID 48 rejects capability writability drift');
  }
  permanentEqual(api.scalarCount('\uD800A', 10, false), false,
    'B2 survivor ID 76 rejects a high surrogate followed by a non-surrogate');
  {
    const items = [];
    Object.defineProperty(items, '0', {
      get: function() { return 1; }, enumerable: true, configurable: true
    });
    permanentEqual(validity(api.stableItems(items)), 'INVALID',
      'B2 survivor ID 95 rejects accessor array elements');
  }
  {
    const candidates = rowSet('extraarraykey001', [1]);
    Object.defineProperty(candidates, 'extra', { value: 1, enumerable: true });
    permanentEqual(validity(api.takeExpectedSnapshot(candidates)), 'INVALID',
      'B2 survivor ID 106 rejects extra own keys on expected-row arrays');
  }
  {
    let traps = 0;
    function callable() {}
    const hostile = new Proxy(callable, { getPrototypeOf: function() {
      traps += 1;
      return Object.prototype;
    } });
    const candidates = rowSet('callablerowtest1', [1]);
    candidates[0] = hostile;
    permanentEqual({ validity: validity(api.takeExpectedSnapshot(candidates)), traps },
      { validity: 'INVALID', traps: 0 },
      'B2 survivor ID 122 rejects callable expected rows without prototype traps');
  }
  {
    const target = rowSet('evidenceconcat01', [1])[0];
    let pass = 0;
    const unstable = new Proxy(target, { getOwnPropertyDescriptor: function(object, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      if (key === 'note') {
        pass += 1;
        descriptor.writable = pass % 2 === 1;
      }
      return descriptor;
    } });
    permanentEqual(validity(api.snapshotExpected([unstable])), 'INVALID',
      'B2 survivor ID 137 preserves expected descriptor flags in evidence');
  }
  {
    const target = rowSet('changingrowid001', [1])[0];
    let pass = 0;
    const unstable = new Proxy(target, { getOwnPropertyDescriptor: function(object, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      if (key === '_id') {
        pass += 1;
        if (pass > 1) descriptor.value = 'pb1-changingrowid001-rX';
      }
      return descriptor;
    } });
    permanentEqual(validity(api.snapshotExpected([unstable])), 'INVALID',
      'B2 survivor ID 159 compares expected row IDs from index zero');
  }
  {
    const target = rowSet('freshdateobjects1', [1])[0];
    const stable = new Proxy(target, { getOwnPropertyDescriptor: function(object, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      if (key === 'checkIn') descriptor.value = new Date(descriptor.value.getTime());
      return descriptor;
    } });
    permanentEqual(validity(api.snapshotExpected([stable])), 'VALID',
      'B2 survivor ID 164 compares check-in dates by instant, not identity');
  }
  {
    const target = rowSet('changingcheckin1', [1])[0];
    let pass = 0;
    const unstable = new Proxy(target, { getOwnPropertyDescriptor: function(object, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      if (key === 'checkIn') {
        pass += 1;
        if (pass > 1) descriptor.value = new Date('2027-11-06T12:00:00.000Z');
      }
      return descriptor;
    } });
    permanentEqual(validity(api.snapshotExpected([unstable])), 'INVALID',
      'B2 survivor ID 171 rejects check-in timestamp drift');
  }
  {
    const candidates = rowSet('wrongidvalidation', [1]);
    candidates[0]._id = 'wrong-but-string';
    permanentEqual(api.validExpected(api.takeExpectedSnapshot(candidates)), 0,
      'B2 survivor ID 200 rejects a non-deterministic string row ID');
  }
  {
    const candidates = rowSet('bookingmismatch1', [3, 4]);
    candidates[1].bookingNumber = 'OTHER';
    permanentEqual(api.validExpected(api.takeExpectedSnapshot(candidates)), 1,
      'B2 survivor ID 215 rejects a later-row booking-number mismatch');
  }
  {
    const candidates = rowSet('invalidstatus001', [1]);
    candidates[0].status = 'pending';
    permanentEqual(api.validExpected(api.takeExpectedSnapshot(candidates)), 0,
      'B2 survivor ID 226 rejects a non-confirmed status independently');
  }
  {
    const candidates = rowSet('fractionalfee001', [1]);
    candidates[0].roomFee = 1.5;
    permanentEqual(api.validExpected(api.takeExpectedSnapshot(candidates)), 0,
      'B2 survivor ID 231 rejects fractional room fees');
  }
  {
    const candidates = rowSet('unknownroomcode1', [1]);
    candidates[0].roomCode = 'bogus';
    candidates[0].roomFee = 0;
    permanentEqual(api.validExpected(api.takeExpectedSnapshot(candidates)), 0,
      'B2 survivor ID 251 rejects unknown unit-one room codes');
  }
  {
    let traps = 0;
    function callable() {}
    const hostile = new Proxy(callable, { getPrototypeOf: function() {
      traps += 1;
      return Object.prototype;
    } });
    permanentEqual({ validity: validity(api.stableStored(hostile)), traps },
      { validity: 'INVALID', traps: 0 },
      'B2 survivor ID 290 rejects callable stored values without prototype traps');
  }

  permanentEqual(validity(api.dataProperty(deepProperty(7), 'x')), 'VALID',
    'B2 survivor ID 28 accepts a property at depth seven');
  permanentEqual(validity(api.dataProperty(deepProperty(8), 'x')), 'INVALID',
    'B2 survivor ID 31 terminates capability search after eight holders');
  {
    const fn = function() {};
    const holder = {};
    Object.defineProperty(holder, 'x', {
      value: fn, enumerable: true, writable: false, configurable: true
    });
    const bridge = Object.create(holder);
    let pass = 0;
    const unstable = new Proxy({}, { getPrototypeOf: function() {
      pass += 1;
      return pass === 1 ? holder : bridge;
    } });
    permanentEqual(validity(api.dataProperty(unstable, 'x')), 'INVALID',
      'B2 survivor ID 44 rejects stable holders observed at changing depths');
  }
  {
    const fn = function() {};
    let pass = 0;
    const unstable = new Proxy({}, { getOwnPropertyDescriptor: function(object, key) {
      if (key !== 'x') return undefined;
      pass += 1;
      return { value: fn, enumerable: true, writable: pass === 2, configurable: true };
    } });
    permanentEqual(validity(api.dataProperty(unstable, 'x')), 'INVALID',
      'B2 survivor ID 50 rejects independent writable-flag drift');
  }
  permanentEqual(api.scalarCount('WC-\uD800A', 128, false), false,
    'B2 survivor ID 78 returns false for malformed surrogate pairs');
  {
    const candidates = rowSet('arrayprototype01', [3, 4]);
    Object.setPrototypeOf(candidates, Object.prototype);
    permanentEqual(validity(api.takeExpectedSnapshot(candidates)), 'INVALID',
      'B2 survivor ID 97 rejects expected arrays with a changed prototype');
  }
  {
    const candidates = rowSet('rowprototype001', [3, 4]);
    Object.setPrototypeOf(candidates[0], Object.create(Object.prototype));
    permanentEqual(validity(api.takeExpectedSnapshot(candidates)), 'INVALID',
      'B2 survivor ID 123 rejects expected rows with a custom prototype');
  }
  {
    const target = rowSet('descriptorflags1', [3, 4])[0];
    let round = 0;
    const unstable = new Proxy(target, {
      ownKeys: function(object) { round += 1; return Reflect.ownKeys(object); },
      getOwnPropertyDescriptor: function(object, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (round === 2 && key === 'status') descriptor.writable = false;
        return descriptor;
      }
    });
    const candidates = [unstable, rowSet('descriptorflags1', [3, 4])[1]];
    permanentEqual(validity(api.snapshotExpected(candidates)), 'INVALID',
      'B2 survivor ID 138 retains writable evidence across expected snapshots');
  }
  {
    const candidates = rowSet('invalidsecondsnap', [3, 4]);
    const target = candidates[0];
    let round = 0;
    candidates[0] = new Proxy(target, {
      ownKeys: function(object) { round += 1; return Reflect.ownKeys(object); },
      getOwnPropertyDescriptor: function(object, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (round === 2 && key === '_id') {
          return { get: function() { return descriptor.value; }, enumerable: true, configurable: true };
        }
        return descriptor;
      }
    });
    permanentEqual(validity(api.snapshotExpected(candidates)), 'INVALID',
      'B2 survivor ID 152 rejects an invalid second expected snapshot');
  }
  {
    const candidates = rowSet('statussnapshot01', [3, 4]);
    const target = candidates[0];
    let round = 0;
    candidates[0] = new Proxy(target, {
      ownKeys: function(object) { round += 1; return Reflect.ownKeys(object); },
      getOwnPropertyDescriptor: function(object, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (round === 2 && key === 'status') descriptor.value = 'cancelled';
        return descriptor;
      }
    });
    permanentEqual(validity(api.snapshotExpected(candidates)), 'INVALID',
      'B2 survivor ID 165 rejects ordinary-field drift between snapshots');
  }
  {
    const candidates = rowSet('short', [3, 4]);
    permanentEqual(api.validExpected(api.takeExpectedSnapshot(candidates)), 0,
      'B2 survivor ID 180 rejects short operation IDs independently of valid digests');
  }
  {
    const candidates = rowSet('digestmismatch01', [3, 4]);
    candidates[1].payloadDigest = 'b'.repeat(64);
    permanentEqual(api.validExpected(api.takeExpectedSnapshot(candidates)), 1,
      'B2 survivor ID 211 rejects a later-row digest mismatch independently');
  }
  {
    const candidates = rowSet('roomcodemismatch', [3, 4]);
    candidates[1].roomCode = 'penthouse_apartment';
    permanentEqual(api.validExpected(api.takeExpectedSnapshot(candidates)), 1,
      'B2 survivor ID 217 rejects a later-row room-code mismatch independently');
  }
  {
    const candidates = rowSet('ownerblocklater1', [3, 4]);
    candidates[1].autoOwnerBlock = true;
    permanentEqual(api.validExpected(api.takeExpectedSnapshot(candidates)), 1,
      'B2 survivor ID 229 rejects auto-owner-block independently of guest validity');
  }
  {
    const candidates = rowSet('positivefraction1', [1]);
    candidates[0].roomFee = 175.5;
    permanentEqual(api.validExpected(api.takeExpectedSnapshot(candidates)), 0,
      'B2 survivor ID 232 rejects positive fractional penthouse fees');
  }
  {
    const candidates = rowSet('validpenthouse02', [1]);
    permanentEqual(api.validExpected(api.takeExpectedSnapshot(candidates)), -1,
      'B2 survivor ID 252 accepts penthouse unit one');
  }

  if (permanentFailures.length) {
    const groups = permanentFailures.reduce(function(counts, failure) {
      const match = /^FAIL: (B2-\d+)/.exec(failure);
      const group = match ? match[1] : 'mutation guards';
      counts[group] = (counts[group] || 0) + 1;
      return counts;
    }, {});
    const grouped = Object.keys(groups).sort().map(key => key + '=' + groups[key]).join(', ');
    throw new Error(`Permanent B2 RED coverage evaluated ${assertions} assertions with ` +
      `${permanentFailures.length} expected failures (${grouped}):\n\n${permanentFailures.join('\n\n')}`);
  }
  console.log(`Room booking row recovery verification passed (${assertions} assertions).`);
})().catch(function(error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
