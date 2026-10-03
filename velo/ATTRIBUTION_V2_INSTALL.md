# Attribution policy v2 — candidate installation and rollback

**Status: local candidate; independent review pending. Nothing in this pass is installed or published.** Do not deploy the Head alone or treat the packaging review as security approval.

## Exact installation inventory

Replace these together from the same reviewed commit:

| Repository path | Wix destination |
| --- | --- |
| `velo/backend/adsFormRequirement.web.js` | Backend `adsFormRequirement.web.js` |
| `velo/public/adsPolicyProtocol.js` | **New** Public `adsPolicyProtocol.js` |
| `velo/public/clickAttribution.js` | Public `clickAttribution.js` |
| `velo/public/tracking.js` | Public `tracking.js` |
| `velo/custom-code/event-bridge-iframe.html` | Complete HTML of Master Page `#wbeEventBridge`; preserve its `WBE event bridge` title |
| `velo/custom-code/google-tag-and-consent.html` | Complete existing Google tag/consent Head Custom Code entry; replace, do not add a second owner |

`google-tag-and-consent.source.html` is the readable build input, **not** the paste artifact. Run the unchanged `node scripts/build-google-tag.cjs --check`. The exact packaged candidate is 14,877 UTF-16 units against the official 14,900 ceiling (14,883 with CRLF). Packed SHA-256: `d0eabd56016d92a709a3d79adee0248ae08f3a005cb47aea2e56fe85611d2907`.

Preserve the existing reader/resolver, Settings, Master Page, Summary, reservation, invoice, provider transport/journal, Microsoft UET and package/build options. No new credentials, SDK packages, contact fields, CMS grants or UI controls are required. The unrelated Settings import/fallback is not corrected here.

## Wire and timing contract

- V2 only. Backend takes exactly one own-data request with `v`, canonical `audience`, `purpose`, `phase`, 32-hex `nonce`, 32-hex `challenge`. Attribution uses `attribution/read`; form uses `form/prepare` and `form/complete`. Malformed, zero-argument and v1 requests fail before SDK IO.
- The actual backend performs a fresh exhaustive native policy observation for each valid request and echoes its captured tuple afterward. `observedAt` is unchanged server evidence. `policyKey` is a content hash, **not** a signature, atomic revision or proof of no subsequent administrative change.
- The Head issues the challenge and starts its own monotonic 1,500 ms lease before acknowledging open/form-start. The worker starts a separate monotonic lease before sending that request and does not enter the backend until the matching ACK. Neither consumer compares server time with browser wall time.
- Both optional form phases have their own start/ACK/read/result. Completion preserves the original Head email and consent revision; withdrawal/reacceptance never authorizes the old capture. The event remains `form_submit` to the existing AW destination, without contact values in the relay.
- Invalid/missing/rolled-back monotonic clocks and unavailable crypto fail closed. Native timeout latches reject late results even with a stationary sampled clock. Leases are not replenished by a replayed response.
- The 10-second attribution late-open recovery horizon and at-most-two recovery attempts remain separate from the 1,500 ms policy lease. Recovery negotiates a fresh channel; it never retries a conversion RPC. Form work stays nonblocking for booking.
- Summary's existing post-confirmation 2-second minimum / 5-second maximum redirect budget is unchanged. The old 500 ms attribution policy subdeadline and 750 ms form read deadline are replaced by the bounded 1,500 ms acknowledged local phase lease; ordinary open/read/confirm transport timers remain bounded.

## Coordinated cutover (future approval required)

1. Finish different-author source/security review, then commit/push the exact accepted candidate. Verify commit-pinned files and source/packed parity before any separately authorized Wix action.
2. Stage the new Public helper, backend, both Public consumers and iframe in the same draft. Preserve unrelated draft changes. Prepare the exact existing Head-entry replacement. Do not publish partial code as a compatibility experiment.
3. Because Wix site publication and dashboard Custom Code activation may not be atomic, schedule an **optional-attribution outage**. Mixed v1/v2 participants deliberately deny attribution/form authorization; there is no fallback to v1. Booking/invoice code is unchanged. Old open browser sessions may remain denied until reload; do not replay their booking/conversion work.
4. Under separate installation/publication authorization, publish the coordinated site code and replace/activate the existing Head entry during the same maintenance window. Never create a duplicate tag owner to bridge the window.
5. Verify actual published source/module identity and canonical source/origin binding. Perform separately approved privacy-safe checks of empty DIRECT, current click, consent denial and successful optional form signal. Local inert tests establish neither hosted latency nor live provider receipt. Do not create bookings or send production conversions without explicit approval.
6. If a partial deployment or failed verification occurs, accept lost optional attribution temporarily. Restore **all** components from one prior reviewed commit (including its complete Head and iframe), or finish the v2 set; never loosen version, challenge, consent or expiry guards. Do not retry an uncertain conversion.

## Offline verification

Run the eleven existing baseline commands recorded in the candidate manifest, plus:

```text
node --experimental-vm-modules tests/attribution-clock-v2.cjs
node --experimental-vm-modules tests/attribution-clock-v2-security.cjs
node --experimental-vm-modules tests/attribution-diagnostics.cjs
node tests/attribution-clock-v2-pins.cjs
```

Set `WBE_V2_PACKED=1` for both new graph suites to execute the generated Head instead of its readable source. The fixtures execute actual backend policy observation, worker, relay, Head and tracking; the provider-boundary cases also run actual Summary, native booking/capability/journal and Data Manager code behind inert SDK/network boundaries. No success proof is substituted in those graph cases. Older receiver-only REQUIRED-policy tests remain explicitly synthetic and are not credited as backend authority.

Count repeated source/packed and nested parity runs separately from unique titles. Fixed sampled-clock advancement tests are not elapsed-time measurements; pending-read timer cases do exercise real Node timers. Hosted scheduling, production SDK behavior and cutover continuity remain deployment verification gates.
