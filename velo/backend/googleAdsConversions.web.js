import { Permissions, webMethod } from 'wix-web-module';
import { getSecret } from 'wix-secrets-backend';
import { ingestEvent } from 'backend/dataManagerClient.web';
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
    if (v !== undefined && v !== null && String(v).trim() !== '') { out[k] = v; }
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

export const adjustBookingConversion = webMethod(
  Permissions.Admin,
  async ({ transactionId, gclid, gbraid, wbraid, adjustmentType, newValue, currency, adjustmentTime, originalEvent, email, phone }) => {
    try {
      if (await isGoogleAdsSuspended()) {
        console.log('[WBE-GOOGLE] adjustBookingConversion skipped — suspendGoogleAds is enabled');
        return { ok: false, suspended: true };
      }
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
    transactionId: booking.transactionId,
    eventTimestamp: toGoogleTimestamp(booking.conversionTime),
    eventName: 'purchase',
    conversionValue: Number(booking.value || 0),
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

async function buildAdjustmentPayload(booking, adjustmentType) {
  const customerId = await getSecret('GOOGLE_ADS_CUSTOMER_ID');
  const conversionActionId = await getSecret('GOOGLE_ADS_CONVERSION_ACTION_ID');

  const userIds = buildUserIdentifiers({
    email: booking.email,
    phone: booking.phone
  });

  const event = {
    transactionId: booking.transactionId,
    eventTimestamp: toGoogleTimestamp(booking.originalEvent && booking.originalEvent.conversionTime),
    eventName: adjustmentType === 'RETRACTION' ? 'purchase_retraction' : 'purchase_adjustment',
    conversionValue: adjustmentType === 'RETRACTION' ? 0 : Number(booking.value || 0),
    currency: booking.currency || 'USD',
    eventSource: 'WEB'
  };

  const adjAdIds = stripEmpty({
    gclid: booking.gclid,
    gbraid: booking.gbraid,
    wbraid: booking.wbraid
  });
  if (Object.keys(adjAdIds).length > 0) {
    event.adIdentifiers = adjAdIds;
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
  if (!b.transactionId) { throw new Error('transactionId is required'); }
  const hasClickId = b.gclid || b.gbraid || b.wbraid;
  const hasPii = b.email || b.phone;
  if (!hasClickId && !hasPii) {
    throw new Error('need at least a gclid/gbraid/wbraid or email/phone to attribute');
  }
}

function toGoogleTimestamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) { throw new Error('Invalid conversion timestamp'); }
  return d.toISOString();
}