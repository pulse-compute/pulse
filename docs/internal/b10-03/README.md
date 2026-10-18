# B10-03 — Generated context data and fast schema selection

Issue [#376](https://github.com/pulse-compute/pulse/issues/376). Target `latest`.
Base: `ded107a894d8c0d8fdb45b5d11f940d424fa9ddc` (merged B10-02).
Change class: hardening. Protected path: maintenance-control-plane.

The reproduced selection asymmetry was real: a documentation change and its
canonical generated context corpus selected `schema-codecs-smoke`, while the
identical installed CLI mirror selected full `schema-codecs`. The latter matched
the broad `cli-and-diagnostics` owner. The existing installed-docs exception did
not include generated example data.

## Change and acceptance

`scripts/maintainer-fast-validation.cjs` now exempts exactly
`wasm/packages/cli/examples/12-pulse-context-mcp/context-corpus.ts` from that full
schema reason, and only when all matched trusted-base rules are documentation
or CLI owners. No arbitrary CLI example, directory, suffix or generated-file
comment gets this treatment. CLI command/guard selection remains intact.

| Changed paths | Before | After |
| --- | --- | --- |
| `docs/architecture/current-contracts.md` | Schema smoke | Schema smoke |
| Canonical `examples/12-pulse-context-mcp/context-corpus.ts` | Schema smoke | Schema smoke |
| Installed `wasm/packages/cli/examples/12-pulse-context-mcp/context-corpus.ts` | Full schema | Schema smoke |
| All three above | Full schema | Schema smoke |
| Those paths plus a compiler, provider, schema or CLI execution owner | Full schema | Full schema |
| Executable CLI example neighbor, lookalike path or unknown-impact path | Full schema | Full schema |

Selection still unions the complete diff. An additional trusted-base owner on
the exact mirror retains its schema reason; an unmatched path remains unknown
and conservative. Base policy/matching still comes from `withTrustedPolicy`.
The selector does not run generators or issue an integrity receipt. A smoke
selection becomes passing PR evidence only alongside the existing required
documentation integrity checks.

`results.json` records the pinned before/after path selections and inspected
owner hashes. This establishes routing correctness. There is no paired hosted
runtime measurement of an affected corpus-only PR, and no hosted speedup claim.
This implementation PR also touches CI tests/control-plane files, so its whole
diff is not a corpus-only timing experiment. Historical full-schema duration
cannot simply be subtracted from another candidate's smoke duration.

## Dependency graph and integrity owners

| Step | Canonical owner and inputs | Output / proof |
| --- | --- | --- |
| Select source material | `scripts/pulse-context-inputs.json`; ten documentation sources, four example projects and twelve selected package descriptors | Explicit allowlist and section/applicability declarations |
| Build corpus | `scripts/pulse-context-corpus.cjs`; selected docs/example bytes, `release/pulse-release-manifest.json`, CLI command and diagnostic catalogs | 235 records from 38 source files at this base; record hashes, full-source hashes/blob identities, version, applicability, size bounds and snapshot hash |
| Emit data module | `synchronizeContextCorpus` / `render` | Exact canonical `examples/12-pulse-context-mcp/context-corpus.ts`; check mode rejects any divergence from regeneration |
| Copy installed examples | `wasm/scripts/sync-reference-docs.cjs` / `buildExpectedFiles` | Byte-for-byte CLI example mirror; check mode rejects missing, changed or extra generated outputs |
| Check ordinary PR | `wasm/scripts/sync-doc-snippets.cjs --check`, called by `scripts/documentation-preview.cjs` | Corpus source consistency followed by reference/mirror consistency, before the single validated preview build can succeed |
| Qualify behavior | Registry corpus/application/host tasks, executable context example and `mcp-installed` gate | Existing unit/release, example and installed-consumer responsibilities remain unchanged |

The generator reads example source as data; it does not execute examples.
It evaluates only its explicitly selected first-party command/diagnostic
catalogs at build time. The application consumes the emitted module and does
not need the repository or generator at runtime.

`pulse-context-application` and `pulse-context-host` are already absent from
`FAST_TASKS`. This change does not defer them again or remove them from unit,
main, release or installed qualification. No registry, generator, manifest,
workflow, preview sealing, checkpoint or acceptance change was needed.
CI9-03's one validated preview build stays intact.

## Regression evidence

`wasm/test/ci/assert-fast-validation.cjs` now covers canonical-only, mirror-only
and combined legitimate changes; executable neighbors and lookalike paths;
mixed compiler/provider/schema/CLI/generator/unknown paths; trusted matching
and additional trusted-base ownership. Full selection continues to replace,
rather than duplicate, schema smoke.

`wasm/test/docs/assert-documentation-preview.cjs` invokes the existing
generator/reference check-mode functions
with scoped read overrides, restored in `finally`; it never edits checkout
files. These fixtures establish that a changed canonical document invalidates
the corpus even outside its selected sections, a regenerated corpus requires
its installed mirror to be updated, synchronized outputs pass, a manual mirror
code edit fails, and editing both copies cannot forge generated output. The
preview test runs after dependencies are installed; selection contract tests
remain dependency-free. Its orchestration regression requires the actual
generated-file check and rejects preview success after a generated check failure.

Focused reproduction commands:

```sh
node wasm/test/ci/assert-fast-validation.cjs
node wasm/test/ci/assert-validation-routing.cjs
node wasm/test/ci/assert-portable-validation.cjs
node wasm/test/docs/assert-documentation-preview.cjs
node scripts/pulse-context-corpus.cjs --check
```

Required validation also includes `maintainer:check`, `docs:check`,
`documentation-release.cjs` and the registered `unit` profile. The testing guide
is updated through its canonical source and synchronized installed copy.
Focused development evidence is not a new release qualification.

## Remaining friction and limits

The corpus binds whole-source hashes and line ranges as well as selected
content. A change outside a selected section can therefore legitimately
regenerate data. Release/package metadata and command/diagnostic changes also
propagate through the corpus. Those inputs often have their own sensitive
owners, and this exception does not suppress their full-schema selection.

Every ordinary PR still pays for complete source/generated consistency and the
single validated documentation preview. Node-floor and other selected tasks
also remain. This ticket removes one accidental full-schema trigger; it does
not claim to eliminate documentation work, repeated regeneration or all expensive
PR execution. Changing those boundaries requires separate evidence and scope.
