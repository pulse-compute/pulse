# 05G validation and recovery checkpoint

05G (#448) is implemented on draft #442, remote branch
`codex/b10-call-proof-recovered`, local branch `codex/b10-mcp-05g`. It continues
`8dd996f6116268999cfe16c8b77fdb44af8b73e0`; actual base remains
`8a51d705025c69ae306004215cb6cb48248d68e1`. No merge was performed.

## Source and terminal evidence

- Clean tested local implementation: `1555a51887749f78500978287fa3b93ee67a1305`.
- Published implementation: `5195e06e3debdf21a555954e7e470cc6a88efd6a`.
- Identical full Git tree: `edf4acb94afd41c4c3cd8975a4446926c75980e4`.

The connector supplies different commit metadata; every blob and the complete
uploaded tree match local Git. The evidence/documentation follow-up changes no
implementation, generated output or test. Final delivery identity is recorded on
#442/#448/#436. Reports and complete task logs are retained in `05g-validation/`.

Both runner reports have terminal `passed` status, all selected tasks completed
and process exit 0. Nine primary tasks and two context tasks passed. The separate
routed baseline replay also completed with exit 0 on the same clean source.

| Check | Result |
| --- | --- |
| api-surface | Public/re-exported types and positive/negative TypeScript fixtures |
| callable-public-contract | Exact packed runtime/Pulse declarations; nine executions across Node Native, injected Fastly Native and Node JavaScript; seven stale-metadata rejection checks; three provider/placement rejections; fourteen diagnostic entries |
| callable-source-admission | Nine accepted and 31 rejected source cases |
| callable-authored-composition | Six executions; sixteen source and eleven independent plan rejections |
| callable-authored-javascript | Fourteen executions; four invalid-output rejections; ten source rejections; twenty ownership checks; built source package |
| callable-composition-proof | Existing route/MCP backend composition, reachability and bounded rejection proof after the private frontend rename/version change |
| cli-diagnostics; package-exports; suite-shape | Diagnostic/remediation policy, public exports and registered task structure |
| pulse-context-corpus; pulse-context-build | Diagnostic-derived corpus and deterministic resource freshness |
| Separate callable-authored-routed baseline replay | 28 executions; twelve source rejections; byte-identical no-call/unused Wasm |
| Runtime surface Vitest | One test passed |

`npm run build`, maintenance, documentation check/release inventory and protected
scope checks pass. The cumulative scope report retains the preexisting Entities
protected-path review warning; it does not authorize merge or release. Large
local documentation inventories are identified by byte count and hash in
`documentation-receipts.json`. Context output generation used pinned Node 24.18.0;
checks used Node 24.19.0 and the restored identical-lockfile dependency graph,
not a fresh clean-install qualification.

## Artifact compatibility and generated closure

The public example has Node Native / Fastly Native sizes of 34,106 / 78,242 bytes.
Packed declaration and artifact SHA-256 values are in the public-contract task log.
Both type packages resolve through their actual npm tarball exports without
workspace TypeScript aliases. This is focused packed-type evidence, not full
installed application closure or npm publication.

Complete no-call/unused Wasm hashes, sizes and import tables match untouched
`8a51d70`. No-call source uses its complete project compiler; imported-unused plans
use its backend because the baseline frontend rejects those imports. No identity
hash is stripped. Router remains 38,063 / 87,771 bytes (Node / Fastly); MCP remains
99,527 / 129,895. Used Router/MCP sizes remain 40,266 / 87,848 and 101,408 / 144,012,
unchanged from 05F. Call-specific metadata versions leave no-call format identity
unchanged; stale Native proof descriptors and JavaScript tables are rejected.

Diagnostic catalog changes require regenerated public/installed references and
context resources. The canonical builder generated 260 rows, 2,493 dimensions
and 15,016 nonzeros on the pinned producer. Context corpus hash is
`b892b2edc0bdfcd5d9a95726ad7711a586ae2c77e5a26611fa5d1fe558a025f8`.
The application configuration and tools were not migrated as part of this unit.

## Attempts, scope and next action

Failed development attempts are retained and explained in
`05g-validation/README.md`. They caught example schema-import structure, incorrect
test use of the JavaScript plan constructor, relative diagnostic path handling
and the need to regenerate diagnostic-derived context resources. The final clean
checks pass; earlier failures are not counted as qualification.

No check remains running and no 05G implementation blocker remains. Public
contract/support remains subject to normal human PR review. Full profiles,
clean-machine/installed closure, actual Viceroy/deployed acceptance, real-corpus
performance and sealing remain deferred to their designated checkpoints.
The clean-machine runtime-version expectation was updated; that full lane was
not run. No new production dependency or package set was introduced.

Next: **05H (#449), restore context application configuration and complete
`pulse.start`**, on the existing draft lineage. Merge, release, deployment and
self-approval remain human-owned.
