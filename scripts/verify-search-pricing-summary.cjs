'use strict';
// Finite actual-page slices only. No imports, onReady, backend or other suites execute.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'velo/page-booking-search.js'), 'utf8').replace(/\r\n/g,'\n');
const summary = fs.readFileSync(path.join(root, 'velo/page-booking-summary.js'), 'utf8').replace(/\r\n/g,'\n');
function slice(s, a, b) { const i=s.indexOf(a), j=s.indexOf(b,i); assert(i>=0 && j>i); return s.slice(i,j); }
function setup() {
  const elements = new Map(), calls=[], links=[], storage=new Map();
  function el(id) { if (!elements.has(id)) elements.set(id,{text:'',show(){},hide(){},expand(){},collapse(){},onItemReady(){},forEachItem(){}}); return elements.get(id); }
  let response = (id,ci,co)=>({token:'inert:'+ci+':'+co,quote:{packageId:id,checkIn:ci,checkOut:co,nights:(Date.parse(co)-Date.parse(ci))/86400000},pricing:{totalPerPerson:123.45,averageNightlyRate:30.8625}});
  let packageResponse=async n=>[{_id:'pkg'+n,title:'Package'}];
  const bindings = {plainTextFromHtml:s=>s||'',tryFind:el,$w:id=>el(id.slice(1)),console:{log(){},error(){}},setTimeout(){},safeText:t=>{el('statusText').text=t;},getPackagesByNights:n=>packageResponse(n),createPricingQuote:async (...args)=>{calls.push(JSON.parse(JSON.stringify(args)));return response(...args);},localStorage:{setItem:(k,v)=>storage.set(k,v)},wixLocation:{to:u=>links.push(u)},summaryUrl:'/summary'};
  const code = slice(source,'let _selections', 'function safeItem') +
    slice(source,'function safeItem','function tryFind') +
    slice(source,'function loadPackageOptions','function hideSearchHeader') +
    slice(source,'function pickerCalendarDate','function parseDate') +
    '\nfunction submit(){'+slice(source,"      console.log('>>> btnSummary clicked');",'    });\n  }')+'}\n'+
    '\nfunction register(){'+slice(source,"  const rep = tryFind('searchResultsRepeater');\n  if (rep && typeof rep.onItemReady",'  function hideIfFound')+'}\n'+
    'return {register,clearSelections,loadPackageOptions,setRoomSelection,submit, state:()=>({_selections,_selectedPackage,_summaryNights}), init:(ci,co,rows)=>{_searchCheckIn=ci;_searchCheckOut=co;_summaryNights=4;tryFind("searchResultsRepeater").data=rows;}};';
  const api=vm.compileFunction(code,Object.keys(bindings))(...Object.values(bindings));
  return {api,el,calls,links,storage,setResponse:r=>{response=r;},setPackages:r=>{packageResponse=r;}};
}
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}
const tests={};
tests.P01=async()=>{
 const h=setup(); h.api.init(new Date(2027,10,5),new Date(2027,10,9),[]);
 h.api.loadPackageOptions(4);await settle();
 assert.deepEqual(h.calls,[['pkg4','2027-11-05','2027-11-09']]);
 assert.equal(h.el('nightsText').text,'4 nights');assert.equal(h.el('packagePrice').text,'$123.45');
};
function row(code,ci='2027-11-05',co='2027-11-09',maxQty=1){return {roomCode:code,maxQty,status:'full',availableCheckIn:ci+'T00:00:00.000Z',availableCheckOut:co+'T00:00:00.000Z',availableNights:(Date.parse(co)-Date.parse(ci))/86400000};}
function select(h,r,qty){return h.api.setRoomSelection(r.roomCode,r.roomCode,qty,2,r.availableCheckIn,r.availableCheckOut,10);}
tests.P02=async()=>{
 const h=setup(),r=row('penthouse_apartment','2027-03-14','2027-03-18');r.status='partial';
 h.api.init(new Date(2027,2,12),new Date(2027,2,18),[r]);h.api.loadPackageOptions(6);await settle();
 select(h,r,1);await settle();h.api.submit();
 assert.deepEqual(h.calls.at(-1),['pkg4','2027-03-14','2027-03-18']);
 assert.equal(h.api.state()._summaryNights,4);assert.equal(h.el('nightsText').text,'4 nights');
 assert.equal(h.el('penthouseFee').text,'$40.00');assert.equal(h.el('finalTotal').text,'$286.90','selected total refreshes after asynchronous quote');
 const u=new URL(h.links.at(-1),'https://inert.invalid');assert.equal(u.searchParams.get('ci'),'2027-03-14');assert.equal(u.searchParams.get('co'),'2027-03-18');assert.equal(u.searchParams.get('quote'),'inert:2027-03-14:2027-03-18');
 assert.equal(h.storage.get('_wbe_ci'),'2027-03-14');
};
tests.P03=async()=>{
 const h=setup(),a=row('adventure_suite',undefined,undefined,3),p=row('penthouse_apartment'),t=row('two_bedroom_apartment');
 h.api.init(new Date(2027,10,5),new Date(2027,10,9),[a,p,t]);
 select(h,a,3);select(h,p,1);select(h,t,1);assert.equal(h.api.state()._selections.reduce((n,s)=>n+s.qty,0),4,'cart cap');
 for(const qty of [4,1.5,NaN,-1,'2']) {select(h,a,qty);assert.equal(h.api.state()._selections[0].qty,3,'actual max / integer');}
 const k=setup(),partial=row('two_bedroom_apartment','2027-11-06','2027-11-10');
 k.api.init(new Date(2027,10,5),new Date(2027,10,9),[a,p,partial]);
 select(k,a,1);await settle();select(k,p,1);await settle();
 assert.equal(k.api.state()._selections.length,2,'matching interval accepted below cap');
 const before=structuredClone(k.api.state()._selections);
 assert.equal(select(k,partial,1),false,'mixed interval guard denies otherwise admissible third room');
 assert.equal(k.el('statusText').text,'Please select rooms for the same available dates. Remove the other rooms to choose this stay.');
 assert.deepEqual(k.api.state()._selections,before);assert.equal(k.links.length,0);assert.equal(k.storage.size,0);
};
tests.P04=async()=>{
 const h=setup(),r=row('adventure_suite',undefined,undefined,3);h.api.init(new Date(2027,10,5),new Date(2027,10,9),[r]);
 let ready;h.el('searchResultsRepeater').onItemReady=fn=>{ready=fn;};h.api.register();
 const items=new Map();const item=id=>{if(!items.has(id))items.set(id,{value:'',show(){this.visible=true;},hide(){this.visible=false;},expand(){},collapse(){},enable(){},onChange(fn){this.change=fn;}});return items.get(id);};ready(item,r);
 const dd=item('#roomQtyDropdown');assert.deepEqual(dd.options.map(o=>o.value),['0','1','2','3']);
 for(const value of ['1.5','4','2junk','-1']){dd.value=value;dd.change({target:{value}});assert.equal(h.api.state()._selections.length,0,'reject raw invalid dropdown');assert.equal(dd.value,'0');assert.equal(item('#selectedBadge').visible,false);}
 dd.value='3';dd.change({target:{value:'3'}});assert.equal(h.api.state()._selections[0].qty,3);
};
tests.P05=async()=>{
 const h=setup(),r=row('penthouse_apartment');h.api.init(new Date(2027,10,5),new Date(2027,10,9),[r]);
 h.setResponse((id,ci,co)=>({token:'bad',quote:{packageId:id,checkIn:ci,checkOut:co,nights:5},pricing:{totalPerPerson:123.45}}));
 select(h,r,1);await settle();h.api.submit();assert.equal(h.links.length,0,'mismatched nights cannot hand off');assert.equal(h.api.state()._selectedPackage,null);
};
tests.P06=async()=>{
 const h=setup(),r=row('penthouse_apartment','2027-03-14','2027-03-18');h.api.init(new Date(2027,2,12),new Date(2027,2,18),[r]);
 let release;const delayed=new Promise(resolve=>{release=resolve;});
 h.setResponse(async(id,ci,co)=>{if(id==='pkg6')await delayed;return {token:id,quote:{packageId:id,checkIn:ci,checkOut:co,nights:Number(id.slice(3))},pricing:{totalPerPerson:id==='pkg6'?600:400}};});
 h.api.loadPackageOptions(6);await settle();select(h,r,1);await settle();release();await settle();
 assert.equal(h.api.state()._selectedPackage._id,'pkg4','late full quote must not replace partial');assert.equal(h.el('packagePrice').text,'$400.00');assert.equal(h.el('nightsText').text,'4 nights','late full display must not replace partial');
};
tests.P07=async()=>{
 const code=slice(summary,'function parseDateStr','const MONTH_NAMES')+'\n'+
 'return async function(cis,cos,_pricingQuoteToken,_selectedPackageId){let _summaryCis,_summaryCos;'+slice(summary,'  const ciDate = parseDateStr(cis), coDate = parseDateStr(cos);','  const rooms = [];')+
 slice(summary,'        const quote = await readPricingQuote(','        _selectedPackageTitle = quote.packageTitle')+'return {nights};};';
 const calls=[],display={};const run=vm.compileFunction(code,['readPricingQuote','safeText'])(async(...a)=>{calls.push(JSON.parse(JSON.stringify(a)));return {};},(k,v)=>{display[k]=v;});
 for(const [ci,co] of [['2027-11-05','2027-11-09'],['2027-03-14','2027-03-18'],['2027-11-07','2027-11-11'],['2028-02-27','2028-03-02'],['2027-12-29','2028-01-02']]) {
   const h=setup(),r=row('penthouse_apartment',ci,co);const [y,m,d]=ci.split('-').map(Number),[ey,em,ed]=co.split('-').map(Number);
   h.api.init(new Date(y,m-1,d-2),new Date(ey,em-1,ed),[r]);r.status='partial';select(h,r,1);await settle();h.api.submit();
   assert.equal(h.links.length,1);const u=new URL(h.links[0],'https://inert.invalid');const token=u.searchParams.get('quote'),pkg=u.searchParams.get('pkg');
   assert.equal((await run(u.searchParams.get('ci'),u.searchParams.get('co'),token,pkg)).nights,4);
   assert.deepEqual(calls.at(-1),[token,pkg,ci,co]);assert.deepEqual(h.calls.at(-1),[pkg,ci,co]);
   assert.equal(h.el('nightsText').text,'4 nights');assert.equal(display.checkInDisplay,`${m}/${d}/${y}`);assert.equal(display.checkOutDisplay,`${em}/${ed}/${ey}`);
 }
};
tests.P08=async()=>{
 const h=setup(),r=row('penthouse_apartment');h.api.init(new Date(2027,10,5),new Date(2027,10,9),[r]);
 let release;const delayed=new Promise(resolve=>{release=resolve;});h.setResponse(async(id,ci,co)=>{await delayed;return {token:'old',quote:{packageId:id,checkIn:ci,checkOut:co,nights:4},pricing:{totalPerPerson:99}};});
 h.api.loadPackageOptions(4);await settle();h.api.clearSelections(true);release();await settle();assert.equal(h.api.state()._selectedPackage,null,'clear invalidates in-flight quote');
};
tests.P09=async()=>{
 const h=setup(),r=row('penthouse_apartment');h.api.init(new Date(2027,10,5),new Date(2027,10,9),[r]);select(h,r,1);await settle();
 r.maxQty=0;h.api.submit();assert.equal(h.links.length,0,'Summary rechecks current result maximum');
};
function packageClicks(h){
 const rep=h.el('packageRepeater'),live=new Map(),ready=[];let data=[];
 rep.onItemReady=fn=>ready.push(fn);
 rep.forEachItem=fn=>data.forEach((d,i)=>fn(live.get(d._id).item,d,i));
 Object.defineProperty(rep,'data',{get:()=>data,set:rows=>{
  const prior=new Set(live.keys());data=rows;
  for(const id of prior)if(!rows.some(d=>d._id===id))live.delete(id);
  rows.forEach((d,i)=>{if(prior.has(d._id))return;
   const items=new Map();const item=id=>{if(!items.has(id))items.set(id,{text:'',show(){},hide(){},handlers:[],onClick(fn){this.handlers.push(fn);}});return items.get(id);};
   live.set(d._id,{item});ready.forEach(fn=>fn(item,d,i));
  });
 }});
 const click=(index=0)=>{const button=live.get(data[index]._id).item('#packageContainer');return ()=>button.handlers.forEach(fn=>fn());};
 click.item=(id,selector)=>live.get(id).item(selector);click.readyCount=()=>ready.length;
 click.captureReady=(index=0)=>{const d=data[index],item=live.get(d._id).item,callbacks=ready.slice();return ()=>callbacks.forEach(fn=>fn(item,d,index));};
 return click;
}
tests.P10=async()=>{
 const h=setup(),r=row('penthouse_apartment');h.api.init(new Date(2027,10,5),new Date(2027,10,9),[r]);
 const click=packageClicks(h);select(h,r,1);await settle();const oldClick=click();
 h.api.clearSelections(true);oldClick();
 assert.equal(h.api.state()._selectedPackage,null,'old row must not resurrect cleared package');
 h.api.submit();assert.equal(h.links.length,0);assert.equal(h.storage.size,0);
};
tests.P11=async()=>{
 const h=setup(),r=row('penthouse_apartment');h.api.init(new Date(2027,10,5),new Date(2027,10,9),[r]);
 let release;const pending=new Promise(resolve=>{release=resolve;});let count=0;
 h.setPackages(n=>++count===1?pending:Promise.resolve([{_id:'current',title:'Current'}]));
 h.api.loadPackageOptions(4);h.api.loadPackageOptions(4);await settle();
 const current=h.api.state()._selectedPackage;assert.equal(current._id,'current');
 release([{_id:'outdated',title:'Outdated'}]);await settle();
 assert.equal(h.api.state()._selectedPackage,current,'older package list cannot replace current');
 assert.deepEqual(h.calls.map(c=>c[0]),['current'],'older list must not request pricing');
 assert.deepEqual(h.el('packageRepeater').data.map(p=>p._id),['current']);
 select(h,r,1);h.api.submit();assert.equal(h.links.length,1);assert.equal(new URL(h.links[0],'https://inert.invalid').searchParams.get('pkg'),'current');
};
tests.P12=async()=>{
 for(const field of ['packageId','checkIn','checkOut','nights','quote','token'])for(const mode of ['missing','different']){
  const h=setup(),r=row('penthouse_apartment');h.api.init(new Date(2027,10,5),new Date(2027,10,9),[r]);
  h.setResponse((id,ci,co)=>{const result={token:'stale-token',quote:{packageId:id,checkIn:ci,checkOut:co,nights:4},pricing:{totalPerPerson:123.45}};
   const target=['quote','token'].includes(field)?result:result.quote;
   if(mode==='missing')delete target[field];else target[field]=({packageId:'wrong',checkIn:'2027-11-06',checkOut:'2027-11-10',nights:5,quote:null,token:''})[field];return result;});
  select(h,r,1);await settle();h.api.submit();assert.equal(h.api.state()._selectedPackage,null,field+':'+mode);assert.equal(h.links.length,0,field+':zero token navigation');assert.equal(h.storage.size,0,field+':zero stored handoff');
 }
};
tests.P13=async()=>{
 const h=setup(),r=row('penthouse_apartment');h.api.init(new Date(2027,10,5),new Date(2027,10,9),[r]);
 const click=packageClicks(h);h.setPackages(async()=>[{_id:'obsolete',title:'Old'}]);select(h,r,1);await settle();const oldClick=click();
 let release;const pending=new Promise(resolve=>{release=resolve;});h.setPackages(()=>pending);
 h.api.loadPackageOptions(4);oldClick();assert.equal(h.api.state()._selectedPackage,null,'old row denied while same-stay replacement pending');
 h.api.submit();assert.equal(h.links.length,0);assert.equal(h.storage.size,0);
 release([{_id:'pkg4',title:'Refreshed'},{_id:'other',title:'Other'}]);await settle();
 const currentClick=click(1);currentClick();const current=h.api.state()._selectedPackage;assert.equal(current._id,'other','current callback still works');
 oldClick();assert.equal(h.api.state()._selectedPackage,current,'removed old row cannot change refreshed selection');
 h.api.submit();assert.equal(h.links.length,1);
};
tests.P14=async()=>{
 const h=setup(),r=row('penthouse_apartment');h.api.init(new Date(2027,10,5),new Date(2027,10,9),[r]);
 const click=packageClicks(h);let revision=1;
 h.setPackages(async()=>['first','second'].map(_id=>({_id,title:_id+revision})));
 h.setResponse((id,ci,co)=>({token:id+revision,quote:{packageId:id,checkIn:ci,checkOut:co,nights:4},pricing:{totalPerPerson:revision*100+(id==='second'?20:0)}}));
 select(h,r,1);await settle();const retained=click(1),item=click.item('second','#packagePrice'),obsoleteReady=click.captureReady(1);
 assert.equal(item.text,'$120.00');revision=2;h.api.loadPackageOptions(4);retained();
 assert.equal(h.api.state()._selectedPackage,null,'retained click denied while new pricing pending');await settle();
 assert.equal(click.item('second','#packagePrice'),item,'Wix retains the rendered item');
 assert.equal(item.text,'$220.00','retained row price refreshed');
 assert.equal(click.item('second','#packageName2').text,'second2');
 obsoleteReady();assert.equal(item.text,'$220.00','obsolete readiness cannot repaint or rebind a retained row');
 retained();assert.equal(h.api.state()._selectedPackage._id,'second','retained nondefault current click accepted');
 assert.equal(h.el('subTotalBooking').text,'$440.00','selected current price drives the booking subtotal');h.api.submit();
 const u=new URL(h.links[0],'https://inert.invalid');assert.equal(u.searchParams.get('quote'),'second2');assert.equal(u.searchParams.get('ci'),'2027-11-05');assert.equal(u.searchParams.get('co'),'2027-11-09');
 assert.equal(h.storage.get('_wbe_ci'),'2027-11-05');
 revision=3;h.api.loadPackageOptions(4);await settle();
 assert.equal(click.readyCount(),1,'register readiness only once');
 for(const id of ['first','second'])for(const sel of ['#packageContainer','#packageName2','#nightsText','#specialtyTours','#packagePrice'])assert.equal(click.item(id,sel).handlers.length,1,'no accumulated row handlers');
 const removed=retained;h.setPackages(async()=>[{_id:'first',title:'Only'}]);h.api.loadPackageOptions(4);await settle();const current=h.api.state()._selectedPackage;removed();assert.equal(h.api.state()._selectedPackage,current,'removed callback denied');
 h.setPackages(async()=>[{_id:'first',title:'First'},{_id:'second',title:'Recreated'}]);h.api.loadPackageOptions(4);await settle();const recreated=h.api.state()._selectedPackage;removed();assert.equal(h.api.state()._selectedPackage,recreated,'removed callback cannot select recreated same ID');click(1)();assert.equal(h.api.state()._selectedPackage._id,'second');
};
(async()=>{ const ids=process.argv.slice(2);assert(ids.length,'Explicit IDs required');for(const id of ids){assert(tests[id],id);await tests[id]();console.log('PASS '+id);}console.log('COMPLETE '+ids.length);})().catch(e=>{console.error(e);process.exitCode=1;});
