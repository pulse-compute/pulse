# O-10 — shared Fastly error-driver settlement

Historical result. PS-07 retired the frozen replay task and local JSON ledger.
The [deletion ledger](../../../../docs/internal/ps07/README.md) maps surviving
coverage and links the original files at an immutable Git revision.

O-10 extracts one per-site settlement branch family from
`__pulse_fastly_run_invocation` into `__pulse_application_settle_effect`.
The helper survives the default optimizer at 1/8/32 sites. At 32 sites, the
combined driver/helper body falls from 12,519 to 2,315 bytes. This is structural
and behavioral evidence; O-11 still owns build-time/RSS and runtime qualification.

Entry point: `provider-fastly`. Class: hardening. Baseline: merged O-09 on
`latest`, `5142725930ef8c481ad16b5b7ca2e8ebaab4ee6f`. Additional evidence owners
are the Wasm compiler-efficiency notes, test registry and suite-shape exclusion.
Provider paths conservatively classify as `provider-registry` and
`runtime-target-fluidity`; their contracts and supported behavior are unchanged.
The user's O-10 direction authorizes this extraction and its tests, not merge
or release authority.

## Implementation

The driver retains an explicit guard for each site's guest pending flag and calls
the helper with that site's literal index. The helper snapshots the existing
provider diagnostic tuple, clears it while resolving and settling that site,
selects the first recoverable error or first fatal override, then restores the
selected tuple before returning. The caller carries the fatal flag between sites.
No callback or guest resume occurs between restoring the tuple and the next
helper clearing it. Every sibling still drains before a fatal exit or resume.

The helper returns `-1` for rejected settlement, `0` for recoverable/no failure,
and `1` for fatal failure. Rejected settlement exits immediately through the
existing error path. Invocation authentication, result ownership and per-site
pending/ready/result globals are unchanged. There is no new heap accumulator,
state array, allocation policy, hostcall, optimizer flag or retention annotation.
Resolver and other result-adapter families are unchanged. The helper is only
emitted for an application error route with effect sites.

The existing request-budget instrumenter matches the literal `if (fatal) return`
exit. That boundary is preserved. A regression in
`assert-fastly-request-budget.cjs` checks the budget integration on generated
error-driver source and runs grouped timeout, transport-failure and success
cases. It remains part of the existing `fastly-native-platform-capabilities` task.

## Structural result

The retired `fastly-driver-factoring-o10` task reused O-08's fixtures, compiler
worker and inspector. Captured source/recipe hashes confirm O-08's implementation
matches the pre-factoring O-09 base. Each new production binary is compared with
a names-enabled companion: every non-custom section must be byte-identical
before symbol attribution. At 8/32 sites, the driver has exactly one direct call
per site to one shared helper. The invocation-settle wrapper is inlined into
that helper; the helper calls the real guest result setter. Source declaration
sharing alone is not the proof.

| Control | Source bytes, before → after | Raw Wasm, before → after | gzip, before → after | Driver + helper body, before → after |
| --- | ---: | ---: | ---: | ---: |
| 1 site + error route | 126,217 → 126,497 | 69,121 → 69,201 | 25,367 → 25,393 | 1,612 → 1,444 |
| 8 sites + error route | 152,610 → 146,093 | 73,695 → 71,407 | 26,294 → 26,068 | 3,825 → 1,690 |
| 32 sites + error route | 244,047 → 214,094 | 88,732 → 78,350 | 29,032 → 28,225 | 12,519 → 2,315 |
| 32 sites, no error route | 157,878 → 157,878 | 72,829 → 72,829 | 26,729 → 26,729 | 1,225 → 1,225 |

The one-site module grows by 80 raw bytes and 26 gzip bytes despite its smaller
combined driver/helper body. The 32-site control saves 10,382 raw bytes (11.7%)
and 807 gzip bytes (2.8%). The no-error-route source and production Wasm hashes
are identical. These synthetic controls do not predict whole-application savings.

## Behavior and reproduction

O-09's fixture and assertions remain unchanged. Its 42 HTTP scenarios, 14
injected error-priority scenarios and four ticket-probe suites pass. All scenario
and probe summaries, including hostcall-trace and diagnostic-event hashes, match
the checked-in O-09 baseline exactly. That comparison covers 42 rejected ticket
operations and 11 accepted manual settlements as well as real Router execution.

```bash
node wasm/scripts/run-wasm-tests.cjs --task fastly-driver-behavior-o09 --no-report
```

[The archived o10-evidence.json](https://github.com/pulse-compute/pulse/blob/8f2b02b3815ff144b94d59b01f809e7793be67c5/wasm/test/runtime/compiler-efficiency/o10-evidence.json) records source/artifact identities,
per-control sizes, direct edges and terminal status. The structural runner needs
the recorded pre-factoring commit available in local Git history; its
[original reproduction commands](https://github.com/pulse-compute/pulse/blob/8f2b02b3815ff144b94d59b01f809e7793be67c5/wasm/test/runtime/compiler-efficiency/o10-driver-factoring.md#behavior-and-reproduction)
belong to that historical checkout. Full binaries,
named companions, disassembly, graphs and timestamped running/passed/failed
reports remain under `wasm/.test-results/compiler-efficiency/o10/`. Failed
prototype attempts are retained separately; retries corrected inspector access
and an overly strict expectation that the invocation-settle wrapper itself
would remain uninlined. A deadline-fixture retry corrected the mock's fetch-delay
option. None changed O-09's oracle.

Validation includes the complete unit profile, TypeScript build, maintenance
check, the two O-series tasks, the six Fastly provider-entry-point tasks, and application-error conformance
across Native/JavaScript targets plus continuation error boundaries.
The deadline regression adds error-route coverage to the platform task.
Evidence uses the deterministic mock host, AssemblyScript 0.28.18 and strict
json-as 1.5.0. No Viceroy, deployed Fastly, complete release replay, diverse
negative control, compile-time/RSS, module construction or `_start` performance
claim is made here. Those qualification axes remain with O-11.
