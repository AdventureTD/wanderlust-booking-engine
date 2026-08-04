import { getActiveMessages } from 'backend/messages';
import { searchAvailability, suggestAlternateDates } from 'backend/search';
import { getPackageAmenities, getPackageBaseRate, getPackageDetailsByNights, packageExistsForNights } from 'backend/packages';
import { getRoomNames } from 'backend/rooms';
import { trackBeginBooking, captureClickIds, trackViewBookingSearch, trackRoomView, trackSearchNoResults, initTracking, setSuspendGoogleAds } from 'public/tracking';
import { getAllSettings } from 'backend/settings';
import wixLocation from 'wix-location';
import wixWindow from 'wix-window-frontend';

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

function showElement(el, name) {
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
function updateSelectionPanel() {
  const panel = tryFind('selectionPanel');
  const container = tryFind('selectedRoomsContainer');
  const btnSummary = tryFind('btnSummary');
  const box3 = tryFind('box3');
  const summaryContainer = tryFind('bookingSummaryContainer');
  const selection = tryFind('selection');
  const transSummary = tryFind('transSummary');
  const jpegBackground = tryFind('jpegBackground');
  console.log('>>> updateSelectionPanel elements:', {
    panel: !!panel,
    container: !!container,
    btnSummary: !!btnSummary,
    box3: !!box3,
    summaryContainer: !!summaryContainer,
    selection: !!selection,
    transSummary: !!transSummary,
    jpegBackground: !!jpegBackground,
    selections: _selections.length
  });

  if (_selections.length === 0) {
    hideElement(panel, 'selectionPanel');
    if (container) { container.text = ''; }
    hideElement(container, 'selectedRoomsContainer');
    hideElement(btnSummary, 'btnSummary');
    hideElement(box3, 'box3');
    hideElement(summaryContainer, 'bookingSummaryContainer');
    hideElement(selection, 'selection');
    hideElement(transSummary, 'transSummary');
    hideElement(jpegBackground, 'jpegBackground');
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
  showElement(btnSummary, 'btnSummary');

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
  // Also compute finalTotal = subTotalBooking + penthouseFee.
  let finalTotal = 0;
  if (summaryContainer) {
    if (_selections.length > 0 && _summaryNights > 0 && _cachedBaseRate > 0) {
      const subTotal = _cachedBaseRate * _summaryNights * totalGuests;
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
    } else {
      if (typeof summaryContainer.collapse === 'function') { try { summaryContainer.collapse(); } catch (e) {} } else if (typeof summaryContainer.hide === 'function') { try { summaryContainer.hide(); } catch (e) {} }
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
        nights = Math.round((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24));
      }
      _summaryNights = nights;

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

  // When check-in date is selected, default check-out to the same date for easier picking.
  const ciPicker = tryFind('datePickerCheckIn');
  const coPicker = tryFind('datePickerCheckOut');
  if (ciPicker && coPicker && typeof ciPicker.onChange === 'function') {
    ciPicker.onChange((event) => {
      const newCheckIn = event.target.value;
      if (!newCheckIn) return;
      // Only override check-out if it's empty or before the new check-in date.
      const currentCo = coPicker.value;
      const ciDate = parseDate(newCheckIn);
      const coDate = currentCo ? parseDate(currentCo) : null;
      if (!coDate || ciDate > coDate) {
        coPicker.value = new Date(ciDate.getFullYear(), ciDate.getMonth(), ciDate.getDate(), 12, 0, 0);
      }
    });
  }

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
      function stripTime(d) {
        if (!d) return '';
        const str = String(d);
        const tIndex = str.indexOf('T');
        return tIndex !== -1 ? str.substring(0, tIndex) : str;
      }
      const ciOnly = stripTime(first.availableCheckIn);
      const coOnly = stripTime(first.availableCheckOut);
      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          localStorage.setItem('_wbe_rc', parts.join(','));
          localStorage.setItem('_wbe_ci', ciOnly);
          localStorage.setItem('_wbe_co', coOnly);
          console.log('>>> STORED rc (summary):', parts.join(','));
        }
      } catch (e) {
        console.log('>>> storage save error (summary):', e && e.message || e);
      }
      wixLocation.to(summaryUrl + '?rc=' + encodeURIComponent(parts.join(',')) +
        '&ci=' + encodeURIComponent(ciOnly) +
        '&co=' + encodeURIComponent(coOnly));
    });
  }

  const rep = tryFind('searchResultsRepeater');
  if (rep && typeof rep.onItemReady === 'function') {
    rep.onItemReady(($item, itemData) => {
      // Repeater item debug log disabled to reduce console noise
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
          const qty = parseInt(event.target.value || '1', 10);
          const numGuests = typeof selectedGuests === 'number' ? selectedGuests : baseOcc;
          const rowVector = safeItem($item, '#vectorImage2', null, null);
          const badgeEl = safeItem($item, '#selectedBadge', null, null);
          if (qty > 0) {
            setRoomSelection(itemData.roomCode, itemData.roomName || itemData.roomCode, qty, numGuests, itemData.availableCheckIn, itemData.availableCheckOut, itemData.roomFee || 0);
            if (rowVector) {
              try { rowVector.show(); } catch (e) {}
              try { rowVector.expand(); } catch (e) {}
            }
            if (badgeEl) { try { badgeEl.show(); } catch (e) {} try { badgeEl.expand(); } catch (e) {} }
          } else {
            removeRoomSelection(itemData.roomCode);
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

  const ciDate = parseDate(ci), coDate = parseDate(co);
  if (!ciDate || !coDate) { hideSearchHeader(); safeText('Please select check-in and check-out dates.'); return; }
  if (ciDate >= coDate) { hideSearchHeader(); safeText('Check-in date must be before the Check-out date.'); return; }

  const computedNights = Math.round((coDate.getTime() - ciDate.getTime()) / 86400000);
  _summaryNights = computedNights;
  await ensureBaseRate(computedNights);

  // Validate that an adventure package is defined for this number of nights.
  const pkgExists = await packageExistsForNights(computedNights);
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
    if (container) { try { container.hide(); } catch (e) {} }
    safeText('No adventure packages exist for that number of nights. Please choose a lower number of nights.');
    return;
  }

  clearSelections(true);
  safeText('Searching...');

  try {
    const res = await searchAvailability(ciDate, coDate);
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
      hideSearchHeader();
      try { rep.expand(); } catch (e) {}
      const box3 = tryFind('box3');
      if (box3) { if (typeof box3.collapse === 'function') { try { box3.collapse(); } catch (e) {} } else if (typeof box3.hide === 'function') { try { box3.hide(); } catch (e) {} } }
      const selPanel = tryFind('selectionPanel');
      if (selPanel) { try { selPanel.collapse(); } catch (e) {} }
      const container = tryFind('selectedRoomsContainer');
      if (container) { try { container.hide(); } catch (e) {} }
        safeText('No rooms are available for the dates entered. Checking nearby dates...');
      trackSearchNoResults({ nights: res.requestedNights, checkIn: ciDate ? ciDate.toISOString().slice(0, 10) : undefined });
      showAlternateDates(ciDate, coDate);
      return;
    }
    showSearchHeader(ciDate, coDate, computedNights);
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

function hideSearchHeader() {
  ['packageSelectionText', 'accommodationText', 'vacationDates', 'packageContainer', 'packageName2', 'nightsText', 'specialtyTours', 'packagePrice']
    .forEach(function (id) {
      const el = tryFind(id);
      if (el) {
        if (typeof el.hide === 'function') { try { el.hide(); } catch (e) {} }
        if (typeof el.collapse === 'function') { try { el.collapse(); } catch (e) {} }
      }
    });
}

function showSearchHeader(ciDate, coDate, nights) {
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
      if (typeof vacationDatesEl.show === 'function') { try { vacationDatesEl.show(); } catch (e) {} }
      if (typeof vacationDatesEl.expand === 'function') { try { vacationDatesEl.expand(); } catch (e) {} }
    }
  }

  if (nights > 0) {
    getPackageDetailsByNights(nights).then(function (pkgDetails) {
      const pkgName2 = tryFind('packageName2');
      const nightsTextEl = tryFind('nightsText');
      const specialtyToursEl = tryFind('specialtyTours');
      const pkgContainer = tryFind('packageContainer');
      if (pkgName2) { pkgName2.text = pkgDetails.title || ''; }
      if (nightsTextEl) { nightsTextEl.text = String(nights) + ' night' + (nights === 1 ? '' : 's'); }
      if (specialtyToursEl) { specialtyToursEl.text = pkgDetails.specialtyTours || ''; }
      if (pkgContainer && (pkgDetails.title || pkgDetails.specialtyTours)) {
        if (typeof pkgContainer.show === 'function') { try { pkgContainer.show(); } catch (e) {} }
        if (typeof pkgContainer.expand === 'function') { try { pkgContainer.expand(); } catch (e) {} }
      }
      [pkgName2, nightsTextEl, specialtyToursEl].forEach(function (el) {
        if (el) {
          if (typeof el.show === 'function') { try { el.show(); } catch (e) {} }
          if (typeof el.expand === 'function') { try { el.expand(); } catch (e) {} }
        }
      });
      const packagePriceEl = tryFind('packagePrice');
      if (packagePriceEl) {
        const baseRate = Number(pkgDetails.baseRate) || 0;
        const packagePrice = baseRate * nights;
        if (packagePrice > 0) {
          packagePriceEl.text = '$' + packagePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (typeof packagePriceEl.show === 'function') { try { packagePriceEl.show(); } catch (e) {} }
          if (typeof packagePriceEl.expand === 'function') { try { packagePriceEl.expand(); } catch (e) {} }
        }
      }
    }).catch(function () {});
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
  try {
    const res = await suggestAlternateDates(ciDate, coDate);
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