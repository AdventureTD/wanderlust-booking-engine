'use strict';
// Dedicated SDK-only fixture. No backend loader or producer execution in this tranche.
const path=require('node:path'),fs=require('node:fs');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'booking-guest-accepted-flow-source.json'),'utf8'));
function fixture(){
 const rows={GuestBookingFinancialRevisions:[],GuestBookingAcceptances:[]};
 const trace=[],loaded=new Set(),hooks={};
 const secretValues=Object.create(null);
 function collection(name){if(!Object.hasOwn(rows,name))throw Error('collection denied');return rows[name];}
 const wix={
  query(name){collection(name);const predicates=[];let maximum=2,order=null;
   const q={eq(k,v){predicates.push(r=>r[k]===v);return q;},gt(k,v){predicates.push(r=>r[k]>v);return q;},
    ascending(k){order=k;return q;},limit(n){if(!Number.isSafeInteger(n)||n<1||n>25)throw Error('limit');maximum=n;return q;},
    async find(options){trace.push({op:'find',collection:name,options:structuredClone(options)});if(hooks.beforeFind)await hooks.beforeFind(name);
     let selected=collection(name).filter(r=>predicates.every(p=>p(r)));
     if(order)selected=selected.slice().sort((a,b)=>a[order]<b[order]?-1:a[order]>b[order]?1:0);
     const items=structuredClone(selected.slice(0,maximum)),more=selected.length>maximum;
     return {items,hasNext(){if(hooks.hasNext)hooks.hasNext(name);return more;}};
    }};return q;
  },
  async insert(name,item,options){
   if(name!=='GuestBookingAcceptances')throw Error('write collection denied');
   const value=structuredClone(item);if(typeof value._id!=='string'||!value._id)throw Error('ID');
   trace.push({op:'insert',collection:name,id:value._id,options:structuredClone(options)});
   if(hooks.beforeInsert)await hooks.beforeInsert(name,value._id);
   if(collection(name).some(r=>r._id===value._id))throw Error('duplicate');
   collection(name).push(value);if(hooks.afterInsert)await hooks.afterInsert(name,value._id);
   return structuredClone(value);
  }
 };
 const secrets={async getSecretValue(name){
  if(!['WBE_PRICING_QUOTE_SECRET','WBE_GUEST_BOOKING_KEYS','WBE_GUEST_BOOKING_ISSUER_CONFIG'].includes(name))throw Error('secret denied');
  trace.push({op:'secret',name});if(hooks.beforeSecret)await hooks.beforeSecret(name);
  if(!Object.hasOwn(secretValues,name))throw Error('secret missing');return {value:secretValues[name]};
 }};
 function resolve(spec,from){
  if(typeof spec!=='string'||typeof from!=='string'||!Object.hasOwn(manifest.modules,from))throw Error('module');
  let target=spec.startsWith('backend/')?'velo/'+spec:spec.startsWith('./')?path.posix.join(path.posix.dirname(from),spec):null;
  if(!target||target.includes('..')||target.includes('\\'))throw Error('escape/module');
  if(!target.endsWith('.js'))target+='.js';
  if(!Object.hasOwn(manifest.modules,target))throw Error('module denied');return target;
 }
 return {rows,trace,loaded,hooks,wix,secrets,secretValues,resolve};
}
module.exports={fixture};
