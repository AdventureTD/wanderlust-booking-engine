'use strict';
// Dedicated disposable SDK; never import a backend or historical fixture here.
const assert = require('node:assert/strict');
const COLLECTIONS = Object.freeze(['GuestBookingFinancialRevisions','GuestBookingAcceptances','GuestBookingAllocationManifests','GuestBookingRecoveryProgress','GuestBookingAcquisitionControls','RoomBookingClaimEvents','Bookings','BookingSummary','GuestBookingCompletions','Rooms','HotelClosures']);
const WRITABLE = new Set(COLLECTIONS.slice(1,9));
const SECRET_NAMES = new Set(['WBE_PRICING_QUOTE_SECRET','WBE_GUEST_BOOKING_KEYS','WBE_GUEST_BOOKING_ISSUER_CONFIG']);
function detach(v, seen = new Map()) {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) throw Error('cyclic fixture value');
  if (v instanceof Date) return new Date(v.getTime());
  const proto = Object.getPrototypeOf(v);
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw Error('unsupported fixture prototype');
  const out = Array.isArray(v) ? [] : Object.create(proto); seen.set(v,out);
  for (const k of Reflect.ownKeys(v)) {
    if (Array.isArray(v) && k === 'length') continue;
    if (typeof k !== 'string') throw Error('symbol fixture key');
    const d = Object.getOwnPropertyDescriptor(v,k);
    if (!Object.hasOwn(d,'value')) throw Error('accessor fixture value');
    Object.defineProperty(out,k,{value:detach(d.value,seen),enumerable:d.enumerable,writable:true,configurable:true});
  }
  seen.delete(v); return out;
}
function allowedQuery(c,p,order,n) {
  const exact = p.length === 1 && p[0][0] === 'eq' && p[0][1] === '_id' && typeof p[0][2] === 'string' && n === 2 && order === null;
  if (exact && !['Rooms','HotelClosures'].includes(c)) return true;
  const cursor = a => a.length === 0 || (a.length === 1 && a[0][0] === 'gt' && a[0][1] === '_id' && typeof a[0][2] === 'string');
  const asc = order && order[0] === 'asc' && order[1] === '_id';
  if (c === 'GuestBookingAcceptances') return n === 25 && asc && cursor(p);
  if (c === 'GuestBookingRecoveryProgress') return n === 2 && order && order[0] === 'desc' && order[1] === 'sequence' && p.length === 1 && p[0][0] === 'eq' && p[0][1] === 'stream';
  if (c === 'RoomBookingClaimEvents') return n === 100 && asc && cursor(p);
  if (['Bookings','BookingSummary','GuestBookingCompletions'].includes(c)) {
    if (c !== 'GuestBookingCompletions' && n === 1000 && p.length === 0 && order === null) return true;
    const fields = c === 'Bookings' ? ['bookingNumber','operationId'] : c === 'BookingSummary' ? ['bookingNumber'] : ['acceptanceId'];
    const eq = p.filter(x=>x[0] === 'eq'), rest = p.filter(x=>x[0] !== 'eq');
    return n === 100 && asc && (c !== 'GuestBookingCompletions' || eq.length === 1) && eq.length <= 1 && eq.every(x=>fields.includes(x[1]) && typeof x[2] === 'string') && cursor(rest);
  }
  if (c === 'Rooms') return p.length === 0 && order === null && n === 50;
  if (c === 'HotelClosures') return order === null && n === 100 && p.length === 2 && p[0][0] === 'le' && p[0][1] === 'startDate' && p[1][0] === 'ge' && p[1][1] === 'endDate';
  return false;
}
function fixture({mode='business',initial={},secretValues={}}={}) {
  assert.ok(['business','SDK01'].includes(mode));
  const db = Object.fromEntries(COLLECTIONS.map(c=>[c,[]])), trace=[], loaded=new Set(), faults=[], prefixes=[];
  let serial=0;
  function collection(c) { if (!Object.hasOwn(db,c)) throw Error('collection denied: '+c); return db[c]; }
  for (const [c,rows] of Object.entries(initial)) {
    collection(c);
    if (mode !== 'SDK01' && !['GuestBookingFinancialRevisions','Rooms','HotelClosures','Bookings','BookingSummary'].includes(c)) throw Error('authority seeding denied');
    if (mode !== 'SDK01' && ['Bookings','BookingSummary'].includes(c) && rows.some(r=>typeof r._id !== 'string' || r._id.startsWith('pb1-') || r.operationId || r.acceptanceId)) throw Error('new projection seeding denied');
    db[c]=detach(rows);
  }
  function event(v) { const e={sequence:++serial,...detach(v)}; trace.push(e); return e; }
  function fault(stage,c,id) {
    const f=faults.find(x=>x.remaining>0 && x.stage===stage && x.collection===c && (x.id===undefined || x.id===id));
    if (f && --f.remaining === 0) {event({op:'fault',stage,collection:c,id});throw Error('fixture '+stage);}
  }
  const wix={
    query(c) {
      collection(c); const predicates=[];let order=null,limit=null;
      const q={};
      for (const op of ['eq','gt','le','ge']) q[op]=(k,v)=>{if(typeof k!=='string')throw Error('field');predicates.push([op,k,detach(v)]);return q;};
      q.ascending=k=>{if(order)throw Error('multiple orders');order=['asc',k];return q;};
      q.descending=k=>{if(order)throw Error('multiple orders');order=['desc',k];return q;};
      q.limit=n=>{if(!Number.isSafeInteger(n)||![2,25,50,100,1000].includes(n))throw Error('limit denied');limit=n;return q;};
      q.find=async options=>{
        if(!allowedQuery(c,predicates,order,limit))throw Error('query shape denied');
        const spec={collection:c,predicates:detach(predicates),order:detach(order),limit,options:detach(options)};
        const exact=predicates.find(p=>p[0]==='eq'&&p[1]==='_id');
        function select() {
          let rows=collection(c).filter(r=>predicates.every(([op,k,v])=>op==='eq'?r[k]===v:op==='gt'?r[k]>v:op==='le'?r[k]<=v:r[k]>=v));
          if(order)rows=rows.slice().sort((a,b)=>(a[order[1]]<b[order[1]]?-1:a[order[1]]>b[order[1]]?1:0)*(order[0]==='desc'?-1:1));
          return rows;
        }
        async function page(offset,op) {
          event({op,...spec,offset}); fault('read',c,exact&&exact[2]);
          const rows=select(), items=detach(rows.slice(offset,offset+limit)),more=rows.length>offset+limit;
          return {items,hasNext(){return more;},async next(){if(!more)throw Error('next after final page');return page(offset+limit,'next');}};
        }
        return page(0,'find');
      };
      return q;
    },
    async insert(c,item,options) {
      collection(c);if(!WRITABLE.has(c))throw Error('write collection denied');
      const row=detach(item);if(typeof row._id!=='string'||!row._id)throw Error('caller ID required');
      event({op:'insert-attempt',collection:c,id:row._id,options}); fault('before-apply',c,row._id);
      if(collection(c).some(r=>r._id===row._id)) {event({op:'duplicate',collection:c,id:row._id});throw Error('duplicate');}
      collection(c).push(row);event({op:'insert-applied',collection:c,id:row._id});
      // Prefixes are captured at the real apply boundary, never by deleting later rows.
      prefixes.push({label:mode==='SDK01'?'NON_AUTHORITATIVE_SENTINEL':'INERT_SDK_APPLY_PREFIX_REQUIRES_WRITER_PROVENANCE',sequence:serial,collection:c,id:row._id,db:detach(db)});
      fault('after-apply',c,row._id);return detach(row);
    }
  };
  return {wix,trace,loaded,prefixes,
    snapshot(){return detach(db);},
    armFault(stage,collection,id,occurrence=1){if(!['read','before-apply','after-apply'].includes(stage)||!Number.isSafeInteger(occurrence)||occurrence<1)throw Error('fault denied');collectionCheck(collection);faults.push({stage,collection,id,remaining:occurrence});},
    secrets:{async getSecretValue(name){if(!SECRET_NAMES.has(name)||!Object.hasOwn(secretValues,name))throw Error('secret denied');event({op:'secret',name});return {value:secretValues[name]};}},
    assertBackendFree(){assert.equal(loaded.size,0);assert.ok(Object.keys(require.cache).every(p=>!/[\\/]velo[\\/]/.test(p)));}
  };
  function collectionCheck(c){collection(c);}
}
module.exports={fixture,detach,allowedQuery,COLLECTIONS};
