import crypto from 'crypto';
import { normalizePhone } from 'public/phoneNormalization';

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashEmail(email) {
  if (typeof email !== 'string') { return undefined; }
  let e = email.replace(/\s/g, '').toLowerCase();
  if (e.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return undefined;
  const parts = e.split('@');
  const user = parts[0];
  const domain = parts[1];
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const cleanUser = user.split('+')[0].replace(/\./g, '');
    if (!cleanUser) return undefined;
    e = cleanUser + '@gmail.com';
  }
  return sha256Hex(e);
}

export function hashPhone(phone, defaultCountryCode) {
  const p = normalizePhone(phone, defaultCountryCode);
  return p ? sha256Hex(p) : undefined;
}

export function hashName(name) {
  if (!name) { return undefined; }
  const n = String(name).trim().toLowerCase().replace(/[^\p{L}\p{M}]/gu, '');
  if (!n) { return undefined; }
  return sha256Hex(n);
}

export function buildUserIdentifiers(pii) {
  pii = pii || {};
  console.log('[WBE-HASH] buildUserIdentifiers v4-canonical-rest:', JSON.stringify({
    hasEmail: !!pii.email,
    hasPhone: !!pii.phone,
    hasCompleteAddress: !!(pii.firstName && pii.lastName && pii.postalCode && pii.countryCode)
  }));
  const identifiers = [];

  // Data Manager REST UserIdentifier fields are camelCase. The legacy Google
  // Ads API names (hashed_email, hashed_phone_number, address_info) are not
  // recognized here even when the ingest request itself returns HTTP 200.
  const hashedEmail = hashEmail(pii.email);
  if (hashedEmail) { identifiers.push({ emailAddress: hashedEmail }); }

  const hashedPhone = hashPhone(pii.phone, pii.dialingCode);
  if (hashedPhone) { identifiers.push({ phoneNumber: hashedPhone }); }

  // AddressInfo is matched as one group and requires all four fields. Do not
  // send a partial address; email and phone remain valid standalone IDs.
  const hashedFirst = hashName(pii.firstName);
  const hashedLast = hashName(pii.lastName);
  const postalCode = pii.postalCode ? String(pii.postalCode).trim() : '';
  const regionCode = pii.countryCode ? String(pii.countryCode).trim().toUpperCase() : '';
  if (hashedFirst && hashedLast && postalCode && regionCode) {
    identifiers.push({
      address: {
        givenName: hashedFirst,
        familyName: hashedLast,
        postalCode,
        regionCode
      }
    });
  }
  console.log('[WBE-HASH] identifier types v4:', identifiers.map(function (identifier) {
    return Object.keys(identifier)[0] || 'unknown';
  }).join(','));
  return identifiers;
}
