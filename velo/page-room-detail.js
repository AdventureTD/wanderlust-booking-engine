/**
 * Wanderlust Booking Engine — Room Detail page code.
 * File location in Wix Editor: the code panel of your ROOM DETAIL page.
 *
 * Reads roomCode + dates from the URL (passed by the search page).
 * Loads room photos/description and computes a live price quote.
 * Guest can adjust the guest count; quote recomputes automatically.
 * "Continue" passes selection forward to the Guest & Confirm page.
 *
 * REQUIRED elements (exact IDs):
 *   #roomTitle, #roomDesc, #roomOccupancy (Text), #roomGallery (Pro Gallery),
 *   #detailCheckIn, #detailCheckOut (Date Pickers),
 *   #dropdownGuests (Dropdown), #priceSummary, #pkgTotal,
 *   #lineItemsRepeater (repeater with #lineLabel, #lineNet, #lineVatRate, #lineVat, #lineGross),
 *   #subtotalNetText, #vatAccommodationText, #vatAdventureText, #totalVatText,
 *   #propertyFeeText, #grandTotalText, #btnContinue, #detailStatusText
 */

import wixLocation from 'wix-location';
import { getRoomMedia } from 'backend/rooms';
import { quotePackage } from 'backend/packagePricing';
import { getAllTaxRates } from 'backend/settings';
function fmtCurrency(n) { return Number(n || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }

$w.onReady(function () {
  initPage();
});

let _roomCode = '';
let _checkIn = '';
let _checkOut = '';
let _guests = 0;
let _nights = 0;
let _quote = null;
let _currentTaxRates = { accommodation: 0.10, standard: 0.15 };

async function initPage() {
  const q = wixLocation.query;
  _roomCode = q.roomCode || '';
  _checkIn = q.checkIn || '';
  _checkOut = q.checkOut || '';

  if (!_roomCode || !_checkIn || !_checkOut) {
    setStatus('Missing room or dates. Please start from the search page.');
    return;
  }

  // Pre-fill date pickers
  try {
    $w('#detailCheckIn').value = new Date(_checkIn);
    $w('#detailCheckOut').value = new Date(_checkOut);
  } catch (e) {
    console.log('Date picker init error:', e);
  }

  // Load tax rates for labels
  try {
    _currentTaxRates = await getAllTaxRates();
  } catch (e) {
    console.log('Tax rate load error:', e);
  }

  // Setup repeater binding once
  if ($w('#lineItemsRepeater')) {
    $w('#lineItemsRepeater').onItemReady(($item, itemData) => {
      $item('#lineLabel').text = itemData.label;
      $item('#lineNet').text = itemData.net;
      $item('#lineVatRate').text = itemData.vatRate;
      $item('#lineVat').text = itemData.vat;
      $item('#lineGross').text = itemData.gross;
    });
  }

  // Load room details
  try {
    const room = await getRoomMedia(_roomCode);
    $w('#roomTitle').text = room.name;
    $w('#roomDesc').text = room.description || '';

    // Occupancy info
    const occMin = room.baseOccupancy || 1;
    const occMax = room.maxOccupancy || occMin;
    let occText = '';
    if (occMin === occMax) {
      occText = `Sleeps ${occMin} guest${occMin > 1 ? 's' : ''}.`;
    } else {
      occText = `Sleeps ${occMin}–${occMax} guests.`;
      if (room.extraGuestFee > 0) {
        occText += ` Extra guests beyond ${occMin} are $${fmtCurrency(room.extraGuestFee)} per night.`;
      }
    }
    occText += ` Need more than ${occMax} rooms? Contact us to book multiple rooms for your group.`;
    if ($w('#roomOccupancy')) {
      $w('#roomOccupancy').text = occText;
    }

    if ($w('#roomGallery') && room.photos && room.photos.length) {
      $w('#roomGallery').items = room.photos.map((p) => ({
        type: 'image',
        src: p.src,
        title: p.title || '',
        description: p.description || '',
      }));
    }

    // Build guest dropdown options: baseOccupancy .. maxOccupancy
    const min = room.baseOccupancy || 1;
    const max = room.maxOccupancy || min;
    const opts = [];
    for (let g = min; g <= max; g++) {
      const label = g === min ? `${g} guests (base)` : `${g} guests`;
      opts.push({ label, value: String(g) });
    }
    $w('#dropdownGuests').options = opts;
    $w('#dropdownGuests').value = String(min);
    _guests = min;
  } catch (e) {
    setStatus('Error loading room: ' + e.message);
    return;
  }

  // Compute initial quote
  await recomputeQuote();

  // Wire events
  if ($w('#dropdownGuests')) {
    $w('#dropdownGuests').onChange(async () => {
      _guests = parseInt($w('#dropdownGuests').value, 10) || _guests;
      await recomputeQuote();
    });
  }

  if ($w('#detailCheckIn')) {
    $w('#detailCheckIn').onChange(async () => {
      const v = $w('#detailCheckIn').value;
      if (v) { _checkIn = v.toISOString(); }
      await recomputeQuote();
    });
  }

  if ($w('#detailCheckOut')) {
    $w('#detailCheckOut').onChange(async () => {
      const v = $w('#detailCheckOut').value;
      if (v) { _checkOut = v.toISOString(); }
      await recomputeQuote();
    });
  }

  if ($w('#btnContinue')) {
    $w('#btnContinue').onClick(() => {
      if (!_quote) {
        setStatus('Please wait for the price to load.');
        return;
      }
      // Pass room + dates + guests to the confirm page
      wixLocation.to(`/booking-summary?roomCode=${encodeURIComponent(_roomCode)}&checkIn=${encodeURIComponent(_checkIn)}&checkOut=${encodeURIComponent(_checkOut)}&guests=${_guests}`);
    });
  }
}

async function recomputeQuote() {
  setStatus('Computing price...');
  try {
    const ci = new Date(_checkIn);
    const co = new Date(_checkOut);
    _nights = Math.max(1, Math.round((co - ci) / (1000 * 60 * 60 * 24)));

    if (_nights < 4) {
      setStatus('We have a 4-night minimum stay.');
      clearPrices();
      return;
    }

    _quote = await quotePackage(_roomCode, _nights, null, _guests);
    renderQuote(_quote);
    setStatus('');
  } catch (e) {
    setStatus('Pricing error: ' + e.message);
    clearPrices();
  }
}

function renderQuote(q) {
  // Overall price line
  const ppn = q.packagePricePerNight;
  let priceLine = `${q.nights} nights @ $${fmtCurrency(ppn)}`;
  if (q.extraGuests > 0) {
    priceLine += ` + ${q.extraGuests} extra guest(s) @ $${fmtCurrency(q.extraPerNight)}/night`;
  }
  $w('#priceSummary').text = priceLine;
  $w('#pkgTotal').text = `$${fmtCurrency(q.totalPackagePrice)}`;

  // Line items repeater
  if ($w('#lineItemsRepeater')) {
    $w('#lineItemsRepeater').data = q.lineItems.map((li, idx) => ({
      _id: String(idx),
      label: li.label,
      net: `$${fmtCurrency(li.net)}`,
      vatRate: `${Math.round(li.vatRate * 100)}%`,
      vat: `$${fmtCurrency(li.vat)}`,
      gross: `$${fmtCurrency(li.gross)}`,
    }));
  }

  // Totals
  if ($w('#subtotalNetText')) $w('#subtotalNetText').text = `$${fmtCurrency(q.subtotalNet)}`;

  // VAT amounts from vatByClass
  const vatKeys = Object.keys(q.vatByClass);
  let vatAccom = 0, vatStd = 0;
  for (const k of vatKeys) {
    if (k.includes('accommodation')) vatAccom = q.vatByClass[k];
    else if (k.includes('standard')) vatStd = q.vatByClass[k];
  }

  const accomPct = Math.round(_currentTaxRates.accommodation * 100);
  const stdPct = Math.round(_currentTaxRates.standard * 100);

  if ($w('#vatAccommodationText')) {
    $w('#vatAccommodationText').text = `VAT ${accomPct}% (accommodation): $${fmtCurrency(vatAccom)}`;
  }
  if ($w('#vatAdventureText')) {
    $w('#vatAdventureText').text = `VAT ${stdPct}% (adventure): $${fmtCurrency(vatStd)}`;
  }

  if ($w('#totalVatText')) $w('#totalVatText').text = `$${fmtCurrency(q.totalVat)}`;
  if ($w('#propertyFeeText')) $w('#propertyFeeText').text = `$${fmtCurrency(q.propertyFee)}`;
  if ($w('#grandTotalText')) $w('#grandTotalText').text = `$${fmtCurrency(q.total)}`;
}

function clearPrices() {
  $w('#priceSummary').text = '';
  $w('#pkgTotal').text = '';
  if ($w('#lineItemsRepeater')) $w('#lineItemsRepeater').data = [];
  if ($w('#subtotalNetText')) $w('#subtotalNetText').text = '';
  if ($w('#vatAccommodationText')) $w('#vatAccommodationText').text = '';
  if ($w('#vatAdventureText')) $w('#vatAdventureText').text = '';
  if ($w('#totalVatText')) $w('#totalVatText').text = '';
  if ($w('#propertyFeeText')) $w('#propertyFeeText').text = '';
  if ($w('#grandTotalText')) $w('#grandTotalText').text = '';
}

function setStatus(msg) {
  if ($w('#detailStatusText')) $w('#detailStatusText').text = msg;
}
