const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(process.env.PROBE_SOURCE||path.join(__dirname,'../../backend/redirectProbe.js'),'utf8');
const marker={args:{marker:'wbe-redirect-readiness-v1'},url:'https://httpbin.org/get?marker=wbe-redirect-readiness-v1'};
function load(fetch){
 const live=new Set(),delays=[];
 const box={fetch,setTimeout(fn,ms){delays.push(ms);const t=setTimeout(()=>{live.delete(t);fn();},5);live.add(t);return t;},clearTimeout(t){live.delete(t);clearTimeout(t);}};
 vm.createContext(box);vm.runInContext(source.replace("import { fetch } from 'wix-fetch';",'').replace('export async function','async function')+';this.run=redirectProbe;',box);
 return {run:box.run,live,delays};
}
async function bounded(run){let t;try{return await Promise.race([run(),new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('diagnostic remained pending: missing deadline')),150);})]);}finally{clearTimeout(t);}}
for(const boundary of ['fetch','body'])test(boundary+' deadline settles and handles late rejection',async()=>{
 let reject,calls=0;const pending=new Promise((_,r)=>reject=r);
 const h=load(async()=>{calls++;return boundary==='fetch'?pending:{status:200,json:()=>pending};});
 try {const result=await bounded(h.run);assert.equal(result.state,'INCONCLUSIVE_CONTROL');assert.equal(calls,1);assert.ok(h.delays.length>0);assert.ok(h.delays.every(n=>Number.isFinite(n)&&n>0&&n<=2000));assert.equal(h.live.size,0);}
 finally {reject(Error('late inert failure'));await new Promise(r=>setTimeout(r,10));}
});
test('successful operations clear every watchdog',async()=>{
 let calls=0;const h=load(async()=>{calls++;return {status:200,json:async()=>marker};});
 await bounded(h.run);assert.ok(h.delays.length>0,'explicit watchdogs absent');assert.equal(h.live.size,0);assert.ok(calls<=10);
});
module.exports={load,bounded,marker};
