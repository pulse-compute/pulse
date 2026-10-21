# B10-MCP-09B handoff

Issue #457; PR https://github.com/pulse-compute/pulse/pull/477.

## Source checkpoint

- Branch: `codex/b10-mcp-09b`, targeting `latest`.
- Base: `9cdea0dc5fcca1e7bbde170a1a0c354e1d114ce0` (09A / #476 merged).
- Tested implementation head: `aa204acb3cf01da746563638af94d92eae653d07`.
- Tested tree: `3f8de2175c75906be22ba0bee4f3d238ffc0bb5c`.
- Clean tracked checkout before and after final validation.
- The following evidence commit adds only this handoff and retained development receipts. Its own commit is the PR head; these receipts qualify the implementation checkpoint above, not a later release candidate.

## Implementation and ownership

Entry point: `release-readiness`. The user explicitly requested “Implement 09B,”
authorizing the existing controller/checkpoint/evidence owners and bounded
recovery qualification. Additional documentation scope is the canonical
`docs/maintainers/release-acceptance.md`, its generated installed mirror, and
this repository-only handoff. Package-publication and release-authority paths
require human review. No receipt schema, authority policy, dependency, public
API, version, package set or release channel changed.

The controller now validates the fresh source-check receipt against its candidate
before building and derives the shared-package checkpoint prerequisite from the
context freshness proof. It checks the pinned receipt bytes again immediately
before checkpoint admission. Final evidence aggregation derives and verifies the
same prerequisite through the canonical freshness owner.

The proof binds candidate, producer, configuration, allowlist, lockfile, sources,
outputs and complete task selections. Attempt duration and source receipt
formatting do not invalidate otherwise identical context inputs; checkout,
environment, dependency and toolchain isolation remain in the existing recovery
context. An invalid current freshness receipt stops before package reuse or
consumer execution. An expired or damaged retained package causes repacking and
reexecution of dependent tasks. A damaged installed-task receipt reruns that task.

## Deterministic recovery qualification

`wasm/test/release/assert-context-seal-recovery.cjs` is enrolled in the existing
`release-recovery` task. It uses the actual controller, checkpoint admission,
artifact retention/restoration and evidence validators. Heavy product commands,
builds, provider execution and product results are mocked. The synthetic candidate
tree is explicitly labelled in the retained report; the report separately records
the actual implementation revision. This is control-flow qualification, not a
real release seal or proof that 211 product tasks passed.

All 30 cases passed. They cover missing/tampered checkpoints and freshness proofs,
stale candidate revision/tree, foreign checkout, changed producer/configuration/
lockfile and selection, expiry, failed/interrupted execution, changed package
bytes, damaged installed receipts, receipt mutation before admission, and refusal
to pool an unselected historical pass. Rejected proofs receive new execution
proofs, and invalid fresh source receipts cannot cross package admission.

The interrupted attempt retains its failed status. Its valid resume reuses the
shared pack and all 211 release-task proofs, reuses nine installed-task proofs,
and executes the interrupted MCP task plus the previously unreached S3-body task.
The final valid resume covers all 211 release tasks and all 11 installed gates,
with exact canonical selections and terminal reports accepted by the evidence
owner. Prior failed/successful report hashes and candidate context/source/producer
bytes remain unchanged. Test-owned scratch directories are cleaned afterward;
the retained JSON embeds four controller reports and the full case summaries.

## Completed development checks

All final commands use Node 24.18.0. Lockfile-pinned dependencies were installed
with pnpm 12.4.2 using `--frozen-lockfile --ignore-scripts --offline`.

- `node wasm/scripts/run-wasm-tests.cjs --profile unit --task release-evidence-authority --report /tmp/pulse-09b-final-tests.json`: terminal pass, 69/69 complete. Includes all seven focused release tasks and preserves the real subprocess/parallel recovery tests. See `receipts/unit-and-release-tests.*`.
- Direct context recovery matrix: 30/30 passed, candidate bytes unchanged. See `receipts/context-recovery.*`.
- Fresh real source checks on the clean implementation head: passed; includes read-only context reconstruction, maintainer/publication checks and canonical/installed documentation validation. See `receipts/source-checks.*`.
- TypeScript workspace build with context `--check`: passed, zero changed context files and 30 compared canonical/mirror outputs. See `receipts/build.log`.
- `maintainer:sync`, `docs:sync`, `maintainer:check`, `docs:check`, `documentation-release.cjs`, `publication:check`, and `git diff --check`: passed. Separate verbose development logs remain at `/tmp/pulse-09b-{maintainer,docs,docs-release,publication}.log`; their canonical validation results are also retained in the clean source-check receipt.
- `release:preflight`: consistency check passed, 11 proven / 10 pending / 0 blocked. This is not release-readiness approval. See `receipts/preflight.log`.
- Scope declaration: consistent `release` / `release-change`; human decision required; package-publication and release-authority declared. See `receipts/scope.log`.

Raw working reports are under `/tmp/pulse-09b-*`. The named receipts above are
retained in the PR; test-owned controller directories referenced within them
were intentionally cleaned by the fixture. Full CLI and release profiles were
not run; only the scoped tasks and required unit profile above are claimed.

The initial registered seven-task run failed at `release-recovery` because a
fixture mutation aliased the shared candidate object. The fixture now clones its
source-check input before fault injection. The failed report/log are retained as
`receipts/initial-focused.*`; its base revision had uncommitted implementation
changes. The subsequent dirty-checkout retry passed 7/7 and is retained as
`receipts/focused-retry.*`. These development attempts are not pooled with final
clean-checkpoint evidence.

## Integrated-candidate handoff and limits

No full release seal, complete real installed-feature replay, external Fastly
qualification, merge, publication or promotion was performed. Preflight still
has ten pending qualification gates. Historical seals and these deterministic
fixtures cannot substitute for a future integrated candidate qualification.

After this PR is reviewed and merged, 09A's read-only freshness gate and 09B's
recovery admission are available together on `latest`. For the later integrated
seal, freeze the reviewed candidate and use the existing release controller with
its exact full selections. Resume only its explicitly selected same-checkout,
same-candidate attempt; allow rejected/missing proofs to execute again. Do not
regenerate context after freeze or combine development reports. Actual Fastly
CLI/Viceroy qualification remains 10A (#458); pinned MCP client/profile
compatibility remains 10B (#459).

No local implementation blocker remains. Hosted checks and human review of the
declared protected boundaries remain required. At handoff no local checks are
running. Next action: review and merge PR #477 before starting 10A (#458).
