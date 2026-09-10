'use strict';
// Same-realm compiler for an exact reviewed source graph; not a security sandbox.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function compileSource(id,source,pin,graph) {
  const observed=[],names=[];
  let code=source.replace(/^import\s+(.+?)\s+from\s+['"]([^'"]+)['"];?\r?$/gm,(_,binding,spec)=>{
    const edge=pin.imports[observed.length];
    assert.ok(edge && edge.binding===binding && edge.specifier===spec,'exact ordered edge denied: '+id+' '+spec);
    if(edge.target) {
      assert.ok(!edge.target.includes('..')&&!edge.target.includes('\\')&&edge.target.startsWith('velo/backend/'),'path escape');
      assert.ok(Object.hasOwn(graph,edge.target),'target outside graph');
      assert.equal(spec.startsWith('backend/')?'velo/'+spec+'.js':path.posix.normalize(path.posix.join(path.posix.dirname(id),spec.endsWith('.js')?spec:spec+'.js')),edge.target,'target mismatch');
    } else assert.ok(['crypto','buffer','wix-data','wix-auth','wix-secrets-backend.v2','wix-web-module'].includes(spec),'external denied');
    observed.push({binding,specifier:spec,target:edge.target});
    return `const ${binding}=__import(${JSON.stringify(spec)})${binding.startsWith('{')?'':'.default'};`;
  });
  assert.deepEqual(observed,pin.imports,'all edges accounted');
  code=code.replace(/\bexport\s+(async\s+)?function\s+(\w+)/g,(_,a,n)=>{names.push(n);return (a||'')+'function '+n;});
  code=code.replace(/\bexport\s+const\s+(\w+)\s*=/g,(_,n)=>{names.push(n);return 'const '+n+'=';});
  // Inspect executable text, not full-line comments in this pinned graph.
  const executable=code.replace(/^\s*\/\/[^\r\n]*$/gm,'');
  assert.ok(!/\bimport\s*(?:\(|['"{*])|\bexport\s|\brequire\s*\(/.test(executable),'unsupported import/export/require');
  assert.equal(new Set(names).size,names.length,'duplicate export');
  return vm.compileFunction(code+'\nreturn {'+names.join(',')+'};',['__import','Date'],{filename:id});
}
function compileGraph(admission=JSON.parse(fs.readFileSync(path.join(__dirname,'admission.json')))) {
  const compiled=new Map();
  for(const [id,pin] of Object.entries(admission.graph)) {
    assert.ok(id.startsWith('velo/backend/')&&!id.includes('..')&&!id.includes('\\'),'module path denied');
    const bytes=fs.readFileSync(path.join(root,id));
    // Admit only CRLF-to-LF equivalence; raw_sha256 retains reviewed checkout custody.
    const canonical=Buffer.from(bytes.toString('latin1').replace(/\r\n/g,'\n'),'latin1');
    assert.equal(digest(canonical),pin.canonical_lf_sha256,'source bytes changed: '+id);
    compiled.set(id,compileSource(id,bytes.toString('utf8'),pin,admission.graph));
  }
  return {compiled,admission}; // Compilation is not invocation.
}
function createLoader(f,clock,admission) {
  const state=compileGraph(admission),cache=new Map(),evaluating=new Set();
  function ClockDate(...args){return args.length?new Date(...args):new Date(clock.now);}ClockDate.prototype=Date.prototype;ClockDate.now=()=>clock.now;ClockDate.UTC=Date.UTC;ClockDate.parse=Date.parse;
  const ext={crypto:{default:crypto,createHash:crypto.createHash},buffer:{Buffer},'wix-data':{default:f.wix},'wix-auth':{elevate:fn=>fn},'wix-secrets-backend.v2':{secrets:f.secrets},'wix-web-module':{Permissions:{Anyone:'Anyone'},webMethod(permission,fn){assert.equal(permission,'Anyone');return fn;}}};
  function load(id){
    assert.equal(state.admission.businessAdmitted,true,'business source/fixture admission pending');
    if(cache.has(id))return cache.get(id);assert.ok(state.compiled.has(id),'module denied');assert.ok(!evaluating.has(id),'cycle denied');evaluating.add(id);
    const pin=state.admission.graph[id];
    try {const result=state.compiled.get(id)(spec=>{const edge=pin.imports.find(e=>e.specifier===spec);assert.ok(edge,'edge denied');return edge.target?load(edge.target):ext[spec];},ClockDate);cache.set(id,result);f.loaded.add(id);return result;}finally{evaluating.delete(id);}
  }
  return {load,cache,compiledCount:state.compiled.size};
}
module.exports={compileGraph,compileSource,createLoader};
