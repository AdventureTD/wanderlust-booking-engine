# Private completion-status selected portable package

Baseline: `bdb4093bb4332594001436b50eb47b9c4e693761`.

This is an uncommitted, private, selected dependency export, not an entire repository or release. Backend runtime and thirteen permanent test bodies are unchanged. The three retained fixtures and 29 inherited modules are actual parent Git blobs, not reconstructed source.

Run only byte inspection from this root:

```
python -B scripts/guest-status/inspect-package.py
```

The inspector checks enumerated canonical SHA-256 pins (only CRLF -> LF), then calls the actual selected loader's `preflight()` and `fixture()` readers. It compiles but never invokes backend modules. Anchor `package-manifest.json` and this inspector against the external package report before trusting them; a self-consistent rewritten manifest is not authority. Extra files outside selected membership are not approved by this inspector.

`review-vector.py` independently checks the exact archived actual-issuer result against retained original fields and Python JSON/base64url/HMAC. It does not invoke the issuer or tests. Run it against the frozen raw-provenance package, not a representation-mutated evidence archive.

`credential-vector.json` is NEW deterministic actual-issuer test output, never a recovered historical credential or a pricing-quote substitution. `provenance/` holds byte-identical original reports, generator scripts (including the initial display-prototype fixture failure), oracle, native records, and original four reviewed files. Original absolute execution paths inside those records are historical metadata, not package dependencies. The archived generator is evidence only: its historical `ownroot` runner layout is deliberately not reconstructed or automatically dispatched.

Only loader byte guards and admission pins changed: canonical fixture pins, mandatory candidate hash and test/vector hashes. Runtime functions, finite assertions, imports, SDK traps and retained rows did not change. No completed backend tests were rerun. S01-S10 saved passes precede final S11 runtime changes; S11/S12/S13 source-bound evidence is retained, not presented as a fresh package regression.

Transfer all selected members plus this manifest onto the exact baseline only after independent review of NEW packaging bytes. Preserve unrelated files; reject divergent dependency blobs. The full baseline plus owned overlay must retain and separately reconcile inherited incoming/default/restricted guards. Do not run S10 on this sparse export and claim a full-repository incoming scan. Do not dispatch historical default verifiers, producers, recovery, acceptance or issuer generators as package inspection.

Release, public endpoint/transport, actual Summary UI, integration, live SDK/ACL/consistency, deployment, staging and commit remain outside this package. See the external `booking-guest-status-package.md` for hashes, source-custody results and remaining independent-review gates.
