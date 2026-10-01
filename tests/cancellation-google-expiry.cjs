// Actual-source expiry schedules; SDK, secrets, clock and transport are inert.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
let support=fs.readFileSync(__dirname+'/cancellation-google.cjs','utf8').split('for(const edge of')[0];
support=support.replace("get:async(c,id)=>c==='BookingCancellationAnalytics'?structuredClone(approval):structuredClone(rows.get(id)||null)","get:async(c,id)=>{if(options.onGet)await options.onGet(c,id,approval);return c==='BookingCancellationAnalytics'?structuredClone(approval):structuredClone(rows.get(id)||null);}")
 .replace("find:async()=>({items:[{value:'0'}]})","find:async()=>{if(options.onSettings)await options.onSettings(approval);return {items:[{value:'0'}]};}")
 .replace('getSecret:async k=>secrets[k]','getSecret:async k=>{if(options.onSecret)await options.onSecret(k,approval);return secrets[k];}');
for(const boundary of ['settings-initial','approval-initial','settings-after-oauth','approval-after-oauth','settings-after-start','approval-after-start','secret-before-oauth','oauth-pending'])test('Ads bound consent expiry across '+boundary,{timeout:10000},async()=>{
 let now=1700000000000,settings=0,reads=0,paused=0;
 class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const scope={require,__dirname,module:{exports:{}},Buffer,URLSearchParams,Date:Clock,setTimeout,clearTimeout,structuredClone};
 vm.runInNewContext(support+'\nmodule.exports={fixture};',scope);
 const phase=boundary.endsWith('initial')?1:boundary.endsWith('after-oauth')?2:3;
 const expire=async approval=>{paused++;await new Promise(resolve=>setImmediate(resolve));now=new Date(approval.ads.consentValidUntil).getTime();};
 let f;
 f=scope.module.exports.fixture({
  onSettings:async approval=>{if(++settings===phase&&boundary.startsWith('settings-'))await expire(approval);},
  onGet:async(c,id,approval)=>{if(c==='BookingCancellationAnalytics'&&++reads===phase+1&&boundary.startsWith('approval-'))await expire(approval);},
  onSecret:async(k,approval)=>{if(boundary==='secret-before-oauth'&&k==='GOOGLE_SA_PRIVATE_KEY')await expire(approval);},
  transport:async url=>{if(boundary==='oauth-pending'&&url.includes('oauth2'))await expire(f.approval);}
 });
 const result=await f.call('ads');
 assert.equal(paused,1,'selected await reached');
 assert.equal(f.calls.filter(([url])=>url.includes('googleads')).length,0,'expired consent must prevent Ads POST');
 const oauth=f.calls.filter(([url])=>url.includes('oauth2')).length;
 assert.equal(oauth,boundary.endsWith('initial')||boundary==='secret-before-oauth'?0:1);
 assert.equal([...f.rows.values()].filter(row=>row.state==='ACKNOWLEDGED').length,0,'no fabricated ACK');
 if(boundary.endsWith('after-start')){
  assert.equal(result,'NEEDS_RECONCILIATION');assert.equal(f.rows.size,1);assert.equal([...f.rows.values()][0].state,'STARTED');
  const next=scope.module.exports.fixture({},f.rows);assert.equal(await next.call('ads'),'UNKNOWN');assert.equal(next.calls.length,0,'retained START forbids retry');
 }else assert.equal(f.rows.size,0,'expiry before START must not claim an attempt');
});
