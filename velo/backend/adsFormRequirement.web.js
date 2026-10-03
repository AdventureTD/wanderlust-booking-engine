import { createHash } from 'crypto';
import { Permissions, webMethod } from 'wix-web-module';
import { readGuestConsentRequirementsObservation } from 'backend/guestConsentRequirementsReader';
import { resolveGuestConsentRequirement } from 'backend/guestConsentLocationPolicy';

export const getAdsFormRequirement = webMethod(Permissions.Anyone, async function (input) {
  const closed = () => ({ v: 2, requirement: 'UNRESOLVED' });
  try {
    // No caller policy/location authority. Snapshot own primitive data BEFORE IO.
    if (arguments.length !== 1 || !input || typeof input !== 'object' ||
        Object.getOwnPropertyNames(input).sort().join(',') !== 'audience,challenge,nonce,phase,purpose,v' ||
        Object.getOwnPropertySymbols(input).length) return closed();
    const request = {};
    for (const key of ['v', 'audience', 'purpose', 'phase', 'nonce', 'challenge']) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return closed();
      request[key] = descriptor.value;
    }
    if (request.v !== 2 || request.audience !== 'https://www.wanderlustcaribbean.com' ||
        !(request.purpose === 'attribution' && request.phase === 'read' ||
          request.purpose === 'form' && ['prepare', 'complete'].includes(request.phase)) ||
        !['nonce', 'challenge'].every(key => typeof request[key] === 'string' && /^[a-f0-9]{32}$/.test(request[key]))) return closed();
    const observation = await readGuestConsentRequirementsObservation();
    if (observation.status !== 'OBSERVED' || observation.evidence.scan.status !== 'EXHAUSTED') return closed();
    const requirement = resolveGuestConsentRequirement({
      v: 1,
      location: { status: 'UNKNOWN' },
      requirements: { status: 'COMPLETE', rows: observation.rules }
    });
    // Content comparison only, not a signed receipt or atomic datastore revision.
    const policyKey = createHash('sha256').update(JSON.stringify([observation.rules, observation.evidence.rows])).digest('hex');
    return { ...request, requirement, policyKey, observedAt: observation.evidence.completedAtMs };
  } catch (_) { return closed(); }
});
