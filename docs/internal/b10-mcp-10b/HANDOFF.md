# B10-MCP-10B — pinned Native client qualification

Issue #459; PR https://github.com/pulse-compute/pulse/pull/479.

## Checkpoint and scope

- Branch: `codex/b10-mcp-10b`, targeting `latest`.
- Base: `8fc66ed2f2a17af3e68b33f941ebe5c968310791` (merged 10A / #478).
- Clean tested implementation head: `abb77482e004cd8e09e82064e76a22a55f0053f9`.
- Tested tree: `cbd0be7add1f1c9efcc299b7f4d3a0b4ad62af81`.
- The following evidence commit adds only this handoff and retained receipts.
  Its final head is available from the PR; it does not replace the tested identity.

No named Entry Point directly matches standalone client qualification. Ordinary
root, Wasm and documentation instructions apply. The user's “Implement 10B”
authorizes the bounded test registration, installed gate, fixture/receipt checks,
canonical maintainer documentation and generated CLI mirror. Classification is
`evidence` / `evidence-only`, with no protected boundary changes. No runtime,
application, client pin, transport feature, public API or release selection changed.
No merge, release, deployment, activation, inference or self-approval occurred.

## Passing actual endpoint matrix

Fastly CLI **16.1.0**, Viceroy **0.21.1**, Node **24.18.0**, pnpm **12.4.2**.
The clean final registered task passed in **129.79 seconds**. All 20 standard
package candidates were packed, installed outside the checkout and byte-verified.
Each row binds source/tree, frozen client lockfile, installed client file digest,
actual host tool hashes, configuration, application entry and build/module hashes.
Client dependencies use their existing frozen lockfiles with lifecycle scripts
disabled. Installed Pulse and client files remained unchanged.

| Client | Explicit profile | Result | Tools | HTTP exchanges | Terminal receipt |
| --- | --- | --- | ---: | ---: | --- |
| Official SDK 2.2.0 | 2026-07-28 | Passed | 5 | 8 | [SDK modern](receipts/clients/sdk-modern.json) |
| Claude Code 2.1.292 | 2026-07-28 | Passed | 5 | 8 | [Claude modern](receipts/clients/claude-modern.json) |
| Official SDK 2.2.0 | 2025-06-18 | Passed | 5 | 10 | [SDK compatibility](receipts/clients/sdk-legacy.json) |
| Codex 0.160.1 | 2025-06-18 | Passed | 5 | 19 | [Codex compatibility](receipts/clients/codex-legacy.json) |

All five Native names are exercised: `pulse.diagnostic`, `pulse.example`,
`pulse.read`, `pulse.search`, and `pulse.start`. Both text and structured values
are compared with independent host-v1/lexical oracle expectations, including exact
citations. The client mode selects one successful case per tool from the generated
oracle inventory. The host receipt's `expected.cases: 546` describes that inventory;
**it does not claim 546 executed tool cases in this mode**. Actual coverage is
20 client tool calls, 45 recorded client HTTP exchanges, and 89 direct wire checks.
Full workload/pagination/growth/resource qualification remains the separate 10A
owner and is not claimed as a fresh run here.

The shipped application remains modern-only. A separately hashed fixture changes
only the existing binding's explicit `legacyProtocol: '2025-06-18'` option.
SDK revision selection is explicit; Claude's observed wire stays modern and
Codex's stays on the configured compatibility profile. A byte-preserving loopback
relay records the actual client traffic to Viceroy. It implements no MCP methods,
translates no headers/bodies, and provides no product execution fallback.

Direct wire profiles passed **44 modern + 45 compatible checks**: modern
discovery and explicit initialization/ping, numeric/string IDs, invalid IDs,
notifications without dispatch, protocol/tool errors, disabled capability methods,
origin/header/body/depth admission and all-tool recovery. Malformed modern
requests still reject on the compatible variant. Only tools capabilities are
advertised; no sessions, SSE, Resources or Prompts are introduced.

Claude's trusted control API flattens text blocks to a string and omits successful
`isError`. Its returned text and structured content are independently checked.
The relay separately requires the real MCP response's `isError: false`, text-block
array and matching structured content. This is a measured client projection, not
a change to server behavior. All agent calls use explicit existing controls and
isolated settings; inference request counts are zero.

## Artifacts and measurement limits

| Variant | Wasm bytes | SHA-256 |
| --- | ---: | --- |
| Shipped modern | 1,046,697 | `25349f157dd40e14b5c9b28d3badfcf115ed89b0d24ee98a9c95c8f2817722e2` |
| Explicit compatible | 1,047,410 | `247be27293f61b121eac5e522eb6ffe615c2b7fbdcbafb8bc29e87b2e08164c8` |

The shipped module is byte-identical to the repaired 10A module. The explicit
compatible variant adds 713 bytes. No-call/unused-Wasm fixture gates remain
unchanged; no new compiler or callable-cost qualification is claimed.

Both serving directories contain built artifacts, not application source, and
configure no backends. Both CLI processes terminated; exit 1 reflects intentional
server shutdown. Client processes and recording relays closed; temporary consumer
and client directories were removed. Descendant/RSS observations remain unavailable
where recorded, and guest peak/live allocation counts remain unknown. This is
local real-host compatibility evidence, not deployed, retained-instance or leak
qualification. No checks or local qualification servers remain running at handoff.

Full local final artifacts (including Wasm) remain under:
`/workspace/scratch/d3826bbd4bf5/pulse-10b/wasm/.test-results/mcp-installed-0rawzi/`.
Binary Wasm is not committed. `receipt-index.json` hashes every retained file.
Aggregate installed/client receipts and large logs use deterministic gzip; the
four individual final client/profile receipts remain directly readable JSON.

## Other validation

- **68/68 unit tasks passed**, 443.98 seconds, before the fixture projection/error
  corrections, on clean local `7b9f4cd9e396d34a235f25174ee8e2af5b3399f6`.
  Its tree `12d43d85f044d599501183e831e07cb7774df958` is identical to published
  `944919c1b84086a7daba6d3a164b8bb882c935a2`. Do not relabel it as a final-head run.
- **4/4 focused tasks passed on the final clean tested head**: `suite-shape`,
  `mcp-http`, `mcp-compatibility`, `mcp-tools`. Compatibility now includes negative
  receipt checks for absent dependencies, interrupted rows, false aggregate passes,
  missing tool calls, altered results/IDs/capabilities, sessions and fallback.
- Standard package build, TypeScript, generated context freshness and installed
  CLI builds passed as part of the final actual-host gate.
- Maintainer, scope, canonical docs, generated mirror and direct documentation
  release checks passed. The conservative classifier includes CLI because its
  generated docs mirror changed; no CLI workflow source changed. A separate full
  CLI profile, full release seal, old Node installed journey and deployed checks
  were not run or claimed. Existing host APIs remain covered by their unit tests.

## Failed attempts retained

- Initial installed attempt stopped at the mandatory clean-source pack check;
  all four rows were terminally blocked. `blocked-dirty-source-*` receipts retain
  that outcome. The initial focused run rejected the registry description's
  historical term; the description was corrected without weakening suite policy.
- The next complete matrix on clean local `7b9f4cd...` correctly failed: both SDK
  rows and Codex passed, Claude stopped at the fixture's `isError` assertion, and
  both wire profiles stopped at the fixture's incorrect unknown-tool HTTP status.
  The actual contract is HTTP 400 / JSON-RPC -32602. `failed-matrix-*` receipts and
  `second.*` logs remain failed, including their original coverage metadata.
- Short retained-artifact Claude diagnostics identified its string text projection
  and then passed all five calls. These are diagnostic replays, not substitute
  qualification; the final complete clean run above supersedes them for acceptance.
- Claude's initial offline dependency restoration lacked cached metadata. The
  unchanged frozen lockfile subsequently installed its exact version from the
  registry; both install logs remain. No version upgrade or silent skip occurred.

## Handoff

Implementation and bounded local acceptance are complete, with no outstanding
semantic or external-client blocker. The evidence commit leaves the published
checkout clean. Hosted CI and human review remain separate; final PR status is
reported at handoff. A release owner must rerun/rebind against its immutable
candidate rather than pooling these development receipts into a seal.

**One next action:** human review of PR #479 and its receipts. Merge remains
human-owned; issue #460 is the subsequent documentation/integrated-candidate unit.
