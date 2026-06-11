import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

export const testQuery = webMethod(
  Permissions.Anyone,
  async (collectionName) => {
    try {
      const res = await wixData.query(collectionName).limit(1).find();
      return {
        ok: true,
        totalCount: res.items.length,
        hasNext: res.hasNext(),
        firstItemKeys: res.items.length ? Object.keys(res.items[0]) : [],
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
);

export const testBookingsFilter = webMethod(
  Permissions.Anyone,
  async () => {
    try {
      const count = await wixData.query('Bookings')
        .eq('roomCode', 'adventure_suite')
        .hasSome('status', ['Confirmed'])
        .lt('checkIn', new Date('2026-06-15'))
        .gt('checkOut', new Date('2026-06-10'))
        .count();
      return { ok: true, count: count };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
);
