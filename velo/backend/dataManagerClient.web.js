import { getSecret } from 'wix-secrets-backend';
import { fetch } from 'wix-fetch';
import crypto from 'crypto';

const SCOPE = 'https://www.googleapis.com/auth/adwords';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_VERSION = 'v18';
const BASE_URL = 'https://googleads.googleapis.com/' + API_VERSION + '/customers';

let cachedToken = null;

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function safeSecret(name) {
  try { return await getSecret(name); } catch (e) { return null; }
}

export async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  const clientEmail = await getSecret('GOOGLE_SA_CLIENT_EMAIL');
  let privateKey = await getSecret('GOOGLE_SA_PRIVATE_KEY');
  privateKey = privateKey.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };

  const unsigned = base64url(Buffer.from(JSON.stringify(header))) + '.' + base64url(Buffer.from(JSON.stringify(claim)));
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey);
  const jwt = unsigned + '.' + base64url(signature);

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt
  });

  const res = await fetch(TOKEN_URL, {
    method: 'post',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('OAuth token request failed (' + res.status + '): ' + text);
  }
  const json = await res.json();
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in * 1000) };
  return cachedToken.token;
}

async function call(method, customerId, path, payload) {
  const token = await getAccessToken();
  const loginCustomerId = await safeSecret('GOOGLE_ADS_LOGIN_CUSTOMER_ID');
  const url = BASE_URL + '/' + customerId + '/' + path;

  const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  };
  if (loginCustomerId) { headers['login-customer-id'] = loginCustomerId; }

  const res = await fetch(url, {
    method: method,
    headers: headers,
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  if (!res.ok) { throw new Error('Google Ads API call failed (' + res.status + '): ' + text); }
  return text ? JSON.parse(text) : { ok: true };
}

export async function uploadClickConversions(customerId, conversions) {
  return call('post', customerId, 'conversions:uploadClickConversions', {
    customer_id: customerId,
    conversions: conversions,
    partial_failure: true
  });
}

export async function uploadConversionAdjustments(customerId, adjustments) {
  return call('post', customerId, 'conversionAdjustments:upload', {
    customer_id: customerId,
    conversion_adjustments: adjustments,
    partial_failure: true
  });
}
