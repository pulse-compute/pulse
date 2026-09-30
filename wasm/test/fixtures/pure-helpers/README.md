# PF-01: bounded synchronous pure-helper contract

Status: contract for implementation and human review, **not current Native
support**. PF-01 adds executable source oracles and expected Native linker
failures. PF-02 owns scalar lowering, PF-03 record borrowing, PF-04 caller-loop
integration, PF-05 installed-package qualification. A passing repro means the
known rejection was reproduced, not that the feature works. Do not skip these
fixtures or convert unexpected compilation success into a pass: replace the
expected rejection with end-to-end assertions in its implementation ticket.

Run from the repository root:

```sh
node wasm/scripts/run-wasm-tests.cjs --task pure-helper-contract
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

The exact structural subset is `PartitionHead` in `types.ts`: scalar fields,
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

## Serialized plan compatibility

PF-01 does not change or emit a new plan. Current Native plan v5 and
`pulse.canonical-native-helper.v1` remain the effectful contract. Do not reinterpret
that tag as a synchronous helper or reuse its suspend/continuation semantics.
PF-02 must introduce an explicitly versioned pure-helper descriptor and bump the
canonical plan/compiler version at their existing contract owners when adding
new call/expression semantics. Old plans retain their existing semantics where
supported; incompatible versions fail closed, never auto-upgrade or silently
ignore pure descriptors. PF-03 must version structural parameter descriptors;
PF-04 must version loop-call accounting if its serialized contract changes.

After JSON round-trip, independently validate identities, parameter/result
kinds, body/local ownership, scalar-only results, call arity, read-only aliases,
absence of captures/effects/Router operations, non-nesting, loop bounds and
version compatibility. A valid recomputed hash does not establish validity.
Tamper each descriptor/call/body/ownership/version field in implementation tests.

## Exclusions and diagnostics

Current imported fixtures must fail with outer
`PULSE_PROJECT_MODULE_LINK_FAILED` containing diagnostic
`PULSE_PROJECT_RUNTIME_VALUE_IMPORT_UNSUPPORTED`. This is a linker blocker;
it does not experimentally establish later structural/loop rejection reasons.
The runner checks both binding and negated-condition call sites for both fixtures.
The plain TypeScript oracle is not Pulse JavaScript target qualification.

PF-02 must provide specific source-located rejection reasons for captures,
parameter mutation, async/generator helpers, effects, context/response/Router
operations, recursion and nested calls, function values/callbacks, dynamic calls,
and unsupported signatures/operators. PF-03 adds structural shape, alias write
and escape reasons; PF-04 adds bound/accounting reasons. Allocate codes through
the existing diagnostic owners in those tickets, rather than promising invented
codes here. General JavaScript compatibility, closures, optimizer tuning, schemas,
caching and mutable/escaping records remain outside this work.
