'use strict';
// M0 r4 SCHEDULE EXPLORER (r3 explorer + DURING-readback phase for get/listPage, partial persistent
// outages, full kind set at depth 2 including same-op before+after, depth 3 built from ACTUAL
// continuations, activation/dedup statistics, review-obligation/monotonicity/evidence invariants).
// Counts are GENERATED runs over injected interference on the deterministic Promise interleaving plus
// nested owner operations; this is NOT an enumeration of all cross-worker scheduler interleavings.
// r3 header follows. Systematically injects interference at every store operation of each
// base scenario, at the BEFORE-apply phase and (for writes) the AFTER-apply / BEFORE-ACK phase.
// Interference kinds: fault (fail, ackLost, ackLost+readFail, readFail, stale page), concurrent
// owner cancel, owner takeover fence, deadline crossing, total outage. Depth 1 is exhaustive;
// depth 2 is exhaustive over a reduced kind set; depth 3 is sampled (seeded).
// After every run it checks global invariants on the result, the committed-write log and the
// trace, then sweeps at the deadline and checks the eventual invariants.
// Usage: node.exe tests/r3/explorer.cjs [--depth3=N] [--out=file.json]
const path = require('node:path');
const fs = require('node:fs');
const { env, order, E } = require('./helpers.cjs');

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const DEPTH3 = Number(args.depth3 ?? 2000);
const D2_SCENARIOS = new Set((args.d2 || 's1,s2,s3,s6').split(','));

const SCENARIOS = {
  s1: { name: '1 entry, 2 nights', inv: null, setup: async () => {}, orders: () => [order([E('A', 1, 1)], { quoteId: 'X1' })] },
  s2: { name: '2 entries, 1 night', inv: null, setup: async () => {}, orders: () => [order([E('A', 1, 1), E('B', 1, 2)], { quoteId: 'X1', checkOut: '2027-03-02' })] },
  s3: { name: 'quantity 2 x 2 nights', inv: null, setup: async () => {}, orders: () => [order([E('A', 2, 1)], { quoteId: 'X1' })] },
  s4: { name: 'prior occupancy forces unit scan', inv: { A: { units: 2, minOccupancy: 1, maxOccupancy: 3 } }, setup: async c => { await c.checkout(order([E('A', 1, 1)], { quoteId: 'PRIOR', checkOut: '2027-03-02' })); }, orders: () => [order([E('A', 1, 1)], { quoteId: 'X1' })] },
  s5: { name: 'owner CMS row counted', inv: { A: { units: 2, minOccupancy: 1, maxOccupancy: 3 } }, setup: async (c, store) => { store.forceSet('owner', 'r1', { roomCode: 'A', nights: ['2027-03-01'], rooms: 1 }); }, orders: () => [order([E('A', 1, 1)], { quoteId: 'X1' })] },
  s6: { name: 'concurrent duplicate submission (same quoteId)', inv: null, setup: async () => {}, orders: () => { const o = order([E('A', 1, 1)], { quoteId: 'X1', checkOut: '2027-03-02' }); return [o, JSON.parse(JSON.stringify(o))]; } },
  s7: { name: 'two checkouts contend for the last unit', inv: null, setup: async () => {}, orders: () => [order([E('S', 1, 1)], { quoteId: 'X1', checkOut: '2027-03-02' }), order([E('S', 1, 1)], { quoteId: 'X2', checkOut: '2027-03-02' })] }
};
const KINDS1 = ['fail', 'ackLost', 'ackLostReadFail', 'readFail', 'stale', 'cancel', 'fence', 'deadline', 'outage', 'readOutage', 'writeOutage', 'casOutage'];
const KINDS2 = KINDS1;
const isWrite = op => op === 'insert' || op === 'cas';
function applicable(kind, phase, op) {
  if (kind === 'fail') return phase === 'before' && isWrite(op);
  if (kind === 'ackLost' || kind === 'ackLostReadFail') return phase === 'after' && isWrite(op);
  if (kind === 'readFail') return !isWrite(op);                    // before the read, or DURING delivery of its result
  if (kind === 'stale') return phase === 'before' && op === 'list';
  return phase === 'before' || isWrite(op);             // cancel/fence/deadline/outage: before apply, or after apply before ACK
}

function install(ctx, plan) {
  for (const step of plan) {
    ctx.store.rule({ phase: step.phase, match: i => i.n === step.n, action: async info => {
      ctx.fired.push(step);
      switch (step.kind) {
        case 'fail': return 'fail';
        case 'readFail': return 'fail';
        case 'stale': return 'stale';
        case 'ackLost': return 'ackLost';
        case 'ackLostReadFail': ctx.store.rule({ phase: 'before', op: 'get', ns: info.ns, action: 'fail' }); return 'ackLost';
        case 'cancel': for (const id of ctx.ids()) await ctx.c.ownerCancel(id); return undefined;
        case 'fence': for (const id of ctx.ids()) await ctx.c.ownerFence(id); return undefined;
        case 'deadline': ctx.clock.set(ctx.deadline); return undefined;
        case 'outage': ctx.store.rule({ phase: 'before', match: () => !ctx.done, action: 'fail', once: false }); return step.phase === 'before' ? 'fail' : undefined;
        case 'readOutage': ctx.store.rule({ phase: 'before', match: i => !ctx.done && (i.op === 'get' || i.op === 'list'), action: 'fail', once: false }); return !isWrite(info.op) && step.phase === 'before' ? 'fail' : undefined;
        case 'writeOutage': ctx.store.rule({ phase: 'before', match: i => !ctx.done && isWrite(i.op), action: 'fail', once: false }); return isWrite(info.op) && step.phase === 'before' ? 'fail' : undefined;
        case 'casOutage': ctx.store.rule({ phase: 'before', match: i => !ctx.done && i.op === 'cas', action: 'fail', once: false }); return info.op === 'cas' && step.phase === 'before' ? 'fail' : undefined;
      }
      return undefined;
    } });
  }
}

async function runOnce(sk, plan) {
  const sc = SCENARIOS[sk];
  const e = env({ inventory: sc.inv || undefined });
  await sc.setup(e.c, e.store);
  const base = { seq: e.store.seq, applied: e.store.applied.length, events: e.events.length, ops: e.store.opLog.length };
  const ctx = { ...e, fired: [], done: false, deadline: e.clock.now() + 1000, ids: () => e.store.keys('checkout').filter(k => k.startsWith('co_X')) };
  const n0 = e.store.opLog.length;
  install(ctx, plan.map(s => ({ ...s, n: s.k + n0 })));
  const orders = sc.orders();
  let results;
  try {
    let timer;
    results = await Promise.race([Promise.all(orders.map(o => e.c.checkout(o))), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('HANG')), 3000); })]).finally(() => clearTimeout(timer));
  } catch (err) { return { fail: ['EXCEPTION ' + err.message], ops: 0, fired: 0, planned: plan.length }; }
  ctx.done = true; e.store.clearRules();
  const ops = e.store.opLog.length - n0;
  const failures = check(e, results, base, sc, false);
  // eventual: no faults, sweep after the deadline
  e.clock.set(Math.max(e.clock.now(), ctx.deadline, ...ctx.ids().map(id => e.store.peek('checkout', id).deadline)));   // each record's own deadline
  for (const id of ctx.ids()) await e.c.sweep(id);
  failures.push(...check(e, results, base, sc, true));
  return { fail: failures, ops, fired: ctx.fired.length, planned: plan.length };
}

function check(e, results, base, sc, eventual) {
  const f = [];
  const { store, events } = e;
  const applied = store.applied.slice(base.applied);
  const ownerBefore = sc.inv && sc.name.startsWith('owner') ? [{ roomCode: 'A', nights: ['2027-03-01'], rooms: 1 }] : null;
  const ids = store.keys('checkout').filter(k => k.startsWith('co_X'));
  for (const id of ids) {
    const writes = applied.filter(a => a.ns === 'checkout' && a.key === id);
    const stateAt = seq => { let s = null; for (const w of writes) if (w.seq < seq) s = w.value; return s; };
    const rec = store.peek('checkout', id);
    const deadline = rec.deadline;
    // INV11 snapshot immutable
    if (!writes.every(w => JSON.stringify(w.value.snapshot) === JSON.stringify(writes[0].value.snapshot))) f.push('INV11 snapshot changed ' + id);
    // INV9 single dispatch, single bn
    if (writes.filter(w => w.value.state === 'ACTIVE' && stateAt(w.seq) && stateAt(w.seq).state === 'ADMITTING').length > 1) f.push('INV9 two dispatches ' + id);
    if (store.values('bn').filter(v => v.checkoutId === id).length > 1) f.push('INV9 two booking numbers ' + id);
    const slotW = applied.filter(a => a.ns === 'slot' && a.op === 'insert' && a.value.checkoutId === id);
    // INV1 no claim after terminal LP or deadline (A9 + A8)
    for (const s of slotW) {
      const st = stateAt(s.seq);
      if (!st || st.state !== 'ACTIVE' || st.epoch !== 1 || st.entries[s.value.entryIndex].state !== 'DISPATCHED') f.push('INV1 claim applied while not ACTIVE/DISPATCHED ' + s.key);
      if (!(s.time < deadline)) f.push('INV1 claim applied at/after deadline ' + s.key);
    }
    // INV10 no duplicate (entry, ordinal, night); within snapshot quantity
    const seen = new Set();
    for (const s of slotW) { const k = s.value.entryIndex + '#' + s.value.ordinal + '#' + s.value.night; if (seen.has(k)) f.push('INV10 duplicate room-night claim ' + k); seen.add(k); }
    const total = rec.snapshot.cart.entries.reduce((n, x) => n + x.quantity, 0) * rec.nights.length;
    if (slotW.length > total) f.push('INV10 more claims than snapshot rooms ' + id);
    // INV2 FINALIZED only with complete evidence, before the deadline, once
    const finW = writes.filter(w => w.value.state === 'FINALIZED' && (!stateAt(w.seq) || stateAt(w.seq).state !== 'FINALIZED'));
    if (finW.length > 1) f.push('INV2 finalized twice ' + id);
    for (const w of finW) {
      if (!(w.time < deadline)) f.push('INV2 finalized at/after deadline ' + id);
      if (!w.value.entries.every(x => x.state === 'RESERVED')) f.push('INV2 finalized with non-reserved entry ' + id);
      if (slotW.filter(s => s.seq < w.seq).length !== total) f.push('INV2 finalized without complete claims ' + id);
    }
    // INV4 NO_RESERVATION / ABANDONED only with zero claims (final, after all ops)
    const everAbandoned = writes.some(w => w.value.state === 'ABANDONED');
    if (everAbandoned && slotW.length > 0) f.push('INV4 ABANDONED with claims ' + id);
    // INV7 at most one published invoice identity
    if (writes.filter(w => w.value.invoice && (!stateAt(w.seq) || !stateAt(w.seq).invoice)).length > 1) f.push('INV7 invoice published twice ' + id);
    for (const w of writes.filter(w => w.value.invoice && (!stateAt(w.seq) || !stateAt(w.seq).invoice))) if (stateAt(w.seq).state !== 'FINALIZED') f.push('INV7 invoice published outside FINALIZED ' + id);
    // INV3 no claim attempt after the executor stopped (local monotonic uncertainty)
    const ev = events.slice(base.events).filter(x => x.checkoutId === id);
    const stopAt = ev.findIndex(x => x.ev === 'stop');
    if (stopAt >= 0 && ev.slice(stopAt + 1).some(x => x.ev === 'claimAttempt')) f.push('INV3 claim attempt after stop ' + id);
    const firstNonCert = ev.findIndex(x => x.ev === 'stop');
    if (firstNonCert >= 0 && ev.slice(firstNonCert).some(x => x.ev === 'certified' || x.ev === 'finalConfirmed' || x.ev === 'discharged')) f.push('INV3 certification/discharge after stop ' + id);
    // INV5 slot monotonicity: every applied claim is still present with its original value; no slot CAS
    for (const s of slotW) if (JSON.stringify(store.peek('slot', s.key)) !== JSON.stringify(s.value)) f.push('INV5 claim changed or removed ' + s.key);
    if (applied.some(a => a.ns === 'slot' && a.op !== 'insert')) f.push('INV5 non-insert slot write');
    // INV12 review obligation: discharged only after a confirmed final by the executor (or owner resolution, unused here)
    const finalConfirmedEv = ev.some(x => x.ev === 'finalConfirmed');
    if (rec.review && rec.review.required === false && !finalConfirmedEv) f.push('INV12 review discharged without a confirmed final ' + id);
    for (const w of writes) if (w.value.review && w.value.review.required === false) { const prev = stateAt(w.seq); if (!prev || prev.state !== 'FINALIZED') f.push('INV12 discharge not after FINALIZED ' + id); }
    if (stopAt >= 0 && ev.slice(stopAt + 1).some(x => x.ev === 'discharged')) f.push('INV12 discharge after stop ' + id);
    if (writes.length && !(writes[0].value.review && writes[0].value.review.required === true)) f.push('INV12 admission without default obligation ' + id);
    // INV13 canonical evidence for FINALIZED
    if (finW.length) {
      const fv = finW[0].value, logical = new Set();
      fv.entries.forEach((en, i) => {
        const q = rec.snapshot.cart.entries[i].quantity;
        if (!Array.isArray(en.evidence) || en.evidence.length !== q * rec.nights.length) f.push('INV13 evidence size ' + id + '#' + i);
        for (const k of en.evidence || []) {
          const sv = store.peek('slot', k);
          if (!sv || sv.checkoutId !== id || sv.entryIndex !== i || sv.x !== rec.admission || !rec.nights.includes(sv.night) || !(sv.ordinal >= 0 && sv.ordinal < q) || k.split('|')[0] !== rec.snapshot.cart.entries[i].roomCode || k.split('|')[1] !== sv.night) f.push('INV13 non-canonical evidence ' + k);
          else logical.add(i + '#' + sv.ordinal + '#' + sv.night);
        }
      });
      if (logical.size !== total) f.push('INV13 logical evidence incomplete/duplicated ' + id);
    }
    // INV14 evidence field consistency
    if (rec.evidence === 'ZERO_PROVEN' && slotW.length) f.push('INV14 ZERO_PROVEN with claims ' + id);
    if (rec.evidence === 'CLAIMS_PRESENT' && !slotW.length && !store.keys('slot').some(k => JSON.stringify(store.peek('slot', k)).includes(id))) f.push('INV14 CLAIMS_PRESENT without claims ' + id);
    if (eventual) {
      if (!['FINALIZED', 'HOLD', 'ABANDONED', 'CANCELLED', 'OWNER_RESOLVED'].includes(rec.state)) f.push('EV1 not concluded after sweep: ' + rec.state + ' ' + id);
      if (rec.state === 'ABANDONED' && slotW.length) f.push('EV2 abandoned with claims ' + id);
    }
  }
  // INV6 result semantics
  for (const r of results) {
    if (!r) continue;
    if (r.ok && !(r.finalConfirmed && r.state === 'FINALIZED')) f.push('INV6 ok without confirmed final');
    if (!r.ok && r.finalConfirmed) f.push('INV6 finalConfirmed on non-ok');
    if (r.ok) { const fin = applied.find(a => a.ns === 'checkout' && a.key === r.checkoutId && a.value.state === 'FINALIZED'); if (!fin) f.push('INV6 ok but no FINALIZED write'); }
    if (r.conclusion === 'NO_RESERVATION' && applied.some(a => a.ns === 'slot' && a.value.checkoutId === r.checkoutId)) f.push('INV4 NO_RESERVATION response but claims exist');
  }
  // INV8 owner rows unchanged
  if (ownerBefore && JSON.stringify(store.values('owner')) !== JSON.stringify(ownerBefore)) f.push('INV8 owner rows changed');
  // INV9 one checkout per quoteId (structural: canonical id); one executor result ok per quote
  const okPerId = {}; for (const r of results) if (r && r.ok) okPerId[r.checkoutId] = (okPerId[r.checkoutId] || 0) + 1;
  if (Object.values(okPerId).some(n => n > 1)) f.push('INV9 two successful executors for one checkout');
  return f;
}

async function continuation(sk, plan) {
  // dry run with `plan` installed; returns the ops issued after the last planned op index
  const e = env({ inventory: SCENARIOS[sk].inv || undefined }); await SCENARIOS[sk].setup(e.c, e.store);
  const m0 = e.store.opLog.length;
  const ctx = { ...e, fired: [], done: false, deadline: e.clock.now() + 1000, ids: () => e.store.keys('checkout').filter(k => k.startsWith('co_X')) };
  install(ctx, plan.map(s => ({ ...s, n: s.k + m0 })));
  await Promise.all(SCENARIOS[sk].orders().map(o => e.c.checkout(o)));
  ctx.done = true; e.store.clearRules();
  return e.store.opLog.slice(m0).map((o, idx) => ({ k: idx + 1, op: o.op, reachedAfter: o.result !== undefined }));
}
const NONFAILING = new Set(['cancel', 'fence', 'deadline', 'stale']);
const steps = (ops, after, prevPhase) => {
  const out = [];
  for (const o of ops) for (const phase of ['before', 'after']) {
    if (phase === 'after' && !o.reachedAfter) continue;   // op failed before apply in this continuation: no after phase exists
    if (o.k < after.k || (o.k === after.k && !(prevPhase === 'before' && phase === 'after' && NONFAILING.has(after.kind)))) continue;   // same op: non-failing before-interference, then after
    for (const kind of KINDS2) if (applicable(kind, phase, o.op)) out.push({ k: o.k, phase, kind });
  }
  return out;
};
(async () => {
  const stat = () => ({ generated: 0, unique: 0, fullyActivated: 0, partial: 0, planLengths: {} });
  const summary = { depth1: stat(), depth2: stat(), depth3: stat(), failures: [], byScenario: {} };
  const seen = new Set();
  const record = (grp, sk, plan, res) => {
    const g = summary[grp]; g.generated++;
    const key = sk + JSON.stringify(plan);
    if (!seen.has(key)) { seen.add(key); g.unique++; }
    g.planLengths[plan.length] = (g.planLengths[plan.length] || 0) + 1;
    if (res.fired >= plan.length) g.fullyActivated++; else g.partial++;
    if (res.fail.length) summary.failures.push({ sk, plan, fail: [...new Set(res.fail)] });
  };
  let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (const sk of Object.keys(SCENARIOS)) {
    const dry = await runOnce(sk, []);
    if (dry.fail.length) summary.failures.push({ sk, plan: [], fail: dry.fail });
    const ops = await continuation(sk, []);
    const per = { name: SCENARIOS[sk].name, happyOps: ops.length, depth1: 0, depth2: 0, depth3: 0 };
    const firsts = [];
    for (const o of ops) for (const phase of ['before', 'after']) for (const kind of KINDS1) {
      if (!applicable(kind, phase, o.op)) continue;
      const plan = [{ k: o.k, phase, kind }];
      const res = await runOnce(sk, plan); record('depth1', sk, plan, res); per.depth1++;
      firsts.push(plan);
    }
    if (D2_SCENARIOS.has(sk)) {
      for (const p1 of firsts) {
        const cont = await continuation(sk, p1);
        for (const st of steps(cont, p1[0], p1[0].phase)) {
          const plan = [...p1, st];
          const res = await runOnce(sk, plan); record('depth2', sk, plan, res); per.depth2++;
        }
      }
    }
    // depth 3: sampled from ACTUAL continuations (every step applicable to the op it targets)
    for (let s = 0; s < Math.floor(DEPTH3 / Object.keys(SCENARIOS).length); s++) {
      const p1 = firsts[rnd(firsts.length)];
      const c2 = steps(await continuation(sk, p1), p1[0], p1[0].phase); if (!c2.length) continue;
      const p2 = [...p1, c2[rnd(c2.length)]];
      const c3 = steps(await continuation(sk, p2), p2[1], p2[1].phase); if (!c3.length) continue;
      const plan = [...p2, c3[rnd(c3.length)]];
      const res = await runOnce(sk, plan); record('depth3', sk, plan, res); per.depth3++;
    }
    summary.byScenario[sk] = per;
  }
  summary.total = { generated: summary.depth1.generated + summary.depth2.generated + summary.depth3.generated, unique: seen.size };
  summary.failureCount = summary.failures.length;
  const out = JSON.stringify(summary, null, 1);
  if (args.out) fs.writeFileSync(args.out, out);
  const brief = { total: summary.total, depth1: summary.depth1, depth2: summary.depth2, depth3: summary.depth3, failureCount: summary.failureCount, byScenario: summary.byScenario };
  console.log(JSON.stringify(brief, null, 1));
  console.log('"failureCount": ' + summary.failureCount + '\n"total": ' + summary.total.generated);
  if (summary.failures.length) { console.log('FIRST FAILURES', JSON.stringify(summary.failures.slice(0, 8), null, 1)); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exitCode = 2; });
void path;
