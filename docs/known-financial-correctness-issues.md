# Known financial correctness issues

High-priority unresolved defects; not noncritical upgrades. No authorization to implement or publish.

## Cross-request invoice accumulation and canonical purchase authority

- **Priority:** Financial correctness; not resolved by the bounded attribution hotfix.
- **Status:** Requires separately reviewed durable accounting/schema design. Not a noncritical dismissal or rollout approval.
- **Remaining defect:** Public `createBooking` calls from different tabs/requests can overlap in `createDraftInvoice` read/add/update or read/insert. Sequential Summary calls only remove that caller's parallel schedule. Backend draft errors remain swallowed; frontend calculated totals are not canonical invoice authority.
- **Acceptance:** Actual-source concurrent independent-request and retry/restart cases retain each contribution exactly once; insertion/update uncertainty reconciles without lost or duplicate money; original-group pricing/rounding and API compatibility remain preserved; displayed accepted amount, emitted purchase and invoice agree. Preserve confirmation independence from delivery. No process-local lock may stand in for durable protection.
- **Scope:** See `attribution-hotfix-deployment.md`; no historical invoice changes are authorized.
