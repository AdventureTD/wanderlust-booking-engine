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

var CALENDAR_SECRET = 'DominicaBooking';

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

    if (data.secret !== CALENDAR_SECRET) {
      return jsonResponse({status: 'error', message: 'Unauthorized'});
    }

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

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
