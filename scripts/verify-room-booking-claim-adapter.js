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
  + '\nthis.adapter = { loadRoomClaimLedger, appendRoomClaimEvents: typeof appendRoomClaimEvents === "function" ? appendRoomClaimEvents : null, appendRoomOperationDecision: typeof appendRoomOperationDecision === "function" ? appendRoomOperationDecision : null };';

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
    payloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    decisionFenceVersion: 1,
    manifestVersion: 1,
    manifestCheckIn: '2027-11-05',
    manifestCheckOut: '2027-11-06',
    manifestRoomCode: 'adventure_suite',
    manifestUnits: '3',
    manifestBookingRowIds: 'pb1-abcdefghijklmnopqrstuv-r1',
    manifestResourceClaimIds: 'rc1-20271105-s1-000001-a|rc1-20271105-u3-000001-a'
  };

  function buildManifestBatch(operationId, checkIn, checkOut, units) {
    const nights = [];
    for (let day = new Date(checkIn + 'T00:00:00.000Z');
      day < new Date(checkOut + 'T00:00:00.000Z');
      day.setUTCDate(day.getUTCDate() + 1)) {
      nights.push(day.toISOString().slice(0, 10));
    }
    const bookingNumber = 'WC-' + operationId;
    const payloadDigest = 'd'.repeat(64);
    const rowIds = units.map(function(unit, index) {
      return 'pb1-' + operationId + '-r' + (index + 1);
    });
    const capacities = [];
    const unitEvents = [];
    nights.forEach(function(night) {
      units.forEach(function(unit, index) {
        const slot = index + 1;
        capacities.push({
          _id: 'rc1-' + night.replace(/-/g, '') + '-s' + slot + '-000001-a',
          protocolVersion: 1,
          claimKey: 'capacity:' + night + ':' + slot,
          generation: 1,
          eventType: 'acquire',
          claimType: 'capacity',
          night: night,
          capacitySlot: slot,
          operationId: operationId,
          bookingRowId: rowIds[index],
          bookingNumber: bookingNumber,
          payloadDigest: payloadDigest
        });
        unitEvents.push({
          _id: 'rc1-' + night.replace(/-/g, '') + '-u' + unit + '-000001-a',
          protocolVersion: 1,
          claimKey: 'unit:' + night + ':' + unit,
          generation: 1,
          eventType: 'acquire',
          claimType: 'unit',
          night: night,
          unit: unit,
          operationId: operationId,
          bookingRowId: rowIds[index],
          bookingNumber: bookingNumber,
          payloadDigest: payloadDigest
        });
      });
    });
    const resources = capacities.concat(unitEvents);
    return [
      {
        _id: 'rc1-op-' + operationId + '-a',
        protocolVersion: 1,
        claimKey: 'operation:' + operationId,
        generation: 1,
        eventType: 'acquire',
        claimType: 'operation',
        operationId: operationId,
        bookingRowId: rowIds[0],
        bookingNumber: bookingNumber,
        payloadDigest: payloadDigest,
        manifestVersion: 1,
        manifestCheckIn: checkIn,
        manifestCheckOut: checkOut,
        manifestRoomCode: 'adventure_suite',
        manifestUnits: units.join(','),
        manifestBookingRowIds: rowIds.join('|'),
        manifestResourceClaimIds: resources.map(function(event) { return event._id; }).join('|')
      }
    ].concat(resources);
  }

  for (const noncanonicalUnits of ['03', '+3', '3e0', '0x3', ' 3', '3 ', '3,']) {
    let manifestEncodingIo = 0;
    context.wixData = {
      insert: async function() { manifestEncodingIo += 1; return {}; },
      get: async function() { manifestEncodingIo += 1; return null; }
    };
    const noncanonicalIdentity = Object.assign({}, operationEvent, {
      manifestUnits: noncanonicalUnits
    });
    assertEqual(await context.adapter.appendRoomClaimEvents([noncanonicalIdentity]), {
      state: 'STOPPED',
      confirmed: [],
      failed: { index: 0, eventId: operationEvent._id, classification: 'INTEGRITY' }
    }, 'operation manifest rejects noncanonical unit encoding ' + JSON.stringify(noncanonicalUnits));
    assertEqual(manifestEncodingIo, 0,
      'noncanonical unit encoding cannot reach Wix persistence');
  }

  const malformedManifests = [
    ['missing version', function(identity) { delete identity.manifestVersion; }],
    ['impossible check-in', function(identity) { identity.manifestCheckIn = '2027-02-30'; }],
    ['reversed dates', function(identity) { identity.manifestCheckOut = '2027-11-04'; }],
    ['ten-thousand-year date range', function(identity) {
      identity.manifestCheckIn = '0000-01-01';
      identity.manifestCheckOut = '9999-12-31';
    }],
    ['unknown room code', function(identity) { identity.manifestRoomCode = 'unknown_room'; }],
    ['descending units', function(identity) { identity.manifestUnits = '4,3'; }],
    ['malformed booking-row IDs', function(identity) { identity.manifestBookingRowIds = 'row-1'; }],
    ['missing resource claim', function(identity) {
      identity.manifestResourceClaimIds = 'rc1-20271105-s1-000001-a';
    }],
    ['duplicate resource claims', function(identity) {
      identity.manifestResourceClaimIds =
        'rc1-20271105-s1-000001-a|rc1-20271105-s1-000001-a';
    }],
    ['zero claim generation', function(identity) {
      identity.manifestResourceClaimIds =
        'rc1-20271105-s1-000000-a|rc1-20271105-u3-000001-a';
    }],
    ['overflow claim generation', function(identity) {
      identity.manifestResourceClaimIds =
        'rc1-20271105-s1-1000000-a|rc1-20271105-u3-000001-a';
    }]
  ];
  for (const malformedManifest of malformedManifests) {
    let malformedManifestIo = 0;
    const identity = Object.assign({}, operationEvent);
    malformedManifest[1](identity);
    context.wixData = {
      insert: async function() { malformedManifestIo += 1; return {}; },
      get: async function() { malformedManifestIo += 1; return null; }
    };
    assertEqual(await context.adapter.appendRoomClaimEvents([identity]), {
      state: 'STOPPED',
      confirmed: [],
      failed: { index: 0, eventId: operationEvent._id, classification: 'INTEGRITY' }
    }, 'operation manifest rejects ' + malformedManifest[0]);
    assertEqual(malformedManifestIo, 0,
      malformedManifest[0] + ' manifest cannot reach Wix persistence');
  }

  async function confirmManifestBatch(batch, message) {
    const store = new Map();
    let writes = 0;
    context.wixData = {
      insert: async function(collection, item) {
        writes += 1;
        store.set(item._id, Object.assign({}, item));
        return item;
      },
      get: async function(collection, id) { return store.get(id) || null; }
    };
    const result = await context.adapter.appendRoomClaimEvents(batch);
    assertEqual({
      state: result.state,
      confirmed: result.confirmed.length,
      writes: writes,
      completionFence: store.has('rc1-op-' + batch[0].operationId + '-c')
    }, {
      state: 'CONFIRMED', confirmed: batch.length, writes: batch.length + 1, completionFence: true
    }, message);
  }

  const multiNightBatch = buildManifestBatch(
    'multinightmanifest01', '2027-11-05', '2027-11-07', [3, 4]);
  await confirmManifestBatch(multiNightBatch,
    'adapter confirms a canonical two-row two-night globally ordered manifest batch');

  const markedBatch = buildManifestBatch(
    'decisionfencecomplete1', '2027-11-05', '2027-11-06', [3]);
  markedBatch[0].decisionFenceVersion = 1;
  const markedStore = new Map();
  context.wixData = {
    insert: async function(collection, item) {
      markedStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: async function(collection, id) { return markedStore.get(id) || null; }
  };
  const markedResult = await context.adapter.appendRoomClaimEvents(markedBatch);
  assertEqual({
    state: markedResult.state,
    completionMarker: markedStore.get('rc1-op-decisionfencecomplete1-c') &&
      markedStore.get('rc1-op-decisionfencecomplete1-c').decisionFenceVersion,
    decisionPresent: markedStore.has('rc1-op-decisionfencecomplete1-d'),
    resourceMarkers: markedBatch.slice(1).filter(function(item) {
      return Object.prototype.hasOwnProperty.call(item, 'decisionFenceVersion');
    }).length
  }, { state: 'CONFIRMED', completionMarker: 1, decisionPresent: false, resourceMarkers: 0 },
  'an acquisition-only batch records no operation decision');

  const markedResourceBatch = buildManifestBatch(
    'resourcefencerejected1', '2027-11-05', '2027-11-06', [3]);
  Object.defineProperty(markedResourceBatch[1], 'decisionFenceVersion', {
    value: undefined, writable: true, enumerable: true, configurable: true
  });
  let markedResourceIo = 0;
  context.wixData = {
    insert: async function() { markedResourceIo += 1; return {}; },
    get: async function() { markedResourceIo += 1; return null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents(markedResourceBatch), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: markedResourceBatch[1]._id, classification: 'INTEGRITY' }
  }, 'resource events reject decision fence marker field presence');
  assertEqual(markedResourceIo, 0,
    'resource decision fence markers fail before Wix persistence');

  const markedStoppedBatch = buildManifestBatch(
    'decisionfencestopped1', '2027-11-05', '2027-11-06', [3]);
  markedStoppedBatch[0].decisionFenceVersion = 1;
  const markedStoppedStore = new Map();
  markedStoppedStore.set(markedStoppedBatch[2]._id, Object.assign({}, markedStoppedBatch[2], {
    operationId: 'foreignstoppedowner1',
    bookingRowId: 'pb1-foreignstoppedowner1-r1',
    bookingNumber: 'WC-FOREIGN-STOPPED',
    payloadDigest: '9'.repeat(64)
  }));
  context.wixData = {
    insert: async function(collection, item) {
      if (markedStoppedStore.has(item._id)) throw new Error('WDE0074');
      markedStoppedStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: async function(collection, id) { return markedStoppedStore.get(id) || null; }
  };
  const markedStoppedResult = await context.adapter.appendRoomClaimEvents(markedStoppedBatch);
  assertEqual({
    state: markedStoppedResult.state,
    classification: markedStoppedResult.failed && markedStoppedResult.failed.classification,
    completionState: markedStoppedStore.get('rc1-op-decisionfencestopped1-c') &&
      markedStoppedStore.get('rc1-op-decisionfencestopped1-c').completionState,
    completionMarker: markedStoppedStore.get('rc1-op-decisionfencestopped1-c') &&
      markedStoppedStore.get('rc1-op-decisionfencestopped1-c').decisionFenceVersion
  }, {
    state: 'STOPPED', classification: 'CONTENTION',
    completionState: 'stopped', completionMarker: 1
  }, 'a marked identity propagates decision fence version 1 to its stopped terminal');

  async function rejectCompleteManifestBatch(batch, message, failedIndex) {
    const index = failedIndex === undefined ? 0 : failedIndex;
    let io = 0;
    context.wixData = {
      insert: async function() { io += 1; return {}; },
      get: async function() { io += 1; return null; }
    };
    assertEqual(await context.adapter.appendRoomClaimEvents(batch), {
      state: 'STOPPED',
      confirmed: [],
      failed: { index: index, eventId: batch[index]._id, classification: 'INTEGRITY' }
    }, message);
    assertEqual(io, 0, message + ' before Wix persistence');
  }

  for (const malformedFenceVersion of [undefined, null, 0, 2, '1', true, 1.1, NaN, Infinity, new Number(1)]) {
    const malformedMarkerBatch = buildManifestBatch(
      'malformedfencevalue1', '2027-11-05', '2027-11-06', [3]);
    malformedMarkerBatch[0].decisionFenceVersion = malformedFenceVersion;
    await rejectCompleteManifestBatch(malformedMarkerBatch,
      'adapter rejects malformed decision fence marker ' + String(malformedFenceVersion));
  }

  const accessorMarkerBatch = buildManifestBatch(
    'accessorfencevalue01', '2027-11-05', '2027-11-06', [3]);
  let accessorMarkerCalls = 0;
  Object.defineProperty(accessorMarkerBatch[0], 'decisionFenceVersion', {
    enumerable: true,
    get: function() {
      accessorMarkerCalls += 1;
      return 1;
    }
  });
  await rejectCompleteManifestBatch(accessorMarkerBatch,
    'adapter rejects decision fence marker accessors');
  assertEqual(accessorMarkerCalls, 0,
    'adapter rejects decision fence marker accessors without executing hooks');

  const inheritedAccessorMarkerBatch = buildManifestBatch(
    'inheritedfencevalue1', '2027-11-05', '2027-11-06', [3]);
  let inheritedAccessorMarkerCalls = 0;
  const inheritedAccessorMarkerPrototype = Object.create(Object.prototype);
  Object.defineProperty(inheritedAccessorMarkerPrototype, 'decisionFenceVersion', {
    enumerable: true,
    configurable: true,
    get: function() {
      inheritedAccessorMarkerCalls += 1;
      return 1;
    }
  });
  Object.setPrototypeOf(inheritedAccessorMarkerBatch[0], inheritedAccessorMarkerPrototype);
  await rejectCompleteManifestBatch(inheritedAccessorMarkerBatch,
    'adapter rejects inherited decision fence marker accessors');
  assertEqual(inheritedAccessorMarkerCalls, 0,
    'adapter rejects inherited decision fence marker accessors without executing hooks');

  const inheritedDataMarkerBatch = buildManifestBatch(
    'inheritedfencedata01', '2027-11-05', '2027-11-06', [3]);
  const inheritedDataMarkerPrototype = Object.create(Object.prototype);
  Object.defineProperty(inheritedDataMarkerPrototype, 'decisionFenceVersion', {
    value: 1, writable: true, enumerable: true, configurable: true
  });
  Object.setPrototypeOf(inheritedDataMarkerBatch[1], inheritedDataMarkerPrototype);
  await rejectCompleteManifestBatch(inheritedDataMarkerBatch,
    'adapter rejects inherited decision fence marker data properties', 1);

  const shuffledMultiNightBatch = [
    multiNightBatch[0],
    multiNightBatch[3], multiNightBatch[4],
    multiNightBatch[1], multiNightBatch[2]
  ].concat(multiNightBatch.slice(5));
  await rejectCompleteManifestBatch(shuffledMultiNightBatch,
    'adapter rejects a complete multi-night batch whose resources are out of manifest order');

  const noncanonicalCompleteBatch = buildManifestBatch(
    'noncanonicalbatch001', '2027-11-05', '2027-11-07', [3, 4]);
  noncanonicalCompleteBatch[0] = Object.assign({}, noncanonicalCompleteBatch[0], {
    manifestUnits: '03,4'
  });
  await rejectCompleteManifestBatch(noncanonicalCompleteBatch,
    'adapter rejects noncanonical unit aliases in an otherwise complete valid batch');

  const maximumManifestBatch = buildManifestBatch(
    'boundarymanifest0800', '2027-01-01', '2029-03-11', [3]);
  await confirmManifestBatch(maximumManifestBatch,
    'adapter accepts the exact 800-night manifest boundary');

  const overflowManifestBatch = buildManifestBatch(
    'boundarymanifest0801', '2027-01-01', '2029-03-12', [3]);
  let overflowManifestIo = 0;
  context.wixData = {
    insert: async function() { overflowManifestIo += 1; return {}; },
    get: async function() { overflowManifestIo += 1; return null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents(overflowManifestBatch), {
    state: 'STOPPED',
    confirmed: [],
    failed: {
      index: 0,
      eventId: overflowManifestBatch[0]._id,
      classification: 'INTEGRITY'
    }
  }, 'adapter rejects the 801-night manifest boundary');
  assertEqual(overflowManifestIo, 0,
    'the 801-night manifest boundary fails before Wix persistence');

  let identityOnlyIo = 0;
  context.wixData = {
    insert: async function() { identityOnlyIo += 1; return { _id: operationEvent._id }; },
    get: async function() { identityOnlyIo += 1; return operationEvent; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([operationEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: operationEvent._id, classification: 'INTEGRITY' }
  }, 'callers cannot intentionally persist an identity without its complete manifest batch');
  assertEqual(identityOnlyIo, 0, 'identity-only batches fail before Wix persistence');

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
    _id: 'rc1-20271105-u3-000001-a',
    claimKey: 'unit:2027-11-05:3',
    claimType: 'unit',
    unit: 3
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
    _id: 'rc1-20271106-u3-000001-a',
    claimKey: 'unit:2027-11-06:3',
    night: '2027-11-06',
    unit: 3
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
    insert: async function(collection, item) {
      if (item._id !== 'rc1-op-' + operationEvent.operationId + '-c') throw new Error('already exists');
      completedRetryStore.set(item._id, Object.assign({}, item));
      return item;
    },
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
  assertEqual(completedRetryStore.has('rc1-op-' + operationEvent.operationId + '-c'), true,
    'a reconciled complete acquisition receives its immutable completion fence');

  const capturedRetryStore = new Map([
    operationEvent, event, orphanUnitEvent
  ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
  let capturedRetryReads = 0;
  let redirectedRetryReads = 0;
  const capturedRetryPort = {
    insert: async function(collection, item) {
      if (capturedRetryStore.has(item._id)) throw new Error('already exists');
      capturedRetryStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: function(collection, id) {
      capturedRetryReads += 1;
      const value = capturedRetryStore.get(id) || null;
      if (id !== operationEvent._id) return Promise.resolve(value);
      return {
        then: function(resolve) {
          context.wixData = {
            insert: async function() { throw new Error('redirected insert'); },
            get: async function() { redirectedRetryReads += 1; return null; }
          };
          resolve(value);
        }
      };
    }
  };
  context.wixData = capturedRetryPort;
  assertEqual((await context.adapter.appendRoomClaimEvents([
    operationEvent, event, orphanUnitEvent
  ])).state, 'CONFIRMED',
  'existing-identity reconciliation remains bound to the Wix Data port captured before its first read');
  assertEqual({ capturedRetryReads: capturedRetryReads, redirectedRetryReads: redirectedRetryReads }, {
    capturedRetryReads: 4, redirectedRetryReads: 0
  }, 'existing-identity reconciliation never redirects later reads after an awaited thenable');

  const intrinsicRetryStore = new Map([
    operationEvent, event, orphanUnitEvent
  ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
  context.__savedObjectKeys = vm.runInContext('Object.keys', context);
  context.wixData = {
    insert: async function(collection, item) {
      if (intrinsicRetryStore.has(item._id)) throw new Error('already exists');
      intrinsicRetryStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: function(collection, id) {
      const value = intrinsicRetryStore.get(id) || null;
      if (id !== operationEvent._id) return Promise.resolve(value);
      return {
        then: function(resolve) {
          vm.runInContext("Object.keys = function() { throw new Error('mutated Object.keys'); }", context);
          resolve(value);
        }
      };
    }
  };
  let intrinsicRetryResult;
  let intrinsicRetryError = null;
  try {
    intrinsicRetryResult = await context.adapter.appendRoomClaimEvents([
      operationEvent, event, orphanUnitEvent
    ]);
  } catch (error) {
    intrinsicRetryError = error;
  } finally {
    vm.runInContext('Object.keys = __savedObjectKeys', context);
    delete context.__savedObjectKeys;
  }
  assertEqual({
    error: intrinsicRetryError && intrinsicRetryError.message,
    state: intrinsicRetryResult && intrinsicRetryResult.state
  }, { error: null, state: 'CONFIRMED' },
  'existing-identity reconciliation uses captured Object.keys after an awaited thenable');

  const immutableSnapshotStore = new Map();
  context.wixData = {
    insert: function(collection, item) {
      return {
        then: function(resolve) {
          if (item.claimType === 'operation') item.bookingNumber = 'WC-MUTATED-BY-PORT';
          immutableSnapshotStore.set(item._id, Object.assign({}, item));
          resolve(item);
        }
      };
    },
    get: async function(collection, id) { return immutableSnapshotStore.get(id) || null; }
  };
  const immutableSnapshotResult = await context.adapter.appendRoomClaimEvents([
    operationEvent, event, orphanUnitEvent
  ]);
  assertEqual({
    state: immutableSnapshotResult.state,
    identityBookingNumber: immutableSnapshotStore.get(operationEvent._id).bookingNumber,
    capacityBookingNumber: immutableSnapshotStore.get(event._id).bookingNumber,
    completionBookingNumber: immutableSnapshotStore.get(
      'rc1-op-' + operationEvent.operationId + '-c').bookingNumber
  }, {
    state: 'CONFIRMED',
    identityBookingNumber: operationEvent.bookingNumber,
    capacityBookingNumber: event.bookingNumber,
    completionBookingNumber: operationEvent.bookingNumber
  }, 'a persistence callback cannot mutate the validated identity snapshot used by later claims or completion');

  async function withReplacedVmIntrinsic(targetSource, run) {
    context.__savedIntrinsic = vm.runInContext(targetSource, context);
    const replacementSource = targetSource +
      " = function() { throw new Error('mutated " + targetSource + "'); }";
    try {
      return await run(replacementSource);
    } finally {
      vm.runInContext(targetSource + ' = __savedIntrinsic', context);
      delete context.__savedIntrinsic;
    }
  }

  async function runIdentityInsertIntrinsicProbe(targetSource, contention) {
    return withReplacedVmIntrinsic(targetSource, async function(replacementSource) {
      const store = new Map();
      context.wixData = {
        insert: function(collection, item) {
          if (item.claimType === 'capacity' && contention) {
            store.set(item._id, Object.assign({}, item, {
              operationId: 'differentoperation1',
              bookingRowId: 'pb1-differentoperation1-r1'
            }));
            return Promise.resolve(item);
          }
          store.set(item._id, Object.assign({}, item));
          if (item.claimType !== 'operation') return Promise.resolve(item);
          return {
            then: function(resolve) {
              vm.runInContext(replacementSource, context);
              resolve(item);
            }
          };
        },
        get: async function(collection, id) { return store.get(id) || null; }
      };
      let result;
      let error = null;
      try {
        result = await context.adapter.appendRoomClaimEvents([operationEvent, event, orphanUnitEvent]);
      } catch (caught) {
        error = caught;
      }
      return {
        error: error && error.message,
        state: result && result.state,
        classification: result && result.failed && result.failed.classification
      };
    });
  }

  const confirmedArrayIntrinsicProbes = [
    'Array.prototype.every',
    'Array.prototype.indexOf',
    'Array.prototype.map',
    'Array.prototype.some',
    'Array.prototype.push',
    'Array.prototype.slice',
    'Array.prototype[Symbol.iterator]'
  ];
  const confirmedArrayProbeResults = [];
  for (const targetSource of confirmedArrayIntrinsicProbes) {
    confirmedArrayProbeResults.push({
      targetSource: targetSource,
      outcome: await runIdentityInsertIntrinsicProbe(targetSource, false)
    });
  }
  assertEqual(confirmedArrayProbeResults, confirmedArrayIntrinsicProbes.map(function(targetSource) {
    return {
      targetSource: targetSource,
      outcome: { error: null, state: 'CONFIRMED', classification: undefined }
    };
  }), 'post-await confirmed claims use captured Array intrinsic dispatch');
  const contentionArrayIntrinsicProbes = [
    'Array.prototype.filter',
    'Array.prototype.find'
  ];
  const contentionArrayProbeResults = [];
  for (const targetSource of contentionArrayIntrinsicProbes) {
    contentionArrayProbeResults.push({
      targetSource: targetSource,
      outcome: await runIdentityInsertIntrinsicProbe(targetSource, true)
    });
  }
  assertEqual(contentionArrayProbeResults, contentionArrayIntrinsicProbes.map(function(targetSource) {
    return {
      targetSource: targetSource,
      outcome: { error: null, state: 'STOPPED', classification: 'CONTENTION' }
    };
  }), 'post-await stopped-prefix claims use captured Array intrinsic dispatch');

  const confirmedObjectStringIntrinsicProbes = [
    'Array.isArray',
    'Object.keys',
    'Object.assign',
    'Object.prototype.hasOwnProperty',
    'Array.prototype.join',
    'String.prototype.charAt',
    'String.prototype.indexOf',
    'String.prototype.slice',
    'String.prototype.trim',
    'String.prototype.split',
    'String.prototype.replace',
    'String.prototype.padStart',
    'Date',
    'Date.prototype.getTime',
    'Date.prototype.toISOString',
    'Number',
    'Number.isInteger',
    'Number.isNaN',
    'RegExp',
    'RegExp.prototype.exec',
    'Set',
    'Set.prototype.has',
    'Math.floor',
    'Promise.resolve',
    'Reflect.apply',
    'Reflect.ownKeys',
    'Object.create',
    'Object.defineProperty',
    'Object.defineProperties',
    'Object.freeze',
    'Object.getPrototypeOf',
    'Object.getOwnPropertyDescriptors'
  ];
  const confirmedObjectStringProbeResults = [];
  for (const targetSource of confirmedObjectStringIntrinsicProbes) {
    confirmedObjectStringProbeResults.push({
      targetSource: targetSource,
      outcome: await runIdentityInsertIntrinsicProbe(targetSource, false)
    });
  }
  assertEqual(confirmedObjectStringProbeResults,
    confirmedObjectStringIntrinsicProbes.map(function(targetSource) {
      return {
        targetSource: targetSource,
        outcome: { error: null, state: 'CONFIRMED', classification: undefined }
      };
    }), 'post-await claims use captured Object, String, RegExp, and Math intrinsic dispatch');

  const existingIdentityIteratorOutcome = await withReplacedVmIntrinsic(
    'Array.prototype[Symbol.iterator]', async function(replacementSource) {
      const store = new Map([
        operationEvent, event, orphanUnitEvent
      ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
      context.wixData = {
        insert: async function(collection, item) {
          if (store.has(item._id)) throw new Error('already exists');
          store.set(item._id, Object.assign({}, item));
          return item;
        },
        get: function(collection, id) {
          const value = store.get(id) || null;
          if (id !== operationEvent._id) return Promise.resolve(value);
          return {
            then: function(resolve) {
              vm.runInContext(replacementSource, context);
              resolve(value);
            }
          };
        }
      };
      let result;
      let error = null;
      try {
        result = await context.adapter.appendRoomClaimEvents([
          operationEvent, event, orphanUnitEvent
        ]);
      } catch (caught) {
        error = caught;
      }
      return { error: error && error.message, state: result && result.state };
    });
  assertEqual(existingIdentityIteratorOutcome, { error: null, state: 'CONFIRMED' },
    'existing-identity retry does not dispatch through a replaced Array iterator after identity read');

  const mismatchedManifest = Object.assign({}, operationEvent, {
    manifestUnits: '4',
    manifestResourceClaimIds: 'rc1-20271105-s1-000001-a|rc1-20271105-u4-000001-a'
  });
  let mismatchedManifestWrites = 0;
  context.wixData = {
    insert: async function() { mismatchedManifestWrites += 1; throw new Error('must not write'); },
    get: async function() { mismatchedManifestWrites += 1; return null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    mismatchedManifest,
    event,
    orphanUnitEvent
  ]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: mismatchedManifest._id, classification: 'INTEGRITY' }
  }, 'operation manifest must exactly bind the resource acquisition batch');
  assertEqual(mismatchedManifestWrites, 0,
    'manifest and acquisition disagreement fails before Wix persistence');

  const acquisitionRaceStore = new Map();
  let releaseBlockedUnitInsert;
  const blockedUnitInsert = new Promise(function(resolve) { releaseBlockedUnitInsert = resolve; });
  let announceBlockedUnit;
  const blockedUnitStarted = new Promise(function(resolve) { announceBlockedUnit = resolve; });
  let unitWasBlocked = false;
  context.wixData = {
    insert: async function(collection, item) {
      if (acquisitionRaceStore.has(item._id)) throw new Error('WDE0074');
      if (item._id === orphanUnitEvent._id && !unitWasBlocked) {
        unitWasBlocked = true;
        announceBlockedUnit();
        await blockedUnitInsert;
      }
      acquisitionRaceStore.set(item._id, Object.assign({}, item));
      return { _id: item._id };
    },
    get: async function(collection, id) { return acquisitionRaceStore.get(id) || null; }
  };
  const racingAcquisition = context.adapter.appendRoomClaimEvents([
    operationEvent, event, orphanUnitEvent
  ]);
  await blockedUnitStarted;
  const racingReleaseEvent = Object.assign({}, event, {
    _id: event._id.slice(0, -1) + 'r',
    eventType: 'release',
    releaseReason: 'concurrent-compensation-attempt'
  });
  const racingRelease = await context.adapter.appendRoomClaimEvents([racingReleaseEvent]);
  releaseBlockedUnitInsert();
  const racingAcquisitionResult = await racingAcquisition;
  assertEqual(racingRelease, {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: racingReleaseEvent._id, classification: 'INTEGRITY' }
  }, 'compensation cannot race an acquisition before its completion fence');
  assertEqual({
    acquisitionState: racingAcquisitionResult.state,
    hasCapacityRelease: acquisitionRaceStore.has(racingReleaseEvent._id),
    hasUnitAcquire: acquisitionRaceStore.has(orphanUnitEvent._id),
    hasCompletionFence: acquisitionRaceStore.has('rc1-op-' + operationEvent.operationId + '-c')
  }, {
    acquisitionState: 'CONFIRMED',
    hasCapacityRelease: false,
    hasUnitAcquire: true,
    hasCompletionFence: true
  }, 'the acquisition completes without an interleaved release and records its completion fence');

  async function verifyCompletionFailure(storedCompletion, classification, message) {
    const store = new Map();
    const completionId = 'rc1-op-' + operationEvent.operationId + '-c';
    context.wixData = {
      insert: async function(collection, item) {
        if (item._id === completionId) {
          if (storedCompletion) store.set(completionId, Object.assign({}, storedCompletion));
          return { _id: completionId };
        }
        store.set(item._id, Object.assign({}, item));
        return item;
      },
      get: async function(collection, id) { return store.get(id) || null; }
    };
    const result = await context.adapter.appendRoomClaimEvents([
      operationEvent, event, orphanUnitEvent
    ]);
    assertEqual(result, {
      state: 'STOPPED',
      confirmed: [
        { eventId: operationEvent._id, disposition: 'inserted' },
        { eventId: event._id, disposition: 'inserted' },
        { eventId: orphanUnitEvent._id, disposition: 'inserted' }
      ],
      failed: { index: 3, eventId: completionId, classification: classification }
    }, message);
  }
  await verifyCompletionFailure(null, 'UNRESOLVED',
    'a missing authoritative completion-fence read leaves the acquired prefix unresolved');
  await verifyCompletionFailure(Object.assign({},
    acquisitionRaceStore.get('rc1-op-' + operationEvent.operationId + '-c'), {
      completionState: 'stopped', confirmedResourceCount: 2
    }), 'INTEGRITY',
  'a conflicting deterministic completion fence fails the completed acquisition closed');

  const partialStopStore = new Map();
  const contendingUnit = Object.assign({}, orphanUnitEvent, {
    operationId: 'partialstopcompetitor1',
    bookingRowId: 'pb1-partialstopcompetitor1-r1',
    bookingNumber: 'WC-PARTIAL-COMPETITOR',
    payloadDigest: '2626262626262626262626262626262626262626262626262626262626262626'
  });
  partialStopStore.set(contendingUnit._id, contendingUnit);
  context.wixData = {
    insert: async function(collection, item) {
      if (partialStopStore.has(item._id)) throw new Error('WDE0074');
      partialStopStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: async function(collection, id) { return partialStopStore.get(id) || null; }
  };
  const partialStopResult = await context.adapter.appendRoomClaimEvents([
    operationEvent, event, orphanUnitEvent
  ]);
  assertEqual(partialStopResult.failed, {
    index: 2, eventId: orphanUnitEvent._id, classification: 'CONTENTION'
  }, 'a conclusive partial acquisition stops at the contended resource');
  assertEqual(partialStopStore.get('rc1-op-' + operationEvent.operationId + '-c'), {
    _id: 'rc1-op-' + operationEvent.operationId + '-c',
    protocolVersion: 1,
    claimKey: 'operation:' + operationEvent.operationId + ':completion',
    generation: 1,
    eventType: 'complete',
    claimType: 'operation-completion',
    operationId: operationEvent.operationId,
    bookingRowId: operationEvent.bookingRowId,
    bookingNumber: operationEvent.bookingNumber,
    payloadDigest: operationEvent.payloadDigest,
    decisionFenceVersion: 1,
    completionState: 'stopped',
    confirmedResourceCount: 1
  }, 'a conclusive partial writer records an exact stopped-prefix fence');
  const stoppedCapacityRelease = Object.assign({}, event, {
    _id: event._id.slice(0, -1) + 'r',
    eventType: 'release',
    releaseReason: 'compensate-conclusive-partial-stop'
  });
  assertEqual((await context.adapter.appendRoomClaimEvents([
    stoppedCapacityRelease
  ])).state, 'CONFIRMED',
  'a conclusively stopped acquisition prefix can be compensated safely');

  async function verifyStoppedFenceFailure(storedFence, classification, message) {
    const store = new Map([[contendingUnit._id, Object.assign({}, contendingUnit)]]);
    const completionId = 'rc1-op-' + operationEvent.operationId + '-c';
    context.wixData = {
      insert: async function(collection, item) {
        if (item._id === completionId) {
          if (storedFence) store.set(completionId, Object.assign({}, storedFence));
          return { _id: completionId };
        }
        if (store.has(item._id)) throw new Error('WDE0074');
        store.set(item._id, Object.assign({}, item));
        return item;
      },
      get: async function(collection, id) { return store.get(id) || null; }
    };
    assertEqual(await context.adapter.appendRoomClaimEvents([
      operationEvent, event, orphanUnitEvent
    ]), {
      state: 'STOPPED',
      confirmed: [
        { eventId: operationEvent._id, disposition: 'inserted' },
        { eventId: event._id, disposition: 'inserted' }
      ],
      failed: { index: 2, eventId: completionId, classification: classification }
    }, message);
  }

  await verifyStoppedFenceFailure(null, 'UNRESOLVED',
    'an unresolved stopped-fence readback supersedes the resource contention result');
  await verifyStoppedFenceFailure(Object.assign({},
    partialStopStore.get('rc1-op-' + operationEvent.operationId + '-c'), {
      completionState: 'complete', confirmedResourceCount: 2
    }), 'INTEGRITY',
    'a conflicting stopped fence supersedes the resource contention result');

  const competingOperation = Object.assign({}, operationEvent, {
    bookingNumber: 'WC-3002',
    payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    manifestCheckIn: '2027-11-06',
    manifestCheckOut: '2027-11-07',
    manifestUnits: '4',
    manifestResourceClaimIds: 'rc1-20271106-s1-000001-a|rc1-20271106-u4-000001-a'
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

  const secondOperationId = 'multioperationbatch02';
  const secondOperationIdentity = Object.assign({}, operationEvent, {
    _id: 'rc1-op-' + secondOperationId + '-a',
    claimKey: 'operation:' + secondOperationId,
    operationId: secondOperationId,
    bookingRowId: 'pb1-' + secondOperationId + '-r1',
    bookingNumber: 'WC-MULTI-OP-2',
    payloadDigest: '2727272727272727272727272727272727272727272727272727272727272727',
    manifestCheckIn: '2027-11-06',
    manifestCheckOut: '2027-11-07',
    manifestUnits: '4',
    manifestBookingRowIds: 'pb1-' + secondOperationId + '-r1',
    manifestResourceClaimIds: 'rc1-20271106-s1-000001-a|rc1-20271106-u4-000001-a'
  });
  const multiBatchCapacity = Object.assign({}, event, {
    _id: 'rc1-20271106-s1-000001-a',
    claimKey: 'capacity:2027-11-06:1',
    night: '2027-11-06',
    operationId: secondOperationId,
    bookingRowId: secondOperationIdentity.bookingRowId,
    bookingNumber: secondOperationIdentity.bookingNumber,
    payloadDigest: secondOperationIdentity.payloadDigest
  });
  const multiBatchUnit = Object.assign({}, orphanUnitEvent, {
    _id: 'rc1-20271106-u4-000001-a',
    claimKey: 'unit:2027-11-06:4',
    night: '2027-11-06',
    unit: 4,
    operationId: secondOperationId,
    bookingRowId: secondOperationIdentity.bookingRowId,
    bookingNumber: secondOperationIdentity.bookingNumber,
    payloadDigest: secondOperationIdentity.payloadDigest
  });
  const foreignSecondUnit = Object.assign({}, multiBatchUnit, {
    operationId: 'multioperationforeign1',
    bookingRowId: 'pb1-multioperationforeign1-r1',
    bookingNumber: 'WC-MULTI-FOREIGN',
    payloadDigest: '2828282828282828282828282828282828282828282828282828282828282828'
  });
  const multiOperationStore = new Map([[foreignSecondUnit._id, foreignSecondUnit]]);
  let multiOperationIo = 0;
  context.wixData = {
    insert: async function(collection, item) {
      multiOperationIo += 1;
      if (multiOperationStore.has(item._id)) throw new Error('WDE0074');
      multiOperationStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: async function(collection, id) {
      multiOperationIo += 1;
      return multiOperationStore.get(id) || null;
    }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    operationEvent, secondOperationIdentity,
    event, multiBatchCapacity,
    orphanUnitEvent, multiBatchUnit
  ]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: secondOperationIdentity._id, classification: 'INTEGRITY' }
  }, 'one append batch cannot contain more than one operation');
  assertEqual(multiOperationIo, 0,
    'multi-operation batches fail before an earlier operation can be stranded without a fence');

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
    const units = unit === 5 ? [3, 4, 5] : [unit];
    const slots = unit === 5 ? [1, 2, 3] : [slot];
    const rowIds = units.map(function(value, index) {
      return 'pb1-' + operationId + '-r' + (index + 1);
    });
    const capacities = slots.map(function(capacitySlot, index) {
      return {
        _id: 'rc1-20271108-s' + capacitySlot + '-000001-a',
        protocolVersion: 1,
        claimKey: 'capacity:2027-11-08:' + capacitySlot,
        generation: 1,
        eventType: 'acquire',
        claimType: 'capacity',
        night: '2027-11-08',
        capacitySlot: capacitySlot,
        operationId: operationId,
        bookingRowId: rowIds[index],
        bookingNumber: bookingNumber,
        payloadDigest: payloadDigest
      };
    });
    const unitEvents = units.map(function(assignedUnit, index) {
      return {
        _id: 'rc1-20271108-u' + assignedUnit + '-000001-a',
        protocolVersion: 1,
        claimKey: 'unit:2027-11-08:' + assignedUnit,
        generation: 1,
        eventType: 'acquire',
        claimType: 'unit',
        night: '2027-11-08',
        unit: assignedUnit,
        operationId: operationId,
        bookingRowId: rowIds[index],
        bookingNumber: bookingNumber,
        payloadDigest: payloadDigest
      };
    });
    const identity = {
      _id: 'rc1-op-' + operationId + '-a',
      protocolVersion: 1,
      claimKey: 'operation:' + operationId,
      generation: 1,
      eventType: 'acquire',
      claimType: 'operation',
      operationId: operationId,
      bookingRowId: rowIds[0],
      bookingNumber: bookingNumber,
      payloadDigest: payloadDigest,
      manifestVersion: 1,
      manifestCheckIn: '2027-11-08',
      manifestCheckOut: '2027-11-09',
      manifestRoomCode: unit === 1 ? 'penthouse_apartment' :
        (unit === 2 ? 'two_bedroom_apartment' : 'adventure_suite'),
      manifestUnits: units.join(','),
      manifestBookingRowIds: rowIds.join('|'),
      manifestResourceClaimIds: capacities.concat(unitEvents).map(function(item) {
        return item._id;
      }).join('|')
    };
    return [identity].concat(capacities, unitEvents);
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
      const rowNumber = Number(resource.bookingRowId.slice(resource.bookingRowId.lastIndexOf('r') + 1));
      const syntheticUnit = Math.min(5, 2 + rowNumber);
      const synthetic = Object.assign({}, resource, {
        _id: 'rc1-' + resource.night.replace(/-/g, '') + '-u' + syntheticUnit + '-' +
          String(resource.generation).padStart(6, '0') + '-a',
        claimKey: 'unit:' + resource.night + ':' + syntheticUnit,
        claimType: 'unit',
        unit: syntheticUnit
      });
      delete synthetic.capacitySlot;
      syntheticUnits.push(synthetic);
    });
    const syntheticById = Object.create(null);
    syntheticUnits.forEach(function(item) { syntheticById[item._id] = item; });
    const completeResources = resourceEvents.concat(syntheticUnits);
    const manifestResources = completeResources.filter(function(item, index, all) {
      return all.findIndex(function(candidate) { return candidate._id === item._id; }) === index;
    });
    const manifestNights = manifestResources.map(function(item) { return item.night; })
      .filter(function(night, index, all) { return all.indexOf(night) === index; })
      .sort();
    const manifestRows = manifestResources.map(function(item) { return item.bookingRowId; })
      .filter(function(rowId, index, all) { return all.indexOf(rowId) === index; })
      .sort(function(left, right) {
        return Number(left.slice(left.lastIndexOf('r') + 1)) - Number(right.slice(right.lastIndexOf('r') + 1));
      });
    const manifestUnits = manifestRows.map(function(rowId) {
      const unitEventForRow = manifestResources.find(function(item) {
        return item.claimType === 'unit' && item.bookingRowId === rowId;
      });
      return unitEventForRow.unit;
    });
    const manifestRoomCode = manifestUnits.every(function(unit) { return unit >= 3; })
      ? 'adventure_suite'
      : (manifestUnits.length === 1 && manifestUnits[0] === 2
        ? 'two_bedroom_apartment'
        : 'penthouse_apartment');
    const manifestEnd = new Date(manifestNights[manifestNights.length - 1] + 'T00:00:00.000Z');
    manifestEnd.setUTCDate(manifestEnd.getUTCDate() + 1);
    const syntheticIdentity = Object.assign({}, operationEvent, {
      manifestCheckIn: manifestNights[0],
      manifestCheckOut: manifestEnd.toISOString().slice(0, 10),
      manifestRoomCode: manifestRoomCode,
      manifestUnits: manifestUnits.join(','),
      manifestBookingRowIds: manifestRows.join('|'),
      manifestResourceClaimIds: manifestResources.map(function(item) { return item._id; }).join('|')
    });
    const completionStore = new Map();
    context.wixData = {
      insert: async function(collection, item, options) {
        if (item.claimType === 'operation-completion') {
          if (completionStore.has(item._id)) throw new Error('WDE0074');
          completionStore.set(item._id, Object.assign({}, item));
          return { _id: item._id };
        }
        if (item._id === syntheticIdentity._id || syntheticById[item._id]) return { _id: item._id };
        return resourceWixData.insert(collection, item, options);
      },
      get: async function(collection, id, options) {
        if (completionStore.has(id)) return completionStore.get(id);
        if (id === syntheticIdentity._id) return syntheticIdentity;
        if (syntheticById[id]) return syntheticById[id];
        return resourceWixData.get(collection, id, options);
      }
    };
    try {
      const result = await context.adapter.appendRoomClaimEvents(
        [syntheticIdentity].concat(completeResources)
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

  const manifestOmittingReleaseAcquire = Object.assign({}, operationEvent, {
    manifestResourceClaimIds: 'rc1-20271105-s2-000001-a|rc1-20271105-u3-000001-a'
  });
  const omittedAcquireCalls = { inserts: 0, gets: [] };
  context.wixData = {
    insert: async function() { omittedAcquireCalls.inserts += 1; return releaseEvent; },
    get: async function(collection, id) {
      omittedAcquireCalls.gets.push(id);
      return id === operationEvent._id ? manifestOmittingReleaseAcquire : event;
    }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([releaseEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: releaseEvent._id, classification: 'INTEGRITY' }
  }, 'compensation requires the exact acquire to be declared by its operation manifest');
  assertEqual(omittedAcquireCalls, {
    inserts: 0,
    gets: [operationEvent._id, 'rc1-20271105-s2-000001-a']
  }, 'manifest authorization fails while reading the declared prefix before release insertion');

  const unitReleaseEvent = Object.assign({}, orphanUnitEvent, {
    _id: orphanUnitEvent._id.slice(0, -1) + 'r',
    eventType: 'release',
    releaseReason: 'non-prefix-recovery-attempt'
  });
  const nonPrefixReleaseCalls = { inserts: 0, gets: [] };
  context.wixData = {
    insert: async function() { nonPrefixReleaseCalls.inserts += 1; return unitReleaseEvent; },
    get: async function(collection, id) {
      nonPrefixReleaseCalls.gets.push(id);
      if (id === operationEvent._id) return operationEvent;
      if (id === orphanUnitEvent._id) return orphanUnitEvent;
      if (id === unitReleaseEvent._id) return unitReleaseEvent;
      return null;
    }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([unitReleaseEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: unitReleaseEvent._id, classification: 'INTEGRITY' }
  }, 'release rejects a stored acquisition that is not an exact operation-manifest prefix');
  assertEqual(nonPrefixReleaseCalls.inserts, 0,
    'non-prefix release authorization cannot reach persistence');

  const stoppedPrefixFence = {
    _id: 'rc1-op-' + operationEvent.operationId + '-c',
    protocolVersion: 1,
    claimKey: 'operation:' + operationEvent.operationId + ':completion',
    generation: 1,
    eventType: 'complete',
    claimType: 'operation-completion',
    operationId: operationEvent.operationId,
    bookingRowId: operationEvent.bookingRowId,
    bookingNumber: operationEvent.bookingNumber,
    payloadDigest: operationEvent.payloadDigest,
    decisionFenceVersion: 1,
    completionState: 'stopped',
    confirmedResourceCount: 1
  };
  const stoppedPrefixStore = new Map([
    operationEvent, event, stoppedPrefixFence
  ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
  context.wixData = {
    insert: async function(collection, item) {
      if (stoppedPrefixStore.has(item._id)) throw new Error('WDE0074');
      stoppedPrefixStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: async function(collection, id) { return stoppedPrefixStore.get(id) || null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([releaseEvent]), {
    state: 'CONFIRMED',
    confirmed: [{ eventId: releaseEvent._id, disposition: 'inserted' }]
  }, 'an exact stopped acquisition prefix can be compensated after its terminal fence');

  let injectedCompletionIo = 0;
  context.wixData = {
    insert: async function() { injectedCompletionIo += 1; return stoppedPrefixFence; },
    get: async function() { injectedCompletionIo += 1; return stoppedPrefixFence; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([stoppedPrefixFence]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: stoppedPrefixFence._id, classification: 'INTEGRITY' }
  }, 'normal append callers cannot inject operation terminal fences');
  assertEqual(injectedCompletionIo, 0,
    'caller-supplied terminal fences fail before Wix persistence');

  const fullReleaseFence = acquisitionRaceStore.get(
    'rc1-op-' + operationEvent.operationId + '-c');

  async function rejectInvalidFullReleaseFence(fenceMutation, message) {
    const fence = Object.assign({}, fullReleaseFence);
    fenceMutation(fence);
    const store = new Map([
      operationEvent, event, orphanUnitEvent, fence
    ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
    let inserts = 0;
    context.wixData = {
      insert: async function() { inserts += 1; return {}; },
      get: async function(collection, id) { return store.get(id) || null; }
    };
    const unitRelease = Object.assign({}, orphanUnitEvent, {
      _id: orphanUnitEvent._id.slice(0, -1) + 'r',
      eventType: 'release',
      releaseReason: 'terminal-fence-probe'
    });
    assertEqual(await context.adapter.appendRoomClaimEvents([unitRelease]), {
      state: 'STOPPED',
      confirmed: [],
      failed: { index: 0, eventId: unitRelease._id, classification: 'INTEGRITY' }
    }, message);
    assertEqual(inserts, 0, message + ' before release insertion');
  }

  await rejectInvalidFullReleaseFence(function(fence) {
    fence.confirmedResourceCount = 1;
  }, 'release rejects a completion fence whose count differs from its full acquisition prefix');
  await rejectInvalidFullReleaseFence(function(fence) {
    fence.completionState = 'stopped';
  }, 'release rejects a stopped fence that claims a full manifest');

  const forwardReleaseStore = new Map([
    operationEvent, event, orphanUnitEvent, fullReleaseFence
  ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
  let forwardReleaseWrites = 0;
  context.wixData = {
    insert: async function(collection, item) {
      if (item.eventType === 'release') forwardReleaseWrites += 1;
      forwardReleaseStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: async function(collection, id) { return forwardReleaseStore.get(id) || null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([releaseEvent]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: releaseEvent._id, classification: 'INTEGRITY' }
  }, 'capacity cannot be released while its later unit acquisition remains active');
  assertEqual(forwardReleaseWrites, 0,
    'forward-order compensation cannot reach persistence');

  const reverseReleaseStore = new Map([
    operationEvent, event, orphanUnitEvent, fullReleaseFence
  ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
  context.wixData = {
    insert: async function(collection, item) {
      if (reverseReleaseStore.has(item._id)) throw new Error('WDE0074');
      reverseReleaseStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: async function(collection, id) { return reverseReleaseStore.get(id) || null; }
  };
  const reverseUnitRelease = Object.assign({}, orphanUnitEvent, {
    _id: orphanUnitEvent._id.slice(0, -1) + 'r',
    eventType: 'release',
    releaseReason: 'reverse-order-compensation'
  });
  const reverseCapacityRelease = Object.assign({}, releaseEvent, {
    releaseReason: 'reverse-order-compensation'
  });
  assertEqual((await context.adapter.appendRoomClaimEvents([
    reverseUnitRelease, reverseCapacityRelease
  ])).state, 'CONFIRMED',
  'a completed operation can be compensated in reverse resource-acquisition order');

  const markedReleaseIdentity = Object.assign({}, operationEvent, { decisionFenceVersion: 1 });
  const markedReleaseCompletion = Object.assign({}, fullReleaseFence, { decisionFenceVersion: 1 });
  const markedReleaseStore = new Map([
    markedReleaseIdentity, event, orphanUnitEvent, markedReleaseCompletion
  ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
  const markedReleaseInsertOrder = [];
  context.wixData = {
    insert: async function(collection, item) {
      markedReleaseInsertOrder.push(item._id);
      if (markedReleaseStore.has(item._id)) throw new Error('WDE0074');
      markedReleaseStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: async function(collection, id) { return markedReleaseStore.get(id) || null; }
  };
  const markedReleaseResult = await context.adapter.appendRoomClaimEvents([
    reverseUnitRelease, reverseCapacityRelease
  ]);
  assertEqual({
    state: markedReleaseResult.state,
    insertOrder: markedReleaseInsertOrder,
    decisionState: markedReleaseStore.get('rc1-op-' + operationEvent.operationId + '-d') &&
      markedReleaseStore.get('rc1-op-' + operationEvent.operationId + '-d').decisionState
  }, {
    state: 'CONFIRMED',
    insertOrder: [
      'rc1-op-' + operationEvent.operationId + '-d',
      reverseUnitRelease._id,
      reverseCapacityRelease._id
    ],
    decisionState: 'compensate'
  }, 'a multi-release batch fences compensation exactly once before every release write');

  async function runHostileDecisionAwaitReleaseProbe(onDecisionAwait) {
    const store = new Map([
      markedReleaseIdentity, event, orphanUnitEvent, markedReleaseCompletion
    ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
    let originalReleaseWrites = 0;
    let replacementReleaseWrites = 0;
    const originalPort = {
      insert: function(collection, item) {
        if (item.claimType === 'operation-decision') {
          store.set(item._id, Object.assign({}, item));
          return {
            then: function(resolve) {
              onDecisionAwait(store, hostileRelease);
              resolve(item);
            }
          };
        }
        if (item.eventType === 'release') originalReleaseWrites += 1;
        if (store.has(item._id)) throw new Error('WDE0074');
        store.set(item._id, Object.assign({}, item));
        return Promise.resolve(item);
      },
      get: async function(collection, id) { return store.get(id) || null; }
    };
    context.wixData = originalPort;
    const hostileRelease = Object.assign({}, reverseUnitRelease, {
      releaseReason: 'validated-before-decision'
    });
    const replacementPort = {
      insert: async function(collection, item) {
        if (item.eventType === 'release') replacementReleaseWrites += 1;
        store.set(item._id, Object.assign({}, item));
        return item;
      },
      get: async function(collection, id) { return store.get(id) || null; }
    };
    return {
      result: await context.adapter.appendRoomClaimEvents([hostileRelease]),
      store: store,
      hostileRelease: hostileRelease,
      originalPort: originalPort,
      replacementPort: replacementPort,
      originalReleaseWrites: function() { return originalReleaseWrites; },
      replacementReleaseWrites: function() { return replacementReleaseWrites; }
    };
  }

  async function runDecisionLoadIntrinsicProbe(targetSource) {
    return withReplacedVmIntrinsic(targetSource, async function(replacementSource) {
      const store = new Map([
        markedReleaseIdentity, event, orphanUnitEvent, markedReleaseCompletion
      ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
      let poisoned = false;
      context.wixData = {
        insert: async function(collection, item) {
          if (store.has(item._id)) throw new Error('WDE0074');
          store.set(item._id, Object.assign({}, item));
          return item;
        },
        get: function(collection, id) {
          const value = store.get(id) || null;
          if (id !== markedReleaseIdentity._id || poisoned) return Promise.resolve(value);
          poisoned = true;
          return {
            then: function(resolve) {
              vm.runInContext(replacementSource, context);
              resolve(value);
            }
          };
        }
      };
      let result;
      let error = null;
      try {
        result = await context.adapter.appendRoomOperationDecision(
          markedReleaseIdentity.operationId, 'compensate');
      } catch (caught) {
        error = caught;
      }
      return {
        error: error && error.message,
        state: result && result.state,
        classification: result && result.failed && result.failed.classification
      };
    });
  }

  const decisionLoadIntrinsicTargets = [
    'Object.create',
    'Object.defineProperty',
    'Object.defineProperties',
    'Reflect.ownKeys',
    'Promise.prototype.then',
    'Array',
    'String',
    'RegExp.prototype.exec'
  ];
  const decisionLoadIntrinsicResults = [];
  for (const targetSource of decisionLoadIntrinsicTargets) {
    decisionLoadIntrinsicResults.push({
      targetSource: targetSource,
      outcome: await runDecisionLoadIntrinsicProbe(targetSource)
    });
  }
  assertEqual(decisionLoadIntrinsicResults, decisionLoadIntrinsicTargets.map(function(targetSource) {
    return {
      targetSource: targetSource,
      outcome: { error: null, state: 'CONFIRMED', classification: undefined }
    };
  }), 'decision evidence loading uses captured snapshot, Promise, Array, String, and RegExp intrinsics');

  async function runPostDecisionReleaseIntrinsicProbe(targetSource) {
    return withReplacedVmIntrinsic(targetSource, async function(replacementSource) {
      let probe;
      let error = null;
      try {
        probe = await runHostileDecisionAwaitReleaseProbe(function() {
          vm.runInContext(replacementSource, context);
        });
      } catch (caught) {
        error = caught;
      }
      return {
        error: error && error.message,
        state: probe && probe.result && probe.result.state,
        classification: probe && probe.result && probe.result.failed && probe.result.failed.classification
      };
    });
  }

  const safePostDecisionReleaseTargets = ['Object.assign', 'Math.floor'];
  const safePostDecisionReleaseResults = [];
  for (const targetSource of safePostDecisionReleaseTargets) {
    safePostDecisionReleaseResults.push({
      targetSource: targetSource,
      outcome: await runPostDecisionReleaseIntrinsicProbe(targetSource)
    });
  }
  assertEqual(safePostDecisionReleaseResults,
    safePostDecisionReleaseTargets.map(function(targetSource) {
      return {
        targetSource: targetSource,
        outcome: { error: null, state: 'CONFIRMED', classification: undefined }
      };
    }), 'post-decision release validation uses captured Object.assign and Math.floor');

  const blockedPostDecisionReleaseTargets = ['String.prototype.match', 'Number'];
  const blockedPostDecisionReleaseResults = [];
  for (const targetSource of blockedPostDecisionReleaseTargets) {
    blockedPostDecisionReleaseResults.push({
      targetSource: targetSource,
      outcome: await runPostDecisionReleaseIntrinsicProbe(targetSource)
    });
  }
  // Asserted with the generation-path blocker outcomes below so both current
  // live-dispatch defects are reported by one focused verifier run.

  let redirectReplacement;
  const redirectedRelease = await runHostileDecisionAwaitReleaseProbe(function(store) {
    redirectReplacement = {
      insert: async function(collection, item) {
        if (item.eventType === 'release') redirectReplacement.releaseWrites += 1;
        store.set(item._id, Object.assign({}, item));
        return item;
      },
      get: async function(collection, id) { return store.get(id) || null; },
      releaseWrites: 0
    };
    context.wixData = redirectReplacement;
  });
  assertEqual({
    state: redirectedRelease.result.state,
    originalWrites: redirectedRelease.originalReleaseWrites(),
    replacementWrites: redirectReplacement.releaseWrites
  }, {
    state: 'CONFIRMED', originalWrites: 1, replacementWrites: 0
  }, 'release persistence remains bound to the Wix Data owner captured before decision confirmation');

  let mutableRelease;
  const mutationProtectedRelease = await runHostileDecisionAwaitReleaseProbe(function(store, release) {
    mutableRelease = release;
    release.releaseReason = 'mutated-after-validation';
  });
  assertEqual(mutationProtectedRelease.store.get(mutableRelease._id).releaseReason,
    'validated-before-decision',
    'release persistence uses an immutable event snapshot captured before decision confirmation');

  const exactCompensateDecision = Object.assign({},
    markedReleaseStore.get('rc1-op-' + operationEvent.operationId + '-d'));
  async function rejectMarkedReleaseWithDecision(decision, classification, message) {
    const store = new Map([
      markedReleaseIdentity, event, orphanUnitEvent, markedReleaseCompletion, decision
    ].filter(Boolean).map(function(item) { return [item._id, Object.assign({}, item)]; }));
    const insertedTypes = [];
    context.wixData = {
      insert: async function(collection, item) {
        insertedTypes.push(item.eventType);
        if (store.has(item._id)) throw new Error('WDE0074');
        store.set(item._id, Object.assign({}, item));
        return item;
      },
      get: async function(collection, id) { return store.get(id) || null; }
    };
    assertEqual(await context.adapter.appendRoomClaimEvents([reverseUnitRelease]), {
      state: 'STOPPED', confirmed: [],
      failed: { index: 0, eventId: reverseUnitRelease._id, classification: classification }
    }, message);
    assertEqual(insertedTypes.filter(function(type) { return type === 'release'; }).length, 0,
      message + ' with zero release writes');
  }

  await rejectMarkedReleaseWithDecision(Object.assign({}, exactCompensateDecision, {
    decisionState: 'commit-rows'
  }), 'DECISION_CONFLICT', 'an exact commit decision prevents compensation');
  await rejectMarkedReleaseWithDecision(Object.assign({}, exactCompensateDecision, {
    operationCompletionId: 'malformed'
  }), 'INTEGRITY', 'a malformed decision prevents compensation');

  const unresolvedReleaseStore = new Map([
    markedReleaseIdentity, event, orphanUnitEvent, markedReleaseCompletion
  ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
  let unresolvedReleaseWrites = 0;
  context.wixData = {
    insert: async function(collection, item) {
      if (item.eventType === 'release') unresolvedReleaseWrites += 1;
      throw new Error('decision insert timeout');
    },
    get: async function(collection, id) {
      if (id === exactCompensateDecision._id) throw new Error('decision read timeout');
      return unresolvedReleaseStore.get(id) || null;
    }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([reverseUnitRelease]), {
    state: 'STOPPED', confirmed: [],
    failed: { index: 0, eventId: reverseUnitRelease._id, classification: 'UNRESOLVED' }
  }, 'an unresolved decision prevents compensation');
  assertEqual(unresolvedReleaseWrites, 0,
    'an unresolved decision causes zero release writes');

  const legacyReleaseIdentity = Object.assign({}, markedReleaseIdentity);
  delete legacyReleaseIdentity.decisionFenceVersion;
  let legacyReleaseWrites = 0;
  context.wixData = {
    insert: async function(collection, item) {
      if (item.eventType === 'release') legacyReleaseWrites += 1;
      return item;
    },
    get: async function(collection, id) {
      return id === legacyReleaseIdentity._id ? legacyReleaseIdentity : null;
    }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([reverseUnitRelease]), {
    state: 'STOPPED', confirmed: [],
    failed: { index: 0, eventId: reverseUnitRelease._id, classification: 'LEGACY_UNFENCED' }
  }, 'legacy unfenced evidence prevents new compensation writes');
  assertEqual(legacyReleaseWrites, 0,
    'legacy unfenced evidence causes zero release writes');

  const existingCompensateStore = new Map([
    markedReleaseIdentity, event, orphanUnitEvent, markedReleaseCompletion,
    exactCompensateDecision, reverseUnitRelease
  ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
  context.wixData = {
    insert: async function(collection, item) {
      if (existingCompensateStore.has(item._id)) throw new Error('WDE0074');
      existingCompensateStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: async function(collection, id) { return existingCompensateStore.get(id) || null; }
  };
  assertEqual((await context.adapter.appendRoomClaimEvents([reverseCapacityRelease])).state,
    'CONFIRMED', 'an existing exact compensate decision permits a partial reverse-release retry');

  const mixedStore = new Map([
    markedReleaseIdentity, event, orphanUnitEvent, markedReleaseCompletion,
    exactCompensateDecision
  ].map(function(item) { return [item._id, Object.assign({}, item)]; }));
  let mixedBatchResourceWrites = 0;
  context.wixData = {
    query: function() {
      return { limit: function() { return this; }, find: async function() {
        return { items: [], hasNext: function() { return false; } };
      } };
    },
    insert: async function(collection, item) {
      if (item.eventType === 'acquire' || item.eventType === 'release') mixedBatchResourceWrites += 1;
      if (mixedStore.has(item._id)) throw new Error('WDE0074');
      mixedStore.set(item._id, Object.assign({}, item));
      return item;
    },
    get: async function(collection, id) { return mixedStore.get(id) || null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    markedReleaseIdentity, event, orphanUnitEvent, reverseUnitRelease
  ]), {
    state: 'STOPPED', confirmed: [],
    failed: { index: 3, eventId: reverseUnitRelease._id, classification: 'INTEGRITY' }
  }, 'a mixed acquisition and release batch fails atomically at its first release');
  assertEqual(mixedBatchResourceWrites, 0,
    'a mixed acquisition and release batch performs zero acquisition or release writes');

  async function appendReleases(releaseEvents) {
    const releaseWixData = context.wixData;
    const owner = releaseEvents[0];
    const releaseIdentity = Object.assign({}, operationEvent, {
      _id: 'rc1-op-' + owner.operationId + '-a',
      claimKey: 'operation:' + owner.operationId,
      operationId: owner.operationId,
      bookingRowId: 'pb1-' + owner.operationId + '-r1',
      bookingNumber: owner.bookingNumber,
      payloadDigest: owner.payloadDigest
    });
    const releaseCompletion = {
      _id: 'rc1-op-' + owner.operationId + '-c',
      protocolVersion: 1,
      claimKey: 'operation:' + owner.operationId + ':completion',
      generation: 1,
      eventType: 'complete',
      claimType: 'operation-completion',
      operationId: owner.operationId,
      bookingRowId: 'pb1-' + owner.operationId + '-r1',
      bookingNumber: owner.bookingNumber,
      payloadDigest: owner.payloadDigest,
      decisionFenceVersion: 1,
      completionState: 'complete',
      confirmedResourceCount: releaseIdentity.manifestResourceClaimIds.split('|').length
    };
    const releaseDecision = {
      _id: 'rc1-op-' + owner.operationId + '-d',
      protocolVersion: 1,
      claimKey: 'operation:' + owner.operationId + ':decision',
      generation: 1,
      eventType: 'decide',
      claimType: 'operation-decision',
      operationId: owner.operationId,
      bookingRowId: releaseIdentity.bookingRowId,
      bookingNumber: owner.bookingNumber,
      payloadDigest: owner.payloadDigest,
      decisionFenceVersion: 1,
      operationIdentityId: releaseIdentity._id,
      operationCompletionId: releaseCompletion._id,
      manifestVersion: 1,
      completionState: 'complete',
      confirmedResourceCount: releaseCompletion.confirmedResourceCount,
      decisionState: 'compensate'
    };
    const priorUnitReleaseForCapacity = Object.assign({}, orphanUnitEvent, {
      _id: orphanUnitEvent._id.slice(0, -1) + 'r',
      eventType: 'release',
      operationId: owner.operationId,
      bookingRowId: owner.bookingRowId,
      bookingNumber: owner.bookingNumber,
      payloadDigest: owner.payloadDigest,
      releaseReason: 'prior-reverse-order-compensation'
    });
    context.wixData = {
      insert: function(collection, item, options) {
        return releaseWixData.insert(collection, item, options);
      },
      get: async function(collection, id, options) {
        if (id === releaseIdentity._id) return releaseIdentity;
        if (id === releaseCompletion._id) return releaseCompletion;
        if (id === releaseDecision._id) return releaseDecision;
        if (owner.claimType === 'capacity' && id === priorUnitReleaseForCapacity._id) {
          return priorUnitReleaseForCapacity;
        }
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
    gets: [event._id, orphanUnitEvent._id]
  }, 'a missing acquire prevents release insertion after the full declared prefix is checked');

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
    insert: async function() { return { _id: unitReleaseEvent._id }; },
    get: async function(collection, id) {
      if (id === event._id) return Object.assign({ _createdDate: new Date('2027-11-05T00:00:00.000Z') }, event);
      if (id === orphanUnitEvent._id) {
        return Object.assign({ _createdDate: new Date('2027-11-05T00:00:00.000Z') }, orphanUnitEvent);
      }
      return Object.assign({ _createdDate: new Date('2027-11-05T00:00:00.000Z') }, unitReleaseEvent);
    }
  };
  assertEqual(await appendReleases([unitReleaseEvent]), {
    state: 'CONFIRMED',
    confirmed: [{ eventId: unitReleaseEvent._id, disposition: 'inserted' }]
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
      if (id === event._id) return event;
      if (id === orphanUnitEvent._id) return orphanUnitEvent;
      return releaseEvent;
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

  const resourceManifestField = Object.assign({}, event, { manifestVersion: 1 });
  let resourceManifestFieldIo = 0;
  context.wixData = {
    insert: async function() { resourceManifestFieldIo += 1; return resourceManifestField; },
    get: async function() { resourceManifestFieldIo += 1; return resourceManifestField; }
  };
  assertEqual(await appendResources([resourceManifestField]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 0, eventId: resourceManifestField._id, classification: 'INTEGRITY' }
  }, 'manifest-only fields are forbidden on resource events');
  assertEqual(resourceManifestFieldIo, 0,
    'resource events carrying manifest metadata fail before Wix persistence');

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
    _id: 'rc1-20271105-u3-000002-a',
    generation: 2
  });
  const generationTwoOperation = Object.assign({}, operationEvent, {
    manifestResourceClaimIds: generationTwoCapacity._id + '|' + generationTwoUnit._id
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
    generationTwoOperation,
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
    payloadDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    manifestBookingRowIds: 'pb1-priorgenerationop01-r1',
    manifestResourceClaimIds: 'rc1-20271105-s1-000001-a|rc1-20271105-u3-000001-a'
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
  const priorCompletion = {
    _id: 'rc1-op-' + priorOperation.operationId + '-c',
    protocolVersion: 1,
    claimKey: 'operation:' + priorOperation.operationId + ':completion',
    generation: 1,
    eventType: 'complete',
    claimType: 'operation-completion',
    operationId: priorOperation.operationId,
    bookingRowId: priorOperation.bookingRowId,
    bookingNumber: priorOperation.bookingNumber,
    payloadDigest: priorOperation.payloadDigest,
    decisionFenceVersion: 1,
    completionState: 'complete',
    confirmedResourceCount: priorOperation.manifestResourceClaimIds.split('|').length
  };
  const priorDecision = {
    _id: 'rc1-op-' + priorOperation.operationId + '-d',
    protocolVersion: 1,
    claimKey: 'operation:' + priorOperation.operationId + ':decision',
    generation: 1,
    eventType: 'decide',
    claimType: 'operation-decision',
    operationId: priorOperation.operationId,
    bookingRowId: priorOperation.bookingRowId,
    bookingNumber: priorOperation.bookingNumber,
    payloadDigest: priorOperation.payloadDigest,
    decisionFenceVersion: 1,
    operationIdentityId: priorOperation._id,
    operationCompletionId: priorCompletion._id,
    manifestVersion: 1,
    completionState: priorCompletion.completionState,
    confirmedResourceCount: priorCompletion.confirmedResourceCount,
    decisionState: 'compensate'
  };
  const validGenerationStore = new Map([
    priorOperation,
    priorCompletion,
    priorDecision,
    priorCapacity,
    priorCapacityRelease,
    priorUnit,
    priorUnitRelease
  ].map(function(item) { return [item._id, item]; }));

  async function verifyRejectedGenerationHistory(items, message) {
    let writes = 0;
    context.wixData = {
      query: function() {
        return {
          limit: function() { return this; },
          find: async function() {
            return { items: items, hasNext: function() { return false; } };
          }
        };
      },
      insert: async function() { writes += 1; return {}; },
      get: async function() { return null; }
    };
    assertEqual(await context.adapter.appendRoomClaimEvents([
      generationTwoOperation,
      generationTwoCapacity,
      generationTwoUnit
    ]), {
      state: 'STOPPED',
      confirmed: [],
      failed: { index: 1, eventId: generationTwoCapacity._id, classification: 'INTEGRITY' }
    }, message);
    assertEqual(writes, 0, message + ' before persistence');
  }

  await verifyRejectedGenerationHistory([
    priorCapacity, priorCapacityRelease, priorUnit, priorUnitRelease
  ], 'released history without its permanent operation manifest cannot authorize generation two');

  await verifyRejectedGenerationHistory([
    priorOperation, priorCapacity, priorCapacityRelease, priorUnit, priorUnitRelease
  ], 'released history without its operation completion fence cannot authorize generation two');

  await verifyRejectedGenerationHistory([
    priorOperation, priorCompletion, priorCapacity, priorCapacityRelease,
    priorUnit, priorUnitRelease
  ], 'marked released history without its compensate decision cannot authorize generation two');

  const mismatchedPriorOperation = Object.assign({}, priorOperation, {
    manifestResourceClaimIds: 'rc1-20271105-s2-000001-a|rc1-20271105-u3-000001-a'
  });
  await verifyRejectedGenerationHistory([
    mismatchedPriorOperation, priorCapacity, priorCapacityRelease, priorUnit, priorUnitRelease
  ], 'released history omitted from its operation manifest cannot authorize generation two');

  const nonPrefixPriorOperation = Object.assign({}, priorOperation, {
    manifestCheckOut: '2027-11-07',
    manifestResourceClaimIds: [
      'rc1-20271105-s1-000001-a',
      'rc1-20271106-s1-000001-a',
      'rc1-20271105-u3-000001-a',
      'rc1-20271106-u3-000001-a'
    ].join('|')
  });
  await verifyRejectedGenerationHistory([
    nonPrefixPriorOperation, priorCapacity, priorCapacityRelease, priorUnit, priorUnitRelease
  ], 'non-prefix released operation history cannot authorize generation two');

  async function runGenerationIntrinsicProbe(targetSource) {
    return withReplacedVmIntrinsic(targetSource, async function(replacementSource) {
      const store = new Map(Array.from(validGenerationStore.entries()).map(function(entry) {
        return [entry[0], Object.assign({}, entry[1])];
      }));
      context.wixData = {
        query: function() {
          return {
            limit: function() { return this; },
            find: function() {
              return {
                then: function(resolve) {
                  vm.runInContext(replacementSource, context);
                  resolve({
                    items: Array.from(store.values()),
                    hasNext: function() { return false; }
                  });
                }
              };
            }
          };
        },
        insert: async function(collection, item) {
          store.set(item._id, Object.assign({}, item));
          return item;
        },
        get: async function(collection, id) { return store.get(id) || null; }
      };
      let result;
      let error = null;
      try {
        result = await context.adapter.appendRoomClaimEvents([
          generationTwoOperation, generationTwoCapacity, generationTwoUnit
        ]);
      } catch (caught) {
        error = caught;
      }
      return {
        error: error && error.message,
        state: result && result.state,
        classification: result && result.failed && result.failed.classification
      };
    });
  }

  const safeGenerationIntrinsicTargets = [
    'Object.assign', 'Math.floor', 'Set', 'Set.prototype.has'
  ];
  const safeGenerationIntrinsicResults = [];
  for (const targetSource of safeGenerationIntrinsicTargets) {
    safeGenerationIntrinsicResults.push({
      targetSource: targetSource,
      outcome: await runGenerationIntrinsicProbe(targetSource)
    });
  }
  assertEqual(safeGenerationIntrinsicResults,
    safeGenerationIntrinsicTargets.map(function(targetSource) {
      return {
        targetSource: targetSource,
        outcome: { error: null, state: 'CONFIRMED', classification: undefined }
      };
    }), 'post-ledger generation validation uses captured Object.assign, Math.floor, Set, and Set.has');

  const blockedGenerationIntrinsicTargets = ['String.prototype.match', 'Number'];
  const blockedGenerationIntrinsicResults = [];
  for (const targetSource of blockedGenerationIntrinsicTargets) {
    blockedGenerationIntrinsicResults.push({
      targetSource: targetSource,
      outcome: await runGenerationIntrinsicProbe(targetSource)
    });
  }
  const liveDispatchBlockerResults = {
    postDecisionRelease: blockedPostDecisionReleaseResults,
    generationHistory: blockedGenerationIntrinsicResults
  };
  const expectedCapturedDispatchResults = {
    postDecisionRelease: blockedPostDecisionReleaseTargets.map(function(targetSource) {
      return {
        targetSource: targetSource,
        outcome: { error: null, state: 'CONFIRMED', classification: undefined }
      };
    }),
    generationHistory: blockedGenerationIntrinsicTargets.map(function(targetSource) {
      return {
        targetSource: targetSource,
        outcome: { error: null, state: 'CONFIRMED', classification: undefined }
      };
    })
  };
  assertEqual(liveDispatchBlockerResults, expectedCapturedDispatchResults,
    'release and generation validation do not dispatch through live String.match or Number');

  const generationArrayIntrinsicProbes = [
    'Array.prototype.slice',
    'Array.prototype.forEach'
  ];
  const generationArrayProbeResults = [];
  for (const targetSource of generationArrayIntrinsicProbes) {
    generationArrayProbeResults.push({
      targetSource: targetSource,
      outcome: await withReplacedVmIntrinsic(targetSource, async function(replacementSource) {
        const store = new Map(Array.from(validGenerationStore.entries()).map(function(entry) {
          return [entry[0], Object.assign({}, entry[1])];
        }));
        context.wixData = {
          query: function() {
            return {
              limit: function() { return this; },
              find: function() {
                return {
                  then: function(resolve) {
                    vm.runInContext(replacementSource, context);
                    resolve({
                      items: Array.from(store.values()),
                      hasNext: function() { return false; }
                    });
                  }
                };
              }
            };
          },
          insert: async function(collection, item) {
            store.set(item._id, Object.assign({}, item));
            return item;
          },
          get: async function(collection, id) { return store.get(id) || null; }
        };
        let result;
        let error = null;
        try {
          result = await context.adapter.appendRoomClaimEvents([
            generationTwoOperation, generationTwoCapacity, generationTwoUnit
          ]);
        } catch (caught) {
          error = caught;
        }
        return { error: error && error.message, state: result && result.state };
      })
    });
  }
  assertEqual(generationArrayProbeResults, generationArrayIntrinsicProbes.map(function(targetSource) {
    return { targetSource: targetSource, outcome: { error: null, state: 'CONFIRMED' } };
  }), 'post-await generation-history validation uses captured Array intrinsic dispatch');

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
    generationTwoOperation,
    generationTwoCapacity,
    generationTwoUnit
  ]), {
    state: 'CONFIRMED',
    confirmed: [
      { eventId: generationTwoOperation._id, disposition: 'inserted' },
      { eventId: generationTwoCapacity._id, disposition: 'inserted' },
      { eventId: generationTwoUnit._id, disposition: 'inserted' }
    ]
  }, 'a complete released prior generation permits the next append-only acquisition');
  assertEqual(validGenerationWrites, 4,
    'valid generation history is checked before persistence and ends with its completion fence');

  let uncertainGenerationWrites = 0;
  context.wixData = {
    query: function() { throw new Error('ledger unavailable'); },
    insert: async function() { uncertainGenerationWrites += 1; return {}; },
    get: async function() { return null; }
  };
  assertEqual(await context.adapter.appendRoomClaimEvents([
    generationTwoOperation,
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
  assertEqual(await context.adapter.appendRoomClaimEvents([
    operationEvent,
    overflowGenerationEvent
  ]), {
    state: 'STOPPED',
    confirmed: [],
    failed: { index: 1, eventId: overflowGenerationEvent._id, classification: 'INTEGRITY' }
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
