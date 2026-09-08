// AUTHORED ONLY. Source approval precedes execution admission; no N2/pin waiver.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const baseline = '7a3eb2729823908dca34f9136b387c1fd682a29c';
function text(name) {return fs.readFileSync(path.join(root,name),'utf8');}
function imports(source) {
  // Syntax/dependency inspection only: NEVER link or evaluate backend modules.
  return [...new vm.SourceTextModule(source).dependencySpecifiers].sort();
}
function assertOwnerReferences(name, source) {
  // Conservative reference gate, not a complete HTML/JavaScript parser.
  // No importer skip: remove just the exact reviewed edge, then inspect the rest.
  const edges={
    'velo/backend/issueInvoice.web.js':"import { associateOwnerInvoiceRevision, readOwnerInvoiceCurrentRevision } from 'backend/ownerInvoiceCurrentRevision';",
    'velo/backend/ownerInvoiceCurrentRevision.js':"import { readOwnerInvoiceDocumentLineage } from 'backend/invoiceEmailJournal';"
  };
  if(edges[name]) {
    assert.equal(source.split(edges[name]).length-1,1,'exact reviewed edge '+name);
    source=source.replace(edges[name],'');
  }
  const decoded=source.replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,(_m,a,b,c)=>{
    const value=parseInt(a||b||c,16);assert.ok(value<=0x10ffff,'invalid escape');return String.fromCodePoint(value);
  }).replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi,(_m,a,b)=>String.fromCodePoint(parseInt(a||b,a?16:10)));
  assert.ok(!decoded.includes('ownerInvoiceCurrentRevision'),'forbidden owner consumer '+name);
  // A literal decoded reference, including dynamic/escaped HTML/frontend, is denied.
}
function referenceWitnesses() {
  for(const area of ['velo/backend/','velo/pages/'])for(const ext of ['js','web.js','jsw','html']) {
    const name=area+'inert-consumer.'+ext;
    for(const body of ["import x from 'backend/ownerInvoiceCurrentRevision';","const x=import('backend/ownerInvoiceCurrentRevision');","const x=import('backend/ownerInvoiceCurrent\\u0052evision');","const x=import('backend/ownerInvoiceCurrent\\u{00000052}evision');"]) {
      const source=ext==='html'?'<script type="module">'+body+'</script>':body;
      if(ext!=='html')new vm.SourceTextModule(source); // Parse, never link/evaluate.
      assert.throws(()=>assertOwnerReferences(name,source),/forbidden owner consumer/);
    }
    const benign="export const fixture = 'ordinary';";
    assert.doesNotThrow(()=>assertOwnerReferences(name,ext==='html'?'<script type="module">'+benign+'</script>':benign));
  }
}
function main() {
  referenceWitnesses();
  // Byte custody, separate from permission to evaluate this dependency closure.
  const pins={
    'velo/backend/issueInvoice.web.js':'2a31c0ef699499fd21f29166d8305c06dccc182d9448c89c26f3fe8105d71330',
    'velo/backend/invoiceEmailJournal.js':'529acb7f55241912a74059b7700c19c0dca6e7207565b67415e2a50a87e2cd1a',
    'velo/backend/ownerInvoiceCurrentRevision.js':'a8e4ca7bda6c91414fcb83f9043b59df7646300d919242939ace27e02e492590'
  };
  for(const [name,hash] of Object.entries(pins))assert.equal(require('node:crypto').createHash('sha256').update(text(name).replace(/\r\n/g,'\n')).digest('hex'),hash);
  const bridge=text('velo/backend/issueInvoice.web.js');
  const association=bridge.slice(bridge.indexOf('if (args.length === 2)'),bridge.indexOf("if (args.length !== 1)"));
  assert.match(association,/associateOwnerInvoiceRevision/);assert.doesNotMatch(association,/prepareOwnerIssuance|dispatchOwnerInvoice|getSecret|fetch\(/);
  const consumer='velo/backend/ownerInvoiceCurrentRevision.js';
  assert.deepEqual(imports(text(consumer)),[
    './bookingCurrentRevision.js','./bookingCurrentRevisionRules.js','./bookingCurrentRevisionStore.js',
    'backend/invoiceEmailJournal','crypto','wix-data'
  ].sort());
  for (const file of ['velo/backend/issueInvoice.web.js','velo/backend/invoiceEmailJournal.js']) {
    const previous=execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8'});
    const expected=imports(previous);
    if (file.endsWith('issueInvoice.web.js')) expected.push('backend/ownerInvoiceCurrentRevision');
    assert.deepEqual(imports(text(file)),expected.sort());
  }
  assert.match(text('velo/backend/issueInvoice.web.js'),/const OWNER_INVOICE_JOURNAL_ENABLED = false;/);
  assert.match(text('velo/backend/invoiceEmailJournal.js'),/const OWNER_INVOICE_REQUEST_RECOVERY_ENABLED = false;/);
  for (const file of ['bookingCurrentRevision.js','bookingCurrentRevisionRules.js','bookingCurrentRevisionStore.js']) {
    const name='velo/backend/'+file;
    assert.equal(text(name).replace(/\r\n/g,'\n'),execFileSync('git',['show',baseline+':'+name],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n'));
  }
  const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/);
  const edges=[];
  for (const name of paths.filter(p => p.startsWith('velo/') && /\.(?:js|jsw|html)$/i.test(p))) {
    const source=text(name);
    assertOwnerReferences(name,source);
    // HTML is conservatively denied on a consumer-name reference, including frontend.
    if (/\.html$/i.test(name)) {
      assert.ok(!source.includes('ownerInvoiceCurrentRevision'),'unapproved HTML reference '+name); continue;
    }
    const dependencies=imports(source);
    for (const spec of dependencies) {
      const normalized=spec.startsWith('backend/') ? 'velo/'+spec.replace(/\.js$/,'')+'.js' : path.posix.normalize(path.posix.join(path.posix.dirname(name),spec)).replace(/\.js$/,'')+'.js';
      if (normalized === consumer) edges.push([name,spec]);
    }
    // Dynamic/escaped imports require the separately reviewed full import scanner.
  }
  assert.deepEqual(edges,[['velo/backend/issueInvoice.web.js','backend/ownerInvoiceCurrentRevision']]);
  console.log('Static literal closure checks only; dynamic/escaped/HTML parser and full N2 remain separate blocking gates.');
}
if (require.main === module) main();
