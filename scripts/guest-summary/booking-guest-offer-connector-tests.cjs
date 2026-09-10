'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture}=require('./booking-guest-offer-fixture.cjs');const {load,root}=require('./booking-guest-offer-loader.cjs');
const vector=JSON.parse(fs.readFileSync(path.join(__dirname,'booking-guest-offer-public-vector.json'),'utf8'));
const file=path.join(root,'velo/backend/guestBookingSummaryConnector.js');
const selected=process.argv.slice(2);assert.equal(selected.length,1);assert.ok(['C01','C02','C03'].includes(selected[0]));
function controller(api){assert.ok(fs.existsSync(file),'C01 disconnected connector must exist');let s=fs.readFileSync(file,'utf8');s=s.replace("import { issueGuestBookingOffer } from 'backend/guestBookingOfferIssuer';",'const issueGuestBookingOffer=api.issue;').replace("import { acceptGuestBookingOffer } from 'backend/guestBookingAcceptance';",'const acceptGuestBookingOffer=api.accept;').replace('export function createGuestBookingSummaryConnector','function createGuestBookingSummaryConnector');return vm.compileFunction(s+'\nreturn createGuestBookingSummaryConnector();',['api'],{filename:file})(api);}
function setup(){const f=fixture();f.rows.GuestBookingFinancialRevisions.push(structuredClone(vector.revisionRow));Object.assign(f.secretValues,vector.secrets);const clock={now:vector.now};const api=load(f,clock);const p=structuredClone(vector.purchase);delete p.priceGroups;p.summaryRooms=structuredClone(vector.summaryRooms);return {f,clock,api,p};}
(async()=>{
if(selected[0]==='C02'){
 const {f,api,p}=setup();const c=controller(api);assert.equal(typeof c.invalidate,'function','C02 edits must invalidate displayed/pending offers');
 const old=await c.prepare(p);c.invalidate();assert.equal((await c.confirm(old)).status,'DENIED');
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let once=true;
 f.hooks.beforeSecret=async()=>{if(once){once=false;entered();await gate;}};
 const watchdog=setTimeout(()=>{release();throw Error('C02 watchdog');},3000);
 try{const pending=c.prepare(p);await started;c.invalidate();release();assert.equal((await pending).status,'STALE');assert.equal((await c.confirm(old)).status,'DENIED');assert.equal(f.rows.GuestBookingAcceptances.length,0);}finally{release();clearTimeout(watchdog);}
 console.log('PASS C02 invalidation and stale asynchronous actual issuer; COMPLETE 1');return;
}
if(selected[0]==='C03'){
 const {f,api,p,clock}=setup();let issued;const c=controller({issue:async input=>issued=await api.issue(input),accept:api.accept});const offer=await c.prepare(p);assert.equal(offer.status,'OFFER');
 const initial=structuredClone(f.rows);const traceStart=f.trace.length;
 assert.equal((await c.confirm({...offer})).status,'DENIED');
 assert.equal((await api.accept(issued.token,issued.capsule+' ')).status,'DENIED');
 const parts=issued.token.split('.');parts[3]=(parts[3][0]==='A'?'B':'A')+parts[3].slice(1);assert.equal((await api.accept(parts.join('.'),issued.capsule)).status,'DENIED');
 clock.now=offer.offerExpiresAtMs;assert.equal((await c.confirm(offer)).status,'DENIED');assert.deepEqual(f.rows,initial);assert.equal(f.trace.slice(traceStart).filter(x=>x.op==='insert').length,0);
 clock.now=vector.now;f.hooks.beforeFind=name=>{if(name==='GuestBookingAcceptances')throw Error('unreadable ACK');};
 assert.equal((await c.confirm(offer)).status,'UNKNOWN');assert.equal(f.rows.GuestBookingAcceptances.length,1);const retained=structuredClone(f.rows);delete f.hooks.beforeFind;
 assert.equal((await c.confirm(offer)).status,'ACCEPTED_PENDING');assert.deepEqual(f.rows,retained);
 const other=setup();const d=controller(other.api);const delayed=await d.prepare(other.p);other.f.hooks.beforeInsert=()=>{other.clock.now=delayed.offerExpiresAtMs+1;};assert.equal((await d.confirm(delayed)).status,'ACCEPTED_PENDING');assert.ok(other.f.rows.GuestBookingAcceptances[0].validatedAtMs<delayed.offerExpiresAtMs);
 assert.ok(f.trace.filter(x=>x.op==='insert').every(x=>x.collection==='GuestBookingAcceptances'));console.log('PASS C03 mutation/expiry zero inserts; UNKNOWN same-root retry; qualified delayed persistence; COMPLETE 1');return;
}
const {f,api,p}=setup();let issued;const c=controller({issue:async input=>issued=await api.issue(input),accept:api.accept});
const offer=await c.prepare(p);assert.equal(offer.status,'OFFER');assert.equal(f.rows.GuestBookingAcceptances.length,0);assert.deepEqual(offer.display,issued.display);assert.ok(Object.isFrozen(offer.display.groups[0]));assert.equal(offer.display.groups.length,2);assert.deepEqual(offer.display.groups.map(g=>[g.roomCode,g.quantity,g.guests]),[['adventure_suite',1,2],['adventure_suite',1,2]]);assert.equal(offer.display.totals.grandTotalCents,47000);
assert.equal((await c.confirm(offer)).status,'ACCEPTED_PENDING');assert.equal(f.rows.GuestBookingAcceptances.length,1);assert.equal(f.rows.GuestBookingAcceptances[0].capsule,issued.capsule);const retained=structuredClone(f.rows);assert.equal((await c.confirm(offer)).status,'ACCEPTED_PENDING');assert.deepEqual(f.rows,retained);assert.ok(f.trace.filter(x=>x.op==='insert').every(x=>x.collection==='GuestBookingAcceptances'));console.log('PASS C01 actual issuer -> exact display -> explicit confirm -> actual acceptance; pending replay same root; COMPLETE 1');})().catch(e=>{console.error(e);process.exitCode=1;});
