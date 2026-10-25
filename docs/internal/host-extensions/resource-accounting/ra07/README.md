# RA-07: bounded composed-operation accounting

This is an internal compiled-Native checkpoint for one fixed cache lookup → core
fetch text → cache insert recipe under the shared accounting service. A hit skips
fetch and insert. A miss retains the fetched response/body and decoded value while
the writer runs. Both adapters use one ledger and the shared lifecycle hooks.
Production admission, compiler contracts and provider/runtime files are unchanged.

The owner requested RA-07 after merged RA-06 (`6387a2da900efad0010f20f25bb9eb76784db8e0`).
The implementation is confined to this evidence harness. The service remains
`@hex-spike/cache / investigation-bounded-composition.v0`; it is not a supported
package or a new public composition API.

## What the proof exercises

[build.cjs](build.cjs) compiles authored handlers with the canonical compiler, then
uses the earlier [composition prototype](../../composition/prototype.cjs) to append
three child sites per parent. Both the original canonical plan and the expanded
experimental plan are retained and hashed. **The compiler did not prove the child
graph.** The bridge asserts exact generated-source anchors and reverses hook
registration order to check deterministic generation. It restores every modified
owner export after generation and audits actual Wasm imports against the selected
contributions. `ra06_proof.event` is an explicit private diagnostic baseline import,
not package authority.

The fixed recipe has depth one, at most three sequential children per parent, and
one direct call or one static keyed cohort per fresh instance. Widths 2, 8, 16 and
32 cover hits and misses; a two-parent case also includes an ordinary core-fetch
sibling. The existing driver advances only ready operations, skips waiting parents,
and checks progress. There is no new scheduler, retry, dynamic cohort, nested
composition, slot reuse or general callback API.

[service.as.ts](service.as.ts) binds parent/child tickets, expected phase, result
identity and private result delivery to the shared lifecycle. A child consumes a
ledger child token only after authenticated delivery. Parent success requires the
recipe's successful result. Accepted failure placeholders retire accounting tokens
without becoming business success. Cleanup runs once after invocation closure,
when tickets and HTTP response authority have been invalidated.

## Joint resource profile

One ledger root represents each original operation. Child adapters share that root;
they do not reserve independent cache and fetch budgets. Admission reserves the
entire fixed cohort before the first host acquisition.

| Per-root reservation | Handles | Backing bytes | Records |
| --- | ---: | ---: | ---: |
| Work | 3 | 262,785 | 6 |
| Cleanup | 2 | 64 | 2 |
| Execution exit, once per handler invocation | 2 | 64 | 2 |

The work byte allowance is 257 for cache read backing + 262,336 for the RA-05 fetch
projection + 192 for cache write backing. On a miss, insertion begins with the
response and body still owned; reserving only the larger of the two adapter
profiles would undercount their overlap. Known handle disposal refunds logical
handle/record pressure, **not backing bytes**. The final successful miss retains
262,785 charged bytes and three backing records, with zero live host handles.

The private RA-03 claim bank grows from four work plus two cleanup records to six
work plus two cleanup records per root. This is necessary for three retained
backings plus response, body and writer claims. Capacity is explicit and fixed;
there is no resizing or lazy production allocator. The ordinary core sibling
conservatively reserves the same composite profile, then retires unused child
promises. Hits execute two invocations per parent and misses four, although all
four are reserved up front. These are logical accounting bounds, not total memory
or RSS: allocation headers, static banks, metadata, parent/child objects and terminal
response serialization are outside the backing-byte profile, as in RA-05/06.

## Failure and lifecycle policy

A known failure stops new child phases and further business resolution. Already
admitted children can settle failure placeholders; known owned resources are
cleaned within the original deadline. Uncertain acquisition, transfer, consumption
or close outcomes retain their claims even when the injected host happened to
consume the resource. An independent host ledger checks that claims cover every
modeled acquisition and remaining resource.

This deliberately differs from the earlier composition experiment's blocking drain:
a pending sibling is retained when failure stops business resolution. The proof
does not claim quiescence or reclamation of unknown pending work. Timeout and
cancellation cannot renew cleanup time, and late readiness cannot reopen delivery.
A trap does not imply that a finalizer ran. A successful earlier cache commit is
not rolled back when a sibling fails. A close failure after the response is selected
retains the fetch claim without rewriting that response.

Read and write disposal are distinct even though both implementations are linked:
readers close, incomplete writers abandon, and completed writers commit once.
Initial exploratory review caught the combined adapter incorrectly selecting
writer abandon for a reader; the dispatch was corrected and the independent host
now rejects that mistake. No production adapter was changed.

## Evidence and reproduction

Run with the repository's lockfile-pinned dependencies and Native compiler bundle:

```sh
node docs/internal/host-extensions/resource-accounting/ra07/check.cjs /tmp/hex-ra07-fresh
node docs/internal/host-extensions/resource-accounting/ra05/check.cjs /tmp/hex-ra07-ra05 --lifecycle
node docs/internal/host-extensions/resource-accounting/ra06/check.cjs /tmp/hex-ra07-ra06
```

Use a new output directory for RA-07. [check.cjs](check.cjs) snapshots and hashes its
inputs before execution, records terminal status and retains complete host traces,
plans, generated AssemblyScript, Wasm, import policy and contribution artifacts.
[host.cjs](host.cjs) models consumption and allocation independently of the adapter.
Those host semantics are injected assumptions, not Fastly qualification.

The final run passed **81 cases and seven mutation oracles**. Unchanged controls
passed **44 RA-05 lifecycle cases** and **94 RA-06 cases plus seven mutations**.

| Parent count | Compiled Wasm bytes | Hit invocations | Miss invocations |
| --- | ---: | ---: | ---: |
| 1 | 47,834 | 2 | 4 |
| 2 | 48,832 | 4 | 8 |
| 8 | 53,944 | 16 | 32 |
| 16 | 60,625 | 32 | 64 |
| 32 | 74,426 | 64 | 128 |

These are instrumented proof artifact sizes, not production incremental cost.

See [evidence.json](evidence.json) for source identities, artifact
sizes, control receipts and the archive checksum. [evidence.tar.gz](evidence.tar.gz)
contains all formal attempts and exact input snapshots, exploratory artifacts and
control replays. The first formal attempt failed an overstrong unused-import
identity assertion: the embedded plan hash changes with the source import. The
corrected assertion requires unchanged generated source except that identity,
equal Wasm size and no cache imports. The absent-package path remains byte-identical
to unmodified production generation. These controls establish no isolated runtime
cost or end-to-end performance claim.

Seven mutations remove shared admission, cache cleanup, fetch cleanup, backing
retention, child retirement, result guarding, or deadline continuity. Each must
fail its behavioral oracle; compilation failure alone does not count as detection.

## Review checkpoint and remaining qualification

This closes the bounded RA-07 implementation, not adoption. Review executable
behavior here before proceeding to RA-08: diagnostics must distinguish logical
retirement, retained backing and uncertain host resources. RA-09 should measure
matched execution cost and memory, including the joint bank and unused promises.
RA-10 must establish real-host error-consumption, readiness and close behavior.

Still open: compiler-owned child graph representation and authority, structural
adapter integration in place of source anchors, heterogeneous profile derivation,
real host namespaces and lifetimes, JavaScript parity for this composition, and
production admission. The shared lifecycle contracts are reused without moving
HTTP response authority into a provider-neutral ownership rule. There is no
ESP32 implementation or compatibility claim in this checkpoint.
