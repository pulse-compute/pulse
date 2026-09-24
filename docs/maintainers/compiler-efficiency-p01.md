<!-- pulse-doc-meta:start
owner: maintainer-council
status: active
last-reviewed: 2026-07-16
review-by: 2027-01-16
pulse-doc-meta:end -->

# Compiler-efficiency P01 baseline and next-task packets

This is the evidence-only P01 checkpoint for the Pulse Compiler Efficiency
work. It records the selected `latest` source and the cloud environment, keeps
the failed baseline attempt intact, reconciles the already-delivered PS4 work,
and prepares (but does not authorize or dispatch) P02 and P03. It is not a
release seal, deployed Fastly acceptance, G0 approval, or permission to start
R01 or any later backlog item.

The local 34-task workbook, the historical assessment, and the
shared-function-plan attachment were not present in this checkout. This record
uses only the P01/P02/P03/R01 task packet supplied for this run and repository
sources. It does not claim to have inspected those missing inputs.

P02 was explicitly authorized after P01 merged. That authorization supersedes
the historical P01 instruction not to dispatch P02, but it does not waive the
portable-baseline prerequisite or authorize P03, R01, G0, or optional work.
The sections before the S01 addendum retain their original chronological
meaning; the addendum records the later portable replay and measurement work.

## Classification and source identity

- **Entry point:** `documentation-current`.
- **Class:** setup/evidence, with a documentation-only committed diff. There is
  no architecture, compiler, runtime, provider, release, or public-support
  change.
- **Branch:** `work`; this cloud checkout does not expose a local branch named
  `latest`, but its selected HEAD is the expected latest baseline.
- **Base and tested head:**
  `caec37a8de16060a6db9405ef9add257dbba4f11` (`PS4: fix retention
  regressions and qualify read-loop adoption (#68)`).
- **Initial tree:** clean (`git status --short --branch` printed only
  `## work`). Baseline commands ran before this page or its index link existed.
- **Lockfile:** `pnpm-lock.yaml`, SHA-256
  `4c184d78e2ab5e3224bfdc19b8d34830c8a17ef349ad9923f651c5da28cda0f8`.

`main` was not selected or used as a baseline. The tested SHA exactly matches
the expected preflight SHA; there is therefore no baseline discrepancy to
explain.

## Cloud environment packet

| Item | Observed value |
| --- | --- |
| OS/kernel | Ubuntu 24.04.4 LTS; Linux 6.18.44; x86_64 |
| CPU | 3 online vCPUs, Intel Xeon Platinum 8370C at 2.80 GHz, KVM |
| Node | 24.18.0, selected explicitly through `$HOME/.nvm/nvm.sh` |
| npm | 11.16.0 |
| pnpm | 12.4.2 through `node scripts/pnpm-toolchain.cjs` |
| AssemblyScript | 0.28.18 (`wasm/node_modules/.bin/asc`) |
| Binaryen used by AssemblyScript | package `129.0.0-nightly.20260428`; `wasm-opt version 129 (version_129-59-gdf8b79d62)` |
| Other installed Binaryen package | 130.0.0; this is a second dependency, not the AssemblyScript executable reported above |
| Fastly CLI | unavailable on `PATH` |
| Viceroy | unavailable on `PATH`; no workspace-local Viceroy binary found |
| Global `asc`, `wasm-opt`, `wasm-validate` | unavailable on `PATH`; the restored workspace supplies the first two where required |

The restored dependency graph was already present. P01 did not install or
bootstrap anything and did not use the unavailable network. The setup-shell
PATH is not assumed to persist: every baseline command explicitly selected
Node 24.18.0, and pnpm was invoked through the repository wrapper. Direct
`pnpm exec asc` and `pnpm exec wasm-opt` at the workspace root do not resolve
those commands; the exact versions above were read through their owning
workspace paths instead.

### Viceroy version boundary

Two valid but different evidence lanes are documented in this repository:

1. The general retained Fastly HTTP regression in the canonical testing guide
   selects a workspace-local **Viceroy 0.20.1** explicitly. Future general
   provider/release lanes must continue to use that exact lane unless its owner
   changes the contract.
2. PS4's focused packed read-loop qualification records **Viceroy 0.21.0** and
   documents that version's missing-header behavior. That result remains valid
   historical PS4 evidence; it does not silently repin the general lane.

Neither binary is available in this cloud environment. Consequently P01 makes
no local-engine or deployed-runtime claim, and it does not reinterpret PS4's
preserved 0.21.0 evidence as a 0.20.1 run.

## P02 prerequisite replay and environment handoff

P02 is classified **evidence / evidence-only**. No named implementation Entry
Point exactly matches an evidence harness with no production mutation, so this
attempt follows the ordinary instruction chain and the explicit P02 write
allowance. The canonical documentation update uses `documentation-current`;
it does not combine that documentation Entry Point with a product Entry Point.

P02 selected branch `work` at
`30bc530750d46804f1be399ecffa731afb104067`, the expected `latest` baseline
(`P01: record compiler-efficiency baseline and next packets (#69)`). The tree
was clean before replay (`git status --short --branch` printed only `## work`),
and the lockfile SHA-256 remained
`4c184d78e2ab5e3224bfdc19b8d34830c8a17ef349ad9923f651c5da28cda0f8`.
This is newer than P01's tested `caec37a...` source only because it includes
the merged P01 evidence commit; it is exactly the expected P02 source, so there
is no unexplained baseline delta. Node 24.18.0 was selected from the installed
nvm toolchain, and the repository wrapper selected pnpm 12.4.2. Dependencies
were already restored from the lockfile with lifecycle scripts disabled; no
network bootstrap was attempted.

The required pre-edit replay produced these wall-clock observations:

| Command | Exit | Duration | Result |
| --- | ---: | ---: | --- |
| `npm run maintainer:check` | 0 | 2 s | Passed: 7 classes, 11 protected boundaries, 9 instruction files, 52 documented commands, 8 workflows, 11 deployment objects, and 17 scope cases. |
| `node scripts/pnpm-toolchain.cjs -- --version` | 0 | 1 s | Printed `12.4.2`. |
| `node scripts/pnpm-toolchain.cjs -- run build` | 0 | 4 s | TypeScript build passed. |
| `node scripts/pnpm-toolchain.cjs -- run test` | 0 | 16 s | 27 files and 239 tests passed; Vitest reported 14.96 s. |
| Four-profile runner command below | 1 | 7.70 s | Terminal report `failed`; 97 selected and 2 completed: `suite-shape` passed in 181 ms and `test-orchestration` failed in 7.507 s. The remaining 95 tasks did not run. |

The aggregate command was:

```sh
node wasm/scripts/run-wasm-tests.cjs \
  --profile unit --profile native --profile javascript --profile conformance \
  --report .test-results/compiler-efficiency/p02/baseline-portable.json
```

The ignored report is
`wasm/.test-results/compiler-efficiency/p02/baseline-portable.json`, with run
ID `2026-09-23T00-58-53-745Z--5817`. It records source identity
`30bc530750d46804f1be399ecffa731afb104067`, terminal status `failed`, all 97
selected task IDs, two completed results, and the task-owned logs. The failure
is identical to P01: after the timeout fixture terminates its process group,
child PID 5869 is adopted by PID 1 and remains in zombie state `Z`; the exact
cleanup assertion at `wasm/test/suite/assert-test-orchestration.cjs:122`
therefore fails. This is the required assertion working as designed, not a
product failure to suppress.

Separate CI evidence supplied with the P02 authorization remains useful but
does not repair this container: [Repository validation run 35800677301,
portable job 106990062409](https://github.com/pulse-compute/pulse/actions/runs/35800677301/job/106990062409)
succeeded on PR test-merge `7ca69c38a5e99dc2419236bf48a2b0b7adb31922`
with Node 24.20.0. Its separate profile invocations covered 34 unit, 28 native,
7 JavaScript, and 28 conformance tasks (97 unique passing tasks, including
`test-orchestration`). Successful JSON reports were not retrieved, so this is
not the requested aggregate report and does not prove that the Node 24.18.0
cloud environment now reaps adopted children.

Per the P02 stop condition, no synthetic fixture, measurement harness, cold
compile, or warm execution was started. There are consequently no P02 metric
tables, artifact hashes, or conclusions about retained bytes, cumulative
charges, handles, Wasm capacity, RSS, or shared-function behavior. The concrete
handoff is to replay the unchanged aggregate in a Node 24.18.0 container whose
PID 1 reaps adopted children, confirm 97 selected and completed passing tasks
and every result, and only then implement the measurement packet serially.
Changing the orchestration assertion or treating CI as a waiver is outside P02.
The prescribed post-edit `unit` profile check also stopped after the same two
tasks (of 34 selected), with `suite-shape` passing and `test-orchestration`
failing on an adopted zombie; it supplies no additional profile coverage.

## Clean-baseline replay

All durations below are wall-clock observations from this container, not
performance budgets.

| Command | Exit | Duration | Result |
| --- | ---: | ---: | --- |
| `npm run maintainer:check` | 0 | 1.697 s | Passed: 7 classes, 11 protected boundaries, 9 instruction files, 52 documented commands, 8 workflows, 11 deployment objects, and 17 scope cases. |
| `node scripts/pnpm-toolchain.cjs -- --version` | 0 | 0.306 s | Printed `12.4.2`. |
| `node scripts/pnpm-toolchain.cjs -- run build` | 0 | 4.643 s | TypeScript build passed. |
| `node scripts/pnpm-toolchain.cjs -- run test` | 0 | 16.111 s | 27 files and 239 tests passed; Vitest reported 14.94 s. |
| Four-profile runner command below | 1 | 7.945 s | Terminal report `failed`; 97 selected, 2 completed: `suite-shape` passed and `test-orchestration` failed. The remaining 95 did not run. |
| Focused `test-orchestration` retry | 1 | 7.737 s | Terminal report `failed`; 1 selected and completed, failed identically. This is diagnostic evidence only. |

The requested aggregate command was:

```sh
node wasm/scripts/run-wasm-tests.cjs \
  --profile unit --profile native --profile javascript --profile conformance \
  --report .test-results/p01-portable.json
```

The runner resolves report and run-log paths beneath `wasm/`. Its preserved
aggregate report is `wasm/.test-results/p01-portable.json`, and the focused
retry is `wasm/.test-results/p01-orchestration-retry.json`. Shell transcripts
are under the repository-root ignored `.test-results/p01-logs/` directory.
These are machine-local, ignored outputs and are not part of this documentation
commit.

The failure is specific and reproducible. The timeout fixture kills its process
group, but the child becomes a zombie reparented to PID 1. PID 1 in this
container is `tail -f /dev/null`, not an init/subreaper, and does not reap the
child within the test's bounded cleanup interval. The assertion at
`wasm/test/suite/assert-test-orchestration.cjs:122` correctly reports the
remaining process-group member instead of treating a zombie as cleaned up.
Pre-existing zombies with PPID 1 provide independent environment context. The
focused retry created the same terminal state and was not used to relabel the
aggregate failure.

The smallest follow-up is an environment correction: run the unchanged
aggregate in a container whose PID 1 reaps adopted children (for example, an
init-enabled container). If that is impossible, a separately reviewed
hardening task can decide whether the orchestration contract should distinguish
an unreaped zombie from a live descendant. P01 must not weaken that assertion.
Until a clean aggregate completes, the portable baseline is **not proven**;
only the environment facts and the four preceding checks are proven. No full
release seal, packed acceptance, Fastly local-engine acceptance, or deployed
acceptance is claimed.

## PS4 reconciliation and revised R01

PS4 already delivered request-local Node `ValueHeap` indexes for immutable
scalar values and object/array identities. Both indexes are bounded at 8,192;
scalar mappings rotate, the object identity index stops growing, aliases can
reuse handles while indexed, and every allocated handle remains retained and
cumulatively charged. PS4 explicitly added no collector, handle reclamation,
ABI change, or increased limit. It also delivered the corresponding boundary,
alias, cancellation, settlement, packed-parity, and focused Viceroy evidence.
Those are historical wins and must not be counted again in R01.

The remaining R01 question is narrower: `ValueHeap.put` classifies objects for
its `WeakMap`, but `typeof value === 'function'` is not included. Repeated use
of the same shared function can therefore allocate and charge repeated handles
if such values reach this heap. The missing shared-function-plan attachment
means P01 cannot assert that this is the only reproducer or that a product
change is warranted. P02 must first separate live retention from cumulative
charge, and P03 must prove semantic parity and repeated-shared-function behavior.

Subject to those proofs, the **proposed R01 remainder only** is:

- reproduce and quantify same-identity function-handle growth;
- decide whether a bounded request-local function-identity index, analogous to
  PS4's object index, resolves the reproduction without changing values,
  effect order, failure order, limits, or ABI;
- preserve cumulative charging and terminal failure; do not describe indexing
  as reclamation;
- treat any general liveness analysis, handle release, collector, budget
  refund, ABI change, or limit increase as separate work requiring a new task
  and classification.

Exact current owners and locks are:

- Node handle ownership and the prospective R01 implementation seam:
  `wasm/packages/host-runtime/src/runtime/canonical-native-host.js`
  (`ValueHeap`).
- Node cumulative accounting:
  `wasm/packages/host-runtime/src/runtime/native-value-budget.js`.
- Cross-target memory policy:
  `wasm/packages/contracts/src/handler/canonical-native-runtime.js`.
- Fastly accounting/code generation, read-only unless evidence proves a
  cross-target defect: `packages/provider-fastly/src/build/native-value-budget.js`
  and `wasm/packages/runtime-core-as/src/compiler/canonical-native.js`.
- Existing nearest proof owner:
  `wasm/test/runtime/bounded-read-loop-memory.cjs`; PS4's narrative and preserved
  evidence remain under `wasm/test/runtime/PS4.md` and
  `wasm/test/runtime/evidence/`.
- Compiler lowering is locked for R01 by default. In particular,
  `wasm/packages/compiler/src/canonical-native-plan.js` and
  `wasm/packages/compiler/src/spine/handler-ir*.js` are read-only unless P03
  demonstrates that function values are introduced there and a separately
  declared implementation task authorizes that protected boundary.

## P02 packet — measurement and traces (authorized; prerequisite blocked)

**Purpose.** Establish repeatable measurements before any reclamation or
indexing change. Report separate quantities; never infer one from another:

1. **Live retained bytes:** bytes reachable from currently valid roots at each
   checkpoint, with the root model stated. This is an evidence estimate until
   the runtime exposes an authoritative liveness contract.
2. **Cumulative charges:** monotonic `NativeValueBudget` values/bytes and the
   exact first terminal failure.
3. **Handles by kind:** allocated and, separately, indexed handles for nullish,
   boolean, number (including `-0` and `NaN`), string, object, array, and
   function; aliases must be visible.
4. **Wasm capacity:** linear-memory current bytes/pages and declared maximum,
   not resident memory.
5. **Node RSS:** process RSS sampled at named checkpoints, labeled as
   process-wide and not request-live bytes.
6. **Compiler peak RSS:** peak RSS of an isolated compile subprocess, separated
   from execution RSS.
7. **Cold compilation:** fresh process and fresh task-owned output directory.
8. **Warm execution:** execute the already-compiled identified artifact; do not
   include compilation or silently reuse state between cases.

**Trace matrix.** Generate synthetic chains of 0, 1, 16, and 64 pages. Each
page has fixed UTF-8 byte size and deterministic content; record fixture seed,
source SHA-256, artifact SHA-256, page/effect count, expected response, samples,
and terminal status. Run Node Native first, then the provider-neutral Fastly ABI
fixture against the same logical corpus. A real Viceroy lane is optional only
when the exact required binary is supplied and must be labeled separately.
There is no deployed claim. Cases execute serially, smallest to largest, with a
fresh process per cold compile and a fresh runtime instance per warm execution.

**Proposed write allowlist.** No production path is writable:

- `wasm/test/runtime/compiler-efficiency/p02-memory-trace.cjs`
- `wasm/test/fixtures/projects/compiler-efficiency-memory/**`
- `wasm/test/suite/registry.cjs` (one evidence task registration only)
- `docs/maintainers/compiler-efficiency-p01.md` (result/handoff update only)
- ignored outputs at `wasm/.test-results/compiler-efficiency/p02/**`

Application source and historical attachments must not be copied into the
fixture. Secrets, absolute paths, bulky raw payloads, and machine-local tool
paths stay out of committed reports.

**Commands.** Run one benchmark runner at a time:

```sh
npm run maintainer:check
node wasm/scripts/run-wasm-tests.cjs --task compiler-efficiency-p02 --report .test-results/compiler-efficiency/p02.json
```

If the new task is not yet registered, the development command may invoke the
harness directly, but the review packet is not complete until the named task is
registered and its report has terminal `passed`, one selected/completed task,
and one passing result. Also rerun the existing `bounded-read-loops` task to
prove the measurement hooks did not alter its oracle. P02 must preserve failed
attempts and report setup limitations and durations exactly as P01 does.

**Exit criteria.** A reviewer can reproduce all four sizes, distinguish every
metric above, verify cold/warm separation and artifact identity, and identify
whether repeated function identity changes live bytes, cumulative charges, or
both. P02 does not approve R01 or G0.

## P03 packet — synthetic parity/stress corpus (do not dispatch)

**Purpose.** Freeze semantics independently of any later optimization. The
corpus must run against Node Native and the provider-neutral Fastly ABI fixture;
use JavaScript only where the case is already eligible and label unsupported
Native syntax as an admission expectation rather than a runtime mismatch.

**Required cases and oracles.** Use hand-authored expected values, never values
derived from the implementation under test:

- bounded read loops at 0, 1, 16, and 64 pages, plus the existing over-bound and
  cyclic/incomplete outcomes;
- legitimate growing request state with exact checkpoint values and the same
  terminal budget category;
- same-object aliases and distinct equal-looking objects;
- self-cycles and two-object cycles without implicit decoding or mutation;
- provider failure, decode/application error, and terminal budget failure;
- one and two suspension/resume points, including late success/failure and
  cancellation where existing contracts admit them;
- repeated references to one shared function, multiple distinct functions, and
  repeated invocation where admitted. Record admission outcome, handle/charge
  trace, and return/error value; do not widen Native syntax to make a case pass.

For every case capture an exact case ID, expected response/value, ordered effect
requests, ordered continuation/suspension events, ordered error observations,
budget samples and expected first failure. Redact payload bodies and retain only
bounded hashes/lengths where large data is needed. Compare the semantic trace
before comparing diagnostic measurements.

**Proposed write allowlist.** Keep the corpus separate from P02's measurement
harness:

- `wasm/test/runtime/compiler-efficiency/p03-parity-stress.cjs`
- `wasm/test/fixtures/projects/compiler-efficiency-parity/**`
- `wasm/test/fixtures/conformance/compiler-efficiency-parity.json`
- `wasm/test/suite/registry.cjs` (one evidence task registration only)
- `docs/maintainers/compiler-efficiency-p01.md` (result/handoff update only)
- ignored outputs at `wasm/.test-results/compiler-efficiency/p03/**`

The existing `bounded-read-loops` fixtures and tests are read-only regression
oracles. Compiler, runtime, provider, package, release, and generated
documentation paths are not writable for P03.

**Commands.** Do not overlap this with P02 or another benchmark runner:

```sh
npm run maintainer:check
node wasm/scripts/run-wasm-tests.cjs --task compiler-efficiency-p03 --report .test-results/compiler-efficiency/p03.json
node wasm/scripts/run-wasm-tests.cjs --task bounded-read-loops --no-report
```

The P03 report must finish `passed` with one selected/completed passing task and
must state per-target case counts. A Fastly local-engine supplement may run only
with the lane's exact Viceroy binary and remains distinct from the ABI fixture.
P03 must not patch a discovered product mismatch; preserve it, minimize it, and
propose the smallest follow-up.

**Exit criteria.** Reviewers can audit every expected value and ordering without
reading implementation output, all admitted targets agree, expected admission
failures fail closed, repeated shared functions have a decisive trace, and
budget failures occur at the frozen boundary. P03 does not approve R01 or G0.

## Coordination and gates

- **Coordinator responsibility:** enforce dependency order, ensure P02 and P03
  are not dispatched concurrently as benchmark runners, maintain the evidence
  index, and prevent optional or later tasks from entering scope.
- **Implementer responsibility:** stay inside the packet's exact allowlist,
  preserve failures, and make no product repair while gathering evidence.
- **Reviewer responsibility:** independently audit source identity, report
  completeness, hand-authored oracles, metric separation, path classification,
  and the no-runtime-change claim. Review is not self-approval.
- **Human gate responsibility:** after both P02 and P03 are reviewed, decide G0
  acceptance and any R01 implementation direction. P01 completion alone cannot
  approve G0.

No individual assignee is inferred. Optional R10, R11, R12, W03, I05, and C01
remain unselected. The next action is to correct the PID-1 reaping environment
and replay the unchanged four-profile baseline; only then should the coordinator
consider dispatching P02 and P03 in sequence for review before human G0.

## S01 addendum: portable replay and synthetic measurement (24 September 2026)

This addendum supersedes the historical next action above. Human direction
selected S01, consisting of P02 and W01. The earlier P01 documentation and
blocked P02 replay remain intact. This evidence-only PR adds a synthetic fixture,
one registered measurement task and source/Wasm attribution. It changes no
compiler, runtime, provider, ABI, product fixture or dependency lockfile.

**Source and runner.** The selected `latest` base is
`6eb85b29d0d87916c34038ae2f83eb31c7a6d4e1`, with unchanged lockfile
SHA-256 `4c184d78e2ab5e3224bfdc19b8d34830c8a17ef349ad9923f651c5da28cda0f8`.
Node 24.19.0 and the lockfile-pinned AssemblyScript 0.28.18 were used.
The previously failing `test-orchestration` task passed unchanged on this
runner. The four-profile aggregate returned terminal `passed`: **97 selected,
97 completed, 97 passed**, in 902.90 seconds. Its ignored report is
`wasm/.test-results/compiler-efficiency/s01/baseline-portable.json`; the
pre-edit command was:

```sh
node wasm/scripts/run-wasm-tests.cjs --profile unit --profile native --profile javascript --profile conformance --report .test-results/compiler-efficiency/s01/baseline-portable.json
```

The dependency graph was restored from an earlier checkout with this exact
lockfile hash. A pnpm invocation attempted to insert a placeholder `allowBuilds`
line into `pnpm-workspace.yaml`; it was restored while the aggregate was running.
No compiler, runtime, test assertion or lockfile content changed. The aggregate
therefore proves the unchanged tests pass on this runner, but is **not described
as a continuously clean-tree replay**. The pinned TypeScript build and all 239
package tests passed via their installed executables. The pnpm wrapper attempted
dependency validation and rejected ignored build scripts; no bypass or policy
change is part of S01. The focused task's first attempt failed during project
planning because its synthetic S3 profile omitted `HMAC-SHA256`; the fixture
declares the required algorithm and the complete retry passed. Preserve both
failed and passing task reports when comparing local attempts.

**Repeatable measurement.** Run the selected task on a runner with the restored
dependency graph:

```sh
node wasm/scripts/run-wasm-tests.cjs --task compiler-efficiency-p02 --report .test-results/compiler-efficiency/s01/p02-task.json
node wasm/scripts/run-wasm-tests.cjs --task bounded-read-loops --report .test-results/compiler-efficiency/s01/bounded-read-loops.json
```

`compiler-efficiency-p02` compiles each target in an isolated cold worker and
loads the identified Wasm for warm execution on fresh runtime instances. The
0/1/16/64-page cases have fixed 4,096-byte deterministic pages (seed
`s01-page-body-v1`), two ordered
effects per page, exact response assertions, distinct Node Native and Fastly
ABI hosts, and SHA-256 identities. The ignored detailed report is
`wasm/.test-results/compiler-efficiency/s01/measurements.json`. The passing
task report at this checkpoint is
`wasm/.test-results/compiler-efficiency/s01/p02-task-final.json` (one selected,
one completed). It includes effects, per-kind allocated Node handles, bounded
index entries, cumulative charges, and selected effect checkpoints.

| Pages | Node charged bytes / values | Node handles | Node rooted host-value estimate | Fastly charged bytes / values | Fastly final Wasm pages |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 2,480 / 85 | 17 | 942 B | 896 / 24 | 110 |
| 1 | 53,070 / 346 | 48 | 43,870 B | 28,652 / 135 | 110 |
| 16 | 700,600 / 3,793 | 279 | 580,030 B | 435,058 / 1,578 | 110 |
| 64 | 2,694,224 / 14,783 | 998 | 2,217,182 B | 1,735,058 / 6,185 | 220 |

The rooted estimate walks the **actual Node host handle map** and weighs
reachable values with the current policy. It omits guest linear memory, provider
fixture bodies, traces and JavaScript object overhead; it is not an
authoritative live-heap figure. Fastly exports cumulative charges and final
linear-memory capacity, not Node handle kinds or guest-root liveness. The Node
host exposes fresh-instance initial linear capacity (3,538,944 bytes) but no
post-execution capacity through this result. Execution process RSS was sampled
before/after each serial case and includes the harness and previously loaded
artifacts; the detailed report gives the raw samples. It is not a per-request
peak or a cross-target memory comparison.

**Compiler and size pressure.** In one cold run per target, the generated Node
AssemblyScript was 38,342 bytes and the normally optimized Wasm 44,296 bytes;
the Fastly ABI source was 170,611 bytes and final Wasm 115,568 bytes. Their
Wasm hashes were respectively
`28336dc67330626b2c20b22c945ddb0318c87d57b1f974259c962906f96b0657`
and `91ad1af978c52fa1b34b7bce1c09a00770b988785bc9ea9456e730bc92bddf51`.
Each source contained 131 expression declarations, of which 35 repeated an
exact declaration after normalizing only the declared function number (2,267
source bytes). These are lexical candidates, not proven mergeable functions.

At 10 ms sampling intervals, the isolated Node and Fastly compile workers had
peak RSS of 139,350,016 and 117,989,376 bytes; their largest observed compiler
descendants had peak RSS of 308,920,320 and 292,794,368 bytes, respectively.
These are sampled individual-process peaks, not simultaneous tree totals or a
benchmark comparison. Separate Node controls varied one, eight and 32 repeated
expression sites independently from leaf/nested complexity; the resulting
source bytes, declaration counts, exact repetitions and final Wasm sizes are
recorded in the report. The optimizer changed some final Wasm sizes in the
opposite direction of generated-source growth, so S03 needs a measured binary
result and compiler RSS/time proof rather than a source-size extrapolation.

Fixture SHA-256 is
`9b7fc1bb75638e14d0b8b7031d9daeb85f05a1fb3ceaa6ef2ff8e23d1c6ec367`.
Generated Node/Fastly source hashes are
`0966b5226b0a1eb474cc4e3aa9a8d1774a0371d6c9427fe9c4a46b1a5d504503`
and `a2f054649bf793c1d4127df5b4d968a1d1cacf2681520fc5646adcb9b8765dd1`.
This is a single baseline observation per artifact. Neither source duplication
nor Wasm capacity establishes a memory saving. S02 semantic oracles and human
G0 acceptance are the next gates before any internal helper-sharing change.

## S02 addendum: hand-authored semantic oracles (24 September 2026)

S01 was accepted into `latest` at `acc4348f55cb434362be4b7b90ff6dc79e74b36d`.
Human direction selected S02/P03. Its separate synthetic fixture and
`wasm/test/fixtures/conformance/compiler-efficiency-parity.json` freeze expected
responses, effect counts, failures and boundary charges independently of runtime
output. No compiler, runtime, provider, ABI or production application source
changed. Run the manually selected task:

```sh
node wasm/scripts/run-wasm-tests.cjs --task compiler-efficiency-p03 --report .test-results/compiler-efficiency/p03/p03.json
node wasm/scripts/run-wasm-tests.cjs --task bounded-read-loops --no-report
```

The focused P03 task reached terminal `passed` with one selected and one
completed passing task; it ran ten fixture cases on Node Native and the Fastly
ABI fixture, plus one separate eligible Node JavaScript case. The ignored
detailed trace is `wasm/.test-results/compiler-efficiency/p03/semantic-oracles.json`.
The corpus includes 0, 1, 16 and 64 fixed 4,096-byte pages; a 64-page cap
followed by `incomplete` (409); a p1/p2 cycle rejected when p1 is read a second
time with the wrong index; early and late S3 misses (503); malformed JSON after
S3 and digest effects; and a source-level same-object/distinct-object alias
case. One page has two ordered effects (`s3.getText`, `crypto.digestText`) and
two completed continuation lifecycles. Every admitted Node Native case checks
the exact effect sequence and completed/failed continuation states. The ABI
fixture checks outbound request order and send/wait order; it does not expose
the same Node continuation trace. Malformed JSON is an error on both targets:
Node reports `PULSE_SCHEMA_JSON_MALFORMED`; the Fastly ABI fixture reports
`PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED` with last
error 1004 and stage 3. Node cancellation at the second effect reports
`PULSE_RUNTIME_EFFECT_ABORTED`, with a completed first continuation and a
failed second one; the Fastly ABI fixture provides no equivalent cancellation
hook in this task.

The direct host-value probes fix same-object aliasing, distinct equal-looking
objects, a self-cycle and a two-object cycle. These are host `ValueHeap` tests,
not claims that self-referential source was compiled. A shared function inserted
directly into the heap gets two handles on repeated insertion, because function
identity is not currently indexed. That direct probe does not establish
reachability from accepted Native source. All ten observed Native fixture cases
put **zero** function values into `ValueHeap`. A repeated shared-function call
with order `1:2:3` and identity `true:false` runs as a separately selected
JavaScript project case; its runtime-value import is rejected for Native with
`PULSE_PROJECT_RUNTIME_VALUE_IMPORT_UNSUPPORTED`. A plain Native handler with
local function values also fails native-plan admission with
`PULSE_CANONICAL_NATIVE_EXPRESSION_UNSUPPORTED`. R01 therefore has no admitted
Native function-value reproducer in this corpus; do not implement function
indexing from the direct heap probe alone.

The 64 MiB/1,048,576-value request policy is unchanged. Each admitted Node
request records cumulative-charge checkpoints; both charges are asserted
nondecreasing. Separate tiny-limit boundary instances on the Node host budget
and the generated Fastly guest counter admit **2 values / 64 bytes** and reject
the first additional value (Fastly stage 173) or byte (stage 172), latch the
failure, and keep the last admitted charge. Those tiny-limit probes prove the
first accounting boundary, not an observed 64 MiB failure during the page
workload. The 64-page case succeeds; exceeding the bounded loop returns 409.
Do not equate cumulative charges with live host roots, process RSS or guest
linear-memory capacity. No Viceroy or deployed Fastly run is claimed.

Corpus SHA-256 `8fea7d5a34fa1bda0697d5c7598a0989340f9e8909c0d442349e8ddcbc130a1a`,
fixture-source SHA-256 `b9f3aec10b578483cd6e3cbd695e4cd6f1b64e2c92c0120a6fce334e2d9937f2`
and Node/Fastly Wasm SHA-256
`65607307019443f101b5059dfeef1e3acd32b6a285fa02b0ba6f1139e04319e3` /
`172412e7d0b017868ebba20842c9d90629e11b61e64f35d20a4a27df60ccf6d3`
identify this checkpoint. The report records the
input and artifact hashes and per-target case counts. Failed development
attempts are retained in ignored local runner reports; the successful terminal
report alone is acceptance evidence for the corrected corpus. G0 remains a
**human** decision after S02 review. Neither S03 nor R01 is authorized by this
evidence-only PR.

## S03 addendum: source sharing and the optimized-Wasm boundary (24 September 2026)

S02 was merged into `latest` at
`44f13cde69b63b6849975cd8c9ea20ca08d67bc5`. S03 tested a bounded
change in `wasm/packages/runtime-core-as/src/compiler/canonical-native.js`:
reuse the first generated helper for byte-identical `literal`, `undefined`,
`local` or `context-read` bodies. Each expression site still invoked its
helper. Distinct local slots and request fields retained separate helpers;
there was no value caching or change to call order. A focused Native fixture
checked identical literals, distinct local bindings and request fields,
and an executed response. It passed; the same task also checked deterministic
generation for its existing canonical plans. The S02 P03
semantic oracle task also passed on the candidate: ten Node Native cases, ten
Fastly ABI cases and one JavaScript case. The 0/1/16/64-page P02 cases kept
identical responses, charges, handle counts and observed Fastly memory pages.

The unchanged baseline and candidate each had three **valid serial cold
runs** with the same fixture and pinned AssemblyScript 0.28.18. P02 sampled
each compiler descendant's RSS at 10 ms intervals; the table reports the
largest observed descendant, not combined process-tree memory. Time is the
isolated compile worker wall time. Two baseline checkout runs resolved
workspace package links through the candidate checkout; those samples were
discarded and the links corrected before the valid baseline reruns.

| Target | Expression declarations | Generated source | Optimized Wasm | Compiler descendant RSS, three runs (MiB) | Compile wall, three runs (ms) |
| --- | ---: | ---: | ---: | --- | --- |
| Node baseline | 131 | 38,342 B | 44,296 B | 320, 323, 338 | 2,445, 2,804, 2,423 |
| Node candidate | 97 | 36,116 B | 44,296 B | 328, 321, 322 | 2,458, 2,438, 2,484 |
| Fastly baseline | 131 | 170,611 B | 115,568 B | 300, 303, 279 | 4,139, 4,198, 4,053 |
| Fastly candidate | 97 | 168,385 B | 115,568 B | 291, 308, 320 | 4,038, 4,006, 4,224 |

The declaration reduction was 34/131 (26%). The Node and Fastly optimized
Wasm hashes were unchanged respectively:
`28336dc67330626b2c20b22c945ddb0318c87d57b1f974259c962906f96b0657`
and `91ad1af978c52fa1b34b7bce1c09a00770b988785bc9ea9456e730bc92bddf51`.
The six separate 1/8/32-call P02 source-shape controls also had zero final
Wasm byte delta. Median Node compile time moved from 2,445 to 2,458 ms;
Fastly from 4,139 to 4,038 ms (about 2.4% less, within the observed spread).
Sampled RSS had no consistent decrease across targets.

A further 256-repetition leaf fixture used
`let value=0;` followed by 256 `value=value+1;` statements and
`return ctx.text(''+value)`. Three cold runs per checkout reduced generated
declarations **1,285 to 518 (60%)** and source **135,661 to 85,624 B**;
optimized Wasm remained **8,657 B** with identical SHA-256
`61f0305ca323132fc678fd91a8bfc26b093a0b50d25f1fe94cfb4adc72dc8ed9`.
Median isolated compile wall time moved **1,445 to 1,467 ms**, while median
sampled compiler descendant RSS moved **277,856,256 to 275,410,944 B**
(about 0.9% less). These three runs establish neither a speedup nor a
reliable memory saving. The fixture tests source duplication pressure, not a
representative application mix.

The 256-repetition fixture also received a separate **diagnostic** compile
with the pinned AssemblyScript 0.28.18 and the production runtime/no-assert
settings, but without `--optimize`. That intermediate Wasm shrank from
**20,074 to 13,690 B** (32%). Its named expression functions fell from
**1,029 to 518**. Production compilation then generated **identical**
188,989-byte WAT on both sides, as well as the identical optimized Wasm
above. The final WAT contained **14 functions**, none named as expression
helpers, with **no function table or indirect calls**. This is direct
structural evidence that the source-level aliases do not survive as shared
functions in the optimized module. The optimizer removes or folds these
helper boundaries before the final binary; the artifact alone does not
distinguish every inlining decision from other simplifications. A shared
runtime helper could use ordinary direct Wasm calls, without function
pointers or a table, if a sufficiently substantial body survives
optimization. A separate `@noinline` probe on these small leaf and binary
helpers also yielded the same optimized Wasm hash. The follow-up below found
that AssemblyScript ignored this unsupported annotation: the probe had never
applied Binaryen's actual retention flags.

The S03 proposed go criterion required at least 15% fewer declarations **and**
at least 10% lower compiler peak RSS or median compile time beyond measured
spread; optimized Wasm delta was to be reported separately. Declaration and
unoptimized-intermediate reductions are real. This **specific leaf-alias
implementation** missed the compiler gate and never changed the final
module. That initial candidate compiler and test patch was removed. The
retained-helper implementation below supersedes this initial disposition and
supplies the missing optimized-Wasm proof. Public syntax changes and R01 work
remain outside this pass.

The selected local evidence commands were:

```sh
node wasm/scripts/run-wasm-tests.cjs --task canonical-native-wasm --report .test-results/compiler-efficiency/s03/canonical-native-wasm-attempt-01.json
node wasm/scripts/run-wasm-tests.cjs --task compiler-efficiency-p02 --report .test-results/compiler-efficiency/s03/after-task-attempt-01.json
node wasm/scripts/run-wasm-tests.cjs --task compiler-efficiency-p03 --report .test-results/compiler-efficiency/s03/p03-parity.json
```

The P02 task was repeated for the three valid baseline and three candidate
samples. Its detailed reports, the one-off stress-driver samples and the
unoptimized/WAT diagnostic artifacts are local ignored evidence; they are not
checked-in benchmark infrastructure. The
passing candidate test and P03 task prove selected semantics for the screened
patch, not a new binary, RSS or request-memory benefit. Human review retains
the G0 and future-work decisions.

## S03 implementation: retain shared bodies before Binaryen optimization

Investigation of PR #73 found a missing toolchain connection. The pinned
AssemblyScript **0.28.18** does not implement `@noinline`. Its
[annotation contract](https://www.assemblyscript.org/concepts.html#code-annotations)
allows custom decorators but ignores them unless a transform interprets them.
That includes the annotations already emitted for Pulse dispatcher partitions.
The pinned Binaryen **129.0.0-nightly.20260428** does support function retention:
its [`no-inline` pass](https://github.com/WebAssembly/binaryen/blob/version_129/src/passes/NoInline.cpp)
sets full/partial inlining flags for matching functions. It must run before
optimization. The installed asc source confirms that `afterCompile` precedes
optimization; [`--runPasses`](https://www.assemblyscript.org/compiler.html#binaryen)
runs afterward and is too late to protect functions already inlined.

The old generator's alias `Map` was a JavaScript compile-time data structure;
it never emitted a Wasm function table. A live dynamic-selector control using
an AssemblyScript function array retains its table and `call_indirect` under
default optimization, and a memory mapping retains both selected values.
Sharing these Pulse helpers uses direct calls and does not require pointers.

The implementation now canonicalizes byte-identical emitted expression bodies
after child aliases and local slots have been resolved. It marks repeated
multi-statement bodies for retention and keeps small leaves eligible for
inlining. Build support supplies an asc transform that applies Binaryen's
real flags to annotated generated helpers and dispatcher partitions before
optimization, using asc's own Binaryen instance. The same path serves Node
Native and Fastly Native, including the existing size profile. There is no
new dependency, public setting, value cache or function-value syntax. Each
call still performs its original operations and allocations.

Blanket retention was rejected: retaining all expression helpers increased
the P02 Node module by 463 B and Fastly by 590 B. Selected shared-body
retention produced these results against the S02 baseline:

| Fixture | Declarations, before → after | Generated source, before → after | Optimized Wasm, before → after |
| --- | ---: | ---: | ---: |
| 256 repeated updates, Node | 1,285 → 8 | 135,661 → 33,752 B | 8,657 → 4,336 B |
| 2,000 repeated updates, Node | 10,005 → 8 | 1,027,801 → 216,085 B | 62,089 → 28,122 B |
| P02 page workload, Node | 131 → 90 | 38,342 → 35,303 B | 44,296 → 44,277 B |
| P02 page workload, Fastly | 131 → 90 | 170,611 → 167,572 B | 115,568 → 115,553 B |

The larger fixture is exactly `let value=0;`, 2,000 repetitions of
`value=value+1;`, and `return ctx.text(''+value)` in the canonical async handler,
compiled as `s03-leaf-stress.ts` with `strict:false` and `requireAsync:true`.
Three serial cold runs per version recorded:

| Metric | Baseline samples | Retained-sharing samples | Median change |
| --- | --- | --- | ---: |
| Isolated compile wall (ms) | 2,682 / 2,621 / 2,635 | 1,930 / 1,955 / 1,896 | −26.8% |
| Largest sampled compiler descendant RSS (B) | 332,566,528 / 347,873,280 / 347,971,584 | 265,428,992 / 287,612,928 / 288,067,584 | −17.3% |

The ranges do not overlap. This clears the original declaration-plus-compiler
threshold on the repeated-body stress fixture. RSS is sampled at 10 ms and is
the largest individual compiler descendant, not total process-tree memory.
The worker RSS stayed near 191–193 MB. Final Wasm fell **54.7%**; its baseline
and candidate SHA-256 values are respectively
`cd2fddfbc36f4551f62c636d2251a76713ccf9e8b2a674a0dde862f2ad675e79`
and `d89cfae128cb3bb16f95f2719bd6cb66a0fb4145154826fc0df167e17b2769c7`.
These measurements used a detached prototype with equivalent generator and
retention behavior; the final implementation restricts annotation recognition
to Pulse's two generated source entries and reproduces the same final Wasm hash.
This is a synthetic duplication win;
the P02 workload shows only small binary savings. It is not a general
application-memory or JIT-memory claim.

A runtime screen warmed each 2,000-update module for 100 requests, then ran
three alternating batches of 1,000 fresh requests. Baseline times were
2,483 / 2,343 / 2,223 ms; retained sharing was 2,222 / 2,271 / 2,214 ms.
The ranges overlap, so this does not establish a runtime speedup. Both returned
`2000` with exactly 4,005 value handles per request. P02's 0/1/16/64-page cases
preserved responses, budget charges, handles and observed Fastly memory pages.
P03 retained exact semantic-oracle parity across ten Node Native cases, ten
Fastly ABI cases and one JavaScript case.

Configuration is also material. Default asc optimization is O3/shrink0.
On the 256-update fixture O2/shrink0 and shrink1 did not preserve meaningful
sharing; shrink2 did. The existing `--experimental-native-size` setting
(O3/shrink2/converge) reduced the baseline fixture to 3,868 B without the new
generator. On P02 it produced 35,422 B Node / 90,799 B Fastly, about 20% / 21%
below default. Single-sample compile times increased and RSS did not improve
consistently, so changing the global default is outside this proof.

The `canonical-native-wasm` task now includes a focused regression that proves
the annotation is ineffective without the transform and effective with it;
live dynamic tables and mappings remain executable; shared bodies retain
multiple direct call sites; and distinct bindings, repeated mutations and
fresh object identity survive on both Native targets in both optimization
profiles. Existing semantic and portable gates remain required:

```sh
node wasm/scripts/run-wasm-tests.cjs --task canonical-native-wasm --task compiler-efficiency-p03 --report .test-results/compiler-efficiency/s03/retained-focused.json
node wasm/scripts/run-wasm-tests.cjs --profile unit --profile native --profile javascript --profile conformance --report .test-results/compiler-efficiency/s03/retained-portable.json
```

Detailed measurements and diagnostic Wasm/WAT remain local ignored evidence
under `wasm/.test-results/compiler-efficiency/s03/toolchain/`; validation
completion and tested source identity belong in the PR record. Human review
retains the G0 and merge decisions. This pass claims neither Viceroy/deployed
qualification nor a change to public authoring or runtime-budget semantics.
Guest-linked modules also pass through a separate post-link whole-module
optimizer. The size measurements here use handlers without guest units;
stable helper boundaries through that later stage require their own proof.

Refreshing the executable documentation's exact byte baselines found modest
default-build savings outside the stress fixture: hello JSON 2,212 → 2,140 B,
fetch composition 5,117 → 5,039 B, Fastly capabilities application 5,454 →
5,397 B / provider 46,934 → 46,922 B, and Router lowering 9,407 → 9,232 B.
The size-optimized Router grew 8,619 → 8,625 B; the other measured optimized
examples were unchanged. Schema, opaque proxy, events, MCP proxy and the
guest-linked JWT example retained their default sizes. The first CLI replay
stopped at the stale hello-JSON size assertion; the exact assertions and
documentation were refreshed from independent default/size builds for all
nine Native examples before replaying the complete CLI profile.

## Bounded merging proof after S03

The follow-up authorized after PR #73 is **evidence / evidence-only**. It adds
one opt-in test task and shares the existing frozen P03 oracle helpers. No
named implementation Entry Point matches this internal experiment; it follows
the ordinary instruction chain. Production optimization, feature policies,
guest-link receipts and public support are unchanged.

The proof applies these pinned Binaryen options to copies of final Wasm:

```text
--merge-similar-functions
--one-caller-inline-max-function-size=64
--flexible-inline-max-function-size=0
--inline-max-combined-binary-size=1024
-Oz
```

The 64 limit concerns the inliner's function-size heuristic, not parameters.
The 1,024 limit bounds estimated combined inlining size, not all Wasm functions.
Neither is a global hard function-body cap. The proof separately checks that
no candidate's largest body exceeds `max(1024, baseline largest body)` and no
maximum parameter count exceeds `max(64, baseline maximum parameters)`.
Existing larger functions may remain. All twelve measured cells meet these
shape gates; that is a fixture result, not an arbitrary-program guarantee.

Non-guest modules keep within asc's existing mutable-global, sign-extension,
nontrapping-float-to-int and bulk-memory policy. Guest-linked modules are
validated with `--mvp-features`. The proof does not enable reference types or
GC to obtain more merging opportunities.

### Workloads and outcome

`repeat` is the exact 2,000-update source described above, compiled as
`bounded-merge-repeat.ts`. `oracle` is the frozen P03 schema/read-loop/effect
project. `jwt` is example 13 with the real
`pulse.crypto.es256.rustcrypto-p256.v1` guest linked on each target, including
its key artifacts and target policy. JWT execution uses the fixed clock
2,000,000,000 seconds. `size` means the existing experimental Native size
profile, before the proposed postpass.

| Workload / target / profile | Wasm B, before → after | Reduction | Largest body B, before → after | Maximum parameters, before → after |
| --- | ---: | ---: | ---: | ---: |
| repeat / node / default | 28,122 → 9,787 | 65.20% | 858 → 856 | 3 → 64 |
| repeat / node / size | 9,798 → 9,798 | 0.00% | 856 → 856 | 64 → 64 |
| repeat / fastly / default | 55,920 → 37,436 | 33.05% | 1,452 → 1,439 | 5 → 64 |
| repeat / fastly / size | 33,706 → 33,687 | 0.06% | 1,428 → 1,428 | 64 → 64 |
| oracle / node / default | 44,772 → 44,494 | 0.62% | 4,010 → 4,007 | 6 → 6 |
| oracle / node / size | 35,923 → 35,921 | 0.01% | 4,156 → 4,156 | 6 → 6 |
| oracle / fastly / default | 116,077 → 115,224 | 0.73% | 4,198 → 4,195 | 10 → 10 |
| oracle / fastly / size | 91,314 → 91,259 | 0.06% | 4,158 → 4,158 | 10 → 10 |
| jwt / node / default | 39,354 → 35,673 | 9.35% | 3,299 → 3,024 | 7 → 7 |
| jwt / node / size | 39,151 → 35,499 | 9.33% | 3,299 → 3,024 | 7 → 7 |
| jwt / fastly / default | 113,006 → 104,784 | 7.28% | 4,546 → 4,530 | 7 → 7 |
| jwt / fastly / size | 94,784 → 87,446 | 7.74% | 3,383 → 3,140 | 7 → 7 |

The repeated-code default builds show the largest win. Guest-linked JWT
also benefits in both profiles. The schema/effect cases and already-size-optimized
repeated cases show much smaller gains, so these results do not justify adding
the postpass to every build. The existing size profile already captures almost
all of the repeated Node fixture's reduction.

The unbounded control uses the same input and features with
`--merge-similar-functions -Oz`, omitting the three inlining limits:

| Target | Bounded / unbounded Wasm B | Bounded / unbounded largest body B |
| --- | ---: | ---: |
| node | 9,787 / 9,571 | 856 / 7,973 |
| fastly | 37,436 / 37,163 | 1,439 / 10,352 |

Both controls still return `2000`. Paying a few hundred bytes for the bounded
variant avoids rebuilding a large dispatcher function. The merged repeated
helper has 64 parameters: retaining small bodies does not eliminate the need
to evaluate calling cost. There are no added Wasm tables or indirect calls in
any measured candidate, and imported/exported function signatures, memory
limits and start presence match the baseline.

Each candidate passes the independent frozen expectations and exact paired
semantic projections. The oracle checks response/error outcomes, ordered
effects, continuations, cancellation, value handles, charged bytes/values and
Fastly linear-memory pages where exposed. JWT checks the valid ES256 response,
wrong-signature rejection and disallowed-algorithm rejection; Fastly must
report the package-owned JWT failure stages 217 and 212. The repeated Node
fixture still allocates exactly 4,005 value handles. These are preserved-cost
observations, not a request-memory reduction.

### Compile and execution costs

Three serial cold processes per variant, alternating order, produce 72 full
compilations. Each JWT sample starts with an empty materialized-guest cache.
Inputs and each variant's outputs must be byte-deterministic across all three
runs. The following values are medians; MB means decimal megabytes. Cold
worker time includes startup, compilation and, for the candidate, postprocessing.

| Workload / target / profile | Cold worker ms, before → after | Added postprocess ms | Compiler descendant RSS MB, before → after | Process-tree RSS MB, before → after |
| --- | ---: | ---: | ---: | ---: |
| repeat / node / default | 2,012.4 → 2,519.4 | 421.5 | 283.4 → 286.2 | 521.5 → 527.0 |
| repeat / node / size | 2,119.7 → 2,557.3 | 373.8 | 284.0 → 285.5 | 523.7 → 526.2 |
| repeat / fastly / default | 2,826.2 → 3,495.3 | 512.2 | 300.6 → 282.1 | 546.1 → 526.1 |
| repeat / fastly / size | 3,507.0 → 4,284.0 | 522.3 | 298.8 → 310.1 | 542.0 → 554.0 |
| oracle / node / default | 2,448.4 → 2,950.1 | 517.6 | 343.6 → 333.6 | 525.6 → 516.0 |
| oracle / node / size | 2,775.8 → 3,524.5 | 549.6 | 339.0 → 316.9 | 521.1 → 498.8 |
| oracle / fastly / default | 4,284.8 → 5,415.3 | 945.7 | 342.0 → 322.0 | 527.3 → 504.8 |
| oracle / fastly / size | 4,985.0 → 5,825.7 | 811.2 | 325.8 → 337.6 | 510.8 → 522.0 |
| jwt / node / default | 4,568.3 → 5,241.7 | 716.1 | 270.6 → 271.4 | 438.8 → 441.1 |
| jwt / node / size | 4,627.4 → 5,389.0 | 703.4 | 271.2 → 270.3 | 440.6 → 437.9 |
| jwt / fastly / default | 7,308.9 → 8,428.6 | 1,048.0 | 279.0 → 299.1 | 449.3 → 469.4 |
| jwt / fastly / size | 8,155.3 → 8,936.4 | 953.3 | 271.1 → 293.0 | 440.4 → 464.5 |

RSS is sampled every 10 ms from Linux procfs. Descendant RSS is the largest
individual compiler/tool process; tree RSS sums simultaneous processes and
can double-count shared pages. Short peaks may be missed. This postpass runs
after the normal compiler, so it cannot remove that compiler's already-incurred
peak. The measurements establish no compiler-memory win. Any integration must
account for the extra optimization time rather than presenting smaller Wasm
as free compilation savings.

Fresh-process runtime samples cover the default repeated fixture on both
targets. Each process measures its first module construction and first request,
warms 50 requests, then measures 200 fresh-instance requests. Three alternating
samples per variant are shown as median (minimum–maximum):

| Target / variant | First module ms | First request ms | 200 warm requests ms |
| --- | ---: | ---: | ---: |
| node / baseline | 0.47 (0.40–0.50) | 11.16 (9.60–11.85) | 508.62 (504.89–525.33) |
| node / merged | 0.41 (0.37–0.56) | 10.48 (9.14–11.60) | 486.68 (474.14–519.69) |
| fastly / baseline | 0.60 (0.47–0.63) | 4.15 (4.00–4.45) | 197.60 (187.40–207.57) |
| fastly / merged | 0.50 (0.39–0.62) | 3.61 (3.27–3.93) | 193.10 (174.20–194.52) |

These are Node/V8 host-harness measurements, including the Fastly ABI fixture.
They do not isolate JIT tiers or measure JIT memory, and do not qualify Viceroy
or deployed execution. Three short samples are insufficient for a general
runtime-performance claim.

### Reproduction and evidence identity

```sh
node wasm/scripts/run-wasm-tests.cjs --task compiler-bounded-merging --report .test-results/compiler-efficiency/bounded-merging/proof.json
```

The task is external/opt-in and does not join normal release-profile membership.
It retains structured measurements, paired Wasm/WAT, plans and package artifacts
under `wasm/.test-results/compiler-efficiency/bounded-merging/`. These are ignored
local evidence. Do not package the optimized copies with unchanged production
manifest hashes or guest-link receipts.

The complete local run used clean code revision `b3b90e0880dfceac0a4c5af6f625c3f7e4581d80`
on Node **v24.19.0**, AssemblyScript **0.28.18**, and direct Binaryen
**129.0.0-nightly.20260428**. The proof script SHA-256 is
`d9e0efd9420aebf34143d46bf5d86aaf3d45b9d12b0a194ae8a26dfbb126cb5a`; the lockfile SHA-256 is
`4c184d78e2ab5e3224bfdc19b8d34830c8a17ef349ad9923f651c5da28cda0f8`. The report also records the frozen corpus and oracle
harness hashes, tool executable hashes, input/output Wasm hashes and all raw
samples. Later changes document and mirror the result and register its opt-in
status in the suite contract; the measured proof script and production code
remain unchanged.

The terminal runner report is `attempt-04.json`. Earlier attempts remain
separately recorded: attempt 01 omitted Fastly's existing bulk-memory feature
flags; attempt 02 compared semantic runs in one process, so identifier lengths
crossing a decimal digit changed legitimate charged bytes; attempt 03 omitted
the Node JWT key-artifact sidecar. The unchanged baseline independently
reproduced 2,598 → 2,600 charged bytes at request 10. Fresh-process parity fixes
the experimental setup without normalizing or weakening budget assertions.
Focused JWT setup checks then added the Fastly guest-link target policy and
synchronized package facts before the complete replay.

The next safe integration proof should first investigate the existing guest-link
optimizer, where merging may fit without adding a second tool invocation, and
measure JWT execution costs on the intended engine. Repeated dispatcher groups
are the other candidate, with the 64-parameter calling cost explicitly measured.
Keep the existing size mode as a comparator. Integration must regenerate final
artifact audits/receipts and replay the required semantic and provider gates
before any default changes. This experiment alone makes no global-default or
deployment decision.

## Production integration after the bounded and guest-link proofs (24 September 2026)

Human direction selected implementation of the compiler and optimizer findings
after the separate PR #74 and PR #75 proofs. No named implementation Entry
Point matches this internal optimizer work; the ordinary instruction chain
applies. The Fastly Native realization call site and generated documentation
are included explicitly in this pass. No public API, host authority, feature
policy, guest-prebuilt recipe, or final-audit requirement changes.

For modules without guests, the existing AssemblyScript invocation now runs
`merge-similar-functions` **after** its normal optimization, in the same
compiler process. This keeps the existing default and experimental size
settings and the pre-optimization `no-inline` transform. Guest inputs wait
until composition, then the existing pinned `wasm-opt` invocation schedules
`-Oz` and bounded merging while skipping `memory-packing`. The original
postures used to reproduce the reviewed ES256 prebuilt remain unchanged.
The existing final inspection and audit issue new receipts for the exact
optimized bytes, with the same MVP, fixed-memory, ABI, and exact static-data
checks. There is no second optimizer process in either production path.

Single-build reproductions of the frozen repeated-body and ES256 fixtures
show these uncompressed production artifacts. The earlier evidence-only copies
remain historical controls; these measurements use the normal compilation
paths and, for JWT, the resulting final receipts.

| Fixture / target / profile | Before → integrated Wasm B | Change |
| --- | ---: | ---: |
| 2,000 updates / Node / default | 28,122 → 9,787 | −65.2% |
| 2,000 updates / Fastly / default | 55,920 → 37,518 | −32.9% |
| 2,000 updates / Node / size | 9,798 → 9,798 | 0% |
| 2,000 updates / Fastly / size | 33,706 → 33,706 | 0% |
| ES256 / Node / default | 39,354 → 36,100 | −8.27% |
| ES256 / Node / size | 39,151 → 35,926 | −8.24% |
| ES256 / Fastly / default | 113,006 → 108,804 | −3.72% |
| ES256 / Fastly / size | 94,784 → 91,447 | −3.52% |

Both repeated-body targets still return `2000`; Node still allocates and
charges 4,005 value handles. Its largest function remains 856 B on Node and
1,452 B on Fastly default; the maximum is 64 parameters. All four real
guest-linked ES256 artifacts accept their new final receipt and preserve exact
validated static segments. Valid bearer, wrong signature, and disallowed
algorithm outcomes match on both targets and profiles, including Fastly's
package-owned rejection stages. Ordinary executable examples mostly retain
their previous size; two default Fastly provider bundles shrink by 67 and 69 B.

These are fixture sizes, not a general memory or compile-time saving.
AssemblyScript's in-process merge avoids the separate postpass process measured
in PR #74. Guest-link optimization now runs actual passes inside its existing
invocation; the prior serial proof measured an extra postpass cost, so no
zero-cost or across-the-board cold-build claim follows. The bounded settings
are heuristics, not hard limits on all function bodies or parameters. This
integration does not establish Viceroy or deployed Fastly execution, JIT
memory, host-heap retention, or publication approval.


## Bounded Native size recipe (24 September 2026)

The separate `--experimental-native-bounded-size` mode selects AssemblyScript
O3/shrink2 without convergence. The existing `--experimental-native-size`
mode retains convergence. Both are optional, and the default recipe remains
unchanged. The bound is on optimizer work observed in the large consumer proof,
not a compiler time limit. Portable and provider manifests identify the selected
mode and settings; the guest-link stage retains its default optimization posture
for the new mode. This preserves the existing size mode and its guest-link audit
recipe.

In a single large Fastly consumer diagnostic using identical generated source,
O3/shrink2 without convergence finished AssemblyScript in 363.263 seconds and
produced 3,738,372 Wasm bytes; the default O3/shrink0 compile took 518.203
seconds and produced 4,182,729 bytes. The full convergent size mode exceeded
the 600-second compiler gate. The 14-check, 86-request capture corpus passed
with the diagnostic artifact. Gzip sizes were essentially flat, and Wasm
memory remained 48,234,496 bytes. These single-run results justify an opt-in
recipe and further cross-application measurement, not a default or release
performance claim.

## B01: internal Router handler boundary, contract and controls (24 September 2026)

Human direction selected B01 as a bounded compiler design and evidence pass
after the size-recipe integration. This section describes a **candidate internal
boundary for the next implementation pass**. It does not alter accepted
syntax, the Native plan, execution, public imported functions, or the host ABI.
The source of truth for current behavior remains the Router and Native
contracts. The B01 runner is `compiler-handler-boundary-b01` in
`wasm/test/suite/registry.cjs`.

### Current handoff and loss of function ownership

`spine/router-handler-ir.js` builds an operation IR and a canonical IR for each
entry. Before Native planning it appends each emitted handler body into the
single `__pulse_router_entry(ctx)` function, wrapped by ordered cursor, mode,
match, and mount decisions. `canonical-project-compiler.js` passes that
synthetic source to the shared canonical compiler; `canonical-native-plan.js`
produces one `plan.entry.body`, one flat `plan.locals` table and one program
counter with a state for each continuation. Native's existing state chunks
(up to 64 states or 24,000 rendered characters) split the *dispatcher*, not
the original handler bodies. The optimizer therefore still sees bodies in a
shared function/plan before emission.

This is a precise ownership gap, not wholesale metadata loss. The Router's
`handlerTable`, route plan and routing entries preserve stable IDs, order,
kind, source ownership and generated body ranges. Effects and continuations
in the Native plan carry `routerEntryStableId` and `applicationEntryStableId`.
Plan locals have a flat `localId` and `statementPath` but no explicit
`routerEntryStableId`; arbitrary nested expression objects also have no
function owner. A generated range can be used to infer some ownership while
the synthetic text exists, but it is not a function or a complete call graph.

The manually selected evidence task builds three generated project sources,
uses real Router compilation and Native **planning** (no AssemblyScript or
Wasm build), checks deterministic entry IDs, disjoint body ranges and effect/
continuation ownership, and parses the emitted TypeScript function declarations.
Each middleware performs one recognized fetch before a terminal `next()`.
The 8/32 cases also include a route with error transfer and an error handler.
The result on `latest` `71a6f03` was:

| Entries (use / route / error) | Synthetic source B | Body ranges B | Top-level functions | Plan locals / with entry ID | Effects / continuations / states |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 (0 / 1 / 0) | 589 | 82 | 1 | 4 / 0 | 0 / 0 / 1 |
| 8 (3 / 4 / 1) | 3,236 | 1,585 | 1 | 14 / 0 | 3 / 3 / 4 |
| 32 (15 / 16 / 1) | 11,950 | 6,192 | 1 | 50 / 0 | 15 / 15 / 16 |

These are source and plan shapes for small synthetic controls, not predicted
Wasm, memory, or cold-build improvements in Catalog. Reproduce with
`node wasm/scripts/run-wasm-tests.cjs --task compiler-handler-boundary-b01`.

### Candidate internal boundary for a subsequent implementation pass

| Concern | Existing source to preserve | Required candidate shape / proof |
| --- | --- | --- |
| Identity and dispatch | Ordered `metadata.entries`, stable entry and handler IDs, normal/error/event lanes, mounts and route match | Keep a dispatcher with existing ordering, predicates, cursor/mode/error state and 404/500 exhaustion. Map each body to its entry stable ID and original source span; do not use function ordinal as identity. |
| Values and locals | `handlerRecords` and the single Native `plan.locals` table | Give each handler a lexical local namespace and explicit ownership for its statements/expressions, with deterministic mapping for values live across suspension. Keep dispatcher locals distinct. |
| Effects and resumption | Effect and continuation IDs, site-to-entry ownership and shared pending-result checks | A suspended site resumes in its owning body under the same request lifecycle. Preserve effect ordering, grouping, site IDs and error normalization; never rely on a live call stack across suspension. |
| Control transfer | `return next()` and `return next(error)` set cursor/mode/error and terminate the current handler; ordinary returns complete the response | Define a *private* call result with response, normal transfer, error transfer, suspension and failure cases. Dispatcher consumes the result, advances the same cursor and checks the same pending result. No onion-style unwinding. A body may need multiple internal functions across suspension; one source handler does not imply one Wasm function. |
| Bounds and artifacts | One shared guard per original state, existing Native chunks, plan hashes and final audits | Charge the same original state once even if new call boundaries are introduced; preserve request/effect limits. Distinguish changed plan/generator/artifact identity from unchanged host ABI; run final inspection on the final bytes. |

The likely cut is **after** Router topology and per-entry handler IR formation,
**before** rendering a synthetic single function for Native planning. The
JavaScript original-source path and public imported-function syntax remain
outside this proposal. This cut is a proposed implementation location, not an
approved Native plan schema or runtime ABI. The next pass must first choose a
versioned plan representation and internal call/continuation protocol, with
human review of those protected contract changes. It should then show that
1/8/32 controls and existing middleware, error and event corpora retain
semantics and budgets on Node and Fastly Native, before assessing compile time,
peak RSS, Wasm bytes and cold loads with matched source/settings. Inbound event
ownership and mounted Router branches were not exercised by this B01 control;
they remain explicit gates for implementation. The larger consumer is a final
validation point, not a B01 performance claim.

## T01: batch the existing retention policy (24 September 2026)

Human direction selected a retention-cost proof after B01, before changing
handler structure. This hardening pass changes only build support's retention
transform and its evidence. No named implementation Entry Point matches this
internal toolchain stage; the ordinary root/Wasm instructions apply. The
generated hint policy, function names, plan, optimizer settings, dependencies,
effects and host ABI remain unchanged.

The pinned Binaryen `no-inline` pass accepts one wildcard and scans every
function in the module. Its JavaScript API exposes no function retention setter;
the function-only pass runner requires a function-parallel pass, which
`no-inline` is not. See the pinned upstream
[NoInline pass](https://github.com/WebAssembly/binaryen/blob/version_129/src/passes/NoInline.cpp),
[wildcard matcher](https://github.com/WebAssembly/binaryen/blob/version_129/src/support/string.cpp)
and [pass runner](https://github.com/WebAssembly/binaryen/blob/version_129/src/passes/pass.cpp).

`native-retention-transform.cjs` now reads the emitted function names once,
sorts them, and identifies contiguous runs of already-selected names. The
nearest unselected neighbors bound the shortest safe prefix for each selected
name. Duplicate prefixes become one pass; if an unselected name extends the
entire selected name (such as `expr_1` and `expr_10`), the selected name remains
an exact match. Prefixes stay within the existing generated namespace. All
module functions, including imports and unannotated leaves, participate in the
exclusion check. Absent declarations need no policy; zero/one selected functions
avoid the sort. Each pass still runs before optimization and the previous
Binaryen pass argument is restored on success or failure.

The proof uses AssemblyScript 0.28.18 and its own Binaryen
129.0.0-nightly.20260428 under Node 24.19.0. Each source has 64-operation chunks,
dynamic imported calls, and either all expression helpers retained or only
every eighth helper retained. All chunks remain selected. Three serial pairs
per source alternate old/new ordering in fresh compiler processes. The old
per-name loop exists only in the measurement comparator. Peak RSS comes from
the same PID that runs the transform, verified by the harness; it is compiler
RSS, not guest memory. These are the medians:

| Expressions / selected stride | Module passes, before → after | Retention ms | Full compile ms | Compiler peak RSS MiB | Wasm B, unchanged |
| --- | ---: | ---: | ---: | ---: | ---: |
| 512 / every helper | 520 → 1 | 53.74 → 7.34 | 1,173.98 → 1,219.97 | 216.94 → 215.99 | 11,147 |
| 4,096 / every helper | 4,160 → 1 | 2,587.25 → 30.17 | 5,445.97 → 2,786.77 | 294.29 → 297.70 | 90,557 |
| 4,096 / every eighth | 576 → 513 | 350.69 → 334.94 | 2,633.09 → 2,733.73 | 311.11 → 309.55 | 44,339 |

All nine pairs produce byte-identical optimized Wasm and the same exact
imported-call order and result. The dense large control improves full compile
time by 48.8%. Small and sparse controls have overlapping timing ranges and
approximately 3.9% higher observed medians; they establish no general speedup.
RSS ranges overlap in every case, so there is no compiler-memory improvement
claim. The batching benefit depends on the distribution of retained names;
sparse expression families may still need one pass per retained expression.
This proof does not forecast a large application's savings.

Reproduce with `node wasm/scripts/run-wasm-tests.cjs --task compiler-retention-cost-t01`.
The accepted local run is `wasm/.test-results/compiler-efficiency/t01/cost-final.json`
(one selected/completed task, passed); its task log holds every sample, source
and Wasm hash. Base is `0cd6c4b`; the measured transform SHA-256 is
`d392b69ccfabce70e3b71b47c9b7bdc84369a66960f543c58703b500d1edcc4d`.
The first attempt in `cost.json` failed on an unbounded 4,096-operation fixture
in Binaryen emission. It also exposed an RSS collector bug: asc's launcher
overwrote the child compiler's report. The final harness uses bounded chunks,
starts asc with its normal source-map flag to avoid the launcher, and checks
PID identity. The initial attempt supplies no accepted performance evidence.

Focused real-Wasm checks cover both Native targets and all three optimization
modes, retained shared calls, unannotated prefix collisions, distinct bindings,
fresh allocations, live tables and mappings. Deterministic generated name sets
also verify exact retention membership and option restoration after failure.

## B02: terminal HTTP route bodies (24 September 2026)

Human direction to implement B02 after B01 and T01 selects one bounded family:
terminal HTTP routes with no `next()`/`next(error)` operation. Effectful routes
are included. Middleware, transfer-capable routes, error handlers and event
handlers retain their existing lowering. This is an internal architecture
change under the root/Wasm/compiler instructions; no named Entry Point covers
the full change. The Native plan and continuation boundaries receive human
review in the implementation PR. No new public function syntax is admitted.

The Router frontend emits each selected body once as a private function and
places a terminal call in its dispatch branch. Handler IR retains those
declarations and calls; Native plan v3 stores the bodies separately from
`entry.body`, under `pulse.canonical-native-handler-body.v1`. Stable Router
entry IDs own bodies and local namespaces, while the original handler ID and
source span remain recorded. A body's statement/expression tree lives only in
that owner. Plan validation rejects cross-owner local access, recursive or
duplicate calls, and mismatched effect/continuation ownership.

The private protocol covers response completion, suspension, application-error
transfer and terminal failure. A call lowers directly to the body's first
state, adding no state or budget charge. Suspension resumes through the same
continuation/program-counter mechanism, without a live Native call stack.
The generator partitions at body boundaries as well as its existing 64-state
and 24,000-character limits, and T01 retains the resulting chunks. Plan and
generator versions change; host ABI v2 does not. Read-loop memory detection,
Fastly value-failure guards and fetched-body import analysis inspect the new
body table as well as the dispatcher.

Broader package controls exposed two source-mapping assumptions: generated-call
lookup misses could reuse unrelated authored offsets, and imported package
effects had diagnostic locations but lacked generated positions for Router
ownership. Generated lookups now remain authoritative on a miss. Imported
package effects retain both positions, preserving original diagnostics while
assigning the correct body owner. Collision and multi-file routing controls
cover this separation. A bare-return detector regression was also corrected.

The B01 controls now report the selected ownership explicitly:

| Total Router entries | Private terminal bodies | Locals / explicitly body-owned | Effects / continuations / states |
| ---: | ---: | ---: | ---: |
| 1 | 1 | 4 / 1 | 0 / 0 / 1 |
| 8 | 3 | 14 / 3 | 3 / 3 / 4 |
| 32 | 15 | 50 / 15 | 15 / 15 / 16 |

The paired cost proof uses a separate source with 32 terminal routes, one fetch
middleware and one error handler. Each route has 16 mutations followed by a
fetch and a response. Three serial fresh-process pairs per target alternate
baseline/candidate ordering. Baseline is merged T01 `9f2c369`; Node is 24.19.0,
AssemblyScript 0.28.18 and Binaryen 129.0.0-nightly.20260428. Medians:

| Target | Full build ms, before → after | Wasm B | Compiler worker peak MiB | AssemblyScript peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Node Native | 2,993.02 → 3,009.44 | 58,215 → 53,832 | 195.23 → 203.18 | 309.65 → 315.77 |
| Fastly Native | 4,874.03 → 4,751.68 | 107,330 → 102,623 | 207.05 → 210.20 | 327.84 → 319.13 |

Both targets preserve 791 charged execution states and 102 local slots; 96
locals now belong to the 32 private bodies. Retained chunks increase from 29
to 65. Generated AssemblyScript grows from 759,597 to 767,671 bytes on Node
and 908,487 to 916,561 bytes on Fastly. Wasm decreases by 7.5% and 4.4%
respectively. This is structural evidence with a size benefit on this fixture,
not a general build-time or memory improvement claim.

The canonical examples also receive exact-size refreshes from both default and
experimental-size builds. Eight small application guests grow by 104–530 bytes;
the JWT linked artifact is unchanged. Their bodies are now retained separately,
so the structural boundary has a fixed cost on small programs. This is a real
tradeoff, not a universal size reduction. Default application guest bytes:

| Example | Before | B02 |
| --- | ---: | ---: |
| 01-hello-json | 2,140 | 2,353 |
| 02-request-schema | 40,981 | 41,086 |
| 03-fetch-composition | 5,039 | 5,272 |
| 05-fastly-capabilities | 5,397 | 5,695 |
| 07-opaque-proxy | 2,200 | 2,304 |
| 09-router-lowering | 9,232 | 9,762 |
| 11-events | 40,546 | 40,667 |
| 12-mcp-proxy | 2,589 | 2,694 |
| 13-jwt-es256 | 36,100 | 36,100 |

The Fastly capability and opaque provider artifacts grow by 280 and 106 bytes
respectively. Exact size assertions remain enabled against these measured
values; normal executable example workflows must still pass.

Every pair checks exact response, effect order, site/entry identity and state
count. Node also checks continuation lifecycle, 425 allocated handles, and
failure before the second dispatch at `maxEffects: 1`. Fastly uses injected
host fixtures, not deployed acceptance. The harness records first execution
after compilation/auditing; that timing is not an independent cold-load proof.
Worker RSS is captured before execution. AssemblyScript peak RSS is collected
separately by PID, including its launcher/child processes without overwriting
the compiler measurement. These maxima are not aggregate concurrent RSS.

Reproduce with a dependency-restored pre-B02 checkout:
`PULSE_B02_BASELINE_ROOT=/path/to/base node wasm/scripts/run-wasm-tests.cjs --task compiler-handler-cost-b02`.
The accepted initial implementation report is
`wasm/.test-results/compiler-efficiency/b02/cost-pinned.json` (one selected/completed
task, passed). It predates the later bare-return and package source-mapping fixes;
a repeat against those final sources remains pending after the execution
environment went offline. Every sample records source hashes; the measured
initial candidate compiler-source aggregate is
`a846fb72d45d2aa91db7cadb0dd647ccf52fd0aaba376aa9f1dfb867dbd9d9d1`.
The initial three attempts failed while correcting the proof's Node fetch
fixture fields and trace projection; they establish no performance evidence.
An intermediate successful run is retained separately from the final pinned
run after ownership-lookup cleanup. Runtime, source-mapping, mounted-route,
error, event, read-loop and budget checks remain the implementation gates.

The final-source nine-example size measurement completed before the outage.
Local validation includes 239 passing package tests, build and documentation
checks, source-mapping regressions, and extensive completed portable tasks.
Two later runners were interrupted after 70/71 and 23/57 tasks. Recovery completed
nine additional tasks before the old hello size expectation stopped the run.
The updated exact-size fixtures, remaining CLI/provider tasks, final focused
regressions and repeat paired timing proof still require completion. The PR
records these limits; these results are not an uninterrupted release replay.
