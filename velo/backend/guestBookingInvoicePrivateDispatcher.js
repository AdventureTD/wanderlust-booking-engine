// Private in-process bytes interface only; no HTTP handler or activation.
// Auth retains the operation/payload and owns the actual bound journal edge.
export { dispatchGuestInvoiceJournal } from 'backend/guestBookingInvoiceTransportAuth';
