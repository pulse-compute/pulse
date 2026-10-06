# PS-03: test cost and coverage ownership

Repository-only implementation evidence. This is development qualification,
not a complete release seal. The source base is
`a48c8dfd2ced3ba286315bbcb635d1e555e962a4` (`latest`, PS-02).

## JWT assertion ownership

Only successful `doctor`/`inspect` repetitions are removed. No semantic fixture,
key width, supported target, build, harness test, dev request, negative assertion
or composition outcome is removed.

| Assertion or boundary | Retained owner |
|---|---|
| Installed doctor and inspect command behavior on Node/Fastly Native/JavaScript | RS256 fixture, all four profiles |
| HS256/ES256 target admission formerly checked by installed doctor/inspect | Each algorithm's four real builds and tests; the build/test entrypoints enforce selected-target eligibility |
| Ten installed rotation, wrong-key, signature mutation, malformed signing and recovery cases per algorithm/target | All 12 installed `test` cells: 120 cases |
| Installed signature correctness independent of Pulse | All 12 dev requests still call the Node crypto oracle; all four target/provider adapters remain exercised |
| Exact Native build bytes match harness execution; private signing bytes excluded from every output | All 12 installed builds and each Native cell's Wasm digest comparison |
| Installed package closure, no workspace links, tarball identity and immutable installed bytes | Existing before/after verification and loopback registry checks |
| Installed cleanup, cancellation, isolation and redaction | Unchanged `installed-cleanup.mjs` for all three algorithms |
| Composition eligibility, including documented rejections | All 20 installed build outcomes: 12 builds and eight expected rejections |
| RS256 signatures, malformed keys/claims, padding, limits, tampering, parallel issuance, ES256 composition and redaction | Unchanged 146 semantic executions for each of 2048/3072/4096 bits: 438 total, all four targets |
| RS256 JavaScript inspection at every key width | Combined form, both JavaScript profiles at 2048/3072; combined workflow at 4096 |
| RS256 inspection command and target boundaries | Combined 4096-bit form, all four targets; every negative inspection remains |
| Signing-only needs no static verification artifact; verification-only needs no signing credential | Fastly Native direct execution at all three widths; all three 4096-bit forms still build and run their harness on every target |
| RSA private fixture bytes excluded from every workflow build | Every 4096-bit form/target build is still scanned |

The JWT observer lives under `wasm/test/jwt/`. It times each installed CLI
command and each workspace toolchain operation. It wraps only synchronous
AssemblyScript subprocess calls, recording count, failed subprocess count and
elapsed time; it does not infer compiles from CLI verbs or claim to count
frontend planning, guest linking or execution. Installed children preload a copy
outside the checkout, and package bytes are checked afterward. Temporary paths,
source, secrets and command output bodies are not compiler metrics.

## Shared-corpus assertion ownership

Release selects 160 tasks instead of 165: six workspace full replays are replaced
by their already-required installed owner, plus one inexpensive source-index task.
The five groups below all require `clean-machine-acceptance` to pass. Full
workspace tasks stay registered and in their native/conformance development
profiles, including direct task selection. A workspace-only rerun cannot replace
a missing or failed installed owner.

| Group and development task | Shared entrypoint and retained assertions | Installed-specific owner and option differences |
|---|---|---|
| S3: `s3-native-read`, `s3-write-conformance` | `s3/run-native-read-acceptance.cjs`, `s3/run-write-acceptance.cjs`: same row generation, exact three-target outcomes, binding preservation, independent SigV4, limits, cancellation, no retries, redaction, ABI imports and Fastly JavaScript rejection | `s3/assert-packed-consumer.cjs`: candidate conformance JSON and installed exports replace workspace paths; public types, support tier/entrypoints, exact installed bytes and module-cache isolation are additional assertions. ABI host fixture is the sole allowed workspace product-path exception. |
| Request deadlines: `request-budget-transport` | `runtime/request-budget-transport.cjs`: six target cases, cumulative S3 budget, dispatch/timer assertions, actual Native/JavaScript HTTP body admission | `release/assert-request-deadline-packages.cjs`: same corpus with installed toolchain; public types, complete closure, altered-tarball rejection, regenerated Wasm, stale duration-artifact rejection, explicit Fastly JavaScript rejection and module isolation remain. |
| Multifile: `multifile-source-identity` | `crypto/assert-multifile-source-identity.cjs` and `shared-handler-effects.cjs`: source/order ownership, repeated calls, continuation identity, missing contribution rejection, deterministic metadata, 12 multifile plus 18 shared-handler executions on three targets | `release/assert-multifile-packages.cjs`: installed mode additionally checks six independent build/regeneration artifact cells and closure/isolation. It skips `assertSourceIndexes`; the new `multifile-source-indexes` unit/release task owns those exact unchanged assertions. Full workspace mode still executes them. |
| HTTP input: `http-input-outcomes` | `runtime/http-input-outcomes.cjs`: same 104 outcomes, bounds, response/commit counts, before/after-commit failures and actual Node HTTP admission | `release/assert-http-input-packages.cjs`: installed toolchain, exact 104-row count, closure, altered compiler rejection and module isolation. No workspace-only behavioral branch. |
| Conditional KV: `kv-conditional-adversarial` | `kv/run-k4-consumer.cjs`: same Node Native/JavaScript adversarial scenarios, before/after-commit lost acknowledgement, dispatch count, stored-value checks and Fastly ABI/import assertions | `kv/assert-packed-consumer.cjs`: installed toolchain, public types and exact unchanged package bytes; `compute:false` matches the workspace release task. External `--compute` and deployed cross-location qualification remain separate and required under existing policy. |

Only fixture setup/cleanup and module resolution differ in the shared branches,
except the explicitly split source-index assertions and the additional installed
checks above. The workspace `compileFastly` helper and installed `buildProject`
path both reach the provider's canonical Native build; the installed helper also
checks the emitted Fastly request ABI import. These are ABI-fixture observations,
not external provider reality.

Clean-machine acceptance now retains an atomic `corpora.json` with source/tree,
working-tree state, candidate package hashes, wrapper hashes, elapsed time and
full outcomes for all seven internal replays (including the unchanged read-loop
and adoption gates). Failed and not-run cells remain visible. A missing or
repeated corpus is rejected. The existing runtime, lowering, package-effects and
Fastly evidence shards require this installed owner; a failed/missing owner is
covered by negative authority tests. Cleanup remains supervised by the task
runner and is required for the outer task to pass.

## Assets filter repair

The registry previously joined `sigv4.test.ts` and `embedded.test.ts` into one
nonexistent path. They are now separate Vitest arguments. Every literal Vitest
filter is checked as an existing file by `suite-shape`; the file list is metadata
and does not eagerly resolve Vitest during dependency-free release preflight.

## Measurement and validation

One successful completed task sample per variant on the same workstation,
Node 24.19.0, pnpm 12.4.2, TypeScript 5.9.3 and AssemblyScript 0.28.18:

| Task | Before | After | Actual AssemblyScript invocations |
|---|---:|---:|---:|
| `jwt-rs256` | 340.755s | 287.080s | 63 → 51 |
| `jwt-installed-workflow` | 358.631s | 299.622s | 68 → 48 |
| Combined JWT | 699.386s | 586.702s | 131 → 99 |
| Assets runtime task | 0.757s, 68 tests / 4 files | 0.817s, 91 tests / 6 files | Not measured |

JWT elapsed time fell **112.684s (16.11%)**, with **32 fewer AssemblyScript
invocations (24.43%)**. Installed CLI time alone fell from 329.856s to 258.732s;
its npm installation increased from 20.877s to 32.598s. Builds, tests and dev
commands remain 32/12/12 in installed acceptance; doctor and inspect each fall
from 12 to four. These are single local samples with fresh generated keys and
fresh installed consumers, not a complete-seal speedup estimate or a performance
threshold. Workspace dependencies were reused, with local package links directed
at each checkout; a fresh release dependency restoration was not performed.

[measurements.json](./measurements.json) retains source and report identities,
terminal task results, every RSA width, installed command timing/counts, semantic
cell summaries, composition outcomes and installed package digests. Baseline
RSA uses instrumentation commit `4266782bfc288336a56f59f04a633dc91fe4176c`;
baseline installed/Assets uses `1787af3ff2f6ecbe303bf2c39aac0a006069664b`.
The latter only corrects the observer's configuration transport. Both start
from the PS-02 source. After runs use
`a5ab13ec0a83ff7daa85ae756ec42c4eb6570786`; subsequent changes only record
this internal evidence. The successful RSA tasks are retained from parent
attempts that subsequently failed during installed setup, with those parent
statuses preserved. They are valid focused task observations, not complete
multi-task or release receipts.

[validation.json](./validation.json) records **45/45 selected tasks passed** in
283.934s on that same after revision: all 42 unit tasks, clean-machine acceptance,
the full standalone multifile task and release evidence authority. Clean-machine
acceptance completed in 218.732s, retaining all 19 candidate package identities,
seven passing corpora, and the rest of its clean-project workflows. Its measured
internal corpus costs are:

| Corpus | Elapsed | Retained outcomes |
|---|---:|---|
| S3 | 24.996s | 68 read cases / 204 executions; 40 write cases / 114 executions, plus cancellation and admission assertions |
| Request deadline | 10.841s | Six target cases and two real HTTP admission cases |
| Multifile/shared handlers | 38.742s | 12 + 18 executions; six artifact/regeneration cells |
| HTTP input | 12.240s | 104 outcomes |
| Read loops | 10.887s | 53 checks |
| Read-loop adoption | 16.094s | Four passing rows |
| Conditional KV | 5.998s | Both Node target scenarios and ambiguous-completion checks, plus Fastly ABI assertions |

These installed costs are not estimates of workspace replay savings. No second
full seal was run to measure the selection change.

Failed setup attempts remain distinct in the measurement ledger. An initial
observer environment variable was rejected by the documentation guard; the
observer now receives its output path through a copied preload script. pnpm's
local dependency-state check attempted an automatic installation and rejected
unapproved esbuild lifecycle scripts. Documentation dependency links were
repaired after that attempt. Subsequent commands used the existing graph with
`npm_config_verify_deps_before_run=false` and `npm_config_ignore_scripts=true`;
no dependency lifecycle scripts were approved. Completed in-checkout RSA and
multifile fixture directories were explicitly removed between local task groups.
Successful installed and clean-machine samples recorded clean Git source.

Workspace build, maintainer checks, documentation synchronization/site checks,
documentation release integrity, release preflight, fast/portable CI selection
contracts and scope consistency checks passed. The source-index task and missing/
failed installed-owner rejection also passed. The complete release seal, full
CLI profile and external Fastly reality were not run. Generated CLI documentation
was validated through its canonical synchronization and documentation checks.
