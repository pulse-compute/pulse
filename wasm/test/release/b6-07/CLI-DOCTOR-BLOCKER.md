# B6-07-F01: native-expansion doctor middleware contract mismatch

**Open release-replay blocker; pre-existing on latest.** This is not caused by
the beta.6 snapshot and is outside the atomic version-preparation change.
The Viceroy acceptance direction does not apply to this failure.

## Reproduction and control

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

## Bounded follow-up

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
