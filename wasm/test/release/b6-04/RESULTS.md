# B6-04 qualification results — 2026-10-04

Implementation is complete; release qualification remains **partial**. The finite
beta.5 application upgrade and both exact candidate consumers pass. A populated
published-beta.5 ES256 guest-cache transition cannot be demonstrated because the
published crypto package contains no guest payload. No acceptance requirement is
waived and no published artifact is modified.

## Source and measurement contract

- Candidate: `e8c55e01754518650c3394c3b58c2351274fdb6e`, clean tree
  `825ce70ae3279f278482bdd8002679561bb6314a`.
- Pre-integration control: `e9bf187d0de0ccc54248a29bca24937d6bed79a9`.
- Node 24.19.0, pnpm 12.4.2, AssemblyScript 0.28.18, json-as 1.5.0,
  Binaryen 129.0.0-nightly.20260428; Linux x64, Xeon Platinum 8573C.
- Frozen external dependency resolutions match. Workspace dependency links differ
  as intended by the integration. Each revision uses its own product modules.
- Two unchanged fixtures, three modes, two fresh compile workers per cell;
  matching cold/repeated artifact identities. Runtime uses ten instantiations
  and 30 request lifecycle samples after ten warmups. A separate process records
  startup/module loading. No real network or Fastly performance claim.
- The final evidence-only commit adds this record and `evidence.json`; product
  and executable harness bytes remain those of the tested candidate above.

## Upgrade and artifact behavior

All 19 published beta.5 packages were fetched and installed with lifecycle scripts
disabled. Installed bytes matched the downloaded tarballs. The finite app built
before replacement. Exact candidate tarballs then replaced packages without
removing `node_modules`, application source, config, data, user state, or cache.
All 89 pre-existing npm content-cache files remained unchanged. A separate fresh
candidate consumer used a new npm cache.

Both candidate consumers passed repeated Native builds, identical fresh/upgraded
artifact hashes, exact package version/byte verification, guest reuse, and
manifest-only cache separation with identical guest Wasm. The finite production
launcher served the expected response. An unsynchronized guest-owner version,
wrong build contract, plan swapped from the other real build, and corrupted
Native bytes were rejected; the planted JavaScript fallback was not executed.
The finite app is 2,030 bytes in the candidate versus 1,920 in published beta.5;
this is a version-transition observation, distinct from the pre-integration
control comparison below. The candidate ES256 example is 36,100 bytes.

The roundtrip check found and fixed order-sensitive `exactValue` comparison in
the guest validator. The compiler emits sorted JSON, while validation previously
compared serialized object insertion order. Objects now compare canonically;
exact values, ordered arrays, trust checks, source/manifest hashes, and no-fallback
rules remain enforced. Focused tests include changed trust values and reversed
export arrays.

### Unclosed historical guest prerequisite

Published `@pulse-compute/crypto@1.0.0-beta.5` tarball SHA-256:
`daab1e13eeaf4f17965943b77cc9b530bcea3e03ce1889e2511874a25a8691b3`.
Its file inventory contains no `guests/` subtree. Building the existing ES256
example fails with `PULSE_GUEST_UNIT_INVALID` because the guest manifest is
absent. The candidate pack contains it and its installed builds pass.

This is a historical payload defect, not evidence of a current cache collision.
The task reports `status: partial` and exits 1, even though both candidate cells
pass. To close the exact historical-cache claim requires a verifiable previously
populated beta.5 guest state, or an explicit release-owner disposition of that
unavailable prerequisite. Candidate cache coexistence is separately proven and
must not be relabeled as the historical transition.

The candidate still has beta.5 version metadata: this rehearsal used exact
hash-bound tarball replacement, not a fictitious published beta.6. Repeat the
version transition after the B6-07 beta.6 snapshot.

## Bounded performance comparison

All 12 cells passed semantic execution and retained-body checks. In each pair,
all non-data Wasm sections are byte-identical; replacing the control's embedded
plan-hash string with the candidate's makes the data section identical too.
The compact app retains one helper body and the history app two partitions,
each reachable from exports with live direct callers. This establishes retained
reuse for these fixtures, not for arbitrary applications.

The first clean run's figures follow. Compile is the mean of two observations;
RSS is the maximum largest-process high-water mark, not simultaneous tree memory.
Request cost includes a fresh instance. Full hashes, startup, instantiation,
request p95 and raw compile/RSS samples are in `evidence.json`.

| App / mode | Wasm bytes, both | Compile ms, control → candidate | Peak RSS MiB, control → candidate | Request median ms, control → candidate |
| --- | ---: | ---: | ---: | ---: |
| compact / default | 43,614 | 2538 → 2487 | 320.2 → 301.4 | 1.55 → 1.68 |
| compact / bounded-size | 34,969 | 2268 → 2209 | 321.9 → 326.1 | 1.60 → 1.55 |
| compact / size | 34,970 | 2732 → 3179 | 337.1 → 338.7 | 1.62 → 1.66 |
| history / default | 75,280 | 3684 → 3524 | 323.2 → 313.8 | 4.03 → 4.39 |
| history / bounded-size | 64,046 | 3311 → 3255 | 321.1 → 325.6 | 3.99 → 4.42 |
| history / size | 64,003 | 4733 → 4862 | 308.2 → 327.8 | 4.11 → 4.43 |

A second serial run resolved the first run's compact converging-size timing
increase (2,732 → 3,179 ms): the repeat measured 2,713 → 2,667 ms. History request
medians in the repeat ranged from roughly 4.17–4.34 ms in the control to
4.10–4.40 ms in the candidate. Default and bounded-size reversed their first-run
increases; converging size remained higher (4.17 → 4.40 ms). All 12 repeated artifacts retained their exact
first-run hashes. Both runs are retained; neither is substituted to hide a failure.

**Proposed regression disposition:** no repeatable compile or default-mode
request regression is established. Keep the converging-size request observation
visible: its median increased about 0.23–0.32 ms (5.5–7.8%) across the two clean
runs. Accept that bounded possible cost for this experimental opt-in mode,
subject to human review; do not call it a speedup or change defaults. RSS varied
without a consistent mode-wide increase. These samples are not a general
production-throughput guarantee. This does not close the historical guest upgrade
prerequisite or constitute a release seal. Human review retains that decision.

## Validation and remaining gates

- Six focused checks passed: guest JSON roundtrip, suite shape, package guest
  linking, materialization, audit diagnostics, and 16-shard evidence authority.
  Tested commit `5e8c0f0c60bf2a4d61325ced2f7fd81bfaf4adc0`; the later executable
  change only adds the mixed-real-plan negative case, exercised by the clean
  upgrade run at the candidate identified above.
- All 40 unit tasks passed in the development run. The subsequent clean combined
  unit/guest replay stopped after three passes on the intermittent process-group
  snapshot failure tracked in issue #181. The focused six-task retry passed;
  it is not a replacement claim for a complete clean unit replay.
- Maintenance, documentation synchronization checks, documentation-release and
  scope checks passed. The scope classifier conservatively requests human review
  for guest-link contracts and release evidence aggregation.
- Hosted Repository validation, Documentation and Maintainer scope passed on
  the executable candidate (`37220941709`, `37220941665`, `37220941620`).
- `release-pr-check` correctly rejects merging changed publishable code into
  `main` while versions remain beta.5. The PR targets `latest`; B6-07 owns the
  atomic version snapshot. No version was bumped to evade that gate.
- Upgrade qualification remains partial as described above. B6-05 conditional
  KV, B6-06 claims/sizes, B6-07 final version transition and B6-08 exact-source
  sealing remain separate. No package publication, deployment or merge occurred.

Development failures remain in their original local reports: harness setup was
corrected, the published-payload limitation retained, and the JSON roundtrip
failure fixed. Final source identities and report hashes are in `evidence.json`.
