# PRPT-00C: same-build final-byte attribution proof

**Result: useful final handler measurements are feasible without a second
compilation or changing executable bytes.** The bounded fixture maps all five
HTTP registrations to final bodies on portable Native and Fastly Native. A
direct-call-only graph also exposes shared dependencies instead of presenting
a small wrapper as the handler's complete cost.

This supersedes the initial recommendation in [PRPT-00](../prpt00/README.md) to
leave every handler-size field unavailable. It does not implement `pulse report`
or establish general attribution coverage. The [v2 plan](../prpt00/feature-spec-v2.md)
and its four pinned ARC fixtures, including expandable schema views, remain the
design contract.

## Scope and identity

- User direction: pursue 00C and retain useful partial measurements with explicit
  gaps, even where full attribution cannot be established.
- Base: `latest` at `6a58d8eb0064b90d9c516dfc1ee7a51b138fa1b9`, containing merged
  PR #220. Entry point: none; ordinary instruction chain for repository-only
  evidence. Change class: evidence. No product source or generated public docs
  are changed.
- Task-sizing recommendation: **Astra / ultra**, limited to the unresolved
  final-byte identity question. This is a recommendation, not a runtime-model
  execution claim. Two bounded agents assisted source review and evidence
  helpers; no independent compiler campaigns were launched.
- [proof.json](proof.json) binds the lockfile, tested source revision, dirty state,
  individual proof/producer files, generated source, actual compiler recipe and
  artifact SHA-256. The fixture is synthetic, not ARC or Catalog qualification.

## Measured result

The fixture registers one authored handler twice, two separate handlers with
identical content, and one distinct response. Per-registration chunk identities
remain separate even when the authored handler ID is shared.

| Build | Artifact | Defined body bytes | Mapped routes | Unique direct handler bytes | Whole executable unchanged |
| --- | ---: | ---: | ---: | ---: | --- |
| Portable, default | 2,545 B | 1,143 B | 5/5 | 157 B | Yes |
| Fastly final, default | 31,466 B | 18,113 B | 5/5 | 147 B | Yes, including packaged `bin/main.wasm` |
| Portable, converging size profile | 2,464 B | 1,058 B | 5/5 | 112 B | Yes; three convergence emissions skipped |

Body bytes include local declarations and instruction bytes, excluding their
length prefixes and other section framing. Artifact and section ledgers remain
separate. These are measurements of this fixture, not application-wide size
forecasts or an optimization comparison campaign.

| Route | Portable direct | Portable direct-call reachable | Fastly direct | Fastly direct-call reachable |
| --- | ---: | ---: | ---: | ---: |
| `/shared-a` | 14 B | 82 B | 8 B | 11,729 B |
| `/shared-b` | 14 B | 82 B | 8 B | 11,729 B |
| `/duplicate-a` | 14 B | 82 B | 8 B | 11,729 B |
| `/duplicate-b` | 14 B | 82 B | 8 B | 11,729 B |
| `/distinct` | 101 B | 101 B | 115 B | 12,151 B |

**Direct** measures the final bodies corresponding to the recorded handler
chunks. **Direct-call reachable** follows every static direct call from those
bodies, counts each defined body once, and stops at imported functions. It
includes conditional callees and shared runtime bodies; it is neither a request
trace nor exclusive ownership, marginal route cost, or removal savings. Route
reachable values overlap and must not be added. Caller-side dispatch, data
payloads, imported host implementations and indirect calls are not charged to
the route. Coverage is complete only within this explicitly bounded graph.

The default portable result contains 176 B of unnamed final bodies; Fastly
contains 367 B. They remain in the physical census and direct-call graph by
final index even without source names. No source owner is invented for them.
The body-family summary is explicitly a generated-name heuristic, distinct
from exact body lengths and the verified route-to-chunk join.

## How the proof works

1. The unchanged generator produces its usual source and ownership manifest.
   The experiment observes that return value; it does not regenerate the plan,
   source or frontend to obtain ownership. Fastly currently omits the portable
   generator's `handlerBodies` from its final manifest, so retaining this existing
   result is an identified production integration task.
2. The usual compiler runs with its existing runtime, transforms, optimization,
   retention and merge flags. The observer is an additional evidence-only
   AssemblyScript transform loaded by the harness. No `--debug` compile flag,
   new export, retained guest symbol, optimizer pass or extra dependency is added.
3. `afterCompile` itself is too early. The transform wraps the existing module's
   `emitBinary` and waits for the actual final-output call. In pinned asc 0.28.18,
   convergence uses zero arguments; final emission passes a source-map argument,
   including `null`. The convergence profile exercises this distinction.
4. The first normal serialization is the executable returned unchanged. A
   second serialization of the **same already optimized module**, with Binaryen
   name emission temporarily enabled, supplies names. The global flag is
   restored in `finally`. Every non-custom section, including order, headers and
   length encodings, must match the normal bytes before names are trusted.
   A third normal serialization verifies restoration. These are serializations,
   not additional compilations or optimization runs.
5. Function-name subsection indices are joined to code-body ordinals after
   counting function imports. Generator chunk numbers are never treated as
   Wasm indices. Route entry identity selects its ownership record; handler ID
   is checked independently. Exact full generated names resolve surviving bodies.
6. For the optional graph proof, the verified named bytes are read by the same
   pinned Binaryen instance and rendered as text in memory. A bounded adaptation
   of the existing O-08 direct-call parser validates every function name/index,
   resolves callees, and deduplicates cycles/shared functions. No disassembler
   subprocess runs. Tables, element segments, indirect/reference/tail calls or
   unrecognized mappings make this metric unavailable while preserving direct
   measurements. This research parser is not a production Report dependency.
7. Control and observed builds have identical generated sources and compiler
   recipes except the observation transform. **Every byte of their actual Wasm,
   including custom sections, matches.** Each build invokes the generator and
   asc exactly once. The paired builds prove noninterference; Report must never
   reproduce this paired-build procedure.

Fastly final bytes are also passed through the existing canonical package writer
and checked against `bin/main.wasm`. All five routes execute with their expected
body/status in both control and observed artifacts using the portable Node host
and Fastly injected host. This is local execution evidence, not Viceroy or a
deployed Fastly service.

## Explicit ceiling and useful partial data

| Condition | Retain | Do not claim |
| --- | --- | --- |
| Some chunk names survive | Exact mapped body bytes, mapped/expected chunks, body indices, missing-chunk reasons | Complete handler bytes when roots are missing; zero bytes for unknown chunks |
| Optimizer removes or merges a named chunk | Final census and other proven mappings | An alias inferred from identical source, pre-optimization position or handler name |
| Multiple routes share a proven final body | Same artifact-local body ID on each route; deduplicated aggregate | Additive per-route cost or removal savings |
| Direct-call graph is supported | Static reachable defined-body bytes and explicit imported boundaries | Execution frequency, exclusive ownership or full request cost |
| Indirect/table/reference control appears | Direct-body evidence and unavailable graph reason | A silently truncated reachable total |
| Special shared-stage/helper or single-function dispatcher lacks a supported root adapter | Existing source topology and measured final census | A guessed HTTP-root mapping |
| Guest linking follows AS emission | Hash-bound primary/prelink measurements, if retained; exact final ledger separately | Final route bytes or reused function indices on the linked artifact |

The guest-linked path runs `wasm-merge`, then another final `wasm-opt` with
merging, inlining and `--strip-debug`. Its authoritative seam is
`wasm/packages/wasm-guest-link/src/pipeline.js`, with the posture in
`constants.js`. This pass does not compile a linked fixture or solve that seam.
Any prelink measurements must be labeled **prelink** and bound to the primary
artifact hash. The final consumer rejects a capture whose artifact hash differs.

The graph is sufficient to expose useful overlapping dependencies on this
fixture. **Own/exclusive bytes remain unqualified:** all HTTP, event, lifecycle,
dispatcher and provider roots would need an agreed ownership rule and complete
coverage. Source-map builds, schema-heavy apps, staged/helper layouts,
guest-linked apps and Catalog-scale capture overhead also remain unqualified.
No extra compiler redesign is warranted to close these in 00C.

## Implementation handoff

Proceed with the existing packets; no further broad feasibility ticket is needed.

| Packet | Concrete addition from 00C | Model / effort recommendation |
| --- | --- | --- |
| PRPT-01 | Freeze artifact-local body IDs, build-stage identity, direct vs direct-call-reachable semantics, coverage/reasons, overlapping membership and null unavailable totals. Keep exclusive ownership unavailable without root coverage | Sol / high |
| PRPT-02A | Retain generator ownership and observe the same final emission through an internal build-support owner. Persist passive metadata under the completion lifecycle; retain Fastly's currently dropped ownership map. Atomically bind sidecar hashes to the actual final artifact | Sol / xhigh within 02 |
| PRPT-03 | Validate the sidecar, join exact route entry IDs, measure final bodies, deduplicate body indices, expose qualified direct-call data where supported. Report reads evidence without loading a compiler or launching a build/disassembler | Sol / high |
| PRPT-05 | Preserve the v2 size selector; show direct/reachable qualifiers, partial counts and unavailable reasons in route details. Keep the pinned expandable schema interaction | Sol / high |
| PRPT-06 | Qualify real ARC/Catalog, schemas, shared stages/helpers, final linked-artifact gaps, passive-capture overhead and unchanged bytes on the selected profiles | Sol / high |

Production should retain only allowlisted identities/indices/bytes/edges and
required provenance. Raw debug names, WAT, generated source and arbitrary local
paths are research internals, not automatically shareable capsule fields. Build
integration must handle unsupported capture versions without changing the guest
and without inventing evidence. The report's eligible-Wasm completion gate from
00B remains required independently of optional attribution availability.

## Reproduction and validation

Use the existing lockfile-pinned workspace and built packages:

```sh
corepack pnpm@12.4.2 install --frozen-lockfile --ignore-scripts
npm run build
node docs/internal/prpt00c/proof.cjs wasm/.test-results/prpt00c-reproduction
```

The driver emits three cells: default portable, default Fastly, and converging
portable. Each has one control build and one observed build. Each observed build
clears any old sidecar before compilation, checks its hash against final bytes,
and retains ownership/plan/generated source and local Wasm under the requested
ignored results directory. The checked-in JSON is the completed evidence from
this base, not a success marker for a later checkout.

Focused negative controls exercise missing/partial mappings, wrong artifact hash,
wrong handler identity, duplicate/shared-body accounting, cyclic reachability,
unsupported graphs and disposal on failure. Repository checks and development
attempts are recorded in [validation.json](validation.json). No full release
suite, package publication, merge, or deployment belongs to this evidence pass.
