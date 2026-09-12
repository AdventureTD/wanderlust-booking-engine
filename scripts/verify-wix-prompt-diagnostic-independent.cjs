const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../diagnostics/wix-prompt');
const source=name=>fs.readFileSync(path.join(root,name),'utf8').replace(/^import .*;\r?$/gm,'').replace(/export /g,'');
function core(){const ctx=vm.createContext({});vm.runInContext(source('promptDiagnosticCore.js')+';globalThis.create=createDiagnostic;',ctx);return ctx.create;}
function wrapper(diagnostic,getMember){let permission;const ctx=vm.createContext({diagnostic,currentMember:{getMember},Permissions:{Admin:'ADMIN'},webMethod:(p,fn)=>{permission=p;return fn;}});vm.runInContext(source('promptDiagnostic.web.js')+';globalThis.run=startPromptDiagnostic;',ctx);assert.equal(permission,'ADMIN');return ctx.run;}
test('actual OFF adapter denies wrapper and event IO; missing owner fails closed',async()=>{
 let io=0;const wixData={insert:async()=>{io++;},get:async()=>{io++;}};
 const ctx=vm.createContext({wixData,createDiagnostic:core()});vm.runInContext(source('promptDiagnostic.js')+';globalThis.api=diagnostic;',ctx);
 const run=wrapper(ctx.api,async()=>({_id:'synthetic-owner'}));assert.equal((await run()).status,'DENIED');
 await ctx.api.onCreated({entity:{_id:'wixprompt-6da182ac-792f-42c8-bb7e-4ca4bb0dd690-c1'}});
 const blank=core()(wixData,{enabled:true,ownerId:''});assert.equal((await blank.start('')).status,'DENIED');await blank.onCreated({entity:{_id:'wixprompt-6da182ac-792f-42c8-bb7e-4ca4bb0dd690-c1'}});assert.equal(io,0);
});
test('actual wrapper plus enabled core denies collaborators, missing identity and member failure before IO',async()=>{
 let io=0;const api=core()({insert:async()=>{io++;},get:async()=>{io++;}},{enabled:true,ownerId:'synthetic-owner'});
 for(const get of [async()=>({_id:'synthetic-collaborator'}),async()=>undefined,async()=>{throw Error('identity unavailable');}]){const run=wrapper(api,get);assert.equal((await run()).status,'DENIED');assert.equal((await run('synthetic-owner')).status,'DENIED');}assert.equal(io,0);
});
test('fresh-module replay remains eight immutable IDs; bounded attempts and suppression per branch',async()=>{
 const rows=new Map(),calls=[];const store={insert:async(c,r,o)=>{calls.push(['insert',c,r._id,o.suppressHooks]);assert.equal(c,'WixPromptDiagnostics');assert.equal(o.suppressAuth,true);assert.equal(o.suppressHooks,r.kind==='probe'?r.suppressed:true);if(rows.has(r._id))throw Error('duplicate');rows.set(r._id,structuredClone(r));return r;},get:async(c,id)=>{calls.push(['get',c,id]);assert.equal(c,'WixPromptDiagnostics');return rows.get(id);}};
 const fresh=()=>core()(store,{enabled:true,ownerId:'synthetic-owner'});
 await fresh().start('synthetic-owner');
 for(const stage of [1,2])for(const row of [...rows.values()].filter(r=>r.stage===stage))await fresh().onCreated({entity:{_id:row._id}});
 assert.equal(rows.size,8);const before=JSON.stringify([...rows]);
 for(let n=0;n<20;n++){
  let count=calls.length;await fresh().start('synthetic-owner');assert.equal(calls.length-count,2);
  for(const row of [...rows.values()]){count=calls.length;await fresh().onCreated({entity:{_id:row._id}});assert.equal(calls.length-count,row.kind==='probe'?2:0);}
 }
 assert.equal(JSON.stringify([...rows]),before);assert.equal(new Set(calls.filter(c=>c[0]==='insert').map(c=>c[2])).size,8);
 assert.ok([...rows.values()].every(r=>r.stage===undefined||r.stage<=2));
});
