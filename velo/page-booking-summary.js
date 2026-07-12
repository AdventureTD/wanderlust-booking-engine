import wixLocation from 'wix-location';
import wixData from 'wix-data';
import { getAllSettings } from 'backend/settings';
import { getRoomNames } from 'backend/rooms';
import { getPackageAmenities } from 'backend/packages';
import { createBooking, issueBookingInvoice, validatePromoCode } from 'backend/availability';
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

function fmtDate(d) {
  if (!d) return '';
  return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
}

/* nightsFromDisplay — parse checkInDisplay / checkOutDisplay text ("M/D/YYYY")
   and return the number of nights.  Used to look up package title by stay length. */
function nightsFromDisplay(ciText, coText) {
  if (!ciText || !coText) return 0;
  try {
    const d1 = new Date(ciText);
    const d2 = new Date(coText);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
    const ms = d2 - d1;
    const days = Math.round(ms / 86400000);
    return days > 0 ? days : 0;
  } catch (e) { return 0; }
}

function safeText(id, txt) {
  try {
    const el = $w('#' + id);
    if (typeof el.expand === 'function') el.expand();
    if (typeof el.show   === 'function') el.show();
    el.text = txt;
  } catch (e) {}
}
function safeCollapse(id) {
  try {
    const el = $w('#' + id);
    if (typeof el.collapse === 'function') el.collapse();
    if (typeof el.hide    === 'function') el.hide();
  } catch (e) {}
}
function safeExpand(id) {
  try {
    const el = $w('#' + id);
    if (typeof el.expand === 'function') el.expand();
    if (typeof el.show   === 'function') el.show();
  } catch (e) {}
}
function safeVal(id) { try { return $w('#' + id).value || ''; } catch (e) { return ''; } }
function safeTextRead(id) { try { return $w('#' + id).text || ''; } catch (e) { return ''; } }
function safeDisable(id, v) {
  try {
    const el = $w('#' + id);
    if (v && typeof el.disable === 'function') el.disable();
    if (!v && typeof el.enable === 'function') el.enable();
  } catch (e) {}
}

function isPreviewMode() {
  try { const q = wixLocation.query || {}; return !!q.editorSessionId || !!q.isEditor; } catch (e) { return false; }
}

function safeItem($item, selector, action, val) {
  try {
    const el = $item(selector);
    if (action === 'text') el.text = val;
    if (action === 'collapse') el.collapse();
    if (action === 'expand') el.expand();
    if (action === 'options') el.options = val;
    if (action === 'value') el.value = val;
    return el;
  } catch (e) { return null; }
}

let _guestCounts = {};
let _summaryRooms = [];
let _summaryNights = 7;
let _summaryCis = '';
let _summaryCos = '';
let _summarySettings = {};
let _roomRepReady = false;
let _renderCount = 0;
let _roomNames = {};
let _promoDiscount = 0;   // e.g. 0.15
let _promoCodeApplied = ''; // e.g. 'SAVE15'

$w.onReady(function () {
  initSummary().catch(function (e) { console.log('>>> init error:', e.message); });
});

async function initSummary() {
  let rcParam = getParam('rc');
  let cis = getParam('ci');
  let cos = getParam('co');
  let guestsParam = getParam('guests');

  // Single-room detail-page redirect fallback (roomCode, checkIn, checkOut, guests)
  const roomParam = getParam('roomCode');
  if (!rcParam && roomParam) {
    rcParam = roomParam + ':1:0';
    cis = cis || getParam('checkIn') || '';
    cos = cos || getParam('checkOut') || '';
  }

  if (!rcParam) {
    try {
      rcParam = sessionStorage.getItem('_wbe_rc') || localStorage.getItem('_wbe_rc');
      cis = cis || sessionStorage.getItem('_wbe_ci') || localStorage.getItem('_wbe_ci');
      cos = cos || sessionStorage.getItem('_wbe_co') || localStorage.getItem('_wbe_co');
    } catch (e) {}
  }

  if (!rcParam && isPreviewMode()) {
    rcParam = 'adventure_suite:2:792,two_bedroom_apartment:3:1188';
    cis = '2026-06-07';
    cos = '2026-06-12';
  }

  const ciDate = parseDateStr(cis), coDate = parseDateStr(cos);
  const oneDay = 86400000;
  const nights = ciDate && coDate ? Math.round((coDate - ciDate) / oneDay) : 7;

  safeText('checkInDisplay', fmtDate(ciDate) || '-');
  safeText('checkOutDisplay', fmtDate(coDate) || '-');

  const rooms = [];
  if (rcParam) {
    const parts = rcParam.split(',');
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i].split(':');
      if (s.length >= 3) rooms.push({ roomCode: s[0], qty: parseInt(s[1], 10) || 1, baseRate: parseInt(s[2], 10) || 0 });
      else if (s.length === 2) rooms.push({ roomCode: s[0], qty: parseInt(s[1], 10) || 1, baseRate: 0 });
      else if (parts[i]) rooms.push({ roomCode: parts[i], qty: 1, baseRate: 0 });
    }
  }

  let settings = {};
  let roomNames = {};
  try { settings = await getAllSettings(); } catch (e) {}
  try { roomNames = await getRoomNames(); } catch (e) {}

  _summaryRooms = rooms;
  _summaryNights = nights;
  _summaryCis = cis;
  _summaryCos = cos;
  _summarySettings = settings;
  _roomNames = roomNames;
  _guestCounts = {};

  initRoomRepeater();
  await renderSummary();
  wireContinueButton();
  wirePromoCode();
}

async function wirePromoCode() {
  // This runs on group (repeater) load — the input/button are inside the repeater
  const promoInput = (function () { try { return $w('#promoCode'); } catch (e) { return null; } })();
  const promoBtn = (function () { try { return $w('#btnApplyPromo'); } catch (e) { return null; } })();
  const promoStatus = (function () { try { return $w('#promoStatus'); } catch (e) { return null; } })();
  if (!promoInput || !promoBtn) return;

  promoBtn.onClick(async function () {
    const code = (promoInput.value || '').trim();
    if (!code) return;

    try {
      safeText('promoStatus', 'Checking...');
      const result = await validatePromoCode(code);
      if (result && result.valid) {
        _promoDiscount = parseFloat(result.discount) || 0;
        _promoCodeApplied = code;
        safeText('promoStatus', code + ' applied! Discount: ' + ((_promoDiscount * 100).toFixed(0)) + '% off');
        await renderSummary();
      } else {
        _promoDiscount = 0;
        _promoCodeApplied = '';
        safeText('promoStatus', result && result.reason ? result.reason : 'Invalid or expired promo code.');
        await renderSummary();
      }
    } catch (e) {
      safeText('promoStatus', 'Error: ' + e.message);
    }
  });
}

}

async function renderSummary() {
  _renderCount++;
  const rooms = _summaryRooms;
  const nights = _summaryNights;

  if (rooms.length === 0) {
    safeText('accommodationNamesText', 'No rooms selected.');
    safeText('packageSubTotal', '$' + fmtCurrency(0));
    safeCollapse('summaryRoomsRepeater');
    safeText('subtotalNetText', '$' + fmtCurrency(0));
    safeText('vatAccommodationText', '$' + fmtCurrency(0));
    safeText('vatAdventureText', '$' + fmtCurrency(0));
    safeText('vatAcc', '$' + fmtCurrency(0));
    safeText('vatSer', '$' + fmtCurrency(0));
    safeText('totalVatText', '$' + fmtCurrency(0));
    safeText('propertyFeeText', '$' + fmtCurrency(0));
    safeText('grandTotalText', '$' + fmtCurrency(0));
    return;
  }

  const settings = _summarySettings;
  const propertyFeeRate = parseFloat(settings.propertyFeeRate) || 0.05;
  const accommodationShare = parseFloat(settings.accommodationShare) || 0.5;
  const taxRateAccommodation = parseFloat(settings.taxRate_accommodation) || 0.10;
  const taxRateAdventure = parseFloat(settings.taxRate_standard) || 0.15;

  const names = [], repData = [];
  let subtotalNet = 0, propertyFee = 0;

  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    const displayName = _roomNames[r.roomCode] && _roomNames[r.roomCode] !== r.roomCode ? _roomNames[r.roomCode] : getRoomDisplayName(r.roomCode);
    names.push(displayName + ' x' + r.qty);
    const rate = r.baseRate || (r.roomCode === 'adventure_suite' ? 792 : r.roomCode === 'penthouse_apartment' ? 930 : r.roomCode === 'two_bedroom_apartment' ? 1188 : 0);
    const roomTotal = rate * r.qty * nights;
    subtotalNet += roomTotal;
    propertyFee += roomTotal * propertyFeeRate;

    const accNet = roomTotal * accommodationShare;
    const advNet = roomTotal * (1 - accommodationShare);
    r.roomTotal = roomTotal;
    r.accomodationVat = accNet * taxRateAccommodation;
    r.packageVat = advNet * taxRateAdventure;
    r.propertyFee = roomTotal * propertyFeeRate;

    repData.push({ _id: 'sum_' + i + '_' + _renderCount, roomCode: r.roomCode, roomName: displayName, qty: r.qty, baseRate: rate, roomTotal: roomTotal });
  }

  const accNet = subtotalNet * accommodationShare;
  const advNet = subtotalNet * (1 - accommodationShare);
  const vatAccommodation = accNet * taxRateAccommodation;
  const vatAdventure = advNet * taxRateAdventure;
  const totalVat = vatAccommodation + vatAdventure;
  const grandTotal = subtotalNet + propertyFee + totalVat;

  // Promo discount applied to subtotalNet before taxes and fees
  const discountAmount = _promoDiscount > 0 ? Math.round(subtotalNet * _promoDiscount * 100) / 100 : 0;
  const discountedSubtotal = Math.round((subtotalNet - discountAmount) * 100) / 100;
  const discountedAccNet = discountedSubtotal * accommodationShare;
  const discountedAdvNet = discountedSubtotal * (1 - accommodationShare);
  const discountedVatAccommodation = discountedAccNet * taxRateAccommodation;
  const discountedVatAdventure = discountedAdvNet * taxRateAdventure;
  const discountedTotalVat = Math.round((discountedVatAccommodation + discountedVatAdventure) * 100) / 100;
  const discountedPropertyFee = Math.round(discountedSubtotal * propertyFeeRate * 100) / 100;
  const discountedGrandTotal = Math.round((discountedSubtotal + discountedPropertyFee + discountedTotalVat) * 100) / 100;

  safeText('accommodationNamesText', names.join(', '));
  safeText('packageSubTotal', '$' + fmtCurrency(subtotalNet));
  safeText('subtotalNetText', '$' + fmtCurrency(discountedSubtotal));

  // Promo display
  if (_promoDiscount > 0 && _promoCodeApplied) {
    safeExpand('promoDiscountRow');
    safeText('promoDiscountText', 'Promo Code (' + _promoCodeApplied + '): -$' + fmtCurrency(discountAmount) + ' (-' + (_promoDiscount * 100) + '%)');
  } else {
    safeCollapse('promoDiscountRow');
    safeText('promoDiscountText', '');
  }

  safeText('vatAccommodationText', '$' + fmtCurrency(discountedVatAccommodation));
  safeText('vatAdventureText', '$' + fmtCurrency(discountedVatAdventure));
  safeText('vatAcc', '$' + fmtCurrency(discountedAccNet));
  safeText('vatSer', '$' + fmtCurrency(discountedAdvNet));
  safeText('totalVatText', '$' + fmtCurrency(discountedTotalVat));
  safeText('propertyFeeText', '$' + fmtCurrency(discountedPropertyFee));
  safeText('grandTotalText', '$' + fmtCurrency(discountedGrandTotal));

  // Update totalNightsDisplay with calculated nights
  if (nights > 0) {
    safeText('totalNightsDisplay', String(nights) + ' night' + (nights !== 1 ? 's' : ''));
  }

  // packageName: look up title from Packages by nights.
  let pkgTitle = '';
  try {
    const ciText = safeTextRead('checkInDisplay');
    const coText = safeTextRead('checkOutDisplay');
    const nts = nightsFromDisplay(ciText, coText) || _summaryNights || 0;

    if (nts > 0) {
      try {
        const beResult = await getPackageAmenities(nts);
        if (beResult && beResult.title) pkgTitle = beResult.title;
      } catch (beErr) {}

      if (!pkgTitle) {
        try {
          const res = await wixData.query('Packages').limit(100).find();
          for (let i = 0; i < res.items.length; i++) {
            const item = res.items[i];
            const itemNights = item.numberOfNights || item.NumberOfNights || item.numberofnights || 0;
            if (Number(itemNights) === Number(nts)) {
              pkgTitle = item.title_fld || item.title || item.Title || item.name || item.Name || '';
              break;
            }
          }
        } catch (qErr) {}
      }
    }

    // Single debug log to diagnose the exact state
    console.log('[WBE] nts=' + nts + ' pkgTitle=' + pkgTitle + ' summaryNights=' + _summaryNights);

    if (pkgTitle) {
      safeExpand('box1');
      safeExpand('packageName');
      safeText('packageName', pkgTitle);
      console.log('[WBE] SET packageName to:', pkgTitle);
    } else {
      safeCollapse('packageName');
      console.log('[WBE] COLLAPSED packageName, no title found');
    }
  } catch (e) {
    safeCollapse('packageName');
    console.log('[WBE] ERROR:', e.message);
  }

  renderRoomRepeater(repData);
}

function initRoomRepeater() {
  if (_roomRepReady) return;
  let rep;
  try { rep = $w('#summaryRoomsRepeater'); } catch (e) { rep = null; }
  if (!rep) return;
  if (typeof rep.onItemReady !== 'function') return;
  _roomRepReady = true;

  rep.onItemReady(($item, itemData) => {
    safeItem($item, '#roomNameText', 'text', itemData.roomName || itemData.roomCode || '');
    safeItem($item, '#qtyRooms', 'text', String(itemData.qty || 1));
    safeItem($item, '#roomPriceText', 'text', '$' + (itemData.baseRate || 0) + ' / night (' + _summaryNights + ' nights)');

    const dd = safeItem($item, '#guestsDropdown', null, null);
    if (dd && typeof dd.onChange === 'function') {
      const rc = itemData.roomCode;
      let opts = [];
      if (rc === 'two_bedroom_apartment') {
        opts = [{ label: '3', value: '3' }, { label: '4', value: '4' }];
      } else {
        opts = [{ label: '2', value: '2' }];
      }
      dd.options = opts;
      const defaultVal = rc === 'two_bedroom_apartment' ? '3' : '2';
      try { dd.required = false; } catch (e) {}
      setTimeout(() => {
        dd.value = defaultVal;
        try { dd.valid = true; } catch (e) {}
        try { dd.resetValidityIndication(); } catch (e) {}
        _guestCounts[rc] = parseInt(defaultVal, 10);
      }, 300);
      dd.onChange(function (ev) { _guestCounts[rc] = parseInt(ev.target.value, 10) || parseInt(defaultVal, 10); });
    }

    safeItem($item, '#roomTotalText', 'text', '$' + fmtCurrency(itemData.roomTotal || 0));
    const rmBtn = safeItem($item, '#removeBtn', null, null);
    if (rmBtn && typeof rmBtn.onClick === 'function') {
      rmBtn.onClick(() => {
        _summaryRooms = _summaryRooms.filter(r => r.roomCode !== itemData.roomCode);
        delete _guestCounts[itemData.roomCode];
        renderSummary();
      });
    }
  });
}

function renderRoomRepeater(repData) {
  const rep = (function () { try { return $w('#summaryRoomsRepeater'); } catch (e) { return null; } })();
  if (!rep) return;
  rep.data = [];
  rep.data = repData;
  safeExpand('summaryRoomsRepeater');
}

function wireContinueButton() {
  let btn;
  try { btn = $w('#btnContinue'); } catch (e) { return; }
  if (!btn || typeof btn.onClick !== 'function') return;
  if (typeof btn.link === 'string') btn.link = '';

  btn.onClick(async function () {
    const name = safeVal('inputGuestName').trim();
    const email = safeVal('inputGuestEmail').trim();
    const phone = safeVal('inputGuestPhone').trim();

    if (!name) { safeText('bookingStatus', 'Please enter your full name.'); return; }
    if (!email || email.indexOf('@') < 0) { safeText('bookingStatus', 'Please enter a valid email address.'); return; }

    safeText('bookingStatus', 'Processing your booking...');
    safeDisable('btnContinue', true);

    const rooms = _summaryRooms || [];
    const ci = _summaryCis;
    const bookings = [], errors = [];
    let sharedBookingNumber = '';

    try {
      // Phase 1: book first room to get shared booking number
      if (rooms.length > 0) {
        const r0 = rooms[0];
        const payload0 = {
          roomCode: r0.roomCode,
          checkIn: ci,
          checkOut: _summaryCos,
          guests: _guestCounts[r0.roomCode] || r0.qty || 1,
          status: 'confirmed',
          guestName: name,
          guestEmail: email,
          guestPhone: phone,
          roomTotal: r0.roomTotal || 0,
          propertyFee: r0.propertyFee || 0,
          accomodationVat: r0.accomodationVat || 0,
          packageVat: r0.packageVat || 0,
          grandTotal: ((r0.roomTotal || 0) + (r0.accomodationVat || 0) + (r0.packageVat || 0) + (r0.propertyFee || 0)) || 0,
          promoCode: _promoCodeApplied,
          promoDiscount: _promoDiscount,
        };
        const b0 = await createBooking(payload0);
        bookings.push(b0);
        if (b0.bookingNumber) sharedBookingNumber = b0.bookingNumber;
      }

      // Phase 2: book remaining rooms in parallel
      if (rooms.length > 1 && sharedBookingNumber) {
        const restPromises = [];
        for (let i = 1; i < rooms.length; i++) {
          const r = rooms[i];
          const payload = {
            roomCode: r.roomCode,
            checkIn: ci,
            checkOut: _summaryCos,
            guests: _guestCounts[r.roomCode] || r.qty || 1,
            status: 'confirmed',
            guestName: name,
            guestEmail: email,
            guestPhone: phone,
            roomTotal: r.roomTotal || 0,
            propertyFee: r.propertyFee || 0,
            accomodationVat: r.accomodationVat || 0,
            packageVat: r.packageVat || 0,
            grandTotal: ((r.roomTotal || 0) + (r.accomodationVat || 0) + (r.packageVat || 0) + (r.propertyFee || 0)) || 0,
            bookingNumber: sharedBookingNumber,
            promoCode: _promoCodeApplied,
            promoDiscount: _promoDiscount,
          };
          restPromises.push(
            createBooking(payload)
              .then(function (b) { return { ok: true, b: b }; })
              .catch(function (e) { return { ok: false, err: r.roomCode + ': ' + e.message }; })
          );
        }
        const restResults = await Promise.all(restPromises);
        for (let j = 0; j < restResults.length; j++) {
          const res = restResults[j];
          if (res.ok) {
            bookings.push(res.b);
          } else {
            errors.push(res.err);
          }
        }
      }
      if (errors.length > 0) {
        safeText('bookingStatus', 'Some rooms could not be booked: ' + errors.join('; '));
        safeDisable('btnContinue', false);
        return;
      }

      if (sharedBookingNumber) {
        try {
          safeText('bookingStatus', 'Booking confirmed! Creating invoice...');
          const invResult = await issueBookingInvoice(sharedBookingNumber);
          console.log('[WBE-FRONTEND] Invoice service response:', JSON.stringify(invResult));
          // If calendar creation failed, log but still continue to redirect.
          if (invResult && invResult._calendar_debug && !invResult._calendar_debug.ok) {
            console.warn('[WBE-FRONTEND] Calendar event NOT created:', invResult._calendar_debug);
          }
        } catch (e) {
          console.error('[WBE-FRONTEND] Invoice generation failed:', e.message);
        }
      }

      safeText('bookingStatus', 'Booking confirmed! Taking you home...');
      wixLocation.to('https://www.wanderlustcaribbean.com');
    } catch (e) {
      safeText('bookingStatus', 'Booking error: ' + e.message);
      safeDisable('btnContinue', false);
    }
  });
}

function getGuestCount(idx) {
  const rep = (function () { try { return $w('#summaryRoomsRepeater'); } catch (e) { return null; } })();
  if (!rep || !rep.data) return null;
  const item = rep.data[idx];
  if (!item) return null;
  return _guestCounts[item.roomCode] || item.qty || null;
}
