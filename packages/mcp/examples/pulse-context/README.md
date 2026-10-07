# Pulse context MCP application

PMCP-02 prepares the immutable data, PMCP-03 adds Pulse's read-only context application,
and PMCP-04 supplies its standalone host.
This directory is a private application preparation area, excluded from the
generic MCP package tarball. Its ordinary Pulse Entities app selects Node
JavaScript explicitly. The standalone host uses public host integrations.
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
are consumed by the standalone host. `npm run dev -- --no-watch` serves the
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

## Standalone MCP host

In the exact candidate environment described above:

```sh
npm run build
npm start
# Optional: choose an ephemeral MCP port, or enable the pinned Codex framing.
npm start -- --port 0
npm start -- --codex
```

`build` runs the ordinary Pulse build, then `host/prepare.cjs` writes
`dist-node-javascript/pulse-context-host.json`. This small deterministic identity
file binds the emitted build/source-package/plan, entry, package metadata, module
bytes, schemas/codecs, Entities catalog and corpus metadata. It uses the existing
build's module digests and catalog digest. Preparation imports only the emitted
data module, never handlers. It is app packaging, not a release seal or checkpoint.

`start` runs `host/start.cjs` without the CLI, source project, configuration or
development server. Its runtime inputs are `host/`, the prepared build directory,
and the exact matching runtime dependencies. To move the build, copy those files
and supply the build directory explicitly:

```sh
node host/start.cjs --build-dir /absolute/path/to/trusted-build --port 8788
```

The host reads bounded local artifact data, validates its identity and uses only
`@pulse-compute/provider-node/server` and `@pulse-compute/mcp/node` for execution
and MCP admission. It never imports application handlers or compiler/private
runtime integrations. The Node launcher verifies the application closure and
starts it on `127.0.0.1` with an ephemeral port. One read-only `pulse.search` call
must confirm the exact corpus/version before the MCP listener becomes ready.
Discovery and all five tools use the catalog/schema snapshot from that build;
dispatch crosses the fixed HTTP boundary. Application outbound fetch is disabled.

| Boundary | Fixed host policy |
| --- | --- |
| MCP listener | `127.0.0.1:8788/mcp`; `--port 0` chooses an ephemeral port |
| Backend listener | `127.0.0.1`, ephemeral port; no client-selected destination |
| MCP request / response | 32 KiB / 128 KiB serialized JSON; nesting limit 32 |
| Application ingress / reply | 64 KiB ingress; PMCP-03's 24 KiB reply limit |
| Request budget | Five seconds, including MCP admission and backend dispatch |
| Admission | 16 concurrent requests / 64 connections per listener; 16 KiB Node headers |
| Shutdown | One-second MCP drain, then one-second backend drain; remaining work is interrupted |
| Origins | Every supplied Origin is rejected; no browser CORS integration |

Readiness is `GET` or `HEAD /_pulse/ready` on the MCP listener, with `no-store`
responses. A 200 response means both local listeners are ready; its JSON identifies
the build, host binding and corpus. Startup emits one JSON `ready` event containing
the MCP endpoint and those identities. Missing, changed or mismatched artifacts,
unsupported targets, failed identity probes and occupied MCP ports fail startup
without a ready event; an already-started backend is closed on failure.

SIGINT/SIGTERM withdraw readiness, stop admission, drain MCP work and close the
backend. A graceful stop exits zero; a forced drain or startup failure exits one.
The process owns signal handling; the reusable host integrations do not.
Launcher budgets revoke Pulse-owned asynchronous work and do not preempt
synchronous JavaScript. This host accepts no remote bind option. Remote deployment
requires the adapter's existing issuer/authentication and backend-protection
contract and remains a separate deployment task.

Modern `2026-07-28` framing is the default, including the qualified Claude client.
`--codex` explicitly enables PMCP-01A's bounded `2025-06-18` compatibility profile;
modern framing remains available. No Resources, Prompts or stdio transport is added.
The current private adapter version is `0.0.0`; these candidate dependencies are
not a registry install claim. PMCP-06/07 own release versioning and installed proof.

```sh
node wasm/scripts/run-wasm-tests.cjs --task pulse-context-host --no-report
```

The focused test builds once, copies the build/host/runtime package closure outside
the checkout without package symlinks, removes project sources and launches a clean
process. It covers discovery/five tools, framing, provenance, admission limits,
artifact disagreement, bind cleanup, interrupted startup/calls, deadlines and
shutdown. Copied workspace package bytes are development evidence; exact tarball
installation remains PMCP-07. No public proxy-example replacement occurs here.
