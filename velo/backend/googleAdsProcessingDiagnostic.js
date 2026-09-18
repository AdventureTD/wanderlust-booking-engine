// Private temporary processing READ diagnostic for fixed retained acknowledgments.
// Run only the named function tester. No event send, retry, or journal write.
import { getAccessToken } from 'backend/dataManagerClient.web';
import { fetch } from 'wix-fetch';

const DEADLINE_MS = 15000;
const INPUT_BYTES = 65536;
const OUTPUT_BYTES = 16384;
const STATUSES = new Set(['REQUEST_STATUS_UNKNOWN', 'SUCCESS', 'PROCESSING', 'FAILED', 'PARTIAL_SUCCESS']);

export async function readWC1035ProcessingStatus() {
  const id = '956aa6b6-f5b1-409d-aed0-d48b120ac6a9';
  if (arguments.length) return failure(id, 'ARGUMENTS_NOT_ALLOWED');
  return readStatus(id);
}

export async function readWC1036ProcessingStatus() {
  const id = '0e453038-1a79-4b99-af2d-cd433bc8cf4f';
  if (arguments.length) return failure(id, 'ARGUMENTS_NOT_ALLOWED');
  return readStatus(id);
}

export async function readWC1034ProcessingStatus() {
  const id = '82e091ac-6686-4a7d-ab9e-5a2aada23c32';
  if (arguments.length) return failure(id, 'ARGUMENTS_NOT_ALLOWED');
  return readStatus(id);
}

function failure(requestId, failureCode, httpStatus = null) {
  return { requestId, observedAtUtc: new Date().toISOString(), httpStatus,
    projectionComplete: false, unknownReasonPresent: false, failureCode, destinations: [] };
}

async function readStatus(requestId) {
  let stopped = false, httpStatus = null, timer;
  const end = Date.now() + DEADLINE_MS;
  const expired = () => stopped || Date.now() >= end;
  const fail = code => failure(requestId, code, httpStatus);
  // A bounded wait, NOT cancellation of the existing OAuth helper or wix-fetch.
  // A late auth completion is fenced before the status GET; no retries occur.
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => { stopped = true; resolve(fail('TIMEOUT')); }, DEADLINE_MS);
  });
  async function work() {
    let token;
    try {
      token = await getAccessToken();
      if (expired()) return fail('TIMEOUT');
      if (typeof token !== 'string' || !token || token.length > 16384 || /[^\x21-\x7e]/.test(token)) return fail('AUTH_FAILED');
    } catch (_) { return fail('AUTH_FAILED'); }
    let response, text;
    try {
      if (expired()) return fail('TIMEOUT');
      response = await fetch('https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=' + encodeURIComponent(requestId), {
        method: 'GET', headers: { Authorization: 'Bearer ' + token }
      });
      token = null;
      if (expired()) return fail('TIMEOUT');
      if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) return fail('INVALID_RESPONSE');
      httpStatus = response.status;
      if (httpStatus !== 200) return fail('HTTP_ERROR');
      text = await response.text();
      if (expired()) return fail('TIMEOUT');
    } catch (_) { return fail('READ_FAILED'); }
    // wix-fetch buffers text: this bounds UTF-8 JSON parsing, not network memory.
    if (typeof text !== 'string') return fail('INVALID_RESPONSE');
    if (text.length > INPUT_BYTES || Buffer.byteLength(text, 'utf8') > INPUT_BYTES) return fail('RESPONSE_TOO_LARGE');
    let body;
    try { body = JSON.parse(text); } catch (_) { return fail('INVALID_JSON'); }
    try {
      const projection = project(body);
      const result = { requestId, observedAtUtc: new Date().toISOString(), httpStatus, ...projection };
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > OUTPUT_BYTES) return fail('OUTPUT_TOO_LARGE');
      return result;
    } catch (_) { return fail('INVALID_SCHEMA'); }
  }
  try { return await Promise.race([work(), timeout]); }
  catch (_) { return fail('READ_FAILED'); }
  finally { stopped = true; clearTimeout(timer); }
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function count(value) {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) &&
    (value.length < 19 || value <= '9223372036854775807');
}

function project(body) {
  if (!object(body) || !Array.isArray(body.requestStatusPerDestination) ||
      !body.requestStatusPerDestination.length || body.requestStatusPerDestination.length > 10) throw new Error('SCHEMA');
  let complete = true, unknownReasonPresent = false;
  const destinations = body.requestStatusPerDestination.map(row => {
    if (!object(row)) throw new Error('SCHEMA');
    let rowComplete = true;
    const mark = () => { complete = false; rowComplete = false; };
    const match = object(row.destination) && object(row.destination.operatingAccount) &&
      row.destination.operatingAccount.accountType === 'GOOGLE_ADS' &&
      row.destination.operatingAccount.accountId === '9426928570' && row.destination.productDestinationId === '7690532327';
    if (!match) mark();
    const knownStatus = STATUSES.has(row.requestStatus);
    const requestStatus = knownStatus ? row.requestStatus : 'REQUEST_STATUS_UNKNOWN';
    if (!knownStatus || requestStatus === 'REQUEST_STATUS_UNKNOWN' || requestStatus === 'PROCESSING') mark();
    let recordCount = null;
    if (object(row.eventsIngestionStatus) && count(row.eventsIngestionStatus.recordCount)) recordCount = row.eventsIngestionStatus.recordCount;
    else mark();
    if (['audienceMembersIngestionStatus', 'audienceMembersRemovalStatus', 'removeAllAudienceMembersStatus'].some(key => key in row)) mark();
    const pairs = (info, key, allowed) => {
      if (info === undefined) return [];
      if (!object(info)) { mark(); return []; }
      const entries = info[key];
      if (entries === undefined) return [];
      if (!Array.isArray(entries) || entries.length > 64) throw new Error('SCHEMA');
      return entries.map(entry => {
        if (!object(entry)) throw new Error('SCHEMA');
        const known = allowed.has(entry.reason);
        if (!known) { mark(); unknownReasonPresent = true; }
        if (!count(entry.recordCount)) mark();
        if (typeof entry.reason === 'string' && entry.reason.endsWith('_UNSPECIFIED')) mark();
        return { reason: known ? entry.reason : 'UNKNOWN', recordCount: count(entry.recordCount) ? entry.recordCount : null };
      });
    };
    const errors = pairs(row.errorInfo, 'errorCounts', ERROR_REASONS);
    const warnings = pairs(row.warningInfo, 'warningCounts', WARNING_REASONS);
    // Missing error details are possible in the API; mark them incomplete, never invent a cause.
    if ((requestStatus === 'FAILED' || requestStatus === 'PARTIAL_SUCCESS') && !errors.length) mark();
    if ((requestStatus === 'SUCCESS' || requestStatus === 'PROCESSING') && errors.length) mark();
    if (requestStatus === 'PROCESSING' && warnings.length) mark();
    return { destinationMatch: match, accountId: match ? '9426928570' : null,
      productDestinationId: match ? '7690532327' : null, requestStatus, recordCount,
      errors, warnings, projectionComplete: rowComplete };
  });
  return { projectionComplete: complete, unknownReasonPresent,
    failureCode: complete ? null : 'INCOMPLETE_DATA', destinations };
}

// ProcessingErrorReason / ProcessingWarningReason, NOT ingestion ErrorReason.
// Verified against Google v1 discovery and requestStatus.retrieve reference.
const ERROR_REASONS = new Set([
  "PROCESSING_ERROR_REASON_UNSPECIFIED",
  "PROCESSING_ERROR_REASON_INVALID_CUSTOM_VARIABLE",
  "PROCESSING_ERROR_REASON_CUSTOM_VARIABLE_NOT_ENABLED",
  "PROCESSING_ERROR_REASON_EVENT_TOO_OLD",
  "PROCESSING_ERROR_REASON_DENIED_CONSENT",
  "PROCESSING_ERROR_REASON_NO_CONSENT",
  "PROCESSING_ERROR_REASON_UNKNOWN_CONSENT",
  "PROCESSING_ERROR_REASON_DUPLICATE_GCLID",
  "PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID",
  "PROCESSING_ERROR_REASON_INVALID_GBRAID",
  "PROCESSING_ERROR_REASON_INVALID_GCLID",
  "PROCESSING_ERROR_REASON_INVALID_MERCHANT_ID",
  "PROCESSING_ERROR_REASON_INVALID_WBRAID",
  "PROCESSING_ERROR_REASON_INTERNAL_ERROR",
  "PROCESSING_ERROR_REASON_DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED",
  "PROCESSING_ERROR_REASON_INVALID_EVENT",
  "PROCESSING_ERROR_REASON_INSUFFICIENT_MATCHED_TRANSACTIONS",
  "PROCESSING_ERROR_REASON_INSUFFICIENT_TRANSACTIONS",
  "PROCESSING_ERROR_REASON_INVALID_FORMAT",
  "PROCESSING_ERROR_REASON_DECRYPTION_ERROR",
  "PROCESSING_ERROR_REASON_DEK_DECRYPTION_ERROR",
  "PROCESSING_ERROR_REASON_INVALID_WIP",
  "PROCESSING_ERROR_REASON_INVALID_KEK",
  "PROCESSING_ERROR_REASON_WIP_AUTH_FAILED",
  "PROCESSING_ERROR_REASON_KEK_PERMISSION_DENIED",
  "PROCESSING_ERROR_REASON_AWS_AUTH_FAILED",
  "PROCESSING_ERROR_REASON_USER_IDENTIFIER_DECRYPTION_ERROR",
  "PROCESSING_ERROR_OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER",
  "PROCESSING_ERROR_REASON_ONE_PER_CLICK_CONVERSION_ACTION_NOT_PERMITTED_WITH_BRAID",
  "PROCESSING_ERROR_REASON_MATCH_ID_NOT_FOUND",
  "PROCESSING_ERROR_REASON_USER_ID_NOT_FOUND_FOR_MATCH_ID",
  "PROCESSING_ERROR_REASON_USER_ID_NOT_FOUND_FOR_GCLID",
  "PROCESSING_ERROR_REASON_USER_ID_NOT_FOUND_FOR_DCLID",
  "PROCESSING_ERROR_REASON_INVALID_AD_IDENTIFIERS",
  "PROCESSING_ERROR_REASON_INVALID_MOBILE_ID_FORMAT",
  "PROCESSING_ERROR_REASON_ORIGINAL_CONVERSIONS_NOT_FOUND",
  "PROCESSING_ERROR_REASON_EVENT_ID_DECODE_ERROR",
  "PROCESSING_ERROR_REASON_USER_ID_NOT_FOUND_FOR_IMPRESSION_ID",
  "PROCESSING_ERROR_REASON_USER_ID_NOT_FOUND",
  "PROCESSING_ERROR_REASON_CONVERSION_PRECEDES_CLICK",
  "PROCESSING_ERROR_REASON_TOO_RECENT_CLICK",
  "PROCESSING_ERROR_REASON_INVALID_CLICK",
  "PROCESSING_ERROR_REASON_INVALID_OPERATING_ACCOUNT_FOR_CLICK",
  "PROCESSING_ERROR_REASON_CLICK_NOT_FOUND",
  "PROCESSING_ERROR_REASON_EXTERNAL_ATTRIBUTION_DATA_MISSING"
]);

const WARNING_REASONS = new Set([
  "PROCESSING_WARNING_REASON_UNSPECIFIED",
  "PROCESSING_WARNING_REASON_KEK_PERMISSION_DENIED",
  "PROCESSING_WARNING_REASON_DEK_DECRYPTION_ERROR",
  "PROCESSING_WARNING_REASON_DECRYPTION_ERROR",
  "PROCESSING_WARNING_REASON_WIP_AUTH_FAILED",
  "PROCESSING_WARNING_REASON_INVALID_WIP",
  "PROCESSING_WARNING_REASON_INVALID_KEK",
  "PROCESSING_WARNING_REASON_USER_IDENTIFIER_DECRYPTION_ERROR",
  "PROCESSING_WARNING_REASON_INTERNAL_ERROR",
  "PROCESSING_WARNING_REASON_AWS_AUTH_FAILED"
]);
