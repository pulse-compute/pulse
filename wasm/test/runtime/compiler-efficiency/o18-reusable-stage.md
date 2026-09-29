# O-18: reusable effectful stage gate

**Decision: blocked.** This implements the bounded measurement and runtime
probe. It does not implement shared-stage lowering or complete the requested
single-body proof. Do not migrate generators on the strength of this result.

## Reproduce

```sh
node wasm/scripts/run-wasm-tests.cjs --task reusable-stage-o18 --no-report
```

The task is opt-in and excluded from every default profile, including release.
Exit zero means measurement completed; inspect `sharingGate` and `semantics`.
To save the compact report and require the sharing qualification, run:

```sh
node wasm/test/runtime/compiler-efficiency/o18-reusable-stage.cjs --require-sharing --output /tmp/o18-report.json
```

This exits 2 after measurement because the qualification is unmet. No generated
source or raw logs are tracked.
The gate deliberately cannot become green from a smaller Wasm byte count alone:
a future sharing implementation must add retained-body attribution to this probe.

## Fixture and results

One imported async stage is registered in 1, 2 and 16 independent route chains.
It has 16 ordered local transformations, request state, two fetch suspensions,
early responses, `next(error)` and `next()`. Each chain has its own terminal
handler with a third fetch. Error handling is shared. This is a synthetic,
schema-free fixture, not an application-size forecast.

Measured against `0ff93f0f423d91b4d56707652e92ed4744e7270a`, with only the
test-owned probe and registry changes in the worktree, on Node 24.19.0, using
the default compiler optimization. Each cell runs in a fresh serial worker.
Timing is one observation per cell and does not establish a performance trend.

| Chains | Expanded stage characters | Stage effect sites | Preserved stage bodies | Node Wasm bytes | Fastly Wasm bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 1,500 | 2 | 0 | 8,911 | 44,388 |
| 2 | 3,000 | 4 | 0 | 12,907 | 48,631 |
| 16 | 24,066 | 32 | 0 | 68,890 | 108,507 |

Fastly generated AssemblyScript grows from 144,053 to 548,028 bytes. Adding
15 chains adds 64,119 Wasm bytes, about 4,275 bytes per chain. That includes
terminal handlers and routing, so it is **not** an attribution of all growth to
the shared stage. Source ranges prove expansion at lowering; they do not count
retained final-Wasm functions or rule out downstream helper merging.

Runtime observations across the matrix:

- Node Native: 37/37 requests pass, including three interleaved request pairs.
  A remains suspended while B completes, then A resumes with its original locals.
  Effect ownership and completed continuation lifecycles are checked.
- Fastly Native: 31/31 requests pass in the local provider ABI fixture.
- JavaScript: 9/31 pass; 22 normal requests fail at the terminal handler because
  `fetch-1` is already in use. Early return and explicit error transfer pass.
- Exact response and effect order checks cover no-effect early termination,
  termination after the first effect, explicit error transfer, normal completion
  and a subsequent normal request. This is not a deployed Fastly qualification,
  a cancellation test, or a proof of arbitrary stage composition.

## What must change before qualification

The current Native contract preserves only terminal HTTP route bodies. Stages
that transfer with `next()` remain expanded. Existing package-call source linking
fixes attribution for repeated registrations; it does not deduplicate bodies.

The next lowering experiment must separate **authored body identity** from
**registration identity**. A request-owned invocation frame needs the caller's
normal/error cursor, body-local slots and the mapping from relative effect and
continuation sites to registration-owned IDs. Suspension must retain that frame;
resumption must not depend on a live call stack. Early response must bypass both
the remaining body and subsequent handlers. Preserve terminal cursor semantics.

Separately, JavaScript currently initializes `fetchSequence` inside each
`createContext` call (`packages/runtime/src/internal/context.js`), while effect
ID uniqueness is enforced across the request. Router handlers receive separate
contexts. Fix that request ownership defect before treating effectful chains as
cross-target qualified; do not conceal it by removing the terminal effect.

O-19 should implement a narrowly scoped Native prototype and add final-Wasm
body/call-site attribution for these same 1/2/16 cells. Keep stable per-entry
diagnostics and effect identities; do not infer sharing from authored functions,
source size, chunk count or a global middleware registration workaround.
