import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

export const diagnoseSearch = webMethod(
  Permissions.Anyone,
  async () => {
    const report = [];

    report.push('START');

    try {
      const r1 = await wixData.query('Rooms').limit(1).find();
      report.push('Rooms query OK, count=' + r1.items.length);
    } catch (e) {
      report.push('Rooms query FAILED: ' + e.message);
    }

    try {
      const r2 = await wixData.query('Bookings').limit(1).find();
      report.push('Bookings query OK, count=' + r2.items.length);
    } catch (e) {
      report.push('Bookings query FAILED: ' + e.message);
    }

    try {
      const r3 = await wixData.query('RoomPricing').limit(1).find();
      report.push('RoomPricing query OK, count=' + r3.items.length);
    } catch (e) {
      report.push('RoomPricing query FAILED: ' + e.message);
    }

    try {
      const r4 = await wixData.query('Rooms').limit(50).find();
      report.push('Rooms full query OK, count=' + r4.items.length);
    } catch (e) {
      report.push('Rooms full query FAILED: ' + e.message);
    }

    try {
      const r5 = await wixData.query('Bookings').limit(1000).find();
      report.push('Bookings full query OK, count=' + r5.items.length);
    } catch (e) {
      report.push('Bookings full query FAILED: ' + e.message);
    }

    report.push('END');
    return report;
  }
);
