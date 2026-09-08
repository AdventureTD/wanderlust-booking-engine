'use strict';
// Actual inline HTML source, inert synthetic DOM/storage/dataLayer. No tags or network run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
// LF-normalized source comparisons; raw working-file hashes are recorded externally.
const html = fs.readFileSync(path.join(root, 'velo/custom-code/google-tag-and-consent.html'), 'utf8').replace(/\r\n/g, '\n');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.filter(m => !/\bsrc=/.test(m[1])).length, 1);
const source = scripts.find(m => !/\bsrc=/.test(m[1]))[2];
new vm.Script(source); // Parse the complete actual inline source, including unchanged event/click-ID code.
const signals = ['analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization'];
const denied = Object.fromEntries(signals.map(k => [k, 'denied']));
const granted = Object.fromEntries(signals.map(k => [k, 'granted']));
const tests = [];
function test(name, run) { tests.push({ name, run }); }
function harness(options = {}) {
  const trace = [], elements = [], documentListeners = {}, windowListeners = {};
  const storage = new Map(options.choice === undefined ? [] : [['wbe_consent_choice', options.choice]]);
  let domError = options.domError;
  let tagError = false;
  function listen(target, type, fn) { (target[type] ||= []).push(fn); }
  function emit(target, type, event = {}) { (target[type] || []).forEach(fn => fn(event)); }
  function element(tag) {
    const listeners = {};
    const el = { tag, style: {}, children: [], parentNode: null,
      setAttribute() {}, addEventListener(type, fn) { listen(listeners, type, fn); },
      appendChild(child) { if (domError) throw Error('synthetic DOM failure'); this.children.push(child); child.parentNode = this; },
      removeChild(child) { trace.push('hide'); if (domError) throw Error('synthetic DOM failure'); this.children = this.children.filter(c => c !== child); child.parentNode = null; },
      click() { emit(listeners, 'click'); }
    };
    elements.push(el); return el;
  }
  const receipts=[],frameWindow={postMessage(d){receipts.push(d);}},frameElement={contentWindow:frameWindow,addEventListener(){}};
  const document = {
    readyState: options.loading ? 'loading' : 'complete', body: element('body'),
    createElement: element,
    getElementById(id) { if(id==='wbeEventBridge')return frameElement; if (domError) throw Error('synthetic DOM failure'); return elements.find(e => e.id === id && e.parentNode) || null; },
    addEventListener(type, fn) { listen(documentListeners, type, fn); }
  };
  const dataLayer = [];
  dataLayer.push = function (...args) {
    if (tagError && args.some(a => a[0] === 'consent' && a[1] === 'update')) throw Error('synthetic consent queue failure');
    trace.push(...args.map(a => a[0] === 'consent' ? `${a[0]}:${a[1]}` : a[0]));
    return Array.prototype.push.apply(this, args);
  };
  const localStorage = {
    getItem(key) { trace.push(`read:${key}`); if (options.readError) throw Error('synthetic storage read'); return storage.get(key) ?? null; },
    setItem(key, value) { trace.push(`write:${key}:${value}`); if (options.writeError) throw Error('synthetic storage write'); storage.set(key, value); }
  };
  const window = { dataLayer, location: { href: options.url || 'https://synthetic.invalid/' },
    addEventListener(type, fn) { listen(windowListeners, type, fn); }
  };
  // Model browser window/global identity; top-level var/functions are window APIs.
  Object.assign(window, { window, document, localStorage, crypto:require('node:crypto').webcrypto, Uint8Array, setTimeout(f){f();}, console: { log() {} } });
  const context = vm.createContext(window);
  let code = options.source || source;
  if (options.enabled) {
    assert.equal(code.split('var BANNER_ENABLED = false;').length, 2, 'unique visibility-only fixture');
    code = code.replace('var BANNER_ENABLED = false;', 'var BANNER_ENABLED = true;');
  }
  // TEST-ONLY SOURCE INSTRUMENTATION: opt in to exercise the real private
  // category transition function, not a production API or UI/receipt evidence.
  // Inject only into this VM string; never write the seam into the HTML.
  if (options.testOnlyTransitions) {
    const anchor = '  var _granted =';
    assert.equal(code.split(anchor).length, 2, 'unique test-only category instrumentation anchor');
    code = code.replace(anchor, '  window.__testOnlyGrantConsent = grantConsent;\n' + anchor);
  }
  const operational=code.includes('function opHead('), origin='https://bridge.synthetic.invalid';
 if(operational){window.location.origin='https://www.wanderlustcaribbean.com';code=replaceOnce(code,"var OPERATIONAL_BRIDGE_ORIGIN = '';","var OPERATIONAL_BRIDGE_ORIGIN = '"+origin+"';");}
 vm.runInContext(code, context);
 const native=d=>emit(windowListeners,'message',{data:d,origin,source:frameWindow});
 let tuple;
 if(operational){
  native({type:'wbe-operational-probe',version:1,producerSession:'a'.repeat(32)});
  const discovery=receipts.find(d=>d.type==='wbe-operational-discovery');assert.ok(discovery);
  tuple={producerSession:'a'.repeat(32),relayBoot:'b'.repeat(32),googleBoot:discovery.headBoot,microsoftBoot:'c'.repeat(32)};
  native({type:'wbe-operational-bind',version:1,...tuple});
  native({type:'wbe-operational-state',version:1,...tuple,revision:1,state:'OFF',discardThrough:0});
  assert.ok(receipts.some(d=>d.type==='wbe-operational-ack'&&d.phase==='state'&&d.state==='OFF'));
 }

  const testOnlyGrantConsent = window.__testOnlyGrantConsent;
  if (options.testOnlyTransitions) delete window.__testOnlyGrantConsent;
  return { context, window, trace, storage, elements, testOnlyGrantConsent,
    ready() { emit(documentListeners, 'DOMContentLoaded'); },
    event(type, event) { emit(documentListeners, type, event); },
    storageEvent(event) { emit(windowListeners, 'storage', { storageArea: localStorage, ...event }); },
    message(payload) { if(operational)native({type:'wbe-operational-business',version:1,...tuple,revision:1,channel:'google',message:{type:'wbe-datalayer-event',payload}});else emit(windowListeners, 'message', { data: { source: 'wbe-event-bridge', payload } }); },
    button(label) { const el = elements.find(e => e.tag === 'button' && e.textContent === label); assert.ok(el, `actual ${label} control exists`); return el; },
    setDomError(value) { domError = value; },
    setTagError(value) { tagError = value; },
    updates() { return dataLayer.filter(a => a[0] === 'consent' && a[1] === 'update').map(a => JSON.parse(JSON.stringify(a[2]))); },
    state() { return Object.assign({}, ...dataLayer.filter(a => a[0] === 'consent').map(a => a[2])); },
    calls() { return dataLayer.map(a => JSON.parse(JSON.stringify(Array.from(a)))); }
  };
}

function globalGrantWithdrawalWitness(code = source) {
  for (const enabled of [false, true]) for (const loading of [false, true]) {
    const h = harness({ source: code, enabled, loading });
    h.ready();
    if (enabled) {
      h.button('Accept All').click();
      assert.deepEqual(h.state(), granted, 'actual control grant setup');
    }
    const priorGlobalGrant = vm.runInContext('typeof grantConsent === "function" ? grantConsent : undefined', h.context);
    h.window.wbeWithdrawConsent();
    assert.deepEqual(h.state(), denied, 'withdrawal setup');
    if (priorGlobalGrant) priorGlobalGrant(true, true, true, true);
    assert.deepEqual(h.state(), denied, 'CAUSAL: prior global grant must not reverse withdrawal');
    for (const name of ['grantConsent', '_granted', 'acceptAll', 'denyAll', 'initBanner', 'showBanner', 'getChoice', 'setChoice', 'hideBanner', 'initialized', 'BANNER_ENABLED', 'CHOICE_KEY', '__testOnlyGrantConsent']) {
      assert.equal(vm.runInContext(`typeof ${name}`, h.context), 'undefined', `${name} is not a production global`);
      assert.equal(h.window[name], undefined, `${name} is not a window API`);
    }
    assert.equal(h.testOnlyGrantConsent, undefined, 'full-source control regression is not instrumented');
    assert.deepEqual(Object.keys(h.window).filter(key => typeof h.window[key] === 'function').sort(),
      ['Uint8Array', 'addEventListener', 'gtag', 'wbeWithdrawConsent', ...(code.includes('function opHead(')?['headRecord','headData','opId','opValid','opSame','opEnvelope','opHead']:[]), 'setTimeout'].sort(), 'no replacement public grant callback/API');
    assert.equal(h.window.wbeWithdrawConsent(true, true, true, true), undefined, 'withdrawal exposes no return capability');
    assert.deepEqual(h.state(), denied, 'withdrawal arguments cannot request grants');
    if (enabled) {
      // Retained actual callbacks, not authenticated clicks or visible settings UI.
      h.button('Accept All').click();
      assert.deepEqual(h.state(), granted, 'actual Accept still works after withdrawal');
      h.button('Deny').click();
      assert.deepEqual(h.state(), denied, 'actual Deny still works');
    }
  }
}

test('production globals cannot grant over withdrawal; actual controls still transition', () => {
  globalGrantWithdrawalWitness();
});

test('hidden banner honors stored denial without automatic grant', () => {
  const h = harness({ choice: 'denied' });
  assert.deepEqual(h.state(), denied);
  assert.ok(h.trace.includes('read:wbe_consent_choice'), 'choice consulted even while hidden');
  assert.equal(h.elements.filter(e => e.tag === 'button').length, 0);
});

test('legacy stored grant is never restored, in either visibility mode', () => {
  for (const enabled of [false, true]) assert.deepEqual(harness({ enabled, choice: 'granted' }).state(), denied);
});

test('four explicit provider signals independently transition both directions', () => {
  const h = harness({ testOnlyTransitions: true });
  for (let i = 0; i < signals.length; i++) {
    const args = signals.map((_, j) => j === i);
    h.testOnlyGrantConsent(...args);
    assert.deepEqual(h.state(), { ...denied, [signals[i]]: 'granted' });
    const count = h.updates().length;
    h.testOnlyGrantConsent(...args);
    assert.equal(h.updates().length, count, 'duplicate state is idempotent');
    h.testOnlyGrantConsent(false, false, false, false);
    assert.deepEqual(h.state(), denied);
  }
});

test('actual Accept All explicitly grants all four signals', () => {
  const h = harness({ enabled: true });
  const accept = h.button('Accept All');
  accept.click();
  assert.deepEqual(h.state(), granted);
  assert.equal(h.storage.get('wbe_consent_choice'), 'granted');
  accept.click();
  assert.equal(h.updates().length, 1);
});

test('actual Deny revokes before hiding even when persistence fails; new Accept can grant', () => {
  for (const writeError of [false, true]) {
    const h = harness({ enabled: true, writeError });
    const accept = h.button('Accept All'), deny = h.button('Deny');
    accept.click();
    // Retained callbacks exercise dormant controls; not a visible withdrawal UI claim.
    h.trace.length = 0;
    deny.click();
    assert.deepEqual(h.state(), denied);
    assert.deepEqual(h.updates().at(-1), denied);
    assert.ok(h.trace.indexOf('consent:update') < h.trace.indexOf('write:wbe_consent_choice:denied'));
    deny.click();
    assert.equal(h.updates().length, 2);
    if (!writeError) assert.equal(h.storage.get('wbe_consent_choice'), 'denied');
    accept.click();
    assert.deepEqual(h.state(), granted);
  }
  const h = harness({ testOnlyTransitions: true, enabled: true });
  h.testOnlyGrantConsent(true, true, true, true);
  h.trace.length = 0;
  h.button('Deny').click();
  assert.ok(h.trace.indexOf('consent:update') < h.trace.indexOf('hide'), 'denial before actual DOM removal');
});

test('unqualified legacy event has no consent authority in either direction', () => {
  const h = harness({ enabled: true });
  const accept = h.button('Accept All'), deny = h.button('Deny');
  accept.click();
  h.event('wbeConsentGranted', { detail: { analytics: true, advertising: true }, isTrusted: true });
  assert.deepEqual(h.state(), granted, 'unqualified event must not change explicit choice');
  deny.click();
  h.event('wbeConsentGranted', { detail: { consent: 'granted' } });
  assert.deepEqual(h.state(), denied);
});

test('same-page withdrawal is immediate while hidden, including loading/storage errors', () => {
  for (const loading of [false, true]) for (const writeError of [false, true]) {
    const h = harness({ testOnlyTransitions: true, loading, writeError });
    assert.equal(typeof h.window.wbeWithdrawConsent, 'function');
    h.testOnlyGrantConsent(true, true, true, true);
    h.window.wbeWithdrawConsent();
    assert.deepEqual(h.state(), denied);
    h.window.wbeWithdrawConsent();
    assert.equal(h.updates().length, 2);
    h.event('wbeConsentGranted');
    h.ready();
    assert.deepEqual(h.state(), denied);
  }
});

test('cross-tab denied, clear, malformed or unverified grant suppress immediately without echo writes', () => {
  for (const enabled of [false, true]) for (const loading of [false, true]) {
    for (const [key, newValue] of [['wbe_consent_choice', 'denied'], [null, null], ['wbe_consent_choice', null], ['wbe_consent_choice', '{bad'], ['wbe_consent_choice', 'granted']]) {
      const h = harness({ testOnlyTransitions: true, enabled, loading });
      h.testOnlyGrantConsent(true, true, true, true);
      h.trace.length = 0;
      h.storageEvent({ key, newValue });
      assert.deepEqual(h.state(), denied);
      assert.ok(!h.trace.some(t => t.startsWith('write:')), 'no cross-tab write loop');
      h.storageEvent({ key, newValue });
      h.storageEvent({ key: 'wbe_consent_choice', newValue: 'granted' });
      assert.equal(h.updates().length, 2);
    }
  }
  const h = harness({ testOnlyTransitions: true });
  h.testOnlyGrantConsent(true, true, true, true);
  h.storageEvent({ key: 'unrelated', newValue: null });
  h.storageEvent({ key: 'wbe_consent_choice', newValue: 'denied', storageArea: {} });
  assert.deepEqual(h.state(), granted, 'unrelated key/storage area ignored');
});

test('DOM failures do not escape consent initialization or withdrawal into booking events', () => {
  for (const loading of [false, true]) {
    const h = harness({ testOnlyTransitions: true, enabled: true, loading, domError: true });
    h.ready();
    h.testOnlyGrantConsent(true, true, true, true);
    h.window.wbeWithdrawConsent();
    assert.deepEqual(h.state(), denied);
    h.message({ event: 'begin_booking', value: 123, currency: 'USD' });
    assert.equal(h.calls().filter(a=>a[0]==='event').length,0,'withdrawal suppresses business independently of consent-purpose state');
  }
  const h = harness({ testOnlyTransitions: true, enabled: true });
  h.testOnlyGrantConsent(true, true, true, true);
  h.setDomError(true);
  h.button('Deny').click();
  assert.deepEqual(h.state(), denied);
});

test('stored denial at deferred initialization revokes any earlier local signals', () => {
  const h = harness({ testOnlyTransitions: true, enabled: true, loading: true, choice: 'denied' });
  h.testOnlyGrantConsent(true, true, true, true);
  h.ready();
  assert.deepEqual(h.state(), denied);
});

test('repeated DOM readiness does not reopen controls or override a local choice', () => {
  for (const writeError of [false, true]) {
    const h = harness({ enabled: true, loading: true, writeError });
    h.ready(); h.ready();
    assert.equal(h.elements.filter(e => e.tag === 'button').length, 2);
    h.button('Accept All').click();
    h.ready();
    assert.deepEqual(h.state(), granted);
    assert.equal(h.elements.filter(e => e.tag === 'button').length, 2);
    h.window.wbeWithdrawConsent(); h.ready();
    assert.deepEqual(h.state(), denied);
    assert.equal(h.elements.filter(e => e.tag === 'button').length, 2);
  }
});

test('consent queue errors cannot interrupt withdrawal storage or booking; next call retries', () => {
  const h = harness({ enabled: true });
  h.button('Accept All').click();
  h.setTagError(true);
  h.window.wbeWithdrawConsent();
  assert.equal(h.storage.get('wbe_consent_choice'), 'denied');
  h.message({ event: 'begin_booking', nights: 3 });
  assert.equal(h.calls().filter(a=>a[0]==='event').length,0,'withdrawal still suppresses business after consent queue error');
  h.setTagError(false);
  h.window.wbeWithdrawConsent();
  assert.deepEqual(h.state(), denied, 'failed queue update not cached as delivered');
});

test('storage matrix stays denied before configs and events in both DOM/visibility modes', () => {
  for (const enabled of [false, true]) for (const loading of [false, true]) {
    for (const choice of [undefined, 'denied', 'granted', '', '{bad', 'true', 'DENIED']) {
      for (const readError of [false, true]) {
        const h = harness({ enabled, loading, choice, readError });
        h.ready(); h.ready();
        assert.deepEqual(h.state(), denied);
        assert.ok(h.trace.includes('read:wbe_consent_choice'));
        const calls = h.calls();
        const defaultIndex = calls.findIndex(a => a[0] === 'consent' && a[1] === 'default');
        assert.deepEqual(calls[defaultIndex][2], denied);
        assert.ok(calls.filter(a => a[0] === 'config').length === 2);
        assert.ok(calls.every((a, i) => a[0] !== 'config' || i > defaultIndex));
        h.message({ event: 'begin_booking', currency: 'USD', value: 42 });
        if(choice==='denied'||readError)assert.equal(h.calls().filter(a=>a[0]==='event').length,0);
        else assert.deepEqual(h.calls().at(-1), ['event', 'begin_booking', { currency: 'USD', value: 42 }]);
        assert.deepEqual(h.state(), denied);
      }
    }
  }
});

test('no argument or non-primitive permission can grant; all category combinations remain independent', () => {
  const h = harness({ testOnlyTransitions: true });
  for (const value of [undefined, null, false, 1, 'true', {}, new Boolean(true)]) {
    h.testOnlyGrantConsent(value, value, value, value);
    assert.deepEqual(h.state(), denied);
  }
  h.testOnlyGrantConsent(true, true, true, true);
  h.testOnlyGrantConsent();
  assert.deepEqual(h.state(), denied);
  const choices = Array.from({ length: 16 }, (_, mask) => signals.map((_, i) => Boolean(mask & (1 << i))));
  for (const before of choices) for (const after of choices) {
    h.testOnlyGrantConsent(...before);
    const count = h.updates().length;
    h.testOnlyGrantConsent(...after);
    assert.deepEqual(h.state(), Object.fromEntries(signals.map((key, i) => [key, after[i] ? 'granted' : 'denied'])));
    assert.equal(h.updates().length, count + (before.some((v, i) => v !== after[i]) ? 1 : 0));
    h.testOnlyGrantConsent(...after);
    assert.equal(h.updates().length, count + (before.some((v, i) => v !== after[i]) ? 1 : 0));
  }
});

test('click IDs and untrusted NOT_REQUIRED claims never automatically grant', () => {
  const url = 'https://synthetic.invalid/?gclid=public-g&gbraid=public-b&wbraid=public-w&msclkid=public-m';
  const h = harness({ url });
  const record = JSON.parse(h.storage.get('wl_click_attribution'));
  assert.deepEqual([record.gclid, record.gbraid, record.wbraid, record.msclkid, record.landingUrl], ['public-g', 'public-b', 'public-w', 'public-m', url]);
  assert.ok(Number.isFinite(Date.parse(record.capturedAt)));
  h.event('wbeConsentGranted', { detail: { status: 'NOT_REQUIRED', consentRequired: false } });
  h.message({ status: 'NOT_REQUIRED', consentRequired: false });
  h.storageEvent({ key: 'wbe_consent_choice', newValue: 'NOT_REQUIRED' });
  assert.deepEqual(h.state(), denied);
  // This tests absence of authority from browser claims, not an integrated server policy.
});

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const baseline = 'f46501a85fb7dfb58712dbb385e7409aed6296e3';
const oldHtml = execFileSync('git', ['show', `${baseline}:velo/custom-code/google-tag-and-consent.html`], { cwd: root, encoding: 'utf8' });
const oldSource = [...oldHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].find(m => !/\bsrc=/.test(m[1]))[2];
const hash = text => createHash('sha256').update(text).digest('hex');
function segment(text, start, end) {
  assert.equal(text.split(start).length, 2, `unique start: ${start}`);
  assert.equal(text.split(end).length, 2, `unique end: ${end}`);
  return text.slice(text.indexOf(start), text.indexOf(end));
}
function replaceOnce(text, target, replacement) {
  assert.equal(text.split(target).length, 2, 'unique causal mutation target');
  return text.replace(target, replacement);
}
function causal(name, mutant, witness) {
  test(`causal reversal: ${name}`, () => {
    new vm.Script(mutant); // Syntax errors are not kills.
    witness(source);
    let failure;
    try { witness(mutant); } catch (error) { failure = error; }
    assert.ok(failure instanceof assert.AssertionError, 'mutant must fail an assertion, not crash');
    assert.ok(failure.message.includes('CAUSAL:'), 'only named final behavior assertion counts');
    console.log(`KILLED | ${name} | source-sha256=${hash(mutant)} | ${failure.message.split('\n')[0]}`);
  });
}
causal('historical hidden stored denial', oldSource, code => {
  const h = harness({ source: code, choice: 'denied' });
  assert.deepEqual(h.state(), denied, 'CAUSAL: hidden stored denial must stay denied');
});
causal('historical hidden no-choice auto grant', oldSource, code => {
  assert.deepEqual(harness({ source: code }).state(), denied, 'CAUSAL: hidden no-choice must stay denied');
});
causal('historical actual Accept then Deny', oldSource, code => {
  const h = harness({ source: code, enabled: true });
  h.button('Accept All').click();
  assert.deepEqual(h.state(), granted, 'grant setup must succeed');
  h.button('Deny').click();
  assert.deepEqual(h.state(), denied, 'CAUSAL: actual Deny must revoke all signals');
});
causal('historical unqualified event after stored denial', oldSource, code => {
  const h = harness({ source: code, enabled: true, choice: 'denied' });
  assert.deepEqual(h.state(), denied, 'denied setup must succeed');
  h.event('wbeConsentGranted');
  assert.deepEqual(h.state(), denied, 'CAUSAL: event name must not override denial');
});
// Remove precisely the reviewed B06 denial addition only for historical input.
// Current-source behavior and every causal witness continue to use source.
const reviewedDenialAddition = `
    // FAIL CLOSED until the actual Wix sandbox origin and exact iframe DOM
    // identity are independently verified and activation is approved. Empty is
    // intentionally disabled, not a wildcard. Fixture configuration is not live proof.
    var DENIAL_BRIDGE_ORIGIN = '';
    window.addEventListener('message', function (event) {
      try {
        var d = event && event.data;
        if (!DENIAL_BRIDGE_ORIGIN || window.location.origin !== 'https://www.wanderlustcaribbean.com' ||
            event.origin !== DENIAL_BRIDGE_ORIGIN || !d || typeof d !== 'object' || Array.isArray(d) ||
            d.type !== 'wbe-consent-deny' || d.version !== 1 || Object.keys(d).length !== 2 ||
            !Object.prototype.hasOwnProperty.call(d, 'type') || !Object.prototype.hasOwnProperty.call(d, 'version')) return;
        var bridge = document.getElementById('wbeEventBridge');
        if (!bridge || !bridge.contentWindow || event.source !== bridge.contentWindow) return;
        denyAll();
      } catch (_) { /* Unknown topology/malformed transport cannot grant. */ }
    });
`;
// Exact additive negative publisher subtraction for historical inputs only.
const publisherAddition = `  // Negative-only same-page seam; not consent, identity or purchase authority.
  function publishAdvertisingWithdrawal() {
    window.wbeAdvertisingWithdrawn = true;
    try { document.dispatchEvent(new Event('wbeAdvertisingWithdrawn')); } catch (_) {}
  }
`;
function beforePublisher(text) {
  text = replaceOnce(text, publisherAddition, '');
  assert.equal((text.match(/^[ ]+publishAdvertisingWithdrawal\(\);\n/gm) || []).length, 3);
  return text.replace(/^[ ]+publishAdvertisingWithdrawal\(\);\n/gm, '');
}
// Exact reviewed P2 tail only; historical hashes below remain immutable.
const p2Tail = source.slice(source.indexOf('  // Receive GA4/Ads events'));
// Remove only the exact successor catch for the existing historical reconstruction.
const beforeSuccessorP2Tail = replaceOnce(p2Tail,
  'try{item.receive(replay);}catch(_){\n        // Delivery is uncertain: never retry this item; recheck fences for its successor.\n      }finally{replay=null;}',
  'try{item.receive(replay);}finally{replay=null;}');
// Subtract only the exact ACK-uncertainty addition; do not repin historical source.
const priorP2Tail=replaceOnce(replaceOnce(replaceOnce(beforeSuccessorP2Tail,"function opHead(receiver,origin,clear,resume) {\n  var boot=opId(), tuple=null, frame=null, source=null, fault=false, state='UNRESOLVED', revision=0, watermark=0, acknowledged=false;\n  var generation=(window['__wbeOpGeneration_'+receiver]||0)+1;window['__wbeOpGeneration_'+receiver]=generation;\n  function live(){if(window['__wbeOpGeneration_'+receiver]!==generation)fault=true;if(frame&&(document.getElementById('wbeEventBridge')!==frame||frame.contentWindow!==source))fault=true;return !fault;}\n  function trusted(e){var f=document.getElementById('wbeEventBridge');return origin&&window.location.origin==='https://www.wanderlustcaribbean.com'&&f&&e.origin===origin&&e.source===f.contentWindow;}\n  function send(d){source.postMessage(d,origin);}\n  var pending=[], retry=null, attempts=0, ackSerial=0, draining=false, negative=false, replay=null;\n  function cancelRetry(){if(retry!==null)clearTimeout(retry);retry=null;}\n  document.addEventListener('wbeAdvertisingWithdrawn',function(){negative=true;pending=[];cancelRetry();});\n  function drain(){\n    if(draining)return;draining=true;\n    try{while(allowed()&&pending.length){\n      // Remove before calling provider code: an emitted business event is never retried.\n      var item=pending.shift();\n      replay={data:Object.assign({},item.data,{revision:revision}),source:source,origin:origin};\n      try{item.receive(replay);}finally{replay=null;}\n    }}finally{draining=false;}\n    if(allowed())resume();\n  }\n  function ack(phase){\n    var serial=phase==='state'?++ackSerial:ackSerial, rev=revision;\n    if(phase==='state'){acknowledged=false;cancelRetry();attempts++;}\n    var sent=false;\n    try{send(opEnvelope('ack',tuple,{receiver:receiver,phase:phase,revision:phase==='bound'?0:rev,state:phase==='bound'?'UNRESOLVED':state,discardThrough:phase==='bound'?0:watermark}));sent=true;}catch(_){}\n    if(phase!=='state'||serial!==ackSerial||rev!==revision||!live()||negative)return;\n    acknowledged=sent;\n    if(sent)setTimeout(function(){if(serial===ackSerial&&allowed())drain();},0);\n    else if(attempts<5)retry=setTimeout(function(){retry=null;if(serial===ackSerial&&rev===revision&&live()&&!negative)ack('state');},200);\n  }\n  function allowed(){return !negative&&live()&&tuple&&acknowledged&&state==='OFF'&&revision>0;}\n  window.addEventListener('message',function(e){\n    if(!trusted(e)||!opValid(e.data)||!live()||!boot)return;var x=e.data;\n    if(x.type==='wbe-operational-probe'){e.source.postMessage(opEnvelope('discovery',null,{producerSession:x.producerSession,receiver:receiver,headBoot:boot}),origin);return;}\n    if(x.type==='wbe-operational-bind'){\n      if(x[receiver+'Boot']!==boot)return;\n      if(tuple){if(!opSame(tuple,x)){fault=true;return;}ack('bound');return;}\n      tuple={};opTupleKeys.forEach(function(k){tuple[k]=x[k];});frame=document.getElementById('wbeEventBridge');source=frame.contentWindow;\n      frame.addEventListener('load',function(){fault=true;acknowledged=false;});ack('bound');return;\n    }\n    if(x.type!=='wbe-operational-state'||!opSame(tuple,x))return;\n    if(x.revision<revision||x.discardThrough<watermark)return;\n    if(x.revision===revision&&(x.state!==state||x.discardThrough!==watermark)){fault=true;acknowledged=false;return;}\n    var changed=x.revision!==revision;state=x.state;revision=x.revision;watermark=x.discardThrough;\n    if(changed){acknowledged=false;cancelRetry();attempts=0;pending=pending.filter(function(item){return item.data.revision>watermark;});if(state==='ON')pending=[];clear(state,watermark);}ack('state');\n  });\n  return {allowed:allowed,revision:function(){return revision;},business:function(e,channel,receive){\n    var x=e&&e.data;\n    if(!trusted(e)||!opValid(x)||x.type!=='wbe-operational-business'||x.channel!==channel||!opSame(tuple,x)||x.revision!==revision||!live()||negative||state!=='OFF')return null;\n    if(!acknowledged || (e!==replay&&(pending.length||draining))){\n      // Retain only never-dispatched own-data work while ACK delivery is uncertain.\n      try{pending.push({data:headData(x,[]),receive:receive});}catch(_){}\n      return null;\n    }\n    return x.message;\n  }};\n}","function opHead(receiver,origin,clear,resume) {\n  var boot=opId(), tuple=null, frame=null, source=null, fault=false, state='UNRESOLVED', revision=0, watermark=0, acknowledged=false;\n  var generation=(window['__wbeOpGeneration_'+receiver]||0)+1;window['__wbeOpGeneration_'+receiver]=generation;\n  function live(){if(window['__wbeOpGeneration_'+receiver]!==generation)fault=true;if(frame&&(document.getElementById('wbeEventBridge')!==frame||frame.contentWindow!==source))fault=true;return !fault;}\n  function trusted(e){var f=document.getElementById('wbeEventBridge');return origin&&window.location.origin==='https://www.wanderlustcaribbean.com'&&f&&e.origin===origin&&e.source===f.contentWindow;}\n  function send(d){source.postMessage(d,origin);}\n  function ack(phase){if(phase==='state')acknowledged=false;try{send(opEnvelope('ack',tuple,{receiver:receiver,phase:phase,revision:phase==='bound'?0:revision,state:phase==='bound'?'UNRESOLVED':state,discardThrough:phase==='bound'?0:watermark}));if(phase==='state')acknowledged=true;}catch(_){}if(phase==='state'&&acknowledged)setTimeout(function(){if(allowed())resume();},0);}\n  function allowed(){return live()&&tuple&&acknowledged&&state==='OFF'&&revision>0;}\n  window.addEventListener('message',function(e){\n    if(!trusted(e)||!opValid(e.data)||!live()||!boot)return;var x=e.data;\n    if(x.type==='wbe-operational-probe'){e.source.postMessage(opEnvelope('discovery',null,{producerSession:x.producerSession,receiver:receiver,headBoot:boot}),origin);return;}\n    if(x.type==='wbe-operational-bind'){\n      if(x[receiver+'Boot']!==boot)return;\n      if(tuple){if(!opSame(tuple,x)){fault=true;return;}ack('bound');return;}\n      tuple={};opTupleKeys.forEach(function(k){tuple[k]=x[k];});frame=document.getElementById('wbeEventBridge');source=frame.contentWindow;\n      frame.addEventListener('load',function(){fault=true;acknowledged=false;});ack('bound');return;\n    }\n    if(x.type!=='wbe-operational-state'||!opSame(tuple,x))return;\n    if(x.revision<revision||x.discardThrough<watermark)return;\n    if(x.revision===revision&&(x.state!==state||x.discardThrough!==watermark)){fault=true;acknowledged=false;return;}\n    var changed=x.revision!==revision;state=x.state;revision=x.revision;watermark=x.discardThrough;\n    if(changed)clear(state,watermark);ack('state');\n  });\n  return {allowed:allowed,revision:function(){return revision;},business:function(e,channel){var x=e&&e.data;return trusted(e)&&opValid(x)&&x.type==='wbe-operational-business'&&x.channel===channel&&opSame(tuple,x)&&x.revision===revision&&allowed()?x.message:null;}};\n}"),'function receiveGoogle(event)', 'function (event)'),"googleOp.business(event,'google',receiveGoogle)","googleOp.business(event,'google')");
assert.equal(hash(priorP2Tail), '6a504b5d4194e8095acaf82f61c4e9ee7774bf120662c88269b6730a21151991', 'reviewed P2 tail bytes');
const preP2Html = execFileSync('git',['show','875f1800704b7309daa45a6074abfdd78e0ba0b7:velo/custom-code/google-tag-and-consent.html'],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n');
const preP2Source = [...preP2Html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].find(m=>!/\bsrc=/.test(m[1]))[2];
const historicalSource = replaceOnce(source,p2Tail,preP2Source.slice(preP2Source.indexOf('  // Receive GA4/Ads events')));
assert.equal(historicalSource,preP2Source,'only exact P2 addition removed');
const beforeIngress = replaceOnce(beforePublisher(historicalSource), reviewedDenialAddition, '');
const ingressBaselineHtml = execFileSync('git', ['show',
  '0a3f8914909e27d5e892c4354d2298b408543fd2:velo/custom-code/google-tag-and-consent.html'],
  { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
const ingressBaselineSource = [...ingressBaselineHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .find(m => !/\bsrc=/.test(m[1]))[2];
assert.equal(beforeIngress, ingressBaselineSource, 'unique B06 removal restores exact baseline LF inline source');
// Exact pre-correction reconstruction preserves the original historical hash.
// Keep this anchor compatible with the existing isolated B scaffold, which also
// strips this same branch. Uniqueness is asserted against current source above.
const globalGrantReversal = replaceOnce(replaceOnce(historicalSource,
  '  // Private transitions and control callbacks are API hygiene, not same-realm\n' +
  '  // isolation: page scripts can still manipulate the DOM or dataLayer.\n' +
  '  (function () {\n', ''),
  '  // The loading architecture is unchanged: denied mode can still send pings.\n',
  '  // The loading architecture is unchanged: denied mode can still send pings.\n  (function () {\n').replace(reviewedDenialAddition, '');
const historicalGlobalGrantReversal = beforePublisher(globalGrantReversal);
assert.equal(hash(historicalGlobalGrantReversal), 'bfad2df268d89fc8da2a962f2e3691e1d1bb7db06fb9ba005d5cae085eb7fe0f',
  'exact LF pre-correction source, not a fabricated replacement function');
causal('exact pre-correction global grant exposure', historicalGlobalGrantReversal, globalGrantWithdrawalWitness);

const oldCategories = segment(oldSource, '  var _granted =', '  // Path 1:');
const categoryReversal = replaceOnce(source, segment(source, '  var _granted =', '  // Unqualified'), oldCategories);
causal('exact old category latch reversal', categoryReversal, code => {
  const h = harness({ testOnlyTransitions: true, source: code });
  h.testOnlyGrantConsent(true, false, false, false);
  assert.deepEqual(h.state(), { ...denied, analytics_storage: 'granted' }, 'analytics setup must succeed');
  h.testOnlyGrantConsent(false, false, false, false);
  assert.deepEqual(h.state(), denied, 'CAUSAL: analytics true to false must revoke');
});
causal('exact old advertising purpose conflation', categoryReversal, code => {
  const h = harness({ testOnlyTransitions: true, source: code });
  h.testOnlyGrantConsent(false, true, false, false);
  assert.deepEqual(h.state(), { ...denied, ad_storage: 'granted' }, 'CAUSAL: ad storage alone cannot grant transfer or personalization');
});
const withdrawalReversal = replaceOnce(source,
  "    function denyAll() {\n      publishAdvertisingWithdrawal();\n      grantConsent(false, false, false, false);",
  '    function denyAll() {\n      publishAdvertisingWithdrawal();');
causal('withdrawal denial deletion', withdrawalReversal, code => {
  const h = harness({ testOnlyTransitions: true, source: code });
  h.testOnlyGrantConsent(true, true, true, true);
  assert.deepEqual(h.state(), granted, 'grant setup must succeed');
  h.window.wbeWithdrawConsent();
  assert.equal(h.storage.get('wbe_consent_choice'), 'denied', 'persistence is not revocation');
  assert.deepEqual(h.state(), denied, 'CAUSAL: exposed withdrawal must revoke signals');
});

test('unchanged loading IDs click capture appearance and actual event transport versus baseline', () => {
  assert.equal(html.slice(0, html.indexOf('  // Local provider signals')), oldHtml.slice(0, oldHtml.indexOf('  // Grant consent per-category')));
  assert.equal(segment(source, '    function showBanner()', '    var initialized'), segment(oldSource, '    function showBanner()', '    function initBanner()'));
  assert.equal(historicalSource.slice(historicalSource.indexOf('  // Receive GA4/Ads events')).trimEnd(), oldSource.slice(oldSource.indexOf('  // Receive GA4/Ads events')).trimEnd());
  for (const event of ['begin_booking', 'purchase', 'synthetic_custom']) {
    const payload = { event, value: 42, currency: 'USD', transaction_id: 'public-fixture', items: [{ item_id: 'fixture', quantity: 1 }] };
    const current = harness(), old = harness({ source: oldSource });
    current.message(payload); old.message(payload);
    assert.deepEqual(current.calls().at(-1), old.calls().at(-1));
    assert.deepEqual(current.calls().at(-1), ['event', event, { value: 42, currency: 'USD', transaction_id: 'public-fixture', items: [{ item_id: 'fixture', quantity: 1 }] }]);
  }
});

test('historical withdrawal business retained only as pinned history; current explicit OFF negative gate',()=>{
 for(const options of [{},{choice:'denied'},{readError:true}]){
  const current=harness(options),historical=harness({...options,source:preP2Source});
  if(!options.choice&&!options.readError){current.message({event:'purchase',transaction_id:'eligible',value:0,currency:'EUR'});assert.deepEqual(current.calls().at(-1),['event','purchase',{transaction_id:'eligible',value:0,currency:'EUR'}]);}
  current.window.wbeWithdrawConsent();historical.window.wbeWithdrawConsent();
  const before=current.calls().filter(a=>a[0]==='event');
  current.message({event:'begin_booking',nights:3});historical.message({event:'begin_booking',nights:3});
  assert.deepEqual(current.calls().filter(a=>a[0]==='event'),before);
  assert.deepEqual(historical.calls().at(-1),['event','begin_booking',{nights:3}]);
  assert.deepEqual(current.state(),denied);assert.deepEqual(historical.state(),denied);
 }
});
let failed = 0;
for (const { name, run } of tests) {
  try { run(); console.log(`PASS | ${name}`); }
  catch (error) { failed++; console.error(`FAIL | ${name}\n${error.stack}`); }
}
console.log(`${tests.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
