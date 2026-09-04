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
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^import .*;\s*$/gm, '')
  .replace(/export async function /g, 'async function ')
  + '\nthis.adapter = { appendPhysicalBookingRows, loadOperationBookingRows };';

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
      calls.push({ method: 'insert', collection, row, options });
      if (store.has(row._id)) throw new Error('duplicate ID');
      store.set(row._id, Object.assign({ _createdDate: new Date('2027-01-01T00:00:00.000Z') }, row));
      return { ignored: true };
    },
    get: async function(collection, id, options) {
      calls.push({ method: 'get', collection, id, options });
      return store.get(id) || null;
    }
  };
  const context = { Date, Map, Object, wixData };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { adapter: context.adapter, calls, store, wixData };
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
  roomFee: 175,
  note: ''
};
const rows = [
  Object.assign({}, base, { _id: 'pb1-' + operationId + '-r1', assignedRoom: 3 }),
  Object.assign({}, base, { _id: 'pb1-' + operationId + '-r2', assignedRoom: 4 })
];

(async function() {
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

  async function verifyPreflightFailure(candidateRows, expectedIndex, message) {
    const candidate = createContext();
    assertEqual(await candidate.adapter.appendPhysicalBookingRows(candidateRows), {
      state: 'STOPPED',
      confirmed: [],
      failed: {
        index: expectedIndex,
        rowId: candidateRows[expectedIndex] && candidateRows[expectedIndex]._id,
        classification: 'INTEGRITY'
      }
    }, message);
    assertEqual(candidate.calls.length, 0, message + ' with zero Wix I/O');
  }

  await verifyPreflightFailure([], 0,
    'an empty booking-row acquisition fails closed during preflight');
  await verifyPreflightFailure([
    Object.assign({}, rows[0], { checkOut: new Date('2027-11-07T12:00:00.001Z') })
  ], 0, 'a nonzero checkout millisecond is rejected independently');
  await verifyPreflightFailure([
    Object.assign({}, rows[0], {
      checkIn: '+010000-11-05T12:00:00.000Z',
      checkOut: '+010000-11-07T12:00:00.000Z'
    })
  ], 0, 'extended-year timestamps are rejected even when Date can parse them');
  await verifyPreflightFailure([
    Object.assign({}, rows[0], {
      checkIn: new Date('+010000-11-05T12:00:00.000Z'),
      checkOut: new Date('+010000-11-07T12:00:00.000Z')
    })
  ], 0, 'extended-year Date objects are rejected before persistence');
  await verifyPreflightFailure([
    Object.assign({}, rows[0], {
      checkIn: '2027-02-30T12:00:00.000Z',
      checkOut: '2027-03-03T12:00:00.000Z'
    })
  ], 0, 'normalized impossible calendar dates are rejected by ISO round-trip validation');
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
    assertEqual(result.failed.classification, 'INTEGRITY',
      'invalid deterministic booking-row topology is classified as integrity case ' + (index + 1));
    assertEqual(invalid.calls.length, 0,
      'invalid deterministic booking-row topology performs zero Wix I/O case ' + (index + 1));
  }

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

  const secondPage = {
    items: [rows[0]],
    hasNext: function() { return false; }
  };
  const firstPage = {
    items: [rows[1]],
    hasNext: function() { return true; },
    next: async function() { return secondPage; }
  };
  const loader = createContext(firstPage);
  assertEqual(await loader.adapter.loadOperationBookingRows(operationId), rows,
    'operation booking-row loading pages completely and returns deterministic row order');
  assertEqual(loader.calls, [
    { method: 'query', collection: 'Bookings' },
    { method: 'eq', field: 'operationId', value: operationId },
    { method: 'limit', value: 1000 },
    { method: 'find', options: { suppressAuth: true, consistentRead: true, suppressHooks: true } }
  ], 'operation row loading uses the exact indexed filter, page size, and read options');

  const duplicatePage = {
    items: [rows[0], Object.assign({}, rows[0])],
    hasNext: function() { return false; }
  };
  const duplicateLoader = createContext(duplicatePage);
  await assertRejects(
    function() { return duplicateLoader.adapter.loadOperationBookingRows(operationId); },
    'Invalid booking row page',
    'duplicate deterministic row IDs in query results fail closed'
  );

  const foreignPage = {
    items: [Object.assign({}, rows[0], { operationId: 'differentoperation1' })],
    hasNext: function() { return false; }
  };
  const foreignLoader = createContext(foreignPage);
  await assertRejects(
    function() { return foreignLoader.adapter.loadOperationBookingRows(operationId); },
    'Invalid booking row page',
    'query results containing a foreign operation fail closed'
  );
})();
