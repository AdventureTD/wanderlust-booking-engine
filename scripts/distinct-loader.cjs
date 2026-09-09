'use strict';
// Backend-free pin/path validation. No backend evaluation in this module.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const pins=JSON.parse(fs.readFileSync(path.join(__dirname,'distinct-source-pins.json'),'utf8'));
const canonical=b=>b.toString('utf8').replace(/\r\n/g,'\n');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function selector(args, allowed) {
  assert.ok(args.length===1 && allowed.includes(args[0]),'exact selector required');
  return args[0];
}
function reader(table, read=fs.readFileSync) {
  return (file,encoding)=>{
    assert.equal(typeof file,'string');
    assert.ok(!file.includes('\0'));
    const absolute=path.resolve(file),relative=path.relative(ROOT,absolute).replace(/\\/g,'/');
    assert.ok(!relative.startsWith('../')&&!path.isAbsolute(relative),'path escape');
    assert.ok(Object.hasOwn(table,relative),'undeclared source '+relative);
    // Reject links escaping the frozen overlay, even when lexical path is admitted.
    if(read===fs.readFileSync) assert.equal(fs.realpathSync(absolute),absolute,'linked source denied');
    const text=canonical(read(absolute));
    assert.equal(sha(text),table[relative],'whole-file pin '+relative);
    assert.ok(encoding===undefined||encoding==='utf8');
    return encoding ? text : Buffer.from(text);
  };
}
function validate(kind, read) {
  const table=pins[kind],get=reader(table,read),edges={};
  for(const file of Object.keys(table)) {
    const text=get(path.join(ROOT,file),'utf8');
    const imports=[...text.matchAll(/^import .+ from '([^']+)';$/gm)].map(m=>m[1]);
    assert.equal((text.match(/^import /gm)||[]).length,imports.length,'unparsed import');
    edges[file]=imports;
    for(const name of imports) assert.ok(name.startsWith('backend/') ? Object.hasOwn(table,'velo/'+name+'.js') : ['buffer','crypto','wix-auth','wix-data','wix-secrets-backend.v2'].includes(name),name);
    // Compile the actual prefix loader's import/export transformation, never invoke it.
    const adapted=text.replace(/^import (.+) from '([^']+)';$/gm,(_,b,s)=>`const ${b}=imports[${JSON.stringify(s)}];`).replace(/export (async )?function (\w+)/g,(_,a,n)=>(a||'')+'function '+n);
    if(kind==='producer') vm.compileFunction(adapted,['imports']);
  }
  assert.deepEqual(edges,pins[kind+'Edges']);
  return get;
}
function prefix(kind) {
  const table=kind==='producer'?pins.prefix:pins.consumerPrefix;
  const file=Object.keys(table)[0];
  return reader(table)(path.join(ROOT,file),'utf8');
}
function restrictedRequire(read) {
  const allowed=new Set(['node:assert/strict','node:path','node:vm','node:crypto']);
  return name=>{if(name==='node:fs')return Object.freeze({readFileSync:read});assert.ok(allowed.has(name),'require denied '+name);return require(name);};
}
module.exports={ROOT,pins,canonical,sha,selector,reader,validate,prefix,restrictedRequire};
