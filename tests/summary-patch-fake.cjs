'use strict';
// Offline fake of the DOCUMENTED Data Items SDK patch semantics only:
// items.patch(collection, itemId, fieldModifications, options) direct form;
// only named fields change; a missing itemId fails; options.condition (filter
// with getFilterModel) must match the CURRENT stored row or the patch fails.
// auth.elevate is a recording wrapper. Proves the algorithm, NOT Wix runtime
// elevation or server enforcement.
function makeDataItemsFake(store, hooks = {}) {
  const calls = [];
  const filter = () => { const terms = []; const b = { eq(k, v) { terms.push([k, v]); return b; }, getFilterModel() { return { $and: terms.map(([k, v]) => ({ [k]: { $eq: v } })) }; } }; return b; };
  const matches = (row, model) => !model || (model.$and || []).every(t => { const [k] = Object.keys(t); return row[k] === t[k].$eq; });
  function makePatch(elevated) {
    return async function patch(collection, itemId, fieldModifications, options) {
      if (arguments.length < 3) throw Error('FAKE: builder form not modelled; use the direct form');
      calls.push({ collection, itemId, elevated, fields: fieldModifications.map(m => m.fieldPath), options: options && { condition: !!options.condition, suppressHooks: !!options.suppressHooks } });
      if (hooks.beforePatch) await hooks.beforePatch({ collection, itemId, fieldModifications, elevated });
      const row = store.get(collection, itemId);
      if (!row) throw Object.assign(Error('FAKE WDE: item not found'), { code: 'ITEM_NOT_FOUND' });
      if (options && options.condition && !matches(row, options.condition.getFilterModel())) throw Object.assign(Error('FAKE WDE: condition not met'), { code: 'CONDITION_NOT_MET' });
      const next = structuredClone(row);
      for (const m of fieldModifications) {
        if (!m || m.action !== 'SET_FIELD' || typeof m.fieldPath !== 'string' || m.fieldPath.includes('.')) throw Error('FAKE: unsupported modification');
        next[m.fieldPath] = structuredClone(m.value);
      }
      store.set(collection, itemId, next);
      return structuredClone(next);
    };
  }
  const plain = makePatch(false), elevatedPatch = makePatch(true);
  return {
    calls,
    externals: {
      '@wix/data': { items: { patch: plain, filter } },
      '@wix/essentials': { auth: { elevate: fn => { if (fn !== plain) throw Error('FAKE: elevate only items.patch'); return elevatedPatch; } } }
    }
  };
}
// Evaluate the REAL velo/backend/bookingSummaryWriter.js against the fake, for
// slice-based harnesses that inject writer functions into a context.
async function loadWriter(store, hooks = {}) {
  const fake = makeDataItemsFake(store, hooks);
  return { writer: await loadWriterWith(fake.externals), calls: fake.calls };
}
// Same, with harness-provided externals (e.g. an existing patch recorder).
async function loadWriterWith(ext) {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const context = vm.createContext({ structuredClone });
  const cache = new Map();
  const load = s => { if (cache.has(s)) return cache.get(s); let m; const e = ext[s];
    if (e) m = new vm.SyntheticModule(Object.keys(e), function () { for (const k of Object.keys(e)) this.setExport(k, e[k]); }, { context });
    else throw Error('writer imports only @wix/data and @wix/essentials, got ' + s);
    cache.set(s, m); return m; };
  const m = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '../velo/backend/bookingSummaryWriter.js'), 'utf8'), { context, identifier: 'backend/bookingSummaryWriter' });
  await m.link(load); await m.evaluate();
  return m.namespace;
}
// Store adapters.
const mapStore = (rows, key = (c, id) => c + ':' + id) => ({ get: (c, id) => rows.get(key(c, id)), set: (c, id, row) => rows.set(key(c, id), row) });
const arrayStore = db => ({ get: (c, id) => (db[c] || []).find(r => r._id === id), set: (c, id, row) => { const i = db[c].findIndex(r => r._id === id); db[c][i] = row; } });
module.exports = { makeDataItemsFake, loadWriter, loadWriterWith, mapStore, arrayStore };
