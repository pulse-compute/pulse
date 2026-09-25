# W01: repository validation latency baseline

Captured 2026-09-25 UTC from four completed, successful pull requests into `latest`. This is a dated evidence packet for a faster non-`main` validation tier. It changes no workflow, policy, test membership, runtime behavior, or release gate. Entry point: none (repository CI evidence under the ordinary root and `wasm/` instruction chain).

## Source and method

The sample is the four most recent completed `Repository validation` pull-request runs at collection time. The later MEM02 run was still in progress and is excluded. A cancelled B02 attempt is excluded. Each sampled run has terminal success. The workflow checks out `refs/pull/<number>/merge`; the full merge SHA below was resolved from the checkout log and verified to have the recorded base and head as its two parents. The SHA exposed as a workflow run's `head_sha` is the PR head, not the checked-out merge commit.

| PR | Base SHA | Head SHA | Tested merge SHA | Validation evidence |
| --- | --- | --- | --- | --- |
| [#84](https://github.com/pulse-compute/pulse/pull/84) MEM01 | `70f4914cb14e61623b56f8a58b8d1fedf46ac6bf` | `bc9730fd63622149c4e32920a71d79d6dba8a2e5` | `b560815c02ce4b3fc3c91b2369119ede160085bc` | [run 36083555788](https://github.com/pulse-compute/pulse/actions/runs/36083555788) |
| [#83](https://github.com/pulse-compute/pulse/pull/83) SC02 | `30f57a592ecee613f0e4c0793ed32d33aae511a6` | `2bc9db4fe40da98fa358822c036970438d74e599` | `554f41ebfeeda2214c2a5ac545cf57a2441f28d0` | [run 36073266932](https://github.com/pulse-compute/pulse/actions/runs/36073266932) |
| [#82](https://github.com/pulse-compute/pulse/pull/82) SC01 | `896289c034cc3bd618bd1142c46387dc7ab9d495` | `79c5849b2b4b40569ab6cc1f2b6cce5fd4fe9442` | `e407b2f1c6943934c738d3b7d9dc906520910fbc` | [run 36069732907](https://github.com/pulse-compute/pulse/actions/runs/36069732907) |
| [#81](https://github.com/pulse-compute/pulse/pull/81) B03 | `e2a289b7ba2baf7375533fbd21b453c4707271a4` | `7bee68c6cd77eff91ae184eae00d07c1c2965605` | `494218b9d500b5e5b76affca7980220c98c7a333` | [run 36064838141](https://github.com/pulse-compute/pulse/actions/runs/36064838141) |

The next table measures arrival from each run's `created_at` to its terminal `updated_at` or, for maintenance and Node 22, the job's `completed_at`. These API timestamps are rounded to seconds and include queue/teardown effects. The scope and documentation columns use their separately dispatched runs at the same head SHA and event time; later declaration-edit reruns are excluded.

| PR | Scope | Documentation | Maintenance | Node 22 | Complete repository validation |
| --- | ---: | ---: | ---: | ---: | ---: |
| #84 | [18 s](https://github.com/pulse-compute/pulse/actions/runs/36083555792) | [28 s](https://github.com/pulse-compute/pulse/actions/runs/36083555789) | 7 s | 40 s | **20m 45s** |
| #83 | [13 s](https://github.com/pulse-compute/pulse/actions/runs/36073266926) | [34 s](https://github.com/pulse-compute/pulse/actions/runs/36073266927) | 9 s | 40 s | **16m 13s** |
| #82 | [13 s](https://github.com/pulse-compute/pulse/actions/runs/36069732927) | [31 s](https://github.com/pulse-compute/pulse/actions/runs/36069732898) | 9 s | 41 s | **16m 16s** |
| #81 | [11 s](https://github.com/pulse-compute/pulse/actions/runs/36064838030) | [30 s](https://github.com/pulse-compute/pulse/actions/runs/36064838061) | 8 s | 47 s | **19m 52s** |

The next table uses each portable job's rounded step timestamps for install/build and the terminal `total` in its log for each serial profile. The two named tasks are contained within conformance, so their times must not be added to its total.

| PR | Install | Build | Unit | Native | JavaScript | Conformance | `jwt-rs256` | `schema-codecs` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| #84 | 5 s | 3 s | 34.23 s | 255.79 s | 23.82 s | 911.79 s | 461.09 s | 127.25 s |
| #83 | 4 s | 2 s | 27.31 s | 200.83 s | 17.75 s | 711.18 s | 368.42 s | 95.79 s |
| #82 | 5 s | 2 s | 26.92 s | 200.40 s | 17.59 s | 712.50 s | 367.98 s | 96.08 s |
| #81 | 5 s | 2 s | 30.48 s | 244.92 s | 21.72 s | 875.86 s | 454.94 s | 117.42 s |

The task/profile values are in the portable job logs: [#84](https://github.com/pulse-compute/pulse/actions/runs/36083555788/job/107910438314), [#83](https://github.com/pulse-compute/pulse/actions/runs/36073266932/job/107878785806), [#82](https://github.com/pulse-compute/pulse/actions/runs/36069732907/job/107867632238), and [#81](https://github.com/pulse-compute/pulse/actions/runs/36064838141/job/107852077703). GitHub may eventually expire job logs; run IDs, full source identities, and measured totals remain here.

## Attribution and target for C01

- The four full run times span **16m 13s–20m 45s**, median **18m 04s**. The existing scope, documentation, maintenance, and Node 22 checks all finished within **47 seconds** of their respective PR events.
- Install plus TypeScript build occupied **6–8 seconds** in the portable job. The four serial profiles consumed approximately the entire subsequent test step. Conformance was **74–75%** of that step; `jwt-rs256` alone was **51–52%** of conformance. Dependency caching cannot remove the measured dominant cost. Running the existing profiles in parallel would still leave an **11m 51s–15m 12s** conformance critical path on these samples.
- For the agreed fast tier on branches other than `main`, set a **provisional end-to-end target of at most five minutes** on representative evidence, compiler/runtime, and provider/package PRs, measured from PR event to all required fast contexts terminal. Three minutes is a stretch target, not a current measurement. Record every selected task, its terminal result, the tested PR merge SHA, and any exclusions. Targeted tests must be selected from the trusted base policy and a fixed cross-target core; unknown/protected changes must fail closed rather than report an incomplete fast pass as complete coverage.
- A PR into `main` still requires the full portable profiles, Node 22, maintenance, documentation, and scope checks before human merge; the separate release seal and external-provider acceptance remain separate. This baseline does not justify dropping a conformance task from that gate. Full-main speed work is optional given the accepted 15–20 minute range.

This four-run sample measures GitHub-hosted CI under differing PR workloads. It does not establish a p95, runner-normalized performance comparison, or task-level selection policy for C01.
