/*
 * Wanderlust Booking Engine — Diagnostic backend for debugging.
 * File location: backend/diagnostics.web.js
 *
 * Call these from any page to inspect collection state.
 */

import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

export const getDataStatus = webMethod(
  Permissions.Anyone,
  async () => {
    // Count rooms
    const roomsRes = await wixData.query('Rooms').limit(1000).find();
    const rooms = roomsRes.items;

    // Count pricing rows
    const pricingRes = await wixData.query('RoomPricing').limit(1000).find();
    const pricing = pricingRes.items;

    // Count bookings
    const bookingsRes = await wixData.query('Bookings').limit(1000).find();
    const bookings = bookingsRes.items;

    // Count settings
    const settingsRes = await wixData.query('Settings').limit(1000).find();
    const settings = settingsRes.items;

    return {
      roomsCount: rooms.length,
      rooms: rooms.map(r => ({
        roomCode: r.roomCode,
        name: r.name,
        units: r.units,
      })),
      pricingCount: pricing.length,
      pricing: pricing.map(p => ({
        roomCode: p.roomCode,
        nights: p.nights,
        baseRate: p.baseRate,
      })),
      bookingsCount: bookings.length,
      bookings: bookings.map(b => ({
        roomCode: b.roomCode,
        status: b.status,
        guests: b.guests,
      })),
      settingsCount: settings.length,
      settingsKeys: settings.map(s => s.key),
    };
  }
);

export const testSearchDirect = webMethod(
  Permissions.Anyone,
  async (checkIn, checkOut) => {
    // Run searchAvailability and return raw result for debugging
    const { searchAvailability } = await import('backend/search.web');
    const result = await searchAvailability(checkIn, checkOut);
    return result;
  }
);

export const inspectAvailabilityData = webMethod(
  Permissions.Anyone,
  async (fromDate, toDate) => {
    // Raw diagnostic: show what exists in Bookings + BookingSummary
    const BOOKINGS = 'Bookings';
    const BOOKING_SUMMARIES = 'BookingSummary';

    const bookingRes = await wixData.query(BOOKINGS).limit(1000).find();
    const summaryRes = await wixData.query(BOOKING_SUMMARIES).limit(1000).find();

    const adventureBookings = bookingRes.items
      .filter(b => b.roomCode === 'adventure_suite')
      .map(b => ({
        _id: b._id,
        roomCode: b.roomCode,
        status: b.status,
        bookingNumber: b.bookingNumber,
        createdDate: b._createdDate,
      }));

    const adventureSummaries = summaryRes.items
      .filter(s => {
        const bnMatch = adventureBookings.some(b => String(b.bookingNumber) === String(s.bookingNumber));
        // Also include any summaries whose checkIn/checkOut overlap the requested range
        const ci = new Date(fromDate);
        const co = new Date(toDate);
        const sCi = s.checkIn ? new Date(s.checkIn) : null;
        const sCo = s.checkOut ? new Date(s.checkOut) : null;
        const overlap = sCi && sCo && (sCi < co && sCo > ci);
        return bnMatch || overlap;
      })
      .map(s => ({
        _id: s._id,
        bookingNumber: s.bookingNumber,
        checkIn: s.checkIn,
        checkOut: s.checkOut,
        rawCheckIn: typeof s.checkIn,
        rawCheckOut: typeof s.checkOut,
      }));

    return {
      adventureBookingsCount: adventureBookings.length,
      adventureBookingNumbers: adventureBookings.map(b => String(b.bookingNumber)),
      adventureSummariesCount: adventureSummaries.length,
      adventureSummaries,
      allSummaryNumbers: summaryRes.items.map(s => String(s.bookingNumber)),
      allBookingNumbers: bookingRes.items.map(b => String(b.bookingNumber)),
      dateRangeRequested: { from: fromDate, to: toDate },
    };
  }
);
