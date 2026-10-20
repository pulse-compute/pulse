# B10-R11 — installed offline documentation locator

Implements [#439](https://github.com/pulse-compute/pulse/issues/439) on merged R10,
`latest` at `54c779c41ecc47f9f5990078935a66f7266551ed`, tree
`d8130cfe0429ab998b9501eea53f2eb3f2dea5e6`.
Entry point: `project-workflow`; additional owners are the command pipeline,
diagnostic catalog, command-spec tests and installed-documentation evidence.
This is explicitly authorized scope expansion: the user's instruction to implement
R11 supplies the direction for this public command and its synchronized contracts.
It adds no release gate. Merge, publication and deployment remain human actions.

`pulse docs` prints the executing CLI version and absolute physical path to the
shipped Markdown index. `pulse docs --json` emits one stable object:

```json
{"status":"ok","version":"<executing CLI version>","docs":{"root":"<absolute directory>","index":"<absolute README.md>"}}
```

Resolution starts at the executing package. It bypasses project discovery and
configuration, validates index containment/type/readability/nonempty UTF-8 and
rejects NUL text. `PULSE_DOCS_UNAVAILABLE` and `PULSE_DOCS_INVALID` are public
exit-5 diagnostics; JSON failures remain on stderr. `--plan`/`--dry-run` describe
the operation without validating docs. The existing evidence-status projection
wraps successful results with no collected report identity. Unexpected positionals
and project/output options retain public argument errors and exit 2.

The locator does not compile, install, execute project code, contact the network,
start a server or open a browser. It locates the existing packaged Markdown and
does not promise a full documentation or package-integrity audit. Canonical help,
machine specification, completions, public references, diagnostic anchors and
installed mirrors are synchronized. Required documentation-corpus assets were
regenerated through the pinned Node 24.18.0 producer; no MCP implementation changed.
No dependency, package export, test profile, shard or release gate changed.

Final executable/package qualification uses clean local commit
`26853be493122b1bbc5f08100ccee7b874d80f0c`, tree
`bf9daf74d68734adec9010c518de6c392d7d319b`. Its GitHub equivalent is
`6662cc81b196d5342522d630bb893ce145d8e554`, with the exact same tree and base.
Later changes add only this internal README and receipt. Use the execution
identity when reproducing the run, rather than a later evidence-commit identity.

The opt-in `installed.cjs` harness fresh-builds the workspace and completely packs
all 20 candidate packages, including packed documentation validation. It installs
the CLI from a task-owned read-only loopback registry, with lifecycle scripts
disabled, into both a local consumer and a private global prefix outside the
checkout. Dependency acquisition can use npm's public registry; the CLI command
cases separately block network imports/fetch, project/compiler/provider imports,
child-process imports and filesystem writes. This is a test guard, not a general
Node sandbox claim.

Both paths contain spaces and execute the actual npm-installed `pulse` bin.
Each layout passes 19 cases, including an empty cwd, a hostile unrelated project
with decoy version/docs and throwing config, human/JSON/planning/help/evidence
output, invalid arguments, missing docs/index, directory/blank/invalid-UTF-8/NUL
indexes and escaping file/directory symlinks. Faults affect separate copies only.
All 57 relative index links resolve to real files inside the shipped CLI package.
Each installation's 15 first-party packages and 1,011 payload files
match the candidate tarballs before and after the command cases. The complete
installed run passes in 35.459 seconds; consumers and registry are removed.
Tarball, installed-file, dependency-version, lockfile, script and tool identities
are retained in `proof.json`. This Linux run does not claim a Windows bin-shim run.

The required unit/CLI union selects 93 tasks. Three retained development slices
reach terminal results for all 93: 91 pass; only `entities-contracts` and
`entities-catalog` fail. Both reproduce the same extra `./internal/transport`
export-list assertion on unchanged base. The base comparison uses clean local
`d71dcffa18f25370b91854fcef3e565f27e1dadb`, whose tree exactly equals merged
latest's `d8130cfe0429ab998b9501eea53f2eb3f2dea5e6`. Relevant owner/test hashes,
original failed logs, complete terminal task results and command signatures are
retained. Those failures remain with the other workstream and are not waived.
The initial run stops at the first assertion; continuations execute only tasks
without terminal results. These slices are not pooled into a full-profile pass.
No failed test was patched or retried to manufacture success.

The new command-spec cases pass inside the final registered selection. Report
workflow, topology, retained evidence, recovery-runner, CLI/project/provider/event
workflows, executable documentation and all registered examples pass unchanged.
Build, maintainer, canonical/installed documentation and documentation-release
checks pass. Scope reports the expected `decision-required` state for the
explicitly authorized scope expansion. A preliminary declaration used the wrong
Scope field; its rejected classifier output and corrected declaration are retained.
Pre-commit focused receipts are labeled preliminary and do not replace final
clean-source evidence. Workspace tests reuse the restored lockfile-pinned
R10 dependency bundle; fresh installed consumers are independent of workspace
symlinks, with exact first-party payloads checked against the new tarballs.

Every terminal task reports successful cleanup and no remaining managed process
trees. The independent full-worktree scan still finds 10 task-owned lease files
and eight retained fixture/output roots, including ignored directories. Their
file hashes and inventories were recorded before manual reconciliation, after
all managed children were terminal. The final full scan finds no remaining
leases, and Git is clean before adding these internal evidence files. A separate
read-only base-worktree scan is also clean. These observations do not establish a
host-wide process inventory or qualify integrated release cleanup; cause remains
unproven and R12 retains that obligation.

Reproduce on the qualified source with the restored workspace dependencies:

```bash
node docs/internal/b10-r11/installed.cjs /absolute/checkout /tmp/r11-installed-new
node wasm/scripts/run-wasm-tests.cjs --profile unit --profile cli --report /tmp/r11-unit-cli-new.json
npm run maintainer:check
npm run docs:check
node scripts/documentation-release.cjs
```

The two unchanged-base assertions will stop the profile. Preserve each terminal
report and run remaining tasks through the registered runner as development
slices; do not claim a complete-profile or seal pass. R09 live proof remains
deferred by the release owner; hosted #407 and integrated R12/#382 qualification
remain open. No full release seal, publication, deployment or human merge is
performed by this checkpoint.
