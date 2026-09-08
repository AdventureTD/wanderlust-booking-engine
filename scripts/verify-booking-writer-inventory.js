'use strict';
// Static source only. Never link/evaluate a source module or run application tests.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const mutations = new Set(['insert','update','save','remove','bulkInsert','bulkUpdate','bulkSave','bulkRemove','truncate']);
function tokens(source) {
  const out = [], re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|=>|[^\s]/gy;
  let m;
  while ((m = re.exec(source))) {
    const raw = m[0];
    if (/^\s|^\/\/|^\/\*/.test(raw)) continue;
    if(raw==='/' && (!out.length || ['=','(','[',',',':','!','return','&','|','?'].includes(out[out.length-1].v))) {
      let j=re.lastIndex, inClass=false;
      for(;j<source.length;j++) {
        if(source[j]==='\\') {j++;continue;}
        if(source[j]==='[') inClass=true;
        if(source[j]===']') inClass=false;
        if(source[j]==='/'&&!inClass) {j++;break;}
      }
      while(/[a-z]/i.test(source[j]||'')&&j<source.length) j++;
      re.lastIndex=j;out.push({v:'<regexp>',at:m.index});continue;
    }
    out.push({ v: raw, at: m.index, string: /^['"]/.test(raw), value: /^['"]/.test(raw) && !raw.includes('\\') ? raw.slice(1,-1) : null });
  }
  return out;
}
function scan(source) {
  const t=tokens(source), sites=[], unresolved=[], pairs=new Map(), stack=[], scopes=[];
  for(let i=0;i<t.length;i++) {
    if(['(','[','{'].includes(t[i].v)) stack.push(i);
    if([')',']','}'].includes(t[i].v)) {const j=stack.pop(); pairs.set(j,i);pairs.set(i,j);}
  }
  const root={start:0,end:t.length,bindings:new Map(),name:null}; scopes.push(root);
  for(let i=0;i<t.length;i++) if(t[i].v==='{') scopes.push({start:i,end:pairs.get(i),bindings:new Map(),name:null});
  const scopeAt=i=>scopes.filter(s=>s.start<=i&&s.end>=i).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]||root;
  const resolve=(name,i)=>scopes.filter(s=>s.start<=i&&s.end>=i&&s.bindings.has(name)).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]?.bindings.get(name);
  // Named function and webMethod callback boundaries; anonymous nested callbacks retain outer name.
  for(let i=0;i<t.length;i++) {
    if(t[i].v==='function') {
      let j=i+1, name=null;if(t[j]?.v!=='(') name=t[j++]?.v;
      if(t[j]?.v==='(') {const close=pairs.get(j), body=close+1, s=scopes.find(s=>s.start===body);
        if(s) {s.name=name; for(let k=j+1;k<close;k++) if(/^[A-Za-z_$][\w$]*$/.test(t[k].v)) s.bindings.set(t[k].v,null);}
      }
    }
    if(t[i].v==='=>' && t[i+1]?.v==='{') {
      const s=scopes.find(s=>s.start===i+1), close=i-1, open=t[close]?.v===')'?pairs.get(close):close;
      for(let k=open;k<=close;k++) if(/^[A-Za-z_$][\w$]*$/.test(t[k]?.v||'')) s.bindings.set(t[k].v,null);
    }
    if(['const','let','var'].includes(t[i].v)&&t[i+2]?.v==='='&&t[i+3]?.v==='webMethod'&&t[i+4]?.v==='(') {
      const end=pairs.get(i+4);for(let j=i+5;j<end;j++) if(t[j].v==='=>'&&t[j+1]?.v==='{') {scopes.find(s=>s.start===j+1).name=t[i+1].v;break;}
    }
  }
  for(let i=0;i<t.length;i++) {
    if(t[i].v==='import'&&t[i+2]?.v==='from'&&t[i+3]?.value==='wix-data') root.bindings.set(t[i+1].v,{sdk:true});
    if(t[i].v==='='&&t[i-1]&&t[i+1]) {
      const name=t[i-1].v, rhs=t[i+1], scope=scopeAt(i), boundary=t[i+2]?.v;
      let value=null;
      if(rhs.string&&[',',';'].includes(boundary)) value={collection:rhs.value};
      else if(t[i+2]?.v==='.'&&resolve(rhs.v,i)?.sdk) value={method:t[i+3]?.v,sdkReceiver:rhs.v};
      else if(rhs.v==='Reflect'&&t[i+2]?.v==='.'&&t[i+3]?.v==='apply') value={apply:true};
      else if([',',';'].includes(boundary)) value=resolve(rhs.v,i)||null;
      if(/^[A-Za-z_$][\w$]*$/.test(name)) scope.bindings.set(name,value);
    }
  }
  function add(i,start,action,open) {
    // Only one token spanning the entire first argument is supported. Skip
    // balanced nested delimiters while finding its actual comma/closing edge.
    const close=pairs.get(open);
    let end=start;
    while(end<close && t[end].v!==',') {
      if(['(','[','{'].includes(t[end].v)) end=pairs.get(end)+1;
      else end++;
    }
    const arg=end===start+1 && end<=close?t[start]:null;
    const collection=arg?.string?arg.value:resolve(arg?.v,i)?.collection;
    const containing=scopes.filter(s=>s.start<=i&&s.end>=i&&s.name).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]?.name||null;
    const line=source.slice(0,t[i].at).split('\n').length;
    const site={collection:collection||null,action,at:t[i].at,line,containing_function:containing};sites.push(site);
    if(!collection) unresolved.push({...site,reason:'unresolved collection expression'});
  }
  for(let i=0;i<t.length;i++) {
    const b=resolve(t[i].v,i);
    if(b?.sdk&&t[i+1]?.v==='.'&&mutations.has(t[i+2]?.v)&&t[i+3]?.v==='(') add(i,i+4,t[i+2].v,i+3);
    if(b?.sdk&&t[i+1]?.v==='[') unresolved.push({at:t[i].at,reason:'computed SDK member; not resolved'});
    if(b?.apply&&t[i+1]?.v==='(') {
      const method=resolve(t[i+2]?.v,i);
      if(method?.method&&mutations.has(method.method)&&t[i+3]?.v===','&&resolve(t[i+4]?.v,i)?.sdk&&t[i+5]?.v===','&&t[i+6]?.v==='[') add(i,i+7,method.method,i+6);
      else if(!method?.method) unresolved.push({at:t[i].at,reason:'dynamic apply callee; not certified as a writer'});
    }
    if(b?.method&&mutations.has(b.method)&&t[i+1]?.v==='(') add(i,i+2,b.method,i+1);
    if(t[i].v.startsWith('`')&&t[i].v.includes('${')) unresolved.push({at:t[i].at,reason:'template interpolation omitted by bounded lexer'});
  }
  return {sites:[...new Map(sites.map(s=>[s.at,s])).values()],unresolved};
}
const fixtureHashes=[];
function fixture(source) {
  new vm.SourceTextModule(source); // Parse only, deliberately never linked/evaluated.
  fixtureHashes.push(require('node:crypto').createHash('sha256').update(source).digest('hex'));
  return scan(source);
}
assert.deepEqual(fixture("import db from 'wix-data'; const BOOKINGS = 'BookingReports'; db.update(BOOKINGS, {});").sites.map(s => s.collection), ['BookingReports'], 'payments alias must resolve from value, not spelling');
console.log('PASS payments alias');
assert.deepEqual(fixture("import db from 'wix-data'; const insert=db.insert, apply=Reflect.apply; apply(insert,db,['Bookings',{}]);").sites.map(s=>s.collection), ['Bookings'], 'captured insert alias must be discovered');
console.log('PASS captured insert');
assert.equal(fixture("import db from 'wix-data'; function benign(db) { db.update('Bookings',{}); } const crypto={update(){}}; crypto.update('Bookings'); // db.insert('Bookings',{})\n const s=\"db.remove('Bookings',{})\";").sites.length, 0, 'shadowed and non-SDK receivers are not writers');

const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process'), crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function discover(paths) {
  return [...new Set(paths)].filter(p=>/\.(?:js|jsw)$/.test(p)&&!/(^|\/)(?:tests?|checkpoints|mockups|generated|node_modules)\//.test(p)&&!/^scripts\/verify-/.test(p)&&!/^scripts\/fixtures\//.test(p)).sort();
}
assert.equal(fixture("import db from 'wix-data'; const pattern=/[\\\"'`{}]/; db.insert('Bookings',{});").sites.length,1,'regex string delimiters must not hide a writer');
const cases=['payments-alias','captured-insert','shadow-and-non-sdk','regex-delimiters'];
for(const ext of ['js','web.js','jsw']) {
  const file=`fixture/writer.${ext}`;
  assert.deepEqual(discover([file,file,'tests/no.js','x.py','mockups/no.js']),[file]);
  const positive="import db from 'wix-data'; const C='Bookings'; const insert=db.insert, apply=Reflect.apply; db.update(C,{}); apply(insert,db,[C,{}]);";
  assert.equal(fixture(positive).sites.filter(s=>s.collection==='Bookings').length,2);cases.push(`${ext}:direct-and-captured`);
  const benign="import db from 'wix-data'; const BOOKINGS='BookingReports'; db.update(BOOKINGS,{}); function f(db){db.insert('Bookings',{});} const crypto={update(){}}; crypto.update('Bookings'); const s=\"db.insert('Bookings',{})\"; /* db.save('Bookings',{}) */";
  assert.deepEqual(fixture(benign).sites.map(s=>s.collection),['BookingReports']);cases.push(`${ext}:false-positive`);
  assert.equal(fixture("import db from 'wix-data'; db.update(selectCollection(),{});").unresolved.length,1);cases.push(`${ext}:dynamic-collection`);
  const virtual=new Map([[file,positive],[`fixture/benign.${ext}`,benign]]);
  const discovered=discover([...virtual.keys(),file]);
  const discoveredTargets=discovered.flatMap(name=>fixture(virtual.get(name)).sites).filter(s=>s.collection==='Bookings');
  assert.equal(discoveredTargets.length,2,'same discovery path must expose added writers but not benign controls');
  assert.throws(()=>assert.deepEqual(discoveredTargets,[]),assert.AssertionError,'an added writer must fail an empty expected inventory');
  cases.push(`${ext}:added-writer-boundary`);
}
// Every expression is parsed, never evaluated; nested commas must not end an argument.
for(const [form,call] of [
  ['direct',e=>`db.insert(${e},{})`],
  ['captured',e=>`put(${e},{})`],
  ['apply',e=>`apply(put,db,[${e},{}])`]
]) {
  for(const [id,expression,expected] of [
    ['literal',"'Bookings'",'Bookings'],
    ['benign-literal',"'BookingReports'",'BookingReports'],
    ['alias','C','Bookings'],
    ['literal-suffix',"'Bookings'+suffix",null],
    ['joined-target',"'Book'+'ings'",null],
    ['alias-suffix','C+suffix',null],
    ['conditional',"'Bookings'?other:C",null],
    ['nested-call',"choose({a:[C,other]},(C,other))",null],
    ['nested-leading-literal',"'Bookings'+choose({a:[C,other]},(C,other))",null],
    ['parenthesized',"('Bookings')",null]
  ]) {
    const result=fixture(`import db from 'wix-data'; const C='Bookings', suffix='Archive'; const put=db.insert, apply=Reflect.apply; ${call(expression)}; db.remove('BookingSummary',{});`);
    assert.deepEqual(result.sites.map(s=>s.collection),[expected,'BookingSummary'],`${form}:${id}: classify complete argument, not its first token`);
    assert.equal(result.unresolved.filter(s=>s.reason==='unresolved collection expression').length,expected===null?1:0,`${form}:${id}: unsupported expression must be explicit`);
    cases.push(`expression:${form}:${id}`);
  }
}
for(const [id,call,expected] of [
  ['direct-close',"db.truncate('Bookings')",'Bookings'],
  ['captured-close',"put('Bookings')",'Bookings'],
  ['apply-array-close',"apply(put,db,['Bookings'])",'Bookings'],
  ['direct-close-expression',"db.truncate('Book'+'ings')",null],
  ['captured-close-expression',"put('Bookings'+suffix)",null],
  ['apply-close-expression',"apply(put,db,['Book'+'ings'])",null]
]) {
  const result=fixture(`import db from 'wix-data'; const put=db.truncate, apply=Reflect.apply; ${call};`);
  assert.deepEqual(result.sites.map(s=>s.collection),[expected],id);
  assert.equal(result.unresolved.length,expected===null?1:0,id);
  cases.push(`expression:${id}`);
}
const EXPECTED=[
  {
    "id": "W01",
    "file": "velo/backend/adminConsole.web.js",
    "line": 289,
    "collection": "Bookings",
    "action": "update",
    "containing_function": "adminUpdateBooking",
    "function_line": 229,
    "source": "await wixData.update(BOOKINGS, updated);",
    "entrypoints": [
      "adminUpdateBooking"
    ]
  },
  {
    "id": "W02",
    "file": "velo/backend/adminConsole.web.js",
    "line": 305,
    "collection": "BookingSummary",
    "action": "update",
    "containing_function": "adminUpdateBooking",
    "function_line": 229,
    "source": "await wixData.update(BOOKING_SUMMARIES, sUpd);",
    "entrypoints": [
      "adminUpdateBooking"
    ]
  },
  {
    "id": "W03",
    "file": "velo/backend/adminConsole.web.js",
    "line": 414,
    "collection": "Bookings",
    "action": "update",
    "containing_function": "adminCancelBooking",
    "function_line": 393,
    "source": "await wixData.update(BOOKINGS, updated);",
    "entrypoints": [
      "adminCancelBooking"
    ]
  },
  {
    "id": "W04",
    "file": "velo/backend/adminConsole.web.js",
    "line": 450,
    "collection": "BookingSummary",
    "action": "update",
    "containing_function": "adminCancelBooking",
    "function_line": 393,
    "source": "await wixData.update(BOOKING_SUMMARIES, summary);",
    "entrypoints": [
      "adminCancelBooking"
    ]
  },
  {
    "id": "W05",
    "file": "velo/backend/availability.web.js",
    "line": 511,
    "collection": "BookingSummary",
    "action": "update",
    "containing_function": "updateBookingSummary",
    "function_line": 389,
    "source": "await wixData.update(BOOKING_SUMMARIES, summary, { suppressAuth: true });",
    "entrypoints": [
      "createBooking",
      "cancelBooking",
      "blockRoom",
      "blockAllRooms"
    ]
  },
  {
    "id": "W06",
    "file": "velo/backend/availability.web.js",
    "line": 515,
    "collection": "BookingSummary",
    "action": "insert",
    "containing_function": "updateBookingSummary",
    "function_line": 389,
    "source": "await wixData.insert(BOOKING_SUMMARIES, summary, { suppressAuth: true });",
    "entrypoints": [
      "createBooking",
      "cancelBooking",
      "blockRoom",
      "blockAllRooms"
    ]
  },
  {
    "id": "W07",
    "file": "velo/backend/availability.web.js",
    "line": 803,
    "collection": "Bookings",
    "action": "insert",
    "containing_function": "createBookingImpl",
    "function_line": 692,
    "source": "const inserted = await wixData.insert(BOOKINGS, toInsert);",
    "entrypoints": [
      "createBooking"
    ]
  },
  {
    "id": "W08",
    "file": "velo/backend/availability.web.js",
    "line": 827,
    "collection": "Bookings",
    "action": "remove",
    "containing_function": "createBookingImpl",
    "function_line": 692,
    "source": "await wixData.remove(BOOKINGS, inserted._id);",
    "entrypoints": [
      "createBooking"
    ]
  },
  {
    "id": "W09",
    "file": "velo/backend/availability.web.js",
    "line": 1012,
    "collection": "BookingSummary",
    "action": "update",
    "containing_function": "issueBookingInvoice",
    "function_line": 858,
    "source": "await wixData.update(BOOKING_SUMMARIES, sItem, { suppressAuth: true });",
    "entrypoints": [
      "issueBookingInvoice"
    ]
  },
  {
    "id": "W10",
    "file": "velo/backend/availability.web.js",
    "line": 1029,
    "collection": "Bookings",
    "action": "update",
    "containing_function": "cancelBooking",
    "function_line": 1023,
    "source": "const updated = await wixData.update(BOOKINGS, b);",
    "entrypoints": [
      "cancelBooking"
    ]
  },
  {
    "id": "W11",
    "file": "velo/backend/availability.web.js",
    "line": 1067,
    "collection": "BookingSummary",
    "action": "update",
    "containing_function": "cancelBooking",
    "function_line": 1023,
    "source": "await wixData.update(BOOKING_SUMMARIES, summary);",
    "entrypoints": [
      "cancelBooking"
    ]
  },
  {
    "id": "W12",
    "file": "velo/backend/availability.web.js",
    "line": 1129,
    "collection": "Bookings",
    "action": "insert",
    "containing_function": "blockRoom",
    "function_line": 1080,
    "source": "const inserted = await wixData.insert(BOOKINGS, toInsert);",
    "entrypoints": [
      "blockRoom",
      "blockAllRooms"
    ]
  },
  {
    "id": "W13",
    "file": "velo/backend/availability.web.js",
    "line": 1147,
    "collection": "Bookings",
    "action": "remove",
    "containing_function": "unblock",
    "function_line": 1141,
    "source": "await wixData.remove(BOOKINGS, bookingId);",
    "entrypoints": [
      "unblock"
    ]
  },
  {
    "id": "W14",
    "file": "velo/backend/googleAdsConversions.web.js",
    "line": 107,
    "collection": "BookingSummary",
    "action": "update",
    "containing_function": "retryBookingConversion",
    "function_line": 53,
    "source": "await wixData.update('BookingSummary', summary);",
    "entrypoints": [
      "retryBookingConversion"
    ]
  },
  {
    "id": "W15",
    "file": "velo/backend/guestBookingAcquisitionControlStore.js",
    "line": 33,
    "collection": "GuestBookingAcquisitionControls",
    "action": "insert",
    "containing_function": "reconcileGuestBookingAcquisitionControl",
    "function_line": 31,
    "source": "try{await apply(insert,wixData,[collection,row,{suppressAuth:true,suppressHooks:true}]);}catch{/* Every outcome requires exact readback. */}",
    "entrypoints": [
      "resumeGuestBookingAcquisitionControl",
      "resumeGuestBookingPhysicalAcquisition"
    ]
  },
  {
    "id": "W16",
    "file": "velo/backend/guestBookingPhysicalAcquisitionStore.js",
    "line": 176,
    "collection": "RoomBookingClaimEvents",
    "action": "insert",
    "containing_function": "reconcileGuestBookingPhysicalClaim",
    "function_line": 174,
    "source": "try{await apply(insert,wixData,['RoomBookingClaimEvents',row,{suppressAuth:true,suppressHooks:true}]);}catch{}",
    "entrypoints": [
      "resumeGuestBookingPhysicalAcquisition"
    ]
  },
  {
    "id": "W17",
    "file": "velo/backend/invoice.web.js",
    "line": 112,
    "collection": "Bookings",
    "action": "update",
    "containing_function": "generateAndStoreInvoice",
    "function_line": 79,
    "source": "await wixData.update(BOOKINGS, booking);",
    "entrypoints": [
      "generateAndStoreInvoice"
    ]
  },
  {
    "id": "W18",
    "file": "velo/backend/invoiceService.web.js",
    "line": 112,
    "collection": "Bookings",
    "action": "update",
    "containing_function": "generateAndStoreInvoice",
    "function_line": 79,
    "source": "await wixData.update(BOOKINGS, booking);",
    "entrypoints": [
      "generateAndStoreInvoice"
    ]
  },
  {
    "id": "W19",
    "file": "velo/backend/invoices.web.js",
    "line": 112,
    "collection": "Bookings",
    "action": "update",
    "containing_function": "generateAndStoreInvoice",
    "function_line": 79,
    "source": "await wixData.update(BOOKINGS, booking);",
    "entrypoints": [
      "generateAndStoreInvoice"
    ]
  },
  {
    "id": "W20",
    "file": "velo/backend/microsoftAdsConversions.web.js",
    "line": 94,
    "collection": "BookingSummary",
    "action": "update",
    "containing_function": "retryMicrosoftBookingConversion",
    "function_line": 64,
    "source": "await wixData.update('BookingSummary', summary);",
    "entrypoints": [
      "retryMicrosoftBookingConversion"
    ]
  },
  {
    "id": "W21",
    "file": "velo/page-booking-summary.js",
    "line": 883,
    "collection": "BookingSummary",
    "action": "update",
    "containing_function": "wireContinueButton",
    "function_line": 784,
    "source": "await wixData.update('BookingSummary', s);",
    "entrypoints": [
      "frontend Continue handler; no module export"
    ]
  },
  {
    "id": "W22",
    "file": "velo/page-booking-summary.js",
    "line": 991,
    "collection": "BookingSummary",
    "action": "update",
    "containing_function": "wireContinueButton",
    "function_line": 784,
    "source": "return wixData.update('BookingSummary', summary);",
    "entrypoints": [
      "frontend Continue handler; no module export"
    ]
  },
  {
    "id": "W23",
    "file": "velo/page-booking-summary.js",
    "line": 1036,
    "collection": "BookingSummary",
    "action": "update",
    "containing_function": "wireContinueButton",
    "function_line": 784,
    "source": "return wixData.update('BookingSummary', summary);",
    "entrypoints": [
      "frontend Continue handler; no module export"
    ]
  }
];
const ENTRYPOINT_ANCHORS=[
  {
    "name": "adminCancelBooking",
    "file": "velo/backend/adminConsole.web.js",
    "line": 393,
    "source": "export const adminCancelBooking = webMethod("
  },
  {
    "name": "adminUpdateBooking",
    "file": "velo/backend/adminConsole.web.js",
    "line": 229,
    "source": "export const adminUpdateBooking = webMethod("
  },
  {
    "name": "blockAllRooms",
    "file": "velo/backend/availability.web.js",
    "line": 1219,
    "source": "export const blockAllRooms = webMethod("
  },
  {
    "name": "blockRoom",
    "file": "velo/backend/availability.web.js",
    "line": 1080,
    "source": "export const blockRoom = webMethod("
  },
  {
    "name": "cancelBooking",
    "file": "velo/backend/availability.web.js",
    "line": 1023,
    "source": "export const cancelBooking = webMethod("
  },
  {
    "name": "createBooking",
    "file": "velo/backend/availability.web.js",
    "line": 852,
    "source": "export const createBooking = webMethod("
  },
  {
    "name": "generateAndStoreInvoice",
    "file": "velo/backend/invoice.web.js",
    "line": 79,
    "source": "export const generateAndStoreInvoice = webMethod("
  },
  {
    "name": "generateAndStoreInvoice",
    "file": "velo/backend/invoiceService.web.js",
    "line": 79,
    "source": "export const generateAndStoreInvoice = webMethod("
  },
  {
    "name": "generateAndStoreInvoice",
    "file": "velo/backend/invoices.web.js",
    "line": 79,
    "source": "export const generateAndStoreInvoice = webMethod("
  },
  {
    "name": "issueBookingInvoice",
    "file": "velo/backend/availability.web.js",
    "line": 858,
    "source": "export const issueBookingInvoice = webMethod("
  },
  {
    "name": "resumeGuestBookingAcquisitionControl",
    "file": "velo/backend/guestBookingAcquisitionControl.js",
    "line": 17,
    "source": "export async function resumeGuestBookingAcquisitionControl(acceptanceId){"
  },
  {
    "name": "resumeGuestBookingPhysicalAcquisition",
    "file": "velo/backend/guestBookingPhysicalAcquisition.js",
    "line": 9,
    "source": "export async function resumeGuestBookingPhysicalAcquisition(acceptanceId){"
  },
  {
    "name": "retryBookingConversion",
    "file": "velo/backend/googleAdsConversions.web.js",
    "line": 53,
    "source": "export const retryBookingConversion = webMethod("
  },
  {
    "name": "retryMicrosoftBookingConversion",
    "file": "velo/backend/microsoftAdsConversions.web.js",
    "line": 64,
    "source": "export const retryMicrosoftBookingConversion = webMethod("
  },
  {
    "name": "unblock",
    "file": "velo/backend/availability.web.js",
    "line": 1141,
    "source": "export const unblock = webMethod("
  }
];
const BASELINE='7bbc57172821cb59d741bfad68a3adb670992dc6';
const targets=new Set(['Bookings','BookingSummary','RoomBookingClaimEvents','GuestBookingAcquisitionControls','GuestBookingCompletions']);
const identity=s=>[s.file,s.line,s.collection,s.action,s.containing_function,s.source].join('|');
function inventory(label,sources,requiredPaths) {
  for(const file of requiredPaths) assert.ok(sources.has(file),`${label}: required baseline source absent: ${file}`);
  const anchorDiagnostics=ENTRYPOINT_ANCHORS.map(a=>{
    const available=sources.has(a.file);
    if(available) assert.equal(sources.get(a.file).toString('utf8').split(/\r?\n/)[a.line-1].trim(),a.source,`${a.name}: documented entrypoint declaration changed`);
    return {...a,status:available?'available-validated':'absent-from-source-snapshot'};
  });
  const sites=[],unresolved=[],hashes={};
  for(const [file,bytes] of sources) {
    const source=bytes.toString('utf8');
    hashes[file]=crypto.createHash('sha256').update(bytes).digest('hex');
    const result=scan(source);
    sites.push(...result.sites.map(s=>({...s,file,source:source.split(/\r?\n/)[s.line-1].trim()})));
    unresolved.push(...result.unresolved.map(s=>({...s,file})));
  }
  const actual=[...new Map(sites.filter(s=>targets.has(s.collection)).map(s=>[`${s.file}:${s.at}`,s])).values()];
  // Project frozen rows by actual source membership, never by desired counts.
  const expected=EXPECTED.filter(e=>sources.has(e.file));
  assert.deepEqual(actual.map(identity).sort(),expected.map(identity).sort(),`${label}: exact writer inventory changed; inspect source evidence, never force counts`);
  for(const e of expected) {
    const line=sources.get(e.file).toString('utf8').split(/\r?\n/)[e.function_line-1];
    assert.ok(line.includes(e.containing_function),`${e.id}: function anchor changed`);
    assert.ok(e.entrypoints.length,`${e.id}: documented entrypoint association missing`);
  }
  assert.equal(sites.some(s=>s.file==='velo/backend/payments.web.js'&&s.collection==='Bookings'),false);
  assert.ok(sites.some(s=>s.file==='velo/backend/payments.web.js'&&s.collection==='BookingReports'));
  return {label,paths:[...sources.keys()],hashes,documentedEntrypointAnchors:anchorDiagnostics,
    expectedSourceDiagnostics:[...new Set(EXPECTED.map(e=>e.file))].map(file=>({file,status:sources.has(file)?'available-validated':'absent-from-source-snapshot'})),
    targetSites:actual,targetFiles:new Set(actual.map(s=>s.file)).size,
    totals:Object.fromEntries([...targets].map(c=>[c,actual.filter(s=>s.collection===c).length])),
    allResolvedMutationSites:sites.filter(s=>s.collection!==null).length,
    adjacentSites:sites.filter(s=>s.collection!==null&&!targets.has(s.collection)),unresolved};
}
const git=args=>cp.execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
const baselinePaths=discover(git(['ls-tree','-r','--name-only','-z',BASELINE]).toString('utf8').split('\0').filter(Boolean));
const baselineSources=new Map(baselinePaths.map(file=>[file,git(['show',`${BASELINE}:${file}`])]));
const baselineInventory=inventory('committed-baseline',baselineSources,baselinePaths);
const all=git(['ls-files','--cached','--others','--exclude-standard','-z']).toString('utf8').split('\0').filter(Boolean);
// Git metadata may name untracked files outside an exported snapshot. Only
// physically present files belong to it; missing committed files still fail.
const paths=discover(all).filter(file=>fs.existsSync(path.join(root,file)));
const sources=new Map(paths.map(file=>[file,fs.readFileSync(path.join(root,file))]));
const snapshotInventory=inventory('available-working-snapshot',sources,baselinePaths);
// Permanent source-set controls use source bytes only, never application execution.
assert.deepEqual(inventory('baseline-only-control',baselineSources,baselinePaths).targetSites,baselineInventory.targetSites);
cases.push('portability:baseline-only');
const missingRequired=new Map(baselineSources);missingRequired.delete('velo/backend/availability.web.js');
assert.throws(()=>inventory('missing-required-control',missingRequired,baselinePaths),/required baseline source absent/);
cases.push('portability:missing-baseline-source-denied');
for(const a of ENTRYPOINT_ANCHORS) if(sources.has(a.file)) {
  const changed=new Map(sources),lines=changed.get(a.file).toString('utf8').split(/\r?\n/);
  lines[a.line-1]='// removed documented entrypoint';changed.set(a.file,Buffer.from(lines.join('\n')));
  assert.throws(()=>inventory('changed-anchor-control',changed,baselinePaths),/documented entrypoint declaration changed/);
}
cases.push('portability:present-entrypoint-anchors-enforced');
console.log(JSON.stringify({scope:'tracked/nonignored JS/web.js/jsw only; no application execution',baseline:BASELINE,
  ...snapshotInventory,baselineInventory,fixtureCases:cases,fixtureHashes,
  sourceVariation:{availableBeyondBaseline:paths.filter(p=>!baselineSources.has(p)),absentDocumentedSources:snapshotInventory.expectedSourceDiagnostics.filter(s=>s.status==='absent-from-source-snapshot')},
  limitations:['bounded lexical inventory, not exhaustive all-writer or call-graph proof','entrypoints are frozen documented associations, not dynamically proven reachability','no deployed, ignored/generated, HTML, Python, GS, dataset or external API coverage','regex literals, escaped identifiers, destructuring, reassignment and dynamic call/alias forms are not certified','D1 BLOCKED_UNWAIVED; no dependency admission']},null,2));
console.log('PASS exact source inventory and parse-only fixtures; unresolved coverage remains explicit');
