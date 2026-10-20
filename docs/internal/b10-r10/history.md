# Historical PR #441 evidence before R10

This is the exact previously published PR body, retained as historical evidence.
Its draft status, candidate identities, earlier failures and passing retries are
historical statements; the R10 README and receipt record the current disposition.

## R05 follow-up — October 20, 2026

The combined `docs-executable-contracts` task passes its unchanged **240 s** gate on this PR's exact head `ba599b9eb3c039c2353ca02f906c19275c1bd786` (**144.620 s**) and current latest `138ab310de081e4f8bf62a8a90966c9731c40510` (**146.043 s**). Each complete registered run verifies **49 documented results and 59 source blocks** under matching supported Node 24.19.0 / copied lockfile tools. The harness and every binding/expected result remain unchanged. Longest measured binding intervals are 6.823/6.693 s; no source defect or timeout was reproduced. No preparation reuse or deadline change was introduced.

Separate cleanup evidence: despite passing task cleanup receipts, four/five task-created lease files remained in the checkouts. Five diagnostic builds traced successful in-process removal, with later parent-visible residue in two cases; cause remains unproven. Known task-created files were reconciled only after child termination, and both worktrees are now clean. This manual reconciliation does not qualify release cleanup. [Tracker #372](https://github.com/pulse-compute/pulse/issues/372) retains full commands, identities, report hashes, timeline/cleanup receipts and limitations.

R05 is complete with a non-reproduction disposition. The historical Node 24.18.0 timeout below remains recorded. R10 still owns current-base feature integration and required qualification; this PR stays draft. R12 must run complete qualification and owned-worker/final cleanup on the exact integrated release candidate.

---

## R04 follow-up — October 20, 2026

Recovery-runner failures did not reproduce under matching supported Node 24.19.0 / Git 2.51.1 tools and the same copied dependency graph. The exact original clean base `8a51d705025c69ae306004215cb6cb48248d68e1` passes its unchanged registered 90 s gate in **68.040 s**; this PR's exact clean head `ba599b9eb3c039c2353ca02f906c19275c1bd786` passes in **68.816 s**. Clean current latest `138ab310de081e4f8bf62a8a90966c9731c40510` passes in **69.178 s**, within a **5/5 passing** lifecycle/checkpoint/recovery-runner/recovery/orchestration selection (91.538 s).

All recovery assertion groups completed, including exact receipt binding, mutation rejection, worker ownership, failed cleanup, interruption and the 149-reuse/one-rerun fixture. Cleanup passed and all three task roots were independently checked absent. Existing owned-group/descendant fixtures pass; host-wide process inspection is unavailable in this managed environment, so empty process arrays do not establish a host inventory. No source or deadline change was warranted.

R04 is complete with a non-reproduction disposition. The historical Node 24.18.0 failures below remain recorded; their cause remains unproven and candidate/base failures are not newly asserted identical. [Tracker #372](https://github.com/pulse-compute/pulse/issues/372) retains exact trees, commands, report hashes and boundaries. R05's documentation timeout and R10's current-base feature integration remain; this PR stays draft. Complete qualification remains R12's final-candidate obligation.

---

## R03 follow-up — October 20, 2026

The retained-report timeout did not reproduce under the current supported Node 24.19.0 environment with matching copied lockfile/toolchain bytes and fresh builds. The exact original base `8a51d705025c69ae306004215cb6cb48248d68e1` passed the unchanged registered 60 s gate in **34.600 s**; this PR's exact clean head `ba599b9eb3c039c2353ca02f906c19275c1bd786` passed in **34.122 s**. Current clean `latest` `138ab310de081e4f8bf62a8a90966c9731c40510` passed in **31.741 s** within a **4/4 passing** capsule/viewer/retained/workflow selection. All retained runs preserve 22 negative cases, four Native compiles, current/stale/historical admission and identical portable/provider Wasm hashes; cleanup passed. No source or gate change was warranted. The first base setup attempt lacked built assets; it remains recorded separately from the passing post-build retry.

This is a non-reproduction disposition, not proof of the historical timeout's cause; the original runs below used Node 24.18.0 and remain historical evidence. Full identities, report hashes, commands and limits are retained in [tracker #372](https://github.com/pulse-compute/pulse/issues/372). R03 is complete; recovery-runner/documentation failures, current-base integration and R10's feature continuation remain. This PR stays draft. No full-profile, installed replay or seal claim is added.

---

## Why

PR #432 documented ambiguity between successful commands, nonexecuting plans and admitted report evidence. This adds an opt-in presentation for agents while preserving the authoritative report v1 capsule and its existing integrity/freshness checks.

## Changes

- Add `--evidence-status` to finite commands. One versioned JSON envelope contains the original result, actual exit code, planned/completed/failed outcome and bounded evidence projection.
- Only admitted report collections become verified completed-artifact or historical-capsule evidence. Keep artifact-byte verification, current-input matching, source identity, inventory coverage and measurement availability distinct.
- Reuse established capsule/build/artifact identities and public diagnostic contracts. Preserve unknown provenance and partial resources/implementations. Unrecognized diagnostics remain uncollected, including inherited-property-shaped codes.
- Preserve existing output without the flag, including report v1 JSON, terminal/HTML and dev NDJSON. Document the interpretation contract in troubleshooting; regenerate CLI references, completions, installed mirrors and context data through their owners.
- Add focused complete/partial/historical/missing/invalid/planned/failure/unknown-identity cases to the existing CLI task; extend the existing retained-current assertion without adding redundant project scans.

## Exact candidate and validation

Base `8a51d705025c69ae306004215cb6cb48248d68e1` (`latest`); head `ba599b9eb3c039c2353ca02f906c19275c1bd786`; tree `5503abe643dff74296c2f8ee9a74e6126144066b`. Node 24.18.0; pinned pnpm 12.4.2; frozen-lockfile dependency installation with lifecycle scripts disabled.

Passed on final bytes:

- `node scripts/pnpm-toolchain.cjs -- run build`
- `npm run maintainer:check`; `npm run docs:check`
- `node scripts/maintainer-scope.cjs --base 8a51d705025c69ae306004215cb6cb48248d68e1 --head ba599b9eb3c039c2353ca02f906c19275c1bd786 --declaration-file /tmp/evidence-status-pr.md --check`
- `node wasm/scripts/run-wasm-tests.cjs --task cli-report-workflow --report /tmp/evidence-status-validation/status-head.json`
- Fresh installed consumer of all 20 final tarballs: projection fixtures, then public-bin init → doctor → inspect → test → compile → report → build → report → source edit → stale report. Successful reports verify current inputs; stale report exits 3 on stderr with no promoted identity. All 21 changed CLI package files match the checkout byte-for-byte.
- GitHub [Repository validation](https://github.com/pulse-compute/pulse/actions/runs/39371144742), [Documentation](https://github.com/pulse-compute/pulse/actions/runs/39371144766), and [Maintainer scope](https://github.com/pulse-compute/pulse/actions/runs/39371144865).

`node scripts/documentation-release.cjs` also passed earlier, with unchanged documentation bytes. Earlier installed retained qualification passed four real Native compiles, 22 negative cases, current/stale/historical admission and unchanged portable Wasm. Fastly here is fixture-ABI evidence, not external provider reality. Final production changes after that run are limited to the diagnostic-code fallback; final focused and installed tests cover that change.

### Broader development evidence and limits

The 93-task unit/CLI selection was attempted through fail-fast continuation slices and focused retries. All 93 tasks were attempted; 88 have at least one registered pass, and five remain failed/timed out as listed below. All 13 tasks in the final documentation/example slice passed on the final commit. These mixed development runs do not constitute a full-profile pass or release seal; receipts preserve source IDs, failed attempts and retries. Earlier broad runs did not retain an immutable working-tree snapshot for their entire duration. The final checkout is clean.

- Capsule and topology tasks passed on retries (29.42s and 84.88s); initial failures remain recorded.
- Retained evidence timed out at its registered 60s gate. The same regression passes directly under a 120s development cap and in installed mode. Unchanged base passes at 59.30s; no gate limits changed.
- Entities contracts/catalog export assertions fail identically on unchanged base. Recovery-runner fails/times out across candidate/base runs; these are not claimed to be identical failures.
- Combined documentation command bindings timed out at 240s near the end of 49 bindings. Individual example tasks are reported separately.
- `node scripts/pack-release.cjs --skip-build --out /tmp/evidence-status-pack-final` exits 1 after constructing and individually validating all 20 tarballs: unchanged runtime `docs/API.md` links to absent packed `./docs/maintainers/release-manifest.md`. The packed API file is byte-identical to base. Installed checks use those exact tarballs; complete packaging/release qualification is not claimed.

Keep this PR draft for human review of the recorded local gate failures. No merge, publication or deployment was performed.

## Scope and authority

Direct user instruction authorizes this bounded agent presentation, tests, interpretation contract, installed validation and PR against `latest`. No named Entry Point fully covers the work; ordinary root/wasm/CLI/docs instructions apply. No compiler/runtime/provider behavior, physical resource-size attribution, provenance inference, integrity bypass, production dependency, package export or release change. Generated context assets follow existing canonical owners. Human merge authority is retained.

<!-- pulse-maintainer-declaration:start -->
Change class: hardening
Scope: inside-developer-preview
Protected boundaries: none
Human decision: not-required
<!-- pulse-maintainer-declaration:end -->

