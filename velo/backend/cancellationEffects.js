import wixData from 'wix-data';
import crypto from 'crypto';
import { getSecret } from 'wix-secrets-backend';
import { fetch } from 'wix-fetch';

const LEDGER = 'BookingCancellationEffects';
const effectId = (id, suffix) => crypto.createHash('sha256').update('cancellation-v1:' + id + ':' + suffix).digest('hex').slice(0,32);
const READ = { suppressAuth: true, consistentRead: true };
const WRITE = { suppressAuth: true, suppressHooks: true };
// A timeout bounds waiting, not remote execution. START is never reclaimed.
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PENDING')), 8000); })]); }
  finally { clearTimeout(timer); }
}
const day = value => new Date(value).toISOString().slice(0,10);

export async function emailCancellation({ operation, summary, rooms }) {
  if (operation.legacyCancelled) return 'NEEDS_RECONCILIATION';
  const startId = effectId(operation._id, 'email');
  const ackId = effectId(operation._id, 'email-ack');
  try {
    const ack = await bounded(wixData.get(LEDGER, ackId, READ));
    if (ack && ack.bookingNumber === operation.bookingNumber && ack.messageId) return 'ACKNOWLEDGED';
    const start = await bounded(wixData.get(LEDGER, startId, READ));
    if (start) return 'UNKNOWN';
  } catch (_) { return 'NEEDS_RECONCILIATION'; }
  let url, secret, body;
  try {
    if (!summary.guestEmail) return 'UNSENT_MISSING_RECIPIENT';
    url = await bounded(getSecret('WBE_INVOICE_SERVICE_URL'));
    secret = await bounded(getSecret('WBE_SHARED_SECRET'));
    if (!/^https:\/\/[^/?#]+$/.test(url) || !secret) return 'UNSENT_CONFIGURATION';
    body = JSON.stringify({ operation_id: startId, booking_number: operation.bookingNumber, guest_name: summary.guestName || 'Guest',
      guest_email: summary.guestEmail, check_in: day(summary.checkIn), check_out: day(summary.checkOut),
      rooms_desc: rooms.map(r => r.roomCode + ' x' + r.quantity).join(', '), reason: operation.reason });
  } catch (_) { return 'UNSENT_CONFIGURATION'; }
  // Only this invocation's successful insert AND readback permit a send.
  try {
    await bounded(wixData.insert(LEDGER, { _id: startId, bookingNumber: operation.bookingNumber, effect: 'EMAIL', state: 'STARTED' }, WRITE));
    const retained = await bounded(wixData.get(LEDGER, startId, READ));
    if (!retained || retained.bookingNumber !== operation.bookingNumber || retained.state !== 'STARTED') return 'UNKNOWN';
  } catch (_) { return 'UNKNOWN'; }
  try {
    // Wix documents node-fetch extensions for backend fetch; retain redirect denial.
    /** @type {{method: string, redirect: 'error', headers: Object<string, string>, body: string}} */
    const emailRequest = { method: 'post', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-WBE-Secret': secret }, body };
    const response = await bounded(fetch(url + '/v2/send-cancellation-email', emailRequest));
    if (!response.ok) return 'UNKNOWN';
    const result = await bounded(response.json());
    if (!result || result.ok !== true || result.operation_id !== startId || result.booking_number !== operation.bookingNumber ||
        typeof result.gmail_message_id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(result.gmail_message_id)) return 'UNKNOWN';
    await bounded(wixData.insert(LEDGER, { _id: ackId, bookingNumber: operation.bookingNumber, effect: 'EMAIL', state: 'ACKNOWLEDGED', messageId: result.gmail_message_id }, WRITE));
    const ack = await bounded(wixData.get(LEDGER, ackId, READ));
    return ack && ack.messageId === result.gmail_message_id && ack.bookingNumber === operation.bookingNumber ? 'ACKNOWLEDGED' : 'UNKNOWN';
  } catch (_) { return 'UNKNOWN'; }
}

// Inspect only contract fields; never invoke boundary getters or serialize raw objects.
function calendarOwnData(value, fields) {
  if (!value || typeof value !== 'object') return null;
  const proof = Object.create(null);
  try {
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      proof[field] = descriptor.value;
    }
  } catch (_) { return null; }
  return proof;
}

function calendarDeletionAck(value, bookingNumber) {
  const ack = calendarOwnData(value, ['bookingNumber', 'effect', 'state', 'disposition', 'deletionVersion', 'eventId', 'calendarId']);
  return ack && typeof ack.bookingNumber === 'string' && ack.bookingNumber === bookingNumber && ack.effect === 'CALENDAR' &&
    ack.state === 'CANCELLED' && ack.disposition === 'DELETED' && ack.deletionVersion === 1 &&
    typeof ack.eventId === 'string' && !!ack.eventId && typeof ack.calendarId === 'string' && !!ack.calendarId ? ack : null;
}

async function calendarCancellation(context) {
  const op = context.operation, ackId = effectId(op._id, 'calendar-delete-ack-v1');
  try {
    const retained = await bounded(wixData.get(LEDGER, ackId, READ));
    if (calendarDeletionAck(retained, op.bookingNumber)) return 'CANCELLED';
    if (retained || await bounded(wixData.get(LEDGER, effectId(op._id, 'calendar-ack'), READ))) return 'NEEDS_RECONCILIATION';
    // Historical title-only ACKs require explicit reconciliation, never automatic replay.
    const url = await bounded(getSecret('WBE_INVOICE_SERVICE_URL'));
    const secret = await bounded(getSecret('WBE_SHARED_SECRET'));
    if (!/^https:\/\/[^/?#]+$/.test(url) || !secret) return 'UNSENT_CONFIGURATION';
    // Deny redirects before forwarding the shared secret to any successor URL.
    /** @type {{method: string, redirect: 'error', headers: Object<string, string>, body: string}} */
    const calendarRequest = {method: 'post', redirect: 'error',
      headers: {'Content-Type':'application/json', 'X-WBE-Secret':secret},
      body: JSON.stringify({booking_number:context.operation.bookingNumber})};
    const response = await bounded(fetch(url + '/reconcile-cancellation-calendar', calendarRequest));
    if (!response.ok) return 'UNKNOWN';
    const rawResult = await bounded(response.json());
    const result = calendarOwnData(rawResult, ['status', 'booking_number', 'disposition', 'deletion_version', 'calendar_id', 'event_id']);
    if (result && result.status === 'CANCELLED' && typeof result.booking_number === 'string' && result.booking_number === op.bookingNumber &&
        result.disposition === 'DELETED' && result.deletion_version === 1 &&
        typeof result.calendar_id === 'string' && result.calendar_id && typeof result.event_id === 'string' && result.event_id) {
      // Only the detached, versioned exact-event deletion proof may become durable success.
      try { await bounded(wixData.insert(LEDGER, {_id:ackId,bookingNumber:result.booking_number,effect:'CALENDAR',state:'CANCELLED',
        disposition:'DELETED',deletionVersion:1,calendarId:result.calendar_id,eventId:result.event_id},WRITE)); } catch (_) { /* read retained ACK */ }
      const ack = calendarDeletionAck(await bounded(wixData.get(LEDGER,ackId,READ)), op.bookingNumber);
      return ack && ack.eventId === result.event_id && ack.calendarId === result.calendar_id ? 'CANCELLED' : 'UNKNOWN';
    }
    const status = calendarOwnData(rawResult, ['status']);
    return status && status.status === 'NEEDS_RECONCILIATION' ? 'NEEDS_RECONCILIATION' : 'UNKNOWN';
  } catch (_) { return 'UNKNOWN'; }
}

// Google-only response cap: node-fetch enforces decoded body size when supported;
// the text check also denies oversized JSON before parsing in hosted Wix.
async function googleJson(response) {
  if (!response || !response.ok) throw new Error('GOOGLE_RESPONSE');
  const text = await bounded(response.text());
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 65536) throw new Error('GOOGLE_RESPONSE_SIZE');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GOOGLE_RESPONSE_SHAPE');
  return value;
}

async function ga4Cancellation(context) {
  const op = context.operation, startId = effectId(op._id, 'ga4'), ackId = effectId(op._id, 'ga4-ack');
  let approval, metadata, url, body;
  try {
    const ack = await bounded(wixData.get(LEDGER, ackId, READ));
    if (ack && ack.bookingNumber === op.bookingNumber && ack.state === 'RECEIVED_UNVERIFIED') return ack.state;
    if (await bounded(wixData.get(LEDGER, startId, READ))) return 'UNKNOWN';
    approval = await bounded(wixData.get('BookingCancellationAnalytics', op._id, READ));
    metadata = approval && approval.ga4;
    if (!approval || approval.bookingNumber !== op.bookingNumber || !metadata || metadata.approved !== true ||
        metadata.duplicateCheckClear !== true || metadata.consentEligible !== true || metadata.withdrawn !== false ||
        !(new Date(metadata.consentValidUntil).getTime() > Date.now()) ||
        typeof metadata.clientId !== 'string' || !metadata.clientId || metadata.clientId.length > 200 ||
        typeof metadata.transactionId !== 'string' || metadata.transactionId !== op.bookingNumber || metadata.transactionId.length > 100 ||
        !Number.isFinite(metadata.value) || metadata.value <= 0 || !/^[A-Z]{3}$/.test(metadata.currency)) return 'NEEDS_RECONCILIATION';
    const measurementId = await bounded(getSecret('WBE_GA4_MEASUREMENT_ID'));
    const secret = await bounded(getSecret('WBE_GA4_API_SECRET'));
    if (measurementId !== metadata.measurementId || !/^G-[A-Z0-9]+$/.test(measurementId) || !secret) return 'UNSENT_CONFIGURATION';
    url = '?measurement_id=' + encodeURIComponent(measurementId) + '&api_secret=' + encodeURIComponent(secret);
    body = {client_id:metadata.clientId, events:[{name:'refund', params:{transaction_id:metadata.transactionId, value:metadata.value, currency:metadata.currency}}]};
    const validation = await bounded(fetch('https://www.google-analytics.com/debug/mp/collect' + url,
      {method:'post',redirect:'error',size:65536,timeout:8000,headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,validation_behavior:'ENFORCE_RECOMMENDATIONS'})}));
    const validated = await googleJson(validation);
    if (!validation.ok || !Array.isArray(validated.validationMessages) || validated.validationMessages.length) return 'UNSENT_VALIDATION';
    // Re-read withdrawal/approval after the optional validation network wait.
    const current = await bounded(wixData.get('BookingCancellationAnalytics', op._id, READ));
    if (!current || current.bookingNumber !== op.bookingNumber || JSON.stringify(current.ga4) !== JSON.stringify(metadata) || !(new Date(metadata.consentValidUntil).getTime() > Date.now())) return 'NEEDS_RECONCILIATION';
  } catch (_) { return 'UNSENT_CONFIGURATION'; }
  try {
    await bounded(wixData.insert(LEDGER, {_id:startId,bookingNumber:op.bookingNumber,effect:'GA4',state:'STARTED'}, WRITE));
    const start = await bounded(wixData.get(LEDGER,startId,READ));
    if (!start || start.bookingNumber !== op.bookingNumber || !(new Date(metadata.consentValidUntil).getTime() > Date.now())) return 'UNKNOWN';
    // Last observable approval read. Revocation after this await is not atomically observable by Google.
    const current = await bounded(wixData.get('BookingCancellationAnalytics',op._id,READ));
    if (!current || current.bookingNumber !== op.bookingNumber || JSON.stringify(current.ga4) !== JSON.stringify(metadata) || !(new Date(metadata.consentValidUntil).getTime() > Date.now())) return 'NEEDS_RECONCILIATION';
    const response = await bounded(fetch('https://www.google-analytics.com/mp/collect' + url,
      {method:'post',redirect:'error',size:65536,timeout:8000,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
    if (!response.ok) return 'UNKNOWN';
    await bounded(wixData.insert(LEDGER,{_id:ackId,bookingNumber:op.bookingNumber,effect:'GA4',state:'RECEIVED_UNVERIFIED'},WRITE));
    const ack = await bounded(wixData.get(LEDGER,ackId,READ));
    return ack && ack.state === 'RECEIVED_UNVERIFIED' && ack.bookingNumber === op.bookingNumber ? 'RECEIVED_UNVERIFIED' : 'UNKNOWN';
  } catch (_) { return 'UNKNOWN'; }
}

async function adsApprovedNow(op, metadata) {
  // Manual approval is never consent and cannot override withdrawal/expiry.
  if (metadata.consentEligible !== true || metadata.withdrawn !== false ||
      !(new Date(metadata.consentValidUntil).getTime() > Date.now())) return false;
  // Unlike the legacy helper, missing/failed settings deny dispatch.
  const settings = await bounded(wixData.query('Settings').eq('key','suspendGoogleAds').limit(2).find(READ));
  if (!settings || !Array.isArray(settings.items) || settings.items.length !== 1 || String(settings.items[0].value).trim() !== '0') return false;
  const current = await bounded(wixData.get('BookingCancellationAnalytics',op._id,READ));
  // Expiry is locally observable after both policy waits, even without a metadata change.
  return !!current && current.bookingNumber === op.bookingNumber && JSON.stringify(current.ads) === JSON.stringify(metadata) &&
    new Date(metadata.consentValidUntil).getTime() > Date.now();
}

async function adsCancellation(context) {
  const op = context.operation, startId = effectId(op._id, 'ads'), ackId = effectId(op._id, 'ads-ack');
  let token, customer, action, login, metadata, developerToken;
  try {
    const ack = await bounded(wixData.get(LEDGER, ackId, READ));
    if (ack && ack.bookingNumber === op.bookingNumber && ack.state === 'ACKNOWLEDGED') return 'ACKNOWLEDGED';
    if (await bounded(wixData.get(LEDGER, startId, READ))) return 'UNKNOWN';
    const approval = await bounded(wixData.get('BookingCancellationAnalytics', op._id, READ));
    metadata = approval && approval.ads;
    if (!approval || approval.bookingNumber !== op.bookingNumber || !metadata || metadata.approved !== true || metadata.originalRecorded !== true ||
        typeof metadata.orderId !== 'string' || metadata.orderId !== op.bookingNumber || metadata.orderId.length > 100) return 'NEEDS_RECONCILIATION';
    if (!await adsApprovedNow(op,metadata)) return 'UNSENT_SUSPENDED_OR_APPROVAL_CHANGED';
    if (await bounded(getSecret('WBE_GOOGLE_ADS_ADJUSTMENTS_ENABLED')) !== 'true') return 'UNSENT_CONFIGURATION';
    developerToken = await bounded(getSecret('GOOGLE_ADS_DEVELOPER_TOKEN'));
    if (!/^[A-Za-z0-9]{22}$/.test(developerToken)) return 'UNSENT_CONFIGURATION';
    customer = await bounded(getSecret('GOOGLE_ADS_CUSTOMER_ID'));
    action = await bounded(getSecret('GOOGLE_ADS_CONVERSION_ACTION_ID'));
    if (!/^[0-9]+$/.test(customer) || !/^[0-9]+$/.test(action) || customer !== metadata.customerId || action !== metadata.conversionActionId) return 'UNSENT_CONFIGURATION';
    login = await bounded(getSecret('GOOGLE_ADS_LOGIN_CUSTOMER_ID'));
    if (login && !/^[0-9]+$/.test(login)) return 'UNSENT_CONFIGURATION';
    const email = await bounded(getSecret('GOOGLE_SA_CLIENT_EMAIL'));
    const key = (await bounded(getSecret('GOOGLE_SA_PRIVATE_KEY'))).replace(/\\n/g, '\n');
    const now = Math.floor(Date.now()/1000);
    const encode = value => Buffer.from(value).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    const unsigned = encode(JSON.stringify({alg:'RS256',typ:'JWT'})) + '.' + encode(JSON.stringify({iss:email,scope:'https://www.googleapis.com/auth/adwords',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
    const assertion = unsigned + '.' + encode(crypto.createSign('RSA-SHA256').update(unsigned).sign(key));
    // Secret reads may outlast consent; no awaited gap between this sample and OAuth.
    const oauthDispatchNow = Date.now();
    if (!(new Date(metadata.consentValidUntil).getTime() > oauthDispatchNow)) return 'UNSENT_SUSPENDED_OR_APPROVAL_CHANGED';
    const response = await bounded(fetch('https://oauth2.googleapis.com/token', {method:'post',redirect:'error',size:65536,timeout:8000,headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString()}));
    const auth = await googleJson(response);
    if (!response.ok || typeof auth.access_token !== 'string' || !auth.access_token) return 'UNSENT_CONFIGURATION';
    token = auth.access_token;
    if (!await adsApprovedNow(op,metadata)) return 'UNSENT_SUSPENDED_OR_APPROVAL_CHANGED';
  } catch (_) { return 'UNSENT_CONFIGURATION'; }
  try {
    await bounded(wixData.insert(LEDGER,{_id:startId,bookingNumber:op.bookingNumber,effect:'ADS',state:'STARTED'},WRITE));
    const start = await bounded(wixData.get(LEDGER,startId,READ));
    if (!start || start.bookingNumber !== op.bookingNumber) return 'UNKNOWN';
    if (!await adsApprovedNow(op,metadata)) return 'NEEDS_RECONCILIATION';
    const conversionAction = 'customers/' + customer + '/conversionActions/' + action;
    const headers = {'Content-Type':'application/json',Authorization:'Bearer ' + token,'developer-token':developerToken};
    if (login) headers['login-customer-id'] = login;
    // Last observable policy read is not atomic revocation. Locally known expiry is checked now.
    const adsDispatchNow = Date.now();
    if (!(new Date(metadata.consentValidUntil).getTime() > adsDispatchNow)) return 'NEEDS_RECONCILIATION';
    const adjustmentDateTime = new Date(adsDispatchNow).toISOString().slice(0,19).replace('T',' ') + '+00:00';
    const response = await bounded(fetch('https://googleads.googleapis.com/v25/customers/' + customer + ':uploadConversionAdjustments', {
      method:'post',redirect:'error',size:65536,timeout:8000,headers,body:JSON.stringify({partialFailure:true,validateOnly:false,conversionAdjustments:[{orderId:metadata.orderId,conversionAction,
        adjustmentType:'RETRACTION',adjustmentDateTime}]})}));
    const result = await googleJson(response);
    const receipt = result && Array.isArray(result.results) && result.results.length === 1 && result.results[0];
    if (!response.ok || Object.prototype.hasOwnProperty.call(result, 'partialFailureError') || !receipt || receipt.orderId !== metadata.orderId || receipt.conversionAction !== conversionAction || receipt.adjustmentType !== 'RETRACTION' || receipt.adjustmentDateTime !== adjustmentDateTime) return 'UNKNOWN';
    await bounded(wixData.insert(LEDGER,{_id:ackId,bookingNumber:op.bookingNumber,effect:'ADS',state:'ACKNOWLEDGED'},WRITE));
    const ack = await bounded(wixData.get(LEDGER,ackId,READ));
    return ack && ack.bookingNumber === op.bookingNumber && ack.state === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'UNKNOWN';
  } catch (_) { return 'UNKNOWN'; }
}

export async function readCancellationEffects(summary) {
  const effects = {};
  for (const effect of ['email','calendar','ads','ga4']) {
    try {
      const ack = await bounded(wixData.get(LEDGER,effectId(summary._id, effect === 'calendar' ? 'calendar-delete-ack-v1' : effect + '-ack'),READ));
      const allowed = effect === 'ga4' ? 'RECEIVED_UNVERIFIED' : effect === 'calendar' ? 'CANCELLED' : 'ACKNOWLEDGED';
      if (effect === 'calendar' ? calendarDeletionAck(ack, summary.bookingNumber) :
          ack && ack.bookingNumber === summary.bookingNumber && ack.state === allowed) effects[effect] = allowed;
      else effects[effect] = await bounded(wixData.get(LEDGER,effectId(summary._id, effect),READ)) ? 'UNKNOWN' : 'NEEDS_RECONCILIATION';
    } catch (_) { effects[effect] = 'NEEDS_RECONCILIATION'; }
  }
  return effects;
}

export async function cancellationEffects(context) {
  return { email: await emailCancellation(context), calendar: await calendarCancellation(context),
    ads: await adsCancellation(context), ga4: await ga4Cancellation(context) };
}
