import wixData from 'wix-data';
import { getAllSettings } from 'backend/settings.web';

const SEASONAL_RATES = 'SeasonalRates';
const BOOKINGS = 'Bookings';
const BOOKING_SUMMARIES = 'BookingSummary';
const SHARED_SEASONAL_ROOM_CODE = 'adventure_suite';
const ACTIVE_DEMAND_STATUSES = ['confirmed', 'hold', 'blocked'];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function normalizePriceModifier(value) {
  const modifier = Number(value);
  return Number.isFinite(modifier) && modifier > 0 ? modifier : 1;
}

export function normalizeDemandConfig(settings) {
  const source = settings || {};
  const rawSwitch = source.demandPricing;
  const enabled = rawSwitch === 0 || String(rawSwitch).trim() === '0';
  const roomQty = Number(source.demandRoomQty);
  const demand50 = Number(source.demand50);
  const demand75 = Number(source.demand75);
  const validRoomQty = Number.isFinite(roomQty) && roomQty > 0;
  return {
    enabled: enabled && validRoomQty,
    switchValue: source.demandPricing,
    roomQty: validRoomQty ? roomQty : 0,
    demand50: Number.isFinite(demand50) && demand50 > 0 ? demand50 : 1,
    demand75: Number.isFinite(demand75) && demand75 > 0 ? demand75 : 1,
  };
}

function utcDay(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizedRule(rule) {
  const start = utcDay(rule && rule.start);
  const end = utcDay(rule && rule.end);
  const nightlyRate = Number(rule && rule.nightlyRate);
  if (!start || !end || !Number.isFinite(nightlyRate) || nightlyRate < 0) return null;
  return {
    name: String((rule && rule.name) || 'Seasonal'),
    start,
    end,
    nightlyRate,
    priority: Number(rule && rule.priority) || 0,
  };
}

function pickRule(rules, night) {
  const matching = rules.filter(function (rule) {
    return rule.start <= night && night <= rule.end;
  });
  if (!matching.length) return null;
  matching.sort(function (a, b) {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (a.end - a.start) - (b.end - b.start);
  });
  return matching[0];
}

function countBookedRooms(bookingRows, night, excludeBookingNumber) {
  let total = 0;
  for (const booking of bookingRows || []) {
    const status = String((booking && booking.status) || '').trim().toLowerCase();
    if (ACTIVE_DEMAND_STATUSES.indexOf(status) === -1) continue;
    if (excludeBookingNumber && String(booking.bookingNumber || '') === String(excludeBookingNumber)) continue;
    const checkIn = utcDay(booking.checkIn);
    const checkOut = utcDay(booking.checkOut);
    if (!checkIn || !checkOut) continue;
    if (checkIn <= night && checkOut > night) {
      const quantity = Number(booking.quantity);
      total += Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    }
  }
  return total;
}

function demandForNight(config, bookedRooms) {
  if (!config.enabled || !config.roomQty) {
    return { tier: 'off', occupancyRatio: 0, modifier: 1 };
  }
  const occupancyRatio = bookedRooms / config.roomQty;
  if (occupancyRatio >= 0.75) {
    return { tier: 'demand75', occupancyRatio, modifier: config.demand75 };
  }
  if (occupancyRatio >= 0.50) {
    return { tier: 'demand50', occupancyRatio, modifier: config.demand50 };
  }
  return { tier: 'none', occupancyRatio, modifier: 1 };
}

async function findAll(query) {
  let result = await query.limit(1000).find({ suppressAuth: true });
  const items = (result.items || []).slice();
  while (typeof result.hasNext === 'function' && result.hasNext()) {
    result = await result.next();
    items.push.apply(items, result.items || []);
  }
  return items;
}

async function loadDemandBookingRows(checkIn, checkOut) {
  const activePromise = findAll(
    wixData.query(BOOKINGS).hasSome('status', ACTIVE_DEMAND_STATUSES)
  );
  const summariesPromise = findAll(
    wixData.query(BOOKING_SUMMARIES)
      .lt('checkIn', checkOut)
      .gt('checkOut', checkIn)
  );
  const results = await Promise.all([activePromise, summariesPromise]);
  const activeRows = results[0];
  const dateMap = {};
  for (const summary of results[1]) {
    if (summary.bookingNumber && summary.checkIn && summary.checkOut) {
      dateMap[String(summary.bookingNumber)] = {
        checkIn: summary.checkIn,
        checkOut: summary.checkOut,
      };
    }
  }
  return activeRows.map(function (row) {
    if (row.checkIn && row.checkOut) return row;
    const dates = dateMap[String(row.bookingNumber || '')];
    return dates ? Object.assign({}, row, dates) : row;
  });
}

export function calculatePerPersonStay(
  rules,
  checkIn,
  checkOut,
  baseRate,
  priceModifier,
  demandSettings,
  bookingRows,
  excludeBookingNumber
) {
  const ci = utcDay(checkIn);
  const co = utcDay(checkOut);
  if (!ci || !co) throw new Error('checkIn and checkOut must be valid dates');

  const nights = Math.round((co - ci) / ONE_DAY_MS);
  if (nights <= 0) throw new Error('checkOut must be after checkIn');

  const fallbackRate = Number(baseRate);
  if (!Number.isFinite(fallbackRate) || fallbackRate < 0) {
    throw new Error('baseRate must be a valid non-negative number');
  }

  const modifier = normalizePriceModifier(priceModifier);
  const demandConfig = normalizeDemandConfig(demandSettings);
  const validRules = (rules || []).map(normalizedRule).filter(Boolean);
  const perNight = [];

  for (let i = 0; i < nights; i++) {
    const night = new Date(ci.getTime() + (i * ONE_DAY_MS));
    const rule = pickRule(validRules, night);
    const sourceRate = rule ? rule.nightlyRate : fallbackRate;
    const bookedRooms = demandConfig.enabled
      ? countBookedRooms(bookingRows, night, excludeBookingNumber)
      : 0;
    const demand = demandForNight(demandConfig, bookedRooms);
    const demandAdjustedRate = roundMoney(sourceRate * demand.modifier);
    const effectiveRate = roundMoney(demandAdjustedRate * modifier);
    perNight.push({
      date: night.toISOString().slice(0, 10),
      season: rule ? rule.name : 'Base',
      source: rule ? 'seasonal' : 'base',
      sourceRate: roundMoney(sourceRate),
      bookedRooms,
      demandRoomQty: demandConfig.roomQty,
      occupancyRatio: demand.occupancyRatio,
      demandTier: demand.tier,
      demandModifier: demand.modifier,
      demandAdjustedRate,
      priceModifier: modifier,
      effectiveRate,
    });
  }

  const grouped = [];
  for (const night of perNight) {
    const last = grouped[grouped.length - 1];
    if (
      last &&
      last.season === night.season &&
      last.effectiveRate === night.effectiveRate &&
      last.demandTier === night.demandTier &&
      last.bookedRooms === night.bookedRooms
    ) {
      last.nights += 1;
      last.subtotal = roundMoney(last.effectiveRate * last.nights);
    } else {
      grouped.push({
        season: night.season,
        source: night.source,
        sourceRate: night.sourceRate,
        bookedRooms: night.bookedRooms,
        demandRoomQty: night.demandRoomQty,
        occupancyRatio: night.occupancyRatio,
        demandTier: night.demandTier,
        demandModifier: night.demandModifier,
        demandAdjustedRate: night.demandAdjustedRate,
        priceModifier: modifier,
        effectiveRate: night.effectiveRate,
        nights: 1,
        subtotal: night.effectiveRate,
      });
    }
  }

  const totalPerPerson = roundMoney(perNight.reduce(function (sum, night) {
    return sum + night.effectiveRate;
  }, 0));

  return {
    nights,
    demandPricingEnabled: demandConfig.enabled,
    demandRoomQty: demandConfig.roomQty,
    priceModifier: modifier,
    totalPerPerson,
    averageNightlyRate: roundMoney(totalPerPerson / nights),
    grouped,
    perNight,
  };
}

export async function resolvePerPersonStay(
  checkIn,
  checkOut,
  baseRate,
  priceModifier,
  excludeBookingNumber
) {
  const ci = utcDay(checkIn);
  const co = utcDay(checkOut);
  if (!ci || !co || co <= ci) throw new Error('checkIn and checkOut must be valid dates');

  const settings = await getAllSettings();
  const demandConfig = normalizeDemandConfig(settings);
  const seasonalPromise = findAll(
    wixData.query(SEASONAL_RATES).eq('roomCode', SHARED_SEASONAL_ROOM_CODE)
  );
  const bookingsPromise = demandConfig.enabled
    ? loadDemandBookingRows(ci, co)
    : Promise.resolve([]);

  const results = await Promise.all([seasonalPromise, bookingsPromise]);
  return calculatePerPersonStay(
    Array.isArray(results[0]) ? results[0] : [],
    ci,
    co,
    baseRate,
    priceModifier,
    settings,
    Array.isArray(results[1]) ? results[1] : [],
    excludeBookingNumber || ''
  );
}
