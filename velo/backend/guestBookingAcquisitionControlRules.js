import { Buffer } from 'buffer';

// Private reviewed control schemas. Shape recognition is never authority.
const keys=Reflect.ownKeys,desc=Object.getOwnPropertyDescriptor,proto=Object.getPrototypeOf;
const create=Object.create,same=Object.is,stringify=JSON.stringify,apply=Reflect.apply;
const objectProto=Object.prototype,dateProto=Date.prototype,getTime=Date.prototype.getTime;
const fields={admission:['_id','acquisitionProtocolVersion','kind','acceptanceId','manifestId','manifestDigest','manifestCanonical'],'group-start':['_id','acquisitionProtocolVersion','kind','admissionId','manifestDigest','operationId','direction'],root:['_id','acquisitionProtocolVersion','kind','admissionId','manifestDigest','operationId','operationIdentityId'],gate:['_id','acquisitionProtocolVersion','kind','admissionId','manifestDigest','rootId','operationId','index','resourceClaimId','direction'],'cart-direction':['_id','acquisitionProtocolVersion','kind','admissionId','manifestDigest','direction','causeOperationId','causeIndex','causeResourceClaimId']};
function fail(){throw Error('Invalid acquisition control');}
function hex(v){return typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);}
function encoded(v){return typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v)&&Buffer.from(v,'base64url').length===32&&Buffer.from(v,'base64url').toString('base64url')===v;}
function op(v){return typeof v==='string'&&/^cg2_[A-Za-z0-9_-]{43}_[pta]$/.test(v)&&encoded(v.slice(4,47));}
function index(v){return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&!same(v,-0);}
function resource(v){return typeof v==='string'&&/^rc1-\d{8}-[su][1-5]-\d{6}-a$/.test(v);}
export function isGuestBookingAcquisitionControlId(id){
 if(typeof id!=='string')return false;
 if(id.startsWith('ra2-cart-'))return hex(id.slice(9));
 if(id.startsWith('ra2-direction-'))return hex(id.slice(14));
 if(id.startsWith('ra2-start-'))return op(id.slice(10));
 if(id.startsWith('ra2-root-'))return op(id.slice(9));
 if(id.startsWith('ra2-gate-')){const match=/^(cg2_[A-Za-z0-9_-]{43}_[pta])-p(0|[1-9][0-9]*)$/.exec(id.slice(9));return !!match&&op(match[1])&&index(Number(match[2]))&&String(Number(match[2]))===match[2];}
 return false;
}
function snapshot(value,metadata){
 if(value===null||typeof value!=='object'||Array.isArray(value))fail();
 const p=proto(value);if(p!==null&&p!==objectProto)fail();
 const names=keys(value),out=create(null),ds=[],dates=[];
 for(const k of names){
  const d=desc(value,k);if(typeof k!=='string'||!d||!desc(d,'value')||!d.enumerable)fail();ds.push(d);
  const v=d.value;
  if(metadata&&k==='_owner'){if(typeof v!=='string'||v.length>256)fail();}
  else if(metadata&&(k==='_createdDate'||k==='_updatedDate')){if(!v||proto(v)!==dateProto||keys(v).length)fail();const t=apply(getTime,v,[]);if(!Number.isSafeInteger(t))fail();dates.push([v,t]);}
  else {if(typeof v!=='string'&&typeof v!=='number'&&v!==null)fail();out[k]=v;}
 }
 const again=keys(value);if(again.length!==names.length)fail();
 for(let i=0;i<names.length;i++){const a=ds[i],b=desc(value,names[i]);if(again[i]!==names[i]||!b||!desc(b,'value')||!same(a.value,b.value)||a.enumerable!==b.enumerable||a.writable!==b.writable||a.configurable!==b.configurable)fail();}
 if(proto(value)!==p)fail();for(const [v,t]of dates)if(proto(v)!==dateProto||keys(v).length||apply(getTime,v,[])!==t)fail();
 return out;
}
export function decodeGuestBookingAcquisitionControl(value,metadata=false){
 const r=snapshot(value,metadata),f=fields[r.kind];if(!f||keys(r).length!==f.length)fail();for(const k of f)if(!desc(r,k))fail();
 if(r.acquisitionProtocolVersion!==2||!isGuestBookingAcquisitionControlId(r._id)||!hex(r.manifestDigest))fail();
 if(r.kind==='admission'){
  if(!hex(r.acceptanceId)||r._id!=='ra2-cart-'+r.acceptanceId||typeof r.manifestId!=='string'||!r.manifestId.startsWith('ga2_')||!encoded(r.manifestId.slice(4))||typeof r.manifestCanonical!=='string')fail();
 }else{
  if(typeof r.admissionId!=='string'||!r.admissionId.startsWith('ra2-cart-')||!hex(r.admissionId.slice(9)))fail();
  if(r.kind==='cart-direction'){
   if(r._id!=='ra2-direction-'+r.admissionId.slice(9))fail();
   if(r.direction==='commit-rows'){if(r.causeOperationId!==null||r.causeIndex!==null||r.causeResourceClaimId!==null)fail();}
   else if(r.direction!=='compensate'||!op(r.causeOperationId)||!index(r.causeIndex)||!resource(r.causeResourceClaimId))fail();
  }else{
   if(!op(r.operationId))fail();
   if(r.kind==='group-start'&&(r._id!=='ra2-start-'+r.operationId||!['start','skip'].includes(r.direction)))fail();
   if(r.kind==='root'&&(r._id!=='ra2-root-'+r.operationId||r.operationIdentityId!=='rc1-op-'+r.operationId+'-a'))fail();
   if(r.kind==='gate'&&(!index(r.index)||r._id!=='ra2-gate-'+r.operationId+'-p'+String(r.index)||r.rootId!=='ra2-root-'+r.operationId||!resource(r.resourceClaimId)||!['acquire','seal'].includes(r.direction)))fail();
  }
 }
 return r;
}
export function canonicalGuestBookingAcquisitionControl(value){
 const r=decodeGuestBookingAcquisitionControl(value),f=fields[r.kind];
 return stringify(['wbe.accepted-acquisition-control',2,r.kind,f.map(k=>r[k])]);
}
