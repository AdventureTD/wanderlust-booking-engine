import { getActiveMessages } from 'backend/messages';
import { searchAvailability, suggestAlternateDates } from 'backend/search';
import { getPackageAmenities, getPackageBaseRate, getPackageDetailsByNights } from 'backend/packages';
import { getRoomNames } from 'backend/rooms';
import { trackBeginBooking, captureClickIds, trackViewBookingSearch, trackRoomView, trackSearchNoResults, initTracking, setSuspendGoogleAds } from 'public/tracking';
import { getAllSettings } from 'backend/settings';
import wixLocation from 'wix-location';

let _selections = [];
let _roomFeeMap = {};
let _summaryNights = 0;
let _cachedBaseRate = 0;

function clearSelections(silent) {
  _selections = [];
  if (!silent) updateSelectionPanel();
}

function setRoomSelection(roomCode, roomName, qty, numGuests, availableCheckIn, availableCheckOut, roomFee) {
  let next = [], found = false;
  for (let i = 0; i < _selections.length; i++) {
    if (_selections[i].roomCode === roomCode) {
      found = true;
      if (qty > 0) next.push({ roomCode, roomName, qty, numGuests, availableCheckIn, availableCheckOut, roomFee: roomFee || 0 });
    } else next.push(_selections[i]);
  }
  if (!found && qty > 0) next.push({ roomCode, roomName, qty, numGuests, availableCheckIn, availableCheckOut, roomFee: roomFee || 0 });
  _selections = next;
  updateSelectionPanel();
}

function removeRoomSelection(roomCode) {
  const next = [];
  for (let i = 0; i < _selections.length; i++) {
    if (_selections[i].roomCode !== roomCode) next.push(_selections[i]);
  }
  _selections = next;
  updateSelectionPanel();
}
function updateSelectionPanel() {
  const panel = tryFind('selectionPanel'), container = tryFind('selectedRoomsContainer');
  const btnSummary = tryFind('btnSummary');
  const box3 = tryFind('box3');
  if (!panel || !container) return;
  if (_selections.length === 0) {
    panel.collapse();
    try { container.hide(); } catch (e) {}
    if (btnSummary) { try { btnSummary.collapse(); } catch (e) {} }
    if (box3) { try { box3.collapse(); } catch (e) {} }
    container.text = '';
    return;
  }
  if (box3) { try { box3.show(); } catch (e) {} try { box3.expand(); } catch (e) {} }
  panel.expand();
  if (typeof container.show === 'function') { try { container.show(); } catch (e) {} }
  if (btnSummary) { try { btnSummary.show(); } catch (e) {} try { btnSummary.expand(); } catch (e) {} }
  let total = 0, totalGuests = 0, lines = [];
  for (let i = 0; i < _selections.length; i++) {
    const s = _selections[i];
    const guests = (s.numGuests || 1) * s.qty;
    lines.push((s.roomName || s.roomCode) + ' (Qty: ' + s.qty + ', Guests: ' + guests + ')');
    total += s.qty;
    totalGuests += guests;
  }
  container.text = lines.join('\n');
  console.log('>>> selection panel updated:', container.text);

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
      try { penthouseFeeEl.show(); } catch (e) {}
    } else {
      try { penthouseFeeEl.hide(); } catch (e) {}
    }
  }

  // Show/hide Penthouse label text based on selection.
  const penthouseTextEl = tryFind('penthouseText');
  if (penthouseTextEl) {
    if (hasPenthouseSelected) {
      try { penthouseTextEl.show(); } catch (e) {}
    } else {
      try { penthouseTextEl.hide(); } catch (e) {}
    }
  }

  // Calculate and display subTotalBooking: baseRate * nights * total guests.
  const summaryContainer = tryFind('bookingSummaryContainer');
  if (summaryContainer) {
    if (_selections.length > 0 && _summaryNights > 0 && _cachedBaseRate > 0) {
      const subTotal = _cachedBaseRate * _summaryNights * totalGuests;
      const subTotalEl = tryFind('subTotalBooking');
      if (subTotalEl) {
        subTotalEl.text = '$' + subTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      try { summaryContainer.show(); } catch (e) {}
      try { summaryContainer.expand(); } catch (e) {}
    } else {
      try { summaryContainer.collapse(); } catch (e) {}
    }
  }
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
  try {
    let settings = {};
    try { settings = await getAllSettings(); } catch (e) {}
    const suspend = String(settings.suspendGoogleAds).trim() === '1' || Number(settings.suspendGoogleAds) === 1;
    setSuspendGoogleAds(suspend);
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
        nights = Math.round((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24));
      }
      _summaryNights = nights;

      // Set vacation date range at bottom of page.
      const vacationDatesEl = tryFind('vacationDates');
      if (vacationDatesEl) {
        const ciFmt = formatVacationDate(ci);
        const coFmt = formatVacationDate(co);
        if (ciFmt && coFmt) {
          vacationDatesEl.text = ciFmt + ' - ' + coFmt;
          try { vacationDatesEl.show(); } catch (e) {}
          try { vacationDatesEl.expand(); } catch (e) {}
        } else {
          vacationDatesEl.text = '';
          try { vacationDatesEl.collapse(); } catch (e) {}
        }
      }

      // Populate packageContainer with title, nights, and specialty tours before search.
      if (nights > 0) {
        try {
          const pkgDetails = await getPackageDetailsByNights(nights);
          const pkgName2 = tryFind('packageName2');
          const nightsTextEl = tryFind('nightsText');
          const specialtyToursEl = tryFind('specialtyTours');
          const pkgContainer = tryFind('packageContainer');

          if (pkgName2) { pkgName2.text = pkgDetails.title || ''; }
          if (nightsTextEl) { nightsTextEl.text = String(nights) + ' night' + (nights === 1 ? '' : 's'); }
          if (specialtyToursEl) { specialtyToursEl.text = pkgDetails.specialtyTours || ''; }

          if (pkgContainer) {
            if (pkgDetails.title || pkgDetails.specialtyTours) {
              try { pkgContainer.show(); } catch (e) {}
              try { pkgContainer.expand(); } catch (e) {}
              console.log('>>> packageContainer expanded');
            } else {
              try { pkgContainer.collapse(); } catch (e) {}
            }
          }
        } catch (pkgErr) {
          console.log('>>> package details lookup error:', pkgErr && pkgErr.message || pkgErr);
        }
      }

      const estValue = await ensureBaseRate(nights).then(function () {
        return estimateSearchValue(nights);
      });
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

  if (tryFind('btnSummary')) {
    console.log('>>> btnSummary handler registered');
    const summaryBtn = $w('#btnSummary');
    if (typeof summaryBtn.link === 'string') summaryBtn.link = '';
    summaryBtn.onClick(() => {
      console.log('>>> btnSummary clicked');
      if (_selections.length === 0) {
        safeText('Please select a room below.');
        console.log('>>> Summary blocked: no room selected');
        return;
      }
      const parts = [], first = _selections[0];
      for (let i = 0; i < _selections.length; i++) {
        const s = _selections[i];
        parts.push(s.roomCode + ':' + s.qty + ':' + (s.numGuests || 1) + ':' + (s.roomFee || 0));
      }
      try {
        localStorage.setItem('_wbe_rc', parts.join(','));
        localStorage.setItem('_wbe_ci', first.availableCheckIn || '');
        localStorage.setItem('_wbe_co', first.availableCheckOut || '');
        console.log('>>> STORED rc (summary):', parts.join(','));
      } catch (e) {
        console.log('>>> storage save error (summary):', e.message);
      }
      wixLocation.to(summaryUrl + '?rc=' + encodeURIComponent(parts.join(',')) +
        '&ci=' + encodeURIComponent(first.availableCheckIn) +
        '&co=' + encodeURIComponent(first.availableCheckOut));
    });
  }

  const rep = tryFind('searchResultsRepeater');
  if (rep && typeof rep.onItemReady === 'function') {
    rep.onItemReady(($item, itemData) => {
      if ((itemData.maxQty || 0) <= 0 || itemData.status === 'unavailable') {
        safeItem($item, '#roomName', 'text', (itemData.roomName || itemData.roomCode || '') + ' — Not available for these dates');
        safeItem($item, '#roomPrice', 'text', '');
        safeItem($item, '#roomAvailability', 'text', '');
        safeItem($item, '#numRooms', 'text', '');
        safeItem($item, '#occupancy', 'text', '');
        safeItem($item, '#defaultOccupancy', 'text', '');
        const dd = safeItem($item, '#roomQtyDropdown', null, null);
        if (dd) { dd.options = [{ label: '0', value: '0' }]; dd.value = '0'; try { dd.disable(); } catch (e) {} }
        const guestDdUnavail = safeItem($item, '#numberOfGuests', null, null);
        if (guestDdUnavail) { guestDdUnavail.options = []; try { guestDdUnavail.disable(); } catch (e) {} }
        return;
      }
      safeItem($item, '#roomName', 'text', itemData.roomName || itemData.roomCode || '');
      safeItem($item, '#numRooms', 'text', String(itemData.maxQty || itemData.units || 1));
      safeItem($item, '#roomPrice', 'text', '');
      safeItem($item, '#roomAvailability', 'text',
        itemData.status === 'full' ? 'Available for your full ' + itemData.availableNights + ' nights'
        : 'Available for ' + itemData.availableNights + ' nights (partial)');
      safeItem($item, '#occupancy', 'text', String(itemData.occupancy || 2));
      safeItem($item, '#defaultOccupancy', 'text', String(itemData.baseOccupancy || itemData.occupancy || 2));

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
          try { penthouseFeeTextEl.show(); } catch (e) {}
          try { penthouseFeeTextEl.expand(); } catch (e) {}
        } else {
          try { penthouseFeeTextEl.hide(); } catch (e) {}
          try { penthouseFeeTextEl.collapse(); } catch (e) {}
        }
      }

      if (itemData.mainPhoto) try { $item('#roomThumb').src = itemData.mainPhoto; } catch (e) {}

      try {
        const rowVectorInit = $item('#vectorImage2');
        if (rowVectorInit) { rowVectorInit.hide(); rowVectorInit.collapse(); }
      } catch (e) {}

      const baseOcc = Number(itemData.baseOccupancy || itemData.occupancy || 2);
      const maxOcc = Number(itemData.occupancy || baseOcc);
      const guestOpts = [];
      for (let g = baseOcc; g <= maxOcc; g++) guestOpts.push({ label: String(g), value: String(g) });
      let selectedGuests = baseOcc;
      const guestDd = safeItem($item, '#numberOfGuests', null, null);
      if (guestDd) {
        guestDd.options = guestOpts;
        guestDd.value = String(baseOcc);
        if (typeof guestDd.onChange === 'function') {
          guestDd.onChange((event) => {
            selectedGuests = parseInt(event.target.value || String(baseOcc), 10);
            const qtyDd = safeItem($item, '#roomQtyDropdown', null, null);
            const qty = qtyDd ? parseInt(qtyDd.value || '0', 10) : 0;
            if (qty > 0) {
              setRoomSelection(itemData.roomCode, itemData.roomName || itemData.roomCode, qty, selectedGuests, itemData.availableCheckIn, itemData.availableCheckOut, itemData.roomFee || 0);
            }
          });
        }
      }

      const dd = safeItem($item, '#roomQtyDropdown', null, null);
      if (dd && typeof dd.onChange === 'function') {
        const maxQty = typeof itemData.maxQty === 'number' ? itemData.maxQty : 1;
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
          const qty = parseInt(event.target.value || '1', 10);
          const numGuests = typeof selectedGuests === 'number' ? selectedGuests : baseOcc;
          const rowVector = safeItem($item, '#vectorImage2', null, null);
          if (qty > 0) {
            setRoomSelection(itemData.roomCode, itemData.roomName || itemData.roomCode, qty, numGuests, itemData.availableCheckIn, itemData.availableCheckOut, itemData.roomFee || 0);
            if (rowVector) {
              try { rowVector.show(); } catch (e) {}
              try { rowVector.expand(); } catch (e) {}
            }
          } else {
            removeRoomSelection(itemData.roomCode);
            if (rowVector) {
              try { rowVector.hide(); } catch (e) {}
              try { rowVector.collapse(); } catch (e) {}
            }
          }

          // Directly force container and btnSummary visibility based on current selections.
          const summaryBtn = tryFind('btnSummary');
          if (summaryBtn) {
            if (_selections.length > 0) {
              try { summaryBtn.show(); } catch (e) {}
              try { summaryBtn.expand(); } catch (e) {}
              console.log('>>> btnSummary forced visible', _selections.length);
            } else {
              try { summaryBtn.hide(); } catch (e) {}
              try { summaryBtn.collapse(); } catch (e) {}
              console.log('>>> btnSummary hidden');
            }
          } else {
            console.log('>>> btnSummary element not found');
          }

          const selectedContainer = tryFind('selectedRoomsContainer');
          if (selectedContainer) {
            if (_selections.length > 0) {
              try { selectedContainer.show(); } catch (e) {}
              console.log('>>> selectedRoomsContainer forced visible (text element)');
            } else {
              try { selectedContainer.hide(); } catch (e) {}
            }
          }
        });
      }
    });
  }

  const vacationDatesStart = tryFind('vacationDates');
  if (vacationDatesStart) { try { vacationDatesStart.collapse(); } catch (e) {} }

  const panel = tryFind('selectionPanel');
  if (panel) panel.collapse();
  const containerStart = tryFind('selectedRoomsContainer');
  if (containerStart) { try { containerStart.hide(); } catch (e) {} }
  const repStart = tryFind('searchResultsRepeater');
  if (repStart) { try { repStart.collapse(); } catch (e) {} }
  const btnSummaryStart = tryFind('btnSummary');
  if (btnSummaryStart) { try { btnSummaryStart.collapse(); } catch (e) {} }
  const boxStart = tryFind('box3');
  if (boxStart) { try { boxStart.collapse(); } catch (e) {} }
  loadMessages();
});

async function loadMessages() {
  try {
    const msgs = await getActiveMessages('search');
    const el = tryFind('messagesContainer');
    if (!el) return;
    if (msgs.length === 0) el.collapse();
    else { el.expand(); el.text = msgs.map((m) => m.title || '').join('; '); }
  } catch (e) {}
}

// Value estimate for audience tiering: 2 guests at the per-person package rate.
async function ensureBaseRate(nights) {
  if (_cachedBaseRate || !nights) return;
  try { _cachedBaseRate = Number(await getPackageBaseRate(nights)) || 0; } catch (e) {}
}

function estimateSearchValue(nights) {
  if (!nights || !_cachedBaseRate) return 0;
  return Math.round(_cachedBaseRate * nights * 2 * 100) / 100;
}

async function searchHandler() {
  const gallery = tryFind('hotelRoomPhotos');
  if (gallery && typeof gallery.collapse === 'function') gallery.collapse();

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

  const ciDate = parseDate(ci), coDate = parseDate(co);
  if (!ciDate || !coDate) { safeText('Please select check-in and check-out dates.'); return; }
  if (ciDate >= coDate) { safeText('Check-in date must be before the Check-out date.'); return; }

  const computedNights = Math.round((coDate.getTime() - ciDate.getTime()) / 86400000);
  _summaryNights = computedNights;
  await ensureBaseRate(computedNights);

  clearSelections(true);
  safeText('Searching...');

  try {
    const res = await searchAvailability(ciDate, coDate);
    console.log('>>> [WBE-SEARCH] raw results:', JSON.stringify(res));
    if (!res.ok) { safeText(res.error); return; }

    const rep = tryFind('searchResultsRepeater');
    if (!rep) { safeText('Found ' + res.results.length + ' result(s) but no repeater to display them.'); return; }
    if (res.results.length === 0) {
      rep.data = [];
      clearSelections(true);
      const box3 = tryFind('box3');
      if (box3) { try { box3.collapse(); } catch (e) {} }
      const panel = tryFind('selectionPanel');
      if (panel) { try { panel.collapse(); } catch (e) {} }
      const container = tryFind('selectedRoomsContainer');
      if (container) { try { container.hide(); } catch (e) {} }
        safeText('No rooms are available for the dates entered. Checking nearby dates...');
      trackSearchNoResults({ nights: res.requestedNights, checkIn: ciDate ? ciDate.toISOString().slice(0, 10) : undefined });
      showAlternateDates(ciDate, coDate);
      return;
    }
    hideAlternateDates();

    updateSelectionPanel();

    const repData = [];
    const availableData = [];
    for (let i = 0; i < res.results.length; i++) {
      const item = res.results[i];
      item._id = 'room_' + i;
      repData.push(item);
      if ((item.maxQty || 0) > 0 && item.status !== 'unavailable') availableData.push(item);
      trackRoomView({ roomCode: item.roomCode, nights: res.requestedNights });
    }
    if (availableData.length === 0) {
      rep.data = repData;
      clearSelections(true);
      updateSelectionPanel();
      try { rep.expand(); } catch (e) {}
      const box3 = tryFind('box3');
      if (box3) { try { box3.collapse(); } catch (e) {} }
      const selPanel = tryFind('selectionPanel');
      if (selPanel) { try { selPanel.collapse(); } catch (e) {} }
      const container = tryFind('selectedRoomsContainer');
      if (container) { try { container.hide(); } catch (e) {} }
        safeText('No rooms are available for the dates entered. Checking nearby dates...');
      trackSearchNoResults({ nights: res.requestedNights, checkIn: ciDate ? ciDate.toISOString().slice(0, 10) : undefined });
      showAlternateDates(ciDate, coDate);
      return;
    }
    if (rep) { try { rep.show(); } catch (e) {} try { rep.expand(); } catch (e) {} }
    rep.data = repData;
    loadPackageInfo(res.requestedNights);
    safeText('Found ' + res.results.length + ' result' + (res.results.length === 1 ? '' : 's') + ' for ' + res.requestedNights + ' nights.');
  } catch (e) { safeText('Error: ' + e.message); }
}

async function loadPackageInfo(nights) {
  if (!nights || nights <= 0) { console.log('>>> loadPackageInfo: invalid nights'); hidePackageInfo(); return; }
  try {
    console.log('>>> loadPackageInfo: fetching package for', nights, 'nights');
    const pkg = await getPackageAmenities(nights);
    console.log('>>> loadPackageInfo response:', pkg);
    const pkgNameEl = $w('#packageName');
    const pkgAmenEl = $w('#packageAmenities');
    const title = pkg.title || '';
    if (title) {
      pkgNameEl.text = title;
      pkgNameEl.expand();
      console.log('>>> packageName set to:', title);
    } else {
      pkgNameEl.collapse();
      console.log('>>> packageName collapsed (no title)');
    }
    if (pkg && pkg.includedAmenities) {
      pkgAmenEl.text = pkg.includedAmenities;
      pkgAmenEl.expand();
      console.log('>>> packageAmenities set to:', pkg.includedAmenities.substring(0, 50) + '...');
    } else {
      pkgAmenEl.collapse();
      console.log('>>> packageAmenities collapsed (no amenities)');
    }
  } catch (e) { console.error('>>> loadPackageInfo error:', e.message); hidePackageInfo(); }
}

function hidePackageInfo() {
  try { $w('#packageName').collapse(); } catch (e) {}
  try { $w('#packageAmenities').collapse(); } catch (e) {}
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  if (typeof v === 'number') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  return null;
}

function safeText(txt) {
  try {
    const el = tryFind('statusText');
    if (!el) { console.log('>>> safeText: statusText element not found'); return; }
    if (typeof el.expand === 'function') el.expand();
    if (typeof el.show === 'function') el.show();
    el.text = txt;
    console.log('>>> safeText:', txt);
  } catch (e) { console.log('>>> safeText error:', e.message); }
}

async function showAlternateDates(ciDate, coDate) {
  try {
    const res = await suggestAlternateDates(ciDate, coDate);
    const sug = (res && res.suggestions) || [];
    const el = tryFind('statusText');
    if (!el) return;

    if (sug.length === 0) {
      el.html = '<span>No rooms available within 30 days of your dates. Please contact us or try a shorter stay.</span>';
      if (typeof el.expand === 'function') el.expand();
      if (typeof el.show === 'function') el.show();
      return;
    }

    const links = sug.map(function (s) {
      const url = buildAltUrl(s.checkIn, s.checkOut);
      return '<a href="' + url + '">' + s.label + '</a>';
    }).join(' &middot; ');
    el.html = '<span>No rooms for those dates. Try: ' + links + '</span>';
    if (typeof el.expand === 'function') el.expand();
    if (typeof el.show === 'function') el.show();
  } catch (e) {
    console.error('>>> showAlternateDates error:', e && e.message || e);
    safeText('No rooms are available for the dates entered.');
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

