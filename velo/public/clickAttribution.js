/* global globalThis:readonly */
// ESLint global declaration only; optional runtime Web Crypto is checked below.
// Dedicated attribution channel; never carries contacts or generic events.
import { local } from 'wix-storage-frontend';
import { normalizePaidTouches } from 'public/paidTouchState';
import { getAdsFormRequirement } from 'backend/adsFormRequirement.web';
import { localBudget, remainingBudget, closeBudget, freshPolicyNonce, policyRequest, validPolicy, withinBudget } from 'public/adsPolicyProtocol';
const KEY = 'wl_click_attribution', CLEAR = 'wl_click_attribution_clear_pending';
const REVOKED = 'wl_click_attribution_revoked';
// Storage carries data, never a grant. Undefined admits startup reconciliation
// only; null is an explicit empty admission. Only a bound Head confirm sets bytes.
let admittedRaw;
let partitionClosed = false;
try { partitionClosed = !!local.getItem(REVOKED); } catch (_) { partitionClosed = true; }
export function attributionStorageAdmitted(raw) { return admittedRaw !== undefined && raw === admittedRaw; }
function closePartition() {
  partitionClosed = true; admittedRaw = null;
  try { local.setItem(REVOKED, '1'); } catch (_) {}
}
let component, sequence = 0, revision = 0, suspended = false, pending = null;
let denied = true, nonce = '', channel = '';
let lateOpen = null;
// Diagnostic v1: finite, value-free, once per stage/reason per worker lifetime.
// Observation only: no permission, storage, timers or transport are added.
const diagnosticSeen = new Set();
function diagnostic(stage, reason) {
  if (!['policy', 'open', 'read', 'confirm', 'clear', 'worker'].includes(stage) ||
      !['TIMEOUT', 'REJECTED', 'TRANSPORT_ERROR', 'CRYPTO_UNAVAILABLE', 'READY_EMPTY', 'READY_RECORD'].includes(reason)) return;
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
  if (!d.allowed) { revoke(); return; }
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
  if (component) return;
  try {
    const c = w('#wbeEventBridge');
    if (!c || typeof c.onMessage !== 'function' || typeof c.postMessage !== 'function') return;
    c.onMessage(event => {
      const d = event && event.data;
      if (d && d.type === 'wbe-click-revoke' && d.v === 2 && d.schema === 1 && d.nonce === nonce &&
          Object.keys(d).sort().join(',') === 'channel,nonce,schema,type,v' &&
          (!channel || d.channel === channel)) { revoke(); return; }
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
      component.postMessage({ type: 'wbe-click-attribution', v: 2, schema: 1, op, sequence: p.sequence, nonce, channel, policy, record });
    }
    catch (_) { diagnostic(op, 'TRANSPORT_ERROR'); p.finish(null); }
  });
}
async function openChannel(task) {
  const own = revision;
  nonce = freshPolicyNonce(); channel = ''; sequence = 0;
  if (!nonce) { diagnostic('open', 'CRYPTO_UNAVAILABLE'); return false; }
  const opened = await request('open', null, null, task);
  if (own !== revision || suspended || !opened || !opened.allowed) return false;
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
  try {
    const raw = local.getItem(KEY);
    if ((partitionClosed || admittedRaw !== undefined) && raw !== admittedRaw) return null;
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
  try { local.setItem(CLEAR, JSON.stringify(record)); } catch (_) {}
  if (!channel && !await openChannel()) return;
  const result = await request('clear', null, record);
  if (result && result.allowed && result.record === null) { try { local.removeItem(CLEAR); } catch (_) {} }
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
        await clearPageAttribution(target);
        if (local.getItem(CLEAR)) { denied = true; return; }
        own = ++revision;
      } else local.removeItem(CLEAR); // The established attribution window has expired.
    }
    if (!remainingBudget(task)) return;
    // Worker interval starts before open; the Head independently anchors at ACK.
    lease = localBudget(1500);
    const opened = await openChannel(task);
    if (own !== revision || suspended) return;
    if (!opened) { denied = true; erase(); return; }
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
