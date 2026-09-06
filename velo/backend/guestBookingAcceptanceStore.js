import wixData from 'wix-data';
import { boundedJson, snapshotAcceptancePage } from 'backend/guestBookingIssuerAuthority';

// Immutable fixed store. Duplicate errors do NOT establish operation finality.
const collection='GuestBookingAcceptances';
function options(){return {suppressAuth:true,suppressHooks:true,consistentRead:true};}
function key(id){return typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);}
export async function insertGuestBookingAcceptance(root){
 try {boundedJson(JSON.stringify(root),160000);await wixData.insert(collection,root,{suppressAuth:true,suppressHooks:true});return 'ACKNOWLEDGED';}
 catch{return 'UNRESOLVED';}
}
export async function readGuestBookingAcceptance(id){
 if(!key(id))return {status:'INTEGRITY'};
 try {
  const p=snapshotAcceptancePage(await wixData.query(collection).eq('_id',id).limit(2).find(options()),2);
  if(!Array.isArray(p.items)||p.items.length>1||p.more!==false)return {status:'INTEGRITY'};
  if(p.items.length===0)return {status:'ABSENT'};
  if(p.items[0]._id!==id)return {status:'INTEGRITY'};
  return {status:'FOUND',root:p.items[0]};
 }catch{return {status:'UNRESOLVED'};}
}
// Traversal keys are not acceptance identities: bounded printable ASCII anomalies
// can be quarantined by the caller without blocking later authenticated roots.
function traversalKey(id){return typeof id==='string'&&id.length>0&&id.length<=128&&/^[\x20-\x7e]+$/.test(id);}
export async function scanGuestBookingAcceptances(cursor){
 if(cursor!==null&&!traversalKey(cursor))return {status:'INTEGRITY'};
 try {
  let q=wixData.query(collection);if(cursor!==null)q=q.gt('_id',cursor);
  const p=snapshotAcceptancePage(await q.ascending('_id').limit(25).find(options()),25);
  if(!Array.isArray(p.items)||p.items.length>25)return {status:'INTEGRITY'};
  const more=p.more;if(typeof more!=='boolean'||(more&&p.items.length!==25))return {status:'INTEGRITY'};
  let last=cursor;for(const row of p.items){if(!traversalKey(row._id)||(last!==null&&row._id<=last))return {status:'INTEGRITY'};last=row._id;}
  return {status:'PAGE',rows:p.items,nextCursor:more?last:null,exhausted:!more};
 }catch{return {status:'UNRESOLVED'};}
}
