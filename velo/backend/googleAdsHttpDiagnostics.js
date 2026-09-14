// Private synchronous diagnostic projection; no web methods or IO.
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
