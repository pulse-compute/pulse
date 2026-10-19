# B10-MCP-00 validation

Validation date: 2026-10-19. Node: 24.19.0. Product source was pinned to
`3ce6a740226434e013f2ba517129679de0f1fd08`; the only source additions were the
files in this evidence directory. These checks are development/source evidence,
not a new resource, Native MCP, installed-package, client or release qualification.

| Check | Result |
| --- | --- |
| Resource merge ancestry | Both #413 and #418 merge commits are ancestors of the baseline |
| Live issue readback | #410/#411 closed completed; #381/#412 remain open; reconciliation recorded |
| `node docs/internal/b10-mcp-00/inventory.cjs --check` | Passed; 154 pinned files, 18 task definitions, corpus identity and all installed example mirrors |
| `node scripts/pulse-context-corpus.cjs --check` | Passed; 244 records, 516,102 module bytes, expected corpus hash |
| `npm run maintainer:sync` | Passed; no tracked generated changes |
| `npm run docs:sync` | Passed after dependency setup correction; no tracked generated changes |
| `npm run maintainer:check` | Passed; 7 classes, 11 boundaries, 9 instruction files, 42 documented commands, 9 workflows, 17 scope cases |
| `npm run docs:check` | Passed; package-source validation and synchronized source/installed documentation |
| `node scripts/documentation-release.cjs` | Passed; local documentation/release contract validation only |
| `node wasm/scripts/run-wasm-tests.cjs --task pulse-context-corpus --no-report` | One selected task passed, terminal summary, exit 0; 2.57 seconds overall |
| `git diff --check` | Passed |

The focused corpus task checks independent relocated construction, stable
provenance, immutable standalone data, stale/missing/excluded sources, source
mutation, version rejection and corpus admission. No new implementation-mirroring
unit test was added for this evidence-only change.

## Setup failures retained in the record

- An initial root-only dependency symlink was insufficient for workspace package
  resolution; `docs:sync` exited 1 with missing
  `@pulse-compute/wasm-contracts/logging` before synchronization completed.
- A fresh `pnpm 12.4.2 install --offline --frozen-lockfile --ignore-scripts`
  exited 1 because the local registry metadata cache lacked
  `@bytecodealliance/weval`. This is not a successful fresh installation.
- Recovery copied 19 existing dependency trees locally after verifying that the
  source and destination `pnpm-lock.yaml` bytes were identical. Relative workspace
  links resolve to this checkout. No lifecycle scripts or product changes were
  used to bypass the failures. Documentation synchronization and checks then
  completed successfully. This setup does not establish independent installed
  consumer qualification; that remains 07/#412.

No full functional aggregate, workspace build, seal, real Fastly run, deployment
or external client replay was needed or performed for this internal inventory.
Historical PR results remain labeled historical in the baseline. Hosted PR checks
are separate and must be evaluated at their actual tested revision.
