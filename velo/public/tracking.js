// public/tracking.js
// Shared FRONT-END helper module (lives under "Public" in Velo).
// Captures Google Ads click IDs (gclid/gbraid/wbraid) from the landing URL,
// persists them across pages, and pushes dataLayer events for GA4 / Google Ads.

import { local } from 'wix-storage-frontend';
import wixLocationFrontend from 'wix-location-frontend';
import { getAdvertisingSuspension } from 'backend/settings.web';

const STORAGE_KEY = 'wl_click_attribution';
const CLICK_PARAMS = ['gclid', 'gbraid', 'wbraid', 'msclkid'];
const ATTRIBUTION_WINDOW_DAYS = 90;

function parseUrlParams(url) {
  try {
    const out = {};
    const idx = (url || '').indexOf('?');
    if (idx === -1) { return out; }
    const qs = url.substring(idx + 1);
    const pairs = qs.split('&');
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : decodeURIComponent(pair.substring(0, eq));
      const value = eq === -1 ? '' : decodeURIComponent(pair.substring(eq + 1));
      out[key] = value;
    }
    return out;
  } catch (e) {
    return {};
  }
}

// Reads click IDs from URL query and stores them (first-touch wins).
export function captureClickIds() {
  try {
    if (_suspendGoogleAds !== false || microsoftWithdrawn) {
      console.log('[WBE-TRACKING] suspended — skipping click-id capture');
      return null;
    }
    // Wix's location API strips ad-click parameters from the URL in some cases,
    // so read the real browser URL first and use Wix data only as fallback.
    const rawBrowserUrl = (typeof window !== 'undefined' && window.location && window.location.href) || '';
    let query = parseUrlParams(rawBrowserUrl);
    console.log('[WBE-TRACKING] raw browser URL:', rawBrowserUrl);
    console.log('[WBE-TRACKING] parsed from window.location:', JSON.stringify(query));

    // Fallback to Wix APIs if window.location is unavailable.
    if (!query.gclid && !query.gbraid && !query.wbraid && !query.msclkid) {
      query = wixLocationFrontend.query || {};
      console.log('[WBE-TRACKING] wixLocationFrontend.query:', JSON.stringify(query));
      if (!query.gclid && !query.gbraid && !query.wbraid && !query.msclkid) {
        query = parseUrlParams(wixLocationFrontend.url);
        console.log('[WBE-TRACKING] parsed from wixLocationFrontend.url:', JSON.stringify(query));
      }
    }

    const found = {};
    for (let i = 0; i < CLICK_PARAMS.length; i++) {
      const p = CLICK_PARAMS[i];
      if (query[p]) { found[p] = query[p]; }
    }

    console.log('[WBE-TRACKING] parsed click IDs:', JSON.stringify(found));

    if (Object.keys(found).length === 0) { return getStoredClickIds(); }

    const existing = getStoredClickIds();
    if (existing && (existing.gclid || existing.gbraid || existing.wbraid || existing.msclkid)) { return existing; }

    const record = {
      gclid: found.gclid || '',
      gbraid: found.gbraid || '',
      wbraid: found.wbraid || '',
      msclkid: found.msclkid || '',
      landingUrl: wixLocationFrontend.url || '',
      capturedAt: new Date().toISOString()
    };
    local.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  } catch (err) {
    console.error('captureClickIds failed:', err && err.message || err);
    return null;
  }
}

// Returns stored attribution object or null if none/expired.
export function getStoredClickIds() {
  try {
    const raw = local.getItem(STORAGE_KEY);
    if (!raw) { return null; }
    const record = JSON.parse(raw);

    if (record.capturedAt) {
      const ageMs = Date.now() - new Date(record.capturedAt).getTime();
      const maxMs = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs > maxMs) {
        local.removeItem(STORAGE_KEY);
        return null;
      }
    }
    return record;
  } catch (err) {
    console.error('getStoredClickIds failed:', err && err.message || err);
    return null;
  }
}

// Clears stored attribution after a successful conversion upload.
export function clearClickIds() {
  try { local.removeItem(STORAGE_KEY); } catch (err) { /* noop */ }
}

// Push an event onto window.dataLayer for the Google tag to pick up.
// Velo's localStorage is partitioned from the page (proved null from console),
// so events go through the hidden wbeEventBridge HTML iframe on the Master
// Page: Velo -> iframe.postMessage -> parent window -> head snippet -> dataLayer.
// Public modules can't use the $w global, so page code injects it once.

// Receiver-observed snapshots, not loss-tolerant remote revocation.
function opId() { try { var b=new Uint8Array(16); crypto.getRandomValues(b); return Array.from(b,function(x){return x.toString(16).padStart(2,'0');}).join(''); } catch (_) { return ''; } }
var opTupleKeys=['producerSession','relayBoot','googleBoot','microsoftBoot'];
function opValid(d) {
  if (!d || typeof d!=='object' || Array.isArray(d)) return false;
  var ds=Object.getOwnPropertyDescriptors(d), keys=Reflect.ownKeys(ds);
  if(keys.some(function(k){return typeof k!=='string'||!('value' in ds[k])||!ds[k].enumerable;})) return false;
  var types={probe:['producerSession'],discovery:['producerSession','receiver','headBoot'],ready:['producerSession','relayBoot','receiver','headBoot'],bind:opTupleKeys,state:opTupleKeys.concat(['revision','state','discardThrough']),ack:opTupleKeys.concat(['receiver','revision','state','discardThrough','phase']),business:opTupleKeys.concat(['revision','channel','message'])};
  if(!ds.type||!ds.version||ds.version.value!==1||typeof ds.type.value!=='string')return false;
  var shape=types[ds.type.value.replace('wbe-operational-','')];
  if(!shape||ds.type.value.indexOf('wbe-operational-')!==0||keys.sort().join(',')!==['type','version'].concat(shape).sort().join(','))return false;
  for(var k of shape){var v=ds[k].value;if(opTupleKeys.concat(['headBoot']).indexOf(k)>=0 && (typeof v!=='string'||!/^[a-f0-9]{32}$/.test(v)))return false;if(['revision','discardThrough'].indexOf(k)>=0&&(!Number.isSafeInteger(v)||v<0))return false;}
  if(ds.receiver&&['google','microsoft'].indexOf(ds.receiver.value)<0)return false;
  if(ds.channel&&['google','microsoft'].indexOf(ds.channel.value)<0)return false;
  if(ds.state&&['OFF','ON','UNRESOLVED'].indexOf(ds.state.value)<0)return false;
  if(ds.phase&&['bound','state'].indexOf(ds.phase.value)<0)return false;
  if(ds.discardThrough&&(d.discardThrough>d.revision||(d.state==='ON'&&d.discardThrough!==d.revision)))return false;
  return true;
}
function opSame(a,b){return !!a&&!!b&&opTupleKeys.every(function(k){return a[k]===b[k];});}
function opEnvelope(type,t,extra){return Object.assign({type:'wbe-operational-'+type,version:1},t||{},extra||{});}

let opSession=opId(), attachment=0, opFault=false, opTuple=null, opBound=false, opRevision=0, opWatermark=0, opReceipts={}, opReady={}, opFlight=null;
function opCancel(){if(opFlight){opFlight.closed=true;clearTimeout(opFlight.timer);}opFlight=null;}
function opStart(message,phase){
  opCancel();if(!microsoftBridge||!opSession||opFault)return;
  const bridge=microsoftBridge, generation=attachment, flight={message,phase,tries:0,closed:false,timer:null};opFlight=flight;
  function attempt(){if(opFlight!==flight||flight.closed||generation!==attachment||bridge!==microsoftBridge)return;
    if(flight.tries===5){flight.closed=true;opReceipts={};return;}
    flight.tries++;try{bridge.postMessage(message);}catch(_){}
    if(opFlight===flight&&!flight.closed)flight.timer=setTimeout(attempt,250);
  }attempt();
}
function opState(){opReceipts={};if(opBound)opStart(opEnvelope('state',opTuple,{revision:opRevision,state:_suspendGoogleAds===false?'OFF':_suspendGoogleAds===true?'ON':'UNRESOLVED',discardThrough:opWatermark}),'state');}
function opReceive(d){
  if(!opValid(d)||!opFlight||opFlight.closed||opFault)return;
  if(d.type==='wbe-operational-ready'&&opFlight.phase==='probe'&&d.producerSession===opSession){
    if(opReady[d.receiver]&&(opReady[d.receiver].headBoot!==d.headBoot||opReady[d.receiver].relayBoot!==d.relayBoot)){opFault=true;opCancel();return;}
    opReady[d.receiver]=d;
    if(opReady.google&&opReady.microsoft){if(opReady.google.relayBoot!==opReady.microsoft.relayBoot){opFault=true;return;}
      opTuple={producerSession:opSession,relayBoot:d.relayBoot,googleBoot:opReady.google.headBoot,microsoftBoot:opReady.microsoft.headBoot};opReceipts={};opStart(opEnvelope('bind',opTuple),'bound');}
  }else if(d.type==='wbe-operational-ack'&&opSame(opTuple,d)&&d.phase===opFlight.phase){
    const expected=opFlight.message;
    if(d.phase==='bound'?(d.revision!==0||d.state!=='UNRESOLVED'||d.discardThrough!==0):(d.revision!==expected.revision||d.state!==expected.state||d.discardThrough!==expected.discardThrough))return;
    opReceipts[d.receiver]=true;
    if(opReceipts.google&&opReceipts.microsoft){const phase=d.phase;opCancel();if(phase==='bound'){opBound=true;microsoftReady=true;opState();}else{const generation=attachment,revision=opRevision;setTimeout(function(){if(generation===attachment&&revision===opRevision){flushMicrosoft();flushGoogle();}},0);}}
  }
}
function opWrap(channel,message){return opEnvelope('business',opTuple,{revision:opRevision,channel,message});}
let _$w = null;
let _suspendGoogleAds = null;

// Ordered Microsoft-only transport. Readiness retains work while the iframe loads.
let microsoftBridge = null, microsoftReady = false, microsoftTimer = null;
let microsoftQueue = [], microsoftObservation = null, microsoftSequence = 0;
const microsoftSession = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
let microsoftRetryCount = 0, microsoftWithdrawn = false;
export function withdrawTracking() { withdrawMicrosoft(); }
function withdrawMicrosoft() {
  microsoftWithdrawn = true;
  googleQueue = [];
  observationGeneration++;
  microsoftQueue = [];
  if (microsoftTimer) clearTimeout(microsoftTimer);
  microsoftTimer = null;
}
function flushMicrosoft() {
  if (microsoftWithdrawn || _suspendGoogleAds !== false) return;
  if (!microsoftReady || !microsoftBridge) return;
  while (permitted() && microsoftQueue.length) {
    const envelope = microsoftQueue[0];
    try { microsoftBridge.postMessage(opWrap('microsoft',envelope)); }
    catch (_) {
      if (permitted() && !microsoftTimer && microsoftRetryCount < 4) {
        microsoftRetryCount++;
        microsoftTimer = setTimeout(function () { microsoftTimer = null; flushMicrosoft(); }, 250);
      }
      return;
    }
    if (microsoftQueue[0] === envelope) microsoftQueue.shift();
    microsoftRetryCount = 0;
  }
  if (microsoftTimer) clearTimeout(microsoftTimer);
  microsoftTimer = null;
}
function probeMicrosoft() {
  microsoftTimer = null;
  if (_suspendGoogleAds !== false || microsoftWithdrawn || microsoftReady || !microsoftBridge) return;
  try { microsoftBridge.postMessage({ type: 'wbe-microsoft-probe', version: 1 }); } catch (_) {}
  if (permitted() && !microsoftReady) microsoftTimer = setTimeout(probeMicrosoft, 250);
}
export function initTracking(w) {
  _$w=w;
  try {
    const bridge=w('#wbeEventBridge');if(!bridge||typeof bridge.postMessage!=='function'||typeof bridge.onMessage!=='function')throw Error('missing');
    if(bridge===microsoftBridge)return;
    if(microsoftBridge){opFault=true;opBound=false;opCancel();}
    const generation=++attachment;microsoftBridge=bridge;microsoftReady=false;
    bridge.onMessage(function(event){if(generation!==attachment||bridge!==microsoftBridge)return;const d=event&&event.data;
      // Independent negative channel must not depend on operational readiness.
      if(d&&typeof d==='object'&&!Array.isArray(d)){
        const ds=Object.getOwnPropertyDescriptors(d), keys=Reflect.ownKeys(ds);
        if(keys.length===2&&Object.prototype.hasOwnProperty.call(ds,'type')&&Object.prototype.hasOwnProperty.call(ds,'version')&&
          Object.prototype.hasOwnProperty.call(ds.type,'value')&&ds.type.enumerable&&
          Object.prototype.hasOwnProperty.call(ds.version,'value')&&ds.version.enumerable&&
          ds.type.value==='wbe-microsoft-withdrawn'&&ds.version.value===1){withdrawMicrosoft();return;}
      }
      opReceive(d);
    });
    opStart(opEnvelope('probe',null,{producerSession:opSession}),'probe');
  } catch(_){attachment++;opFault=true;opBound=false;opReceipts={};microsoftBridge=null;opCancel();}
}
export function observeMicrosoftPage(w) {
  initTracking(w);
  if (microsoftWithdrawn || _suspendGoogleAds === true) return;
  const url = String(wixLocationFrontend.url || '');
  const match = /^https:\/\/[^/]+(\/[^?#]*)?/.exec(url);
  const page = match && (match[1] || '/');
  if (!['/', '/wanderlust-booking', '/booking-summary'].includes(page)) return;
  microsoftObservation = page;
  // Readiness may arrive before the scalar: retain only the current route
  // while delivery is unresolved, without removing ordered business work.
  if (!permitted() || !microsoftReady) {
    microsoftQueue = microsoftQueue.filter(item => item.kind !== 'route');
  }
  microsoftQueue.push({ type: 'wbe-microsoft-message', version: 1,
    id: microsoftSession + '-' + (++microsoftSequence), kind: 'route', page_path: page, payload: null });
  try { flushMicrosoft(); } catch (_) { /* Retain unsent work. */ }
}

let googleQueue = [], observationFlight = null, observationGeneration = 0;
function permitted() { return _suspendGoogleAds === false && !microsoftWithdrawn && !opFault && opBound && opReceipts.google && opReceipts.microsoft; }
// Automatic capture belongs to the existing OFF completion, not init/replays.
// Direct captureClickIds retains its independent scalar/withdrawal contract.
let capturedRevision = -1;
function resumeClickCapture() {
  if (_suspendGoogleAds !== false || microsoftWithdrawn || capturedRevision === opRevision) return;
  capturedRevision = opRevision;
  captureClickIds();
}
function applySuspension(value) {
  _suspendGoogleAds = value;
  opReceipts={};
  if(opRevision===Number.MAX_SAFE_INTEGER){opFault=true;opCancel();return;}
  opRevision++;if(value===true)opWatermark=opRevision;
  // Clear this transition's old work before any reentrant control transport.
  if (microsoftTimer) clearTimeout(microsoftTimer);
  microsoftTimer = null;
  if (value === true) { microsoftQueue = []; googleQueue = []; }
  const revision = opRevision;
  if(opBound)opState();
  else if(microsoftBridge&&(!opFlight||opFlight.closed)){opReady={};opStart(opEnvelope('probe',null,{producerSession:opSession}),'probe');}
  if (revision !== opRevision) return;
  resumeClickCapture();
  if (!permitted()) return;
  if (!microsoftReady) probeMicrosoft();
  flushMicrosoft();
  flushGoogle();
}
// Legacy setter is a local operational transition, never a consent command.
export function setSuspendGoogleAds(value) {
  observationGeneration++;
  applySuspension(value === false ? false : value === true ? true : null);
}
export function observeTrackingSuspension() {
  if (observationFlight) return observationFlight;
  const generation = ++observationGeneration;
  applySuspension(null);
  const flight = Promise.resolve().then(() => getAdvertisingSuspension('suspendGoogleAds')).then(value => {
    if (generation !== observationGeneration) return;
    const scalar = typeof value === 'string' ? value.trim() : value;
    applySuspension(scalar === 0 || scalar === '0' ? false : scalar === 1 || scalar === '1' ? true : null);
  }, () => { if (generation === observationGeneration) applySuspension(null); });
  observationFlight = flight.finally(() => { observationFlight = null; });
  return observationFlight;
}
function flushGoogle() {
  while (permitted() && googleQueue.length && _$w) {
    const payload = googleQueue.shift();
    try { microsoftBridge.postMessage(opWrap('google',{ type: 'wbe-datalayer-event', payload })); }
    catch (_) { /* Legacy Google transport has no retry or delivery acknowledgment. */ }
  }
}
export function pushDataLayer(payload) {
  if (microsoftWithdrawn || _suspendGoogleAds === true || !_$w) return;
  const retained = { ...payload };
  microsoftQueue.push({ type: 'wbe-microsoft-message', version: 1,
    id: microsoftSession + '-' + (++microsoftSequence), kind: 'event',
    page_path: microsoftObservation || '/', payload: retained });
  googleQueue.push(retained);
  flushMicrosoft();
  flushGoogle();
}

// Fires when a visitor begins the booking funnel.
export function trackBeginBooking(details) {
  const d = details || {};
  const payload = {
    event: 'begin_booking',
    currency: d.currency || 'USD'
  };
  if (d.value) { payload.value = d.value; }
  if (d.checkIn) { payload.check_in = d.checkIn; }
  if (d.checkOut) { payload.check_out = d.checkOut; }
  if (d.nights) { payload.nights = d.nights; }
  if (d.guests) { payload.guests = d.guests; }
  pushDataLayer(payload);
}

// Fires when the booking search page loads — top-of-funnel audience pool.
export function trackViewBookingSearch() {
  pushDataLayer({ event: 'view_booking_search' });
}

// Fires once per room shown in search results — room-level interest signal.
export function trackRoomView(details) {
  const d = details || {};
  const payload = { event: 'room_view' };
  if (d.roomCode) { payload.room_code = d.roomCode; }
  if (d.nights) { payload.nights = d.nights; }
  pushDataLayer(payload);
}

// Fires when a search returns zero availability — high-intent visitor who hit
// a wall; prime audience for "dates freed up" remarketing.
export function trackSearchNoResults(details) {
  const d = details || {};
  const payload = { event: 'search_no_results' };
  if (d.nights) { payload.nights = d.nights; }
  if (d.checkIn) { payload.check_in = d.checkIn; }
  pushDataLayer(payload);
}

// Fires on confirmed booking (client-side signal).
export function trackPurchase(booking) {
  const payload = {
    event: 'purchase',
    transaction_id: booking.transactionId,
    value: booking.value,
    currency: booking.currency || 'USD'
  };
  if (booking.items && booking.items.length > 0) {
    payload.items = booking.items;
  }
  pushDataLayer(payload);
}
