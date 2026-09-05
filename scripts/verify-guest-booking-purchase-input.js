const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const file = path.join(root, 'velo/backend/guestBookingPurchaseInput.js');
const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const dependency = fs.readFileSync(path.join(root, 'velo/backend/guestBookingPriceGroups.js'), 'utf8');
const approvedImport = "import { canonicalizeGuestBookingPriceGroups } from 'backend/guestBookingPriceGroups';";
function load(text, observe) {
  return vm.runInThisContext(`((observe) => { const actualGroupCanonicalizer = (() => { ${dependency.replace('export function ', 'function ')}; return canonicalizeGuestBookingPriceGroups; })(); const canonicalizeGuestBookingPriceGroups = value => { if (observe) observe(value); return actualGroupCanonicalizer(value); }; ${text.replace(approvedImport, '').replace('export function ', 'function ')}; return typeof canonicalizeGuestBookingPurchaseInput === 'function' ? canonicalizeGuestBookingPurchaseInput : undefined; })`)(observe);
}
const candidate = load(source);
let count = 0;
function eq(a, b, label) { count++; assert.equal(a, b, label); }
function fixture() { return {v:1, checkIn:'2026-09-05', checkOut:'2026-09-07', packageId:'pkg', pricingQuoteToken:'e30.'+'A'.repeat(43), promoCode:'', guestName:'Ada', guestEmail:'Ada@example.test', guestPhone:'12345', dialingCode:'', note:'', marketSource:'', gclid:'', gbraid:'', wbraid:'', msclkid:'', priceGroups:[{roomCode:'adventure_suite', quantity:1, guests:2}]}; }
// Independent oracle uses standard JSON, then rewrites escapes to the contract.
function ascii(s) { return JSON.stringify(s).replace(/\\(?:["\\/bfnrt]|u[0-9a-f]{4})|[^\x20-\x7e]/g, x => x[0]==='\\' ? ({'\\b':'\\u0008','\\f':'\\u000c','\\n':'\\u000a','\\r':'\\u000d','\\t':'\\u0009'}[x] || x) : '\\u'+x.charCodeAt(0).toString(16).padStart(4,'0')); }
function expected(a) { return '["wbe.guest-purchase-input",1,'+[a.checkIn,a.checkOut,a.packageId,a.pricingQuoteToken,a.promoCode].map(ascii).join(',')+',['+[a.guestName,a.guestEmail,a.guestPhone,a.dialingCode,a.note,a.marketSource].map(ascii).join(',')+'],['+[a.gclid,a.gbraid,a.wbraid,a.msclkid].map(ascii).join(',')+'],'+JSON.stringify(a.priceGroups.map(g=>[g.roomCode,g.quantity,g.guests]))+']'; }
eq(typeof candidate, 'function', 'single named canonicalizer exists');
eq(candidate(fixture()), expected(fixture()), 'complete exact baseline tuple');
const scalarFields = Object.keys(fixture()).filter(k=>k !== 'v' && k !== 'priceGroups');
let invoked = 0;
for (const key of Object.keys(fixture())) {
  for (const mode of ['missing','accessor','hidden']) {
    const a=fixture();
    if(mode==='missing') delete a[key];
    if(mode==='accessor') Object.defineProperty(a,key,{enumerable:true,get(){invoked++; return fixture()[key];}});
    if(mode==='hidden') Object.defineProperty(a,key,{enumerable:false});
    eq(candidate(a),'DENIED',mode+' '+key);
  }
}
for(const key of ['consent','country','verified','intentDigest','roomFee','toJSON',Symbol('extra')]) { const a=fixture(); Object.defineProperty(a,key,{value:1}); eq(candidate(a),'DENIED','extra field'); }
for(const key of scalarFields) for(const value of [null,undefined,1,true,{},new String('x'),()=>{}]) { const a=fixture(); a[key]=value; eq(candidate(a),'DENIED','primitive string '+key); }
for(const v of [0,2,'1',new Number(1),null]) eq(candidate({...fixture(),v}),'DENIED','literal version');
eq(invoked,0,'accessors never run');
{ const a=fixture(); Object.setPrototypeOf(a,null); Object.freeze(a); eq(candidate(a),expected(a),'null prototype frozen'); }
{ const a=Object.fromEntries(Object.entries(fixture()).reverse()); eq(candidate(a),expected(a),'key order irrelevant'); }
const caps = {guestName:256,guestEmail:320,guestPhone:32,dialingCode:8,note:8192,marketSource:256,packageId:256,promoCode:256,gclid:2048,gbraid:2048,wbraid:2048,msclkid:2048,pricingQuoteToken:16384,checkIn:10,checkOut:10};
for(const [key,cap] of Object.entries(caps)) {
  const value = key==='pricingQuoteToken' ? 'a'.repeat(cap-44)+'.'+'Z'.repeat(43) : key==='guestEmail' ? '@'+'a'.repeat(cap-1) : ['guestPhone','dialingCode'].includes(key) ? '1'.repeat(cap) : key==='checkIn' ? '0000-01-01' : key==='checkOut' ? '9999-12-31' : 'a'.repeat(cap);
  const a={...fixture(),[key]:value}; eq(candidate(a),expected(a),'cap '+key);
  eq(candidate({...a,[key]:value+'a'}),'DENIED','cap+1 '+key);
}
for(const key of ['guestName','guestEmail','guestPhone','packageId','pricingQuoteToken','checkIn','checkOut']) eq(candidate({...fixture(),[key]:''}),'DENIED','required '+key);
for(const key of ['guestName','packageId','promoCode']) for(const value of [' ','\u00a0\u1680\u2000\u200a\u202f\u205f\u3000\ufeff']) eq(candidate({...fixture(),[key]:value}),'DENIED','fixed blank '+key);
for(const guestPhone of ['+','++1','1+2','1 2',' 1','1\n','１２','a']) eq(candidate({...fixture(),guestPhone}),'DENIED','phone grammar');
for(const dialingCode of ['+1','1 2','１２','1\n']) eq(candidate({...fixture(),dialingCode}),'DENIED','dialing grammar');
for(const guestEmail of ['foo','Ａ＠Ｂ']) eq(candidate({...fixture(),guestEmail}),'DENIED','ASCII @ required');
for(const pricingQuoteToken of ['a.'+'A'.repeat(42),'a.'+'A'.repeat(44),'.'+'A'.repeat(43),'a..'+'A'.repeat(43),'a=.'+'A'.repeat(43),'a.'+'A'.repeat(43)+'\n','a+.'+'A'.repeat(43)]) eq(candidate({...fixture(),pricingQuoteToken}),'DENIED','token lexical only');
for(const guestPhone of ['1234567890','+1234567890']) { const a={...fixture(),guestPhone}; eq(candidate(a),expected(a),'no country inference'); }
for(const key of scalarFields) for(const value of ['\ud800','\udc00','\ud800x','x\udfff','\u0000','\u001f','\u007f','\u0085','\u009f','\n','\t','\r','\u2028','\u2029']) {
  const a={...fixture(),[key]:value};
  eq(candidate(a),key==='note' && ['\n','\t','\r','\u2028','\u2029'].includes(value) ? expected(a) : 'DENIED','Unicode/control '+key);
}
for(const key of ['guestName','guestEmail','packageId','promoCode','marketSource','gclid','gbraid','wbraid','msclkid','note']) {
  const a={...fixture(),[key]:'é e\u0301 😀\u200d\u200c\u202e@"\\/<script>'};
  eq(candidate(a),expected(a),'literal Unicode '+key);
}
{ const a={...fixture(),note:'\t\r\n\u2028\u2029😀'}; eq(candidate(a),expected(a),'exact long escapes'); assert.notEqual(candidate(a),candidate({...a,note:'\t\n\u2028\u2029😀'})); count++; }
assert.notEqual(candidate({...fixture(),guestName:'é'}),candidate({...fixture(),guestName:'e\u0301'})); count++;
for(const [checkIn,checkOut] of [['0000-02-29','0000-03-01'],['0099-12-31','0100-01-01'],['2000-02-29','2000-03-01'],['0000-01-01','9999-12-31']]) { const a={...fixture(),checkIn,checkOut}; eq(candidate(a),expected(a),'Gregorian valid/long stay'); }
for(const [checkIn,checkOut] of [['1900-02-29','1900-03-01'],['2100-02-29','2100-03-01'],['2026-04-31','2026-05-02'],['2026-00-01','2026-01-02'],['2026-13-01','2027-01-02'],['2026-01-00','2026-01-02'],['2026-09-05','2026-09-05'],['2026-09-07','2026-09-05'],['2026/09/05','2026-09-07'],['２０２６-09-05','2026-09-07'],['2026-09-05T00:00:00Z','2026-09-07'],[new Date(0),'2026-09-07'],[0,'2026-09-07']]) eq(candidate({...fixture(),checkIn,checkOut}),'DENIED','Gregorian denial');
const locations=[a=>a,a=>a.priceGroups,a=>a.priceGroups[0]];
const replaceAt=(a,i,x)=>{if(i===0)return x; if(i===1)a.priceGroups=x;else a.priceGroups[0]=x;return a;};
for(let i=0;i<3;i++) {
  for(const bad of [null,1,()=>{},new Date(),Object.create({})]) eq(candidate(replaceAt(fixture(),i,bad)),'DENIED','hostile node '+i);
  for(const trap of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor']) { const a=fixture(); eq(candidate(replaceAt(a,i,new Proxy(locations[i](a),{[trap](){throw Error('reflection');}}))),'DENIED','throw '+i+trap); }
  for(const extra of ['toJSON','then','price','consent',Symbol.iterator]) {const a=fixture();Object.defineProperty(locations[i](a),extra,{value(){invoked++;}});eq(candidate(a),'DENIED','graph extra');}
  for(const key of Object.keys(locations[i](fixture()))) {const a=fixture();Object.defineProperty(locations[i](a),key,{enumerable:true,get(){invoked++;throw Error('getter');}});eq(candidate(a),'DENIED','graph getter');}
  {const a=fixture(); Object.freeze(locations[i](a));eq(candidate(a),expected(a),'frozen graph');}
}
for(const groups of [[],new Array(1),[,{roomCode:'adventure_suite',quantity:1,guests:2}],Object.setPrototypeOf([{roomCode:'adventure_suite',quantity:1,guests:2}],null)]) eq(candidate({...fixture(),priceGroups:groups}),'DENIED','dense real array');
for(const key of scalarFields) {const a=fixture();a.priceGroups[0]=new Proxy(a.priceGroups[0],{ownKeys(t){a[key]=key==='guestName'?'Other':a[key]+'x';return Reflect.ownKeys(t);}});eq(candidate(a),'DENIED','ancestor scalar drift '+key);}
for(let i=0;i<3;i++) for(const mode of ['value','prototype','writable','enumerable','configurable','keys']) {
 const a=fixture(),target=locations[i](a);let scans=0;
 const proxy=new Proxy(target,{ownKeys(t){scans++;if(scans===2){const key=Object.keys(t)[0];if(mode==='value')t[key]=null;else if(mode==='prototype')Object.setPrototypeOf(t,{});else if(mode==='keys')Object.defineProperty(t,'extra',{value:1});else Object.defineProperty(t,key,{[mode]:false});}return Reflect.ownKeys(t);}});
 eq(candidate(replaceAt(a,i,proxy)),'DENIED','observed drift '+i+mode);
}
eq(invoked,0,'no graph hooks');
// Every mutation is post-load; restore before assertions and never corrupt pre-import realm.
const mutationTargets=[[RegExp.prototype,'exec'],[RegExp.prototype,'test'],[String.prototype,'charCodeAt'],[String.prototype,'slice'],[Object,'getPrototypeOf'],[Object,'getOwnPropertyDescriptor'],[Object,'create'],[Object,'defineProperty'],[Object,'is'],[Reflect,'ownKeys'],[Array,'isArray'],[Number,'isSafeInteger'],[Math,'floor'],[JSON,'stringify'],[Array.prototype,'push'],[Array.prototype,Symbol.iterator],[Function.prototype,'call'],[Function.prototype,'bind']];
for(const [object,key] of mutationTargets) {
 const a={...fixture(),note:'😀\r\n'}, want=expected(a),bad={...a,guestPhone:'++1'}, saved=Object.getOwnPropertyDescriptor(object,key), define=Object.defineProperty;
 let goodResult,badResult;
 try { define(object,key,{...saved,value(){throw Error('post-import mutation');}});goodResult=candidate(a);badResult=candidate(bad); }
 finally {define(object,key,saved);}
 eq(goodResult,want,'captured '+String(key));eq(badResult,'DENIED','captured denial '+String(key));
}
assert.match(source,/out\.length\s*>\s*262144/, 'explicit independent output byte cap'); count++;
// The observer never substitutes a validator: the actual approved dependency runs.
{ const a=fixture();let calls=0;const c=load(source, value=>{calls++;assert.notEqual(value.priceGroups,a.priceGroups);assert.notEqual(value.priceGroups[0],a.priceGroups[0]);assert.deepEqual({...value.priceGroups[0]},a.priceGroups[0]);});eq(c(a),expected(a),'same detached vector sent to real dependency');eq(calls,1,'one group validation'); }
{ const a=fixture();const c=load(source,()=>{a.dialingCode='44';});eq(c(a),'DENIED','ancestor change during dependency'); }
{ const a=fixture(), before=Object.getOwnPropertyDescriptors(a), groupBefore=Object.getOwnPropertyDescriptors(a.priceGroups[0]);eq(candidate(a),expected(a),'no mutation baseline');assert.deepEqual(Object.getOwnPropertyDescriptors(a),before);assert.deepEqual(Object.getOwnPropertyDescriptors(a.priceGroups[0]),groupBefore);count+=2;eq(Object.isFrozen(a),false,'no caller freeze'); }
for(const key of scalarFields) {
 const a=fixture(), value=key==='checkIn'?'2026-09-04':key==='checkOut'?'2026-09-08':key==='pricingQuoteToken'?'z.'+'B'.repeat(43):key==='guestPhone'?'222':key==='dialingCode'?'44':a[key]+'X';
 a[key]=value;eq(candidate(a),expected(a),'every scalar bound '+key);assert.notEqual(candidate(a),candidate(fixture()));count++;
}
const groupVectors=[[{roomCode:'adventure_suite',quantity:1,guests:2},{roomCode:'adventure_suite',quantity:2,guests:2}],[{roomCode:'adventure_suite',quantity:3,guests:2}],[{roomCode:'two_bedroom_apartment',quantity:1,guests:3},{roomCode:'penthouse_apartment',quantity:1,guests:2}],[{roomCode:'penthouse_apartment',quantity:1,guests:2},{roomCode:'two_bedroom_apartment',quantity:1,guests:4}]];
for(const priceGroups of groupVectors) {const a={...fixture(),priceGroups};eq(candidate(a),expected(a),'original boundaries order occupancy');}
for(const [key,values] of [['quantity',[0,5,'1',NaN,Infinity,1.5]],['guests',[1,3,'2',null]],['roomCode',['suite','ADVENTURE_SUITE',null,'adventure_suite\ud800']]]) for(const value of values){const a=fixture();a.priceGroups[0][key]=value;eq(candidate(a),'DENIED','actual group denial');}
for(let mask=1;mask<16;mask++) {const a=fixture();['guestName','guestEmail','guestPhone','dialingCode'].forEach((k,i)=>{if(mask&(1<<i))delete a[k];});eq(candidate(a),'DENIED','all contact missing combinations');}
{const a={...fixture(),note:'literal \\n \\t \\u2028 " /'};eq(candidate(a),expected(a),'literal escape sequences not double interpreted');}
// Exact static dependency/export and disconnected production scan.
eq((source.match(/\bimport\b/g)||[]).length,1,'one static import');assert.ok(source.includes(approvedImport));count++;
eq((source.match(/\bexport\b/g)||[]).length,1,'one named export');assert.match(source,/export function canonicalizeGuestBookingPurchaseInput\(input\)/);count++;
const executable=source.replace(/\/\/[^\n]*/g,'').replace(approvedImport,'');
assert.doesNotMatch(executable,/\b(?:require|import|async|await|fetch|console|process|Date|crypto|setTimeout|setInterval|prepareBootstrap|verified)\b|Math\.random/);count++;
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const f of walk(path.join(root,'velo')).filter(f=>/\.(?:js|jsw)$/.test(f)&&f!==file)) {assert.doesNotMatch(fs.readFileSync(f,'utf8'),/guestBookingPurchaseInput/,'disconnected '+path.relative(root,f));count++;}
// Current scalar caps make the independent transport ceiling unreachable.
const reduced=load(source.replace('out.length > 262144','out.length > '+expected(fixture()).length));eq(reduced(fixture()),expected(fixture()),'output exact budget');eq(reduced({...fixture(),note:'x'}),'DENIED','output budget +1 via reduced-budget probe');
// Named causal mutants execute actual altered code against an explicit witness.
const mutantSpecs=[
 ['dialing omitted','stringify(a.dialingCode)',"stringify('')",()=>({...fixture(),dialingCode:'44'})],
 ['note omitted','stringify(a.note)',"stringify('')",()=>({...fixture(),note:'note'})],
 ['attribution omitted','stringify(a.msclkid)',"stringify('')",()=>({...fixture(),msclkid:'literal'})],
 ['case normalization','stringify(a.guestEmail)','stringify(a.guestEmail.toLowerCase())',fixture],
 ['name cap bypass','a[fields[i]].length > caps[i]','false',()=>({...fixture(),guestName:'a'.repeat(257)}),'DENIED'],
 ['surrogate bypass',"!unicode(a[fields[i]],fields[i] === 'note')",'false',()=>({...fixture(),guestName:'\ud800'}),'DENIED'],
 ['nonASCII unescaped','c>=32 && c<=126','c>=32',()=>({...fixture(),guestName:'é'})],
 ['leap century bypass','y%4===0 && (y%100!==0 || y%400===0)','y%4===0',()=>({...fixture(),checkIn:'1900-02-29',checkOut:'1900-03-01'}),'DENIED'],
 ['equal checkout admitted','end<=start','end<start',()=>({...fixture(),checkOut:fixture().checkIn}),'DENIED'],
 ['token length bypass','{43}','{42,44}',()=>({...fixture(),pricingQuoteToken:'a.'+'A'.repeat(42)}),'DENIED'],
 ['extra key bypass','const ownKeys = Reflect.ownKeys;',"const ownKeys = value => Reflect.ownKeys(value).filter(k=>k!=='consent');",()=>({...fixture(),consent:true}),'DENIED'],
 ['group failure bypass',"if (groups === 'DENIED') return 'DENIED';",'',()=>({...fixture(),priceGroups:[{roomCode:'adventure_suite',quantity:4,guests:2}]}),'DENIED'],
 ['journal bypass',"for (let i=0;i<journal.length;i++) if (!stable(journal[i])) return 'DENIED';",'',()=>{const a=fixture();a.priceGroups[0]=new Proxy(a.priceGroups[0],{ownKeys(t){a.dialingCode='44';return Reflect.ownKeys(t);}});return a;},'DENIED'],
 ['group vector reversed','priceGroups:detached','priceGroups:detached.reverse()',()=>({...fixture(),priceGroups:groupVectors[2]})]
];
let killed=0;
for(const [name,from,to,make,denial] of mutantSpecs) {
 eq(source.split(from).length,2,'unique mutant edit '+name);
 const original=make(), want=denial||expected(original);eq(candidate(original),want,'real witness '+name);
 const mutant=load(source.replace(from,to));let result;assert.doesNotThrow(()=>{result=mutant(make());},'mutant executable '+name);
 assert.notEqual(result,want,'causal mutant killed '+name);count++;killed++;
}
// Live group alias mutant is detected by observation, while the real validator still runs.
{const a=fixture();let detached;const m=load(source.replace('priceGroups:detached','priceGroups:a.priceGroups'),v=>{detached=v.priceGroups!==a.priceGroups;});eq(m(a),expected(a),'live alias mutant still executable');eq(detached,false,'causal live alias exposed');killed++;}
// Reduced output budget tests its branch; deleting that branch must defeat denial.
{const text=source.replace('out.length > 262144','out.length > '+expected(fixture()).length);const m=load(text.replace("return out.length > "+expected(fixture()).length+" ? 'DENIED' : out;",'return out;'));assert.notEqual(m({...fixture(),note:'x'}),'DENIED');count++;killed++;}
// One populated purchase exercises every tuple position simultaneously.
{const a={...fixture(),packageId:' Package-é ',promoCode:' Promo ',guestName:'Zoë e\u0301 😀',guestEmail:'Ü@例.test',guestPhone:'+12345',dialingCode:'44',note:'"\\\t\r\n<script>😀',marketSource:' Referral ',gclid:' G+%2F ',gbraid:'β',wbraid:'x/y',msclkid:'Case',priceGroups:groupVectors[2]};eq(candidate(a),expected(a),'complete populated exact vector');assert.match(candidate(a),/^[\x20-\x7e]+$/);count++;assert.deepEqual(JSON.parse(candidate(a)),JSON.parse(expected(a)));count++;}
// Bounded exhaustive control code points; prepend @ to avoid an unrelated email gate.
for(const key of ['guestName','guestEmail','packageId','promoCode','marketSource','gclid','gbraid','wbraid','msclkid','note']) for(let c=0;c<=159;c++) if(c<32||c>=127) {const a={...fixture(),[key]:'@'+String.fromCharCode(c)};eq(candidate(a),key==='note'&&[9,10,13].includes(c)?expected(a):'DENIED','control point '+key+':'+c);}
{const a=fixture();for(const key of ['guestName','guestEmail','packageId','promoCode','marketSource','gclid','gbraid','wbraid','msclkid','note'])a[key]=(key==='guestEmail'?'@':'é')+'é'.repeat(caps[key]-1);a.pricingQuoteToken='a'.repeat(16340)+'.'+'A'.repeat(43);eq(candidate(a),expected(a),'max Unicode resource vector');assert.ok(candidate(a).length<262144);count++;}
for(const [object,key] of [[Object.prototype,'guestName'],[Object.prototype,'value'],[Array.prototype,'0']]) {
 const a=fixture(),want=expected(a),define=Object.defineProperty,saved=Object.getOwnPropertyDescriptor(object,key);let got,hits=0;const d=Object.create(null);d.configurable=true;d.get=()=>{hits++;throw Error('inherited hook');};d.set=()=>{hits++;throw Error('inherited setter');};
 try{define(object,key,d);got=candidate(a);}finally{if(saved)define(object,key,saved);else delete object[key];}
 eq(got,want,'private own inert slots '+String(key));eq(hits,0,'inherited hook not called');
}
console.log(`purchase input: ${count} counted assertions passed; ${killed} causal named mutants killed (observer assertions additional)`);
