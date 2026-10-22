# B10-MCP-07A — exact packed source-free Native application

[PR #472](https://github.com/pulse-compute/pulse/pull/472) implements [#453](https://github.com/pulse-compute/pulse/issues/453) inside the existing mandatory `mcp-installed` gate. No compiler, runtime, provider, callable-resolution or public API behavior changes. The gate's 600-second deadline and release ownership are unchanged.

## Result and source identity

The complete installed gate passes on clean local `36b1a51f922b9683cfb82c1bd6d10a3587319871`, published as `4abbef7923cc5266778aac477d682137481ef93e`, with identical complete tree `48dc3bfa67f17ceb63fbf330187e83f4fc4c70cc`. Base is `latest` at `ebe6f327a9d7fd8005309bc1bd407da16a78e084`, including merged 06B #471; branch is `codex/b10-mcp-07a`. The later handoff commit contains evidence only. [Source mappings](./receipts/source-map.json) preserve local and published commit identities; GitHub-created commits have different metadata but verified identical trees.

The [terminal runner report](./receipts/installed-attempt7.json) records 1/1 tasks passed. The [installed acceptance receipt](./receipts/installed-attempt7-acceptance.json) records clean source, exact tarball and installed-file identities, package-lock hash, extracted application inventory, MCP facade/types/lowerer hashes, resource/config/schema hashes, runtime artifact identities, successful cleanup and unchanged installed package bytes. The standard pack produces 20 release candidates; this application installs 18 Pulse packages. Temporary candidates and consumers are deleted by the existing gate after their identities are recorded.

## Qualified behavior

The CLI-shipped `application/` is copied into its own unrelated project root with the exact installed dependencies. The installed CLI and TypeScript build/check it through ordinary package resolution. No resolver widening or repository links are needed. An independent binary producer reconstructs vector, text and metadata resources byte-for-byte against the packed manifest. Twelve on-disk resource inventory mutations and twelve embedded-config mutations cover missing, truncated, corrupt and mixed-identity data; installed config admission reports `PULSE_BINARY_RESOURCE_INVALID`.

After building, the proof removes authored `src`, `.pulse`, `tsconfig.json`, generated `canonical-handler.cjs`, `canonical-native.as.ts` and `schema-json-codecs.cjs`, and the transpiled expectation oracle. The public Node launcher executes the admitted Native Wasm with JavaScript-runtime ownership false and provider network fetch disabled. Seven runtime plan/Wasm faults reject before listening, including a different valid Wasm identity. Restoration is hash-checked after every fault and again after all requests.

There are **537 actual HTTP MCP requests**: one five-tool inventory and **536 exact expected responses**. They cover all 264 corpus records with complete paginated content/citation reconstruction, diagnostics, four example workflows, eight starter goal/target pairs, all 24 frozen search cases and their pages, and five unsupported-version cases. Search expectations come from the independent direct lexical scan; other expectations come from the separate host-v1 handlers with the explicit v2 whole-envelope pagination adapter. Both structured content and duplicated text match, with the existing response-byte limits enforced.

The original production JavaScript host, official MCP client, pinned Codex 0.160.1 onboarding, cancellation/recovery and returned starter CLI tests still execute in this same gate. [Wire receipt](./receipts/wire.json) retains their results. This extends their proof rather than replacing it with a private runtime.

## Read containment and limits

Runtime uses Node filesystem permissions: checkout/source reads are actively denied, the CLI package's source copy is excluded, and only the runtime build, installed dependencies and proof inputs are readable. All installed symlinks must resolve inside the consumer. No downloaded substitute application data is used.

Build tooling remains trusted. Node's permission mode prevents the normal atomic writer's `fsync`, even with write grants, so the build uses explicit test instrumentation over public filesystem content-read/list APIs and CommonJS resolution. Ancestor metadata probes and TypeScript's exact case-sensitivity probe are allowed. This is **not a hostile-code sandbox or a complete OS read audit**. Actual runtime execution uses Node's permission model; the product's atomic writer is unchanged.

This is Node Native installed-closure development evidence. It does not qualify actual Fastly CLI/Viceroy (10A), the generic resource matrix (07B), arbitrary installed-package callable targets, or a complete release seal, and does not close #412 alone.

## Attempts retained

The six earlier full-gate failures are preserved individually, with their source identities, logs and available nested receipts. Attempt 1 hit pnpm 12 automatic-install/build-script prompting; the helper now explicitly runs the declared workspace build with lifecycle hooks disabled before the standard packer. Attempts 2–4 exposed TypeScript's swapped-case probe under the initial filesystem grants; attempts 5–6 exposed workspace discovery probes. Attempt 5's nested receipt remains an incomplete `running` snapshot; its terminal outer runner report and log record failure. It is not counted as passing or still active.

Development-only replay logs are also retained. One initial truncation removed only a JSON newline and correctly preserved canonical identity; the probe now removes half the payload. A subsequent runtime-only replay reached response parity but found replacement Wasm bytes in its final hash check. The root cause of that development discrepancy was not established; immediate restoration hash assertions were added, and both the rebuilt development replay and fresh complete gate passed. Development replays skipped type/package-copy checks and are not qualification evidence. The final complete gate performs both checks.

## Validation and handoff

The installed gate, release feature/evidence authority tasks, maintainer checks, documentation checks/release validation, publication-contract checks and scope classifier pass on the code tree above. The installed gate includes the normal workspace TypeScript build plus real installed CLI/type checks. **68/68 selected unit tasks have passing development evidence** across the retained [original run](./receipts/unit.json) and [59/59 retry/remainder run](./receipts/unit-retry.json); [coverage index](./receipts/unit-coverage.json) has no uncovered tasks. The original aggregate remains failed: `cli-report-handler-topology` rejected `REPORT_ARTIFACT_HASH`, as previously observed during 06B. The unchanged test passed on retry. No root cause is invented and these runs are not pooled into a release seal. No local checks remain running; the implementation worktree was clean before this evidence-only handoff.

No merge, publication, deployment or self-approval is performed. The final PR records current head and clean/dirty state; this evidence is not relabeled as a later full release qualification. Next action after review/merge: **07B / #454**, generic resource lifetime, deduplication and reachability.
