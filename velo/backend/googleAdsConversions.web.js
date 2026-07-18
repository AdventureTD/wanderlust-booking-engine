import { Permissions, webMethod } from 'wix-web-module';
import { getSecret } from 'wix-secrets-backend';
import { uploadClickConversions, uploadConversionAdjustments } from 'backend/dataManagerClient.web';
import { buildUserIdentifiers } from 'backend/hashUtils.web';

export const recordBookingConversion = webMethod(
  Permissions.Anyone,
  async (booking) => {
    try {
      validateBooking(booking);
      const customerId = await getSecret('GOOGLE_ADS_CUSTOMER_ID');
      const conversionActionId = await getSecret('GOOGLE_ADS_CONVERSION_ACTION_ID');
      const conversion = buildConversion(booking, customerId, conversionActionId);
      const response = await uploadClickConversions(customerId, [conversion]);
      console.log('recordBookingConversion response:', JSON.stringify(response).substring(0, 500));
      return { ok: true, transactionId: booking.transactionId, response: response };
    } catch (err) {
      console.error('recordBookingConversion error:', err && err.message || err);
      return { ok: false, error: String(err && err.message || err) };
    }
  }
);

export const adjustBookingConversion = webMethod(
  Permissions.Admin,
  async (args) => {
    try {
      const transactionId = args.transactionId;
      const adjustmentType = args.adjustmentType || 'RETRACTION';
      if (!transactionId) { throw new Error('transactionId required for adjustment'); }
      const customerId = await getSecret('GOOGLE_ADS_CUSTOMER_ID');
      const conversionActionId = await getSecret('GOOGLE_ADS_CONVERSION_ACTION_ID');
      const adjustment = buildAdjustment(args, customerId, conversionActionId, adjustmentType);
      const response = await uploadConversionAdjustments(customerId, [adjustment]);
      console.log('adjustBookingConversion response:', JSON.stringify(response).substring(0, 500));
      return { ok: true, transactionId: transactionId, adjustmentType: adjustmentType, response: response };
    } catch (err) {
      console.error('adjustBookingConversion error:', err && err.message || err);
      return { ok: false, error: String(err && err.message || err) };
    }
  }
);

function buildConversion(booking, customerId, conversionActionId) {
  const userIdentifiers = buildUserIdentifiers({
    email: booking.email,
    phone: booking.phone,
    firstName: booking.firstName,
    lastName: booking.lastName,
    postalCode: booking.postalCode,
    countryCode: booking.countryCode,
    dialingCode: booking.dialingCode
  });

  const conversion = {
    gclid: booking.gclid || undefined,
    gbraid: booking.gbraid || undefined,
    wbraid: booking.wbraid || undefined,
    conversionAction: 'customers/' + customerId + '/conversionActions/' + conversionActionId,
    conversionDateTime: toGoogleDateTime(booking.conversionTime || booking.bookingDate),
    conversionValue: booking.value,
    currencyCode: booking.currency || 'USD'
  };

  if (booking.transactionId) { conversion.orderId = booking.transactionId; }
  if (userIdentifiers.length > 0) { conversion.userIdentifiers = userIdentifiers; }

  return conversion;
}

function buildAdjustment(args, customerId, conversionActionId, adjustmentType) {
  const userIdentifiers = buildUserIdentifiers({
    email: args.email,
    phone: args.phone,
    firstName: args.firstName,
    lastName: args.lastName,
    postalCode: args.postalCode,
    countryCode: args.countryCode,
    dialingCode: args.dialingCode
  });

  const adjustment = {
    gclid: args.gclid || undefined,
    gbraid: args.gbraid || undefined,
    wbraid: args.wbraid || undefined,
    conversionAction: 'customers/' + customerId + '/conversionActions/' + conversionActionId,
    conversionDateTime: toGoogleDateTime(args.originalConversionTime),
    adjustmentType: adjustmentType,
    adjustmentDateTime: toGoogleDateTime(args.adjustmentTime || new Date().toISOString())
  };

  if (args.transactionId) { adjustment.orderId = args.transactionId; }
  if (adjustmentType === 'RESTATEMENT') {
    adjustment.restatementValue = {
      adjustedValue: args.newValue,
      currencyCode: args.currency || 'USD'
    };
  }
  if (userIdentifiers.length > 0) { adjustment.userIdentifiers = userIdentifiers; }

  return adjustment;
}

function validateBooking(b) {
  if (!b) { throw new Error('booking payload missing'); }
  if (!b.transactionId) { throw new Error('transactionId is required'); }
  const hasClickId = b.gclid || b.gbraid || b.wbraid;
  if (!hasClickId && !(b.email || b.phone)) {
    throw new Error('need at least a gclid/gbraid/wbraid or email/phone to attribute');
  }
}

function toGoogleDateTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
         pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + sign + oh + ':' + om;
}
