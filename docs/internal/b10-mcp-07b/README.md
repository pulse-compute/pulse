# B10-MCP-07B — generic resource lifetime and physical closure

[PR #473](https://github.com/pulse-compute/pulse/pull/473) implements [#454](https://github.com/pulse-compute/pulse/issues/454). This is test/evidence hardening of the existing resource and callable contracts. It changes no compiler/runtime/provider implementation, admission limits, default budgets, HTTP Assets ceilings, callable target support or release policy.

## Source and result

Base: merged 07A on `latest`, `070f26c46c26afde84f82539884ecd695333e9c9`. Branch: `codex/b10-mcp-07b`. Clean tested local revision: `e6aa287bb32f718198b562d191d8001d250add3f`; published equivalent: `4338bdf30aeeef1b28399d27f8f64bf282b4500d`; identical full tree: `58b83652ea57f286e951a329f4c8d8538979f6bc`. The final handoff adds evidence only. PR metadata records the final local/published heads and dirty state.

The existing [focused gates](./receipts/focused.json) pass 4/4: `binary-resource-admission`, `binary-resource-execution`, `callable-authored-composition`, and `callable-lifetime`. The complete [mcp-installed runner](./receipts/installed.json) and [nested acceptance receipt](./receipts/mcp-installed-acceptance.json) pass, including unchanged installed package bytes and cleanup. This keeps the mandatory installed gate and its existing 600-second deadline, not a new weaker acceptance lane.

The [unit profile plus release-evidence-authority](./receipts/unit.json) passes **69/69**, with terminal passed status, complete task coverage and process exit 0. No qualification retry was needed and no checks remain running. Per-task logs are retained alongside the outer reports; deliberate failure/timeout fixtures inside the recovery tests are expected test inputs, not failed qualification tasks.

Maintainer, documentation, documentation-release and scope checks pass. There are no product changes requiring a new semantic decision. No exact named Entry Point covers the combined generic execution/installed closure qualification; ordinary repository/Wasm/docs instructions apply.

## Matrix and execution ownership

| Concern | Qualified scope |
| --- | --- |
| Large raw payload, unsigned/unaligned little-endian reads, signed zero, invalid offsets/nonfinite values | Node Native, injected Fastly Native, Node JavaScript, injected Fastly JavaScript |
| Empty mapping, zero-length UTF-8 at start/end, truncated scalar and invalid range | All four resource-read targets |
| Repeated reads beyond 4 MiB in one execution | All four: 17 × 65,536 four-byte reads = 4,456,448 bytes; existing loop bounds unchanged |
| Snapshot, unavailable/forged/foreign/stale views, serialization denial, failure/abort and fresh-request recovery | Both JavaScript providers; two simultaneously live executions exercise foreign branding |
| Native no-escape/ownership and lifetime | Source escape rejection, recomputed-hash plan forgeries, closed Node controller, synchronous Node/Fastly deadlines, callable fault/cleanup and cumulative budgets |
| Shared resources across distinct callable owners | Node Native, injected Fastly Native and Node JavaScript only; Fastly JavaScript does not support `ctx.call` |

Native exposes no public resource-view handle to carry between executions. Its proof is compiler/plan ownership plus closed execution and deadline enforcement, not a fabricated equivalent of JavaScript's branded-object tests. The previous no-call/unused-resource byte-equality assertion remains and passes. The 05F callable gate is freshly replayed; no existing limits are relaxed.

## Independent closure and physical equality

The test-only producer constructs five binary files and the canonical manifest independently of production resource helpers. `/copy` and `/shared` use distinct byte objects containing equal 1,048,577-byte contents. Separate data has 4,099 bytes, the empty file has zero bytes, and the unreachable file has 131,073 bytes. Explicit application budgets exactly match the file count, maximum file size, aggregate decoded bytes, serialized manifest size and six bindings. Production construction must reproduce the independent manifest byte-for-byte; the admission gate also retains all smaller-budget and unchanged HTTP Assets rejection cases.

A parent, two distinct callees and a repeated call use logical aliases over those resources. Native selection retains **five logical bindings and three unique blob identities**, including the zero-byte blob. Initial linear-memory inspection finds **one** complete shared byte sequence, **one** distinct sequence and **zero** unreachable sequences on Node and injected Fastly. All three fresh executions per target return the independent expected scalars with stable committed memory/budget counters.

The [closure receipt](./receipts/generic-closure.json) separates byte representations:

| Measurement | Bytes |
| --- | ---: |
| Raw manifest files, counting equal-content paths separately | 2,232,326 |
| Serialized manifest | 2,977,405 |
| Selected Native unique backing | 1,052,676 |
| Serialized Native plan, including owner metadata/catalogues | 4,238,764 |
| Node Native Wasm artifact | 1,093,276 |
| Injected Fastly Native Wasm artifact | 1,136,497 |
| Node initial/committed linear memory | 2,293,760 |
| Fastly initial/committed linear memory | 4,718,592 |

The receipt separately retains cumulative allocation/value charges. Those charges and committed linear-memory capacity are not a live-object heap census. Full artifact hashes remain bound to their respective build context; equality of file sizes is not an assertion that workspace and installed artifact bytes are identical.

JavaScript preserves the configured application store: **six bindings, four unique blob identities, 1,183,749 declared backing bytes**. Its generated entry has one base64 copy of each nonempty unique backing. The unreachable configured backing remains, as allowed by the existing JavaScript contract; Native alone claims reachability pruning. The 1,579,594-byte JS entry measurement is the entry artifact, not the entire package or a heap measurement. Private JS backing/peak live memory remains explicitly unavailable. This work does not widen pruning semantics to ordinary JavaScript dependencies.

## Installed and source-deleted execution

The general closure first compiles Node Native, Fastly Native and a Node JavaScript source package, deletes `src`, `.pulse` and the original binary `inputs`, then executes the retained artifacts. This generic fixture stays separate from the smaller MCP corpus.

The mandatory installed gate additionally copies the **exact verified installed packages** into an unrelated consumer, constructs the same independent generic application, and builds both targets with the installed public CLI. It removes authored input directories and the unused generated Native JavaScript/TypeScript files before a fresh process runs three HTTP requests on each target through the public Node launcher. Runtime filesystem permissions deny checkout/authored inputs and exclude the CLI's example source copy. Six generic installed requests pass in addition to 07A's 537 Native MCP requests, corruption probes and retained official-client/Codex journey.

Build-time containment reuses 07A's trusted-tooling filesystem content-read/CommonJS instrumentation with consumer-local compiler temporary files. Ancestor metadata and the exact TypeScript case probe remain permitted. It is not a hostile-code sandbox or a complete OS audit. Runtime uses Node filesystem permissions; no product writer/fsync behavior changes.

## Attempts and remaining work

Development-only failures are preserved. They exposed missing fixture package-version metadata, a missing schema-codec option in the direct JS harness, expected provider failure/abort result forms, the required config scope parameter, and a compiler temporary directory outside the build guard. The fixture/harness was corrected; production code was not changed. The installed development replay reused an earlier exact package installation and stubbed package-copy verification, so it is not qualification evidence. The fresh complete registered installed gate performs the real package verification.

No release seal, merge, publication, deployment or self-approval is claimed. Actual Fastly CLI/Viceroy/deployed evidence is still owed by **10A**; JavaScript fixture injection and Fastly ABI mocks do not satisfy it. **#412 remains open** for reporting and actual-provider requirements. Next implementation checkpoint: **08 / #455**, callable attribution and truthful resource reporting.
