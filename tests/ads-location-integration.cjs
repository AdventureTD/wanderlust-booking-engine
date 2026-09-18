'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const harness=fs.readFileSync(__dirname+'/ads-custom-form.cjs','utf8').split('(async()=>{')[0];
const context={require,__dirname,console,URL,setTimeout,clearTimeout};
vm.runInNewContext(harness+'\nthis.fixture=fixture;',context);
const fixture=context.fixture;
const count=f=>f.events().filter(e=>e[1]==='form_submit').length;
(async()=>{
 const f=await fixture({automatic:true,policyRows:[]});await f.submit();
 assert.equal(count(f),1,'empty native policy must enable contact-free successful submit without banner');
 assert.equal(f.policyCalls.length,2,'fresh native policy read at both phases');
 assert.equal(f.store.has('wbe_consent_choice_v2'),false,'no invented receipt');
 assert.equal(f.document.getElementById('wbe-consent-banner'),null);
 assert.equal(f.p.payloads.length,2);assert.equal(f.p.invoices.length,1);assert.equal(f.p.ads.length,1);
 console.log('PASS native empty policy -> actual Summary/tracking/iframe/head, no receipt, booking preserved');
 let release;const pause=new Promise(r=>release=r);
 const race=await fixture({automatic:true,policyRows:[],policyRead:async n=>{if(n===1)await pause;}});
 await race.p.click();
 vm.runInContext("gtag('consent','update',{ad_user_data:'denied'})",race.head);
  // A later technical Google grant is not an affirmative reacceptance.
  vm.runInContext("gtag('consent','update',{ad_user_data:'granted'})",race.head);
 release();await race.settle();
 assert.equal(count(race),0,'external denial/regrant while policy pending must invalidate old submission');
 console.log('PASS external denial during native prepare policy await without UI');
 let finish;const pendingChoice=new Promise(r=>finish=r);
 const choiceRace=await fixture({consent:'yes',policyRead:async n=>{if(n===1)await pendingChoice;}});
 await choiceRace.p.click();
 choiceRace.click('Cookie settings');choiceRace.click('Deny');
 choiceRace.click('Cookie settings');choiceRace.click('Accept All');
 finish();await choiceRace.settle();
 assert.equal(count(choiceRace),0,'synthetic REQUIRED enabled-UI withdrawal/reacceptance fences pending policy');
 console.log('PASS synthetic REQUIRED enabled-UI withdrawal/reacceptance during prepare await');
 const denied=await fixture({automatic:true,policyRows:[],stored:{wbe_consent_choice_v2:JSON.stringify({source:'banner-click-v2',choice:'denied',at:0})}});
 await denied.submit();assert.equal(count(denied),0,'denial never expires');
 assert.equal(denied.window.dataLayer.some(e=>e[0]==='consent'&&e[1]==='update'&&e[2].ad_user_data==='granted'),false);
 vm.runInContext('grantConsent()',denied.head);
 assert.equal(denied.window.dataLayer.some(e=>e[0]==='consent'&&e[1]==='update'&&e[2].ad_user_data==='granted'),false,'legacy grant must not override persisted denial');
 console.log('PASS stored denial blocks silent and legacy Google grant');
 const cross=await fixture({automatic:true,policyRows:[]});
 vm.runInContext("gtag('consent','update',{ad_user_data:'denied'})",cross.head);
 const tombstone=cross.store.get('wbe_consent_choice_v2');
 vm.runInContext('Date.now=()=>'+(Date.now()+100),cross.head);
 for(const h of cross.listeners.storage)h({key:'wbe_consent_choice_v2'});
 assert.equal(cross.store.get('wbe_consent_choice_v2'),tombstone,'cross-tab denial must not rewrite timestamps and ping-pong');
 console.log('PASS idempotent cross-tab denial');
 const positive=await fixture({automatic:true,policyRows:[]});
 const grant=JSON.stringify({source:'banner-click-v2',choice:'granted',at:Date.now()});
 positive.store.set('wbe_consent_choice_v2',grant);
 for(const h of positive.listeners.storage)h({key:'wbe_consent_choice_v2'});
 assert.equal(positive.store.get('wbe_consent_choice_v2'),grant,'observing another tab must not fabricate a persisted denial');
 await positive.submit();assert.equal(count(positive),0,'other-tab changes conservatively close this page until explicit choice/reload');
 console.log('PASS cross-tab positive invalidates locally without overwriting choice');
 let resume;const held=new Promise(r=>resume=r);
 const suspended=await fixture({automatic:true,policyRows:[],policyRead:async n=>{if(n===1)await held;}});
 await suspended.p.click();
 suspended.tracking.namespace.setSuspendGoogleAds(true);suspended.tracking.namespace.setSuspendGoogleAds(false);
 resume();await suspended.settle();assert.equal(count(suspended),0,'suspension invalidates pending even if later lifted');
 console.log('PASS pending suspension fence');
 const prior=await fixture({automatic:true,policyRows:[],priorDataLayer:[['consent','update',{ad_user_data:'denied'}]]});
 await prior.submit();assert.equal(count(prior),0,'existing explicit Google denial before installation is not initialization');
 console.log('PASS preexisting explicit Google denial');

 const rule=(v=false)=>({_id:'a',countryCode:'CA',usStateCode:'',consentRequired:v});
 const saved=(choice,at=Date.now())=>({wbe_consent_choice_v2:JSON.stringify({source:'banner-click-v2',choice,at})});
 for(const [name,options,expected] of [
  ['allfalse',{policyRows:[rule()]},1],
  ['positive-rule',{policyRows:[rule(true)]},0],
  ['positive-with-receipt',{policyRows:[rule(true)],stored:saved('granted')},0],
  ['invalid-rule',{policyRows:[{...rule(),countryCode:'XX'}]},0],
  ['read-error',{policyRows:'error'},0],
  ['storage-read-error',{policyRows:[],storageReadFails:true},0],
  ['malformed-choice',{policyRows:[],stored:{wbe_consent_choice_v2:'{'}},0],
  ['expired-grant',{policyRows:[],stored:saved('granted',0)},0],
  ['future-grant',{policyRows:[],stored:saved('granted',Date.now()+60000)},0],
  ['legacy-denial',{policyRows:[],stored:{wbe_consent_choice:'denied'}},0],
  ['fresh-receipt',{policyRows:[],stored:saved('granted')},1],
  ['partial-cart',{policyRows:[],book:async(_,n)=>n===2?{outcome:'UNKNOWN'}:undefined},0],
  ['malformed-policy',{policyRows:[],policyResult:v=>({...v,granted:true})},0],
  ['old-policy',{policyRows:[],policyResult:v=>({...v,observedAt:Date.now()-2000})},0],
  ['future-policy',{policyRows:[],policyResult:v=>({...v,observedAt:Date.now()+60000})},0]
 ]) {
  const x=await fixture({automatic:true,...options});await x.submit();assert.equal(count(x),expected,name);
  assert.equal(x.p.payloads.length,2,name+' booking independence');
  assert.equal(x.document.getElementById('wbe-consent-banner'),null,name+' no universal banner');
  assert.equal(x.document.getElementById('wbe-consent-settings'),null,name+' no universal settings');
  console.log('PASS '+name);
 }
 for(const mode of ['true','false-change','read-failure','deny','storage-deny']) {
  const rows=[];
  let x;
  x=await fixture({automatic:true,policyRows:rows,policyRead:async n=>{
    if(n!==2)return;
    if(mode==='true')rows.push(rule(true));
    if(mode==='false-change')rows.push(rule(false));
    if(mode==='read-failure')throw Error('inert complete read failure');
    if(mode==='deny')vm.runInContext("gtag('consent','update',{ad_user_data:'denied'})",x.head);
    if(mode==='storage-deny') {
      x.store.set('wbe_consent_choice_v2',saved('denied',0).wbe_consent_choice_v2);
      for(const h of x.listeners.storage)h({key:'wbe_consent_choice_v2'});
    }
  }});
  await x.submit();assert.equal(count(x),0,mode+' during complete policy read');assert.equal(x.p.payloads.length,2);
  console.log('PASS complete-boundary '+mode);
 }
 for(const phase of [1,2]) {
  let release;const delayed=new Promise(r=>release=r);
  const x=await fixture({automatic:true,policyRows:[],policyRead:async n=>{if(n===phase)await delayed;}});
  const watchdog=setTimeout(()=>{throw Error('deadline test stuck');},5000);
  try {
    await x.submit();assert.equal(x.p.payloads.length,2,'booking finished while optional read pending');
    assert.ok(x.p.timers.length,'redirect already scheduled');
    await new Promise(r=>setTimeout(r,800));
    release();await x.settle();assert.equal(count(x),0,'late policy cannot grant');
    console.log('PASS actual 750ms policy timeout phase '+phase);
  } finally {release();clearTimeout(watchdog);}
 }
 const wire=JSON.stringify([f.messages,f.events(),f.logs]);
 for(const contact of ['fixture@example.invalid','2025550100','Offline Fixture'])assert.ok(!wire.includes(contact));
 assert.equal(f.window.dataLayer.some(e=>e[0]==='set'&&e[1]==='user_data'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(f.events().find(e=>e[1]==='form_submit')[2])),{send_to:'AW-788746633'});
 console.log('PASS no contacts/global user_data/GA4 leakage and exact AW destination');
})().catch(e=>{console.error(e);process.exitCode=1;});
