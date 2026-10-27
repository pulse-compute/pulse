# P07 — Bounded core fetch integration

This completes the Fastly Native core-fetch service integration described by
P07, on `latest` `e770db6c2e8ea6893d74feabd4de4d1c3375f937` (after #553).
It does not complete the bounded RA milestone or claim accounting for every
existing fetch program. Human direction: “Finish p07.” Entry point:
`provider-fastly`; additional owners are maintained provider tests, the test
registry/evidence mapping and this internal adoption record. Classification:
architecture. Human review retains authority over resource ownership,
effect/continuation and provider/target boundaries. No merge or deployment is
included.

The earlier forwarding, decoded-body, single text and single JSON implementations
remain applicable. The new `canonical-fetch-cohorts` profile follows the existing
single-operation selectors and covers proved pure-fetch handlers and Router
routes, including ordinary results, retained response/text/JSON aliases,
sequential operations, parallel groups, uploads and opaque response transfer.
No accounting flag or new authoring syntax is introduced.

## Acceptance mapping

| P07 requirement | Production implementation |
| --- | --- |
| Acquisition and send | Commit one complete invocation inventory before the first request/body acquisition, UTF-8 encoding or upload serialization. Fence request/body consumption and reserve pending plus response/body outputs before send. |
| Wait and poll | Use the existing deadline scheduler, including for fetches without an explicit header timeout. Associate pending handles with the existing authenticated driver ticket. No second scheduler or effect counter. |
| Body backing and aliases | Retain the existing `3B + 5` decoded-body allowance per admission through teardown. Cache response header decoding and strict JSON classification across aliases. Parser/schema materialization remains separately owned and excluded. |
| Uploads | Prove input string/JSON bounds from canonical values and existing bounded readers. Charge uppercase, encoding and serialization copies. Validate partial write progress under the original deadline. |
| Opaque transfer | Match the owned response/body pair, fence both before downstream send, retire only on a qualified successful result. Unknown send never permits close or resend. |
| Cleanup and uncertainty | One bounded cleanup poll per known pending handle; close only known live handles. Unknown acquisitions, polls and disposal outcomes retain their claims. Preserve the primary driver failure and protected error response allowance. |
| Existing guards | Keep canonical cumulative effect admission, group width, original deadline, body/schema limits and response authority. Fetch inside a bounded read loop is already rejected by the compiler and remains a maintained negative case. |

## Selection proof and unchanged paths

The entire selected plan has only fetch effects, statically configured backends,
an existing body-byte bound and an original request duration of 1–30,000 ms.
Initialization/header objects have unique literal keys; an explicit timeout is
positive and literal. The profile supports absent timeout using the original
request deadline. Literal strings, immutable aliases, bounded request
method/URL/path/header/text and fetched text, concatenation and defaults supply
input bounds. Literal-key JSON objects/arrays recursively combine these bounds
with bounded scalar formatting. Mutated or otherwise unproved aliases are not
assigned an invented zero allowance. The selected request method/URL readers
validate returned ABI lengths before unsafe decoding.

Response header names must be literal. Each response owns at most one lookup
per admitted name. A strict content-type check uses the existing first-value,
case-insensitive `json` substring semantics, cached across repeated `.json()`
reads. Existing literal single-fetch artifacts keep their previous selector and
emission.

Dynamic backend registration, dynamic response header names, unproved input
values, mixed capabilities, Router error handlers, application packages and
callable/child graphs do
not select this profile. Their existing behavior remains available without a
new ledger claim. No supported syntax is removed to obtain accounting coverage.
Application recovery/composition needs its own profile and P10 qualification;
this is not evidence for arbitrary child graphs or all target combinations.

P06 owns compiler-proved child composition; P08 owns cache; P09B owns JavaScript
accounting parity and separate Node qualification. P10's broader application
matrix, P11B costs, P12B report integration and P13/P14 host/promotion gates
remain separate. Successful constructed downstream responses, incoming request
context, application values, JSON parser/schema materialization, diagnostics,
driver identity storage, allocator metadata and host memory are explicitly
outside this fetch-service payload inventory. There is no total-memory,
physical-reclamation or cancellation guarantee.

## Inventory and runtime ownership

Let S be the static fetch-site count and N the maximum admissions implied by the
canonical control tree, capped by the existing cumulative effect limit. Ordinary
acyclic handlers reserve S; a repeated control form conservatively reserves the
existing cumulative limit. This is a compiler inventory, not a runtime counter.
Five slots per existing ticket own request, upload body, pending request,
response and response body. Two additional slots protect error delivery.

The ledger reserves `5N + 2` handles, `5N + 7` records, `5N + 2` cleanup/exit
steps and N effects. Storage is `1024 + 128 * records` bytes. One atomic P05 plan
stages the complete inventory; reserved slots never recycle. All backing remains
charged until teardown. Pre-dispatch admission cannot partially launch a group.

Scratch payload is `12N + (36 + 4S)N + 52 + N`: request outputs, bounded scheduler
outputs, reused clock/body-wait/cleanup storage and cleanup flags. Each admission
adds the maximum proved encoding/serialization inventory and `3B + 5` reader
bytes. Each literal header key k adds `3C + utf8(k) + 11`; strict content-type
classification adds `4(C - 1)`. Header cache storage adds `48K + 32` for K keys
when nonempty. C comes from the actual provider buffer constant. The protected
error text adds 64 bytes. The producer independently verifies every P05 required
dimension against this inventory.

The pinned AssemblyScript implementation initially allocates up to six bytes
per input UTF-16 code unit for uppercase conversion; encoded uppercase fits nine.
For a JSON serialization bound of L code units, V scalar/container nodes and M
numbers, the profile reserves `8L + 128V + 128 + 1024M` bytes for quote buffers,
quoted strings, parts-array growth, joining and numeric formatting, plus UTF-8
encoding. These are conservative service-owned payload bounds, not observations
of total process memory. Unknown handle outcomes never refund backing or imply
physical reclamation.

## Qualification contract

The maintained `fastly-fetch-cohorts` task compiles real authored projects through
the production project compiler and provider generator. Trusted lifecycle
observers inspect closure and retained claims without replacing generated source
or introducing a production test switch. Plain/observed artifacts check response,
host trace and outbound-request parity. The task includes width-32 groups,
sequential aliases, Router siblings, bounded dynamic inputs, JSON/text upload,
partial writes, malformed ABI results, zero namespace handles, unknown send/poll/
close/transfer, deadline/clock failures, overflow and trap behavior.

Source-free installed replay resolves compiler/provider implementations inside
an isolated consumer and verifies installed files against release tarballs.
Pinned Viceroy replay exercises the exact plain alias/group/upload/opaque
artifacts. Unselected controls and the existing single text/JSON artifacts are
compared with the base. The final PR records immutable candidate/tree identities,
complete regression coverage, exact artifacts, failed development attempts and
remaining qualification limits. Local Viceroy is not hosted acceptance; a passing
focused run is not the complete final-candidate regression report.
