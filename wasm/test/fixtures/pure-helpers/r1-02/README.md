# R1-02: independent helper validation with explicit policy

Task class: behavior-preserving refactor. Base: Pulse `latest`,
`afce9f129d5c8e80099178261cbce0da6e3bb263`.

`source-helper-plan.js` re-derives operand, provenance and ownership facts after
serialization, then consumes the bounded vocabulary's operator/field/index
result facts. It loses its binary/unary result tables. Its explicit admission
policy preserves scalar callee operands, numeric arithmetic, numeric-array-only
callee indexing, and the caller's existing scalar coercion and optional-string
defaults. `in`, `void`, mutation/escape of borrowed state and callee string
indexing remain excluded. Recomputed hashes and producer tags grant no proof.
The public Native plan validation seam and all runtime/generator owners remain
byte-unchanged.

The final characterization has 521 serialized-plan cases: 320 accepted and 201
rejected. It also compiles 107 accepted scalar expressions together, checking
producer result tags against literal expectations and independent validation.
The baseline and candidate reports match exactly, including diagnostic lists,
seven source acceptance/rejection examples, generated source and plan hashes,
and the representative 2,187-byte Wasm artifact. This is output equivalence,
not a size-optimization claim.

Run `node wasm/test/fixtures/pure-helpers/r1-02/characterize-baseline.cjs` to load
only the two product variables from the pinned Git objects before running the
same characterization. Run `node wasm/test/lowering/assert-pure-helper-vocabulary.cjs`
for the candidate. Both need the pinned workspace dependencies; the baseline
also needs the base Git object. This small comparison driver is development
evidence, not a second validation implementation or release replay.

The manifest records commands, exact source hashes, checkpoints, failed test
construction and terminal gates. The original five-task baseline run predates
the test extension; the focused seven-task run predates its final 13 additional
boundary cases and producer corpus. The complete four-profile replay passed all 106 tasks. Maintainer, documentation,
documentation-release and TypeScript checks passed. No merge, release, ABI, optimizer, loop-limit or application change
is authorized by this task.

## Terminal evidence and limits

The product implementation diff is two files, 40 added / 27 removed lines.
The Native plan validation seam, source resolver, generator/runtime contracts,
loop caps and test registry are byte-unchanged. Canonical architecture guidance
was synchronized into its installed CLI copy through `npm run docs:sync`.

All 22 CLI tasks are covered across three serial development runs: 20 passed,
and two byte snapshots failed. Fresh runs on the clean pinned base fail with
the same numbers:

| Snapshot | Expected | Clean base | R1-02 | Delta |
| --- | ---: | ---: | ---: | ---: |
| 05 Fastly provider Wasm | 47,135 B | 47,185 B | 47,185 B | 0 B |
| 09 application guest Wasm | 9,762 B | 9,157 B | 9,157 B | 0 B |

The CLI gate is **not passed**. Its assertions/goldens are unchanged. Snapshot
upkeep is a separate follow-up; S-01 remains the next implementation capability.
This is a refactor equivalence result, not an application sharing/size claim.

The full replay and CLI reports identify implementation commit
`696e3210bc6b19234968e231734e185cd3389f09`. Final changes after that commit are
evidence only. Exact tested code hashes are retained in the manifest; reports
are not relabeled as final-head CI or a release seal. Aggregate transcripts
preserve passing task output; per-task temporary log paths in raw JSON remain
original locators. Failed-task logs are retained separately. The first broad
attempt stopped after 19 passes because Crypto had not been built; the same
unchanged code passed a complete replay after the workspace build.

Node 24.19.0, TypeScript 5.9.3, AssemblyScript 0.28.18, json-as 1.5.0 and
Binaryen 129.0.0-nightly.20260428 were used with the unchanged lockfile.
Existing pinned dependency roots were physically copied into isolated candidate
and baseline worktrees. No production dependency or supply-chain setting was
changed. This is development validation, not a distributable/release seal.
