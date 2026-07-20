import { Permissions, webMethod } from 'wix-web-module';
import { getSecret } from 'wix-secrets-backend';
import { ingestEvent } from 'backend/dataManagerClient.web';
import wixData from 'wix-data';
import crypto from 'crypto';
// v2026-07-19-force-rebuild-02

/* inlined from hashUtils.web.js to avoid stale module cache */
function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashEmail(email) {
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

function hashPhone(phone, defaultCountryCode) {
  if (!phone) { return undefined; }
  let p = String(phone).replace(/[^\d+]/g, '');
  if (!p.startsWith('+')) {
    const cc = defaultCountryCode ? String(defaultCountryCode).replace(/\D/g, '') : '';
    p = '+' + cc + p;
  }
  return sha256Hex(p);
}

function hashName(name) {
  if (!name) { return undefined; }
  const n = String(name).trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!n) { return undefined; }
  return sha256Hex(n);
}

function buildUserIdentifiers(pii) {
  const identifiers = [];
  pii = pii || {};

  const hashedEmail = hashEmail(pii.email);
  if (hashedEmail) { identifiers.push({ emailAddress: hashedEmail }); }

  const hashedPhone = hashPhone(pii.phone, pii.dialingCode);
  if (hashedPhone) { identifiers.push({ phoneNumber: hashedPhone }); }

  const hashedFirst = hashName(pii.firstName);
  const hashedLast = hashName(pii.lastName);
  if (hashedFirst && hashedLast && pii.postalCode && pii.countryCode) {
    identifiers.push({
      address: {
        givenName: hashedFirst,
        familyName: hashedLast,
        postalCode: pii.postalCode || undefined,
        regionCode: pii.countryCode || undefined
      }
    });
  }
  return identifiers;
}


export const recordBookingConversion = webMethod(
  Permissions.Anyone,
  async (booking) => {
    try {
      validateBooking(booking);
      const payload = await buildIngestPayload(booking);
      console.log('[WBE-GOOGLE] built payload for transaction:', booking.transactionId);
      const response = await ingestEvent(payload);
      console.log('[WBE-GOOGLE] ingestEvent raw response:', JSON.stringify(response));
      if (!response || response.ok === false || (response.errors && response.errors.length > 0)) {
        throw new Error('Data Manager returned error: ' + JSON.stringify(response));
      }
      return { ok: true, transactionId: booking.transactionId, response };
    } catch (err) {
      console.error('[WBE-GOOGLE] recordBookingConversion error:', err);
      let debugPayload = null;
      try { debugPayload = await buildIngestPayload(booking); } catch (buildErr) {}
      return { ok: false, error: String(err && err.message || err), debugPayload };
    }
  }
);

export const retryBookingConversion = webMethod(
  Permissions.Admin,
  async (bookingNumber) => {
    try {
      const summaryRes = await wixData.query('BookingSummary')
        .eq('bookingNumber', bookingNumber)
        .limit(1)
        .find();
      if (!summaryRes.items.length) { throw new Error('BookingSummary not found for ' + bookingNumber); }
      const summary = summaryRes.items[0];
      const booking = {
        transactionId: bookingNumber,
        value: summary.grandTotal,
        currency: 'USD',
        gclid: summary.gclid,
        gbraid: summary.gbraid,
        wbraid: summary.wbraid,
        email: summary.guestEmail,
        phone: summary.guestPhone,
        firstName: summary.guestName,
        lastName: '',
        conversionTime: summary.bookingDate || new Date().toISOString()
      };
      validateBooking(booking);
      const payload = await buildIngestPayload(booking);
      console.log('[WBE-GOOGLE] retry payload for', bookingNumber, JSON.stringify(payload));
      const response = await ingestEvent(payload);
      if (!response || response.ok === false || (response.errors && response.errors.length > 0)) {
        throw new Error('Data Manager returned error: ' + JSON.stringify(response));
      }
      summary.googleConversionUploaded = true;
      await wixData.update('BookingSummary', summary);
      return { ok: true, transactionId: bookingNumber, response };
    } catch (err) {
      console.error('[WBE-GOOGLE] retryBookingConversion error:', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  }
);

export const adjustBookingConversion = webMethod(
  Permissions.Admin,
  async ({ transactionId, gclid, gbraid, wbraid, adjustmentType, newValue, currency, adjustmentTime, originalEvent, email, phone }) => {
    try {
      if (!transactionId) { throw new Error('transactionId required for adjustment'); }
      const payload = await buildAdjustmentPayload({
        transactionId,
        gclid, gbraid, wbraid,
        email,
        phone,
        value: newValue,
        currency: currency || 'USD',
        conversionTime: adjustmentTime || new Date().toISOString(),
        originalEvent
      }, adjustmentType || 'RETRACTION');

      const response = await ingestEvent(payload);
      console.log('[WBE-GOOGLE] adjustment ingestEvent raw response:', JSON.stringify(response));
      return { ok: true, transactionId, adjustmentType, response };
    } catch (err) {
      console.error('[WBE-GOOGLE] adjustBookingConversion error:', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  }
);

async function buildIngestPayload(booking) {
  const customerId = await getSecret('GOOGLE_ADS_CUSTOMER_ID');
  const conversionActionId = await getSecret('GOOGLE_ADS_CONVERSION_ACTION_ID');

  const userIds = buildUserIdentifiers({
    email: booking.email,
    phone: booking.phone,
    firstName: booking.firstName,
    lastName: booking.lastName,
    postalCode: booking.postalCode,
    countryCode: booking.countryCode,
    dialingCode: booking.dialingCode
  });

  const adIds = stripEmpty({
    gclid: booking.gclid,
    gbraid: booking.gbraid,
    wbraid: booking.wbraid
  });

  const event = {
    transaction_id: booking.transactionId,
    event_timestamp: toGoogleTimestamp(booking.conversionTime),
    event_name: 'purchase',
    conversion_value: Number(booking.value || 0),
    currency: booking.currency || 'USD',
    event_source: 'WEB'
  };

  if (Object.keys(adIds).length > 0) {
    event.ad_identifiers = adIds;
  }

  if (userIds.length > 0) {
    event.user_data = { user_identifiers: userIds };
  }

  return {
    destinations: [{
      operating_account: {
        account_type: 'GOOGLE_ADS',
        account_id: customerId
      },
      product_destination_id: conversionActionId
    }],
    encoding: 'HEX',
    events: [event]
  };
}

async function buildAdjustmentPayload(booking, adjustmentType) {
  const customerId = await getSecret('GOOGLE_ADS_CUSTOMER_ID');
  const conversionActionId = await getSecret('GOOGLE_ADS_CONVERSION_ACTION_ID');

  const userIds = buildUserIdentifiers({
    email: booking.email,
    phone: booking.phone
  });

  const event = {
    transaction_id: booking.transactionId,
    event_timestamp: toGoogleTimestamp(booking.originalEvent && booking.originalEvent.conversionTime),
    event_name: adjustmentType === 'RETRACTION' ? 'purchase_retraction' : 'purchase_adjustment',
    conversion_value: adjustmentType === 'RETRACTION' ? 0 : Number(booking.value || 0),
    currency: booking.currency || 'USD',
    event_source: 'WEB'
  };

  const adjAdIds = stripEmpty({
    gclid: booking.gclid,
    gbraid: booking.gbraid,
    wbraid: booking.wbraid
  });
  if (Object.keys(adjAdIds).length > 0) {
    event.ad_identifiers = adjAdIds;
  }

  if (userIds.length > 0) {
    event.user_data = { user_identifiers: userIds };
  }

  return {
    destinations: [{
      operating_account: {
        account_type: 'GOOGLE_ADS',
        account_id: customerId
      },
      product_destination_id: conversionActionId
    }],
    encoding: 'HEX',
    events: [event]
  };
}

function stripEmpty(obj) {
  const out = {};
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') { out[k] = v; }
  });
  return out;
}

function validateBooking(b) {
  if (!b) { throw new Error('booking payload missing'); }
  if (!b.transactionId) { throw new Error('transactionId is required'); }
  const hasClickId = b.gclid || b.gbraid || b.wbraid;
  const hasPii = b.email || b.phone;
  if (!hasClickId && !hasPii) {
    throw new Error('need at least a gclid/gbraid/wbraid or email/phone to attribute');
  }
}

function toGoogleTimestamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  const seconds = Math.floor(d.getTime() / 1000);
  const nanos = (d.getTime() % 1000) * 1000000;
  return { seconds: String(seconds), nanos: nanos };
}