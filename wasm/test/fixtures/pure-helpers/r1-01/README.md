# R1-01: bounded helper inference ownership

Task class: behavior-preserving refactor. The base is Pulse `latest`
`6c33e869198c4fea23325b20e58d1c24bdf98f04`, tree
`bb79646fe9174d86572b6e37b6b7b1b55be3e7b1`. `manifest.json` records the
tested source hashes, commands, checkpoints, gate status and next action.

## Ownership removed and retained

`pure-helper-values.js` owns scalar kinds, record depth/field limits, prohibited
field names, structural equality, field/index result facts, and operator result
facts. `canonical-native-plan.js` loses its binary/unary result rules. The
contained TypeScript adapter in `spine/pure-helper-source.js` consumes the same
scalar vocabulary and borrow limits.

Two existing fact boundaries remain explicit: dynamic plan kinds versus
reconstructed structural types. Their optional-string default direction,
structural equality and `in` results are preserved. These are inference facts,
not admission. `source-helper-plan.js` is unchanged and independently proves
callee operations and caller provenance. Aligning that validator is R1-02.

String indexing illustrates the current boundary: the reader infers `string`
for a numeric string index and proven caller projections pass, but the pure
helper-body validator still rejects the same operation. The new test retains
that exact rejection. R1-01 adds no accepted operation or value family.

## Evidence and reproduction

Run from the repository root with the pinned workspace dependencies available:

```sh
node wasm/scripts/run-wasm-tests.cjs --task pure-helper-vocabulary --task pure-helper-contract --task pure-source-helpers --task pure-record-helpers --task pure-loop-helpers --task pure-argument-helpers
node wasm/test/fixtures/pure-helpers/r1-01/compare-inference.cjs
```

The frozen comparison driver reads baseline rules from the pinned Git object;
it needs that object in the clone. It is development evidence, not a second
product rule implementation or a benchmark framework.

`before.json` and `after.json` match exactly: 16 shape cases, 39 operation
cases, seven accepted plan/generated-source identities, seven rejection
diagnostic lists, and one representative Native artifact. That fixture is
2,187 bytes, SHA-256
`1bf15db834f072f3068794d7cf962ac0a5ddab28278302b067fd101f1b19ecf5`.
Its AssemblyScript source SHA-256 is
`f9504c8e8bd218296894da1163295b26c226f1da657b44fa84c06849ab3c3529`.
This proves the fixture's output identity; it is not an application-size result.

`inference-comparison.json` retains 3,146 proven-type, 3,146 plan-kind and 99
index comparisons against the pinned implementation. All 6,391 match.
`baseline-report.json` and `baseline.log` retain the five passing pre-change
helper tasks. Final validation reports/logs and failed attempts are indexed in
the manifest when terminal coverage is checked.

The final four-profile development replay completed **106/106 passing tasks**.
Maintainer, documentation, documentation-release and TypeScript checks passed.
The reports retain the pinned base revision; the product/test diff was
uncommitted at launch. The manifest identifies the implementation commit and
tested file hashes without rewriting report identities.

All 22 CLI tasks were covered across three serial development runs: 20 passed,
and two documentation byte snapshots failed. Both failures reproduce with the
same numbers on a clean checkout of the pinned base:

| Example | Documented bytes | Clean baseline bytes | R1-01 bytes | Delta |
| --- | ---: | ---: | ---: | ---: |
| 05 Fastly provider Wasm | 47,135 | 47,185 | 47,185 | 0 |
| 09 application guest Wasm | 9,762 | 9,157 | 9,157 | 0 |

The CLI gate is **not passed**. `cli/summary.json` indexes the current and
baseline failure reports; assertions and goldens are unchanged. Updating those
stale snapshots belongs to a separate follow-up. This is not a release seal.

## Execution environment

Node is 24.19.0. The workspace lockfile SHA-256 is
`4c184d78e2ab5e3224bfdc19b8d34830c8a17ef349ad9923f651c5da28cda0f8`.
Existing lockfile-pinned dependency directories were physically copied into
the clean worktree, then TypeScript was built with the installed compiler.
Fresh offline pnpm installation was blocked by absent registry metadata; no
supply-chain setting was disabled and no new dependency was installed.

The sandbox reported `spawnSync EPERM` for a successful native subprocess and
the documentation mock/highlighter subprocesses. Existing commands passed when
run outside that sandbox. Failed attempts are retained separately and excluded
from passing gate claims. No compiler errors, validation rules or bounds were
suppressed. This is development validation, not a release seal or package
activation. Merge and release remain human decisions.
