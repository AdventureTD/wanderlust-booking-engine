'use strict';
// NEW admission: exact frozen source IMPORT INITIALIZATION ONLY.
// No backend function invocation, no gate seam, no retained DB, no SDK calls.
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const base=require('node:path').resolve(__dirname,'../..')+'/';
const pins=JSON.parse(fs.readFileSync(__dirname+'/source-pins.json'));
const edges=JSON.parse(fs.readFileSync(__dirname+'/import-edges.json'));
const sha=b=>crypto.createHash('sha256').update(Buffer.from(b.toString('utf8').replace(/\r\n/g,'\n'))).digest('hex');
for(const [n,p]of Object.entries(pins))assert.equal(sha(fs.readFileSync(base+n)),p.canonicalLF,n);
(async()=>{
 const results=[];
 for(const entry of ['guestBookingInvoicePrivateDispatcher','guestBookingInvoiceTransportAuth','guestBookingInvoiceDelivery']){
  const calls=[],reads=[],context=vm.createContext({Buffer}),cache=new Map();
  function deny(name){return function(){calls.push(name);throw Error('forbidden SDK invocation '+name);};}
  const wix=Object.freeze(Object.fromEntries(['query','insert','get','update','save','remove','bulkInsert','bulkUpdate','bulkRemove'].map(n=>[n,deny('wix-data.'+n)])));
  const data=new Proxy(wix,{get(t,k){reads.push('wix-data.'+String(k));assert.ok(Object.hasOwn(t,k),'undeclared data property '+String(k));return t[k];}});
  const secrets=Object.freeze({getSecretValue:deny('secret.getSecretValue')});
  const sdk={'wix-data':{default:data},'wix-auth':{elevate:deny('elevate')},'wix-secrets-backend.v2':{secrets},buffer:{Buffer},crypto:{default:crypto,createHash:crypto.createHash,createHmac:crypto.createHmac,timingSafeEqual:crypto.timingSafeEqual}};
  function load(n){
   if(cache.has(n))return cache.get(n);
   let m;
   if(Object.hasOwn(sdk,n)){const values=sdk[n];m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context,identifier:n});}
   else{assert.match(n,/^backend\/[A-Za-z0-9]+$/);const file='velo/'+n+'.js';assert.ok(Object.hasOwn(pins,file));const raw=fs.readFileSync(base+file);assert.equal(sha(raw),pins[file].canonicalLF);m=new vm.SourceTextModule(raw.toString('utf8'),{context,identifier:n});assert.deepEqual(m.dependencySpecifiers,edges[file]);}
   cache.set(n,m);return m;
  }
  const root=load('backend/'+entry);
  await root.link((n,ref)=>{assert.ok(edges['velo/'+ref.identifier+'.js'].includes(n));return load(n);});
  await root.evaluate({timeout:5000});
  for(const m of cache.values())assert.equal(m.status,'evaluated');
  assert.equal(typeof cache.get('backend/guestBookingInvoiceTransportAuth').namespace.dispatchGuestInvoiceJournal,'function');
  assert.equal(typeof cache.get('backend/guestBookingInvoiceDelivery').namespace.guestBookingInvoiceDeliveryBoundOperation,'function');
  if(entry==='guestBookingInvoicePrivateDispatcher')assert.equal(root.namespace.dispatchGuestInvoiceJournal,cache.get('backend/guestBookingInvoiceTransportAuth').namespace.dispatchGuestInvoiceJournal);
  assert.deepEqual(calls,[]);
  const modules=[...cache.keys()].filter(n=>n.startsWith('backend/')).sort();
  results.push({entry,modules,evaluated:modules.length,sdkCalls:calls,sdkPropertyReads:reads});
 }
 assert.equal(results.length,3);
 console.log(JSON.stringify({classification:'IMPORT_INITIALIZATION_ONLY_NO_BACKEND_CALLS',results}));
})().catch(e=>{console.error(e);process.exitCode=1;});
