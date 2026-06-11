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
        checkIn: b.checkIn,
        checkOut: b.checkOut,
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
