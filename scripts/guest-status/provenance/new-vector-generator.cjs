'use strict';
// NEW deterministic test fixture, NOT recovered issuer output or authority.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const here=__dirname,custody=JSON.parse(fs.readFileSync(path.join(here,'custody-before.json'))),root=path.join(here,'ownroot');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fixturePath='scripts/fixtures/completion-authority-history.json',fixtureBytes=fs.readFileSync(path.join(root,fixturePath));
assert.equal(hash(fixtureBytes),custody.fixtures['completion-authority-history.json']);
const f=JSON.parse(fixtureBytes),r=f.db.rows.GuestBookingAcceptances.find(x=>x._id===f.expected.acceptanceId),o=JSON.parse(r.capsule),t=JSON.parse(o.inputCanonical);
const input={v:1,checkIn:t[2],checkOut:t[3],packageId:t[4],pricingQuoteToken:t[5],promoCode:t[6],guestName:t[7][0],guestEmail:t[7][1],guestPhone:t[7][2],dialingCode:t[7][3],note:t[7][4],marketSource:t[7][5],gclid:t[8][0],gbraid:t[8][1],wbraid:t[8][2],msclkid:t[8][3],priceGroups:t[9].map(g=>({roomCode:g[0],quantity:g[1],guests:g[2]}))};
function expectedDisplay(value){if(Array.isArray(value))return value.map(expectedDisplay);if(value&&typeof value==='object'){const out=Object.create(null);for(const [k,v] of Object.entries(value))out[k]=expectedDisplay(v);return out;}return value;}
const trace=[],rng=[Buffer.from(r.bookingNumber.slice(f.db.config.numberPrefix.length),'hex'),Buffer.from(r.operationId,'hex')];
let rngIndex=0;
const fixtureCrypto={...crypto,randomBytes(n){const b=rng[rngIndex++];assert.ok(b,'only two fixture entropy calls');assert.equal(b.length,n);trace.push({op:'fixed-test-entropy',n,hex:b.toString('hex')});return Buffer.from(b);}};
function ClockDate(...args){return new Date(...args);}ClockDate.prototype=Date.prototype;ClockDate.now=()=>r.issuedAtMs;ClockDate.UTC=Date.UTC;ClockDate.parse=Date.parse;
const deny=name=>()=>{throw Error('forbidden '+name);};
const wix=new Proxy({query(c){assert.equal(c,'GuestBookingFinancialRevisions');let predicates=[],limit=null;const q={eq(k,v){predicates.push([k,v]);return q;},limit(n){limit=n;return q;},async find(options){assert.deepEqual(predicates,[['_id',o.revisionId]]);assert.equal(limit,2);assert.deepEqual(options,{suppressAuth:true,suppressHooks:true,consistentRead:true});trace.push({op:'revision-read',c,predicates,limit});return {items:[{_id:o.revisionId,revisionBytes:o.revisionBytes}],hasNext(){return false;}};}};return q;}},{get(t,k){return Object.hasOwn(t,k)?t[k]:deny('SDK:'+String(k));}});
const values={WBE_PRICING_QUOTE_SECRET:'PUBLIC-READER-QUOTE-FIXTURE-ONLY-KEY',WBE_GUEST_BOOKING_ISSUER_CONFIG:JSON.stringify(f.db.config),WBE_GUEST_BOOKING_KEYS:JSON.stringify(f.db.keys)};
const ext={crypto:{default:fixtureCrypto},buffer:{Buffer},'wix-data':{default:wix},'wix-auth':{elevate:f=>f},'wix-secrets-backend.v2':{secrets:{async getSecretValue(name){assert.ok(Object.hasOwn(values,name));trace.push({op:'public-fixture-secret',name});return {value:values[name]};}}}};
const compiled=new Map(),cache=new Map();
for(const id of custody.issuerGraph){
 const pin=custody.graph[id],b=fs.readFileSync(path.join(root,id));assert.equal(hash(b),pin.raw);assert.equal(hash(b.toString().replace(/\r\n/g,'\n')),pin.canonical);
 const imports={},names=[];
 let source=b.toString().replace(/^import (.+) from '([^']+)';\r?$/gm,(_,binding,spec)=>{imports[spec]=binding;assert.ok(Object.hasOwn(pin.imports,spec));if(spec.startsWith('backend/'))assert.ok(custody.issuerGraph.includes('velo/'+spec+'.js'));else assert.ok(Object.hasOwn(ext,spec));return `const ${binding}=__import(${JSON.stringify(spec)})${binding.startsWith('{')?'':'.default'};`;});
 assert.deepEqual(imports,pin.imports);
 source=source.replace(/export (async )?function (\w+)/g,(_,async,name)=>{names.push(name);return (async||'')+'function '+name;});
 assert.ok(!/\bimport\s*(?:\(|['"{])|\bexport\s|\brequire\s*\(/.test(source));
 compiled.set(id,vm.compileFunction(source+'\nreturn {'+names.join(',')+'};',['__import','Date'],{filename:id}));
}
function load(id){assert.ok(compiled.has(id));if(!cache.has(id))cache.set(id,compiled.get(id)(spec=>Object.hasOwn(ext,spec)?ext[spec]:load('velo/'+spec+'.js'),ClockDate));return cache.get(id);}
(async()=>{
 const result=await load('velo/backend/guestBookingOfferIssuer.js').issueGuestBookingOffer(input);
 assert.notEqual(result,'DENIED');assert.equal(result.capsule,r.capsule,'actual issuer must reproduce exact original capsule with NEW explicit test entropy');assert.deepEqual(result.display,expectedDisplay(o.calculation));assert.equal(rngIndex,2);
 const service=load('velo/backend/guestBookingCredentials.js').createGuestBookingCredentials(structuredClone(f.db.keys));assert.notEqual(service,'DENIED');
 const access=service.attenuateBootstrap({bootstrapToken:result.token,nowMs:r.issuedAtMs});assert.notEqual(access,'DENIED');
 for(const token of [result.token,access]){const claims=service.verifyCredential({token,command:'status',nowMs:r.issuedAtMs});assert.notEqual(claims,'DENIED');assert.equal(claims.intentId,r.operationId);assert.equal(claims.intentDigest,r.intentDigest);assert.equal(claims.quoteDigest,r.quoteDigest);}
 assert.deepEqual(new Set(cache.keys()),new Set(custody.issuerGraph));
 console.log(JSON.stringify({kind:'NEW_DETERMINISTIC_ACTUAL_ISSUER_TEST_VECTOR_NOT_RECOVERED',bootstrap:result.token,access,fixtureSha256:hash(fixtureBytes),capsuleSha256:hash(Buffer.from(result.capsule)),entropy:rng.map(b=>b.toString('hex')),trace,loaded:[...cache.keys()],productionAuthority:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
