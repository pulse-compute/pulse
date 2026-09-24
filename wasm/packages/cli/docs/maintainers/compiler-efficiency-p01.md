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

## S03 addendum: leaf expression-helper sharing screen (24 September 2026)

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

The S03 proposed go criterion required at least 15% fewer declarations **and**
at least 10% lower compiler peak RSS or median compile time beyond measured
spread; optimized Wasm delta was to be reported separately. Declaration
counts passed the first condition, but both the ordinary and duplicate-heavy
fixtures missed the second, and the final Wasm files were unchanged. The
candidate compiler and test edits were therefore removed. **No S03 production
change is proposed.** This negative result closes the leaf-helper family
screen without authorizing a broader family, public syntax change or R01 work.

The selected local evidence commands were:

```sh
node wasm/scripts/run-wasm-tests.cjs --task canonical-native-wasm --report .test-results/compiler-efficiency/s03/canonical-native-wasm-attempt-01.json
node wasm/scripts/run-wasm-tests.cjs --task compiler-efficiency-p02 --report .test-results/compiler-efficiency/s03/after-task-attempt-01.json
node wasm/scripts/run-wasm-tests.cjs --task compiler-efficiency-p03 --report .test-results/compiler-efficiency/s03/p03-parity.json
```

The P02 task was repeated for the three valid baseline and three candidate
samples. Its detailed reports and the one-off stress-driver samples are local
ignored evidence; they are not checked-in benchmark infrastructure. The
passing candidate test and P03 task prove selected semantics for the screened
patch, not a new binary, RSS or request-memory benefit. Human review retains
the G0 and future-work decisions.
