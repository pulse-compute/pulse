> Historical blocked checkpoint. The user-authorized error-boundary repair and complete passing rerun are recorded in [REPAIR.md](./REPAIR.md). Original failed receipts below remain unchanged.

# B10-MCP-10A handoff — acceptance blocked

Issue #458; draft PR https://github.com/pulse-compute/pulse/pull/478.

## Source checkpoint and scope

- Branch: `codex/b10-mcp-10a`, targeting `latest`.
- Base: `76fa603093217b4685ea78e947501a98626e645d` (09B / #477 merged).
- Tested implementation head: `fef3450798fe7d94058669348e9ff5f5a34535c6`.
- Tested tree: `25839d39a78479098519792e2fa520dfc1caefab`.
- The following evidence commit adds only this handoff and retained receipts; its PR head does not replace the implementation identity above.

Entry point: `provider-fastly`. The user requested “Implement 10A,” authorizing
bounded actual local qualification, installed fixtures, test registration,
canonical maintainer documentation and its generated CLI mirror. Changes remain
tests/docs only. No product semantics, dependency, package membership, release
selection, public API or authority policy changed. The new external task is
explicitly excluded from the portable release profile. No merge, publication,
deployment or activation occurred.

## Implementation

`mcp-fastly-local-installed` reuses the existing standard package/installed
consumer owner and independent context oracle. It packs all 20 candidates,
installs the CLI-shipped application outside the checkout, checks installed
package bytes and builds with that exact CLI and installed dependencies. The
trusted-tooling read guard rejects repository content reads during product
builds. It is not a hostile-code sandbox.

The actual Fastly CLI owns the local Viceroy process. The serving directories
contain only the generated Wasm, build manifests, local configuration and logs.
There are no configured backends or JavaScript execution fallback. Static
resource-copy inspection does instantiate Wasm with stub imports without calling
its entry point; only actual HTTP execution supplies provider acceptance.

Four separate variants retain configuration/module/build-receipt hashes:

- Shipped application: all five tools, complete production read and search pages,
  independent citation/output comparisons, examples, diagnostics, start selection,
  version mismatch, invalid inputs, protocol/HTTP admission and repeated search.
- Growth: original production rows plus deterministic growth to the admitted
  512-row ceiling, all read/search pages and adversarial pagination/query cases.
- Deadline: shipped configuration with only Fastly `maxDurationMs` changed to 1;
  three timed-out searches and admission requests after each timeout.
- Generic resources: existing 07B resource fixture with aliased/deduplicated and
  unused resources, empty/UTF-8 reads, workspace initialization, bounds failures,
  single allocation and cumulative allocation pressure across callees. It uses
  the existing 16-call ceiling and loop limits.

The gate records independent bounds failures and continues the remaining
failure/recovery checks, then fails terminally if any failure remains. Empty
HTTP 200 responses are never accepted as valid rejection.

## Final actual-host result

Terminal **failed**, 202.76 seconds, all 1,445 HTTP exchanges completed. Fastly
CLI **16.1.0** and Viceroy **0.21.1**; binary SHA-256 and version output are in
`receipts/final-qualification.json`. `coverageComplete` and `installedUnchanged`
are true; these do not turn the failed qualification into a pass.

| Variant | Exchanges | Wasm bytes | Median / max HTTP ms | Outcome |
| --- | ---: | ---: | ---: | --- |
| shipped | 605 | 1,046,476 | 4.99 / 53.35 | Passed |
| growth | 811 | 2,146,249 | 4.33 / 76.38 | Passed |
| deadline | 6 | 1,046,474 | 2.60 / 3.66 | Passed |
| resources | 23 | 1,141,868 | 1.34 / 3.78 | Two bounds failures; other checks passed |

Latency is local wall-clock request time, not a deployed benchmark. Every module
has a declared 256 MiB maximum. Initial declared memory is 786,432 bytes for
shipped/deadline, 1,835,008 for growth and 1,179,648 for resources. Viceroy's
rounded completed-request heap logs report shipped 3.9/7.9/15.7 MB, growth
7.3/14.7 MB, deadline 3.9 MB and resources 4.7 MB. Their histograms are retained.
These are not peak live heap measurements. RSS/process descendants, peak guest
heap, live allocation counts and retained-budget counters are unavailable here
and remain unknown. The static policy is not a measurement.

All four CLI processes terminated and their output pipes closed. Exit code 1
reflects intentional termination of the local serving process and is retained
alongside its logs; it is not hidden as an ordinary clean exit. Descendant
process observation was unavailable. Viceroy uses fresh request instances;
repeated HTTP requests prove recovery on the running host, not retained-instance
execution or a leak-free allocator.

The only final failures are `bounds` and `resource-bounds`, each expected 500,
actual 200, empty body. Allocation pressure returned 500 with an `unreachable`
trap; all healthy recovery requests passed. See [BLOCKER.md](./BLOCKER.md) for
the provider ownership and bounded next repair. Issue #458's stop boundary
requires recording this semantic dependency rather than fixing a second project.

## Completed development checks

Node 24.18.0 and pnpm 12.4.2; lockfile-pinned offline dependencies installed
with lifecycle scripts disabled. Final checks ran on the clean implementation
head above. `receipts/source-checkpoint.json` independently verifies unchanged
HEAD/tree, empty tracked/untracked status and unchanged diff immediately after
the failed run, before evidence files were added.

- Four focused tasks passed: `suite-shape`, `mcp-http`,
  `pulse-context-application`, `fastly-cli-gate-surface`. Includes 114 protocol
  exchanges and 516 real context application calls. See `final-focused.*`.
- Real standard pack passed its documentation/context checks, TypeScript build,
  all 20 packages and installed-byte verification before the host run. Full
  command output and exact package/manifest hashes are in
  `final-installed-acceptance.json`; the parent correctly remains failed and
  `providerRealityValidated` remains false.
- Maintainer, publication, canonical documentation, direct documentation-release,
  generated mirror sync and scope checks passed. See the named receipt logs.
- `git diff --check` passed. No broad unit/release profile, complete SDK/Codex
  installed journey, deployed smoke or final immutable release seal is claimed.

One documentation check was initially invoked with the nonexistent registry task
`documentation-release`; the selector failed before running a test. Its
`invalid-docs-task.*` receipts are retained. The correct direct
`node scripts/documentation-release.cjs` command then passed. This is a command
selection correction, not a waived product test.

## Retained attempts and artifacts

`receipt-index.json` records every retained receipt's bytes and SHA-256.
`receipts/final-qualification.json` contains every HTTP status, body hash, byte
count and latency, the full failure bodies, tool/module/configuration hashes,
resource-copy inspection and cleanup observations. The installed parent binds
source, package tarballs, installed package bytes and the context manifest.
`receipts/artifacts/<variant>/` retains build manifests, Fastly config and raw
stdout/stderr; binary Wasm is not committed.

The full final local artifacts remain at:
`/workspace/scratch/d3826bbd4bf5/pulse-10a/wasm/.test-results/mcp-installed-7Tylcq/fastly-local/`.
Each variant has `bin/main.wasm`, configuration, manifests and logs. The parent
receipt is adjacent at `mcp-installed-acceptance.json`. Temporary installed
consumer directories were intentionally deleted by the harness.

Earlier failures remain failed and are not pooled with final results:

- `initial-local.*` / `initial-qualification.json`: 193.37 seconds on local
  `eca268d22a2254b74fb8a5089c791a0b70f058a3`. Resource fixture exceeded the
  existing 16-call source ceiling. Reduced heavy calls and increased bounded
  string growth without widening product limits. Artifacts: `mcp-installed-YycEfB`.
- `second-local.*` / `second-qualification.json`: 204.33 seconds on clean
  `081ca98d3fabc871361d934df655791581f95927`; stopped at the first real empty-200
  bounds failure after 1,440 requests. Artifacts: `mcp-installed-Q6FBan`.
- `retained-probe.*`: independent eight-request replay of that exact resource
  Wasm reproduced both empty-200 failures, 500 allocation trap and healthy
  recovery. Diagnostic script completion is not acceptance success.
- `initial-focused.*`: suite-shape failed because the explicit external task
  exclusion was initially missing. The final four-task run passed after adding
  the established exclusion; canonical release selection remains unchanged.

## Handoff

The local gate implementation and diagnostic evidence are complete; **actual
local acceptance is blocked**. PR #478 stays draft, #458 stays open. The evidence
commit contains only repository-only handoff/receipts. No local checks remain
running, and the published checkout is clean after that commit. Hosted checks
and human review remain separate requirements.

One next action: repair the provider generic fatal-error response described in
`BLOCKER.md`, then rerun this complete task on the reviewed head. A future release
must rebind and rerun against its selected immutable candidate; neither these
failed development receipts nor successful subsets qualify that candidate.
