# Pulse context corpus

PMCP-02 prepares the immutable data for Pulse's read-only context application.
This directory is a private application preparation area, excluded from the
generic MCP package tarball. It has no listener or runnable server yet; PMCP-03
adds the Entities operations and PMCP-04 adds the standalone host composition.
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
IDs, lexical search, starter plans and bounded tool responses belong to PMCP-03.
Described command side effects and example configuration are context, not
server permission to execute commands or write client files. The selected
examples retain their exact Node Native profiles; the Node JavaScript guide
does not convert those examples implicitly.

When canonical inputs change, regenerate the snapshot in the same PR. Missing
files/headings, duplicate IDs, out-of-budget content, mismatched example versions
or profile annotations, and stale generated output fail the focused unit check.
No full release seal or live MCP client is needed for corpus regeneration.
