import { getActiveMessages } from 'backend/messages';
import { searchAvailability, suggestAlternateDates } from 'backend/search';
import { getPackageAmenities, getPackageBaseRate } from 'backend/packages';
import { trackBeginBooking, captureClickIds, trackViewBookingSearch, trackRoomView, trackSearchNoResults } from 'public/tracking';
import wixLocation from 'wix-location';

let _selections = [];

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
  if (!found && qty > 0) next.push({ roomCode, roomName, qty, numGuests, availableCheckIn, availableCheckOut });
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
  const btnContinue = tryFind('btnContinueToSummary');
  const box3 = tryFind('box3');
  if (!panel || !container) return;
  if (_selections.length === 0) {
    panel.collapse();
    try { container.collapse(); } catch (e) {}
    if (btnContinue) { try { btnContinue.collapse(); } catch (e) {} }
    if (box3) { try { box3.collapse(); } catch (e) {} }
    container.text = '';
    return;
  }
  if (box3) { try { box3.show(); } catch (e) {} try { box3.expand(); } catch (e) {} }
  panel.expand();
  if (typeof container.show === 'function') { try { container.show(); } catch (e) {} }
  if (typeof container.expand === 'function') { try { container.expand(); } catch (e) {} }
  if (btnContinue) { try { btnContinue.show(); } catch (e) {} try { btnContinue.expand(); } catch (e) {} }
  let total = 0, totalGuests = 0, lines = [];
  for (let i = 0; i < _selections.length; i++) {
    const s = _selections[i];
    const guests = (s.numGuests || 1) * s.qty;
    lines.push((s.roomName || s.roomCode) + ' (Qty: ' + s.qty + ', Guests: ' + guests + ')');
    total += s.qty;
    totalGuests += guests;
  }
  lines.push('Total rooms: ' + total);
  lines.push('Total guests: ' + totalGuests);
  container.text = lines.join('\n');
  console.log('>>> selection panel updated:', container.text);
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

$w.onReady(function () {
  captureClickIds();
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
  if (tryFind('btnContinueToSummary')) {
    const btn = $w('#btnContinueToSummary');
    if (typeof btn.link === 'string') btn.link = '';
    btn.onClick(() => {
      if (_selections.length === 0) {
        safeText('Please select a room below.');
        console.log('>>> Continue blocked: no room selected');
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
        console.log('>>> STORED rc:', parts.join(','));
      } catch (e) {
        console.log('>>> storage save error:', e.message);
      }
      wixLocation.to('/booking-summary?rc=' + encodeURIComponent(parts.join(',')) +
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
      safeItem($item, '#roomPrice', 'text', '');
      safeItem($item, '#roomAvailability', 'text',
        itemData.status === 'full' ? 'Available for your full ' + itemData.availableNights + ' nights'
        : 'Available for ' + itemData.availableNights + ' nights (partial)');
      safeItem($item, '#numRooms', 'text', String(itemData.units || 1));
      safeItem($item, '#occupancy', 'text', String(itemData.occupancy || 2));
      safeItem($item, '#defaultOccupancy', 'text', String(itemData.baseOccupancy || itemData.occupancy || 2));
      if (itemData.mainPhoto) try { $item('#roomThumb').src = itemData.mainPhoto; } catch (e) {}

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
          if (qty > 0) {
            setRoomSelection(itemData.roomCode, itemData.roomName || itemData.roomCode, qty, numGuests, itemData.availableCheckIn, itemData.availableCheckOut, itemData.roomFee || 0);
          } else {
            removeRoomSelection(itemData.roomCode);
          }
        });
      }
    });
  }

  const panel = tryFind('selectionPanel');
  if (panel) panel.collapse();
  const containerStart = tryFind('selectedRoomsContainer');
  if (containerStart) { try { containerStart.collapse(); } catch (e) {} }
  const repStart = tryFind('searchResultsRepeater');
  if (repStart) { try { repStart.collapse(); } catch (e) {} }
  const btnStart = tryFind('btnContinueToSummary');
  if (btnStart) { try { btnStart.collapse(); } catch (e) {} }
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
// Fetched once and cached; returns 0 when unknown (Google ignores 0-value events
// for value-based audiences but still counts them for membership).
let _cachedBaseRate = 0;

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
      if (container) { try { container.collapse(); } catch (e) {} }
      const btnContinue = tryFind('btnContinueToSummary');
      if (btnContinue) { try { btnContinue.collapse(); } catch (e) {} }
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
      if (container) { try { container.collapse(); } catch (e) {} }
      const btnContinue = tryFind('btnContinueToSummary');
      if (btnContinue) { try { btnContinue.collapse(); } catch (e) {} }
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

