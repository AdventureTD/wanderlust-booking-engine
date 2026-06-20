import wixLocation from 'wix-location';
import { createBooking } from 'backend/availability';
import { getAllSettings } from 'backend/settings';
function fmtCurrency(n) { return Number(n || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }

const ROOM_DISPLAY_NAMES = {
  adventure_suite: 'Adventure Suite',
  penthouse_apartment: 'Penthouse Apartment',
  two_bedroom_apartment: 'Two Bedroom Apartment',
};
function getRoomDisplayName(roomCode) {
  return ROOM_DISPLAY_NAMES[roomCode] || (roomCode || '').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

function getParam(name) {
  const q = wixLocation.query || {};
  return q[name] || null;
}

function isPreviewMode() {
  try { const q = wixLocation.query || {}; return !!q.editorSessionId || !!q.isEditor; } catch (e) { return false; }
}

function safeText(id, txt) { try { $w('#' + id).text = txt; } catch (e) {} }
function safeVal(id) { try { return $w('#' + id).value || ''; } catch (e) { return ''; } }
function safeDisable(id, v) {
  try {
    const el = $w('#' + id);
    if (v && typeof el.disable === 'function') el.disable();
    if (!v && typeof el.enable === 'function') el.enable();
  } catch (e) {}
}

function fmtDate(d) {
  if (!d) return '';
  return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
}

function parseDateStr(s) {
  if (!s) return null;
  const p = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (p) {
    const d = new Date(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

let bookingData = {};

$w.onReady(function () {
  initGuestDetails().catch(function (e) { safeText('confirmStatus', 'Error: ' + e.message); });
});

async function initGuestDetails() {
  let rcParam = getParam('rc');
  let cis = getParam('ci');
  let cos = getParam('co');

  if (rcParam) rcParam = decodeURIComponent(rcParam);
  if (cis) cis = decodeURIComponent(cis);
  if (cos) cos = decodeURIComponent(cos);

  if (!rcParam) {
    try {
      rcParam = sessionStorage.getItem('_wbe_rc');
      cis = cis || sessionStorage.getItem('_wbe_ci');
      cos = cos || sessionStorage.getItem('_wbe_co');
    } catch (e) {}
  }

  if (!rcParam && isPreviewMode()) {
    rcParam = 'adventure_suite:2:792,two_bedroom_apartment:3:1188';
    cis = '2026-06-07';
    cos = '2026-06-12';
  }

  const ciDate = parseDateStr(cis), coDate = parseDateStr(cos);
  const oneDay = 86400000;
  const nights = ciDate && coDate ? Math.round((coDate - ciDate) / oneDay) : 0;

  const rooms = [];
  if (rcParam) {
    const parts = rcParam.split(',');
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i].split(':');
      if (s.length >= 3) rooms.push({ roomCode: s[0], guests: parseInt(s[1], 10) || 1, baseRate: parseInt(s[2], 10) || 0 });
      else if (s.length === 2) rooms.push({ roomCode: s[0], guests: parseInt(s[1], 10) || 1, baseRate: 0 });
      else if (parts[i]) rooms.push({ roomCode: parts[i], guests: 1, baseRate: 0 });
    }
  }

  bookingData = { rooms, ci: cis, co: cos, nights };

  console.log('>>> GUEST CONFIRM rooms parsed:', rooms.length, rooms);

  if (rooms.length === 0) {
    safeText('reviewDates', '-');
    safeText('reviewRooms', 'No rooms selected.');
    safeText('reviewGrandTotal', '$0.00');
    safeText('confirmStatus', 'No rooms selected. Please return to search.');
    return;
  }

  safeText('reviewDates', fmtDate(ciDate) + ' – ' + fmtDate(coDate) + ' (' + nights + ' nights)');

  let settings = {};
  try { settings = await getAllSettings(); } catch (e) {}
  const accommodationShare = parseFloat(settings.accommodationShare) || 0.5;
  const taxRateAccommodation = parseFloat(settings.taxRate_accommodation) || 0.10;
  const taxRateAdventure = parseFloat(settings.taxRate_standard) || 0.15;
  const propertyFeeRate = parseFloat(settings.propertyFeeRate) || 0.05;

  let subtotal = 0, totalAccVat = 0, totalPkgVat = 0, roomLines = [];
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i], displayName = getRoomDisplayName(r.roomCode);
    const total = r.baseRate * (r.qty || 1) * nights;
    const accNet = total * accommodationShare, advNet = total * (1 - accommodationShare);
    const accVat = accNet * taxRateAccommodation, pkgVat = advNet * taxRateAdventure;
    subtotal += total;
    totalAccVat += accVat;
    totalPkgVat += pkgVat;
    r.roomTotal = total;
    r.accomodationVat = accVat;
    r.packageVat = pkgVat;
    r.country = '';
    roomLines.push(displayName + ' — ' + r.guests + ' guest' + (r.guests > 1 ? 's' : '') + ' · $' + fmtCurrency(total));
  }

  safeText('reviewRooms', roomLines.join('  |  '));

  const propertyFee = subtotal * propertyFeeRate;
  const totalVat = totalAccVat + totalPkgVat;
  const grandTotal = subtotal + propertyFee + totalVat;
  bookingData.grandTotal = grandTotal;
  bookingData.subtotal = subtotal;
  bookingData.propertyFee = propertyFee;
  bookingData.totalVat = totalVat;

  safeText('reviewGrandTotal', '$' + fmtCurrency(grandTotal));
  safeText('confirmSummary',
    'Deposit (50%) due now: $' + fmtCurrency(grandTotal * 0.5) +
    ' · balance due 30 days before arrival. ' +
    'Payment is processed manually — we will be in touch.');

  const btn = (function () { try { return $w('#confirmBooking'); } catch (e) { console.log('>>> confirmBooking find error:', e.message); return null; } })();
  if (btn) {
    console.log('>>> confirmBooking found. checking API...');
    // Try Button-style .onClick()
    if (typeof btn.onClick === 'function') {
      btn.onClick(confirmHandler);
      console.log('>>> confirmHandler bound via Button.onClick()');
    // Try Link-style .link + onClick combination
    } else if (typeof btn.link !== 'undefined' && typeof btn.onClick === 'function') {
      btn.onClick(confirmHandler);
      console.log('>>> confirmHandler bound via Link.onClick()');
    } else {
      console.log('>>> confirmBooking exists but onClick is not available.');
      console.log('>>> It must be a Text/Box/Container element, not a Button or Link.');
      console.log('>>> FIX: In Wix Editor, delete this element and add a real Button.');
      console.log('>>> Element methods available:', Object.keys(btn).filter(function(k) { return typeof btn[k] === 'function'; }).slice(0,10).join(', '));
    }
    // Extra check: does the element have .label or .text? Helps identify what it is.
    if (typeof btn.label === 'string') console.log('>>> confirmBooking looks like a Button (has .label)');
    if (typeof btn.text === 'string') console.log('>>> confirmBooking looks like a Text element (has .text)');
    if (typeof btn.link === 'string') console.log('>>> confirmBooking looks like a Link element (has .link)');
  } else {
    console.log('>>> confirmBooking NOT FOUND in DOM');
  }
}

async function confirmHandler() {
  console.log('>>> confirmHandler ENTER — booking click received');
  const name = safeVal('inputGuestName').trim();
  const email = safeVal('inputGuestEmail').trim();
  const phone = safeVal('inputGuestPhone').trim();

  console.log('>>> confirmHandler vals: name=' + name + ' email=' + email + ' phone=' + phone);

  if (!name) { safeText('confirmStatus', 'Please enter your full name.'); console.log('>>> confirmHandler BLOCKED: no name'); return; }
  if (!email || email.indexOf('@') < 0) { safeText('confirmStatus', 'Please enter a valid email address.'); console.log('>>> confirmHandler BLOCKED: invalid email'); return; }

  console.log('>>> confirmHandler creating bookings for', (bookingData.rooms || []).length, 'rooms');
  safeText('confirmStatus', 'Processing your booking...');
  safeDisable('confirmBooking', true);

  const rooms = bookingData.rooms || [];
  const ci = bookingData.ci;
  const bookings = [], errors = [];
  let sharedBookingNumber = '';

  try {
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      try {
        const payload = {
          roomCode: r.roomCode,
          checkIn: ci,
          checkOut: bookingData.co,
          guests: r.guests,
          status: 'confirmed',
          guestName: name,
          guestEmail: email,
          guestPhone: phone,
          roomTotal: r.roomTotal || 0,
          propertyFee: bookingData.propertyFee || 0,
          accomodationVat: r.accomodationVat || 0,
          packageVat: r.packageVat || 0,
          grandTotal: bookingData.grandTotal || 0,
          country: r.country || ''
        };
        if (sharedBookingNumber) payload.bookingNumber = sharedBookingNumber;

        console.log('>>> confirmHandler calling createBooking for', r.roomCode);
        const b = await createBooking(payload);
        console.log('>>> confirmHandler createBooking success:', b ? 'yes' : 'no');
        console.log('>>> confirmHandler RETURNED booking:', JSON.stringify(b && b._id ? { _id: b._id, status: b.status, bookingNumber: b.bookingNumber, fieldKeys: Object.keys(b).slice(0,10) } : b));
        bookings.push(b);
        if (!sharedBookingNumber && b.bookingNumber) sharedBookingNumber = b.bookingNumber;
      } catch (e) { console.log('>>> confirmHandler createBooking ERROR for', r.roomCode + ':', e.message); errors.push(r.roomCode + ': ' + e.message); }
    }

    if (errors.length > 0) {
      safeText('confirmStatus', 'Some rooms could not be booked: ' + errors.join('; '));
      safeDisable('confirmBooking', false);
      return;
    }

    const roomNames = rooms.map(function (r) { return r.roomCode.replace(/_/g, ' '); }).join(', ');
    safeText('confirmStatus',
      'Booking confirmed! Reserved ' + roomNames +
      ' from ' + fmtDate(parseDateStr(ci)) + ' to ' + fmtDate(parseDateStr(bookingData.co)) +
      '. Confirmation sent to ' + email + '.');

    safeText('inputGuestName', '');
    safeText('inputGuestEmail', '');
    safeText('inputGuestPhone', '');

    // Redirect to main website after successful booking
    wixLocation.to('https://www.wanderlustcaribbean.com');
  } catch (e) {
    console.log('>>> confirmHandler OUTER CATCH:', e.message);
    safeText('confirmStatus', 'Booking error: ' + e.message);
    safeDisable('confirmBooking', false);
  }
  console.log('>>> confirmHandler EXIT — bookings created:', bookings.length, 'errors:', errors.length);
}
