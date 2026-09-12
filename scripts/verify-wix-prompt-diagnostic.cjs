const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'../diagnostics/wix-prompt');
function load(){
 const file=path.join(root,'promptDiagnosticCore.js');
 if(!fs.existsSync(file))return {};
 const source=fs.readFileSync(file,'utf8').replace(/export /g,'');
 const ctx=vm.createContext({});
 vm.runInContext(source+';globalThis.api={createDiagnostic};',ctx);
 return ctx.api;
}
test('bounded two-stage delivery with durable duplicate receipts and redaction',async()=>{
 const {createDiagnostic}=load();
 const rows=new Map(), writes=[],reads=[];
 const store={insert:async(c,row,options)=>{
  assert.equal(c,'WixPromptDiagnostics');
  assert.equal(options.suppressAuth,true);
  if(rows.has(row._id))throw Error('duplicate');
  rows.set(row._id,structuredClone(row));writes.push(structuredClone(row));return structuredClone(row);
 },get:async(c,id)=>{assert.equal(c,'WixPromptDiagnostics');reads.push(id);return structuredClone(rows.get(id));}};
 const api=createDiagnostic(store,{enabled:true,ownerId:'owner'});
 assert.equal((await api.start('owner')).status,'SEE_OBSERVATIONS');
 assert.equal(writes.length,2);
 const seeds=writes.slice();
 await api.start('owner');assert.equal(writes.length,2);
 await api.onCreated({entity:{_id:'unrelated'},metadata:{id:'secret'}});
 assert.equal(reads.length,0);
 for(const seed of seeds){
  const event={entity:{_id:seed._id,privateData:'guest@example.invalid'},metadata:{id:'inert-event',identity:{email:'owner@example.invalid'}}};
  await Promise.all([api.onCreated(event),api.onCreated(event)]);
 }
 const stages=writes.filter(r=>r.stage===2);
 assert.equal(stages.length,2);
 for(const row of stages)for(let i=0;i<3;i++)await api.onCreated({entity:{_id:row._id},metadata:{id:'inert-event'}});
 for(const row of writes.filter(r=>r.kind==='observation'))await api.onCreated({entity:{_id:row._id}});
 assert.equal(rows.size,8);
 const receipts=writes.filter(r=>r.kind==='observation');
 assert.equal(receipts.length,4);
 assert.ok(receipts.every(r=>typeof r.eventJson==='string'));
 assert.ok(!JSON.stringify(receipts).includes('@'));
 assert.ok(!JSON.stringify(receipts).includes('inert-event'));
 assert.equal(writes.filter(r=>r.kind==='probe'&&r.suppressed===true).length,2);
});
test('web entry is Admin AND server-bound owner, no caller arguments',async()=>{
 const f=path.join(root,'promptDiagnostic.web.js');
 assert.ok(fs.existsSync(f),'missing owner-only web entry');
 let start=0,member=0,permission;
 const ctx=vm.createContext({Permissions:{Admin:'ADMIN'},webMethod:(p,fn)=>{permission=p;return fn;},
  currentMember:{getMember:async()=>{member++;return {_id:'owner'};}},
  diagnostic:{start:async id=>{assert.equal(id,'owner');start++;return {status:'fixture'};}}});
 const source=fs.readFileSync(f,'utf8').replace(/^import .*;\r?$/gm,'').replace(/export /g,'');
 vm.runInContext(source+';globalThis.run=startPromptDiagnostic;',ctx);
 assert.equal(permission,'ADMIN');
 assert.equal((await ctx.run('injected')).status,'DENIED');assert.equal(member,0);
 assert.equal((await ctx.run()).status,'fixture');assert.equal(start,1);
});
test('faults and metadata bounds never authorize a successor',async()=>{
 const {createDiagnostic}=load();
 for(const fault of ['wrong-row','get-throws','receipt-ack-lost']){
  const rows=new Map();let seed,successors=0;
  const store={insert:async(c,row)=>{
   if(rows.has(row._id))throw Error('duplicate');
   rows.set(row._id,structuredClone(row));
   if(row.kind==='probe'&&row.stage===1)seed=row;
   if(row.stage===2)successors++;
   if(row.kind==='observation'&&fault==='receipt-ack-lost')throw Error('applied');
   return row;
  },get:async(c,id)=>{if(fault==='get-throws')throw Error('offline');return fault==='wrong-row'?{...rows.get(id),tag:'wrong'}:rows.get(id);}};
  const api=createDiagnostic(store,{enabled:true,ownerId:'owner'});
  await api.start('owner');
  for(let i=0;i<3;i++)await api.onCreated({entity:{_id:seed._id},metadata:{id:'fake'}});
  assert.equal(successors,0,fault);
 }
 const rows=new Map();
 const store={insert:async(c,r)=>{if(rows.has(r._id))throw Error('duplicate');rows.set(r._id,r);return r;},get:async(c,id)=>rows.get(id)};
 const api=createDiagnostic(store,{enabled:true,ownerId:'owner'});await api.start('owner');
 const fixture=JSON.parse(fs.readFileSync(path.join(root,'event.fixture.json')));
 await api.onCreated(fixture.event);
 const receipt=rows.get(fixture.event.entity._id+'-seen');
 assert.deepEqual(JSON.parse(receipt.eventJson),fixture.expectedSanitizedEvent);
 const seed=[...rows.values()].find(r=>r.stage===1&&r._id!==fixture.event.entity._id);
 const cycle={};cycle.secret=cycle;
 await api.onCreated({entity:{_id:seed._id},metadata:cycle});
 assert.ok(rows.get(seed._id+'-seen').eventJson.length<10000);
});
test('page triggers only an explicit click, no startup write',async()=>{
 const f=path.join(root,'page-prompt-diagnostic.js');assert.ok(fs.existsSync(f),'missing explicit-click frontend');
 let ready,click,calls=0;
 const button={onClick:fn=>{click=fn;},disable(){},enable(){}};
 const text={text:''};
 const $w=id=>id==='#runPromptDiagnostic'?button:text;$w.onReady=fn=>{ready=fn;};
 const ctx=vm.createContext({$w,startPromptDiagnostic:async()=>{calls++;return {status:'SEE_OBSERVATIONS'};}});
 vm.runInContext(fs.readFileSync(f,'utf8').replace(/^import .*;\r?$/gm,''),ctx);
 ready();assert.equal(calls,0);await click();assert.equal(calls,1);assert.equal(text.text,'SEE_OBSERVATIONS');
});
test('OFF and non-owner denied without datastore activity',async()=>{
 const {createDiagnostic}=load();
 assert.equal(typeof createDiagnostic,'function','missing diagnostic behavior');
 let io=0;
 const store={insert:async()=>{io++;},get:async()=>{io++;}};
 const off=createDiagnostic(store,{enabled:false,ownerId:'owner'});
 assert.equal((await off.start('owner')).status,'DENIED');
 const on=createDiagnostic(store,{enabled:true,ownerId:'owner'});
 assert.equal((await on.start('collaborator')).status,'DENIED');
 assert.equal((await on.start('')).status,'DENIED');
 assert.equal(io,0);
});
