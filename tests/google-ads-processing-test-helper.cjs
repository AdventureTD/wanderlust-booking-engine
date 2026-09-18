const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'velo/backend/googleAdsProcessingDiagnostic.js');
const ids = ['956aa6b6-f5b1-409d-aed0-d48b120ac6a9', '0e453038-1a79-4b99-af2d-cd433bc8cf4f'];
const names = ['readWC1035ProcessingStatus', 'readWC1036ProcessingStatus'];
const token = 'INERT_TEST_TOKEN_NOT_A_CREDENTIAL';
function payload(status = 'FAILED') {
  return { requestStatusPerDestination: [{
    destination: { operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '9426928570' }, productDestinationId: '7690532327' },
    requestStatus: status, eventsIngestionStatus: { recordCount: '1' },
    ...(status === 'FAILED' ? { errorInfo: { errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND', recordCount: '1' }] } } : {})
  }] };
}
async function load(options = {}) {
  const calls = [], logs = [], timers = new Map(); let authCalls = 0, timerId = 0;
  const context = vm.createContext({ Buffer, URLSearchParams, Date, console: Object.fromEntries(['log','warn','error','info','debug'].map(k => [k, (...a) => logs.push(a)])),
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, {fn, ms}); return id; }, clearTimeout: id => timers.delete(id) });
  const synthetic = exports => new vm.SyntheticModule(Object.keys(exports), function() { for (const [k,v] of Object.entries(exports)) this.setExport(k,v); }, {context});
  const fetch = (url, init) => { calls.push({ url, init }); return options.fetch ? options.fetch(url, init) : { status: 200, text: async () => JSON.stringify(options.payload || payload()) }; };
  const auth = () => { authCalls++; return options.auth ? options.auth() : token; };
  const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const module = new vm.SourceTextModule(source, {context, identifier: file});
  await module.link(async specifier => {
    if (specifier === 'wix-fetch') return synthetic({fetch});
    if (specifier === 'backend/dataManagerClient.web') return synthetic({getAccessToken: auth});
    throw new Error('Unexpected runtime import: ' + specifier);
  });
  await module.evaluate();
  return { api: module.namespace, calls, logs, timers, authCalls: () => authCalls };
}
module.exports = {load, payload, names, ids, token, root, file};
