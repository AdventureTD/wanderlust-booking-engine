/*
 * Wanderlust Booking Engine — Velo backend: NEW package pricing.
 * File location in Wix Editor: backend/packagePricing.web.js
 *
 * Replaces the old room-rate + separate-packages + extra-guest model.
 *
 * UPDATED 2026-06-03: the per-night rate now comes from the RoomPricing
 * collection (keyed by roomCode + nights) instead of a single fixed
 * packagePricePerNight on the Rooms collection. If no rate is defined
 * for the requested room + night count, an error is thrown.
 *
 * Tax rates are configurable via Settings collection (editable in Admin Console).
 * Defaults: accommodation 10%, standard 15%.
 *
 * Mirrors the tested Python engine (booking_engine/package_pricing.py).
 */

import { Permissions, webMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { round2 } from 'backend/wbeConfig';
import { getAccommodationShare, getPropertyFeeRate, getAllTaxRates } from 'backend/settings.web';
import { getBaseRate } from 'backend/roomPricing.web';

const ROOMS = 'Rooms';

export const quotePackage = webMethod(
  Permissions.Anyone,
  async (roomCode, nights, packagePricePerNight = null, guests = null,
         accommodationShare = null, propertyFeeRate = null) => {
    if (nights < 1) throw new Error('nights must be >= 1');

    const rates = await getAllTaxRates();

    // The split is an editable admin setting; read it if not explicitly passed.
    let share = accommodationShare;
    if (share === null) share = await getAccommodationShare();
    if (!(share >= 0 && share <= 1)) {
      throw new Error(`accommodationShare must be between 0 and 1; got ${share}`);
    }

    // The property fee rate is an editable admin setting; read it if not passed.
    let feeRate = propertyFeeRate;
    if (feeRate === null) feeRate = await getPropertyFeeRate();
    if (!(feeRate >= 0 && feeRate <= 1)) {
      throw new Error(`propertyFeeRate must be between 0 and 1; got ${feeRate}`);
    }

    // Rate lookup: explicit override > RoomPricing collection
    let ppn = packagePricePerNight;
    if (ppn === null) {
      ppn = await getBaseRate(roomCode, nights);
      if (ppn === null) {
        throw new Error(
          `No rate defined for ${roomCode} at ${nights} nights. `
          + `Add a row to the RoomPricing collection for this combination.`
        );
      }
    }

    // Get room details (name, occupancy) from the Rooms collection.
    let roomName = roomCode;
    let baseOcc = null, maxOcc = null;
    const res = await wixData.query(ROOMS).eq('roomCode', roomCode).limit(1).find();
    if (!res.items.length) throw new Error(`Unknown room: ${roomCode}`);
    const row = res.items[0];
    roomName = row.name;
    baseOcc = row.baseOccupancy;
    maxOcc = row.maxOccupancy;

    if (!ppn || ppn <= 0) throw new Error(`${roomCode} has no Adventure Package price set.`);

    // Occupancy validation.
    if (guests === null) guests = baseOcc;
    if (guests < baseOcc) {
      throw new Error(`${roomName} requires at least ${baseOcc} guests `
        + `(no single-guest bookings); requested ${guests}.`);
    }
    if (guests > maxOcc) {
      throw new Error(`${roomName} sleeps ${maxOcc}; requested ${guests}.`);
    }

    const baseTotal = round2(nights * ppn);
    // Extra-guest charge = 1/3 of the base per-night rate, per extra guest, per night.
    const extraGuests = guests - baseOcc;
    const extraPerNight = round2(ppn / 3.0);
    const extraTotal = round2(extraGuests * extraPerNight * nights);

    const total = round2(baseTotal + extraTotal);
    const accommodationNet = round2(total * share);
    const adventureNet = round2(total - accommodationNet);  // remainder -> exact
    const vatAcc = round2(accommodationNet * rates.accommodation);
    const vatAdv = round2(adventureNet * rates.standard);
    const totalVat = round2(vatAcc + vatAdv);
    // Property fee on the NET package price, below the VAT lines, untaxed.
    const propertyFee = round2(total * feeRate);
    const grand = round2(total + totalVat + propertyFee);

    return {
      currency: 'USD',
      roomCode, roomName, nights, guests,
      packagePricePerNight: ppn,
      accommodationShare: share,
      baseTotal, extraGuests, extraPerNight, extraTotal,
      totalPackagePrice: total,
      lineItems: [
        { label: `Accommodation (${roomName})`, taxClass: 'accommodation',
          vatRate: rates.accommodation, net: accommodationNet, vat: vatAcc,
          gross: round2(accommodationNet + vatAcc) },
        { label: `Adventure Package (${roomName})`, taxClass: 'standard',
          vatRate: rates.standard, net: adventureNet, vat: vatAdv,
          gross: round2(adventureNet + vatAdv) },
      ],
      subtotalNet: round2(accommodationNet + adventureNet),
      vatByClass: {
        [`accommodation (${Math.round(rates.accommodation * 100)}%)`]: vatAcc,
        [`standard (${Math.round(rates.standard * 100)}%)`]: vatAdv,
      },
      totalVat,
      propertyFeeRate: feeRate,
      propertyFee,
      total: grand,
    };
  }
);
