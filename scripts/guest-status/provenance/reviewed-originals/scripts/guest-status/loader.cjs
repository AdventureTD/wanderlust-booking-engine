'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),admission=JSON.parse(fs.readFileSync(path.join(__dirname,'admission.json')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(name){assert.ok(Object.hasOwn(admission.fixtures,name));const b=fs.readFileSync(path.join(root,'scripts/fixtures',name));assert.equal(hash(b),admission.fixtures[name]);return JSON.parse(b);}
function preflight(){
 const graph={...admission.graph,[admission.candidate.id]:admission.candidate},compiled=new Map();
 for(const [id,pin] of Object.entries(graph)){
  const b=fs.readFileSync(path.join(root,id));
  if(pin.canonical){assert.ok([pin.raw,pin.canonical].includes(hash(b)),id);assert.equal(hash(b.toString().replace(/\r\n/g,'\n')),pin.canonical,id);}
  const imports={},exports=[];
  let code=b.toString().replace(/^import (.+) from '([^']+)';\r?$/gm,(_,binding,spec)=>{
   imports[spec]=binding;assert.ok(Object.hasOwn(pin.imports,spec),'edge denied');
   if(spec.startsWith('backend/'))assert.ok(Object.hasOwn(graph,'velo/'+spec+'.js'),'closed target');
   else assert.ok(['crypto','buffer','wix-data','wix-auth','wix-secrets-backend.v2'].includes(spec),'external denied');
   return `const ${binding}=__import(${JSON.stringify(spec)})${binding.startsWith('{')?'':'.default'};`;
  });
  assert.deepEqual(imports,pin.imports,id);
  code=code.replace(/export (async )?function (\w+)/g,(_,a,n)=>{exports.push(n);return (a||'')+'function '+n;});
  assert.ok(!/\bimport\s*(?:\(|['"{])|\bexport\s|\brequire\s*\(/.test(code),'unsupported module syntax');
  compiled.set(id,vm.compileFunction(code+'\nreturn {'+exports.join(',')+'};',['__import','Date'],{filename:id}));
 }
 return compiled;
}
function load(db,{clock={now:1800000000000},hook=async()=>{}}={}){
 const compiled=preflight(),cache=new Map(),trace=[],loaded=new Set();
 const collections=new Set(['GuestBookingAcceptances','GuestBookingAllocationManifests','GuestBookingAcquisitionControls','RoomBookingClaimEvents','Bookings','BookingSummary','GuestBookingCompletions']);
 const fail=op=>(...args)=>{trace.push({op});throw Error('forbidden '+op);};
 const wix=new Proxy({query(c){assert.ok(collections.has(c),'collection denied');const predicates=[];let n=100,sort=false;
  const q={eq(k,v){predicates.push([k,v,false]);return q;},gt(k,v){predicates.push([k,v,true]);return q;},ascending(k){assert.equal(k,'_id');sort=true;return q;},limit(v){n=v;return q;},async find(options){
   assert.deepEqual(options,{suppressAuth:true,suppressHooks:true,consistentRead:true});
   trace.push({op:'find',c,predicates:structuredClone(predicates),n});
   const injected=await hook({c,predicates,trace,db,clock});
   let rows=injected?.rows||(db.rows[c]||[]).filter(r=>predicates.every(([k,v,gt])=>gt?r[k]>v:r[k]===v));
   if(sort)rows=rows.slice().sort((a,b)=>a._id<b._id?-1:a._id>b._id?1:0);
   return {items:structuredClone(rows.slice(0,n)),hasNext(){return rows.length>n;}};
  }};return q;
 }},{get(t,k){return Object.hasOwn(t,k)?t[k]:fail('SDK:'+String(k));}});
 function ClockDate(...args){return new Date(...args);}ClockDate.prototype=Date.prototype;ClockDate.now=()=>clock.now;ClockDate.UTC=Date.UTC;ClockDate.parse=Date.parse;
 const actualCrypto={...crypto,randomBytes:fail('rng')};
 const ext={crypto:{...actualCrypto,default:actualCrypto},buffer:{Buffer},'wix-data':{default:wix},'wix-auth':{elevate:fn=>fn},'wix-secrets-backend.v2':{secrets:{async getSecretValue(n){trace.push({op:'secret',n});assert.equal(n,'WBE_GUEST_BOOKING_KEYS');if(db.secretFailure)throw Error('inert secret failure');return {value:JSON.stringify(db.keys)};}}}};
 function module(id){if(cache.has(id))return cache.get(id);assert.ok(compiled.has(id),'module denied');
  const out=compiled.get(id)(spec=>Object.hasOwn(ext,spec)?ext[spec]:module('velo/'+spec+'.js'),ClockDate);
  if(id==='velo/backend/guestBookingPhysicalAcquisitionEvidence.js'){
   const factory=out.createGuestBookingPhysicalAcquisitionSession;
   out.createGuestBookingPhysicalAcquisitionSession=()=>{const session=factory();
    for(const k of ['reserveReadback','reconcileControl','reconcileResource'])session[k]=fail(k);
    const store=session.completionStore();for(const k of ['insert','reserveSelection'])store[k]=fail(k);
    return session;
   };
  }
  cache.set(id,out);loaded.add(id);return out;
 }
 const api=module(admission.candidate.id);
 return {read:(...args)=>api.readOwnGuestBookingCompletionStatus(...args),retained:(a,o,d)=>module('velo/backend/guestBookingCompletionAuthority.js').readRecoveredGuestBookingCompletion(a,o,d),attenuate:token=>module('velo/backend/guestBookingCredentials.js').createGuestBookingCredentials(structuredClone(db.keys)).attenuateBootstrap({bootstrapToken:token,nowMs:clock.now}),trace,loaded,clock,api};
}
// Independent public fixture envelope construction; never manufactures retained rows.
function tokenFor(f,purpose='guest-bootstrap',changes={},kid=f.db.keys.activeKid,keyHex=f.db.keys.keys[0].keyHex){
 const r=f.db.rows.GuestBookingAcceptances.find(r=>r._id===f.expected.acceptanceId);
 const c={purpose,audience:r.audience,intentId:r.operationId,intentDigest:r.intentDigest,quoteDigest:r.quoteDigest,issuedAtMs:r.issuedAtMs,expiresAtMs:r.offerExpiresAtMs,...changes};
 const payload=Buffer.from(JSON.stringify([1,c.purpose,c.audience,c.intentId,c.intentDigest,c.quoteDigest,c.issuedAtMs,c.expiresAtMs]),'ascii').toString('base64url');
 const wire='wgb1.'+kid+'.'+payload;
 return wire+'.'+crypto.createHmac('sha256',Buffer.from(keyHex,'hex')).update('WBE-GUEST-BOOKING-CREDENTIAL\0'+wire).digest('base64url');
}
module.exports={load,fixture,tokenFor,preflight,root,admission,hash};
