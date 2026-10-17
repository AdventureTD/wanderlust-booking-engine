'use strict';
// BookingSummary security remediation: capability-gated server operations replace
// the guest page's public BookingSummary read/full-row update. Offline only:
// fake wix-data/secrets/fetch, inert strings, no network, no real data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const SECRET='INERT_PRICING_SECRET_NOT_LIVE_0123456789';

function world(o={}){
 const rows=new Map(),writes=[],wires=[],logs=[];let now=o.now||Date.parse('2027-01-01T12:00:00Z');
 const copy=structuredClone;
 const sdk={
  query(c){assert.equal(c,'BookingSummary');const f=[];let cap=1000;return {eq(k,v){f.push(r=>r[k]===v);return this;},limit(n){cap=n;return this;},async find(opt){assert.equal(opt&&opt.suppressAuth,true,'server reads use suppressAuth');return {items:[...rows.values()].filter(r=>f.every(x=>x(r))).slice(0,cap).map(r=>copy(r))};}};},
  async update(c,row,opt){assert.equal(c,'BookingSummary');assert.equal(opt&&opt.suppressAuth,true);assert.ok(rows.has(row._id),'update existing row only');writes.push(copy(row));rows.set(row._id,copy(row));return copy(row);},
  async insert(){throw Error('UNEXPECTED_INSERT');},async remove(){throw Error('UNEXPECTED_REMOVE');}
 };
 class FakeDate extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const context=vm.createContext({Date:FakeDate,Buffer,URLSearchParams,console:Object.fromEntries(['log','warn','error','info','debug'].map(k=>[k,(...a)=>logs.push({level:k,a})]))});
 const external={
  ...require('./summary-patch-fake.cjs').makeDataItemsFake({get:(c,id)=>{assert.equal(c,'BookingSummary');return rows.get(id);},set:(c,id,row)=>{writes.push(copy(row));rows.set(id,copy(row));}}).externals,
  'crypto':{default:crypto},'wix-data':{default:sdk},
  'wix-web-module':{Permissions:{Anyone:'Anyone',Admin:'Admin'},webMethod:(perm,fn)=>{fn.permission=perm;return fn;}},
  'wix-secrets-backend':{getSecret:async n=>n==='WBE_PRICING_QUOTE_SECRET'?(o.secret===undefined?SECRET:o.secret):'INERT_ONLY'},
  'backend/settings.web':{getAllSettings:async()=>({suspendMicrosoftAds:'0'})},
  'libphonenumber-js/max':{parsePhoneNumberFromString:(s,opt)=>require('libphonenumber-js/max').parsePhoneNumberFromString(s,JSON.parse(JSON.stringify(opt)))},
  'wix-fetch':{fetch:async(url,opt)=>{
   if(url==='https://login.microsoftonline.com/common/oauth2/v2.0/token')return {ok:true,text:async()=>JSON.stringify({access_token:'INERT_TOKEN',expires_in:3600})};
   assert.equal(url,'https://bingads.microsoft.com/Api/Advertiser/CampaignManagement/v13/OfflineConversion/ApplyOfflineConversions');
   wires.push(opt.body);const r=o.msResponse||{status:200,body:'{"PartialErrors":[]}'};return {ok:r.status<300,status:r.status,text:async()=>r.body};}}
 };
 const allowed=new Set(['backend/bookingSummaryCapability','backend/bookingSummaryReporting.web','backend/microsoftAdsConversions.web','backend/hashUtils.web','public/phoneNormalization','backend/bookingSummaryWriter']);
 const cache=new Map();
 function load(s){if(cache.has(s))return cache.get(s);let m;const e=external[s];
  if(e)m=new vm.SyntheticModule(Object.keys(e),function(){for(const k of Object.keys(e))this.setExport(k,e[k]);},{context});
  else{assert.ok(allowed.has(s),'unadmitted '+s);m=new vm.SourceTextModule(read('velo/'+s+'.js'),{context,identifier:s});}
  cache.set(s,m);return m;}
 async function mod(s){const m=load(s);if(m.status==='unlinked')await m.link(load);if(m.status==='linked')await m.evaluate();return m.namespace;}
 const seed=(id,bn,extra={})=>rows.set(id,{_id:id,bookingNumber:bn,guestName:'Inert Guest',guestEmail:'inert@example.invalid',guestPhone:'2025550100',notes:'INERT_NOTE',grandTotal:123.45,status:'confirmed',
  gclid:'INERT_G',gbraid:'',wbraid:'',msclkid:'INERT_MS',firstPaidTouch:{capturedAt:'2026-12-31T00:00:00.000Z',gclid:'INERT_G',gbraid:'',wbraid:'',msclkid:''},latestPaidTouch:{capturedAt:'2027-01-01T00:00:00.000Z',gclid:'',gbraid:'',wbraid:'',msclkid:'INERT_MS'},
  googleConversionUploaded:false,microsoftConversionUploaded:false,...extra});
 return {rows,writes,wires,logs,mod,seed,advance:ms=>{now+=ms;},get now(){return now;}};
}
const flip=t=>t.slice(0,-1)+(t.endsWith('A')?'B':'A');

test('mint/verify round trip; clear-only refresh changes exactly the six reporting fields and returns no row data',async()=>{
 const w=world();w.seed('INERT_S1','WC-1001');const cap=await w.mod('backend/bookingSummaryCapability'),rep=await w.mod('backend/bookingSummaryReporting.web');
 assert.equal(rep.clearBookingSummaryReporting.permission,'Anyone');
 const token=await cap.mintSummaryCapability('WC-1001','INERT_S1');assert.match(token,/^bsc1\.\d{13}\.[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
 const before=structuredClone(w.rows.get('INERT_S1'));
 const result=await rep.clearBookingSummaryReporting('WC-1001',token,{guestEmail:'attacker@example.invalid',microsoftConversionUploaded:true,notes:'INJECTED'});
 assert.equal(JSON.stringify(result),'{"ok":true}');
 const after=w.rows.get('INERT_S1');
 for(const k of Object.keys(before)){if(['gclid','gbraid','wbraid','msclkid','firstPaidTouch','latestPaidTouch'].includes(k))continue;assert.deepEqual(after[k],before[k],k+' untouched');}
 assert.deepEqual([after.gclid,after.gbraid,after.wbraid,after.msclkid,after.firstPaidTouch,after.latestPaidTouch],['','','','',null,null]);
 assert.equal(Object.keys(after).length,Object.keys(before).length,'no caller-chosen fields written');
 assert.equal(JSON.stringify(w.logs).includes(token),false,'capability never logged');
});

test('missing/wrong/malformed/forged/cross-booking/recreated-row/duplicate/expired capabilities are denied without any write',async()=>{
 const w=world();w.seed('INERT_A','WC-2001');w.seed('INERT_B','WC-2002');
 const cap=await w.mod('backend/bookingSummaryCapability'),rep=await w.mod('backend/bookingSummaryReporting.web');
 const a=await cap.mintSummaryCapability('WC-2001','INERT_A'),b=await cap.mintSummaryCapability('WC-2002','INERT_B');
 const [p,exp,nonce,mac]=a.split('.');
 const cases=[['missing',['WC-2001']],['empty',['WC-2001','']],['object',['WC-2001',{toString:()=>a}]],['number',['WC-2001',1]],['array',['WC-2001',[a]]],
  ['bookingNumber only',['WC-2001',undefined]],['no bookingNumber',[undefined,a]],['bad bookingNumber chars',["WC-2001' OR 1",a]],
  ['flipped mac',['WC-2001',flip(a)]],['wrong prefix',['WC-2001','bsc2.'+[exp,nonce,mac].join('.')]],['short mac',['WC-2001',a.slice(0,-2)]],
  ['forged later expiry',['WC-2001',[p,String(Number(exp)+60000),nonce,mac].join('.')]],['forged far expiry',['WC-2001',[p,String(Number(exp)+86400000),nonce,mac].join('.')]],
  ['changed nonce',['WC-2001',[p,exp,'0'.repeat(32),mac].join('.')]],['cross-booking token',['WC-2001',b]],['cross-booking reverse',['WC-2002',a]],
  ['appended junk',['WC-2001',a+'x']],['whitespace',['WC-2001',' '+a]]];
 for(const [label,args] of cases){const r=await rep.clearBookingSummaryReporting(...args);assert.equal(JSON.stringify(r),'{"ok":false,"reasonCode":"CAPABILITY_DENIED"}',label);}
 assert.equal(w.writes.length,0,'no write on any denial');
 // Row recreated with a new _id for the same bookingNumber: old capability is bound to the old row.
 w.rows.delete('INERT_A');w.seed('INERT_A2','WC-2001');
 assert.equal((await rep.clearBookingSummaryReporting('WC-2001',a)).ok,false,'recreated row');
 // Duplicate Summary rows for one bookingNumber: ambiguous, denied.
 const c=await cap.mintSummaryCapability('WC-2001','INERT_A2');w.seed('INERT_A3','WC-2001');
 assert.equal((await rep.clearBookingSummaryReporting('WC-2001',c)).ok,false,'duplicate rows');
 w.rows.delete('INERT_A3');assert.equal((await rep.clearBookingSummaryReporting('WC-2001',c)).ok,true,'positive control after ambiguity removed');
 // Expiry (30 min TTL).
 const d=await cap.mintSummaryCapability('WC-2002','INERT_B');w.advance(30*60*1000+1);
 assert.equal((await rep.clearBookingSummaryReporting('WC-2002',d)).ok,false,'expired');
 assert.equal(w.writes.length,1,'only the positive control wrote');
});

test('missing or short HMAC secret fails closed: no capability minted, nothing verifies',async()=>{
 for(const secret of ['','short-secret',null]){const w=world({secret});w.seed('INERT_S','WC-3001');const cap=await w.mod('backend/bookingSummaryCapability');
  assert.equal(await cap.mintSummaryCapability('WC-3001','INERT_S'),'');}
 const good=world();good.seed('INERT_S','WC-3001');const token=await (await good.mod('backend/bookingSummaryCapability')).mintSummaryCapability('WC-3001','INERT_S');
 const other=world({secret:'A_DIFFERENT_INERT_SECRET_0123456789abcdef'});other.seed('INERT_S','WC-3001');
 assert.equal(await (await other.mod('backend/bookingSummaryCapability')).verifySummaryCapability('WC-3001',token),null,'other secret');
 const missing=world({secret:''});missing.seed('INERT_S','WC-3001');
 assert.equal(await (await missing.mod('backend/bookingSummaryCapability')).verifySummaryCapability('WC-3001',token),null,'secret missing at verify');
});

test('replay within TTL is limited to the idempotent operation on the bound row; after expiry it is denied',async()=>{
 const w=world();w.seed('INERT_R','WC-4001');const cap=await w.mod('backend/bookingSummaryCapability'),rep=await w.mod('backend/bookingSummaryReporting.web');
 const t=await cap.mintSummaryCapability('WC-4001','INERT_R');
 assert.equal((await rep.clearBookingSummaryReporting('WC-4001',t)).ok,true);const once=structuredClone(w.rows.get('INERT_R'));
 assert.equal((await rep.clearBookingSummaryReporting('WC-4001',t)).ok,true);assert.deepEqual(w.rows.get('INERT_R'),once,'replay is a no-op on state');
 w.advance(31*60*1000);assert.equal((await rep.clearBookingSummaryReporting('WC-4001',t)).ok,false);
 assert.equal(w.writes.length,2);
});

for(const c of [
 {label:'confirmed success + bound capability marks flag',cap:'own',resp:{status:200,body:'{"PartialErrors":[]}'},ok:true,flag:true},
 {label:'null PartialErrors marks flag',cap:'own',resp:{status:200,body:'{"PartialErrors":null}'},ok:true,flag:true},
 {label:'no capability: upload unchanged, flag not marked',cap:'none',resp:{status:200,body:'{"PartialErrors":[]}'},ok:true,flag:false},
 {label:'forged capability',cap:'forged',resp:{status:200,body:'{"PartialErrors":[]}'},ok:true,flag:false},
 {label:'capability for another booking',cap:'other',resp:{status:200,body:'{"PartialErrors":[]}'},ok:true,flag:false},
 {label:'partial error is not confirmation',cap:'own',resp:{status:200,body:'{"PartialErrors":[{"Code":1}]}'},ok:true,flag:false},
 {label:'non-JSON body is not confirmation',cap:'own',resp:{status:200,body:'INERT_NOT_JSON'},ok:true,flag:false},
 {label:'HTTP failure never marks',cap:'own',resp:{status:500,body:'{}'},ok:false,flag:false}
]) test('Microsoft status flag: '+c.label,async()=>{
 const w=world({msResponse:c.resp});w.seed('INERT_M','WC-5001');w.seed('INERT_O','WC-5002');
 const cap=await w.mod('backend/bookingSummaryCapability'),ms=await w.mod('backend/microsoftAdsConversions.web');
 const own=await cap.mintSummaryCapability('WC-5001','INERT_M'),other=await cap.mintSummaryCapability('WC-5002','INERT_O');
 const summaryCapability={own,other,forged:flip(own),none:undefined}[c.cap];
 const input={summaryCapability,transactionId:'WC-5001',value:10,currency:'USD',msclkid:'INERT_MS',email:'inert@example.invalid',phone:'2025550100',firstName:'Inert',lastName:'Guest',conversionTime:'2027-01-01T00:00:00Z'};
 const r=await ms.recordMicrosoftBookingConversion(input);
 assert.equal(r.ok,c.ok);assert.equal(w.rows.get('INERT_M').microsoftConversionUploaded,c.flag);assert.equal(w.rows.get('INERT_O').microsoftConversionUploaded,false,'never another row');
 assert.equal(w.writes.every(x=>x._id==='INERT_M'),true);
 for(const x of w.writes){const before=w.rows.get('INERT_M');assert.equal(x.guestEmail,'inert@example.invalid');assert.equal(x.notes,'INERT_NOTE');}
 if(summaryCapability){assert.equal(w.wires.join('').includes(summaryCapability),false,'capability not sent to Microsoft');
  assert.equal(JSON.stringify(w.logs).includes(summaryCapability),false,'capability not logged');assert.equal(JSON.stringify(r).includes(summaryCapability),false,'capability not returned');}
 assert.equal(w.wires.length,1);
});

test('static: no frontend file touches BookingSummary or writes any collection; client reads are a literal allowlist',()=>{
 const files=['velo/masterPage.js',...fs.readdirSync(path.join(root,'velo')).filter(f=>/^page-.*\.js$/.test(f)).map(f=>'velo/'+f),...fs.readdirSync(path.join(root,'velo/public')).filter(f=>f.endsWith('.js')).map(f=>'velo/public/'+f)];
 assert.ok(files.includes('velo/page-booking-summary.js'));
 for(const f of files){const s=read(f);
  assert.equal(/wixData\s*\.\s*(update|insert|save|remove|bulkInsert|bulkUpdate|bulkSave|bulkRemove|truncate|replaceReferences|insertReference|removeReference)\b/.test(s),false,f+' client data write');
  assert.equal(/wixData[\s\S]{0,40}BookingSummary|BOOKING_SUMMARIES/.test(s),false,f+' client BookingSummary access');
  for(const m of s.matchAll(/wixData\s*\.\s*(\w+)\s*\(\s*([^)]*)\)/g)){assert.equal(m[1],'query',f+' only query');assert.ok(["'Rooms'","'PromoCodes'","'Packages'"].includes(m[2].trim()),f+' literal allowlisted collection '+m[2]);}
  assert.equal(/wix-data\/|@wix\/data/.test(s),false,f+' no alternate data SDK');}
 const page=read('velo/page-booking-summary.js');
 assert.equal((page.match(/summaryCapability/g)||[]).length>=4,true);
 for(const line of page.split(/\r?\n/))if(/console\.(log|warn|error|info|debug)/.test(line))assert.equal(/summaryCapability|conversionCapability/.test(line),false,'capability never in a console call');
});

test('static: capability authority is private and minted only on the fresh first-room gate',()=>{
 const capability=read('velo/backend/bookingSummaryCapability.js'),reporting=read('velo/backend/bookingSummaryReporting.web.js'),availability=read('velo/backend/availability.web.js');
 assert.equal(/webMethod|wix-web-module/.test(capability),false,'private module exposes no web method');
 assert.equal(/export\s+(async\s+)?function|export\s+const\s+\w+\s*=\s*(?!webMethod)/.test(reporting.replace(/export const clearBookingSummaryReporting = webMethod\(/,'')),false,'web module exports only webMethods');
 assert.equal((reporting.match(/webMethod\(/g)||[]).length,1);assert.ok(/mintSummaryCapability|markMicrosoftConversionUploaded/.test(reporting)===false,'no mint/mark exposure');
 const gate=availability.indexOf("if (!providedBookingNumber && newlyAllocatedNumber && bookingRoomRows.items.length === 0 &&"),close=availability.indexOf("console.log('>>> SERVER createBooking complete.",gate);
 const mint=availability.indexOf('mintSummaryCapability(inserted.bookingNumber');assert.ok(gate>0&&mint>gate&&mint<close,'mint inside the fresh-allocation gate');
 assert.equal((availability.match(/mintSummaryCapability\(/g)||[]).length,1);
 for(const line of availability.split(/\r?\n/))if(/console\.(log|warn|error)/.test(line))assert.equal(/summaryCapability|conversionCapability/.test(line),false);
});

// End-to-end preservation through the actual Summary page, actual createBooking,
// actual Summary writer, draft invoice and Google journal (offline producer).
function support(file,boundary,name){const source=read('tests/'+file),i=source.indexOf(boundary);assert.ok(i>0);const box={require,__dirname,console,structuredClone,Buffer,URL,URLSearchParams,Date,setTimeout,clearTimeout};vm.runInNewContext(source.slice(0,i)+'\nthis.factory='+name+';',box);return box.factory;}
for(const withdraw of [false,true])test('actual page/createBooking preserve notes, multi-room, invoice, attribution, Google and Microsoft flows with no client BookingSummary access'+(withdraw?' (withdrawal after first room)':''),{timeout:10000},async()=>{
 const {fixture}=require('./attribution-clock-v2.cjs');
 const producer=support('google-ads-fresh-producer.cjs','function support','producer'),pageFactory=support('attribution-hotfix.cjs','function bookingBackend','page');
 const first={capturedAt:new Date(Date.now()-86400000).toISOString(),gclid:'INERT_FIRST',gbraid:'',wbraid:'',msclkid:'INERT_FIRST_MS'};
 const bridge=await fixture({query:'msclkid=INERT_LATEST_MS',pageStorage:[['wl_click_attribution',JSON.stringify(first)]]});
 try{
  const f=await producer();let count=0,client=0,upload,msCalls=[];const results=[];
  const page=await pageFactory({setup:"_summaryRooms=[{roomCode:'adventure_suite',qty:1,numGuests:2},{roomCode:'two_bedroom_apartment',qty:1,numGuests:3}];_selectedPackageId='INERT_PACKAGE';_pricingQuoteToken="+JSON.stringify(f.quote.token)+';',
   book:async p=>{const r=await f.availability.createBooking(p);results.push(r);if(++count===1&&withdraw){bridge.head.window.dataLayer.push(['consent','update',{ad_user_data:'denied'}]);await new Promise(x=>setTimeout(x,20));}return r;}});
  page.w('#bookingNotes').value='INERT GUEST NOTE';
  page.c.waitForClickAttribution=bridge.api.waitForClickAttribution;page.c.getStoredClickIds=bridge.api.getStoredClickIds;page.c.clearClickIds=bridge.api.clearClickIds;
  page.c.wixData={query(c){if(c==='BookingSummary'){client++;throw Error('FORBIDDEN');}return f.sdk.query(c);},update(){client++;throw Error('FORBIDDEN');},insert(){client++;throw Error('FORBIDDEN');}};
  page.c.clearBookingSummaryReporting=f.reporting.clearBookingSummaryReporting;
  page.c.recordBookingConversion=p=>{upload=f.sender.recordBookingConversion(p);return upload;};
  const verify=f.cache.get('backend/bookingSummaryCapability').namespace.verifySummaryCapability;
  page.c.recordMicrosoftBookingConversion=async p=>{msCalls.push({bound:!!(await verify(p.transactionId,p.summaryCapability)),msclkid:p.msclkid});return {ok:true};};
  await page.click();if(upload)await upload;for(let i=0;i<40;i++)await Promise.resolve();await bridge.settle();
  assert.equal(client,0,'no client BookingSummary access');
  assert.equal(typeof results[0].summaryCapability,'string');assert.ok(results[0].summaryCapability);assert.equal(results[1].summaryCapability,undefined,'no capability for an additional-room call');
  const summaries=[...f.rows].filter(([k])=>k.startsWith('BookingSummary:')).map(([,v])=>v);assert.equal(summaries.length,1);const s=summaries[0];
  assert.equal(s.notes,'INERT GUEST NOTE','notes persisted by createBooking');assert.equal(s.roomCount,2,'multi-room aggregate');
  assert.equal([...f.rows.keys()].filter(k=>k.startsWith('Bookings:')).length,2);
  assert.ok([...f.rows.keys()].some(k=>k.startsWith('BookingInvoices:')),'draft invoice created');assert.equal(page.invoices.length,1,'invoice issuance requested');
  if(!withdraw){
   assert.equal(s.gclid,'INERT_FIRST');assert.equal(s.firstPaidTouch.gclid,'INERT_FIRST');assert.equal(s.latestPaidTouch.msclkid,'INERT_LATEST_MS');
   assert.equal(f.wires.length,1,'Google upload unchanged');assert.equal(s.googleConversionUploaded,true);
   assert.equal(msCalls.length,1);assert.equal(msCalls[0].bound,true,'Microsoft call carries a capability bound to this Summary row');
  } else {
   assert.equal(s.gclid,'');assert.equal(s.msclkid,'');assert.equal(s.firstPaidTouch,null);assert.equal(s.latestPaidTouch,null,'withdrawal clears reporting via capability');
   assert.equal(f.wires.length,0);assert.equal(msCalls.length,0);
  }
 }finally{bridge.close();}
});
