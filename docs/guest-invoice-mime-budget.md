# Guest invoice MIME storage budget

## Scope and authority

This is the disconnected initial-guest single-record delivery journal, not the
owner InvoiceEmailJournal transport. No live SDK, booking producer, endpoint,
OAuth refresh, provider request or deployment is needed for these local tests.
The original Word template and Word/docxtpl/LibreOffice renderer remain unchanged.

Wix's authoritative Velo [`wix-data.insert`](https://dev.wix.com/docs/velo/apis/wix-data/insert)
documentation says: **“The maximum size of an item that you can add to a collection
is 500kb.”** It documents automatic `_createdDate` and `_updatedDate`, and its
returned-item example includes `_owner`. The [Data Items introduction](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/introduction)
also says 500 kb. The documentation does not specify its internal storage encoding
or binary/decimal units. Use the smaller **500000-byte** interpretation; do not
claim live platform size-boundary verification.

The local complete serialized item budget is **400000 UTF-8 JSON bytes**. The
remaining **100000 bytes** are an explicit conservative engineering reserve for
platform accounting differences, not a newly discovered Wix limit. The supported
MIME ceiling is derived from this budget and the complete actual schema below,
not chosen simply to make today's PDF pass. Internal platform overhead is not
claimed to have been measured; deployment remains subject to live verification.

## Exact PREPARED accounting

`INITIAL_ISSUANCE` and `PREPARED` are separate collection items. The existing
160000-byte INITIAL_ISSUANCE limit in `guestBookingInvoiceIssuance.js` is unchanged.
PREPARED contains document/issuance digests, **not** the full projection. Do not add
the root's projection length to the PREPARED item or confuse that root limit with
a limit on the whole journal/response.

Worst-case PREPARED application JSON, with empty encoded payload:

- Six fixed 64-character ASCII identities/digests: `_id`, `issuanceId`,
  `documentDigest`, `mimeDigest`, `pdfDigest`, `artifactDigest`.
- `kind: "PREPARED"`, `encoded: ""` and longest allowed renderer version
  `"reportlab-fallback"`, including every key, quote, colon and comma.
- Total **551 bytes** (word rendering uses a shorter value).

Allowed SDK metadata contributes at most **1638 additional JSON bytes**:

- `_owner`: at most 256 JavaScript UTF-16 units, each possibly requiring six-byte
  JSON escaping. Null or ordinary IDs use less. This is the unchanged `data()`
  admission bound, not a guessed normal owner UUID width.
- `_createdDate`, `_updatedDate`: native finite Dates can serialize to extended
  27-character ISO dates, not just ordinary 24-character dates.
- Includes metadata key names, punctuation and quotes.

Thus empty encoded full envelope = **2189 bytes**. Base64 alphabet needs no JSON
escaping and has one UTF-8 byte per character:

```text
MAX_ENCODED = 4 * floor((400000 - 551 - 1638) / 4) = 397808 characters/bytes
MAX_MIME    = 3 * (MAX_ENCODED / 4)                = 298356 decoded MIME bytes
max full PREPARED JSON                           = 399997 bytes
headroom below conservative Wix maximum          = 100003 bytes
```

JavaScript checks encoded size, canonical base64, decoded MIME size, digest and
the constructed complete application JSON plus metadata reserve **before append**.
Python checks decoded MIME before commit and both encoded/decoded sizes on
readback before START. Both languages derive their limits from the same budget;
the permanent cross-language exact-boundary case detects drift. Metadata is
excluded from application equality but not from the storage-size budget.

## PDF is not MIME and MIME is not stored base64

There is **no independently supported universal PDF-byte maximum**. The existing
builder base64-encodes the PDF inside multipart MIME (with line wrapping), adds
headers/body/boundaries, then the journal base64-encodes that entire MIME again.
Only the final MIME cap is authoritative; larger display/header/body content
reduces available PDF space. No new PDF allowance overrides the final cap.

The admitted retained distinct-group fixture, unchanged Word template and actual
renderer produce **115655 PDF bytes**, **157439 original dispatch MIME bytes** and
**209920 stored base64 characters**. The actual PREPARED application JSON is
**210457 bytes**, before SDK metadata. These are real locally captured dispatch
bytes, not a diagnostic MIME rebuild substituted for execution.

For this fixture's fixed recipient/name/issuance/body and current LF MIME policy,
the independently calculated, builder-tested relation is:

```text
MIME(P) = 1201 + 4 * ceil(P/3) + ceil(P/57)
```

It allows at most **219969 PDF bytes** for those fixed message fields:
219969 yields 298353 MIME bytes; 219970 yields 298357 and exceeds the cap.
These two payloads are synthetic size-only builder probes, **not real valid PDFs
or a universal advertised PDF limit**. Real rendered PDF acceptance is a separate
Word/LibreOffice test. Nothing compresses, truncates or redesigns the template.

## Permanent tests and evidence

Only `tests/test_guest_invoice_mime_budget.py` is selected. It uses the existing
`--gp02-distinct-bridge` with the exact retained artifact admission and closed inert
SDK graph; it does not run producers or default/restricted selectors.

- Actual Word render -> consumer -> native PREPARED/START/ACK -> one inert provider
  callback, final exact readback and byte-identical attachment.
- MIME cap-minus-one and exact cap accepted; cap-plus-one/two rejected with zero
  insert attempts, zero START/provider and unchanged retained storage.
- Native JS exact cap accepted with the full 399997-byte metadata envelope;
  plus-one/three denied with zero mutations.
- Python oversized readback seams deny before START/provider; not a claim that
  JS persisted an invalid artifact.
- Fixed-message PDF expansion neighbors as above.

The initial eight-case tests-first run was **4 failures / 4 passes**, pytest exit 1;
real Word returned UNAVAILABLE with no new journal row and zero provider calls.
After the coordinated runtime correction the same eight cases passed, exit 0.
Four additional unchanged-behavior size/readback assertions are additive coverage,
not manufactured production REDs. Their final run is recorded externally.

Evidence and source hashes:
`C:/Users/TomDe/checkpoints/booking-invoice-mime-budget-evidence/`.
Every run records actual native bridge/LibreOffice exits separately from pytest,
retained original MIME/PDF, source-before/after SHA-256 and no-network/credential
attempts. Different render runs may produce different PDF metadata/hash bytes;
the unchanged template and each run's actual PDF-to-MIME equality are the claims.

Independent review is required before commit. No publication readiness, live-Wix
verification or real email delivery is claimed.
