'use strict';
// Permanent actual-page regression from booking-page-final-promo-probe.cjs.
// Actual issuer, original signed quote, inert revision/catalog discrepancy; no seeded acceptance.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {vector}=require('./business.cjs');
const {harness}=require('./page-wiring.cjs');
(async()=>{
 const revision=JSON.parse(vector.revisionRow.revisionBytes);
 revision.promos=[{code:'SAVE',discountRate:0.1,minimumNights:1,startDate:null,endDate:null}];
 vector.revisionRow.revisionBytes=JSON.stringify(revision);
 const config=JSON.parse(vector.secrets.WBE_GUEST_BOOKING_ISSUER_CONFIG);
 config.revisionDigest=crypto.createHash('sha256').update('wbe.financial-revision.v1\0'+vector.revisionRow.revisionBytes).digest('hex');
 vector.secrets.WBE_GUEST_BOOKING_ISSUER_CONFIG=JSON.stringify(config);
 let offer;
 const h=await harness({promo:async()=>({valid:true,discount:0.5,description:'SAVE: 50% off / $200 savings'}),after:async(kind,result)=>{if(kind==='prepare')offer=result;}});
 h.el('#promoCode').value='SAVE'; await h.el('#promoCode').fire('input'); await h.el('#btnApplyPromo').fire();
 assert.equal(h.el('#promoDiscountText').text,'Promo Code (SAVE): -200.00 (-50%)');
 await h.click();
 assert.equal(offer.status,'OFFER'); assert.equal(offer.display.totals.discountCents,4000); assert.equal(offer.display.totals.grandTotalCents,42300);
 assert.equal(h.el('#btnContinue').label,'Confirm booking');
 assert.equal(h.el('#promoDiscountText').text,'Promo Code (SAVE): -40.00','Accepted promo row must replace preliminary economics without inventing a nominal percentage');
 assert.equal(h.el('#promoAmount').text,'($40.00)');
 assert.equal(h.el('#promoStatus').text,'SAVE applied to this offer.');
 assert.equal(h.el('#promoDescription').text,''); assert.equal(h.el('#promoDescription').hidden,true);
 for(const id of ['#promoAmount','#promoDiscountText']) assert.equal(h.el(id).hidden,false);
 assert.equal(h.el('#promoDiscountRow').collapsed,false);
 assert.equal(h.el('#grandTotal').text,'$423.00');
 assert.deepEqual(h.calls,{prepare:1,confirm:0,refresh:0,legacy:0,external:0});
 assert.equal(h.s.f.snapshot().GuestBookingAcceptances.length,0);
 console.log(JSON.stringify({id:'PROMO_DISPLAY01',status:'PASS',promoDiscountText:h.el('#promoDiscountText').text,promoStatus:h.el('#promoStatus').text,total:h.el('#grandTotal').text,calls:h.calls}));
 // Reprepare without a promo after visible prior catalog/accepted labels.
 h.el('#promoCode').value=''; await h.el('#promoCode').fire('input'); await h.el('#btnApplyPromo').fire(); await h.click();
 assert.equal(offer.status,'OFFER'); assert.equal(offer.display.totals.discountCents,0);
 for(const id of ['#promoAmount','#promoDiscountText','#promoStatus','#promoDescription']) assert.equal(h.el(id).text,'',id);
 for(const id of ['#promoAmount','#promoDiscountText','#promoDescription']) assert.equal(h.el(id).hidden,true,id);
 assert.equal(h.el('#promoDiscountRow').collapsed,true);
 assert.equal(h.calls.confirm,0); assert.equal(h.s.f.snapshot().GuestBookingAcceptances.length,0);
 console.log(JSON.stringify({id:'PROMO_DISPLAY_CLEAR01',status:'PASS'}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
