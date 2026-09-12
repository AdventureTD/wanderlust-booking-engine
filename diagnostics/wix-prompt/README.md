# Production-site prompt diagnostic — NOT approved for installation

Local candidate only. No fake TEST site, sandbox bookings, booking producers, scheduler, provider or email calls. The site owner's production site is the only intended hosted environment, after independent review and explicit approval. This is NOT a booking solution or hosted delivery evidence.

## Exact proposed installation scope

- Create ONE regular native collection, ID `WixPromptDiagnostics`; proposed display name `Wix Prompt Diagnostics`. Not created/verified. No dataset, dynamic page, automations, hooks, references or connection to booking collections. Restrict all collection CRUD permissions to Admin; no visitor/member access. Backend uses explicit suppressAuth only against this constant collection.
- Custom fields: `kind`, `tag`, `probeId`, `eventJson` = Text; `stage` = Number; `suppressed` = Boolean. `_id` and Wix-managed creation/update/owner metadata are system fields. No guest fields. Do not export `_owner` or identity metadata.
- Copy `promptDiagnosticCore.js`, `promptDiagnostic.js`, `promptDiagnostic.web.js` to their same-named `backend/` files, ONLY from the independently reviewed commit.
- `promptDiagnostic.js` is OFF with blank `ownerId`. Before activation, bind the verified owner's authenticated site-member `_id` privately; Admin permission alone includes collaborators and is NOT owner-only. Never accept an ID from request parameters, infer it from an email, log the member object, or substitute a contact ID. An unavailable owner member identity must fail closed. Review the exact configured file before publication; do not put private identity values in public reports.
- `events.addition.js` is composition input, NOT a whole-file replacement. Preserve current live `backend/events.js` bytes and all handlers. If no handler exists, add the import and export. If `wixData_onDataItemCreated` already exists, merge the contained awaited diagnostic call without replacing existing behavior or adding a duplicate export. The exact composed file needs different-author review. Existing deployed events.js has NOT been retrieved; never infer it is empty from the Git baseline.
- For a concrete published-site invocation, a temporary hidden/no-index page `/wix-prompt-diagnostic` with one button `#runPromptDiagnostic` and text `#promptDiagnosticStatus`, using `page-prompt-diagnostic.js`. This is also a live change requiring explicit permission. No links from booking pages. Page secrecy is NOT authentication: endpoint has Admin AND exact-owner checks. No startup invocation. Owner signs in and explicitly clicks once. No main/masterPage/guest-page edits.
- Do NOT copy the autonomous worker's jobs.config. No new hourly job, no worker activation; existing daily advanceStatuses remains byte-identical.

## Exact write/read bounds

Fixed tag: `wixprompt-6da182ac-792f-42c8-bb7e-4ca4bb0dd690`.
Probe suffixes: `-c1`, `-c2`, `-s1`, `-s2`. Corresponding observation IDs append `-seen`.
Only these eight IDs may be inserted, all into the dedicated collection. No updates/deletes in runtime. No arbitrary input fields, collection names, run IDs or stage counts. This fixed run is not automatically renewable.

The owner click attempts `c1` with suppressHooks:false and `s1` with suppressHooks:true. On a matching event, a constant-collection exact-ID read must match all probe fields. A fresh successful observation insert alone permits `c1 -> c2` or `s1 -> s2` with the same suppression setting. Stage 2 has no successor. Observation-created events are ignored before IO. Duplicate inserts cannot overwrite; duplicate/uncertain receipt writes confer no successor grant. No reconciliation retry loop: uncertainty can leave this diagnostic incomplete, safely.

One matching delivery uses at most one get and two insert attempts; unrelated events perform zero IO/logging. Maximum retained records is eight, even under concurrent duplicate callbacks in the local fixture. Wix's external callback/retry count is NOT bounded by this code; repeated owner clicks or Wix retries can repeat bounded attempts. There is no promise of zero shared hosting overhead or absolute no indirect guest impact from a production publication. No business/guest records are read or written by this module.

## Event observation and evidentiary limits

Official Velo documentation shows only `event.metadata.id` and `event.entity._id`, exported as `wixData_onDataItemCreated(event)` in events.js. It says inserted data triggers the event. It does NOT specify a complete payload/collection selector or settle whether legacy wixData.insert with suppressHooks:true emits it. Hooks and native events must not be conflated.

The diagnostic matches only exact synthetic entity IDs, then reads ONLY its own collection. It does not route on a guessed collection field or inspect booking rows. This is NOT authenticated collection attribution: a same-ID event from another collection could be misattributed. Even if delivery succeeds, use this as delivery feasibility evidence, not a production booking event selector.

`event.fixture.json` is the exact documented minimum serialized with inert synthetic values, plus expected sanitized output. It is NOT an observed Wix payload. `eventJson` receipts contain bounded structural serialization of the actual received event: all non-fixture scalar values are redacted; unknown field names become numbered placeholders; known structural keys may be retained if present. Presence of names in the serializer is NOT a claim they exist in Wix's event. No raw event, identity, guest values, error body or secrets are logged. The projection intentionally does not expose full metadata values or every unknown field name. If the owner later needs additional schema detail, review a separate safe projection instead of enabling raw logging.

After approval, open the dedicated CMS collection and observe ONLY these exact IDs/fields. Record Wix system `_createdDate` for probes/receipts to compare stage delays without identity exports. `SEE_OBSERVATIONS` means only that attempts finished, NOT delivery success. Missing receipts are inconclusive (auth, build, permissions, consistency, suppression, delivery, quota and observation failures remain distinguishable only with scoped follow-up). `c1/c2` observed but no `s1` observation is evidence against this exact suppressed path, not general proof. Receipt1 without stage2 may be insert/ACK failure rather than scheduling failure. All four observations establish one finite two-stage sample, not an SLA or a 32-visit hosted quota admission.

## Cleanup (only when separately approved with this trial)

1. Disable the diagnostic, remove the temporary page, and remove only the diagnostic import/call/export additions from events.js, preserving every pre-existing handler; remove the three backend modules after imports are removed. Review and publish the exact reversal.
2. Save only sanitized observations. Delete only the eight listed IDs, then remove the dedicated collection if its identity and diagnostic-only contents are verified. Never truncate a booking collection. Do not delete markers while the diagnostic is active: that would allow the fixed chain to run again.
3. Pending old deliveries may fail after removal; no collection-creation code exists. Verify page/modules are absent and existing daily job unchanged. Reuse of this fixed tag after cleanup is not authorized.

## Local evidence / remaining review

`node --test scripts/verify-wix-prompt-diagnostic.cjs`: 5 tests pass. Tests run actual core and wrapper/page callbacks in inert Node VM contexts. Final native output is `final-local-evidence.json`; all five JS files passed node --check. Test-first API absence failures are distinct from the causal READY-versus-SEE_OBSERVATIONS RED. Later fault/fixture cases were baseline-GREEN. Wix compiler, auth enforcement, actual SDK event delivery, existing events composition and hosted quota are NOT tested. Full booking suites were not run because booking code was not changed/executed.

No commit/push performed: new runtime and harness need independent final review first. Reviewer must inspect auth binding, exact-ID collision caveat, lost ACK stop, bounded replay, collection ACL, sanitizer, and preservation of existing handlers. Final reviewed commit-pinned Git file links and exact composed events.js are required before asking the owner to install/publish anything.
