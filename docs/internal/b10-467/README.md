# B10-467 — named Fastly logging

Implementation and local evidence for [#467](https://github.com/pulse-compute/pulse/issues/467), [PR #470](https://github.com/pulse-compute/pulse/pull/470). The user authorized implementation and reserved deployed acceptance for the final checkpoint. No deployment, merge or release qualification is claimed.

Use `fastly({ logEndpoint: 'application-events' })`, or conventional profile `fastly.bindings.logEndpoint`. Unconfigured applications retain stdout. See the [provider guide](../../guides/fastly-capabilities.md#named-production-log-streams) for record bounds, validation and delivery limitations.

## Source and local evidence

Tests ran at local commit `a19ec5d666805969a09ff549606364d0b7ce45ac`. GitHub commit `7b55225b7e0963bd9a10c3a7ff26cc8f4ac4a7de` has the identical tree `bcc67b31c5d85a9e98cce2fd86a6b22fb5b7f0a4`; original receipt identities are retained unchanged. Later changes in this directory record evidence only.

- Full unit profile: 68 tasks passed.
- Full provider profile plus CLI diagnostics and command specification: 14 tasks passed, including the 37-case named-logging regression.
- Full JavaScript profile plus Native logging lowering, four-mode conformance and configuration/secret/KV redaction: 10 tasks passed.
- Workspace unit tests: 29 files, 280 tests passed. Build, maintainer and documentation source checks passed.
- Exact installed-package Native proof: real Viceroy 0.21.1, two named virtual records, expected 401/202 HTTP responses, Unicode output and secret absence. Six injected lookup/write fault cases are a separate evidence layer.

[installed.json](./installed.json) retains the 20 packed tarball hashes, installed-byte digest, exact Wasm and engine hashes, source identity and successful consumer cleanup. The candidate's installed first-party files were byte-verified before and after execution; lifecycle scripts were disabled. [validation.json](./validation.json) records ordered task selections and raw report hashes. Exact packages, Wasm and raw reports are retained in the accompanying validation archive.

## Retained failures and boundaries

The first concurrent local unit/provider attempts failed at retained-report artifact collection and JavaScript tooling output comparison. Both tests passed on the base; the complete current profiles then passed serially without a product or assertion change. The precise interference cause is unproven. Failed attempts retain their failed status. Receipts lost in the earlier workspace reset are not counted as completed.

The installed proof began and ended with clean source. Development profiles produced fixture output and lease residue, including residue from earlier passes; those outputs were inventoried and removed after terminal runners. Raw cleanup inventories remain in the archive. This is selected local development evidence, not a clean aggregate seal or cross-checkout release proof. Complete Native, CLI and conformance profiles and the release seal remain release-checkpoint work. Fastly JavaScript Logger behavior is injected SDK evidence, not a deployed or real-engine JavaScript delivery proof. The provider profile explicitly skips existing Viceroy transport/deadline/header replays without PULSE_VICEROY_BIN; only the separate named-logging installed proof selected the real engine. Those skipped transport paths are not counted as provider-reality passes.

## Final acceptance

Keep #467 open until a unique probe arrives at the configured production-style named receiver, redaction is verified, and HTTP outcomes remain correct. Record the service/version, source/package/Wasm identities and receiver receipt. Fastly stdout log-tail alone cannot satisfy named delivery. Viceroy virtual output is local ABI evidence only. Stdout/#309 remains separate.
