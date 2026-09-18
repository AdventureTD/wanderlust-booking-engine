import { Permissions, webMethod } from 'wix-web-module';
import { getSecret } from 'wix-secrets-backend';

import { buildUserIdentifiers } from 'backend/hashUtils.web';
import { getAllSettings } from 'backend/settings.web';
import { recordPrivateGoogleAdsAttempt } from 'backend/googleAdsAttemptJournal';
// v2026-07-20-hashutils-import

export async function isGoogleAdsSuspended() {
  try {
    const settings = await getAllSettings();
    const v = settings.suspendGoogleAds;
    return String(v).trim() === '1' || Number(v) === 1;
  } catch (e) { return false; }
}

function stripEmpty(obj) {
  const out = {};
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (v === undefined || v === null || v === '') return;
    if (typeof v !== 'string' || v.length > 512 || !/^[\x21-\x7e]+$/.test(v)) {
      throw new Error('Invalid click identifier');
    }
    out[k] = v;
  });
  return out;
}


// No public sender or admin retry may bypass the private one-attempt gate.
export const recordBookingConversion = webMethod(
  Permissions.Anyone,
  async (booking) => recordPrivateGoogleAdsAttempt(booking, async (input) => {
    validateBooking(input);
    return buildIngestPayload(input);
  })
);

export const retryBookingConversion = webMethod(
  Permissions.Admin,
  async () => ({ ok: false, outcome: 'NOT_ATTEMPTED', reasonCode: 'RETRY_DISABLED_UNKNOWN_HISTORY' })
);

// Data Manager ingestion is not a conversion-adjustment operation. A supported
// Google Ads route requires separately verified access and eligibility.
export const adjustBookingConversion = webMethod(
  Permissions.Admin,
  async () => ({ ok: false, outcome: 'NOT_ATTEMPTED', reasonCode: 'UNSUPPORTED_ADJUSTMENT_ROUTE' })
);

async function buildIngestPayload(booking) {
  validateBooking(booking);
  const customerId = await getSecret('GOOGLE_ADS_CUSTOMER_ID');
  const conversionActionId = await getSecret('GOOGLE_ADS_CONVERSION_ACTION_ID');

  const userIds = await buildUserIdentifiers({
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

  if (!Object.keys(adIds).length && !userIds.length) {
    throw new Error('need at least one useful identifier');
  }

  const event = {
    transactionId: booking.transactionId,
    eventTimestamp: toGoogleTimestamp(booking.conversionTime),
    eventName: 'purchase',
    conversionValue: booking.value,
    currency: booking.currency || 'USD',
    eventSource: 'WEB'
  };

  if (Object.keys(adIds).length > 0) {
    event.adIdentifiers = adIds;
  }

  if (userIds.length > 0) {
    event.userData = { userIdentifiers: userIds };
  }

  return {
    destinations: [{
      operatingAccount: {
        accountType: 'GOOGLE_ADS',
        accountId: customerId
      },
      productDestinationId: conversionActionId
    }],
    encoding: 'HEX',
    events: [event]
  };
}



function validateBooking(b) {
  if (!b) { throw new Error('booking payload missing'); }
  if (typeof b.transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(b.transactionId)) throw new Error('Invalid transactionId');
  if (typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0 ||
      (b.currency !== undefined && b.currency !== 'USD')) throw new Error('Invalid USD amount');
  stripEmpty({ gclid: b.gclid, gbraid: b.gbraid, wbraid: b.wbraid });
  toGoogleTimestamp(b.conversionTime);
  const hasClickId = b.gclid || b.gbraid || b.wbraid;
  const hasPii = b.email || b.phone;
  if (!hasClickId && !hasPii) {
    throw new Error('need at least a gclid/gbraid/wbraid or email/phone to attribute');
  }
}

function toGoogleTimestamp(iso) {
  if (iso === undefined) return new Date().toISOString();
  if (typeof iso !== 'string') throw new Error('Invalid conversion timestamp');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!m || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) throw new Error('Invalid conversion timestamp');
  const civil = new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00.000Z');
  if (!Number.isFinite(civil.getTime()) || civil.toISOString().slice(0, 10) !== iso.slice(0, 10)) throw new Error('Invalid conversion timestamp');
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error('Invalid conversion timestamp');
  return d.toISOString();
}