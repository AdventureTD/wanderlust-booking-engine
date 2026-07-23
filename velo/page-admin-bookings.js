// Page code for /admin-bookings (member-restricted admin console)
import wixLocation from 'wix-location';
import {
  adminListBookings,
  adminGetBooking,
  adminUpdateBooking,
  adminCancelBooking,
  adminRecordPayment,
  adminRecordRefund,
} from 'backend/adminConsole.web';

let _currentBooking = null;
let _currentRooms = [];
let _currentPayments = [];
let _currentTotals = null;

function tryFind(id) { try { return $w('#' + id); } catch (e) { return null; } }
function safeSet(el, prop, val) { try { el[prop] = val; } catch (e) {} }
function txt(id, v) { const el = tryFind(id); if (el) safeSet(el, 'text', v); }
function val(id) { const el = tryFind(id); return el && el.value !== undefined ? el.value : ''; }
function setVal(id, v) { const el = tryFind(id); if (el) safeSet(el, 'value', v); }
function show(id) { const el = tryFind(id); if (el) { try { el.expand(); } catch (e) {} try { el.show(); } catch (e) {} } }
function hide(id) { const el = tryFind(id); if (el) { try { el.collapse(); } catch (e) {} try { el.hide(); } catch (e) {} } }
function money(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function dstr(d) {
  if (!d) return '';
  try { const dt = d instanceof Date ? d : new Date(d); if (isNaN(dt.getTime())) return String(d); return dt.toISOString().slice(0, 10); } catch (e) { return String(d); }
}

$w.onReady(function () {
  wireFilters();
  wireDetailPanel();
  switchTab('details');
  refreshList();
});

// ---------------- FILTER / LIST ----------------

function wireFilters() {
  const btn = tryFind('btnSearch');
  if (btn && typeof btn.onClick === 'function') btn.onClick(refreshList);
  const si = tryFind('searchGuestInput');
  if (si && typeof si.onKeyPress === 'function') {
    si.onKeyPress(function (e) { if (e.key === 'Enter') refreshList(); });
  }
  const sd = tryFind('sortDropdown');
  if (sd && typeof sd.onChange === 'function') sd.onChange(refreshList);
  const st = tryFind('statusDropdown');
  if (st && typeof st.onChange === 'function') st.onChange(refreshList);
}

function readFilters() {
  const sortRaw = String(val('sortDropdown') || 'checkIn');
  let sortBy = 'checkIn', sortDir = 'asc';
  if (sortRaw.indexOf('desc') >= 0) { sortDir = 'desc'; sortBy = sortRaw.replace('_desc', ''); }
  else { sortBy = sortRaw.replace('_asc', ''); }
  return {
    search: String(val('searchGuestInput') || '').trim(),
    status: val('statusDropdown') || 'All',
    dateFrom: val('dateFrom') ? dstr(val('dateFrom')) : '',
    dateTo: val('dateTo') ? dstr(val('dateTo')) : '',
    sortBy: sortBy,
    sortDir: sortDir,
    limit: 100,
  };
}

async function refreshList() {
  const rep = tryFind('bookingsRepeater');
  txt('listStatusText', 'Loading...');
  try {
    const res = await adminListBookings(readFilters());
    if (!res.ok) { txt('listStatusText', 'Error: ' + (res.error || 'unknown')); return; }
    txt('listStatusText', res.items.length + ' booking(s)');
    if (!rep) return;

    rep.onItemReady(($item, itemData) => {
      const s = itemData.summary || itemData;
      safeItemText($item, '#rowBookingNumber', s.bookingNumber || '');
      safeItemText($item, '#rowGuestName', s.guestName || '');
      safeItemText($item, '#rowDates', dstr(s.checkIn) + ' – ' + dstr(s.checkOut));
      safeItemText($item, '#rowTotal', money(s.grandTotal));
      safeItemText($item, '#rowStatus', s.status || '');
      const btn = safeItemFind($item, '#btnViewBooking');
      if (btn && typeof btn.onClick === 'function') {
        btn.onClick(function () { openDetail(s.bookingNumber); });
      }
    });

    rep.data = res.items.map(function (s, i) {
      return { _id: s._id || ('row' + i), summary: s };
    });
    show('bookingsRepeater');
  } catch (e) {
    txt('listStatusText', 'Error: ' + (e && e.message || e));
  }
}

function safeItemFind($item, sel) { try { return $item(sel); } catch (e) { return null; } }
function safeItemText($item, sel, v) { const el = safeItemFind($item, sel); if (el) safeSet(el, 'text', v); }

// ---------------- DETAIL PANEL ----------------

function wireDetailPanel() {
  const closeBtn = tryFind('btnCloseDetail');
  if (closeBtn && typeof closeBtn.onClick === 'function') {
    closeBtn.onClick(function () { hide('detailPanel'); });
  }
  const saveBtn = tryFind('btnSaveChanges');
  if (saveBtn && typeof saveBtn.onClick === 'function') saveBtn.onClick(saveChanges);
  const payBtn = tryFind('btnRecordPayment');
  if (payBtn && typeof payBtn.onClick === 'function') payBtn.onClick(recordPayment);
  const refBtn = tryFind('btnRecordRefund');
  if (refBtn && typeof refBtn.onClick === 'function') refBtn.onClick(recordRefund);
  const cancelBtn = tryFind('btnCancelBooking');
  if (cancelBtn && typeof cancelBtn.onClick === 'function') cancelBtn.onClick(cancelBooking);

  // Tab navigation
  const tabMap = { btnDetails: 'details', btnPayments: 'payments', btnCancel: 'cancel' };
  Object.keys(tabMap).forEach(function (id) {
    const btn = tryFind(id);
    const tab = tabMap[id];
    if (btn && typeof btn.onClick === 'function') {
      btn.onClick(function () { switchTab(tab); });
    }
  });
}

function switchTab(tabName) {
  if (tabName === 'details') {
    show('detailsContainer');
    hide('paymentsContainer');
    hide('cancelContainer');
  } else if (tabName === 'payments') {
    hide('detailsContainer');
    show('paymentsContainer');
    hide('cancelContainer');
  } else if (tabName === 'cancel') {
    hide('detailsContainer');
    hide('paymentsContainer');
    show('cancelContainer');
  }
  setButtonActive('btnDetails', tabName === 'details');
  setButtonActive('btnPayments', tabName === 'payments');
  setButtonActive('btnCancel', tabName === 'cancel');
}

function setButtonActive(id, active) {
  const btn = tryFind(id);
  if (!btn || !btn.style) return;
  try {
    btn.style.borderColor = active ? '#2E5C8A' : 'transparent';
    btn.style.borderWidth = active ? '2px' : '0px';
  } catch (e) {}
}

async function openDetail(bookingNumber) {
  txt('detailStatusText', 'Loading ' + bookingNumber + '...');
  switchTab('details');
  show('detailPanel');
  try {
    const res = await adminGetBooking(bookingNumber);
    if (!res.ok) { txt('detailStatusText', 'Error: ' + (res.error || 'unknown')); return; }
    _currentBooking = res.summary;
    _currentRooms = res.rooms || [];
    _currentPayments = res.payments || [];
    _currentTotals = res.totals || null;
    renderDetail();
    txt('detailStatusText', '');
  } catch (e) {
    txt('detailStatusText', 'Error: ' + (e && e.message || e));
  }
}

function renderDetail() {
  const s = _currentBooking;
  if (!s) return;
  txt('detailTitle', 'Booking ' + (s.bookingNumber || ''));

  // Details tab
  setVal('inputGuestName', s.guestName || '');
  setVal('inputGuestEmail', s.guestEmail || '');
  setVal('inputGuestPhone', s.guestPhone || '');
  setVal('inputNumGuests', String(firstRoomGuests()));
  setVal('dateCheckIn', s.checkIn ? new Date(s.checkIn) : null);
  setVal('dateCheckOut', s.checkOut ? new Date(s.checkOut) : null);
  setVal('inputGrandTotal', String(s.grandTotal || 0));
  setVal('inputPromoCode', s.promoCode || '');
  setVal('editStatusDropdown', s.status || 'confirmed');

  // Payments tab
  const t = _currentTotals || { grandTotal: 0, totalPaid: 0, totalRefunded: 0, balance: 0 };
  txt('invoiceTotalText', money(t.grandTotal));
  txt('totalPaidText', money(t.totalPaid));
  txt('totalRefundedText', money(t.totalRefunded));
  txt('balanceText', money(t.balance));

  const rep = tryFind('paymentsRepeater');
  if (rep) {
    rep.onItemReady(($item, itemData) => {
      const p = itemData.payment || itemData;
      safeItemText($item, '#payRowId', p.paymentId || '');
      safeItemText($item, '#payRowDate', dstr(p.datePaid));
      const sign = p.paymentAmount < 0 ? '-' : '+';
      safeItemText($item, '#payRowAmount', sign + money(Math.abs(p.paymentAmount)));
      safeItemText($item, '#payRowMethod', p.paymentMethod || '');
      safeItemText($item, '#payRowNote', p.note || '');
    });
    rep.data = _currentPayments.map(function (p, i) {
      return { _id: p.paymentId || ('p' + i), payment: p };
    });
  }

  // Danger zone — show balance reminder
  txt('cancelBalanceText', 'Current balance: ' + money(t.balance) +
    ' (paid ' + money(t.totalPaid) + ', refunded ' + money(t.totalRefunded) + ')');
}

function firstRoomGuests() {
  return _currentRooms.length ? (_currentRooms[0].guests || 1) : 1;
}

// ---------------- ACTIONS ----------------

async function saveChanges() {
  if (!_currentBooking) return;
  txt('saveStatusText', 'Saving...');
  try {
    const changes = {
      guestName: String(val('inputGuestName') || ''),
      guestEmail: String(val('inputGuestEmail') || ''),
      guestPhone: String(val('inputGuestPhone') || ''),
      numGuests: Number(val('inputNumGuests')) || undefined,
      checkIn: val('dateCheckIn') ? dstr(val('dateCheckIn')) : undefined,
      checkOut: val('dateCheckOut') ? dstr(val('dateCheckOut')) : undefined,
      grandTotal: Number(val('inputGrandTotal')) || undefined,
      promoCode: String(val('inputPromoCode') || ''),
      status: val('editStatusDropdown') || undefined,
    };
    const res = await adminUpdateBooking(_currentBooking.bookingNumber, changes);
    if (!res.ok) { txt('saveStatusText', 'Error: ' + (res.error || 'unknown')); return; }
    txt('saveStatusText', 'Saved.');
    await openDetail(_currentBooking.bookingNumber);
    refreshList();
  } catch (e) {
    txt('saveStatusText', 'Error: ' + (e && e.message || e));
  }
}

async function recordPayment() {
  if (!_currentBooking) return;
  txt('paymentStatusText', 'Recording payment...');
  try {
    const res = await adminRecordPayment({
      bookingNumber: _currentBooking.bookingNumber,
      amount: Number(val('inputPayAmount')),
      datePaid: val('datePaid') ? dstr(val('datePaid')) : undefined,
      paymentMethod: val('payMethodDropdown') || '',
      note: String(val('inputPayNote') || ''),
    });
    if (!res.ok) { txt('paymentStatusText', 'Error: ' + (res.error || 'unknown')); return; }
    txt('paymentStatusText', (res.warning ? 'Warning: ' + res.warning + ' ' : '') + 'Payment recorded (' + res.paymentId + ').');
    setVal('inputPayAmount', '');
    setVal('inputPayNote', '');
    await openDetail(_currentBooking.bookingNumber);
  } catch (e) {
    txt('paymentStatusText', 'Error: ' + (e && e.message || e));
  }
}

async function recordRefund() {
  if (!_currentBooking) return;
  txt('paymentStatusText', 'Recording refund...');
  try {
    const res = await adminRecordRefund({
      bookingNumber: _currentBooking.bookingNumber,
      amount: Number(val('inputRefundAmount')),
      datePaid: val('dateRefund') ? dstr(val('dateRefund')) : undefined,
      paymentMethod: val('refundMethodDropdown') || '',
      note: String(val('inputRefundNote') || ''),
    });
    if (!res.ok) { txt('paymentStatusText', 'Error: ' + (res.error || 'unknown')); return; }
    txt('paymentStatusText', (res.warning ? 'Warning: ' + res.warning + ' ' : '') + 'Refund recorded (' + res.paymentId + ').');
    setVal('inputRefundAmount', '');
    setVal('inputRefundNote', '');
    await openDetail(_currentBooking.bookingNumber);
  } catch (e) {
    txt('paymentStatusText', 'Error: ' + (e && e.message || e));
  }
}

async function cancelBooking() {
  if (!_currentBooking) return;
  const reason = String(val('inputCancelReason') || '');
  txt('cancelStatusText', 'Cancelling...');
  try {
    const res = await adminCancelBooking(_currentBooking.bookingNumber, reason);
    if (!res.ok) { txt('cancelStatusText', 'Error: ' + (res.error || 'unknown')); return; }
    let msg = 'Cancelled.';
    if (res.adsRetraction && res.adsRetraction.attempted) {
      msg += res.adsRetraction.result && res.adsRetraction.result.ok
        ? ' Google Ads conversion retracted.'
        : ' Google Ads retraction FAILED: ' + JSON.stringify(res.adsRetraction.result || {});
    }
    if (res.email && res.email.attempted) {
      msg += res.email.ok ? ' Cancellation email sent.' : ' Email FAILED: ' + (res.email.error || res.email.status);
    }
    txt('cancelStatusText', msg);
    await openDetail(_currentBooking.bookingNumber);
    refreshList();
  } catch (e) {
    txt('cancelStatusText', 'Error: ' + (e && e.message || e));
  }
}
