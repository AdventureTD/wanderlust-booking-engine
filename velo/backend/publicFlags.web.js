// Public, read-only tracking flag for frontend consumers wired through
// public/tracking.js. Exactly one Settings key; never the Settings dictionary,
// raw values or error text. Fail-safe: anything but an explicitly recognized
// value returns { ok:false, suspendGoogleAds:true }. No webMethod cache option,
// so a Settings change is never served from a cache.
import wixData from 'wix-data';
import { Permissions, webMethod } from 'wix-web-module';

const SETTINGS = 'Settings';
const SUSPEND_KEY = 'suspendGoogleAds';
// Below the frontend TRACKING_FLAG_TIMEOUT_MS (3000) so the server's own
// fail-safe answer can arrive before the client gives up.
const READ_TIMEOUT_MS = 2500;

// true = suspended, false = enabled, null = unrecognized (fail-safe).
function recognized(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  if (!row || typeof row !== 'object' || row.key !== SUSPEND_KEY) return null;
  const value = row.value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '0') return false;
    if (text === '1') return true;
    return null;
  }
  if (typeof value === 'number') {
    if (value === 0) return false;
    if (value === 1) return true;
  }
  return null;
}

export const getPublicTrackingFlags = webMethod(
  Permissions.Anyone,
  async () => {
    let timer = null;
    try {
      const read = wixData.query(SETTINGS).eq('key', SUSPEND_KEY).limit(2)
        .find({ suppressAuth: true, consistentRead: true });
      read.catch(() => {}); // A read that loses the race must not surface.
      const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS); });
      const res = await Promise.race([read, timeout]);
      const suspended = recognized(res && res.items);
      if (suspended === null) return { ok: false, suspendGoogleAds: true };
      return { ok: true, suspendGoogleAds: suspended };
    } catch (_) {
      return { ok: false, suspendGoogleAds: true };
    } finally {
      clearTimeout(timer);
    }
  }
);
