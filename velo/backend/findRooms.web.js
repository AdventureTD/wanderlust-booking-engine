import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

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

      const br = await wixData.query('Bookings').limit(1000).find();
      const bookings = br.items;

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
          const st = ['Confirmed', 'In-House', 'hold', 'Pending Confirmation'];
          let valid = false;
          for (let s = 0; s < st.length; s++) {
            if (bk.status === st[s]) { valid = true; break; }
          }
          if (!valid) continue;
          if (bk.checkIn < co && bk.checkOut > ci) {
            blocked = true;
            break;
          }
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
