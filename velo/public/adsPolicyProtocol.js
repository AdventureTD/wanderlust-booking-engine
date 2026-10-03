/* global globalThis:readonly */
// V2 freshness is local elapsed time plus a fresh receiver challenge, never
// a comparison between browser and server clocks. Echoes are not signatures.
export const POLICY_AUDIENCE = 'https://www.wanderlustcaribbean.com';
let lastMonotonic = -1;
export function monotonicNow() {
  try {
    const now = globalThis.performance.now();
    if (Number.isFinite(now) && now >= 0 && now >= lastMonotonic) {
      lastMonotonic = now;
      return now;
    }
  } catch (_) { /* Missing/invalid clock permanently closes this realm. */ }
  lastMonotonic = Infinity;
  return NaN;
}
export function localBudget(ms) {
  const start = monotonicNow();
  const budget = { start, deadline: start + ms, dead: !Number.isFinite(start), timer: null };
  budget.timer = setTimeout(() => { budget.dead = true; }, ms);
  return budget;
}
export function remainingBudget(budget) {
  const now = monotonicNow();
  if (!budget || budget.dead || !Number.isFinite(now) || now >= budget.deadline) return 0;
  return budget.deadline - now;
}
export function closeBudget(budget) {
  if (budget) { budget.dead = true; clearTimeout(budget.timer); }
}
export function freshPolicyNonce() {
  try {
    const crypto = globalThis.crypto;
    const bytes = new Uint8Array(16);
    if (!crypto || typeof crypto.getRandomValues !== 'function' || crypto.getRandomValues(bytes) !== bytes) return '';
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) { return ''; }
}
export function policyRequest(purpose, phase, nonce, challenge) {
  return { v: 2, audience: POLICY_AUDIENCE, purpose, phase, nonce, challenge };
}
export function validPolicy(result, request) {
  return !!result && Object.keys(result).sort().join(',') === 'audience,challenge,nonce,observedAt,phase,policyKey,purpose,requirement,v' &&
    Object.keys(request).every(k => result[k] === request[k]) &&
    ['REQUIRED', 'NOT_REQUIRED'].includes(result.requirement) &&
    typeof result.policyKey === 'string' && /^[a-f0-9]{64}$/.test(result.policyKey) &&
    Number.isSafeInteger(result.observedAt) && result.observedAt >= 0;
}
// A timer victory latches the original lease even if its sampled clock stalls.
// Attach rejection handling before checking a post-invocation remaining budget.
export async function withinBudget(invoke, budget) {
  let timer;
  try {
    if (!remainingBudget(budget)) return null;
    const result = Promise.resolve(invoke()).catch(() => null);
    const left = remainingBudget(budget);
    if (!left) return null;
    const value = await Promise.race([result, new Promise(resolve => {
      timer = setTimeout(() => { closeBudget(budget); resolve(null); }, left);
    })]);
    return remainingBudget(budget) ? value : null;
  } catch (_) { return null; }
  finally { clearTimeout(timer); }
}
