// Shared frontend/backend contract. Install libphonenumber-js 1.13.13 in Wix.
// Metadata handles national trunks (including Italy's significant zero); do not
// infer a country from digit count or replace an explicit international prefix.
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export function normalizePhone(raw, dialingCode) {
  if (typeof raw !== 'string' || raw.length > 100 || !/^\+?[\d\s().-]+$/.test(raw.trim())) return '';
  const text = raw.trim();
  const code = typeof dialingCode === 'string' ? dialingCode.replace(/^\+/, '') : '';
  if (!text.startsWith('+') && !/^[1-9]\d{0,2}$/.test(code)) return '';
  try {
    const number = parsePhoneNumberFromString(text, { defaultCallingCode: code || undefined, extract: false });
    return number && number.country && number.isValid() && /^\+[1-9]\d{1,14}$/.test(number.number) ? number.number : '';
  } catch (_) { return ''; }
}
