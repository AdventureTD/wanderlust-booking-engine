const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,bounded,marker}=require('./deadlines.test.cjs');
const target=marker.url;
const ok=()=>({status:200,json:async()=>marker});
function fixture(mode){
 const calls=[];const h=load(async(url,options)=>{
  calls.push({url,options});
  if(options.redirect!=='error') {
   if(mode==='control-network')throw Error('inert DNS failure');
   if(mode==='wrong-url')return {status:200,json:async()=>({...marker,url:target+'/wrong'})};
   if(mode==='wrong-marker')return {status:200,json:async()=>({...marker,args:{marker:'wrong'}})};
   if(mode==='control-status')return {status:302,json:async()=>marker};
   return ok();
  }
  // Old direct-final control remains successful, exposing missing differential.
  if(url===target)return ok();
  if(mode==='followed')return ok();
  if(mode==='fulfilled')return {status:302,json:async()=>({})};
  if(mode==='error-body-hang')return {status:200,json:()=>new Promise(()=>{})};
  if(mode==='error-fetch-hang')return new Promise(()=>{});
  const e=Error('inert network failure');if(mode==='specific')e.type='no-redirect';throw e;
 });return {...h,calls};
}
test('same endpoint normal-follow positive precedes each specific redirect rejection',async()=>{
 const h=fixture('specific');assert.equal(h.calls.length,0);assert.equal(h.run.length,0);
 const r=await bounded(h.run);assert.equal(r.state,'REQUIRES_REVIEW');assert.equal(r.cases.length,5);assert.equal(h.calls.length,10);
 for(let i=0;i<5;i++){
  const status=[301,302,303,307,308][i];const a=h.calls[2*i],b=h.calls[2*i+1];
  assert.equal(a.url,'https://httpbin.org/redirect-to?url='+encodeURIComponent(target)+'&status_code='+status);assert.equal(b.url,a.url);
  assert.deepEqual(JSON.parse(JSON.stringify(a.options)),{method:'get'});assert.deepEqual(JSON.parse(JSON.stringify(b.options)),{method:'get',redirect:'error'});
  assert.equal(r.cases[i].status,status);assert.equal(r.cases[i].control,'FOLLOW_CONFIRMED');assert.equal(r.cases[i].result,'EXPECTED_REJECTION');
 }assert.equal(h.live.size,0);
});
for(const mode of ['control-network','wrong-url','wrong-marker','control-status'])test(mode+' cannot validate fixture',async()=>{
 const h=fixture(mode);const r=await bounded(h.run);assert.equal(r.state,'INCONCLUSIVE_CONTROL');assert.equal(h.calls.length,1);assert.equal(h.live.size,0);
});
for(const mode of ['network','error-fetch-hang','error-body-hang'])test(mode+' is UNKNOWN never positive redirect evidence',async()=>{
 const h=fixture(mode);const r=await bounded(h.run);assert.equal(r.state,'REQUIRES_REVIEW');assert.equal(r.cases.length,5);assert.ok(r.cases.every(c=>c.result==='UNKNOWN'));assert.equal(h.calls.length,10);assert.equal(h.live.size,0);
});
for(const [mode,result,state] of [['followed','FOLLOWED','REDIRECT_FOLLOWED_UNSAFE'],['fulfilled','FULFILLED_UNPROVEN','REQUIRES_REVIEW']])test(mode+' retains conservative original classification',async()=>{
 const h=fixture(mode);const r=await bounded(h.run);assert.equal(r.state,state);assert.equal(r.cases.length,5);assert.ok(r.cases.every(c=>c.result===result));assert.equal(h.calls.length,10);assert.equal(h.live.size,0);
});
