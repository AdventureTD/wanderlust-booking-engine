const {test} = require('node:test');
const assert = require('node:assert/strict');
const {load,payload,token} = require('./google-ads-processing-test-helper.cjs');
const name = 'readWC1043ProcessingStatus';
const id = '071b3837-db3c-4d58-be16-1a2092d9f4cf';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Actual transitive project ESM, with only Wix/crypto platform edges inert.
async function graph() {
  const calls=[], logs=[];
  const context=vm.createContext({Buffer,URLSearchParams,Date,setTimeout,clearTimeout,
    console:{log:(...x)=>logs.push(x),warn:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}});
  const cache=new Map();
  const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){
    for(const [k,v] of Object.entries(values))this.setExport(k,v);
  },{context});
  async function moduleFor(name) {
    if(cache.has(name))return cache.get(name);
    let module;
    if(name==='wix-data')module=synthetic({default:new Proxy({}, {get(){throw Error('CMS forbidden');}})});
    else if(name==='wix-secrets-backend')module=synthetic({getSecret:async()=>token});
    else if(name==='crypto')module=synthetic({default:{createSign:()=>({update:()=>({sign:()=>Buffer.from('inert')})})}});
    else if(name==='wix-fetch')module=synthetic({fetch:async(url,init)=>{
      calls.push({url,init});
      if(url==='https://oauth2.googleapis.com/token')return {ok:true,json:async()=>({access_token:token,expires_in:3600})};
      assert.equal(url,'https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId='+id);
      return {status:200,text:async()=>JSON.stringify(payload('SUCCESS'))};
    }});
    else {
      assert.ok(['backend/googleAdsProcessingDiagnostic','backend/dataManagerClient.web','backend/googleAdsHttpDiagnostics'].includes(name));
      module=new vm.SourceTextModule(fs.readFileSync(path.resolve(__dirname,'../velo',name+'.js'),'utf8'),{context});
    }
    cache.set(name,module);
    await module.link(moduleFor);return module;
  }
  const module=await moduleFor('backend/googleAdsProcessingDiagnostic');
  await module.evaluate();
  return {api:module.namespace,calls,logs};
}

test('WC1043 actual OAuth and GET deny redirects without ingestion or CMS entry',async()=>{
  const h=await graph();
  assert.equal(h.calls.length,0);
  const out=await h.api[name]();
  assert.equal(out.projectionComplete,true);
  assert.equal(h.calls.length,2);
  assert.equal(h.calls[0].init.method,'post');
  assert.equal(h.calls[0].init.redirect,'error');
  assert.equal(h.calls[1].init.redirect,'error');
  assert.equal(h.calls[1].init.method,'GET');
  assert.equal(h.logs.length,0);
  assert.equal(JSON.stringify(out).includes(token),false);
});

test('WC1043 rejects contradictory response identity and any nonmatching destination',async()=>{
  for(const mutate of [
    b=>{b.requestId='00000000-0000-0000-0000-000000000000';},
    b=>{b.requestStatusPerDestination[0].destination.operatingAccount.accountId='0000000000';},
    b=>{b.requestStatusPerDestination[0].destination.productDestinationId='0000000000';},
    b=>{b.requestStatusPerDestination.push(b.requestStatusPerDestination[0]);}
  ]){
    const body=payload('SUCCESS');mutate(body);
    const h=await load({payload:body});const result=await h.api[name]();
    assert.equal(result.projectionComplete,false);
    assert.ok(['REQUEST_ID_MISMATCH','DESTINATION_MISMATCH'].includes(result.failureCode));
    assert.equal(result.destinations.length,0);
    assert.equal(result.requestId,id);
  }
});

test('WC1043 rejects all arguments before auth and denies late or failed auth',async()=>{
  for(const args of [[undefined],[null],[id],[{}],[1,2]]){
    const h=await load();const r=await h.api[name](...args);
    assert.equal(r.failureCode,'ARGUMENTS_NOT_ALLOWED');assert.equal(r.requestId,id);
    assert.equal(h.authCalls(),0);assert.equal(h.calls.length,0);
  }
  let release;
  const h=await load({auth:()=>new Promise(resolve=>{release=resolve;})});
  const pending=h.api[name]();assert.equal(h.calls.length,0);
  const timer=[...h.timers.values()][0];assert.equal(timer.ms,15000);timer.fn();
  release(token);assert.equal((await pending).failureCode,'TIMEOUT');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.length,0);
  const denied=await load({auth:()=>Promise.reject(Error(token))});
  assert.equal((await denied.api[name]()).failureCode,'AUTH_FAILED');
  assert.equal(denied.calls.length,0);
});

test('WC1043 finite state and unknown reason projection never claims attribution',async()=>{
  for(const status of ['SUCCESS','FAILED','PARTIAL_SUCCESS','PROCESSING','REQUEST_STATUS_UNKNOWN',token]){
    const body=payload(status);
    if(status==='PARTIAL_SUCCESS')body.requestStatusPerDestination[0].errorInfo=payload().requestStatusPerDestination[0].errorInfo;
    const h=await load({payload:body});const r=await h.api[name]();
    assert.equal(r.requestId,id);
    assert.equal(r.destinations[0].requestStatus,status===token?'REQUEST_STATUS_UNKNOWN':status);
    assert.equal(r.projectionComplete,['SUCCESS','FAILED','PARTIAL_SUCCESS'].includes(status));
    assert.equal('attributedCount' in r.destinations[0],false);
    assert.equal(JSON.stringify(r).includes(token),false);
  }
  const body=payload();body.requestStatusPerDestination[0].errorInfo.errorCounts[0]={reason:token,recordCount:'-1',message:token};
  const h=await load({payload:body});const r=await h.api[name]();
  assert.equal(r.unknownReasonPresent,true);assert.equal(r.projectionComplete,false);
  assert.equal(r.destinations[0].errors[0].reason,'UNKNOWN');
  assert.equal(JSON.stringify(r).includes(token),false);
});

test('WC1043 HTTP failure and redirect rejection return sanitized failure without retry',async()=>{
  for(const status of [301,302,307,308,401,403,404,500]){
    let reads=0;const h=await load({fetch:()=>({status,text:()=>{reads++;throw Error(token);}})});
    const r=await h.api[name]();assert.equal(r.failureCode,'HTTP_ERROR');
    assert.equal(r.httpStatus,status);assert.equal(reads,0);assert.equal(h.calls.length,1);
    assert.equal(JSON.stringify(r).includes(token),false);
  }
  const h=await load({fetch:()=>Promise.reject(Error(token))});
  assert.equal((await h.api[name]()).failureCode,'READ_FAILED');assert.equal(h.calls.length,1);
});

test('WC1043 fixed private reader binds exact GET and strips private fields', async () => {
  const body=payload('FAILED');
  body.requestStatusPerDestination[0].message=token;
  const h=await load({payload:body});
  assert.equal(typeof h.api[name],'function');
  assert.equal(h.api[name].length,0);
  const out=await h.api[name]();
  assert.equal(out.requestId,id);
  assert.equal(h.authCalls(),1);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].url,'https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId='+id);
  assert.equal(h.calls[0].init.method,'GET');
  assert.equal('body' in h.calls[0].init,false);
  assert.equal(out.destinations[0].accountId,'9426928570');
  assert.equal(out.destinations[0].productDestinationId,'7690532327');
  assert.equal(out.destinations[0].requestStatus,'FAILED');
  assert.equal(out.destinations[0].errors[0].reason,'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND');
  assert.equal(out.projectionComplete,true);
  assert.equal(JSON.stringify(out).includes(token),false);
  assert.equal(h.logs.length,0);
  assert.equal(h.timers.size,0);
});
