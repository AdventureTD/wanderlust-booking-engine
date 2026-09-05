// Causal duplicate-ID guard regression with real projection and digest modules.
// Run: node scripts/verify-room-booking-coordinator-duplicate-ids.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.join(__dirname, '..');
const context = vm.createContext({ crypto: require('crypto'), console, assert });
for (const [name, exports] of [
  ['roomBookingPayloadRules', ['canonicalizeRoomBookingCommitPayload']],
  ['roomBookingCommitProjectionRules', ['projectRoomBookingCommitPayload']],
  ['roomBookingPayloadDigest', ['computeRoomBookingPayloadDigest']],
  ['roomBookingCoordinator', ['coordinatePhysicalBookingCommit']]
]) {
  const source = fs.readFileSync(path.join(root, 'velo/backend', name + '.js'), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace(/export (async )?function /g, '$1function ');
  vm.runInContext('{' + source + '\nObject.assign(globalThis,{' + exports.join(',') + '});}', context);
}
const helpers = fs.readFileSync(path.join(__dirname, 'verify-room-booking-coordinator.js'), 'utf8');
const start = helpers.indexOf('function days(');
const end = helpers.indexOf('(async function()');
assert.ok(start >= 0 && end > start, 'fixture boundaries exist');
vm.runInContext(helpers.slice(start, end), context);
vm.runInContext(`(async () => {
  const plan = makePlan({ checkIn: '2028-01-01', checkOut: '2028-01-03' });
  const trusted = { guests: 2, roomFee: 0, note: '' };
  const row = plan.bookingRows[0];
  const payload = projectRoomBookingCommitPayload({
    operationId: row.operationId, bookingNumber: row.bookingNumber, roomCode: row.roomCode,
    checkIn: row.checkIn, checkOut: row.checkOut, bookingRowIds: [plan.primaryRowId], ...trusted
  });
  const digest = computeRoomBookingPayloadDigest(payload);
  [...plan.bookingRows, ...plan.acquisitions].forEach(value => { value.payloadDigest = digest; });
  for (const event of plan.acquisitions.slice(1)) {
    event._id = event._id.replace(/rc1-[0-9]{8}-/, 'rc1-20280101-');
  }
  plan.acquisitions[0].manifestResourceClaimIds = plan.acquisitions.slice(1).map(value => value._id).join('|');
  const calls = [];
  const ports = portsFor(plan, calls);
  const saved = RegExp.prototype[Symbol.replace];
  let armed = false, touches = 0, error;
  const input = new Proxy(plan, {
    getPrototypeOf(target) {
      if (!armed) {
        armed = true;
        RegExp.prototype[Symbol.replace] = function(text, replacement) {
          if (this.source === '-' && this.global) { touches++; return '20280101'; }
          return Reflect.apply(saved, this, [text, replacement]);
        };
      }
      return Reflect.getPrototypeOf(target);
    }
  });
  try { await coordinatePhysicalBookingCommit(input, trusted, ports); }
  catch (caught) { error = caught; }
  finally { RegExp.prototype[Symbol.replace] = saved; }
  assert.ok(armed && touches > 0, 'fixture reaches delegated string-replacement dispatch');
  assert.equal(error && error.message, 'Invalid coordinator plan', 'duplicate resource IDs reject');
  assert.deepEqual(calls, [], 'duplicate resource IDs never authorize port effects');
  console.log('PASS: duplicate IDs reject despite altered compact-night formatting');
})()`, context).catch(error => { console.error(error); process.exitCode = 1; });
