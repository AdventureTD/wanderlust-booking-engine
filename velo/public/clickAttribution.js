/* global globalThis:readonly */
// ESLint global declaration only; optional runtime Web Crypto is checked below.
// Dedicated attribution channel; never carries contacts or generic events.
import { local } from 'wix-storage-frontend';
import { normalizePaidTouches } from 'public/paidTouchState';
import { getAdsFormRequirement } from 'backend/adsFormRequirement.web';
import { localBudget, remainingBudget, closeBudget, freshPolicyNonce, policyRequest, validPolicy, withinBudget, monotonicNow } from 'public/adsPolicyProtocol';
const KEY = 'wl_click_attribution', CLEAR = 'wl_click_attribution_clear_pending';
const REVOKED = 'wl_click_attribution_revoked';
// Storage carries data, never a grant. Undefined admits startup reconciliation
// only; null is an explicit empty admission. Only a bound Head confirm sets bytes.
let admittedRaw;
// Revocation marker is read lazily at first browser use, never at module evaluation
// (no SDK storage call in the SSR import closure). Throwing storage stays closed.
let partitionClosed;
function closedPartition() {
  if (partitionClosed === undefined) { try { partitionClosed = !!local.getItem(REVOKED); } catch (_) { partitionClosed = true; } }
  return partitionClosed;
}
export function attributionStorageAdmitted(raw) { return admittedRaw !== undefined && raw === admittedRaw; }
function closePartition() {
  partitionClosed = true; admittedRaw = null;
  try { local.setItem(REVOKED, '1'); } catch (_) {}
}
let component, sequence = 0, revision = 0, suspended = false, pending = null;
let denied = true, nonce = '', channel = '';
// Privacy-only binding: a per-copy nonce bound once at listener install,
// independent of flags/readiness. It can only receive a Head revoke; it never
// opens a channel, reads, admits or carries consent/grant information.
let privacyNonce = '', privacyCopy = '', privacySequence = 0;
function bindPrivacy(c) {
  // Rotate the nonce on every bind; revokes addressed to an older nonce are stale
  // by FIFO construction (the Head re-checks denial when it processes this bind).
  if (!privacyCopy) privacyCopy = freshPolicyNonce();
  privacyNonce = freshPolicyNonce();
  if (privacyCopy && privacyNonce) try { c.postMessage({ type: 'wbe-click-attribution', v: 2, schema: 1, op: 'bind', sequence: ++privacySequence, nonce: privacyNonce, channel: privacyCopy, policy: null, record: null }); } catch (_) {}
}
let lateOpen = null;
// Diagnostic v1: finite, value-free, once per stage/reason per worker lifetime.
// Observation only: no permission, storage, timers or transport are added.
const diagnosticSeen = new Set();
function diagnostic(stage, reason) {
  if (!['policy', 'open', 'read', 'confirm', 'clear', 'worker'].includes(stage) ||
      !['TIMEOUT', 'REJECTED', 'TRANSPORT_ERROR', 'CRYPTO_UNAVAILABLE', 'READY_EMPTY', 'READY_RECORD', 'UNBOUND'].includes(reason)) return;
  const key = stage + ':' + reason;
  if (diagnosticSeen.has(key) || diagnosticSeen.size >= 32) return;
  diagnosticSeen.add(key);
  try { console.log('ATTR_DIAG ' + JSON.stringify({ event: 'ATTR_DIAG', v: 1, stage, reason })); } catch (_) { /* Diagnostic logging must not interrupt attribution. */ }
}
function cancelReadiness() {
  if (lateOpen) clearTimeout(lateOpen.timer);
  lateOpen = null;
}
// A timed-out open is transport uncertainty, never a consent choice. Its
// authenticated late reply may wake a NEW handshake, but cannot grant access.
function armReadiness(p, task) {
  if (!task || task.remaining <= 0 || !remainingBudget(task) ||
      p.revision !== revision || p.nonce !== nonce || suspended) return;
  cancelReadiness();
  const watch = { nonce, sequence: p.sequence, revision, task, timer: null };
  watch.timer = setTimeout(() => { if (lateOpen === watch) cancelReadiness(); }, remainingBudget(task));
  lateOpen = watch;
}
function wakeReadiness(d) {
  const watch = lateOpen;
  if (!watch || watch.revision !== revision || suspended || !remainingBudget(watch.task) ||
      !d || d.type !== 'wbe-click-attribution-result' || d.v !== 2 || d.schema !== 1 ||
      Object.keys(d).sort().join(',') !== 'allowed,channel,nonce,op,record,schema,sequence,type,v' ||
      d.nonce !== watch.nonce || d.sequence !== watch.sequence || d.op !== 'open' ||
      !/^[a-f0-9]{32}$/.test(d.channel) || d.record !== null || typeof d.allowed !== 'boolean') return;
  cancelReadiness();
  // A late negative open is the Head's non-destructive UNBOUND refusal (O3): no erase, no consent change.
  if (!d.allowed) { denied = true; return; }
  watch.task.remaining--;
  void waitAttribution(watch.task);
}

function revoke() {
  cancelReadiness();
  revision++; denied = true; channel = ''; closePartition(); erase();
  try { local.removeItem(CLEAR); } catch (_) {}
  if (pending) pending.finish(null);
}
function erase() { try { local.removeItem(KEY); } catch (_) {} }
export function attributionDenied() { return denied || suspended; }
// Local observation fence, not an atomic claim about the page partition.
export function attributionRevision() { return revision; }
// IO-free fence for a clear issued while denied/unadmitted: cancels pending readiness
// and invalidates in-flight responses. Never opens a channel, writes storage or grants.
export function fenceAttribution() { cancelReadiness(); revision++; }
export function suspendAttribution(value) {
  cancelReadiness();
  suspended = !!value; revision++;
  if (suspended) {
    // Clear the currently bound page copy before revoke retires the channel.
    // Never open a new channel to perform a suspended cleanup.
    const record = storedRecord();
    if (channel && record) void request('clear', null, record);
    revoke();
  }
}
export function initClickAttribution(w) {
  closedPartition(); // first browser entry: latch the start-of-use revocation state
  if (component) return;
  try {
    const c = w('#wbeEventBridge');
    if (!c || typeof c.onMessage !== 'function' || typeof c.postMessage !== 'function') return;
    c.onMessage(event => {
      const d = event && event.data;
      if (d && d.type === 'wbe-click-revoke' && d.v === 2 && d.schema === 1 &&
          Object.keys(d).sort().join(',') === 'channel,nonce,schema,type,v' &&
          ((d.nonce === nonce && (!channel || d.channel === channel)) ||
           (privacyNonce !== '' && d.nonce === privacyNonce && d.channel === privacyCopy))) { revoke(); return; }
      if (!pending) { wakeReadiness(d); return; }
      if (!pending || !d || d.type !== 'wbe-click-attribution-result' || d.v !== 2 || d.schema !== 1 ||
          Object.keys(d).sort().join(',') !== 'allowed,channel,nonce,op,record,schema,sequence,type,v' ||
          d.nonce !== nonce || !/^[a-f0-9]{32}$/.test(d.channel) ||
          (pending.op !== 'open' && d.channel !== channel) ||
          d.sequence !== pending.sequence || d.op !== pending.op || typeof d.allowed !== 'boolean') return;
      if (!d.allowed) diagnostic(pending.op, 'REJECTED');
      // Detach synchronously before promise continuation; caller cannot mutate
      // a nested record after envelope validation.
      const record = d.record === null ? null : (validRecord(d.record) ? normalizePaidTouches(d.record, Date.now()) : undefined);
      if (record === undefined || (!d.allowed && record !== null)) { pending.finish(null); return; }
      pending.finish({ ...d, record });
    });
    component = c; // Listener is installed before the first request.
    bindPrivacy(c);
  } catch (_) {}
}
function request(op, policy, record, task) {
  if (!component) return Promise.resolve(null);
  if (pending) pending.finish(null);
  return new Promise(resolve => {
    const p = { sequence: ++sequence, op, revision, nonce, finish: null };
    const timer = setTimeout(() => {
      if (pending === p && op === 'open') armReadiness(p, task);
      if (pending === p) diagnostic(op, 'TIMEOUT');
      p.finish(null);
    }, 500);
    p.finish = value => { if (pending !== p) return; pending = null; clearTimeout(timer); resolve(value); };
    pending = p;
    try {
      if (task && !remainingBudget(task)) { p.finish(null); return; }
      // O3: open carries the copy id and the CURRENT privacy nonce, proving the binding to the Head.
      component.postMessage({ type: 'wbe-click-attribution', v: 2, schema: 1, op, sequence: p.sequence, nonce, channel: op === 'open' ? privacyCopy : channel, policy, record });
    }
    catch (_) { diagnostic(op, 'TRANSPORT_ERROR'); p.finish(null); }
  });
}
async function openChannel(task) {
  const own = revision;
  channel = ''; sequence = 0;
  if (component) bindPrivacy(component); // new readiness epoch: older privacy revokes become stale
  nonce = privacyNonce; // O3 coupling: the open nonce IS the freshly bound privacy nonce
  // Cannot establish a binding (no usable crypto): missing verification, NOT withdrawal -> non-destructive hold.
  if (!nonce || !privacyCopy) { diagnostic('open', 'CRYPTO_UNAVAILABLE'); return 'nocrypto'; }
  const opened = await request('open', null, null, task);
  if (own !== revision || suspended || !opened) return false;
  // allowed:false on open = UNBOUND (no current privacy binding): non-destructive hold.
  if (!opened.allowed) { diagnostic('open', 'UNBOUND'); return 'unbound'; }
  channel = opened.channel;
  return true;
}
function validRecord(record) {
  if (!record || typeof record !== 'object') return false;
  const version = Object.getOwnPropertyDescriptor(record, 'v');
  if (!version || version.value !== 1) return false;
  for (const key of ['first', 'latest']) {
    const field = Object.getOwnPropertyDescriptor(record, key);
    if (!field || !('value' in field)) return false;
    if (key === 'first' && field.value === null) continue;
    if (!field.value || Object.keys(field.value).sort().join(',') !== 'capturedAt,gbraid,gclid,msclkid,wbraid') return false;
  }
  return !!normalizePaidTouches(record, Date.now());
}
function storedRecord() {
  // Latch the start-of-use revocation state BEFORE any KEY IO: a failed KEY read can
  // never leave the latch unset (a REVOKED read failure latches closed for this realm).
  const closed = closedPartition();
  try {
    const raw = local.getItem(KEY);
    if ((closed || admittedRaw !== undefined) && raw !== admittedRaw) return null;
    return normalizePaidTouches(JSON.parse(raw), Date.now());
  }
  catch (_) { return null; }
}
function sameRecord(a, b) {
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}
export async function clearPageAttribution(snapshot) {
  cancelReadiness();
  revision++;
  let record = snapshot ? normalizePaidTouches(snapshot.paidTouches || snapshot, Date.now()) : storedRecord();
  try { if (!record) record = JSON.parse(local.getItem(CLEAR)); } catch (_) {}
  if (!validRecord(record)) return;
  if (sameRecord(storedRecord(), record)) { closePartition(); erase(); }
  const written = JSON.stringify(record);
  try { local.setItem(CLEAR, written); } catch (_) {}
  if (!channel && await openChannel() !== true) return;
  const result = await request('clear', null, record);
  // An acknowledged clear retires only the copy it wrote, never a newer one.
  if (result && result.allowed && result.record === null) { try { if (local.getItem(CLEAR) === written) local.removeItem(CLEAR); } catch (_) {} }
}
export async function waitForClickAttribution() {
  return waitAttribution(Object.assign(localBudget(10000), { remaining: 2 }));
}
async function waitAttribution(task) {
  cancelReadiness();
  let lease;
  if (pending) pending.finish(null);
  denied = true;
  let own = ++revision;
  if (suspended || !component) return;
  try {
    const pendingClear = local.getItem(CLEAR);
    if (pendingClear) {
      let target;
      try { target = JSON.parse(pendingClear); } catch (_) {}
      if (validRecord(target)) {
        const clearing = clearPageAttribution(target);
        const mine = revision; // this task's epoch after the clear's synchronous bump
        await clearing;
        // Superseded (newer readiness, withdrawal, suspension or clear): yield without
        // denying, re-claiming, erasing or opening on behalf of newer work.
        if (revision !== mine) return;
        if (local.getItem(CLEAR)) { denied = true; return; }
        own = ++revision;
      } else local.removeItem(CLEAR); // The established attribution window has expired.
    }
    if (!remainingBudget(task)) {
      // Finite-clock expiry retains bytes for a later bound proposal. Only a current,
      // unsuspended task in a realm whose monotonic clock is permanently unusable
      // (it can never admit) deletes the unadmitted local copy. No channel, new
      // identifier write, or grant.
      if (own === revision && !suspended && !Number.isFinite(monotonicNow())) erase();
      return;
    }
    // Worker interval starts before open; the Head independently anchors at ACK.
    lease = localBudget(1500);
    const opened = await openChannel(task);
    if (own !== revision || suspended) return;
    // O3: missing binding evidence (refusal, timeout, transport uncertainty) is a NON-DESTRUCTIVE
    // no-admission hold: no KEY/CLEAR/REVOKED change. Only an authenticated revoke erases.
    if (opened !== true) { denied = true; return; }
    const binding = policyRequest('attribution', 'read', nonce, channel);
    const policy = await withinBudget(async () => {
      if (!remainingBudget(task) || own !== revision || suspended) return null;
      try { return await getAdsFormRequirement(binding); }
      catch (_) {
        if (remainingBudget(task) && remainingBudget(lease) && own === revision && !suspended) diagnostic('policy', 'REJECTED');
        return null;
      }
    }, lease);
    if (own !== revision || suspended) return;
    if (!remainingBudget(task) || !remainingBudget(lease) || !validPolicy(policy, binding)) {
      if (!remainingBudget(lease)) diagnostic('policy', 'TIMEOUT');
      denied = true; erase(); return;
    }
    let result = await request('read', policy, storedRecord(), lease);
    if (own !== revision || suspended) return;
    if (result && result.allowed && remainingBudget(task) && remainingBudget(lease)) result = await request('confirm', policy, null, lease);
    else result = null;
    if (own !== revision || suspended) return;
    denied = !remainingBudget(task) || !remainingBudget(lease) || !result || !result.allowed;
    if (denied) { erase(); return; }
    if (result.record === null) { admittedRaw = null; partitionClosed = true; diagnostic('worker', 'READY_EMPTY'); erase(); return; }
    if (!validRecord(result.record)) { denied = true; erase(); return; }
    // Head has reconciled first touch in this revocation epoch. An older local
    // copy cannot override its answer after a missed/delayed withdrawal notice.
    const raw = JSON.stringify(result.record);
    local.setItem(KEY, raw);
    admittedRaw = raw; partitionClosed = true;
    try { local.removeItem(REVOKED); } catch (_) {}
    diagnostic('worker', 'READY_RECORD');
  } catch (_) { if (own === revision) { denied = true; erase(); } }
  finally { closeBudget(lease); if (!lateOpen || lateOpen.task !== task) closeBudget(task); }
}
