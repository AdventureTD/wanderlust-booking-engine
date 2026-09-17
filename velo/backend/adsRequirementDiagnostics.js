import wixData from 'wix-data';
import { readGuestConsentRequirementsObservation } from 'backend/guestConsentRequirementsReader';

// Descriptor inspection only; never invoke SDK result accessors or expose values.
function shape(value, key) {
  for (let depth = 0; depth < 16 && value !== null && value !== Object.prototype; depth++) {
    if (typeof value !== 'object' && typeof value !== 'function') break;
    const d = Object.getOwnPropertyDescriptor(value,key);
    if (d) return {kind:(depth === 0 ? 'OWN_' : 'INHERITED_') + (Object.prototype.hasOwnProperty.call(d,'value') ? 'DATA' : 'ACCESSOR'), descriptor:d};
    value = Object.getPrototypeOf(value);
  }
  return {kind:'ABSENT',descriptor:null};
}

// Independent fixed first-page observation, NOT the reader's same result/snapshot.
export async function diagnoseAdsRequirementSdkShape() {
  const out = {v:1,stage:'CALL',reason:'INVALID_CALL',queryKind:'UNAVAILABLE',findKind:'UNAVAILABLE',itemsKind:'UNAVAILABLE',itemsEnumerable:null,itemCount:null,hasNextKind:'UNAVAILABLE'};
  if (arguments.length !== 0) return out;
  let timer;
  try {
    out.stage='QUERY';out.reason='THREW';
    out.queryKind=shape(wixData,'query').kind;
    const query=wixData.query('ConsentRequirements').ascending('_id').limit(100);
    out.findKind=shape(query,'find').kind;
    out.stage='FIND';
    const pending=query.find(Object.freeze({__proto__:null,suppressAuth:true,consistentRead:true,suppressHooks:true}));
    const observed=await Promise.race([
      Promise.resolve(pending).then(value=>({status:'RETURNED',value}),()=>({status:'THREW'})),
      new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'READ_TIMEOUT'}),10000);})
    ]);
    if (observed.status !== 'RETURNED') {out.reason=observed.status;return out;}
    out.stage='RESULT';
    const items=shape(observed.value,'items');
    out.itemsKind=items.kind;
    out.itemsEnumerable=items.descriptor ? items.descriptor.enumerable === true : null;
    if (items.descriptor && Object.prototype.hasOwnProperty.call(items.descriptor,'value') && Array.isArray(items.descriptor.value)) {
      const length=Object.getOwnPropertyDescriptor(items.descriptor.value,'length');
      if (length && Number.isSafeInteger(length.value) && length.value >= 0 && length.value <= 100) out.itemCount=length.value;
    }
    out.hasNextKind=shape(observed.value,'hasNext').kind;
    out.reason='SHAPE_ONLY';return out;
  } catch (_) { return out; }
  finally { clearTimeout(timer); }
}


// Candidate ONLY: private backend .js, not .web.js/.jsw or an HTTP handler.
// Do not import into a public endpoint. No rows, IDs, errors or digest returned.
export async function diagnoseAdsRequirementRead() {
  const result = (stage, reason, pages = null, rows = null) => ({v:1,stage,reason,pages,rows});
  if (arguments.length !== 0) return result('CALL','INVALID_CALL');
  try {
    const observation = await readGuestConsentRequirementsObservation();
    if (observation.status === 'OBSERVED') {
      const scan = observation.evidence.scan;
      if (scan.status === 'EXHAUSTED' && Number.isSafeInteger(scan.pages) && scan.pages >= 1 && scan.pages <= 41 &&
          Number.isSafeInteger(scan.rows) && scan.rows >= 0 && scan.rows <= 4096) {
        return result('READER','OBSERVED',scan.pages,scan.rows);
      }
    }
    const allowed = ['INVALID_CALL','INVALID_DATA','READ_FAILED','READ_TIMEOUT','INCOMPLETE_READ','OVERFLOW'];
    if (observation.status === 'UNAVAILABLE' && allowed.includes(observation.reason)) return result('READER',observation.reason);
    return result('READER','UNEXPECTED_RESULT');
  } catch (_) { return result('READER','THREW'); }
}
