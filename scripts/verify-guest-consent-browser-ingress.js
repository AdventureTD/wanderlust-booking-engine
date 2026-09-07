/* Actual-source local ingress tests. Inert SDK/transport; real T1 cryptography. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
if (!vm.SourceTextModule) {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', __filename], {encoding:'utf8',timeout:60000});
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); process.exit(r.status ?? 1);
}
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const webPath = 'velo/backend/guestConsent.web.js';
assert.ok(fs.existsSync(path.join(root,webPath)), 'B01 MISSING-FEATURE RED: actual browser web ingress absent');
// Reuse existing inert SDK and actual private-module loader, not authentication stubs.
const old = read('scripts/verify-guest-consent-withdrawal.js');
const fixture = {exports:{}};
vm.runInNewContext(old.slice(0,old.indexOf('(process.argv[2] ===')) + '\nmodule.exports={sdk,load,linkFixture};',
  {require, module:fixture, __dirname, __filename:path.join(__dirname,'verify-guest-consent-withdrawal.js'),process,Buffer,console,setTimeout,clearTimeout});
const {sdk,load,linkFixture} = fixture.exports;
const plain = x => JSON.parse(JSON.stringify(x));
async function web(privateAPI, source = read(webPath)) {
  const calls=[]; const realm=vm.createContext({});
  const synth = (names, values) => new vm.SyntheticModule(names,function(){for(const n of names)this.setExport(n,values[n]);},{context:realm});
  const wix=synth(['Permissions','webMethod'],{Permissions:{Anyone:'Anyone'},webMethod(...args){calls.push(args);return args[1];}});
  const priv=synth(Object.keys(privateAPI),privateAPI);
  const m=new vm.SourceTextModule(source,{context:realm});
  await m.link(n=>{assert.ok(['wix-web-module','backend/guestConsentContext'].includes(n));return n==='wix-web-module'?wix:priv;});await m.evaluate();
  assert.equal(calls.length,3);for(const a of calls){assert.equal(a.length,2,'B06 no cache options/tags');assert.equal(a[0],'Anyone');}
  assert.deepEqual(Object.keys(m.namespace).sort(),['createGuestConsentBrowserContext','readGuestConsentBrowserNegative','withdrawGuestConsentBrowser'].sort());
  return m.namespace;
}
const KEY='wbe_browser_negative_v1';
function browser(api, options={}) {
  const ready=[], messages=[], logs=[], labels=[]; const storage=options.storage || new Map();let click;
  const local={getItem(k){if(options.storageError)throw Error('storage');return storage.get(k)??null;},setItem(k,v){if(options.storageError)throw Error('storage');storage.set(k,v);}};
  const status={set text(v){labels.push(v);}};
  const $w=id=>{if(options.missing)throw Error('absent');if(id==='#btnWithdrawAdvertising')return {onClick(fn){click=fn;}};if(id==='#consentWithdrawalStatus')return status;if(id==='#wbeEventBridge')return {postMessage(d){messages.push(plain(d));if(options.relay)options.relay(d);if(options.bridgeError)throw Error('bridge');}};throw Error('unexpected UI '+id);};
  $w.onReady=fn=>ready.push(fn);
  const context=vm.createContext({setTimeout,clearTimeout,$w,local,...api,rendering:{env:options.ssr?'backend':'browser'},consentPolicy:{getCurrentConsentPolicy:async()=>({policy:{}})},
    getAllSettings:options.settings || (()=>new Promise(()=>{})),initTracking(){if(options.trackingError)throw Error('tracking');},captureClickIds:()=>({}),setSuspendGoogleAds(){},console:{log(...a){logs.push(a);},error(...a){logs.push(a);}}});
  vm.runInContext((options.source || read('velo/masterPage.js')).replace(/^import .*;\n/gm,''),context);
  for(const fn of ready)Promise.resolve(fn()).catch(e=>{throw e;});
  return {storage,messages,logs,labels,click:()=>{assert.equal(typeof click,'function','B01 native click independently bound');return click();}};
}
function transport(options={}) {
  const input=read('scripts/verify-google-consent-transitions.js');
  const m={exports:{}};
  const pre=input.slice(0,input.indexOf("test('production globals"));
  vm.runInNewContext(pre.replace('message(payload) {', "rawMessage(event) { emit(windowListeners, 'message', event); }, message(payload) {")+'\nmodule.exports={harness,source};', {require,__dirname,module:m,console});
  const source=options.unknown?m.exports.source:m.exports.source.replace("var DENIAL_BRIDGE_ORIGIN = '';", "var DENIAL_BRIDGE_ORIGIN = 'https://bridge.synthetic.invalid';");
  const head=m.exports.harness({source,testOnlyTransitions:true});
  head.window.location.origin='https://www.wanderlustcaribbean.com';
  const iframe={parent:head.window};const sent=[];
  const original=head.window.document.getElementById;
  head.window.document.getElementById=id=>id==='wbeEventBridge'?{contentWindow:iframe}:original(id);
  head.window.postMessage=(data,target)=>{sent.push({data:plain(data),target});head.rawMessage({data,origin:'https://bridge.synthetic.invalid',source:iframe});};
  vm.runInNewContext(read('velo/custom-code/event-bridge-iframe.html').match(/<script>([\s\S]*?)<\/script>/)[1],{window:iframe});
  return {head,iframe,sent,relay:data=>iframe.onmessage({data,source:head.window,origin:'https://www.wanderlustcaribbean.com'})};
}
async function main(){
  const db=sdk(), t=await load(db), api=await web(t.api);
  const h=browser(api);await h.click();
  assert.match(h.labels.at(-1),/recorded/i,'B01 actual T1 readback shown');
  assert.equal(db.rows.size,2,'B01 actual delegation writes context plus negative');
  assert.deepEqual(h.messages,[{type:'wbe-consent-deny',version:1}],'B01 separate token-free denial before backend');
  console.log('B01 first actual click/web/T1 vertical slice PASS');
  const tr=transport();tr.head.testOnlyGrantConsent(true,true,true,true);
  const x=browser(api,{relay:tr.relay}); const pending=x.click();
  assert.ok(Object.values(tr.head.state()).every(v=>v==='denied'),'B01 actual iframe/head denial before backend await');
  await pending;
  assert.deepEqual(tr.sent,[{data:{type:'wbe-consent-deny',version:1},target:'https://www.wanderlustcaribbean.com'}]);
  console.log('B01 actual separate iframe/head supported-topology fixture PASS (not deployed topology)');
  const issuance=deferred(), newStorage=new Map();
  const issueRace=browser({...api,async createGuestConsentBrowserContext(){const result=await api.createGuestConsentBrowserContext();await issuance.promise;return result;}},{storage:newStorage});
  const issuing=issueRace.click();await tick();newStorage.clear();issuance.resolve();await issuing;
  assert.match(issueRace.labels.at(-1),/pending/i,'B03 clear during issuance cannot reassign old result to replacement custody');
  assert.equal(newStorage.size,0,'B03 late issuer must not overwrite cleared custody');
  const issuedOnly=deferred();let createdToken;
  const createdState=browser({...api,async createGuestConsentBrowserContext(){const result=await api.createGuestConsentBrowserContext();createdToken=result.token;return result;},async withdrawGuestConsentBrowser(token){await issuedOnly.promise;return api.withdrawGuestConsentBrowser(token);}});
  const createdFlight=createdState.click();await tick();assert.ok(createdToken);assert.match(createdState.labels.at(-1),/pending/i,'B01 CREATED alone is not recorded');
  assert.equal(createdState.click(),createdFlight,'B01 per-click single flight');issuedOnly.resolve();await createdFlight;assert.match(createdState.labels.at(-1),/recorded/i);
  await coverage(api);
}
const tick=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function coverage(api){
  // Later additions are baseline-GREEN coverage, not fabricated feature REDs.
  for(const options of [{settings:async()=>{throw Error('settings');}},{settings:async()=>({}),trackingError:true},{bridgeError:true},{storageError:true}]) {
    const h=browser(api,options);await h.click();assert.match(h.labels.at(-1),/recorded/i);
  }
  browser(api,{missing:true,settings:async()=>({})});
  let ssrCalls=0;browser({createGuestConsentBrowserContext(){ssrCalls++;}},{ssr:true});await tick();assert.equal(ssrCalls,0);
  const db=sdk(), privateModule=await load(db), w=await web(privateModule.api);
  const b=await w.createGuestConsentBrowserContext(), other=await w.createGuestConsentBrowserContext();
  assert.deepEqual(Object.keys(b).sort(),['status','token']);
  const id=b.token.split('.')[1];
  const digest=db.rows.get('GuestConsentBrowserContexts:'+id).capabilityDigest;
  for(const value of [undefined,null,{}, {token:b.token},new String(b.token),id,digest,'booking-number','wgb1.fake','x'.repeat(200000),b.token+'\n',b.token+' ',`wcn1.${id}.${'0'.repeat(64)}`,`wcn1.${other.token.split('.')[1]}.${b.token.split('.')[2]}`]) {
    db.trace.length=0;
    for(const name of ['withdrawGuestConsentBrowser','readGuestConsentBrowserNegative'])assert.deepEqual(plain(await w[name](value)),{status:'DENIED'});
    assert.equal(db.trace.filter(x=>x[0]==='insert').length,0);
  }
  db.trace.length=0;
  for(const name of Object.keys(w))assert.deepEqual(plain(await w[name](b.token,'extra')),{status:'DENIED'});
  assert.equal(db.trace.length,0);
  for(const response of [null,{}, {status:'GRANTED'}, {status:'RECORDED',token:b.token}, {status:'CREATED',token:b.token,extra:true}]) {
    const bad=await web(Object.fromEntries(Object.keys(w).map(n=>[n,async()=>response])));
    assert.deepEqual(plain(await bad.createGuestConsentBrowserContext()),{status:'UNKNOWN'});
    assert.deepEqual(plain(await bad.withdrawGuestConsentBrowser(b.token)),{status:'UNKNOWN'});
    assert.deepEqual(plain(await bad.readGuestConsentBrowserNegative(b.token)),{status:'UNRESOLVED'});
  }
  const throws=await web(Object.fromEntries(Object.keys(w).map(n=>[n,async()=>{throw Error(b.token);}])));
  assert.deepEqual(plain(await throws.withdrawGuestConsentBrowser(b.token)),{status:'UNKNOWN'});
  assert.equal((await w.withdrawGuestConsentBrowser(b.token)).status,'RECORDED');
  assert.equal((await w.readGuestConsentBrowserNegative(other.token)).status,'UNRESOLVED');
  console.log('B02 actual crypto negative inputs/result allowlists/no cross-context mutation PASS; later GREEN coverage');

  for(const mode of ['lost-reply','throw-before','false-ack','storage-error']) {
    const d=sdk(), p=await load(d), actual=await web(p.api);let first=true,used=[];
    const transportAPI={...actual,async withdrawGuestConsentBrowser(token){used.push(token);if(first){first=false;if(mode==='lost-reply'){await actual.withdrawGuestConsentBrowser(token);throw Error(token);}if(mode==='throw-before')throw Error(token);if(mode==='false-ack')d.hook=async(op,c)=>op==='insert'&&c==='GuestConsentWithdrawals'?{}:undefined;}return actual.withdrawGuestConsentBrowser(token);}};
    const h=browser(transportAPI,{storageError:mode==='storage-error'});await h.click();
    if(mode!=='storage-error')assert.match(h.labels.at(-1),/pending/i);
    assert.ok(!JSON.stringify([h.messages,h.logs,h.labels]).includes(used[0]),'B05 no bearer in messages/logs/exception UI');
    d.hook=null;d.trace.length=0;await h.click();assert.equal(used[1],used[0]);assert.match(h.labels.at(-1),/recorded/i);
    if(mode==='lost-reply'||mode==='storage-error')assert.equal(d.trace.filter(x=>x[0]==='insert').length,0,'B03 duplicate zero mutation');
    if(mode!=='storage-error'){
      d.trace.length=0;const reload=browser(actual,{storage:h.storage});await tick();await tick();assert.match(reload.labels.at(-1),/observed/i);assert.equal(d.trace.filter(x=>x[0]==='insert').length,0);
      const lost=browser(actual);assert.equal(lost.messages.length,0);await lost.click();assert.notEqual(JSON.parse(lost.storage.get(KEY)).token,used[0]);
    }
  }
  // Actual T1 deadline crossed inside an SDK insert; sticky browser pending then retry.
  let now=1700000000000;class Clock extends Date{static now(){return now;}}
  const td=sdk(), tp=await load(td,{},Clock), tw=await web(tp.api);
  td.hook=async(op,c,row)=>{if(op==='insert'&&c==='GuestConsentWithdrawals'){td.rows.set(c+':'+row._id,{...row});now+=10001;throw Error('late');}};
  const timeout=browser(tw);await timeout.click();assert.match(timeout.labels.at(-1),/pending/i);td.hook=null;td.trace.length=0;await timeout.click();assert.match(timeout.labels.at(-1),/recorded/i);assert.equal(td.trace.filter(x=>x[0]==='insert').length,0);
  // Real browser transport watchdog: late success cannot become newer state.
  const gate=deferred();const late=browser({...w,withdrawGuestConsentBrowser:()=>gate.promise});
  await late.click();assert.match(late.labels.at(-1),/pending/i);gate.resolve({status:'RECORDED'});await tick();assert.match(late.labels.at(-1),/pending/i);
  for(const replacement of [other.token,null]){
    const g=deferred(),storage=new Map([[KEY,JSON.stringify({token:b.token,negative:true})]]);let captured;
    const h=browser({...w,async withdrawGuestConsentBrowser(token){captured=token;await g.promise;return w.withdrawGuestConsentBrowser(token);}},{storage});
    const running=h.click();await tick();if(replacement)storage.set(KEY,JSON.stringify({token:replacement,negative:true}));else storage.clear();g.resolve();await running;
    assert.equal(captured,b.token);assert.match(h.labels.at(-1),/pending/i);assert.ok(h.messages.length>0);
  }
  console.log('B03 pending/lost replies/false ack/reload/retained retry/custody loss/late result PASS; real 12s browser timeout plus sampled T1 deadline (not new real T1 timer evidence)');

  const s=linkFixture();const offer=await s.load('backend/guestBookingOfferIssuer').issueGuestBookingOffer(s.realm(s.input()));assert.notEqual(offer,'DENIED');
  assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(offer.token,offer.capsule)).status,'ACCEPTED_PENDING');
  const actualWeb=await web(s.load('backend/guestConsentContext'));const issued=await actualWeb.createGuestConsentBrowserContext();assert.equal(issued.status,'CREATED');
  assert.equal((await s.load('backend/guestConsentBookingLink').linkGuestConsentBrowserToAcceptedBooking(issued.token,offer.token,offer.capsule)).status,'LINKED');
  assert.equal((await actualWeb.withdrawGuestConsentBrowser(issued.token)).status,'RECORDED');
  const foreign=await s.load('backend/guestBookingOfferIssuer').issueGuestBookingOffer(s.realm({...s.input(),guestName:'Unrelated fixture'}));
  assert.equal((await s.load('backend/guestBookingAcceptance').acceptGuestBookingOffer(foreign.token,foreign.capsule)).status,'ACCEPTED_PENDING');
  const history=plain(s.state.db),roots=history.rows.GuestBookingAcceptances;history.rows.GuestConsentBrowserContexts=[];history.keys=null;
  const fresh=linkFixture(history);fresh.state.now=offer.offerExpiresAtMs+1;fresh.state.trace=[];
  const retained=fresh.load('backend/guestConsentBookingLink');assert.equal((await retained.readGuestConsentBookingNegative(roots[0]._id)).status,'WITHDRAWN');assert.equal((await retained.readGuestConsentBookingNegative(roots[1]._id)).status,'UNRESOLVED');
  assert.ok(fresh.state.trace.every(t=>t.op==='find'),'B04 fresh module retained history read-only');
  console.log('B04 actual issuer/acceptance/T2 writer + new web withdrawal + fresh module expired/contextless read PASS; local SDK history only');

  const command={type:'wbe-consent-deny',version:1};
  for(const bad of [{...command,token:b.token},{...command,status:'RECORDED'},{...command,version:2},{type:'wbe-consent-grant',version:1},null]){
    const tr=transport();tr.head.testOnlyGrantConsent(true,true,true,true);tr.relay(bad);assert.equal(tr.sent.length,0);assert.equal(tr.head.state().ad_storage,'granted');
  }
  for(const field of ['source','origin']){
    const tr=transport();tr.head.testOnlyGrantConsent(true,true,true,true);
    tr.iframe.onmessage({data:command,source:tr.head.window,origin:'https://www.wanderlustcaribbean.com',[field]:field==='source'?{}:'https://evil.invalid'});assert.equal(tr.sent.length,0);
    tr.head.rawMessage({data:command,source:tr.iframe,origin:'https://bridge.synthetic.invalid',[field]:field==='source'?{}:'https://evil.invalid'});assert.equal(tr.head.state().ad_storage,'granted');
  }
  const unknown=transport({unknown:true});unknown.head.testOnlyGrantConsent(true,true,true,true);unknown.relay(command);assert.equal(unknown.head.state().ad_storage,'granted','B05 unconfigured topology rejected');
  const replay=transport();replay.relay(command);replay.relay(command);assert.equal(replay.head.state().ad_storage,'denied');assert.ok(replay.head.calls().every(c=>c[0]!=='event'));
  console.log('B05 exact token-free command/source/origin/replay/unknown topology PASS; no delivery or cross-tab atomicity claim');

  const noDelegate=read(webPath).replace('await withdraw(args[0])', "{ status: 'UNKNOWN' }");
  const broken=await web(privateModule.api,noDelegate);const witness=browser(broken);await witness.click();assert.throws(()=>assert.match(witness.labels.at(-1),/recorded/i),assert.AssertionError,'B06 removing actual delegation fails recorded success');
  const noDenial=read('velo/masterPage.js').replace("$w('#wbeEventBridge').postMessage({ type: 'wbe-consent-deny', version: 1 });",'void 0;');
  const causal=transport();causal.head.testOnlyGrantConsent(true,true,true,true);const removed=browser(api,{source:noDenial,relay:causal.relay});await removed.click();assert.throws(()=>assert.equal(causal.head.state().ad_storage,'denied'),assert.AssertionError,'B06 denial removal causal witness');
  const np=sdk();const reversed=await load(np,{store:text=>text.replace("const after = await read('GuestConsentWithdrawals', row._id, row, deadline);", "const after = { status: 'FOUND' };")});
  const reversedWeb=await web(reversed.api);np.hook=async(op,c)=>op==='insert'&&c==='GuestConsentWithdrawals'?{}:undefined;
  const falseSuccess=browser(reversedWeb);await falseSuccess.click();assert.throws(()=>assert.match(falseSuccess.labels.at(-1),/pending/i),assert.AssertionError,'B06 readback removal false success caught');
  const master=read('velo/masterPage.js');
  const oldMaster=spawnSync('git',['show','HEAD:velo/masterPage.js'],{cwd:root,encoding:'utf8'});assert.equal(oldMaster.status,0);
  const unchanged="// Velo's worker sandbox";
  assert.equal(master.slice(master.indexOf(unchanged)),oldMaster.stdout.replace(/\r\n/g,'\n').slice(oldMaster.stdout.replace(/\r\n/g,'\n').indexOf(unchanged)),'B06 original settings/tracking body unchanged');
  await googleBehaviorRegression();
  assert.doesNotMatch(read(webPath),/guestConsentBookingLink|resolveGuestConsentBrowserContext|fetch\s*\(|console\./);
  console.log('B06 cache arity/source isolation/causal delegation+readback+denial PASS; existing exact incoming pins deliberately FROZEN, edge approval still pending');
  console.log('B01-B06 finite implementation coverage executed; not full B06 isolation approval or live activation.');
}
async function googleBehaviorRegression(){
  // Isolated TEST SCAFFOLD, not a changed pin or a full unchanged-command PASS:
  // reconstruct the historical mutant WITHOUT the new branch, retaining its
  // original exact hash assertion. All current-source behavior tests stay intact.
  const html=read('velo/custom-code/google-tag-and-consent.html');
  const begin='\n    // FAIL CLOSED until the actual Wix sandbox origin';
  const end='\n    // Cross-tab storage is suppression only';
  assert.equal(html.split(begin).length,2);assert.equal(html.split(end).length,2);
  const branch=html.slice(html.indexOf(begin),html.indexOf(end));
  let script=read('scripts/verify-google-consent-transitions.js');
  const anchor='const globalGrantReversal = replaceOnce(replaceOnce(source,';
  assert.equal(script.split(anchor).length,2);
  // Removing exactly the added branch preserves the prior source bytes.
  script=script.replace(anchor,`const globalGrantReversal = replaceOnce(replaceOnce(source.replace(${JSON.stringify(branch)}, ''),`);
  const state={exitCode:0}, output=[];
  vm.runInNewContext(script,{require,__dirname,process:state,console:{log(...a){output.push(a.join(' '));},error(...a){output.push(a.join(' '));}}});
  assert.equal(state.exitCode,0,output.join('\n'));
  assert.equal(output.at(-1),'25 passed, 0 failed');
  console.log('B06 Google isolated reconstruction scaffold: '+output.at(-1)+'; original verifier pin failure remains separately reported');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
