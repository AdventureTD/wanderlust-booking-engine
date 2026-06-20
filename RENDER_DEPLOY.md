# Render Free Tier Deploy Guide — Wanderlust Invoice Service

This guide deploys the Python invoice/PDF service to https://render.com (free tier — sleep mode after 15 min idle, auto-wakes on first request).

## What this service does
- Wix calls it at `/issue-invoice` with guest + pricing data.
- It generates a PDF invoice (with your logo) and returns it as base64.
- Wix uploads the PDF to Wix Media and stores the invoice number on the Booking row.
- Optionally: emails the PDF to the guest (via Gmail API — configured separately).

---

## Prerequisites before you start
- [ ] A GitHub account (free). You will push this repo there.
- [ ] A Render account (free). Sign up at https://dashboard.render.com/register
- [ ] Your current `~/.hermes/gmail_token.json` file — for email sending (optional, can be added later).

---

## Step 1 — Push this repo to GitHub

Open Terminal or PowerShell in the project folder and run:

```bash
cd /home/wanderlust/wanderlust-booking-engine
git init
cp .gitignore .gitignore.bak 2>/dev/null; true
cat > .gitignore << 'EOF'
.venv/
__pycache__/
*.pyc
.env
*.pdf
*.egg-info/
.pytest_cache/
.mypy_cache/
.DS_Store
*.bak
EOF
git add .
git commit -m "Initial deploy: invoice service + booking engine"
```

Then create a new empty repo on GitHub (https://github.com/new), name it something like `wanderlust-booking-engine`, and push:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/wanderlust-booking-engine.git
git branch -M main
git push -u origin main
```

---

## Step 2 — Create the Render Web Service (Manual — recommended)

1. Go to https://dashboard.render.com/
2. Click the blue **New** button (top left) → **Web Service**
3. Connect your GitHub account if asked, then select your `wanderlust-booking-engine` repo.
4. Fill out the form exactly as follows:

| Field | Value |
|---|---|
| **Name** | `wanderlust-invoice-service` |
| **Region** | Pick the closest to you (e.g., Ohio for US East) |
| **Branch** | `main` |
| **Runtime** | **Python 3** |
| **Build Command** | `pip install -r requirements-deploy.txt` |
| **Start Command** | `bash start.sh` |
| **Plan** | **Free** |

5. Click **Advanced** to expand it, then add these environment variables:

| Variable | Value | Notes |
|---|---|---|
| `PYTHONPATH` | `/opt/render/project/src` | Tells Python where to find the modules |
| `WBE_SHARED_SECRET` | Click **Generate** to get a random string | SAVE THIS — you need it for Wix |
| `WBE_COUNTER_PATH` | `/tmp/invoice_counter.json` | Temporary file (resets on restart; acceptable for free tier) |
| `GMAIL_TOKEN_B64` | *(leave blank for now)* | See Step 5 if you want email sending |

6. Click **Create Web Service**
7. Render will run the build (~1–2 minutes). Wait for the green checkmark.

---

## Step 3 — Test the health endpoint

Once the service is live (green checkmark in Render dashboard), open this URL in your browser:

```
https://wanderlust-invoice-service-YOURTHING.onrender.com/health
```

(Your exact URL is on the Render dashboard under the service name.)

You should see: `{"status":"ok"}`

If you see an error, check the **Logs** tab in Render for details.

---

## Step 4 — Configure Wix to talk to the service

You need two values:
1. **Service URL**: Copy from Render Dashboard → your web service URL (ends in `.onrender.com`)
2. **Shared Secret**: The value you generated for `WBE_SHARED_SECRET` in Step 2.

In Wix Editor:
1. Go to **Secrets Manager** (sidebar under Developer Tools → Secrets Manager).
2. Click **New Secret**:
   - Key: `WBE_INVOICE_SERVICE_URL`
   - Value: your Render URL (e.g. `https://wanderlust-invoice-service-abc123.onrender.com`)
3. Click **New Secret** again:
   - Key: `WBE_SHARED_SECRET`
   - Value: the same secret from Step 2.

Now copy these updated Velo files into Wix Editor:
- `velo/backend/issueInvoice.web.js` → Backend → `issueInvoice.web.js`
- `velo/backend/invoices.web.js` → Backend → `invoices.web.js` (new)
- `velo/backend/availability.web.js` → Backend → `availability.web.js` (updated)

---

## Step 5 — Optional: Enable Gmail email sending

If you want the service to also email the guest their invoice, you need to copy your Gmail OAuth token to Render. Skip this if you only want PDF generation/storage for now.

On your local machine, run this command to convert the token to base64:

```bash
# Linux / WSL / Mac:
base64 ~/.hermes/gmail_token.json | tr -d '\n'

# Windows PowerShell:
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.hermes\gmail_token.json"))
```

Copy the long base64 string. In Render Dashboard → your service → Environment:
1. Click **Add Environment Variable**
2. Name: `GMAIL_TOKEN_B64`
3. Value: paste the base64 string
4. Click **Save Changes**
5. Render will redeploy automatically.

---

## Step 6 — End-to-end test

Make a test booking on your published Wix site:
1. Search dates → select a room → Summary → Guest form
2. Click **Confirm Booking**
3. Open browser console (F12) and look for:
   - `>>> INVOICE service returned number: WBE-INV-0001`
   - `>>> INVOICE upload OK, url: ...`
   - `>>> INVOICE booking updated with WBE-INV-0001`
4. In Wix Content Manager → Bookings → open the new row. You should see:
   - `bookingNumber`: `WBE-INV-0001`
   - `invoiceUrl`: a Wix Media URL

---

## Troubleshooting

### Render build fails
Check the **Logs** tab. Common causes:
- `requirements-deploy.txt` not found → make sure it was committed to GitHub (not just local).
- `pip install` failure → check that all packages in `requirements-deploy.txt` have valid versions.

### Wix gets 401 Unauthorized
- The `WBE_SHARED_SECRET` in Render and in Wix Secrets Manager must match **exactly** (case-sensitive, no extra spaces).
- In Velo, the `issueInvoice.web.js` module reads `getSecret('WBE_SHARED_SECRET')` and sends it as `X-WBE-Secret`.

### Wix gets 500 error
Check Render **Logs**. Likely a Python error (bad data shape from Wix). The logs show the traceback.

### Invoice numbers reset on each Render restart
Free tier restarts wipe `/tmp/`. That means invoice numbers like `WBE-INV-0001` start over. This is fine while testing. For production, either:
- Upgrade to Render paid (persistent disk)
- Or change `invoice_number.py` to store the counter in a database or Wix collection.

---

## What "sleep mode" means on free tier
After ~15 minutes of no requests, Render pauses your service. The **first request** after sleep takes ~5–10 seconds to wake up. Invoice generation triggers a request from Wix → Render, so the first booking after a long quiet period will have a slight delay. Bookings still succeed because invoice generation is non-blocking (Wix doesn't wait).

---

## Quick reference: key files for Render

| File | Purpose on Render |
|---|---|
| `invoice_service.py` | The FastAPI app (main entry point) |
| `booking_engine/` | Supporting modules: PDF generation, invoice model, numbering |
| `assets/wanderlust_logo.jpg` | Logo embedded in the PDF |
| `requirements-deploy.txt` | Python dependencies |
| `start.sh` | Startup script (checks env, then launches gunicorn) |
| `runtime.txt` | Tells Render to use Python 3.11 |
