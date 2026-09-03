// Golden compatibility tests for Booking Search plus physical-cap integration.
// Run: node scripts/verify-room-search-compatibility.js
process.env.TZ = 'UTC';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assertEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`FAIL: ${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`);
  }
  console.log(`PASS: ${message}`);
}

const searchPath = path.join(__dirname, '..', 'velo', 'backend', 'search.web.js');
const source = fs.readFileSync(searchPath, 'utf8')
  .replace(/^import .*;\s*$/gm, '')
  .replace(/export const /g, 'var ')
  + '\nthis.searchApi = { searchAvailability, suggestAlternateDates };';

let fixture = null;
const queryCalls = [];
const wixData = {
  query: function(collection) {
    queryCalls.push(collection);
    return {
      le: function() { return this; },
      ge: function() { return this; },
      limit: function() { return this; },
      find: async function() {
        if (collection === 'HotelClosures') return { items: fixture.closures || [] };
        if (collection === 'Rooms') return { items: fixture.rooms || [] };
        if (collection === 'Bookings') return { items: fixture.bookings || [] };
        if (collection === 'BookingSummary') return { items: fixture.summaries || [] };
        throw new Error('Unexpected collection ' + collection);
      }
    };
  }
};

const context = {
  Array,
  Date,
  Object,
  Reflect,
  wixData,
  ROOM_UNITS: {
    penthouse_apartment: 1,
    two_bedroom_apartment: 1,
    adventure_suite: 3
  },
  Permissions: { Anyone: 'Anyone' },
  webMethod: function(permission, handler) { return handler; },
  console: { log: function() {} },
  loadRoomAvailability: async function() {
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'adventure_suite', available: true, maxQuantity: 3 }
    ];
  }
};
vm.createContext(context);
vm.runInContext(source, context);

function room(overrides) {
  return Object.assign({
    roomCode: 'adventure_suite',
    name: 'Adventure Suite',
    units: 3,
    maxOccupancy: 4,
    baseOccupancy: 2,
    roomFee: 25,
    mainPhoto: 'https://example.com/adventure.jpg',
    description: 'Suite description',
    roomType: 'Suite',
    occupancyText: 'Sleeps four',
    additionalFeeText: 'Fee text'
  }, overrides || {});
}

function reset(overrides) {
  fixture = Object.assign({ closures: [], rooms: [room()], bookings: [], summaries: [] }, overrides || {});
  queryCalls.length = 0;
}

function booking(number, status, quantity) {
  const row = { bookingNumber: number, roomCode: 'adventure_suite', status: status };
  if (quantity !== undefined) row.quantity = quantity;
  return row;
}

function summary(number, checkIn, checkOut) {
  return { bookingNumber: number, checkIn: checkIn, checkOut: checkOut };
}

(async function() {
  reset();
  assertEqual(await context.searchApi.searchAvailability('2027-11-06', '2027-11-05'), {
    ok: false,
    error: 'Check-out must be after check-in.',
    requestedNights: 0,
    results: []
  }, 'reversed dates preserve the exact public failure envelope');
  assertEqual(queryCalls, [], 'invalid dates do not query collections');

  reset();
  assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-08'), {
    ok: false,
    error: 'Minimum stay is 4 nights.',
    requestedNights: 3,
    results: []
  }, 'short stays preserve the exact minimum-night envelope');

  reset({ closures: [{ startDate: '2027-11-05', endDate: '2027-11-09', reason: 'Maintenance' }] });
  assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-09'), {
    ok: false,
    error: 'Maintenance',
    requestedNights: 4,
    results: []
  }, 'hotel closures preserve their public failure envelope');

  reset();
  assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-09'), {
    ok: true,
    error: null,
    requestedNights: 4,
    results: [{
      roomCode: 'adventure_suite',
      roomName: 'Adventure Suite',
      units: 3,
      occupancy: 4,
      baseOccupancy: 2,
      maxQty: 3,
      status: 'full',
      availableCheckIn: '2027-11-05T00:00:00.000Z',
      availableCheckOut: '2027-11-09T00:00:00.000Z',
      availableNights: 4,
      roomFee: 25,
      mainPhoto: 'https://example.com/adventure.jpg',
      name: 'Adventure Suite',
      description: 'Suite description',
      roomType: 'Suite',
      occupancyText: 'Sleeps four',
      additionalFeeText: 'Fee text'
    }],
    _ver: 'string-date-overlap-fix'
  }, 'full availability preserves every top-level and result-row field');

  reset({
    bookings: [booking('PENDING', ' pending ', 3)],
    summaries: [summary('PENDING', '2027-11-05', '2027-11-09')]
  });
  assertEqual((await context.searchApi.searchAvailability('2027-11-05', '2027-11-09')).results, [],
    'legacy Search continues counting pending bookings');

  reset({
    bookings: [booking('BLANK', '', 3)],
    summaries: [summary('BLANK', '2027-11-05', '2027-11-09')]
  });
  assertEqual((await context.searchApi.searchAvailability('2027-11-05', '2027-11-09')).results, [],
    'legacy Search continues counting blank-status bookings');

  reset({
    bookings: [booking('CANCELLED', ' Cancelled ', 3)],
    summaries: [summary('CANCELLED', '2027-11-05', '2027-11-09')]
  });
  assertEqual((await context.searchApi.searchAvailability('2027-11-05', '2027-11-09')).results[0].maxQty, 3,
    'legacy Search continues excluding cancelled bookings');

  reset({
    bookings: [booking('CANCELED', ' Canceled ', 3)],
    summaries: [summary('CANCELED', '2027-11-05', '2027-11-09')]
  });
  assertEqual((await context.searchApi.searchAvailability('2027-11-05', '2027-11-09')).results[0].maxQty, 3,
    'legacy Search continues excluding canceled bookings');

  reset({
    bookings: [Object.assign(booking('SUMMARY-AUTHORITY', 'confirmed', 3), {
      checkIn: '2027-11-05',
      checkOut: '2027-11-09'
    })],
    summaries: [summary('SUMMARY-AUTHORITY', '2027-12-01', '2027-12-05')]
  });
  assertEqual((await context.searchApi.searchAvailability('2027-11-05', '2027-11-09')).results[0].maxQty, 3,
    'legacy Search ignores direct Bookings dates and uses BookingSummary dates only');

  reset({
    bookings: [booking('PARTIAL', 'confirmed', 3)],
    summaries: [summary('PARTIAL', '2027-11-05', '2027-11-07')]
  });
  const partial = await context.searchApi.searchAvailability('2027-11-05', '2027-11-11');
  assertEqual(partial.results.map(function(row) {
    return {
      status: row.status,
      maxQty: row.maxQty,
      availableCheckIn: row.availableCheckIn,
      availableCheckOut: row.availableCheckOut,
      availableNights: row.availableNights
    };
  }), [{
    status: 'partial',
    maxQty: 3,
    availableCheckIn: '2027-11-07T00:00:00.000Z',
    availableCheckOut: '2027-11-11T00:00:00.000Z',
    availableNights: 4
  }], 'partial availability preserves longest-run and exclusive-checkout semantics');

  reset({
    bookings: [booking('TIE', 'confirmed', 3)],
    summaries: [summary('TIE', '2027-11-09', '2027-11-11')]
  });
  const tied = await context.searchApi.searchAvailability('2027-11-05', '2027-11-15');
  assertEqual([tied.results[0].availableCheckIn, tied.results[0].availableCheckOut], [
    '2027-11-05T00:00:00.000Z', '2027-11-09T00:00:00.000Z'
  ], 'equal partial runs retain the earliest window');

  reset({
    bookings: [booking('SHORT', 'confirmed', 3)],
    summaries: [summary('SHORT', '2027-11-08', '2027-11-09')]
  });
  assertEqual((await context.searchApi.searchAvailability('2027-11-05', '2027-11-11')).results, [],
    'partial runs shorter than four nights remain filtered out');

  reset({
    bookings: [booking('FALLBACK', 'confirmed')],
    summaries: [summary('FALLBACK', '2027-11-05', '2027-11-09')]
  });
  assertEqual((await context.searchApi.searchAvailability('2027-11-05', '2027-11-09')).results[0].maxQty, 2,
    'BookingSummary-only dates and missing-quantity fallback remain unchanged');

  const physicalCalls = [];
  context.loadRoomAvailability = async function(checkIn, checkOut) {
    physicalCalls.push([checkIn, checkOut]);
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'adventure_suite', available: true, maxQuantity: 1 }
    ];
  };
  reset();
  const physicallyCapped = await context.searchApi.searchAvailability('2027-11-05', '2027-11-09');
  assertEqual(physicallyCapped.results[0].maxQty, 1,
    'physical availability reduces maxQty without changing the public row contract');
  assertEqual(Object.keys(physicallyCapped.results[0]), [
    'roomCode', 'roomName', 'units', 'occupancy', 'baseOccupancy', 'maxQty', 'status',
    'availableCheckIn', 'availableCheckOut', 'availableNights', 'roomFee', 'mainPhoto',
    'name', 'description', 'roomType', 'occupancyText', 'additionalFeeText'
  ], 'physical capping adds no public result-row fields');
  assertEqual(physicalCalls.map(function(call) {
    return call.map(function(value) { return value.toISOString(); });
  }), [['2027-11-05T00:00:00.000Z', '2027-11-09T00:00:00.000Z']],
  'full-stay physical availability is evaluated once for the exact normalized interval');

  context.loadRoomAvailability = async function() {
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'adventure_suite', available: false, maxQuantity: 0 }
    ];
  };
  reset();
  assertEqual((await context.searchApi.searchAvailability('2027-11-05', '2027-11-09')).results, [],
    'a zero physical cap removes the legacy-available room without fallback');

  const partialPhysicalCalls = [];
  context.loadRoomAvailability = async function(checkIn, checkOut) {
    partialPhysicalCalls.push([checkIn.toISOString(), checkOut.toISOString()]);
    const partialWindow = checkIn.toISOString() === '2027-11-07T00:00:00.000Z' &&
      checkOut.toISOString() === '2027-11-11T00:00:00.000Z';
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'adventure_suite', available: partialWindow, maxQuantity: partialWindow ? 2 : 0 }
    ];
  };
  reset({
    bookings: [booking('PHYSICAL-PARTIAL', 'confirmed', 3)],
    summaries: [summary('PHYSICAL-PARTIAL', '2027-11-05', '2027-11-07')]
  });
  const physicallyCappedPartial = await context.searchApi.searchAvailability('2027-11-05', '2027-11-11');
  assertEqual(physicallyCappedPartial.results[0].maxQty, 2,
    'partial maxQty is capped using physical availability for the exact partial interval');
  assertEqual(partialPhysicalCalls, [
    ['2027-11-05T00:00:00.000Z', '2027-11-11T00:00:00.000Z'],
    ['2027-11-07T00:00:00.000Z', '2027-11-11T00:00:00.000Z']
  ], 'partial availability evaluates the full request and exact derived partial interval');

  const cachedWindowCalls = [];
  context.loadRoomAvailability = async function(checkIn, checkOut) {
    cachedWindowCalls.push([checkIn.toISOString(), checkOut.toISOString()]);
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'adventure_suite', available: true, maxQuantity: 3 }
    ];
  };
  reset({
    rooms: [
      room({ name: 'Adventure Suite' }),
      room({ roomCode: 'two_bedroom_apartment', name: 'Two-Bedroom Apartment' })
    ],
    bookings: [
      booking('CACHED-PARTIAL', 'confirmed', 3),
      { bookingNumber: 'CACHED-TWO-BEDROOM', roomCode: 'two_bedroom_apartment', status: 'confirmed', quantity: 1 }
    ],
    summaries: [
      summary('CACHED-PARTIAL', '2027-11-05', '2027-11-07'),
      summary('CACHED-TWO-BEDROOM', '2027-11-05', '2027-11-07')
    ]
  });
  await context.searchApi.searchAvailability('2027-11-05', '2027-11-11');
  assertEqual(cachedWindowCalls, [
    ['2027-11-05T00:00:00.000Z', '2027-11-11T00:00:00.000Z'],
    ['2027-11-07T00:00:00.000Z', '2027-11-11T00:00:00.000Z']
  ], 'identical partial windows share one coordinator snapshot read');

  let sharedPartialParses = 0;
  let sharedPartialLoads = 0;
  function statefulPhysicalRow(roomCode, firstMaxQuantity) {
    const target = { roomCode: roomCode, available: true, maxQuantity: firstMaxQuantity };
    return new Proxy(target, {
      getOwnPropertyDescriptor: function(rowTarget, property) {
        const descriptor = Object.getOwnPropertyDescriptor(rowTarget, property);
        if (property === 'available') descriptor.value = sharedPartialParses === 1;
        if (property === 'maxQuantity') {
          descriptor.value = sharedPartialParses === 1 ? firstMaxQuantity : 0;
        }
        return descriptor;
      }
    });
  }
  const statefulPartialRows = new Proxy([
    statefulPhysicalRow('penthouse_apartment', 1),
    statefulPhysicalRow('two_bedroom_apartment', 1),
    statefulPhysicalRow('adventure_suite', 3)
  ], {
    ownKeys: function(target) {
      sharedPartialParses += 1;
      return Reflect.ownKeys(target);
    }
  });
  context.loadRoomAvailability = async function(checkIn) {
    if (checkIn.toISOString() === '2027-11-07T00:00:00.000Z') {
      sharedPartialLoads += 1;
      return statefulPartialRows;
    }
    return [
      { roomCode: 'penthouse_apartment', available: false, maxQuantity: 0 },
      { roomCode: 'two_bedroom_apartment', available: false, maxQuantity: 0 },
      { roomCode: 'adventure_suite', available: false, maxQuantity: 0 }
    ];
  };
  reset({
    rooms: [
      room({ name: 'Adventure Suite' }),
      room({ roomCode: 'two_bedroom_apartment', name: 'Two-Bedroom Apartment' })
    ],
    bookings: [
      booking('STATEFUL-PARTIAL', 'confirmed', 3),
      { bookingNumber: 'STATEFUL-TWO-BEDROOM', roomCode: 'two_bedroom_apartment', status: 'confirmed', quantity: 1 }
    ],
    summaries: [
      summary('STATEFUL-PARTIAL', '2027-11-05', '2027-11-07'),
      summary('STATEFUL-TWO-BEDROOM', '2027-11-05', '2027-11-07')
    ]
  });
  const sharedPartialResult = await context.searchApi.searchAvailability('2027-11-05', '2027-11-11');
  assertEqual({
    rows: sharedPartialResult.results.map(function(resultRow) {
      return { roomCode: resultRow.roomCode, maxQty: resultRow.maxQty };
    }),
    loads: sharedPartialLoads,
    parses: sharedPartialParses
  }, {
    rows: [
      { roomCode: 'adventure_suite', maxQty: 3 },
      { roomCode: 'two_bedroom_apartment', maxQty: 1 }
    ],
    loads: 1,
    parses: 1
  }, 'shared partial consumers await one validated physical-cap snapshot');

  context.loadRoomAvailability = async function(checkIn) {
    if (checkIn.toISOString() === '2027-11-07T00:00:00.000Z') {
      throw new Error('partial inventory read detail');
    }
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'adventure_suite', available: false, maxQuantity: 0 }
    ];
  };
  reset({
    bookings: [booking('FAILED-PARTIAL', 'confirmed', 3)],
    summaries: [summary('FAILED-PARTIAL', '2027-11-05', '2027-11-07')]
  });
  let safePartialFailure = null;
  try {
    safePartialFailure = await context.searchApi.searchAvailability('2027-11-05', '2027-11-11');
  } catch (error) {
    safePartialFailure = { threw: error.message };
  }
  assertEqual(safePartialFailure, {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 6,
    results: []
  }, 'partial-window inventory failures discard all rows and return the safe public envelope');

  context.loadRoomAvailability = async function(checkIn) {
    if (checkIn.toISOString() === '2027-11-07T00:00:00.000Z') {
      return [
        { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
        { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
        { roomCode: 'adventure_suite', available: true }
      ];
    }
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'adventure_suite', available: false, maxQuantity: 0 }
    ];
  };
  reset({
    bookings: [booking('MALFORMED-PARTIAL', 'confirmed', 3)],
    summaries: [summary('MALFORMED-PARTIAL', '2027-11-05', '2027-11-07')]
  });
  assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-11'), {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 6,
    results: []
  }, 'malformed partial-window coordinator rows fail closed through the safe envelope');

  context.loadRoomAvailability = async function() { return null; };
  reset();
  let malformedFailure = null;
  try {
    malformedFailure = await context.searchApi.searchAvailability('2027-11-05', '2027-11-09');
  } catch (error) {
    malformedFailure = { threw: error.message };
  }
  assertEqual(malformedFailure, {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 4,
    results: []
  }, 'malformed coordinator output fails closed through the safe public envelope');

  context.loadRoomAvailability = async function() {
    return [
      { roomCode: 'adventure_suite', available: true, maxQuantity: 3 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 }
    ];
  };
  reset();
  const reorderedFailure = await context.searchApi.searchAvailability('2027-11-05', '2027-11-09');
  assertEqual(reorderedFailure, {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 4,
    results: []
  }, 'reordered coordinator rows fail closed instead of being silently normalized');

  function physicalRows(adventureOverrides) {
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      Object.assign({ roomCode: 'adventure_suite', available: true, maxQuantity: 3 }, adventureOverrides || {})
    ];
  }
  const malformedCoordinatorCases = [
    ['array prototype substituted with an array', function() {
      const rows = physicalRows();
      Object.setPrototypeOf(rows, []);
      return rows;
    }],
    ['row prototype substituted with a null-root object', function() {
      const prototype = Object.create(null);
      Object.defineProperty(prototype, 'hiddenInherited', { value: true });
      prototype[Symbol('inherited')] = true;
      Object.defineProperty(prototype, 'accessorInherited', {
        enumerable: true,
        get: function() { return true; }
      });
      const rows = physicalRows();
      Object.setPrototypeOf(rows[2], prototype);
      return rows;
    }],
    ['non-enumerable array index', function() {
      const rows = physicalRows();
      Object.defineProperty(rows, '2', {
        enumerable: false,
        value: rows[2]
      });
      return rows;
    }],
    ['sparse rows', function() { const rows = physicalRows(); delete rows[1]; return rows; }],
    ['missing row field', function() { const rows = physicalRows(); delete rows[2].available; return rows; }],
    ['non-enumerable required row field', function() {
      const rows = physicalRows();
      Object.defineProperty(rows[2], 'roomCode', {
        enumerable: false,
        value: 'adventure_suite'
      });
      return rows;
    }],
    ['non-enumerable required available field', function() {
      const rows = physicalRows();
      Object.defineProperty(rows[2], 'available', {
        enumerable: false,
        value: true
      });
      return rows;
    }],
    ['non-enumerable required quantity field', function() {
      const rows = physicalRows();
      Object.defineProperty(rows[2], 'maxQuantity', {
        enumerable: false,
        value: 3
      });
      return rows;
    }],
    ['extra enumerable row field', function() { const rows = physicalRows(); rows[2].extra = true; return rows; }],
    ['symbol row field', function() { const rows = physicalRows(); rows[2][Symbol('extra')] = true; return rows; }],
    ['unsupported room code', function() { return physicalRows({ roomCode: 'unknown_room' }); }],
    ['boxed room code', function() { return physicalRows({ roomCode: new String('adventure_suite') }); }],
    ['duplicate room code', function() { return physicalRows({ roomCode: 'two_bedroom_apartment', maxQuantity: 1 }); }],
    ['string quantity', function() { return physicalRows({ maxQuantity: '3' }); }],
    ['negative quantity', function() { return physicalRows({ maxQuantity: -1 }); }],
    ['fractional quantity', function() { return physicalRows({ maxQuantity: 1.5 }); }],
    ['out-of-range quantity', function() { return physicalRows({ maxQuantity: 4 }); }],
    ['NaN quantity', function() { return physicalRows({ maxQuantity: NaN }); }],
    ['infinite quantity', function() { return physicalRows({ maxQuantity: Infinity }); }],
    ['non-boolean available', function() { return physicalRows({ available: 1 }); }],
    ['available and quantity mismatch', function() { return physicalRows({ available: false, maxQuantity: 3 }); }],
    ['symbol array field', function() { const rows = physicalRows(); rows[Symbol('extra')] = true; return rows; }]
  ];
  for (const malformedCase of malformedCoordinatorCases) {
    context.loadRoomAvailability = async function() { return malformedCase[1](); };
    reset();
    assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-09'), {
      ok: false,
      error: 'Unable to check room availability. Please try again.',
      requestedNights: 4,
      results: []
    }, 'malformed coordinator output fails closed: ' + malformedCase[0]);
  }

  const frozenAvailability = Object.freeze([
    Object.freeze({ roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 }),
    Object.freeze({ roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 }),
    Object.freeze({ roomCode: 'adventure_suite', available: true, maxQuantity: 3 })
  ]);
  const frozenBefore = JSON.stringify(frozenAvailability);
  context.loadRoomAvailability = async function() { return frozenAvailability; };
  reset();
  const frozenResult = await context.searchApi.searchAvailability('2027-11-05', '2027-11-09');
  assertEqual([frozenResult.results[0].maxQty, JSON.stringify(frozenAvailability)], [3, frozenBefore],
    'Search accepts frozen coordinator output without mutating it');

  let coordinatorDateMutationTraps = 0;
  context.loadRoomAvailability = async function(checkIn, checkOut) {
    return new Proxy(physicalRows(), {
      ownKeys: function(target) {
        coordinatorDateMutationTraps += 1;
        checkIn.setUTCDate(checkIn.getUTCDate() + 20);
        checkOut.setUTCDate(checkOut.getUTCDate() + 20);
        return Reflect.ownKeys(target);
      }
    });
  };
  reset();
  const dateMutationResult = await context.searchApi.searchAvailability('2027-11-05', '2027-11-09');
  assertEqual({
    requestedNights: dateMutationResult.requestedNights,
    availableCheckIn: dateMutationResult.results[0].availableCheckIn,
    availableCheckOut: dateMutationResult.results[0].availableCheckOut,
    traps: coordinatorDateMutationTraps
  }, {
    requestedNights: 4,
    availableCheckIn: '2027-11-05T00:00:00.000Z',
    availableCheckOut: '2027-11-09T00:00:00.000Z',
    traps: 1
  }, 'coordinator validation cannot mutate canonical Search interval dates');

  let isolatedRequestCalls = 0;
  context.loadRoomAvailability = async function() {
    isolatedRequestCalls += 1;
    return physicalRows();
  };
  reset();
  await context.searchApi.searchAvailability('2027-11-05', '2027-11-09');
  await context.searchApi.searchAvailability('2027-11-05', '2027-11-09');
  assertEqual(isolatedRequestCalls, 2, 'physical availability cache is isolated to one Search request');

  let unstableCapReads = 0;
  const unstableAdventureRow = {
    roomCode: 'adventure_suite',
    available: false
  };
  Object.defineProperty(unstableAdventureRow, 'maxQuantity', {
    enumerable: true,
    get: function() {
      unstableCapReads += 1;
      return unstableCapReads <= 4 ? 0 : 3;
    }
  });
  context.loadRoomAvailability = async function() {
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      unstableAdventureRow
    ];
  };
  reset();
  assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-09'), {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 4,
    results: []
  }, 'stateful coordinator accessors fail closed instead of changing caps after validation');

  const hiddenFieldAdventureRow = {
    roomCode: 'adventure_suite',
    available: true,
    maxQuantity: 3
  };
  Object.defineProperty(hiddenFieldAdventureRow, 'hiddenDiagnostic', {
    enumerable: false,
    value: 'must not be accepted'
  });
  context.loadRoomAvailability = async function() {
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      hiddenFieldAdventureRow
    ];
  };
  reset();
  assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-09'), {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 4,
    results: []
  }, 'non-enumerable extra coordinator fields fail the exact row contract');

  const accessorRows = [
    { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
    { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 }
  ];
  Object.defineProperty(accessorRows, '2', {
    enumerable: true,
    get: function() {
      return { roomCode: 'adventure_suite', available: true, maxQuantity: 3 };
    }
  });
  context.loadRoomAvailability = async function() { return accessorRows; };
  reset();
  assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-09'), {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 4,
    results: []
  }, 'coordinator array index accessors fail closed');

  const expandedRows = [
    { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
    { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
    { roomCode: 'adventure_suite', available: true, maxQuantity: 3 }
  ];
  expandedRows.diagnostic = 'unexpected';
  context.loadRoomAvailability = async function() { return expandedRows; };
  reset();
  assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-09'), {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 4,
    results: []
  }, 'unexpected own coordinator array fields fail closed');

  const alteredArrayPrototypeRows = [
    { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
    { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
    { roomCode: 'adventure_suite', available: true, maxQuantity: 3 }
  ];
  Object.setPrototypeOf(alteredArrayPrototypeRows, {});
  context.loadRoomAvailability = async function() { return alteredArrayPrototypeRows; };
  reset();
  assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-09'), {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 4,
    results: []
  }, 'coordinator arrays with altered prototypes fail closed');

  const inheritedFieldAdventureRow = Object.create({ hiddenDiagnostic: 'unexpected' });
  inheritedFieldAdventureRow.roomCode = 'adventure_suite';
  inheritedFieldAdventureRow.available = true;
  inheritedFieldAdventureRow.maxQuantity = 3;
  context.loadRoomAvailability = async function() {
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      inheritedFieldAdventureRow
    ];
  };
  reset();
  assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-09'), {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 4,
    results: []
  }, 'coordinator rows with nonstandard prototypes fail closed');

  context.loadRoomAvailability = async function() {
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'adventure_suite', available: true, maxQuantity: 3 }
    ];
  };
  reset({
    rooms: [
      room({ name: 'First stale row', description: 'Stale metadata', minNightsAllowed: 5 }),
      room({ name: 'Canonical row', description: 'Current metadata' })
    ]
  });
  assertEqual(await context.searchApi.searchAvailability('2027-11-05', '2027-11-09'), {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 4,
    results: []
  }, 'duplicate room codes fail closed instead of producing hybrid result metadata');

  let statefulRoomCodeReads = 0;
  const statefulRoom = new Proxy(room({ name: 'Stateful Adventure', description: 'Stable metadata' }), {
    get: function(target, property, receiver) {
      if (property === 'roomCode') {
        statefulRoomCodeReads += 1;
        return statefulRoomCodeReads === 1 ? 'adventure_suite' : 'two_bedroom_apartment';
      }
      return Reflect.get(target, property, receiver);
    }
  });
  reset({
    rooms: [
      statefulRoom,
      room({ roomCode: 'two_bedroom_apartment', name: 'Stable Two-Bedroom' })
    ]
  });
  const statefulRoomsResult = await context.searchApi.searchAvailability('2027-11-05', '2027-11-09');
  assertEqual({
    rows: statefulRoomsResult.results.map(function(resultRow) {
      return { roomCode: resultRow.roomCode, name: resultRow.name };
    }),
    roomCodeReads: statefulRoomCodeReads
  }, {
    rows: [
      { roomCode: 'adventure_suite', name: 'Stateful Adventure' },
      { roomCode: 'two_bedroom_apartment', name: 'Stable Two-Bedroom' }
    ],
    roomCodeReads: 1
  }, 'Rooms roomCode is snapshotted once before duplicate validation and reused in source order');

  context.loadRoomAvailability = async function() {
    throw new Error('sensitive inventory migration detail');
  };
  reset();
  let safeFailure = null;
  try {
    safeFailure = await context.searchApi.searchAvailability('2027-11-05', '2027-11-09');
  } catch (error) {
    safeFailure = { threw: error.message };
  }
  assertEqual(safeFailure, {
    ok: false,
    error: 'Unable to check room availability. Please try again.',
    requestedNights: 4,
    results: []
  }, 'physical inventory failures return a safe existing-shaped envelope without fallback or detail leakage');

  context.loadRoomAvailability = async function() {
    return [
      { roomCode: 'penthouse_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'two_bedroom_apartment', available: true, maxQuantity: 1 },
      { roomCode: 'adventure_suite', available: true, maxQuantity: 3 }
    ];
  };
  reset();
  const alternatives = await context.searchApi.suggestAlternateDates('2027-11-05', '2027-11-09');
  assertEqual(alternatives, {
    ok: true,
    nights: 4,
    suggestions: [
      { checkIn: '2027-11-06T00:00:00.000Z', checkOut: '2027-11-10T00:00:00.000Z', checkInLabel: '11/6/2027', checkOutLabel: '11/10/2027', label: '(11/6/2027 – 11/10/2027)' },
      { checkIn: '2027-11-07T00:00:00.000Z', checkOut: '2027-11-11T00:00:00.000Z', checkInLabel: '11/7/2027', checkOutLabel: '11/11/2027', label: '(11/7/2027 – 11/11/2027)' },
      { checkIn: '2027-11-08T00:00:00.000Z', checkOut: '2027-11-12T00:00:00.000Z', checkInLabel: '11/8/2027', checkOutLabel: '11/12/2027', label: '(11/8/2027 – 11/12/2027)' }
    ]
  }, 'alternate-date output keeps its three-result limit, labels, and exclusive checkout');
})();
