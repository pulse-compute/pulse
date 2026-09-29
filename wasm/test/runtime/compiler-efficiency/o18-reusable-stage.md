# O-18: reusable effectful stage proof

**Historical O-18 decision: the bounded prototype qualifies.** One substantial two-fetch stage
serves 1, 2 and 16 registrations with one shared body, emitted as two retained
partitions under the existing chunk limits. O-19 still owns supported production
lowering. Default builds retain their previous behavior; no generator migration
or whole-application saving is qualified here.

The measurements below preserve the O-18 prototype result. O-19 replaces the
private emitter option with production stage records; the same probe now tests
that default lowering against an internal expanded-plan control. See
[O-19](./o19-production-stage.md) for the current mechanism and validation.

## Reproduce

```sh
node wasm/scripts/run-wasm-tests.cjs --task reusable-stage-o18 --no-report
node wasm/test/runtime/compiler-efficiency/o18-reusable-stage.cjs --require-sharing --output /tmp/o18-report.json
```

The opt-in task remains outside every default profile. It now checks paired
baseline/candidate cells, same-request re-entry and final-Wasm attribution. Any
semantic or structural gate failure exits nonzero. `--shared` skips baseline
cells; `--baseline --require-sharing` deliberately exits 2 after measuring the
unchanged expanded lowering. No CLI/project configuration flag is required for production sharing. The
internal planner option `sharedStages: false` supplies the expanded control.

## Mechanism and boundaries

The historical `shared-stage-proof.js` experiment checked the selected registrations' statement bodies and
effect inputs for equivalence after renaming local/effect/continuation IDs. It
rejects captures, nested calls, groups, loops, missing error lanes and differing
bodies; selection is bounded to 16 transfer-capable HTTP registrations with two
sequential text-fetch sites. It transforms an emitter-local copy of the validated
plan. Original plan hashes, static effect identities, source attribution and
host contracts remain intact; emitted source/Wasm hashes identify the candidate.

Each registration selects the normal/error return cursor, two effect slots and
two continuation states in an instance-owned frame. The body's local slots reset
on entry and survive suspension. Early response completes the request; normal
and error transfers return to the selected caller's cursor. No live native call
stack is required. One stage is active at a time, matching terminal `next()`
semantics. Entry and exit add two bounded dispatcher states, not new effects.

The original per-registration pending/result slots are retained. In particular,
Fastly's application-error driver reads these slots directly. Sharing their
storage initially failed the Fastly probe; the corrected prototype shares body
code and uses four bounded lookup helpers to access the selected slots. It does
not change the provider driver or bypass single-use settlement.

This still incurs frontend expansion and a temporary plan copy. Metadata,
registration wiring, effect-slot lookup code, routing and terminal handlers grow
with registrations. O-19 must move the successful separation into owned IR and
production eligibility rather than treating this experiment as a supported API.

## Results

Merged baseline: `bfcba20` (includes #121 and #123). Node 24.19.0,
AssemblyScript 0.28.18, default O3/shrink0 with ordinary retention and merging.
The source fixture is unchanged between paired cells: one imported stage with
16 local transformations, request state, two fetch suspensions, early responses,
`next(error)` and `next()`. Every chain has a separate terminal fetch handler.
The machine-readable report records full source and artifact identities.

| Chains | Node baseline | Node shared | Fastly baseline | Fastly shared |
| --- | ---: | ---: | ---: | ---: |
| 1 | 8,911 | 8,946 | 44,388 | 44,390 |
| 2 | 12,907 | 10,244 | 48,631 | 45,833 |
| 16 | 68,890 | 27,449 | 108,507 | 65,758 |

All sizes are Wasm bytes. At 16 chains, Node is **60.2% smaller** and Fastly
**39.4% smaller**. The single-registration frame has a small fixed cost.
For 1 to 16 chains, Fastly growth falls from 64,119 to 21,368 bytes; remaining
growth is not attributable solely to registration wiring because routes,
terminal handlers and effect metadata are also added.

| Chains | Node AS baseline | Node AS shared | Fastly AS baseline | Fastly AS shared |
| --- | ---: | ---: | ---: | ---: |
| 1 | 42,514 | 48,012 | 144,053 | 149,551 |
| 2 | 67,848 | 55,754 | 170,506 | 158,412 |
| 16 | 429,513 | 165,822 | 548,028 | 284,337 |

The frontend still reports 1/2/16 expanded source ranges. That is an explicit
remaining compiler-cost limitation, not evidence of duplicated final bodies.

## Final artifact and behavior gates

The named companion must match **every non-custom Wasm section byte-for-byte**
with the actual optimized artifact before its names are used. Binary function
indices are checked against the name section. Both body partitions must survive
exactly once, be reachable from real exports and have direct incoming calls.
Neither disabled optimization nor dead retained copies can pass this gate.

| Chains | Retained body partitions | Node root bytes | Fastly root bytes |
| --- | ---: | ---: | ---: |
| 1 | 2 | 2,576 | 2,661 |
| 2 | 2 | 2,660 | 2,745 |
| 16 | 2 | 2,426 | 2,511 |

These are code-body bytes for the two stage roots, not the entire reachable
helper closure. Slot lookup helpers may grow with registration count. A gate
limits root growth to 10% above the one-registration cell and holds partition
count fixed. All selected registrations are exercised with request-derived input.

- **232 requests pass:** 105 baseline, 105 shared and 22 same-request re-entry
  controls across Node Native, Fastly's local ABI fixture and JavaScript.
- Exact responses and outbound order cover early return before effects, return
  after the first effect, explicit error transfer, normal completion and a later
  fresh request. Fatal Native transport failures fence subsequent effects;
  JavaScript's failure policy is not redefined to match Native.
- A Node request stays suspended while a second completes, then resumes with its
  original locals. The same body can also run twice in one request through two
  distinct overlapping route patterns, with distinct effect and continuation IDs.
- Six preparation checks cover mismatched body/input, capture, group, wrong entry
  kind and immutable input plan. Five raw-ABI checks reject a wrong registration,
  incomplete resume, duplicate result and stale-site settlement while accepting
  the correct live result. Existing managed invocation tickets remain authoritative.

Initial development failures included the Fastly slot coupling above, a
transport-failure expectation corrected to the existing fatal Native contract,
and a re-entry fixture corrected to distinct overlapping routes (registering the
same handler twice for the exact same method/path is forbidden). These failures
were retained during development, not counted as successful runs.

Serial fresh workers provide one build-time observation per cell. This is not a
runtime latency, peak-memory, cold-load or repeated timing claim. It is not
Viceroy or deployed Fastly acceptance, a cancellation qualification, or proof of
arbitrary stage composition. O-19 production work and O-21 application-level
comparison remain separate gates.
