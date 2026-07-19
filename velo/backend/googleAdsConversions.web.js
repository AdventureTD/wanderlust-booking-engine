import { Permissions, webMethod } from 'wix-web-module';
import { getSecret } from 'wix-secrets-backend';
import { ingestEvent } from 'backend/dataManagerClient.web';
import { buildUserIdentifiers } from 'backend/hashUtils.web';

export const recordBookingConversion = webMethod(
  Permissions.Anyone,
  async (booking) => {
    try {
      validateBooking(booking);
      const payload = await buildIngestPayload(booking);
      const response = await ingestEvent(payload);
      return { ok: true, transactionId: booking.transactionId, response };
    } catch (err) {
      console.error('[WBE-GOOGLE] recordBookingConversion error:', err);
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

  const event = {
    transaction_id: booking.transactionId,
    event_timestamp: toGoogleTimestamp(booking.conversionTime),
    event_name: 'purchase',
    conversion_value: Number(booking.value || 0),
    currency: booking.currency || 'USD',
    event_source: 'WEB',
    ad_identifiers: stripUndefined({
      gclid: booking.gclid,
      gbraid: booking.gbraid,
      wbraid: booking.wbraid
    })
  };

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
    event_source: 'WEB',
    ad_identifiers: stripUndefined({
      gclid: booking.gclid,
      gbraid: booking.gbraid,
      wbraid: booking.wbraid
    })
  };

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
    events: [event]
  };
}

function stripUndefined(obj) {
  const out = {};
  Object.keys(obj).forEach(function (k) {
    if (obj[k] !== undefined && obj[k] !== null) { out[k] = obj[k]; }
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
  return d.toISOString();
}
