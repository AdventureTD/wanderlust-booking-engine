import wixData from 'wix-data';

const SEASONAL_RATES = 'SeasonalRates';
const SHARED_SEASONAL_ROOM_CODE = 'adventure_suite';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function normalizePriceModifier(value) {
  const modifier = Number(value);
  return Number.isFinite(modifier) && modifier > 0 ? modifier : 1;
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

export function calculatePerPersonStay(rules, checkIn, checkOut, baseRate, priceModifier) {
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
  const validRules = (rules || []).map(normalizedRule).filter(Boolean);
  const perNight = [];

  for (let i = 0; i < nights; i++) {
    const night = new Date(ci.getTime() + (i * ONE_DAY_MS));
    const rule = pickRule(validRules, night);
    const sourceRate = rule ? rule.nightlyRate : fallbackRate;
    const effectiveRate = roundMoney(sourceRate * modifier);
    perNight.push({
      date: night.toISOString().slice(0, 10),
      season: rule ? rule.name : 'Base',
      source: rule ? 'seasonal' : 'base',
      sourceRate: roundMoney(sourceRate),
      priceModifier: modifier,
      effectiveRate,
    });
  }

  const grouped = [];
  for (const night of perNight) {
    const last = grouped[grouped.length - 1];
    if (last && last.season === night.season && last.effectiveRate === night.effectiveRate) {
      last.nights += 1;
      last.subtotal = roundMoney(last.effectiveRate * last.nights);
    } else {
      grouped.push({
        season: night.season,
        source: night.source,
        sourceRate: night.sourceRate,
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
    priceModifier: modifier,
    totalPerPerson,
    averageNightlyRate: roundMoney(totalPerPerson / nights),
    grouped,
    perNight,
  };
}

export async function resolvePerPersonStay(checkIn, checkOut, baseRate, priceModifier) {
  const result = await wixData.query(SEASONAL_RATES)
    .eq('roomCode', SHARED_SEASONAL_ROOM_CODE)
    .limit(1000)
    .find();
  return calculatePerPersonStay(
    result && Array.isArray(result.items) ? result.items : [],
    checkIn,
    checkOut,
    baseRate,
    priceModifier
  );
}
