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

## P02 packet — measurement and traces (do not dispatch)

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
