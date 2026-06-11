import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

const ROOM_PRICING = 'RoomPricing';

export const getBaseRate = webMethod(
  Permissions.Anyone,
  async (roomCode, nights) => {
    let res = await wixData.query(ROOM_PRICING)
      .eq('roomCode', roomCode)
      .eq('nights', nights)
      .limit(1)
      .find();
    if (!res.items.length) {
      res = await wixData.query(ROOM_PRICING)
        .eq('roomCode', roomCode)
        .eq('nights', String(nights))
        .limit(1)
        .find();
    }
    if (!res.items.length) return null;
    return res.items[0].baseRate;
  }
);

export const getAllRatesForRoom = webMethod(
  Permissions.Anyone,
  async (roomCode) => {
    let results = [];
    let page = await wixData.query(ROOM_PRICING)
      .eq('roomCode', roomCode)
      .ascending('nights')
      .limit(100)
      .find();
    results = results.concat(page.items);
    while (page.hasNext()) {
      page = await page.next();
      results = results.concat(page.items);
    }
    return results.map((r) => ({ nights: r.nights, baseRate: r.baseRate }));
  }
);

export const setBaseRate = webMethod(
  Permissions.Admin,
  async (roomCode, nights, baseRate) => {
    if (!roomCode) throw new Error('roomCode required');
    if (nights < 1) throw new Error('nights must be >= 1');
    if (baseRate == null || baseRate <= 0) throw new Error('baseRate must be > 0');

    const res = await wixData.query(ROOM_PRICING)
      .eq('roomCode', roomCode)
      .eq('nights', nights)
      .limit(1)
      .find();

    if (res.items.length) {
      const row = res.items[0];
      row.baseRate = baseRate;
      return wixData.update(ROOM_PRICING, row);
    }
    return wixData.insert(ROOM_PRICING, { roomCode: roomCode, nights: nights, baseRate: baseRate });
  }
);

export const removeBaseRate = webMethod(
  Permissions.Admin,
  async (roomCode, nights) => {
    const res = await wixData.query(ROOM_PRICING)
      .eq('roomCode', roomCode)
      .eq('nights', nights)
      .limit(1)
      .find();
    if (!res.items.length) return null;
    return wixData.remove(ROOM_PRICING, res.items[0]._id);
  }
);
