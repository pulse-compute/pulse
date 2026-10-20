# 05B validation and handoff

The bounded 05B implementation is complete in draft PR #442. Public support,
helper/multiple-callee composition, JavaScript and managed MCP source authoring
remain 05C–05G. The full functional-profile aggregate is **not qualified**.

## Source and environment

- Remote branch: `codex/b10-call-proof-recovered`; source commit
  `9418e5823c3003e1aeb3ae3fff8e474e114ddb4c`.
- Source tree: `a90658c98ed186508553f1e0ceeef5952bcf4578`.
- PR base: `latest`, inspected at
  `8a51d705025c69ae306004215cb6cb48248d68e1`.
- Local branch: `codex/b10-mcp-05b`; its implementation commits were mirrored
  through the GitHub connector after ordinary Git push lacked authentication.
  Every uploaded blob and the complete remote tree were checked against Git.
  Local `5040456` and remote `9418e58` have exactly the same source tree.
- Linux x64, Node 24.19.0, TypeScript 5.9.3, AssemblyScript 0.28.18.
  The attempted offline install failed because available pnpm 11.25.0 does not
  meet the repository's ^12.4.2 engine. The existing identical-lockfile dependency
  graph was copied with relative workspace links and no lifecycle scripts.
  This is not clean-install/package/release evidence.

## Passing checkpoint checks

`05b-validation/authored-clean.json` records the exact clean remote source
commit, no dirty files, complete Wasm SHA-256/import tables and the untouched
baseline identity. It passes:

- Eight executions of actual authored HTTP source across Node Native and
  injected Fastly Native, including the named re-export alias.
- Twelve caller/target/schema rejection cases before Native emission.
- Two no-call compatibility cases for defaulted and optional context parameters.
- Binary-resource, fresh numeric-workspace, bounded-loop and exact Unicode output.
- Independent same-source no-call compilation with the untouched baseline.
- Imported-unused elimination and byte-identical emission of that exact call-free
  plan by the untouched backend; the old frontend does not accept unused imports.

| Fixture | Node Wasm bytes | Fastly Wasm bytes |
| --- | ---: | ---: |
| No call | 37,123 | 81,822 |
| Imported function unused | 37,123 | 81,822 |
| One authored computation | 39,494 | 84,657 |

The used fixture costs 2,371 / 2,835 bytes above its no-call control, including
its computation, resource and adapters. This is not a universal per-call tax.
Adding the unused import changes source identity and therefore the embedded
plan hash. Equal byte counts/imports and otherwise identical generated source
are required; delivered identities are never stripped to manufacture equality.

The clean `contracts-clean.json` runner report passes all five selected tasks:
`callable-source-admission`, `pure-helper-contract`, `suite-shape`,
`entities-contracts`, and `entities-catalog`. Source admission has eight accepted
and 32 rejected cases. The authored Native task also passed within the broader
sweep. CLI project workflow, workspace build, maintainer checks, documentation
checks, documentation-release validation and the declared scope check passed.

## Retained failures and incomplete broader coverage

The requested unit/Native/JavaScript/conformance selection has 166 tasks.
The initial attempt stopped at a stale `entities-contracts` export assertion;
the continuation stopped at the same stale inventory in `entities-catalog`.
Both fail identically on untouched baseline `8a51d70`. The test inventories
were corrected to include the already-merged `./internal/transport` export.
The matching candidate-seal assertion was aligned too; that release gate was
not executed here. No package export was added by 05B.

The final broader continuation was stopped at the 05B return boundary with
observed process exit 130. Its raw progress report still says `running` at
`guest-link-materialization-stage`; it has no terminal passing receipt and
must not be interpreted as an active or successful aggregate.

There are **114 unique passing development tasks and 52 unqualified tasks**
across the retained attempts. `05b-validation/profile-coverage.json` records
every selection, result, source revision, raw report hash, cancellation and
unqualified task. Passing coverage includes the actual/growth context Native
proof, callable composition proof, authored-call task, Node/Fastly Entities
workflows, MCP Native binding, bounds, numeric budgets, handle ownership and
helper regressions. These split runs span source revisions; do not pool them
into an immutable-candidate or release qualification. The initial sweep began
in a dirty tree; its Git commit alone is not its source identity.

The implementation review also caught a no-call regression: invoking the new
admission pass on optional/defaulted context parameters narrowed existing
behavior. The compiler now limits opt-in callable admission to its exact plain
context form; other no-call forms retain ordinary compilation. The added
compatibility fixtures pass. Earlier probe assertions also used an incorrect
source column and assumed hashes were equal between different source inputs;
the corrected tests retain source-bound identities and explicit comparison levels.

Failed task logs and matching baseline logs are retained beside the receipts.
Real Viceroy/deployment, installed closure, the full functional aggregate and
release seal remain unqualified; no later passing check is offered as their substitute.

## Recovery and next action

No implementation work is uncommitted at the tested source revision. The final
delivery adds only this validation record and evidence; its PR head is the
delivery identity, while `9418e58` identifies the clean tested code. No test
runner session remains active. Test-owned temporary residue was removed.

Next: implement **05C / #444**, reusing ordinary helper/import admission and
qualifying multiple callable/resource owners. Keep #442 as the active draft
lineage. #443 is implemented pending review; closing/merging and all release
actions remain human-owned.
