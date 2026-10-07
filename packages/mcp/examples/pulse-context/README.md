# Pulse context corpus

PMCP-02 prepares the immutable data and PMCP-03 adds Pulse's read-only context application.
This directory is a private application preparation area, excluded from the
generic MCP package tarball. Its ordinary Pulse Entities app selects Node
JavaScript explicitly. PMCP-04 adds the standalone MCP host composition.
PMCP-05 owns the public example replacement.

The canonical selection owner is `scripts/pulse-context-inputs.json`. The
build-time generator `scripts/pulse-context-corpus.cjs` reads only its explicit
public documentation sections, released package/provider metadata, public CLI
command/diagnostic catalogs and four maintained examples. It does not crawl a
repository, documentation site or external index. AGENTS instructions, task
reports, maintainer instructions, historical proofs and credentials are not
corpus inputs. Example READMEs contribute only their workflow sections.

```sh
node scripts/pulse-context-corpus.cjs --write
node scripts/pulse-context-corpus.cjs --check
node wasm/scripts/run-wasm-tests.cjs --task pulse-context-corpus --no-report
```

`context-corpus.ts` is generated. Every record has a stable selected ID, title,
category/tags, applicable provider/target pairs, exact Pulse version and snapshot
status, source path/selection/line range where applicable, source SHA-256 and
content SHA-256. Source URLs address immutable Git blobs by their content hash;
they describe exact bytes without a mutable `latest` citation, timestamp or
checkout/commit dependency. A blob becomes available in GitHub when its source
is committed there. Metadata projections identify their canonical catalog
entry instead of claiming a Markdown line range.

The `pulse.context-corpus.v1` snapshot includes a corpus hash, selection hash,
catalog schema versions and a deduplicated input-source index. `corpusHash` is
SHA-256 of the canonical, sorted-key JSON of every other snapshot field, rendered
with two-space indentation and no trailing newline. IDs and input-source paths
use ordinal sorting; the output contains no generation time or local paths.
Snapshot status is explicitly `candidate`, independent of the npm publication
state of the referenced Pulse version. Generation does not promote a release.

The 219-record initial snapshot describes `1.0.0-beta.6`: 29 selected public
guide/contract sections, 11 package records, three provider records, seven
commands, 144 public diagnostics, and 25 example file/workflow records. It
contains roughly 155 KiB of content; its largest record is about 7 KiB. Limits
are 256 records, 24 KiB of UTF-8 content per record and 512 KiB of snapshot JSON.
Oversized sections must be divided by stable selected headings rather than
silently truncated. These corpus limits precede PMCP-03's response limits.

The generated module recursively freezes its data and imports no runtime
dependency. `corpus-version.ts` selects only the exact snapshot version:

```ts
import { selectContextCorpus } from './corpus-version.js';

const selected = selectContextCorpus('1.0.0-beta.6');
// { status: 'ok', corpus: ... }
const unavailable = selectContextCorpus('latest');
// { status: 'version-mismatch', requestedVersion: 'latest',
//   availableVersion: '1.0.0-beta.6' }
```

The application consumes only the emitted data and version selector. It never
loads the generator, source repository or CLI catalogs at runtime. Unknown
versions and IDs return explicit statuses in the application.
Described command side effects and example configuration are context, not
server permission to execute commands or write client files. The selected
examples retain their exact Node Native profiles; the Node JavaScript guide
does not convert those examples implicitly.

When canonical inputs change, regenerate the snapshot in the same PR. Missing
files/headings, duplicate IDs, out-of-budget content, mismatched example versions
or profile annotations, and stale generated output fail the focused unit check.
No full release seal or live MCP client is needed for corpus regeneration.

## Context application

With this checkout's exact candidate dependencies/tooling, the ordinary app workflow is
`npm run doctor`, `npm test`, `npm run inspect` and `npm run build`. The private
app needs no MCP adapter import; its emitted Entities catalog and schema registry
are consumed by the host added in PMCP-04. `npm run dev -- --no-watch` serves the
JSON-RPC app on loopback for local development, with outbound fetch disabled.

The new JavaScript Entities target-propagation correction belongs to this
candidate; support by the already published beta.6 CLI is not claimed. The
private dependency declarations identify the candidate graph. PMCP-06 selects
the next unpublished synchronized release version, and PMCP-07 qualifies its
installed journey.

Every operation requires `version: '1.0.0-beta.6'`. Every application reply,
including lookup/selection errors, carries the exact Pulse version, candidate
status, corpus schema/hash, requested version and application contract version.
Schema/protocol admission failures use the existing JSON-RPC error boundary.

| Operation | Inputs and result |
| --- | --- |
| `pulse.start` | `goal` is `json-api`, `schema-api`, `fetch-api` or `router-api`; `provider: 'node'` and explicit `target: 'native'` or `'javascript'`. Returns imports, exact dependencies, configuration, contract citations, example ID, local command sequence and unresolved choices. |
| `pulse.search` | `query`, optional `category`, paired `provider`/`target`, `limit` and result `offset`. Matches all whitespace-separated terms against ID/title/tags/content, weighted 8/6/4/1; ties use ordinal ID order. Returns short excerpts, citations and total match count. |
| `pulse.read` | One exact corpus `id`, optional paired applicability filter and content `offset`. Returns section/file content with its complete source/content hashes. |
| `pulse.example` | A maintained example `id`, optional `files` array of exact corpus IDs from `availableIds`, optional paired filter and record `offset`. Returns whole maintained file/workflow records; never resolves paths. |
| `pulse.explain_diagnostic` | One exact public `code`. Returns source evidence, summary/remediation, related contracts and a suggested local check. An entry without a textual canonical summary explicitly returns `summaryAvailable: false`. |

Application replies are at most 24 KiB of serialized UTF-8 JSON. Search accepts
at most 256 UTF-8 query bytes/eight terms and returns at most five excerpts of
384 bytes. Reads return at most 12 KiB raw content and 16 KiB JSON-escaped content
per page. `nextOffset` is a UTF-16 content position, preserving Unicode code-point
boundaries. Search offsets index ranked results; example offsets index the
selected record list, with at most five records per reply. Reuse the same version,
query and selection with the returned offset. `truncated` and `nextOffset` make
continuation explicit; source/content hashes always identify the complete record.
If a whole example file cannot fit, use its ID with `pulse.read`.

Starter configuration is derived from the selected maintained example, including
its schema limits and harness path. A JavaScript plan explicitly reports the
`local.target` change; the example's original Native applicability is preserved.
Other starter providers are unsupported in v1, even when their broader contracts
are searchable. The client chooses its directory, copies the selected example
files/configuration and runs commands locally. These steps have not been executed
by a tool call. There is no filesystem/process/config/fetch effect in the handlers.

Example application request:

```json
{"jsonrpc":"2.0","id":1,"method":"pulse.start","params":{"version":"1.0.0-beta.6","goal":"schema-api","provider":"node","target":"javascript"}}
```

Focused app qualification (one build, typed schemas, all bundled records/codes,
real Node HTTP execution and generic MCP catalog projection):

```sh
node wasm/scripts/run-wasm-tests.cjs --task pulse-context-application --no-report
```

No standalone MCP startup script, remote deployment or public proxy-example
replacement is part of PMCP-03.
