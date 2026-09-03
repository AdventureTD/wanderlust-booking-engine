// Behavioral tests for the disconnected room-claim event adapter.
// Run: node scripts/verify-room-booking-claim-adapter.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
const source = fs.readFileSync(path.join(backendDir, 'roomBookingCommit.js'), 'utf8')
  .replace(/^import .*;\s*$/gm, '')
  .replace(/export async function /g, 'async function ')
  + '\nthis.adapter = { loadRoomClaimLedger, appendRoomClaimEvents: typeof appendRoomClaimEvents === "function" ? appendRoomClaimEvents : null };';

const calls = { collections: [], limits: [], finds: [] };
const wixData = {
  query: function(collection) {
    calls.collections.push(collection);
    return {
      limit: function(value) { calls.limits.push(value); return this; },
      find: async function(options) {
        calls.finds.push(options);
        return { items: [], hasNext: function() { return false; } };
      }
    };
  }
};
const context = { wixData };
vm.createContext(context);
vm.runInContext(source, context);

(async function() {
  assertEqual(typeof context.adapter.appendRoomClaimEvents, 'function',
    'adapter exposes the internal sequential claim-event append operation');
  assertEqual(await context.adapter.loadRoomClaimLedger(), [],
    'an empty complete claim collection returns an empty ledger');
  assertEqual(calls, {
    collections: ['RoomBookingClaimEvents'],
    limits: [1000],
    finds: [{ suppressAuth: true, consistentRead: true, suppressHooks: true }]
  }, 'claim-ledger reads are complete, authoritative, backend-only, and hook-free');

  const page2 = { items: [{ _id: 'event-2' }], hasNext: function() { return false; } };
  context.wixData = {
    query: function() {
      return {
        limit: function() { return this; },
        find: async function() {
          return {
            items: [{ _id: 'event-1' }],
            hasNext: function() { return true; },
            next: async function() { return page2; }
          };
        }
      };
    }
  };
  assertEqual(await context.adapter.loadRoomClaimLedger(), [
    { _id: 'event-1' },
    { _id: 'event-2' }
  ], 'claim-ledger reads aggregate every page in source order');

  context.wixData = {
    query: function() {
      return {
        limit: function() { return this; },
        find: async function() { return null; }
      };
    }
  };
  await assertRejects(
    function() { return context.adapter.loadRoomClaimLedger(); },
    'Claim ledger paging returned no page',
    'a missing first page fails closed instead of becoming an empty ledger'
  );

  context.wixData = {
    query: function() {
      return {
        limit: function() { return this; },
        find: async function() {
          return { items: {}, hasNext: function() { return false; } };
        }
      };
    }
  };
  await assertRejects(
    function() { return context.adapter.loadRoomClaimLedger(); },
    'Claim ledger paging result has invalid items',
    'non-array claim pages fail closed with a stable integrity error'
  );

  context.wixData = {
    query: function() {
      return {
        limit: function() { return this; },
        find: async function() {
          return {
            items: [{ _id: 'duplicate-event' }],
            hasNext: function() { return true; },
            next: async function() {
              return { items: [{ _id: 'duplicate-event' }], hasNext: function() { return false; } };
            }
          };
        }
      };
    }
  };
  await assertRejects(
    function() { return context.adapter.loadRoomClaimLedger(); },
    'Claim ledger contains duplicate event IDs',
    'duplicate event IDs across pages fail closed'
  );

  context.wixData = {
    query: function() {
      return {
        limit: function() { return this; },
        find: async function() { return { items: [] }; }
      };
    }
  };
  await assertRejects(
    function() { return context.adapter.loadRoomClaimLedger(); },
    'Claim ledger paging result is missing hasNext()',
    'claim pages without hasNext fail closed'
  );

  context.wixData = {
    query: function() {
      return {
        limit: function() { return this; },
        find: async function() {
          return { items: [], hasNext: function() { return true; } };
        }
      };
    }
  };
  await assertRejects(
    function() { return context.adapter.loadRoomClaimLedger(); },
    'Claim ledger paging result is missing next()',
    'claim pages that announce another page without next fail closed'
  );

  context.wixData = {
    query: function() {
      return {
        limit: function() { return this; },
        find: async function() {
          return {
            items: [{ _id: 'event-before-null-page' }],
            hasNext: function() { return true; },
            next: async function() { return null; }
          };
        }
      };
    }
  };
  await assertRejects(
    function() { return context.adapter.loadRoomClaimLedger(); },
    'Claim ledger paging returned no page',
    'a null later page fails closed instead of returning a partial ledger'
  );

  const repeatedPage = {
    items: [{ _id: 'event-on-repeated-page' }],
    hasNext: function() { return true; },
    next: async function() { return repeatedPage; }
  };
  context.wixData = {
    query: function() {
      return {
        limit: function() { return this; },
        find: async function() { return repeatedPage; }
      };
    }
  };
  await assertRejects(
    function() { return context.adapter.loadRoomClaimLedger(); },
    'Claim ledger paging repeated a page',
    'repeated Wix page objects fail closed before a paging cycle can continue'
  );

  const event = {
    _id: 'rc1-20271105-s1-000001-a',
    protocolVersion: 1,
    claimKey: 'capacity:2027-11-05:1',
    generation: 1,
    eventType: 'acquire',
    claimType: 'capacity',
    night: '2027-11-05',
    capacitySlot: 1,
    operationId: 'abcdefghijklmnopqrstuv',
    bookingRowId: 'pb1-abcdefghijklmnopqrstuv-r1',
    bookingNumber: 'WC-3001',
    payloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  };
  const operationEvent = {
    _id: 'rc1-op-abcdefghijklmnopqrstuv-a',
    protocolVersion: 1,
    claimKey: 'operation:abcdefghijklmnopqrstuv',
    generation: 1,
    eventType: 'acquire',
    claimType: 'operation',
    operationId: 'abcdefghijklmnopqrstuv',
    bookingRowId: 'pb1-abcdefghijklmnopqrstuv-r1',
    bookingNumber: 'WC-3001',
    payloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  };
  context.wixData = {
    insert: async function() { return { _id: operationEvent._id }; },
    get: async function() { return operationEvent; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([operationEvent]), {
    state: 'CONFIRMED',
    confirmed: [{ eventId: operationEvent._id, disposition: 'inserted' }]
  }, 'a permanent operation identity event is authoritatively persisted');

  let resourceOnlyWrites = 0;
  context.wixData = {
    insert: async function() { resourceOnlyWrites += 1; return event; },
    get: async function() { resourceOnlyWrites += 1; return event; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([event]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: event._id, classification: 'INTEGRITY' }
  }, 'resource acquisition requires its operation identity earlier in the batch');
  assertEqual(resourceOnlyWrites, 0,
    'resource-only acquisition fails before Wix persistence');

  let orphanCapacityWrites = 0;
  context.wixData = {
    insert: async function(collection, item) { orphanCapacityWrites += 1; return item; },
    get: async function(collection, id) { orphanCapacityWrites += 1; return id === operationEvent._id ? operationEvent : event; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([operationEvent, event]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: event._id, classification: 'INTEGRITY' }
  }, 'capacity acquisition requires a matching later unit acquisition');
  assertEqual(orphanCapacityWrites, 0, 'orphan capacity acquisition cannot reach Wix Data');

  const orphanUnitEvent = Object.assign({}, event, {
    _id: 'rc1-20271105-u5-000001-a',
    claimKey: 'unit:2027-11-05:5',
    claimType: 'unit',
    unit: 5
  });
  delete orphanUnitEvent.capacitySlot;
  let orphanUnitWrites = 0;
  context.wixData = {
    insert: async function(collection, item) { orphanUnitWrites += 1; return item; },
    get: async function(collection, id) { orphanUnitWrites += 1; return id === operationEvent._id ? operationEvent : orphanUnitEvent; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([operationEvent, orphanUnitEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: orphanUnitEvent._id, classification: 'INTEGRITY' }
  }, 'a unit acquisition without matching capacity fails whole-batch preflight');
  assertEqual(orphanUnitWrites, 0, 'orphan unit acquisition cannot reach Wix Data');

  let reorderedResourceWrites = 0;
  context.wixData = {
    insert: async function(collection, item) { reorderedResourceWrites += 1; return item; },
    get: async function(collection, id) { reorderedResourceWrites += 1; return id === operationEvent._id ? operationEvent : (id === event._id ? event : orphanUnitEvent); }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([operationEvent, orphanUnitEvent, event]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: orphanUnitEvent._id, classification: 'INTEGRITY' }
  }, 'unit acquisition cannot precede its matching capacity claim');
  assertEqual(reorderedResourceWrites, 0, 'reordered resource acquisition fails before Wix Data');

  const secondCapacity = Object.assign({}, event, {
    _id: 'rc1-20271105-s2-000001-a',
    claimKey: 'capacity:2027-11-05:2',
    capacitySlot: 2,
    bookingRowId: 'pb1-abcdefghijklmnopqrstuv-r2'
  });
  const secondUnit = Object.assign({}, orphanUnitEvent, {
    _id: 'rc1-20271105-u4-000001-a',
    claimKey: 'unit:2027-11-05:4',
    unit: 4,
    bookingRowId: secondCapacity.bookingRowId
  });
  const swappedFirstCapacity = Object.assign({}, event, {
    bookingRowId: secondCapacity.bookingRowId
  });
  const swappedSecondCapacity = Object.assign({}, secondCapacity, {
    bookingRowId: event.bookingRowId
  });
  let swappedCapacityWrites = 0;
  context.wixData = {
    insert: async function(collection, item) { swappedCapacityWrites += 1; return item; },
    get: async function(collection, id) { swappedCapacityWrites += 1; return null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    operationEvent,
    swappedFirstCapacity,
    swappedSecondCapacity,
    orphanUnitEvent,
    secondUnit
  ]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: swappedFirstCapacity._id, classification: 'INTEGRITY' }
  }, 'capacity slots cannot be swapped between deterministic booking rows');
  assertEqual(swappedCapacityWrites, 0, 'swapped capacity ownership fails before Wix Data');

  const descendingFirstUnit = Object.assign({}, orphanUnitEvent, {
    _id: 'rc1-20271105-u4-000001-a',
    claimKey: 'unit:2027-11-05:4',
    unit: 4
  });
  const descendingSecondUnit = Object.assign({}, orphanUnitEvent, {
    _id: 'rc1-20271105-u3-000001-a',
    claimKey: 'unit:2027-11-05:3',
    unit: 3,
    bookingRowId: secondCapacity.bookingRowId
  });
  let descendingUnitWrites = 0;
  context.wixData = {
    insert: async function(collection, item) { descendingUnitWrites += 1; return item; },
    get: async function(collection, id) {
      return [operationEvent, event, secondCapacity, descendingFirstUnit, descendingSecondUnit]
        .find(function(item) { return item._id === id; }) || null;
    }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    operationEvent,
    event,
    secondCapacity,
    descendingFirstUnit,
    descendingSecondUnit
  ]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: event._id, classification: 'INTEGRITY' }
  }, 'physical units must ascend with deterministic booking-row order');
  assertEqual(descendingUnitWrites, 0,
    'descending physical-unit order fails before Wix Data');

  const secondNightCapacity = Object.assign({}, event, {
    _id: 'rc1-20271106-s1-000001-a',
    claimKey: 'capacity:2027-11-06:1',
    night: '2027-11-06'
  });
  const secondNightUnit = Object.assign({}, orphanUnitEvent, {
    _id: 'rc1-20271106-u5-000001-a',
    claimKey: 'unit:2027-11-06:5',
    night: '2027-11-06'
  });
  let nightlyInterleavedWrites = 0;
  context.wixData = {
    insert: async function(collection, item) { nightlyInterleavedWrites += 1; return item; },
    get: async function(collection, id) {
      return [operationEvent, event, orphanUnitEvent, secondNightCapacity, secondNightUnit]
        .find(function(item) { return item._id === id; }) || null;
    }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    operationEvent,
    event,
    orphanUnitEvent,
    secondNightCapacity,
    secondNightUnit
  ]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 2, eventId: orphanUnitEvent._id, classification: 'INTEGRITY' }
  }, 'all capacity acquisitions across the stay must precede every unit acquisition');
  assertEqual(nightlyInterleavedWrites, 0,
    'globally interleaved acquisition topology fails before Wix Data');

  let identityOnlyRetryResourceWrites = 0;
  context.wixData = {
    insert: async function(collection, item) {
      if (item._id === operationEvent._id) throw new Error('already exists');
      identityOnlyRetryResourceWrites += 1;
      return item;
    },
    get: async function(collection, id) {
      if (id === operationEvent._id) return operationEvent;
      return null;
    }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    operationEvent,
    event,
    orphanUnitEvent
  ]), {
    state: 'STOPPED',
    confirmed: [{ eventId: operationEvent._id, disposition: 'already-present' }],
    failed: { index: 1, eventId: event._id, classification: 'INTEGRITY' }
  }, 'an existing identity cannot append missing resource acquisitions');
  assertEqual(identityOnlyRetryResourceWrites, 0,
    'identity-only retry reconciliation performs no resource writes');

  const completedRetryStore = new Map([
    operationEvent,
    event,
    orphanUnitEvent
  ].map(function(item) { return [item._id, item]; }));
  context.wixData = {
    insert: async function() { throw new Error('already exists'); },
    get: async function(collection, id) { return completedRetryStore.get(id) || null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    operationEvent,
    event,
    orphanUnitEvent
  ]), {
    state: 'CONFIRMED',
    confirmed: [
      { eventId: operationEvent._id, disposition: 'already-present' },
      { eventId: event._id, disposition: 'already-present' },
      { eventId: orphanUnitEvent._id, disposition: 'already-present' }
    ]
  }, 'an existing identity reconciles an entirely pre-existing exact batch');

  const competingOperation = Object.assign({}, operationEvent, {
    bookingNumber: 'WC-3002',
    payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  });
  const disjointResource = Object.assign({}, event, {
    _id: 'rc1-20271106-s1-000001-a',
    claimKey: 'capacity:2027-11-06:1',
    night: '2027-11-06',
    bookingNumber: competingOperation.bookingNumber,
    payloadDigest: competingOperation.payloadDigest
  });
  const disjointUnit = Object.assign({}, orphanUnitEvent, {
    _id: 'rc1-20271106-u4-000001-a',
    claimKey: 'unit:2027-11-06:4',
    night: '2027-11-06',
    unit: 4,
    bookingNumber: competingOperation.bookingNumber,
    payloadDigest: competingOperation.payloadDigest
  });
  const concurrentStore = new Map();
  context.wixData = {
    insert: async function(collection, item) {
      if (concurrentStore.has(item._id)) throw new Error('WDE0074');
      concurrentStore.set(item._id, Object.assign({}, item));
      return { _id: item._id };
    },
    get: async function(collection, id) {
      return concurrentStore.get(id) || null;
    }
  };
  const concurrentResults = await Promise.all([
    context.adapter.appendRoomClaimEvents([operationEvent, event, orphanUnitEvent]),
    context.adapter.appendRoomClaimEvents([competingOperation, disjointResource, disjointUnit])
  ]);
  assertEqual(concurrentResults, [{
    state: 'CONFIRMED',
    confirmed: [
      { eventId: operationEvent._id, disposition: 'inserted' },
      { eventId: event._id, disposition: 'inserted' },
      { eventId: orphanUnitEvent._id, disposition: 'inserted' }
    ]
  }, {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: competingOperation._id, classification: 'IDEMPOTENCY_CONFLICT' }
  }], 'concurrent disjoint batches serialize on the permanent operation identity');
  assertEqual(concurrentStore.has(disjointResource._id), false,
    'the losing operation cannot persist a disjoint resource claim');

  function capacityRaceBatch(ownerNumber, slot, unit) {
    const operationId = 'capacityowner000' + ownerNumber;
    const bookingNumber = 'WC-CAPACITY-' + ownerNumber;
    const payloadDigest = String(ownerNumber).repeat(64);
    const bookingRowId = 'pb1-' + operationId + '-r1';
    return [{
      _id: 'rc1-op-' + operationId + '-a',
      protocolVersion: 1,
      claimKey: 'operation:' + operationId,
      generation: 1,
      eventType: 'acquire',
      claimType: 'operation',
      operationId: operationId,
      bookingRowId: bookingRowId,
      bookingNumber: bookingNumber,
      payloadDigest: payloadDigest
    }, {
      _id: 'rc1-20271108-s' + slot + '-000001-a',
      protocolVersion: 1,
      claimKey: 'capacity:2027-11-08:' + slot,
      generation: 1,
      eventType: 'acquire',
      claimType: 'capacity',
      night: '2027-11-08',
      capacitySlot: slot,
      operationId: operationId,
      bookingRowId: bookingRowId,
      bookingNumber: bookingNumber,
      payloadDigest: payloadDigest
    }, {
      _id: 'rc1-20271108-u' + unit + '-000001-a',
      protocolVersion: 1,
      claimKey: 'unit:2027-11-08:' + unit,
      generation: 1,
      eventType: 'acquire',
      claimType: 'unit',
      night: '2027-11-08',
      unit: unit,
      operationId: operationId,
      bookingRowId: bookingRowId,
      bookingNumber: bookingNumber,
      payloadDigest: payloadDigest
    }];
  }
  const capacityRaceStore = new Map();
  context.wixData = {
    insert: async function(collection, item) {
      if (capacityRaceStore.has(item._id)) throw new Error('WDE0074');
      capacityRaceStore.set(item._id, Object.assign({}, item));
      return { _id: item._id };
    },
    get: async function(collection, id) { return capacityRaceStore.get(id) || null; }
  };
  const capacityRaceBatches = [
    capacityRaceBatch(1, 1, 1),
    capacityRaceBatch(2, 2, 2),
    capacityRaceBatch(3, 3, 3),
    capacityRaceBatch(4, 4, 4),
    capacityRaceBatch(5, 1, 5)
  ];
  const capacityRaceResults = await Promise.all(capacityRaceBatches.map(function(batch) {
    return context.adapter.appendRoomClaimEvents(batch);
  }));
  assertEqual(capacityRaceResults.map(function(result) { return result.state; }),
    ['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'STOPPED'],
    'four capacity owners confirm while a fifth distinct-unit contender fails closed');
  assertEqual(capacityRaceResults[4].failed, {
    index: 1,
    eventId: 'rc1-20271108-s1-000001-a',
    classification: 'CONTENTION'
  }, 'the fifth contender stops at capacity before its physical-unit claim');
  assertEqual(capacityRaceStore.has('rc1-20271108-u5-000001-a'), false,
    'owner-reserve contention prevents the fifth unit claim from being written');

  async function appendResources(resourceEvents) {
    const resourceWixData = context.wixData;
    const syntheticUnits = [];
    resourceEvents.forEach(function(resource) {
      if (!resource || resource.claimType !== 'capacity' || resource.eventType !== 'acquire') return;
      const hasUnit = resourceEvents.some(function(candidate) {
        return candidate && candidate.claimType === 'unit' && candidate.eventType === 'acquire' &&
          candidate.night === resource.night && candidate.operationId === resource.operationId &&
          candidate.bookingRowId === resource.bookingRowId &&
          candidate.bookingNumber === resource.bookingNumber &&
          candidate.payloadDigest === resource.payloadDigest;
      });
      if (hasUnit) return;
      const synthetic = Object.assign({}, resource, {
        _id: 'rc1-' + resource.night.replace(/-/g, '') + '-u5-' +
          String(resource.generation).padStart(6, '0') + '-a',
        claimKey: 'unit:' + resource.night + ':5',
        claimType: 'unit',
        unit: 5
      });
      delete synthetic.capacitySlot;
      syntheticUnits.push(synthetic);
    });
    const syntheticById = Object.create(null);
    syntheticUnits.forEach(function(item) { syntheticById[item._id] = item; });
    context.wixData = {
      insert: async function(collection, item, options) {
        if (item._id === operationEvent._id || syntheticById[item._id]) return { _id: item._id };
        return resourceWixData.insert(collection, item, options);
      },
      get: async function(collection, id, options) {
        if (id === operationEvent._id) return operationEvent;
        if (syntheticById[id]) return syntheticById[id];
        return resourceWixData.get(collection, id, options);
      }
    };
    try {
      const result = await context.adapter.appendRoomClaimEvents(
        [operationEvent].concat(resourceEvents, syntheticUnits)
      );
      result.confirmed = result.confirmed.filter(function(item) {
        return item.eventId !== operationEvent._id && !syntheticById[item.eventId];
      });
      if (result.failed) result.failed.index -= 1;
      return result;
    } finally {
      context.wixData = resourceWixData;
    }
  }

  const writeCalls = { inserts: [], gets: [] };
  context.wixData = {
    insert: async function(collection, item, options) {
      writeCalls.inserts.push({ collection, item, options });
      return { _id: 'misleading-return' };
    },
    get: async function(collection, id, options) {
      writeCalls.gets.push({ collection, id, options });
      return Object.assign({ _createdDate: 'system-field' }, event);
    }
  };
  assertEqual(await appendResources([event]), {
    state: 'CONFIRMED',
    confirmed: [{ eventId: event._id, disposition: 'inserted' }]
  }, 'a resolved insert is confirmed only by authoritative matching read-back');
  assertEqual(writeCalls, {
    inserts: [{
      collection: 'RoomBookingClaimEvents',
      item: event,
      options: { suppressAuth: true, suppressHooks: true }
    }],
    gets: [{
      collection: 'RoomBookingClaimEvents',
      id: event._id,
      options: { suppressAuth: true, consistentRead: true, suppressHooks: true }
    }]
  }, 'claim events insert sequentially with hooks suppressed and reconcile through strong reads');

  context.wixData = {
    insert: async function() { throw new Error('WDE0074'); },
    get: async function() { return Object.assign({ _owner: 'system' }, event); }
  };
  assertEqual(await appendResources([event]), {
    state: 'CONFIRMED',
    confirmed: [{ eventId: event._id, disposition: 'already-present' }]
  }, 'an exact existing event makes a rejected insert an idempotent success');

  const competingEvent = Object.assign({}, event, {
    operationId: 'competitor-operation-0001',
    bookingRowId: 'pb1-competitor-operation-0001-r1',
    bookingNumber: 'WC-3999',
    payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  });
  context.wixData = {
    insert: async function() { throw new Error('WDE0074'); },
    get: async function() { return competingEvent; }
  };
  assertEqual(await appendResources([event]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: event._id, classification: 'CONTENTION' }
  }, 'a different valid acquire owner at the deterministic ID is contention');

  const conflictingRetry = Object.assign({}, event, {
    payloadDigest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  });
  context.wixData = {
    insert: async function() { throw new Error('WDE0074'); },
    get: async function() { return conflictingRetry; }
  };
  assertEqual(await appendResources([event]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: event._id, classification: 'IDEMPOTENCY_CONFLICT' }
  }, 'the same operation ID with a different canonical digest is an idempotency conflict');

  const conflictingBookingRetry = Object.assign({}, event, {
    bookingNumber: 'WC-DIFFERENT-RETRY'
  });
  context.wixData = {
    insert: async function() { throw new Error('WDE0074'); },
    get: async function() { return conflictingBookingRetry; }
  };
  assertEqual(await appendResources([event]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: event._id, classification: 'IDEMPOTENCY_CONFLICT' }
  }, 'the same operation ID with a different booking number is an idempotency conflict');

  context.wixData = {
    insert: async function() { return { _id: event._id }; },
    get: async function() { return null; }
  };
  assertEqual(await appendResources([event]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: event._id, classification: 'UNRESOLVED' }
  }, 'a missing authoritative read-back is unresolved even when insert resolved');

  context.wixData = {
    insert: async function() { throw new Error('insert timeout'); },
    get: async function() { throw new Error('read timeout'); }
  };
  assertEqual(await appendResources([event]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: event._id, classification: 'UNRESOLVED' }
  }, 'a rejected authoritative read-back is unresolved after an ambiguous insert');

  const unitEvent = Object.assign({}, event, {
    _id: 'rc1-20271105-u3-000001-a',
    claimKey: 'unit:2027-11-05:3',
    claimType: 'unit',
    unit: 3
  });
  delete unitEvent.capacitySlot;
  const laterEvent = Object.assign({}, event, {
    _id: 'rc1-20271105-s2-000001-a',
    claimKey: 'capacity:2027-11-05:2',
    capacitySlot: 2,
    bookingRowId: 'pb1-abcdefghijklmnopqrstuv-r2'
  });
  const laterUnitEvent = Object.assign({}, unitEvent, {
    _id: 'rc1-20271105-u4-000001-a',
    claimKey: 'unit:2027-11-05:4',
    unit: 4,
    bookingRowId: laterEvent.bookingRowId
  });
  const competingUnitEvent = Object.assign({}, unitEvent, {
    operationId: 'competitor-operation-0001',
    bookingRowId: 'pb1-competitor-operation-0001-r1',
    bookingNumber: 'WC-3999',
    payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  });
  const partialCalls = { inserts: [], gets: [] };
  context.wixData = {
    insert: async function(collection, item) {
      partialCalls.inserts.push(item._id);
      return { _id: item._id };
    },
    get: async function(collection, id) {
      partialCalls.gets.push(id);
      if (id === event._id) return event;
      if (id === laterEvent._id) return laterEvent;
      if (id === unitEvent._id) return competingUnitEvent;
      throw new Error('later event must not be read');
    }
  };
  assertEqual(await appendResources([event, laterEvent, unitEvent, laterUnitEvent]), {
    state: 'STOPPED',
    confirmed: [
      { eventId: event._id, disposition: 'inserted' },
      { eventId: laterEvent._id, disposition: 'inserted' }
    ],
    failed: { index: 2, eventId: unitEvent._id, classification: 'CONTENTION' }
  }, 'partial acquisition stops at first contention and returns only the confirmed prefix');
  assertEqual(partialCalls, {
    inserts: [event._id, laterEvent._id, unitEvent._id],
    gets: [event._id, laterEvent._id, unitEvent._id]
  }, 'no event after the first unconfirmed acquisition is written or read');

  let recoveryStep = 0;
  context.wixData = {
    insert: async function() {
      recoveryStep += 1;
      throw new Error(recoveryStep === 1 ? 'already exists' : 'insert timeout');
    },
    get: async function(collection, id) {
      if (id === event._id) return event;
      throw new Error('read timeout');
    }
  };
  assertEqual(await appendResources([event, unitEvent]), {
    state: 'STOPPED',
    confirmed: [{ eventId: event._id, disposition: 'already-present' }],
    failed: { index: 1, eventId: unitEvent._id, classification: 'UNRESOLVED' }
  }, 'an unresolved partial acquisition retains its confirmed prefix for recovery handling');

  const releaseEvent = Object.assign({}, event, {
    _id: 'rc1-20271105-s1-000001-r',
    eventType: 'release',
    releaseReason: 'booking-row-write-failed'
  });
  const missingIdentityCalls = { inserts: 0, gets: [] };
  context.wixData = {
    insert: async function() { missingIdentityCalls.inserts += 1; return releaseEvent; },
    get: async function(collection, id) { missingIdentityCalls.gets.push(id); return null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([releaseEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: releaseEvent._id, classification: 'INTEGRITY' }
  }, 'compensation requires the permanent operation identity');
  assertEqual(missingIdentityCalls, {
    inserts: 0,
    gets: [operationEvent._id]
  }, 'missing operation identity stops compensation before acquire lookup');

  async function appendReleases(releaseEvents) {
    const releaseWixData = context.wixData;
    const owner = releaseEvents[0];
    const releaseIdentity = {
      _id: 'rc1-op-' + owner.operationId + '-a',
      protocolVersion: 1,
      claimKey: 'operation:' + owner.operationId,
      generation: 1,
      eventType: 'acquire',
      claimType: 'operation',
      operationId: owner.operationId,
      bookingRowId: 'pb1-' + owner.operationId + '-r1',
      bookingNumber: owner.bookingNumber,
      payloadDigest: owner.payloadDigest
    };
    context.wixData = {
      insert: function(collection, item, options) {
        return releaseWixData.insert(collection, item, options);
      },
      get: async function(collection, id, options) {
        if (id === releaseIdentity._id) return releaseIdentity;
        return releaseWixData.get(collection, id, options);
      }
    };
    try {
      return await context.adapter.appendRoomClaimEvents(releaseEvents);
    } finally {
      context.wixData = releaseWixData;
    }
  }

  const missingAcquireCalls = { inserts: 0, gets: [] };
  context.wixData = {
    insert: async function() { missingAcquireCalls.inserts += 1; return releaseEvent; },
    get: async function(collection, id) { missingAcquireCalls.gets.push(id); return null; }
  };
  assertEqual(await appendReleases([releaseEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: releaseEvent._id, classification: 'INTEGRITY' }
  }, 'a compensation release requires an existing authoritative acquire');
  assertEqual(missingAcquireCalls, {
    inserts: 0,
    gets: [event._id]
  }, 'a missing acquire prevents release insertion');

  let unreadableAcquireInserts = 0;
  context.wixData = {
    insert: async function() { unreadableAcquireInserts += 1; return releaseEvent; },
    get: async function() { throw new Error('acquire read timeout'); }
  };
  assertEqual(await appendReleases([releaseEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: releaseEvent._id, classification: 'UNRESOLVED' }
  }, 'an unreadable acquire leaves compensation unresolved');
  assertEqual(unreadableAcquireInserts, 0,
    'acquire-read uncertainty prevents release insertion');

  context.wixData = {
    insert: async function() { return { _id: releaseEvent._id }; },
    get: async function(collection, id) {
      if (id === event._id) return Object.assign({ _createdDate: 'system-field' }, event);
      return Object.assign({ _createdDate: 'system-field' }, releaseEvent);
    }
  };
  assertEqual(await appendReleases([releaseEvent]), {
    state: 'CONFIRMED',
    confirmed: [{ eventId: releaseEvent._id, disposition: 'inserted' }]
  }, 'append-only compensation releases are confirmed through authoritative read-back');

  const foreignRelease = Object.assign({}, releaseEvent, {
    operationId: 'competitor-operation-0001',
    bookingRowId: 'pb1-competitor-operation-0001-r1',
    bookingNumber: 'WC-3999',
    payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  });
  const foreignAcquire = Object.assign({}, foreignRelease, {
    _id: event._id,
    eventType: 'acquire'
  });
  delete foreignAcquire.releaseReason;
  let foreignReleaseInserts = 0;
  context.wixData = {
    insert: async function() { foreignReleaseInserts += 1; throw new Error('must not insert'); },
    get: async function() { return foreignAcquire; }
  };
  assertEqual(await appendReleases([releaseEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: releaseEvent._id, classification: 'INTEGRITY' }
  }, 'a release whose acquire belongs to a different operation fails before persistence');
  assertEqual(foreignReleaseInserts, 0,
    'mismatched acquire ownership prevents release insertion');

  context.wixData = {
    insert: async function() { throw new Error('already exists'); },
    get: async function(collection, id) {
      return id === event._id ? event : releaseEvent;
    }
  };
  assertEqual(await appendReleases([releaseEvent]), {
    state: 'CONFIRMED',
    confirmed: [{ eventId: releaseEvent._id, disposition: 'already-present' }]
  }, 'an exact release retry remains idempotent after acquire provenance is verified');

  const malformedEvent = Object.assign({}, event, { protocolVersion: 2 });
  const malformedCalls = { inserts: 0, gets: 0 };
  context.wixData = {
    insert: async function() { malformedCalls.inserts += 1; return malformedEvent; },
    get: async function() { malformedCalls.gets += 1; return malformedEvent; }
  };
  assertEqual(await appendResources([malformedEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: malformedEvent._id, classification: 'INTEGRITY' }
  }, 'a malformed requested event is rejected before persistence');
  assertEqual(malformedCalls, { inserts: 0, gets: 0 },
    'invalid claim events cannot reach Wix insert or read-back');

  const lateMalformedCalls = { inserts: 0, gets: 0 };
  context.wixData = {
    insert: async function() { lateMalformedCalls.inserts += 1; return event; },
    get: async function() { lateMalformedCalls.gets += 1; return event; }
  };
  assertEqual(await appendResources([event, malformedEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: malformedEvent._id, classification: 'INTEGRITY' }
  }, 'a malformed later event fails whole-batch preflight before partial persistence');
  assertEqual(lateMalformedCalls, { inserts: 0, gets: 0 },
    'whole-batch validation completes before the first claim insert');

  const conflictingBatchEvent = Object.assign({}, laterEvent, {
    payloadDigest: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
  });
  const conflictingBatchCalls = { inserts: 0, gets: 0 };
  context.wixData = {
    insert: async function() { conflictingBatchCalls.inserts += 1; return event; },
    get: async function() { conflictingBatchCalls.gets += 1; return event; }
  };
  assertEqual(await appendResources([event, conflictingBatchEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: conflictingBatchEvent._id, classification: 'IDEMPOTENCY_CONFLICT' }
  }, 'one batch cannot reuse an operation ID with a different payload digest');
  assertEqual(conflictingBatchCalls, { inserts: 0, gets: 0 },
    'operation-level idempotency preflight completes before persistence');

  const foreignBookingBatchEvent = Object.assign({}, laterEvent, {
    bookingNumber: 'WC-OTHER'
  });
  const foreignBookingBatchCalls = { inserts: 0, gets: 0 };
  context.wixData = {
    insert: async function() { foreignBookingBatchCalls.inserts += 1; return event; },
    get: async function() { foreignBookingBatchCalls.gets += 1; return event; }
  };
  assertEqual(await appendResources([event, foreignBookingBatchEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: foreignBookingBatchEvent._id, classification: 'IDEMPOTENCY_CONFLICT' }
  }, 'one batch cannot reuse an operation ID with a different booking number');
  assertEqual(foreignBookingBatchCalls, { inserts: 0, gets: 0 },
    'booking-ownership preflight completes before persistence');

  const duplicateBatchCalls = { inserts: 0, gets: 0 };
  context.wixData = {
    insert: async function() { duplicateBatchCalls.inserts += 1; return event; },
    get: async function() { duplicateBatchCalls.gets += 1; return event; }
  };
  assertEqual(await appendResources([event, Object.assign({}, event)]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: event._id, classification: 'INTEGRITY' }
  }, 'duplicate deterministic event IDs fail whole-batch preflight');
  assertEqual(duplicateBatchCalls, { inserts: 0, gets: 0 },
    'duplicate-event preflight completes before persistence');

  const reasonlessRelease = Object.assign({}, releaseEvent);
  delete reasonlessRelease.releaseReason;
  context.wixData = {
    insert: async function() { throw new Error('reasonless release must not be written'); },
    get: async function() { throw new Error('reasonless release must not be read'); }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([reasonlessRelease]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: reasonlessRelease._id, classification: 'INTEGRITY' }
  }, 'the adapter rejects a compensation release without an auditable reason');

  const overlongRelease = Object.assign({}, releaseEvent, { releaseReason: 'x'.repeat(257) });
  let overlongReleaseIo = 0;
  context.wixData = {
    insert: async function() { overlongReleaseIo += 1; return overlongRelease; },
    get: async function() { overlongReleaseIo += 1; return event; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([overlongRelease]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: overlongRelease._id, classification: 'INTEGRITY' }
  }, 'overlong compensation reasons fail local schema preflight');
  assertEqual(overlongReleaseIo, 0, 'overlong compensation reasons cannot reach Wix Data');

  context.wixData = {
    insert: async function() { return { _id: event._id }; },
    get: async function() { return Object.assign({}, event, { releaseReason: 'forged' }); }
  };
  assertEqual(await appendResources([event]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: event._id, classification: 'INTEGRITY' }
  }, 'an acquire carrying a release-only field cannot be confirmed by one-sided matching');

  context.wixData = {
    insert: async function() { return {}; },
    get: async function() { return Object.assign({}, event, { shadowOwner: 'unexpected' }); }
  };
  assertEqual(await appendResources([event]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: event._id, classification: 'INTEGRITY' }
  }, 'unexpected stored business fields invalidate exact authoritative read-back');

  const requestedWithUnexpectedField = Object.assign({}, event, { shadowOwner: 'unexpected' });
  assertEqual(await appendResources([requestedWithUnexpectedField]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: event._id, classification: 'INTEGRITY' }
  }, 'unexpected requested business fields fail local schema preflight');

  const arrayEvent = [];
  Object.assign(arrayEvent, event);
  let arrayEventWrites = 0;
  context.wixData = {
    insert: async function() { arrayEventWrites += 1; return event; },
    get: async function() { return event; }
  };
  assertEqual(await appendResources([arrayEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: event._id, classification: 'INTEGRITY' }
  }, 'array-shaped claim events fail local schema preflight');
  assertEqual(arrayEventWrites, 0, 'array-shaped claim events cannot reach persistence');

  const generationTwoCapacity = Object.assign({}, event, {
    _id: 'rc1-20271105-s1-000002-a',
    generation: 2
  });
  const generationTwoUnit = Object.assign({}, orphanUnitEvent, {
    _id: 'rc1-20271105-u5-000002-a',
    generation: 2
  });
  let generationGapWrites = 0;
  let generationGapReads = 0;
  context.wixData = {
    query: function() {
      generationGapReads += 1;
      return {
        limit: function() { return this; },
        find: async function() {
          return { items: [], hasNext: function() { return false; } };
        }
      };
    },
    insert: async function() { generationGapWrites += 1; return {}; },
    get: async function() { generationGapReads += 1; return null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    operationEvent,
    generationTwoCapacity,
    generationTwoUnit
  ]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: generationTwoCapacity._id, classification: 'INTEGRITY' }
  }, 'generation-two acquisitions require a complete released generation-one history');
  assertEqual({ writes: generationGapWrites, reads: generationGapReads }, { writes: 0, reads: 1 },
    'generation-gap validation completes from the authoritative ledger before persistence');

  const priorOperation = Object.assign({}, operationEvent, {
    _id: 'rc1-op-priorgenerationop01-a',
    claimKey: 'operation:priorgenerationop01',
    operationId: 'priorgenerationop01',
    bookingRowId: 'pb1-priorgenerationop01-r1',
    bookingNumber: 'WC-PRIOR',
    payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  });
  function priorOwner(eventToCopy) {
    return Object.assign({}, eventToCopy, {
      generation: 1,
      _id: eventToCopy._id.replace('-000002-a', '-000001-a'),
      operationId: priorOperation.operationId,
      bookingRowId: priorOperation.bookingRowId,
      bookingNumber: priorOperation.bookingNumber,
      payloadDigest: priorOperation.payloadDigest
    });
  }
  const priorCapacity = priorOwner(generationTwoCapacity);
  const priorUnit = priorOwner(generationTwoUnit);
  const priorCapacityRelease = Object.assign({}, priorCapacity, {
    _id: priorCapacity._id.slice(0, -1) + 'r',
    eventType: 'release',
    releaseReason: 'prior-booking-rollback'
  });
  const priorUnitRelease = Object.assign({}, priorUnit, {
    _id: priorUnit._id.slice(0, -1) + 'r',
    eventType: 'release',
    releaseReason: 'prior-booking-rollback'
  });
  const validGenerationStore = new Map([
    priorOperation,
    priorCapacity,
    priorCapacityRelease,
    priorUnit,
    priorUnitRelease
  ].map(function(item) { return [item._id, item]; }));
  let validGenerationWrites = 0;
  context.wixData = {
    query: function() {
      return {
        limit: function() { return this; },
        find: async function() {
          return {
            items: Array.from(validGenerationStore.values()),
            hasNext: function() { return false; }
          };
        }
      };
    },
    insert: async function(collection, item) {
      validGenerationWrites += 1;
      validGenerationStore.set(item._id, item);
      return item;
    },
    get: async function(collection, id) { return validGenerationStore.get(id) || null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    operationEvent,
    generationTwoCapacity,
    generationTwoUnit
  ]), {
    state: 'CONFIRMED',
    confirmed: [
      { eventId: operationEvent._id, disposition: 'inserted' },
      { eventId: generationTwoCapacity._id, disposition: 'inserted' },
      { eventId: generationTwoUnit._id, disposition: 'inserted' }
    ]
  }, 'a complete released prior generation permits the next append-only acquisition');
  assertEqual(validGenerationWrites, 3, 'valid generation history is checked before sequential persistence');

  let uncertainGenerationWrites = 0;
  context.wixData = {
    query: function() { throw new Error('ledger unavailable'); },
    insert: async function() { uncertainGenerationWrites += 1; return {}; },
    get: async function() { return null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    operationEvent,
    generationTwoCapacity,
    generationTwoUnit
  ]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: generationTwoCapacity._id, classification: 'UNRESOLVED' }
  }, 'generation-history read uncertainty fails closed');
  assertEqual(uncertainGenerationWrites, 0, 'uncertain generation history cannot reach persistence');

  const overflowGenerationEvent = Object.assign({}, generationTwoCapacity, {
    _id: 'rc1-20271105-s1-1000000-a',
    generation: 1000000
  });
  let overflowGenerationIo = 0;
  context.wixData = {
    insert: async function() { overflowGenerationIo += 1; return overflowGenerationEvent; },
    get: async function() { overflowGenerationIo += 1; return overflowGenerationEvent; }
  };
  assertEqual(await appendResources([overflowGenerationEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: overflowGenerationEvent._id, classification: 'INTEGRITY' }
  }, 'claim generations above six digits fail local schema preflight');
  assertEqual(overflowGenerationIo, 0, 'overflow claim generations cannot reach Wix Data');

  await assertRejects(
    function() { return context.adapter.appendRoomClaimEvents(null); },
    'Invalid claim event batch',
    'non-array claim-event batches fail closed with a stable error'
  );
})().catch(function(error) {
  console.error(error.stack || error);
  process.exit(1);
});
