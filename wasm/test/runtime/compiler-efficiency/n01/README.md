# N-01: read-only array demand qualification

Evidence-only result on merged compiler `68be2c0a31df8dec756e49c782f6c8c5534ea350`,
tree `e7d37b7f6849c5368af4fd86d16ff687b525e627`. No product capability is enabled.
The generic fixture and this report contain no private consumer source.

## Decision

Select the **flat-record array** shape for the next implementation, with a
smaller first boundary than whole-array helper borrowing: prove a required string
field read from a schema-decoded array element, then pass the scalar to an
existing pure helper. Required string-array borrowing/projection is independently
blocked but deferred. Private candidate evidence determines the priority; these
generic admission probes do not estimate application bytes or adoption value.

This is a proposed narrow first slice of N-03, not an assertion that all N-03
capabilities have been qualified. Its concrete pilot element has two required
string fields, with no special field names. Other field combinations, nested or
optional fields and whole-array helper parameters are outside this slice.

## Observed acceptance/rejection matrix

Both the source workspace and the byte-verified packaged consumer produce the
same **21 outcomes: four admissions, 17 rejections**. Exact diagnostic codes are
asserted, so an unrelated compiler error cannot satisfy an expected rejection.
Every admitted plan also passes independent validation after JSON serialization.

| Group | Cases | Current outcome |
| --- | ---: | --- |
| Scalar literal, schema record field, numeric-array borrowing, numeric-array scalar projection | 4 | Admitted controls |
| String-array helper parameter | 1 | Unsupported helper signature |
| String-array schema element or local literal element passed to scalar helper | 2 | Unsupported argument provenance |
| Flat-record array helper parameter | 1 | Unsupported helper signature |
| Flat-record scalar projections: unguarded/guarded constant index, bounded direct read, element/array aliases, loop/spread result, local literal array | 7 | Unsupported argument provenance |
| Optional field, nested record, nested array projections | 3 | Unsupported argument provenance |
| Existing numeric borrow mutation | 1 | Unsupported helper mutation |
| Structured helper result | 1 | Unsupported helper signature |
| 257 caller iterations × 320 callee iterations | 1 | Existing pure-loop limit rejects 82,240 > 65,536 |

The guarded and unguarded flat reads currently fail at the same type-proof
boundary. This is **not** evidence that future array bounds or lifetime checks
are correct. Similarly, unsupported rich shapes do not exercise a new borrow
validator. Native/JavaScript execution, retained bodies, size and forged-plan
tests of the proposed capability belong to its implementation gate.

## Proposed contract for the selected slice

| Dimension | Required boundary before activation |
| --- | --- |
| Origin | Existing literal schema decode; one array whose elements have two required string fields. No assertion, schema-less JSON, typed-KV extension or caller literal-array extension in this pilot. |
| Index | Prove a nonnegative integer index and the same array's length guard at the **element read**, not merely at a later helper call. Qualify the canonical zero-initialized, unit-increment, literal-capped loop first; support a guarded constant index only with an equivalent proof. |
| Bounds | Keep existing loop cap 1,024 and nested product 65,536. The fixture's 24 × 320 call placement is 7,680. An earlier producer loop is not an enclosing helper loop once the call occurs after it. No new collection or memory limit. |
| Borrowing | The array and const element/array aliases remain caller-owned and read-only. Use the existing value representation; do not copy the payload or create serialization hops. Only the projected primitive crosses the helper boundary. |
| Mutation | Reject writes through the relevant array/element alias graph and reassignment of structured aliases. Preserve existing same-shape scalar record-spread assignments; a scalar copy does not become a retained record alias. Do not accept mutation because it happens after a call. |
| Lifetime | A borrowed element is read only while its producing index/array proof holds. No structured value escapes through a helper result, capture or continuation. Once copied, the scalar follows the existing scalar lifetime and same-shape assignment rules. |
| Signature | Keep the existing string parameter and scalar result. No `Cell[]` or `string[]` helper parameters, structured results, helper composition or new ABI. |
| Independent validation | Reconstruct schema origin, element shape, index/length dominance, aliases and every contributing write from the serialized plan. A producer's `valueKind`, type assertion or rehashed plan is not proof. |

The first implementation must qualify valid empty/nonempty arrays, both loop
edges, multiple iterations, scalar copies after the loop, unchanged spreads and
borrowed alias reads. Its rejection gate must cover wrong array/index guards,
negative/fractional/out-of-range reads, shadowed or reassigned indices, unknown
origins, alias writes, changed field types, optional/deep/nested shapes, captures,
structured results and the unchanged work limits. Rehashed-plan attacks must
exercise the same decisions independently of the source producer. Cross-target
execution must preserve existing value/error behavior. This is a specification
of required future evidence, not evidence that these new safety cases passed.

## Ownership and implementation restraint

Current `pure-helper-values.js` only derives an array type from a numeric element;
its `element` reader likewise recognizes strings and numeric arrays. That explains
why a scalar-only call can still require an array provenance extension. Current
helper signature resolution independently rejects richer arrays.

The likely owners are `pure-helper-values.js` and its producer consumer in
`canonical-native-plan.js`, with independent provenance, alias and placement
checks in `source-helper-plan.js`. Inspect `spine/pure-helper-source.js` to keep
whole-array signatures excluded. Shared caller-projection evidence must not
silently become a valid `pulse.pure-borrow.v1` array descriptor: extending
`validType` globally would broaden more than this selected contract. Confirm
the exact dependency closure before coding and split if it needs an ABI,
structured lifetime or general control-flow expansion.

## Reproduction and evidence

Run the registered source-workspace probe with a fresh report location:

```sh
node wasm/scripts/run-wasm-tests.cjs --task array-demand-n01 --report /tmp/n01-workspace-run.json
```

The task is opt-in external evidence, excluded from release acceptance. Its
matrix report is `wasm/.test-results/n01/array-demand.json`; it refuses to overwrite
an existing report. Preserve or move the prior matrix before another workspace
run. For an identified consumer with a standard candidate inventory:

```sh
node --liftoff-only wasm/test/runtime/compiler-efficiency/n01/array-demand.cjs \
  /absolute/consumer /tmp/n01-packed.json
```

The packaged run checks every inventoried package file before and after the
matrix, and records the candidate, lock and official-manifest hashes. The existing
S-03 consumer has 987 Pulse files; its package proof is unchanged by N-01.

`cases.json` is the complete generic input. `evidence/packed.json` and
`evidence/workspace.json` retain raw outcomes and diagnostics;
`evidence/agreement.json` records their exact outcome/code agreement.
`evidence/workspace-run.json` records the base revision; each matrix report also
binds the uncommitted runner and fixture bytes by hash. The initial
exploratory run, its exact earlier runner/fixture and log are retained separately;
the final runner additionally checks diagnostic identities. All files are
evidence, not compiler inputs or package contents.
