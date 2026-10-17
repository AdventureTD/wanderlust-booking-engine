'use strict';
// Shared r4 test fixtures. SYNTHETIC values only; nothing here is a production policy.
const path = require('node:path');
const SRC = process.env.M0_R4_SRC || path.join(__dirname, '../../src/r4/checkoutOrchestrator.cjs');
const { createCheckoutOrchestrator, GUEST_ROOM_CAP } = require(SRC);
const { createStoreR3 } = require(path.join(__dirname, '../../src/r4/modelStoreR4.cjs'));

const SYNTHETIC_DURATION_MS = 1000;         // SYNTHETIC TEST VALUE ONLY; not a selected checkout window
const T0 = 1000000;
let NONCE = 0;
const INVENTORY = { A: { units: 3, minOccupancy: 1, maxOccupancy: 3 }, B: { units: 2, minOccupancy: 1, maxOccupancy: 4 }, S: { units: 1, minOccupancy: 1, maxOccupancy: 2 } };

function env(opts = {}) {
  let t = opts.t0 ?? T0;
  const clock = { now: () => t, set: v => { t = v; }, advance: d => { t += d; } };
  const store = createStoreR3({ clock, pageSize: opts.pageSize ?? 2 });
  let id = 0, bn = opts.bnStart ?? 1001, inv = opts.invStart ?? 5001;
  const events = [];
  const c = createCheckoutOrchestrator({
    store, clock, checkoutDurationMs: opts.duration ?? SYNTHETIC_DURATION_MS, inventory: opts.inventory || INVENTORY,
    newId: opts.newId || (() => 'id' + String(++id).padStart(6, '0')),
    newWriteNonce: opts.newWriteNonce || (() => 'w' + (++NONCE)),   // A13: globally unique (process-global counter)
    nextBookingNumber: opts.nextBookingNumber || (() => bn++),
    nextInvoiceNumber: opts.nextInvoiceNumber || (() => inv++),
    trace: ev => events.push({ ...ev, t: clock.now(), seq: store.seq })
  });
  return { store, clock, c, events };
}
let qn = 0;
function order(entries, { quoteId, prices = {}, checkIn = '2027-03-01', checkOut = '2027-03-03', expiresIn = 600000, now = T0 } = {}) {
  const qe = entries.map(e => ({ roomCode: e.roomCode, quantity: e.quantity, occupancy: e.occupancy, pricePerRoomCents: prices[e.roomCode] ?? 10000 }));
  return { cart: { entries: entries.map(e => ({ ...e })) }, quote: { quoteId: quoteId || 'Q' + (++qn), packageId: 'P-SYN', checkIn, checkOut, expiresAt: now + expiresIn, entries: qe, totalCents: qe.reduce((s, e) => s + e.pricePerRoomCents * e.quantity, 0) } };
}
const E = (roomCode, quantity, occupancy) => ({ roomCode, quantity, occupancy });
const claimsOf = (store, checkoutId) => store.keys('slot').filter(k => store.peek('slot', k).checkoutId === checkoutId);
const tick = () => new Promise(r => setImmediate(r));
module.exports = { env, order, E, claimsOf, tick, SYNTHETIC_DURATION_MS, T0, INVENTORY, GUEST_ROOM_CAP, createCheckoutOrchestrator, createStoreR3 };
