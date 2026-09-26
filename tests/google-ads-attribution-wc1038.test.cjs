const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.resolve(__dirname, '../velo/backend/googleAdsProcessingDiagnostic.js');
async function load(rows = {}) {
  const reads = [], forbidden = [];
  const deny = () => { forbidden.push('IO'); throw Error('PRIVATE_SENTINEL'); };
  const context = vm.createContext({Buffer, Date, setTimeout, clearTimeout, console: {log:deny,warn:deny,error:deny}});
  const synthetic = exports => new vm.SyntheticModule(Object.keys(exports), function(){for(const [k,v] of Object.entries(exports)) this.setExport(k,v);}, {context});
  const data = new Proxy({query(collection) {
    const q = {eq(field,value){assert.equal(field,'bookingNumber');assert.equal(value,'WC-1038');return q;},limit(n){q.n=n;return q;},async find(options){
      reads.push({collection,options,n:q.n});
      assert.deepEqual(options && JSON.parse(JSON.stringify(options)),{suppressAuth:true,suppressHooks:true,consistentRead:true});
      const value=rows[collection] || [];
      if(value instanceof Error) throw value;
      const items=Array.isArray(value)?value:value.items;
      return Object.create({get items(){return items;},hasNext(){return !!value.more;}});
    }};return q;
  }},{get(t,k){return k in t?t[k]:deny;}});
  const module=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context});
  await module.link(spec=>{if(spec==='wix-data')return synthetic({default:data});if(spec==='wix-fetch')return synthetic({fetch:deny});if(spec==='backend/dataManagerClient.web')return synthetic({getAccessToken:deny});throw Error(spec);});
  await module.evaluate();return {api:module.namespace,reads,forbidden};
}
const summary = {bookingNumber:'WC-1038',status:'confirmed',googleConversionUploaded:false,consentCaptured:false,grandTotal:124.5,currency:'USD',gclid:'PRIVATE_SENTINEL',guestEmail:'PRIVATE_SENTINEL',invoiceCapabilityHash:'PRIVATE_SENTINEL',lastError:'PRIVATE_SENTINEL'};
const auth = {bookingNumber:'WC-1038',kind:'AUTH',tokenHash:'PRIVATE_SENTINEL',commercialAuthority:'UNVERIFIED'};
test('fixed private read projects typed current Summary and exact journal counts without sensitive values or provider IO',async()=>{
  const h=await load({BookingSummary:[summary],GoogleAdsAttemptJournal:[auth]});
  assert.equal(typeof h.api.readWC1038AttributionDiagnostic,'function','missing fixed read-only diagnostic');
  const out=JSON.parse(JSON.stringify(await h.api.readWC1038AttributionDiagnostic()));
  assert.equal(out.projectionComplete,true);assert.equal(out.summary.googleConversionUploaded,false);
  assert.equal(out.summary.consentCaptured,false);assert.equal(out.summary.grandTotal,124.5);
  assert.deepEqual(out.journal.counts,{AUTH:1,ATTEMPT:0,RESULT:0,OTHER:0});
  assert.equal(out.summary.fieldPresence.gclid,true);
  assert.equal(JSON.stringify(out).includes('PRIVATE_SENTINEL'),false);
  assert.deepEqual(h.reads.map(x=>x.collection),['BookingSummary','GoogleAdsAttemptJournal']);assert.equal(h.forbidden.length,0);
});
test('arguments cannot select another booking and cause zero IO',async()=>{
  const h=await load();const out=await h.api.readWC1038AttributionDiagnostic('WC-1037');
  assert.equal(out.failureCode,'ARGUMENTS_NOT_ALLOWED');assert.equal(h.reads.length,0);assert.equal(h.forbidden.length,0);
});
for(const [label,rows,reason] of [
  ['missing',[], 'SUMMARY_NOT_FOUND'],['duplicate',[summary,summary],'SUMMARY_AMBIGUOUS'],
  ['wrong subject',[{...summary,bookingNumber:'WC-1037'}],'CMS_READ_UNAVAILABLE'],
  ['incomplete',{items:[summary],more:true},'CMS_READ_UNAVAILABLE'],
  ['exception',new Error('PRIVATE_SENTINEL'),'CMS_READ_UNAVAILABLE']
]) test('fail closed Summary '+label,async()=>{
  const h=await load({BookingSummary:rows});const out=await h.api.readWC1038AttributionDiagnostic();
  assert.equal(out.failureCode,reason);assert.equal(out.projectionComplete,false);assert.equal(out.summary,null);
  assert.equal(h.reads.length,1);assert.equal(JSON.stringify(out).includes('PRIVATE_SENTINEL'),false);assert.equal(h.forbidden.length,0);
});
for(const rows of [{items:[auth],more:true},Array(101).fill(auth),new Error('PRIVATE_SENTINEL')]) test('bounded journal rejects partial/oversized/failed observations',async()=>{
  const h=await load({BookingSummary:[summary],GoogleAdsAttemptJournal:rows});const out=await h.api.readWC1038AttributionDiagnostic();
  assert.equal(out.projectionComplete,false);assert.equal(out.journal,null);assert.equal(JSON.stringify(out).includes('PRIVATE_SENTINEL'),false);
});
test('missing booleans stay unknown and malicious stored values/getters never serialize',async()=>{
  let accessed=0;const s={bookingNumber:'WC-1038',grandTotal:'124.5',currency:'PRIVATE_SENTINEL',status:'PRIVATE_SENTINEL'};
  Object.defineProperty(s,'guestEmail',{get(){accessed++;throw Error('PRIVATE_SENTINEL');}});
  const h=await load({BookingSummary:[s],GoogleAdsAttemptJournal:[{...auth,kind:'PRIVATE_SENTINEL',outcome:'PRIVATE_SENTINEL',requestId:'PRIVATE_SENTINEL',statusCode:'PRIVATE_SENTINEL',toJSON(){throw Error('PRIVATE_SENTINEL');}}]});
  const out=await h.api.readWC1038AttributionDiagnostic();assert.equal(out.summary.googleConversionUploaded,null);assert.equal(out.summary.consentCaptured,null);
  assert.equal(out.summary.grandTotal,null);assert.equal(out.summary.currency,null);assert.equal(out.journal.counts.OTHER,1);
  assert.equal(out.journal.entries[0].requestId,null);assert.equal(accessed,0);assert.equal(JSON.stringify(out).includes('PRIVATE_SENTINEL'),false);
});
test('retained RESULT request ID is projected unchanged without any provider query',async()=>{
  const id='18818d9b-212a-43a6-9619-a29d1727644f';
  const h=await load({BookingSummary:[summary],GoogleAdsAttemptJournal:[auth,{...auth,kind:'ATTEMPT'}, {...auth,kind:'RESULT',requestId:id,outcome:'INGESTION_ACKNOWLEDGED',statusCode:200}]});
  const out=await h.api.readWC1038AttributionDiagnostic();assert.equal(out.journal.total,3);assert.equal(out.journal.entries[2].requestId,id);assert.equal(out.journal.entries[2].statusCode,200);assert.equal(h.forbidden.length,0);
});
module.exports={load,summary,auth};
