/*
 * Wanderlust Booking Engine — seasonal-first per-person pricing web module.
 *
 * SeasonalRates uses one shared calendar row set with roomCode=adventure_suite
 * for every accommodation type. Each nightlyRate is per person, per night.
 * Packages.baseRate is the fallback when no seasonal rule covers a night.
 * The selected package's priceModifier is applied to either source rate.
 */

import { Permissions, webMethod } from 'wix-web-module';
import { resolvePerPersonStay } from 'backend/rateResolver';

/*
 * priceStay(roomCode, checkIn, checkOut, baseRate, priceModifier)
 *
 * roomCode remains in the public signature for compatibility, but all rooms use
 * the shared SeasonalRates calendar identified by roomCode=adventure_suite.
 * Returns totalPerPerson for the stay plus per-night/grouped audit details.
 */
export const priceStay = webMethod(
  Permissions.Anyone,
  async (roomCode, checkIn, checkOut, baseRate, priceModifier) => {
    const result = await resolvePerPersonStay(
      checkIn,
      checkOut,
      baseRate,
      priceModifier
    );
    return Object.assign({
      roomCode: roomCode || '',
      seasonalRoomCode: 'adventure_suite',
      totalRoomCharge: result.totalPerPerson,
    }, result);
  }
);
