'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'velo/backend/guestBookingFinancialAuthority.js');
const KEY = 'PUBLIC-ONLY-FINANCIAL-PREVIEW-FIXTURE-0001';
const NOW = 1800000000000;
const claims = {v:1,nonce:'000102030405060708090a0b',issuedAt:NOW,expiresAt:NOW+3600000,checkIn:'2027-01-01',checkOut:'2027-01-03',nights:2,packageId:'package',packageTitle:'',baseRate:100,priceModifier:1,totalPerPerson:100};
function sign(c=claims,key=KEY) {const p=Buffer.from(JSON.stringify(c)).toString('base64url');return p+'.'+crypto.createHmac('sha256',key).update(p).digest('base64url');}
function input() {return {v:1,checkIn:claims.checkIn,checkOut:claims.checkOut,packageId:'package',pricingQuoteToken:sign(),promoCode:'',guestName:'Test Guest',guestEmail:'test@example.com',guestPhone:'1234567',dialingCode:'1',note:'',marketSource:'',gclid:'',gbraid:'',wbraid:'',msclkid:'',priceGroups:[{roomCode:'adventure_suite',quantity:1,guests:2}]};}
let activeSource;
function subject(source=activeSource) {
 const state={now:NOW,clocks:0,secrets:0,calls:[],rows:{Packages:[{_id:'package',numberOfNights:2,baseRate:999,priceModifier:2}],Settings:[{_id:'s1',key:'propertyFeeRate',value:'0.05'},{_id:'s2',key:'taxRate_accommodation',value:0.1},{_id:'s3',key:'taxRate_standard',value:'0.15'}],Rooms:[{_id:'room',roomCode:'penthouse_apartment',roomFee:10.005}],PromoCodes:[]}};
 const context=vm.createContext({});context.clock=()=>{state.clocks++;return state.now;};vm.runInContext('Date.now=()=>clock()',context);
 const realm=x=>vm.runInContext('('+JSON.stringify(x)+')',context);
 const wix={query(collection){let filter=null,limit=null,sort=null;const q={eq(k,v){filter=[k,v];return q;},gt(k,v){filter=[k,v,'gt'];return q;},limit(n){limit=n;return q;},ascending(k){sort=k;return q;},find(options){const call={collection,filter,limit,sort,options:{...options}};state.calls.push(call);if(state.respond)return state.respond(call,realm);let rows=state.rows[collection].filter(r=>!filter||(filter[2]==='gt'?r[filter[0]]>filter[1]:r[filter[0]]===filter[1]));if(sort)rows=rows.slice().sort((a,b)=>a[sort]<b[sort]?-1:a[sort]>b[sort]?1:0);const more=rows.length>limit;return Promise.resolve({items:realm(rows.slice(0,limit)),hasNext(){return more;}});}};return q;}};
 const modules={'crypto':crypto,'buffer':{Buffer},'wix-data':wix,'wix-secrets-backend.v2':{secrets:{getSecretValue(name){assert.equal(name,'WBE_PRICING_QUOTE_SECRET');state.secrets++;return state.secretResponse?state.secretResponse():Object.assign(Object.create(null),{value:KEY});}}},'wix-auth':{elevate:fn=>fn}};
 function load(name) {if(Object.hasOwn(modules,name))return modules[name];const src=name==='backend/guestBookingFinancialAuthority'&&source!==undefined?source:fs.readFileSync(path.join(root,'velo',name+'.js'),'utf8');const names=[];const text=src.replace(/^import (.+) from '([^']+)';$/gm,(_,binding,spec)=>{load(spec);return `const ${binding}=imports[${JSON.stringify(spec)}];`;}).replace(/export (async )?function (\w+)/g,(_,a,n)=>{names.push(n);return (a||'')+'function '+n;});context.imports=modules;return modules[name]=vm.runInContext('(function(){'+text+';return {'+names.join(',')+'};})()',context);}
 const exports=load('backend/guestBookingFinancialAuthority');return {state,context,realm,wix,read:exports.readGuestBookingFinancialPreview};
}
const tests=[];function test(name,fn){tests.push([name,fn]);}
function frozen(x){if(x===null||typeof x!=='object')return;assert.ok(Object.isFrozen(x));if(!Array.isArray(x))assert.equal(Object.getPrototypeOf(x),null);for(const v of Object.values(x))frozen(v);}
test('actual signed suite preview uses locked whole-stay price and exact reads',async()=>{const s=subject();assert.equal(s.state.clocks,0);assert.equal(s.state.secrets,0);const i=s.realm(input());const r=await s.read(i);assert.notEqual(r,'DENIED');assert.equal(r.purpose,'guest-booking-financial-preview');assert.equal(r.quote.token,sign());assert.equal(r.quote.claims.packageTitle,'');assert.equal(r.factors.totalPerPerson,100);assert.equal(r.calculation.totals.grandTotalCents,23500);assert.equal(r.catalog.room,null);assert.equal(r.catalog.promo,null);assert.equal(r.factors.penthouseRoomFee,null);assert.equal(JSON.parse(r.inputCanonical)[7][0],'Test Guest');assert.equal(r.observedAtMs,NOW);frozen(r);assert.deepEqual(s.state.calls.map(c=>[c.collection,c.filter,c.limit,c.options]),[['Packages',['_id','package'],2,{suppressAuth:true,consistentRead:true}],...['propertyFeeRate','taxRate_accommodation','taxRate_standard'].map(k=>['Settings',['key',k],2,{suppressAuth:true,consistentRead:true}])]);});
test('Penthouse fractional fee is per room per night and numeric zero succeeds',async()=>{for(const fee of [10.005,0]){const s=subject();s.state.rows.Rooms[0].roomFee=fee;const i=input();i.priceGroups[0].roomCode='penthouse_apartment';const r=await s.read(s.realm(i));assert.notEqual(r,'DENIED');assert.equal(r.factors.penthouseRoomFee,fee);assert.equal(r.calculation.totals.grossCents,fee===0?20000:22001);assert.equal(r.catalog.room._id,'room');assert.equal(s.state.calls.filter(c=>c.collection==='Rooms').length,1);frozen(r);}});
test('unique normalized promo preserves spelling aliases and inclusive occupied window',async()=>{const s=subject();s.state.rows.PromoCodes=[{_id:'a',title:'other',discount:null},{_id:'b',title:' Sale ',Title:'SALE',title_fld:'sale',discount:'0.1',minimumNights:'2',startDate:'2027-01-01',endDate:'2027-01-02'}];const i=input();i.promoCode=' sAlE ';const r=await s.read(s.realm(i));assert.notEqual(r,'DENIED');assert.equal(r.calculation.totals.grandTotalCents,21150);assert.equal(r.catalog.promo.submittedCode,' sAlE ');assert.equal(r.catalog.promo.comparisonKey,'SALE');assert.equal(r.catalog.promo.raw.title.value,' Sale ');assert.equal(r.catalog.promo.raw.minimumNights.value,'2');assert.equal(JSON.parse(r.inputCanonical)[6],' sAlE ');assert.deepEqual(s.state.calls.at(-1),{collection:'PromoCodes',filter:null,limit:100,sort:'_id',options:{suppressAuth:true,consistentRead:true}});frozen(r);});
// Regression expansion of the preceding green slices; only SDK/clock doubles.
const validPromo=()=>({_id:'p0000',title:'SALE',discount:0.1});
const promoInput=()=>({...input(),promoCode:'sale'});
function response(s,c){return {items:s.realm(s.state.rows[c.collection].filter(r=>!c.filter||r[c.filter[0]]===c.filter[1])),hasNext(){return false;}};}
for(const count of [100,101,1000,1001])test('promo bounded exhausted keyset '+count,async()=>{const s=subject();s.state.rows.PromoCodes=Array.from({length:count},(_,i)=>({_id:'p'+String(i).padStart(4,'0'),title:i===count-1?'SALE':'other'}));s.state.rows.PromoCodes[count-1].discount=1;const r=await s.read(s.realm(promoInput()));if(count<=1000){assert.notEqual(r,'DENIED');assert.equal(r.calculation.totals.grandTotalCents,0);assert.equal(r.catalog.promo.scan.rows,count);assert.equal(r.catalog.promo.scan.pages,Math.ceil(count/100));}else assert.equal(r,'DENIED');const calls=s.state.calls.filter(c=>c.collection==='PromoCodes');assert.equal(calls.length,Math.min(10,Math.ceil(count/100)));for(const [i,c]of calls.entries()){assert.equal(c.limit,100);assert.equal(c.sort,'_id');assert.deepEqual(c.options,{suppressAuth:true,consistentRead:true});assert.deepEqual(c.filter,i?['_id','p'+String(i*100-1).padStart(4,'0'),'gt']:null);}});
test('later page matching alias cannot escape uniqueness',async()=>{const s=subject();s.state.rows.PromoCodes=Array.from({length:101},(_,i)=>({_id:'p'+String(i).padStart(4,'0'),title:i===0||i===100?' sale ':'other',discount:0.1}));assert.equal(await s.read(s.realm(promoInput())),'DENIED');assert.equal(s.state.calls.filter(c=>c.collection==='PromoCodes').length,2);});
for(const [label,value]of [['zero',0],['minus-zero',-0],['zero-text','0.00'],['blank',''],['space',' .1'],['sign','+0.1'],['exponent','1e-1'],['percent','10%'],['prefix','0.1x'],['null',null],['boolean',true],['negative',-1],['missing',undefined]])test('Settings denies '+label,async()=>{
 for(let n=0;n<3;n++){
  const s=subject();let reached=0,intact=false;
  s.state.respond=c=>{
   const r=response(s,c);
   if(c.collection==='Settings'&&c.filter[1]===s.state.rows.Settings[n].key){
    reached++;
    if(label==='missing')delete r.items[0].value;else r.items[0].value=value;
    intact=label==='missing'?!Object.hasOwn(r.items[0],'value'):Object.is(r.items[0].value,value);
    if(label==='minus-zero')intact=intact&&Object.is(r.items[0].value,-0);
   }
   return r;
  };
  const result=await s.read(s.realm(input()));
  assert.equal(reached,1);assert.equal(intact,true,'exact Settings value at SDK response boundary');
  assert.equal(result,'DENIED');
 }
});
for(const collection of ['Packages','Settings','Rooms'])for(const mode of ['missing','duplicate','identity'])test(collection+' '+mode+' denies',async()=>{const s=subject(),i=input();if(collection==='Rooms')i.priceGroups[0].roomCode='penthouse_apartment';if(mode==='missing')s.state.rows[collection]=[];else if(mode==='duplicate')s.state.rows[collection].push({...s.state.rows[collection][0]});else s.state.respond=c=>{const r=response(s,c);if(c.collection===collection)r.items[0][collection==='Packages'?'_id':collection==='Rooms'?'roomCode':'key']='wrong';return r;};assert.equal(await s.read(s.realm(i)),'DENIED');});
for(const [label,change]of [['no-nights',r=>delete r.numberOfNights],['conflict',r=>r.NumberOfNights='3'],['null-alias',r=>r.NumberOfNights=null],['bad-base',r=>r.baseRate='100'],['bad-modifier',r=>r.priceModifier=0]])test('package '+label,async()=>{const s=subject();change(s.state.rows.Packages[0]);assert.equal(await s.read(s.realm(input())),'DENIED');});
test('all package night aliases agree and signed economics survive metadata edits',async()=>{const s=subject();Object.assign(s.state.rows.Packages[0],{numberOfNights:'2',NumberOfNights:2,numberofnights:'2',title:'changed',baseRate:10000,priceModifier:3});const r=await s.read(s.realm(input()));assert.notEqual(r,'DENIED');assert.equal(r.catalog.package.nightAliases.NumberOfNights.value,2);assert.equal(r.quote.claims.packageTitle,'');assert.equal(r.calculation.totals.grossCents,20000);});
for(const fee of [null,'', '0',-1])test('Penthouse malformed fee '+JSON.stringify(fee),async()=>{const s=subject(),i=input();i.priceGroups[0].roomCode='penthouse_apartment';s.state.rows.Rooms[0].roomFee=fee;assert.equal(await s.read(s.realm(i)),'DENIED');});
for(const [label,change]of [['no-match',r=>r.title='other'],['alias-conflict',r=>r.Title='different'],['alias-blank',r=>r.Title=' '],['no-title',r=>delete r.title],['discount-zero',r=>r.discount=0],['discount-over-one',r=>r.discount=1.01],['discount-prefix',r=>r.discount='0.1junk'],['minimum-prefix',r=>r.minimumNights='2x'],['minimum-fraction',r=>r.minimumNights=0.5],['minimum-too-long',r=>r.minimumNights=3],['datetime-denied',r=>r.startDate='2027-01-01T00:00:00Z'],['invalid-day',r=>r.startDate='2027-02-29'],['date-zero',r=>r.endDate=0],['late-start',r=>r.startDate='2027-01-02'],['early-end',r=>r.endDate='2027-01-01'],['inverted',r=>{r.startDate='2027-01-03';r.endDate='2027-01-01';}]])test('promo '+label,async()=>{const s=subject(),r=validPromo();change(r);s.state.rows.PromoCodes=[r];assert.equal(await s.read(s.realm(promoInput())),'DENIED');});
test('nonmatching unused metadata never read',async()=>{const s=subject();s.state.respond=c=>{if(c.collection!=='PromoCodes')return response(s,c);const items=s.realm([{_id:'a',title:'other'},validPromo()]);for(const k of ['discount','startDate','description'])Object.defineProperty(items[0],k,{get(){throw Error('unused hook');},enumerable:true});return {items,hasNext(){return false;}};};assert.notEqual(await s.read(s.realm(promoInput())),'DENIED');});
test('native SDK dates snapshot milliseconds UTC day and absent endpoints distinctly',async()=>{const s=subject();s.state.rows.PromoCodes=[validPromo()];s.state.respond=c=>{const r=response(s,c);r.items[0]._updatedDate=vm.runInContext('new Date(1800000000000)',s.context);if(c.collection==='PromoCodes'){r.items[0].startDate=vm.runInContext('new Date("2027-01-01T23:59:59Z")',s.context);r.items[0].endDate=vm.runInContext('new Date("2027-01-02T00:00:00Z")',s.context);}return r;};const r=await s.read(s.realm(promoInput()));assert.notEqual(r,'DENIED');assert.equal(r.catalog.package.updatedAtMs,NOW);assert.equal(r.catalog.promo.updatedAtMs,NOW);assert.equal(r.catalog.promo.raw.startDate.value.kind,'date');assert.equal(r.catalog.promo.raw.minimumNights.present,false);frozen(r);});
for(const mode of ['throw','reject','items-getter','row-getter','hasNext-getter','unknown-paging','sparse','extra-item-key','more-exact','descriptor-drift'])test('SDK boundary '+mode,async()=>{const s=subject();let hooks=0;s.state.respond=c=>{if(mode==='throw')throw Error('SDK');if(mode==='reject')return Promise.reject(Error('SDK'));const r=response(s,c);if(mode==='items-getter')Object.defineProperty(r,'items',{get(){hooks++;throw 0;}});if(mode==='row-getter')Object.defineProperty(r.items[0],'baseRate',{get(){hooks++;throw 0;},enumerable:true});if(mode==='hasNext-getter')Object.defineProperty(r,'hasNext',{get(){hooks++;throw 0;}});if(mode==='unknown-paging')r.hasNext=()=>undefined;if(mode==='more-exact')r.hasNext=()=>true;if(mode==='sparse')delete r.items[0];if(mode==='extra-item-key')r.items.extra=1;if(mode==='descriptor-drift'){let n=0;r.items[0]=new Proxy(r.items[0],{getOwnPropertyDescriptor(t,k){const d=Object.getOwnPropertyDescriptor(t,k);if(k==='baseRate'&&++n===2)d.value=1;return d;}});}return r;};assert.equal(await s.read(s.realm(input())),'DENIED');assert.equal(hooks,0);});
test('wrong arity and fake authority denied before IO',async()=>{const s=subject();for(const args of [[],[s.realm(input()),{}],[{verified:true,claims}],[sign()]])assert.equal(await s.read(...args),'DENIED');assert.equal(s.state.calls.length,0);assert.equal(s.state.secrets,0);});
test('real crypto forgery and stay mismatch deny before catalog',async()=>{for(const c of [{...claims,packageId:'other'},claims]){const s=subject(),i=input();i.pricingQuoteToken=sign(c,c===claims?KEY+'wrong':KEY);assert.equal(await s.read(s.realm(i)),'DENIED');assert.equal(s.state.calls.length,0);}});
test('caller fully detached before secret await',async()=>{const s=subject(),i=s.realm(input());let done;s.state.secretResponse=()=>new Promise(r=>done=r);const p=s.read(i);for(const k of Object.keys(i))Object.defineProperty(i,k,{get(){throw Error('caller reread');}});done(Object.assign(Object.create(null),{value:KEY}));const r=await p;assert.notEqual(r,'DENIED');assert.equal(JSON.parse(r.inputCanonical)[7][0],'Test Guest');});
test('row snapshot survives subsequent suspended catalog IO',async()=>{const s=subject();let old,done;s.state.respond=c=>{if(c.collection==='Packages'){const r=response(s,c);old=r.items[0];return r;}if(!done&&c.filter[1]==='propertyFeeRate')return new Promise(resolve=>{done=()=>resolve(response(s,c));});return response(s,c);};const p=s.read(s.realm(input()));await new Promise(r=>setImmediate(r));assert.ok(done);old.baseRate=5;old.numberOfNights=7;done();const r=await p;assert.notEqual(r,'DENIED');assert.equal(r.catalog.package.baseRate,999);assert.equal(r.catalog.package.nightAliases.numberOfNights.value,2);});
test('final expiry denies after slow catalog and equality is expired',async()=>{for(const offset of [3599999,3600000]){const s=subject();s.state.respond=c=>{if(c.filter?.[1]==='taxRate_standard')s.state.now=NOW+offset;return response(s,c);};const r=await s.read(s.realm(input()));if(offset===3599999)assert.notEqual(r,'DENIED');else assert.equal(r,'DENIED');assert.equal(s.state.calls.length,4);}});
test('never settling SDK remains pending',async()=>{const s=subject();s.state.respond=()=>new Promise(()=>{});let settled=false;s.read(s.realm(input())).then(()=>settled=true);await new Promise(r=>setImmediate(r));assert.equal(settled,false);});
test('raw source signed zero is preserved while factors normalize',async()=>{const s=subject(),i=input();i.priceGroups[0].roomCode='penthouse_apartment';s.state.respond=c=>{const r=response(s,c);if(c.collection==='Packages')r.items[0].baseRate=-0;if(c.collection==='Rooms')r.items[0].roomFee=-0;return r;};const r=await s.read(s.realm(i));assert.notEqual(r,'DENIED');assert.ok(Object.is(r.catalog.package.baseRate,-0),'raw package signed zero');assert.ok(Object.is(r.catalog.room.roomFee,-0),'raw room signed zero');assert.ok(Object.is(r.factors.penthouseRoomFee,0));});
test('SDK result prototype drift during pagination denies',async()=>{const s=subject();let reached=0;s.state.respond=c=>{const r=response(s,c);r.hasNext=()=>{reached++;Object.setPrototypeOf(r,{});return false;};return r;};assert.equal(await s.read(s.realm(input())),'DENIED');assert.equal(reached,1);});
test('final item descriptor inspection cannot hide result prototype drift',async()=>{
 const s=subject();let reached=0;
 s.state.respond=c=>{const r=response(s,c);let reads=0;r.items=new Proxy(r.items,{getOwnPropertyDescriptor(t,k){const d=Object.getOwnPropertyDescriptor(t,k);if(k==='0'&&++reads===2){reached++;Object.setPrototypeOf(r,{});}return d;}});return r;};
 assert.equal(await s.read(s.realm(input())),'DENIED');assert.equal(reached,1);
});
test('concurrent previews settle in reverse without sharing input or factors',async()=>{
 const s=subject(),pending=[];s.state.secretResponse=()=>new Promise(resolve=>pending.push(resolve));
 const a=input(),b=input();b.guestName='Second Guest';b.pricingQuoteToken=sign({...claims,totalPerPerson:200});
 const pa=s.read(s.realm(a)),pb=s.read(s.realm(b));assert.equal(pending.length,2);
 pending[1](Object.assign(Object.create(null),{value:KEY}));const rb=await pb;
 pending[0](Object.assign(Object.create(null),{value:KEY}));const ra=await pa;
 assert.notEqual(ra,'DENIED');assert.notEqual(rb,'DENIED');assert.equal(ra.calculation.totals.grandTotalCents,23500);assert.equal(rb.calculation.totals.grandTotalCents,47000);
 assert.equal(JSON.parse(ra.inputCanonical)[7][0],'Test Guest');assert.equal(JSON.parse(rb.inputCanonical)[7][0],'Second Guest');assert.notEqual(ra.catalog,rb.catalog);frozen(ra);frozen(rb);
});
for(const mode of ['repeated-page','final-rejection','short-more','unknown-final'])test('promo transport '+mode,async()=>{
 const s=subject();let pages=0;
 s.state.respond=c=>{if(c.collection!=='PromoCodes')return response(s,c);pages++;
  if(mode==='final-rejection'&&pages===10)return Promise.reject(Error('last page unavailable'));
  const start=mode==='repeated-page'?0:(pages-1)*100;
  const items=s.realm(Array.from({length:mode==='short-more'?99:100},(_,i)=>({_id:'p'+String(start+i).padStart(4,'0'),title:start+i===0?'SALE':'other',discount:0.1})));
  return {items,hasNext(){return mode==='unknown-final'&&pages===10?undefined:pages<10;}};
 };
 assert.equal(await s.read(s.realm(promoInput())),'DENIED');assert.equal(pages,mode==='short-more'?1:mode==='repeated-page'?2:10);
});
for(const extra of [0,1])test('total consumed text budget boundary '+extra,async()=>{
 const s=subject();s.state.rows.PromoCodes=Array.from({length:400},(_,i)=>({_id:'p'+String(i).padStart(4,'0'),title:i===0?'SALE':'other',Title:i===0?'SALE':'other',title_fld:i===0?'SALE':'other',discount:0.1}));
 // Count only the contract-selected primitive strings; matching aliases are
 // observed twice by the current two-phase title/selected-row snapshot.
 const strings=r=>Object.values(r).reduce((n,v)=>n+(typeof v==='string'?v.length:0),0);
 let size=strings(s.state.rows.Packages[0])+s.state.rows.Settings.reduce((n,r)=>n+strings(r),0)+s.state.rows.PromoCodes.reduce((n,r)=>n+strings(r),0)+strings(s.state.rows.PromoCodes[0]);
 for(let i=1;i<400&&size<262144+extra;i++)for(const k of ['title','Title','title_fld']){const add=Math.min(251,262144+extra-size);s.state.rows.PromoCodes[i][k]+=' '.repeat(add);size+=add;}
 assert.equal(size,262144+extra);const r=await s.read(s.realm(promoInput()));if(extra)assert.equal(r,'DENIED');else{assert.notEqual(r,'DENIED');assert.equal(r.catalog.promo.scan.rows,400);}
});
test('captured intrinsics survive mutation at catalog suspension',async()=>{
 const s=subject();let done,hooks=0;s.state.rows.PromoCodes=[validPromo()];s.context.poisonHit=()=>hooks++;
 s.state.respond=c=>{if(c.collection==='Packages')return new Promise(resolve=>done=()=>resolve(response(s,c)));const r=response(s,c);if(c.collection==='PromoCodes'){r.items[0].startDate=vm.runInContext('new Date("2027-01-01T00:00:00Z")',s.context);r.items[0].endDate=vm.runInContext('new Date("2027-01-02T00:00:00Z")',s.context);}return r;};
 const p=s.read(s.realm(promoInput()));await new Promise(r=>setImmediate(r));assert.ok(done);
 vm.runInContext(`Object.getPrototypeOf=Object.getOwnPropertyDescriptor=Object.freeze=Object.create=Object.defineProperty=Object.is=Reflect.ownKeys=Reflect.apply=Array.isArray=Number.isSafeInteger=Number.isFinite=JSON.parse=Math.floor=String.prototype.trim=String.prototype.toUpperCase=String.prototype.slice=RegExp.prototype.exec=Date.now=Date.prototype.getTime=Date.prototype.getUTCFullYear=Date.prototype.getUTCMonth=Date.prototype.getUTCDate=function(){poisonHit();throw Error('uncaptured intrinsic');}`,s.context);
 done();const r=await p;assert.notEqual(r,'DENIED');assert.equal(r.calculation.totals.grandTotalCents,21150);assert.equal(hooks,0);assert.equal(r.catalog.promo.raw.startDate.value.kind,'date');frozen(r);
});
test('SDK class-prototype pagination data method remains supported',async()=>{
 const s=subject();let hooks=0;
 const Result=vm.runInContext('(class Result { constructor(items){this.items=items;} hasNext(){paginationHit();return false;} })',s.context);
 s.context.paginationHit=()=>hooks++;
 s.state.respond=c=>{const r=new Result(response(s,c).items);assert.equal(Object.hasOwn(r,'hasNext'),false);return r;};
 const r=await s.read(s.realm(input()));assert.notEqual(r,'DENIED');assert.equal(r.purpose,'guest-booking-financial-preview');assert.equal(hooks,4);
});
for(const accessor of ['own','prototype'])test('SDK '+accessor+' pagination accessor denies without callbacks',async()=>{
 const s=subject();let hooks=0;
 s.state.respond=c=>{const r=s.realm({});r.items=response(s,c).items;const target=accessor==='own'?r:s.realm({});Object.defineProperty(target,'hasNext',{get(){hooks++;return ()=>false;},configurable:true});if(accessor==='prototype')Object.setPrototypeOf(r,target);return r;};
 assert.equal(await s.read(s.realm(input())),'DENIED');assert.equal(hooks,0);
});
for(const poison of [false,true])test(poison?'missing pagination cannot inherit fabricated exhaustion':'missing pagination without pollution denies',async()=>{
 const s=subject();let reached=0,hooks=0,promoRows=0;
 s.state.rows.PromoCodes=Array.from({length:101},(_,i)=>({_id:'p'+String(i).padStart(4,'0'),title:i===0||i===100?'SALE':'other',discount:0.1}));
 s.state.respond=c=>{if(c.collection!=='PromoCodes')return response(s,c);const r=s.realm({});r.items=s.realm(s.state.rows.PromoCodes.slice(0,c.limit));promoRows=r.items.length;assert.equal(Object.hasOwn(r,'hasNext'),false);return r;};
 s.context.attackReached=()=>reached++;s.context.paginationHit=()=>hooks++;
 s.context.purchase=s.realm(promoInput());
 const purchase=poison?vm.runInContext(`(()=>{let installed=false;return new Proxy(purchase,{ownKeys(target){if(!installed){installed=true;attackReached();Object.defineProperty(Object.prototype,'hasNext',{value:function(){paginationHit();return false;},configurable:true});}return Reflect.ownKeys(target);}});})()`,s.context):s.context.purchase;
 let r;
 try{r=await s.read(purchase);}finally{vm.runInContext('delete Object.prototype.hasNext',s.context);}
 assert.equal(reached,poison?1:0);assert.equal(promoRows,100);assert.equal(s.state.calls.filter(c=>c.collection==='PromoCodes').length,1);
 assert.equal(r,'DENIED');assert.equal(hooks,0);
});
// Fresh native ESM: only import specifiers are relocated. No VM global
// instrumentation and no dependency body rewriting; SDK/secret/clock are fixtures.
const { spawnSync } = require('child_process');
const dataModule = text => 'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
function nativeModule(source) {
 const modules = new Map([
  ['crypto','node:crypto'], ['buffer','node:buffer'],
  ['wix-data',dataModule('export default globalThis.financialFixture;')],
  ['wix-secrets-backend.v2',dataModule('export const secrets={getSecretValue:globalThis.financialFixture.secret};')],
  ['wix-auth',dataModule('export const elevate=fn=>fn;')]
 ]);
 function load(name) {
  if(modules.has(name))return modules.get(name);
  assert.match(name,/^backend\/[A-Za-z]+$/,'local dependency only');
  const body=name==='backend/guestBookingFinancialAuthority'?source:fs.readFileSync(path.join(root,'velo',name+'.js'),'utf8');
  const relocated=body.replace(/^(import .+ from )'([^']+)';$/gm,(_,prefix,spec)=>prefix+JSON.stringify(load(spec))+';');
  const url=dataModule(relocated);modules.set(name,url);return url;
 }
 return load('backend/guestBookingFinancialAuthority');
}
// This function is serialized as code, not fixture values. NaN, -0, boxed Number,
// and Date objects are created and checked in the very realm running the reader.
async function nativeWitness() {
 const {default:assert}=await import('node:assert/strict');
 const {readFileSync}=await import('node:fs');
 const config=JSON.parse(readFileSync(0,'utf8'));
 const {mode,input:purchase,key,now,special}=config;
 let hooks=0,reached=0,boundaryChecks=0,methodCalls=0;
 const calls=[],boundary=[];
 const define=Object.defineProperty,descriptor=Object.getOwnPropertyDescriptor,ownKeys=Reflect.ownKeys;
 const rows={Packages:[{_id:'package',numberOfNights:2,baseRate:999,priceModifier:2}],Settings:[{_id:'s1',key:'propertyFeeRate',value:'0.05'},{_id:'s2',key:'taxRate_accommodation',value:0.1},{_id:'s3',key:'taxRate_standard',value:'0.15'}],Rooms:[{_id:'room',roomCode:'penthouse_apartment',roomFee:10.005}],PromoCodes:[]};
 const values={minusZero:()=>-0,nan:()=>NaN,infinity:()=>Infinity,negativeInfinity:()=>-Infinity,boxed:()=>new Number(0.1),invalidDate:()=>new Date(NaN),dateText:()=> '2027-01-01',null:()=>null,undefined:()=>undefined,number:()=>now,aboveOne:()=>1.25};
 let intended;
 if(special){
  if(special.collection==='Rooms')purchase.priceGroups[0].roomCode='penthouse_apartment';
  if(special.collection==='PromoCodes'){purchase.promoCode='sale';rows.PromoCodes=[{_id:'p0000',title:'SALE',discount:0.1}];}
  const target=rows[special.collection].find(r=>!special.key||r.key===special.key);
  if(special.kind==='missing')delete target[special.field];
  else {intended=values[special.kind]();target[special.field]=intended;}
 }
 function boundaryIntact(row){
  const d=descriptor(row,special.field);
  if(special.kind==='missing')return d===undefined;
  if(!d||!Object.is(d.value,intended))return false;
  const v=d.value;
  if(special.kind==='minusZero')return Object.is(v,-0);
  if(special.kind==='nan')return Number.isNaN(v);
  if(special.kind==='boxed')return v instanceof Number&&Object.getPrototypeOf(v)===Number.prototype&&v.valueOf()===0.1;
  if(special.kind==='invalidDate')return v instanceof Date&&Number.isNaN(Date.prototype.getTime.call(v));
  return true;
 }
 class Result {
  constructor(items,more){this.items=items;this.more=more;}
  hasNext(){methodCalls++;return this.more;}
 }
 class Query {
  constructor(collection){this.collection=collection;}
  eq(k,v){this.filter=[k,v];return this;}
  gt(k,v){this.filter=[k,v,'gt'];return this;}
  limit(n){this.n=n;return this;}
  ascending(k){this.sort=k;return this;}
  find(options){
   let found=rows[this.collection].filter(r=>!this.filter||(this.filter[2]==='gt'?r[this.filter[0]]>this.filter[1]:r[this.filter[0]]===this.filter[1]));
   if(this.sort)found.sort((a,b)=>a._id<b._id?-1:a._id>b._id?1:0);
   const items=found.slice(0,this.n).map(r=>({...r})),more=found.length>this.n;
   calls.push({collection:this.collection,filter:this.filter,limit:this.n,sort:this.sort,options,rows:items.length});
   if(special&&this.collection===special.collection&&(!special.key||this.filter?.[1]===special.key)){
    boundaryChecks++;boundary.push(items.length===1&&boundaryIntact(items[0]));
   }
   if(mode==='row-final-reflection'&&this.collection==='Packages'){
    let reads=0;
    items[0]=new Proxy(items[0],{getOwnPropertyDescriptor(t,k){const d=descriptor(t,k);if(k==='_updatedDate'&&++reads===2){reached++;Object.setPrototypeOf(t,{});}return d;}});
   }
   if((mode==='inherited-hasNext'||mode==='missing-hasNext-control')&&this.collection==='PromoCodes')return Promise.resolve({items});
   const result=new Result(items,more);
   if(mode==='own-accessor'||mode==='prototype-accessor'){
    const target=mode==='own-accessor'?result:Object.create(Result.prototype);
    define(target,'hasNext',{get(){hooks++;return ()=>false;},configurable:true});
    if(mode==='prototype-accessor')Object.setPrototypeOf(result,target);
   }
   return Promise.resolve(result);
  }
 }
 globalThis.financialFixture={query(c){return new Query(c);},secret(name){assert.equal(name,'WBE_PRICING_QUOTE_SECRET');return Object.assign(Object.create(null),{value:key});}};
 Date.now=()=>now;
 const {readGuestBookingFinancialPreview:read}=await import(config.url);
 let actualInput=purchase;
 function restore(){delete Object.prototype.get;delete Object.prototype.set;delete Object.prototype.hasNext;}
 if(mode==='inherited-hasNext'||mode==='missing-hasNext-control'){
  purchase.promoCode='sale';rows.PromoCodes=Array.from({length:101},(_,i)=>({_id:'p'+String(i).padStart(4,'0'),title:i===0||i===100?'SALE':'other',discount:0.1}));
  if(mode==='inherited-hasNext')actualInput=new Proxy(purchase,{ownKeys(t){if(!Object.hasOwn(Object.prototype,'hasNext')){reached++;define(Object.prototype,'hasNext',Object.assign(Object.create(null),{configurable:true,value(){hooks++;return false;}}));}return ownKeys(t);}});
 }
 const poisonedDescriptor=mode.startsWith('descriptor-');
 if(poisonedDescriptor){
  const [,site,kind]=mode.split('-');let installed=false;
  const proxy=new Proxy(site==='group'?purchase.priceGroups[0]:purchase,{
   ownKeys(t){if(!installed){installed=true;reached++;for(const k of kind==='both'?['get','set']:[kind])define(Object.prototype,k,Object.assign(Object.create(null),{configurable:true,get(){hooks++;return undefined;}}));}return ownKeys(t);},
   getOwnPropertyDescriptor(t,k){const d=descriptor(t,k);return d?Object.assign(Object.create(null),d):d;}
  });
  if(site==='group')purchase.priceGroups[0]=proxy;else actualInput=proxy;
 }
 let pending,result;
 // Restoration must happen synchronously before awaiting, asserting or doing I/O.
 try{pending=read(actualInput);}finally{if(poisonedDescriptor)restore();}
 try{result=await pending;}finally{restore();}
 const summary={mode,result:result==='DENIED'?'DENIED':result.purpose,hooks,reached,boundaryChecks,methodCalls,calls:calls.length,promoCalls:calls.filter(c=>c.collection==='PromoCodes').length};
 try{
  for(const c of calls)assert.deepEqual({...c.options},{suppressAuth:true,consistentRead:true});
  if(mode==='row-final-reflection')assert.equal(reached,1);
  if(poisonedDescriptor){assert.equal(reached,1);assert.equal(hooks,0,'inherited descriptor callbacks');}
  if(mode==='inherited-hasNext'||mode==='missing-hasNext-control'){
   assert.equal(reached,mode==='inherited-hasNext'?1:0);assert.equal(summary.promoCalls,1);
   assert.equal(calls.at(-1).rows,100);assert.equal(rows.PromoCodes.length,101);assert.equal(rows.PromoCodes[100].title,'SALE');
  }
  if(special){assert.equal(boundaryChecks,1);assert.deepEqual(boundary,[true],'intended special value intact at SDK response boundary');}
  const denied=['row-final-reflection','inherited-hasNext','missing-hasNext-control','own-accessor','prototype-accessor'].includes(mode)||(special&&special.kind!=='aboveOne');
  if(denied)assert.equal(result,'DENIED');
  else{
   assert.equal(result.purpose,'guest-booking-financial-preview');assert.ok(Object.isFrozen(result));
   if(special){assert.equal(result.catalog.settings[special.key].parsedValue,1.25);assert.ok(Number.isSafeInteger(result.calculation.totals.grandTotalCents));assert.ok(result.calculation.totals.grandTotalCents>0);}
   else assert.equal(result.calculation.totals.grandTotalCents,23500);
   if(mode==='class-methods'){assert.equal(methodCalls,4);assert.equal(calls.length,4);}
  }
  assert.equal(hooks,0);
  console.log(JSON.stringify({passed:true,...summary}));
 }catch(e){
  console.log(JSON.stringify({passed:false,...summary,code:e.code,actual:e.actual?.purpose||e.actual,expected:e.expected,message:e.message}));
  process.exitCode=1;
 }
}
const nativeCases=[
 ...['class-methods','own-accessor','prototype-accessor','missing-hasNext-control','inherited-hasNext','row-final-reflection'].map(mode=>({mode})),
 ...['outer','group'].flatMap(site=>['get','set','both'].map(kind=>({mode:'descriptor-'+site+'-'+kind}))),
 ...['propertyFeeRate','taxRate_accommodation','taxRate_standard'].flatMap(key=>['minusZero','nan','infinity','boxed','aboveOne'].map(kind=>({mode:'Settings '+key+' '+kind,special:{collection:'Settings',key,field:'value',kind}}))),
 ...['missing','nan','infinity','negativeInfinity','boxed'].map(kind=>({mode:'Rooms fee '+kind,special:{collection:'Rooms',field:'roomFee',kind}})),
 ...['startDate','endDate'].map(field=>({mode:'PromoCodes '+field+' invalidDate',special:{collection:'PromoCodes',field,kind:'invalidDate'}})),
 ...['Packages','Settings','Rooms','PromoCodes'].flatMap(collection=>['invalidDate','dateText','null','number','undefined','boxed'].map(kind=>({mode:collection+' update '+kind,special:{collection,key:collection==='Settings'?'propertyFeeRate':undefined,field:'_updatedDate',kind}})))
];
function runNative(url,c) {
 const child=spawnSync(process.execPath,['--input-type=module','-e','('+nativeWitness.toString()+')().catch(e=>{console.error(e);process.exitCode=2;});'],{
  input:JSON.stringify({url,...c,input:input(),key:KEY,now:NOW}),encoding:'utf8',timeout:15000,maxBuffer:1024*1024,windowsHide:true
 });
 assert.equal(child.error,undefined,'native process error '+c.mode);
 assert.equal(child.signal,null,'native signal '+c.mode);
 assert.equal(child.stderr,'','native loader/runtime error '+c.mode);
 const result=JSON.parse(child.stdout.trim());assert.equal(result.mode,c.mode);
 return {status:child.status,result};
}
function verifyNative(source) {
 const original=nativeModule(source);
 for(const c of nativeCases){const r=runNative(original,c);assert.equal(r.status,0,JSON.stringify(r));assert.equal(r.result.passed,true);console.log('PASS native '+c.mode);}
 const specs=[
  ['inherit-base-prototype-pagination','p!==null&&p!==ordinary&&i<16','p!==null&&i<16',['inherited-hasNext']],
  ['drop-final-row-prototype','  if(prototype(value)!==proto)throw 0;\n  return freeze(out);','  return freeze(out);',['row-final-reflection']],
  ['ordinary-put-descriptor',"define(a,''+i,record({value,enumerable:true,writable:true,configurable:true}))","define(a,''+i,{value,enumerable:true,writable:true,configurable:true})",nativeCases.filter(c=>c.mode.startsWith('descriptor-')).map(c=>c.mode)]
 ];
 let witnesses=0;
 for(const [name,from,to,modes]of specs){
  assert.equal(source.split(from).length,2,'unique native mutation anchor '+name);
  const mutant=source.replace(from,to),url=nativeModule(mutant);
  for(const mode of modes){
   const r=runNative(url,{mode});assert.equal(r.status,1,JSON.stringify(r));assert.equal(r.result.passed,false);assert.equal(r.result.code,'ERR_ASSERTION');
   if(mode.startsWith('descriptor-')){assert.equal(r.result.actual,mode.endsWith('-both')?2:1);assert.equal(r.result.expected,0);assert.equal(r.result.hooks,r.result.actual);assert.equal(r.result.reached,1);assert.equal(r.result.result,'DENIED');}
   else {assert.equal(r.result.actual,'guest-booking-financial-preview');assert.equal(r.result.expected,'DENIED');}
   witnesses++;console.log('KILLED native '+name+' via '+mode+' '+JSON.stringify(r.result));
  }
  console.log('MUTATION '+JSON.stringify({name,sha256:crypto.createHash('sha256').update(mutant).digest('hex'),from,to,witnesses:modes.length}));
 }
 // T1 is confirmation of an existing mutation, not a new unique mutation.
 return {cases:nativeCases.length,newUniqueMutants:specs.length-1,witnesses};
}
const mutations=[
 ['inherit-base-prototype-pagination', 'missing pagination cannot inherit fabricated exhaustion', 'p!==null&&p!==ordinary&&i<16', 'p!==null&&i<16', 'preview'],
 ['drop-final-result-prototype', 'SDK result prototype drift during pagination denies', '  if(prototype(response)!==responsePrototype)throw 0;\n', '', 'preview'],
 ['move-prototype-before-final-descriptors', 'final item descriptor inspection cannot hide result prototype drift', '  if(prototype(response)!==responsePrototype)throw 0;\n', '', 'preview'],
 ['admit-unapproved-zero-setting', 'Settings denies zero', '  if(value===0)throw 0;', '', 'preview'],
 ['admit-expiry-equality', 'final expiry denies after slow catalog and equality is expired', 'observedAtMs>=quote.claims.expiresAt', 'observedAtMs>quote.claims.expiresAt', 'preview'],
 ['ignore-later-promo-duplicate', 'later page matching alias cannot escape uniqueness', 'if(selected!==null)throw 0;selected=r;', 'selected=r;', 'preview'],
 ['extend-consumed-text-budget-one', 'total consumed text budget boundary 1', '(budget.text+=value.length)>262144', '(budget.text+=value.length)>262145', 'preview'],
 ['use-live-prototype-intrinsic', 'captured intrinsics survive mutation at catalog suspension', 'const prototype = Object.getPrototypeOf;', 'const prototype = value => Object.getPrototypeOf(value);', 'denied']
];
async function main(){
 assert.ok(fs.existsSync(file),'concrete financial reader must exist');
 for(const [name,fn]of tests){try{await fn();console.log('PASS '+name);}catch(e){e.testName=name;throw e;}}
 const source=fs.readFileSync(file,'utf8');let killed=0;
 for(const [name,witness,from,to,outcome]of mutations){
  assert.equal(source.split(from).length,2,'unique mutation site '+name);
  activeSource=source.replace(from,to);
  if(name==='move-prototype-before-final-descriptors')activeSource=activeSource.replace('  const again=keys(items);','  if(prototype(response)!==responsePrototype)throw 0;\n  const again=keys(items);');
  const found=tests.find(([n])=>n===witness);assert.ok(found,'named witness exists');let failure;
  try{await found[1]();}catch(e){failure=e;}finally{activeSource=undefined;}
  assert.ok(failure,'mutant survived '+name);assert.equal(failure.code,'ERR_ASSERTION','must reach assertion, not loader failure '+name);
  // The actual asserted value must be the financial return, not a call count,
  // syntax error, hook error or merely a structural source-scan mismatch.
  if(outcome==='preview')assert.equal(failure.actual?.purpose,'guest-booking-financial-preview','causal financial success '+name);
  else assert.equal(failure.actual,'DENIED','causal financial denial '+name);
  killed++;console.log('KILLED '+name+' via '+witness);
 }
 const native=verifyNative(source);
 console.log(JSON.stringify({passed:true,cases:tests.length+native.cases,vmCases:tests.length,nativeCases:native.cases,mutantsKilled:killed+native.newUniqueMutants,vmMutantsKilled:killed,nativeMutationWitnesses:native.witnesses,actualPurchase:true,actualLockedAdapter:true,actualCrypto:true,actualCalculator:true}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
