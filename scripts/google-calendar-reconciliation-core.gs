/* Disconnected LOOKUP_ONLY observer. Consistency is not dispatch authority.
 * Utilities SHA-256 / UTF-8 is the sole Apps Script runtime dependency.
 * No transport, endpoint, booking consumer or first-attempt custody exists here.
 */
function reconcileBookingCalendarEvent(proposal, mode, io) {
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function keys(value, expected) {
    return object(value) && Reflect.ownKeys(value).length === expected.length &&
      expected.every(function (key) {
        var d = Object.getOwnPropertyDescriptor(value, key);
        return d && Object.prototype.hasOwnProperty.call(d, 'value');
      });
  }
  function scalar(value) {
    if (typeof value !== 'string' || value.length === 0) return false;
    for (var i = 0; i < value.length; i++) {
      var c = value.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var next = value.charCodeAt(++i);
        if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
      } else if (c >= 0xDC00 && c <= 0xDFFF) return false;
    }
    return true;
  }
  function civil(value) {
    if (!scalar(value) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.length !== 10) return false;
    var y = Number(value.slice(0, 4)), m = Number(value.slice(5, 7)), d = Number(value.slice(8, 10));
    var leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  var denied = {status:'DENIED', calendarId:null, eventId:null, reason:'INVALID_INPUT'};
  var calendarId, eventId, desired;
  try {
    if (mode !== 'LOOKUP_ONLY' || !keys(proposal, ['kind','v','audience','acceptanceId','calendarId','eventId','event'])) return denied;
    if (proposal.kind !== 'UNTRUSTED_CALENDAR_EVENT_PROPOSAL' || proposal.v !== 1 ||
        !scalar(proposal.audience) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(proposal.audience) || /\n$/.test(proposal.audience) ||
        !scalar(proposal.acceptanceId) || !/^[a-f0-9]{64}$/.test(proposal.acceptanceId) || proposal.acceptanceId.length !== 64 ||
        !scalar(proposal.calendarId) || proposal.calendarId === 'primary' || !scalar(proposal.eventId)) return denied;
    var event = proposal.event;
    if (!keys(event, ['id','summary','description','start','end','status']) ||
        !keys(event.start, ['date']) || !keys(event.end, ['date']) ||
        !scalar(event.summary) || !scalar(event.description) ||
        event.summary.indexOf('Wanderlust Caribbean Booking: ') !== 0) return denied;
    var guest = event.summary.slice('Wanderlust Caribbean Booking: '.length);
    if (!scalar(guest) || event.description !== 'Wanderlust Booking: ' + guest || event.status !== 'confirmed' ||
        !civil(event.start.date) || !civil(event.end.date) || event.end.date <= event.start.date) return denied;
    var canonical = JSON.stringify(['wbe.booking-calendar.event', 1, proposal.audience, proposal.calendarId, proposal.acceptanceId]);
    var id = 'bcal1' + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    if (proposal.eventId !== id || event.id !== id) return denied;
    calendarId = proposal.calendarId;
    eventId = id;
    // Retain detached primitive desired fields before invoking supplied IO.
    desired = {summary:event.summary, description:event.description, start:event.start.date, end:event.end.date};
  } catch (_) { return denied; }
  function result(status, reason) { return {status:status, calendarId:calendarId, eventId:eventId, reason:reason}; }
  try {
    var response = io.get(calendarId, eventId);
    // Required provider fields must be own data, not inherited values/getters.
    // Read descriptors once; unrelated REST metadata is deliberately ignored.
    function data(value, key) {
      if (!object(value)) throw new Error('Malformed provider object');
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
        throw new Error('Malformed provider field');
      return descriptor.value;
    }
    if (data(response, 'status') !== 200) return result('OWNER_REVIEW', 'LOOKUP_UNRESOLVED');
    var actual = data(response, 'event');
    var status = data(actual, 'status');
    // Google cancelled tombstones can lack every display/date field.
    if (status === 'cancelled') return result('OWNER_REVIEW', 'EVENT_CANCELLED');
    var actualId = data(actual, 'id'), summary = data(actual, 'summary');
    var description = data(actual, 'description');
    var start = data(actual, 'start'), end = data(actual, 'end');
    var startDate = data(start, 'date'), endDate = data(end, 'date');
    if (actualId !== eventId || status !== 'confirmed' || summary !== desired.summary ||
        description !== desired.description || startDate !== desired.start || endDate !== desired.end ||
        'dateTime' in start || 'dateTime' in end || 'recurrence' in actual || 'recurringEventId' in actual)
      return result('OWNER_REVIEW', 'EVENT_MISMATCH');
    return result('SYNCED', 'MATCHED');
  } catch (_) { return result('OWNER_REVIEW', 'LOOKUP_UNRESOLVED'); }
}
