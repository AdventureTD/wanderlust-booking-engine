'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const root=path.resolve(__dirname,'..');
const logs=[];
let support=fs.readFileSync(path.join(__dirname,'click-attribution-corrections.cjs'),'utf8').split("test('partitioned page ID")[0];
support=support.replaceAll('console:{log(){},error(){}}','console:{log:(x)=>logs.push(x),error(){}}');
const box={require,__dirname,console,setTimeout,clearTimeout,URL,logs};
vm.runInNewContext(support+'\nthis.fixture=fixture;',box);
const {events: copiedEvents}=require('./attribution-diagnostic-console.cjs');
const events=()=>copiedEvents(logs);
const pagebox={require:require('node:module').createRequire(path.join(__dirname,'attribution-hotfix.cjs')),__dirname,console};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'attribution-hotfix.cjs'),'utf8').split('function bookingBackend')[0]+'\nthis.page=page;',pagebox);
for(const mode of ['missing-financial','null-attribution','direct'])test('Summary diagnostic '+mode,async()=>{
 const p=await pagebox.page({setup:mode==='missing-financial'?'_selectedPackageStayTotal=-100;_hasSelectedPackageStayTotal=true;':''});
 const captured=[];p.c.console={log:x=>captured.push(x),warn(){},error(){}};
 if(mode==='null-attribution')p.c.getStoredClickIds=()=>null;
 await p.click();
 const es=copiedEvents(captured);
 assert.equal(es.length,1);assert.equal(es[0].stage,'browser');
 assert.equal(es[0].reason,{'missing-financial':'FINANCIAL_MISSING','null-attribution':'ATTRIBUTION_NULL',direct:'RPC_INVOKED'}[mode]);
 assert.equal(p.ads.length,mode==='direct'?1:0);assert.equal(p.invoices.length,1);
});
test('late policy rejection adds no diagnostic after timeout',async()=>{
 logs.length=0;let reject;const f=await box.fixture({policyRead:()=>new Promise((_,r)=>reject=r)});
 try{await f.ready();const n=events().length;reject(Error('LATE_PRIVATE_CANARY'));await new Promise(r=>setTimeout(r,20));assert.equal(events().length,n);}
 finally{f.api.setSuspendGoogleAds(true);f.close();}
});
test('policy timeout is observed at source without permitting attribution',async()=>{
 logs.length=0;const f=await box.fixture({policyRead:()=>new Promise(()=>{})});
 try{await f.ready();assert.equal(f.api.getStoredClickIds(undefined,true),null);assert.ok(events().some(x=>x.stage==='policy'&&x.reason==='TIMEOUT'));}
 finally{f.api.setSuspendGoogleAds(true);f.close();}
});
for(const op of ['open','read','confirm'])test(op+' timeout is not inferred frame failure',async()=>{
 logs.length=0;const f=await box.fixture({hold:d=>d.op===op});
 try{await f.ready();assert.equal(f.api.getStoredClickIds(undefined,true),null);assert.ok(events().some(x=>x.stage===op&&x.reason==='TIMEOUT'));assert.ok(!events().some(x=>x.reason==='FRAME_BINDING'));const n=events().length;for(const d of f.deliveries){if(op!=='open')d.deliver();}await new Promise(r=>setTimeout(r,20));assert.equal(events().length,n);}
 finally{f.api.setSuspendGoogleAds(true);f.close();}
});
for(const mode of ['wrong-title','denied','withdrawal','empty'])test('actual Head '+mode,async()=>{
 logs.length=0;const f=await box.fixture({query:'',deny:mode==='denied'});
 try{if(mode==='wrong-title')f.head.document.querySelectorAll=()=>[];if(mode==='withdrawal')f.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await f.ready();assert.equal(f.api.getStoredClickIds(undefined,true)!==null,mode==='empty');const reason={ 'wrong-title':'FRAME_BINDING',denied:'CONSENT_DENIED',withdrawal:'WITHDRAWAL',empty:'READY_EMPTY'}[mode];assert.ok(events().some(x=>x.reason===reason),reason);}
 finally{f.api.setSuspendGoogleAds(true);f.close();}
});
test('privacy canaries and finite exact schema, deduplication',async()=>{
 logs.length=0;const f=await box.fixture({query:'gclid=CONTACT_TOKEN_URL_CANARY',policyRead:async()=>{throw Error('PRIVATE_ERROR_CANARY');}});
 try{for(let i=0;i<3;i++)await f.ready();const es=events();assert.ok(es.length>0);for(const e of es){assert.deepEqual(Object.keys(e).sort(),['event','reason','stage','v']);assert.equal(e.v,1);assert.ok(['policy','open','read','confirm','clear','worker','head','browser'].includes(e.stage));assert.ok(['TIMEOUT','REJECTED','TRANSPORT_ERROR','CRYPTO_UNAVAILABLE','READY_EMPTY','READY_RECORD','FRAME_BINDING','CONSENT_DENIED','WITHDRAWAL','FINANCIAL_MISSING','ATTRIBUTION_NULL','RPC_INVOKED'].includes(e.reason));assert.ok(JSON.stringify(e).length<180);}assert.equal(new Set(es.map(x=>x.stage+':'+x.reason)).size,es.length);assert.ok(es.length<=32);assert.ok(!JSON.stringify(es).includes('CANARY'));}
 finally{f.api.setSuspendGoogleAds(true);f.close();}
});

