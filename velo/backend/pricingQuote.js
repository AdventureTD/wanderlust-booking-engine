import crypto from 'crypto';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { resolvePerPersonStay, normalizePriceModifier } from 'backend/rateResolver';

const QUOTE_SECRET_KEY = 'WBE_PRICING_QUOTE_SECRET';
const QUOTE_VERSION = 1;
const QUOTE_LIFETIME_MS = 60 * 60 * 1000;

function dateString(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return match[1] + '-' + match[2] + '-' + match[3];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function nightsBetween(checkIn, checkOut) {
  const ci = new Date(dateString(checkIn) + 'T00:00:00.000Z');
  const co = new Date(dateString(checkOut) + 'T00:00:00.000Z');
  return Math.round((co - ci) / 86400000);
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(value) {
  let encoded = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (encoded.length % 4) encoded += '=';
  return Buffer.from(encoded, 'base64').toString('utf8');
}

async function quoteSecret() {
  const secret = await getSecret(QUOTE_SECRET_KEY);
  if (!secret || String(secret).length < 32) {
    throw new Error(QUOTE_SECRET_KEY + ' must be configured with at least 32 characters');
  }
  return String(secret);
}

function signature(encodedPayload, secret) {
  return crypto.createHmac('sha256', secret)
    .update(encodedPayload, 'utf8')
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function packageForQuote(packageId, nights) {
  if (!packageId) throw new Error('packageId is required');
  const result = await wixData.query('Packages').eq('_id', packageId).limit(1).find();
  const item = result.items[0];
  if (!item) throw new Error('Selected package was not found');
  const packageNights = item.numberOfNights || item.NumberOfNights || item.numberofnights || 0;
  if (Number(packageNights) !== Number(nights)) {
    throw new Error('Selected package does not match the requested stay length');
  }
  const baseRate = Number(item.baseRate);
  if (!Number.isFinite(baseRate) || baseRate < 0) throw new Error('Selected package has an invalid baseRate');
  return {
    packageId: item._id,
    packageTitle: item.title || item.title_fld || item.Title || item.name || item.Name || '',
    baseRate,
    priceModifier: normalizePriceModifier(item.priceModifier),
  };
}

export async function createLockedPricingQuote(packageId, checkIn, checkOut) {
  const ci = dateString(checkIn);
  const co = dateString(checkOut);
  const nights = nightsBetween(ci, co);
  if (!ci || !co || nights <= 0) throw new Error('Valid check-in and check-out dates are required');

  const packageData = await packageForQuote(packageId, nights);
  const pricing = await resolvePerPersonStay(
    ci,
    co,
    packageData.baseRate,
    packageData.priceModifier
  );
  const now = Date.now();
  const payload = {
    v: QUOTE_VERSION,
    nonce: crypto.randomBytes(12).toString('hex'),
    issuedAt: now,
    expiresAt: now + QUOTE_LIFETIME_MS,
    checkIn: ci,
    checkOut: co,
    nights,
    packageId: packageData.packageId,
    packageTitle: packageData.packageTitle,
    baseRate: packageData.baseRate,
    priceModifier: packageData.priceModifier,
    totalPerPerson: pricing.totalPerPerson,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const secret = await quoteSecret();
  const token = encodedPayload + '.' + signature(encodedPayload, secret);
  return {
    token,
    quote: payload,
    pricing,
  };
}

export async function verifyLockedPricingQuote(token, expected) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('Pricing quote is missing or malformed');
  const secret = await quoteSecret();
  const expectedSignature = signature(parts[0], secret);
  if (!secureEqual(parts[1], expectedSignature)) throw new Error('Pricing quote signature is invalid');

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(parts[0]));
  } catch (e) {
    throw new Error('Pricing quote payload is invalid');
  }
  if (!payload || payload.v !== QUOTE_VERSION) throw new Error('Pricing quote version is invalid');
  if (!Number.isFinite(Number(payload.expiresAt)) || Date.now() > Number(payload.expiresAt)) {
    throw new Error('Pricing quote has expired. Please return to the booking search.');
  }

  const constraints = expected || {};
  if (constraints.packageId && String(payload.packageId) !== String(constraints.packageId)) {
    throw new Error('Pricing quote does not match the selected package');
  }
  if (constraints.checkIn && payload.checkIn !== dateString(constraints.checkIn)) {
    throw new Error('Pricing quote does not match the check-in date');
  }
  if (constraints.checkOut && payload.checkOut !== dateString(constraints.checkOut)) {
    throw new Error('Pricing quote does not match the check-out date');
  }
  if (!Number.isFinite(Number(payload.totalPerPerson)) || Number(payload.totalPerPerson) < 0) {
    throw new Error('Pricing quote contains an invalid total');
  }
  return payload;
}
