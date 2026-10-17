'use strict';
// M0 r4 adversarial tests (r3 suite adapted for the review-obligation API, plus r4 regressions) (single orchestration, conditional on A1-A4, A8, A9, A11, A12).
// MODEL ONLY: nothing here proves Wix behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const { env, order, E, claimsOf, tick, SYNTHETIC_DURATION_MS, T0, INVENTORY, GUEST_ROOM_CAP, createCheckoutOrchestrator, createStoreR3 } = require('./helpers.cjs');

const isCheckout = (id, pred = () => true) => i => i.ns === 'checkout' && i.key === id && pred(i);
const isDispatch = i => i.op === 'cas' && i.ns === 'checkout' && i.value && i.value.state === 'ACTIVE' && i.value.entries.every(e => e.state === 'DISPATCHED');
const isSettle = idx => i => i.op === 'cas' && i.ns === 'checkout' && i.value && i.value.state === 'ACTIVE' && i.value.entries[idx] && i.value.entries[idx].state === 'RESERVED' && (idx === 0 || i.value.entries[idx - 1].state === 'RESERVED') && (i.value.entries[idx + 1] === undefined || i.value.entries[idx + 1].state !== 'RESERVED');
const isFinal = i => i.op === 'cas' && i.ns === 'checkout' && i.value && i.value.state === 'FINALIZED' && !i.value.invoice;
const isFence = i => i.op === 'cas' && i.ns === 'checkout' && i.value && i.value.state === 'FENCED';
const allWritesFail = store => store.rule({ phase: 'before', match: i => i.op === 'cas' || i.op === 'insert', action: 'fail', once: false });

// ======================= configuration and validation =======================
test('config: checkout duration is required, finite and positive; no default', () => {
  const store = createStoreR3({ clock: { now: () => 0 } });
  const base = { store, clock: { now: () => 0 }, inventory: INVENTORY, newId: () => 'x', newWriteNonce: () => 'n', nextBookingNumber: () => 1, nextInvoiceNumber: () => 1 };
  for (const d of [undefined, 0, -1, NaN, Infinity, '1000', null]) assert.throws(() => createCheckoutOrchestrator({ ...base, checkoutDurationMs: d }), /CONFIG_INVALID/, String(d));
  assert.doesNotThrow(() => createCheckoutOrchestrator({ ...base, checkoutDurationMs: SYNTHETIC_DURATION_MS }));
  assert.equal(GUEST_ROOM_CAP, 4);
});
test('CAP 4 physical rooms; D5 occupancy required per entry; caller fields rejected; no writes on rejection', async () => {
  const { c, store } = env({ inventory: { A: { units: 9, minOccupancy: 1, maxOccupancy: 3 }, B: { units: 9, minOccupancy: 1, maxOccupancy: 3 } } });
  assert.equal((await c.checkout(order([E('A', 5, 1)]))).code, 'CAP_EXCEEDED');
  assert.equal((await c.checkout(order([E('A', 2, 1), E('B', 3, 1)]))).code, 'CAP_EXCEEDED');
  const o = order([E('A', 2, 2)]); delete o.cart.entries[0].occupancy;
  assert.equal((await c.checkout(o)).code, 'OCCUPANCY_MISSING');
  for (const occ of [0, 4, 1.5, '2', null]) assert.equal((await c.checkout(order([E('A', 1, occ)]))).code, 'INVALID_OCCUPANCY');
  const st = order([E('A', 1, 1)]); st.cart.entries[0].status = 'x';
  assert.equal((await c.checkout(st)).code, 'UNEXPECTED_FIELD');
  const m = order([E('A', 1, 1)]); m.quote.entries[0].roomCode = 'B';
  assert.equal((await c.checkout(m)).code, 'QUOTE_MISMATCH');
  const t = order([E('A', 1, 1)]); t.quote.totalCents = 1;
  assert.equal((await c.checkout(t)).code, 'QUOTE_MISMATCH');
  const bad = order([E('A', 1, 1)]); bad.quote.quoteId = 'Q|1';
  assert.equal((await c.checkout(bad)).code, 'INVALID_QUOTE');
  assert.deepEqual(store.applied, [], 'rejections write nothing');
  assert.equal((await c.checkout(order([E('A', 4, 1)]))).ok, true, 'exactly 4 rooms accepted');
});
test('F4: unrepresentable or non-advancing deadline rejected; non-finite clock throws', async () => {
  const mk = (t, d) => { const clock = { now: () => t }; const store = createStoreR3({ clock }); return { store, c: createCheckoutOrchestrator({ store, clock, checkoutDurationMs: d, inventory: INVENTORY, newId: () => 'i1', newWriteNonce: () => 'n1', nextBookingNumber: () => 1, nextInvoiceNumber: () => 1 }) }; };
  const o1 = order([E('A', 1, 1)]); o1.quote.expiresAt = 1.5e308;
  const x = mk(1e308, 1e308);
  assert.equal((await x.c.checkout(o1)).code, 'INVALID_DEADLINE'); assert.deepEqual(x.store.applied, []);
  assert.equal((await mk(T0, Number.MIN_VALUE).c.checkout(order([E('A', 1, 1)]))).code, 'INVALID_DEADLINE');
  const clock = { now: () => NaN }; const store = createStoreR3({ clock: { now: () => 0 } });
  const nan = createCheckoutOrchestrator({ store, clock, checkoutDurationMs: 1, inventory: INVENTORY, newId: () => 'i', newWriteNonce: () => 'n2', nextBookingNumber: () => 1, nextInvoiceNumber: () => 1 });
  await assert.rejects(nan.checkout(order([E('A', 1, 1)])), /CLOCK_INVALID/);
});
test('F1: caller mutation during the admission write cannot change the stored snapshot', async () => {
  const { c, store } = env();
  const input = order([E('A', 1, 1)], { prices: { A: 100 } });
  const g = store.gate('before', 'insert', 'checkout');
  const p = c.checkout(input);
  await g.reached;
  input.cart.entries[0].quantity = 4; input.quote.entries[0].quantity = 4; input.quote.entries[0].pricePerRoomCents = 1; input.quote.totalCents = 4;
  g.open();
  const r = await p;
  assert.equal(r.ok, true);
  const rec = store.peek('checkout', r.checkoutId);
  assert.equal(rec.snapshot.cart.entries[0].quantity, 1); assert.equal(rec.snapshot.quote.totalCents, 100);
  assert.equal(claimsOf(store, r.checkoutId).length, 2, '1 room x 2 nights');
});

// ======================= positive original checkout =======================
test('positive: multi-room mixed quantity/occupancy finalizes; evidence complete; invoice identity published (no send)', async () => {
  const { c, store, events } = env();
  const r = await c.checkout(order([E('A', 2, 2), E('B', 1, 4), E('A', 1, 1)]));
  assert.equal(r.ok, true); assert.equal(r.state, 'FINALIZED'); assert.equal(r.finalConfirmed, true);
  assert.deepEqual(r.invoice, { state: 'PUBLISHED', number: '5001' });
  assert.equal(claimsOf(store, r.checkoutId).length, 4 * 2);
  const rec = store.peek('checkout', r.checkoutId);
  assert.deepEqual(rec.entries.map(e => e.state), ['RESERVED', 'RESERVED', 'RESERVED']);
  assert.equal(rec.entries[0].evidence.length, 4);
  assert.equal(Object.keys(c).includes('send'), false); assert.ok(!Object.keys(c).some(k => /send|invoiceSend|dispatchInvoice/i.test(k)), 'no send API in M0');
  assert.equal(events.filter(e => e.ev === 'certified').length, 3);
});

// ======================= clarification 6: quoteId binding =======================
test('C6: replay of the same quote returns REPLAY; never a second executor or claim', async () => {
  const { c, store } = env();
  const o = order([E('A', 1, 1)]);
  const r1 = await c.checkout(o);
  const before = store.applied.length;
  const r2 = await c.checkout(o);
  assert.equal(r2.code, 'REPLAY'); assert.equal(r2.checkoutId, r1.checkoutId); assert.equal(r2.status.state, 'FINALIZED');
  assert.equal(store.applied.length, before, 'replay writes nothing');
});
test('C6: a different snapshot under a bound quoteId never alternates or resets the binding', async () => {
  const { c, store } = env();
  const o = order([E('A', 1, 1)], { quoteId: 'QB' });
  await c.checkout(o);
  const o2 = order([E('A', 2, 1)], { quoteId: 'QB' });
  const r = await c.checkout(o2);
  assert.equal(r.code, 'QUOTE_BOUND_TO_OTHER_SNAPSHOT');
  assert.equal(store.peek('checkout', 'co_QB').snapshot.cart.entries[0].quantity, 1);
  assert.equal(claimsOf(store, 'co_QB').length, 2);
});
test('C6: concurrent duplicate submissions -> exactly one executor, one booking number', async () => {
  const { c, store } = env();
  const o = order([E('A', 1, 1)]);
  const rs = await Promise.all([c.checkout(o), c.checkout(o), c.checkout(o)]);
  assert.equal(rs.filter(r => r.ok).length, 1); assert.equal(rs.filter(r => r.code === 'REPLAY').length, 2);
  assert.equal(store.keys('bn').length, 1); assert.equal(claimsOf(store, rs.find(r => r.ok).checkoutId).length, 2);
});
test('C6: admission ACK lost -> exact readback confirms the winner; ACK lost + read fail -> ADMISSION_UNKNOWN, later calls only REPLAY', async () => {
  { const { c, store } = env();
    store.rule({ phase: 'after', op: 'insert', ns: 'checkout', action: 'ackLost' });
    assert.equal((await c.checkout(order([E('A', 1, 1)]))).ok, true); }
  { const { c, store } = env();
    const o = order([E('A', 1, 1)]);
    store.rule({ phase: 'after', op: 'insert', ns: 'checkout', action: async () => { store.rule({ phase: 'before', op: 'get', ns: 'checkout', action: 'fail' }); return 'ackLost'; } });
    const r = await c.checkout(o);
    assert.equal(r.code, 'ADMISSION_UNKNOWN');
    assert.equal(store.peek('checkout', r.checkoutId).state, 'ADMITTING');
    assert.deepEqual(store.keys('bn'), [], 'uncertain invocation stopped before any further work');
    const again = await c.checkout(o);
    assert.equal(again.code, 'REPLAY', 'binding exists; never a new executor');
    assert.deepEqual(claimsOf(store, r.checkoutId), []);
    c; }
});
test('C5: process restart reusing the same executor/label ids gains no authority (persisted epoch is not a resume token)', async () => {
  const shared = { id: 0 };
  const e1 = env({ newId: () => 'same-id' });
  const o = order([E('A', 1, 1), E('B', 1, 1)]);
  const g = e1.store.gate('before', 'insert', 'slot');
  const p = e1.c.checkout(o);                               // original worker paused mid-claims
  await g.reached;
  // "restart": a new orchestrator over the same store with identical id generators
  const c2 = createCheckoutOrchestrator({ store: e1.store, clock: e1.clock, checkoutDurationMs: SYNTHETIC_DURATION_MS, inventory: INVENTORY, newId: () => 'same-id', newWriteNonce: (() => { let k = 0; return () => 'restart' + (++k); })(), nextBookingNumber: () => 1001, nextInvoiceNumber: () => 5001 });
  const r2 = await c2.checkout(o);
  assert.equal(r2.code, 'REPLAY');
  assert.deepEqual(e1.store.opLog.filter(i => i.op === 'insert' && i.ns === 'slot').length, 1, 'restart issued no claim');
  g.open(); await p; void shared;
});

// ======================= clarifications 1 and 5: monotonic uncertainty =======================
test('B1: settle applied, ACK and readback lost, ALL fence writes fail -> no further claim for any entry; never finalized', async () => {
  const { c, store, clock } = env();
  const o = order([E('A', 1, 1), E('B', 1, 1)]);
  store.rule({ phase: 'after', op: 'cas', match: isSettle(0), action: async () => { store.rule({ phase: 'before', op: 'get', ns: 'checkout', action: 'fail' }); allWritesFail(store); return 'ackLost'; } });
  const r = await c.checkout(o);
  assert.equal(r.ok, false); assert.equal(r.code, 'SETTLE_UNKNOWN'); assert.equal(r.conclusion, 'REVIEW_REQUIRED');
  const rec = store.peek('checkout', r.checkoutId);
  assert.equal(rec.state, 'ACTIVE', 'no fence could be written'); assert.equal(rec.entries[0].state, 'RESERVED', 'durable evidence only');
  assert.equal(store.opLog.filter(i => i.op === 'insert' && i.ns === 'slot' && i.key.startsWith('B|')).length, 0, 'entry 1 never attempted');
  // nothing can continue: replay is REPLAY; status has no authority; restored writes + sweep -> HOLD (evidence preserved)
  store.clearRules();
  assert.equal((await c.checkout(o)).code, 'REPLAY');
  assert.equal((await c.sweep(r.checkoutId)).conclusion, 'NOT_DUE');
  clock.advance(SYNTHETIC_DURATION_MS);
  assert.equal((await c.sweep(r.checkoutId)).conclusion, 'HOLD');
  assert.equal(store.peek('checkout', r.checkoutId).state, 'HOLD');
  assert.equal(claimsOf(store, r.checkoutId).length, 2, 'claims preserved, not released');
});
test('C1: exact readback resolves a settle ACK loss before UNKNOWN is declared (certification within the same invocation)', async () => {
  const { c, store } = env();
  store.rule({ phase: 'after', op: 'cas', match: isSettle(0), action: 'ackLost' });
  const r = await c.checkout(order([E('A', 1, 1), E('B', 1, 1)]));
  assert.equal(r.ok, true); assert.equal(r.state, 'FINALIZED');
});
test('C1: dispatch ACK lost + readback failed -> stop; zero claims; fence+enumeration -> NO_RESERVATION', async () => {
  const { c, store } = env();
  store.rule({ phase: 'after', op: 'cas', match: isDispatch, action: async () => { store.rule({ phase: 'before', op: 'get', ns: 'checkout', action: 'fail' }); return 'ackLost'; } });
  const r = await c.checkout(order([E('A', 1, 1)]));
  assert.equal(r.code, 'DISPATCH_UNKNOWN'); assert.equal(r.conclusion, 'NO_RESERVATION');
  assert.equal(store.peek('checkout', r.checkoutId).state, 'ABANDONED');
  assert.deepEqual(claimsOf(store, r.checkoutId), []);
});
test('C1: claim insert ACK lost + readback failed -> CLAIM_UNKNOWN; conclusion HOLD with the applied claim preserved', async () => {
  const { c, store } = env();
  store.rule({ phase: 'after', op: 'insert', ns: 'slot', action: async () => { store.rule({ phase: 'before', op: 'get', ns: 'slot', action: 'fail' }); return 'ackLost'; } });
  const r = await c.checkout(order([E('A', 1, 1)]));
  assert.equal(r.code, 'CLAIM_UNKNOWN'); assert.equal(r.conclusion, 'HOLD');
  assert.equal(claimsOf(store, r.checkoutId).length, 1);
  assert.equal(store.opLog.filter(i => i.op === 'insert' && i.ns === 'slot').length, 1, 'no queued next-room op after uncertainty');
});
test('C3: outage during conclusion -> REVIEW_REQUIRED, FENCED persists (never ABANDONED); later sweep concludes', async () => {
  const { c, store, clock } = env();
  store.rule({ phase: 'before', op: 'insert', ns: 'slot', action: async () => { store.rule({ phase: 'before', op: 'list', ns: 'slot', action: 'fail' }); return 'fail'; } });
  // insert fault 'before' + readback shows absent -> retried; force full outage of slot inserts instead:
  store.rule({ phase: 'before', op: 'insert', ns: 'slot', action: 'fail', once: false });
  store.rule({ phase: 'before', op: 'get', ns: 'slot', action: 'fail', once: false });
  const r = await c.checkout(order([E('A', 1, 1)]));
  assert.equal(r.code, 'CLAIM_UNKNOWN'); assert.equal(r.conclusion, 'REVIEW_REQUIRED');
  assert.equal(store.peek('checkout', r.checkoutId).state, 'FENCED');
  store.clearRules(); clock.advance(SYNTHETIC_DURATION_MS);
  assert.equal((await c.sweep(r.checkoutId)).conclusion, 'NO_RESERVATION');
});

// ======================= A8 deadline linearization =======================
test('A8: admission write paused across quote expiry -> QUOTE_EXPIRED, no record', async () => {
  const { c, store, clock } = env();
  const g = store.gate('before', 'insert', 'checkout');
  const p = c.checkout(order([E('A', 1, 1)], { expiresIn: 50 }));
  await g.reached; clock.advance(100); g.open();
  assert.equal((await p).code, 'QUOTE_EXPIRED'); assert.deepEqual(store.keys('checkout'), []);
});
for (const [name, match, expectConclusion] of [['dispatch', isDispatch, 'NO_RESERVATION'], ['settle', isSettle(0), 'HOLD'], ['final', isFinal, 'HOLD']]) {
  test('A8: ' + name + ' CAS paused across the deadline -> late (definitely not applied) -> ' + expectConclusion + '; never FINALIZED', async () => {
    const { c, store, clock } = env();
    const g = store.gate('before', 'cas', 'checkout', match);
    const p = c.checkout(order([E('A', 1, 1)]));
    await g.reached; clock.advance(SYNTHETIC_DURATION_MS); g.open();
    const r = await p;
    assert.equal(r.ok, false); assert.equal(r.code, 'DEADLINE'); assert.equal(r.conclusion, expectConclusion);
    assert.notEqual(store.peek('checkout', r.checkoutId).state, 'FINALIZED');
    assert.equal(r.finalConfirmed, undefined);
    const rec = store.peek('checkout', r.checkoutId);
    if (name === 'dispatch') { assert.equal(rec.fence.from, 'ADMITTING', 'late dispatch never applied'); assert.deepEqual(rec.entries.map(e => e.state), ['PENDING']); }
    if (name === 'settle') assert.equal(rec.entries[0].state, 'DISPATCHED', 'no RESERVED evidence is written at/after the deadline');
  });
}
test('A8: claim insert paused across the deadline -> late; earlier claim preserved; HOLD', async () => {
  const { c, store, clock } = env();
  const g = store.gate('before', 'insert', 'slot', i => i.key === 'A|2027-03-02|0');
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached; clock.advance(SYNTHETIC_DURATION_MS); g.open();
  const r = await p;
  assert.equal(r.code, 'DEADLINE'); assert.equal(r.conclusion, 'HOLD');
  assert.deepEqual(claimsOf(store, r.checkoutId), ['A|2027-03-01|0']);
});

// ======================= A9 closure: no NEW claim after a terminal LP =======================
test('A9: owner cancel while the executor reads owner rows -> the next insert is fenced; zero new claims', async () => {
  const { c, store } = env();
  const g = store.gate('before', 'list', 'owner');
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached;
  assert.equal((await c.ownerCancel('co_' + store.keys('checkout')[0].slice(3))).ok, true);
  g.open();
  const r = await p;
  assert.equal(r.code, 'FENCED_BY_OTHER'); assert.equal(r.conclusion, 'CANCELLED');
  assert.deepEqual(claimsOf(store, r.checkoutId), []);
  assert.equal(store.applied.filter(a => a.ns === 'slot').length, 0);
});
test('A9: prior booking occupies unit 0; cancel before the unit-1 insert -> unit-1 insert fenced', async () => {
  const { c, store } = env({ inventory: { A: { units: 2, minOccupancy: 1, maxOccupancy: 3 } } });
  await c.checkout(order([E('A', 1, 1)]));
  const g = store.gate('before', 'insert', 'slot', i => i.key === 'A|2027-03-01|1');
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached;
  const id = store.keys('checkout').find(k => store.peek('checkout', k).state === 'ACTIVE');
  await c.ownerCancel(id); g.open();
  const r = await p;
  assert.equal(r.code, 'FENCED_BY_OTHER'); assert.deepEqual(claimsOf(store, id), []);
});
test('A9: a PRE-TERMINAL admitted claim (applied, ACK pending) is preserved and reconciled; it is not a new claim', async () => {
  const { c, store } = env();
  let id;
  const g = store.gate('after', 'insert', 'slot', i => i.key === 'A|2027-03-01|0');
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached;
  id = store.keys('checkout')[0];
  assert.equal((await c.ownerFence(id)).conclusion, 'HOLD', 'the applied claim is visible to the complete enumeration');
  g.open();
  const r = await p;
  assert.equal(r.ok, false); assert.equal(r.code, 'FENCED_BY_OTHER');
  assert.deepEqual(claimsOf(store, id), ['A|2027-03-01|0'], 'preserved; the night-2 claim was fenced');
  assert.equal(store.peek('checkout', id).state, 'HOLD');
});
test('C2: takeover while the slow executor\'s insert is pending BEFORE apply -> zero-proof NO_RESERVATION, and the late insert is fenced', async () => {
  const { c, store } = env();
  const g = store.gate('before', 'insert', 'slot');
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached;
  const id = store.keys('checkout')[0];
  assert.equal((await c.ownerFence(id)).conclusion, 'NO_RESERVATION');
  g.open();
  const r = await p;
  assert.equal(r.code, 'FENCED_BY_OTHER');
  assert.deepEqual(claimsOf(store, id), [], 'the zero proof stays true');
  assert.equal(store.peek('checkout', id).state, 'ABANDONED');
});
test('C2: stale enumeration (asOf < fence seq) cannot prove zero -> REVIEW_REQUIRED; a fresh complete enumeration then concludes', async () => {
  const { c, store } = env();
  const g = store.gate('before', 'insert', 'slot');
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached;
  const id = store.keys('checkout')[0];
  store.rule({ phase: 'before', op: 'list', ns: 'slot', action: 'stale' });
  const r1 = await c.ownerFence(id);
  assert.equal(r1.conclusion, 'REVIEW_REQUIRED'); assert.equal(r1.why, 'ENUMERATION_INCOMPLETE');
  assert.equal(store.peek('checkout', id).state, 'FENCED');
  assert.equal((await c.ownerFence(id)).conclusion, 'NO_RESERVATION');
  g.open(); await p;
});
test('C2: a failing later page cannot prove zero (pagination must complete)', async () => {
  const { c, store } = env({ pageSize: 1 });
  await c.checkout(order([E('A', 1, 1)]));                  // other booking: 2 slot rows -> 2 pages
  const g = store.gate('before', 'insert', 'slot');
  const p = c.checkout(order([E('B', 1, 1)]));
  await g.reached;
  const id = store.keys('checkout').find(k => store.peek('checkout', k).state === 'ACTIVE');
  store.rule({ phase: 'before', op: 'list', ns: 'slot', match: i => i.key !== 'start', action: 'fail' });
  assert.equal((await c.ownerFence(id)).conclusion, 'REVIEW_REQUIRED');
  g.open(); await p;
});
test('C2: hidden claims of the slow worker on another checkout page are found (multi-page complete enumeration)', async () => {
  const { c, store } = env({ pageSize: 1 });
  await c.checkout(order([E('A', 1, 1)]));
  const g = store.gate('after', 'insert', 'slot', i => i.key.startsWith('B|2027-03-02'));
  const p = c.checkout(order([E('B', 1, 1)]));
  await g.reached;
  const id = store.keys('checkout').find(k => store.peek('checkout', k).state === 'ACTIVE');
  const r = await c.ownerFence(id);
  assert.equal(r.conclusion, 'HOLD');
  assert.deepEqual(store.peek('checkout', id).conclusion.claims, ['B|2027-03-01|0', 'B|2027-03-02|0']);
  g.open(); await p;
});

// ======================= clarification 4: no send authority; owner cancellation unrestricted =======================
test('C4: owner cancellation is allowed after FINALIZED; finalConfirmed is observational only', async () => {
  const { c, store } = env();
  const r = await c.checkout(order([E('A', 1, 1)]));
  assert.equal(r.finalConfirmed, true);
  assert.deepEqual(await c.ownerCancel(r.checkoutId), { ok: true, state: 'CANCELLED', from: 'FINALIZED' });
  assert.equal(claimsOf(store, r.checkoutId).length, 2, 'claims preserved; release is an owner action outside the model');
  assert.equal((await c.privacyRequest(r.checkoutId, 'WITHDRAW_CONSENT')).ok, true);
});
test('C4: cancellation just after final confirmation -> invoice identity NOT published; result still only observational', async () => {
  const { c, store } = env();
  const g = store.gate('before', 'insert', 'inv');
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached;
  const id = store.keys('checkout')[0];
  await c.ownerCancel(id); g.open();
  const r = await p;
  assert.equal(r.finalConfirmed, true); assert.equal(r.invoice.state, 'NOT_PUBLISHED');
  assert.equal(store.peek('checkout', id).state, 'CANCELLED'); assert.equal(store.peek('checkout', id).invoice, null);
});
test('UNKNOWN_FINALIZATION: no finalConfirmed; default review obligation stays open; sweep never resurrects or sends', async () => {
  const { c, store, clock } = env();
  store.rule({ phase: 'after', op: 'cas', match: isFinal, action: async () => { store.rule({ phase: 'before', op: 'get', ns: 'checkout', action: 'fail' }); return 'ackLost'; } });
  const r = await c.checkout(order([E('A', 1, 1)]));
  assert.equal(r.ok, false); assert.equal(r.code, 'REVIEW_REQUIRED'); assert.equal(r.finalConfirmed, undefined);
  const st = await c.status(r.checkoutId);
  assert.equal(st.state, 'FINALIZED'); assert.equal(st.reviewRequired, true);
  clock.advance(SYNTHETIC_DURATION_MS);
  assert.equal((await c.sweep(r.checkoutId)).conclusion, 'FINALIZED');
  assert.deepEqual(store.keys('inv'), [], 'no invoice identity after uncertain finalization');
});
test('finalize/cancel race: cancel lands first -> final CAS conflicts -> CANCELLED, not resurrected', async () => {
  const { c, store } = env();
  const g = store.gate('before', 'cas', 'checkout', isFinal);
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached;
  const id = store.keys('checkout')[0];
  await c.ownerCancel(id); g.open();
  const r = await p;
  assert.equal(r.ok, false); assert.equal(r.conclusion, 'CANCELLED');
});

// ======================= owner rows and integrity =======================
test('A6: owner rows counted; quantity/extra/impossible-date rows fail closed (no guessing)', async () => {
  for (const [row, expectOk] of [[{ roomCode: 'S', nights: ['2027-03-01'], rooms: 1 }, false], [{ roomCode: 'S', nights: ['2027-03-01'], quantity: 1 }, false], [{ roomCode: 'S', nights: ['2027-03-01'], rooms: 1, status: 'x' }, false], [{ roomCode: 'S', nights: ['2027-02-30'], rooms: 1 }, false], [{ roomCode: 'A', nights: ['2027-03-01'], rooms: 1 }, true]]) {
    const { c, store } = env();
    store.forceSet('owner', 'row', row);
    const r = await c.checkout(order([E('S', 1, 1)]));
    assert.equal(r.ok, expectOk, JSON.stringify(row));
    if (!expectOk) assert.ok(['NO_CAPACITY', 'CLAIM_UNKNOWN'].includes(r.code), r.code);
    assert.deepEqual(store.peek('owner', 'row'), row, 'owner row never mutated');
  }
});
test('integrity: malformed or non-canonical records naming the checkout force HOLD with MISMATCH (never NO_RESERVATION)', async () => {
  for (const [key, value] of [['A|2027-03-01|00', 'canon'], ['A|2027-03-01|0', 'extra'], ['WRONG|2099-01-01|9', 'canon'], ['A|2027-03-01|1', 'ordinal']]) {
    const { c, store } = env();
    const g = store.gate('before', 'insert', 'slot');
    const p = c.checkout(order([E('A', 1, 1)]));
    await g.reached;
    const id = store.keys('checkout')[0];
    const v = { checkoutId: id, entryIndex: 0, night: '2027-03-01', ordinal: 0, x: store.peek('checkout', id).admission };
    store.forceSet('slot', key, value === 'extra' ? { ...v, note: 'x' } : value === 'ordinal' ? { ...v, ordinal: 5 } : v);
    const r = await c.ownerFence(id);
    assert.equal(r.conclusion, 'HOLD', key + value);
    assert.equal(store.peek('checkout', id).conclusion.integrity, 'MISMATCH', key + value);
    g.open(); await p;
  }
});

// ======================= contention, privacy, resolution =======================
test('last unit contention between two different checkouts -> exactly one reserves; the other concludes from complete proof', async () => {
  const { c, store } = env();
  const rs = await Promise.all([c.checkout(order([E('S', 1, 1)])), c.checkout(order([E('S', 1, 1)]))]);
  assert.equal(rs.filter(r => r.ok).length, 1);
  const loser = rs.find(r => !r.ok);
  assert.equal(loser.code, 'NO_CAPACITY');
  assert.ok(['NO_RESERVATION', 'HOLD'].includes(loser.conclusion));
  assert.equal(store.keys('slot').filter(k => k.startsWith('S|')).length, 2);
});
test('privacy is never blocked; ownerResolveReview keeps guest closed; status carries no authority', async () => {
  const { c, store } = env();
  store.rule({ phase: 'after', op: 'insert', ns: 'slot', action: async () => { store.rule({ phase: 'before', op: 'get', ns: 'slot', action: 'fail' }); return 'ackLost'; } });
  const r = await c.checkout(order([E('A', 1, 1)]));
  assert.equal(r.conclusion, 'HOLD');
  for (const k of ['WITHDRAW_CONSENT', 'PRIVACY_CLEAR']) assert.equal((await c.privacyRequest(r.checkoutId, k)).ok, true);
  assert.deepEqual(await c.ownerResolveReview(r.checkoutId), { ok: true, state: 'HOLD', review: 'OWNER_RESOLVED' });
  assert.equal((await c.status(r.checkoutId)).state, 'HOLD', 'resolution never changes state');
  assert.equal(claimsOf(store, r.checkoutId).length, 1);
});

// ======================= load-bearing capability demonstrations =======================
test('A9 is load-bearing: a store that ignores the insert guard admits a NEW claim after cancellation', async () => {
  const { c, store } = env();
  const real = store.insertUnique;
  store.insertUnique = (ns, key, value, cond = {}) => real(ns, key, value, { ...cond, guard: undefined });
  const g = store.gate('before', 'list', 'owner');
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached;
  await c.ownerCancel(store.keys('checkout')[0]); g.open();
  await p;
  assert.ok(claimsOf(store, store.keys('checkout')[0]).length > 0, 'without A9 the post-terminal claim applies (precondition, unproven for Wix)');
});
test('A8 is load-bearing: a store that ignores notAfter finalizes after the deadline', async () => {
  const { c, store, clock } = env();
  const real = store.casUpdate;
  store.casUpdate = (ns, key, v, value, cond = {}) => real(ns, key, v, value, { ...cond, notAfter: undefined });
  const g = store.gate('before', 'cas', 'checkout', isFinal);
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached; clock.advance(SYNTHETIC_DURATION_MS); g.open();
  assert.equal((await p).state, 'FINALIZED', 'without A8 the deadline is not strict (precondition, unproven for Wix)');
});
test('A12 is load-bearing: accepting a stale snapshot would produce a false NO_RESERVATION', async () => {
  const { c, store } = env();
  const g = store.gate('after', 'insert', 'slot');
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached;
  const id = store.keys('checkout')[0];
  const realList = store.listPage;
  store.listPage = async (ns, cur) => { const pg = await realList(ns, cur); return ns === 'slot' ? { ...pg, items: [], asOf: store.seq } : pg; };   // incomplete page claiming freshness
  assert.equal((await c.ownerFence(id)).conclusion, 'NO_RESERVATION');
  assert.equal(claimsOf(store, id).length, 1, 'false conclusion: a claim exists; A12 completeness is load-bearing');
  store.listPage = realList; g.open(); await p; void tick;
});
test('A13 is load-bearing: reused write nonces let a concurrent duplicate invocation mistake the winner\'s identical write for its own', async () => {
  const { c, store } = env({ newWriteNonce: () => 'reused' });
  const o = order([E('A', 1, 1)], { checkOut: '2027-03-02' });
  store.rule({ phase: 'before', match: i => i.op === 'insert' && i.ns === 'checkout', action: 'fail' });   // first invocation's admission fails before apply
  const rs = await Promise.all([c.checkout(o), c.checkout(JSON.parse(JSON.stringify(o)))]);
  assert.ok(rs.filter(r => r.code !== 'REPLAY').length === 2, 'both invocations believed they were the admission winner (precondition violated)');
});
test('A13 holds: with unique nonces the same schedule has exactly one admission winner', async () => {
  const { c, store } = env();
  const o = order([E('A', 1, 1)], { checkOut: '2027-03-02' });
  store.rule({ phase: 'before', match: i => i.op === 'insert' && i.ns === 'checkout', action: 'fail' });
  const rs = await Promise.all([c.checkout(o), c.checkout(JSON.parse(JSON.stringify(o)))]);
  assert.equal(rs.filter(r => r.ok).length, 1); assert.ok(rs.some(r => r.code === 'UNAVAILABLE' || r.code === 'REPLAY'));
  assert.equal(store.keys('bn').length, 1);
});
test('A12: pages from different snapshots cannot prove zero -> REVIEW_REQUIRED', async () => {
  const { c, store } = env({ pageSize: 1 });
  await c.checkout(order([E('A', 1, 1)]));
  const g = store.gate('before', 'insert', 'slot');
  const p = c.checkout(order([E('B', 1, 1)]));
  await g.reached;
  const id = store.keys('checkout').find(k => store.peek('checkout', k).state === 'ACTIVE');
  const realList = store.listPage;
  store.listPage = async (ns, cur) => { const pg = await realList(ns, cur); return cur ? { ...pg, asOf: pg.asOf + 1 } : pg; };   // mixed snapshots
  assert.equal((await c.ownerFence(id)).conclusion, 'REVIEW_REQUIRED');
  store.listPage = realList; g.open(); await p;
});
test('dispatch conflict (fenced by owner while dispatch pending) -> executor never claims', async () => {
  const { c, store } = env();
  const g = store.gate('before', 'cas', 'checkout', isDispatch);
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached;
  const id = store.keys('checkout')[0];
  assert.equal((await c.ownerFence(id)).conclusion, 'NO_RESERVATION');
  g.open();
  const r = await p;
  assert.equal(r.code, 'FENCED_BY_OTHER');
  assert.equal(store.opLog.filter(i => i.op === 'insert' && i.ns === 'slot').length, 0, 'no claim attempt without a confirmed own dispatch');
});

// ======================= r4 regressions: B1 orthogonal evidence/review, B2 =======================
const statusOf = async (c, id) => c.status(id);
for (const [name, setup, expectCode] of [
  ['dispatch ACK+readback lost', s => s.rule({ phase: 'after', op: 'cas', match: isDispatch, action: async () => { s.rule({ phase: 'before', op: 'get', ns: 'checkout', action: 'fail' }); return 'ackLost'; } }), 'DISPATCH_UNKNOWN'],
  ['no capacity on the first claim', null, 'NO_CAPACITY'],
  ['dispatch late (deadline)', 'deadline', 'DEADLINE']
]) {
  test('B1: ' + name + ' -> ZERO_PROVEN evidence AND review still required (orthogonal)', async () => {
    const { c, store, clock } = env();
    let o = order([E('A', 1, 1)]);
    if (setup === null) { await c.checkout(order([E('S', 1, 1)])); o = order([E('S', 1, 1)]); }
    else if (setup === 'deadline') { const g = store.gate('before', 'cas', 'checkout', isDispatch); const p = c.checkout(o); await g.reached; clock.advance(SYNTHETIC_DURATION_MS); g.open(); const r = await p; return check(r); }
    else setup(store);
    return check(await c.checkout(o));
    async function check(r) {
      assert.equal(r.code, expectCode); assert.equal(r.conclusion, 'NO_RESERVATION');
      assert.equal(r.reservationEvidence, 'ZERO_PROVEN'); assert.equal(r.reviewRequired, true);
      const st = await statusOf(c, r.checkoutId);
      assert.equal(st.state, 'ABANDONED'); assert.equal(st.reservationEvidence, 'ZERO_PROVEN'); assert.equal(st.reviewRequired, true, 'zero proof never discharges review');
    }
  });
}
test('B1: owner takeover and sweep conclusions keep the review obligation (ZERO_PROVEN and CLAIMS_PRESENT)', async () => {
  { const { c, store } = env();
    const g = store.gate('before', 'insert', 'slot');
    const p = c.checkout(order([E('A', 1, 1)]));
    await g.reached; const id = store.keys('checkout')[0];
    assert.equal((await c.ownerFence(id)).conclusion, 'NO_RESERVATION');
    g.open(); await p;
    const st = await c.status(id); assert.equal(st.reservationEvidence, 'ZERO_PROVEN'); assert.equal(st.reviewRequired, true); }
  { const { c, store, clock } = env();
    store.rule({ phase: 'after', op: 'cas', match: isSettle(0), action: async () => { store.rule({ phase: 'before', op: 'get', ns: 'checkout', action: 'fail' }); allWritesFail(store); return 'ackLost'; } });
    const r = await c.checkout(order([E('A', 1, 1)]));
    store.clearRules(); clock.advance(SYNTHETIC_DURATION_MS); await c.sweep(r.checkoutId);
    const st = await c.status(r.checkoutId); assert.equal(st.state, 'HOLD'); assert.equal(st.reservationEvidence, 'CLAIMS_PRESENT'); assert.equal(st.reviewRequired, true); }
});
test('B1: incomplete enumeration -> FENCED with evidence UNKNOWN and review required', async () => {
  const { c, store } = env();
  store.rule({ phase: 'before', op: 'insert', ns: 'slot', action: 'fail', once: false });
  store.rule({ phase: 'before', op: 'get', ns: 'slot', action: 'fail', once: false });
  store.rule({ phase: 'before', op: 'list', ns: 'slot', action: 'fail', once: false });
  const r = await c.checkout(order([E('A', 1, 1)]));
  assert.equal(r.conclusion, 'REVIEW_REQUIRED'); assert.equal(r.reservationEvidence, 'UNKNOWN');
  store.clearRules();
  const st = await c.status(r.checkoutId); assert.equal(st.state, 'FENCED'); assert.equal(st.reservationEvidence, 'UNKNOWN'); assert.equal(st.reviewRequired, true);
  assert.equal(store.peek('checkout', r.checkoutId).evidence, 'UNKNOWN', 'durable evidence field, not only a status fallback');
});
test('B2: L-FINAL applied, ACK+readback lost, then EVERY later CAS fails -> obligation stays durable; after recovery status FINALIZED reviewRequired:true', async () => {
  const { c, store, clock } = env();
  store.rule({ phase: 'after', op: 'cas', match: isFinal, action: async () => { store.rule({ phase: 'before', op: 'get', ns: 'checkout', action: 'fail' }); store.rule({ phase: 'before', op: 'cas', action: 'fail', once: false }); return 'ackLost'; } });
  const r = await c.checkout(order([E('A', 1, 1)]));
  assert.equal(r.code, 'REVIEW_REQUIRED'); assert.equal(r.finalConfirmed, undefined); assert.equal(r.reviewRequired, true);
  store.clearRules(); clock.advance(SYNTHETIC_DURATION_MS);
  assert.equal((await c.sweep(r.checkoutId)).conclusion, 'FINALIZED');
  const st = await c.status(r.checkoutId);
  assert.equal(st.state, 'FINALIZED'); assert.equal(st.reviewRequired, true, 'never silently lost'); assert.equal(st.reviewReason, 'OPEN');
  assert.deepEqual(store.keys('inv'), []);
});
test('discharge: confirmed success discharges; a failed discharge write leaves a disclosed false-positive review (never a false negative)', async () => {
  { const { c } = env();
    const r = await c.checkout(order([E('A', 1, 1)]));
    assert.equal(r.review, 'DISCHARGED'); assert.equal(r.reviewRequired, false);
    assert.equal((await c.status(r.checkoutId)).reviewRequired, false); }
  { const { c, store } = env();
    store.rule({ phase: 'before', op: 'cas', match: i => i.value && i.value.state === 'FINALIZED' && i.value.review && i.value.review.required === false, action: 'fail', once: false });
    const r = await c.checkout(order([E('A', 1, 1)]));
    assert.equal(r.ok, true); assert.equal(r.finalConfirmed, true); assert.equal(r.review, 'RETAINED'); assert.equal(r.reviewRequired, true);
    assert.equal((await c.status(r.checkoutId)).reviewRequired, true, 'false positive: successful booking still flagged for owner');
    assert.equal(r.invoice.state, 'NOT_ATTEMPTED'); }
  { const { c, store } = env();   // discharge applied, ACK+readback lost: durable discharge is truthful (written only after confirmed final)
    store.rule({ phase: 'after', op: 'cas', match: i => i.value && i.value.review && i.value.review.reason === 'CONFIRMED_SUCCESS', action: async () => { store.rule({ phase: 'before', op: 'get', ns: 'checkout', action: 'fail' }); return 'ackLost'; } });
    const r = await c.checkout(order([E('A', 1, 1)]));
    assert.equal(r.review, 'RETAINED'); assert.equal(r.reviewRequired, true);
    assert.equal((await c.status(r.checkoutId)).reviewRequired, false); }
});
test('owner resolution: allowed only off-execution; changes ONLY the review obligation (no resume/release/certify/finalize/send/cancel erase)', async () => {
  const { c, store } = env();
  const g = store.gate('before', 'insert', 'slot');
  const p = c.checkout(order([E('A', 1, 1)]));
  await g.reached; const id = store.keys('checkout')[0];
  assert.equal((await c.ownerResolveReview(id)).code, 'STILL_EXECUTING');
  await c.ownerCancel(id); g.open(); await p;
  const before = store.peek('checkout', id);
  assert.equal(before.review.required, true, 'cancellation does not erase the obligation');
  const res = await c.ownerResolveReview(id);
  assert.equal(res.ok, true); assert.equal(res.state, 'CANCELLED');
  const after = store.peek('checkout', id);
  for (const k of ['state', 'epoch', 'entries', 'snapshot', 'invoice', 'evidence', 'bookingNumber']) assert.deepEqual(after[k], before[k], k);
  assert.equal(after.review.required, false); assert.equal(after.review.reason, 'OWNER_RESOLVED');
  assert.equal((await c.checkout(before.snapshot)).code, 'REPLAY', 'resolution never resumes');
  assert.deepEqual(store.keys('inv'), []);
  // resolution of FINALIZED with retained review and of ABANDONED
  const e2 = env(); store;
  e2.store.rule({ phase: 'before', op: 'cas', match: i => i.value && i.value.review && i.value.review.reason === 'CONFIRMED_SUCCESS', action: 'fail', once: false });
  const r2 = await e2.c.checkout(order([E('A', 1, 1)]));
  e2.store.clearRules();
  assert.deepEqual(await e2.c.ownerResolveReview(r2.checkoutId), { ok: true, state: 'FINALIZED', review: 'OWNER_RESOLVED' });
  assert.equal(e2.store.peek('checkout', r2.checkoutId).state, 'FINALIZED');
  assert.deepEqual(e2.store.keys('inv'), [], 'owner resolution does not allocate or send');
});
test('integrity (bounded defence): nested reference and duplicate logical claim rows are never ZERO/OK', async () => {
  for (const variant of ['nested', 'duplicateLogical']) {
    const { c, store } = env();
    const g = store.gate('before', 'insert', 'slot');
    const p = c.checkout(order([E('A', 1, 1)]));
    await g.reached; const id = store.keys('checkout')[0];
    const adm = store.peek('checkout', id).admission;
    const v = { checkoutId: id, entryIndex: 0, night: '2027-03-01', ordinal: 0, x: adm };
    if (variant === 'nested') store.forceSet('slot', 'Z|2099-01-01|0', { nested: { deeper: [id] } });
    else { store.forceSet('slot', 'A|2027-03-01|0', v); store.forceSet('slot', 'A|2027-03-01|1', v); }
    const r = await c.ownerFence(id);
    assert.equal(r.conclusion, 'HOLD', variant);
    assert.equal(store.peek('checkout', id).conclusion.integrity, 'MISMATCH', variant);
    g.open(); await p;
  }
});
test('DURING readback: cancel/deadline applied after a read linearizes but before its result is delivered cannot produce an illegal claim or late final', async () => {
  for (const [what, act] of [['cancel', 'cancel'], ['deadline', 'deadline'], ['fence', 'fence']]) {
    for (const target of ['settle', 'final', 'claim']) {
      const { c, store, clock } = env();
      const m = target === 'settle' ? isSettle(0) : target === 'final' ? isFinal : (i => i.op === 'insert' && i.ns === 'slot');
      store.rule({ phase: 'after', match: i => (i.op === 'cas' || i.op === 'insert') && m(i), action: async info => {
        store.rule({ phase: 'after', op: 'get', ns: info.ns, action: async () => {
          const id = store.keys('checkout')[0];
          if (act === 'cancel') await c.ownerCancel(id); else if (act === 'fence') await c.ownerFence(id); else clock.advance(SYNTHETIC_DURATION_MS);
        } });
        return 'ackLost';
      } });
      const r = await c.checkout(order([E('A', 1, 2)], { checkOut: '2027-03-03' }));
      const id = store.keys('checkout')[0];
      const rec = store.peek('checkout', id);
      const finals = store.applied.filter(a => a.ns === 'checkout' && a.value.state === 'FINALIZED' && a.value.review.required === true);
      for (const f of finals) assert.ok(f.time < rec.deadline, what + target + ' late final');
      const claims = store.applied.filter(a => a.ns === 'slot');
      assert.ok(claims.length <= 2, what + target + ' extra claims');
      if (!r.ok) assert.equal((await c.status(id)).reviewRequired, true, what + target + ' review kept');
    }
  }
});
