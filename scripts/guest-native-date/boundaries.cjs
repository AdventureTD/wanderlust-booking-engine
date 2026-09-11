'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const custody=require('./custody.cjs');custody.verify();
const root=custody.ROOT, saved=JSON.parse(fs.readFileSync(__dirname+'/ledger.json'));
const evidence=fs.readFileSync(root+'/velo/backend/guestBookingAllocationEvidence.js','utf8').replace(/^import .*;$/gm,'').replaceAll('export async function ','async function ');
const rules=fs.readFileSync(root+'/velo/backend/guestBookingAllocationSourceRules.js','utf8').replace(/^import .*;$/gm,'').replaceAll('export function ','function ');
const c=vm.createContext({input:JSON.stringify(saved.db)});
vm.runInContext(evidence+'\nglobalThis.E={snapshotRow,bookingRaw,summaryRaw,inventory,bookingFields};',c);
vm.runInContext('(function(){'+rules+'\nglobalThis.R={reservedRows};})()',c);
const cases=[
 ['native-noon-retained-ledger',`const r=native(); const s=E.snapshotRow(r,E.bookingRaw); R.reservedRows([s],db.RoomBookingClaimEvents); if(s.checkIn!=='2027-01-01')throw Error('not civil');`],
 ['nonnoon-minus-ms',`const r=native();r.checkIn=new Date(r.checkIn.getTime()-1); denied(()=>E.snapshotRow(r,E.bookingRaw));`],
 ['nonnoon-midnight',`const r=native();r.checkIn=new Date('2027-01-01T00:00:00.000Z');denied(()=>E.snapshotRow(r,E.bookingRaw));`],
 ['invalid-native',`const r=native();r.checkIn=new Date(NaN);denied(()=>E.snapshotRow(r,E.bookingRaw));`],
 ['corrupt-civil-date',`const r=native();r.checkIn='2027-02-30';denied(()=>R.reservedRows([E.snapshotRow(r,E.bookingRaw)],db.RoomBookingClaimEvents));`],
 ['timestamp-string-not-native',`const r={...db.Bookings[0]};denied(()=>R.reservedRows([E.snapshotRow(r,E.bookingRaw)],db.RoomBookingClaimEvents));`],
 ['mismatched-retained-payload',`const r=native();r.payloadDigest='f'.repeat(64);denied(()=>R.reservedRows([E.snapshotRow(r,E.bookingRaw)],db.RoomBookingClaimEvents));`],
 ['mismatched-stay',`const r=native();r.checkIn=new Date('2027-01-02T12:00:00.000Z');denied(()=>R.reservedRows([E.snapshotRow(r,E.bookingRaw)],db.RoomBookingClaimEvents));`],
 ['missing-completion-ledger',`const r=native();denied(()=>R.reservedRows([E.snapshotRow(r,E.bookingRaw)],db.RoomBookingClaimEvents.filter(r=>r.claimType!=='operation-completion')));`],
 ['legacy-native-arbitrary-time',`const r={_id:'legacy',checkIn:new Date('2027-01-01T05:23:01.123Z'),checkOut:new Date('2027-01-05T08:00:00Z')}; const s=E.snapshotRow(r,E.bookingRaw);if(s.checkIn!=='2027-01-01T05:23:01.123Z')throw Error('legacy changed');E.inventory([s],[]);`],
 ['legacy-native-summary-fallback',`const r={_id:'legacy',bookingNumber:'old'}; const s=E.snapshotRow({_id:'summary',bookingNumber:'old',checkIn:new Date('2027-01-01T05:23:01.123Z'),checkOut:new Date('2027-01-05T08:00:00Z')},E.summaryRaw);const out=E.inventory([r],[s])[0];if(out.checkIn!==s.checkIn||out.checkOut!==s.checkOut)throw Error('fallback changed');`],
 ['legacy-conflicting-fallback-denied',`const r={_id:'legacy',bookingNumber:'old',checkIn:'2027-01-01'};denied(()=>E.inventory([r],[{_id:'summary',bookingNumber:'old',checkIn:'2027-01-02',checkOut:'2027-01-05'}]));`]
];
vm.runInContext(`globalThis.db=JSON.parse(input);globalThis.native=()=>{const r={...db.Bookings[0]};r.checkIn=new Date(r.checkIn);r.checkOut=new Date(r.checkOut);return r;};globalThis.denied=fn=>{let denied=false;try{fn()}catch(e){denied=true;}if(!denied)throw Error('expected fail closed');};`,c);
let failed=0;for(const [id,body] of cases){try{vm.runInContext('(function(){'+body+'})()',c);console.log('PASS '+id);}catch(e){failed++;console.log('FAIL '+id+' '+e.message);}}console.log(JSON.stringify({cases:cases.length,failed}));process.exitCode=failed?1:0;
