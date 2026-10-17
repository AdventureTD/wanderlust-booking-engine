'use strict';
// M0 r4 ORIGINAL-CHECKOUT ORCHESTRATION CONTRACT: a pure, CONDITIONAL model (no Wix, no
// network, no providers, no sends). r4 = r3 plus the review-obligation correction (B1/B2):
//  - reservation EVIDENCE (ZERO_PROVEN | CLAIMS_PRESENT | UNKNOWN) and owner REVIEW obligation
//    are orthogonal.
//  - The review obligation is created WITH the admission record (default required). It is
//    discharged ONLY by (a) a discharge CAS that the executor issues strictly AFTER its own
//    confirmed L-FINAL, or (b) explicit owner resolution. Because the discharge is only ever
//    written after a confirmed success, an applied-but-unacknowledged discharge is truthful,
//    and an unapplied one leaves the conservative default (a disclosed false positive).
//  - No best-effort review-marker write is relied upon.
// Design: R3-DESIGN-PROPOSAL (72d4edfc), R3-GUARANTEE-LP-TABLE (2ef8d8b2) and the parent's
// six clarifications. Guarantees hold only under the explicit store capabilities
// A1-A4, A8, A9, A11 and A12 (src/r3/modelStoreR3.cjs), which are UNPROVEN for Wix.
// If an adapter cannot provide them: stop/redesign, never bypass.
//
// Authority model (clarifications 1 and 5):
//  - Room-work authority exists ONLY inside the single checkout() invocation that itself
//    confirmed the dispatch LP. It lives in local variables and is never persisted.
//  - A persisted epoch or executor label is NOT a resume token.
//  - Durable RESERVED is evidence, never authority. Certification is local: an exact
//    confirmed settle within this uninterrupted invocation.
//  - Once the invocation declares UNKNOWN or ends, no later reader can resurrect authority.
// No API sends anything. finalConfirmed is an observational fact only (clarification 4).

const GUEST_ROOM_CAP = 4;
const ALLOCATION_ATTEMPTS = 8;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CHECKOUT_FIELDS = ['entries'];
const ENTRY_FIELDS = ['occupancy', 'quantity', 'roomCode'];
const QUOTE_FIELDS = ['checkIn', 'checkOut', 'entries', 'expiresAt', 'packageId', 'quoteId', 'totalCents'];
const QUOTE_ENTRY_FIELDS = ['occupancy', 'pricePerRoomCents', 'quantity', 'roomCode'];
const CONCLUDED = new Set(['FINALIZED', 'HOLD', 'ABANDONED', 'CANCELLED']);

const posInt = v => Number.isSafeInteger(v) && v > 0;
const nonNegInt = v => Number.isSafeInteger(v) && v >= 0;
const plainKeys = o => (o && typeof o === 'object' && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype) ? Object.keys(o).sort() : null;
const sameKeys = (o, keys) => { const k = plainKeys(o); return !!k && k.join(',') === keys.join(','); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canonInt = s => typeof s === 'string' && /^(0|[1-9]\d*)$/.test(s);
function deepFreeze(o) { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }
function realDay(s) {
  if (typeof s !== 'string' || !DAY.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
function nightsOf(checkIn, checkOut) {
  if (!realDay(checkIn) || !realDay(checkOut)) return null;
  const a = Date.parse(checkIn + 'T00:00:00Z'), b = Date.parse(checkOut + 'T00:00:00Z');
  if (b <= a) return null;
  const out = [];
  for (let t = a; t < b; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out.length <= 60 ? out : null;
}

function createCheckoutOrchestrator(config) {
  if (!config || typeof config !== 'object') throw new Error('CONFIG_INVALID');
  const { store, clock, checkoutDurationMs, inventory, newId, newWriteNonce, nextBookingNumber, nextInvoiceNumber } = config;
  const trace = typeof config.trace === 'function' ? config.trace : () => {};
  // Required, finite, positive; deliberately NO default or production value.
  if (typeof checkoutDurationMs !== 'number' || !Number.isFinite(checkoutDurationMs) || checkoutDurationMs <= 0) throw new Error('CONFIG_INVALID: checkoutDurationMs');
  if (!store || !clock || typeof clock.now !== 'function' || typeof newId !== 'function' || typeof newWriteNonce !== 'function' || typeof nextBookingNumber !== 'function' || typeof nextInvoiceNumber !== 'function') throw new Error('CONFIG_INVALID');
  if (!inventory || typeof inventory !== 'object') throw new Error('CONFIG_INVALID: inventory');
  for (const [code, r] of Object.entries(inventory)) {
    if (!ID_RE.test(code) || !r || !posInt(r.units) || !posInt(r.minOccupancy) || !posInt(r.maxOccupancy) || r.minOccupancy > r.maxOccupancy) throw new Error('CONFIG_INVALID: inventory ' + code);
  }
  const now = () => { const t = clock.now(); if (!Number.isFinite(t)) throw new Error('CLOCK_INVALID'); return t; };
  const label = () => { const v = newId(); if (typeof v !== 'string' || !ID_RE.test(v)) throw new Error('ID_INVALID'); return v; };
  // A13 (REQUIRED, UNPROVEN): write nonces are unique across ALL invocations, processes and restarts.
  // Every write carries one, so an exact readback identifies THIS writer's write, never an identical
  // value written by a concurrent duplicate invocation.
  const nonce = () => { const v = newWriteNonce(); if (typeof v !== 'string' || !ID_RE.test(v)) throw new Error('NONCE_INVALID'); return v; };
  const stamp = v => ({ ...v, w: nonce() });

  // ---------- validation (pure, on the detached snapshot) ----------
  function validate(cart, quote, t) {
    if (!sameKeys(cart, CHECKOUT_FIELDS) || !Array.isArray(cart.entries) || cart.entries.length === 0) return 'INVALID_CART';
    let rooms = 0;
    for (const e of cart.entries) {
      const k = plainKeys(e);
      if (!k) return 'INVALID_CART';
      if (!('occupancy' in e)) return 'OCCUPANCY_MISSING';                 // D5: never substitute quantity
      if (k.join(',') !== ENTRY_FIELDS.join(',')) return 'UNEXPECTED_FIELD';
      if (typeof e.roomCode !== 'string' || !Object.prototype.hasOwnProperty.call(inventory, e.roomCode)) return 'UNKNOWN_ROOM';
      if (!posInt(e.quantity)) return 'INVALID_QUANTITY';
      const r = inventory[e.roomCode];
      if (!posInt(e.occupancy) || e.occupancy < r.minOccupancy || e.occupancy > r.maxOccupancy) return 'INVALID_OCCUPANCY';
      rooms += e.quantity;
    }
    if (rooms > GUEST_ROOM_CAP) return 'CAP_EXCEEDED';                        // physical rooms
    if (!sameKeys(quote, QUOTE_FIELDS) || !Array.isArray(quote.entries)) return 'INVALID_QUOTE';
    if (typeof quote.quoteId !== 'string' || !ID_RE.test(quote.quoteId) || typeof quote.packageId !== 'string' || !quote.packageId) return 'INVALID_QUOTE';
    if (!Number.isFinite(quote.expiresAt)) return 'INVALID_QUOTE';
    if (!(t < quote.expiresAt)) return 'QUOTE_EXPIRED';
    if (!nightsOf(quote.checkIn, quote.checkOut)) return 'INVALID_QUOTE';
    if (quote.entries.length !== cart.entries.length) return 'QUOTE_MISMATCH';
    let total = 0;
    for (let i = 0; i < quote.entries.length; i++) {
      const q = quote.entries[i], e = cart.entries[i];
      if (!sameKeys(q, QUOTE_ENTRY_FIELDS) || !nonNegInt(q.pricePerRoomCents)) return 'INVALID_QUOTE';
      if (q.roomCode !== e.roomCode || q.quantity !== e.quantity || q.occupancy !== e.occupancy) return 'QUOTE_MISMATCH';
      total += q.pricePerRoomCents * q.quantity;
      if (!Number.isSafeInteger(total)) return 'QUOTE_MISMATCH';
    }
    if (!nonNegInt(quote.totalCents) || total !== quote.totalCents) return 'QUOTE_MISMATCH';
    return null;
  }

  // ---------- store helpers ----------
  async function read(ns, key) { try { return { rec: await store.get(ns, key) }; } catch (_) { return { err: 'READ_FAILED' }; } }
  // Insert with exact readback after a fault: 'mine' | 'taken' | 'late' | 'fenced' | 'notApplied' | 'unknown'
  async function insertExact(ns, key, value, cond) {
    let r;
    try { r = await store.insertUnique(ns, key, value, cond); } catch (_) { r = 'fault'; }
    if (r === 'inserted') return 'mine';
    if (r === 'duplicate') return 'taken';
    if (r === 'late' || r === 'fenced') return r;
    const l = await read(ns, key);
    if (l.err) return 'unknown';
    if (!l.rec) return 'notApplied';           // the faulted op is complete (A4) and absent (A3)
    return same(l.rec.value, value) ? 'mine' : 'taken';
  }
  // CAS with exact readback: 'ok' | 'conflict' | 'late' | 'notApplied' | 'unknown'
  async function casExact(ns, key, version, value, cond) {
    let r;
    try { r = await store.casUpdate(ns, key, version, value, cond); } catch (_) { r = 'fault'; }
    if (r === 'ok' || r === 'conflict' || r === 'late') return r;
    const l = await read(ns, key);
    if (l.err) return 'unknown';
    if (l.rec && l.rec.version === version + 1 && same(l.rec.value, value)) return 'ok';
    if (l.rec && l.rec.version === version) return 'notApplied';
    return 'conflict';
  }
  // A12: complete enumeration from one snapshot; null if any page fails or the snapshot is too old.
  async function enumerateAll(ns, minSeq) {
    const items = []; let cursor = null, asOf = null;
    do {
      let page;
      try { page = await store.listPage(ns, cursor); } catch (_) { return null; }
      if (asOf === null) asOf = page.asOf; else if (page.asOf !== asOf) return null;
      items.push(...page.items);
      cursor = page.next;
    } while (cursor);
    if (minSeq !== undefined && !(asOf >= minSeq)) return null;
    return { items, asOf };
  }

  // ---------- owner rows (A6': normalized, validated, read-only) ----------
  function validOwnerRow(v) {
    return sameKeys(v, ['nights', 'roomCode', 'rooms']) && typeof v.roomCode === 'string' && Object.prototype.hasOwnProperty.call(inventory, v.roomCode) &&
      Array.isArray(v.nights) && v.nights.length > 0 && v.nights.every(realDay) && posInt(v.rooms);
  }
  async function ownerCount(roomCode, night) {
    const all = await enumerateAll('owner');
    if (!all) return null;
    let n = 0;
    for (const r of all.items) {
      if (!validOwnerRow(r.value)) return null;                // fail closed, never guess
      if (r.value.roomCode === roomCode && r.value.nights.includes(night)) n += r.value.rooms;
    }
    return n;
  }

  // ---------- claims (A9 + A8) ----------
  const slotKey = (roomCode, night, u) => roomCode + '|' + night + '|' + u;
  function claimGuard(checkoutId, epoch, i) {
    return { ns: 'checkout', key: checkoutId, pred: c => c.state === 'ACTIVE' && c.epoch === epoch && c.entries[i] && c.entries[i].state === 'DISPATCHED' };
  }
  // 'mine' (with key) | 'full' | 'late' | 'fenced' | 'unknown'
  async function claimRoomNight(ctx, i, q, night) {
    const roomCode = ctx.snapshot.cart.entries[i].roomCode;
    const owners = await ownerCount(roomCode, night);
    if (owners === null) return { r: 'unknown', why: 'OWNER_ROWS_UNREADABLE' };
    const usable = inventory[roomCode].units - owners;
    const value = { checkoutId: ctx.checkoutId, entryIndex: i, night, ordinal: q, x: ctx.admission };
    for (let u = 0, retries = 0; u < usable; u++) {
      const key = slotKey(roomCode, night, u);
      trace({ ev: 'claimAttempt', checkoutId: ctx.checkoutId, i, key });
      const r = await insertExact('slot', key, value, { notAfter: ctx.deadline, guard: claimGuard(ctx.checkoutId, ctx.epoch, i) });
      if (r === 'mine') return { r: 'mine', key };
      if (r === 'late' || r === 'fenced' || r === 'unknown') return { r };
      if (r === 'notApplied' && retries++ < 2) { u--; continue; }
      if (r === 'notApplied') return { r: 'unknown' };
    }
    return { r: 'full' };
  }

  // ---------- the single orchestration (Option B) ----------
  async function checkout(input) {
    let snap;
    try { snap = JSON.parse(JSON.stringify(input)); } catch (_) { return { ok: false, code: 'INVALID_REQUEST' }; }
    const t0 = now();
    if (!sameKeys(snap, ['cart', 'quote'])) return { ok: false, code: 'INVALID_REQUEST' };
    const bad = validate(snap.cart, snap.quote, t0);
    if (bad) return { ok: false, code: bad };
    deepFreeze(snap);
    const deadline = t0 + checkoutDurationMs;
    if (!Number.isFinite(deadline) || !(deadline > t0)) return { ok: false, code: 'INVALID_DEADLINE' };
    const checkoutId = 'co_' + snap.quote.quoteId;               // clarification 6: one canonical id per quoteId
    const nights = nightsOf(snap.quote.checkIn, snap.quote.checkOut);
    const record = {
      checkoutId, state: 'ADMITTING', epoch: 0, bookingNumber: null, deadline, snapshot: snap, nights,
      entries: snap.cart.entries.map(() => ({ state: 'PENDING', evidence: null })),
      invoice: null, fence: null, conclusion: null, evidence: null,
      review: { required: true, reason: 'OPEN' },              // default obligation from admission
      admission: nonce(), w: null
    };
    // L-ADMIT (A1 + A8): binds quoteId -> checkoutId + immutable snapshot, permanently.
    const a = await insertExact('checkout', checkoutId, record, { notAfter: snap.quote.expiresAt });
    if (a === 'late') return { ok: false, code: 'QUOTE_EXPIRED' };
    if (a === 'taken') return replay(checkoutId, snap);
    if (a === 'notApplied') return { ok: false, code: 'UNAVAILABLE' };
    if (a === 'unknown') return { ok: false, code: 'ADMISSION_UNKNOWN', checkoutId };
    const ctx = { checkoutId, snapshot: snap, deadline, epoch: 1, version: 1, admission: record.admission };
    trace({ ev: 'admitted', checkoutId });

    // Booking-number identity (unique, ACK-loss readback).
    let bookingNumber = null;
    for (let k = 0; k < ALLOCATION_ATTEMPTS && !bookingNumber; k++) {
      const n = String(nextBookingNumber());
      const r = await insertExact('bn', n, { checkoutId, x: record.admission });
      if (r === 'mine') bookingNumber = n;
      else if (r === 'unknown') return stop(ctx, 'ALLOCATION_UNKNOWN');
    }
    if (!bookingNumber) return stop(ctx, 'ALLOCATION_EXHAUSTED');

    // L-DISPATCH (A2 + A8): one CAS for all entries; the confirming invocation alone holds authority.
    const dispatched = stamp({ ...record, state: 'ACTIVE', epoch: 1, bookingNumber, entries: record.entries.map(() => ({ state: 'DISPATCHED', evidence: null })) });
    let d;
    for (let k = 0; k < 3; k++) { d = await casExact('checkout', checkoutId, 1, dispatched, { notAfter: deadline }); if (d !== 'notApplied') break; }
    if (d !== 'ok') return stop(ctx, d === 'late' ? 'DEADLINE' : d === 'conflict' ? 'FENCED_BY_OTHER' : 'DISPATCH_' + d.toUpperCase());
    ctx.version = 2; ctx.current = dispatched;
    trace({ ev: 'dispatched', checkoutId });

    const certified = [];                                        // LOCAL authority only (clarification 1)
    for (let i = 0; i < snap.cart.entries.length; i++) {
      const e = snap.cart.entries[i], evidence = [];
      for (let q = 0; q < e.quantity; q++) {
        for (const night of nights) {
          const c = await claimRoomNight(ctx, i, q, night);
          if (c.r !== 'mine') return stop(ctx, { full: 'NO_CAPACITY', late: 'DEADLINE', fenced: 'FENCED_BY_OTHER', unknown: 'CLAIM_UNKNOWN' }[c.r]);
          evidence.push(c.key);
        }
      }
      // L-SETTLE: durable RESERVED evidence (never authority), chained on the confirmed version.
      const next = stamp({ ...ctx.current, entries: ctx.current.entries.map((x, j) => j === i ? { state: 'RESERVED', evidence } : x) });
      const s = await casExact('checkout', checkoutId, ctx.version, next, { notAfter: deadline });
      if (s !== 'ok') return stop(ctx, s === 'late' ? 'DEADLINE' : s === 'conflict' ? 'FENCED_BY_OTHER' : 'SETTLE_' + s.toUpperCase());
      ctx.version += 1; ctx.current = next; certified[i] = true;
      trace({ ev: 'certified', checkoutId, i });
    }
    // L-FINAL: only after every LOCAL certification in this uninterrupted invocation.
    if (!snap.cart.entries.every((_, i) => certified[i] === true)) return stop(ctx, 'NOT_CERTIFIED');
    const fin = stamp({ ...ctx.current, state: 'FINALIZED' });
    const f = await casExact('checkout', checkoutId, ctx.version, fin, { notAfter: deadline });
    if (f !== 'ok') {
      if (f === 'unknown') {
        // Finalization uncertainty: never emit finalConfirmed. The review obligation is already
        // durable (default since admission) and nothing here can discharge it. Durable ACTIVE is
        // fenced/concluded best-effort; durable FINALIZED keeps its open obligation.
        trace({ ev: 'stop', checkoutId, reason: 'UNKNOWN_FINALIZATION' });
        const l = await read('checkout', checkoutId);
        if (!l.err && l.rec && l.rec.value.state === 'ACTIVE') await conclude(checkoutId, 'EXECUTOR_STOP:UNKNOWN_FINALIZATION');
        return { ok: false, code: 'REVIEW_REQUIRED', reason: 'UNKNOWN_FINALIZATION', checkoutId, reservationEvidence: 'UNKNOWN', reviewRequired: true };
      }
      return stop(ctx, f === 'late' ? 'DEADLINE' : f === 'conflict' ? 'FENCED_BY_OTHER' : 'FINAL_NOT_APPLIED');
    }
    ctx.version += 1; ctx.current = fin;
    trace({ ev: 'finalConfirmed', checkoutId });
    // Discharge of the default review obligation: ONLY after the confirmed L-FINAL above.
    const dis = stamp({ ...fin, review: { required: false, reason: 'CONFIRMED_SUCCESS' } });
    const dr = await casExact('checkout', checkoutId, ctx.version, dis);
    let review;
    if (dr === 'ok') { ctx.version += 1; ctx.current = dis; review = 'DISCHARGED'; trace({ ev: 'discharged', checkoutId }); }
    else review = 'RETAINED';             // conservative: owner review stays open (disclosed false positive)
    if (review !== 'DISCHARGED') return { ok: true, state: 'FINALIZED', checkoutId, bookingNumber, finalConfirmed: true, reviewRequired: true, review, invoice: { state: 'NOT_ATTEMPTED' } };
    // Invoice IDENTITY only (not a send). In-line, chained; never retried by other actors.
    let invoice = { state: 'NOT_PUBLISHED' };
    for (let k = 0; k < ALLOCATION_ATTEMPTS; k++) {
      const n = String(nextInvoiceNumber());
      const r = await insertExact('inv', n, { checkoutId, x: record.admission });
      if (r === 'taken' || r === 'notApplied') continue;
      if (r !== 'mine') { invoice = { state: 'UNKNOWN' }; break; }
      const w = await casExact('checkout', checkoutId, ctx.version, stamp({ ...ctx.current, invoice: { number: n } }));
      invoice = w === 'ok' ? { state: 'PUBLISHED', number: n } : { state: w === 'unknown' ? 'UNKNOWN' : 'NOT_PUBLISHED', allocated: n };
      break;
    }
    return { ok: true, state: 'FINALIZED', checkoutId, bookingNumber, finalConfirmed: true, reviewRequired: false, review, invoice };
  }

  async function stop(ctx, reason) {
    trace({ ev: 'stop', checkoutId: ctx.checkoutId, reason });
    const c = await conclude(ctx.checkoutId, 'EXECUTOR_STOP:' + reason);
    const reservationEvidence = c.conclusion === 'NO_RESERVATION' ? 'ZERO_PROVEN' : c.conclusion === 'HOLD' ? 'CLAIMS_PRESENT' : 'UNKNOWN';
    return { ok: false, code: reason, checkoutId: ctx.checkoutId, ...c, reservationEvidence, reviewRequired: true };
  }
  async function replay(checkoutId, snap) {
    const l = await read('checkout', checkoutId);
    if (l.err || !l.rec) return { ok: false, code: 'REPLAY_UNKNOWN', checkoutId };
    const sameSnap = same(l.rec.value.snapshot, snap);
    return { ok: false, code: sameSnap ? 'REPLAY' : 'QUOTE_BOUND_TO_OTHER_SNAPSHOT', checkoutId, status: summarize(l.rec.value) };
  }

  // ---------- fence + zero-proof conclusion (clarifications 2 and 3) ----------
  // A terminal fence is NOT no-reservation evidence. NO_RESERVATION requires the confirmed fence
  // plus a COMPLETE enumeration with asOf >= the fence seq showing zero claims. Any claim means
  // HOLD (preserved). Any read/write failure means REVIEW_REQUIRED (FENCED persists).
  async function conclude(checkoutId, reason) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const l = await read('checkout', checkoutId);
      if (l.err) return { conclusion: 'REVIEW_REQUIRED', why: 'READ_FAILED' };
      if (!l.rec) return { conclusion: 'UNKNOWN_CHECKOUT' };
      let c = l.rec.value, version = l.rec.version, fenceSeq = l.rec.seq;
      if (CONCLUDED.has(c.state)) return { conclusion: c.state };
      if (c.state !== 'FENCED') {
        const fenced = stamp({ ...c, state: 'FENCED', epoch: c.epoch + 1, fence: { reason, from: c.state }, evidence: 'UNKNOWN' });
        const r = await casExact('checkout', checkoutId, version, fenced);
        if (r === 'conflict' || r === 'notApplied') continue;
        if (r !== 'ok') return { conclusion: 'REVIEW_REQUIRED', why: 'FENCE_UNCONFIRMED' };
        const back = await read('checkout', checkoutId);
        if (back.err || !back.rec || back.rec.version !== version + 1) return { conclusion: 'REVIEW_REQUIRED', why: 'FENCE_SEQ_UNKNOWN' };
        c = fenced; version += 1; fenceSeq = back.rec.seq;
      }
      const all = await enumerateAll('slot', fenceSeq);
      if (!all) return { conclusion: 'REVIEW_REQUIRED', why: 'ENUMERATION_INCOMPLETE' };
      const mine = all.items.filter(s => refersTo(s.value, checkoutId) || refersTo(s.key, checkoutId));   // any record naming this checkout at ANY depth (bounded defence)
      let final;
      if (mine.length === 0) final = stamp({ ...c, state: 'ABANDONED', evidence: 'ZERO_PROVEN', conclusion: { kind: 'NO_RESERVATION', fenceSeq, asOf: all.asOf } });   // review obligation untouched
      else final = stamp({ ...c, state: 'HOLD', evidence: 'CLAIMS_PRESENT', conclusion: { kind: 'HOLD', claims: mine.map(s => s.key).sort(), integrity: setIntegrity(c, mine), asOf: all.asOf } });
      const w = await casExact('checkout', checkoutId, version, final);
      if (w === 'ok') return { conclusion: final.state === 'ABANDONED' ? 'NO_RESERVATION' : 'HOLD' };
      if (w === 'conflict' || w === 'notApplied') continue;
      return { conclusion: 'REVIEW_REQUIRED', why: 'CONCLUSION_UNCONFIRMED' };
    }
    return { conclusion: 'REVIEW_REQUIRED', why: 'CONTENDED' };
  }
  function refersTo(v, id, depth = 0) {
    if (v === id) return true;
    if (typeof v === 'string') return v.split(/[|#]/).includes(id);
    if (!v || typeof v !== 'object' || depth > 8) return false;
    return Object.values(v).some(x => refersTo(x, id, depth + 1));
  }
  // Row canonicality AND set-level uniqueness of logical claims (entry, ordinal, night).
  function setIntegrity(c, rows) {
    const logical = new Set();
    for (const s of rows) {
      if (!canonicalClaim(c, s)) return 'MISMATCH';
      const k = s.value.entryIndex + '#' + s.value.ordinal + '#' + s.value.night;
      if (logical.has(k)) return 'MISMATCH';
      logical.add(k);
    }
    return 'OK';
  }
  function canonicalClaim(c, s) {
    const v = s.value;
    if (!sameKeys(v, ['checkoutId', 'entryIndex', 'night', 'ordinal', 'x']) || v.checkoutId !== c.checkoutId || v.x !== c.admission) return false;
    if (!Number.isSafeInteger(v.entryIndex) || v.entryIndex < 0 || v.entryIndex >= c.snapshot.cart.entries.length) return false;
    const e = c.snapshot.cart.entries[v.entryIndex];
    if (!Number.isSafeInteger(v.ordinal) || v.ordinal < 0 || v.ordinal >= e.quantity || !c.nights.includes(v.night)) return false;
    const parts = s.key.split('|');
    return parts.length === 3 && parts[0] === e.roomCode && parts[1] === v.night && canonInt(parts[2]) && Number(parts[2]) < inventory[e.roomCode].units;
  }

  // ---------- owner / system operations ----------
  async function ownerCancel(checkoutId) {     // allowed in ANY state, including FINALIZED (clarification 4)
    for (let attempt = 0; attempt < 6; attempt++) {
      const l = await read('checkout', checkoutId);
      if (l.err) return { ok: false, code: 'UNAVAILABLE' };
      if (!l.rec) return { ok: false, code: 'UNKNOWN_CHECKOUT' };
      const c = l.rec.value;
      if (c.state === 'CANCELLED') return { ok: true, state: 'CANCELLED' };
      const r = await casExact('checkout', checkoutId, l.rec.version, stamp({ ...c, state: 'CANCELLED', epoch: c.epoch + 1, cancelledFrom: c.state }));
      if (r === 'ok') return { ok: true, state: 'CANCELLED', from: c.state };
      if (r === 'unknown') return { ok: false, code: 'UNKNOWN' };
    }
    return { ok: false, code: 'UNAVAILABLE' };
  }
  const ownerFence = checkoutId => conclude(checkoutId, 'OWNER_TAKEOVER');   // takeover of a slow or crashed executor, at any time
  async function sweep(checkoutId) {          // never finalizes, never sends, never resurrects
    const l = await read('checkout', checkoutId);
    if (l.err) return { conclusion: 'REVIEW_REQUIRED', why: 'READ_FAILED' };
    if (!l.rec) return { conclusion: 'UNKNOWN_CHECKOUT' };
    if (CONCLUDED.has(l.rec.value.state)) return { conclusion: l.rec.value.state };
    if (l.rec.value.state !== 'FENCED' && now() < l.rec.value.deadline) return { conclusion: 'NOT_DUE' };
    return conclude(checkoutId, 'SWEEP');
  }
  // Explicit owner resolution of the REVIEW obligation only. It never changes state, epoch
  // semantics of room work, claims, price, certification, finalization, sends or cancellation.
  // Not allowed while the checkout may still be executing (ADMITTING/ACTIVE): fence first.
  async function ownerResolveReview(checkoutId) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const l = await read('checkout', checkoutId);
      if (l.err || !l.rec) return { ok: false, code: l.err || 'UNKNOWN_CHECKOUT' };
      const c = l.rec.value;
      if (c.state === 'ADMITTING' || c.state === 'ACTIVE') return { ok: false, code: 'STILL_EXECUTING', state: c.state };
      if (!c.review || !c.review.required) return { ok: true, state: c.state, review: 'NOT_REQUIRED' };
      const r = await casExact('checkout', checkoutId, l.rec.version, stamp({ ...c, review: { required: false, reason: 'OWNER_RESOLVED', prior: c.review.reason } }));
      if (r === 'ok') return { ok: true, state: c.state, review: 'OWNER_RESOLVED' };
      if (r === 'unknown') return { ok: false, code: 'UNKNOWN' };
    }
    return { ok: false, code: 'UNAVAILABLE' };
  }
  function summarize(c) {
    const reservationEvidence = c.evidence || (c.state === 'FINALIZED' ? 'CLAIMS_PRESENT' : 'UNKNOWN');
    return { state: c.state, bookingNumber: c.bookingNumber, entries: c.entries.map(e => e.state), conclusion: c.conclusion ? c.conclusion.kind : null, reservationEvidence, reviewRequired: !!(c.review && c.review.required), reviewReason: c.review ? c.review.reason : null };
  }
  async function status(checkoutId) {          // read-only; carries NO authority
    const l = await read('checkout', checkoutId);
    if (l.err) return { code: 'UNAVAILABLE' };
    if (!l.rec) return { code: 'UNKNOWN_CHECKOUT' };
    return summarize(l.rec.value);
  }
  async function privacyRequest(checkoutId, kind) {   // never blocked by any lifecycle state; record only
    if (kind !== 'WITHDRAW_CONSENT' && kind !== 'PRIVACY_CLEAR') return { ok: false, code: 'INVALID_KIND' };
    const id = String(checkoutId).replace(/[^A-Za-z0-9_-]/g, '_') + '-' + kind + '-' + label();
    const r = await insertExact('privacy', id, { checkoutId: String(checkoutId), kind, w: nonce() });
    return r === 'mine' ? { ok: true, requestId: id } : { ok: false, code: 'UNKNOWN' };
  }

  return { checkout, ownerCancel, ownerFence, sweep, ownerResolveReview, status, privacyRequest, GUEST_ROOM_CAP };
}
module.exports = { createCheckoutOrchestrator, GUEST_ROOM_CAP, nightsOf, realDay };
