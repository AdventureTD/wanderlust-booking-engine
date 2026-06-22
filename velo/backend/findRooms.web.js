import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

const BOOKING_SUMMARIES = 'BookingSummary';
const BOOKINGS = 'Bookings';

export const findRooms = webMethod(
  Permissions.Anyone,
  async (checkInStr, checkOutStr) => {
    try {
      const ci = new Date(checkInStr);
      const co = new Date(checkOutStr);
      if (isNaN(ci.getTime()) || isNaN(co.getTime())) {
        return { ok: false, error: 'Invalid dates' };
      }
      if (co <= ci) {
        return { ok: false, error: 'Check-out must be after check-in' };
      }
      const nights = Math.round((co - ci) / 86400000);
      if (nights < 4) {
        return { ok: false, error: '4-night minimum' };
      }

      const rr = await wixData.query('Rooms').limit(50).find();
      const rooms = rr.items;

      // Primary: join via BookingSummary (new canonical path)
      const summaryRes = await wixData.query(BOOKING_SUMMARIES)
        .lt('checkIn', co)
        .gt('checkOut', ci)
        .limit(1000)
        .find();

      const overlapNumbers = [];
      for (const s of summaryRes.items) {
        if (s.bookingNumber && overlapNumbers.indexOf(String(s.bookingNumber)) === -1) {
          overlapNumbers.push(String(s.bookingNumber));
        }
      }

      let bookings = [];
      if (overlapNumbers.length > 0) {
        const res = await wixData.query(BOOKINGS)
          .hasSome('bookingNumber', overlapNumbers)
          .hasSome('status', ['Confirmed', 'In-House', 'hold', 'Pending Confirmation'])
          .limit(1000)
          .find();
        bookings = bookings.concat(res.items);
      }

      // Legacy fallback: rows that still store checkIn on Bookings directly
      const legacyRes = await wixData.query(BOOKINGS)
        .hasSome('status', ['Confirmed', 'In-House', 'hold', 'Pending Confirmation'])
        .lt('checkIn', co)
        .gt('checkOut', ci)
        .limit(1000)
        .find();
      const seenIds = [];
      for (const row of bookings) { if (row._id) seenIds.push(row._id); }
      for (const row of legacyRes.items) {
        if (row._id && seenIds.indexOf(row._id) >= 0) continue;
        bookings.push(row);
      }

      const pr = await wixData.query('RoomPricing').limit(1000).find();
      const prices = {};
      for (let i = 0; i < pr.items.length; i++) {
        const p = pr.items[i];
        prices[p.roomCode + '|' + p.nights] = p.baseRate;
      }

      const results = [];
      for (let r = 0; r < rooms.length; r++) {
        const room = rooms[r];
        const code = room.roomCode;
        const rate = prices[code + '|' + nights];
        if (rate === undefined) continue;

        let blocked = false;
        for (let b = 0; b < bookings.length; b++) {
          const bk = bookings[b];
          if (bk.roomCode !== code) continue;
          blocked = true;
          break;
        }

        if (!blocked) {
          results.push({
            roomCode: code,
            roomName: room.name || code,
            status: 'full',
            availableNights: nights,
            baseRate: rate,
          });
        }
      }

      return { ok: true, requestedNights: nights, results: results };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
);
