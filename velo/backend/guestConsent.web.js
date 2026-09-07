// Negative-only public transport. Anyone is not subject authorization: the body
// capability is authenticated by T1. Anonymous issuance abuse controls and Wix
// confidential transport/request limits MUST be verified before activation.
import { webMethod, Permissions } from 'wix-web-module';
import { createGuestConsentBrowserContext as issue, withdrawGuestConsentBrowser as withdraw, readGuestConsentBrowserNegative as observe } from 'backend/guestConsentContext';

const validToken = value => typeof value === 'string' && value.length === 134 && /^wcn1\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value);
function exact(result, keys) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(result);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key =>
    Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'));
}
// Deliberately no third webMethod argument: no cache options or tags.
export const createGuestConsentBrowserContext = webMethod(Permissions.Anyone, async (...args) => {
  if (args.length !== 0) return { status: 'DENIED' };
  try {
    const result = await issue();
    if (exact(result, ['status', 'token']) && result.status === 'CREATED' && validToken(result.token)) {
      return { status: 'CREATED', token: result.token }; // Confidential direct Velo custody only.
    }
  } catch (_) { /* Never expose private errors or rows. */ }
  return { status: 'UNKNOWN' };
});
export const withdrawGuestConsentBrowser = webMethod(Permissions.Anyone, async (...args) => {
  if (args.length !== 1 || !validToken(args[0])) return { status: 'DENIED' };
  try {
    const result = await withdraw(args[0]);
    if (exact(result, ['status']) && ['RECORDED', 'DENIED', 'INTEGRITY', 'UNKNOWN'].includes(result.status)) return { status: result.status };
  } catch (_) { /* Unknown never means not withdrawn. */ }
  return { status: 'UNKNOWN' };
});
export const readGuestConsentBrowserNegative = webMethod(Permissions.Anyone, async (...args) => {
  if (args.length !== 1 || !validToken(args[0])) return { status: 'DENIED' };
  try {
    const result = await observe(args[0]);
    if (exact(result, ['status']) && ['WITHDRAWN', 'DENIED', 'INTEGRITY', 'UNRESOLVED'].includes(result.status)) return { status: result.status };
  } catch (_) { /* Absence/failure is not permission. */ }
  return { status: 'UNRESOLVED' };
});
