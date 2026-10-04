const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const properties = new Map([['WBE_CALENDAR_SECRET', 'inert']]);
  const events = new Map(), calls = [], faults = {};
  let sequence = 0;
  const calendar = {
    getId: () => 'fixture-calendar', isOwnedByMe: () => true,
    getEventById: id => events.get(id) || null,
    createAllDayEvent(title, start, end, options) {
      const id = 'fixture-event-' + (++sequence), tags = {};
      const event = {title, description: options.description, start, end,
        getId: () => id, getTag: key => tags[key], setTag: (key, value) => {tags[key] = value;},
        deleteEvent: () => {calls.push(['delete', id]); events.delete(id);}};
      calls.push(['create', id]); events.set(id, event); return event;
    }
  };
  const context = vm.createContext({Date, JSON,
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => {if (!faults.dropWrite && JSON.parse(value).state !== faults.dropState) properties.set(key, value);}
    })},
    CalendarApp: {getDefaultCalendar: () => calendar},
    LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock() {}})},
    ContentService: {MimeType: {JSON: 1}, createTextOutput: value => ({setMimeType: () => JSON.parse(value)})}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/google-calendar-webhook.gs'), 'utf8'), context);
  return {properties, events, calls, faults,
    post: data => context.doPost({postData: {contents: JSON.stringify({secret: 'inert', ...data})}})};
}
const body = {bookingNumber: 'WC-1041', summary: 'Wanderlust Caribbean Booking: INERT',
  description: 'Existing description', startDate: '2027-02-27', endDate: '2027-03-07'};

test('booking event visibly includes exact number in title and description without changing stay', () => {
  const f = fixture();
  assert.equal(f.post(body).status, 'created');
  const event = [...f.events.values()][0];
  assert.equal(event.title, 'WC-1041 — ' + body.summary);
  assert.equal(event.description, 'Booking number: WC-1041\n' + body.description);
  assert.equal(event.start.getDate(), 27); assert.equal(event.end.getDate(), 7);
  assert.equal(f.post(body).status, 'created');
  assert.equal(f.calls.length, 1);
});
test('malformed booking tokens are rejected literally before any property or Calendar mutation', () => {
  for (const bookingNumber of ['', null, false, 0, 'WC-1041\n', ' WC-1041', 'WC-1041 ', ['WC-1041'], 'wc-1041']) {
    for (const action of [undefined, 'cancel']) {
      const f = fixture();
      assert.equal(f.post({...body, bookingNumber, action}).status, 'INVALID_REQUEST');
      assert.equal(f.calls.length, 0); assert.equal(f.properties.size, 1);
    }
  }
});

test('a conflicting retained booking identity never authorizes cancellation', () => {
  const f = fixture(); f.post(body);
  const record = JSON.parse(f.properties.get('booking:WC-1041'));
  record.bookingNumber = 'WC-1042';
  f.properties.set('booking:WC-1041', JSON.stringify(record));
  assert.equal(f.post({action: 'cancel', bookingNumber: 'WC-1041'}).status, 'NEEDS_RECONCILIATION');
  assert.equal(f.calls.filter(x => x[0] === 'delete').length, 0);
});
test('creation cannot run without retained START', () => {
  const f = fixture(); f.faults.dropState = 'STARTED';
  assert.equal(f.post(body).status, 'UNKNOWN'); assert.equal(f.calls.length, 0);
});
test('creation cannot claim success without retained event mapping or recreate after uncertainty', () => {
  const g = fixture(); g.faults.dropState = 'CREATED';
  assert.equal(g.post(body).status, 'UNKNOWN'); assert.equal(g.calls.length, 1);
  assert.equal(g.post(body).status, 'NEEDS_RECONCILIATION'); assert.equal(g.calls.length, 1);
});
test('already numbered labels are not duplicated and longer tokens do not count as exact labels', () => {
  for (const text of ['WC-1041 — Existing', 'Existing (WC-1041)', 'Booking number: WC-1041\nExisting']) {
    const f = fixture(); assert.equal(f.post({...body, summary: text, description: text}).status, 'created');
    const event = [...f.events.values()][0]; assert.equal(event.title, text); assert.equal(event.description, text);
  }
  for (const text of ['WC-10410', 'XWC-1041', 'WC-1041-extra']) {
    const f = fixture(); f.post({...body, summary: text, description: text});
    const event = [...f.events.values()][0];
    assert.equal(event.title, 'WC-1041 — ' + text);
    assert.equal(event.description, 'Booking number: WC-1041\n' + text);
  }
});

test('legacy bound events without visible number remain cancellable without changing other bookings', () => {
  const f = fixture(); f.post(body); f.post({...body, bookingNumber: 'WC-1042'});
  const record = JSON.parse(f.properties.get('booking:WC-1041'));
  delete record.bookingNumber; f.properties.set('booking:WC-1041', JSON.stringify(record));
  f.events.get(record.eventId).title = 'Legacy unnumbered event';
  assert.equal(f.post(body).status, 'created'); // Replay does not relabel or recreate historical events.
  assert.equal(f.events.get(record.eventId).title, 'Legacy unnumbered event');
  const result = f.post({action: 'cancel', bookingNumber: 'WC-1041'});
  assert.equal(result.disposition, 'DELETED'); assert.equal(result.eventId, record.eventId);
  assert.equal(f.events.size, 1); assert.match([...f.events.values()][0].title, /^WC-1042 /);
  assert.equal(f.post({action: 'cancel', bookingNumber: 'WC-1041'}).disposition, 'DELETED');
  assert.equal(f.calls.filter(x => x[0] === 'delete').length, 1);
});

test('title alone never supplies identity for an unbound cancellation', () => {
  const f = fixture(); f.post(body); f.properties.delete('booking:WC-1041');
  assert.equal(f.post({action: 'cancel', bookingNumber: 'WC-1041'}).status, 'NEEDS_RECONCILIATION');
  assert.equal(f.events.size, 1); assert.equal(f.calls.filter(x => x[0] === 'delete').length, 0);
});

test('unsupported update does not silently replace a bound event or shift its dates', () => {
  const f = fixture(); f.post(body); const original = f.properties.get('booking:WC-1041');
  assert.equal(f.post({...body, startDate: '2027-02-28'}).status, 'NEEDS_RECONCILIATION');
  assert.equal(f.post({...body, action: 'update'}).status, 'INVALID_REQUEST');
  assert.equal(f.properties.get('booking:WC-1041'), original); assert.equal(f.calls.length, 1);
});

test('creation replay rejects an incomplete or mismatched persisted event mapping', () => {
  for (const delta of [{bookingNumber:'WC-1042'}, {calendarId:'other-calendar'}, {eventId:''}, {eventId:null}]) {
    const f = fixture(); f.post(body);
    const record = JSON.parse(f.properties.get('booking:WC-1041'));
    f.properties.set('booking:WC-1041', JSON.stringify({...record, ...delta}));
    assert.equal(f.post(body).status, 'NEEDS_RECONCILIATION'); assert.equal(f.calls.length, 1);
  }
});
module.exports = {fixture, body};
