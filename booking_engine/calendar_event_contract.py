"""Disconnected Calendar proposals; consistency is not booking authority."""
import hashlib
import json
import re
from datetime import date


def build_calendar_event_proposal(*, audience, calendar_id, acceptance_id,
                                  guest_name, check_in, check_out) -> dict:
    """Map untrusted proposed values, without IO or booking-state authority."""
    for value in (audience, calendar_id, acceptance_id, guest_name, check_in, check_out):
        if type(value) is not str or not value or any(0xD800 <= ord(c) <= 0xDFFF for c in value):
            raise ValueError('Invalid Calendar proposal input')
    if (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', audience)
            or not re.fullmatch(r'[a-f0-9]{64}', acceptance_id)
            or calendar_id == 'primary'):
        raise ValueError('Invalid Calendar identity')
    for value in (check_in, check_out):
        if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
            raise ValueError('Invalid civil date')
        date.fromisoformat(value)
    if check_out <= check_in:
        raise ValueError('Checkout must follow check-in')
    canonical = json.dumps(['wbe.booking-calendar.event', 1, audience,
                            calendar_id, acceptance_id], ensure_ascii=False,
                           separators=(',', ':'))
    event_id = 'bcal1' + hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    return dict(kind='UNTRUSTED_CALENDAR_EVENT_PROPOSAL', v=1,
                audience=audience, acceptanceId=acceptance_id,
                calendarId=calendar_id, eventId=event_id,
                event=dict(id=event_id,
                           summary='Wanderlust Caribbean Booking: ' + guest_name,
                           description='Wanderlust Booking: ' + guest_name,
                           start={'date': check_in}, end={'date': check_out},
                           status='confirmed'))
