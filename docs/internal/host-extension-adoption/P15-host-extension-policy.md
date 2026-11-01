# P15 — Package-driven host-extension policy

Status: **policy proposal prepared for human architecture review; not enacted**.
Date: 2026-10-27 (America/Denver). Production base: `latest` at
`534acd58fb8afaeb7cb33cf4cb03866698668816` (merged P07, #554).
Branch: `adoption/p15-policy`; PR target: `latest`.

Human direction: “Proceed” after the handoff identified P15 policy as the next
unit. This pass prepares the minimum contract and a bounded implementation plan.
Entry point: `documentation-current`; writes remain internal adoption records.
It does not enact a public API, provider advertisement or runtime contract, or
approve its own architecture decisions. Merge, publication and release remain
human-owned.

The [priority audit](host-extension-priority-audit.md) is the scope authority.
Its audit and P01 direction annotation are copied from the documentation-only
audit in PR #555 (published `c7777fefa5c89b41cb0cec348433eef75efd4620`, local
equivalent `5ac816b271ea89819ebcbc2798d9c7416549a306`). No P08 runtime/package
changes are inherited. At preparation, #555 is open, draft and unmerged at that
head. Cache semantics, composition and broad RA follow-ups remain deferred.

## Proposed decision

Adopt the generic contribution path with **one initial terminal service** on
Fastly Native. An independently named trusted package must use the ordinary
authored compiler/build/pack path without adding a compiler/provider package-name
switch, operation-specific capability constant or handwritten dispatch branch.
The package owns its operation and generated ABI shim; the selected provider
implements a reusable service contract and qualifies host outcomes. Pulse's
existing driver continues to own invocation, scheduling, deadlines and closure.

This is the first bounded implementation of package-driven host extension, not a
claim of general nonterminal or resource-owning extension support. Service IDs
name execution/authority contracts, not individual packages or ABI function names.
Adding an operation within a service must be package-only work; adding a new
service may require a separately reviewed provider/runtime implementation.

| Decision | Proposed minimum |
| --- | --- |
| Contribution | Adapt research `pulse.host-extension.v1` through the existing `realizationArtifacts` carrier. Keep owned canonical operations and reachable trusted discovery. |
| Provider admission | Exact protocol/service advertisement on the explicitly selected target; no scanning, global registration or implicit fallback. |
| First operation form | `terminal-request-backend.v1`: one direct terminal return in a plain HTTP handler, with a literal configured backend key and bounded pure ordinary-response branches. |
| Shared services | Bind to existing execution lifecycle and, for this HTTP service, response authority. Accounting and observers are independently selected facilities, not universal extension prerequisites. |
| Exposure | An explicit `@pulse-compute/grip/experimental` subpath for provisional handoff methods; keep them absent from the root runtime object and root declarations. No new support tier or released support claim. |
| Provenance | Retain unique contribution identities, separate use-site membership, selected services and declared versus observed imports with exact artifact/policy identity. |
| First proof | Two terminal operations plus a separately named/versioned packed package; negative target/placement/admission cases and absent/unused/generic controls. |

The exposure and operation-form choices above are recommendations to review,
not approvals inferred from the instruction to prepare policy.

## Reconcile research with the current owners

Research reference: `ecc36468b5900a0de57a415379b85d12c5026f3f`. Read selected
implementations as reference material; do not merge the branch or import its
historical harnesses into routine builds/tests.

| Source owner / evidence | Production consequence |
| --- | --- |
| `wasm/packages/contracts/src/package/package-contract.js`; compiler `spine/package-operation-seam.js` | Existing owned effect/operation and artifact envelopes transport the contribution. The present generic artifact owner check alone does not perform host-extension admission. Add protocol validation at that boundary; retain all existing ownership/discovery checks. |
| Research `provider/host-extension.js`, HEX-02 | Reuse strict data validation, source digest, exact operation/target matching, deterministic selection and precomputed import policy. Production currently lacks this owner. |
| Research Fastly `build/host-extensions.js`, HEX-03 | Adapt the service, token authentication and conservative ownership rules to current structural emission. Do not transplant research source rewrites, raw diagnostic exports or parallel response-state ownership. |
| Current `handler/execution-lifecycle.js`, `handler/lifecycle-planner.js`, `host/http-lifecycle.js` | Reuse six execution points, optional HTTP points and the canonical invocation policy. These data contracts are not package hook APIs. |
| Current `runtime-core-as/src/compiler/lifecycle-emitter.js`; Fastly `build/lifecycle.js`, `build/response-authority.js` | Attach the selected service at explicit sites; use the shared authority state already used by forwarding. Do not duplicate its state or attach by function-text anchors. |
| Current host-runtime `runtime/native-execution-lifecycle.js` | Preserve host-style lifecycle conformance; its HTTP rejection means loading shared contracts does not make Node a terminal-handoff host. |
| Current `handler/resource-admission.js`, runtime-core-as `compiler/resource-ledger.js`, P04/P05/P07 | Reuse where an admitted service actually needs accounting. Existing fetch accounting stays intact; do not require a cache profile or claim the new terminal service has RA coverage. |
| Research HEX-04 and current CLI `src/internal/report/` | Retain selection/import evidence in the provider result first; P12A owns current report/compare projection and packed readers. Build evidence never substitutes for runtime/host acceptance. |

The [nonterminal investigation, PR #523](https://github.com/pulse-compute/pulse/pull/523),
head `2efa108b8a84a70ced7c02c169c90b6bde19cf8d`, remains open and evidence-only.
Its [record](https://github.com/pulse-compute/pulse/blob/2efa108b8a84a70ced7c02c169c90b6bde19cf8d/docs/internal/host-extensions/nonterminal/README.md)
shows immediate observations using existing tickets, await/groups and collections.
It also leaves result typing, layout/authority identity, completion instrumentation
and many-use-site reporting unresolved. Its adapter replaces module exports and
uses source replacements. Reuse these findings; neither repeat the spike nor
adopt that adapter as a production service. The experiment's extra unused
fetch-status import and repeated-site report failure remain recorded limits.

## Contribution and admission contract

The proposed initial wire shape retains the research envelope. The implementation
must specify and test its exact normalizer, rather than accept arbitrary fields
under the word “experimental.”

| Record | Required meaning |
| --- | --- |
| Envelope | `version`, package-owned unique `id`, `kind: host-extension`, `mediaType: text/assemblyscript`, `package`, `contractId`, `data`. Owner must match the selected trusted manifest; ID is prefixed by that package identity. |
| `data` | Exact `target` triple (`provider`, `target`, `targetId`), owned `operation`, versioned `service`, bounded inline `source`, source `sha256`, package-owned `entry`, and declared `imports`. |
| Import | Exact `module`, `name`, ordered MVP scalar `parameters` and `results`. Contributed imports are functions only. |
| Target advertisement | `pulse.host-extension-admission.v1`, exact admitted `protocols` and `services`. Absence means no host-extension admission. |
| Operation | Existing canonical package identity, source/use-site identity, `host.extension` kind, service-compatible terminal result/placement and literal backend resource. A generic kind is transport, not permission to call every host ABI. |

Retain the research bounds: static identities up to 256 characters, inline source
up to 65,536 UTF-8 bytes, at most 64 import declarations, at most 32 scalar
parameters and one scalar result per declaration, and at most 256 candidate
contributions in a selection. The terminal service narrows this to one contributed
import with `(i32, i32, i32) -> i32`, receiving a borrowed request handle and
backend bytes/length. The entry must implement that service's semantics, not
merely share its machine signature. Any other operation form requires a distinct
reviewed service contract.

Reject unknown fields/versions, accessors, executable metadata, malformed or
sparse records/lists, owner mismatches and conflicting identities. The generated
source remains trusted executable build input: forbid external source paths,
module imports/exports and provider-private identifiers under the bounded source
convention, but do not describe those checks as sandboxing. Packages receive no
driver object, compiler service/cache, mutable target descriptor, binding map,
resolved secret or runtime registration facility. The provider resolves the
literal backend through existing configuration after admission.

Selection is deterministic and operation-specific:

1. Discover reachable trusted manifests through the existing project graph and
   normalize their owned effects/artifacts. An ordinary runtime import grants no
   lowerer authority; an unrelated installed package is not loaded for discovery.
2. Match each used operation by package, contract and operation identity, then
   match the explicitly selected provider/mode/target ID. Require exactly one
   compatible implementation and an advertised protocol/service pair.
3. Reject missing/ambiguous matches, duplicate contribution IDs, conflicting
   ownership, entry-symbol collisions, unsupported placement and missing bindings.
   Shared identical definitions transported from multiple modules may retain the
   existing canonical deduplication; conflicting definitions must still fail.
4. Validate the selected service's requirements, construct its lifecycle bindings
   and import ceiling before emission, and emit only selected implementations.
   Reordering candidates must not change selection, policy identity or emitted
   behavior. Generated slot dispatch is data-driven, not a per-operation branch
   manually added to the provider.

Provider advertisement is a protocol/service acceptance claim, not a publisher
allowlist or a blanket statement that every declared host import exists. Host ABI
availability and outcome semantics still need operation/target evidence. No npm
version equality with Pulse is required; exact supported wire versions are.

## Lifecycle, management and observation attachment

The service adapter translates admitted operations into the current internal
lifecycle plan and emitter. Packages select a versioned semantic service through
data; they cannot submit lifecycle hook bodies, choose arbitrary hook orders or
access `lifecycleServices` as a public contribution API. One terminal service
adapter can serve independently named packages and ABI shims.

| Shared facility | Initial terminal binding and invariant |
| --- | --- |
| Invocation and readiness | Use existing static effect sites, live single-use tickets, readiness delivery and cumulative budget checks. No new ticket allocator, queue, scheduler or request clock. |
| Settlement | `effect.settle` authenticates the selected slot, exact ticket and opaque completion before consumption. `effect.deliver` and `effect.result` restrict completion to the private delivery path. A raw setter, stale token or closed invocation cannot authenticate success. |
| HTTP authority | Select optional HTTP semantics because this service transfers an HTTP response. Fence before ABI dispatch; retain unknown on nonzero/trap, transfer only on qualified success, and complete only after authenticated final selection. Ordinary/error/timeout sends use the same fence. |
| Closure and cleanup | Use acquired/close/end/closed sites according to their current postconditions. Pre-close observation is not post-invalidation authority. Retire known handles before attempting disposal; preserve primary errors and never retry uncertain disposal. Guest after/end/closed points are normal-return notifications, not trap finalizers. |
| Resource management | A service requiring ledger reservations must declare and validate a bounded profile before acquisition through P05/P04. This terminal slice has no new package-owned persistent resource, pending-resource registry or RA guarantee; borrowed ingress and temporary backend/token allocations still need bounded service cleanup. |
| Observation | Reuse shared point dispatch and ordering. Keep optional observers independently selectable, record their point coverage, and prove the same observer binding works for both packages without package-specific instrumentation. No observer machinery when unselected. |

The first terminal implementation must explicitly bound backend encoding and
completion allocation using the existing applicable limits before dispatch; it
must not describe those logical limits as total-memory accounting. If safe
execution requires additional resource ownership or a new profile, identify that
bounded prerequisite rather than silently inventing an unaccounted resource form.

For the qualified terminal adapter, response transfer and local handle ownership
are separate. Research treats status zero as response transfer while retaining
local borrowed request/body handles for one close attempt. Nonzero/trapped
dispatch leaves disposition uncertain and does not justify speculative close,
replacement response or retry. Carry these as operation-specific adapter rules
requiring candidate-bound proof, not universal host status semantics. Packages
retain their own operation semantics and resource-specific cleanup where an
admitted future service permits package resources.

Required service semantics are not optional: this service needs execution and
HTTP bindings, and admission fails if they cannot be supplied. HTTP, accounting
and observation are not required of an unrelated future service merely because
they exist. Unsupported required facilities reject; optional facilities may be
absent only with explicit coverage. Do not silently promise full instrumentation.

Initial instrumentation acceptance is shared attachment plus selected-point
coverage and bounded injected traces. It does not require a public telemetry API,
RA-08 report adoption or exported diagnostic functions in production Wasm.
Observers cannot grant settlement/response authority, extend deadlines or replace
primary failures. Preserve each driver style's existing failure/trap behavior;
guest observer execution is trusted and has no new fault-containment guarantee.
Record partial/normal-return-only coverage when a trap prevents exit observation.

## First operation forms and public exposure

| Form / target | First implementation policy |
| --- | --- |
| Fastly Native plain handler | One direct terminal return, literal backend key, bounded pure method/path/URL conditions and ordinary text-response branches. Prove both handoff operations independently. |
| Router terminal route with ordinary siblings | P16 after P15; reject in the initial implementation until explicitly qualified. |
| Nonterminal immediate observation | Reject; the #523 result/authority/completion contract remains separate. |
| Pending or resource-owning operation, child effects | Reject; no cache, callback, implicit cleanup manager or composed executor is admitted by this service. |
| Multiple/parallel handoffs, surrounding effects, middleware, helpers, `ctx.call`, escaped/assigned completion, body mutation/forwarding, guest-unit composition | Reject for the new terminal form. Preserve already supported ordinary operations and placements. |
| Node Native, Node/Fastly JavaScript, compile-only or an unadvertised target | No terminal execution claim; recognized unsupported uses fail explicitly. Compilation/inspection alone never proves host execution. |

Proposed experimental authoring is named exports `handoffFanout(ctx, backend)`
and `handoffWebSocket(ctx, backend)` from `@pulse-compute/grip/experimental`, used
as a direct terminal return. Require the existing explicit request context;
do not copy the research's context-free facade signature into production. The
context conveys request ownership through the existing effect boundary, not a
host SDK. The result is an opaque compiler-confined terminal completion, never
an ordinary `Response` or a token callers may inspect, store, reuse or construct.
Its TypeScript/runtime representation must be checked against the admitted
handler return contract during implementation; a cast alone is not proof.

This separates provisional handoffs from the supported root's generic framing
and broadcast methods, including its existing pure `grip.handoff`. Both runtime
exports and declarations must enforce the separation. Re-exporting the new
methods on the root while hiding their types is forbidden. Dynamic JavaScript
calls through the experimental subpath must throw the explicit unsupported-host
error; ordinary generic methods keep current behavior.

The implementation may add the explicit experimental subpath to local candidate
package exports/files and trusted manifest recognition, with packed export/type
tests. It remains outside the release manifest's supported entry-point list;
document its provisional status consistently with the existing rule that
unlisted implementation interfaces carry no supported compatibility promise.
Do not invent a manifest support tier, promote package-root support, publish npm
packages or claim hosted support. If the release owner later advertises this
subpath as supported, that requires a separate support-policy decision.

Protocol versions bind schemas and service semantics. Incompatible meanings
require a new version; do not silently reinterpret v1. Experimental npm/API
changes can occur before promotion but must retain explicit target failures.
Map internal failures to the existing public diagnostic catalog with authored
location and package/operation/target context. Cover malformed/protocol, owner,
target, conflict, placement, binding, source/signature and import-policy failures;
do not expose source bodies, secrets or provider-private state. Final public code
names must be allocated in the canonical catalog and tested; message prose is
not the protocol. A generic internal error must not become the only CLI evidence.

## Import auditing and provenance

Compose the selected provider's declared baseline with selected contribution
imports **before** inspecting emitted Wasm. Reject baseline redeclarations and
conflicting contributed signatures. Validate the final packaged artifact's
imports and the policy/source identities; observed imports never add permission.
Every selected v1 import must be present with its exact signature. Dead-code
removal of a declared import is not silently reinterpreted as successful v1
execution coverage; a different optional-import rule needs an explicit contract.

Correct a research limitation during adoption: research `auditWasm` rejects all
non-function imports while parsing the whole module. Restrict the function-only
rule to contributed imports, and preserve kind-aware validation of the complete
provider baseline plus existing required-export, memory, feature and start rules.
This does not authorize memory/table/global imports forbidden by that target's
own final-Wasm policy. Include a contract fixture with a legitimately permitted
baseline non-function import and a negative unpermitted counterpart.

P15's provider artifact/manifest must retain the following without exposing raw
generated source or request data in public evidence:

- Unique contribution census: package/contract/operation, contribution ID,
  protocol/service/target, entry and generated-source digest.
- Separate canonical use sites and source locations with many-to-one references
  to contributions. Do not equate one contribution with one site or one reserved
  slot; #523 demonstrated that reporting error.
- Selected provider/service implementation identity, lifecycle binding versions,
  selected management/observation facilities and their declared coverage.
- Baseline and composed policy identity, declared import signatures, observed
  final imports/signatures, and the exact final Wasm hash.

P12A projects these into current report/compare schemas, retained output and
installed readers. Keep unknown historical coverage distinct from known empty
selection. Runtime observations must carry their own execution/artifact identity
and completeness; a build-time selected point is not evidence that it ran.
Keep source fingerprints null where unavailable. Resource envelopes, final
records, aggregate measurements and sampled events are separate coverage claims.
The P15 mechanism can be reviewed before P12A, but the usable HEX milestone
cannot claim complete report/compare attribution before that work passes.

## Bounded implementation and acceptance

The next implementation should adapt the selected research protocol, wire generic
validation/selection through current owners, bind the terminal adapter to the
structural lifecycle, add the experimental facade and maintain small fixtures.
P12A report presentation, P16 Router admission, operation-specific P13 host lanes
and P14 candidate review remain explicit subsequent units. Do not gate this work
on P08, P06 or broad P09B/P11B/P12B accounting work.

| Required evidence | Acceptance boundary |
| --- | --- |
| Contract negatives and determinism | Exact owner/version/target/service/source/signature validation; missing, duplicate, ambiguous and conflicting contributions; reordered input identity; service/binding rejection. |
| Ordinary authored path | Compile/build/pack both handoffs and a separately named trusted fixture package with a different npm version and builder artifact version. No runtime module replacement or registry patch. |
| Reuse | A second operation selects a different ABI via the same adapter. The independent package needs no core/provider package-name edit; the same lifecycle observer applies to each. |
| Packed consumer | Build outside the checkout from exact tarballs and declared exports/CLI, with scripts disabled and installed files verified. No source-tree module resolution or research downloads. Check root/subpath runtime and type surfaces. |
| Lifecycle | Authentic, stale, forged, duplicate and closed completion; raw setter rejection; pre-dispatch expiry; post-dispatch unknown/failure/trap; cleanup failure; primary-error preservation; ordinary/error/timeout authority. State the tested instance lifetime; do not imply sequential reuse (#556). |
| Import audit | Whole baseline plus selected functions; signature/tamper negatives; legitimate baseline non-function fixture; audit exact final artifact, not an intermediate; no test-only diagnostic exports. |
| Omission | Absent, imported-unused, generic-only and extra-unselected contributions omit service, observer/accounting and ABI machinery. Compare each against its matched source/config baseline; separate embedded identity changes from executable/import growth. |
| Unsupported forms | Explicit target/placement/form failures; dynamic JS guard; ordinary generic behavior stays available on its current supported targets. |
| Evidence ownership | Manifest census/use-site/policy/coverage retention in P15; current report/compare readers in P12A; injected execution, local engine and hosted proof remain separate. |

Before implementation, declare actual protected owners: `lowerer-trust`,
`effect-capability-model`, `continuation-runtime`, `provider-registry`,
`runtime-target-fluidity`, and applicable `public-authoring-api` and
`package-publication` paths for facade/exports. Use the ordinary cross-owner
instruction chain if no single implementation Entry Point matches; do not combine
sibling Entry Points as an implicit permission expansion. These are proposed
future changes, not executable changes made by this documentation patch.

Run the classifier-selected checks on the actual implementation candidate and
complete required coverage; do not transfer P08 or research passes. Preserve
failed attempts and reconcile relevant recurrences of #516/#538. No hosted
deployment or old sandbox credential is assumed available.

## Policy checkpoint

This document is the concrete proposal for review: terminal-only first service,
explicit-context experimental subpath, generic owned contribution/admission,
shared lifecycle/optional facility attachment, kind-aware full import auditing,
and contribution/use-site/coverage evidence. The bounded implementation may
follow acceptance of these choices; this record does not mark it started or
complete. Broader service forms need their own semantic decisions, not a second
scheduler inferred from the word “extension.”

Policy validation is limited to maintainer/documentation synchronization and
checks, documentation-release validation, internal link review, scope and
whitespace checks. Record exact outcomes with the candidate. No runtime, local
engine, hosted or package acceptance result is claimed by this policy pass.
