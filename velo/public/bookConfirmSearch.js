import { prepareGuestBookingSummary, confirmGuestBookingSummary, readGuestBookingSummaryStatus } from 'backend/guestBookingSummaryService.web';

// Local replacement controller; not mounted by the legacy production page.
export function mountBookConfirmSearch(ui) {
  let generation=0, retained=null, confirming=false;
  function render(result) {
    const state={status:result.status};
    if(result.status==='OFFER')Object.assign(state,{display:result.display,packageTitle:result.packageTitle,offerExpiresAtMs:result.offerExpiresAtMs});
    if(result.status==='CONFIRMED'){
      state.bookingNumber=result.bookingNumber;
      state.invoiceStatus=['PENDING','PROVIDER_ACCEPTED','OWNER_REVIEW_REQUIRED'].includes(result.invoiceStatus)?result.invoiceStatus:'UNAVAILABLE';
    }
    ui.render(state);
  }
  ui.onConfirm(async () => {
    if(!retained||confirming)return;
    const current=retained,revision=generation;confirming=true;
    try {
      const result=await confirmGuestBookingSummary(current);
      if(revision===generation&&retained===current)render(result);
    } catch {if(revision===generation)render({status:'UNKNOWN'});}
    finally {if(revision===generation)confirming=false;}
  });
  ui.onRefresh(async () => {
    if(!retained)return;
    const current=retained,revision=generation;
    try {
      const result=await readGuestBookingSummaryStatus(current);
      if(revision===generation&&retained===current)render(result);
    } catch {if(revision===generation)render({status:'UNKNOWN'});}
  });
  return Object.freeze({
    invalidate(){generation++;retained=null;confirming=false;render({status:'STALE'});},
    async prepare(snapshot){
      const revision=++generation;retained=null;confirming=false;render({status:'PREPARING'});
      try {
        const result=await prepareGuestBookingSummary(snapshot);
        if(revision!==generation)return;
        if(result.status==='OFFER')retained=result.credential;
        render(result);
      }catch{if(revision===generation)render({status:'UNKNOWN'});}
    }
  });
}
