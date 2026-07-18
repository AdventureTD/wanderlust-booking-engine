# Wanderlust Google Ads Server-Side Conversion Setup

This guide wires the Wanderlust booking engine to send confirmed bookings and cancellations to the Google Ads API. It covers the Google Cloud project, service account, Google Ads account setup, Wix Secrets, and live testing.

---

## What this integration does

- Captures Google click IDs (`gclid`, `gbraid`, `wbraid`) when a visitor lands on the site.
- Persists those IDs across pages in browser storage.
- Fires a client-side `begin_booking` event when the visitor clicks `#btnSearchRooms` on `/wanderlust-booking`.
- Fires a client-side `purchase` event and a server-side Google Ads conversion when `#btnContinue` confirms the booking on `/booking-summary`.
- Sends a Google Ads **RETRACTION** adjustment when an admin cancels the booking, so the conversion value is reversed.

---

## Step 1: Create or choose a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Use the project selector at the top.
3. Either pick an existing project or click **Create project** and name it `Wanderlust Google Ads API`.

---

## Step 2: Enable the Google Ads API

1. In Cloud Console, open **APIs & Services → Library**.
2. Search for **Google Ads API**.
3. Click it, then click **Enable**.
4. Wait for the confirmation checkmark.

---

## Step 3: Create a service account

1. Go to **IAM & Admin → Service Accounts**.
2. Click **Create Service Account**.
3. Enter:
   - **Service account name:** `wanderlust-google-ads-upload`
4. Click **Create and Continue**.
5. Grant a role:
   - Choose **Basic → Editor** (simplest).
6. Click **Continue**, then **Done**.

---

## Step 4: Download the service account key

1. Click on the `wanderlust-google-ads-upload` service account you just created.
2. Go to the **Keys** tab.
3. Click **Add Key → Create new key**.
4. Select **JSON**, then **Create**.
5. A `.json` file downloads automatically. Keep it secure.

---

## Step 5: Extract values for Wix Secrets

Open the downloaded `.json` file in a text editor.

You need two values:

- `client_email` — looks like `wanderlust-google-ads-upload@PROJECT.iam.gserviceaccount.com`
- `private_key` — the full multi-line string starting with `-----BEGIN PRIVATE KEY-----` and ending with `-----END PRIVATE KEY-----\n`

These two values go into Wix Secrets Manager in later steps.

---

## Step 6: Link the service account to Google Ads

The service account must be a user in your Google Ads account.

1. Open [Google Ads](https://ads.google.com/).
2. Go to **Tools & Settings → Access and security → Users**.
3. Click the blue **+** (Invite user).
4. Paste the service account `client_email`.
5. Choose role **Standard** or **Admin**.
6. Click **Send invitation**.

You may also need to approve the link in **Tools & Settings → Setup → Linked accounts → Google Ads API Center**.

---

## Step 7: Get Google Ads IDs

### Customer ID
1. In Google Ads, open the 3-dot menu at the top right.
2. Copy the **Customer ID** (looks like `942-692-8570`).
3. Remove the dashes. For this account the stored value is `9426928570`.

### Conversion action ID
1. Go to **Tools & Settings → Conversions**.
2. Click the conversion action where booking sales should be counted.
3. The conversion action ID for `Purchase - WC Booking` is `7688935837`.

### Manager account ID (only if you use an MCC)
1. If the Google Ads account is inside a manager (MCC) account, copy the manager account **Customer ID** (without dashes).
2. Skip this if the account is standalone.

---

## Step 8: Add Wix Secrets

1. In Wix Editor, open **Dev Mode** if it is not already active.
2. Go to **Secrets Manager** in the left sidebar.
3. Add each secret below.

| Secret name | Value | Required |
|---|---|---|
| `GOOGLE_SA_CLIENT_EMAIL` | Service account `client_email` | Yes |
| `GOOGLE_SA_PRIVATE_KEY` | Full `private_key` from the JSON key | Yes |
| `GOOGLE_ADS_CUSTOMER_ID` | Google Ads customer ID, no dashes | Yes |
| `GOOGLE_ADS_CONVERSION_ACTION_ID` | Conversion action ID | Yes |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Manager account ID, no dashes | Only if MCC |

Save each secret.

---

## Step 9: Update your Wix CMS collections

### `Bookings` collection
Add these text fields:

- `gclid`
- `gbraid`
- `wbraid`

### `BookingSummary` collection
Add these fields:

- `gclid` (Text)
- `gbraid` (Text)
- `wbraid` (Text)
- `googleConversionUploaded` (Boolean)

---

## Step 10: Add the custom Google tag to Wix

1. Open **Settings → Custom Code**.
2. Click **Add Custom Code**.
3. Name: `Google Tag and Consent Mode`.
4. Paste the contents of `velo/custom-code/google-tag-and-consent.html`.
5. Replace:
   - `G-XXXXXXXXXX` with your GA4 Measurement ID.
   - `AW-XXXXXXXXXXX` with your Google Ads conversion ID.
6. Set placement to **Head**.
7. Apply to **All pages**.
8. Click **Apply**.

---

## Step 11: Copy Velo files into Wix Editor

| Source file | Paste destination |
|---|---|
| `velo/masterPage.js` | Site tab → Master Page |
| `velo/public/tracking.js` | Public files |
| `velo/page-booking-search.js` | `/wanderlust-booking` page code |
| `velo/page-booking-summary.js` | `/booking-summary` page code |
| `velo/backend/availability.web.js` | Backend / Web modules |
| `velo/backend/googleAdsConversions.web.js` | Backend / Web modules |
| `velo/backend/dataManagerClient.js` | Backend / Web modules |
| `velo/backend/hashUtils.js` | Backend / Web modules |

---

## Step 12: Test on the live site

1. Publish the site.
2. Visit the booking search page with a test `gclid`:
   ```
   https://www.wanderlustcaribbean.com/wanderlust-booking?gclid=test123
   ```
3. Search dates, choose rooms, and complete the booking.
4. Open the browser console and look for:
   - `begin_booking` dataLayer event when you click search.
   - `purchase` dataLayer event after booking confirmation.
   - `[WBE-GOOGLE] conversion upload result:` message after the server upload completes.
5. In Google Ads, go to **Tools & Settings → Conversions → Summary**. The offline conversion can take several hours to appear.

---

## Cancelling a booking

When an admin cancels a booking through the admin console or console code, the server:

1. Updates the `Bookings` row status to `Cancelled`.
2. Calls `updateBookingSummary`.
3. Calls `adjustBookingConversion` with `adjustmentType: 'RETRACTION'` using the click IDs stored on the `BookingSummary` row.
4. Updates `BookingSummary.googleConversionUploaded` to `true` and `status` to `In Process` so the retraction is not sent twice.

---

## Troubleshooting

### Conversion upload fails with OAuth error
- Verify the service account `client_email` matches the Wix secret.
- Verify the private key is the full string including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`.
- Verify the Google Ads API is enabled in Google Cloud.
- Verify the service account is invited as a user in Google Ads.

### Google Ads shows no conversions
- Confirm the conversion action accepts **offline** or **API** conversions.
- Confirm the conversion action ID and customer ID are stored without dashes.
- Check Velo logs for errors from `recordBookingConversion`.

### gclid is missing
- Confirm `masterPage.js` is on the master page.
- Confirm the first landing URL contains `?gclid=...`.
- Confirm the visitor lands before navigating to `/wanderlust-booking`.
