# Beta.10 resource acceptance checkpoint

**Passed on October 21, 2026.** This checkpoint satisfies the remaining resource
acceptance in #412 and its parent #381. The 12 focused tasks and two independent
installed gates all ran freshly against one clean merged candidate:

- Revision: `b509b5dc64e14bd2f92d54747b3ea57619fb5c42` (merged #485).
- Tree: `cdc280076d818d7dfc9755ba870438fdb7a6fb01`.
- Working tree: clean throughout qualification; no source regeneration or edits.
- Runtime: Node 24.19.0; corpus producer: pinned Node 24.18.0.
- Lockfile, tool hashes and exact task selection: [selection.json](selection.json).

This is bounded resource acceptance, not the complete release seal. #382 retains
integrated release qualification, complete recovery/determinism and installed
selections, actual-client replay, readiness and RC handoff. Hosted/deployed
requirements retain their issue-specific owners. No deployment or publication
was performed. This evidence-only descendant does not acquire its parent's test
identity; the release owner must select the final source again after doc work.

## Evidence and acceptance mapping

[acceptance.json](acceptance.json) summarizes the original receipts.
[receipt-index.json](receipt-index.json) binds each retained file and the archive
by SHA-256. [receipts.tar.gz](receipts.tar.gz) contains terminal runner reports,
task logs, original quality and installed receipts, provider HTTP/cleanup logs,
source/doc checks and the incomplete attempt. Extract it to inspect the original
JSON; paths inside those receipts retain their original local provenance.
Generated Wasm binaries are omitted; exact sizes/hashes remain in the index and
provider receipts. No historical pass has been relabeled as a current pass.

| Requirement / prior ledger | Fresh evidence on this candidate | Disposition |
| --- | --- | --- |
| A02–A05: reconstructed workload, provenance and deterministic inputs | `pulse-context-build`, `pulse-context-corpus`, source freshness check; actual quality receipt | Passed; original vector was not recovered. |
| A03/A09: relevance, growth and whole-request costs | `pulse-context-quality-actual`, `-growth`, `-repeat`; all terminal `acceptance: passed` | 24/24 frozen cases; no failures. Independent human relevance review is not claimed. |
| A10: actual local provider execution | `mcp-fastly-local-installed` | 1,445 real Fastly CLI/Viceroy HTTP exchanges; four variants, zero failed criteria. |
| A11: generic binary contracts and lifetime | `binary-resource-admission`, `binary-resource-execution`, `callable-authored-composition`, `callable-lifetime`, actual-host resource variant | Large independent fixtures, invalid reads, lifetime, failure/recovery and cumulative deadlines passed. |
| A12: exact installed closure and independent construction | `mcp-installed` | 20 packages freshly packed; 18 exact installed dependencies verified. Native and JS each completed 537 calls after source removal. Corrupt, missing, truncated and mixed-identity Native artifacts rejected before listening. |
| A13: aliases, backing identities and reachability | Generic closure in execution and installed gates | Equal independent aliases share one Native physical backing; unreachable payload excluded. JS retains configured backing; no JS pruning claim. |
| A14: honest reporting and retained attribution | `cli-report-resource-inventory`, `cli-report-handler-topology`, `cli-report-retained-evidence` | Source ownership, budgets, raw placement, privacy and retained replay passed. Unknown memory/code attribution remains unknown. |
| A15/A19: source/docs integrity and installed JS workflow | Source/docs checks; fresh installed JS doctor/dev/build, effects, logging, deadline/recovery | Passed. #485 resolves the former provider-requirement admission gap; its old failed receipt remains historical evidence. |

The focused run completed **12/12 in 500.862 seconds**. The installed Node gate
completed **1/1 in 168.329 seconds**; actual local Fastly completed **1/1 in
217.989 seconds**. Each terminal runner report records passed task cleanup and
exit code zero. These separate bounded gates are not pooled into a release-seal
result or a claim about full-release timing.

## Workload, large fixtures and measured headroom

The approved reconstructed sparse lexical workload contains **264 rows, 2,509
dimensions, 15,386 nonzeros and 602,337 raw resource bytes**. Its corpus SHA-256
is `8c79970eee826dfd0d3ea67260a61d6b5450460b8155916993a1cedaccda95ef`;
manifest SHA-256 is
`cc50b59b7e885c0a96c36e484f57760f85163ad34bd8ded783bb42a4b88a1d27`.
It is not the missing original vector or a semantic-search claim. The independent
generic matrix retains a 1,048,577-byte payload and **4,456,448 cumulative bytes
read** (17 × 65,536 × 4), exceeding the discarded 4 MiB quota. Four read cells
cover Node/Fastly Native and Node/Fastly JavaScript; Fastly JS does not claim
`ctx.call`. Callable composition covers its separately supported targets.

The installed generic Native closure has one shared backing, one distinct
backing and zero copies of the unreachable payload. Resource-report proof
accounts for **1,052,676 selected/observed raw bytes**, five selected bindings
and three unique identities including empty backing. Artifact bytes, logical
bindings and physical backing are separate measurements.

| Quality case | Raw resource bytes | Node / Fastly Wasm bytes | Warm median wall ms, Node / injected Fastly | Maximum warm committed bytes, Node / injected Fastly |
| --- | ---: | ---: | ---: | ---: |
| Actual, 264 rows | 602,337 | 995,091 / 1,047,209 | 16.42 / 13.05 | 3,932,160 / 7,864,320 |
| Growth, 512 rows | 1,772,128 | 2,094,827 / 2,146,986 | 58.15 / 58.57 | 3,670,016 / 14,680,064 |
| Two calls, actual corpus | 602,337 | 995,169 / 1,047,302 | 26.97 / 20.03 | 3,932,160 / 7,864,320 |

These measurements support the existing finite configuration, not unlimited
growth or new defaults. Admission allows three files/bindings, 5 MiB per file,
8 MiB raw aggregate and 16 MiB serialized input. Quality thresholds remain
5 seconds/request, 120 seconds/compile, 8 MiB/artifact, 128 MiB committed guest
memory, 64 MiB retained-byte charges and 1,048,576 Node value handles. Boundary
and oversized-output rejection remain part of the checks. Original receipts
retain cold samples, nine warm samples, CPU, phase faults and compile costs.

## Actual Fastly host and limitations

Fastly CLI **16.1.0** with Viceroy **0.21.1** built/served exact installed
application closures with checkout reads denied and source-free serving
directories, without configured backends or dynamic backends. Tool hashes and launch arguments are retained. The four
variants served 605 shipped, 811 growth, 6 deadline and 23 resource requests.
Each variant's stop/pipe cleanup passed; the intentionally stopped CLI returned
exit code 1, while the qualification task exited zero. Descendant-process
observation and RSS sampling were unavailable in this environment; do not infer
zero RSS or complete process-tree observation.

The receipts distinguish initial Wasm memory, declared maximum, committed pages
in injected measurements, and Viceroy's rounded completed-request heap logs.
For example, the shipped host module declares 786,432 initial bytes and a
268,435,456-byte maximum; its completion logs span 3.9–15.7 MB. These are not
peak live heap. Actual-host peak memory, allocation counts and retained-byte
counters remain unavailable. Per-callee final code size and runtime copy counts
also remain unknown. Each Viceroy request uses a fresh instance, so repeated
HTTP requests do not prove retained-instance reuse. Injected ABI measurements
are separately labeled and are not substituted for actual-host evidence.

## Attempts, uncertainty and next owner

The first installed attempt was interrupted by an execution-environment
disconnect (`executor key changed during session recovery`) after packing.
Its runner remains incomplete with zero completed tasks; it is retained under
`interrupted-installed-attempt/` and never counted as a pass. A full fresh retry
passed on the unchanged clean candidate. The other gates completed first try.

Historical `REPORT_ARTIFACT_HASH` and `REPORT_MISSING_COMPLETION` failures did
not reproduce in these three reporting gates. Their causes remain unexplained;
this checkpoint neither fixes nor waives them. #382 must investigate recurrence.

Resource acceptance is complete for #412 and #381. #382 remains open for the
final candidate and full release controller. The actual-client matrix and
hosted/deployed obligations are not closed by this local resource checkpoint.
