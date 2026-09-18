const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {load,payload,names,ids,token,root,file} = require('./google-ads-processing-test-helper.cjs');
const discovery = require('./fixtures/google-ads-processing-discovery.json');

test('real ESM graph links actual .web auth export and private sanitizer; SDK IO inert', async () => {
  for (const failOAuth of [false,true]) {
    const requests=[], secretNames=[], logs=[], claims=[];
    const context=vm.createContext({Buffer, URLSearchParams, Date, setTimeout, clearTimeout,
      console:Object.fromEntries(['log','warn','error','info','debug'].map(k=>[k,(...a)=>logs.push(a)]))});
    const synthetic = exports => new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context});
    const sdkFetch=(url,init)=> {
      requests.push({url,init});
      if(url==='https://oauth2.googleapis.com/token') {
        assert.equal(init.method,'post');
        return failOAuth ? {ok:false,status:401,text:async()=>token} : {ok:true,json:async()=>({access_token:token,expires_in:3600})};
      }
      assert.ok(ids.some(id=>url==='https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId='+id));
      assert.equal(init.method,'GET'); assert.equal('body' in init,false);
      return {status:200,text:async()=>JSON.stringify(payload())};
    };
    const modules=new Map();
    async function linker(specifier) {
      if(modules.has(specifier)) return modules.get(specifier);
      let mod;
      if(specifier==='wix-fetch') mod=synthetic({fetch:sdkFetch});
      else if(specifier==='wix-secrets-backend') mod=synthetic({getSecret:async name=>{secretNames.push(name); return 'INERT_PLACEHOLDER_NOT_A_SECRET';}});
      else if(specifier==='crypto') mod=synthetic({default:{createSign(){return {update(unsigned){claims.push(JSON.parse(Buffer.from(unsigned.split('.')[1],'base64url').toString()));return this;},sign(){return Buffer.from('INERT_SIGNATURE');}};}}});
      else {
        assert.ok(['backend/dataManagerClient.web','backend/googleAdsHttpDiagnostics'].includes(specifier),'unapproved graph edge '+specifier);
        mod=new vm.SourceTextModule(fs.readFileSync(path.join(root,'velo',specifier+'.js'),'utf8'),{context,identifier:specifier});
      }
      modules.set(specifier,mod); if(mod instanceof vm.SourceTextModule) await mod.link(linker); return mod;
    }
    const entry=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file});
    await entry.link(linker); await entry.evaluate();
    const out=await entry.namespace[names[0]]();
    assert.equal(typeof modules.get('backend/dataManagerClient.web').namespace.getAccessToken,'function');
    assert.deepEqual(secretNames,['GOOGLE_SA_CLIENT_EMAIL','GOOGLE_SA_PRIVATE_KEY']);
    assert.equal(claims.length,1); assert.equal(claims[0].scope,'https://www.googleapis.com/auth/datamanager');
    assert.equal(out.projectionComplete,!failOAuth); assert.equal(requests.length,failOAuth?1:2);
    if(failOAuth) assert.equal(out.failureCode,'AUTH_FAILED');
    assert.equal(JSON.stringify(out).includes(token),false); assert.equal(logs.length,0);
  }
});
test('pinned official discovery route and complete processing enum vocabularies', async () => {
  assert.equal(discovery.method.httpMethod,'GET'); assert.equal(discovery.method.path,'v1/requestStatus:retrieve');
  assert.deepEqual(discovery.method.scopes,['https://www.googleapis.com/auth/datamanager']);
  assert.equal(discovery.method.parameters.requestId.location,'query');
  for(const [schema,info,key,output] of [['ErrorCount','errorInfo','errorCounts','errors'],['WarningCount','warningInfo','warningCounts','warnings']]) {
    const reasons=discovery.schemas[schema].properties.reason.enum;
    for(const reason of reasons) {
      const b=payload(); b.requestStatusPerDestination[0][info]={[key]:[{reason,recordCount:'1'}]};
      const h=await load({payload:b}); const out=await h.api[names[0]]();
      assert.equal(out.destinations[0][output][0].reason,reason); assert.equal(out.unknownReasonPresent,false);
    }
  }
  // Synchronous ingestion enum is deliberately not a downstream reason.
  const b=payload(); b.requestStatusPerDestination[0].errorInfo.errorCounts[0].reason='NO_IDENTIFIERS_PROVIDED';
  const h=await load({payload:b}); const out=await h.api[names[0]]();
  assert.equal(out.destinations[0].errors[0].reason,'UNKNOWN'); assert.equal(out.projectionComplete,false);
});
test('known SUCCESS with warnings is not changed to FAILED or converted into success counts',async()=>{
  const b=payload('SUCCESS'); b.requestStatusPerDestination[0].warningInfo={warningCounts:[{reason:'PROCESSING_WARNING_REASON_INTERNAL_ERROR',recordCount:'1'}]};
  const h=await load({payload:b}); const out=await h.api[names[0]]();
  assert.equal(out.projectionComplete,true); assert.equal(out.destinations[0].requestStatus,'SUCCESS');
  assert.equal(out.destinations[0].recordCount,'1'); assert.equal(out.destinations[0].warnings.length,1);
  assert.equal('successCount' in out.destinations[0],false);
});
test('entry source is private and has no upload, adjustment, CMS, logging or arbitrary endpoint exports',()=>{
  const source=fs.readFileSync(file,'utf8');
  assert.equal(/webMethod|Permissions|wix-data|console\.|ingestEvent|adjustBooking|events:ingest|http-functions/.test(source),false);
  assert.deepEqual([...source.matchAll(/from '([^']+)'/g)].map(m=>m[1]),['backend/dataManagerClient.web','wix-fetch']);
});
