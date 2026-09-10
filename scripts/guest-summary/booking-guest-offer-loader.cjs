'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const admission=JSON.parse(fs.readFileSync(path.join(__dirname,'booking-guest-offer-admission.json'),'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function resolve(spec,from){
 if(!Object.hasOwn(admission.graph,from)||typeof spec!=='string'||spec.includes('\\')||spec.split('/').includes('..')||spec.split('/').includes('.')||spec.includes(':'))throw Error('path denied');
 if(!Object.hasOwn(admission.graph[from].imports,spec))throw Error('edge denied');
 if(spec.startsWith('backend/')){const target='velo/'+spec+(spec.endsWith('.js')?'':'.js');if(!Object.hasOwn(admission.graph,target))throw Error('target denied');return target;}
 if(!['crypto','buffer','wix-data','wix-secrets-backend.v2','wix-auth'].includes(spec))throw Error('external denied');return spec;
}
function transform(id,source){
 const observed={};const exports=[];
 let code=source.replace(/^import (.*?) from ['"]([^'"]+)['"];\r?$/gm,(_,binding,spec)=>{observed[spec]=binding;resolve(spec,id);return `const ${binding.startsWith('{')?binding:binding} = __import(${JSON.stringify(spec)})${binding.startsWith('{')?'':'.default'};`;});
 assert.deepEqual(observed,admission.graph[id].imports);
 code=code.replace(/export (async )?function (\w+)/g,(_,a,n)=>{exports.push(n);return (a||'')+'function '+n;});
 if(/\bimport\s*(?:\(|['"{])|\bexport\s/.test(code))throw Error('unsupported module syntax');
 return code+'\nreturn {'+exports.join(',')+'};';
}
function preflight(){
 for(const [name,h] of Object.entries(admission.fixturePins))assert.equal(hash(fs.readFileSync(path.join(__dirname,name))),h);
 assert.equal(hash(fs.readFileSync(path.join(__dirname,'booking-guest-accepted-flow-source.json'))),admission.fixtureManifestSha256);
 const compiled=new Map();
 for(const [id,pin] of Object.entries(admission.graph)){
  const b=fs.readFileSync(path.join(root,id));assert.ok([pin.raw,pin.canonical].includes(hash(b)),'approved raw or exact Git LF bytes');assert.equal(hash(b.toString().replace(/\r\n/g,'\n')),pin.canonical);
  compiled.set(id,vm.compileFunction(transform(id,b.toString()),['__import','Date'],{filename:id}));
 }
 return compiled;
}
function load(f,clock){
 const compiled=preflight(),cache=new Map();
 function ClockDate(...args){return new Date(...args);}ClockDate.prototype=Date.prototype;ClockDate.now=()=>clock.now;ClockDate.parse=Date.parse;ClockDate.UTC=Date.UTC;
 const ext={'crypto':{default:crypto},'buffer':{Buffer},'wix-data':{default:f.wix},'wix-secrets-backend.v2':{secrets:f.secrets},'wix-auth':{elevate:fn=>(...args)=>fn(...args)}};
 function module(id){if(cache.has(id))return cache.get(id);if(!compiled.has(id))throw Error('module denied');const out=compiled.get(id)(spec=>{const target=resolve(spec,id);return Object.hasOwn(ext,target)?ext[target]:module(target);},ClockDate);cache.set(id,out);f.loaded.add(id);return out;}
 return {issue:input=>module('velo/backend/guestBookingOfferIssuer.js').issueGuestBookingOffer(input),accept:(token,capsule)=>module('velo/backend/guestBookingAcceptance.js').acceptGuestBookingOffer(token,capsule)};
}
module.exports={load,preflight,resolve,root};
if(require.main===module){assert.deepEqual(process.argv.slice(2),['L01']);const c=preflight();assert.equal(c.size,11);for(const s of ['backend/../backend/guestBookingCredentials','backend/guestBookingCredentials.js','fs','../outside','backend/guestBookingAcceptance'])assert.throws(()=>resolve(s,'velo/backend/guestBookingIssuerAuthority.js'));assert.equal(resolve('backend/guestBookingCredentials','velo/backend/guestBookingIssuerAuthority.js'),'velo/backend/guestBookingCredentials.js');console.log('PASS L01 exact graph compile/path controls; backend evaluation=0; COMPLETE 1');}
