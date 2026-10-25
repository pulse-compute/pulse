# RA-06 — cache accounting integration proof

Status: **complete bounded Native checkpoint; production adoption remains separate**.
Human direction: proceed with RA-06 if the lifecycle qualification supports it.
Base: `48cd28d333ff7e4289236a9a8f662310bc56014d`, merged nonterminal proof #536
on `hex-integration`. No exact named Entry Point covers this internal experiment;
ordinary root/docs instructions apply. Class: evidence; scope: evidence-only.
Production compiler, provider, contracts and supported package surfaces are unchanged.

## Result

The existing experimental `@hex-spike/cache` owner now has a compiled accounting
adapter for nontransactional lookup/read and insert/write. It reserves a whole
fixed cohort before cache acquisition, registers each possible output before its
host call, uses the original driver for waits and continuation, and separates
commit, abandon and close. Shared lifecycle hooks authenticate delivery and
perform remaining cleanup after invocation closure and ticket invalidation.

The final run passes **94 Native cases and detects seven compiled mutations**.
Both reads and writes progress at widths 1, 2, 8, 16 and 32. A one-handle capacity
shortage rejects the entire cohort before acquisition at every width. This
addresses the old ownership experiment's completion-stage resource shortage
without adding scheduling or changing `ctx.parallel`.

One review finding changed the adapter: the plain driver can attempt the next
member of a keyed cohort after an acquisition failure. The service now checks
the existing primary error before starting any new business work. Accounting
captures for the admitted cohort remain spent; undispatched siblings acquire
nothing. A mutation removes that fence and must fail the dispatch-count oracle.

## Selected owner and integration boundary

The fixture reuses the [ownership investigation's](../../ownership/README.md)
ephemeral package, lowerer, literal-key/value contract and lookup/insert source
contributions. Its private service is `investigation-owned-resource.v0`.
The new [builder](build.cjs) selects one homogeneous direct or fixed keyed cohort
per fresh instance and verifies the exact package, operation, membership and
literal payloads in the canonical plan. It restores the provider's active
generation functions after private in-process generation. A negative check confirms ordinary
production generation rejects the nonterminal placement with
`PULSE_HOST_EXTENSION_PLACEMENT`.

The service uses the shared request-acquired, settlement, result, delivery and
invocation-closed points through the existing Fastly composer. It still uses
one checked resolver source anchor to route the selected cache slots through
their private resolver. Original tickets, pending modes, deadline, slot-order
waits and continuation machinery remain in charge. No new generic hook,
production service registration or scheduler is added.

The generated artifact contains the RA-03 fixed-bank kernel with an explicit
cache byte-profile substitution, plus [service.as.ts](service.as.ts). Ownership
and accounting are executed inside Wasm; they are not reconstructed afterward.
The [host](host.cjs) maintains an independent ledger and checks preregistration
and retained claims against its resources. Handle zero is valid. Family-qualified
handle encoding is private and bounded to `[0, 1,000,000)`; an out-of-profile
handle records a containment fault and stops work without a complete-accounting
claim.

Actual import signatures and the full admitted ceiling are audited against
selected cache contributions. Read-only artifacts do not import cache insert;
write-only artifacts do not import cache lookup. The diagnostic event import
`ra06_proof.event` is an explicit private harness baseline addition. It is not
package authority or a production import-policy extension.

## Ownership and failure policy

| Resource or boundary | Qualified fixture behavior | Uncertain or interrupted behavior |
| --- | --- | --- |
| Lookup acquisition | Prepare a cache-handle claim before lookup; adopt its returned handle | Retain the claim on failure even if the host produced no output or produced an inaccessible handle |
| Readiness | Original driver waits under its existing deadline; cache state then distinguishes usable hit from policy miss | Cleanup only probes readiness without waiting; an unready or failed observation retains the lookup claim |
| Read body | Prepare its claim before `get_body`; bounded reads copy at most 64 printable ASCII bytes | Read, length and step errors stop business work; known reader and ready cache cleanup remain independent |
| Read completion | Close reader and ready lookup before accepted hit delivery; a miss closes only the lookup | A failed close is attempted once, stays charged and cannot become a hit |
| Writer | Prepare before insert; bounded partial writes under the same deadline | Known incomplete writer uses abandon during cleanup; it is never committed as cleanup |
| Commit | Explicit close after complete writing; successful consumption retires the logical handle/record | Failed finalization retains uncertainty and is neither retried nor abandoned, whether the host consumed it or not |
| Primary failure | Stop new cache acquisitions; preserve the original error while cleaning known siblings | Secondary cleanup failure increments its own counter and retains claims |
| Closure | Remaining safe cleanup runs after ticket invalidation, once, within remaining request time | Error-response time allowance does not renew cleanup time; expired resources remain charged |
| Late readiness | Observe that a retained lookup eventually became ready | Repeated closure, settlement, direct setters and responders do not reopen the invocation or release its retained claim |
| Trap | No after-notification or guest finalizer is assumed | In-flight disposal is fenced before entry; host reclamation and instance reuse remain unqualified |

Failure/consumption combinations in the injected host are deliberate assumptions,
not claims about Fastly's deployed behavior. In particular, ready lookup close,
reader close and writer abandon are treated as safe synchronous operations in
the tested profile. Ordinary lookup close may block before readiness; the proof
does not gain a cancellation guarantee by switching to transaction APIs.
Pinned upstream context remains in the ownership investigation; no new real-host
run or platform-disposition guarantee is claimed here.

Writes are not atomic with handler success. A successful commit followed by
deadline expiry returns a timeout while the host ledger retains the committed
write. A later sibling failure preserves an earlier commit. Abandonment is not
rollback or proof that a concurrent reader observed nothing.

The plain cache-only driver returns on fatal service failure without ordinary
failure-placeholder delivery. A diagnostic attack explicitly exercises accepted
undefined delivery after known failure, proving it does not count as business
success; forged success after failure and undefined after success are rejected.
This is not qualification of Router recovery or package-completion variants.
The previous [nonterminal proof](../../nonterminal-lifecycle/README.md), including
its actual application-error-driver failure path, was also replayed: 38 cases
and five mutations passed unchanged.

## Reservation and backing-allocation profile

The policy dimensions are logical handles, backing-byte allowance and records:

| Reservation | Handles | Bytes | Records |
| --- | ---: | ---: | ---: |
| Per-root work | 3 | 320 | 4 |
| Per-root cleanup | 2 | 64 | 2 |
| Separate execution exit | 2 | 64 | 2 |

A cohort of width `N` therefore requires `5N + 2` handles, `384N + 64` bytes and
`6N + 2` records at admission. These are the reused conservative policy reserves,
not a live-resource census or suggested production defaults. Reads actually
hold at most one lookup and one reader per root; writes hold one writer.

Before UTF-8 payload allocation, a read charges 257 bytes: at most 64 key bytes,
one 65-byte read buffer (including the oversize-detection byte) and 128 UTF-16
data bytes for the decoded 64-byte ASCII value. A write charges 192 bytes:
64 key bytes and two possible 64-byte payload encodings, at begin and resolve.
The actual fixed writer payload is `payload`; these are conservative allowances,
not allocation measurements. Reads permit at most ten body reads, including EOF;
writes permit at most four partial write calls.

| Cohort width | Read backing charge retained at exit | Write backing charge retained at exit |
| --- | ---: | ---: |
| 1 | 257 bytes | 192 bytes |
| 8 | 2,056 bytes | 1,536 bytes |
| 16 | 4,112 bytes | 3,072 bytes |
| 32 | 8,224 bytes | 6,144 bytes |

Successful handle disposal never refunds this backing allowance. The corresponding
record remains charged because losing a reference does not prove reclamation.
Excluded: allocation headers, array/view metadata, value-object/string metadata,
other application values, response serialization, host buffers, engine pages
and RSS. This is a bounded payload-backing domain, not complete guest or host
memory accounting. No cost comparison to RA-05's different body reader is made.

## Artifacts and evidence

All artifacts use the same pinned compiler recipe, a 1,000 ms request budget,
Node v24.22.1 and AssemblyScript 0.28.18. Instrumented artifact sizes are:

| Cache width | Read Wasm | Write Wasm |
| --- | ---: | ---: |
| 1 | 32,474 bytes | 31,955 bytes |
| 2 | 32,868 bytes | 32,350 bytes |
| 8 | 34,315 bytes | 33,802 bytes |
| 16 | 36,253 bytes | 35,746 bytes |
| 32 | 40,041 bytes | 39,549 bytes |

Baseline, absent and imported-unused artifacts are each 24,457 bytes. Absent
source/Wasm is byte-identical to baseline. Imported-unused has zero size growth
and no cache or diagnostic imports; its complete identity is recorded separately.
Reversing registration order gives identical generated source for active builds.
Used artifacts include authored work, diagnostics and accounting; these figures
are not isolated shipping overhead or runtime execution-cost measurements.

The seven mutations remove settlement authentication, remove result
authentication, omit cleanup, commit during cleanup, refund unknown ownership,
close an unready lookup, or dispatch after a known failure. Every mutation is
rejected by a behavioral assertion. Normal cases cover faults, bounds, deadline
consumption, cancellation, late observation, partial commit and cohort pressure.

[evidence.json](evidence.json) indexes receipts, source hashes, artifact sizes,
validation and [evidence.tar.gz](evidence.tar.gz). The bundle includes exact
final inputs, generated AssemblyScript/Wasm, authored handlers, plans, selected
contributions, import policies and full traces. It also retains the earlier
91-case pass, the two subsequent harness failures and their input snapshots.
The final source identities differ from those earlier attempts. Exploratory
compile logs are labeled separately; they are not complete historical builds.

```sh
node docs/internal/host-extensions/resource-accounting/ra06/check.cjs /tmp/hex-ra06-fresh
node docs/internal/host-extensions/nonterminal-lifecycle/check.cjs /tmp/hex-ra06-nonterminal-control
```

Use fresh output directories. The runner is an internal experiment, not a release
gate. No production cache package, dynamic captures/cohorts, sequential slot
reuse, collapsing transactions, HTTP-cache callbacks, streaming authored results,
JavaScript parity, installed-package acceptance or real-host teardown is qualified.

RA-07 should combine the cache and core-fetch profiles under one admission and
accounting domain, including the overlap between their backing allocations and
the existing partial-work semantics. RA-09 still owns matched runtime-cost work;
RA-10 owns host lifecycle qualification. This checkpoint grants no merge or
release authority.
