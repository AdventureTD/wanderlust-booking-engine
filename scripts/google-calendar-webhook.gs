/**
 * Wanderlust Booking Engine — Google Calendar webhook.
 *
 * Update the EXISTING Calendar web-app deployment only after release approval.
 * Preserve its URL, execute-as-owner identity, Script Properties (including
 * WBE_CALENDAR_SECRET), booking mappings, and cancellation tombstones.
 * Save this complete source and publish a new version of that same deployment;
 * saving project source alone does not update the deployed receiver.
 * Keep Render's existing WBE_CALENDAR_WEB_APP_URL and matching secret unchanged.
 * Never put secret values in source, chat, logs, or installation bundles.
 * See docs/calendar-booking-number-installation.md for scope and verification.
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

    if (Object.prototype.hasOwnProperty.call(data, 'bookingNumber') || data.action) return jsonResponse(bookingCalendarAction(data));
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
  if (typeof data.bookingNumber !== 'string' || !/^WC-[0-9]+(?![\s\S])/.test(data.bookingNumber) ||
      (data.action && data.action !== 'cancel')) return {status: 'INVALID_REQUEST'};
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
      if ((Object.prototype.hasOwnProperty.call(record, 'bookingNumber') && record.bookingNumber !== data.bookingNumber) ||
          typeof record.eventId !== 'string' || !record.eventId || record.calendarId !== calendar.getId() ||
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
      if (record.state !== 'CREATED' || record.startDate !== data.startDate || record.endDate !== data.endDate || record.title !== data.summary ||
          typeof record.eventId !== 'string' || !record.eventId || record.calendarId !== calendar.getId() ||
          (Object.prototype.hasOwnProperty.call(record, 'bookingNumber') && record.bookingNumber !== data.bookingNumber)) return {status: 'NEEDS_RECONCILIATION'};
      return {status: 'created', bookingNumber: data.bookingNumber, eventId: record.eventId};
    }
    var start = parseLocalCalendarDate(data.startDate), end = parseLocalCalendarDate(data.endDate);
    if (end <= start || typeof data.summary !== 'string' || data.summary.length > 500) return {status: 'INVALID_REQUEST'};
    record = {state: 'STARTED', bookingNumber: data.bookingNumber, calendarId: calendar.getId(), title: data.summary, startDate: data.startDate, endDate: data.endDate};
    var started = JSON.stringify(record);
    props.setProperty(key, started);
    if (props.getProperty(key) !== started) return {status: 'UNKNOWN'};
    // Display labels are not deletion authority. Retain the original request title
    // above so pre-label records and identical invoice replays remain compatible.
    var title = bookingCalendarLabel(data.summary, data.bookingNumber, data.bookingNumber + ' — ');
    var description = bookingCalendarLabel(data.description || '', data.bookingNumber, 'Booking number: ' + data.bookingNumber + '\n');
    var event = calendar.createAllDayEvent(title, start, end, {description: description});
    event.setTag('wbeBooking', data.bookingNumber);
    record.eventId = event.getId(); record.state = 'CREATED';
    var created = JSON.stringify(record);
    props.setProperty(key, created);
    if (props.getProperty(key) !== created) return {status: 'UNKNOWN'};
    return {status: 'created', bookingNumber: data.bookingNumber, eventId: record.eventId};
  } catch (_) { return {status: 'UNKNOWN'}; }
  finally { lock.releaseLock(); }
}

// Exact token boundaries prevent WC-10410 from masquerading as WC-1041.
function bookingCalendarLabel(value, bookingNumber, prefix) {
  var pattern = new RegExp('(^|[^A-Za-z0-9_-])' + bookingNumber + '(?=$|[^A-Za-z0-9_-])');
  return pattern.test(value) ? value : prefix + value;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
