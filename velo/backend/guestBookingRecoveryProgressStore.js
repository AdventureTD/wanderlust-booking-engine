import wixData from 'wix-data';

// Private administrative traversal only. No booking or delivery authority.
// Immutable compliant writers and native indexed visibility are activation gates.
const collection='GuestBookingRecoveryProgress', stream='guest-booking-acceptances/v1';
const fields=['_id','schemaVersion','kind','stream','sequence','previousId','sweep','afterSourceId','classifiedSourceId','classification'];
const metadata=['_owner','_createdDate','_updatedDate'];
const classes=['COORDINATOR_RETURNED','COORDINATOR_UNRESOLVED','INVALID_ROOT','EMPTY_SWEEP'];
const itemLimit=4096, byteLimit=65536, readLimit=8;
function key(v){return typeof v==='string'&&v.length>0&&v.length<=128&&/^[\x20-\x7e]+$/.test(v);}
function id(n){return 'gbrp1-'+String(n).padStart(16,'0');}
function size(v){return new TextEncoder().encode(JSON.stringify(v)).length;}
function options(){return {suppressAuth:true,suppressHooks:true,consistentRead:true};}
function record(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('shape');
 const descriptors=Object.getOwnPropertyDescriptors(raw), out={};
 for(const k of Reflect.ownKeys(descriptors)){
  if(typeof k!=='string'||(!fields.includes(k)&&!metadata.includes(k))||!('value' in descriptors[k]))throw Error('field');
 }
 for(const k of fields){if(!descriptors[k])throw Error('missing');out[k]=descriptors[k].value;}
 if(size(raw)>itemLimit)throw Error('envelope');
 if(out.schemaVersion!==1||out.kind!=='completion-recovery-progress'||out.stream!==stream||!Number.isSafeInteger(out.sequence)||out.sequence<1||Object.is(out.sequence,-0)||!Number.isSafeInteger(out.sweep)||out.sweep<0||Object.is(out.sweep,-0))throw Error('counter');
 if(out._id!==id(out.sequence)||out.previousId!==(out.sequence===1?null:id(out.sequence-1))||!classes.includes(out.classification))throw Error('identity');
 if(out.afterSourceId!==null&&!key(out.afterSourceId))throw Error('cursor');
 if(out.classification==='EMPTY_SWEEP'){
  if(out.classifiedSourceId!==null||out.afterSourceId!==null)throw Error('empty');
 }else if(!key(out.classifiedSourceId)||(out.afterSourceId!==null&&out.afterSourceId!==out.classifiedSourceId))throw Error('source');
 // Necessary local history bounds, not a whole-chain audit: a rotation spends
 // one sequence; a nonrotation leaves at least one sequence without a sweep.
 if(out.sweep>out.sequence||(out.afterSourceId===null?out.sweep<1:out.sweep>=out.sequence))throw Error('sweep history');
 // Apply initial transition validation even when this row is a predecessor.
 if(out.sequence===1&&!transition(virtual(),out))throw Error('initial');
 return out;
}
function virtual(){return {sequence:0,sweep:0,afterSourceId:null,_id:null};}
function transition(previous,next){
 if(next.sequence!==previous.sequence+1||next.previousId!==previous._id)return false;
 if(next.classifiedSourceId!==null&&previous.afterSourceId!==null&&next.classifiedSourceId<=previous.afterSourceId)return false;
 if(next.afterSourceId===null)return previous.sweep<Number.MAX_SAFE_INTEGER&&next.sweep===previous.sweep+1;
 return next.classification!=='EMPTY_SWEEP'&&next.sweep===previous.sweep;
}
function equal(a,b){return fields.every(k=>a[k]===b[k]);}
export function createGuestBookingRecoveryProgressStore(){
 let reads=0,bytes=0,reserved=false,used=false,admitted=null;
 async function page(query,readback=false){
  const held=reserved&&!readback?1:0;
  if(reads+held>=readLimit||bytes+(held?itemLimit+64:0)>=byteLimit)throw Error('budget');
  reads++;
  const p=await query.find(options());
  if(!p||!Array.isArray(p.items)||p.items.length>2||typeof p.hasNext!=='function')throw Error('page');
  const more=p.hasNext();if(typeof more!=='boolean'||(more&&p.items.length!==2))throw Error('continuation');
  const rows=p.items.map(record), debit=size({items:p.items,more});bytes+=debit;
  if(bytes>byteLimit)throw Error('bytes');
  return {rows,more};
 }
 async function exact(keyValue,readback=false){
  const p=await page(wixData.query(collection).eq('_id',keyValue).limit(2),readback);
  if(p.more||p.rows.length>1||(p.rows.length&&p.rows[0]._id!==keyValue))throw Error('exact');
  return p.rows[0]||null;
 }
 return {
  async head(){
   try{
    const p=await page(wixData.query(collection).eq('stream',stream).descending('sequence').limit(2));
    if(!p.rows.length){if(p.more)throw Error('empty');admitted=virtual();return {status:'READY',head:{...admitted}};}
    const h=p.rows[0];
    if(p.rows.length===2&&p.rows[1].sequence>=h.sequence)throw Error('order');
    if(h.sequence===1){if(p.rows.length!==1||!transition(virtual(),h))throw Error('initial');}
    else{
     const predecessor=await exact(h.previousId);
     if(!predecessor||!transition(predecessor,h))throw Error('predecessor');
     // A positive older head row cannot disappear or change on keyed readback.
     if(p.rows.length===2&&!equal(p.rows[1],predecessor))throw Error('positive gap');
    }
    admitted=h;return {status:'READY',head:{...h}};
   }catch{return {status:'UNRESOLVED'};}
  },
  reserve(){
   // Conservatively reserve even a possible exhausted-page sweep increment.
   if(!admitted||used||reserved||admitted.sequence>=Number.MAX_SAFE_INTEGER||admitted.sweep>=Number.MAX_SAFE_INTEGER||reads+1>readLimit||bytes+itemLimit+64>byteLimit)return false;
   reserved=true;return true;
  },
  async append(classifiedSourceId,classification,rotate){
   if(!reserved||used||!admitted)return {status:'UNRESOLVED'};
   used=true;
   try{
    const proposal=record({_id:id(admitted.sequence+1),schemaVersion:1,kind:'completion-recovery-progress',stream,sequence:admitted.sequence+1,previousId:admitted._id,sweep:admitted.sweep+(rotate?1:0),afterSourceId:rotate?null:classifiedSourceId,classifiedSourceId,classification});
    if(!transition(admitted,proposal)||size(proposal)+512>itemLimit)return {status:'INTEGRITY'};
    try{await wixData.insert(collection,proposal,{suppressAuth:true,suppressHooks:true});}catch{/* ACK is never authoritative. */}
    const winner=await exact(proposal._id,true);
    if(!winner)return {status:'UNRESOLVED'};
    if(!transition(admitted,winner))return {status:'INTEGRITY'};
    return {status:equal(winner,proposal)?'ADVANCED':'CONTENTION'};
   }catch{return {status:'UNRESOLVED'};}
  }
 };
}
