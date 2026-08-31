/**
 * Wanderlust Booking Engine — Google Calendar webhook.
 *
 * Deploy this as a Google Apps Script web app:
 * 1. Go to https://script.google.com (sign in as info@wanderlustcaribbean.com)
 * 2. Click "New project" (blank project)
 * 3. Delete the default myFunction() code and paste ALL of this code
 * 4. Click "Save" (disk icon or Ctrl+S)
 * 5. Click "Deploy" → "New deployment"
 *    - Type: Web app
 *    - Description: Wanderlust Calendar Webhook
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Click "Deploy"
 * 7. Google will ask you to authorize — click through and "Allow"
 * 8. Copy the "Web app URL" (looks like https://script.google.com/macros/s/AKfycbz.../exec)
 * 9. In Project Settings → Script Properties, add:
 *    - WBE_CALENDAR_SECRET = <the same secret used by Render>
 * 10. Add the URL to your Render/Python service environment variable:
 *    - WBE_CALENDAR_WEB_APP_URL = <the copied URL>
 *    - WBE_CALENDAR_SECRET = <a secret passphrase you'll share with me>
 */

function scriptProperties() {
  return PropertiesService.getScriptProperties();
}

function calendarSecret() {
  return scriptProperties().getProperty('WBE_CALENDAR_SECRET') || '';
}

// Parse an ISO calendar date as local midnight. JavaScript treats
// new Date('YYYY-MM-DD') as UTC, which shifts it to the previous day in
// Dominica (GMT-04). Google Calendar all-day event end dates are exclusive.
function parseLocalCalendarDate(value) {
  var parts = String(value || '').substring(0, 10).split('-');
  if (parts.length !== 3) {
    throw new Error('Invalid calendar date: ' + value);
  }

  var year = Number(parts[0]);
  var month = Number(parts[1]);
  var day = Number(parts[2]);
  var parsed = new Date(year, month - 1, day);

  if (!year || !month || !day ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day) {
    throw new Error('Invalid calendar date: ' + value);
  }
  return parsed;
}

function roomDisplayName(roomCode) {
  var names = {
    adventure_suite: 'Adventure Suite',
    penthouse_apartment: 'Penthouse Apartment',
    two_bedroom_apartment: 'Two Bedroom Apartment'
  };
  return names[roomCode] || String(roomCode || 'Room').replace(/_/g, ' ');
}

function unitLabel(assignedRoom) {
  var value = String(assignedRoom || '').trim();
  if (!value) return 'Unit Unassigned';
  value = value.replace(/^unit\s+/i, '');
  return 'Unit ' + value;
}

function cleanupOldRoomState(properties) {
  if (!properties || typeof properties.getProperties !== 'function') return;
  var all = properties.getProperties();
  var cutoff = Date.now() - (3 * 365 * 24 * 60 * 60 * 1000);
  Object.keys(all).forEach(function (key) {
    if (key.indexOf('WBE_ROOM_REV_') !== 0) return;
    var revisionTime = Date.parse(all[key] || '');
    if (!isNaN(revisionTime) && revisionTime < cutoff) {
      var rowId = key.substring('WBE_ROOM_REV_'.length);
      properties.deleteProperty('WBE_ROOM_REV_' + rowId);
      properties.deleteProperty('WBE_ROOM_EVENT_' + rowId);
      properties.deleteProperty('WBE_ROOM_CANCELLED_' + rowId);
    }
  });
}

function syncRoomEventUnlocked(calendar, data) {
  var properties = scriptProperties();
  cleanupOldRoomState(properties);
  var eventKey = 'WBE_ROOM_EVENT_' + data.bookingId;
  var revisionKey = 'WBE_ROOM_REV_' + data.bookingId;
  var cancelledKey = 'WBE_ROOM_CANCELLED_' + data.bookingId;
  var incomingRevision = String(data.updatedAt || '');
  var storedRevision = String(properties.getProperty(revisionKey) || '');
  var cancelledRevision = String(properties.getProperty(cancelledKey) || '');
  var storedEventId = String(properties.getProperty(eventKey) || '');
  var status = String(data.status || '').toLowerCase().trim();

  if (incomingRevision && storedRevision && incomingRevision < storedRevision) {
    return {status: 'skipped', eventId: storedEventId, reason: 'stale-revision'};
  }

  if (status !== 'cancelled' && status !== 'canceled' && cancelledRevision &&
      (!incomingRevision || incomingRevision <= cancelledRevision)) {
    return {status: 'skipped', eventId: '', reason: 'cancelled-tombstone'};
  }

  var eventId = data.eventId || storedEventId;
  var event = eventId ? calendar.getEventById(eventId) : null;

  if (status === 'cancelled' || status === 'canceled') {
    if (event) event.deleteEvent();
    properties.deleteProperty(eventKey);
    var tombstoneRevision = incomingRevision || storedRevision || new Date().toISOString();
    properties.setProperty(revisionKey, tombstoneRevision);
    properties.setProperty(cancelledKey, tombstoneRevision);
    return {status: event ? 'deleted' : 'skipped', eventId: ''};
  }

  var startDate = parseLocalCalendarDate(data.startDate);
  var endDate = parseLocalCalendarDate(data.endDate);
  var isBlocked = status === 'blocked';
  var titleParts = [
    unitLabel(data.assignedRoom),
    roomDisplayName(data.roomCode),
    data.guestName || (isBlocked ? 'Blocked' : 'Guest')
  ];
  if (!isBlocked && data.bookingNumber) titleParts.push(data.bookingNumber);
  var title = titleParts.filter(String).join(' | ');
  var description = [
    'Booking: ' + (data.bookingNumber || ''),
    'Booking row: ' + (data.bookingId || ''),
    '[WBE_ROW_ID:' + (data.bookingId || '') + ']',
    'Room type: ' + roomDisplayName(data.roomCode),
    'Assignment: ' + unitLabel(data.assignedRoom)
  ].join('\n');

  // Recover safely if Calendar creation succeeded but Script Properties did
  // not persist before a retry. The stable row marker prevents duplicates.
  if (!event && data.bookingId) {
    var marker = '[WBE_ROW_ID:' + data.bookingId + ']';
    var matches = calendar.getEvents(startDate, endDate, {search: marker}) || [];
    if (matches.length) {
      event = matches[0];
      for (var duplicateIndex = 1; duplicateIndex < matches.length; duplicateIndex++) {
        matches[duplicateIndex].deleteEvent();
      }
    }
  }

  if (event) {
    event.setTitle(title);
    event.setDescription(description);
    event.setAllDayDates(startDate, endDate);
    properties.setProperty(eventKey, event.getId());
    if (incomingRevision) properties.setProperty(revisionKey, incomingRevision);
    properties.deleteProperty(cancelledKey);
    return {status: 'updated', eventId: event.getId()};
  }

  event = calendar.createAllDayEvent(title, startDate, endDate, {
    description: description
  });
  properties.setProperty(eventKey, event.getId());
  if (incomingRevision) properties.setProperty(revisionKey, incomingRevision);
  properties.deleteProperty(cancelledKey);
  return {status: 'created', eventId: event.getId()};
}

function syncRoomEvent(calendar, data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return syncRoomEventUnlocked(calendar, data);
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (!calendarSecret() || data.secret !== calendarSecret()) {
      return jsonResponse({status: 'error', message: 'Unauthorized'});
    }

    var calendar = CalendarApp.getDefaultCalendar();

    if (data.action === 'syncRoom') {
      return jsonResponse(syncRoomEvent(calendar, data));
    }

    var startDate = parseLocalCalendarDate(data.startDate);
    var endDate = parseLocalCalendarDate(data.endDate);

    var eventSummary = data.summary || 'Wanderlust Booking';
    var eventDescription = data.description || '';

    var event = calendar.createAllDayEvent(eventSummary, startDate, endDate, {
      description: eventDescription
    });

    return jsonResponse({
      status: 'created',
      eventId: event.getId()
    });

  } catch (err) {
    return jsonResponse({status: 'error', message: err.toString()});
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
