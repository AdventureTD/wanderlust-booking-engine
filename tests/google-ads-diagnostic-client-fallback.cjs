'use strict';
const {fixture,evalSource}=require('./google-ads-private-journal.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
for(const mode of ['throw','unavailable'])test('client diagnostic helper '+mode+' preserves HTTP error and journal RESULT',async()=>{
  const f=fixture(); let sends=0;
  const client=evalSource('backend/dataManagerClient.web.js',{
    sanitizeHttpErrorDiagnostics:mode==='unavailable'?undefined:()=>{throw Error('PRIVATE ECHO');},
    fetch:async()=>{sends++;return {ok:false,status:400,text:async()=>'{"error":{"status":"INVALID_ARGUMENT"}}'};}
  },['ingestEvent']);
  client.getAccessToken=async()=> 'INERT';
  await assert.rejects(client.ingestEvent({}),e=>{assert.equal(e.code,'HTTP_ERROR');assert.equal(e.outcome,'unknown');assert.equal(e.httpStatus,400);assert.ok(!JSON.stringify(e).includes('PRIVATE ECHO'));return true;});
  const journal=evalSource('backend/googleAdsAttemptJournal.js',{...f.globals,ingestEvent:client.ingestEvent},['recordPrivateGoogleAdsAttempt']);
  const token=await f.mint(),booking=f.booking({conversionCapability:token});
  const build=async()=>({destinations:[{operatingAccount:{accountId:'1234567890'},productDestinationId:'123456'}]});
  const result=await journal.recordPrivateGoogleAdsAttempt(booking,build);
  assert.equal(result.reasonCode,'HTTP_ERROR');assert.equal(result.outcome,'UNKNOWN');
  const row=[...f.rows.values()].find(r=>r.kind==='RESULT');
  assert.equal(row.reasonCode,'HTTP_ERROR');assert.equal(row.statusCode,400);
  await journal.recordPrivateGoogleAdsAttempt(booking,build);assert.equal(sends,2,'one isolated client call plus one journal dispatch; no replay');
});
