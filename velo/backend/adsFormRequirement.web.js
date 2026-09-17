import { createHash } from 'crypto';
import { Permissions, webMethod } from 'wix-web-module';
import { readGuestConsentRequirementsObservation } from 'backend/guestConsentRequirementsReader';
import { resolveGuestConsentRequirement } from 'backend/guestConsentLocationPolicy';

export const getAdsFormRequirement = webMethod(Permissions.Anyone, async function () {
  const closed = () => ({ v: 1, requirement: 'UNRESOLVED' });
  if (arguments.length !== 0) return closed();
  try {
    const observation = await readGuestConsentRequirementsObservation();
    if (observation.status !== 'OBSERVED' || observation.evidence.scan.status !== 'EXHAUSTED') return closed();
    const requirement = resolveGuestConsentRequirement({
      v: 1,
      location: { status: 'UNKNOWN' },
      requirements: { status: 'COMPLETE', rows: observation.rules }
    });
    // Content comparison only, not a signed receipt or atomic datastore revision.
    const policyKey = createHash('sha256').update(JSON.stringify([observation.rules, observation.evidence.rows])).digest('hex');
    return { v: 1, requirement, policyKey, observedAt: observation.evidence.completedAtMs };
  } catch (_) { return closed(); }
});
