// Actual node-fetch transport, loopback only; no hosted Wix/provider execution.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const path = require('node:path');
// Supply the independently installed node-fetch 2.7.0 via NODE_PATH.
const fetch = require('node-fetch');
const source = fs.readFileSync(path.join(__dirname, '../velo/backend/cancellationEffects.js'), 'utf8');
function load(rows, transport) {
  const context = vm.createContext({crypto: require('node:crypto'), setTimeout, clearTimeout,
    wixData: {get: async (_, id) => rows.get(id), insert: async (_, row) => {
      if (rows.has(row._id)) throw Error('DUPLICATE');
      rows.set(row._id, row); return row;
    }}, getSecret: async k => k === 'WBE_INVOICE_SERVICE_URL' ? 'https://inert.invalid' : 'INERT_NOT_SECRET', fetch: transport});
  vm.runInContext(source.replace(/^import .*;$/gm, '').replace(/export /g, '') +
    '\nglobalThis.call=calendarCancellation;globalThis.read=readCancellationEffects;', context);
  return context;
}
const operation = {_id: 'inert-transport-operation', bookingNumber: 'WC-900001'};
for (const code of [301,302,303,307,308]) test(`Calendar denies real node-fetch ${code} before redirect target or secret entry`, async () => {
  const initial = [], targets = [], rows = new Map();
  const target = http.createServer((req,res) => {targets.push({method:req.method,secret:req.headers['x-wbe-secret']});res.end('{}');});
  await new Promise(r => target.listen(0,'127.0.0.1',r));
  const server = http.createServer((req,res) => {initial.push(req.headers['x-wbe-secret']);res.writeHead(code,{Location:`http://127.0.0.1:${target.address().port}/target`});res.end();});
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  try {
    const context = load(rows, (_, options) => fetch(`http://127.0.0.1:${server.address().port}/initial`, options));
    assert.equal(await context.call({operation}), 'UNKNOWN');
    assert.deepEqual(targets, [], 'redirect must never reach target (including custom secret)');
    assert.deepEqual(initial, ['INERT_NOT_SECRET']);
    assert.equal(rows.size,0,'uncertainty must not manufacture a durable ACK');
    assert.equal((await load(rows, () => {throw Error('STATUS_MUST_NOT_FETCH');}).read(operation)).calendar,'NEEDS_RECONCILIATION');
  } finally {await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>target.close(r))]);}
});
test('Calendar lost body remains unknown; exact receipt becomes durable and status performs no fetch', async () => {
  const rows = new Map(); let calls = 0;
  const lost = load(rows, async () => {calls++;return {ok:true,json:async()=>{throw Error('BODY_LOST');}};});
  assert.equal(await lost.call({operation}), 'UNKNOWN'); assert.equal(rows.size,0); assert.equal(calls,1);
  const good = load(rows, async () => {calls++;return {ok:true,json:async()=>({status:'CANCELLED',booking_number:operation.bookingNumber,event_id:'inert-exact-event',calendar_id:'owner-calendar',disposition:'DELETED',deletion_version:1})};});
  assert.equal(await good.call({operation}),'CANCELLED'); assert.equal(rows.size,1); assert.equal(calls,2);
  const restarted = load(rows, () => {throw Error('NO_EXTRA_EFFECT');});
  assert.equal(await restarted.call({operation}),'CANCELLED');
  assert.equal((await restarted.read(operation)).calendar,'CANCELLED'); assert.equal(rows.size,1); assert.equal(calls,2);
});
