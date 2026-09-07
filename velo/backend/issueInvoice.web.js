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
import { getAllSettings } from 'backend/settings.web';
import { currentUser } from 'wix-users-backend';
import { prepareOwnerIssuance, ownerInvoiceReview, scanOwnerInvoiceJournal } from 'backend/invoiceEmailJournal';

// Deliberately not connected to live/default issuance. Runtime rollout is separate.
const OWNER_INVOICE_JOURNAL_ENABLED = false;
export const prepareOwnerInvoiceDispatch = webMethod(Permissions.Admin, async (command) => {
  if (!OWNER_INVOICE_JOURNAL_ENABLED) throw new Error('owner_invoice_journal_disabled');
  const actorId = currentUser.id;
  if (typeof actorId !== 'string' || !actorId.trim()) throw new Error('owner_invoice_actor_required');
  return prepareOwnerIssuance(actorId, command);
});

function ownerDispatchAuthority(issuanceId) {
  if (!OWNER_INVOICE_JOURNAL_ENABLED) throw new Error('owner_invoice_journal_disabled');
  const actorId = currentUser.id;
  if (typeof actorId !== 'string' || !actorId.trim()) throw new Error('owner_invoice_actor_required');
  if (typeof issuanceId !== 'string' || !/^[a-f0-9]{64}$/.test(issuanceId)) throw new Error('owner_invoice_id');
  // Actor is authenticated audit, not an invented per-Admin ownership predicate.
  return actorId;
}

async function ownerDispatchStatus(issuanceId) {
  return ownerInvoiceReview(issuanceId, true);
}

export const getOwnerInvoiceDispatch = webMethod(Permissions.Admin, async (issuanceId) => {
  ownerDispatchAuthority(issuanceId);
  return ownerDispatchStatus(issuanceId);
});

export const dispatchOwnerInvoice = webMethod(Permissions.Admin, async (issuanceId) => {
  ownerDispatchAuthority(issuanceId);
  const existing = await ownerDispatchStatus(issuanceId);
  if (existing.status !== 'preparation_retryable') return existing;
  const serviceUrl = await getSecret(INVOICE_SERVICE_URL_KEY);
  const secret = await getSecret(SHARED_SECRET_KEY);
  if (typeof serviceUrl !== 'string' || !/^https:\/\/[^\s/?#@]+\/?$/.test(serviceUrl) ||
      typeof secret !== 'string' || !secret) throw new Error('owner_invoice_service_unavailable');
  const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/issue-invoice`, {
    method: 'post',
    headers: {'Content-Type': 'application/json', 'X-WBE-Secret': secret},
    body: JSON.stringify({protocol: 'owner-invoice-journal-v1', issuance_id: issuanceId}),
  });
  if (!res.ok) throw new Error('owner_invoice_service_unavailable');
  // Durable journal readback, never a caller/provider-shaped response, is status authority.
  return ownerDispatchStatus(issuanceId);
});

export const listOwnerInvoiceReviews = webMethod(Permissions.Admin, async (...args) => {
  if (!OWNER_INVOICE_JOURNAL_ENABLED) throw new Error('owner_invoice_journal_disabled');
  if (typeof currentUser.id !== 'string' || !currentUser.id.trim()) throw new Error('owner_invoice_actor_required');
  if (args.length !== 1) throw new Error('owner_invoice_cursor');
  return scanOwnerInvoiceJournal(args[0]);
});

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
  Permissions.Admin,
  async (guest, quoteBreakdown, dates, sendEmail = true, invoiceNumber = '') => {
    const serviceUrl = await getSecret(INVOICE_SERVICE_URL_KEY);
    const secret = await getSecret(SHARED_SECRET_KEY);
    if (!serviceUrl || !secret) {
      throw new Error('Invoice service not configured. Set WBE_INVOICE_SERVICE_URL and WBE_SHARED_SECRET in Secrets Manager.');
    }

    // Fetch table-driven allocation ratio from Wix Settings.
    // accommodationShare = percentage of subtotal allocated to accommodations.
    // Services amount = subtotal - accommodation amount.
    const settings = await getAllSettings();
    const accShare = Number(settings.accommodationShare || 0.5);

    const body = {
      guest,
      quote_breakdown: {
        ...snakeCaseKeys(quoteBreakdown),
        accommodation_share: accShare,
      },
      issue_date: new Date().toISOString().slice(0, 10),
      check_in: dates.checkIn,
      check_out: dates.checkOut,
      room_code: Array.isArray(dates.roomCode) ? dates.roomCode.join(', ') : dates.roomCode,
      send_email: sendEmail,
    };
    if (invoiceNumber) {
      body.invoice_number = invoiceNumber;
    }

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
