import { getActiveMessages } from 'backend/messages';
import { searchAvailability } from 'backend/search';
import { getPackageAmenities } from 'backend/packages';
import { inspectAvailabilityData } from 'backend/diagnostics.web';
import wixLocation from 'wix-location';

let _selections = [];

function clearSelections(silent) {
  _selections = [];
  if (!silent) updateSelectionPanel();
}

function setRoomQty(roomCode, roomName, baseRate, qty, availableCheckIn, availableCheckOut) {
  let next = [], found = false;
  for (let i = 0; i < _selections.length; i++) {
    if (_selections[i].roomCode === roomCode) {
      found = true;
      if (qty > 0) next.push({ roomCode, roomName, baseRate, qty, availableCheckIn, availableCheckOut });
    } else next.push(_selections[i]);
  }
  if (!found && qty > 0) next.push({ roomCode, roomName, baseRate, qty, availableCheckIn, availableCheckOut });
  _selections = next;
  updateSelectionPanel();
}

function updateSelectionPanel() {
  const panel = tryFind('selectionPanel'), container = tryFind('selectedRoomsContainer');
  if (!panel || !container) return;
  if (_selections.length === 0) { panel.collapse(); container.text = ''; return; }
  panel.expand();
  if (typeof container.show === 'function') { try { container.show(); } catch (e) {} }
  if (typeof container.expand === 'function') { try { container.expand(); } catch (e) {} }
  let total = 0, lines = [];
  for (let i = 0; i < _selections.length; i++) {
    const s = _selections[i];
    lines.push((s.roomName || s.roomCode) + ' (Qty: ' + s.qty + ')');
    total += s.qty;
  }
  lines.push('Total rooms: ' + total);
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
  if (tryFind('btnSearchRooms')) $w('#btnSearchRooms').onClick(searchHandler);
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
        parts.push(s.roomCode + ':' + s.qty + ':' + (s.baseRate || 0));
      }
      try {
        sessionStorage.setItem('_wbe_rc', parts.join(','));
        sessionStorage.setItem('_wbe_ci', first.availableCheckIn || '');
        sessionStorage.setItem('_wbe_co', first.availableCheckOut || '');
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
      safeItem($item, '#roomName', 'text', itemData.roomName || itemData.roomCode || '');
      safeItem($item, '#roomPrice', 'text', '$' + (itemData.baseRate || 0) + ' / night (' + itemData.availableNights + ' nights)');
      safeItem($item, '#roomAvailability', 'text',
        itemData.status === 'full' ? 'Available for your full ' + itemData.availableNights + ' nights'
        : 'Available for ' + itemData.availableNights + ' nights (partial)');
      safeItem($item, '#numRooms', 'text', String(itemData.units || 1));
      safeItem($item, '#occupancy', 'text', String(itemData.occupancy || 2));
      safeItem($item, '#defaultOccupancy', 'text', String(itemData.baseOccupancy || itemData.occupancy || 2));
      if (itemData.mainPhoto) try { $item('#roomThumb').src = itemData.mainPhoto; } catch (e) {}
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
          setRoomQty(itemData.roomCode, itemData.roomName || itemData.roomCode, itemData.baseRate || 0, qty, itemData.availableCheckIn, itemData.availableCheckOut);
        });
      }
    });
  }

  const panel = tryFind('selectionPanel');
  if (panel) panel.collapse();
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

    // Diagnostic: inspect raw availability data
    try {
      const diag = await inspectAvailabilityData(ciDate, coDate);
      console.log('>>> [WBE-SEARCH] raw data:', JSON.stringify(diag));
    } catch (diagErr) {
      console.log('>>> [WBE-SEARCH] diag error:', diagErr.message || diagErr);
    }

    if (!res.ok) { safeText(res.error); return; }

    const rep = tryFind('searchResultsRepeater');
    if (!rep) { safeText('Found ' + res.results.length + ' result(s) but no repeater to display them.'); return; }
    if (res.results.length === 0) {
      rep.data = [];
      safeText('No rooms are available for the dates entered.');
      clearSelections(true);
      const box3 = tryFind('box3');
      if (box3) { try { box3.collapse(); } catch (e) {} }
      const panel = tryFind('selectionPanel');
      if (panel) { try { panel.collapse(); } catch (e) {} }
      const container = tryFind('selectedRoomsContainer');
      if (container) { try { container.collapse(); } catch (e) {} }
      const btnContinue = tryFind('btnContinueToSummary');
      if (btnContinue) { try { btnContinue.collapse(); } catch (e) {} }
      return;
    }

    const box3 = tryFind('box3');
    if (box3) { try { box3.show(); } catch (e) {} try { box3.expand(); } catch (e) {} }
    const selPanel = tryFind('selectionPanel');
    if (selPanel) { try { selPanel.show(); } catch (e) {} try { selPanel.expand(); } catch (e) {} }
    const container = tryFind('selectedRoomsContainer');
    if (container) { try { container.show(); } catch (e) {} try { container.expand(); } catch (e) {} }
    const btnContinue = tryFind('btnContinueToSummary');
    if (btnContinue) { try { btnContinue.show(); } catch (e) {} try { btnContinue.expand(); } catch (e) {} }

    const repData = [];
    for (let i = 0; i < res.results.length; i++) {
      const item = res.results[i];
      item._id = 'room_' + i;
      repData.push(item);
    }
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

