import { Permissions, webMethod } from 'wix-web-module';
import { getSecret } from 'wix-secrets-backend';
import { ingestEvent } from 'backend/dataManagerClient.web';
import { buildUserIdentifiers } from 'backend/hashUtils.web';
import { getAllSettings, observeAdvertisingSuspension } from 'backend/settings.web';
import wixData from 'wix-data';
// v2026-07-20-hashutils-import

export async function isGoogleAdsSuspended() {
  try {
    const settings = await getAllSettings();
    const v = settings.suspendGoogleAds;
    return String(v).trim() === '1' || Number(v) === 1;
  } catch (e) { return false; }
}

// Positive purchases require an explicit resolved OFF value. Keep the legacy
// exported suspension helper separate: cancellation callers also use it.
async function isGoogleAdsPurchaseBlocked() {
  try {
    return (await observeAdvertisingSuspension('suspendGoogleAds')) !== 0;
  } catch (e) { return true; }
}

function stripEmpty(obj) {
  const out = {};
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') { out[k] = v; }
  });
  return out;
}


export const recordBookingConversion = webMethod(
  Permissions.Anyone,
  async (booking) => {
    try {
      if (await isGoogleAdsPurchaseBlocked()) {
        console.log('[WBE-GOOGLE] recordBookingConversion skipped — suspension enabled or unresolved');
        return { ok: false, suspended: true };
      }
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
      if (await isGoogleAdsPurchaseBlocked()) {
        console.log('[WBE-GOOGLE] retryBookingConversion skipped — suspension enabled or unresolved');
        return { ok: false, suspended: true };
      }
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
      const normalizeDate = function(v) {
        if (!v) return null;
        let str = String(v).trim();
        const tIndex = str.indexOf('T');
        if (tIndex !== -1) str = str.substring(0, tIndex);
        const spaceIndex = str.indexOf(' ');
        if (spaceIndex !== -1) str = str.substring(0, spaceIndex);
        const parts = str.split('-');
        if (parts.length !== 3) return null;
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
        const out = new Date(Date.UTC(y, m, d, 12, 0, 0));
        return isNaN(out.getTime()) ? null : out;
      };
      if (summary.checkIn) summary.checkIn = normalizeDate(summary.checkIn);
      if (summary.checkOut) summary.checkOut = normalizeDate(summary.checkOut);
      if (summary.bookingDate) summary.bookingDate = normalizeDate(summary.bookingDate);
      await wixData.update('BookingSummary', summary);
      return { ok: true, transactionId: bookingNumber, response };
    } catch (err) {
      console.error('[WBE-GOOGLE] retryBookingConversion error:', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  }
);

// FieldWarning / WarningReason: non-blocking optional-field validation warnings.
// https://developers.google.com/data-manager/api/reference/rest/v1/FieldWarning
function validAdjustmentWarnings(warnings) {
  if (!Array.isArray(warnings) || Object.getPrototypeOf(warnings) !== Array.prototype) return false;
  const items = Object.getOwnPropertyDescriptors(warnings);
  // Dense ordinary array only; iterate actual own keys, never a sparse declared length.
  const keys = Reflect.ownKeys(items);
  if (keys.length !== items.length.value + 1) return false;
  const reasons = [
    'WARNING_REASON_UNSPECIFIED',
    'WARNING_REASON_CUSTOM_VARIABLE_NOT_ENABLED',
    'WARNING_REASON_CUSTOM_VARIABLE_NOT_PREDEFINED',
    'WARNING_REASON_CART_DATA_NOT_SUPPORTED_WITH_GBRAID_OR_WBRAID',
    'WARNING_REASON_CART_DATA_ITEM_MERCHANT_PRODUCT_ID_MISSING',
    'WARNING_REASON_CART_DATA_ITEM_UNIT_PRICE_MISSING',
    'WARNING_REASON_GENERIC',
    'WARNING_REASON_INVALID_CLIENT_ID',
    'WARNING_REASON_INVALID_SUBDIVISION_CODE',
    'WARNING_REASON_INVALID_REGION_CODE',
    'WARNING_REASON_INVALID_SUBCONTINENT_CODE',
    'WARNING_REASON_INVALID_CONTINENT_CODE',
    'WARNING_REASON_INVALID_DEVICE_CATEGORY',
    'WARNING_REASON_INVALID_DEVICE_SCREEN_RESOLUTION',
    'WARNING_REASON_INVALID_MERCHANT_ID'
  ];
  for (let i = 0; i < keys.length - 1; i++) {
    const item = items[i];
    if (!item || !Object.prototype.hasOwnProperty.call(item, 'value')) return false;
    const warning = item.value;
    if (!warning || typeof warning !== 'object' || Object.getPrototypeOf(warning) !== Object.prototype) return false;
    const fields = Object.getOwnPropertyDescriptors(warning);
    for (const key of Reflect.ownKeys(fields)) {
      if (!['field', 'description', 'reason'].includes(key)) return false;
      const descriptor = fields[key];
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || typeof descriptor.value !== 'string') return false;
      if (key === 'reason' && !reasons.includes(descriptor.value)) return false;
    }
  }
  return true;
}

// Conservative local request acceptance, not final attribution/processing proof.
// events.ingest documents requestId and optional fieldWarnings; other fields deny.
function isAcknowledgedAdjustment(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  const fields = Object.getOwnPropertyDescriptors(response);
  for (const key of ['requestId', 'ok', 'errors', 'fieldWarnings']) {
    if (key in response && !Object.prototype.hasOwnProperty.call(fields, key)) return false;
  }
  if (Reflect.ownKeys(fields).some(k => !['requestId', 'ok', 'errors', 'fieldWarnings'].includes(k))) return false;
  for (const key of Reflect.ownKeys(fields)) {
    if (!Object.prototype.hasOwnProperty.call(fields[key], 'value')) return false;
  }
  if (!fields.requestId || typeof fields.requestId.value !== 'string' || !fields.requestId.value.trim()) return false;
  if (fields.fieldWarnings && !validAdjustmentWarnings(fields.fieldWarnings.value)) return false;
  if (fields.ok && fields.ok.value !== true) return false;
  if (fields.errors) {
    const errors = fields.errors.value;
    if (!Array.isArray(errors) || !Array.isArray(Object.getPrototypeOf(errors)) || errors.length !== 0 || Reflect.ownKeys(errors).length !== 1) return false;
  }
  return true;
}

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
      console.log('[WBE-GOOGLE] adjustment ingestEvent response received');
      if (!isAcknowledgedAdjustment(response)) {
        return { ok: false, error: 'Google Ads retraction not acknowledged; owner review required' };
      }
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