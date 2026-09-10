async function fetchRoomFees(roomCodes) {
  const feeMap = {};
  if (!Array.isArray(roomCodes) || roomCodes.length === 0) return feeMap;
  try {
    const res = await wixData.query('Rooms').hasSome('roomCode', roomCodes).limit(50).find();
    for (const room of res.items) {
      const rc = (room.roomCode || '').trim();
      feeMap[rc] = Number(room.roomFee) || 0;
    }
  } catch (e) {
    console.log('[WBE] fetchRoomFees error:', e.message);
  }
  return feeMap;
}

import wixLocation from 'wix-location';
import wixData from 'wix-data';
import { getAllSettings } from 'backend/settings';
import { getRoomNames } from 'backend/rooms';
import { getPackageAmenities, getPackageBaseRate, getPackageDetailsByNights, getPackagesByNights } from 'backend/packages';
import { readPricingQuote } from 'backend/pricingQuotes';
import { validatePromoCode } from 'backend/availability';
import { mountBookConfirmSearch } from 'public/bookConfirmSearch';
import { getStoredClickIds, initTracking, setSuspendGoogleAds } from 'public/tracking';
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

function normalizeDate(v) {
  if (!v) return null;
  let str = String(v).trim();
  const tIndex = str.indexOf('T');
  if (tIndex !== -1) str = str.substring(0, tIndex);
  const spaceIndex = str.indexOf(' ');
  if (spaceIndex !== -1) str = str.substring(0, spaceIndex);
  const parts = str.split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  const out = new Date(Date.UTC(y, m, d, 12, 0, 0));
  return isNaN(out.getTime()) ? null : out;
}

function parseDateStr(s) {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s.getTime()) ? null : new Date(Date.UTC(s.getFullYear(), s.getMonth(), s.getDate(), 12, 0, 0));
  if (typeof s === 'number') { const d = new Date(s); return isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0)); }
  const str = String(s);
  const tIndex = str.indexOf('T');
  if (tIndex !== -1) {
    const datePart = str.substring(0, tIndex);
    const p = datePart.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (p) {
      const d = new Date(Date.UTC(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10), 12, 0, 0));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  const p = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (p) {
    const d = new Date(Date.UTC(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10), 12, 0, 0));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
}

function fmtDate(d) {
  if (!d) return '';
  return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
}

function dateToStr(d) {
  if (!d) return '';
  if (typeof d === 'string') { const t = d.indexOf('T'); return t !== -1 ? d.substring(0, t) : d; }
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function ordinalSuffix(n) {
  const r = n % 100;
  if (r >= 11 && r <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function fmtDateVerbose(d) {
  if (!d) return '';
  return MONTH_NAMES[d.getMonth()] + ' ' + d.getDate() + ordinalSuffix(d.getDate());
}

function fmtDateVerboseWithYear(d) {
  if (!d) return '';
  return MONTH_NAMES[d.getMonth()] + ' ' + d.getDate() + ordinalSuffix(d.getDate()) + ', ' + d.getFullYear();
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

// Hide editor placeholder values while asynchronous booking/pricing data loads.
// Using hide() rather than collapse() preserves the finished page layout.
const INITIAL_SUMMARY_VALUE_IDS = [
  'checkInDisplay', 'checkOutDisplay', 'accommodationNamesText',
  'packageName', 'packageLarge', 'packageSummary', 'packageCost',
  'promoAmount', 'promoDiscountText', 'promoDescription',
  'packageTotal', 'packageTotal2', 'packageTotal3',
  'packageSubtotal', 'packageSubTotal', 'subtotalNetText', 'additionalFee2',
  'propertyFeeText', 'propertyFee2', 'totalVatText', 'totalVat2',
  'vatAccommodationText', 'vatAdventureText', 'vatAcc', 'vatSer',
  'grandTotal', 'grandTotal1', 'grandTotalText',
  'totalNightsDisplay', 'totalGuests', 'summaryRoomsRepeater'
];

function hideInitialSummaryValues() {
  INITIAL_SUMMARY_VALUE_IDS.forEach(function (id) {
    try {
      const el = $w('#' + id);
      if (typeof el.hide === 'function') el.hide();
    } catch (e) {}
  });
}

function safeText(id, txt) {
  // Assign first so Wix never paints the Editor placeholder before the real value.
  try { $w('#' + id).text = txt; } catch (e) {}
  try { const el = $w('#' + id); if (typeof el.expand === 'function') el.expand(); } catch (e) {}
  try { const el = $w('#' + id); if (typeof el.show   === 'function') el.show(); } catch (e) {}
}
function safeCollapse(id) {
  try { const el = $w('#' + id); if (typeof el.collapse === 'function') el.collapse(); } catch (e) {}
  try { const el = $w('#' + id); if (typeof el.hide    === 'function') el.hide(); } catch (e) {}
}
function safeExpand(id) {
  try { const el = $w('#' + id); if (typeof el.expand === 'function') el.expand(); } catch (e) {}
  try { const el = $w('#' + id); if (typeof el.show   === 'function') el.show(); } catch (e) {}
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
    if (action === 'text' || action === 'options' || action === 'value') {
      if (typeof el.expand === 'function') el.expand();
      if (typeof el.show === 'function') el.show();
    }
    return el;
  } catch (e) { return null; }
}

let _summaryRooms = [];
let _summaryNights = 7;
let _summaryCis = '';
let _summaryCos = '';
let _summarySettings = {};
let _roomRepReady = false;
let _renderCount = 0;
let _roomNames = {};
let _promoRevision = 0;
let _promoPending = false;
let _promoCheckingCode = '';
let _promoDiscount = 0;   // e.g. 0.15
let _promoCodeApplied = ''; // e.g. 'SAVE15'
let _selectedPackageId = '';
let _selectedPackageBaseRate = 0;
let _selectedPackagePriceModifier = 1;
let _selectedPackageStayTotal = 0;
let _hasSelectedPackageStayTotal = false;
let _selectedPackageTitle = '';
let _pricingQuoteToken = '';

$w.onReady(function () {
  hideInitialSummaryValues();
  initTracking($w);
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
      rcParam = localStorage.getItem('_wbe_rc');
      cis = cis || localStorage.getItem('_wbe_ci');
      cos = cos || localStorage.getItem('_wbe_co');
    } catch (e) {}
  }

  if (!rcParam && isPreviewMode()) {
    rcParam = 'adventure_suite:2:2:0,two_bedroom_apartment:3:4:0';
    cis = '2026-06-07';
    cos = '2026-06-12';
  }

  // Restore selected package from URL or localStorage.
  let pkgParam = getParam('pkg');
  let quoteParam = getParam('quote');
  if (!pkgParam) {
    try { pkgParam = localStorage.getItem('_wbe_pkg'); } catch (e) {}
  }
  if (!quoteParam) {
    try { quoteParam = localStorage.getItem('_wbe_quote'); } catch (e) {}
  }
  _pricingQuoteToken = quoteParam || '';

  const ciDate = parseDateStr(cis), coDate = parseDateStr(cos);
  const oneDay = 86400000;
  const nights = ciDate && coDate ? Math.round((coDate - ciDate) / oneDay) : 7;

  // parseDateStr's date-only representation is UTC noon; recover its UTC
  // calendar components before creating browser-local display Dates.
  _summaryCis = ciDate ? new Date(ciDate.getUTCFullYear(), ciDate.getUTCMonth(), ciDate.getUTCDate()) : null;
  _summaryCos = coDate ? new Date(coDate.getUTCFullYear(), coDate.getUTCMonth(), coDate.getUTCDate()) : null;

  safeText('checkInDisplay', fmtDate(_summaryCis) || '-');
  safeText('checkOutDisplay', fmtDate(_summaryCos) || '-');

  const rooms = [];
  if (rcParam) {
    const parts = rcParam.split(',');
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i].split(':');
      const occMap = {
        adventure_suite: { occupancy: 2, baseOccupancy: 2 },
        penthouse_apartment: { occupancy: 2, baseOccupancy: 2 },
        two_bedroom_apartment: { occupancy: 4, baseOccupancy: 3 },
      };
      const occ = occMap[(s[0] || '').trim()] || { occupancy: 2, baseOccupancy: 2 };
      if (s.length >= 4) rooms.push({ roomCode: s[0], qty: parseInt(s[1], 10) || 1, numGuests: parseInt(s[2], 10) || 1, roomFee: parseFloat(s[3]) || 0, occupancy: occ.occupancy, baseOccupancy: occ.baseOccupancy });
      else if (s.length === 3) rooms.push({ roomCode: s[0], qty: parseInt(s[1], 10) || 1, numGuests: parseInt(s[2], 10) || 1, roomFee: 0, occupancy: occ.occupancy, baseOccupancy: occ.baseOccupancy });
      else if (s.length === 2) rooms.push({ roomCode: s[0], qty: parseInt(s[1], 10) || 1, numGuests: 1, roomFee: 0, occupancy: occ.occupancy, baseOccupancy: occ.baseOccupancy });
      else if (parts[i]) rooms.push({ roomCode: parts[i], qty: 1, numGuests: 1, roomFee: 0, occupancy: occ.occupancy, baseOccupancy: occ.baseOccupancy });
    }
  }

  let settings = {};
  let roomNames = {};
  try { settings = await getAllSettings(); } catch (e) {}
  try { roomNames = await getRoomNames(); } catch (e) {}

  const feeMap = await fetchRoomFees(rooms.map(r => r.roomCode));
  for (let i = 0; i < rooms.length; i++) {
    const rc = rooms[i].roomCode;
    // roomFee is authoritative from Rooms and applies only to the Penthouse.
    rooms[i].roomFee = rc === 'penthouse_apartment' ? (Number(feeMap[rc]) || 0) : 0;
  }
  console.log('[WBE] roomFee map from Rooms collection:', feeMap);

  _summaryRooms = rooms;
  _summaryNights = nights;
  _summarySettings = settings;
  _roomNames = roomNames;

  // Resolve selected package for this stay length.
  _selectedPackageBaseRate = 0;
  _selectedPackagePriceModifier = 1;
  _selectedPackageStayTotal = 0;
  _hasSelectedPackageStayTotal = false;
  _selectedPackageTitle = '';
  _selectedPackageId = pkgParam || '';
  if (nights > 0) {
    try {
      const packages = await getPackagesByNights(nights);
      if (!packages || !packages.length) {
        throw new Error('No package is available for this stay length. Please return to the booking search.');
      }
      {
        let pkg = packages[0];
        if (_selectedPackageId) {
          const matched = packages.find(function (p) { return p._id === _selectedPackageId; });
          if (!matched) {
            throw new Error('The selected package is no longer available. Please return to the booking search and select a package again.');
          }
          pkg = matched;
        }
        _selectedPackageBaseRate = pkg.baseRate || 0;
        _selectedPackagePriceModifier = Number(pkg.priceModifier) > 0 ? Number(pkg.priceModifier) : 1;
        _selectedPackageTitle = pkg.title || '';
        _selectedPackageId = pkg._id || '';
        if (!_pricingQuoteToken) {
          throw new Error('The locked pricing quote is missing. Please return to the booking search.');
        }
        const quote = await readPricingQuote(
          _pricingQuoteToken,
          _selectedPackageId,
          dateToStr(_summaryCis),
          dateToStr(_summaryCos)
        );
        _selectedPackageTitle = quote.packageTitle || _selectedPackageTitle;
        _selectedPackageBaseRate = Number(quote.baseRate) || 0;
        _selectedPackagePriceModifier = Number(quote.priceModifier) > 0 ? Number(quote.priceModifier) : 1;
        _selectedPackageStayTotal = Number(quote.totalPerPerson) || 0;
        _hasSelectedPackageStayTotal = Number.isFinite(Number(quote.totalPerPerson));
      }
    } catch (e) {
      console.log('[WBE-SUMMARY] package resolution error:', e && e.message || e);
      safeText('bookingStatus', e && e.message ? e.message : 'Unable to load the selected package.');
      throw e;
    }
  }

  const suspend = String(settings.suspendGoogleAds).trim() === '1' || Number(settings.suspendGoogleAds) === 1;
  if (typeof setSuspendGoogleAds === 'function') {
    setSuspendGoogleAds(suspend);
  } else {
    console.log('[WBE-SUMMARY] setSuspendGoogleAds import not ready, suspend defaults to false');
  }

  initRoomRepeater();
  safeCollapse('promoAmount');
  safeCollapse('promoDiscountRow');
  safeCollapse('promoDescription');
  await renderSummary();
  wireContinueButton();
  wirePromoCode();
}

async function wirePromoCode() {
  const promoInput = (function () { try { return $w('#promoCode'); } catch (e) { return null; } })();
  const promoBtn = (function () { try { return $w('#btnApplyPromo'); } catch (e) { return null; } })();

  console.log('[WBE-PROMO] wirePromoCode found input:', !!promoInput, 'button:', !!promoBtn);
  if (!promoInput) return;

  async function applyPromoCode(source) {
    source = source || 'unknown';
    const code = (promoInput.value || '').trim();
    if (_bookingLocked || (_promoPending && _promoCheckingCode === code)) return;
    const revision = ++_promoRevision;
    _promoCheckingCode = code;
    _promoPending = !!code;
    invalidateBookingOffer();
    console.log('[WBE-PROMO] applyPromoCode triggered by', source, 'code=', code);
    if (!code) {
      _promoDiscount = 0;
      _promoCodeApplied = '';
      safeText('promoStatus', '');
      safeText('bookingStatus', '');
      await renderSummary();
      return;
    }

    try {
      safeText('promoStatus', 'Checking...');

      // Guest nights are simply the length of the reservation.
      const totalGuestNights = _summaryNights || 0;
      const result = await validatePromoCode(
        code,
        totalGuestNights,
        dateToStr(_summaryCis),
        dateToStr(_summaryCos)
      );
      if (_bookingLocked || revision !== _promoRevision || code !== (promoInput.value || '').trim()) return;
      _promoPending = false;
      console.log('[WBE-PROMO] validatePromoCode result:', JSON.stringify(result));
      if (result && result.valid) {
        _promoDiscount = parseFloat(result.discount) || 0;
        _promoCodeApplied = code;
        safeText('bookingStatus', '');
        safeText('promoStatus', code + ' applied! Discount: ' + ((_promoDiscount * 100).toFixed(0)) + '% off');

        // Fetch description from PromoCodes if backend didn't return it.
        let promoDesc = result.description || '';
        if (!promoDesc) {
          try {
            const promoRes = await wixData.query('PromoCodes')
              .eq('title', code)
              .limit(1)
              .find();
            if (promoRes.items.length > 0) {
              const item = promoRes.items[0];
              promoDesc = item.description || item.Description || item.desc || item.Desc || item.description_fld || '';
            }
          } catch (promoErr) {
            console.log('[WBE-PROMO-CLIENT] live lookup error:', promoErr.message);
          }
        }

        if (_bookingLocked || revision !== _promoRevision || code !== (promoInput.value || '').trim()) return;
        if (promoDesc) {
          safeText('promoDescription', promoDesc);
          safeExpand('promoDescription');
          try { $w('#promoDescription').show(); } catch (e) {}
        } else {
          safeText('promoDescription', '');
          safeCollapse('promoDescription');
          try { $w('#promoDescription').hide(); } catch (e) {}
        }
      } else {
        _promoDiscount = 0;
        _promoCodeApplied = '';
        safeText('promoDescription', '');
        safeCollapse('promoDescription');
        const reason = (result && result.reason) || '';
        if (reason === 'Promo code not found.') {
          safeText('promoStatus', '');
          safeText('bookingStatus', 'Promo code is not valid');
        } else {
          safeText('promoStatus', '');
          safeText('bookingStatus', reason || 'Promo code is not valid');
        }
      }
    } catch (e) {
      if (_bookingLocked || revision !== _promoRevision) return;
      _promoPending = false;
      console.error('[WBE-PROMO] validatePromoCode error:', e.message);
      _promoDiscount = 0;
      _promoCodeApplied = '';
      safeText('promoStatus', 'Error: ' + e.message);
    }
    console.log('[WBE-PROMO] calling renderSummary with discount:', _promoDiscount);
    await renderSummary();
  }

  if (promoBtn && typeof promoBtn.onClick === 'function') {
    promoBtn.onClick(function () { return applyPromoCode('click'); });
  }

  // Try multiple event APIs; Wix sometimes exposes onKeyPress, onKeyDown, or keyPress
  const bindKey = function (eventName, eventSourceName) {
    const fn = promoInput[eventName];
    if (typeof fn === 'function') {
      fn.call(promoInput, function (event) {
        console.log('[WBE-PROMO]', eventSourceName, 'fired key=', event && event.key, 'keyCode=', event && event.keyCode);
        if (event && (event.key === 'Enter' || event.keyCode === 13 || event.which === 13)) {
          event && event.preventDefault && event.preventDefault();
          applyPromoCode(eventSourceName);
        }
      });
      console.log('[WBE-PROMO] bound', eventSourceName);
    }
  };
  if (typeof promoInput.onKeyPress === 'function') bindKey('onKeyPress', 'onKeyPress');
  else bindKey('onKeyDown', 'onKeyDown');

  if (typeof promoInput.onBlur === 'function') {
    promoInput.onBlur(function () {
      const current = (promoInput.value || '').trim();
      console.log('[WBE-PROMO] onBlur current=', current, 'applied=', _promoCodeApplied);
      if (current && current !== _promoCodeApplied) {
        applyPromoCode('blur');
      }
    });
  }

  if (typeof promoInput.onInput === 'function') {
    promoInput.onInput(function () {
      if (_bookingLocked) return;
      _promoRevision++;
      _promoPending = false;
      invalidateBookingOffer();
      console.log('[WBE-PROMO] onInput value=', (promoInput.value || '').trim());
    });
  }
}

async function renderSummary() {
  if (_bookingLocked) return;
  invalidateBookingOffer();
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
    safeText('totalVat2', '$' + fmtCurrency(0));
    safeText('propertyFeeText', '$' + fmtCurrency(0));
    safeText('propertyFee2', '$' + fmtCurrency(0));
    safeText('grandTotalText', '$' + fmtCurrency(0));
    return;
  }

  const settings = _summarySettings;
  const propertyFeeRate = parseFloat(settings.propertyFeeRate) || 0.05;
  const accommodationShare = 0.5;
  const taxRateAccommodation = parseFloat(settings.taxRate_accommodation) || 0.10;
  const taxRateAdventure = parseFloat(settings.taxRate_standard) || 0.15;

  const names = [], repData = [];
  let subtotalNet = 0, propertyFee = 0;
  let totalGuests = 0;

  const packageBaseRate = _selectedPackageBaseRate || await getPackageBaseRate(nights);
  const fallbackModifier = Number(_selectedPackagePriceModifier) > 0 ? Number(_selectedPackagePriceModifier) : 1;
  const packageCost = _hasSelectedPackageStayTotal
    ? _selectedPackageStayTotal
    : Math.round(packageBaseRate * fallbackModifier * nights * 100) / 100;
  const effectiveAverageNightlyRate = nights > 0 ? Math.round((packageCost / nights) * 100) / 100 : 0;
  safeText('packageCost', '$' + fmtCurrency(packageCost));

  let totalRoomFee = 0;
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    const roomMeta = _roomNames[r.roomCode]; const displayName = roomMeta && roomMeta.name ? roomMeta.name : (typeof roomMeta === 'string' && roomMeta !== r.roomCode ? roomMeta : getRoomDisplayName(r.roomCode));
    names.push(displayName + ' x' + r.qty);
    const rate = effectiveAverageNightlyRate;
    const numGuests = Math.max(1, parseInt(r.numGuests, 10) || 1);
    const lineGuests = numGuests * r.qty;
    totalGuests += lineGuests;
    let roomFee = r.roomCode === 'penthouse_apartment' ? (Number(r.roomFee) || 0) : 0;
    if (r.roomCode === 'penthouse_apartment' && !roomFee && roomMeta && typeof roomMeta === 'object' && (roomMeta.roomFee || 0) > 0) {
      roomFee = Number(roomMeta.roomFee);
    }
    const additionalFee = roomFee > 0 ? Math.round(roomFee * nights * r.qty * 100) / 100 : 0;
    totalRoomFee += additionalFee;
    const roomTotal = packageCost * numGuests * r.qty + additionalFee;
    r.roomFee = roomFee;
    subtotalNet += roomTotal;
    propertyFee += roomTotal * propertyFeeRate;

    const accNet = roomTotal * accommodationShare;
    const advNet = roomTotal * (1 - accommodationShare);
    r.roomTotal = roomTotal;
    r.accomodationVat = accNet * taxRateAccommodation;
    r.packageVat = advNet * taxRateAdventure;
    r.propertyFee = roomTotal * propertyFeeRate;

    repData.push({
      _id: 'sum_' + i + '_' + _renderCount, groupIndex:i,
      roomCode: r.roomCode, roomName: displayName, qty: r.qty, guests: numGuests,
      baseRate: rate, roomTotal: roomTotal, additionalFee: additionalFee,
      occupancy: r.occupancy || 2, baseOccupancy: r.baseOccupancy || 2,
    });
  }

  safeText('totalGuests', String(totalGuests));
  const ciDateForSummary = parseDateStr(_summaryCis) || parseDateStr(safeTextRead('checkInDisplay'));
  const coDateForSummary = parseDateStr(_summaryCos) || parseDateStr(safeTextRead('checkOutDisplay'));
  const summaryNights = nights > 0 ? nights : _summaryNights;
  const summaryGuests = totalGuests || 0;
  const guestWord = summaryGuests === 1 ? 'guest' : 'guests';
  const nightWord = summaryNights === 1 ? 'night' : 'nights';
  let packageSummaryText = '';
  if (ciDateForSummary && coDateForSummary) {
    packageSummaryText = fmtDateVerboseWithYear(ciDateForSummary) + ' to ' + fmtDateVerboseWithYear(coDateForSummary) +
                         ' * ' + summaryNights + ' ' + nightWord +
                         ' * ' + summaryGuests + ' ' + guestWord;
  } else {
    packageSummaryText = summaryNights + ' ' + nightWord + ' * ' + summaryGuests + ' ' + guestWord;
  }
  safeText('packageSummary', packageSummaryText);

  const packageTotal = Math.round(packageCost * totalGuests * 100) / 100;
  safeText('packageTotal', '$' + fmtCurrency(packageTotal));
  safeText('packageTotal2', '$' + fmtCurrency(packageTotal));
  safeText('packageTotal3', '$' + fmtCurrency(packageTotal));

  const accNet = subtotalNet * accommodationShare;
  const advNet = subtotalNet * (1 - accommodationShare);
  const vatAccommodation = accNet * taxRateAccommodation;
  const vatAdventure = advNet * taxRateAdventure;
  const totalVat = vatAccommodation + vatAdventure;
  const grandTotal = subtotalNet + propertyFee + totalVat;

  // A valid promo discounts the entire pre-tax booking, including Penthouse
  // roomFee, before VAT and property fee are calculated.
  const totalRoomFeeForDisplay = Math.round((subtotalNet - packageTotal) * 100) / 100;
  const preDiscountSubtotal = Math.round((packageTotal + totalRoomFeeForDisplay) * 100) / 100;
  const promoAmount = _promoDiscount > 0 ? -Math.round(preDiscountSubtotal * _promoDiscount * 100) / 100 : 0;
  const packageSubtotalValue = Math.round((preDiscountSubtotal + promoAmount) * 100) / 100;
  const discountedSubtotal = packageSubtotalValue;
  const discountedAccNet = discountedSubtotal * accommodationShare;
  const discountedAdvNet = discountedSubtotal * (1 - accommodationShare);
  const discountedVatAccommodation = discountedAccNet * taxRateAccommodation;
  const discountedVatAdventure = discountedAdvNet * taxRateAdventure;
  const discountedTotalVat = Math.round((discountedVatAccommodation + discountedVatAdventure) * 100) / 100;
  const discountedPropertyFee = Math.round(discountedSubtotal * propertyFeeRate * 100) / 100;
  const discountedGrandTotal = Math.round((packageSubtotalValue + discountedPropertyFee + discountedTotalVat) * 100) / 100;

  safeText('accommodationNamesText', names.join(', '));
  safeText('packageSubtotal', '$' + fmtCurrency(packageSubtotalValue));
  safeText('packageSubTotal', '$' + fmtCurrency(packageSubtotalValue));
  safeText('subtotalNetText', '$' + fmtCurrency(discountedSubtotal));
  safeText('additionalFee2', '$' + fmtCurrency(totalRoomFeeForDisplay));

  // Promo display — box11 must be expanded so child text elements can render.
  safeExpand('box11');
  if (_promoDiscount > 0 && _promoCodeApplied) {
    const promoAmtTxt = '($' + fmtCurrency(Math.abs(promoAmount)) + ')';
    const promoRowTxt = 'Promo Code (' + _promoCodeApplied + '): ' + fmtCurrency(promoAmount) + ' (-' + (_promoDiscount * 100).toFixed(0) + '%)';
    console.log('[WBE-PROMO] rendering visible:', promoAmtTxt, promoRowTxt);

    safeExpand('promoDiscountRow');
    safeText('promoAmount', promoAmtTxt);
    safeText('promoDiscountText', promoRowTxt);
    // Text elements don't support collapse/expand; force show/hide explicitly.
    try { $w('#promoAmount').show(); } catch (e) { console.warn('[WBE-PROMO] show promoAmount failed:', e.message); }
    try { $w('#promoDiscountText').show(); } catch (e) { console.warn('[WBE-PROMO] show promoDiscountText failed:', e.message); }
  } else {
    console.log('[WBE-PROMO] hiding row; discount=', _promoDiscount, 'code=', _promoCodeApplied);
    safeCollapse('promoDiscountRow');
    safeText('promoAmount', '');
    safeText('promoDiscountText', '');
    try { $w('#promoAmount').hide(); } catch (e) {}
    try { $w('#promoDiscountText').hide(); } catch (e) {}
    safeCollapse('promoAmount');
  }

  safeText('vatAccommodationText', '$' + fmtCurrency(discountedVatAccommodation));
  safeText('vatAdventureText', '$' + fmtCurrency(discountedVatAdventure));
  safeText('vatAcc', '$' + fmtCurrency(discountedAccNet));
  safeText('vatSer', '$' + fmtCurrency(discountedAdvNet));
  safeText('totalVatText', '$' + fmtCurrency(discountedTotalVat));
  safeText('totalVat2', '$' + fmtCurrency(discountedTotalVat));
  safeText('propertyFeeText', '$' + fmtCurrency(discountedPropertyFee));
  safeText('propertyFee2', '$' + fmtCurrency(discountedPropertyFee));
  safeExpand('box8');

  // Ensure invoice summary value elements are visible so values render.
  const valueIds = ['packageCost', 'packageTotal', 'packageTotal2', 'packageTotal3',
    'packageSubtotal', 'packageSubTotal', 'subtotalNetText', 'additionalFee2',
    'propertyFeeText', 'propertyFee2', 'totalVatText', 'totalVat2',
    'vatAccommodationText', 'vatAdventureText', 'vatAcc', 'vatSer',
    'totalNightsDisplay', 'totalGuests'];
  valueIds.forEach(function (id) { safeExpand(id); });
  const grandTotalTxt = '$' + fmtCurrency(discountedGrandTotal);
  // TOTAL DUE element — user confirms the variable/ID is #grandTotal.
  // We also write to #grandTotal1 and #grandTotalText as defensive fallbacks.
  ['grandTotal', 'grandTotal1', 'grandTotalText'].forEach(function (gtId) {
    safeText(gtId, grandTotalTxt);
  });
  console.log('[WBE-SUMMARY] grandTotal set to:', grandTotalTxt);

  // Update totalNightsDisplay with calculated nights
  if (nights > 0) {
    safeText('totalNightsDisplay', String(nights) + ' night' + (nights !== 1 ? 's' : ''));
  }

  // packageName: prefer the user-selected package title; fall back to lookup by nights.
  let pkgTitle = _selectedPackageTitle || '';
  try {
    if (!pkgTitle) {
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
    }

    // Single debug log to diagnose the exact state
    console.log('[WBE] _selectedPackageTitle=' + _selectedPackageTitle + ' pkgTitle=' + pkgTitle + ' summaryNights=' + _summaryNights);

    if (pkgTitle) {
      safeExpand('box1');
      safeText('packageName', pkgTitle);
      safeText('packageLarge', pkgTitle);
      console.log('[WBE] SET packageName/packageLarge to:', pkgTitle);
    } else {
      safeCollapse('packageName');
      safeCollapse('packageLarge');
      console.log('[WBE] COLLAPSED packageName/packageLarge, no title found');
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

    const guestCount = itemData.guests || itemData.numGuests || 1;
    const guestEl = safeItem($item, '#numberOfGuests', null, null);
    if (guestEl) {
      try { guestEl.text = String(guestCount); } catch (e) {}
      try { guestEl.value = String(guestCount); } catch (e) {}
      try { if (typeof guestEl.expand === 'function') guestEl.expand(); } catch (e) {}
      try { if (typeof guestEl.show === 'function') guestEl.show(); } catch (e) {}
      console.log('[WBE-SUMMARY] set #numberOfGuests:', guestCount, 'for', itemData.roomCode);
    } else {
      console.warn('[WBE-SUMMARY] #numberOfGuests element not found for', itemData.roomCode);
    }

    safeItem($item, '#roomPriceText', 'text', '$' + fmtCurrency(itemData.baseRate || 0) + ' / person / night');
    const feeText = (itemData.additionalFee || 0) > 0 ? '$' + fmtCurrency(itemData.additionalFee) : '';
    const feeEl = safeItem($item, '#additionalFee', null, null);
    if (feeEl) {
      try {
        if (typeof feeEl.text === 'string' || typeof feeEl.text === 'function') feeEl.text = feeText;
        else if (typeof feeEl.label === 'string' || typeof feeEl.label === 'function') feeEl.label = feeText;
        else if (typeof feeEl.value === 'string' || typeof feeEl.value === 'function') feeEl.value = feeText;
      } catch (e) {}
      try {
        if (feeText && typeof feeEl.expand === 'function') feeEl.expand();
        if (feeText && typeof feeEl.show === 'function') feeEl.show();
        if (!feeText && typeof feeEl.hide === 'function') feeEl.hide();
      } catch (e) {}
    }

    safeItem($item, '#roomTotalText', 'text', '$' + fmtCurrency(itemData.roomTotal || 0));
    const rmBtn = safeItem($item, '#removeBtn', null, null);
    if (rmBtn && typeof rmBtn.onClick === 'function') {
      if (_bookingLocked && typeof rmBtn.disable === 'function') rmBtn.disable();
      rmBtn.onClick(() => {
        if (_bookingLocked || !rep.data.some(row => row._id === itemData._id)) return;
        _summaryRooms = _summaryRooms.filter((r,index) => index !== itemData.groupIndex);
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

// One existing button owns prepare -> explicit confirm -> bounded status refresh.
// No timer, redirect, invoice or advertising completion side effect is authorized here.
let _bookingController = null;
let _bookingConfirm = null;
let _bookingRefresh = null;
let _bookingPhase = 'STALE';
let _bookingSnapshot = '';
let _bookingLocked = false;
let _bookingAcceptanceObserved = false;
let _bookingBusy = false;
let _bookingDisplay = null;

function bookingSnapshot() {
  const att = getStoredClickIds() || {};
  return {
    v: 1, checkIn: dateToStr(_summaryCis), checkOut: dateToStr(_summaryCos),
    packageId: _selectedPackageId, pricingQuoteToken: _pricingQuoteToken,
    promoCode: _promoCodeApplied,
    guestName: safeVal('inputGuestName').trim(), guestEmail: safeVal('inputGuestEmail').trim(),
    guestPhone: normalizePhone(safeVal('inputGuestPhone')),
    dialingCode: safeVal('inputDialingCode').replace(/\D/g, '') || '1',
    note: safeVal('bookingNotes'), marketSource: safeVal('marketSource').trim(),
    gclid: att.gclid || '', gbraid: att.gbraid || '', wbraid: att.wbraid || '', msclkid: att.msclkid || '',
    summaryRooms: _summaryRooms.map(r => ({roomCode:r.roomCode,qty:r.qty,numGuests:r.numGuests}))
  };
}

function invalidateBookingOffer() {
  if (_bookingLocked) return;
  _bookingSnapshot = '';
  _bookingDisplay = null;
  if (_bookingController) _bookingController.invalidate();
}

function renderAcceptedFinancials(display) {
  // Every authoritative money value comes from the original-group backend calculation.
  const t = display.totals;
  const money = cents => '$' + fmtCurrency(cents / 100);
  ['grandTotal','grandTotal1','grandTotalText'].forEach(id => safeText(id,money(t.grandTotalCents)));
  ['packageSubtotal','packageSubTotal','subtotalNetText'].forEach(id => safeText(id,money(t.roomTotalCents)));
  ['propertyFeeText','propertyFee2'].forEach(id => safeText(id,money(t.propertyFeeCents)));
  ['totalVatText','totalVat2'].forEach(id => safeText(id,money(t.totalVatCents)));
  safeText('vatAccommodationText',money(t.accommodationVatCents));
  safeText('vatAdventureText',money(t.packageVatCents));
  // These existing fields label the accommodation/service taxable halves.
  safeText('vatAcc',money(t.roomTotalCents / 2));
  safeText('vatSer',money(t.roomTotalCents / 2));
  safeText('totalGuests',String(t.totalGuests));
  const hasDiscount = t.discountCents > 0;
  safeText('promoAmount',hasDiscount ? '(' + money(t.discountCents) + ')' : '');
  // The accepted calculation supplies rounded amounts, not a nominal promo rate.
  // Do not reuse the preliminary catalog's percentage or free-form savings claim.
  safeText('promoDiscountText',hasDiscount ? 'Promo Code (' + _promoCodeApplied + '): -' + fmtCurrency(t.discountCents / 100) : '');
  safeText('promoStatus',hasDiscount ? _promoCodeApplied + ' applied to this offer.' : '');
  safeText('promoDescription','');
  safeCollapse('promoDescription');
  try { $w('#promoDescription').hide(); } catch (e) {}
  if (hasDiscount) safeExpand('promoDiscountRow');
  else safeCollapse('promoDiscountRow');
  ['promoAmount','promoDiscountText'].forEach(id => {
    try { if (hasDiscount) $w('#' + id).show(); else $w('#' + id).hide(); } catch (e) {}
  });
  const packageCents = Math.round(_selectedPackageStayTotal * 100) * t.totalGuests;
  ['packageTotal','packageTotal2','packageTotal3'].forEach(id => safeText(id,money(packageCents)));
  safeText('additionalFee2',money(t.grossCents - packageCents));
  // Preserve original groups, including duplicate room classes; never merge price groups.
  renderRoomRepeater(display.groups.map((g,index) => ({
    _id:'offer_' + index + '_' + _renderCount, groupIndex:index, roomCode:g.roomCode,
    roomName:getRoomDisplayName(g.roomCode), qty:g.quantity, guests:g.guests,
    baseRate:_summaryNights > 0 ? _selectedPackageStayTotal / _summaryNights : 0,
    roomTotal:g.roomTotalCents / 100,
    additionalFee:(g.grossCents - Math.round(_selectedPackageStayTotal * 100) * g.guests * g.quantity) / 100
  })));
}

function renderBookingState(state) {
  _bookingPhase = state.status;
  if (state.status === 'ACCEPTED_PENDING' || state.status === 'CONFIRMED') _bookingAcceptanceObserved = true;
  const btn = $w('#btnContinue');
  const messages = {
    STALE:'Booking details changed. Review a new offer before confirming.',
    PREPARING:'Preparing your booking offer...',
    OFFER:'Review the total above, then select Confirm booking to accept this offer.',
    ACCEPTED_PENDING:'Your booking is accepted and still being saved. Check booking status; do not start another booking.',
    UNKNOWN:_bookingLocked ? 'Booking status is unknown. Check this same booking again; do not start another booking.' : 'Unable to prepare an offer. Review your details and try again.',
    DENIED:_bookingLocked ? 'This booking credential is unavailable or expired. Confirmation cannot be shown here; do not submit a new booking to retry.' : 'This offer is unavailable or expired. Review a new offer before confirming.'
  };
  if (state.status === 'OFFER') {
    _bookingDisplay = state.display;
    renderAcceptedFinancials(state.display);
    safeText('packageName',state.packageTitle);
    safeText('packageLarge',state.packageTitle);
  }
  safeText('bookingStatus',state.status === 'CONFIRMED' ? 'Booking confirmed! Booking number: ' + state.bookingNumber : (messages[state.status] || 'Booking status is unknown.'));
  btn.label = state.status === 'OFFER' ? 'Confirm booking' : (_bookingLocked ? 'Check booking status' : 'Review booking');
  safeDisable('btnContinue',_bookingBusy || state.status === 'PREPARING' || state.status === 'CONFIRMED' || (_bookingLocked && state.status === 'DENIED'));
}

function wireContinueButton() {
  if (_bookingController) return;
  const btn = $w('#btnContinue');
  if (!btn || typeof btn.onClick !== 'function') return;
  if (typeof btn.link === 'string') btn.link = '';
  if (typeof btn.target === 'string') btn.target = '';
  if (typeof btn.action === 'function') { try { btn.action = null; } catch (e) {} }
  _bookingController = mountBookConfirmSearch({
    onConfirm:fn => { _bookingConfirm = fn; }, onRefresh:fn => { _bookingRefresh = fn; }, render:renderBookingState
  });
  const inputIds = ['inputGuestName','inputGuestEmail','inputGuestPhone','inputDialingCode','bookingNotes','marketSource','promoCode'];
  inputIds.forEach(id => {
    try { const el = $w('#' + id); if (typeof el.onInput === 'function') el.onInput(invalidateBookingOffer); if (typeof el.onChange === 'function') el.onChange(invalidateBookingOffer); } catch (e) {}
  });
  btn.label = 'Review booking';
  btn.onClick(async function () {
    if (_bookingBusy || _bookingPhase === 'CONFIRMED' || (_bookingLocked && _bookingPhase === 'DENIED')) return;
    if (!_bookingLocked) {
      if (_promoPending || safeVal('promoCode').trim() !== _promoCodeApplied) {
        invalidateBookingOffer();
        safeText('bookingStatus','Apply or clear the promo code before reviewing your booking.'); return;
      }
      const snapshot = bookingSnapshot();
      if (!snapshot.guestName || !snapshot.guestEmail || !snapshot.guestPhone) {
        invalidateBookingOffer();
        safeText('bookingStatus','Please enter the required information to complete your booking'); return;
      }
      if (snapshot.guestEmail.indexOf('@') < 0) { invalidateBookingOffer(); safeText('bookingStatus','Please enter a valid email address.'); return; }
      if (_bookingPhase !== 'OFFER' || _bookingSnapshot !== JSON.stringify(snapshot)) {
        _bookingBusy = true;
        _bookingSnapshot = JSON.stringify(snapshot);
        try { await _bookingController.prepare(snapshot); }
        finally { _bookingBusy = false; safeDisable('btnContinue',false); }
        return; // A replacement is never accepted by the click that prepared it.
      }
      _bookingLocked = true; // An uncertain acceptance must retain this exact operation.
      inputIds.concat(['btnApplyPromo']).forEach(id => safeDisable(id,true));
      if (_bookingDisplay) renderAcceptedFinancials(_bookingDisplay);
    }
    _bookingBusy = true;
    safeDisable('btnContinue',true);
    try {
      if (!_bookingAcceptanceObserved) await _bookingConfirm();
      else await _bookingRefresh();
    } finally {
      _bookingBusy = false;
      safeDisable('btnContinue',_bookingPhase === 'CONFIRMED' || _bookingPhase === 'DENIED');
    }
  });
}

function normalizePhone(raw) {
  if (!raw) { return ''; }
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) { return digits; }
  if (digits.length === 11 && digits.charAt(0) === '1') { return '+' + digits; }
  if (digits.length === 10) { return '+1' + digits; }
  return digits;
}