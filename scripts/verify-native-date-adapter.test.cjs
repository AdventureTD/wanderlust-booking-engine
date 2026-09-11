'use strict';
// Actual store in a same-realm VM; inert typed SDK, not hosted Wix.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../velo/backend/guestBookingCompletionStore.js'),'utf8').replace("import wixData from 'wix-data';",'').replace("import { Buffer } from 'buffer';",'').replaceAll('export function ','function ');
const fixtures={Bookings:{_id:'pb1-cg2_'+'A'.repeat(43)+'_p-r1',roomCode:'penthouse_apartment',assignedRoom:1,quantity:1,checkIn:'2028-02-29',checkOut:'2028-03-01',bookingNumber:'B'+'a'.repeat(48),operationId:'cg2_'+'A'.repeat(43)+'_p',payloadDigest:'b'.repeat(64),guests:2,note:'',status:'pending'},BookingSummary:{_id:'gbs1-'+'a'.repeat(64),bookingNumber:'B'+'a'.repeat(48),bookingDate:'2026-09-11T18:36:45.440Z',checkIn:'2028-02-29',checkOut:'2028-03-01',guestName:'Inert Guest',guestEmail:'FiXture@example.test',guestPhone:'1234567',marketSource:'',notes:'',packageTitle:'Fixture',roomCount:1,status:'pending'}};
async function run(c,mutation='',fault='',candidateMutation=''){
return JSON.parse(await vm.runInNewContext(`(async()=>{
const c=${JSON.stringify(c)},candidate=${JSON.stringify(fixtures[c])},fields=c==='Bookings'?['checkIn','checkOut']:['checkIn','checkOut','bookingDate'];
let retained=null,attempts=0,charged=0,reserved=0,getters=0;
const clone=r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v instanceof Date?new Date(v.getTime()):v]));
const wixData={async insert(c,row){attempts++;for(const k of fields){if(!(row[k] instanceof Date))throw Error('TYPED_REJECTION');assert.equal(row[k].toISOString(),k==='bookingDate'?candidate[k]:candidate[k]+'T12:00:00.000Z');}if(${JSON.stringify(fault)}==='absent')throw Error('failed');retained=clone(row);${mutation};if(${JSON.stringify(fault)}==='lostAck')throw Error('lost');return clone(row);},query(){return {eq(){return this},gt(){return this},ascending(){return this},limit(){return this},async find(){if(${JSON.stringify(fault)}==='readFail')throw Error('failed');return {items:retained?[retained]:[],hasNext(){return false}}}}}};
${source}
const scope={reserveExact(){},chargeBytes(n){charged=n},measure(c,f){return f()},reserveMutationReadback(c,id,n){reserved=n;return {}},startMutation(){},beginReadback(){},settleReadback(t,n){charged=n},poison(){}};
${candidateMutation}
const api=createGuestBookingCompletionStore(scope);
if(${JSON.stringify(fault)}==='selected')api.reserveSelection(c,candidate);
if(${JSON.stringify(fault)}==='duplicate'){retained=clone(candidate);for(const k of fields)retained[k]=new Date(k==='bookingDate'?candidate[k]:candidate[k]+'T12:00:00.000Z');wixData.insert=async()=>{attempts++;throw Error('duplicate')};}
const result=await api.insert(c,candidate);
if(result.status==='FOUND'){assert.equal(canonicalGuestBookingCompletionRecord(c,result.record),canonicalGuestBookingCompletionRecord(c,candidate));assert.equal(charged,Buffer.byteLength(JSON.stringify([retained])));assert.ok(charged<=reserved);const fresh=createGuestBookingCompletionStore(scope);assert.equal((await fresh.exact(c,candidate._id)).status,'FOUND');assert.equal((await fresh.scan(c,'bookingNumber',candidate.bookingNumber)).status,'FOUND');}
return JSON.stringify({status:result.status,attempts,getters,charged,reserved});})()`,{Buffer,assert}));}
for(const c of Object.keys(fixtures)){
 test(c+' native write, detached readback, canonical equality and byte charging',async()=>assert.equal((await run(c)).status,'FOUND'));
 for(const fault of ['selected','duplicate'])test(c+' '+fault+' retains exact canonical target',async()=>assert.equal((await run(c,'',fault)).status,'FOUND'));
 test(c+' applied then throw reconciles',async()=>assert.equal((await run(c,'','lostAck')).status,'FOUND'));
 for(const fault of ['absent','readFail'])test(c+' '+fault,async()=>assert.equal((await run(c,'',fault)).status,'UNKNOWN'));
 for(const mutation of ["retained.checkIn=new Date('2028-02-29T00:00:00.000Z')","retained.checkOut=new Date('2028-03-01T12:00:00.001Z')","retained.checkIn=new Date(NaN)","retained.checkIn.x=1","retained.checkIn=new (class extends Date {})('2028-02-29T12:00:00.000Z')","retained.checkIn='2028-02-29'","Object.defineProperty(retained,'checkIn',{enumerable:true,get(){getters++;throw Error('getter')}})","retained.note=new Date()","retained.checkIn=new Date('2028-03-01T12:00:00.000Z')"]){test(c+' rejects '+mutation,async()=>{const r=await run(c,mutation);assert.equal(r.status,'INTEGRITY');assert.equal(r.getters,0)});}
 for(const change of ["candidate.checkIn='2027-02-29'","candidate.checkIn='2028-02-30'","candidate.checkIn='2028-2-29'","candidate.checkIn=new Date('2028-02-29T12:00:00.000Z')"]){test(c+' rejects candidate '+change,async()=>{const r=await run(c,'','',change);assert.equal(r.status,'INTEGRITY');assert.equal(r.attempts,0)});}
}
for(const mutation of ["retained.bookingDate=new Date('2026-09-11T18:36:45.441Z')","retained.bookingDate=new Date(NaN)","retained.bookingDate=new Date('2026-09-11T12:00:00.000Z')"]){test('Summary exact instant '+mutation,async()=>assert.equal((await run('BookingSummary',mutation)).status,'INTEGRITY'));}
for(const value of ['2026-09-11T18:36:45.4401Z','2026-09-11T18:36:45Z','2026-02-30T18:36:45.440Z'])test('Summary rejects noncanonical instant '+value,async()=>{const r=await run('BookingSummary','','','candidate.bookingDate='+JSON.stringify(value));assert.equal(r.status,'INTEGRITY');assert.equal(r.attempts,0)});
