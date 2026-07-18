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
  const identifiers = [];
  pii = pii || {};

  const hashedEmail = hashEmail(pii.email);
  if (hashedEmail) { identifiers.push({ hashedEmail: hashedEmail }); }

  const hashedPhone = hashPhone(pii.phone, pii.dialingCode);
  if (hashedPhone) { identifiers.push({ hashedPhoneNumber: hashedPhone }); }

  const hashedFirst = hashName(pii.firstName);
  const hashedLast = hashName(pii.lastName);
  if (hashedFirst || hashedLast || pii.postalCode || pii.countryCode) {
    identifiers.push({
      addressInfo: {
        hashedFirstName: hashedFirst,
        hashedLastName: hashedLast,
        postalCode: pii.postalCode || undefined,
        countryCode: pii.countryCode || undefined
      }
    });
  }
  return identifiers;
}
