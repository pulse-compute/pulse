# PRPT-04 validation record

Candidate: branch `codex/prpt-04-report-cli`, based on `latest` at
`f22d5a9bf1217d4c786769c5c6e38d5d724b49bc`. Tests run against the implementation
working tree; final source file identities and terminal coverage are recorded
below after the bounded run completes. This is development evidence, not a
release seal or installed-package acceptance.

The final Report CLI contract task passed 36 checks, covering complete historical JSON,
unchanged evidence hash, unavailable inventory counts, bounded/escaped terminal output, no-read/no-write plans,
option exclusions, public JSON failure envelopes, malformed/tampered/bare-Wasm
input rejection, safe output paths, symlinks, test-only renderer integration,
atomic replacement, injected rename failure and unrelated-file preservation.
A subprocess import guard denies compiler/provider/project execution, TypeScript,
process spawning and network modules on both artifact success and error paths.

The retained-evidence task adds real completed-build checks through the public
CLI for default/environment profile selection, explicit profile selection and
manifest artifact mode, comparing the entire emitted capsule with the collector.
No additional build is initiated by those command invocations.

Initial direct development attempts caught a missing `.cjs` test import and
stale command/options expectations before regeneration. Corrected reruns passed.
Canonical docs were synchronized, the MCP context corpus regenerated, and docs
synchronized again to update the packaged corpus (the previous PR's CI failure).
The corpus remains inside existing budgets at 228 records and 458,997 bytes.

The `pnpm build` wrapper stopped at the existing engine gate: the environment has
pnpm 11.25.0 while this repository requires ^12.4.2. No engine policy or dependency
was changed. Running the exact build script with the already installed pinned
TypeScript compiler succeeded:
`node node_modules/typescript/bin/tsc -b tsconfig.workspace.json`.
This is TypeScript build evidence, not a claim that the pnpm wrapper passed.

## Terminal results

- Unit + CLI selection: all 78 selected tasks passed in 603.28s.
- Two additional regression tasks passed: explicit JavaScript CLI compilation and
  configuration/secret/KV redaction.
- Focused final reruns passed after public-wording and output-path refinements:
  Report CLI, command spec/completions, context corpus, and final writer handling.
- Total: **80 distinct passing tasks**, 86 recorded task executions including
  the focused reruns. Every receipt is terminal and covers its full selection.
- Maintainer checks, docs synchronization, docs check, documentation-release and
  scope declaration validation passed. Docs check verified 83 versioned pages
  across six releases and 20,548 local links.

The final [machine evidence record](validation.json) retains selected/completed
coverage, exit status, timings, final changed-file SHA-256 values and failed
wrapper/development attempts. The main run predates final public wording, inventory availability, and
writer inspection/platform refinements; focused reruns cover those changes.
Final file hashes describe working-tree bytes, not the runner's base-commit-only
identity. No implementation files changed after the final focused reruns.

No full Native/JavaScript/conformance campaign or release seal was run. The CLI
selection includes ordinary Node and Fastly Native fixtures; optional exact-artifact
Viceroy replay was skipped because `PULSE_VICEROY_BIN` is absent. Passing local
fixture execution does not attest external provider reality. PRPT-05/06's renderer,
output snapshot, installed-package and real-application gates remain open.
