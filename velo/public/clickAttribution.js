/* global globalThis:readonly */
// ESLint global declaration only; optional runtime Web Crypto is checked below.
// Dedicated attribution channel; never carries contacts or generic events.
import { local } from 'wix-storage-frontend';
import { getAdsFormRequirement } from 'backend/adsFormRequirement.web';
const KEY = 'wl_click_attribution', CLEAR = 'wl_click_attribution_clear_pending';
let component, sequence = 0, revision = 0, suspended = false, pending = null;
let denied = true, nonce = '', channel = '';
let lateOpen = null;
function cancelReadiness() {
  if (lateOpen) clearTimeout(lateOpen.timer);
  lateOpen = null;
}
// A timed-out open is transport uncertainty, never a consent choice. Its
// authenticated late reply may wake a NEW handshake, but cannot grant access.
function armReadiness(p, task) {
  if (!task || task.remaining <= 0 || task.deadline <= Date.now() ||
      p.revision !== revision || p.nonce !== nonce || suspended) return;
  cancelReadiness();
  const watch = { nonce, sequence: p.sequence, revision, task, timer: null };
  watch.timer = setTimeout(() => { if (lateOpen === watch) cancelReadiness(); }, task.deadline - Date.now());
  lateOpen = watch;
}
function wakeReadiness(d) {
  const watch = lateOpen;
  if (!watch || watch.revision !== revision || suspended || Date.now() >= watch.task.deadline ||
      !d || d.type !== 'wbe-click-attribution-result' || d.v !== 1 ||
      Object.keys(d).sort().join(',') !== 'allowed,channel,nonce,op,record,sequence,type,v' ||
      d.nonce !== watch.nonce || d.sequence !== watch.sequence || d.op !== 'open' ||
      !/^[a-f0-9]{32}$/.test(d.channel) || d.record !== null || typeof d.allowed !== 'boolean') return;
  cancelReadiness();
  if (!d.allowed) { revoke(); return; }
  watch.task.remaining--;
  void waitAttribution(watch.task);
}
function freshNonce() {
  try {
    if (typeof globalThis === 'undefined') return '';
    const crypto = globalThis.crypto;
    if (!crypto || typeof crypto.getRandomValues !== 'function') return '';
    const bytes = new Uint8Array(16);
    if (crypto.getRandomValues(bytes) !== bytes) return '';
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) { return ''; }
}
function revoke() {
  cancelReadiness();
  revision++; denied = true; channel = ''; erase();
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
  if (suspended) revoke();
}
export function initClickAttribution(w) {
  if (component) return;
  try {
    const c = w('#wbeEventBridge');
    if (!c || typeof c.onMessage !== 'function' || typeof c.postMessage !== 'function') return;
    c.onMessage(event => {
      const d = event && event.data;
      if (d && d.type === 'wbe-click-revoke' && d.v === 1 && d.nonce === nonce &&
          Object.keys(d).sort().join(',') === 'channel,nonce,type,v' &&
          (!channel || d.channel === channel)) { revoke(); return; }
      if (!pending) { wakeReadiness(d); return; }
      if (!pending || !d || d.type !== 'wbe-click-attribution-result' || d.v !== 1 ||
          Object.keys(d).sort().join(',') !== 'allowed,channel,nonce,op,record,sequence,type,v' ||
          d.nonce !== nonce || !/^[a-f0-9]{32}$/.test(d.channel) ||
          (pending.op !== 'open' && d.channel !== channel) ||
          d.sequence !== pending.sequence || d.op !== pending.op || typeof d.allowed !== 'boolean') return;
      pending.finish(d);
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
      p.finish(null);
    }, 500);
    p.finish = value => { if (pending !== p) return; pending = null; clearTimeout(timer); resolve(value); };
    pending = p;
    try {
      if (task && Date.now() >= task.deadline) { p.finish(null); return; }
      component.postMessage({ type: 'wbe-click-attribution', v: 1, op, sequence: p.sequence, nonce, channel, policy, record });
    }
    catch (_) { p.finish(null); }
  });
}
async function openChannel(task) {
  const own = revision;
  nonce = freshNonce(); channel = ''; sequence = 0;
  if (!nonce) return false;
  const opened = await request('open', null, null, task);
  if (own !== revision || suspended || !opened || !opened.allowed) return false;
  channel = opened.channel;
  return true;
}
function validRecord(record) {
  if (!record || Object.keys(record).sort().join(',') !== 'capturedAt,gbraid,gclid,msclkid,wbraid') return false;
  if (!['gclid', 'gbraid', 'wbraid', 'msclkid'].every(k => typeof record[k] === 'string' && record[k].length <= 512 && (record[k] === '' || /^[\x21-\x7e]+$/.test(record[k])))) return false;
  const at = typeof record.capturedAt === 'string' ? Date.parse(record.capturedAt) : NaN;
  return Number.isFinite(at) && Date.now() >= at && Date.now() - at <= 90 * 86400000;
}
function storedRecord() {
  try {
    const raw = JSON.parse(local.getItem(KEY));
    const record = { capturedAt: raw.capturedAt };
    ['gclid', 'gbraid', 'wbraid', 'msclkid'].forEach(k => { record[k] = raw[k] || ''; });
    return validRecord(record) ? record : null;
  } catch (_) { return null; }
}
function sameRecord(a, b) {
  return a && b && ['capturedAt', 'gclid', 'gbraid', 'wbraid', 'msclkid'].every(k => a[k] === b[k]);
}
export async function clearPageAttribution(snapshot) {
  cancelReadiness();
  revision++;
  let record = snapshot || storedRecord();
  try { if (!record) record = JSON.parse(local.getItem(CLEAR)); } catch (_) {}
  if (!validRecord(record)) return;
  if (sameRecord(storedRecord(), record)) erase();
  try { local.setItem(CLEAR, JSON.stringify(record)); } catch (_) {}
  if (!channel && !await openChannel()) return;
  const result = await request('clear', null, record);
  if (result && result.allowed && result.record === null) { try { local.removeItem(CLEAR); } catch (_) {} }
}
export async function waitForClickAttribution() {
  return waitAttribution({ remaining: 2, deadline: Date.now() + 10000 });
}
async function waitAttribution(task) {
  cancelReadiness();
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
    const opened = await openChannel(task);
    if (own !== revision || suspended) return;
    if (!opened) { denied = true; erase(); return; }
    let timer;
    const policy = await Promise.race([
      Promise.resolve().then(() => Date.now() < task.deadline ? getAdsFormRequirement() : null).catch(() => null),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 500); })
    ]).finally(() => clearTimeout(timer));
    if (own !== revision || suspended) return;
    if (!policy || Object.keys(policy).sort().join(',') !== 'observedAt,policyKey,requirement,v' || policy.v !== 1 ||
        !['REQUIRED', 'NOT_REQUIRED'].includes(policy.requirement) || typeof policy.policyKey !== 'string' ||
        !/^[a-f0-9]{64}$/.test(policy.policyKey) || !Number.isSafeInteger(policy.observedAt) ||
        Date.now() < policy.observedAt || Date.now() - policy.observedAt > 1500) { denied = true; erase(); return; }
    let result = await request('read', policy, storedRecord(), task);
    if (own !== revision || suspended) return;
    if (result && result.allowed) result = await request('confirm', policy, null, task);
    if (own !== revision || suspended) return;
    denied = !result || !result.allowed;
    if (denied) { erase(); return; }
    if (result.record === null) { erase(); return; }
    if (!validRecord(result.record)) { denied = true; erase(); return; }
    // Head has reconciled first touch in this revocation epoch. An older local
    // copy cannot override its answer after a missed/delayed withdrawal notice.
    local.setItem(KEY, JSON.stringify(result.record));
  } catch (_) { if (own === revision) { denied = true; erase(); } }
}
