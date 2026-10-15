import { getActiveMessages } from 'backend/messages';
import { searchAvailability, suggestAlternateDates } from 'backend/search';
import { getPackagesByNights, packageExistsForNights } from 'backend/packages';
import { createPricingQuote } from 'backend/pricingQuotes';
import { getRoomNames } from 'backend/rooms';
import { trackBeginBooking, captureClickIds, trackViewBookingSearch, trackRoomView, trackSearchNoResults, initTracking, setSuspendGoogleAds } from 'public/tracking';
import { getAllSettings } from 'backend/settings';
import wixLocation from 'wix-location';
import wixWindow from 'wix-window-frontend';

let _selections = [];
let _selectionInputsValid = true;
let _selectionRoomCount = 0;
let _roomFeeMap = {};
let _summaryNights = 0;
let _cachedPerPersonStayTotal = 0;
let _hasCachedStayPricing = false;
let _availablePackages = [];
let _selectedPackage = null;
let _searchCheckIn = null;
let _searchCheckOut = null;
let _searchGeneration = 0;
let _activeSearch = null;
let _summaryNavigating = false;
let _packageRepeaterReady = false;
const _packageRowBindings = new Map();
const _roomRowBindings = new WeakMap();
const _activeRoomBindings = new Map();

function isCurrentSearch(search) {
  return !!search && search === _activeSearch && search.generation === _searchGeneration &&
    pickerDay(tryFind('datePickerCheckIn').value) === search.checkIn &&
    pickerDay(tryFind('datePickerCheckOut').value) === search.checkOut;
}
function invalidateSearch() {
  _searchGeneration++;
  _activeSearch = null;
  _packageRowBindings.clear();
  _activeRoomBindings.clear();
  _selectedPackage = null;
  _availablePackages = [];
  _cachedPerPersonStayTotal = 0;
  _hasCachedStayPricing = false;
  _searchCheckIn = null;
  _searchCheckOut = null;
  _summaryNavigating = false;
  clearSelections();
  ['searchResultsRepeater', 'packageRepeater'].forEach(id => {
    const rep = tryFind(id);
    if (rep) { rep.data = []; hideElement(rep, id); }
  });
  hideSearchHeader();
  hidePackageInfo();
  syncSummaryButtonWithResults(0);
  try { ['_wbe_rc', '_wbe_ci', '_wbe_co', '_wbe_pkg', '_wbe_quote'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
}
function datesChanged() {
  invalidateSearch();
  safeText('');
}

// Picker Dates are civil days in the guest's locale; result ISO strings carry
// the backend's explicit date part. Reject invalid days rather than rolling them.
function resultDay(value) {
  const str = value instanceof Date && !isNaN(value.getTime()) ? value.toISOString() : String(value || '');
  const match = str.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
  if (!match) return '';
  const d = new Date(match[1] + 'T00:00:00.000Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === match[1] ? match[1] : '';
}
function isFullStayResult(item, search) {
  return !!item && !!search && (item.maxQty || 0) > 0 && item.status === 'full' &&
    resultDay(item.availableCheckIn) === search.checkIn &&
    resultDay(item.availableCheckOut) === search.checkOut;
}
function pickerDay(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return resultDay(value);
  const d = parseDate(value);
  if (!d || isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Calendar-day arithmetic is independent of DST offsets and picker times.
function stayNights(checkIn, checkOut) {
  const ci = pickerDay(checkIn), co = pickerDay(checkOut);
  if (!ci || !co || ci >= co) return 0;
  return (Date.parse(co + 'T00:00:00Z') - Date.parse(ci + 'T00:00:00Z')) / 86400000;
}

function clearSelections(silent) {
  _selections = [];
  if (!silent) updateSelectionPanel();
}

function dropdownInteger(raw, options, minimum, maximum) {
  // Native Dropdown values are decimal strings, not parseInt prefixes.
  if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum ||
      !Array.isArray(options) || !options.some(option => option.value === raw)) return null;
  return value;
}

function readRoomSelections() {
  const selections = [];
  let valid = true, rooms = 0;
  for (const binding of _activeRoomBindings.values()) {
    try {
      const row = binding.read && binding.read();
      if (!row) continue; // Removed or obsolete physical row.
      if (!row.valid) valid = false;
      rooms += row.qty || 0;
      if (row.selection) selections.push(row.selection);
    } catch (e) { valid = false; }
  }
  _selections = selections;
  _selectionInputsValid = valid;
  _selectionRoomCount = rooms;
}

function showElement(el, name) {
  if (SELECTION_IDS.includes(name)) return !!el; // Owned by refreshSelectionSummary.
  if (!el) {
    console.log('>>> showElement skipped:', name, 'element not found');
    return false;
  }
  try {
    if (typeof el.show === 'function') { el.show(); }
    if (typeof el.expand === 'function') { el.expand(); }
    console.log('>>> showElement success:', name, 'collapsed:', el.collapsed, 'hidden:', el.hidden, 'visible:', el.visible);
    return true;
  } catch (e) {
    console.log('>>> showElement error:', name, e && e.message || e);
    return false;
  }
}

function hideElement(el, name) {
  if (SELECTION_IDS.includes(name)) return !!el; // Owned by refreshSelectionSummary.
  if (!el) return false;
  try {
    if (typeof el.hide === 'function') { el.hide(); }
    if (typeof el.collapse === 'function') { el.collapse(); }
    console.log('>>> hideElement success:', name);
    return true;
  } catch (e) {
    console.log('>>> hideElement error:', name, e && e.message || e);
    return false;
  }
}

function hasSearchResultRows(resultCount) {
  return Number(resultCount) > 0;
}

function roomSelectionRequiredMessage(selections) {
  return Array.isArray(selections) && selections.length > 0
    ? ''
    : 'Please select one or more rooms to continue booking.';
}

const SELECTION_IDS = ['selection', 'vacationDates', 'nightsDominica', 'roomsSelected',
  'selectedRoomsContainer', 'yourSelection', 'selectedRooms', 'totalGuests', 'priceSummary',
  'packageText', 'subTotalBooking', 'penthouseText', 'penthouseFee', 'totalText', 'finalTotal',
  'selectionbox', 'line102', 'line103', 'line104', 'line106', 'packageTitle', 'packageName3', 'packageAmenities', 'bookingHelp', 'btnSummary'];

// Each visibility axis owns its latest intent. Native completion can occur after
// a newer opposite operation; reconcile that completion, not just its dispatch.
const _summaryControlStates = new WeakMap();
let _summaryRevision = 0;
function setSummaryControl(el, axis, desired) {
  if (!el) return;
  let states = _summaryControlStates.get(el);
  if (!states) { states = {}; _summaryControlStates.set(el, states); }
  let state = states[axis];
  if (!state) state = states[axis] = {
    desired: null, applied: null, revision: 0, failures: 0, failClosed: false
  };
  if (state.desired === desired) return;
  state.desired = desired;
  state.revision++;
  state.failures = 0;
  state.failClosed = false;
  const target = () => state.failClosed || state.desired;
  const apply = () => {
    // Two failed transitions per intent at most. SDK refusal leaves applied
    // unknown, not successfully disabled/hidden. Navigation guards are separate.
    if (state.failures >= 2) return;
    const revision = state.revision, intended = target();
    const method = axis === 'hidden' ? (intended ? 'hide' : 'show')
      : axis === 'collapsed' ? (intended ? 'collapse' : 'expand')
      : (intended ? 'disable' : 'enable');
    const succeeded = () => {
      state.applied = intended;
      if (target() !== intended) apply();
    };
    const failed = () => {
      state.applied = null; // A rejection may follow an applied side effect.
      if (revision === state.revision) {
        state.failures++;
        // Never retry a rejected enable until a new selection intent arrives.
        if (axis === 'disabled' && !intended) state.failClosed = true;
        if (state.failures === 2) {
          try { console.warn('Booking Search summary UI transition failed; state unknown.'); } catch (e) {}
        }
      }
      apply();
    };
    try {
      if (typeof el[method] !== 'function') { failed(); return; }
      const result = el[method]();
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).then(succeeded, failed);
        // Synchronous reentry can finish an old side effect before settlement.
        if (target() !== intended) apply();
      } else succeeded();
    } catch (e) { failed(); }
  };
  apply();
}

function refreshSelectionSummary() {
  const revision = ++_summaryRevision;
  readRoomSelections();
  const ci = tryFind('datePickerCheckIn'), co = tryFind('datePickerCheckOut');
  _summaryNights = stayNights(ci && ci.value, co && co.value);
  const current = isCurrentSearch(_activeSearch);
  const selected = current ? _selections.filter(s => s.qty > 0) : [];
  const rooms = current ? _selectionRoomCount : 0;
  const guests = selected.reduce((sum, s) => sum + s.qty * s.numGuests, 0);
  const values = { nightsDominica: String(_summaryNights) + ' nights in Dominica',
    selectedRooms: String(rooms) + ' rooms', totalGuests: _selectionInputsValid ? String(guests) + ' guests total' : 'Choose valid room and guest quantities' };
  Object.keys(values).forEach(id => { const el = tryFind(id); if (el) el.text = values[id]; });
  ['packageTitle', 'packageName3'].forEach(id => {
    const title = tryFind(id);
    if (title) title.text = _selectedPackage && _selectedPackage.title || '';
  });
  if (!_selectedPackage) {
    const amenities = tryFind('packageAmenities');
    if (amenities) amenities.text = '';
  }
  const priced = current && _selectionInputsValid && !_activeSearch.pending && _hasCachedStayPricing &&
    _selectedPackage && _selectedPackage.pricingQuoteToken;
  if (!rooms || !priced) {
    ['subTotalBooking', 'penthouseFee', 'finalTotal'].forEach(id => {
      const el = tryFind(id); if (el) el.text = '';
    });
  }
  for (const id of SELECTION_IDS) {
    if (revision !== _summaryRevision) return;
    const el = tryFind(id);
    setSummaryControl(el, 'hidden', !rooms);
    if (revision !== _summaryRevision) return;
    setSummaryControl(el, 'collapsed', !rooms);
  }
  if (revision !== _summaryRevision) return;
  setSummaryControl(tryFind('btnSummary'), 'disabled', !(rooms && priced));
}

function syncSummaryButtonWithResults(resultCount) {
  // Result presence is not selection. Navigation keeps its independent guards.
  refreshSelectionSummary();
}

function updateSelectionPanel() {
  readRoomSelections();
  const panel = tryFind('selectionPanel');
  const container = tryFind('selectedRoomsContainer');
  const box3 = tryFind('box3');
  const summaryContainer = tryFind('bookingSummaryContainer');
  const selection = tryFind('selection');
  const transSummary = tryFind('transSummary');
  const jpegBackground = tryFind('jpegBackground');
  console.log('>>> updateSelectionPanel elements:', {
    panel: !!panel,
    container: !!container,
    box3: !!box3,
    summaryContainer: !!summaryContainer,
    selection: !!selection,
    transSummary: !!transSummary,
    jpegBackground: !!jpegBackground,
    selections: _selections.length
  });

  if (_selectionRoomCount === 0) {
    hideElement(panel, 'selectionPanel');
    if (container) { container.text = ''; }
    hideElement(container, 'selectedRoomsContainer');
    hideElement(box3, 'box3');
    hideElement(summaryContainer, 'bookingSummaryContainer');
    hideElement(selection, 'selection');
    hideElement(transSummary, 'transSummary');
    hideElement(jpegBackground, 'jpegBackground');
    refreshSelectionSummary();
    return;
  }

  // Build text first, then expand parent, then show text.
  let total = 0, totalGuests = 0, lines = [];
  for (let i = 0; i < _selections.length; i++) {
    const s = _selections[i];
    const guests = (s.numGuests || 1) * s.qty;
    lines.push((s.roomName || s.roomCode) + ' (Qty: ' + s.qty + ', Guests: ' + guests + ')');
    total += s.qty;
    totalGuests += guests;
  }

  if (container) {
    container.text = lines.join('\n');
    console.log('>>> selectedRoomsContainer text set:', JSON.stringify(container.text));
    console.log('>>> selectedRoomsContainer state:', {
      collapsed: container.collapsed,
      hidden: container.hidden,
      visible: container.visible,
      height: container.height,
      minHeight: container.minHeight,
      fitToContent: typeof container.fitToContent === 'function'
    });
  }

  // Expand parent container(s) first so the text element can actually appear.
  showElement(box3, 'box3');
  showElement(summaryContainer, 'bookingSummaryContainer');
  showElement(selection, 'selection');
  showElement(transSummary, 'transSummary');
  console.log('>>> about to show jpegBackground, element found:', !!jpegBackground, 'src:', jpegBackground && typeof jpegBackground.src);
  try {
    if (jpegBackground && typeof jpegBackground.src === 'string') {
      jpegBackground.src = 'https://static.wixstatic.com/media/wanderlust-booking-engine/summary-background.jpg';
    }
  } catch (e) {
    console.log('>>> jpegBackground src error:', e && e.message || e);
  }
  showElement(jpegBackground, 'jpegBackground');
  showElement(panel, 'selectionPanel');
  showElement(container, 'selectedRoomsContainer');

  // Update total guest count text in booking summary container.
  const numTotalGuestsEl = tryFind('numTotalGuests');
  if (numTotalGuestsEl) {
    numTotalGuestsEl.text = String(totalGuests);
  }

  // Compute total Penthouse Apartment additional fee if selected.
  const hasPenthouseSelected = _selections.some((s) => s.roomCode === 'penthouse_apartment');
  const penthouseFeeEl = tryFind('penthouseFee');
  if (penthouseFeeEl) {
    let penthouseTotal = 0;
    if (hasPenthouseSelected) {
      for (let i = 0; i < _selections.length; i++) {
        const s = _selections[i];
        if (s.roomCode === 'penthouse_apartment') {
          penthouseTotal += (Number(s.roomFee) || 0) * s.qty;
        }
      }
    }
        if (_summaryNights > 0 && hasPenthouseSelected) {
      const totalPenthouseFee = penthouseTotal * _summaryNights;
      penthouseFeeEl.text = '$' + totalPenthouseFee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      penthouseFeeEl.text = '$0.00';
    }
  }

  // Selection visibility is owned solely by refreshSelectionSummary.

  // Calculate and display the seasonal-first, modifier-adjusted per-person stay
  // total for every guest. Penthouse roomFee remains a per-room/night surcharge.
  // Also compute finalTotal = subTotalBooking + penthouseFee.
  let finalTotal = 0;
  if (summaryContainer) {
    if (_selections.length > 0 && _summaryNights > 0 && _hasCachedStayPricing) {
      const subTotal = _cachedPerPersonStayTotal * totalGuests;
      const subTotalEl = tryFind('subTotalBooking');
      if (subTotalEl) {
        subTotalEl.text = '$' + subTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      const penthouseFeeEl = tryFind('penthouseFee');
      let penthouseFeeValue = 0;
      if (penthouseFeeEl && typeof penthouseFeeEl.text === 'string') {
        const cleaned = penthouseFeeEl.text.replace(/[^0-9.]/g, '');
        penthouseFeeValue = Number(cleaned) || 0;
      }

      finalTotal = subTotal + penthouseFeeValue;
      const finalTotalEl = tryFind('finalTotal');
      if (finalTotalEl) {
        finalTotalEl.text = '$' + finalTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      if (typeof summaryContainer.show === 'function') { try { summaryContainer.show(); } catch (e) {} }
      if (typeof summaryContainer.expand === 'function') { try { summaryContainer.expand(); } catch (e) {} }
    }
  }
  // Keep the selection visible even if pricing failed; the central refresh
  // clears financial values and disables Continue until a valid quote exists.
  refreshSelectionSummary();
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

function tryFind(id) { try { return $w('#' + id); } catch (e) { return null; } }

function plainTextFromHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatVacationDate(d) {
  if (!d || isNaN(d.getTime())) { return ''; }
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const day = d.getDate();
  let suffix = 'th';
  if (day % 100 < 11 || day % 100 > 13) {
    if (day % 10 === 1) suffix = 'st';
    else if (day % 10 === 2) suffix = 'nd';
    else if (day % 10 === 3) suffix = 'rd';
  }
  return months[d.getMonth()] + ' ' + day + suffix + ', ' + d.getFullYear();
}


$w.onReady(async function () {
  refreshSelectionSummary();
  safeText('');
  try {
    let settings = {};
    try { settings = await getAllSettings(); } catch (e) {}
    const suspend = String(settings.suspendGoogleAds).trim() === '1' || Number(settings.suspendGoogleAds) === 1;
    if (typeof setSuspendGoogleAds === 'function') {
      setSuspendGoogleAds(suspend);
    } else {
      console.log('[WBE-SEARCH] setSuspendGoogleAds import not ready, suspendGoogleAds defaults to false');
    }
  } catch (err) {
    console.log('[WBE-SEARCH] settings load error:', err && err.message || err);
  }

  initTracking($w);
  captureClickIds();

  // Load room metadata including roomFee once for the repeater rows.
  (async function () {
    try { _roomFeeMap = await getRoomNames(); } catch (e) { _roomFeeMap = {}; }
  })();

  trackViewBookingSearch();
  hideSearchHeader();

  // Ensure the page starts at the top when loaded.
  try {
    console.log('>>> scrollToTop attempt');
    if (wixWindow && typeof wixWindow.scrollTo === 'function') {
      wixWindow.scrollTo(0, 0);
      console.log('>>> scrollToTop via wixWindow.scrollTo executed');
    } else if (wixWindow && typeof wixWindow.scrollBy === 'function') {
      wixWindow.scrollBy(0, -100000);
      console.log('>>> scrollToTop via wixWindow.scrollBy executed');
    } else {
      console.log('>>> scrollToTop skipped: neither scrollTo nor scrollBy available');
    }
  } catch (e) {
    console.log('>>> scrollToTop error:', e && e.message || e);
  }

  // Fallback: try scrolling the html/body through the event-bridge iframe or document.
  try {
    if (typeof document !== 'undefined' && document.body && typeof document.body.scrollTo === 'function') {
      document.body.scrollTo(0, 0);
      console.log('>>> scrollToTop via document.body.scrollTo executed');
    } else if (typeof document !== 'undefined' && document.documentElement && typeof document.documentElement.scrollTo === 'function') {
      document.documentElement.scrollTo(0, 0);
      console.log('>>> scrollToTop via document.documentElement.scrollTo executed');
    }
  } catch (e2) {
    console.log('>>> scrollToTop document fallback error:', e2 && e2.message || e2);
  }

  const shouldAutoSearch = applyUrlDatesIfPresent();
  if (shouldAutoSearch) {
    setTimeout(function () { searchHandler(); }, 400);
  }
  if (tryFind('btnSearchRooms')) {
    $w('#btnSearchRooms').onClick(async function () {
      console.log('>>> btnSearchRooms clicked');
      const ciEl = tryFind('datePickerCheckIn');
      const coEl = tryFind('datePickerCheckOut');
      const ci = ciEl && ciEl.value ? new Date(ciEl.value) : null;
      const co = coEl && coEl.value ? new Date(coEl.value) : null;
      let nights = 0;
      if (ci && co && co > ci) {
        nights = stayNights(ci, co);
      }
      _summaryNights = nights;

      const estValue = estimateSearchValue(nights);
      trackBeginBooking({
        checkIn: ci ? (ci.getMonth() + 1) + '/' + ci.getDate() + '/' + ci.getFullYear() : undefined,
        checkOut: co ? (co.getMonth() + 1) + '/' + co.getDate() + '/' + co.getFullYear() : undefined,
        nights: nights || undefined,
        value: estValue
      });
      searchHandler();
    });
  }

  const summaryUrl = '/booking-summary';

  // When check-in date is selected, default check-out to the same date for easier picking.
  const ciPicker = tryFind('datePickerCheckIn');
  const coPicker = tryFind('datePickerCheckOut');
  if (ciPicker && coPicker && typeof ciPicker.onChange === 'function') {
    ciPicker.onChange((event) => {
      datesChanged();
      const newCheckIn = event.target.value;
      if (!newCheckIn) return;
      // Only override check-out if it's empty or before the new check-in date.
      const currentCo = coPicker.value;
      const ciDate = parseDate(newCheckIn);
      const coDate = currentCo ? parseDate(currentCo) : null;
      if (!coDate || ciDate > coDate) {
        coPicker.value = new Date(ciDate.getFullYear(), ciDate.getMonth(), ciDate.getDate(), 12, 0, 0);
      }
      refreshSelectionSummary();
    });
  }

  if (coPicker && typeof coPicker.onChange === 'function') coPicker.onChange(datesChanged);

  if (tryFind('btnSummary')) {
    console.log('>>> btnSummary handler registered');
    const summaryBtn = $w('#btnSummary');
    if (typeof summaryBtn.link === 'string') summaryBtn.link = '';
    summaryBtn.onClick(() => {
      if (_summaryNavigating) return;
      if (!isCurrentSearch(_activeSearch) || _activeSearch.pending) {
        safeText('Please wait for this search and pricing to finish, or search again after changing dates.');
        return;
      }
      // Re-read the live controls here too: programmatic changes need not emit
      // onChange, and a previous valid snapshot is not navigation authority.
      updateSelectionPanel();
      if (!_selectionInputsValid) {
        safeText('Please choose valid room and guest quantities before continuing.');
        return;
      }
      console.log('>>> btnSummary clicked');
      const selectionMessage = roomSelectionRequiredMessage(_selections);
      if (selectionMessage) {
        safeText(selectionMessage);
        console.log('>>> Summary blocked: no room selected');
        return;
      }
      if (!_selectedPackage || !_selectedPackage._id) {
        safeText('Please select a package above before continuing.');
        console.log('>>> Summary blocked: no package selected');
        return;
      }
      if (!_selectedPackage.pricingQuoteToken) {
        safeText('Unable to lock this package price. Please search again.');
        return;
      }
      // Never sell a returned partial/different interval at the requested-stay price.
      const ciOnly = pickerDay(_searchCheckIn);
      const coOnly = pickerDay(_searchCheckOut);
      if (!ciOnly || !coOnly || ciOnly >= coOnly ||
          pickerDay(tryFind('datePickerCheckIn').value) !== ciOnly ||
          pickerDay(tryFind('datePickerCheckOut').value) !== coOnly ||
          _selectedPackage.quoteCheckIn !== ciOnly || _selectedPackage.quoteCheckOut !== coOnly ||
          _selections.some(s => resultDay(s.availableCheckIn) !== ciOnly || resultDay(s.availableCheckOut) !== coOnly)) {
        safeText('These room dates do not match the searched and priced stay. For partial availability, choose those dates and search again before continuing.');
        return;
      }
      _summaryNavigating = true;
      const parts = [];
      for (let i = 0; i < _selections.length; i++) {
        const s = _selections[i];
        parts.push(s.roomCode + ':' + s.qty + ':' + (s.numGuests || 1) + ':' + (s.roomFee || 0));
      }

      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          localStorage.setItem('_wbe_rc', parts.join(','));
          localStorage.setItem('_wbe_ci', ciOnly);
          localStorage.setItem('_wbe_co', coOnly);
          if (_selectedPackage && _selectedPackage._id) {
            localStorage.setItem('_wbe_pkg', _selectedPackage._id);
            localStorage.setItem('_wbe_quote', _selectedPackage.pricingQuoteToken);
          }
          console.log('>>> STORED rc (summary):', parts.join(','));
        }
      } catch (e) {
        console.log('>>> storage save error (summary):', e && e.message || e);
      }
      const pkgParam = _selectedPackage && _selectedPackage._id ? '&pkg=' + encodeURIComponent(_selectedPackage._id) : '';
      const quoteParam = '&quote=' + encodeURIComponent(_selectedPackage.pricingQuoteToken);
      wixLocation.to(summaryUrl + '?rc=' + encodeURIComponent(parts.join(',')) +
        '&ci=' + encodeURIComponent(ciOnly) +
        '&co=' + encodeURIComponent(coOnly) + pkgParam + quoteParam);
    });
  }

  const rep = tryFind('searchResultsRepeater');
  if (rep && typeof rep.onItemReady === 'function') {
    rep.onItemReady(($item, itemData) => {
      const rowSearch = _activeSearch;
      const quantityControl = safeItem($item, '#roomQtyDropdown', null, null);
      const existingBinding = quantityControl && _roomRowBindings.get(quantityControl);
      // Wix readiness/listeners are additive: never reset or rebind a live row.
      if (existingBinding && existingBinding.search === rowSearch) return;
      const binding = { search: rowSearch, read: null };
      const currentRow = () => {
        if (_activeRoomBindings.get(itemData._id) !== binding) return false;
        if (!isCurrentSearch(rowSearch) || itemData.searchGeneration !== rowSearch.generation) return false;
        const live = rep.data.find(row => row._id === itemData._id && row.roomCode === itemData.roomCode && row.searchGeneration === rowSearch.generation);
        if (!live || !isFullStayResult(live, rowSearch)) return false;
        itemData = live;
        return true;
      };
      // Repeater item debug log disabled to reduce console noise
      if (!isFullStayResult(itemData, rowSearch)) {
        safeItem($item, '#roomName', 'text', (itemData.roomName || itemData.roomCode || '') + ' — Not available for these dates');
        safeItem($item, '#roomPrice', 'text', '');
        safeItem($item, '#roomAvailability', 'text', itemData.status === 'partial'
          ? 'Partial availability only. Choose those dates and search again.' : '');
        safeItem($item, '#numRooms', 'text', '');
        safeItem($item, '#occupancy', 'text', '');
        safeItem($item, '#defaultOccupancy', 'text', '');
        const dd = safeItem($item, '#roomQtyDropdown', null, null);
        if (dd) { dd.options = [{ label: '0', value: '0' }]; dd.value = '0'; try { dd.disable(); } catch (e) {} }
        const guestDdUnavail = safeItem($item, '#numberOfGuests', null, null);
        if (guestDdUnavail) { guestDdUnavail.options = []; try { guestDdUnavail.disable(); } catch (e) {} }
        return;
      }
      if (!isCurrentSearch(rowSearch) || itemData.searchGeneration !== rowSearch.generation ||
          !rep.data.some(row => row._id === itemData._id && row.roomCode === itemData.roomCode && row.searchGeneration === rowSearch.generation)) return;
      _activeRoomBindings.set(itemData._id, binding);
      if (quantityControl) _roomRowBindings.set(quantityControl, binding);
      safeItem($item, '#roomName', 'text', itemData.roomName || itemData.roomCode || '');
      safeItem($item, '#roomname2', 'text', itemData.name || itemData.roomName || itemData.roomCode || '');
      safeItem($item, '#description', 'text', plainTextFromHtml(itemData.description));
      safeItem($item, '#roomType', 'text', itemData.roomType || '');
      safeItem($item, '#occupancyText', 'text', itemData.occupancyText || '');
      safeItem($item, '#additionalFeeText', 'text', itemData.additionalFeeText || '');
      safeItem($item, '#numRooms', 'text', String(itemData.maxQty || itemData.units || 1));
      safeItem($item, '#roomPrice', 'text', '');
      safeItem($item, '#roomAvailability', 'text',
        itemData.status === 'full' ? 'Available for your full ' + itemData.availableNights + ' nights'
        : 'Available for ' + itemData.availableNights + ' nights (partial)');
      safeItem($item, '#occupancy', 'text', String(itemData.occupancy || 2));
      safeItem($item, '#defaultOccupancy', 'text', String(itemData.baseOccupancy || itemData.occupancy || 2));

      // Selected badge defaults hidden inside repeater template; reveal when qty selected.
      const badgeEl = safeItem($item, '#selectedBadge', null, null);
      if (badgeEl) { try { badgeEl.hide(); } catch (e) {} }

      // Set roomFeeText from Rooms collection and show penthouseFeeText only for Penthouse Apartment.
      const feeInfo = (_roomFeeMap && _roomFeeMap[itemData.roomCode]) || {};
      const feeAmount = Number(feeInfo.roomFee) || Number(itemData.roomFee) || 0;
      const roomFeeTextEl = safeItem($item, '#roomFeeText', null, null);
      if (roomFeeTextEl) {
        roomFeeTextEl.text = feeAmount > 0 ? '$' + feeAmount.toFixed(2) : '';
      }

      const penthouseFeeTextEl = safeItem($item, '#penthouseFeeText', null, null);
      if (penthouseFeeTextEl) {
        if (itemData.roomCode === 'penthouse_apartment') {
          if (typeof penthouseFeeTextEl.show === 'function') { try { penthouseFeeTextEl.show(); } catch (e) {} }
          if (typeof penthouseFeeTextEl.expand === 'function') { try { penthouseFeeTextEl.expand(); } catch (e) {} }
        } else {
          if (typeof penthouseFeeTextEl.hide === 'function') { try { penthouseFeeTextEl.hide(); } catch (e) {} }
          if (typeof penthouseFeeTextEl.collapse === 'function') { try { penthouseFeeTextEl.collapse(); } catch (e) {} }
        }
      }

      if (itemData.mainPhoto) try { $item('#roomThumb').src = itemData.mainPhoto; } catch (e) {}

      try {
        const rowVectorInit = $item('#vectorImage2');
        if (rowVectorInit) { try { rowVectorInit.hide(); } catch (e) {} if (typeof rowVectorInit.collapse === 'function') { try { rowVectorInit.collapse(); } catch (e) {} } }
      } catch (e) {}

      const configuredBaseOcc = Number(itemData.baseOccupancy || itemData.occupancy || 2);
      const maxOcc = Number(itemData.occupancy ?? configuredBaseOcc);
      // Room defaults are presentation policy, not the CMS pricing base.
      const roomDefault = { adventure_suite: 2, penthouse_apartment: 2, two_bedroom_apartment: 3 }[itemData.roomCode];
      const defaultOcc = Math.min(roomDefault || configuredBaseOcc, maxOcc);
      const baseOcc = Math.max(1, Math.min(configuredBaseOcc, defaultOcc));
      const guestOpts = [];
      for (let g = baseOcc; g <= maxOcc; g++) guestOpts.push({ label: String(g), value: String(g) });
      const guestDd = safeItem($item, '#numberOfGuests', null, null);
      binding.read = () => {
        if (!currentRow()) return null;
        const qtyDd = safeItem($item, '#roomQtyDropdown', null, null);
        const limit = Number(itemData.maxQty || 0);
        const qty = qtyDd ? dropdownInteger(qtyDd.value, qtyDd.options, 0, limit) : 0;
        if (qty === null) return { valid: false, qty: 0, selection: null };
        // Inactive guest choices never poison another selected room.
        if (qty === 0) return { valid: true, qty: 0, selection: null };
        const numGuests = dropdownInteger(guestDd ? guestDd.value : String(baseOcc),
          guestOpts, baseOcc, maxOcc);
        if (numGuests === null || (guestDd && !guestDd.options.some(o => o.value === guestDd.value))) {
          return { valid: false, qty, selection: null };
        }
        return { valid: true, qty, selection: {
          roomCode: itemData.roomCode, roomName: itemData.roomName || itemData.roomCode,
          qty, numGuests, availableCheckIn: itemData.availableCheckIn,
          availableCheckOut: itemData.availableCheckOut, roomFee: itemData.roomFee || 0
        } };
      };
      if (guestDd) {
        guestDd.options = guestOpts;
        guestDd.value = guestOpts.some(o => o.value === String(defaultOcc)) ? String(defaultOcc) : '';
        if (typeof guestDd.onChange === 'function') {
          guestDd.onChange((event) => {
            if (!currentRow()) return;
            updateSelectionPanel();
          });
        }
      }

      const dd = safeItem($item, '#roomQtyDropdown', null, null);
      if (dd && typeof dd.onChange === 'function') {
        const maxQty = typeof itemData.maxQty === 'number' ? itemData.maxQty : (Number(itemData.units) || 1);
        if (maxQty <= 0) {
          dd.options = [{ label: '0', value: '0' }];
          dd.value = '0';
          dd.disable && dd.disable();
        } else {
          const opts = [];
          for (let q = 0; q <= maxQty; q++) opts.push({ label: String(q), value: String(q) });
          dd.options = opts;
          dd.value = '0';
          dd.enable && dd.enable();
        }
        dd.onChange((event) => {
          if (!currentRow()) return;
          const row = binding.read();
          const qty = row && row.valid ? row.qty : 0;
          updateSelectionPanel();
          if (!currentRow()) return;
          const rowVector = safeItem($item, '#vectorImage2', null, null);
          const badgeEl = safeItem($item, '#selectedBadge', null, null);
          if (qty > 0) {
            if (rowVector) {
              try { rowVector.show(); } catch (e) {}
              try { rowVector.expand(); } catch (e) {}
            }
            if (badgeEl) { try { badgeEl.show(); } catch (e) {} try { badgeEl.expand(); } catch (e) {} }
          } else {
            if (rowVector) {
              try { rowVector.hide(); } catch (e) {}
              try { rowVector.collapse(); } catch (e) {}
            }
            if (badgeEl) { try { badgeEl.hide(); } catch (e) {} try { badgeEl.collapse(); } catch (e) {} }
          }

          // Visibility is now handled centrally by updateSelectionPanel().
        });
      }
    });
  }

  function hideIfFound(id) {
    if (SELECTION_IDS.includes(id)) return;
    const el = tryFind(id);
    if (!el) return;
    if (typeof el.collapse === 'function') {
      try { el.collapse(); } catch (e) {}
    } else if (typeof el.hide === 'function') {
      try { el.hide(); } catch (e) {}
    }
  }

  hideIfFound('vacationDates');
  hideIfFound('selectionPanel');
  hideIfFound('selectedRoomsContainer');
  hideIfFound('searchResultsRepeater');
  hideIfFound('btnSummary');
  hideIfFound('box3');

  loadMessages();
});

async function loadMessages() {
  try {
    const msgs = await getActiveMessages('search');
    const el = tryFind('messagesContainer');
    if (!el) return;
    if (msgs.length === 0) {
      if (typeof el.collapse === 'function') { try { el.collapse(); } catch (e) {} }
    } else {
      if (typeof el.expand === 'function') { try { el.expand(); } catch (e) {} }
      el.text = msgs.map((m) => m.title || '').join('; ');
    }
  } catch (e) {}
}

// Value estimate for audience tiering: 2 guests at the effective per-person stay rate.
function estimateSearchValue(nights) {
  if (!nights || !_hasCachedStayPricing) return undefined;
  return Math.round(_cachedPerPersonStayTotal * 2 * 100) / 100;
}

async function searchHandler() {
  invalidateSearch();
  const gallery = tryFind('hotelRoomPhotos');
  if (gallery && typeof gallery.collapse === 'function') { try { gallery.collapse(); } catch (e) {} }

  let ciEl = tryFind('datePickerCheckIn'), coEl = tryFind('datePickerCheckOut');
  if (!ciEl || !coEl) {
    try {
      $w().forEach((el) => {
        if (el.type === 'DatePicker' || el.type === '$w.DatePicker') {
          if (!ciEl) ciEl = el; else if (!coEl) coEl = el;
        }
      });
    } catch (e) {}
  }

  let ci = null, co = null;
  if (ciEl) try { ci = ciEl.value; } catch (e) {}
  if (coEl) try { co = coEl.value; } catch (e) {}

  const ciDay = pickerDay(ci), coDay = pickerDay(co);
  const ciDate = ciDay ? new Date(ciDay + 'T12:00:00') : null;
  const coDate = coDay ? new Date(coDay + 'T12:00:00') : null;
  if (!ciDate || !coDate) { hideSearchHeader(); safeText('Please select check-in and check-out dates.'); return; }
  if (ciDate >= coDate) { hideSearchHeader(); safeText('Check-in date must be before the Check-out date.'); return; }

  const computedNights = stayNights(ciDate, coDate);
  _summaryNights = computedNights;
  _searchCheckIn = ciDate;
  _searchCheckOut = coDate;
  _cachedPerPersonStayTotal = 0;
  _hasCachedStayPricing = false;

  // Immutable civil dates bind results and pricing to this one invocation.
  const search = { generation: _searchGeneration, checkIn: ciDay, checkOut: coDay, pending: true };
  _activeSearch = search;
  try {
  // Validate that an adventure package is defined for this number of nights.
  const pkgExists = await packageExistsForNights(computedNights);
  if (!isCurrentSearch(search)) return;
  if (!pkgExists) {
    hideSearchHeader();
    hideAlternateDates();
    const rep = tryFind('searchResultsRepeater');
    if (rep) { try { rep.collapse(); } catch (e) {} }
    const box3 = tryFind('box3');
    if (box3) { if (typeof box3.collapse === 'function') { try { box3.collapse(); } catch (e) {} } else if (typeof box3.hide === 'function') { try { box3.hide(); } catch (e) {} } }
    const panel = tryFind('selectionPanel');
    if (panel) { try { panel.collapse(); } catch (e) {} }
    const container = tryFind('selectedRoomsContainer');
    setSummaryControl(container, 'hidden', true);
    safeText('No adventure packages exist for that number of nights. Please choose a lower number of nights.');
    return;
  }

  clearSelections(true);
  safeText('Searching...');

    const res = await searchAvailability(new Date(ciDate.getTime()), new Date(coDate.getTime()));
    if (!isCurrentSearch(search)) return;
    console.log('>>> [WBE-SEARCH] raw results:', JSON.stringify(res));
    if (!res.ok) { hideSearchHeader(); safeText(res.error); return; }

    const rep = tryFind('searchResultsRepeater');
    if (!rep) { safeText('Found ' + res.results.length + ' result(s) but no repeater to display them.'); return; }
    if (res.results.length === 0) {
      rep.data = [];
      clearSelections(true);
      hideSearchHeader();
      const box3 = tryFind('box3');
      if (box3) { if (typeof box3.collapse === 'function') { try { box3.collapse(); } catch (e) {} } else if (typeof box3.hide === 'function') { try { box3.hide(); } catch (e) {} } }
      const panel = tryFind('selectionPanel');
      if (panel) { try { panel.collapse(); } catch (e) {} }
      const container = tryFind('selectedRoomsContainer');
      setSummaryControl(container, 'hidden', true);
        safeText('No rooms are available for the dates entered. Checking nearby dates...');
      trackSearchNoResults({ nights: res.requestedNights, checkIn: ciDate ? ciDate.toISOString().slice(0, 10) : undefined });
      showAlternateDates(ciDate, coDate);
      return;
    }
    hideAlternateDates();

    updateSelectionPanel();

    const availableData = [];
    for (let i = 0; i < res.results.length; i++) {
      const item = res.results[i];
      if (!isFullStayResult(item, search)) continue;
      item._id = 'room_' + i;
      item.searchGeneration = search.generation;
      availableData.push(item);
      trackRoomView({ roomCode: item.roomCode, nights: res.requestedNights });
    }
    if (availableData.length === 0) {
      rep.data = [];
      syncSummaryButtonWithResults(0);
      clearSelections(true);
      updateSelectionPanel();
      hideSearchHeader();
      try { rep.expand(); } catch (e) {}
      const box3 = tryFind('box3');
      if (box3) { if (typeof box3.collapse === 'function') { try { box3.collapse(); } catch (e) {} } else if (typeof box3.hide === 'function') { try { box3.hide(); } catch (e) {} } }
      const selPanel = tryFind('selectionPanel');
      if (selPanel) { try { selPanel.collapse(); } catch (e) {} }
      const container = tryFind('selectedRoomsContainer');
      setSummaryControl(container, 'hidden', true);
        safeText('No rooms are available for the dates entered. Checking nearby dates...');
      trackSearchNoResults({ nights: res.requestedNights, checkIn: ciDate ? ciDate.toISOString().slice(0, 10) : undefined });
      showAlternateDates(ciDate, coDate);
      return;
    }
    // Populate quoted packages and their default selection before room rows.
    await showSearchHeader(ciDate, coDate, computedNights, search);
    if (!isCurrentSearch(search)) return;
    if (rep) { try { rep.show(); } catch (e) {} try { rep.expand(); } catch (e) {} }
    rep.data = availableData;
    syncSummaryButtonWithResults(availableData.length);

    // Show package column labels above the repeater.
    ['nightsLabel', 'specialtyText', 'priceText'].forEach(function (id) {
      const el = tryFind(id);
      if (el) {
        if (typeof el.show === 'function') { try { el.show(); } catch (e) {} }
        if (typeof el.expand === 'function') { try { el.expand(); } catch (e) {} }
      }
    });

    if (!search.pending) safeText('Found ' + availableData.length + ' result' + (availableData.length === 1 ? '' : 's') + ' for ' + res.requestedNights + ' nights.');
  } catch (e) { if (isCurrentSearch(search)) safeText('Error: ' + e.message); }
}

function hidePackageInfo() {
  try { $w('#packageName').collapse(); } catch (e) {}
  setSummaryControl(tryFind('packageAmenities'), 'collapsed', true);
}

function loadPackageOptions(nights, search) {
  const pkgContainer = tryFind('packageContainer');
  if (!pkgContainer) return;

  return getPackagesByNights(nights).then(async function (packages) {
    if (!isCurrentSearch(search)) return;
    let availablePackages = (packages || []).map(pkg => ({ ...pkg }));
    if (!availablePackages.length) { safeText('No packages are available. Please search again.'); return; }

    // The backend resolves seasonal and demand pricing per night, then signs a
    // one-hour quote that remains authoritative through booking and invoicing.
    await Promise.all(availablePackages.map(async function (pkg) {
      try {
        const quoteCheckIn = search.checkIn;
                const quoteCheckOut = search.checkOut;
        const quoteResult = await createPricingQuote(pkg._id, quoteCheckIn, quoteCheckOut);
        if (!isCurrentSearch(search)) return;
        const issued = quoteResult && quoteResult.quote;
        if (!issued || issued.packageId !== pkg._id || issued.checkIn !== quoteCheckIn || issued.checkOut !== quoteCheckOut || Number(issued.nights) !== nights) {
          throw new Error('Returned quote does not match this stay');
        }
        pkg.quoteCheckIn = quoteCheckIn;
        pkg.quoteCheckOut = quoteCheckOut;
        const priced = quoteResult && quoteResult.pricing;
        pkg.stayTotalPerPerson = Number(priced && priced.totalPerPerson) || 0;
        pkg.averageNightlyRate = Number(priced && priced.averageNightlyRate) || 0;
        pkg.pricingQuoteToken = quoteResult && quoteResult.token || '';
        pkg.pricingResolved = !!priced && !!pkg.pricingQuoteToken && Number.isFinite(Number(priced.totalPerPerson));
      } catch (e) {
        console.log('>>> pricing quote error for package', pkg._id, e && e.message || e);
        pkg.pricingResolved = false;
        pkg.pricingQuoteToken = '';
      }
    }));

    if (!isCurrentSearch(search)) return;
    _availablePackages = availablePackages.filter(function (pkg) {
      return pkg.pricingResolved && pkg.pricingQuoteToken;
    });
    if (!_availablePackages.length) {
      safeText('Unable to calculate and lock package pricing. Please try the search again.');
      return;
    }

    // Keep each group's order, with Scuba titles below all other packages.
    const nonScubaPackages = [];
    const scubaPackages = [];
    _availablePackages.forEach(function (pkg) {
      const group = String(pkg.title || '').toLowerCase().includes('scuba') ? scubaPackages : nonScubaPackages;
      group.push(pkg);
    });
    _availablePackages = nonScubaPackages.concat(scubaPackages);

    search.pending = false;
    // Default to first package if none selected
    _selectedPackage = _availablePackages[0];
    _cachedPerPersonStayTotal = _selectedPackage.stayTotalPerPerson || 0;
    _hasCachedStayPricing = !!_selectedPackage.pricingResolved;

    // Summary identity comes only from the selected, quoted package.
    updatePackageNameField();
    updatePackageAmenitiesField();

    // Legacy single-package elements
    const pkgName2 = tryFind('packageName2');
    const nightsTextEl = tryFind('nightsText');
    const specialtyToursEl = tryFind('specialtyTours');
    if (pkgName2) { pkgName2.text = _selectedPackage.title || ''; }
    if (nightsTextEl) { nightsTextEl.text = String(nights) + ' night' + (nights === 1 ? '' : 's'); }
    if (specialtyToursEl) { specialtyToursEl.text = _selectedPackage.specialtyTours || ''; }
    [pkgName2, nightsTextEl, specialtyToursEl].forEach(function (el) {
      if (el) {
        if (typeof el.show === 'function') { try { el.show(); } catch (e) {} }
        if (typeof el.expand === 'function') { try { el.expand(); } catch (e) {} }
      }
    });

    // Repeater with multiple package options
    const repeater = tryFind('packageRepeater');
    if (repeater) {
      if (!_packageRepeaterReady && typeof repeater.onItemReady === 'function') {
        repeater.onItemReady(($item, itemData) => {
          renderPackageRow($item, itemData, repeater, _activeSearch);
        });
        _packageRepeaterReady = true;
      }

      // Mark first as selected by default
      try {
        repeater.data = _availablePackages.map((p, idx) => ({ ...p, _id: p._id || String(idx) }));
        repeater.forEachItem(($item, itemData) => renderPackageRow($item, itemData, repeater, search));
      } catch (e) {
        console.log('>>> packageRepeater data error:', e.message);
      }

      // Determine which package should be selected by default.
      const defaultSelected = _availablePackages[0];
      _selectedPackage = defaultSelected;
      _cachedPerPersonStayTotal = defaultSelected.stayTotalPerPerson || 0;
      _hasCachedStayPricing = !!defaultSelected.pricingResolved;

      // After data is set, show the indicator on the first/default package only.
      setTimeout(function () {
        if (!isCurrentSearch(search)) return;
        highlightSelectedPackageRow();
        updatePackageNameField();
        updatePackageAmenitiesField();
      }, 100);
    }

    if (typeof pkgContainer.show === 'function') { try { pkgContainer.show(); } catch (e) {} }
    if (typeof pkgContainer.expand === 'function') { try { pkgContainer.expand(); } catch (e) {} }

    // Ensure column header labels above the repeater are visible.
    ['nightsLabel', 'specialtyText', 'priceText'].forEach(function (id) {
      const el = tryFind(id);
      if (el) {
        if (typeof el.show === 'function') { try { el.show(); } catch (e) {} }
        if (typeof el.expand === 'function') { try { el.expand(); } catch (e) {} }
      }
    });

    // Ensure the package repeater itself is visible.
    const packageRepeaterEl = tryFind('packageRepeater');
    console.log('>>> packageRepeater found:', !!packageRepeaterEl);
    if (packageRepeaterEl) {
      if (typeof packageRepeaterEl.show === 'function') { try { packageRepeaterEl.show(); } catch (e) {} }
      if (typeof packageRepeaterEl.expand === 'function') { try { packageRepeaterEl.expand(); } catch (e) {} }
    }

    const packagePriceEl = tryFind('packagePrice');
    if (packagePriceEl) {
      const packagePrice = _cachedPerPersonStayTotal;
      if (_hasCachedStayPricing) {
        packagePriceEl.text = '$' + packagePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (typeof packagePriceEl.show === 'function') { try { packagePriceEl.show(); } catch (e) {} }
        if (typeof packagePriceEl.expand === 'function') { try { packagePriceEl.expand(); } catch (e) {} }
      }
    }
  }).catch(function (err) {
    if (isCurrentSearch(search)) safeText('Unable to load package pricing. Please search again.');
  });
}

function renderPackageRow($item, itemData, repeater, search) {
  if (!isCurrentSearch(search) || search.pending || !_availablePackages.some(p => p._id === itemData._id && p.pricingQuoteToken === itemData.pricingQuoteToken)) return;
  const nights = _summaryNights;
  safeItem($item, '#packageName2', 'text', itemData.title || '');
  safeItem($item, '#nightsText', 'text', String(nights) + ' night' + (nights === 1 ? '' : 's'));
  safeItem($item, '#specialtyTours', 'text', itemData.specialtyTours || '');
  const packagePriceEl = safeItem($item, '#packagePrice', null, null);
  if (packagePriceEl) {
    const price = Number(itemData.stayTotalPerPerson) || 0;
    packagePriceEl.text = '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // Readiness can run after the initial data assignment.
  if (_selectedPackage && itemData._id === _selectedPackage._id) showPackageIndicator($item);
  else hidePackageIndicator($item);
  const rowContainer = $item('#packageContainer');
  let binding = _packageRowBindings.get(itemData._id);
  if (binding && binding.rowContainer === rowContainer) {
    binding.search = search;
    binding.itemData = itemData;
    return;
  }
  binding = { rowContainer, search, itemData };
  _packageRowBindings.set(itemData._id, binding);
  // Bind once per physical row; retained rows refresh the binding above.
  function selectThisPackage(evt) {
    const { search, itemData } = binding;
    if (_packageRowBindings.get(itemData._id) !== binding || !isCurrentSearch(search) || search.pending) return;
    if (!repeater.data.some(p => p._id === itemData._id && p.pricingQuoteToken === itemData.pricingQuoteToken)) return;
    console.log('>>> package row clicked:', itemData.title, 'id:', itemData._id);
    // Use the original package object from _availablePackages so _id is preserved.
    const originalPkg = _availablePackages.find(function (p) { return p._id === itemData._id; });
    if (!originalPkg || originalPkg.pricingQuoteToken !== itemData.pricingQuoteToken || originalPkg.quoteCheckIn !== search.checkIn || originalPkg.quoteCheckOut !== search.checkOut) return;
    _selectedPackage = originalPkg;
    _cachedPerPersonStayTotal = originalPkg.stayTotalPerPerson || 0;
    _hasCachedStayPricing = !!originalPkg.pricingResolved;
    updateSelectionPanel();
    updatePackageNameField();
    updatePackageAmenitiesField();
    highlightSelectedPackageRow();
    if (evt && evt.stopPropagation) { evt.stopPropagation(); }
  }
  const radio = getPackageSelectionIndicator($item);
  if (radio && typeof radio.onChange === 'function') radio.onChange(selectThisPackage);
  if (rowContainer && typeof rowContainer.onClick === 'function') {
    rowContainer.onClick(selectThisPackage);
  }
  const box = safeItem($item, '#box7', null, null);
  if (box && typeof box.onClick === 'function') {
    try { box.onClick(selectThisPackage); } catch (e) {}
  }
  ['#packageName2', '#nightsText', '#specialtyTours', '#packagePrice'].forEach(function (sel) {
    const el = $item(sel);
    if (el && typeof el.onClick === 'function') {
      try { el.onClick(selectThisPackage); } catch (e) {}
    }
  });
}

function updatePackageNameField() {
  const packageNameEl = tryFind('packageName');
  if (packageNameEl) {
    packageNameEl.text = _selectedPackage && _selectedPackage.title ? _selectedPackage.title : '';
    if (typeof packageNameEl.show === 'function') { try { packageNameEl.show(); } catch (e) {} }
    if (typeof packageNameEl.expand === 'function') { try { packageNameEl.expand(); } catch (e) {} }
  }
}

function updatePackageAmenitiesField() {
  const packageAmenitiesEl = tryFind('packageAmenities');
  if (!packageAmenitiesEl) return;
  if (_selectedPackage && _selectedPackage.includedAmenities) {
    packageAmenitiesEl.text = _selectedPackage.includedAmenities;

  } else {
    packageAmenitiesEl.text = '';
  }
  refreshSelectionSummary();
}

function getPackageSelectionIndicator($item) {
  if (!$item) return null;
  try {
    return $item('#radioPackage');
  } catch (e) {
    console.log('>>> radioPackage selection indicator not found:', e.message);
    return null;
  }
}

function hidePackageIndicator($item) {
  const indicator = getPackageSelectionIndicator($item);
  if (!indicator) return;
  try { indicator.selectedIndex = undefined; } catch (e) { console.log('>>> clear radioPackage error:', e.message); }
}

function showPackageIndicator($item) {
  const indicator = getPackageSelectionIndicator($item);
  if (!indicator) return;
  try {
    indicator.selectedIndex = 0;
  } catch (e) { console.log('>>> select radioPackage error:', e.message); }
}

function highlightSelectedPackageRow() {
  const repeater = tryFind('packageRepeater');
  console.log('>>> highlightSelectedPackageRow called, repeater found:', !!repeater, 'selected:', _selectedPackage && _selectedPackage._id);
  if (!repeater || !_selectedPackage || !_selectedPackage._id) return;
  const selectedId = _selectedPackage._id;
  try {
    repeater.forEachItem((itemScope, itemData) => {
      const isSelected = !!itemData && itemData._id === selectedId;
      console.log('>>> comparing row id:', itemData && itemData._id, 'to selected:', selectedId, 'match:', isSelected);
      if (isSelected) {
        showPackageIndicator(itemScope);
      } else {
        hidePackageIndicator(itemScope);
      }
    });
  } catch (e) { console.log('>>> highlightSelectedPackageRow error:', e.message); }
}

function hideSearchHeader() {
  ['packageSelectionText', 'accommodationText', 'vacationDates', 'packageContainer', 'packageName2', 'nightsText', 'specialtyTours', 'packagePrice', 'packageText', 'nightsLabel', 'specialtyText', 'priceText']
    .forEach(function (id) {
      const el = tryFind(id);
      if (el) {
        if (typeof el.hide === 'function') { try { el.hide(); } catch (e) {} }
        if (typeof el.collapse === 'function') { try { el.collapse(); } catch (e) {} }
      }
    });
}

function showSearchHeader(ciDate, coDate, nights, search) {
  ['packageSelectionText', 'accommodationText'].forEach(function (id) {
    const el = tryFind(id);
    if (el) { try { el.show(); } catch (e) {} try { el.expand(); } catch (e) {} }
  });

  const vacationDatesEl = tryFind('vacationDates');
  if (vacationDatesEl) {
    const ciFmt = formatVacationDate(ciDate);
    const coFmt = formatVacationDate(coDate);
    if (ciFmt && coFmt) {
      vacationDatesEl.text = (ciFmt + ' - ' + coFmt).trim();

    }
  }

  if (nights > 0) {
    return loadPackageOptions(nights, search);
  }
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  if (typeof v === 'number') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  return null;
}

function safeText(txt, opts) {
  try {
    const el = tryFind('statusText');
    if (!el) { console.log('>>> safeText: statusText element not found'); return; }
    const style = "font-family: 'Inter Semi Bold', 'Inter', sans-serif; font-size: 20px;";
    if (opts && opts.html) {
      el.html = "<span style=\"" + style + "\">" + txt + "</span>";
    } else {
      const escaped = escapeHtml(txt).replace(/\n/g, '<br>');
      el.html = "<span style=\"" + style + "\">" + escaped + "</span>";
    }
    if (typeof el.expand === 'function') el.expand();
    if (typeof el.show === 'function') el.show();
    console.log('>>> safeText:', txt);
  } catch (e) { console.log('>>> safeText error:', e.message); }
}

async function showAlternateDates(ciDate, coDate) {
  const search = _activeSearch;
  try {
    const res = await suggestAlternateDates(ciDate, coDate);
    if (!isCurrentSearch(search)) return;
    const sug = (res && res.suggestions) || [];

    if (sug.length === 0) {
      safeText('* No rooms available within 30 days of your dates. Please contact us or try a shorter stay.', { html: true });
      return;
    }

    const links = sug.map(function (s) {
      const url = buildAltUrl(s.checkIn, s.checkOut);
      return "<a href=\"" + url + "\" style=\"font-family: 'Inter Semi Bold', 'Inter', sans-serif; font-size: 20px;\">" + s.label + "</a>";
    }).join(' &middot; ');
    safeText('* No rooms for those dates. Try: ' + links, { html: true });
  } catch (e) {
    if (!isCurrentSearch(search)) return;
    console.error('>>> showAlternateDates error:', e && e.message || e);
    safeText('* No rooms are available for the dates entered.');
  }
}

function buildAltUrl(checkInIso, checkOutIso) {
  const ci = new Date(checkInIso);
  const co = new Date(checkOutIso);
  const fmt = function (d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  };
  return '/wanderlust-booking?ci=' + fmt(ci) + '&co=' + fmt(co) + '&auto=1';
}

function hideAlternateDates() {}

function applyUrlDatesIfPresent() {
  try {
    const q = wixLocation.query || {};
    if (!q.ci || !q.co) return false;
    const ciEl = tryFind('datePickerCheckIn');
    const coEl = tryFind('datePickerCheckOut');
    if (ciEl) ciEl.value = new Date(q.ci + 'T00:00:00');
    if (coEl) coEl.value = new Date(q.co + 'T00:00:00');
    return q.auto === '1';
  } catch (e) { return false; }
}