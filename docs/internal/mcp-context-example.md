# Context MCP example maintenance

Repository-only notes, reviewed 2026-10-21. The public walkthrough is
[`examples/12-pulse-context-mcp/README.md`](../../../examples/12-pulse-context-mcp/README.md).
This page records implementation and compatibility details, not additional public capabilities.

## Corpus and response bounds

`pulse.search` advertises encoder `pulse.context-sparse-lexical.v1` in
`meta.encoder`. Queries accept 1–256 ASCII bytes and one to eight tokens before
deduplication (at most 64 bytes each). Only ASCII letters are case-folded; maximal
`[a-z0-9_]` runs are tokens. All distinct terms must match. Scores sum field
presence weights: ID 8, title 6, tags 4, content 1. Equal scores sort by ASCII ID.
Category and exact provider/target filters apply before scoring. `limit` is 1–5;
`offset` may equal the complete match count for an empty terminal page.

Excerpts preserve the leading scalar-aligned 384 UTF-8 bytes, including whitespace,
with `excerptTruncated` when more text exists. The complete MCP tool result,
including both content copies and citations, must fit 24 KiB; oversized pages
return `response-too-large` without partial results. Lower the limit or use
`pulse.read`. Search uses the same generated finite citation projection as read,
plus immutable vector/text resources and a request-owned numeric heap. This is
sparse lexical retrieval, not semantic embeddings: no synonyms, stemming,
non-ASCII query language or learned model. The reconstructed corpus is explicit;
it does not recover the unavailable original vector workload. Frozen relevance
cases and whole-request cost gates cover the admitted workload, not arbitrary
future corpus growth. Source changes require regeneration and fresh qualification.

The computations use complete existing output schemas. Cited content is read
from `context.text`; generated code contains bounded metadata and no full-text
corpus module. Reads retain UTF-16 offsets and scalar-aligned UTF-8 pages, counting
both raw bytes and JSON escaping. Examples return whole files in corpus order,
with explicit pagination or `record-requires-read`; diagnostics retain complete
remediation, related contracts and local-check arrays. The complete tool result remains capped
at 24 KiB, including metadata and both text/structured copies; the complete MCP
protocol reply remains capped at 128 KiB. Compared with v1, read pages can end
earlier and example pages can contain fewer files to fit that whole-result bound.
Their explicit continuation fields retain the original content and offsets.
Oversized results produce an explicit error, never silent truncation. Native
reachability selects immutable resource backings and deduplicates equal bytes.
Report artifact bytes, selected backing bytes and committed linear memory
separately; unavailable peak/live allocation and process memory remain unknown.

## Pinned client evidence and compatibility

| Client | Protocol configuration | Qualified local transport |
| --- | --- | --- |
| Official SDK 2.2.0 | Default `2026-07-28` | Native Fastly HTTP |
| Claude Code 2.1.292 | Default `2026-07-28` | Native Fastly HTTP |
| Official SDK 2.2.0 | Explicit `2025-06-18` | Native Fastly HTTP |
| Codex 0.160.1 | Explicit `2025-06-18` | Native Fastly HTTP |

The shipped application is modern-only. For the compatibility profile, explicitly
add `legacyProtocol: '2025-06-18'` to the existing `mcp({...})` declaration and
rebuild. That produces a different artifact identity. `--codex` belongs only to
the root v1 host; it is not a compiled-application CLI flag. Modern admission
never silently falls back. These are pinned local transport/tool checks, not
inference, sessions, SSE, MCP Resources, Prompts or deployed-service qualification.

When moving a v1 caller, rename `pulse.explain_diagnostic` to `pulse.diagnostic`,
select the application endpoint, and follow returned `nextOffset` values rather
than assuming identical page sizes or search ranking. Check application version,
corpus hash, exact package version and tool `status` on every response. Preserve
selection and version across pages; citations and hashes identify full source
records even when the returned page is shorter.

## Retained compatibility fixture

The example root still contains the v1 JavaScript host and its independent tests.
It is retained as a compatibility fixture and differential oracle, not as the
public onboarding path. From the example root, `npm install`, `npm run build`,
and `npm start` prepare and serve it on `http://127.0.0.1:8788/mcp`.
`npm test` runs its two JSON-RPC cases. `npm run dev` exposes its underlying
JSON-RPC application, not its MCP host. Its diagnostic tool is
`pulse.explain_diagnostic`; the compiled application uses `pulse.diagnostic`.
`npm start -- --codex` applies only to this root host. The default endpoint in
`client/request.cjs` is also this root host, so compiled-app commands must pass
`--url http://127.0.0.1:8787/mcp` explicitly.

The root implementation remains covered by the context application/host gates;
removing its source or adapter exports is a separate compatibility decision.

## Maintaining the snapshot

From a source checkout, resolve source/version changes and synchronize documentation,
then explicitly rebuild the immutable data with **Node 24.18.0** (the release-pinned
producer). No model, network service or output cache participates:

```bash
npm run docs:sync
npm run context:build
npm run docs:sync
npm run context:check
node wasm/scripts/run-wasm-tests.cjs --task pulse-context-build --task pulse-context-corpus --task pulse-context-application --task pulse-context-host --no-report
```

The corpus extractor remains `scripts/pulse-context-corpus.cjs`, with the explicit
allowlist in `scripts/pulse-context-inputs.json`. `context:build` owns the generated
`context-corpus.ts`, `context-data/`, the migrated application config/source/schema
outputs and their byte-identical installed CLI mirrors.
Its `context-manifest.json` binds source selections, immutable citation blobs,
producer/config/lockfile hashes, row IDs, vocabulary and every generated payload.
The manifest's own SHA-256 belongs in the external check receipt, avoiding a
self-reference. Edit canonical inputs, never the emitted files.

The new `vector.bin` is **sparse lexical data**, not semantic embeddings or the
unrecovered historical vector. It uses exact ASCII tokens and integer field
presence weights. `text.bin` retains cited UTF-8 content; `metadata.bin` maps rows
to their citations. Scalar filter/tool tables contain no full cited text. Limits
are 512 records, 4,096 terms, 1,024 nonzeros per row, 24 KiB content per record and
2 MiB canonical corpus, together with explicit raw and serialized resource byte
budgets. Every limit applies simultaneously; overflow fails without truncation.

`context:check` reconstructs in a fresh temporary directory and compares all 30
outputs. It fails on missing, stale, corrupt, mixed or unexpected data and never
repairs the checkout. The receipt names the actual verifier Node version;
verification on another Node version proves only that invocation's byte equality.
Generation requires the pinned producer. Repository `build` and `docs:check` run
the read-only check. `docs:sync` may refresh the legacy corpus and copy emitted
files, but never builds vectors; finish explicit generation before committing.

The existing Node JavaScript host continues using its v1 corpus module. The compiled
`application/` project implements all five tools through compiled computation.
Installed resource acceptance and a candidate-bound seal receipt remain separate;
see the registered MCP installed, local-host and release acceptance gates.

The recovered application config template is
`application/.pulse/config.template.ts`. `scripts/pulse-context-start.json` owns
finite starter metadata; `scripts/pulse-context-tools.json` owns the additional
tool metadata and `scripts/pulse-context-tools.cjs` owns their finite projection.
`application/src/scalars.ts` owns shared pure byte-cost helpers.
`application/src/*.template.ts` owns the call and
computation shape. The context builder generates the resource manifest, inlines
it into the new config, binds protocol budgets and exact server version, copies
the canonical schema and materializes the eight finite starter plans. Edit these
canonical inputs and run the pinned build/check sequence; generated edits are
rejected by freshness checks. `pulse-context-start` adds three-target real MCP
execution against the existing host's complete responses as an independent oracle.
