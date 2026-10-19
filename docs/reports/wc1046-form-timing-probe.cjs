const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const text=fs.readFileSync(root+'/tests/ads-custom-form.cjs','utf8').split('(async()=>{')[0];
const sandbox={require:require('node:module').createRequire(root+'/tests/ads-custom-form.cjs'),__dirname:root+'/tests',console,setTimeout,clearTimeout,URL};
vm.runInNewContext(text+'\nthis.fixture=fixture;',sandbox);
(async()=>{
 const result=[];
 for(const delay of [0,1700]){
  const x=await sandbox.fixture({automatic:true,policyRows:[],policyRead:async()=>{if(delay)await new Promise(r=>setTimeout(r,delay));}});
  await x.submit();await new Promise(r=>setTimeout(r,2000));await x.settle();
  const row={simulatedPolicyDelayMs:delay,formEvents:x.events().filter(e=>e[1]==='form_submit').length,backendConversionInvocations:x.p.ads.length,invoiceInvocations:x.p.invoices.length};
  assert.equal(row.backendConversionInvocations,1);assert.equal(row.invoiceInvocations,1);assert.equal(row.formEvents,delay?0:1);result.push(row);
 }
 console.log(JSON.stringify({mode:'offline actual-source harness; simulated CMS latency; no network or actual booking',result},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
