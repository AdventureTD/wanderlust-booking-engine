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
  console.log('[WBE-HASH] buildUserIdentifiers called v3-data-manager-rest:', JSON.stringify(pii));
  const identifiers = [];
  pii = pii || {};

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
  console.log('[WBE-HASH] identifiers result v3:', JSON.stringify(identifiers));
  return identifiers;
}
