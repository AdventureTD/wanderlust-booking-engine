import wixLocation from 'wix-location';
import { getAllSettings } from 'backend/settings';
import { getRoomNames } from 'backend/rooms';
import { getRoomDisplayName } from 'backend/wbeConfig';
function fmtCurrency(n) { return Number(n || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }

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

function safeText(id, txt) { try { $w('#' + id).text = txt; } catch (e) {} }
function safeCollapse(id) { try { $w('#' + id).collapse(); } catch (e) {} }
function safeExpand(id) { try { $w('#' + id).expand(); } catch (e) {} }

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

$w.onReady(function () {
  initSummary().catch(function (e) { console.log('>>> init error:', e.message); });
});

async function initSummary() {
  let rcParam = getParam('rc');
  let cis = getParam('ci');
  let cos = getParam('co');

  console.log('>>> SUMMARY: url query rc=', rcParam, 'ci=', cis, 'co=', cos);

  if (!rcParam) {
    try {
      rcParam = sessionStorage.getItem('_wbe_rc') || localStorage.getItem('_wbe_rc');
      cis = cis || sessionStorage.getItem('_wbe_ci') || localStorage.getItem('_wbe_ci');
      cos = cos || sessionStorage.getItem('_wbe_co') || localStorage.getItem('_wbe_co');
      console.log('>>> SUMMARY: loaded from storage:', rcParam, cis, cos);
    } catch (e) {
      console.log('>>> SUMMARY: storage read error:', e.message);
    }
  }

  if (!rcParam && isPreviewMode()) {
    console.log('>>> SUMMARY: using PREVIEW fallback');
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

    repData.push({ _id: 'sum_' + i + '_' + _renderCount, roomCode: r.roomCode, roomName: displayName, qty: r.qty, baseRate: rate, roomTotal: roomTotal });
  }

  const accNet = subtotalNet * accommodationShare;
  const advNet = subtotalNet * (1 - accommodationShare);
  const vatAccommodation = accNet * taxRateAccommodation;
  const vatAdventure = advNet * taxRateAdventure;
  const totalVat = vatAccommodation + vatAdventure;
  const grandTotal = subtotalNet + propertyFee + totalVat;

  safeText('accommodationNamesText', names.join(', '));
  safeText('packageSubTotal', '$' + fmtCurrency(subtotalNet));
  safeText('subtotalNetText', '$' + fmtCurrency(subtotalNet));
  safeText('vatAccommodationText', '$' + fmtCurrency(vatAccommodation));
  safeText('vatAdventureText', '$' + fmtCurrency(vatAdventure));
  safeText('vatAcc', '$' + fmtCurrency(accNet));
  safeText('vatSer', '$' + fmtCurrency(advNet));
  safeText('totalVatText', '$' + fmtCurrency(totalVat));
  safeText('propertyFeeText', '$' + fmtCurrency(propertyFee));
  safeText('grandTotalText', '$' + fmtCurrency(grandTotal));

  renderRoomRepeater(repData);
}

function initRoomRepeater() {
  if (_roomRepReady) { console.log('>>> initRoomRepeater already ready'); return; }
  let rep;
  try { rep = $w('#summaryRoomsRepeater'); } catch (e) { rep = null; }
  console.log('>>> summaryRoomsRepeater element:', typeof rep, rep ? Object.keys(rep).slice(0, 10) : null);
  if (!rep) { console.log('>>> repeater NOT FOUND'); return; }
  if (typeof rep.onItemReady !== 'function') {
    console.log('>>> repeater found but onItemReady is not a function. Type:', rep.type || 'unknown');
    return;
  }
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
  const btnContinue = (function () { try { return $w('#btnContinue'); } catch (e) { return null; } })();
  if (!btnContinue || typeof btnContinue.onClick !== 'function') return;

  btnContinue.onClick(function () {
    const parts = [];
    for (let i = 0; i < _summaryRooms.length; i++) {
      const r = _summaryRooms[i], g = getGuestCount(i) || r.qty || 1;
      parts.push(r.roomCode + ':' + g + ':' + (r.baseRate || 0));
    }
    try {
      sessionStorage.setItem('_wbe_rc', parts.join(','));
      sessionStorage.setItem('_wbe_ci', _summaryCis || '');
      sessionStorage.setItem('_wbe_co', _summaryCos || '');
    } catch (e) {}
    const targetUrl = '/booking-guest?rc=' + encodeURIComponent(parts.join(',')) +
      '&ci=' + encodeURIComponent(_summaryCis || '') +
      '&co=' + encodeURIComponent(_summaryCos || '');
    console.log('>>> NAVIGATING TO:', targetUrl);
    wixLocation.to(targetUrl);
  });
}

function getGuestCount(idx) {
  const rep = (function () { try { return $w('#summaryRoomsRepeater'); } catch (e) { return null; } })();
  if (!rep || !rep.data) return null;
  const item = rep.data[idx];
  if (!item) return null;
  return _guestCounts[item.roomCode] || item.qty || null;
}
