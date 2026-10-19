# Deterministic build and candidate seal contract

This is the selected workflow for 03/07/09. No release command or gate is changed
in 01. Build ownership follows existing scripts and the release controller;
generation is not performed by the server, a package install hook or docs sync.

## Canonical inputs and outputs

03 adds `scripts/pulse-context-build.cjs` as the explicit generation/check owner,
reusing canonical extraction from `scripts/pulse-context-corpus.cjs` and its
allowlist. Proposed modes are `--write` (author operation before freeze) and
`--check` (read-only independent reconstruction into a temporary directory).
Both run offline from explicit source bytes. No runtime crawling, model download,
clock, RNG, host locale, home-directory cache, absolute paths or environment-based
algorithm selection. The current corpus generator and installed mirror remain
consistent; do not create a second independent extraction authority.

The output closure includes canonical corpus identity/data, three binary files,
`context-manifest.json`, and generated scalar filter/tool metadata derived from
that same extraction. Example/installed mirror paths must be explicit outputs
with ownership and stale checks. Do not include a second full text corpus in the
Native Wasm through an accidental `context-corpus.ts` import. Source compatibility
for the old JS app may retain that module as a separate checked output until
migration. No network/LLM is part of this encoder, so source-to-vector bitwise
reconstruction is the claim and is feasible to test without a model cache.

Manifest schema `pulse.context-build-manifest.v1` uses recursively sorted keys,
UTF-8 compact JSON plus one final LF. Its identity is SHA-256 of those exact
bytes, held externally in receipts/compiled metadata (no self-referential hash).
The manifest contains:

| Identity | Required fields |
| --- | --- |
| Source | Exact Pulse version/status, corpus schema/hash, sorted source path/selection/content hashes and original citation blob identities |
| Algorithm | Encoder/version, normalization, weighting, chunk/row rule, numeric representation, binary formats, sorted row IDs and dictionary hash |
| Producer | Generator and transitive source hashes, explicit config/allowlist hashes, lockfile hash, exact Node/tool versions and package versions used by the producer |
| Outputs | Project-relative paths, byte lengths and SHA-256 of each file; rows, dimension, nonzeros, raw/serialized budget values and generated code identities |
| Compatibility | Application version, MCP profile selection and exact schema/catalog identities required to interpret the outputs |

No directory mtimes, creation date, branch name, mutable URL content or checkout
path is canonical output. The candidate commit/tree belongs in the external
seal receipt, not in a generated tracked manifest whose inclusion would change
that very tree. Builder hashes likewise exclude generated outputs and receipts;
they cover an explicit finite transitive input list, not a recursive repository
hash. No circular manifest/output dependency.

Reproducibility is byte equality for identical input identities with the pinned
producer. 03 must repeat in two unrelated clean source roots, without a shared
output cache, with reordered filesystem enumeration and varied locale/timezone.
Cross-version Node equivalence is not assumed: either prove each claimed producer
version or pin one. Record the exact tool in the receipt; don't float on whichever
Node happens to run. Integer encoding and canonical ordering remove the need
for BLAS, float32, native model or random-seed exceptions.

## Workflow and failure semantics

1. **Author/build:** resolve the candidate version/status and docs/canonical source
   changes first. Run explicit generation, inspect changed data/manifest and
   commit the complete closure. Ordinary build validates present identities and
   fails with the explicit generation command when missing/stale. It cannot
   repair tracked outputs implicitly. Docs sync may copy/check emitted files;
   it must not start vector generation or a model job.
2. **Freeze:** release candidate creation requires a clean source tree and records
   the exact commit/tree, inputs and output manifest hash. Any later source,
   version, algorithm, data, lockfile or config change requires a new candidate.
3. **Seal freshness:** the source-check stage runs the independent `--check`
   reconstruction before packaging. Compare exact outputs, manifest and generated
   code byte-for-byte; fail on missing, extra, stale, corrupt or mixed inputs.
   An error is a failed gate, not a warning or an auto-fix. The check must leave
   the candidate tree unchanged even on failure.
4. **Package/install:** pack the verified files. Compare tarball inventory, sizes
   and hashes to the manifest. Source-free exact installed consumers must rebuild
   the Native application and serve cited results with repository paths deleted.
   This proves packaged closure; it does not rebuild documentation from a
   nonexistent repository or silently download missing inputs.
5. **Seal evidence/recovery:** require the vector freshness receipt and installed
   closure receipt in the complete release selection. Bind source tree, producer,
   manifest/output hashes, packed tarball hashes and actual selected task IDs.
   Missing or invalid checkpoint identity reruns the gate under the existing
   controller; expiry and immutable-candidate checks still apply. A stale green
   report cannot authorize reuse. No manual combination of historical passes.
6. **Promote:** use the exact sealed tarballs/data. No post-seal corpus refresh,
   model rerun, manifest rewrite or vector regeneration during publish/deploy.
   A desired data update is a new candidate, not a mutable resource at an URL.

Owners: source freshness in `scripts/release-source-checks.cjs`; task/stage
selection in `scripts/validate-release.cjs` and existing feature acceptance;
packed inventory in `scripts/pack-release.cjs`; receipt/checkpoint/evidence
closure in the existing release recovery and evidence-bundle modules. 09 must
use their actual validated data models and preserve current gates, rather than
adding a separate boolean “vector passed” outside the controller.

Fast PR coverage is deterministic generation/check, format/negative tests and a
small Native proof. Full release retains exact packed/installed checks, the
separate `mcp-installed` mandatory gate, complete resource matrix, pinned clients
and real Fastly/Viceroy evidence. Fast success is never substituted for the full
selection. Promotion/deployment remain human release actions.

## Required rejection/recovery experiments

03/09 must change each of these independently and observe a failure or a new
valid receipt, with no candidate write: canonical source byte, allowlist,
version/status, generator source, normalization/weighting, config/budgets,
lockfile/producer identity, vector byte, text byte, metadata row, manifest hash,
missing file and unexpected output. Include malformed UTF-8, invalid coordinate,
truncated section and mixed-manifest files from the format tests.

Exercise recovery with a missing receipt, stale tree/hash, expired checkpoint,
producer change and tampered packaged bytes. A valid same-candidate resume may
reuse only the existing controller's verified checkpoint. Preserve failed runs
and terminal task coverage. Keep #418's unexplained intermittent
`REPORT_ARTIFACT_HASH` uncertainty visible; a later passing run is not a fix.

08/#412 reporting must distinguish raw resource bytes, serialized envelope,
unique physical backing, logical aliases, Wasm data/artifact bytes, copies and
per-instance/process peak memory. Equal aliases can deduplicate physical data
without changing logical file/binding admission. Unreachable data must not be
embedded. The deterministic vector contract does not relax generic zero-length,
unaligned, foreign/stale handle, lifetime, no-escape or >4 MiB repeated-read tests.
