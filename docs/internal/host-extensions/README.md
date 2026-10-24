# HEX-00 — Package-owned host extensions: scope proposal

Status: **proposal and boundary evidence only**. No extension protocol, new GRIP
method, ABI binding, or support promise is implemented by this change.
Date: 2026-10-23. Inspected base: `e69e4b6f1381a05bf0ee0b9b4c6385d2acefb20c`
(`latest`, beta.10). This repository-only note is not public or installed documentation.

Tracker: [#508](https://github.com/pulse-compute/pulse/issues/508).

Design follow-up: [authoring shapes, pass 1](DESIGN-01-authoring-shapes.md)
compares proposed observations and cache APIs across direct await, keyed parallel
and bounded effect collections. It is design-only and does not widen HEX support.

[Execution and evidence costs, pass 2](DESIGN-02-execution-costs.md) traces those
shapes through existing owners, separates shared investment from per-capability
work, and retains bounded structural probes. It adds no implemented capability.

Follow-up: [HEX-01 proof and decision record](HEX-01.md). The record below
retains HEX-00 findings; the integration branch carries the private experiment.

## Direction and scope

Human direction: investigate packages contributing ABI behavior to an explicitly
selected host; use GRIP/Fastly as the first proof. Generic and host-specific
methods may coexist in one package. Compatibility belongs to each operation;
switching hosts may reject a previously supported operation. There is no
requirement to invent equivalent portable behavior or split packages by host.
The user authorized pass 00 with “Implement 00”; its stopping point is a
reviewable scope, proposed contract, evidence and bounded follow-up tickets.

No single named Entry Point covers this cross-owner scope investigation. The
ordinary root/docs instruction chain applies; writes are confined to this
internal evidence directory. Production owners below are read-only. Classification:
evidence. Later implementation crosses public-authoring-api,
effect-capability-model, continuation-runtime, lowerer-trust, provider-registry,
and potentially configuration-contract boundaries; those passes must declare
their actual changes. This proposal does not approve its own architecture,
merge, release, or deployment.

## Recommendation

Reuse reachable package discovery and the normalized `realizationArtifacts`
carrier. Add a narrowly typed, versioned **host-extension realization** admitted
by the selected provider. Bind it to owned package operations and provider-owned
lifecycle services. Keep host-specific support inside `packages/grip/` initially.
Compiler orchestration transports and validates generic records; it does not
recognize GRIP or Fastly ABI names. A host extension binds existing host ABI
functions; it cannot add functions to Fastly's platform itself.

`init -> contribute -> validate/freeze` describes build-time assembly phases,
not an application-facing registration API. Contribution identity is independent
of package layout, so a later package split need not redesign the mechanism.

Use a distinct provisional method, `grip.handoffFanout`, for the proof. The name
and TypeScript signature remain provisional until HEX-01 proves a terminal
outcome. Existing `grip.handoff`, `subscribe`, `isWebSocket` and `broadcast`
retain their existing meanings. No automatic substitution of response framing
with connection ownership transfer is proposed.

## Findings at the inspected base

| Boundary | Current owner and finding | Required delta |
| --- | --- | --- |
| Reachability/discovery | `wasm/packages/compiler/src/project/package-reachability.js`; `wasm/packages/library-kit/src/compiler/handler-library-contracts.js`: reachable package bindings select trusted declarations. | Reuse discovery; select contributions by used operations. Do not scan all installed packages. |
| Package result | `wasm/packages/contracts/src/package/package-contract.js`: strict result envelope already carries `realizationArtifacts`. | Define and validate a recognized artifact kind; transport alone does not implement it. |
| GRIP surface | `packages/grip/src/index.ts`; `pulsewasm.compiler.cjs`; `pulse.package.json`: handoff is response framing; broadcast is the request-bound I/O operation. | Add a distinct host-dependent operation without making the whole package Fastly-only. |
| Capability admission | `wasm/packages/contracts/src/provider/canonical-provider.js`: descriptor vocabulary is a fixed list. | Admit owned extension capabilities through a versioned provider contract, without adding a core constant for every package method. |
| Target/toolchain | `wasm/packages/contracts/src/provider/toolchain.js`; `packages/provider-fastly/src/toolchain/index.js`: explicit provider and target, strict envelopes. | Advertise extension protocol support and the provider services available to admitted contributions. |
| Realization | `packages/provider-fastly/src/build/canonical-target.js`; `native-platform-capabilities.js`: artifacts reach the provider; existing consumers are purpose-specific. | Add generic host-extension composition and operation dispatch. |
| Import audit | `native-platform-capabilities.js`; `wasm/packages/contracts/src/provider/final-wasm-policy.js`: provider import ceiling; final policy projects observed imports by module/name/kind. | Compose an admitted extension ceiling, validate ABI signatures as well as names, and bind policy identity to selected contributions. |
| Completion | `native-platform-capabilities.js` driver resolves a result and sends it; body forwarding has specialized ownership handling. | Generic terminal handoff outcome, single completion, ownership-aware error handling and cleanup. |
| Reporting | CLI report inventory/analytics and provider realization metadata own evidence. | Record selected operation/contribution/import ownership without inferring missing provenance or observed execution. |

The exact ABI candidates are `fastly_http_req.redirect_to_grip_proxy_v2` and
`fastly_http_req.redirect_to_websocket_proxy_v2`. Neither is present in the
inspected provider source. Both are operations in `fastly_http_req`; GRIP/Fanout
and WebSocket passthrough are distinct behaviors, not two new ABI namespaces.
Fastly's Rust SDK uses request handle, backend bytes and length for these calls,
and treats successful handoff as completion of downstream response authority.
References: [Fastly SDK source](https://docs.rs/fastly/latest/src/fastly/experimental.rs.html),
[Fanout starter](https://github.com/fastly/compute-starter-kit-rust-fanout),
[Fanout local testing](https://github.com/fastly/compute-starter-kit-rust-fanout-forward).
HEX-01 must pin the SDK/ABI and engine versions it actually tests; these URLs
are source references, not a hosted acceptance receipt. Non-success handle
ownership is unresolved and must not be inferred from the success contract.

## Proposed contract shape

All names below are proposals. Prefer a typed artifact within the existing
carrier over unrelated top-level `hostImports`/`hostExtensions` builder fields.
HEX-01 must confirm the narrow transport fits before HEX-02 freezes schemas.

| Record | Required information and validation |
| --- | --- |
| Identity | Exact extension protocol version; contribution ID; package and contract owner; implementation identity and content digest. Owner must match the selected lowerer. IDs are package-qualified. |
| Target match | Explicit provider/ABI family, execution mode, supported extension-service protocol versions and required services. Match independently of npm release-version equality. First proof matches Fastly Native only. |
| Operations | Owned operation IDs and source-call attribution; input/result contract; required binding keys; terminal/nonterminal classification; operation-specific implementation reference. |
| Host imports | Module, function, Wasm parameter/result types, local symbol and owning contribution. Reject conflicting signatures, duplicate operation ownership and undeclared emitted imports. Identical import declarations may deduplicate only after compatibility checks. |
| Implementation | Package-contained support source through a declared export/path and hash, or the existing normalized generated-source pattern. Pin the chosen representation in HEX-01. Do not reference provider-private globals or monorepo paths. |
| Provider services | Named, versioned request-context and binding projections plus completion/error/cleanup adapters. No mutable provider object or resolved secret in the lowerer invocation. |
| Ownership/lifecycle | Required resources, borrow/consume/transfer rules, valid completion state, cleanup obligations and failure behavior. Ordinary authored code never receives raw request/body handles. |
| Evidence | Selected target/operation/contribution, source and policy identities, required versus observed imports, and support/acceptance status. Record unknowns explicitly. |

A package declares requirements; only the explicitly selected provider admits
them. The effective final import policy is the provider baseline plus its
validated selected contributions, never a wildcard derived from observed
Wasm imports. Import declarations describe build admission, not service
entitlement. Runtime platform failures remain possible.

Existing trusted lowerers run with compiler authority. Extension source shares
that trust model; structural validation and an ABI audit are not a sandbox for
malicious packages. Do not introduce publisher allowlists or claim that metadata
alone can prove arbitrary source cleanup or semantic correctness.

### Selection and compatibility

1. Resolve the explicit target and reachable package/symbol ownership using the
   existing graph. Loading a package declaration does not activate all methods.
2. Recognize used operations and select matching realization records. A generic
   method continues through its existing implementation. A host-only method can
   have no generic realization.
3. Require one unambiguous compatible realization for each used operation. In
   the first protocol, overlapping applicable realizations are an error; no
   installation-order, priority, inheritance, or heuristic selection.
4. Validate protocol, owner, bindings, services, imports, signatures, resources
   and lifecycle. Freeze a deterministic selection record and artifact policy.
5. Emit only the selected support units and required services. Installed-but-unused
   extensions and unused specialized methods must not add host imports or Wasm
   bytes. Check an imported package using only a generic method separately.

An unsupported reachable operation must fail Native inspection/compilation
before emission. Proposed diagnostic content: package, operation, source
location, selected host/mode, missing contract/capability and supported targets.
Distinguish unsupported target, protocol mismatch, ambiguous realization,
missing binding, import/signature conflict and platform execution failure.
Do not invent public diagnostic codes until the diagnostic catalog is updated.

Selection never silently changes Native to JavaScript. A rejected or failed
selected realization is not silently retried through another implementation.
JavaScript targets need the same operation requirements where calls can be
statically recognized, and a package/provider runtime guard for unrecognized
dynamic calls. HEX-01 proves unsupported JavaScript behavior; implementing a
Fastly JavaScript handoff is outside this workstream.

## First executable slice and ownership question

One ordinary HTTP handler directly returns the provisional Fanout operation,
with one literal reference to a preconfigured backend. No dynamic backends,
parallel handoffs, response/body mutation or prior effects in this slice. Reject
unsupported placements explicitly; do not hide them behind a successful plan.
Keep a normal-response route in the fixture to prove ordinary completion remains
valid. Reuse the ordinary package operation/effect and provider lifecycle machinery;
no independent scheduler or package-specific compiler branch.

The proposed terminal outcome is an opaque, request-owned completion token. It
must never be forged by an authored literal, decoded as a response, stored,
returned through `ctx.call`, or reused. Whether the existing canonical result
representation can express this without a new result kind is a HEX-01 question.

| State/event | Required behavior |
| --- | --- |
| Validation fails before host dispatch | No handoff; existing error machinery may respond while response authority remains owned. |
| Handoff succeeds | Mark response authority transferred once. Skip normal response send and every later error-response path. Clean up only resources still owned by Pulse. |
| Host returns non-success | Determine request/body ownership from pinned ABI and execution evidence before choosing cleanup, response or abort. No assumed retry or generic 502. |
| Exception/trap or ambiguous outcome | No automatic redispatch; do not claim rollback or infer that response authority is still available. Document the exact tested behavior. |
| Duplicate/stale completion | Reject without another host call or downstream send. |
| Deadline/cancellation | Fence before dispatch; after transfer there is no delivery/rollback promise. Race behavior belongs to HEX-03. |

This is a provider lifecycle question as well as an import contribution question.
If proof requires a broad response/continuation redesign, stop with the exact
missing invariant and split it into a bounded prerequisite. Do not expand the
spike into a general plugin system.

## Acceptance matrix

| Case | Evidence required | Owner pass |
| --- | --- | --- |
| No extension / installed unused / generic-only | Same recipe and unchanged fixture before/after; complete Wasm digest, raw size and import comparison. Generic-only compares against its own baseline. | 01, repeated 04 |
| Used Fanout operation | Authored call reaches package discovery, generic contribution seam and the expected host import with correct arguments. No special package-name selection in compiler/provider. | 01 |
| Successful terminal transfer | Injected host trace proves one handoff and zero downstream sends afterwards; normal route still responds. This is fixture evidence only. | 01, hardened 03 |
| Node Native, Node JS, Fastly JS | Host-specific call rejected/guarded; generic GRIP operations remain available according to existing support. Installation alone does not reject the package. | 01, 04 |
| Version/owner/target/binding mismatch | Stable actionable diagnostics before emission/dispatch. | 02 |
| Conflicts and undeclared imports | Reject incompatible signatures, duplicate operation providers, unexpected imports and forged completion. Test both contribution ordering permutations. | 02, 03 |
| Additional operation | WebSocket passthrough tests reuse of the same contract after Fanout proof; no full WebSocket session implementation. | 03 |
| Failure/cleanup/composition | Actual ABI failure ownership, stale tickets, post-transfer error handling, deadline fences and explicitly admitted/rejected Router/ctx.call/parallel placements. | 03 |
| Installed external consumer | Pack GRIP/provider/toolchain closure and install outside checkout; no private paths or package-name registry; attribution and unused checks. | 04 |
| Real local and hosted execution | Viceroy + Pushpin first; separately authorized service/entitlement/hosted acceptance. Record unavailable lanes as not run. | 04 |

## Work passes

The following tickets implement the proposal in bounded checkpoints; they do not
authorize one unbounded implementation run. Following the 2026-10-23 human direction, each targets `hex-integration` and retains
human architecture review and merge authority. Model names are work
recommendations, not GitHub assignees.

| Pass | Model / effort | Dependency | Deliverable and stopping point |
| --- | --- | --- | --- |
| HEX-00 | Astra / High | None | This scope, contract options, source/probe evidence and follow-up tickets. No production mutation. |
| [HEX-01 #509](https://github.com/pulse-compute/pulse/issues/509) | Astra / High | Reviewed HEX-00 direction | One private authored Fanout proof through the generic seam; target rejection, ownership findings, unused measurements and exact proposed schema delta. Stop after evidence/revised scope, before public contract stabilization. |
| [HEX-02 #510](https://github.com/pulse-compute/pulse/issues/510) | Sol 6.1 / High | HEX-01 go decision | Stabilize the minimum protocol/operation requirements, package containment, deterministic selection, provider admission, signature/import policy and diagnostics. Carry the proven private operation; no new lifecycle forms. |
| [HEX-03 #511](https://github.com/pulse-compute/pulse/issues/511) | Astra / High | HEX-02 | Harden terminal ownership/failure/cleanup; second WebSocket operation only through the same seam. Document supported placement/composition; split any new scheduler or resource model. |
| [HEX-04 #512](https://github.com/pulse-compute/pulse/issues/512) | Sol 6.1 / High | HEX-02 and HEX-03 | Packed consumer, report/compare attribution, generic-method regressions, unused-artifact evidence, local/hosted acceptance ledger and author documentation. No release seal or publishing. |

### HEX-01 decision record must answer

- Can existing realization artifacts carry the typed contribution without
  leaking provider objects or adding a parallel discovery mechanism?
- Which minimal provider services expose request authority safely to trusted
  implementation code without coupling it to private generated variable names?
- Does terminal completion need a canonical result/continuation change, and
  which existing response, error and body-forwarding paths need integration?
- What happens to request and body handles on every tested ABI return status?
- Can operation requirements avoid global per-package capability registration?
- What are the actual unused and used artifact deltas, and what remains unproven?

## Exclusions and stopping conditions

No runtime self-registration, broad host SDK exposure through ctx, arbitrary
compiler hooks, new publisher policy, implicit host selection, forced package
split, inherited extension hierarchy, host provider extraction, general cache/
security/hardware API, generic resource-owning plugin runtime, dynamic backend
selection, or release commitment. Do not retrofit existing GRIP semantics.
If an operation cannot fit the provider lifecycle safely, record that result and
split the prerequisite rather than bypassing effect mediation or import audits.

## Reproduction and evidence limits

Run `node docs/internal/host-extensions/probe.cjs` at the inspected base or this
proposal branch. It uses Node built-ins and the actual current normalizers.
`probe-result.json` records source hashes and outcomes. These are historical
boundary probes, intentionally outside the regression suite; future extension
implementation may change the expected rejections.

The positive realization-artifact probe is deliberately important: an accepted
envelope proves transport, not a recognized extension or host execution.
The final-policy probe uses a small synthetic policy to exercise the real
validator; the Fastly ceiling/driver findings above come from source inspection.
No authored extension compile, Wasm size improvement, Viceroy/Pushpin execution,
hosted acceptance, full regression profile or release seal is claimed by 00.

### HEX-00 validation ledger

- Boundary probes: 9 passed, 0 failed on the inspected base plus only these
  internal proposal/evidence files; exact inputs are hashed in the receipt.
- `npm run maintainer:sync`: passed; no tracked generated changes.
- Initial `npm run docs:sync`: blocked by missing workspace dependency links
  (`@pulse-compute/wasm-contracts/logging`); no source defect inferred.
- Restored exact pnpm 12.4.2 with the repository toolchain installer, then ran
  `pnpm install --frozen-lockfile --ignore-scripts` successfully. Node v24.19.0.
- `npm run docs:sync` after restoration: passed; no tracked generated changes.
- `npm run maintainer:check`, `npm run docs:check`, and
  `node scripts/documentation-release.cjs`: all passed.
- `git diff --check`: passed. Only this internal proposal, probe and receipt
  belong to the change; no production implementation or test gate is changed.

[Resource ownership, investigation 2](ownership/README.md) retains a compiled
cache-resource prototype, three-form execution and ownership failure evidence,
and explicit disposal/reservation decisions. It changes no production contract.

[Bounded composition, investigation 3](composition/README.md) tests conditional
cache/fetch/insert children under the existing driver, records the execution and
resource-accounting costs, and pressures the proposed contract with an ESP32
exclusive-resource scenario. It changes no production contract.

[Shared resource accounting](resource-accounting/README.md) records the RA workstream.
Its completed [RA-00 ownership inventory](resource-accounting/ra00/README.md) maps
existing lifecycle owners and retains fresh failure/expiry evidence without
changing production behavior.
