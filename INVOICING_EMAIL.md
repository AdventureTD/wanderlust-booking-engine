# Wanderlust Booking Engine — Email (Gmail) + Service Setup

The invoice PDF is emailed via the **Gmail API**, sending AS
info@wanderlustcaribbean.com to the guest with a copy (Cc) to info@.

## What's built & verified
- `booking_engine/gmail_sender.py` — builds the MIME email + PDF attachment and
  sends via Gmail API. The MIME/attachment assembly is VERIFIED (a real .eml with
  a 22 KB PDF attachment was produced — see /tmp/sample_invoice_email.eml during
  the build).
- `booking_engine/invoice_number.py` — sequential WBE-INV-#### numbering
  (verified: WBE-INV-0001 -> 0002).
- `invoice_service.py` — FastAPI service Velo calls (`POST /issue-invoice`),
  secured with a shared secret.

## THE ONE NEW MANUAL STEP: authorize Gmail (gmail.send)
The existing Google token is Drive-only. Gmail sending needs its own scope.

### Step 1 — Enable the Gmail API [YOU]
Google Cloud Console (same "Wanderlust Caribbean" project, id 271935371598):
https://console.cloud.google.com/apis/library/gmail.googleapis.com → **Enable**.

### Step 2 — Authorize the gmail.send scope [YOU + ME]
I generate an auth URL, you open it logged in as the **info@wanderlustcaribbean.com**
Google Workspace account, approve, and paste the code back. I store the token at
`~/.hermes/gmail_token.json`. (Same flow as the Drive auth. Uses the existing
OAuth client in `~/.hermes/google_client_secret.json`.)

> Note: if the OAuth consent screen is in "Testing", add info@wanderlustcaribbean.com
> as a Test user, or publish the app. Tokens for a published app don't expire as fast.

## THE EXTERNAL SERVICE (PDF + email bridge)
Velo (JavaScript) can't run reportlab (Python), so this small service hosts the
tested Python and does PDF + email. Velo just calls it.

### Run locally (dev test)
```
cd ~/wanderlust-booking-engine
uv pip install --python .venv/bin/python3 fastapi uvicorn google-api-python-client google-auth-oauthlib
export WBE_SHARED_SECRET="choose-a-long-random-string"
.venv/bin/uvicorn invoice_service:app --host 0.0.0.0 --port 8080
```

### Deploy (production)
Any Python host works: Google Cloud Run (natural fit — same Google project),
Render, Fly.io, or a small VM. Set two env vars on the host:
- `WBE_SHARED_SECRET` — the secret Velo sends in the `X-WBE-Secret` header.
- `WBE_COUNTER_PATH` — persistent path for the invoice counter (or swap to the
  Wix `Counters` collection in production).
Also copy `~/.hermes/gmail_token.json` + `~/.hermes/google_client_secret.json`
to the host (or mount as secrets).

## HOW VELO CALLS IT (after a booking completes)
In a Velo backend web module (`backend/issueInvoice.web.js`):
```js
import { Permissions, webMethod } from 'wix-web-module';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';

export const issueInvoice = webMethod(Permissions.Anyone, async (guest, quoteBreakdown) => {
  const secret = await getSecret('WBE_SHARED_SECRET');   // store in Wix Secrets Manager
  const res = await fetch('https://YOUR-SERVICE-URL/issue-invoice', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'X-WBE-Secret': secret },
    body: JSON.stringify({ guest, quote_breakdown: quoteBreakdown }),
  });
  if (!res.ok) throw new Error('Invoice service error: ' + res.status);
  return res.json();   // { invoice_number, total, emailed, gmail_message_id }
});
```
The `quote_breakdown` is exactly what `pricing.web.js`'s `buildQuote` returns
(same shape as the Python `Quote.breakdown()` the service expects).

## SECURITY NOTES
- Never expose the service without the shared-secret check.
- Store the secret in Wix **Secrets Manager** (not in page code).
- Keep `gmail_token.json` + `google_client_secret.json` off the public web.
- The Drive Places API key and these tokens should be least-privilege.

## STATUS
- [x] PDF invoice (real, visually verified) with logo, Tax ID 1051705, address
- [x] Gmail sender + MIME/attachment (verified via real .eml)
- [x] Sequential invoice numbering (verified)
- [x] External service endpoint (FastAPI)
- [ ] Enable Gmail API + authorize gmail.send  <-- NEXT (needs you)
- [ ] Deploy the service to a host + set env vars
- [ ] Wire the Velo call + store the secret in Wix Secrets Manager
- [ ] Live end-to-end test (real booking -> real email received)
