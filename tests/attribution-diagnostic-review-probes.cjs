'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),tests=path.join(root,'tests');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
(async()=>{
 const observations=[];
 for(const mode of ['throws','absent']){
  const logger={log(x){if(typeof x==='string'&&x.startsWith('ATTR_DIAG '))throw Error('PRIVATE_LOG_ERROR');},error(){}};
  const workerLogger=mode==='absent'?undefined:logger;
  let support=read('tests/click-attribution-corrections.cjs').split("test('partitioned page ID")[0].replaceAll('console:{log(){},error(){}}','console:logger').replace('Date,console:logger','Date,console:workerLogger');
  const b={require,__dirname:tests,console,setTimeout,clearTimeout,URL,logger,workerLogger};vm.runInNewContext(support+'\nthis.fixture=fixture;',b);
  for(const denial of [false,true]){
   const f=await b.fixture({query:'',deny:denial});if(mode==='absent')f.head.console=undefined;try{await f.ready();assert.equal(f.api.getStoredClickIds(undefined,true)===null,denial);observations.push({case:'worker-head-'+mode,denial,pass:true});}finally{f.close();}
  }
 }
 const b={require:require('node:module').createRequire(tests+'/attribution-hotfix.cjs'),__dirname:tests,console};
 vm.runInNewContext(read('tests/attribution-hotfix.cjs').split('function bookingBackend')[0]+'\nthis.page=page;',b);
 for(const mode of ['direct','null','financial']){
  const p=await b.page({setup:mode==='financial'?'_selectedPackageStayTotal=-100;_hasSelectedPackageStayTotal=true;':''});
  p.c.console={log(x){if(typeof x==='string'&&x.startsWith('ATTR_DIAG '))throw Error('PRIVATE_LOG_ERROR');},warn(){},error(){}};
  if(mode==='null')p.c.getStoredClickIds=()=>null;
  await p.click();assert.equal(p.ads.length,mode==='direct'?1:0);assert.equal(p.invoices.length,1);observations.push({case:'summary-log-throws-'+mode,pass:true});
 }
 // Actual private helper text, isolated only to drive unknown and full finite domains.
 const source=read('velo/public/clickAttribution.js');const helper=source.slice(source.indexOf('const diagnosticSeen'),source.indexOf('function cancelReadiness'));
 const out=[];const h={console:{log:x=>out.push(JSON.parse(x.slice(10)))}};vm.runInNewContext(helper+'\nthis.emit=diagnostic;',h);
 h.emit('PRIVATE_URL_CANARY','TIMEOUT');h.emit('policy','PRIVATE_CONTACT_CANARY');h.emit({},{});assert.equal(out.length,0);
 const stages=['policy','open','read','confirm','clear','worker'];const reasons=['TIMEOUT','REJECTED','TRANSPORT_ERROR','CRYPTO_UNAVAILABLE','READY_EMPTY','READY_RECORD'];
 for(let i=0;i<3;i++)for(const s of stages)for(const r of reasons)h.emit(s,r);
 assert.equal(out.length,32);assert.equal(new Set(out.map(x=>x.stage+':'+x.reason)).size,32);assert.ok(out.every(x=>Object.keys(x).sort().join(',')==='event,reason,stage,v'));assert.ok(!JSON.stringify(out).includes('CANARY'));
 const maximum=Math.max(...stages.flatMap(stage=>reasons.map(reason=>Buffer.byteLength(JSON.stringify({event:'ATTR_DIAG',v:1,stage,reason})))));assert.ok(maximum<180);observations.push({case:'actual-worker-helper-unknown-values-and-cap',pass:true,maximumBytes:maximum});
 // Conservative storage invalidation is NOT evidence of a human withdrawal.
 const logs=[];let support=read('tests/click-attribution-corrections.cjs').split("test('partitioned page ID")[0].replaceAll('console:{log(){},error(){}}',`console:{log:x=>logs.push(typeof x==='string'&&x.startsWith('ATTR_DIAG ')?JSON.parse(x.slice(10)):x),error(){}}`);
 const s={require,__dirname:tests,console,setTimeout,clearTimeout,URL,logs};vm.runInNewContext(support+'\nthis.fixture=fixture;',s);
 const f=await s.fixture({query:''});try{await f.ready();for(const fn of f.listeners.storage||[])fn({key:'wbe_consent_choice_v2'});await f.ready();assert.ok(logs.some(x=>x?.event==='ATTR_DIAG'&&x.reason==='WITHDRAWAL'));assert.equal(f.api.getStoredClickIds(undefined,true),null);observations.push({case:'storage-invalidation-without-human-action',pass:true,classification:'WITHDRAWAL; documented as conservative invalidation, not human action'});}finally{f.api.setSuspendGoogleAds(true);f.close();}
 console.log(JSON.stringify(observations));
})().catch(e=>{console.error(e);process.exitCode=1;});
