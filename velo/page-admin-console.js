/*
 * Wanderlust Booking Engine — Admin Console page code.
 * File location in Wix Editor: the code panel of your ADMIN page.
 *
 * EXPANDED 2026-06-05: now includes:
 *   - Reports (existing)
 *   - Booking CRUD (create, edit, cancel)
 *   - Room blocking (block one room, block all rooms, unblock)
 *   - Messages CRUD (promos, closure notices for the booking page)
 *   - Tax Rates (table-driven, editable without code changes)
 *
 * SECURITY: Put this page behind member/admin login (Wix: page Permissions ->
 * Members only, and restrict to admins). The backend functions are all
 * Permissions.Admin so only admins can read/modify data even if the page were
 * exposed.
 *
 * REQUIRED page elements (add these in the Wix Editor with these exact IDs):
 *   REPORTS SECTION:
 *     #datePickerFrom, #datePickerTo, #dateFieldSelect, #btnRunReport,
 *     #bookingsRepeater (repeater), #statusText,
 *     #sumCount, #sumAccommodation, #sumPackages, #sumVat10, #sumVat15,
 *     #sumVatTotal, #sumGrandTotal
 *
 *   BOOKING CRUD SECTION:
 *     #sectionBookings (container for the booking section)
 *     #ddBookingRoom (dropdown with roomCode values),
 *     #dpBookingCheckIn, #dpBookingCheckOut (date pickers),
 *     #inpBookingGuests, #inpBookingName, #inpBookingEmail, #inpBookingPhone,
 *     #btnCreateBooking, #bookingsListRepeater (repeater for all bookings),
 *     #btnCancelBooking (button inside repeater or standalone with selected ID)
 *
 *   BLOCKING SECTION:
 *     #sectionBlocking (container)
 *     #ddBlockRoom (dropdown), #dpBlockStart, #dpBlockEnd,
 *     #inpBlockQuantity, #inpBlockReason,
 *     #btnBlockRoom, #btnBlockAllRooms,
 *     #blocksListRepeater, #btnUnblock (inside repeater)
 *
 *   MESSAGES SECTION:
 *     #sectionMessages (container)
 *     #inpMsgTitle, #inpMsgBody, #dpMsgStart, #dpMsgEnd,
 *     #ddMsgPage (dropdown: search/detail/confirm),
 *     #inpMsgPriority, #swMsgActive (switch),
 *     #btnSaveMessage, #messagesListRepeater,
 *     #btnEditMessage, #btnDeleteMessage (inside repeater)
 *
 *   TAX RATES SECTION:
 *     #sectionTaxRates (container)
 *     #inpTaxRateAccom (input), #inpTaxRateStandard (input),
 *     #btnSaveTaxRates, #currentTaxRatesText
 */

import { queryBookingsByDateRange, cancelReservation, applyEditedReservation } from 'backend/reporting';
import { createBooking, cancelBooking, blockRoom, blockAllRooms, unblock, listBlocks } from 'backend/availability';
import { createMessage, updateMessage, deleteMessage, listMessages, getActiveMessages } from 'backend/messages';
import { quotePackage } from 'backend/packagePricing';
import { getAllTaxRates, setTaxRate } from 'backend/settings';
import { getRoomDisplayName } from 'backend/wbeConfig';

$w.onReady(function () {
  // --- Reports ---
  if ($w('#btnRunReport')) {
    $w('#btnRunReport').onClick(runReport);
  }

  // --- Booking CRUD ---
  if ($w('#btnCreateBooking')) {
    $w('#btnCreateBooking').onClick(createBookingHandler);
  }
  if ($w('#btnLoadBookings')) {
    $w('#btnLoadBookings').onClick(loadAllBookings);
  }

  // --- Blocking ---
  if ($w('#btnBlockRoom')) {
    $w('#btnBlockRoom').onClick(blockRoomHandler);
  }
  if ($w('#btnBlockAllRooms')) {
    $w('#btnBlockAllRooms').onClick(blockAllRoomsHandler);
  }
  if ($w('#btnLoadBlocks')) {
    $w('#btnLoadBlocks').onClick(loadBlocks);
  }

  // --- Messages ---
  if ($w('#btnSaveMessage')) {
    $w('#btnSaveMessage').onClick(saveMessageHandler);
  }
  if ($w('#btnLoadMessages')) {
    $w('#btnLoadMessages').onClick(loadMessages);
  }

  // --- Tax Rates ---
  if ($w('#btnSaveTaxRates')) {
    $w('#btnSaveTaxRates').onClick(saveTaxRateHandler);
  }

  // Initial load
  loadAllBookings();
  loadBlocks();
  loadMessages();
  loadTaxRates();
});

// =============================================================================
// REPORTS
// =============================================================================

async function runReport() {
  const from = $w('#datePickerFrom').value;
  const to = $w('#datePickerTo').value;
  const dateField = ($w('#dateFieldSelect') && $w('#dateFieldSelect').value) || 'dateBooked';

  if (!from || !to) {
    $w('#statusText').text = 'Please choose both a From and To date.';
    return;
  }

  $w('#statusText').text = 'Loading...';
  try {
    const { rows, totals } = await queryBookingsByDateRange(
      from.toISOString(), to.toISOString(), dateField
    );

    // Use dynamic tax rate labels for display.
    const rates = await getAllTaxRates();
    const accomLabel = `VAT ${Math.round(rates.accommodation * 100)}%`;
    const stdLabel = `VAT ${Math.round(rates.standard * 100)}%`;

    $w('#bookingsRepeater').data = rows.map((r) => ({
      _id: r._id,
      guestName: r.guestName,
      invoiceNumber: r.bookingNumber,
      guestPhone: r.guestPhone,
      guestEmail: r.guestEmail,
      dateBooked: fmtDate(r.dateBooked),
      checkInDate: fmtDate(r.checkInDate),
      checkOutDate: fmtDate(r.checkOutDate),
      status: r.status || 'Confirmed',
      accommodationSaleNet: money(r.accommodationSaleNet),
      packageSaleNet: money(r.packageSaleNet),
      totalVat10: money(r.totalVat10),
      totalVat15: money(r.totalVat15),
      totalVat: money(r.totalVat),
      grandTotal: money(r.grandTotal),
    }));

    $w('#sumCount').text = String(totals.count);
    $w('#sumRevenueCount').text = String(totals.revenueCount || 0);
    $w('#sumAccommodation').text = money(totals.accommodationSaleNet);
    $w('#sumPackages').text = money(totals.packageSaleNet);
    $w('#sumVat10').text = money(totals.totalVat10);
    $w('#sumVat15').text = money(totals.totalVat15);
    $w('#sumVatTotal').text = money(totals.totalVat);
    $w('#sumGrandTotal').text = money(totals.grandTotal);

    $w('#statusText').text = `${totals.count} booking(s) found (${totals.revenueCount || 0} revenue).`;
  } catch (e) {
    $w('#statusText').text = 'Error: ' + e.message;
  }
}

// =============================================================================
// BOOKING CRUD
// =============================================================================

let _currentTaxRates = { accommodation: 0.10, standard: 0.15 };

async function refreshTaxRates() {
  try {
    _currentTaxRates = await getAllTaxRates();
  } catch (e) {
    console.log('Tax rate refresh failed, using defaults:', e);
  }
}

async function createBookingHandler() {
  const statusText = $w('#bookingStatusText') || $w('#statusText');
  try {
    const roomCode = $w('#ddBookingRoom').value;
    const checkIn = $w('#dpBookingCheckIn').value;
    const checkOut = $w('#dpBookingCheckOut').value;
    const guests = parseInt($w('#inpBookingGuests').value, 10) || 2;
    const name = ($w('#inpBookingName').value || '').trim();
    const email = ($w('#inpBookingEmail').value || '').trim();
    const phone = ($w('#inpBookingPhone').value || '').trim();

    if (!roomCode || !checkIn || !checkOut) {
      statusText.text = 'Room, check-in, and check-out are required.';
      return;
    }
    if (!name || !email) {
      statusText.text = 'Guest name and email are required.';
      return;
    }

    statusText.text = 'Creating booking...';

    // Ensure we have the latest tax rates before building the quote.
    await refreshTaxRates();

    // 1) Create the raw booking
    const booking = await createBooking({
      roomCode,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      guests,
    });

    // 2) Build quote for reporting
    const nights = Math.round((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    const quote = await quotePackage(roomCode, nights, null, guests);

    // Dynamic tax rate labels from the live settings.
    const accomRateKey = `accommodation (${Math.round(_currentTaxRates.accommodation * 100)}%)`;
    const stdRateKey = `standard (${Math.round(_currentTaxRates.standard * 100)}%)`;

    // 3) Log to BookingReports
    const reportRecord = {
      guestName: name,
      guestEmail: email,
      guestPhone: phone,
      dateBooked: new Date().toISOString(),
      checkInDate: checkIn.toISOString(),
      checkOutDate: checkOut.toISOString(),
      roomCode,
      accommodationSaleNet: quote.lineItems[0].net,
      packageSaleNet: quote.lineItems[1].net,
      totalVat10: quote.vatByClass[accomRateKey] ?? 0,
      totalVat15: quote.vatByClass[stdRateKey] ?? 0,
      totalVat: quote.totalVat,
      grandTotal: quote.total,
      status: 'Confirmed',
      propertyFeeRate: quote.propertyFeeRate,
      propertyFee: quote.propertyFee,
    };
    const { logBookingReport } = await import('backend/reporting.web');
    await logBookingReport(reportRecord);

    statusText.text = `Booking created: ${booking._id}`;
    clearBookingForm();
    loadAllBookings();
  } catch (e) {
    statusText.text = 'Error: ' + e.message;
  }
}

async function loadAllBookings() {
  const repeater = $w('#bookingsListRepeater');
  if (!repeater) return;
  try {
    const { queryBookingsByDateRange } = await import('backend/reporting.web');
    // Load last 90 days by default
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - 90);
    const { rows } = await queryBookingsByDateRange(from.toISOString(), to.toISOString(), 'checkInDate');
    repeater.data = rows.map((r) => ({
      _id: r._id,
      guestName: r.guestName || '(no name)',
      roomCode: r.roomCode || '',
      roomName: getRoomDisplayName(r.roomCode),
      checkInDate: fmtDate(r.checkInDate),
      checkOutDate: fmtDate(r.checkOutDate),
      status: r.status || 'Confirmed',
      grandTotal: money(r.grandTotal),
    }));
  } catch (e) {
    console.error('loadAllBookings error:', e);
  }
}

function clearBookingForm() {
  if ($w('#ddBookingRoom')) $w('#ddBookingRoom').value = null;
  if ($w('#dpBookingCheckIn')) $w('#dpBookingCheckIn').value = null;
  if ($w('#dpBookingCheckOut')) $w('#dpBookingCheckOut').value = null;
  if ($w('#inpBookingGuests')) $w('#inpBookingGuests').value = '';
  if ($w('#inpBookingName')) $w('#inpBookingName').value = '';
  if ($w('#inpBookingEmail')) $w('#inpBookingEmail').value = '';
  if ($w('#inpBookingPhone')) $w('#inpBookingPhone').value = '';
}

// =============================================================================
// BLOCKING
// =============================================================================

async function blockRoomHandler() {
  const statusText = $w('#blockStatusText') || $w('#statusText');
  try {
    const roomCode = $w('#ddBlockRoom').value;
    const start = $w('#dpBlockStart').value;
    const end = $w('#dpBlockEnd').value;
    const quantity = parseInt($w('#inpBlockQuantity').value, 10) || 1;
    const reason = ($w('#inpBlockReason').value || '').trim();

    if (!roomCode || !start || !end) {
      statusText.text = 'Room, start date, and end date are required.';
      return;
    }

    statusText.text = 'Blocking...';
    const result = await blockRoom(roomCode, start.toISOString(), end.toISOString(), quantity, reason);
    const warnings = result.warnings || [];
    const b = result.booking;
    statusText.text = `Blocked ${b.quantity} unit(s) of ${getRoomDisplayName(roomCode)} (${fmtDate(b.checkIn)} to ${fmtDate(b.checkOut)}). ` +
      (warnings.length ? warnings.join(' ') : '');
    loadBlocks();
  } catch (e) {
    statusText.text = 'Error: ' + e.message;
  }
}

async function blockAllRoomsHandler() {
  const statusText = $w('#blockStatusText') || $w('#statusText');
  try {
    const start = $w('#dpBlockStart').value;
    const end = $w('#dpBlockEnd').value;
    const reason = ($w('#inpBlockReason').value || '').trim();

    if (!start || !end) {
      statusText.text = 'Start date and end date are required.';
      return;
    }

    statusText.text = 'Closing hotel...';
    const results = await blockAllRooms(start.toISOString(), end.toISOString(), reason);
    const blockedCount = results.filter(r => r.booking).length;
    const skippedCount = results.filter(r => !r.booking).length;
    statusText.text = `Hotel closure: ${blockedCount} room type(s) blocked, ${skippedCount} skipped (already booked).`;
    loadBlocks();
  } catch (e) {
    statusText.text = 'Error: ' + e.message;
  }
}

async function loadBlocks() {
  const repeater = $w('#blocksListRepeater');
  if (!repeater) return;
  try {
    const blocks = await listBlocks();
    repeater.data = blocks.map((b) => ({
      _id: b._id,
      roomCode: b.roomCode,
      roomName: getRoomDisplayName(b.roomCode),
      quantity: b.quantity || 1,
      checkIn: fmtDate(b.checkIn),
      checkOut: fmtDate(b.checkOut),
      note: b.note || '',
    }));

    // Wire up the unblock button inside the repeater
    repeater.onItemReady(($item, itemData) => {
      const btn = $item('#btnUnblock');
      if (btn) {
        btn.onClick(async () => {
          try {
            await unblock(itemData._id);
            loadBlocks();
          } catch (e) {
            console.error('Unblock error:', e);
          }
        });
      }
    });
  } catch (e) {
    console.error('loadBlocks error:', e);
  }
}

// =============================================================================
// MESSAGES CRUD
// =============================================================================

let editingMessageId = null;

async function saveMessageHandler() {
  const statusText = $w('#msgStatusText') || $w('#statusText');
  try {
    const title = ($w('#inpMsgTitle').value || '').trim();
    const body = ($w('#inpMsgBody').value || '').trim();
    const start = $w('#dpMsgStart').value;
    const end = $w('#dpMsgEnd').value;
    const page = $w('#ddMsgPage').value || 'search';
    const priority = parseInt($w('#inpMsgPriority').value, 10) || 0;
    const active = $w('#swMsgActive') ? $w('#swMsgActive').checked : true;

    if (!title || !body) {
      statusText.text = 'Title and body are required.';
      return;
    }

    statusText.text = editingMessageId ? 'Updating message...' : 'Creating message...';

    const payload = {
      title,
      body,
      startDate: start ? start.toISOString() : null,
      endDate: end ? end.toISOString() : null,
      displayPage: page,
      priority,
      active,
    };

    if (editingMessageId) {
      await updateMessage(editingMessageId, payload);
      editingMessageId = null;
      if ($w('#btnSaveMessage')) $w('#btnSaveMessage').label = 'Create Message';
    } else {
      await createMessage(payload);
    }

    statusText.text = 'Message saved.';
    clearMessageForm();
    loadMessages();
  } catch (e) {
    statusText.text = 'Error: ' + e.message;
  }
}

async function loadMessages() {
  const repeater = $w('#messagesListRepeater');
  if (!repeater) return;
  try {
    const msgs = await listMessages();
    repeater.data = msgs.map((m) => ({
      _id: m._id,
      title: m.title || '',
      body: m.body || '',
      page: m.displayPage || 'search',
      priority: m.priority || 0,
      active: m.active ? 'Yes' : 'No',
      start: fmtDate(m.startDate),
      end: fmtDate(m.endDate),
    }));

    repeater.onItemReady(($item, itemData) => {
      const btnEdit = $item('#btnEditMessage');
      const btnDelete = $item('#btnDeleteMessage');

      if (btnEdit) {
        btnEdit.onClick(() => {
          editingMessageId = itemData._id;
          $w('#inpMsgTitle').value = itemData.title;
          $w('#inpMsgBody').value = itemData.body;
          $w('#ddMsgPage').value = itemData.page;
          $w('#inpMsgPriority').value = String(itemData.priority);
          if ($w('#btnSaveMessage')) $w('#btnSaveMessage').label = 'Update Message';
        });
      }

      if (btnDelete) {
        btnDelete.onClick(async () => {
          try {
            await deleteMessage(itemData._id);
            loadMessages();
          } catch (e) {
            console.error('Delete message error:', e);
          }
        });
      }
    });
  } catch (e) {
    console.error('loadMessages error:', e);
  }
}

function clearMessageForm() {
  if ($w('#inpMsgTitle')) $w('#inpMsgTitle').value = '';
  if ($w('#inpMsgBody')) $w('#inpMsgBody').value = '';
  if ($w('#dpMsgStart')) $w('#dpMsgStart').value = null;
  if ($w('#dpMsgEnd')) $w('#dpMsgEnd').value = null;
  if ($w('#ddMsgPage')) $w('#ddMsgPage').value = 'search';
  if ($w('#inpMsgPriority')) $w('#inpMsgPriority').value = '0';
  if ($w('#swMsgActive')) $w('#swMsgActive').checked = true;
  editingMessageId = null;
  if ($w('#btnSaveMessage')) $w('#btnSaveMessage').label = 'Create Message';
}

// =============================================================================
// TAX RATES
// =============================================================================

async function loadTaxRates() {
  try {
    const rates = await getAllTaxRates();
    _currentTaxRates = rates;
    const label = `Accommodation: ${Math.round(rates.accommodation * 100)}% ` +
                  `/ Standard: ${Math.round(rates.standard * 100)}%`;
    if ($w('#currentTaxRatesText')) $w('#currentTaxRatesText').text = label;
    if ($w('#inpTaxRateAccom')) $w('#inpTaxRateAccom').value = String(Math.round(rates.accommodation * 100));
    if ($w('#inpTaxRateStandard')) $w('#inpTaxRateStandard').value = String(Math.round(rates.standard * 100));
  } catch (e) {
    console.error('loadTaxRates error:', e);
    if ($w('#currentTaxRatesText')) $w('#currentTaxRatesText').text = 'Error loading rates.';
  }
}

async function saveTaxRateHandler() {
  const statusText = $w('#taxStatusText') || $w('#statusText');
  try {
    const accom = ($w('#inpTaxRateAccom').value || '').trim();
    const standard = ($w('#inpTaxRateStandard').value || '').trim();

    if (!accom && !standard) {
      statusText.text = 'Enter at least one tax rate.';
      return;
    }

    statusText.text = 'Saving tax rates...';

    const results = [];
    if (accom !== '') {
      const r = await setTaxRate('accommodation', parseFloat(accom));
      results.push(r.label);
    }
    if (standard !== '') {
      const r = await setTaxRate('standard', parseFloat(standard));
      results.push(r.label);
    }

    statusText.text = `Saved: ${results.join(', ')}`;
    loadTaxRates();   // refresh displayed values
  } catch (e) {
    statusText.text = 'Error: ' + e.message;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function money(x) {
  return '$' + Number(x || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toISOString().slice(0, 10);
}
