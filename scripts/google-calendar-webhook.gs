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
 * 9. Add that URL to your Render/Python service environment variable:
 *    - WBE_CALENDAR_WEB_APP_URL = <the copied URL>
 *    - WBE_CALENDAR_SECRET = <a secret passphrase you'll share with me>
 */

var CALENDAR_SECRET = PropertiesService.getScriptProperties().getProperty('WBE_CALENDAR_SECRET');

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

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (!CALENDAR_SECRET || data.secret !== CALENDAR_SECRET) {
      return jsonResponse({status: 'error', message: 'Unauthorized'});
    }

    if (data.bookingNumber || data.action) return jsonResponse(bookingCalendarAction(data));
    var calendar = CalendarApp.getDefaultCalendar();

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

// Script properties retain one booking-bound event identity. Never search/delete by name.
function bookingCalendarAction(data) {
  if (!/^WC-[0-9]+$/.test(data.bookingNumber || '') || (data.action && data.action !== 'cancel')) return {status: 'INVALID_REQUEST'};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'PENDING'};
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'booking:' + data.bookingNumber;
    var raw = props.getProperty(key);
    var record = raw ? JSON.parse(raw) : null;
    var calendar = CalendarApp.getDefaultCalendar();
    if (data.action === 'cancel') {
      if (!record) {
        props.setProperty(key, JSON.stringify({state: 'CANCELLED_UNBOUND'}));
        return {status: 'NEEDS_RECONCILIATION'};
      }
      if (typeof record.eventId !== 'string' || !record.eventId || record.calendarId !== calendar.getId() ||
          !calendar.isOwnedByMe()) return {status: 'NEEDS_RECONCILIATION'};
      var existing = calendar.getEventById(record.eventId);
      if (existing) {
        if (existing.getTag('wbeBooking') !== data.bookingNumber ||
            ['CREATED', 'CANCELLED', 'DELETING', 'DELETED'].indexOf(record.state) < 0) return {status: 'NEEDS_RECONCILIATION'};
        // Old CANCELLED means title-marked, NOT deleted. Retain exact authority
        // before deletion so an applied-but-lost ACK can resume without creation.
        record.state = 'DELETING'; record.deletionVersion = 1; record.bookingNumber = data.bookingNumber;
        var pending = JSON.stringify(record);
        props.setProperty(key, pending);
        if (props.getProperty(key) !== pending) return {status: 'UNKNOWN'};
        existing.deleteEvent();
      } else if ((record.state !== 'DELETING' && record.state !== 'DELETED') ||
                 record.deletionVersion !== 1 || record.bookingNumber !== data.bookingNumber) {
        return {status: 'NEEDS_RECONCILIATION'};
      }
      // getEventById null also means inaccessible, not an HTTP 404. Only accept
      // absence on the same executor-owned calendar after a retained tagged
      // deletion attempt; permission/lookup exceptions remain UNKNOWN.
      if (calendar.getEventById(record.eventId) !== null || !calendar.isOwnedByMe() ||
          calendar.getId() !== record.calendarId) return {status: 'UNKNOWN'};
      record.state = 'DELETED';
      var deleted = JSON.stringify(record);
      props.setProperty(key, deleted);
      if (props.getProperty(key) !== deleted) return {status: 'UNKNOWN'};
      return {status: 'CANCELLED', disposition: 'DELETED', deletionVersion: 1,
        bookingNumber: data.bookingNumber, calendarId: record.calendarId, eventId: record.eventId};
    }
    if (record) {
      if (record.state !== 'CREATED' || record.startDate !== data.startDate || record.endDate !== data.endDate || record.title !== data.summary) return {status: 'NEEDS_RECONCILIATION'};
      return {status: 'created', bookingNumber: data.bookingNumber, eventId: record.eventId};
    }
    var start = parseLocalCalendarDate(data.startDate), end = parseLocalCalendarDate(data.endDate);
    if (end <= start || typeof data.summary !== 'string' || data.summary.length > 500) return {status: 'INVALID_REQUEST'};
    record = {state: 'STARTED', calendarId: calendar.getId(), title: data.summary, startDate: data.startDate, endDate: data.endDate};
    props.setProperty(key, JSON.stringify(record));
    var event = calendar.createAllDayEvent(data.summary, start, end, {description: data.description || ''});
    event.setTag('wbeBooking', data.bookingNumber);
    record.eventId = event.getId(); record.state = 'CREATED';
    props.setProperty(key, JSON.stringify(record));
    return {status: 'created', bookingNumber: data.bookingNumber, eventId: record.eventId};
  } catch (_) { return {status: 'UNKNOWN'}; }
  finally { lock.releaseLock(); }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
