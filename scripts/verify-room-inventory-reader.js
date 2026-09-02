// Behavioral tests for the backend-only, read-only inventory adapter.
// Run: node scripts/verify-room-inventory-reader.js
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

async function assertRejects(run, expectedMessage, message) {
  let error = null;
  try { await run(); } catch (caught) { error = caught; }
  if (!error || String(error.message) !== expectedMessage) {
    throw new Error(`FAIL: ${message}\nExpected error: ${expectedMessage}\nActual: ${error && error.message}`);
  }
  console.log(`PASS: ${message}`);
}

const backendDir = path.join(__dirname, '..', 'velo', 'backend');
const assignmentSource = fs.readFileSync(path.join(backendDir, 'roomAssignmentRules.js'), 'utf8');
const rulesSource = fs.readFileSync(path.join(backendDir, 'roomInventoryRules.js'), 'utf8');
const readerSource = fs.readFileSync(path.join(backendDir, 'roomInventory.js'), 'utf8');
const source = (assignmentSource + '\n' + rulesSource + '\n' + readerSource)
  .replace(/^import .*;\s*$/gm, '')
  .replace(/export const /g, 'var ')
  .replace(/export function /g, 'function ')
  .replace(/export async function /g, 'async function ')
  + '\nthis.reader = { loadInventorySnapshot };';

const calls = { collections: [], limits: [], finds: [], nexts: 0 };
const bookingRows = [
  { _id: 'page-1', bookingNumber: 'A-1', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 3, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'legacy-fallback', bookingNumber: 123, status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 5, quantity: 1 },
  { _id: 'page-2', bookingNumber: 'A-2', status: 'confirmed', roomCode: 'adventure_suite', assignedRoom: 4, quantity: 1, checkIn: '2027-11-05', checkOut: '2027-11-08' },
  { _id: 'prototype-key', bookingNumber: '__proto__', status: 'confirmed', roomCode: 'penthouse_apartment', assignedRoom: 1, quantity: 1 }
];
const bookingPage2 = { items: [bookingRows[2], bookingRows[3]], hasNext: function() { return false; } };
const bookingPage1 = {
  items: [bookingRows[0], bookingRows[1]],
  hasNext: function() { return true; },
  next: async function() { calls.nexts += 1; return bookingPage2; }
};
const summaryPage = {
  items: [
    { _id: 'summary-123', bookingNumber: '123', checkIn: '2027-11-05', checkOut: '2027-11-08' },
    { _id: 'summary-prototype', bookingNumber: '__proto__', checkIn: '2027-11-05', checkOut: '2027-11-08' }
  ],
  hasNext: function() { return false; }
};
const wixData = {
  query: function(collection) {
    calls.collections.push(collection);
    return {
      limit: function(value) {
        calls.limits.push(value);
        return this;
      },
      find: async function(options) {
        calls.finds.push(options);
        return collection === 'Bookings' ? bookingPage1 : summaryPage;
      }
    };
  }
};
const context = { Date, wixData };
vm.createContext(context);
vm.runInContext(source, context);

(async function() {
  const originalRows = JSON.stringify(bookingRows);
  const snapshot = await context.reader.loadInventorySnapshot('2027-11-05', '2027-11-08');
  assertEqual(snapshot.rows.map(function(row) {
    return { id: row._id, dateSource: row.dateSource };
  }), [
    { id: 'page-1', dateSource: 'Bookings' },
    { id: 'legacy-fallback', dateSource: 'BookingSummary' },
    { id: 'page-2', dateSource: 'Bookings' },
    { id: 'prototype-key', dateSource: 'BookingSummary' }
  ], 'adapter aggregates pages and safely resolves legacy dates for all booking-number strings');
  assertEqual(JSON.stringify(bookingRows), originalRows, 'adapter does not mutate Wix Data result rows');
  assertEqual(calls, {
    collections: ['Bookings', 'BookingSummary'],
    limits: [1000, 1000],
    finds: [
      { suppressAuth: true, consistentRead: true },
      { suppressAuth: true, consistentRead: true }
    ],
    nexts: 1
  }, 'adapter performs explicit backend-only paged reads for both legacy data sources');

  const collectionCount = calls.collections.length;
  await assertRejects(
    function() { return context.reader.loadInventorySnapshot(null, '2027-11-08'); },
    'Invalid inventory dates',
    'invalid request dates fail before querying Wix Data'
  );
  assertEqual(calls.collections.length, collectionCount, 'invalid dates perform no collection read');

  context.wixData = {
    query: function() {
      return {
        limit: function() { return this; },
        find: async function() { throw new Error('inventory read failed'); }
      };
    }
  };
  await assertRejects(
    function() { return context.reader.loadInventorySnapshot('2027-11-05', '2027-11-08'); },
    'inventory read failed',
    'Wix Data read failures propagate without a partial snapshot'
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
    function() { return context.reader.loadInventorySnapshot('2027-11-05', '2027-11-08'); },
    'Wix Data paging result is missing next()',
    'a page claiming more data without next() fails closed'
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
    function() { return context.reader.loadInventorySnapshot('2027-11-05', '2027-11-08'); },
    'Wix Data paging result is missing hasNext()',
    'a page without hasNext() fails closed'
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
    function() { return context.reader.loadInventorySnapshot('2027-11-05', '2027-11-08'); },
    'Wix Data paging result has invalid items',
    'a page with non-array items fails closed'
  );

  context.wixData = {
    query: function() {
      return {
        limit: function() { return this; },
        find: async function() {
          return {
            items: [],
            hasNext: function() { return true; },
            next: async function() { return null; }
          };
        }
      };
    }
  };
  await assertRejects(
    function() { return context.reader.loadInventorySnapshot('2027-11-05', '2027-11-08'); },
    'Wix Data paging returned no page',
    'a null next page fails closed'
  );
})().catch(function(error) {
  console.error(error.stack || error);
  process.exit(1);
});
