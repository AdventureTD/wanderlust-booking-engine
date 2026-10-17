'use strict';
// r4 mutation runner (r3 catalog re-anchored to r4 plus review-obligation mutants N1-N13). Each mutant is a COPY (src/r4/.mutant.cjs). It runs the r3 suite AND the
// schedule explorer (reduced: depth2 on s1,s6,s7; depth3 sampled 300) against the mutant.
//   CAUGHT            a valid run with >=1 failing test or >=1 explorer invariant failure
//   NOT DISTINGUISHED both valid and clean
//   INVALID_EXECUTION crash/timeout/signal/incomplete TAP or explorer exit 2 (never counted as caught)
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '../..'), src = path.join(root, 'src/r4/checkoutOrchestrator.cjs');
const original = fs.readFileSync(src, 'utf8');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const M = [
  ['M1 A9 guard dropped from claim inserts', "{ notAfter: ctx.deadline, guard: claimGuard(ctx.checkoutId, ctx.epoch, i) }", '{ notAfter: ctx.deadline }'],
  ['M2 A8 notAfter dropped from settle', "const s = await casExact('checkout', checkoutId, ctx.version, next, { notAfter: deadline });", "const s = await casExact('checkout', checkoutId, ctx.version, next, {});"],
  ['M3 A8 notAfter dropped from final', "const f = await casExact('checkout', checkoutId, ctx.version, fin, { notAfter: deadline });", "const f = await casExact('checkout', checkoutId, ctx.version, fin, {});"],
  ['M4 A8 notAfter dropped from dispatch', "d = await casExact('checkout', checkoutId, 1, dispatched, { notAfter: deadline });", "d = await casExact('checkout', checkoutId, 1, dispatched, {});"],
  ['M5 A8 notAfter dropped from claims', "{ notAfter: ctx.deadline, guard: claimGuard(ctx.checkoutId, ctx.epoch, i) }", '{ guard: claimGuard(ctx.checkoutId, ctx.epoch, i) }'],
  ['M6 A8 notAfter dropped from admission', "const a = await insertExact('checkout', checkoutId, record, { notAfter: snap.quote.expiresAt });", "const a = await insertExact('checkout', checkoutId, record, {});"],
  ['M7 executor continues after CLAIM_UNKNOWN (skips the room-night)', "if (c.r !== 'mine') return stop(", "if (c.r === 'unknown') continue;\n          if (c.r !== 'mine') return stop("],
  ['M8 settle UNKNOWN treated as certified', "if (s !== 'ok') return stop(ctx, s === 'late'", "if (s !== 'ok' && s !== 'unknown') return stop(ctx, s === 'late'"],
  ['M9 final UNKNOWN treated as confirmed', "if (f !== 'ok') {\n      if (f === 'unknown') {", "if (f !== 'ok' && f !== 'unknown') {\n      if (f === 'unknown') {"],
  ['M10 A12 asOf >= fence seq check removed', "if (minSeq !== undefined && !(asOf >= minSeq)) return null;", ''],
  ['M11 A12 single-snapshot page check removed', "if (asOf === null) asOf = page.asOf; else if (page.asOf !== asOf) return null;", 'if (asOf === null) asOf = page.asOf;'],
  ['M12 A12 failed page treated as end of enumeration', "try { page = await store.listPage(ns, cursor); } catch (_) { return null; }", "try { page = await store.listPage(ns, cursor); } catch (_) { break; }"],
  ['M13 zero-proof without a fence', "if (c.state !== 'FENCED') {\n        const fenced", "if (false) {\n        const fenced"],
  ['M14 integrity check always OK', "integrity: setIntegrity(c, mine)", "integrity: 'OK'"],
  ['M15 claims present still concluded NO_RESERVATION', 'if (mine.length === 0) final = stamp(', 'if (true) final = stamp('],
  ['M16 insert readback absence treated as mine', "if (!l.rec) return 'notApplied';           // the faulted op is complete (A4) and absent (A3)", "if (!l.rec) return 'mine';"],
  ['M17 insert readback ignores writer identity', "return same(l.rec.value, value) ? 'mine' : 'taken';", "return 'mine';"],
  ['M18 CAS readback ignores value (version only)', "if (l.rec && l.rec.version === version + 1 && same(l.rec.value, value)) return 'ok';", "if (l.rec && l.rec.version === version + 1) return 'ok';"],
  ['M19 write nonces dropped (A13 not used)', "const stamp = v => ({ ...v, w: nonce() });", 'const stamp = v => ({ ...v });'],
  ['M20 owner cancel restricted to non-FINALIZED', "if (c.state === 'CANCELLED') return { ok: true, state: 'CANCELLED' };", "if (c.state === 'CANCELLED') return { ok: true, state: 'CANCELLED' };\n      if (c.state === 'FINALIZED') return { ok: false, code: 'FINALIZED' };"],
  ['M21 sweep before the deadline', "if (l.rec.value.state !== 'FENCED' && now() < l.rec.value.deadline) return { conclusion: 'NOT_DUE' };", ''],
  ['M22 sweep resurrects (finalizes fully reserved ACTIVE)', "if (l.rec.value.state !== 'FENCED' && now() < l.rec.value.deadline) return { conclusion: 'NOT_DUE' };", "if (l.rec.value.state !== 'FENCED' && now() < l.rec.value.deadline) return { conclusion: 'NOT_DUE' };\n    if (l.rec.value.state === 'ACTIVE' && l.rec.value.entries.every(e => e.state === 'RESERVED')) { await casExact('checkout', checkoutId, l.rec.version, stamp({ ...l.rec.value, state: 'FINALIZED' })); return { conclusion: 'FINALIZED' }; }"],
  ['M23 claim unknown -> try next unit (queued next op after uncertainty)', "if (r === 'late' || r === 'fenced' || r === 'unknown') return { r };", "if (r === 'late' || r === 'fenced') return { r };\n      if (r === 'unknown') continue;"],
  ['M24 executor continues to next entry after NO_CAPACITY', "if (c.r !== 'mine') return stop(", "if (c.r === 'full') break;\n          if (c.r !== 'mine') return stop("],
  ['M25 invoice published by re-read version (not chained)', "const w = await casExact('checkout', checkoutId, ctx.version, stamp({ ...ctx.current, invoice: { number: n } }));", "const cur = await read('checkout', checkoutId); const w = cur.rec ? await casExact('checkout', checkoutId, cur.rec.version, stamp({ ...cur.rec.value, invoice: { number: n } })) : 'unknown';"],
  ['M26 owner-row real-date validation removed', "v.nights.every(realDay)", "v.nights.every(n => DAY.test(n))"],
  ['M27 invalid owner rows ignored instead of fail closed', "if (!validOwnerRow(r.value)) return null;                // fail closed, never guess", 'if (!validOwnerRow(r.value)) continue;'],
  ['M28 cap 4 -> 5', 'const GUEST_ROOM_CAP = 4;', 'const GUEST_ROOM_CAP = 5;'],
  ['M29 missing occupancy not rejected', "if (!('occupancy' in e)) return 'OCCUPANCY_MISSING';", ''],
  ['M30 dispatch conflict treated as dispatched', "if (d !== 'ok') return stop(ctx, d === 'late'", "if (d !== 'ok' && d !== 'conflict') return stop(ctx, d === 'late'"],
  ['M31 A9 predicate ignores epoch', "c.state === 'ACTIVE' && c.epoch === epoch &&", "c.state === 'ACTIVE' &&"],
  ['M32 A9 predicate ignores entry DISPATCHED', "&& c.entries[i] && c.entries[i].state === 'DISPATCHED'", ''],
  ['M33 input not detached', "try { snap = JSON.parse(JSON.stringify(input)); }", 'try { snap = input; JSON.stringify(input); }'],
  ['M34 deadline representability check removed', "if (!Number.isFinite(deadline) || !(deadline > t0)) return { ok: false, code: 'INVALID_DEADLINE' };", ''],
  ['M35 ADMISSION_UNKNOWN continues as winner', "if (a === 'unknown') return { ok: false, code: 'ADMISSION_UNKNOWN', checkoutId };", ''],
  ['M36 replay of a different snapshot reported as REPLAY', "code: sameSnap ? 'REPLAY' : 'QUOTE_BOUND_TO_OTHER_SNAPSHOT'", "code: 'REPLAY'"],
  ['M37 conclusion only sees canonical top-level checkoutId', "refersTo(s.value, checkoutId) || refersTo(s.key, checkoutId)", 's.value && s.value.checkoutId === checkoutId'],
  ['M38 status derives review from state (r3 conflation)', "reviewRequired: !!(c.review && c.review.required)", "reviewRequired: c.state === 'FENCED' || c.state === 'HOLD'"],
  ['N1 no default review obligation at admission', "review: { required: true, reason: 'OPEN' },", "review: { required: false, reason: 'OPEN' },"],
  ['N2 discharge folded into the final CAS (before confirmation)', "const fin = stamp({ ...ctx.current, state: 'FINALIZED' });", "const fin = stamp({ ...ctx.current, state: 'FINALIZED', review: { required: false, reason: 'CONFIRMED_SUCCESS' } });"],
  ['N4 zero-proof conclusion clears review', "state: 'ABANDONED', evidence: 'ZERO_PROVEN',", "state: 'ABANDONED', evidence: 'ZERO_PROVEN', review: { required: false, reason: 'ZERO' },"],
  ['N5 owner cancel clears review', "stamp({ ...c, state: 'CANCELLED', epoch: c.epoch + 1, cancelledFrom: c.state })", "stamp({ ...c, state: 'CANCELLED', epoch: c.epoch + 1, cancelledFrom: c.state, review: { required: false, reason: 'CANCELLED' } })"],
  ['N6 owner resolution allowed while executing', "if (c.state === 'ADMITTING' || c.state === 'ACTIVE') return { ok: false, code: 'STILL_EXECUTING', state: c.state };", ''],
  ['N7 owner resolution changes state', "stamp({ ...c, review: { required: false, reason: 'OWNER_RESOLVED', prior: c.review.reason } })", "stamp({ ...c, state: 'OWNER_RESOLVED', review: { required: false, reason: 'OWNER_RESOLVED', prior: c.review.reason } })"],
  ['N8 incomplete conclusion reported ZERO_PROVEN', "c.conclusion === 'HOLD' ? 'CLAIMS_PRESENT' : 'UNKNOWN';", "c.conclusion === 'HOLD' ? 'CLAIMS_PRESENT' : 'ZERO_PROVEN';"],
  ['N9 reference scan shallow only', "if (!v || typeof v !== 'object' || depth > 8) return false;", "if (!v || typeof v !== 'object' || depth > 0) return false;"],
  ['N10 set-level duplicate logical claim check removed', "if (logical.has(k)) return 'MISMATCH';", ''],
  ['N11 UNKNOWN_FINALIZATION response says no review', "reason: 'UNKNOWN_FINALIZATION', checkoutId, reservationEvidence: 'UNKNOWN', reviewRequired: true };", "reason: 'UNKNOWN_FINALIZATION', checkoutId, reservationEvidence: 'UNKNOWN', reviewRequired: false };"],
  ['N12 failed discharge reported as DISCHARGED', "else review = 'RETAINED';", "else review = 'DISCHARGED';"],
  ['N13 fence does not mark evidence UNKNOWN', "fence: { reason, from: c.state }, evidence: 'UNKNOWN' });", "fence: { reason, from: c.state } });"],
  ['M40 admission record without a writer nonce (explorer-found double-winner defect)', "      admission: nonce(), w: null", "      admission: 'fixed', w: null"],
  ['M39 privacy blocked after closure', "if (kind !== 'WITHDRAW_CONSENT' && kind !== 'PRIVACY_CLEAR') return { ok: false, code: 'INVALID_KIND' };", "if (kind !== 'WITHDRAW_CONSENT' && kind !== 'PRIVACY_CLEAR') return { ok: false, code: 'INVALID_KIND' };\n    { const l = await read('checkout', checkoutId); if (l.rec && l.rec.value.state !== 'ACTIVE') return { ok: false, code: 'CLOSED' }; }"]
];
function runNode(args, env) {
  const r = spawnSync(process.execPath, args, { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, signal: r.signal, err: r.error && r.error.code, text: (r.stdout || '') + (r.stderr || '') };
}
function suite(mutant) {
  const r = runNode([path.join(root, 'tests/r4/orchestrator.test.cjs')], { M0_R4_SRC: mutant });
  const g = re => { const m = r.text.match(re); return m ? Number(m[1]) : NaN; };
  const tests = g(/^# tests (\d+)/m), pass = g(/^# pass (\d+)/m), fail = g(/^# fail (\d+)/m), cancelled = g(/^# cancelled (\d+)/m);
  const valid = !r.err && r.signal == null && [tests, pass, fail].every(Number.isFinite) && tests > 0 && pass + fail + (cancelled || 0) === tests && !cancelled && (r.status === 0) === (fail === 0);
  return { valid, fail, tests, status: r.status, fails: (r.text.match(/^not ok \d+ - .*/gm) || []).map(s => s.replace(/^not ok \d+ - /, '').slice(0, 55)) };
}
function explorer(mutant) {
  const r = runNode([path.join(root, 'tests/r4/explorer.cjs'), '--depth3=300', '--d2=s1'], { M0_R4_SRC: mutant });
  const m = r.text.match(/"failureCount": (\d+)/), t = r.text.match(/"total": (\d+)/);
  const valid = !r.err && r.signal == null && !!m && !!t && (r.status === 0 || r.status === 1) && (r.status === 1) === (Number(m && m[1]) > 0);
  const first = (r.text.match(/"(INV\d+|EV\d+)[^"]*"/) || [''])[0].slice(0, 70);
  return { valid, failures: m ? Number(m[1]) : NaN, total: t ? Number(t[1]) : NaN, status: r.status, first };
}
const out = [], summary = { CAUGHT: 0, 'NOT DISTINGUISHED': 0, INVALID_EXECUTION: 0, ANCHOR: 0, caughtByExplorerOnly: 0, caughtBySuiteOnly: 0 };
if (process.env.ANCHORS) { for (const [n, a] of M) { const c = original.split(a).length - 1; if (c !== 1) console.log('ANCHOR', c, n); } console.log('catalog', M.length); process.exit(0); }
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
for (const [name, a, b] of M) {
  if (only && !only.has(name.split(' ')[0])) continue;
  const n = original.split(a).length - 1;
  if (n !== 1) { out.push(`${name}: ANCHOR ${n} (not applied)`); summary.ANCHOR++; continue; }
  const file = path.join(root, 'src/r4/.mutant.cjs');
  fs.writeFileSync(file, original.replace(a, b));
  let s, x;
  try { s = suite(file); x = explorer(file); } finally { fs.unlinkSync(file); }
  let cls;
  if (!s.valid || !x.valid) cls = 'INVALID_EXECUTION';
  else if (s.fail > 0 || x.failures > 0) cls = 'CAUGHT';
  else cls = 'NOT DISTINGUISHED';
  summary[cls]++;
  if (cls === 'CAUGHT' && s.fail === 0) summary.caughtByExplorerOnly++;
  if (cls === 'CAUGHT' && x.failures === 0) summary.caughtBySuiteOnly++;
  out.push(`${name}: ${cls} [suite rc=${s.status} tests=${s.tests} fail=${s.fail}${s.fails.length ? ' e.g. ' + s.fails.slice(0, 2).join(' | ') : ''}] [explorer rc=${x.status} schedules=${x.total} invariantFailures=${x.failures}${x.first ? ' e.g. ' + x.first : ''}]`);
  console.error(out[out.length - 1]);
}
{ // crash self-check
  const file = path.join(root, 'src/r4/.mutant.cjs');
  fs.writeFileSync(file, "throw new Error('deliberate crash');");
  const s = suite(file), x = explorer(file); fs.unlinkSync(file);
  out.push(`SELF-CHECK crash mutant: ${!s.valid && !x.valid ? 'INVALID_EXECUTION (ok)' : 'MISCLASSIFIED'}`);
}
if (sha(fs.readFileSync(src, 'utf8')) !== sha(original)) throw new Error('SOURCE MODIFIED');
out.push('SUMMARY ' + JSON.stringify(summary) + ' total=' + M.length + ' source_sha256=' + sha(original));
console.log(out.join('\n'));
