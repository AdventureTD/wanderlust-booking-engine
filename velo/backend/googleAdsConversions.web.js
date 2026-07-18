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
  async ({ transactionId, gclid, gbraid, wbraid, adjustmentType, newValue, currency, adjustmentTime, originalEvent }) => {
    try {
      if (!transactionId) { throw new Error('transactionId required for adjustment'); }
      const payload = await buildAdjustmentPayload({
        transactionId,
        gclid, gbraid, wbraid,
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

  const userIdentifiers = buildUserIdentifiers({
    email: booking.email,
    phone: booking.phone,
    firstName: booking.firstName,
    lastName: booking.lastName,
    postalCode: booking.postalCode,
    countryCode: booking.countryCode,
    dialingCode: booking.dialingCode
  });

  return {
    conversionActionId: 'customers/' + customerId + '/conversionActions/' + conversionActionId,
    conversionDateTime: toGoogleDateTime(booking.conversionTime),
    currencyCode: booking.currency || 'USD',
    conversionValue: Number(booking.value || 0),
    gclid: booking.gclid || undefined,
    gbraid: booking.gbraid || undefined,
    wbraid: booking.wbraid || undefined,
    transactionId: booking.transactionId,
    userIdentifiers
  };
}

async function buildAdjustmentPayload(booking, adjustmentType) {
  const customerId = await getSecret('GOOGLE_ADS_CUSTOMER_ID');
  const conversionActionId = await getSecret('GOOGLE_ADS_CONVERSION_ACTION_ID');

  const userIdentifiers = buildUserIdentifiers({
    email: booking.email,
    phone: booking.phone
  });

  return {
    conversionActionId: 'customers/' + customerId + '/conversionActions/' + conversionActionId,
    conversionDateTime: toGoogleDateTime(booking.originalEvent && booking.originalEvent.conversionTime),
    adjustmentDateTime: toGoogleDateTime(booking.conversionTime),
    currencyCode: booking.currency || 'USD',
    conversionValue: adjustmentType === 'RETRACTION' ? 0 : Number(booking.value || 0),
    gclid: booking.gclid || undefined,
    gbraid: booking.gbraid || undefined,
    wbraid: booking.wbraid || undefined,
    transactionId: booking.transactionId,
    adjustmentType,
    userIdentifiers
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

function toGoogleDateTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
         pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + sign + oh + ':' + om;
}
