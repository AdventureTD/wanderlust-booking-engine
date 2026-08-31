// Behavioral regression test for per-room Google Calendar synchronization.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.TZ = 'America/Dominica';
const source = fs.readFileSync(path.join(__dirname, 'google-calendar-webhook.gs'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error('FAIL: ' + message);
  console.log('PASS: ' + message);
}

function runRequest(payload, existingEvent, initialProperties) {
  const calls = { created: [], updated: [], deleted: [], locked: 0, released: 0 };
  const properties = Object.assign({ WBE_CALENDAR_SECRET: 'DominicaBooking' }, initialProperties || {});
  const existing = existingEvent || {
    setTitle(value) { calls.updated.push(['title', value]); },
    setDescription(value) { calls.updated.push(['description', value]); },
    setAllDayDates(start, end) { calls.updated.push(['dates', start, end]); },
    deleteEvent() { calls.deleted.push('deleted'); },
    getId() { return payload.eventId || 'existing-event'; }
  };
  const calendar = {
    createAllDayEvent(title, start, end, options) {
      calls.created.push({ title, start, end, options });
      return { getId() { return 'created-event'; } };
    },
    getEvents() { return []; },
    getEventById(id) { return id ? existing : null; }
  };
  const context = {
    Date,
    JSON,
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) { return properties[key] || null; },
          getProperties() { return Object.assign({}, properties); },
          setProperty(key, value) { properties[key] = String(value); },
          deleteProperty(key) { delete properties[key]; }
        };
      }
    },
    LockService: {
      getScriptLock() {
        return {
          waitLock() { calls.locked += 1; },
          releaseLock() { calls.released += 1; }
        };
      }
    },
    CalendarApp: { getDefaultCalendar() { return calendar; } },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput(body) {
        return { body, setMimeType() { return this; } };
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const response = context.doPost({ postData: { contents: JSON.stringify(payload) } });
  return { result: JSON.parse(response.body), calls, properties };
}

const base = {
  secret: 'DominicaBooking',
  action: 'syncRoom',
  bookingId: 'row-1',
  bookingNumber: 'WC-1023',
  guestName: 'Tom Decherd',
  roomCode: 'adventure_suite',
  assignedRoom: '',
  startDate: '2027-03-21',
  endDate: '2027-03-28',
  status: 'confirmed'
};

let run = runRequest(base);
assert(run.result.status === 'created', 'unassigned room creates an event');
assert(run.result.eventId === 'created-event', 'created event ID is returned for CMS persistence');
assert(run.calls.created.length === 1, 'exactly one event is created per room record');
assert(run.calls.locked === 1 && run.calls.released === 1, 'room event synchronization is serialized with LockService');
assert(run.calls.created[0].title === 'Unit Unassigned | Adventure Suite | Tom Decherd | WC-1023', 'unassigned event title identifies unit, room type, guest, and booking');
assert(run.calls.created[0].start.getFullYear() === 2027 && run.calls.created[0].start.getMonth() === 2 && run.calls.created[0].start.getDate() === 21, 'check-in remains March 21 in Dominica');
assert(run.calls.created[0].end.getFullYear() === 2027 && run.calls.created[0].end.getMonth() === 2 && run.calls.created[0].end.getDate() === 28, 'exclusive checkout remains March 28 in Dominica');

run = runRequest(base, null, {
  'WBE_ROOM_REV_old-row': '2020-01-01T00:00:00.000Z',
  'WBE_ROOM_EVENT_old-row': 'old-event',
  'WBE_ROOM_CANCELLED_old-row': '2020-01-01T00:00:00.000Z'
});
assert(!run.properties['WBE_ROOM_REV_old-row'] && !run.properties['WBE_ROOM_EVENT_old-row'], 'old Apps Script row mappings are compacted before quota exhaustion');

run = runRequest(Object.assign({}, base, {
  bookingId: 'owner-block-row',
  bookingNumber: 'owner:auto:5:2027-03-21:2027-03-28',
  guestName: 'Owner Block',
  assignedRoom: '5',
  status: 'blocked'
}));
assert(run.calls.created[0].title === 'Unit 5 | Adventure Suite | Owner Block', 'owner blocks have a clear calendar title without an internal key');

run = runRequest(Object.assign({}, base, { eventId: 'existing-event', assignedRoom: '2' }));
assert(run.result.status === 'updated', 'existing room event is updated instead of duplicated');
assert(run.calls.created.length === 0, 'assignment update does not create a duplicate event');
assert(run.calls.updated.some(call => call[0] === 'title' && call[1] === 'Unit 2 | Adventure Suite | Tom Decherd | WC-1023'), 'assignedRoom updates the event title');

run = runRequest(Object.assign({}, base, { updatedAt: '2026-08-29T13:00:00.000Z' }), null, {
  'WBE_ROOM_EVENT_row-1': 'mapped-event'
});
assert(run.result.status === 'updated', 'stored row-to-event mapping makes retries idempotent');
assert(run.calls.created.length === 0, 'retry after a lost Wix write does not duplicate the event');

run = runRequest(Object.assign({}, base, { updatedAt: '2026-08-29T12:00:00.000Z' }), null, {
  'WBE_ROOM_EVENT_row-1': 'mapped-event',
  'WBE_ROOM_REV_row-1': '2026-08-29T13:00:00.000Z'
});
assert(run.result.status === 'skipped', 'stale room updates are ignored');
assert(run.calls.created.length === 0 && run.calls.updated.length === 0, 'stale update cannot overwrite a newer assignment');

run = runRequest(Object.assign({}, base, {
  eventId: 'existing-event',
  status: 'Cancelled',
  updatedAt: '2026-08-29T14:00:00.000Z'
}));
assert(run.result.status === 'deleted', 'cancelled room deletes its calendar event');
assert(run.calls.deleted.length === 1, 'calendar deletion is executed once');
const cancelledProperties = run.properties;
run = runRequest(Object.assign({}, base, { updatedAt: '2026-08-29T13:00:00.000Z' }), null, cancelledProperties);
assert(run.result.status === 'skipped', 'older active update cannot recreate a cancelled room event');
assert(run.calls.created.length === 0, 'cancellation tombstone prevents stale event recreation');
