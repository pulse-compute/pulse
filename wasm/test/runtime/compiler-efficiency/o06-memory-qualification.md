# O-06 — Qualify the parser copy removal

**Qualified for the fixed 64-page O-02 Fastly Native workload.** The O-05
unescaped-string change exceeds O-04's 10% decode-allocation gate and does not
exceed its 5% median request-time regression gate in the injected Fastly ABI
harness. This is an evidence-only ticket. Entry point: none, ordinary root/Wasm
evidence chain; additional owners are the test registry and suite-shape exclusion.
No production code, allocator policy or public target claim changes here.

The baseline loads the unmodified Fastly provider owner from O-04 merge
`5bdc28aafab76c87abea4320154768e6277fbea9`; the candidate is O-05 merged
on `latest` at `4860ad767a55f29d97f770f19ce0b9fd7c7bfdcb`. All other
production dependencies come from the same lockfile and checkout. The Node
project plan and 64 fixed 4 KiB S3 pages are shared. Three independent child
processes compile each mode; source and production-Wasm hashes agree across all
three pairs and with O-05's sealed evidence. The generated source hashes are
`5faee9ca4a9955dbe0dfe9141c92fe0addd468648f4f5b4f80125a272ba44c8c`
and `a3672842cb6df878d7d0312d71cdd216d673c13a95b59c4e5218c277ab235795`.
The production-Wasm hashes are
`fa695a33be62922960d5179ed17e9429c46a0c895ed239613c1c0a28277a1c26`
and `e974c4a1804cd1c55a97f2dfdacf575fbd46dd43d2233db6f957b6805c360023`.

| 64-page measure | O-04 baseline | O-05 candidate | Interpretation |
| --- | ---: | ---: | --- |
| Parse-through-freeze decode allocation | 5,001,536 B | 3,920,128 B | 21.6% less; primary gate passed in each build |
| Whole-invocation allocation | 19,327,168 B | 18,245,760 B | 5.6% less |
| Peak outstanding guest blocks | 9,384,832 B | 9,523,008 B | 138,176 B higher (1.47%) |
| Post-collection guest blocks | 5,807,424 B | 5,807,424 B | Same retained estimate |
| Guest linear-memory capacity | 14,417,920 B | 14,417,920 B | Same 220-page high-water mark |
| Host process peak RSS median | 113,895,424 B | 113,936,384 B | 40,960 B higher; within observed noise |
| Production Wasm | 115,076 B | 115,161 B | 85 B larger |

Guest allocation is cumulative TLSF block volume. Peak outstanding and
post-collection blocks are diagnostic allocator estimates; linear-memory
capacity is a different measure. RSS is the fresh Node host process's lifetime
high-water mark, including module loading. The flat page high-water mark and
slightly higher guest peak preclude a lower peak-memory claim.

Runtime samples execute one request in each fresh Node process. Timing surrounds
the injected Fastly ABI call, including Wasm instantiation and host callbacks,
and excludes process startup and fixture preparation. Each build initially has
five serial, alternating baseline/candidate pairs. A fixed-seed, 4,000-resample
paired bootstrap gave an inconclusive upper bound after 15 pairs, so the
predeclared protocol extended to ten pairs per build: **30 paired samples, 60
fresh request processes**. Build 1 reverses the within-pair order to balance
ordering drift. Every sample checks exact response, full hostcall-trace hash,
outbound count, cumulative byte/value charges and 64 pending-send/wait handoffs.

| Runtime statistic | Result |
| --- | ---: |
| Baseline median | 76.129 ms |
| Candidate median | 73.233 ms |
| Candidate/baseline median ratio | 0.962 |
| Paired median ratio, 95% bootstrap interval | 0.972 [0.940, 1.043] |
| Gate | Median ratio ≤ 1.05 **and** paired interval upper bound ≤ 1.05: passed |

The observed median is 3.8% lower in this harness, but the interval still
allows a small regression. It does not establish a speedup across deployments
or workloads. The fixed protocol distinguishes the first noisy set from the
final result; it was not tuned after seeing the outcome.

For each build pair, additional requests exercise malformed JSON (error 1004,
stage 3, no following page fetch) and a failed S3 transport (503, no following
page fetch). Baseline and candidate agree on error, response, trace, effect
ordering and charges. The successful 64-page control carries the request state
across asynchronous pending requests and digest/decode operations. O-05's direct
parser, alias, freeze and byte-limit regressions remain in the permanent
Fastly provider task; O-06 neither widens the grammar nor substitutes for that
coverage.

Run the opt-in evidence task from a checkout containing the O-04 merge:

```sh
node wasm/scripts/run-wasm-tests.cjs --task memory-qualification-o06 --report .test-results/o06-qualification.json
```

The checked-in [`o06-evidence.json`](o06-evidence.json) records all build,
control and sample rows, source hashes, toolchain identity, protocol, RSS,
metric definitions, decisions and limitations. The same complete report is
written to `wasm/.test-results/compiler-efficiency/o06/measurements.json` by the
task. It uses synthetic example domains and no real provider credentials.
This is controlled local ABI evidence, not Viceroy, deployed Fastly latency,
Node Native guest evidence or broad memory/throughput acceptance.
