# RA-05 — core fetch accounting integration proof

Status: **bounded internal integration; production adoption remains separate**.
Human direction: “Proceed with RA-05.” Base: `1310222`, merged RA-04 #532 on
`hex-integration`. No exact named Entry Point covers this internal cross-owner
experiment; ordinary root/docs instructions apply. Change class: evidence;
scope: evidence-only. All changes are internal experiment/evidence files.

## Result

The existing generated Native fetch driver now has a tested accounting adapter in
this fixture. It reserves whole-cohort capacity before dispatch, preregisters
outputs before acquisition, distinguishes successful consumption/transfer from
release, and preserves uncertain obligations through errors and deadlines.
Known safe fetch resources are disposed at invocation closure, after authored
uses and terminal response selection. The original scheduler, continuations and
request deadline still govern execution.

[Native checks](checks.json) cover real compiled canonical handlers and an
independent injected-host resource ledger. [JavaScript checks](javascript.json)
exercise real Web Responses and the existing executor through RA-03's private
bridge. Neither suite executes a real Fastly service. Successful host outcomes
and safe synchronous disposal are explicit fixture assumptions awaiting RA-10
qualification. Production compiler/provider/runtime files remain unchanged.

| Path | Integration result |
| --- | --- |
| Successful text fetch | Response/body remain available through handler execution; both close at invocation exit; guest-byte allowance remains charged |
| Opaque terminal return | Original fetched pair transfers downstream, without a body read or subsequent close |
| Preparation failure | Known request/body cleaned independently while time remains; uncertain acquisition output remains registered |
| Failed send or wait | Inputs and possible outputs remain quarantined regardless of whether the host model actually consumed them |
| Existing send-error close attempts | Adapter suppresses speculative calls against quarantined claims |
| Whole-request wait expiry | Pending charge survives even when the existing retirement list never received it |
| Per-operation timeout | Existing bounded poll/reaper path is reused; ready late outputs close only while request time permits |
| Close failure | Attempted once, remains charged; independent sibling cleanup continues; primary error/response is preserved |
| Trap | Guest cleanup does not run; ledger registrations and host observations remain available in the harness |
| Out-of-profile output handle | Containment fault recorded and further dispatch stopped; no complete-accounting claim |
| Resource-short keyed group | Zero fetch acquisitions/dispatches, including widths 8/16/32; captures remain spent |

## Native integration mechanics and limits

[build.cjs](build.cjs) generates checked source wrappers around actual request/body
creation, send, wait, poll, close and downstream-transfer imports. It uses the
production canonical compiler/Native plan/generator and the pinned RA-03 compiler
recipe. Source anchors fail closed on drift. [adapter.as.ts](adapter.as.ts) retains
per-site root/claim references and family-scoped handle identities in fixed banks.
Consuming entries fence their inputs before the host call. Successful consumption
and transfer retire only qualified guest handle/record units; they never refund
backing bytes or assert that upstream work stopped.

The RA-03 Native kernel is instantiated with a larger, explicit fetch byte profile.
Its existing fixed banks, root admission and cleanup policy are reused. A small
checked extension adds distinct consumed/transferred states with handle/record-only
refunds. The generated artifact contains the actual integrated ledger and adapter;
accounting is not reconstructed from the host trace afterward.

This proof admits one direct fetch or one fixed keyed cohort of fetches per fresh
instance. The compiler fixture validates that membership. It does not establish
dynamic collection membership, repeated/sequential effect-site reuse, mixed
cache/fetch profiles, Router recovery, generic child composition or a stable
structural hook API. RA-07 must integrate composed membership with shared admission;
production adoption must replace checked source injection with structural hooks.

Handles are qualified by family and constrained to `[0, 1,000,000)` in this
fixture; zero is exercised. This encoding is not a production handle limit or
proof of real host namespaces. Unknown acquiring outcomes retain the preallocated
maximum output claims even when the injected host produced none. Charged handle
units therefore form a conservative upper bound, not a live-handle census.

Cleanup samples the existing request clock and retains the original deadline.
The error-response allowance cannot reopen resource cleanup time. No pending
cancel API, blocking drain, disposal retry or new scheduler is introduced.
Fetched resources are retained until invocation closure to preserve aliases and
opaque forwarding. Shared readers do not close resources on EOF.

## Body allocation pressure

The existing Native reader allocates a **65,536-byte read buffer per iteration**,
retains chunk views, allocates assembled bytes and decodes a string. This fixture
allows at most four read iterations (including EOF) and 64 payload bytes. Before
its first allocation it registers the full conservative allowance:

`4 × 65,536 + 64 assembled bytes + 128 UTF-16 data bytes = 262,336 bytes per root`.

Both step and payload limits reject before a fifth read allocation or oversized
assembly. The allowance remains charged through exit: losing a local reference
is not proof of allocator reclamation. No buffer pooling or premature refund is
introduced. Even the tiny successful response uses this declared maximum; the
number is **reserved/charged allowance**, not measured bytes allocated or RSS.

| Fetch width | Projection allowance | Ledger + adapter raw banks |
| --- | ---: | ---: |
| 1 | 262,336 bytes | 796 bytes |
| 8 | 2,098,688 bytes | 5,024 bytes |
| 16 | 4,197,376 bytes | 9,856 bytes |
| 32 | 8,394,752 bytes | 19,520 bytes |

Per-root cleanup and the separate execution exit reserve add 64 bytes each in the
logical policy. Raw-bank totals exclude engine globals, page rounding and application
state. These are test dimensions, not suggested production limits. The projection
allowance excludes allocation headers, chunk-array/view metadata, outbound UTF-8
preparation, final-response serialization, other application values and host-internal
buffers. The adapter accounts for the five selected fetch-owned handle roles and
this projection domain; it is not a complete guest-memory/host-resource ledger.

The control host ledger deliberately includes untracked ingress and terminal-output
resources. Output-preparation failure cases demonstrate this coverage boundary:
fetch resources can be cleaned while an independently owned output allocation
remains. Incoming streaming forwarding, GRIP, S3, KV/assets and other shared-reader
callers are not migrated by this experiment.

The main cost finding is therefore a requirement on the next profile: derive
backing-allocation bounds, include simultaneous copies, and identify the evidence
needed before refund. The small bookkeeping banks do not make body storage small.
Matched application timing and production profile selection remain RA-09/adoption
work. Artifact-size deltas in the receipt include diagnostic exports and are not
isolated shipping overhead.

## JavaScript ownership boundary

[check-js.cjs](check-js.cjs) registers a synthetic bounded response claim before the
adapter resolves a real Web Response. The existing executor performs ownership
registration, final-response transfer exceptions, cancellation and late-arrival
handling. The probe covers fulfilled/rejected/never-settling cancellation, locked
bodies, explicit final transfer, cancellation followed by a late response, and
whole-cohort shortage at 8/16/32.

No cancellation outcome is promoted into a host-quiescence proof. Unknown claims
remain charged. Final transfer can retire its qualified logical handle unit while
continued-access bytes/record remain. The 64-byte response charge is a synthetic
ownership fixture, not a derived bound on a Web stream. JavaScript body-allocation
instrumentation and complete cross-target memory profiles remain adoption work.

## Evidence and reproduction

```sh
node docs/internal/host-extensions/resource-accounting/ra05/check.cjs /tmp/hex-ra05
node docs/internal/host-extensions/resource-accounting/ra05/check-js.cjs /tmp/hex-ra05-js.json
```

[Evidence index](evidence-index.json) pins executable source snapshots, generated
AssemblyScript, actual Wasm, authored handlers, Native plans, host traces and run
receipts in `evidence.tar.gz`. The initial 27-case and expanded 43-case passes are
retained separately from the final containment case. [Validation](validation.json)
records completed repository checks and scope classification. Injected-host
consumption choices are test assumptions, not platform compatibility claims.

RA-05's bounded checkpoint connects accounting to core fetch behavior and exposes
remaining profile/qualification obligations. RA-06 can now map cache-specific
acquisition, readiness, commit and abandon into the same ownership policy; RA-07
must qualify the combined demand and preserved driver behavior. No merge, release,
real-host acceptance or full runtime regression is claimed here.
