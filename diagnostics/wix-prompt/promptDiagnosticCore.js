const COLLECTION = 'WixPromptDiagnostics';
const TAG = 'wixprompt-6da182ac-792f-42c8-bb7e-4ca4bb0dd690';
const OPTIONS = {suppressAuth:true, suppressHooks:true};
const PROBES = [false,true].flatMap(suppressed => [1,2].map(stage => ({
  _id: `${TAG}-${suppressed ? 's' : 'c'}${stage}`,
  kind:'probe', tag:TAG, stage, suppressed
})));
// Unknown key names and ALL non-fixture scalar values are redacted.
// This is a structural observation, never a full raw event dump.
function sanitized(value, depth=0, budget={left:80}) {
  if (--budget.left < 0 || depth > 5) return '[bounded]';
  if (typeof value === 'string' && PROBES.some(p=>p._id===value)) return value;
  if (value === null) return null;
  if (typeof value !== 'object') return `[${typeof value}:redacted]`;
  if (Array.isArray(value)) return value.slice(0,12).map(v=>sanitized(v,depth+1,budget));
  const out={};
  const known=['metadata','entity','id','_id','eventType','instanceId','identity','data','dataCollectionId','collectionId','createdDate','updatedDate'];
  Object.keys(value).slice(0,16).forEach((key,i)=>{
    out[known.includes(key)?key:`unknownField${i}`]=sanitized(value[key],depth+1,budget);
  });
  return out;
}
export function createDiagnostic(store, config) {
  const enabled=config.enabled===true && typeof config.ownerId==='string' && config.ownerId.length>0;
  async function insert(row, suppressed=true) {
    try {
      const saved=await store.insert(COLLECTION,row,{suppressAuth:true,suppressHooks:suppressed});
      return saved && saved._id===row._id;
    } catch { return false; } // Includes unknown ACK: no successor grant.
  }
  return {
    async start(ownerId) {
      if (!enabled || ownerId !== config.ownerId) return {status:'DENIED'};
      for(const probe of PROBES.filter(p=>p.stage===1))await insert({...probe},probe.suppressed);
      return {status:'SEE_OBSERVATIONS'}; // Not delivery or insert confirmation.
    },
    async onCreated(event) {
      if (!enabled) return;
      const probe=PROBES.find(p=>p._id===event?.entity?._id);
      if (!probe) return; // Zero reads/logs for unrelated or receipt events.
      try {
        const row=await store.get(COLLECTION,probe._id,OPTIONS);
        if (!row || Object.keys(probe).some(k=>row[k]!==probe[k])) return;
        const receipt={_id:`${probe._id}-seen`,kind:'observation',tag:TAG,
          probeId:probe._id,eventJson:JSON.stringify(sanitized(event))};
        if (!await insert(receipt)) return;
        // Only a fresh receipt winner can advance. Stage 2 has NO successor.
        if(probe.stage===1){
          const next=PROBES.find(p=>p.suppressed===probe.suppressed && p.stage===2);
          await insert({...next},next.suppressed);
        }
      } catch { /* No raw event/error logging and no retry loop. */ }
    }
  };
}
