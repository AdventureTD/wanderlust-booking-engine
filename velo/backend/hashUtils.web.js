import crypto from 'crypto';

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashEmail(email) {
  if (!email) { return undefined; }
  let e = String(email).trim().toLowerCase();
  const parts = e.split('@');
  const user = parts[0];
  const domain = parts[1];
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const cleanUser = user.split('+')[0].replace(/\./g, '');
    e = cleanUser + '@gmail.com';
  }
  return sha256Hex(e);
}

export function hashPhone(phone, defaultCountryCode) {
  if (!phone) { return undefined; }
  let p = String(phone).replace(/[^\d+]/g, '');
  if (!p.startsWith('+')) {
    const cc = defaultCountryCode ? String(defaultCountryCode).replace(/\D/g, '') : '';
    p = '+' + cc + p;
  }
  return sha256Hex(p);
}

export function hashName(name) {
  if (!name) { return undefined; }
  const n = String(name).trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!n) { return undefined; }
  return sha256Hex(n);
}

export function buildUserIdentifiers(pii) {
  console.log('[WBE-HASH] buildUserIdentifiers called with:', JSON.stringify(pii));
  const identifiers = [];
  pii = pii || {};

  const hashedEmail = hashEmail(pii.email);
  if (hashedEmail) { identifiers.push({ hashed_email: hashedEmail }); }

  const hashedPhone = hashPhone(pii.phone, pii.dialingCode);
  if (hashedPhone) { identifiers.push({ hashed_phone_number: hashedPhone }); }

  const hashedFirst = hashName(pii.firstName);
  const hashedLast = hashName(pii.lastName);
  console.log('[WBE-HASH] identifiers count before address:', identifiers.length);
  if (hashedFirst || hashedLast || pii.postalCode || pii.countryCode) {
    identifiers.push({
      address_info: {
        hashed_first_name: hashedFirst,
        hashed_last_name: hashedLast,
        postal_code: pii.postalCode || undefined,
        country_code: pii.countryCode || undefined
      }
    });
  }
  console.log('[WBE-HASH] identifiers result:', JSON.stringify(identifiers));
  return identifiers;
}
