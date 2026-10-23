# HEX-01 — Private authored Fanout proof

Status: **executable investigation, not a supported API or extension protocol**.
Work item: [#509](https://github.com/pulse-compute/pulse/issues/509).
Base: `e30754019f03fa95a74ae72392382f44f2351927` (`latest`, HEX-00 merged).
Human direction: “Proceed with 01”; collect the work on a separate branch and
file pass PRs against it until stability supports promotion to `latest`.
Integration: `hex-integration`. Work branch: `hex/01-fanout-proof`.

## Result and decision

The authored call in [fixtures/fanout.ts](fixtures/fanout.ts) compiles through
ordinary project reachability, the GRIP-owned lowerer, canonical package effects,
Native planning and the Fastly provider. The package supplies the host import
binding as source in `realizationArtifacts`; the compiler/provider contains no
Fanout method or ABI-name selection. Existing `grip.handoff` remains response
framing. The namespace property `handoffFanout` is marked internal, has no new
supported manifest symbol, and is only a provisional spike surface.

Injected execution proves one dispatch with the selected downstream request
handle and UTF-8 configured backend, ordinary effect settlement/resumption, and
terminal completion without sending a response. The normal control branch
still sends once. Repeated entry, fourteen injected nonzero statuses, a host
trap and premature settlement after dispatch produce no second dispatch/send.
These are observations of the fixture, not Fastly failure-ownership acceptance.

**Recommendation: proceed to HEX-02's contract/admission work after review.**
This slice does not require a canonical result-kind or continuation ABI change.
Keep actual handle cleanup and failure ownership as HEX-03 acceptance blockers.
There is no basis yet to call the method production ready or merge the
workstream into `latest`.

## Exact slice

The provider accepts one `host.extension` effect, directly returned in an
ordinary handler, with a literal logical backend key resolved through existing
`bindings.backends`. Only pure path/method/URL predicates and a text-response
control accompany it. The provider rejects additional effects, grouping,
helpers/handlers, statements such as loops/assignments, request-body/state
expressions, other response intrinsics, logging and guest-unit composition.
The package rejects nonterminal placements and nonliteral backend arguments.
No new configuration field, automatic backend registration or portable fallback
is added. Router, middleware, `ctx.call`, parallelism, body mutation and
preceding effects are outside this proof.

JavaScript calls that can be recognized, and Node Native calls, fail compilation
with package, operation, selected target and source location in an internal
`PULSEWASM_HOST_EXTENSION_PROOF_TARGET` diagnostic. The package function throws
“not implemented for this host” for dynamic JavaScript calls. Generic GRIP
handoff compiles on all three rejected host/mode controls and its JavaScript
runtime behavior remains available.

The proof uses the exported project compiler and the provider's Native compiler,
not a handwritten canonical plan. It does not claim the complete CLI packaging,
packed external consumer, report UI or deployment workflow is qualified. In
particular, reusable target policy/service advertisement and guest-link policy
composition belong to HEX-02. Guest-unit composition is rejected here.

## Minimum proposed contract and provider service

`realizationArtifacts` carries this private envelope without changing its
existing transport or package-owner validation:

| Field | Proof meaning |
| --- | --- |
| `version` | `pulse.host-extension-proof.v0`; deliberately not stabilized |
| `id`, `package`, `contractId` | Qualified contribution and owning lowerer |
| `kind`, `mediaType` | `host-extension-proof`, `text/assemblyscript` |
| `data.target` | Exact selected target identity, `fastly-compute-native` |
| `data.operation` | Package-owned `handoffFanout` |
| `data.service` | `terminal-request-backend.v0` |
| `data.source`, `sha256`, `entry` | Inline generated source, digest and callable symbol |
| `data.imports` | Required module/name and Wasm parameter/result types |

The package-generated source declares `redirect_to_grip_proxy_v2`. It takes
request handle, backend pointer and backend byte length, returning status. The
provider owns all argument allocation and lifetime, the invocation ticket,
dispatch fence, completion token and downstream response policy. The source
uses no provider-private global name or monorepo path.

A generic `host.extension` capability/effect avoids adding a global capability
for each package method. Matching is by package + contract + operation; exactly
one matching artifact is required. Source digests, target/service, static backend
and import signature are validated before realization. The final provider audit
composes its baseline import ceiling with selected declarations, then checks the
actual Wasm type/import sections. Unselected imports and a source whose actual
signature disagrees with its declaration are rejected. Admission is based on
selected declarations, never inferred from observed imports.

This is a deliberately narrow provider service, not a general ABI plugin API.
HEX-02 still owns strict schemas, explicit target service advertisement,
capability negotiation, collision/determinism cases, policy identity, reusable
signature validation and diagnostics. Trusted package source retains compiler
authority; none of these checks sandbox it.

## Completion and ownership findings

The existing value-handle carrier can transport a provider-created opaque token.
The result returns through the normal invocation settlement and `pulse_resume`
path. The provider checks token identity and transfer state before accepting
terminal completion; it never decodes the token as a response. No canonical
runtime status or Wasm continuation signature changes.

Provider state is `owned -> outcome unknown -> transferred -> completed`.
Allocation occurs before dispatch. The state changes to unknown immediately
before the hostcall, then to transferred only on status zero. From the unknown
state onward both the shared error responder and normal result sender are
fenced. A post-transfer settlement fault is observed with stage 101 and no
response. Duplicate entry is rejected by existing invocation admission.

The proof intentionally performs no explicit request/body close after dispatch.
It retains resources for invocation teardown rather than guessing ownership.
The existing provider also keeps downstream handles for the request lifetime;
this experiment does not prove that leaving them to host teardown is the final
correct cleanup policy. No retry, 502, rollback or delivery promise is inferred.

Pinned evidence is retained in
[hex01-source-evidence.json](hex01-source-evidence.json):

- Rust SDK `fastly 0.13.0`, archive SHA-256
  `62012ce6544fe774aa10ac4fb6b4715f8b0e3ffa5ff32c6a46b24cd625900493`.
  [Request source](https://docs.rs/fastly/0.13.0/src/fastly/http/request.rs.html)
  fences downstream response before invoking the ABI. Its high-level handoff
  discards the body handle separately and passes the request handle by value to
  a helper; Rust drop closes that handle on either return path. The low-level
  method borrows a request handle. This distinguishes SDK cleanup from ABI
  ownership; an error response contains a clone without the body, not returned
  authority to send downstream.
- Viceroy `v0.18.0`, commit
  `6cc29ea3c4534518322df8cc19766519384de633`.
  [Core ABI implementation](https://github.com/fastly/Viceroy/blob/6cc29ea3c4534518322df8cc19766519384de633/src/wiggle_abi/req_impl.rs)
  validates guest backend text, borrows request parts and copies handoff metadata;
  it does not take the body handle. Input/invalid-handle failures precede handoff.
  [Downstream state](https://github.com/fastly/Viceroy/blob/6cc29ea3c4534518322df8cc19766519384de633/src/sandbox/downstream.rs)
  replaces its state before handing off or reporting an already-used sender.
  Thus a nonzero status is not general evidence of available response authority.
  Component and core adapters have different invalid-handle handling; no
  cross-adapter equivalence is claimed.
- The pinned WITX declares `(request_handle, backend string) -> status`, lowered
  to `(i32, i32, i32) -> i32`. Neither the declaration nor local engine source
  establishes hosted service behavior for every error status.

| Case | What this pass establishes | Still unresolved |
| --- | --- | --- |
| Status zero | Injected single handoff, token completion and no response; source indicates terminal downstream authority | Real backend delivery and resource cleanup |
| Injected statuses 1–14 | Status retained; no retry, send or speculative close | Which statuses the actual service returns and ownership on each |
| Trap | Unknown state remains fenced, including repeated entry | Host teardown/delivery and resource accounting |
| Bad input/handle | Pinned Viceroy core source fails before downstream transition | Execution evidence and hosted correspondence |
| Already-used downstream | Pinned source can reject after changing downstream state | Supported recovery/cleanup, if any |

Viceroy, Fastly CLI and Pushpin are not installed in this environment. Local
engine execution and hosted execution are **not run**. Source inspection and
injected traces must not be reported as either lane passing.

## Artifact measurements

The same fixture paths and recipe run against unchanged base code and this
working tree. An independent worktree at the base, with frozen dependencies and
lifecycle scripts disabled, reproduces every retained baseline exactly.
`hex01-baseline.json` and `hex01-result.json` retain full hashes and import lists.

| Fixture | Baseline bytes | Proof bytes | Exact own-baseline hash/import equality |
| --- | ---: | ---: | --- |
| No selected extension (`absent`) | 23,444 | 23,444 | Yes |
| GRIP import unused (`unused`) | 23,444 | 23,444 | Yes |
| Generic GRIP handoff only (`generic`) | 25,268 | 25,268 | Yes |
| Used Fanout + normal branch | N/A | 26,928 | New proof; one extra host import |

The used fixture is 3,484 bytes larger than the ordinary response fixture. This
is a whole-program delta including route selection and effect machinery, not an
isolated ABI cost or performance claim. The absent and unused fixtures have
different source identities and therefore different embedded hashes despite
equal size. Each is compared to its own unchanged-toolchain baseline.
All packages are installed in this workspace: “absent” means no selected
extension, not an external installation with the package physically removed.
Packed/outside-workspace qualification remains HEX-04.

## Six decisions from HEX-00

1. **Carrier:** existing artifacts suffice; no provider object or discovery hook
   is passed into the lowerer.
2. **Services:** a provider-owned terminal request/backend projection is enough
   here. The package supplies only the synchronous ABI entry and signature.
3. **Completion:** no canonical result/continuation change for this slice. The
   shared error responder, final result sender and final result validation need
   explicit transfer fences. Body-forwarding/composition remain rejected.
4. **Ownership:** injected outcomes prove local fencing only. SDK and Viceroy
   source distinguish borrowed ABI inputs from separately closed SDK handles.
   Actual success/failure cleanup remains unresolved pending engine receipts.
5. **Capabilities:** one generic capability plus owned operation matching works;
   there is no new per-GRIP-operation global constant.
6. **Cost:** unused contributions add exactly zero bytes/imports in three own-
   baseline controls. Used cost and missing acceptance lanes are recorded above.

## Reproduce and validation

```sh
npm run build
node docs/internal/host-extensions/assert-hex01.cjs
# Deliberate historical receipt refresh, only after inspecting the comparison:
node docs/internal/host-extensions/assert-hex01.cjs --record
node wasm/scripts/run-wasm-tests.cjs --task fastly-host-extension-proof --no-report
```

The regression task exercises behavior/admission without pinning unrelated future
compiler improvements to historical artifact hashes. The separate evidence
command enforces the exact HEX-01 baseline comparison. All receipts are internal
investigation artifacts, not release or hosted acceptance seals.

The retained [validation receipt](hex01-validation.json) contains commands,
source fingerprints, individual task outcomes and failed-attempt excerpts.

- Workspace TypeScript build, the dedicated authored proof, ten focused
  package/provider tasks, maintainer checks, docs checks, documentation-release
  and scope declaration passed. The dedicated proof was rerun after final
  metadata/source-location edits and after correcting receipt snapshots to
  capture the post-scenario error stage.
- Two attempts at the combined unit/native/JavaScript/conformance profiles stopped
  at `cli-report-handler-topology`: first a retained-artifact hash mismatch,
  then a control/observed topology mismatch. The isolated task passed. Both a
  shorter unchanged-base prefix and the exact 16-task failed-prefix selection
  on unchanged base passed. The discrepancy on the spike is **unresolved**;
  it is not declared a known baseline defect.
- A separate development selection from `cli-report-handler-associations`
  completed all 165 remaining tasks successfully. These partial runs and the
  isolated pass do not constitute a clean aggregate run or release seal.
- Initial control-plane checks identified the missing release-shard mapping for
  the new regression task; the mapping was added and the checks passed on retry.
- The PR remains draft for the report discrepancy and architecture review.
  Engine/hosted handoff, cleanup and external packed acceptance remain later
  qualification work. No check is waived by this investigation.
