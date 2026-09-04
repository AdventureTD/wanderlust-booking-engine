// Behavioral tests for authoritative completed-claim evidence loading.
// Run: node scripts/verify-room-booking-completed-claim-loader.js
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

let assertionCount = 0;

function assertEqual(actual, expected, message) {
  assertionCount += 1;
  const actualJson = JSON.stringify(comparable(actual));
  const expectedJson = JSON.stringify(comparable(expected));
  if (actualJson !== expectedJson) {
    throw new Error(`FAIL: ${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`);
  }
  console.log(`PASS: ${message}`);
}

function isOwnContractDataProperty(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return !!descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
    descriptor.writable === true && descriptor.enumerable === true && descriptor.configurable === true;
}

async function assertRecovery(run, operationId, message) {
  let error = null;
  try { await run(); } catch (caught) { error = caught; }
  assertEqual(error && { message: error.message, code: error.code, operationId: error.operationId }, {
    message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED', operationId: operationId
  }, message);
}

const backendDir = path.join(__dirname, '..', 'velo', 'backend');
const backendSourcePath = process.env.ROOM_BOOKING_COMMIT_SOURCE ||
  path.join(backendDir, 'roomBookingCommit.js');
const source = fs.readFileSync(backendSourcePath, 'utf8')
  .replace(/^import .*;\s*$/gm, '')
  .replace(/export async function /g, 'async function ')
  + '\nthis.loader = typeof loadCompletedRoomClaimSet === "function" ? loadCompletedRoomClaimSet : null;';
const context = { wixData: null };
vm.createContext(context);
vm.runInContext(source, context);

function buildEvidence(operationId, checkIn, checkOut, units) {
  const nights = [];
  for (let day = new Date(checkIn + 'T00:00:00.000Z'); day < new Date(checkOut + 'T00:00:00.000Z');
    day.setUTCDate(day.getUTCDate() + 1)) nights.push(day.toISOString().slice(0, 10));
  const bookingNumber = 'WC-7001';
  const payloadDigest = 'a'.repeat(64);
  const rowIds = units.map(function(unit, index) { return 'pb1-' + operationId + '-r' + (index + 1); });
  const acquisitions = [];
  nights.forEach(function(night) {
    units.forEach(function(unit, index) {
      acquisitions.push({
        _id: 'rc1-' + night.replace(/-/g, '') + '-s' + (index + 1) + '-000001-a',
        protocolVersion: 1, claimKey: 'capacity:' + night + ':' + (index + 1), generation: 1,
        eventType: 'acquire', claimType: 'capacity', night: night, capacitySlot: index + 1,
        operationId: operationId, bookingRowId: rowIds[index], bookingNumber: bookingNumber,
        payloadDigest: payloadDigest
      });
    });
  });
  nights.forEach(function(night) {
    units.forEach(function(unit, index) {
      acquisitions.push({
        _id: 'rc1-' + night.replace(/-/g, '') + '-u' + unit + '-000001-a',
        protocolVersion: 1, claimKey: 'unit:' + night + ':' + unit, generation: 1,
        eventType: 'acquire', claimType: 'unit', night: night, unit: unit,
        operationId: operationId, bookingRowId: rowIds[index], bookingNumber: bookingNumber,
        payloadDigest: payloadDigest
      });
    });
  });
  const identity = {
    _id: 'rc1-op-' + operationId + '-a', protocolVersion: 1,
    claimKey: 'operation:' + operationId, generation: 1, eventType: 'acquire', claimType: 'operation',
    operationId: operationId, bookingRowId: rowIds[0], bookingNumber: bookingNumber,
    payloadDigest: payloadDigest, manifestVersion: 1, manifestCheckIn: checkIn,
    manifestCheckOut: checkOut, manifestRoomCode: units.join(',') === '3' ? 'adventure_suite' : 'adventure_suite',
    manifestUnits: units.join(','), manifestBookingRowIds: rowIds.join('|'),
    manifestResourceClaimIds: acquisitions.map(function(event) { return event._id; }).join('|')
  };
  const completion = {
    _id: 'rc1-op-' + operationId + '-c', protocolVersion: 1,
    claimKey: 'operation:' + operationId + ':completion', generation: 1, eventType: 'complete',
    claimType: 'operation-completion', operationId: operationId, bookingRowId: rowIds[0],
    bookingNumber: bookingNumber, payloadDigest: payloadDigest, completionState: 'complete',
    confirmedResourceCount: acquisitions.length
  };
  return { identity, acquisitions, completion };
}

(async function() {
  assertEqual(typeof context.loader, 'function', 'adapter exports the completed-claim evidence loader');
  const expected = buildEvidence('abcdefghijklmnopqrstuv', '2027-11-05', '2027-11-06', [3]);
  const byId = Object.create(null);
  byId[expected.identity._id] = expected.identity;
  expected.acquisitions.forEach(function(event) { byId[event._id] = event; });
  byId[expected.completion._id] = expected.completion;
  const calls = [];
  context.wixData = {
    get: async function(collection, id, options) {
      calls.push({ collection, id, options });
      return Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null;
    },
    insert: function() { throw new Error('write forbidden'); },
    update: function() { throw new Error('write forbidden'); },
    remove: function() { throw new Error('write forbidden'); }
  };
  const actual = await context.loader(expected.identity.operationId);
  assertEqual(actual, expected, 'one-row completed evidence is returned densely and exactly');
  assertEqual(Object.getPrototypeOf(expected.identity) !== vm.runInContext('Object.prototype', context), true,
    'normal cross-realm Object.prototype evidence is accepted');
  assertEqual(calls.map(function(call) { return call.id; }), [
    expected.identity._id,
    expected.acquisitions[0]._id,
    expected.acquisitions[1]._id,
    expected.acquisitions[0]._id.slice(0, -1) + 'r',
    expected.acquisitions[1]._id.slice(0, -1) + 'r',
    expected.completion._id
  ], 'authoritative reads follow identity, manifest acquisitions, releases, completion order');
  assertEqual(calls.every(function(call) {
    return call.collection === 'RoomBookingClaimEvents' &&
      JSON.stringify(call.options) === JSON.stringify({ suppressAuth: true, consistentRead: true, suppressHooks: true });
  }), true, 'every evidence get is authoritative and hook-free');

  const metadataEvidence = buildEvidence('metadata12345678901234', '2027-11-05', '2027-11-06', [3]);
  const metadataRows = Object.create(null);
  function withWixMetadata(record, sequence) {
    return Object.assign({}, record, {
      _owner: '00000000-0000-0000-0000-000000000001',
      _createdDate: new Date('2027-01-01T00:00:00.000Z'),
      _updatedDate: new Date('2027-01-0' + sequence + 'T00:00:00.000Z')
    });
  }
  metadataRows[metadataEvidence.identity._id] = withWixMetadata(metadataEvidence.identity, 1);
  metadataEvidence.acquisitions.forEach(function(event, index) {
    metadataRows[event._id] = withWixMetadata(event, index + 2);
  });
  metadataRows[metadataEvidence.completion._id] = withWixMetadata(metadataEvidence.completion, 4);
  context.wixData = {
    get: async function(collection, id) {
      return Object.prototype.hasOwnProperty.call(metadataRows, id) ? metadataRows[id] : null;
    }
  };
  assertEqual(await context.loader(metadataEvidence.identity.operationId), metadataEvidence,
    'standard Wix owner and Date metadata are accepted and excluded from detached evidence');

  const immutableReads = buildEvidence('immutableoptions123', '2027-11-05', '2027-11-06', [3]);
  const immutableRows = Object.create(null);
  immutableRows[immutableReads.identity._id] = immutableReads.identity;
  immutableReads.acquisitions.forEach(function(event) { immutableRows[event._id] = event; });
  immutableRows[immutableReads.completion._id] = immutableReads.completion;
  const immutableCalls = [];
  const immutableReadOwner = {};
  const originalRead = function(collection, id, options) {
    if (this !== immutableReadOwner) throw new Error('captured read owner not used');
    immutableCalls.push({ collection, id, options });
    const value = Object.prototype.hasOwnProperty.call(immutableRows, id) ? immutableRows[id] : null;
    if (id !== immutableReads.identity._id) return Promise.resolve(value);
    return { then: function(resolve) {
      ['suppressAuth', 'consistentRead', 'suppressHooks'].forEach(function(key) {
        try { options[key] = false; } catch (error) {}
        try { Object.defineProperty(options, key, { value: false }); } catch (error) {}
      });
      context.wixData = {
        get: function() { throw new Error('live read dispatch used'); }
      };
      resolve(value);
    } };
  };
  immutableReadOwner.get = originalRead;
  context.wixData = immutableReadOwner;
  assertEqual(await context.loader(immutableReads.identity.operationId), immutableReads,
    'retained thenables cannot weaken later reads or replace captured read dispatch');
  assertEqual(immutableCalls.map(function(call) { return call.id; }), [immutableReads.identity._id]
    .concat(immutableReads.acquisitions.map(function(event) { return event._id; }))
    .concat(immutableReads.acquisitions.map(function(event) { return event._id.slice(0, -1) + 'r'; }))
    .concat([immutableReads.completion._id]),
  'immutable read options preserve the exact authoritative read order');
  const loaderObjectPrototype = vm.runInContext('Object.prototype', context);
  assertEqual(immutableCalls.every(function(call, index) {
    const descriptors = Object.getOwnPropertyDescriptors(call.options);
    return call.collection === 'RoomBookingClaimEvents' &&
      Object.getPrototypeOf(call.options) === loaderObjectPrototype &&
      Reflect.ownKeys(call.options).length === 3 &&
      ['suppressAuth', 'consistentRead', 'suppressHooks'].every(function(key) {
        const descriptor = descriptors[key];
        return descriptor && descriptor.value === true && descriptor.writable === false &&
          descriptor.enumerable === true && descriptor.configurable === false;
      }) && immutableCalls.every(function(other, otherIndex) {
        return index === otherIndex || call.options !== other.options;
      });
  }), true, 'every read receives a distinct ordinary options record with immutable true flags');

  function installEvidence(evidence, customize) {
    const rows = Object.create(null);
    rows[evidence.identity._id] = evidence.identity;
    evidence.acquisitions.forEach(function(event) { rows[event._id] = event; });
    rows[evidence.completion._id] = evidence.completion;
    const readCalls = [];
    context.wixData = {
      get: async function(collection, id, options) {
        readCalls.push({ collection, id, options });
        if (customize) return customize(id, rows, readCalls);
        return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
      },
      insert: function() { throw new Error('write forbidden'); },
      update: function() { throw new Error('write forbidden'); },
      remove: function() { throw new Error('write forbidden'); }
    };
    return { rows, readCalls };
  }

  function shouldRunB1(index) {
    return !process.env.B1_MUTATION_INDEX || Number(process.env.B1_MUTATION_INDEX) === index;
  }

  async function assertRejectedAtReadCount(evidence, expectedReads, message, customize) {
    const installed = installEvidence(evidence, customize);
    await assertRecovery(function() { return context.loader(evidence.identity.operationId); },
      evidence.identity.operationId, message);
    assertEqual(installed.readCalls.length, expectedReads, message + ' at the causal read boundary');
  }

  function replaceBookingNumber(evidence, bookingNumber) {
    evidence.identity.bookingNumber = bookingNumber;
    evidence.acquisitions.forEach(function(acquisition) {
      acquisition.bookingNumber = bookingNumber;
    });
    evidence.completion.bookingNumber = bookingNumber;
  }

  function replaceOrdinaryPrototypeKey(record, replacementName) {
    const prototype = Object.create(null);
    const descriptors = Object.getOwnPropertyDescriptors(Object.prototype);
    Reflect.ownKeys(descriptors).forEach(function(key) {
      if (key !== 'toLocaleString') Object.defineProperty(prototype, key, descriptors[key]);
    });
    Object.defineProperty(prototype, replacementName, descriptors.toLocaleString);
    return Object.assign(Object.create(prototype), record);
  }

  for (const ownerValue of [7, null, { id: 'owner' }]) {
    const invalidOwner = buildEvidence('metadataownerbad1234', '2027-11-05', '2027-11-06', [3]);
    invalidOwner.identity._owner = ownerValue;
    await assertRejectedAtReadCount(invalidOwner, 1,
      'non-string Wix owner metadata fails closed');
  }

  for (const dateCase of [
    ['_createdDate', new Date('invalid')],
    ['_updatedDate', '2027-01-01T00:00:00.000Z']
  ]) {
    const invalidMetadataDate = buildEvidence('metadatadatebad12345', '2027-11-05', '2027-11-06', [3]);
    invalidMetadataDate.identity[dateCase[0]] = dateCase[1];
    await assertRejectedAtReadCount(invalidMetadataDate, 1,
      'invalid Wix ' + dateCase[0] + ' metadata fails closed');
  }

  const accessorMetadata = buildEvidence('metadataaccessor1234', '2027-11-05', '2027-11-06', [3]);
  let metadataGetterCalls = 0;
  Object.defineProperty(accessorMetadata.identity, '_owner', {
    enumerable: true, configurable: true,
    get: function() {
      metadataGetterCalls += 1;
      return '00000000-0000-0000-0000-000000000001';
    }
  });
  await assertRejectedAtReadCount(accessorMetadata, 1,
    'Wix metadata accessors fail closed');
  assertEqual(metadataGetterCalls, 0, 'Wix metadata accessors are not executed');

  const nonEnumerableMetadata = buildEvidence('metadatanonenum12345', '2027-11-05', '2027-11-06', [3]);
  Object.defineProperty(nonEnumerableMetadata.identity, '_owner', {
    value: '00000000-0000-0000-0000-000000000001',
    writable: true, enumerable: false, configurable: true
  });
  await assertRejectedAtReadCount(nonEnumerableMetadata, 1,
    'non-enumerable Wix metadata fails closed');

  const unstableMetadata = buildEvidence('metadataunstable1234', '2027-11-05', '2027-11-06', [3]);
  unstableMetadata.identity._owner = '00000000-0000-0000-0000-000000000001';
  let ownerDescriptorReads = 0;
  unstableMetadata.identity = new Proxy(unstableMetadata.identity, {
    getOwnPropertyDescriptor: function(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (key === '_owner') {
        ownerDescriptorReads += 1;
        descriptor.value = ownerDescriptorReads === 1 ? descriptor.value :
          '00000000-0000-0000-0000-000000000002';
      }
      return descriptor;
    }
  });
  await assertRejectedAtReadCount(unstableMetadata, 1,
    'unstable Wix metadata descriptors fail closed');
  assertEqual(ownerDescriptorReads, 2, 'Wix metadata descriptors are sampled twice');

  const unknownMetadata = buildEvidence('metadataunknown12345', '2027-11-05', '2027-11-06', [3]);
  unknownMetadata.identity._deletedDate = new Date('2027-01-01T00:00:00.000Z');
  await assertRejectedAtReadCount(unknownMetadata, 1,
    'unrecognized Wix-like metadata fails closed');

  function keyPassVariant(record, changedPass, change) {
    const target = Object.assign({}, record);
    const baseKeys = Reflect.ownKeys(target);
    const extraSymbol = Symbol('unstable-key');
    let ownKeysCalls = 0;
    return {
      record: new Proxy(target, {
        ownKeys: function() {
          ownKeysCalls += 1;
          if (ownKeysCalls !== changedPass) return baseKeys.slice();
          if (change === 'unknown') return baseKeys.concat(['_deletedDate']);
          if (change === 'symbol') return baseKeys.concat([extraSymbol]);
          if (change === 'omitted') {
            return baseKeys.filter(function(key) { return key !== 'bookingNumber'; });
          }
          const reordered = baseKeys.slice();
          const first = reordered[0];
          reordered[0] = reordered[1];
          reordered[1] = first;
          return reordered;
        },
        getOwnPropertyDescriptor: function(object, key) {
          if (key === '_deletedDate') {
            return {
              value: new Date('2027-01-01T00:00:00.000Z'),
              writable: true, enumerable: true, configurable: true
            };
          }
          if (key === extraSymbol) {
            return { value: true, writable: true, enumerable: true, configurable: true };
          }
          return Object.getOwnPropertyDescriptor(object, key);
        }
      }),
      callCount: function() { return ownKeysCalls; }
    };
  }

  const keyPassNames = ['first descriptor', 'explicit key', 'second descriptor'];
  for (let passIndex = 0; passIndex < keyPassNames.length; passIndex += 1) {
    for (const change of ['unknown', 'symbol', 'omitted', 'reordered']) {
      const keyPassEvidence = buildEvidence(
        'keypass' + passIndex + change + '1234567890123456'.slice(change.length),
        '2027-11-05', '2027-11-06', [3]);
      const variant = keyPassVariant(keyPassEvidence.identity, passIndex + 1, change);
      keyPassEvidence.identity = variant.record;
      const message = change + ' keys appearing only in the ' + keyPassNames[passIndex] +
        ' pass fail closed';
      await assertRejectedAtReadCount(keyPassEvidence, 1, message);
      assertEqual(variant.callCount(), 3, message + ' after all three key-set samples');
    }
  }

  const omittedMetadata = buildEvidence('metadataomitted12345', '2027-11-05', '2027-11-06', [3]);
  const omittedFixture = installEvidence(omittedMetadata);
  assertEqual(await context.loader(omittedMetadata.identity.operationId), omittedMetadata,
    'all Wix system metadata keys remain optional');
  assertEqual(omittedFixture.readCalls.length, 6,
    'omitted Wix metadata completes the authoritative read sequence');

  for (const metadataRole of ['identity', 'acquisition', 'completion']) {
    const roleEvidence = buildEvidence('metadatarole' + metadataRole + '123456789'.slice(metadataRole.length),
      '2027-11-05', '2027-11-06', [3]);
    const roleRecord = metadataRole === 'identity' ? roleEvidence.identity :
      (metadataRole === 'acquisition' ? roleEvidence.acquisitions[0] : roleEvidence.completion);
    Object.assign(roleRecord, {
      _owner: '00000000-0000-0000-0000-000000000001',
      _createdDate: new Date('2027-01-01T00:00:00.000Z'),
      _updatedDate: new Date('2027-01-02T00:00:00.000Z')
    });
    installEvidence(roleEvidence);
    const roleOutput = await context.loader(roleEvidence.identity.operationId);
    const outputRecord = metadataRole === 'identity' ? roleOutput.identity :
      (metadataRole === 'acquisition' ? roleOutput.acquisitions[0] : roleOutput.completion);
    assertEqual(['_owner', '_createdDate', '_updatedDate'].every(function(key) {
      return !Object.prototype.hasOwnProperty.call(outputRecord, key);
    }), true, 'Wix metadata on ' + metadataRole + ' evidence is excluded from output');
  }

  const intrinsicMetadata = buildEvidence('metadataintrinsic12', '2027-11-05', '2027-11-06', [3]);
  const intrinsicMetadataExpected = buildEvidence('metadataintrinsic12', '2027-11-05', '2027-11-06', [3]);
  intrinsicMetadata.identity = withWixMetadata(intrinsicMetadata.identity, 1);
  intrinsicMetadata.acquisitions = intrinsicMetadata.acquisitions.map(function(record, index) {
    return withWixMetadata(record, index + 2);
  });
  intrinsicMetadata.completion = withWixMetadata(intrinsicMetadata.completion, 4);
  [intrinsicMetadata.identity].concat(intrinsicMetadata.acquisitions, [intrinsicMetadata.completion])
    .forEach(function(record, index) {
      record._createdDate = vm.runInContext("new Date('2027-01-01T00:00:00.000Z')", context);
      record._updatedDate = vm.runInContext("new Date('2027-01-0" + (index + 1) + "T00:00:00.000Z')", context);
    });
  let metadataIntrinsicMutationInstalled = false;
  installEvidence(intrinsicMetadata, function(id, rows) {
    const value = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    if (id !== intrinsicMetadata.identity._id || metadataIntrinsicMutationInstalled) return value;
    metadataIntrinsicMutationInstalled = true;
    return { then: function(resolve) {
      vm.runInContext(`
        this.savedMetadataDate = Date;
        this.savedMetadataGetTime = Date.prototype.getTime;
        this.savedMetadataNumberIsNaN = Number.isNaN;
        Date.prototype.getTime = function() { throw new Error('live Date#getTime dispatch'); };
        Number.isNaN = function() { throw new Error('live Number.isNaN dispatch'); };
        Date = new Proxy(Date, {
          get: function() { throw new Error('live Date dispatch'); },
          apply: function() { throw new Error('live Date dispatch'); },
          construct: function() { throw new Error('live Date dispatch'); }
        });
      `, context);
      resolve(value);
    } };
  });
  try {
    assertEqual(await context.loader(intrinsicMetadata.identity.operationId), intrinsicMetadataExpected,
      'captured Date#getTime and Number.isNaN validate metadata after await-time intrinsic mutation');
  } finally {
    vm.runInContext(`
      Date = savedMetadataDate;
      Date.prototype.getTime = savedMetadataGetTime;
      Number.isNaN = savedMetadataNumberIsNaN;
      delete savedMetadataDate;
      delete savedMetadataGetTime;
      delete savedMetadataNumberIsNaN;
    `, context);
  }

  for (const prototypeCase of [
    [45, 'unexpectedPrototypeName45'],
    [47, 'unexpectedPrototypeName47']
  ].filter(function(testCase) { return shouldRunB1(testCase[0]); })) {
    const evidence = buildEvidence('mutationcase0000' + prototypeCase[0],
      '2027-11-05', '2027-11-06', [3]);
    evidence.identity = replaceOrdinaryPrototypeKey(evidence.identity, prototypeCase[1]);
    await assertRejectedAtReadCount(evidence, 1,
      '[B1-' + prototypeCase[0] + '] unknown ordinary-prototype keys fail closed');
  }

  for (const textCase of [
    [52, ''],
    [53, ''],
    [55, 'X'.repeat(129)],
    [57, ' WC-7001 ']
  ].filter(function(testCase) { return shouldRunB1(testCase[0]); })) {
    const evidence = buildEvidence('mutationcase0000' + textCase[0],
      '2027-11-05', '2027-11-06', [3]);
    replaceBookingNumber(evidence, textCase[1]);
    await assertRejectedAtReadCount(evidence, 1,
      '[B1-' + textCase[0] + '] non-canonical booking text fails closed');
  }

  if (shouldRunB1(61)) {
    const nullStart = buildEvidence('mutationcase000061', '1970-01-01', '1970-01-02', [3]);
    nullStart.identity.manifestCheckIn = 'x';
    await assertRejectedAtReadCount(nullStart, 1,
      '[B1-61] an invalid manifest start cannot be coerced to the epoch');
  }

  if (shouldRunB1(63)) {
    const nullEnd = buildEvidence('mutationcase000063', '1969-12-31', '1970-01-01', [3]);
    nullEnd.identity.manifestCheckOut = 'x';
    await assertRejectedAtReadCount(nullEnd, 1,
      '[B1-63] an invalid manifest end cannot be coerced to the epoch');
  }

  if (shouldRunB1(73)) {
    const extraRow = buildEvidence('mutationcase000073', '2027-11-05', '2027-11-06', [3]);
    extraRow.identity.manifestBookingRowIds += '|pb1-' + extraRow.identity.operationId + '-r2';
    await assertRejectedAtReadCount(extraRow, 1,
      '[B1-73] extra manifest booking-row IDs fail closed');
  }

  if (shouldRunB1(88)) {
    const pollutedPriorUnit = buildEvidence('mutationcase000088', '2027-11-05', '2027-11-06', [3]);
    let priorUnitPollutionInstalled = false;
    const pollutedPriorUnitFixture = installEvidence(pollutedPriorUnit, function(id, rows) {
      const value = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
      if (id !== pollutedPriorUnit.identity._id || priorUnitPollutionInstalled) return value;
      priorUnitPollutionInstalled = true;
      return { then: function(resolve) {
        vm.runInContext("Object.defineProperty(Array.prototype, '-1', { value: 99, configurable: true });", context);
        resolve(value);
      } };
    });
    let pollutedPriorUnitError = null;
    let pollutedPriorUnitActual = null;
    try {
      try {
        pollutedPriorUnitActual = await context.loader(pollutedPriorUnit.identity.operationId);
      } catch (caught) {
        pollutedPriorUnitError = caught;
      }
      assertEqual(pollutedPriorUnitError, null,
        '[B1-88] first-unit validation ignores inherited negative array indices');
      assertEqual(pollutedPriorUnitActual, pollutedPriorUnit,
        '[B1-88] valid evidence remains exact under negative-index pollution');
      assertEqual(pollutedPriorUnitFixture.readCalls.length, 6,
        '[B1-88] valid evidence completes the authoritative read sequence');
    } finally {
      vm.runInContext("delete Array.prototype['-1'];", context);
    }
  }

  if (shouldRunB1(91)) {
    const arbitraryRows = buildEvidence('mutationcase000091', '2027-11-05', '2027-11-06', [3, 4]);
    const arbitraryRowIds = ['arbitrary-row-alpha', 'arbitrary-row-beta'];
    arbitraryRows.identity.manifestBookingRowIds = arbitraryRowIds.join('|');
    arbitraryRows.acquisitions.forEach(function(acquisition, index) {
      acquisition.bookingRowId = arbitraryRowIds[index % 2];
    });
    await assertRejectedAtReadCount(arbitraryRows, 1,
      '[B1-91] non-canonical manifest booking-row IDs fail closed');
  }

  if (shouldRunB1(98)) {
    const tooManyNights = buildEvidence('mutationcase000098', '2027-01-01', '2029-03-12', [3]);
    await assertRejectedAtReadCount(tooManyNights, 1,
      '[B1-98] manifests exceeding 800 nights fail closed');
  }

  if (shouldRunB1(108)) {
    const descendingSlots = buildEvidence('mutationcase000108', '2027-11-05', '2027-11-06', [3, 4]);
    descendingSlots.acquisitions[0]._id = 'rc1-20271105-s2-000001-a';
    descendingSlots.acquisitions[0].capacitySlot = 2;
    descendingSlots.acquisitions[0].claimKey = 'capacity:2027-11-05:2';
    descendingSlots.acquisitions[1]._id = 'rc1-20271105-s1-000001-a';
    descendingSlots.acquisitions[1].capacitySlot = 1;
    descendingSlots.acquisitions[1].claimKey = 'capacity:2027-11-05:1';
    descendingSlots.identity.manifestResourceClaimIds = descendingSlots.acquisitions
      .map(function(acquisition) { return acquisition._id; }).join('|');
    await assertRejectedAtReadCount(descendingSlots, 1,
      '[B1-108] descending capacity slots fail topology validation');
  }

  for (const topologyCase of [
    [111, 'not-a-unit-resource-id'],
    [112, 'rc1-20271106-u3-000001-a'],
    [114, 'rc1-20271106-u3-000001-a'],
    [116, 'rc1-20271105-u4-000001-a']
  ].filter(function(testCase) { return shouldRunB1(testCase[0]); })) {
    const evidence = buildEvidence('mutationcase000' + topologyCase[0],
      '2027-11-05', '2027-11-06', [3]);
    evidence.acquisitions[1]._id = topologyCase[1];
    evidence.identity.manifestResourceClaimIds = evidence.acquisitions
      .map(function(acquisition) { return acquisition._id; }).join('|');
    await assertRejectedAtReadCount(evidence, 1,
      '[B1-' + topologyCase[0] + '] malformed unit topology rejects before acquisition reads');
  }

  if (shouldRunB1(154)) {
    const substitutedAcquisition = buildEvidence('mutationcase000154',
      '2027-11-05', '2027-11-06', [3]);
    const requestedCapacityId = substitutedAcquisition.acquisitions[0]._id;
    const returnedCapacity = Object.assign({}, substitutedAcquisition.acquisitions[0], {
      _id: 'rc1-20271105-s2-000001-a',
      capacitySlot: 2,
      claimKey: 'capacity:2027-11-05:2'
    });
    await assertRejectedAtReadCount(substitutedAcquisition, 2,
      '[B1-154] a returned acquisition must own the requested manifest ID',
      function(id, rows) {
        if (id === requestedCapacityId) return returnedCapacity;
        return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
      });
  }

  for (const capacityCase of [
    [162, 'capacitySlot', 4],
    [163, 'capacitySlot', 4],
    [165, 'capacitySlot', 4],
    [167, 'generation', 2],
    [169, 'claimKey', 'capacity:WRONG']
  ].filter(function(testCase) { return shouldRunB1(testCase[0]); })) {
    const evidence = buildEvidence('mutationcase000' + capacityCase[0],
      '2027-11-05', '2027-11-06', [3]);
    evidence.acquisitions[0][capacityCase[1]] = capacityCase[2];
    await assertRejectedAtReadCount(evidence, 2,
      '[B1-' + capacityCase[0] + '] capacity acquisition fields bind to the manifest ID');
  }

  for (const unitCase of [
    [172, 'unit', 4],
    [173, 'unit', 4],
    [175, 'unit', 4],
    [177, 'generation', 2]
  ].filter(function(testCase) { return shouldRunB1(testCase[0]); })) {
    const evidence = buildEvidence('mutationcase000' + unitCase[0],
      '2027-11-05', '2027-11-06', [3]);
    evidence.acquisitions[1][unitCase[1]] = unitCase[2];
    await assertRejectedAtReadCount(evidence, 3,
      '[B1-' + unitCase[0] + '] unit acquisition fields bind to the manifest ID');
  }

  async function assertCapturedIntrinsic(caseName, mutationSource, restoreSource) {
    const evidence = buildEvidence(caseName, '2027-11-05', '2027-11-06', [3]);
    let mutated = false;
    const fixture = installEvidence(evidence, function(id, rows) {
      const value = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
      if (id !== evidence.identity._id || mutated) return value;
      mutated = true;
      return { then: function(resolve) {
        vm.runInContext(mutationSource, context);
        resolve(value);
      } };
    });
    try {
      assertEqual(await context.loader(evidence.identity.operationId), evidence,
        caseName + ' mutation cannot weaken successful evidence');
      assertEqual(fixture.readCalls.map(function(call) { return call.id; }), [evidence.identity._id]
        .concat(evidence.acquisitions.map(function(event) { return event._id; }))
        .concat(evidence.acquisitions.map(function(event) { return event._id.slice(0, -1) + 'r'; }))
        .concat([evidence.completion._id]), caseName + ' mutation preserves exact read order');
      assertEqual(fixture.readCalls.every(function(call, index) {
        const descriptors = Object.getOwnPropertyDescriptors(call.options);
        return call.collection === 'RoomBookingClaimEvents' &&
          ['suppressAuth', 'consistentRead', 'suppressHooks'].every(function(key) {
            const descriptor = descriptors[key];
            return descriptor && descriptor.value === true && descriptor.writable === false &&
              descriptor.enumerable === true && descriptor.configurable === false;
          }) && fixture.readCalls.every(function(other, otherIndex) {
            return index === otherIndex || call.options !== other.options;
          });
      }), true, caseName + ' mutation preserves immutable per-read options');
    } finally {
      vm.runInContext(restoreSource, context);
    }
  }

  await assertCapturedIntrinsic('objectintrinsic1', `
    this.savedObject = Object;
    this.savedHasOwnProperty = Object.prototype.hasOwnProperty;
    Object.prototype.hasOwnProperty = function() { throw new Error('live Object prototype dispatch'); };
    Object = new Proxy(Object, { get: function() { throw new Error('live Object dispatch'); },
      apply: function() { throw new Error('live Object dispatch'); },
      construct: function() { throw new Error('live Object dispatch'); } });
  `, `Object = savedObject; Object.prototype.hasOwnProperty = savedHasOwnProperty;
    delete savedObject; delete savedHasOwnProperty;`);
  await assertCapturedIntrinsic('arrayintrinsic12', `
    this.savedArray = Array;
    this.savedArrayPush = Array.prototype.push;
    Array.prototype.push = function() { throw new Error('live Array prototype dispatch'); };
    Array = new Proxy(Array, { get: function() { throw new Error('live Array dispatch'); },
      apply: function() { throw new Error('live Array dispatch'); },
      construct: function() { throw new Error('live Array dispatch'); } });
  `, `Array = savedArray; Array.prototype.push = savedArrayPush;
    delete savedArray; delete savedArrayPush;`);
  await assertCapturedIntrinsic('stringintrinsic1', `
    this.savedString = String;
    this.savedStringSlice = String.prototype.slice;
    this.savedStringSplit = String.prototype.split;
    this.savedStringTrim = String.prototype.trim;
    String.prototype.slice = String.prototype.split = String.prototype.trim =
      function() { throw new Error('live String prototype dispatch'); };
    String = new Proxy(String, { get: function() { throw new Error('live String dispatch'); },
      apply: function() { throw new Error('live String dispatch'); },
      construct: function() { throw new Error('live String dispatch'); } });
  `, `String = savedString; String.prototype.slice = savedStringSlice;
    String.prototype.split = savedStringSplit; String.prototype.trim = savedStringTrim;
    delete savedString; delete savedStringSlice; delete savedStringSplit; delete savedStringTrim;`);
  await assertCapturedIntrinsic('regexintrinsic12', `
    this.savedRegExp = RegExp;
    this.savedRegExpExec = RegExp.prototype.exec;
    this.savedRegExpTest = RegExp.prototype.test;
    RegExp.prototype.exec = RegExp.prototype.test =
      function() { throw new Error('live RegExp prototype dispatch'); };
    RegExp = new Proxy(RegExp, { get: function() { throw new Error('live RegExp dispatch'); },
      apply: function() { throw new Error('live RegExp dispatch'); },
      construct: function() { throw new Error('live RegExp dispatch'); } });
  `, `RegExp = savedRegExp; RegExp.prototype.exec = savedRegExpExec;
    RegExp.prototype.test = savedRegExpTest;
    delete savedRegExp; delete savedRegExpExec; delete savedRegExpTest;`);
  await assertCapturedIntrinsic('numberintrinsic1', `
    this.savedNumber = Number;
    Number = new Proxy(Number, { get: function() { throw new Error('live Number dispatch'); },
      apply: function() { throw new Error('live Number dispatch'); },
      construct: function() { throw new Error('live Number dispatch'); } });
  `, `Number = savedNumber; delete savedNumber;`);
  await assertCapturedIntrinsic('dateintrinsiccase', `
    this.savedDate = Date;
    this.savedDateGetTime = Date.prototype.getTime;
    this.savedDateToISOString = Date.prototype.toISOString;
    Date.prototype.getTime = Date.prototype.toISOString =
      function() { throw new Error('live Date prototype dispatch'); };
    Date = new Proxy(Date, { get: function() { throw new Error('live Date dispatch'); },
      apply: function() { throw new Error('live Date dispatch'); },
      construct: function() { throw new Error('live Date dispatch'); } });
  `, `Date = savedDate; Date.prototype.getTime = savedDateGetTime;
    Date.prototype.toISOString = savedDateToISOString;
    delete savedDate; delete savedDateGetTime; delete savedDateToISOString;`);
  await assertCapturedIntrinsic('reflectintrinsic1', `
    this.savedReflect = Reflect;
    Reflect = new Proxy(Reflect, { get: function() { throw new Error('live Reflect dispatch'); } });
  `, `Reflect = savedReflect; delete savedReflect;`);

  const errorIntrinsic = buildEvidence('errorintrinsic12', '2027-11-05', '2027-11-06', [3]);
  let errorMutationInstalled = false;
  installEvidence(errorIntrinsic, function(id, rows) {
    const value = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    if (id === errorIntrinsic.identity._id && !errorMutationInstalled) {
      errorMutationInstalled = true;
      return { then: function(resolve) {
        vm.runInContext(`this.savedError = Error;
          Error = new Proxy(Error, { get: function() { throw savedError('live Error dispatch'); },
            apply: function() { throw savedError('live Error dispatch'); },
            construct: function() { throw savedError('live Error dispatch'); } });`, context);
        resolve(value);
      } };
    }
    if (id === errorIntrinsic.acquisitions[0]._id) return null;
    return value;
  });
  try {
    await assertRecovery(function() { return context.loader(errorIntrinsic.identity.operationId); },
      errorIntrinsic.identity.operationId,
      'Error global replacement cannot bypass the exact recovery boundary after await');
  } finally {
    vm.runInContext('Error = savedError; delete savedError;', context);
  }

  const errorDefineIntrinsic = buildEvidence('errordefinecase12', '2027-11-05', '2027-11-06', [3]);
  let errorDefineMutationInstalled = false;
  installEvidence(errorDefineIntrinsic, function(id, rows) {
    const value = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    if (id === errorDefineIntrinsic.identity._id && !errorDefineMutationInstalled) {
      errorDefineMutationInstalled = true;
      return { then: function(resolve) {
        vm.runInContext(`this.savedObjectDefineProperties = Object.defineProperties;
          Object.defineProperties = function() { throw new Error('live defineProperties dispatch'); };`,
        context);
        resolve(value);
      } };
    }
    if (id === errorDefineIntrinsic.acquisitions[0]._id) return null;
    return value;
  });
  try {
    await assertRecovery(function() { return context.loader(errorDefineIntrinsic.identity.operationId); },
      errorDefineIntrinsic.identity.operationId,
      'Object.defineProperties replacement cannot corrupt recovery errors after await');
  } finally {
    vm.runInContext(`Object.defineProperties = savedObjectDefineProperties;
      delete savedObjectDefineProperties;`, context);
  }

  const multi = buildEvidence('multirowoperation1234', '2027-11-05', '2027-11-07', [3, 4, 5]);
  const multiFixture = installEvidence(multi);
  assertEqual(await context.loader(multi.identity.operationId), multi,
    'three-row multi-night evidence preserves exact manifest order');
  assertEqual(multiFixture.readCalls.map(function(call) { return call.id; }), [multi.identity._id]
    .concat(multi.acquisitions.map(function(event) { return event._id; }))
    .concat(multi.acquisitions.map(function(event) { return event._id.slice(0, -1) + 'r'; }))
    .concat([multi.completion._id]),
  'all multi-night acquisitions precede all release fences and completion');

  const objectOperationId = { value: 'abcdefghijklmnopqrstuv' };
  let objectOperationIo = 0;
  context.wixData = { get: async function() { objectOperationIo += 1; return null; } };
  await assertRecovery(function() { return context.loader(objectOperationId); }, objectOperationId,
    'non-string operationId objects fail at the recovery boundary');
  assertEqual(objectOperationIo, 0, 'non-string operationId objects are rejected before I/O');

  for (const invalidOperationId of [null, undefined, 7, '', 'short', 'has space operation']) {
    let io = 0;
    context.wixData = { get: async function() { io += 1; return null; } };
    await assertRecovery(function() { return context.loader(invalidOperationId); }, invalidOperationId,
      'non-canonical primitive operation IDs fail at the recovery boundary');
    assertEqual(io, 0, 'invalid operation IDs are rejected before I/O');
  }

  const identityCases = [
    ['missing identity', function() { return null; }],
    ['malformed identity', function(row) { row.extra = true; return row; }],
    ['foreign identity', function(row) { row.operationId = 'foreignoperation1234'; return row; }]
  ];
  for (const identityCase of identityCases) {
    const fixture = buildEvidence('identityoperation123', '2027-11-05', '2027-11-06', [3]);
    const changed = identityCase[1](Object.assign({}, fixture.identity));
    installEvidence(fixture, function(id, rows) {
      return id === fixture.identity._id ? changed :
        (Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null);
    });
    await assertRecovery(function() { return context.loader(fixture.identity.operationId); },
      fixture.identity.operationId, identityCase[0] + ' fails closed');
  }

  const identityProtocol = buildEvidence('identityprotocol1', '2027-11-05', '2027-11-06', [3]);
  identityProtocol.identity.protocolVersion = 2;
  installEvidence(identityProtocol);
  await assertRecovery(function() { return context.loader(identityProtocol.identity.operationId); },
    identityProtocol.identity.operationId, 'identity protocol version is independently required');

  const nonEnumerable = buildEvidence('nonenumerablecase12', '2027-11-05', '2027-11-06', [3]);
  Object.defineProperty(nonEnumerable.identity, 'bookingNumber', {
    value: nonEnumerable.identity.bookingNumber, writable: true, enumerable: false, configurable: true
  });
  installEvidence(nonEnumerable);
  await assertRecovery(function() { return context.loader(nonEnumerable.identity.operationId); },
    nonEnumerable.identity.operationId, 'non-enumerable evidence fields fail closed');

  const objectField = buildEvidence('objectfieldcase123', '2027-11-05', '2027-11-06', [3]);
  objectField.identity.bookingNumber = { text: 'WC-7001' };
  installEvidence(objectField);
  await assertRecovery(function() { return context.loader(objectField.identity.operationId); },
    objectField.identity.operationId, 'object-valued evidence fields fail closed');

  const functionField = buildEvidence('functionfieldcase1', '2027-11-05', '2027-11-06', [3]);
  functionField.acquisitions[0].bookingNumber = function() { return 'WC-7001'; };
  installEvidence(functionField);
  await assertRecovery(function() { return context.loader(functionField.identity.operationId); },
    functionField.identity.operationId, 'function-valued evidence fields fail closed');

  const alteredPrototype = buildEvidence('alteredprototype1', '2027-11-05', '2027-11-06', [3]);
  alteredPrototype.identity = Object.assign(Object.create({ marker: true }), alteredPrototype.identity);
  installEvidence(alteredPrototype);
  await assertRecovery(function() { return context.loader(alteredPrototype.identity.operationId); },
    alteredPrototype.identity.operationId, 'altered record prototypes fail closed');

  const alteredCurrentRealm = buildEvidence('alteredrealmproto1', '2027-11-05', '2027-11-06', [3]);
  context.identitySource = alteredCurrentRealm.identity;
  vm.runInContext(`
    this.currentRealmIdentity = Object.assign({}, identitySource);
    Object.defineProperty(Object.prototype, 'unexpectedEvidencePrototypeField', {
      value: true, configurable: true
    });
  `, context);
  installEvidence(alteredCurrentRealm, function(id, rows) {
    return id === alteredCurrentRealm.identity._id ? context.currentRealmIdentity :
      (Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null);
  });
  try {
    await assertRecovery(function() { return context.loader(alteredCurrentRealm.identity.operationId); },
      alteredCurrentRealm.identity.operationId, 'altered current-realm Object.prototype fails closed');
  } finally {
    vm.runInContext("delete Object.prototype.unexpectedEvidencePrototypeField", context);
  }

  const nonConfigurablePrototype = buildEvidence('prototypeconfig1', '2027-11-05', '2027-11-06', [3]);
  const alteredOrdinaryPrototype = Object.create(null);
  const alteredOrdinaryDescriptors = Object.getOwnPropertyDescriptors(Object.prototype);
  Reflect.ownKeys(alteredOrdinaryDescriptors).forEach(function(key) {
    const descriptor = Object.assign({}, alteredOrdinaryDescriptors[key]);
    if (key === 'toString') descriptor.configurable = false;
    Object.defineProperty(alteredOrdinaryPrototype, key, descriptor);
  });
  nonConfigurablePrototype.identity = Object.assign(
    Object.create(alteredOrdinaryPrototype), nonConfigurablePrototype.identity);
  installEvidence(nonConfigurablePrototype);
  await assertRecovery(function() { return context.loader(nonConfigurablePrototype.identity.operationId); },
    nonConfigurablePrototype.identity.operationId,
    'ordinary prototype descriptor configurable flag is independently required');

  const wrongManifestVersion = buildEvidence('manifestversion12', '2027-11-05', '2027-11-06', [3]);
  wrongManifestVersion.identity.manifestVersion = 2;
  installEvidence(wrongManifestVersion);
  await assertRecovery(function() { return context.loader(wrongManifestVersion.identity.operationId); },
    wrongManifestVersion.identity.operationId, 'unsupported manifest versions fail closed');

  const impossibleDate = buildEvidence('impossibledate123', '2027-03-02', '2027-03-03', [3]);
  // Date normalizes to 2027-03-02, so every derived field remains causally
  // consistent and only the canonical date round-trip can reject this row.
  impossibleDate.identity.manifestCheckIn = '2027-02-30';
  installEvidence(impossibleDate);
  await assertRecovery(function() { return context.loader(impossibleDate.identity.operationId); },
    impossibleDate.identity.operationId, 'impossible manifest dates fail closed');

  const intrinsicPrototype = buildEvidence('intrinsicprototype1', '2027-11-05', '2027-11-06', [3]);
  const incompleteOrdinaryPrototype = Object.create(null);
  const ordinaryDescriptors = Object.getOwnPropertyDescriptors(Object.prototype);
  Reflect.ownKeys(ordinaryDescriptors).forEach(function(key) {
    if (key !== 'toLocaleString') {
      Object.defineProperty(incompleteOrdinaryPrototype, key, ordinaryDescriptors[key]);
    }
  });
  const nonOrdinaryIdentity = Object.assign(
    Object.create(incompleteOrdinaryPrototype), intrinsicPrototype.identity);
  installEvidence(intrinsicPrototype, function(id, rows) {
    if (id !== intrinsicPrototype.identity._id) {
      return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    }
    return { then: function(resolve) {
      vm.runInContext(`
        this.originalJsonStringify = JSON.stringify;
        JSON.stringify = function() { return 'same'; };
      `, context);
      resolve(nonOrdinaryIdentity);
    } };
  });
  try {
    await assertRecovery(function() { return context.loader(intrinsicPrototype.identity.operationId); },
      intrinsicPrototype.identity.operationId,
      'thenable intrinsic mutation cannot admit a non-ordinary evidence prototype');
  } finally {
    vm.runInContext('JSON.stringify = originalJsonStringify; delete originalJsonStringify;', context);
  }

  const intrinsicPush = buildEvidence('intrinsicpushcase1', '2027-11-05', '2027-11-06', [3]);
  let pushMutationInstalled = false;
  const intrinsicPushFixture = installEvidence(intrinsicPush, function(id, rows) {
    const value = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    if (id !== intrinsicPush.acquisitions[0]._id || pushMutationInstalled) return value;
    pushMutationInstalled = true;
    return { then: function(resolve) {
      vm.runInContext(`
        this.originalArrayPush = Array.prototype.push;
        Array.prototype.push = function(value) {
          if (value && value.eventType === 'acquire' &&
              (value.claimType === 'capacity' || value.claimType === 'unit')) {
            return this.length;
          }
          return Reflect.apply(originalArrayPush, this, arguments);
        };
      `, context);
      resolve(value);
    } };
  });
  const seededReleaseId = intrinsicPush.acquisitions[0]._id.slice(0, -1) + 'r';
  intrinsicPushFixture.rows[seededReleaseId] = { malformed: true };
  try {
    await assertRecovery(function() { return context.loader(intrinsicPush.identity.operationId); },
      intrinsicPush.identity.operationId,
      'thenable array mutation cannot suppress an acquisition from successful evidence');
  } finally {
    vm.runInContext('Array.prototype.push = originalArrayPush; delete originalArrayPush;', context);
  }
  assertEqual(intrinsicPushFixture.readCalls.map(function(call) { return call.id; }),
    [intrinsicPush.identity._id]
      .concat(intrinsicPush.acquisitions.map(function(event) { return event._id; }))
      .concat([seededReleaseId]),
    'thenable array mutation cannot skip a manifested release read');

  const invalidDate = buildEvidence('invaliddatecase12', '2027-11-05', '2027-11-06', [3]);
  invalidDate.identity.manifestCheckOut = '2027-11-6';
  installEvidence(invalidDate);
  await assertRecovery(function() { return context.loader(invalidDate.identity.operationId); },
    invalidDate.identity.operationId, 'non-canonical manifest dates fail closed');

  const nightCountMismatch = buildEvidence('nightcountcase123', '2027-11-05', '2027-11-06', [3]);
  nightCountMismatch.identity.manifestCheckOut = '2027-11-07';
  installEvidence(nightCountMismatch);
  await assertRecovery(function() { return context.loader(nightCountMismatch.identity.operationId); },
    nightCountMismatch.identity.operationId, 'manifest resource counts must match the declared night count');

  const oversizedResources = buildEvidence('resourcesizecase1', '2027-11-05', '2027-11-06', [3]);
  oversizedResources.identity.manifestResourceClaimIds = 'x'.repeat(60001);
  installEvidence(oversizedResources);
  await assertRecovery(function() { return context.loader(oversizedResources.identity.operationId); },
    oversizedResources.identity.operationId, 'oversized manifest resource declarations fail closed');

  const wrongRoomAssignment = buildEvidence('roomassignment12', '2027-11-05', '2027-11-06', [3]);
  wrongRoomAssignment.identity.manifestRoomCode = 'penthouse_apartment';
  installEvidence(wrongRoomAssignment);
  await assertRecovery(function() { return context.loader(wrongRoomAssignment.identity.operationId); },
    wrongRoomAssignment.identity.operationId, 'room-to-unit assignment mismatches fail closed');

  const wrongBookingRows = buildEvidence('bookingrowcase123', '2027-11-05', '2027-11-06', [3, 4]);
  wrongBookingRows.identity.manifestBookingRowIds = [
    wrongBookingRows.identity.bookingRowId.replace(/r1$/, 'r2'), wrongBookingRows.identity.bookingRowId
  ].join('|');
  installEvidence(wrongBookingRows);
  await assertRecovery(function() { return context.loader(wrongBookingRows.identity.operationId); },
    wrongBookingRows.identity.operationId, 'manifest booking row IDs must be canonical and ordered');

  const wrongTopology = buildEvidence('topologycase12345', '2027-11-05', '2027-11-06', [3, 4]);
  const topologyIds = wrongTopology.identity.manifestResourceClaimIds.split('|');
  const firstTopologyId = topologyIds[0];
  topologyIds[0] = topologyIds[1];
  topologyIds[1] = firstTopologyId;
  wrongTopology.identity.manifestResourceClaimIds = topologyIds.join('|');
  installEvidence(wrongTopology);
  await assertRecovery(function() { return context.loader(wrongTopology.identity.operationId); },
    wrongTopology.identity.operationId, 'manifest resource topology must be canonical');

  const identityBinding = buildEvidence('identitybinding12', '2027-11-05', '2027-11-06', [3]);
  const foreignIdentity = buildEvidence('foreignbinding123', '2027-11-05', '2027-11-06', [3]).identity;
  installEvidence(identityBinding, function(id, rows) {
    return id === identityBinding.identity._id ? foreignIdentity :
      (Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null);
  });
  await assertRecovery(function() { return context.loader(identityBinding.identity.operationId); },
    identityBinding.identity.operationId, 'identity evidence must bind to the requested operation');

  const wrongAcquisitionDigest = buildEvidence('digestbindingcase1', '2027-11-05', '2027-11-06', [3]);
  wrongAcquisitionDigest.acquisitions[0].payloadDigest = 'b'.repeat(64);
  installEvidence(wrongAcquisitionDigest);
  await assertRecovery(function() { return context.loader(wrongAcquisitionDigest.identity.operationId); },
    wrongAcquisitionDigest.identity.operationId, 'acquisition digests must bind to the identity');

  const wrongAcquisitionNight = buildEvidence('nightbindingcase12', '2027-11-05', '2027-11-06', [3]);
  wrongAcquisitionNight.acquisitions[0].night = '2027-11-06';
  installEvidence(wrongAcquisitionNight);
  await assertRecovery(function() { return context.loader(wrongAcquisitionNight.identity.operationId); },
    wrongAcquisitionNight.identity.operationId, 'acquisition nights must bind to the manifest');

  const wrongAcquisitionRow = buildEvidence('rowbindingcase123', '2027-11-05', '2027-11-06', [3]);
  wrongAcquisitionRow.acquisitions[0].bookingRowId =
    'pb1-' + wrongAcquisitionRow.identity.operationId + '-r2';
  installEvidence(wrongAcquisitionRow);
  await assertRecovery(function() { return context.loader(wrongAcquisitionRow.identity.operationId); },
    wrongAcquisitionRow.identity.operationId, 'acquisition booking rows must bind to the manifest');

  const acquisitionEventType = buildEvidence('acquisitionevent1', '2027-11-05', '2027-11-06', [3]);
  acquisitionEventType.acquisitions[0].eventType = 'release';
  installEvidence(acquisitionEventType);
  await assertRecovery(function() { return context.loader(acquisitionEventType.identity.operationId); },
    acquisitionEventType.identity.operationId, 'acquisition event type is independently required');

  const invalidAcquisitionEvent = buildEvidence('invalideventcase12', '2027-11-05', '2027-11-06', [3]);
  invalidAcquisitionEvent.acquisitions[0].protocolVersion = 2;
  installEvidence(invalidAcquisitionEvent);
  await assertRecovery(function() { return context.loader(invalidAcquisitionEvent.identity.operationId); },
    invalidAcquisitionEvent.identity.operationId, 'generally invalid acquisition events fail closed');

  const undefinedRelease = buildEvidence('undefinedrelease1', '2027-11-05', '2027-11-06', [3]);
  installEvidence(undefinedRelease, function(id, rows) {
    if (/-r$/.test(id)) return undefined;
    return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
  });
  assertEqual(await context.loader(undefinedRelease.identity.operationId), undefinedRelease,
    'undefined release absence is explicitly accepted');

  for (let index = 0; index < multi.acquisitions.length; index += 1) {
    installEvidence(multi, function(id, rows) {
      if (id === multi.acquisitions[index]._id) return null;
      return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    });
    await assertRecovery(function() { return context.loader(multi.identity.operationId); },
      multi.identity.operationId, 'missing acquisition position ' + index + ' fails closed');

    const mismatch = Object.assign({}, multi.acquisitions[index], { bookingNumber: 'FOREIGN' });
    installEvidence(multi, function(id, rows) {
      if (id === multi.acquisitions[index]._id) return mismatch;
      return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    });
    await assertRecovery(function() { return context.loader(multi.identity.operationId); },
      multi.identity.operationId, 'mismatched acquisition position ' + index + ' fails closed');
  }

  for (let index = 0; index < multi.acquisitions.length; index += 1) {
    const releaseId = multi.acquisitions[index]._id.slice(0, -1) + 'r';
    installEvidence(multi, function(id, rows) {
      if (id === releaseId) return { malformed: true };
      return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    });
    await assertRecovery(function() { return context.loader(multi.identity.operationId); },
      multi.identity.operationId, 'any release row at position ' + index + ' fails closed');
  }

  const completionProtocol = buildEvidence('completionprotocol1', '2027-11-05', '2027-11-06', [3]);
  completionProtocol.completion.protocolVersion = 2;
  installEvidence(completionProtocol);
  await assertRecovery(function() { return context.loader(completionProtocol.identity.operationId); },
    completionProtocol.identity.operationId, 'completion protocol version is independently required');

  const completionCases = [
    ['missing', null],
    ['stopped', Object.assign({}, multi.completion, { completionState: 'stopped' })],
    ['wrong count', Object.assign({}, multi.completion, { confirmedResourceCount: 1 })],
    ['wrong identity', Object.assign({}, multi.completion, { operationId: 'foreignoperation1234' })],
    ['wrong digest', Object.assign({}, multi.completion, { payloadDigest: 'b'.repeat(64) })],
    ['wrong booking', Object.assign({}, multi.completion, { bookingNumber: 'FOREIGN' })]
  ];
  for (const completionCase of completionCases) {
    installEvidence(multi, function(id, rows) {
      if (id === multi.completion._id) return completionCase[1];
      return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    });
    await assertRecovery(function() { return context.loader(multi.identity.operationId); },
      multi.identity.operationId, completionCase[0] + ' completion fails closed');
  }

  const exceptionIds = [
    multi.identity._id,
    multi.acquisitions[4]._id,
    multi.acquisitions[7]._id.slice(0, -1) + 'r',
    multi.completion._id
  ];
  for (const exceptionId of exceptionIds) {
    installEvidence(multi, function(id, rows) {
      if (id === exceptionId) throw new Error('read failed');
      return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    });
    await assertRecovery(function() { return context.loader(multi.identity.operationId); },
      multi.identity.operationId, 'read exception at ' + exceptionId + ' fails closed');
  }

  const hostileBase = buildEvidence('hostileoperation123', '2027-11-05', '2027-11-06', [3]);
  const hostileRows = [];
  const getterRow = Object.assign({}, hostileBase.identity);
  let getterCalls = 0;
  Object.defineProperty(getterRow, 'bookingNumber', {
    enumerable: true, configurable: true,
    get: function() { getterCalls += 1; return hostileBase.identity.bookingNumber; }
  });
  hostileRows.push(['accessor', getterRow]);
  hostileRows.push(['inherited prototype', Object.assign(Object.create({ inherited: true }), hostileBase.identity)]);
  hostileRows.push(['null prototype', Object.assign(Object.create(null), hostileBase.identity)]);
  const symbolRow = Object.assign({}, hostileBase.identity);
  symbolRow[Symbol('hidden')] = true;
  hostileRows.push(['symbol', symbolRow]);
  hostileRows.push(['extra field', Object.assign({}, hostileBase.identity, { extra: true })]);
  hostileRows.push(['sparse array', Object.assign([], hostileBase.identity)]);
  let unstableOwnKeysCalls = 0;
  const unstableOwnKeysTarget = Object.assign({}, hostileBase.identity);
  hostileRows.push(['unstable own keys', new Proxy(unstableOwnKeysTarget, {
    ownKeys: function(target) {
      unstableOwnKeysCalls += 1;
      const keys = Reflect.ownKeys(target);
      return unstableOwnKeysCalls === 1 ? keys.concat(['_deletedDate']) : keys;
    },
    getOwnPropertyDescriptor: function(target, key) {
      if (key === '_deletedDate') {
        return {
          value: new Date('2027-01-01T00:00:00.000Z'),
          writable: true, enumerable: true, configurable: true
        };
      }
      return Object.getOwnPropertyDescriptor(target, key);
    }
  })]);
  let descriptorFlip = false;
  hostileRows.push(['descriptor disagreement', new Proxy(Object.assign({}, hostileBase.identity), {
    getOwnPropertyDescriptor: function(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (key === 'bookingNumber') {
        descriptorFlip = !descriptorFlip;
        descriptor.value = descriptorFlip ? target[key] : 'DISAGREEMENT';
      }
      return descriptor;
    }
  })]);
  for (const hostileRow of hostileRows) {
    installEvidence(hostileBase, function(id, rows) {
      if (id === hostileBase.identity._id) return hostileRow[1];
      return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
    });
    await assertRecovery(function() { return context.loader(hostileBase.identity.operationId); },
      hostileBase.identity.operationId, 'hostile ' + hostileRow[0] + ' identity fails closed');
  }
  assertEqual(getterCalls, 0, 'hostile identity getters are not executed');

  const hostileAcquisition = Object.assign({}, hostileBase.acquisitions[0]);
  let acquisitionGetterCalls = 0;
  Object.defineProperty(hostileAcquisition, 'bookingNumber', {
    enumerable: true, configurable: true,
    get: function() { acquisitionGetterCalls += 1; return hostileBase.acquisitions[0].bookingNumber; }
  });
  installEvidence(hostileBase, function(id, rows) {
    if (id === hostileBase.acquisitions[0]._id) return hostileAcquisition;
    return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
  });
  await assertRecovery(function() { return context.loader(hostileBase.identity.operationId); },
    hostileBase.identity.operationId, 'hostile acquisition accessors fail closed');
  assertEqual(acquisitionGetterCalls, 0, 'hostile acquisition getters are not executed');

  const hostileCompletion = Object.assign({}, hostileBase.completion);
  hostileCompletion[Symbol('hidden')] = true;
  installEvidence(hostileBase, function(id, rows) {
    if (id === hostileBase.completion._id) return hostileCompletion;
    return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
  });
  await assertRecovery(function() { return context.loader(hostileBase.identity.operationId); },
    hostileBase.identity.operationId, 'hostile completion symbols fail closed');

  const nestedDateIdentity = Object.assign({}, hostileBase.identity, { bookingNumber: new Date() });
  installEvidence(hostileBase, function(id, rows) {
    if (id === hostileBase.identity._id) return nestedDateIdentity;
    return Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
  });
  await assertRecovery(function() { return context.loader(hostileBase.identity.operationId); },
    hostileBase.identity.operationId, 'Date-like nested values fail closed');

  const detached = buildEvidence('detachedoperation12', '2027-11-05', '2027-11-06', [3]);
  installEvidence(detached);
  const detachedOutput = await context.loader(detached.identity.operationId);
  detached.identity.bookingNumber = 'MUTATED INPUT';
  detached.acquisitions[0].bookingNumber = 'MUTATED INPUT';
  detached.completion.bookingNumber = 'MUTATED INPUT';
  assertEqual(detachedOutput.identity.bookingNumber, 'WC-7001', 'identity output is detached');
  assertEqual(detachedOutput.acquisitions[0].bookingNumber, 'WC-7001', 'acquisition output is detached');
  assertEqual(detachedOutput.completion.bookingNumber, 'WC-7001', 'completion output is detached');

  const polluted = buildEvidence('pollutedprototype12', '2027-11-05', '2027-11-06', [3]);
  installEvidence(polluted);
  vm.runInContext(`
    this.pollutionHookCalls = 0;
    ['bookingNumber', 'identity', 'acquisitions', 'completion'].forEach(function(key) {
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        get: key === 'bookingNumber' ? function() { return 'WC-7001'; } : undefined,
        set: function() { pollutionHookCalls += 1; }
      });
    });
  `, context);
  let pollutedOutput;
  try {
    pollutedOutput = await context.loader(polluted.identity.operationId);
  } finally {
    vm.runInContext(`
      ['bookingNumber', 'identity', 'acquisitions', 'completion'].forEach(function(key) {
        delete Object.prototype[key];
      });
    `, context);
  }
  assertEqual(context.pollutionHookCalls, 0,
    'polluted Object.prototype accessors are never executed while materializing evidence');
  assertEqual(['identity', 'acquisitions', 'completion'].every(function(key) {
    return isOwnContractDataProperty(pollutedOutput, key);
  }), true, 'outer evidence result owns every data-property contract field under prototype pollution');
  assertEqual([pollutedOutput.identity].concat(pollutedOutput.acquisitions, [pollutedOutput.completion])
    .every(function(record) {
      return Object.keys(record).every(function(key) { return isOwnContractDataProperty(record, key); });
    }), true, 'every evidence record owns copied data-property fields under prototype pollution');

  const hostileReadError = {};
  Object.defineProperty(hostileReadError, 'code', {
    get: function() { throw new Error('caller hook executed'); }
  });
  context.wixData = { get: async function() { throw hostileReadError; } };
  await assertRecovery(function() { return context.loader(expected.identity.operationId); },
    expected.identity.operationId, 'hostile read exceptions collapse to the recovery-required boundary');

  vm.runInContext(`
    this.recoveryPollutionHookCalls = 0;
    ['code', 'operationId'].forEach(function(key) {
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        set: function() { recoveryPollutionHookCalls += 1; }
      });
    });
  `, context);
  context.wixData = { get: async function() { throw new Error('read failed'); } };
  let recoveryError;
  try {
    await context.loader(expected.identity.operationId);
  } catch (caught) {
    recoveryError = caught;
  } finally {
    vm.runInContext(`
      ['code', 'operationId'].forEach(function(key) { delete Object.prototype[key]; });
    `, context);
  }
  assertEqual(context.recoveryPollutionHookCalls, 0,
    'polluted Object.prototype accessors are never executed while creating recovery errors');
  assertEqual(['code', 'operationId'].every(function(key) {
    return isOwnContractDataProperty(recoveryError, key);
  }), true, 'recovery errors own their data-property contract fields under prototype pollution');
  console.log('TOTAL ASSERTIONS: ' + assertionCount);
})().catch(function(error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
