# Portable, disconnected guest invoice regression support (v1)

**New support adaptation; independent exact-byte review required before commit.** Runtime approval is not approval of this support. No deployment or live-delivery verdict.

From repository root, with Node 22 and a Python interpreter containing the repository service dependencies plus `docxtpl`, `python-docx`, `jinja2`, `httpx` and a real LibreOffice installation:

```sh
python -B scripts/guest-invoice-portable/run.py check
python -B scripts/guest-invoice-portable/test-portability.py
LIBREOFFICE_PATH='/path/to/soffice' python -B scripts/guest-invoice-portable/run.py suite --output '/outside/repository/new-empty-output'
```

On Windows use a native forward-slash executable path for `LIBREOFFICE_PATH`; it may be omitted when `soffice` or `libreoffice` is on PATH. `happy` selects only the first complete tracer. `suite` selects exactly five native sender modes, sender negatives, 17 status checks and six actual-page checks. Do not invoke historical default guards. No runtime or evidence absolute paths are embedded in this package. `GI_OUTPUT` and `GI_CASE` are runner-owned subprocess inputs. Direct child scripts are internal support, not a standalone public CLI.

## Custody and provenance

`pins-v1.json` freezes 70 repo-relative dependencies and the 46-module native JS import graph, from the authenticated Git parent plus reviewed runtime overlay. Source normalization is **CRLF-to-LF only**: no trim, BOM removal, lone-CR conversion, identifier repair, missing-pin fallback, current-file repinning or membership waiver. Binary Word template is byte-pinned. The old dynamic graph and `businessAdmitted` declaration were removed, not reused as authority. The manifest is a checked-in trust input reviewed together with this support, not a signed attestation that can authenticate its own replacement.

The existing `guest-book-confirm-search/sdk.cjs` and public vector are reused unchanged. The existing retained-sender bridge, Python real-Word runner and status/page assertions are adapted from their reviewed external fixtures. No old retained histories are inputs. Each suite creates ordinary offer/acceptance/allocation/completion/issuance rows through the actual modules, then production-minted signed dispatch through the real FastAPI and Wix handlers, real Word/LibreOffice PDF rendering, an inert provider and native START/ACK. Sender and ingress replay assertions remain intact. Status fixtures read only that run's fresh writer snapshots; prefix and detached corruption negatives do not seed positive authority.

Fixed public fixture clock and domain-separated per-mode deterministic test entropy yield reproducible booking subjects. They are intentionally insecure test material, not usable production keys. Existing public-vector signing inputs and repeated-byte inert channel keys are solely local fixture inputs. PDF metadata, Python transport nonces and MIME identifiers are not asserted byte-reproducible across runs: each run independently asserts exact committed attachment/PDF/provider-byte equality. No private export, user key, live token or signed historical receipt is copied into support.

## Isolation and limits

Actual Node HTTPS entry is inert; Python sockets are denied except the precise stdlib Windows socketpair callsite needed by TestClient. Requests is intercepted at HTTPAdapter.send, provider token/send functions are inert, service lifespan is not started. The runner strips inherited WBE/Gmail/Google/Microsoft settings. Production endpoint strings in assertions identify the authenticated route but no request is sent to them. Do not activate real provider credentials or remove socket controls.

Output must be outside the repository. Fresh JSON histories, scope envelopes, MIME, PDF and native logs are disposable local evidence and **must not be staged**. Use an empty output directory for each run. The package does not copy private guest CSVs or historical evidence, and the full local parent export is not a publication allowlist. Deliver only the separately reviewed runtime 22 plus these explicit support files; existing pinned dependencies remain inherited parent files.

Portable means paths and source-byte custody are checkout-independent. This run verifies Windows Python 3.13/Node 22/LibreOffice only, not Linux execution, hosted Wix compatibility, production CMS guarantees, actual email, inbox receipt, Calendar, activation or deployment.
