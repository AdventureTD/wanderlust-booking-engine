'use strict';
// Backend-free controls. Extract only GI11 source scanner, GDR08 incoming fence,
// and recovery resolveBackend/actualPins/compileActual. Never evaluate a backend,
// call fixture/producer/graphRegression, or dispatch a historical verifier.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const vm=require('node:vm'), crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonicalSource=s=>s.replace(/\r\n/g,'\n');
const recovery='velo/backend/guestBookingCompletionRecovery.js';
const source=n=>canonicalSource(fs.readFileSync(path.join(ROOT,n),'utf8'));
const cases=[];
function test(id,fn){fn();cases.push(id);console.log('PASS '+id);}
function slice(text,start,end){assert.equal(text.split(start).length,2,start);assert.equal(text.split(end).length,2,end);const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(b>a);return text.slice(a,b);}
function fsView(overrides={}) {
  return {...fs,readdirSync(dir,options){
    const entries=fs.readdirSync(dir,options);
    for(const name of Object.keys(overrides)) if(path.resolve(ROOT,path.dirname(name))===path.resolve(dir)&&!entries.some(e=>e.name===path.basename(name)))
      entries.push({name:path.basename(name),isDirectory:()=>false});
    return entries;
  },readFileSync(file,encoding){const name=path.relative(ROOT,file).replace(/\\/g,'/');
    if(Object.hasOwn(overrides,name))return encoding?overrides[name]:Buffer.from(overrides[name]);
    return fs.readFileSync(file,encoding);
  }};
}
const giText=source('scripts/verify-guest-booking-invoice-issuance.js');
const giBlock=slice(giText,"    const source=fs.readFileSync(path.join(ROOT,'velo/backend/guestBookingInvoiceIssuance.js'),'utf8');","    const f=fixture(), {result,w}=await advance(f);");
assert.doesNotMatch(giBlock,/\b(?:fixture|advance|load|evaluate)\s*\(/);
function gi(overrides={},block=giBlock){return vm.compileFunction(block,['assert','fs','path','vm','ROOT','sha'])(assert,fsView(overrides),path,vm,ROOT,sha);}
const gdText=source('scripts/verify-guest-booking-invoice-delivery.js');
const gdBlock=slice(gdText,'const deliveryEdges={','function graphRegression()');
assert.doesNotMatch(gdBlock,/\b(?:setup|call|fixture|load|evaluate)\s*\(/);
const gd=vm.compileFunction(gdBlock+';return {incoming,deliveryPins};',['assert','vm','sha'])(assert,vm,sha);
const recText=source('scripts/verify-guest-booking-completion-recovery.js');
const recBlock=slice(recText,'function resolveBackend(spec, parent) {','async function loadRecovery(')+
 slice(recText,'const actualPins={','let backendLoads=0;')+
 slice(recText,'function compileActual(file){','function actualSubject(db,hooks={})');
assert.doesNotMatch(recBlock,/\b(?:producerDeclarations|actualSubject|loadRecovery|evaluate|runInContext)\s*\(/);
function compiler(overrides={},block=recBlock){return vm.compileFunction(block+';return {compileActual,actualPins,resolveBackend};',['assert','fs','path','vm','root','sha','canonicalSource'])(assert,fsView(overrides),path,vm,ROOT,sha,canonicalSource);}
const text=source(recovery), edges=['backend/guestBookingAcceptanceDiscovery','backend/guestBookingPhysicalAcquisition','backend/guestBookingRecoveryProgressStore','backend/guestBookingInvoiceIssuance','backend/guestBookingIssuerAuthority'];
const admission=JSON.parse(source('scripts/fixtures/recovery-invoice-hook-admission.json'));
test('HG01_GI11_EXTRACTED_LF_CRLF',()=>{gi();gi({[recovery]:text.replace(/\n/g,'\r\n')});});
test('HG02_GDR08_EXTRACTED_LF_CRLF_PATH',()=>{gd.incoming(recovery,text);gd.incoming(recovery.replace(/\//g,'\\'),text.replace(/\n/g,'\r\n'));assert.deepEqual([...new vm.SourceTextModule(text).dependencySpecifiers],edges);});
test('HG03_RECOVERY_COMPILE_ONLY_PINS',()=>{
 const c=compiler();
 for(const n of [recovery,'velo/backend/guestBookingInvoiceIssuance.js','velo/backend/guestBookingCompletionAuthority.js','velo/backend/guestBookingInvoiceAuthorityConfig.js']) {
   assert.equal(c.actualPins[n],admission.files[n]);
   const compiled=c.compileActual(path.join(ROOT,n));assert.ok(compiled.script instanceof vm.Script);
 }
 assert.deepEqual(compiler({[recovery]:text.replace(/\n/g,'\r\n')}).compileActual(path.join(ROOT,recovery)).imports.map(i=>i.spec),edges);
 assert.throws(()=>c.compileActual(path.join(ROOT,'velo/backend/unapproved.js')),/unadmitted backend/);
 assert.throws(()=>c.resolveBackend('../../escape',path.join(ROOT,recovery)),/path escape/);
});
const extras=[' ','\nimport \'backend/extra\';','\nimport \'backend/guestBookingInvoiceDelivery\';',"\nimport('backend/guestBookingInvoiceIssuance');","\nexport * from 'backend/guestBookingInvoiceIssuance';","\nconst extra=require('backend/guestBookingInvoiceIssuance');"];
test('HG04_EACH_EXTRACTED_READER_REJECTS_EXTRA_CONTENT_EDGES',()=>{
 for(const extra of extras) {
   const changed=text+extra;
   assert.throws(()=>gi({[recovery]:changed}),/exact recovery admission source/);
   assert.throws(()=>gd.incoming(recovery,changed),/exact recovery admission source/);
   assert.throws(()=>compiler({[recovery]:changed}).compileActual(path.join(ROOT,recovery)),assert.AssertionError);
 }
});
test('HG05_DELIVERY_OTHER_CALLER_EXTENSION_DYNAMIC_REEXPORT',()=>{
 for(const ext of ['js','web.js','jsw','html']) {
  const n='velo/backend/other.'+ext;
  gd.incoming(n,"export const inert=1;");
  for(const s of [text,"import 'backend/guestBookingInvoiceDelivery';","import('backend/guestBookingInvoiceIssuance');","export * from 'backend/guestBookingInvoiceIssuance';","require('backend/guestBookingInvoiceDelivery');"])
    assert.throws(()=>gd.incoming(n,s),/incoming delivery\/admission consumer/);
 }
});
test('HG06_GI11_OTHER_PUBLIC_JSW_HTML_CALLER',()=>{
 assert.throws(()=>gi({'velo/guestBookingInvoiceIssuance.js':"import 'backend/guestBookingInvoiceIssuance';"}),/incoming admission consumer/);
 // Parser-valid virtual files exercise suffixes absent from this checkout too.
 for(const suffix of ['.js','.web.js','.jsw','.html']) {
  const n='velo/backend/hook-guard-extra'+suffix;
  gi({[n]:'export const inert=1;'});
  for(const s of ["import 'backend/guestBookingInvoiceIssuance';","import('backend/guestBookingInvoiceIssuance');","export * from 'backend/guestBookingInvoiceIssuance';","require('backend/guestBookingInvoiceIssuance');"])
   assert.throws(()=>gi({[n]:s}),/incoming admission consumer/);
 }
});
test('HG07_PRESERVED_HISTORICAL_DELIVERY_MISMATCH',()=>{
 assert.equal(gd.deliveryPins['velo/backend/guestBookingInvoiceDelivery.js'],'b5e27047f870a38a9aaddb13b63deca711775c69bfbcb9edee057f1e20d54ea2');
 assert.notEqual(sha(source('velo/backend/guestBookingInvoiceDelivery.js')),gd.deliveryPins['velo/backend/guestBookingInvoiceDelivery.js']);
});
if(process.argv[2]==='--before') {
 assert.equal(process.argv.length,4);
 const before=n=>canonicalSource(fs.readFileSync(path.join(process.argv[3],n),'utf8'));
 test('HG08_OLD_EXTRACTED_GUARDS_REJECT_REVIEWED_HOOK',()=>{
  const oldGI=slice(before('scripts/verify-guest-booking-invoice-issuance.js'),"    const source=fs.readFileSync(path.join(ROOT,'velo/backend/guestBookingInvoiceIssuance.js'),'utf8');","    const f=fixture(), {result,w}=await advance(f);");
  assert.throws(()=>gi({},oldGI),assert.AssertionError);
  const oldGD=slice(before('scripts/verify-guest-booking-invoice-delivery.js'),'const deliveryEdges={','function graphRegression()');
  const old=vm.compileFunction(oldGD+';return incoming;',['assert','vm','sha'])(assert,vm,sha);
  assert.throws(()=>old(recovery,text),/incoming delivery\/admission consumer/);
  const oldRec=before('scripts/verify-guest-booking-completion-recovery.js');
  const block=slice(oldRec,'function resolveBackend(spec, parent) {','async function loadRecovery(')+slice(oldRec,'const actualPins={','let backendLoads=0;')+slice(oldRec,'function compileActual(file){','function actualSubject(db,hooks={})');
  assert.throws(()=>compiler({},block).compileActual(path.join(ROOT,recovery)),assert.AssertionError);
 });
} else assert.equal(process.argv.length,2);
assert.equal(new Set(cases).size,cases.length);
console.log(JSON.stringify({cases,count:cases.length,backend_evaluation:'NOTRUN',historical_dispatch:'NOTRUN',producer_dispatch:'NOTRUN',extracted_sha256:{GI11:sha(giBlock),GDR08:sha(gdBlock),recovery:sha(recBlock)}}));
