'use strict';
// Local SDK/platform-authentication fixture only: no hosted Wix or network proof.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const rows = new Map();
const trace = [];
let role = 'Admin';
let actor = 'fixture-admin';
let loggedIn = true;
const legacyIdentity = {get role() {return role;}, get id() {return actor;}, get loggedIn() {return loggedIn;}};
let failRoot = false;
let loseRequestAck = false;
let loseRootAck = false;
let insertHook = null;
let getHook = null;
let queryHook = null;
let nativeFault = null;
let bridgeSecrets = false;
let dispatchFetch = null;
const externalTrace = [];

// Syntax-only AST parser bundled with Node, not a dirty-tree dependency.
// Fail closed if this Node distribution omits it. Only trusted parser code is
// compiled; scanned sources are parsed, NEVER linked or evaluated.
let incomingParser;
function parseIncoming(source, sourceType = 'module') {
  if (!incomingParser) {
    const bundled = process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'];
    assert.equal(typeof bundled, 'string', 'Node bundled Acorn prerequisite missing');
    const exports = {};
    new vm.Script('(function(exports,module){' + bundled + '\n})', {filename:'node-bundled-acorn'})
      .runInThisContext()(exports,{exports});
    assert.equal(typeof exports.parse, 'function', 'Node bundled Acorn parser unavailable');
    incomingParser = exports;
  }
  return incomingParser.parse(source, {ecmaVersion:'latest', sourceType});
}
const lineageEdge = "import { readOwnerInvoiceDocumentLineage } from 'backend/invoiceEmailJournal';";
const ownerConsumer = 'velo/backend/ownerInvoiceCurrentRevision.js';
function reviewedConsumerBody(source, removeEdge = true) {
  assert.equal(crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex'),
    'a8e4ca7bda6c91414fcb83f9043b59df7646300d919242939ace27e02e492590', 'exact reviewed consumer only');
  assert.equal(source.split(lineageEdge).length - 1, 1, 'one exact reader edge');
  return removeEdge ? source.replace(lineageEdge, '') : source;
}
function htmlScripts(source) {
  assert.ok(source.length <= 2000000, 'unsupported HTML size');
  const scripts = [];
  // Bounded HTML tokenizer: comments, quoted tags and raw script bodies.
  const tags = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;
  let match;
  while ((match = tags.exec(source))) {
    const tag = match[0];
    if (/^<!--|^<!/.test(tag)) continue;
    if (!/^<script\b/i.test(tag)) continue;
    assert.ok(!/\/\s*>$/.test(tag), 'unsupported self-closing script');
    const attrs = Object.create(null);
    let rest = tag.replace(/^<script\b/i, '').slice(0,-1);
    while (rest.trim()) {
      const attr = /^\s+([^\s=<>/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>`'"=]+)))?/.exec(rest);
      assert.ok(attr, 'unsupported script attribute');
      const key = attr[1].toLowerCase();
      assert.ok(!Object.hasOwn(attrs,key), 'duplicate script attribute');
      let value = attr[2] ?? attr[3] ?? attr[4] ?? '';
      value = value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity) => {
        if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1)));
        return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[entity.toLowerCase()];
      });
      assert.ok(!value.includes('&'), 'unsupported script entity');
      attrs[key] = value; rest = rest.slice(attr[0].length);
    }
    const closing = /<\/script\s*>/gi; closing.lastIndex = tags.lastIndex;
    const end = closing.exec(source);
    assert.ok(end, 'malformed unclosed script');
    const body = source.slice(tags.lastIndex,end.index);
    assert.ok(!attrs.type || ['module','text/javascript','application/javascript'].includes(attrs.type.toLowerCase()), 'unsupported script type');
    if (Object.hasOwn(attrs,'src')) {
      assert.ok(attrs.src && !body.trim(), 'unsupported script src/body');
      scripts.push({src:attrs.src});
    } else scripts.push({source:body, type:attrs.type?.toLowerCase() === 'module' ? 'module' : 'script'});
    tags.lastIndex = closing.lastIndex;
  }
  // A script opener skipped by the bounded tokenizer must not disappear.
  const openers = source.replace(/<!--[\s\S]*?-->/g,'').match(/<script\b/gi) || [];
  assert.equal(scripts.length,openers.length,'unsupported HTML script syntax');
  return scripts;
}
function incomingExclusions(files, oldFilter = false, removeEdge = true) {
  const seen = [];
  for (let [filename, source] of files) {
    if (!(oldFilter ? /\.js$/ : /\.(?:js|jsw|html)$/).test(filename)) continue;
    seen.push(filename);
    if (filename === ownerConsumer) source = reviewedConsumerBody(source, removeEdge);
    if (filename !== 'velo/backend/invoiceEmailJournal.js') assert.ok(!/\brecoverOwnerInvoiceRequestsOnce\b/.test(source), `forbidden recovery consumer: ${filename}`);
    const privileged = ['velo/backend/issueInvoice.web.js', 'velo/backend/http-functions.js',
         'velo/backend/invoiceEmailJournal.js'].includes(filename);
    if (!privileged) {
    assert.ok(!/\b(?:prepareOwnerInvoiceDispatch|dispatchOwnerInvoice|getOwnerInvoiceDispatch|listOwnerInvoiceReviews|invoiceEmailJournal|post_invoiceEmailJournal)\b/.test(source),
      `forbidden journal consumer: ${filename}`);
    }
    function edge(dependency, node) {
      assert.equal(typeof dependency,'string', `unsupported computed dependency: ${filename}`);
      // Normalize relative segments and URL spelling for classification only;
      // admission below still requires the EXACT reviewed literal target.
      const clean = path.posix.normalize(dependency.replace(/\\/g,'/').split(/[?#]/)[0]);
      const basename = clean.split('/').pop().replace(/\.(?:jsw|js)$/,'');
      if (basename === 'ownerInvoiceCurrentRevision') {
        assert.ok(filename === 'velo/backend/issueInvoice.web.js' && node?.type === 'ImportDeclaration' &&
          dependency === 'backend/ownerInvoiceCurrentRevision' && node.specifiers.length === 2 &&
          node.specifiers.every((s,i) => s.type === 'ImportSpecifier' && s.imported.name === ['associateOwnerInvoiceRevision','readOwnerInvoiceCurrentRevision'][i] && s.local.name === s.imported.name),
        `forbidden owner consumer: ${filename}`);
      }
      if (basename === 'invoiceEmailJournal' && !privileged) assert.fail(`forbidden journal consumer: ${filename}`);
      if (/^issueInvoice(?:\.web)?$/.test(basename)) {
        assert.match(source, /import\s*\{\s*issueInvoice(?:\s+as\s+\w+)?\s*\}\s*from\s*['"]backend\/issueInvoice(?:\.web)?['"]/, filename);
        assert.ok(!/import\s*\(|export\s*\*/.test(source), `indirect invoice consumer: ${filename}`);
        assert.ok(node?.type === 'ImportDeclaration' && /^backend\/issueInvoice(?:\.web)?$/.test(dependency) &&
          node.specifiers.length === 1 && node.specifiers[0].type === 'ImportSpecifier' && node.specifiers[0].imported.name === 'issueInvoice',
        `indirect invoice consumer: ${filename}`);
      }
    }
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
        if (node.source) edge(node.source.value,node);
      } else if (node.type === 'ImportExpression') {
        assert.ok(node.source.type === 'Literal' && typeof node.source.value === 'string', `unsupported computed dependency: ${filename}`);
        edge(node.source.value,node);
      } else if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
        assert.ok(node.arguments.length === 1 && node.arguments[0].type === 'Literal', `unsupported computed dependency: ${filename}`);
        edge(node.arguments[0].value,node);
      }
      if (node.type === 'Identifier' && node.name === 'recoverOwnerInvoiceRequestsOnce' && filename !== 'velo/backend/invoiceEmailJournal.js') assert.fail(`forbidden recovery consumer: ${filename}`);
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
    }
    for (const script of /\.html$/.test(filename) ? htmlScripts(source) : [{source,type:'module'}]) {
      if (script.src !== undefined) edge(script.src,null);
      else walk(parseIncoming(script.source,script.type));
    }
  }
  return seen;
}
function verifyIncomingExclusions() {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const filename = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(filename);
      else if (/\.(?:js|jsw|html)$/.test(filename)) files.push([filename, fs.readFileSync(path.join(root, filename), 'utf8')]);
    }
  }
  walk('velo');
  assert.equal(incomingExclusions(files).length, files.length);
  for (const extension of ['js', 'web.js', 'jsw']) {
    const filename = `velo/backend/inert-consumer.${extension}`;
    const forbidden = [[filename, "import { prepareOwnerInvoiceDispatch as mint } from 'backend/issueInvoice.web'; export const call = mint;"]];
    assert.throws(() => incomingExclusions(forbidden), /forbidden journal consumer/);
    assert.deepEqual(incomingExclusions([[filename, "import { issueInvoice as legacy } from 'backend/issueInvoice.web'; export const call = legacy;"]]), [filename]);
    if (extension === 'jsw') assert.deepEqual(incomingExclusions(forbidden, true), [], 'old JS-only filter misses forbidden JSW');
  }
  const controls = [];
  for (const directory of ['backend','pages']) for (const extension of ['js','web.js','jsw','html']) {
    const filename = `velo/${directory}/n2-control.${extension}`;
    const wrap = s => extension === 'html' ? `<script type="module">${s}</script>` : s;
    for (const [form, make] of [
      ['static',s=>`import * as value from '${s}';`],
      ['reexport',s=>`export * from '${s}';`],
      ['dynamic',s=>`const value = import('${s}');`],
      ['escaped',s=>`const value = import('${s.replace('backend','\\u0062ackend')}');`],
      ['braced-zero',s=>`const value = import('${s.replace('backend','\\u{000000000062}ackend')}');`],
    ]) {
      const id = `${directory}.${extension}.${form}`;
      const bad = [[filename,wrap(make('backend/ownerInvoiceCurrentRevision'))]];
      const good = [[filename,wrap(make('backend/benign'))]];
      assert.deepEqual(incomingExclusions(good),[filename],id+' visited positive');
      assert.throws(()=>incomingExclusions(bad), /forbidden owner consumer/,id+' forbidden edge');
      if (['jsw','html'].includes(extension)) {
        assert.deepEqual(incomingExclusions(bad,true),[],id+' old filter misses edge');
        assert.throws(()=>assert.throws(()=>incomingExclusions(bad,true),/forbidden owner consumer/),{code:'ERR_ASSERTION'},id+' old-filter assertion reversal');
      }
      controls.push(id);
    }
    for (const bad of ["import(target);", "import('backend/' + target);", "import(`backend/benign`);"]) {
      assert.throws(()=>incomingExclusions([[filename,wrap(bad)]]),/unsupported computed dependency/);
    }
    assert.throws(()=>incomingExclusions([[filename,wrap("import('\\u{110000}');")]]),SyntaxError);
    assert.throws(()=>incomingExclusions([[filename,wrap('import {;')]]),SyntaxError);
    if (extension === 'html') {
      for (const quoted of ["'backend/ownerInvoiceCurrentRevision.js'",'"backend/ownerInvoiceCurrentRevision.js"','backend/ownerInvoiceCurrentRevision.js',"'backend/&#111;wnerInvoiceCurrentRevision.js'"]) {
        assert.throws(()=>incomingExclusions([[filename,`<script src=${quoted}></script>`]]),/forbidden owner consumer/);
      }
      assert.deepEqual(incomingExclusions([[filename,'<script src="backend/benign.js"></script>']]),[filename]);
      assert.throws(()=>incomingExclusions([[filename,"<script>import('backend/ownerInvoiceCurrentRevision');</script>"]]),/forbidden owner consumer/);
      assert.deepEqual(incomingExclusions([[filename,"<script>import('backend/benign');</script>"]]),[filename]);
      for (const malformed of ['<script>', '<script src="x" src="y"></script>', '<script type="unknown"></script>', '<script src="&unknown;"></script>']) {
        assert.throws(()=>incomingExclusions([[filename,malformed]]),/malformed|duplicate|unsupported/);
      }
    }
  }
  const consumer = [[ownerConsumer,fs.readFileSync(path.join(root,ownerConsumer),'utf8')]];
  assert.deepEqual(incomingExclusions(consumer),[ownerConsumer],'N2 exact consumer body remains scanned');
  assert.throws(()=>incomingExclusions(consumer,false,false),/forbidden journal consumer/,'N2 exact-edge-removal reversal');
  assert.throws(()=>assert.deepEqual(incomingExclusions(consumer,false,false),[ownerConsumer]),/forbidden journal consumer/,'N2 positive reverses at original exclusion, not syntax');
  assert.equal(new Set(controls).size,40);
  console.log(JSON.stringify({n2IncomingControls:controls,visitedPaths:files.map(([filename])=>filename)}));
  console.log(`PASS N2 incoming exclusions: ${files.length} actual JS/web.js/JSW/HTML files; finite syntax-aware controls`);
}
function resolveFixtureSource(name, importer) {
  assert.ok(typeof name === 'string' && !/[\\?#:]/.test(name), 'unsupported fixture source');
  let filename;
  if (name === 'entry') filename = 'velo/backend/issueInvoice.web.js';
  else if (name.startsWith('backend/')) filename = `velo/${name}`;
  else if (/^\.\.?\//.test(name) && typeof importer === 'string' && importer.startsWith('velo/backend/')) {
    filename = path.posix.join(path.posix.dirname(importer), name);
  } else assert.fail('unsupported fixture source');
  filename = path.posix.normalize(filename);
  if (!filename.endsWith('.js')) filename += '.js';
  assert.ok(['issueInvoice.web', 'http-functions', 'ownerInvoiceCurrentRevision', 'invoiceEmailJournal',
    'bookingCurrentRevision', 'bookingCurrentRevisionStore', 'bookingCurrentRevisionRules']
    .some(leaf => filename === `velo/backend/${leaf}.js`), 'unsupported fixture source');
  return filename;
}
// Source-path controls only: no source reads, linking or backend evaluation.
function verifyFixtureResolution(resolveSource) {
  const parent = 'velo/backend/ownerInvoiceCurrentRevision.js';
  for (const leaf of ['bookingCurrentRevision', 'bookingCurrentRevisionStore', 'bookingCurrentRevisionRules']) {
    assert.equal(resolveSource(`./${leaf}.js`, parent), `velo/backend/${leaf}.js`);
    assert.equal(resolveSource(`backend/${leaf}`, parent), `velo/backend/${leaf}.js`);
    assert.equal(resolveSource(`backend/${leaf}.js`, parent), `velo/backend/${leaf}.js`);
  }
  for (const parent of ['velo/backend/bookingCurrentRevision.js', 'velo/backend/bookingCurrentRevisionStore.js']) {
    assert.equal(resolveSource('./bookingCurrentRevisionRules.js', parent), 'velo/backend/bookingCurrentRevisionRules.js');
  }
  assert.equal(resolveSource('entry'), 'velo/backend/issueInvoice.web.js');
  for (const leaf of ['issueInvoice.web', 'http-functions', 'ownerInvoiceCurrentRevision', 'invoiceEmailJournal']) {
    assert.equal(resolveSource(`backend/${leaf}`), `velo/backend/${leaf}.js`);
  }
  // No actual dependency requires a parent-directory traversal outside backend.
  for (const name of ['../bookingCurrentRevision.js', '../../../bookingCurrentRevision.js',
    './guestBookingAcceptance.js', 'backend/guestBookingAcceptance', 'backend/../pages/x',
    '/velo/backend/bookingCurrentRevision.js', 'file:///x.js', 'https://fixture.invalid/x.js',
    'bookingCurrentRevision', './bookingCurrentRevision.js.js', './bookingCurrentRevision.js?x',
    './bookingCurrentRevision.js#x', '.\\bookingCurrentRevision.js', 'node:fs']) {
    assert.throws(() => resolveSource(name, parent), /unsupported fixture source/);
  }
  assert.throws(() => resolveSource('./bookingCurrentRevision.js'), /unsupported fixture source/);
}
const clone = value => JSON.parse(JSON.stringify(value));
async function load(enabled = true, entry = 'entry', identity = legacyIdentity) {
  verifyFixtureResolution(resolveFixtureSource);
  const context = vm.createContext({ Buffer, console });
  const modules = new Map();
  const synthetic = (name, exports) => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context, identifier: name });
  const fixtures = {
    'wix-web-module': { Permissions: { Admin: 'Admin' }, webMethod: (permission, callback) => async (...args) => {
      assert.equal(permission, 'Admin');
      if (identity.role !== 'Admin') throw new Error('platform_denied');
      return callback(...args);
    } },
    'wix-users-backend': { currentUser: { get id() { return identity.id; }, get loggedIn() { return identity.loggedIn; } } },
    'wix-fetch': { fetch: (...args) => { externalTrace.push(['fetch', ...args]); if (dispatchFetch) return dispatchFetch(...args); throw new Error('NETWORK_DENIED'); } },
    'wix-secrets-backend': { getSecret: name => { externalTrace.push(['secret', name]); if (dispatchFetch && name === 'WBE_INVOICE_SERVICE_URL') return 'https://fixture.invalid'; if (process.env.ENDPOINT_FIXTURE || bridgeSecrets || dispatchFetch) return 'fixture-only'; throw new Error('SECRET_DENIED'); } },
    'wix-http-functions': { response: value => value },
    'backend/settings.web': { getAllSettings: () => { throw new Error('SETTINGS_DENIED'); } },
    crypto: { createHash: crypto.createHash, timingSafeEqual: crypto.timingSafeEqual },
    'wix-data': { default: {
      query(collection) {
        assert.equal(collection, 'InvoiceEmailJournal');
        let cursor = null, kind = 'ISSUANCE';
        const q = {
          eq(k, v) { assert.equal(k, 'kind'); assert.ok(['ISSUANCE','REQUEST'].includes(v)); kind = v; return q; },
          ascending(k) { assert.equal(k, '_id'); return q; },
          limit(n) { assert.equal(n, 2); return q; },
          gt(k, v) { assert.equal(k, '_id'); cursor = v; return q; },
          async find(options) {
            assert.deepEqual(clone(options), {suppressAuth:true,suppressHooks:true,consistentRead:true});
            trace.push(['query', collection, cursor]);
            if (nativeFault) nativeFault();
            const all = [...rows.values()].filter(r => r.kind === kind && (cursor === null || r._id > cursor)).sort((a,b) => a._id.localeCompare(b._id));
            const page = {items: clone(all.slice(0,2)), hasNext: () => all.length > 2};
            return queryHook ? queryHook(page) : page;
          }
        }; return q;
      },
      async insert(collection, record, options) {
        trace.push(['insert', collection, record._id]);
        if (nativeFault) nativeFault();
        assert.equal(collection, 'InvoiceEmailJournal');
        assert.deepEqual(clone(options), { suppressAuth: true, suppressHooks: true });
        if (record.kind === 'ISSUANCE' && (failRoot ||
            (process.env.ENDPOINT_FIXTURE && process.env.ENDPOINT_FAULT === 'lowest_request_insert' &&
             record._id === [...rows.values()].filter(r => r.kind === 'REQUEST')
               .sort((a,b) => a._id.localeCompare(b._id))[0]?.issuanceId))) throw new Error('fixture_root_offline');
        if (rows.has(record._id)) throw new Error('duplicate');
        rows.set(record._id, clone(record));
        if (insertHook) await insertHook(record);
        if (loseRootAck && record.kind === 'ISSUANCE') throw new Error('fixture_root_lost_ack');
        if (loseRequestAck && record.kind === 'REQUEST') throw new Error('fixture_lost_ack');
        return clone(record);
      },
      async get(collection, id, options) {
        trace.push(['get', collection, id]);
        if (nativeFault) nativeFault();
        assert.equal(collection, 'InvoiceEmailJournal');
        assert.equal(options.consistentRead, true);
        if (getHook) return getHook(id);
        return rows.has(id) ? clone(rows.get(id)) : null;
      },
    } },
  };
  async function resolve(name, importer) {
    const fixture = Object.hasOwn(fixtures, name);
    const filename = fixture ? name : resolveFixtureSource(name, importer?.identifier);
    if (modules.has(filename)) return modules.get(filename);
    let module;
    if (fixture) module = synthetic(name, fixtures[name]);
    else {
      let source = fs.readFileSync(path.join(root, filename), 'utf8');
      // Only activation is substituted. No validator, authority or writer is replaced.
      if (enabled) source = source.replace('const OWNER_INVOICE_JOURNAL_ENABLED = false;', 'const OWNER_INVOICE_JOURNAL_ENABLED = true;');
      if (enabled) source = source.replace('const OWNER_INVOICE_REQUEST_RECOVERY_ENABLED = false;', 'const OWNER_INVOICE_REQUEST_RECOVERY_ENABLED = true;');
      module = new vm.SourceTextModule(source, { context, identifier: filename });
    }
    modules.set(filename, module);
    await module.link(resolve);
    return module;
  }
  const module = await resolve(entry);
  await module.evaluate();
  return module.namespace;
}
const command = {
  requestId: '12345678-1234-4234-8234-123456789abc',
  revision: '22345678-1234-4234-8234-123456789abc',
  invoiceNumber: 'TEST-OWNER-1', issueDate: '2026-09-07',
  guest: { name: 'Fixture Guest', email: 'guest@example.invalid', phone: '1234567890' },
  checkIn: '2026-10-01', checkOut: '2026-10-02', roomCode: 'Fixture',
  purpose: 'guest_invoice', payments: [],
  financial: { currency: 'USD', components: { grossCents: 10000, discountCents: 0, roomTotalCents: 10000,
    propertyFeeCents: 500, accommodationVatCents: 1000, packageVatCents: 0, totalVatCents: 1000, grandTotalCents: 11500 },
    lines: [{ label: 'Fixture room', taxClass: 'accommodation', quantity: 1, roomQuantity: 1,
      unitPriceCents: 10000, netCents: 10000, vatCents: 1000, grossCents: 11000, vatRateBasisPoints: 1000 }] },
};
async function verifyConcurrentIdentities() {
  const identityA = Object.freeze({role:'Admin',id:'fixture-admin',loggedIn:true});
  const identityB = Object.freeze({role:'Admin',id:'second-admin',loggedIn:true});
  const a = await load(true,'entry',identityA), b = await load(true,'entry',identityB);
  assert.notEqual(identityA,identityB); assert.ok(Object.isFrozen(identityA) && Object.isFrozen(identityB));
  assert.notEqual(a,b); assert.notEqual(a.prepareOwnerInvoiceDispatch,b.prepareOwnerInvoiceDispatch);
  const inputA = clone(command), inputB = {...clone(command),requestId:'d2345678-1234-4234-8234-123456789abc'};
  const deferred = () => {let resolve; const promise = new Promise(r=>{resolve=r;}); return {promise,resolve};};
  const arrivedA=deferred(), arrivedB=deferred(), releaseA=deferred(), releaseB=deferred(), rootStored=deferred();
  let timer, rootSnapshot, rootsStored=0;
  const watchdog=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CI1 barrier timeout NOT causal evidence')),5000);});
  const bounded=p=>Promise.race([p,watchdog]);
  const before=trace.length, outside=externalTrace.length;
  let first,second,winners;
  insertHook=async record=>{
    if(record.kind==='REQUEST' && record.actorId===identityA.id && record.requestId===inputA.requestId) {arrivedA.resolve();await releaseA.promise;}
    if(record.kind==='REQUEST' && record.actorId===identityB.id && record.requestId===inputB.requestId) {arrivedB.resolve();await releaseB.promise;}
    if(record.kind==='ISSUANCE') {rootsStored++;rootSnapshot=clone(rows.get(record._id));rootStored.resolve();}
  };
  try {
    first=a.prepareOwnerInvoiceDispatch(inputA); first.catch(()=>{});
    await bounded(arrivedA.promise);
    second=b.prepareOwnerInvoiceDispatch(inputB); second.catch(()=>{});
    await bounded(arrivedB.promise);
    assert.equal([...rows.values()].filter(r=>r.kind==='REQUEST').length,2,'CI1 both active native REQUEST barriers');
    assert.equal([...rows.values()].filter(r=>r.kind==='ISSUANCE').length,0);
    releaseA.resolve(); await bounded(rootStored.promise); releaseB.resolve();
    winners=await bounded(Promise.all([first,second]));
    assert.ok(winners.every(r=>r.status==='durably_prepared'),'CI1 actual callback discriminators');
    assert.equal(winners[0].documentDigest,winners[1].documentDigest); assert.equal(winners[0].revision,winners[1].revision);
    assert.deepEqual([...rows.values()].filter(r=>r.kind==='REQUEST').map(r=>[r.actorId,r.requestId]).sort(),
      [[identityA.id,inputA.requestId],[identityB.id,inputB.requestId]].sort());
    assert.deepEqual(trace.slice(before).filter(t=>t[0]==='insert' && t[2]===winners[0].issuanceId),
      [['insert','InvoiceEmailJournal',winners[0].issuanceId],['insert','InvoiceEmailJournal',winners[0].issuanceId]],'CI1 both native root attempts');
    assert.equal(rootsStored,1,'CI1 one successful native root insertion');
    assert.deepEqual(rows.get(winners[0].issuanceId),rootSnapshot,'CI1 winner unchanged after B duplicate reconciliation');
    assert.equal(externalTrace.length,outside);
  } finally {
    releaseA.resolve();releaseB.resolve();insertHook=null;
    try {await bounded(Promise.allSettled([first,second].filter(Boolean)));} finally {clearTimeout(timer);}
  }
  // CI2 actual reconstructed contexts, retained shared Map; duplicate attempts allowed.
  const retained=JSON.stringify([...rows]);
  for(const [identity,input,old] of [[identityA,inputA,a],[identityB,inputB,b]]) {
    const fresh=await load(true,'entry',identity);assert.notEqual(fresh,old);assert.notEqual(fresh.prepareOwnerInvoiceDispatch,old.prepareOwnerInvoiceDispatch);
    const replay=await fresh.prepareOwnerInvoiceDispatch(input);
    assert.equal(replay.status,'durably_prepared');assert.equal(replay.issuanceId,winners[0].issuanceId);
    assert.equal(JSON.stringify([...rows]),retained);assert.deepEqual(rows.get(replay.issuanceId),rootSnapshot);
  }
  // CI3 independent authentication state, never role-derived login.
  for(const identity of [Object.freeze({...identityA,loggedIn:false}),Object.freeze({...identityA,role:'Anonymous'}),Object.freeze({...identityA,role:'Member'})]) {
    const denied=await load(true,'entry',identity), before=[trace.length,externalTrace.length];
    await assert.rejects(()=>denied.prepareOwnerInvoiceDispatch(clone(command)),/owner_invoice_actor|platform_denied/);
    assert.deepEqual([trace.length,externalTrace.length],before);assert.equal(JSON.stringify([...rows]),retained);
  }
  assert.equal((await b.prepareOwnerInvoiceDispatch(inputB)).status,'durably_prepared');
  // CI4 negative-only session changes during actual awaited SDK readback.
  for(const mode of ['id','logout']) {
    const session={...identityA};const drifted=await load(true,'entry',session);
    let reads=0;
    getHook=async id=>{reads++; if(mode==='id') session.id='drifted-admin';else session.loggedIn=false;return rows.has(id)?clone(rows.get(id)):null;};
    try {await assert.rejects(()=>drifted.prepareOwnerInvoiceDispatch(inputA),/owner_invoice_actor/);}
    finally {getHook=null;}
    assert.ok(reads>0,'CI4 actual readback reached');assert.deepEqual(identityB,{role:'Admin',id:'second-admin',loggedIn:true});
    assert.equal(JSON.stringify([...rows]),retained,'CI4 replay denial does not fabricate rollback');
    assert.equal((await b.prepareOwnerInvoiceDispatch(inputB)).status,'durably_prepared');
  }
  assert.equal(externalTrace.length,outside);assert.equal(JSON.stringify([...rows]),retained);
  console.log(JSON.stringify({concurrentIdentityCases:['CI1','CI2','CI3','CI4'],moduleContextsOnly:true}));
  return winners;
}
async function verifyRequestRecovery() {
  for (const purpose of ['guest_invoice', 'owner_copy']) {
    rows.clear();
    let admin = await load();
    let input = {...clone(command), purpose, requestId: command.requestId.toUpperCase(), revision: command.revision.toUpperCase(),
      payments: [{datePaid:'2026-09-07',paymentAmountCents:200},{datePaid:'2026-09-06',paymentAmountCents:100}]};
    failRoot = true;
    await assert.rejects(() => admin.prepareOwnerInvoiceDispatch(input), /unavailable/);
    failRoot = false;
    const retained = JSON.stringify([...rows]);
    const request = clone([...rows.values()][0]);
    rows.clear(); for (const [id,row] of JSON.parse(retained)) rows.set(id,row);
    admin = null; input = null;
    const fresh = await load(true, 'backend/invoiceEmailJournal');
    assert.equal(typeof fresh.recoverOwnerInvoiceRequestsOnce, 'function', 'RR01 missing private REQUEST recovery export');
    const before = trace.length, outside = externalTrace.length;
    const report = clone(await fresh.recoverOwnerInvoiceRequestsOnce(null));
    assert.equal(report.status, 'ok');
    assert.equal(report.outcomes[0].result, 'recovered');
    const rootRow = rows.get(request.issuanceId);
    assert.equal(rootRow.document, request.document); assert.equal(rootRow.documentDigest, request.documentDigest);
    assert.equal(rootRow.actorId, request.actorId);
    assert.equal(rootRow.to, purpose === 'owner_copy' ? 'info@wanderlustcaribbean.com' : 'guest@example.invalid');
    assert.equal(rootRow.cc, purpose === 'owner_copy' ? '' : 'info@wanderlustcaribbean.com');
    assert.deepEqual(rows.get(request._id), request);
    assert.deepEqual(trace.slice(before).filter(t=>t[0]==='insert'), [['insert','InvoiceEmailJournal',request.issuanceId]]);
    assert.equal(externalTrace.length, outside);
  }
  rows.clear(); console.log('PASS RR01 actual Admin REQUEST -> serialized storage -> fresh private recovery; both purposes');
  const covered = ['RR01'];
  const restore = saved => { rows.clear(); for (const [id,row] of JSON.parse(saved)) rows.set(id,row); };
  const fresh = () => load(true, 'backend/invoiceEmailJournal');
  const savedGet = id => rows.has(id) ? clone(rows.get(id)) : null;
  async function retain(input = clone(command)) {
    failRoot = true;
    try { await assert.rejects(() => (async()=> (await load()).prepareOwnerInvoiceDispatch(input))(), /unavailable/); }
    finally { failRoot = false; }
    return [...rows.values()].find(r=>r.kind==='REQUEST' && r.requestId===input.requestId && r.actorId===actor);
  }
  async function run(cursor = null) {
    const journal = await fresh(), before = trace.length, outside = externalTrace.length;
    const result = clone(await journal.recoverOwnerInvoiceRequestsOnce(cursor));
    const calls = trace.slice(before);
    assert.equal(result.snapshot,false); assert.equal(result.sdkOperations,calls.length);
    assert.ok(calls.length<=24); assert.ok(result.pages<=2); assert.ok(result.examined<=4);
    assert.ok(result.insertAttempts<=1); assert.equal(result.insertAttempts,calls.filter(t=>t[0]==='insert').length);
    assert.ok(calls.every(t=>t[1]==='InvoiceEmailJournal' && ['get','query','insert'].includes(t[0])));
    assert.equal(externalTrace.length,outside);
    assert.ok(!/"(?:document|actorId|to|cc|from|financial|grant|won|providerMessageId)"/.test(JSON.stringify(result)));
    return result;
  }
  async function noWrite() { const before=trace.length; const result=await run(); assert.equal(trace.slice(before).filter(t=>t[0]==='insert').length,0); return result; }
  loseRequestAck=true;
  getHook=id=>rows.get(id)?.kind==='REQUEST' ? (()=>{throw Error('readback');})() : savedGet(id);
  await assert.rejects(()=>(async()=> (await load()).prepareOwnerInvoiceDispatch(clone(command)))(),/readback/);
  getHook=null; loseRequestAck=false;
  assert.equal(rows.size,1); restore(JSON.stringify([...rows])); assert.equal((await run()).status,'ok');
  rows.clear(); let requestCalls=0; nativeFault=()=>{if(++requestCalls===2)throw Error('no request insertion');};
  await assert.rejects(()=>(async()=> (await load()).prepareOwnerInvoiceDispatch(clone(command)))()); nativeFault=null;
  assert.equal((await noWrite()).cycleEndObserved,true); covered.push('RR02');
  rows.clear(); const request=await retain(), saved=JSON.stringify([...rows]);
  for (const mode of ['ack-loss','throw','undefined','null','rejected']) {
    restore(saved); loseRootAck=mode==='ack-loss'; failRoot=mode==='rejected'; let inserted=false;
    insertHook=()=>{inserted=true;};
    getHook=id=>id===request.issuanceId && inserted && ['throw','undefined','null'].includes(mode) ?
      (mode==='throw'?(()=>{throw Error('readback');})():mode==='null'?null:undefined) : savedGet(id);
    const result=await run(); assert.equal(result.status,mode==='ack-loss'?'ok':'partial');
    insertHook=null;getHook=null;loseRootAck=false;failRoot=false;
    if(mode!=='rejected') { restore(JSON.stringify([...rows])); assert.equal((await noWrite()).outcomes[0].result,'already_present'); }
    else assert.equal((await run()).outcomes[0].result,'recovered');
  }
  covered.push('RR03');
  restore(saved); const a=await fresh(), b=await fresh(); assert.notEqual(a.recoverOwnerInvoiceRequestsOnce,b.recoverOwnerInvoiceRequestsOnce);
  const concurrent=await Promise.all([a.recoverOwnerInvoiceRequestsOnce(null),b.recoverOwnerInvoiceRequestsOnce(null)]);
  assert.ok(concurrent.every(x=>x.outcomes[0].result==='recovered')); assert.equal([...rows.values()].filter(r=>r.kind==='ISSUANCE').length,1);
  restore(saved); actor='second-admin'; await retain(); actor='fixture-admin';
  const differentAdminA=await fresh(),differentAdminB=await fresh();
  const firstRequestId=[...rows.keys()].sort()[0];
  const differentAdminRace=await Promise.all([differentAdminA.recoverOwnerInvoiceRequestsOnce(null),differentAdminB.recoverOwnerInvoiceRequestsOnce(firstRequestId)]);
  assert.ok(differentAdminRace.every(r=>r.outcomes.some(o=>o.result==='recovered')));
  const winner=clone(rows.get(request.issuanceId));
  assert.equal([...rows.values()].filter(r=>r.kind==='ISSUANCE').length,1);
  assert.equal((await noWrite()).status,'ok'); assert.deepEqual(rows.get(winner._id),winner);
  for(const lost of [false,true]) {
    restore(saved);loseRootAck=lost;insertHook=r=>{rows.get(r._id).actorId='other-creator';};
    assert.equal((await run()).status,lost?'ok':'partial');insertHook=null;loseRootAck=false;
  }
  covered.push('RR04');
  const negatives=[r=>{r._id='a'.repeat(64);},r=>{r.kind='BAD';},r=>{r.actorId=false;},r=>{r.requestId=[];},
    r=>{r.issuanceId='a'.repeat(64);},r=>{r.documentDigest='a'.repeat(64);},r=>{r.extra=1;},
    r=>{r.document=' '+r.document;}, ...['guest','revision','purpose','payments','financial'].map(field=>r=>{
      const d=JSON.parse(r.document); if(field==='guest')d.guest.email='changed@example.invalid';
      else if(field==='revision')d.revision=crypto.randomUUID(); else if(field==='purpose')d.purpose='owner_copy';
      else if(field==='payments')d.payments=[{datePaid:'2026-09-07',paymentAmountCents:1}]; else d.financial.components.grandTotalCents++;
      r.document=JSON.stringify(d);
    })];
  for(const mutate of negatives) {restore(saved);getHook=id=>{const row=savedGet(id);if(id===request._id)mutate(row);return row;};assert.equal((await noWrite()).status,'partial');getHook=null;}
  restore(saved);getHook=id=>{const row=savedGet(id);if(row){row._owner=null;row._createdDate=new Date();}return row;};assert.equal((await run()).status,'ok');getHook=null;
  const enabled=await fresh();for(const bad of [undefined,{},[],new String('a'.repeat(64)),'A'.repeat(64)]){const before=trace.length;await assert.rejects(()=>enabled.recoverOwnerInvoiceRequestsOnce(bad));assert.equal(trace.length,before);}
  await assert.rejects(()=>enabled.recoverOwnerInvoiceRequestsOnce(null,request)); covered.push('RR05.partial');
  const rootSaved=JSON.stringify([...rows]);
  for(const mutate of [r=>{r.documentDigest='0'.repeat(64);},r=>{r.to='other@example.invalid';},r=>{r.purpose='owner_copy';},r=>{r.actorId=false;}]){restore(rootSaved);mutate(rows.get(request.issuanceId));assert.equal((await noWrite()).status,'partial');}
  for(const id of [request._id,request.issuanceId])for(const value of [undefined,false,'throw']){restore(saved);getHook=k=>k===id?(value==='throw'?(()=>{throw Error('unknown');})():value):savedGet(k);assert.equal((await noWrite()).status,'partial');getHook=null;}
  covered.push('RR06');
  for(const ns of ['invoice-artifact/v1','invoice-send-start/v1','invoice-send-ack/v1'])for(const value of [{kind:'negative orphan'},undefined,false]){
    restore(saved);const id=crypto.createHash('sha256').update(JSON.stringify([ns,request.issuanceId])).digest('hex');
    getHook=k=>k===id?value:savedGet(k);const before=trace.length;assert.equal((await noWrite()).status,'partial');
    assert.ok(trace.slice(before).every(t=>t[0]!=='get'||[request._id,request.issuanceId,...['invoice-artifact/v1','invoice-send-start/v1','invoice-send-ack/v1'].map(n=>crypto.createHash('sha256').update(JSON.stringify([n,request.issuanceId])).digest('hex'))].includes(t[2])));getHook=null;
  }
  covered.push('RR09');
  rows.clear();for(let i=0;i<5;i++)await retain({...clone(command),invoiceNumber:'RR-BOUND-'+i,requestId:crypto.randomUUID()});
  const many=JSON.stringify([...rows]); const maximum=await run();assert.equal(maximum.sdkOperations,24);assert.equal(maximum.examined,4);assert.equal(maximum.pages,2);assert.equal(maximum.deferred.length,3);assert.equal(maximum.cycleEndObserved,false);assert.ok(maximum.nextCursor);
  for(const mutate of [p=>({...p,items:[p.items[0],p.items[0]]}),p=>({...p,items:p.items.slice().reverse()}),p=>({...p,items:[...p.items,p.items[0]]}),p=>({...p,items:[{...p.items[0],kind:'ISSUANCE'}]}),p=>({...p,hasNext:()=>1}),()=>({items:[],hasNext:()=>true}),()=>{throw Error('query');}]){
    restore(many);queryHook=mutate;const result=await noWrite();assert.equal(result.status,'unavailable');assert.equal(result.nextCursor,null);queryHook=null;
  }
  restore(many);const ordered=[...rows.keys()].sort();getHook=id=>id===ordered[1]?undefined:savedGet(id);assert.equal((await noWrite()).status,'partial');getHook=null;
  restore(many);let pages=0;queryHook=p=>++pages===2?{...p,hasNext:()=>1}:p;const earlier=await run();queryHook=null;assert.equal(earlier.status,'unavailable');assert.equal(earlier.insertAttempts,1);assert.equal(earlier.nextCursor,ordered[1]);
  rows.clear();assert.equal((await noWrite()).cycleEndObserved,true);covered.push('RR10');
  for(let fault=1;fault<=24;fault++){restore(many);let n=0;nativeFault=()=>{if(++n===fault)throw Error('SDK boundary');};const result=await run();nativeFault=null;assert.ok(['partial','unavailable'].includes(result.status));}
  covered.push('RR11');
  const off=await load(false,'backend/invoiceEmailJournal'), before=trace.length,outside=externalTrace.length;
  assert.deepEqual(clone(await off.recoverOwnerInvoiceRequestsOnce({kind:'REQUEST'},{})),{status:'disabled'});
  assert.equal(trace.length,before);assert.equal(externalTrace.length,outside);covered.push('RR12');
  const canonical = v => Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`:JSON.stringify(v);
  const sha = v => crypto.createHash('sha256').update(v).digest('hex');
  const key = (ns,id)=>sha(JSON.stringify([ns,id]));
  for (const laterAck of [false,true]) {
    rows.clear(); const admin=await load(); const parent=await admin.prepareOwnerInvoiceDispatch(clone(command));
    const childInput={...clone(command),requestId:crypto.randomUUID(),revision:crypto.randomUUID(),parentIssuanceId:parent.issuanceId,reissueReason:'explicit retained child'};
    const child=await retain(childInput);const childBytes=JSON.stringify(child);
    const journal=await fresh(), id=parent.issuanceId, rootRow=rows.get(id);
    const op=(operation,payload)=>journal.invoiceJournalOperation({operation,issuanceId:id,payload});
    const bytes=Buffer.from('inert actual effect writer fixture'),digest=sha(bytes);
    const chunk={_id:key('invoice-artifact-chunk/v1',digest),kind:'ARTIFACT_CHUNK',data:bytes.toString('base64'),digest};
    await op('putChunk',chunk);
    const manifest={_id:key('invoice-artifact/v1',id),kind:'ARTIFACT',issuanceId:id,documentDigest:rootRow.documentDigest,to:rootRow.to,cc:rootRow.cc,from:rootRow.from,chunkIds:[chunk._id],mimeDigest:digest,byteLength:bytes.length,pdfDigest:sha('PDF fixture'),rendererVersion:'RR/v1'};
    const state=await op('commitArtifact',manifest);
    assert.equal((await op('tryStart',{artifactDigest:state.artifactDigest,workerBootId:'RR-boot',invocationNonce:'RR-nonce'})).won,true);
    const ack={artifactDigest:state.artifactDigest,invocationNonce:'RR-nonce',providerMessageId:'RR-message'};
    if(laterAck)await op('recordAck',ack);
    else await assert.rejects(()=>admin.prepareOwnerInvoiceDispatch({...childInput,requestId:crypto.randomUUID(),revision:crypto.randomUUID()}),/owner_review_required/);
    restore(JSON.stringify([...rows]));const before=trace.length;const recovered=await run();
    assert.equal(recovered.outcomes.find(x=>x.issuanceId===child.issuanceId).result,'recovered');
    assert.equal(JSON.stringify(rows.get(child._id)),childBytes);
    assert.equal(rows.get(child.issuanceId).document,child.document);
    assert.ok(!trace.slice(before).some(t=>t[0]==='get'&&[manifest._id,chunk._id,key('invoice-send-start/v1',id),key('invoice-send-ack/v1',id)].includes(t[2])));
    const snapshot=JSON.stringify([...rows]);await noWrite();assert.equal(JSON.stringify([...rows]),snapshot);
    assert.equal((await (await fresh()).ownerInvoiceReview(id)).status,laterAck?'provider_accepted':'owner_review_required');
    if(!laterAck){await op('recordAck',ack);await noWrite();assert.equal((await (await fresh()).ownerInvoiceReview(id)).status,'provider_accepted');}
  }
  covered.push('RR07','RR08');
  // RR05 complete escaped application envelope: build via actual Admin writer.
  rows.clear();
  const large=clone(command);
  large.financial.lines=Array.from({length:80},(_,i)=>({...clone(command.financial.lines[0]),label:'x',...(i?{unitPriceCents:0,netCents:0,vatCents:0,grossCents:0}:{})}));
  large.financial.lines[0].label='"';
  function fillLabels(n){for(let i=1;i<80;i++){const count=Math.min(1999,n);large.financial.lines[i].label='x'+'x'.repeat(count);n-=count;}assert.equal(n,0);}
  function envelopes(){const {requestId,...facts}=large,document=canonical({schema:'owner-invoice-document/v1',...facts}),documentDigest=sha(document),issuanceId=sha(canonical(['owner-invoice-revision/v1',facts.invoiceNumber,facts.revision]));
    return [{_id:sha(canonical(['owner-invoice-request/v1',actor,requestId])),kind:'REQUEST',actorId:actor,requestId,issuanceId,documentDigest,document},
      {_id:issuanceId,kind:'ISSUANCE',actorId:actor,document,documentDigest,purpose:facts.purpose,to:facts.guest.email,cc:'info@wanderlustcaribbean.com',from:'info@wanderlustcaribbean.com'}];}
  fillLabels(0);const base=Math.max(...envelopes().map(x=>Buffer.byteLength(canonical(x))));
  fillLabels(160000-base);assert.equal(Math.max(...envelopes().map(x=>Buffer.byteLength(canonical(x)))),160000);
  const largeRequest=await retain(large);const exactLarge=JSON.stringify([...rows]);assert.equal((await run()).status,'ok');
  restore(exactLarge);fillLabels(160001-base);const oversized=envelopes()[0];
  assert.equal(Math.max(...envelopes().map(x=>Buffer.byteLength(canonical(x)))),160001);
  // Mutated storage is a negative integrity fixture, not imported authority.
  rows.set(largeRequest._id,oversized);assert.equal((await noWrite()).status,'partial');
  covered[covered.indexOf('RR05.partial')]='RR05';
  // Baseline-GREEN promotion of the external RR05/RR10 coverage probes.
  {
    rows.clear();
    const orderRequest = await retain({...clone(command), payments:[{datePaid:'2026-09-07',paymentAmountCents:200},{datePaid:'2026-09-06',paymentAmountCents:100}]});
    const orderedStorage=JSON.stringify([...rows]);
    const document=JSON.parse(orderRequest.document);
    assert.equal(document.payments.length,2);
    assert.equal(canonical(document),orderRequest.document);
    document.payments.reverse();
    const reversedDocument=canonical(document);
    assert.notEqual(reversedDocument,orderRequest.document);
    document.payments.reverse();
    assert.equal(canonical(document),orderRequest.document, 'RR05 reversal preserves every other document byte');
    getHook=id=>{const row=savedGet(id);if(id===orderRequest._id){row.document=reversedDocument;assert.deepEqual({...row,document:orderRequest.document},orderRequest);}return row;};
    let swapped;
    try { swapped=await noWrite(); } finally { getHook=null; }
    assert.equal(swapped.status,'partial');assert.equal(swapped.outcomes[0].result,'unresolved');
    assert.equal(JSON.stringify([...rows]),orderedStorage);
    console.log('PASS RR05 payment-order-only tamper: partial/unresolved, zero writes, retained bytes unchanged');
    assert.match(orderRequest._id,/^[a-f0-9]{64}$/);
    queryHook=()=>({items:[clone(orderRequest)],hasNext:()=>false});
    const beforeStale=trace.length;
    let stale;
    try { stale=await run(orderRequest._id); } finally { queryHook=null; }
    assert.equal(stale.status,'unavailable');assert.equal(stale.nextCursor,orderRequest._id);
    assert.equal(stale.insertAttempts,0);assert.equal(stale.examined,0);
    assert.deepEqual(trace.slice(beforeStale),[['query','InvoiceEmailJournal',orderRequest._id]]);
    assert.equal(JSON.stringify([...rows]),orderedStorage);
    console.log('PASS RR10 equal-to-input-cursor page: unavailable, cursor retained, zero writes/candidates');
  }
  assert.equal(new Set(covered).size,12);
  rows.clear();
  console.log(JSON.stringify({requestRecoveryCoverage:covered,maximumSdkOperations:maximum.sdkOperations,remaining:[]}));
}
(async () => {
  if (process.env.ENDPOINT_FIXTURE) {
    const file = process.env.ENDPOINT_FIXTURE;
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      saved.rows.forEach(row => rows.set(row._id, row));
      trace.push(...saved.trace);
    }
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    // Inert persistence-boundary failures, after actual native fixture insertion.
    let insertedStart = false;
    insertHook = async record => {
      if (record.kind !== 'START') return;
      insertedStart = true;
      if (process.env.ENDPOINT_FAULT === 'start_insert_ack_loss') throw new Error('inert_insert_ack_loss');
    };
    getHook = async id => {
      const record = rows.get(id);
      if (insertedStart && record?.kind === 'START' && process.env.ENDPOINT_FAULT === 'start_readback_loss') {
        throw new Error('inert_readback_loss');
      }
      return record ? clone(record) : null;
    };
    // Fault only the admission SDK boundary; never substitute module reports.
    if (input.fixturePayload?.operation === 'recoverRequests') {
      if (process.env.ENDPOINT_FAULT === 'stage_after_absence') {
        const request = [...rows.values()].find(r => r.kind === 'REQUEST');
        const sha = value => crypto.createHash('sha256').update(value).digest('hex');
        const key = (ns, id) => sha(JSON.stringify([ns, id]));
        const target = key('invoice-send-ack/v1', request.issuanceId);
        let scheduled = false;
        getHook = async id => {
          const observed = rows.has(id) ? clone(rows.get(id)) : null;
          if (id === target && observed === null && !scheduled) {
            scheduled = true; // retained absence response, then another actual writer runs
            assert.equal(rows.has(request.issuanceId), false);
            const admin = await load();
            await admin.prepareOwnerInvoiceDispatch(clone(command));
            const journal = await load(true, 'backend/invoiceEmailJournal');
            const rootRow = rows.get(request.issuanceId);
            const op = (operation, payload) => journal.invoiceJournalOperation({operation, issuanceId: request.issuanceId, payload});
            const bytes = Buffer.from('inert stage scheduling artifact'), digest = sha(bytes);
            const chunk = {_id:key('invoice-artifact-chunk/v1',digest),kind:'ARTIFACT_CHUNK',data:bytes.toString('base64'),digest};
            await op('putChunk',chunk);
            const state = await op('commitArtifact', {_id:key('invoice-artifact/v1',request.issuanceId),kind:'ARTIFACT',issuanceId:request.issuanceId,documentDigest:rootRow.documentDigest,to:rootRow.to,cc:rootRow.cc,from:rootRow.from,chunkIds:[chunk._id],mimeDigest:digest,byteLength:bytes.length,pdfDigest:sha('inert PDF'),rendererVersion:'PR08/v1'});
            assert.equal((await op('tryStart',{artifactDigest:state.artifactDigest,workerBootId:'stage-worker',invocationNonce:'stage-nonce'})).won,true);
          }
          return observed;
        };
      }
      if (process.env.ENDPOINT_FAULT === 'request_unknown') {
        getHook = async id => rows.get(id)?.kind === 'REQUEST' ? undefined :
          (rows.has(id) ? clone(rows.get(id)) : null);
      }
      if (process.env.ENDPOINT_FAULT === 'request_bad_page') {
        queryHook = page => ({...page, hasNext: () => 'unknown'});
      }
    }
    let result;
    if (input.fixture === 'prepare' || input.fixture === 'prepare-request-only' || input.fixture === 'prepare-child-request-only') {
      failRoot = input.fixture !== 'prepare';
      const cmd = clone(command);
      if (input.purpose) cmd.purpose = input.purpose;
      if (input.fixture === 'prepare-child-request-only') {
        cmd.invoiceNumber = JSON.parse(rows.get(input.parentIssuanceId).document).invoiceNumber;
        cmd.parentIssuanceId = input.parentIssuanceId;
        cmd.reissueReason = 'explicit retained child';
      }
      try { result = await (await load()).prepareOwnerInvoiceDispatch(cmd); }
      catch (error) { if (!failRoot) throw error; result = {status: 'retained_request', fixtureError: String(error)}; }
      if (failRoot) assert.ok([...rows.values()].some(r => r.kind === 'REQUEST'));
    } else if (input.fixture === 'status' || input.fixture === 'dispatch-retained') {
      const api = await load();
      const before = trace.length;
      result = await api[input.fixture === 'status' ? 'getOwnerInvoiceDispatch' : 'dispatchOwnerInvoice'](input.issuanceId);
      assert.ok(trace.slice(before).every(call => call[0] === 'get'));
      assert.deepEqual(externalTrace, [], 'retained status/dispatch never wakes sender or reads secrets');
    } else {
      const api = await load(true, 'backend/http-functions');
      const response = await api.post_invoiceEmailJournal({headers: {'x-wbe-secret': input.fixtureSecret === undefined ? 'fixture-only' : input.fixtureSecret}, body: {text: async () => JSON.stringify(input.fixturePayload || input)}});
      assert.equal(response.status, Number(process.env.ENDPOINT_EXPECT_STATUS || 200), response.body);
      result = JSON.parse(response.body);
    }
    fs.writeFileSync(file, JSON.stringify({rows: [...rows.values()], trace}));
    console.log(JSON.stringify(result));
    return;
  }
  await verifyRequestRecovery();
  verifyIncomingExclusions();
  bridgeSecrets = true;
  const bridge = await load(true, 'backend/http-functions');
  for (const supplied of [undefined, '', 'wrong', 'x'.repeat(4097)]) {
    const before = trace.length;
    const response = await bridge.post_invoiceEmailJournal({ headers: {'x-wbe-secret': supplied},
      body: { text: async () => { throw new Error('unauthenticated_body_read'); } } });
    assert.equal(response.status, 401);
    assert.deepEqual(trace.slice(before), []);
    assert.equal(rows.size, 0);
  }
  const invalidBridgeBodies = ['recoverOwnerInvoiceRequestsOnce', 'REQUEST', 'ISSUANCE', 'insert', 'update', 'remove', 'save', 'prepareOwnerIssuance'].map(operation =>
    ({operation, issuanceId: 'a'.repeat(64), payload: {}}));
  for (const cursor of [[], {}, true, 'A'.repeat(64), '']) invalidBridgeBodies.push({operation:'recoverRequests', cursor});
  for (const field of ['callback', 'budget', 'actor', 'document', 'REQUEST', 'issuanceId']) invalidBridgeBodies.push({operation:'recoverRequests', cursor:null, [field]:'forbidden'});
  invalidBridgeBodies.push({operation:'recoverRequests'});
  invalidBridgeBodies.push({operation: 'readIssuance', issuanceId: 'a'.repeat(64), payload: {}, callbackUrl: 'https://forbidden.invalid'},
    {operation: 'insert', collection: 'Bookings', payload: {kind: 'ISSUANCE'}});
  for (const body of invalidBridgeBodies) {
    const before = trace.length;
    const response = await bridge.post_invoiceEmailJournal({headers: {'x-wbe-secret': 'fixture-only'},
      body: {text: async () => JSON.stringify(body)}});
    assert.equal(response.status, 409);
    assert.deepEqual(trace.slice(before), [], 'forbidden bridge command has zero SDK IO');
    assert.equal(rows.size, 0);
  }
  bridgeSecrets = false;
  console.log('PASS N2 actual HTTP bridge: missing/wrong authentication and forbidden creation/write/callback commands, zero SDK IO');
  const api = await load();
  assert.equal(typeof api.listOwnerInvoiceReviews, 'function', 'R1 missing actual Admin list export');
  assert.equal(typeof api.prepareOwnerInvoiceDispatch, 'function', 'missing actual Admin durable prepare export');
  {
  rows.clear();
  const queueRoot = await api.prepareOwnerInvoiceDispatch(clone(command));
  const queueBefore = [trace.length, externalTrace.length];
  const page = clone(await api.listOwnerInvoiceReviews(null));
  assert.equal(page.protocol, 'owner-invoice-review-page/v1');
  assert.equal(page.snapshot, false);
  assert.equal(page.cycleEndObserved, true);
  assert.equal(page.items[0].issuanceId, queueRoot.issuanceId);
  assert.equal(page.items[0].classification, 'pending_prestart');
  assert.ok(trace.slice(queueBefore[0]).every(t => ['get','query'].includes(t[0])));
  assert.equal(externalTrace.length, queueBefore[1]);
  for (const bad of [undefined, [], {}, new String('a'.repeat(64)), 'A'.repeat(64)]) {
    const before = trace.length;
    await assert.rejects(() => api.listOwnerInvoiceReviews(bad), /owner_invoice_/);
    assert.equal(trace.length, before);
  }
  await assert.rejects(() => api.listOwnerInvoiceReviews(null, {}), /cursor/);
  for (const denied of ['Anonymous','Member']) {
    role = denied; const before = trace.length;
    await assert.rejects(() => api.listOwnerInvoiceReviews(null), /platform_denied/);
    assert.equal(trace.length, before);
  }
  role = 'Admin'; actor = '';
  await assert.rejects(() => api.listOwnerInvoiceReviews(null), /actor/);
  actor = 'other-admin';
  await assert.rejects(() => (async () => (await load(false)).listOwnerInvoiceReviews(null))(), /disabled/);
  assert.equal((await api.listOwnerInvoiceReviews(null)).items[0].issuanceId, queueRoot.issuanceId);
  actor = 'fixture-admin';
  assert.deepEqual(Object.keys(page.items[0]).sort(), ['classification','invoiceNumber','issuanceId','needsOwnerReview','purpose','revision','status']);
  for (let index = 0; index < 3; index++) {
    const c = clone(command); c.invoiceNumber = 'QUEUE-' + index; c.requestId = crypto.randomUUID();
    await api.prepareOwnerInvoiceDispatch(c);
  }
  const first = clone(await api.listOwnerInvoiceReviews(null));
  const second = clone(await api.listOwnerInvoiceReviews(first.nextCursor));
  assert.equal(first.items.length, 2); assert.equal(first.cycleEndObserved, false);
  assert.equal(second.items.length, 2); assert.equal(second.cycleEndObserved, true);
  assert.equal(second.nextCursor, null);
  assert.ok(first.items[1].issuanceId < second.items[0].issuanceId);
  assert.equal((await api.listOwnerInvoiceReviews('f'.repeat(64))).items.length, 0);
  for (const mutate of [p => ({...p, hasNext: () => 'yes'}), p => ({items: [], hasNext: () => true}),
    p => ({...p, items: [p.items[0],p.items[0]]}), p => ({...p, items: p.items.slice().reverse()}),
    p => ({...p, items: [{_id: ['a'.repeat(64)],kind:'ISSUANCE'}]}), () => {throw Error('PRIVATE');}]) {
    queryHook = mutate;
    const bad = clone(await api.listOwnerInvoiceReviews(null));
    assert.equal(bad.scanStatus, 'unavailable'); assert.equal(bad.nextCursor, null);
    assert.deepEqual(bad.items, []); assert.equal(bad.cycleEndObserved, false);
  }
  queryHook = null;
  const brokenId = first.items[0].issuanceId;
  const savedRoot = clone(rows.get(brokenId)); rows.get(brokenId).documentDigest = '0'.repeat(64);
  const partial = clone(await api.listOwnerInvoiceReviews(null));
  assert.equal(partial.scanStatus, 'partial'); assert.equal(partial.items.length, 2);
  assert.deepEqual(Object.keys(partial.items[0]).sort(), ['classification','issuanceId','needsOwnerReview','reason','status']);
  assert.equal(partial.items[0].classification, 'unresolved');
  rows.set(brokenId, savedRoot);
  for (const value of [undefined, null]) {
    getHook = id => id === brokenId ? value : (rows.has(id) ? clone(rows.get(id)) : null);
    assert.equal((await api.listOwnerInvoiceReviews(null)).scanStatus, 'partial');
  }
  getHook = null;
  // Behind-cursor concurrent insertion is found after reset, not a snapshot.
  let behind;
  for (let i=0; i<100 && !behind; i++) {
    const c = clone(command); c.invoiceNumber = 'LATE-' + i; c.requestId = crypto.randomUUID();
    const r = await api.prepareOwnerInvoiceDispatch(c);
    if (r.issuanceId < first.nextCursor) behind = r.issuanceId;
  }
  assert.ok(behind);
  const continuation = await api.listOwnerInvoiceReviews(first.nextCursor);
  assert.equal(continuation.snapshot, false);
  let cursor = null, found = false;
  do { const p = await api.listOwnerInvoiceReviews(cursor); found ||= p.items.some(i => i.issuanceId === behind); cursor = p.nextCursor; } while (cursor);
  assert.ok(found);
  rows.clear();
  console.log('PASS R1-R6 bounded queue auth/privacy/keyset/quarantine/reset controls (durable effect histories in Python)');
  }
  // Finite R2-R6 coverage additions: actual writers and Admin reads, baseline-GREEN.
  {
    const covered = [];
    const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    const key = (ns, id) => sha(JSON.stringify([ns, id]));
    const journal = await load(true, 'backend/invoiceEmailJournal');
    const op = (operation, issuanceId, payload) => journal.invoiceJournalOperation({operation, issuanceId, payload});
    const restore = saved => { rows.clear(); for (const [id, value] of JSON.parse(saved)) rows.set(id, value); };
    async function observed(expected, id) {
      const before = trace.length, outside = externalTrace.length, stored = JSON.stringify([...rows]);
      const fresh = await load();
      const page = clone(await fresh.listOwnerInvoiceReviews(null));
      const detail = clone(await fresh.getOwnerInvoiceDispatch(id));
      const item = page.items.find(i => i.issuanceId === id);
      assert.ok(item, 'actual queried root visible');
      for (const result of [item, detail]) {
        assert.equal(result.classification, expected);
        assert.equal(result.needsOwnerReview, ['start_uncertain','unresolved'].includes(expected));
        const fields = expected === 'unresolved' ? ['classification','issuanceId','needsOwnerReview','reason','status'] :
          ['classification','invoiceNumber','issuanceId','needsOwnerReview','purpose','revision','status'];
        if (result === detail && expected === 'ack_provider_accepted') fields.push('providerMessageId');
        assert.deepEqual(Object.keys(result).sort(), fields.sort());
      }
      assert.deepEqual(Object.keys(page).sort(), ['cycleEndObserved','items','nextCursor','protocol','scanStatus','snapshot']);
      assert.equal(page.scanStatus, expected === 'unresolved' ? 'partial' : 'ok');
      assert.equal(page.snapshot, false);
      assert.ok(trace.slice(before).every(t => ['get','query'].includes(t[0])), 'read paths zero mutations');
      assert.equal(externalTrace.length, outside, 'read paths zero secret/service/provider IO');
      assert.equal(JSON.stringify([...rows]), stored);
      assert.ok(!JSON.stringify([page, detail]).includes('PRIVATE_CORRUPTION'));
      return {page, detail};
    }
    async function artifact(id, bytes) {
      const rootRow = rows.get(id), encoded = bytes.toString('base64'), chunkIds = [];
      for (let offset = 0; offset < encoded.length; offset += 100000) {
        const data = encoded.slice(offset, offset + 100000), digest = sha(Buffer.from(data, 'base64'));
        const chunk = {_id:key('invoice-artifact-chunk/v1',digest),kind:'ARTIFACT_CHUNK',data,digest};
        await op('putChunk', id, chunk); chunkIds.push(chunk._id);
      }
      const manifest = {_id:key('invoice-artifact/v1',id),kind:'ARTIFACT',issuanceId:id,
        documentDigest:rootRow.documentDigest,to:rootRow.to,cc:rootRow.cc,from:rootRow.from,
        chunkIds,mimeDigest:sha(bytes),byteLength:bytes.length,pdfDigest:sha('inert PDF'),rendererVersion:'queue-fixture/v1'};
      const state = await op('commitArtifact',id,manifest);
      assert.equal(state.artifact.byteLength,bytes.length);
      return state;
    }
    rows.clear(); bridgeSecrets = true;
    const scanBridge = await load(true, 'backend/http-functions');
    const request = body => ({headers:{'x-wbe-secret':'fixture-only'},body:{text:async()=>JSON.stringify(body)}});
    const mixed = [
      {operation:'scanPending',cursor:null,issuanceId:'a'.repeat(64)},
      {operation:'scanPending',cursor:null,payload:{}},
      {operation:'readIssuance',issuanceId:'a'.repeat(64),payload:{},cursor:null},
      ...['query','collection','url','limit','unknown'].map(k=>({operation:'scanPending',cursor:null,[k]:'PRIVATE_CORRUPTION'}))
    ];
    for (const body of mixed) {
      const before = trace.length;
      const response = await scanBridge.post_invoiceEmailJournal(request(body));
      assert.equal(response.status,409); assert.equal(response.headers['Cache-Control'],'no-store');
      assert.equal(trace.length,before); assert.equal(rows.size,0);
    }
    for (const bad of [new String('a'.repeat(64)), [], {}, undefined]) {
      const before=trace.length;
      await assert.rejects(()=>journal.invoiceJournalOperation({operation:'scanPending',cursor:bad}),/owner_invoice_/);
      assert.equal(trace.length,before);
    }
    for (const enabled of [true,false]) {
      const response = await (await load(enabled,'backend/http-functions')).post_invoiceEmailJournal(request({operation:'scanPending',cursor:null}));
      assert.equal(response.status,enabled?200:503); assert.equal(response.headers['Cache-Control'],'no-store');
    }
    const unauthorized = await scanBridge.post_invoiceEmailJournal({headers:{},body:{text:async()=>{throw Error('must not read');}}});
    assert.equal(unauthorized.status,401); assert.equal(unauthorized.headers['Cache-Control'],'no-store');
    queryHook=()=>{throw Error('PRIVATE_CORRUPTION');};
    const unavailable=await scanBridge.post_invoiceEmailJournal(request({operation:'scanPending',cursor:null}));
    assert.equal(unavailable.headers['Cache-Control'],'no-store');
    assert.equal(JSON.parse(unavailable.body).scanStatus,'unavailable');
    queryHook=null; bridgeSecrets=false;
    covered.push('R2.mixed-variants-zero-sdk','R2.no-store-success-denial-unavailable');
    const rootResult=await api.prepareOwnerInvoiceDispatch(clone(command)), id=rootResult.issuanceId;
    await observed('pending_prestart',id);
    const prepared=await artifact(id,Buffer.from('PRIVATE_CORRUPTION inert MIME bytes'));
    await observed('pending_prestart',id);
    covered.push('R3.artifact-only-actual-writer-list-detail');
    const grant=await op('tryStart',id,{artifactDigest:prepared.artifactDigest,workerBootId:'queue-boot',invocationNonce:'queue-nonce'});
    assert.equal(grant.won,true);
    const provisional=await observed('start_uncertain',id);
    assert.equal(provisional.detail.status,'owner_review_required');
    assert.ok(![...rows.values()].some(r=>['PREP_FAILURE','UNCERTAIN'].includes(r.kind)));
    const startId=key('invoice-send-start/v1',id), ackId=key('invoice-send-ack/v1',id);
    const beforeWrong=JSON.stringify([...rows]);
    await assert.rejects(()=>op('recordAck',id,{artifactDigest:prepared.artifactDigest,invocationNonce:'wrong',providerMessageId:'fixture-late'}),/ack/);
    assert.equal(JSON.stringify([...rows]),beforeWrong);
    await op('recordAck',id,{artifactDigest:prepared.artifactDigest,invocationNonce:'queue-nonce',providerMessageId:'fixture-late'});
    const cleared=await observed('ack_provider_accepted',id);
    assert.equal(cleared.detail.providerMessageId,'fixture-late');
    assert.equal(cleared.page.items[0].status,'provider_accepted');
    // ACK is an inert provider-boundary fact; no provider is invoked by this queue test.
    covered.push('R6.late-bound-ack-clears-fresh-list-detail');
    const retained=JSON.stringify([...rows]), chunkId=prepared.artifact.chunkIds[0];
    const corruptions=[
      ['start-kind',()=>{rows.get(startId).kind='BAD';}],
      ['start-nonce',()=>{rows.get(startId).invocationNonce='';}],
      ['start-artifact-binding',()=>{rows.get(startId).artifactDigest='0'.repeat(64);}],
      ['ack-without-start',()=>rows.delete(startId)],
      ['ack-kind',()=>{rows.get(ackId).kind='BAD';}],
      ['ack-nonce-binding',()=>{rows.get(ackId).invocationNonce='wrong';}],
      ['ack-message-id',()=>{rows.get(ackId).providerMessageId='bad message';}],
      ['ack-recipient-binding',()=>{rows.get(ackId).to='wrong@example.invalid';}],
      ['ack-artifact-binding',()=>{rows.get(ackId).artifactDigest='0'.repeat(64);}],
      ['chunk-missing',()=>rows.delete(chunkId)],
      ['chunk-tampered',()=>{rows.get(chunkId).data='YmFk';}],
      ['root-digest',()=>{rows.get(id).documentDigest='0'.repeat(64);}]
    ];
    for (const [label, corrupt] of corruptions) {
      restore(retained); corrupt(); await observed('unresolved',id); covered.push('R4.'+label);
    }
    for (const target of [id,prepared.artifact._id,chunkId,startId,ackId]) {
      for (const mode of ['undefined','throw']) {
        restore(retained);
        getHook=targetId=>{if(targetId===target){if(mode==='throw')throw Error('PRIVATE_CORRUPTION');return undefined;}return rows.has(targetId)?clone(rows.get(targetId)):null;};
        await observed('unresolved',id); getHook=null;
        covered.push('R4.'+[id,prepared.artifact._id,chunkId,startId,ackId].indexOf(target)+'-'+mode);
      }
    }
    restore(retained); rows.delete(ackId); await observed('start_uncertain',id);
    rows.delete(startId); await observed('pending_prestart',id);
    covered.push('R4.explicit-null-absence-controls');
    rows.clear();
    const maximum=Buffer.alloc(8388608,65);
    for(let index=0;index<2;index++) {
      const c={...clone(command),invoiceNumber:'QUEUE-MAX-'+index,requestId:crypto.randomUUID()};
      const admitted=await api.prepareOwnerInvoiceDispatch(c);
      const state=await artifact(admitted.issuanceId,maximum);
      assert.equal(state.artifact.chunkIds.length,112);
    }
    const beforeMax=trace.length, outsideMax=externalTrace.length;
    const maxPage=await api.listOwnerInvoiceReviews(null);
    assert.equal(maxPage.scanStatus,'ok');assert.equal(maxPage.items.length,2);
    assert.equal(maxPage.cycleEndObserved,true);
    const calls=trace.slice(beforeMax);
    assert.equal(calls.filter(t=>t[0]==='query').length,1);
    assert.equal(calls.filter(t=>t[0]==='get').length,232);
    assert.equal(calls.length,233);assert.ok(calls.length<=265);
    assert.equal(externalTrace.length,outsideMax);
    // 128 is a nominal chunk-count cap, dominated by the actual 8 MiB MIME cap.
    // 127 full nonfinal chunks require 9,525,000 bytes before the last chunk.
    const maximumRoot=[...rows.values()].find(r=>r.kind==='ISSUANCE');
    const maximumManifest=rows.get(key('invoice-artifact/v1',maximumRoot._id));
    maximumManifest.chunkIds=Array(128).fill(maximumManifest.chunkIds[0]);
    const beforeInvalid=trace.length;
    const invalidMaximum=await api.listOwnerInvoiceReviews(null);
    assert.equal(invalidMaximum.scanStatus,'partial');
    assert.equal(invalidMaximum.items.find(i=>i.issuanceId===maximumRoot._id).classification,'unresolved');
    assert.ok(trace.slice(beforeInvalid).length<=265);
    covered.push('R5.reachable-233-sdk-with-nominal-265-ceiling','R5.128-chunk-dominated-limit-denial');
    assert.equal(covered.length,29);
    console.log(JSON.stringify({queueCoverage:covered,validMaximumPageSdkCalls:calls.length,nominalSdkCeiling:265,exact265Reachable:false}));
    rows.clear();
  }
  // A1: actual Admin callback, fresh storage, no JSON transport of test values.
  const identifierCases = [];
  for (const field of ['requestId', 'revision', 'parentIssuanceId']) {
    const valid = field === 'parentIssuanceId' ? 'a'.repeat(64) : command[field];
    for (const [type, value] of [['array', [valid]], ['object', {}], ['null', null],
      ['number', 123], ['boolean', true], ['boxed-string', new String(valid)]]) {
      rows.clear();
      const invalid = clone(command);
      invalid[field] = value;
      if (field === 'parentIssuanceId') invalid.reissueReason = 'explicit';
      const before = trace.length;
      let outcome;
      try { outcome = (await api.prepareOwnerInvoiceDispatch(invalid)).status; }
      catch (error) { outcome = error.message; }
      identifierCases.push({ field, type, outcome, io: trace.slice(before), records: rows.size });
    }
  }
  console.log(JSON.stringify({ identifierCases }));
  assert.equal(identifierCases.length, 18);
  for (const test of identifierCases) {
    assert.equal(test.outcome, test.field === 'parentIssuanceId' ? 'owner_invoice_parent' : 'owner_invoice_uuid',
      `${test.field} ${test.type}: primitive string required`);
    assert.deepEqual(test.io, [], 'invalid identifier must perform zero SDK IO');
    assert.equal(test.records, 0);
  }
  rows.clear();
  const result = await api.prepareOwnerInvoiceDispatch(clone(command));
  assert.equal(result.status, 'durably_prepared');
  assert.match(result.issuanceId, /^[a-f0-9]{64}$/);
  assert.equal(rows.size, 2);
  assert.deepEqual([...rows.values()].map(x => x.kind), ['REQUEST', 'ISSUANCE']);
  const issuance = rows.get(result.issuanceId);
  assert.equal(issuance.actorId, actor);
  assert.equal(issuance.to, command.guest.email);
  assert.equal(issuance.cc, 'info@wanderlustcaribbean.com');
  assert.equal(crypto.createHash('sha256').update(issuance.document).digest('hex'), issuance.documentDigest);
  // Actual missing Admin wiring must fail before implementation (RED).
  for (const method of ['dispatchOwnerInvoice', 'getOwnerInvoiceDispatch']) {
    assert.equal(typeof api[method], 'function', `missing actual Admin ${method} export`);
    for (const deniedRole of ['Anonymous', 'Member']) {
      role = deniedRole;
      const before = [trace.length, externalTrace.length];
      await assert.rejects(() => api[method](result.issuanceId), /platform_denied/);
      assert.deepEqual([trace.length, externalTrace.length], before);
    }
    role = 'Admin'; actor = '';
    const before = [trace.length, externalTrace.length];
    await assert.rejects(() => api[method](result.issuanceId), /actor/);
    actor = 'fixture-admin';
    await assert.rejects(() => (async () => (await load(false))[method](result.issuanceId))(), /disabled/);
    for (const invalid of [[result.issuanceId], {issuanceId: result.issuanceId, actorId: actor}, null, 'A'.repeat(64)]) {
      await assert.rejects(() => api[method](invalid), /owner_invoice_/);
    }
    assert.deepEqual([trace.length, externalTrace.length], before);
    const immutableBefore = JSON.stringify([...rows]);
    const externalBefore = externalTrace.length;
    assert.equal((await api[method]('f'.repeat(64))).classification, 'unresolved');
    assert.equal(externalTrace.length, externalBefore, 'missing root never reaches transport/secrets');
    assert.equal(JSON.stringify([...rows]), immutableBefore);
  }
  const statusBefore = [trace.length, externalTrace.length];
  assert.deepEqual(clone(await api.getOwnerInvoiceDispatch(result.issuanceId)), {
    issuanceId: result.issuanceId, invoiceNumber: command.invoiceNumber, revision: command.revision, purpose: command.purpose, status: 'preparation_retryable', classification: 'pending_prestart', needsOwnerReview: false});
  assert.equal(externalTrace.length, statusBefore[1], 'status never wakes service');
  assert.ok(trace.slice(statusBefore[0]).every(call => call[0] === 'get'));
  dispatchFetch = async (url, options) => {
    assert.equal(url, 'https://fixture.invalid/issue-invoice');
    assert.equal(options.method, 'post');
    assert.equal(options.headers['X-WBE-Secret'], 'fixture-only');
    assert.deepEqual(JSON.parse(options.body), {protocol: 'owner-invoice-journal-v1', issuance_id: result.issuanceId});
    return {ok: true}; // HTTP boundary fixture only; Python endpoint chain tested separately.
  };
  const dispatchBefore = trace.length;
  actor = 'second-admin'; // creator audit is not per-Admin document ownership.
  assert.equal((await api.dispatchOwnerInvoice(result.issuanceId)).status, 'preparation_retryable');
  assert.ok(trace.slice(dispatchBefore).every(call => call[0] === 'get'));
  assert.equal(rows.get(result.issuanceId).actorId, 'fixture-admin');
  actor = 'fixture-admin'; dispatchFetch = null;
  console.log('PASS Admin dispatch/status actual callbacks: default OFF, actor/role/root binding, read-only status, fixed journal payload; synthetic platform/HTTP boundary');
  if (process.env.N3_ROOT_FIXTURE) fs.writeFileSync(process.env.N3_ROOT_FIXTURE, JSON.stringify(issuance));
  actor = 'second-admin';
  assert.equal((await api.prepareOwnerInvoiceDispatch(clone(command))).issuanceId, result.issuanceId,
    'P4 cross-Admin same document must converge');
  assert.equal(rows.get(result.issuanceId).actorId, 'fixture-admin');
  assert.equal([...rows.values()].filter(r => r.kind === 'REQUEST').length, 2);
  actor = 'fixture-admin';
  // Reconstructed actual modules use only durable fixture records.
  const restart = await load();
  assert.equal((await restart.prepareOwnerInvoiceDispatch(clone(command))).issuanceId, result.issuanceId);
  assert.equal(rows.size, 3);
  for (const denied of ['Anonymous', 'Member']) {
    role = denied;
    const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(command)), /platform_denied/);
    assert.equal(trace.length, before);
  }
  role = 'Admin'; actor = '';
  const before = trace.length;
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(command)), /actor/);
  assert.equal(trace.length, before);
  actor = 'fixture-admin';
  const off = await load(false);
  await assert.rejects(() => off.prepareOwnerInvoiceDispatch(clone(command)), /disabled/);
  assert.equal(trace.length, before);
  const negativeCases = [
    c => { c.ownerOnly = true; }, c => { c.completed = true; },
    c => { c.guestToken = 'not-authority'; }, c => { c.actorId = 'spoofed'; },
    c => { c.to = 'other@example.invalid'; }, c => { delete c.payments; },
    c => { c.guest.email = 'victim@example.invalid\r\nBcc: other@example.invalid'; },
    c => { c.guest.email = 'a@example.invalid,b@example.invalid'; },
    c => { c.financial.components.grandTotalCents += 1; },
    c => { c.financial.lines[0].netCents += 1; },
    c => { c.financial.components.discountCents = -0; },
    c => { c.financial.components.discountCents = NaN; },
    c => { c.issueDate = '2026-02-30'; }, c => { c.revision = 'not-a-uuid'; },
  ];
  for (const change of negativeCases) {
    const invalid = clone(command); change(invalid);
    const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(invalid), /owner_invoice_/);
    assert.equal(trace.length, before, 'invalid command must perform zero SDK IO');
  }
  for (const change of [c => { c.guest.email = 'other@example.invalid'; }, c => { c.purpose = 'owner_copy'; },
    c => { c.payments.push({ datePaid: '2026-09-07', paymentAmountCents: 100 }); },
    c => { c.revision = '32345678-1234-4234-8234-123456789abc'; }]) {
    const changed = clone(command); change(changed);
    const old = JSON.stringify([...rows]);
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(changed), /conflict/);
    assert.equal(JSON.stringify([...rows]), old);
  }
  const oversizedRecord = clone(command);
  oversizedRecord.requestId = '72345678-1234-4234-8234-123456789abc';
  oversizedRecord.revision = '82345678-1234-4234-8234-123456789abc';
  oversizedRecord.financial.lines = Array.from({ length: 35 }, (_, index) => ({
    ...clone(command.financial.lines[0]), label: '"'.repeat(1900),
    ...(index ? { unitPriceCents: 0, netCents: 0, vatCents: 0, grossCents: 0 } : {}),
  }));
  const beforeOversize = trace.length;
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(oversizedRecord), /oversize/,
    'escaped canonical record must fit the cap, not just its nested document');
  assert.equal(trace.length, beforeOversize);
  const anotherRequest = clone(command);
  anotherRequest.requestId = '42345678-1234-4234-8234-123456789abc';
  const concurrent = await Promise.all([api.prepareOwnerInvoiceDispatch(anotherRequest), restart.prepareOwnerInvoiceDispatch(anotherRequest)]);
  assert.ok(concurrent.every(x => x.issuanceId === result.issuanceId));
  assert.equal([...rows.values()].filter(x => x.kind === 'ISSUANCE').length, 1);
  // A request/root crash is represented by SDK failure, not a seeded root.
  const crashedCommand = clone(command);
  crashedCommand.requestId = '52345678-1234-4234-8234-123456789abc';
  crashedCommand.revision = '62345678-1234-4234-8234-123456789abc';
  failRoot = true; loseRequestAck = true;
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(crashedCommand), /unavailable/);
  const durable = [...rows.values()].find(x => x.requestId === crashedCommand.requestId);
  assert.ok(durable);
  assert.equal(rows.has(durable.issuanceId), false);
  failRoot = false; loseRequestAck = false;
  // Serialize the actual writer's entire database; reconstruct objects/modules.
  const durableBytes = JSON.stringify([...rows]);
  rows.clear();
  for (const [id, record] of JSON.parse(durableBytes)) rows.set(id, record);
  const recovered = await load();
  assert.equal((await recovered.prepareOwnerInvoiceDispatch(crashedCommand)).issuanceId, durable.issuanceId);
  const persistedRequest = [...rows.values()].find(x => x.kind === 'REQUEST');
  assert.equal(persistedRequest.document, issuance.document);
  const admissionBaseline = { records: clone([...rows.values()]), trace: clone(trace) };
  rows.clear();
  const missingParent = clone(command);
  missingParent.parentIssuanceId = 'abcdef01'.repeat(8);
  missingParent.reissueReason = 'explicit';
  const beforeMissing = trace.length;
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(missingParent), /parent/);
  assert.equal(trace.slice(beforeMissing).filter(x => x[0] === 'insert').length, 0);
  const parentResult = await api.prepareOwnerInvoiceDispatch(clone(command));
  const exactStrings = clone(command);
  exactStrings.requestId = command.requestId.toUpperCase();
  exactStrings.revision = command.revision.toUpperCase();
  exactStrings.parentIssuanceId = parentResult.issuanceId;
  exactStrings.reissueReason = 'explicit';
  exactStrings.purpose = 'owner_copy';
  const exactResult = await api.prepareOwnerInvoiceDispatch(exactStrings);
  assert.equal(exactResult.status, 'durably_prepared');
  assert.equal(exactResult.revision, exactStrings.revision);
  const exactRoot = rows.get(exactResult.issuanceId);
  const exactRequest = [...rows.values()].find(record => record.kind === 'REQUEST' && record.requestId === exactStrings.requestId);
  assert.equal(exactRequest.requestId, exactStrings.requestId);
  const exactDocument = JSON.parse(exactRoot.document);
  assert.equal(exactDocument.revision, exactStrings.revision);
  assert.equal(exactDocument.parentIssuanceId, exactStrings.parentIssuanceId);
  assert.equal(exactRoot.actorId, actor);
  assert.equal(exactRoot.to, 'info@wanderlustcaribbean.com');
  assert.equal(exactRoot.cc, '');
  assert.equal(exactRoot.from, 'info@wanderlustcaribbean.com');
  const exactRestart = await load();
  assert.equal((await exactRestart.prepareOwnerInvoiceDispatch(exactStrings)).issuanceId, exactResult.issuanceId);
  assert.equal(rows.size, 4);
  // P3 ordinary SDK crash after retained REQUEST, followed by parent START.
  const child = clone(exactStrings);
  child.requestId = '92345678-1234-4234-8234-123456789abc';
  child.revision = 'a2345678-1234-4234-8234-123456789abc';
  failRoot = true;
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(child), /unavailable/);
  failRoot = false;
  const stageKey = (domain, id) => crypto.createHash('sha256').update(JSON.stringify([domain, id])).digest('hex');
  const parentBytes = JSON.stringify(rows.get(parentResult.issuanceId));
  // SDK stage fixture only; NOT a production sender or dispatch grant.
  const start = { _id: stageKey('invoice-send-start/v1', parentResult.issuanceId), kind: 'START',
    issuanceId: parentResult.issuanceId, documentDigest: rows.get(parentResult.issuanceId).documentDigest,
    artifactDigest: 'a'.repeat(64), workerBootId: 'fixture-boot', invocationNonce: 'fixture-invocation' };
  rows.set(start._id, start);
  const reconstructed = await load();
  const finished = await reconstructed.prepareOwnerInvoiceDispatch(clone(child));
  assert.equal(finished.status, 'durably_prepared');
  assert.equal(JSON.parse(rows.get(finished.issuanceId).document).revision, child.revision);
  assert.equal(JSON.stringify(rows.get(parentResult.issuanceId)), parentBytes);
  const newer = clone(child);
  newer.requestId = 'b2345678-1234-4234-8234-123456789abc';
  newer.revision = 'c2345678-1234-4234-8234-123456789abc';
  const uncertainBefore = trace.length;
  await assert.rejects(() => reconstructed.prepareOwnerInvoiceDispatch(newer), /owner_review_required/);
  assert.equal(trace.slice(uncertainBefore).filter(x => x[0] === 'insert').length, 0);
  assert.equal((await reconstructed.prepareOwnerInvoiceDispatch(clone(child))).issuanceId, finished.issuanceId);
  assert.equal(JSON.stringify(rows.get(parentResult.issuanceId)), parentBytes);
  for (const corrupt of [r => { r.actorId = false; }, r => { r.documentDigest = 'b'.repeat(64); },
    r => { r.to = 'changed@example.invalid'; }, r => { r.extra = 1; }, r => { r.kind = 'REQUEST'; }]) {
    const saved = clone(rows.get(parentResult.issuanceId));
    const bad = clone(saved); corrupt(bad); rows.set(saved._id, bad);
    const before = trace.length;
    await assert.rejects(() => reconstructed.prepareOwnerInvoiceDispatch(newer), /owner_invoice_/);
    assert.equal(trace.slice(before).filter(x => x[0] === 'insert').length, 0);
    rows.set(saved._id, saved);
  }
  // P2 local immutable stage envelopes, not an actual sender/MIME preparation chain.
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const payload = Buffer.from('fixture artifact bytes');
  const chunk = { _id: stageKey('invoice-artifact-chunk/v1', digest(payload)), kind: 'ARTIFACT_CHUNK',
    data: payload.toString('base64'), digest: digest(payload) };
  const manifest = { _id: stageKey('invoice-artifact/v1', parentResult.issuanceId), kind: 'ARTIFACT',
    issuanceId: parentResult.issuanceId, documentDigest: start.documentDigest, to: issuance.to, cc: issuance.cc,
    from: issuance.from, chunkIds: [chunk._id], mimeDigest: digest(payload), byteLength: payload.length,
    pdfDigest: digest(Buffer.from('fixture PDF')), rendererVersion: 'fixture/v1' };
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
    value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
  start.artifactDigest = digest(canonical(manifest)); rows.set(start._id, clone(start));
  const ack = { _id: stageKey('invoice-send-ack/v1', start.issuanceId), kind: 'ACK', issuanceId: start.issuanceId,
    documentDigest: start.documentDigest, artifactDigest: start.artifactDigest, invocationNonce: start.invocationNonce,
    to: issuance.to, cc: issuance.cc, from: issuance.from, providerMessageId: 'fixture-message-id', status: 'provider_accepted' };
  rows.set(ack._id, clone(ack)); rows.set(manifest._id, clone(manifest)); rows.set(chunk._id, clone(chunk));
  actor = 'second-admin';
  assert.equal((await reconstructed.prepareOwnerInvoiceDispatch(clone(newer))).status, 'durably_prepared',
    'P2 exact START ACK and complete bound artifact permits explicit child');
  actor = 'fixture-admin';
  const stageBaseline = JSON.stringify([...rows]);
  const restore = () => { rows.clear(); for (const [id, r] of JSON.parse(stageBaseline)) rows.set(id, r); };
  let cases = 0;
  // Fresh commands must deny broken parent/stage evidence without any writes.
  for (const corrupt of [
    () => rows.delete(chunk._id), () => rows.delete(manifest._id),
    () => { rows.get(chunk._id).data = 'YmFk'; },
    () => { rows.get(ack._id).invocationNonce = 'wrong'; },
    () => { rows.get(ack._id).status = 'delivered'; },
    () => { rows.get(manifest._id).to = 'wrong@example.invalid'; },
    () => { rows.get(parentResult.issuanceId).kind = 'REQUEST'; },
    () => { rows.get(parentResult.issuanceId).actorId = false; }
  ]) {
    restore(); corrupt();
    const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(newer)), /owner_invoice_/);
    assert.equal(trace.slice(before).filter(t => t[0] === 'insert').length, 0); cases++;
  }
  restore();
  for (const mode of ['unknown', 'failure']) {
    getHook = id => { if (id === start._id) { if (mode === 'failure') throw new Error('read_failure'); return undefined; }
      return rows.has(id) ? clone(rows.get(id)) : null; };
    const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(newer)), /owner_invoice_|read_failure/);
    assert.equal(trace.slice(before).filter(t => t[0] === 'insert').length, 0); getHook = null; cases++;
  }
  // Child's own uncertainty and parent's later ACK never produce a new grant/revision.
  const childRoot = rows.get(finished.issuanceId);
  const childManifest = { ...manifest, _id: stageKey('invoice-artifact/v1', childRoot._id),
    issuanceId: childRoot._id, documentDigest: childRoot.documentDigest,
    to: childRoot.to, cc: childRoot.cc, from: childRoot.from };
  rows.set(childManifest._id, clone(childManifest));
  const childStart = { ...start, _id: stageKey('invoice-send-start/v1', childRoot._id),
    issuanceId: childRoot._id, documentDigest: childRoot.documentDigest,
    artifactDigest: digest(canonical(childManifest)) };
  assert.notEqual(childStart.documentDigest, start.documentDigest);
  assert.equal(childManifest.documentDigest, childRoot.documentDigest);
  assert.equal(rows.has(stageKey('invoice-send-ack/v1', childRoot._id)), false);
  assert.deepEqual(rows.get(ack._id), ack);
  rows.set(childStart._id, childStart);
  const replayBefore = trace.length;
  const replayRows = JSON.stringify([...rows]);
  const replay = await api.prepareOwnerInvoiceDispatch(clone(child));
  assert.deepEqual(clone(replay), clone(finished));
  assert.equal(JSON.stringify([...rows]), replayRows, 'no new START, root, revision or stored grant');
  assert.deepEqual(Object.keys(replay).sort(), ['documentDigest', 'issuanceId', 'revision', 'status']);
  assert.equal(replay.issuanceId, finished.issuanceId);
  assert.ok(trace.slice(replayBefore).filter(t => t[0] === 'insert').every(t => t[2] === finished.issuanceId));
  for (const change of [c => { c.reissueReason = 'changed'; }, c => { c.parentIssuanceId = 'b'.repeat(64); }]) {
    const bad = clone(child); change(bad); const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(bad), /conflict/);
    assert.equal(trace.slice(before).filter(t => t[0] === 'insert').length, 0); cases++;
  }
  // Exact acknowledged readback is stricter than duplicate/lost-ACK creator reconciliation.
  rows.clear(); loseRootAck = true;
  assert.equal((await api.prepareOwnerInvoiceDispatch(clone(command))).status, 'durably_prepared');
  loseRootAck = false;
  rows.clear(); insertHook = r => { if (r.kind === 'ISSUANCE') rows.get(r._id).actorId = 'unexpected-actor'; };
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(command)), /conflict/);
  insertHook = null; cases++;
  rows.clear();
  const winners = await verifyConcurrentIdentities();
  assert.ok(winners.every(x => x.issuanceId === result.issuanceId));
  assert.equal([...rows.values()].filter(r => r.kind === 'ISSUANCE').length, 1);
  assert.deepEqual([...rows.values()].filter(r => r.kind === 'REQUEST').map(r => r.actorId).sort(), ['fixture-admin', 'second-admin']);
  assert.equal(rows.get(result.issuanceId).actorId, 'fixture-admin');
  actor = 'fixture-admin';
  const parentSnapshot = clone(rows.get(result.issuanceId));
  const linked = { ...clone(command), requestId: 'e2345678-1234-4234-8234-123456789abc',
    revision: 'f2345678-1234-4234-8234-123456789abc', parentIssuanceId: result.issuanceId, reissueReason: 'explicit' };
  for (const mutate of [
    d => { d.requestId = command.requestId; },
    d => { d.invoiceNumber = 'OTHER'; },
    d => { d.parentIssuanceId = result.issuanceId; d.reissueReason = 'cycle'; },
    d => { d.parentIssuanceId = 'f'.repeat(64); d.reissueReason = 'forward'; }
  ]) {
    const bad = clone(parentSnapshot), d = JSON.parse(bad.document); mutate(d);
    bad.document = canonical(d); bad.documentDigest = digest(bad.document);
    rows.set(result.issuanceId, bad);
    const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(clone(linked)), /owner_invoice_/);
    assert.equal(trace.slice(before).filter(t => t[0] === 'insert').length, 0); cases++;
  }
  rows.set(result.issuanceId, parentSnapshot);
  for (const mutate of [c => { delete c.reissueReason; }, c => { c.parentIssuanceId = stageKey('owner-invoice-revision/v1', 'unused'); },
    c => { c.parentIssuanceId = digest(canonical(['owner-invoice-revision/v1', c.invoiceNumber, c.revision])); }]) {
    const bad = clone(linked); mutate(bad); const before = trace.length;
    await assert.rejects(() => api.prepareOwnerInvoiceDispatch(bad), /owner_invoice_/);
    assert.equal(trace.slice(before).filter(t => t[0] === 'insert').length, 0); cases++;
  }
  // #6/P1: actual writer creates a valid OTHER identity, isolating same-number denial.
  const other = await api.prepareOwnerInvoiceDispatch({ ...clone(command), invoiceNumber: 'OTHER',
    requestId: '02345678-1234-4234-8234-123456789abc' });
  assert.equal(other.status, 'durably_prepared');
  assert.equal(other.issuanceId, digest(canonical(['owner-invoice-revision/v1', 'OTHER', command.revision])));
  const wrongParentBefore = trace.length;
  const wrongParentRows = JSON.stringify([...rows]);
  await assert.rejects(() => api.prepareOwnerInvoiceDispatch({ ...clone(linked), parentIssuanceId: other.issuanceId }),
    /^Error: owner_invoice_parent_invoice$/);
  assert.equal(trace.slice(wrongParentBefore).filter(t => t[0] === 'insert').length, 0);
  assert.equal(JSON.stringify([...rows]), wrongParentRows);
  getHook = id => {
    const stored = rows.has(id) ? clone(rows.get(id)) : null;
    if (stored && stored.kind === 'ISSUANCE') {
      stored._createdDate = new Date('2026-09-07T00:00:00Z');
      stored._owner = null;
      stored._updatedDate = 'metadata outside application size '.repeat(6000);
      assert.equal(stored._owner, null);
      assert.ok(stored._createdDate instanceof Date);
    }
    return stored;
  };
  assert.equal((await api.prepareOwnerInvoiceDispatch(clone(command))).status, 'durably_prepared', 'allowlisted Wix Date metadata is outside root equality');
  getHook = null;
  assert.equal(cases, 20);
  console.log(JSON.stringify({ n3AdditionalCases: cases, stageFixturesOnly: true }));
  console.log(JSON.stringify({ tracer: 'Admin prepare -> actual immutable store -> restarted readback', negativeCases: negativeCases.length,
    ...admissionBaseline, exactStringOwnerControl: { records: [...rows.values()], trace: trace.slice(admissionBaseline.trace.length) },
    completeCriteria: [], partialCriteria: [1, 2, 7, 8] }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
