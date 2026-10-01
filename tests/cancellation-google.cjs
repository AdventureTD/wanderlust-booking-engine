// Actual cancellation source; only SDK/secrets/provider edges are inert.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const fetch=require('node-fetch');
const source=fs.readFileSync(path.join(__dirname,'../velo/backend/cancellationEffects.js'),'utf8');
const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
function fixture(options={},rows=new Map()){
 const op={_id:'s',bookingNumber:'WC-900001'},calls=[];
 const approval={_id:'s',bookingNumber:op.bookingNumber,ads:{approved:true,originalRecorded:true,consentEligible:true,withdrawn:false,consentValidUntil:new Date(Date.now()+60000).toISOString(),orderId:op.bookingNumber,customerId:'123',conversionActionId:'456'},ga4:{approved:true,clientId:'original.client',transactionId:op.bookingNumber,value:200,currency:'USD',measurementId:'G-INERT',duplicateCheckClear:true,consentEligible:true,consentValidUntil:new Date(Date.now()+60000).toISOString(),withdrawn:false}};
 const secrets={WBE_GOOGLE_ADS_ADJUSTMENTS_ENABLED:'true',GOOGLE_ADS_CUSTOMER_ID:'123',GOOGLE_ADS_CONVERSION_ACTION_ID:'456',GOOGLE_ADS_LOGIN_CUSTOMER_ID:'',GOOGLE_ADS_DEVELOPER_TOKEN:'A'.repeat(22),GOOGLE_SA_CLIENT_EMAIL:'inert@example.invalid',GOOGLE_SA_PRIVATE_KEY:key,WBE_GA4_MEASUREMENT_ID:'G-INERT',WBE_GA4_API_SECRET:'inert'};
 const response=body=>({ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)});
 const sdk={get:async(c,id)=>c==='BookingCancellationAnalytics'?structuredClone(approval):structuredClone(rows.get(id)||null),query(){return {eq(){return this;},limit(){return this;},find:async()=>({items:[{value:'0'}]})};},insert:async(c,row)=>{if(rows.has(row._id))throw Error('DUPLICATE');rows.set(row._id,structuredClone(row));if(options.onInsert)await options.onInsert(row,approval);return row;}};
 const provider=async(url,args)=>{calls.push([url,args]);if(options.transport){const r=await options.transport(url,args);if(r)return r;}if(url.includes('oauth2'))return response({access_token:'inert-token'});if(url.includes('googleads')){const sent=JSON.parse(args.body).conversionAdjustments[0];return response({results:[sent]});}if(url.includes('/debug/'))return response({validationMessages:[]});return {ok:true,status:204};};
 const ctx=vm.createContext({crypto,Buffer,URLSearchParams,Date,setTimeout:options.timer||setTimeout,clearTimeout,wixData:sdk,getSecret:async k=>secrets[k],fetch:provider});
 vm.runInContext(source.replace(/^import .*;$/gm,'').replace(/export /g,'')+'\nglobalThis.ads=adsCancellation;globalThis.ga4=ga4Cancellation;',ctx);
 return {call:kind=>ctx[kind]({operation:op}),approval,secrets,calls,rows,op};
}
for(const edge of ['oauth','ads','debug','collect'])for(const code of [301,302,303,307,308])test(`${edge} rejects real node-fetch redirect ${code} without successor`,async()=>{
 const targets=[];const server=http.createServer((req,res)=>{if(req.url==='/target'){targets.push(req.headers);res.end('{}');}else {res.writeHead(code,{Location:'/target'});res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {
 // Use actual request options, including credentials, at the inert transport boundary.
 const g=fixture({transport:(url,args)=>{const selected=edge==='oauth'?url.includes('oauth2'):edge==='ads'?url.includes('googleads'):edge==='debug'?url.includes('/debug/'):url.includes('/mp/collect')&&!url.includes('/debug/');return selected?fetch(`http://127.0.0.1:${server.address().port}/initial`,args):null;}});await g.call(['oauth','ads'].includes(edge)?'ads':'ga4');assert.equal(targets.length,0);assert.ok(g.calls.every(c=>c[1].redirect==='error'));
 }finally{await new Promise(r=>server.close(r));}
});
test('oversized Google response is rejected before parsing or downstream dispatch',async()=>{
 for(const kind of ['ads','ga4']){
 const f=fixture({transport:async()=>({ok:true,status:200,text:async()=> ' '.repeat(65537),json:async()=>kind==='ads'?{access_token:'inert-token'}:{validationMessages:[]}})});
 const result=await f.call(kind);assert.equal(f.calls.length,1);assert.equal(result,'UNSENT_CONFIGURATION');
 }
});
test('wrong original transaction never dispatches a Google correction',async()=>{
 for(const kind of ['ads','ga4']){const f=fixture();f.approval[kind][kind==='ads'?'orderId':'transactionId']='OTHER';assert.equal(await f.call(kind),'NEEDS_RECONCILIATION');assert.equal(f.calls.length,0);}
});
test('Ads partial failure field cannot be falsy to manufacture ACK',async()=>{
 const f=fixture({transport:async(url,args)=>url.includes('googleads')?{ok:true,status:200,text:async()=>JSON.stringify({partialFailureError:false,results:[JSON.parse(args.body).conversionAdjustments[0]]})}:null});
 assert.equal(await f.call('ads'),'UNKNOWN');
});
test('Ads explicit withdrawal denies correction despite manual approval',async()=>{
 const f=fixture();f.approval.ads.withdrawn=true;
 assert.equal(await f.call('ads'),'UNSENT_SUSPENDED_OR_APPROVAL_CHANGED');assert.equal(f.calls.length,0);
});
test('Ads receipt binds the submitted adjustment time as well as transaction and goal',async()=>{
 const f=fixture({transport:async(url,args)=>url.includes('googleads')?{ok:true,status:200,text:async()=>JSON.stringify({results:[{...JSON.parse(args.body).conversionAdjustments[0],adjustmentDateTime:'2020-01-01 00:00:00+00:00'}]})}:null});assert.equal(await f.call('ads'),'UNKNOWN');
});
for(const kind of ['ads','ga4'])test(`${kind} concurrent corrections and reconstructed retry never duplicate`,async()=>{
 const f=fixture();const results=await Promise.all([f.call(kind),f.call(kind)]);
 const sends=f.calls.filter(([url])=>kind==='ads'?url.includes('googleads'):url.includes('/mp/collect')&&!url.includes('/debug/'));
 assert.equal(sends.length,1);assert.ok(results.includes(kind==='ads'?'ACKNOWLEDGED':'RECEIVED_UNVERIFIED'));
 const again=fixture({},f.rows);await again.call(kind);assert.equal(again.calls.length,0);
});
for(const kind of ['ads','ga4'])test(`${kind} applied then transport throws keeps START and never retries`,async()=>{
 const f=fixture({transport:async url=>{if(kind==='ads'?url.includes('googleads'):url.includes('/mp/collect')&&!url.includes('/debug/'))throw Error('APPLIED_ACK_LOST');}});
 assert.equal(await f.call(kind),'UNKNOWN');const again=fixture({},f.rows);assert.equal(await again.call(kind),'UNKNOWN');assert.equal(again.calls.length,0);
});
for(const kind of ['ads','ga4'])test(`${kind} missing metadata means reconciliation, never NOT_NEEDED`,async()=>{const f=fixture();delete f.approval[kind];assert.equal(await f.call(kind),'NEEDS_RECONCILIATION');assert.equal(f.calls.length,0);});
for(const kind of ['ads','ga4'])test(`${kind} bounded response wait cannot resume after late body`,async()=>{
 let release;const f=fixture({timer:(fn,ms)=>{assert.equal(ms,8000);return setTimeout(fn,5);},transport:async()=>({ok:true,text:()=>new Promise(r=>{release=r;})})});
 assert.equal(await f.call(kind),'UNSENT_CONFIGURATION');assert.equal(f.calls.length,1);release(JSON.stringify(kind==='ads'?{access_token:'late'}:{validationMessages:[]}));await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);
});
for(const kind of ['ads','ga4'])test(`${kind} lost native ACK never causes another provider call`,async()=>{
 const f=fixture({onInsert:async row=>{if(['ACKNOWLEDGED','RECEIVED_UNVERIFIED'].includes(row.state))throw Error('NATIVE_ACK_LOST');}});
 assert.equal(await f.call(kind),'UNKNOWN');const again=fixture({},f.rows);assert.equal(await again.call(kind),kind==='ads'?'ACKNOWLEDGED':'RECEIVED_UNVERIFIED');assert.equal(again.calls.length,0);
});
for(const value of [undefined,true,'false'])test(`Ads consent withdrawal field ${String(value)} fails closed`,async()=>{const f=fixture();f.approval.ads.withdrawn=value;assert.equal(await f.call('ads'),'UNSENT_SUSPENDED_OR_APPROVAL_CHANGED');assert.equal(f.calls.length,0);});
module.exports={fixture};
