'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../velo');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function fixture(){
 const context=vm.createContext({Date,console:{log(){},error(){}},Buffer}),cache=new Map(),rows=[],wire=[];
 const external={crypto:{default:crypto},'libphonenumber-js/max':{parsePhoneNumberFromString:(s,o)=>require('libphonenumber-js/max').parsePhoneNumberFromString(s,JSON.parse(JSON.stringify(o)))},
 'wix-web-module':{Permissions:{Anyone:0,Admin:1},webMethod:(_,f)=>f},'wix-secrets-backend':{getSecret:async()=> '1234'},
 'backend/settings.web':{getAllSettings:async()=>({})},'backend/dataManagerClient.web':{ingestEvent:async p=>{wire.push(JSON.parse(JSON.stringify(p)));return {}; }},
 'backend/googleAdsAttemptJournal':{recordPrivateGoogleAdsAttempt:async(b,build)=>{try{const p=await build(b);rows.push('ATTEMPT');wire.push(JSON.parse(JSON.stringify(p)));return {ok:true};}catch(_){return {ok:false};}}}};
 function make(id){if(cache.has(id))return cache.get(id);const e=external[id];const m=e?new vm.SyntheticModule(Object.keys(e),function(){for(const k of Object.keys(e))this.setExport(k,e[k]);},{context}):new vm.SourceTextModule(fs.readFileSync(path.join(root,id+'.js'),'utf8'),{context});cache.set(id,m);return m;}
 const sender=make('backend/googleAdsConversions.web');await sender.link(make);await sender.evaluate();
 const hash=cache.get('backend/hashUtils.web').namespace;
 let source=fs.readFileSync(path.join(root,'page-booking-summary.js'),'utf8');
 const normalizer=source.slice(source.indexOf('function normalizePhone(raw'),source.length);
 let normalize;
 if(normalizer.startsWith('function normalizePhone(raw')) normalize=vm.runInNewContext('('+normalizer+')');
 else {const m=make('public/phoneNormalization');if(m.status==='unlinked')await m.link(make);if(m.status==='linked')await m.evaluate();normalize=m.namespace.normalizePhone;}
 return {hash,normalize,rows,wire,buy:extra=>sender.namespace.recordBookingConversion({transactionId:'INERT',value:0,currency:'USD',email:'fixture@example.invalid',conversionTime:'2026-09-18T12:00:00Z',...extra})};
}
test('selected calling code and region-aware trunk normalization shared with hashing',async()=>{
 const f=await fixture();
 for(const [raw,cc,out] of [['7400123456','44','+447400123456'],['020 7946 0018','44','+442079460018'],['06 6982','39','+39066982'],['202 555 0100','1','+12025550100'],['+442079460018','1','+442079460018']]){
 assert.equal(f.normalize(raw,cc),out);assert.equal(f.hash.hashPhone(raw,cc),sha(out)); }
});
test('email whitespace and Unicode letters normalize without punctuation/domain policy changes',async()=>{
 const f=await fixture();assert.equal(f.hash.hashEmail(' Test User @ example.com '),sha('testuser@example.com'));
 for(const name of ['Zoë','Pérez','李'])assert.equal(f.hash.hashName(name),sha(name.toLowerCase()));
 assert.equal(f.hash.hashName('Smith-Jones'),sha('smithjones'));
 assert.equal(f.hash.hashEmail('test.user+tag@googlemail.com'),sha('testuser@gmail.com'));
});
test('malformed optional contacts never create useful-looking hashes',async()=>{
 const f=await fixture();for(const v of [' ','abc','++123',123,{},'+999123456789']) assert.equal(f.hash.hashPhone(v),undefined);
 for(const v of [' ','missing-at','a@@example.com','+tag@gmail.com','.@gmail.com',{},123])assert.equal(f.hash.hashEmail(v),undefined);
});
test('invalid contact-only bookings denied before claim; valid click can stand alone',async()=>{
 for(const email of [' ','a@@example.com',{}]){const f=await fixture();assert.equal((await f.buy({email,phone:'abc'})).ok,false);assert.deepEqual(f.rows,[]);}
 const f=await fixture();assert.equal((await f.buy({email:' ',phone:'abc',gclid:'INERT_EXACT'})).ok,true);assert.equal(f.wire[0].events[0].userData,undefined);
});
test('click identifiers are exact strings, never repaired or coerced',async()=>{
 for(const gclid of [123,{},['x'],' x ','x\n','x'.repeat(513)]){const f=await fixture();assert.equal((await f.buy({gclid})).ok,false);assert.deepEqual(f.rows,[]);}
 const f=await fixture();await f.buy({gclid:'INERT_-EXACT.123'});assert.equal(f.wire[0].events[0].adIdentifiers.gclid,'INERT_-EXACT.123');
});
test('finite USD value and calendar-valid zoned timestamps; preserve zero and offsets',async()=>{
 for(const extra of [{value:NaN},{value:Infinity},{value:'0'},{value:-1},{currency:'EUR'},...['2026-02-30T12:00:00Z','2026-09-18T12:00:00','2026-01-01T24:00:00Z',123].map(conversionTime=>({conversionTime}))]){const f=await fixture();assert.equal((await f.buy(extra)).ok,false);assert.deepEqual(f.rows,[]);}
 const f=await fixture();await f.buy({value:0,conversionTime:'2024-02-29T08:30:00-04:00'});assert.equal(f.wire[0].events[0].conversionValue,0);assert.equal(f.wire[0].events[0].eventTimestamp,'2024-02-29T12:30:00.000Z');
});
