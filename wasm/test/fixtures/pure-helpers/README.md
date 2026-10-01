# PF-01: bounded synchronous pure-helper contract

Status: PF-02 scalar helpers, PF-03 structured borrowing and PF-04 caller-loop
integration are implemented. PF-05 installed-package qualification remains
blocked by the official pack gate (see the PF-05 attempt below). Scalar and
partition fixtures have positive source-tree Native/JavaScript coverage.

Run from the repository root:

```sh
node wasm/scripts/run-wasm-tests.cjs --task pure-helper-contract --task pure-source-helpers --task pure-record-helpers --task pure-loop-helpers
```

## Minimum language and ownership

Resolve named, synchronous function declarations from the same file or a static
named import in the existing reachable source graph. Each parameter and every
result has an explicit type. Initial scalar types are `string`, `number`, and
`boolean`; no implicit `any`, optional/default/rest/destructured parameters,
unions, generics or object results. Every reachable path must return the declared
scalar kind. Local scalar bindings may be reassigned; parameters may not.
Existing proven scalar operators, comparisons, field/index reads, branches,
early returns and statically bounded `for` loops are sufficient for this proof.
Do not infer support for all TypeScript expressions from this list.

Both `const valid = isPositive(value)` and `if (!isPositive(value))` must work;
there is no synthetic `await` or `ctx` argument. Resolve identity before lowering
and retain one compiler-owned body per identity in the canonical IR/plan. Extend
the existing source-helper ownership machinery; no separate validator compiler,
host callback or JavaScript fallback. Body retention and final Wasm inlining are
separate evidence gates, not a size promise.

## Evaluation and failure semantics

Evaluate call arguments exactly once, left to right, then enter the callee.
Parameter reads observe those bound values, never re-evaluated argument trees.
Evaluate `&&` and `||` left to right with short circuiting, and only the selected
conditional branch. A helper in a skipped condition must not run or consume its
loop budget. A boolean return goes back to that call expression; an early helper
return does not return from the route. Locals reset on every invocation/request.
Preserve existing admitted number/string/operator and error semantics; no new
coercion, numeric narrowing, exception swallowing or conversion to `false`.
Propagate an admitted failure to the existing caller failure mapping, without
running later arguments/statements. `throw`, `try/catch` and new exception forms
are excluded. The caller retains response construction and Router decisions.

## Record lifetime and aliases (PF-03)

The structural subset is illustrated by `PartitionHead` in `types.ts`: scalar fields,
one nested `{hash: string, node: number}` record and a `number[]`. Resolve the
imported type. Mutable source interfaces are allowed; compiler-enforced use in
the callee is transitively read-only. Missing/wrongly typed fields are outside
this typed fixture; callers must establish the shape through existing contracts.

Borrow the existing representation for the synchronous call only. Caller-owned
aliases may exist, but neither parameters nor aliases derived from them may be
written, captured, retained in state/globals, returned as objects, or passed to
another helper. No caller suspension can occur inside a pure call. The callee
cannot retain handles after return/failure. No per-call JSON encode/decode or host
effect is permitted. If borrowing is infeasible, PF-03 must name the alternative
and measure all copying/allocation costs before widening the contract.

## Loops (PF-04)

Use existing static bounded-loop proofs and the 65,536 combined iteration-product
limit, including caller and callee loops; no artificial callee read site. A
16-partition caller with admitted reads and a 10-counter pure callee is the
qualification shape. Invocation-local state must survive neither a completed
call nor a request. Caller read suspension/resumption must preserve only caller
state and existing effect ownership. Test first/last iterations, short circuits,
early returns, repeated calls, at-limit and over-limit products. Do not change
O-25/O-28 effectful eligibility, iteration accounting or suspension contracts.

The focused `assert-pure-loop-helpers.cjs` test exercises 16 caller partitions,
10 callee counters, repeated validations, invalid first/last values, early returns,
interleaved suspensions, short circuits and pure caller loops with no read sites.
Every caller/callee loop path must stay within 65,536; zero caps retain the
existing conservative factor of one and sibling loops/calls are not summed.
Inputs in loop calls are read-only. Calls in headers, nested helper calls and
recursion remain excluded. JavaScript uses the shared bounded inspection only
for HTTP handler calls; ordinary dependency functions keep their existing behavior.

## Serialized plan compatibility

PF-04 uses Native plan/compiler v8, generator v9 and the descriptor
`pulse.canonical-native-pure-helper.v2`, with `pulse.pure-borrow.v1` for structured parameters. The existing effectful
`pulse.canonical-native-helper.v1` retains its suspension semantics. Incompatible
older plans fail closed and must be regenerated from source; the ABI is unchanged.
There is no automatic upgrade or ignored pure descriptor. Structural descriptors are independently validated;
PF-04 loop calls carry `pulse.bounded-pure-loop-call.v1`, independently checked
against their placement and the caller/callee iteration product.

After JSON round-trip, independently validate identities, parameter/result
kinds, body/local ownership, scalar-only results, call arity, read-only aliases,
absence of captures/effects/Router operations, non-nesting, loop bounds and
version compatibility. A valid recomputed hash does not establish validity.
Tamper each descriptor/call/body/ownership/version field in implementation tests.

## Exclusions and diagnostics

PF-01 originally reproduced `PULSE_PROJECT_MODULE_LINK_FAILED` containing
`PULSE_PROJECT_RUNTIME_VALUE_IMPORT_UNSUPPORTED`. PF-02 replaces scalar rejection
with positive coverage. PF-03 replaces record rejection with Native/JavaScript parity,
identity and allocation evidence. Unsupported structural signatures retain
`PULSE_NATIVE_PURE_HELPER_SIGNATURE_UNSUPPORTED`; optional reads use SHAPE,
property/element writes use MUTATION, and unsupported calls/escapes retain CALL,
VALUE or RESULT. Plan-level alias/shape failures use `PULSE_CANONICAL_NATIVE_PLAN_INVALID`.

PF-02 provides specific rejection reasons for captures,
parameter mutation, async/generator helpers, effects, context/response/Router
operations, recursion and nested calls, function values/callbacks, dynamic calls,
and unsupported signatures/operators. PF-03 adds structural shape, alias write
and escape reasons; PF-04 adds bound/accounting reasons. Record/loop implementation tickets extend diagnostics through the existing owners. General JavaScript compatibility, closures, optimizer tuning, schemas,
caching and mutable/escaping records remain outside this work.

## PF-02 implementation diagnostics and limits

`PULSE_NATIVE_PURE_HELPER_*_UNSUPPORTED` reasons distinguish SIGNATURE, IDENTITY,
CAPTURE, LOCAL, VALUE, CONTROL, CALL, MUTATION, ARGUMENT, NESTING and RESULT.
Malformed serialized contracts use `PULSE_CANONICAL_NATIVE_PLAN_INVALID`.
General dynamic calls continue to use existing unsupported-expression/import
rejections. Helper methods and type assertions are excluded. PF-03 admits early scalar returns inside a pure helper loop; ordinary caller
pure loops retain their existing return restriction.
Caller arguments admit scalar expressions and request scalar reads; bind other
supported computations first. Structured callers require a proven literal graph or matching schema boundary;
caller graph writes are conservatively rejected even after a call. No new exception support. Generated function counts do not establish final-Wasm
retention; scalar handles retain the existing invocation lifetime/accounting.


## PF-05 packed qualification attempt — blocked

The 2026-09-30 attempt used merged PF-04 source
`bba55c662d150ffd87753e972151f91a54f8d0d5` with a clean tracked worktree,
Node 24.19.0 and the release packer's pinned pnpm 12.4.2. The official command was:

```sh
node scripts/pack-release.cjs --out .pulse-release/pf05-initial --json
```

The workspace build passed. All 19 tarballs passed the packer's individual
package checks. The aggregate command then exited 1 during packed documentation
validation and did not produce `pulse-release-manifest.json`. The first failure
was the CLI's installed `docs/architecture/current-contracts.md` link to
`../../wasm/test/runtime/compiler-efficiency/o18-reusable-stage.md`.
A read-only scan using the existing Markdown link parser found the corresponding
O-19 proof link missing as well. These repository proofs exist in source but are
not shipped inside the CLI tarball.

The [attempt record](pf05-pack-evidence.json) contains the source/tree identities,
all 19 tarball hashes, both missing targets and explicit unrun qualification
gates. The [packer log](pf05-pack.log) preserves the actual failure. Individual
tarball verification does not satisfy the aggregate packaging gate.

**At this initial attempt, PF-05 was incomplete.** No installed consumer was
created in that attempt, and it supplies no packed qualification claim. The
subsequent completed replay is recorded below; the original failure stays intact.

### Resolved dependency: PF-05A — repair installed proof links

Effort: small. Change the O-18 and O-19 proof links in the canonical
`docs/architecture/current-contracts.md` to repository-qualified proof URLs using
the existing documentation convention. Regenerate the installed CLI copy with
`npm run docs:sync`; do not hand-edit that generated copy.

Acceptance: documentation sync/check and documentation-release pass; a fresh
unmodified official pack verifies all 19 packages, passes packed documentation
validation and writes its release manifest. Keep this failed attempt intact.
No package composition, compiler policy or optimization change is needed for
this repair.

Then resume PF-05 using that exact passing package set: isolated installed
Node Native, Fastly Native host-fixture and Node JavaScript runs; substantial
validator calls at 1, 2 and 16 sites; canonical/generated body counts and final
Wasm attribution; scalar/record/loop rejection cases and installed O-19/O-25/O-28
regressions. Report downstream inlining separately from compiler duplication.


## PF-05 installed qualification

The official pack on `41b7fdb94caeddce2ec6fa3ccfdf278876fe6522` passes after
PF-05A. Install all 19 manifest tarballs into an isolated consumer with
`workspaces: []` using `npm install --ignore-scripts --no-audit --no-fund`.
Then run the opt-in, dependency-bound qualification:

```sh
env -u NODE_PATH node wasm/test/release/assert-packed-pure-helpers.cjs /absolute/consumer /absolute/official-pack /absolute/fresh-results
```

The supervisor verifies archive hashes and every installed Pulse file before and
after execution. It copies test sources into an isolated mirror, links every
product directory to the installed package, and audits child module resolution
for workspace product imports. It does not rewrite installed compiler files.
The shipped Fastly ABI fixtures come from the same verified install.

Seven complete child tasks pass: scalar, record and loop positives/rejections;
legacy effectful helpers and O-28 loop helpers; O-19 production stages; and a
three-target sharing proof including the substantial O-25 history helper.
The extra proof covers eight record cases at each call-site count and eighteen
caller-loop cases on Node Native, Fastly Native and Node JavaScript. Prior
source/plan rejection assertions remain intact.

| Call sites | Canonical / generated / final helper bodies | Node Wasm bytes | Fastly Wasm bytes | Node / Fastly helper body bytes |
| --- | --- | --- | --- | --- |
| 1 | 1 / 1 / 1 | 43,547 | 88,506 | 738 / 1,090 |
| 2 | 1 / 1 / 1 | 43,624 | 88,582 | 741 / 1,090 |
| 16 | 1 / 1 / 1 | 44,228 | 89,200 | 741 / 1,090 |

Each named companion matches every production non-custom Wasm section exactly.
The helper remains reachable from exports through direct calls. At repeated
sites, downstream expression wrappers share the call expression as well; a
single direct call instruction therefore does not imply a single source call.
The actual retained Node body grows three bytes, not with caller multiplicity.
These counts establish retained sharing for this fixture, not an expanded-vs-
shared performance win, reclamation, RSS, latency or deployed-provider evidence.
No optimizer settings or product code changed.

`pf05-packed-evidence.json` records package hashes, task identities, resolution
audits, failures corrected in the proof harness, gzip sizes and full attribution.
The original failed aggregate packaging attempt remains preserved in PR #162;
this passing attempt does not rewrite it or establish an aggregate release seal.

### Historical PF-05 argument-provenance blocker

`pf06-argument-boundary.json` retains a minimal generic source probe. A
schema-decoded record with scalar literal arguments plans successfully. Passing
an otherwise typed KV result directly, or passing a scalar property read from
the decoded record, is rejected with
`PULSE_NATIVE_PURE_HELPER_ARGUMENT_UNSUPPORTED`. This is a source/plan proof gap,
not an observed runtime regression. A follow-up must preserve typed provenance
and independent plan validation; do not suppress diagnostics or add serialization
to make calls pass. That extension is not implemented by PF-05.


### PF-06 argument provenance

The historical probe above remains unchanged. PF-06 resolves those source forms
with plan/compiler v9 and `pulse.typed-kv-borrow.v1`. Run
`node wasm/scripts/run-wasm-tests.cjs --task pure-argument-helpers` for typed KV
reads (direct and namespace alias), schema projections, numeric/string indexing,
nullable guarded schema locals, same-shape caller assignments, and a 16-read loop.
The test compares original JavaScript and Native responses and retains negative
source and recomputed-hash plan mutations. Stored records are borrowed without
encoding or schema decoding; the declaration does not certify payload validity.

The serialized validator reconstructs input provenance from definitions, all
assignments, schema references, effect result ownership and explicit null guards.
Unknown origins, changed shapes, mutable borrowed aliases, wrong fields/indexes,
forged scalar tags and malformed KV descriptors remain rejected. No generic
caller type assertions, new effects, optimizer flags or runtime conversions are
introduced. The packed qualification driver includes this new task alongside the
PF-02 through PF-05 and existing effectful-helper/stage checks.

PF-06's final installed qualification passed all **8 tasks** across **19 official
package tarballs**, verifying **992 unchanged installed Pulse files** and zero
workspace product modules in each task's resolution audit. The argument proof
covers **21 parity cases**, **13 source rejections** and **12 recomputed-hash plan
rejections**. The existing retained-Wasm proof still observes one substantial
validator body at 1/2/16 sites. Package identities, audits and attempt boundaries
are retained in [`pf06-evidence.json`](./pf06-evidence.json). This is development
qualification, not an aggregate release seal or application adoption result.
