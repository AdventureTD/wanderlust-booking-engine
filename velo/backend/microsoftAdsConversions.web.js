import { Permissions, webMethod } from 'wix-web-module';
import { getSecret } from 'wix-secrets-backend';
import wixData from 'wix-data';
import { getAllSettings } from 'backend/settings.web';
import { buildUserIdentifiers } from 'backend/hashUtils.web';

async function isMicrosoftAdsSuspended() {
  try {
    const settings = await getAllSettings();
    const v = settings.suspendMicrosoftAds;
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

function normalizePhone(raw) {
  if (!raw) { return ''; }
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) { return digits; }
  if (digits.length === 11 && digits.charAt(0) === '1') { return '+' + digits; }
  if (digits.length === 10) { return '+1' + digits; }
  return digits;
}

function toMicrosoftTimestamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export const recordMicrosoftBookingConversion = webMethod(
  Permissions.Anyone,
  async (booking) => {
    try {
      if (await isMicrosoftAdsSuspended()) {
        console.log('[WBE-MICROSOFT] recordMicrosoftBookingConversion skipped — suspendMicrosoftAds is enabled');
        return { ok: false, suspended: true };
      }
      validateBooking(booking);
      const payload = await buildIngestPayload(booking);
      console.log('[WBE-MICROSOFT] built payload for transaction:', booking.transactionId);
      const response = await callMicrosoftOfflineConversions(payload);
      console.log('[WBE-MICROSOFT] Microsoft offline conversions raw response:', JSON.stringify(response));
      return { ok: true, transactionId: booking.transactionId, response };
    } catch (err) {
      console.error('[WBE-MICROSOFT] recordMicrosoftBookingConversion error:', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  }
);

export const retryMicrosoftBookingConversion = webMethod(
  Permissions.Admin,
  async (bookingNumber) => {
    try {
      if (await isMicrosoftAdsSuspended()) {
        console.log('[WBE-MICROSOFT] retryMicrosoftBookingConversion skipped — suspendMicrosoftAds is enabled');
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
        msclkid: summary.msclkid,
        email: summary.guestEmail,
        phone: summary.guestPhone,
        firstName: summary.guestName,
        lastName: '',
        conversionTime: summary.bookingDate || new Date().toISOString()
      };
      validateBooking(booking);
      const payload = await buildIngestPayload(booking);
      console.log('[WBE-MICROSOFT] retry payload for', bookingNumber, JSON.stringify(payload));
      const response = await callMicrosoftOfflineConversions(payload);
      summary.microsoftConversionUploaded = true;
      await wixData.update('BookingSummary', summary);
      return { ok: true, transactionId: bookingNumber, response };
    } catch (err) {
      console.error('[WBE-MICROSOFT] retryMicrosoftBookingConversion error:', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  }
);

async function buildIngestPayload(booking) {
  const accountId = await getSecret('MICROSOFT_ADS_ACCOUNT_ID');
  const customerId = await getSecret('MICROSOFT_ADS_CUSTOMER_ID');
  const conversionGoalId = await getSecret('MICROSOFT_CONVERSION_GOAL_ID');

  const userIds = buildUserIdentifiers({
    email: booking.email,
    phone: booking.phone,
    firstName: booking.firstName,
    lastName: booking.lastName,
    postalCode: booking.postalCode,
    countryCode: booking.countryCode
  });

  const msclkid = (booking.msclkid || '').trim();

  const conversion = {
    msclkid: msclkid,
    conversionName: 'Booking Confirmed',
    conversionValue: Number(booking.value || 0),
    conversionCurrency: booking.currency || 'USD',
    conversionTime: toMicrosoftTimestamp(booking.conversionTime)
  };

  const payload = {
    accountId: accountId,
    customerId: customerId,
    conversionGoalId: conversionGoalId,
    conversion: conversion,
    userIdentifiers: userIds
  };

  return payload;
}

async function callMicrosoftOfflineConversions(payload) {
  const developerToken = await getSecret('MICROSOFT_ADS_DEVELOPER_TOKEN');
  const accessToken = await getSecret('MICROSOFT_ADS_ACCESS_TOKEN');

  if (!developerToken || !accessToken) {
    throw new Error('Microsoft Ads developer token or access token missing from secrets');
  }

  const url = 'https://bingads.microsoft.com/Api/Advertiser/CampaignManagement/v13/OfflineConversion/ApplyOfflineConversions';
  const body = {
    CustomerAccountId: payload.accountId,
    CustomerId: payload.customerId,
    OfflineConversions: [
      {
        MSCLKID: payload.conversion.msclkid,
        ConversionName: payload.conversion.conversionName,
        ConversionValue: payload.conversion.conversionValue,
        ConversionCurrencyCode: payload.conversion.conversionCurrency,
        ConversionTime: payload.conversion.conversionTime
      }
    ]
  };

  if (payload.conversionGoalId) {
    body.OfflineConversions[0].ConversionGoalId = payload.conversionGoalId;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + accessToken,
      'Developer-Token': developerToken
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }

  if (!res.ok) {
    throw new Error('Microsoft offline conversions HTTP ' + res.status + ': ' + JSON.stringify(json));
  }
  return json;
}

function validateBooking(b) {
  if (!b) { throw new Error('booking payload missing'); }
  if (!b.transactionId) { throw new Error('transactionId is required'); }
  if (!b.msclkid) { throw new Error('msclkid is required for Microsoft attribution'); }
}
