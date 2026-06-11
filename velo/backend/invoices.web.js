/*
 * Wanderlust Booking Engine — Velo backend: invoice generation & storage.
 * File location in Wix Editor: backend/invoices.web.js
 *
 * Generates a PDF invoice from a booking row by:
 *   1. Reconstructing the pricing quote_breakdown from the booking data.
 *   2. Calling the external invoice service (issueInvoice.web.js).
 *   3. Uploading the returned PDF to Wix Media Manager.
 *   4. Storing the invoice number + PDF URL on the booking row.
 *
 * Requires:
 *   - Wix Secrets Manager keys: WBE_INVOICE_SERVICE_URL, WBE_SHARED_SECRET
 *   - Bookings collection fields: invoiceNumber (Text), invoiceUrl (Text)
 *   - mediaManager.upload permission (auto-granted in backend)
 */

import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';
import { mediaManager } from 'wix-media-backend';
import { issueInvoice } from 'backend/issueInvoice';
import { getAllSettings } from 'backend/settings';

const BOOKINGS = 'Bookings';

function nightsBetween(checkIn, checkOut) {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function capitaliseWords(s) {
  return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

/*
 * Rebuild a quote_breakdown dict from a Bookings row + tax settings.
 * This mirrors the dual-VAT split the frontend computed.
 */
function buildQuoteBreakdown(booking, settings) {
  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  const roomTotal = booking.roomTotal || 0;
  const propertyFee = booking.propertyFee || 0;
  const accommodationShare = parseFloat(settings.accommodationShare) || 0.5;
  const taxRateAccommodation = parseFloat(settings.taxRate_accommodation) || 0.10;
  const taxRateStandard = parseFloat(settings.taxRate_standard) || 0.15;

  const accNet = roomTotal * accommodationShare;
  const advNet = roomTotal * (1 - accommodationShare);
  const accVat = accNet * taxRateAccommodation;
  const pkgVat = advNet * taxRateStandard;

  const accUnitPrice = nights > 0 ? accNet / nights : 0;
  const advUnitPrice = nights > 0 ? advNet / nights : 0;

  const displayName = capitaliseWords((booking.roomCode || '').replace(/_/g, ' '));

  return {
    line_items: [
      {
        label: displayName + ' — Accommodation',
        tax_class: 'accommodation',
        quantity: nights,
        unit_price: accUnitPrice,
        net: accNet,
        vat_rate: taxRateAccommodation,
        vat: accVat,
        gross: accNet + accVat
      },
      {
        label: displayName + ' — Activities & Services',
        tax_class: 'standard',
        quantity: nights,
        unit_price: advUnitPrice,
        net: advNet,
        vat_rate: taxRateStandard,
        vat: pkgVat,
        gross: advNet + pkgVat
      }
    ],
    subtotal_net: roomTotal,
    total_vat: Math.round((accVat + pkgVat + Number.EPSILON) * 100) / 100,
    total: roomTotal + propertyFee + accVat + pkgVat,
    property_fee_rate: roomTotal > 0 ? propertyFee / roomTotal : 0,
    property_fee: propertyFee,
    currency: 'USD'
  };
}

/*
 * generateAndStoreInvoice(bookingId)
 *   Produces a PDF invoice for one booking row, uploads it to Wix Media,
 *   and writes invoiceNumber + invoiceUrl back to the Bookings collection.
 *
 * Returns { invoiceNumber, invoiceUrl, total, emailed }
 */
export const generateAndStoreInvoice = webMethod(
  Permissions.Anyone,
  async (bookingId) => {
    console.log('>>> INVOICE generateAndStoreInvoice called for bookingId:', bookingId);

    // 1. Fetch booking
    const booking = await wixData.get(BOOKINGS, bookingId);
    if (!booking) throw new Error('Booking ' + bookingId + ' not found');
    console.log('>>> INVOICE booking found:', booking.bookingNumber || bookingId);

    // 2. Get tax settings
    let settings = {};
    try { settings = await getAllSettings(); } catch (e) { console.log('>>> INVOICE settings fetch error:', e.message); }

    // 3. Build quote breakdown
    const quoteBreakdown = buildQuoteBreakdown(booking, settings);
    console.log('>>> INVOICE quote total:', quoteBreakdown.total);

    // 4. Call external PDF service
    const guest = {
      name: booking.guestName || '',
      email: booking.guestEmail || '',
      phone: booking.guestPhone || ''
    };
    const dates = {
      checkIn: booking.checkIn.toISOString().slice(0, 10),
      checkOut: booking.checkOut.toISOString().slice(0, 10),
      roomCode: booking.roomCode || ''
    };

    let result;
    try {
      result = await issueInvoice(guest, quoteBreakdown, dates);
      console.log('>>> INVOICE service returned number:', result.invoice_number);
    } catch (e) {
      console.log('>>> INVOICE issueInvoice ERROR:', e.message);
      throw new Error('Invoice generation failed: ' + e.message);
    }

    if (!result.pdf_base64) {
      console.log('>>> INVOICE no pdf_base64 in service result');
      throw new Error('Invoice service did not return a PDF');
    }

    // 5. Upload PDF to Wix Media Manager
    console.log('>>> INVOICE uploading PDF to media manager...');
    let uploadResult;
    try {
      const pdfBuffer = Buffer.from(result.pdf_base64, 'base64');
      const fileName = result.pdf_filename || (result.invoice_number + '.pdf');
      uploadResult = await mediaManager.upload(
        '/invoices',
        pdfBuffer,
        fileName,
        { mediaOptions: { mimeType: 'application/pdf', kind: 'DOCUMENT' } }
      );
      console.log('>>> INVOICE upload OK, url:', uploadResult.fileUrl);
    } catch (e) {
      console.log('>>> INVOICE upload ERROR:', e.message);
      throw new Error('PDF upload failed: ' + e.message);
    }

    // 6. Write invoice number into bookingNumber (overwrites the temporary WC- number)
    booking.bookingNumber = result.invoice_number;
    booking.invoiceUrl = uploadResult.fileUrl;
    await wixData.update(BOOKINGS, booking);
    console.log('>>> INVOICE booking updated with', result.invoice_number);

    return {
      invoiceNumber: result.invoice_number,
      invoiceUrl: uploadResult.fileUrl,
      total: result.total,
      emailed: result.emailed || false
    };
  }
);
