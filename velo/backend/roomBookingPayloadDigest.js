import crypto from 'crypto';
import { canonicalizeRoomBookingCommitPayload } from 'backend/roomBookingPayloadRules';

// Backend-only deterministic digest adapter. It performs no I/O and is not public.
export function computeRoomBookingPayloadDigest(payload) {
  const canonical = canonicalizeRoomBookingCommitPayload(payload);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}
