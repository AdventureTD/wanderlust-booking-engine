# Wanderlust Booking Engine — Invoicing & Email

After a booking completes, the engine generates a PDF invoice and emails it to
the guest AND to info@wanderlustcaribbean.com.

## What's built & verified
- `booking_engine/invoice.py` — Guest contact capture (name/email/phone +
  validation) and the Invoice data model (builds straight from a Quote breakdown).
- `booking_engine/invoice_pdf.py` — professional PDF (reportlab): logo, Tax ID,
  business details, bill-to, itemized lines with per-line VAT, VAT-by-class,
  Total VAT, Grand Total.
- A REAL sample PDF was generated and visually verified:
  `sample_invoice.pdf` (run `tests/make_sample_invoice.py` to regenerate).

## VALUES I NEED FROM YOU (placeholders until provided — not fabricated)
Edit these in `booking_engine/invoice.py` (the `BUSINESS` dict), or send them
to me and I'll fill them in:
1. **Tax ID** — the exact value to print. Currently "[TAX ID — OWNER TO PROVIDE]".
2. **Logo image** — a PNG/JPG. Either a local path or a public URL. Currently a
   text placeholder renders in its place.
3. **Address** — confirm the exact invoice address (currently "Pt. Dubique,
   Calibishie, Commonwealth of Dominica").
4. **Invoice numbering** — confirm format. Default shown: `WBE-INV-0001`
   (sequential). Tell me if you want a different prefix or to tie it to booking ID.

## Invoice numbering (recommendation)
Use a sequential counter stored in a small Wix collection (e.g. `Counters`)
incremented atomically when an invoice is issued, formatted `WBE-INV-#####`.
Sequential numbers are cleaner for accounting than random IDs. Confirm and I'll
wire it.

## EMAIL DELIVERY — design + the honest catch

The booking lives in Wix Velo. To email a PDF **attachment** to two recipients,
here are the real options (Velo-specific):

### Option A (recommended): transactional email API from Velo backend
Velo backend code can call an external email API over HTTPS (`fetch`) and send
a PDF attachment (base64). Common choices: SendGrid, Mailgun, Postmark, Resend.
- Pros: reliable, supports attachments + multiple recipients, deliverability.
- Needs: an account + API key for one of these services (free tiers exist).
- Flow: booking completes -> backend builds the invoice -> generates PDF ->
  POSTs to the email API with the PDF attached -> to guest + info@.

### Option B: Wix Triggered Emails (built-in)
- Pros: no third-party account.
- Cons: TEMPLATE-based; **attachments are limited/awkward**, and you can't
  freely render a custom itemized PDF into them. Not ideal for a real invoice.
- Honest take: fine for a "booking received" notice, NOT for the PDF invoice.

### The PDF-in-Velo catch (important)
reportlab is Python; **Velo is JavaScript and cannot run reportlab**. So the
PDF generator we built/verified runs in Python, not inside Wix directly. Two
clean ways to bridge this:

  1. **Small external service** (recommended): host the Python PDF generator as
     a tiny endpoint (e.g. a serverless function). Velo POSTs the invoice data,
     the service returns the PDF (or emails it directly). This reuses the exact
     tested Python code — no rewrite, no drift.
  2. **Generate the PDF in JS** inside Velo with a JS PDF lib (e.g. pdfmake).
     Means re-implementing the layout in JS and re-verifying totals match.
     More work and a second codebase to keep in sync.

Recommendation: Option A for email + bridge method 1 for the PDF. One small
external service both generates the PDF (reusing tested Python) and sends the
email via the transactional API. Velo just calls it after a booking. Least
code duplication, and the invoice math stays the single tested source of truth.

## DECISIONS I NEED FROM YOU TO PROCEED
- Which email service do you have / want? (SendGrid, Mailgun, Postmark, Resend,
  or "help me pick".)
- OK to host a tiny external PDF/email service (bridge method 1), or do you want
  it fully inside Wix (method 2, JS rewrite)?
- The 4 placeholder values above (tax ID, logo, address, invoice format).
