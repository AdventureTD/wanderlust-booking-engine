/*
 * Wanderlust Booking Engine — Velo backend: seasonal rate calendar.
 * File location in Wix Editor: backend/seasonal.web.js
 *
 * Mirrors the tested Python engine (booking_engine/seasonal.py). Reads seasonal
 * rules from the `SeasonalRates` collection and resolves a nightly rate per
 * night, so boundary-crossing stays price correctly and high-priority holiday
 * rules override broad seasons.
 *
 * RateRule date semantics: range is INCLUSIVE of both start and end.
 * Stay nights are the half-open interval [checkIn, checkOut).
 */

import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';
import { round2 } from 'backend/wbeConfig';

const SEASONAL = 'SeasonalRates';

function addDays(dt, n) {
  const x = new Date(dt);
  x.setDate(x.getDate() + n);
  return x;
}
function dayStart(dt) {
  const x = new Date(dt);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Pick the winning rule for a single night from candidate rules.
// Highest priority wins; tiebreak: narrowest span (more specific).
function pickRule(rules, night) {
  const matching = rules.filter(
    (r) => dayStart(r.start) <= night && night <= dayStart(r.end)
  );
  if (matching.length === 0) return null;
  matching.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const spanA = (dayStart(a.end) - dayStart(a.start));
    const spanB = (dayStart(b.end) - dayStart(b.start));
    return spanA - spanB;
  });
  return matching[0];
}

/*
 * priceStay(roomCode, checkIn, checkOut, baseRate)
 * Returns { totalRoomCharge, nights, grouped:[{season,rate,nights,subtotal}] }
 * Tax is applied later by pricing.web.js (accommodation = 10%).
 */
export const priceStay = webMethod(
  Permissions.Anyone,
  async (roomCode, checkIn, checkOut, baseRate) => {
    const ci = dayStart(checkIn);
    const co = dayStart(checkOut);
    const nights = Math.round((co - ci) / (1000 * 60 * 60 * 24));
    if (nights <= 0) throw new Error('checkOut must be after checkIn');

    // Load this room's seasonal rules once.
    const ruleRes = await wixData.query(SEASONAL).eq('roomCode', roomCode).find();
    const rules = ruleRes.items;

    const perNight = [];
    for (let i = 0; i < nights; i++) {
      const night = addDays(ci, i);
      const rule = pickRule(rules, night);
      perNight.push({
        rate: rule ? rule.nightlyRate : baseRate,
        season: rule ? rule.name : 'Base',
      });
    }

    // Collapse consecutive same (season,rate) runs.
    const grouped = [];
    for (const pn of perNight) {
      const last = grouped[grouped.length - 1];
      if (last && last.season === pn.season && last.rate === pn.rate) {
        last.nights += 1;
        last.subtotal = round2(last.nights * last.rate);
      } else {
        grouped.push({ season: pn.season, rate: pn.rate, nights: 1,
                       subtotal: round2(pn.rate) });
      }
    }
    const totalRoomCharge = round2(perNight.reduce((s, p) => s + p.rate, 0));
    return { totalRoomCharge, nights, grouped };
  }
);
