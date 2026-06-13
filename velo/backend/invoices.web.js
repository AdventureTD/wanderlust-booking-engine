/*
 * Wanderlust Booking Engine — Velo backend: invoice generation.
 * File location in Wix Editor: backend/invoices.web.js
 *
 * Generates a PDF invoice by calling the external Render service.
 * The service emails the PDF to the guest + info@wanderlustcaribbean.com
 * and returns the invoice number. We store only the invoice number on the
 * booking row (in the bookingNumber field).
 *
 * Requires:
 *   - Wix Secrets Manager: WBE_INVOICE_SERVICE_URL, WBE_SHARED_SECRET
 */

import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';
import { issueInvoice } from 'backend/issueInvoice';

const BOOKINGS = 'Bookings';

function nightsBetween(checkIn, checkOut) {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function capitaliseWords(s) {
  return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function buildQuoteBreakdown(booking) {
  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  const roomTotal = booking.roomTotal || 0;
  const propertyFee = booking.propertyFee || 0;
  const accommodationShare = 0.5;
  const taxRateAccommodation = 0.10;
  const taxRateStandard = 0.15;

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

export const generateAndStoreInvoice = webMethod(
  Permissions.Anyone,
  async (bookingId) => {
    console.log('>>> INVOICE generate called for bookingId:', bookingId);

    const booking = await wixData.get(BOOKINGS, bookingId);
    if (!booking) throw new Error('Booking ' + bookingId + ' not found');

    const quoteBreakdown = buildQuoteBreakdown(booking);
    console.log('>>> INVOICE quote total:', quoteBreakdown.total);

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
      result = await issueInvoice(guest, quoteBreakdown, dates, true); // true = send email
      console.log('>>> INVOICE service returned number:', result.invoice_number);
    } catch (e) {
      console.log('>>> INVOICE issueInvoice ERROR:', e.message);
      throw new Error('Invoice generation failed: ' + e.message);
    }

    // Store invoice number in bookingNumber field
    booking.bookingNumber = result.invoice_number;
    await wixData.update(BOOKINGS, booking);
    console.log('>>> INVOICE booking updated with', result.invoice_number);

    return {
      invoiceNumber: result.invoice_number,
      total: result.total,
      emailed: result.emailed || false
    };
  }
);
