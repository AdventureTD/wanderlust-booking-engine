'use strict';
// Actual-source reviewer scenarios, inert transport and attached DOM controls.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const harness=fs.readFileSync(__dirname+'/ads-custom-form.cjs','utf8').split('(async()=>{')[0];
const context={require,__dirname,console,URL,setTimeout,clearTimeout};
vm.runInNewContext(harness+'\nthis.fixture=fixture;',context);
const fixture=context.fixture, key='wbe_consent_choice_v2', ttl=15552000000;
const count=f=>f.events().filter(e=>e[1]==='form_submit').length;
const saved=(at,choice='granted')=>({[key]:JSON.stringify({source:'banner-click-v2',choice,at})});
const clock=(f,t)=>vm.runInContext('Date.now=()=>'+t,f.head);
const pair=(f,n)=>{
 f.dispatch({source:'wbe-ads-form',phase:'begin',sequence:n,policy:null});
 return ['prepare','complete'].map(phase=>({source:'wbe-ads-form',phase,sequence:n,policy:{v:1,requirement:'REQUIRED',policyKey:'a'.repeat(64),observedAt:vm.runInContext('Date.now()',f.head)}}));
};
(async()=>{
  // Screenshot regression: real source with delivered flags and native empty policy.
  // Track every created node, not just final attachment, to reject hide-after-flash.
  for (const headFile of ['velo/custom-code/google-tag-and-consent.source.html','velo/custom-code/google-tag-and-consent.html']) {
    for (const readyState of ['complete','loading']) {
      const x=await fixture({automatic:true,policyRows:[],route:'/about',readyState,headFile});
      const noControls=()=>{
        assert.equal(x.document.getElementById('wbe-consent-settings'),null,'banner OFF must not create the About-page Cookie settings button');
        assert.equal(x.document.getElementById('wbe-consent-banner'),null);
        assert.equal(x.createdElements.some(el=>el.id==='wbe-consent-settings'||el.id==='wbe-consent-banner'),false,'no transient controls or showBanner');
        assert.equal(x.buttons['Cookie settings'],undefined,'no hidden settings click handler');
      };
      noControls();
      for(const h of x.documentListeners.DOMContentLoaded||[])h();
      noControls();
      await x.submit();assert.equal(count(x),1,'native empty policy stays eligible without UI');
      assert.equal(x.store.has(key),false,'no fabricated choice');
      noControls();
      vm.runInContext("gtag('consent','update',{ad_user_data:'denied'})",x.head);
      for(const d of pair(x,99)) { if(d.policy)d.policy.requirement='NOT_REQUIRED'; x.dispatch(d); }
      assert.equal(count(x),1,'same-page external denial blocks later empty-policy event');
      const retained=x.store.get(key);
      const reload=await fixture({automatic:true,policyRows:[],headFile,stored:Object.fromEntries(x.store)});
      await reload.submit();assert.equal(count(reload),0,'external denial survives reload without UI');
      assert.equal(reload.store.get(key),retained,'denial is neither erased nor renewed');
    }
    for(const policyRows of [[],[{_id:'a',countryCode:'CA',usStateCode:'',consentRequired:false}],[{_id:'a',countryCode:'CA',usStateCode:'',consentRequired:true}],'error']) {
      const x=await fixture({automatic:true,policyRows,headFile,stored:saved(0,'denied')});
      await x.submit();assert.equal(count(x),0,'historical denial survives UI OFF');
      assert.equal(x.store.get(key),saved(0,'denied')[key]);
      assert.equal(x.createdElements.some(el=>el.id==='wbe-consent-settings'||el.id==='wbe-consent-banner'),false,'NOT_REQUIRED/UNRESOLVED do not create UI');
    }
  }
  console.log('PASS delivered source/deploy About DOM: no creation/flash/click path; empty policy eligible; persistent and same-page denial');
  const f=await fixture({consent:'yes'});
  assert.equal(f.document.getElementById('wbe-consent-banner'),null);
  f.click('Cookie settings'); f.click('Deny');
  const reload=await fixture({stored:Object.fromEntries(f.store)});
  reload.click('Cookie settings'); await reload.submit(); assert.equal(count(reload),0);
  const returning=await fixture({stored:saved(Date.now())});
  returning.click('Cookie settings'); returning.click('Deny'); await returning.submit(); assert.equal(count(returning),0);
  console.log('PASS R1 attached returning grant/denial settings and durable withdrawal');
  const external=await fixture({consent:'yes'});
  const [prepare,complete]=pair(external,1); external.dispatch(prepare);
  vm.runInContext("gtag('consent','update',{ad_user_data:'denied'})",external.head);
  assert.notEqual(JSON.parse(external.store.get(key)).choice,'granted','external denial must invalidate stored grant');
  const after=await fixture({stored:Object.fromEntries(external.store)}); await after.submit(); assert.equal(count(after),0);
  external.click('Cookie settings'); external.click('Accept All'); external.dispatch(complete); assert.equal(count(external),0);
  const updates=external.window.dataLayer.filter(e=>e[0]==='consent'&&e[1]==='update');
  assert.equal(updates.at(-1)[2].ad_user_data,'granted','fresh acceptance must really update Google');
  after.click('Cookie settings'); after.click('Accept All'); for(const d of pair(after,2))after.dispatch(d); assert.equal(count(after),1);
  console.log('PASS R2 reviewer external denial/reload and fresh acceptance consent update');
  for(const mode of ['before','init-expired','complete-expired','rollback','future','malformed','exact-expiry']) {
    const now=Date.now(), at=now-ttl+1000;
    const x=await fixture({now,stored:saved(mode==='future'?now+60000:at,mode==='malformed'?'unknown':'granted')});
    const original=x.store.get(key);
    clock(x,now);
    const [p,c]=pair(x,1);
    if(mode==='init-expired'||mode==='exact-expiry')clock(x,at+ttl+(mode==='init-expired'?1000:0));
    p.policy.observedAt=vm.runInContext('Date.now()',x.head); x.dispatch(p);
    if(mode==='complete-expired')clock(x,now+2000);
    if(mode==='rollback')clock(x,now-1);
    c.policy.observedAt=vm.runInContext('Date.now()',x.head); x.dispatch(c);
    assert.equal(count(x),mode==='before'?1:0,mode);
    assert.equal(x.store.get(key),original,'read must not renew retention');
    if(mode==='complete-expired') {
      x.click('Cookie settings');x.click('Accept All');x.dispatch(c);assert.equal(count(x),0);
      for(const d of pair(x,2))x.dispatch(d);assert.equal(count(x),1);
    }
  }
  console.log('PASS R3 original expiry at prepare/complete, exact boundary, rollback, future/malformed and reacceptance');
  for(const mode of ['storage','duplicate-frame','opaque-origin','throw-prepare','throw-complete']) {
    const x=await fixture({consent:'yes'});
    if(mode==='storage')for(const h of x.listeners.storage||[])h({key});
    if(mode==='duplicate-frame')vm.runInContext("document.querySelectorAll=(s)=>s.startsWith('iframe')?[{},{}]:[]",x.head);
    if(mode==='opaque-origin')x.frameElement.src='data:text/html,bridge';
    if(mode==='throw-prepare')x.p.c.prepareAdsFormSubmission=()=>{throw Error('inert')};
    if(mode==='throw-complete')x.p.c.completeAdsFormSubmission=()=>{throw Error('inert')};
    await x.submit();assert.equal(count(x),0,mode);assert.equal(x.p.payloads.length,2);assert.equal(x.p.invoices.length,1);
  }
  const now=Date.now();
  const expired=await fixture({now,stored:saved(now-ttl+1000)});clock(expired,now+2000);await expired.submit();assert.equal(count(expired),0);
  for(const v of ['{','null','[]',JSON.stringify({source:'banner-click-v2',choice:'granted',at:String(now)}),JSON.stringify({source:'banner-click-v2',choice:'granted',at:now,extra:true}),JSON.stringify({source:'banner-click-v2',choice:'granted',at:-1}),JSON.stringify({source:'banner-click-v2',choice:'granted',at:now+0.5})]) {
    const x=await fixture({now,stored:{[key]:v}});await x.submit();assert.equal(count(x),0,'malformed storage');
  }
  const failed=await fixture({now,consent:'yes',storageWriteFails:true});
  for(const d of pair(failed,1))failed.dispatch(d);assert.equal(count(failed),0,'unpersisted grant fails closed');
  clock(failed,now+ttl);for(const d of pair(failed,2))failed.dispatch(d);assert.equal(count(failed),0,'failed storage stays closed');
  const automatic=await fixture({automatic:true,stored:saved(now)});assert.equal(automatic.document.getElementById('wbe-consent-settings'),null);assert.equal(automatic.document.getElementById('wbe-consent-banner'),null);await automatic.submit();assert.equal(count(automatic),1,'returning valid choice independent of banner visibility');
  const defaults=await fixture({consent:'yes'});vm.runInContext("gtag('consent','default',{ad_user_data:'denied'})",defaults.head);await defaults.submit();assert.equal(count(defaults),1,'default initialization is not a withdrawal');
  const quota=await fixture({now,stored:saved(now),storageWriteFails:true});
  vm.runInContext("gtag('consent','update',{ad_user_data:'denied'})",quota.head);
  const quotaReload=await fixture({now,stored:Object.fromEntries(quota.store)});await quotaReload.submit();assert.equal(count(quotaReload),0,'failed denial write must not retain stale grant');
  console.log('PASS reviewer five negative probes, linked expiry, malformed records, bounded storage failure, defaultOFF and default-not-withdrawal');
})().catch(e=>{console.error(e);process.exitCode=1;});
