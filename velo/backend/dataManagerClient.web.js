import { getSecret } from 'wix-secrets-backend';
import { fetch } from 'wix-fetch';
import crypto from 'crypto';

const DATA_MANAGER_SCOPE = 'https://www.googleapis.com/auth/datamanager';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ENDPOINT = 'https://datamanager.googleapis.com/v1/events:ingest';

let cachedToken = null;

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
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
    scope: DATA_MANAGER_SCOPE,
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

function ingestFailure(code, outcome, httpStatus) {
  // Never include provider bodies, payloads, identifiers or credential errors.
  const error = new Error('Data Manager: ' + code);
  error.code = code;
  error.outcome = outcome;
  if (Number.isInteger(httpStatus)) error.httpStatus = httpStatus;
  return error;
}

// Finite vocabulary, not a regex-only "safe string": echoed hashes/tokens can
// match identifier syntax. Unknown reasons/fields are deliberately discarded.
// References: Data Manager ErrorReason; google.rpc ErrorInfo and BadRequest.
const HTTP_REASON_CODES = new Set([
  'INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'NOT_FOUND',
  'RESOURCE_EXHAUSTED', 'DEADLINE_EXCEEDED', 'INTERNAL', 'INTERNAL_ERROR',
  'UNAVAILABLE', 'FAILED_PRECONDITION', 'SERVICE_DISABLED', 'API_DISABLED',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'IAM_PERMISSION_DENIED',
  'REQUIRED_FIELD_MISSING', 'INVALID_FORMAT', 'INVALID_HEX_ENCODING',
  'INVALID_BASE64_ENCODING', 'INVALID_SHA256_FORMAT', 'INVALID_POSTAL_CODE',
  'INVALID_COUNTRY_CODE', 'INVALID_ENUM_VALUE', 'TOO_MANY_USER_IDENTIFIERS',
  'TOO_MANY_DESTINATIONS', 'INVALID_DESTINATION', 'TERMS_AND_CONDITIONS_NOT_SIGNED',
  'INVALID_NUMBER_FORMAT', 'INVALID_CONVERSION_ACTION_ID', 'INVALID_CONVERSION_ACTION_TYPE',
  'INVALID_CURRENCY_CODE', 'INVALID_EVENT', 'TOO_MANY_EVENTS',
  'DESTINATION_ACCOUNT_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS',
  'DESTINATION_ACCOUNT_DATA_POLICY_PROHIBITS_ENHANCED_CONVERSIONS',
  'DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED',
  'NO_IDENTIFIERS_PROVIDED', 'EVENT_TIME_INVALID', 'INVALID_EVENT_NAME',
  'NOT_ALLOWLISTED', 'FIELD_VALUE_TOO_LONG', 'FIELD_VALUE_TOO_SHORT',
  'TOO_MANY_ELEMENTS', 'TOO_FEW_ELEMENTS', 'EVENT_SOURCE_AND_DESTINATION_MISMATCH',
  'DESTINATION_ACCOUNT_TYPE_MISMATCH', 'CONVERSION_ACTION_TOO_RECENTLY_CREATED'
]);
const HTTP_FIELD_NAMES = [
  'destinations', 'operatingAccount', 'loginAccount', 'linkedAccount', 'accountType',
  'accountId', 'productDestinationId', 'reference', 'events', 'transactionId',
  'eventTimestamp', 'eventName', 'conversionValue', 'currency', 'eventSource',
  'adIdentifiers', 'gclid', 'gbraid', 'wbraid', 'userData', 'userIdentifiers',
  'emailAddress', 'phoneNumber', 'address', 'givenName', 'familyName', 'postalCode',
  'regionCode', 'consent', 'adUserData', 'adPersonalization', 'encoding', 'validateOnly'
];
function safeHttpField(value) {
  if (typeof value !== 'string' || value.length > 256) return '';
  const parts = value.split('.');
  if (parts.length > 8) return '';
  const safe = [];
  for (const part of parts) {
    const match = /^([A-Za-z_]+)(\[(?:\d{1,5})?\])?$/.exec(part);
    if (!match) return '';
    const name = HTTP_FIELD_NAMES.find(n => n === match[1] ||
      n.replace(/[A-Z]/g, c => '_' + c.toLowerCase()) === match[1]);
    if (!name) return '';
    // Never retain numeric indices: they can be echoed customer identifiers.
    safe.push(name + (match[2] ? '[]' : ''));
  }
  const field = safe.join('.');
  return field.length <= 128 ? field : '';
}

// Reused at the private journal boundary; callers cannot smuggle arbitrary text
// into reasonCode. At most 3 reasons + 3 paths, each drawn from static vocabulary.
export function sanitizeHttpErrorDiagnostics(value) {
  const reasons = [], fields = [];
  for (const reason of (Array.isArray(value?.reasons) ? value.reasons.slice(0, 16) : [])) {
    if (HTTP_REASON_CODES.has(reason) && !reasons.includes(reason) && reasons.length < 3) reasons.push(reason);
  }
  for (const input of (Array.isArray(value?.fields) ? value.fields.slice(0, 16) : [])) {
    const field = safeHttpField(input);
    if (field && !fields.includes(field) && fields.length < 3) fields.push(field);
  }
  return { reasons, fields };
}
function httpErrorDiagnostics(text) {
  // Bounds JSON parsing and retained diagnostics, not wix-fetch's text buffering.
  if (typeof text !== 'string' || text.length > 16384 || Buffer.byteLength(text, 'utf8') > 16384) return sanitizeHttpErrorDiagnostics(null);
  let body;
  try { body = JSON.parse(text); } catch (_) { return sanitizeHttpErrorDiagnostics(null); }
  const reasons = [body?.error?.status], fields = [];
  const details = body?.error?.details;
  for (const detail of (Array.isArray(details) ? details.slice(0, 16) : [])) {
    if (detail?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo') reasons.push(detail.reason);
    if (detail?.['@type'] === 'type.googleapis.com/google.rpc.BadRequest' && Array.isArray(detail.fieldViolations)) {
      for (const violation of detail.fieldViolations.slice(0, 16)) {
        reasons.push(violation?.reason);
        fields.push(violation?.field);
      }
    }
  }
  // Messages, descriptions, metadata, unrecognized detail types and the body
  // itself never escape this projection, even when they echo request contacts.
  return sanitizeHttpErrorDiagnostics({ reasons, fields });
}

export async function ingestEvent(payload) {
  let token, body;
  try {
    body = JSON.stringify(payload);
    token = await getAccessToken();
    if (typeof token !== 'string' || !token) throw new Error('Missing token');
  } catch (_) {
    throw ingestFailure('PRE_SEND_FAILURE', 'not_attempted');
  }

  // One fetch only. Once entered, uncertainty must not authorize a retry.
  let res, text;
  try {
    res = await fetch(ENDPOINT, {
      method: 'post',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body
    });
    text = await res.text();
  } catch (_) {
    throw ingestFailure('TRANSPORT_ERROR', 'unknown');
  }
  if (!res.ok) {
    const error = ingestFailure('HTTP_ERROR', 'unknown', res.status);
    error.httpDiagnostics = httpErrorDiagnostics(text);
    throw error;
  }
  let response;
  try { response = text ? JSON.parse(text) : null; }
  catch (_) { throw ingestFailure('INVALID_RESPONSE', 'unknown', res.status); }
  if (response && (response.ok === false || response.error ||
      (Array.isArray(response.errors) && response.errors.length > 0))) {
    throw ingestFailure('REJECTED_RESPONSE', 'processingfailure', res.status);
  }
  if (!response || typeof response.requestId !== 'string' || !response.requestId.trim()) {
    throw ingestFailure('MISSING_REQUEST_ID', 'unknown', res.status);
  }
  // requestId acknowledges ingestion only, NOT processing success/attribution.
  // fieldWarnings alone do not reject the request. Caller owns persistence.
  return response;
}
