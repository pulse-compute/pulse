# B10-MCP-00 — Native context-MCP baseline

Issue [#423](https://github.com/pulse-compute/pulse/issues/423), target `latest`.
Model recommendation: Sol 6.1 / High; size S; class evidence.

This is the starting ledger for a new Fastly Native context application and a
deterministic vector build required by release sealing. It records current
behavior and missing proof; it does not implement the rebuild or approve an
encoder, binary format, loop-limit increase, protocol expansion or deployment.

## Source identity and reproduction

Inspected on 2026-10-19:

- Revision: `3ce6a740226434e013f2ba517129679de0f1fd08`.
- Tree: `0e69bac826907cd7d4b7d2bef65c4f7475c1c0f2`.
- Branch prepared: `codex/b10-mcp-00-baseline`, based on clean current `latest`.
- Node used for source checks: 24.19.0.
- [baseline.json](./baseline.json) records 154 source-file byte lengths, SHA-256
  hashes and Git blob identities, the corpus summary, scoped vector search, and
  18 relevant registered tasks with profile membership and finite deadlines.

Run in this evidence branch (or a checkout retaining the same inspected inputs):

```sh
node docs/internal/b10-mcp-00/inventory.cjs --check
```

The inventory requires the pinned commit object, checks every selected input
against that commit, rebuilds the existing text corpus in memory, checks every
installed example mirror, and compares the complete deterministic inventory.
It does not execute test tasks. `--write` regenerates the inventory from the same
pinned inputs; it cannot silently rebaseline changed source. Future work should
retain this historical baseline and produce its own candidate-bound evidence.

The old recovery checkout at `bba3559` contained an uncommitted corpus update;
it was left untouched. No evidence from that dirty checkout is attributed to
the pinned source above.

## Reconciled resources

| Owner | Disposition on 2026-10-19 | Evidence boundary |
| --- | --- | --- |
| [08A #410](https://github.com/pulse-compute/pulse/issues/410) | Closed completed; [#413](https://github.com/pulse-compute/pulse/pull/413) merged as `1f53a7fc06ab946ece2926b8a23127382a823c5c` | Admission, integrity, immutable identity and explicit budgets; generated fixtures |
| [08B #411](https://github.com/pulse-compute/pulse/issues/411) | Closed completed; [#418](https://github.com/pulse-compute/pulse/pull/418) merged as `fefa1242e3dd1a8d905cd25074fd61b42a88f688` | Execution-owned views, scalar reads, raw Native embedding; injected Fastly ABI evidence |
| [08C #412](https://github.com/pulse-compute/pulse/issues/412) | Open | Actual MCP workload, installed closure, provider reality and reporting remain |
| [Parent #381](https://github.com/pulse-compute/pulse/issues/381) | Open; A/B checkboxes reconciled | Closure still requires all of 08C, including generic resources and every claimed target |

Both merge commits are ancestors of the pinned revision. The issue closure
repairs stale tracking after merges into the non-default branch; it adds no
qualification claim. #412 now explicitly coordinates with B10-MCP-01/02/03,
07/08 and 10 without dropping its original requirements.
The observed before/after states and update timestamps are retained in
[reconciliation.json](./reconciliation.json).

Historical #418 reports 194/194 development tasks passing at `05b2b35`, not this
baseline. Optional Viceroy replays were skipped. The intermittent
`REPORT_ARTIFACT_HASH` failure remains unexplained despite later topology passes.
No new resource runtime, installed, real-provider or release pass is claimed here.
See [B10-08 evidence](../b10-08/README.md) for the original measurements.

Preserve explicit finite `fileBytes`, `totalBytes`, `serializedBytes`, `files`
and `bindings` budgets; HTTP Assets retains its independent policy. Embedding
growth is intentional data hoisting. There is no fixed cumulative read quota.
Views cannot escape execution lifetime, and search stays in application/library
code. Native source eligibility and host limits still apply.

## Current implementation and generated owners

| Concern | Canonical owner | Current behavior / rebuild consequence |
| --- | --- | --- |
| App target | `examples/12-pulse-context-mcp/.pulse/config.ts` | Only `node-javascript`; no Native or Fastly profile |
| Tool declarations | `examples/12-pulse-context-mcp/src/index.ts`, `src/schemas.ts` | Five read-only Entities operations, schema/catalog metadata |
| Tool computation | `examples/12-pulse-context-mcp/src/handlers.ts` | Ordinary JS object/array/string processing; Native eligibility must be designed and proven |
| Corpus selection | `scripts/pulse-context-inputs.json` | Explicit public source/section/example allowlist |
| Corpus generation | `scripts/pulse-context-corpus.cjs` | Stable ordering, content/source hashes, immutable Git-blob citations, version/applicability, finite budgets |
| Generated data | `examples/12-pulse-context-mcp/context-corpus.ts` | Frozen TypeScript text/data module; no vector artifact |
| Installed mirror | `wasm/packages/cli/examples/12-pulse-context-mcp/**` | Generated by documentation synchronization; byte-identical at baseline |
| Version selection | `examples/12-pulse-context-mcp/corpus-version.ts` | Exact bundled version only; no latest/nearest substitution |
| App packaging | Example `package.json`, `host/prepare.cjs`, `host/artifacts.cjs` | `pulse build` then deterministic host/build/corpus manifest |
| Serving | Example `host/server.cjs`, `host/start.cjs` | Two loopback Node listeners: MCP facade and fixed JSON-RPC backend; readiness and shutdown |
| MCP adapter | `packages/mcp/src/{index,node,catalog,tools,authorization,bounded}.js` | Host-side JS, root and `/node` exports; no package guest lowerer |
| Resource admission | `wasm/packages/contracts/src/resources/embedded.js` | Internal explicit-byte manifest/catalogue; no filesystem discovery |
| Runtime resource access | `ctx.resources` in merged 08B | `byteLength`, `readU8`, `readU32LE`, `readF32LE`; not a general text-decoding/buffer API |

Corpus measured by the existing canonical builder:

| Field | Value |
| --- | --- |
| Version / status | `1.0.0-beta.9` / `candidate` |
| Schema | `pulse.context-corpus.v1` |
| Corpus hash | `3476598caee665b829e1b5a32c1263716e84cc2fa8ac4dc36137c07a264d2165` |
| Records / source files | 244 / 38 |
| Canonical JSON snapshot | 515,764 bytes of 524,288 allowed; 8,524 bytes remain |
| Generated TS module | 516,102 bytes; not a Wasm or vector size |
| Record budget | 244 of 256; 12 records remain |

The current README's prose still says 220 records. The generated source and
fresh inventory above are authoritative for this baseline. Correct public
guidance through its normal owner during the rebuild; this evidence task does
not rewrite the existing application documentation or silently expand budgets.

## Tool behavior to preserve or explicitly revise

| Tool | Current contract |
| --- | --- |
| `pulse.start` | Four goals (`json-api`, `schema-api`, `fetch-api`, `router-api`); Node Native/JS starter selections; exact dependency versions and cited source files; no execution |
| `pulse.search` | Lexical all-term matching; weighted ID/title/tags/content hits (8/6/4/1), score descending then stable ID; category and paired provider/target filtering; result offset |
| `pulse.read` | Exact record ID, Unicode-safe UTF-16 continuation offsets, full-record hashes and source citations |
| `pulse.example` | Four maintained starter IDs, exact available file IDs and record pagination |
| `pulse.explain_diagnostic` | Exact public diagnostic, evidence/remediation and suggested local checks; unknown version/code is explicit |

Common limits: 24 KiB application reply; 12 KiB raw / 16 KiB escaped read content;
256-byte query and eight terms; at most five results and 384-byte excerpts.
The server has no client filesystem/process authority, crawling, runtime index
refresh or mutable corpus. Pulse binary resources are distinct from the MCP
Resources protocol capability; adding `ctx.resources` does not advertise it.

## Protocol, client and qualification inventory

Runtime `packages/mcp/src/index.js` owns the currently implemented modern
`2026-07-28` profile and explicit `2025-06-18` compatibility option. These are
repository contracts, not a claim about the latest external specification.
The early `wasm/test/mcp/profile.json` labels itself design/reference proof and
says legacy reject; it is not the complete current runtime capability matrix.

| Evidence owner | Current scope | What must be re-proven |
| --- | --- | --- |
| `mcp-http`, `mcp-compatibility`, `mcp-tools`, `mcp-authorization` | Unit/release protocol, framing, projection and admission tests | Native direct dispatch, explicit supported profiles, bounded errors, public-host admission |
| `pulse-context-corpus`, `pulse-context-application`, `pulse-context-host` | Unit/release immutable corpus, JS app and built-only loopback lifecycle | Native corpus access, all tools, semantic parity and new lifecycle |
| `docs-example-12-pulse-context-mcp` | CLI/release executable JS example | Canonical Fastly Native workflow |
| `binary-resource-admission`, `binary-resource-execution` | Unit/release and conformance/release respectively | Actual workload and 08C installed/provider/report gaps |
| `mcp-package`, `mcp-http-sdk`, `mcp-tools-sdk`, `mcp-authorization-sdk`, `mcp-wire-proof` | Separately registered external checks, not automatically in release profile | Exact new package/transport and actual client behavior |
| `mcp-codex`, `mcp-claude` | Separate external client checks | Native endpoint compatibility; do not inherit Node-host evidence |
| `mcp-installed` | Mandatory separate installed-feature gate | New exact CLI example/tarballs and source-free Native closure |

Pinned client fixtures: official client/server 2.2.0 and Node adapter 2.1.0;
Codex CLI 0.160.1; Claude Code 2.1.292. Lockfiles live in the `reference`,
`codex-reference` and `claude-reference` directories under `wasm/test/mcp`.
Compatibility remains specific to the tested versions and configured profile.

Current MCP is stateless JSON HTTP: no SSE output, sessions, resumption, stdio,
Prompts or Resources. The context host lowers adapter limits to 32 KiB request,
128 KiB response and five seconds, rejects supplied Origins, and binds loopback.
The generic adapter has optional OAuth resource-server admission and a separate
fixed-backend credential. Public Fastly policy and removing that backend hop
require an explicit design in 01; copying loopback assumptions is insufficient.

## Vector provenance disposition

No original context-MCP `vector.bin`, mapping, model/tokenizer or embedding
generator was recovered. Searches covered:

1. All filenames in the pinned tracked tree; exact vector/embedding binary names
   are empty in `baseline.json`.
2. Content in the context example, MCP package, scripts and B10-07/08 evidence;
   matching lines are retained in the inventory.
3. Available local Git refs for `**/*vector*.bin` and `**/*embedding*`; no history
   matches. This is not a claim about deleted/unfetched remote refs or other repos.
4. Available workspace filenames matching vector binaries or embedding names,
   excluding dependencies, Git metadata and seal scratch; no recovered input.

The concrete `vector()` in `docs/internal/b10-07/proof.cjs` creates **1,040 bytes**:
a 16-byte `PVB1` header and 32 rows × 8 float32 cells using a formula. Its nearest-row
oracle is synthetic. The separate 0–256 KiB representation sweep and 08B's dense
1,048,577-byte fixture are also generated proof data. None is the recalled
roughly 700 KiB–1 MiB MCP corpus. That estimate remains unverified.

Disposition: reconstruct a new canonical MCP workload in 01–03 unless the
original is supplied/recovered. Record the new provenance explicitly; never
label it the recovered original. Do not invent dimensions or choose an encoder
from the remembered byte size. Prior user conversations, Library contents,
unfetched history and unrelated repositories were not exhaustively searched.

## Release and generation ownership

`wasm/scripts/sync-doc-snippets.cjs` invokes corpus synchronization and maintains
installed mirrors. `scripts/release-source-checks.cjs` validates source/docs
without mutation; `scripts/validate-release.cjs` owns clean candidate checks,
compilation, provider reality, aggregate and separate installed acceptance.
`scripts/pack-release.cjs` owns package construction. `mcp-installed` uses
`wasm/test/mcp/package-context.cjs` and the standard release pack, not a custom
MCP tarball path. `scripts/release-feature-acceptance.cjs` requires its separate
installed receipt. Recovery/checkpoint identities and evidence shards are owned
by the corresponding release scripts recorded in the inventory.

There is **no vector build/check receipt or vector seal gate** in this baseline.
Proposed 09 behavior: generate before candidate freeze; independently reconstruct
and compare during seal; bind exact corpus/encoder/tool/config/output identities;
fail stale/missing inputs; package those bytes and never regenerate after seal.
Do not turn expensive model generation into an implicit docs-sync side effect.
The final integration must preserve source-cleanliness and recovery authority.

## Decisions for B10-MCP-01

1. Define what vector retrieval means and how text queries get compatible vectors.
   Pin normalization, chunking, encoder/tokenizer/model, dimensions, arithmetic,
   ranking/ties and quality examples. Hosted embedding identity alone cannot
   prove source-to-vector reproducibility. A lexical index is not silently a
   semantic embedding replacement.
2. Define text and metadata representation as well as vector storage. Scalar
   byte access alone does not establish bounded Native UTF-8 text retrieval.
   Resolve current corpus capacity and a finite growth envelope explicitly.
3. Define direct MCP transport/package ownership and public Fastly admission,
   preserving supported existing host APIs while selecting the new profile matrix.
4. Specify a realistic bounded computation for 02. Current pure loops allow
   1,024 iterations and 65,536 combined nested iterations. A 1 MiB float32 scan
   has 262,144 cells before query encoding/top-k/text work. Multiple loops or
   windowing are not automatically a whole-request proof. No limit change in 00.
5. Decide reproducibility scope and toolchain identity, binary schema and mapping,
   release-generation ownership and failure behavior. No clocks, locale ordering,
   absolute paths or implicit network/model drift in canonical outputs.

01 produces the concrete contract; 02 proves the risky execution path before
03/06 commit to the builder and retrieval implementation. The exact remaining
acceptance and model/effort map is in [ACCEPTANCE.md](./ACCEPTANCE.md).
Local validation and setup limitations are recorded in [VALIDATION.md](./VALIDATION.md).
