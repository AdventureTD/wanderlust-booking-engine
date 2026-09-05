// Behavioral tests for disconnected deterministic booking-row persistence.
// Run: node scripts/verify-room-booking-row-adapter.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

function assertEqual(actual, expected, message) {
  const actualJson = JSON.stringify(comparable(actual));
  const expectedJson = JSON.stringify(comparable(expected));
  if (actualJson !== expectedJson) {
    throw new Error(`FAIL: ${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`);
  }
  console.log(`PASS: ${message}`);
}

async function assertRejects(run, expectedMessage, message) {
  let error = null;
  try { await run(); } catch (caught) { error = caught; }
  if (!error || error.message !== expectedMessage) {
    throw new Error(`FAIL: ${message}\nExpected error: ${expectedMessage}\nActual: ${error && error.message}`);
  }
  console.log(`PASS: ${message}`);
}

const backendDir = path.join(__dirname, '..', 'velo', 'backend');
const sourcePath = path.join(backendDir, 'roomBookingRows.js');
const moduleSource = fs.readFileSync(sourcePath, 'utf8');
const source = moduleSource
  .replace(/^import .*;\s*$/gm, '')
  .replace(/export async function /g, 'async function ')
  + '\nthis.adapter = { appendPhysicalBookingRows, loadOperationBookingRows };';

let esmImportSequence = 0;
async function createStrictEsmAdapter(wixData) {
  esmImportSequence += 1;
  const portKey = '__roomBookingRowsWixData' + esmImportSequence;
  globalThis[portKey] = wixData;
  const esmSource = moduleSource.replace(/^import .*;\s*$/m,
    'const wixData = globalThis[' + JSON.stringify(portKey) + '];');
  try {
    const url = 'data:text/javascript;base64,' + Buffer.from(esmSource).toString('base64') +
      '#' + esmImportSequence;
    return await import(url);
  } finally {
    delete globalThis[portKey];
  }
}

function createContext(queryFirstPage) {
  const calls = [];
  const store = new Map();
  const wixData = {
    query: function(collection) {
      calls.push({ method: 'query', collection });
      return {
        eq: function(field, value) {
          calls.push({ method: 'eq', field, value });
          return this;
        },
        limit: function(value) {
          calls.push({ method: 'limit', value });
          return this;
        },
        find: async function(options) {
          calls.push({ method: 'find', options });
          return queryFirstPage;
        }
      };
    },
    insert: async function(collection, row, options) {
      calls.push({ method: 'insert', collection, row, options, receiver: this });
      if (store.has(row._id)) throw new Error('duplicate ID');
      store.set(row._id, Object.assign({ _createdDate: new Date('2027-01-01T00:00:00.000Z') }, row));
      return { ignored: true };
    },
    get: async function(collection, id, options) {
      calls.push({ method: 'get', collection, id, options, receiver: this });
      return store.get(id) || null;
    }
  };
  const context = {
    wixData, Date, Object, Reflect, Array, Number, String, RegExp, Promise, Error, Set, Map
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { adapter: context.adapter, calls, store, wixData,
    arrayPrototype: vm.runInContext('Object.getPrototypeOf([])', context) };
}

function createContextWithWixData(wixData) {
  const context = {
    wixData, Date, Object, Reflect, Array, Number, String, RegExp, Promise, Error, Set, Map
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { adapter: context.adapter, wixData };
}

function optionsAreFreshImmutable(calls) {
  const used = calls.filter(function(call) { return call.options; })
    .map(function(call) { return call.options; });
  return used.every(function(value, index) {
    const expected = Object.prototype.hasOwnProperty.call(value, 'consistentRead')
      ? ['suppressAuth', 'consistentRead', 'suppressHooks']
      : ['suppressAuth', 'suppressHooks'];
    return Reflect.ownKeys(value).join(',') === expected.join(',') &&
      expected.every(function(key) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && descriptor.value === true && descriptor.enumerable === true &&
          descriptor.writable === false && descriptor.configurable === false;
      }) && Object.getPrototypeOf(value) === Object.prototype && Object.isFrozen(value) &&
      Object.isExtensible(value) === false && used.indexOf(value) === index;
  });
}

const operationId = 'coordinatortrace01';
const payloadDigest = '1'.repeat(64);
const base = {
  roomCode: 'adventure_suite',
  quantity: 1,
  checkIn: new Date('2027-11-05T12:00:00.000Z'),
  checkOut: new Date('2027-11-07T12:00:00.000Z'),
  bookingNumber: 'WC-3001',
  operationId,
  payloadDigest,
  status: 'confirmed',
  autoOwnerBlock: false,
  guests: 2,
  roomFee: 0,
  note: ''
};
const rows = [
  Object.assign({}, base, { _id: 'pb1-' + operationId + '-r1', assignedRoom: 3 }),
  Object.assign({}, base, { _id: 'pb1-' + operationId + '-r2', assignedRoom: 4 })
];

(async function() {
  async function appendOutcome(adapter, candidateRows) {
    try { return await adapter.appendPhysicalBookingRows(candidateRows); }
    catch (error) { return { threw: error.name }; }
  }
  assertEqual(await appendOutcome(createContext().adapter, [rows[0]]), {
    state: 'CONFIRMED', confirmed: [{ rowId: rows[0]._id, disposition: 'inserted' }]
  }, '[boundary-L309-4] first-row ordering never reads a negative predecessor index');

  let accessorInvocations = 0;
  const accessorPort = {};
  Object.defineProperty(accessorPort, 'insert', {
    get: function() { accessorInvocations += 1; return async function() {}; }
  });
  accessorPort.get = async function() { return null; };
  const accessorContext = createContextWithWixData(accessorPort);
  assertEqual(await accessorContext.adapter.appendPhysicalBookingRows([rows[0]]), {
    state: 'STOPPED', confirmed: [],
    failed: { index: 0, rowId: rows[0]._id, classification: 'UNRESOLVED' }
  }, 'an accessor-backed Wix insert capability fails closed');
  assertEqual(accessorInvocations, 0,
    'an accessor-backed Wix insert capability is rejected without invocation');

  const context = createContext();
  const result = await context.adapter.appendPhysicalBookingRows(rows);
  assertEqual(result, {
    state: 'CONFIRMED',
    confirmed: [
      { rowId: rows[0]._id, disposition: 'inserted' },
      { rowId: rows[1]._id, disposition: 'inserted' }
    ]
  }, 'a new deterministic two-row booking batch is inserted and authoritatively confirmed');
  assertEqual(context.calls.map(function(call) {
    return {
      method: call.method,
      collection: call.collection,
      id: call.id || call.row._id,
      options: call.options
    };
  }), [
    { method: 'insert', collection: 'Bookings', id: rows[0]._id,
      options: { suppressAuth: true, suppressHooks: true } },
    { method: 'get', collection: 'Bookings', id: rows[0]._id,
      options: { suppressAuth: true, consistentRead: true, suppressHooks: true } },
    { method: 'insert', collection: 'Bookings', id: rows[1]._id,
      options: { suppressAuth: true, suppressHooks: true } },
    { method: 'get', collection: 'Bookings', id: rows[1]._id,
      options: { suppressAuth: true, consistentRead: true, suppressHooks: true } }
  ], 'booking rows are written sequentially and every insert is read back with explicit options');
  assertEqual(optionsAreFreshImmutable(context.calls), true,
    'every append dispatch receives fresh immutable explicit options');
  assertEqual({
    queries: context.calls.filter(function(call) { return call.method === 'query'; }).length,
    receivers: context.calls.filter(function(call) {
      return call.method === 'insert' || call.method === 'get';
    }).every(function(call) { return call.receiver === context.wixData; })
  }, { queries: 0, receivers: true },
  'normal append performs no query and preserves Wix method receivers');

  const threeRows = rows.concat([
    Object.assign({}, base, { _id: 'pb1-' + operationId + '-r3', assignedRoom: 5 })
  ]);
  const allUnits = createContext();
  assertEqual(await allUnits.adapter.appendPhysicalBookingRows(threeRows), {
    state: 'CONFIRMED',
    confirmed: threeRows.map(function(row) { return { rowId: row._id, disposition: 'inserted' }; })
  }, 'the complete adventure-suite 3,4,5 topology appends sequentially');
  assertEqual(allUnits.calls.map(function(call) { return call.method; }),
    ['insert', 'get', 'insert', 'get', 'insert', 'get'],
    'the three-row append alternates insert and authoritative get without query use');

  let expectedGetterRuns = 0;
  const accessorExpectedRow = Object.assign({}, rows[0]);
  Object.defineProperty(accessorExpectedRow, 'status', {
    enumerable: true, configurable: true,
    get: function() { expectedGetterRuns += 1; return 'confirmed'; }
  });
  const accessorExpected = createContext();
  assertEqual((await accessorExpected.adapter.appendPhysicalBookingRows([
    accessorExpectedRow
  ])).state, 'STOPPED', 'an accessor-backed expected field fails closed');
  assertEqual({ getterRuns: expectedGetterRuns, calls: accessorExpected.calls.length },
    { getterRuns: 0, calls: 0 },
    'expected-field accessors are rejected without invocation or Wix I/O');

  const immutableTimestampContext = createContext();
  const immutableTimestampRow = Object.assign({}, rows[0], {
    checkIn: rows[0].checkIn.toISOString(),
    checkOut: rows[0].checkOut.toISOString()
  });
  assertEqual(await immutableTimestampContext.adapter.appendPhysicalBookingRows([
    immutableTimestampRow
  ]), {
    state: 'CONFIRMED',
    confirmed: [{ rowId: rows[0]._id, disposition: 'inserted' }]
  }, 'immutable canonical timestamps are converted and authoritatively persisted');
  const timestampInsert = immutableTimestampContext.calls.find(function(call) {
    return call.method === 'insert';
  });
  assertEqual({
    insertedCheckInIsDate: timestampInsert && timestampInsert.row.checkIn instanceof Date,
    insertedCheckIn: timestampInsert && timestampInsert.row.checkIn,
    callerCheckIn: immutableTimestampRow.checkIn
  }, {
    insertedCheckInIsDate: true,
    insertedCheckIn: rows[0].checkIn,
    callerCheckIn: rows[0].checkIn.toISOString()
  }, 'the adapter creates detached Date values without mutating its immutable input');

  async function verifyCallerDateDetached(field) {
    const detachedContext = createContext();
    const callerRow = Object.assign({}, rows[0], {
      checkIn: new Date(rows[0].checkIn.getTime()),
      checkOut: new Date(rows[0].checkOut.getTime())
    });
    const originalTime = callerRow[field].getTime();
    detachedContext.wixData.insert = async function(collection, persistedRow) {
      persistedRow[field].setUTCHours(13);
      throw new Error('force authoritative reconciliation');
    };
    await detachedContext.adapter.appendPhysicalBookingRows([callerRow]);
    assertEqual(callerRow[field].getTime(), originalTime,
      'adapter persistence cannot mutate the caller-owned ' + field + ' Date');
  }
  await verifyCallerDateDetached('checkIn');
  await verifyCallerDateDetached('checkOut');

  const unsafe = createContext();
  assertEqual(await unsafe.adapter.appendPhysicalBookingRows([
    Object.assign({}, rows[0], { status: 'pending' })
  ]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, rowId: rows[0]._id, classification: 'INTEGRITY' }
  }, 'a non-inventory-visible booking row fails closed during preflight');
  assertEqual(unsafe.calls.length, 0,
    'invalid booking rows are rejected before Wix persistence I/O');

  const ownerBlock = createContext();
  assertEqual(await ownerBlock.adapter.appendPhysicalBookingRows([
    Object.assign({}, rows[0], { autoOwnerBlock: true })
  ]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, rowId: rows[0]._id, classification: 'INTEGRITY' }
  }, 'a derived owner-block row cannot enter the guest booking commit seam');
  assertEqual(ownerBlock.calls.length, 0,
    'owner-block misuse is rejected before Wix persistence I/O');

  async function verifyPreflightFailure(candidateRows, expectedIndex, message, rowEvidenceAvailable) {
    const candidate = createContext();
    assertEqual(await candidate.adapter.appendPhysicalBookingRows(candidateRows), {
      state: 'STOPPED',
      confirmed: [],
      failed: {
        index: expectedIndex,
        rowId: rowEvidenceAvailable === false
          ? undefined : candidateRows[expectedIndex] && candidateRows[expectedIndex]._id,
        classification: 'INTEGRITY'
      }
    }, message);
    assertEqual(candidate.calls.length, 0, message + ' with zero Wix I/O');
  }

  await verifyPreflightFailure([
    Object.assign({}, rows[0], { bookingNumber: 'WC-\u0001' })
  ], 0, 'control characters in booking numbers are rejected by the writer');
  await verifyPreflightFailure([
    Object.assign({}, rows[0], {
      checkIn: new Date('2027-01-01T12:00:00.000Z'),
      checkOut: new Date('2030-01-01T12:00:00.000Z')
    })
  ], 0, 'stays longer than 800 nights are rejected by the writer');
  await verifyPreflightFailure([
    Object.assign({}, rows[0], { guests: 1 })
  ], 0, 'room-specific occupancy is enforced before append');
  await verifyPreflightFailure([
    Object.assign({}, rows[0], { roomFee: 1 })
  ], 0, 'non-penthouse booking rows require zero room fee before append');

  await verifyPreflightFailure([], 0,
    'an empty booking-row acquisition fails closed during preflight');
  await verifyPreflightFailure([
    Object.assign({}, rows[0], { checkOut: new Date('2027-11-07T12:00:00.001Z') })
  ], 0, 'a nonzero checkout millisecond is rejected independently', false);
  await verifyPreflightFailure([
    Object.assign({}, rows[0], {
      checkIn: '+010000-11-05T12:00:00.000Z',
      checkOut: '+010000-11-07T12:00:00.000Z'
    })
  ], 0, 'extended-year timestamps are rejected even when Date can parse them', false);
  await verifyPreflightFailure([
    Object.assign({}, rows[0], {
      checkIn: new Date('+010000-11-05T12:00:00.000Z'),
      checkOut: new Date('+010000-11-07T12:00:00.000Z')
    })
  ], 0, 'extended-year Date objects are rejected before persistence', false);
  await verifyPreflightFailure([
    Object.assign({}, rows[0], {
      checkIn: '2027-02-30T12:00:00.000Z',
      checkOut: '2027-03-03T12:00:00.000Z'
    })
  ], 0, 'normalized impossible calendar dates are rejected by ISO round-trip validation', false);
  await verifyPreflightFailure([
    rows[0], Object.assign({}, rows[1], { payloadDigest: '2'.repeat(64) })
  ], 1, 'a cross-row payload digest mismatch is rejected independently');
  await verifyPreflightFailure([
    rows[0], Object.assign({}, rows[1], { bookingNumber: 'WC-3002' })
  ], 1, 'a cross-row booking number mismatch is rejected independently');
  await verifyPreflightFailure([
    rows[0], Object.assign({}, rows[1], {
      checkIn: new Date('2027-11-06T12:00:00.000Z')
    })
  ], 1, 'a cross-row check-in mismatch is rejected independently');
  await verifyPreflightFailure([
    rows[0], Object.assign({}, rows[1], {
      checkOut: new Date('2027-11-08T12:00:00.000Z')
    })
  ], 1, 'a cross-row check-out mismatch is rejected independently');
  await verifyPreflightFailure([
    rows[0], Object.assign({}, rows[1], { assignedRoom: 5 })
  ], 1, 'the non-contiguous adventure-suite assignment topology 3,5 is rejected');

  const threeRowBase = [
    Object.assign({}, base, { _id: 'pb1-' + operationId + '-r1' }),
    Object.assign({}, base, { _id: 'pb1-' + operationId + '-r2' }),
    Object.assign({}, base, { _id: 'pb1-' + operationId + '-r3' })
  ];
  await verifyPreflightFailure([
    Object.assign({}, threeRowBase[0], {
      roomCode: 'penthouse_apartment', assignedRoom: 1
    }),
    Object.assign({}, threeRowBase[1], {
      roomCode: 'two_bedroom_apartment', assignedRoom: 2
    }),
    Object.assign({}, threeRowBase[2], {
      roomCode: 'adventure_suite', assignedRoom: 3
    })
  ], 1, 'cross-row room-code consistency fails at its first isolated mismatch');
  await verifyPreflightFailure([
    Object.assign({}, threeRowBase[0], { assignedRoom: 3 }),
    Object.assign({}, threeRowBase[1], { assignedRoom: 6 }),
    Object.assign({}, threeRowBase[2], { assignedRoom: 7 })
  ], 1, 'room-code mapping fails at its first isolated invalid unit');
  await verifyPreflightFailure([
    Object.assign({}, threeRowBase[0], { assignedRoom: 4 }),
    Object.assign({}, threeRowBase[1], { assignedRoom: 3 }),
    Object.assign({}, threeRowBase[2], { assignedRoom: 5 })
  ], 1, 'append order fails at its first isolated descending room');
  await verifyPreflightFailure([
    Object.assign({}, threeRowBase[0], { assignedRoom: 3 }),
    Object.assign({}, threeRowBase[1], { assignedRoom: 3 }),
    Object.assign({}, threeRowBase[2], { assignedRoom: 4 })
  ], 1, 'duplicate assignment order fails at its first equal room');

  const invalidBatches = [
    [Object.assign({}, rows[0], { _id: 'random-row' })],
    [Object.assign({}, rows[0], { quantity: 2 })],
    [rows[0], Object.assign({}, rows[1], { operationId: 'differentoperation1' })],
    [Object.assign({}, rows[0], { assignedRoom: 4 }),
      Object.assign({}, rows[1], { assignedRoom: 3 })],
    [Object.assign({}, rows[0], { roomCode: 'two_bedroom_apartment' })],
    [Object.assign({}, rows[0], { operationId: 'short', _id: 'pb1-short-r1' })],
    [Object.assign({}, rows[0], { payloadDigest: 'A'.repeat(64) })],
    [Object.assign({}, rows[0], { bookingNumber: ' WC-3001' })],
    [Object.assign({}, rows[0], { checkIn: new Date('2027-11-05T00:00:00.000Z') })],
    [Object.assign({}, rows[0], { checkOut: new Date('2027-11-04T12:00:00.000Z') })],
    [Object.assign({}, rows[0], { unexpectedField: true })],
    [Object.assign({}, rows[0], { assignedRoom: 1, roomCode: 'penthouse_apartment' }),
      Object.assign({}, rows[1], { assignedRoom: 2, roomCode: 'two_bedroom_apartment' })]
  ];
  for (let index = 0; index < invalidBatches.length; index += 1) {
    const invalid = createContext();
    const result = await invalid.adapter.appendPhysicalBookingRows(invalidBatches[index]);
    assertEqual(result.state, 'STOPPED',
      'invalid deterministic booking-row topology fails closed case ' + (index + 1));
    assertEqual(result.confirmed, [],
      'invalid deterministic booking-row topology confirms no rows case ' + (index + 1));
    assertEqual(result.failed?.classification, 'INTEGRITY',
      'invalid deterministic booking-row topology is classified as integrity case ' + (index + 1));
    assertEqual(invalid.calls.length, 0,
      'invalid deterministic booking-row topology performs zero Wix I/O case ' + (index + 1));
  }

  const causalPreflightCases = [
    { row: Object.assign({}, rows[0], { bookingNumber: '' }), rowId: rows[0]._id,
      message: 'an empty booking number is rejected as integrity evidence' },
    { row: Object.assign({}, rows[0], { bookingNumber: null }), rowId: rows[0]._id,
      message: 'a null booking number is rejected as integrity evidence' },
    { row: Object.assign({}, rows[0], { bookingNumber: '\uD800' }), rowId: rows[0]._id,
      message: 'a lone high surrogate booking number is rejected' },
    { row: Object.assign({}, rows[0], { note: '\uDC00' }), rowId: rows[0]._id,
      message: 'a lone low surrogate note is rejected' },
    { row: Object.assign({}, rows[0], { bookingNumber: 'e\u0301' }), rowId: rows[0]._id,
      message: 'a non-NFC booking number is rejected' },
    { row: Object.assign({}, rows[0], { bookingNumber: 'x'.repeat(129) }), rowId: rows[0]._id,
      message: 'a booking number longer than 128 Unicode scalars is rejected' },
    { row: Object.assign({}, rows[0], { assignedRoom: NaN }), rowId: undefined,
      message: 'a NaN room assignment cannot provide trusted row-id evidence' },
    { row: Object.assign({}, rows[0], { roomFee: 175.5 }), rowId: rows[0]._id,
      message: 'a fractional room fee is rejected' },
    { row: Object.assign({}, rows[0], { roomFee: -1 }), rowId: rows[0]._id,
      message: 'a negative room fee is rejected' },
    { row: Object.assign({}, rows[0], { note: null }), rowId: rows[0]._id,
      message: 'a null note is rejected' },
    { row: Object.assign({}, rows[0], { checkIn: rows[0].checkOut }), rowId: rows[0]._id,
      message: 'equal check-in and check-out instants are rejected' }
  ];
  const accessorRoomCode = Object.assign({}, rows[0]);
  Object.defineProperty(accessorRoomCode, 'roomCode', {
    enumerable: true, configurable: true, get: function() { return rows[0].roomCode; }
  });
  causalPreflightCases.push({ row: accessorRoomCode, rowId: undefined,
    message: 'an accessor-backed room code is rejected without invocation' });
  const nonEnumerableId = Object.assign({}, rows[0]);
  Object.defineProperty(nonEnumerableId, '_id', {
    value: rows[0]._id, enumerable: false, writable: true, configurable: true
  });
  causalPreflightCases.push({ row: nonEnumerableId, rowId: undefined,
    message: 'a non-enumerable deterministic row id is rejected' });
  for (let index = 0; index < causalPreflightCases.length; index += 1) {
    const testCase = causalPreflightCases[index];
    const causal = createContext();
    assertEqual(await causal.adapter.appendPhysicalBookingRows([testCase.row]), {
      state: 'STOPPED', confirmed: [],
      failed: { index: 0, rowId: testCase.rowId, classification: 'INTEGRITY' }
    }, testCase.message);
    assertEqual(causal.calls.length, 0, testCase.message + ' before Wix I/O');
  }

  const oversizedBatch = createContext();
  const fourRows = [3, 4, 5, 5].map(function(unit, index) {
    return Object.assign({}, base, {
      _id: 'pb1-' + operationId + '-r' + (index + 1), assignedRoom: unit
    });
  });
  assertEqual(await oversizedBatch.adapter.appendPhysicalBookingRows(fourRows), {
    state: 'STOPPED', confirmed: [],
    failed: { index: 0, rowId: undefined, classification: 'INTEGRITY' }
  }, 'more than three physical rows are rejected before topology evaluation');
  assertEqual(oversizedBatch.calls.length, 0,
    'an oversized physical-row batch performs zero Wix I/O');

  const maximumBookingNumber = createContext();
  const maximumBookingRow = Object.assign({}, rows[0], { bookingNumber: 'x'.repeat(128) });
  assertEqual(await maximumBookingNumber.adapter.appendPhysicalBookingRows([maximumBookingRow]), {
    state: 'CONFIRMED',
    confirmed: [{ rowId: rows[0]._id, disposition: 'inserted' }]
  }, 'a booking number of exactly 128 Unicode scalars is accepted');

  const nonemptyFirstNote = createContext();
  assertEqual(await nonemptyFirstNote.adapter.appendPhysicalBookingRows([
    Object.assign({}, rows[0], { note: 'x' })
  ]), {
    state: 'CONFIRMED',
    confirmed: [{ rowId: rows[0]._id, disposition: 'inserted' }]
  }, 'a nonempty first-row note is accepted');

  for (const topologyCase of [
    { roomCode: 'penthouse_apartment', assignedRoom: 1, guests: 2 },
    { roomCode: 'two_bedroom_apartment', assignedRoom: 2, guests: 3 }
  ]) {
    const topology = createContext();
    const topologyRow = Object.assign({}, rows[0], topologyCase);
    assertEqual(await topology.adapter.appendPhysicalBookingRows([topologyRow]), {
      state: 'CONFIRMED',
      confirmed: [{ rowId: rows[0]._id, disposition: 'inserted' }]
    }, 'the one-row ' + topologyCase.roomCode + ' topology is accepted');
  }

  const inheritedCalls = [];
  const inheritedStore = new Map();
  const inheritedPrototype = {
    insert: async function(collection, row, options) {
      inheritedCalls.push({ method: 'insert', receiver: this, collection, row, options });
      inheritedStore.set(row._id, Object.assign({}, row));
    },
    get: async function(collection, id, options) {
      inheritedCalls.push({ method: 'get', receiver: this, collection, id, options });
      return inheritedStore.get(id) || null;
    }
  };
  const inheritedPort = Object.create(inheritedPrototype);
  const inheritedContext = createContextWithWixData(inheritedPort);
  assertEqual(await inheritedContext.adapter.appendPhysicalBookingRows([rows[0]]), {
    state: 'CONFIRMED',
    confirmed: [{ rowId: rows[0]._id, disposition: 'inserted' }]
  }, 'stable inherited Wix capabilities are discovered and used');
  assertEqual(inheritedCalls.map(function(call) {
    return { method: call.method, receiver: call.receiver === inheritedPort };
  }), [
    { method: 'insert', receiver: true }, { method: 'get', receiver: true }
  ], 'inherited Wix capabilities retain the original port receiver');

  const structuralCases = [];
  const nullPrototypeRows = [rows[0]];
  Object.setPrototypeOf(nullPrototypeRows, null);
  structuralCases.push(nullPrototypeRows);
  const sparseRows = [];
  sparseRows.length = 1;
  structuralCases.push(sparseRows);
  structuralCases.push([Object.assign(Object.create(null), rows[0])]);
  const symbolicRow = Object.assign({}, rows[0]);
  symbolicRow[Symbol('extra')] = true;
  structuralCases.push([symbolicRow]);
  for (let index = 0; index < structuralCases.length; index += 1) {
    const structural = createContext();
    const result = await structural.adapter.appendPhysicalBookingRows(structuralCases[index]);
    assertEqual({ state: result.state, classification: result.failed?.classification,
      calls: structural.calls.length },
    { state: 'STOPPED', classification: 'INTEGRITY', calls: 0 },
    'only dense ordinary rows with the exact 14-field schema pass preflight case ' + (index + 1));
  }

  let getAccessorRuns = 0;
  const getAccessorPort = {
    insert: async function() { throw new Error('must not dispatch'); }
  };
  Object.defineProperty(getAccessorPort, 'get', {
    get: function() { getAccessorRuns += 1; return async function() { return null; }; }
  });
  const getAccessor = createContextWithWixData(getAccessorPort);
  const getAccessorResult = await getAccessor.adapter.appendPhysicalBookingRows([rows[0]]);
  assertEqual({ state: getAccessorResult.state,
    classification: getAccessorResult.failed?.classification, getAccessorRuns },
  { state: 'STOPPED', classification: 'UNRESOLVED', getAccessorRuns: 0 },
  'an accessor-backed Wix get capability is rejected without invocation');

  let unstablePass = 0;
  const unstableStored = new Proxy(Object.assign({}, rows[0]), {
    ownKeys: function(target) {
      unstablePass += 1;
      const keys = Reflect.ownKeys(target);
      return unstablePass % 2 === 0 ? keys.slice().reverse() : keys;
    }
  });
  const unstableEvidence = createContext();
  unstableEvidence.wixData.get = async function(collection, id, options) {
    unstableEvidence.calls.push({ method: 'get', collection, id, options, receiver: this });
    return unstableStored;
  };
  const unstableResult = await unstableEvidence.adapter.appendPhysicalBookingRows([rows[0]]);
  assertEqual({ state: unstableResult.state,
    classification: unstableResult.failed?.classification },
  { state: 'STOPPED', classification: 'INTEGRITY' },
  'unstable authoritative key evidence fails closed as integrity');

  let metadataGetterRuns = 0;
  const metadataAccessor = createContext();
  metadataAccessor.wixData.get = async function(collection, id, options) {
    metadataAccessor.calls.push({ method: 'get', collection, id, options, receiver: this });
    const stored = metadataAccessor.store.get(id);
    Object.defineProperty(stored, '_owner', {
      enumerable: true, configurable: true,
      get: function() { metadataGetterRuns += 1; return 'owner'; }
    });
    return stored;
  };
  const metadataResult = await metadataAccessor.adapter.appendPhysicalBookingRows([rows[0]]);
  assertEqual({ state: metadataResult.state,
    classification: metadataResult.failed?.classification, metadataGetterRuns },
  { state: 'STOPPED', classification: 'INTEGRITY', metadataGetterRuns: 0 },
  'stored metadata accessors fail closed without invocation');

  const insertionMutation = createContext();
  const callerDateTime = rows[0].checkIn.getTime();
  insertionMutation.wixData.insert = async function(collection, persistedRow, options) {
    insertionMutation.calls.push({ method: 'insert', collection,
      row: persistedRow, options, receiver: this });
    persistedRow.checkIn.setUTCHours(13);
    insertionMutation.store.set(persistedRow._id, persistedRow);
  };
  const insertionMutationResult = await insertionMutation.adapter.appendPhysicalBookingRows([rows[0]]);
  assertEqual({ state: insertionMutationResult.state,
    classification: insertionMutationResult.failed?.classification,
    callerDateTime: rows[0].checkIn.getTime() },
  { state: 'STOPPED', classification: 'INTEGRITY', callerDateTime },
  'insert-side row and Date mutation cannot corrupt expected or caller evidence');

  const hostileRows = rows.map(function(row) {
    return Object.assign({}, row, {
      checkIn: new Date(row.checkIn.getTime()), checkOut: new Date(row.checkOut.getTime())
    });
  });
  const hostile = createContext();
  let hostileInsertCount = 0;
  let capturedReceivers = true;
  const originalGetDescriptors = Object.getOwnPropertyDescriptors;
  const originalOwnKeys = Reflect.ownKeys;
  const originalPromiseResolve = Promise.resolve;
  hostile.wixData.insert = function(collection, persistedRow, options) {
    hostileInsertCount += 1;
    capturedReceivers = capturedReceivers && this === hostile.wixData;
    hostile.calls.push({ method: 'insert', collection, row: persistedRow,
      options, receiver: this });
    if (hostileInsertCount === 1) return {
      then: function(resolve) {
        hostile.store.set(persistedRow._id, persistedRow);
        hostileRows[1].status = 'pending';
        hostileRows[1].checkIn.setUTCHours(1);
        hostile.wixData.insert = function() { throw new Error('replacement insert'); };
        hostile.wixData.get = function() { throw new Error('replacement get'); };
        Object.getOwnPropertyDescriptors = function() { throw new Error('replacement descriptors'); };
        Reflect.ownKeys = function() { throw new Error('replacement ownKeys'); };
        Promise.resolve = function() { throw new Error('replacement resolve'); };
        resolve({ ignored: true });
      }
    };
    hostile.store.set(persistedRow._id, persistedRow);
    return { then: function(resolve) { resolve({ ignored: true }); } };
  };
  let hostileResult;
  try {
    hostileResult = await hostile.adapter.appendPhysicalBookingRows(hostileRows);
  } finally {
    Object.getOwnPropertyDescriptors = originalGetDescriptors;
    Reflect.ownKeys = originalOwnKeys;
    Promise.resolve = originalPromiseResolve;
  }
  assertEqual({ result: hostileResult, capturedReceivers }, {
    result: {
      state: 'CONFIRMED',
      confirmed: rows.map(function(row) { return { rowId: row._id, disposition: 'inserted' }; })
    },
    capturedReceivers: true
  }, 'caller, port, and intrinsic mutation during await cannot redirect append evidence');

  async function verifyInvalidStoredMetadata(field, value, message) {
    const invalidMetadata = createContext();
    invalidMetadata.wixData.get = async function(collection, id, options) {
      invalidMetadata.calls.push({ method: 'get', collection, id, options, receiver: this });
      const stored = invalidMetadata.store.get(id);
      return stored && Object.assign({}, stored, { [field]: value });
    };
    assertEqual(await invalidMetadata.adapter.appendPhysicalBookingRows([rows[0]]), {
      state: 'STOPPED', confirmed: [],
      failed: { index: 0, rowId: rows[0]._id, classification: 'INTEGRITY' }
    }, message);
  }
  await verifyInvalidStoredMetadata('_owner', 1,
    'a non-string authoritative owner metadata value is rejected');
  await verifyInvalidStoredMetadata('_createdDate', 'bad',
    'a non-Date authoritative creation timestamp is rejected');

  const absentReadback = createContext();
  absentReadback.wixData.get = async function(collection, id, options) {
    absentReadback.calls.push({ method: 'get', collection, id, options, receiver: this });
    return null;
  };
  assertEqual(await absentReadback.adapter.appendPhysicalBookingRows([rows[0]]), {
    state: 'STOPPED', confirmed: [],
    failed: { index: 0, rowId: rows[0]._id, classification: 'UNRESOLVED' }
  }, 'a null authoritative read-back after resolved insert remains unresolved');

  const exactSingleRetry = createContext();
  exactSingleRetry.store.set(rows[0]._id, Object.assign({}, rows[0]));
  assertEqual(await exactSingleRetry.adapter.appendPhysicalBookingRows([rows[0]]), {
    state: 'CONFIRMED',
    confirmed: [{ rowId: rows[0]._id, disposition: 'already-present' }]
  }, 'an exact existing single row completes retry reconciliation');

  const exactWholeRetry = createContext();
  rows.forEach(function(row) { exactWholeRetry.store.set(row._id, Object.assign({}, row)); });
  assertEqual(await exactWholeRetry.adapter.appendPhysicalBookingRows(rows), {
    state: 'CONFIRMED',
    confirmed: rows.map(function(row) {
      return { rowId: row._id, disposition: 'already-present' };
    })
  }, 'an exact existing two-row batch is reconciled completely');
  assertEqual(exactWholeRetry.calls.map(function(call) {
    return {
      method: call.method,
      id: call.id || call.row._id,
      receiver: call.receiver === exactWholeRetry.wixData,
      options: call.options
    };
  }), [
    { method: 'insert', id: rows[0]._id, receiver: true,
      options: { suppressAuth: true, suppressHooks: true } },
    { method: 'get', id: rows[0]._id, receiver: true,
      options: { suppressAuth: true, consistentRead: true, suppressHooks: true } },
    { method: 'get', id: rows[1]._id, receiver: true,
      options: { suppressAuth: true, consistentRead: true, suppressHooks: true } }
  ], 'whole-batch retry reconciliation reads the suffix with exact options and receiver');

  const malformedRetrySuffix = createContext();
  malformedRetrySuffix.store.set(rows[0]._id, Object.assign({}, rows[0]));
  const malformedSecondRow = Object.assign({}, rows[1]);
  delete malformedSecondRow.note;
  malformedRetrySuffix.store.set(rows[1]._id, malformedSecondRow);
  assertEqual(await malformedRetrySuffix.adapter.appendPhysicalBookingRows(rows), {
    state: 'STOPPED',
    confirmed: [{ rowId: rows[0]._id, disposition: 'already-present' }],
    failed: { index: 1, rowId: rows[1]._id, classification: 'INTEGRITY' }
  }, 'malformed authoritative retry-suffix evidence is classified as integrity');

  const partialRetry = createContext();
  partialRetry.store.set(rows[0]._id, Object.assign({}, rows[0]));
  assertEqual(await partialRetry.adapter.appendPhysicalBookingRows(rows), {
    state: 'STOPPED',
    confirmed: [{ rowId: rows[0]._id, disposition: 'already-present' }],
    failed: { index: 1, rowId: rows[1]._id, classification: 'UNRESOLVED' }
  }, 'an existing first row forces whole-batch reconciliation instead of appending a missing row');
  assertEqual(partialRetry.calls.filter(function(call) {
    return call.method === 'insert' && call.row._id === rows[1]._id;
  }).length, 0, 'partial retry reconciliation never inserts a missing later row');

  const threeRowPartialRetry = createContext();
  threeRowPartialRetry.store.set(threeRows[0]._id, Object.assign({}, threeRows[0]));
  assertEqual(await threeRowPartialRetry.adapter.appendPhysicalBookingRows(threeRows), {
    state: 'STOPPED',
    confirmed: [{ rowId: threeRows[0]._id, disposition: 'already-present' }],
    failed: { index: 1, rowId: threeRows[1]._id, classification: 'UNRESOLVED' }
  }, 'a 3,4,5 partial prefix never resumes insertion at a missing suffix');
  assertEqual(threeRowPartialRetry.calls.filter(function(call) {
    return call.method === 'insert' && call.row._id !== threeRows[0]._id;
  }).length, 0, 'multirow partial-prefix reconciliation performs no suffix inserts');

  const conflictingRetry = createContext();
  conflictingRetry.store.set(rows[0]._id,
    Object.assign({}, rows[0], { payloadDigest: '2'.repeat(64) }));
  assertEqual(await conflictingRetry.adapter.appendPhysicalBookingRows(rows), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, rowId: rows[0]._id, classification: 'IDEMPOTENCY_CONFLICT' }
  }, 'a deterministic row collision with a different payload digest is an idempotency conflict');

  const foreignOperationCollision = createContext();
  foreignOperationCollision.store.set(rows[0]._id, Object.assign({}, rows[0], {
    operationId: 'foreignoperation01',
    payloadDigest: '2'.repeat(64)
  }));
  assertEqual(await foreignOperationCollision.adapter.appendPhysicalBookingRows([rows[0]]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, rowId: rows[0]._id, classification: 'INTEGRITY' }
  }, 'a deterministic row collision with both foreign operation and digest is integrity');

  const bookingNumberCollision = createContext();
  bookingNumberCollision.store.set(rows[0]._id,
    Object.assign({}, rows[0], { bookingNumber: 'WC-OTHER' }));
  assertEqual(await bookingNumberCollision.adapter.appendPhysicalBookingRows([rows[0]]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, rowId: rows[0]._id, classification: 'IDEMPOTENCY_CONFLICT' }
  }, 'a deterministic row collision with a different booking number is an idempotency conflict');

  async function verifyReadbackMismatch(field, value, classification) {
    const mismatch = createContext();
    mismatch.wixData.get = async function(collection, id, options) {
      mismatch.calls.push({ method: 'get', collection, id, options });
      const stored = mismatch.store.get(id);
      return stored && Object.assign({}, stored, { [field]: value });
    };
    assertEqual(await mismatch.adapter.appendPhysicalBookingRows([rows[0]]), {
      state: 'STOPPED',
      confirmed: [],
      failed: { index: 0, rowId: rows[0]._id, classification }
    }, 'authoritative read-back rejects a mismatched ' + field);
  }

  await verifyReadbackMismatch('bookingNumber', 'WC-READBACK-OTHER',
    'IDEMPOTENCY_CONFLICT');
  await verifyReadbackMismatch('operationId', 'readbackoperation2', 'INTEGRITY');
  await verifyReadbackMismatch('status', 'pending', 'INTEGRITY');
  await verifyReadbackMismatch('checkIn', new Date('2027-11-06T12:00:00.000Z'), 'INTEGRITY');
  await verifyReadbackMismatch('checkOut', new Date('2027-11-08T12:00:00.000Z'), 'INTEGRITY');
  await verifyReadbackMismatch('payloadDigest', '2'.repeat(64), 'IDEMPOTENCY_CONFLICT');

  const readbackException = createContext();
  readbackException.wixData.get = async function(collection, id, options) {
    readbackException.calls.push({ method: 'get', collection, id, options });
    throw new Error('authoritative read unavailable');
  };
  assertEqual(await readbackException.adapter.appendPhysicalBookingRows([rows[0]]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, rowId: rows[0]._id, classification: 'UNRESOLVED' }
  }, 'an authoritative wixData.get exception is unresolved rather than integrity');

  const extraStoredField = createContext();
  extraStoredField.wixData.get = async function(collection, id, options) {
    extraStoredField.calls.push({ method: 'get', collection, id, options });
    const stored = extraStoredField.store.get(id);
    return stored && Object.assign({}, stored, { _rogueSystemField: true });
  };
  assertEqual(await extraStoredField.adapter.appendPhysicalBookingRows([rows[0]]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, rowId: rows[0]._id, classification: 'INTEGRITY' }
  }, 'authoritative read-back rejects unrecognized underscore-prefixed stored fields');

  // Permanent causal checks for the final normal-append mutation survivors.
  const callablePortStore = new Map();
  const callablePort = async function() {};
  callablePort.insert = async function(collection, row) {
    callablePortStore.set(row._id, Object.assign({}, row));
  };
  callablePort.get = async function(collection, id) { return callablePortStore.get(id) || null; };
  assertEqual((await createContextWithWixData(callablePort).adapter
    .appendPhysicalBookingRows([rows[0]])).state, 'CONFIRMED',
  '[equality-L140-4] a callable Wix port remains a valid capability owner');

  const invalidFirstMapping = createContext();
  const invalidFirstMappingRows = [
    Object.assign({}, rows[0], { assignedRoom: 2 }),
    Object.assign({}, rows[1], { assignedRoom: 3 })
  ];
  assertEqual(await invalidFirstMapping.adapter.appendPhysicalBookingRows(invalidFirstMappingRows), {
    state: 'STOPPED', confirmed: [],
    failed: { index: 0, rowId: invalidFirstMappingRows[0]._id, classification: 'INTEGRITY' }
  }, '[logic-L307-9] an adventure-suite row mapped to unit 2 fails at that row');

  let unstableCapabilityRead = 0;
  const unstableCapabilityStore = new Map();
  const unstableCapabilityOne = async function(collection, row) {
    unstableCapabilityStore.set(row._id, Object.assign({}, row));
  };
  const unstableCapabilityTwo = async function(collection, row) {
    unstableCapabilityStore.set(row._id, Object.assign({}, row));
  };
  const unstableCapabilityPort = new Proxy({
    insert: unstableCapabilityOne,
    get: async function(collection, id) { return unstableCapabilityStore.get(id) || null; }
  }, {
    getOwnPropertyDescriptor: function(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (key === 'insert') {
        const firstObservation = unstableCapabilityRead++ % 2 === 0;
        descriptor.value = firstObservation ? unstableCapabilityOne : unstableCapabilityTwo;
        descriptor.enumerable = firstObservation;
      }
      return descriptor;
    }
  });
  assertEqual((await createContextWithWixData(unstableCapabilityPort).adapter
    .appendPhysicalBookingRows([rows[0]])).failed?.classification, 'UNRESOLVED',
  '[capability-stability-target-7-0] a second capability descriptor observation is mandatory');

  let changingFunctionRead = 0;
  const changingFunctionStore = new Map();
  const changingFunctionOne = async function(collection, row) {
    changingFunctionStore.set(row._id, Object.assign({}, row));
  };
  const changingFunctionTwo = async function(collection, row) {
    changingFunctionStore.set(row._id, Object.assign({}, row));
  };
  const changingFunctionPort = new Proxy({
    insert: changingFunctionOne,
    get: async function(collection, id) { return changingFunctionStore.get(id) || null; }
  }, {
    getOwnPropertyDescriptor: function(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (key === 'insert') descriptor.value = changingFunctionRead++ % 2 === 0
        ? changingFunctionOne : changingFunctionTwo;
      return descriptor;
    }
  });
  assertEqual((await createContextWithWixData(changingFunctionPort).adapter
    .appendPhysicalBookingRows([rows[0]])).failed?.classification, 'UNRESOLVED',
  '[logic-L164-4] a capability function value must be stable across descriptor snapshots');

  const callableStored = async function() {};
  delete callableStored.name;
  delete callableStored.length;
  Object.setPrototypeOf(callableStored, Object.prototype);
  Object.assign(callableStored, rows[0]);
  const callableStoredContext = createContext();
  callableStoredContext.wixData.insert = async function() { throw new Error('duplicate'); };
  callableStoredContext.wixData.get = async function() { return callableStored; };
  assertEqual((await callableStoredContext.adapter.appendPhysicalBookingRows([rows[0]]))
    .failed?.classification, 'INTEGRITY',
  '[logic-L332-37] callable authoritative values are rejected even with an ordinary prototype');

  const nonStringStoredId = createContext();
  nonStringStoredId.wixData.insert = async function() { throw new Error('duplicate'); };
  nonStringStoredId.wixData.get = async function() {
    return Object.assign({}, rows[0], { _id: 7, bookingNumber: 'WC-OTHER' });
  };
  assertEqual((await nonStringStoredId.adapter.appendPhysicalBookingRows([rows[0]]))
    .failed?.classification, 'INTEGRITY',
  '[logic-L370-42] a non-string stored id is integrity evidence before conflict classification');

  const fractionalStoredFee = createContext();
  fractionalStoredFee.wixData.insert = async function() { throw new Error('duplicate'); };
  fractionalStoredFee.wixData.get = async function() {
    return Object.assign({}, rows[0], { roomFee: 175.5, bookingNumber: 'WC-OTHER' });
  };
  assertEqual((await fractionalStoredFee.adapter.appendPhysicalBookingRows([rows[0]]))
    .failed?.classification, 'INTEGRITY',
  '[logic-L376-46] a fractional stored room fee is integrity evidence before conflict classification');

  const highestHighSurrogate = createContext();
  assertEqual((await highestHighSurrogate.adapter.appendPhysicalBookingRows([
    Object.assign({}, rows[0], { bookingNumber: '\uDBFF' })
  ])).failed?.classification, 'INTEGRITY',
  '[boundary-L183-0] a lone U+DBFF high surrogate is rejected');

  const depthEightStore = new Map();
  let depthEightPort = {
    insert: async function(collection, row) { depthEightStore.set(row._id, Object.assign({}, row)); },
    get: async function(collection, id) { return depthEightStore.get(id) || null; }
  };
  for (let depth = 0; depth < 8; depth += 1) depthEightPort = Object.create(depthEightPort);
  assertEqual((await createContextWithWixData(depthEightPort).adapter
    .appendPhysicalBookingRows([rows[0]])).failed?.classification, 'UNRESOLVED',
  '[boundary-L143-1] capabilities beyond seven inherited holders are not discovered');

  const storedCheckoutString = createContext();
  storedCheckoutString.wixData.insert = async function() { throw new Error('duplicate'); };
  storedCheckoutString.wixData.get = async function() {
    return Object.assign({}, rows[0], { checkOut: rows[0].checkOut.toISOString() });
  };
  assertEqual((await storedCheckoutString.adapter.appendPhysicalBookingRows([rows[0]]))
    .failed?.classification, 'INTEGRITY',
  '[boolean-L368-C49] an authoritative checkout string is not accepted as a stored Date');

  let outboundIdConfigurable;
  const configurableInsert = createContext();
  configurableInsert.wixData.insert = async function(collection, row) {
    outboundIdConfigurable = Object.getOwnPropertyDescriptor(row, '_id').configurable;
    configurableInsert.store.set(row._id, Object.assign({}, row));
  };
  await configurableInsert.adapter.appendPhysicalBookingRows([rows[0]]);
  assertEqual(outboundIdConfigurable, true,
    '[boolean-L438-C54] the outbound deterministic id remains configurable for the insert port');

  let expectedCheckoutSnapshot = 0;
  const changingExpectedCheckoutTarget = Object.assign({}, rows[0]);
  const changingExpectedCheckout = new Proxy(changingExpectedCheckoutTarget, {
    getOwnPropertyDescriptor: function(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (key === 'checkOut') descriptor.value = new Date(expectedCheckoutSnapshot++ % 2 === 0
        ? '2027-11-07T12:00:00.000Z' : '2027-11-08T12:00:00.000Z');
      return descriptor;
    }
  });
  assertEqual((await createContext().adapter.appendPhysicalBookingRows([changingExpectedCheckout]))
    .failed?.classification, 'INTEGRITY',
  '[boolean-L281-C71] unequal expected checkout snapshots cannot return stable');

  let expectedWritableRead = 0;
  const unstableExpectedWritable = new Proxy(Object.assign({}, rows[0]), {
    getOwnPropertyDescriptor: function(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (key === 'guests') descriptor.writable = expectedWritableRead++ % 2 === 0;
      return descriptor;
    }
  });
  assertEqual((await createContext().adapter.appendPhysicalBookingRows([unstableExpectedWritable]))
    .failed?.classification, 'INTEGRITY',
  '[input-snapshot-stability-target-12-0] changing input writability is rejected as unstable evidence');

  const freshStoredDate = createContext();
  const freshStoredDateTarget = Object.assign({}, rows[0]);
  const freshStoredDateProxy = new Proxy(freshStoredDateTarget, {
    getOwnPropertyDescriptor: function(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (key === 'checkIn') descriptor.value = new Date(descriptor.value.getTime());
      return descriptor;
    }
  });
  freshStoredDate.wixData.insert = async function() { throw new Error('duplicate'); };
  freshStoredDate.wixData.get = async function() { return freshStoredDateProxy; };
  assertEqual((await freshStoredDate.adapter.appendPhysicalBookingRows([rows[0]])).state, 'CONFIRMED',
    '[equality-L359-31] fresh equal-time stored Dates remain stable canonical evidence');

  const primitiveStore = new Map();
  Object.defineProperties(String.prototype, {
    insert: { configurable: true, value: async function(collection, row) {
      primitiveStore.set(row._id, Object.assign({}, row));
    } },
    get: { configurable: true, value: async function(collection, id) {
      return primitiveStore.get(id) || null;
    } }
  });
  let primitivePortResult;
  try {
    primitivePortResult = await createContextWithWixData('primitive-port').adapter
      .appendPhysicalBookingRows([rows[0]]);
  } finally {
    delete String.prototype.insert;
    delete String.prototype.get;
  }
  assertEqual(primitivePortResult.failed?.classification, 'UNRESOLVED',
    '[logic-L140-1] a truthy primitive Wix port cannot supply inherited capabilities');

  let changingEnumerableRead = 0;
  const changingEnumerableStore = new Map();
  const changingEnumerablePort = new Proxy({
    insert: async function(collection, row) {
      changingEnumerableStore.set(row._id, Object.assign({}, row));
    },
    get: async function(collection, id) { return changingEnumerableStore.get(id) || null; }
  }, {
    getOwnPropertyDescriptor: function(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (key === 'insert') descriptor.enumerable = changingEnumerableRead++ % 2 === 0;
      return descriptor;
    }
  });
  assertEqual((await createContextWithWixData(changingEnumerablePort).adapter
    .appendPhysicalBookingRows([rows[0]])).failed?.classification, 'UNRESOLVED',
  '[logic-L165-5] changing capability enumerability is rejected as unstable evidence');

  const numericStoredBooking = createContext();
  numericStoredBooking.wixData.insert = async function() { throw new Error('duplicate'); };
  numericStoredBooking.wixData.get = async function() {
    return Object.assign({}, rows[0], { bookingNumber: 7 });
  };
  assertEqual((await numericStoredBooking.adapter.appendPhysicalBookingRows([rows[0]]))
    .failed?.classification, 'INTEGRITY',
  '[logic-L372-43] a numeric stored booking number is rejected before mismatch classification');

  assertEqual((await createContext().adapter.appendPhysicalBookingRows([
    Object.assign({}, rows[0], { note: '\uDFFF' })
  ])).failed?.classification, 'INTEGRITY',
  '[boundary-L188-1] a lone U+DFFF low surrogate is rejected');

  assertEqual((await createContext().adapter.appendPhysicalBookingRows([
    Object.assign({}, rows[0], { bookingNumber: '\uD800\uDC00' })
  ])).state, 'CONFIRMED',
  '[boundary-L186-3] a surrogate pair beginning with U+DC00 is accepted');

  const strictEsmStore = new Map();
  const strictEsmAdapter = await createStrictEsmAdapter({
    insert: async function(collection, row) { strictEsmStore.set(row._id, Object.assign({}, row)); },
    get: async function(collection, id) { return strictEsmStore.get(id) || null; }
  });
  assertEqual((await strictEsmAdapter.appendPhysicalBookingRows([rows[0]])).state, 'CONFIRMED',
    '[boolean-L245-C72] strict ESM snapshot fields stay configurable until Date deletion');

  let unstableBatchOwnKeys = 0;
  const unstableBatchTarget = [Object.assign({}, rows[0])];
  const unstableBatch = new Proxy(unstableBatchTarget, {
    ownKeys: function(target) {
      unstableBatchOwnKeys += 1;
      const keys = Reflect.ownKeys(target);
      return unstableBatchOwnKeys === 2 ? keys.concat('extra') : keys;
    },
    getOwnPropertyDescriptor: function(target, key) {
      if (key === 'extra') return { value: true, enumerable: true, writable: true, configurable: true };
      return Object.getOwnPropertyDescriptor(target, key);
    }
  });
  assertEqual((await createContext().adapter.appendPhysicalBookingRows(unstableBatch))
    .failed?.classification, 'INTEGRITY',
  '[boolean-L270-C84] an invalid second batch snapshot cannot be declared equal');

  const missingInsertPort = createContextWithWixData({
    get: async function() { return Object.assign({}, rows[0]); }
  });
  assertEqual((await missingInsertPort.adapter.appendPhysicalBookingRows([rows[0]]))
    .failed?.classification, 'UNRESOLVED',
  '[logic-L456-50] both insert and get capabilities are required before reconciliation');

  const nonCallableInsert = createContextWithWixData({
    insert: 7,
    get: async function() { return Object.assign({}, rows[0]); }
  });
  assertEqual((await nonCallableInsert.adapter.appendPhysicalBookingRows([rows[0]]))
    .failed?.classification, 'UNRESOLVED',
  '[logic-L174-1] a non-callable insert data property is not a Wix capability');

  assertEqual((await createContext().adapter.appendPhysicalBookingRows([
    Object.assign({}, rows[0], { note: '\uD800A\uDC00' })
  ])).failed?.classification, 'INTEGRITY',
  '[boolean-L186-C49] malformed surrogate evidence cannot return success early');

  assertEqual((await createContext().adapter.appendPhysicalBookingRows([
    Object.assign({}, rows[0], { bookingNumber: '\uD800A' })
  ])).failed?.classification, 'INTEGRITY',
  '[logic-L186-7] a high surrogate followed by a non-low-surrogate is rejected');

  const numericStoredDigest = createContext();
  numericStoredDigest.wixData.insert = async function() { throw new Error('duplicate'); };
  numericStoredDigest.wixData.get = async function() {
    return Object.assign({}, rows[0], { payloadDigest: 7 });
  };
  assertEqual((await numericStoredDigest.adapter.appendPhysicalBookingRows([rows[0]]))
    .failed?.classification, 'INTEGRITY',
  '[logic-L373-44] a numeric stored payload digest is rejected before mismatch classification');

  assertEqual((await createContext().adapter.appendPhysicalBookingRows([
    Object.assign({}, rows[0], { bookingNumber: '\uD800\uDFFF' })
  ])).state, 'CONFIRMED',
  '[boundary-L186-0] a surrogate pair ending with U+DFFF is accepted');

  let optionalOwnerSnapshot = 0;
  const optionalOwnerTarget = Object.assign({ _owner: 'owner' }, rows[0]);
  const optionalOwnerProxy = new Proxy(optionalOwnerTarget, {
    ownKeys: function(target) {
      optionalOwnerSnapshot += 1;
      const keys = Reflect.ownKeys(target);
      return optionalOwnerSnapshot % 2 === 1 ? keys.filter(function(key) { return key !== '_owner'; }) : keys;
    }
  });
  const optionalOwnerContext = createContext();
  optionalOwnerContext.wixData.insert = async function() { throw new Error('duplicate'); };
  optionalOwnerContext.wixData.get = async function() { return optionalOwnerProxy; };
  assertEqual((await optionalOwnerContext.adapter.appendPhysicalBookingRows([rows[0]]))
    .failed?.classification, 'INTEGRITY',
  '[boolean-L123-C43] unequal authoritative evidence lengths are not the same keys');

  assertEqual((await createContext().adapter.appendPhysicalBookingRows([
    Object.assign({}, rows[0], { roomFee: 0 })
  ])).state, 'CONFIRMED',
  '[boundary-L304-10] a zero room fee is valid');

  const allMetadataStored = createContext();
  allMetadataStored.wixData.insert = async function() { throw new Error('duplicate'); };
  allMetadataStored.wixData.get = async function() {
    return Object.assign({}, rows[0], {
      _owner: 'owner', _createdDate: new Date('2027-01-01T00:00:00.000Z'),
      _updatedDate: new Date('2027-01-02T00:00:00.000Z')
    });
  };
  assertEqual((await allMetadataStored.adapter.appendPhysicalBookingRows([rows[0]])).state, 'CONFIRMED',
    '[boundary-L336-5] all three permitted stored metadata fields fit the schema bound');

  const storedCheckinString = createContext();
  storedCheckinString.wixData.insert = async function() { throw new Error('duplicate'); };
  storedCheckinString.wixData.get = async function() {
    return Object.assign({}, rows[0], { checkIn: rows[0].checkIn.toISOString() });
  };
  assertEqual((await storedCheckinString.adapter.appendPhysicalBookingRows([rows[0]]))
    .failed?.classification, 'INTEGRITY',
  '[boolean-L367-C47] an authoritative checkin string is not accepted as a stored Date');

  const writableOutboundId = createContext();
  writableOutboundId.wixData.insert = async function(collection, row) {
    row._id = 'changed';
    writableOutboundId.store.set(row._id, Object.assign({}, row));
  };
  assertEqual((await writableOutboundId.adapter.appendPhysicalBookingRows([rows[0]]))
    .failed?.classification, 'UNRESOLVED',
  '[boolean-L438-C34] insert ports can mutate the writable outbound deterministic id');

  let retryGetCount = 0;
  const retryReadException = createContext();
  retryReadException.wixData.insert = async function() { throw new Error('duplicate'); };
  retryReadException.wixData.get = async function() {
    retryGetCount += 1;
    if (retryGetCount === 2) throw new Error('retry read unavailable');
    return Object.assign({}, rows[0]);
  };
  assertEqual(await retryReadException.adapter.appendPhysicalBookingRows(rows), {
    state: 'STOPPED',
    confirmed: [{ rowId: rows[0]._id, disposition: 'already-present' }],
    failed: { index: 1, rowId: rows[1]._id, classification: 'UNRESOLVED' }
  }, '[retry-failure-index-target-30-0] a retry read exception identifies its suffix row');

  assertEqual({
    dropsCallerDates: /copy\.checkOutIso = checkOut\.iso;\s*delete copy\.checkIn;\s*delete copy\.checkOut;/.test(source),
    freezesRows: /push\(output, freezeObject\(copy\)\);/.test(source),
    freezesBatch: /return freezeObject\(output\);/.test(source)
  }, {
    dropsCallerDates: true,
    freezesRows: true,
    freezesBatch: true
  }, 'the pre-await expected-row snapshot drops caller Dates and freezes every detached container');

  // Loader hardening slice 2: canonical stored rows and detached output.
  const loaderRows = rows.map(function(row) {
    return Object.assign({}, row, { roomFee: 0,
      checkIn: new Date(row.checkIn.getTime()), checkOut: new Date(row.checkOut.getTime()) });
  });
  const storedFirst = Object.assign({
    _owner: 'owner', _createdDate: new Date('2027-01-01T00:00:00.000Z'),
    _updatedDate: new Date('2027-01-02T00:00:00.000Z')
  }, loaderRows[0], {
    checkIn: new Date(loaderRows[0].checkIn.getTime()),
    checkOut: new Date(loaderRows[0].checkOut.getTime())
  });
  const secondPage = {
    items: [storedFirst],
    hasNext: function() { return false; }
  };
  const firstPage = {
    items: [loaderRows[1]],
    hasNext: function() { return true; },
    next: async function() { return secondPage; }
  };
  const loader = createContext(firstPage);
  const loadedRows = await loader.adapter.loadOperationBookingRows(operationId);
  assertEqual(loadedRows, loaderRows,
    'operation booking-row loading pages completely and returns deterministic row order');
  assertEqual(loader.calls, [
    { method: 'query', collection: 'Bookings' },
    { method: 'eq', field: 'operationId', value: operationId },
    { method: 'limit', value: 1000 },
    { method: 'find', options: { suppressAuth: true, consistentRead: true, suppressHooks: true } }
  ], 'operation row loading uses the exact indexed filter, page size, and read options');
  assertEqual({
    arrayPrototype: Object.getPrototypeOf(loadedRows) === loader.arrayPrototype,
    rowPrototype: loadedRows.every(function(row) { return Object.getPrototypeOf(row) === Object.prototype; }),
    exactKeys: loadedRows.every(function(row) {
      return Reflect.ownKeys(row).join(',') === [
        '_id', 'roomCode', 'assignedRoom', 'quantity', 'checkIn', 'checkOut',
        'bookingNumber', 'operationId', 'payloadDigest', 'status', 'autoOwnerBlock',
        'guests', 'roomFee', 'note'
      ].join(',');
    }),
    detachedRows: loadedRows[0] !== storedFirst && loadedRows[1] !== loaderRows[1],
    detachedDates: loadedRows[0].checkIn !== storedFirst.checkIn &&
      loadedRows[0].checkOut !== storedFirst.checkOut,
    metadataStripped: !Object.prototype.hasOwnProperty.call(loadedRows[0], '_owner')
  }, {
    arrayPrototype: true, rowPrototype: true, exactKeys: true,
    detachedRows: true, detachedDates: true, metadataStripped: true
  }, 'loader returns exact ordinary detached rows and strips validated Wix metadata');
  const loadedIndexDescriptor = Object.getOwnPropertyDescriptor(loadedRows, '0');
  assertEqual({ enumerable: loadedIndexDescriptor.enumerable, writable: loadedIndexDescriptor.writable },
    { enumerable: true, writable: true },
    'loader output array indices preserve ordinary enumerable writable descriptors');
  const originalLoadedTime = loadedRows[0].checkIn.getTime();
  storedFirst.checkIn.setUTCHours(1);
  firstPage.items.push(Object.assign({}, loaderRows[0]));
  assertEqual({ length: loadedRows.length, time: loadedRows[0].checkIn.getTime() },
    { length: 2, time: originalLoadedTime },
    'post-return Wix row, Date, and page mutation cannot alter loaded output');

  const duplicatePage = {
    items: [loaderRows[0], Object.assign({}, loaderRows[0])],
    hasNext: function() { return false; }
  };
  const duplicateLoader = createContext(duplicatePage);
  await assertRejects(
    function() { return duplicateLoader.adapter.loadOperationBookingRows(operationId); },
    'Invalid booking row page',
    'duplicate deterministic row IDs in query results fail closed'
  );

  const foreignPage = {
    items: [Object.assign({}, loaderRows[0], { operationId: 'differentoperation1' })],
    hasNext: function() { return false; }
  };
  const foreignLoader = createContext(foreignPage);
  await assertRejects(
    function() { return foreignLoader.adapter.loadOperationBookingRows(operationId); },
    'Invalid booking row page',
    'query results containing a foreign operation fail closed'
  );

  const malformedLoaderRows = [
    Object.assign({}, loaderRows[0], { _id: 'pb1-' + operationId + '-r2' }),
    Object.assign({}, loaderRows[0], { _id: 'pb1-' + operationId + '-r99' }),
    Object.assign({}, loaderRows[0], { status: 'pending' }),
    Object.assign({}, loaderRows[0], { quantity: 2 }),
    Object.assign({}, loaderRows[0], { autoOwnerBlock: true }),
    Object.assign({}, loaderRows[0], { guests: 3 }),
    Object.assign({}, loaderRows[0], { roomFee: -1 }),
    Object.assign({}, loaderRows[0], { roomFee: -0 }),
    Object.assign({}, loaderRows[0], { checkIn: new Date('2027-11-05T00:00:00.000Z') }),
    Object.assign({}, loaderRows[0], { checkOut: new Date('2027-11-05T12:00:00.000Z') }),
    Object.assign({}, loaderRows[0], { payloadDigest: 'A'.repeat(64) }),
    Object.assign({}, loaderRows[0], { bookingNumber: ' WC-3001' }),
    Object.assign({}, loaderRows[0], { note: '\uD800' }),
    Object.assign({}, loaderRows[0], { rogue: true }),
    Object.assign({}, loaderRows[0], { _rogue: true }),
    Object.assign({}, loaderRows[0], { _owner: 7 }),
    Object.assign({}, loaderRows[0], { _createdDate: 'bad' })
  ];
  const symbolicLoaderRow = Object.assign({}, loaderRows[0]);
  symbolicLoaderRow[Symbol('rogue')] = true;
  malformedLoaderRows.push(symbolicLoaderRow);
  for (let index = 0; index < malformedLoaderRows.length; index += 1) {
    const malformedLoader = createContext({
      items: [malformedLoaderRows[index]], hasNext: function() { return false; }
    });
    await assertRejects(
      function() { return malformedLoader.adapter.loadOperationBookingRows(operationId); },
      'Invalid booking row page',
      'malformed stored-row evidence fails closed case ' + (index + 1)
    );
  }

  const equalDateRow = Object.assign({}, loaderRows[0], {
    checkOut: new Date(loaderRows[0].checkIn.getTime())
  });
  const reversedDateRow = Object.assign({}, loaderRows[0], {
    checkOut: new Date(loaderRows[0].checkIn.getTime() - (24 * 60 * 60 * 1000))
  });
  await assertRejects(
    function() { return createContext({ items: [reversedDateRow], hasNext: function() { return false; } })
      .adapter.loadOperationBookingRows(operationId); },
    'Invalid booking row page',
    'checkout before check-in is rejected'
  );
  await assertRejects(
    function() { return createContext({ items: [equalDateRow], hasNext: function() { return false; } })
      .adapter.loadOperationBookingRows(operationId); },
    'Invalid booking row page',
    'checkout equal to check-in is rejected'
  );
  const exactlyEightHundredRow = Object.assign({}, loaderRows[0], {
    checkIn: new Date('2027-01-01T12:00:00.000Z'),
    checkOut: new Date('2029-03-11T12:00:00.000Z')
  });
  assertEqual(await createContext({
    items: [exactlyEightHundredRow], hasNext: function() { return false; }
  }).adapter.loadOperationBookingRows(operationId), [exactlyEightHundredRow],
  'an exactly 800-night canonical stay remains readable');
  const eightHundredOneRow = Object.assign({}, exactlyEightHundredRow, {
    checkOut: new Date('2029-03-12T12:00:00.000Z')
  });
  await assertRejects(
    function() { return createContext({ items: [eightHundredOneRow], hasNext: function() { return false; } })
      .adapter.loadOperationBookingRows(operationId); },
    'Invalid booking row page',
    'an 801-night stay fails closed'
  );

  for (const validTopology of [
    { code: 'penthouse_apartment', units: [1], guests: 2, fee: 175 },
    { code: 'two_bedroom_apartment', units: [2], guests: 3, fee: 0 },
    { code: 'two_bedroom_apartment', units: [2], guests: 4, fee: 0 },
    { code: 'adventure_suite', units: [3], guests: 2, fee: 0 },
    { code: 'adventure_suite', units: [4], guests: 2, fee: 0 },
    { code: 'adventure_suite', units: [3, 4], guests: 2, fee: 0 },
    { code: 'adventure_suite', units: [3, 4, 5], guests: 2, fee: 0 }
  ]) {
    const topologyRows = validTopology.units.map(function(unit, index) {
      return Object.assign({}, loaderRows[0], {
        _id: 'pb1-' + operationId + '-r' + (index + 1),
        roomCode: validTopology.code, assignedRoom: unit,
        guests: validTopology.guests, roomFee: validTopology.fee
      });
    });
    const topologyLoader = createContext({
      items: topologyRows.slice().reverse(), hasNext: function() { return false; }
    });
    assertEqual(await topologyLoader.adapter.loadOperationBookingRows(operationId), topologyRows,
      'loader accepts and deterministically places canonical topology ' +
        validTopology.code + ':' + validTopology.units.join(','));
  }

  const emptyLoader = createContext({ items: [], hasNext: function() { return false; } });
  assertEqual(await emptyLoader.adapter.loadOperationBookingRows(operationId), [],
    'a valid empty authoritative query returns an empty detached array');

  // Loader hardening slice 1: reject hostile inputs/capabilities before dispatch.
  let invalidInputIo = 0;
  const invalidInputPort = { query: function() { invalidInputIo += 1; } };
  const invalidInputLoader = createContextWithWixData(invalidInputPort);
  for (const invalidId of [
    'x'.repeat(15), 'x'.repeat(65), new String(operationId),
    { toString: function() { throw new Error('must not coerce'); } }, null
  ]) {
    await assertRejects(
      function() { return invalidInputLoader.adapter.loadOperationBookingRows(invalidId); },
      'Invalid operation ID',
      'invalid primitive operation-id evidence is rejected before Wix I/O'
    );
  }
  assertEqual(invalidInputIo, 0, 'invalid operation IDs perform zero Wix I/O');
  let queryGetterRuns = 0;
  const queryAccessorPort = {};
  Object.defineProperty(queryAccessorPort, 'query', {
    get: function() { queryGetterRuns += 1; throw new Error('accessor executed'); }
  });
  const queryAccessorLoader = createContextWithWixData(queryAccessorPort);
  await assertRejects(
    function() { return queryAccessorLoader.adapter.loadOperationBookingRows(operationId); },
    'Invalid booking row page',
    'an accessor-backed Wix query capability fails closed with normalized evidence'
  );
  assertEqual(queryGetterRuns, 0, 'an accessor-backed Wix query capability is never invoked');

  // Loader hardening slice 3: hostile pagination, mutation, and capability drift.
  async function rejectPage(page, message) {
    const candidate = createContext(page);
    await assertRejects(
      function() { return candidate.adapter.loadOperationBookingRows(operationId); },
      'Invalid booking row page', message
    );
  }
  for (const malformedPage of [
    null,
    { items: [loaderRows[0]], hasNext: function() { return 1; } },
    { items: [loaderRows[0]], hasNext: function() { return 0; } },
    { items: [loaderRows[0]], hasNext: function() { return null; } },
    { items: [loaderRows[0]], hasNext: function() { return true; } },
    { items: [loaderRows[0]], hasNext: function() { return true; }, next: async function() { return null; } }
  ]) await rejectPage(malformedPage, 'malformed or incomplete pagination evidence fails closed');

  const rowFourOnly = Object.assign({}, loaderRows[0], {
    _id: 'pb1-' + operationId + '-r4'
  });
  await rejectPage({ items: [rowFourOnly], hasNext: function() { return false; } },
    'a fourth deterministic row cannot be silently discarded as an empty operation');

  let oversizedFourthInspections = 0;
  const oversizedFourth = new Proxy(Object.assign({}, loaderRows[0], {
    _id: 'pb1-' + operationId + '-r4'
  }), {
    ownKeys: function(target) {
      oversizedFourthInspections += 1;
      return Reflect.ownKeys(target);
    }
  });
  await rejectPage({
    items: [loaderRows[0], loaderRows[1], Object.assign({}, loaderRows[0], {
      _id: 'pb1-' + operationId + '-r3', assignedRoom: 5, note: ''
    }), oversizedFourth],
    hasNext: function() { return false; }
  }, 'a page containing more than three candidates fails at the item-count boundary');
  assertEqual(oversizedFourthInspections, 0,
    'the oversized page guard rejects before inspecting the fourth candidate row');

  const callablePage = function() {};
  callablePage.items = [];
  callablePage.hasNext = function() { return false; };
  await rejectPage(callablePage, 'a callable query page is not accepted as an ordinary page object');

  const cyclicPage = { items: [], hasNext: function() { return true; } };
  cyclicPage.next = async function() { return cyclicPage; };
  await rejectPage(cyclicPage, 'repeated page identity is rejected');

  let endlessNextCalls = 0;
  function freshEndlessPage() {
    return {
      items: [],
      hasNext: function() { return true; },
      next: async function() {
        endlessNextCalls += 1;
        if (endlessNextCalls > 6) throw new Error('unbounded pagination');
        return freshEndlessPage();
      }
    };
  }
  await rejectPage(freshEndlessPage(), 'distinct endless pages hit the deterministic page bound');
  assertEqual(endlessNextCalls, 3,
    'the four-page ceiling stops hostile pagination before requesting page five');

  let itemGetterRuns = 0;
  const accessorItems = { hasNext: function() { return false; } };
  Object.defineProperty(accessorItems, 'items', {
    get: function() { itemGetterRuns += 1; return []; }
  });
  await rejectPage(accessorItems, 'accessor-backed page items fail closed');
  assertEqual(itemGetterRuns, 0, 'an accessor-backed items property is never invoked');

  let elementGetterRuns = 0;
  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true, configurable: true,
    get: function() { elementGetterRuns += 1; return loaderRows[0]; }
  });
  accessorArray.length = 1;
  await rejectPage({ items: accessorArray, hasNext: function() { return false; } },
    'accessor-backed array elements fail closed');
  assertEqual(elementGetterRuns, 0, 'an accessor-backed page item is never invoked');

  const sparsePageItems = [];
  sparsePageItems.length = 1;
  await rejectPage({ items: sparsePageItems, hasNext: function() { return false; } },
    'sparse page-item arrays fail closed');
  const extraPageItems = [loaderRows[0]];
  extraPageItems.extra = true;
  await rejectPage({ items: extraPageItems, hasNext: function() { return false; } },
    'page-item arrays with extra own keys fail closed');

  const mutatingSource = Object.assign({}, loaderRows[0], {
    checkIn: new Date(loaderRows[0].checkIn.getTime())
  });
  const mutatingPage = {
    items: [mutatingSource],
    hasNext: function() {
      mutatingSource.status = 'pending';
      mutatingSource.checkIn.setUTCHours(1);
      return false;
    }
  };
  const mutationLoader = createContext(mutatingPage);
  assertEqual(await mutationLoader.adapter.loadOperationBookingRows(operationId), [loaderRows[0]],
    'every row and Date is snapshotted before hasNext can mutate source evidence');

  const nextMutationFirst = Object.assign({}, loaderRows[0]);
  const nextMutationSecond = Object.assign({}, loaderRows[1]);
  const nextMutationPage2 = { items: [nextMutationSecond], hasNext: function() { return false; } };
  const nextMutationPage1 = {
    items: [nextMutationFirst], hasNext: function() { return true; },
    next: function() {
      nextMutationFirst.status = 'pending';
      nextMutationSecond.status = 'pending';
      return { then: function(resolve) {
        nextMutationSecond.status = 'confirmed';
        resolve(nextMutationPage2);
      } };
    }
  };
  const nextMutationLoader = createContext(nextMutationPage1);
  assertEqual(await nextMutationLoader.adapter.loadOperationBookingRows(operationId), loaderRows,
    'next cannot mutate already-observed rows and later pages are snapshotted after resolution');

  let inheritedPageReceiver = false;
  const inheritedPagePrototype = {
    hasNext: function() { inheritedPageReceiver = this === inheritedPage; return false; }
  };
  const inheritedPage = Object.create(inheritedPagePrototype);
  inheritedPage.items = [];
  const inheritedPageLoader = createContext(inheritedPage);
  assertEqual(await inheritedPageLoader.adapter.loadOperationBookingRows(operationId), [],
    'stable inherited page capabilities and page data are accepted');
  assertEqual(inheritedPageReceiver, true, 'inherited page methods retain the page receiver');

  const builderCalls = [];
  function inheritedBuilder(method, nextOwner) {
    const prototype = {};
    prototype[method] = function() {
      builderCalls.push({ method: method, receiver: this, args: Array.from(arguments) });
      return nextOwner;
    };
    return Object.create(prototype);
  }
  const terminalInheritedPage = inheritedBuilder('find', null);
  terminalInheritedPage.find = async function(options) {
    builderCalls.push({ method: 'find', receiver: this, args: [options] });
    return { items: [], hasNext: function() { return false; } };
  };
  const limitOwner = inheritedBuilder('limit', terminalInheritedPage);
  const eqOwner = inheritedBuilder('eq', limitOwner);
  const inheritedQueryPort = inheritedBuilder('query', eqOwner);
  const inheritedQueryLoader = createContextWithWixData(inheritedQueryPort);
  assertEqual(await inheritedQueryLoader.adapter.loadOperationBookingRows(operationId), [],
    'stable inherited query and distinct builder capabilities are accepted');
  assertEqual(builderCalls.map(function(entry) {
    return { method: entry.method,
      receiver: entry.receiver === (entry.method === 'query' ? inheritedQueryPort :
        entry.method === 'eq' ? eqOwner : entry.method === 'limit' ? limitOwner : terminalInheritedPage) };
  }), [
    { method: 'query', receiver: true }, { method: 'eq', receiver: true },
    { method: 'limit', receiver: true }, { method: 'find', receiver: true }
  ], 'every inherited query builder function receives the queried object rather than its holder');
  const inheritedFindOptions = builderCalls[3].args[0];
  assertEqual({
    keys: Reflect.ownKeys(inheritedFindOptions),
    frozen: Object.isFrozen(inheritedFindOptions),
    ordinary: Object.getPrototypeOf(inheritedFindOptions) === Object.prototype,
    immutable: Reflect.ownKeys(inheritedFindOptions).every(function(key) {
      const descriptor = Object.getOwnPropertyDescriptor(inheritedFindOptions, key);
      return descriptor.enumerable && !descriptor.writable && !descriptor.configurable;
    })
  }, {
    keys: ['suppressAuth', 'consistentRead', 'suppressHooks'],
    frozen: true, ordinary: true, immutable: true
  }, 'loader find receives fresh frozen exact ordinary read options');

  const deepQueryBase = {
    query: function() {
      return {
        eq: function() { return {
          limit: function() { return {
            find: async function() { return { items: [], hasNext: function() { return false; } }; }
          }; }
        }; }
      };
    }
  };
  let depthSevenQueryPort = deepQueryBase;
  for (let depth = 0; depth < 7; depth += 1) {
    depthSevenQueryPort = Object.create(depthSevenQueryPort);
  }
  const depthSevenLoader = createContextWithWixData(depthSevenQueryPort);
  assertEqual(await depthSevenLoader.adapter.loadOperationBookingRows(operationId), [],
    'a stable query capability at inherited depth seven remains within the bounded capability contract');

  const freshOptionsFirst = createContext({ items: [], hasNext: function() { return false; } });
  await freshOptionsFirst.adapter.loadOperationBookingRows(operationId);
  await freshOptionsFirst.adapter.loadOperationBookingRows(operationId);
  const loaderOptions = freshOptionsFirst.calls.filter(function(entry) { return entry.method === 'find'; })
    .map(function(entry) { return entry.options; });
  assertEqual(loaderOptions.length === 2 && loaderOptions[0] !== loaderOptions[1], true,
    'every loader invocation receives a fresh private read-options object');

  for (const validBoundaryId of ['x'.repeat(16), 'x'.repeat(64)]) {
    const boundary = createContext({ items: [], hasNext: function() { return false; } });
    assertEqual(await boundary.adapter.loadOperationBookingRows(validBoundaryId), [],
      'primitive operation IDs at an allowed boundary perform the authoritative query');
  }

  const structuralLoaderRows = [];
  const nullPrototypeLoaderRow = Object.assign(Object.create(null), loaderRows[0]);
  structuralLoaderRows.push(nullPrototypeLoaderRow);
  const customPrototypeLoaderRow = Object.assign(Object.create({ inherited: true }), loaderRows[0]);
  structuralLoaderRows.push(customPrototypeLoaderRow);
  const hiddenExtraLoaderRow = Object.assign({}, loaderRows[0]);
  Object.defineProperty(hiddenExtraLoaderRow, 'hidden', { value: true });
  structuralLoaderRows.push(hiddenExtraLoaderRow);
  structuralLoaderRows.push(Object.assign({}, loaderRows[0], {
    checkIn: Object.create(Date.prototype)
  }));
  structuralLoaderRows.push(Object.assign({}, loaderRows[0], {
    checkOut: new Date(NaN)
  }));
  for (let index = 0; index < structuralLoaderRows.length; index += 1) {
    await rejectPage({ items: [structuralLoaderRows[index]], hasNext: function() { return false; } },
      'non-ordinary, hidden, or forged stored-row evidence fails closed case ' + (index + 1));
  }

  for (const inconsistentRows of [
    [loaderRows[0], Object.assign({}, loaderRows[1], { bookingNumber: 'WC-OTHER' })],
    [loaderRows[0], Object.assign({}, loaderRows[1], { payloadDigest: '2'.repeat(64) })],
    [loaderRows[0], Object.assign({}, loaderRows[1], { guests: 1 })],
    [loaderRows[0], Object.assign({}, loaderRows[1], { note: 'later note' })],
    [loaderRows[0], Object.assign({}, loaderRows[1], {
      checkOut: new Date('2027-11-08T12:00:00.000Z')
    })],
    [Object.assign({}, loaderRows[0], { assignedRoom: 4 }),
      Object.assign({}, loaderRows[1], { assignedRoom: 3 })],
    [Object.assign({}, loaderRows[0], { assignedRoom: 3 }),
      Object.assign({}, loaderRows[1], { assignedRoom: 5 })],
    [Object.assign({}, loaderRows[0], { roomCode: 'penthouse_apartment', assignedRoom: 1 }),
      Object.assign({}, loaderRows[1], { roomCode: 'two_bedroom_apartment', assignedRoom: 2 })]
  ]) {
    await rejectPage({ items: inconsistentRows, hasNext: function() { return false; } },
      'cross-row canonical and topology inconsistencies fail closed');
  }

  let unstableRowReads = 0;
  const unstableRow = new Proxy(Object.assign({}, loaderRows[0]), {
    getOwnPropertyDescriptor: function(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (key === 'status') descriptor.value = unstableRowReads++ % 2 === 0 ? 'confirmed' : 'pending';
      return descriptor;
    }
  });
  await rejectPage({ items: [unstableRow], hasNext: function() { return false; } },
    'unstable row values across descriptor snapshots fail closed');

  let hasNextGetterRuns = 0;
  const accessorHasNext = { items: [] };
  Object.defineProperty(accessorHasNext, 'hasNext', {
    get: function() { hasNextGetterRuns += 1; return function() { return false; }; }
  });
  await rejectPage(accessorHasNext, 'an accessor-backed hasNext capability fails closed');
  assertEqual(hasNextGetterRuns, 0, 'an accessor-backed hasNext capability is never invoked');

  const capturedNextPage2 = { items: [loaderRows[1]], hasNext: function() { return false; } };
  const originalNext = function() { return capturedNextPage2; };
  const capturedNextPage1 = {
    items: [loaderRows[0]], next: originalNext,
    hasNext: function() {
      this.next = function() { throw new Error('replacement next'); };
      return true;
    }
  };
  assertEqual(await createContext(capturedNextPage1).adapter.loadOperationBookingRows(operationId),
    loaderRows, 'next capability is captured before hasNext can replace it');

  const throwingFindPort = {
    query: function() { return this; }, eq: function() { return this; },
    limit: function() { return this; }, find: function() { throw new TypeError('transport detail'); }
  };
  await assertRejects(
    function() { return createContextWithWixData(throwingFindPort).adapter
      .loadOperationBookingRows(operationId); },
    'Invalid booking row page', 'query and transport exceptions are normalized'
  );

  let unstableQueryRead = 0;
  const queryOne = function() { throw new Error('must not dispatch'); };
  const queryTwo = function() { throw new Error('must not dispatch'); };
  const unstableQueryPort = new Proxy({ query: queryOne }, {
    getOwnPropertyDescriptor: function(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (key === 'query') descriptor.value = unstableQueryRead++ % 2 === 0 ? queryOne : queryTwo;
      return descriptor;
    }
  });
  await assertRejects(
    function() { return createContextWithWixData(unstableQueryPort).adapter
      .loadOperationBookingRows(operationId); },
    'Invalid booking row page', 'unstable query capabilities fail closed before dispatch'
  );

  let storedAccessorRuns = 0;
  const accessorStoredRow = Object.assign({}, loaderRows[0]);
  Object.defineProperty(accessorStoredRow, 'status', {
    enumerable: true, configurable: true,
    get: function() { storedAccessorRuns += 1; return 'confirmed'; }
  });
  await rejectPage({ items: [accessorStoredRow], hasNext: function() { return false; } },
    'accessor-backed stored-row fields fail closed');
  assertEqual(storedAccessorRuns, 0, 'stored-row accessors are rejected without invocation');

  let eqAccessorRuns = 0;
  const accessorBuilderPort = {
    query: function() {
      const builder = {};
      Object.defineProperty(builder, 'eq', {
        get: function() { eqAccessorRuns += 1; return function() { return builder; }; }
      });
      return builder;
    }
  };
  await assertRejects(
    function() { return createContextWithWixData(accessorBuilderPort).adapter
      .loadOperationBookingRows(operationId); },
    'Invalid booking row page', 'accessor-backed query-builder capabilities fail closed'
  );
  assertEqual(eqAccessorRuns, 0, 'query-builder accessors are rejected without invocation');

  let unstableItemsRead = 0;
  const firstItems = [];
  const secondItems = [];
  const unstableItemsPage = new Proxy({ items: firstItems, hasNext: function() { return false; } }, {
    getOwnPropertyDescriptor: function(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (key === 'items') descriptor.value = unstableItemsRead++ % 2 === 0 ? firstItems : secondItems;
      return descriptor;
    }
  });
  await rejectPage(unstableItemsPage, 'unstable page-item capabilities fail closed');

  let tooDeepPort = {
    query: function() { throw new Error('must not reach deep capability'); }
  };
  for (let depth = 0; depth < 8; depth += 1) tooDeepPort = Object.create(tooDeepPort);
  await assertRejects(
    function() { return createContextWithWixData(tooDeepPort).adapter
      .loadOperationBookingRows(operationId); },
    'Invalid booking row page', 'query capability discovery is bounded to seven inherited holders'
  );

  const originals = {
    descriptors: Object.getOwnPropertyDescriptors, ownKeys: Reflect.ownKeys,
    apply: Reflect.apply, resolve: Promise.resolve, getTime: Date.prototype.getTime,
    iso: Date.prototype.toISOString
  };
  const hostileAwaitPage = { items: [loaderRows[0]], hasNext: function() { return false; } };
  const hostileAwaitPort = {
    query: function() { return this; }, eq: function() { return this; }, limit: function() { return this; },
    find: function() {
      return { then: function(resolve) {
        Object.getOwnPropertyDescriptors = function() { throw new Error('replaced descriptors'); };
        Reflect.ownKeys = function() { throw new Error('replaced ownKeys'); };
        Reflect.apply = function() { throw new Error('replaced apply'); };
        Promise.resolve = function() { throw new Error('replaced resolve'); };
        Date.prototype.getTime = function() { throw new Error('replaced getTime'); };
        Date.prototype.toISOString = function() { throw new Error('replaced ISO'); };
        hostileAwaitPort.query = function() { throw new Error('replaced query'); };
        resolve(hostileAwaitPage);
      } };
    }
  };
  let hostileAwaitResult;
  try {
    hostileAwaitResult = await createContextWithWixData(hostileAwaitPort).adapter
      .loadOperationBookingRows(operationId);
  } finally {
    Object.getOwnPropertyDescriptors = originals.descriptors;
    Reflect.ownKeys = originals.ownKeys;
    Reflect.apply = originals.apply;
    Promise.resolve = originals.resolve;
    Date.prototype.getTime = originals.getTime;
    Date.prototype.toISOString = originals.iso;
  }
  assertEqual(hostileAwaitResult, [loaderRows[0]],
    'post-await intrinsic and Wix capability replacement cannot redirect loader evidence');
})();
