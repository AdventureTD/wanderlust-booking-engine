import wixData from 'wix-data';

// Backend-only deterministic Bookings persistence. This module is intentionally
// disconnected from public web methods and the production booking path.
const BOOKINGS_COLLECTION = 'Bookings';
const READ_OPTIONS = { suppressAuth: true, consistentRead: true, suppressHooks: true };
const WRITE_OPTIONS = { suppressAuth: true, suppressHooks: true };

export async function loadOperationBookingRows(operationId) {
  if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(operationId)) {
    throw new Error('Invalid operation ID');
  }
  const rows = [];
  const rowIds = Object.create(null);
  const pages = [];
  let page = await wixData.query(BOOKINGS_COLLECTION)
    .eq('operationId', operationId)
    .limit(1000)
    .find(READ_OPTIONS);
  while (page) {
    if (pages.indexOf(page) !== -1 || !Array.isArray(page.items) ||
        typeof page.hasNext !== 'function') {
      throw new Error('Invalid booking row page');
    }
    pages.push(page);
    for (const row of page.items) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          typeof row._id !== 'string' || row.operationId !== operationId ||
          Object.prototype.hasOwnProperty.call(rowIds, row._id)) {
        throw new Error('Invalid booking row page');
      }
      rowIds[row._id] = true;
      rows.push(row);
    }
    if (!page.hasNext()) break;
    if (typeof page.next !== 'function') throw new Error('Invalid booking row page');
    page = await page.next();
  }
  if (!page) throw new Error('Invalid booking row page');
  return rows.slice().sort(function(left, right) {
    return String(left && left._id || '').localeCompare(String(right && right._id || ''));
  });
}

function matchesRow(stored, expected) {
  return stored && typeof stored === 'object' &&
    Object.keys(expected).every(function(key) {
      if (key === 'checkIn' || key === 'checkOut') {
        return stored[key] && expected[key] &&
          typeof stored[key].getTime === 'function' &&
          typeof expected[key].getTime === 'function' &&
          stored[key].getTime() === expected[key].getTime();
      }
      return stored[key] === expected[key];
    }) &&
    Object.keys(stored).every(function(key) {
      return Object.prototype.hasOwnProperty.call(expected, key) ||
        ['_createdDate', '_updatedDate', '_owner'].indexOf(key) !== -1;
    });
}

function classifyRowMismatch(stored, expected) {
  if (stored === null || stored === undefined) return 'UNRESOLVED';
  if (stored.operationId === expected.operationId &&
      (stored.payloadDigest !== expected.payloadDigest ||
       stored.bookingNumber !== expected.bookingNumber)) {
    return 'IDEMPOTENCY_CONFLICT';
  }
  return 'INTEGRITY';
}

function expectedRoomCode(unit) {
  if (unit === 1) return 'penthouse_apartment';
  if (unit === 2) return 'two_bedroom_apartment';
  if (Number.isInteger(unit) && unit >= 3 && unit <= 5) return 'adventure_suite';
  return null;
}

function noonUtcTime(value) {
  const canonicalPattern = /^\d{4}-\d{2}-\d{2}T12:00:00\.000Z$/;
  if (typeof value === 'string') {
    if (!canonicalPattern.test(value)) return NaN;
    const parsed = new Date(value);
    const time = parsed.getTime();
    return Number.isFinite(time) && parsed.toISOString() === value ? time : NaN;
  }
  let time;
  try {
    time = Date.prototype.getTime.call(value);
  } catch (error) {
    return NaN;
  }
  if (!Number.isFinite(time)) return NaN;
  const canonical = new Date(time);
  return canonicalPattern.test(canonical.toISOString()) && canonical.getUTCHours() === 12 &&
    canonical.getUTCMinutes() === 0 && canonical.getUTCSeconds() === 0 &&
    canonical.getUTCMilliseconds() === 0 ? time : NaN;
}

function isCanonicalText(value, maxLength) {
  return typeof value === 'string' && !!value && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function invalidPreflight(rows) {
  const allowedFields = [
    '_id', 'roomCode', 'assignedRoom', 'quantity', 'checkIn', 'checkOut',
    'bookingNumber', 'operationId', 'payloadDigest', 'status',
    'autoOwnerBlock', 'guests', 'roomFee', 'note'
  ];
  const first = rows[0];
  const operationId = first && first.operationId;
  const firstCheckInTime = first && noonUtcTime(first.checkIn);
  const firstCheckOutTime = first && noonUtcTime(first.checkOut);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const checkInTime = row && noonUtcTime(row.checkIn);
    const checkOutTime = row && noonUtcTime(row.checkOut);
    if (!row || Object.keys(row).some(function(key) { return allowedFields.indexOf(key) === -1; }) ||
        row.status !== 'confirmed' || row.autoOwnerBlock !== false || row.quantity !== 1 ||
        !/^[A-Za-z0-9_-]{16,64}$/.test(row.operationId || '') ||
        !/^[0-9a-f]{64}$/.test(row.payloadDigest || '') ||
        !isCanonicalText(row.bookingNumber, 128) ||
        !Number.isFinite(checkInTime) || !Number.isFinite(checkOutTime) ||
        checkOutTime <= checkInTime ||
        row.operationId !== operationId || row.payloadDigest !== first.payloadDigest ||
        row.bookingNumber !== first.bookingNumber ||
        checkInTime !== firstCheckInTime || checkOutTime !== firstCheckOutTime ||
        row.roomCode !== first.roomCode ||
        row._id !== 'pb1-' + operationId + '-r' + (index + 1) ||
        row.roomCode !== expectedRoomCode(row.assignedRoom) ||
        (index > 0 && rows[index - 1].assignedRoom >= row.assignedRoom)) {
      return index;
    }
  }
  const assignment = rows.map(function(row) { return row.assignedRoom; }).join(',');
  const allowedAssignments = {
    penthouse_apartment: ['1'],
    two_bedroom_apartment: ['2'],
    adventure_suite: ['3', '4', '3,4', '3,4,5']
  }[first && first.roomCode];
  return !allowedAssignments || allowedAssignments.indexOf(assignment) === -1
    ? Math.max(0, rows.length - 1)
    : -1;
}

export async function appendPhysicalBookingRows(rows) {
  if (!Array.isArray(rows)) throw new Error('Invalid booking row batch');
  const invalidIndex = invalidPreflight(rows);
  if (invalidIndex !== -1) {
    return {
      state: 'STOPPED',
      confirmed: [],
      failed: {
        index: invalidIndex,
        rowId: rows[invalidIndex] && rows[invalidIndex]._id,
        classification: 'INTEGRITY'
      }
    };
  }
  const expectedRows = rows.map(function(row) {
    return Object.assign({}, row, {
      checkIn: new Date(noonUtcTime(row.checkIn)),
      checkOut: new Date(noonUtcTime(row.checkOut))
    });
  });
  const confirmed = [];
  for (let index = 0; index < expectedRows.length; index += 1) {
    const expected = expectedRows[index];
    let insertResolved = false;
    try {
      await wixData.insert(BOOKINGS_COLLECTION, expected, WRITE_OPTIONS);
      insertResolved = true;
    } catch (error) {
      // Deterministic row IDs are reconciled by authoritative read-back.
    }
    let stored;
    try {
      stored = await wixData.get(BOOKINGS_COLLECTION, expected._id, READ_OPTIONS);
    } catch (error) {
      return {
        state: 'STOPPED',
        confirmed: confirmed,
        failed: { index: index, rowId: expected && expected._id, classification: 'UNRESOLVED' }
      };
    }
    if (!matchesRow(stored, expected)) {
      return {
        state: 'STOPPED',
        confirmed: confirmed,
        failed: {
          index: index,
          rowId: expected && expected._id,
          classification: classifyRowMismatch(stored, expected)
        }
      };
    }
    confirmed.push({
      rowId: expected._id,
      disposition: insertResolved ? 'inserted' : 'already-present'
    });
    if (!insertResolved) {
      for (let retryIndex = index + 1; retryIndex < expectedRows.length; retryIndex += 1) {
        const retryExpected = expectedRows[retryIndex];
        let retryStored;
        try {
          retryStored = await wixData.get(
            BOOKINGS_COLLECTION, retryExpected._id, READ_OPTIONS);
        } catch (error) {
          return {
            state: 'STOPPED',
            confirmed: confirmed,
            failed: {
              index: retryIndex,
              rowId: retryExpected._id,
              classification: 'UNRESOLVED'
            }
          };
        }
        if (!matchesRow(retryStored, retryExpected)) {
          return {
            state: 'STOPPED',
            confirmed: confirmed,
            failed: {
              index: retryIndex,
              rowId: retryExpected._id,
              classification: classifyRowMismatch(retryStored, retryExpected)
            }
          };
        }
        confirmed.push({ rowId: retryExpected._id, disposition: 'already-present' });
      }
      return { state: 'CONFIRMED', confirmed: confirmed };
    }
  }
  return { state: 'CONFIRMED', confirmed: confirmed };
}
