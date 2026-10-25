# RA-04 — exclusive lease and in-flight buffer pressure

Status: **internal executable pressure experiment**. Human direction: “Let's
proceed with 04.” Base: merged RA-03 Native follow-up #531 on `hex-integration`.
No exact named Entry Point covers this internal cross-owner experiment; ordinary
root/docs instructions apply. Change class: evidence; scope: evidence-only.

## Decision and evidence boundary

Keep whole-root exclusive reservations, charge backing allocations through active
or unknown access, and reserve copy overlap and cleanup separately. Scoped pins
are useful: they prevent destructive use and handoff while aliases exist, without
creating duplicate ownership or a second scheduler. Continue with the conservative
rule that all host actions require zero pins. This unit does not establish a
benefit for concurrent host read/write access or reentrant exclusive leases.

All **51 [pressure checks](check.cjs) pass** at widths 8, 16 and 32. A small compiled
[Native guard](guard.as.ts) exercises bounded pins, owner handoff, operation
completion and resource reuse. It is also compiled into the same Wasm module as
the RA-03 Native ledger to check retained in-flight byte charges and protected
cleanup capacity. The existing JS ledger exercises richer exclusive and
per-dimension refund rules. A trusted test harness coordinates the calls; there
is no integrated production provider hook or atomic cross-service transaction.
The guard does not implement deadlines itself: the ledger/driver must check the
inherited deadline before entry, and final closure prevents new guard actions.

This is a pressure checkpoint for the shared contract. Real fetch/cache integration
and host quiescence evidence remain RA-05/06/10 work. No hardware, DMA, real Fastly
execution, application latency, full Native profile parity or production adoption
is claimed.

## What the pressure cases establish

| Pressure | Required result |
| --- | --- |
| Two roots name the same canonical exclusive binding | Whole cohort rejected before dispatch; capture counts remain spent |
| Two names alias one physical binding | Provider must resolve both to the same identity before admission; fixture tests that resolved identity |
| Two sibling pins reference one buffer | One allocation charge; both pins must return before actions or handoff |
| Pin bank exhaustion | Reject the fifth pin before access; no overflow allocation |
| Cancellation during a read | Retain bytes and lease; completion must establish quiescence before cleanup entry |
| Unknown completion or failed disposal | Quarantine; no reuse, inferred release or disposal retry |
| Consumed handle with active backing storage | Logical handle refund allowed; bytes, record and lease remain unavailable |
| All numerical charges refunded but exclusive obligation remains | Conflicting root still rejects until explicit exclusive release |
| Early resource release within a root | Whole-operation reservation persists until root finish |
| One uncertain sibling | Independently safe cleanup of other siblings still completes |
| Deadline reached with cleanup headroom available | Further entry rejects; capacity does not extend time |
| Recycled resource, pin or action slot | Old generation rejected, including 5,000 reuse cycles per width |

The guard allows four simultaneous **scoped read-only aliases** per canonical
resource in this experiment. Their payloads are not exposed by the guard. It
fences owner operations while any pin is live; it does not make raw memory
immutable or sandbox a trusted provider. Borrowers receive pin-return authority,
not owner/disposal authority. Cross-resource tokens reject; numeric tokens are
scoped to one Wasm instance. Generation limits reject rather than wrap.

Each resource has one in-flight operation. A successful read completion returns
it to owned/quiescent; only a disposal completion can release it. Uncertain
completion is terminal for this execution. End accepts already-issued completion
facts but grants no new action entry. Stop allows independently safe cleanup after
quiescence. No queue, drain, polling, retry, or extra deadline is introduced.

## Storage pressure and actual body-reader implications

The native guard adds exactly 52 raw bank bytes per resource: five i32 fields and
four two-i32 pin slots. At 8/16/32 that is **416 / 832 / 1,664 bytes**, excluding
Wasm globals, page rounding, engine state and the separate accounting ledger.
Actual compiled module sizes and linear-memory observations are in the receipt.
These are fixture dimensions, not selected production defaults.

| Width | In-flight backing bytes retained | Protected cleanup bytes | Full backing + copy + cleanup peak |
| --- | ---: | ---: | ---: |
| 8 | 1,536 | 512 | 3,584 |
| 16 | 3,072 | 1,024 | 7,168 |
| 32 | 6,144 | 2,048 | 14,336 |

Each fixture backing allocation is 192 bytes. A 64-byte view still retains its
192-byte allocation. Copying it into another 192-byte allocation needs a 384-byte
work envelope; cleanup adds 64 bytes per root. The table excludes the separate
64-byte execution exit reserve, guard/ledger storage and host memory. A profile
with only 192 work bytes rejects the extra copy before allocation is modeled.
These are exact synthetic charges, not measurements of physical body-reader peaks.

Source inspection of the current owners identifies a concrete next requirement:

- `packages/provider-fastly/src/build/native-platform-capabilities.js`,
  `__pulse_fastly_read_body`: creates read buffers, retains chunk views, allocates
  the assembled byte array, then decodes text.
- `packages/runtime/src/internal/body.js`: retains stream chunks and allocates a
  combined output. Its abort path requests cancellation; that call alone is not
  an external-quiescence receipt.

RA-05 must account for backing allocations, simultaneously retained chunks,
assembly copies and decoded values, with the actual allocator/view semantics
qualified. Payload length alone is insufficient. Deduplicate aliases of the same
allocation; never deduplicate distinct copies merely because their contents match.
The pressure fixture supplies this prerequisite; it does not derive real provider
profiles or retrofit these readers.

## Reproduction and retained evidence

```sh
node docs/internal/host-extensions/resource-accounting/ra04/check.cjs /tmp/hex-ra04
```

Uses the pinned RA-03 AssemblyScript build helper. [Checks](checks.json) record
terminal status, every case and exact input hashes. [Evidence index](evidence-index.json)
pins source snapshots, generated AssemblyScript, actual Wasm and attempts in
`evidence.tar.gz`. [Validation](validation.json) records repository checks.
The initial harness requested a nonexistent `consumed-bytes` proof and expected
a quiescence error. It was corrected to assert proof rejection and separately
exercise the existing record proof's quiescence requirement; the failed attempt
is retained. The intermediate 45-case pass precedes the combined Native checks. The first
combined compile exposed colliding private stop/end variable names; guard-specific
names fixed that collision, and its failed receipt is also retained.

RA-04 establishes useful conservative pin/lease rules and bounded pressure at the
chosen widths. RA-05 should carry these dependencies into core fetch and structured
body accounting; RA-06 should map cache lease/disposal outcomes to qualified host
facts. A numeric charge reaching zero must never substitute for those facts.
