'use strict';
// Full existing Summary source and real wired Continue callback; inert edges only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const support=fs.readFileSync(path.join(__dirname,'attribution-hotfix.cjs'),'utf8');
const box={require,__dirname,console};
vm.runInNewContext(support.slice(0,support.indexOf('function bookingBackend'))+'\nthis.makePage=page;',box);
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function fixture(options={}) {
 let now=17000,id=0,resolve,reject,rpcs=0,ms=0,clears=0;const timers=new Map(),redirects=[],logs=[],errors=[];
 const rpc=new Promise((a,b)=>{resolve=a;reject=b;});
 const p=await box.makePage({invoice:()=>new Promise(()=>{}),...options});
 p.c.Date=class extends Date {static now(){return now;}};
 p.c.setTimeout=(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;};p.c.clearTimeout=id=>timers.delete(id);
 p.c.console={log:(...v)=>logs.push(v),warn:(...v)=>logs.push(v),error:(...v)=>errors.push(v)};
 p.c.wixLocation={to:url=>redirects.push({at:now,url})};
 p.c.recordBookingConversion=()=>{rpcs++;if(options.syncThrow)throw Error('INERT_SECRET');return rpc;};
 p.c.recordMicrosoftBookingConversion=()=>{ms++;return new Promise(()=>{});};
 p.c.clearClickIds=()=>{clears++;};
 if(options.skip)p.c.getStoredClickIds=()=>null;
 if(options.microsoft)p.c.getStoredClickIds=()=>({msclkid:'INERT_MS'});
 if(options.trackThrow)p.c.trackPurchase=()=>{throw Error('INERT_TRACK');};
 if(options.revoke){const track=p.c.trackPurchase;p.c.trackPurchase=v=>{track(v);p.c.getStoredClickIds=()=>null;};}
 const start=now;
 async function advance(elapsed){const end=start+elapsed;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();}
 return {p,resolve,reject,advance,redirects,logs,errors,timers,start,jump:elapsed=>{now=start+elapsed;},get rpcs(){return rpcs;},get ms(){return ms;},get clears(){return clears;}};
}
const diagnostics=f=>f.logs.filter(v=>v[0]&&v[0].event==='GOOGLE_ADS_BROWSER_HANDOFF').map(v=>JSON.parse(JSON.stringify(v[0])));
for(const outcome of ['NOT_ATTEMPTED','UNKNOWN','INGESTION_ACKNOWLEDGED','EXPLICIT_REJECTION','UNTRUSTED_SECRET'])
for(const at of [0,1999,2000,3000,4999,5000,7000])test('actual Summary settle '+outcome+' at '+at,async()=>{
 const f=await fixture({microsoft:true});await f.p.click();await f.p.click();
 assert.equal(f.p.invoices.length,1);assert.equal(f.p.purchases.length,1);assert.equal(f.rpcs,1);assert.equal(f.ms,1);
 await f.advance(at);f.resolve({ok:outcome==='INGESTION_ACKNOWLEDGED',outcome,secret:'INERT_SECRET'});await flush();
 await f.advance(9000);assert.deepEqual(f.redirects.map(r=>r.at),[f.start+Math.max(2000,Math.min(5000,at))]);assert.equal(f.timers.size,0);
 const d=diagnostics(f);assert.equal(d.length,1);assert.deepEqual(Object.keys(d[0]),['event','schemaVersion','outcome','reasonCode']);assert.ok(!JSON.stringify(d).includes('SECRET'));
 assert.equal(d[0].outcome,at>=5000||outcome==='UNTRUSTED_SECRET'?'UNKNOWN':outcome);assert.equal(d[0].reasonCode,at>=5000?'WAIT_CAP_EXPIRED':'RPC_SETTLED');
 assert.equal(f.clears,outcome==='INGESTION_ACKNOWLEDGED'?1:0);
});
for(const at of [0,1999,3000,5000,7000])test('actual Summary rejected RPC at '+at,async()=>{
 const f=await fixture();await f.p.click();await f.advance(at);f.reject(Error('INERT_SECRET'));await flush();await f.advance(9000);
 assert.deepEqual(f.redirects.map(r=>r.at),[f.start+Math.max(2000,Math.min(5000,at))]);assert.equal(f.rpcs,1);assert.equal(f.timers.size,0);
 assert.equal(diagnostics(f).length,1);assert.equal(diagnostics(f)[0].outcome,'UNKNOWN');assert.equal(diagnostics(f)[0].reasonCode,at>=5000?'WAIT_CAP_EXPIRED':'RPC_REJECTED');
});
for(const mode of ['skip','revoke','trackThrow','syncThrow','noFinancial'])test('actual Summary safe no-wait '+mode,async()=>{
 const f=await fixture(mode==='noFinancial'?{setup:'_financialSnapshot=null;',noRender:true}:{[mode]:true});await f.p.click();
 assert.match(f.p.w('#bookingStatus').text,/Booking confirmed!/);assert.equal(f.p.invoices.length,1);assert.equal(f.rpcs,mode==='syncThrow'?1:0);
 await f.advance(1999);assert.equal(f.redirects.length,0);await f.advance(2000);assert.equal(f.redirects.length,1);await f.advance(9000);assert.equal(f.redirects.length,1);
 if(mode==='syncThrow'||mode==='trackThrow')assert.ok(f.errors.some(v=>v[0]==='[WBE-FRONTEND] Analytics failed after confirmation:'),'retain prior analytics logging');
 assert.equal(diagnostics(f).length,mode==='syncThrow'?1:0);
});
test('actual Summary partial cart does not invoke purchase RPC invoice or redirect',async()=>{
 const f=await fixture({book:async(p,n)=>n===2?{outcome:'UNKNOWN'}:undefined});await f.p.click();await f.advance(9000);
 assert.equal(f.rpcs,0);assert.equal(f.p.purchases.length,0);assert.equal(f.p.invoices.length,0);assert.equal(f.redirects.length,0);
});
test('actual Summary timer cap is absolute when minimum callback is delayed',async()=>{
 const f=await fixture();await f.p.click();const [id,t]=[...f.timers][0];f.timers.delete(id);f.jump(4000);t.fn();await flush();
 assert.equal([...f.timers.values()][0].at,f.start+5000);await f.advance(5000);assert.equal(f.redirects[0].at,f.start+5000);
});
test('actual Summary cap wins settlement before overdue timer callback',async()=>{
 const f=await fixture();await f.p.click();await f.advance(2000);f.jump(5000);f.resolve({ok:false,outcome:'NOT_ATTEMPTED'});await flush();
 assert.equal(f.redirects[0].at,f.start+5000);assert.equal(diagnostics(f)[0].reasonCode,'WAIT_CAP_EXPIRED');assert.equal(f.timers.size,0);
});
test('actual Summary budget starts at original post-invoice timer boundary',async()=>{
 let f;f=await fixture({invoice:()=>{f.jump(600);return new Promise(()=>{});}});await f.p.click();
 assert.equal([...f.timers.values()][0].at,f.start+2600);await f.advance(5599);assert.equal(f.redirects.length,0);await f.advance(5600);assert.equal(f.redirects[0].at,f.start+5600);
});
test('actual Summary finite diagnostic logger throw cannot block redirect',async()=>{
 const f=await fixture();const log=f.p.c.console.log;f.p.c.console.log=(...v)=>{if(v[0]&&v[0].event)throw Error('INERT_LOG');log(...v);};
 await f.p.click();await f.advance(5000);assert.equal(f.redirects.length,1);assert.equal(f.timers.size,0);
});
for(const mode of ['slow','never'])test('actual Summary bounded handoff causal '+mode,async()=>{
 const f=await fixture();await f.p.click();assert.match(f.p.w('#bookingStatus').text,/Booking confirmed!/);assert.equal(f.p.invoices.length,1);assert.equal(f.rpcs,1);assert.equal(f.p.purchases.length,1);
 await f.advance(2000);assert.equal(f.redirects.length,0,'pending Google must not redirect unconditionally at 2s');
 if(mode==='slow'){await f.advance(3000);f.resolve({ok:false,outcome:'UNKNOWN'});await flush();assert.equal(f.redirects[0].at,f.start+3000);}else{await f.advance(4999);assert.equal(f.redirects.length,0);await f.advance(5000);assert.equal(f.redirects[0].at,f.start+5000);}
 await f.advance(9000);assert.equal(f.redirects.length,1);assert.equal(f.timers.size,0);assert.equal(f.rpcs,1);
});
