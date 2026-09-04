// Behavioral tests for the disconnected physical-booking coordinator tracer.
// Run: node scripts/verify-room-booking-coordinator.js
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

async function captureRejection(run) {
  try { await run(); } catch (error) { return error; }
  throw new Error('FAIL: expected coordinator rejection');
}

const sourcePath = path.join(__dirname, '..', 'velo', 'backend', 'roomBookingCoordinator.js');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/export async function /g, 'async function ')
  + '\nthis.coordinator = { coordinatePhysicalBookingCommit };';
const context = { Date, Object, Error };
vm.createContext(context);
vm.runInContext(source, context);

const operationId = 'coordinatortrace01';
const payloadDigest = '1'.repeat(64);
const bookingRowId = 'pb1-' + operationId + '-r1';
const capacityClaimId = 'rc1-20271105-s1-000001-a';
const unitClaimId = 'rc1-20271105-u3-000001-a';
const plan = {
  acquisitions: [
    {
      _id: 'rc1-op-' + operationId + '-a',
      protocolVersion: 1,
      claimKey: 'operation:' + operationId,
      generation: 1,
      eventType: 'acquire',
      claimType: 'operation',
      operationId,
      bookingRowId,
      bookingNumber: 'WC-3001',
      payloadDigest,
      manifestVersion: 1,
      manifestCheckIn: '2027-11-05',
      manifestCheckOut: '2027-11-06',
      manifestRoomCode: 'adventure_suite',
      manifestUnits: '3',
      manifestBookingRowIds: bookingRowId,
      manifestResourceClaimIds: capacityClaimId + '|' + unitClaimId
    },
    {
      _id: capacityClaimId,
      protocolVersion: 1,
      claimKey: 'capacity:2027-11-05:1',
      generation: 1,
      eventType: 'acquire',
      claimType: 'capacity',
      night: '2027-11-05',
      capacitySlot: 1,
      operationId,
      bookingRowId,
      bookingNumber: 'WC-3001',
      payloadDigest
    },
    {
      _id: unitClaimId,
      protocolVersion: 1,
      claimKey: 'unit:2027-11-05:3',
      generation: 1,
      eventType: 'acquire',
      claimType: 'unit',
      night: '2027-11-05',
      unit: 3,
      operationId,
      bookingRowId,
      bookingNumber: 'WC-3001',
      payloadDigest
    }
  ],
  bookingRows: [{
    _id: 'pb1-' + operationId + '-r1',
    roomCode: 'adventure_suite',
    assignedRoom: 3,
    quantity: 1,
    checkIn: '2027-11-05',
    checkOut: '2027-11-06',
    bookingNumber: 'WC-3001',
    operationId,
    payloadDigest
  }],
  primaryRowId: bookingRowId
};
const trustedBookingFields = {
  _id: 'caller-controlled-id',
  roomCode: 'caller-controlled-room',
  assignedRoom: 5,
  quantity: 99,
  status: 'pending',
  autoOwnerBlock: true,
  bookingNumber: 'caller-controlled-number',
  checkIn: new Date('1999-01-01T12:00:00.000Z'),
  checkOut: new Date('1999-01-02T12:00:00.000Z'),
  operationId: 'caller-controlled-operation',
  payloadDigest: 'f'.repeat(64),
  guests: 2,
  roomFee: 175,
  note: ''
};
const expectedRow = {
  _id: 'pb1-' + operationId + '-r1',
  roomCode: 'adventure_suite',
  assignedRoom: 3,
  quantity: 1,
  checkIn: new Date('2027-11-05T12:00:00.000Z'),
  checkOut: new Date('2027-11-06T12:00:00.000Z'),
  bookingNumber: 'WC-3001',
  operationId,
  payloadDigest,
  status: 'confirmed',
  autoOwnerBlock: false,
  guests: 2,
  roomFee: 175,
  note: ''
};

function confirmedClaims(events) {
  return {
    state: 'CONFIRMED',
    confirmed: events.map(function(event) {
      return { eventId: event._id, disposition: 'inserted' };
    })
  };
}

function confirmedRows(rows) {
  return {
    state: 'CONFIRMED',
    confirmed: rows.map(function(row) {
      return { rowId: row._id, disposition: 'inserted' };
    })
  };
}

(async function() {
  const calls = [];
  const result = await context.coordinator.coordinatePhysicalBookingCommit(
    plan,
    trustedBookingFields,
    {
      appendClaimEvents: async function(events) {
        calls.push({ port: 'appendClaimEvents', value: events });
        return {
          state: 'CONFIRMED',
          confirmed: events.map(function(event) {
            return { eventId: event._id, disposition: 'inserted' };
          })
        };
      },
      appendBookingRows: async function(rows) {
        calls.push({ port: 'appendBookingRows', value: rows });
        return {
          state: 'CONFIRMED',
          confirmed: rows.map(function(row) {
            return { rowId: row._id, disposition: 'inserted' };
          })
        };
      }
    }
  );
  assertEqual(result, expectedRow,
    'successful coordination returns the primary booking-like row directly');
  assertEqual(calls, [
    { port: 'appendClaimEvents', value: plan.acquisitions },
    { port: 'appendBookingRows', value: [expectedRow] }
  ], 'claims confirm before the exact forced booking row is persisted');
  assertEqual({
    checkInType: typeof calls[1].value[0].checkIn,
    checkIn: calls[1].value[0].checkIn,
    checkOutType: typeof calls[1].value[0].checkOut,
    checkOut: calls[1].value[0].checkOut
  }, {
    checkInType: 'string',
    checkIn: '2027-11-05T12:00:00.000Z',
    checkOutType: 'string',
    checkOut: '2027-11-06T12:00:00.000Z'
  }, 'booking-row port receives immutable canonical timestamp primitives');
  assertEqual(result.bookingNumber, 'WC-3001',
    'the top-level result keeps bookingNumber directly usable by Booking Summary');

  const originalPlanSnapshot = comparable(plan);
  let mutationRowCalls = 0;
  let receivedDetachedSnapshot = false;
  let receivedFrozenSnapshot = false;
  const mutationError = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function(events) {
        receivedDetachedSnapshot = events !== plan.acquisitions &&
          events.every(function(event, index) { return event !== plan.acquisitions[index]; });
        receivedFrozenSnapshot = Object.isFrozen(events) &&
          events.every(function(event) { return Object.isFrozen(event); });
        events[0]._id = 'port-mutated-operation-id';
        events[1]._id = 'port-mutated-capacity-id';
        return {
          state: 'CONFIRMED',
          confirmed: events.map(function(event, index) {
            return {
              eventId: index === 1 ? 'port-tampered-capacity-id' : event._id,
              disposition: 'inserted'
            };
          })
        };
      },
      appendBookingRows: async function() { mutationRowCalls += 1; }
    });
  });
  assertEqual({
    code: mutationError.code,
    operationId: mutationError.operationId,
    rowCalls: mutationRowCalls,
    detached: receivedDetachedSnapshot,
    frozen: receivedFrozenSnapshot,
    plan: comparable(plan)
  }, {
    code: 'RECOVERY_REQUIRED',
    operationId,
    rowCalls: 0,
    detached: true,
    frozen: true,
    plan: originalPlanSnapshot
  }, 'claim-port mutation and tampered confirmation cannot alter the plan or reach row persistence');

  const originalCheckout = plan.bookingRows[0].checkOut;
  let delayedConstructionRows = null;
  const delayedConstructionResult = await context.coordinator.coordinatePhysicalBookingCommit(
    plan,
    trustedBookingFields,
    {
      appendClaimEvents: async function(events) {
        plan.bookingRows[0].checkOut = '2027-11-07';
        return confirmedClaims(events);
      },
      appendBookingRows: async function(rows) {
        delayedConstructionRows = comparable(rows);
        return confirmedRows(rows);
      }
    }
  );
  plan.bookingRows[0].checkOut = originalCheckout;
  assertEqual({ result: delayedConstructionResult, rows: delayedConstructionRows }, {
    result: expectedRow,
    rows: [expectedRow]
  }, 'booking rows are fully snapshotted before claim-port I/O');

  const originalCallerAcquisitionId = plan.acquisitions[1]._id;
  let callerAcquisitionMutationRowCalls = 0;
  const callerAcquisitionMutationError = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function() {
        plan.acquisitions[1]._id = 'caller-mutated-after-validation';
        return confirmedClaims(plan.acquisitions);
      },
      appendBookingRows: async function() { callerAcquisitionMutationRowCalls += 1; }
    });
  });
  plan.acquisitions[1]._id = originalCallerAcquisitionId;
  assertEqual({
    code: callerAcquisitionMutationError.code,
    operationId: callerAcquisitionMutationError.operationId,
    rowCalls: callerAcquisitionMutationRowCalls
  }, {
    code: 'RECOVERY_REQUIRED', operationId, rowCalls: 0
  }, 'post-await confirmation never re-reads caller-owned acquisition IDs');

  let receivedFrozenRows = false;
  const rowMutationError = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function(events) { return confirmedClaims(events); },
      appendBookingRows: async function(persistedRows) {
        receivedFrozenRows = Object.isFrozen(persistedRows) &&
          persistedRows.every(function(row) { return Object.isFrozen(row); });
        persistedRows[0]._id = 'port-mutated-row-id';
        return {
          state: 'CONFIRMED',
          confirmed: [{ rowId: 'port-tampered-row-id', disposition: 'inserted' }]
        };
      }
    });
  });
  assertEqual({
    code: rowMutationError.code,
    operationId: rowMutationError.operationId,
    frozen: receivedFrozenRows
  }, {
    code: 'RECOVERY_REQUIRED',
    operationId,
    frozen: true
  }, 'booking-row port mutation cannot change the expected row identity or returned result');

  const mutableDateError = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function(events) { return confirmedClaims(events); },
      appendBookingRows: async function(persistedRows) {
        persistedRows[0].checkIn.setUTCFullYear(2035);
        return confirmedRows(persistedRows);
      }
    });
  });
  assertEqual({
    code: mutableDateError.code,
    operationId: mutableDateError.operationId,
    plan: comparable(plan)
  }, {
    code: 'RECOVERY_REQUIRED',
    operationId,
    plan: originalPlanSnapshot
  }, 'booking-row port cannot treat the immutable check-in timestamp as a mutable Date');

  const mutableCheckoutError = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function(events) { return confirmedClaims(events); },
      appendBookingRows: async function(persistedRows) {
        persistedRows[0].checkOut.setUTCDate(persistedRows[0].checkOut.getUTCDate() + 1);
        return confirmedRows(persistedRows);
      }
    });
  });
  assertEqual({
    code: mutableCheckoutError.code,
    operationId: mutableCheckoutError.operationId,
    plan: comparable(plan)
  }, {
    code: 'RECOVERY_REQUIRED',
    operationId,
    plan: originalPlanSnapshot
  }, 'booking-row port cannot treat the immutable check-out timestamp as a mutable Date');

  let sparseClaimRowCalls = 0;
  const sparseClaim = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(
      plan,
      trustedBookingFields,
      {
        appendClaimEvents: async function() {
          const inherited = confirmedClaims(plan.acquisitions).confirmed;
          const sparse = new Array(inherited.length);
          Object.setPrototypeOf(sparse, inherited);
          return { state: 'CONFIRMED', confirmed: sparse };
        },
        appendBookingRows: async function(rows) {
          sparseClaimRowCalls += 1;
          return {
            state: 'CONFIRMED',
            confirmed: rows.map(function(row) {
              return { rowId: row._id, disposition: 'inserted' };
            })
          };
        }
      }
    );
  });
  assertEqual({
    code: sparseClaim.code,
    operationId: sparseClaim.operationId,
    rowCalls: sparseClaimRowCalls
  }, {
    code: 'RECOVERY_REQUIRED',
    operationId,
    rowCalls: 0
  }, 'a sparse claim confirmation cannot skip validation or reach booking-row persistence');

  const malformedConfirmations = [
    ['non-object result', null],
    ['non-array confirmed value', { state: 'CONFIRMED', confirmed: {} }],
    ['unexpected outer property', Object.assign(confirmedClaims(plan.acquisitions), { extra: true })],
    ['unexpected outer symbol', (function() {
      const value = confirmedClaims(plan.acquisitions);
      value[Symbol('extra')] = true;
      return value;
    })()],
    ['extra confirmation', (function() {
      const value = confirmedClaims(plan.acquisitions);
      value.confirmed.push({ eventId: 'extra', disposition: 'inserted' });
      return value;
    })()],
    ['unexpected array property', (function() {
      const value = confirmedClaims(plan.acquisitions);
      value.confirmed.extra = true;
      return value;
    })()]
  ];
  for (const malformed of malformedConfirmations) {
    let malformedRowCalls = 0;
    const error = await captureRejection(function() {
      return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
        appendClaimEvents: async function() { return malformed[1]; },
        appendBookingRows: async function() { malformedRowCalls += 1; }
      });
    });
    assertEqual({ message: error.message, code: error.code, operationId: error.operationId,
      rowCalls: malformedRowCalls }, {
      message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED', operationId, rowCalls: 0
    }, 'malformed confirmation maps to exact recovery metadata: ' + malformed[0]);
  }

  let outerAccessorCalls = 0;
  let outerAccessorRowCalls = 0;
  const outerAccessor = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function() {
        return Object.defineProperty({}, 'state', {
          enumerable: true,
          get: function() { outerAccessorCalls += 1; throw new Error('outer accessor executed'); }
        });
      },
      appendBookingRows: async function() { outerAccessorRowCalls += 1; }
    });
  });
  assertEqual({ message: outerAccessor.message, code: outerAccessor.code,
    operationId: outerAccessor.operationId, accessorCalls: outerAccessorCalls,
    rowCalls: outerAccessorRowCalls }, {
    message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED', operationId,
    accessorCalls: 0, rowCalls: 0
  }, 'outer confirmation accessors are not executed and map to recovery');

  let indexAccessorCalls = 0;
  let indexAccessorRowCalls = 0;
  const indexAccessor = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function(events) {
        const confirmed = confirmedClaims(events).confirmed;
        Object.defineProperty(confirmed, '0', {
          enumerable: true,
          get: function() { indexAccessorCalls += 1; throw new Error('index accessor executed'); }
        });
        return { state: 'CONFIRMED', confirmed };
      },
      appendBookingRows: async function() { indexAccessorRowCalls += 1; }
    });
  });
  assertEqual({ message: indexAccessor.message, code: indexAccessor.code,
    operationId: indexAccessor.operationId, accessorCalls: indexAccessorCalls,
    rowCalls: indexAccessorRowCalls }, {
    message: 'RECOVERY_REQUIRED', code: 'RECOVERY_REQUIRED', operationId,
    accessorCalls: 0, rowCalls: 0
  }, 'own array-index accessors are not executed and map to recovery');

  let inheritedClaimRowCalls = 0;
  const inheritedClaim = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(
      plan,
      trustedBookingFields,
      {
        appendClaimEvents: async function(events) {
          return {
            state: 'CONFIRMED',
            confirmed: events.map(function(event) {
              return Object.create({ eventId: event._id, disposition: 'inserted' });
            })
          };
        },
        appendBookingRows: async function() {
          inheritedClaimRowCalls += 1;
        }
      }
    );
  });
  assertEqual({ code: inheritedClaim.code, rowCalls: inheritedClaimRowCalls }, {
    code: 'RECOVERY_REQUIRED', rowCalls: 0
  }, 'claim confirmation identity and disposition must be exact own fields');

  let extraClaimRowCalls = 0;
  const extraClaim = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function(events) {
        const confirmation = confirmedClaims(events);
        confirmation.confirmed[0].classification = 'trusted';
        return confirmation;
      },
      appendBookingRows: async function() { extraClaimRowCalls += 1; }
    });
  });
  assertEqual({ code: extraClaim.code, rowCalls: extraClaimRowCalls }, {
    code: 'RECOVERY_REQUIRED', rowCalls: 0
  }, 'claim confirmation descriptors reject unexpected own fields');

  let proxyClaimRowCalls = 0;
  const proxyClaim = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function(events) {
        const confirmation = confirmedClaims(events);
        confirmation.confirmed[0] = new Proxy(confirmation.confirmed[0], {
          getOwnPropertyDescriptor: function(target, property) {
            const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
            if (property === 'eventId') {
              return Object.assign({}, descriptor, { value: 'descriptor-tampered-id' });
            }
            return descriptor;
          },
          get: function(target, property, receiver) {
            return Reflect.get(target, property, receiver);
          }
        });
        return confirmation;
      },
      appendBookingRows: async function() { proxyClaimRowCalls += 1; }
    });
  });
  assertEqual({ code: proxyClaim.code, rowCalls: proxyClaimRowCalls }, {
    code: 'RECOVERY_REQUIRED', rowCalls: 0
  }, 'confirmation trust uses descriptor values rather than Proxy property reads');

  let accessorClaimRowCalls = 0;
  const accessorClaim = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function(events) {
        const confirmation = confirmedClaims(events);
        Object.defineProperty(confirmation.confirmed[0], 'eventId', {
          enumerable: true,
          get: function() { throw new Error('caller accessor executed'); }
        });
        return confirmation;
      },
      appendBookingRows: async function() { accessorClaimRowCalls += 1; }
    });
  });
  assertEqual({ code: accessorClaim.code, rowCalls: accessorClaimRowCalls }, {
    code: 'RECOVERY_REQUIRED', rowCalls: 0
  }, 'claim confirmation validation reads data descriptors without executing accessors');

  const claimMutations = [
    {
      name: 'state',
      mutate: function(result) { result.state = 'STOPPED'; }
    },
    {
      name: 'count',
      mutate: function(result) { result.confirmed.pop(); }
    },
    {
      name: 'IDs',
      mutate: function(result) { result.confirmed[1].eventId = 'wrong-event'; }
    },
    {
      name: 'disposition',
      mutate: function(result) { result.confirmed[1].disposition = 'assumed'; }
    }
  ];
  for (const mutation of claimMutations) {
    let mutationRowCalls = 0;
    const error = await captureRejection(function() {
      return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
        appendClaimEvents: async function(events) {
          const confirmation = confirmedClaims(events);
          mutation.mutate(confirmation);
          return confirmation;
        },
        appendBookingRows: async function() { mutationRowCalls += 1; }
      });
    });
    assertEqual({ code: error.code, rowCalls: mutationRowCalls }, {
      code: 'RECOVERY_REQUIRED', rowCalls: 0
    }, 'claim confirmation requires the exact ' + mutation.name + ' before row persistence');
  }

  let customEveryRowCalls = 0;
  const customEveryError = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function(events) {
        const confirmation = confirmedClaims(events);
        confirmation.confirmed[0].eventId = 'wrong-event';
        confirmation.confirmed.every = function() { return true; };
        return confirmation;
      },
      appendBookingRows: async function() { customEveryRowCalls += 1; }
    });
  });
  assertEqual({ code: customEveryError.code, rowCalls: customEveryRowCalls }, {
    code: 'RECOVERY_REQUIRED', rowCalls: 0
  }, 'caller-controlled array iteration cannot authorize claim confirmation');

  let thrownClaimRowCalls = 0;
  const thrownClaim = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function() { throw new Error('claim port failed'); },
      appendBookingRows: async function() { thrownClaimRowCalls += 1; }
    });
  });
  assertEqual({ code: thrownClaim.code, operationId: thrownClaim.operationId,
    rowCalls: thrownClaimRowCalls }, {
    code: 'RECOVERY_REQUIRED', operationId, rowCalls: 0
  }, 'a thrown claim-port exception maps to recovery and prevents row persistence');

  let ambiguousClaimRowCalls = 0;
  const ambiguousClaim = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: async function(events) {
        const confirmation = confirmedClaims(events);
        confirmation.state = 'STOPPED';
        confirmation.failed = { index: 1, classification: 'UNRESOLVED' };
        return confirmation;
      },
      appendBookingRows: async function() { ambiguousClaimRowCalls += 1; }
    });
  });
  assertEqual({ code: ambiguousClaim.code, rowCalls: ambiguousClaimRowCalls }, {
    code: 'RECOVERY_REQUIRED', rowCalls: 0
  }, 'ambiguous claim acquisition never reaches booking-row persistence');

  const rowMutations = [
    {
      name: 'state',
      mutate: function(result) { result.state = 'STOPPED'; }
    },
    {
      name: 'count',
      mutate: function(result) { result.confirmed.length = 0; }
    },
    {
      name: 'IDs',
      mutate: function(result) { result.confirmed[0].rowId = 'wrong-row'; }
    },
    {
      name: 'disposition',
      mutate: function(result) { result.confirmed[0].disposition = 'assumed'; }
    }
  ];
  for (const mutation of rowMutations) {
    const error = await captureRejection(function() {
      return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
        appendClaimEvents: confirmedClaims,
        appendBookingRows: async function(rows) {
          const confirmation = confirmedRows(rows);
          mutation.mutate(confirmation);
          return confirmation;
        }
      });
    });
    assertEqual({ code: error.code, operationId: error.operationId }, {
      code: 'RECOVERY_REQUIRED', operationId
    }, 'row confirmation requires the exact ' + mutation.name);
  }

  const thrownRow = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(plan, trustedBookingFields, {
      appendClaimEvents: confirmedClaims,
      appendBookingRows: async function() { throw new Error('row port failed'); }
    });
  });
  assertEqual({ code: thrownRow.code, operationId: thrownRow.operationId }, {
    code: 'RECOVERY_REQUIRED', operationId
  }, 'a thrown booking-row port exception maps to recovery');

  let rowCalls = 0;
  const ambiguous = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(
      plan,
      trustedBookingFields,
      {
        appendClaimEvents: async function(events) {
          return {
            state: 'CONFIRMED',
            confirmed: events.map(function(event) {
              return { eventId: event._id, disposition: 'already-present' };
            })
          };
        },
        appendBookingRows: async function() {
          rowCalls += 1;
          return {
            state: 'STOPPED',
            confirmed: [],
            failed: { index: 0, rowId: expectedRow._id, classification: 'UNRESOLVED' }
          };
        }
      }
    );
  });
  assertEqual({
    message: ambiguous.message,
    code: ambiguous.code,
    operationId: ambiguous.operationId,
    rowCalls
  }, {
    message: 'RECOVERY_REQUIRED',
    code: 'RECOVERY_REQUIRED',
    operationId,
    rowCalls: 1
  }, 'ambiguous booking-row persistence after confirmed claims requires explicit recovery');

  let unsupportedEffects = 0;
  const multiRowPlan = Object.assign({}, plan, {
    bookingRows: plan.bookingRows.concat([
      Object.assign({}, plan.bookingRows[0], {
        _id: 'pb1-' + operationId + '-r2',
        assignedRoom: 4
      })
    ])
  });
  const unsupported = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(
      multiRowPlan,
      trustedBookingFields,
      {
        appendClaimEvents: async function() { unsupportedEffects += 1; },
        appendBookingRows: async function() { unsupportedEffects += 1; }
      }
    );
  });
  assertEqual({ message: unsupported.message, effects: unsupportedEffects }, {
    message: 'Invalid coordinator plan', effects: 0
  }, 'the first tracer rejects unresolved multi-row business-field distribution before effects');

  let invalidPlanEffects = 0;
  const invalidPlan = Object.assign({}, plan, { primaryRowId: 'wrong-primary-row' });
  const invalidPlanError = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(
      invalidPlan,
      trustedBookingFields,
      {
        appendClaimEvents: async function() { invalidPlanEffects += 1; },
        appendBookingRows: async function() { invalidPlanEffects += 1; }
      }
    );
  });
  assertEqual({ message: invalidPlanError.message, effects: invalidPlanEffects }, {
    message: 'Invalid coordinator plan', effects: 0
  }, 'a mismatched primary row fails plan validation before claim acquisition');

  let emptyAcquisitionEffects = 0;
  const emptyAcquisitionError = await captureRejection(function() {
    return context.coordinator.coordinatePhysicalBookingCommit(
      Object.assign({}, plan, { acquisitions: [] }),
      trustedBookingFields,
      {
        appendClaimEvents: async function() { emptyAcquisitionEffects += 1; },
        appendBookingRows: async function() { emptyAcquisitionEffects += 1; }
      }
    );
  });
  assertEqual({ message: emptyAcquisitionError.message, effects: emptyAcquisitionEffects }, {
    message: 'Invalid coordinator plan', effects: 0
  }, 'an empty acquisition batch fails preflight with zero port I/O');

  async function verifyInvalidPlan(mutator, message) {
    const candidate = {
      acquisitions: plan.acquisitions.map(function(event) { return Object.assign({}, event); }),
      bookingRows: plan.bookingRows.map(function(row) { return Object.assign({}, row); }),
      primaryRowId: plan.primaryRowId
    };
    mutator(candidate);
    let io = 0;
    const error = await captureRejection(function() {
      return context.coordinator.coordinatePhysicalBookingCommit(candidate, trustedBookingFields, {
        appendClaimEvents: async function() { io += 1; return confirmedClaims(candidate.acquisitions); },
        appendBookingRows: async function() { io += 1; return confirmedRows(candidate.bookingRows); }
      });
    });
    assertEqual({ message: error.message, io }, { message: 'Invalid coordinator plan', io: 0 }, message);
  }

  const invalidPlanCases = [
    ['malformed check-in', function(candidate) { candidate.bookingRows[0].checkIn = '2027-02-30'; }],
    ['reversed dates', function(candidate) { candidate.bookingRows[0].checkOut = '2027-11-04'; }],
    ['noncanonical operation ID', function(candidate) { candidate.bookingRows[0].operationId = 'short'; }],
    ['noncanonical payload digest', function(candidate) { candidate.bookingRows[0].payloadDigest = 'A'.repeat(64); }],
    ['noncanonical booking number', function(candidate) { candidate.bookingRows[0].bookingNumber = ' WC-3001'; }],
    ['nondeterministic row ID', function(candidate) { candidate.bookingRows[0]._id = 'random-row'; candidate.primaryRowId = 'random-row'; }],
    ['wrong room-to-unit mapping', function(candidate) { candidate.bookingRows[0].assignedRoom = 2; }],
    ['wrong quantity', function(candidate) { candidate.bookingRows[0].quantity = 2; }],
    ['sparse acquisitions', function(candidate) { delete candidate.acquisitions[1]; }],
    ['duplicate acquisition IDs', function(candidate) { candidate.acquisitions[2]._id = candidate.acquisitions[1]._id; }],
    ['operation manifest mismatch', function(candidate) { candidate.acquisitions[0].manifestCheckIn = '2027-11-04'; }],
    ['resource correlation mismatch', function(candidate) { candidate.acquisitions[1].bookingRowId = 'pb1-' + operationId + '-r2'; }],
    ['resource topology mismatch', function(candidate) { candidate.acquisitions[2].unit = 4; }],
    ['inherited acquisition entry', function(candidate) {
      candidate.acquisitions[1] = Object.create(candidate.acquisitions[1]);
    }],
    ['unexpected acquisition property', function(candidate) { candidate.acquisitions[1].extra = true; }]
  ];
  for (const invalidCase of invalidPlanCases) {
    await verifyInvalidPlan(invalidCase[1],
      'complete one-row plan validation rejects ' + invalidCase[0] + ' before port I/O');
  }

  async function verifyInvalidTrustedField(field, value) {
    const candidate = Object.assign({}, trustedBookingFields, { [field]: value });
    let io = 0;
    const error = await captureRejection(function() {
      return context.coordinator.coordinatePhysicalBookingCommit(plan, candidate, {
        appendClaimEvents: async function() { io += 1; return confirmedClaims(plan.acquisitions); },
        appendBookingRows: async function(rows) { io += 1; return confirmedRows(rows); }
      });
    });
    assertEqual({ message: error.message, io }, { message: 'Invalid coordinator plan', io: 0 },
      'object-valued trusted field ' + field + ' is rejected before port I/O');
  }
  await verifyInvalidTrustedField('guests', { value: 2 });
  await verifyInvalidTrustedField('roomFee', { value: 175 });
  await verifyInvalidTrustedField('note', { value: '' });
})();
