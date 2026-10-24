// Page code for /admin-bookings (member-restricted admin console)
import wixLocation from 'wix-location';
import { session } from 'wix-storage-frontend';
import {
  adminListBookings,
  adminGetBooking,
  adminUpdateBooking,
  adminUpdateInvoice,
  adminCancelBooking,
  adminRecordPayment,
  adminRecordRefund,
  adminIssueNewInvoice,
} from 'backend/adminConsole.web';

let _paymentSaveWired = false;
let _paymentLegacyWired = false;
let _currentBooking = null;
let _detailRevision = 0;
let _cancelBusy = false;
let _cancelConfirmation = null;
let _currentRooms = [];
let _currentPayments = [];
let _currentTotals = null;
let _currentInvoices = [];
let _currentActiveInvoice = null;

function tryFind(id) { try { return $w('#' + id); } catch (e) { return null; } }
function safeSet(el, prop, val) { try { el[prop] = val; } catch (e) {} }
function txt(id, v) { const el = tryFind(id); if (el) safeSet(el, 'text', v); }
function val(id) { const el = tryFind(id); return el && el.value !== undefined ? el.value : ''; }
function setVal(id, v) { const el = tryFind(id); if (el) safeSet(el, 'value', v); }
function show(id) { const el = tryFind(id); if (el) { try { el.expand(); } catch (e) {} try { el.show(); } catch (e) {} } }
function hide(id) { const el = tryFind(id); if (el) { try { el.collapse(); } catch (e) {} try { el.hide(); } catch (e) {} } }
function money(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtNum(n) { return String(Number(n || 0).toFixed(2)); }
function dstr(d) {
  if (!d) return '';
  try { const dt = d instanceof Date ? d : new Date(d); if (isNaN(dt.getTime())) return String(d); return dt.toISOString().slice(0, 10); } catch (e) { return String(d); }
}

$w.onReady(function () {
  wireFilters();
  wireDetailPanel();
  wireBookingsRepeater();
  switchTab('details');
  refreshList();
});

// ---------------- FILTER / LIST ----------------

function wireFilters() {
  console.log('[WBE-ADMIN] wireFilters start');

  const btn = tryFind('btnSearch');
  console.log('[WBE-ADMIN] btnSearch found:', !!btn);
  if (btn && typeof btn.onClick === 'function') {
    btn.onClick(function () { console.log('[WBE-ADMIN] btnSearch clicked'); refreshList(); });
  }

  const si = tryFind('searchGuestInput');
  console.log('[WBE-ADMIN] searchGuestInput found:', !!si);
  if (si && typeof si.onKeyPress === 'function') {
    si.onKeyPress(function (e) {
      console.log('[WBE-ADMIN] keypress:', e && e.key);
      if (e && e.key === 'Enter') refreshList();
    });
  }

  const sd = tryFind('sortDropdown');
  console.log('[WBE-ADMIN] sortDropdown found:', !!sd, 'value:', sd && sd.value);
  if (sd && typeof sd.onChange === 'function') {
    sd.onChange(function () { console.log('[WBE-ADMIN] sortDropdown changed'); refreshList(); });
  }

  const st = tryFind('statusDropdown');
  console.log('[WBE-ADMIN] statusDropdown found:', !!st, 'value:', st && st.value);
  if (st && typeof st.onChange === 'function') {
    st.onChange(function () { console.log('[WBE-ADMIN] statusDropdown changed'); refreshList(); });
  }
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
  console.log('[WBE-ADMIN] refreshList start');
  const rep = tryFind('bookingsRepeater');
  txt('listStatusText', 'Loading...');
  try {
    const filters = readFilters();
    console.log('[WBE-ADMIN] filters:', JSON.stringify(filters));
    const res = await adminListBookings(filters);
    console.log('[WBE-ADMIN] adminListBookings res.ok:', res.ok, 'count:', res.items && res.items.length);
    if (!res.ok) { txt('listStatusText', 'Error: ' + (res.error || 'unknown')); return; }
    txt('listStatusText', res.items.length + ' booking(s)');
    if (!rep) { console.warn('[WBE-ADMIN] bookingsRepeater missing in refreshList'); return; }

    rep.data = res.items.map(function (s, i) {
      return {
        _id: s._id || ('row' + i),
        bookingNumber: s.bookingNumber || '',
        guestName: s.guestName || '',
        checkIn: s.checkIn || '',
        checkOut: s.checkOut || '',
        status: s.status || '',
        grandTotal: s.grandTotal || 0,
        // Preserve the full summary object for the click handler
        summary: s
      };
    });

    // Expand results section and the repeater itself so rows are visible.
    ['resultsContainer', 'bookingsContainer', 'bookingsRepeater'].forEach(function (id) {
      const el = tryFind(id);
      if (!el) return;
      try { el.expand(); } catch (e) {}
      try { el.show(); } catch (e) {}
    });
    console.log('[WBE-ADMIN] bookingsRepeater data set, rows:', rep.data.length);
  } catch (e) {
    console.error('[WBE-ADMIN] refreshList error:', e && e.message || e);
    txt('listStatusText', 'Error: ' + (e && e.message || e));
  }
}

function safeItemFind($item, sel) { try { return $item(sel); } catch (e) { return null; } }
function safeItemText($item, sel, v) { const el = safeItemFind($item, sel); if (el) safeSet(el, 'text', v); }
function safeItemSet($item, sel, v) { const el = safeItemFind($item, sel); if (el && el.value !== undefined) safeSet(el, 'value', v); else safeItemText($item, sel, v); }
function safeItemVal($item, sel) { const el = safeItemFind($item, sel); return el && el.value !== undefined ? el.value : ''; }

function wireBookingsRepeater() {
  const rep = tryFind('bookingsRepeater');
  if (!rep) { console.warn('[WBE-ADMIN] bookingsRepeater element not found'); return; }
  rep.onItemReady(($item, itemData) => {
    const s = itemData.summary || itemData;
    safeItemText($item, '#rowBookingNumber', s.bookingNumber || '');
    safeItemText($item, '#rowGuestName', s.guestName || '');
    safeItemText($item, '#rowDates', dstr(s.checkIn) + ' – ' + dstr(s.checkOut));
    safeItemText($item, '#rowStatus', s.status || '');
    const btn = safeItemFind($item, '#btnViewBooking');
    if (btn && typeof btn.onClick === 'function') {
      btn.onClick(function () { openDetail(s.bookingNumber); });
    }
  });
}

// ---------------- DETAIL PANEL ----------------

function wireDetailPanel() {
  const closeBtn = tryFind('btnCloseDetail');
  if (closeBtn && typeof closeBtn.onClick === 'function') {
    closeBtn.onClick(function () { ++_detailRevision; _currentBooking = null; _currentRooms = []; _cancelConfirmation = null; const button = tryFind('btnCancelBooking'); if (button) button.disable(); hide('detailPanel'); });
  }
  const saveBtn = tryFind('btnSaveChanges');
  if (saveBtn && typeof saveBtn.onClick === 'function') saveBtn.onClick(saveChanges);
  if (!_paymentLegacyWired) {
    const payBtn = tryFind('btnRecordPayment');
    if (payBtn && typeof payBtn.onClick === 'function') payBtn.onClick(recordPayment);
    const refBtn = tryFind('btnRecordRefund');
    if (refBtn && typeof refBtn.onClick === 'function') refBtn.onClick(recordRefund);
    _paymentLegacyWired = true;
  }
  const cancelBtn = tryFind('btnCancelBooking');
  if (cancelBtn && typeof cancelBtn.onClick === 'function') cancelBtn.onClick(cancelBooking);
  const newInvBtn = tryFind('btnNewInvoice');
  if (newInvBtn && typeof newInvBtn.onClick === 'function') newInvBtn.onClick(newInvoice);

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

function populatePaymentTable() {
  const paymentTable = tryFind('paymentInfo');
  if (!paymentTable) return;
  const rows = _currentPayments.map(function (p) {
    const sign = p.paymentAmount < 0 ? '-' : '+';
    return {
      payRowId: p.paymentId || p._id || '',
      payRowDate: dstr(p.datePaid),
      payRowAmount: sign + money(Math.abs(p.paymentAmount)),
      payRowMethod: p.paymentMethod || '',
      payRowNote: p.note || '',
    };
  });
  console.log('[WBE-ADMIN] populatePaymentTable rows:', rows.length);
  // Defer data assignment until the table is fully mounted.
  const revision = _detailRevision;
  setTimeout(function () {
    if (revision !== _detailRevision) return;
    paymentTable.data = rows;
    console.log('[WBE-ADMIN] paymentInfo.data assigned:', paymentTable.data.length);
  }, 50);
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
    populatePaymentTable();
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
    btn.style.borderColor = active ? '#2E5C8A' : 'rgba(0,0,0,0)';
    btn.style.borderWidth = active ? '2px' : '1px';
    if (!active) {
      try { btn.style.borderStyle = 'solid'; } catch (e) {}
    }
  } catch (e) {}
}

async function openDetail(bookingNumber) {
  const revision = ++_detailRevision;
  _currentBooking = null;
  _currentRooms = [];
  _cancelConfirmation = null;
  const cancelButton = tryFind('btnCancelBooking');
  if (cancelButton) cancelButton.disable();
  txt('detailStatusText', 'Loading ' + bookingNumber + '...');
  switchTab('details');
  show('detailPanel');
  try {
    const res = await adminGetBooking(bookingNumber);
    if (revision !== _detailRevision) return;
    if (!res.ok) { txt('detailStatusText', 'Error: ' + (res.error || 'unknown')); return; }
    _currentBooking = res.summary;
    const cancellation = res.cancellation;
    const resume = /^(cancelled|canceled)$/i.test(String(res.summary.status || '').trim());
    if (cancelButton) cancelButton.label = resume ? 'Resume / Reconcile Cancellation' : 'Cancel Booking';
    txt('cancelStatusText', cancellation ? bookingNumber + ': reservation ' + cancellation.reservation +
      '. External effects: ' + Object.keys(cancellation.effects || {}).map(k => k + '=' + cancellation.effects[k]).join('; ') +
      (cancellation.complete ? '. Complete.' : cancellation.coreComplete ? '. Core complete; Google reconciliation remains required.' : '. Reconciliation remains required.') : '');
    _currentRooms = res.rooms || [];
    _currentPayments = res.payments || [];
    _currentInvoices = res.invoices || [];
    _currentActiveInvoice = res.activeInvoice || null;
    _currentTotals = res.totals || null;
    renderDetail();
    if (cancelButton && !_cancelBusy && _currentRooms.length) cancelButton.enable();
    txt('detailStatusText', _currentRooms.length ? _currentRooms.map(r => r._id + ': ' + r.roomCode + ' x' + r.quantity + ' — ' + r.status).join('\n') : 'No room rows: cancellation is blocked.');
  } catch (e) {
    if (revision !== _detailRevision) return;
    txt('detailStatusText', 'Error: ' + (e && e.message || e));
  }
}

const PAYMENT_PENDING_KEY = 'wbe.adminPayment.pending.v1';
let _paymentBusy = false;
let _pendingPayment = null;

const PAYMENT_JOURNAL_KEY = 'wbe.adminPayment.journal.v1';
let _paymentSettled = false;

function readPaymentJournal() {
  const raw = session.getItem(PAYMENT_JOURNAL_KEY);
  if (!raw) return null;
  const entry = JSON.parse(raw);
  if (!entry || typeof entry.id !== 'string' || !/^[a-f0-9]{32}$/.test(entry.id) || entry.id.length !== 32 ||
      typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint) || entry.fingerprint.length !== 64 ||
      typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
      !['pending', 'acknowledged'].includes(entry.state)) throw new Error('Payment recovery unavailable. Reconcile before proceeding.');
  return entry;
}

function writePaymentJournal(entry) {
  const raw = JSON.stringify(entry);
  session.setItem(PAYMENT_JOURNAL_KEY, raw);
  if (session.getItem(PAYMENT_JOURNAL_KEY) !== raw) throw new Error('Payment recovery storage unavailable. Keep this tab and retry unchanged details.');
}

async function paymentOperation(payload, refund, blankDate) {
  // Read before minting, even when memory is available: unavailable storage is not absence.
  const stored = readPaymentJournal();
  let id = session.getItem(PAYMENT_PENDING_KEY);
  if (id && (!/^[a-f0-9]{32}$/.test(id) || id.length !== 32)) throw new Error('Pending payment recovery is unavailable. Reconcile before proceeding.');
  const pending = _pendingPayment || (!_paymentSettled && stored);
  if (pending && id && pending.id !== id) throw new Error('Payment recovery conflicts. Reconcile before proceeding.');
  if (pending && blankDate) payload.datePaid = pending.date;
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.subtle.digest !== 'function' || typeof crypto.getRandomValues !== 'function') throw new Error('Secure payment identity unavailable. No payment sent.');
  // Canonical rounded amount and immutable server fields; never persist raw notes/PII.
  const canonical = JSON.stringify([refund, payload.bookingNumber, Math.round(payload.amount * 100) / 100,
    payload.datePaid, payload.paymentMethod, payload.note]);
  const encoded = unescape(encodeURIComponent(canonical));
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(encoded, c => c.charCodeAt(0)));
  const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (pending) {
    if (pending.fingerprint !== fingerprint) throw new Error('Retry the pending payment with unchanged details before starting another.');
    _pendingPayment = pending;
    writePaymentJournal(pending);
    return pending.id;
  }
  if (!id) {
    const bytes = new Uint8Array(16);
    if (crypto.getRandomValues(bytes) !== bytes) throw new Error('Secure payment identity unavailable.');
    id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  // Keep memory before any fallible write/readback; never mint around uncertainty.
  _pendingPayment = { id, fingerprint, date: payload.datePaid, state: 'pending' };
  _paymentSettled = false;
  writePaymentJournal(_pendingPayment);
  session.setItem(PAYMENT_PENDING_KEY, id);
  if (session.getItem(PAYMENT_PENDING_KEY) !== id) throw new Error('Payment recovery storage unavailable. No payment sent.');
  return id;
}

function wirePaymentSave() {
  const saveBtn = tryFind('btnPmtSave');
  if (!saveBtn || typeof saveBtn.onClick !== 'function' || _paymentSaveWired) return;
  saveBtn.onClick(() => submitPayment('save'));
  _paymentSaveWired = true;
}

async function submitPayment(mode) {
  if (_paymentBusy || !_currentBooking) return;
  _paymentBusy = true;
  const bookingNumber = _currentBooking.bookingNumber;
  const revision = _detailRevision;
  const current = () => revision === _detailRevision && _currentBooking && _currentBooking.bookingNumber === bookingNumber;
  const controls = ['btnPmtSave', 'btnRecordPayment', 'btnRecordRefund'].map(tryFind).filter(Boolean);
  const priorDisabled = controls.map(button => button.enabled === false);
  try {
    controls.forEach(button => button.disable());
    const amount = mode === 'save' ? Number(String(val('inputPayAmount')).replace(/[^0-9.\-]/g, '')) :
      Number(val(mode === 'refund' ? 'inputRefundAmount' : 'inputPayAmount'));
    const refund = mode === 'refund' || (mode === 'save' && amount < 0);
    if (!Number.isFinite(amount) || !amount || (mode !== 'save' && amount < 0)) throw new Error('Please enter a positive amount (negative Save amounts record a refund).');
    const dateField = mode === 'save' ? 'inputPayDate' : refund ? 'dateRefund' : 'datePaid';
    const noteField = mode === 'save' ? 'notes' : refund ? 'inputRefundNote' : 'inputPayNote';
    const payload = {
      bookingNumber,
      amount: Math.abs(amount),
      datePaid: dstr(val(dateField) || new Date()),
      paymentMethod: mode === 'save' ? 'Terminal' : val(refund ? 'refundMethodDropdown' : 'payMethodDropdown') || 'Terminal',
      note: String(val(noteField) || ''),
    };
    if (!Number.isFinite(new Date(payload.datePaid).getTime())) throw new Error('Please enter a valid payment date.');
    payload.operationId = await paymentOperation(payload, refund, !val(dateField));
    txt('paymentStatusText', 'Recording...');
    const res = await (refund ? adminRecordRefund : adminRecordPayment)(payload);
    if (!res || !res.ok) throw new Error(res && res.error || 'Payment outcome unknown; retry unchanged details.');
    _pendingPayment.state = 'acknowledged';
    // Retain an acknowledged journal across all deletion/clear faults and reload.
    writePaymentJournal(_pendingPayment);
    if (!current()) return;
    session.removeItem(PAYMENT_PENDING_KEY);
    if (session.getItem(PAYMENT_PENDING_KEY)) throw new Error('Recovery storage could not be cleared.');
    const amountField = mode === 'refund' ? 'inputRefundAmount' : 'inputPayAmount';
    setVal(amountField, '');
    if (val(amountField) !== '') throw new Error('Amount could not be cleared.');
    _pendingPayment = null;
    _paymentSettled = true;
    setVal(noteField, '');
    txt('paymentStatusText', (res.warning ? 'Warning: ' + res.warning + ' ' : '') + 'Recorded (' + res.paymentId + ').');
    await openDetail(bookingNumber);
  } catch (error) {
    if (current()) txt('paymentStatusText', _pendingPayment && _pendingPayment.state === 'acknowledged' ?
      'Payment recorded. Form/recovery cleanup is incomplete. Keep this tab; retry the unchanged entry to reconcile only. Do not repeat the actual payment. ' + (error && error.message || '') :
      'No new payment is authorized by this message. Keep this tab and retry unchanged details to reconcile. ' + (error && error.message || 'Payment outcome unknown.'));
  } finally {
    _paymentBusy = false;
    controls.forEach((button, index) => {
      try { if (!priorDisabled[index]) button.enable(); } catch (error) {}
    });
  }
}

function renderDetail() {
  const s = _currentBooking;
  if (!s) return;
  txt('detailTitle', 'Booking ' + (s.bookingNumber || ''));

  // Details tab (BookingSummary fields)
  setVal('inputGuestName', s.guestName || '');
  setVal('inputGuestEmail', s.guestEmail || '');
  setVal('inputGuestPhone', s.guestPhone || '');
  setVal('inputRoomsNum', String(s.roomCount || _currentRooms.length || 0));
  setVal('inputStatusDropdown', s.status || 'confirmed');
  const statusInput = tryFind('inputStatusDropdown');
  if (statusInput) statusInput.disable();
  setVal('inputGclid', s.gclid || '');
  setVal('inputGbraid', s.gbraid || '');
  setVal('inputWbraid', s.wbraid || '');
  setVal('inputConvUp', s.googleConversionUploaded ? '1' : '0');
  setVal('inputConvRet', s.googleConversionRetracted ? '1' : '0');
  setVal('inputBookingNotes', s.notes || '');

  // Financial detail fields (BookingSummary with active-invoice fallback)
  const inv = _currentActiveInvoice || {};
  setVal('inputPkgVat', fmtNum(s.packageVat || inv.packageVat));
  setVal('inputAccVat', fmtNum(s.accommodationVat || inv.accommodationVat));
  setVal('inputPropFee', fmtNum(s.propertyFee || inv.propertyFee));
  setVal('inputPromoDiscountNum', fmtNum(s.promoDiscountAmount || inv.promoDiscountAmount));

  // Invoices repeater (BookingInvoices fields)
  const invRep = tryFind('bookingInvoicesRepeater');
  if (invRep) {
    invRep.onItemReady(($item, itemData) => {
      const i = itemData.invoice || itemData;
      // Use raw numeric strings for financial inputs so number-typed inputs accept them.
      const values = {
        '#inputInvoiceNumber': i.invoiceNumber || '',
        '#inputPkgVat': fmtNum(i.packageVat),
        '#inputAccVat': fmtNum(i.accommodationVat),
        '#inputPropFee': fmtNum(i.propertyFee),
        '#inputRoomTotal': fmtNum(i.roomTotal),
        '#inputGrandTotal': fmtNum(i.grandTotal),
        '#inputPromoCode': i.promoCode || '',
        '#inputPromoDiscountNum': fmtNum(i.promoDiscountAmount)
      };

      safeItemSet($item, '#status', i.status || '');

      Object.keys(values).forEach(function (sel) {
        const el = safeItemFind($item, sel);
        if (!el) return;
        try {
          if (el.value !== undefined) el.value = values[sel];
          else el.text = values[sel];
        } catch (e) {}
      });

      // Date pickers must receive a Date object (local midnight works best in Wix).
      function toPickerDate(d) {
        if (!d) return null;
        const dt = d instanceof Date ? d : new Date(d);
        if (isNaN(dt.getTime())) return null;
        return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0);
      }
      safeItemSet($item, '#dateCheckIn', toPickerDate(i.checkIn));
      safeItemSet($item, '#dateCheckOut', toPickerDate(i.checkOut));

      const saveBtn = safeItemFind($item, '#btnSave');
      if (saveBtn && typeof saveBtn.onClick === 'function') {
        saveBtn.onClick(async function () {
          saveBtn.label = 'Saving...';
          try {
            const res = await adminUpdateInvoice(i._id, {
              invoiceNumber: safeItemVal($item, '#inputInvoiceNumber'),
              checkIn: safeItemVal($item, '#dateCheckIn'),
              checkOut: safeItemVal($item, '#dateCheckOut'),
              roomTotal: Number(safeItemVal($item, '#inputRoomTotal')) || 0,
              grandTotal: Number(safeItemVal($item, '#inputGrandTotal')) || 0,
              packageVat: Number(safeItemVal($item, '#inputPkgVat')) || 0,
              accommodationVat: Number(safeItemVal($item, '#inputAccVat')) || 0,
              propertyFee: Number(safeItemVal($item, '#inputPropFee')) || 0,
              promoCode: safeItemVal($item, '#inputPromoCode'),
              promoDiscountAmount: Number(safeItemVal($item, '#inputPromoDiscountNum')) || 0,
            });
            if (res.ok) {
              saveBtn.label = 'Saved';
              setTimeout(function () { saveBtn.label = 'Save'; }, 1500);
            } else {
              saveBtn.label = 'Error';
              console.error('[WBE-ADMIN] save invoice error:', res.error);
            }
          } catch (e) {
            saveBtn.label = 'Error';
            console.error('[WBE-ADMIN] save invoice exception:', e && e.message || e);
          }
        });
      }

      const newInvBtn = safeItemFind($item, '#btnNewInvoice');
      if (newInvBtn && typeof newInvBtn.onClick === 'function') {
        newInvBtn.onClick(async function () {
          newInvBtn.label = 'Working...';
          try {
            await newInvoice();
            newInvBtn.label = 'New Invoice';
          } catch (e) {
            newInvBtn.label = 'Error';
            console.error('[WBE-ADMIN] new invoice exception:', e && e.message || e);
            setTimeout(function () { newInvBtn.label = 'New Invoice'; }, 2000);
          }
        });
      }
    });
    invRep.data = _currentInvoices.map(function (i, idx) {
      return { _id: i._id || ('inv' + idx), invoice: i };
    });
  }

  // Payments tab
  const t = _currentTotals || { grandTotal: 0, totalPaid: 0, totalRefunded: 0, balance: 0 };
  txt('invoiceTotalText', money(t.grandTotal) + (_currentBooking.cancellationSettlement === 'FULL_NO_FEE' ? ' (historical invoice)' : ''));
  txt('totalPaidText', money(t.totalPaid));
  txt('totalRefundedText', money(t.totalRefunded));
  txt('balanceText', money(t.balance));
  txt('remBalance', money(t.balance));

  wirePaymentSave();

  populatePaymentTable();

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
      numGuests: Number(val('inputRoomsNum')) || undefined,
      checkIn: val('dateCheckIn') ? new Date(val('dateCheckIn')) : undefined,
      checkOut: val('dateCheckOut') ? new Date(val('dateCheckOut')) : undefined,
      roomCount: Number(val('inputRoomsNum')) || undefined,
      // Cancellation owns status; ordinary edits never carry a stale status.
      gclid: String(val('inputGclid') || ''),
      gbraid: String(val('inputGbraid') || ''),
      wbraid: String(val('inputWbraid') || ''),
      googleConversionUploaded: val('inputConvUp') === '1' || val('inputConvUp') === true || val('inputConvUp') === 'true',
      googleConversionRetracted: val('inputConvRet') === '1' || val('inputConvRet') === true || val('inputConvRet') === 'true',
      notes: String(val('inputBookingNotes') || ''),
      accommodationVat: Number(val('inputAccVat')) || undefined,
      packageVat: Number(val('inputPkgVat')) || undefined,
      propertyFee: Number(val('inputPropFee')) || undefined,
      promoDiscountAmount: Number(val('inputPromoDiscountNum')) || undefined,
      promoCode: String(val('inputPromoCode') || ''),
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

function recordPayment() { return submitPayment('payment'); }
function recordRefund() { return submitPayment('refund'); }

async function newInvoice() {
  if (!_currentBooking) return;
  txt('saveStatusText', 'Generating new invoice...');
  try {
    const res = await adminIssueNewInvoice(_currentBooking.bookingNumber);
    if (!res.ok) { txt('saveStatusText', 'Error: ' + (res.error || 'unknown')); return; }
    txt('saveStatusText', 'New invoice ' + res.invoiceNumber + ' generated and sent to info@.');
    await openDetail(_currentBooking.bookingNumber);
  } catch (e) {
    txt('saveStatusText', 'Error: ' + (e && e.message || e));
  }
}

async function cancelBooking() {
  if (!_currentBooking || _cancelBusy || !_currentRooms.length) return;
  const target = _currentBooking.bookingNumber;
  const revision = _detailRevision;
  const reason = String(val('inputCancelReason') || '');
  const confirmation = target + ':' + revision + ':' + reason;
  if (_cancelConfirmation !== confirmation) {
    _cancelConfirmation = confirmation;
    txt('cancelStatusText', (/^(cancelled|canceled)$/i.test(String(_currentBooking.status || '').trim()) ?
      'Confirm resume/reconcile. Unknown email/Ads/GA4 attempts are never resent. Full cancellation with NO FEE for ' :
      'Confirm full cancellation with NO FEE for ') + target + ' (' +
      (_currentBooking.guestName || '') + ', ' + dstr(_currentBooking.checkIn) + ' to ' + dstr(_currentBooking.checkOut) +
      '). Review the room rows, then click Cancel Booking again. Payments and historical invoices are preserved.');
    return;
  }
  _cancelConfirmation = null;
  _cancelBusy = true;
  const button = tryFind('btnCancelBooking');
  if (button) button.disable();
  txt('cancelStatusText', 'Cancelling ' + target + '...');
  try {
    const res = await adminCancelBooking(target, reason);
    if (revision !== _detailRevision) return;
    if (!res.ok) { txt('cancelStatusText', 'Cancellation unresolved: ' + (res.error || 'read status before retrying')); return; }
    txt('cancelStatusText', target + ': reservation ' + res.reservation +
      '. External effects: ' + Object.keys(res.effects || {}).map(k => k + '=' + res.effects[k]).join('; ') +
      (res.complete ? '. Complete.' : '. Reconciliation remains required.'));
    _cancelBusy = false;
    await openDetail(target);
    refreshList();
  } catch (e) {
    if (revision !== _detailRevision) return;
    txt('cancelStatusText', target + ': outcome unresolved. Reopen this booking to read status; do not send manually.');
  } finally {
    _cancelBusy = false;
    if (button && _currentBooking && _currentRooms.length) button.enable();
  }
}
