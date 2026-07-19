import { getSecret } from 'wix-secrets-backend';
import { fetch } from 'wix-fetch';
import crypto from 'crypto';

const DATA_MANAGER_SCOPE = 'https://www.googleapis.com/auth/datamanager';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ENDPOINT = 'https://datamanager.googleapis.com/v1/events:ingest';

let cachedToken = null;

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  const clientEmail = await getSecret('GOOGLE_SA_CLIENT_EMAIL');
  let privateKey = await getSecret('GOOGLE_SA_PRIVATE_KEY');
  privateKey = privateKey.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: DATA_MANAGER_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };

  const unsigned = base64url(Buffer.from(JSON.stringify(header))) + '.' + base64url(Buffer.from(JSON.stringify(claim)));
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey);
  const jwt = unsigned + '.' + base64url(signature);

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt
  });

  const res = await fetch(TOKEN_URL, {
    method: 'post',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('OAuth token request failed (' + res.status + '): ' + text);
  }
  const json = await res.json();
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in * 1000) };
  return cachedToken.token;
}

export async function ingestEvent(payload) {
  const token = await getAccessToken();

  console.log('[WBE-DM] sending payload:', JSON.stringify(payload));

  const res = await fetch(ENDPOINT, {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  if (!res.ok) { throw new Error('Data Manager API call failed (' + res.status + '): ' + text); }
  return text ? JSON.parse(text) : { ok: true };
}
