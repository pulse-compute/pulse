# B10-MCP-09A handoff

Issue #456; PR https://github.com/pulse-compute/pulse/pull/476.

## Source checkpoint

- Branch: `codex/b10-mcp-09a`, targeting `latest`.
- Base: `078eb12a82b3f9b0ef6ef78091933219fe64c2fb` (08 / #475 merged).
- Tested implementation and classification head: `74445503f238acd42680ea79fa6697772121844a`.
- Tested tree: `3022808b11d67f0dc38af10e037767edb03b4d7a`.
- Candidate was clean before and after the final source-check/build/pack run.
- The following handoff commit adds only this document and retained development evidence. These receipts identify the tested checkpoint above, not a fresh qualification of that later evidence commit.

## Implementation

Entry point: `release-readiness`. The user explicitly authorized implementation
of 09A, including the existing controller, pack inventory and evidence owners.
The new helper is enrolled in the existing release-system path rule; authority
and required-check policy are unchanged. Canonical maintainer documentation and
its generated installed mirror describe the resulting contract.

`release-source-checks.cjs` now emits v3 receipts containing
`pulse.release-context-freshness.v1`. It calls the merged builder in read-only
check mode, reconstructing in unrelated scratch without repairing candidate
bytes. The receipt retains the full manifest and its producer, configuration,
allowlist, lockfile, source and generated-output identities, the clean candidate
revision/tree, both complete canonical task selections, and all 39 files in the
shipped context application.

`pack-release.cjs` authenticates the current source-check receipt or performs an
independent reconstruction for standalone packing, even with `--skip-build`.
The CLI archive must match the complete verified inventory. The package manifest
binds that freshness digest alongside all 20 tarballs.

The existing controller requires the complete installed-feature runner, the
`mcp-installed` summary receipt, CLI/MCP package membership and identical installed
tarball hashes. Before passing it verifies the retained source receipt, actual
runner bytes, all packed tarballs and context archive contents. Evidence
aggregation repeats retained-byte verification and carries the source receipt,
package manifest and feature runner into the bundle. It never reconstructs or
regenerates context after sealing. Legacy v1 documentation receipt verification
remains historical; new package qualification requires v3 source checks.

## Completed development validation

The final focused commands use Node 24.18.0, with lockfile-pinned dependencies
installed using `--frozen-lockfile --ignore-scripts --offline` and pnpm 12.4.2.

- Source checks, TypeScript workspace build and real pnpm pack: passed; 20 packages,
  39 context application files, 30 generated canonical/mirror outputs compared.
  See `receipts/source-checks.json`, `receipts/pack-check.json`,
  `receipts/pack-manifest.json` and `receipts/pack.log`.
- Registered tasks `release-feature-acceptance`, `release-evidence-authority`,
  `release-runtime-policy`, `release-seal-lifecycle`: terminal pass, 4/4 complete.
  See `receipts/release-tests.json` and `receipts/release-tests.log`.
- The freshness test is enrolled through `release-feature-acceptance`; it has
  26 rejection cases, including candidate/input/output/inventory/selection and
  installed-package mismatches. Candidate snapshots prove rejected reconstruction
  does not change files. Controller fixtures cover success, missing/failed
  installed execution, corrupt tarballs and reduced selection.
- Direct PR-qualification and consumption contract tests: passed.
- `maintainer:check`, `docs:check`, `documentation-release.cjs`,
  `publication:check`, context check and `git diff --check`: passed.
- `release:preflight`: check passed, 11 proven / 10 pending / 0 blocked. Pending
  qualification gates remain pending; this is not release readiness approval.
- Scope declaration: consistent `release` / `release-change`, human decision
  required, with package-publication, documentation-deployment,
  release-authority and maintenance-control-plane boundaries declared.

The first registered run failed at `release-runtime-policy`: its old successful
controller fixture had no package manifest. That fixture now supplies real
context archive bytes and complete synthetic installed receipts. The failed
report/log are retained as `receipts/initial-release-tests.*`; the next run passed
4/4, and the final clean-checkpoint replay above independently passed 4/4. Mocked
controller success is integration-test evidence, not real installed qualification.

Raw working artifacts: `/tmp/pulse-09a-validation/`; the real package directory is
`/tmp/pulse-09a-validation/packages`. The exact pack-validation driver is retained
as `receipts/pack-check.cjs`; its paths describe that local run. No package was
published.

## Limits and next action

No extended integrated seal, full installed-feature replay, external provider
qualification, merge or publication was performed. This follows #456's explicit
STOP condition. The broader recovery/stale-receipt fault matrix remains #457
(09B); these development receipts cannot be pooled into a release seal.

No local implementation blocker remains. Hosted PR checks must finish on the
reviewed head and the declared protected boundaries require human review.
Next action: review and merge #476, then implement 09B (#457).
