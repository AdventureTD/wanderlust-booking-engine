/*
 * Wanderlust Booking Engine — Velo backend: dual-VAT pricing/quote.
 * File location in Wix Editor: backend/pricing.web.js
 *
 * Mirrors the tested Python pricing engine (booking_engine/pricing.py), whose
 * numbers are proven by passing tests:
 *   - room 5n@300 + package 2x@1000  => total $3950.00
 *   - a la carte 2x@150              => total $345.00
 *   - room 7n@400 + Wanderluster 2x@2820 + chef 1x@250 => total $9853.50
 * If you change this file, re-run the Python tests and keep results identical.
 *
 * Tax rules (configurable in Admin Console > Settings):
 *   accommodation -> rate from Settings (default 10%)
 *   standard      -> rate from Settings (default 15%)
 *
 * Default tax-EXCLUSIVE (VAT added on top). Set pricesIncludeVat=true if your
 * listed prices already include VAT (engine then back-computes net + tax).
 */

import { Permissions, webMethod } from 'wix-web-module';
import { round2, ROOM_DEFAULTS } from 'backend/wbeConfig';
import { getAllTaxRates } from 'backend/settings.web';

/*
 * extraGuestLine(roomCode, nights, guests, roomRow)
 * Returns an accommodation line item for guests beyond base occupancy, or null.
 * Mirrors Python Quote._add_extra_guests. roomRow (from Rooms collection) wins
 * over ROOM_DEFAULTS so the owner's edited values are authoritative.
 */
export function extraGuestLine(roomCode, nights, guests, roomRow) {
  const cfg = roomRow || ROOM_DEFAULTS[roomCode];
  if (!cfg || !guests) return null;
  const maxOcc = cfg.maxOccupancy;
  if (guests > maxOcc) {
    throw new Error(`${roomCode} sleeps ${maxOcc}; requested ${guests}.`);
  }
  const extra = guests - cfg.baseOccupancy;
  const fee = cfg.extraGuestFee || 0;
  if (extra > 0 && fee > 0) {
    return {
      label: `Extra guest x${extra} (${nights} night(s) @ $${fee.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})})`,
      taxClass: 'accommodation',
      quantity: extra * nights,
      unitPrice: fee,
    };
  }
  return null;
}

function calcLine(qty, unitPrice, taxClass, rates, pricesIncludeVat) {
  const rate = rates[taxClass];
  if (rate === undefined) throw new Error(`Invalid tax_class '${taxClass}'`);

  if (pricesIncludeVat) {
    const gross = qty * unitPrice;
    const net = gross / (1 + rate);
    const vat = gross - net;
    return { net: round2(net), vat: round2(vat), gross: round2(gross), rate };
  }

  const net = round2(qty * unitPrice);
  const vat = round2(net * rate);
  const gross = round2(net + vat);
  return { net, vat, gross, rate };
}

/*
 * buildQuote(items, pricesIncludeVat)
 *   items: [{ label, taxClass, quantity, unitPrice }]
 *   taxClass: "accommodation" | "standard"
 * Returns a fully itemized breakdown matching the Python engine's shape.
 */
export const buildQuote = webMethod(
  Permissions.Anyone,
  async (items, pricesIncludeVat = false) => {
    const rates = await getAllTaxRates();

    const lineItems = items.map((it) => {
      const calc = calcLine(it.quantity, it.unitPrice, it.taxClass, rates, pricesIncludeVat);
      return {
        label: it.label,
        taxClass: it.taxClass,
        vatRate: calc.rate,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        net: calc.net,
        vat: calc.vat,
        gross: calc.gross,
      };
    });

    const subtotalNet = round2(lineItems.reduce((s, li) => s + li.net, 0));

    const vatByClass = {};
    for (const li of lineItems) {
      vatByClass[li.taxClass] = round2((vatByClass[li.taxClass] || 0) + li.vat);
    }
    const totalVat = round2(Object.values(vatByClass).reduce((s, v) => s + v, 0));
    const total = round2(subtotalNet + totalVat);

    return {
      currency: 'USD',
      pricesIncludeVat,
      lineItems,
      subtotalNet,
      vatByClass,            // e.g. { accommodation: 150, standard: 300 }
      totalVat,
      total,
    };
  }
);
