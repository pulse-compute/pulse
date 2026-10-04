# B6-07-F01: native-expansion doctor middleware contract mismatch

**Resolved in `3c220e9b33bdd336173531d8194f697ccac2119d`.** The user explicitly
requested “Resolve B6-07-F01, update PR 185.” This follow-up is CLI diagnostic/test
hardening within the existing MW01/MW02 contract. Entry point: `project-workflow`,
with the additionally authorized internal expansion inspector, focused assertion
and B6-07 evidence paths. The original failure was pre-existing on latest;
the historical reproduction below remains intact. The Viceroy exception is
unrelated and unchanged.

## Resolution

The current architecture contract already admits eligible middleware into
retained Native stages. The O18 middleware fixture has two registrations and
one stage body. The projection counted these correctly; its blanket explanation
excluding middleware and the test's expectation of two bodies were stale.

The inspector now describes absent stage bindings only for actual unretained
middleware/error registrations. The regression validates the serialized plan,
matches both middleware entry IDs to the stage registrations, and checks distinct
next cursors, effect IDs and continuation IDs. Retained middleware reports one
body, no expensive-unshared warning, and passes ordinary and strict doctor.
Disabled sharing still reports two bodies. Genuinely duplicated terminal handlers
still warn normally, fail strict doctor, and explain private body ownership in
human output. Configured fixture cases prevent an unrelated missing-test warning
from masking these strict outcomes. Determinism, non-mutation, unavailable-plan,
bounded-owner/byte accounting, JavaScript advisory and compiler-failure coverage
remain enforced. Compiler lowering and optimization defaults are unchanged.

The complete clean-source unit profile passed 40/40 tasks and the complete CLI
profile passed 24/24 in one uninterrupted run, including all 15 focused doctor
checks. Maintainer, generated-documentation, documentation-release, scope and
release-PR checks passed. [f01-validation.json](f01-validation.json) records the
fix commit/tree, complete terminal reports, development retry and check outputs.
The original [validation.json](validation.json) is unchanged; its failed and
resumed attempts remain historical evidence, not a pooled passing profile.

F01 is closed. B6-08 still owns the fresh complete release replay and artifact
seal; this follow-up does not complete publication or deployed qualification.

## Historical reproduction and control

On clean beta.6 snapshot `ee62a2068b4a1574a5f7af27b19915829d8e15be`:

```sh
node wasm/scripts/run-wasm-tests.cjs --task cli-expansion-doctor \
  --report .test-results/cli-expansion-doctor.json
```

`wasm/test/cli/assert-cli-expansion-doctor.cjs:53` expects two Native body
instances for the two-registration middleware fixture. Registration count is
still two; the inspected plan reports one body instance, causing `1 !== 2`.
The profile stopped after three passes and this failure. This is a report/test
contract mismatch; it does not establish an application execution regression.

Detached control `4aa5d3de9fbd2429ed3331522f6cca18aa6a58f1` reproduces the exact
same assertion/values. Frozen external dependency backing was reused; workspace
package links point into the control checkout. A module-resolution guard rejects
loading snapshot product modules. It observed 327 control-source modules.
The relevant fixture, inspector, compiler plan and assertion source bytes are
unchanged between latest and the snapshot. The machine record retains the
failed profile, control log/guard identities and relevant source hashes.

## Original acceptance scope (satisfied above)

Owner: CLI reporting/testing, with the current compiler plan contract as evidence.
Start from `wasm/test/cli/assert-cli-expansion-doctor.cjs`,
`wasm/packages/cli/src/internal/native-expansion.js`, the O18 fixture and the
current canonical Native plan. Establish the actual middleware body and
registration ownership first; determine whether the test, report projection or
both need correction. Do not assume that changing an expected number proves the
behavior correct.

Finish when the focused task and full CLI profile pass on clean source while
retaining deterministic non-mutating inspection, accurate registration/body
counts, bounded observation fields and doctor/strict outcome coverage. Preserve
current compiler behavior and optimization defaults. Route a real compiler defect
through its owner instead of including it in the version snapshot. B6-08 must
then perform its fresh complete release replay; a resumed slice is development
evidence only.
