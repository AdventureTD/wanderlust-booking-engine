import { Buffer } from 'buffer';
import { canonicalizeGuestBookingPurchaseInput } from 'backend/guestBookingPurchaseInput';
import { calculateGuestBookingFinancials } from 'backend/guestBookingFinancialCalculation';
import { readLockedPricingQuoteAuthority } from 'backend/lockedPricingQuoteAuthority';
import { readGuestBookingIssuerAuthority, acceptanceDigest, acceptanceTime, boundedJson, exactFields, buildGuestBookingAcceptanceRoot } from 'backend/guestBookingIssuerAuthority';

const policy='backend-complete-validation-v2';
function day(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('date');const n=Date.parse(s+'T00:00:00Z');if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==s)throw Error('date');return n/86400000;}
function positive(n,zero=false){if(typeof n!=='number'||!Number.isFinite(n)||n<0||(!zero&&n===0)||Object.is(n,-0))throw Error('rate');return n;}
function purchase(canonical){
 if(typeof canonical!=='string'||canonical.length===0||Buffer.byteLength(canonical,'utf8')>262144)throw Error('input size');
 // Purchase has its own ASCII-escaped encoding; equality below is authoritative.
 const t=JSON.parse(canonical);
 if(!Array.isArray(t)||t.length!==10||t[0]!=='wbe.guest-purchase-input'||t[1]!==1)throw Error('input');
 const p={v:1,checkIn:t[2],checkOut:t[3],packageId:t[4],pricingQuoteToken:t[5],promoCode:t[6],guestName:t[7][0],guestEmail:t[7][1],guestPhone:t[7][2],dialingCode:t[7][3],note:t[7][4],marketSource:t[7][5],gclid:t[8][0],gbraid:t[8][1],wbraid:t[8][2],msclkid:t[8][3],priceGroups:t[9].map(g=>({roomCode:g[0],quantity:g[1],guests:g[2]}))};
 if(canonicalizeGuestBookingPurchaseInput(p)!==canonical)throw Error('input canonical');return p;
}
function economics(inputCanonical,revisionBytes,quote){
 const p=purchase(inputCanonical),nights=day(p.checkOut)-day(p.checkIn);
 const r=exactFields(boundedJson(revisionBytes,24000),['v','package','penthouseRoomFee','propertyFeeRate','taxRateAccommodation','taxRateStandard','promos']);
 const pkg=exactFields(r.package,['id','nights','baseRate','priceModifier']);
 if(r.v!==1||pkg.id!==p.packageId||pkg.nights!==nights)throw Error('package applicability');
 positive(pkg.baseRate,true);positive(pkg.priceModifier);
 const c=exactFields(quote,['v','nonce','issuedAt','expiresAt','checkIn','checkOut','nights','packageId','packageTitle','baseRate','priceModifier','totalPerPerson']);
 if(c.v!==1||c.checkIn!==p.checkIn||c.checkOut!==p.checkOut||c.nights!==nights||c.packageId!==p.packageId||typeof c.packageTitle!=='string'||c.packageTitle.length>4096||c.baseRate!==pkg.baseRate||c.priceModifier!==pkg.priceModifier||typeof c.nonce!=='string'||!/^[a-f0-9]{24}$/.test(c.nonce)||!Number.isSafeInteger(c.issuedAt)||c.issuedAt<0||!Number.isSafeInteger(c.expiresAt)||c.expiresAt-c.issuedAt!==3600000)throw Error('quote');
 positive(c.totalPerPerson,true);
 // Preserve legacy positive settings; zero does not silently remove fallback taxes.
 positive(r.propertyFeeRate);positive(r.taxRateAccommodation);positive(r.taxRateStandard);positive(r.penthouseRoomFee,true);
 if(!Array.isArray(r.promos)||r.promos.length>100)throw Error('promos');let promoDiscountRate=0,matched=false;const seen=new Set();
 for(const value of r.promos){const promo=exactFields(value,['code','discountRate','minimumNights','startDate','endDate']);
  if(typeof promo.code!=='string'||promo.code.length<1||promo.code.length>256||promo.code.trim().toUpperCase()!==promo.code||seen.has(promo.code))throw Error('promo code');seen.add(promo.code);
  positive(promo.discountRate);if(promo.discountRate>1||!Number.isSafeInteger(promo.minimumNights)||promo.minimumNights<0)throw Error('promo');
  const start=promo.startDate===null?null:day(promo.startDate),end=promo.endDate===null?null:day(promo.endDate);if(start!==null&&end!==null&&start>end)throw Error('promo interval');
  if(p.promoCode.trim().toUpperCase()===promo.code){if(nights<promo.minimumNights||(start!==null&&day(p.checkIn)<start)||(end!==null&&day(p.checkOut)-1>end))throw Error('promo stay');matched=true;promoDiscountRate=promo.discountRate;}
 }
 if(p.promoCode!==''&&!matched)throw Error('missing promo');
 const factors={v:1,nights,totalPerPerson:c.totalPerPerson,penthouseRoomFee:p.priceGroups.some(g=>g.roomCode==='penthouse_apartment')?r.penthouseRoomFee:null,propertyFeeRate:r.propertyFeeRate,taxRateAccommodation:r.taxRateAccommodation,taxRateStandard:r.taxRateStandard,promoDiscountRate,priceGroups:p.priceGroups};
 const calculation=calculateGuestBookingFinancials(factors);if(calculation==='DENIED'||calculation.totals.totalRooms>4)throw Error('calculation');return {factors,calculation};
}
export function validateGuestBookingOfferCapsule(capsule){
 try {
  const o=exactFields(boundedJson(capsule),['v','policy','inputCanonical','quote','revisionId','revisionDigest','revisionBytes','factors','calculation','bookingNumber','issuedAtMs','offerExpiresAtMs']);
  if(o.v!==2||o.policy!==policy||typeof o.revisionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(o.revisionId)||acceptanceDigest('wbe.financial-revision.v1',o.revisionBytes)!==o.revisionDigest||typeof o.bookingNumber!=='string'||!/^[A-Z][A-Z0-9-]{0,15}[a-f0-9]{48}$/.test(o.bookingNumber))throw Error('offer');
  if(!Number.isSafeInteger(o.issuedAtMs)||o.issuedAtMs<o.quote.issuedAt||!Number.isSafeInteger(o.offerExpiresAtMs)||o.offerExpiresAtMs!==o.quote.expiresAt||o.issuedAtMs>=o.offerExpiresAtMs)throw Error('interval');
  const expected=economics(o.inputCanonical,o.revisionBytes,o.quote);
  if(JSON.stringify(expected.factors)!==JSON.stringify(o.factors)||JSON.stringify(expected.calculation)!==JSON.stringify(o.calculation))throw Error('components');
  const t=purchase(o.inputCanonical);
  // Original signed quote bytes remain bound, including title and serialization.
  const payload=JSON.parse(Buffer.from(t.pricingQuoteToken.split('.')[0],'base64').toString('utf8'));
  if(JSON.stringify(payload)!==JSON.stringify(o.quote))throw Error('quote bytes');
  return {offer:o,binding:{v:1,intentDigest:acceptanceDigest('wbe.complete-offer.v2',capsule),quoteDigest:acceptanceDigest('wbe.quote.v1',t.pricingQuoteToken),quoteExpiresAtMs:o.offerExpiresAtMs,roomQuantities:t.priceGroups.map(g=>g.quantity)}};
 }catch{return 'DENIED';}
}
export async function issueGuestBookingOffer(input){
 try {
  const inputCanonical=canonicalizeGuestBookingPurchaseInput(input);if(inputCanonical==='DENIED')return 'DENIED';
  const p=purchase(inputCanonical),nights=day(p.checkOut)-day(p.checkIn);
  const quote=await readLockedPricingQuoteAuthority(p.pricingQuoteToken,{packageId:p.packageId,checkIn:p.checkIn,checkOut:p.checkOut,nights});if(quote==='DENIED')return 'DENIED';
  const quoteCheckedAtMs=acceptanceTime();
  const authority=await readGuestBookingIssuerAuthority();if(authority==='DENIED')return 'DENIED';
  const e=economics(inputCanonical,authority.revisionBytes,quote.claims),issuedAtMs=acceptanceTime();if(issuedAtMs<quoteCheckedAtMs)return 'DENIED';
  const capsule=JSON.stringify({v:2,policy,inputCanonical,quote:quote.claims,revisionId:authority.revisionId,revisionDigest:authority.revisionDigest,revisionBytes:authority.revisionBytes,factors:e.factors,calculation:e.calculation,bookingNumber:authority.bookingNumber,issuedAtMs,offerExpiresAtMs:quote.claims.expiresAt});
  const checked=validateGuestBookingOfferCapsule(capsule);if(checked==='DENIED')return 'DENIED';
  // Fixed-width IDs/digests and latest legal qualification bound the exact shared root.
  const upper=buildGuestBookingAcceptanceRoot(capsule,checked.offer,{intentId:'0'.repeat(64),audience:authority.keys.audience,intentDigest:checked.binding.intentDigest,quoteDigest:checked.binding.quoteDigest,issuedAtMs,expiresAtMs:quote.claims.expiresAt},authority.keys.activeKid,quote.claims.expiresAt-1);
  boundedJson(JSON.stringify(upper),160000);
  const token=authority.keys.service.prepareBootstrap({intentBinding:checked.binding,nowMs:issuedAtMs});if(token==='DENIED')return 'DENIED';
  return {token,capsule,display:e.calculation,packageTitle:quote.claims.packageTitle,offerExpiresAtMs:quote.claims.expiresAt};
 }catch{return 'DENIED';}
}
