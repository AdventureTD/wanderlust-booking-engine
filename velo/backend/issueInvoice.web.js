/*
 * Wanderlust Booking Engine — Velo backend: invoice generation bridge.
 * File location in Wix Editor: backend/issueInvoice.web.js
 *
 * Calls the external Python invoice service (invoice_service.py) to generate
 * a PDF invoice + email it to the guest. The service lives outside Wix because
 * Velo cannot run Python/reportlab.
 *
 * The service URL and shared secret are stored in Wix Secrets Manager.
 */

import { Permissions, webMethod } from 'wix-web-module';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';

const INVOICE_SERVICE_URL_KEY = 'WBE_INVOICE_SERVICE_URL';
const SHARED_SECRET_KEY = 'WBE_SHARED_SECRET';

function snakeCaseKeys(obj) {
  if (Array.isArray(obj)) return obj.map(snakeCaseKeys);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const sk = k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
      out[sk] = snakeCaseKeys(v);
    }
    return out;
  }
  return obj;
}

/*
 * issueInvoice(guest, quoteBreakdown, dates)
 *   guest: { name, email, phone }
 *   quoteBreakdown: the dict returned by packagePricing.web.js -> quotePackage()
 *   dates: { checkIn, checkOut, roomCode }
 *
 * Returns the service result: { invoice_number, total, pdf_base64, issue_date, ... }
 */
export const issueInvoice = webMethod(
  Permissions.Anyone,
  async (guest, quoteBreakdown, dates) => {
    const serviceUrl = await getSecret(INVOICE_SERVICE_URL_KEY);
    const secret = await getSecret(SHARED_SECRET_KEY);
    if (!serviceUrl || !secret) {
      throw new Error('Invoice service not configured. Set WBE_INVOICE_SERVICE_URL and WBE_SHARED_SECRET in Secrets Manager.');
    }

    const body = {
      guest,
      quote_breakdown: snakeCaseKeys(quoteBreakdown),
      issue_date: new Date().toISOString().slice(0, 10),
      check_in: dates.checkIn,
      check_out: dates.checkOut,
      room_code: Array.isArray(dates.roomCode) ? dates.roomCode.join(', ') : dates.roomCode,
      send_email: true,
    };

    const res = await fetch(`${serviceUrl}/issue-invoice`, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'X-WBE-Secret': secret,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Invoice service error ${res.status}: ${text}`);
    }

    return res.json();
  }
);
